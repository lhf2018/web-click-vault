import { achievementBonuses } from './achievements.js';
// Passive souvenirs. No remote resources are loaded by the collection wall.
export const COLLECTION_LIMIT = 600;
export const COLLECTION_DROP_RATE = 0.03;
export const COLLECTION_DWELL_MS = 30000;
export const COLLECTION_TYPES = {
  badge: { name: '网站徽章', symbol: '◈', value: 10, rarity: '普通' },
  bookmark: { name: '阅读书签', symbol: '▤', value: 20, rarity: '精致' },
  chip: { name: '代码芯片', symbol: '⌘', value: 30, rarity: '稀有' },
};
const WEB_COMPONENTS = {
  code: { label: '代码块标本', symbol: '</>', detail: '把一段逻辑，封存在小小的窗口里。' },
  navigation: { label: '导航栏切片', symbol: '≡', detail: '曾经通向不同风景的一排入口。' },
  search: { label: '搜索框胶囊', symbol: '⌕', detail: '每一次好奇，都从这个小窗口出发。' },
  media: { label: '播放键琥珀', symbol: '▶', detail: '将网页里的播放时刻，凝成一件纪念物。' },
  article: { label: '排版活字片', symbol: 'Aa', detail: '留下一页文字的节奏与留白。' },
  icon: { label: '站点字母印', symbol: '◈', detail: '用站点首字母与主题色，压出一枚专属印记。' },
};
const componentKind = value => typeof value === 'string' && Object.hasOwn(WEB_COMPONENTS, value) ? value : '';
// Browsing progress is permanent: spending or selling cannot lower this level.
export function explorationLevel(state) {
  const visits = Number(state.totalVisits);
  return 1 + Math.min(9, Math.floor(Math.max(0, Number.isFinite(visits) ? visits : 0) / 100));
}
export function collectiblePrice(type, level, qualityPercent = 0) {
  const safeLevel = Math.max(1, Math.min(10, Math.floor(Number(level) || 1)));
  const t = safeLevel - 1;
  const quality = Math.max(-15, Math.min(15, Number(qualityPercent) || 0));
  // Smooth growth through the agreed Lv.1 / Lv.5 / Lv.10 price anchors.
  return Math.round(COLLECTION_TYPES[type].value * (1 + (13 * t + 8 * t * t) / 45) * (1 + quality / 100) * 100) / 100;
}
export function cleanPageElements(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  return { title: typeof raw.title === 'string' ? raw.title.replace(/[\u0000-\u001f]/g, '').slice(0, 120) : '',
    siteName: typeof raw.siteName === 'string' ? raw.siteName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 50) : '',
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '', hasCode: raw.hasCode === true,
    webComponent: componentKind(raw.webComponent) };
}
function hash(text) { let n = 0; for (const c of text) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n; }
export function collectibleIdentity(item) {
  const site = item.siteName || item.host || '未知网站';
  const key = item.speciesKey || `${item.host}:${item.source || item.title}:${item.type}`;
  const fingerprint = hash(key);
  const finishes = ['星轨', '回声', '棱光', '年轮', '流沙', '远航', '晨雾', '微光'];
  const form = item.type === 'chip' ? '电路芯片' : item.type === 'bookmark' ? '阅读书签' : '纪念徽章';
  const kind = componentKind(item.webComponent);
  return { series: `${site} · 站点藏系`, name: item.collectibleName || item.title || `${site} · ${form}`,
    component: kind ? { kind, ...WEB_COMPONENTS[kind] } : null,
    edition: fingerprint.toString(36).toUpperCase().padStart(7, '0'), motif: fingerprint % 6,
    finish: finishes[fingerprint % finishes.length], mark: (item.siteName || item.host || '?').slice(0, 1).toUpperCase() };
}
export function recordCollectibleVisit(state, entry, random = Math.random) {
  if ((entry.kind && entry.kind !== 'browse') || (entry.metrics?.dwellMs || 0) < COLLECTION_DWELL_MS) return state;
  let url;
  try { url = new URL(entry.url); if (!/^https?:$/.test(url.protocol)) return state; } catch { return state; }
  const items = state.collectibles || [];
  if (items.length >= COLLECTION_LIMIT) return state;
  const host = url.hostname.replace(/^www\./, '');
  const source = url.origin + url.pathname;
  const today = items.filter(item => item.day === state.dayKey);
  if (today.length >= 3 || today.some(item => item.host === host) || items.some(item => item.source === source)) return state;
  if (random() >= collectibleDropRate(state)) return state;
  const page = cleanPageElements(entry.pageElements);
  const type = page.hasCode ? 'chip' : entry.metrics.dwellMs >= 60000 ? 'bookmark' : 'badge';
  const foundLevel = explorationLevel(state);
  const qualityPercent = Math.min(15, Math.max(-15, Math.floor(random() * 31) - 15));
  const speciesKey = `${host}${url.pathname}:${type}`;
  const siteName = page.siteName || host;
  const signature = hash(speciesKey);
  const webComponent = page.hasCode ? 'code' : page.webComponent || (type === 'bookmark' ? 'article' : 'icon');
  const tones = ['#39785c', '#956aab', '#ad723e', '#477d9c', '#9b546c', '#697c47', '#7165a0', '#408d8d'];
  const item = { id: globalThis.crypto.randomUUID(), type, title: page.title || host, host, source,
    speciesKey, siteName, webComponent, collectibleName: `${siteName} · ${page.title ? page.title.slice(0, 24) + ' · ' : ''}${WEB_COMPONENTS[webComponent].label} · ${['初光', '回声', '漫游', '微光'][signature % 4]}`,
    color: page.color || tones[hash(host) % tones.length],
    value: collectiblePrice(type, foundLevel, qualityPercent), foundLevel, qualityPercent, day: state.dayKey, foundAt: Date.now(), soldAt: null };
  return { ...state, collectibles: [item, ...items] };
}
export function collectibleValue(state) {
  return Math.round((state.collectibles || []).reduce((sum, item) => sum + (item.soldAt == null ? item.value : 0), 0) * 100) / 100;
}
export function sellCollectible(state, id) {
  const item = (state.collectibles || []).find(item => item.id === id);
  if (!item || item.soldAt != null) throw new Error('藏品不存在或已经出售');
  const ts = Date.now();
  return { ...state, collectibleSales: Math.round(((state.collectibleSales || 0) + item.value) * 100) / 100,
    collectibles: state.collectibles.map(row => row.id === id ? { ...row, soldAt: ts } : row),
    recentEntries: [{ id: globalThis.crypto.randomUUID(), kind: 'collectible_sale', ts,
      host: item.host, amount: item.value, reason: `藏品出售 · ${COLLECTION_TYPES[item.type].name} · 资产转为现金，不计浏览收益` },
      ...(state.recentEntries || [])].slice(0, 50) };
}

export function collectibleDropRate(state) { return COLLECTION_DROP_RATE + achievementBonuses(state).drop; }
