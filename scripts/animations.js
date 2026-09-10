import { state } from "./state.js";

import {
  createId,
  slugify,
  getScopedClassName,
  sanitizeAnimationName,
  normalizeCategories,
  normalizeImageUrl,
  escapeCssUrl,
  indentCSS,
} from "./utils.js";

import { saveAnimations } from "./storage.js";

import { normalizeBezier, resolveEasing } from "./easing.js";

import { createFigurePreview } from "./preview-figures.js";

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

    imageUrl: normalizeImageUrl(data.imageUrl),

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

  animation.imageUrl = normalizeImageUrl(data.imageUrl);

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

export function injectAnimationForPreview(animation) {
  const styleId = `preview-style-${animation.id}`;

  let style = document.getElementById(styleId);

  if (!style) {
    style = document.createElement("style");

    style.id = styleId;

    document.head.appendChild(style);
  }

  style.textContent = normalizeKeyframes(animation);
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

  const playAnimation = () => {
    element.style.animation = `${keyframe} ${duration} ${easing} ${delay} infinite`;

    element.classList.add("is-animating");

    const card = element.closest(".animation-card");

    if (card) {
      card.classList.add("animation-running");
    }
  };

  const stopAnimation = () => {
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
 * The stand-in shown when an animation has no image of its own, which is
 * every imported one: nothing is taken from the campaign archives. A little
 * character makes the motion far easier to read than an abstract shape.
 */
export function createPreviewImage(animation) {
  return createFigurePreview(animation);
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
    imageUrl: normalizeImageUrl(animation.imageUrl),
    css: animation.css,
    keyframes: animation.keyframes,
    parent: animation.parent,
    createdAt: animation.createdAt,
    updatedAt: animation.updatedAt,
  };

  if (animation.origin) metadata.origin = animation.origin;
  if (animation.template) metadata.template = animation.template;

  return `/* @motion-shelf
  ${JSON.stringify(metadata, null, 2)}
  */`;
}

export function injectImageIntoCss(css, url, type) {
  if (!url) {
    return css;
  }

  let result = String(css)
    .replace(/background-image\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)\s*;?/gi, "")
    .replace(/background\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)\s*;?/gi, "");

  if (type === "src") {
    result = `--motion-shelf-image: url("${escapeCssUrl(url)}");\ncontent: var(--motion-shelf-image);\n${result}`;
  } else {
    result = `background-image: url("${escapeCssUrl(url)}");\n${result}`;
  }

  return result.trim();
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

  let css = stripAnimationDeclarations(animation.css);

  if (animation.imageUrl) {
    css = injectImageIntoCss(
      css,
      normalizeImageUrl(animation.imageUrl),
      animation.target === "img" ? "src" : "background",
    );
  }

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
