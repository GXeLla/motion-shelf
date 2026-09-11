import { state } from "./state.js";

import { loadAnimations, saveAnimations } from "./storage.js";

import {
  findAnimation,
  buildCopyCSS,
  applyPreviewBackdrop,
  createPreviewImage,
} from "./animations.js";

import {
  getVisibleAnimations,
  initializeFilters,
  renderFilterButtons,
  areVariantsCollapsed,
  isAllView,
  isQuarantinedAnimation,
} from "./filters.js";

import {
  renderCards,
  refreshCardFavourite,
  refreshCardSelection,
} from "./cards.js";

import { toggleFavourite } from "./favourites.js";

import { initializeTooltips } from "./tooltip.js";

import { createModalController } from "./modals.js";

import { initializeEditor } from "./editor.js";

import {
  pushAnimationToCode,
  deleteAnimationsFromCode,
  copyText,
} from "./code.js";

import {
  escapeHtml,
  escapeAttribute,
  isTypingElement,
  formatDateTimeDDMMYY,
} from "./utils.js";

import {
  connectProject,
  getProjectDisplayPath,
  loadAnimationsFromProject,
  loadAnimationsFromRepository,
  restoreProjectLink,
  supportsProjectFolders,
} from "./filesystem.js";

import { initializeAmbientBackground } from "./background.js";

import { initializeSync } from "./sync-ui.js";
import { auditAnimationsAtRuntime, applyRuntimeAuditRecord } from "./runtime-audit.js";

/* ==================================================
DOM
================================================== */

const animationGrid = document.getElementById("animationGrid");

const emptyState = document.getElementById("emptyState");

const emptyNewButton = document.getElementById("emptyNewButton");

const resultCount = document.getElementById("resultCount");
const variantsButton = document.getElementById("variantsButton");
variantsButton.addEventListener("click", () => {
  state.showAllVariants = !state.showAllVariants;
  render();
});

const searchInput = document.getElementById("searchInput");

const filterList = document.getElementById("filterList");

const newAnimationButton = document.getElementById("newAnimationButton");

const selectModeButton = document.getElementById("selectModeButton");

const selectionBar = document.getElementById("selectionBar");

const selectedCount = document.getElementById("selectedCount");

const cancelSelectionButton = document.getElementById("cancelSelectionButton");

const deleteSelectedButton = document.getElementById("deleteSelectedButton");

const detailModalContent = document.getElementById("detailModalContent");

const deleteModalDescription = document.getElementById(
  "deleteModalDescription",
);

const toast = document.getElementById("toast");

const toastIcon = document.getElementById("toastIcon");

const toastText = document.getElementById("toastText");

const projectLink = document.getElementById("projectLink");

const projectLinkButton = document.getElementById("projectLinkButton");

const projectChangeButton = document.getElementById("projectChangeButton");

const projectLinkTitle = document.getElementById("projectLinkTitle");

const projectLinkPath = document.getElementById("projectLinkPath");

/* ==================================================
INITIALIZE
================================================== */

initializeAmbientBackground();

/* One tooltip element for the page; the cards only carry data-tooltip. */
initializeTooltips();

state.animations = loadAnimations().filter(
  (animation) => !animation.localPresent && animation.source !== "local",
).map((animation) => ({ ...animation, codeSynced: false }));

const modalController = createModalController();

const editor = initializeEditor({
  modalController,
  render,
  showToast,
});

initializeFilters({
  filterList,
  searchInput,
  render,
});

initializeSync({
  render,
  showToast,
  updateWorkspaceUI,
});


const repositoryReady = initializeRepositoryAnimations();
const projectReady = initializeProjectWorkspace();

/* Custom/session animations never enter the source Sync pipeline. Analyze
   them independently once their stored and project-backed records are loaded,
   so their cards receive the same perceptual hints without inflating Sync. */
Promise.allSettled([repositoryReady, projectReady]).then(auditCustomAnimations);

/* ==================================================
MAIN RENDER
================================================== */

