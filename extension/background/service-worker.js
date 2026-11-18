import { sellAtMarket } from '../core/market.js';
import { toggleDisplayCollectible } from '../core/journey.js';
import { sellAsset, tradeAsset } from '../core/exchange.js';
import { investProject, exitProject } from '../core/investments.js';
import { sellCollectible } from "../core/collectibles.js";
import { purchaseUpgrade } from "../core/shop.js";
import { purchaseEstate, upgradeEstate } from "../core/estate.js";
import { createCompany, manageCompany } from '../core/company.js';
import {
  restoreBackup,
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
import { exportBackup, loadState, resetAll, resetToday, updateState } from "../storage/repository.js";
import { buildWeekSeries, claimWeeklyReward } from "../core/ledger.js";

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
          await applyDwellFromProbe(tabId, message.dwellMs || 0, message.visible !== false, message.pageElements, sender.url);
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "CLAIM_WEEKLY_REWARD") {
        const state = await updateState(current => claimWeeklyReward(current, message.taskId, message.weekKey));
        await refreshBadge();
        sendResponse({ ok: true, state, week: buildWeekSeries(state,7) });
        return;
      }
      if (message?.type === 'TOGGLE_DISPLAY_COLLECTIBLE') {
        if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('请从扩展收藏页操作');
        const state = await updateState(current => toggleDisplayCollectible(current, message.id));
        sendResponse({ ok: true, state }); return;
      }
      if (message?.type === 'BUY_ESTATE' || message?.type === 'UPGRADE_ESTATE') {
        const state = await updateState(current => message.type === 'BUY_ESTATE'
          ? purchaseEstate(current, message.host) : upgradeEstate(current, message.host));
        sendResponse({ ok: true, state, week: buildWeekSeries(state, 7) });
        return;
      }
      if (message?.type === 'MANAGE_COMPANY') {
        const state = await updateState(current => manageCompany(current, message.id, message.action, message.value));
        sendResponse({ ok: true, state }); return;
      }
      if (message?.type === 'CREATE_COMPANY') {
        const state = await updateState(current => createCompany(current, message.name, message.companyType, message.headquarters));
        sendResponse({ ok: true, state, week: buildWeekSeries(state, 7) });
        return;
      }
      if (['MARKET_SELL', 'SELL_ASSET', 'TRADE_ASSET', 'INVEST_PROJECT', 'EXIT_PROJECT'].includes(message?.type)) {
        if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(''))) throw new Error('请从扩展资产页面操作');
        const state = await updateState(current => {
          if (message.type === 'MARKET_SELL') return sellAtMarket(current, message.id, message.mode, message.week, message.price);
          if (message.type === 'SELL_ASSET') return sellAsset(current, message.kind, message.id, message.price);
          if (message.type === 'TRADE_ASSET') return tradeAsset(current, message.kind, message.id, message.target, message.price);
          if (message.type === 'INVEST_PROJECT') return investProject(current, message.projectId, message.units ?? NaN);
          return exitProject(current, message.id, message.units ?? null);
        });
        sendResponse({ ok: true, state }); return;
      }
      if (message?.type === 'SELL_COLLECTIBLE') {
        if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('请从收藏品页面出售');
        const state = await updateState(current => sellAtMarket(current, message.id, 'market', message.week, message.price));
        sendResponse({ ok: true, state });
        return;
      }
      if (message?.type === "BUY_UPGRADE") {
        const state = await updateState((current) => purchaseUpgrade(current, message.itemId));
        sendResponse({ ok: true, state, week: buildWeekSeries(state, 7) });
        return;
      }
      if (message?.type === 'EXPORT_BACKUP' || message?.type === 'IMPORT_BACKUP') {
        if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('请从设置页操作');
        if (message.type === 'EXPORT_BACKUP') sendResponse({ ok: true, backup: await exportBackup() });
        else {
          const state = await restoreBackup(message.backup);
          await refreshBadge();
          sendResponse({ ok: true, state, week: buildWeekSeries(state, 7) });
        }
        return;
      }
      if (message?.type === "GET_STATE") {
        const state = await loadState();
        const week = buildWeekSeries(state, 7);
        const activeSession = await getActiveSessionSnapshot();
        sendResponse({ ok: true, state, week, activeSession, features: { companies: true, companyManagement: true } });
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
        if (typeof message.autoSettleRecoveries === "boolean") {
          patch.autoSettleRecoveries = message.autoSettleRecoveries;
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
