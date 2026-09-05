#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const api=require('../src/api'),L=require('../src/lsdj'),H=require('../src/gb-hardware');
const rom=process.env.LSDJ_ROM,trace=process.env.LSDJ_TRACE||'/tmp/lsdjtrace';
const hasRom=rom&&fs.existsSync(rom)&&fs.existsSync(trace);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chiptunes-sparse-phrases-'));
const cases=[
  {name:'pulse1-middle-gap',first:0,second:0,row:54},
  {name:'pulse2-middle-gap',first:1,second:1,row:54},
  {name:'leading-and-trailing-channel-gaps',first:0,second:1,row:54},
  {name:'whole-chain-gap',first:0,second:0,row:310}
];
for(const test of cases){
  const lanes=['Melody','Harmony'];
  const doc=api.fromJSON({title:'Sparse phrases',bpm:128,bars:Math.ceil((test.row+4)/16),notes:[
    {lane:lanes[test.first],step:6,note:'C4',len:4,stamp:'trumpet',velocity:.4},
    {lane:lanes[test.second],step:test.row,note:'G4',len:4,stamp:'trumpet',velocity:.4}
  ]});
  const sav=Buffer.from(api.toLsdjSav([doc]).bytes),m=L.readSong(sav);
  const first=L.playedNotes(m,test.first).find(n=>n.midi===60);
  const second=L.playedNotes(m,test.second).find(n=>n.midi===67);
  assert.strictEqual(first.row,6);assert.strictEqual(second.row,test.row,'empty phrases retain absolute time');
  for(let ch=0;ch<4;ch++)if(ch!==test.first&&ch!==test.second)
    assert(!L.sequenceRows(m,ch).length,'wholly unused channel stays absent');
  const imported=api.toJSON(api.fromLsdsng(sav).doc);
  assert.deepStrictEqual(imported.notes.map(n=>n.step),[6,test.row]);
  if(hasRom){
    const file=path.join(dir,test.name+'.sav');fs.writeFileSync(file,sav,{flag:'wx'});
    const expected=H.lsdjRowFrame(128,[6],test.row)-H.lsdjRowFrame(128,[6],6);
    const csv=cp.execFileSync(trace,[rom,file,'400',String(expected+250)],{
      encoding:'utf8',stdio:['ignore','pipe','ignore']
    }).split('\n').filter(s=>/^(frame,|\d+,)/.test(s));
    const header=csv.shift().split(',');assert(header.includes('VOL1'),'volume-aware trace required');
    const states=csv.map(s=>s.split(',').map(Number));
    function firstSound(ch,midi){
      const period=H.midiToPeriod(midi,'pulse').period, base=ch+1;
      return states.find(row=>{
        const get=k=>row[header.indexOf(k)];
        return get('ON'+base)&&get('VOL'+base)>0&&Math.abs((get('NR'+base+'3')|((get('NR'+base+'4')&7)<<8))-period)<=1;
      });
    }
    const a=firstSound(test.first,60),b=firstSound(test.second,67);
    assert(a&&b,'both notes must actually sound in LSDj, not just parse');
    assert.strictEqual(b[0]-a[0],expected,'native frame spacing through the empty phrases');
    let wasOn=false,starts=0;
    for(const row of states.filter(row=>row[0]<b[0])){
      const on=row[header.indexOf('ON'+(test.first+1))]&&row[header.indexOf('VOL'+(test.first+1))]>0;
      if(on&&!wasOn)starts++;wasOn=on;
    }
    assert.strictEqual(starts,1,'empty phrases must not introduce early loop retriggers');
    console.log('ok '+test.name+': native gap '+expected+' frames');
  }else console.log('ok '+test.name+': structural/import timing; SKIP ROM (set LSDJ_ROM/LSDJ_TRACE)');
}
