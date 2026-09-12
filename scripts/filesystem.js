import { state } from "./state.js";
import { normalizeAnimation, saveAnimations } from "./storage.js";
import { createId, slugify } from "./utils.js";

const DB_NAME = "motion-shelf.workspace.v1";
const STORE_NAME = "handles";
const ROOT_KEY = "project-root";
const REPOSITORY_LOAD_CONCURRENCY = 8;

export function supportsProjectFolders() {
  return "showDirectoryPicker" in window && "indexedDB" in window;
}

export async function restoreProjectLink() {
  if (!supportsProjectFolders()) {
    state.projectPermission = "unsupported";
    return null;
  }

  try {
    const handle = await readStoredHandle();
    if (!handle) {
      state.projectPermission = "unlinked";
      return null;
    }

    state.projectHandle = handle;
    state.projectName = handle.name;
    state.projectPermission = await handle.queryPermission({ mode: "readwrite" });
    return state.projectPermission === "granted" ? handle : null;
  } catch (error) {
    console.warn("Could not restore the project folder:", error);
    state.projectPermission = "unlinked";
    return null;
  }
}

export async function connectProject({ changeFolder = false } = {}) {
  if (!supportsProjectFolders()) {
    throw new Error("Folder access is not supported. Use Chrome or Edge on localhost.");
  }

  let handle = changeFolder ? null : state.projectHandle;

  if (handle) {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      const requested = await handle.requestPermission({ mode: "readwrite" });
      if (requested !== "granted") throw new DOMException("Permission denied", "NotAllowedError");
    }
  } else {
    handle = await window.showDirectoryPicker({ mode: "readwrite", id: "motion-shelf-project" });
  }

  await storeHandle(handle);
  state.projectHandle = handle;
  state.projectName = handle.name;
  state.projectPermission = "granted";
  return handle;
}

export async function ensureProjectHandle() {
  const handle = state.projectHandle;

  if (handle) {
    state.projectHandle = handle;
    state.projectName = handle.name;
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission === "granted") {
      state.projectPermission = "granted";
      return handle;
    }

    const requested = await handle.requestPermission({ mode: "readwrite" });
    if (requested === "granted") {
      state.projectPermission = "granted";
      return handle;
    }
  }

  return connectProject();
}

export async function getAnimationsDirectory({ create = true } = {}) {
  const root = await ensureProjectHandle();
  return root.getDirectoryHandle("animations", { create });
}

export async function loadAnimationsFromProject() {
  const root = state.projectHandle;
  if (!root || state.projectPermission !== "granted") {
    return { animations: [], errors: [], loaded: false };
  }

  let directory;
  try {
    directory = await root.getDirectoryHandle("animations", { create: true });
  } catch (error) {
    return { animations: [], errors: [error], loaded: false };
  }

  const localAnimations = [];
  const errors = [];
  const entries = [];

  for await (const [fileName, handle] of directory.entries()) {
    if (handle.kind !== "file" || !fileName.toLowerCase().endsWith(".css")) continue;
    entries.push({ fileName, handle });
  }

  // Bound file access, retaining listing order even when reads finish out of order.
  const loaded = new Array(entries.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const { fileName, handle } = entries[index];
      try {
        const file = await handle.getFile();
        const cssText = await file.text();
        loaded[index] = { animation: parseAnimationFile(cssText, fileName, file.lastModified) };
      } catch (error) {
        console.warn(`Could not load animations/${fileName}:`, error);
        loaded[index] = { error: { fileName, error } };
      }
    }
  }));

  loaded.forEach((result) => {
    if (result.error) errors.push(result.error);
    else localAnimations.push(result.animation);
  });

  mergeLocalAnimations(localAnimations);
  /* Records the session deliberately left out of state -- project-backed ones
     dropped at startup so the folder can supply them again -- must not be
     deleted from storage just because a load ran. Removal belongs to Sync and
     to explicit deletes. */
  await saveAnimations(state.animations, { replace: false });

  return { animations: localAnimations, errors, loaded: true };
}

