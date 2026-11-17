import { walletBalance } from './shop.js';
export const INVESTMENT_PROJECTS = [
  { id: 'zine', name: '独立阅读小刊', description: '订阅需求与内容收入推动估值，运营成本影响利润。', principal: 300, volatility: 0.6, risk: '较低波动' },
  { id: 'atlas', name: '小众网站图鉴', description: '数字内容需求和市场关注度影响图鉴业务的价值。', principal: 600, volatility: 1, risk: '中等波动' },
  { id: 'archive', name: '数字档案修复', description: '修复业务受订单需求、设备成本和市场情绪共同影响。', principal: 1200, volatility: 1.5, risk: '较高波动' },
  { id: 'coffee', name: '巷口咖啡工坊', description: '客流与订阅订单带来收入，咖啡豆采购影响成本。', principal: 400, volatility: 0.65, risk: '较低波动' },
  { id: 'garden', name: '城市屋顶农场', description: '生鲜订单、种植成本与社区需求影响经营估值。', principal: 500, volatility: 0.7, risk: '较低波动' },
  { id: 'repair', name: '街区维修合作社', description: '维修订单与备件成本驱动社区服务价值。', principal: 350, volatility: 0.55, risk: '较低波动' },
  { id: 'solar', name: '微光屋顶能源', description: '能源需求、设备运维与市场情绪影响价格。', principal: 1000, volatility: 0.85, risk: '中等波动' },
  { id: 'logistics', name: '最后一公里配送', description: '配送订单与运力成本影响物流网络估值。', principal: 800, volatility: 0.9, risk: '中等波动' },
  { id: 'studio', name: '像素独立游戏社', description: '游戏销量、开发开支与玩家关注度共同驱动行情。', principal: 900, volatility: 1.4, risk: '较高波动' },
  { id: 'music', name: '回声数字唱片', description: '音乐订阅、版权开支与听众需求影响业务价值。', principal: 650, volatility: 1, risk: '中等波动' },
  { id: 'cloud', name: '轻舟云计算', description: '算力订单、设备成本与技术市场情绪影响估值。', principal: 1500, volatility: 1.55, risk: '较高波动' },
  { id: 'ocean', name: '蓝湾循环材料', description: '再生材料订单与回收加工成本推动价格变化。', principal: 1100, volatility: 1.1, risk: '中等波动' },
  { id: 'pet', name: '爪印宠物服务', description: '社区养宠需求、服务收入和运营成本决定估值。', principal: 450, volatility: 0.75, risk: '较低波动' },
  { id: 'travel', name: '山野露营计划', description: '出游需求与营地运营开支影响项目价值。', principal: 750, volatility: 1.2, risk: '中等波动' },
  { id: 'robot', name: '灵巧机器人实验室', description: '设备订单与研发开支推动价格，关注度带来额外波动。', principal: 1800, volatility: 1.7, risk: '较高波动' },
  { id: 'museum', name: '口袋数字展馆', description: '展览订阅、内容制作成本和文化消费需求影响行情。', principal: 550, volatility: 0.8, risk: '中等波动' },
  { id: 'megagrid', name: '洲际清洁能源网络', description: '大型能源基础设施，供能需求与长期运维成本影响估值。', basePrice: 1000, volatility: 0.85, risk: '中等波动', scale: '大型项目' },
  { id: 'orbital', name: '近地轨道物流港', description: '大型轨道运输计划，运力订单与研发成本带来价格波动。', basePrice: 5000, volatility: 1.6, risk: '较高波动', scale: '大型项目' },
  { id: 'silicon', name: '新世代晶圆基地', description: '大型芯片制造项目，算力需求、设备投入和行业情绪共同驱动行情。', basePrice: 10000, volatility: 1.4, risk: '较高波动', scale: '大型项目' },
  { id: 'deepsea', name: '深蓝海底计算枢纽', description: '超大型算力基础设施，计算订单、能源成本与市场预期影响估值。', basePrice: 50000, volatility: 1.2, risk: '中等波动', scale: '大型项目' },
];
export const MAX_INVESTMENT_HOLDINGS = 10;
export const MAX_ORDER_UNITS = 1_000_000_000;
const round = n => Math.round(n * 100) / 100;
const HOUR = 3600000, EPOCH = Date.UTC(2026, 0, 1);
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}
export const INVESTMENT_ROTATION_MS = 21 * 86400000;
const LAUNCH_EPOCH = Date.UTC(2026, 0, 5);
const LAUNCH_THEMES = [
  ['潮汐', '海藻材料工坊', 700, 1.1], ['萤火', '互动影像工作室', 850, 1.3],
  ['青禾', '智慧灌溉计划', 600, 0.7], ['星桥', '卫星数据服务', 1600, 1.6],
  ['白鹭', '低碳建材研究所', 1100, 1], ['纸船', '有声内容工场', 450, 0.8],
  ['苔原', '储能设备计划', 1400, 1.4], ['浮岛', '虚拟演出空间', 950, 1.5],
  ['松果', '社区健康餐厨房', 400, 0.6], ['远帆', '智能航运服务', 1300, 1.2],
  ['夜莺', '语言学习工具', 650, 0.9], ['流沙', '数字设计材料库', 500, 1.1],
];
export function investmentCatalog(now = Date.now()) {
  const period = Math.max(0, Math.floor((now - LAUNCH_EPOCH) / INVESTMENT_ROTATION_MS));
  const newProjects = Array.from({ length: 4 }, (_, index) => investmentSpec(`launch:${period}:${index}`));
  return { period, nextRefresh: LAUNCH_EPOCH + (period + 1) * INVESTMENT_ROTATION_MS,
    projects: [...INVESTMENT_PROJECTS, ...newProjects] };
}
export function investmentSpec(id) {
  const permanent = INVESTMENT_PROJECTS.find(p => p.id === id);
  if (permanent) return permanent;
  const match = /^launch:(0|[1-9]\d{0,5}):([0-3])$/.exec(id);
  if (!match) throw new Error('项目不存在');
  const period = Number(match[1]), index = Number(match[2]);
  const [brand, business, principal, volatility] = LAUNCH_THEMES[(period * 4 + index) % LAUNCH_THEMES.length];
  return { id, name: `${brand}${business} · 第${Math.floor(period / 3) + 1}期`,
    description: '新一批独立项目，需求、营收、运营成本与市场情绪共同驱动估值。',
    principal, volatility, risk: volatility < 0.8 ? '较低波动' : volatility < 1.3 ? '中等波动' : '较高波动',
    launchedAt: LAUNCH_EPOCH + period * INVESTMENT_ROTATION_MS,
    closesAt: LAUNCH_EPOCH + (period + 1) * INVESTMENT_ROTATION_MS };
}
function data(spec, hour) {
  const t = (hour * HOUR - EPOCH) / 86400000, phase = hash(spec.id) * 20;
  const day = Math.floor(t), mix = t - day;
  const noise = key => (hash(`${spec.id}:${day}:${key}`) * (1 - mix) + hash(`${spec.id}:${day + 1}:${key}`) * mix - 0.5) * 2;
  const demand = 100 + 18 * Math.sin(t / 6 + phase) + noise('demand') * 4;
  const revenue = 100 + 14 * Math.sin(t / 11 + phase) + (demand - 100) * 0.4;
  const cost = 100 + 12 * Math.sin(t / 9 + phase + 2) + noise('cost') * 3;
  const sentiment = 50 + 22 * Math.sin(t / 3 + phase) + noise('sentiment') * 8;
  const change = ((demand - 100) * 0.008 + (revenue - cost) * 0.006 + (sentiment - 50) * 0.004) * spec.volatility;
  return { price: round((spec.basePrice || 100) * Math.exp(change)), demand: round(demand), revenue: round(revenue), cost: round(cost), sentiment: round(sentiment) };
}
export function investmentQuote(projectId, now = Date.now()) {
  const spec = investmentSpec(projectId);
  const hour = Math.floor(now / HOUR), current = data(spec, hour);
  const firstHour = spec.launchedAt ? Math.floor(spec.launchedAt / HOUR) : -Infinity;
  const previous = data(spec, Math.max(hour - 24, firstHour)).price;
  return { ...current, hour, change: round((current.price / previous - 1) * 100),
    history: Array.from({ length: 7 }, (_, i) => ({ ts: (hour - (6 - i) * 24) * HOUR, price: data(spec, hour - (6 - i) * 24).price })).filter(point => point.ts >= firstHour * HOUR) };
}
export function investmentPosition(project, now = Date.now()) {
  const quote = investmentQuote(project.projectId, now);
  const entryPrice = project.entryPrice || investmentQuote(project.projectId, project.startedAt).price;
  const units = project.units || project.principal / entryPrice;
  const value = round(units * quote.price), proceeds = round(value * 0.99);
  return { ...quote, entryPrice, units, value, proceeds, fee: round(value - proceeds), profit: round(value - project.principal) };
}
export function investProject(state, projectId, units = 1, now = Date.now()) {
  const spec = investmentSpec(projectId);
  if (spec.launchedAt && (now < spec.launchedAt || now >= spec.closesAt)) throw new Error('该项目不在本期开放名单，已有持仓仍可卖出');
  if (!Number.isSafeInteger(units) || units < 1 || units > MAX_ORDER_UNITS) throw new Error('买入份数须为 1 至 10 亿的整数');
  const projects = state.investments || [];
  const existing = projects.find(p => p.projectId === projectId && p.status === 'active');
  if (!existing && projects.filter(p => p.status === 'active').length >= MAX_INVESTMENT_HOLDINGS) throw new Error('最多同时持有 10 个项目');
  if (!existing && projects.length >= 300) throw new Error('项目记录已达上限（300 笔）');
  const price = investmentQuote(projectId, now).price, cost = round(price * units);
  if (walletBalance(state) < cost) throw new Error('余额不足');
  const previousUnits = existing ? investmentPosition(existing, now).units : 0;
  const principal = round((existing?.principal || 0) + cost), totalUnits = previousUnits + units;
  if (totalUnits > MAX_ORDER_UNITS) throw new Error('单个项目最多持有 10 亿份');
  const project = { ...existing, id: existing?.id || crypto.randomUUID(), projectId, name: spec.name, principal,
    invested: round((existing?.invested ?? existing?.principal ?? 0) + cost),
    entryPrice: principal / totalUnits, units: totalUnits, status: 'active', startedAt: existing?.startedAt || now };
  return { ...state, investmentSpent: round((state.investmentSpent || 0) + cost),
    investments: existing ? projects.map(p => p.id === existing.id ? project : p) : [project, ...projects],
    recentEntries: [{ id: crypto.randomUUID(), kind: 'investment_start', ts: now, host: spec.name, amount: -cost,
      reason: `${existing ? '追加' : '买入'} ${units} 份 · 成交价 ${price.toFixed(2)}` }, ...(state.recentEntries || [])].slice(0, 50) };
}
export function investmentValue(state, now = Date.now()) {
  return round((state.investments || []).filter(p => p.status === 'active').reduce((sum, p) => sum + investmentPosition(p, now).value, 0));
}
export function exitProject(state, id, units = null, now = Date.now()) {
  const project = (state.investments || []).find(p => p.id === id && p.status === 'active');
  if (!project) throw new Error('项目不存在或已经结束');
  const position = investmentPosition(project, now);
  if (units !== null && (!Number.isSafeInteger(units) || units < 1 || units > MAX_ORDER_UNITS)) throw new Error('卖出份数须为正整数，零碎份额可全部卖出');
  const soldUnits = units ?? position.units;
  if (soldUnits > position.units) throw new Error('卖出份数超过持仓');
  const all = soldUnits === position.units;
  const gross = round(soldUnits * position.price), refund = round(gross * 0.99);
  const soldCost = all ? project.principal : round(project.principal * soldUnits / position.units);
  const returned = round((project.returned || 0) + refund);
  const realizedProfit = round((project.realizedProfit || 0) + refund - soldCost);
  const remaining = { ...project, invested: project.invested ?? project.principal, units: all ? 0 : position.units - soldUnits,
    principal: all ? (project.invested ?? project.principal) : round(project.principal - soldCost),
    returned, realizedProfit, status: all ? 'exited' : 'active', ...(all ? { finishedAt: now } : {}) };
  if (!all) remaining.entryPrice = remaining.principal / remaining.units;
  return { ...state, investmentReturned: round((state.investmentReturned || 0) + refund),
    investments: state.investments.map(p => p.id === id ? remaining : p),
    recentEntries: [{ id: crypto.randomUUID(), kind: 'investment_exit', ts: now, host: project.name, amount: refund,
      reason: `卖出 ${soldUnits.toFixed(4)} 份 · 手续费 ${round(gross - refund).toFixed(2)} · 本次盈亏 ${round(refund - soldCost).toFixed(2)}` }, ...(state.recentEntries || [])].slice(0, 50) };
}
