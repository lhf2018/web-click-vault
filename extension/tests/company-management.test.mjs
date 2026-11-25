import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompany, manageCompany, nextOrder, recordCompanyVisit, companyValuations, companyMarketProgress, companyTeam, companyTeamCapacity } from '../core/company.js';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { walletBalance } from '../core/shop.js';
import { assetOverview } from '../core/overview.js';
import { validateBackup } from '../storage/repository.js';
const funded = () => createCompany({ ...defaultState(), totalAsset: 10000 }, '小刊', 'publisher');
const visit = i => ({ url: `https://a.test/${i}`, amount: 5, metrics: { dwellMs: 60000 } });
function ready(state) {
  return { ...state, companies: state.companies.map(c => ({ ...c, order: { ...nextOrder(c), target: 1 } })) };
}

test('a legacy hire combines with new roles and both businesses honor existing contracts', () => {
  let state = funded();
  const company = state.companies[0];
  const { id, order } = company;
  company.staff = 'specialist';
  company.completed = 5;
  assert.equal(companyTeamCapacity(company), 2);
  assert.throws(() => manageCompany(state, id, 'staff', 'specialist'), /已有人/);
  assert.throws(() => manageCompany(state, id, 'staff', 'operations'), /12 单/);
  assert.throws(() => manageCompany(state, id, 'staff', 'businessLead'), /开拓第二业务/);
  company.completed = 25;
  state = manageCompany(state, id, 'expand', 1);
  const branchOrder = state.companies[0].expansion.order;
  for (const role of ['assistant', 'operations', 'businessLead']) state = manageCompany(state, id, 'staff', role);
  assert.equal(companyTeamCapacity(state.companies[0]), 4);
  assert.deepEqual(companyTeam(state.companies[0]), ['specialist', 'assistant', 'operations', 'businessLead']);
  assert.equal(walletBalance(state), 4550);
  assert.deepEqual(state.companies[0].order, order);
  assert.deepEqual(state.companies[0].expansion.order, branchOrder);
  const main = nextOrder(state.companies[0]);
  assert.deepEqual([main.target, main.gross, main.salary, main.reward], [5, 500, 44, 456]);
  for (let i = 0; i < 5; i++) {
    state = applyDeposit(state, { ...visit(i), url: `https://branch${i}.test/page`, metrics: { dwellMs: 15000 } });
  }
  const improved = state.companies[0].expansion.order;
  assert.deepEqual([improved.target, improved.gross, improved.salary, improved.reward], [3, 130, 25, 105]);
  state = manageCompany(state, id, 'dismiss', 'businessLead');
  assert.deepEqual(state.companies[0].expansion.order, improved);
  for (let i = 5; i < 8; i++) {
    state = applyDeposit(state, { ...visit(i), url: `https://branch${i}.test/page`, metrics: { dwellMs: 15000 } });
  }
  assert.equal(state.companies[0].history[0].salary, 25);
  assert.equal(state.companies[0].expansion.order.reward, 100);
  const restored = validateBackup(JSON.parse(JSON.stringify({ format: 'web-click-vault', version: 1, state })));
  assert.deepEqual(companyTeam(restored.companies[0]), ['specialist', 'assistant', 'operations']);
});

test('operating days require a profitable delivery and count each date once', () => {
  let state = { ...funded(), dayKey: '2026-01-01' };
  state = recordCompanyVisit(state, visit(1)).state;
  assert.equal(state.companies[0].operatingDays, undefined);
  state = recordCompanyVisit(ready(state), visit(2)).state;
  state = recordCompanyVisit(ready(state), visit(3)).state;
  assert.equal(state.companies[0].operatingDays, 1);
  state = recordCompanyVisit(ready({ ...state, dayKey: '2026-01-20' }), visit(4)).state;
  assert.equal(state.companies[0].operatingDays, 2);
});

