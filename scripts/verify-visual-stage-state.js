#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const stage=require('../src/visual-stage');
let changes=0,applies=0,renders=0,resets=0,values={motion:0.8};
const program={controls:[{name:'motion',min:0,max:2,value:0.8}]};
const language={PRESETS:[{id:'visual:a',label:'A',source:'valid'},{id:'visual:b',label:'B',source:'other'}],
  compile:s=>s==='bad'?{ok:false,diagnostics:[{message:'Bad source'}]}:{ok:true,program}};
const renderer={snapshot:()=>({values:{...values}}),apply:(_,v)=>{applies++;values={...v};},
  render:input=>{renders++;return {canvas:'frame',input,error:null};},reset:()=>resets++,setControl:(n,v)=>{values[n]=v;}};
const s=stage.create({language,renderer,games:[{id:'blocks',label:'Blocks'}],onChange:()=>changes++});
const transport=(step,extra={})=>({status:'playing',paused:false,epoch:1,activation:'a',revision:'r1',discontinuity:1,
  grid:{gstep:step},renderContextTime:step/8,...extra});
assert.equal(s.snapshot().state,'live');assert.equal(applies,1);
s.setDraft('bad');s.apply('now',transport(2));assert.equal(applies,1);assert.equal(s.snapshot().state,'error');
s.tick(transport(3),{});assert.equal(renders,1);assert.equal(s.snapshot().liveSource,'valid');
s.setDraft('valid2');s.apply('bar',transport(7));assert.equal(s.snapshot().pending.bar,2);assert.equal(applies,1);
s.tick(transport(15),{});assert.equal(applies,1);s.tick(transport(16,{paused:true,status:'paused'}),{});assert.equal(applies,1);
s.tick(transport(16),{});assert.equal(applies,2);assert.equal(s.snapshot().liveSource,'valid2');
s.setControl('motion',1.5);assert.equal(s.snapshot().draft,'valid2');assert.equal(s.snapshot().controls[0].value,1.5);
s.setDraft('valid3');s.apply('bar',transport(20));s.setControl('motion',0.5);s.tick(transport(32),{});
assert.equal(s.snapshot().controls[0].value,1.5,'queued parameters are an Apply snapshot');
s.apply('bar',transport(35));s.cancel();s.tick(transport(48),{});assert.equal(applies,3);
for(const change of [{discontinuity:2},{epoch:2},{activation:'b'},{revision:'r2'},{status:'stopped',paused:true},{status:'ended',paused:true},{status:'error',paused:true}]){
  s.apply('bar',transport(50));s.tick(transport(64,change),{});assert.equal(s.snapshot().pending,null);assert.equal(applies,3);
}
s.apply('bar',transport(50,{paused:true,status:'paused'}));assert.match(s.snapshot().error,/Play music/);
s.freeze(true);const count=renders;s.tick(transport(65),{});assert.equal(renders,count);
s.freeze(false);s.tick(transport(66),{});assert.equal(renders,count+1);
s.blackout(true);s.tick(transport(67),{});assert.equal(renders,count+2,'blackout still renders');
s.reset();assert.equal(resets,1);assert.equal(s.snapshot().blackout,true);
s.blackout(false);s.setScene('blocks',transport(68));assert.equal(s.snapshot().scene,'blocks');
s.tick(transport(69),{});assert.equal(renders,count+2,'game does not run procedural renderer');
s.selectDraft('visual:b');assert.equal(s.snapshot().scene,'blocks');assert.equal(s.snapshot().state,'draft');
s.apply('bar',transport(70));s.panic();assert.equal(s.snapshot().pending,null);assert.equal(s.snapshot().blackout,true);
s.setScene('off',transport(71));assert.equal(s.snapshot().enabled,false);
s.selectDraft('visual:a');s.apply('bar',transport(72));s.observe(transport(80));assert.equal(s.snapshot().scene,'visual:a','acknowledgement can activate while drawings are hidden');
s.apply('bar',transport(84));s.observe(null);assert.equal(s.snapshot().pending,null,'detaching cancels queued work');
s.setDraft('edited scene');s.apply('now',transport(86));s.setControl('motion',1.7);
s.setScene('off',transport(87));s.setScene('visual:a',transport(88));
assert.equal(s.snapshot().liveSource,'edited scene','Off roundtrip retains edited live source');
assert.equal(s.snapshot().controls[0].value,1.7,'Off roundtrip retains live parameter values');
assert.throws(()=>s.selectDraft('__proto__'));assert.throws(()=>s.setDraft('x'.repeat(32769)));
assert.ok(changes>20);console.log('visual stage: draft/live, boundaries, cancellation, controls and independent operations pass');
