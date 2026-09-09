import { state } from "./state.js";
import { initializeAmbientBackground } from "./background.js";
import { connectProject, ensureProjectHandle, restoreProjectLink, supportsProjectFolders } from "./filesystem.js";
import { CONTRIBUTORS, createTaskId, formatTaskDate, normalizeTask } from "./task-config.js";
import { loadMilestoneCache, loadTaskCache, loadTasksFromLinkedProject, saveMilestoneCache, saveTaskCache, writeTasksToLinkedProject } from "./task-storage.js";
import { copyText } from "./code.js";

const taskState = { tasks: loadTaskCache(), milestones: loadMilestoneCache(), view: "board", filter: "all", search: "", quick: new Set(), dirty: false, editingId: null, editingMilestoneId: null, deletingId: null, deletingMilestoneId: null, menuId: null, dragId: null, dragPreview: null, draggingMilestone: null };
const $ = (id) => document.getElementById(id);
const board = $("taskBoard");
const milestoneBoard = $("milestoneBoard");
const editorBackdrop = $("taskEditorBackdrop");
const deleteBackdrop = $("taskDeleteBackdrop");
const rulesBackdrop = $("taskRulesBackdrop");
const form = $("taskForm");
const milestoneEditorBackdrop = $("milestoneEditorBackdrop");
const milestoneDeleteBackdrop = $("milestoneDeleteBackdrop");
const milestoneForm = $("milestoneForm");
const milestoneTaskFields = $("milestoneTaskFields");
const milestoneImportInput = $("milestoneImportInput");
let toastTimer;
let boardHasRendered = false;

initializeAmbientBackground();
setupControls();
initializeProject();

function setupControls() {
  $("newTaskButton").addEventListener("click", () => openEditor());
  $("taskRulesButton").addEventListener("click", openRules);
  document.querySelector(".task-view-tabs").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (!button) return; taskState.view = button.dataset.view; render(); });
  milestoneBoard.addEventListener("click", (event) => { const button = event.target.closest("[data-milestone-action]"); if (!button) return; if (button.dataset.milestoneAction === "new") openMilestoneEditor(); if (button.dataset.milestoneAction === "import") milestoneImportInput.click(); if (button.dataset.milestoneAction === "edit") openMilestoneEditor(button.dataset.milestoneId); });
  $("pushTasksButton").addEventListener("click", pushTasks);
  $("taskSearch").addEventListener("input", (event) => { taskState.search = event.target.value.trim().toLowerCase(); render(); });
  $("taskFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (button) { taskState.filter = button.dataset.filter; render(); } });
  document.querySelector(".task-toggle-group").addEventListener("click", (event) => { const button = event.target.closest("[data-quick-filter]"); if (!button) return; const key = button.dataset.quickFilter; taskState.quick.has(key) ? taskState.quick.delete(key) : taskState.quick.add(key); render(); });
  board.addEventListener("click", onBoardClick);
  board.addEventListener("dblclick", () => {});
  board.addEventListener("pointerdown", (event) => {
    const menu = event.target.closest(".task-menu-wrap");
    const card = menu?.closest("[data-task-id]");
    if (!card) return;

    // Native drag detection begins on the draggable card before dragstart
    // identifies the nested menu target. Disable it for this pointer gesture.
    card.draggable = false;
    const restoreDrag = () => { card.draggable = true; };
    window.addEventListener("pointerup", restoreDrag, { once: true });
    window.addEventListener("pointercancel", restoreDrag, { once: true });
  });
  board.addEventListener("dragstart", onDragStart);
  board.addEventListener("dragend", clearDrag);
  board.addEventListener("dragover", (event) => { const lane = event.target.closest("[data-lane]"); if (!lane || !taskState.dragId) return; event.preventDefault(); lane.classList.add("is-drop-target"); });
  board.addEventListener("dragleave", (event) => { const lane = event.target.closest("[data-lane]"); if (lane && !lane.contains(event.relatedTarget)) lane.classList.remove("is-drop-target"); });
  board.addEventListener("drop", onDrop);
  milestoneBoard.addEventListener("dragstart", (event) => { const card = event.target.closest("[data-milestone-id]"); if (!card) return; taskState.draggingMilestone = card.dataset.milestoneId; event.dataTransfer.effectAllowed = "move"; });
  milestoneBoard.addEventListener("dragover", (event) => event.preventDefault());
  milestoneBoard.addEventListener("drop", (event) => { const target = event.target.closest("[data-milestone-id]"); if (!target || !taskState.draggingMilestone || target.dataset.milestoneId === taskState.draggingMilestone) return; const from = taskState.milestones.findIndex((item) => item.id === taskState.draggingMilestone); const to = taskState.milestones.findIndex((item) => item.id === target.dataset.milestoneId); taskState.milestones.splice(to, 0, taskState.milestones.splice(from, 1)[0]); taskState.draggingMilestone = null; markDirty(); render(); showToast("Milestone order updated."); });
  $("taskEditorClose").addEventListener("click", closeEditor);
  $("taskEditorCancel").addEventListener("click", closeEditor);
  $("taskDeleteClose").addEventListener("click", closeDelete);
  $("taskDeleteCancel").addEventListener("click", closeDelete);
  $("taskDeleteConfirm").addEventListener("click", deleteTask);
  $("taskRulesClose").addEventListener("click", closeRules);
  $("taskRulesDone").addEventListener("click", closeRules);
  $("milestoneEditorClose").addEventListener("click", closeMilestoneEditor);
  $("milestoneEditorCancel").addEventListener("click", closeMilestoneEditor);
  $("milestoneDeleteButton").addEventListener("click", openMilestoneDelete);
  $("milestoneDeleteClose").addEventListener("click", closeMilestoneDelete);
  $("milestoneDeleteCancel").addEventListener("click", closeMilestoneDelete);
  $("milestoneDeleteConfirm").addEventListener("click", deleteMilestone);
  $("addMiniTaskButton").addEventListener("click", () => addMiniTaskField());
  milestoneTaskFields.addEventListener("click", (event) => { const button = event.target.closest("[data-remove-mini-task]"); if (button) button.closest(".milestone-task-field").remove(); });
  editorBackdrop.addEventListener("click", (event) => { if (event.target === editorBackdrop) closeEditor(); });
  deleteBackdrop.addEventListener("click", (event) => { if (event.target === deleteBackdrop) closeDelete(); });
  rulesBackdrop.addEventListener("click", (event) => { if (event.target === rulesBackdrop) closeRules(); });
  milestoneEditorBackdrop.addEventListener("click", (event) => { if (event.target === milestoneEditorBackdrop) closeMilestoneEditor(); });
  milestoneDeleteBackdrop.addEventListener("click", (event) => { if (event.target === milestoneDeleteBackdrop) closeMilestoneDelete(); });
  form.addEventListener("submit", saveEditor);
  milestoneForm.addEventListener("submit", saveMilestoneEditor);
  milestoneImportInput.addEventListener("change", importMilestones);
  document.addEventListener("click", (event) => { if (!event.target.closest(".task-menu-wrap")) closeMenu(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); if (!editorBackdrop.hidden) closeEditor(); if (!deleteBackdrop.hidden) closeDelete(); if (!rulesBackdrop.hidden) closeRules(); if (!milestoneEditorBackdrop.hidden) closeMilestoneEditor(); if (!milestoneDeleteBackdrop.hidden) closeMilestoneDelete(); } });
  $("projectLinkButton").addEventListener("click", () => linkProject(false));
  $("projectChangeButton").addEventListener("click", () => linkProject(true));
}

