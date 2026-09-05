#!/usr/bin/env node
'use strict';
// Structural writing checks, not listening evidence or a musical-quality score.
const assert=require('assert'), crypto=require('crypto');
const C=require('../src/composer'), M=require('../src/melody');
function hash(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function rng(token){let s=hash(token);return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function checkPlan(plan,sections,bars){
  let previousEnd=0,covered=0;
  for(const p of plan){
    const sec=sections[p.sectionIndex];
    assert(sec && sec.role!=='resolve');
    assert.strictEqual(p.role,sec.role);
    assert(Number.isInteger(p.startBar)&&Number.isInteger(p.bars)&&p.bars>=1&&p.bars<=4);
    assert(p.startBar>=sec.startBar && p.startBar+p.bars<=sec.startBar+sec.bars);
    assert(p.startBar>=previousEnd && p.startBar+p.bars<=bars);
    previousEnd=p.startBar+p.bars;covered+=p.bars;
  }
  assert(covered<=Math.floor(bars*.64),'whole-song melodic budget');
  if(plan.length){assert.strictEqual(plan[0].letter,'A');assert.strictEqual(plan.at(-1).letter,'A');}
  if(plan.length>=3)assert(plan.some(p=>p.letter==='B'),'development between theme returns');
}

// Odd boundaries and short sections exercise fitted fragments, not truncation
// of a globally aligned phrase across an unrelated section.
const sections=[
  {startBar:0,bars:2,role:'opening'}, {startBar:2,bars:4,role:'groove'},
  {startBar:6,bars:3,role:'hush'}, {startBar:9,bars:1,role:'build'},
  {startBar:10,bars:8,role:'lift'}, {startBar:18,bars:3,role:'break'},
  {startBar:21,bars:7,role:'drive'}, {startBar:28,bars:8,role:'drop'},
  {startBar:36,bars:4,role:'resolve'}
].map(Object.freeze);
Object.freeze(sections);
const spans=new Set();
for(let i=0;i<80;i++){
  const token='allocation-unit-'+i, opts={token,bars:40,sections,melDensity:1,hash};
  const plan=M.allocatePhraseGroups(opts);
  assert.deepStrictEqual(M.allocatePhraseGroups(opts),plan,'allocation is deterministic');
  checkPlan(plan,sections,40);
  assert(plan.some(p=>p.sectionIndex===1),'early body statement is not suppressed by prefix debt');
  assert(plan.some(p=>p.startBar>=22),'whole-song budget reserves a later return');
  plan.forEach(p=>spans.add(p.bars));
  const rootAt=bar=>[0,3,4,0][bar%4];
  const write=()=>M.write({...opts,rng:rng(token),rootAt,scaleLen:7,semiDegree:s=>Math.round(s*7/12)});
  const notes=write();assert.deepStrictEqual(write(),notes,'written notes and plan are deterministic');
  assert.deepStrictEqual(notes.phrasePlan,plan);
  for(const p of plan){
    const ns=notes.filter(n=>n.bar>=p.startBar&&n.bar<p.startBar+p.bars);
    assert(ns.length,'every selected fragment has written notes');
    assert(ns.at(-1).answer,'a short fragment retains its cadence');
    assert.strictEqual(ns.at(-1).degree,rootAt(p.startBar+p.bars),'cadence targets the coming harmony');
  }
  for(const n of notes)assert(plan.some(p=>n.bar>=p.startBar&&n.bar<p.startBar+p.bars),'no note outside its planned section span');
  const anchors=plan.filter(p=>p.letter==='A'&&p.bars>=2).map(p=>notes.find(n=>n.bar===p.startBar&&n.accent));
  if(anchors.length>1)assert(anchors.every(n=>n.degree-rootAt(n.bar)===anchors[0].degree-rootAt(anchors[0].bar)),
    'A keeps its statement anchor while following the local harmony');
}
assert.deepStrictEqual([...spans].sort(),[1,2,3,4],'short spans remain available rather than discarded');

let earlyGaps=0,leadBars=0,totalBars=0;
for(let i=0;i<200;i++){
  const token=i<32?'composition-form-'+String(i).padStart(2,'0'):'allocation-score-'+i;
  const s=C.compile(token), plan=s.musical.phrasePlan, lead=s.events.filter(e=>e.ch==='lead');
  checkPlan(plan,s.sections,s.totalBars);
  for(const n of lead)assert(plan.some(p=>n.tBeat>=p.startBar*4&&n.tBeat<(p.startBar+p.bars)*4));
  if(i<32){
    if(!lead.some(n=>n.tBeat>=16&&n.tBeat<48))earlyGaps++;
    leadBars+=new Set(lead.map(n=>Math.floor(n.tBeat/4))).size;totalBars+=s.totalBars;
  }
}
assert.strictEqual(earlyGaps,0,'fixed-seed cohort no longer shares an eight-bar early lead gap');
// A melody rewrite must not accidentally reseed its backing. This projection
// was captured from musician-12 before editing; event seed IDs are excluded
// because the final bass event follows the now-different number of lead notes.
const backing=s=>JSON.stringify({style:s.style,bpm:s.bpm,groove:s.groove,sections:s.sections,
  form:s.form,key:s.musical.rootMidi,scale:s.musical.scale,palette:s.palette,
  backing:s.events.filter(e=>e.ch!=='lead'&&e.ch!=='echo').map(({seed,...e})=>e)});
const digest=crypto.createHash('sha256').update(Array.from({length:48},(_,i)=>backing(C.compile('smoke-song-'+i))).join('\n')+'\n').digest('hex');
assert.strictEqual(digest,'7eaf3689d477b0e1798397b7e5e08a0b397d64773755832be636ad1042ed3398',
  'style, tempo, key, form, palette and accompaniment events stay unchanged');
console.log('melody allocation: odd section boundaries, 1–4-bar fragments, deterministic theme returns and bounded presence');
console.log(JSON.stringify({fixedSeeds:32,earlyEightBarLeadGaps:earlyGaps,leadOnsetBars:leadBars,totalBars}));
