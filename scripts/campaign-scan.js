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

/*
 * Reads overlap, and so do directories. Results stay reproducible because
 * nothing downstream depends on arrival order: exact duplicates collapse onto
 * a fingerprint, and every sort in the family stage breaks ties on that
 * fingerprint rather than on which file happened to be read first.
 *
 * Measured against the real archives; past this the curve is flat and the
 * only thing that grows is the number of file handles in flight.
 */
const DIRECTORY_CONCURRENCY = 6;
const READ_CONCURRENCY = 12;
const METADATA_CONCURRENCY = 12;
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
    brands: 0,
    campaigns: 0,
    errorSamples: [],
  };
}

/* Sources are scanned below a brand folder. The first directory below it is
   the campaign identifier; files directly in the brand folder have no honest
   campaign value and stay blank rather than calling the brand a campaign. */
export function campaignFromSourcePath(brand, file) {
  const parts = String(file || "").replace(/\\/g, "/").split("/").filter(Boolean);
  const index = parts.indexOf(String(brand || ""));
  return index >= 0 && index + 2 < parts.length ? parts[index + 1] : "";
}

export function brandFromSource(folder, campaign) {
  const topLevel = String(folder || "").trim();
  if (!/^\d+(?:[_-]\d+)*$/.test(topLevel)) return topLevel;
  const part = String(campaign || "").split(/[_-]+/).find((entry) => entry && !/^\d+$/.test(entry));
  return part || topLevel;
}

/*
 * Walks one campaign folder.
 *
 * Several directories are in flight at once. Listing a directory and reading
 * the files inside it are both latency, and doing them strictly one folder at
 * a time meant the two never overlapped -- measured against the real archives,
 * letting six directories run together moved the walk from ~500 to ~880 files
 * a second without touching a parser.
 *
 * Errors are contained per file and per folder so a single broken campaign
 * cannot end the scan.
 */
async function scanCampaignFolder(adapter, entryPath, repository, topFolder, context) {
  const queue = [entryPath];

  /* Shared by the workers: a worker that finds the queue empty must not stop
     while another is still listing, because that one may be about to push
     subdirectories onto it. */
  const walk = { active: 0 };

  await Promise.all(
    Array.from({ length: DIRECTORY_CONCURRENCY }, () =>
      drainDirectories(adapter, repository, topFolder, context, queue, walk)),
  );
}

