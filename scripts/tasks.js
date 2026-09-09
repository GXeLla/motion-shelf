import { state } from "./state.js";
import { initializeAmbientBackground } from "./background.js";
import { connectProject, ensureProjectHandle, restoreProjectLink, supportsProjectFolders } from "./filesystem.js";
import { CONTRIBUTORS, createTaskId, formatTaskDate, normalizeTask } from "./task-config.js";
import { loadMilestoneCache, loadTaskCache, loadTasksFromLinkedProject, saveMilestoneCache, saveTaskCache, writeTasksToLinkedProject } from "./task-storage.js";
import { copyText } from "./code.js";

const taskState = { tasks: loadTaskCache(), milestones: loadMilestoneCache(), view: "board", filter: "all", search: "", quick: new Set(), dirty: false, editingId: null, deletingId: null, menuId: null, dragId: null, draggingMilestone: null };
const $ = (id) => document.getElementById(id);
const board = $("taskBoard");
const milestoneBoard = $("milestoneBoard");
const editorBackdrop = $("taskEditorBackdrop");
const deleteBackdrop = $("taskDeleteBackdrop");
const form = $("taskForm");
let toastTimer;

initializeAmbientBackground();
setupControls();
render();
initializeProject();

function setupControls() {
  $("newTaskButton").addEventListener("click", () => openEditor());
  $("newMilestoneButton").addEventListener("click", createMilestone);
  document.querySelector(".task-view-tabs").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (!button) return; taskState.view = button.dataset.view; render(); });
  milestoneBoard.addEventListener("change", (event) => { const input = event.target.closest("[data-mini-task]"); if (!input) return; const milestone = taskState.milestones.find((item) => item.id === input.dataset.milestoneId); const miniTask = milestone?.miniTasks.find((item) => item.id === input.dataset.miniTask); if (!miniTask) return; miniTask.completed = input.checked; milestone.updatedAt = new Date().toISOString(); markDirty(); render(); });
  $("pushTasksButton").addEventListener("click", pushTasks);
  $("taskSearch").addEventListener("input", (event) => { taskState.search = event.target.value.trim().toLowerCase(); render(); });
  $("taskFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (button) { taskState.filter = button.dataset.filter; render(); } });
  document.querySelector(".task-toggle-group").addEventListener("click", (event) => { const button = event.target.closest("[data-quick-filter]"); if (!button) return; const key = button.dataset.quickFilter; taskState.quick.has(key) ? taskState.quick.delete(key) : taskState.quick.add(key); render(); });
  board.addEventListener("click", onBoardClick);
  board.addEventListener("dblclick", () => {});
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
  editorBackdrop.addEventListener("click", (event) => { if (event.target === editorBackdrop) closeEditor(); });
  deleteBackdrop.addEventListener("click", (event) => { if (event.target === deleteBackdrop) closeDelete(); });
  form.addEventListener("submit", saveEditor);
  document.addEventListener("click", (event) => { if (!event.target.closest(".task-menu-wrap")) closeMenu(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenu(); if (!editorBackdrop.hidden) closeEditor(); if (!deleteBackdrop.hidden) closeDelete(); } });
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
  board.innerHTML = lanes.map((assignee) => {
    const laneTasks = visible.filter((task) => task.assignee === assignee).sort(sortTasks);
    const allCount = taskState.tasks.filter((task) => task.assignee === assignee && task.completed === showCompleted).length;
    const name = assignee || "Unassigned";
    return `<article class="task-lane" data-lane="${assignee || "unassigned"}"><header class="task-lane-header"><div><span class="task-lane-eyebrow">${assignee ? "CONTRIBUTOR" : "OPEN QUEUE"}</span><h3>${name}</h3></div><span class="task-lane-count">${allCount}</span></header><div class="task-lane-dropzone">${laneTasks.map(renderCard).join("") || `<div class="task-lane-empty">${showCompleted ? "No completed tasks" : "Drop a task here"}</div>`}</div></article>`;
  }).join("");
  $("taskResultCount").textContent = `${visible.length} ${visible.length === 1 ? "task" : "tasks"} shown`;
  $("taskEmptyState").hidden = visible.length !== 0;
  $("pushTasksButton").innerHTML = `<i class="fa-solid fa-folder-arrow-up"></i><span>${taskState.dirty ? "Update tasks locally" : "Push tasks to local"}</span>`;
  updateProjectUi();
}

