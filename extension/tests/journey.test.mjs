import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { defaultState } from '../core/ledger.js';
import { estateLandmark, companyBrief, collectionSets, achievementSeries, journeyGoals, toggleDisplayCollectible } from '../core/journey.js';
import { collectibleIdentity, COLLECTION_TYPES } from '../core/collectibles.js';
import { assetOverview } from '../core/overview.js';

const legacy = () => ({ ...defaultState(), totalAsset: 10000, totalVisits: 100,
  estates: [{ host: 'old.test', level: 3, visits: 16, days: 5, income: 12 }],
  companies: [{ id: 'old-company', name: '<script>公司</script>', type: 'publisher', completed: 5, income: 80,
    order: { title: '旧订单', target: 4, seen: ['page'], startedAt: 123 }, history: [{ title: '旧作品', amount: 80, ts: 100 }] }],
  collectibles: ['badge', 'bookmark', 'chip'].map((type, i) => ({ id: `old-${i}`, host: 'old.test', type, title: '<img src=x>', value: 80, foundAt: 100, soldAt: null })),
});

test('landmarks and company briefs derive stable growth from old records without changing them', () => {
  const state = legacy(), before = structuredClone(state);
  const landmark = estateLandmark(state.estates[0]);
  assert.equal(landmark.level, 3);
  assert.equal(landmark.milestones.filter(s => s.reached).length, 3);
  assert.deepEqual(landmark.next, { name: '大楼', visits: 14, days: 5, price: 5000 });
  assert.equal(estateLandmark({ ...state.estates[0], level: 5 }).next, null);
  const brief = companyBrief(state.companies[0]);
  assert.deepEqual(brief, companyBrief(state.companies[0]));
  assert.equal(brief.rank, '街区口碑');
  assert.deepEqual(state, before);
});

test('old and sold collectibles contribute distinct held and historical set progress', () => {
  const state = legacy();
  state.collectibles.push({ ...state.collectibles[0], id: 'duplicate' });
  let group = collectionSets(state)[0];
  assert.equal(group.owned.size, 3); assert.equal(group.found.size, 3);
  state.collectibles = state.collectibles.map(i => i.type === 'chip' ? { ...i, soldAt: 123 } : i);
  group = collectionSets(state)[0];
  assert.equal(group.owned.size, 2); assert.equal(group.found.size, 3);
});

test('display pins are additive, capped, deduplicated and cannot alter old item valuations or sales', () => {
  const state = legacy(), before = structuredClone(state);
  let next = toggleDisplayCollectible(state, 'old-0');
  next = toggleDisplayCollectible(next, 'old-1'); next = toggleDisplayCollectible(next, 'old-2');
  assert.deepEqual(next.displayCollectibles, ['old-0', 'old-1', 'old-2']);
  assert.deepEqual(next.collectibles, before.collectibles); assert.equal(next.totalAsset, state.totalAsset);
  const extra = { ...next, collectibles: [...next.collectibles, { ...next.collectibles[0], id: 'fourth' }] };
  assert.throws(() => toggleDisplayCollectible(extra, 'fourth'), /最多陈列/);
  assert.deepEqual(toggleDisplayCollectible(next, 'old-1').displayCollectibles, ['old-0', 'old-2']);
  assert.throws(() => toggleDisplayCollectible({ ...next, collectibles: next.collectibles.map(i => ({ ...i, soldAt: 1 })) }, 'old-0'), /当前持有/);
  assert.deepEqual(state, before);
  assert.equal(toggleDisplayCollectible({ ...next, displayCollectibles: ['missing', 'old-0', 'old-0'] }, 'old-2').displayCollectibles.length, 2);
});

test('series respect permanent unlocks, choose unfinished goals and leave complete tracks out', () => {
  const state = legacy(), before = structuredClone(state);
  state.unlockedAchievements = ['milestone_visits_10000'];
  const series = achievementSeries(state).find(s => s.name === '浏览足迹');
  assert.equal(series.unlocked, 3);
  assert.notEqual(series.next.id, 'milestone_visits_10000');
  const goals = journeyGoals(state);
  assert.ok(goals.length <= 3 && goals.every(g => g.progress < 1));
  assert.ok(goals.every((g, i) => i === 0 || goals[i - 1].progress >= g.progress));
  assert.equal(before.collectibles[0].value, state.collectibles[0].value);
});

test('display choice survives repository reload and resetToday without rewriting existing assets', async () => {
  const data = { assetMeterState: legacy() };
  globalThis.chrome = { storage: { local: { get: async key => ({ [key]: structuredClone(data[key]) }), set: async patch => Object.assign(data, structuredClone(patch)), remove: async () => {} } } };
  const repo = await import('../storage/repository.js?journey');
  await repo.updateState(s => toggleDisplayCollectible(s, 'old-0'));
  assert.deepEqual((await repo.loadState()).displayCollectibles, ['old-0']);
  assert.deepEqual((await repo.resetToday()).displayCollectibles, ['old-0']);
  assert.equal(data.assetMeterState.collectibles[0].value, 80);
});

const source = (await readFile(new URL('../journey/journey.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(page, initial = legacy()) {
  const nodes = [], listeners = {};
  function node(tag) { const n = { tag, children: [], textContent: '', style: { setProperty() {} }, attributes: {}, events: {},
    append(...kids) { this.children.push(...kids); }, prepend(...kids) { this.children.unshift(...kids); }, replaceChildren(...kids) { this.children = kids; },
    setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, f) { this.events[k] = f; }, insertAdjacentElement() {} };
    nodes.push(n); return n;
  }
  let state = initial, calls = 0;
  vm.runInNewContext(source, { estateLandmark, companyBrief, collectionSets, achievementSeries, journeyGoals, collectibleIdentity, COLLECTION_TYPES, assetOverview,
    location: { pathname: `/${page}/index.html` }, document: { createElement: node, querySelector: () => node('hero') },
    window: { addEventListener(k, f) { listeners[k] = f; } },
    chrome: { runtime: { sendMessage: async m => { calls++; if (m.type === 'TOGGLE_DISPLAY_COLLECTIBLE') state = toggleDisplayCollectible(state, m.id); return { ok: true, state }; } }, storage: { onChanged: { addListener(f) { listeners.storage = f; } } } } });
  return { nodes, listeners, state: () => state, calls: () => calls };
}
for (const page of ['collection', 'achievements', 'overview']) {
  test(`${page} journey panel renders populated and empty legacy states`, async () => {
    for (const state of [legacy(), defaultState()]) {
      const before = structuredClone(state), ui = setup(page, state); await flush();
      const panel = ui.nodes.find(n => n.className?.split(' ').includes('journey-panel'));
      assert.ok(panel.children.some(n => n.tag === 'h2'));
      assert.deepEqual(state, before);
      assert.ok(ui.nodes.every(n => !Object.hasOwn(n, 'innerHTML')));
      assert.equal(ui.nodes.find(n => n.className === 'journey-feedback').textContent, '');
    }
  });
}
test('old collectible can enter and leave display using the UI without extra transactions', async () => {
  const ui = setup('collection'); await flush();
  const pin = ui.nodes.find(n => n.tag === 'button' && n.textContent.startsWith('陈列 ·'));
  await pin.events.click();
  assert.deepEqual(ui.state().displayCollectibles, ['old-0']);
  const unpin = ui.nodes.findLast(n => n.tag === 'button' && n.textContent === '撤下陈列');
  await unpin.events.click();
  assert.deepEqual(ui.state().displayCollectibles, []);
  assert.equal(ui.state().collectibles[0].value, 80);
  assert.equal(ui.calls(), 3);
});