async function initializeProject() {
  if (!supportsProjectFolders()) { state.projectPermission = "unsupported"; updateProjectUi(); return; }
  state.projectBusy = true; updateProjectUi();
  try {
    const handle = await restoreProjectLink();
    if (handle) {
      const local = await loadTasksFromLinkedProject(getTasksDirectory);
      if (local) { taskState.tasks = local.tasks; taskState.milestones = local.milestones; taskState.dirty = false; saveTaskCache(local.tasks); saveMilestoneCache(local.milestones); }
    } else if (!taskState.tasks.length) await loadStaticTasks();
  } catch (error) { console.warn("Could not load tasks:", error); showToast("Could not read local tasks.", true); }
  finally { state.projectBusy = false; updateProjectUi(); render(); }
}

async function loadStaticTasks() {
  try { const response = await fetch("./tasks/tasks.json", { cache: "no-store" }); if (response.ok) { const { parseTaskWorkspace } = await import("./task-storage.js"); const workspace = parseTaskWorkspace(await response.text()); taskState.tasks = workspace.tasks; taskState.milestones = workspace.milestones; saveTaskCache(workspace.tasks); saveMilestoneCache(workspace.milestones); } } catch { /* A missing hosted task file is an empty first-use board. */ }
}

async function linkProject(changeFolder) {
  if (state.projectBusy) return;
  state.projectBusy = true; updateProjectUi();
  try { await connectProject({ changeFolder }); const local = await loadTasksFromLinkedProject(getTasksDirectory); if (local && !taskState.dirty) { taskState.tasks = local.tasks; taskState.milestones = local.milestones; saveTaskCache(local.tasks); saveMilestoneCache(local.milestones); showToast("Loaded tasks from the linked project."); } else if (taskState.dirty) showToast("Project linked. Your unsaved task changes were kept."); }
  catch (error) { if (error?.name !== "AbortError") showToast(error?.name === "NotAllowedError" ? "Folder permission was not granted." : "Could not link the project.", true); }
  finally { state.projectBusy = false; updateProjectUi(); render(); }
}