test('trillion-tier valuation requires mature expansion, deliveries, active days and retained profit', () => {
  const state = funded();
  const company = state.companies[0];
  Object.assign(company, { completed: 6000, operatingDays: 730, retained: 980000,
    expansion: { level: 3, completed: 3500, reinvested: 20000 } });
  assert.equal(companyMarketProgress(company).current.name, '万亿巨头');
  assert.ok(companyValuations(state)[0].value >= 3_000_000_000_000);
  assert.equal(walletBalance(state), 9000);
  for (const patch of [{ operatingDays: 729 }, { completed: 5999 }, { retained: 979999 },
    { expansion: { ...company.expansion, completed: 3499 } }]) {
    assert.equal(companyMarketProgress({ ...company, ...patch }).next.name, '万亿巨头');
  }
  assert.equal(companyMarketProgress({ ...company, expansion: { ...company.expansion, level: 2 } }).premium, 0);
});

test('legacy orders settle as agreed and future main orders can retain half of profit', () => {
  let s = funded();
  const { id, order } = s.companies[0];
  s = manageCompany(s, id, 'dividend', 'reinvest');
  assert.deepEqual(s.companies[0].order, order);
  s.companies[0].order = { ...order, target: 1 };
  let result = recordCompanyVisit(s, visit(1));
  assert.equal(result.payouts[0].amount, 80);
  s = ready(result.state);
  result = recordCompanyVisit(s, visit(2));
  assert.equal(result.payouts[0].amount, 40);
  assert.equal(result.state.companies[0].retained, 40);
  assert.equal(result.state.companies[0].income, 160);
  assert.equal(result.state.companies[0].valuationHistory.length, 2);
  assert.equal(result.state.companies[0].valuationHistory.at(-1), companyValuations(result.state)[0].value);
  assert.ok(assetOverview(result.state).companies > assetOverview(s).companies + 40);
});

