import { achievementBonuses } from '../core/achievements.js';
import { assetOverview } from '../core/overview.js';
import { COMPANY_TYPES, COMPANY_STAGES, companyPrice, companyLevel, companyType, COMPANY_STAFF, COMPANY_TEAM_MILESTONES, companyTeam, companyTeamCapacity, companyStaffRequirement, COMPANY_FACILITIES, COMPANY_EXPANSIONS, expansionType, companyValuations, companyMarketProgress, nextOrder } from '../core/company.js';
import { walletBalance } from '../core/shop.js';
const $ = id => document.getElementById(id);
const money = n => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function showMarketValue(node, value) {
  if (value < 100_000_000) {
    node.textContent = money(value);
  } else {
    const trillion = value >= 1_000_000_000_000;
    const scale = trillion ? 1_000_000_000_000 : 100_000_000;
    node.textContent = `¥${(value / scale).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${trillion ? '万亿' : '亿'}`;
  }
  node.setAttribute('title', money(value));
}
let buildingReady = false, expansionReady = false, teamReady = false;
let state, busy = false, revision = 0, backendReady = false;
const panels = new Map();
const openRecords = new Map();
let operation;
const reloadHint = '公司后台尚未更新。请到 chrome://extensions 重新加载「网页轻度经营」，再关闭并重新打开公司页面；不要卸载扩展。';
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
function companyPanels(company, order) {
  const wrapper = el('div', 'company-panels', '');
  const navigation = el('div', 'company-panel-nav', '');
  navigation.setAttribute('role', 'group');
  navigation.setAttribute('aria-label', `${company.name}管理面板`);
  const sections = [
    ['growth', '发展路线', panel => renderExpansion(panel, company)],
    ['settings', '经营设置', panel => renderManagement(panel, company)],
    ['records', '交付记录', panel => renderHistory(panel, company, order)],
  ].map(([key, label, populate]) => {
    const button = el('button', 'company-panel-button', label);
    button.type = 'button';
    button.id = `company-${company.id}-${key}-button`;
    const panel = el('section', 'company-panel', '');
    panel.id = `company-${company.id}-${key}`;
    panel.setAttribute('aria-labelledby', button.id);
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => {
      panels.set(company.id, panels.get(company.id) === key ? null : key);
      updatePanels();
    });
    populate(panel);
    navigation.append(button);
    return { key, button, panel };
  });
  function updatePanels() {
    for (const { key, button, panel } of sections) {
      const selected = panels.get(company.id) === key;
      button.setAttribute('aria-expanded', String(selected));
      panel.hidden = !selected;
    }
  }
  wrapper.append(navigation, ...sections.map(section => section.panel));
  const status = el('p', 'company-action-status', operation?.id === company.id ? operation.message : '');
  status.setAttribute('role', 'status');
  if (operation?.id === company.id && operation.failed) status.className += ' is-error';
  wrapper.append(status);
  updatePanels();
  return wrapper;
}
function renderHistory(panel, company, order) {
  const projects = company.history || [];
  const total = company.completed + (company.expansion?.completed || 0);
  const current = el('details', 'record-details current-contract', '');
  const currentKey = 'current';
  current.setAttribute('name', `company-${company.id}-records`);
  current.open = openRecords.get(company.id) === currentKey;
  current.addEventListener('toggle', () => rememberRecord(company.id, currentKey, current.open));
  const currentSummary = el('summary', '', '当前委托');
  currentSummary.id = `company-${company.id}-current-contract`;
  current.append(currentSummary,
    el('p', 'company-meta', order.title));
  if (order.gross != null) current.append(el('p', 'company-meta', `合同 ${money(order.gross)} · 制作 ${money(order.cost)} · 薪酬 ${money(order.salary)}`));
  panel.append(el('p', 'history-count', `累计交付 ${total} 单${projects.length && projects.length < total ? ` · 最近 ${projects.length} 单` : ''}`), current);
  if (!projects.length) panel.append(el('p', 'history-empty', '暂无交付记录。'));
  for (const [index, project] of projects.entries()) {
    const entry = el('details', 'record-details', '');
    const key = `${project.ts}:${project.business || 'main'}:${project.title}:${total - index}`;
    entry.setAttribute('name', `company-${company.id}-records`);
    entry.open = openRecords.get(company.id) === key;
    entry.addEventListener('toggle', () => rememberRecord(company.id, key, entry.open));
    const summary = el('summary', 'record-summary', '');
    summary.id = `company-${company.id}-delivery-${total - index}`;
    const identity = el('span', 'record-identity', '');
    identity.append(el('strong', 'company-work-title', project.title), el('small', '', new Date(project.ts).toLocaleDateString('zh-CN')));
    const value = el('strong', project.amount < 0 ? 'record-value is-loss' : 'record-value', `${project.amount < 0 ? '−' : '+'}${money(Math.abs(project.amount))}`);
    summary.append(identity, value);
    const body = el('div', 'record-body', '');
    body.append(el('p', 'company-meta', project.business === 'expansion' ? '第二业务' : '主营业务'));
    if (project.outcome) body.append(el('p', 'company-meta', project.outcome));
    if (project.salary > 0) body.append(el('p', 'company-meta', `团队薪酬 ${money(project.salary)}`));
    if (project.retained > 0) body.append(el('p', 'company-meta', `公司留存 ${money(project.retained)}`));
    if (project.achievementBonus > 0) body.append(el('p', 'company-meta', `成就奖励 +${money(project.achievementBonus)}`));
    entry.append(summary, body);
    panel.append(entry);
  }
}
function rememberRecord(id, key, open) {
  if (open) openRecords.set(id, key);
  else if (openRecords.get(id) === key) openRecords.delete(id);
}
function renderOrder(company, order, type, retainRate = order.retainRate || 0) {
  const row = el('div', 'company-order', '');
  const profit = Math.round(order.reward * (1 + achievementBonuses(state).company) * 100) / 100;
  const cash = profit - Math.round(profit * retainRate * 100) / 100;
  const name = el('div', 'order-label', '');
  name.append(el('strong', '', order.title), el('span', '', `${order.seen.length} / ${order.target} ${type.unit}`));
  const progress = el('progress', '', '');
  progress.max = order.target;
  progress.value = order.seen.length;
  progress.setAttribute('aria-label', `${company.name} · ${order.title}进度`);
  row.append(name, progress, el('p', 'company-meta', `交付入账 ${money(cash)}${retainRate ? ` · 留存 ${money(profit - cash)}` : ''}${order.mode === 'risk' ? ' · 10% 概率亏损 ¥20' : ''}`));
  return row;
}
function renderGrowth(company, { cost, value }) {
  const panel = el('div', 'company-growth', '');
  const heading = el('div', 'growth-heading', '');
  const amount = el('strong', '', '');
  showMarketValue(amount, value);
  heading.append(el('span', '', '市值'), amount);
  if (cost > 0) {
    const change = (value / cost - 1) * 100;
    const badge = el('span', 'growth-change', `${change > 0 ? '+' : ''}${change.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`);
    badge.setAttribute('title', '相对投入成本');
    badge.setAttribute('aria-label', `相对投入成本 ${badge.textContent}`);
    heading.append(badge);
  }
  panel.append(heading);
  const history = company.valuationHistory || [];
  if (history.length > 1) {
    const high = Math.max(...history, 1);
    const bars = el('div', 'growth-bars', '');
    bars.setAttribute('role', 'img');
    bars.setAttribute('aria-label', `最近 ${history.length} 次交付结算的市值，从 ${money(history[0])} 到 ${money(history.at(-1))}`);
    for (const value of history) {
      const bar = el('span', '', '');
      bar.setAttribute('style', `height:${Math.max(8, value / high * 100)}%`);
      bar.setAttribute('title', money(value));
      bars.append(bar);
    }
    panel.append(bars);
  }
  const level = companyLevel(company);
  const track = el('ol', 'company-stages', '');
  COMPANY_STAGES.forEach((name, index) => {
    const step = el('li', index < level ? 'reached' : '', name);
    if (index === level - 1) step.setAttribute('aria-current', 'step');
    track.append(step);
  });
  panel.append(track);
  if (level < COMPANY_STAGES.length) {
    const left = level * 5 - company.completed;
    panel.append(el('p', 'stage-next', `再交付 ${left} 单进入${COMPANY_STAGES[level]}`));
  } else {
    const { current, next } = companyMarketProgress(company);
    panel.append(el('p', 'stage-next', [current?.name, next && `下一目标 · ${next.name}`].filter(Boolean).join(' · ')));
  }
  return panel;
}
function render() {
  const focused = document.activeElement;
  const companies = state.companies || [];
  const valuations = companyValuations(state);
  showMarketValue($('balance'), assetOverview(state).companies);
  $('cash').textContent = money(walletBalance(state));
  $('count').textContent = companies.length;
  $('completed').textContent = companies.reduce((sum, company) => sum + company.completed + (company.expansion?.completed || 0), 0);
  $('income').textContent = money(companies.reduce((sum, company) => sum + company.income - (company.losses || 0), 0));
  $('companies').replaceChildren();
  if (!companies.length) $('companies').append(el('p', 'company-empty', '第一家公司，等待你起一个名字。创办后即可自动接单。'));
  for (const [index, company] of companies.entries()) {
    const type = companyType(company), order = company.order || nextOrder(company);
    const card = el('article', 'company-card', '');
    const header = el('header', 'company-card-heading', '');
    const identity = el('div', '', '');
    identity.append(el('h3', 'company-name', company.name), el('p', 'company-meta', type.name));
    header.append(identity);
    if (company.expansion) header.append(el('span', 'company-tag', '双线经营'));
    card.append(header, renderGrowth(company, valuations[index]), renderOrder(company, order, type));
    if (company.expansion) card.append(renderOrder(company, company.expansion.order, expansionType(company), 0.7));
    card.append(companyPanels(company, order)); $('companies').append(card);
  }
  if (focused?.id && !focused.isConnected) $(focused.id)?.focus({ preventScroll: true });
  const selected = $('headquarters').value;
  $('headquarters').replaceChildren(new Option('线上办公室（免费）', ''));
  for (const estate of state.estates || []) $('headquarters').append(new Option(estate.host, estate.host));
  if ((state.estates || []).some(estate => estate.host === selected)) $('headquarters').value = selected;
  const price = companyPrice(state);
  $('createButton').textContent = busy ? '正在创办…' : `创办公司 · ${money(price)}`;
  $('createButton').disabled = busy || walletBalance(state) < price;
  $('businessHint').textContent = `${COMPANY_TYPES.find(type => type.id === $('companyType').value).description}${walletBalance(state) < price ? ` 余额还差 ${money(price - walletBalance(state))}。` : ''}`;
}
function renderExpansion(panel, company) {
  const type = expansionType(company);
  const level = (company.expansion?.level || 0) + 1;
  const next = COMPANY_EXPANSIONS[level - 1];
  const tools = el('section', 'panel-section expansion-card', '');
  tools.append(el('h4', '', `第二业务 · ${type.name}${company.expansion ? ` Lv.${level - 1}` : ''}`),
    el('p', 'action-hint', '独立接单 · 留存 70%'));
  if (next) {
    const retained = Math.min(company.retained || 0, next.price);
    const cash = next.price - retained;
    const button = el('button', 'manage-button primary-action', `${level === 1 ? '开拓' : `升级至 Lv.${level}`} · ${money(next.price)}`);
    button.type = 'button';
    button.disabled = busy || !expansionReady || company.completed < next.completed || walletBalance(state) < cash;
    button.addEventListener('click', () => manage(company, 'expand', level));
    const remaining = next.completed - company.completed;
    if (remaining > 0) tools.append(el('p', 'action-hint', `主营再交付 ${remaining} 单解锁`));
    else if (walletBalance(state) < cash) tools.append(el('p', 'action-hint', `现金还差 ${money(cash - walletBalance(state))}`));
    tools.append(el('p', 'action-hint', `基础合同 ${money(type.reward * next.multiplier)} · 每单 ${type.target + level - 1} ${type.unit}`));
    if (retained) tools.append(el('p', 'action-hint', `公司留存支付 ${money(retained)} · 个人现金支付 ${money(cash)}`));
    tools.append(button);
  }
  panel.append(tools);
  const allocation = el('section', 'panel-section', '');
  const choices = el('div', 'strategy-controls', '');
  allocation.append(el('h4', '', '主营赚的钱去哪？'), choices);
  for (const [value, label] of [['cash', '全部进钱包'], ['reinvest', '一半留在公司']]) {
    const button = el('button', 'manage-button', label);
    button.type = 'button';
    const selected = Boolean(company.reinvest) === (value === 'reinvest');
    button.disabled = busy || !expansionReady || selected;
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => manage(company, 'dividend', value));
    choices.append(button);
  }
  allocation.append(el('p', 'action-hint', `下一单生效 · 可用于扩张 ${money(company.retained)}`));
  panel.append(allocation);
  const market = companyMarketProgress(company);
  if (market.next) {
    const goal = market.next;
    const milestone = el('section', 'panel-section', '');
    milestone.append(el('h4', '', `下一阶段 · ${goal.name}`), el('p', 'action-hint', '长期目标 · 3 万亿市值'));
    const metrics = el('ul', 'market-goals', '');
    for (const [label, amount, target, format = String] of [
      ['主营交付', company.completed, goal.main],
      ['第二业务交付', market.branch, goal.branch],
      ['盈利交付天数', market.days, goal.days],
      ['累计留存', market.retained, goal.retained, money],
    ]) {
      const item = el('li', '', '');
      const line = el('div', 'market-goal-label', '');
      line.append(el('span', '', label), el('strong', '', `${format(amount)} / ${format(target)}`));
      const progress = el('progress', '', '');
      progress.max = target;
      progress.value = Math.min(amount, target);
      progress.setAttribute('aria-label', label);
      item.append(line, progress);
      metrics.append(item);
    }
    milestone.append(metrics);
    if (!market.ready) milestone.append(el('p', 'action-hint', '第二业务需升至 Lv.3'));
    panel.append(milestone);
  }
  if (!expansionReady) panel.append(el('p', 'action-hint', '重新加载扩展后可管理扩张与利润分配。'));
}
function renderManagement(body, company) {
  const strategy = el('section', 'panel-section', '');
  strategy.append(el('h4', '', '经营策略'));
  const controls = el('div', 'strategy-options', '');
  for (const [value, label, description] of [
    ['safe', '稳健经营', '按常规目标和报酬接单'],
    ['premium', '精品项目', '目标 +2 · 报酬 ×1.6 · 制作费 ¥15'],
    ['risk', '风险订单', '报酬 ×1.5 · 制作费 ¥20 · 10% 概率净亏 ¥20'],
  ]) {
    const option = el('div', 'strategy-option', '');
    const button = el('button', 'manage-button', label);
    button.type = 'button'; button.disabled = busy || !buildingReady;
    button.setAttribute('aria-pressed', String((company.strategy || 'safe') === value));
    button.addEventListener('click', () => manage(company, 'strategy', value));
    option.append(button, el('span', '', description));
    controls.append(option);
  }
  strategy.append(controls, el('p', 'action-hint', '下一单生效。风险订单余额不足时按普通订单结算，连续亏损两单切回稳健。'));
  body.append(strategy);
  body.append(renderTeam(company));
  const facilities = el('section', 'panel-section', '');
  facilities.append(el('h4', '', '设施'));
  for (const [value, spec] of Object.entries(COMPANY_FACILITIES)) {
    const owned = company.facilities?.includes(value);
    const button = el('button', 'manage-button', spec.name + (owned ? ' · 已建成 ✓' : ' · ' + money(spec.price)));
    button.type = 'button'; button.disabled = busy || !buildingReady || owned || walletBalance(state) < spec.price;
    button.addEventListener('click', () => manage(company, 'facility', value));
    const row = el('div', 'management-option', '');
    row.append(el('p', 'action-hint', spec.description), button);
    facilities.append(row);
  }
  body.append(facilities);
  if (!buildingReady) body.append(el('p', 'action-hint', '重新加载扩展后可招聘与建设。'));
}
function renderTeam(company) {
  const team = companyTeam(company);
  const capacity = companyTeamCapacity(company);
  const panel = el('section', 'panel-section team-panel', '');
  const heading = el('div', 'team-heading', '');
  heading.append(el('h4', '', '团队'), el('span', 'company-tag', `${team.length} / ${capacity} 人`));
  panel.append(heading);
  const nextSlot = COMPANY_TEAM_MILESTONES[capacity];
  if (nextSlot) panel.append(el('p', 'action-hint', `主营再交付 ${nextSlot - company.completed} 单可增加 1 个员工位`));
  panel.append(el('p', 'action-hint', '人员调整从下一单生效，薪酬从该业务交付收入扣除。'));
  if (!teamReady) panel.append(el('p', 'action-hint', '重新加载扩展后可管理团队。'));
  for (const [role, spec] of Object.entries(COMPANY_STAFF)) {
    const hired = team.includes(role);
    const name = role === 'specialist' ? company.type === 'publisher' ? '编辑' : '研究员' : spec.name;
    const shortage = spec.price - walletBalance(state);
    const block = hired ? '' : companyStaffRequirement(company, role) ||
      (team.length >= capacity ? '员工位已满' : shortage > 0 ? `现金还差 ${money(shortage)}` : '');
    const row = el('div', 'management-option team-role', '');
    const details = el('div', '', '');
    details.append(el('strong', '', hired ? `${name} · 在岗` : name), el('p', 'action-hint', spec.description));
    if (block) details.append(el('p', 'action-hint', block));
    const button = el('button', 'manage-button', hired ? '解聘' : `招聘${name} · ${money(spec.price)}`);
    button.type = 'button';
    if (hired) button.setAttribute('aria-label', `解聘${name}`);
    button.disabled = busy || !teamReady || Boolean(block);
    button.addEventListener('click', () => manage(company, hired ? 'dismiss' : 'staff', role));
    row.append(details, button);
    panel.append(row);
  }
  return panel;
}
async function manage(company, action, value) {
  if (busy) return;
  if (action === 'strategy' && value === 'risk' && !window.confirm('开启风险订单？每单有 10% 概率净亏损 ¥20，连续亏损两单自动切回稳健。下单生效。')) return;
  const panelKey = action === 'expand' || action === 'dividend' ? 'growth' : 'settings';
  $(`company-${company.id}-${panelKey}-button`)?.focus({ preventScroll: true });
  operation = { id: company.id, message: '正在保存…' };
  busy = true; ++revision; render();
  try {
    const response = await request({ type: 'MANAGE_COMPANY', id: company.id, action, value });
    if (!response?.ok) throw new Error(response?.error || '操作失败，请重新加载扩展');
    state = response.state;
    operation.message = action === 'expand' && value === 1 ? '第二业务已开始接单。' : '已保存，下一单生效。';
  } catch (error) {
    operation.message = error.message;
    operation.failed = true;
  } finally {
    busy = false;
    render();
    await refresh();
  }
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
      return before && (company.completed > before.completed || (company.expansion?.completed || 0) > (before.expansion?.completed || 0));
    });
    backendReady = response.features?.companies === true;
    buildingReady = response.features?.companyManagement === true;
    expansionReady = response.features?.companyExpansion === true;
    teamReady = response.features?.companyTeams === true;
    state = response.state; render();
    if (!backendReady) { feedback(reloadHint); return; }
    if (delivered.length) $('status').textContent = `${delivered.map(company => company.name).join('、')}已自动交付项目，经营结果已结算，下一笔订单已接入。`;
    if ($('status').textContent === '正在读取账本…') $('status').textContent = '';
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
$('createShortcut').addEventListener('click', () => { $('createCompany').open = true; $('companyName').focus(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState && !busy) refresh(); });
window.addEventListener('demoUpdate', refresh);
refresh();
