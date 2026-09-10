import { state } from "./state.js";

import {
  escapeAttribute,
  escapeHtml,
  formatCategoryLabel,
  normalizeCategories,
  formatDateTimeDDMMYY,
} from "./utils.js";

import {
  applyAnimation,
  applyPreviewBackdrop,
  createPreviewImage,
} from "./animations.js";

import { getCategoryIcon, animationMatchesFilter } from "./filters.js";

import { isFavourite } from "./favourites.js";

import { describeOrigin } from "./origin.js";

/*
 * WINDOWED RENDERING
 *
 * The library is one grid, but only a screenful of it is ever built. Each
 * card costs roughly 40 nodes and two generated images; building a thousand
 * of them took minutes and had to be repeated on every filter click, search
 * keystroke and star. Now a batch is built, and the next one follows when a
 * sentinel below the grid comes within 800px of the viewport -- so the cards
 * exist before you scroll to them, and a filter click builds 48 cards instead
 * of the whole archive.
 */
const BATCH = 48;

const SCROLL_BATCH = 12;

/* Only one grid is ever on screen, so a single observer is enough; it is
   disconnected before each render so an abandoned list cannot keep appending
   cards into a grid that has already moved on. */
let stopBatchLoading = null;

/*
 * Everything a card draws from, in one string.
 *
 * A render used to empty the grid and build it again, which is why applying a
 * sync flashed: every card on screen was destroyed and replaced, previews and
 * all, even though almost all of them were about to be drawn identically.
 * Comparing this against what a card was built from says whether the existing
 * node can simply be moved into place instead.
 */
function cardSignature(animation) {
  return [
    animation.updatedAt,
    animation.name,
    animation.description,
    animation.target,
    animation.device,
    animation.interaction,
    normalizeCategories(animation.categories).join(","),
    animation.className,
    animation.animationName,
    animation.css,
    animation.keyframes,
    animation.duration,
    animation.durationUnit,
    animation.delay,
    animation.delayUnit,
    animation.easing,
    animation.iterationCount,
    animation.localPresent ? 1 : 0,
    animation.repositoryPresent ? 1 : 0,
    animation.localPath,
    animation.codeSynced ? 1 : 0,
    animation.origin ? JSON.stringify(animation.origin) : "",
    /* Not on the record, but the card is drawn differently for each. */
    state.selectionMode ? 1 : 0,
    state.selectedIds.has(animation.id) ? 1 : 0,
    isFavourite(animation.id) ? 1 : 0,
    (state.selectedFilters || []).join("|"),
  ].join("\u0001");
}

export function renderCards(animationGrid, animations) {
  stopBatchLoading?.();
  stopBatchLoading = null;

  /* What is on screen right now, so identical cards can be kept. */
  const existing = new Map();

  animationGrid.querySelectorAll(".animation-card").forEach((card) => {
    existing.set(card.dataset.id, card);
  });

  /*
   * Rebuild at least a screenful, and as much as was already rendered, so a
   * re-render does not collapse the page under someone who had scrolled a
   * long way down it.
   */
  const initial = Math.max(BATCH, existing.size);

  let sentinel = animationGrid.querySelector(".grid-sentinel");

  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.className = "grid-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
  }

  /* Always last: every card is inserted before it. */
  animationGrid.appendChild(sentinel);

  let cursor = 0;

  /* The nodes this render has placed. Tracked as elements rather than ids:
     when a card has to be rebuilt, its old node must go even though the id
     stays in the grid. */
  const placed = new Set();

  /* Returns whether anything is still waiting to be rendered. */
  const appendBatch = (size = BATCH) => {
    const slice = animations.slice(cursor, cursor + size);

    if (!slice.length) {
      return false;
    }

    slice.forEach((animation) => {
      const signature = cardSignature(animation);
      const previous = existing.get(animation.id);

      let card;

      if (previous && previous.dataset.signature === signature) {
        /* Identical: move the live node, keeping its preview and any
           animation already running in it. */
        card = previous;
      } else {
        card = createCard(animation);
        card.dataset.signature = signature;

        /* The card it replaces has to go now; leaving it for the sweep below
           would leave two cards for one animation, because the sweep only
           knows which nodes this render placed. */
        if (previous) previous.remove();
      }

      animationGrid.insertBefore(card, sentinel);

      placed.add(card);
    });

    cursor += slice.length;

    return cursor < animations.length;
  };

  const more = appendBatch(initial);

  /* Whatever is left belonged to the previous list. */
  existing.forEach((card) => {
    if (!placed.has(card)) card.remove();
  });

  if (!more) {
    sentinel.remove();
    return;
  }

  let disposed = false;
  let frame = 0;
  const observer = new IntersectionObserver((entries) => {
    if (disposed || document.hidden || frame || !entries.some((entry) => entry.isIntersecting)) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || document.hidden || !sentinel.isConnected) return;
      // Observer entries can be stale after a tab switch or layout change.
      const bounds = sentinel.getBoundingClientRect();
      if (bounds.top > window.innerHeight + 800 || bounds.bottom < -800) return;
      if (!appendBatch(SCROLL_BATCH)) {
        dispose();
        sentinel.remove();
        return;
      }
      // One small batch per frame; a fresh observation handles tall viewports.
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    });
  }, { rootMargin: "800px 0px" });

  function syncVisibility() {
    cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    if (!document.hidden && !disposed && sentinel.isConnected) observer.observe(sentinel);
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("visibilitychange", syncVisibility);
  }

  stopBatchLoading = dispose;
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
}

