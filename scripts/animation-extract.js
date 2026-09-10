/*
 * Reusable animation extraction.
 *
 * Pure functions only: no DOM, no filesystem, no browser globals. The
 * scanner (scripts/campaign-scan.js) and any headless verification harness
 * both import this file, so it must stay environment independent.
 *
 * Everything is reduced to keyframe geometry -- CSS @keyframes and GSAP
 * tweens alike -- so the same motion written two different ways collapses
 * onto a single library entry.
 */

import { detectThreeD } from "./parameters.js";

/* ==================================================
CSS VALUE + DECLARATION PARSING
================================================== */

export function stripCssComments(css) {
  return String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function matchBrace(text, openIndex) {
  let depth = 0;

  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/* Splits on a character only when it is not inside quotes or parentheses,
   so cubic-bezier(0.39, 0.575, 0.565, 1) survives intact. */
function splitTopLevel(source, separator) {
  const parts = [];
  let current = "";
  let quote = "";
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];

    if ((character === '"' || character === "'") && previous !== "\\") {
      quote = quote === character ? "" : quote || character;
    }

    if (!quote && character === "(") depth += 1;
    if (!quote && character === ")") depth = Math.max(0, depth - 1);

    if (!quote && !depth && character === separator) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim()) parts.push(current);
  return parts;
}

export function parseDeclarations(body) {
  const declarations = {};

  splitTopLevel(stripCssComments(body), ";").forEach((entry) => {
    const declaration = entry.trim();
    if (!declaration) return;

    const parts = splitTopLevel(declaration, ":");
    if (parts.length < 2) return;

    const property = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join(":").trim();
    if (!property || !value) return;

    declarations[property] = value;
  });

  return declarations;
}

/* Vendor prefixes are noise for comparison purposes: -webkit-transform and
   transform describe the same motion. */
export function unprefixProperty(property) {
  return String(property).replace(/^-(?:webkit|moz|ms|o)-/, "");
}

export function normalizeCssValue(value) {
  let result = String(value == null ? "" : value).trim().toLowerCase();

  result = result.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",");
  result = result.replace(/-(?:webkit|moz|ms|o)-/g, "");

  /* Round numbers so 0.500 and .5 compare equal, and drop units from zero. */
  result = result.replace(/(-?\d*\.?\d+)([a-z%]*)/g, (match, number, unit) => {
    const parsed = Number(number);
    if (!Number.isFinite(parsed)) return match;

    const rounded = Number(parsed.toFixed(4));
    if (rounded === 0) return unit === "s" || unit === "ms" ? `0${unit}` : "0";
    return `${rounded}${unit}`;
  });

  return result;
}

/* ==================================================
KEYFRAMES
================================================== */

function normalizeOffset(token) {
  const value = String(token).trim().toLowerCase();
  if (value === "from") return 0;
  if (value === "to") return 100;

  const match = value.match(/^(-?\d*\.?\d+)%?$/);
  if (!match) return null;

  const number = Number(match[1]);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function parseKeyframeBody(body) {
  const steps = [];
  let index = 0;

  while (index < body.length) {
    const open = body.indexOf("{", index);
    if (open === -1) break;

    const close = matchBrace(body, open);
    if (close === -1) break;

    const offsets = body
      .slice(index, open)
      .split(",")
      .map((token) => normalizeOffset(token))
      .filter((offset) => offset !== null);

    const declarations = parseDeclarations(body.slice(open + 1, close));

    if (offsets.length && Object.keys(declarations).length) {
      offsets.forEach((offset) => steps.push({ offset, declarations }));
    }

    index = close + 1;
  }

  return mergeSteps(steps);
}

/* Merges duplicate offsets and folds prefixed properties onto their
   unprefixed form, keeping the unprefixed value when both are present. */
function mergeSteps(steps) {
  const byOffset = new Map();

  steps.forEach(({ offset, declarations }) => {
    const merged = byOffset.get(offset) || {};

    Object.entries(declarations).forEach(([property, value]) => {
      const plain = unprefixProperty(property);
      const alreadyUnprefixed = property === plain;
      if (!alreadyUnprefixed && merged[plain] !== undefined) return;
      merged[plain] = value;
    });

    byOffset.set(offset, merged);
  });

  return [...byOffset.entries()]
    .map(([offset, declarations]) => ({ offset, declarations }))
    .sort((a, b) => a.offset - b.offset);
}

export function parseKeyframes(css) {
  const source = stripCssComments(css);
  const pattern = /@(?:-(?:webkit|moz|ms|o)-)?keyframes\s+("[^"]+"|'[^']+'|[^\s{]+)\s*\{/gi;
  const found = new Map();

  let match;
  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf("{", match.index + match[0].length - 1);
    const close = matchBrace(source, open);
    if (close === -1) continue;

    const name = match[1].replace(/^['"]|['"]$/g, "");
    const steps = parseKeyframeBody(source.slice(open + 1, close));
    if (!steps.length) continue;

    /* Prefixed and unprefixed copies of one animation are the same thing;
       keep whichever version carries more detail. */
    const existing = found.get(name);
    if (!existing || steps.length > existing.length) found.set(name, steps);

    pattern.lastIndex = close;
  }

  return found;
}

/* ==================================================
STYLE RULES
================================================== */

export function parseStyleRules(css) {
  const source = stripCssComments(css);
  const rules = [];

  const walk = (text) => {
    let index = 0;

    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open === -1) break;

      const close = matchBrace(text, open);
      if (close === -1) break;

      const prelude = text.slice(index, open).trim().replace(/^[;{}]+/, "").trim();
      const body = text.slice(open + 1, close);

      if (/^@(?:media|supports|layer|container|scope)/i.test(prelude)) {
        walk(body);
      } else if (prelude && !prelude.startsWith("@")) {
        rules.push({ selector: prelude, declarations: parseDeclarations(body) });
      }

      index = close + 1;
    }
  };

  walk(source);
  return rules;
}

/* ==================================================
ANIMATION SHORTHAND
================================================== */

const DIRECTIONS = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
const FILL_MODES = new Set(["none", "forwards", "backwards", "both"]);
const PLAY_STATES = new Set(["running", "paused"]);
const NAMED_EASINGS = new Set([
  "linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end",
]);

function isTimeToken(token) {
  return /^-?\d*\.?\d+m?s$/i.test(token);
}

function toSeconds(token) {
  const match = String(token).match(/^(-?\d*\.?\d+)(m?s)$/i);
  if (!match) return null;

  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;

  return match[2].toLowerCase() === "ms" ? number / 1000 : number;
}

