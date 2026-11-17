import test from 'node:test';
import assert from 'node:assert/strict';
import { assetOverview, achievementOverview } from '../core/overview.js';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { createCompany } from '../core/company.js';
import { purchaseEstate, upgradeEstate } from '../core/estate.js';

test('overview supports legacy balances without rewriting or manufacturing assets', () => {
  const old = { totalAsset: 1234.56, shopSpent: 50, unlockedAchievements: ['start_ledger'] };
  const before = structuredClone(old);
  assert.deepEqual(assetOverview(old), { cash: 1184.56, collectibles: 0, investments: 0, companies: 0, estates: 0, equipment: 50, total: 1234.56 });
  assert.deepEqual(old, before);
  assert.equal(achievementOverview(old)[0].unlocked, true);
  assert.equal(achievementOverview(old)[1].unlocked, true);
});
test('purchases transfer cash into asset values, headquarters and income are not double counted', () => {
  let state = applyDeposit({ ...defaultState(), totalAsset: 10000 }, { amount: 5, url: 'https://example.com/' });
  state = purchaseEstate(state, 'example.com');
  state = createCompany(state, '出版社', 'publisher', 'example.com');
  state = createCompany(state, '探索社', 'explorer');
  const before = structuredClone(state);
  const overview = assetOverview(state);
  assert.equal(overview.total, state.totalAsset);
  assert.equal(overview.companies, 3000);
  assert.equal(overview.estates, 500);
  state.estates[0] = { ...state.estates[0], visits: 5, days: 2 };
  state = upgradeEstate(state, 'example.com');
  assert.equal(assetOverview(state).total, state.totalAsset);
  assert.equal(assetOverview(state).estates, 1300);
  state.companies[0].completed = 5;
  assert.equal(assetOverview(state).companies, 3250);
  state.companies[0].income = 500;
  assert.equal(assetOverview(state).companies, 3250);
  assert.deepEqual(assetOverview(before), overview);
});
test('achievement display preserves stored unlocks even when balance is below threshold', () => {
  const state = { ...defaultState(), totalAsset: 20, unlockedAchievements: ['month_surplus'] };
  assert.equal(achievementOverview(state)[3].unlocked, true);
  assert.equal(achievementOverview(state)[0].progress, 20 / 300);
  const next = applyDeposit({ ...defaultState(), totalAsset: 299 }, { amount: 1 });
  assert.equal(achievementOverview(next)[0].unlocked, true);
});
