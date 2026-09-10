/*
 * Read-only campaign archive scanner.
 *
 * The archives (campaigns/, previews-only/) are historical source material.
 * This module only ever reads them: the directory picker is opened in "read"
 * mode, so the browser itself will not hand back a writable handle, and no
 * write API is called anywhere in this file. Everything produced by a scan is
 * stored inside Motion Shelf.
 *
 * The traversal is parameterised by a small adapter so the same engine runs
 * against File System Access handles in the browser and against any other
 * source in a headless harness.
 */

import {
  AnimationLibrary,
  extractCssAnimations,
  extractFromHtml,
  extractGsapAnimations,
  findToggledClasses,
  hashString,
} from "./animation-extract.js";

import { buildCanonicalLibrary, detectTarget } from "./animation-family.js";

export const SOURCE_FOLDER_NAMES = ["campaigns", "previews-only", "previous-only"];

const SKIP_DIRECTORIES = new Set([
  ".git", ".svn", ".hg", "node_modules", "dist", "build", "coverage",
  ".cache", ".next", ".nuxt", "vendor", "bower_components", ".idea", ".vscode",
]);

const STYLE_EXTENSIONS = new Set(["css", "scss", "sass"]);
const SCRIPT_EXTENSIONS = new Set(["js", "mjs", "ts"]);
const MARKUP_EXTENSIONS = new Set(["html", "htm"]);

/* Runtime libraries are not campaign work: reading them would flood the
   library with framework internals. Their animations belong to the campaign
   files that call them. */
const LIBRARY_FILE_PATTERN = /(?:^|[\/._-])(?:gsap|tweenmax|tweenlite|timelinemax|timelinelite|greensock|jquery|zepto|three|pixi|lottie|bodymovin|createjs|easeljs|tweenjs|preloadjs|movieclip|modernizr|swiper|howler|velocity|anime|popper|bootstrap|polyfill|require|webfont)[.\-]?/i;

const MAX_FILE_BYTES = 512 * 1024;

/* Reads overlap; parsing stays in listing order so results are reproducible. */
const READ_CONCURRENCY = 8;
const MAX_AVERAGE_LINE_LENGTH = 3000;

