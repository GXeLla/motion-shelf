/*
 * The Sync action.
 *
 * One button covers the whole flow: reuse the archives Sync already knows,
 * ask for a folder only when one genuinely cannot be located, scan them
 * read-only, run everything through classification, de-duplication and the
 * family/template stage, then hand the canonical animations to the library.
 */

import { state } from "./state.js";
import { saveAnimations, isAnimationDeleted, getLastStorageErrorMessage } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { syncLibraryToProject } from "./code.js";
import { mergeImportOrigins, mergeScannedAnimation, uniqueImportedClasses } from "./sync-merge.js";
import { familyFingerprint } from "./animation-family.js";
import { parseDeclarations, parseKeyframes } from "./animation-extract.js";
import {
  applyRuntimeAuditRecord,
  createRuntimeAuditQueue,
  renderAuditSummary,
  runtimeAuditSignature,
} from "./runtime-audit.js";
import { isQuarantinedAnimation } from "./filters.js";

import {
  SOURCE_FOLDER_NAMES,
  createHandleAdapter,
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

export function initializeSync({ render, showToast }) {
  const button = document.getElementById("syncButton");
  const backdrop = document.getElementById("scanModalBackdrop");
  const statsList = document.getElementById("scanStats");
  const brokenList = document.getElementById("scanBrokenList");
  const description = document.getElementById("scanModalDescription");
  const title = document.getElementById("scanModalTitle");
  const closeButton = document.getElementById("scanCloseButton");
  const dismissButton = document.getElementById("scanDismissButton");
  const confirmButton = document.getElementById("scanImportButton");
  const confirmLabel = document.getElementById("scanImportLabel");
  const buttonLabel = button.querySelector("span");

  const idleLabel = buttonLabel.textContent;
  let pending = [];
  let pendingAudit = null;
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

  function renderFinalResults({ added, refreshed, unchanged, audit, usable }) {
    statsList.innerHTML = [
      ["New Animations Added", added],
      ["Existing Animations Updated", refreshed],
      ["Unchanged Animations", unchanged],
      ["Usable Animations Kept", usable],
    ].map(([label, value]) => (
      `<div class="scan-stat"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`
    )).join("");
    renderAuditSummary(brokenList, audit);
  }

  /*
   * Resolves both archives: remembered ones first, then whatever a single
   * picked folder contains, and only then a prompt for what is still missing.
   */
  async function resolveArchives() {
    const found = new Map();

    (await loadRememberedRoots()).forEach((root) => {
      const match = WANTED.find((name) => isSameArchive(name, root.repository));
      if (match && isSameArchive(match, root.handle.name) && !found.has(match)) found.set(match, root);
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

      // Reject a wrong name before inspecting its contents or opening another picker.
      if (!isSameArchive(wanted, picked.name)) {
        throw new Error(`Wrong folder. Choose ${wanted}.`);
      }
      const discovered = [{ repository: wanted, handle: picked }];

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
      showToast("Folder access is not supported. Use Chrome or Edge on localhost.", "icon-solid icon-triangle-exclamation");
      return;
    }

    busy = true;
    button.disabled = true;
    pendingAudit = null;

    try {
      const roots = await resolveArchives();

      if (!roots.length) {
        showToast(
          "Neither " + SOURCE_FOLDER_NAMES.slice(0, 2).join(" nor ") + " could be located.",
          "icon-solid icon-triangle-exclamation",
        );
        return;
      }

      setLabel("Scanning...");
      title.textContent = "Scanning animations";
      description.textContent = "Discovering, normalizing and grouping source animations before runtime validation.";
      statsList.innerHTML = "";
      brokenList.hidden = true;
      brokenList.innerHTML = "";
      confirmButton.hidden = true;
      dismissButton.textContent = "Close";
      openModal();

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

      let latestScanStats = null;
      let latestAuditProgress = null;
      const seenCandidateFamilies = new Set();
      const existingAudits = new Map();
      state.animations.forEach((animation) => {
        const family = animation.origin?.familyFingerprint;
        if (!family || !animation.audit || !animation.auditSignature) return;
        if (!existingAudits.has(family)) existingAudits.set(family, animation);
      });
      const renderLiveDescription = () => {
        const occurrences = latestScanStats
          ? latestScanStats.cssAnimationsFound + latestScanStats.gsapAnimationsFound
          : 0;
        const auditText = latestAuditProgress
          ? ` · ${latestAuditProgress.checked} of ${latestAuditProgress.total} canonical candidates audited`
          : "";
        description.textContent = `${occurrences} animation occurrences found${auditText}.`;
      };
      const auditQueue = createRuntimeAuditQueue({
        onProgress: (progress) => {
          latestAuditProgress = progress;
          renderAuditSummary(brokenList, progress);
          renderLiveDescription();
        },
      });

      const result = await scanSources({
        adapter: createCompositeAdapter(roots),
        roots: roots.map((root) => ({ repository: root.repository, path: root.repository })),
        cache,
        onCanonicalCandidate: (candidate) => {
          const family = candidate.origin?.familyFingerprint;
          if (!family || seenCandidateFamilies.has(family)) return;
          seenCandidateFamilies.add(family);
          const existing = existingAudits.get(family);
          if (existing && existing.auditSignature === runtimeAuditSignature(candidate)) {
            auditQueue.prime(candidate, {
              kind: existing.audit.status === "broken / quarantined" ? "broken" : existing.audit.status,
              reason: existing.audit.reason,
              previewHint: existing.previewHint,
              perception: existing.previewAnalysis,
            });
            return;
          }
          /* Enqueue only. The bounded runtime renderer advances on animation
             frames while archive listing/reads continue independently. */
          void auditQueue.enqueue(candidate).catch(() => {});
        },
        onProgress: async (stats) => {
          latestScanStats = stats;
          setLabel(stats.campaignFoldersInspected + " folders, " + stats.uniqueAnimations + " found");
          renderStats(stats);
          renderLiveDescription();
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

      title.textContent = "Sync results";
      confirmButton.hidden = false;
      dismissButton.textContent = "Close";

      renderStats(result.stats);
      description.textContent = roots.map((root) => root.repository).join(" and ")
        + " were read without being modified"
        + (roots.length < WANTED.length ? " (one archive was not found)." : ".");

      confirmButton.disabled = true;
      confirmButton.hidden = false;
      confirmLabel.textContent = "Finishing runtime checks…";
      description.textContent = "Scanning completed. Finishing only canonical previews not already checked during scanning.";

      pendingAudit = await auditQueue.finish(pending);
      renderAuditSummary(brokenList, pendingAudit);

      pending = pending.map((animation, index) => {
        const result = pendingAudit.records[index];
        return applyRuntimeAuditRecord({ ...animation }, result);
      });

      /* The live progress modal may have been closed while work continued.
         Always bring it back for the actionable final audit/import result. */
      openModal();
      description.textContent = "Canonical animations were scanned and checked in safe runtime preview frames.";
      const usablePending = pending.filter((animation) => animation.audit?.status !== "broken / quarantined").length;
      confirmLabel.textContent = pending.length
        ? "Sync " + usablePending + " usable animation" + (usablePending === 1 ? "" : "s")
        : "Audit current library";
      confirmButton.disabled = false;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.error("Sync failed:", error);
      showToast(error?.message?.startsWith("Wrong folder") ? error.message : "The sync could not be completed.", "icon-solid icon-triangle-exclamation");
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
    if (busy) return;

    busy = true;
    button.disabled = true;
    confirmButton.disabled = true;

    try {
      const manual = state.animations.filter((animation) => !animation.origin);
      const imported = state.animations.filter((animation) => animation.origin);

      const byFamily = new Map();
      const unmatched = [];
      imported.forEach((animation) => {
        const key = semanticFamilyKey(animation);
        if (!key) { unmatched.push(animation); return; }

        const existing = byFamily.get(key);
        /* Several legacy cards can now resolve to one semantic family. Keep
           one stable card while carrying every source forward into the scan
           merge that follows. */
        byFamily.set(key, existing
          ? { ...existing, origin: mergeImportOrigins(existing.origin, animation.origin) }
          : animation);
      });

      let added = 0;
      let refreshed = 0;
      let unchanged = 0;
      let quarantined = 0;
      const next = [];

      pending.forEach((animation) => {
        const key = animation.origin.familyFingerprint;
        const existing = byFamily.get(key);

        const record = animation;
        if (isAnimationDeleted(existing?.id || record.id)) return;

        if (existing) {
          const merged = mergeScannedAnimation(record, existing);
          if (merged === existing) unchanged += 1;
          else refreshed += 1;
          byFamily.set(key, merged);
          return;
        }

        /* Keep rejected candidates for future recovery and provenance, but
           never describe them as normal animations added to the library. */
        if (isQuarantinedAnimation(record)) quarantined += 1;
        else added += 1;
        next.push(mergeScannedAnimation(record));
      });

      const candidates = [
        ...uniqueImportedClasses([...byFamily.values(), ...unmatched, ...next], manual), ...manual,
      ].filter(animation => !isAnimationDeleted(animation.id));
      if (!await saveAnimations(candidates)) {
        title.textContent = "Sync not saved";
        description.textContent = getLastStorageErrorMessage() + " Your scan results are kept here so you can retry.";
        showToast(description.textContent, "icon-solid icon-triangle-exclamation");
        return;
      }
      state.animations = candidates;

      pending = [];
      render();

      title.textContent = "Sync complete";
      description.textContent = "The library was updated and checked in isolated runtime preview frames.";
      renderFinalResults({
        added,
        refreshed,
        unchanged,
        audit: pendingAudit || { total: 0, totals: { valid: 0, "auto-fixable": 0, "preview-only fix": 0, "no visible effect": 0, broken: 0, "manual review required": 0 }, records: [] },
        usable: state.animations.filter((animation) => !isQuarantinedAnimation(animation)).length,
      });
      confirmButton.hidden = true;
      dismissButton.textContent = "Done";

      showToast(
        added + " usable added, " + refreshed + " refreshed, " + unchanged + " unchanged"
        + (quarantined ? ", " + quarantined + " quarantined" : "")
        + ". " + manual.length + " of your own kept.",
        "icon-solid icon-check",
      );

      /* Sync chooses a project folder only when it needs to publish. There is
         no persistent project-link control in the header. */
      setLabel("Saving...");
      await syncLibraryToProject(state.animations, {
        showToast, render,
        onProgress: ({ processed, total }) => setLabel("Saving " + processed + " / " + total),
      });
    } catch (error) {
      console.error("Could not apply sync:", error);
      showToast("Could not apply the scanned animations.", "icon-solid icon-triangle-exclamation");
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