async function drainDirectories(adapter, repository, topFolder, context, queue, walk) {
  const { library, stats, cache, nextCache, contentSeen } = context;

  for (;;) {
    const directory = queue.shift();

    if (directory === undefined) {
      if (!walk.active) return;

      /* Nothing to take right now, but another worker is still listing. */
      await new Promise((resolve) => setTimeout(resolve, 4));
      continue;
    }

    walk.active += 1;

    try {
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
          adapter.discard?.(item.path);
          continue;
        }

        files.push(item);
      }

      for (let start = 0; start < files.length; start += READ_CONCURRENCY) {
        const batch = files.slice(start, start + READ_CONCURRENCY);

        const loaded = await Promise.all(batch.map(async (item) => {
          const cacheKey = repository + "/" + item.path;
          const cached = cache && cache.get(cacheKey);

          if (item.error) return { item, cacheKey, error: item.error };

          if (cached && Number.isFinite(item.size) && Number.isFinite(item.lastModified)
            && cached.size === item.size && cached.lastModified === item.lastModified) {
            adapter.discard?.(item.path);
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

          const campaign = campaignFromSourcePath(topFolder, relative);
          const origin = {
            repository,
            folder: topFolder,
            brand: brandFromSource(topFolder, campaign),
            campaign,
            file: relative,
            type: "",
          };

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
    } finally {
      walk.active -= 1;
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
    topLevel.forEach((item) => {
      if (item.kind !== "directory") adapter.discard?.(item.path);
    });
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

  const brands = new Set();
  const campaigns = new Set();
  animations.forEach((animation) => (animation.origin?.sources || []).forEach((source) => {
    const campaign = source.campaign || campaignFromSourcePath(source.folder, source.file);
    const brand = source.brand || brandFromSource(source.folder, campaign);
    if (brand) brands.add(brand);
    if (campaign) campaigns.add(campaign);
  }));
  stats.brands = brands.size;
  stats.campaigns = campaigns.size;

  stats.animationFamilies = animations.length;
  stats.nearDuplicatesGrouped = Math.max(0, stats.uniqueAnimations - animations.length);
  stats.animationsFound = stats.cssAnimationsFound + stats.gsapAnimationsFound;
  stats.uniqueAnimations = animations.length;
  stats.duplicates = stats.duplicatesCollapsed + stats.nearDuplicatesGrouped;
  stats.skippedItems = stats.filesSkipped + stats.unsupported;

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

  /* Share the metadata budget across all directory workers. Opening files
     serially adds one browser/filesystem round trip per candidate; letting
     every directory open all its files at once exhausts handles on large
     archives. Only this small pool may call getFile during listing. */
  const metadataQueue = [];
  let activeMetadata = 0;

  const openMetadata = (task) => new Promise((resolve, reject) => {
    metadataQueue.push({ task, resolve, reject });
    drainMetadata();
  });

  const drainMetadata = () => {
    while (activeMetadata < METADATA_CONCURRENCY && metadataQueue.length) {
      const job = metadataQueue.shift();
      activeMetadata += 1;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        activeMetadata -= 1;
        drainMetadata();
      });
    }
  };

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
      const pending = new Set();

      try {
        for await (const [name, child] of handle.entries()) {
          const childPath = path ? `${path}/${name}` : name;

          if (child.kind === "directory") {
            directories.set(childPath, child);
            items.push({ kind: "directory", name, path: childPath });
            continue;
          }

          const item = { kind: "file", name, path: childPath, size: NaN, lastModified: 0 };
          items.push(item);

          /* Images, video and runtime libraries never need a file open. */
          if (!hasScannableName(name)) continue;

          const task = openMetadata(async () => {
            try {
              const file = await child.getFile();
              item.size = file.size;
              item.lastModified = file.lastModified;
              if (isScannableFile(name, file.size)) opened.set(childPath, file);
            } catch (error) {
              /* Report the original failure without reopening the same file. */
              item.error = error;
            }
          });

          pending.add(task);
          task.then(() => pending.delete(task));

          /* Backpressure keeps a directory with thousands of source files
             from queuing thousands of promises. Items retain listing order
             regardless of the order in which their metadata arrives. */
          if (pending.size >= METADATA_CONCURRENCY) await Promise.race(pending);
        }
        await Promise.all(pending);
      } catch (error) {
        await Promise.allSettled(pending);
        items.forEach((item) => opened.delete(item.path));
        throw error;
      }

      return items;
    },

    discard(path) {
      opened.delete(path);
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

/*
 * Bump this whenever extraction, classification or the record shape changes.
 * A cached entry is a parse result, so a stale one would quietly keep serving
 * animations produced by the old code long after it was replaced.
 */
const CACHE_VERSION = 1;

export async function loadScanCache(repository) {
  if (typeof indexedDB === "undefined") return new Map();

  try {
    const db = await openCacheDatabase();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, "readonly");
      const request = transaction.objectStore(CACHE_STORE).get(repository);

      request.onsuccess = () => {
        const stored = request.result;

        if (!stored || stored.version !== CACHE_VERSION) {
          resolve(new Map());
          return;
        }

        resolve(new Map(stored.entries || []));
      };

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return new Map();
  }
}

/*
 * The scan keeps one cache for every root it walked, keyed by
 * "<repository>/<path>". These split it back out per archive so an archive
 * that was not available this time keeps the cache it already had.
 */
export function splitCacheByRepository(cache, repositories) {
  const split = new Map(repositories.map((repository) => [repository, new Map()]));

  cache.forEach((value, key) => {
    const repository = String(key).split("/")[0];
    const bucket = split.get(repository);

    if (bucket) bucket.set(key, value);
  });

  return split;
}

export async function saveScanCache(repository, cache) {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openCacheDatabase();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, "readwrite");
      transaction.objectStore(CACHE_STORE).put(
        { version: CACHE_VERSION, entries: [...cache.entries()] },
        repository,
      );
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