export async function loadAnimationsFromRepository() {
  const manifestResponse = await fetch("./animations/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Could not load the committed animation catalog.");
  const manifest = await manifestResponse.json();
  if (!Array.isArray(manifest.files)) throw new Error("The animation catalog is invalid.");

  /* A manifest entry can outlive its file: someone deletes an animation and
     commits before the catalog is rebuilt. One missing file is one missing
     animation, not an empty library, so a failed entry is skipped and
     reported rather than taking every other animation down with it. */
  const skipped = [];
  const loaded = await mapWithConcurrency(manifest.files, REPOSITORY_LOAD_CONCURRENCY, async (fileName) => {
    try {
      const response = await fetch(`./animations/${encodeURIComponent(fileName)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseAnimationFile(await response.text(), fileName, Date.now(), { source: "repository", localPresent: false, repositoryPresent: true, localPath: `animations/${fileName}` });
    } catch (error) {
      console.warn(`Could not load animations/${fileName}:`, error);
      skipped.push(fileName);
      return null;
    }
  });

  const animations = loaded.filter(Boolean);
  mergeRepositoryAnimations(animations);
  await saveAnimations(state.animations, { replace: false });
  animations.skipped = skipped;
  return animations;
}

/* Preserve manifest order while keeping a 10k-file catalog from opening
   thousands of fetches and response bodies at once. */
async function mapWithConcurrency(items, limit, map) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await map(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function getProjectDisplayPath(fileName = "") {
  const root = state.projectName || state.projectHandle?.name || "project";
  return `${root}/animations${fileName ? `/${fileName}` : ""}`;
}

export function parseAnimationFile(cssText, fileName, lastModified = Date.now(), options = {}) {
  const source = options.source || "local";
  const localPresent = options.localPresent ?? source === "local";
  const metadata = readMetadata(cssText);
  const fallbackName = titleFromFile(fileName);
  const animationName =
    metadata.animationName || cssText.match(/@(?:-webkit-)?keyframes\s+([^\s{]+)/)?.[1] ||
    `ms${fallbackName.replace(/[^A-Za-z0-9]/g, "") || "Animation"}`;
  const name = metadata.name || fallbackName;
  const keyframes = metadata.keyframes || extractKeyframes(cssText) || "from { opacity: .4; } to { opacity: 1; }";
  const css = metadata.css ?? extractFirstRule(cssText, animationName);
  const id = metadata.id || `local-${slugify(fileName.replace(/\.css$/i, ""))}`;

  return normalizeAnimation({
    ...metadata,
    id,
    name,
    description: metadata.description ?? "CSS animation loaded from the linked project folder.",
    animationName,
    keyframes,
    css,
    codeFileName: fileName,
    codeSynced: true,
    localPresent,
    repositoryPresent: options.repositoryPresent ?? source === "repository",
    localPath: options.localPath || getProjectDisplayPath(fileName),
    source,
    rawCss: cssText,
    createdAt: metadata.createdAt || lastModified,
    updatedAt: metadata.updatedAt || lastModified,
    lastCodePush: lastModified,
  });
}

function mergeRepositoryAnimations(repositoryAnimations) {
  const repositoryIds = new Set(repositoryAnimations.map((animation) => animation.id));
  const findExisting = indexExistingAnimations();
  const merged = repositoryAnimations.map((repository) => {
    const existing = findExisting(repository);
    if (existing?.localPresent) return normalizeAnimation({ ...repository, ...existing, repositoryPresent: true, source: "local" });
    return repository;
  });
  const extras = state.animations.filter((animation) => !repositoryIds.has(animation.id));
  state.animations = [...merged, ...extras].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function mergeLocalAnimations(localAnimations) {
  const findExisting = indexExistingAnimations();
  const localIds = new Set(localAnimations.map((animation) => animation.id));
  const sessionOnly = state.animations.filter(
    (animation) => !animation.localPresent && animation.source !== "local" && !localIds.has(animation.id),
  );

  const mergedLocal = localAnimations.map((local) => {
    const existing = findExisting(local, true);

    if (!existing) return local;

    if (existing.localPresent && !existing.codeSynced) {
      return normalizeAnimation({
        ...local,
        ...existing,
        localPresent: true,
        localPath: local.localPath,
        source: "local",
        rawCss: local.rawCss,
      });
    }

    return normalizeAnimation({ ...existing, ...local, id: existing.id || local.id, repositoryPresent: existing.repositoryPresent });
  });

  state.animations = [...mergedLocal, ...sessionOnly].sort(
    (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
  );
}

/* Preserve the first-match merge policy without searching the whole library
   again for each file (quadratic work on large imports). */
function indexExistingAnimations() {
  const ids = new Map();
  const files = new Map();
  const names = new Map();
  const nameKey = (animation) => JSON.stringify([animation.name, animation.animationName]);
  state.animations.forEach((animation, index) => {
    if (!ids.has(animation.id)) ids.set(animation.id, index);
    if (!files.has(animation.codeFileName)) files.set(animation.codeFileName, index);
    const key = nameKey(animation);
    if (!names.has(key)) names.set(key, index);
  });

  return (animation, matchName = false) => {
    const index = Math.min(
      ids.get(animation.id) ?? Infinity,
      files.get(animation.codeFileName) ?? Infinity,
      matchName ? names.get(nameKey(animation)) ?? Infinity : Infinity,
    );
    return state.animations[index];
  };
}

function readMetadata(cssText) {
  const match = String(cssText).match(/\/\*\s*@motion-shelf\s*([\s\S]*?)\*\//i);
  if (!match) return {};
  try {
    return JSON.parse(match[1].trim());
  } catch (error) {
    console.warn("Invalid Motion Shelf metadata:", error);
    return {};
  }
}

function extractKeyframes(cssText) {
  const match = /@(?:-webkit-)?keyframes\s+[^\s{]+\s*\{/gi.exec(cssText);
  if (!match) return "";
  const start = match.index;
  let depth = 0;

  for (let index = cssText.indexOf("{", start); index < cssText.length; index += 1) {
    if (cssText[index] === "{") depth += 1;
    if (cssText[index] === "}") depth -= 1;
    if (depth === 0) return cssText.slice(start, index + 1).trim();
  }
  return "";
}

function extractFirstRule(cssText, animationName) {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const keyframeIndex = withoutComments.search(/@(?:-webkit-)?keyframes\b/i);
  const rules = keyframeIndex >= 0 ? withoutComments.slice(0, keyframeIndex) : withoutComments;
  const matches = [...rules.matchAll(/[^@{}]+\{([^{}]*)\}/g)];
  const declarations = matches.at(-1)?.[1]?.trim() || "";
  return declarations
    .replace(/animation(?:-[a-z-]+)?\s*:[^;]+;?/gi, "")
    .replace(new RegExp(animationName, "g"), "")
    .trim();
}

function titleFromFile(fileName) {
  return fileName
    .replace(/\.css$/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || "Local Animation";
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(handle) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, ROOT_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readStoredHandle() {
  if (!("indexedDB" in window)) return null;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(ROOT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}
