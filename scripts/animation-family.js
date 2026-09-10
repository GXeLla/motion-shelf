/*
 * Post-import analysis: classification, animation families and templates.
 *
 * The scanner (campaign-scan.js) and extractor (animation-extract.js) turn
 * campaign source into raw animation records and collapse exact duplicates.
 * This module runs after that and answers the harder questions: what element
 * was this for, what triggers it, which of these near-identical animations
 * are really one technique, and which of their values should be adjustable.
 *
 * Pure functions only, so the browser and a headless harness share it.
 */

import {
  describeMotion,
  fingerprintSteps,
  hashString,
  inferCategories,
  isMeaninglessName,
  resolveEasingForShelf,
  stepsToKeyframeCss,
  titleFromName,
  unprefixProperty,
} from "./animation-extract.js";

import { resolveEasing } from "./easing.js";

/* ==================================================
VALUE ANATOMY

A declaration is split into a structural shape and the magnitudes inside it.
"translateY(-10px)" is structurally "translateY(-)" carrying the magnitude 10,
which is what lets a 10px float and a 20px float land in one family.
================================================== */

const NUMBER_PATTERN = /^([+-]?\d*\.?\d+)([a-z%]*)$/i;

/*
 * Motion is written three ways in this archive: the transform shorthand, the
 * standalone translate/scale/rotate properties that newer authoring tools
 * emit, and the 3d variants. All of them are read the same way here, so a
 * "scale: 1.05" pulse is understood exactly like "transform: scale(1.05)".
 */
const TRANSFORM_PROPERTIES = new Set(["transform", "translate", "scale", "rotate"]);

export function componentsFor(property, value) {
  if (property === "transform") return parseTransformFunctions(value);

  if (TRANSFORM_PROPERTIES.has(property)) {
    return [{
      name: property,
      args: String(value || "").trim().split(/\s+/).filter(Boolean),
    }];
  }

  return null;
}

/* Which adjustable quantity an argument represents. */
export function resolveKind(name, argIndex, argCount) {
  const lower = String(name).toLowerCase();

  if (lower === "translate" || lower === "translate3d") {
    return ["translateX", "translateY", "translateZ"][argIndex] || "translateX";
  }

  if (lower === "scale" || lower === "scale3d") {
    if (argCount <= 1) return "scale";
    return ["scaleX", "scaleY", "scaleZ"][argIndex] || "scale";
  }

  if (lower === "rotate3d") return "rotate";
  return name;
}

export function parseTransformFunctions(value) {
  const functions = [];
  const pattern = /([a-zA-Z0-9]+)\s*\(([^)]*)\)/g;
  let match;

  while ((match = pattern.exec(String(value || ""))) !== null) {
    functions.push({
      name: match[1],
      args: match[2].split(",").map((argument) => argument.trim()).filter(Boolean),
    });
  }

  return functions;
}

function readNumber(text) {
  const match = String(text || "").trim().match(NUMBER_PATTERN);
  if (!match) return null;

  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;

  return { number, unit: match[2] || "" };
}

/* Identity values are structure, not configuration: a float that returns to
   translateY(0) must keep that zero, or the shape of the motion is lost. */
function isIdentity(functionName, number) {
  if (/^scale/i.test(functionName)) return number === 1;
  return number === 0;
}

function magnitudeToken(functionName, number) {
  if (isIdentity(functionName, number)) return /^scale/i.test(functionName) ? "1" : "0";
  if (/^scale/i.test(functionName)) return number > 1 ? ">" : "<";
  return number < 0 ? "-" : "+";
}

function opacityToken(number) {
  if (number === 0) return "0";
  if (number === 1) return "1";
  return "m";
}

/*
 * Walks one animation's steps and reports both its structural shape and every
 * adjustable magnitude, keyed by where it sits so the same slot can be
 * compared across the members of a family.
 */
