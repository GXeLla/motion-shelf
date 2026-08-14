import { state } from "./state.js";

import {
  escapeAttribute,
  escapeHtml,
  formatCategoryLabel,
  normalizeCategories,
  formatDateTimeDDMMYY,
} from "./utils.js";

import { applyAnimation, createPreviewImage } from "./animations.js";

import { getCategoryIcon, animationMatchesFilter } from "./filters.js";

export function renderCards(animationGrid, animations) {
  animationGrid.innerHTML = "";

  animations.forEach((animation) => {
    animationGrid.appendChild(createCard(animation));
  });
}

export function createCard(animation) {
  const card = document.createElement("article");

  card.className = "animation-card";

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

  const actualImage = animation.imageUrl;

  image.src = actualImage || createPreviewImage(animation);

  image.onerror = () => {
    image.src = createPreviewImage(animation);
  };

  applyAnimation(image, animation);

  if (animation.target !== "img" && actualImage) {
    image.style.backgroundImage = `url("${actualImage}")`;

    image.style.backgroundSize = "cover";

    image.style.backgroundPosition = "center";

    image.style.objectFit = "cover";
  }

  preview.appendChild(image);

  const safeFrame = document.createElement("div");
  safeFrame.className = "safe-frame";
  safeFrame.setAttribute("aria-hidden", "true");
  preview.appendChild(safeFrame);

  const copyHint = document.createElement("span");
  copyHint.className = "card-copy-hint";
  copyHint.innerHTML = '<i class="fa-solid fa-copy"></i> Click card to copy CSS';
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

  if (animation.localPresent) {
    const localBadge = document.createElement("span");
    localBadge.className = "local-source-badge";
    localBadge.dataset.tooltip = animation.localPath || "Saved in the linked animations folder";
    localBadge.innerHTML = '<i class="fa-solid fa-hard-drive"></i> LOCAL';
    titleRow.appendChild(localBadge);
  }

  const description = document.createElement("p");

  description.className = "card-description";

  description.textContent =
    animation.description || "Reusable CSS animation preset.";

  const localPath = document.createElement("div");
  localPath.className = "card-local-path";
  if (animation.localPresent) {
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
        Local
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

function isTagFiltered(animation, filter) {
  return (
    state.selectedFilters.includes(filter) &&
    animationMatchesFilter(animation, filter)
  );
}
