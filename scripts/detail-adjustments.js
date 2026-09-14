import { resolveParameters, labelForVariable } from "./parameters.js";
import { escapeHtml, escapeAttribute } from "./utils.js";
import { EASING_OPTIONS } from "./easing.js";

const TIMING = new Set(["--ms-duration", "--ms-delay", "--ms-ease"]);
const GROUPS = {
  timing: "Animation timing & easing",
  motion: "Keyframe motion · movement & rotation",
  transform: "Transform · scale & origin",
  "3d": "3D depth & perspective",
  image: "Image fit & position",
  shape: "Shape & appearance",
  box: "Element size",
  container: "Container layout & clipping",
};

// Each details opening owns a fresh copy. No storage or library record is edited.
export function createDetailDraft(animation) {
  return structuredClone(animation);
}

export function setDetailValue(draft, scope, name, value) {
  if (scope === "timing") {
    if (name === "duration" || name === "delay") {
      const match = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(value);
      if (!match || !Number.isFinite(Number(match[1])) || (name === "duration" && Number(match[1]) <= 0)) return false;
      draft[name] = Number(match[1]);
      draft[`${name}Unit`] = match[2];
    } else if (name === "iterationCount") {
      if (value !== "infinite" && (!/^\d*\.?\d+$/.test(value) || Number(value) <= 0)) return false;
      draft.iterationCount = value;
    } else if (name === "easing") {
      if (!EASING_OPTIONS.some(([key]) => key === value)) return false;
      draft.easing = value;
    } else if (name === "cubicBezier") {
      const points = value.split(",").map(part => Number(part.trim()));
      if (points.length !== 4 || value.split(",").some(part => !part.trim()) || !points.every(Number.isFinite) || points[0] < 0 || points[0] > 1 || points[2] < 0 || points[2] > 1) return false;
      draft.cubicBezier = points;
      draft.easing = "custom";
    } else return false;
    return true;
  }
  const entries = resolveParameters(draft)[scope === "parent" ? "parent" : "target"];
  if (!entries.some(entry => entry.name === name) || !/^--[\w-]+$/.test(name) || !value || /[;{}]/.test(value)) return false;
  const field = scope === "parent" ? "parent" : "css";
  const pattern = new RegExp(`(^|;)\\s*${name}\\s*:[^;]*;?`, "g");
  draft[field] = `${name}: ${value};\n` + String(draft[field] || "").replace(pattern, "$1").trim();
  return true;
}

function control(label, scope, name, value, hint = "") {
  return `<label class="template-value"><span>${escapeHtml(label)}</span><input type="text" spellcheck="false" data-adjust-scope="${scope}" data-adjust-name="${escapeAttribute(name)}" value="${escapeAttribute(String(value))}" ${hint ? `placeholder="${escapeAttribute(hint)}"` : ""}></label>`;
}

export function renderDetailAdjustments(animation) {
  const parameters = resolveParameters(animation);
  const groups = (entries, scope) => {
    const grouped = new Map();
    for (const entry of entries.filter(entry => !TIMING.has(entry.name))) {
      const group = entry.group || (scope === "parent" ? "container" : "motion");
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(entry);
    }
    return [...grouped].map(([group, entries]) => `<div class="template-group"><h4 class="template-group-title">${escapeHtml(GROUPS[group] || group)}</h4>${entries.map(entry => control(entry.label || labelForVariable(entry.name), scope, entry.name, entry.value)).join("")}</div>`).join("");
  };
  return `<details class="detail-adjustments">
    <summary><span>Adjust animation for copy</span><span class="adjust-chevron" aria-hidden="true">⌄</span></summary>
    <div class="template-values" id="templateValues">
      <p class="adjust-note">Try changes in the preview and copied CSS. Your saved animation stays unchanged. Closing details resets these values.</p>
      <section class="template-section"><h3 class="template-values-title">Animation timing & easing</h3><div class="template-group">
        ${control("Duration (s or ms)", "timing", "duration", `${animation.duration || 1.2}${animation.durationUnit || "s"}`)}
        ${control("Start delay (s or ms)", "timing", "delay", `${animation.delay || 0}${animation.delayUnit || "s"}`)}
        ${control("Repeat count / infinite", "timing", "iterationCount", animation.iterationCount || (animation.interaction === "infinite" ? "infinite" : "1"))}
        <label class="template-value"><span>Easing curve</span><select data-adjust-scope="timing" data-adjust-name="easing">${EASING_OPTIONS.map(([value, label]) => `<option value="${escapeAttribute(value)}" ${value === animation.easing ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
        <div class="adjust-bezier" ${animation.easing === "custom" ? "" : "hidden"}>${control("Custom curve · x1, y1, x2, y2", "timing", "cubicBezier", (animation.cubicBezier || [0.25, 0.1, 0.25, 1]).join(", "))}</div>
      </div></section>
      ${parameters.target.some(entry => !TIMING.has(entry.name)) ? `<section class="template-section"><h3 class="template-values-title">Keyframe & element properties</h3>${groups(parameters.target, "target")}</section>` : ""}
      ${parameters.parent.length ? `<section class="template-section"><h3 class="template-values-title">Parent / container properties</h3>${groups(parameters.parent, "parent")}</section>` : ""}
      <p class="adjust-error" role="status" hidden>Enter a valid value. The preview and copy keep the last valid value.</p>
    </div>
  </details>`;
}
