import { weekKey } from './weekly.js';
const round = n => Math.round(n * 100) / 100;
function seed(text) { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
const EVENTS = [
  { name: '独立站点复兴', detail: '独立站点展览带动徽章需求，电子藏品买家暂时观望。', changes: { badge: 0.14, bookmark: 0.02, chip: -0.06 } },
  { name: '阅读季开幕', detail: '数字书房集中收购阅读纪念物，书签品类需求上升。', changes: { badge: -0.04, bookmark: 0.16, chip: 0 } },
  { name: '开源技术展', detail: '技术展征集数字工艺，芯片藏品交易热度上升。', changes: { badge: 0, bookmark: -0.05, chip: 0.17 } },
  { name: '收藏市场休整', detail: '买家放缓收购，各品类报价承压。', changes: { badge: -0.1, bookmark: -0.08, chip: -0.13 } },
];
function period(week) {
  const n = seed(week), event = EVENTS[n % EVENTS.length];
  const rates = Object.fromEntries(['badge', 'bookmark', 'chip'].map(type => [type, round(0.9 + (seed(week + type) % 21) / 100 + event.changes[type])]));
  return { event, rates, index: Math.round(Object.values(rates).reduce((a, b) => a + b, 0) / 3 * 100) };
}
export function collectionMarket(state, date = new Date()) {
  const week = weekKey(date);
  const index = Math.floor(Date.parse(week + 'T12:00:00Z') / 604800000);
  const types = ['badge', 'bookmark', 'chip'];
  const featured = types[((index % types.length) + types.length) % types.length];
  const current = period(week);
  const history = Array.from({ length: 6 }, (_, i) => { const d = new Date(date); d.setDate(d.getDate() - (5 - i) * 7); const key = weekKey(d); return { week: key, ...period(key) }; });
  const used = state.collectionCommission?.week === week ? state.collectionCommission.used : 0;
  return { week, featured, ...current, history, used, remaining: Math.max(0, 2 - used) };
}
export function marketQuote(item, market, mode = 'market') {
  const demand = (seed(`${market.week}:${item.speciesKey || `${item.host || ''}:${item.title || item.id}`}`) % 17 - 8) / 100;
  const price = round(item.value * Math.max(0.65, Math.min(1.4, market.rates[item.type] + demand)));
  return mode === 'commission' ? round(price * 1.1) : price;
}
