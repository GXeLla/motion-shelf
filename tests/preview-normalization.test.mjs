import test from "node:test";
import assert from "node:assert/strict";

import { normalizePreviewViewportUnits } from "../scripts/animations.js";

test("card previews bound viewport-relative keyframe travel", () => {
  const source = "from { transform: translateX(-100vw); } to { transform: translateY(80vh); }";
  const preview = normalizePreviewViewportUnits(source);

  assert.match(preview, /translateX\(-120px\)/);
  assert.match(preview, /translateY\(72px\)/);
  assert.equal(normalizePreviewViewportUnits("to { opacity: 1; }"), "to { opacity: 1; }");
});
