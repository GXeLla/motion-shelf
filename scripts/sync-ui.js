/*
 * The Sync action.
 *
 * One button covers the whole flow: reuse the archives Sync already knows,
 * ask for a folder only when one genuinely cannot be located, scan them
 * read-only, run everything through classification, de-duplication and the
 * family/template stage, then hand the canonical animations to the library.
 */

import { state } from "./state.js";
import { saveAnimations } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { syncLibraryToProject } from "./code.js";
import { mergeImportOrigins, mergeScannedAnimation } from "./sync-merge.js";
import { familyFingerprint } from "./animation-family.js";
import { parseDeclarations, parseKeyframes } from "./animation-extract.js";

import {
  SOURCE_FOLDER_NAMES,
  createHandleAdapter,
  discoverSourceRoots,
  isSameArchive,
  loadRememberedRoots,
  loadScanCache,
  pickSourceRoot,
  rememberSourceRoot,
  saveScanCache,
  scanSources,
  splitCacheByRepository,
  supportsSourceScanning,
} from "./campaign-scan.js";

/* Both spellings of the second archive refer to the same source. */
const WANTED = ["campaigns", "previews-only"];

function resolveStoredKeyframes(animation) {
  const declarations = parseDeclarations(animation.css);
  const source = String(animation.keyframes || "");

  /* Canonical cards parameterise their keyframes with custom properties. For
     comparison, put their saved defaults back before parsing so a historic
     `var(--ms-distance)` has the same behavioural shape as a newly scanned
     `translateY(-10px)`. */
  return source
    .replace(/var\((--ms-[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (whole, name, fallback) =>
      declarations[name] || fallback || whole)
    .replace(/calc\(\s*([+-]?\d*\.?\d+)([a-z%]*)\s*\*\s*([+-]?\d*\.?\d+)\s*\)/gi,
      (whole, value, unit, multiplier) => `${Number(value) * Number(multiplier)}${unit}`);
}

/* Older imported cards carry the former offset-sensitive family key. Rebuild
   the current semantic key from their saved keyframes during Sync, so timing
   variants already in the library can collapse with the newly scanned family. */
function semanticFamilyKey(animation) {
  const keyframes = parseKeyframes(resolveStoredKeyframes(animation));
  const steps = keyframes.values().next().value;

  if (!steps?.length) return animation.origin?.familyFingerprint || "";

  return familyFingerprint(steps, {
    iterationCount: animation.iterationCount,
    interaction: animation.interaction,
    target: animation.target,
    support: {
      element: parseDeclarations(animation.css),
      parent: parseDeclarations(animation.parent),
    },
  });
}

const STAT_LABELS = [
  ["filesInspected", "Files Scanned", "Source files checked for animations"],
  ["campaignFoldersInspected", "Campaign Folders Scanned", "Source campaign folders inspected"],
  ["animationsFound", "Animations Found", "Total animation occurrences detected"],
  ["uniqueAnimations", "Unique Animations", "Canonical animations kept after deduplication"],
  ["duplicates", "Duplicates Merged", "Repeated or similar animations grouped"],
  ["skippedItems", "Skipped Items", "Files or animations ignored during Sync"],
  ["parseErrors", "Sync Errors", "Source files that could not be processed"],
];

export function initializeSync({ render, showToast, updateWorkspaceUI = () => {} }) {
  const button = document.getElementById("syncButton");
  const backdrop = document.getElementById("scanModalBackdrop");
  const statsList = document.getElementById("scanStats");
  const description = document.getElementById("scanModalDescription");
  const closeButton = document.getElementById("scanCloseButton");
  const dismissButton = document.getElementById("scanDismissButton");
  const confirmButton = document.getElementById("scanImportButton");
  const confirmLabel = document.getElementById("scanImportLabel");
  const buttonLabel = button.querySelector("span");

  const idleLabel = buttonLabel.textContent;
  let pending = [];
  let busy = false;

  const setLabel = (text) => { buttonLabel.textContent = text; };

  function closeModal() {
    backdrop.hidden = true;
    document.body.style.overflow = "";
  }

  function openModal() {
    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function renderStats(stats) {
    statsList.innerHTML = STAT_LABELS
      .filter(([key]) => stats[key] !== undefined)
      .map(([key, label, tooltip]) => (
        '<div class="scan-stat" data-tooltip="' + escapeHtml(tooltip) + '">'
        + "<dt>" + escapeHtml(label) + "</dt>"
        + "<dd>" + escapeHtml(String(stats[key])) + "</dd>"
        + "</div>"
      ))
      .join("");
  }

  /*
   * Resolves both archives: remembered ones first, then whatever a single
   * picked folder contains, and only then a prompt for what is still missing.
   */
  async function resolveArchives() {
    const found = new Map();

    (await loadRememberedRoots()).forEach((root) => {
      const match = WANTED.find((name) => isSameArchive(name, root.repository));
      if (match && !found.has(match)) found.set(match, root);
    });

    for (const wanted of WANTED) {
      if (found.has(wanted)) continue;

      setLabel("Looking for " + wanted);

      let picked;
      try {
        picked = await pickSourceRoot();
      } catch (error) {
        if (error && error.name === "AbortError") break;
        throw error;
      }

      /* One pick can satisfy both archives when it is their shared parent. */
      const discovered = await discoverSourceRoots(picked);

      for (const root of discovered) {
        const match = WANTED.find((name) => isSameArchive(name, root.repository));
        if (!match || found.has(match)) continue;

        found.set(match, root);
        await rememberSourceRoot(root.repository, root.handle);
      }
    }

    return [...found.values()];
  }

  function createCompositeAdapter(roots) {
    const adapters = new Map(roots.map((root) => [root.repository, createHandleAdapter(root.handle)]));

    const split = (prefixed) => {
      const index = prefixed.indexOf("/");
      if (index === -1) return { repository: prefixed, relative: "" };
      return { repository: prefixed.slice(0, index), relative: prefixed.slice(index + 1) };
    };

    return {
      async list(prefixed) {
        const target = split(prefixed);
        const items = await adapters.get(target.repository).list(target.relative);
        return items.map((item) => ({ ...item, path: target.repository + "/" + item.path }));
      },
      async read(prefixed) {
        const target = split(prefixed);
        return adapters.get(target.repository).read(target.relative);
      },
      discard(prefixed) {
        const target = split(prefixed);
        adapters.get(target.repository).discard(target.relative);
      },
    };
  }

  async function runSync() {
    if (busy) return;

    if (!supportsSourceScanning()) {
      showToast("Folder access is not supported. Use Chrome or Edge on localhost.", "fa-solid fa-triangle-exclamation");
      return;
    }

    busy = true;
    button.disabled = true;

    try {
      const roots = await resolveArchives();

      if (!roots.length) {
        showToast(
          "Neither " + SOURCE_FOLDER_NAMES.slice(0, 2).join(" nor ") + " could be located.",
          "fa-solid fa-triangle-exclamation",
        );
        return;
      }

      setLabel("Scanning...");

      /*
       * What the last sync learned about each archive. A file whose size and
       * modification time are unchanged is never read or parsed again -- only
       * opened far enough to compare those two numbers -- which is most of
       * the work in every sync after the first.
       */
      const previousCaches = await Promise.all(
        roots.map((root) => loadScanCache(root.repository)),
      );

      const cache = new Map();

      previousCaches.forEach((entries) => {
        entries.forEach((value, key) => cache.set(key, value));
      });

      const result = await scanSources({
        adapter: createCompositeAdapter(roots),
        roots: roots.map((root) => ({ repository: root.repository, path: root.repository })),
        cache,
        onProgress: async (stats) => {
          setLabel(stats.campaignFoldersInspected + " folders, " + stats.uniqueAnimations + " found");
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      });

      /* Stored per archive, so one that was not available this time keeps
         the cache it already had instead of being emptied. */
      const nextCaches = splitCacheByRepository(
        result.cache || new Map(),
        roots.map((root) => root.repository),
      );

      await Promise.all(
        [...nextCaches.entries()].map(([repository, entries]) =>
          saveScanCache(repository, entries)),
      );

      pending = result.animations;

      renderStats(result.stats);
      description.textContent = roots.map((root) => root.repository).join(" and ")
        + " were read without being modified"
        + (roots.length < WANTED.length ? " (one archive was not found)." : ".");

      confirmLabel.textContent = "Sync " + pending.length + " animation" + (pending.length === 1 ? "" : "s");
      confirmButton.disabled = pending.length === 0;

      openModal();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.error("Sync failed:", error);
      showToast("The sync could not be completed.", "fa-solid fa-triangle-exclamation");
    } finally {
      busy = false;
      button.disabled = false;
      setLabel(idleLabel);
    }
  }

  /*
   * Imported animations join the library as ordinary records. Anything the
   * user made by hand is left alone: only entries carrying import provenance
   * are ever replaced by a newer canonical version of themselves.
   */
  async function applyPending() {
    if (busy || !pending.length) return;

    busy = true;
    button.disabled = true;
    confirmButton.disabled = true;

    try {
      const manual = state.animations.filter((animation) => !animation.origin);
      const imported = state.animations.filter((animation) => animation.origin);

      const byFamily = new Map();
      imported.forEach((animation) => {
        const key = semanticFamilyKey(animation);
        if (!key) return;

        const existing = byFamily.get(key);
        /* Several legacy cards can now resolve to one semantic family. Keep
           one stable card while carrying every source forward into the scan
           merge that follows. */
        byFamily.set(key, existing
          ? { ...existing, origin: mergeImportOrigins(existing.origin, animation.origin) }
          : animation);
      });

      const manualClasses = new Set(manual.map((animation) => animation.className));

      let added = 0;
      let refreshed = 0;
      let unchanged = 0;
      const next = [];

      pending.forEach((animation) => {
        const key = animation.origin.familyFingerprint;
        const existing = byFamily.get(key);

        /* Never take a class name a hand made animation already uses. */
        let record = animation;
        if (manualClasses.has(record.className)) {
          record = { ...record, className: record.className + "-imported" };
        }

        if (existing) {
          const merged = mergeScannedAnimation(record, existing);
          if (merged === existing) unchanged += 1;
          else refreshed += 1;
          byFamily.set(key, merged);
          return;
        }

        added += 1;
        next.push(mergeScannedAnimation(record));
      });

      state.animations = [...next, ...byFamily.values(), ...manual];
      saveAnimations(state.animations);

      pending = [];
      closeModal();
      render();

      showToast(
        added + " added, " + refreshed + " refreshed, " + unchanged + " unchanged. " + manual.length + " of your own kept.",
        "fa-solid fa-check",
      );

      /* Sharing is the point of Sync: write the catalog when a project is
         linked, so a commit carries it to everyone. */
      if (state.projectHandle && state.projectPermission === "granted") {
        setLabel("Saving...");
        await syncLibraryToProject(state.animations, {
          showToast, render, updateWorkspaceUI,
          onProgress: ({ processed, total }) => setLabel("Saving " + processed + " / " + total),
        });
      }
    } catch (error) {
      console.error("Could not apply sync:", error);
      showToast("Could not apply the scanned animations.", "fa-solid fa-triangle-exclamation");
    } finally {
      busy = false;
      button.disabled = false;
      confirmButton.disabled = pending.length === 0;
      setLabel(idleLabel);
    }
  }

  button.addEventListener("click", runSync);
  closeButton.addEventListener("click", closeModal);
  dismissButton.addEventListener("click", closeModal);
  confirmButton.addEventListener("click", applyPending);

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });

  return { runSync };
}
