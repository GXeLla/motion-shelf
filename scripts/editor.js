import { state } from "./state.js";
import { getCategoryIcon } from "./filters.js";
import {
  escapeAttribute,
  escapeHtml,
  formatCategoryLabel,
  normalizeCategories,
  normalizeImageUrl,
  sanitizeAnimationName,
} from "./utils.js";
import {
  createAnimation,
  createPreviewImage,
  findAnimation,
  normalizeKeyframes,
  updateAnimation,
} from "./animations.js";
import {
  applyDeclarationBlock,
  validateAnimationDraft,
  validateDeclarations,
  validateKeyframes,
} from "./validation.js";
import {
  EASING_OPTIONS,
  getEasingPoints,
  normalizeBezier,
  resolveEasing,
} from "./easing.js";

const AVAILABLE_CATEGORIES = [
  "image", "photo", "text", "scale", "rotate", "slide", "fade", "3d",
  "spring", "magnetic", "elastic", "timeline", "scroll", "parallax",
];

const CSS_SUGGESTIONS = [
  ["align-items", "center"], ["aspect-ratio", "16 / 9"], ["backface-visibility", "hidden"],
  ["background", "transparent"], ["background-color", "#142830"], ["background-image", "linear-gradient(135deg, #1f3a3a, #2a6f6f)"],
  ["background-position", "center"], ["background-size", "cover"], ["border", "1px solid rgba(255, 255, 255, .12)"],
  ["border-radius", "20px"], ["box-shadow", "0 18px 40px rgba(0, 0, 0, .28)"], ["clip-path", "inset(0 round 20px)"],
  ["display", "grid"], ["filter", "drop-shadow(0 18px 28px rgba(0, 0, 0, .3))"], ["height", "240px"],
  ["justify-content", "center"], ["mix-blend-mode", "screen"], ["object-fit", "cover"],
  ["opacity", "1"], ["overflow", "hidden"], ["perspective", "1000px"],
  ["position", "relative"], ["transform", "translate3d(0, 0, 0)"], ["transform-origin", "center center"],
  ["transform-style", "preserve-3d"], ["width", "240px"], ["will-change", "transform, opacity"],
];

