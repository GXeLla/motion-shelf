import test from "node:test";
import assert from "node:assert/strict";
import { AnimationLibrary, extractCssAnimations } from "../scripts/animation-extract.js";
import { buildCanonicalLibrary } from "../scripts/animation-family.js";
import { scanSources } from "../scripts/campaign-scan.js";

function fixtureFiles() {
  const files = new Map();
  for (let index = 0; index < 16; index += 1) {
    const name = `float${index % 2 ? "Product" : "Image"}`;
    const path = `Brand/d${String(index).padStart(2, "0")}/style.css`;
    files.set(path, `
      @keyframes ${name} {
        from { transform: translateY(0); }
        to { transform: translateY(-${index < 8 ? 10 : 20}px); }
      }
      .${index % 2 ? "product" : "text"} {
        animation: ${name} ${1 + index % 2}s ease;
        transform-origin: ${index}% 50%;
      }
    `);
  }
  return files;
}

function canonical(records) {
  const library = new AnimationLibrary();
  for (const { record, origin } of records) library.add(record, origin);
  return JSON.stringify(buildCanonicalLibrary(library.allEntries()));
}

test("canonical support, selectors, variant names and source samples ignore arrival order", () => {
  const records = [...fixtureFiles()].flatMap(([file, css]) =>
    extractCssAnimations(css).animations.map((record) => ({
      record, origin: { repository: "campaigns", folder: "Brand", file, type: "css" },
    })));
  // Matching rules in the same file also need a stable representative.
  records.push({
    record: { ...records[0].record, selector: ".aaa", support: { element: { "transform-origin": "0 0" }, parent: {} } },
    origin: records[0].origin,
  });
  const expected = canonical(records);
  assert.equal(canonical([...records].reverse()), expected);

  let seed = 473;
  for (let run = 0; run < 30; run += 1) {
    const mixed = [...records];
    for (let index = mixed.length - 1; index > 0; index -= 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const other = Math.floor(seed / 2 ** 32 * (index + 1));
      [mixed[index], mixed[other]] = [mixed[other], mixed[index]];
    }
    assert.equal(canonical(mixed), expected, `shuffle ${run}`);
  }
});

test("cold and cached scans keep identical exports despite reversed listings and I/O timing", async () => {
  const files = fixtureFiles();
  const directories = new Map([
    ["", [{ kind: "directory", name: "Brand", path: "Brand" }]],
    ["Brand", []],
  ]);
  for (const [path, css] of files) {
    const directory = path.slice(0, path.lastIndexOf("/"));
    directories.get("Brand").push({ kind: "directory", name: directory.split("/").at(-1), path: directory });
    directories.set(directory, [{ kind: "file", name: "style.css", path, size: css.length, lastModified: 1 }]);
  }
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const scan = async (reverse, cache = null) => {
    let reads = 0;
    const result = await scanSources({
      roots: [{ repository: "campaigns", path: "" }], cache,
      adapter: {
        async list(path) {
          const index = Number(path.match(/d(\d+)/)?.[1] || 0);
          await pause(reverse ? index % 3 : 2 - index % 3);
          const listing = [...directories.get(path)];
          return reverse ? listing.reverse() : listing;
        },
        async read(path) {
          reads += 1;
          const index = Number(path.match(/d(\d+)/)?.[1] || 0);
          await pause(reverse ? 3 - index % 4 : index % 4);
          return files.get(path);
        },
      },
    });
    return { ...result, reads };
  };
  const cold = await scan(false);
  const reversedCold = await scan(true);
  const warm = await scan(true, cold.cache);
  assert.ok(cold.animations.length > 0);
  assert.equal(JSON.stringify(reversedCold.animations), JSON.stringify(cold.animations));
  assert.equal(JSON.stringify(warm.animations), JSON.stringify(cold.animations));
  assert.equal(cold.reads, files.size);
  assert.equal(warm.reads, 0);
  assert.equal(warm.stats.filesFromCache, files.size);
});
