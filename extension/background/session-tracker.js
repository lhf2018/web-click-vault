import { cleanPageElements } from "../core/collectibles.js";
import { canonicalizeUrl } from "../core/url.js";
import { DWELL_CAP_MS, WEIGHTS } from "../core/constants.js";
import { computeDeposit, formatDwell } from "../core/formula.js";
import { applyDeposit } from "../core/ledger.js";
import { buildScores } from "../core/metrics.js";
import { hostKey, pageTypeScore } from "../core/url.js";
import { shouldCountVisit, pruneRecentVisitMap } from "./navigation-guard.js";
import {
  importBackup,
  loadSessions,
  loadState,
  saveSessions,
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
async function applyDwellFromProbeImpl(tabId, dwellMs, visible = true, pageElements = null, pageUrl = null) {
  const sessions = await loadSessions();
  const key = String(tabId);
  const session = sessions[key];
  if (!session || session.settled) return null;

  const total = Math.max(0, Number(dwellMs) || 0);
  if (total < (session.probeBaseline || 0)) return null;
  const capped = Math.min(DWELL_CAP_MS, total - (session.probeBaseline || 0));
  sessions[key] = {
    ...session,
    dwellAccumMs: Math.max(session.dwellAccumMs || 0, capped),
    pageElements: pageElements && canonicalizeUrl(pageUrl) === session.url ? cleanPageElements(pageElements) : session.pageElements,
    dwellSource: "probe",
    probeTotalMs: total,
    probeVisible: visible,
    // Keep tab timer off when probe owns dwell.
    visibleSince: visible ? session.visibleSince || Date.now() : null,
    lastProbeAt: Date.now(),
  };
  await saveSessions(sessions);

  if (capped >= DWELL_CAP_MS) {
    return settleSessionImpl(tabId);
  }
  return sessions[key];
}

async function beginSessionImpl(tabId, url, committedAt) {
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
    pageElements: null,
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

async function markCommittedImpl(tabId, url, timeMs) {
  const pending = await loadPendingCommits();
  pending[String(tabId)] = {
    url,
    committedAt: timeMs || Date.now(),
  };
  await savePendingCommits(pending);
}

async function onTabActivatedImpl(tabId) {
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

async function onWindowFocusChangedImpl(windowId) {
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
    if (tab?.id != null) await onTabActivatedImpl(tab.id);
  } catch {
    // ignore
  }
}

/**
 * Core settle from a session object (live tab or recovery orphan).
 * @param {object} session
 * @param {{ removeTabId?: number|null }} [opts]
 */
async function settleSessionDataImpl(session, opts = {}) {
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
        pageElements: flushed.pageElements,
        host,
        amount: deposit.deposit,
        score: deposit.score,
        metrics: {
          freshKind,
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

  await refreshBadgeImpl();
  return result;
}

async function settleSessionImpl(tabId, opts = {}) {
  const sessions = await loadSessions();
  const key = String(tabId);
  let session = sessions[key];
  if (!session || session.settled) {
    await removeSession(tabId);
    return null;
  }
  if (opts.forceUrl) session = { ...session, url: opts.forceUrl };
  return settleSessionDataImpl(session, { removeTabId: tabId });
}

/**
 * Full document navigation (not SPA history).
 */
async function onNavigationCompletedImpl(details) {
  if (details.frameId !== 0) return;
  const tabId = details.tabId;
  if (tabId < 0) return;

  // Skip pure history / SPA updates — those go through onHistoryStateUpdatedImpl when enabled.
  const tt = details.transitionType;
  if (tt === "auto_subframe" || tt === "manual_subframe") return;

  const sessions = await loadSessions();
  const existing = sessions[String(tabId)];
  if (existing && !existing.settled && existing.url) {
    await settleSessionImpl(tabId);
  }

  await beginSessionImpl(tabId, details.url);
}

/**
 * Optional SPA / pushState counting. Off by default per PRD「宁可少算」.
 */
async function onHistoryStateUpdatedImpl(details) {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const state = await loadState();
  if (!state.settings?.countSpaNavigations) return;

  const tabId = details.tabId;
  let probe = null;
  try { probe = await chrome.tabs.sendMessage(tabId, { type: "GET_DWELL" }); } catch {}
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
    if (Number.isFinite(probe?.dwellMs)) {
      await applyDwellFromProbeImpl(tabId, probe.dwellMs, probe.visible);
    }
    await settleSessionImpl(tabId);
  }
  const next = await beginSessionImpl(tabId, details.url, Date.now() - 400);
  if (next) {
    const baseline = Number.isFinite(probe?.dwellMs) ? probe.dwellMs
      : (existing?.probeTotalMs || 0) + (existing?.probeVisible ? Math.max(0, Date.now() - existing.lastProbeAt) : 0);
    await patchSession(tabId, { probeBaseline: baseline });
  }
}

async function onTabRemovedImpl(tabId) {
  await settleSessionImpl(tabId);
  if (activeTabId === tabId) activeTabId = null;
}

/**
 * Find sessions whose tabs are gone; queue for recovery UI instead of silently dropping.
 */
async function scanOrphanSessionsImpl() {
  // Also drain records saved by an earlier extension run, even if no new orphans exist.
  await maybeAutoSettleRecoveries();
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

  await maybeAutoSettleRecoveries();
  return orphans;
}

async function maybeAutoSettleRecoveries() {
  const state = await loadState();
  if (state.settings?.autoSettleRecoveries && state.pendingRecoveries?.length) {
    return settleRecoveriesImpl();
  }
  return state;
}

async function settleRecoveriesImpl() {
  let list = [];
  await updateState((state) => {
    list = [...(state.pendingRecoveries || [])];
    return { ...state, pendingRecoveries: [] };
  });

  for (const item of list) {
    await settleSessionDataImpl(item, { removeTabId: null });
  }
  return loadState();
}

async function discardRecoveriesImpl() {
  return updateState((state) => ({
    ...state,
    pendingRecoveries: [],
  }));
}

async function refreshBadgeImpl() {
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
async function getActiveSessionSnapshotImpl() {
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

async function initActiveTabImpl() {
  await scanOrphanSessionsImpl();
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) {
      activeTabId = tab.id;
      await onTabActivatedImpl(tab.id);
    }
  } catch {
    // ignore
  }
  await refreshBadgeImpl();
}

async function settleIfDwellCappedImpl() {
  const sessions = await loadSessions();
  const now = Date.now();
  for (const [key, session] of Object.entries(sessions)) {
    if (!session || session.settled) continue;
    const flushed = flushVisible(session, now);
    if ((flushed.dwellAccumMs || 0) >= DWELL_CAP_MS) {
      await settleSessionImpl(Number(key));
      delete sessions[key];
    } else {
      sessions[key] = flushed;
      if (activeTabId === Number(key) && flushed.dwellSource !== "probe") {
        sessions[key].visibleSince = now;
      }
    }
  }
  await saveSessions(sessions);
}

async function dismissAchievementImpl() {
  return updateState((state) => ({ ...state, pendingAchievement: null }));
}

async function updateSettingsImpl(patch) {
  await updateState((state) => ({
    ...state,
    settings: {
      ...(state.settings || {}),
      ...patch,
    },
  }));
  return maybeAutoSettleRecoveries();
}

let sessionQueue = Promise.resolve();
function enqueueSession(operation) {
  const result = sessionQueue.then(operation);
  sessionQueue = result.catch(() => {});
  return result;
}
export function applyDwellFromProbe(...args) { return enqueueSession(() => applyDwellFromProbeImpl(...args)); }
export function beginSession(...args) { return enqueueSession(() => beginSessionImpl(...args)); }
export function markCommitted(...args) { return enqueueSession(() => markCommittedImpl(...args)); }
export function onTabActivated(...args) { return enqueueSession(() => onTabActivatedImpl(...args)); }
export function onWindowFocusChanged(...args) { return enqueueSession(() => onWindowFocusChangedImpl(...args)); }
export function settleSessionData(...args) { return enqueueSession(() => settleSessionDataImpl(...args)); }
export function settleSession(...args) { return enqueueSession(() => settleSessionImpl(...args)); }
export function onNavigationCompleted(...args) { return enqueueSession(() => onNavigationCompletedImpl(...args)); }
export function onHistoryStateUpdated(...args) { return enqueueSession(() => onHistoryStateUpdatedImpl(...args)); }
export function onTabRemoved(...args) { return enqueueSession(() => onTabRemovedImpl(...args)); }
export function scanOrphanSessions(...args) { return enqueueSession(() => scanOrphanSessionsImpl(...args)); }
export function settleRecoveries(...args) { return enqueueSession(() => settleRecoveriesImpl(...args)); }
export function discardRecoveries(...args) { return enqueueSession(() => discardRecoveriesImpl(...args)); }
export function refreshBadge(...args) { return enqueueSession(() => refreshBadgeImpl(...args)); }
export function getActiveSessionSnapshot(...args) { return enqueueSession(() => getActiveSessionSnapshotImpl(...args)); }
export function initActiveTab(...args) { return enqueueSession(() => initActiveTabImpl(...args)); }
export function settleIfDwellCapped(...args) { return enqueueSession(() => settleIfDwellCappedImpl(...args)); }
export function dismissAchievement(...args) { return enqueueSession(() => dismissAchievementImpl(...args)); }
export function updateSettings(...args) { return enqueueSession(() => updateSettingsImpl(...args)); }

export function restoreBackup(backup) { return enqueueSession(() => importBackup(backup)); }
