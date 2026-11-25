import { ESTATE_LEVELS } from './estate.js';
import { achievementOverview } from './achievements.js';
import { COLLECTION_TYPES } from './collectibles.js';

const hash = text => [...String(text)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0);
export function estateLandmark(estate) {
  const themes = [
    { name: '林间', color: '#547451', description: '树影围绕着街角的小小据点。' },
    { name: '海岸', color: '#527d89', description: '每一次到访，都像沿着海岸走远一点。' },
    { name: '书巷', color: '#99704b', description: '把熟悉的网页，经营成一条温暖的街。' },
    { name: '星港', color: '#76658e', description: '为每次探索，留下一盏归航的灯。' },
  ];
  const theme = themes[hash(estate.host) % themes.length];
  const level = Math.max(1, Math.min(ESTATE_LEVELS.length, estate.level || 1));
  const next = ESTATE_LEVELS[level];
  return { ...theme, title: `${theme.name}${ESTATE_LEVELS[level - 1].name}`, level,
    milestones: ESTATE_LEVELS.map((step, i) => ({ name: step.name, reached: level > i })),
    next: next ? { name: next.name, visits: Math.max(0, next.visits - (estate.visits || 0)), days: Math.max(0, next.days - (estate.days || 0)), price: next.price } : null };
}
export function companyBrief(company, order = company.order) {
  const publisher = company.type === 'publisher';
  const clients = publisher ? ['街角书店', '周末读书会', '独立杂志社', '城市图书馆'] : ['漫游者协会', '独立站观察站', '城市灵感局', '远航工作室'];
  const n = hash(`${company.id}:${order?.title || ''}`);
  const stories = publisher ? [
    '为读书会编一本小刊：从认真读过的页面中，带回几段不同的思考。',
    '书店的新橱窗需要一期专题。继续深度阅读，为它找到值得停留的内容。',
    '一本独立杂志正在筹备新刊，等待你用不同页面的阅读经历完成选题。',
    '图书馆想做一份阅读地图，每一篇认真读完的文章都是一枚路标。',
  ] : [
    '为漫游者画一张新路线，走访不同域名，寻找下一处值得探索的入口。',
    '一份独立站观察报告正在采样，新的站点会成为报告中的新视角。',
    '灵感局正在寻找城市之外的风景，把不同网站连成一份探索提案。',
    '远航前需要一份站点指南，继续探索，为委托方收集不同的目的地。',
  ];
  return { client: clients[n % clients.length],
    story: stories[n % stories.length],
    specialty: publisher ? '文字与阅读' : '站点与发现',
    rank: ['初创工坊', '街区口碑', '独立品牌', '城市名片', '远航名家'][Math.min(4, Math.floor((company.completed || 0) / 5))] };
}
export function collectionSets(state) {
  const groups = new Map();
  for (const item of state.collectibles || []) {
    const host = item.host || '未知网站';
    if (!groups.has(host)) groups.set(host, { host, name: item.siteName || host, owned: new Set(), found: new Set(), count: 0 });
    const group = groups.get(host);
    if (COLLECTION_TYPES[item.type]) {
      group.found.add(item.type);
      if (item.soldAt == null) { group.owned.add(item.type); group.count++; }
    }
  }
  return [...groups.values()].sort((a, b) => b.owned.size - a.owned.size || b.found.size - a.found.size || a.host.localeCompare(b.host));
}
export function achievementSeries(state) {
  const groups = new Map();
  for (const item of achievementOverview(state)) {
    if (!groups.has(item.category)) groups.set(item.category, { name: item.category, items: [] });
    groups.get(item.category).items.push(item);
  }
  return [...groups.values()].map(group => ({ ...group, unlocked: group.items.filter(a => a.unlocked).length,
    next: group.items.filter(a => !a.unlocked).sort((a, b) => b.progress - a.progress)[0] || null }));
}
export function journeyGoals(state) {
  return achievementSeries(state).filter(s => s.next).sort((a, b) => b.next.progress - a.next.progress).slice(0, 3).map(s => ({
    title: s.next.title, detail: s.next.requirement, progress: s.next.progress, href: '../achievements/index.html',
  }));
}
// Optional, additive display metadata; no balance, valuation or historical item is rewritten.
export function toggleDisplayCollectible(state, id) {
  const item = (state.collectibles || []).find(item => item.id === id && item.soldAt == null);
  if (!item) throw new Error('只能陈列当前持有的藏品');
  const valid = new Set((state.collectibles || []).filter(i => i.soldAt == null).map(i => i.id));
  const pins = [...new Set(state.displayCollectibles || [])].filter(id => valid.has(id));
  if (pins.includes(id)) return { ...state, displayCollectibles: pins.filter(pin => pin !== id) };
  if (pins.length >= 3) throw new Error('展柜最多陈列 3 件，请先撤下一件');
  return { ...state, displayCollectibles: [...pins, id] };
}
