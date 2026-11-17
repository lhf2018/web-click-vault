import { achievementOverview, ACHIEVEMENT_CATALOG } from '../core/achievements.js';
import { SHOP_ITEMS, unlockInfo } from '../core/shop.js';
const $ = id => document.getElementById(id);
let revision = 0, latestState;
for (const category of new Set([...ACHIEVEMENT_CATALOG.map(a => a.category), '装备解锁'])) {
  const option = document.createElement('option'); option.value = category; option.textContent = category; $('achievementCategory').append(option);
}
$('achievementCategory').addEventListener('change', renderAchievements);
$('achievementFilter').addEventListener('change', renderAchievements);
function node(tag, text, cls) {
  const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n;
}
function renderAchievements() {
  if (!latestState) return;
  const equipment = [...SHOP_ITEMS].sort((a, b) => a.asset - b.asset).map(item => {
    const info = unlockInfo(latestState, item);
    return { id: `equipment_${item.id}`, title: item.name, category: '装备解锁',
      requirement: info.hint, unlocked: info.unlocked, progress: info.progress, equipment: true };
  });
  const items = [...achievementOverview(latestState), ...equipment];
  $('achievementCount').textContent = `已解锁 ${items.filter(a => a.unlocked).length} / ${items.length}`;
  const category = $('achievementCategory').value, filter = $('achievementFilter').value;
  const visible = items.filter(a => (category === 'all' || a.category === category) && (filter === 'all' || a.unlocked === (filter === 'unlocked')));
  $('achievementWall').replaceChildren();
  for (const a of visible) {
    const card = node('article', null, `achievement-card${a.unlocked ? ' unlocked' : ''}`);
    card.append(node('span', a.unlocked ? '✦' : '◇', 'achievement-emblem'), node('small', a.category), node('h3', a.title), node('p', a.requirement));
    const progress = node('progress'); progress.max = 1; progress.value = a.progress; progress.setAttribute('aria-label', `${a.title}进度`);
    const hint = a.equipment ? (a.unlocked ? '已解锁 · 可前往增长商店选购' : `解锁进度 ${Math.round(a.progress * 100)}%`)
      : a.unlocked ? '已解锁 · 永久纪念' : `${Math.min(a.current, a.threshold).toLocaleString('zh-CN')} / ${a.threshold.toLocaleString('zh-CN')}`;
    card.append(progress, node('strong', hint));
    $('achievementWall').append(card);
  }
  if (!visible.length) $('achievementWall').append(node('p', '这个分类下暂无符合条件的成就。', 'empty'));
}
async function refresh() {
  const current = ++revision;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error || '无法读取账本');
    if (current !== revision) return;
    const state = response.state; latestState = state; renderAchievements();
    $('status').textContent = ''; $('status').hidden = true;
  } catch (error) { $('status').hidden = false; $('status').textContent = `${error.message}，请重新加载扩展后再试。`; }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.assetMeterState) refresh(); });
window.addEventListener('demoUpdate', refresh); window.addEventListener('focus', refresh);
refresh();
