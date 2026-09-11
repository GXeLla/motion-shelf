/* Static safety checks for imported motion. They intentionally reject only
   states that can never be seen; unusual but legitimate movement remains in
   the library and is handled by the preview-only normalizer. */

function valuesFor(steps, property) {
  return steps
    .map((step) => step.declarations?.[property])
    .filter((value) => value !== undefined)
    .map((value) => String(value).trim().toLowerCase());
}

export function assessPreviewSafety(record = {}) {
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const opacity = valuesFor(steps, "opacity").map(Number).filter(Number.isFinite);
  const visibility = valuesFor(steps, "visibility");
  const display = valuesFor(steps, "display");
  const motion = steps
    .flatMap((step) => Object.entries(step.declarations || {}))
    .filter(([property]) => /^(?:transform|translate|offset-distance)$/i.test(property))
    .map(([, value]) => String(value))
    .join(" ");

  const reasons = [];
  if (opacity.length && opacity.every((value) => value <= 0)) reasons.push("opacity never becomes visible");
  if (visibility.length && visibility.every((value) => value === "hidden" || value === "collapse")) reasons.push("visibility never becomes visible");
  if (display.length && display.every((value) => value === "none")) reasons.push("display never becomes visible");

  return {
    valid: reasons.length === 0,
    reasons,
    previewNormalize: /(?:[+-]?\d*\.?\d+v(?:w|h|min|max)\b|[+-]?(?:1[6-9]\d|[2-9]\d{2,})px\b|[+-]?(?:1[8-9]\d|[2-9]\d{2,})%\b)/i.test(motion),
  };
}
