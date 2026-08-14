import { state } from "./state.js";

import { normalizeCategories, formatCategoryLabel } from "./utils.js";

export function initializeFilters({ filterList, searchInput, render }) {
  filterList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");

    if (!button) {
      return;
    }

    const filter = button.dataset.filter;

    if (filter === "all") {
      state.selectedFilters = [];
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

    render();
  });

  searchInput.addEventListener("input", (event) => {
    state.searchTerm = event.target.value.trim().toLowerCase();

    render();
  });
}

export function getVisibleAnimations() {
  const matches = state.animations.filter(matchesSearch);

  if (state.selectedFilters.length === 0) {
    return matches;
  }

  if (state.selectedFilters.length === 1) {
    return matches.filter((animation) =>
      animationMatchesFilter(animation, state.selectedFilters[0]),
    );
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

  scored.sort((a, b) => b.matchCount - a.matchCount);

  return scored.map((item) => item.animation);
}

export function animationMatchesFilter(animation, filter) {
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
    animation.imageUrl,
    animation.localPath,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(state.searchTerm);
}

export function renderFilterButtons(filterList) {
  const categories = getAllCategories();

  const filters = [
    {
      value: "desktop",
      label: "Desktop",
      icon: "fa-solid fa-desktop",
    },

    {
      value: "mobile",
      label: "Mobile",
      icon: "fa-solid fa-mobile-screen",
    },

    {
      value: "hover",
      label: "Hover",
      icon: "fa-solid fa-hand-pointer",
    },

    {
      value: "infinite",
      label: "Infinite",
      icon: "fa-solid fa-infinity",
    },

    {
      value: "appear",
      label: "Appear",
      icon: "fa-solid fa-eye",
    },

    {
      value: "disappear",
      label: "Disappear",
      icon: "fa-solid fa-eye-slash",
    },

    {
      value: "static",
      label: "Static",
      icon: "fa-solid fa-pause",
    },

    {
      value: "3d",
      label: "3D",
      icon: "fa-solid fa-cube",
    },
  ];

  categories.forEach((category) => {
    if (filters.some((filter) => filter.value === category)) {
      return;
    }

    filters.push({
      value: category,
      label: formatCategoryLabel(category),
      icon: getCategoryIcon(category),
    });
  });

  filterList.innerHTML = "";

  filterList.appendChild(
    createFilterButton(
      "all",
      "All",
      "fa-solid fa-layer-group",
      state.selectedFilters.length === 0,
    ),
  );

  filters.forEach((filter) => {
    filterList.appendChild(
      createFilterButton(
        filter.value,
        filter.label,
        filter.icon,
        state.selectedFilters.includes(filter.value),
      ),
    );
  });
}

export function getAllCategories() {
  const categories = new Set();

  state.animations.forEach((animation) => {
    normalizeCategories(animation.categories).forEach((category) =>
      categories.add(category),
    );
  });

  return [...categories].sort();
}

export function getCategoryIcon(category) {
  const icons = {
    image: "fa-solid fa-image",
    photo: "fa-solid fa-image",
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

function createFilterButton(value, label, icon, active) {
  const button = document.createElement("button");

  button.type = "button";

  button.className = "filter-button";

  button.dataset.filter = value;

  button.classList.toggle("active", active);

  button.innerHTML = `
      <i class="${icon}"></i>
      <span>${label}</span>
    `;

  return button;
}
