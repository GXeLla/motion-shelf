/*
 * The code a person actually pastes.
 *
 * An animation is stored as a record -- its declarations, its keyframes, the
 * container it needs, and a good deal that only Motion Shelf cares about:
 * where it was found, which campaign it came from, how it was classified,
 * what its adjustable values are. `buildExportCSS` writes all of that, because
 * a file on disk has to be readable back into the library.
 *
 * Copying is the other case. Nobody pastes provenance into an advertising
 * project. So this module builds the animation as three plain blocks -- the
 * class, the container when there is one, the keyframes -- each of which can
 * stand on its own, and each carrying one line of comment that says what to do
 * with it.
 *
 * Every copy button in the app comes through here: the card, each section in
 * the details modal, and the whole-animation button. `buildWholeAnimation` is
 * literally the other three joined, so the parts can never drift from the
 * whole.
 *
 * What is NOT removed: the `--ms-` variables. They are the animation's
 * settings, and a project retunes an animation by overriding one. Clean means
 * without Motion Shelf's bookkeeping, not without the parts that make the
 * animation adjustable.
 */

import {
  getAnimationInlineCSS,
  getExportClassName,
  normalizeKeyframes,
} from "./animations.js";

import { readWrappedVariables } from "./parameters.js";

import { sanitizeAnimationName } from "./utils.js";

const INDENT = "  ";

/* ==================================================
SAYING IT ONCE

A parameterised value is written twice: as `--ms-scale: 0.92` at the top of the
rule, and again as the fallback in `scale(var(--ms-scale, 0.92))` that the
keyframe reads. While the two agree, the declaration says nothing that the
fallback does not already say, and removing it renders exactly the same
animation.

So a copy carries the values a person actually retuned and lets the rest speak
through their own fallbacks. Someone pasting it can see at a glance which two
values this animation departs from, instead of a wall of numbers with no way to
tell which of them matter.
================================================== */

function unchangedVariables(animation) {
  /* The animation shorthand reads the timing variables and is generated
     rather than stored, so it has to be searched too. */
  const text = [
    animation.css,
    animation.parent,
    animation.keyframes,
    getAnimationInlineCSS(animation),
  ].join("\n");

  const declared = new Map();

  String(animation.css + "\n" + animation.parent).split(";").forEach((declaration) => {
    const at = declaration.indexOf(":");
    if (at < 1) return;

    const name = declaration.slice(0, at).trim();
    if (!/^--ms-[\w-]+$/.test(name)) return;

    declared.set(name, declaration.slice(at + 1).trim());
  });

  const unchanged = new Set();

  /* Fallbacks nest -- `var(--ms-ease, cubic-bezier(0.23, 1, 0.32, 1))` -- so
     the uses are scanned by counting brackets rather than matched. */
  const uses = readWrappedVariables(text);

  declared.forEach((value, name) => {
    /* Every use has to agree, and there has to be a use: a variable nothing
       reads is not redundant, it is the only place that value survives. */
    const mine = uses.filter((use) => use.name === name);
    if (!mine.length) return;

    if (mine.every((use) => use.value === value)) unchanged.add(name);
  });

  return unchanged;
}

/*
 * TIMING HAS ONE SOURCE
 *
 * An animation's duration, delay and easing live on the record, as the fields
 * the editor edits and the preview plays. They are ALSO written into the class
 * body as `--ms-duration: 3.8s`, which is fine while the two agree and a trap
 * the moment they do not: change the duration in the editor and the record
 * says 7s, the preview plays 7s, and the stale declaration -- which beats the
 * fallback it sits next to -- would hand a person 3.8s on the clipboard.
 *
 * `getAnimationInlineCSS` already carries the authoritative values as the
 * fallbacks, so the declarations are dropped. What was copied is then always
 * what was previewed.
 */
const TIMING_VARIABLES = new Set(["--ms-duration", "--ms-delay", "--ms-ease"]);

function withoutTimingVariables(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const at = line.indexOf(":");
      if (at < 1) return true;

      return !TIMING_VARIABLES.has(line.slice(0, at).trim());
    })
    .join("\n");
}

function withoutVariables(text, names) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const at = line.indexOf(":");
      if (at < 1) return true;

      return !names.has(line.slice(0, at).trim());
    })
    .join("\n");
}

/* ==================================================
SHAPING
================================================== */

/* One declaration per line, trimmed, each ending in a semicolon. */
function declarationLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.endsWith(";") ? line : line + ";"));
}

function rule(selector, lines) {
  if (!lines.length) return "";

  return selector + " {\n" + lines.map((line) => INDENT + line).join("\n") + "\n}";
}