function renderMilestones() {
  milestoneBoard.innerHTML = taskState.milestones.map((milestone) => {
    const total = milestone.miniTasks.length;
    const done = milestone.miniTasks.filter((item) => item.completed).length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return `<article class="milestone-card ${percent === 100 ? "is-complete" : ""}" draggable="true" data-milestone-id="${milestone.id}"><header><div><span class="eyebrow"><i class="fa-solid fa-grip-lines"></i> WORKSTREAM</span><h3>${escape(milestone.title)}</h3></div><strong>${percent}%</strong></header><p>${escape(milestone.description)}</p><div class="milestone-progress" aria-label="${percent}% complete"><span style="width: ${percent}%"></span></div><div class="mini-task-list">${milestone.miniTasks.map((item) => `<label class="mini-task ${item.completed ? "done" : ""}"><input type="checkbox" data-mini-task="${item.id}" data-milestone-id="${milestone.id}" ${item.completed ? "checked" : ""} /><span>${escape(item.title)}</span><i class="fa-solid fa-check"></i></label>`).join("")}</div><footer>${done} of ${total} mini-tasks complete${percent === 100 ? " · Ready to close" : ""}</footer></article>`;
  }).join("") || `<div class="task-lane-empty">No milestones yet.</div>`;
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

function sortTasks(a, b) { return Number(b.important) - Number(a.important) || new Date(b.updatedAt) - new Date(a.updatedAt); }
function escape(value) { const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML; }

function renderCard(task) {
  const menuOpen = taskState.menuId === task.id;
  return `<article class="task-card ${task.important ? "is-important" : ""} ${task.completed ? "is-completed" : ""} ${menuOpen ? "is-menu-open" : ""}" draggable="true" data-task-id="${task.id}"><div class="task-card-top"><div class="task-card-badges">${task.important ? '<span class="task-badge important"><i class="fa-solid fa-flag"></i> Important</span>' : ""}${task.favorite ? '<span class="task-star" title="Favorite"><i class="fa-solid fa-star"></i></span>' : ""}</div><div class="task-menu-wrap"><button class="task-menu-button" type="button" data-action="menu" aria-label="Task actions" aria-expanded="${menuOpen}"><i class="fa-solid fa-ellipsis"></i></button>${menuOpen ? renderMenu(task) : ""}</div></div><h4>${escape(task.title)}</h4><p>${escape(task.description)}</p><footer><span class="task-assignee"><i class="fa-solid fa-user"></i> ${escape(task.assignee || "Unassigned")}</span><span title="Updated ${escape(formatTaskDate(task.updatedAt))}"><i class="fa-regular fa-clock"></i> ${escape(formatTaskDate(task.updatedAt))}</span></footer></article>`;
}
function renderMenu(task) { return `<div class="task-menu" role="menu"><button data-action="important" type="button"><i class="fa-solid fa-flag"></i> ${task.important ? "Remove Important" : "Mark Important"}</button><button data-action="favorite" type="button"><i class="fa-solid fa-star"></i> ${task.favorite ? "Remove from Favorites" : "Add to Favorites"}</button><div class="task-menu-label">Assign to</div>${[[null, "Unassigned"], ...CONTRIBUTORS.map((name) => [name, name])].map(([value, label]) => `<button data-action="assign" data-assignee="${value || "unassigned"}" class="${task.assignee === value ? "selected" : ""}" type="button"><i class="fa-solid ${task.assignee === value ? "fa-circle-check" : "fa-user"}"></i> ${label}</button>`).join("")}<hr><button data-action="edit" type="button"><i class="fa-solid fa-pen"></i> Edit</button><button data-action="complete" type="button"><i class="fa-solid fa-circle-check"></i> ${task.completed ? "Reopen" : "Complete"}</button><button data-action="delete" class="danger-menu" type="button"><i class="fa-solid fa-trash"></i> Delete</button></div>`; }

function onBoardClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action) { const card = event.target.closest("[data-task-id]"); const task = findTask(card?.dataset.taskId); if (task && !event.target.closest("button,input,label,a")) { copyText(task.description); showToast("Task description copied."); } return; }
  event.stopPropagation(); const card = action.closest("[data-task-id]"); const task = findTask(card?.dataset.taskId); if (!task) return;
  const type = action.dataset.action;
  if (type === "menu") { taskState.menuId = taskState.menuId === task.id ? null : task.id; render(); return; }
  if (type === "important") mutate(task, { important: !task.important });
  if (type === "favorite") mutate(task, { favorite: !task.favorite });
  if (type === "assign") mutate(task, { assignee: action.dataset.assignee === "unassigned" ? null : action.dataset.assignee });
  if (type === "complete") mutate(task, { completed: !task.completed });
  if (type === "edit") openEditor(task.id);
  if (type === "delete") { taskState.deletingId = task.id; deleteBackdrop.hidden = false; document.body.style.overflow = "hidden"; }
}

