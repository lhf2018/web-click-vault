import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { collectionMarket, marketQuote, sellAtMarket } from '../core/market.js';
import { COLLECTION_TYPES } from '../core/collectibles.js';
import { exchangeAssets, sellAsset, tradeAsset } from '../core/exchange.js';
import { investmentCatalog, investmentValue, investmentQuote, investmentPosition, investProject, exitProject, MAX_INVESTMENT_HOLDINGS, MAX_ORDER_UNITS } from '../core/investments.js';
import { SHOP_ITEMS, itemLevel, itemPrice, walletBalance, purchaseUpgrade } from '../core/shop.js';
import { ESTATE_PRICE } from '../core/estate.js';
import { COMPANY_FACILITIES } from '../core/company.js';
import { defaultState } from '../core/ledger.js';
const source = (await readFile(new URL('../finance/finance.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(page, initial) {
  let state = initial; const nodes = new Map();
  function node(tag) { return { tag, value: '', children: [], textContent: '', dataset: {}, style: {},
    append(...kids) { this.children.push(...kids); if (tag === 'select' && !this.value) this.value = kids[0]?.value || ''; },
    replaceChildren(...kids) { this.children = kids; }, setAttribute() {}, addEventListener(name, fn) { const previous = this[name]; this[name] = (...args) => { previous?.(...args); return fn(...args); }; } }; }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node('div')); return nodes.get(id); };
  vm.runInNewContext(source, { collectionMarket, marketQuote, COLLECTION_TYPES, exchangeAssets, investmentCatalog, investmentValue, investmentQuote, investmentPosition, Date,
    SHOP_ITEMS, itemLevel, itemPrice, walletBalance, ESTATE_PRICE, COMPANY_FACILITIES, MAX_INVESTMENT_HOLDINGS, MAX_ORDER_UNITS,
    document: { getElementById: get, createElement: node, querySelector: () => ({ dataset: { finance: page } }) },
    chrome: { runtime: { sendMessage: async m => {
      try {
        if (m.type === 'MARKET_SELL') state = sellAtMarket(state, m.id, m.mode, m.week, m.price);
        if (m.type === 'SELL_ASSET') state = sellAsset(state, m.kind, m.id, m.price);
        if (m.type === 'TRADE_ASSET') state = tradeAsset(state, m.kind, m.id, m.target, m.price);
        if (m.type === 'INVEST_PROJECT') state = investProject(state, m.projectId, m.units);
        if (m.type === 'EXIT_PROJECT') state = exitProject(state, m.id, m.units ?? null);
        return { ok: true, state };
      } catch (error) { return { ok: false, error: error.message }; }
    } }, storage: { onChanged: { addListener() {} } } }, window: { confirm: () => true, addEventListener() {} }, setInterval() {} });
  await flush();
  function find(part) {
    function walk(n) { if (n.tag === 'button' && n.textContent.includes(part)) return n; return n.children.map(walk).find(Boolean); }
    return walk(get('cards')) || walk(get('activity'));
  }
  return { get, find, state: () => state };
}
test('exchange page completes atomic trade and shows recoverable cash', async () => {
  const ui = await setup('exchange', purchaseUpgrade({ ...defaultState(), totalAsset: 20000, totalVisits: 1000 }, 'notebook'));
  await ui.find('确认置换').click();
  assert.equal(ui.state().shopLevels.notebook, 0);
  assert.equal(ui.state().shopLevels.bookmark, 1);
  assert.equal(ui.state().assetSales, 35);
});
test('investment page invests then exits with correct principal return', async () => {
  const ui = await setup('investments', { ...defaultState(), totalAsset: 1000 });
  assert.equal(ui.get('cards').children.length, 24);
  assert.equal(ui.get('cards').children.filter(n => n.children[0].textContent.includes('本期新项目')).length, 4);
  const price = investmentQuote('zine').price;
  await ui.find('确认买入').click();
  assert.equal(ui.state().investments[0].status, 'active');
  assert.equal(ui.get('metric').textContent, `¥${price.toFixed(2)}`);
  await ui.find('全部卖出 ·').click();
  assert.equal(ui.state().investments[0].status, 'exited');
  assert.equal(walletBalance(ui.state()), Math.round((1000 - price + Math.round(price * 99) / 100) * 100) / 100);
  assert.equal(ui.get('metric').textContent, '¥0.00');
});

test('share controls buy, add and partially sell selected quantities', async () => {
  const ui = await setup('investments', { ...defaultState(), totalAsset: 10000 });
  function input(root) {
    if (root.tag === 'input') return root;
    return root.children.map(input).find(Boolean);
  }
  let buyInput = input(ui.get('cards'));
  buyInput.value = '0'; buyInput.input();
  assert.equal(ui.find('确认买入').disabled, true);
  buyInput.value = '10'; buyInput.input();
  assert.equal(ui.find('确认买入').disabled, false);
  await ui.find('确认买入').click();
  assert.equal(ui.state().investments[0].units, 10);
  buyInput = input(ui.get('cards')); buyInput.value = '5'; buyInput.input();
  await ui.find('追加买入').click();
  assert.equal(ui.state().investments.length, 1);
  assert.equal(ui.state().investments[0].units, 15);
  const sellInput = input(ui.get('activity')); sellInput.value = '4'; sellInput.input();
  await ui.find('按份数卖出').click();
  assert.equal(ui.state().investments[0].status, 'active');
  assert.equal(ui.state().investments[0].units, 11);
  await ui.find('全部卖出').click();
  assert.equal(ui.state().investments[0].status, 'exited');
});
