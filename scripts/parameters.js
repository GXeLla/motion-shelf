/*
 * Adjustable properties.
 *
 * A canonical animation is not only its keyframes. It also carries the styles
 * the motion needs to look right -- where it pivots, how deep the perspective
 * is, how an image sits inside its box -- and those are just as worth adjusting
 * as the distance it travels.
 *
 * This module turns those retained styles into structured parameters:
 *
 *   - which scope each property belongs to, target or parent, by what CSS
 *     actually requires rather than by where the campaign happened to write it,
 *   - a `var(--ms-..., default)` rewrite whose fallback is the original value,
 *     so an untouched animation renders exactly as it did,
 *   - and a description of every control, so the editor can be generated from
 *     the animation instead of guessing.
 *
 * Compound values are split by axis where separate axes make editing better:
 * `object-position: 50% 40%` becomes an X and a Y, not one opaque string.
 *
 * Nothing here invents a property. A value that is not in the animation
 * produces no variable, no control and no output.
 */

/* ==================================================
SCOPE

Some properties only work on the container, some only on the animated element.
The extractor collects both from one rule, so the split has to be decided by
what CSS requires: perspective establishes the 3D viewing box for a parent's
children and does nothing for the element's own transform, while
transform-style and backface-visibility act on the element being transformed.
================================================== */

export const PARENT_SCOPED = new Set([
  "perspective",
  "perspective-origin",
  "overflow",
  "overflow-x",
  "overflow-y",
]);

export const TARGET_SCOPED = new Set([
  "transform-style",
  "backface-visibility",
  "transform-origin",
  "transform-box",
  "will-change",
  "mix-blend-mode",
  "filter",
  "clip-path",
  "mask",
  "mask-image",
  "object-fit",
  "object-position",
  "background-position",
  "background-size",
  "border-radius",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
]);

/*
 * Splits what the extractor gathered into the two scopes.
 *
 * `collectSupportingStyles` files a property under both element and parent
 * when it appears in both lists, which is where "all the styles ended up on
 * the animated element" comes from. The scope sets above are the arbiter;
 * anything unrecognised stays where the extractor put it.
 */
export function splitSupport(support = {}) {
  const element = support.element || {};
  const parent = support.parent || {};

  const target = {};
  const container = {};

  const place = (property, value) => {
    if (PARENT_SCOPED.has(property)) {
      container[property] = value;
      return;
    }

    if (TARGET_SCOPED.has(property)) {
      target[property] = value;
      return;
    }

    target[property] = value;
  };

  Object.entries(element).forEach(([property, value]) => place(property, value));

  Object.entries(parent).forEach(([property, value]) => {
    if (PARENT_SCOPED.has(property)) {
      container[property] = value;
      return;
    }

    /* A parent-only list entry that CSS says belongs to the element -- and
       that the element did not already declare -- still has to reach the
       element rather than being dropped. */
    if (!(property in target)) place(property, value);
  });

  return { target, parent: container };
}

/* ==================================================
3D DETECTION

A 2D transform is not 3D, however many functions it chains. What makes an
animation 3D is a depth axis, a rotation out of the plane, or the properties
that establish a 3D context for one.
================================================== */

const THREE_D_FUNCTIONS = /^(?:translateZ|translate3d|rotateX|rotateY|rotate3d|scaleZ|scale3d|perspective|matrix3d)$/i;

const THREE_D_PROPERTIES = new Set([
  "perspective",
  "perspective-origin",
  "transform-style",
  "backface-visibility",
]);

const THREE_D_GSAP = new Set([
  "rotationX", "rotationY", "z", "zPercent", "transformPerspective",
  "rotateX", "rotateY", "translateZ",
]);

/*
 * `transform-style` and `backface-visibility` only mean 3D alongside real
 * depth, so they are corroborating evidence rather than proof: plenty of
 * campaigns set `backface-visibility: hidden` on a flat fade to dodge a
 * rendering artefact.
 */
