// One seeded SVG sky, built once; only the depth wrappers move with parallax.
function buildLibraryStars(root) {
  const field = root.querySelector("#libraryStars");
  const beacons = root.querySelector("#libraryBeacons");
  if (!field || !beacons || field.childElementCount) return;
  const ns = "http://www.w3.org/2000/svg";
  let seed = 27091;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const svgElement = (tag, attributes) => {
    const element = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  };
  const stars = document.createDocumentFragment();
  for (let index = 0; index < 540; index += 1) {
    const dust = index >= 380;
    const x = random() * 1600;
    const y = dust ? 170 + 140 * Math.sin(x / 240) + random() * 120 : random() * 1000;
    stars.append(svgElement("circle", {
      cx: x.toFixed(2), cy: y.toFixed(2),
      r: (dust ? 0.3 + random() * 0.45 : 0.4 + random() * 0.9).toFixed(2),
      fill: index % 5 === 0 ? "#86dcb4" : "#d9fced",
      opacity: (dust ? 0.12 + random() * 0.22 : 0.25 + random() * 0.5).toFixed(2),
    }));
  }
  field.append(stars);

  // Place the brightest stars around the readable center, away from dense UI.
  const positions = [[115,110],[375,310],[635,85],[870,225],[1120,120],[1425,275],
    [1550,595],[95,690],[365,905],[810,840],[1240,760],[1440,935]];
  positions.forEach(([x, y], index) => {
    const star = svgElement("g", { class: "library-beacon" });
    star.style.setProperty("--beacon-duration", `${6 + index % 5}s`);
    star.style.setProperty("--beacon-delay", `${-index * 1.7}s`);
    star.append(
      svgElement("circle", {cx:x,cy:y,r:9,fill:"#71edb6",opacity:0.04}),
      svgElement("circle", {cx:x,cy:y,r:4,fill:"#a8ffcf",opacity:0.1}),
      svgElement("path", {d:`M${x-7} ${y}h14 M${x} ${y-7}v14`,stroke:"#b8ffe0","stroke-width":0.65,opacity:0.68}),
      svgElement("circle", {cx:x,cy:y,r:1.35,fill:"#eafff2"}),
    );
    beacons.append(star);
  });
}

// Decorative parallax belongs to the library page only. Content never moves.
export function initializeLibraryAtmosphere(root = document.getElementById("libraryAtmosphere")) {
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = "true";
  buildLibraryStars(root);

  const layers = [...root.querySelectorAll("[data-depth]")].map(element => ({
    element, depth: Number(element.dataset.depth) || 0,
  }));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const listeners = new AbortController();
  const options = { passive: true, signal: listeners.signal };
  const current = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };
  let targetX = 0;
  let targetY = 0;
  let frame = 0;
  let lastTime = 0;
  let pageActive = true;

  function paint() {
    for (const { element, depth } of layers) {
      element.style.transform = `translate3d(${(current.x * depth).toFixed(2)}px, ${(current.y * depth).toFixed(2)}px, 0)`;
    }
  }

  function isActive() {
    return pageActive && !document.hidden && !reducedMotion.matches;
  }

  function tick(time) {
    frame = 0;
    if (!isActive()) return;
    const elapsed = lastTime ? Math.min(64, time - lastTime) : 16;
    lastTime = time;
    const blend = 1 - Math.exp(-elapsed / 180);
    current.x += (targetX - current.x) * blend;
    current.y += (targetY - current.y) * blend;
    if (Math.abs(targetX - current.x) + Math.abs(targetY - current.y) < 0.05) {
      current.x = targetX;
      current.y = targetY;
      paint();
      lastTime = 0;
      return;
    }
    paint();
    frame = requestAnimationFrame(tick);
  }

  function updateTarget() {
    if (!isActive()) return;
    // A bounded scroll offset keeps the layers inside their 80px overscan.
    const scrollDepth = Math.tanh(Math.max(0, window.scrollY) / Math.max(1, window.innerHeight) * 0.45);
    targetX = pointer.x * 24;
    targetY = pointer.y * 18 - scrollDepth * (finePointer.matches ? 42 : 24);
    if (!frame) frame = requestAnimationFrame(tick);
  }

  /* Held for the length of a scroll, then released shortly after it stops.
     The CSS above reads it to park the decorative animations. */
  let scrollIdle = 0;

  function markScrolling() {
    if (root.dataset.scrolling !== "true") {
      root.dataset.scrolling = "true";
    }

    clearTimeout(scrollIdle);

    scrollIdle = setTimeout(() => {
      delete root.dataset.scrolling;
    }, 180);
  }

  function resetPointer() {
    pointer.x = 0;
    pointer.y = 0;
    updateTarget();
  }

  function syncMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    root.dataset.motion = isActive() ? "active" : "paused";
    if (reducedMotion.matches) {
      current.x = current.y = 0;
      pointer.x = pointer.y = 0;
      paint();
    } else {
      if (!finePointer.matches) pointer.x = pointer.y = 0;
      updateTarget();
    }
  }

  window.addEventListener("pointermove", event => {
    if (!finePointer.matches || event.pointerType !== "mouse" || !isActive()) return;
    pointer.x = Math.max(-1, Math.min(1, event.clientX / Math.max(1, window.innerWidth) * 2 - 1));
    pointer.y = Math.max(-1, Math.min(1, event.clientY / Math.max(1, window.innerHeight) * 2 - 1));
    updateTarget();
  }, options);
  document.documentElement.addEventListener("pointerleave", resetPointer, options);
  window.addEventListener("blur", resetPointer, options);
  window.addEventListener("scroll", () => {
    markScrolling();
    updateTarget();
  }, options);
  window.addEventListener("resize", resetPointer, options);
  document.addEventListener("visibilitychange", syncMotion, options);
  window.addEventListener("pagehide", () => { pageActive = false; syncMotion(); }, options);
  window.addEventListener("pageshow", () => { pageActive = true; syncMotion(); }, options);
  reducedMotion.addEventListener("change", syncMotion);
  finePointer.addEventListener("change", syncMotion);
  syncMotion();

  return () => {
    listeners.abort();
    clearTimeout(scrollIdle);
    delete root.dataset.scrolling;
    cancelAnimationFrame(frame);
    reducedMotion.removeEventListener("change", syncMotion);
    finePointer.removeEventListener("change", syncMotion);
    root.dataset.motion = "paused";
    delete root.dataset.initialized;
    layers.forEach(({ element }) => element.style.removeProperty("transform"));
  };
}

initializeLibraryAtmosphere();
