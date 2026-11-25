import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../extension/', import.meta.url)));
const demo = `<aside style="padding:12px;background:#fff4cc;font:12px sans-serif">演示预览 · 使用虚拟样例数据，不连接你的真实账本。<button id="demoEarn" style="margin-top:8px">模拟浏览入账 +¥10 × 当前倍率</button></aside>
<script type="module">
import { defaultState, applyDeposit, buildWeekSeries, claimWeeklyReward } from '/core/ledger.js';
import { toggleDisplayCollectible } from '/core/journey.js';
import { purchaseUpgrade } from '/core/shop.js';
import { purchaseEstate, upgradeEstate } from '/core/estate.js';
import { createCompany, manageCompany } from '/core/company.js';
import { sellAtMarket } from '/core/market.js';
import { sellAsset, tradeAsset } from '/core/exchange.js';
import { investProject, exitProject } from '/core/investments.js';
import { sellCollectible, collectiblePrice } from '/core/collectibles.js';
import { ensureWeek } from '/core/weekly.js';
let state = {...defaultState(), totalAsset:5000, todayAsset:120, todayVisits:24,totalVisits:1000};
try { const saved=JSON.parse(localStorage.getItem('assetMeterDemoState')); if(saved) state={...state,...saved,settings:{...state.settings,...saved.settings}}; } catch {}
const persist=()=>localStorage.setItem('assetMeterDemoState',JSON.stringify(state));
window.chrome = {
 tabs:{create:async({url})=>{location.href=url;}},
 runtime: {getURL:relative=>'/'+relative,sendMessage:async ({type,itemId,...patch})=>{
 try {
 state=ensureWeek(state);
 if(type==='TOGGLE_DISPLAY_COLLECTIBLE') state=toggleDisplayCollectible(state,patch.id);
 if(type==='CLAIM_WEEKLY_REWARD') state=claimWeeklyReward(state,patch.taskId,patch.weekKey);
 if(type==='SET_SETTINGS') state={...state,settings:{...state.settings,...patch}};
 if(type==='MARKET_SELL') state=sellAtMarket(state,patch.id,patch.mode,patch.week,patch.price);
 if(type==='SELL_ASSET') state=sellAsset(state,patch.kind,patch.id,patch.price);
 if(type==='TRADE_ASSET') state=tradeAsset(state,patch.kind,patch.id,patch.target,patch.price,patch.targetPrice);
 if(type==='INVEST_PROJECT') state=investProject(state,patch.projectId,patch.units ?? NaN);
 if(type==='EXIT_PROJECT') state=exitProject(state,patch.id,patch.units ?? null);
 if(type==='SELL_COLLECTIBLE') state=sellAtMarket(state,patch.id,'market',patch.week,patch.price);
 if(type==='BUY_UPGRADE') state=purchaseUpgrade(state,itemId);
 if(type==='BUY_ESTATE') state=purchaseEstate(state,patch.host,patch.price);
 if(type==='UPGRADE_ESTATE') state=upgradeEstate(state,patch.host);
 if(type==='MANAGE_COMPANY') state=manageCompany(state,patch.id,patch.action,patch.value);
 if(type==='CREATE_COMPANY') state=createCompany(state,patch.name,patch.companyType,patch.headquarters);
 if(type==='DISMISS_ACHIEVEMENT') state={...state,pendingAchievement:null};
 persist();
 return {ok:true,state:structuredClone(state),week:buildWeekSeries(state),features:{companies:true,companyManagement:true,companyExpansion:true,companyTeams:true}};
 } catch(e){return {ok:false,error:e.message};}
 },openOptionsPage:()=>{location.href='/options/index.html';}},
 storage:{onChanged:{addListener:()=>{}}}
};
document.querySelector('#demoEarn').insertAdjacentHTML('afterend',' <select id="demoKind"><option value="first_host">新域名 · 15秒</option><option value="seen_path">重访路径 · 15秒</option><option value="new_path">新路径 · 15秒</option><option value="deep">深度阅读 · 60秒</option><option value="extended">沉浸阅读 · 120秒</option></select> <button id="demoTasks">填满任务进度（仅演示）</button>');
document.querySelector('#demoEarn').textContent='模拟一次有效浏览';
if(location.pathname.startsWith('/collection/')) {
 const siteSampleButton=document.createElement('button');
 siteSampleButton.textContent='放入一件网站专属藏品（仅演示）';
 document.querySelector('#demoTasks').after(siteSampleButton);
 siteSampleButton.onclick=()=>{
  const item={id:crypto.randomUUID(),type:'chip',title:'Page Journey · 把浏览变成一段旅程',
   host:'github.com',siteName:'GitHub',source:'https://github.com/lhf2018/web-click-vault',
   speciesKey:'github.com/lhf2018/web-click-vault:chip',collectibleName:'GitHub · Page Journey · 星光电路',
   color:'#43675c',foundLevel:5,qualityPercent:12,day:state.dayKey,foundAt:Date.now(),soldAt:null};
  item.value=collectiblePrice(item.type,item.foundLevel,item.qualityPercent);
  state={...state,collectibles:[item,...(state.collectibles||[])]};
  refreshDemo();
 };
 const sampleButton=document.createElement('button');
 sampleButton.textContent='放入 6 件网页组件藏品（仅演示）';
 document.querySelector('#demoTasks').after(sampleButton);
 sampleButton.onclick=()=>{
  const samples=[
   {id:'sample-badge',type:'badge',webComponent:'icon',collectibleName:'Wikipedia · 站点字母印',title:'百科全书的入口',host:'wikipedia.org',source:'https://www.wikipedia.org/',color:'#3d7c68',foundLevel:5,qualityPercent:12},
   {id:'sample-bookmark',type:'bookmark',webComponent:'article',collectibleName:'阅读小站 · 排版活字片',title:'写给深夜读者的一封信',host:'example.com',source:'https://example.com/',color:'#9a6848',foundLevel:5,qualityPercent:-10},
   {id:'sample-chip',type:'chip',webComponent:'code',collectibleName:'GitHub · 代码块标本',title:'开源工坊',host:'github.com',source:'https://github.com/',color:'#43675c',foundLevel:10,qualityPercent:15},
   {id:'sample-search',type:'badge',webComponent:'search',collectibleName:'探索小站 · 搜索框胶囊',title:'从好奇出发',host:'search.example.com',color:'#477d9c',foundLevel:5,qualityPercent:0},
   {id:'sample-media',type:'badge',webComponent:'media',collectibleName:'声音小站 · 播放键琥珀',title:'午后的旋律',host:'music.example.com',color:'#9b546c',foundLevel:5,qualityPercent:10},
   {id:'sample-navigation',type:'badge',webComponent:'navigation',collectibleName:'旅人小站 · 导航栏切片',title:'下一站风景',host:'travel.example.com',color:'#697c47',foundLevel:5,qualityPercent:0},
  ].map(item=>({...item,value:collectiblePrice(item.type,item.foundLevel,item.qualityPercent),day:state.dayKey,foundAt:Date.now(),soldAt:null}));
  state={...state,collectibles:[...samples,...(state.collectibles||[]).filter(item=>!samples.some(sample=>sample.id===item.id))]};
  refreshDemo();
 };
}
document.querySelector('#demoEarn').onclick=()=>{
 const kind=document.querySelector('#demoKind').value;
 const companyDemo=location.pathname.startsWith('/company/');
 const host=companyDemo ? 'demo'+(state.totalVisits+1)+'.example.com' : state.estates?.[0]?.host || 'demo'+(state.totalVisits+1)+'.example.com';
 state=applyDeposit(state,{amount:10,url:'https://'+host+'/article/'+(state.totalVisits+1),host,reason:'模拟浏览',pageElements:{title:'互联网漫游 · 第 '+(state.totalVisits+1)+' 站',color:'#39785c',hasCode:kind==='extended'},metrics:{freshKind:kind,dwellMs:kind==='extended'?120000:kind==='deep'?60000:15000}});
 refreshDemo();
};
document.querySelector('#demoTasks').onclick=()=>{
 state=ensureWeek(state);
 state={...state,weekly:{...state.weekly,hosts:['a.test','b.test','c.test','d.test','e.test'],deepReads:5,days:['演示日1','演示日2','演示日3']}};
 refreshDemo();
};
function refreshDemo(){persist();location.hash=String(Date.now());window.dispatchEvent(new Event('demoUpdate'));}
await import(['/exchange/','/investments/'].some(p=>location.pathname.startsWith(p)) ? '/finance/finance.js' : location.pathname.startsWith('/collection/') ? '/collection/collection.js' : location.pathname.startsWith('/weekly/') ? '/weekly/weekly.js' : location.pathname.startsWith('/overview/') ? '/overview/overview.js' : location.pathname.startsWith('/achievements/') ? '/achievements/achievements.js' : location.pathname.startsWith('/company/') ? '/company/company.js' : location.pathname.startsWith('/estate/') ? '/estate/estate.js' : location.pathname.startsWith('/options/') ? '/options/options.js' : location.pathname.startsWith('/shop/') ? '/shop/shop.js' : '/popup/popup.js');
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
 if(relative==='estate/index.html')data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="estate.js"></script>',''));
 if(relative==='company/index.html')data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="company.js"></script>',''));
 for (const page of ['overview','achievements','weekly','collection']) if(relative===page+'/index.html') data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="'+page+'.js"></script>',''));
 if(relative==='popup/popup.js')data=Buffer.from(data.toString()+`\nwindow.addEventListener('demoUpdate',refresh);`);
 if(['exchange','investments'].some(page=>relative===page+'/index.html')) data=Buffer.from(data.toString().replace('<body>','<body>'+demo).replace('<script type="module" src="../finance/finance.js"></script>',''));
 const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[path.extname(file)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'}).end(data);
 }catch{res.writeHead(404).end('Not found');}
});
const port = Number(process.env.PAGE_JOURNEY_PREVIEW_PORT || 4173);
server.listen(port,'127.0.0.1',()=>console.log(`Shop preview: http://127.0.0.1:${port}`));


