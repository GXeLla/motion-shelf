import { createDetailDraft, renderDetailAdjustments, setDetailValue } from "./detail-adjustments.js";
import { applyDeclarationBlock } from "./validation.js";
import { normalizeKeyframes, normalizePreviewViewportUnits, getPreviewDuration, getAnimationDelay, getResolvedEasing } from "./animations.js";
import { state } from "./state.js";

import {
  loadAnimations,
  saveAnimationBatch,
  saveAnimations,
  setStorageErrorHandler,
  storageErrorMessage,
  removeAnimationRecords,
} from "./storage.js";

import {
  buildAnimationClass,
  buildAnimationSections,
  buildKeyframes,
  buildParentClass,
  buildWholeAnimation,
} from "./animation-code.js";

import {
  findAnimation,
  applyPreviewBackdrop,
  createPreviewImage,
  describeAnimationSource,
  isCustomAnimation,
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
  deleteAnimationsFromCode,
  prepareCodeDeletion,
  copyText,
} from "./code.js";

import {
  escapeHtml,
  escapeAttribute,
  isTypingElement,
  formatDateTimeDDMMYY,
} from "./utils.js";

import { loadAnimationsFromRepository } from "./filesystem.js";

import { initializeAmbientBackground } from "./background.js";
import { initializeIcons } from "./icons.js";
import { confirmDelayedDeletion } from "./delete-countdown.js";

import { initializeSync } from "./sync-ui.js";
import {
  auditAnimationsAtRuntime,
  applyRuntimeAuditRecord,
  runtimeAuditSignature,
} from "./runtime-audit.js";

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

/* ==================================================
INITIALIZE
================================================== */

initializeAmbientBackground();
initializeIcons();

/* One tooltip element for the page; the cards only carry data-tooltip. */
initializeTooltips();

setStorageErrorHandler((error) => {
  showToast(storageErrorMessage(error), "icon-solid icon-triangle-exclamation");
});

state.animations = [];

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
});


const storedAnimationsReady = initializeStoredAnimations();
const repositoryReady = storedAnimationsReady.then(initializeRepositoryAnimations);

/* Custom/session animations never enter the source Sync pipeline. Analyze
   them independently once their stored and project-backed records are loaded,
   so their cards receive the same perceptual hints without inflating Sync. */
Promise.allSettled([repositoryReady]).then(auditCustomAnimations);

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
  variantsButton.dataset.tooltip = state.showAllVariants
    ? "Show the most-used variant in each group."
    : "Show every related animation variant.";

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

}

async function auditCustomAnimations() {
  const candidates = state.animations
    .filter((animation) => !animation.origin)
    .filter((animation) => !animation.auditSignature
      || animation.auditSignature !== runtimeAuditSignature(animation))
    .map((animation) => ({ animation, updatedAt: animation.updatedAt }));

  if (!candidates.length) return;

  try {
    const report = await auditAnimationsAtRuntime(candidates.map(({ animation }) => animation));

    /* Asked once instead of once per candidate: includes() walks the whole
       library each time, which at ten thousand animations is a scan per
       candidate rather than a lookup. */
    const stillInLibrary = new Set(state.animations);
    const applied = [];

    candidates.forEach(({ animation, updatedAt }, index) => {
      /* Do not overwrite a newer editor audit if this background pass began
         before the user saved changes to the same animation. */
      if (!stillInLibrary.has(animation) || animation.updatedAt !== updatedAt) return;
      applyRuntimeAuditRecord(animation, report.records[index], { quarantineBroken: false });
      applied.push(animation);
    });

    if (applied.length) {
      /* Only the records that actually took a verdict. saveAnimationBatch
         writes everything it is handed, with no change check of its own, so
         passing every candidate would rewrite the ones just skipped. */
      await saveAnimationBatch(applied);
      render();
    }
  } catch (error) {
    console.error("Could not analyze stored custom animation previews:", error);
  }
}