async function getTasksDirectory({ create }) { const root = await ensureProjectHandle(); return root.getDirectoryHandle("tasks", { create }); }

function updateProjectUi() {
  const icon = $("projectLink").querySelector(".project-link-icon");
  $("projectLinkButton").disabled = state.projectBusy; $("projectChangeButton").disabled = state.projectBusy;
  if (state.projectBusy) { $("projectLinkTitle").textContent = "Reading project"; $("projectLinkPath").textContent = "Checking folder access…"; icon.innerHTML = '<i class="fa-solid fa-spinner"></i>'; return; }
  if (state.projectPermission === "unsupported") { $("projectLinkTitle").textContent = "Folder access unavailable"; $("projectLinkPath").textContent = "Use Chrome or Edge on localhost"; return; }
  if (state.projectHandle && state.projectPermission === "granted") { $("projectLinkTitle").textContent = taskState.dirty ? "Unsaved task changes" : "Tasks synced locally"; $("projectLinkPath").textContent = `${state.projectName}/tasks`; icon.innerHTML = `<i class="fa-solid ${taskState.dirty ? "fa-pen-to-square" : "fa-folder-check"}"></i>`; $("projectChangeButton").hidden = false; return; }
  $("projectLinkTitle").textContent = state.projectHandle ? "Reconnect project" : "Link project"; $("projectLinkPath").textContent = "Choose the folder containing index.html"; $("projectChangeButton").hidden = !state.projectHandle;
}

function render() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === taskState.view));
  board.hidden = taskState.view !== "board";
  milestoneBoard.hidden = taskState.view !== "milestones";
  $("taskEmptyState").hidden = taskState.view !== "board";
  if (taskState.view === "milestones") { renderMilestones(); updateProjectUi(); return; }
  renderFilters();
  const visible = getVisibleTasks();
  const showCompleted = taskState.quick.has("completed");
  const lanes = [...CONTRIBUTORS, null];
  board.classList.toggle("is-initialized", boardHasRendered);
  board.innerHTML = lanes.map((assignee) => {
    const laneTasks = visible.filter((task) => task.assignee === assignee).sort(sortTasks);
    const allCount = taskState.tasks.filter((task) => task.assignee === assignee && task.completed === showCompleted).length;
    const name = assignee || "Unassigned";
    return `<article class="task-lane" data-lane="${assignee || "unassigned"}"><header class="task-lane-header"><div><span class="task-lane-eyebrow">${assignee ? "CONTRIBUTOR" : "OPEN QUEUE"}</span><h3>${name}</h3></div><span class="task-lane-count">${allCount}</span></header><div class="task-lane-dropzone">${laneTasks.map(renderCard).join("") || `<div class="task-lane-empty">${showCompleted ? "No completed tasks" : "Drop a task here"}</div>`}</div></article>`;
  }).join("");
  boardHasRendered = true;
  $("taskResultCount").textContent = `${visible.length} ${visible.length === 1 ? "task" : "tasks"} shown`;
  $("taskEmptyState").hidden = visible.length !== 0;
  $("pushTasksButton").innerHTML = `<i class="fa-solid fa-folder-arrow-up"></i><span>${taskState.dirty ? "Update tasks locally" : "Push tasks to local"}</span>`;
  updateProjectUi();
}

