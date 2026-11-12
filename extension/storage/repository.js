import { ensureWeek } from "../core/weekly.js";
import { defaultState, ensureDayRollover } from "../core/ledger.js";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "../core/constants.js";

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
  const merged = {
    ...defaultState(),
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    dailyHistory: raw.dailyHistory || {},
    pendingRecoveries: raw.pendingRecoveries || [],
    lastFormula: raw.lastFormula || null,
  };
  const rolled = ensureWeek(ensureDayRollover(merged));
  if (
    rolled.dayKey !== raw.dayKey ||
    rolled.schemaVersion !== raw.schemaVersion ||
    rolled.weekly !== raw.weekly ||
    !raw.settings
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
    const next = await mutator(current);
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
    await chrome.storage.local.remove([SESSIONS_KEY, "assetMeterPendingCommits"]);
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
