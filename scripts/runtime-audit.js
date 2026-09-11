import { getResolvedEasing, normalizeKeyframes, normalizePreviewViewportUnits } from "./animations.js";
import { escapeHtml, sanitizeAnimationName } from "./utils.js";
import { assessPreviewSafety } from "./preview-safety.js";
import { parseKeyframes } from "./animation-extract.js";
import { analyzeRenderedTimeline } from "./preview-hint.js";

const BATCH = 20;
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function applyDeclarations(node, css) {
  String(css || "").split(";").forEach((entry) => {
    const index = entry.indexOf(":");
    if (index < 1) return;
    node.style.setProperty(entry.slice(0, index).trim(), entry.slice(index + 1).trim());
  });
}

function numericValues(value) {
  return [...String(value || "").matchAll(/-?\d*\.?\d+/g)].map((match) => Number(match[0])).filter(Number.isFinite);
}

function matrixValues(transform) {
  try {
    const matrix = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
    return [matrix.m11, matrix.m12, matrix.m13, matrix.m21, matrix.m22, matrix.m23, matrix.m31, matrix.m32, matrix.m33];
  } catch { return []; }
}

function snapshot(node, frame, progress) {
  const style = getComputedStyle(node);
  const box = node.getBoundingClientRect();
  const visible = style.display !== "none" && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0.01
    && box.right > frame.left && box.left < frame.right && box.bottom > frame.top && box.top < frame.bottom;
  return {
    visible,
    progress,
    frame: [frame.width, frame.height],
    box: [box.left, box.top, box.width, box.height],
    center: [box.left + box.width / 2, box.top + box.height / 2],
    matrix: matrixValues(style.transform),
    transform: style.transform,
    opacity: Number(style.opacity || 1),
    filter: style.filter,
    filterValues: numericValues(style.filter),
    color: numericValues(style.color).slice(0, 4),
    backgroundColor: numericValues(style.backgroundColor).slice(0, 4),
    backgroundPosition: style.backgroundPosition,
    borderWidth: Number.parseFloat(style.borderWidth) || 0,
    borderColor: numericValues(style.borderColor).slice(0, 4),
    boxShadow: style.boxShadow,
    textShadow: style.textShadow,
    clipPath: style.clipPath,
    mask: style.maskImage,
    objectPosition: style.objectPosition,
    display: style.display,
    visibility: style.visibility,
  };
}

function samplePositions(batch) {
  const positions = new Set(Array.from({ length: 21 }, (_, index) => index / 20));
  batch.forEach(({ animation }) => {
    const steps = parseKeyframes(normalizeKeyframes(animation)).values().next().value || [];
    steps.forEach((step) => {
      const point = step.offset / 100;
      positions.add(point);
      positions.add(Math.max(0, point - 0.01));
      positions.add(Math.min(1, point + 0.01));
    });
  });
  return [...positions].sort((a, b) => a - b);
}

function changed(first, last) {
  return first.box.join("|") !== last.box.join("|")
    || first.transform !== last.transform
    || first.opacity !== last.opacity
    || first.filter !== last.filter;
}

function classify(animation, safety, samples) {
  if (!String(animation.keyframes || "").trim()) return { kind: "broken", reason: "Missing keyframes" };
  if (!safety.valid) return { kind: "broken", reason: safety.reasons.join(", ") };
  if (!samples.some((sample) => sample.visible)) return { kind: "broken", reason: "Element never enters safe frame" };
  if (!samples.slice(1).some((sample) => changed(samples[0], sample))) {
    return { kind: "no visible effect", reason: "No visible property change" };
  }
  if (safety.previewNormalize) return { kind: "preview-only fix", reason: "Preview-bounded extreme motion" };
  return { kind: "valid", reason: "" };
}

