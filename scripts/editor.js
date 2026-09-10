import { state } from "./state.js";
import { getCategoryIcon } from "./filters.js";
import {
  escapeAttribute,
  escapeHtml,
  formatCategoryLabel,
  normalizeCategories,
  getScopedClassName,
  sanitizeAnimationName,
} from "./utils.js";
import {
  applyPreviewBackdrop,
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
  EASING_GROUPS,
  isBezierEasing,
  sampleEasing,
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
  const deviceSelector = document.getElementById("deviceSelector");
  const deviceInput = form.elements.device;
  const errorSummary = document.getElementById("formErrorSummary");
  const easingSelect = document.getElementById("easingSelect");
  const resolvedEasingValue = document.getElementById("resolvedEasingValue");
  const liveParent = document.getElementById("editorLiveParent");
  const liveImage = document.getElementById("editorLiveImage");
  const liveStage = document.getElementById("editorLiveStage");
  const liveSection = document.querySelector(".editor-workspace .editor-live-section");
  const editorModal = document.querySelector("#editorModalBackdrop .editor-modal");
  const classPreview = document.getElementById("editorClassPreview");
  const templateValues = document.getElementById("templateValues");
  const easingRunner = document.getElementById("easingRunner");
  const bezierCurve = document.getElementById("bezierCurve");
  const bezierGuideOne = document.getElementById("bezierGuideOne");
  const bezierGuideTwo = document.getElementById("bezierGuideTwo");
  const bezierHandleOne = document.getElementById("bezierHandleOne");
  const bezierHandleTwo = document.getElementById("bezierHandleTwo");
  const bezierGraph = document.getElementById("bezierGraph");
  let previewFrame = 0;
  let previewStickyStart = 0;
  let previewIsCompact = false;

  // Measure the stage, not the animated image's transformed bounding box.
  // Definite pixel dimensions avoid percentage-height/grid intrinsic sizing loops.
  function fitPreviewImage() {
    if (!liveStage.clientWidth || !liveStage.clientHeight) return;
    const width = liveImage.naturalWidth || 3;
    const height = liveImage.naturalHeight || 2;
    const scale = Math.min(1, Math.min(360, liveStage.clientWidth * 0.65) / width,
      liveStage.clientHeight * 0.65 / height);
    liveStage.style.setProperty("--preview-image-width", `${width * scale}px`);
    liveStage.style.setProperty("--preview-image-height", `${height * scale}px`);
  }

  liveImage.addEventListener("load", fitPreviewImage);
  const stageResizeObserver = new ResizeObserver(fitPreviewImage);
  stageResizeObserver.observe(liveStage);

  easingSelect.innerHTML = EASING_GROUPS.map(group =>
    `<optgroup label="${escapeAttribute(group.label)}">${group.options.map(
      ([value, label]) => `<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`,
    ).join("")}</optgroup>`,
  ).join("");

  const easingLibrary = document.getElementById("easingLibrary");
  const easingDirection = document.getElementById("easingDirection");
  const easingFamily = document.getElementById("easingFamily");
  const easingPower = document.getElementById("easingPower");
  let selectedDirection = "out";
  let selectedPower = "1";
  const cssDirections = { default: "ease", in: "ease-in", out: "ease-out", inOut: "ease-in-out" };
  easingFamily.innerHTML = `<optgroup label="CSS">${EASING_GROUPS[0].options.filter(([value]) => !value.startsWith("ease-")).map(([value, label]) =>
    `<option value="${escapeAttribute(value)}">${escapeHtml(label.replace("CSS · ", ""))}</option>`).join("")}</optgroup>
    <optgroup label="GSAP-style">${["power", "sine", "expo", "circ", "back", "bounce", "elastic"].map(family =>
      `<option value="${family}">${family[0].toUpperCase() + family.slice(1)}</option>`).join("")}</optgroup>
    <option value="custom">Custom cubic-bezier</option>`;
  easingFamily.addEventListener("change", () => {
    const family = easingFamily.value;
    easingSelect.value = family === "ease" ? cssDirections[selectedDirection]
      : family === "power" ? `power${selectedPower}.${selectedDirection}`
      : ["sine", "expo", "circ", "back", "bounce", "elastic"].includes(family) ? `${family}.${selectedDirection}` : family;
    easingSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  easingPower.addEventListener("click", event => {
    const button = event.target.closest("[data-power]");
    if (!button) return;
    easingSelect.value = `power${button.dataset.power}.${selectedDirection}`;
    easingSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const easingHelp = document.getElementById("easingHelp");
  function easingPath(value, width = 80, height = 32) {
    return Array.from({ length: 101 }, (_, index) => {
      const x = index / 100;
      return `${index ? "L" : "M"}${(x * width).toFixed(2)},${(height * (1.25 - sampleEasing(value, x)) / 1.5).toFixed(2)}`;
    }).join(" ");
  }
  const familyOptions = EASING_GROUPS.filter(group => group.label.startsWith("GSAP-style"))
    .map(group => {
      const family = group.options[0][0].split(".")[0];
      return [`${family}.out`, family];
    });
  const libraryGroups = [EASING_GROUPS[0], {label: "GSAP-style families", options: familyOptions}, EASING_GROUPS.at(-1)];
  easingLibrary.innerHTML = libraryGroups.map(group =>
    `<section class="easing-family"><h4>${escapeHtml(group.label)}</h4><div>${group.options.map(([value, label]) =>
      `<button type="button" data-ease="${escapeAttribute(value)}" ${group.label === "GSAP-style families" ? `data-family="${escapeAttribute(label)}"` : ""} aria-pressed="false"><svg viewBox="0 0 80 32" aria-hidden="true"><path d="${easingPath(value)}" /></svg><span>${escapeHtml(label.replace("CSS · ", ""))}</span></button>`,
    ).join("")}</div></section>`,
  ).join("");
  easingLibrary.addEventListener("click", event => {
    const button = event.target.closest("[data-ease]");
    if (!button) return;
    easingSelect.value = button.dataset.ease;
    easingSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  easingDirection.addEventListener("click", event => {
    const button = event.target.closest("[data-direction]");
    const family = easingSelect.value.match(/^(power[1-4]|sine|expo|circ|back|bounce|elastic)\.(in|out|inOut)$/)?.[1];
    if (!button || button.disabled) return;
    if (Object.values(cssDirections).includes(easingSelect.value)) {
      easingSelect.value = cssDirections[button.dataset.direction];
    } else if (family && button.dataset.direction !== "default") {
      easingSelect.value = `${family}.${button.dataset.direction}`;
    } else return;
    easingSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  setupBezierEditor();
  setupCssAutocomplete(form.elements.css);
  setupCssAutocomplete(form.elements.parent);

  function openEditor(id = null) {
    state.editingId = id;
    previewIsCompact = false;
    liveSection.classList.remove("is-sticky");
    form.reset();
    document.querySelector(".easing-library").open = false;
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
    syncBezierFromSelection();
    updateLivePreview();
    requestAnimationFrame(() => {
      previewStickyStart = editorModal.scrollTop + liveSection.getBoundingClientRect().top - editorModal.getBoundingClientRect().top;
      syncPreviewStickiness();
    });
  }

  /*
   * Imported animations expose their adjustable values as --ms-* custom
   * properties in the class body. Editing them here rewrites that
   * declaration, which the live preview already reacts to, so a template can
   * be retuned without rewriting its keyframes.
   */
  const VALUE_LABELS = {
    "--ms-distance": "Distance", "--ms-x": "Distance X", "--ms-y": "Distance Y",
    "--ms-z": "Distance Z", "--ms-scale": "Scale", "--ms-scale-x": "Scale X",
    "--ms-scale-y": "Scale Y", "--ms-rotation": "Rotation",
    "--ms-rotation-x": "Rotation X", "--ms-rotation-y": "Rotation Y",
    "--ms-skew-x": "Skew X", "--ms-skew-y": "Skew Y", "--ms-opacity": "Opacity",
    "--ms-duration": "Duration", "--ms-delay": "Delay", "--ms-ease": "Easing",
    "--ms-origin": "Transform origin", "--ms-perspective": "Perspective",
  };

  function readTemplateValues() {
    const found = [];

    String(form.elements.css.value || "")
      .split(";")
      .forEach((declaration) => {
        const separator = declaration.indexOf(":");
        if (separator < 1) return;

        const name = declaration.slice(0, separator).trim();
        const value = declaration.slice(separator + 1).trim();
        if (!/^--ms-[\w-]+$/.test(name) || !value) return;

        found.push({ name, value });
      });

    return found;
  }

  function writeTemplateValue(name, value) {
    const pattern = new RegExp("(^|\\n)\\s*" + name + "\\s*:[^;]*;?", "m");
    const declaration = name + ": " + value + ";";

    form.elements.css.value = pattern.test(form.elements.css.value)
      ? form.elements.css.value.replace(pattern, "$1" + declaration)
      : declaration + "\n" + form.elements.css.value;

    saveDraft();
    updateLivePreview();
  }

  function renderTemplateValues() {
    const values = readTemplateValues();
    templateValues.hidden = values.length === 0;

    if (!values.length) {
      templateValues.innerHTML = "";
      return;
    }

    templateValues.innerHTML = '<span class="template-values-title">Adjustable values</span>'
      + values.map((entry) => (
        '<label class="template-value">'
        + "<span>" + escapeHtml(VALUE_LABELS[entry.name] || entry.name.replace("--ms-", "")) + "</span>"
        + '<input type="text" spellcheck="false" data-template-value="'
        + escapeAttribute(entry.name) + '" value="' + escapeAttribute(entry.value) + '" />'
        + "</label>"
      )).join("");
  }

  templateValues.addEventListener("input", (event) => {
    const input = event.target.closest("[data-template-value]");
    if (!input) return;

    event.stopPropagation();
    writeTemplateValue(input.dataset.templateValue, input.value.trim());
  });

  function fillForm(data) {
    form.elements.name.value = data.name || "";
    form.elements.target.value = data.target || "img";
    form.elements.description.value = data.description || "";
    form.elements.interaction.value = data.interaction || "appear";
    form.elements.animationName.value = data.animationName || "";
    form.elements.className.value = getScopedClassName(data.className, data.name);
    form.elements.duration.value = Number(data.duration) || 1.2;
    form.elements.durationUnit.value = data.durationUnit === "ms" ? "ms" : "s";
    form.elements.delay.value = Number(data.delay) || 0;
    form.elements.delayUnit.value = data.delayUnit === "ms" ? "ms" : "s";
    form.elements.iterationCount.value = data.iterationCount || "1";
    form.elements.easing.value = data.easing || "ease-in-out";
    form.elements.css.value = data.css || "";
    form.elements.keyframes.value = data.keyframes || "";
    form.elements.parent.value = data.parent || "";
    setBezierInputs(normalizeBezier(data.cubicBezier));
    setDevice(data.device || "desktop", false);
    renderCategoryPicker(normalizeCategories(data.categories));
    renderTemplateValues();
  }

  function setDefaultValues() {
    fillForm({
      name: "",
      target: "img",
      description: "",
      interaction: "infinite",
      animationName: "msFloat",
      className: "ms-floating-image",
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
    const className = getScopedClassName(data.className, data.name);
    const duplicateClass = state.animations.some((animation) => (
      animation.id !== state.editingId &&
      getScopedClassName(animation.className, animation.name) === className
    ));
    if (duplicateClass) {
      errors.className = "This class is already assigned to another animation.";
    }

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

  function updateLivePreview() {
    cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(() => {
      const data = getFormData();
      const keyframeName = sanitizeAnimationName(data.animationName || "msEditorPreview");
      const previewAnimation = { ...data, id: "editor-live", animationName: keyframeName };
      const scopedClassName = getScopedClassName(data.className, data.name);
      const cssIsValid = !validateDeclarations(data.css, { disallowAnimation: true });
      const parentIsValid = !validateDeclarations(data.parent);
      const keyframesAreValid = !validateKeyframes(data.keyframes, data.animationName || keyframeName);

      liveParent.style.cssText = "";
      liveImage.style.cssText = "";
      liveImage.className = scopedClassName;
      classPreview.textContent = `.${scopedClassName}`;
      /* Seeded from the animation being edited, so the editor shows the same
         character as its card. */
      const previewKey = {
        ...previewAnimation,
        id: state.editingId || "editor-live",
        name: data.name || "Live Preview",
      };

      liveImage.src = createPreviewImage(previewKey);
      applyPreviewBackdrop(liveStage, previewKey);

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
      updateEasingDisplay(data);
      const durationUnit = data.durationUnit === "ms" ? "ms" : "s";
      const delayUnit = data.delayUnit === "ms" ? "ms" : "s";

      liveImage.style.animation = "none";
      void liveImage.offsetWidth;
      liveImage.style.animation = `${keyframeName} ${duration}${durationUnit} ${easing} ${delay}${delayUnit} infinite`;
      resolvedEasingValue.textContent = easing.startsWith("linear(") ? `${data.easing} · CSS linear()` : easing;
      resolvedEasingValue.title = easing;
      easingRunner.style.animationTimingFunction = easing;
      easingRunner.style.animationDuration = `${Math.max(0.7, durationUnit === "ms" ? duration / 1000 : duration)}s`;
    });
  }

  function syncPreviewStickiness() {
    const scrollPosition = editorModal.scrollTop;
    const shouldCompact = previewIsCompact
      ? scrollPosition > previewStickyStart - 24
      : scrollPosition >= previewStickyStart;

    if (shouldCompact === previewIsCompact) return;

    previewIsCompact = shouldCompact;
    liveSection.classList.toggle("is-sticky", shouldCompact);
  }

  function updateEasingDisplay(data) {
    const directional = data.easing.match(/^(power[1-4]|sine|expo|circ|back|bounce|elastic)\.(in|out|inOut)$/);
    const cssDirection = Object.keys(cssDirections).find(direction => cssDirections[direction] === data.easing);
    if (directional) selectedDirection = directional[2];
    if (cssDirection && cssDirection !== "default") selectedDirection = cssDirection;
    const power = directional?.[1].match(/^power([1-4])$/);
    if (power) selectedPower = power[1];
    easingFamily.value = cssDirection ? "ease" : power ? "power" : directional ? directional[1]
      : data.easing === "none" ? "linear" : data.easing === "back.out(1.7)" ? "back" : data.easing;
    easingPower.hidden = !power;
    easingPower.querySelectorAll("[data-power]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.power === selectedPower));
    });
    easingDirection.querySelectorAll("[data-direction]").forEach(button => {
      button.hidden = button.dataset.direction === "default" && !cssDirection;
      button.disabled = !directional && !cssDirection;
      button.setAttribute("aria-pressed", String(Boolean(directional || cssDirection) && button.dataset.direction === (cssDirection || selectedDirection)));
    });
    document.getElementById("easingDirectionHelp").textContent = cssDirection
      ? "Default uses CSS ease · In accelerates · Out slows down · InOut does both."
      : directional
      ? "In accelerates · Out slows down · InOut does both."
      : "Choose Ease or a GSAP-style family to set its direction.";
    easingLibrary.querySelectorAll("[data-family]").forEach(button => {
      button.dataset.ease = `${button.dataset.family}.${selectedDirection}`;
      button.querySelector("path").setAttribute("d", easingPath(button.dataset.ease));
    });
    const editable = isBezierEasing(data.easing);
    document.getElementById("bezierEditor").classList.toggle("is-sampled", !editable);
    easingLibrary.querySelectorAll("[data-ease]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.ease === data.easing));
    });
    easingHelp.textContent = editable
      ? "Drag the handles or adjust the coordinates to create a custom Bézier curve."
      : "This curve is used by the live preview and exported CSS. Choose Custom cubic-bezier to draw your own curve.";
    if (editable) drawBezier(getEasingPoints(data.easing, data.cubicBezier));
    else {
      bezierCurve.setAttribute("d", Array.from({ length: 201 }, (_, index) => {
        const x = index / 200;
        const point = toGraphPoint(x, sampleEasing(data.easing, x));
        return `${index ? "L" : "M"}${point.x},${point.y}`;
      }).join(" "));
    }
    bezierGraph.querySelector("svg").setAttribute("aria-label", `Easing curve: ${data.easing}`);
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
  editorModal.addEventListener("scroll", syncPreviewStickiness, { passive: true });
  form.addEventListener("input", (event) => {
    clearErrors(event.target.name);
    if (event.target.name === "css") renderTemplateValues();
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
