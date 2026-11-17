import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionMarket, marketQuote } from '../core/market-pricing.js';
test('market and item demand are stable within week and independent of personal progression', () => {
  const date = new Date(2026, 10, 18, 12);
  const low = collectionMarket({ totalVisits: 0, totalAsset: 0 }, date);
  const high = collectionMarket({ totalVisits: 99999, totalAsset: 1e9, unlockedAchievements: ['all'] }, date);
  assert.deepEqual(low, high);
  assert.deepEqual(collectionMarket({}, new Date(2026, 10, 19, 12)), low);
  assert.equal(low.history.length, 6);
  assert.equal(low.history.at(-1).index, low.index);
  const quotes = new Set();
  for (let i = 0; i < 30; i++) {
    const item = { type: 'badge', value: 100, host: `site${i}.test`, title: `纪念章${i}` };
    const quote = marketQuote(item, low);
    assert.ok(quote >= 65 && quote <= 140);
    assert.equal(quote, marketQuote(item, high));
    assert.equal(marketQuote(item, low, 'commission'), Math.round(quote * 1.1 * 100) / 100);
    quotes.add(quote);
  }
  assert.ok(quotes.size > 3);
});
test('local market changes across weeks, includes both rises and falls, and preserves bounds', () => {
  const quotes = [];
  for (let week = 0; week < 52; week++) {
    const market = collectionMarket({}, new Date(2026, 0, 5 + week * 7, 12));
    assert.ok(market.event.name && market.event.detail);
    for (const type of ['badge', 'bookmark', 'chip']) {
      const price = marketQuote({ id: 'test', host: 'a.test', title: '纪念物', value: 100, type }, market);
      assert.ok(price >= 65 && price <= 140);
      quotes.push(price);
    }
  }
  assert.ok(quotes.some(p => p < 100));
  assert.ok(quotes.some(p => p > 100));
});