export function parseAnimationShorthand(value) {
  const result = {
    name: "", duration: null, delay: null, easing: "",
    iterationCount: "", direction: "", fillMode: "",
  };

  /* Only the first animation in a comma separated list is considered: the
     rest belong to other keyframes and are handled by their own rules. */
  const single = splitTopLevel(String(value || ""), ",")[0] || "";

  const tokens = single
    .trim()
    .split(/\s+(?![^(]*\))/)
    .map((token) => token.trim())
    .filter(Boolean);

  let seenTime = 0;

  tokens.forEach((token) => {
    const lower = token.toLowerCase();

    if (isTimeToken(token)) {
      if (seenTime === 0) result.duration = toSeconds(token);
      else if (seenTime === 1) result.delay = toSeconds(token);
      seenTime += 1;
      return;
    }

    if (NAMED_EASINGS.has(lower) || /^(?:cubic-bezier|steps|linear)\(/i.test(lower)) {
      result.easing = token;
      return;
    }

    if (lower === "infinite" || /^\d+(?:\.\d+)?$/.test(lower)) {
      result.iterationCount = lower;
      return;
    }

    if (DIRECTIONS.has(lower)) {
      result.direction = lower;
      return;
    }

    if (FILL_MODES.has(lower)) {
      result.fillMode = lower;
      return;
    }

    if (PLAY_STATES.has(lower) || lower === "none") return;

    if (!result.name) result.name = token;
  });

  return result;
}

export function readAnimationConfig(declarations) {
  const config = {
    name: "", duration: null, delay: null, easing: "",
    iterationCount: "", direction: "", fillMode: "",
  };

  const plain = {};
  Object.entries(declarations).forEach(([property, value]) => {
    plain[unprefixProperty(property)] = value;
  });

  if (plain.animation) Object.assign(config, parseAnimationShorthand(plain.animation));

  if (plain["animation-name"]) {
    config.name = splitTopLevel(plain["animation-name"], ",")[0].trim();
  }
  if (plain["animation-duration"]) {
    config.duration = toSeconds(splitTopLevel(plain["animation-duration"], ",")[0].trim());
  }
  if (plain["animation-delay"]) {
    config.delay = toSeconds(splitTopLevel(plain["animation-delay"], ",")[0].trim());
  }
  if (plain["animation-timing-function"]) {
    config.easing = splitTopLevel(plain["animation-timing-function"], ",")[0].trim();
  }
  if (plain["animation-iteration-count"]) {
    config.iterationCount = splitTopLevel(plain["animation-iteration-count"], ",")[0].trim();
  }
  if (plain["animation-direction"]) {
    config.direction = splitTopLevel(plain["animation-direction"], ",")[0].trim();
  }
  if (plain["animation-fill-mode"]) {
    config.fillMode = splitTopLevel(plain["animation-fill-mode"], ",")[0].trim();
  }

  if (config.name === "none") config.name = "";
  return config;
}

/* ==================================================
SUPPORTING STYLES
================================================== */

/* Properties worth carrying over because the motion depends on them. Layout,
   branding and placement are deliberately excluded.

   The image properties are here because an animated <img> that is not sitting
   in its box the way the campaign put it does not look like the same
   animation: a pan across a photo is `object-position` moving, and dropping it
   leaves the pan centred and wrong. Sizes are still excluded -- a banner's
   width is the creative, not the motion. */
const ELEMENT_SUPPORT = new Set([
  "transform-origin", "transform-style", "backface-visibility", "perspective",
  "perspective-origin", "will-change", "clip-path", "mask", "mask-image",
  "filter", "mix-blend-mode", "opacity", "transform", "transform-box",
  "object-fit", "object-position", "background-position", "background-size",
  "border-radius",
]);

const PARENT_SUPPORT = new Set([
  "perspective", "perspective-origin", "transform-style", "overflow",
  "overflow-x", "overflow-y", "clip-path", "mask", "mask-image",
]);

export function collectSupportingStyles(declarations) {
  const element = {};
  const parent = {};

  Object.entries(declarations).forEach(([rawProperty, value]) => {
    const property = unprefixProperty(rawProperty);
    if (property.startsWith("animation")) return;

    if (ELEMENT_SUPPORT.has(property)) element[property] = value;
    if (PARENT_SUPPORT.has(property)) parent[property] = value;
  });

  /* A bare transform/opacity on the element is only interesting when the
     keyframes do not already set it; the caller decides that. */
  return { element, parent };
}

/* ==================================================
ANIMATION-WORTHINESS
================================================== */

const MOTION_PROPERTIES = new Set([
  "transform", "opacity", "filter", "clip-path", "mask", "mask-image",
  "translate", "rotate", "scale", "offset-distance", "offset-path",
  "background-position", "stroke-dashoffset", "stroke-dasharray",
  "width", "height", "box-shadow", "color", "background-color",
  "border-radius", "letter-spacing", "visibility", "backdrop-filter",
]);

/* The properties that make an entry worth keeping on its own. A keyframe set
   that only tweens colour is real but weak; one that moves, fades or masks is
   the reusable kind Motion Shelf is for. */
const STRONG_PROPERTIES = new Set([
  "transform", "opacity", "filter", "clip-path", "mask", "mask-image",
  "translate", "rotate", "scale", "offset-distance", "stroke-dashoffset",
  "backdrop-filter",
]);

function stepsChangeAnything(steps) {
  const values = new Map();

  steps.forEach(({ declarations }) => {
    Object.entries(declarations).forEach(([property, value]) => {
      const key = unprefixProperty(property);
      const normalized = normalizeCssValue(value);
      const seen = values.get(key);
      if (seen === undefined) values.set(key, normalized);
      else if (seen !== normalized) values.set(key, "__varies__");
    });
  });

  return [...values.values()].some((value) => value === "__varies__");
}

/* Smallest change worth calling an animation, per transform function. */
const PERCEPTIBLE_DELTA = {
  translateX: 1, translateY: 1, translateZ: 1,
  scale: 0.02, scaleX: 0.02, scaleY: 0.02,
  rotate: 1, rotateX: 1, rotateY: 1, rotateZ: 1,
  skewX: 1, skewY: 1,
};

function transformValues(value) {
  const parts = {};
  const pattern = /([a-z0-9]+)\s*\(([^)]*)\)/gi;
  let match;

  while ((match = pattern.exec(String(value || ""))) !== null) {
    const number = String(match[2]).match(/-?\d*\.?\d+/);
    if (number) parts[match[1]] = Number(number[0]);
  }

  return parts;
}

