import { ACHIEVEMENTS } from './constants.js';

const tracks = [
  ['visits', '浏览足迹', '次有效浏览', [10, 100, 500, 2000, 10000], ['迈出十步', '百页旅人', '穿行五百页', '漫游者', '万页航行']],
  ['deepReads', '深度阅读', '次至少 60 秒的阅读', [5, 25, 100, 500, 2000], ['静下心来', '字里行间', '百篇沉浸', '长篇旅程', '书海灯塔']],
  ['activeDays', '持续探索', '个有效浏览日', [3, 7, 30, 100, 365], ['三日好奇', '一周足迹', '月光同行', '百日漫游', '四季旅人']],
  ['sites', '网站探索', '个不同网站', [5, 20, 50, 100, 300], ['推开五扇门', '二十种风景', '站点探险家', '百站通行', '互联网地图师']],
  ['earnings', '财富积累', '虚拟累计收益', [20000, 50000, 100000, 300000, 1000000], ['积少成多', '五万里程', '六位数旅程', '稳步积累', '百万足迹']],
  ['collectibles', '奇物收藏', '件历史藏品', [1, 5, 15, 40, 100], ['第一次偶遇', '小小展柜', '奇物陈列室', '私人博物馆', '百物纪行']],
  ['estates', '地产建设', '处持有地产', [1, 3, 5, 10, 20], ['第一把钥匙', '三处落脚点', '街角房东', '十处风景', '城市拼图']],
  ['orders', '公司经营', '笔公司交付', [1, 10, 50, 200, 1000], ['开张大吉', '业务起步', '熟练经营者', '繁忙事务所', '千单事业']],
  ['equipment', '装备成长', '级持有装备总等级', [1, 5, 15, 30, 60], ['整装出发', '工具齐备', '进阶行囊', '装备工坊', '满载远行']],
  ['trades', '项目投资', '笔已卖出投资', [1, 5, 15, 40, 100], ['第一笔成交', '市场观察员', '行情笔记', '投资历练', '百次决策']],
];
const REWARDS = {
  visits: ['browse', '浏览收益'], deepReads: ['deep', '深读收益（≥60秒）'],
  activeDays: ['browse', '浏览收益'], sites: ['new_host', '当日首次探索网站收益'],
  earnings: ['browse', '浏览收益'], collectibles: ['drop', '藏品发现概率'],
  estates: ['estate', '地产经营收入'], orders: ['company', '公司订单净收益'],
  equipment: ['focus', '专注浏览收益（≥15秒）'], trades: ['new_path', '当日探索新路径收益'],
};
function rewardFor(metric, tier) {
  const [kind, label] = REWARDS[metric];
  const bonus = kind === 'drop' ? (tier + 1) / 1000 : (tier + 1) / 100;
  return { kind, bonus, label: `${label} +${Number((bonus * 100).toFixed(1))}${kind === 'drop' ? ' 个百分点' : '%'}` };
}
export const ACHIEVEMENT_CATALOG = [
  ...ACHIEVEMENTS.map(a => ({ ...a, category: '财富积累', metric: 'earnings', reward: rewardFor('earnings', 0), requirement: `累计收益达到 ¥${a.threshold.toLocaleString('zh-CN')}` })),
  ...tracks.flatMap(([metric, category, unit, thresholds, titles]) => thresholds.map((threshold, index) => ({
    id: `milestone_${metric}_${threshold}`, title: titles[index], category, metric, threshold, reward: rewardFor(metric, index),
    requirement: metric === 'earnings' ? `累计收益达到 ¥${threshold.toLocaleString('zh-CN')}` : `达到 ${threshold} ${unit}`,
  }))),
];

export function achievementFacts(state) {
  const stats = state.achievementStats || {};
  return {
    visits: state.totalVisits || 0, earnings: state.totalAsset || 0,
    deepReads: stats.deepReads || 0,
    activeDays: stats.activeDays || 0, sites: (stats.hosts || []).length,
    collectibles: (state.collectibles || []).length,
    estates: (state.estates || []).length,
    orders: (state.companies || []).reduce((n, c) => n + (c.completed || 0) + (c.expansion?.completed || 0), 0),
    equipment: Object.values(state.shopLevels || {}).reduce((n, level) => n + (Number(level) || 0), 0),
    trades: (state.investments || []).filter(p => p.status === 'exited').length,
  };
}
export function achievementOverview(state) {
  const facts = achievementFacts(state), unlocked = new Set(state.unlockedAchievements || []);
  return ACHIEVEMENT_CATALOG.map(item => {
    const current = facts[item.metric] || 0, earned = unlocked.has(item.id) || current >= item.threshold;
    return { ...item, current, unlocked: earned,
      progress: earned ? 1 : Math.min(1, Math.max(0, current / item.threshold)) };
  });
}
export function syncAchievements(state) {
  const ids = new Set(state.unlockedAchievements || []);
  for (const item of achievementOverview(state)) if (item.unlocked) ids.add(item.id);
  if (ids.size === (state.unlockedAchievements || []).length) return state;
  return { ...state, unlockedAchievements: [...ids] };
}
export function recordAchievementVisit(state, entry, day) {
  if (entry.kind && entry.kind !== 'browse') return state;
  const previous = state.achievementStats || {}, hosts = previous.hosts || [];
  let host;
  try { const url = new URL(entry.url); if (/^https?:$/.test(url.protocol)) host = url.hostname.toLowerCase().replace(/^www\./, ''); } catch {}
  return { ...state, achievementStats: {
    deepReads: (previous.deepReads || 0) + ((entry.metrics?.dwellMs || 0) >= 60000 ? 1 : 0),
    activeDays: (previous.activeDays || 0) + (previous.lastActiveDay === day ? 0 : 1),
    lastActiveDay: day,
    hosts: host && !hosts.includes(host) && hosts.length < 1000 ? [...hosts, host] : hosts,
  } };
}

export function achievementBonuses(state) {
  const earned = new Set(state.unlockedAchievements || []);
  const bonuses = { browse: 0, deep: 0, new_host: 0, new_path: 0, focus: 0, estate: 0, company: 0, drop: 0 };
  for (const item of ACHIEVEMENT_CATALOG) {
    if (earned.has(item.id)) bonuses[item.reward.kind] += item.reward.bonus;
  }
  for (const key of Object.keys(bonuses)) bonuses[key] = Math.round(bonuses[key] * 10000) / 10000;
  return bonuses;
}
export function achievementBrowsingEffects(state, metrics = {}) {
  const bonus = achievementBonuses(state);
  return [
    ['browse', '成就 · 浏览', true], ['deep', '成就 · 深读', metrics.dwellMs >= 60000],
    ['focus', '成就 · 专注', metrics.dwellMs >= 15000],
    ['new_host', '成就 · 网站探索', metrics.freshKind === 'first_host'],
    ['new_path', '成就 · 新路径', metrics.freshKind === 'new_path'],
  ].filter(([key, , matches]) => matches && bonus[key] > 0)
    .map(([key, name]) => ({ id: `achievement_${key}`, name, bonus: bonus[key] }));
}
