import { state, beginProjectBusy, endProjectBusy } from "./state.js";

import {
  findAnimation,
  buildExportCSS,
  getCodeFileName,
} from "./animations.js";

import { removeAnimationRecords, saveAnimation, saveAnimations } from "./storage.js";

import {
  ensureProjectHandle,
  getAnimationsDirectory,
  getProjectDisplayPath,
  supportsProjectFolders,
} from "./filesystem.js";

const WRITE_CONCURRENCY = 4;
let projectWriteQueue = Promise.resolve();

function queueProjectWrite(write, updateWorkspaceUI) {
  beginProjectBusy();
  updateWorkspaceUI();
  const result = projectWriteQueue.then(write);
  projectWriteQueue = result.catch(() => {});
  return result.finally(() => {
    endProjectBusy();
    updateWorkspaceUI();
  });
}

function isCssFileName(fileName) {
  return typeof fileName === "string" && /\.css$/i.test(fileName) && !/[\\/\0]/.test(fileName);
}

/* Reserve names before any parallel work, including files belonging to
   animations outside this batch. A new animation must not replace another
   animation just because its display name produces the same slug. */
function createWritePlans(animations) {
  const reserved = new Map();
  for (const animation of [...state.animations, ...animations]) {
    if (isCssFileName(animation.codeFileName)) {
      const key = animation.codeFileName.toLowerCase();
      if (!reserved.has(key)) reserved.set(key, animation.id);
    }
  }

  return animations.map((animation) => {
    const preferred = isCssFileName(animation.codeFileName)
      ? animation.codeFileName : getCodeFileName(animation);
    const stem = preferred.replace(/\.css$/i, "");
    let suffix = 1;
    const nextName = () => {
      let fileName;
      do {
        fileName = suffix === 1 ? preferred : `${stem}-${suffix}.css`;
        suffix += 1;
      } while (reserved.has(fileName.toLowerCase()) && reserved.get(fileName.toLowerCase()) !== animation.id);
      reserved.set(fileName.toLowerCase(), animation.id);
      return fileName;
    };
    return { animation, fileName: nextName(), nextName };
  });
}

