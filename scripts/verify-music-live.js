'use strict';
// Source-only test: real processor, real APU, real page preparation. No build.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sandbox={console,structuredClone,Float32Array,Uint8Array,sampleRate:48000,
  setTimeout,clearTimeout,setInterval,clearInterval,performance,
  AudioWorkletProcessor:class { constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(structuredClone(m))};} },
  registerProcessor:(name,C)=>{sandbox.Processor=C;}};
sandbox.window=sandbox;
vm.createContext(sandbox);
for(const f of ['src/gb-hardware.js','src/gb-kits.js','src/gb-apu.js','src/lib/gb-chip-processor.js']) vm.runInContext(read(f),sandbox);
let audio=read('src/audio.js');
audio=audio.slice(0,audio.indexOf('\n})();')+6);
audio=audio.replace('  return {\n    musicPlay:',`  globalThis.prepare=musicPrepare;
  globalThis.ack=musicAck;
  globalThis.bindMusic=function(p,a){
    musicEpoch=1; chipOwner='create'; musicCurrent=a; musicPending=null;
    musicRevisions=new Map([[a.activation,a]]);musicIdentities=new Map();
    gbNode={port:{postMessage:m=>p.port.onmessage({data:structuredClone(m)})}};
  };
  ctx={sampleRate:48000};
  return {\n    musicPlay:`);
vm.runInContext(audio,sandbox);
const Audio=vm.runInContext('Audio',sandbox);
const prep=(gb,rev,base,boundaries=[30,60,90])=>sandbox.prepare(gb,{revision:rev,boundaries,loop:false},base);
const send=(p,type,other={})=>p.port.onmessage({data:structuredClone({type,epoch:1,...other})});
const render=(p,n)=>{const l=new Float32Array(n);p.process([],[[l,new Float32Array(n)]]);return l;};
const until=(p,f)=>{while(p.seq.frame<f)render(p,128);};
const song=()=>({totalFrames:120,bank:{instruments:[[0x80,0xf0,0,0],[0x80,0xa0,0,0]],waveTables:[Array.from({length:32},(_,i)=>i%16)]},
  notes:[{ch:0,inst:0,midi:60,vel:1,frame:0,frames:110},{ch:1,inst:1,midi:48,vel:1,frame:0,frames:110}],auto:[]});
