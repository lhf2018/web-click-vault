import { exchangeAssets } from '../core/exchange.js';
import { investmentCatalog, investmentValue, investmentQuote, investmentPosition, MAX_INVESTMENT_HOLDINGS, MAX_ORDER_UNITS } from '../core/investments.js';
import { SHOP_ITEMS, itemLevel, itemPrice, walletBalance } from '../core/shop.js';
import { estatePurchasePrice } from '../core/estate.js';
import { COMPANY_FACILITIES } from '../core/company.js';
const $ = id => document.getElementById(id);
const page = document.querySelector('[data-finance]').dataset.finance;
const money = n => `¥${Number(n || 0).toFixed(2)}`;
let state, busy = false, revision = 0;
const orderDrafts = new Map();
function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
function card(title, text, badge) {
  const n = el('article', null, 'finance-card');
  if (badge) n.append(el('span', badge, 'eyebrow'));
  n.append(el('h3', title), el('p', text)); return n;
}
function button(text, message, confirmation, disabled = false, secondary = false) {
  const n = el('button', text, 'buy' + (secondary ? ' secondary' : ''));
  n.type = 'button'; n.disabled = busy || disabled;
  n.addEventListener('click', () => transact(typeof message === 'function' ? message() : message, typeof confirmation === 'function' ? confirmation() : confirmation)); return n;
}
async function transact(message, confirmation) {
  if (busy || !message || !window.confirm(confirmation)) return;
  busy = true; ++revision; render();
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error === 'unknown_message' ? '后台尚未更新，请重新加载扩展' : response?.error || '操作失败');
    ++revision; orderDrafts.clear(); state = response.state; $('status').textContent = '操作完成，账本已更新。';
  } catch (error) { $('status').textContent = error.message; }
  finally { busy = false; render(); }
}
function render() {
  $('balance').textContent = money(page === 'investments' ? investmentValue(state) : exchangeAssets(state).reduce((sum, asset) => sum + asset.price, 0));
  $('cards').replaceChildren(); $('activity').replaceChildren(); $('highlight').replaceChildren(); $('highlight').hidden = true;
  if (page === 'exchange') renderExchange();
  if (page === 'investments') renderInvestments();
}
function renderExchange() {
  const assets = exchangeAssets(state);
  $('metricLabel').textContent = '可回收资产'; $('metric').textContent = `${assets.length} 项`; $('metricHint').textContent = '按可核实投入的 70% 回收';
  $('sectionTitle').textContent = '出售与置换'; $('activityTitle').textContent = '最近回收记录';
  if (!assets.length) $('cards').append(el('p', '暂无可回收资产。员工与公司主体不出售。', 'empty'));
  for (const asset of assets) {
    const n = card(asset.name, asset.detail, asset.kind === 'equipment' ? '装备' : asset.kind === 'estate' ? '地产' : '公司设施');
    n.append(el('strong', money(asset.price), 'quote'), el('p', `可核实投入 ${money(asset.cost)} · 折损 ${money(asset.cost - asset.price)}`),
      button(`出售 · ${money(asset.price)}`, { type: 'SELL_ASSET', kind: asset.kind, id: asset.id, price: asset.price }, `出售 ${asset.name}，收到 ${money(asset.price)}？${asset.detail}。总资产将减少折损金额。`));
    const targets = asset.kind === 'equipment' ? SHOP_ITEMS.filter(i => i.id !== asset.id && itemLevel(state, i) < i.maxLevel).map(i => ({ id: i.id, name: `${i.name} Lv.${itemLevel(state, i) + 1}`, price: itemPrice(i, itemLevel(state, i)) }))
      : asset.kind === 'estate' ? (state.estateDiscoveries || []).filter(d => !state.estates.some(e => e.host === d.host)).map(d => ({ id: d.host, name: d.host, price: estatePurchasePrice(state.estates.length - 1) }))
        : Object.entries(COMPANY_FACILITIES).filter(([id]) => id !== asset.facilityId && !state.companies.find(c => c.id === asset.companyId).facilities.includes(id)).map(([id, f]) => ({ id, name: f.name, price: f.price }));
    if (targets.length) {
      const select = el('select'); select.setAttribute('aria-label', `${asset.name}的置换目标`);
      for (const target of targets) { const option = el('option', `${target.name} · ${money(target.price)}`); option.value = target.id; select.append(option); }
      const hint = el('p');
      const update = () => { const target = targets.find(t => t.id === select.value); hint.textContent = `卖旧抵 ${money(asset.price)}，${target.price >= asset.price ? `补 ${money(target.price - asset.price)}` : `余款入账 ${money(asset.price - target.price)}`}。目标仍需满足解锁条件。`; };
      select.addEventListener('change', update); n.append(select, hint); update();
      n.append(button('确认置换', () => ({ type: 'TRADE_ASSET', kind: asset.kind, id: asset.id, target: select.value, price: asset.price, targetPrice: targets.find(t => t.id === select.value).price }), () => `卖出 ${asset.name} 并购入 ${targets.find(t => t.id === select.value).name}？${hint.textContent} 购买失败将保留原资产。`, false, true));
    }
    $('cards').append(n);
  }
  const rows = (state.recentEntries || []).filter(e => e.kind === 'asset_sale').slice(0, 10);
  if (!rows.length) $('activity').append(el('p', '暂无回收记录。', 'empty'));
  for (const row of rows) { const n = card(row.host, new Date(row.ts).toLocaleString('zh-CN')); n.append(el('strong', `+${money(row.amount)}`, 'quote')); $('activity').append(n); }
}
function sharePicker(label, key, max) {
  const root = el('div', null, 'share-picker'), field = el('label', label + '份数');
  const input = el('input'); input.type = 'number'; input.min = '1'; input.step = '1'; input.max = String(Math.max(1, max));
  input.value = orderDrafts.get(key) ?? '1'; input.setAttribute('aria-label', label + '份数');
  input.addEventListener('input', () => orderDrafts.set(key, input.value)); field.append(input); root.append(field);
  const picker = { root, input }, quick = el('div', null, 'share-shortcuts');
  for (const units of [10, 100, 1000, 'max']) {
    const b = el('button', units === 'max' ? '最大' : `${units} 份`); b.type = 'button'; b.disabled = busy || max < 1;
    b.addEventListener('click', () => { input.value = String(units === 'max' ? max : Math.min(units, max)); orderDrafts.set(key, input.value); picker.changed?.(); }); quick.append(b);
  }
  root.append(quick); return picker;
}
function renderInvestments() {
  const now = Date.now(), investments = state.investments || [], catalog = investmentCatalog(now);
  const signed = n => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
  $('metricLabel').textContent = '累计投资'; $('metric').textContent = money(state.investmentSpent); $('metricHint').textContent = '';
  $('sectionTitle').textContent = '独立项目行情'; $('activityTitle').textContent = '我的持仓与交易';
  $('highlight').hidden = false;
  $('highlight').append(el('h2', '按份额投资 · 支持加仓与部分卖出'), el('p', `20 个常驻项目，4 个当期项目，含 4 个大型项目。下次上新：${new Date(catalog.nextRefresh).toLocaleDateString('zh-CN')}。过期项目停止买入，持仓继续计价并可随时卖出。`), el('p', '买入填写整数份数，可追加同一持仓，最多持有 10 个不同项目。行情每小时独立更新；卖出收取 1% 手续费，成交以当时行情为准。'));
  for (const spec of catalog.projects) {
    const q = investmentQuote(spec.id, now);
    const n = card(spec.name, spec.description, `${spec.launchedAt ? '本期新项目 · ' : '常驻 · '}${spec.scale ? spec.scale + ' · ' : ''}${spec.risk}`);
    n.append(el('strong', `${money(q.price)} / 份`, 'quote'), el('p', `24 小时 ${q.change >= 0 ? '+' : ''}${q.change}% · ${new Date(q.hour * 3600000).toLocaleString('zh-CN')} 更新`, q.change >= 0 ? 'price-up' : 'price-down'));
    const chart = el('div', null, 'market-history'); chart.setAttribute('aria-label', `${spec.name}近七日价格`);
    const chartMax = Math.max(...q.history.map(h => h.price));
    for (const h of q.history) {
      const col = el('div', null, 'market-column'), bar = el('span', h.price.toFixed(2), 'market-bar');
      bar.style.height = `${h.price / chartMax * 70}px`;
      col.append(bar, el('small', new Date(h.ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }))); chart.append(col);
    }
    n.append(chart, el('p', `需求 ${q.demand} · 营收 ${q.revenue} · 成本 ${q.cost} · 情绪 ${q.sentiment}`));
    const holding = investments.find(p => p.projectId === spec.id && p.status === 'active');
    const capacity = MAX_ORDER_UNITS - (holding ? investmentPosition(holding, now).units : 0);
    const max = Math.max(0, Math.min(Math.floor(Math.round(walletBalance(state) * 100) / Math.round(q.price * 100)), Math.floor(capacity)));
    const picker = sharePicker(`买入 ${spec.name}`, `buy:${spec.id}`, max), estimate = el('p');
    const blocked = !holding && investments.filter(p => p.status === 'active').length >= MAX_INVESTMENT_HOLDINGS;
    const buy = button(holding ? '追加买入' : '确认买入', () => ({ type: 'INVEST_PROJECT', projectId: spec.id, units: Number(picker.input.value) }),
      () => `按成交时行情${holding ? '追加' : '买入'}${spec.name} ${picker.input.value} 份？当前预计支付 ${money(Number(picker.input.value) * q.price)}。`);
    const update = () => {
      const units = Number(picker.input.value), valid = Number.isSafeInteger(units) && units >= 1 && units <= max;
      estimate.textContent = `预计支付 ${money(Number.isFinite(units) && units > 0 ? units * q.price : 0)} · 最多可买 ${max.toLocaleString('zh-CN')} 份${blocked ? ' · 已达 10 个持仓上限' : ''}`;
      buy.disabled = busy || blocked || !valid;
    };
    picker.input.addEventListener('input', update); picker.changed = update;
    n.append(picker.root, estimate, buy); update();
    $('cards').append(n);
  }
  if (!investments.length) $('activity').append(el('p', '暂无持仓。选择份数买入，支持追加投资，最多持有 10 个不同项目。', 'empty'));
  for (const project of investments) {
    const active = project.status === 'active';
    const n = card(project.name, `投入 ${money(project.principal)} · ${new Date(project.startedAt).toLocaleString('zh-CN')}`, active ? '持有中' : project.status === 'completed' ? '历史已完成' : '已卖出');
    if (active) {
      const p = investmentPosition(project, now);
      n.append(el('strong', money(p.value), 'quote'), el('p', `浮动盈亏 ${signed(p.profit)}（${(p.profit / project.principal * 100).toFixed(2)}%）`, p.profit >= 0 ? 'price-up' : 'price-down'),
        el('p', `${p.units.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 份 · 平均成本 ${money(p.entryPrice)} / 份`), el('p', `已实现盈亏 ${signed(project.realizedProfit || 0)}`));
      const picker = sharePicker(`卖出 ${project.name}`, `sell:${project.id}`, Math.floor(p.units)), estimate = el('p');
      const sell = button('按份数卖出', () => ({ type: 'EXIT_PROJECT', id: project.id, units: Number(picker.input.value) }),
        () => `卖出${project.name} ${picker.input.value} 份？按成交时市价结算，扣除 1% 手续费。`, false, true);
      const update = () => {
        const units = Number(picker.input.value), valid = Number.isSafeInteger(units) && units >= 1 && units <= Math.floor(p.units);
        const gross = Math.round(units * p.price * 100) / 100;
        estimate.textContent = `预计到账 ${money(valid ? Math.round(gross * 99) / 100 : 0)} · 已扣 1% 手续费`;
        sell.disabled = busy || !valid;
      };
      picker.input.addEventListener('input', update); picker.changed = update;
      n.append(picker.root, estimate, sell, button(`全部卖出 · 预计 ${money(p.proceeds)}`, { type: 'EXIT_PROJECT', id: project.id }, `全部卖出${project.name}的 ${p.units.toFixed(4)} 份？预计到账 ${money(p.proceeds)}，已扣 1% 手续费。`, false, true)); update();
    } else n.append(el('p', project.status === 'completed' ? `历史返本 ${money(project.returned)} · 利润 ${money(project.profit)}` : `到账 ${money(project.returned)} · 已实现盈亏 ${signed(project.realizedProfit ?? project.returned - project.principal)}`));
    $('activity').append(n);
  }
}
async function refresh() {
  if (busy) return;
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    state = response.state; render();
    if ($('status').textContent === '正在读取账本…') $('status').textContent = '金额均为本地虚拟资产。';
  } catch (error) { $('status').textContent = error.message; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState) refresh(); });
window.addEventListener('demoUpdate', refresh); window.addEventListener('focus', refresh);
setInterval(refresh, 60000);
refresh();