test('expansion uses retained funds, settles independently and snapshots orders across upgrades', () => {
  let s = funded();
  const company = s.companies[0];
  assert.throws(() => manageCompany(s, company.id, 'expand', 1), /先交付 5 单/);
  company.completed = 12;
  company.retained = 500;
  const before = assetOverview(s).total;
  s = manageCompany(s, company.id, 'expand', 1);
  assert.equal(walletBalance(s), 7700);
  assert.equal(s.companies[0].retained, 0);
  assert.equal(assetOverview(s).total, before);
  assert.throws(() => manageCompany(s, company.id, 'expand', 1), /报价已变化/);
  const current = { ...s.companies[0].expansion.order, seen: ['first.test', 'second.test', 'third.test', 'fourth.test'] };
  s.companies[0].expansion.order = current;
  s = manageCompany(s, company.id, 'expand', 2);
  assert.deepEqual(s.companies[0].expansion.order, current);
  const entry = { url: 'https://last.test/path', amount: 5, metrics: { dwellMs: 15000 } };
  const cash = walletBalance(s);
  s = applyDeposit(s, entry);
  assert.equal(walletBalance(s), cash + 5 + 30);
  assert.equal(s.companies[0].retained, 70);
  assert.equal(s.companies[0].completed, 12);
  assert.equal(s.companies[0].expansion.completed, 1);
  assert.equal(s.companies[0].expansion.order.reward, 150);
  assert.deepEqual(s.companies[0].order, company.order);
  const restored = validateBackup(JSON.parse(JSON.stringify({ format: 'web-click-vault', version: 1, state: s })));
  assert.deepEqual(restored.companies, s.companies);
});
test('hiring and construction charge once, preserve current order and transfer investment to valuation', () => {
  let s = funded(); const old = structuredClone(s.companies[0].order), id = s.companies[0].id, total = assetOverview(s).total;
  s = manageCompany(s, id, 'staff', 'specialist');
  assert.equal(walletBalance(s), 8800);
  assert.deepEqual(s.companies[0].order, old);
  assert.throws(() => manageCompany(s, id, 'staff', 'assistant'), /员工位已满/);
  s = manageCompany(s, id, 'facility', 'studio');
  assert.equal(walletBalance(s), 8200);
  assert.equal(assetOverview(s).total, total);
  assert.throws(() => manageCompany(s, id, 'facility', 'studio'), /已经建成/);
  const order = nextOrder(s.companies[0]);
  assert.equal(order.gross, 120); assert.equal(order.salary, 12); assert.equal(order.reward, 108); assert.equal(order.target, 4);
  s = manageCompany(s, id, 'dismiss');
  assert.equal(nextOrder(s.companies[0]).salary, 0);
  assert.equal(s.companyBuildSpent, 800);
  assert.throws(() => manageCompany(s, id, 'facility', 'bad'), /不存在/);
  assert.throws(() => manageCompany(s, id, 'strategy', 'bad'), /不存在/);
  assert.throws(() => manageCompany({ ...s, totalAsset: 1000 }, id, 'staff', 'assistant'), /余额不足/);
});
test('premium costs and assistant targets are snapshotted; ordinary delivery credits only net income', () => {
  let s = funded(), id = s.companies[0].id;
  s = manageCompany(s, id, 'staff', 'assistant');
  s = manageCompany(s, id, 'facility', 'archive');
  s = manageCompany(s, id, 'strategy', 'premium');
  const order = nextOrder(s.companies[0]);
  assert.equal(order.target, 4); assert.equal(order.gross, 128); assert.equal(order.cost, 10); assert.equal(order.salary, 10); assert.equal(order.reward, 108);
  s = ready(s);
  const before = walletBalance(s);
  s = applyDeposit(s, visit(1));
  assert.equal(s.companies[0].income, 108);
  assert.equal(walletBalance(s), before + 5 + 108);
  assert.equal(s.totalVisits, 1);
  assert.equal(s.companies[0].history[0].salary, 10);
});
test('risk losses debit shared balance once, keep earned income and stop after two losses', () => {
  let s = funded(); const id = s.companies[0].id;
  s = manageCompany(s, id, 'strategy', 'risk');
  s = ready(s);
  const earned = s.totalAsset, before = walletBalance(s);
  s = recordCompanyVisit(s, visit(1), () => .0999).state;
  assert.equal(s.companyLosses, 20); assert.equal(walletBalance(s), before - 20); assert.equal(s.totalAsset, earned);
  assert.equal(s.companies[0].history[0].amount, -20);
  assert.equal(s.recentEntries[0].kind, 'company_loss');
  assert.equal(s.companies[0].strategy, 'risk');
  s = ready(s); s = recordCompanyVisit(s, visit(2), () => 0).state;
  assert.equal(s.companyLosses, 40); assert.equal(s.companies[0].strategy, 'safe');
  assert.equal(s.companies[0].order.mode, 'safe');
});
test('risk success boundary and insufficient funds fallback avoid debt across multiple companies', () => {
  let s = funded();
  s = manageCompany(s, s.companies[0].id, 'strategy', 'risk');
  s = ready(s);
  const success = recordCompanyVisit(s, visit(1), () => .1);
  assert.equal(success.payouts[0].amount, 100);
  assert.equal(success.state.companyLosses, undefined);
  s = { ...s, totalAsset: 1020, companies: [s.companies[0], { ...s.companies[0], id: 'second', name: '第二家' }] };
  const result = recordCompanyVisit(s, visit(2), () => 0);
  assert.equal(result.state.companyLosses, 20);
  assert.equal(result.payouts[0].amount, 80);
  assert.equal(result.state.companies[1].strategy, 'safe');
  assert.ok(walletBalance(result.state) >= 0);
  const poor = { ...s, totalAsset: 1000 };
  assert.throws(() => manageCompany(poor, poor.companies[0].id, 'strategy', 'risk'), /余额不足/);
  assert.equal(nextOrder(poor.companies[0], Date.now(), 0).mode, 'safe');
});
