// Permanent upgrades purchased with locally earned virtual currency.
export const SHOP_CATEGORIES = [
  { id: "all", name: "全部商品" },
  { id: "tools", name: "随身工具" },
  { id: "studio", name: "效率空间" },
  { id: "growth", name: "增长科技" },
];
export const SHOP_ITEMS = [
  { id: "notebook", category: "tools", symbol: "✎", name: "灵感笔记本", description: "把一闪而过的想法，变成持续积累的资产。", price: 50, growth: 1.65, bonus: 0.1, maxLevel: 10 },
  { id: "bookmark", category: "tools", symbol: "⌑", name: "星光书签", description: "为值得重访的网页留下一枚坐标。", price: 120, growth: 1.7, bonus: 0.15, maxLevel: 10 },
  { id: "compass", category: "tools", symbol: "◈", name: "探索指南针", description: "带着好奇心出发，让每一次探索更有收获。", price: 400, growth: 1.75, bonus: 0.4, maxLevel: 10 },
  { id: "workbench", category: "studio", symbol: "▤", name: "效率工作台", description: "给知识积累配一套顺手的装备。", price: 250, growth: 1.8, bonus: 0.3, maxLevel: 10 },
  { id: "library", category: "studio", symbol: "▥", name: "私人图书馆", description: "从零散的收藏，到属于你的知识世界。", price: 800, growth: 1.85, bonus: 0.7, maxLevel: 10 },
  { id: "observatory", category: "studio", symbol: "◎", name: "灵感观测站", description: "站得更高一点，发现知识之间的联系。", price: 3000, growth: 1.9, bonus: 2, maxLevel: 10 },
  { id: "engine", category: "growth", symbol: "ϟ", name: "增长引擎", description: "让已有积累，推动下一次增长。", price: 1000, growth: 2, bonus: 1, maxLevel: 10 },
  { id: "reactor", category: "growth", symbol: "✳", name: "复利反应堆", description: "更强劲的收益装备，给长期探索加把力。", price: 6000, growth: 2.1, bonus: 4, maxLevel: 10 },
  { id: "portal", category: "growth", symbol: "✧", name: "星际传送门", description: "为下一段旅程，打开全新的增长空间。", price: 20000, growth: 2.2, bonus: 10, maxLevel: 10 },
];

const RULES = {
  notebook: { asset: 0, visits: 0 },
  bookmark: { asset: 500, visits: 50, effect: "revisit", extra: 0.15, label: "当日重访路径额外 +15% / 级" },
  workbench: { asset: 3000, visits: 200, effect: "focus", extra: 0.2, label: "可见停留 ≥15秒额外 +20% / 级" },
  compass: { asset: 12000, visits: 500, effect: "new_host", extra: 0.4, label: "当日首次探索域名额外 +40% / 级" },
  library: { asset: 150000, visits: 2000, effect: "deep", extra: 0.7, label: "可见阅读 ≥60秒额外 +70% / 级" },
  engine: { asset: 50000, visits: 1000 },
  observatory: { asset: 500000, visits: 4000, effect: "new_path", extra: 2, label: "当日探索新路径额外 +200% / 级" },
  reactor: { asset: 2000000, visits: 8000, effect: "extended", extra: 4, label: "可见阅读 ≥120秒额外 +400% / 级" },
  portal: { asset: 10000000, visits: 15000, effect: "new_host", extra: 10, label: "当日首次探索域名额外 +1000% / 级" },
};
for (const item of SHOP_ITEMS) Object.assign(item, RULES[item.id]);

export function unlockInfo(state, item) {
  const unlocked = itemLevel(state, item)>0 || ((state.totalAsset||0)>=item.asset && (state.totalVisits||0)>=item.visits);
  return { unlocked, progress: unlocked ? 1 : Math.min(1, Math.min((state.totalAsset||0)/item.asset, (state.totalVisits||0)/item.visits)),
    hint: `累计收益 ¥${item.asset.toLocaleString('zh-CN')} 且有效浏览 ${item.visits} 页解锁` };
}

export function effectMatches(item, metrics = {}) {
  const dwell = metrics.dwellMs || 0;
  return item.effect === "revisit" ? metrics.freshKind === "seen_path"
    : item.effect === "new_host" ? metrics.freshKind === "first_host"
    : item.effect === "new_path" ? metrics.freshKind === "new_path"
    : item.effect === "focus" ? dwell >= 15000
    : item.effect === "deep" ? dwell >= 60000
    : item.effect === "extended" ? dwell >= 120000 : false;
}

export function depositMultiplier(state, metrics = {}) {
  const extras = SHOP_ITEMS.filter(item => effectMatches(item, metrics) && itemLevel(state,item)>0)
    .map(item => ({ id: item.id, name: item.name, bonus: Math.round(itemLevel(state,item)*item.extra*100)/100 }));
  return { multiplier: Math.round((incomeMultiplier(state)+extras.reduce((sum,item)=>sum+item.bonus,0))*100)/100, extras };
}

export function itemLevel(state, item) {
  const level = state.shopLevels?.[item.id];
  return Number.isInteger(level) ? Math.max(0, Math.min(item.maxLevel, level)) : 0;
}

export function itemPrice(item, level) {
  return Math.round(item.price * item.growth ** level * 100) / 100;
}

export function walletBalance(state) {
  return Math.max(0, Math.round(((state.totalAsset || 0) - (state.shopSpent || 0)) * 100) / 100);
}

export function incomeMultiplier(state) {
  return Math.round((1 + SHOP_ITEMS.reduce((sum, item) => sum + itemLevel(state, item) * item.bonus, 0)) * 100) / 100;
}

export function purchaseUpgrade(state, itemId) {
  const item = SHOP_ITEMS.find((item) => item.id === itemId);
  if (!item) throw new Error("商品不存在");
  if (!unlockInfo(state,item).unlocked) throw new Error("商品尚未解锁：" + unlockInfo(state,item).hint);
  const level = itemLevel(state, item);
  if (level >= item.maxLevel) throw new Error("该商品已满级");
  const price = itemPrice(item, level);
  if (walletBalance(state) < price) throw new Error("余额不足，继续浏览积累收益吧");
  return {
    ...state,
    shopSpent: Math.round(((state.shopSpent || 0) + price) * 100) / 100,
    shopLevels: { ...(state.shopLevels || {}), [item.id]: level + 1 },
    shopPurchases: [{ itemId: item.id, level: level + 1, price, ts: Date.now() }, ...(state.shopPurchases || [])].slice(0, 30),
  };
}
