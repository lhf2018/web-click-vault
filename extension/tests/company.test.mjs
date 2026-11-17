import { syncAchievements } from '../core/achievements.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { createCompany, companyLevel, recordCompanyVisit } from '../core/company.js';
import { walletBalance, purchaseUpgrade } from '../core/shop.js';
const funded = () => ({ ...defaultState(), totalAsset: 20000 });
const visit = (i, dwellMs = 60000) => ({ url: `https://s${i}.test/article`, host: `s${i}.test`, amount: 5, metrics: { dwellMs } });

test('multiple companies, progressive costs and validation preserve old ledger', () => {
  const old = funded();
  let state = createCompany(old, '小刊', 'publisher');
  state = createCompany(state, '远方', 'explorer');
  state = createCompany(state, '新刊', 'publisher');
  assert.equal(state.companies.length, 3);
  assert.equal(new Set(state.companies.map(c => c.id)).size, 3);
  assert.equal(state.companySpent, 6000);
  assert.equal(walletBalance(state), 14000);
  for (const key of Object.keys(old).filter(key => !['companies', 'companySpent'].includes(key))) assert.deepEqual(state[key], old[key], key);
  assert.equal(old.companies.length, 0);
  assert.throws(() => createCompany(state, ' 小刊 ', 'publisher'), /已存在/);
  assert.throws(() => createCompany(state, ' ', 'publisher'), /名称/);
  assert.throws(() => createCompany(state, 'a'.repeat(25), 'publisher'), /名称/);
  assert.throws(() => createCompany(state, '非法', 'bad'), /主营业务/);
  assert.throws(() => createCompany(state, '总部', 'publisher', 'unknown.test'), /已持有/);
  assert.throws(() => createCompany({ ...funded(), totalAsset: 999.99 }, '余额', 'publisher'), /余额不足/);
  const exact = createCompany({ ...funded(), totalAsset: 1000 }, '刚好', 'publisher');
  assert.equal(walletBalance(exact), 0);
  assert.throws(() => purchaseUpgrade(exact, 'notebook'), /余额不足/);
});

test('automatic orders complete independently and rewards do not cascade or receive equipment bonuses', () => {
  let state = createCompany(createCompany(createCompany(funded(), '甲', 'publisher'), '乙', 'publisher'), '丙', 'explorer');
  state = { ...state, shopLevels: { engine: 10 } };
  for (let i = 0; i < 3; i++) state = applyDeposit(state, visit(i));
  assert.deepEqual(state.companies.map(c => c.completed), [1, 1, 0]);
  assert.deepEqual(state.companies.map(c => c.order.seen.length), [0, 0, 3]);
  assert.equal(state.totalAsset, 20000 + 3 * 55 + 160);
  assert.equal(state.totalVisits, 3);
  assert.equal(state.weekly.deepReads, 3);
  assert.equal(state.recentEntries[0].kind, 'company_income');
  assert.equal(state.recentEntries[0].amount, 80);
  assert.equal(state.recentEntries[0].multiplier, 1);
  assert.equal(state.dailyHistory[state.dayKey].asset, state.todayAsset);
  for (let i = 3; i < 5; i++) state = applyDeposit(state, visit(i, 15000));
  assert.equal(state.companies[2].completed, 1);
  assert.equal(state.companies[2].income, 100);
  const before = structuredClone(state.companies);
  for (const kind of ['task_reward', 'estate_income', 'company_income']) state = applyDeposit(state, { kind, amount: 100, ...visit(10), metrics: { dwellMs: 60000 } });
  assert.deepEqual(state.companies, before);
});

test('thresholds, unique pages and hosts, level progression and bounded history', () => {
  let state = createCompany(funded(), '阅读', 'publisher');
  state = applyDeposit(state, visit(0, 59999));
  assert.equal(state.companies[0].order.seen.length, 0);
  state = applyDeposit(state, visit(0));
  state = applyDeposit(state, { ...visit(0), url: 'https://s0.test/article?x=1#new' });
  assert.equal(state.companies[0].order.seen.length, 1);
  state = applyDeposit(state, visit(1)); state = applyDeposit(state, visit(2));
  assert.equal(state.companies[0].completed, 1);
  assert.equal(state.companies[0].order.seen.length, 0);
  for (let i = 0; i < 12; i++) state = applyDeposit(state, visit(i));
  assert.equal(companyLevel(state.companies[0]), 2);
  assert.equal(state.companies[0].order.target, 4);
  assert.equal(state.companies[0].order.reward, 160);
  for (let i = 0; i < 300; i++) state = applyDeposit(state, visit(i));
  assert.equal(companyLevel(state.companies[0]), 5);
  assert.equal(state.companies[0].history.length, 30);
  const explorer = createCompany(funded(), '探索', 'explorer');
  const a = recordCompanyVisit(explorer, visit(0, 14999)).state;
  assert.equal(a.companies[0].order.seen.length, 0);
  const b = recordCompanyVisit(a, visit(0, 15000)).state;
  const c = recordCompanyVisit(b, { ...visit(0), url: 'https://www.s0.test/other' }).state;
  assert.equal(c.companies[0].order.seen.length, 1);
});

test('schema 5 migration preserves assets, estates, orders and the previous snapshot', async () => {
  const old = { ...funded(), schemaVersion: 5, estates: [{ host: 'old.test', level: 3, visits: 20 }], estateSpent: 3000, shopLevels: { engine: 3 }, custom: true };
  delete old.companies; delete old.companySpent;
  let stored = { assetMeterState: structuredClone(old), assetMeterBackupBeforeSchema5: { original: true }, assetMeterSessions: { 7: { url: 'https://live.test' } } };
  const original = structuredClone(stored);
  globalThis.chrome = { storage: { local: {
    get: async key => structuredClone({ [key]: stored[key] }), set: async patch => { stored = { ...stored, ...structuredClone(patch) }; },
    remove: async keys => { for (const key of keys) delete stored[key]; },
  } }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} } };
  const { loadState, updateState, resetToday, resetAll } = await import('../storage/repository.js');
  const migrated = await loadState();
  for (const key of Object.keys(old).filter(key => key !== 'schemaVersion')) assert.deepEqual(migrated[key], key === 'unlockedAchievements' ? syncAchievements(old).unlockedAchievements : old[key], key);
  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.companySpent, 0);
  assert.deepEqual(migrated.companies, []);
  assert.deepEqual(stored.assetMeterBackupBeforeSchema6, old);
  assert.deepEqual(stored.assetMeterBackupBeforeSchema5, original.assetMeterBackupBeforeSchema5);
  assert.deepEqual(stored.assetMeterSessions, original.assetMeterSessions);
  const results = await Promise.allSettled([updateState(s => createCompany(s, '唯一', 'publisher')), updateState(s => createCompany(s, '唯一', 'publisher'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const { settleSessionData } = await import('../background/session-tracker.js');
  for (let i = 0; i < 3; i++) await settleSessionData({ url: `https://new${i}.test/`, dwellAccumMs: 60000, dwellSource: 'probe' });
  const first = await loadState();
  await settleSessionData({ url: 'https://new2.test/', dwellAccumMs: 60000, dwellSource: 'probe' });
  assert.equal((await loadState()).totalAsset, first.totalAsset);
  assert.equal(first.companies[0].completed, 1);
  assert.deepEqual((await resetToday()).companies, first.companies);
  assert.deepEqual((await loadState()).companies, first.companies);
  assert.deepEqual((await resetAll()).companies, []);
  assert.equal(stored.assetMeterBackupBeforeSchema5, undefined);
  assert.equal(stored.assetMeterBackupBeforeSchema6, undefined);
});
