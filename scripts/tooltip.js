/*
 * One tooltip for the whole page.
 *
 * A tooltip drawn as a card's own ::after can never leave that card. The card
 * clips its corners with overflow: hidden, and content-visibility adds paint
 * containment on top of that, so the text was cut off exactly where it
 * started to be worth reading. This one lives on <body>, outside everything
 * that clips, and is positioned against whichever [data-tooltip] element the
 * pointer or the keyboard is on.
 *
 * Delegated from the document, so cards can be built, moved and thrown away
 * by the grid without anything here having to know.
 */

const EDGE = 8;
const GAP = 9;
const DELAY = 110;

let tip = null;
let target = null;
let showTimer = 0;
let pendingTarget = null;
let started = false;

function element() {
  if (tip && tip.isConnected) return tip;

  tip = document.createElement("div");

  tip.className = "ms-tooltip";
  tip.id = "motion-shelf-tooltip";
  tip.setAttribute("role", "tooltip");
  // Use the browser's top layer when available, outside card paint containment
  // and any surrounding stacking contexts. The body portal is the fallback.
  if (typeof tip.showPopover === "function") tip.setAttribute("popover", "manual");
  tip.hidden = true;

  document.body.appendChild(tip);

  return tip;
}

function place() {
  if (!target || !target.isConnected) {
    hide();
    return;
  }

  const node = element();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || document.documentElement.clientWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  node.style.setProperty("--tooltip-width", `${Math.max(1, viewportWidth - EDGE * 2)}px`);
  const anchor = target.getBoundingClientRect();
  // Layout dimensions exclude the small fade-in transform.
  const box = { width: node.offsetWidth, height: node.offsetHeight };

  /*
   * Above by preference, below when the top of the window is in the way --
   * or below on request, for anchors that sit in the header and would
   * otherwise cover it.
   */
  const wants = target.dataset.tooltipPlace;
  const fits = anchor.top - GAP - box.height >= viewportTop + EDGE;
  const above = wants === "below" ? false : fits;

  const top = above
    ? anchor.top - GAP - box.height
    : Math.min(anchor.bottom + GAP, viewportTop + viewportHeight - EDGE - box.height);

  /* Centred on the badge, then pulled back inside the window rather than
     hanging off the side of it. */
  const centred = anchor.left + anchor.width / 2 - box.width / 2;
  const left = Math.max(viewportLeft + EDGE, Math.min(centred, viewportLeft + viewportWidth - EDGE - box.width));

  node.style.top = `${Math.max(viewportTop + EDGE, top)}px`;
  node.style.left = `${left}px`;
  node.classList.toggle("is-below", !above);
}

function show(next) {
  pendingTarget = null;
  if (!next.isConnected || document.hidden) return;
  const text = next.dataset.tooltip;

  if (!text) return;

  hide();
  target = next;

  const node = element();

  node.textContent = text;
  node.hidden = false;
  node.showPopover?.();
  const describedBy = new Set((next.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  describedBy.add(node.id);
  next.setAttribute("aria-describedby", [...describedBy].join(" "));

  /* Measure once it has its text, then place it, then let it fade in. */
  node.classList.remove("is-visible");
  place();

  requestAnimationFrame(() => {
    if (target === next) node.classList.add("is-visible");
  });

  window.addEventListener("scroll", place, { passive: true, capture: true });
  window.addEventListener("resize", place, { passive: true });
  window.visualViewport?.addEventListener("resize", place, { passive: true });
  window.visualViewport?.addEventListener("scroll", place, { passive: true });
}

export function hide() {
  clearTimeout(showTimer);
  pendingTarget = null;

  if (target && tip) {
    const remaining = (target.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== tip.id);
    if (remaining.length) target.setAttribute("aria-describedby", remaining.join(" "));
    else target.removeAttribute("aria-describedby");
  }

  target = null;

  if (tip) {
    tip.classList.remove("is-visible");
    tip.hidePopover?.();
    tip.hidden = true;
  }

  window.removeEventListener("scroll", place, { capture: true });
  window.removeEventListener("resize", place);
  window.visualViewport?.removeEventListener("resize", place);
  window.visualViewport?.removeEventListener("scroll", place);
}

function queue(next) {
  if (next === target || next === pendingTarget) return;

  hide();
  pendingTarget = next;

  showTimer = setTimeout(() => show(next), DELAY);
}

export function initializeTooltips() {
  if (started) return;

  started = true;

  document.addEventListener("pointerover", (event) => {
    const next = event.target.closest?.("[data-tooltip]");

    if (next) queue(next);
    else hide();
  });

  document.addEventListener("pointerout", (event) => {
    const anchor = pendingTarget || target;
    if (anchor && anchor.contains(event.target) && !anchor.contains(event.relatedTarget)) hide();
  });

  document.addEventListener("pointerdown", hide);

  document.addEventListener("focusin", (event) => {
    const next = event.target.closest?.("[data-tooltip]");

    if (next) queue(next);
    else hide();
  });

  document.addEventListener("focusout", hide);
  window.addEventListener("blur", hide);
  document.addEventListener("visibilitychange", () => { if (document.hidden) hide(); });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
}
