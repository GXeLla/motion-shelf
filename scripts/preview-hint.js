/* Perceptual classification consumes rendered timeline samples produced by
   runtime-audit.js. Card rendering never guesses from names or raw CSS. */

export const PERCEPTION_THRESHOLDS = Object.freeze({
  meaningfulInterval: 0.018,
  noticeableExcursion: 0.055,
  subtleMaximum: 0.13,
  subtleCumulative: 0.42,
  slowAverageVelocity: 0.015,
  slowPeakVelocity: 0.04,
  slowNoticeSeconds: 1.25,
  /* Reserve the warning for critically brief perceptual exposure. */
  tooFastSeconds: 0.1,
  tooFastWholeAnimationSeconds: 0.12,
  tooFastMagnitude: 0.28,
  tooFastTimelineRatio: 0.2,
  dominantEventFraction: 0.3,
  lateAbsoluteSeconds: 0.65,
  lateRelativeRatio: 0.45,
  previewObservationSeconds: 0.75,
  lateScore: 0.65,
  confidence: 0.72,
});

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function colorDelta(a = [], b = []) {
  if (a.length < 3 || b.length < 3) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441;
}

function vectorDelta(a = [], b = [], divisor = 1) {
  const length = Math.max(a.length, b.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) total += ((a[index] || 0) - (b[index] || 0)) ** 2;
  return Math.sqrt(total) / divisor;
}

export function renderedStateDelta(a, b) {
  const width = Math.max(1, a.frame?.[0] || b.frame?.[0] || 320);
  const height = Math.max(1, a.frame?.[1] || b.frame?.[1] || 180);
  const contributions = {
    transform: Math.hypot((a.center[0] - b.center[0]) / width, (a.center[1] - b.center[1]) / height)
      + vectorDelta(a.matrix, b.matrix, 5),
    size: Math.hypot((a.box[2] - b.box[2]) / width, (a.box[3] - b.box[3]) / height),
    opacity: Math.abs(a.opacity - b.opacity),
    filter: vectorDelta(a.filterValues, b.filterValues, 4),
    color: colorDelta(a.color, b.color),
    background: colorDelta(a.backgroundColor, b.backgroundColor),
    border: Math.abs(a.borderWidth - b.borderWidth) / 12 + colorDelta(a.borderColor, b.borderColor),
    shadow: a.boxShadow === b.boxShadow && a.textShadow === b.textShadow ? 0 : 0.08,
    clip: a.clipPath === b.clipPath && a.mask === b.mask ? 0 : 0.1,
    position: a.backgroundPosition === b.backgroundPosition && a.objectPosition === b.objectPosition ? 0 : 0.08,
  };
  const magnitude = Math.sqrt(Object.values(contributions).reduce((sum, value) => sum + value ** 2, 0));
  const dominant = Object.entries(contributions).sort((left, right) => right[1] - left[1])[0];
  return { magnitude, dominant: dominant?.[0] || "" };
}