function render() {
  const visible = getVisibleAnimations();

  renderCards(animationGrid, visible);

  resultCount.textContent = `${visible.length} ${
    visible.length === 1 ? "animation" : "animations"
  }`;
  const usableCount = state.animations.filter((animation) => !isQuarantinedAnimation(animation)).length;
  const grouped = areVariantsCollapsed() ? usableCount - visible.length : 0;
  if (grouped) resultCount.textContent += ` · ${grouped} variants grouped`;
  variantsButton.hidden = !isAllView() || state.selectionMode || (!grouped && !state.showAllVariants);
  variantsButton.textContent = state.showAllVariants ? "Group variants" : "Show all variants";
  variantsButton.setAttribute("aria-pressed", String(state.showAllVariants));

  emptyState.hidden = visible.length !== 0;

  if (state.animations.length === 0) {
    emptyState.querySelector("h3").textContent = "No animations yet";

    emptyState.querySelector("p").textContent =
      "Create your first animation with the New button.";
  } else {
    emptyState.querySelector("h3").textContent = "No animations found";

    emptyState.querySelector("p").textContent = "Try another search or filter.";
  }

  updateSelectionUI();

  renderFilterButtons(filterList);

  updateWorkspaceUI();
}

async function auditCustomAnimations() {
  const candidates = state.animations
    .filter((animation) => !animation.origin)
    .map((animation) => ({ animation, updatedAt: animation.updatedAt }));

  if (!candidates.length) return;

  try {
    const report = await auditAnimationsAtRuntime(candidates.map(({ animation }) => animation));
    let changed = false;

    candidates.forEach(({ animation, updatedAt }, index) => {
      /* Do not overwrite a newer editor audit if this background pass began
         before the user saved changes to the same animation. */
      if (!state.animations.includes(animation) || animation.updatedAt !== updatedAt) return;
      applyRuntimeAuditRecord(animation, report.records[index], { quarantineBroken: false });
      changed = true;
    });

    if (changed) {
      saveAnimations(state.animations);
      render();
    }
  } catch (error) {
    console.error("Could not analyze stored custom animation previews:", error);
  }
}

/* ==================================================
HEADER
================================================== */

newAnimationButton.addEventListener("click", () => {
  editor.openEditor();
});

emptyNewButton.addEventListener("click", () => {
  editor.openEditor();
});

projectLinkButton.addEventListener("click", () => {
  runProjectLinkAction(false);
});

projectChangeButton.addEventListener("click", () => {
  runProjectLinkAction(true);
});

async function initializeRepositoryAnimations() {
  try {
    await loadAnimationsFromRepository();
    render();
  } catch (error) {
    console.error("Could not load committed animations:", error);
    showToast("Could not load the committed animation catalog.", "fa-solid fa-triangle-exclamation");
  }
}

async function initializeProjectWorkspace() {
  if (!supportsProjectFolders()) {
    state.projectPermission = "unsupported";
    updateWorkspaceUI();
    render();
    return;
  }

  state.projectBusy = true;
  updateWorkspaceUI();

  try {
    const handle = await restoreProjectLink();
    updateWorkspaceUI();

    if (handle) {
      const result = await loadAnimationsFromProject();

      if (result.errors.length) {
        showToast(
          `${result.errors.length} local CSS file${result.errors.length === 1 ? "" : "s"} could not be read.`,
          "fa-solid fa-triangle-exclamation",
        );
      }
    }
  } finally {
    state.projectBusy = false;
    updateWorkspaceUI();
    render();
  }
}

async function runProjectLinkAction(changeFolder) {
  if (state.projectBusy) return;
  state.projectBusy = true;
  updateWorkspaceUI();

  try {
    if (
      changeFolder ||
      !state.projectHandle ||
      state.projectPermission !== "granted"
    ) {
      await connectProject({ changeFolder });
    }

    const result = await loadAnimationsFromProject();
    render();
    showToast(
      `Linked ${getProjectDisplayPath()} · ${result.animations.length} animation${result.animations.length === 1 ? "" : "s"} loaded.`,
      "fa-solid fa-folder-check",
    );
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (error?.name === "NotAllowedError") {
      showToast("Folder permission was not granted.", "fa-solid fa-triangle-exclamation");
      return;
    }
    console.error("Project link failed:", error);
    showToast(error?.message || "Could not link the project folder.", "fa-solid fa-triangle-exclamation");
  } finally {
    state.projectBusy = false;
    updateWorkspaceUI();
  }
}

