#!/usr/bin/env node
'use strict';
// Source-loaded entry functions with explicit browser/audio stubs; no dist/build.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const runtime=fs.readFileSync(require.resolve('../src/runtime.js'),'utf8');
require('../src/api.js');
const create=require('../src/create.js');
const language=require('../src/music-language.js');
const entry=runtime.slice(runtime.indexOf('var _createStandalone=false;'),runtime.indexOf('window._openCreate=_openCreate;'));
function fixture(hash='',unpack=async s=>s){
  const calls=[],errors=[],events={};let currentDoc=null;
  const location={pathname:'/create',search:'',hash};
  // Normalize VM metadata into the compiler's realm, as in the single-realm browser.
  const sandbox={location,console,CT_CREATE:create,CT_MUSIC_LANGUAGE:{materialize:(gb,meta)=>language.materialize(gb,JSON.parse(JSON.stringify(meta)))},
    document:{body:{classList:{add(){}}}},
    Audio:{currentDoc:()=>currentDoc,playScore(){throw Error('Unexpected playback');}},
    CT_MUSIC_WORKSPACE:{open(...args){calls.push(args);return Promise.resolve();}},
    _readSharedDoc:()=>{const m=/(?:#|&)s=([^&]+)/.exec(location.hash);return m&&m[1];},
    _unpackDoc:unpack};
  sandbox.window={addEventListener(n,fn){events[n]=fn;},_toast:m=>errors.push(m)};
  vm.runInNewContext(entry,sandbox);
  return {calls,errors,events,location,open:sandbox._openCreate,setDoc:d=>{currentDoc=d;}};
}
function documentFixture(){
  const api=require('../src/api.js');
  return api.fromJSON({title:'Exact Unicode ♪',bpm:120,bars:2,grid:16,
    notes:[{lane:'Melody',step:0,note:'C5',len:4}]});
}
test('plain and source-share entries do not mount legacy UI or play; normal open has no initial',async()=>{
  for(const hash of ['', '#music', '#music=project']){
    const f=fixture(hash);await f.open();assert.equal(f.calls.length,1);assert.equal(f.calls[0].length,0);
  }
});
test('explicit document materializes exact native GB and metadata',async()=>{
  const doc=documentFixture(),f=fixture('#s='+doc);await f.open();
  assert.deepEqual(f.errors,[]);assert.equal(f.calls.length,1);
  const input=f.calls[0][0];assert.equal(input.explicit,true);
  assert.deepEqual(language.compile(input.source).gb,JSON.parse(JSON.stringify(create.songOf(doc).gb)));
  assert.ok(input.source.includes(create.songOf(doc).title));
});
test('current song remains recovery-first fallback, not explicit import',async()=>{
  const doc=documentFixture(),f=fixture();f.setDoc(doc);await f.open();
  assert.deepEqual(f.calls[0][0].gb,create.songOf(doc).gb);
  assert.equal(f.calls[0][0].explicit,undefined);
  const blank=fixture();blank.setDoc(doc);await blank.open(true);assert.equal(blank.calls[0].length,0);
});
test('invalid and failed decompression do not open or replace a project',async()=>{
  for(const unpack of [async()=>null,async()=>{throw Error('Invalid compressed document');}]){
    const f=fixture('#s=zbad',unpack);await f.open();assert.equal(f.calls.length,0);assert.equal(f.errors.length,1);
  }
});
test('late decoding after navigation or newer entry cannot import',async()=>{
  const doc=documentFixture();
  for(const mode of ['route','event','new']){
    let resolve;const f=fixture('#s=delayed',()=>new Promise(r=>{resolve=r;}));const pending=f.open();
    if(mode==='route')f.location.pathname='/radio';
    if(mode==='event')f.events.popstate();
    if(mode==='new'){f.location.hash='';await f.open();}
    resolve(doc);await pending;assert.equal(f.calls.length,mode==='new'?1:0);
  }
});
test('valid empty native document is supported without composition',async()=>{
  const state=create.docState(documentFixture());state.cells=[];
  const doc=create.docFromState(state),song=create.songOf(doc);assert.ok(song);assert.deepEqual(song.gb.notes,[]);
  const f=fixture('#s='+doc);await f.open();assert.deepEqual(f.errors,[]);
  assert.deepEqual(language.compile(f.calls[0][0].source).gb,JSON.parse(JSON.stringify(song.gb)));
});
test('actual unpacker accepts bare, raw and compressed legacy links',async()=>{
  const context={Promise,Uint8Array,TextDecoder,Response,DecompressionStream,atob};
  const from=runtime.indexOf('function _unb64u('),to=runtime.indexOf('// Packed ahead of the click:',from);
  vm.runInNewContext(runtime.slice(from,to),context);
  const doc=documentFixture(),packed=require('node:zlib').deflateRawSync(Buffer.from(doc)).toString('base64url');
  for(const value of [doc,'r'+doc,'z'+packed]){
    const f=fixture('#s='+value,context._unpackDoc);await f.open();
    assert.deepEqual(f.errors,[]);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0].explicit,true);
  }
});
test('boot dispatches Create and root song links before startAudio; workspace owns route',()=>{
  const start=runtime.indexOf("if(head==='create'||(head===''&&_readSharedDoc()))");
  assert.ok(start>0);const branch=runtime.slice(start,runtime.indexOf("if(head==='get')",start));
  assert.ok(!branch.includes('startAudio('));assert.ok(branch.includes('_openCreate(); return;'));
  assert.match(runtime,/function syncRoute\(slug\)\{[\s\S]*?CT_MUSIC_WORKSPACE\.isOpen\(\)\)return;/);
});