/*
 * Starring a card changes one card. Rebuilding the grid for it would throw
 * away every preview on screen and restart every animation, so the card is
 * patched where it stands.
 */
export function refreshCardFavourite(animationGrid, id) {
  const card = animationGrid.querySelector(
    `.animation-card[data-id="${CSS.escape(String(id))}"]`,
  );

  if (!card) return;

  const button = card.querySelector(".card-favourite");
  const starred = isFavourite(id);

  card.classList.toggle("is-favourite", starred);

  if (!button) return;

  button.classList.toggle("is-on", starred);
  button.title = starred ? "Remove from favourites" : "Save to favourites";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", starred ? "true" : "false");
  button.innerHTML = `<i class="${starred ? "fa-solid" : "fa-regular"} fa-star"></i>`;
}

/* Same reasoning for ticking a card in selection mode. */
export function refreshCardSelection(animationGrid, id, selected) {
  const card = animationGrid.querySelector(
    `.animation-card[data-id="${CSS.escape(String(id))}"]`,
  );

  if (!card) return;

  card.classList.toggle("selected", selected);

  const input = card.querySelector('input[data-action="select"]');

  if (input) input.checked = selected;
}

export function createCard(animation) {
  const card = document.createElement("article");

  card.className = "animation-card";

  const favourited = isFavourite(animation.id);

  card.classList.toggle("is-favourite", favourited);

  card.dataset.action = "copy";

  card.dataset.id = animation.id;

  card.title = "Click the card to copy the complete CSS";

  if (state.selectedIds.has(animation.id)) {
    card.classList.add("selected");
  }

  /*
   * PREVIEW
   */

  const preview = document.createElement("div");

  preview.className = "card-preview";

  applyPreviewBackdrop(preview, animation);

  /*
   * LIVE / PRESENCE INDICATOR
   */

  const presence = document.createElement("span");

  presence.className = "card-presence";

  presence.innerHTML = `
    <span class="card-presence-dot"></span>
  `;

  preview.appendChild(presence);

  /*
   * IMAGE
   */

  const image = document.createElement("img");

  image.className = "preview-image";

  image.alt = animation.name;

  image.src = createPreviewImage(animation);

  preview.appendChild(image);

  const safeFrame = document.createElement("div");
  safeFrame.className = "safe-frame";
  safeFrame.setAttribute("aria-hidden", "true");
  preview.appendChild(safeFrame);

  const copyHint = document.createElement("span");
  copyHint.className = "card-copy-hint";
  copyHint.innerHTML =
    '<i class="fa-solid fa-copy"></i> Click card to copy CSS';
  preview.appendChild(copyHint);

  /*
   * PREVIEW TYPE LABEL
   */

  const previewType = document.createElement("span");

  previewType.className = "preview-type";

  previewType.textContent =
    animation.interaction === "hover"
      ? "HOVER"
      : animation.interaction === "infinite"
        ? "LOOP"
        : animation.interaction === "static"
          ? "STATIC"
          : "MOTION";

  preview.appendChild(previewType);

  /*
   * FAVOURITE
   *
   * A real <button>, so the card's own click-to-copy handler steps aside for
   * it instead of copying CSS every time somebody stars something.
   */
  /* Selection mode is dedicated to choosing cards for deletion. Leave the
     star out of its controls entirely, including for already favourited
     cards, so clicking the preview can only select the animation. */
  if (!state.selectionMode) {
    const favouriteButton = document.createElement("button");

    favouriteButton.type = "button";

    favouriteButton.className = "card-favourite";

    favouriteButton.classList.toggle("is-on", favourited);

    favouriteButton.dataset.action = "favourite";

    favouriteButton.dataset.id = animation.id;

    favouriteButton.title = favourited
      ? "Remove from favourites"
      : "Save to favourites";

    favouriteButton.setAttribute("aria-label", favouriteButton.title);

    favouriteButton.setAttribute("aria-pressed", favourited ? "true" : "false");

    favouriteButton.innerHTML = `<i class="${
      favourited ? "fa-solid" : "fa-regular"
    } fa-star"></i>`;

    preview.appendChild(favouriteButton);
  }

  /*
   * SELECTION
   */

  if (state.selectionMode) {
    const selection = document.createElement("label");

    selection.className = "card-selection";

    selection.innerHTML = `
        <input
          type="checkbox"
          data-action="select"
          data-id="${escapeAttribute(animation.id)}"
          ${state.selectedIds.has(animation.id) ? "checked" : ""}
        />
  
        <span class="selection-check">
          <i class="fa-solid fa-check"></i>
        </span>
      `;

    card.appendChild(selection);
  }

  /*
   * CONTENT
   */

  const content = document.createElement("div");

  content.className = "card-content";

  const titleRow = document.createElement("div");

  titleRow.className = "card-title-row";

  const title = document.createElement("h3");

  title.className = "card-title";

  title.textContent = animation.name;

  const targetBadge = document.createElement("span");

  targetBadge.className = "target-badge";

  targetBadge.textContent = `<${animation.target || "div"}>`;

  titleRow.appendChild(title);

  titleRow.appendChild(targetBadge);

  /*
   * Where it came from. Every card says this: an archive and, when the
   * animation came out of a single one, the brand folder inside it -- or
   * Custom for anything written here by hand. The LOCAL badge is a different
   * question (is the file in the linked folder) and keeps its own place.
   */
  const origin = describeOrigin(animation);

  const originBadge = document.createElement("span");

  originBadge.className = `source-badge source-${origin.kind}`;

  originBadge.dataset.tooltip = origin.tooltip;

  originBadge.innerHTML = `
    <i class="${escapeAttribute(origin.icon)}"></i>
    <span>${escapeHtml(origin.label)}</span>
    ${origin.brand ? `<b>${escapeHtml(origin.brand)}</b>` : ""}
  `;

  titleRow.appendChild(originBadge);

  if (!animation.repositoryPresent) {
    const localBadge = document.createElement("span");
    localBadge.className = "local-source-badge";
    localBadge.dataset.tooltip = animation.localPresent
      ? animation.localPath || "Saved in the linked animations folder"
      : "Created locally and not yet committed to the animation catalog.";
    localBadge.innerHTML = '<i class="fa-solid fa-hard-drive"></i> LOCAL';
    titleRow.appendChild(localBadge);
  }

  const description = document.createElement("p");

  description.className = "card-description";

  description.textContent =
    animation.description || "Reusable CSS animation preset.";

  const localPath = document.createElement("div");
  localPath.className = "card-local-path";
  if (animation.localPresent && !animation.repositoryPresent) {
    localPath.innerHTML = `
      <i class="fa-solid fa-folder-open"></i>
      <span>${escapeHtml(animation.localPath || animation.codeFileName || "animations")}</span>
    `;
  }

  const dateMeta = document.createElement("div");

  dateMeta.className = "card-date-meta";

  dateMeta.innerHTML = `
  <span>
    <i class="fa-regular fa-calendar"></i>
    Created ${formatDateTimeDDMMYY(animation.createdAt)}
  </span>

  ${
    animation.updatedAt && animation.updatedAt !== animation.createdAt
      ? `
        <span>
          <i class="fa-regular fa-clock"></i>
          Updated ${formatDateTimeDDMMYY(animation.updatedAt)}
        </span>
      `
      : ""
  }
`;

  const tagList = document.createElement("div");

  tagList.className = "tag-list";

  buildTags(animation).forEach((tag) => {
    const tagElement = document.createElement("span");

    tagElement.className = `tag ${tag.className}${tag.matched ? " filter-match" : ""}`;

    tagElement.innerHTML = `
        <i class="${escapeAttribute(tag.icon)}"></i>
        ${escapeHtml(tag.label)}
      `;

    tagList.appendChild(tagElement);
  });

  /*
   * ACTIONS
   */

  const actions = document.createElement("div");

  actions.className = "card-actions";

  const editButton = document.createElement("button");

  editButton.type = "button";

  editButton.className = "card-action";

  editButton.dataset.action = "edit";

  editButton.dataset.id = animation.id;

  editButton.innerHTML = `
      <i class="fa-solid fa-pen"></i>
      Edit
    `;

  actions.appendChild(editButton);

  if (!animation.codeSynced) {
    const pushButton = document.createElement("button");

    pushButton.type = "button";

    pushButton.className = "card-action code";

    pushButton.dataset.action = "push";

    pushButton.dataset.id = animation.id;

    pushButton.innerHTML = `
        <i class="fa-solid fa-folder-arrow-up"></i>
        ${animation.localPresent ? "Update local" : "Push to local"}
      `;

    actions.appendChild(pushButton);
  } else {
    const synced = document.createElement("span");

    synced.className = "code-synced";

    synced.innerHTML = `
      <i class="fa-solid fa-circle-check"></i>
        ${animation.repositoryPresent ? "Included" : "Local"}
      `;

    actions.appendChild(synced);
  }

  const detailsButton = document.createElement("button");

  detailsButton.type = "button";

  detailsButton.className = "card-action primary";

  detailsButton.dataset.action = "details";

  detailsButton.dataset.id = animation.id;

  detailsButton.innerHTML = `
      View details
      <i class="fa-solid fa-arrow-right"></i>
    `;

  actions.appendChild(detailsButton);

  content.appendChild(titleRow);

  content.appendChild(description);

  if (animation.localPresent) {
    content.appendChild(localPath);
  }

  content.appendChild(dateMeta);

  content.appendChild(tagList);

  content.appendChild(actions);

  card.appendChild(preview);

  card.appendChild(content);

  /*
   * Template animations carry their adjustable values as custom properties.
   * Only those are applied to the preview -- the rest of the class styles
   * belong to the exported animation, not to a card thumbnail.
   */
  String(animation.css || "")
    .split(";")
    .forEach((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return;

      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (!property.startsWith("--ms-") || !value) return;

      image.style.setProperty(property, value);
    });

  applyAnimation(image, animation);

  return card;
}
const categoryColors = {
  image: "tag-image",
  photo: "tag-photo",
  text: "tag-text",
  scale: "tag-scale",
  rotate: "tag-rotate",
  slide: "tag-slide",
  fade: "tag-fade",
  "3d": "tag-3d",
  spring: "tag-spring",
  magnetic: "tag-magnetic",
  elastic: "tag-elastic",
  timeline: "tag-timeline",
  scroll: "tag-scroll",
  parallax: "tag-parallax",
};
export function buildTags(animation) {
  const tags = [];

  const selectedFilters = state.selectedFilters || [];

  if (animation.device === "desktop" || animation.device === "both") {
    tags.push({
      label: "Desktop",
      className: "desktop",
      icon: "fa-solid fa-desktop",
      matched: selectedFilters.includes("desktop"),
    });
  }

  if (animation.device === "mobile" || animation.device === "both") {
    tags.push({
      label: "Mobile",
      className: "mobile",
      icon: "fa-solid fa-mobile-screen",
      matched: selectedFilters.includes("mobile"),
    });
  }

  if (animation.interaction) {
    const icons = {
      hover: "fa-solid fa-hand-pointer",
      infinite: "fa-solid fa-infinity",
      appear: "fa-solid fa-eye",
      disappear: "fa-solid fa-eye-slash",
      static: "fa-solid fa-pause",
    };

    tags.push({
      label:
        animation.interaction.charAt(0).toUpperCase() +
        animation.interaction.slice(1),

      className: `interaction-${animation.interaction}`,

      icon: icons[animation.interaction] || "fa-solid fa-wand-magic-sparkles",

      matched: selectedFilters.includes(animation.interaction),
    });
  }

  normalizeCategories(animation.categories).forEach((category) => {
    tags.push({
      label: category === "3d" ? "3D" : formatCategoryLabel(category),

      className: categoryColors[category] || "tag-default",

      icon: getCategoryIcon(category),

      matched: selectedFilters.includes(category),
    });
  });

  return tags;
}
