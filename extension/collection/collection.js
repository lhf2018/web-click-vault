import { collectionMarket, marketQuote } from '../core/market-pricing.js';
import { COLLECTION_TYPES, collectibleValue, explorationLevel, collectiblePrice, collectibleIdentity } from '../core/collectibles.js';
const $ = id => document.getElementById(id);
const money = n => `¥${Number(n).toFixed(2)}`;
let state, revision = 0, busy = false;
function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
function collectibleArt(item, type) {
  const identity = collectibleIdentity(item);
  const quality = !Number.isFinite(item.qualityPercent) ? 'classic' : item.qualityPercent >= 8 ? 'pristine' : item.qualityPercent <= -8 ? 'worn' : 'fine';
  const art = el('div', null, `souvenir-art art-${item.type} quality-${quality} motif-${identity.motif}`);
  art.style.setProperty('--souvenir-color', /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#39785c');
  const object = el('div', null, 'artifact-object');
  const mark = identity.mark;
  object.append(el('span', null, 'artifact-detail'), el('b', item.type === 'chip' ? '{ }' : mark, 'artifact-mark'), el('span', item.type === 'bookmark' ? item.title : item.host || identity.series, 'artifact-inscription'));
  art.append(el('span', `${identity.finish} / ${identity.edition}`, 'exhibit-number'), object,
    el('span', type.name, 'exhibit-caption'), el('span', quality === 'pristine' ? '✦ 珍藏品相' : quality === 'worn' ? '岁月留痕' : quality === 'classic' ? '经典藏品' : '保存良好', 'condition-tag'));
  return art;
}
function render() {
  const items = state.collectibles || [];
  const currentMarket = collectionMarket(state);
  $('value').textContent = money(items.filter(item => item.soldAt == null).reduce((sum, item) => sum + marketQuote(item, currentMarket), 0));
  $('discovered').textContent = items.length;
  $('owned').textContent = items.filter(i => i.soldAt == null).length;
  $('sales').textContent = money(items.filter(i => i.soldAt != null).reduce((sum, i) => sum + (i.salePrice ?? i.value), 0));
  $('marketEvent').textContent = currentMarket.event.name;
  $('marketDetail').textContent = currentMarket.event.detail;
  $('marketIndex').textContent = `市场指数 ${currentMarket.index}`;
  $('commissionSummary').textContent = `收购 ${COLLECTION_TYPES[currentMarket.featured].name} · 市价加 10% · 剩余 ${currentMarket.remaining} / 2 件`;
  $('marketWeek').textContent = `${currentMarket.week} 当周 · 周一更新`;
  $('level').textContent = `探索等级 Lv.${explorationLevel(state)}`;
  $('priceRange').textContent = `新藏品初始估值 ¥${collectiblePrice('badge', explorationLevel(state), -15).toFixed(2)}–¥${collectiblePrice('chip', explorationLevel(state), 15).toFixed(2)} · 持有后按独立行情浮动`;
  $('wall').replaceChildren();
  const query = ($('siteSearch').value || '').trim().toLowerCase();
  const shown = items.filter(i => ($('filter').value === 'all' || ($('filter').value === 'sold' ? i.soldAt != null : i.soldAt == null)) && `${i.host} ${i.siteName || ''} ${i.title} ${i.collectibleName || ''}`.toLowerCase().includes(query));
  if (!shown.length) $('wall').append(el('p', items.length ? '这个展柜暂时没有藏品，试试其他筛选。' : '奇物需要一点缘分。可见浏览至少 30 秒后，每次有效结算有 3% 概率发现，首次也不保证获得。', 'empty'));
  for (const item of shown) {
    const type = COLLECTION_TYPES[item.type];
    const identity = collectibleIdentity(item);
    const market = collectionMarket(state), quote = marketQuote(item, market);
    const card = el('article', null, 'souvenir' + (item.soldAt != null ? ' sold' : ''));
    const art = collectibleArt(item, type);
    const body = el('div', null, 'souvenir-body');
    body.append(el('span', `${type.rarity} · ${type.name}`, 'rarity'), el('h3', identity.name), el('p', `${identity.series} · #${identity.edition}`), el('p', `发现于 ${new Date(item.foundAt).toLocaleString('zh-CN')}`));
    if (item.collectibleName) body.append(el('p', item.title, 'source-title'));
    const sold = item.soldAt != null, displayedPrice = sold ? item.salePrice ?? item.value : quote;
    body.append(el('p', `发现时估值 ${money(item.value)}${item.foundLevel ? ` · Lv.${item.foundLevel}` : ''}`));
    body.append(el('p', `${sold ? '成交价格' : '当前市价'} ${money(displayedPrice)}`, 'price'));
    const change = Math.round((displayedPrice - item.value) * 100) / 100;
    body.append(el('p', `${sold ? '成交' : '较发现时'} ${change >= 0 ? '+' : '−'}${money(Math.abs(change))}（${item.value ? (change / item.value * 100).toFixed(1) : '0.0'}%）`, change >= 0 ? 'price-change positive' : 'price-change negative'));
    if (!sold) {
      const trends = el('details', null, 'item-trends');
      trends.append(el('summary', '近六周价格'));
      const chart = el('div', null, 'item-chart');
      for (const period of market.history) {
        const price = marketQuote(item, period);
        const column = el('div', null, 'item-chart-column');
        const bar = el('span', money(price), 'item-chart-bar');
        bar.style.height = `${Math.max(12, price / item.value * 55)}px`;
        column.append(bar, el('small', period.week.slice(5))); chart.append(column);
      }
      trends.append(chart); body.append(trends);
    }
    if (Number.isFinite(item.qualityPercent)) body.append(el('p', `品相修正 ${item.qualityPercent >= 0 ? '+' : ''}${item.qualityPercent}%`));
    try { const url = new URL(item.source); if (/^https?:$/.test(url.protocol)) { const a = el('a', '重访来源网页 ↗'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a); } } catch {}
    if (!sold && item.type === market.featured) {
      const commissionPrice = marketQuote(item, market, 'commission');
      const commission = el('button', `委托收购 · ${money(commissionPrice)}`, 'buy commission-buy');
      commission.disabled = busy || !market.remaining;
      commission.addEventListener('click', () => sell(item, market, 'commission', commissionPrice));
      body.append(commission, el('p', `市价加 10% · 本周剩余 ${market.remaining} 件`, 'commission-hint'));
    }
    const button = el('button', `${sold ? '已出售' : '按行情出售'} · ${money(displayedPrice)}`, 'buy');
    button.disabled = busy || item.soldAt != null;
    button.addEventListener('click', () => sell(item, market, 'market', quote));
    body.append(button); card.append(art, body); $('wall').append(card);
  }
}
async function sell(item, market, mode, price) {
  if (busy || item.soldAt != null || !window.confirm(`${mode === 'commission' ? '交付委托' : '出售'}「${item.title}」？获得 ${money(price)}${mode === 'commission' ? '，占用本周 1 件委托额度' : ''}，发现记录保留。`)) return;
  busy = true; ++revision; render();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'MARKET_SELL', id: item.id, mode, week: market.week, price });
    if (!response?.ok) throw new Error(response?.error || '出售失败，请重新加载扩展');
    ++revision; state = response.state; $('status').textContent = `已出售，${money(price)} 已转为可用现金。`;
  } catch (error) { $('status').textContent = error.message; }
  finally { busy = false; await refresh(); }
}
async function refresh() {
  if (busy) return;
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取收藏，请重新加载扩展');
    if (current !== revision) return;
    state = response.state; render();
    $('status').textContent = (state.collectibles || []).length >= 600 ? '历史发现已达 600 件，掉落已暂停。' : '自动发现已开启 · 每日最多 3 件 · 所有藏品保存在本机';
  } catch (error) { $('status').textContent = error.message; }
}
$('filter').addEventListener('change', () => { if (state) render(); });
$('siteSearch').addEventListener('input', () => { if (state) render(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState) refresh(); });
window.addEventListener('demoUpdate', refresh);
window.addEventListener('focus', refresh);
refresh();