function mount(animation, index) {
  const frame = document.createElement("div");
  frame.className = "runtime-audit-frame";
  frame.style.cssText = `position:fixed;left:${-10000 - index * 4}px;top:0;width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;overflow:hidden;contain:layout paint;display:grid;place-items:center;`;
  const parent = document.createElement("div");
  parent.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;display:grid;place-items:center;";
  applyDeclarations(parent, animation.parent);
  const target = document.createElement("div");
  target.style.cssText = "width:58%;height:58%;display:block;background:linear-gradient(135deg,#80d8c4,#397c88);";
  applyDeclarations(target, animation.css);

  const name = `msAudit${index}`;
  const keyframes = normalizePreviewViewportUnits(normalizeKeyframes(animation))
    .replace(new RegExp(`@keyframes\\s+${sanitizeAnimationName(animation.animationName)}`, "i"), `@keyframes ${name}`);
  const style = document.createElement("style");
  style.textContent = keyframes;
  target.style.animation = `${name} 1000ms ${getResolvedEasing(animation)} 0s 1 both paused`;
  frame.append(style, parent);
  parent.appendChild(target);
  document.body.appendChild(frame);
  return { frame, parent, target };
}

function totalsFor(records) {
  const totals = { valid: 0, "auto-fixable": 0, "preview-only fix": 0, "no visible effect": 0, broken: 0, "manual review required": 0 };
  records.forEach((record) => { totals[record.kind] += 1; });
  return totals;
}

function resolveRuntimeVariables(value, variables) {
  let resolved = String(value || "");
  for (let pass = 0; pass < 3; pass += 1) {
    resolved = resolved.replace(/var\((--ms-[\w-]+)(?:\s*,\s*([^)]*))?\)/g,
      (whole, name, fallback) => variables.get(name) || fallback || whole);
  }
  return resolved;
}

/* Names and provenance do not affect rendered output. This signature lets a
   canonical candidate audited during scanning satisfy the final canonical
   result when its actual preview behavior stayed identical. */
