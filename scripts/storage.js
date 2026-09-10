import { STORAGE_KEY } from "./state.js";

import {
  normalizeCategories,
  getScopedClassName,
  sanitizeAnimationName,
  createId,
} from "./utils.js";

import { normalizeBezier } from "./easing.js";

export function loadAnimations() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeAnimation);
  } catch (error) {
    console.error("Could not load animations:", error);

    return [];
  }
}

export function saveAnimations(animations) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(animations));
  } catch (error) {
    console.error("Could not save animations:", error);
  }
}

export function normalizeAnimation(animation) {
  return {
    id: animation.id || createId(),

    name: String(animation.name || "").trim(),

    target: animation.target || "div",

    description: String(animation.description || "").trim(),

    device: animation.device || "desktop",

    interaction: animation.interaction || "appear",

    categories: normalizeCategories(animation.categories),

    animationName: sanitizeAnimationName(animation.animationName),

    className: getScopedClassName(animation.className, animation.name),

    duration: normalizeNumber(animation.duration, 1.2),

    durationUnit: animation.durationUnit === "ms" ? "ms" : "s",

    delay: normalizeNumber(animation.delay, 0),

    delayUnit: animation.delayUnit === "ms" ? "ms" : "s",

    easing: String(animation.easing || "ease-in-out"),

    cubicBezier: normalizeBezier(animation.cubicBezier),

    iterationCount: normalizeIteration(animation.iterationCount, animation.interaction),

    css: String(animation.css || "").trim(),

    keyframes: String(animation.keyframes || "").trim(),

    parent: String(animation.parent || "").trim(),

    codeFileName: animation.codeFileName || null,

    codeSynced: Boolean(animation.codeSynced),

    localPresent: Boolean(animation.localPresent),

    repositoryPresent: Boolean(animation.repositoryPresent),

    localPath: String(animation.localPath || ""),

    source: ["local", "repository"].includes(animation.source) ? animation.source : "session",

    origin: normalizeOrigin(animation.origin),

    template: normalizeTemplate(animation.template),

    rawCss: String(animation.rawCss || ""),

    createdAt: animation.createdAt || Date.now(),

    updatedAt: animation.updatedAt || Date.now(),

    lastCodePush: animation.lastCodePush || null,
  };
}

/*
 * Where an imported animation came from. Paths stay relative to their source
 * archive, never absolute, so a shared animation file never leaks one
 * developer's folder layout.
 */
function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "object") return null;

  const sources = Array.isArray(origin.sources) ? origin.sources : [];

  return {
    kind: String(origin.kind || "css"),
    occurrences: Number(origin.occurrences) || 1,
    variants: Number(origin.variants) || 1,

    /* Two identities: the exact motion, and the family it belongs to. The
       family one is what a later sync matches against so a known technique
       is refreshed instead of duplicated. */
    exactFingerprint: String(origin.exactFingerprint || ""),
    familyFingerprint: String(origin.familyFingerprint || ""),

    originalName: String(origin.originalName || ""),
    originalSelector: String(origin.originalSelector || ""),
    variantNames: Array.isArray(origin.variantNames)
      ? origin.variantNames.slice(0, 8).map((variant) => ({
        name: String(variant.name || ""),
        occurrences: Number(variant.occurrences) || 1,
      }))
      : [],
    sources: sources.slice(0, 5).map((source) => ({
      repository: String(source.repository || ""),
      folder: String(source.folder || ""),
      file: String(source.file || "").replace(/^([A-Za-z]:)?[\\/].*?([^\\/]+[\\/](?:campaigns|previews-only|previous-only)[\\/])/, "$2"),
      type: String(source.type || ""),
    })),
  };
}

/*
 * The adjustable side of an imported animation: which custom properties it
 * exposes, and for GSAP families the configuration rather than CSS variables.
 */
function normalizeTemplate(template) {
  if (!template || typeof template !== "object") return null;

  const variables = Array.isArray(template.variables) ? template.variables : [];

  return {
    engine: template.engine === "gsap" ? "gsap" : "css",
    timingVariables: template.timingVariables !== false,
    variables: variables
      .filter((variable) => variable && /^--ms-[\w-]+$/.test(String(variable.name)))
      .map((variable) => ({
        name: String(variable.name),
        label: String(variable.label || variable.name),
        value: String(variable.value),
        kind: String(variable.kind || ""),
      })),
    gsapConfig: template.gsapConfig && typeof template.gsapConfig === "object"
      ? template.gsapConfig
      : null,
  };
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeIteration(value, interaction) {
  const source = String(value ?? "").trim();
  if (source === "infinite") return source;
  const number = Number(source);
  if (Number.isFinite(number) && number > 0) return String(number);
  return interaction === "infinite" ? "infinite" : "1";
}
