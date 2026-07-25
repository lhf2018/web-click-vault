import { DWELL_CAP_MS, WEIGHTS } from "../core/constants.js";
import { computeDeposit, formatDwell } from "../core/formula.js";
import { applyDeposit } from "../core/ledger.js";
import { buildScores } from "../core/metrics.js";
import { hostKey, pageTypeScore } from "../core/url.js";
import { shouldCountVisit, pruneRecentVisitMap } from "./navigation-guard.js";
import {
  loadSessions,
  loadState,
  saveSessions,
  saveState,
  updateState,
} from "../storage/repository.js";

const PENDING_COMMITS_KEY = "assetMeterPendingCommits";

/** @type {number | null} */
let activeTabId = null;

async function loadPendingCommits() {
  const data = await chrome.storage.local.get(PENDING_COMMITS_KEY);
  return data[PENDING_COMMITS_KEY] && typeof data[PENDING_COMMITS_KEY] === "object"
    ? data[PENDING_COMMITS_KEY]
    : {};
}

async function savePendingCommits(map) {
  await chrome.storage.local.set({ [PENDING_COMMITS_KEY]: map });
}

async function patchSession(tabId, patch) {
  const sessions = await loadSessions();
  const key = String(tabId);
  const prev = sessions[key] || {};
  sessions[key] = { ...prev, ...patch, tabId };
  await saveSessions(sessions);
  return sessions[key];
}

async function removeSession(tabId) {
  const sessions = await loadSessions();
  delete sessions[String(tabId)];
  await saveSessions(sessions);
}

function flushVisible(session, now = Date.now()) {
  if (!session) return session;
  // Prefer content-script dwell when available; only flush tab-activation timer otherwise.
  if (session.dwellSource === "probe") {
    return {
      ...session,
      visibleSince: null,
      dwellAccumMs: Math.min(DWELL_CAP_MS, session.dwellAccumMs || 0),
    };
  }
  let dwellAccumMs = session.dwellAccumMs || 0;
  if (session.visibleSince) {
    dwellAccumMs += Math.max(0, now - session.visibleSince);
  }
  return {
    ...session,
    dwellAccumMs: Math.min(DWELL_CAP_MS, dwellAccumMs),
    visibleSince: null,
  };
}

/**
 * Content script dwell updates (visible-only).
 * @param {number} tabId
 * @param {number} dwellMs
 * @param {boolean} [visible]
 */
export async function applyDwellFromProbe(tabId, dwellMs, visible = true) {
  const sessions = await loadSessions();
  const key = String(tabId);
  const session = sessions[key];
  if (!session || session.settled) return null;

  const capped = Math.min(DWELL_CAP_MS, Math.max(0, Number(dwellMs) || 0));
  sessions[key] = {
    ...session,
    dwellAccumMs: Math.max(session.dwellAccumMs || 0, capped),
    dwellSource: "probe",
    // Keep tab timer off when probe owns dwell.
    visibleSince: visible ? session.visibleSince || Date.now() : null,
    lastProbeAt: Date.now(),
  };
  await saveSessions(sessions);

  if (capped >= DWELL_CAP_MS) {
    return settleSession(tabId);
  }
  return sessions[key];
}

export async function beginSession(tabId, url, committedAt) {
  const state = await loadState();
  const gate = shouldCountVisit(url, state.recentVisitMap);
  if (!gate.ok) return null;

  const now = Date.now();
  const pending = await loadPendingCommits();
  const pendingCommit = pending[String(tabId)];
  delete pending[String(tabId)];
  await savePendingCommits(pending);

  const commitTs =
    typeof committedAt === "number" && committedAt > 0
      ? committedAt
      : pendingCommit?.committedAt;
  const loadMs =
    typeof commitTs === "number" && commitTs > 0
      ? Math.max(50, Math.min(30_000, now - commitTs))
      : 900;

  const isActive = activeTabId === tabId;
  const session = {
    tabId,
    url: gate.canonical,
    startedAt: now,
    committedAt: commitTs || now,
    loadMs,
    dwellAccumMs: 0,
    dwellSource: "tab",
    visibleSince: isActive ? now : null,
    settled: false,
  };
  await patchSession(tabId, session);
  return session;
}

export async function markCommitted(tabId, url, timeMs) {
  const pending = await loadPendingCommits();
  pending[String(tabId)] = {
    url,
    committedAt: timeMs || Date.now(),
  };
  await savePendingCommits(pending);
}

export async function onTabActivated(tabId) {
  const now = Date.now();
  const sessions = await loadSessions();

  if (activeTabId != null && sessions[String(activeTabId)]) {
    sessions[String(activeTabId)] = flushVisible(sessions[String(activeTabId)], now);
  }

  activeTabId = tabId;
  const key = String(tabId);
  if (sessions[key] && !sessions[key].settled) {
    const s = sessions[key];
    sessions[key] = {
      ...s,
      // Only start tab timer if probe hasn't taken over.
      visibleSince: s.dwellSource === "probe" ? s.visibleSince : now,
    };
  }
  await saveSessions(sessions);
}