async function readFile(directory, fileName) {
  try {
    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();
    return { handle, file, text: await file.text() };
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

function getFileAnimationId(cssText) {
  const match = cssText.match(/\/\*\s*@motion-shelf\s*([\s\S]*?)\*\//i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]).id || null;
  } catch {
    return null;
  }
}

async function writeChangedText(directory, fileName, text, existing) {
  if (existing?.text === text) return false;
  const handle = existing?.handle || await directory.getFileHandle(fileName, { create: true });
  let writable;
  try {
    writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  } catch (error) {
    /* File System Access commits on close. Abort keeps an existing file
       intact; remove only the new empty entry created for a failed save. */
    if (writable) await writable.abort().catch(() => {});
    if (!existing) {
      try {
        if ((await handle.getFile()).size === 0) await directory.removeEntry(fileName);
      } catch (cleanupError) {
        console.warn(`Could not clean up animations/${fileName}:`, cleanupError);
      }
    }
    throw error;
  }
}

async function writeAnimation(directory, plan) {
  const { animation } = plan;
  const exportedCss = buildExportCSS(animation);
  let existing;

  while (true) {
    try {
      existing = await readFile(directory, plan.fileName);
    } catch (error) {
      if (error?.name !== "TypeMismatchError") throw error;
      plan.fileName = plan.nextName();
      continue;
    }
    if (!existing || plan.fileName === animation.codeFileName ||
      existing.text === exportedCss || getFileAnimationId(existing.text) === animation.id) break;
    plan.fileName = plan.nextName();
  }

  const changed = await writeChangedText(directory, plan.fileName, exportedCss, existing);
  animation.codeFileName = plan.fileName;
  // Editing can continue while a stream is open. Only the exported snapshot
  // was saved; a newer editor value still needs another push.
  animation.codeSynced = buildExportCSS(animation) === exportedCss;
  animation.localPresent = true;
  animation.localPath = getProjectDisplayPath(plan.fileName);
  animation.source = "local";
  animation.rawCss = exportedCss;
  animation.lastCodePush = changed ? Date.now() : existing.file.lastModified;

  return { changed, fileName: plan.fileName };
}

export async function pushAnimationToCode(
  id,
  { showToast, render, updateWorkspaceUI = () => {} },
) {
  const animation = findAnimation(id);

  if (!animation) {
    return;
  }

  if (!supportsProjectFolders()) {
    showToast(
      "Your browser does not support folder access. Use Chrome or Edge.",
      "fa-solid fa-triangle-exclamation",
    );

    return;
  }

  try {
    await ensureProjectHandle();
    updateWorkspaceUI();

    const { changed, fileName } = await queueProjectWrite(async () => {
      const directory = await getAnimationsDirectory({ create: true });
      return writeAnimation(directory, createWritePlans([animation])[0]);
    }, updateWorkspaceUI);

    await saveAnimation(animation);

    render();

    updateWorkspaceUI();

    showToast(
      changed ? `Saved locally in animations/${fileName}` : `Already up to date: animations/${fileName}`,
      "fa-solid fa-folder-check",
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    console.error("Push failed:", error);

    showToast(
      "Could not write the animation.",
      "fa-solid fa-triangle-exclamation",
    );
  }
}

/*
 * Rebuilds animations/manifest.json from whatever CSS files actually exist in
 * the folder. The manifest is what every visitor loads, so it is derived from
 * the directory rather than tracked by hand.
 */
export async function writeAnimationsManifest(animationsHandle) {
  const files = [];

  for await (const [fileName, handle] of animationsHandle.entries()) {
    if (handle.kind !== "file") continue;
    if (!fileName.toLowerCase().endsWith(".css")) continue;
    files.push(fileName);
  }

  files.sort((a, b) => a.localeCompare(b));

  const text = JSON.stringify({ version: 1, files }, null, 2) + "\n";
  await writeChangedText(animationsHandle, "manifest.json", text, await readFile(animationsHandle, "manifest.json"));

  return files;
}

/*
 * Publishes the library so the whole team gets it: every animation is written
 * into animations/ and the manifest is regenerated, which is what turns a
 * local session into the committed catalog everyone loads. Committing and
 * pushing is still the developer's own step.
 */
export async function syncLibraryToProject(
  animations,
  { showToast, render, updateWorkspaceUI = () => {}, onProgress = () => {} },
) {
  if (!animations.length) {
    showToast("There is nothing to sync yet.", "fa-solid fa-triangle-exclamation");
    return null;
  }

  if (!supportsProjectFolders()) {
    showToast(
      "Your browser does not support folder access. Use Chrome or Edge.",
      "fa-solid fa-triangle-exclamation",
    );
    return null;
  }

  try {
    await ensureProjectHandle();
    updateWorkspaceUI();

    const result = await queueProjectWrite(async () => {
      const directory = await getAnimationsDirectory({ create: true });
      const plans = createWritePlans(animations);
      let next = 0;
      let written = 0;
      let unchanged = 0;
      let processed = 0;
      let lastProgress = 0;
      const failures = [];
      const completed = [];
      const report = () => {
        lastProgress = performance.now();
        try {
          Promise.resolve(onProgress({ written, unchanged, processed, total: plans.length }))
            .catch((error) => console.warn("Could not report save progress:", error));
        } catch (error) {
          console.warn("Could not report save progress:", error);
        }
      };
      report();

      await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, plans.length) }, async () => {
        while (next < plans.length) {
          const plan = plans[next++];
          try {
            const { changed } = await writeAnimation(directory, plan);
            if (changed) written += 1;
            else unchanged += 1;
            completed.push(plan.animation);
          } catch (error) {
            console.warn("Could not write " + plan.fileName + ":", error);
            failures.push(plan.animation.name);
          }

          processed += 1;
          if (processed === plans.length || performance.now() - lastProgress >= 50) report();
        }
      }));

      /* Publish only after every stream is closed. Even if one CSS file or
         the manifest fails, retain the successful saves in session state. */
      let manifest = null;
      let manifestError = null;
      try {
        manifest = await writeAnimationsManifest(directory);
        for (const animation of completed) animation.repositoryPresent = true;
      } catch (error) {
        manifestError = error;
        console.error("Could not update the animation catalog:", error);
      }
      await saveAnimations(state.animations);
      return { written, unchanged, processed, failures, manifest, manifestError };
    }, updateWorkspaceUI);

    render();
    updateWorkspaceUI();

    if (result.manifestError) {
      showToast(
        result.written + " saved, " + result.unchanged + " unchanged" +
          (result.failures.length ? ", " + result.failures.length + " failed" : "") +
          ". The shared catalog could not be updated; retry Sync.",
        "fa-solid fa-triangle-exclamation",
      );
    } else if (result.failures.length) {
      showToast(
        result.written + " saved, " + result.unchanged + " unchanged, " + result.failures.length + " could not be written.",
        "fa-solid fa-triangle-exclamation",
      );
    } else {
      showToast(
        result.written
          ? result.written + " saved, " + result.unchanged + " unchanged. Commit and push to share them."
          : "All " + result.unchanged + " animations are already up to date.",
        "fa-solid fa-users",
      );
    }

    return result;
  } catch (error) {
    if (error?.name === "AbortError") return null;

    console.error("Sync failed:", error);
    showToast("Could not sync the library.", "fa-solid fa-triangle-exclamation");
    return null;
  }
}

