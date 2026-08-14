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

export const EASING_OPTIONS = [
  ["ease", "CSS · Ease"],
  ["linear", "CSS · Linear"],
  ["ease-in", "CSS · Ease in"],
  ["ease-out", "CSS · Ease out"],
  ["ease-in-out", "CSS · Ease in/out"],
  ["power1.out", "GSAP · power1.out"],
  ["power2.out", "GSAP · power2.out"],
  ["power3.out", "GSAP · power3.out"],
  ["power4.out", "GSAP · power4.out"],
  ["sine.inOut", "GSAP · sine.inOut"],
  ["circ.out", "GSAP · circ.out"],
  ["expo.out", "GSAP · expo.out"],
  ["back.out(1.7)", "GSAP · back.out(1.7)"],
  ["custom", "Custom cubic-bezier"],
];

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
  if (easing === "linear") return "linear";
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
