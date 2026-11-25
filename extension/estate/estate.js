import { assetOverview } from '../core/overview.js';
import { ESTATE_DAILY_LIMIT, ESTATE_LEVELS, estatePurchasePrice } from '../core/estate.js';
import { walletBalance } from '../core/shop.js';
import { estateLandmark } from '../core/journey.js';
const $ = id => document.getElementById(id);
const money = n => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let state, busy = false, revision = 0, confirming = false;
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function buildingPhoto(level) {
  const photo = element('img', 'estate-photo', '');
  photo.src = `photos/level-${level}.jpg`;
  photo.alt = '';
  photo.loading = 'lazy';
  return photo;
}
function render() {
  const estates = state.estates || [];
  const price = estatePurchasePrice(estates.length);
  const balance = walletBalance(state);
  $('balance').textContent = money(assetOverview(state).estates);
  $('slots').textContent = `${estates.length} 块`;
  $('nextPrice').textContent = money(price);
  $('income').textContent = money(estates.reduce((sum, row) => sum + row.income, 0));
  $('spent').textContent = money(state.estateSpent);
  $('owned').replaceChildren(); $('discoveries').replaceChildren();
  if (!estates.length) $('owned').append(element('p', 'estate-empty', '暂无地产。可在下方收购地契。'));
  for (const estate of estates) {
    const level = ESTATE_LEVELS[estate.level - 1], next = ESTATE_LEVELS[estate.level];
    const landmark = estateLandmark(estate);
    const card = element('article', 'product', '');
    const art = element('div', 'product-art estate-art', '');
    art.append(buildingPhoto(estate.level), element('span', 'product-level', `Lv.${estate.level} · ${level.name}`));
    const body = element('div', 'product-body', '');
    body.append(element('h3', 'estate-host', estate.host), element('p', 'description', `基础浏览收益额外 +${Math.round(level.coefficient * 100)}%`));
    const today = estate.lastDay === state.dayKey ? estate.dailyVisits : 0;
    body.append(element('p', 'estate-progress', `今日经营 ${today} / ${ESTATE_DAILY_LIMIT} · 累计收入 ${money(estate.income)}`));
    body.append(element('p', 'estate-progress', next ? `经营 ${Math.min(estate.visits, next.visits)} / ${next.visits} 次 · 活跃 ${Math.min(estate.days, next.days)} / ${next.days} 天` : `累计经营 ${estate.visits} 次 · 活跃 ${estate.days} 天`));
    if (next) {
      const progress = document.createElement('progress'); progress.max = 1;
      progress.value = Math.min(1, estate.visits / next.visits, estate.days / next.days);
      progress.setAttribute('aria-label', `${estate.host}升级进度`); body.append(progress);
      const shortfall = Math.max(0, next.price - walletBalance(state));
      if (shortfall > 0) body.append(element('p', 'estate-progress', `升级资金还差 ${money(shortfall)}`));
    }
    const visit = element('a', 'estate-visit', '访问网站 ↗'); visit.href = estate.url; visit.target = '_blank'; visit.rel = 'noopener noreferrer'; body.append(visit);
    body.append(action(next ? `升级${landmark.next.name} · ${money(next.price)}` : '已达到最高等级', !next || busy || walletBalance(state) < next.price || estate.visits < next.visits || estate.days < next.days, 'UPGRADE_ESTATE', estate.host));
    card.append(art, body); $('owned').append(card);
  }
  const available = (state.estateDiscoveries || []).filter(row => !estates.some(estate => estate.host === row.host));
  if (!available.length) $('discoveries').append(element('p', 'estate-empty', '有效浏览后可发现新的地契。'));
  for (const row of available) {
    const card = element('article', 'task-card', '');
    card.append(element('h3', 'estate-host', row.host), element('p', '', '从小摊位开始 · 每次合格经营获得基础收益的 20%'));
    card.append(action(balance < price ? `资金还差 ${money(price - balance)}` : `收购地契 · ${money(price)}`, busy || balance < price, 'BUY_ESTATE', row.host));
    $('discoveries').append(card);
  }
}
function action(label, disabled, type, host) {
  const button = element('button', 'buy', label); button.type = 'button'; button.disabled = disabled;
  button.addEventListener('click', () => transact(type, host)); return button;
}
async function refresh() {
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    state = response.state; render();
    if ($('status').textContent === '正在读取账本…') $('status').textContent = '';
  } catch (error) { $('status').textContent = `${error.message}，请重新加载扩展后再试。`; }
}
async function transact(type, host) {
  if (busy || confirming) return;
  const estate = (state.estates || []).find(row => row.host === host);
  const price = type === 'BUY_ESTATE' ? estatePurchasePrice(state.estates?.length || 0) : ESTATE_LEVELS[estate?.level]?.price;
  confirming = true;
  const accepted = await confirmPurchase(type === 'BUY_ESTATE' ? `花费 ${money(price)} 收购 ${host} 的地契？` : `花费 ${money(price)} 升级 ${host}？费用将从可用余额扣除。`);
  confirming = false;
  if (!accepted) return;
  busy = true; ++revision; render();
  try {
    const response = await chrome.runtime.sendMessage({ type, host, price });
    if (!response?.ok) throw new Error(response?.error || '操作失败');
    state = response.state;
    $('status').textContent = type === 'BUY_ESTATE' ? `${host} 地契已购入，下一次合格浏览即可经营。` : `${host} 升级成功。`;
  } catch (error) { $('status').textContent = error.message; }
  finally { busy = false; await refresh(); }
}
function confirmPurchase(message) {
  $('purchaseMessage').textContent = message;
  return new Promise(resolve => {
    const finish = accepted => { $('purchaseDialog').close(); resolve(accepted); };
    $('confirmPurchase').onclick = () => finish(true);
    $('cancelPurchase').onclick = () => finish(false);
    $('purchaseDialog').oncancel = event => { event.preventDefault(); finish(false); };
    $('purchaseDialog').showModal();
  });
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState && !busy) refresh(); });
window.addEventListener('demoUpdate', refresh);
refresh();
