import { walletBalance } from './shop.js';
import { estateHost } from './estate.js';

export const COMPANY_TYPES = [
  { id: 'publisher', name: '出版社', symbol: '▤', description: '在不同页面深度阅读，自动出版作品。', target: 3, dwellMs: 60000, reward: 80, unit: '篇深度阅读', titles: ['周末阅读小刊', '森林书店专题', '星光阅读合集'] },
  { id: 'explorer', name: '探索事务所', symbol: '◈', description: '探索不同域名，自动交付调查报告。', target: 5, dwellMs: 15000, reward: 100, unit: '个不同域名', titles: ['互联网路线勘察', '远方站点调查', '新视野探索报告'] },
];
export const companyPrice = state => 1000 * ((state.companies || []).length + 1);
export const companyLevel = company => Math.min(5, 1 + Math.floor(company.completed / 5));
export const companyType = company => COMPANY_TYPES.find(type => type.id === company.type);
export function nextOrder(company, now = Date.now()) {
  const type = companyType(company), level = companyLevel(company);
  return { title: type.titles[company.completed % type.titles.length], target: type.target + level - 1,
    reward: type.reward * level, seen: [], startedAt: now };
}
export function createCompany(state, name, typeId, headquarters = '') {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24) throw new Error('公司名称需为 1–24 个字符');
  name = name.trim();
  if (!COMPANY_TYPES.some(type => type.id === typeId)) throw new Error('请选择有效的主营业务');
  const companies = state.companies || [];
  if (companies.some(company => company.name.toLowerCase() === name.toLowerCase())) throw new Error('公司名称已存在');
  if (headquarters && !(state.estates || []).some(estate => estate.host === headquarters)) throw new Error('总部必须是已持有的地产');
  const price = companyPrice(state);
  if (walletBalance(state) < price) throw new Error('余额不足');
  const company = { id: globalThis.crypto.randomUUID(), name, type: typeId, headquarters,
    foundedAt: Date.now(), completed: 0, income: 0, history: [] };
  company.order = nextOrder(company);
  return { ...state, companySpent: Math.round(((state.companySpent || 0) + price) * 100) / 100,
    companies: [...companies, company] };
}

// Only accepted browsing settlements reach here. Each company progresses independently.
export function recordCompanyVisit(state, entry) {
  if (entry.kind && entry.kind !== 'browse') return { state, payouts: [] };
  const host = estateHost(entry.url);
  if (!host || !(state.companies || []).length) return { state, payouts: [] };
  const parsed = new URL(entry.url);
  const page = `${parsed.origin}${parsed.pathname}`; // query/fragment changes cannot fill a reading order
  const payouts = [];
  const companies = state.companies.map(company => {
    const type = companyType(company), order = company.order;
    if ((entry.metrics?.dwellMs || 0) < type.dwellMs) return company;
    const key = type.id === 'publisher' ? page : host;
    if (order.seen.includes(key)) return company;
    const seen = [...order.seen, key];
    if (seen.length < order.target) return { ...company, order: { ...order, seen } };
    const project = { title: order.title, amount: order.reward, ts: Date.now() };
    const next = { ...company, completed: company.completed + 1,
      income: Math.round((company.income + order.reward) * 100) / 100,
      history: [project, ...company.history].slice(0, 30) };
    payouts.push({ name: company.name, amount: order.reward, title: order.title });
    return { ...next, order: nextOrder(next) }; // this visit never spills into the next order
  });
  return { state: { ...state, companies }, payouts };
}
