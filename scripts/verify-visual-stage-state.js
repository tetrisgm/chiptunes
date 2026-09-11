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
assert.ok(changes>20);

// Portable visual composition data. Saving captures the LIVE scene, its source
// and its named values; drafts, queued boundaries, freeze and blackout are
// session state and must not travel with the project.
const fresh=restore=>{
  let v={motion:0.8};
  const lang={PRESETS:[{id:'visual:a',label:'A',source:'valid'},{id:'visual:b',label:'B',source:'other'}],
    compile:src=>src==='bad'?{ok:false,diagnostics:[{message:'Bad source'}]}:{ok:true,program}};
  const r={snapshot:()=>({values:{...v}}),apply:(_,next)=>{v={...next};},render:()=>({canvas:'f',error:null}),
    reset:()=>{},setControl:(n,value)=>{v[n]=value;}};
  return stage.create({language:lang,renderer:r,games:[{id:'blocks',label:'Blocks'}],onChange:()=>{},restore});
};
// An untouched default stage is not composition data. Without this a
// music-only project would silently gain a visual block, and its record would
// stop matching one written before visuals were persisted.
assert.equal(fresh().serialize(),null,'the default opening scene saves nothing');
const tunedOnly=fresh();tunedOnly.setControl('motion',1.9);
assert.deepEqual(tunedOnly.serialize(),{scene:'visual:a',source:'valid',values:{motion:1.9}},'tuning a control alone is worth saving');
const sceneOnly=fresh();sceneOnly.setScene('visual:b',transport(1));
assert.equal(sceneOnly.serialize().scene,'visual:b','choosing another scene is worth saving');
// Returning to the untouched default clears the saved visual rather than
// leaving a stale one behind.
sceneOnly.setScene('visual:a',transport(2));
assert.equal(sceneOnly.serialize(),null,'returning to the default clears it');

const authored=fresh();
authored.setDraft('performed program');authored.apply('now',transport(1));authored.setControl('motion',1.42);
const savedVisual=authored.serialize();
assert.deepEqual(savedVisual,{scene:'visual:a',source:'performed program',values:{motion:1.42}});
authored.setDraft('unapplied draft');authored.freeze(true);authored.blackout(true);
assert.deepEqual(authored.serialize(),savedVisual,'drafts, freeze and blackout are session state, never saved');

const reopened=fresh(savedVisual);
assert.equal(reopened.snapshot().scene,'visual:a');
assert.equal(reopened.snapshot().liveSource,'performed program','reopen restores the edited live source');
assert.equal(reopened.snapshot().controls[0].value,1.42,'reopen restores saved parameter values');
assert.equal(reopened.snapshot().state,'live');
assert.equal(reopened.snapshot().frozen,false);assert.equal(reopened.snapshot().blackout,false);
assert.deepEqual(reopened.serialize(),savedVisual,'restore then save is a fixed point');

// A saved visual is untrusted: none of these may stop the stage starting.
for(const broken of [{scene:5},{scene:'visual:custom',source:'bad',values:{}},{scene:'visual:custom',source:'x'.repeat(32769),values:{}},{scene:'nope-not-a-game',source:'',values:{}}]){
  const recovered=fresh(broken);
  assert.equal(recovered.snapshot().scene,'visual:a','malformed saved visual falls back to the default scene');
  assert.match(recovered.snapshot().notice,/could not be restored/);
}
// Absent is not malformed, and says nothing.
assert.equal(fresh(null).snapshot().notice,'');
assert.equal(fresh(null).snapshot().scene,'visual:a');
// A preset this build no longer ships keeps the saved program rather than
// discarding the work, under an id selectDraft still accepts.
const rescued=fresh({scene:'visual:removed-preset',source:'rescued',values:{motion:1.1}});
assert.equal(rescued.snapshot().scene,'visual:custom');
assert.equal(rescued.snapshot().liveSource,'rescued');
assert.equal(rescued.snapshot().controls[0].value,1.1);
rescued.selectDraft(rescued.snapshot().scene);
// Saved values outside the program's declared range are clamped, not trusted.
assert.equal(fresh({scene:'visual:custom',source:'p',values:{motion:99}}).snapshot().controls[0].value,2);
assert.equal(fresh({scene:'visual:custom',source:'p',values:{motion:'x'}}).snapshot().controls[0].value,0.8);
// A game scene carries no program source.
assert.deepEqual(fresh({scene:'blocks',source:'',values:{}}).serialize(),{scene:'blocks',source:'',values:{}});

// Off suspends a world rather than discarding it, so saving while Off must
// carry the suspended program. Without this, switching visuals off and saving
// silently destroyed the performer's applied source and control values.
const performing=fresh();
performing.setDraft('performed');performing.apply('now',transport(1));performing.setControl('motion',1.42);
performing.setScene('off',transport(2));
const offSaved=performing.serialize();
assert.deepEqual(offSaved,{scene:'visual:a',source:'performed',values:{motion:1.42},off:true},'Off still carries the suspended program');
const reopenedOff=fresh(offSaved);
assert.equal(reopenedOff.snapshot().scene,'off','Off reopens Off');
assert.equal(reopenedOff.snapshot().enabled,false);
assert.deepEqual(reopenedOff.serialize(),offSaved,'restore then save is a fixed point while Off');
reopenedOff.setScene('visual:a',transport(3));
assert.equal(reopenedOff.snapshot().liveSource,'performed','turning visuals back on recovers the exact program');
assert.equal(reopenedOff.snapshot().controls[0].value,1.42,'and its control values');

// restoreSaved reports failure, so a caller can refuse to overwrite a saved
// visual with the fallback default that replaced it.
const failing=fresh();
assert.equal(failing.restoreSaved({scene:'visual:custom',source:'bad',values:{}}),false,'an uncompilable saved visual reports failure');
assert.equal(failing.restoreSaved(null),true,'an absent visual is not a failure');
assert.equal(fresh().restoreSaved({scene:'visual:a',source:'valid',values:{}}),true,'a good visual reports success');

console.log('visual stage: draft/live, boundaries, cancellation, controls, independent operations and audiovisual persistence pass');
