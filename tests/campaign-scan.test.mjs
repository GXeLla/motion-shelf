import assert from "node:assert/strict";
import test from "node:test";
import { createHandleAdapter, scanSources } from "../scripts/campaign-scan.js";

const roots = [{ repository: "campaigns", path: "" }];
const wait = () => new Promise((resolve) => setTimeout(resolve, 1));

function createArchive() {
  const metrics = {};
  const settings = { reverse: false };
  const resetMetrics = () => Object.assign(metrics, {
    opens: 0, reads: 0, activeOpens: 0, maxOpens: 0,
    activeReads: 0, maxReads: 0, paths: new Map(),
  });
  resetMetrics();

  function file(name, content, options = {}) {
    return {
      name, kind: "file", content, lastModified: 10, ...options,
      async getFile() {
        metrics.opens += 1;
        metrics.paths.set(name, (metrics.paths.get(name) || 0) + 1);
        metrics.maxOpens = Math.max(metrics.maxOpens, ++metrics.activeOpens);
        try {
          await wait();
          if (this.unreadable) throw new Error("Fixture metadata error");
          const body = this.content;
          const readError = this.readError;
          return {
            size: this.size ?? body.length,
            lastModified: this.lastModified,
            async text() {
              metrics.reads += 1;
              metrics.maxReads = Math.max(metrics.maxReads, ++metrics.activeReads);
              try {
                await wait();
                if (readError) throw new Error("Fixture read error");
                return body;
              } finally {
                metrics.activeReads -= 1;
              }
            },
          };
        } finally {
          metrics.activeOpens -= 1;
        }
      },
      async createWritable() { assert.fail("Archive writes are forbidden"); },
    };
  }

  function dir(name, children) {
    return {
      name, kind: "directory", children: new Map(children.map((child) => [child.name, child])),
      async *entries() {
        const rows = [...this.children];
        if (settings.reverse) rows.reverse();
        for (const row of rows) yield row;
      },
      async getDirectoryHandle(childName, options) {
        assert.ok(!options?.create, "Directory creation is forbidden");
        const child = this.children.get(childName);
        assert.equal(child?.kind, "directory");
        return child;
      },
      async getFileHandle(childName, options) {
        assert.ok(!options?.create, "File creation is forbidden");
        const child = this.children.get(childName);
        assert.equal(child?.kind, "file");
        return child;
      },
    };
  }

  return { file, dir, metrics, settings, resetMetrics };
}

function css(index) {
  const distance = 20 + index % 3 * 10;
  return `.move${index} { animation: slide${index} 1s ease both; }
    @keyframes slide${index} {
      from { transform: translateX(${distance}px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }`;
}

test("cached scans skip body reads and correctly invalidate changed, new and deleted files", async () => {
  const { file, dir, metrics, settings, resetMetrics } = createArchive();
  const folders = Array.from({ length: 8 }, (_, folder) => dir(`variant${folder}`,
    Array.from({ length: 24 }, (_, index) => file(`style${index}.css`, css(index % 6)))));
  const adapter = createHandleAdapter(dir("campaigns", [dir("Brand", folders)]));
  const cold = await scanSources({ adapter, roots });
  assert.equal(cold.stats.filesInspected, 192);
  assert.equal(metrics.reads, 192);
  assert.ok(metrics.maxReads > 1 && metrics.maxReads <= 72);

  resetMetrics();
  settings.reverse = true;
  const warm = await scanSources({ adapter, roots, cache: structuredClone(cold.cache) });
  assert.equal(warm.stats.filesFromCache, 192);
  assert.equal(metrics.reads, 0);
  assert.deepEqual(warm.animations, cold.animations);

  const changed = folders[0].children.get("style0.css");
  changed.content = css(0).replace("20px", "80px");
  changed.lastModified += 1;
  folders[1].children.delete("style1.css");
  folders[2].children.set("added.css", file("added.css", css(9)));
  resetMetrics();
  const updated = await scanSources({ adapter, roots, cache: warm.cache });
  assert.equal(metrics.reads, 2);
  assert.equal(updated.stats.filesFromCache, 190);
  assert.equal(updated.cache.has("campaigns/Brand/variant1/style1.css"), false);
  assert.equal(updated.cache.has("campaigns/Brand/variant2/added.css"), true);
  const refreshed = await scanSources({ adapter, roots });
  assert.deepEqual(updated.animations, refreshed.animations);
});

