import { achievementBonuses } from './achievements.js';
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
  specialist: { name: '专业人员', price: 200, salary: 12, description: '主营报酬 +25% · 目标 +1 · 每单薪酬 ¥12' },
  assistant: { name: '业务助理', price: 150, salary: 10, description: '主营目标 −1 · 每单薪酬 ¥10' },
  operations: { name: '运营主管', price: 900, salary: 22, completed: 12, description: '主营目标 −2 · 每单薪酬 ¥22' },
  businessLead: { name: '拓展经理', price: 1600, salary: 25, expansion: 1, description: '第二业务目标 −2 · 报酬 +30% · 每单薪酬 ¥25' },
};
export const COMPANY_TEAM_MILESTONES = [0, 5, 12, 25];
export const companyTeam = company => company.team ?? (Object.hasOwn(COMPANY_STAFF, company.staff) ? [company.staff] : []);
export const companyTeamCapacity = company => COMPANY_TEAM_MILESTONES.filter(completed => company.completed >= completed).length;

export function companyStaffRequirement(company, role) {
  const spec = COMPANY_STAFF[role];
  if (spec.completed > company.completed) return `主营交付满 ${spec.completed} 单解锁`;
  if (spec.expansion && !company.expansion) return '开拓第二业务后解锁';
  return '';
}
export const COMPANY_FACILITIES = {
  archive: { name: '资料架', price: 300, description: '每单制作成本减少 ¥5' },
  studio: { name: '专业工作台', price: 600, description: '每单合同报酬 +20%' },
};
export const COMPANY_EXPANSIONS = [
  { completed: 5, price: 1800, multiplier: 1 },
  { completed: 12, price: 5200, multiplier: 1.5 },
  { completed: 25, price: 14000, multiplier: 2.25 },
];
export const expansionType = company => COMPANY_TYPES.find(type => type.id !== company.type);
export const COMPANY_STAGES = ['初创', '起步', '成长', '扩张', '规模化'];
export const COMPANY_MARKET_MILESTONES = [
  { name: '行业新秀', main: 100, branch: 50, days: 30, retained: 10000, premium: 10_000_000 },
  { name: '全国品牌', main: 500, branch: 250, days: 120, retained: 75000, premium: 1_000_000_000 },
  { name: '跨国集团', main: 1600, branch: 900, days: 270, retained: 250000, premium: 50_000_000_000 },
  { name: '全球龙头', main: 3500, branch: 2000, days: 480, retained: 500000, premium: 500_000_000_000 },
  { name: '万亿巨头', main: 6000, branch: 3500, days: 730, retained: 1_000_000, premium: 3_000_000_000_000 },
];
const round = n => Math.round(n * 100) / 100;

function expansionOrder(company, expansion) {
  const type = expansionType(company);
  const spec = COMPANY_EXPANSIONS[expansion.level - 1];
  const lead = companyTeam(company).includes('businessLead');
  const gross = round(type.reward * spec.multiplier * (lead ? 1.3 : 1));
  const salary = lead ? COMPANY_STAFF.businessLead.salary : 0;
  return { title: type.titles[expansion.completed % type.titles.length], seen: [],
    target: Math.max(2, type.target + expansion.level - 1 - (lead ? 2 : 0)),
    reward: round(gross - salary), ...(lead ? { gross, salary } : {}) };
}

export function companyOperatingValue(company) {
  const earnings = Math.max(0, company.income - (company.losses || 0));
  const market = companyMarketProgress(company);
  return round(market.retained + 4000 * (earnings / 1000) ** 1.2 + market.premium);
}

export function companyMarketProgress(company) {
  const branch = company.expansion?.completed || 0;
  const days = company.operatingDays || 0;
  const retained = round((company.retained || 0) + (company.expansion?.reinvested || 0));
  const ready = company.expansion?.level === COMPANY_EXPANSIONS.length;
  const nextIndex = ready ? COMPANY_MARKET_MILESTONES.findIndex(goal =>
    company.completed < goal.main || branch < goal.branch || days < goal.days || retained < goal.retained) : 0;
  const next = COMPANY_MARKET_MILESTONES[nextIndex];
  const current = COMPANY_MARKET_MILESTONES[nextIndex < 0 ? COMPANY_MARKET_MILESTONES.length - 1 : nextIndex - 1];
  return { branch, days, retained, ready, current, next, premium: current?.premium || 0 };
}

