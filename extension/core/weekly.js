export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function weekKey(date = new Date()) {
  const monday = new Date(date);
  monday.setHours(12,0,0,0);
  monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
  return dayKey(monday);
}
export const WEEKLY_TASKS = [
  { id: "explorer", title: "探索新视野", description: "本周浏览 5 个不同域名，每个可见停留至少 15 秒", target: 5, reward: 100, metric: "hosts" },
  { id: "reader", title: "沉浸阅读者", description: "本周完成 5 次可见停留至少 60 秒的有效浏览", target: 5, reward: 150, metric: "deepReads" },
  { id: "regular", title: "保持好奇心", description: "本周在 3 个不同日期各完成一次至少 15 秒的有效浏览", target: 3, reward: 200, metric: "days" },
];
export function ensureWeek(state, date = new Date()) {
  const key = weekKey(date);
  if (state.weekly?.weekKey === key) return state;
  return { ...state, weekly: { weekKey: key, hosts: [], deepReads: 0, days: [], claimed: [] } };
}
export function taskProgress(state, task) {
  const weekly = state.weekly || {};
  const value = weekly[task.metric];
  return Math.min(task.target, Array.isArray(value) ? value.length : Number(value)||0);
}
export function recordWeeklyVisit(state, entry, date = new Date()) {
  const next = ensureWeek(state,date);
  const weekly = { ...next.weekly };
  const dwell = entry.metrics?.dwellMs || 0;
  if (dwell >= 15000) {
    let host;
    try { host = new URL(entry.url).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
    // Progress only needs the first five distinct hosts and first three active dates.
    if (host) weekly.hosts = [...new Set([...weekly.hosts,host])].slice(0,5);
    weekly.days = [...new Set([...weekly.days,dayKey(date)])].slice(0,3);
  }
  if (dwell >= 60000) weekly.deepReads = Math.min(5,weekly.deepReads+1);
  return { ...next, weekly };
}
