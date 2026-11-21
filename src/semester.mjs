// Fixed 2026 autumn term boundary (China standard time).
// Keeps the scope to the user's previous semester. Future terms require reviewing cutoff.
export const CURRENT_TERM_START = "2026-09-01";
const TERM_START_MILLIS = Date.parse(CURRENT_TERM_START + "T00:00:00+08:00");

export function isPreviousSemesterDeadline(date) {
  return date instanceof Date && Number.isFinite(date.valueOf()) && date.valueOf() < TERM_START_MILLIS;
}
export function isPreviousSemesterPendingTask(task) {
  return Boolean(
    task && task.status === "needsAction" && !task.deleted &&
    !task.parent && typeof task.id === "string" &&
    typeof task.notes === "string" &&
    /\[BUPT_SYNC_ID:hw:[^\]\r\n]+\]/.test(task.notes) &&
    typeof task.due === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(task.due) &&
    task.due.slice(0, 10) < CURRENT_TERM_START
  );
}
