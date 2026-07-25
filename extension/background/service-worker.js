import {
  applyDwellFromProbe,
  discardRecoveries,
  dismissAchievement,
  getActiveSessionSnapshot,
  initActiveTab,
  markCommitted,
  onHistoryStateUpdated,
  onNavigationCompleted,
  onTabActivated,
  onTabRemoved,
  onWindowFocusChanged,
  refreshBadge,
  scanOrphanSessions,
  settleIfDwellCapped,
  settleRecoveries,
  settleSession,
  updateSettings,
} from "./session-tracker.js";
import { loadState, resetAll, resetToday } from "../storage/repository.js";
import { buildWeekSeries } from "../core/ledger.js";

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  await initActiveTab();
  chrome.alarms.create("dwellSweep", { periodInMinutes: 1 });
  chrome.alarms.create("dayCheck", { periodInMinutes: 30 });
  chrome.alarms.create("orphanScan", { periodInMinutes: 5 });
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  await initActiveTab();
  chrome.alarms.create("dwellSweep", { periodInMinutes: 1 });
  chrome.alarms.create("orphanScan", { periodInMinutes: 5 });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  // Ignore history / SPA commits for load timing baseline unless SPA mode is on — still record commit for full loads.
  if (details.transitionQualifiers?.includes("forward_back")) {
    // still ok to mark
  }
  markCommitted(details.tabId, details.url, details.timeStamp || Date.now());
});

chrome.webNavigation.onCompleted.addListener((details) => {
  onNavigationCompleted(details);
});

// SPA / pushState — only acts when settings.countSpaNavigations === true
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  onHistoryStateUpdated(details);
});

chrome.tabs.onActivated.addListener(async (info) => {
  await onTabActivated(info.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  onTabRemoved(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  onWindowFocusChanged(windowId);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "dwellSweep") {
    await settleIfDwellCapped();
  }
  if (alarm.name === "dayCheck") {
    await loadState();
    await refreshBadge();
  }
  if (alarm.name === "orphanScan") {
    await scanOrphanSessions();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "DWELL_TICK" || message?.type === "DWELL_VISIBLE") {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          await applyDwellFromProbe(tabId, message.dwellMs || 0, message.visible !== false);
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "GET_STATE") {
        const state = await loadState();
        const week = buildWeekSeries(state, 7);
        const activeSession = await getActiveSessionSnapshot();
        sendResponse({ ok: true, state, week, activeSession });
        return;
      }
      if (message?.type === "DISMISS_ACHIEVEMENT") {
        const state = await dismissAchievement();
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession: await getActiveSessionSnapshot(),
        });
        return;
      }
      if (message?.type === "RESET_TODAY") {
        const state = await resetToday();
        await refreshBadge();
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession: await getActiveSessionSnapshot(),
        });
        return;
      }
      if (message?.type === "RESET_ALL") {
        const state = await resetAll();
        await refreshBadge();
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession: await getActiveSessionSnapshot(),
        });
        return;
      }
      if (message?.type === "SET_SETTINGS") {
        const patch = {};
        if (typeof message.countSpaNavigations === "boolean") {
          patch.countSpaNavigations = message.countSpaNavigations;
        }
        if (typeof message.showFormulaDebug === "boolean") {
          patch.showFormulaDebug = message.showFormulaDebug;
        }
        const state = await updateSettings(patch);
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession: await getActiveSessionSnapshot(),
        });
        return;
      }
      if (message?.type === "SETTLE_ACTIVE") {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id != null) await settleSession(tab.id);
        const state = await loadState();
        const activeSession = await getActiveSessionSnapshot();
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession,
        });
        return;
      }
      if (message?.type === "RECOVER_SETTLE") {
        const state = await settleRecoveries();
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession: await getActiveSessionSnapshot(),
        });
        return;
      }
      if (message?.type === "RECOVER_DISCARD") {
        const state = await discardRecoveries();
        sendResponse({
          ok: true,
          state,
          week: buildWeekSeries(state, 7),
          activeSession: await getActiveSessionSnapshot(),
        });
        return;
      }
      sendResponse({ ok: false, error: "unknown_message" });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

loadState().then(() => initActiveTab());
