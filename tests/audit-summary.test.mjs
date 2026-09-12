import test from "node:test";
import assert from "node:assert/strict";

import { renderAuditSummary } from "../scripts/runtime-audit.js";

/*
 * The audit summary while Sync is still auditing.
 *
 * Sync calls renderAuditSummary once per audit batch, and an archive is many
 * batches. It used to redraw the whole panel each time, which replaced the
 * <details> element holding the list of failures -- so the list shut itself
 * the moment it was opened, and threw away the reader's scroll position with
 * it. What has to hold is that the element survives every update.
 */

/* Just enough DOM for a panel that is built from elements and then updated. */
function fakeDom() {
  class Node {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.parent = null;
      this.className = "";
      this.attributes = {};
      this.hidden = false;
      this.title = "";
      this.open = false;
      this.text = "";
    }

    set textContent(value) { this.children = []; this.text = String(value); }
    get textContent() {
      return this.children.length
        ? this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join("")
        : this.text;
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }

    append(...items) {
      for (const item of items) {
        if (typeof item !== "string") item.parent = this;
        this.children.push(item);
      }
    }

    replaceChildren(...items) {
      this.children.forEach((child) => { if (typeof child !== "string") child.parent = null; });
      this.children = [];
      this.text = "";
      this.append(...items);
    }

    contains(node) {
      if (!node) return false;
      if (node === this) return true;
      return this.children.some((child) => typeof child !== "string" && child.contains(node));
    }

    /* Everything below this node, depth first. */
    descendants() {
      return this.children.flatMap((child) =>
        (typeof child === "string" ? [] : [child, ...child.descendants()]));
    }

    find(tag) { return this.descendants().filter((node) => node.tagName === tag.toUpperCase()); }
  }

  return { document: { createElement: (tag) => new Node(tag) }, Node };
}

function tick(count, total = 60) {
  const records = Array.from({ length: count }, (_, i) => ({
    id: "a" + i,
    name: "Animation " + i,
    kind: i % 3 === 0 ? "broken" : "valid",
    reason: i % 3 === 0 ? "Element never enters safe frame" : "",
  }));
  const totals = {
    valid: 0, "auto-fixable": 0, "preview-only fix": 0,
    "no visible effect": 0, broken: 0, "manual review required": 0,
  };
  records.forEach((record) => { totals[record.kind] += 1; });
  return { total, checked: count, totals, records };
}

function withDom(t) {
  const dom = fakeDom();
  const previous = globalThis.document;
  globalThis.document = dom.document;
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  return dom;
}

const detailsOf = (container) => container.find("details")[0];
const rowsOf = (container) => detailsOf(container).find("p");

test("the failures list survives every progress update", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  renderAuditSummary(container, tick(9));
  const details = detailsOf(container);
  assert.equal(rowsOf(container).length, 3);

  /* The reader opens it. */
  details.open = true;

  renderAuditSummary(container, tick(30));
  assert.equal(detailsOf(container), details, "the same element, not a replacement");
  assert.equal(details.open, true, "so it is still open");
  assert.equal(rowsOf(container).length, 10, "and the new failures were added to it");

  renderAuditSummary(container, tick(60));
  assert.equal(detailsOf(container), details);
  assert.equal(details.open, true);
  assert.equal(rowsOf(container).length, 20);
});

test("rows already on screen are kept, not rebuilt", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  renderAuditSummary(container, tick(9));
  const [firstRow] = rowsOf(container);

  renderAuditSummary(container, tick(30));
  assert.equal(rowsOf(container)[0], firstRow, "the first row is the very same node");
});

test("a report that disagrees about earlier failures rebuilds the rows but keeps the panel", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  renderAuditSummary(container, tick(9));
  const details = detailsOf(container);
  details.open = true;

  const rewritten = tick(9);
  rewritten.records[0] = { ...rewritten.records[0], name: "Renamed Animation", reason: "Missing keyframes" };
  renderAuditSummary(container, rewritten);

  assert.equal(detailsOf(container), details, "the panel is not replaced");
  assert.equal(details.open, true, "so it stays open even then");
  assert.equal(rowsOf(container).length, 3);
  assert.equal(rowsOf(container)[0].find("b")[0].textContent, "Renamed Animation");
  assert.equal(rowsOf(container)[0].find("span")[0].textContent, "Missing keyframes");
});

test("the counts and the progress line follow the report", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  renderAuditSummary(container, tick(30));
  const values = container.find("dd").map((node) => node.textContent);
  assert.deepEqual(values, ["20", "0", "10"], "valid, auto/preview fixed, broken");
  assert.equal(detailsOf(container).find("b")[0].textContent, "10");
  assert.match(container.find("p")[0].textContent, /^30 of 60 canonical animations checked/);
  assert.equal(container.hidden, false);
});

test("no failures hides the list without destroying it", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  const clean = tick(9);
  clean.records = clean.records.map((record) => ({ ...record, kind: "valid", reason: "" }));
  clean.totals = { valid: 9, "auto-fixable": 0, "preview-only fix": 0, "no visible effect": 0, broken: 0, "manual review required": 0 };

  renderAuditSummary(container, clean);
  const details = detailsOf(container);
  assert.equal(details.hidden, true);
  assert.equal(rowsOf(container).length, 0);

  renderAuditSummary(container, tick(9));
  assert.equal(detailsOf(container), details);
  assert.equal(details.hidden, false, "and it comes back when something fails");
  assert.equal(rowsOf(container).length, 3);

  renderAuditSummary(container, clean);
  assert.equal(details.hidden, true);
  assert.equal(rowsOf(container).length, 0, "stale failures are cleared away");
});

test("a container emptied between syncs is rebuilt from scratch", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  renderAuditSummary(container, tick(30));
  assert.equal(rowsOf(container).length, 10);

  /* What sync-ui does before a new run. */
  container.replaceChildren();
  container.hidden = true;

  renderAuditSummary(container, tick(9));
  assert.equal(rowsOf(container).length, 3, "not 10 plus 3");
  assert.equal(container.hidden, false);
});

test("names and reasons are written as text, never as markup", (t) => {
  const dom = withDom(t);
  const container = dom.document.createElement("div");

  const report = tick(3);
  report.records[0] = {
    id: "x", kind: "broken",
    name: "<img src=x onerror=alert(1)>",
    reason: "a & b <script>",
  };
  renderAuditSummary(container, report);

  const [row] = rowsOf(container);
  assert.equal(row.find("b")[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(row.find("span")[0].textContent, "a & b <script>");
  assert.equal(row.title, "broken");
  assert.equal(row.find("img").length, 0, "nothing was parsed as an element");
});
