import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../extension/', import.meta.url)));
const demo = `<aside style="padding:12px;background:#fff4cc;font:12px sans-serif">演示预览 · 使用虚拟样例数据，不连接你的真实账本。<button id="demoEarn" style="margin-top:8px">模拟浏览入账 +¥10 × 当前倍率</button></aside>
<script type="module">
import { defaultState, applyDeposit, buildWeekSeries, claimWeeklyReward } from '/core/ledger.js';
import { purchaseUpgrade } from '/core/shop.js';
import { ensureWeek } from '/core/weekly.js';
let state = {...defaultState(), totalAsset:5000, todayAsset:120, todayVisits:24,totalVisits:1000};
try { const saved=JSON.parse(localStorage.getItem('assetMeterDemoState')); if(saved) state={...state,...saved,settings:{...state.settings,...saved.settings}}; } catch {}
const persist=()=>localStorage.setItem('assetMeterDemoState',JSON.stringify(state));
window.chrome = {
 tabs:{create:async({url})=>{location.href=url;}},
 runtime: {getURL:relative=>'/'+relative,sendMessage:async ({type,itemId,...patch})=>{
 try {
 state=ensureWeek(state);
 if(type==='CLAIM_WEEKLY_REWARD') state=claimWeeklyReward(state,patch.taskId,patch.weekKey);
 if(type==='SET_SETTINGS') state={...state,settings:{...state.settings,...patch}};
 if(type==='BUY_UPGRADE') state=purchaseUpgrade(state,itemId);
 if(type==='DISMISS_ACHIEVEMENT') state={...state,pendingAchievement:null};
 persist();
 return {ok:true,state:structuredClone(state),week:buildWeekSeries(state)};
 } catch(e){return {ok:false,error:e.message};}
 },openOptionsPage:()=>{location.href='/options/index.html';}},
 storage:{onChanged:{addListener:()=>{}}}
};
document.querySelector('#demoEarn').insertAdjacentHTML('afterend',' <select id="demoKind"><option value="first_host">新域名 · 15秒</option><option value="seen_path">重访路径 · 15秒</option><option value="new_path">新路径 · 15秒</option><option value="deep">深度阅读 · 60秒</option><option value="extended">沉浸阅读 · 120秒</option></select> <button id="demoTasks">填满任务进度（仅演示）</button>');
document.querySelector('#demoEarn').textContent='模拟一次有效浏览';
document.querySelector('#demoEarn').onclick=()=>{
 const kind=document.querySelector('#demoKind').value;
 const host='demo'+(state.totalVisits+1)+'.example.com';
 state=applyDeposit(state,{amount:10,url:'https://'+host+'/article',host,reason:'模拟浏览',metrics:{freshKind:kind,dwellMs:kind==='extended'?120000:kind==='deep'?60000:15000}});
 refreshDemo();
};
document.querySelector('#demoTasks').onclick=()=>{
 state=ensureWeek(state);
 state={...state,weekly:{...state.weekly,hosts:['a.test','b.test','c.test','d.test','e.test'],deepReads:5,days:['演示日1','演示日2','演示日3']}};
 refreshDemo();
};
function refreshDemo(){persist();location.hash=String(Date.now());window.dispatchEvent(new Event('demoUpdate'));}
await import(location.pathname.startsWith('/options/') ? '/options/options.js' : location.pathname.startsWith('/shop/') ? '/shop/shop.js' : '/popup/popup.js');
</script>`;
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1');
 const relative=url.pathname==='/'?'popup/index.html':decodeURIComponent(url.pathname).slice(1);
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 let data=await readFile(file);
 if(relative==='popup/index.html')data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="popup.js"></script>',''));
 if(relative==='options/index.html')data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="options.js"></script>',''));
 if(relative==='shop/index.html')data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="shop.js"></script>',''));
 if(relative==='popup/popup.js')data=Buffer.from(data.toString()+`\nwindow.addEventListener('demoUpdate',refresh);`);
 const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'}).end(data);
 }catch{res.writeHead(404).end('Not found');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Shop preview: http://127.0.0.1:4173'));