function renderMilestones() {
  const milestoneCards = taskState.milestones.map((milestone) => {
    const milestoneTasks = taskState.tasks.filter((task) => task.milestoneId === milestone.id);
    const total = milestoneTasks.length;
    const done = milestoneTasks.filter((task) => task.completed).length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return `<article class="milestone-card ${percent === 100 && total ? "is-complete" : ""}" draggable="true" data-milestone-id="${milestone.id}"><header><div><span class="eyebrow"><i class="fa-solid fa-grip-lines"></i> WORKSTREAM${milestone.assignee ? ` · ${escape(milestone.assignee)}` : ""}</span><h3>${escape(milestone.title)}</h3></div><div class="milestone-card-actions"><strong>${percent}%</strong><button type="button" data-milestone-action="edit" data-milestone-id="${milestone.id}" aria-label="Edit ${escape(milestone.title)}"><i class="fa-solid fa-pen"></i> Edit</button></div></header><p>${escape(milestone.description)}</p><div class="milestone-progress" aria-label="${percent}% complete"><span style="width: ${percent}%"></span></div><div class="mini-task-list">${milestoneTasks.map((task) => `<div class="mini-task ${task.completed ? "done" : ""}"><span>${escape(task.title)}</span><i class="fa-solid ${task.completed ? "fa-check" : "fa-circle"}"></i></div>`).join("") || '<div class="mini-task-empty">No tasks yet — use Edit to add one.</div>'}</div><footer>${done} of ${total} tasks complete${percent === 100 && total ? " · Ready to close" : " · Update completion on the board"}</footer></article>`;
  }).join("") || `<div class="task-lane-empty">No milestones yet. Create one to start grouping work.</div>`;
  milestoneBoard.innerHTML = `<header class="milestone-board-toolbar"><div><span class="eyebrow"><i class="fa-solid fa-flag-checkered"></i> WORKSTREAMS</span><p>Create or import milestones to organize related board tasks.</p></div><div class="milestone-board-actions"><button class="button secondary" type="button" data-milestone-action="import"><i class="fa-solid fa-file-import"></i> Import JSON</button><button class="button primary" type="button" data-milestone-action="new"><i class="fa-solid fa-plus"></i> New Milestone</button></div></header>${milestoneCards}`;
  $("taskResultCount").textContent = `${taskState.milestones.length} ${taskState.milestones.length === 1 ? "milestone" : "milestones"}`;
}

function renderFilters() {
  const filters = [["all", "All"], ["unassigned", "Unassigned"], ...CONTRIBUTORS.map((name) => [name, name])];
  $("taskFilters").innerHTML = filters.map(([value, label]) => `<button class="task-filter ${taskState.filter === value ? "active" : ""}" data-filter="${value}" type="button">${label}</button>`).join("");
  document.querySelectorAll("[data-quick-filter]").forEach((button) => button.classList.toggle("active", taskState.quick.has(button.dataset.quickFilter)));
}

function getVisibleTasks() {
  const completed = taskState.quick.has("completed");
  return taskState.tasks.filter((task) => {
    const matchesFilter = taskState.filter === "all" || (taskState.filter === "unassigned" ? !task.assignee : task.assignee === taskState.filter);
    const text = `${task.title} ${task.description} ${task.assignee || "unassigned"}`.toLowerCase();
    return matchesFilter && task.completed === completed && (!taskState.quick.has("favorite") || task.favorite) && (!taskState.quick.has("important") || task.important) && (!taskState.search || text.includes(taskState.search));
  });
}

function sortTasks(a, b) {
  const priority = (task) => task.important ? 0 : task.favorite ? 2 : 1;
  return priority(a) - priority(b) || new Date(b.updatedAt) - new Date(a.updatedAt);
}
function escape(value) { const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML; }

function renderCard(task) {
  const menuOpen = taskState.menuId === task.id;
  const milestone = taskState.milestones.find((item) => item.id === task.milestoneId);
  return `<article class="task-card assignee-${assigneeClass(task.assignee)} ${task.important ? "is-important" : ""} ${task.completed ? "is-completed" : ""} ${menuOpen ? "is-menu-open" : ""}" draggable="true" data-task-id="${task.id}"><div class="task-card-top"><div class="task-card-badges">${milestone ? `<span class="task-badge milestone"><i class="fa-solid fa-flag-checkered"></i> ${escape(milestone.title)}</span>` : ""}${task.important ? '<span class="task-badge important"><i class="fa-solid fa-flag"></i> Important</span>' : ""}${task.favorite ? '<span class="task-star" title="Favorite"><i class="fa-solid fa-star"></i></span>' : ""}</div><div class="task-menu-wrap" draggable="false"><button class="task-menu-button" type="button" draggable="false" data-action="menu" aria-label="Task actions" aria-expanded="${menuOpen}"><i class="fa-solid fa-ellipsis"></i></button>${menuOpen ? renderMenu(task) : ""}</div></div><h4>${escape(task.title)}</h4><p>${escape(task.description)}</p><footer><span class="task-assignee"><i class="fa-solid fa-user"></i> ${escape(task.assignee || "Unassigned")}</span><span title="Click card to copy Codex prompt"><i class="fa-solid fa-copy"></i> Copy prompt</span></footer></article>`;
}
function assigneeClass(assignee) { return String(assignee || "unassigned").toLowerCase(); }
function renderMenu(task) { return `<div class="task-menu" role="menu"><button data-action="important" type="button"><i class="fa-solid fa-flag"></i> ${task.important ? "Remove Important" : "Mark Important"}</button><button data-action="favorite" type="button"><i class="fa-solid fa-star"></i> ${task.favorite ? "Remove from Favorites" : "Add to Favorites"}</button><div class="task-menu-label">Assign to</div>${[[null, "Unassigned"], ...CONTRIBUTORS.map((name) => [name, name])].map(([value, label]) => `<button data-action="assign" data-assignee="${value || "unassigned"}" class="assign-action assignee-${assigneeClass(value)} ${task.assignee === value ? "selected" : ""}" type="button"><i class="fa-solid ${task.assignee === value ? "fa-circle-check" : "fa-user"}"></i> ${label}</button>`).join("")}<hr><button data-action="edit" type="button"><i class="fa-solid fa-pen"></i> Edit</button><button data-action="complete" class="${task.completed ? "reopen-action" : "complete-action"}" type="button"><i class="fa-solid fa-circle-check"></i> ${task.completed ? "Reopen" : "Complete"}</button><button data-action="delete" class="danger-menu" type="button"><i class="fa-solid fa-trash"></i> Delete</button></div>`; }

