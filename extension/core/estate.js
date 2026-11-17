import { walletBalance } from './shop.js';

export const ESTATE_PRICE = 500;
export const ESTATE_SLOTS = 3;
export const ESTATE_DAILY_LIMIT = 3;
export const ESTATE_LEVELS = [
  { name: '小摊位', coefficient: 0.2, price: 0, visits: 0, days: 0, symbol: '⌂' },
  { name: '店铺', coefficient: 0.35, price: 800, visits: 5, days: 2, symbol: '▤' },
  { name: '工作室', coefficient: 0.5, price: 2000, visits: 15, days: 5, symbol: '▥' },
  { name: '大楼', coefficient: 0.75, price: 5000, visits: 30, days: 10, symbol: '▦' },
  { name: '总部', coefficient: 1, price: 12000, visits: 60, days: 20, symbol: '♜' },
];
const round = n => Math.round(n * 100) / 100;

// Exact hostname (except www): keep unrelated tenants and subdomains separate.
export function estateHost(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch { return null; }
}

export function purchaseEstate(state, host) {
  const candidate = (state.estateDiscoveries || []).find(row => row.host === host);
  if (!candidate) throw new Error('请先有效浏览这个网站');
  const estates = state.estates || [];
  if (estates.some(row => row.host === host)) throw new Error('已持有这个网站的地契');
  if (estates.length >= ESTATE_SLOTS) throw new Error('地产位已满（最多 3 块）');
  if (walletBalance(state) < ESTATE_PRICE) throw new Error('余额不足');
  return { ...state, estateSpent: round((state.estateSpent || 0) + ESTATE_PRICE),
    estates: [...estates, { host, url: candidate.url, level: 1, purchasedAt: Date.now(),
      visits: 0, days: 0, lastDay: state.estateSaleQuotas?.[host]?.lastDay || '', dailyVisits: state.estateSaleQuotas?.[host]?.dailyVisits || 0, income: 0 }] };
}

export function upgradeEstate(state, host) {
  const estate = (state.estates || []).find(row => row.host === host);
  if (!estate) throw new Error('尚未持有这块地产');
  const next = ESTATE_LEVELS[estate.level];
  if (!next) throw new Error('地产已满级');
  if (estate.visits < next.visits || estate.days < next.days) throw new Error('经营次数或经营天数尚未达标');
  if (walletBalance(state) < next.price) throw new Error('余额不足');
  return { ...state, estateSpent: round((state.estateSpent || 0) + next.price),
    estates: state.estates.map(row => row.host === host ? { ...row, level: row.level + 1 } : row) };
}

// Called only after an accepted browse deposit; daily limits survive resets/restarts.
export function recordEstateVisit(state, entry, baseAmount) {
  const host = estateHost(entry.url);
  if (!host) return { state, income: 0 };
  const discoveries = state.estateDiscoveries || [];
  const url = new URL(entry.url).origin + '/';
  let next = { ...state, estateDiscoveries: [{ host, url }, ...discoveries.filter(row => row.host !== host)].slice(0, 100) };
  const estate = (state.estates || []).find(row => row.host === host);
  if (!estate || (entry.metrics?.dwellMs || 0) < 15000) return { state: next, income: 0 };
  const sameDay = estate.lastDay === state.dayKey;
  const count = sameDay ? estate.dailyVisits : 0;
  if (count >= ESTATE_DAILY_LIMIT) return { state: next, income: 0 };
  const income = round(Math.min(10, Math.max(0, baseAmount)) * ESTATE_LEVELS[estate.level - 1].coefficient);
  if (!income) return { state: next, income: 0 };
  next = { ...next, estates: state.estates.map(row => row.host !== host ? row : {
    ...row, visits: row.visits + 1, days: row.days + (sameDay ? 0 : 1), lastDay: state.dayKey,
    dailyVisits: count + 1, income: round(row.income + income),
  }) };
  return { state: next, income, host };
}
