import { syncAchievements } from '../core/achievements.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyDeposit, ensureDayRollover } from '../core/ledger.js';
import { ESTATE_LEVELS, estateHost, estatePurchasePrice, purchaseEstate, upgradeEstate } from '../core/estate.js';
import { assetOverview } from '../core/overview.js';
import { walletBalance, purchaseUpgrade } from '../core/shop.js';

const visit = (host = 'www.example.com', dwellMs = 15000) => ({
  url: `https://${host}/article`, host, amount: 5, metrics: { dwellMs }, reason: '浏览',
});
const owned = () => purchaseEstate(applyDeposit({ ...defaultState(), totalAsset: 10000 }, visit()), 'example.com');

test('hostname boundaries and discoveries use valid browsing only', () => {
  assert.equal(estateHost('https://WWW.Example.com:8080/a'), 'example.com');
  assert.equal(estateHost('https://user.github.io/a'), 'user.github.io');
  assert.equal(estateHost('https://docs.example.com'), 'docs.example.com');
  assert.equal(estateHost('chrome://settings'), null);
  assert.equal(estateHost('bad'), null);
  let state = defaultState();
  for (let i = 0; i < 110; i++) state = applyDeposit(state, visit(`s${i}.test`));
  assert.equal(state.estateDiscoveries.length, 100);
  assert.throws(() => purchaseEstate(state, 'unknown.test'), /先有效浏览/);
  assert.equal(applyDeposit(defaultState(), { kind: 'task_reward', amount: 100 }).estateDiscoveries.length, 0);
});

test('purchase preserves old fields and debits the shared wallet separately', () => {
  const before = applyDeposit({ ...defaultState(), totalAsset: 1000, shopSpent: 50, shopLevels: { notebook: 1 } }, visit());
  const copy = structuredClone(before);
  const after = purchaseEstate(before, 'example.com');
  for (const key of Object.keys(before).filter(key => !['estates', 'estateSpent'].includes(key))) assert.deepEqual(after[key], before[key], key);
  assert.equal(walletBalance(after), walletBalance(before) - 500);
  assert.equal(after.shopSpent, 50);
  assert.deepEqual(before, copy);
  assert.throws(() => purchaseEstate(after, 'example.com'), /已持有/);
  assert.throws(() => purchaseEstate({ ...before, totalAsset: 549.99 }, 'example.com'), /余额不足/);
  const exact = purchaseEstate({ ...before, totalAsset: 550 }, 'example.com');
  assert.equal(walletBalance(exact), 0);
  assert.throws(() => purchaseUpgrade(exact, 'notebook'), /余额不足/);
  let state = owned();
  for (const host of ['a.test', 'b.test']) state = purchaseEstate(applyDeposit(state, visit(host)), host);
  state = applyDeposit(state, visit('c.test'));
  assert.throws(() => purchaseEstate(state, 'c.test', 2000), /报价已变化/);
  const expanded = purchaseEstate(state, 'c.test', 4000);
  assert.equal(expanded.estates.length, 4);
  assert.deepEqual(expanded.estates.map(estate => estate.purchasePrice), [500, 1000, 2000, 4000]);
  assert.equal(Math.round((walletBalance(state) - walletBalance(expanded)) * 100), 400000);
  assert.equal(assetOverview(expanded).estates, 7500);
  assert.equal(estatePurchasePrice(9), 256000);
  assert.equal(estatePurchasePrice(10), 512000);
  assert.equal(estatePurchasePrice(19), 2816000);
});

test('operations credit unmultiplied income without extra visits/tasks and cap at three', () => {
  let state = { ...owned(), shopLevels: { engine: 10 } };
  let next = applyDeposit(state, visit('example.com', 14999));
  assert.equal(next.estates[0].visits, 0);
  state = next;
  const before = structuredClone(state);
  next = applyDeposit(state, visit(), { amount: 5 });
  assert.equal(Math.round((next.totalAsset - before.totalAsset) * 100) / 100, 56.36); // browsing 55.35 + estate 1.01
  assert.equal(next.totalVisits, before.totalVisits + 1);
  assert.equal(next.weekly.deepReads, before.weekly.deepReads);
  assert.equal(next.recentEntries[0].kind, 'estate_income');
  assert.equal(next.recentEntries[0].amount, 1.01);
  assert.equal(next.lastFormula.amount, 55.35);
  assert.equal(next.dailyHistory[next.dayKey].asset, next.todayAsset);
  for (let i = 0; i < 5; i++) next = applyDeposit(next, visit());
  assert.equal(next.estates[0].dailyVisits, 3);
  assert.equal(next.estates[0].visits, 3);
  assert.equal(next.estates[0].income, 3.03);
  assert.equal(next.estates[0].days, 1);
  const other = applyDeposit(next, visit('docs.example.com'));
  assert.deepEqual(other.estates, next.estates);
  const rewarded = applyDeposit(next, { kind: 'task_reward', amount: 100 });
  assert.deepEqual(rewarded.estates, next.estates);
  // Simulate previous local day; rollover keeps holdings, a new day refreshes quota.
  const old = { ...next, dayKey: '2020-01-01', estates: next.estates.map(e => ({ ...e, lastDay: '2020-01-01' })) };
  const rolled = applyDeposit(ensureDayRollover(old), visit());
  assert.equal(rolled.estates[0].dailyVisits, 1);
  assert.equal(rolled.estates[0].days, 2);
});

