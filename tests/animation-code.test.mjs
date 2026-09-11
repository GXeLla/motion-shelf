/*
 * The copied code: what is in it, what is not, and that every copy button in
 * the app is looking at the same thing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  buildAnimationClass,
  buildAnimationSections,
  buildKeyframes,
  buildParentClass,
  buildWholeAnimation,
  requiresParentClass,
} from "../scripts/animation-code.js";

import { normalizeAnimation } from "../scripts/storage.js";

const library = readdirSync("animations")
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync("animations/" + name, "utf8"))
  .filter((text) => text.includes("@motion-shelf"))
  .map((text) => {
    const open = text.indexOf("{", text.indexOf("@motion-shelf"));
    return normalizeAnimation(JSON.parse(text.slice(open, text.indexOf("*/", open)).trim()));
  });

test("the library was read", () => {
  assert.equal(library.length, 7);
});

test("nothing internal reaches the clipboard", () => {
  for (const animation of library) {
    const copied = buildWholeAnimation(animation);

    assert.ok(!copied.includes("@motion-shelf"), animation.className + " leaks the metadata block");
    assert.ok(!copied.includes("Motion Shelf"), animation.className + " leaks the header");
    /* Deliberately not a bare /origin/ -- `transform-origin` is a required
       style, and matching it would be the test failing the code for being
       correct. These are the record's own bookkeeping keys. */
    assert.ok(!/familyFingerprint|exactFingerprint|originalName|originalSelector|"occurrences"|"repository"/i.test(copied),
      animation.className + " leaks provenance");
    assert.ok(!/campaigns\/|previews-only\//.test(copied), animation.className + " leaks a source path");
    assert.ok(!/"template"|"parameters"|"variantNames"/.test(copied),
      animation.className + " leaks internal metadata");
    assert.ok(!/Parent properties|\/\* Animation \*\/|\/\* Keyframes \*\//.test(copied),
      animation.className + " still has the old banner comments");
    assert.ok(!/\n{3,}/.test(copied), animation.className + " has runs of blank lines");
  }
});

test("only three comments, one per block", () => {
  for (const animation of library) {
    const comments = buildWholeAnimation(animation).match(/\/\*[\s\S]*?\*\//g) || [];

    assert.equal(comments.length, 3, animation.className);
    assert.match(comments[0], /^\/\* Add class="ms-[\w-]+-parent" to the parent element\. \*\/$/);
    assert.match(comments[1], /^\/\* Add class="ms-[\w-]+" to the element you want to animate\. \*\/$/);
    assert.match(comments[2], /^\/\* Keyframes used by \.ms-[\w-]+ \*\/$/);
  }
});

test("the variables survive", () => {
  for (const animation of library) {
    const copied = buildWholeAnimation(animation);

    assert.match(copied, /animation-duration: var\(--ms-duration, [^)]+\)/, animation.className);
    assert.match(copied, /animation-delay: var\(--ms-delay, [^)]+\)/, animation.className);
    assert.match(copied, /animation-timing-function: var\(--ms-ease, /, animation.className);
  }
});

test("required target styles survive", () => {
  const turn = library.find((entry) => entry.className === "ms-3d-image-turn-reveal");
  const css = buildAnimationClass(turn);

  for (const property of ["object-fit", "object-position", "transform-origin", "backface-visibility", "will-change"]) {
    assert.ok(css.includes(property + ":"), property + " was dropped");
  }
});

test("the container keeps what belongs to it, and the element does not", () => {
  const turn = library.find((entry) => entry.className === "ms-3d-image-turn-reveal");

  assert.match(buildParentClass(turn), /perspective: var\(--ms-perspective, 1200px\)/);
  assert.ok(!/[^-]perspective:/.test(buildAnimationClass(turn)), "perspective moved onto the child");
});

test("the whole is exactly its parts", () => {
  for (const animation of library) {
    const parts = [buildParentClass(animation), buildAnimationClass(animation), buildKeyframes(animation)]
      .filter(Boolean)
      .join("\n\n");

    assert.equal(buildWholeAnimation(animation), parts, animation.className);
  }
});

test("the sections shown are the sections copied", () => {
  for (const animation of library) {
    const sections = buildAnimationSections(animation);

    assert.deepEqual(sections.map((section) => section.key), ["animation", "parent", "keyframes"]);

    /* Every rendered section appears verbatim in the whole-animation copy. */
    const whole = buildWholeAnimation(animation);
    sections.forEach((section) => assert.ok(whole.includes(section.code), section.label));
  }
});

test("an animation with no container produces no container block", () => {
  const flat = normalizeAnimation({
    id: "flat", name: "Fade In", className: "ms-fade-in", animationName: "msFadeIn",
    target: "div", description: "", duration: 0.8, durationUnit: "s", delay: 0, delayUnit: "s",
    easing: "ease-out", iterationCount: "1",
    css: "opacity: 1;", keyframes: "0% {\n    opacity: 0;\n  }\n\n  100% {\n    opacity: 1;\n  }",
    parent: "",
  });

  assert.equal(requiresParentClass(flat), false);
  assert.equal(buildParentClass(flat), "");
  assert.deepEqual(buildAnimationSections(flat).map((section) => section.key), ["animation", "keyframes"]);

  const copied = buildWholeAnimation(flat);
  assert.ok(!copied.includes("-parent"), "an empty container block was emitted");
  assert.ok(!copied.includes("{\n}"), "an empty rule was emitted");
  assert.match(copied, /^\/\* Add class="ms-fade-in"/);
});

test("a hover animation arms on hover, not on load", () => {
  const hover = normalizeAnimation({
    id: "hover", name: "Lift", className: "ms-lift", animationName: "msLift",
    target: "div", description: "", duration: 0.4, durationUnit: "s", delay: 0, delayUnit: "s",
    easing: "ease-out", iterationCount: "1", interaction: "hover",
    css: "transform-origin: center;", keyframes: "0% {\n    transform: scale(1);\n  }\n\n  100% {\n    transform: scale(1.05);\n  }",
    parent: "",
  });

  const css = buildAnimationClass(hover);

  assert.match(css, /\.ms-lift \{[^}]*transform-origin/);
  assert.match(css, /\.ms-lift:hover \{[^}]*animation-name: msLift;/);
  assert.ok(!/\.ms-lift \{[^}]*animation-name/.test(css), "it would run before anyone hovered");
});

test("keyframes stand on their own", () => {
  for (const animation of library) {
    const keyframes = buildKeyframes(animation);

    assert.match(keyframes, /^\/\* Keyframes used by \.ms-[\w-]+ \*\/\n@keyframes \w+ \{\n/);
    assert.ok(keyframes.endsWith("}"), animation.className);

    /* Every step indented inside the block, not left at column 0. */
    const steps = keyframes.split("\n").filter((line) => /^\s*\d+% \{/.test(line));
    assert.ok(steps.length >= 2, animation.className);
    steps.forEach((line) => assert.match(line, /^ {2}\d+% \{$/, animation.className + ": " + JSON.stringify(line)));
  }
});

test("an edited value is what gets copied", () => {
  const source = library.find((entry) => entry.className === "ms-3d-image-turn-reveal");

  const edited = normalizeAnimation({
    ...source,
    css: source.css.replace("--ms-rotation-y: 68deg;", "--ms-rotation-y: 120deg;"),
  });

  const copied = buildWholeAnimation(edited);

  assert.ok(copied.includes("--ms-rotation-y: 120deg;"), "the edit was lost");
  assert.ok(!copied.includes("--ms-rotation-y: 68deg;"), "the canonical value came back");
  /* And an untouched value still speaks through its own fallback. */
  assert.ok(!copied.includes("--ms-scale: 0.92;"), "an unchanged value was restated");
  assert.ok(copied.includes("var(--ms-scale, 0.92)"), "the unchanged value lost its variable");
});

test("the copied timing is the record's timing, not a stale declaration", () => {
  const source = library.find((entry) => entry.className === "ms-soft-image-breathing");

  /* What the editor does when somebody changes the duration field: the record
     is updated, the css keeps whatever `--ms-duration` it had. */
  const edited = normalizeAnimation({ ...source, duration: 7 });

  const copied = buildWholeAnimation(edited);

  assert.match(copied, /animation-duration: var\(--ms-duration, 7s\)/);
  assert.ok(!/--ms-duration\s*:/.test(copied),
    "a stale --ms-duration declaration would override the fallback and win");
  assert.ok(!/--ms-delay\s*:/.test(copied));
  assert.ok(!/--ms-ease\s*:/.test(copied));

  /* Everything that is not timing still speaks through its own variable. */
  assert.match(copied, /var\(--ms-perspective, /);
});