/*
 * Authoring tools emit placeholder keyframes -- Google Web Designer's
 * opacity 0.001 to 0 over 0.0001s being the common one. They are technically
 * animations and visually nothing, so they are rejected here.
 */
export function hasPerceptibleChange(steps) {
  const byProperty = new Map();

  steps.forEach(({ declarations }) => {
    Object.entries(declarations).forEach(([rawProperty, value]) => {
      const property = unprefixProperty(rawProperty);
      if (!byProperty.has(property)) byProperty.set(property, []);
      byProperty.get(property).push(value);
    });
  });

  for (const [property, values] of byProperty.entries()) {
    if (property === "opacity") {
      const numbers = values.map(Number).filter(Number.isFinite);
      if (numbers.length && Math.max(...numbers) - Math.min(...numbers) >= 0.05) return true;
      continue;
    }

    if (property === "transform") {
      const functions = new Map();

      values.forEach((value) => {
        Object.entries(transformValues(value)).forEach(([name, number]) => {
          if (!functions.has(name)) functions.set(name, []);
          functions.get(name).push(number);
        });
      });

      for (const [name, numbers] of functions.entries()) {
        const threshold = PERCEPTIBLE_DELTA[name] === undefined ? 0.01 : PERCEPTIBLE_DELTA[name];
        const identity = /^scale/.test(name) ? 1 : 0;
        const all = numbers.concat(values.length > numbers.length ? [identity] : []);
        if (Math.max(...all) - Math.min(...all) >= threshold) return true;
      }

      continue;
    }

    const distinct = new Set(values.map((value) => normalizeCssValue(value)));
    if (distinct.size > 1) return true;
  }

  return false;
}

export function isWorthKeeping(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return false;

  const properties = new Set();
  steps.forEach(({ declarations }) => {
    Object.keys(declarations).forEach((property) => properties.add(unprefixProperty(property)));
  });

  const hasMotion = [...properties].some((property) => MOTION_PROPERTIES.has(property));
  const hasStrong = [...properties].some((property) => STRONG_PROPERTIES.has(property));

  return hasMotion && hasStrong && stepsChangeAnything(steps) && hasPerceptibleChange(steps);
}

/* ==================================================
FINGERPRINT
================================================== */

/* Identity is the shape of the motion, not its name, its selector or how
   long it runs. Whether it loops, and whether it alternates, do change the
   behaviour, so they stay in. */
export function fingerprintSteps(steps, options = {}) {
  const geometry = steps
    .map(({ offset, declarations }) => {
      const entries = Object.entries(declarations)
        .map(([property, value]) => [unprefixProperty(property), normalizeCssValue(value)])
        .filter(([property]) => MOTION_PROPERTIES.has(property) || property.startsWith("--"))
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([property, value]) => `${property}:${value}`)
        .join(";");

      return `${Number(offset.toFixed(2))}{${entries}}`;
    })
    .join("|");

  const loops = options.iterationCount === "infinite" ? "loop" : "once";
  const direction = options.direction && options.direction !== "normal"
    ? options.direction
    : "normal";

  return hashString(`${geometry}#${loops}#${direction}`);
}

/*
 * Ad archives file creatives by format, and those folder names say which
 * screen the animation was built for: .../dynamic-head-desktop/, .../midscroll-mobile/.
 * Roughly two fifths of the archive names a device this way.
 */
export function deviceFromPath(file) {
  const lower = String(file || "").toLowerCase();

  const desktop = /(?:^|[^a-z])desktop(?:[^a-z]|$)|[_-]dtp(?:[^a-z]|$)/.test(lower);
  const mobile = /(?:^|[^a-z])mobile(?:[^a-z]|$)|[_-]mob(?:[^a-z]|$)/.test(lower);

  if (desktop && mobile) return "both";
  if (desktop) return "desktop";
  if (mobile) return "mobile";

  return "";
}

