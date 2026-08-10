import { STORAGE_KEY } from "./state.js";

import {
  normalizeCategories,
  normalizeImageUrl,
  sanitizeAnimationName,
  createId,
} from "./utils.js";

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

    css: String(animation.css || "").trim(),

    keyframes: String(animation.keyframes || "").trim(),

    parent: String(animation.parent || "").trim(),

    imageUrl: normalizeImageUrl(animation.imageUrl || ""),

    codeFileName: animation.codeFileName || null,

    codeSynced: Boolean(animation.codeSynced),

    createdAt: animation.createdAt || Date.now(),

    updatedAt: animation.updatedAt || Date.now(),

    lastCodePush: animation.lastCodePush || null,
  };
}