export async function deleteAnimationsFromCode(
  ids,
  { showToast, render, closeAll, updateWorkspaceUI = () => {} },
) {
  if (!ids.length) {
    return;
  }

  if (!supportsProjectFolders()) {
    showToast(
      "Your browser does not support folder access.",
      "fa-solid fa-triangle-exclamation",
    );

    return;
  }

  try {
    await ensureProjectHandle();
    updateWorkspaceUI();

    /* Deletion takes its turn in the same queue as Push and Sync, so it can
       never interleave with a write that is still streaming into the folder
       it is removing files from. */
    const { failures, manifestError } = await queueProjectWrite(async () => {
      const animationsHandle = await getAnimationsDirectory({ create: false });
      const removalFailures = [];

      for (const id of ids) {
        const animation = findAnimation(id);

        if (!animation) {
          continue;
        }

        const fileName = animation.codeFileName || getCodeFileName(animation);

        try {
          await animationsHandle.removeEntry(fileName);
        } catch (error) {
          if (error?.name !== "NotFoundError") {
            removalFailures.push(animation.name);
          }
        }
      }

      /* manifest.json is what every visitor loads. A deleted file left listed
         there is not a stale entry but a catalog that no longer describes the
         folder, so it is rebuilt in the same turn as the deletion. */
      let catalogError = null;
      if (!removalFailures.length) {
        try {
          await writeAnimationsManifest(animationsHandle);
        } catch (error) {
          catalogError = error;
          console.error("Could not update the animation catalog:", error);
        }
      }

      return { failures: removalFailures, manifestError: catalogError };
    }, updateWorkspaceUI);

    if (failures.length) {
      showToast(
        "Some code files could not be deleted.",
        "fa-solid fa-triangle-exclamation",
      );

      return;
    }

    const removedIds = new Set(ids);
    state.animations = state.animations.filter(
      (animation) => !removedIds.has(animation.id),
    );

    await removeAnimationRecords(ids);

    closeAll();

    render();

    updateWorkspaceUI();

    showToast(
      manifestError
        ? "Animations deleted, but the shared catalog could not be updated. Run Sync."
        : "Animations deleted locally and from code.",
      manifestError ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-trash",
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    if (error?.name === "NotFoundError") {
      showToast(
        "The animations folder was not found.",
        "fa-solid fa-triangle-exclamation",
      );

      return;
    }

    console.error("Code deletion failed:", error);

    showToast(
      "Could not delete the code files.",
      "fa-solid fa-triangle-exclamation",
    );
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");

    textarea.value = text;

    document.body.appendChild(textarea);

    textarea.select();

    document.execCommand("copy");

    textarea.remove();
  }
}
