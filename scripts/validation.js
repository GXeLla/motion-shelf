const ANIMATION_PROPERTIES = new Set([
  "animation",
  "animation-name",
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-play-state",
  "animation-composition",
  "animation-range",
  "animation-range-start",
  "animation-range-end",
  "animation-timeline",
]);

export function validateAnimationDraft(data) {
  const errors = {};
  const name = String(data.name || "").trim();
  const animationName = String(data.animationName || "").trim();

  if (!name) errors.name = "Give the animation a display name.";

  if (!animationName) {
    errors.animationName = "Add a keyframe name.";
  } else if (!/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(animationName)) {
    errors.animationName =
      "Use letters, numbers, hyphens or underscores, and do not start with a number.";
  }

  const duration = Number(data.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.duration = "Duration must be greater than 0.";
  }

  const delay = Number(data.delay);
  if (!Number.isFinite(delay)) errors.delay = "Delay must be a number.";

  const iteration = String(data.iterationCount || "").trim();
  if (
    iteration !== "infinite" &&
    (!Number.isFinite(Number(iteration)) || Number(iteration) <= 0)
  ) {
    errors.iterationCount = 'Iterations must be a number above 0 or "infinite".';
  }

  const cssError = validateDeclarations(data.css, {
    label: "Global CSS",
    disallowAnimation: true,
  });
  if (cssError) errors.css = cssError;

  const parentError = validateDeclarations(data.parent, {
    label: "Parent CSS",
  });
  if (parentError) errors.parent = parentError;

  const keyframeError = validateKeyframes(data.keyframes, animationName);
  if (keyframeError) errors.keyframes = keyframeError;

  if (data.imageUrl) {
    try {
      new URL(data.imageUrl, window.location.href);
    } catch {
      errors.imageUrl = "Enter a valid image URL or project-relative path.";
    }
  }

  return errors;
}

export function validateDeclarations(value, options = {}) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/[{}]/.test(removeComments(source))) {
    return `${options.label || "CSS"} accepts declarations only, without selector braces.`;
  }

  const declarations = splitDeclarations(removeComments(source));

  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index].trim();
    if (!declaration) continue;

    const colon = findTopLevelColon(declaration);
    if (colon < 1) {
      return `Declaration ${index + 1} needs a colon, for example: opacity: 1;`;
    }

    const property = declaration.slice(0, colon).trim().toLowerCase();
    const propertyValue = declaration.slice(colon + 1).trim();

    if (!/^(--[\w-]+|-?[a-z][\w-]*)$/i.test(property)) {
      return `“${property || declaration}” is not a valid CSS property name.`;
    }
    if (!propertyValue) return `“${property}” needs a value.`;

    if (options.disallowAnimation && ANIMATION_PROPERTIES.has(property)) {
      return `Move “${property}” to the Animation settings section.`;
    }

    if (!property.startsWith("--") && !isSupportedDeclaration(property, propertyValue)) {
      return `The browser rejected “${property}: ${propertyValue}”. Check the value.`;
    }
  }

  return "";
}

export function validateKeyframes(value, animationName) {
  const source = String(value || "").trim();
  if (!source) return "Add at least one from/to or percentage keyframe.";

  if (!hasBalancedPairs(source, "{", "}")) {
    return "Keyframe braces are not balanced.";
  }

  if (!/(?:^|[}\s,])(from|to|\d+(?:\.\d+)?%)(?:\s|,)*\{/m.test(source)) {
    return "Add selectors such as from, to, 0%, 50% or 100%.";
  }

  if (source.includes("@keyframes")) {
    const declared = source.match(/@keyframes\s+([^\s{]+)/)?.[1];
    if (declared && animationName && declared !== animationName) {
      return `The rule is named “${declared}”, but the keyframe name field is “${animationName}”.`;
    }
  }

  try {
    const sheet = new CSSStyleSheet();
    const rule = source.includes("@keyframes")
      ? source
      : `@keyframes ${animationName || "msPreview"} { ${source} }`;
    sheet.replaceSync(rule);
    if (!sheet.cssRules.length) return "The keyframe rule could not be parsed.";
  } catch {
    return "The keyframe CSS contains a syntax error.";
  }

  return "";
}

export function applyDeclarationBlock(element, value) {
  splitDeclarations(removeComments(String(value || ""))).forEach((declaration) => {
    const colon = findTopLevelColon(declaration);
    if (colon < 1) return;
    const property = declaration.slice(0, colon).trim();
    const propertyValue = declaration.slice(colon + 1).trim();
    if (property && propertyValue) element.style.setProperty(property, propertyValue);
  });
}

function isSupportedDeclaration(property, value) {
  if (typeof CSS?.supports === "function" && CSS.supports(property, value)) return true;
  const style = document.createElement("div").style;
  style.setProperty(property, value);
  return Boolean(style.getPropertyValue(property));
}

function splitDeclarations(source) {
  const result = [];
  let current = "";
  let quote = "";
  let parentheses = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];
    if ((character === '"' || character === "'") && previous !== "\\") {
      quote = quote === character ? "" : quote || character;
    }
    if (!quote && character === "(") parentheses += 1;
    if (!quote && character === ")") parentheses = Math.max(0, parentheses - 1);
    if (!quote && !parentheses && character === ";") {
      result.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

function findTopLevelColon(source) {
  let quote = "";
  let parentheses = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];
    if ((character === '"' || character === "'") && previous !== "\\") {
      quote = quote === character ? "" : quote || character;
    }
    if (!quote && character === "(") parentheses += 1;
    if (!quote && character === ")") parentheses = Math.max(0, parentheses - 1);
    if (!quote && !parentheses && character === ":") return index;
  }
  return -1;
}

function removeComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasBalancedPairs(value, opening, closing) {
  let depth = 0;
  for (const character of value) {
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
