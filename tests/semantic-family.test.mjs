import test from "node:test";
import assert from "node:assert/strict";

import { AnimationLibrary } from "../scripts/animation-extract.js";
import { buildCanonicalLibrary, detectContainerNeeds, familyFingerprint } from "../scripts/animation-family.js";

function blink(offset, name) {
  return {
    kind: "css",
    originalName: name,
    selector: "." + name.toLowerCase(),
    target: "div",
    interaction: "appear",
    support: { element: {}, parent: {} },
    timing: {
      duration: 1,
      delay: 0,
      easing: "linear",
      iterationCount: "1",
      direction: "normal",
    },
    steps: [
      { offset: 0, declarations: { visibility: "visible" } },
      { offset: offset - 1, declarations: { visibility: "visible" } },
      { offset, declarations: { visibility: "hidden" } },
      { offset: 100, declarations: { visibility: "hidden" } },
    ],
  };
}

test("timing-only state holds collapse into one semantic family", () => {
  const library = new AnimationLibrary();
  const first = blink(24, "Blink 2");
  const second = blink(75, "Blink 3");

  library.add(first, { repository: "campaigns", folder: "A", file: "one.css", type: "css" });
  library.add(second, { repository: "campaigns", folder: "B", file: "two.css", type: "css" });

  const canonical = buildCanonicalLibrary(library.allEntries());
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].name, "Blink");
  assert.equal(canonical[0].origin.variants, 2);
  assert.equal(canonical[0].origin.sources.length, 2);
});

test("semantic families retain interaction, target and parent requirements", () => {
  const steps = blink(24, "Blink").steps;
  const base = familyFingerprint(steps, {
    interaction: "appear", target: "div", support: { element: {}, parent: {} },
  });

  assert.notEqual(base, familyFingerprint(steps, {
    interaction: "hover", target: "div", support: { element: {}, parent: {} },
  }));
  assert.notEqual(base, familyFingerprint(steps, {
    interaction: "appear", target: "img", support: { element: {}, parent: {} },
  }));
  assert.notEqual(base, familyFingerprint(steps, {
    interaction: "appear", target: "div", support: { element: {}, parent: { overflow: "hidden" } },
  }));
});

test("viewport-relative motion receives a safe clipping parent", () => {
  const scoped = detectContainerNeeds([
    { offset: 0, declarations: { transform: "translateX(-100vw)" } },
    { offset: 100, declarations: { transform: "translateX(0)" } },
  ]);

  assert.equal(scoped.parent.overflow, "hidden");
});
