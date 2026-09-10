import { state } from "./state.js";

import {
  createId,
  slugify,
  getScopedClassName,
  sanitizeAnimationName,
  normalizeCategories,
  indentCSS,
} from "./utils.js";

import { saveAnimations } from "./storage.js";

import { normalizeBezier, resolveEasing } from "./easing.js";

import { createScenePreview, createSceneBackdrop } from "./preview-scene.js";

import { readWrappedVariables } from "./parameters.js";

export function findAnimation(id) {
  return state.animations.find((animation) => animation.id === id);
}

export function createAnimation(data) {
  const animation = {
    id: createId(),

    name: data.name.trim(),

    target: data.target || "div",

    description: data.description.trim(),

    device: data.device || "desktop",

    interaction: data.interaction || "appear",

    categories: normalizeCategories(data.categories),

    animationName: sanitizeAnimationName(data.animationName),

    className: getScopedClassName(data.className, data.name),

    duration: Number(data.duration) || 1.2,

    durationUnit: data.durationUnit === "ms" ? "ms" : "s",

    delay: Number(data.delay) || 0,

    delayUnit: data.delayUnit === "ms" ? "ms" : "s",

    easing: data.easing || "ease-in-out",

    cubicBezier: normalizeBezier(data.cubicBezier),

    iterationCount: data.iterationCount || (data.interaction === "infinite" ? "infinite" : "1"),

    css: data.css.trim(),

    keyframes: data.keyframes.trim(),

    parent: data.parent.trim(),

    /* What the animation says is adjustable about itself. Absent for one
       written by hand here, which is fine: the editor reads the declarations
       directly when there is no metadata to describe them. */
    parameters: data.parameters || null,

    codeFileName: null,

    codeSynced: false,

    localPresent: false,

    localPath: "",

    source: "session",

    createdAt: Date.now(),

    updatedAt: Date.now(),

    lastCodePush: null,
  };

  state.animations.unshift(animation);

  saveAnimations(state.animations);

  return animation;
}

export function updateAnimation(id, data) {
  const animation = findAnimation(id);

  if (!animation) {
    return null;
  }

  animation.name = data.name.trim();

  animation.target = data.target || "div";

  animation.description = data.description.trim();

  animation.device = data.device || "desktop";

  animation.interaction = data.interaction || "appear";

  animation.categories = normalizeCategories(data.categories);

  animation.animationName = sanitizeAnimationName(data.animationName);

  animation.className = getScopedClassName(data.className, data.name);

  animation.duration = Number(data.duration) || 1.2;

  animation.durationUnit = data.durationUnit === "ms" ? "ms" : "s";

  animation.delay = Number(data.delay) || 0;

  animation.delayUnit = data.delayUnit === "ms" ? "ms" : "s";

  animation.easing = data.easing || "ease-in-out";

  animation.cubicBezier = normalizeBezier(data.cubicBezier);

  animation.iterationCount = data.iterationCount || "1";

  animation.css = data.css.trim();

  animation.keyframes = data.keyframes.trim();

  animation.parent = data.parent.trim();

  /* An edit changes the values, not what the animation is capable of, so the
     description of its controls survives unless a new one is supplied. */
  if (data.parameters !== undefined) animation.parameters = data.parameters;

  animation.updatedAt = Date.now();

  /*
   * Existing generated code may now be stale.
   */
  if (animation.codeFileName || animation.codeSynced) {
    animation.codeSynced = false;
  }

  saveAnimations(state.animations);

  return animation;
}

export function deleteAnimations(ids) {
  const idSet = new Set(ids);

  state.animations = state.animations.filter(
    (animation) => !idSet.has(animation.id),
  );

  saveAnimations(state.animations);
}

export function getPreviewDuration(animation) {
  const value = Number(animation.duration);
  const duration = Number.isFinite(value) && value > 0 ? value : 1.2;
  const unit = animation.durationUnit === "ms" ? "ms" : "s";
  return `${duration}${unit}`;
}