async function initializeStoredAnimations() {
  // Project folders are no longer reopened at startup. Keep their stored
  // records too, or previously saved custom animations would disappear.
  state.animations = await loadAnimations();
  render();
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

async function initializeRepositoryAnimations() {
  try {
    const animations = await loadAnimationsFromRepository();

    /* A skipped entry means the catalog lists a file the folder no longer
       has. The library still loads, but silence would let that rot. */
    if (animations.skipped?.length) {
      showToast(
        `${animations.skipped.length} animation${animations.skipped.length === 1 ? "" : "s"} listed in the catalog could not be loaded. Run Sync to rebuild it.`,
        "icon-solid icon-triangle-exclamation",
      );
    }

    render();
  } catch (error) {
    console.error("Could not load committed animations:", error);
    showToast("Could not load the committed animation catalog.", "icon-solid icon-triangle-exclamation");
  }
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
    /* The same builder the details modal's "Copy whole animation" uses, so a
       card click and that button can never hand out different code. */
    await copyText(buildWholeAnimation(animation));
    target.classList.add("copied");
    setTimeout(() => target.classList.remove("copied"), 500);
    showToast(`${animation.name} copied.`, "icon-solid icon-copy");
    return;
  }

  if (action === "favourite") {
    const animation = findAnimation(id);
    let saved;
    try { saved = toggleFavourite(id); }
    catch (error) {
      showToast(storageErrorMessage(error, "localStorage"), "icon-solid icon-triangle-exclamation");
      return;
    }

    showToast(
      saved
        ? `${animation?.name || "Animation"} saved to favourites.`
        : `${animation?.name || "Animation"} removed from favourites.`,
      saved ? "icon-solid icon-star" : "icon-regular icon-star",
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
    const animation = findAnimation(id);
    if (animation && isCustomAnimation(animation)) editor.openEditor(id);

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

let deletionInProgress = false;
async function scheduleDeletion(fromCode) {
  if (deletionInProgress || !state.selectedIds.size) return;
  deletionInProgress = true;
  const ids = [...state.selectedIds];
  try {
    // Obtain and validate the folder during the click's user activation.
    if (fromCode) await prepareCodeDeletion(ids);
    modalController.closeAll();
    const deleted = await confirmDelayedDeletion(ids.length, async () => {
      if (fromCode) return deleteAnimationsFromCode(ids, {
        showToast, render, closeAll: modalController.closeAll,
      });
      if (!await removeAnimationRecords(ids, { remember: true })) return false;
      const removed = new Set(ids);
      state.animations = state.animations.filter(a => !removed.has(a.id));
      render();
      showToast(`${ids.length} animation${ids.length === 1 ? "" : "s"} deleted locally.`, "icon-solid icon-trash");
      return true;
    });
    if (deleted) {
      ids.forEach(id => state.selectedIds.delete(id));
      state.selectionMode = false;
      render();
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast(error.message || "Could not delete animations.", "icon-solid icon-triangle-exclamation");
  } finally { deletionInProgress = false; }
}
document.getElementById("deleteLocalButton").addEventListener("click", () => scheduleDeletion(false));
document.getElementById("deleteCodeButton").addEventListener("click", () => scheduleDeletion(true));

/* ==================================================
DETAILS
================================================== */

function openDetails(id) {
  const animation = findAnimation(id);

  if (!animation) {
    return;
  }

  const source = describeAnimationSource(animation);

  modalController.closeAll();
  const draft = createDetailDraft(animation);

  const imageSrc = createSafePreview(animation);

  detailModalContent.innerHTML = `
<div class="modal-heading">

  <span class="eyebrow">
    <i class="icon-solid icon-wand-magic-sparkles"></i>
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
            <i class="icon-solid icon-hard-drive"></i>
            <span>Local source: ${escapeHtml(animation.localPath || animation.codeFileName || "animations")}</span>
          </div>`
        : ""
    }

  <div class="detail-meta">

    <span>
      <i class="icon-regular icon-calendar"></i>
      Created ${formatDateTimeDDMMYY(animation.createdAt)}
    </span>

    ${
      animation.updatedAt && animation.updatedAt !== animation.createdAt
        ? `
          <span>
            <i class="icon-regular icon-clock"></i>
            Updated ${formatDateTimeDDMMYY(animation.updatedAt)}
          </span>
        `
        : ""
    }

  </div>

</div>


    <div class="detail-preview">

      <div class="safe-frame" aria-hidden="true"><span>SAFE FRAME</span></div>

      <span class="live-animation-label">
        <span class="live-animation-dot"></span>
        LIVE PREVIEW
      </span>

      <div class="detail-preview-parent">
      <img
        src="${escapeAttribute(imageSrc)}"
        alt="${escapeAttribute(animation.name)}"
        id="detailPreviewImage"
      >
      </div>

    </div>



    <p class="detail-description">
      ${escapeHtml(
        animation.description || "This animation is ready to reuse.",
      )}
    </p>


    <div class="tag-list">

      ${buildDetailTags(animation)}

    </div>


    ${renderDetailAdjustments(draft)}

    ${buildAnimationSections(draft).map((section) => `
    <div class="code-section">

      <div class="code-section-heading">

        <h3>
          <i class="icon-solid ${section.key === "animation" ? "icon-tag" : section.key === "keyframes" ? "icon-timeline" : "icon-layer-group"}"></i>
          ${escapeHtml(section.label)}
        </h3>

        <button
          class="button secondary code-section-copy"
          type="button"
          data-copy-section="${escapeAttribute(section.key)}"
        >
          <i class="icon-solid icon-copy"></i>
          Copy
        </button>

      </div>

      <pre class="code-block" data-code-section="${escapeAttribute(section.key)}">${escapeHtml(section.code)}</pre>

    </div>`).join("")}


    <div class="detail-actions">

      <button
        class="button secondary"
        type="button"
        data-detail-action="copy"
      >
        <i class="icon-solid icon-copy"></i>
        Copy whole animation
      </button>


      ${isCustomAnimation(animation) ? `
        <button
          class="button secondary"
          type="button"
          data-detail-action="edit"
        >
          <i class="icon-solid icon-pen"></i>
          Edit local custom animation
        </button>
      ` : ""}

      <span class="code-synced detail-synced" data-tooltip="${escapeAttribute(source.tooltip)}">
        <i class="icon-solid ${escapeAttribute(source.icon)}"></i>
        ${escapeHtml(source.label)}
      </span>

    </div>
  `;

  const preview = document.getElementById("detailPreviewImage");

  applyPreviewBackdrop(
    detailModalContent.querySelector(".detail-preview"),
    animation,
  );

  const previewParent = detailModalContent.querySelector(".detail-preview-parent");
  const previewStyle = document.createElement("style");
  detailModalContent.append(previewStyle);
  // A private keyframe name prevents temporary values touching card previews.
  const previewName = "msDetailsTemporaryPreview";
  previewStyle.textContent = normalizePreviewViewportUnits(normalizeKeyframes(draft))
    .replace(/(@keyframes\s+)[\w-]+/g, `$1${previewName}`);

  function refreshDraftPreview() {
    previewParent.style.cssText = "";
    preview.style.cssText = "";
    applyDeclarationBlock(previewParent, draft.parent);
    applyDeclarationBlock(preview, draft.css);
    preview.style.animation = `${previewName} ${getPreviewDuration(draft)} ${getResolvedEasing(draft)} ${getAnimationDelay(draft)} ${draft.iterationCount || "1"} both`;
    preview.getAnimations().forEach(animation => { animation.currentTime = 0; });
    for (const section of buildAnimationSections(draft)) {
      const code = detailModalContent.querySelector(`[data-code-section="${section.key}"]`);
      if (code) code.textContent = section.code;
    }
  }
  refreshDraftPreview();

  detailModalContent.querySelector(".detail-adjustments").addEventListener("input", event => {
    const input = event.target.closest("[data-adjust-name]");
    if (!input) return;
    const valid = setDetailValue(draft, input.dataset.adjustScope, input.dataset.adjustName, input.value.trim());
    input.setAttribute("aria-invalid", String(!valid));
    detailModalContent.querySelector(".adjust-error").hidden = !detailModalContent.querySelector('[aria-invalid="true"]');
    if (!valid) return;
    detailModalContent.querySelector(".adjust-bezier").hidden = draft.easing !== "custom";
    refreshDraftPreview();
  });

  /* Each section copies only itself, from the same builder that rendered it --
     so what lands on the clipboard is character for character what is on the
     screen above the button. */
  const SECTION_COPY = {
    animation: { build: buildAnimationClass, label: "Animation class copied." },
    parent: { build: buildParentClass, label: "Parent class copied." },
    keyframes: { build: buildKeyframes, label: "Keyframes copied." },
  };

  detailModalContent
    .querySelectorAll("[data-copy-section]")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const section = SECTION_COPY[button.dataset.copySection];
        if (!section) return;

        await copyText(section.build(draft));

        button.classList.add("copied");
        setTimeout(() => button.classList.remove("copied"), 600);

        showToast(section.label, "icon-solid icon-copy");
      });
    });

  detailModalContent
    .querySelectorAll("[data-detail-action]")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.detailAction;

        if (action === "copy") {
          await copyText(buildWholeAnimation(draft));

          showToast("Whole animation copied.", "icon-solid icon-copy");

          return;
        }

        if (action === "edit" && isCustomAnimation(animation)) {
          modalController.closeAll();

          editor.openEditor(id);

          return;
        }
      });
    });

  modalController.openDetail();
  state.detailId = id;
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
        <i class="icon-solid icon-hard-drive"></i>
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
        <i class="icon-solid icon-desktop"></i>
        Desktop
      </span>
    `);
  }

  if (animation.device === "mobile" || animation.device === "both") {
    tags.push(`
      <span class="tag mobile ${
        selectedFilters.includes("mobile") ? "filter-match" : ""
      }">
        <i class="icon-solid icon-mobile-screen"></i>
        Mobile
      </span>
    `);
  }

  /*
   * INTERACTION
   */

  if (animation.interaction && animation.interaction !== "static") {
    tags.push(`
      <span class="tag interaction-${escapeAttribute(animation.interaction)} ${
        selectedFilters.includes(animation.interaction) ? "filter-match" : ""
      }">
        <i class="${
          animation.interaction === "hover"
            ? "icon-solid icon-hand-pointer"
            : animation.interaction === "infinite"
              ? "icon-solid icon-infinity"
              : animation.interaction === "appear"
                ? "icon-solid icon-eye"
                : "icon-solid icon-eye-slash"
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
          <i class="icon-solid icon-tag"></i>
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

function showToast(message, icon = "icon-solid icon-check") {
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