function updateWorkspaceUI() {
  projectLinkButton.disabled = state.projectBusy;
  projectChangeButton.disabled = state.projectBusy;

  if (state.projectBusy) {
    projectLink.dataset.status = "busy";
    projectLinkTitle.textContent = "Reading project";
    projectLinkPath.textContent = state.projectName
      ? `${state.projectName}/animations`
      : "Checking folder access…";
    projectLink.querySelector(".project-link-icon").innerHTML = '<i class="fa-solid fa-spinner"></i>';
    return;
  }

  if (state.projectPermission === "unsupported") {
    projectLink.dataset.status = "unsupported";
    projectLinkTitle.textContent = "Folder access unavailable";
    projectLinkPath.textContent = "Use Chrome or Edge on localhost";
    projectLink.querySelector(".project-link-icon").innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    projectChangeButton.hidden = true;
    return;
  }

  if (state.projectPermission === "granted" && state.projectHandle) {
    const localCount = state.animations.filter((animation) => animation.localPresent).length;
    projectLink.dataset.status = "linked";
    projectLinkTitle.textContent = "Project linked";
    projectLinkPath.textContent = `${getProjectDisplayPath()} · ${localCount} local`;
    projectLinkButton.title = "Refresh every CSS animation from the linked folder";
    projectLink.querySelector(".project-link-icon").innerHTML = '<i class="fa-solid fa-rotate"></i>';
    projectChangeButton.hidden = false;
    return;
  }

  if (state.projectHandle || state.projectName) {
    projectLink.dataset.status = "reconnect";
    projectLinkTitle.textContent = "Reconnect project";
    projectLinkPath.textContent = `${getProjectDisplayPath()} · click once to allow access`;
    projectLink.querySelector(".project-link-icon").innerHTML = '<i class="fa-solid fa-link-slash"></i>';
    projectChangeButton.hidden = false;
    return;
  }

  projectLink.dataset.status = "unlinked";
  projectLinkTitle.textContent = "Link project";
  projectLinkPath.textContent = "Choose the folder containing index.html";
  projectLink.querySelector(".project-link-icon").innerHTML = '<i class="fa-solid fa-link"></i>';
  projectChangeButton.hidden = true;
}

/* ==================================================
GRID
================================================== */

animationGrid.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");

  if (!target) {
    return;
  }

  const action = target.dataset.action;

  const id = target.dataset.id;

  if (!id) {
    return;
  }

  if (action === "copy") {
    if (event.target.closest("button, input, label, a")) {
      return;
    }

    if (state.selectionMode) {
      if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
      } else {
        state.selectedIds.add(id);
      }

      refreshCardSelection(animationGrid, id, state.selectedIds.has(id));
      updateSelectionUI();
      return;
    }

    const animation = findAnimation(id);
    if (!animation) return;
    await copyText(buildCopyCSS(animation));
    target.classList.add("copied");
    setTimeout(() => target.classList.remove("copied"), 500);
    showToast(`${animation.name} CSS copied.`, "fa-solid fa-copy");
    return;
  }

  if (action === "favourite") {
    const animation = findAnimation(id);
    const saved = toggleFavourite(id);

    showToast(
      saved
        ? `${animation?.name || "Animation"} saved to favourites.`
        : `${animation?.name || "Animation"} removed from favourites.`,
      saved ? "fa-solid fa-star" : "fa-regular fa-star",
    );

    /* Only when the Favourite filter is up does the star change which cards
       belong on screen; otherwise patch the one card and leave the rest of
       the grid, and its running previews, alone. */
    if (state.selectedFilters.includes("favourite") || areVariantsCollapsed()) {
      render();
    } else {
      refreshCardFavourite(animationGrid, id);
    }

    return;
  }

  if (action === "details") {
    openDetails(id);
    return;
  }

  if (action === "edit") {
    editor.openEditor(id);
    return;
  }

  if (action === "push") {
    await pushAnimationToCode(id, {
      showToast,
      render,
      updateWorkspaceUI,
    });

    return;
  }
});

/* ==================================================
SELECTION
================================================== */

selectModeButton.addEventListener("click", () => {
  state.selectionMode = !state.selectionMode;

  if (!state.selectionMode) {
    state.selectedIds.clear();
  }

  render();
});

cancelSelectionButton.addEventListener("click", () => {
  state.selectionMode = false;

  state.selectedIds.clear();

  render();
});

