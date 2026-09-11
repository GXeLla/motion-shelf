import test from "node:test";
import assert from "node:assert/strict";

import { assessPreviewSafety } from "../scripts/preview-safety.js";

test("permanently hidden imports are rejected while large motion is preview-normalized", () => {
  assert.equal(assessPreviewSafety({ steps: [
    { declarations: { opacity: "0", transform: "translateX(-100vw)" } },
    { declarations: { opacity: "0", transform: "translateX(0)" } },
  ] }).valid, false);

  const moving = assessPreviewSafety({ steps: [
    { declarations: { opacity: "0", transform: "translateX(-100vw)" } },
    { declarations: { opacity: "1", transform: "translateX(0)" } },
  ] });
  assert.equal(moving.valid, true);
  assert.equal(moving.previewNormalize, true);
});
