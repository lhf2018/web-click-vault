import { SHOP_ITEMS, unlockInfo } from '../core/shop.js';
const $ = id => document.getElementById(id);
let revision = 0;
async function refresh() {
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    const state = response.state;
    renderEquipmentUnlocks(state);
    $('status').textContent = ''; $('status').hidden = true;
  } catch (error) { $('status').hidden = false; $('status').textContent = `${error.message}，请重新加载扩展后再试。`; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState) refresh(); });
window.addEventListener('demoUpdate', refresh);
refresh();

function renderEquipmentUnlocks(state) {
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
}
