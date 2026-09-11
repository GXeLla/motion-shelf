import test from "node:test";
import assert from "node:assert/strict";

import {
  animationCampaigns,
  collectCampaigns,
  describeOrigin,
  sourceBrand,
  sourceCampaign,
} from "../scripts/origin.js";

test("campaign provenance comes from the folder below the brand", () => {
  const source = { folder: "Brand A", file: "Brand A/CD_24_458_launch/style.css" };
  assert.equal(sourceCampaign(source), "CD_24_458_launch");
  assert.equal(sourceCampaign({ folder: "Brand A", file: "Brand A/style.css" }), "");
});

test("campaign lists are naturally ordered and can be narrowed by brand", () => {
  const animations = [
    { origin: { sources: [{ folder: "Brand A", campaign: "CD_24_10" }] } },
    { origin: { sources: [{ folder: "Brand A", campaign: "CD_24_2" }] } },
    { origin: { sources: [{ folder: "Brand B", campaign: "CD_23_1" }] } },
  ];

  assert.deepEqual(
    collectCampaigns(animations, "Brand A").map((entry) => entry.folder),
    ["CD_24_2", "CD_24_10"],
  );
  assert.deepEqual([...animationCampaigns(animations[0])], ["CD_24_10"]);
});

test("campaign values stay inside their selected source archive", () => {
  const animation = {
    origin: {
      sources: [
        { repository: "campaigns", brand: "Brand A", campaign: "CD_24_100" },
        { repository: "previews-only", brand: "Brand A", campaign: "Previous_200" },
      ],
    },
  };

  assert.deepEqual([...animationCampaigns(animation, "Brand A", "campaigns")], ["CD_24_100"]);
  assert.deepEqual([...animationCampaigns(animation, "Brand A", "previews-only")], ["Previous_200"]);
  assert.deepEqual(
    collectCampaigns([animation], "Brand A", "campaigns").map((entry) => entry.folder),
    ["CD_24_100"],
  );
});

test("dual-source cards keep both provenance while a source filter scopes detail", () => {
  const animation = {
    origin: {
      occurrences: 2,
      sources: [
        { repository: "campaigns", brand: "Brand A", campaign: "CD_24_100", file: "campaigns/Brand A/CD_24_100/index.html" },
        { repository: "previews-only", brand: "Brand A", campaign: "Previous_200", file: "previews-only/Brand A/Previous_200/index.html" },
      ],
    },
  };
  const origin = describeOrigin(animation, { archives: ["previews-only"] });

  assert.equal(origin.kind, "combined");
  assert.equal(origin.label, "Both sources");
  assert.match(origin.tooltip, /^Found in Previous only and Campaigns\./);
  assert.match(origin.tooltip, /Filtered source: Previews only/);
  assert.match(origin.tooltip, /Previous_200/);
  assert.doesNotMatch(origin.tooltip, /CD_24_100/);
});

test("source tooltip caps brand rows and retains the active filter context", () => {
  const sources = Array.from({ length: 14 }, (_, index) => ({
    repository: "campaigns",
    brand: `Brand ${index + 1}`,
    campaign: `CD_${index + 1}`,
    file: `campaigns/Brand ${index + 1}/CD_${index + 1}/index.html`,
  }));
  const compact = describeOrigin({ origin: { occurrences: 14, sources } });
  assert.equal(compact.tooltip.split("\n").filter((line) => line.startsWith("Brand:")).length, 10);
  assert.match(compact.tooltip, /4 more brands/);

  const origin = describeOrigin({ origin: { occurrences: 14, sources } }, {
    archive: "campaigns",
    brand: "Brand 14",
    campaign: "CD_14",
  });
  const lines = origin.tooltip.split("\n");

  assert.ok(lines.includes("Filtered Brand: Brand 14"));
  assert.ok(lines.includes("Filtered Campaign: CD_14"));
  assert.ok(lines.includes("Brand: Brand 14"));
  assert.equal(lines.filter((line) => line.startsWith("Brand:")).length, 1);
});

test("numeric source containers use the full campaign name and its brand", () => {
  const source = {
    folder: "26_000",
    file: "26_000/26_000_Samsung_Summer_Campaign/style.css",
  };

  assert.equal(sourceCampaign(source), "26_000_Samsung_Summer_Campaign");
  assert.equal(sourceBrand(source), "Samsung");
});
