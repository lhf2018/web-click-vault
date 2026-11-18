import { ESTATE_LEVELS, ESTATE_PRICE, ESTATE_SLOTS } from '../core/estate.js';
import { walletBalance } from '../core/shop.js';
import { estateLandmark } from '../core/journey.js';
const $ = id => document.getElementById(id);
const money = n => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let state, busy = false, revision = 0, confirming = false;
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function render() {
  const estates = state.estates || [];
  $('balance').textContent = money(walletBalance(state));
  $('slots').textContent = `${estates.length} / ${ESTATE_SLOTS}`;
  $('income').textContent = money(estates.reduce((sum, row) => sum + row.income, 0));
  $('spent').textContent = money(state.estateSpent);
  $('owned').replaceChildren(); $('discoveries').replaceChildren();
  if (!estates.length) $('owned').append(element('p', 'estate-empty', '街区还空着。从下方挑一个常去的网站，开启你的第一份产业。'));
  for (const estate of estates) {
    const level = ESTATE_LEVELS[estate.level - 1], next = ESTATE_LEVELS[estate.level];
    const landmark = estateLandmark(estate);
    const card = element('article', 'product', '');
    const art = element('div', 'product-art estate-art', ''); art.dataset.level = estate.level;
    art.style.setProperty('--landmark-color', landmark.color);
    const building = element('div', 'landmark-building', '');
    building.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < landmark.level; i++) {
      const floor = element('div', 'landmark-floor', '');
      for (let j = 0; j < 3; j++) floor.append(element('i', '', ''));
      building.append(floor);
    }
    art.append(building, element('span', 'product-level', `Lv.${estate.level} · ${landmark.title}`));
    const body = element('div', 'product-body', '');
    body.append(element('h3', 'estate-host', estate.host), element('p', 'description', `${landmark.title} · 基础收益额外 +${Math.round(level.coefficient * 100)}%`));
    const stages = element('div', 'estate-stages', '');
    for (const step of landmark.milestones) stages.append(element('span', step.reached ? 'reached' : '', `${step.reached ? '●' : '○'} ${step.name}`));
    body.append(stages);
    const today = estate.lastDay === state.dayKey ? estate.dailyVisits : 0;
    body.append(element('p', 'estate-progress', `今日经营 ${today} / 3 · 累计收入 ${money(estate.income)}`));
    body.append(element('p', 'estate-progress', next ? `升级${next.name}：还需 ${landmark.next.visits} 次经营 / ${landmark.next.days} 天` : `总部已建成 · 累计经营 ${estate.visits} 次 / ${estate.days} 天`));
    if (next) {
      const progress = document.createElement('progress'); progress.max = 1;
      progress.value = Math.min(1, estate.visits / next.visits, estate.days / next.days);
      progress.setAttribute('aria-label', `${estate.host}升级进度`); body.append(progress);
    }
    const visit = element('a', 'estate-visit', '访问网站 ↗'); visit.href = estate.url; visit.target = '_blank'; visit.rel = 'noopener noreferrer'; body.append(visit);
    body.append(action(next ? `升级${next.name} · ${money(next.price)}` : '已升至总部', !next || busy || walletBalance(state) < next.price || estate.visits < next.visits || estate.days < next.days, 'UPGRADE_ESTATE', estate.host));
    card.append(art, body); $('owned').append(card);
  }
  const available = (state.estateDiscoveries || []).filter(row => !estates.some(estate => estate.host === row.host));
  if (!available.length) $('discoveries').append(element('p', 'estate-empty', '继续正常浏览，完成有效结算后，会在这里发现可收购的网站。'));
  for (const row of available) {
    const card = element('article', 'task-card', '');
    card.append(element('h3', 'estate-host', row.host), element('p', '', '从小摊位开始 · 每次合格经营获得基础收益的 20%'));
    card.append(action(estates.length >= ESTATE_SLOTS ? '地产位已满' : `收购地契 · ${money(ESTATE_PRICE)}`, busy || estates.length >= ESTATE_SLOTS || walletBalance(state) < ESTATE_PRICE, 'BUY_ESTATE', row.host));
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
    if ($('status').textContent === '正在读取账本…') $('status').textContent = '选择常去的网站，让每一次认真浏览都有新的收获。';
  } catch (error) { $('status').textContent = `${error.message}，请重新加载扩展后再试。`; }
}
async function transact(type, host) {
  if (busy || confirming) return;
  const estate = (state.estates || []).find(row => row.host === host);
  const price = type === 'BUY_ESTATE' ? ESTATE_PRICE : ESTATE_LEVELS[estate?.level]?.price;
  confirming = true;
  const accepted = await confirmPurchase(type === 'BUY_ESTATE' ? `花费 ${money(price)} 收购 ${host}？最多持有 3 块地产，可到资产置换页按折价出售。` : `花费 ${money(price)} 升级 ${host}？费用将从可用余额扣除。`);
  confirming = false;
  if (!accepted) return;
  busy = true; ++revision; render();
  try {
    const response = await chrome.runtime.sendMessage({ type, host });
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
