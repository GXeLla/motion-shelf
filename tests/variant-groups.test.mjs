import test from "node:test";
import assert from "node:assert/strict";
import { featuredVariants } from "../scripts/variant-groups.js";

const blinks = Array.from({ length: 7 }, (_, i) => ({
  id: `blink-${i + 1}`, name: i === 0 ? "Blink" : `Blink ${i + 1}`,
  origin: { occurrences: i === 5 ? 100 : 10, familyFingerprint: `family-${i}` },
}));

test("All shows the most used numbered variant plus every favourited variant", () => {
  assert.deepEqual(featuredVariants(blinks).map(a => a.id), ["blink-6"]);
  assert.deepEqual(featuredVariants(blinks, id => ["blink-1", "blink-3"].includes(id)).map(a => a.id),
    ["blink-1", "blink-3", "blink-6"]);
  assert.deepEqual(featuredVariants(blinks, id => id === "blink-6").map(a => a.id), ["blink-6"]);
  assert.equal(blinks.length, 7, "grouping never deletes records");
});

test("distinct names and manual animations stay visible; usage ties remain stable", () => {
  const manual = { id: "manual", name: "Blink 2", origin: null };
  const other = { id: "other", name: "Star blink", origin: { occurrences: 200 } };
  assert.deepEqual(featuredVariants([...blinks, manual, other]).map(a => a.id), ["blink-6", "manual", "other"]);
  const equal = blinks.filter((_, i) => i !== 5);
  assert.deepEqual(featuredVariants(equal), featuredVariants([...equal].reverse()));
});

test("search, filters, selection and Show all variants reveal the full set", async () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const { state } = await import("../scripts/state.js");
  const { getVisibleAnimations } = await import("../scripts/filters.js");
  const { toggleFavourite } = await import("../scripts/favourites.js");
  const previous = { ...state };
  try {
    Object.assign(state, { animations: blinks, selectedFilters: [], searchTerm: "", sourceFolder: "", selectionMode: false, showAllVariants: false });
    assert.equal(getVisibleAnimations().length, 1);
    toggleFavourite("blink-1");
    assert.equal(getVisibleAnimations().length, 2);
    toggleFavourite("blink-1");
    state.searchTerm = "blink";
    assert.equal(getVisibleAnimations().length, 7);
    state.searchTerm = "";
    state.selectionMode = true;
    assert.equal(getVisibleAnimations().length, 7);
    state.selectionMode = false;
    state.showAllVariants = true;
    assert.equal(getVisibleAnimations().length, 7);
    state.showAllVariants = false;
    state.selectedFilters = ["campaigns"];
    state.animations = blinks.map(a => ({ ...a, origin: { ...a.origin, sources: [{ repository: "campaigns" }] } }));
    assert.equal(getVisibleAnimations().length, 7);

    state.selectedFilters = [];
    state.showAllVariants = true;
    state.animations = [{
      ...blinks[0],
      name: "Visible Name",
      animationName: "visibleKeyframe",
      className: "ms-visible-name",
      description: "Search-only-old-description",
      categories: ["scale"],
    }];
    state.searchTerm = "search-only-old-description";
    assert.equal(getVisibleAnimations().length, 0, "description no longer participates in names-only search");
    state.searchTerm = "visiblekeyframe";
    assert.equal(getVisibleAnimations().length, 1);
  } finally {
    Object.assign(state, previous);
    globalThis.localStorage = previousStorage;
  }
});
