#!/usr/bin/env node
'use strict';
// Long-session product audition. It measures audible-risk invariants, not
// invented aesthetic scores or corpus diversity quotas.
const fs=require('fs'),path=require('path');
const composer=require('../src/composer.js');
const ROOT=path.resolve(__dirname,'..');
function arg(name,fallback){const i=process.argv.indexOf(`--${name}`);return i>=0&&process.argv[i+1]?+process.argv[i+1]:fallback;}
const count=Math.max(8,arg('seeds',60)),rows=[],problems=[];
for(let i=0;i<count;i++){
  const token=`audition-song-${i}`,score=composer.compile(token),end=score.totalBars*4;
  const notes=score.events.filter(e=>e.kind!=='chord');
  const leadBars=new Set(notes.filter(e=>e.ch==='lead').map(e=>Math.floor(e.tBeat/4))).size;
  const last=Math.max(...notes.map(e=>e.tBeat+e.dur));
  const velocities=notes.map(e=>e.vel||0),peak=Math.max(...velocities);
  const row={token,bpm:score.bpm,bars:score.totalBars,durationSec:composer.duration(token),
    events:notes.length,leadShare:leadBars/score.totalBars,silentTailBeats:end-last,peakVelocity:peak};
  rows.push(row);
  if(row.durationSec<100||row.durationSec>136)problems.push(`${token}: duration ${row.durationSec.toFixed(1)}s`);
  if(row.leadShare>0.14)problems.push(`${token}: lead share ${(100*row.leadShare).toFixed(1)}%`);
  if(row.silentTailBeats>4.1)problems.push(`${token}: silent tail ${row.silentTailBeats.toFixed(2)} beats`);
  if(row.peakVelocity>1)problems.push(`${token}: velocity ${row.peakVelocity}`);
}
const report={generatedAt:new Date().toISOString(),composer:composer.revision,seeds:count,problems,rows};
const out=path.join(ROOT,'health','audition-generated-music.json');
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log(`audition: ${count} finite songs, duration/lead/handoff/level gates passed`);