export function analyzeSteps(steps) {
  const shape = [];
  const slots = new Map();

  steps.forEach((step, stepIndex) => {
    const parts = [];

    Object.keys(step.declarations).sort().forEach((rawProperty) => {
      const property = unprefixProperty(rawProperty);
      const value = step.declarations[rawProperty];
      const components = componentsFor(property, value);

      if (components) {
        const rendered = components.map((component, componentIndex) => {
          const args = component.args.map((argument, argumentIndex) => {
            const parsed = readNumber(argument);
            if (!parsed) return argument.toLowerCase();

            const kind = resolveKind(component.name, argumentIndex, component.args.length);
            const token = magnitudeToken(kind, parsed.number);

            if (token !== "0" && token !== "1") {
              slots.set(stepIndex + ":" + property + ":" + componentIndex + ":" + argumentIndex, {
                kind,
                magnitude: Math.abs(parsed.number),
                sign: parsed.number < 0 ? -1 : 1,
                unit: parsed.unit,
                raw: parsed.number,
              });
            }

            return token;
          });

          return property === "transform"
            ? component.name + "(" + args.join(",") + ")"
            : args.join(" ");
        });

        parts.push(property + ":" + rendered.join(" "));
        return;
      }

      if (property === "opacity") {
        const parsed = readNumber(value);
        const number = parsed ? parsed.number : 1;

        if (number !== 0 && number !== 1) {
          slots.set(stepIndex + ":opacity:0:0", {
            kind: "opacity",
            magnitude: number,
            sign: 1,
            unit: "",
            raw: number,
          });
        }

        parts.push("opacity:" + opacityToken(number));
        return;
      }

      /* Everything else keeps its shape but loses its numbers. */
      const abstracted = String(value)
        .replace(/([+-]?\d*\.?\d+)([a-z%]*)/gi, (whole, number) => (Number(number) === 0 ? "0" : "n"))
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      parts.push(property + ":" + abstracted);
    });

    shape.push(Number(step.offset.toFixed(2)) + "{" + parts.join(";") + "}");
  });

  return { shape: shape.join("|"), slots };
}


/*
 * The family fingerprint. Two animations share it when they move the same way
 * and differ only in how far, how big or how fast -- which is exactly the
 * difference between float-small and float-large. Offsets and directions stay
 * part of the identity, so a three step float never merges with a five step
 * bounce, and sliding left never merges with sliding right.
 */
export function familyFingerprint(steps, options = {}) {
  const { shape } = analyzeSteps(steps);
  const loops = options.iterationCount === "infinite" ? "loop" : "once";
  const direction = options.direction && options.direction !== "normal" ? options.direction : "normal";

  return hashString(shape + "#" + loops + "#" + direction);
}

/* ==================================================
TARGET AND CONTAINER DETECTION
================================================== */

const IMAGE_WORDS = /\b(?:img|image|bild|photo|foto|picture|visual|product|produkt|packshot|pack|logo|thumb|hero|shot)\b/i;
const TEXT_WORDS = /\b(?:text|headline|title|copy|claim|subline|label|caption|legal|disclaimer)\b/i;
const BUTTON_WORDS = /\b(?:cta|button|btn)\b/i;

/*
 * Works out what the animation was written for. Markup wins when it is
 * available -- an <img class="product"> is decisive -- and selector wording is
 * only a fallback. Anything unclear stays on the safe generic target.
 */
