import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectionMarket, marketQuote, sellAtMarket } from '../core/market.js';
import { readFile } from 'node:fs/promises';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { collectibleDropRate, recordCollectibleVisit as recordVisit, explorationLevel, collectiblePrice, sellCollectible, collectibleValue, cleanPageElements, collectibleIdentity, COLLECTION_TYPES } from '../core/collectibles.js';
import { assetOverview } from '../core/overview.js';
import { walletBalance } from '../core/shop.js';
const recordCollectibleVisit = (state, entry, random = () => 0) => recordVisit(state, entry, random);
const visit = (host = 'example.com', extra = {}) => ({ url: `https://${host}/article?private=secret`, amount: 5, metrics: { dwellMs: 30000 }, pageElements: { title: '<script>网页标题</script>', color: '#123456' }, ...extra });
test('first discovery uses the same low probability and growth prices stay modest and locked', () => {
  const initial = defaultState();
  assert.equal(recordVisit(initial, visit(), () => 0.03), initial);
  assert.equal(recordVisit(initial, visit(), () => 0.99), initial);
  assert.equal(recordVisit(initial, visit(), () => 0.0299).collectibles.length, 1);
  for (const [visits, level] of [[0, 1], [99, 1], [100, 2], [899, 9], [900, 10], [100000, 10]]) {
    assert.equal(explorationLevel({ totalVisits: visits }), level);
  }
  for (const type of Object.keys(COLLECTION_TYPES)) {
    let previous = 0;
    for (let level = 1; level <= 10; level++) {
      const price = collectiblePrice(type, level);
      assert.ok(price > previous && price <= 540);
      previous = price;
    }
  }
  assert.equal(collectiblePrice('badge', 1), 10);
  assert.equal(collectiblePrice('bookmark', 5), 100);
  assert.equal(collectiblePrice('chip', 10), 540);
  for (const [type, prices] of Object.entries({ badge: [10, 50, 180], bookmark: [20, 100, 360], chip: [30, 150, 540] })) {
    [1, 5, 10].forEach((level, i) => assert.equal(collectiblePrice(type, level), prices[i]));
  }
  assert.equal(collectiblePrice('chip', 10, 15), 621);
  assert.equal(collectiblePrice('badge', 1, -15), 8.5);
  for (const [roll, quality] of [[0, -15], [0.5, 0], [0.999999, 15]]) {
    let calls = 0;
    const dropped = recordVisit({ ...initial, totalVisits: 900 }, visit('quality.test', { pageElements: { hasCode: true } }), () => calls++ === 0 ? 0 : roll);
    assert.equal(dropped.collectibles[0].qualityPercent, quality);
    assert.equal(dropped.collectibles[0].value, collectiblePrice('chip', 10, quality));
  }
  const found = recordCollectibleVisit({ ...initial, totalVisits: 400 }, visit());
  assert.equal(found.collectibles[0].foundLevel, 5);
  assert.equal(found.collectibles[0].value, 42.5);
  const advanced = { ...found, totalVisits: 9999 };
  assert.equal(collectibleValue(advanced), 42.5);
  assert.equal(sellCollectible(advanced, found.collectibles[0].id).collectibleSales, 42.5);
  const legacy = { ...initial, collectibles: [{ ...found.collectibles[0], value: 80, foundLevel: undefined }] };
  assert.equal(collectibleValue(legacy), 80);
  assert.equal(sellCollectible(legacy, legacy.collectibles[0].id).collectibleSales, 80);
});
test('passive drops use page elements, strip query and fragment and respect dwell/type boundaries', () => {
  const initial = defaultState();
  assert.equal(recordCollectibleVisit(initial, visit('a.test', { metrics: { dwellMs: 29999 } })), initial);
  assert.equal(recordCollectibleVisit(initial, visit('a.test', { kind: 'task_reward' })), initial);
  assert.equal(recordCollectibleVisit(initial, visit('a.test', { url: 'chrome://settings' })), initial);
  const next = recordCollectibleVisit(initial, visit(), () => 0.0299);
  assert.equal(next.collectibles.length, 1);
  assert.equal(next.collectibles[0].title, '<script>网页标题</script>');
  assert.equal(next.collectibles[0].source, 'https://example.com/article');
  assert.equal(next.collectibles[0].color, '#123456');
  assert.equal(initial.collectibles.length, 0);
  assert.equal(recordCollectibleVisit(initial, visit('a.test', { metrics: { dwellMs: 60000 } })).collectibles[0].type, 'bookmark');
  assert.equal(recordCollectibleVisit(initial, visit('a.test', { pageElements: { hasCode: true } })).collectibles[0].type, 'chip');
  assert.equal(cleanPageElements({ title: 'x'.repeat(1000), color: 'url(https://evil.test)', hasCode: 'yes' }).title.length, 120);
  assert.equal(cleanPageElements({ color: 'red' }).color, '');
  assert.equal(cleanPageElements(null).title, '');
  assert.equal(recordCollectibleVisit(initial, visit('fallback.test', { pageElements: null })).collectibles[0].title, 'fallback.test');
});
test('probability, daily host limit, daily cap and lifetime page uniqueness survive selling', () => {
  let state = recordCollectibleVisit(defaultState(), visit());
  assert.equal(recordCollectibleVisit(state, visit('other.test'), () => .03), state);
  assert.equal(recordCollectibleVisit(state, visit('www.example.com'), () => 0), state);
  state = recordCollectibleVisit(state, visit('b.test'), () => 0);
  state = recordCollectibleVisit(state, visit('c.test'), () => 0);
  assert.equal(recordCollectibleVisit(state, visit('d.test'), () => 0), state);
  state = sellCollectible(state, state.collectibles[0].id);
  assert.equal(recordCollectibleVisit(state, visit('d.test'), () => 0), state);
  state = { ...state, dayKey: '2099-01-01' };
  assert.equal(recordCollectibleVisit(state, visit(), () => 0), state);
  assert.equal(recordCollectibleVisit(state, visit('d.test'), () => 0).collectibles.length, 4);
});
test('sale transfers valuation to spendable cash exactly once without reward effects', (t) => {
  t.mock.method(Math, 'random', () => 0);
  let state = applyDeposit(defaultState(), visit());
  const before = assetOverview(state), earned = state.totalAsset, weekly = structuredClone(state.weekly);
  assert.equal(before.collectibles, 8.5);
  state = sellCollectible(state, state.collectibles[0].id);
  assert.equal(assetOverview(state).total, before.total);
  assert.equal(walletBalance(state), before.cash + 8.5);
  assert.equal(collectibleValue(state), 0);
  assert.equal(state.totalAsset, earned);
  assert.deepEqual(state.weekly, weekly);
  assert.equal(state.totalVisits, 1);
  assert.equal(state.recentEntries[0].kind, 'collectible_sale');
  assert.throws(() => sellCollectible(state, state.collectibles[0].id), /已经出售/);
});
test('legacy defaults persist, concurrent sales serialize and resetToday preserves quota', async () => {
  const data = { assetMeterState: { ...defaultState(), totalAsset: 123 } };
  delete data.assetMeterState.collectibles;
  delete data.assetMeterState.collectibleSales;
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async values => Object.assign(data, structuredClone(values)),
    remove: async keys => keys.forEach(key => delete data[key]),
  } } };
  const repo = await import('../storage/repository.js?collectibles');
  assert.deepEqual((await repo.loadState()).collectibles, []);
  assert.deepEqual(data.assetMeterState.collectibles, []);
  await repo.updateState(s => recordCollectibleVisit(s, visit()));
  const id = data.assetMeterState.collectibles[0].id;
  const sales = await Promise.allSettled([repo.updateState(s => sellCollectible(s, id)), repo.updateState(s => sellCollectible(s, id))]);
  assert.equal(sales.filter(r => r.status === 'fulfilled').length, 1);
  const reset = await repo.resetToday();
  assert.equal(reset.collectibleSales, 8.5);
  assert.equal(recordCollectibleVisit(reset, visit(), () => 0), reset);
  await repo.resetAll();
  assert.deepEqual(data.assetMeterState.collectibles, []);
});
test('collection UI displays untrusted titles as text and sale/filter actions update the wall', async () => {
  const source = (await readFile(new URL('../collection/collection.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const nodes = new Map();
  const node = () => ({ children: [], value: '', style: { setProperty() {} }, append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; }, addEventListener(name, fn) { this[name] = fn; } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  get('filter').value = 'owned';
  let state = recordCollectibleVisit(defaultState(), visit());
  vm.runInNewContext(source, { collectibleDropRate, COLLECTION_TYPES, collectibleValue, explorationLevel, collectiblePrice, collectionMarket, marketQuote, collectibleIdentity, URL, document: { getElementById: get, createElement: node },
    chrome: { runtime: { sendMessage: async message => { if (message.type === 'MARKET_SELL') state = sellAtMarket(state, message.id, message.mode, message.week, message.price); return { ok: true, state }; } }, storage: { onChanged: { addListener() {} } } },
    window: { confirm: () => true, addEventListener() {} } });
  await new Promise(resolve => setImmediate(resolve));
  const art = get('wall').children[0].children[0];
  assert.match(art.className, /art-badge quality-worn/);
  assert.equal(art.children[1].children[1].textContent, 'E');
  const body = get('wall').children[0].children[1];
  assert.equal(body.children[1].textContent, state.collectibles[0].collectibleName);
  assert.ok(body.children.some(n => n.className === 'source-title' && n.textContent === '<script>网页标题</script>'));
  await body.children.at(-1).click();
  assert.equal(get('owned').textContent, 0);
  get('filter').value = 'sold'; get('filter').change();
  assert.equal(get('wall').children[0].children[1].children.at(-1).disabled, true);
});

test('website series generate open-ended page identities without changing rarity or legacy prices', () => {
  const initial = defaultState();
  const first = recordCollectibleVisit(initial, visit('studio.test', { pageElements: { title: '第一篇', siteName: '小站工坊' } })).collectibles[0];
  const second = recordCollectibleVisit(initial, visit('studio.test', { url: 'https://studio.test/second', pageElements: { title: '第二篇', siteName: '小站工坊' } })).collectibles[0];
  assert.equal(collectibleIdentity(first).series, '小站工坊 · 站点藏系');
  assert.equal(collectibleIdentity(second).series, collectibleIdentity(first).series);
  assert.notEqual(first.speciesKey, second.speciesKey);
  assert.notEqual(first.collectibleName, second.collectibleName);
  assert.notEqual(collectibleIdentity(first).edition, collectibleIdentity(second).edition);
  assert.equal(first.value, second.value);
  assert.equal(collectibleIdentity(first).edition, collectibleIdentity({ ...first, id: 'different-instance', title: 'changed' }).edition);
  const identities = new Set();
  for (let i = 0; i < 1000; i++) {
    const item = recordCollectibleVisit(initial, visit(`site${i}.test`)).collectibles[0];
    identities.add(item.speciesKey);
  }
  assert.equal(identities.size, 1000);
  assert.equal(cleanPageElements({ siteName: 'x'.repeat(500) }).siteName.length, 50);
  assert.equal(collectibleIdentity({ host: 'old.test', type: 'badge', title: '旧名称', value: 80 }).name, '旧名称');
});

test('bookmark and chip exhibit shapes reflect condition without changing stored values', async () => {
  const source = (await readFile(new URL('../collection/collection.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const state = { ...defaultState(), collectibles: [
    { id: 'paper', type: 'bookmark', title: '<img src=x>', host: 'books.test', color: '#986a41', qualityPercent: 15, foundAt: 1, value: 23 },
    { id: 'circuit', type: 'chip', title: '代码', host: 'code.test', color: '#467b62', qualityPercent: 0, foundAt: 1, value: 30 },
    { id: 'legacy', type: 'badge', title: '老网站', host: 'old.test', foundAt: 1, value: 20 },
  ] };
  const before = structuredClone(state);
  const nodes = new Map();
  const node = () => ({ children: [], value: '', style: { setProperty() {} }, append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; }, addEventListener() {} });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  get('filter').value = 'owned';
  vm.runInNewContext(source, { collectibleDropRate, COLLECTION_TYPES, collectibleValue, explorationLevel, collectiblePrice, collectionMarket, marketQuote, collectibleIdentity, URL,
    document: { getElementById: get, createElement: node }, chrome: { runtime: { sendMessage: async () => ({ ok: true, state }) }, storage: { onChanged: { addListener() {} } } }, window: { addEventListener() {} } });
  await new Promise(resolve => setImmediate(resolve));
  const cards = get('wall').children;
  assert.match(cards[0].children[0].className, /art-bookmark quality-pristine/);
  assert.equal(cards[0].children[0].children[1].children[2].textContent, '<img src=x>');
  assert.match(cards[1].children[0].className, /art-chip quality-fine/);
  assert.equal(cards[1].children[0].children[1].children[1].textContent, '{ }');
  assert.match(cards[2].children[0].className, /quality-classic/);
  assert.deepEqual(state, before);
});

test('collection wall combines item price, history and limited commission with persisted sold price', async () => {
  const source = (await readFile(new URL('../collection/collection.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const market = collectionMarket({});
  let state = { ...defaultState(), collectibles: [{ id: 'commission', title: '收购测试', type: market.featured, host: 'a.test', value: 100, foundAt: 1, soldAt: null }] };
  const nodes = new Map();
  const node = () => ({ children: [], value: '', style: { setProperty() {} }, append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; }, addEventListener(name, fn) { this[name] = fn; } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  get('filter').value = 'owned';
  vm.runInNewContext(source, { collectibleDropRate, COLLECTION_TYPES, collectibleValue, explorationLevel, collectiblePrice, collectionMarket, marketQuote, collectibleIdentity, URL,
    document: { getElementById: get, createElement: node }, chrome: { runtime: { sendMessage: async m => {
      if (m.type === 'MARKET_SELL') state = sellAtMarket(state, m.id, m.mode, m.week, m.price);
      return { ok: true, state };
    } }, storage: { onChanged: { addListener() {} } } }, window: { confirm: () => true, addEventListener() {} } });
  await new Promise(resolve => setImmediate(resolve));
  const body = get('wall').children[0].children[1];
  const expected = marketQuote(state.collectibles[0], market);
  assert.ok(body.children.some(n => n.textContent === `当前市价 ¥${expected.toFixed(2)}`));
  const trends = body.children.find(n => n.className === 'item-trends');
  assert.equal(trends.children[1].children.length, 6);
  const commission = body.children.find(n => n.className === 'buy commission-buy');
  assert.equal(commission.disabled, false);
  await commission.click();
  assert.equal(state.collectionCommission.used, 1);
  assert.match(get('commissionSummary').textContent, /剩余 1 \/ 2/);
  get('filter').value = 'sold'; get('filter').change();
  const soldBody = get('wall').children[0].children[1];
  assert.ok(soldBody.children.some(n => n.textContent === `成交价格 ¥${state.collectibles[0].salePrice.toFixed(2)}`));
  assert.equal(soldBody.children.some(n => n.className === 'buy commission-buy'), false);
  assert.equal(soldBody.children.at(-1).disabled, true);
});

test('probe metadata stays with its source session and duplicate settlement cannot duplicate a collectible', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const url = 'https://source.test/read';
  const session = { tabId: 42, url, startedAt: Date.now(), dwellAccumMs: 0, settled: false, loadMs: 900 };
  const data = { assetMeterState: defaultState(), assetMeterSessions: { '42': session } };
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async values => Object.assign(data, structuredClone(values)),
  } }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} } };
  const tracker = await import('../background/session-tracker.js');
  await tracker.applyDwellFromProbe(42, 16000, false, { title: 'Wrong page' }, 'https://other.test/');
  assert.equal(data.assetMeterSessions['42'].pageElements, undefined);
  await tracker.applyDwellFromProbe(42, 60000, false, { title: 'Source article', color: '#abcdef', hasCode: true }, url);
  const saved = data.assetMeterSessions['42'];
  await tracker.settleSessionData(saved);
  assert.equal(data.assetMeterState.collectibles[0].title, 'Source article');
  assert.equal(data.assetMeterState.collectibles[0].type, 'chip');
  await tracker.settleSessionData(saved);
  assert.equal(data.assetMeterState.collectibles.length, 1);
  assert.equal(data.assetMeterState.totalVisits, 1);
});

test('component specimens use an allowlist, preserve page identity and keep legacy market quotes', () => {
  for (const kind of ['code', 'navigation', 'search', 'media', 'article', 'icon']) {
    const item = recordCollectibleVisit(defaultState(), visit('components.test', {
      pageElements: { title: '页面标题', webComponent: kind, color: '#123456' },
    })).collectibles[0];
    assert.equal(item.webComponent, kind);
    assert.equal(collectibleIdentity(item).component.kind, kind);
    assert.equal(collectibleIdentity(JSON.parse(JSON.stringify(item))).component.kind, kind);
    assert.equal(item.type, 'badge');
    assert.equal(item.value, 8.5);
    assert.equal(item.source, 'https://components.test/article');
  }
  assert.equal(cleanPageElements({ webComponent: '__proto__' }).webComponent, '');
  assert.equal(cleanPageElements({ webComponent: '<script>' }).webComponent, '');
  const code = recordCollectibleVisit(defaultState(), visit('code.test', {
    pageElements: { hasCode: true, webComponent: 'media' },
  })).collectibles[0];
  assert.equal(code.webComponent, 'code');
  assert.equal(code.type, 'chip');
  const legacy = { id: 'legacy', host: 'old.test', title: '旧名称', type: 'badge', value: 80, soldAt: null };
  const before = structuredClone(legacy);
  const market = collectionMarket({});
  const price = marketQuote(legacy, market);
  assert.equal(collectibleIdentity(legacy).component, null);
  assert.equal(collectibleIdentity(legacy).name, '旧名称');
  assert.deepEqual(legacy, before);
  assert.equal(marketQuote(legacy, market), price);
  assert.equal(sellCollectible({ ...defaultState(), collectibles: [legacy] }, legacy.id).collectibleSales, 80);
});
