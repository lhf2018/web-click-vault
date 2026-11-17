import { syncAchievements } from '../core/achievements.js';
import { ensureWeek } from "../core/weekly.js";
import { defaultState, ensureDayRollover } from "../core/ledger.js";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "../core/constants.js";
import { estateHost } from '../core/estate.js';

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
