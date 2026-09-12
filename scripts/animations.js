import { state } from "./state.js";

import {
  createId,
  slugify,
  getScopedClassName,
  sanitizeAnimationName,
  normalizeCategories,
  indentCSS,
} from "./utils.js";

import { removeAnimationRecords, saveAnimation } from "./storage.js";

import { normalizeBezier, resolveEasing } from "./easing.js";

import { createScenePreview, createSceneBackdrop } from "./preview-scene.js";


export function findAnimation(id) {
  return state.animations.find((animation) => animation.id === id);
}

export async function createAnimation(data) {
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

  await saveAnimation(animation);

  return animation;
}

export async function updateAnimation(id, data) {
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

  await saveAnimation(animation);

  return animation;
}

export async function deleteAnimations(ids) {
  const idSet = new Set(ids);

  state.animations = state.animations.filter(
    (animation) => !idSet.has(animation.id),
  );

  await removeAnimationRecords([...idSet]);
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

/* A scrolling session can visit thousands of cards while only a small
   screenful exists at once. Keep generated card rules bounded, not canonical
   keyframes or exported animation data. */
export const PREVIEW_RULE_LIMIT = 240;
const insertedKeyframes = new Map();
const PREVIEW_VIEWPORT_LIMIT = 140;

/* A source animation may intentionally travel a whole browser viewport. That
   distance is meaningful in its campaign but makes a thumbnail appear empty:
   its subject starts hundreds of pixels outside a 16:9 card. Bound only the
   preview copy; exported keyframes retain the source motion unchanged. */
export function normalizePreviewViewportUnits(keyframes) {
  const boundTransform = (value) => String(value)
    .replace(/([+-]?\d*\.?\d+)(v(?:w|h|min|max))\b/gi, (whole, amount, unit) => {
      const scale = /^v(?:h|min|max)$/i.test(unit) ? 0.9 : 1.2;
      return `${Math.max(-PREVIEW_VIEWPORT_LIMIT, Math.min(PREVIEW_VIEWPORT_LIMIT, Number(amount) * scale))}px`;
    })
    .replace(/([+-]?\d*\.?\d+)px\b/gi, (whole, amount) =>
      `${Math.max(-PREVIEW_VIEWPORT_LIMIT, Math.min(PREVIEW_VIEWPORT_LIMIT, Number(amount)))}px`)
    .replace(/([+-]?\d*\.?\d+)%\b/g, (whole, amount) =>
      `${Math.max(-140, Math.min(140, Number(amount)))}%`);

  return String(keyframes || "").replace(
    /\b(transform|translate)\s*:\s*([^;{}]+);/gi,
    (whole, property, value) => `${property}: ${boundTransform(value)};`,
  );
}

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

function touchPreviewRule(id) {
  const entry = insertedKeyframes.get(id);
  if (!entry) return;
  insertedKeyframes.delete(id);
  insertedKeyframes.set(id, entry);
}

function evictPreviewRules(sheet) {
  while (insertedKeyframes.size > PREVIEW_RULE_LIMIT) {
    /* The map already iterates least-recently-touched first, because
       touchPreviewRule re-inserts. Walking it stops at the first candidate;
       copying it into an array to call find() built a fresh array of every
       entry on every eviction, and evictions run whenever a card scrolls out. */
    let oldest = null;
    for (const candidate of insertedKeyframes) {
      if (candidate[1].active === 0) {
        oldest = candidate;
        break;
      }
    }
    if (!oldest) return;
    const [id, entry] = oldest;
    if (sheet) dropKeyframesNamed(sheet, entry.name);
    insertedKeyframes.delete(id);
  }
}

function setPreviewRuleActive(animation, active) {
  const entry = insertedKeyframes.get(animation.id);
  if (!entry) return;
  entry.active = Math.max(0, entry.active + (active ? 1 : -1));
  touchPreviewRule(animation.id);
  if (!active) evictPreviewRules(previewStyleSheet().sheet);
}

export function injectAnimationForPreview(animation) {
  const text = normalizePreviewViewportUnits(normalizeKeyframes(animation));
  const keyframeName = sanitizeAnimationName(animation.animationName);
  const previous = insertedKeyframes.get(animation.id);

  if (previous?.text === text) {
    touchPreviewRule(animation.id);
    return;
  }

  const element = previewStyleSheet();
  const sheet = element.sheet;

  /* No stylesheet object yet (very early call): fall back to appending text,
     which the branch above still de-duplicates. */
  if (!sheet) {
    element.textContent += text;

    insertedKeyframes.set(animation.id, { text, name: keyframeName, active: previous?.active || 0 });

    return;
  }

  try {
    if (previous) {
      dropKeyframesNamed(sheet, previous.name);
    }

    sheet.insertRule(text, sheet.cssRules.length);
  } catch (error) {
    /* An animation with unparseable keyframes should not take the grid down
       with it; the card simply does not move. */
    console.error("Could not register preview keyframes:", error);
  }

  insertedKeyframes.set(animation.id, { text, name: keyframeName, active: previous?.active || 0 });
  evictPreviewRules(sheet);
}

const activeCardPreviews = new Set();
const previewStops = new WeakMap();
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
    element.style.animationFillMode = "both";

    return;
  }

  /*
   * Card preview
   */

  element.style.animation = "none";
  bindPreviewLifecycle();

  const playAnimation = () => {
    if (document.hidden || activeCardPreviews.has(stopAnimation)) return;
    /* A card can remain in the scroll history after its inactive rule was
       evicted. Re-register it at the moment it is actually needed. */
    injectAnimationForPreview(animation);
    element.style.animation = `${keyframe} ${duration} ${easing} ${delay} infinite`;
    element.style.animationFillMode = "both";
    activeCardPreviews.add(stopAnimation);
    setPreviewRuleActive(animation, true);

    element.classList.add("is-animating");

    const card = element.closest(".animation-card");

    if (card) {
      card.classList.add("animation-running");
    }
  };

  const stopAnimation = () => {
    const wasActive = activeCardPreviews.has(stopAnimation);
    activeCardPreviews.delete(stopAnimation);
    if (wasActive) setPreviewRuleActive(animation, false);
    element.style.animation = "none";
    element.style.animationFillMode = "";

    element.classList.remove("is-animating");

    const card = element.closest(".animation-card");

    if (card) {
      card.classList.remove("animation-running");
    }
  };

  const hoverTarget = element.closest(".animation-card") || element;

  previewStops.set(element, stopAnimation);

  hoverTarget.addEventListener("mouseenter", playAnimation);

  hoverTarget.addEventListener("mouseleave", stopAnimation);

  element.addEventListener("focus", playAnimation);

  element.addEventListener("blur", stopAnimation);
}

/* Card windowing can remove a hovered card before mouseleave fires. Release
   both its running animation and its protected preview-rule lease. */
export function stopPreviewAnimation(element) {
  previewStops.get(element)?.();
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
