/*
 * The archive folder picker.
 *
 * A native <select> is fine for four options and useless for four hundred:
 * the archives hold one folder per brand, and finding "Volkswagen" in a
 * system menu means scrolling it blind. This is a small combobox instead --
 * a trigger, a panel, and a search field that filters the list as you type --
 * driven by the keyboard as well as the mouse.
 *
 * It owns its open/query/highlight state and nothing else; the chosen folder
 * lives in the app's state, and is reported through onSelect.
 */

import { escapeHtml } from "./utils.js";

const ALL = "";

export function createFolderPicker({ label, options, value, onSelect }) {
  const root = document.createElement("div");

  root.className = "folder-picker";

  const trigger = document.createElement("button");

  trigger.type = "button";
  trigger.className = "folder-picker-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");

  panel.className = "folder-picker-panel";
  panel.hidden = true;

  const search = document.createElement("input");

  search.type = "search";
  search.className = "folder-picker-search";
  search.placeholder = "Search folders...";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("aria-label", "Search folders");

  const list = document.createElement("div");

  list.className = "folder-picker-list";
  list.setAttribute("role", "listbox");

  const searchWrap = document.createElement("div");

  searchWrap.className = "folder-picker-search-wrap";
  searchWrap.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
  searchWrap.appendChild(search);

  panel.append(searchWrap, list);
  root.append(trigger, panel);

  let current = { label, options, value };
  let query = "";
  let highlighted = 0;
  let open = false;
  let visible = [];

  const allOption = () => ({
    folder: ALL,
    name: "All folders",
    count: current.options.reduce((total, option) => total + option.count, 0),
  });

  const entries = () => [
    allOption(),
    ...current.options.map((option) => ({ ...option, name: option.folder })),
  ];

  const matching = () => {
    const needle = query.trim().toLowerCase();

    if (!needle) return entries();

    /* The "All folders" row is a command, not a folder, so it stays out of
       the results as soon as you are actually searching for something. */
    return entries()
      .slice(1)
      .filter((entry) => entry.name.toLowerCase().includes(needle));
  };

  function renderTrigger() {
    const chosen = current.options.find((option) => option.folder === current.value);

    trigger.classList.toggle("is-chosen", Boolean(chosen));

    trigger.innerHTML = `
      <i class="fa-solid fa-folder-tree"></i>

      <span class="folder-picker-label">${escapeHtml(current.label)}</span>

      <span class="folder-picker-value">${escapeHtml(chosen ? chosen.folder : "All folders")}</span>

      <span class="folder-picker-count">${chosen ? chosen.count : current.options.length}</span>

      <i class="fa-solid fa-chevron-down folder-picker-caret"></i>
    `;
  }

  function renderList() {
    visible = matching();

    if (!visible.length) {
      list.innerHTML = `
        <p class="folder-picker-empty">
          No folder matches <b>${escapeHtml(query.trim())}</b>.
        </p>
      `;
      return;
    }

    highlighted = Math.min(highlighted, visible.length - 1);

    list.innerHTML = visible
      .map((entry, index) => `
        <button
          type="button"
          role="option"
          class="folder-picker-option${entry.folder === current.value ? " is-selected" : ""}${index === highlighted ? " is-highlighted" : ""}"
          data-folder="${escapeHtml(entry.folder)}"
          aria-selected="${entry.folder === current.value ? "true" : "false"}"
        >
          <i class="fa-solid fa-check folder-picker-tick"></i>
          <span class="folder-picker-name">${escapeHtml(entry.name)}</span>
          <span class="folder-picker-option-count">${entry.count}</span>
        </button>
      `)
      .join("");
  }

  function scrollHighlightIntoView() {
    const option = list.children[highlighted];

    if (option && option.scrollIntoView) {
      option.scrollIntoView({ block: "nearest" });
    }
  }

  function move(step) {
    if (!visible.length) return;

    highlighted = (highlighted + step + visible.length) % visible.length;

    renderList();
    scrollHighlightIntoView();
  }

  function choose(folder) {
    setOpen(false);

    if (folder === current.value) return;

    onSelect(folder);
  }

  /* Only bound while the panel is open, so a closed picker costs nothing. */
  const onDocumentPointerDown = (event) => {
    if (!root.contains(event.target)) setOpen(false);
  };

  function setOpen(next) {
    if (open === next) return;

    open = next;

    panel.hidden = !open;
    root.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      query = "";
      search.value = "";
      highlighted = Math.max(0, matching().findIndex((entry) => entry.folder === current.value));
      renderList();

      document.addEventListener("pointerdown", onDocumentPointerDown, true);

      /* After the panel is actually painted, or Safari drops the focus. */
      requestAnimationFrame(() => search.focus());
      return;
    }

    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }

  trigger.addEventListener("click", () => setOpen(!open));

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  });

  search.addEventListener("input", () => {
    query = search.value;
    highlighted = 0;
    renderList();
  });

  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }

    if (event.key === "Enter") {
      event.preventDefault();

      const entry = visible[highlighted];

      if (entry) choose(entry.folder);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    }
  });

  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-folder]");

    if (option) choose(option.dataset.folder);
  });

  list.addEventListener("pointermove", (event) => {
    const option = event.target.closest("[data-folder]");

    if (!option) return;

    const index = [...list.children].indexOf(option);

    if (index === highlighted || index < 0) return;

    list.children[highlighted]?.classList.remove("is-highlighted");
    highlighted = index;
    option.classList.add("is-highlighted");
  });

  renderTrigger();

  /* Lets a re-render hand the same element a new folder list instead of
     replacing it -- which would close the panel mid-search. */
  root.update = (next) => {
    current = { ...current, ...next };

    renderTrigger();

    if (open) renderList();
  };

  root.close = () => setOpen(false);

  return root;
}