/* Small, dependency free, stable across browser and Node: FNV-1a. */
export function hashString(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/* ==================================================
TOLERANT OBJECT LITERAL PARSING

Campaign code is full of values a static reader cannot resolve --
getCurve(300, 500), adWidth, window.foo. Those are recorded as unresolved
and skipped rather than guessed at.
================================================== */

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = "";

  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    const previous = text[index - 1];

    if (quote) {
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    if (character === openChar) depth += 1;
    else if (character === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function splitArguments(text) {
  const parts = [];
  let current = "";
  let quote = "";
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const previous = text[index - 1];

    if (quote) {
      current += character;
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      current += character;
      continue;
    }

    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth -= 1;

    if (!depth && character === ",") {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

function parseLiteral(raw) {
  const text = String(raw).trim();
  if (!text) return { resolved: false };

  if (/^-?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(text)) {
    return { resolved: true, value: Number(text) };
  }

  const quoted = text.match(/^(['"`])([\s\S]*)\1$/);
  if (quoted) return { resolved: true, value: quoted[2] };

  if (text === "true") return { resolved: true, value: true };
  if (text === "false") return { resolved: true, value: false };
  if (text === "null") return { resolved: true, value: null };

  return { resolved: false };
}

export function parseObjectLiteral(body) {
  const properties = {};
  const unresolved = [];

  splitArguments(body).forEach((entry) => {
    const separator = (() => {
      let quote = "";
      let depth = 0;

      for (let index = 0; index < entry.length; index += 1) {
        const character = entry[index];
        const previous = entry[index - 1];

        if (quote) {
          if (character === quote && previous !== "\\") quote = "";
          continue;
        }

        if (character === '"' || character === "'" || character === "`") {
          quote = character;
          continue;
        }

        if ("([{".includes(character)) depth += 1;
        if (")]}".includes(character)) depth -= 1;
        if (!depth && character === ":") return index;
      }

      return -1;
    })();

    if (separator === -1) return;

    const key = entry.slice(0, separator).trim().replace(/^(['"`])([\s\S]*)\1$/, "$2");
    const literal = parseLiteral(entry.slice(separator + 1));

    if (!/^[A-Za-z_$][\w$-]*$/.test(key)) return;

    if (literal.resolved) properties[key] = literal.value;
    else unresolved.push(key);
  });

  return { properties, unresolved };
}

/* ==================================================
GSAP
================================================== */

const GSAP_IDENTITY = {
  x: 0, y: 0, z: 0, xPercent: 0, yPercent: 0,
  scale: 1, scaleX: 1, scaleY: 1,
  rotation: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
  skewX: 0, skewY: 0,
  opacity: 1, autoAlpha: 1,
};

const TRANSFORM_ORDER = [
  "x", "y", "z", "xPercent", "yPercent",
  "rotation", "rotationZ", "rotationX", "rotationY",
  "scale", "scaleX", "scaleY",
  "skewX", "skewY",
];

const TRANSFORM_UNITS = {
  x: "px", y: "px", z: "px", xPercent: "%", yPercent: "%",
  rotation: "deg", rotationZ: "deg", rotationX: "deg", rotationY: "deg",
  skewX: "deg", skewY: "deg",
  scale: "", scaleX: "", scaleY: "",
};

const TRANSFORM_FUNCTIONS = {
  x: "translateX", y: "translateY", z: "translateZ",
  xPercent: "translateX", yPercent: "translateY",
  rotation: "rotate", rotationZ: "rotate", rotationX: "rotateX", rotationY: "rotateY",
  scale: "scale", scaleX: "scaleX", scaleY: "scaleY",
  skewX: "skewX", skewY: "skewY",
};

const DIRECT_PROPERTIES = {
  opacity: "opacity",
  autoAlpha: "opacity",
  filter: "filter",
  clipPath: "clip-path",
  webkitClipPath: "clip-path",
  backdropFilter: "backdrop-filter",
  borderRadius: "border-radius",
  letterSpacing: "letter-spacing",
  strokeDashoffset: "stroke-dashoffset",
  strokeDasharray: "stroke-dasharray",
  boxShadow: "box-shadow",
};

const SUPPORT_PROPERTIES = {
  transformOrigin: "transform-origin",
  transformPerspective: "perspective",
  perspective: "perspective",
};

/* Timing and lifecycle keys, plus the campaign specific styling that must
   never make it into the library. */
const GSAP_CONTROL_KEYS = new Set([
  "duration", "delay", "ease", "repeat", "repeatDelay", "yoyo", "yoyoEase",
  "stagger", "paused", "immediateRender", "overwrite", "id", "data",
  "onComplete", "onStart", "onUpdate", "onRepeat", "onReverseComplete",
  "onCompleteParams", "onStartParams", "callbackScope", "force3D",
  "lazy", "startAt", "runBackwards", "keyframes", "motionPath", "scrollTrigger",
]);

const GSAP_NOISE_KEYS = new Set([
  "width", "height", "backgroundColor", "background", "backgroundImage",
  "backgroundPosition", "color", "cursor", "zIndex", "top", "left", "right",
  "bottom", "position", "display", "fontSize", "fontWeight", "lineHeight",
  "text", "innerHTML", "textContent", "margin", "padding", "border",
  "visibility", "pointerEvents", "attr", "src", "className",
]);

const LEGACY_EASE_FAMILIES = {
  quad: "power1", cubic: "power2", quart: "power3", quint: "power4",
  strong: "power4", power0: "linear", linear: "linear", none: "linear",
  sine: "sine", expo: "expo", circ: "circ", back: "back",
  bounce: "bounce", elastic: "elastic",
  power1: "power1", power2: "power2", power3: "power3", power4: "power4",
};

/* Maps a GSAP ease onto a value scripts/easing.js already understands, so
   imported animations reuse the existing easing engine rather than adding a
   second one. */
export function mapGsapEase(ease) {
  const raw = String(ease || "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower === "none" || lower === "linear" || lower === "power0.none") return "linear";

  /* Modern form: family.direction, optionally with a configuration. */
  const modern = lower.match(/^([a-z0-9]+)\.(in|out|inout)(?:\(([^)]*)\))?$/);
  if (modern) {
    const family = LEGACY_EASE_FAMILIES[modern[1]];
    if (!family) return "";
    if (family === "linear") return "linear";

    const direction = modern[2] === "inout" ? "inOut" : modern[2];
    return `${family}.${direction}`;
  }

  /* Legacy form: Power2.easeOut / Quad.easeInOut / Bounce.easeOut. */
  const legacy = lower.match(/^([a-z0-9]+)\.ease(in|out|inout)$/);
  if (legacy) {
    const family = LEGACY_EASE_FAMILIES[legacy[1]];
    if (!family) return "";
    if (family === "linear") return "linear";

    const direction = legacy[2] === "inout" ? "inOut" : legacy[2];
    return `${family}.${direction}`;
  }

  if (/^cubic-bezier\(/.test(lower)) return raw;
  if (NAMED_EASINGS.has(lower)) return lower;

  const bare = LEGACY_EASE_FAMILIES[lower];
  if (bare === "linear") return "linear";
  if (bare) return `${bare}.out`;

  return "";
}

function formatTransformValue(key, value) {
  if (typeof value === "number") {
    const rounded = Number(value.toFixed(4));
    return `${rounded}${TRANSFORM_UNITS[key] || ""}`;
  }

  return String(value).trim();
}

/* Turns a resolved GSAP state into a CSS declaration block. */
export function gsapStateToDeclarations(state) {
  const declarations = {};
  const transforms = [];

  TRANSFORM_ORDER.forEach((key) => {
    if (state[key] === undefined) return;
    if (GSAP_IDENTITY[key] !== undefined && state[key] === GSAP_IDENTITY[key]) {
      /* Identity parts still need to be written when other parts move, so
         they are added below only if any transform is present. */
    }
    transforms.push(`${TRANSFORM_FUNCTIONS[key]}(${formatTransformValue(key, state[key])})`);
  });

  if (transforms.length) declarations.transform = transforms.join(" ");

  Object.entries(DIRECT_PROPERTIES).forEach(([key, property]) => {
    if (state[key] === undefined) return;
    const value = state[key];
    declarations[property] = typeof value === "number" ? String(Number(value.toFixed(4))) : String(value);
  });

  return declarations;
}

function splitGsapVars(vars) {
  const animated = {};
  const support = {};
  const control = {};
  let noise = 0;

  Object.entries(vars).forEach(([key, value]) => {
    if (GSAP_CONTROL_KEYS.has(key)) {
      control[key] = value;
      return;
    }

    if (SUPPORT_PROPERTIES[key]) {
      support[SUPPORT_PROPERTIES[key]] = typeof value === "number" ? `${value}px` : String(value);
      return;
    }

    if (GSAP_NOISE_KEYS.has(key)) {
      noise += 1;
      return;
    }

    if (TRANSFORM_FUNCTIONS[key] || DIRECT_PROPERTIES[key]) {
      animated[key] = value;
      return;
    }

    noise += 1;
  });

  return { animated, support, control, noise };
}

/* Finds gsap and timeline tween calls, in source order. */
export function parseGsapCalls(source) {
  const text = String(source || "");
  const calls = [];
  const pattern = /(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\.\s*(to|from|fromTo|set|timeline|staggerTo|staggerFrom)\s*\(/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const owner = match[1];
    const method = match[2];
    const open = text.indexOf("(", match.index + match[0].length - 1);
    const close = findMatching(text, open, "(", ")");
    if (close === -1) continue;

    const args = splitArguments(text.slice(open + 1, close));
    calls.push({ owner, method, args, index: match.index });
    pattern.lastIndex = close;
  }

  return calls;
}

function readVarsArgument(argument) {
  const text = String(argument || "").trim();
  if (!text.startsWith("{")) return null;

  const close = findMatching(text, 0, "{", "}");
  if (close === -1) return null;

  return parseObjectLiteral(text.slice(1, close));
}

function readTargetArgument(argument) {
  const literal = parseLiteral(argument);
  if (literal.resolved && typeof literal.value === "string") return literal.value;

  const text = String(argument || "").trim();
  return /^[A-Za-z_$][\w$.\[\]'"]*$/.test(text) ? text : "";
}

/* ==================================================
GSAP -> KEYFRAMES
================================================== */

function stateSnapshot(base, patch) {
  const next = { ...base };
  Object.entries(patch).forEach(([key, value]) => { next[key] = value; });
  return next;
}

function identityFor(keys) {
  const state = {};
  keys.forEach((key) => {
    if (GSAP_IDENTITY[key] !== undefined) state[key] = GSAP_IDENTITY[key];
  });
  return state;
}

/*
 * Builds one reusable animation out of a run of tweens that all target the
 * same element. gsap.set() before the run supplies the starting state, which
 * is what makes a bare .to({x: 0}) meaningful.
 */
export function buildGsapAnimation(run, initialState = {}) {
  const segments = [];
  let current = { ...initialState };
  let totalDuration = 0;
  let repeat = 0;
  let yoyo = false;
  let easing = "";
  let delay = null;
  let unresolvedCount = 0;

  run.forEach((step) => {
    const { animated, control, noise } = step;
    unresolvedCount += step.unresolved || 0;

    const duration = Number.isFinite(control.duration) ? Math.max(0, control.duration) : 0.5;
    const stepDelay = Number.isFinite(control.delay) ? Math.max(0, control.delay) : 0;

    if (control.repeat !== undefined && Number.isFinite(control.repeat)) {
      repeat = control.repeat;
    }
    if (control.yoyo === true) yoyo = true;
    if (!easing && control.ease) easing = mapGsapEase(control.ease);
    if (delay === null && stepDelay) delay = stepDelay;

    const keys = Object.keys(animated);
    if (!keys.length) return;

    let from;
    let to;

    if (step.method === "from" || step.method === "staggerFrom") {
      from = stateSnapshot(current, animated);
      to = stateSnapshot(current, identityFor(keys));
    } else if (step.method === "fromTo") {
      from = stateSnapshot(current, step.fromVars || {});
      to = stateSnapshot(from, animated);
    } else {
      const missing = keys.filter((key) => current[key] === undefined);
      from = stateSnapshot(current, identityFor(missing));
      to = stateSnapshot(from, animated);
    }

    segments.push({ from, to, duration, gap: segments.length ? stepDelay : 0 });
    totalDuration += duration + (segments.length > 1 ? stepDelay : 0);
    current = to;
    void noise;
  });

  if (!segments.length || totalDuration <= 0) return null;

  /* Lay the segments out across 0-100% weighted by their durations. */
  const steps = [];
  let elapsed = 0;

  segments.forEach((segment, index) => {
    if (index === 0) {
      steps.push({ offset: 0, declarations: gsapStateToDeclarations(segment.from) });
    } else if (segment.gap > 0) {
      steps.push({
        offset: (elapsed / totalDuration) * 100,
        declarations: gsapStateToDeclarations(segment.from),
      });
    }

    elapsed += segment.duration + (index ? segment.gap : 0);
    steps.push({
      offset: Math.min(100, (elapsed / totalDuration) * 100),
      declarations: gsapStateToDeclarations(segment.to),
    });
  });

  const merged = mergeSteps(steps.map(({ offset, declarations }) => ({
    offset: Number(offset.toFixed(2)),
    declarations,
  })));

  if (merged.length && merged[merged.length - 1].offset < 100) {
    merged[merged.length - 1].offset = 100;
  }

  return {
    steps: merged,
    duration: Number(totalDuration.toFixed(3)),
    delay: delay || 0,
    easing: easing || "power2.out",
    iterationCount: repeat === -1 ? "infinite" : String(Math.max(1, repeat + 1)),
    direction: yoyo ? "alternate" : "normal",
    unresolved: unresolvedCount,
  };
}

/*
 * Walks a file's GSAP calls, tracks per-target state from set() calls, and
 * groups consecutive tweens on the same target into one reusable sequence.
 */
export function extractGsapAnimations(source) {
  const calls = parseGsapCalls(source);
  const timelineVars = new Set(["gsap"]);
  const state = new Map();
  const runs = [];
  const skipped = { unresolvedTarget: 0, noAnimatableProps: 0 };

  let currentRun = null;

  const flush = () => {
    if (currentRun && currentRun.steps.length) runs.push(currentRun);
    currentRun = null;
  };

  calls.forEach((call) => {
    if (call.method === "timeline") {
      flush();
      return;
    }

    /* Only treat foo.to() as GSAP when foo looks like a timeline or the
       library itself, so unrelated object.to() calls are ignored. */
    const isGsapOwner = call.owner === "gsap"
      || /^(?:tl|timeline|master|tween|TweenMax|TweenLite|TimelineMax|TimelineLite)/i.test(call.owner)
      || timelineVars.has(call.owner);
    if (!isGsapOwner) return;

    const target = readTargetArgument(call.args[0]);
    if (!target) {
      skipped.unresolvedTarget += 1;
      flush();
      return;
    }

    /* TweenMax.to(el, 0.5, {...}) puts the duration in the second slot. */
    let varsIndex = 1;
    let legacyDuration = null;
    const second = parseLiteral(call.args[1] || "");
    if (second.resolved && typeof second.value === "number") {
      legacyDuration = second.value;
      varsIndex = 2;
    }

    let fromVars = null;
    let vars = readVarsArgument(call.args[varsIndex]);

    if (call.method === "fromTo") {
      const first = readVarsArgument(call.args[varsIndex]);
      const next = readVarsArgument(call.args[varsIndex + 1]);
      fromVars = first ? splitGsapVars(first.properties).animated : {};
      vars = next;
    }

    if (!vars) {
      skipped.noAnimatableProps += 1;
      return;
    }

    const parts = splitGsapVars(vars.properties);
    if (legacyDuration !== null) parts.control.duration = legacyDuration;

    if (call.method === "set") {
      state.set(target, stateSnapshot(state.get(target) || {}, parts.animated));
      flush();
      return;
    }

    if (!Object.keys(parts.animated).length) {
      skipped.noAnimatableProps += 1;
      flush();
      return;
    }

    if (currentRun && currentRun.target !== target) flush();

    if (!currentRun) {
      currentRun = { target, steps: [], support: {} };
    }

    Object.assign(currentRun.support, parts.support);
    currentRun.steps.push({
      method: call.method,
      animated: parts.animated,
      control: parts.control,
      fromVars,
      unresolved: vars.unresolved.length,
    });
  });

  flush();

  const animations = [];

  runs.forEach((run) => {
    const built = buildGsapAnimation(run.steps, state.get(run.target) || {});
    if (!built || !isWorthKeeping(built.steps)) {
      skipped.noAnimatableProps += 1;
      return;
    }

    /* GSAP families are configured through their own properties rather than
       being rewritten as CSS variables, so the resolved values are kept. */
    const gsapConfig = { engine: "gsap" };
    run.steps.forEach((step) => {
      Object.assign(gsapConfig, step.animated);
      ["duration", "delay", "ease", "repeat", "repeatDelay", "yoyo", "stagger"].forEach((key) => {
        if (step.control[key] !== undefined) gsapConfig[key] = step.control[key];
      });
    });

    animations.push({
      gsapConfig,
      kind: run.steps.length > 1 ? "gsap-timeline" : "gsap",
      selector: run.target,
      originalName: "",
      steps: built.steps,
      timing: {
        duration: built.duration,
        delay: built.delay,
        easing: built.easing,
        iterationCount: built.iterationCount,
        direction: built.direction,
        fillMode: "both",
      },
      support: { element: run.support, parent: {} },
      interaction: built.iterationCount === "infinite"
        ? "infinite"
        : run.steps.length > 1 ? "timeline" : "appear",
      unresolved: built.unresolved,
    });
  });

  return { animations, skipped };
}

/* ==================================================
CLASS TOGGLES

Resolves "JavaScript adds a class" back to the CSS animation that class
carries, which is how the interaction type is decided.
================================================== */

export function findToggledClasses(source) {
  const text = String(source || "");
  const classes = new Map();

  const record = (name, trigger) => {
    if (!name || !/^[A-Za-z_-][\w-]*$/.test(name)) return;
    const existing = classes.get(name);
    /* A real trigger always beats the "just happens on load" default. */
    if (!existing || existing === "appear") classes.set(name, trigger);
  };

  const triggerFor = (event) => {
    const name = event.toLowerCase();
    if (["mouseenter", "mouseover", "mousemove", "pointerenter", "pointerover"].includes(name)) return "hover";
    if (["click", "pointerdown", "mousedown", "touchstart", "keydown", "submit", "change"].includes(name)) return "interaction";
    return "";
  };

  /*
   * A toggle belongs to a handler only when it sits inside that handler's
   * call, so the region is taken from the real parentheses rather than
   * guessed from how close the two happen to be in the file.
   */
  const regions = [];
  const listener = /(?:addEventListener|\.\s*on)\s*\(\s*['"](\w+)['"]/g;

  let match;
  while ((match = listener.exec(text)) !== null) {
    const trigger = triggerFor(match[1]);
    if (!trigger) continue;

    const open = text.indexOf("(", match.index);
    const close = findMatching(text, open, "(", ")");
    if (close === -1) continue;

    regions.push({ start: open, end: close, trigger });
  }

  const owner = (index) => {
    let best = null;

    for (const region of regions) {
      if (index < region.start || index > region.end) continue;
      /* Nested handlers: the innermost one wins. */
      if (!best || region.start > best.start) best = region;
    }

    return best;
  };

  const adder = /classList\s*\.\s*(?:add|toggle)\s*\(\s*['"]([\w-]+)['"]/g;
  while ((match = adder.exec(text)) !== null) {
    const region = owner(match.index);
    record(match[1], region ? region.trigger : "appear");
  }

  const remover = /classList\s*\.\s*remove\s*\(\s*['"]([\w-]+)['"]/g;
  while ((match = remover.exec(text)) !== null) {
    if (!classes.has(match[1])) record(match[1], "disappear");
  }

  return classes;
}

/* ==================================================
CSS -> ANIMATION RECORDS
================================================== */

function selectorInteraction(selector) {
  const lower = String(selector).toLowerCase();
  if (/:hover/.test(lower)) return "hover";
  if (/:focus|:active/.test(lower)) return "interaction";
  return "";
}

function lastStepHidden(steps) {
  const last = steps[steps.length - 1];
  if (!last) return false;

  const opacity = last.declarations.opacity;
  if (opacity === undefined) return false;

  /* Anything under 5% reads as gone, and authoring tools rarely land on a
     clean zero. */
  const value = Number(opacity);
  return Number.isFinite(value) && value < 0.05;
}

export function classifyInteraction(record, toggledClasses) {
  const fromSelector = selectorInteraction(record.selector);
  if (fromSelector) return fromSelector;

  if (record.timing.iterationCount === "infinite") return "infinite";

  const classes = String(record.selector || "").match(/\.([\w-]+)/g) || [];
  for (const entry of classes) {
    const trigger = toggledClasses && toggledClasses.get(entry.slice(1));
    if (trigger) return trigger;
  }

  if (lastStepHidden(record.steps)) return "disappear";
  return "appear";
}

export function extractCssAnimations(cssText, options = {}) {
  const keyframes = parseKeyframes(cssText);
  const rules = parseStyleRules(cssText);
  const toggledClasses = options.toggledClasses || new Map();

  const animations = [];
  const used = new Set();
  const skipped = { missingKeyframes: 0, notReusable: 0 };

  rules.forEach((rule) => {
    const config = readAnimationConfig(rule.declarations);
    if (!config.name) return;

    const steps = keyframes.get(config.name);
    if (!steps) {
      skipped.missingKeyframes += 1;
      return;
    }

    if (!isWorthKeeping(steps)) {
      skipped.notReusable += 1;
      used.add(config.name);
      return;
    }

    const support = collectSupportingStyles(rule.declarations);
    const record = {
      kind: "css",
      selector: rule.selector,
      originalName: config.name,
      steps,
      timing: {
        duration: config.duration === null ? 1 : config.duration,
        delay: config.delay === null ? 0 : config.delay,
        easing: config.easing || "ease-in-out",
        iterationCount: config.iterationCount || "1",
        direction: config.direction || "normal",
        fillMode: config.fillMode || "both",
      },
      support,
      declarations: rule.declarations,
      unresolved: 0,
    };

    record.interaction = classifyInteraction(record, toggledClasses);
    animations.push(record);
    used.add(config.name);
  });

  /* Keyframes nobody references are still reusable techniques; keep them
     with neutral timing rather than throwing the motion away. */
  keyframes.forEach((steps, name) => {
    if (used.has(name)) return;
    if (!isWorthKeeping(steps)) {
      skipped.notReusable += 1;
      return;
    }

    const record = {
      kind: "css",
      selector: "",
      originalName: name,
      steps,
      timing: {
        duration: 1, delay: 0, easing: "ease-in-out",
        iterationCount: "1", direction: "normal", fillMode: "both",
      },
      support: { element: {}, parent: {} },
      unresolved: 0,
    };

    record.interaction = lastStepHidden(steps) ? "disappear" : "appear";
    animations.push(record);
  });

  return { animations, skipped };
}

/* ==================================================
HTML
================================================== */

/*
 * Which element each class is used on. An <img class="product"> is the
 * strongest possible signal that .product animates an image.
 */
export function mapClassesToTags(htmlText) {
  const map = new Map();
  const pattern = /<([a-zA-Z][\w-]*)\b[^>]*?class\s*=\s*["']([^"']+)["']/g;

  let match;
  while ((match = pattern.exec(String(htmlText || ""))) !== null) {
    const tag = match[1].toLowerCase();

    match[2].split(/\s+/).filter(Boolean).forEach((className) => {
      /* img wins over a generic wrapper reusing the same class. */
      if (map.get(className) === "img") return;
      map.set(className, tag);
    });
  }

  return map;
}

export function extractFromHtml(htmlText) {
  const text = String(htmlText || "");
  const styles = [];
  const scripts = [];

  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = stylePattern.exec(text)) !== null) styles.push(match[1]);

  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((match = scriptPattern.exec(text)) !== null) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    scripts.push(match[2]);
  }

  return {
    css: styles.join("\n"),
    js: scripts.join("\n"),
    tagByClass: mapClassesToTags(text),
  };
}

/* ==================================================
NAMING + DESCRIPTION
================================================== */

const AXIS_WORDS = { translateX: "X", translateY: "Y", translateZ: "Z" };

function readTransformParts(value) {
  const parts = {};
  const pattern = /([a-z0-9]+)\s*\(([^)]*)\)/gi;
  let match;

  while ((match = pattern.exec(String(value || ""))) !== null) {
    parts[match[1]] = match[2].trim();
  }

  return parts;
}

function firstNumber(value) {
  const match = String(value || "").match(/-?\d*\.?\d+/);
  return match ? Number(match[0]) : 0;
}

/* Describes the motion so GSAP tweens (which carry no name) still get a
   readable title. */
export function describeMotion(steps) {
  const first = steps[0] ? steps[0].declarations : {};
  const last = steps[steps.length - 1] ? steps[steps.length - 1].declarations : {};

  const fromTransform = readTransformParts(first.transform);
  const toTransform = readTransformParts(last.transform);
  const words = [];

  const fromOpacity = first.opacity === undefined ? null : Number(first.opacity);
  const toOpacity = last.opacity === undefined ? null : Number(last.opacity);

  if (fromOpacity !== null && toOpacity !== null && fromOpacity !== toOpacity) {
    words.push(toOpacity > fromOpacity ? "Fade In" : "Fade Out");
  }

  ["translateX", "translateY", "translateZ"].forEach((key) => {
    const from = firstNumber(fromTransform[key]);
    const to = firstNumber(toTransform[key]);
    if (from === to) return;

    const axis = AXIS_WORDS[key];
    const direction = key === "translateX"
      ? (from < to ? "Right" : "Left")
      : key === "translateY"
        ? (from < to ? "Down" : "Up")
        : (from < to ? "Forward" : "Back");

    words.push(`Slide ${direction}`);
    void axis;
  });

  ["scale", "scaleX", "scaleY"].forEach((key) => {
    const from = fromTransform[key] === undefined ? 1 : firstNumber(fromTransform[key]);
    const to = toTransform[key] === undefined ? 1 : firstNumber(toTransform[key]);
    if (from === to) return;
    words.push(to > from ? "Scale Up" : "Scale Down");
  });

  ["rotate", "rotateX", "rotateY"].forEach((key) => {
    const from = firstNumber(fromTransform[key]);
    const to = firstNumber(toTransform[key]);
    if (from === to) return;
    words.push(key === "rotate" ? "Rotate" : "Flip");
  });

  if (last.filter !== undefined && first.filter !== last.filter) words.push("Filter");
  if (last["clip-path"] !== undefined && first["clip-path"] !== last["clip-path"]) words.push("Reveal");

  const unique = [...new Set(words)];
  return unique.length ? unique.slice(0, 2).join(" ") : "Motion";
}

/*
 * Names emitted by authoring tools (gwd_gen_shpsgwdanimation, anim_04,
 * a7f3c2) carry no meaning; those fall back to a description of the motion.
 */
export function isMeaninglessName(name) {
  const value = String(name || "").trim();
  if (!value) return true;
  if (value.length > 28) return true;
  if (/gwd/i.test(value)) return true;
  if (/^(?:anim|animation|keyframe|kf|tween|effect|motion)[-_]?\d*$/i.test(value)) return true;
  if (/[a-z]{2,}\d{3,}/i.test(value)) return true;
  if (/^[a-z]{1,2}\d+$/i.test(value)) return true;

  /* Long unbroken lowercase-plus-digit blobs are generated identifiers. */
  const blob = value.replace(/[-_\s]/g, "");
  if (blob.length > 14 && /\d/.test(blob) && !/[-_\s]/.test(value)) return true;

  return false;
}

export function titleFromName(name) {
  return String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/* ==================================================
CATEGORIES

Restricted to the category list the editor already offers, so imported
animations filter and search exactly like hand made ones.
================================================== */

export function inferCategories(steps, timing, context = {}) {
  const categories = new Set();
  const properties = new Set();
  const transforms = new Set();

  steps.forEach(({ declarations }) => {
    Object.entries(declarations).forEach(([property, value]) => {
      properties.add(property);
      if (property === "transform") {
        Object.keys(readTransformParts(value)).forEach((part) => transforms.add(part));
      }
    });
  });

  if (properties.has("opacity")) categories.add("fade");
  if (transforms.has("translateX") || transforms.has("translateY")) categories.add("slide");
  if (transforms.has("scale") || transforms.has("scaleX") || transforms.has("scaleY")) categories.add("scale");
  if (transforms.has("rotate")) categories.add("rotate");
  /* Depth is more than three transform functions: a perspective on the
     container, a `translate3d` with a Z, a GSAP `rotationY` all make an
     animation 3D, and `detectThreeD` is the one place that decides. */
  if (detectThreeD({
    steps,
    target: context.target || {},
    parent: context.parent || {},
    gsapConfig: context.gsapConfig || null,
  }).is3d) categories.add("3d");
  if (properties.has("clip-path") || properties.has("mask") || properties.has("mask-image")) categories.add("fade");

  const easing = String(timing && timing.easing || "");
  if (/elastic/i.test(easing)) categories.add("elastic");
  if (/back|bounce/i.test(easing)) categories.add("spring");
  if (steps.length > 2) categories.add("timeline");

  return [...categories].slice(0, 4);
}

/* ==================================================
MOTION SHELF CONVERSION
================================================== */

function declarationsToText(declarations) {
  return Object.entries(declarations)
    .map(([property, value]) => `${property}: ${value};`)
    .join("\n");
}

export function stepsToKeyframeCss(steps) {
  return steps
    .map(({ offset, declarations }) => {
      const body = Object.entries(declarations)
        .map(([property, value]) => `    ${property}: ${value};`)
        .join("\n");

      return `  ${Number(offset.toFixed(2))}% {\n${body}\n  }`;
    })
    .join("\n\n");
}

const MOTION_SHELF_EASINGS = new Set([
  "linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end", "none",
]);

export function resolveEasingForShelf(easing) {
  const raw = String(easing || "").trim();
  if (!raw) return { easing: "ease-in-out", cubicBezier: null };

  const bezier = raw.match(/^cubic-bezier\(([^)]+)\)$/i);
  if (bezier) {
    const numbers = bezier[1].split(",").map((entry) => Number(entry.trim()));
    if (numbers.length === 4 && numbers.every(Number.isFinite)) {
      return { easing: "custom", cubicBezier: numbers };
    }
    return { easing: "ease-in-out", cubicBezier: null };
  }

  const lower = raw.toLowerCase();
  if (MOTION_SHELF_EASINGS.has(lower)) return { easing: lower, cubicBezier: null };
  if (/^(?:power[1-4]|sine|expo|circ|back|bounce|elastic)\.(?:in|out|inOut)$/i.test(raw)) {
    return { easing: raw, cubicBezier: null };
  }
  if (/^steps\(/i.test(lower)) return { easing: "linear", cubicBezier: null };

  return { easing: "ease-in-out", cubicBezier: null };
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

/* ==================================================
DEDUPLICATED LIBRARY

The same fade lives in hundreds of campaigns. Entries are keyed on the shape
of the motion, so repeats increment a counter instead of creating new cards,
and the most common timing wins.
================================================== */

function compareOrigins(left, right) {
  for (const key of ["repository", "file", "type", "folder"]) {
    const a = String(left[key] || "");
    const b = String(right[key] || "");
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/* Retain a small, sorted sample, independent of read completion order. Sorting
   only after collecting the first few arrivals would still choose different
   sources on a cold scan and a cache replay. */
export function addSourceSample(sources, origin, limit) {
  const known = sources.findIndex((source) =>
    source.repository === origin.repository && source.file === origin.file);
  if (known !== -1) {
    if (compareOrigins(origin, sources[known]) < 0) sources[known] = origin;
    return;
  }

  const index = sources.findIndex((source) => compareOrigins(origin, source) < 0);
  if (index === -1) {
    if (sources.length < limit) sources.push(origin);
    return;
  }

  sources.splice(index, 0, origin);
  if (sources.length > limit) sources.pop();
}

export class AnimationLibrary {
  constructor() {
    this.entries = new Map();
    this.duplicates = 0;
  }

  add(record, origin) {
    const fingerprint = fingerprintSteps(record.steps, {
      iterationCount: record.timing.iterationCount,
      direction: record.timing.direction,
    });

    const existing = this.entries.get(fingerprint);

    if (existing) {
      this.duplicates += 1;
      existing.occurrences += 1;

      /* The source path selects a reproducible representative without keeping
         every duplicate. Several matching rules in that same file break ties
         on their record, so selector/support/engine cannot depend on arrival. */
      const sourceOrder = compareOrigins(origin, existing.representativeOrigin);
      if (sourceOrder < 0 || (sourceOrder === 0 && record !== existing.record
        && JSON.stringify(record) < JSON.stringify(existing.record))) {
        existing.record = record;
        existing.representativeOrigin = origin;
      }

      const timingKey = `${record.timing.duration}|${record.timing.easing}|${record.timing.delay}`;
      existing.timingVotes.set(timingKey, (existing.timingVotes.get(timingKey) || 0) + 1);

      if (record.originalName) {
        existing.nameVotes.set(record.originalName, (existing.nameVotes.get(record.originalName) || 0) + 1);
      }

      existing.interactionVotes.set(
        record.interaction,
        (existing.interactionVotes.get(record.interaction) || 0) + 1,
      );

      const device = deviceFromPath(origin.file);
      if (device) existing.deviceVotes.set(device, (existing.deviceVotes.get(device) || 0) + 1);

      addSourceSample(existing.sources, origin, 5);
      return existing;
    }

    const entry = {
      fingerprint,
      record,
      representativeOrigin: origin,
      occurrences: 1,
      sources: [origin],
      timingVotes: new Map([[
        `${record.timing.duration}|${record.timing.easing}|${record.timing.delay}`, 1,
      ]]),
      nameVotes: new Map(record.originalName ? [[record.originalName, 1]] : []),
      interactionVotes: new Map([[record.interaction, 1]]),
      deviceVotes: new Map(deviceFromPath(origin.file) ? [[deviceFromPath(origin.file), 1]] : []),
    };

    this.entries.set(fingerprint, entry);
    return entry;
  }

  size() {
    return this.entries.size;
  }

  /* Exact-duplicate groups, handed to the family stage for near-duplicate
     grouping (see scripts/animation-family.js). */
  allEntries() {
    return [...this.entries.values()];
  }

}
