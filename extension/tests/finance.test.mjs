import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { SHOP_ITEMS, purchaseUpgrade, walletBalance, itemPrice } from '../core/shop.js';
import { sellAsset, tradeAsset, exchangeAssets } from '../core/exchange.js';
import { purchaseEstate } from '../core/estate.js';
import { createCompany, manageCompany } from '../core/company.js';
import { assetOverview } from '../core/overview.js';
import { collectionMarket, marketQuote, sellAtMarket } from '../core/market.js';
import { investProject, exitProject, investmentValue, investmentQuote, investmentPosition, investmentCatalog, investmentSpec, INVESTMENT_ROTATION_MS } from '../core/investments.js';
const funded = () => ({ ...defaultState(), totalAsset: 20000 });
const browse = i => ({ url: `https://site${i}.test/read?x=${i}#fragment`, amount: 5, metrics: { dwellMs: 60000 } });

test('market rotates by local week and commission quota survives sale and daily reset', () => {
  const date = new Date(2026, 10, 18, 12), nextWeek = new Date(2026, 10, 23, 12);
  let state = funded(); const market = collectionMarket(state, date);
  state.collectibles = [1, 2, 3].map(i => ({ id: String(i), type: market.featured, title: '藏品', host: 'example.test', value: 100, soldAt: null }));
  const price = marketQuote(state.collectibles[0], market, 'commission');
  const before = walletBalance(state), total = assetOverview(state).total;
  state = sellAtMarket(state, '1', 'commission', market.week, price, date);
  assert.equal(walletBalance(state), before + price);
  assert.equal(state.totalAsset, 20000 + Math.max(0, price - 100));
  assert.equal(assetOverview(state).total, total + price - 100);
  assert.equal(state.totalVisits, 0);
  assert.equal(state.collectibles[0].salePrice, price);
  assert.equal(state.collectionCommission.used, 1);
  assert.throws(() => sellAtMarket(state, '1', 'commission', market.week, price, date), /已经出售/);
  state = sellAtMarket(state, '2', 'commission', market.week, price, date);
  assert.throws(() => sellAtMarket(state, '3', 'commission', market.week, price, date), /额度/);
  assert.equal(collectionMarket({ ...state, todayVisits: 0 }, date).remaining, 0);
  assert.equal(collectionMarket(state, nextWeek).remaining, 2);
  assert.notEqual(collectionMarket(state, nextWeek).featured, market.featured);
  assert.throws(() => sellAtMarket(state, '3', 'market', market.week, 100, nextWeek), /刷新/);
  assert.throws(() => sellAtMarket(state, '3', 'market', market.week, -1, date), /报价/);
});

test('market sale accounts separately for principal transfer, discount and premium', () => {
  const date = new Date(2026, 10, 18, 12), market = collectionMarket({}, date);
  for (const type of Object.keys(market.rates)) {
    const state = { ...funded(), collectibles: [{ id: type, type, value: 100, host: type, soldAt: null }] };
    const quote = marketQuote(state.collectibles[0], market);
    const sold = sellAtMarket(state, type, 'market', market.week, quote, date);
    assert.equal(walletBalance(sold), 20000 + quote);
    assert.equal(assetOverview(sold).total, 20000 + quote);
    assert.equal(sold.totalAsset, 20000 + Math.max(0, quote - 100));
  }
});

test('equipment resale lowers multiplier assets and credits 70% once; repurchase cannot create money', () => {
  let state = purchaseUpgrade(funded(), 'notebook');
  const before = assetOverview(state).total, cash = walletBalance(state);
  state = sellAsset(state, 'equipment', 'notebook', 35);
  assert.equal(walletBalance(state), cash + 35);
  assert.equal(assetOverview(state).total, before - 15);
  assert.equal(assetOverview(state).equipment, 0);
  assert.equal(state.totalAsset, 20000);
  assert.equal(state.shopLevels.notebook, 0);
  assert.throws(() => sellAsset(state, 'equipment', 'notebook'), /不存在/);
  state = purchaseUpgrade(state, 'notebook');
  assert.equal(exchangeAssets(state)[0].cost, 50);
  assert.equal(assetOverview(state).equipment, 50);
});

test('legacy equipment refund is capped by actual recorded historical spending', () => {
  let state = { ...funded(), shopSpent: 10, shopLevels: { notebook: 10, engine: 10 } };
  const before = walletBalance(state);
  for (const row of exchangeAssets(state)) state = sellAsset(state, row.kind, row.id, row.price);
  assert.ok(walletBalance(state) - before <= 7);
  assert.ok(state.shopDisposedCost <= 10);
});

