import { state } from "./state.js";

import { loadAnimations, saveAnimations } from "./storage.js";

import { findAnimation, buildExportCSS } from "./animations.js";

import {
  getVisibleAnimations,
  initializeFilters,
  renderFilterButtons,
} from "./filters.js";

import { renderCards } from "./cards.js";

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
  normalizeImageUrl,
  formatDateTimeDDMMYY,
} from "./utils.js";

import {
  connectProject,
  getProjectDisplayPath,
  loadAnimationsFromProject,
  restoreProjectLink,
  supportsProjectFolders,
} from "./filesystem.js";

import { initializeAmbientBackground } from "./background.js";

/* ==================================================
DOM
================================================== */

const animationGrid = document.getElementById("animationGrid");

const emptyState = document.getElementById("emptyState");

const emptyNewButton = document.getElementById("emptyNewButton");

const resultCount = document.getElementById("resultCount");

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

render();

initializeProjectWorkspace();

/* ==================================================
MAIN RENDER
================================================== */

function render() {
  const visible = getVisibleAnimations();

  renderCards(animationGrid, visible);

  resultCount.textContent = `${visible.length} ${
    visible.length === 1 ? "animation" : "animations"
  }`;

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

async function initializeProjectWorkspace() {
  if (!supportsProjectFolders()) {
    state.projectPermission = "unsupported";
    updateWorkspaceUI();
    return;
  }

  state.projectBusy = true;
  updateWorkspaceUI();

  try {
    const handle = await restoreProjectLink();
    updateWorkspaceUI();

    if (handle) {
      const result = await loadAnimationsFromProject();
      render();

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
    if (state.selectionMode || event.target.closest("button, input, label, a")) {
      return;
    }

    const animation = findAnimation(id);
    if (!animation) return;
    await copyText(buildExportCSS(animation));
    target.classList.add("copied");
    setTimeout(() => target.classList.remove("copied"), 500);
    showToast(`${animation.name} CSS copied.`, "fa-solid fa-copy");
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

  render();
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

  const imageSrc =
    normalizeImageUrl(animation.imageUrl) || createSafePreview(animation);

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


    ${
      animation.imageUrl
        ? `
          <div
            class="image-url-display"
            style="
              margin: 20px 30px 0;
              color: var(--text-muted);
              font-size: 12px;
              word-break: break-all;
            "
          >
            <i class="fa-solid fa-image"></i>
            ${escapeHtml(animation.imageUrl)}
          </div>
        `
        : ""
    }


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

      <pre class="code-block">${escapeHtml(buildExportCSS(animation))}</pre>

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
          await copyText(buildExportCSS(animation));

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
  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="640"
      height="400"
    >
      <rect
        width="640"
        height="400"
        rx="30"
        fill="#111717"
      />

      <circle
        cx="320"
        cy="195"
        r="105"
        fill="url(#motionGradient)"
        opacity=".82"
      />

      <rect
        x="185"
        y="140"
        width="270"
        height="110"
        rx="22"
        fill="#f4f7f7"
        opacity=".92"
      />

      <text
        x="320"
        y="198"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Arial"
        font-size="23"
        font-weight="700"
        fill="#101313"
      >
        ${escapeHtml(animation.name)}
      </text>

      <text
        x="320"
        y="232"
        text-anchor="middle"
        font-family="Arial"
        font-size="13"
        fill="#526060"
      >
        Motion Shelf
      </text>
    </svg>
  `;

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
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
