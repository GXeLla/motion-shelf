export function createId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

export function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "animation"
  );
}

export function slugifyCategory(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizeAnimationName(value) {
  let result = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");

  if (!result) {
    result = "msAnimation";
  }

  if (/^[0-9]/.test(result)) {
    result = `ms${result}`;
  }

  return result;
}

export function normalizeCategories(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");

  const normalized = source
    .map((item) => {
      const category = slugifyCategory(item);

      if (category === "three-d" || category === "three-dimensional") {
        return "3d";
      }

      return category;
    })
    .filter(Boolean);

  return [...new Set(normalized)];
}

export function normalizeImageUrl(value) {
  let url = String(value || "").trim();

  if (!url) {
    return "";
  }

  const markdownMatch = url.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

  if (markdownMatch) {
    url = markdownMatch[2].trim();
  }

  url = url.replace(/^["']|["']$/g, "");

  return url;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function escapeCssUrl(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "");
}

export function escapeSvg(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

export function formatCategoryLabel(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function indentCSS(css) {
  return String(css)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export function isTypingElement(element) {
  if (!element) {
    return false;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

export function formatDateTimeDDMMYY(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
