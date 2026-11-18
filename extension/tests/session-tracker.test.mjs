import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../core/ledger.js';
import * as tracker from '../background/session-tracker.js';
let stored;
let probe;
function setup() {
  stored = { assetMeterState: { ...defaultState(), settings: { ...defaultState().settings, countSpaNavigations: true } }, assetMeterSessions: {} };
  probe = { dwellMs: 120000, visible: true };
  globalThis.chrome = { storage: { local: {
    get: async key => structuredClone({ [key]: stored[key] }),
    set: async patch => { stored = { ...stored, ...structuredClone(patch) }; }
  } }, tabs: { sendMessage: async () => probe }, action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} } };
}
test('capped sweep removes the session and cannot pay again after dedupe expires', async () => {
  setup();
  await tracker.beginSession(1, 'https://example.com/a');
  stored.assetMeterSessions['1'].dwellAccumMs = 180000;
  stored.assetMeterSessions['1'].dwellSource = 'probe';
  await tracker.settleIfDwellCapped();
  assert.deepEqual(stored.assetMeterSessions, {});
  stored.assetMeterState.recentVisitMap = {};
  await tracker.settleIfDwellCapped();
  assert.equal(stored.assetMeterState.totalVisits, 1);
});
test('SPA routes subtract document dwell and can each reach their own cap', async () => {
  setup();
  await tracker.beginSession(1, 'https://example.com/a');
  await tracker.applyDwellFromProbe(1, 120000);
  await tracker.onHistoryStateUpdated({ tabId: 1, frameId: 0, url: 'https://example.com/b' });
  await tracker.applyDwellFromProbe(1, 125000);
  assert.equal(stored.assetMeterSessions['1'].dwellAccumMs, 5000);
  assert.equal(stored.assetMeterState.lastFormula.dwellMs, 120000);
  probe = { dwellMs: 125000, visible: true };
  await tracker.onHistoryStateUpdated({ tabId: 1, frameId: 0, url: 'https://example.com/c' });
  await tracker.applyDwellFromProbe(1, 130000);
  assert.equal(stored.assetMeterSessions['1'].dwellAccumMs, 5000);
  await tracker.applyDwellFromProbe(1, 305000);
  assert.deepEqual(stored.assetMeterSessions, {});
  assert.equal(stored.assetMeterState.totalVisits, 3);
});
test('SPA after a settled route still starts from the current document baseline', async () => {
  setup();
  await tracker.beginSession(1, 'https://example.com/a');
  await tracker.applyDwellFromProbe(1, 180000);
  probe = { dwellMs: 240000, visible: true };
  await tracker.onHistoryStateUpdated({ tabId: 1, frameId: 0, url: 'https://example.com/b' });
  await tracker.applyDwellFromProbe(1, 245000);
  assert.equal(stored.assetMeterSessions['1'].dwellAccumMs, 5000);
});
test('concurrent probe updates on separate tabs do not erase sessions', async () => {
  setup();
  await Promise.all([tracker.beginSession(1, 'https://example.com/a'), tracker.beginSession(2, 'https://example.com/b')]);
  await Promise.all([tracker.applyDwellFromProbe(1, 10000), tracker.applyDwellFromProbe(2, 20000), tracker.settleIfDwellCapped()]);
  assert.equal(stored.assetMeterSessions['1'].dwellAccumMs, 10000);
  assert.equal(stored.assetMeterSessions['2'].dwellAccumMs, 20000);
});
