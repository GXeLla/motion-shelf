/*
 * The Sync action.
 *
 * One button covers the whole flow: reuse the archives Sync already knows,
 * ask for a folder only when one genuinely cannot be located, scan them
 * read-only, run everything through classification, de-duplication and the
 * family/template stage, then hand the canonical animations to the library.
 */

import { state } from "./state.js";
import { normalizeAnimation, saveAnimations } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { syncLibraryToProject } from "./code.js";

import {
  SOURCE_FOLDER_NAMES,
  createHandleAdapter,
  discoverSourceRoots,
  isSameArchive,
  loadRememberedRoots,
  pickSourceRoot,
  rememberSourceRoot,
  scanSources,
  supportsSourceScanning,
} from "./campaign-scan.js";

/* Both spellings of the second archive refer to the same source. */
const WANTED = ["campaigns", "previews-only"];

const STAT_LABELS = [
  ["campaignFoldersInspected", "Campaign folders inspected"],
  ["filesInspected", "Source files inspected"],
  ["cssAnimationsFound", "CSS animations found"],
  ["gsapAnimationsFound", "GSAP animations found"],
  ["duplicatesCollapsed", "Exact duplicates collapsed"],
  ["nearDuplicatesGrouped", "Near-duplicates grouped"],
  ["animationFamilies", "Animation families"],
  ["unsupported", "Skipped as not reusable"],
  ["parseErrors", "Parsing errors"],
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
      .map(([key, label]) => (
        '<div class="scan-stat">'
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

      const result = await scanSources({
        adapter: createCompositeAdapter(roots),
        roots: roots.map((root) => ({ repository: root.repository, path: root.repository })),
        onProgress: async (stats) => {
          setLabel(stats.campaignFoldersInspected + " folders, " + stats.uniqueAnimations + " found");
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      });

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
    if (!pending.length) return;

    const manual = state.animations.filter((animation) => !animation.origin);
    const imported = state.animations.filter((animation) => animation.origin);

    const byFamily = new Map();
    imported.forEach((animation) => {
      const key = animation.origin && animation.origin.familyFingerprint;
      if (key) byFamily.set(key, animation);
    });

    const manualClasses = new Set(manual.map((animation) => animation.className));

    let added = 0;
    let refreshed = 0;
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
        refreshed += 1;
        byFamily.set(key, normalizeAnimation({ ...record, id: existing.id, createdAt: existing.createdAt }));
        return;
      }

      added += 1;
      next.push(normalizeAnimation({ ...record, source: "session" }));
    });

    state.animations = [...next, ...byFamily.values(), ...manual];
    saveAnimations(state.animations);

    pending = [];
    closeModal();
    render();

    showToast(
      added + " added, " + refreshed + " refreshed. " + manual.length + " of your own kept.",
      "fa-solid fa-check",
    );

    /* Sharing is the point of Sync: write the catalog when a project is
       linked, so a commit carries it to everyone. */
    if (state.projectHandle && state.projectPermission === "granted") {
      await syncLibraryToProject(state.animations, { showToast, render, updateWorkspaceUI });
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
