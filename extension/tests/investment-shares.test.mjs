import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../core/ledger.js';
import { walletBalance } from '../core/shop.js';
import { investProject, exitProject, investmentQuote, investmentPosition, investmentValue, investmentCatalog, MAX_ORDER_UNITS } from '../core/investments.js';
const now = Date.UTC(2026, 10, 18, 12), later = now + 7 * 86400000;
const round = n => Math.round(n * 100) / 100;
const funded = () => ({ ...defaultState(), totalAsset: 1e10 });

test('bulk purchases merge into one holding with weighted cost and no extra income', () => {
  let state = investProject(funded(), 'zine', 100, now);
  const first = structuredClone(state.investments[0]);
  const cost = round(investmentQuote('zine', later).price * 50);
  state = investProject(state, 'zine', 50, later);
  const position = state.investments[0];
  assert.equal(state.investments.length, 1);
  assert.equal(position.id, first.id);
  assert.equal(position.units, 150);
  assert.equal(position.principal, round(first.principal + cost));
  assert.equal(position.entryPrice, position.principal / 150);
  assert.equal(walletBalance(state), round(1e10 - position.principal));
  assert.equal(state.totalAsset, 1e10);
  assert.equal(state.investmentReturned, 0);
});

test('partial sell allocates cost, add-on preserves realized profit, final sell reconciles cash', () => {
  let state = investProject(funded(), 'atlas', 10, now);
  const originalCost = state.investments[0].principal, id = state.investments[0].id;
  const proceeds = round(round(investmentQuote('atlas', later).price * 4) * 0.99);
  state = exitProject(state, id, 4, later);
  let p = state.investments[0];
  assert.equal(p.status, 'active'); assert.equal(p.units, 6);
  assert.equal(p.principal, round(originalCost - round(originalCost * 0.4)));
  assert.equal(p.realizedProfit, round(proceeds - round(originalCost * 0.4)));
  const realized = p.realizedProfit;
  state = investProject(state, 'atlas', 3, later);
  p = state.investments[0];
  assert.equal(p.units, 9); assert.equal(p.realizedProfit, realized);
  assert.equal(p.invested, state.investmentSpent);
  const rest = investmentPosition(p, later).proceeds;
  state = exitProject(state, id, null, later);
  p = state.investments[0];
  assert.equal(p.units, 0); assert.equal(p.status, 'exited');
  assert.equal(p.returned, round(proceeds + rest));
  assert.equal(p.realizedProfit, round(p.returned - p.invested));
  assert.equal(walletBalance(state), round(1e10 + p.realizedProfit));
  assert.equal(investmentValue(state, later), 0);
  assert.throws(() => exitProject(state, id, 1, later), /已经结束/);
});

test('invalid, oversize, unaffordable and oversold orders fail without mutating positions', () => {
  const state = investProject(funded(), 'zine', 5, now), snapshot = structuredClone(state), id = state.investments[0].id;
  for (const units of [0, -1, 1.5, NaN, Infinity, '5', MAX_ORDER_UNITS + 1]) {
    assert.throws(() => investProject(state, 'zine', units, now), /份数/);
    assert.throws(() => exitProject(state, id, units, now), /份数/);
  }
  assert.throws(() => exitProject(state, id, 6, now), /超过持仓/);
  assert.throws(() => investProject({ ...defaultState(), totalAsset: 10 }, 'zine', 100, now), /余额/);
  assert.deepEqual(state, snapshot);
});

test('ten holdings allow add-ons while blocking an eleventh distinct project', () => {
  let state = funded();
  const specs = investmentCatalog(now).projects;
  for (const spec of specs.slice(0, 10)) state = investProject(state, spec.id, 1, now);
  assert.throws(() => investProject(state, specs[10].id, 1, now), /10/);
  state = investProject(state, specs[0].id, 10, now);
  assert.equal(state.investments.find(p => p.projectId === specs[0].id).units, 11);
});

test('legacy fractional positions preserve value through partial sales, add-ons and clearing dust', () => {
  const legacy = { id: 'legacy', projectId: 'zine', principal: 300, units: 3.12345, entryPrice: 300 / 3.12345, status: 'active', startedAt: now };
  let state = { ...funded(), investments: [legacy], investmentSpent: 300 };
  state = exitProject(state, legacy.id, 1, now);
  assert.ok(Math.abs(state.investments[0].units - 2.12345) < 1e-10);
  state = investProject(state, 'zine', 2, now);
  assert.ok(Math.abs(state.investments[0].units - 4.12345) < 1e-10);
  state = exitProject(state, legacy.id, null, now);
  assert.equal(state.investments[0].units, 0);
  assert.equal(state.investments[0].realizedProfit, round(state.investmentReturned - state.investmentSpent));
  const tiny = { ...legacy, principal: 30, units: 0.3, entryPrice: 100 };
  const tinyState = { ...funded(), investments: [tiny] };
  assert.equal(exitProject(tinyState, tiny.id, null, now).investments[0].status, 'exited');
});

test('four large projects support million-scale investments with independent per-share prices', () => {
  const large = investmentCatalog(now).projects.filter(p => p.scale);
  assert.equal(large.length, 4);
  for (const spec of large) {
    assert.ok(investmentQuote(spec.id, now).price > 500);
    const state = investProject(funded(), spec.id, 10000, now);
    assert.ok(state.investmentSpent > 1e6);
    assert.equal(investmentValue(state, now), state.investmentSpent);
  }
});

test('serialized partial sells cannot dispose of the same shares twice', async () => {
  const starting = investProject(funded(), 'zine', 10, now), id = starting.investments[0].id;
  const data = { assetMeterState: starting };
  globalThis.chrome = { storage: { local: { get: async key => ({ [key]: structuredClone(data[key]) }), set: async patch => Object.assign(data, structuredClone(patch)) } } };
  const repo = await import('../storage/repository.js?shares');
  const results = await Promise.allSettled([1, 2].map(() => repo.updateState(state => exitProject(state, id, 6, now))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(data.assetMeterState.investments[0].units, 4);
});
