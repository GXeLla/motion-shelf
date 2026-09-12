import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../scripts/state.js";
import { loadAnimationsFromProject, loadAnimationsFromRepository, parseAnimationFile } from "../scripts/filesystem.js";
import { buildExportCSS } from "../scripts/animations.js";
import { normalizeAnimation } from "../scripts/storage.js";

test("project load overlaps at most eight reads, preserving order, errors and unsaved edits", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const previous = { ...state };
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { setItem() {} };
  const sources = Array.from({ length: 24 }, (_, i) => normalizeAnimation({
    id: "animation-" + i, name: "Animation " + i, animationName: "msAnimation" + i,
    css: "opacity: 0;", keyframes: "from { opacity: 0; } to { opacity: 1; }",
    updatedAt: 200, createdAt: 100,
  }));
  const disk = sources.map(buildExportCSS);
  let active = 0;
  let maximum = 0;
  let ignoredOpened = false;
  const directory = {
    async *entries() {
      yield ["image.png", { kind: "file", getFile() { ignoredOpened = true; } }];
      for (let i = 0; i < sources.length; i++) {
        yield [i + ".css", {
          kind: "file",
          async getFile() {
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, (i % 3) + 1));
            active--;
            if (i === 7) throw new Error("Fixture unreadable file");
            return { lastModified: 300, text: async () => disk[i] };
          },
        }];
      }
    },
  };

  try {
    state.projectName = "fixture";
    state.projectHandle = { getDirectoryHandle: async () => directory };
    state.projectPermission = "granted";
    const dirty = parseAnimationFile(disk[2], "2.css", 300);
    dirty.css = "opacity: 0.5;";
    dirty.codeSynced = false;
    state.animations = [dirty];
    const result = await loadAnimationsFromProject();
    assert.equal(result.loaded, true);
    assert.equal(result.animations.length, 23);
    assert.deepEqual(result.animations.map((item) => item.id), sources.filter((_, i) => i !== 7).map((item) => item.id));
    assert.equal(result.errors[0].fileName, "7.css");
    assert.equal(warnings.mock.callCount(), 1);
    assert.ok(maximum > 1 && maximum <= 8);
    assert.equal(ignoredOpened, false);
    assert.equal(state.animations.find((item) => item.id === dirty.id).css, "opacity: 0.5;");
    assert.equal(state.animations.find((item) => item.id === dirty.id).codeSynced, false);
    assert.equal(state.animations.find((item) => item.id === "animation-3").css, sources[3].css);
  } finally {
    Object.assign(state, previous);
    globalThis.sessionStorage = previousStorage;
  }
});

/*
 * A manifest entry can outlive its file: someone deletes an animation and
 * commits before the catalog is rebuilt. That used to reject the whole load,
 * so one missing file emptied the library for everybody.
 */
test("one missing catalog file costs one animation, not the library", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const previous = { ...state };
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    Object.assign(state, previous);
    globalThis.sessionStorage = previousStorage;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  });
  globalThis.sessionStorage = { setItem() {}, getItem() { return null; }, removeItem() {} };

  const names = ["one.css", "two.css", "three.css"];
  const disk = new Map(names.map((fileName, i) => [fileName, buildExportCSS(normalizeAnimation({
    id: "catalog-" + i, name: "Catalog " + i, animationName: "msCatalog" + i,
    css: "opacity: 0;", keyframes: "from { opacity: 0; } to { opacity: 1; }",
    createdAt: 100, updatedAt: 100 + i,
  }))]));

  /* Listed in the catalog, deleted from the folder. */
  disk.delete("two.css");

  globalThis.fetch = async (url) => {
    if (url.includes("manifest.json")) {
      return { ok: true, status: 200, async json() { return { version: 1, files: names }; } };
    }
    const fileName = decodeURIComponent(String(url).split("/").pop());
    if (!disk.has(fileName)) return { ok: false, status: 404 };
    return { ok: true, status: 200, async text() { return disk.get(fileName); } };
  };

  state.animations = [];
  const animations = await loadAnimationsFromRepository();

  assert.deepEqual(animations.map((animation) => animation.id), ["catalog-0", "catalog-2"],
    "the readable animations load, in catalog order");
  assert.deepEqual(animations.skipped, ["two.css"], "the missing one is reported");
  assert.equal(state.animations.length, 2);
  assert.equal(warnings.mock.callCount(), 1);

  /* A catalog that cannot be fetched at all is still an error worth raising. */
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(loadAnimationsFromRepository(), /committed animation catalog/);
});