export function getAnimationDelay(animation) {
  const value = Number(animation.delay);
  const delay = Number.isFinite(value) ? value : 0;
  const unit = animation.delayUnit === "ms" ? "ms" : "s";
  return `${delay}${unit}`;
}

export function getResolvedEasing(animation) {
  return resolveEasing(animation.easing || "ease-in-out", animation.cubicBezier);
}

export function normalizeKeyframes(animation) {
  const keyframes = String(animation.keyframes || "").trim();

  const animationName = sanitizeAnimationName(animation.animationName);

  if (!keyframes) {
    return `
  @keyframes ${animationName} {
    from {
      opacity: 0.35;
    }
  
    to {
      opacity: 1;
    }
  }
  `;
  }

  if (keyframes.includes("@keyframes")) {
    return keyframes;
  }

  return `
  @keyframes ${animationName} {
  ${keyframes}
  }
  `;
}

/*
 * ONE STYLESHEET FOR EVERY PREVIEW
 *
 * This used to append a <style> element per animation and rewrite its text on
 * every render -- a thousand stylesheets, each rewrite forcing a style
 * recalculation. Now every preview's keyframes live as rules in a single
 * sheet, inserted once and left alone: rendering the same card again costs a
 * Map lookup.
 */
let previewSheetElement = null;

const insertedKeyframes = new Map();

function previewStyleSheet() {
  if (!previewSheetElement || !previewSheetElement.isConnected) {
    previewSheetElement = document.createElement("style");

    previewSheetElement.id = "ms-preview-keyframes";

    document.head.appendChild(previewSheetElement);

    insertedKeyframes.clear();
  }

  return previewSheetElement;
}

/* An edited animation keeps its keyframe name, so the stale rule has to go or
   the sheet would grow a duplicate on every save. */
function dropKeyframesNamed(sheet, name) {
  for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = sheet.cssRules[index];

    if (rule instanceof CSSKeyframesRule && rule.name === name) {
      sheet.deleteRule(index);
    }
  }
}

export function injectAnimationForPreview(animation) {
  const text = normalizeKeyframes(animation);

  if (insertedKeyframes.get(animation.id) === text) {
    return;
  }

  const element = previewStyleSheet();
  const sheet = element.sheet;

  /* No stylesheet object yet (very early call): fall back to appending text,
     which the branch above still de-duplicates. */
  if (!sheet) {
    element.textContent += text;

    insertedKeyframes.set(animation.id, text);

    return;
  }

  try {
    if (insertedKeyframes.has(animation.id)) {
      dropKeyframesNamed(sheet, sanitizeAnimationName(animation.animationName));
    }

    sheet.insertRule(text, sheet.cssRules.length);
  } catch (error) {
    /* An animation with unparseable keyframes should not take the grid down
       with it; the card simply does not move. */
    console.error("Could not register preview keyframes:", error);
  }

  insertedKeyframes.set(animation.id, text);
}

const activeCardPreviews = new Set();
let previewLifecycleBound = false;

function bindPreviewLifecycle() {
  if (previewLifecycleBound) return;
  previewLifecycleBound = true;
  const stopActive = () => {
    for (const stop of activeCardPreviews) stop();
  };
  // Switching tabs need not send mouseleave to the previously hovered card.
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopActive(); });
  window.addEventListener("blur", stopActive);
  window.addEventListener("pagehide", stopActive);
}

export function applyAnimation(element, animation, options = {}) {
  const keyframe = sanitizeAnimationName(animation.animationName);
  const duration = getPreviewDuration(animation);
  const delay = getAnimationDelay(animation);
  const easing = getResolvedEasing(animation);

  injectAnimationForPreview(animation);

  /*
   * Modal / detail preview
   */
  if (options.forceInfinite) {
    element.style.animation = `${keyframe} ${duration} ${easing} ${delay} infinite`;

    return;
  }

  /*
   * Card preview
   */

  element.style.animation = "none";
  bindPreviewLifecycle();

  const playAnimation = () => {
    if (document.hidden || activeCardPreviews.has(stopAnimation)) return;
    element.style.animation = `${keyframe} ${duration} ${easing} ${delay} infinite`;
    activeCardPreviews.add(stopAnimation);

    element.classList.add("is-animating");

    const card = element.closest(".animation-card");

    if (card) {
      card.classList.add("animation-running");
    }
  };

  const stopAnimation = () => {
    activeCardPreviews.delete(stopAnimation);
    element.style.animation = "none";

    element.classList.remove("is-animating");

    const card = element.closest(".animation-card");

    if (card) {
      card.classList.remove("animation-running");
    }
  };

  const hoverTarget = element.closest(".animation-card") || element;

  hoverTarget.addEventListener("mouseenter", playAnimation);

  hoverTarget.addEventListener("mouseleave", stopAnimation);

  element.addEventListener("focus", playAnimation);

  element.addEventListener("blur", stopAnimation);
}