const start=(gb,loop=false)=>{const p=new sandbox.Processor(),a=prep(gb,'a');a.loop=loop;send(p,'musicPlay',{prepared:a});return {p,a};};
let tests=0;
function test(name,fn){fn();tests++;console.log('ok '+name);}
test('unchanged sustained voices: sample-exact waveform and vibrato across boundary',()=>{
  const gb=song(),{p,a}=start(gb),{p:control}=start(gb);
  render(p,8000);render(control,8000);
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(gb,'b',a)});
  assert.equal(p.music.revision,'a');
  assert.deepEqual(render(p,70000),render(control,70000));
  assert.equal(p.music.revision,'b');
  assert.equal(p.messages.find(m=>m.revision==='b'&&m.status==='playing').resetChannels.length,0);
});
test('future boundary notes fire once, without early event or dropped event',()=>{
  const gb=song();gb.notes.push({ch:3,inst:0,midi:40,vel:1,frame:30,frames:10});
  const {p,a}=start(gb),{p:control}=start(gb);
  render(p,9000);render(control,9000);
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(gb,'b',a)});
  assert.deepEqual(render(p,40000),render(control,40000));
});
test('instrument changes reset only affected voice',()=>{
  const gb=song(),{p,a}=start(gb);until(p,20);
  const next=structuredClone(gb);next.bank.instruments[1][1]=0x70;
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(next,'b',a)});until(p,32);
  const ack=p.messages.find(m=>m.status==='playing'&&m.revision==='b');
  assert.deepEqual(ack.resetChannels,[1]);
});
test('wave changes explicitly reset wave voice',()=>{
  const gb=song();gb.notes.push({ch:2,inst:0,midi:48,frame:0,frames:110});
  const {p,a}=start(gb);until(p,20);const next=structuredClone(gb);next.bank.waveTables[0][0]=15;
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(next,'b',a)});until(p,32);
  assert.deepEqual(p.messages.find(m=>m.status==='playing'&&m.revision==='b').resetChannels,[2]);
});
test('tempo timing edits preserve history before changed events',()=>{
  const gb=song(),{p,a}=start(gb);until(p,20);const next=structuredClone(gb);next.notes[1].frames=100;
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(next,'b',a)});until(p,32);
  assert.deepEqual(p.messages.find(m=>m.status==='playing'&&m.revision==='b').resetChannels,[]);
  assert.ok(p.seq.byFrame[100]);
});
test('shorter song ends at activation and loop wraps immediately',()=>{
  for(const loop of [false,true]){
    const gb=song(),{p,a}=start(gb,loop);until(p,40);const next=structuredClone(gb);next.totalFrames=20;
    const b=prep(next,'b',a);b.loop=loop;send(p,'musicQueue',{baseRevision:'a',prepared:b});
    render(p,20000);assert.equal(p.music.revision,'b');assert.equal(p.paused,!loop);
    assert.ok(p.messages.some(m=>m.status===(loop?'loop':'ended')));
  }
});
test('pause and suspension freeze boundary; resume activates later boundary',()=>{
  const {p,a}=start(song());until(p,40);
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(song(),'b',a)});
  send(p,'musicPause',{paused:true});const frame=p.seq.frame;
  assert.ok(render(p,50000).every(x=>x===0));assert.equal(p.seq.frame,frame);
  // A suspended context makes no process calls. Neither wall time nor a timer
  // can activate pending work: only samples advance this state machine.
  assert.equal(p.music.revision,'a');send(p,'musicPause',{paused:false});until(p,62);
  assert.equal(p.messages.find(m=>m.revision==='b'&&m.status==='playing').frame,60);
});
test('supersede, cancel, stale base, stop and stale epoch',()=>{
  const {p,a}=start(song());
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(song(),'b',a)});
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(song(),'c',a)});
  assert.ok(p.messages.some(m=>m.status==='superseded'&&m.revision==='b'));
  send(p,'musicCancel',{revision:'b'});assert.equal(p.musicQueued.revision,'c');
  send(p,'musicCancel',{revision:'c'});assert.equal(p.musicQueued,null);
  send(p,'musicQueue',{baseRevision:'bad',prepared:prep(song(),'d',a)});assert.equal(p.musicQueued,null);
  send(p,'musicStop',{epoch:2});send(p,'musicPlay',{prepared:a});assert.equal(p.seq,null);
});
test('seek cancels pending and preserves paused transport',()=>{
  const {p,a}=start(song());send(p,'musicPause',{paused:true});
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(song(),'b',a)});
  const seq=new sandbox.CT_GB_APU.Sequencer(song(),48000);seq.seek(50);
  send(p,'musicSeek',{state:seq});assert.equal(p.seq.frame,50);assert.equal(p.paused,true);assert.equal(p.musicQueued,null);
});
test('radio and legacy play invalidate pending music',()=>{
  const {p,a}=start(song());send(p,'musicQueue',{baseRevision:'a',prepared:prep(song(),'b',a)});
  send(p,'play',{gb:song()});assert.equal(p.music,null);assert.equal(p.musicQueued,null);
  assert.ok(render(p,1000).some(x=>x!==0));
});
test('resource limits reject dense and unbounded songs',()=>{
  assert.throws(()=>prep({...song(),totalFrames:1e9},'a'));
  const gb=song();gb.auto=Array.from({length:129},()=>({f:2,r:0x24,v:0x77}));
  assert.throws(()=>prep(gb,'a'));
});
test('sample streamer keeps waveform, buffer position and cycle clock',()=>{
  const gb=song();gb.kit=[{f:0,id:0}];
  const {p,a}=start(gb),{p:control}=start(gb);render(p,500);render(control,500);
  assert.ok(p.seq.kit);
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(gb,'b',a,[2])});
  assert.deepEqual(render(p,7000),render(control,7000));
  assert.equal(p.seq.kitPos,control.seq.kitPos);assert.equal(p.seq.kitCyc,control.seq.kitCyc);
});
test('activation never invokes constructor preparation or seek replay',()=>{
  const {p,a}=start(song());const b=prep(song(),'b',a);
  const proto=sandbox.CT_GB_APU.Sequencer.prototype,seek=proto.seek;
  proto.seek=()=>{throw Error('audio-thread replay');};
  try {send(p,'musicQueue',{baseRevision:'a',prepared:b});until(p,32);assert.equal(p.music.revision,'b');}
  finally {proto.seek=seek;}
});
test('loop-boundary revision activates once and remains sample-exact',()=>{
  const gb=song(),{p,a}=start(gb,true),{p:control}=start(gb,true);
  const b=prep(gb,'b',a,[120]);b.loop=true;
  send(p,'musicQueue',{baseRevision:'a',prepared:b});
  assert.deepEqual(render(p,200000),render(control,200000));
  assert.equal(p.messages.filter(m=>m.status==='playing'&&m.revision==='b').length,1);
});
test('public API waits for acknowledgment, unsubscribe and seek/stop',()=>{
  const {p,a}=start(song());sandbox.bindMusic(p,a);
  const heard=[],unsubscribe=Audio.onMusicState(s=>heard.push(s));
  Audio.musicQueue(song(),{revision:'b',baseRevision:'a',boundaries:[30]});
  assert.equal(heard.length,0);
  until(p,32);
  p.messages.forEach(s=>{if(s.type==='musicState')sandbox.ack(s);});
  assert.ok(heard.some(s=>s.status==='playing'&&s.revision==='b'));
  assert.throws(()=>Audio.musicQueue(song(),{revision:'c',baseRevision:'a'}));
  Audio.musicPause(true);Audio.musicSeek(12);assert.equal(p.seq.frame,12);assert.ok(p.paused);
  unsubscribe();const count=heard.length;sandbox.ack({type:'musicState',epoch:1,status:'position',revision:'b',frame:12});
  assert.equal(heard.length,count);Audio.musicStop();assert.equal(p.seq,null);
});
test('processor failure is an explicit error state',()=>{
  const {p}=start(song());p.seq.render=()=>{throw Error('simulated failure');};
  assert.ok(render(p,128).every(x=>x===0));assert.ok(p.messages.some(s=>s.status==='error'));
});
test('gainScalar is applied exactly once by shared live/WAV sequencer',()=>{
  const gb=song(),quiet={...gb,gainScalar:0.25};
  const {p}=start(quiet),full=new sandbox.CT_GB_APU.Sequencer(gb,48000);
  const expected=new Float32Array(10000);full.render(expected,0,expected.length);
  assert.deepEqual(render(p,10000),expected.map(x=>x*0.25));
  const offline=sandbox.CT_GB_APU.render(quiet,48000);
  assert.deepEqual(offline.slice(0,10000),expected.map(x=>x*0.25));
  assert.ok(render(start({...gb,gainScalar:0}).p,1000).every(x=>x===0));
});
test('gain edit retains oscillator state while changing output amplitude',()=>{
  const gb=song(),{p,a}=start(gb),{p:control}=start(gb);
  render(p,8000);render(control,8000);
  send(p,'musicQueue',{baseRevision:'a',prepared:prep({...gb,gainScalar:0.5},'b',a)});
  while(p.music.revision==='a'){render(p,1);render(control,1);}
  render(p,63);render(control,63); // the bounded activation correction expires
  assert.deepEqual(render(p,8000),render(control,8000).map(x=>x*0.5));
  assert.equal(p.messages.find(s=>s.status==='playing'&&s.revision==='b').resetChannels.length,0);
});
test('public undo/redo requeues known revision with distinct activation; changed ID rejected',()=>{
  const gb=song(),{p,a}=start(gb);sandbox.bindMusic(p,a);
  function flush(){for(const s of p.messages.splice(0))if(s.type==='musicState')sandbox.ack(s);}
  Audio.musicQueue(gb,{revision:'b',baseRevision:'a',boundaries:[10]});until(p,12);flush();
  const first=p.music.activation;
  Audio.musicQueue(gb,{revision:'a',baseRevision:'b',boundaries:[20]});until(p,22);flush();
  Audio.musicQueue(gb,{revision:'b',baseRevision:'a',boundaries:[30]});until(p,32);flush();
  assert.equal(p.music.revision,'b');assert.notEqual(p.music.activation,first);
  assert.throws(()=>Audio.musicQueue({...gb,gainScalar:0.5},{revision:'b',baseRevision:'b'}));
  Audio.musicQueue(gb,{revision:'a',baseRevision:'b',boundaries:[40]});Audio.musicCancel('a');flush();
  Audio.musicQueue(gb,{revision:'a',baseRevision:'b',boundaries:[40]});until(p,42);flush();assert.equal(p.music.revision,'a');
});
test('shared hardware tempo-map boundaries agree with compiled note frames',()=>{
  vm.runInContext(read('src/music-language.js'),sandbox);
  const c=sandbox.CT_MUSIC_LANGUAGE.compile('song({tempo:120,bars:8,stepsPerBar:16,tempoAt:[[0,120],[19,180],[43,90]],swing:true});');
  assert.ok(c.gb,JSON.stringify(c.diagnostics));
  const actual=Audio.musicBoundaries(c);
  const H=sandbox.CT_GB,ticks=H.lsdjGrooveTicks(true,16);
  assert.equal(actual[2],H.lsdjRowFrame(120,ticks,19)+H.lsdjRowFrame(180,ticks,13));
  assert.equal(actual[3],H.lsdjRowFrame(120,ticks,19)+H.lsdjRowFrame(180,ticks,24)+H.lsdjRowFrame(90,ticks,5));
  assert.equal(actual.at(-1),c.gb.totalFrames);
  assert.deepEqual(Audio.musicBoundaries(c,{fromFrame:actual[2]+1,limit:2}),actual.slice(3,5));
});
test('duplicate activation messages cannot restart or replace playing revision',()=>{
  const {p,a}=start(song());const b=prep(song(),'b',a,[10]);
  send(p,'musicQueue',{baseRevision:'a',prepared:b});until(p,12);
  const seq=p.seq;send(p,'musicPlay',{prepared:a});
  send(p,'musicQueue',{baseRevision:'b',prepared:b});
  assert.equal(p.seq,seq);assert.equal(p.musicQueued,null);
});
test('first sample hit uses page-prepared PCM, never synthesizes on render thread',()=>{
  const gb=song();gb.kit=[{f:0,id:0}];const a=prep(gb,'a');
  const K=sandbox.CT_GB_KITS,byId=K.byId;
  K.byId=()=>{throw Error('render-thread kit synthesis');};
  try{const p=new sandbox.Processor();send(p,'musicPlay',{prepared:a});render(p,2000);assert.ok(!p.messages.some(s=>s.status==='error'));}
  finally{K.byId=byId;}
});
test('delayed acknowledgments keep intermediate activation through rapid updates',()=>{
  const {p,a}=start(song());sandbox.bindMusic(p,a);
  Audio.musicQueue(song(),{revision:'b',baseRevision:'a',boundaries:[10]});
  Audio.musicPause(false);until(p,12);
  // The page has not received b's acknowledgment, so c is correctly rejected
  // against the stale a activation. b's later acknowledgment must still land.
  Audio.musicQueue(song(),{revision:'c',baseRevision:'a',boundaries:[20]});
  for(const s of p.messages.splice(0))if(s.type==='musicState')sandbox.ack(s);
  assert.doesNotThrow(()=>Audio.musicQueue(song(),{revision:'d',baseRevision:'b',boundaries:[20]}));
});
test('long songs select upcoming boundaries beyond first 256 bars',()=>{
  const c=sandbox.CT_MUSIC_LANGUAGE.compile('song({tempo:255,bars:700,stepsPerBar:16,tempoAt:[[0,255],[4099,220],[8003,250]],swing:true});');
  assert.ok(c.gb,JSON.stringify(c.diagnostics));
  const first=Audio.musicBoundaries(c,{limit:256});
  const from=first.at(-1)+1;
  const later=Audio.musicBoundaries(c,{fromFrame:from,limit:256});
  assert.equal(later.length,256);assert.ok(later.every(f=>f>=from));
  assert.ok(later[0]>first.at(-1));
  assert.deepEqual(Audio.musicBoundaries(c,{fromFrame:later[90],limit:3}),later.slice(90,93));
  assert.deepEqual(Array.from(Audio.musicBoundaries(c,{fromFrame:c.gb.totalFrames+1})),[]);
});
test('late long-song queue activates next eligible boundary, not song end',()=>{
  const c=sandbox.CT_MUSIC_LANGUAGE.compile('song({tempo:255,bars:700});');
  const first=Audio.musicBoundaries(c,{limit:256}),frame=first.at(-1)+1;
  const p=new sandbox.Processor();
  const a=sandbox.prepare(c.gb,{revision:'long-a',offsetFrames:frame},null);
  send(p,'musicPlay',{prepared:a});
  const boundaries=Audio.musicBoundaries(c,{fromFrame:frame,limit:256});
  const b=sandbox.prepare(c.gb,{revision:'long-b',boundaries},a);
  send(p,'musicQueue',{baseRevision:'long-a',prepared:b});
  until(p,boundaries[0]+1);
  const ack=p.messages.find(s=>s.status==='playing'&&s.revision==='long-b');
  assert.equal(ack.frame,boundaries[0]);assert.ok(ack.frame<c.gb.totalFrames);
});
test('future-only edit has waveform correlation 1 before its first changed event',()=>{
  const gb=song(),next=structuredClone(gb);
  next.notes.push({ch:3,inst:0,midi:40,vel:1,frame:90,frames:10});
  const {p,a}=start(gb),{p:control}=start(gb);
  render(p,8000);render(control,8000);
  send(p,'musicQueue',{baseRevision:'a',prepared:prep(next,'future',a,[30])});
  const actual=render(p,50000),expected=render(control,50000);
  assert.deepEqual(actual,expected);
  let xy=0,xx=0,yy=0;for(let i=0;i<actual.length;i++){xy+=actual[i]*expected[i];xx+=actual[i]*actual[i];yy+=expected[i]*expected[i];}
  assert.equal(xy/Math.sqrt(xx*yy),1);
  assert.deepEqual(p.messages.find(s=>s.status==='playing'&&s.revision==='future').resetChannels,[]);
});
test('omitted gainScalar and explicit unity retain identical existing render samples',()=>{
  const gb=song();
  assert.deepEqual(sandbox.CT_GB_APU.render(gb,48000),sandbox.CT_GB_APU.render({...gb,gainScalar:1},48000));
});
test('changed voice/gain boundary meets last output and correction expires in 64 samples',()=>{
  for(const change of ['instrument','gain']){
    const gb=song(),next=structuredClone(gb),{p,a}=start(gb);
    if(change==='instrument')next.bank.instruments[1][1]=0x70;else next.gainScalar=0.5;
    render(p,8000);
    send(p,'musicQueue',{baseRevision:'a',prepared:prep(next,'b',a,[30])});
    let last,first;
    while(p.music.revision==='a'){last=p.musicLastSample;first=render(p,1)[0];}
    assert.equal(first,last,change+' first sample');
    assert.equal(p.musicDeclickLeft,63);
    assert.equal(p.messages.find(s=>s.status==='playing'&&s.revision==='b').declickSamples,64);
    const raw=sandbox.CT_GB_APU.Sequencer.restore(structuredClone(p.seq));
    const expected=new Float32Array(80);raw.render(expected,0,80);
    const offset=p.musicDeclickOffset,actual=render(p,80);
    for(let i=0;i<63;i++)assert.equal(actual[i],Math.fround(expected[i]+offset*(62-i)/63));
    assert.deepEqual(actual.slice(63),expected.slice(63));assert.equal(p.musicDeclickLeft,0);
    assert.deepEqual(structuredClone(p.seq.apu),structuredClone(raw.apu));
  }
});
test('no-op and future-only activations never enable output correction',()=>{
  for(const future of [false,true]){
    const gb=song(),next=structuredClone(gb),{p,a}=start(gb);
    if(future)next.notes.push({ch:3,inst:0,midi:40,frame:90,frames:10});
    render(p,8000);send(p,'musicQueue',{baseRevision:'a',prepared:prep(next,'b',a,[30])});until(p,32);
    assert.equal(p.messages.find(s=>s.status==='playing'&&s.revision==='b').declickSamples,0);
    assert.equal(p.musicDeclickLeft,0);
  }
});
console.log(`${tests} live music checks passed`);