animationGrid.addEventListener("change", (event) => {
  const input = event.target.closest('input[data-action="select"]');

  if (!input) {
    return;
  }

  const id = input.dataset.id;

  if (input.checked) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  refreshCardSelection(animationGrid, id, input.checked);
  updateSelectionUI();
});

function updateSelectionUI() {
  selectionBar.hidden = !state.selectionMode;

  selectModeButton.classList.toggle("active", state.selectionMode);

  selectedCount.textContent = `${state.selectedIds.size} selected`;

  deleteSelectedButton.disabled = state.selectedIds.size === 0;
}

/* ==================================================
DELETE
================================================== */

deleteSelectedButton.addEventListener("click", () => {
  if (state.selectedIds.size === 0) {
    return;
  }

  deleteModalDescription.textContent = `You selected ${state.selectedIds.size} ${
    state.selectedIds.size === 1 ? "animation" : "animations"
  }. Choose where they should be removed from.`;

  modalController.openDelete();
});

document.getElementById("deleteLocalButton").addEventListener("click", () => {
  const ids = [...state.selectedIds];

  state.animations = state.animations.filter(
    (animation) => !ids.includes(animation.id),
  );

  saveAnimations(state.animations);

  state.selectedIds.clear();

  state.selectionMode = false;

  modalController.closeAll();

  render();

  showToast(
    `${ids.length} ${
      ids.length === 1 ? "animation" : "animations"
    } deleted locally.`,
    "fa-solid fa-trash",
  );
});

document
  .getElementById("deleteCodeButton")
  .addEventListener("click", async () => {
    const ids = [...state.selectedIds];

    await deleteAnimationsFromCode(ids, {
      showToast,
      render,
      closeAll: modalController.closeAll,
      updateWorkspaceUI,
    });

    state.selectedIds.clear();

    state.selectionMode = false;

    render();
  });

/* ==================================================
DETAILS
================================================== */

function openDetails(id) {
  const animation = findAnimation(id);

  if (!animation) {
    return;
  }

  state.detailId = id;

  const imageSrc = createSafePreview(animation);

  detailModalContent.innerHTML = `
<div class="modal-heading">

  <span class="eyebrow">
    <i class="fa-solid fa-wand-magic-sparkles"></i>
    ANIMATION
  </span>

  <h2 id="detailModalTitle">
    ${escapeHtml(animation.name)}
  </h2>

    <p>
      ${escapeHtml(animation.description || "Reusable CSS animation preset.")}
    </p>

    ${
      animation.localPresent
        ? `<div class="detail-local-source">
            <i class="fa-solid fa-hard-drive"></i>
            <span>Local source: ${escapeHtml(animation.localPath || animation.codeFileName || "animations")}</span>
          </div>`
        : ""
    }

  <div class="detail-meta">

    <span>
      <i class="fa-regular fa-calendar"></i>
      Created ${formatDateTimeDDMMYY(animation.createdAt)}
    </span>

    ${
      animation.updatedAt && animation.updatedAt !== animation.createdAt
        ? `
          <span>
            <i class="fa-regular fa-clock"></i>
            Updated ${formatDateTimeDDMMYY(animation.updatedAt)}
          </span>
        `
        : ""
    }

  </div>

</div>


    <div class="detail-preview">

      <span class="live-animation-label">
        <span class="live-animation-dot"></span>
        LIVE PREVIEW
      </span>

      <img
        src="${escapeAttribute(imageSrc)}"
        alt="${escapeAttribute(animation.name)}"
        id="detailPreviewImage"
      >

    </div>



    <p class="detail-description">
      ${escapeHtml(
        animation.description || "This animation is ready to reuse.",
      )}
    </p>


    <div class="tag-list">

      ${buildDetailTags(animation)}

    </div>


    <div class="code-section">

      <div class="code-section-heading">

        <h3>
          <i class="fa-brands fa-css3-alt"></i>
          CSS
        </h3>

      </div>

      <pre class="code-block">${escapeHtml(buildCopyCSS(animation))}</pre>

    </div>


    <div class="detail-actions">

      <button
        class="button secondary"
        type="button"
        data-detail-action="copy"
      >
        <i class="fa-solid fa-copy"></i>
        Copy CSS
      </button>


      <button
        class="button secondary"
        type="button"
        data-detail-action="edit"
      >
        <i class="fa-solid fa-pen"></i>
        Edit
      </button>


      ${
        animation.codeSynced
          ? `
            <span class="code-synced detail-synced">
              <i class="fa-solid fa-circle-check"></i>
              Local
            </span>
          `
          : `
            <button
              class="button primary"
              type="button"
              data-detail-action="push"
            >
              <i class="fa-solid fa-folder-arrow-up"></i>
              ${animation.localPresent ? "Update local" : "Push to local"}
            </button>
          `
      }

    </div>
  `;

  const preview = document.getElementById("detailPreviewImage");

  applyPreviewBackdrop(
    detailModalContent.querySelector(".detail-preview"),
    animation,
  );

  if (preview) {
    import("./animations.js").then(({ applyAnimation }) => {
      applyAnimation(preview, animation, {
        forceInfinite: true,
      });
    });
  }

  detailModalContent
    .querySelectorAll("[data-detail-action]")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.detailAction;

        if (action === "copy") {
          await copyText(buildCopyCSS(animation));

          showToast("CSS copied.", "fa-solid fa-copy");

          return;
        }

        if (action === "edit") {
          modalController.closeAll();

          editor.openEditor(id);

          return;
        }

        if (action === "push") {
          modalController.closeAll();

          await pushAnimationToCode(id, {
              showToast,
              render,
              updateWorkspaceUI,
          });
        }
      });
    });

  modalController.openDetail();
}