/* The keyframes are stored as a fragment meant to be pasted into a larger
   string, so their indentation only makes sense in that context. Re-indenting
   by brace depth makes the copied block correct on its own. */
function indentByDepth(text) {
  let depth = 0;

  const lines = String(text)
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";

      if (trimmed.startsWith("}")) depth = Math.max(0, depth - 1);

      const indented = INDENT.repeat(depth + 1) + trimmed;

      if (trimmed.endsWith("{")) depth += 1;

      return indented;
    });

  /* Blank lines are dropped from the ends rather than trimmed off the string,
     which would take the first line's indentation with them. */
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/* What is between the outermost braces, so it can be given a fresh wrapper.
   `normalizeKeyframes` is asked rather than the record, because it is what
   supplies a default for an animation whose keyframes are empty. */
function keyframeBody(animation) {
  const text = normalizeKeyframes(animation).trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");

  if (open === -1 || close === -1 || close < open) return text;

  return text.slice(open + 1, close);
}

function stripAnimationDeclarations(css) {
  return String(css || "")
    .replace(/\banimation(?:-[a-z-]+)?\s*:[^;]+;?/gi, "")
    .trim();
}

/* ==================================================
WHAT A CONTAINER IS FOR

Some animations need something from the element around them: a perspective for
a 3D turn, an overflow for a drift that travels past its own edges. Those
belong on the parent, and an animation that needs none gets no container block
at all -- an empty rule in a copied snippet is a question the person pasting it
has to stop and answer.
================================================== */

export function requiresParentClass(animation) {
  if (animation?.parameters?.parentRequired) return true;

  return Boolean(String(animation?.parent || "").trim());
}

export function getParentClassName(animation) {
  const declared = animation?.parameters?.parentClassName;

  if (declared) return String(declared).replace(/^\./, "");

  return getExportClassName(animation).replace(/^\./, "") + "-parent";
}

/* ==================================================
THE THREE BLOCKS
================================================== */

export function buildAnimationClass(animation) {
  if (!animation) return "";

  const selector = getExportClassName(animation);
  const className = selector.replace(/^\./, "");

  const styles = declarationLines(
    stripAnimationDeclarations(
      withoutTimingVariables(withoutVariables(animation.css, unchangedVariables(animation))),
    ),
  );

  const timing = declarationLines(getAnimationInlineCSS(animation));

  /* A hover animation should not be running when the page loads, so its
     timing goes on the hover state and the element keeps only the styles the
     motion needs to be ready. */
  const hover = animation.interaction === "hover";

  const base = rule(selector, hover ? styles : [...styles, ...timing]);
  const hoverRule = hover ? rule(selector + ":hover", timing) : "";

  const body = [base, hoverRule].filter(Boolean).join("\n\n");

  if (!body) return "";

  return '/* Add class="' + className + '" to the element you want to animate. */\n' + body;
}

export function buildParentClass(animation) {
  if (!animation || !requiresParentClass(animation)) return "";

  const className = getParentClassName(animation);

  const lines = declarationLines(
    withoutVariables(animation.parent, unchangedVariables(animation)),
  );

  /* Declared as needing a container but with nothing to put in it: still no
     empty rule. */
  if (!lines.length) return "";

  return '/* Add class="' + className + '" to the parent element. */\n'
    + rule("." + className, lines);
}

export function buildKeyframes(animation) {
  if (!animation) return "";

  const selector = getExportClassName(animation);
  const name = sanitizeAnimationName(animation.animationName);
  const body = indentByDepth(keyframeBody(animation));

  if (!body) return "";

  return "/* Keyframes used by " + selector + " */\n"
    + "@keyframes " + name + " {\n" + body + "\n}";
}

/*
 * The whole thing, and nothing but: the container first because it has to
 * exist before the element it wraps makes sense, then the class, then the
 * keyframes it names.
 *
 * This is the other three functions and no separate implementation, so a
 * change to any block reaches every copy button in the app at once.
 */
export function buildWholeAnimation(animation) {
  return [
    buildParentClass(animation),
    buildAnimationClass(animation),
    buildKeyframes(animation),
  ].filter(Boolean).join("\n\n");
}

/* What the details modal renders: the sections that exist, in order, each
   ready to be shown and copied on its own. */
export function buildAnimationSections(animation) {
  return [
    { key: "animation", label: "Animation Class", code: buildAnimationClass(animation) },
    { key: "parent", label: "Parent Class", code: buildParentClass(animation) },
    { key: "keyframes", label: "Keyframes", code: buildKeyframes(animation) },
  ].filter((section) => section.code);
}
