import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../scripts/state.js";
import { getVisibleAnimations } from "../scripts/filters.js";

/*
 * Which words find an animation.
 *
 * The haystack is cached now, and a cache is only ever as good as the moment
 * it stops being true. These walk the whole list of searchable keywords and
 * then rename the record, which is the one thing that has to reach the very
 * next keystroke.
 */

function library(overrides = {}) {
  return [{
    id: "one",
    name: "Cinematic Image Drift",
    animationName: "msCinematicImageDrift",
    className: "ms-cinematic-image-drift",
    categories: ["image"],
    device: "both",
    interaction: "appear",
    updatedAt: 1700000000000,
    origin: {
      kind: "css",
      occurrences: 3,
      variants: 2,
      originalName: "aldiHeroSlide",
      variantNames: [{ name: "heroSlideAlt", occurrences: 1 }, { name: "packshotGlide", occurrences: 1 }],
      sources: [{ repository: "campaigns", folder: "Aldi", campaign: "CD_24_1", file: "campaigns/Aldi/banner/style.css", type: "css" }],
    },
    ...overrides,
  }];
}

function finds(term) {
  state.searchTerm = term.toLowerCase();
  const matches = getVisibleAnimations().length;
  state.searchTerm = "";
  return matches === 1;
}

test.beforeEach(() => {
  state.animations = library();
  state.selectedFilters = [];
  state.sourceFolder = "";
  state.sourceCampaign = "";
  state.searchTerm = "";
  state.showAllVariants = true;
});

test("every keyword an animation carries still filters", () => {
  assert.ok(finds("cinematic"), "a word from the display name");
  assert.ok(finds("drift"), "another word from the display name");
  assert.ok(finds("Cinematic Image Drift"), "the whole display name");
  assert.ok(finds("CINEMATIC"), "the display name in another case");
  assert.ok(finds("image dri"), "a run of characters across two words");

  assert.ok(finds("msCinematicImageDrift"), "the CSS animation name");
  assert.ok(finds("CinematicImage"), "part of the CSS animation name");

  assert.ok(finds("ms-cinematic-image-drift"), "the class name");
  assert.ok(finds("ms-cinematic"), "part of the class name");

  assert.ok(finds("aldiHeroSlide"), "the name it had in its source archive");
  assert.ok(finds("aldiHero"), "part of that name");

  assert.ok(finds("heroSlideAlt"), "the name of a collapsed variant");
  assert.ok(finds("packshotGlide"), "the name of the other collapsed variant");

  assert.ok(finds("campaigns/Aldi/banner/style.css"), "the complete campaigns source path");
  assert.ok(finds("banner/style"), "part of a campaigns source path");

  assert.ok(!finds("zzzunrelated"), "a word that appears nowhere");
});

test("source paths from every archive are searchable", () => {
  state.animations = library({
    origin: {
      ...library()[0].origin,
      sources: [
        { repository: "campaigns", folder: "Client", campaign: "CD_24_019_Mesch_newhome_1Flight", file: "campaigns/Client/24_019/src/style.css" },
        { repository: "previews-only", folder: "UniCreditBankAustria", campaign: "26_000", file: "previews-only/UniCreditBankAustria/26_000/src/bwd/UniCredit/index.html" },
      ],
    },
  });

  assert.ok(finds("019"), "a campaign number within a source path");
  assert.ok(finds("000"), "a previews-only number within a source path");
  assert.ok(finds("unicredit/index.html"), "a nested previews-only path");
  assert.ok(finds("mesch_newhome"), "a campaign name stored separately from its path");
});

test("an empty search term keeps the whole library", () => {
  state.searchTerm = "";
  assert.equal(getVisibleAnimations().length, 1);
});

test("a rename reaches the next keystroke", () => {
  const [animation] = state.animations;
  assert.ok(finds("cinematic"));

  /* updateAnimation rewrites the three names together and stamps the record. */
  animation.name = "Renamed Sunrise Sweep";
  animation.animationName = "msRenamedSunriseSweep";
  animation.className = "ms-renamed-sunrise-sweep";
  animation.updatedAt = 1700000000001;

  assert.ok(!finds("cinematic"), "the old name stops matching");
  assert.ok(finds("sunrise"), "the new name matches");
  assert.ok(finds("ms-renamed-sunrise-sweep"), "so does the new class name");
  assert.ok(finds("aldiHeroSlide"), "and the archive alias is untouched by a rename");
});

test("a record replaced by a merge is not answered from the old one's cache", () => {
  assert.ok(finds("cinematic"));
  state.animations = library({ name: "Replaced By Merge", animationName: "msReplacedByMerge", className: "ms-replaced-by-merge" });
  assert.ok(!finds("cinematic"));
  assert.ok(finds("replaced by merge"));
});

test("an animation with no origin is searchable by its own names alone", () => {
  state.animations = library({ origin: null });
  assert.ok(finds("cinematic"));
  assert.ok(finds("msCinematicImageDrift"));
  assert.ok(!finds("aldiHeroSlide"));
});
