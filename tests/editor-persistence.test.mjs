import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../scripts/state.js';
import { createAnimation, updateAnimation, buildExportCSS } from '../scripts/animations.js';
import { normalizeAnimation, storageErrorMessage } from '../scripts/storage.js';
import { loadAnimationsFromRepository } from '../scripts/filesystem.js';

test('failed saves do not add or mutate library records; retries persist', async t => {
  const previous = {...state}, oldStorage=globalThis.sessionStorage;
  t.after(()=>{Object.assign(state,previous);globalThis.sessionStorage=oldStorage;});
  t.mock.method(console,'error',()=>{});
  const records=new Map();let full=true;
  globalThis.sessionStorage={getItem:k=>records.get(k)||null,setItem(k,v){if(full)throw new DOMException('full','QuotaExceededError');records.set(k,v);}};
  const a=normalizeAnimation({id:'persist-test',name:'Original',animationName:'original',css:'opacity:1;',keyframes:'from {opacity:0} to {opacity:1}'});
  state.animations=[a];
  assert.equal(await createAnimation({...a,name:'New'}),null);
  assert.equal(state.animations.length,1);
  assert.equal(await updateAnimation(a.id,{...a,name:'Updated'}),null);
  assert.equal(a.name,'Original');
  full=false;
  assert.equal((await updateAnimation(a.id,{...a,name:'Updated'})).name,'Updated');
  assert.equal(a.locallyEdited,true);
});

test('catalog reload preserves a successfully edited custom record', async t => {
  const previous={...state}, oldFetch=globalThis.fetch, oldStorage=globalThis.sessionStorage;
  t.after(()=>{Object.assign(state,previous);globalThis.fetch=oldFetch;globalThis.sessionStorage=oldStorage;});
  globalThis.sessionStorage={setItem(){},getItem(){return null;}};
  const original=normalizeAnimation({id:'catalog-custom',name:'Original',animationName:'example',updatedAt:100});
  const css=buildExportCSS(original);
  state.animations=[{...original,name:'Saved custom edit',locallyEdited:true,localPresent:false,updatedAt:200}];
  globalThis.fetch=async url=>url.includes('manifest.json')?{ok:true,json:async()=>({files:['example.css']})}:{ok:true,text:async()=>css};
  await loadAnimationsFromRepository();
  assert.equal(state.animations[0].name,'Saved custom edit');
  assert.equal(state.animations[0].locallyEdited,true);
});

test('storage messages distinguish full storage from blocked storage',()=>{
  assert.match(storageErrorMessage({name:'QuotaExceededError'},'IndexedDB'),/IndexedDB.*full/);
  assert.match(storageErrorMessage({name:'QuotaExceededError'},'localStorage'),/localStorage.*full/);
  assert.doesNotMatch(storageErrorMessage({name:'SecurityError'},'IndexedDB'),/is full/);
});