export function detectThreeD({ steps = [], target = {}, parent = {}, gsapConfig = null } = {}) {
  const reasons = [];
  let depth = false;

  steps.forEach(({ declarations = {} }) => {
    Object.entries(declarations).forEach(([property, value]) => {
      if (!/^(?:transform|translate|rotate|scale)$/i.test(property)) return;

      const functions = String(value).match(/([a-zA-Z0-9]+)\s*\(/g) || [];

      functions.forEach((raw) => {
        const name = raw.replace(/\s*\($/, "");

        if (THREE_D_FUNCTIONS.test(name)) {
          depth = true;
          if (!reasons.includes(name)) reasons.push(name);
        }
      });

      /* `translate: 0 0 40px` and `rotate: 1 0 0 45deg` carry depth without
         naming a function at all. */
      if (property === "translate" && String(value).trim().split(/\s+/).length >= 3) {
        depth = true;
        if (!reasons.includes("translate z")) reasons.push("translate z");
      }

      if (property === "rotate" && String(value).trim().split(/\s+/).length >= 4) {
        depth = true;
        if (!reasons.includes("rotate axis")) reasons.push("rotate axis");
      }
    });
  });

  if (gsapConfig && typeof gsapConfig === "object") {
    const scan = (bag) => Object.keys(bag || {}).forEach((key) => {
      if (!THREE_D_GSAP.has(key)) return;
      depth = true;
      if (!reasons.includes(key)) reasons.push(key);
    });

    scan(gsapConfig.from);
    scan(gsapConfig.to);
    scan(gsapConfig);
  }

  /* Perspective on either scope establishes a 3D context, and nobody writes it
     for a flat animation. */
  ["perspective", "perspective-origin"].forEach((property) => {
    if (parent[property] || target[property]) {
      depth = true;
      if (!reasons.includes(property)) reasons.push(property);
    }
  });

  if (!depth) return { is3d: false, reasons: [] };

  Object.keys({ ...target, ...parent }).forEach((property) => {
    if (THREE_D_PROPERTIES.has(property) && !reasons.includes(property)) reasons.push(property);
  });

  return { is3d: true, reasons };
}

/* ==================================================
PROPERTY SPECS

Which retained properties become adjustable, and how. `axes` splits a compound
value so each side can be edited on its own; everything else becomes one
variable holding the whole value.
================================================== */

const SPECS = {
  perspective: { vars: ["--ms-perspective"], labels: ["Perspective"], kind: "length", group: "3d" },
  "perspective-origin": {
    axes: ["x", "y"],
    vars: ["--ms-perspective-origin-x", "--ms-perspective-origin-y"],
    labels: ["Perspective origin X", "Perspective origin Y"],
    fallbacks: ["50%", "50%"],
    kind: "position",
    group: "3d",
  },
  "transform-origin": {
    axes: ["x", "y"],
    vars: ["--ms-origin-x", "--ms-origin-y"],
    labels: ["Transform origin X", "Transform origin Y"],
    fallbacks: ["50%", "50%"],
    kind: "position",
    group: "transform",
  },
  "object-position": {
    axes: ["x", "y"],
    vars: ["--ms-object-position-x", "--ms-object-position-y"],
    labels: ["Object position X", "Object position Y"],
    fallbacks: ["50%", "50%"],
    kind: "position",
    group: "image",
  },
  "background-position": {
    axes: ["x", "y"],
    vars: ["--ms-background-position-x", "--ms-background-position-y"],
    labels: ["Background position X", "Background position Y"],
    fallbacks: ["50%", "50%"],
    kind: "position",
    group: "image",
  },
  "object-fit": { vars: ["--ms-object-fit"], labels: ["Object fit"], kind: "keyword", group: "image" },
  "background-size": { vars: ["--ms-background-size"], labels: ["Background size"], kind: "keyword", group: "image" },
  overflow: { vars: ["--ms-overflow"], labels: ["Overflow"], kind: "keyword", group: "container" },
  "overflow-x": { vars: ["--ms-overflow-x"], labels: ["Overflow X"], kind: "keyword", group: "container" },
  "overflow-y": { vars: ["--ms-overflow-y"], labels: ["Overflow Y"], kind: "keyword", group: "container" },
  "border-radius": { vars: ["--ms-radius"], labels: ["Corner radius"], kind: "length", group: "shape" },
  filter: { vars: ["--ms-filter"], labels: ["Filter"], kind: "keyword", group: "shape" },
  "clip-path": { vars: ["--ms-clip-path"], labels: ["Clip path"], kind: "keyword", group: "shape" },
  "transform-style": { vars: ["--ms-transform-style"], labels: ["Transform style"], kind: "keyword", group: "3d" },
  "backface-visibility": { vars: ["--ms-backface"], labels: ["Backface visibility"], kind: "keyword", group: "3d" },
};

/*
 * Sizes are deliberately absent. `width: 100%` on an animated image is how it
 * fills its frame, not a setting of the animation, and every one of these
 * would arrive as a control on every animation that has one. They are still
 * written out -- the animation needs them -- they are simply not knobs.
 */

/*
 * Values that are structure rather than configuration. Turning
 * `will-change: transform` into a knob invites someone to break the animation
 * with it, and `transform: none` on the element is a reset the keyframes
 * depend on.
 */
const NEVER_PARAMETERISED = new Set(["will-change", "transform", "mix-blend-mode", "transform-box"]);

/*
 * Reads the controls back out of a value that has already been through here.
 *
 * The same animation may pass through twice -- a re-sync, or a migration run
 * again -- and the second pass has to describe the same controls rather than
 * none. A declaration that already reads `var(--ms-perspective, 850px)` is a
 * control with a default, not a value to leave undescribed.
 *
 * Fallbacks nest (`var(--ms-filter, brightness(0.7))`), so the parentheses are
 * counted rather than matched with a pattern.
 */
export function readWrappedVariables(value) {
  const found = [];
  const text = String(value);

  for (let index = 0; index < text.length; index += 1) {
    if (!text.startsWith("var(", index)) continue;

    const nameStart = index + 4;
    const comma = text.indexOf(",", nameStart);
    if (comma === -1) break;

    const name = text.slice(nameStart, comma).trim();
    if (!/^--ms-[\w-]+$/.test(name)) continue;

    let depth = 1;
    let cursor = comma + 1;

    while (cursor < text.length && depth > 0) {
      if (text[cursor] === "(") depth += 1;
      else if (text[cursor] === ")") depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) break;

    found.push({ name, value: text.slice(comma + 1, cursor - 1).trim() });
    index = cursor - 1;
  }

  return found;
}

/*
 * A compound value only splits cleanly when it really has two parts.
 *
 * One part is not both parts. CSS reads a lone token as that axis plus a
 * centred other axis -- `transform-origin: 40%` is `40% center`, not
 * `40% 40%` -- and `top`/`bottom` name the Y axis, so they leave X centred.
 * Mirroring instead would move the pivot, and `object-position: left` would
 * mirror into the invalid `left left` and be thrown away by the browser.
 */
const Y_KEYWORDS = /^(?:top|bottom)$/i;

function splitAxes(value) {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return Y_KEYWORDS.test(parts[0]) ? ["center", parts[0]] : [parts[0], "center"];
  }

  if (parts.length === 2) {
    /* `top left` is written the other way round: a Y keyword first means the
       pair is reversed, and the axes have to be un-swapped before they are
       handed to an X variable and a Y variable. */
    if (Y_KEYWORDS.test(parts[0])) return [parts[1], parts[0]];

    return parts;
  }

  return null;
}

/*
 * Rewrites one scope's declarations so every configurable value reads from a
 * namespaced variable whose fallback is the value it already had.
 *
 * Returns the declarations to write and the controls that describe them.
 * A property with no spec is passed through untouched rather than dropped --
 * it is still needed to reproduce the animation, it simply is not adjustable.
 */
export function parameteriseDeclarations(declarations = {}, { scope = "target" } = {}) {
  const out = {};
  const parameters = [];

  Object.entries(declarations).forEach(([property, rawValue]) => {
    const value = String(rawValue == null ? "" : rawValue).trim();

    if (!value) return;

    if (NEVER_PARAMETERISED.has(property)) {
      out[property] = value;
      return;
    }

    const spec = SPECS[property];

    /* Already parameterised: keep the declaration exactly as it is and read
       the controls back out of it, so a second pass describes the same
       animation rather than an undescribed one. */
    if (value.includes("var(--ms-")) {
      out[property] = value;

      readWrappedVariables(value).forEach((wrapped) => {
        const index = spec ? spec.vars.indexOf(wrapped.name) : -1;

        parameters.push({
          name: wrapped.name,
          label: index === -1 ? labelForVariable(wrapped.name) : spec.labels[index],
          value: wrapped.value,
          kind: (spec && spec.kind) || "value",
          group: (spec && spec.group) || GROUPS[wrapped.name] || "motion",
          property,
          ...(index === -1 || !spec.axes ? {} : { axis: spec.axes[index] }),
          scope,
        });
      });

      return;
    }

    if (!spec) {
      out[property] = value;
      return;
    }

    if (spec.axes) {
      const parts = splitAxes(value);

      /* Three-part positions and other shapes stay whole rather than being
         guessed at. */
      if (!parts) {
        out[property] = value;
        return;
      }

      out[property] = spec.vars
        .map((name, index) => "var(" + name + ", " + parts[index] + ")")
        .join(" ");

      spec.vars.forEach((name, index) => {
        parameters.push({
          name,
          label: spec.labels[index],
          value: parts[index],
          kind: spec.kind,
          group: spec.group,
          property,
          axis: spec.axes[index],
          scope,
        });
      });

      return;
    }

    const name = spec.vars[0];

    out[property] = "var(" + name + ", " + value + ")";

    parameters.push({
      name,
      label: spec.labels[0],
      value,
      kind: spec.kind,
      group: spec.group,
      property,
      scope,
    });
  });

  return { declarations: out, parameters };
}

/* ==================================================
THE PARAMETER SET

What the editor reads. Target and parent are kept apart because they are
edited in different places and copied into different selectors.
================================================== */

export const TIMING_PARAMETERS = [
  { name: "--ms-duration", label: "Duration", kind: "time", group: "timing" },
  { name: "--ms-delay", label: "Delay", kind: "time", group: "timing" },
  { name: "--ms-ease", label: "Easing", kind: "easing", group: "timing" },
];

/*
 * Assembles the metadata. `keyframe` is what the family stage already produced
 * for the motion itself; `target` and `parent` come from parameterising the
 * retained support styles; timing is added when the animation reads its timing
 * from variables.
 */
export function buildParameterSet({
  keyframe = [],
  target = [],
  parent = [],
  timing = true,
  timingValues = {},
  parentClassName = "",
} = {}) {
  const seen = new Set();
  const push = (list, entry) => {
    if (!entry || !entry.name || seen.has(entry.scope + entry.name)) return;
    seen.add(entry.scope + entry.name);
    list.push(entry);
  };

  const targetList = [];
  const parentList = [];

  if (timing) {
    TIMING_PARAMETERS.forEach((entry) => push(targetList, {
      ...entry,
      value: timingValues[entry.name] || "",
      scope: "target",
    }));
  }

  keyframe.forEach((variable) => push(targetList, {
    name: variable.name,
    label: variable.label,
    value: variable.value,
    kind: variable.kind || "number",
    group: "motion",
    scope: "target",
  }));

  target.forEach((entry) => push(targetList, { ...entry, scope: "target" }));
  parent.forEach((entry) => push(parentList, { ...entry, scope: "parent" }));

  return {
    target: targetList,
    parent: parentList,
    parentRequired: parentList.length > 0,
    parentClassName: parentList.length ? parentClassName : "",
  };
}

/* ==================================================
READING PARAMETERS BACK

An animation that predates this -- or one a person wrote by hand -- has its
values in its css and parent text rather than in metadata. Reading them back
means the editor works the same for both.
================================================== */

function readCustomProperties(text) {
  const found = [];

  String(text || "").split(";").forEach((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return;

    const name = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();

    if (!/^--ms-[\w-]+$/.test(name) || !value) return;

    found.push({ name, value });
  });

  return found;
}

/*
 * The motion variables the family builder produces. They are described in the
 * record's own metadata, but an animation written before that -- or one whose
 * metadata a person has edited away -- still has them in its css, and
 * "Rotation y" is not what anybody wants to read next to a control.
 */
const MOTION_LABELS = {
  "--ms-distance": "Distance",
  "--ms-x": "Distance X",
  "--ms-y": "Distance Y",
  "--ms-z": "Distance Z",
  "--ms-scale": "Scale",
  "--ms-scale-x": "Scale X",
  "--ms-scale-y": "Scale Y",
  "--ms-scale-z": "Scale Z",
  "--ms-rotation": "Rotation",
  "--ms-rotation-x": "Rotation X",
  "--ms-rotation-y": "Rotation Y",
  "--ms-skew-x": "Skew X",
  "--ms-skew-y": "Skew Y",
  "--ms-opacity": "Opacity",
  "--ms-transform-perspective": "Transform perspective",
};

const LABELS = (() => {
  const labels = { ...MOTION_LABELS };

  Object.values(SPECS).forEach((spec) => {
    spec.vars.forEach((name, index) => { labels[name] = spec.labels[index]; });
  });

  TIMING_PARAMETERS.forEach((entry) => { labels[entry.name] = entry.label; });

  return labels;
})();

/* `--ms-overshoot-y` is the Y distance at the overshoot stage, so it should
   read as one, rather than as a variable nobody has heard of. */
const STAGE_PREFIX = /^--ms-(start|overshoot|settle|end|stage-\d+)-(.+)$/;

const STAGE_LABELS = {
  start: "Start",
  overshoot: "Overshoot",
  settle: "Settle",
  end: "End",
};

const GROUPS = (() => {
  const groups = {};

  Object.values(SPECS).forEach((spec) => {
    spec.vars.forEach((name) => { groups[name] = spec.group; });
  });

  TIMING_PARAMETERS.forEach((entry) => { groups[entry.name] = entry.group; });

  return groups;
})();

export function labelForVariable(name) {
  if (LABELS[name]) return LABELS[name];

  const staged = STAGE_PREFIX.exec(String(name));

  if (staged) {
    const [, role, rest] = staged;
    const stage = STAGE_LABELS[role] || role.replace("stage-", "Stage ");

    return stage + " " + labelForVariable("--ms-" + rest).toLowerCase();
  }

  return String(name)
    .replace(/^--ms-/, "")
    .replace(/-/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

/*
 * The fallback path: build a parameter set out of whatever the record's own
 * css and parent text declare. Used for animations stored before parameters
 * existed, and as the source of truth while a person is editing, where the
 * text is what they are actually changing.
 */
export function parametersFromRecord(animation = {}) {
  const target = readCustomProperties(animation.css).map((entry) => ({
    ...entry,
    label: labelForVariable(entry.name),
    group: GROUPS[entry.name] || "motion",
    kind: "value",
    scope: "target",
  }));

  const parent = readCustomProperties(animation.parent).map((entry) => ({
    ...entry,
    label: labelForVariable(entry.name),
    group: GROUPS[entry.name] || "container",
    kind: "value",
    scope: "parent",
  }));

  return {
    target,
    parent,
    parentRequired: parent.length > 0,
    parentClassName: "",
  };
}

/*
 * What the editor and the cards should use: the stored metadata when it is
 * there, the record's own declarations when it is not, and the declarations
 * merged over the metadata while an animation is being edited so a value the
 * person just changed is the one shown.
 */
export function resolveParameters(animation = {}) {
  const declared = parametersFromRecord(animation);
  const stored = animation.parameters;

  if (!stored || (!stored.target?.length && !stored.parent?.length)) {
    return declared;
  }

  const overlay = (list, from) => list.map((entry) => {
    const match = from.find((candidate) => candidate.name === entry.name);
    return match ? { ...entry, value: match.value } : entry;
  });

  const targetNames = new Set(stored.target.map((entry) => entry.name));
  const parentNames = new Set(stored.parent.map((entry) => entry.name));

  return {
    target: [
      ...overlay(stored.target, declared.target),
      ...declared.target.filter((entry) => !targetNames.has(entry.name)),
    ],
    parent: [
      ...overlay(stored.parent, declared.parent),
      ...declared.parent.filter((entry) => !parentNames.has(entry.name)),
    ],
    parentRequired: stored.parentRequired || declared.parentRequired,
    parentClassName: stored.parentClassName || "",
  };
}

/*
 * Only what changed. Comparing the record's current values against the
 * canonical defaults it was published with is what lets a project override one
 * value instead of copying the whole animation.
 */
export function changedParameters(animation = {}) {
  const stored = animation.parameters;

  if (!stored) return { target: [], parent: [] };

  const current = parametersFromRecord(animation);

  const diff = (canonical, now) => canonical
    .map((entry) => {
      const match = now.find((candidate) => candidate.name === entry.name);
      if (!match || match.value === entry.value) return null;
      return { ...entry, value: match.value, canonical: entry.value };
    })
    .filter(Boolean);

  return {
    target: diff(stored.target || [], current.target),
    parent: diff(stored.parent || [], current.parent),
  };
}
