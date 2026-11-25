import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../core/ledger.js';
import { exportBackup, importBackup, validateBackup } from '../storage/repository.js';
let stored;
function setup() {
  stored = { assetMeterState: { ...defaultState(), totalAsset: 1234, totalVisits: 50, shopLevels: { notebook: 2 } }, assetMeterSessions: { 1: { url: 'https://example.com' } }, assetMeterPendingCommits: { 1: {} } };
  globalThis.chrome = { storage: { local: {
    get: async key => structuredClone({ [key]: stored[key] }),
    set: async patch => { stored = { ...stored, ...structuredClone(patch) }; },
    remove: async keys => { for (const key of keys) delete stored[key]; }
  } } };
}
test('JSON export round trips assets and settings, preserves prior ledger and clears live sessions', async () => {
  setup();
  const backup = JSON.parse(JSON.stringify(await exportBackup()));
  stored.assetMeterState.totalAsset = 9999;
  const state = await importBackup(backup);
  assert.equal(state.totalAsset, 1234);
  assert.equal(state.shopLevels.notebook, 2);
  assert.equal(stored.assetMeterBackupBeforeImport.totalAsset, 9999);
  assert.equal(stored.assetMeterSessions, undefined);
  assert.equal(stored.assetMeterPendingCommits, undefined);
});
test('malformed and incompatible backups leave existing state and sessions intact', async () => {
  setup();
  const good = await exportBackup();
  for (const backup of [{}, { ...good, version: 2 }, { ...good, state: { ...good.state, schemaVersion: 999 } }, { ...good, state: { ...good.state, totalAsset: -1 } }, { ...good, state: { ...good.state, estates: [null] } }, { ...good, state: { ...good.state, settings: { countSpaNavigations: 'yes' } } }]) {
    const before = structuredClone(stored);
    assert.throws(() => validateBackup(backup));
    assert.deepEqual(stored, before);
  }
});
test('prototype keys and non-finite numbers are rejected', async () => {
  setup();
  const backup = await exportBackup();
  backup.state.totalAsset = Infinity;
  assert.throws(() => validateBackup(backup));
  backup.state.totalAsset = 100;
  backup.state.extra = JSON.parse('{"__proto__": {"bad": true}}');
  assert.throws(() => validateBackup(backup));
});

test('populated backup preserves companies, property and formula scores', async () => {
  setup();
  const { createCompany } = await import('../core/company.js');
  const { ESTATE_LEVELS, purchaseEstate, upgradeEstate } = await import('../core/estate.js');
  let state = { ...defaultState(), totalAsset: 250000, totalVisits: 200, estateDiscoveries: [{ host: 'example.com', url: 'https://example.com/' }] };
  state = createCompany(state, '测试公司', 'publisher');
  state = purchaseEstate(state, 'example.com');
  Object.assign(state.estates[0], { visits: 195, days: 65 });
  for (const level of ESTATE_LEVELS.slice(1)) state = upgradeEstate(state, 'example.com');
  state.lastFormula = { scores: { type: 0.8, dwell: 0.5 }, weights: { type: 0.15 }, reason: '浏览', extras: [] };
  stored.assetMeterState = state;
  const backup = JSON.parse(JSON.stringify(await exportBackup()));
  const restored = await importBackup(backup);
  assert.equal(restored.companies[0].name, '测试公司');
  assert.deepEqual(restored.estates, state.estates);
  assert.equal(restored.lastFormula.scores.type, 0.8);
});
