export const STORAGE_KEY = "motion-shelf.animations.session.v4";

export const state = {
  animations: [],

  selectedFilters: [],

  /* "name" (A to Z, the default) or "uses" (most used first). Sorting is a
     separate axis from filtering, so the two never fight over a slot. */
  sortMode: "name",
  showAllVariants: false,

  /* The brand/campaign folder picked inside an archive filter. Empty means
     every folder in that archive. */
  sourceFolder: "",

  searchTerm: "",

  selectionMode: false,

  selectedIds: new Set(),

  editingId: null,

  detailId: null,

  toastTimer: null,

  editorDrafts: new Map(),

  projectHandle: null,

  projectName: "",

  projectPermission: "unlinked",

  projectBusy: false,
};