/*
 * Every animation's preview. Nothing is taken from the campaign archives, so
 * the scene is generated from the animation's own id.
 */
export function createPreviewImage(animation) {
  return createScenePreview(animation);
}

/*
 * The still landscape that sits behind the animated element. Applied to the
 * stage rather than to the element itself, so however far a keyframe moves,
 * scales or turns the subject, the frame is never left empty.
 */
export function createPreviewBackdrop(animation) {
  return createSceneBackdrop(animation);
}

export function applyPreviewBackdrop(stage, animation) {
  if (!stage) return;

  stage.style.backgroundImage = 'url("' + createSceneBackdrop(animation) + '")';
}


export function getAnimationInlineCSS(animation) {
  const name = sanitizeAnimationName(animation.animationName);

  const duration = getPreviewDuration(animation);
  const delay = getAnimationDelay(animation);
  const easing = getResolvedEasing(animation);
  const iteration = animation.iterationCount ||
    (animation.interaction === "infinite" ? "infinite" : "1");

  /*
   * Template animations read their timing from custom properties, so a
   * project can retime one element without touching the shared definition.
   * The declared values stay as the fallbacks, so nothing has to be set.
   */
  const useVariables = Boolean(animation.template && animation.template.timingVariables);

  const durationValue = useVariables ? `var(--ms-duration, ${duration})` : duration;
  const delayValue = useVariables ? `var(--ms-delay, ${delay})` : delay;
  const easingValue = useVariables ? `var(--ms-ease, ${easing})` : easing;

  return [
    `animation-name: ${name};`,
    `animation-duration: ${durationValue};`,
    `animation-delay: ${delayValue};`,
    `animation-timing-function: ${easingValue};`,
    `animation-iteration-count: ${iteration};`,
    "animation-fill-mode: both;",
  ].join("\n");
}

export function getExportClassName(animation) {
  return `.${getScopedClassName(animation.className, animation.name)}`;
}

export function getCodeFileName(animation) {
  return `${slugify(animation.name)}.css`;
}

export function buildMotionShelfMetadata(animation) {
  const metadata = {
    id: animation.id,
    name: animation.name,
    target: animation.target,
    description: animation.description,
    device: animation.device,
    interaction: animation.interaction,
    categories: normalizeCategories(animation.categories),
    animationName: sanitizeAnimationName(animation.animationName),
    className: getScopedClassName(animation.className, animation.name),
    duration: Number(animation.duration) || 1.2,
    durationUnit: animation.durationUnit === "ms" ? "ms" : "s",
    delay: Number(animation.delay) || 0,
    delayUnit: animation.delayUnit === "ms" ? "ms" : "s",
    easing: animation.easing || "ease-in-out",
    cubicBezier: normalizeBezier(animation.cubicBezier),
    iterationCount: animation.iterationCount || "1",
    css: animation.css,
    keyframes: animation.keyframes,
    parent: animation.parent,
    createdAt: animation.createdAt,
    updatedAt: animation.updatedAt,
  };

  if (animation.origin) metadata.origin = animation.origin;
  if (animation.template) metadata.template = animation.template;

  /* What the animation says is adjustable about it, so the editor builds the
     same controls wherever the file is opened rather than re-deriving them
     from the declarations and losing the labels and the scopes. */
  if (animation.parameters) metadata.parameters = animation.parameters;

  return `/* @motion-shelf
  ${JSON.stringify(metadata, null, 2)}
  */`;
}