function onBoardClick(event) {
  // The three-dot menu is an isolated control: it must never copy the card's
  // prompt or trigger the card click behavior.
  if (event.target.closest(".task-menu-wrap")) {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const card = action.closest("[data-task-id]");
    const task = findTask(card?.dataset.taskId);
    if (!task) return;
    const type = action.dataset.action;
    if (type === "menu") {
      const previousId = taskState.menuId;
      taskState.menuId = taskState.menuId === task.id ? null : task.id;
      refreshTaskCard(previousId);
      refreshTaskCard(task.id);
      return;
    }
    if (type === "important") mutate(task, { important: !task.important });
    if (type === "favorite") mutate(task, { favorite: !task.favorite });
    if (type === "assign") mutate(task, { assignee: action.dataset.assignee === "unassigned" ? null : action.dataset.assignee });
    if (type === "complete") mutate(task, { completed: !task.completed });
    if (type === "edit") openEditor(task.id);
    if (type === "delete") { taskState.deletingId = task.id; deleteBackdrop.hidden = false; document.body.style.overflow = "hidden"; }
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) { const card = event.target.closest("[data-task-id]"); const task = findTask(card?.dataset.taskId); if (task && !event.target.closest("button,input,label,a")) { copyText(createCodexPrompt(task)); showToast("Codex-ready task prompt copied."); } return; }
  event.stopPropagation(); const card = action.closest("[data-task-id]"); const task = findTask(card?.dataset.taskId); if (!task) return;
  const type = action.dataset.action;
  if (type === "menu") { const previousId = taskState.menuId; taskState.menuId = taskState.menuId === task.id ? null : task.id; refreshTaskCard(previousId); refreshTaskCard(task.id); return; }
  if (type === "important") mutate(task, { important: !task.important });
  if (type === "favorite") mutate(task, { favorite: !task.favorite });
  if (type === "assign") mutate(task, { assignee: action.dataset.assignee === "unassigned" ? null : action.dataset.assignee });
  if (type === "complete") mutate(task, { completed: !task.completed });
  if (type === "edit") openEditor(task.id);
  if (type === "delete") { taskState.deletingId = task.id; deleteBackdrop.hidden = false; document.body.style.overflow = "hidden"; }
}