export function analyzeRenderedTimeline(samples, durationSeconds, interaction = "") {
  if (!Array.isArray(samples) || samples.length < 2) return { hint: "", confidence: 0 };
  const duration = Math.max(0.001, Number(durationSeconds) || 1);
  const intervals = [];
  let cumulative = 0;
  let onset = 1;
  let effective = 0;
  const dominantVotes = new Map();

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = renderedStateDelta(previous, current);
    const ratio = Math.max(0.0001, current.progress - previous.progress);
    const seconds = duration * ratio;
    const velocity = delta.magnitude / seconds;
    cumulative += delta.magnitude;
    if (delta.magnitude >= PERCEPTION_THRESHOLDS.meaningfulInterval) {
      if (onset === 1) onset = previous.progress;
      effective += seconds;
    }
    dominantVotes.set(delta.dominant, (dominantVotes.get(delta.dominant) || 0) + delta.magnitude);
    intervals.push({ ...delta, seconds, velocity, ratio });
  }

  const baseline = samples[0];
  const excursions = samples.map((sample) => renderedStateDelta(baseline, sample).magnitude);
  const maxVisualMagnitude = Math.max(...excursions, ...intervals.map((entry) => entry.magnitude));
  const velocities = intervals.filter((entry) => entry.magnitude >= PERCEPTION_THRESHOLDS.meaningfulInterval).map((entry) => entry.velocity);
  const averagePerceptualVelocity = velocities.length ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length : 0;
  const peakPerceptualVelocity = velocities.length ? Math.max(...velocities) : 0;
  const timeToNoticeableChange = Math.max(0, (samples.find((sample) => renderedStateDelta(baseline, sample).magnitude >= PERCEPTION_THRESHOLDS.noticeableExcursion)?.progress ?? 1) * duration);
  const meaningfulActiveMotionRatio = intervals.reduce((sum, entry) => sum + (entry.magnitude >= PERCEPTION_THRESHOLDS.meaningfulInterval ? entry.ratio : 0), 0);
  const largestInterval = Math.max(0, ...intervals.map((entry) => entry.magnitude));
  const dominantEventThreshold = Math.max(
    PERCEPTION_THRESHOLDS.meaningfulInterval,
    largestInterval * PERCEPTION_THRESHOLDS.dominantEventFraction,
  );
  const dominantEventIntervals = intervals.filter((entry) => entry.magnitude >= dominantEventThreshold);
  const meaningfulEventDuration = dominantEventIntervals.reduce((sum, entry) => sum + entry.seconds, 0);
  const meaningfulEventTimelineRatio = dominantEventIntervals.reduce((sum, entry) => sum + entry.ratio, 0);
  const dominantVisualProperty = [...dominantVotes].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const subtle = maxVisualMagnitude < PERCEPTION_THRESHOLDS.subtleMaximum && cumulative < PERCEPTION_THRESHOLDS.subtleCumulative;
  const slow = averagePerceptualVelocity < PERCEPTION_THRESHOLDS.slowAverageVelocity
    && peakPerceptualVelocity < PERCEPTION_THRESHOLDS.slowPeakVelocity
    && timeToNoticeableChange >= PERCEPTION_THRESHOLDS.slowNoticeSeconds;
  const compressedCriticalEvent = meaningfulEventDuration > 0
    && meaningfulEventDuration <= PERCEPTION_THRESHOLDS.tooFastSeconds
    && meaningfulEventTimelineRatio <= PERCEPTION_THRESHOLDS.tooFastTimelineRatio;
  const criticallyShortWholeAnimation = duration <= PERCEPTION_THRESHOLDS.tooFastWholeAnimationSeconds
    && effective > 0
    && effective <= PERCEPTION_THRESHOLDS.tooFastWholeAnimationSeconds;
  const tooFast = maxVisualMagnitude >= PERCEPTION_THRESHOLDS.tooFastMagnitude
    && (compressedCriticalEvent || criticallyShortWholeAnimation);
  const motionOnsetSeconds = onset * duration;
  const initialInactivityDuration = motionOnsetSeconds;
  const initialInactivityRatio = onset;
  const lateScore = Math.min(1, initialInactivityDuration / PERCEPTION_THRESHOLDS.lateAbsoluteSeconds) * 0.55
    + Math.min(1, initialInactivityRatio / PERCEPTION_THRESHOLDS.lateRelativeRatio) * 0.25
    + Math.min(1, initialInactivityDuration / PERCEPTION_THRESHOLDS.previewObservationSeconds) * 0.2;
  const late = lateScore >= PERCEPTION_THRESHOLDS.lateScore
    && maxVisualMagnitude >= PERCEPTION_THRESHOLDS.noticeableExcursion;
  const propertySpecific = ["filter", "shadow", "border", "background", "clip"].includes(dominantVisualProperty);
  const confidence = slow && subtle ? 0.9
    : tooFast ? 0.9
      : late ? 0.85
        : propertySpecific ? 0.85
          : Math.min(1, 0.55 + Math.abs(maxVisualMagnitude - PERCEPTION_THRESHOLDS.subtleMaximum) * 2);

  let hint = "";
  if (interaction === "hover" && meaningfulActiveMotionRatio < 0.2) hint = "Hover required";
  else if (slow && subtle) hint = "Slow & subtle";
  else if (slow && !subtle) hint = "Slow motion";
  else if (tooFast) hint = "Too fast";
  else if (late) hint = "Late motion";
  else if (dominantVisualProperty === "filter") hint = "Filter effect";
  else if (dominantVisualProperty === "shadow") hint = "Shadow effect";
  else if (dominantVisualProperty === "border") hint = "Border effect";
  else if (dominantVisualProperty === "background") hint = "Background effect";
  else if (dominantVisualProperty === "clip") hint = "Clip effect";
  else if (subtle && maxVisualMagnitude > 0) hint = "Subtle motion";
  if (confidence < PERCEPTION_THRESHOLDS.confidence) hint = "";

  return {
    hint,
    maxVisualMagnitude,
    cumulativeVisualMagnitude: cumulative,
    averagePerceptualVelocity,
    medianPerceptualVelocity: median(velocities),
    peakPerceptualVelocity,
    meaningfulActiveMotionRatio,
    effectiveMotionDuration: effective,
    meaningfulEventDuration,
    meaningfulEventTimelineRatio,
    timeToNoticeableChange,
    motionOnset: onset,
    motionOnsetPercent: onset * 100,
    motionOnsetSeconds,
    initialInactivityDuration,
    initialInactivityRatio,
    dominantVisualProperty,
    slowScore: slow ? 1 : 0,
    subtleScore: subtle ? 1 : 0,
    tooFastScore: tooFast
      ? Math.min(1, PERCEPTION_THRESHOLDS.tooFastSeconds / meaningfulEventDuration)
      : 0,
    lateScore,
    confidence,
  };
}

export function getPreviewHint(animation) {
  return String(animation?.previewHint || "");
}