export async function onWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (activeTabId == null) return;
    const sessions = await loadSessions();
    const key = String(activeTabId);
    if (sessions[key]) {
      sessions[key] = flushVisible(sessions[key], Date.now());
      await saveSessions(sessions);
    }
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id != null) await onTabActivated(tab.id);
  } catch {
    // ignore
  }
}

/**
 * Core settle from a session object (live tab or recovery orphan).
 * @param {object} session
 * @param {{ removeTabId?: number|null }} [opts]
 */
export async function settleSessionData(session, opts = {}) {
  if (!session || session.settled || !session.url) return null;

  const now = Date.now();
  const flushed = flushVisible(session, now);
  const url = flushed.url;
  let result = null;

  await updateState((state) => {
    const gate = shouldCountVisit(url, state.recentVisitMap, now);
    if (!gate.ok) {
      return {
        ...state,
        recentVisitMap: pruneRecentVisitMap(state.recentVisitMap, now),
      };
    }

    const host = (() => {
      try {
        return new URL(gate.canonical).host;
      } catch {
        return "unknown";
      }
    })();
    const hk = hostKey(host);
    let pathKey = gate.canonical;
    try {
      const u = new URL(gate.canonical);
      pathKey = `${u.origin}${u.pathname}`;
    } catch {
      // keep
    }

    /** @type {'first_host' | 'new_path' | 'seen_path' | 'default'} */
    let freshKind = "default";
    if (!state.hostDayMap[hk]) freshKind = "first_host";
    else if (!state.pathDayMap[pathKey]) freshKind = "new_path";
    else freshKind = "seen_path";

    const dwellMs = Math.min(DWELL_CAP_MS, flushed.dwellAccumMs || 0);
    const effectiveDwell = dwellMs > 0 ? dwellMs : 1500;
    const loadMs = flushed.loadMs || 900;

    const scores = buildScores({
      dwellMs: effectiveDwell,
      loadMs,
      freshKind,
      typeScore: pageTypeScore(gate.canonical),
    });
    const deposit = computeDeposit(scores);
    const reason = `${deposit.reason} · ${formatDwell(effectiveDwell)}`;

    const formulaDetail = {
      ts: now,
      url: gate.canonical,
      host,
      amount: deposit.deposit,
      score: deposit.score,
      raw: deposit.raw,
      noise: deposit.noise,
      reason,
      weights: { ...WEIGHTS },
      scores: { ...scores },
      dwellMs: effectiveDwell,
      loadMs,
      freshKind,
      dwellSource: flushed.dwellSource || "tab",
    };

    let next = applyDeposit(
      state,
      {
        url: gate.canonical,
        host,
        amount: deposit.deposit,
        score: deposit.score,
        metrics: {
          dwellMs: effectiveDwell,
          loadMs,
          dwell: scores.dwell,
          load: scores.load,
          fresh: scores.fresh,
          type: scores.type,
        },
        reason,
      },
      formulaDetail
    );

    next = {
      ...next,
      recentVisitMap: {
        ...pruneRecentVisitMap(next.recentVisitMap, now),
        [gate.canonical]: now,
      },
      hostDayMap: { ...next.hostDayMap, [hk]: true },
      pathDayMap: { ...next.pathDayMap, [pathKey]: true },
    };

    result = next.recentEntries[0];
    return next;
  });

  if (opts.removeTabId != null) {
    await removeSession(opts.removeTabId);
  }

  await refreshBadge();
  return result;
}

export async function settleSession(tabId, opts = {}) {
  const sessions = await loadSessions();
  const key = String(tabId);
  let session = sessions[key];
  if (!session || session.settled) {
    await removeSession(tabId);
    return null;
  }
  if (opts.forceUrl) session = { ...session, url: opts.forceUrl };
  return settleSessionData(session, { removeTabId: tabId });
}

/**
 * Full document navigation (not SPA history).
 */
export async function onNavigationCompleted(details) {
  if (details.frameId !== 0) return;
  const tabId = details.tabId;
  if (tabId < 0) return;

  // Skip pure history / SPA updates — those go through onHistoryStateUpdated when enabled.
  const tt = details.transitionType;
  if (tt === "auto_subframe" || tt === "manual_subframe") return;

  const sessions = await loadSessions();
  const existing = sessions[String(tabId)];
  if (existing && !existing.settled && existing.url) {
    await settleSession(tabId);
  }

  await beginSession(tabId, details.url);
}

/**
 * Optional SPA / pushState counting. Off by default per PRD「宁可少算」.
 */
