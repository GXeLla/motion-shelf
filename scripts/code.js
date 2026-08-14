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
