import { state } from "./state.js";

import { getCategoryIcon } from "./filters.js";

import {
  normalizeCategories,
  normalizeImageUrl,
  sanitizeAnimationName,
  formatCategoryLabel,
  escapeAttribute,
  escapeHtml,
} from "./utils.js";

import {
  createAnimation,
  findAnimation,
  updateAnimation,
} from "./animations.js";

export function initializeEditor({ modalController, render, showToast }) {
  const AVAILABLE_CATEGORIES = [
    "image",
    "photo",
    "text",
    "scale",
    "rotate",
    "slide",
    "fade",
    "3d",
    "spring",
    "magnetic",
    "elastic",
    "timeline",
    "scroll",
    "parallax",
  ];

  const form = document.getElementById("animationForm");

  const title = document.getElementById("editorModalTitle");

  const description = document.getElementById("editorModalDescription");

  const eyebrow = document.getElementById("editorEyebrow");

  const saveButton = document.getElementById("saveAnimationButton");

  const categoryPicker = document.getElementById("categoryPicker");

  const imageUrlInput = form.elements.imageUrl;

  const imagePreview = document.getElementById("imageUrlPreview");

  const imagePreviewImage = document.getElementById("imageUrlPreviewImage");

  const deviceSelector = document.getElementById("deviceSelector");

  const deviceInput = form.elements.device;

  /*
   * ==================================================
   * OPEN EDITOR
   * ==================================================
   */

  function openEditor(id = null) {
    state.editingId = id;

    form.reset();

    if (id) {
      const animation = findAnimation(id);

      if (!animation) {
        return;
      }

      eyebrow.textContent = "EDIT";

      title.textContent = "Edit animation";

      description.textContent =
        "Edit the animation without losing your work if the modal is accidentally closed.";

      saveButton.innerHTML = `
        <i class="fa-solid fa-check"></i>
        Save changes
      `;

      const draft = state.editorDrafts.get(id);

      fillForm(draft || animation);
    } else {
      eyebrow.textContent = "CREATE";

      title.textContent = "New animation";

      description.textContent = "Create a reusable animation preset.";

      saveButton.innerHTML = `
        <i class="fa-solid fa-plus"></i>
        Add animation
      `;

      const draft = state.editorDrafts.get("__new__");

      if (draft) {
        fillForm(draft);
      } else {
        setDefaultValues();
      }
    }

    renderCategoryPicker();

    modalController.openEditor();

    updateImagePreview(form.elements.imageUrl.value);

    requestAnimationFrame(() => {
      form.elements.name.focus();
    });
  }

  /*
   * ==================================================
   * FILL FORM
   * ==================================================
   */

  function fillForm(data) {
    form.elements.name.value = data.name || "";

    form.elements.target.value = data.target || "div";

    form.elements.description.value = data.description || "";

    form.elements.interaction.value = data.interaction || "appear";

    form.elements.animationName.value = data.animationName || "";

    form.elements.css.value = data.css || "";

    form.elements.keyframes.value = data.keyframes || "";

    form.elements.parent.value = data.parent || "";

    form.elements.imageUrl.value = normalizeImageUrl(data.imageUrl || "");

    setDevice(data.device || "desktop", false);

    renderCategoryPicker(normalizeCategories(data.categories));
  }

  /*
   * ==================================================
   * DEFAULT VALUES
   * ==================================================
   */

  function setDefaultValues() {
    form.elements.name.value = "";

    form.elements.target.value = "div";

    form.elements.description.value = "";

    form.elements.interaction.value = "appear";

    form.elements.animationName.value = "";

    form.elements.css.value = "";

    form.elements.keyframes.value = "";

    form.elements.parent.value = "";

    form.elements.imageUrl.value = "";

    setDevice("desktop", false);

    renderCategoryPicker([]);
  }

  /*
   * ==================================================
   * DEVICE SELECTOR
   * ==================================================
   */

  function setDevice(device, save = true) {
    if (!["desktop", "mobile", "both"].includes(device)) {
      device = "desktop";
    }

    deviceInput.value = device;

    deviceSelector.querySelectorAll("[data-device]").forEach((button) => {
      button.classList.toggle("active", button.dataset.device === device);
    });

    if (save) {
      saveDraft();
    }
  }

  /*
   * ==================================================
   * SELECTED CATEGORIES
   * ==================================================
   */

  function getSelectedCategories() {
    return [...categoryPicker.querySelectorAll("[data-category].active")].map(
      (button) => button.dataset.category,
    );
  }

  /*
   * ==================================================
   * CATEGORY PICKER
   * ==================================================
   */

  function renderCategoryPicker(selectedOverride = null) {
    const selected = new Set(selectedOverride ?? getSelectedCategories());

    categoryPicker.innerHTML = "";

    /*
     * The categoryPicker is the outer
     * container.
     *
     * category-multi-select is the
     * actual CSS grid.
     */

    const wrapper = document.createElement("div");

    wrapper.className = "category-multi-select";

    AVAILABLE_CATEGORIES.forEach((category) => {
      const button = document.createElement("button");

      button.type = "button";

      button.className = "category-chip";

      button.dataset.category = category;

      button.classList.toggle("active", selected.has(category));

      button.innerHTML = `
          <i class="${escapeAttribute(getCategoryIcon(category))}"></i>

          <span>
            ${escapeHtml(formatCategoryLabel(category))}
          </span>

          <i class="fa-solid fa-check category-check"></i>
        `;

      button.addEventListener("click", () => {
        button.classList.toggle("active");

        saveDraft();
      });

      wrapper.appendChild(button);
    });

    categoryPicker.appendChild(wrapper);
  }

  /*
   * ==================================================
   * FORM DATA
   * ==================================================
   */

  function getFormData() {
    const data = Object.fromEntries(new FormData(form).entries());

    data.categories = getSelectedCategories();

    data.imageUrl = normalizeImageUrl(data.imageUrl);

    return data;
  }

  /*
   * ==================================================
   * SAVE DRAFT
   * ==================================================
   */

  function saveDraft() {
    const key = state.editingId || "__new__";

    state.editorDrafts.set(key, getFormData());
  }

  /*
   * ==================================================
   * CLEAR DRAFT
   * ==================================================
   */

  function clearDraft() {
    const key = state.editingId || "__new__";

    state.editorDrafts.delete(key);
  }

  /*
   * ==================================================
   * SUBMIT
   * ==================================================
   */

  function submit(event) {
    event.preventDefault();

    const data = getFormData();

    const name = data.name.trim();

    const animationName = data.animationName.trim();

    if (!name) {
      showToast(
        "Animation name is required.",
        "fa-solid fa-triangle-exclamation",
      );

      return;
    }

    if (!animationName) {
      showToast(
        "Animation keyframe name is required.",
        "fa-solid fa-triangle-exclamation",
      );

      return;
    }

    data.animationName = sanitizeAnimationName(animationName);

    if (state.editingId) {
      updateAnimation(state.editingId, data);

      clearDraft();

      showToast("Animation updated.", "fa-solid fa-check");
    } else {
      createAnimation(data);

      clearDraft();

      showToast("Animation added.", "fa-solid fa-check");
    }

    modalController.closeAll();

    render();

    state.editingId = null;
  }

  /*
   * ==================================================
   * IMAGE PREVIEW
   * ==================================================
   *
   * The Test Image button is gone.
   *
   * The preview updates automatically
   * whenever the URL changes.
   */

  function updateImagePreview(value) {
    const url = normalizeImageUrl(value);

    if (!url) {
      imagePreview.hidden = true;

      imagePreviewImage.removeAttribute("src");

      imagePreview.classList.remove("error");

      return;
    }

    imagePreview.hidden = false;

    imagePreview.classList.remove("error");

    imagePreviewImage.src = url;

    imagePreviewImage.onerror = () => {
      imagePreview.classList.add("error");
    };

    imagePreviewImage.onload = () => {
      imagePreview.classList.remove("error");
    };
  }

  /*
   * ==================================================
   * FORM EVENTS
   * ==================================================
   */

  form.addEventListener("submit", submit);

  form.addEventListener("input", saveDraft);

  form.addEventListener("change", saveDraft);

  /*
   * ==================================================
   * DEVICE EVENTS
   * ==================================================
   */

  deviceSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-device]");

    if (!button) {
      return;
    }

    setDevice(button.dataset.device);
  });

  /*
   * ==================================================
   * IMAGE URL EVENTS
   * ==================================================
   */

  imageUrlInput.addEventListener("input", () => {
    updateImagePreview(imageUrlInput.value);

    saveDraft();
  });

  /*
   * ==================================================
   * PUBLIC API
   * ==================================================
   */

  return {
    openEditor,
  };
}
