import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ACHIEVEMENT_CATALOG, achievementOverview, recordAchievementVisit, syncAchievements } from '../core/achievements.js';
import { defaultState, applyDeposit } from '../core/ledger.js';
import { SHOP_ITEMS, unlockInfo } from '../core/shop.js';

test('54 unique achievements include ten tracks and keep legacy IDs and thresholds', () => {
  assert.equal(ACHIEVEMENT_CATALOG.length, 54);
  assert.equal(new Set(ACHIEVEMENT_CATALOG.map(a => a.id)).size, 54);
  assert.equal(new Set(ACHIEVEMENT_CATALOG.map(a => a.category)).size, 10);
  assert.deepEqual(ACHIEVEMENT_CATALOG.slice(0, 4).map(a => [a.id, a.threshold]), [
    ['start_ledger', 300], ['hold_impulse', 1000], ['keep_money', 3000], ['month_surplus', 10000],
  ]);
  assert.equal(achievementOverview(defaultState()).filter(a => a.unlocked).length, 0);
});

test('reading, days and normalized hosts count qualified settlements without reward inflation', () => {
  let state = defaultState();
  const browse = { url: 'https://WWW.Example.com/a', metrics: { dwellMs: 60000 } };
  state = recordAchievementVisit(state, browse, '2026-11-18');
  state = recordAchievementVisit(state, { ...browse, url: 'https://example.com/b' }, '2026-11-18');
  assert.equal(state.achievementStats.deepReads, 2);
  assert.equal(state.achievementStats.activeDays, 1);
  assert.deepEqual(state.achievementStats.hosts, ['example.com']);
  for (const kind of ['task_reward', 'company_income', 'market_income', 'estate_income']) {
    assert.equal(recordAchievementVisit(state, { ...browse, kind }, '2026-11-19'), state);
  }
  state = recordAchievementVisit(state, { ...browse, metrics: { dwellMs: 59000 } }, '2026-11-19');
  assert.equal(state.achievementStats.deepReads, 2);
  assert.equal(state.achievementStats.activeDays, 2);
  const capped = { ...state, achievementStats: { ...state.achievementStats, hosts: Array.from({ length: 1000 }, (_, i) => `site${i}.test`) } };
  assert.equal(recordAchievementVisit(capped, browse, '2026-11-19').achievementStats.hosts.length, 1000);
});

test('milestones unlock at thresholds and remain after disposal without paying new money', () => {
  const starting = { ...defaultState(), totalAsset: 20000, totalVisits: 100,
    estates: [{ host: 'example.com' }], shopLevels: { notebook: 5 },
    collectibles: [{ id: 'one', soldAt: null }], companies: [{ completed: 10 }],
    investments: [{ status: 'exited' }] };
  const state = syncAchievements(starting);
  for (const id of ['milestone_visits_100', 'milestone_estates_1', 'milestone_collectibles_1', 'milestone_orders_10', 'milestone_equipment_5', 'milestone_trades_1']) assert.ok(state.unlockedAchievements.includes(id));
  assert.equal(state.totalAsset, starting.totalAsset);
  assert.equal(state.pendingAchievement, null);
  assert.deepEqual(state.recentEntries, []);
  const after = syncAchievements({ ...state, estates: [], shopLevels: {}, collectibles: [], investments: [] });
  assert.deepEqual(after.unlockedAchievements, state.unlockedAchievements);
  assert.equal(achievementOverview(after).find(a => a.id === 'milestone_equipment_5').progress, 1);
  assert.equal(syncAchievements(after), after);
});

test('accepted deposits persist reading milestones, reward deposits do not advance browsing stats', () => {
  let state = defaultState();
  for (let i = 0; i < 5; i++) state = applyDeposit(state, { amount: 1, url: `https://site${i}.test/page`, metrics: { dwellMs: 60000 } });
  assert.ok(state.unlockedAchievements.includes('milestone_deepReads_5'));
  assert.ok(state.unlockedAchievements.includes('milestone_sites_5'));
  assert.equal(state.totalAsset, 5);
  const stats = structuredClone(state.achievementStats);
  state = applyDeposit(state, { kind: 'task_reward', amount: 10 });
  assert.deepEqual(state.achievementStats, stats);
  assert.equal(state.totalAsset, 15);
});

test('repository persists achievements before assets are sold and reload preserves earned IDs', async () => {
  let stored = { assetMeterState: { ...defaultState(), shopLevels: { notebook: 5 } } };
  globalThis.chrome = { storage: { local: {
    get: async key => structuredClone({ [key]: stored[key] }),
    set: async patch => { stored = { ...stored, ...structuredClone(patch) }; },
  } } };
  const repo = await import('../storage/repository.js');
  await repo.updateState(state => ({ ...state, shopLevels: {} }));
  const loaded = await repo.loadState();
  assert.ok(loaded.unlockedAchievements.includes('milestone_equipment_5'));
  assert.deepEqual(stored.assetMeterState.unlockedAchievements, loaded.unlockedAchievements);
});

test('achievement page merges milestones and equipment into 63 entries with shared filters', async () => {
  const source = (await readFile(new URL('../achievements/achievements.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const nodes = new Map();
  function node(tag) { return { tag, value: 'all', children: [], textContent: '',
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    addEventListener(name, handler) { this[name] = handler; }, setAttribute() {} }; }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node('div')); return nodes.get(id); };
  vm.runInNewContext(source, { ACHIEVEMENT_CATALOG, achievementOverview, SHOP_ITEMS, unlockInfo,
    document: { getElementById: get, createElement: node }, window: { addEventListener() {} },
    chrome: { runtime: { sendMessage: async () => ({ ok: true, state: { ...defaultState(), totalVisits: 100 } }) }, storage: { onChanged: { addListener() {} } } },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('achievementWall').children.length, 63);
  const rewardText = n => [n.textContent, ...(n.children || []).map(rewardText)].join(' ');
  assert.match(rewardText(get('achievementWall')), /已生效 · 浏览收益/);
  assert.match(rewardText(get('achievementWall')), /解锁奖励 · 藏品发现概率/);
  assert.equal(get('achievementCount').textContent, '已解锁 3 / 63');
  get('achievementCategory').value = '浏览足迹'; get('achievementCategory').change();
  assert.equal(get('achievementWall').children.length, 5);
  get('achievementFilter').value = 'unlocked'; get('achievementFilter').change();
  assert.equal(get('achievementWall').children.length, 2);
  get('achievementFilter').value = 'locked'; get('achievementFilter').change();
  assert.equal(get('achievementWall').children.length, 3);
  get('achievementCategory').value = '装备解锁'; get('achievementFilter').value = 'all'; get('achievementCategory').change();
  assert.equal(get('achievementWall').children.length, 9);
  get('achievementFilter').value = 'unlocked'; get('achievementFilter').change();
  assert.equal(get('achievementWall').children.length, 1);
  const containsText = (element, text) => element.textContent.includes(text) || element.children.some(child => containsText(child, text));
  assert.ok(containsText(get('achievementWall').children[0], '可前往增长商店选购'));
  const html = await readFile(new URL('../achievements/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/class="growth-section"/g) || []).length, 1);
  assert.ok(html.includes('成就进度'));
  assert.equal(html.includes('id="roadmap"'), false);
});
