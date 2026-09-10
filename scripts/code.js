import { state } from "./state.js";

import {
  findAnimation,
  buildExportCSS,
  getCodeFileName,
} from "./animations.js";

import { saveAnimations } from "./storage.js";

import {
  ensureProjectHandle,
  getAnimationsDirectory,
  getProjectDisplayPath,
  loadAnimationsFromProject,
  supportsProjectFolders,
} from "./filesystem.js";

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

    const animationsHandle = await getAnimationsDirectory({ create: true });

    const fileName = animation.codeFileName || getCodeFileName(animation);

    const fileHandle = await animationsHandle.getFileHandle(fileName, {
      create: true,
    });

    const writable = await fileHandle.createWritable();

    const exportedCss = buildExportCSS(animation);
    await writable.write(exportedCss);

    await writable.close();

    animation.codeFileName = fileName;

    animation.codeSynced = true;

    animation.localPresent = true;

    animation.localPath = getProjectDisplayPath(fileName);

    animation.source = "local";

    animation.rawCss = exportedCss;

    animation.lastCodePush = Date.now();

    saveAnimations(state.animations);

    await loadAnimationsFromProject();

    render();

    updateWorkspaceUI();

    showToast(`Saved locally in animations/${fileName}`, "fa-solid fa-folder-check");
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

  const manifestHandle = await animationsHandle.getFileHandle("manifest.json", { create: true });
  const writable = await manifestHandle.createWritable();

  await writable.write(JSON.stringify({ version: 1, files }, null, 2) + "\n");
  await writable.close();

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

    const animationsHandle = await getAnimationsDirectory({ create: true });

    let written = 0;
    const failures = [];

    for (const animation of animations) {
      const fileName = animation.codeFileName || getCodeFileName(animation);

      try {
        const fileHandle = await animationsHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        const exportedCss = buildExportCSS(animation);

        await writable.write(exportedCss);
        await writable.close();

        animation.codeFileName = fileName;
        animation.codeSynced = true;
        animation.localPresent = true;
        animation.repositoryPresent = true;
        animation.localPath = getProjectDisplayPath(fileName);
        animation.source = "local";
        animation.rawCss = exportedCss;
        animation.lastCodePush = Date.now();

        written += 1;
      } catch (error) {
        console.warn("Could not write " + fileName + ":", error);
        failures.push(animation.name);
      }

      /* Keep the interface alive while a large library is written. */
      if (written % 10 === 0) {
        onProgress({ written, total: animations.length });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const files = await writeAnimationsManifest(animationsHandle);

    saveAnimations(state.animations);
    await loadAnimationsFromProject();

    render();
    updateWorkspaceUI();

    if (failures.length) {
      showToast(
        written + " synced, " + failures.length + " could not be written.",
        "fa-solid fa-triangle-exclamation",
      );
    } else {
      showToast(
        written + " animation" + (written === 1 ? "" : "s") + " synced. Commit and push to share them.",
        "fa-solid fa-users",
      );
    }

    return { written, failures, manifest: files };
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

    const animationsHandle = await getAnimationsDirectory({ create: false });

    const failures = [];

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
          failures.push(animation.name);
        }
      }
    }

    if (failures.length) {
      showToast(
        "Some code files could not be deleted.",
        "fa-solid fa-triangle-exclamation",
      );

      return;
    }

    state.animations = state.animations.filter(
      (animation) => !ids.includes(animation.id),
    );

    saveAnimations(state.animations);

    closeAll();

    render();

    updateWorkspaceUI();

    showToast("Animations deleted locally and from code.", "fa-solid fa-trash");
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
