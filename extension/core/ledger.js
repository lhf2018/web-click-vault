import { ensureWeek, recordWeeklyVisit, WEEKLY_TASKS, taskProgress, weekKey } from "./weekly.js";
import { depositMultiplier } from "./shop.js";
import {
  ACHIEVEMENTS,
  DAILY_HISTORY_DAYS,
  DEFAULT_SETTINGS,
  RECENT_ENTRIES_LIMIT,
  SCHEMA_VERSION,
} from "./constants.js";

/**
 * @returns {string} YYYY-MM-DD local
 */
export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {Record<string, { visits: number, asset: number }>} history
 * @param {number} keepDays
 */
export function pruneDailyHistory(history, keepDays = DAILY_HISTORY_DAYS) {
  const keys = Object.keys(history || {}).sort();
  if (keys.length <= keepDays) return history || {};
  const drop = keys.slice(0, keys.length - keepDays);
  const next = { ...history };
  for (const k of drop) delete next[k];
  return next;
}

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    dayKey: localDayKey(),
    todayVisits: 0,
    todayAsset: 0,
    totalVisits: 0,
    totalAsset: 0,
    shopSpent: 0,
    shopLevels: {},
    shopPurchases: [],
    weekly: ensureWeek({}).weekly,
    recentEntries: [],
    recentVisitMap: {},
    hostDayMap: {},
    pathDayMap: {},
    dailyHistory: {},
    settings: { ...DEFAULT_SETTINGS },
    lastFormula: null,
    pendingRecoveries: [],
    unlockedAchievements: [],
    pendingAchievement: null,
  };
}

/**
 * @param {ReturnType<typeof defaultState>} state
 */
export function ensureDayRollover(state) {
  const today = localDayKey();
  if (state.dayKey === today) return state;

  let dailyHistory = { ...(state.dailyHistory || {}) };
  if (state.dayKey) {
    dailyHistory[state.dayKey] = {
      visits: state.todayVisits || 0,
      asset: Number(state.todayAsset) || 0,
    };
  }
  dailyHistory = pruneDailyHistory(dailyHistory);

  return {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...(state.settings || {}) },
    dayKey: today,
    todayVisits: 0,
    todayAsset: 0,
    hostDayMap: {},
    pathDayMap: {},
    dailyHistory,
  };
}

/**
 * @param {number} totalAsset
 * @param {string[]} unlocked
 */
export function nextThreshold(totalAsset, unlocked) {
  for (const a of ACHIEVEMENTS) {
    if (!unlocked.includes(a.id)) return a.threshold;
  }
  const last = ACHIEVEMENTS[ACHIEVEMENTS.length - 1];
  return last.threshold;
}

/**
 * @param {ReturnType<typeof defaultState>} state
 * @param {object} entry
 * @param {object} [formulaDetail]
 */
export function applyDeposit(state, entry, formulaDetail = null) {
  let next = ensureDayRollover(state);
  const reward = entry.kind === "task_reward";
  next = reward ? ensureWeek(next) : recordWeeklyVisit(next, entry);
  const baseAmount = entry.amount;
  const { multiplier, extras } = reward ? { multiplier: 1, extras: [] } : depositMultiplier(next, entry.metrics);
  const effectReason = extras.length ? ` · 触发：${extras.map(item=>item.name).join("、")}` : "";
  entry = {
    ...entry,
    amount: round2(baseAmount * multiplier),
    reason: multiplier > 1 ? `${entry.reason || "浏览入账"} · 商店加成 ×${multiplier}${effectReason}` : entry.reason,
  };
  if (formulaDetail) formulaDetail = { ...formulaDetail, baseAmount, multiplier, extras, amount: entry.amount, reason: entry.reason };
  const before = next.totalAsset;
  const after = round2(before + entry.amount);

  const fullEntry = {
    kind: entry.kind || "browse",
    extras,
    id: entry.id || cryptoRandomId(),
    ts: entry.ts || Date.now(),
    url: entry.url,
    host: entry.host,
    amount: entry.amount,
    baseAmount,
    multiplier,
    score: entry.score,
    metrics: entry.metrics,
    reason: entry.reason,
  };

  const recentEntries = [fullEntry, ...next.recentEntries].slice(0, RECENT_ENTRIES_LIMIT);
  const unlocked = [...next.unlockedAchievements];
  let pending = next.pendingAchievement;

  for (const a of ACHIEVEMENTS) {
    if (before < a.threshold && after >= a.threshold && !unlocked.includes(a.id)) {
      unlocked.push(a.id);
      pending = { id: a.id, title: a.title, hint: a.hint };
    }
  }

  const todayVisits = next.todayVisits + (reward ? 0 : 1);
  const todayAsset = round2(next.todayAsset + entry.amount);
  const dailyHistory = pruneDailyHistory({
    ...(next.dailyHistory || {}),
    [next.dayKey]: { visits: todayVisits, asset: todayAsset },
  });

  return {
    ...next,
    todayVisits,
    todayAsset,
    totalVisits: next.totalVisits + (reward ? 0 : 1),
    totalAsset: after,
    recentEntries,
    dailyHistory,
    lastFormula: formulaDetail || next.lastFormula,
    unlockedAchievements: unlocked,
    pendingAchievement: pending,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {ReturnType<typeof defaultState>} state
 */
export function amountToNext(state) {
  const target = nextThreshold(state.totalAsset, state.unlockedAchievements || []);
  return Math.max(0, round2(target - state.totalAsset));
}

/**
 * Last 7 local days inclusive of today.
 * @param {ReturnType<typeof defaultState>} state
 * @param {number} [days]
 */
export function buildWeekSeries(state, days = 7) {
  const series = [];
  const rolled = ensureDayRollover(state);
  const history = { ...(rolled.dailyHistory || {}) };
  history[rolled.dayKey] = {
    visits: rolled.todayVisits || 0,
    asset: Number(rolled.todayAsset) || 0,
  };

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = localDayKey(d);
    const row = history[key] || { visits: 0, asset: 0 };
    series.push({
      dayKey: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      weekday: ["日", "一", "二", "三", "四", "五", "六"][d.getDay()],
      visits: row.visits || 0,
      asset: Number(row.asset) || 0,
      isToday: key === rolled.dayKey,
    });
  }
  return series;
}

export function claimWeeklyReward(state, taskId, expectedWeek = weekKey()) {
  const next = ensureWeek(ensureDayRollover(state));
  if (expectedWeek !== next.weekly.weekKey) throw new Error("本周任务已刷新，请重新查看任务");
  const task = WEEKLY_TASKS.find(task=>task.id===taskId);
  if (!task) throw new Error("任务不存在");
  if (next.weekly.claimed.includes(taskId)) throw new Error("奖励已经领取");
  if (taskProgress(next,task)<task.target) throw new Error("任务尚未完成");
  const credited = applyDeposit(next,{kind:"task_reward", amount:task.reward, host:"每周探索任务", reason:`每周任务奖励 · ${task.title}`});
  return { ...credited, weekly:{...credited.weekly,claimed:[...credited.weekly.claimed,taskId]} };
}
