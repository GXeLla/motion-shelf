import { CONTRIBUTORS, TASK_STORAGE_KEY, MILESTONE_STORAGE_KEY, normalizeMilestone, normalizeTask } from "./task-config.js";

export function loadTaskCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TASK_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeTask) : [];
  } catch {
    return [];
  }
}

export function saveTaskCache(tasks) {
  localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
}

export function loadMilestoneCache() {
  try { const parsed = JSON.parse(localStorage.getItem(MILESTONE_STORAGE_KEY) || "[]"); return Array.isArray(parsed) ? parsed.map(normalizeMilestone) : []; } catch { return []; }
}
export function saveMilestoneCache(milestones) { localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(milestones)); }

export function parseTaskFile(value) {
  const parsed = JSON.parse(value);
  if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("tasks.json must contain a tasks array.");
  return parsed.tasks.map(normalizeTask);
}

export function parseTaskWorkspace(value) {
  const parsed = JSON.parse(value);
  if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("tasks.json must contain a tasks array.");
  return { tasks: parsed.tasks.map(normalizeTask), milestones: Array.isArray(parsed.milestones) ? parsed.milestones.map(normalizeMilestone) : [] };
}

export function buildTaskFile(tasks, milestones = []) {
  return JSON.stringify({ version: 1, tasks: tasks.map(normalizeTask), milestones: milestones.map(normalizeMilestone) }, null, 2) + "\n";
}

export function buildContributorMarkdown(contributor, tasks) {
  const assigned = tasks.filter((task) => task.assignee === contributor);
  const ordered = (items) => [...items].sort((a, b) => Number(b.important) - Number(a.important) || new Date(a.createdAt) - new Date(b.createdAt));
  const entry = (task, index) => `### ${index + 1}. ${task.title}\n\n**Priority:** ${task.important ? "Important" : "Standard"}  \n**Task ID:** ${task.id}\n\nDescription:\n${task.description || "No additional description provided."}\n`;
  const active = ordered(assigned.filter((task) => !task.completed));
  const completed = ordered(assigned.filter((task) => task.completed));
  return `# Motion Shelf — ${contributor} Tasks\n\nYou are working on the Motion Shelf project.\n\nBefore making changes:\n- read README.md\n- read instructions.md\n- inspect the existing implementation\n- preserve existing working functionality\n- follow the existing HTML, CSS, and JavaScript architecture\n\n## Active Tasks\n\n${active.length ? active.map(entry).join("\n") : "No active tasks are assigned to you.\n"}\n## Completed Tasks\n\n${completed.length ? completed.map(entry).join("\n") : "No completed task history.\n"}`;
}

export async function loadTasksFromLinkedProject(getTasksDirectory) {
  try {
    const directory = await getTasksDirectory({ create: false });
    const file = await (await directory.getFileHandle("tasks.json")).getFile();
    return parseTaskWorkspace(await file.text());
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

export async function writeTasksToLinkedProject(tasks, milestones, getTasksDirectory) {
  const directory = await getTasksDirectory({ create: true });
  const files = [["tasks.json", buildTaskFile(tasks, milestones)], ...CONTRIBUTORS.map((name) => [`${name}.md`, buildContributorMarkdown(name, tasks)])];
  for (const [name, content] of files) {
    const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
    await writable.write(content);
    await writable.close();
  }
}
