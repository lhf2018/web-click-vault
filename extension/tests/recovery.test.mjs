import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../core/ledger.js';

const orphan = (suffix) => ({ url: `https://example.com/${suffix}`, startedAt: Date.now()-60000, dwellAccumMs:60000, dwellSource:'probe' });
test('automatic recovery respects preference, drains existing records and does not double-credit', async () => {
  let stored = { assetMeterState: defaultState(), assetMeterSessions: { 10: orphan('manual') } };
  globalThis.chrome = {
    storage: { local: {
      get: async (key) => structuredClone({ [key]:stored[key] }),
      set: async (patch) => { stored = { ...stored, ...structuredClone(patch) }; },
    } },
    tabs:{query:async()=>[]},
    action:{setBadgeBackgroundColor:async()=>{},setBadgeText:async()=>{}},
  };
  const { scanOrphanSessions, updateSettings } = await import('../background/session-tracker.js');
  const { loadState } = await import('../storage/repository.js');
  await scanOrphanSessions();
  let state = await loadState();
  assert.equal(state.totalVisits,0);
  assert.equal(state.pendingRecoveries.length,1);
  state = await updateSettings({autoSettleRecoveries:true});
  assert.equal(state.settings.autoSettleRecoveries,true);
  assert.equal(state.totalVisits,1);
  assert.equal(state.pendingRecoveries.length,0);
  assert.ok(state.totalAsset>0);
  assert.equal((await loadState()).settings.autoSettleRecoveries,true);

  stored.assetMeterSessions = { 20: orphan('automatic') };
  await scanOrphanSessions();
  state = await loadState();
  assert.equal(state.totalVisits,2);
  assert.equal(state.pendingRecoveries.length,0);
  await scanOrphanSessions();
  assert.equal((await loadState()).totalVisits,2);

  // Pending records from an earlier run are drained even with no new orphan sessions.
  stored.assetMeterState.pendingRecoveries=[orphan('previous-run')];
  await scanOrphanSessions();
  state=await loadState();
  assert.equal(state.totalVisits,3);
  assert.equal(state.pendingRecoveries.length,0);
  await updateSettings({autoSettleRecoveries:false});
  stored.assetMeterSessions = { 30: orphan('disabled-again') };
  await scanOrphanSessions();
  state=await loadState();
  assert.equal(state.totalVisits,3);
  assert.equal(state.pendingRecoveries.length,1);
  assert.equal(state.settings.showFormulaDebug,true);
});
