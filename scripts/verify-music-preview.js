'use strict';
// Fake clocks/workers exercise lifecycle deterministically. Worker parity uses
// the real bundled compiler in an isolated VM, with only allowlisted imports.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const L=require('../src/music-language.js');
const controllerSource=fs.readFileSync(path.resolve(__dirname,'../src/music-preview.js'),'utf8');
const workerSource=fs.readFileSync(path.resolve(__dirname,'../src/music-preview-worker.js'),'utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const song='song({tempo:128,bars:4})\npattern("p",notes("C4 . E4 G4").stepsPerBar(8))\ntrack("lead").instrument("p0").play("p",{repeat:4})\n';
function input(source=song,draftEpoch=1,projectId='project-a'){return {source,projectId,draftEpoch};}
function clock(){
  let now=0,id=0;const tasks=new Map();
  return {tasks,setTimeout(fn,delay){const key=++id;tasks.set(key,{at:now+delay,fn});return key;},clearTimeout(key){tasks.delete(key);},tick(ms){
    const end=now+ms;let count=0;
    while(true){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;
      assert(++count<10000,'bounded fake timer work');now=next[1].at;tasks.delete(next[0]);next[1].fn();
    }now=end;
  }};
}
function fixture(options={}){
  const timers=clock(),workers=[],results=[],pending=[],errors=[];
  class Worker{
    constructor(url){if(options.constructError)throw Error('fixture startup');this.url=url;this.terminated=false;workers.push(this);assert.equal(workers.filter(w=>!w.terminated).length,1,'at most one live worker');}
    postMessage(value){if(options.postError)throw Error('fixture clone');this.sent=structuredClone(value);if(options.onPost)options.onPost(this);}
    terminate(){this.terminated=true;}
    reply(extra={}){this.onmessage?.({data:Object.assign({sequence:this.sent.sequence,projectId:this.sent.projectId,draftEpoch:this.sent.draftEpoch,compiled:L.compile(this.sent.source)},extra)});}
  }
  const context=vm.createContext({Worker,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout});
  vm.runInContext(controllerSource,context);
  const api=context.CT_MUSIC_PREVIEW;
  const controller=api.create({workerUrl:options.workerUrl,onResult:r=>results.push(r),onPending:r=>pending.push(r),onError:r=>errors.push(r)});
  return {api,controller,timers,workers,results,pending,errors};
}
function workerVM(search=''){
  const imports=[],messages=[];
  const context=vm.createContext({postMessage:value=>messages.push(structuredClone(value))},{codeGeneration:{strings:false,wasm:false}});
  context.self=context;
  context.location={search};
  context.importScripts=(...files)=>{
    for(const file of files){const base=file.split('?')[0];assert(['./gb-hardware.js','./gb-kits.js','./music-language.js'].includes(base),'only bundled compiler imports');imports.push(file);
      vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',base),'utf8'),context,{filename:file});}
  };
  vm.runInContext(workerSource,context,{filename:'music-preview-worker.js'});
  return {imports,messages,send:value=>context.onmessage({data:structuredClone(value)})};
}
test('250ms debounce coalesces latest exact input and captures immutable identity',()=>{
  const f=fixture(),a=input();f.controller.schedule(a);a.source='mutated';f.timers.tick(249);assert.equal(f.workers.length,0);
  const b=input(song+'// latest',2);const scheduled=f.controller.schedule(b);b.draftEpoch=99;
  f.timers.tick(249);assert.equal(f.workers.length,0);f.timers.tick(1);
  assert.equal(f.workers[0].sent.source,song+'// latest');assert.equal(f.workers[0].sent.draftEpoch,2);
  f.pending[1].source='mutated callback';f.workers[0].reply();
  assert.equal(f.results[0].sequence,scheduled.sequence);assert.equal(f.results[0].source,song+'// latest');
  assert(f.workers[0].terminated);assert.equal(f.timers.tasks.size,0);
});
test('superseded in-flight worker terminates; late captured handlers cannot publish',()=>{
  const f=fixture();f.controller.schedule(input());f.timers.tick(250);
  const old=f.workers[0],late=old.onmessage,oldMessage={...old.sent,compiled:L.compile(song)};
  f.controller.schedule(input(song+'// next',2));assert(old.terminated);f.timers.tick(250);
  late({data:oldMessage});assert.equal(f.results.length,0);f.workers[1].reply();assert.equal(f.results.length,1);
});
test('foreign sequence/project/epoch responses ignored without refreshing timeout',()=>{
  const f=fixture();f.controller.schedule(input());f.timers.tick(250);const w=f.workers[0];
  w.reply({sequence:0});w.reply({projectId:'other'});w.reply({draftEpoch:999});assert.equal(f.results.length,0);
  f.timers.tick(2999);assert.equal(f.errors.length,0);f.timers.tick(1);
  assert.equal(f.errors[0].code,'timeout');assert(w.terminated);assert.equal(f.timers.tasks.size,0);
});
test('cancel clears debounce and active work without callbacks; next schedule recovers',()=>{
  const f=fixture();f.controller.schedule(input());f.controller.cancel();f.timers.tick(10000);assert.equal(f.workers.length,0);
  f.controller.schedule(input());f.timers.tick(250);const w=f.workers[0],late=w.onmessage;
  f.controller.cancel();late({data:{...w.sent,compiled:L.compile(song)}});f.timers.tick(10000);
  assert(w.terminated);assert.equal(f.results.length,0);assert.equal(f.errors.length,0);
  f.controller.schedule(input());f.timers.tick(250);f.workers[1].reply();assert.equal(f.results.length,1);
});
test('destroy is final, idempotent and leaves no timers or worker',()=>{
  const f=fixture();f.controller.schedule(input());f.timers.tick(250);f.controller.destroy();f.controller.destroy();
  assert.equal(f.controller.schedule(input()).code,'destroyed');f.timers.tick(10000);
  assert(f.workers.every(w=>w.terminated));assert.equal(f.timers.tasks.size,0);assert.equal(f.errors.length,0);
});
test('compiler source bounds and request identities fail before creating workers',()=>{
  assert.equal(L.LIMITS.source,1048576);assert.equal(L.LIMITS.events,50000);assert.equal(L.LIMITS.frames,216000);
  for(const value of [null,input('x'.repeat(L.LIMITS.source+1)),input(song,-1),input(song,1.1),input(song,Infinity),input(song,1,''),input(song,1,'p'.repeat(129)),{...input(),source:()=>{}}]){
    const f=fixture();assert.equal(f.controller.schedule(value).code,'invalid-input');f.timers.tick(10000);assert.equal(f.workers.length,0);
  }
  const f=fixture();assert(f.controller.schedule(input(' '.repeat(L.LIMITS.source))).ok);f.controller.cancel();
});
test('invalid replacement cancels old work instead of allowing stale publish',()=>{
  const f=fixture();f.controller.schedule(input());f.timers.tick(250);const old=f.workers[0],late=old.onmessage;
  f.controller.schedule(input(song,-1));late({data:{...old.sent,compiled:L.compile(song)}});
  assert(old.terminated);assert.equal(f.results.length,0);assert.equal(f.errors[0].code,'invalid-input');
});
test('only same-origin /lib JavaScript worker URLs accepted',()=>{
  const f=fixture();
  for(const workerUrl of ['https://foreign.test/a.js','//foreign.test/a.js','blob:abc','/api/music/chat','/lib/../other.js','/lib/%2e%2e/other.js'])assert.throws(()=>f.api.create({workerUrl}),/same-origin/);
  const cached=fixture({workerUrl:'/lib/music-preview-worker.js?v=abc123'});cached.controller.schedule(input());cached.timers.tick(250);
  assert.equal(cached.workers[0].url,'/lib/music-preview-worker.js?v=abc123');cached.controller.destroy();
});
test('worker startup, postMessage, error and messageerror failures clean up',()=>{
  for(const options of [{constructError:true},{postError:true}]){
    const f=fixture(options);f.controller.schedule(input());f.timers.tick(250);assert.equal(f.errors[0].code,'worker-unavailable');assert.equal(f.timers.tasks.size,0);
  }
  for(const event of ['onerror','onmessageerror']){
    const f=fixture();f.controller.schedule(input());f.timers.tick(250);f.workers[0][event]({preventDefault(){}});
    assert.equal(f.errors.length,1);assert(f.workers[0].terminated);assert.equal(f.timers.tasks.size,0);
  }
});
test('matching malformed compiler result rejected rather than shown',()=>{
  const mutations=[r=>{r.gb.notes[0].frame=-1;},r=>{r.mapping[0].span.end.offset=song.length+1;},r=>{r.mapping[1].noteIndex=r.mapping[0].noteIndex;},r=>{r.gb.totalFrames=L.LIMITS.frames+1;},r=>{r.diagnostics=[{severity:'error',message:'error'}];},r=>{r.mapping=[];}];
  for(const mutate of mutations){const f=fixture();f.controller.schedule(input());f.timers.tick(250);const result=L.compile(song);mutate(result);f.workers[0].reply({compiled:result});
    assert.equal(f.errors[0].code,'invalid-result');assert.equal(f.results.length,0);assert(f.workers[0].terminated);}
});
test('worker revalidates source/identity without compiling malformed requests',()=>{
  const w=workerVM();
  for(const request of [{...input(),sequence:0},{...input('x'.repeat(L.LIMITS.source+1)),sequence:1},{...input(song,-1),sequence:1}])w.send(request);
  assert.equal(w.messages.length,0);assert.deepEqual(w.imports,['./gb-hardware.js','./gb-kits.js','./music-language.js']);
});
test('worker forwards only its own hex cache version to fixed dependencies',()=>{
  const files=['./gb-hardware.js','./gb-kits.js','./music-language.js'];
  for(const search of ['?v=abc012DEF','?v=0','', '?v=xyz','?v=abc&url=https://foreign.test','?v=abc#other','?other=abc','?v=%61bc']){
    const w=workerVM(search),suffix=/^\?v=[a-fA-F0-9]+$/.test(search)?search:'';
    assert.deepEqual(w.imports,files.map(file=>file+suffix));
    w.send({...input(song),sequence:1,workerUrl:'https://foreign.test/worker.js'});
    assert.deepEqual(w.messages[0].compiled,L.compile(song));
    assert.equal(w.imports.length,3,'request data never adds imports');
  }
});
test('real worker compiler parity: patterns, tempo map, exact events/kits, invalid source',()=>{
  const exact='song({totalFrames:120})\ninstruments([[128,240,255,0]])\nevent({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\nkit({f:0,id:0})\n';
  assert(L.compile(exact).gb,'exact kit fixture compiles with bundled kits');
  const sources=[song,song.replace('tempo:128,bars:4','tempo:128,bars:4,stepsPerBar:16,tempoAt:[[8,180],[32,90]]'),exact,song+'broken(',song.replace('repeat:4','repeat:4097')];
  for(const source of sources){
    const w=workerVM();w.send({...input(source),sequence:1});assert.deepEqual(w.messages[0].compiled,L.compile(source));
    const f=fixture({onPost(worker){w.send(worker.sent);worker.onmessage({data:w.messages.at(-1)});}});
    f.controller.schedule(input(source));f.timers.tick(250);assert.equal(f.errors.length,0);assert.deepEqual(f.results[0].compiled,L.compile(source));
  }
});
test('source remains inert parser data; no eval, network or side effects',()=>{
  const w=workerVM(),source='globalThis.compromised = true; fetch("https://example.invalid")';
  w.send({...input(source),sequence:1});assert.equal(w.messages[0].compiled.gb,null);
  assert.deepEqual(w.messages[0].compiled,L.compile(source));
});
console.log('PASS '+passed+' music preview checks (fake lifecycle + real compiler parity; no build/network)');