test('upgrades through the national group require money, visits and days without changing past earnings', () => {
  let state = owned();
  assert.throws(() => upgradeEstate(state, 'example.com'), /尚未达标/);
  state = { ...state, totalAsset: 250000, estates: state.estates.map(e => ({ ...e, visits: 195, days: 65 })) };
  for (let level = 2; level <= ESTATE_LEVELS.length; level++) {
    const next = upgradeEstate(state, 'example.com');
    assert.equal(next.estates[0].level, level);
    assert.equal(next.totalAsset, state.totalAsset);
    assert.equal(next.shopSpent, state.shopSpent);
    assert.deepEqual(next.recentEntries, state.recentEntries);
    assert.equal(assetOverview(next).estates, next.estateSpent);
    state = next;
  }
  assert.throws(() => upgradeEstate(state, 'example.com'), /满级/);
  assert.equal(applyDeposit(state, visit()).recentEntries[0].amount, 25);
  const poor = { ...owned(), totalAsset: 500, estates: state.estates.map(e => ({ ...e, level: 1 })) };
  assert.throws(() => upgradeEstate(poor, 'example.com'), /余额不足/);
});

test('schemas 1–4 preserve every existing field, snapshot and sessions across migration', async () => {
  const { loadState } = await import('../storage/repository.js');
  for (const version of [1, 2, 3, 4]) {
    const old = { ...defaultState(), schemaVersion: version, totalAsset: 12345.67, shopSpent: 250,
      shopLevels: { notebook: 3, engine: 2 }, shopPurchases: [{ itemId: 'notebook', price: 50 }],
      settings: { countSpaNavigations: true, autoSettleRecoveries: true, showFormulaDebug: false },
      pendingRecoveries: [{ url: 'https://old.test' }], lastFormula: { amount: 7 },
      recentEntries: [{ ...visit(), amount: 7 }], customFutureField: { untouched: true } };
    delete old.estates; delete old.estateSpent; delete old.estateDiscoveries;
    let stored = { assetMeterState: structuredClone(old), assetMeterSessions: { 3: { url: 'https://live.test' } } };
    const sessions = structuredClone(stored.assetMeterSessions);
    globalThis.chrome = { storage: { local: {
      get: async key => structuredClone({ [key]: stored[key] }),
      set: async patch => { stored = { ...stored, ...structuredClone(patch) }; },
    } } };
    const migrated = await loadState();
    for (const key of Object.keys(old).filter(k => k !== 'schemaVersion')) assert.deepEqual(migrated[key], key === 'unlockedAchievements' ? syncAchievements(old).unlockedAchievements : old[key], key);
    assert.equal(migrated.schemaVersion, 6);
    assert.equal(walletBalance(migrated), 12095.67);
    assert.deepEqual(migrated.estates, []);
    assert.equal(migrated.estateSpent, 0);
    assert.equal(migrated.estateDiscoveries[0].host, 'example.com');
    assert.deepEqual(stored.assetMeterBackupBeforeSchema6, old);
    assert.deepEqual(stored.assetMeterSessions, sessions);
    assert.deepEqual(await loadState(), migrated);
    assert.deepEqual(stored.assetMeterBackupBeforeSchema6, old);
  }
});

test('concurrent purchases, duplicate settlements and resetToday preserve limits', async () => {
  let stored = { assetMeterState: owned() };
  globalThis.chrome = { storage: { local: {
    get: async key => structuredClone({ [key]: stored[key] }),
    set: async patch => { stored = { ...stored, ...structuredClone(patch) }; },
    remove: async keys => { for (const key of keys) delete stored[key]; },
  } }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} } };
  const { updateState, loadState, resetToday, resetAll } = await import('../storage/repository.js');
  await updateState(s => applyDeposit(s, visit('new.test')));
  const result = await Promise.allSettled([updateState(s => purchaseEstate(s, 'new.test')), updateState(s => purchaseEstate(s, 'new.test'))]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const { settleSessionData } = await import('../background/session-tracker.js');
  const session = { url: 'https://example.com/dedupe', dwellAccumMs: 60000, dwellSource: 'probe' };
  await settleSessionData(session);
  const first = await loadState();
  await settleSessionData(session);
  assert.equal((await loadState()).totalAsset, first.totalAsset);
  assert.deepEqual((await resetToday()).estates, first.estates);
  const reset = await resetAll();
  assert.deepEqual(reset.estates, []);
  assert.equal(reset.estateSpent, 0);
});
