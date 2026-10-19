import test from "node:test";
import assert from "node:assert/strict";
import { mergeImportOrigins, mergeScannedAnimation, uniqueImportedClasses, planNewImports } from "../scripts/sync-merge.js";
import { buildExportCSS } from "../scripts/animations.js";
import { parseAnimationFile } from "../scripts/filesystem.js";
import { normalizeAnimation } from "../scripts/storage.js";

const scanned = {
  name: "Soft fade", animationName: "msSoftFade", className: "ms-soft-fade",
  css: "opacity: 0;", keyframes: "from { opacity: 0; } to { opacity: 1; }",
  origin: { familyFingerprint: "fade", occurrences: 4, sources: [] },
};

test("add-only sync preserves existing records even when rescanned data changes", () => {
  const saved = savedAnimation();
  const current = [saved, { ...saved, id: "legacy-duplicate" }];
  const snapshot = structuredClone(current);
  const result = planNewImports(current, [{ ...scanned, id: "rescanned", duration: 99, audit: { status: "valid", reason: "changed" } }]);
  assert.equal(result.added, 0);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(result.candidates, snapshot);
  assert.equal(result.candidates[0], saved);
  assert.equal(result.candidates[1], current[1]);
});

test("add-only sync lists only new usable records and preserves existing class names", () => {
  const saved = savedAnimation();
  const fresh = { ...scanned, id: "new", name: "New motion", origin: { familyFingerprint: "new-family" } };
  const result = planNewImports([saved], [
    scanned, fresh, fresh,
    { ...fresh, id: "deleted", origin: { familyFingerprint: "deleted" } },
    { ...fresh, id: "broken", origin: { familyFingerprint: "broken" }, audit: { status: "broken / quarantined" } },
  ], { isDeleted: id => id === "deleted" });
  assert.equal(result.added, 1);
  assert.deepEqual(result.newAnimations.map(animation => animation.name), ["New motion"]);
  assert.equal(result.candidates[0], saved);
  assert.notEqual(result.newAnimations[0].className, saved.className);
  assert.equal(planNewImports(result.candidates, [fresh]).added, 0);
});

test("imported class names cannot collide with custom suffixed names or each other", () => {
  const manual = [{className:"fade"}, {className:"fade-imported"}, {className:"fade-imported-2"}];
  const imported = [{id:"a",className:"fade"}, {id:"b",className:"fade"}, {id:"c",className:"unique"}];
  const result = uniqueImportedClasses(imported, manual);
  assert.deepEqual(result.map(a=>a.className), ["fade-imported-3", "fade-imported-4", "unique"]);
  assert.equal(result[2], imported[2]);
  assert.equal(imported[0].className,"fade");
});

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
