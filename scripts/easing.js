const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  "power1.out": [0.25, 0.46, 0.45, 0.94],
  "power2.out": [0.215, 0.61, 0.355, 1],
  "power3.out": [0.165, 0.84, 0.44, 1],
  "power4.out": [0.23, 1, 0.32, 1],
  "sine.inOut": [0.445, 0.05, 0.55, 0.95],
  "circ.out": [0.075, 0.82, 0.165, 1],
  "expo.out": [0.19, 1, 0.22, 1],
  "back.out(1.7)": [0.175, 0.885, 0.32, 1.275],
};

const CSS_OPTIONS = [
  ["ease", "CSS · Ease"],
  ["linear", "CSS · Linear"],
  ["ease-in", "CSS · Ease in"],
  ["ease-out", "CSS · Ease out"],
  ["ease-in-out", "CSS · Ease in/out"],
  ["step-start", "CSS · Step start"],
  ["step-end", "CSS · Step end"],
  ...["jump-start", "jump-end", "jump-none", "jump-both"].map(position =>
    [`steps(4, ${position})`, `CSS · 4 steps · ${position}`]),
];

export const EASING_GROUPS = [
  { label: "CSS defaults", options: CSS_OPTIONS },
  ...["power1", "power2", "power3", "power4", "sine", "expo", "circ", "back", "bounce", "elastic"].map(family => ({
    label: `GSAP-style · ${family}`,
    options: ["in", "out", "inOut"].map(direction => [`${family}.${direction}`, `${family}.${direction}`]),
  })),
  { label: "More / custom", options: [["none", "None · linear"], ["back.out(1.7)", "Back out · legacy"], ["custom", "Custom cubic-bezier"]] },
];
export const EASING_OPTIONS = EASING_GROUPS.flatMap(group => group.options);

function bounceOut(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

function familyIn(family, t) {
  if (t === 0 || t === 1) return t;
  if (family.startsWith("power")) return t ** (Number(family.slice(-1)) + 1);
  if (family === "sine") return 1 - Math.cos(t * Math.PI / 2);
  if (family === "expo") return 2 ** (10 * (t - 1));
  if (family === "circ") return 1 - Math.sqrt(1 - t * t);
  if (family === "back") return t * t * (2.70158 * t - 1.70158);
  if (family === "bounce") return 1 - bounceOut(1 - t);
  return -(2 ** (10 * (t - 1))) * Math.sin((t - 1.075) * 2 * Math.PI / 0.3);
}

export function isBezierEasing(easing) {
  return easing === "custom" || Object.hasOwn(EASING_PRESETS, easing);
}

export function sampleEasing(easing, t, customBezier) {
  if (easing === "none" || easing === "linear") return t;
  const steps = easing.match(/^steps\((\d+), (jump-start|jump-end|jump-none|jump-both)\)$/);
  if (steps || easing === "step-start" || easing === "step-end") {
    const count = steps ? Number(steps[1]) : 1;
    const position = steps?.[2] || (easing === "step-start" ? "jump-start" : "jump-end");
    const add = position === "jump-start" || position === "jump-both" ? 1 : 0;
    const divisor = count + (position === "jump-both" ? 1 : position === "jump-none" ? -1 : 0);
    return Math.min(1, (Math.floor(t * count) + add) / divisor);
  }
  // Preserve existing saved Bézier presets; new families use sampled curves.
  if (!isBezierEasing(easing)) {
    const match = easing.match(/^(power[1-4]|sine|expo|circ|back|bounce|elastic)\.(in|out|inOut)$/);
    if (match) {
      const [, family, direction] = match;
      if (direction === "in") return familyIn(family, t);
      if (direction === "out") return 1 - familyIn(family, 1 - t);
      return t < 0.5 ? familyIn(family, t * 2) / 2 : 1 - familyIn(family, (1 - t) * 2) / 2;
    }
  }
  const [x1, y1, x2, y2] = getEasingPoints(easing, customBezier);
  const bezier = (u, a, b) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, x1, x2) < t) lo = mid; else hi = mid;
  }
  return bezier((lo + hi) / 2, y1, y2);
}

const resolvedCache = new Map();

export function normalizeBezier(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const fallback = [0.42, 0, 0.58, 1];

  return fallback.map((fallbackValue, index) => {
    const number = Number(source[index]);
    if (!Number.isFinite(number)) return fallbackValue;
    if (index === 0 || index === 2) return clamp(number, 0, 1);
    return clamp(number, -0.5, 1.5);
  });
}

export function getEasingPoints(easing, customBezier) {
  if (easing === "custom") return normalizeBezier(customBezier);
  return normalizeBezier(EASING_PRESETS[easing] || EASING_PRESETS.ease);
}

export function resolveEasing(easing, customBezier) {
  if (easing === "linear" || easing === "none") return "linear";
  if (CSS_OPTIONS.some(([value]) => value === easing)) return easing;
  if (!isBezierEasing(easing) && EASING_OPTIONS.some(([value]) => value === easing)) {
    if (!resolvedCache.has(easing)) {
      resolvedCache.set(easing, `linear(${Array.from({ length: 201 }, (_, index) =>
        Number(sampleEasing(easing, index / 200).toFixed(5))).join(", ")})`);
    }
    return resolvedCache.get(easing);
  }
  const [x1, y1, x2, y2] = getEasingPoints(easing, customBezier);
  return `cubic-bezier(${format(x1)}, ${format(y1)}, ${format(x2)}, ${format(y2)})`;
}

export function easingLabel(easing) {
  return EASING_OPTIONS.find(([value]) => value === easing)?.[1] || easing;
}

function format(value) {
  return Number(value.toFixed(3));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