test('trade is atomic and requires unlock, balance and a different destination', () => {
  let state = purchaseUpgrade(funded(), 'notebook'); const original = structuredClone(state);
  assert.throws(() => tradeAsset(state, 'equipment', 'notebook', 'portal', 35), /解锁/);
  assert.deepEqual(state, original);
  assert.throws(() => tradeAsset(state, 'equipment', 'notebook', 'notebook', 35), /另一项/);
  state = { ...state, totalVisits: 1000, totalAsset: 20000 };
  const cash = walletBalance(state);
  state = tradeAsset(state, 'equipment', 'notebook', 'bookmark', 35);
  assert.equal(state.shopLevels.notebook, 0); assert.equal(state.shopLevels.bookmark, 1);
  assert.equal(walletBalance(state), cash + 35 - 120);
  const poor = { ...original, totalAsset: 50, totalVisits: 1000 };
  assert.throws(() => tradeAsset(poor, 'equipment', 'notebook', 'bookmark', 35), /解锁|余额/);
  assert.equal(poor.shopLevels.notebook, 1);
});

test('selling estate clears headquarters, facilities detach only from subsequent orders', () => {
  let state = { ...funded(), estateDiscoveries: [{ host: 'a.test', url: 'https://a.test/' }] };
  state = purchaseEstate(state, 'a.test'); state = createCompany(state, '总部', 'publisher', 'a.test');
  const id = state.companies[0].id;
  state = manageCompany(state, id, 'facility', 'studio');
  const order = structuredClone(state.companies[0].order), before = assetOverview(state).total;
  state = sellAsset(state, 'facility', `${id}:studio`, 420);
  assert.deepEqual(state.companies[0].order, order);
  assert.deepEqual(state.companies[0].facilities, []);
  assert.equal(assetOverview(state).total, before - 180);
  state = sellAsset(state, 'estate', 'a.test', 350);
  assert.equal(state.estates.length, 0); assert.equal(state.companies[0].headquarters, '');
  assert.equal(assetOverview(state).total, before - 180 - 150);
});

test('reselling and repurchasing estate does not reset the daily operating allowance', () => {
  let state = { ...funded(), estateDiscoveries: [{ host: 'a.test', url: 'https://a.test/' }] };
  state = purchaseEstate(state, 'a.test');
  state.estates[0] = { ...state.estates[0], lastDay: state.dayKey, dailyVisits: 3 };
  state = sellAsset(state, 'estate', 'a.test', 350);
  state = purchaseEstate(state, 'a.test');
  assert.equal(state.estates[0].lastDay, state.dayKey);
  assert.equal(state.estates[0].dailyVisits, 3);
  const before = state.estates[0].income;
  state = applyDeposit(state, { ...browse(0), url: 'https://a.test/page' });
  assert.equal(state.estates[0].income, before);
});

test('estate exchange refunds the historical purchase price and quotes the replacement after sale', () => {
  const estateDiscoveries = ['first', 'second', 'replacement'].map(host => ({ host, url: `https://${host}.test/` }));
  const state = purchaseEstate(purchaseEstate({ ...funded(), estateDiscoveries }, 'first'), 'second');
  delete state.estates[0].purchasePrice; // Legacy holding bought at the original flat price.
  assert.deepEqual(exchangeAssets(state).map(asset => asset.price), [350, 700]);
  assert.throws(() => tradeAsset(state, 'estate', 'second', 'replacement', 700, 2000), /报价已变化/);
  const exchanged = tradeAsset(state, 'estate', 'second', 'replacement', 700, 1000);
  assert.equal(exchanged.estates.length, 2);
  assert.equal(exchanged.estates[1].purchasePrice, 1000);
  assert.equal(walletBalance(exchanged), walletBalance(state) - 300);
  assert.equal(assetOverview(exchanged).estates, 1500);
});

test('market prices follow time independently of browsing, including offline periods', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  let state = investProject(funded(), 'zine', 3, now);
  const cost = Math.round(investmentQuote('zine', now).price * 300) / 100;
  assert.equal(walletBalance(state), 20000 - cost); assert.equal(investmentValue(state, now), cost);
  const original = structuredClone(state.investments);
  for (let i = 0; i < 20; i++) state = applyDeposit(state, browse(i));
  assert.deepEqual(state.investments, original);
  assert.equal(state.investmentReturned, 0);
  assert.deepEqual(investmentQuote('zine', now), investmentQuote('zine', now + 1000));
  assert.notEqual(investmentQuote('zine', now).price, investmentQuote('zine', now + 86400000 * 7).price);
  const prices = Array.from({length: 60}, (_, i) => investmentQuote('atlas', now + i * 86400000).price);
  assert.ok(prices.some((p, i) => i && p > prices[i-1]));
  assert.ok(prices.some((p, i) => i && p < prices[i-1]));
});

test('selling settles current market value once and never credits gross proceeds as new income', () => {
  const now = Date.UTC(2026, 10, 18, 12), later = now + 86400000 * 7;
  let state = investProject(funded(), 'atlas', 6, now), project = state.investments[0];
  const position = investmentPosition(project, later);
  assert.equal(investmentValue(state, later), position.value);
  state = exitProject(state, project.id, null, later);
  assert.equal(state.investmentReturned, position.proceeds);
  assert.equal(walletBalance(state), Math.round((20000 - project.principal + position.proceeds) * 100) / 100);
  assert.equal(state.investments[0].realizedProfit, Math.round((position.proceeds - project.principal) * 100) / 100);
  assert.equal(state.totalAsset, 20000);
  assert.equal(investmentValue(state, later), 0);
  assert.throws(() => exitProject(state, project.id, null, later), /已经结束/);
  assert.throws(() => investProject({ ...funded(), totalAsset: 0 }, 'zine'), /余额/);
});

