import { state } from "./state.js";

import {
  normalizeCategories,
  formatCategoryLabel,
  escapeHtml,
} from "./utils.js";

import { isFavourite } from "./favourites.js";
import { featuredVariants } from "./variant-groups.js";

import { createFolderPicker } from "./folder-picker.js";

import {
  ARCHIVES,
  animationArchives,
  animationFolders,
  animationCampaigns,
  archiveLabel,
  collectFolders,
  collectCampaigns,
} from "./origin.js";

/* The picker is a live component; renderFolderPicker needs the same render
   callback the filter chips use. */
let requestRender = () => {};

export function isQuarantinedAnimation(animation) {
  return animation?.audit?.status === "broken / quarantined";
}

export function initializeFilters({ filterList, searchInput, render }) {
  requestRender = render;

  filterList.addEventListener("click", (event) => {
    /* "Most used" reorders rather than narrows, so it is a sort chip and is
       kept out of selectedFilters -- otherwise it would count as one of the
       two allowed filters and quietly evict a real one. */
    const sortButton = event.target.closest("[data-sort]");

    if (sortButton) {
      const mode = sortButton.dataset.sort;

      state.sortMode = state.sortMode === mode ? DEFAULT_SORT : mode;

      render();
      return;
    }

    const button = event.target.closest("[data-filter]");

    if (!button) {
      return;
    }

    const filter = button.dataset.filter;

    if (filter === "all") {
      state.selectedFilters = [];
      state.sourceFolder = "";
      state.sourceCampaign = "";
      state.showAllVariants = false;
      render();
      return;
    }

    const index = state.selectedFilters.indexOf(filter);

    if (index !== -1) {
      state.selectedFilters.splice(index, 1);
    } else {
      if (state.selectedFilters.length >= 2) {
        state.selectedFilters.shift();
      }

      state.selectedFilters.push(filter);
    }

    /* The brand list belongs to one archive; leaving a stale brand selected
       while switching archives would silently empty the grid. */
    if (!activeArchive()) {
      state.sourceFolder = "";
      state.sourceCampaign = "";
    }

    render();
  });


  /*
   * A keystroke re-filters and re-renders the grid. Waiting for a pause in
   * the typing means "parallax" costs one render instead of nine.
   */
  let searchTimer = 0;

  searchInput.addEventListener("input", (event) => {
    state.searchTerm = event.target.value.trim().toLowerCase();

    clearTimeout(searchTimer);

    searchTimer = setTimeout(render, 140);
  });
}

export const DEFAULT_SORT = "name";

/*
 * How often an animation is actually used out in the campaigns. Sync records
 * it while it collapses duplicates; anything hand-made was written once and
 * counts as one, which puts customs at the bottom of a "Most used" list
 * rather than pretending they have a history.
 */
export function usageCount(animation) {
  const occurrences = Number(animation?.origin?.occurrences);

  return Number.isFinite(occurrences) && occurrences > 0 ? occurrences : 1;
}

function compareByName(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
    sensitivity: "base",
  });
}

function compareByOrder(a, b) {
  if (state.sortMode === "uses") {
    return usageCount(b) - usageCount(a) || compareByName(a, b);
  }

  return compareByName(a, b);
}

/*
 * Once you have narrowed to a section, your own picks come first inside it.
 *
 * This does not pull a favourite into a section it does not belong to -- the
 * filter still decides what is on screen, and this only decides the order of
 * what survived it. It is deliberately off in the All view, where the list is
 * already grouped by variant and a starred card is kept for that reason
 * instead.
 */
function compareForSort(a, b) {
  if (!isAllView()) {
    const lead = Number(isFavourite(b.id)) - Number(isFavourite(a.id));

    if (lead) return lead;
  }

  return compareByOrder(a, b);
}

/* Which archive chip is up, if any -- the brand dropdown belongs to it. */
export function activeArchive() {
  return ARCHIVES.map((archive) => archive.value)
    .find((value) => state.selectedFilters.includes(value)) || "";
}

