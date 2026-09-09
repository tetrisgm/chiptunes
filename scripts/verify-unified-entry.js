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
  const calls=[],errors=[],events={},audioCalls=[];let currentDoc=null;
  const location={pathname:'/create',search:'',hash};
  // Normalize VM metadata into the compiler's realm, as in the single-realm browser.
  const sandbox={location,console,CT_CREATE:create,CT_MUSIC_LANGUAGE:{materialize:(gb,meta)=>language.materialize(gb,JSON.parse(JSON.stringify(meta)))},
    document:{body:{classList:{add(){}}}},
    Audio:{currentDoc:()=>currentDoc,playScore(){audioCalls.push('score');}},
    _unmountVisual(){},resize(){},_syncCreateRendering(){},_startEndlessRadio(){audioCalls.push('station');},
    history:{replaceState(_state,_title,url){location.pathname=url;}},
    CT_MUSIC_WORKSPACE:{open(...args){calls.push(args);return Promise.resolve();}},
    _readSharedDoc:()=>{const m=/(?:#|&)s=([^&]+)/.exec(location.hash);return m&&m[1];},
    _unpackDoc:unpack};
  sandbox.window={addEventListener(n,fn){events[n]=fn;},_toast:m=>errors.push(m)};
  vm.runInNewContext(entry,sandbox);
  return {calls,errors,events,audioCalls,location,open:sandbox._openCreate,
    handback:options=>sandbox.window._closeCreateReturn(options),setDoc:d=>{currentDoc=d;}};
}
function documentFixture(){
  const api=require('../src/api.js');
  return api.fromJSON({title:'Exact Unicode ♪',bpm:120,bars:2,grid:16,
    notes:[{lane:'Melody',step:0,note:'C5',len:4}]});
}
test('plain and source-share entries do not mount legacy UI or play; normal open has no initial',async()=>{
  for(const hash of ['', '#music', '#music=project']){
    const f=fixture(hash);await f.open();assert.equal(f.calls.length,1);assert.equal(f.calls[0].length,0);assert.deepEqual(f.audioCalls,[]);
  }
});
test('runtime handback starts station only for explicit listen:true',async()=>{
  for(const options of [undefined,{}, {listen:false}, {listen:true}]){
    const f=fixture();await f.open();assert.deepEqual(f.audioCalls,[]);
    f.handback(options);
    assert.deepEqual(f.audioCalls,options?.listen===true?['station','score']:[]);
    if(options?.listen===true)assert.equal(f.location.pathname,'/listen');
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
test('cold root/Create/share boot opens composition; only explicit Listen initializes listening',()=>{
  const marker=runtime.indexOf('// ----- BOOT ROUTE:');assert.ok(marker>=0);
  const start=runtime.indexOf('(function(){',marker),end=runtime.indexOf('\n})();',start);
  assert.ok(start>=0&&end>start);
  for(const [pathname,hash,expected] of [['/','','create'],['/create','','create'],['/','#s=exact','create'],['/','#music=project','create'],['/listen','','listen']]){
    const calls=[];
    const s={_RRR_BROADCAST:false,location:{pathname,hash,search:''},document:{body:{classList:{add(){}}}},
      _pathParts:p=>p.split('/').filter(Boolean),_readSharedDoc:()=>hash.startsWith('#s=')?'exact':null,
      _openCreate:()=>calls.push('create'),startAudio:()=>calls.push('listen'),_startEndlessRadio:()=>calls.push('listen'),
      history:{replaceState(){throw Error('Cold canonical routes must not redirect into a legacy route');}}};
    vm.runInNewContext(runtime.slice(start,end+'\n})();'.length),s);
    assert.deepEqual(calls,[expected],pathname+hash);
  }
  assert.match(runtime,/function syncRoute\(slug\)\{[\s\S]*?CT_MUSIC_WORKSPACE\.isOpen\(\)\)return;/);
});
test('navigation dispatch agrees with cold boot for root, Create and explicit Listen',()=>{
  const start=runtime.indexOf('function _productRouteFromPath('),end=runtime.indexOf('// ----- station entry:',start);
  assert.ok(start>=0&&end>start);
  for(const [path,expected] of [['/','create'],['/create','create'],['/listen','listen']]){
    const calls=[],s={window:{},_RRR_BROADCAST:false,_createEntryEpoch:0,_pathParts:p=>p.split('/').filter(Boolean),
      _musicWorkspaceOpen:()=>false,
      _readSharedDoc:()=>null,_openCreate:()=>calls.push('create'),_startEndlessRadio:()=>calls.push('listen'),
      history:{replaceState(){throw Error('Canonical route unexpectedly rewritten');}}};
    vm.runInNewContext(runtime.slice(start,end),s);
    assert.equal(s.window._productRouteTo(path),true);
    assert.deepEqual(calls,[expected],path);
  }
});
