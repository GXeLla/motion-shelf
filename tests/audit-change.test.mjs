import test from "node:test";
import assert from "node:assert/strict";

import { snapshotsDiffer } from "../scripts/runtime-audit.js";

/*
 * What the audit is willing to call motion.
 *
 * This comparison decides between "valid" and "no visible effect", and Sync
 * quarantines the second as broken. It used to read four properties out of the
 * twenty the snapshot records, so a colour fade or a clip-path wipe was thrown
 * out as an animation that does nothing.
 */

const still = {
  box: [0, 0, 100, 100],
  transform: "none",
  opacity: 1,
  filter: "none",
  color: [255, 255, 255],
  backgroundColor: [0, 0, 0],
  backgroundPosition: "0% 50%",
  borderWidth: 0,
  borderColor: [0, 0, 0],
  boxShadow: "none",
  textShadow: "none",
  clipPath: "none",
  mask: "none",
  objectPosition: "50% 50%",
  display: "block",
  visibility: "visible",
};

const moved = {
  box: "a frame that moves",
  transform: "matrix(1, 0, 0, 1, 40, 0)",
  opacity: 0.5,
  filter: "blur(4px)",
  color: "a colour that changes",
  backgroundColor: "a background that changes",
  backgroundPosition: "100% 50%",
  borderWidth: 6,
  borderColor: "a border colour that changes",
  boxShadow: "rgba(0, 0, 0, 0.8) 0px 20px 40px 0px",
  textShadow: "rgba(0, 0, 0, 0.5) 0px 2px 4px",
  clipPath: "inset(0% 0% 0% 0%)",
  mask: "linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))",
  objectPosition: "0% 50%",
  display: "inline-block",
  visibility: "hidden",
};

const changes = {
  box: [10, 0, 100, 100],
  color: [255, 0, 102],
  backgroundColor: [0, 0, 255],
  borderColor: [255, 0, 102],
};

test("every property the snapshot records counts as visible motion", () => {
  for (const property of Object.keys(still)) {
    const after = { ...still, [property]: changes[property] ?? moved[property] };
    assert.equal(
      snapshotsDiffer(still, after),
      true,
      `a change in ${property} alone should read as motion`,
    );
  }
});

test("an animation that truly holds still is still recognised", () => {
  assert.equal(snapshotsDiffer(still, { ...still }), false);
  assert.equal(snapshotsDiffer(still, { ...still, progress: 0.5, visible: true }), false,
    "sampling bookkeeping is not a visible change");
});

test("the four properties compared before still decide on their own", () => {
  for (const property of ["box", "transform", "opacity", "filter"]) {
    const after = { ...still, [property]: changes[property] ?? moved[property] };
    assert.equal(snapshotsDiffer(still, after), true, `${property} must not have been dropped`);
  }
});

test("a missing colour list does not throw or invent a change", () => {
  const sparse = { ...still, color: undefined, borderColor: undefined };
  assert.equal(snapshotsDiffer(sparse, { ...sparse }), false);
  assert.equal(snapshotsDiffer(sparse, { ...sparse, color: [1, 2, 3] }), true);
});