/*
 * The chosen brand narrows on top of everything else rather than joining the
 * filter chips: it is a second axis, and it would otherwise eat one of the
 * two filter slots that the archive chip already occupies.
 */
function matchesFolder(animation) {
  if (state.sourceFolder && !animationFolders(animation, activeArchive()).has(state.sourceFolder)) return false;
  if (state.sourceCampaign && !animationCampaigns(animation, state.sourceFolder).has(state.sourceCampaign)) return false;
  return true;
}

export function isAllView() {
  return state.selectedFilters.length === 0 && !state.searchTerm && !state.sourceFolder && !state.sourceCampaign;
}

export function areVariantsCollapsed() {
  return isAllView() && !state.showAllVariants && !state.selectionMode;
}

export function getVisibleAnimations() {
  const matches = state.animations.filter((animation) => !isQuarantinedAnimation(animation)).filter(
    (animation) => matchesSearch(animation) && matchesFolder(animation),
  );

  if (state.selectedFilters.length === 0) {
    return (areVariantsCollapsed() ? featuredVariants(matches, isFavourite) : matches).sort(compareForSort);
  }

  if (state.selectedFilters.length === 1) {
    return matches
      .filter((animation) =>
        animationMatchesFilter(animation, state.selectedFilters[0]),
      )
      .sort(compareForSort);
  }

  const scored = matches
    .map((animation) => {
      const matchCount = state.selectedFilters.filter((filter) =>
        animationMatchesFilter(animation, filter),
      ).length;

      return {
        animation,
        matchCount,
      };
    })
    .filter((item) => item.matchCount > 0);

  /* With two filters up, how many of them an animation matches still comes
     first -- the chosen order decides between equals. */
  scored.sort((a, b) =>
    b.matchCount - a.matchCount || compareForSort(a.animation, b.animation),
  );

  return scored.map((item) => item.animation);
}

export function animationMatchesFilter(animation, filter) {
  if (filter === "favourite") {
    return isFavourite(animation.id);
  }

  /* Hand-made rather than imported: a synced animation always carries the
     origin block that says which archive it came from. */
  if (filter === "custom") {
    return !animation.origin;
  }

  if (filter === "local") {
    return Boolean(animation.localPresent);
  }

  if (filter === "campaigns" || filter === "previews-only") {
    return animationArchives(animation).has(filter);
  }

  const device = animation.device || "";

  const interaction = animation.interaction || "";

  const categories = normalizeCategories(animation.categories);

  if (filter === "desktop") {
    return device === "desktop" || device === "both";
  }

  if (filter === "mobile") {
    return device === "mobile" || device === "both";
  }

  if (filter === "3d" || filter === "three-d") {
    return categories.includes("3d");
  }

  return interaction === filter || categories.includes(filter);
}

