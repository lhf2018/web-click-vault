import test from "node:test";
import assert from "node:assert/strict";
import { SHOP_ITEMS, purchaseUpgrade, walletBalance, incomeMultiplier, itemPrice } from "../core/shop.js";
import { defaultState, applyDeposit, ensureDayRollover } from "../core/ledger.js";

const funded = (amount = 10000) => ({ ...defaultState(), totalAsset: amount });
test("legacy earnings remain fully spendable", () => {
  assert.equal(walletBalance({ totalAsset: 123.45 }), 123.45);
  assert.equal(incomeMultiplier({}), 1);
});
test("purchase debits wallet without changing earnings or history", () => {
  const state = funded();
  const next = purchaseUpgrade(state, "notebook");
  assert.equal(walletBalance(next), 9950);
  assert.equal(next.totalAsset, state.totalAsset);
  assert.equal(next.todayAsset, state.todayAsset);
  assert.equal(state.shopLevels.notebook, undefined);
  assert.equal(itemPrice(SHOP_ITEMS[0], 1), 82.5);
});
test("invalid, unaffordable and maxed purchases are rejected", () => {
  assert.throws(() => purchaseUpgrade(funded(), "unknown"), /商品不存在/);
  assert.throws(() => purchaseUpgrade(funded(49.99), "notebook"), /余额不足/);
  assert.throws(() => purchaseUpgrade({ ...funded(), shopLevels: { notebook: 10 } }, "notebook"), /满级/);
  const exact = purchaseUpgrade(funded(50), "notebook");
  assert.equal(walletBalance(exact), 0);
});
test("additive bonuses affect ledger, history, formula and achievements", () => {
  let state = funded(2990);
  state = { ...state, shopLevels: { notebook: 1, workbench: 1, engine: 1 } };
  assert.equal(incomeMultiplier(state), 2.4);
  const next = applyDeposit(state, { amount: 10, reason: "浏览" }, { amount: 10 });
  assert.equal(next.totalAsset, 3014);
  assert.equal(next.todayAsset, 24);
  assert.equal(next.totalVisits, 1);
  assert.equal(next.dailyHistory[next.dayKey].asset, 24);
  assert.equal(next.recentEntries[0].baseAmount, 10);
  assert.equal(next.lastFormula.amount, 24);
  assert.equal(next.lastFormula.multiplier, 2.4);
  assert.ok(next.unlockedAchievements.includes("keep_money"));
});
test("upgrades survive day rollover", () => {
  const state = { ...purchaseUpgrade({ ...funded(), shopLevels: { engine: 1 } }, "engine"), dayKey: "2020-01-01" };
  const next = ensureDayRollover(state);
  assert.equal(incomeMultiplier(next), 3);
  assert.equal(next.shopSpent, 2000);
});
test("concurrent purchases and deposits serialize and failures do not block later writes", async () => {
  let stored = { assetMeterState: funded(50) };
  globalThis.chrome = { storage: { local: {
    get: async (key) => structuredClone({ [key]: stored[key] }),
    set: async (patch) => { stored = { ...stored, ...structuredClone(patch) }; },
    remove: async () => {},
  } } };
  const { updateState, loadState, resetToday, resetAll } = await import("../storage/repository.js");
  const results = await Promise.allSettled([
    updateState((s) => purchaseUpgrade(s, "notebook")),
    updateState((s) => purchaseUpgrade(s, "notebook")),
    updateState((s) => applyDeposit(s, { amount: 10 })),
    loadState(),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  const state = await loadState();
  assert.equal(walletBalance(state), 11);
  assert.equal(state.shopLevels.notebook, 1);
  assert.equal((await resetToday()).shopLevels.notebook, 1);
  const reset = await resetAll();
  assert.equal(walletBalance(reset), 0);
  assert.equal(incomeMultiplier(reset), 1);
});

for (const version of [1, 2, 3]) {
  test(`schema ${version} migration preserves existing data and persists shop defaults`, async () => {
    const old = {
      schemaVersion: version, dayKey: defaultState().dayKey,
      totalAsset: 12345.67, totalVisits: 2300, todayAsset: 45.67, todayVisits: 9,
      recentEntries: [{ id: "old-entry", ts: 1, amount: 4.2, host: "example.com" }],
      dailyHistory: { "2026-11-01": { visits: 5, asset: 23.4 } },
      settings: { countSpaNavigations: true, showFormulaDebug: false },
      pendingRecoveries: [{ url: "https://example.com/unfinished", dwellAccumMs: 6000 }],
      unlockedAchievements: ["start_ledger", "hold_impulse"],
      pendingAchievement: { id: "hold_impulse", title: "旧成就" },
      lastFormula: { amount: 4.2 },
      recentVisitMap: { "https://example.com": 123 },
      hostDayMap: { "example.com": true }, pathDayMap: { "/old": true },
    };
    let stored = { assetMeterState: structuredClone(old), assetMeterSessions: { 7: { url: "https://example.com" } } };
    const sessionsBefore = structuredClone(stored.assetMeterSessions);
    globalThis.chrome = { storage: { local: {
      get: async (key) => structuredClone({ [key]: stored[key] }),
      set: async (patch) => { stored = { ...stored, ...structuredClone(patch) }; },
      remove: async () => {},
    } } };
    const { loadState, updateState } = await import("../storage/repository.js");
    const migrated = await loadState();
    for (const [key, value] of Object.entries(old)) {
      if (key === "settings") assert.deepEqual(migrated.settings, { ...value, autoSettleRecoveries: false });
      else if (key !== "schemaVersion") assert.deepEqual(migrated[key], value, key);
    }
    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.shopSpent, 0);
    assert.deepEqual(migrated.shopLevels, {});
    assert.equal(walletBalance(migrated), old.totalAsset);
    assert.deepEqual(stored.assetMeterState, migrated);
    assert.deepEqual(stored.assetMeterSessions, sessionsBefore);
    assert.deepEqual(await loadState(), migrated);
    const purchased = await updateState((s) => purchaseUpgrade(s, "notebook"));
    assert.equal(walletBalance(purchased), 12295.67);
    const reloaded = await loadState();
    assert.equal(incomeMultiplier(reloaded), 1.1);
    assert.equal(reloaded.shopSpent, 50);
    assert.deepEqual(reloaded.recentEntries, old.recentEntries);
  });
}

test("expanded catalog preserves legacy upgrades and supports every new item", () => {
  const legacy = { ...funded(20000000), totalVisits: 20000, shopSpent: 1300, shopLevels: { notebook: 2, workbench: 1, engine: 1 } };
  assert.equal(incomeMultiplier(legacy), 2.5);
  assert.equal(walletBalance(legacy), 19998700);
  assert.equal(SHOP_ITEMS.length, 9);
  assert.equal(new Set(SHOP_ITEMS.map(item => item.id)).size, SHOP_ITEMS.length);
  for (const item of SHOP_ITEMS.filter(item => !["notebook", "workbench", "engine"].includes(item.id))) {
    const next = purchaseUpgrade(legacy, item.id);
    assert.equal(next.shopLevels[item.id], 1);
    assert.equal(next.shopLevels.notebook, 2);
    assert.equal(next.totalAsset, legacy.totalAsset);
    assert.equal(walletBalance(next), Math.round((19998700 - item.price)*100)/100);
    assert.equal(incomeMultiplier(next), Math.round((2.5+item.bonus)*100)/100);
    assert.equal(next.shopPurchases[0].price, item.price);
    assert.equal(next.shopPurchases[0].level, 1);
    assert.deepEqual(legacy.shopPurchases, []);
  }
});
test("purchase history keeps only latest 30 transactions", () => {
  const oldHistory = Array.from({length:30}, (_,i)=>({itemId:"notebook",level:1,price:50,ts:i}));
  const next = purchaseUpgrade({...funded(),totalVisits:50,shopPurchases:oldHistory},"bookmark");
  assert.equal(next.shopPurchases.length,30);
  assert.equal(next.shopPurchases[0].itemId,"bookmark");
  assert.deepEqual(next.shopPurchases[1],oldHistory[0]);
  assert.equal(oldHistory.length,30);
});