function createMilestone() { const title = window.prompt("Milestone / workstream title:"); if (!title?.trim()) return; const miniTasks = (window.prompt("Mini-tasks (separate with commas):") || "").split(",").map((item, index) => ({ id: `mini-${Date.now()}-${index}`, title: item.trim(), completed: false })).filter((item) => item.title); taskState.milestones.unshift({ id: `milestone-${Date.now().toString(36)}`, title: title.trim(), description: "A focused workstream for the Motion Shelf team.", miniTasks, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); taskState.view = "milestones"; markDirty(); render(); showToast("New workstream added."); }

function onDragStart(event) { const card = event.target.closest("[data-task-id]"); if (!card) return; taskState.dragId = card.dataset.taskId; card.classList.add("is-dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", taskState.dragId); }
function clearDrag() { taskState.dragId = null; document.querySelectorAll(".is-dragging,.is-drop-target").forEach((element) => element.classList.remove("is-dragging", "is-drop-target")); }
function onDrop(event) { const lane = event.target.closest("[data-lane]"); if (!lane || !taskState.dragId) return; event.preventDefault(); const task = findTask(taskState.dragId); if (task) mutate(task, { assignee: lane.dataset.lane === "unassigned" ? null : lane.dataset.lane }, "Task moved."); clearDrag(); }
function findTask(id) { return taskState.tasks.find((task) => task.id === id); }
function mutate(task, changes, message = "Task updated.") { Object.assign(task, changes, { updatedAt: new Date().toISOString() }); taskState.menuId = null; markDirty(); render(); showToast(message); }
function markDirty() { taskState.dirty = true; saveTaskCache(taskState.tasks); saveMilestoneCache(taskState.milestones); }

function openEditor(id = null) { taskState.editingId = id; const task = id ? findTask(id) : null; $("taskEditorEyebrow").textContent = task ? "EDIT" : "CREATE"; $("taskEditorTitle").textContent = task ? "Edit task" : "New task"; $("taskSaveButton").innerHTML = task ? '<i class="fa-solid fa-check"></i> Save changes' : '<i class="fa-solid fa-plus"></i> Create Task'; $("taskAssignee").innerHTML = `<option value="">Unassigned</option>${CONTRIBUTORS.map((name) => `<option value="${name}">${name}</option>`).join("")}`; form.reset(); if (task) { form.elements.title.value = task.title; form.elements.description.value = task.description; form.elements.assignee.value = task.assignee || ""; form.elements.favorite.checked = task.favorite; form.elements.important.checked = task.important; form.elements.completed.value = String(task.completed); } editorBackdrop.hidden = false; document.body.style.overflow = "hidden"; requestAnimationFrame(() => form.elements.title.focus()); }
function closeEditor() { editorBackdrop.hidden = true; document.body.style.overflow = ""; taskState.editingId = null; }
function saveEditor(event) { event.preventDefault(); const title = form.elements.title.value.trim(); const description = form.elements.description.value.trim(); if (!title || !description) { showToast("Add a title and description before saving.", true); return; } const isEditing = Boolean(taskState.editingId); const now = new Date().toISOString(); const task = isEditing ? findTask(taskState.editingId) : { id: createTaskId(), createdAt: now }; Object.assign(task, normalizeTask({ ...task, title, description, assignee: form.elements.assignee.value || null, favorite: form.elements.favorite.checked, important: form.elements.important.checked, completed: form.elements.completed.value === "true", updatedAt: now })); if (!isEditing) taskState.tasks.unshift(task); markDirty(); closeEditor(); render(); showToast(isEditing ? "Task saved." : "Task created."); }
function closeDelete() { deleteBackdrop.hidden = true; document.body.style.overflow = ""; taskState.deletingId = null; }
function deleteTask() { const task = findTask(taskState.deletingId); if (!task) return; taskState.tasks = taskState.tasks.filter((item) => item.id !== task.id); markDirty(); closeDelete(); render(); showToast("Task deleted."); }
async function pushTasks() { if (!supportsProjectFolders()) { showToast("Folder access requires Chrome or Edge on localhost.", true); return; } try { state.projectBusy = true; updateProjectUi(); await writeTasksToLinkedProject(taskState.tasks, taskState.milestones, getTasksDirectory); taskState.dirty = false; saveTaskCache(taskState.tasks); saveMilestoneCache(taskState.milestones); showToast("Tasks and contributor prompts saved locally."); } catch (error) { if (error?.name !== "AbortError") showToast("Could not write task files.", true); } finally { state.projectBusy = false; updateProjectUi(); render(); } }
function closeMenu() { if (taskState.menuId) { taskState.menuId = null; render(); } }
function showToast(message, error = false) { $("taskToastText").textContent = message; $("taskToastIcon").className = error ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-check"; $("taskToast").classList.toggle("error", error); $("taskToast").classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("taskToast").classList.remove("show"), 2800); }
