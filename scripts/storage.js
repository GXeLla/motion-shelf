import { STORAGE_KEY } from "./state.js";

import {
  normalizeCategories,
  normalizeImageUrl,
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

    imageUrl: normalizeImageUrl(animation.imageUrl || ""),

    codeFileName: animation.codeFileName || null,

    codeSynced: Boolean(animation.codeSynced),

    localPresent: Boolean(animation.localPresent),

    localPath: String(animation.localPath || ""),

    source: animation.source === "local" ? "local" : "session",

    rawCss: String(animation.rawCss || ""),

    createdAt: animation.createdAt || Date.now(),

    updatedAt: animation.updatedAt || Date.now(),

    lastCodePush: animation.lastCodePush || null,
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
