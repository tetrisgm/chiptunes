#!/usr/bin/env node
'use strict';
// Real sequencer + processor + page ingestion in a source-loaded VM. The only
// simulated services are the audio callback clock, MessagePort and analyser.
// Browser acceptance separately exercises the built artifact and real Web Audio.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const read=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
const audio=read('src/audio.js'),runtime=read('src/runtime.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function song(){return {totalFrames:20,bank:{instruments:[[0x80,0xf0,0,0]],waveTables:[Array.from({length:32},(_,i)=>i%16)]},
  notes:[{ch:0,inst:0,midi:60,vel:1,frame:0,frames:4},{ch:0,inst:0,midi:67,vel:0,frame:8,frames:4}],auto:[]};}
function fixture(){
  let processor,samples=0,failDelivery=false;
  const messages=[],accepted=[],sandbox={structuredClone,console,sampleRate:48000,currentTime:0,
    ctx:{sampleRate:48000,state:'running',currentTime:0},MIX:{},gbNode:null,gbPending:null,
    _emptyRole:()=>({energy:0,onset:0,hi:0.5,band:12,notes:[]}),
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>{
      if(message.type==='musicEvents'&&failDelivery)throw Error('Test-only observation delivery failure');
      const copy=structuredClone(message);messages.push(copy);
      if(copy.type==='musicState')sandbox.musicAck(copy);
      if(copy.type==='musicEvents')accepted.push(sandbox.musicAcceptEvents(copy));
    }};}},registerProcessor:(_name,C)=>{sandbox.Processor=C;}};
  vm.createContext(sandbox);
  for(const name of ['src/gb-hardware.js','src/gb-kits.js','src/gb-apu.js','src/music-event-stream.js'])vm.runInContext(read(name),sandbox);
  vm.runInContext(read('src/music-language.js'),sandbox);
  vm.runInContext(audio.slice(audio.indexOf("  var chipOwner='radio';"),audio.indexOf('  function gbPlay(score,')),sandbox);
  vm.runInContext(read('src/lib/gb-chip-processor.js'),sandbox);
  sandbox.chipOwner='create';sandbox.musicEpoch=1;
  processor=new sandbox.Processor();
  const send=(type,fields={})=>processor.port.onmessage({data:structuredClone({type,epoch:sandbox.musicEpoch,...fields})});
  sandbox.gbNode={port:{postMessage:message=>processor.port.onmessage({data:structuredClone(message)})}};
  function prepare(gb,revision,base,options={}){
    const prepared=sandbox.musicPrepare(gb,{revision,boundaries:[4,8,12,16,20],...options},base);
    sandbox.musicRevisions.set(prepared.activation,prepared);return prepared;
  }
  function render(n=128){
    const output=new Float32Array(n);sandbox.currentTime=samples/48000;
    processor.process([],[[output,new Float32Array(n)]]);samples+=n;sandbox.ctx.currentTime=samples/48000;return output;
  }
  function until(frame){for(let i=0;processor.seq.frame<frame&&i<10000;i++)render();assert(processor.seq.frame>=frame);}
  const reader=(replay=false)=>vm.runInContext(`musicEventReader({replay:${replay}})`,sandbox);
  const start=(gb=song(),options={})=>{const a=prepare(gb,'a',null,options);send('musicPlay',{prepared:a});return a;};
  return {s:sandbox,p:processor,messages,accepted,send,prepare,render,until,reader,start,
    fail(value){failDelivery=value;},view:()=>sandbox.musicVisualState()};
}
const events=f=>f.messages.filter(m=>m.type==='musicEvents').flatMap(m=>m.events);
test('only executed commands emit: source identity, mute, pitch continuation, actual hardware strength and ordering',()=>{
  const f=fixture(),gb=song();
  gb.notes=[{ch:0,inst:0,midi:60,vel:0,frame:0,frames:3},{ch:1,inst:0,midi:55,vel:1,frame:0,frames:3},
    {ch:0,inst:0,midi:62,vel:1,trigger:false,frame:1,frames:2}];
  gb.auto=[{f:0,r:0x12,v:0}];
  const reader=f.reader(),a=f.start(gb);f.send('chmute',{mask:[false,true,false,false]});f.until(4);
  assert(f.accepted.every(Boolean));
  const observed=plain(reader.read().events),on=observed.filter(e=>e.kind==='noteOn');
  assert.equal(on.length,1,'muted channel has no emitted trigger');
  assert.equal(on[0].sourceIndex,0);assert.equal(on[0].midi,60);assert.equal(on[0].durationFrames,3);
  assert.equal(on[0].velocity,0);assert(on[0].strength>0,'chip has a velocity floor: vel 0 is not silence');
  assert.equal(on[0].id,`1:${a.activation}:1:0`);assert.equal(on[0].contextTime,0);
  const continuation=observed.find(e=>e.kind==='continuation');assert.equal(continuation.sourceIndex,2);
  assert.equal(continuation.midi,62);assert.equal(continuation.strength,0,'earlier automation silenced the DAC');
  const write=observed.find(e=>e.kind==='register');assert.equal(write.register,0x12);assert.equal(write.sourceIndex,0);
  assert(write.sequence>on[0].sequence);assert(write.sequence<continuation.sequence);
  assert.equal(reader.read().events.length,0,'reading twice never repeats');
});
test('journal readers and read-only snapshots cannot consume one another',()=>{
  const f=fixture(),a=f.reader(),b=f.reader();f.start();f.until(10);
  for(let i=0;i<10;i++)assert.equal(f.view().clock.noteOns.length,0);
  const first=plain(a.read()),second=plain(b.read());assert.deepEqual(first,second);
  first.events[0].kind='changed';assert.notEqual(second.events[0].kind,'changed');
  assert.equal(a.read().events.length,0);assert.equal(b.read().events.length,0);
  assert.equal(f.view().eventStream.rejectedBatches,0);
});
test('note, register and sample indices retain original input order; overwritten sample hits are not invented',()=>{
  const f=fixture(),gb=song();gb.kit=[{f:2,id:0},{f:2,id:1}];
  gb.auto=[{f:4,r:0x24,v:0x70},{f:0,r:0x24,v:0x77}];gb.notes.reverse();
  f.start(gb);f.until(10);
  const e=events(f),hit=e.filter(e=>e.kind==='sample');assert.equal(hit.length,1);assert.equal(hit[0].sourceIndex,1);assert.equal(hit[0].value,1);
  assert.equal(e.find(e=>e.kind==='noteOn'&&e.frame===0).sourceIndex,1);
  assert.equal(e.find(e=>e.kind==='register'&&e.frame===0).sourceIndex,1);
  assert(f.accepted.every(Boolean));
});
test('loop boundary note-offs execute before explicit discontinuity; each occurrence gets a new identity',()=>{
  const f=fixture(),gb=song();gb.totalFrames=4;gb.notes=gb.notes.slice(0,1);
  const reader=f.reader();f.start(gb,{loop:true});for(let i=0;i<90;i++)f.render();
  const e=plain(reader.read().events),on=e.filter(e=>e.kind==='noteOn'),off=e.filter(e=>e.kind==='noteOff');
  assert(on.length>=3);assert(off.length>=2);assert.equal(new Set(on.map(e=>e.id)).size,on.length);
  assert(on.every(e=>e.frame===0&&e.sourceIndex===0));assert(off.every(e=>e.frame===4));
  for(let i=1;i<on.length;i++){assert(on[i].contextTime>on[i-1].contextTime);assert(on[i].discontinuity>on[i-1].discontinuity);}
  assert(e.some(e=>e.kind==='transport'&&e.reason==='loop'));
  assert(f.accepted.every(Boolean));
});
test('seek replay stays on the page and never emits skipped notes; old discontinuities are rejected',()=>{
  const f=fixture(),a=f.start();f.until(4);const reader=f.reader(true);reader.read();
  f.send('musicPause',{paused:true});
  const seq=new f.s.CT_GB_APU.Sequencer(null,48000);Object.assign(seq,a.schedule);seq.seek(8);
  assert.equal(seq.observations,undefined);const previous=events(f).length;
  f.send('musicSeek',{state:seq});assert.equal(events(f).length,previous);assert.equal(f.view().paused,true);
  const reset=reader.read();assert.equal(reset.reset,true);assert.equal(reset.events.length,1);assert.equal(reset.events[0].reason,'seek');
  const discontinuity=f.view().discontinuity;
  f.s.musicAck({epoch:1,activation:a.activation,revision:'a',discontinuity:discontinuity-1,status:'position',frame:0});
  assert.equal(f.view().frame,8);
  f.send('musicPause',{paused:false});f.until(10);
  const after=plain(reader.read().events).filter(e=>e.kind==='noteOn');assert.equal(after.length,1);assert.equal(after[0].frame,8);
  assert.equal(after[0].sourceIndex,1);assert.equal(after[0].discontinuity,discontinuity);
});
test('pending revisions emit no notes, and activation flushes old events before announcing the new schedule',()=>{
  const f=fixture(),gb=song(),a=f.start(gb),reader=f.reader(true);f.until(3);
  const next=structuredClone(gb);next.notes[1].midi=72;
  const b=f.prepare(next,'b',a,{boundaries:[8]});f.send('musicQueue',{baseRevision:'a',baseActivation:a.activation,prepared:b});
  assert.equal(events(f).filter(e=>e.midi===72).length,0);
  f.until(10);assert.equal(f.view().revision,'b');assert(f.accepted.every(Boolean));
  const e=plain(reader.read().events),activate=e.findIndex(e=>e.kind==='transport'&&e.revision==='b');
  const note=e.findIndex(e=>e.kind==='noteOn'&&e.midi===72);
  assert(note>activate);assert(e.slice(activate).every(e=>e.revision==='b'));
  const current=f.view(),old=f.messages.find(m=>m.type==='musicEvents'&&m.revision==='a');
  assert.equal(f.s.musicAcceptEvents(old),false);assert.equal(f.view().eventStream.nextSequence,current.eventStream.nextSequence);
});
test('tempo-map compilation is the one authority for executed note frames and source mapping',()=>{
  const f=fixture(),compiled=f.s.CT_MUSIC_LANGUAGE.compile('song({tempo:120,bars:2,stepsPerBar:16,tempoAt:[[0,120],[16,180]]});\npattern("line", notes("C4 D4 E4 G4"));\ntrack("lead").instrument(0).play("line", {repeat:8});');
  assert(compiled.gb,JSON.stringify(compiled.diagnostics));f.start(compiled.gb,{settings:compiled.settings});
  while(!f.p.paused)f.render();
  const actual=events(f).filter(e=>e.kind==='noteOn');assert.equal(actual.length,compiled.gb.notes.length);
  for(const e of actual){const n=compiled.gb.notes[e.sourceIndex];assert.equal(e.frame,n.frame);assert.equal(e.durationFrames,n.frames);assert.equal(e.midi,n.midi);}
  assert(actual.every((e,i)=>i===0||e.contextTime>=actual[i-1].contextTime));assert(f.accepted.every(Boolean));
});
test('duplicate and malformed batches fail atomically; a valid replacement batch still succeeds',()=>{
  const f=fixture();f.start();f.render();const message=f.messages.find(m=>m.type==='musicEvents'),reader=f.reader();
  assert.equal(f.s.musicAcceptEvents(message),false);assert.equal(reader.read().events.length,0);
  const before=f.view().eventStream.nextSequence;
  const forged=structuredClone(message);forged.events[0].sequence=before;forged.nextSequence=before+forged.events.length;
  forged.events[0].sourceIndex=40000;
  assert.equal(f.s.musicAcceptEvents(forged),false);assert.equal(f.view().eventStream.nextSequence,before);
  forged.events[0].sourceIndex=0;forged.events[0].contextTime=NaN;
  assert.equal(f.s.musicAcceptEvents(forged),false);assert.equal(reader.read().events.length,0);
  f.until(10);assert(reader.read().events.some(e=>e.kind==='noteOn'&&e.frame===8));
});
test('dense callback batches are bounded and report exact loss instead of repeating or blocking audio',()=>{
  const f=fixture(),gb=song();gb.totalFrames=8;gb.notes=[];
  for(let frame=0;frame<6;frame++)for(let i=0;i<60;i++)gb.notes.push({ch:i%4,frame,frames:1,inst:0,midi:60,vel:1});
  // Stay below the existing 128-command chip-frame budget while overflowing
  // the observer in this intentionally oversized (non-browser) audio callback.
  f.start(gb);const pcm=f.render(7000),batch=f.messages.find(m=>m.type==='musicEvents');
  assert(batch);assert.equal(batch.events.length,256);assert(batch.dropped>0);assert.equal(batch.nextSequence,256+batch.dropped);
  assert.equal(f.view().eventStream.sourceDropped,batch.dropped);assert(f.accepted.every(Boolean));assert(pcm.some(v=>v!==0));
  assert(f.reader(true).read(512).events.some(e=>e.kind==='gap'&&e.count===batch.dropped));
});
test('observations do not alter PCM, including bounded delivery failure and recovery',()=>{
  const f=fixture(),control=fixture();f.start();control.start();control.p.seq.observations=null;
  f.fail(true);
  for(let i=0;i<15;i++)assert.deepEqual(f.render(),control.render());
  assert.equal(f.p.paused,false);assert(f.p.seq.observations.events.length>0);
  f.fail(false);
  for(let i=0;i<100;i++)assert.deepEqual(f.render(),control.render());
  assert(f.accepted.every(Boolean));assert(events(f).some(e=>e.kind==='noteOn'&&e.frame===0));
});
test('observation sequence exhaustion fails closed without stopping the sequencer',()=>{
  const f=fixture(),control=fixture();f.start();control.start();control.p.seq.observations=null;
  f.p.seq.observations.next=Number.MAX_SAFE_INTEGER;
  assert.deepEqual(f.render(),control.render());assert.equal(f.p.paused,false);assert.equal(f.p.seq.observations.exhausted,true);
  assert.equal(f.p.seq.observations.events.length,0);assert.equal(f.p.seq.observations.next,Number.MAX_SAFE_INTEGER);
});
test('source index changes alone never reset sustained channels during a no-op handover',()=>{
  const f=fixture(),gb=song();gb.notes[0].frames=16;gb.notes[1].ch=1;gb.auto=[{f:0,r:0x24,v:0x77},{f:10,r:0x24,v:0x70}];
  const a=f.start(gb);f.until(3);const next=structuredClone(gb);next.notes.reverse();next.auto.reverse();
  const b=f.prepare(next,'b',a,{boundaries:[4]});assert.deepEqual(plain(b.snapshots[0].preserve),[true,true,true,true]);
  f.send('musicQueue',{baseRevision:'a',prepared:b});f.until(6);
  assert.deepEqual(f.messages.find(m=>m.status==='playing'&&m.revision==='b').resetChannels,[]);
});
test('measured internal analysis is bounded, detached and throttled independently of the event cursor',()=>{
  const f=fixture();let timeCalls=0,freqCalls=0;
  f.s._masterAna={fftSize:2048,frequencyBinCount:1024,minDecibels:-100,maxDecibels:-30,
    getByteTimeDomainData(a){timeCalls++;for(let i=0;i<a.length;i++)a[i]=i%2?192:64;},
    getByteFrequencyData(a){freqCalls++;a.fill(128);}};
  const reader=f.reader();f.start();f.render();let v=f.view().clock.analysis;
  assert.equal(v.available,true);assert.equal(v.tap,'internal-master-pre-fx');assert.equal(v.frequencyScale,'normalized-decibel-magnitude');
  assert.equal(v.rms,0.5);assert.equal(v.peak,0.5);assert.equal(v.waveform.length,160);assert.equal(v.spectrum.length,64);
  assert.equal(v.bands.bass,128/255);assert.equal(v.bands.mid,128/255);assert.equal(v.sampleRate,48000);
  v.waveform[0]=2;v.bands.bass=2;assert.equal(f.view().clock.analysis.waveform[0],-0.5);assert.equal(f.view().clock.analysis.bands.bass,128/255);
  for(let i=0;i<10;i++)f.view();assert.equal(timeCalls,1);assert.equal(freqCalls,1);
  f.s.ctx.currentTime+=0.04;f.view();assert.equal(timeCalls,2);
  assert(reader.read().events.some(e=>e.kind==='noteOn'));
  f.send('musicPause',{paused:true});assert.equal(f.view().clock.analysis.rms,0);assert.equal(f.view().clock.energy,0);assert.equal(timeCalls,2);
  f.send('musicPause',{paused:false});f.s._masterAna.getByteTimeDomainData=()=>{throw Error('analyser unavailable');};
  f.s.ctx.currentTime+=0.04;assert.equal(f.view().clock.analysis.available,false);assert.equal(f.p.paused,false);
});
test('runtime draw cursor emits once, independently; late/paused/obsolete events are discarded with accounting',()=>{
  const f=fixture(),s=f.s;
  s.Audio={musicEventReader:s.musicEventReader};s._musicPresentationEpoch=0;
  vm.runInContext(runtime.slice(runtime.indexOf('var _musicDrawReader='),runtime.indexOf('function _syncCreateRendering()')),s);
  const independent=f.reader();f.start();f.render();
  const first=s._musicPresentationFrame(f.view());assert.equal(first.noteOns.length,1);assert(first.roles.lead.energy>0);
  assert.equal(s._musicPresentationFrame(f.view()).noteOns.length,0);
  assert(independent.read().events.some(e=>e.id===first.noteOns[0].id));
  f.until(10);s.ctx.currentTime+=1;
  const late=s._musicPresentationFrame(f.view());assert.equal(late.noteOns.length,0);assert(late.eventDelivery.dropped>0);
  f.send('musicPause',{paused:true});assert.equal(s._musicPresentationFrame(f.view()).noteOns.length,0);
  assert.equal(s._musicPresentationFrame(null),null);assert.equal(s._musicDrawReader,null);assert.equal(s._musicDrawPending.length,0);
});
test('authored register retriggers drive visuals without inventing a pitched note or repeating unrelated writes',()=>{
  const f=fixture(),s=f.s,gb=song();gb.auto=[{f:1,r:0x14,v:0x80},{f:1,r:0x24,v:0x77}];
  s.Audio={musicEventReader:s.musicEventReader};s._musicPresentationEpoch=0;
  vm.runInContext(runtime.slice(runtime.indexOf('var _musicDrawReader='),runtime.indexOf('function _syncCreateRendering()')),s);
  f.start(gb);f.render();s._musicPresentationFrame(f.view());f.until(2);
  const notes=s._musicPresentationFrame(f.view()).noteOns;
  assert.equal(notes.length,1);assert.equal(notes[0].kind,'register');assert.equal(notes[0].register,0x14);
  assert.equal(notes[0].midi,null);assert.equal(notes[0].durationFrames,0);assert(notes[0].strength>0);
  assert.equal(s._musicPresentationFrame(f.view()).noteOns.length,0);
});
