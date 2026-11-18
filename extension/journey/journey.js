import { collectionSets, achievementSeries } from '../core/journey.js';
import { collectibleIdentity, COLLECTION_TYPES } from '../core/collectibles.js';
import { assetOverview } from '../core/overview.js';
const page = location.pathname.split('/').at(-2);
const panel = document.createElement('section'); panel.className = page === 'overview' ? 'journey-panel overview-map' : 'journey-panel';
panel.setAttribute('aria-label', page === 'overview' ? '资产版图' : '旅程与成长');
if (page === 'overview') document.querySelector('.summary-total').append(panel);
else document.querySelector('main .hero').insertAdjacentElement('afterend', panel);
let state, revision = 0, busy = false, expanded = false, allSeries = false;
const money = n => `¥${Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
function heading(title, note) { panel.append(el('h2', title)); }
function card(title, detail) { const n = el('article', null, 'journey-card'); n.append(el('h3', title), el('p', detail)); return n; }
function grid() { const n = el('div', null, 'journey-grid'); panel.append(n); return n; }
function track(value, label) { const p = el('progress'); p.max = 1; p.value = value; p.setAttribute('aria-label', label); return p; }
function render() {
  panel.replaceChildren();
  if (page === 'collection') collection();
  if (page === 'achievements') achievements();
  if (page === 'overview') overview();
}
function collection() {
  heading('你的私人展柜', '挑选 3 件心爱的藏品陈列。旧徽章、书签和芯片同样可以入柜、组成站点套系。');
  const owned = (state.collectibles || []).filter(i => i.soldAt == null);
  const pinned = (state.displayCollectibles || []).map(id => owned.find(i => i.id === id)).filter(Boolean).slice(0, 3);
  const wall = grid();
  for (let i = 0; i < 3; i++) {
    const item = pinned[i];
    if (!item) { wall.append(card(`展位 ${i + 1} · 待陈列`, '在下方挑选一件藏品，让这段浏览记忆留在这里。')); continue; }
    const identity = collectibleIdentity(item);
    const n = card(identity.name, `${identity.series} · #${identity.edition}`);
    n.prepend(el('div', identity.component?.symbol || (item.type === 'chip' ? '⌘' : item.type === 'bookmark' ? '▤' : '◈'), 'display-emblem'));
    n.append(pinButton(item, true)); wall.append(n);
  }
  const choose = el('details'); choose.open = expanded;
  choose.addEventListener('toggle', () => { expanded = choose.open; });
  choose.append(el('summary', `选择陈列藏品 · 当前持有 ${owned.length} 件`));
  const choices = el('div', null, 'display-choices');
  for (const item of owned) { const button = pinButton(item, pinned.some(i => i.id === item.id)); button.textContent = `${pinned.some(i => i.id === item.id) ? '撤下' : '陈列'} · ${collectibleIdentity(item).name}`; choices.append(button); }
  if (!owned.length) choices.append(el('p', '正常浏览后自动发现藏品，获得后就能陈列。'));
  choose.append(choices); panel.append(choose);
  const sets = el('details'); sets.append(el('summary', '站点套系图鉴 · 徽章 / 书签 / 芯片'));
  const setsWall = el('div', null, 'journey-grid');
  for (const group of collectionSets(state)) {
    const n = card(group.name, `持有 ${group.owned.size} / 3 类 · 历史发现 ${group.found.size} / 3 类${group.owned.size === 3 ? ' · 套系集齐 ✦' : ''}`);
    const slots = el('div', null, 'journey-stages');
    for (const [id, type] of Object.entries(COLLECTION_TYPES)) slots.append(el('span', `${group.owned.has(id) ? '●' : group.found.has(id) ? '◐' : '○'} ${type.name}`, group.owned.has(id) ? 'reached' : ''));
    n.append(slots); setsWall.append(n);
  }
  if (!collectionSets(state).length) setsWall.append(el('p', '发现第一件藏品后，来源站点会出现在图鉴里。'));
  sets.append(setsWall, el('p', '● 当前持有 · ◐ 曾经发现 · ○ 尚未发现。不同页面可发现同站点的不同品类，出售仍保留发现记录。', 'journey-note')); panel.append(sets);
}
function pinButton(item, pinned) {
  const b = el('button', pinned ? '撤下陈列' : '放入展柜', 'journey-button'); b.type = 'button'; b.disabled = busy;
  b.addEventListener('click', async () => {
    if (busy) return; busy = true; ++revision; render();
    try { const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_DISPLAY_COLLECTIBLE', id: item.id }); if (!response?.ok) throw new Error(response?.error || '陈列失败，请重新加载扩展'); state = response.state; }
    catch (error) { message.textContent = error.message; }
    finally { busy = false; render(); }
  }); return b;
}
function achievements() {
  heading('系列勋章 · 下一枚的线索', '沿着已有成就继续探索。系列进度与永久解锁记录一致，不新增现金奖励。');
  const wall = grid();
  const routes = achievementSeries(state).sort((a, b) => (b.next?.progress ?? -1) - (a.next?.progress ?? -1));
  for (const series of allSeries ? routes : routes.slice(0, 3)) {
    const n = card(series.name, `已留印 ${series.unlocked} / ${series.items.length}${series.next ? '' : ' · 系列圆满 ✦'}`);
    n.append(track(series.unlocked / series.items.length, `${series.name}系列进度`));
    const details = el('details'); details.append(el('summary', series.next ? '揭开下一枚勋章的线索' : '查看已走过的里程'));
    if (series.next) details.append(el('h4', series.next.title), el('p', series.next.requirement), track(series.next.progress, '下一枚勋章进度'));
    else details.append(el('p', '这一系列的每一枚勋章，都已经成为你的永久纪念。'));
    n.append(details); wall.append(n);
  }
  const toggle = el('button', allSeries ? '收起系列路线' : `展开全部 ${routes.length} 条系列路线`, 'journey-button');
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(allSeries));
  toggle.addEventListener('click', () => { allSeries = !allSeries; render(); }); panel.append(toggle);
}
function overview() {
  panel.append(el('h2', '资产版图'));
  const totals = assetOverview(state);
  const labels = { cash: '现金', estates: '地产', companies: '公司', equipment: '装备', collectibles: '藏品', investments: '投资' };
  const bar = el('div', null, 'asset-composition');
  const total = Object.keys(labels).reduce((sum, key) => sum + Math.max(0, totals[key]), 0);
  Object.entries(labels).forEach(([key, label], index) => { const part = el('span', null, `asset-part part-${index}`); part.style.flexGrow = Math.max(0, totals[key]); part.title = `${label} ${money(totals[key])}`; bar.append(part); });
  bar.setAttribute('aria-label', '资产构成比例'); panel.append(bar);
  const legend = el('div', null, 'asset-legend');
  Object.entries(labels).forEach(([key, label], index) => legend.append(el('span', `${label} ${total ? (Math.max(0, totals[key]) / total * 100).toFixed(1) : '0'}%`, `legend-${index}`))); panel.append(legend);

}
const message = el('p', '', 'journey-feedback'); message.setAttribute('role', 'status'); panel.insertAdjacentElement('afterend', message);
async function refresh() {
  if (busy) return; const current = ++revision;
  try { const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' }); if (!response?.ok) throw new Error(response?.error || '无法读取成长记录'); if (current !== revision) return; state = response.state; render(); message.textContent = ''; }
  catch (error) { if (current === revision) message.textContent = error.message; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState) refresh(); });
window.addEventListener('focus', refresh); window.addEventListener('demoUpdate', refresh); refresh();