test("metadata retrieval is bounded across simultaneous listings and preserves listing order", async () => {
  const { file, dir, metrics } = createArchive();
  const folders = Array.from({ length: 4 }, (_, index) => dir(`folder${index}`,
    Array.from({ length: 30 }, (_, item) => file(`item${item}.css`, css(item)))));
  const adapter = createHandleAdapter(dir("campaigns", folders));
  const listings = await Promise.all(folders.map((folder) => adapter.list(folder.name)));
  assert.equal(metrics.opens, 120);
  assert.ok(metrics.maxOpens > 1 && metrics.maxOpens <= 12);
  assert.equal(metrics.activeOpens, 0);
  listings.forEach((listing, index) => {
    assert.deepEqual(listing.map((item) => item.name), [...folders[index].children.keys()]);
  });
});

test("cached, skipped and failed reads release snapshots without reopening metadata failures", async () => {
  const { file, dir, metrics, resetMetrics } = createArchive();
  const cached = file("cached.css", css(0));
  const ignored = file("ignored-root.css", css(1));
  const oversized = file("oversized.css", "old", { size: 512 * 1024 + 1 });
  const failedRead = file("failed-read.css", css(2), { readError: true });
  const root = dir("campaigns", [ignored, dir("Brand", [
    cached, oversized, failedRead,
    file("unreadable.css", "", { unreadable: true }),
    file("photo.jpg", "photo"),
    dir("vendor", [file("hidden.css", css(0))]),
  ])]);
  const adapter = createHandleAdapter(root);
  const cold = await scanSources({ adapter, roots });
  assert.equal(cold.stats.parseErrors, 2);
  assert.equal(metrics.paths.get("unreadable.css"), 1);
  assert.equal(metrics.paths.get("failed-read.css"), 1);
  assert.equal(metrics.paths.has("photo.jpg"), false);
  assert.equal(metrics.paths.has("hidden.css"), false);

  resetMetrics();
  const warm = await scanSources({ adapter, roots, cache: cold.cache });
  assert.equal(warm.stats.filesFromCache, 1);
  assert.equal(metrics.reads, 1, "Only the failed body read is retried");
  assert.equal(metrics.paths.get("unreadable.css"), 1);

  for (const [source, path] of [
    [cached, "Brand/cached.css"], [ignored, "ignored-root.css"],
    [oversized, "Brand/oversized.css"], [failedRead, "Brand/failed-read.css"],
  ]) {
    source.content = `fresh snapshot: ${path}`;
    source.readError = false;
    assert.equal(await adapter.read(path), source.content);
  }
});

test("failed directory listings discard metadata snapshots already opened", async () => {
  const { file, dir, metrics } = createArchive();
  const source = file("style.css", css(0));
  const root = dir("campaigns", [source]);
  root.entries = async function* () {
    yield [source.name, source];
    throw new Error("Fixture listing error");
  };
  const adapter = createHandleAdapter(root);
  await assert.rejects(adapter.list(""), /Fixture listing error/);
  assert.equal(metrics.activeOpens, 0);
  source.content = "fresh after failed listing";
  assert.equal(await adapter.read(source.name), source.content);
});

test("missing metadata cannot incorrectly match cached parse results", async () => {
  const adapter = {
    async list(path) {
      return path
        ? [{ kind: "file", name: "style.css", path: "Brand/style.css" }]
        : [{ kind: "directory", name: "Brand", path: "Brand" }];
    },
    async read() { return css(1); },
  };
  const cache = new Map([["campaigns/Brand/style.css", { records: [] }]]);
  const result = await scanSources({ adapter, roots, cache });
  assert.equal(result.stats.filesFromCache, 0);
  assert.equal(result.animations.length, 1);
});
