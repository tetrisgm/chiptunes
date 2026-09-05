#!/usr/bin/env node
'use strict';
// Listening material, not an aesthetic gate. Render saved pre-change Scores
// and one current composition per token through the same production APU core.
// Dry mono previews omit the player's output processing/device latency.
const fs=require('fs'),os=require('os'),path=require('path');
const C=require('../src/composer'),A=require('../src/gb-apu');
const baseline=process.argv[2];
if(!baseline)throw new Error('usage: node scripts/render-composition-comparison.js BASELINE_SCORES_JSON [TOKEN ...]');
const saved=JSON.parse(fs.readFileSync(baseline,'utf8'));
const tokens=process.argv.length>3?process.argv.slice(3):['smoke-song-0','smoke-song-21'];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chiptunes-melody-listening-'));
const sampleRate=44100,seconds=45,gain=0.8,manifest=[];
function render(score,name){
  const samples=new Float32Array(sampleRate*seconds),seq=new A.Sequencer(score.gb,sampleRate);
  seq.render(samples,0,samples.length);
  const wav=Buffer.alloc(44+samples.length*2);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples.length*2,40);
  let peak=0;
  for(let i=0;i<samples.length;i++){
    const v=samples[i]*gain;
    if(!Number.isFinite(v)||Math.abs(v)>1)throw new Error('invalid/clipping comparison PCM');
    peak=Math.max(peak,Math.abs(v));wav.writeInt16LE(Math.round(v*32767),44+i*2);
  }
  const file=path.join(dir,name+'.wav');fs.writeFileSync(file,wav,{flag:'wx'});
  return{file,peak,seconds,sampleRate,gain};
}
tokens.forEach((token,i)=>{
  const before=saved.find(s=>s.token===token);
  if(!before||!before.gb)throw new Error('baseline Score missing: '+token);
  const after=C.compile(token);
  manifest.push({token,style:after.style,bpm:after.bpm,
    beforeRevision:before.composerRevision,afterRevision:after.composerRevision,
    before:render(before,i+'-before'),after:render(after,i+'-after')});
});
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({measurement:'dry mono production APU; equal gain; no listening verdict',manifest},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({directory:dir,manifest},null,2));