export function runtimeAuditSignature(animation) {
  const css = String(animation?.css || "");
  const parent = String(animation?.parent || "");
  const variables = new Map();
  `${css};${parent}`.replace(/(--ms-[\w-]+)\s*:\s*([^;]+)/g, (whole, name, value) => {
    variables.set(name, value.trim());
    return whole;
  });
  const clean = (value) => resolveRuntimeVariables(value, variables)
    .replace(/--ms-[\w-]+\s*:\s*[^;]+;?/g, "")
    .replace(/@keyframes\s+[^\s{]+/gi, "@keyframes _")
    .replace(/\s+/g, " ")
    .trim();

  return JSON.stringify({
    target: animation?.target || "div",
    interaction: animation?.interaction || "",
    duration: Number(animation?.duration) || 0,
    durationUnit: animation?.durationUnit === "ms" ? "ms" : "s",
    easing: getResolvedEasing(animation || {}),
    css: clean(css),
    parent: clean(parent),
    keyframes: clean(normalizeKeyframes(animation || {})),
  });
}

export async function auditAnimationsAtRuntime(animations, { onProgress } = {}) {
  const records = [];
  const source = Array.isArray(animations) ? animations : [];
  for (let offset = 0; offset < source.length; offset += BATCH) {
    const batch = source.slice(offset, offset + BATCH).map((animation, index) => ({ animation, ...mount(animation, offset + index) }));
    await nextFrame();
    const samples = batch.map(() => []);
    for (const progress of samplePositions(batch)) {
      batch.forEach((entry) => {
        const player = entry.target.getAnimations()[0];
        if (player) { player.pause(); player.currentTime = progress * 1000; }
      });
      await nextFrame();
      batch.forEach((entry, index) => samples[index].push(
        snapshot(entry.target, entry.frame.getBoundingClientRect(), progress),
      ));
    }
    batch.forEach((entry, index) => {
      const safety = assessPreviewSafety(entry.animation);
      const result = classify(entry.animation, safety, samples[index]);
      const duration = Number(entry.animation.duration) * (entry.animation.durationUnit === "ms" ? 0.001 : 1);
      const perception = analyzeRenderedTimeline(samples[index], duration, entry.animation.interaction);
      records.push({ index: offset + index, id: entry.animation.id, name: entry.animation.name, ...result, previewHint: perception.hint, perception });
      entry.frame.remove();
    });
    onProgress?.({ total: source.length, checked: records.length, totals: totalsFor(records), records: [...records] });
  }
  return { total: records.length, totals: totalsFor(records), records };
}

/* A single bounded queue shared by live scanning and final reconciliation.
   Scanner callbacks only enqueue, so archive I/O keeps moving while runtime
   frames are sampled. finish() audits only final signatures not already done. */
export function createRuntimeAuditQueue({ batchSize = BATCH, onProgress } = {}) {
  const waiting = [];
  const pendingBySignature = new Map();
  const recordsBySignature = new Map();
  const liveRecords = [];
  let draining = false;
  let scheduled = false;

  const progress = () => ({
    total: recordsBySignature.size + pendingBySignature.size,
    checked: recordsBySignature.size,
    totals: totalsFor(liveRecords),
    records: [...liveRecords],
  });

  async function drain() {
    if (draining) return;
    draining = true;
    scheduled = false;

    try {
      while (waiting.length) {
        const items = waiting.splice(0, Math.max(1, Math.min(BATCH, batchSize)));
        try {
          const report = await auditAnimationsAtRuntime(items.map((item) => item.animation));
          items.forEach((item, index) => {
            const record = report.records[index];
            recordsBySignature.set(item.signature, record);
            pendingBySignature.delete(item.signature);
            liveRecords.push(record);
            item.resolve(record);
          });
          onProgress?.(progress());
        } catch (error) {
          items.forEach((item) => {
            pendingBySignature.delete(item.signature);
            item.reject(error);
          });
        }
      }
    } finally {
      draining = false;
      if (waiting.length) schedule();
    }
  }

  function schedule() {
    if (scheduled || draining) return;
    scheduled = true;
    queueMicrotask(drain);
  }

  function enqueue(animation) {
    const signature = runtimeAuditSignature(animation);
    if (recordsBySignature.has(signature)) {
      return Promise.resolve(recordsBySignature.get(signature));
    }
    if (pendingBySignature.has(signature)) return pendingBySignature.get(signature);

    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    pendingBySignature.set(signature, promise);
    waiting.push({ animation, signature, resolve, reject });
    schedule();
    return promise;
  }

  async function finish(animations) {
    const source = Array.isArray(animations) ? animations : [];
    const records = await Promise.all(source.map(async (animation, index) => {
      const record = await enqueue(animation);
      return { ...record, index, id: animation.id, name: animation.name };
    }));
    return { total: records.length, checked: records.length, totals: totalsFor(records), records };
  }

  return { enqueue, finish, progress };
}

/* Apply one shared audit record to either an imported candidate or a manual
   animation. Imported failures are quarantined by Sync; manual animations
   remain editable/visible while still retaining their audit diagnosis. */
export function applyRuntimeAuditRecord(animation, record, { quarantineBroken = true } = {}) {
  if (!animation) return animation;

  animation.previewHint = record?.previewHint || "";
  animation.previewAnalysis = record?.perception || null;

  if (!record) {
    animation.audit = null;
    return animation;
  }

  const failed = record.kind === "broken" || record.kind === "no visible effect";
  animation.audit = {
    status: failed && quarantineBroken ? "broken / quarantined" : record.kind,
    reason: record.reason || "",
    checkedAt: Date.now(),
  };

  return animation;
}

/* Shared presentation for Sync completion. The manual trigger is gone, but
   this keeps the audit's own cards, status counts and failure detail together
   rather than recreating a smaller Sync-only version. */
export function renderAuditSummary(container, report) {
  const broken = report.records.filter((record) =>
    record.kind === "broken" || record.kind === "no visible effect");
  const fixed = report.totals["auto-fixable"] + report.totals["preview-only fix"];
  container.hidden = false;
  container.innerHTML = `
    <section class="runtime-audit-summary" aria-labelledby="syncAuditTitle">
      <div class="runtime-audit-summary-heading"><span class="eyebrow">RUNTIME AUDIT</span><h3 id="syncAuditTitle">Audit Results</h3><p>${report.checked ?? report.total} of ${report.total} canonical animations checked in isolated safe preview frames.</p></div>
      <dl class="runtime-audit-counts">
        <div class="is-valid"><dt>Valid Animations</dt><dd>${report.totals.valid}</dd></div>
        <div class="is-fixed"><dt>Auto / Preview Fixed</dt><dd>${fixed}</dd></div>
        <div class="is-broken"><dt>Broken Animations</dt><dd>${broken.length}</dd></div>
      </dl>
      ${broken.length ? `<details class="runtime-audit-broken"><summary>Broken Animations <b>${broken.length}</b><i class="fa-solid fa-chevron-down"></i></summary><div>${broken.map((record) => `<p title="${escapeHtml(record.kind)}"><b>${escapeHtml(record.name)}</b><span>${escapeHtml(record.reason)}</span></p>`).join("")}</div></details>` : ""}
    </section>`;
}
