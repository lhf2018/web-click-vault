import { walletBalance } from './shop.js';
import { estateHost } from './estate.js';

export const COMPANY_TYPES = [
  { id: 'publisher', name: '出版社', symbol: '▤', description: '在不同页面深度阅读，自动出版作品。', target: 3, dwellMs: 60000, reward: 80, unit: '篇深度阅读', titles: ['周末阅读小刊', '森林书店专题', '星光阅读合集'] },
  { id: 'explorer', name: '探索事务所', symbol: '◈', description: '探索不同域名，自动交付调查报告。', target: 5, dwellMs: 15000, reward: 100, unit: '个不同域名', titles: ['互联网路线勘察', '远方站点调查', '新视野探索报告'] },
];
export const companyPrice = state => 1000 * ((state.companies || []).length + 1);
export const companyLevel = company => Math.min(5, 1 + Math.floor(company.completed / 5));
export const companyType = company => COMPANY_TYPES.find(type => type.id === company.type);
export const COMPANY_STAFF = {
  specialist: { name: '专业人员', price: 200, salary: 12, description: '报酬 +25%，目标 +1，每单薪酬 ¥12' },
  assistant: { name: '业务助理', price: 150, salary: 10, description: '目标 −1（至少 2），每单薪酬 ¥10' },
};
export const COMPANY_FACILITIES = {
  archive: { name: '资料架', price: 300, description: '每单制作成本减少 ¥5' },
  studio: { name: '专业工作台', price: 600, description: '每单合同报酬 +20%' },
};
const round = n => Math.round(n * 100) / 100;
export function nextOrder(company, now = Date.now(), balance = Infinity) {
  const type = companyType(company), level = companyLevel(company);
  const mode = company.strategy === 'risk' && balance < 20 ? 'safe' : company.strategy || 'safe';
  const staff = COMPANY_STAFF[company.staff];
  const target = Math.max(2, type.target + level - 1 + (mode === 'premium' ? 2 : 0) + (company.staff === 'specialist' ? 1 : company.staff === 'assistant' ? -1 : 0));
  const gross = round(type.reward * level * (mode === 'premium' ? 1.6 : mode === 'risk' ? 1.5 : 1) * (company.staff === 'specialist' ? 1.25 : 1) * (company.facilities?.includes('studio') ? 1.2 : 1));
  const cost = Math.max(0, (mode === 'safe' ? 0 : mode === 'premium' ? 15 : 20) - (company.facilities?.includes('archive') ? 5 : 0));
  const salary = staff?.salary || 0;
  return { title: type.titles[company.completed % type.titles.length], target, reward: round(gross - cost - salary),
    gross, cost, salary, mode, maxLoss: mode === 'risk' ? 20 : 0,
    safeReward: round(type.reward * level - salary), seen: [], startedAt: now };
}
export function manageCompany(state, id, action, value) {
  const company = (state.companies || []).find(c => c.id === id);
  if (!company) throw new Error('公司不存在');
  let price = 0, patch;
  if (action === 'staff') {
    if (company.staff) throw new Error('员工位已满，请先解聘');
    if (!COMPANY_STAFF[value]) throw new Error('员工不存在');
    price = COMPANY_STAFF[value].price; patch = { staff: value };
  } else if (action === 'dismiss') {
    if (!company.staff) throw new Error('当前没有员工');
    patch = { staff: null };
  } else if (action === 'facility') {
    if (!COMPANY_FACILITIES[value]) throw new Error('设施不存在');
    if (company.facilities?.includes(value)) throw new Error('设施已经建成');
    price = COMPANY_FACILITIES[value].price;
    patch = { facilities: [...(company.facilities || []), value] };
  } else if (action === 'strategy') {
    if (!['safe', 'premium', 'risk'].includes(value)) throw new Error('策略不存在');
    if (value === 'risk' && walletBalance(state) < 20) throw new Error('余额不足以承担最大亏损 ¥20');
    patch = { strategy: value, lossStreak: 0 };
  } else throw new Error('操作不存在');
  if (walletBalance(state) < price) throw new Error('余额不足');
  return { ...state, companyBuildSpent: round((state.companyBuildSpent || 0) + price),
    companies: state.companies.map(c => c.id === id ? { ...c, ...patch } : c) };
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
export function recordCompanyVisit(state, entry, random = Math.random) {
  if (entry.kind && entry.kind !== 'browse') return { state, payouts: [] };
  const host = estateHost(entry.url);
  if (!host || !(state.companies || []).length) return { state, payouts: [] };
  const parsed = new URL(entry.url);
  const page = `${parsed.origin}${parsed.pathname}`; // query/fragment changes cannot fill a reading order
  const payouts = [];
  let available = walletBalance(state), losses = 0;
  const lossEntries = [];
  const companies = state.companies.map(company => {
    const type = companyType(company), order = company.order;
    if ((entry.metrics?.dwellMs || 0) < type.dwellMs) return company;
    const key = type.id === 'publisher' ? page : host;
    if (order.seen.includes(key)) return company;
    const seen = [...order.seen, key];
    if (seen.length < order.target) return { ...company, order: { ...order, seen } };
    const canRisk = available >= (order.maxLoss || 0);
    const failed = order.mode === 'risk' && canRisk && random() < 0.1;
    const amount = failed ? -order.maxLoss : order.mode === 'risk' && !canRisk ? order.safeReward : order.reward;
    available = round(available + amount);
    const lossStreak = failed ? (company.lossStreak || 0) + 1 : 0;
    const strategy = lossStreak >= 2 || (order.mode === 'risk' && !canRisk) ? 'safe' : company.strategy;
    const project = { title: order.title, amount, ts: Date.now(), gross: failed ? 0 : order.mode === 'risk' && !canRisk ? round(order.safeReward + order.salary) : order.gross,
      cost: failed ? order.maxLoss : order.mode === 'risk' && !canRisk ? 0 : order.cost || 0, salary: failed ? 0 : order.salary || 0,
      outcome: failed ? '返工损失' : order.mode === 'risk' && !canRisk ? '余额不足，按普通订单结算' : '正常交付' };
    const next = { ...company, completed: company.completed + 1,
      income: round(company.income + Math.max(0, amount)), losses: round((company.losses || 0) + Math.max(0, -amount)), lossStreak, strategy,
      history: [project, ...company.history].slice(0, 30) };
    if (amount < 0) {
      losses = round(losses - amount);
      lossEntries.push({ id: globalThis.crypto.randomUUID(), kind: 'company_loss', ts: project.ts, host: company.name, amount,
        reason: `公司风险订单 · ${company.name} · 返工损失` });
    } else payouts.push({ name: company.name, amount, title: order.title });
    return { ...next, order: nextOrder(next, Date.now(), available) };
  });
  return { state: { ...state, companies, ...(losses ? { companyLosses: round((state.companyLosses || 0) + losses),
    recentEntries: [...lossEntries, ...(state.recentEntries || [])].slice(0, 50) } : {}) }, payouts };
}
