#!/usr/bin/env node
'use strict';
// Source-loaded production functions, real compiler/GB preparation; explicit
// DOM/audio stubs. No build or assertion of physical browser rendering.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
require('../src/api.js');
const language=require('../src/music-language.js'),hardware=require('../src/gb-hardware.js');
const audio=fs.readFileSync(require.resolve('../src/audio.js'),'utf8');
const runtime=fs.readFileSync(require.resolve('../src/runtime.js'),'utf8');
function audioFixture(){
  const sandbox={structuredClone,ctx:{sampleRate:44100,state:'running'},MIX:{},gbNode:null,gbPending:null,
    CT_GB_APU:require('../src/gb-apu.js'),CT_GB_HARDWARE:hardware,CT_MUSIC_LANGUAGE:language,
    _emptyRole:()=>({energy:0,onset:0,hi:0.5,band:12,notes:[]}),outputProbe:()=>({signal:0.1})};
  vm.createContext(sandbox);
  vm.runInContext(audio.slice(audio.indexOf("  var chipOwner='radio';"),audio.indexOf('  function gbPlay(score,')),sandbox);
  sandbox.chipOwner='create';
  return {s:sandbox,prepare(revision,settings={tempo:120}){
    const compiled=language.compile('song({tempo:120,bars:8});\n');assert.ok(compiled.gb);
    const prepared=sandbox.musicPrepare(compiled.gb,{revision,settings},null);
    sandbox.musicRevisions.set(prepared.activation,prepared);return prepared;
  },ack(prepared,status,frame=0){sandbox.musicAck({epoch:sandbox.musicEpoch,revision:prepared.revision,activation:prepared.activation,status,frame});},read:()=>sandbox.musicVisualState()};
}
test('visual metadata is detached and remains pending until matching activation acknowledgement',()=>{
  const f=audioFixture(),settings={tempo:120},a=f.prepare('a',settings);settings.tempo=180;
  assert.equal(a.visualSettings.tempo,120);assert.equal(f.read().revision,null);
  f.ack(a,'prepared');assert.equal(f.read().revision,null);
  f.ack(a,'playing',30);assert.equal(f.read().revision,'a');assert.equal(f.read().frame,30);
  const b=f.prepare('b',{tempo:90});f.ack(b,'queued',0);assert.equal(f.read().revision,'a');
  f.ack(b,'playing',50);assert.equal(f.read().revision,'b');
  f.ack(a,'playing',10);f.ack(a,'position',999);f.ack(a,'ended',999);assert.equal(f.read().revision,'b');assert.equal(f.read().frame,50);assert.equal(f.read().status,'playing');
  const before=JSON.stringify(f.read());for(let i=0;i<5;i++)f.read();assert.equal(JSON.stringify(f.read()),before,'reads never advance position');
});
test('tempo-map clock, loop rewind, pause, suspension and finite end follow acknowledged frames',()=>{
  const f=audioFixture(),settings={tempo:120,stepsPerBar:16,tempoAt:[[16,90]]},a=f.prepare('mapped',settings),clock=language.createClock(settings);
  f.ack(a,'playing',clock(5));assert.equal(f.read().grid.beat,5);assert.equal(f.read().grid.gstep,20);
  assert.ok(Math.abs(f.read().grid.bpm-90)<3);
  f.ack(a,'paused',clock(5));assert.equal(f.read().paused,true);assert.equal(f.read().clock.energy,0);
  f.ack(a,'playing',clock(5));f.s.ctx.state='suspended';assert.equal(f.read().paused,true);assert.equal(f.read().suspended,true);
  f.s.ctx.state='running';f.ack(a,'loop',0);assert.equal(f.read().frame,0);assert.equal(f.read().grid.beat,0);
  f.ack(a,'ended',a.totalFrames);assert.equal(f.read().frame,a.totalFrames);assert.equal(f.read().status,'ended');assert.equal(f.read().paused,true);assert.equal(f.read().clock.beatPulse,0);
  f.s.musicInvalidate('stop');assert.equal(f.read().revision,null);assert.equal(f.read().status,'stopped');
  f.s.chipOwner='radio';assert.equal(f.read(),null);
});
test('native semantic notes and analyser energy come only from acknowledged schedule',()=>{
  const f=audioFixture(),a=f.prepare('notes');a.schedule.byFrame[0]=[{t:1,n:{ch:0,midi:72,vel:0.7}},{t:1,n:{ch:2,midi:40,vel:0.5}}];
  f.ack(a,'playing',0);const result=f.read();assert.equal(result.clock.roles.lead.notes[0].midi,72);assert.equal(result.clock.roles.bass.notes[0].midi,40);assert.equal(result.clock.energy,0.4);
  result.clock.roles.lead.notes[0].midi=1;assert.equal(f.read().clock.roles.lead.notes[0].midi,72);
  f.ack(a,'paused',0);assert.equal(f.read().clock.noteOns.length,0);
});
test('real source processor acknowledgements drive finite end without presentation commands',()=>{
  const f=audioFixture();let Processor;
  const sandbox={sampleRate:44100,CT_GB_APU:require('../src/gb-apu.js'),CT_GB:hardware,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>{if(message.type==='musicState')f.s.musicAck(message);}};}},
    registerProcessor(_name,type){Processor=type;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/lib/gb-chip-processor.js'),'utf8'),sandbox);
  const prepared=f.prepare('processor');prepared.totalFrames=2;
  const processor=new Processor();processor.musicMessage({type:'musicPlay',epoch:f.s.musicEpoch,prepared});
  assert.equal(f.read().revision,'processor');
  for(let i=0;i<20;i++)processor.process([],[[new Float32Array(128),new Float32Array(128)]]);
  assert.equal(f.read().status,'ended');assert.equal(f.read().frame,2);assert.equal(f.read().paused,true);
});
function renderingFixture(){
  const classes=()=>({values:new Set(),toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);},contains(name){return this.values.has(name);}});
  let open=true,visible=false,frames=0,stops=0,games=0;
  const s={document:{hidden:false,body:{classList:classes()},documentElement:{classList:classes()}},window:{},
    CT_MUSIC_WORKSPACE:{isOpen:()=>open,isVisualizerOpen:()=>visible},CT_CREATE:{isOpen:()=>false},
    Audio:new Proxy({musicVisualState:()=>null},{get(target,key){if(key in target)return target[key];return ()=>{throw Error('Audio mutation/read outside music bridge: '+key);};}}),
    selGame:null,_bgAudioOnly:false,lastFrame:1,_nowMs:()=>10,
    _stopFrameLoop:()=>{stops++;},_scheduleFrameLoop:()=>{frames++;},_fallbackGameKey:()=> 'platformer',
    showGame:key=>{games++;s.selGame={key};},_publishAudioOnlyMode:()=>{throw Error('Must not publish audio mode');}};
  vm.createContext(s);
  vm.runInContext(runtime.slice(runtime.indexOf('function _musicWorkspaceOpen()'),runtime.indexOf("if(typeof window!=='undefined') window._backgroundAudioOnlyActive")),s);
  return {s,set(visibleNext){visible=visibleNext;return s.window.CT_CREATE_PRESENTATION.setVisualizer(visibleNext);},close(){open=false;},stats:()=>({frames,stops,games})};
}
test('workspace flag first: toggle changes only stage presentation and rendering, preserves mounted state',()=>{
  const f=renderingFixture(),project={draft:'invalid draft',undo:[1],chat:['private'],selection:[3,8]},before=JSON.stringify(project);
  assert.equal(f.s._syncBackgroundAudioOnly(),true,'opaque workspace parks rendering without audio calls');
  assert.equal(f.set(true),true);assert.equal(f.s.document.body.classList.contains('create-visualizer'),true);assert.equal(f.stats().games,1);
  f.s.lastFrame=42;assert.equal(f.s._syncBackgroundAudioOnly(),false);assert.equal(f.s.lastFrame,42,'frame sync does not zero simulation dt');
  f.set(false);f.set(true);assert.equal(f.stats().games,1,'same game instance on return');
  assert.equal(JSON.stringify(project),before);
  f.s.document.hidden=true;assert.equal(f.s._syncBackgroundAudioOnly(),true);f.s.document.hidden=false;assert.equal(f.s._syncBackgroundAudioOnly(),false);
  f.set(false);f.close();assert.equal(f.s._musicPresentationState(),null,'radio presentation outside workspace untouched');
});
test('runtime selects music bridge before radio/watch clocks and never drains radio events for workspace',()=>{
  assert.match(runtime,/const events = \(!musicPresentation&&!paused/);
  assert.match(runtime,/const RX = musicPresentation\?/);
  assert.match(runtime,/_frameSND = musicPresentation \?/);
  assert.match(runtime,/function _transportIsPaused\(\)\{ var music=_musicPresentationState\(\);if\(music\)return music.paused;/);
  assert.match(audio,/musicVisualState:musicVisualState/);
});
test('workspace focus/visibility returns never invoke radio resume or reset the game',()=>{
  const f=renderingFixture(),events={};f.set(true);f.s._hiddenAt=1;f.s._syncWakeLock=()=>{};
  f.s.document.addEventListener=(name,fn)=>{events[name]=fn;};f.s.window.addEventListener=(name,fn)=>{events[name]=fn;};
  for(const [start,end] of [["document.addEventListener('visibilitychange',", "window.addEventListener('blur',"],["window.addEventListener('focus',", "window.addEventListener('pagehide',"]]){
    vm.runInContext(runtime.slice(runtime.indexOf(start),runtime.indexOf(end,runtime.indexOf(start))),f.s);
  }
  events.focus();events.visibilitychange();assert.equal(f.stats().games,1);assert.equal(f.s._hiddenAt,0);
});
test('native Escape has precedence; visualizer Escape bubbles to workspace return handler',()=>{
  let native=true,visual=true,nativeClosed=0,workspaceClosed=0,consumed=0;
  const s={CT_LSDJ_NATIVE_EDITOR:{isOpen:()=>native,close:()=>{nativeClosed++;}},
    CT_MUSIC_WORKSPACE:{isOpen:()=>true,isVisualizerOpen:()=>visual,close:()=>{workspaceClosed++;}},
    document:{querySelector:()=>null},consumeKeyEvent:()=>{consumed++;}};
  vm.runInNewContext(runtime.slice(runtime.indexOf('function handleEscapeShortcut(ev){'),runtime.indexOf('// position ONLY',runtime.indexOf('function handleEscapeShortcut(ev){'))),s);
  assert.equal(s.handleEscapeShortcut({key:'Escape'}),true);assert.equal(nativeClosed,1);assert.equal(workspaceClosed,0);assert.equal(consumed,1);
  native=false;assert.equal(s.handleEscapeShortcut({key:'Escape'}),false);assert.equal(workspaceClosed,0);assert.equal(consumed,1);
  visual=false;assert.equal(s.handleEscapeShortcut({key:'Escape'}),true);assert.equal(workspaceClosed,1);
});
