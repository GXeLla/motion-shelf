import test from "node:test";
import assert from "node:assert/strict";
import { applyAnimation, stopPreviewAnimation } from "../scripts/animations.js";

test("only visible previews play, resume after tab return, and release removed cards", () => {
  const documentEvents = new Map();
  const windowEvents = new Map();
  let observer;
  let modalChanged;
  let openModals = 0;
  const originals = Object.fromEntries(["document", "window", "IntersectionObserver", "MutationObserver"].map(key => [key, globalThis[key]]));
  globalThis.document = {
    hidden: false,
    addEventListener: (type, callback) => documentEvents.set(type, callback),
    createElement: () => ({ textContent: "", isConnected: true }),
    head: { appendChild() {} },
    querySelector: () => openModals ? {} : null,
    querySelectorAll: () => [{}],
  };
  globalThis.MutationObserver = class {
    constructor(callback) { modalChanged = callback; }
    observe() {}
  };
  globalThis.window = { addEventListener: (type, callback) => windowEvents.set(type, callback) };
  globalThis.IntersectionObserver = class {
    targets = new Set();
    constructor(callback, options) { this.callback = callback; this.options = options; observer = this; }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    report(target, visible) {
      this.callback([{ target, isIntersecting: visible, intersectionRatio: visible ? 0.5 : 0 }]);
    }
  };
  const makePreview = (id) => {
    const frame = { isConnected: true };
    const card = { classList: new Set() };
    card.classList.remove = card.classList.delete;
    const element = {
      style: {}, classList: new Set(),
      closest: selector => selector === ".card-preview" ? frame : card,
    };
    element.classList.remove = element.classList.delete;
    applyAnimation(element, { id, animationName: id, duration: 1 });
    return { element, frame, card };
  };
  try {
    const first = makePreview("visiblePreview");
    const second = makePreview("offscreenPreview");
    assert.equal(observer.options.rootMargin, "0px");
    assert.equal(first.element.style.animation, "none");
    observer.report(first.frame, true);
    assert.match(first.element.style.animation, /infinite/);
    assert.ok(first.card.classList.has("animation-running"));
    assert.equal(second.element.style.animation, "none");
    observer.report(first.frame, false);
    assert.equal(first.element.style.animation, "none");
    assert.equal(first.card.classList.has("animation-running"), false);
    observer.report(first.frame, true);
    openModals = 2;
    modalChanged();
    assert.equal(first.element.style.animation, "none");
    windowEvents.get("focus")();
    observer.report(first.frame, true);
    assert.equal(first.element.style.animation, "none", "focus and queued viewport entries cannot bypass an open modal");
    openModals = 1;
    modalChanged();
    assert.equal(observer.targets.size, 0, "closing one of two dialogs keeps previews stopped");
    openModals = 0;
    modalChanged();
    assert.equal(observer.targets.size, 2);
    observer.report(first.frame, true);
    assert.match(first.element.style.animation, /infinite/);
    document.hidden = true;
    documentEvents.get("visibilitychange")();
    assert.equal(first.element.style.animation, "none");
    document.hidden = false;
    documentEvents.get("visibilitychange")();
    assert.equal(observer.targets.size, 2);
    assert.equal(first.element.style.animation, "none");
    observer.report(second.frame, true);
    assert.match(second.element.style.animation, /infinite/);
    windowEvents.get("blur")();
    assert.equal(second.element.style.animation, "none");
    windowEvents.get("focus")();
    observer.report(second.frame, true);
    stopPreviewAnimation(second.element);
    assert.equal(second.element.style.animation, "none");
    assert.equal(observer.targets.has(second.frame), false);
    observer.report(second.frame, true); // Queued entry after removal must be ignored.
    assert.equal(second.element.style.animation, "none");
    stopPreviewAnimation(first.element);
    assert.equal(observer.targets.size, 0);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
