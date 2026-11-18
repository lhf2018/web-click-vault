import test from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENT_CATALOG, achievementBonuses, syncAchievements } from '../core/achievements.js';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { depositMultiplier } from '../core/shop.js';
import { recordEstateVisit } from '../core/estate.js';
import { createCompany, recordCompanyVisit } from '../core/company.js';
import { recordCollectibleVisit, collectibleDropRate } from '../core/collectibles.js';
const stateWith = (...ids) => ({ ...defaultState(), unlockedAchievements: ids });
const visit = { url: 'https://example.test/page', amount: 5, metrics: { dwellMs: 60000, freshKind: 'first_host' } };

test('all 54 achievements carry bounded rewards and duplicated unlock IDs cannot multiply them', () => {
  assert.equal(ACHIEVEMENT_CATALOG.length, 54);
  for (const item of ACHIEVEMENT_CATALOG) assert.ok(item.reward.bonus > 0 && item.reward.label);
  const earned = ACHIEVEMENT_CATALOG.map(item => item.id);
  const all = achievementBonuses(stateWith(...earned, ...earned, 'unknown'));
  assert.equal(all.browse, 0.49);
  assert.equal(all.drop, 0.015);
  assert.equal(all.company, 0.15);
  assert.equal(collectibleDropRate(stateWith(...earned)), 0.045);
});
test('conditional rewards add to equipment and stop below each duration boundary', () => {
  const state = { ...stateWith('milestone_deepReads_5', 'milestone_equipment_1', 'milestone_sites_5', 'milestone_trades_1'), shopLevels: { notebook: 1 } };
  assert.equal(depositMultiplier(state, { dwellMs: 14999 }).multiplier, 1.1);
  assert.equal(depositMultiplier(state, { dwellMs: 15000 }).multiplier, 1.11);
  assert.equal(depositMultiplier(state, { dwellMs: 59999 }).multiplier, 1.11);
  assert.equal(depositMultiplier(state, visit.metrics).multiplier, 1.13);
  assert.equal(depositMultiplier(state, { dwellMs: 60000, freshKind: 'new_path' }).multiplier, 1.13);
  assert.equal(depositMultiplier(state, { dwellMs: 60000, freshKind: 'seen_path' }).multiplier, 1.12);
});
test('existing milestones activate on sync, remain after disposal, and never backpay income', () => {
  const original = { ...defaultState(), totalAsset: 100, shopLevels: { notebook: 5 } };
  const synced = syncAchievements(original);
  assert.equal(synced.totalAsset, 100);
  const sold = syncAchievements({ ...synced, shopLevels: {} });
  assert.equal(achievementBonuses(sold).focus, 0.03);
  assert.deepEqual(syncAchievements(sold), sold);
  const paid = applyDeposit(sold, visit);
  assert.equal(paid.totalAsset, 105.15);
  assert.equal(paid.recentEntries[0].extras[0].id, 'achievement_focus');
});
test('a newly earned reward affects subsequent browsing and never amplifies task payouts', () => {
  const before = { ...defaultState(), totalVisits: 9 };
  const tenth = applyDeposit(before, visit);
  assert.equal(tenth.totalAsset, 5);
  assert.ok(tenth.unlockedAchievements.includes('milestone_visits_10'));
  const eleventh = applyDeposit(tenth, visit);
  assert.equal(eleventh.totalAsset, 10.05);
  const task = applyDeposit(eleventh, { kind: 'task_reward', amount: 100 });
  assert.equal(task.totalAsset, 110.05);
  assert.equal(task.totalVisits, 11);
  assert.equal(task.recentEntries[0].multiplier, 1);
});
test('estate reward is applied once before credit and keeps its daily cap', () => {
  let state = { ...stateWith('milestone_estates_1', 'milestone_visits_10'), estates: [{ host: 'example.test', level: 1, visits: 0, days: 0, income: 0 }] };
  const operating = recordEstateVisit(state, visit, 5);
  assert.equal(operating.income, 1.01);
  const credited = applyDeposit(operating.state, { kind: 'estate_income', amount: operating.income });
  assert.equal(credited.totalAsset, 1.01);
  assert.equal(credited.totalVisits, 0);
  state = operating.state;
  state = recordEstateVisit(state, visit, 5).state;
  state = recordEstateVisit(state, visit, 5).state;
  assert.equal(recordEstateVisit(state, visit, 5).income, 0);
});
test('company reward credits once on delivery, preserves the contract, and leaves risk losses unchanged', () => {
  let state = createCompany({ ...stateWith('milestone_orders_1'), totalAsset: 10000 }, '奖励测试', 'publisher');
  state.companies[0].order.target = 1;
  const contract = structuredClone(state.companies[0].order);
  const delivered = recordCompanyVisit(state, visit);
  assert.equal(delivered.payouts[0].amount, 80.8);
  assert.equal(delivered.state.companies[0].history[0].achievementBonus, 0.8);
  assert.deepEqual(state.companies[0].order, contract);
  const credited = applyDeposit(delivered.state, { kind: 'company_income', amount: 80.8 });
  assert.equal(credited.totalAsset, 10080.8);
  state.companies[0].order = { ...contract, mode: 'risk', maxLoss: 20 };
  const failed = recordCompanyVisit(state, visit, () => 0);
  assert.equal(failed.state.companyLosses, 20);
  assert.equal(failed.state.companies[0].history[0].achievementBonus, 0);
});
test('collection bonus increases probability without removing dwell or same-site quotas', () => {
  const state = stateWith('milestone_collectibles_1');
  assert.equal(recordCollectibleVisit(defaultState(), visit, () => 0.0305).collectibles.length, 0);
  const dropped = recordCollectibleVisit(state, visit, () => 0.0305);
  assert.equal(dropped.collectibles.length, 1);
  assert.equal(recordCollectibleVisit(state, visit, () => 0.031).collectibles.length, 0);
  assert.equal(recordCollectibleVisit(state, { ...visit, metrics: { dwellMs: 29999 } }, () => 0).collectibles.length, 0);
  assert.equal(recordCollectibleVisit(dropped, { ...visit, url: 'https://example.test/other' }, () => 0).collectibles.length, 1);
});
