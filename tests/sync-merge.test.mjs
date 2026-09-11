import test from "node:test";
import assert from "node:assert/strict";
import { mergeImportOrigins, mergeScannedAnimation } from "../scripts/sync-merge.js";
import { buildExportCSS } from "../scripts/animations.js";
import { parseAnimationFile } from "../scripts/filesystem.js";
import { normalizeAnimation } from "../scripts/storage.js";

const scanned = {
  name: "Soft fade", animationName: "msSoftFade", className: "ms-soft-fade",
  css: "opacity: 0;", keyframes: "from { opacity: 0; } to { opacity: 1; }",
  origin: { familyFingerprint: "fade", occurrences: 4, sources: [] },
};

function savedAnimation() {
  return normalizeAnimation({
    ...scanned, id: "saved-fade", createdAt: 100, updatedAt: 200,
    codeFileName: "my-fade.css", codeSynced: true, localPresent: true,
    repositoryPresent: true, source: "local", localPath: "project/animations/my-fade.css",
    lastCodePush: 300,
  });
}

test("unchanged sync retains the object, export bytes, timestamps and filename", () => {
  const existing = savedAnimation();
  const css = buildExportCSS(existing);
  assert.equal(mergeScannedAnimation(scanned, existing), existing);
  const reloaded = parseAnimationFile(css, "my-fade.css", 400);
  assert.equal(mergeScannedAnimation(scanned, reloaded), reloaded);
  assert.equal(buildExportCSS(reloaded), css);
});

test("changed motion and provenance require a write but keep the saved identity", () => {
  const existing = savedAnimation();
  for (const changed of [
    { ...scanned, duration: 2.5 },
    { ...scanned, origin: { ...scanned.origin, occurrences: 5 } },
  ]) {
    const merged = mergeScannedAnimation(changed, existing);
    assert.notEqual(merged, existing);
    assert.equal(merged.id, existing.id);
    assert.equal(merged.codeFileName, existing.codeFileName);
    assert.equal(merged.createdAt, 100);
    assert.ok(merged.updatedAt > 200);
    assert.equal(merged.codeSynced, false);
    assert.equal(existing.codeSynced, true);
    assert.notEqual(buildExportCSS(merged), buildExportCSS(existing));
    assert.equal(mergeScannedAnimation(changed, merged), merged);
  }
});

test("new imports remain unsaved session records", () => {
  const fresh = mergeScannedAnimation(scanned);
  assert.ok(fresh.id);
  assert.equal(fresh.source, "session");
  assert.equal(fresh.codeSynced, false);
  assert.equal(fresh.localPresent, false);
});

test("semantic reconciliation preserves sources from historic timing variants", () => {
  const merged = mergeImportOrigins(
    {
      occurrences: 3,
      variants: 1,
      sources: [{ repository: "campaigns", folder: "A", file: "blink-24.css", type: "css" }],
      variantNames: [{ name: "Blink 2", occurrences: 3 }],
    },
    {
      occurrences: 5,
      variants: 1,
      sources: [{ repository: "campaigns", folder: "B", file: "blink-75.css", type: "css" }],
      variantNames: [{ name: "Blink 3", occurrences: 5 }],
    },
  );

  assert.equal(merged.occurrences, 5);
  assert.equal(merged.sources.length, 2);
  assert.deepEqual(merged.variantNames.map((variant) => variant.name), ["Blink 2", "Blink 3"]);
});

test("canonical imports use a consistent, overridable quarter-second delay", () => {
  const canonical = normalizeAnimation({
    name: "Imported fade",
    css: "--ms-delay: 4s;\ncolor: red;",
    delay: 4,
    delayUnit: "s",
    origin: { familyFingerprint: "fade", sources: [] },
    parameters: {
      target: [{ name: "--ms-delay", value: "4s", kind: "time" }],
      parent: [],
    },
  });

  assert.equal(canonical.delay, 0.25);
  assert.equal(canonical.delayUnit, "s");
  assert.match(canonical.css, /--ms-delay: 0\.25s;/);
  assert.equal(canonical.parameters.target[0].value, "0.25s");
});