function addMiniTaskField(task = {}) { const row = document.createElement("div"); row.className = "milestone-task-field"; if (task.id) row.dataset.miniTaskId = task.id; if (task.taskId) row.dataset.boardTaskId = task.taskId; row.innerHTML = `<input class="mini-task-title" type="text" maxlength="240" placeholder="Describe a task…" value="${escape(task.title || "")}" /><button class="icon-button danger-icon" type="button" data-remove-mini-task aria-label="Remove task"><i class="fa-solid fa-trash"></i></button>`; milestoneTaskFields.append(row); }
function openMilestoneEditor(id = null) { const milestone = id ? taskState.milestones.find((item) => item.id === id) : null; taskState.editingMilestoneId = id; milestoneForm.reset(); milestoneTaskFields.replaceChildren(); $("milestoneEditorEyebrow").textContent = milestone ? "EDIT" : "CREATE"; $("milestoneEditorTitle").textContent = milestone ? "Edit milestone" : "New milestone"; $("milestoneSaveButton").innerHTML = milestone ? '<i class="fa-solid fa-check"></i> Save changes' : '<i class="fa-solid fa-plus"></i> Create Milestone'; $("milestoneDeleteButton").hidden = !milestone; $("milestoneAssignee").innerHTML = `<option value="">Unassigned</option>${CONTRIBUTORS.map((name) => `<option value="${name}">${name}</option>`).join("")}`; if (milestone) { milestoneForm.elements.title.value = milestone.title; milestoneForm.elements.description.value = milestone.description; milestoneForm.elements.assignee.value = milestone.assignee || ""; milestone.miniTasks.forEach(addMiniTaskField); } else addMiniTaskField(); milestoneEditorBackdrop.hidden = false; document.body.style.overflow = "hidden"; requestAnimationFrame(() => milestoneForm.elements.title.focus()); }
function closeMilestoneEditor() { milestoneEditorBackdrop.hidden = true; document.body.style.overflow = ""; taskState.editingMilestoneId = null; }
function openMilestoneDelete() { if (!taskState.editingMilestoneId) return; taskState.deletingMilestoneId = taskState.editingMilestoneId; milestoneEditorBackdrop.hidden = true; milestoneDeleteBackdrop.hidden = false; document.body.style.overflow = "hidden"; requestAnimationFrame(() => $("milestoneDeleteConfirm").focus()); }
function closeMilestoneDelete() { milestoneDeleteBackdrop.hidden = true; document.body.style.overflow = ""; taskState.deletingMilestoneId = null; }
function deleteMilestone() { const milestone = taskState.milestones.find((item) => item.id === taskState.deletingMilestoneId); if (!milestone) return; taskState.tasks = taskState.tasks.filter((task) => task.milestoneId !== milestone.id); taskState.milestones = taskState.milestones.filter((item) => item.id !== milestone.id); markDirty(); closeMilestoneDelete(); taskState.editingMilestoneId = null; render(); showToast("Milestone and linked board tasks deleted."); }
function saveMilestoneEditor(event) { event.preventDefault(); const title = milestoneForm.elements.title.value.trim(); if (!title) return; const now = new Date().toISOString(); const isEditing = Boolean(taskState.editingMilestoneId); const current = isEditing ? taskState.milestones.find((item) => item.id === taskState.editingMilestoneId) : null; const milestone = current || { id: `milestone-${Date.now().toString(36)}`, createdAt: now }; const assignee = milestoneForm.elements.assignee.value || null; const miniTasks = [...milestoneTaskFields.querySelectorAll(".milestone-task-field")].map((row) => { const taskTitle = row.querySelector(".mini-task-title").value.trim(); if (!taskTitle) return null; return { id: row.dataset.miniTaskId || `mini-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, taskId: row.dataset.boardTaskId || createTaskId(), title: taskTitle }; }).filter(Boolean); const retainedTaskIds = new Set(miniTasks.map((item) => item.taskId)); if (current) taskState.tasks = taskState.tasks.filter((task) => task.milestoneId !== milestone.id || retainedTaskIds.has(task.id)); Object.assign(milestone, { title, description: milestoneForm.elements.description.value.trim(), assignee, miniTasks, updatedAt: now }); miniTasks.forEach((miniTask) => { const boardTask = findTask(miniTask.taskId); const changes = { id: miniTask.taskId, title: miniTask.title, description: milestoneTaskDescription(milestone), assignee, milestoneId: milestone.id, updatedAt: now }; if (boardTask) Object.assign(boardTask, normalizeTask({ ...boardTask, ...changes })); else taskState.tasks.unshift(normalizeTask({ ...changes, favorite: false, important: false, completed: false, createdAt: now })); }); if (!isEditing) taskState.milestones.unshift(milestone); taskState.view = "milestones"; markDirty(); closeMilestoneEditor(); render(); showToast(isEditing ? "Milestone and board tasks saved." : "Milestone and board tasks created."); }

function milestoneTaskDescription(milestone) { return `Part of milestone: ${milestone.title}\n\n${milestone.description || "Complete this milestone task using the existing project patterns."}`; }
function createCodexPrompt(task) { const milestone = task.milestoneId ? taskState.milestones.find((item) => item.id === task.milestoneId) : null; return `You are working on the Motion Shelf project.\n\n## Task\n${task.title}\n\n## Context\n${task.description || "No additional context was provided."}${milestone ? `\n\n## Milestone\n${milestone.title}${milestone.description ? `\n${milestone.description}` : ""}` : ""}\n\n## Requirements\n- Inspect the existing implementation before changing it.\n- Implement this task using the project’s current architecture and style.\n- Preserve working behavior outside this task.\n- Test the affected flow and report what changed.\n\nWhen complete, mark this task as completed on the task board.`; }

async function importMilestones(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const update = payload?.update || payload;
    const sourceMilestones = Array.isArray(update?.milestones) ? update.milestones : Array.isArray(payload?.milestones) ? payload.milestones : null;
    if (!sourceMilestones) throw new Error("The JSON needs an update.milestones array.");
    const exportKey = String(payload?.metadata?.task_id || update?.id || update?.title || "milestone-export");
    const now = new Date().toISOString();
    let importedTasks = 0;
    sourceMilestones.forEach((sourceMilestone, index) => {
      const importKey = `external-${exportKey}-${sourceMilestone.id ?? index}`;
      const existing = taskState.milestones.find((milestone) => milestone.importKey === importKey);
      const resolvedAssignee = resolveImportedAssignee(sourceMilestone, update);
      const milestone = existing || { id: `milestone-${Date.now().toString(36)}-${index}`, createdAt: now };
      const assignee = resolvedAssignee || existing?.assignee || null;
      const checklist = Array.isArray(sourceMilestone.checklist) ? sourceMilestone.checklist : [];
      const existingMiniTasks = new Map((existing?.miniTasks || []).map((item) => [item.id, item]));
      const miniTasks = checklist.map((item, taskIndex) => {
        const id = `external-${sourceMilestone.id ?? index}-${item.id ?? taskIndex}`;
        const existingMiniTask = existingMiniTasks.get(id);
        return { id, taskId: existingMiniTask?.taskId || createTaskId(), title: String(item.title || "Untitled task").trim() };
      });
      Object.assign(milestone, { title: String(sourceMilestone.title || update.title || "Imported milestone").trim(), description: String(sourceMilestone.description || update.description || "").trim(), assignee, importKey, miniTasks, updatedAt: now });
      miniTasks.forEach((miniTask, taskIndex) => {
        const sourceTask = checklist[taskIndex];
        const taskDescription = [sourceTask?.description, `Imported from: ${milestone.title}`, update?.description, update?.success_criteria].filter(Boolean).join("\n\n");
        const boardTask = findTask(miniTask.taskId);
        const changes = { id: miniTask.taskId, title: miniTask.title, description: taskDescription || milestoneTaskDescription(milestone), assignee, milestoneId: milestone.id, completed: Boolean(sourceTask?.completed), updatedAt: now };
        if (boardTask) Object.assign(boardTask, normalizeTask({ ...boardTask, ...changes }));
        else taskState.tasks.unshift(normalizeTask({ ...changes, favorite: false, important: false, createdAt: now }));
        importedTasks += 1;
      });
      if (!existing) taskState.milestones.push(milestone);
    });
    taskState.view = "milestones";
    markDirty(); render();
    showToast(`${sourceMilestones.length} milestone${sourceMilestones.length === 1 ? "" : "s"} and ${importedTasks} board task${importedTasks === 1 ? "" : "s"} imported.`);
  } catch (error) { showToast(error?.message || "Could not import this JSON file.", true); }
  finally { event.target.value = ""; }
}

function resolveImportedAssignee(sourceMilestone, update) {
  const candidate = sourceMilestone.assignee_name || sourceMilestone.assigned_user_name || sourceMilestone.assignee?.name || sourceMilestone.assigned_to?.name || update?.assignee_name || update?.assignee?.name;
  return CONTRIBUTORS.find((name) => name.toLowerCase() === String(candidate || "").toLowerCase()) || null;
}

function onDragStart(event) { if (event.target.closest(".task-menu-wrap")) { event.preventDefault(); return; } const card = event.target.closest("[data-task-id]"); if (!card) return; taskState.dragId = card.dataset.taskId; card.classList.add("is-dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", taskState.dragId); const sourceLane = card.closest("[data-lane]"); const assignedLane = board.querySelector('[data-lane="Gabriel"] .task-lane-dropzone'); if (sourceLane?.dataset.lane === "unassigned" && assignedLane) { const preview = card.cloneNode(true); preview.classList.remove("is-dragging", "is-menu-open"); preview.style.cssText = `position: fixed; top: -10000px; left: -10000px; width: ${assignedLane.getBoundingClientRect().width}px; pointer-events: none;`; document.body.append(preview); taskState.dragPreview = preview; event.dataTransfer.setDragImage(preview, 24, 24); } }
function clearDrag() { taskState.dragId = null; taskState.dragPreview?.remove(); taskState.dragPreview = null; document.querySelectorAll(".is-dragging,.is-drop-target").forEach((element) => element.classList.remove("is-dragging", "is-drop-target")); }
function onDrop(event) { const lane = event.target.closest("[data-lane]"); if (!lane || !taskState.dragId) return; event.preventDefault(); const task = findTask(taskState.dragId); const sourceRect = task ? board.querySelector(`[data-task-id="${task.id}"]`)?.getBoundingClientRect() : null; if (task) { mutate(task, { assignee: lane.dataset.lane === "unassigned" ? null : lane.dataset.lane }, "Task moved."); animateTaskRelocation(task.id, sourceRect); } clearDrag(); }
function animateTaskRelocation(taskId, sourceRect) { const card = board.querySelector(`[data-task-id="${taskId}"]`); if (!card || !sourceRect || !card.animate) return; const targetRect = card.getBoundingClientRect(); const scaleX = sourceRect.width / targetRect.width; const scaleY = sourceRect.height / targetRect.height; card.animate([{ transformOrigin: "top left", transform: `translate(${sourceRect.left - targetRect.left}px, ${sourceRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`, opacity: .78 }, { transformOrigin: "top left", transform: "translate(0, 0) scale(1)", opacity: 1 }], { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" }); }
function findTask(id) { return taskState.tasks.find((task) => task.id === id); }
function mutate(task, changes, message = "Task updated.") { Object.assign(task, changes, { updatedAt: new Date().toISOString() }); taskState.menuId = null; markDirty(); render(); showToast(message); }
function markDirty() { taskState.dirty = true; saveTaskCache(taskState.tasks); saveMilestoneCache(taskState.milestones); }

function openEditor(id = null) { taskState.editingId = id; const task = id ? findTask(id) : null; $("taskEditorEyebrow").textContent = task ? "EDIT" : "CREATE"; $("taskEditorTitle").textContent = task ? "Edit task" : "New task"; $("taskSaveButton").innerHTML = task ? '<i class="fa-solid fa-check"></i> Save changes' : '<i class="fa-solid fa-plus"></i> Create Task'; $("taskAssignee").innerHTML = `<option value="">Unassigned</option>${CONTRIBUTORS.map((name) => `<option value="${name}">${name}</option>`).join("")}`; form.reset(); if (task) { form.elements.title.value = task.title; form.elements.description.value = task.description; form.elements.assignee.value = task.assignee || ""; form.elements.favorite.checked = task.favorite; form.elements.important.checked = task.important; form.elements.completed.value = String(task.completed); } editorBackdrop.hidden = false; document.body.style.overflow = "hidden"; requestAnimationFrame(() => form.elements.title.focus()); }
function closeEditor() { editorBackdrop.hidden = true; document.body.style.overflow = ""; taskState.editingId = null; }
function saveEditor(event) { event.preventDefault(); const title = form.elements.title.value.trim(); const description = form.elements.description.value.trim(); if (!title || !description) { showToast("Add a title and description before saving.", true); return; } const isEditing = Boolean(taskState.editingId); const now = new Date().toISOString(); const task = isEditing ? findTask(taskState.editingId) : { id: createTaskId(), createdAt: now }; Object.assign(task, normalizeTask({ ...task, title, description, assignee: form.elements.assignee.value || null, favorite: form.elements.favorite.checked, important: form.elements.important.checked, completed: form.elements.completed.value === "true", updatedAt: now })); if (!isEditing) taskState.tasks.unshift(task); markDirty(); closeEditor(); render(); showToast(isEditing ? "Task saved." : "Task created."); }
function closeDelete() { deleteBackdrop.hidden = true; document.body.style.overflow = ""; taskState.deletingId = null; }
function openRules() { rulesBackdrop.hidden = false; document.body.style.overflow = "hidden"; requestAnimationFrame(() => $("taskRulesClose").focus()); }
function closeRules() { rulesBackdrop.hidden = true; document.body.style.overflow = ""; $("taskRulesButton").focus(); }
function deleteTask() { const task = findTask(taskState.deletingId); if (!task) return; taskState.tasks = taskState.tasks.filter((item) => item.id !== task.id); markDirty(); closeDelete(); render(); showToast("Task deleted."); }
async function pushTasks() { if (!supportsProjectFolders()) { showToast("Folder access requires Chrome or Edge on localhost.", true); return; } try { state.projectBusy = true; updateProjectUi(); await writeTasksToLinkedProject(taskState.tasks, taskState.milestones, getTasksDirectory); taskState.dirty = false; saveTaskCache(taskState.tasks); saveMilestoneCache(taskState.milestones); showToast("Tasks and contributor prompts saved locally."); } catch (error) { if (error?.name !== "AbortError") showToast("Could not write task files.", true); } finally { state.projectBusy = false; updateProjectUi(); render(); } }
function refreshTaskCard(id) { const task = findTask(id); const card = id && board.querySelector(`[data-task-id="${id}"]`); if (task && card) { card.outerHTML = renderCard(task); board.querySelector(`[data-task-id="${id}"]`)?.classList.add("task-card--static"); } }
function closeMenu() { if (taskState.menuId) { const id = taskState.menuId; taskState.menuId = null; refreshTaskCard(id); } }
function showToast(message, error = false) { $("taskToastText").textContent = message; $("taskToastIcon").className = error ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-check"; $("taskToast").classList.toggle("error", error); $("taskToast").classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("taskToast").classList.remove("show"), 2800); }
