import test from "node:test";
import assert from "node:assert/strict";

import { animationCampaigns, collectCampaigns, sourceBrand, sourceCampaign } from "../scripts/origin.js";

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

test("numeric source containers use the full campaign name and its brand", () => {
  const source = {
    folder: "26_000",
    file: "26_000/26_000_Samsung_Summer_Campaign/style.css",
  };

  assert.equal(sourceCampaign(source), "26_000_Samsung_Summer_Campaign");
  assert.equal(sourceBrand(source), "Samsung");
});
