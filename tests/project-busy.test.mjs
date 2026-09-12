import test from "node:test";
import assert from "node:assert/strict";

import { state, beginProjectBusy, endProjectBusy } from "../scripts/state.js";

/*
 * Who is occupying the project folder.
 *
 * Restoring the link at startup, linking a new folder and every queued write
 * all make the workspace busy, and they overlap. A queued write used to save
 * the flag as it found it and put that value back when it finished, so a push
 * begun during startup restored "busy" after startup had already cleared it,
 * and the header sat on "Reading project" with both buttons disabled until
 * something else happened to run.
 */

test.beforeEach(() => {
  /* Drain any count left behind, so each case starts from rest. */
  for (let i = 0; i < 8; i += 1) endProjectBusy();
  state.projectBusy = false;
});

test("the workspace is busy while anyone holds it", () => {
  assert.equal(state.projectBusy, false);
  beginProjectBusy();
  assert.equal(state.projectBusy, true);
  endProjectBusy();
  assert.equal(state.projectBusy, false);
});

test("two holders at once both have to let go", () => {
  beginProjectBusy();
  beginProjectBusy();
  endProjectBusy();
  assert.equal(state.projectBusy, true, "one holder remains");
  endProjectBusy();
  assert.equal(state.projectBusy, false);
});

test("a write that starts during startup and finishes first does not clear it", () => {
  beginProjectBusy();            /* startup begins reading the folder */
  beginProjectBusy();            /* a push is queued while it reads */
  endProjectBusy();              /* the push finishes */
  assert.equal(state.projectBusy, true, "startup is still reading");
  endProjectBusy();              /* startup finishes */
  assert.equal(state.projectBusy, false);
});

test("a write that outlives startup does not restore a stale busy", () => {
  beginProjectBusy();            /* startup begins */
  beginProjectBusy();            /* a push is queued while it reads */
  endProjectBusy();              /* startup finishes first */
  assert.equal(state.projectBusy, true, "the push still holds it");
  endProjectBusy();              /* the push finishes */
  assert.equal(state.projectBusy, false, "and the header is released");
});

test("an unmatched release cannot drive the count below rest", () => {
  endProjectBusy();
  endProjectBusy();
  assert.equal(state.projectBusy, false);
  beginProjectBusy();
  assert.equal(state.projectBusy, true, "the next holder still registers");
  endProjectBusy();
  assert.equal(state.projectBusy, false);
});
