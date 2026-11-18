import { COMPANY_TYPES, companyPrice, companyLevel, companyType, COMPANY_STAFF, COMPANY_FACILITIES } from '../core/company.js';
import { walletBalance } from '../core/shop.js';
import { companyBrief } from '../core/journey.js';
const $ = id => document.getElementById(id);
const money = n => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let buildingReady = false;
let state, busy = false, revision = 0, backendReady = false;
const reloadHint = '公司后台尚未更新。请到 chrome://extensions 重新加载「网页资产计」，再关闭并重新打开公司页面；不要卸载扩展。';
function feedback(message) {
  $('status').textContent = message;
  $('createFeedback').textContent = message;
}
async function request(message) {
  let timer;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('后台响应超时，请重新打开公司页面确认操作结果后再重试。')), 12000); }),
    ]);
  } finally { clearTimeout(timer); }
}
function el(tag, cls, text) { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; }
function render() {
  const companies = state.companies || [];
  $('balance').textContent = money(walletBalance(state));
  $('count').textContent = companies.length;
  $('completed').textContent = companies.reduce((sum, company) => sum + company.completed, 0);
  $('income').textContent = money(companies.reduce((sum, company) => sum + company.income - (company.losses || 0), 0));
  $('spent').textContent = `创办 ${money(state.companySpent)} · 招聘与建设 ${money(state.companyBuildSpent)} · 经营亏损 ${money(state.companyLosses)}`;
  $('companies').replaceChildren();
  if (!companies.length) $('companies').append(el('p', 'company-empty', '第一家公司，等待你起一个名字。创办后即可自动接单。'));
  for (const company of companies) {
    const type = companyType(company), order = company.order;
    const brief = companyBrief(company), projects = company.history || [];
    const card = el('article', 'product', '');
    const art = el('div', 'product-art', ''); art.append(el('span', 'symbol', type.symbol), el('span', 'product-level', `Lv.${companyLevel(company)} · 自动经营中`));
    const body = el('div', 'product-body', '');
    body.append(el('span', 'category-label', `${type.name} · ${brief.rank} · 专长：${brief.specialty}`), el('h3', 'company-name', company.name),
      el('p', 'company-meta', `已交付 ${company.completed} 单 · 累计净收益 ${money(company.income - (company.losses || 0))}`),
      el('p', 'company-meta', `总部：${company.headquarters || '线上办公室'}`),
      el('h4', 'company-order', order.title),
      el('span', 'company-client', `委托方 · ${brief.client}`), el('p', 'company-story', brief.story),
      el('p', 'company-meta', `${order.seen.length} / ${order.target} ${type.unit} · 交付净收益 ${money(order.reward)}${order.mode === 'risk' ? ' / 10% 概率亏损 ¥20' : ''}`));
    const progress = document.createElement('progress'); progress.max = order.target; progress.value = order.seen.length;
    progress.setAttribute('aria-label', `${company.name}当前订单进度`); body.append(progress);
    if (order.gross != null) body.append(el('p', 'company-meta', `合同 ${money(order.gross)} − 制作 ${money(order.cost)} − 薪酬 ${money(order.salary)}`));
    body.append(el('p', 'special-effect', companyLevel(company) < 5 ? `再完成 ${5 - company.completed % 5} 单，自动升至 Lv.${companyLevel(company) + 1}` : '已达最高等级 · 持续自动接单'));
    renderManagement(body, company);
    const history = el('details', 'company-history', ''); history.append(el('summary', '', `作品档案 · 累计 ${company.completed || 0} 次交付 · 最近 ${projects.length} 项`));
    const list = document.createElement('ul');
    if (!projects.length) list.append(el('li', '', '首份作品正在酝酿。'));
    for (const project of projects) {
      const entry = el('li', '', ''), story = companyBrief(company, project);
      entry.append(el('strong', 'company-work-title', project.title),
        el('p', 'company-meta', `${project.amount < 0 ? '−' : '+'}${money(Math.abs(project.amount))}${project.outcome ? ` · ${project.outcome}` : ''} · ${new Date(project.ts).toLocaleString('zh-CN')}`),
        el('span', 'company-client', `故事委托方 · ${story.client}`), el('p', 'company-story', story.story));
      list.append(entry);
    }
    history.append(list); body.append(history); card.append(art, body); $('companies').append(card);
  }
  const selected = $('headquarters').value;
  $('headquarters').replaceChildren(new Option('线上办公室（免费）', ''));
  for (const estate of state.estates || []) $('headquarters').append(new Option(estate.host, estate.host));
  if ((state.estates || []).some(estate => estate.host === selected)) $('headquarters').value = selected;
  const price = companyPrice(state);
  $('createButton').textContent = busy ? '正在创办…' : `创办公司 · ${money(price)}`;
  $('createButton').disabled = busy || walletBalance(state) < price;
  $('businessHint').textContent = `${COMPANY_TYPES.find(type => type.id === $('companyType').value).description}${walletBalance(state) < price ? ` 余额还差 ${money(price - walletBalance(state))}。` : ''}`;
}
function renderManagement(body, company) {
  const panel = el('div', 'management', '');
  const modes = { safe: '稳健经营', premium: '精品项目', risk: '风险订单' };
  panel.append(el('h4', '', '经营策略'));
  const controls = el('div', 'strategy-controls', '');
  for (const [value, label] of Object.entries(modes)) {
    const button = el('button', 'manage-button', label);
    button.type = 'button'; button.disabled = busy || !buildingReady;
    button.setAttribute('aria-pressed', String((company.strategy || 'safe') === value));
    button.addEventListener('click', () => manage(company, 'strategy', value)); controls.append(button);
  }
  panel.append(controls, el('p', 'action-hint', '下单生效 · 精品目标 +2、报酬 ×1.6、制作费 ¥15；风险报酬 ×1.5、制作费 ¥20，10% 概率净亏 ¥20。余额不足自动普通结算，连续亏损两单切回稳健。'));
  panel.append(el('h4', '', '团队 · 1 个员工位'));
  if (company.staff) {
    panel.append(el('p', 'company-meta', COMPANY_STAFF[company.staff].description));
    const button = el('button', 'manage-button', '解聘 · 下单生效，无额外费用');
    button.type = 'button'; button.disabled = busy || !buildingReady;
    button.addEventListener('click', () => manage(company, 'dismiss')); panel.append(button);
  } else {
    for (const [value, spec] of Object.entries(COMPANY_STAFF)) {
      const name = value === 'specialist' ? company.type === 'publisher' ? '编辑' : '研究员' : spec.name;
      const button = el('button', 'manage-button', '招聘' + name + ' · ' + money(spec.price));
      button.type = 'button'; button.disabled = busy || !buildingReady || walletBalance(state) < spec.price;
      button.addEventListener('click', () => manage(company, 'staff', value));
      panel.append(button, el('p', 'action-hint', spec.description + '，下单生效；仅交付时支付薪酬。'));
    }
  }
  panel.append(el('h4', '', '公司建设'));
  for (const [value, spec] of Object.entries(COMPANY_FACILITIES)) {
    const owned = company.facilities?.includes(value);
    const button = el('button', 'manage-button', spec.name + (owned ? ' · 已建成 ✓' : ' · ' + money(spec.price)));
    button.type = 'button'; button.disabled = busy || !buildingReady || owned || walletBalance(state) < spec.price;
    button.addEventListener('click', () => manage(company, 'facility', value));
    panel.append(button, el('p', 'action-hint', spec.description + '，下单生效。'));
  }
  if (!buildingReady) panel.append(el('p', 'action-hint', '重新加载扩展后可招聘与建设。'));
  body.append(panel);
}
async function manage(company, action, value) {
  if (busy) return;
  if (action === 'strategy' && value === 'risk' && !window.confirm('开启风险订单？每单有 10% 概率净亏损 ¥20，连续亏损两单自动切回稳健。下单生效。')) return;
  busy = true; ++revision; render();
  try {
    const response = await request({ type: 'MANAGE_COMPANY', id: company.id, action, value });
    if (!response?.ok) throw new Error(response?.error || '操作失败，请重新加载扩展');
    state = response.state;
    $('status').textContent = company.name + '已更新，当前订单保持原约定，下单生效。';
  } catch (error) { $('status').textContent = error.message; }
  finally { busy = false; await refresh(); }
}
async function refresh() {
  const current = ++revision;
  try {
    const response = await request({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    const previous = state?.companies || [];
    const delivered = (response.state.companies || []).filter(company => {
      const before = previous.find(row => row.id === company.id);
      return before && company.completed > before.completed;
    });
    backendReady = response.features?.companies === true;
    buildingReady = response.features?.companyManagement === true;
    state = response.state; render();
    if (!backendReady) { feedback(reloadHint); return; }
    if (delivered.length) $('status').textContent = `${delivered.map(company => company.name).join('、')}已自动交付项目，经营结果已结算，下一笔订单已接入。`;
    if ($('status').textContent === '正在读取账本…') $('status').textContent = '订单自动运转，收入自动入账。正常浏览，就是今天的经营。';
  } catch (error) { feedback(`${error.message}，请重新加载扩展后再试。`); }
}
$('createForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  if (!state) { feedback('账本尚未读取完成，请重新打开公司页面。'); return; }
  if (!backendReady) { feedback(reloadHint); return; }
  const name = $('companyName').value, companyType = $('companyType').value, headquarters = $('headquarters').value;
  if (!name.trim() || name.trim().length > 24) { feedback('请先填写 1–24 个字符的公司名称。'); $('companyName').focus(); return; }
  busy = true; ++revision;
  try {
    render(); feedback('正在创办公司，请稍候…');
    const response = await request({ type: 'CREATE_COMPANY', name, companyType, headquarters });
    if (!response?.ok) throw new Error(response?.error || '创办失败');
    if (!response.state?.companies?.some(company => company.name === name.trim())) throw new Error(reloadHint);
    state = response.state; $('companyName').value = '';
    feedback(`${name.trim()}已创办，第一笔订单已自动接入。`);
  } catch (error) { feedback(error.message === 'unknown_message' ? reloadHint : error.message); }
  finally { busy = false; await refresh(); }
});
$('companyType').addEventListener('change', () => { if (state) render(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState && !busy) refresh(); });
window.addEventListener('demoUpdate', refresh);
refresh();
