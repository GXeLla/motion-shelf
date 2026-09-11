import { STORAGE_KEY } from "./state.js";

import {
  normalizeCategories,
  getScopedClassName,
  sanitizeAnimationName,
  createId,
} from "./utils.js";

import { normalizeBezier } from "./easing.js";

const LIBRARY_DB = "motion-shelf.animations.v1";
const ANIMATION_STORE = "animations";
const META_STORE = "meta";
const RECORD_SCHEMA = 1;
const MIGRATION_KEY = "session-v4-migrated";

let databasePromise = null;
let persistedFingerprints = new Map();
let onPersistenceError = (error) => console.error("Could not persist animations:", error);
let writeQueue = Promise.resolve();

export function setStorageErrorHandler(handler) {
  onPersistenceError = typeof handler === "function" ? handler : onPersistenceError;
}

function reportPersistenceError(error) {
  console.error("Could not persist animations:", error);
  onPersistenceError(error);
}

function supportsAnimationDatabase() {
  return typeof indexedDB !== "undefined";
}

function openAnimationDatabase() {
  if (!supportsAnimationDatabase()) return Promise.reject(new Error("IndexedDB is unavailable"));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(LIBRARY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ANIMATION_STORE)) {
        db.createObjectStore(ANIMATION_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the animation database"));
  });

  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function queueWrite(write) {
  const result = writeQueue.then(write);
  /* Later writes still run after a failed transaction. */
  writeQueue = result.catch(() => {});
  return result;
}

function fingerprint(animation) {
  return JSON.stringify(animation);
}

function storedRecord(animation) {
  return { ...animation, __motionShelfSchema: RECORD_SCHEMA };
}

function loadedRecord(record) {
  if (record?.__motionShelfSchema === RECORD_SCHEMA) {
    delete record.__motionShelfSchema;
    return record;
  }
  return normalizeAnimation(record || {});
}

function readLegacyAnimations() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeAnimation) : [];
  } catch (error) {
    console.error("Could not load animations:", error);
    return [];
  }
}

function saveLegacyAnimations(animations) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(animations));
    return true;
  } catch (error) {
    reportPersistenceError(error);
    return false;
  }
}

function saveLegacyRecord(animation) {
  const records = readLegacyAnimations();
  const index = records.findIndex((record) => record.id === animation.id);
  if (index === -1) records.push(animation);
  else records[index] = animation;
  return saveLegacyAnimations(records);
}

function removeLegacyRecords(ids) {
  const removed = new Set(ids);
  return saveLegacyAnimations(readLegacyAnimations().filter((animation) => !removed.has(animation.id)));
}

async function loadDatabaseAnimations() {
  const db = await openAnimationDatabase();
  const transaction = db.transaction([ANIMATION_STORE, META_STORE], "readonly");
  const animations = await requestResult(transaction.objectStore(ANIMATION_STORE).getAll());
  const migrated = await requestResult(transaction.objectStore(META_STORE).get(MIGRATION_KEY));
  await transactionDone(transaction);
  return { animations, migrated: Boolean(migrated) };
}

async function migrateLegacyAnimations(animations) {
  const db = await openAnimationDatabase();
  const transaction = db.transaction([ANIMATION_STORE, META_STORE], "readwrite");
  const store = transaction.objectStore(ANIMATION_STORE);
  animations.forEach((animation) => store.put(storedRecord(animation)));
  transaction.objectStore(META_STORE).put({ schema: RECORD_SCHEMA, completedAt: Date.now() }, MIGRATION_KEY);
  await transactionDone(transaction);
  persistedFingerprints = new Map(animations.map((animation) => [animation.id, fingerprint(animation)]));
  /* Retire the legacy value only after IndexedDB has committed every record. */
  sessionStorage.removeItem(STORAGE_KEY);
}

/* Loads complete records. Current-schema records are already normalized and
   are used directly; legacy records are upgraded once and saved back. */
export async function loadAnimations() {
  if (!supportsAnimationDatabase()) return readLegacyAnimations();

  try {
    const { animations: stored, migrated } = await loadDatabaseAnimations();
    if (stored.length) {
      const animations = stored.map(loadedRecord);
      persistedFingerprints = new Map(animations.map((animation) => [animation.id, fingerprint(animation)]));

      const needsUpgrade = stored.some((record) => record.__motionShelfSchema !== RECORD_SCHEMA);
      if (needsUpgrade) await saveAnimations(animations, { replace: true });
      return animations;
    }

    const legacy = readLegacyAnimations();
    if (legacy.length && !migrated) {
      await migrateLegacyAnimations(legacy);
      return legacy;
    }
    return [];
  } catch (error) {
    reportPersistenceError(error);
    /* Legacy storage remains the recovery path whenever IndexedDB is down. */
    return readLegacyAnimations();
  }
}

async function writeRecords(records, { removeIds = [] } = {}) {
  const db = await openAnimationDatabase();
  const transaction = db.transaction(ANIMATION_STORE, "readwrite");
  const store = transaction.objectStore(ANIMATION_STORE);
  records.forEach((animation) => store.put(storedRecord(animation)));
  removeIds.forEach((id) => store.delete(id));
  await transactionDone(transaction);
  records.forEach((animation) => persistedFingerprints.set(animation.id, fingerprint(animation)));
  removeIds.forEach((id) => persistedFingerprints.delete(id));
}

export async function saveAnimation(animation) {
  if (!animation) return false;
  if (!supportsAnimationDatabase()) return saveLegacyRecord(animation);
  try {
    await queueWrite(() => writeRecords([animation]));
    return true;
  } catch (error) {
    reportPersistenceError(error);
    return false;
  }
}

export async function saveAnimationBatch(animations) {
  const records = Array.isArray(animations) ? animations.filter(Boolean) : [];
  if (!records.length) return true;
  if (!supportsAnimationDatabase()) {
    const merged = readLegacyAnimations();
    const byId = new Map(merged.map((animation) => [animation.id, animation]));
    records.forEach((animation) => byId.set(animation.id, animation));
    return saveLegacyAnimations([...byId.values()]);
  }
  try {
    await queueWrite(() => writeRecords(records));
    return true;
  } catch (error) {
    reportPersistenceError(error);
    return false;
  }
}

export async function removeAnimationRecords(ids) {
  const removeIds = [...new Set(Array.isArray(ids) ? ids : [ids])].filter(Boolean);
  if (!removeIds.length) return true;
  if (!supportsAnimationDatabase()) return removeLegacyRecords(removeIds);
  try {
    await queueWrite(() => writeRecords([], { removeIds }));
    return true;
  } catch (error) {
    reportPersistenceError(error);
    return false;
  }
}

/* Full library replacement is reserved for Sync/project merges. It writes
   only changed records and removes records that no longer exist. */
export async function saveAnimations(animations, { replace = true } = {}) {
  const records = Array.isArray(animations) ? animations : [];
  if (!supportsAnimationDatabase()) return saveLegacyAnimations(records);

  try {
    await queueWrite(async () => {
      const nextIds = new Set(records.map((animation) => animation.id));
      const changed = records.filter((animation) => persistedFingerprints.get(animation.id) !== fingerprint(animation));
      const removed = replace
        ? [...persistedFingerprints.keys()].filter((id) => !nextIds.has(id))
        : [];
      if (!changed.length && !removed.length) return;
      await writeRecords(changed, { removeIds: removed });
    });
    return true;
  } catch (error) {
    reportPersistenceError(error);
    return false;
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

    auditSignature: String(animation.auditSignature || ""),

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
