#!/usr/bin/env node
'use strict';
const Live=require('../src/live.js'),composer=require('../src/composer.js');
const failures=[];
for(const block of [0,1,495888,Math.floor(Date.now()/Live.BLOCK_MS)]){
  const a=Live.blockPlaylist(block),b=Live.blockPlaylist(block);
  if(JSON.stringify(a)!==JSON.stringify(b))failures.push(`${block}: nondeterministic playlist`);
  if(!a.length||a[0].start!==0)failures.push(`${block}: uncovered start`);
  for(let i=0;i<a.length;i++){
    const row=a[i],dur=composer.duration(row.token);
    if(Math.abs(row.dur-dur)>1e-9)failures.push(`${block}/${i}: duration mismatch`);
    if(i&&Math.abs(row.start-(a[i-1].start+a[i-1].dur))>1e-9)failures.push(`${block}/${i}: gap or overlap`);
  }
  const last=a[a.length-1];if(last.start+last.dur<Live.BLOCK_SEC)failures.push(`${block}: uncovered end`);
}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('live schedule: deterministic, gapless, one composer');