export function normalizeKeyframesForExport(animation) {
  return normalizeKeyframes(animation);
}

/*
 * Only what changed.
 *
 * Every parameterised value is written twice: once as `--ms-scale: 0.92` at
 * the top of the rule, and once as the fallback in `scale(var(--ms-scale,
 * 0.92))` that the keyframe reads. While the two agree the declaration is
 * saying nothing -- removing it renders exactly the same animation.
 *
 * So the copied CSS carries the declarations a person has actually retuned,
 * and leaves the rest to speak through their own defaults. Someone pasting it
 * sees at a glance which three values this animation departs from, instead of
 * a wall of numbers with no way to tell which of them matter.
 *
 * The files on disk keep the full set: they are the record, not a quotation
 * of it.
 */
function unchangedVariables(animation) {
  /* The animation shorthand reads the timing variables and is generated
     rather than stored, so it has to be searched too. */
  const text = [
    animation.css,
    animation.parent,
    animation.keyframes,
    getAnimationInlineCSS(animation),
  ].join("\n");

  const declared = new Map();

  String(animation.css + "\n" + animation.parent).split(";").forEach((declaration) => {
    const at = declaration.indexOf(":");
    if (at < 1) return;

    const name = declaration.slice(0, at).trim();
    if (!/^--ms-[\w-]+$/.test(name)) return;

    declared.set(name, declaration.slice(at + 1).trim());
  });

  const unchanged = new Set();

  /* Fallbacks nest -- `var(--ms-ease, cubic-bezier(0.23, 1, 0.32, 1))` -- so
     the uses are scanned by counting brackets rather than matched. */
  const uses = readWrappedVariables(text);

  declared.forEach((value, name) => {
    /* Every use of it has to agree, and there has to be a use: a variable
       nothing reads is not redundant, it is the only place that value
       survives. */
    const mine = uses.filter((use) => use.name === name);
    if (!mine.length) return;

    if (mine.every((use) => use.value === value)) unchanged.add(name);
  });

  return unchanged;
}

function withoutVariables(text, names) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const at = line.indexOf(":");
      if (at < 1) return true;

      return !names.has(line.slice(0, at).trim());
    })
    .join("\n");
}

/*
 * What goes on the clipboard: the animation, with the values it has actually
 * been given rather than every value it has.
 */
export function buildCopyCSS(animation) {
  const unchanged = unchangedVariables(animation);

  if (!unchanged.size) return buildExportCSS(animation);

  return buildExportCSS({
    ...animation,
    css: withoutVariables(animation.css, unchanged),
    parent: withoutVariables(animation.parent, unchanged),
  });
}

export function buildExportCSS(animation) {
  const keyframeName = sanitizeAnimationName(animation.animationName);

  const className = getExportClassName(animation);

  const parent = animation.parent
    ? `
  
  /* Parent properties */
  
  ${className}-parent {
  ${indentCSS(animation.parent)}
  }
  `
    : "";

  const css = stripAnimationDeclarations(animation.css);

  const animationRules = getAnimationInlineCSS(animation).trim();
  const baseRule = `${className} {
${indentCSS(css)}${css ? "\n" : ""}${indentCSS(animation.interaction === "hover" ? "" : animationRules)}
}`;
  const hoverRule = animation.interaction === "hover"
    ? `\n\n${className}:hover {\n${indentCSS(animationRules)}\n}`
    : "";

  return `/* ==================================================
  Motion Shelf
  ${animation.name}
  ================================================== */
  
  /* Motion Shelf metadata */
  
  ${buildMotionShelfMetadata(animation)}
  
  ${parent}
  
  /* Animation */
  
  ${baseRule}${hoverRule}
  
  /* Keyframes */
  
  ${normalizeKeyframesForExport(animation)}
  `;
}

function stripAnimationDeclarations(css) {
  return String(css || "")
    .replace(/\banimation(?:-[a-z-]+)?\s*:[^;]+;?/gi, "")
    .trim();
}