export function initializeEditor({ modalController, render, showToast }) {
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
  const errorSummary = document.getElementById("formErrorSummary");
  const easingSelect = document.getElementById("easingSelect");
  const resolvedEasingValue = document.getElementById("resolvedEasingValue");
  const liveParent = document.getElementById("editorLiveParent");
  const liveImage = document.getElementById("editorLiveImage");
  const easingRunner = document.getElementById("easingRunner");
  const bezierCurve = document.getElementById("bezierCurve");
  const bezierGuideOne = document.getElementById("bezierGuideOne");
  const bezierGuideTwo = document.getElementById("bezierGuideTwo");
  const bezierHandleOne = document.getElementById("bezierHandleOne");
  const bezierHandleTwo = document.getElementById("bezierHandleTwo");
  const bezierGraph = document.getElementById("bezierGraph");
  let previewFrame = 0;

  easingSelect.innerHTML = EASING_OPTIONS.map(
    ([value, label]) => `<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`,
  ).join("");

  setupBezierEditor();
  setupCssAutocomplete(form.elements.css);
  setupCssAutocomplete(form.elements.parent);

  function openEditor(id = null) {
    state.editingId = id;
    form.reset();
    clearErrors();

    if (id) {
      const animation = findAnimation(id);
      if (!animation) return;
      eyebrow.textContent = "EDIT";
      title.textContent = "Edit animation";
      description.textContent = animation.localPresent
        ? `Editing ${animation.localPath || "the local CSS file"}. Save here, then update local when ready.`
        : "Edit the preset. Your unsaved draft stays available until refresh.";
      saveButton.innerHTML = '<i class="fa-solid fa-check"></i> Save changes';
      fillForm(state.editorDrafts.get(id) || animation);
    } else {
      eyebrow.textContent = "CREATE";
      title.textContent = "New animation";
      description.textContent = "Build global styles, animation timing and easing separately with a live infinite preview.";
      saveButton.innerHTML = '<i class="fa-solid fa-plus"></i> Add animation';
      const draft = state.editorDrafts.get("__new__");
      if (draft) fillForm(draft);
      else setDefaultValues();
    }

    modalController.openEditor();
    updateImagePreview(imageUrlInput.value);
    syncBezierFromSelection();
    updateLivePreview();
    requestAnimationFrame(() => form.elements.name.focus());
  }

  function fillForm(data) {
    form.elements.name.value = data.name || "";
    form.elements.target.value = data.target || "img";
    form.elements.description.value = data.description || "";
    form.elements.interaction.value = data.interaction || "appear";
    form.elements.animationName.value = data.animationName || "";
    form.elements.duration.value = Number(data.duration) || 1.2;
    form.elements.durationUnit.value = data.durationUnit === "ms" ? "ms" : "s";
    form.elements.delay.value = Number(data.delay) || 0;
    form.elements.delayUnit.value = data.delayUnit === "ms" ? "ms" : "s";
    form.elements.iterationCount.value = data.iterationCount || "1";
    form.elements.easing.value = data.easing || "ease-in-out";
    form.elements.css.value = data.css || "";
    form.elements.keyframes.value = data.keyframes || "";
    form.elements.parent.value = data.parent || "";
    form.elements.imageUrl.value = normalizeImageUrl(data.imageUrl || "");
    setBezierInputs(normalizeBezier(data.cubicBezier));
    setDevice(data.device || "desktop", false);
    renderCategoryPicker(normalizeCategories(data.categories));
  }

  function setDefaultValues() {
    fillForm({
      name: "",
      target: "img",
      description: "",
      interaction: "infinite",
      animationName: "msFloat",
      duration: 1.8,
      durationUnit: "s",
      delay: 0,
      delayUnit: "s",
      iterationCount: "infinite",
      easing: "ease-in-out",
      cubicBezier: [0.42, 0, 0.58, 1],
      css: "width: 260px;\nborder-radius: 24px;\nfilter: drop-shadow(0 20px 30px rgba(0, 0, 0, .3));\nwill-change: transform;",
      keyframes: "0%, 100% {\n  transform: translateY(0) rotate(-1deg);\n}\n\n50% {\n  transform: translateY(-22px) rotate(1deg);\n}",
      parent: "perspective: 1000px;\noverflow: visible;",
      imageUrl: "",
      device: "both",
      categories: ["image", "slide"],
    });
  }

  function setDevice(device, save = true) {
    const selected = ["desktop", "mobile", "both"].includes(device) ? device : "desktop";
    deviceInput.value = selected;
    deviceSelector.querySelectorAll("[data-device]").forEach((button) => {
      button.classList.toggle("active", button.dataset.device === selected);
    });
    if (save) saveDraft();
  }

  function getSelectedCategories() {
    return [...categoryPicker.querySelectorAll("[data-category].active")].map(
      (button) => button.dataset.category,
    );
  }

  function renderCategoryPicker(selectedOverride = []) {
    const selected = new Set(selectedOverride);
    categoryPicker.innerHTML = "";
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
        <span>${escapeHtml(formatCategoryLabel(category))}</span>
        <i class="fa-solid fa-check category-check"></i>`;
      button.addEventListener("click", () => {
        button.classList.toggle("active");
        saveDraft();
        updateLivePreview();
      });
      wrapper.appendChild(button);
    });
    categoryPicker.appendChild(wrapper);
  }

  function getFormData() {
    const data = Object.fromEntries(new FormData(form).entries());
    data.categories = getSelectedCategories();
    data.imageUrl = normalizeImageUrl(data.imageUrl);
    data.duration = Number(data.duration);
    data.delay = Number(data.delay);
    data.cubicBezier = normalizeBezier([
      data.bezierX1, data.bezierY1, data.bezierX2, data.bezierY2,
    ]);
    delete data.bezierX1;
    delete data.bezierY1;
    delete data.bezierX2;
    delete data.bezierY2;
    return data;
  }

  function saveDraft() {
    state.editorDrafts.set(state.editingId || "__new__", getFormData());
  }

  function clearDraft() {
    state.editorDrafts.delete(state.editingId || "__new__");
  }

  function submit(event) {
    event.preventDefault();
    const data = getFormData();
    const errors = validateAnimationDraft(data);

    if (Object.keys(errors).length) {
      showErrors(errors);
      showToast(`Fix ${Object.keys(errors).length} editor error${Object.keys(errors).length === 1 ? "" : "s"}.`, "fa-solid fa-triangle-exclamation");
      return;
    }

    data.animationName = sanitizeAnimationName(data.animationName);
    if (state.editingId) {
      updateAnimation(state.editingId, data);
      clearDraft();
      showToast("Animation updated. Push again to update the local CSS file.", "fa-solid fa-check");
    } else {
      createAnimation(data);
      clearDraft();
      showToast("Animation added. Click its card to copy CSS or push it to local.", "fa-solid fa-check");
    }

    modalController.closeAll();
    render();
    state.editingId = null;
  }

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
    imagePreviewImage.onerror = () => imagePreview.classList.add("error");
    imagePreviewImage.onload = () => imagePreview.classList.remove("error");
  }

  function updateLivePreview() {
    cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(() => {
      const data = getFormData();
      const keyframeName = sanitizeAnimationName(data.animationName || "msEditorPreview");
      const previewAnimation = { ...data, id: "editor-live", animationName: keyframeName };
      const cssIsValid = !validateDeclarations(data.css, { disallowAnimation: true });
      const parentIsValid = !validateDeclarations(data.parent);
      const keyframesAreValid = !validateKeyframes(data.keyframes, data.animationName || keyframeName);

      liveParent.style.cssText = "";
      liveImage.style.cssText = "";
      liveImage.src = data.imageUrl || createPreviewImage({ ...previewAnimation, name: data.name || "Live Preview" });
      liveImage.onerror = () => {
        liveImage.src = createPreviewImage({ ...previewAnimation, name: data.name || "Live Preview" });
      };

      if (parentIsValid) applyDeclarationBlock(liveParent, data.parent);
      if (cssIsValid) applyDeclarationBlock(liveImage, data.css);

      let style = document.getElementById("editor-live-keyframes");
      if (!style) {
        style = document.createElement("style");
        style.id = "editor-live-keyframes";
        document.head.appendChild(style);
      }
      if (keyframesAreValid) style.textContent = normalizeKeyframes(previewAnimation);

      const duration = Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 1.2;
      const delay = Number.isFinite(data.delay) ? data.delay : 0;
      const easing = resolveEasing(data.easing, data.cubicBezier);
      const durationUnit = data.durationUnit === "ms" ? "ms" : "s";
      const delayUnit = data.delayUnit === "ms" ? "ms" : "s";

      liveImage.style.animation = "none";
      void liveImage.offsetWidth;
      liveImage.style.animation = `${keyframeName} ${duration}${durationUnit} ${easing} ${delay}${delayUnit} infinite`;
      resolvedEasingValue.textContent = easing;
      easingRunner.style.animationTimingFunction = easing;
      easingRunner.style.animationDuration = `${Math.max(0.7, durationUnit === "ms" ? duration / 1000 : duration)}s`;
    });
  }

  function showErrors(errors) {
    clearErrors();
    const entries = Object.entries(errors);
    errorSummary.innerHTML = `<strong>Please fix these fields:</strong><ul>${entries
      .map(([, message]) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>`;
    errorSummary.hidden = false;

    entries.forEach(([field, message]) => {
      const input = form.elements[field];
      if (!input) return;
      input.classList.add("field-invalid");
      input.setAttribute("aria-invalid", "true");
      const container = input.closest("label") || input.parentElement;
      const fieldError = document.createElement("small");
      fieldError.className = "field-error";
      fieldError.dataset.fieldError = field;
      fieldError.textContent = message;
      container.appendChild(fieldError);
    });

    form.elements[entries[0]?.[0]]?.focus();
    errorSummary.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearErrors(field = "") {
    if (!field) {
      errorSummary.hidden = true;
      errorSummary.innerHTML = "";
      form.querySelectorAll(".field-error").forEach((element) => element.remove());
      form.querySelectorAll(".field-invalid").forEach((element) => {
        element.classList.remove("field-invalid");
        element.removeAttribute("aria-invalid");
      });
      return;
    }
    form.elements[field]?.classList.remove("field-invalid");
    form.elements[field]?.removeAttribute("aria-invalid");
    form.querySelector(`[data-field-error="${field}"]`)?.remove();
  }

  function setBezierInputs(points) {
    const [x1, y1, x2, y2] = normalizeBezier(points);
    form.elements.bezierX1.value = x1;
    form.elements.bezierY1.value = y1;
    form.elements.bezierX2.value = x2;
    form.elements.bezierY2.value = y2;
    drawBezier([x1, y1, x2, y2]);
  }

  function syncBezierFromSelection() {
    const easing = form.elements.easing.value || "ease-in-out";
    const custom = [
      form.elements.bezierX1.value, form.elements.bezierY1.value,
      form.elements.bezierX2.value, form.elements.bezierY2.value,
    ];
    setBezierInputs(getEasingPoints(easing, custom));
    updateLivePreview();
  }

  function drawBezier(points) {
    const [x1, y1, x2, y2] = normalizeBezier(points);
    const pointOne = toGraphPoint(x1, y1);
    const pointTwo = toGraphPoint(x2, y2);
    const start = { x: 24, y: 140 };
    const end = { x: 276, y: 60 };
    bezierCurve.setAttribute("d", `M ${start.x} ${start.y} C ${pointOne.x} ${pointOne.y}, ${pointTwo.x} ${pointTwo.y}, ${end.x} ${end.y}`);
    bezierGuideOne.setAttribute("d", `M ${start.x} ${start.y} L ${pointOne.x} ${pointOne.y}`);
    bezierGuideTwo.setAttribute("d", `M ${end.x} ${end.y} L ${pointTwo.x} ${pointTwo.y}`);
    bezierHandleOne.setAttribute("cx", pointOne.x);
    bezierHandleOne.setAttribute("cy", pointOne.y);
    bezierHandleTwo.setAttribute("cx", pointTwo.x);
    bezierHandleTwo.setAttribute("cy", pointTwo.y);
  }

  function setupBezierEditor() {
    ["bezierX1", "bezierY1", "bezierX2", "bezierY2"].forEach((name) => {
      form.elements[name].addEventListener("input", () => {
        form.elements.easing.value = "custom";
        setBezierInputs([
          form.elements.bezierX1.value, form.elements.bezierY1.value,
          form.elements.bezierX2.value, form.elements.bezierY2.value,
        ]);
        saveDraft();
        updateLivePreview();
      });
    });

    easingSelect.addEventListener("change", () => {
      syncBezierFromSelection();
      saveDraft();
    });

    [bezierHandleOne, bezierHandleTwo].forEach((handle, handleIndex) => {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const move = (moveEvent) => updateHandleFromPointer(moveEvent, handleIndex);
        const stop = () => {
          handle.removeEventListener("pointermove", move);
          saveDraft();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop, { once: true });
        handle.addEventListener("pointercancel", stop, { once: true });
      });

      handle.addEventListener("keydown", (event) => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        const names = handleIndex ? ["bezierX2", "bezierY2"] : ["bezierX1", "bezierY1"];
        const step = event.shiftKey ? 0.05 : 0.01;
        if (event.key === "ArrowLeft") form.elements[names[0]].value = Number(form.elements[names[0]].value) - step;
        if (event.key === "ArrowRight") form.elements[names[0]].value = Number(form.elements[names[0]].value) + step;
        if (event.key === "ArrowUp") form.elements[names[1]].value = Number(form.elements[names[1]].value) + step;
        if (event.key === "ArrowDown") form.elements[names[1]].value = Number(form.elements[names[1]].value) - step;
        form.elements.easing.value = "custom";
        setBezierInputs([
          form.elements.bezierX1.value, form.elements.bezierY1.value,
          form.elements.bezierX2.value, form.elements.bezierY2.value,
        ]);
        saveDraft();
        updateLivePreview();
      });
    });
  }

  function updateHandleFromPointer(event, handleIndex) {
    const svg = bezierGraph.querySelector("svg");
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 300;
    const y = ((event.clientY - box.top) / box.height) * 200;
    const xValue = clamp((x - 24) / 252, 0, 1);
    const yValue = clamp((140 - y) / 80, -0.5, 1.5);
    const names = handleIndex ? ["bezierX2", "bezierY2"] : ["bezierX1", "bezierY1"];
    form.elements[names[0]].value = Number(xValue.toFixed(3));
    form.elements[names[1]].value = Number(yValue.toFixed(3));
    form.elements.easing.value = "custom";
    setBezierInputs([
      form.elements.bezierX1.value, form.elements.bezierY1.value,
      form.elements.bezierX2.value, form.elements.bezierY2.value,
    ]);
    updateLivePreview();
  }

  function toGraphPoint(x, y) {
    return { x: Number((24 + x * 252).toFixed(2)), y: Number((140 - y * 80).toFixed(2)) };
  }

  function setupCssAutocomplete(textarea) {
    const box = document.createElement("div");
    box.className = "css-autocomplete";
    box.hidden = true;
    textarea.insertAdjacentElement("afterend", box);
    let activeIndex = 0;
    let matches = [];

    const update = () => {
      const prefix = getCssLinePrefix(textarea);
      matches = prefix && !prefix.includes(":")
        ? CSS_SUGGESTIONS.filter(([property]) => property.startsWith(prefix.toLowerCase())).slice(0, 8)
        : [];
      activeIndex = 0;
      box.hidden = !matches.length;
      box.innerHTML = matches.map(([property, sample], index) =>
        `<button type="button" data-suggestion="${escapeAttribute(property)}" class="${index === activeIndex ? "active" : ""}"><span>${escapeHtml(property)}</span><small>${escapeHtml(sample)}</small></button>`,
      ).join("");
    };

    const choose = (index) => {
      const suggestion = matches[index];
      if (!suggestion) return;
      insertCssSuggestion(textarea, `${suggestion[0]}: ${suggestion[1]};`);
      box.hidden = true;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };

    textarea.addEventListener("input", update);
    textarea.addEventListener("click", update);
    textarea.addEventListener("keydown", (event) => {
      if (box.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        box.querySelectorAll("button").forEach((button, index) => button.classList.toggle("active", index === activeIndex));
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        choose(activeIndex);
      }
      if (event.key === "Escape") box.hidden = true;
    });
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      const button = event.target.closest("[data-suggestion]");
      if (button) choose(matches.findIndex(([property]) => property === button.dataset.suggestion));
    });
    textarea.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 100));
  }

  form.addEventListener("submit", submit);
  form.addEventListener("input", (event) => {
    clearErrors(event.target.name);
    if (event.target === imageUrlInput) updateImagePreview(imageUrlInput.value);
    saveDraft();
    updateLivePreview();
  });
  form.addEventListener("change", () => {
    saveDraft();
    updateLivePreview();
  });
  deviceSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-device]");
    if (button) {
      setDevice(button.dataset.device);
      updateLivePreview();
    }
  });

  return { openEditor };
}

function getCssLinePrefix(textarea) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  return (before.split("\n").pop() || "").trim();
}

function insertCssSuggestion(textarea, replacement) {
  const start = textarea.selectionStart;
  const before = textarea.value.slice(0, start);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEndMatch = textarea.value.slice(start).search(/\n/);
  const lineEnd = lineEndMatch < 0 ? textarea.value.length : start + lineEndMatch;
  textarea.setRangeText(replacement, lineStart, lineEnd, "end");
  textarea.focus();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
