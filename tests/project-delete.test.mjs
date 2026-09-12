import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../scripts/state.js";
import { normalizeAnimation } from "../scripts/storage.js";
import { deleteAnimationsFromCode, syncLibraryToProject } from "../scripts/code.js";

/*
 * Deleting an animation from the project folder.
 *
 * manifest.json is what every visitor fetches, so a deletion that removes the
 * CSS file and leaves the catalog listing it does not leave a stale entry -- it
 * leaves a catalog that no longer describes the folder. The deletion also has
 * to take its turn in the same queue as Push and Sync rather than removing
 * files out from under a write that is still streaming.
 */

test("deleting rebuilds the catalog and waits its turn behind a write", async (t) => {
  const previous = { ...state };
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  t.after(() => {
    Object.assign(state, previous);
    globalThis.window = previousWindow;
    globalThis.sessionStorage = previousStorage;
  });

  globalThis.window = { showDirectoryPicker() {}, indexedDB: {} };
  const session = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, String(value)),
    removeItem: (key) => session.delete(key),
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const messages = [];
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  const order = [];

  class Directory {
    files = new Map();
    failManifest = false;
    tick = 1;
    add(name, text) { this.files.set(name, { text, time: this.tick++ }); }
    async getFileHandle(name, { create = false } = {}) {
      if (!this.files.has(name)) {
        if (!create) throw new DOMException("Missing", "NotFoundError");
        this.add(name, "");
      }
      const directory = this;
      return {
        kind: "file",
        name,
        async getFile() {
          const record = directory.files.get(name);
          if (!record) throw new DOMException("Missing", "NotFoundError");
          return {
            lastModified: record.time,
            size: new TextEncoder().encode(record.text).length,
            async text() { await sleep(1); return record.text; },
          };
        },
        async createWritable() {
          let text;
          return {
            async write(value) { await sleep(2); text = value; },
            async close() {
              await sleep(2);
              if (name === "manifest.json" && directory.failManifest) throw new Error("Injected manifest failure");
              directory.add(name, text);
              if (name === "manifest.json") order.push("manifest");
            },
            async abort() {},
          };
        },
      };
    }
    async *entries() {
      for (const name of this.files.keys()) yield [name, { kind: "file" }];
    }
    async removeEntry(name) {
      order.push("removed " + name);
      this.files.delete(name);
    }
  }

  const directory = new Directory();
  state.projectHandle = {
    name: "test-project",
    async queryPermission() { return "granted"; },
    async getDirectoryHandle(name) { assert.equal(name, "animations"); return directory; },
  };
  state.projectName = "test-project";
  state.projectPermission = "granted";

  const create = (id) => normalizeAnimation({
    id, name: "Animation " + id, animationName: "motion" + id,
    css: "transform-origin: center;",
    keyframes: "from { opacity: 0; } to { opacity: 1; }",
    createdAt: 100, updatedAt: 100,
  });

  const callbacks = {
    showToast: (message) => messages.push(message),
    render: () => {},
    closeAll: () => {},
    updateWorkspaceUI: () => {},
    onProgress: () => {},
  };

  state.animations = ["a", "b", "c"].map(create);
  await syncLibraryToProject(state.animations, callbacks);

  const published = JSON.parse(directory.files.get("manifest.json").text);
  assert.deepEqual(published.files, ["animation-a.css", "animation-b.css", "animation-c.css"]);

  /* ---- the catalog is rebuilt in the same turn as the deletion ---- */
  order.length = 0;
  await deleteAnimationsFromCode(["b"], callbacks);

  assert.equal(directory.files.has("animation-b.css"), false, "the file is gone");
  const afterDelete = JSON.parse(directory.files.get("manifest.json").text);
  assert.deepEqual(afterDelete.files, ["animation-a.css", "animation-c.css"],
    "the catalog no longer lists it");
  assert.deepEqual(order, ["removed animation-b.css", "manifest"],
    "the catalog is rewritten after the removal, not before");
  assert.deepEqual(state.animations.map((animation) => animation.id), ["a", "c"]);
  assert.match(messages.at(-1), /deleted locally and from code/);

  /* ---- a deletion queues behind a sync rather than racing it ---- */
  order.length = 0;
  state.animations.push(create("d"));
  await Promise.all([
    syncLibraryToProject(state.animations, callbacks),
    deleteAnimationsFromCode(["a"], callbacks),
  ]);
  assert.equal(order.indexOf("removed animation-a.css") > order.indexOf("manifest"), true,
    "the sync published its catalog before the deletion started removing files");
  assert.equal(directory.files.has("animation-a.css"), false);
  assert.deepEqual(
    JSON.parse(directory.files.get("manifest.json").text).files,
    ["animation-c.css", "animation-d.css"],
  );

  /* ---- a catalog that cannot be rewritten is reported, not hidden ---- */
  directory.failManifest = true;
  await deleteAnimationsFromCode(["c"], callbacks);
  assert.equal(directory.files.has("animation-c.css"), false, "the file is still removed");
  assert.match(messages.at(-1), /catalog could not be updated/);

  assert.equal(state.projectBusy, false,
    "the workspace is released once every queued write has finished");
});
