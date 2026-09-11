#!/usr/bin/env node
'use strict';
// Independent expected intervals. No browser, provider, build or second player.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const L=require('../src/music-language.js'),H=require('../src/gb-hardware.js');
let groups=0;
const test=(name,fn)=>{fn();groups++;console.log('ok '+name);};
const valid=source=>{const c=L.compile(source);assert.ok(c.gb,JSON.stringify(c.diagnostics));return c;};
function invalid(source,message){const c=L.compile(source);assert.equal(c.gb,null,source.slice(0,150));assert.deepEqual(c.mapping,[]);assert.deepEqual(c.controls,[]);assert.equal(c.controlsOmitted,0);assert.match(c.diagnostics[0].message,message||/.+/);return c.diagnostics[0];}
function source(text,chain='',options={}){
  const {settings={tempo:120,bars:8},play={repeat:settings.bars||1},track='bass',instrument='wave-bass'}=options;
  return `song(${JSON.stringify(settings)});\npattern("p",cycleV1(${JSON.stringify(text)})${chain});\ntrack(${JSON.stringify(track)}).instrument(${JSON.stringify(instrument)}).play("p",${JSON.stringify(play)});`;
}
function expected(intervals,settings={tempo:120,bars:8},gate=1){
  const clock=L.createClock(settings);
  return intervals.map(([start,end,midi])=>({ch:2,frame:clock(start*4),frames:Math.max(1,clock((start+(end-start)*gate)*4)-clock(start*4)),midi,inst:18,vel:1}));
}
const repeated=(rows,count=8)=>Array.from({length:count},(_,cycle)=>rows.map(([a,b,p])=>[cycle+a,cycle+b,p])).flat();
const pitches=c=>c.gb.notes.map(n=>n.midi);
const slice=(s,span)=>s.slice(span.start.offset,span.end.offset);
function exactSpan(source,text,from=0){const a=source.indexOf(text,from);assert.ok(a>=0);const pos=n=>({offset:n,line:source.slice(0,n).split('\n').length,column:n-source.lastIndexOf('\n',n-1)});return {start:pos(a),end:pos(a+text.length)};}

