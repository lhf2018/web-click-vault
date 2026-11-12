import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../options/options.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(sendMessage){
 const elements=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,{checked:false,style:{},addEventListener(event,fn){this[event]=fn;},appendChild(){}});return elements.get(id);};
 vm.runInNewContext(source,{document:{getElementById:get,createElement:()=>({})},chrome:{runtime:{sendMessage}},setTimeout,confirm:()=>false});
 return get;
}
const response=settings=>({ok:true,state:{settings},week:[]});
test('checkbox remains enabled after save and sends only changed preference',async()=>{
 let saved={autoSettleRecoveries:false};
 const messages=[];
 const get=setup(async message=>{
 messages.push(message);
 if(message.type==='SET_SETTINGS')saved={...saved,autoSettleRecoveries:message.autoSettleRecoveries};
 return response({...saved});
 });
 await flush();
 get('autoSettleRecoveries').checked=true;
 await get('autoSettleRecoveries').change();
 assert.equal(get('autoSettleRecoveries').checked,true);
 assert.deepEqual(structuredClone(messages[1]),{type:'SET_SETTINGS',autoSettleRecoveries:true});
 assert.equal(get('settingsHint').textContent,'设置已保存。');
});
test('old background response reports reload requirement instead of silently unchecking',async()=>{
 const get=setup(async()=>response({autoSettleRecoveries:false}));
 await flush();
 get('autoSettleRecoveries').checked=true;
 await get('autoSettleRecoveries').change();
 assert.equal(get('autoSettleRecoveries').checked,true);
 assert.match(get('settingsHint').textContent,/旧版本/);
});
test('late initial load cannot undo a user choice',async()=>{
 let finishInitial;
 const get=setup(message=>message.type==='GET_STATE'?new Promise(resolve=>{finishInitial=resolve;}):Promise.resolve(response({autoSettleRecoveries:true})));
 get('autoSettleRecoveries').checked=true;
 await get('autoSettleRecoveries').change();
 finishInitial(response({autoSettleRecoveries:false}));
 await flush();
 assert.equal(get('autoSettleRecoveries').checked,true);
});
