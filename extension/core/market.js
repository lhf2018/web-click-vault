import { sellCollectible } from './collectibles.js';
import { applyDeposit } from './ledger.js';
import { collectionMarket, marketQuote } from './market-pricing.js';
export { collectionMarket, marketQuote } from './market-pricing.js';
const round = n => Math.round(n * 100) / 100;
export function sellAtMarket(state, id, mode, expectedWeek, expectedPrice, date = new Date()) {
  if (!['market', 'commission'].includes(mode)) throw new Error('出售方式不存在');
  const market = collectionMarket(state, date);
  if (expectedWeek !== market.week) throw new Error('本周行情已刷新，请重新查看报价');
  const item = (state.collectibles || []).find(c => c.id === id && c.soldAt == null);
  if (!item) throw new Error('藏品不存在或已经出售');
  if (mode === 'commission' && (item.type !== market.featured || !market.remaining)) throw new Error('不符合委托类型或本周额度已用完');
  const price = marketQuote(item, market, mode);
  if (expectedPrice !== price) throw new Error('报价已变化，请刷新');
  let next = sellCollectible(state, id);
  const transfer = Math.min(price, item.value);
  next = { ...next, collectibleSales: round((state.collectibleSales || 0) + transfer),
    collectibles: next.collectibles.map(c => c.id === id ? { ...c, salePrice: price, saleMode: mode } : c),
    recentEntries: next.recentEntries.map((row, i) => i === 0 ? { ...row, amount: transfer, reason: `${mode === 'commission' ? '收购委托' : '行情出售'} · 藏品转现金${price < item.value ? ' · 折价' : ''}` } : row) };
  if (price > item.value) next = applyDeposit(next, { kind: 'market_income', host: item.host, amount: round(price - item.value), reason: '藏品出售溢价收益 · 不享受装备倍率' });
  if (mode === 'commission') next = { ...next, collectionCommission: { week: market.week, used: market.used + 1 } };
  return next;
}
