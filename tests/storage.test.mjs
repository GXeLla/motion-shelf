import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
const session = {
  getItem(key) { return values.get(key) || null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

test("legacy storage fallback updates and removes individual records without losing the library", async () => {
  const previousSession = globalThis.sessionStorage;
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.sessionStorage = session;
  delete globalThis.indexedDB;

  try {
    values.clear();
    values.set("motion-shelf.animations.session.v4", JSON.stringify([
      { id: "one", name: "One", animationName: "one", className: "ms-one", keyframes: "0% { opacity: 0; } 100% { opacity: 1; }" },
      { id: "two", name: "Two", animationName: "two", className: "ms-two", keyframes: "0% { opacity: 1; } 100% { opacity: 0; }" },
    ]));

    const storage = await import("../scripts/storage.js");
    const records = await storage.loadAnimations();
    await storage.saveAnimation({ ...records[0], name: "Updated One" });

    let stored = JSON.parse(values.get("motion-shelf.animations.session.v4"));
    assert.equal(stored.length, 2);
    assert.equal(stored.find((record) => record.id === "one").name, "Updated One");

    await storage.removeAnimationRecords(["two"]);
    stored = JSON.parse(values.get("motion-shelf.animations.session.v4"));
    assert.deepEqual(stored.map((record) => record.id), ["one"]);
  } finally {
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
  }
});
