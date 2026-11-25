import { syncAchievements } from '../core/achievements.js';
import { ensureWeek } from "../core/weekly.js";
import { defaultState, ensureDayRollover } from "../core/ledger.js";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "../core/constants.js";
import { estateHost, ESTATE_LEVELS, ESTATE_PRICE } from '../core/estate.js';
import { COMPANY_STAFF, companyTeamCapacity } from '../core/company.js';

const STORAGE_KEY = "assetMeterState";
const SESSIONS_KEY = "assetMeterSessions";

/**
 * @returns {Promise<ReturnType<typeof defaultState>>}
 */
async function readState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY];
  if (!raw || typeof raw !== "object") {
    const fresh = defaultState();
    await saveState(fresh);
    return fresh;
  }
  // Preserve the exact previous ledger once, before any additive migration/rollover.
  if ((raw.schemaVersion || 1) < SCHEMA_VERSION) {
    const backupKey = `assetMeterBackupBeforeSchema${SCHEMA_VERSION}`;
    const backup = await chrome.storage.local.get(backupKey);
    if (!backup[backupKey]) await chrome.storage.local.set({ [backupKey]: raw });
  }
  const merged = {
    ...defaultState(),
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    dailyHistory: raw.dailyHistory || {},
    pendingRecoveries: raw.pendingRecoveries || [],
    lastFormula: raw.lastFormula || null,
    estateDiscoveries: raw.estateDiscoveries || [...new Map((raw.recentEntries || [])
      .filter(entry => (!entry.kind || entry.kind === 'browse') && estateHost(entry.url))
      .map(entry => [estateHost(entry.url), { host: estateHost(entry.url), url: new URL(entry.url).origin + '/' }])).values()].slice(0, 100),
  };
  const rolled = syncAchievements(ensureWeek(ensureDayRollover(merged)));
  if (
    rolled.unlockedAchievements.length !== (raw.unlockedAchievements || []).length || !raw.achievementStats ||
    rolled.dayKey !== raw.dayKey ||
    rolled.schemaVersion !== raw.schemaVersion ||
    rolled.weekly !== raw.weekly ||
    !raw.settings || !raw.estateDiscoveries || !raw.estates || !raw.companies || !raw.collectibles || !raw.investments
  ) {
    await saveState(rolled);
  }
  return rolled;
}

/**
 * @param {ReturnType<typeof defaultState>} state
 */
async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/**
 * @param {(state: ReturnType<typeof defaultState>) => ReturnType<typeof defaultState> | Promise<ReturnType<typeof defaultState>>} mutator
 */
let stateQueue = Promise.resolve();
export function loadState() {
  const operation = stateQueue.then(() => readState());
  stateQueue = operation.catch(() => {});
  return operation;
}
export function updateState(mutator) {
  const operation = stateQueue.then(async () => {
    const current = await readState();
    const next = syncAchievements(await mutator(current));
    await saveState(next);
    return next;
  });
  stateQueue = operation.catch(() => {});
  return operation;
}

export async function resetToday() {
  return updateState((state) => {
    const rolled = ensureDayRollover(state);
    return {
      ...rolled,
      todayVisits: 0,
      todayAsset: 0,
      hostDayMap: {},
      pathDayMap: {},
      recentVisitMap: {},
    };
  });
}

export async function resetAll() {
  return updateState(async () => {
    await chrome.storage.local.remove([SESSIONS_KEY, "assetMeterPendingCommits", 'assetMeterBackupBeforeSchema5', `assetMeterBackupBeforeSchema${SCHEMA_VERSION}`]);
    return defaultState();
  });
}

/**
 * Persist in-flight tab sessions so SW sleep doesn't wipe them.
 * @returns {Promise<Record<string, object>>}
 */
export async function loadSessions() {
  const data = await chrome.storage.local.get(SESSIONS_KEY);
  return data[SESSIONS_KEY] && typeof data[SESSIONS_KEY] === "object"
    ? data[SESSIONS_KEY]
    : {};
}

/**
 * @param {Record<string, object>} sessions
 */