function createSafePreview(animation) {
  return createPreviewImage(animation);
}


function buildDetailTags(animation) {
  const tags = [];

  const selectedFilters = state.selectedFilters || [];

  if (animation.localPresent) {
    tags.push(`
      <span class="tag synced">
        <i class="fa-solid fa-hard-drive"></i>
        Local
      </span>
    `);
  }

  /*
   * DEVICE
   */

  if (animation.device === "desktop" || animation.device === "both") {
    tags.push(`
      <span class="tag desktop ${
        selectedFilters.includes("desktop") ? "filter-match" : ""
      }">
        <i class="fa-solid fa-desktop"></i>
        Desktop
      </span>
    `);
  }

  if (animation.device === "mobile" || animation.device === "both") {
    tags.push(`
      <span class="tag mobile ${
        selectedFilters.includes("mobile") ? "filter-match" : ""
      }">
        <i class="fa-solid fa-mobile-screen"></i>
        Mobile
      </span>
    `);
  }

  /*
   * INTERACTION
   */

  if (animation.interaction) {
    tags.push(`
      <span class="tag interaction-${escapeAttribute(animation.interaction)} ${
        selectedFilters.includes(animation.interaction) ? "filter-match" : ""
      }">
        <i class="${
          animation.interaction === "hover"
            ? "fa-solid fa-hand-pointer"
            : animation.interaction === "infinite"
              ? "fa-solid fa-infinity"
              : animation.interaction === "appear"
                ? "fa-solid fa-eye"
                : animation.interaction === "disappear"
                  ? "fa-solid fa-eye-slash"
                  : "fa-solid fa-pause"
        }"></i>
        ${escapeHtml(animation.interaction)}
      </span>
    `);
  }

  /*
   * CATEGORIES
   */

  if (animation.categories) {
    animation.categories.forEach((category) => {
      tags.push(`
        <span class="tag ${
          category === "3d" ? "d3" : `category-${escapeAttribute(category)}`
        } ${selectedFilters.includes(category) ? "filter-match" : ""}">
          <i class="fa-solid fa-tag"></i>
          ${category === "3d" ? "3D" : escapeHtml(category)}
        </span>
      `);
    });
  }

  return tags.join("");
}

/* ==================================================
TOAST
================================================== */

function showToast(message, icon = "fa-solid fa-check") {
  toastText.textContent = message;

  toastIcon.className = icon;

  toast.classList.remove("error");

  if (icon.includes("triangle-exclamation")) {
    toast.classList.add("error");
  }

  toast.classList.add("show");

  clearTimeout(state.toastTimer);

  state.toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

/* ==================================================
KEYBOARD
================================================== */

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !isTypingElement(document.activeElement)) {
    event.preventDefault();

    searchInput.focus();
  }
});
