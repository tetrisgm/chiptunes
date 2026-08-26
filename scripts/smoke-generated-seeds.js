#!/usr/bin/env node
'use strict';
// Product contract for the one composer: deterministic, finite, playable
// scores with restrained lead presence and no silent tail before handoff.
const composer=require('../src/composer.js');
const seeds=Array.from({length:48},(_,i)=>'smoke-song-'+i);
const failures=[];
for(const token of seeds){
  const a=composer.compile(token),b=composer.compile(token);
  if(JSON.stringify(a)!==JSON.stringify(b))failures.push(`${token}: nondeterministic`);
  if(!a||!Array.isArray(a.events)||!a.events.length){failures.push(`${token}: empty score`);continue;}
  if(!(a.bpm>=60&&a.bpm<=220))failures.push(`${token}: invalid bpm ${a.bpm}`);
  if(!(a.totalBars>=32&&a.totalBars<=96))failures.push(`${token}: invalid length ${a.totalBars}`);
  if(!a.tracker||!a.tracker.instrumentBank)failures.push(`${token}: missing chip instrument bank`);
  if(!a.tracker||!['nes','gameboy'].includes(a.tracker.trainedModel))failures.push(`${token}: missing trained composition model`);
  const lead=a.palette&&a.palette.voices&&a.palette.voices.lead;
  if(!lead||(!lead.chip&&!Array.isArray(lead.waveTable)))failures.push(`${token}: lead is not corpus-derived`);
  if(lead&&lead.waveTable&&(lead.waveTable.length!==32||lead.waveTable.some(x=>!Number.isFinite(x)||x < -1||x > 1)))
    failures.push(`${token}: malformed Game Boy wavetable`);
  const end=a.totalBars*4,notes=a.events.filter(e=>e.kind!=='chord');
  const bad=notes.find(e=>!Number.isFinite(e.tBeat)||e.tBeat<0||e.tBeat>=end||!(e.dur>0)||!(e.vel>=0&&e.vel<=1));
  if(bad)failures.push(`${token}: malformed event`);
  const roles=new Set(notes.map(e=>e.ch));
  for(const role of ['kick','snare','hat','bass'])if(!roles.has(role))failures.push(`${token}: missing ${role}`);
  const leadBars=new Set(notes.filter(e=>e.ch==='lead').map(e=>Math.floor(e.tBeat/4)));
  // Raised from 0.14 (owner, 2026-08-12). That cap existed to contain a melody
  // generator that cycled one interval cell, so the same lick returned every
  // bar and had to be rationed. melody.js writes question/answer phrases now,
  // so the tune can carry the song; this still catches a runaway "melody in
  // every single bar" regression.
  if(leadBars.size/a.totalBars>0.72)failures.push(`${token}: lead occupies ${(100*leadBars.size/a.totalBars).toFixed(1)}% of bars`);
  const last=Math.max(...notes.map(e=>e.tBeat+e.dur));
  if(end-last>4.1)failures.push(`${token}: silent tail ${(end-last).toFixed(2)} beats`);
  const expected=end*60/a.bpm;
  if(Math.abs(composer.duration(token)-expected)>1e-9)failures.push(`${token}: duration mismatch`);
}
if(failures.length){
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`composer smoke: ${seeds.length} deterministic finite songs`);