export function fileExtension(name) {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

/*
 * Decidable from the name alone, which matters: it lets the directory walk
 * reject an image without ever opening it.
 */
export function hasScannableName(name) {
  const extension = fileExtension(name);
  const known = STYLE_EXTENSIONS.has(extension)
    || SCRIPT_EXTENSIONS.has(extension)
    || MARKUP_EXTENSIONS.has(extension);

  return known && !LIBRARY_FILE_PATTERN.test(name);
}

export function isScannableFile(name, size) {
  if (!hasScannableName(name)) return false;
  if (Number.isFinite(size) && size > MAX_FILE_BYTES) return false;

  return true;
}

/*
 * A cheap gate before the parsers run. Four files in five carry no animation
 * code at all, and a substring test is far quicker than parsing them to find
 * that out. Kept deliberately loose so it can never hide a real animation.
 */
const ANIMATION_MARKERS = /@keyframes|animation|transition|gsap|tween|timeline|classlist|\.to\(|\.from\(|\.fromTo\(/i;

export function mightContainAnimation(text) {
  return ANIMATION_MARKERS.test(text);
}

/* Minified bundles parse badly and are almost never campaign authored. */
export function looksMinified(text) {
  const lines = text.split("\n").length;
  return lines > 0 && text.length / lines > MAX_AVERAGE_LINE_LENGTH;
}

function emptyStats() {
  return {
    sourceFoldersFound: 0,
    campaignFoldersInspected: 0,
    foldersByRepository: {},
    filesInspected: 0,
    htmlInspected: 0,
    cssInspected: 0,
    jsInspected: 0,
    filesSkipped: 0,
    filesFromCache: 0,
    filesParsed: 0,
    filesRepeated: 0,
    filesWithoutAnimation: 0,
    cssAnimationsFound: 0,
    jsAnimationsFound: 0,
    gsapAnimationsFound: 0,
    duplicatesCollapsed: 0,
    uniqueAnimations: 0,
    unsupported: 0,
    parseErrors: 0,
    errorSamples: [],
  };
}

/*
 * Walks one campaign folder. Errors are contained per file and per folder so
 * a single broken campaign cannot end the scan.
 */
async function scanCampaignFolder(adapter, entryPath, repository, topFolder, context) {
  const { library, stats, cache, nextCache, contentSeen } = context;
  const queue = [entryPath];

  while (queue.length) {
    const directory = queue.shift();

    let listing;
    try {
      listing = await adapter.list(directory);
    } catch (error) {
      stats.parseErrors += 1;
      if (stats.errorSamples.length < 20) {
        stats.errorSamples.push({ path: directory, message: String(error && error.message || error) });
      }
      continue;
    }

    /* Directories go back on the queue; files are gathered so their reads
       can overlap instead of happening one at a time. */
    const files = [];

    for (const item of listing) {
      if (item.kind === "directory") {
        if (SKIP_DIRECTORIES.has(item.name)) continue;
        queue.push(item.path);
        continue;
      }

      if (!isScannableFile(item.name, item.size)) {
        stats.filesSkipped += 1;
        continue;
      }

      files.push(item);
    }

    for (let start = 0; start < files.length; start += READ_CONCURRENCY) {
      const batch = files.slice(start, start + READ_CONCURRENCY);

      const loaded = await Promise.all(batch.map(async (item) => {
        const cacheKey = repository + "/" + item.path;
        const cached = cache && cache.get(cacheKey);

        if (cached && cached.size === item.size && cached.lastModified === item.lastModified) {
          return { item, cacheKey, cached };
        }

        try {
          return { item, cacheKey, text: await adapter.read(item.path) };
        } catch (error) {
          return { item, cacheKey, error };
        }
      }));

      for (const entry of loaded) {
        const { item, cacheKey } = entry;
        const relative = item.path;

        if (entry.error) {
          stats.parseErrors += 1;
          if (stats.errorSamples.length < 20) {
            stats.errorSamples.push({ path: relative, message: String(entry.error.message || entry.error) });
          }
          continue;
        }

        /* Unchanged since the last sync: reuse what it produced. */
        if (entry.cached) {
          stats.filesFromCache += 1;
          stats.filesInspected += 1;
          entry.cached.records.forEach((record) => {
            if (record.origin.type === "gsap") stats.gsapAnimationsFound += 1;
            else stats.cssAnimationsFound += 1;

            library.add(record.record, record.origin);
          });
          if (nextCache) nextCache.set(cacheKey, entry.cached);
          continue;
        }

        const text = entry.text;
        stats.filesInspected += 1;

        const extension = fileExtension(item.name);
        if (MARKUP_EXTENSIONS.has(extension)) stats.htmlInspected += 1;
        else if (STYLE_EXTENSIONS.has(extension)) stats.cssInspected += 1;
        else stats.jsInspected += 1;

        const origin = { repository, folder: topFolder, file: relative, type: "" };

        /*
         * Campaign archives copy the same stylesheet into every banner size,
         * so most file bodies have already been parsed. Identical content is
         * replayed against the new location: the work is skipped but the
         * occurrence still counts, which is what canonical selection needs.
         */
        const contentKey = item.size + ":" + hashString(text);
        const repeated = contentSeen.get(contentKey);

        if (repeated) {
          stats.filesRepeated += 1;
          repeated.forEach((record) => {
            /* The parse was skipped, but the animation is genuinely present
               in this file too, so it still counts. */
            if (record.origin.type === "gsap") stats.gsapAnimationsFound += 1;
            else stats.cssAnimationsFound += 1;

            library.add(record.record, { ...origin, type: record.origin.type });
          });
          if (nextCache) {
            nextCache.set(cacheKey, {
              size: item.size,
              lastModified: item.lastModified,
              records: repeated.map((record) => ({ record: record.record, origin: { ...origin, type: record.origin.type } })),
            });
          }
          continue;
        }

        /* Four files in five contain no animation code; those never reach a
           parser. */
        if (!mightContainAnimation(text)) {
          stats.filesWithoutAnimation += 1;
          contentSeen.set(contentKey, []);
          if (nextCache) {
            nextCache.set(cacheKey, { size: item.size, lastModified: item.lastModified, records: [] });
          }
          continue;
        }

        const produced = [];

        try {
          stats.filesParsed += 1;

          let cssText = "";
          let jsText = "";
          let tagByClass = new Map();

          if (MARKUP_EXTENSIONS.has(extension)) {
            const blocks = extractFromHtml(text);
            cssText = blocks.css;
            jsText = blocks.js;
            tagByClass = blocks.tagByClass;
          } else if (STYLE_EXTENSIONS.has(extension)) {
            cssText = text;
          } else {
            jsText = text;
          }

          if (jsText && looksMinified(jsText)) {
            stats.unsupported += 1;
            jsText = "";
          }

          const toggledClasses = jsText ? findToggledClasses(jsText) : new Map();

          if (cssText) {
            const result = extractCssAnimations(cssText, { toggledClasses });
            stats.cssAnimationsFound += result.animations.length;
            stats.unsupported += result.skipped.notReusable;

            result.animations.forEach((record) => {
              record.tagByClass = tagByClass;
              produced.push({ record, origin: { ...origin, type: "css" } });
            });
          }

          if (jsText) {
            const result = extractGsapAnimations(jsText);
            stats.gsapAnimationsFound += result.animations.length;
            stats.unsupported += result.skipped.noAnimatableProps + result.skipped.unresolvedTarget;

            result.animations.forEach((record) => {
              produced.push({ record, origin: { ...origin, type: "gsap" } });
            });

            if (toggledClasses.size) stats.jsAnimationsFound += toggledClasses.size;
          }
        } catch (error) {
          stats.parseErrors += 1;
          if (stats.errorSamples.length < 20) {
            stats.errorSamples.push({ path: relative, message: String(error && error.message || error) });
          }
          continue;
        }

        /* Classify before storing: every record, from every future sync, goes
           through the same analysis. */
        produced.forEach(({ record }) => {
          if (record.target) return;
          record.target = detectTarget({
            selector: record.selector,
            declarations: record.declarations || {},
            tagByClass: record.tagByClass || new Map(),
          }).target;
        });

        contentSeen.set(contentKey, produced);
        produced.forEach(({ record, origin: recordOrigin }) => library.add(record, recordOrigin));

        if (nextCache) {
          nextCache.set(cacheKey, {
            size: item.size,
            lastModified: item.lastModified,
            records: produced,
          });
        }
      }
    }
  }
}

/*
 * Scans every configured source root.
 *
 * `adapter` supplies list(path) and read(path); `roots` is a list of
 * { repository, path } pairs. Paths are always relative to their own source
 * root, so nothing developer specific is ever recorded.
 */
export async function scanSources({ adapter, roots, onProgress, minimumOccurrences = 1, cache = null }) {
  const library = new AnimationLibrary();
  const stats = emptyStats();
  const nextCache = new Map();
  const context = { library, stats, cache, nextCache, contentSeen: new Map() };

  stats.sourceFoldersFound = roots.length;

  for (const root of roots) {
    let topLevel;
    try {
      topLevel = await adapter.list(root.path);
    } catch (error) {
      stats.parseErrors += 1;
      stats.errorSamples.push({ path: root.repository, message: String(error && error.message || error) });
      continue;
    }

    const folders = topLevel.filter((item) => item.kind === "directory" && !SKIP_DIRECTORIES.has(item.name));
    stats.foldersByRepository[root.repository] = folders.length;

    for (const folder of folders) {
      stats.campaignFoldersInspected += 1;

      try {
        await scanCampaignFolder(adapter, folder.path, root.repository, folder.name, context);
      } catch (error) {
        stats.parseErrors += 1;
        if (stats.errorSamples.length < 20) {
          stats.errorSamples.push({
            path: `${root.repository}/${folder.name}`,
            message: String(error && error.message || error),
          });
        }
      }

      if (onProgress && stats.campaignFoldersInspected % 5 === 0) {
        stats.uniqueAnimations = library.size();
        stats.duplicatesCollapsed = library.duplicates;
        await onProgress({ ...stats, currentFolder: `${root.repository}/${folder.name}` });
      }
    }
  }

  stats.uniqueAnimations = library.size();
  stats.duplicatesCollapsed = library.duplicates;

  /* Exact duplicates were collapsed while scanning; this second pass groups
     what is left into families and produces one canonical animation each. */
  const animations = buildCanonicalLibrary(library.allEntries(), { minimumOccurrences });

  stats.animationFamilies = animations.length;
  stats.nearDuplicatesGrouped = Math.max(0, stats.uniqueAnimations - animations.length);

  return {
    stats,
    library,
    cache: nextCache,
    animations,
  };
}

/* ==================================================
BROWSER ADAPTER (File System Access, read only)
================================================== */

export function supportsSourceScanning() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/* Opens the picker in read mode. A read mode handle cannot be used to write,
   so the archives are protected by the browser, not just by convention. */
export async function pickSourceRoot() {
  if (!supportsSourceScanning()) {
    throw new Error("Folder access is not supported. Use Chrome or Edge on localhost.");
  }

  return window.showDirectoryPicker({ mode: "read", id: "motion-shelf-campaign-sources" });
}

/*
 * Looks for campaigns/ and previews-only/ at or below the chosen folder.
 * The developer picks whichever folder contains them, so no absolute path is
 * ever assumed or stored.
 */
export async function discoverSourceRoots(rootHandle, { maxDepth = 3 } = {}) {
  const found = [];
  const queue = [{ handle: rootHandle, depth: 0, path: "" }];

  if (SOURCE_FOLDER_NAMES.includes(rootHandle.name.toLowerCase())) {
    return [{ repository: rootHandle.name, handle: rootHandle, path: "" }];
  }

  while (queue.length) {
    const current = queue.shift();
    if (current.depth > maxDepth) continue;

    for await (const [name, handle] of current.handle.entries()) {
      if (handle.kind !== "directory" || SKIP_DIRECTORIES.has(name)) continue;

      const path = current.path ? `${current.path}/${name}` : name;

      if (SOURCE_FOLDER_NAMES.includes(name.toLowerCase())) {
        found.push({ repository: name, handle, path: "" });
        continue;
      }

      if (current.depth < maxDepth) {
        queue.push({ handle, depth: current.depth + 1, path });
      }
    }
  }

  return found;
}

/* Adapter over a directory handle. Paths stay relative to that handle. */
export function createHandleAdapter(rootHandle) {
  const directories = new Map([["", rootHandle]]);

  /*
   * Listing a directory already has to open each candidate file to learn its
   * size, so the opened file is kept for the read that follows instead of
   * resolving and opening it a second time.
   */
  const opened = new Map();

  const resolve = async (path) => {
    if (directories.has(path)) return directories.get(path);

    const parts = path.split("/").filter(Boolean);
    let handle = rootHandle;
    let walked = "";

    for (const part of parts) {
      walked = walked ? `${walked}/${part}` : part;

      if (directories.has(walked)) {
        handle = directories.get(walked);
        continue;
      }

      /* create is never passed: this cannot bring a directory into being. */
      handle = await handle.getDirectoryHandle(part);
      directories.set(walked, handle);
    }

    return handle;
  };

  return {
    async list(path) {
      const handle = await resolve(path);
      const items = [];

      for await (const [name, child] of handle.entries()) {
        const childPath = path ? `${path}/${name}` : name;

        if (child.kind === "directory") {
          directories.set(childPath, child);
          items.push({ kind: "directory", name, path: childPath });
          continue;
        }

        let size = NaN;
        let lastModified = 0;

        /* Opening a file just to read its size is the single most expensive
           thing this walk can do, so images and video are never touched. */
        if (hasScannableName(name)) {
          try {
            const file = await child.getFile();
            size = file.size;
            lastModified = file.lastModified;
            opened.set(childPath, file);
          } catch {
            /* Unreadable entries are simply not offered to the scanner. */
          }
        }

        items.push({ kind: "file", name, path: childPath, size, lastModified });
      }

      return items;
    },

    async read(path) {
      const already = opened.get(path);
      if (already) {
        opened.delete(path);
        return already.text();
      }

      const parts = path.split("/");
      const fileName = parts.pop();
      const handle = await resolve(parts.join("/"));
      const file = await (await handle.getFileHandle(fileName)).getFile();
      return file.text();
    },
  };
}

/* ==================================================
SCAN CACHE

Keyed on size + modification time so a rescan only reparses files that
actually changed. Stored in Motion Shelf's own IndexedDB, never in the
archives.
================================================== */

const CACHE_DB = "motion-shelf.campaign-scan.v1";
const CACHE_STORE = "scans";
const ROOT_STORE = "roots";

function openCacheDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE);
      }
      if (!request.result.objectStoreNames.contains(ROOT_STORE)) {
        request.result.createObjectStore(ROOT_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadScanCache(repository) {
  if (typeof indexedDB === "undefined") return new Map();

  try {
    const db = await openCacheDatabase();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, "readonly");
      const request = transaction.objectStore(CACHE_STORE).get(repository);

      request.onsuccess = () => resolve(new Map(request.result || []));
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return new Map();
  }
}

export async function saveScanCache(repository, cache) {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openCacheDatabase();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, "readwrite");
      transaction.objectStore(CACHE_STORE).put([...cache.entries()], repository);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    /* A cache miss next time is harmless. */
  }
}

/* ==================================================
REMEMBERED ARCHIVES

Sync should not ask for a folder it has already been shown. Each archive's
handle is stored once and reused; the picker only ever appears for one that
cannot be located.
================================================== */

export async function rememberSourceRoot(repository, handle) {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openCacheDatabase();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(ROOT_STORE, "readwrite");
      transaction.objectStore(ROOT_STORE).put(handle, repository);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    /* Being asked again next time is the only cost. */
  }
}

async function readRememberedRoot(repository) {
  if (typeof indexedDB === "undefined") return null;

  try {
    const db = await openCacheDatabase();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(ROOT_STORE, "readonly");
      const request = transaction.objectStore(ROOT_STORE).get(repository);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/*
 * The archives Sync already knows about. A handle is only returned when it
 * still reads, so a moved or revoked folder falls back to being picked again.
 */
export async function loadRememberedRoots() {
  const found = [];

  for (const repository of SOURCE_FOLDER_NAMES) {
    const handle = await readRememberedRoot(repository);
    if (!handle) continue;

    try {
      let permission = await handle.queryPermission({ mode: "read" });
      if (permission !== "granted") permission = await handle.requestPermission({ mode: "read" });
      if (permission !== "granted") continue;

      found.push({ repository: handle.name, handle, path: "" });
    } catch {
      /* Stale handle: treat the archive as missing. */
    }
  }

  return found;
}

/* previews-only and previous-only are the same archive under two spellings. */
export function isSameArchive(a, b) {
  const normalize = (value) => String(value).toLowerCase().replace(/^previous-only$/, "previews-only");
  return normalize(a) === normalize(b);
}
