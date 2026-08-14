export const STORAGE_KEY = "motion-shelf.animations.session.v4";

export const state = {
  animations: [],

  selectedFilters: [],

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
