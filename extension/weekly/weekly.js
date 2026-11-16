import { WEEKLY_TASKS, ensureWeek, taskProgress } from '../core/weekly.js';
const $=id=>document.getElementById(id);
const money=value=>'¥'+(Number(value)||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
let state=null,busy=false,revision=0;
function render() {
  if (!state) return;
  $('weekLabel').textContent = `本周起始 ${state.weekly.weekKey}`;
  $('weeklyTasks').replaceChildren();
  for (const task of WEEKLY_TASKS) {
    const progress = taskProgress(state,task);
    const claimed = state.weekly.claimed.includes(task.id);
    const row = document.createElement('article');
    row.className='task-card';
    row.innerHTML=`<div class="task-top"><h3>${task.title}</h3><strong>+${money(task.reward)}</strong></div><p>${task.description}</p><progress value="${progress}" max="${task.target}" aria-label="${task.title}进度"></progress><small>${progress} / ${task.target}</small>`;
    const button=document.createElement('button');
    button.type='button';button.className='buy';
    button.textContent=claimed?'本周已领取':progress>=task.target?'领取奖励':'探索进行中';
    button.disabled=busy||claimed||progress<task.target;
    button.addEventListener('click',()=>claimTask(task));
    row.append(button);$('weeklyTasks').append(row);
  }
}
async function refresh() {
 const current=++revision;
 try {
 const response=await chrome.runtime.sendMessage({type:'GET_STATE'});
 if(!response?.ok)throw new Error(response?.error||'无法读取账本');
 if(current!==revision)return;
 state=ensureWeek(response.state);render();
 if($('status').textContent==='正在读取账本…')$('status').textContent='本周任务进度自动记录，达标后可领取奖励。';
 }catch(error){$('status').textContent=error.message+'，请重新加载扩展后再试。';}
}
async function claimTask(task) {
  if(busy)return;
  busy=true;++revision;render();
  try {
    const response=await chrome.runtime.sendMessage({type:'CLAIM_WEEKLY_REWARD',taskId:task.id,weekKey:state.weekly.weekKey});
    if(!response?.ok)throw new Error(response?.error||'领取失败');
    state=ensureWeek(response.state);
    $('status').textContent=`${task.title}奖励 ${money(task.reward)} 已入账。`;
  } catch(error){$('status').textContent=error.message;}
  finally{busy=false;await refresh();}
}

chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.assetMeterState&&!busy)refresh();});
window.addEventListener('demoUpdate',refresh);
refresh();
