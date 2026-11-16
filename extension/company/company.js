import { COMPANY_TYPES, companyPrice, companyLevel, companyType } from '../core/company.js';
import { walletBalance } from '../core/shop.js';
const $ = id => document.getElementById(id);
const money = n => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('后台响应超时，请重新打开公司页面确认是否已创办，再重试。')), 12000); }),
    ]);
  } finally { clearTimeout(timer); }
}
function el(tag, cls, text) { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; }
function render() {
  const companies = state.companies || [];
  $('balance').textContent = money(walletBalance(state));
  $('count').textContent = companies.length;
  $('completed').textContent = companies.reduce((sum, company) => sum + company.completed, 0);
  $('income').textContent = money(companies.reduce((sum, company) => sum + company.income, 0));
  $('spent').textContent = `公司累计投入 ${money(state.companySpent)}`;
  $('companies').replaceChildren();
  if (!companies.length) $('companies').append(el('p', 'company-empty', '第一家公司，等待你起一个名字。创办后即可自动接单。'));
  for (const company of companies) {
    const type = companyType(company), order = company.order;
    const card = el('article', 'product', '');
    const art = el('div', 'product-art', ''); art.append(el('span', 'symbol', type.symbol), el('span', 'product-level', `Lv.${companyLevel(company)} · 自动经营中`));
    const body = el('div', 'product-body', '');
    body.append(el('span', 'category-label', type.name), el('h3', 'company-name', company.name),
      el('p', 'company-meta', `已交付 ${company.completed} 单 · 累计收入 ${money(company.income)}`),
      el('p', 'company-meta', `总部：${company.headquarters || '线上办公室'}`),
      el('h4', 'company-order', order.title), el('p', 'company-meta', `${order.seen.length} / ${order.target} ${type.unit} · 完成自动入账 ${money(order.reward)}`));
    const progress = document.createElement('progress'); progress.max = order.target; progress.value = order.seen.length;
    progress.setAttribute('aria-label', `${company.name}当前订单进度`); body.append(progress);
    body.append(el('p', 'special-effect', companyLevel(company) < 5 ? `再完成 ${5 - company.completed % 5} 单，自动升至 Lv.${companyLevel(company) + 1}` : '已达最高等级 · 持续自动接单'));
    const history = el('details', 'company-history', ''); history.append(el('summary', '', `作品履历 · 最近 ${company.history.length} 项`));
    const list = document.createElement('ul');
    if (!company.history.length) list.append(el('li', '', '首份作品正在酝酿。'));
    for (const project of company.history) list.append(el('li', '', `${project.title} · +${money(project.amount)} · ${new Date(project.ts).toLocaleString('zh-CN')}`));
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
    state = response.state; render();
    if (!backendReady) { feedback(reloadHint); return; }
    if (delivered.length) $('status').textContent = `${delivered.map(company => company.name).join('、')}已自动交付项目，收入已入账，下一笔订单已接入。`;
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
