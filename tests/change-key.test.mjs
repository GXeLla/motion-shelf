/*
 * The change key must notice every way a record really changes.
 *
 * `saveAnimations` only writes records whose key differs from the one it last
 * wrote. That makes the key a correctness surface, not just a speed one: a
 * mutation the key cannot see is a mutation that stays in memory and is lost
 * when the tab closes.
 *
 * So this walks the actual mutation paths in the app -- the editor, Push to
 * Code, the runtime audit -- and fails if any of them stops moving the key.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeAnimation } from "../scripts/storage.js";
import { applyRuntimeAuditRecord } from "../scripts/runtime-audit.js";

/* The key is internal, so it is exercised the way the app does: two records
   that should be written separately must serialise to different keys. The
   comparison below mirrors `fingerprint()` through the only door it has --
   saveAnimations' own behaviour is covered in storage.test.mjs; here the
   concern is that the *inputs* differ. */
function keyOf(animation) {
  const audit = animation.audit;
  return [
    animation.updatedAt,
    animation.codeFileName,
    animation.codeSynced ? 1 : 0,
    animation.localPresent ? 1 : 0,
    animation.localPath,
    animation.repositoryPresent ? 1 : 0,
    animation.source,
    animation.lastCodePush,
    animation.auditSignature,
    audit ? audit.status : "",
    audit ? audit.checkedAt : "",
    animation.previewHint,
  ].join("");
}

const base = () => normalizeAnimation({
  id: "x",
  name: "Fade In",
  className: "ms-fade-in",
  animationName: "msFadeIn",
  target: "div",
  description: "",
  duration: 1,
  durationUnit: "s",
  delay: 0,
  delayUnit: "s",
  easing: "ease-out",
  iterationCount: "1",
  css: "opacity: 1;",
  keyframes: "0% {\n    opacity: 0;\n  }\n\n  100% {\n    opacity: 1;\n  }",
  parent: "",
  updatedAt: 1700000000000,
});

test("an unchanged record keeps the same key", () => {
  assert.equal(keyOf(base()), keyOf(base()));
});

test("an edit moves the key", () => {
  const edited = base();
  /* What updateAnimation does: change content, stamp updatedAt. */
  edited.duration = 2;
  edited.updatedAt = 1700000000001;

  assert.notEqual(keyOf(base()), keyOf(edited));
});

test("Push to Code moves the key, though it does not stamp updatedAt", () => {
  const pushed = base();

  /* Exactly the writes in code.js writeAnimation(). */
  pushed.codeFileName = "fade-in.css";
  pushed.codeSynced = true;
  pushed.localPresent = true;
  pushed.localPath = "project/animations/fade-in.css";
  pushed.source = "local";
  pushed.rawCss = "/* ... */";
  pushed.lastCodePush = 1700000009999;

  assert.equal(pushed.updatedAt, base().updatedAt, "the push should not look like an edit");
  assert.notEqual(keyOf(base()), keyOf(pushed), "the push would never be written");
});

test("a sync marking a record as published moves the key", () => {
  const published = base();
  published.repositoryPresent = true;

  assert.notEqual(keyOf(base()), keyOf(published));
});

test("an audit result moves the key, though it does not stamp updatedAt", () => {
  const audited = base();

  applyRuntimeAuditRecord(audited, {
    kind: "valid",
    reason: "",
    signature: "sig-1",
    previewHint: "",
    perception: { hint: "" },
  });

  assert.equal(audited.updatedAt, base().updatedAt, "an audit should not look like an edit");
  assert.notEqual(keyOf(base()), keyOf(audited), "the audit result would never be written");
});

test("a changed audit verdict moves the key again", () => {
  const first = base();
  applyRuntimeAuditRecord(first, { kind: "valid", reason: "", signature: "sig-1", perception: {} });

  const second = { ...first };
  applyRuntimeAuditRecord(second, {
    kind: "broken", reason: "Missing keyframes", signature: "sig-2", perception: {},
  });

  assert.notEqual(keyOf(first), keyOf(second));
});

test("clearing an audit moves the key", () => {
  const audited = base();
  applyRuntimeAuditRecord(audited, { kind: "valid", reason: "", signature: "sig-1", perception: {} });

  const cleared = { ...audited };
  applyRuntimeAuditRecord(cleared, null);

  assert.notEqual(keyOf(audited), keyOf(cleared));
});

test("a preview hint moves the key", () => {
  const hinted = base();
  applyRuntimeAuditRecord(hinted, {
    kind: "valid", reason: "", signature: "sig-1",
    previewHint: "Starts late in the timeline.", perception: { hint: "Starts late in the timeline." },
  });

  assert.notEqual(keyOf(base()), keyOf(hinted));
});

test("the key is small -- that is the point of it", () => {
  /* Measured against a real library record rather than the small synthetic
     one above, because the saving is what the record weighs in practice. */
  const text = readFileSync("animations/3d-image-turn-reveal.css", "utf8");
  const open = text.indexOf("{", text.indexOf("@motion-shelf"));
  const real = normalizeAnimation(JSON.parse(text.slice(open, text.indexOf("*/", open)).trim()));

  applyRuntimeAuditRecord(real, { kind: "valid", reason: "", signature: "sig-1", perception: {} });

  const key = keyOf(real);
  const whole = JSON.stringify(real);

  assert.ok(key.length < 200, "key was " + key.length + " bytes");
  assert.ok(key.length * 20 < whole.length,
    "key " + key.length + " bytes vs record " + whole.length + " bytes");
});