export async function onHistoryStateUpdated(details) {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const state = await loadState();
  if (!state.settings?.countSpaNavigations) return;

  const tabId = details.tabId;
  const sessions = await loadSessions();
  const existing = sessions[String(tabId)];
  if (existing && !existing.settled && existing.url) {
    // Same document new path — settle previous path then start new.
    const prevCanonical = existing.url;
    try {
      const nextCanon = details.url;
      if (prevCanonical === nextCanon) return;
    } catch {
      // continue
    }
    await settleSession(tabId);
  }
  await beginSession(tabId, details.url, Date.now() - 400);
}

export async function onTabRemoved(tabId) {
  await settleSession(tabId);
  if (activeTabId === tabId) activeTabId = null;
}

/**
 * Find sessions whose tabs are gone; queue for recovery UI instead of silently dropping.
 */
export async function scanOrphanSessions() {
  const sessions = await loadSessions();
  let liveIds = new Set();
  try {
    const tabs = await chrome.tabs.query({});
    liveIds = new Set(tabs.map((t) => t.id).filter((id) => id != null));
  } catch {
    return [];
  }

  const kept = {};
  const orphans = [];
  const now = Date.now();

  for (const [key, session] of Object.entries(sessions)) {
    if (!session || session.settled) continue;
    const id = Number(key);
    if (liveIds.has(id)) {
      kept[key] = session;
      continue;
    }
    orphans.push({
      ...flushVisible(session, now),
      tabId: id,
      orphanedAt: now,
    });
  }

  await saveSessions(kept);

  if (!orphans.length) return [];

  await updateState((state) => {
    const merged = [...(state.pendingRecoveries || []), ...orphans]
      .filter((x) => x && x.url)
      .slice(0, 20);
    // de-dupe by url+startedAt
    const seen = new Set();
    const unique = [];
    for (const item of merged) {
      const k = `${item.url}|${item.startedAt || 0}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(item);
    }
    return { ...state, pendingRecoveries: unique };
  });

  return orphans;
}

export async function settleRecoveries() {
  const state = await loadState();
  const list = [...(state.pendingRecoveries || [])];
  state.pendingRecoveries = [];
  await saveState(state);

  for (const item of list) {
    await settleSessionData(item, { removeTabId: null });
  }
  return loadState();
}

export async function discardRecoveries() {
  return updateState((state) => ({
    ...state,
    pendingRecoveries: [],
  }));
}

export async function refreshBadge() {
  try {
    const state = await loadState();
    const text =
      state.todayAsset >= 100
        ? String(Math.floor(state.todayAsset))
        : state.todayAsset > 0
          ? state.todayAsset.toFixed(0)
          : "";
    await chrome.action.setBadgeBackgroundColor({ color: "#0f5c4c" });
    await chrome.action.setBadgeText({ text });
  } catch {
    // ignore
  }
}

/**
 * Snapshot of the active tab's in-progress session for Popup status.
 */
export async function getActiveSessionSnapshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) return null;
    const sessions = await loadSessions();
    const session = sessions[String(tab.id)];
    if (!session || session.settled || !session.url) {
      return {
        tracking: false,
        tabId: tab.id,
        url: tab.url,
        title: tab.title || "",
      };
    }
    const now = Date.now();
    let dwellMs = session.dwellAccumMs || 0;
    if (session.dwellSource !== "probe" && session.visibleSince) {
      dwellMs += Math.max(0, now - session.visibleSince);
    }
    return {
      tracking: true,
      tabId: tab.id,
      url: session.url,
      title: tab.title || "",
      dwellMs: Math.min(DWELL_CAP_MS, dwellMs),
      dwellSource: session.dwellSource || "tab",
      startedAt: session.startedAt || now,
    };
  } catch {
    return null;
  }
}

export async function initActiveTab() {
  await scanOrphanSessions();
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) {
      activeTabId = tab.id;
      await onTabActivated(tab.id);
    }
  } catch {
    // ignore
  }
  await refreshBadge();
}

export async function settleIfDwellCapped() {
  const sessions = await loadSessions();
  const now = Date.now();
  for (const [key, session] of Object.entries(sessions)) {
    if (!session || session.settled) continue;
    const flushed = flushVisible(session, now);
    if ((flushed.dwellAccumMs || 0) >= DWELL_CAP_MS) {
      await settleSession(Number(key));
    } else {
      sessions[key] = flushed;
      if (activeTabId === Number(key) && flushed.dwellSource !== "probe") {
        sessions[key].visibleSince = now;
      }
    }
  }
  await saveSessions(sessions);
}

export async function dismissAchievement() {
  const state = await loadState();
  state.pendingAchievement = null;
  await saveState(state);
  return state;
}

export async function updateSettings(patch) {
  return updateState((state) => ({
    ...state,
    settings: {
      ...(state.settings || {}),
      ...patch,
    },
  }));
}
