import test from "node:test";
import assert from "node:assert/strict";

/*
 * Records written by an older version of Motion Shelf.
 *
 * loadAnimations normalizes them on the way in and is supposed to write the
 * upgraded shape back. It did not: the marker was read from records the
 * mapping had already stripped it from, and the write went through the change
 * check, which had just been primed with those very records and so found
 * nothing to do. The record stayed in its old shape, was re-normalized on
 * every load, and -- having no stored updatedAt -- collected a fresh one each
 * session, which floated it to the top of the library as the newest thing in
 * it. None of that is visible from the outside, so it is worth a test.
 */

/* A small in-memory stand-in for the parts of IndexedDB storage.js uses. */
function fakeIndexedDb(seed = []) {
  const stores = { animations: new Map(seed.map((record) => [record.id, record])), meta: new Map() };

  const request = (run) => {
    const handle = { onsuccess: null, onerror: null, result: undefined, error: null };
    setTimeout(() => {
      try {
        handle.result = run();
        handle.onsuccess?.();
      } catch (error) {
        handle.error = error;
        handle.onerror?.();
      }
    }, 0);
    return handle;
  };

  const objectStore = (name) => ({
    getAll: () => request(() => [...stores[name].values()].map((record) => ({ ...record }))),
    get: (key) => request(() => stores[name].get(key)),
    put: (value, key) => request(() => stores[name].set(key ?? value.id, { ...value })),
    delete: (key) => request(() => stores[name].delete(key)),
  });

  const transaction = () => {
    let completed = false;
    let handler = null;
    /* Completion may land before or after storage.js attaches its handler, so
       the handler is invoked whenever both have happened. */
    const settle = () => { if (completed && handler) handler(); };
    setTimeout(() => { completed = true; settle(); }, 5);
    return {
      objectStore,
      set oncomplete(fn) { handler = fn; setTimeout(settle, 0); },
      get oncomplete() { return handler; },
      set onabort(_) {},
      set onerror(_) {},
      error: null,
    };
  };

  const database = {
    objectStoreNames: { contains: (name) => name in stores },
    createObjectStore: () => {},
    transaction,
    close() {},
  };

  return {
    stores,
    api: {
      open() {
        const handle = { onsuccess: null, onerror: null, onupgradeneeded: null, result: database, error: null };
        setTimeout(() => { handle.onupgradeneeded?.(); handle.onsuccess?.(); }, 0);
        return handle;
      },
    },
  };
}

async function freshStorage(tag) {
  return import("../scripts/storage.js?upgrade-test=" + tag);
}

function withDatabase(t, seed) {
  const fake = fakeIndexedDb(seed);
  const previousIndexedDb = globalThis.indexedDB;
  const previousSession = globalThis.sessionStorage;
  globalThis.indexedDB = fake.api;
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  t.after(() => {
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
  });
  return fake;
}

test("a record from an older version is upgraded on disk, not just in memory", async (t) => {
  const fake = withDatabase(t, [
    { id: "legacy-1", name: "Legacy One", css: "", keyframes: "from { opacity: 0; } to { opacity: 1; }" },
  ]);

  const storage = await freshStorage("legacy");
  const loaded = await storage.loadAnimations();

  assert.equal(loaded.length, 1);
  assert.ok(loaded[0].className, "normalized in memory");

  const onDisk = fake.stores.animations.get("legacy-1");
  assert.equal(onDisk.__motionShelfSchema, 1, "the upgraded shape reached storage");
  assert.ok(onDisk.className, "and carries the normalized fields");
  assert.ok(onDisk.updatedAt, "and a stamp, so it stops being re-dated every session");

  /* Loading again must find nothing left to do, and must not move the stamp. */
  const stamp = onDisk.updatedAt;
  const again = await freshStorage("legacy-again");
  const reloaded = await again.loadAnimations();
  assert.equal(fake.stores.animations.get("legacy-1").updatedAt, stamp,
    "a second load leaves the record alone");
  assert.equal(reloaded[0].updatedAt, stamp);
});

test("a save that is not replacing the library removes nothing", async (t) => {
  const fake = withDatabase(t, [
    { __motionShelfSchema: 1, id: "kept", name: "Kept", className: "ms-kept", animationName: "msKept", css: "", keyframes: "from { opacity: 0; } to { opacity: 1; }", createdAt: 100, updatedAt: 100 },
    { __motionShelfSchema: 1, id: "absent", name: "Absent", className: "ms-absent", animationName: "msAbsent", css: "", keyframes: "from { opacity: 0; } to { opacity: 1; }", createdAt: 100, updatedAt: 100 },
  ]);

  const storage = await freshStorage("replace");
  const loaded = await storage.loadAnimations();
  assert.equal(loaded.length, 2);

  /* What the load paths do: publish the records the session is holding, while
     saying nothing about the ones it deliberately left out of state. */
  await storage.saveAnimations(loaded.filter((record) => record.id === "kept"), { replace: false });
  assert.deepEqual([...fake.stores.animations.keys()].sort(), ["absent", "kept"],
    "a record left out of the list survives");

  /* Sync, on the other hand, is a replacement and still removes. */
  await storage.saveAnimations(loaded.filter((record) => record.id === "kept"), { replace: true });
  assert.deepEqual([...fake.stores.animations.keys()], ["kept"]);
});

test("current-schema records are loaded without being rewritten", async (t) => {
  const fake = withDatabase(t, [{
    __motionShelfSchema: 1,
    id: "current-1", name: "Current One", className: "ms-current-one",
    animationName: "msCurrentOne", css: "", keyframes: "from { opacity: 0; } to { opacity: 1; }",
    createdAt: 100, updatedAt: 100,
  }]);

  let writes = 0;
  const stored = fake.stores.animations;
  const put = stored.set.bind(stored);
  stored.set = (key, value) => { writes += 1; return put(key, value); };

  const storage = await freshStorage("current");
  const loaded = await storage.loadAnimations();

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].updatedAt, 100, "the stored stamp is kept");
  assert.equal(writes, 0, "nothing is written when nothing needs upgrading");
});
