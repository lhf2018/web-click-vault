import { assetOverview } from '../core/overview.js';
const $ = id => document.getElementById(id);
const money = n => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let revision = 0;
async function refresh() {
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    const state = response.state, overview = assetOverview(state);
    for (const key of ['total', 'cash', 'companies', 'estates', 'equipment', 'collectibles', 'investments']) $(key).textContent = money(overview[key]);
    $('companyCount').textContent = `持有 ${(state.companies || []).length} 家公司`;
    $('estateCount').textContent = `持有 ${(state.estates || []).length} 块地产`;
    $('status').textContent = '';
  } catch (error) { $('status').textContent = `${error.message}，请重新加载扩展后再试。`; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState) refresh(); });
window.addEventListener('demoUpdate', refresh);
refresh();
