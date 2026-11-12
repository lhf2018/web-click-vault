import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyDeposit, claimWeeklyReward } from '../core/ledger.js';
import { SHOP_ITEMS, unlockInfo, purchaseUpgrade, depositMultiplier, incomeMultiplier } from '../core/shop.js';
import { ensureWeek, recordWeeklyVisit, taskProgress, WEEKLY_TASKS, weekKey } from '../core/weekly.js';
const item = id => SHOP_ITEMS.find(item=>item.id===id);
const visit = (host,dwellMs=60000) => ({amount:5,url:`https://${host}/article`,metrics:{dwellMs,freshKind:'default'}});

test('unlock thresholds require both cumulative earnings and visits and grandfather owned gear',()=>{
 const state=defaultState();
 assert.equal(unlockInfo(state,item('notebook')).unlocked,true);
 assert.equal(unlockInfo({...state,totalAsset:499.99,totalVisits:50},item('bookmark')).unlocked,false);
 assert.equal(unlockInfo({...state,totalAsset:500,totalVisits:49},item('bookmark')).unlocked,false);
 assert.equal(unlockInfo({...state,totalAsset:500,totalVisits:50},item('bookmark')).unlocked,true);
 assert.equal(unlockInfo({...state,totalAsset:1000000,totalVisits:0},item('bookmark')).unlocked,false);
 assert.equal(unlockInfo({...state,totalVisits:15000},item('portal')).unlocked,false);
 assert.equal(unlockInfo({...state,totalAsset:10000000,totalVisits:14999},item('portal')).unlocked,false);
 assert.equal(unlockInfo({...state,totalAsset:10000000,totalVisits:15000},item('portal')).unlocked,true);
 assert.equal(unlockInfo({...state,totalAsset:250,totalVisits:25},item('bookmark')).progress,0.5);
 assert.throws(()=>purchaseUpgrade({...state,totalAsset:500},'compass'),/尚未解锁/);
 const legacy={...state,totalAsset:1000,shopLevels:{portal:1}};
 assert.equal(unlockInfo(legacy,item('portal')).unlocked,true);
 assert.equal(incomeMultiplier(legacy),11);
 const upgraded=purchaseUpgrade({...legacy,totalAsset:50000,shopSpent:45000},'notebook');
 assert.equal(upgraded.shopLevels.portal,1);
});
test('each conditional effect observes its threshold and regular bonuses never decrease',()=>{
 const cases=[['bookmark',{freshKind:'seen_path'},{freshKind:'new_path'}],
 ['compass',{freshKind:'first_host'},{freshKind:'new_path'}],
 ['observatory',{freshKind:'new_path'},{freshKind:'seen_path'}],
 ['workbench',{dwellMs:15000},{dwellMs:14999}],
 ['library',{dwellMs:60000},{dwellMs:59999}],
 ['reactor',{dwellMs:120000},{dwellMs:119999}],
 ['portal',{freshKind:'first_host'},{freshKind:'seen_path'}]];
 for(const [id,match,miss] of cases){
  const state={...defaultState(),shopLevels:{[id]:2}};
  const base=incomeMultiplier(state);
  assert.equal(depositMultiplier(state,miss).multiplier,base,id);
  assert.equal(depositMultiplier(state,match).multiplier,Math.round((base+item(id).extra*2)*100)/100,id);
 }
 const state={...defaultState(),shopLevels:{workbench:1,library:1,reactor:1}};
 const result=applyDeposit(state,visit('example.com',120000),{});
 assert.equal(result.recentEntries[0].extras.length,3);
 assert.equal(result.lastFormula.multiplier,10.9);
 assert.equal(result.todayAsset,54.5);
});
test('week uses local Monday boundaries across years and resets only weekly progress',()=>{
 assert.equal(weekKey(new Date(2027,0,3,23,59)),'2026-12-28');
 assert.equal(weekKey(new Date(2027,0,4,0,0)),'2027-01-04');
 let state={...defaultState(),totalAsset:800,shopLevels:{notebook:3}};
 state=recordWeeklyVisit(state,visit('a.test'),new Date(2027,0,3,23,59));
 const next=ensureWeek(state,new Date(2027,0,4));
 assert.deepEqual(next.weekly.hosts,[]);
 assert.equal(next.weekly.deepReads,0);
 assert.equal(next.totalAsset,800);
 assert.equal(next.shopLevels.notebook,3);
});
test('weekly tasks count qualified distinct hosts, reading and active dates without retroactive history',()=>{
 let state=defaultState();
 const date=new Date(2026,10,9,12);
 state=recordWeeklyVisit(state,visit('a.test',14999),date);
 assert.equal(state.weekly.days.length,0);
 for(let i=0;i<8;i++)state=recordWeeklyVisit(state,visit('www.a.test'),date);
 assert.deepEqual(state.weekly.hosts,['a.test']);
 assert.equal(state.weekly.deepReads,5);
 assert.equal(state.weekly.days.length,1);
 for(let i=0;i<8;i++)state=recordWeeklyVisit(state,visit(`site${i}.test`,15000),new Date(2026,10,10+i%2,12));
 assert.equal(taskProgress(state,WEEKLY_TASKS[0]),5);
 assert.equal(taskProgress(state,WEEKLY_TASKS[2]),3);
 assert.deepEqual(defaultState().weekly.hosts,[]);
});
test('rewards credit wallet and daily history exactly once without visits, effects or task progress',()=>{
 let state={...defaultState(),shopLevels:{engine:10},totalAsset:290};
 for(let i=0;i<5;i++)state=applyDeposit(state,visit(`site${i}.test`));
 const before=structuredClone(state);
 const next=claimWeeklyReward(state,'explorer',state.weekly.weekKey);
 assert.equal(next.totalAsset,before.totalAsset+100);
 assert.equal(next.todayAsset,before.todayAsset+100);
 assert.equal(next.totalVisits,before.totalVisits);
 assert.equal(next.todayVisits,before.todayVisits);
 assert.equal(next.dailyHistory[next.dayKey].asset,next.todayAsset);
 assert.deepEqual(next.weekly.hosts,before.weekly.hosts);
 assert.equal(next.weekly.deepReads,before.weekly.deepReads);
 assert.equal(next.recentEntries[0].kind,'task_reward');
 assert.equal(next.recentEntries[0].multiplier,1);
 assert.throws(()=>claimWeeklyReward(next,'explorer'),/已经领取/);
 assert.throws(()=>claimWeeklyReward(defaultState(),'reader'),/尚未完成/);
 assert.throws(()=>claimWeeklyReward(next,'unknown'),/任务不存在/);
 assert.throws(()=>claimWeeklyReward(next,'reader','2020-01-01'),/已刷新/);
});
test('simultaneous reward claims pay only once via repository queue',async()=>{
 let state=defaultState();
 for(let i=0;i<5;i++)state=applyDeposit(state,visit(`site${i}.test`));
 const before=state.totalAsset;
 let stored={assetMeterState:state};
 globalThis.chrome={storage:{local:{get:async key=>structuredClone({[key]:stored[key]}),set:async patch=>{stored={...stored,...structuredClone(patch)};}}}};
 const {updateState,loadState}=await import('../storage/repository.js');
 const results=await Promise.allSettled([updateState(s=>claimWeeklyReward(s,'explorer')),updateState(s=>claimWeeklyReward(s,'explorer'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await loadState()).totalAsset,before+100);
});
test('duplicate navigation settlements do not advance tasks or trigger a second payout',async()=>{
 let stored={assetMeterState:defaultState()};
 globalThis.chrome={storage:{local:{get:async key=>structuredClone({[key]:stored[key]}),set:async patch=>{stored={...stored,...structuredClone(patch)};}}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const {settleSessionData}=await import('../background/session-tracker.js');
 const session={url:'https://unique.test/reading',dwellAccumMs:60000,dwellSource:'probe'};
 await settleSessionData(session);
 const first=structuredClone(stored.assetMeterState);
 await settleSessionData(session);
 assert.equal(stored.assetMeterState.totalAsset,first.totalAsset);
 assert.equal(stored.assetMeterState.weekly.deepReads,1);
 assert.equal(stored.assetMeterState.totalVisits,1);
});

