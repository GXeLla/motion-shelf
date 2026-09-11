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
  const origin = normalizeOrigin(animation.origin);
  const canonical = Boolean(origin);
  const css = String(animation.css || "").trim();
  const parameters = normalizeParameters(animation.parameters);

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

    delay: canonical ? 0.25 : normalizeNumber(animation.delay, 0),

    delayUnit: canonical ? "s" : animation.delayUnit === "ms" ? "ms" : "s",

    easing: String(animation.easing || "ease-in-out"),

    cubicBezier: normalizeBezier(animation.cubicBezier),

    iterationCount: normalizeIteration(animation.iterationCount, animation.interaction),

    css: canonical ? normalizeCanonicalDelayCss(css) : css,

    keyframes: String(animation.keyframes || "").trim(),

    parent: String(animation.parent || "").trim(),

    codeFileName: animation.codeFileName || null,

    codeSynced: Boolean(animation.codeSynced),

    localPresent: Boolean(animation.localPresent),

    repositoryPresent: Boolean(animation.repositoryPresent),

    localPath: String(animation.localPath || ""),

    source: ["local", "repository"].includes(animation.source) ? animation.source : "session",

    origin,

    audit: normalizeAudit(animation.audit),

    previewHint: String(animation.previewHint || ""),

    previewAnalysis: animation.previewAnalysis && typeof animation.previewAnalysis === "object"
      ? animation.previewAnalysis
      : null,

    template: normalizeTemplate(animation.template),

    parameters: canonical ? normalizeCanonicalDelayParameters(parameters) : parameters,

    rawCss: String(animation.rawCss || ""),

    createdAt: animation.createdAt || Date.now(),

    updatedAt: animation.updatedAt || Date.now(),

    lastCodePush: animation.lastCodePush || null,
  };
}

function normalizeAudit(audit) {
  if (!audit || typeof audit !== "object") return null;
  const status = String(audit.status || "");
  if (!status) return null;
  return {
    status,
    reason: String(audit.reason || ""),
    checkedAt: Number(audit.checkedAt) || Date.now(),
  };
}

function normalizeCanonicalDelayCss(css) {
  const declaration = "--ms-delay: 0.25s;";
  return /--ms-delay\s*:[^;]+;/i.test(css)
    ? css.replace(/--ms-delay\s*:[^;]+;/i, declaration)
    : `${declaration}\n${css}`.trim();
}

function normalizeCanonicalDelayParameters(parameters) {
  if (!parameters) return parameters;
  const normalize = (entries) => entries.map((entry) =>
    entry.name === "--ms-delay" ? { ...entry, value: "0.25s" } : entry);
  return { ...parameters, target: normalize(parameters.target), parent: normalize(parameters.parent) };
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
    sources: sources.map((source) => ({
      repository: String(source.repository || ""),
      folder: String(source.folder || ""),
      brand: String(source.brand || ""),
      campaign: String(source.campaign || ""),
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

/*
 * What the animation says is adjustable about it, and in which scope. This is
 * what the editor builds its controls from, so an entry that names no variable
 * is dropped rather than becoming a control that sets nothing.
 *
 * Absent is a valid answer: an animation written here by hand has no metadata,
 * and the editor reads its declarations directly instead.
 */
function normalizeParameters(parameters) {
  if (!parameters || typeof parameters !== "object") return null;

  const clean = (list, scope) => (Array.isArray(list) ? list : [])
    .filter((entry) => entry && /^--ms-[\w-]+$/.test(String(entry.name)))
    .map((entry) => ({
      name: String(entry.name),
      label: String(entry.label || entry.name),
      value: String(entry.value ?? ""),
      kind: String(entry.kind || "value"),
      group: String(entry.group || "motion"),
      scope,
      ...(entry.property ? { property: String(entry.property) } : {}),
      ...(entry.axis ? { axis: String(entry.axis) } : {}),
    }));

  const target = clean(parameters.target, "target");
  const parent = clean(parameters.parent, "parent");

  if (!target.length && !parent.length) return null;

  return {
    target,
    parent,
    /* A container is required when the animation actually needs one, never
       because the record claimed so with nothing to put in it. */
    parentRequired: parent.length > 0,
    parentClassName: parent.length ? String(parameters.parentClassName || "") : "",
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
