import { WEEKLY_TASKS, ensureWeek, taskProgress } from "../core/weekly.js";
import { SHOP_ITEMS, SHOP_CATEGORIES, itemLevel, itemPrice, walletBalance, incomeMultiplier, unlockInfo, depositMultiplier } from '../core/shop.js';
const $ = id => document.getElementById(id);
const money = value => `¥${(Number(value)||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
let state = null;
let category = 'all';
let busy = false;
let revision = 0;
const categories = new Map();
for (const group of SHOP_CATEGORIES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = group.name;
  button.setAttribute('aria-pressed', String(group.id === category));
  button.addEventListener('click', () => {
    category = group.id;
    for (const [id, control] of categories) control.setAttribute('aria-pressed', String(id === category));
    renderProducts();
  });
  categories.set(group.id, button);
  $('categories').append(button);
}
function render() {
  if (!state) return;
  $('balance').textContent = money(walletBalance(state));
  $('multiplier').textContent = `×${incomeMultiplier(state)}`;
  $('collection').textContent = `${SHOP_ITEMS.filter(item => itemLevel(state,item)>0).length} / ${SHOP_ITEMS.length}`;
  $('levels').textContent = `共 ${SHOP_ITEMS.reduce((sum,item)=>sum+itemLevel(state,item),0)} 级永久升级`;
  $('spent').textContent = money(state.shopSpent);
  renderProducts();
  renderGrowth();
  $('purchases').replaceChildren();
  const purchases = state.shopPurchases || [];
  if (!purchases.length) {
    const row = document.createElement('li');
    row.textContent = '下一件好装备，将成为新的起点。';
    $('purchases').append(row);
  }
  for (const purchase of purchases.slice(0,30)) {
    const item = SHOP_ITEMS.find(item=>item.id===purchase.itemId);
    if (!item) continue;
    const row = document.createElement('li');
    const detail = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = `${item.name} · Lv.${purchase.level}`;
    const date = document.createElement('small');
    date.textContent = new Date(purchase.ts).toLocaleString('zh-CN');
    detail.append(title,date);
    const price = document.createElement('span');
    price.textContent = `−${money(purchase.price)}`;
    row.append(detail,price);
    $('purchases').append(row);
  }
}
function renderProducts() {
  if (!state) return;
  const balance = walletBalance(state);
  const metrics = scenarioMetrics();
  const multiplier = depositMultiplier(state,metrics).multiplier;
  let items = SHOP_ITEMS.filter(item => (category === 'all' || category === item.category) && (!$('ownedOnly').checked || itemLevel(state,item)>0));
  const cost = item => itemPrice(item,itemLevel(state,item));
  if ($('sort').value === 'price') items.sort((a,b)=>cost(a)-cost(b));
  if ($('sort').value === 'efficiency') items.sort((a,b)=>cost(a)/a.bonus-cost(b)/b.bonus);
  $('products').replaceChildren();
  $('empty').hidden = items.length>0;
  for (const item of items) {
    const level = itemLevel(state,item);
    const price = cost(item);
    const maxed = level >= item.maxLevel;
    const unlocked = unlockInfo(state,item);
    const previewState = {...state,shopLevels:{...state.shopLevels,[item.id]:Math.min(item.maxLevel,level+1)}};
    const nextMultiplier = depositMultiplier(previewState,metrics).multiplier;
    const row = document.createElement('article');
    row.className = 'product';
    row.dataset.category = item.category;
    row.innerHTML = `<div class="product-art"><span class="symbol" aria-hidden="true">${item.symbol}</span><span class="product-level">${!unlocked.unlocked ? '待解锁' : level ? '已拥有' : '已解锁'} · Lv.${level}</span></div>
      <div class="product-body"><span class="category-label">${SHOP_CATEGORIES.find(c=>c.id===item.category).name}</span><h3>${item.name}</h3><p class="description">${item.description}</p>
      <div class="effect"><span>每级常驻加成</span><strong>+${Math.round(item.bonus*100)}%</strong></div>
      <p class="special-effect">${item.label || "全场景常驻加成，稳定提升每次入账"}</p>
      <p class="preview">${maxed ? `已贡献 +${Math.round(level*item.bonus*100)}% 浏览收益` : `购买后总倍率 ×${multiplier} → ×${nextMultiplier}<br>基础 ¥10 的入账：${money(10*multiplier)} → ${money(10*nextMultiplier)}`}</p>
      <div class="level-track" role="progressbar" aria-label="${item.name}升级进度" aria-valuenow="${level}" aria-valuemin="0" aria-valuemax="${item.maxLevel}"><span style="width:${level/item.maxLevel*100}%"></span></div>
      <p class="progress-label">等级 ${level} / ${item.maxLevel} · 已贡献 +${Math.round(level*item.bonus*100)}%</p></div>`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy';
    button.dataset.item = item.id;
    button.disabled = busy || !unlocked.unlocked || maxed || balance<price;
    button.innerHTML = `<span>${!unlocked.unlocked ? '探索解锁' : maxed ? '已升至满级' : level ? '升级装备' : '购入装备'}</span><strong>${maxed ? '✓' : money(price)}</strong>`;
    button.setAttribute('aria-label', `${item.name}，${maxed ? '已满级' : `购买第${level+1}级，${money(price)}`}`);
    button.addEventListener('click',()=>buy(item));
    const hint = document.createElement('p');
    hint.className = 'shortfall';
    hint.textContent = !unlocked.unlocked ? unlocked.hint : !maxed && balance<price ? `还差 ${money(price-balance)}，继续探索吧` : maxed ? '谢谢你，让它发挥了全部潜力。' : '一次购入，永久生效';
    row.querySelector('.product-body').append(button,hint);
    $('products').append(row);
  }
}
async function refresh() {
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({type:'GET_STATE'});
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    state = ensureWeek(response.state);
    render();
    if ($('status').textContent==='正在读取账本…') $('status').textContent='常驻加成永久生效，探索与阅读可触发额外特效。';
  } catch(error) { $('status').textContent = `${error.message}，请重新加载扩展后再试。`; }
}
async function buy(item) {
  if (busy) return;
  busy = true;
  ++revision;
  render();
  $('status').textContent = `正在购入${item.name}…`;
  try {
    const response = await chrome.runtime.sendMessage({type:'BUY_UPGRADE',itemId:item.id});
    if (!response?.ok) throw new Error(response?.error || '购买失败');
    state = ensureWeek(response.state);
    $('status').textContent = `${item.name}已升至 Lv.${itemLevel(state,item)}，常驻收益 ×${incomeMultiplier(state)}，特效按浏览条件生效。`;
  } catch(error) { $('status').textContent=error.message || '购买失败，请重试。'; }
  finally {
    busy = false;
    await refresh();
    const target = document.querySelector(`[data-item="${item.id}"]`);
    if (target && !target.disabled) target.focus();
  }
}
$('ownedOnly').addEventListener('change',renderProducts);
$('scenario').addEventListener('change',renderProducts);
$('sort').addEventListener('change',renderProducts);
chrome.storage.onChanged.addListener((changes,area)=>{
  if (area==='local' && changes.assetMeterState && !busy) refresh();
});
window.addEventListener('demoUpdate',refresh);
refresh();

function scenarioMetrics() {
  const value = $('scenario').value;
  return {freshKind:['first_host','seen_path','new_path'].includes(value) ? value : 'default',
    dwellMs: value==='extended'?120000 : value==='deep'?60000 : value==='normal'?0:15000};
}
function renderGrowth() {
  const count = SHOP_ITEMS.filter(item=>unlockInfo(state,item).unlocked).length;
  $('unlockCount').textContent = `已解锁 ${count} / ${SHOP_ITEMS.length}`;
  $('roadmap').replaceChildren();
  for (const item of [...SHOP_ITEMS].sort((a,b)=>a.asset-b.asset)) {
    const info = unlockInfo(state,item);
    const row = document.createElement('div');
    row.className = `unlock-step${info.unlocked?' unlocked':''}`;
    row.innerHTML = `<strong>${info.unlocked?'✓':'◇'} ${item.name}</strong><small>${info.hint}</small><progress value="${info.progress}" max="1" aria-label="${item.name}解锁进度"></progress>`;
    $('roadmap').append(row);
  }
  $('weekLabel').textContent = `本周起始 ${state.weekly.weekKey}`;
  $('weeklyTasks').replaceChildren();
  for (const task of WEEKLY_TASKS) {
    const progress = taskProgress(state,task);
    const claimed = state.weekly.claimed.includes(task.id);
    const row = document.createElement('article');
    row.className='task-card';
    row.innerHTML=`<div class="task-top"><h3>${task.title}</h3><strong>+${money(task.reward)}</strong></div><p>${task.description}</p><progress value="${progress}" max="${task.target}" aria-label="${task.title}进度"></progress><small>${progress} / ${task.target}</small>`;
    const button=document.createElement('button');
    button.type='button';button.className='buy';
    button.textContent=claimed?'本周已领取':progress>=task.target?'领取奖励':'探索进行中';
    button.disabled=busy||claimed||progress<task.target;
    button.addEventListener('click',()=>claimTask(task));
    row.append(button);$('weeklyTasks').append(row);
  }
}
async function claimTask(task) {
  if(busy)return;
  busy=true;++revision;render();
  try {
    const response=await chrome.runtime.sendMessage({type:'CLAIM_WEEKLY_REWARD',taskId:task.id,weekKey:state.weekly.weekKey});
    if(!response?.ok)throw new Error(response?.error||'领取失败');
    state=ensureWeek(response.state);
    $('status').textContent=`${task.title}奖励 ${money(task.reward)} 已入账。`;
  } catch(error){$('status').textContent=error.message;}
  finally{busy=false;await refresh();}
}
