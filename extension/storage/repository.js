import { defaultState, ensureDayRollover } from "../core/ledger.js";
import { DEFAULT_SETTINGS } from "../core/constants.js";

const STORAGE_KEY = "assetMeterState";
const SESSIONS_KEY = "assetMeterSessions";

/**
 * @returns {Promise<ReturnType<typeof defaultState>>}
 */
export async function loadState() {
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
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    dailyHistory: raw.dailyHistory || {},
    pendingRecoveries: raw.pendingRecoveries || [],
    lastFormula: raw.lastFormula || null,
  };
  const rolled = ensureDayRollover(merged);
  if (
    rolled.dayKey !== raw.dayKey ||
    rolled.schemaVersion !== raw.schemaVersion ||
    !raw.settings
  ) {
    await saveState(rolled);
  }
  return rolled;
}

/**
 * @param {ReturnType<typeof defaultState>} state
 */
export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/**
 * @param {(state: ReturnType<typeof defaultState>) => ReturnType<typeof defaultState> | Promise<ReturnType<typeof defaultState>>} mutator
 */
export async function updateState(mutator) {
  const current = await loadState();
  const next = await mutator(current);
  await saveState(next);
  return next;
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
  const fresh = defaultState();
  await saveState(fresh);
  await chrome.storage.local.remove([SESSIONS_KEY, "assetMeterPendingCommits"]);
  return fresh;
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