test('same-hour trading costs only the selling fee and legacy active projects retain their principal at entry', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  let state = investProject(funded(), 'zine', 3, now);
  const initial = state.investments[0].principal, proceeds = investmentPosition(state.investments[0], now).proceeds;
  state = exitProject(state, state.investments[0].id, null, now);
  assert.equal(walletBalance(state), Math.round((20000 - initial + proceeds) * 100) / 100);
  const legacy = { projectId: 'zine', principal: 300, startedAt: now, status: 'active', seen: [] };
  assert.equal(investmentPosition(legacy, now).value, 300);
  assert.notEqual(investmentPosition(legacy, now + 86400000 * 7).value, 300);
});

test('queued transactions prevent duplicate commission payouts and duplicated asset sale', async () => {
  const market = collectionMarket({});
  const starting = purchaseUpgrade({ ...funded(), collectibles: [1, 2, 3].map(i => ({ id: String(i), type: market.featured, value: 100, host: 'a.test', soldAt: null })) }, 'notebook');
  const data = { assetMeterState: starting };
  globalThis.chrome = { storage: { local: { get: async key => ({ [key]: structuredClone(data[key]) }), set: async patch => Object.assign(data, structuredClone(patch)), remove: async keys => keys.forEach(k => delete data[k]) } } };
  const repo = await import('../storage/repository.js?finance');
  const offers = await Promise.allSettled([1, 2, 3].map(id => repo.updateState(s => sellAtMarket(s, String(id), 'commission', market.week, marketQuote(s.collectibles.find(c => c.id === String(id)), market, 'commission')))));
  assert.equal(offers.filter(r => r.status === 'fulfilled').length, 2);
  const sales = await Promise.allSettled([1, 2].map(() => repo.updateState(s => sellAsset(s, 'equipment', 'notebook', 35))));
  assert.equal(sales.filter(r => r.status === 'fulfilled').length, 1);
  await repo.updateState(s => investProject(s, 'zine'));
  const reset = await repo.resetToday();
  assert.equal(reset.investments[0].status, 'active'); assert.equal(reset.collectionCommission.used, 2);
  await repo.resetAll(); const cleared = await repo.loadState();
  assert.deepEqual(cleared.investments, []); assert.equal(cleared.investmentSpent, 0); assert.equal(cleared.assetSales, 0);
});


test('24 listed projects rotate four launches every three weeks with stable independent quotes', () => {
  const now = Date.UTC(2026, 10, 18, 12), catalog = investmentCatalog(now);
  assert.equal(catalog.projects.length, 24);
  assert.equal(new Set(catalog.projects.map(p => p.id)).size, 24);
  assert.equal(catalog.projects.filter(p => p.launchedAt).length, 4);
  assert.deepEqual(investmentCatalog(catalog.nextRefresh - 1).projects, catalog.projects);
  const next = investmentCatalog(catalog.nextRefresh);
  assert.equal(next.nextRefresh - catalog.nextRefresh, INVESTMENT_ROTATION_MS);
  const previousIds = new Set(catalog.projects.map(p => p.id));
  assert.equal(next.projects.filter(p => !previousIds.has(p.id)).length, 4);
  assert.equal(next.projects.filter(p => previousIds.has(p.id)).length, 20);
  for (const spec of catalog.projects) {
    const q = investmentQuote(spec.id, now);
    assert.ok(Number.isFinite(q.price) && q.price > 0);
    assert.ok(q.history.length > 0 && q.history.length <= 7);
    if (spec.launchedAt) assert.ok(q.history.every(p => p.ts >= spec.launchedAt));
  }
  const future = next.projects.find(p => p.launchedAt);
  assert.throws(() => investProject(funded(), future.id, 1, now), /不在本期/);
  assert.throws(() => investmentSpec('launch:00:4'), /不存在/);
});

test('retired projects retain valuation and can be sold after multiple missed rotations', () => {
  const now = Date.UTC(2026, 10, 18, 12), catalog = investmentCatalog(now);
  const spec = catalog.projects.find(p => p.launchedAt);
  let state = investProject(funded(), spec.id, 1, now);
  const holding = structuredClone(state.investments[0]);
  const later = catalog.nextRefresh + INVESTMENT_ROTATION_MS * 4;
  assert.throws(() => investProject(funded(), spec.id, 1, later), /不在本期/);
  assert.equal(investmentCatalog(later).projects.some(p => p.id === spec.id), false);
  assert.deepEqual(state.investments[0], holding);
  assert.equal(investmentValue(state, later), investmentPosition(holding, later).value);
  const proceeds = investmentPosition(holding, later).proceeds;
  state = exitProject(state, holding.id, null, later);
  assert.equal(state.investmentReturned, proceeds);
  assert.equal(investmentValue(state, later), 0);
  assert.throws(() => exitProject(state, holding.id, null, later), /已经结束/);
});
