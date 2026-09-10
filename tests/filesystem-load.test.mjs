import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../scripts/state.js";
import { loadAnimationsFromProject, parseAnimationFile } from "../scripts/filesystem.js";
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