export function detectTarget(context = {}) {
  const selector = String(context.selector || "");
  const declarations = context.declarations || {};
  const tagByClass = context.tagByClass || new Map();

  /* Markup evidence. */
  const classNames = selector.match(/\.([\w-]+)/g) || [];
  for (const entry of classNames) {
    const tag = tagByClass.get(entry.slice(1));
    if (tag === "img") return { target: "img", reason: "markup" };
    if (tag === "button" || tag === "a") return { target: "div", reason: "markup" };
  }

  if (/(^|[\s>+~(])img\b/i.test(selector)) return { target: "img", reason: "selector" };

  /* Styling evidence. */
  const values = Object.entries(declarations).map(([property, value]) => property + ":" + value).join(";");
  if (/object-fit|background-image|background:\s*url/i.test(values)) {
    return { target: "img", reason: "styles" };
  }

  /* Naming evidence, weakest of the three. */
  if (IMAGE_WORDS.test(selector)) return { target: "img", reason: "naming" };
  if (BUTTON_WORDS.test(selector) || TEXT_WORDS.test(selector)) return { target: "div", reason: "naming" };

  return { target: "div", reason: "default" };
}

/*
 * Whether the motion needs something from its container. These are the
 * properties an animation genuinely breaks without -- clipping, depth and
 * transform context -- not campaign layout.
 */
export function detectContainerNeeds(steps, parentStyles = {}) {
  const needs = { ...parentStyles };
  let uses3d = false;
  let leavesBox = false;

  steps.forEach(({ declarations }) => {
    Object.entries(declarations).forEach(([rawProperty, value]) => {
      const property = unprefixProperty(rawProperty);
      const components = componentsFor(property, value);
      if (!components) return;

      components.forEach((fn) => {
        if (/^(?:rotate[XY]|translateZ|perspective|rotate3d|translate3d)$/i.test(fn.name)) uses3d = true;

        if (/^translate/i.test(fn.name)) {
          fn.args.forEach((argument) => {
            const parsed = readNumber(argument);
            if (parsed && Math.abs(parsed.number) > 0) leavesBox = true;
          });
        }
      });
    });
  });

  if (uses3d && !needs.perspective) needs.perspective = "1000px";
  if (uses3d && !needs["transform-style"]) needs["transform-style"] = "preserve-3d";
  void leavesBox;

  return needs;
}

/* ==================================================
BEHAVIOUR NAMING

Historical names like anim1, move2 or productAnim say nothing, so the family
is named after what it actually does.
================================================== */

function transformSummary(steps) {
  const summary = {
    translateX: [], translateY: [], translateZ: [],
    scale: [], scaleX: [], scaleY: [],
    rotate: [], rotateX: [], rotateY: [],
    skewX: [], skewY: [], opacity: [],
  };

  steps.forEach(({ declarations }) => {
    Object.entries(declarations).forEach(([rawProperty, value]) => {
      const property = unprefixProperty(rawProperty);

      if (property === "opacity") {
        const parsed = readNumber(value);
        if (parsed) summary.opacity.push(parsed.number);
        return;
      }

      const components = componentsFor(property, value);
      if (!components) return;

      components.forEach((component) => {
        component.args.forEach((argument, argumentIndex) => {
          const parsed = readNumber(argument);
          if (!parsed) return;

          const kind = resolveKind(component.name, argumentIndex, component.args.length);
          if (summary[kind]) summary[kind].push(parsed.number);

          /* A uniform scale reads as both axes for naming purposes. */
          if (kind === "scale") {
            summary.scaleX.push(parsed.number);
            summary.scaleY.push(parsed.number);
          }
        });
      });
    });
  });

  return summary;
}


function returnsToStart(values) {
  if (values.length < 3) return false;
  return Math.abs(values[0] - values[values.length - 1]) < 0.001
    && values.some((value) => Math.abs(value - values[0]) > 0.001);
}

/* Names the family after its behaviour, e.g. Vertical Float, Fade Up. */
export function describeFamily(steps, timing = {}) {
  const summary = transformSummary(steps);
  const looping = timing.iterationCount === "infinite";

  const movesY = summary.translateY.some((value) => Math.abs(value) > 0.001);
  const movesX = summary.translateX.some((value) => Math.abs(value) > 0.001);
  const scales = summary.scale.some((value) => Math.abs(value - 1) > 0.001);
  const rotates = summary.rotate.some((value) => Math.abs(value) > 0.001);
  const flips = summary.rotateX.concat(summary.rotateY).some((value) => Math.abs(value) > 0.001);

  const opacity = summary.opacity;
  const fadesIn = opacity.length > 1 && opacity[opacity.length - 1] > opacity[0];
  const fadesOut = opacity.length > 1 && opacity[opacity.length - 1] < opacity[0];

  const declarationText = steps
    .map(({ declarations }) => Object.entries(declarations).map(([p, v]) => p + ":" + v).join(";"))
    .join("|");
  const blurs = /blur\(/i.test(declarationText);
  const clips = /clip-path|inset\(|circle\(|polygon\(/i.test(declarationText);

  /* Looping motion that comes back to where it started is the "float" and
     "pulse" family; one-shot motion is an entrance or an exit. */
  if (looping || returnsToStart(summary.translateY) || returnsToStart(summary.scale)) {
    if (returnsToStart(summary.translateY) || (looping && movesY && !scales)) return "Vertical Float";
    if (returnsToStart(summary.translateX) || (looping && movesX && !scales)) return "Horizontal Drift";
    if (returnsToStart(summary.scale) || (looping && scales)) return "Pulse";
    if (looping && rotates) return "Continuous Rotation";
    if (looping && (fadesIn || fadesOut)) return "Blink";
  }

  if (clips) return fadesOut ? "Clip Hide" : "Clip Reveal";
  if (blurs) return fadesOut ? "Blur Fade Out" : "Blur Reveal";

  if (flips) return "Flip In";

  if (scales && (fadesIn || fadesOut)) {
    const growing = summary.scale.length > 1 && summary.scale[summary.scale.length - 1] > summary.scale[0];
    if (fadesOut) return growing ? "Scale Fade Out" : "Shrink Fade Out";
    return growing ? "Scale Fade In" : "Shrink Fade In";
  }

  if (movesY && (fadesIn || fadesOut)) {
    const rising = summary.translateY[0] > summary.translateY[summary.translateY.length - 1];
    if (fadesOut) return rising ? "Fade Out Up" : "Fade Out Down";
    return rising ? "Fade Up" : "Fade Down";
  }

  if (movesX && (fadesIn || fadesOut)) {
    /* An entrance is named for where it comes from, an exit for where it
       goes, which is the only reading that is not ambiguous. */
    const goingRight = summary.translateX[0] < summary.translateX[summary.translateX.length - 1];
    if (fadesOut) return goingRight ? "Slide Out Right" : "Slide Out Left";
    return goingRight ? "Slide In From Left" : "Slide In From Right";
  }

  /* Opacity that rises and falls again never reads as a plain fade. */
  if (opacity.length > 2) {
    const peak = Math.max(...opacity);
    const trough = Math.min(...opacity);
    const ends = Math.abs(opacity[0] - opacity[opacity.length - 1]) < 0.05;

    if (ends && peak - opacity[0] > 0.1) return "Fade In Out";
    if (ends && opacity[0] - trough > 0.1) return "Fade Out In";
  }

  /* Some campaigns animate layout properties rather than transforms. */
  const boxNumbers = (property) => {
    const values = [];
    steps.forEach(({ declarations }) => {
      const value = declarations[property];
      if (value === undefined) return;
      const parsed = readNumber(value);
      if (parsed) values.push(parsed.number);
    });
    return values;
  };

  const changed = (values) => values.length > 1 && Math.max(...values) - Math.min(...values) > 0.001;

  const width = boxNumbers("width");
  const height = boxNumbers("height");
  if (changed(width) || changed(height)) {
    const values = changed(width) ? width : height;
    return values[values.length - 1] > values[0] ? "Expand" : "Collapse";
  }

  const top = boxNumbers("top");
  const left = boxNumbers("left");
  if (changed(top)) return top[0] > top[top.length - 1] ? "Rise Into Place" : "Drop Into Place";
  if (changed(left)) return left[0] > left[left.length - 1] ? "Travel Left" : "Travel Right";

  if (movesY) return summary.translateY[0] > 0 ? "Slide Up" : "Slide Down";
  if (movesX) return summary.translateX[0] > 0 ? "Slide In From Right" : "Slide In From Left";
  if (scales) return fadesOut ? "Scale Out" : "Scale In";
  if (rotates) return "Rotate";
  if (fadesIn) return "Fade In";
  if (fadesOut) return "Fade Out";

  return describeMotion(steps);
}

/* ==================================================
TEMPLATE VARIABLES
================================================== */

const VARIABLE_NAMES = {
  translateX: "--ms-x",
  translateY: "--ms-y",
  translateZ: "--ms-z",
  translate: "--ms-x",
  translate3d: "--ms-x",
  scale: "--ms-scale",
  scaleX: "--ms-scale-x",
  scaleY: "--ms-scale-y",
  scaleZ: "--ms-scale-z",
  rotate: "--ms-rotation",
  rotateZ: "--ms-rotation",
  rotateX: "--ms-rotation-x",
  rotateY: "--ms-rotation-y",
  skewX: "--ms-skew-x",
  skewY: "--ms-skew-y",
  opacity: "--ms-opacity",
};

const VARIABLE_LABELS = {
  "--ms-x": "Distance X",
  "--ms-y": "Distance Y",
  "--ms-z": "Distance Z",
  "--ms-distance": "Distance",
  "--ms-scale": "Scale",
  "--ms-scale-x": "Scale X",
  "--ms-scale-y": "Scale Y",
  "--ms-rotation": "Rotation",
  "--ms-rotation-x": "Rotation X",
  "--ms-rotation-y": "Rotation Y",
  "--ms-skew-x": "Skew X",
  "--ms-skew-y": "Skew Y",
  "--ms-opacity": "Opacity",
  "--ms-duration": "Duration",
  "--ms-delay": "Delay",
  "--ms-ease": "Easing",
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  const value = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;

  return Number(value.toFixed(4));
}

/*
 * Builds the shared definition for a family: one set of keyframes where the
 * varying magnitudes have become custom properties, plus the defaults that
 * make it work with no configuration at all.
 */
export function buildTemplate(members) {
  const canonical = members[0];
  const analyses = members.map((member) => analyzeSteps(member.steps));
  const base = analyses[0];

  /* Slots that move together across the family share one variable. */
  const groups = new Map();

  base.slots.forEach((slot, key) => {
    const vector = analyses
      .map((analysis) => (analysis.slots.get(key) || slot).magnitude)
      .map((value) => Number(Number(value).toFixed(4)));

    const signature = slot.kind + "|" + vector.join(",");
    if (!groups.has(signature)) groups.set(signature, { kind: slot.kind, unit: slot.unit, keys: [], vector });
    groups.get(signature).keys.push(key);
  });

  /* A single translate axis reads better as "distance" than as x or y. */
  const translateKinds = new Set(
    [...groups.values()]
      .map((group) => group.kind)
      .filter((kind) => /^translate/i.test(kind)),
  );
  const singleAxis = translateKinds.size === 1;

  const used = new Map();
  const variables = [];
  const bySlot = new Map();

  groups.forEach((group) => {
    let name = VARIABLE_NAMES[group.kind] || "--ms-value";
    if (singleAxis && /^translate/i.test(group.kind)) name = "--ms-distance";

    const seen = used.get(name) || 0;
    used.set(name, seen + 1);
    if (seen) name = name + "-" + (seen + 1);

    const value = median(group.vector);
    const variable = {
      name,
      value,
      unit: group.unit,
      kind: group.kind,
      label: VARIABLE_LABELS[name] || titleFromName(name.replace("--ms-", "")),
      default: value + (group.unit || ""),
    };

    variables.push(variable);
    group.keys.forEach((key) => bySlot.set(key, variable));
  });

  /* Rewrite the canonical keyframes to read from those variables. */
  const steps = canonical.steps.map((step, stepIndex) => {
    const declarations = {};

    Object.entries(step.declarations).forEach(([rawProperty, value]) => {
      const property = unprefixProperty(rawProperty);
      const components = componentsFor(property, value);

      if (components) {
        const rendered = components.map((component, componentIndex) => {
          const args = component.args.map((argument, argumentIndex) => {
            const key = stepIndex + ":" + property + ":" + componentIndex + ":" + argumentIndex;
            const variable = bySlot.get(key);
            if (!variable) return argument;

            const slot = base.slots.get(key);
            const reference = "var(" + variable.name + ", " + variable.default + ")";

            /* The variable carries a magnitude; the direction stays in the
               keyframe so overriding it cannot flip the motion by accident. */
            return slot && slot.sign < 0 ? "calc(" + reference + " * -1)" : reference;
          });

          return property === "transform"
            ? component.name + "(" + args.join(", ") + ")"
            : args.join(" ");
        });

        declarations[property] = rendered.join(" ");
        return;
      }

      if (property === "opacity") {
        const key = stepIndex + ":opacity:0:0";
        const variable = bySlot.get(key);
        declarations.opacity = variable
          ? "var(" + variable.name + ", " + variable.default + ")"
          : value;
        return;
      }

      declarations[property] = value;
    });

    return { offset: step.offset, declarations };
  });

  return { steps, variables };
}

/* ==================================================
CANONICAL LIBRARY
================================================== */

function commonest(votes) {
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pascal(value) {
  return slug(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function declarationsToText(declarations) {
  return Object.entries(declarations)
    .map(([property, value]) => property + ": " + value + ";")
    .join("\n");
}

/*
 * Groups the exact-duplicate entries into families and returns one canonical
 * Motion Shelf animation per family.
 */
export function buildCanonicalLibrary(entries, options = {}) {
  const minimumOccurrences = options.minimumOccurrences || 1;
  const families = new Map();

  entries.forEach((entry) => {
    const record = entry.record;
    const fingerprint = familyFingerprint(record.steps, {
      iterationCount: record.timing.iterationCount,
      direction: record.timing.direction,
    });

    if (!families.has(fingerprint)) {
      families.set(fingerprint, { fingerprint, members: [], occurrences: 0, sources: [], nameVotes: new Map(), interactionVotes: new Map(), targetVotes: new Map(), timingVotes: new Map() });
    }

    const family = families.get(fingerprint);
    family.members.push(entry);
    family.occurrences += entry.occurrences;

    entry.sources.forEach((source) => {
      if (family.sources.length < 6 && !family.sources.some((known) => known.file === source.file)) {
        family.sources.push(source);
      }
    });

    entry.nameVotes.forEach((count, name) => {
      family.nameVotes.set(name, (family.nameVotes.get(name) || 0) + count);
    });
    entry.interactionVotes.forEach((count, interaction) => {
      family.interactionVotes.set(interaction, (family.interactionVotes.get(interaction) || 0) + count);
    });

    const target = record.target || "div";
    family.targetVotes.set(target, (family.targetVotes.get(target) || 0) + entry.occurrences);

    const timingKey = record.timing.duration + "|" + record.timing.easing + "|" + record.timing.delay;
    family.timingVotes.set(timingKey, (family.timingVotes.get(timingKey) || 0) + entry.occurrences);
  });

  const usedClasses = new Set();
  const usedKeyframes = new Set();

  return [...families.values()]
    .filter((family) => family.occurrences >= minimumOccurrences)
    .sort((a, b) => b.occurrences - a.occurrences)
    .map((family) => {
      /* The most used member sets the canonical structure. */
      const ordered = [...family.members].sort((a, b) => b.occurrences - a.occurrences);
      const canonical = ordered[0].record;

      const template = buildTemplate(ordered.map((entry) => entry.record));

      const timingVote = commonest(family.timingVotes);
      const [duration, easing, delay] = timingVote
        ? timingVote[0].split("|")
        : [canonical.timing.duration, canonical.timing.easing, canonical.timing.delay];

      const nameVote = commonest(family.nameVotes);
      const behaviourName = describeFamily(canonical.steps, canonical.timing);

      /*
       * A historical name only wins when the family has one member and the
       * name is genuinely descriptive. "elasticSquashPop" earns its place;
       * "inLeft" says less than the behaviour name does.
       */
      const sourceTitle = nameVote ? titleFromName(nameVote[0]) : "";
      const useSourceName = nameVote
        && !isMeaninglessName(nameVote[0])
        && family.members.length === 1
        && sourceTitle.length >= 10
        && sourceTitle.split(/\s+/).filter(Boolean).length >= 2;

      let title = useSourceName ? sourceTitle : behaviourName;

      const base = slug(title) || "animation";
      let className = "ms-" + base;
      let keyframeName = "ms" + (pascal(title) || "Animation");
      let suffix = 2;

      while (usedClasses.has(className) || usedKeyframes.has(keyframeName)) {
        className = "ms-" + base + "-" + suffix;
        keyframeName = "ms" + (pascal(title) || "Animation") + suffix;
        title = title.replace(/\s\d+$/, "") + " " + suffix;
        suffix += 1;
      }

      usedClasses.add(className);
      usedKeyframes.add(keyframeName);

      const interactionVote = commonest(family.interactionVotes);
      const targetVote = commonest(family.targetVotes);

      const parentStyles = detectContainerNeeds(canonical.steps, canonical.support.parent);

      const elementStyles = { ...canonical.support.element };
      delete elementStyles.transform;
      delete elementStyles.opacity;

      /* Defaults live on the class, so the animation works untouched and any
         project can override a single value without copying it. */
      const variableDeclarations = {};
      template.variables.forEach((variable) => {
        variableDeclarations[variable.name] = variable.default;
      });

      /* A raw cubic-bezier() is not one of the editor's easing values, so it
         becomes a custom curve the existing easing engine understands. */
      const resolvedEasing = resolveEasingForShelf(easing);

      const timingVariables = {
        "--ms-duration": duration + "s",
        "--ms-delay": delay + "s",
        "--ms-ease": resolveEasing(resolvedEasing.easing, resolvedEasing.cubicBezier),
      };

      const engine = canonical.kind.startsWith("gsap") ? "gsap" : "css";

      const variants = ordered.length > 1
        ? ordered.slice(0, 8).map((entry) => ({
          occurrences: entry.occurrences,
          name: [...entry.nameVotes.keys()][0] || "",
        }))
        : [];

      return {
        name: title,
        target: targetVote ? targetVote[0] : "div",
        description: behaviourName + " technique, found in " + family.occurrences
          + " place" + (family.occurrences === 1 ? "" : "s")
          + (family.members.length > 1 ? " across " + family.members.length + " value variants." : "."),
        device: "both",
        interaction: interactionVote ? interactionVote[0] : canonical.interaction,
        categories: inferCategories(canonical.steps, canonical.timing),
        animationName: keyframeName,
        className,
        duration: Number(duration),
        durationUnit: "s",
        delay: Number(delay),
        delayUnit: "s",
        easing: resolvedEasing.easing,
        cubicBezier: resolvedEasing.cubicBezier,
        iterationCount: canonical.timing.iterationCount,
        css: declarationsToText({ ...variableDeclarations, ...timingVariables, ...elementStyles }),
        keyframes: stepsToKeyframeCss(template.steps),
        parent: declarationsToText(parentStyles),
        imageUrl: "",
        template: {
          engine,
          variables: template.variables.map((variable) => ({
            name: variable.name,
            label: variable.label,
            value: variable.default,
            kind: variable.kind,
          })),
          timingVariables: true,
          gsapConfig: engine === "gsap" ? canonical.gsapConfig || null : null,
        },
        origin: {
          kind: canonical.kind,
          occurrences: family.occurrences,
          variants: family.members.length,
          exactFingerprint: fingerprintSteps(canonical.steps, {
            iterationCount: canonical.timing.iterationCount,
            direction: canonical.timing.direction,
          }),
          familyFingerprint: family.fingerprint,
          originalName: nameVote ? nameVote[0] : "",
          originalSelector: canonical.selector || "",
          variantNames: variants,
          sources: family.sources,
        },
      };
    });
}