test('explicit constructor preserves the old grammar and restricted language version',()=>{
  assert.equal(L.VERSION,'1');
  const old=`song({tempo:120,bars:1});pattern('p',notes('C2 . G2:2@0.5').stepsPerBar(4));track('bass').instrument('wave-bass').play('p');`;
  assert.deepEqual(valid(old).gb.notes,[{ch:2,frame:0,frames:30,midi:36,inst:18,vel:1},{ch:2,frame:60,frames:59,midi:43,inst:18,vel:.5}]);
  // Each old-grammar rejection names its own diagnostic: a refactor that moved
  // one of these to an unrelated stage would otherwise stay green.
  invalid(source('C2 .'),/^Expected cycle pitch, ~, \[group\] or <alternation>$/);
  invalid(source('C2:2'),/^Separate cycle slots with whitespace$/);
  invalid(source('C2@.5'),/^Separate cycle slots with whitespace$/);
  invalid(source('C2','.stepsPerBar(4)'),/^cycleV1 uses cycles; stepsPerBar belongs to notes\(\)$/);
  invalid(old.replace("notes('C2 . G2:2@0.5').stepsPerBar(4)","notes('C2').fast(2)"),/^Unknown notes transformation$/);
  invalid(source('C2').replace('cycleV1','cycle'),/^Pattern requires notes\(\) or cycleV1\(\)$/);
});
test('sequences, nested subdivisions and rests preserve exact fractional windows',()=>{
  assert.deepEqual(valid(source('C2 [E2 G2]')).gb.notes,expected(repeated([[0,.5,36],[.5,.75,40],[.75,1,43]])));
  assert.deepEqual(valid(source('~ [C2 ~ [E2 G2]]')).gb.notes,expected(repeated([[.5,2/3,36],[5/6,11/12,40],[11/12,1,43]])));
  assert.deepEqual(valid(source('~')).gb.notes,[]);
});
test('slot repetition and repeating groups advance their local pattern clock',()=>{
  assert.deepEqual(valid(source('C2*2 G2')).gb.notes,expected(repeated([[0,.25,36],[.25,.5,36],[.5,1,43]])));
  assert.deepEqual(valid(source('[C2 E2]*2')).gb.notes,expected(repeated([[0,.25,36],[.25,.5,40],[.5,.75,36],[.75,1,40]])));
  assert.deepEqual(valid(source('<C2 E2>*2')).gb.notes,expected(repeated([[0,.5,36],[.5,1,40]])));
});
test('alternation, nested alternation and repeats use the time reaching the node',()=>{
  assert.deepEqual(pitches(valid(source('<C2 E2>'))),[36,40,36,40,36,40,36,40]);
  assert.deepEqual(pitches(valid(source('<<C2 D2> E2>'))),[36,40,38,40,36,40,38,40]);
  assert.deepEqual(valid(source('<C2 E2>','.fast(2)')).gb.notes,valid(source('<C2 E2>*2')).gb.notes);
  assert.deepEqual(pitches(valid(source('<C2 E2>','.slow(2)'))),[36,40,36,40]);
  assert.deepEqual(pitches(valid(source('<C2 E2>','',{play:{atBar:3,repeat:3}}))),[40,36,40],'play uses song-global cycle phase');
});
test('fast/slow compose in source order without phase drift',()=>{
  const text='<C2 [E2 G2]> ~ B2';
  for(const n of [1,2,3,7,16]){
    assert.deepEqual(valid(source(text,`.fast(${n}).slow(${n})`)).gb,valid(source(text)).gb);
    assert.deepEqual(valid(source(text,`.slow(${n}).fast(${n})`)).gb,valid(source(text)).gb);
  }
});
test('reversal mirrors the current cycle, not the whole slowed phrase',()=>{
  const a=valid(source('C2 E2 G2 B2','.slow(2).rev()')),b=valid(source('C2 E2 G2 B2','.rev().slow(2)'));
  assert.deepEqual(pitches(a),[40,36,47,43,40,36,47,43,40,36,47,43,40,36,47,43]);
  assert.deepEqual(pitches(b),[47,43,40,36,47,43,40,36,47,43,40,36,47,43,40,36]);
  assert.deepEqual(valid(source('C2 [~ E2] ~ G2','.rev()')).gb.notes,valid(source('G2 ~ [E2 ~] C2')).gb.notes);
  assert.deepEqual(valid(source('C2 [~ E2] ~ G2','.rev().rev()')).gb,valid(source('C2 [~ E2] ~ G2')).gb);
});
test('every has explicit zero-based period/offset and wraps the preceding expression',()=>{
  const plain=[36,40,43,47],reverse=[47,43,40,36];
  assert.deepEqual(pitches(valid(source('C2 E2 G2 B2','.every(4,"rev",3)'))),Array.from({length:8},(_,c)=>c%4===3?reverse:plain).flat());
  assert.deepEqual(valid(source('C2 E2 G2 B2','.every(1,"rev",0)')).gb,valid(source('C2 E2 G2 B2','.rev()')).gb);
  const first=valid(source('C2 E2','.every(4,"rev",3).fast(2)'));
  assert.deepEqual(pitches(first),Array.from({length:16},(_,c)=>c%4===3?[40,36]:[36,40]).flat());
  const last=valid(source('C2 E2','.fast(2).every(4,"rev",3)'));
  assert.deepEqual(pitches(last),Array.from({length:8},(_,c)=>c%4===3?[40,36,40,36]:[36,40,36,40]).flat());
});
test('Euclidean rhythms use the documented phase, left rotation and strict atom scope',()=>{
  for(const [hits,slots,mask] of [[3,8,'10010010'],[5,8,'10110110'],[2,5,'10100'],[1,8,'10000000'],[0,8,'00000000'],[8,8,'11111111']]){
    for(let rotation=0;rotation<slots;rotation++){
      const intervals=[...mask].flatMap((_,i)=>mask[(i+rotation)%slots]==='1'?[[i/slots,(i+1)/slots,36]]:[]);
      assert.deepEqual(valid(source(`C2(${hits},${slots},${rotation})`)).gb.notes,expected(repeated(intervals)));
    }
  }
  assert.deepEqual(valid(source('C2(3,8)*2')).gb.notes,valid(source('C2(3,8)','.fast(2)')).gb.notes);
  for(const token of ['~(3,8)','[C2 E2](3,8)','C2(9,8)','C2(3,0)','C2(3,65)','C2(3,8,8)','C2(3,8,-1)','C2(3.5,8)'])invalid(source(token));
});
test('whole sustained events survive queries without invented cycle retriggers',()=>{
  const full=valid(source('C2','.slow(2)'));
  assert.deepEqual(full.gb.notes,expected([[0,2,36],[2,4,36],[4,6,36],[6,8,36]]));
  const split=valid(source('C2','.slow(2).every(64,"rev",63)'));
  assert.deepEqual(split.gb,full.gb);assert.deepEqual(split.mapping.map(m=>m.cycleEvent),full.mapping.map(m=>m.cycleEvent));
  const halves=`song({tempo:120,bars:2});pattern('p',cycleV1('C2').slow(2));track('bass').instrument('wave-bass').play('p',{repeat:1}).play('p',{atBar:1,repeat:1});`;
  const c=valid(halves);assert.equal(c.gb.notes.length,1);assert.equal(c.gb.notes[0].frames,L.beatToFrame({tempo:120},8));
  assert.equal(valid(source('C2','.slow(2)',{play:{atBar:1,repeat:1}})).gb.notes.length,0);
  const duplicate=valid(halves.replace('atBar:1','atBar:0'));
  assert.equal(duplicate.gb.notes.length,2);assert.ok(duplicate.diagnostics.some(d=>d.code==='CHIP_OVERLAP'),'different play calls are not silently merged');
});
test('fractional play windows select onsets but never reset phase or trim durations',()=>{
  const c=valid(source('C2 E2','',{play:{atBar:.5,repeat:1}}));
  assert.deepEqual(c.gb.notes,expected([[.5,1,40],[1,1.5,36]]));
  assert.equal(c.mapping[0].occurrenceStartFrame,L.beatToFrame({tempo:120},2));
  const tail=valid(source('C2','.slow(2)',{play:{repeat:1}}));
  assert.deepEqual(tail.gb.notes,expected([[0,2,36]]));
  assert.equal(tail.mapping[0].occurrenceEndFrame,L.beatToFrame({tempo:120},4));
});
test('ambiguous cross-cycle reversal is rejected with the transformation location',()=>{
  const s=source('C2','.slow(2).rev()'),error=invalid(s,/crossing a cycle/);
  assert.equal(error.span.start.offset,s.indexOf('rev()'));
  invalid(source('C2','.slow(2).every(2,"rev",1)'),/crossing a cycle/);
  assert.deepEqual(valid(source('C2','.rev().slow(2)')).gb,valid(source('C2','.slow(2)')).gb);
});
test('gate is applied after rhythm while pitch/register and track state keep their order',()=>{
  const a=valid(source('B2 C3','.gate(.5).rev().transpose(1).register(3).velocity(.7)'));
  const b=valid(source('B2 C3','.rev().gate(.5).transpose(1).register(3).velocity(.7)'));
  assert.deepEqual(a.gb,b.gb);assert.deepEqual(pitches(a).slice(0,2),[49,48]);assert.ok(a.gb.notes.every(n=>n.vel===.7));
  const other=valid(source('B2 C3','.rev().register(3).transpose(1)'));assert.deepEqual(pitches(other).slice(0,2),[49,60]);
  const text=`song({bars:2});pattern('p',cycleV1('B2').gate(.5));track('bass').instrument('wave-bass').play('p').transpose(1).register(3).play('p',{atBar:1});`;
  assert.deepEqual(pitches(valid(text)),[47,48]);
  assert.deepEqual(valid(source('C2','.gate(.8).gate(.2)')).gb,valid(source('C2','.gate(.2)')).gb);
});
test('triplets, decimal gates and tempo-map/groove use absolute endpoints',()=>{
  for(const settings of [{tempo:120,bars:37},{tempo:173,bars:37,stepsPerBar:16,swing:.63,tempoAt:[[7,91],[39,177],[321,119]]}]){
    const c=valid(source('C2 E2 G2','.gate(.6)',{settings})),clock=L.createClock(settings);
    const rows=[];
    for(let cycle=0;cycle<37;cycle++)for(let step=0;step<3;step++){
      const frame=clock((cycle*3+step)*4/3),end=clock((cycle*15+step*5+3)*4/15);
      rows.push({ch:2,frame,frames:Math.max(1,end-frame),midi:[36,40,43][step],inst:18,vel:1});
    }
    assert.deepEqual(c.gb.notes,rows);
  }
  assert.ok(valid(source('C2 E2 G2','.gate(0.3333333333333333)')).gb);
});
test('escaped pitch spans, original token identity and play scope survive transformation',()=>{
  const raw=String.raw`\u0043\u00232 [E\u0032 ~] <G2 B2>`;
  const s=`// 🎵\r\nsong({bars:4});\r\npattern('p',cycleV1('${raw}').fast(2).rev().gate(.5));\r\ntrack('bass').instrument('wave-bass'). /* place */ play('p',{repeat:4});`;
  const c=valid(s),tokens=new Map([[37,String.raw`\u0043\u00232`],[40,String.raw`E\u0032`],[43,'G2'],[47,'B2']]);
  c.mapping.forEach((m,index)=>{
    assert.equal(m.patternType,'cycleV1');assert.deepEqual(m.tokenSpan,exactSpan(s,tokens.get(c.gb.notes[index].midi)));
    assert.equal(slice(s,m.playSpan),". /* place */ play('p',{repeat:4})");
    assert.match(slice(s,m.span),/^pattern\('p',cycleV1/);assert.equal(typeof m.cycleEvent,'string');
    assert.ok(m.occurrence>=0&&m.occurrence<4);assert.ok(m.patternNote>=0&&m.patternNote<4);
  });
  const shared=valid(s+"\r\ntrack('lead').instrument('p0').transpose(12).play('p',{repeat:4});");
  assert.equal(shared.gb.notes.length,c.gb.notes.length*2);
  assert.deepEqual(shared.mapping.slice(c.mapping.length).map(m=>m.tokenSpan),c.mapping.map(m=>m.tokenSpan));
});
test('cycle source controls remain direct literal metadata and are never timing authority',()=>{
  const s=source('C2 [E2 G2]','.fast(2).gate(/* gate */ .65).every(4,"rev",3).velocity(.7).transpose(-02)');
  const c=valid(s);assert.deepEqual(c.controls.map(x=>x.kind),['gate','velocity','transpose']);
  assert.deepEqual(c.controls.map(x=>slice(s,x.literalSpan)),['.65','.7','-02']);
  c.controls[0].value=.01;assert.deepEqual(valid(s).gb,c.gb);
});
test('finite song end and chip overlap/range rules remain authoritative',()=>{
  invalid(source('C2','.slow(2)',{settings:{bars:1}}),/beyond song end/);
  invalid(source('C9'),/chip range/);
  const c=valid(source('C2')+`\ntrack('bass').instrument('wave-bass').play('p',{repeat:8});`);
  assert.equal(c.gb.notes.length,16);assert.ok(c.diagnostics.some(d=>d.code==='CHIP_OVERLAP'));
  const noise=valid(source('C2(3,8)','.gate(.1)',{track:'drums',instrument:'n-tick'}));assert.ok(noise.gb.notes.every(n=>n.ch===3));
});
test('invalid syntax/arity and all unsupported notation fail closed even when unused',()=>{
  // Every rejection is pinned to its own message, so a diagnostic cannot
  // silently migrate to a different (still failing) stage.
  const empty=/^Empty cycle group$/,ws=/^Separate cycle slots with whitespace$/;
  const atom=/^Expected cycle pitch, ~, \[group\] or <alternation>$/,rep=/^Cycle repetition must be an integer/;
  for(const [text,message] of [['',empty],['[]',empty],['<>',empty],['C2E2',ws],['[C2',/^Expected cycle \]$/],
    ['<C2 E2',/^Expected cycle >$/],['C2]',ws],['C2 >',atom],['C2*0',rep],['C2*17',rep],['C2?',ws],['C2!2',ws],
    ['C2/2',ws],['C2 | E2',atom],['C2,E2',ws],['[C2,E2]',ws],['{C2 E2}',atom],['bd',atom],
    ['C2000',/^Invalid cycle octave$/],['C2 _',atom],['C2@2',ws],['C2:2',ws],['C2;fetch("x")',ws],
    // A Euclidean suffix binds to one pitch atom only, in either order.
    ['C2*2(3,8)',/^Euclidean suffix requires one pitch atom$/],['C2(3,8)(3,8)',/^Euclidean suffix requires one pitch atom$/],
    ['[C2 E2](3,8)',/^Euclidean suffix requires one pitch atom$/],
    ['C2(0,0)',/^Invalid Euclidean hits, slots or left rotation$/],['C2(3,65)',/^Invalid Euclidean hits, slots or left rotation$/],
    ['C2(9,8)',/^Invalid Euclidean hits, slots or left rotation$/],['C2(3,8,8)',/^Invalid Euclidean hits, slots or left rotation$/]])
    invalid(source(text),message);
  const speed=/^Cycle speed must be an integer/,every=/^Use every\(period, "rev", offset\)$/;
  for(const [chain,message] of [['.fast(0)',speed],['.fast(1.5)',speed],['.slow(17)',speed],
    ['.rev(1)',/^rev takes no arguments$/],['.every(4,"rev")',every],['.every(0,"rev",0)',every],
    ['.every(4,"fast",0)',every],['.every(4,"rev",4)',every],['.every(4,rev,0)',/^Only literal data is allowed$/],
    ['.eval()',/^Unknown notes transformation$/]])invalid(source('C2',chain),message);
  invalid('song({bars:1});pattern("unused",cycleV1("C2 ?"));',atom);
});
test('documented upper bounds compile at the boundary, not merely below it',()=>{
  // The rejection side was already pinned; without these the maxima could be
  // lowered to any smaller number and the suite would stay green.
  assert.equal(valid(source('C2*16')).gb.notes.length,128);
  assert.equal(valid(source('C2(3,64)')).gb.notes.length,24);
  assert.equal(valid(source('C2(64,64)')).gb.notes.length,512);
  assert.equal(valid(source('C2(1,1)')).gb.notes.length,8);
  assert.deepEqual(valid(source('C2(0,1)')).gb.notes,[]);
  for(const chain of ['.every(64,"rev",63)','.every(64,"rev",0)','.fast(16)'])
    assert.ok(valid(source('C2',chain)).gb.notes.length>0,chain);
  // slow(16) stretches one onset across 16 cycles, so it needs a song that can
  // actually hold the sustain; the finite-end rule stays authoritative.
  assert.equal(valid(source('C2','.slow(16)',{settings:{tempo:120,bars:16},play:{repeat:16}})).gb.notes.length,1);
  invalid(source('C2','.slow(16)'),/^Note extends beyond song end$/);
});
test('pitch atoms accept case and accidentals, and bare b is the note B',()=>{
  // 'b' is an overloaded token: Bb2 is B-flat, but b2 is B natural, because a
  // flat marker only follows a letter. Pin it so the overload cannot drift.
  for(const [text,midi] of [['C2',36],['c2',36],['Bb2',46],['b2',47],['B2',47],['eb3',51],['E3',52],['C#2',37]])
    assert.equal(valid(source(text)).gb.notes[0].midi,midi,text);
  for(const text of ['C-1','B8'])invalid(source(text),/^Pitch outside chip range$/);
});
test('exact-mode songs use the same clock as notes(), including its default tempo',()=>{
  // cycleV1 is not special here: an exact song without settings.tempo falls
  // back to the shared 120 BPM / 16-step createClock default exactly as
  // notes() does. Pinned so the two constructors cannot diverge silently.
  const play='track("bass").instrument("wave-bass").play("p",{repeat:2});';
  const cycle=t=>`song(${JSON.stringify(t)});pattern("p",cycleV1("C2 E2"));${play}`;
  const step=t=>`song(${JSON.stringify(t)});pattern("p",notes("C2 E2").stepsPerBar(2));${play}`;
  for(const settings of [{totalFrames:600},{totalFrames:600,settings:{tempo:140}}]){
    const a=valid(cycle(settings)).gb.notes,b=valid(step(settings)).gb.notes;
    assert.deepEqual(a.map(n=>n.frame),b.map(n=>n.frame),JSON.stringify(settings));
  }
  assert.deepEqual(valid(cycle({totalFrames:600})).gb.notes.map(n=>n.frame),[0,60,119,179]);
  assert.deepEqual(valid(cycle({totalFrames:600,settings:{tempo:140}})).gb.notes.map(n=>n.frame),[0,51,102,154]);
  // materialize() round-trips a cycle song through exact mode unchanged.
  const c=valid(cycle({totalFrames:600,settings:{tempo:140}})),round=valid(L.materialize(c.gb,c.settings));
  assert.deepEqual(round.gb,c.gb);assert.deepEqual(round.settings,c.settings);
});
test('node, depth and wrapper boundaries reject excess without changing old limits',()=>{
  valid(`song({bars:1});pattern('p',cycleV1('${Array(4095).fill('C2').join(' ')}'));`);
  invalid(`song({bars:1});pattern('p',cycleV1('${Array(4096).fill('C2').join(' ')}'));`,/node limit/);
  valid(source('['.repeat(14)+'C2'+']'.repeat(14)));
  invalid(source('['.repeat(15)+'C2'+']'.repeat(15)),/nesting limit/);
  valid(source('C2','.fast(1)'.repeat(32)));invalid(source('C2','.fast(1)'.repeat(33)),/transformation limit/);
  assert.equal(L.LIMITS.events,50000);assert.equal(L.LIMITS.source,1048576);
});
test('work counts silent expansion, discarded fragments and precision independently of wall time',()=>{
  const start=performance.now();
  // Exact messages: /work limit/ also matches the pre-existing 2,000,000
  // 'Compilation work limit', so a loose regex let LIMITS.cycleWork be raised
  // to any value without failing. These four name distinct budgets.
  invalid(source('~*16','.fast(16)',{settings:{tempo:1000,bars:4096},play:{repeat:4096}}),/^Cycle compilation work limit$/);
  invalid(source('~','.fast(16)'.repeat(8)),/^Cycle query work limit$/);
  invalid(source('C2','',{play:{atBar:1e-100,repeat:1}}),/^Cycle rational precision limit$/);
  const dense=source('C2*16','.fast(16)',{settings:{tempo:1000,bars:200},play:{repeat:200}});invalid(dense,/^Cycle intermediate event limit$/);
  // The fragment budget spans the whole compilation, not one pattern or one
  // play: neither half below exceeds it alone.
  const half=`pattern("a",cycleV1("${'~*16 '.repeat(16).trim()}").fast(16));pattern("b",cycleV1("${'~*16 '.repeat(16).trim()}").fast(16));`;
  const two=`song({tempo:1000,bars:2048});${half}track("bass").instrument("wave-bass").play("a",{repeat:2048});track("lead").instrument("p0").play("b",{repeat:2048});`;
  invalid(two,/^Cycle compilation work limit$/);
  // Just under each cap still compiles, so the caps are not merely unreachable.
  assert.equal(valid(source('C2','.fast(16)'.repeat(2),{settings:{tempo:120,bars:4},play:{repeat:4}})).gb.notes.length,1024);
  valid(source('C2','',{play:{atBar:0.5,repeat:1}}));
  // A legitimate program that genuinely needs the declared 256-bit rationals:
  // thirteen nested triplets (3^13) against a 10^-60 window is about 2^220 of
  // denominator, so a narrower cycleBits would reject real music rather than
  // merely tightening a rejection. Pinned against both 64 and 128.
  assert.equal(valid(source('['.repeat(13)+'C2 E2 G2'+']'.repeat(13),'',{play:{atBar:1e-60,repeat:1}})).gb.notes.length,3);
  assert.ok(performance.now()-start<3000,'bounded failure fits the preview deadline on this test host');
});
test('browser and Node compile identically with code generation and ambient services forbidden',()=>{
  const ctx={console,CT_GB:H,CT_GB_KITS:require('../src/gb-kits.js')};
  vm.createContext(ctx,{codeGeneration:{strings:false,wasm:false}});
  vm.runInContext('Date=undefined;performance=undefined;setTimeout=undefined;fetch=undefined;Math.random=()=>{throw Error("random");};',ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/music-language.js'),'utf8'),ctx);
  for(const [text,chain] of [['C2 [E2 G2]',''],['<C2 E2>','.fast(3)'],['C2(3,8,1)','.every(4,"rev",3).gate(.65)'],['C2','.slow(2)']]){
    const s=source(text,chain);assert.deepEqual(JSON.parse(JSON.stringify(ctx.CT_MUSIC_LANGUAGE.compile(s))),valid(s));
  }
});
test('materialized performance and PCM remain exact for deterministic transformed songs',()=>{
  const APU=require('../src/gb-apu.js');
  for(const [text,chain] of [['C2 [E2 G2]','.every(4,"rev",3).gate(.65)'],['<C2 E2>','.fast(3).gate(.4)'],['C2','.slow(2).gate(.9)']]){
    const c=valid(source(text,chain)),round=valid(L.materialize(c.gb,c.settings));assert.deepEqual(round.gb,c.gb);assert.deepEqual(round.settings,c.settings);
    const a=APU.render(c.gb,8000),b=APU.render(round.gb,8000);
    assert.deepEqual(a,b);
  }
});
test('deterministic malformed corpus never executes source or returns partial compiler state',()=>{
  let state=1701;const alphabet='C2E4~[]<>*(),rev.0123456789?@;`{}';
  for(let i=0;i<250;i++){
    let text='';for(let n=0;n<3+i%21;n++){state=(Math.imul(state,1664525)+1013904223)>>>0;text+=alphabet[state%alphabet.length];}
    const c=L.compile(source(text));if(!c.gb){assert.equal(c.mapping.length,0);assert.equal(c.controls.length,0);}else assert.ok(c.gb.notes.length<=L.LIMITS.events);
  }
});
console.log(`music-cycles: ${groups} groups passed (exact expected schedules, whole-event windows, bounds and compiler/PCM parity)`);