export async function saveSessions(sessions) {
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

export function validateBackup(backup) {
  if (!backup || backup.format !== 'web-click-vault' || backup.version !== 1 || !backup.state || typeof backup.state !== 'object' || Array.isArray(backup.state)) {
    throw new Error('不是有效的账本备份');
  }
  const state = backup.state;
  if (!Number.isInteger(state.schemaVersion) || state.schemaVersion < 1 || state.schemaVersion > SCHEMA_VERSION) throw new Error('备份版本不兼容');
  const numericKeys = new Set([...Object.entries(defaultState()).filter(([, value]) => typeof value === 'number').map(([key]) => key),
    'level', 'value', 'amount', 'price', 'principal', 'units', 'entryPrice', 'invested', 'completed', 'income', 'visits', 'dailyVisits', 'target', 'reward', 'dwellMs', 'loadMs']);
  const textKeys = new Set(['id', 'name', 'host', 'url', 'title', 'reason', 'source', 'siteName', 'projectId', 'status', 'dayKey', 'weekKey']);
  const check = (value, depth = 0) => {
    if (depth > 30) throw new Error('备份结构过深');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('备份包含无效数值');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('备份包含无效字段');
        if (Array.isArray(value) && child === null) throw new Error('备份包含空记录');
        if (numericKeys.has(key) && (typeof child !== 'number' || !Number.isFinite(child))) throw new Error('备份数值无效：' + key);
        if (textKeys.has(key) && typeof child !== 'string') throw new Error('备份文本无效：' + key);
        check(child, depth + 1);
      }
    }
  };
  check(state);
  for (const [key, fallback] of Object.entries(defaultState())) {
    if (!(key in state) || fallback === null) continue;
    const value = state[key];
    if (Array.isArray(fallback) ? !Array.isArray(value) : fallback && typeof fallback === 'object' ? !value || typeof value !== 'object' || Array.isArray(value) : typeof value !== typeof fallback) {
      throw new Error('备份字段无效：' + key);
    }
    if (typeof fallback === 'number' && value < 0) throw new Error('备份数值无效：' + key);
  }
  for (const key of ['totalAsset', 'totalVisits', 'todayAsset', 'todayVisits']) {
    if (typeof state[key] !== 'number') throw new Error('备份缺少账本数据');
  }
  for (const key of ['estates', 'estateDiscoveries', 'companies', 'collectibles', 'investments', 'recentEntries', 'pendingRecoveries', 'shopPurchases']) {
    if (state[key]?.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('备份记录无效：' + key);
  }
  for (const value of Object.values(state.shopLevels || {})) {
    if (!Number.isInteger(value) || value < 0 || value > 10) throw new Error('装备等级无效');
  }
  for (const value of Object.values(state.settings || {})) {
    if (typeof value !== 'boolean') throw new Error('备份设置无效');
  }
  const records = (key, fields) => {
    for (const row of state[key] || []) {
      for (const [field, type] of Object.entries(fields)) {
        if (typeof row[field] !== type) throw new Error('备份记录不完整：' + key);
      }
    }
  };
  records('companies', { id: 'string', name: 'string', type: 'string', completed: 'number', income: 'number' });
  for (const company of state.companies || []) {
    if (company.team !== undefined && (!Array.isArray(company.team) || company.team.length > companyTeamCapacity(company) ||
      new Set(company.team).size !== company.team.length ||
      company.team.some(role => typeof role !== 'string' || !Object.hasOwn(COMPANY_STAFF, role)))) throw new Error('公司团队记录无效');
    if (company.operatingDays !== undefined && (!Number.isSafeInteger(company.operatingDays) || company.operatingDays < 0)) throw new Error('公司经营天数无效');
    if (company.lastOperatingDay !== undefined && (typeof company.lastOperatingDay !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(company.lastOperatingDay))) throw new Error('公司经营日期无效');
    if (company.valuationHistory !== undefined && (!Array.isArray(company.valuationHistory) ||
      company.valuationHistory.length > 16 || company.valuationHistory.some(value => !Number.isFinite(value) || value < 0))) throw new Error('公司市值记录无效');
    if (!['publisher', 'explorer'].includes(company.type) || !Array.isArray(company.history) || (company.order && !Array.isArray(company.order.seen)) || (company.facilities && !Array.isArray(company.facilities))) throw new Error('公司记录无效');
    if (company.retained !== undefined && (!Number.isFinite(company.retained) || company.retained < 0)) throw new Error('公司留存利润无效');
    if (company.reinvest !== undefined && typeof company.reinvest !== 'boolean') throw new Error('公司利润分配无效');
    if (company.order?.retainRate !== undefined && company.order.retainRate !== 0.5) throw new Error('公司订单分配无效');
    if (company.expansion !== undefined) {
      const branch = company.expansion;
      const order = branch?.order;
      if (!branch || !Number.isInteger(branch.level) || branch.level < 1 || branch.level > 3 ||
        !Number.isInteger(branch.completed) || branch.completed < 0 || !Array.isArray(order?.seen) ||
        !Number.isInteger(order.target) || order.target < 2 || !Number.isFinite(order.reward) || order.reward <= 0 ||
        typeof order.title !== 'string' || order.seen.some(key => typeof key !== 'string') ||
        (branch.reinvested !== undefined && (!Number.isFinite(branch.reinvested) || branch.reinvested < 0))) throw new Error('公司第二业务记录无效');
    }
  }
  records('estates', { host: 'string', level: 'number', visits: 'number', income: 'number' });
  for (const estate of state.estates || []) {
    if (!Number.isInteger(estate.level) || estate.level < 1 || estate.level > ESTATE_LEVELS.length) throw new Error('地产等级无效');
    if (estate.purchasePrice !== undefined &&
      (typeof estate.purchasePrice !== 'number' || !Number.isSafeInteger(estate.purchasePrice * 100) || estate.purchasePrice < ESTATE_PRICE)) {
      throw new Error('地契购入价格无效');
    }
  }
  records('collectibles', { id: 'string', host: 'string', type: 'string', value: 'number' });
  records('investments', { id: 'string', projectId: 'string', principal: 'number', status: 'string' });
  for (const [record, keys] of [[state.weekly, ['hosts', 'days', 'claimed']], [state.achievementStats, ['hosts']]]) {
    for (const key of keys) if (record?.[key] && (!Array.isArray(record[key]) || record[key].some(value => typeof value !== 'string'))) throw new Error('进度记录无效');
  }
  if (state.unlockedAchievements?.some(value => typeof value !== 'string')) throw new Error('成就记录无效');
  return structuredClone(state);
}

export async function exportBackup() {
  return { format: 'web-click-vault', version: 1, exportedAt: new Date().toISOString(), state: await loadState() };
}

export function importBackup(backup) {
  const incoming = validateBackup(backup);
  return updateState(async current => {
    const next = syncAchievements(ensureWeek(ensureDayRollover({ ...defaultState(), ...incoming, schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, ...incoming.settings } })));
    await chrome.storage.local.set({ assetMeterBackupBeforeImport: current });
    await chrome.storage.local.remove([SESSIONS_KEY, 'assetMeterPendingCommits']);
    return next;
  });
}
