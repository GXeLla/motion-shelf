import test from 'node:test';
import assert from 'node:assert/strict';
import { connectProject, validateProjectFolder } from '../scripts/filesystem.js';
import { state } from '../scripts/state.js';

test('wrong project folder stops after one picker and never scans it', async t => {
  const oldWindow=globalThis.window, previous={...state};
  t.after(()=>{globalThis.window=oldWindow;Object.assign(state,previous);});
  state.projectHandle=null;
  let picks=0,reads=0;
  globalThis.window={showDirectoryPicker:async()=>{picks++;return {name:'unrelated',getFileHandle(){reads++;throw Error();}};}};
  await assert.rejects(connectProject(),/Wrong folder/);
  assert.equal(picks,1); assert.equal(reads,0); assert.equal(state.projectHandle,null);
});

test('project name alone is insufficient; expected files are required', async()=>{
  await assert.rejects(validateProjectFolder({name:'motion-shelf',async getFileHandle(){throw new Error('missing');}}),/Wrong folder/);
  const file=text=>({getFile:async()=>({text:async()=>text})});
  await validateProjectFolder({name:'motion-shelf',getFileHandle:async()=>file('<title>Motion Shelf</title><div id="animationGrid"></div>'),getDirectoryHandle:async()=>({getFileHandle:async()=>file('{"files":["example.css"]}')})});
});
