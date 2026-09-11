import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRenderedTimeline, getPreviewHint } from "../scripts/preview-hint.js";
import {
  applyRuntimeAuditRecord,
  runtimeAuditSignature,
  samplePositionsForAnimation,
} from "../scripts/runtime-audit.js";

function state(progress, options = {}) {
  const x = options.x || 0;
  const scale = options.scale ?? 1;
  return {
    progress, frame: [320, 180], center: [160 + x, 90], box: [80 + x, 45, options.width ?? 160 * scale, options.height ?? 90 * scale],
    matrix: [scale, 0, 0, 0, scale, 0, 0, 0, 1], opacity: options.opacity ?? 1,
    filterValues: options.filterValues || [], color: options.color || [255, 255, 255],
    backgroundColor: options.backgroundColor || [0, 0, 0], borderWidth: options.borderWidth || 0,
    borderColor: options.borderColor || [0, 0, 0], boxShadow: options.boxShadow || "none",
    textShadow: "none", clipPath: options.clipPath || "none", mask: "none",
    backgroundPosition: "0% 0%", objectPosition: "50% 50%",
  };
}

function hint(samples, duration, interaction = "appear") {
  return analyzeRenderedTimeline(samples, duration, interaction).hint;
}

test("duration alone never creates slow or too-fast warnings", () => {
  assert.equal(hint([state(0), state(.5, { x: 150 }), state(1, { x: 300 })], 15, "infinite"), "");
  assert.equal(hint([state(0), state(1, { x: 60, scale: 1.2, opacity: 0 })], .6), "");
  assert.equal(hint([state(0), state(1, { x: 40 })], .7), "");
});

test("perceptual magnitude distinguishes subtle, slow-subtle and strong excursions", () => {
  assert.equal(hint([state(0), state(1, { x: 1 })], 1), "Subtle motion");
  assert.equal(hint([state(0), state(.5, { x: 1 }), state(1)], 10, "infinite"), "Slow & subtle");
  assert.equal(hint([state(0), state(.0613), state(.5307, { scale: 1.08 }), state(1)], 16.3, "infinite"), "Slow & subtle");
  assert.equal(hint([state(0), state(.5, { scale: 1.5 }), state(1)], 2), "");
  assert.equal(hint([state(0), state(.25, { x: 100 }), state(.5, { x: -100 }), state(.75, { x: 100 }), state(1)], 4, "infinite"), "");
});

test("compressed and delayed meaningful motion are classified from rendered intervals", () => {
  assert.equal(hint([state(0), state(.49), state(.52, { x: 120, opacity: 0 }), state(1, { x: 120, opacity: 0 })], 2), "Too fast");
  assert.equal(hint([state(0), state(1, { x: 120, opacity: 0 })], .08), "Too fast");
  assert.equal(hint([state(0), state(1, { x: 120, opacity: 0 })], .14), "");
  assert.equal(hint([state(0), state(1, { x: 120, opacity: 0 })], .3), "");
  assert.equal(hint([state(0), state(.45, { x: 2 }), state(.55, { x: 200 }), state(1, { x: 300 })], 5.5), "Late motion");
  assert.equal(hint([state(0, { x: -100 }), state(.7, { x: 10 }), state(1)], 1.2), "");
  assert.equal(hint([
    state(0, { x: 150, scale: 1 }),
    state(.2, { x: 120, scale: 1.2 }),
    state(.4, { x: 90, scale: 1.4 }),
    state(.6, { x: 60, scale: 1.6 }),
    state(.8, { x: 30, scale: 1.8 }),
    state(1, { x: 0, scale: 2 }),
  ], 1), "");
});

test("late motion combines real inactivity time with timeline proportion", () => {
  assert.equal(hint([
    state(0, { width: 96 }), state(.08, { width: 96 }), state(.2, { width: 150 }),
    state(.38, { width: 256 }), state(.5, { width: 256 }), state(.75, { width: 96 }), state(1, { width: 96 }),
  ], 8, "infinite"), "Late motion");

  assert.equal(hint([
    state(0, { opacity: 0 }), state(.4, { opacity: 0 }), state(1, { opacity: 1, scale: 1.41 }),
  ], .5), "");
});

test("property-only rendered changes provide useful fallback hints", () => {
  assert.equal(hint([state(0), state(1, { boxShadow: "0 0 20px #000" })], 1), "Shadow effect");
  assert.equal(hint([state(0), state(1, { borderWidth: 4 })], 1), "Border effect");
  assert.equal(hint([state(0), state(1, { filterValues: [3] })], 1), "Filter effect");
});

test("cards only consume the persisted runtime result", () => {
  assert.equal(getPreviewHint({ previewHint: "Slow & subtle" }), "Slow & subtle");
  assert.equal(getPreviewHint({ duration: 20 }), "");
});

test("custom animations keep runtime hints without entering Sync quarantine", () => {
  const record = {
    kind: "no visible effect",
    reason: "No visible property change",
    previewHint: "Subtle motion",
    perception: { confidence: .91 },
  };
  const custom = { id: "custom" };
  applyRuntimeAuditRecord(custom, record, { quarantineBroken: false });

  assert.equal(custom.previewHint, "Subtle motion");
  assert.equal(custom.audit.status, "no visible effect");
  assert.notEqual(custom.audit.status, "broken / quarantined");

  const imported = { id: "imported" };
  applyRuntimeAuditRecord(imported, record);
  assert.equal(imported.audit.status, "broken / quarantined");
});

test("live audit reuse follows rendered behavior rather than names or provenance", () => {
  const base = {
    name: "First name",
    animationName: "firstKeyframes",
    target: "div",
    interaction: "appear",
    duration: 1,
    durationUnit: "s",
    easing: "ease-in-out",
    css: "--ms-distance: 20px; opacity: 1;",
    parent: "position: relative;",
    keyframes: "from { transform: translateX(var(--ms-distance)); } to { transform: translateX(0); }",
    origin: { familyFingerprint: "one" },
  };
  const renamed = {
    ...base,
    name: "Different name",
    animationName: "differentKeyframes",
    origin: { familyFingerprint: "two" },
  };

  assert.equal(runtimeAuditSignature(base), runtimeAuditSignature(renamed));
  assert.notEqual(runtimeAuditSignature(base), runtimeAuditSignature({ ...base, duration: 4 }));
});

test("runtime audit schedules keyframe samples per animation", () => {
  const simple = samplePositionsForAnimation({
    animationName: "simple",
    keyframes: "0% { opacity: 0; } 100% { opacity: 1; }",
  });
  const detailed = samplePositionsForAnimation({
    animationName: "detailed",
    keyframes: "0% { opacity: 0; } 23% { opacity: .2; } 77% { opacity: .8; } 100% { opacity: 1; }",
  });

  assert.equal(simple.includes(.23), false);
  assert.equal(detailed.includes(.23), true);
  assert.equal(detailed.includes(.77), true);
  assert.equal(detailed.includes(.22), true);
  assert.equal(detailed.includes(.78), true);
});