export function companyValuations(state) {
  const companies = state.companies || [];
  const weights = companies.length * (companies.length + 1) / 2;
  const build = (state.companyBuildSpent || 0) - (state.companyBuildDisposedCost || 0);
  let total = 0;
  return companies.map((company, index) => {
    const share = (index + 1) / weights;
    const founding = (state.companySpent || 0) * share;
    const cost = founding + build * share + (company.expansion?.reinvested || 0);
    const previous = round(total);
    total += founding * (1 + 0.25 * (companyLevel(company) - 1)) + build * share + companyOperatingValue(company);
    const value = round(round(total) - previous);
    return { cost, value };
  });
}

export function nextOrder(company, now = Date.now(), balance = Infinity) {
  const type = companyType(company), level = companyLevel(company);
  const mode = company.strategy === 'risk' && balance < 20 ? 'safe' : company.strategy || 'safe';
  const team = companyTeam(company);
  const specialist = team.includes('specialist');
  const teamTarget = Number(specialist) - Number(team.includes('assistant')) - 2 * Number(team.includes('operations'));
  const target = Math.max(2, type.target + level - 1 + (mode === 'premium' ? 2 : 0) + teamTarget);
  const gross = round(type.reward * level * (mode === 'premium' ? 1.6 : mode === 'risk' ? 1.5 : 1) * (specialist ? 1.25 : 1) * (company.facilities?.includes('studio') ? 1.2 : 1));
  const cost = Math.max(0, (mode === 'safe' ? 0 : mode === 'premium' ? 15 : 20) - (company.facilities?.includes('archive') ? 5 : 0));
  const salary = team.reduce((sum, role) => sum + (role === 'businessLead' ? 0 : COMPANY_STAFF[role].salary), 0);
  return { title: type.titles[company.completed % type.titles.length], target, reward: round(gross - cost - salary),
    gross, cost, salary, mode, maxLoss: mode === 'risk' ? 20 : 0,
    safeReward: round(type.reward * level - salary), seen: [], startedAt: now,
    ...(company.reinvest ? { retainRate: 0.5 } : {}) };
}
export function manageCompany(state, id, action, value) {
  const company = (state.companies || []).find(c => c.id === id);
  if (!company) throw new Error('公司不存在');
  let price = 0, patch;
  if (action === 'staff') {
    const team = companyTeam(company);
    if (team.length >= companyTeamCapacity(company)) throw new Error('员工位已满，请先解聘');
    if (!Object.hasOwn(COMPANY_STAFF, value)) throw new Error('员工不存在');
    if (team.includes(value)) throw new Error('该岗位已有人任职');
    const requirement = companyStaffRequirement(company, value);
    if (requirement) throw new Error(requirement);
    price = COMPANY_STAFF[value].price;
    patch = { team: [...team, value], staff: null };
  } else if (action === 'dismiss') {
    const team = companyTeam(company);
    const role = value ?? (team.length === 1 ? team[0] : null);
    if (!team.length) throw new Error('当前没有员工');
    if (!team.includes(role)) throw new Error('请选择需要解聘的员工');
    patch = { team: team.filter(employee => employee !== role), staff: null };
  } else if (action === 'facility') {
    if (!COMPANY_FACILITIES[value]) throw new Error('设施不存在');
    if (company.facilities?.includes(value)) throw new Error('设施已经建成');
    price = COMPANY_FACILITIES[value].price;
    patch = { facilities: [...(company.facilities || []), value] };
  } else if (action === 'strategy') {
    if (!['safe', 'premium', 'risk'].includes(value)) throw new Error('策略不存在');
    if (value === 'risk' && walletBalance(state) < 20) throw new Error('余额不足以承担最大亏损 ¥20');
    patch = { strategy: value, lossStreak: 0 };
  } else if (action === 'dividend') {
    if (!['cash', 'reinvest'].includes(value)) throw new Error('分配方式不存在');
    patch = { reinvest: value === 'reinvest' };
  } else if (action === 'expand') {
    const current = company.expansion;
    const level = (current?.level || 0) + 1;
    const spec = COMPANY_EXPANSIONS[level - 1];
    if (!spec) throw new Error('第二业务已达最高等级');
    if (value !== level) throw new Error('扩张报价已变化，请刷新后重试');
    if (company.completed < spec.completed) throw new Error(`主营业务须先交付 ${spec.completed} 单`);
    const reinvested = Math.min(company.retained || 0, spec.price);
    price = round(spec.price - reinvested);
    const expansion = current ? { ...current, level } : { level, completed: 0 };
    expansion.reinvested = round((current?.reinvested || 0) + reinvested);
    expansion.order ||= expansionOrder(company, expansion);
    patch = { expansion, retained: round((company.retained || 0) - reinvested) };
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

function progressOrder(order, type, entry, page, host) {
  if ((entry.metrics?.dwellMs || 0) < type.dwellMs) return order;
  const key = type.id === 'publisher' ? page : host;
  return order.seen.includes(key) ? order : { ...order, seen: [...order.seen, key] };
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
  function pay(company, project, rate = 0) {
    const retained = project.amount > 0 ? round(project.amount * rate) : 0;
    const cash = round(project.amount - retained);
    available = round(available + cash);
    if (cash > 0) payouts.push({ name: company.name, amount: cash, title: project.title });
    return { ...project, ...(retained ? { retained } : {}) };
  }
  function recordProject(company, project) {
    return { ...company, income: round(company.income + Math.max(0, project.amount)),
      ...(project.retained ? { retained: round((company.retained || 0) + project.retained) } : {}),
      history: [project, ...company.history].slice(0, 30) };
  }
  function settleMain(company) {
    const type = companyType(company), order = company.order || nextOrder(company, Date.now(), available);
    const progressed = progressOrder(order, type, entry, page, host);
    if (progressed === order) return company.order ? company : { ...company, order };
    if (progressed.seen.length < order.target) return { ...company, order: progressed };
    const canRisk = available >= (order.maxLoss || 0);
    const failed = order.mode === 'risk' && canRisk && random() < 0.1;
    const baseIncome = failed ? -order.maxLoss : order.mode === 'risk' && !canRisk ? order.safeReward : order.reward;
    const amount = baseIncome > 0 ? round(baseIncome * (1 + achievementBonuses(state).company)) : baseIncome;
    const achievementBonus = round(amount - baseIncome);
    const lossStreak = failed ? (company.lossStreak || 0) + 1 : 0;
    const strategy = lossStreak >= 2 || (order.mode === 'risk' && !canRisk) ? 'safe' : company.strategy;
    const project = pay(company, { title: order.title, amount, achievementBonus, ts: Date.now(), gross: failed ? 0 : order.mode === 'risk' && !canRisk ? round(order.safeReward + order.salary) : order.gross,
      cost: failed ? order.maxLoss : order.mode === 'risk' && !canRisk ? 0 : order.cost || 0, salary: failed ? 0 : order.salary || 0,
      outcome: failed ? '返工损失' : order.mode === 'risk' && !canRisk ? '余额不足，按普通订单结算' : '正常交付' }, order.retainRate);
    const next = { ...recordProject(company, project), completed: company.completed + 1,
      losses: round((company.losses || 0) + Math.max(0, -amount)), lossStreak, strategy };
    if (amount < 0) {
      losses = round(losses - amount);
      lossEntries.push({ id: globalThis.crypto.randomUUID(), kind: 'company_loss', ts: project.ts, host: company.name, amount,
        reason: `公司风险订单 · ${company.name} · 返工损失` });
    }
    return { ...next, order: nextOrder(next, Date.now(), available) };
  }
  const companies = state.companies.map(company => {
    const next = settleMain(company);
    const expansion = next.expansion;
    if (!expansion) return next;
    const order = progressOrder(expansion.order, expansionType(next), entry, page, host);
    if (order === expansion.order) return next;
    if (order.seen.length < order.target) return { ...next, expansion: { ...expansion, order } };
    const amount = round(order.reward * (1 + achievementBonuses(state).company));
    const project = pay(next, { title: order.title, amount, ts: Date.now(), business: 'expansion',
      ...(order.salary ? { gross: order.gross, salary: order.salary } : {}),
      achievementBonus: round(amount - order.reward) }, 0.7);
    const delivered = { ...expansion, completed: expansion.completed + 1 };
    delivered.order = expansionOrder(next, delivered);
    return { ...recordProject(next, project), expansion: delivered };
  });
  const settled = [];
  for (const [index, company] of companies.entries()) {
    if (company.history === state.companies[index].history) continue;
    const profitable = company.income > state.companies[index].income;
    const day = state.dayKey;
    if (profitable && day && (!company.lastOperatingDay || day > company.lastOperatingDay)) {
      companies[index] = { ...company, operatingDays: (company.operatingDays || 0) + 1, lastOperatingDay: day };
    }
    settled.push(index);
  }
  const valuations = settled.length ? companyValuations({ ...state, companies }) : [];
  for (const index of settled) {
    const company = companies[index];
    companies[index] = { ...company, valuationHistory: [...(company.valuationHistory || []), valuations[index].value].slice(-16) };
  }
  return { state: { ...state, companies, ...(losses ? { companyLosses: round((state.companyLosses || 0) + losses),
    recentEntries: [...lossEntries, ...(state.recentEntries || [])].slice(0, 50) } : {}) }, payouts };
}
