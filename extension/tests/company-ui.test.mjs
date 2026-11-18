import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { COMPANY_TYPES, companyPrice, companyLevel, companyType, createCompany, manageCompany, COMPANY_STAFF, COMPANY_FACILITIES } from '../core/company.js';
import { walletBalance } from '../core/shop.js';
import { companyBrief } from '../core/journey.js';
import { defaultState } from '../core/ledger.js';
const source = (await readFile(new URL('../company/company.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(sendMessage) {
  const nodes = new Map();
  function node() { return { textContent: '', value: '', disabled: false, children: [],
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    addEventListener(event, fn) { this[event] = fn; }, setAttribute() {}, focus() { this.focused = true; } }; }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  get('companyType').value = 'publisher'; get('status').textContent = '正在读取账本…';
  vm.runInNewContext(source, { companyBrief, COMPANY_TYPES, companyPrice, companyLevel, companyType, COMPANY_STAFF, COMPANY_FACILITIES, walletBalance,
    document: { getElementById: get, createElement: node }, Option: function(text, value) { return { text, value }; },
    chrome: { runtime: { sendMessage }, storage: { onChanged: { addListener() {} } } },
    window: { addEventListener() {}, confirm: () => true }, setTimeout, clearTimeout });
  return { get, submit: () => get('createForm').submit({ preventDefault() {} }) };
}
const funded = () => ({ ...defaultState(), totalAsset: 10000 });
const response = state => ({ ok: true, state, features: { companies: true } });

test('management buttons hire staff, build facilities and opt into risk without rewriting current order', async () => {
  let state = createCompany(funded(), '建设测试', 'publisher');
  const originalOrder = structuredClone(state.companies[0].order);
  const ui = setup(async message => {
    if (message.type === 'MANAGE_COMPANY') state = manageCompany(state, message.id, message.action, message.value);
    return { ok: true, state, features: { companies: true, companyManagement: true } };
  });
  await flush();
  function find(text) {
    const walk = n => n.textContent === text ? n : (n.children || []).map(walk).find(Boolean);
    return walk(ui.get('companies'));
  }
  const recruit = find('招聘编辑 · ¥200.00');
  assert.equal(recruit.disabled, false);
  await recruit.click();
  assert.equal(state.companies[0].staff, 'specialist');
  await find('专业工作台 · ¥600.00').click();
  assert.deepEqual(state.companies[0].facilities, ['studio']);
  await find('风险订单').click();
  assert.equal(state.companies[0].strategy, 'risk');
  assert.deepEqual(state.companies[0].order, originalOrder);
  assert.equal(state.companyBuildSpent, 800);
});

test('old background is identified beside the create button before spending', async () => {
  const messages = [];
  const ui = setup(async message => { messages.push(message.type); return { ok: true, state: funded() }; });
  await flush(); ui.get('companyName').value = '公司'; await ui.submit();
  assert.match(ui.get('createFeedback').textContent, /后台尚未更新/);
  assert.match(ui.get('createFeedback').textContent, /不要卸载/);
  assert.deepEqual(messages, ['GET_STATE']);
});
test('empty name displays local validation instead of silently blocking submission', async () => {
  const messages = [];
  const ui = setup(async message => { messages.push(message.type); return response(funded()); });
  await flush(); ui.get('companyName').value = '  '; await ui.submit();
  assert.match(ui.get('createFeedback').textContent, /公司名称/);
  assert.equal(ui.get('companyName').focused, true);
  assert.deepEqual(messages, ['GET_STATE']);
});
test('successful submission creates a company and shows feedback beside the button', async () => {
  let state = funded();
  const ui = setup(async message => {
    if (message.type === 'CREATE_COMPANY') state = createCompany(state, message.name, message.companyType, message.headquarters);
    return response(state);
  });
  await flush(); ui.get('companyName').value = '新事业'; await ui.submit();
  assert.equal(state.companies.length, 1);
  assert.equal(ui.get('companyName').value, '');
  assert.match(ui.get('createFeedback').textContent, /新事业已创办/);
  assert.equal(ui.get('createButton').disabled, false);
  assert.equal(ui.get('count').textContent, 1);
});
test('backend errors stay visible beside the form and preserve the entered name', async () => {
  const ui = setup(async message => message.type === 'CREATE_COMPANY' ? { ok: false, error: '公司名称已存在' } : response(funded()));
  await flush(); ui.get('companyName').value = '重名'; await ui.submit();
  assert.equal(ui.get('createFeedback').textContent, '公司名称已存在');
  assert.equal(ui.get('companyName').value, '重名');
  assert.equal(ui.get('createButton').disabled, false);
});
test('double submission sends only one request and pending state is visible', async () => {
  let release, calls = 0;
  const ui = setup(async message => {
    if (message.type === 'GET_STATE') return response(funded());
    calls++; return new Promise(resolve => { release = resolve; });
  });
  await flush(); ui.get('companyName').value = '测试';
  const first = ui.submit(); await ui.submit();
  assert.equal(calls, 1);
  assert.match(ui.get('createFeedback').textContent, /正在创办/);
  assert.equal(ui.get('createButton').disabled, true);
  release({ ok: false, error: '请重试' }); await first;
  assert.equal(ui.get('createButton').disabled, false);
});

test('merged company cards show old orders and work stories without rewriting legacy data', async () => {
  const state = createCompany(funded(), '老出版社', 'publisher');
  const company = state.companies[0];
  company.completed = 5;
  company.history = [{ title: '旧作品', amount: 80, ts: 123 }];
  delete company.strategy; delete company.staff; delete company.facilities;
  const before = structuredClone(state);
  const ui = setup(async () => response(state)); await flush();
  const texts = [];
  const walk = n => { texts.push(n.textContent); (n.children || []).forEach(walk); };
  walk(ui.get('companies'));
  assert.ok(texts.some(t => t.includes('街区口碑')));
  assert.ok(texts.includes(company.order.title));
  assert.ok(texts.some(t => t.startsWith('委托方 ·')));
  assert.ok(texts.includes('作品档案 · 累计 5 次交付 · 最近 1 项'));
  assert.ok(texts.includes('旧作品'));
  assert.ok(texts.some(t => t.startsWith('故事委托方 ·')));
  assert.deepEqual(state, before);
  const html = await readFile(new URL('../company/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('正在发生的生意'));
  assert.equal(html.includes('../journey/journey.js'), false);
});