function matchesSearch(animation) {
  if (!state.searchTerm) {
    return true;
  }

  const haystack = [
    animation.name,
    animation.description,
    animation.target,
    animation.device,
    animation.interaction,
    animation.animationName,
    ...normalizeCategories(animation.categories),
    animation.localPath,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(state.searchTerm);
}

/* All chips belong to the same wrapping list, so no filter is hidden behind
   a horizontal strip. Explanations are deliberately short: they supplement
   the visible label without making the tooltip a second interface. */
const FILTERS = [
  {
    value: "desktop", label: "Desktop", icon: "fa-solid fa-desktop", tooltip: "Designed for desktop screens",
  },
  {
    value: "mobile", label: "Mobile", icon: "fa-solid fa-mobile-screen", tooltip: "Designed for mobile screens",
  },
  {
    value: "favourite", label: "Favourite", icon: "fa-solid fa-star", tooltip: "Your saved effects",
  },
  {
    value: "local", label: "Local", icon: "fa-solid fa-hard-drive", tooltip: "Available on this computer",
  },
  {
    value: "custom", label: "Custom", icon: "fa-solid fa-pen-ruler", tooltip: "Created in Motion Shelf",
  },
  {
    value: "hover", label: "Hover", icon: "fa-solid fa-hand-pointer", tooltip: "Triggered on hover",
  },
  {
    value: "infinite", label: "Infinite", icon: "fa-solid fa-infinity", tooltip: "Loops continuously",
  },
  {
    value: "appear", label: "Appear", icon: "fa-solid fa-eye", tooltip: "Entrance animations",
  },
  {
    value: "disappear", label: "Disappear", icon: "fa-solid fa-eye-slash", tooltip: "Exit animations",
  },
  {
    value: "3d", label: "3D", icon: "fa-solid fa-cube", tooltip: "Perspective effects",
  },
];

const SOURCE_FILTERS = ARCHIVES.map((archive) => ({
  ...archive,
  tooltip: archive.value === "campaigns"
    ? "Filter by brand and campaign"
    : "Imported historical preview effects",
}));

const HIDDEN_FILTERS = new Set(["static", "image", "photo"]);

export function renderFilterButtons(filterList) {
  const filters = [...FILTERS];

  const taken = new Set([...FILTERS, ...SOURCE_FILTERS].map((filter) => filter.value));

  getAllCategories().forEach((category) => {
    if (taken.has(category) || HIDDEN_FILTERS.has(category)) {
      return;
    }

    taken.add(category);

    filters.push({
      value: category,
      label: formatCategoryLabel(category),
      icon: getCategoryIcon(category),
      tooltip: categoryExplanation(category),
    });
  });

  filterList.innerHTML = "";

  const primaryRow = document.createElement("div");
  primaryRow.className = "filter-row filter-row-primary";

  const categoryRow = document.createElement("div");
  categoryRow.className = "filter-row filter-row-categories";

  const allButton = createFilterButton(
    "all", "All", "fa-solid fa-layer-group", state.selectedFilters.length === 0,
  );
  primaryRow.appendChild(allButton);

  /* Source controls always finish the first row. Animation categories begin
     their own row, even when the desktop has room for more chips. */
  const primaryFilters = filters.slice(0, 3);
  const libraryFilters = filters.slice(3, 5);
  const remainingFilters = filters.slice(5);

  primaryFilters.forEach((filter) => {
    primaryRow.appendChild(
      createFilterButton(
        filter.value,
        filter.label,
        filter.icon,
        state.selectedFilters.includes(filter.value),
        filter.tooltip,
      ),
    );
  });

  primaryRow.appendChild(
    createSortButton(
      "uses", "Most used", "fa-solid fa-fire", state.sortMode === "uses",
    ),
  );

  libraryFilters.forEach((filter) => {
    primaryRow.appendChild(
      createFilterButton(
        filter.value,
        filter.label,
        filter.icon,
        state.selectedFilters.includes(filter.value),
        filter.tooltip,
      ),
    );
  });

  SOURCE_FILTERS.forEach((filter) => {
    primaryRow.appendChild(
      createFilterButton(
        filter.value,
        filter.label,
        filter.icon,
        state.selectedFilters.includes(filter.value),
        filter.tooltip,
      ),
    );
  });

  remainingFilters.forEach((filter) => {
    categoryRow.appendChild(
      createFilterButton(
        filter.value,
        filter.label,
        filter.icon,
        state.selectedFilters.includes(filter.value),
        filter.tooltip,
      ),
    );
  });

  filterList.append(primaryRow, categoryRow);

  renderFolderPicker(filterList);
}

/*
 * The brand picker. Both archives are organised the same way -- one folder
 * per brand or campaign -- so choosing an archive chip reveals a searchable
 * dropdown of the folders actually present in the library, with how many
 * animations came out of each.
 */
let brandPicker = null;
let campaignPicker = null;

function renderFolderPicker(filterList) {
  const archive = activeArchive();
  if (archive !== "campaigns") return;
  const folders = collectFolders(state.animations, archive);
  const campaigns = collectCampaigns(state.animations, state.sourceFolder);
  if (!folders.length && !campaigns.length) return;

  const extras = document.createElement("div");

  extras.className = "filter-extras";

  if (archive && folders.length) {
    const current = folders.some((entry) => entry.folder === state.sourceFolder) ? state.sourceFolder : "";
    if (current !== state.sourceFolder) state.sourceFolder = current;
    brandPicker = createFolderPicker({
      label: archive === "campaigns" ? "Brand" : archiveLabel(archive),
      options: folders,
      value: current,
      onSelect: (folder) => { state.sourceFolder = folder; state.sourceCampaign = ""; requestRender(); },
    });
    extras.appendChild(brandPicker);
  }

  if (campaigns.length) {
    const current = campaigns.some((entry) => entry.folder === state.sourceCampaign) ? state.sourceCampaign : "";
    if (current !== state.sourceCampaign) state.sourceCampaign = current;
    campaignPicker = createFolderPicker({
      label: "Campaign",
      options: campaigns,
      value: current,
      onSelect: (campaign) => { state.sourceCampaign = campaign; requestRender(); },
    });
    extras.appendChild(campaignPicker);
  }

  filterList.appendChild(extras);
}

export function getAllCategories() {
  const categories = new Set();

  state.animations.filter((animation) => !isQuarantinedAnimation(animation)).forEach((animation) => {
    normalizeCategories(animation.categories).forEach((category) =>
      categories.add(category),
    );
  });

  return [...categories].sort();
}

export function getCategoryIcon(category) {
  const icons = {
    text: "fa-solid fa-font",
    scale: "fa-solid fa-expand",
    rotate: "fa-solid fa-rotate",
    slide: "fa-solid fa-arrows-left-right",
    fade: "fa-solid fa-wand-magic-sparkles",

    "3d": "fa-solid fa-cube",

    spring: "fa-solid fa-arrows-spin",
    magnetic: "fa-solid fa-magnet",
    elastic: "fa-solid fa-arrows-to-circle",
    timeline: "fa-solid fa-timeline",
    scroll: "fa-solid fa-scroll",
    parallax: "fa-solid fa-layer-group",
  };

  return icons[category] || "fa-solid fa-tag";
}

function categoryExplanation(category) {
  const explanations = {
    hover: "Runs when hovered",
    infinite: "Repeats continuously",
    appear: "Enters into view",
    disappear: "Exits from view",
    "3d": "Uses depth and perspective",
    spring: "Overshoots then settles",
    magnetic: "Pulls toward a target",
    elastic: "Stretches then rebounds",
    timeline: "Plays staged motion sequence",
    scroll: "Responds to page scrolling",
    parallax: "Moves with depth scrolling",
    shake: "Rapid side movement",
    bounce: "Repeated impact motion",
    pulse: "Repeated scale or opacity beat",
    blink: "Repeated visibility change",
    fade: "Gradually changes opacity",
    scale: "Grows or shrinks",
    rotate: "Turns around an axis",
    slide: "Moves across the frame",
    text: "Animates text elements",
  };

  return explanations[category] || "Changes visual motion behavior";
}

function createSortButton(value, label, icon, active) {
  const button = createFilterButton(value, label, icon, active, "Sort by usage");

  delete button.dataset.filter;

  button.dataset.sort = value;

  button.classList.add("filter-sort");

  button.setAttribute("aria-pressed", active ? "true" : "false");

  return button;
}

function createFilterButton(value, label, icon, active, tooltip = "") {
  const button = document.createElement("button");

  button.type = "button";

  button.className = "filter-button";

  button.dataset.filter = value;

  button.classList.toggle("active", active);

  if (tooltip) {
    button.dataset.tooltip = tooltip;
    button.setAttribute("aria-label", `${label}: ${tooltip}`);
  }

  button.innerHTML = `
      <i class="${icon}"></i>
      <span>${label}</span>
    `;

  return button;
}
