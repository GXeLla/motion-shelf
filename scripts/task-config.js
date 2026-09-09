export const CONTRIBUTORS = ["Gabriel", "Rati", "Georgi"];

export const TASK_STORAGE_KEY = "motion-shelf.tasks.v3";
export const MILESTONE_STORAGE_KEY = "motion-shelf.milestones.v3";

export function createTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTask(task = {}) {
  const now = new Date().toISOString();
  const assignee = CONTRIBUTORS.includes(task.assignee) ? task.assignee : null;
  return {
    id: String(task.id || createTaskId()),
    title: String(task.title || "").trim(),
    description: String(task.description || "").trim(),
    assignee,
    favorite: Boolean(task.favorite),
    important: Boolean(task.important),
    completed: Boolean(task.completed),
    milestoneId: task.milestoneId ? String(task.milestoneId) : null,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || task.createdAt || now,
  };
}

export function normalizeMilestone(milestone = {}) {
  const now = new Date().toISOString();
  return {
    id: String(milestone.id || `milestone-${Date.now().toString(36)}`),
    title: String(milestone.title || "Untitled milestone").trim(),
    description: String(milestone.description || "").trim(),
    assignee: CONTRIBUTORS.includes(milestone.assignee) ? milestone.assignee : null,
    miniTasks: Array.isArray(milestone.miniTasks) ? milestone.miniTasks.map((item, index) => ({ id: String(item.id || `${Date.now()}-${index}`), taskId: item.taskId ? String(item.taskId) : null, title: String(item.title || "").trim(), completed: Boolean(item.completed) })).filter((item) => item.title) : [],
    createdAt: milestone.createdAt || now,
    updatedAt: milestone.updatedAt || milestone.createdAt || now,
  };
}

export function formatTaskDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
