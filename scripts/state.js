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

  sourceCampaign: "",

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

/*
 * WHO IS CURRENTLY OCCUPYING THE PROJECT FOLDER
 *
 * Restoring the link at startup, linking a new folder and every queued write
 * all make the workspace busy, and they overlap. A single boolean could not
 * express two holders at once: a write saved the flag as it found it and put
 * that value back when it finished, so a push begun during startup restored
 * "busy" after startup had already cleared it, leaving the header reporting a
 * read that was over and both buttons disabled until something else ran.
 *
 * Counting holders answers it without anyone having to remember a value: the
 * workspace is busy while at least one holder has it.
 */
let projectBusyHolders = 0;

export function beginProjectBusy() {
  projectBusyHolders += 1;
  state.projectBusy = true;
}

export function endProjectBusy() {
  projectBusyHolders = Math.max(0, projectBusyHolders - 1);
  state.projectBusy = projectBusyHolders > 0;
}
