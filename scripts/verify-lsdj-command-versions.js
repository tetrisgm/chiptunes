#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const L = require('../src/lsdj'), api = require('../src/api');
const CT = require('../src/create'), A = require('../src/gb-apu');
const rom = process.env.LSDJ_ROM, play = process.env.LSDJPLAY || '/tmp/lsdjplay';
const trace = process.env.LSDJ_TRACE || '/tmp/lsdjtrace';

for(const version of [7,8,22]) {
  for(let id=0;id<=(version<8?22:23);id++)
    assert.strictEqual(L.decodeCommand(L.encodeCommand(id,version),version),id);
  for(const raw of [24,127,255]) assert.strictEqual(L.decodeCommand(raw,version),null);
}
assert.strictEqual(L.encodeCommand(L.COMMANDS.A,22),2,'A is not encoded as B');
assert.strictEqual(L.encodeCommand(L.COMMANDS.B,22),1);
assert.strictEqual(L.decodeCommand(9,22),L.COMMANDS.K);
assert.strictEqual(L.decodeCommand(16,22),L.COMMANDS.T);
assert.strictEqual(L.decodeCommand(8,7),L.COMMANDS.K);
assert.strictEqual(L.decodeCommand(15,7),L.COMMANDS.T);
assert.strictEqual(L.decodeCommand(9,23),null,'unknown future layout is not guessed');
assert.throws(()=>L.encodeCommand(L.COMMANDS.B,7));
assert.throws(()=>L.encodeCommand(255,22));
const rawUnknown=L.readSong(L.emptySong()); rawUnknown.formatVersion=22;
rawUnknown.phraseCommands[0][0]=255;
assert.strictEqual(L.readSong(L.writeSong(rawUnknown)).phraseCommands[0][0],255);
console.log('ok format 7/8/22 canonical command identity, inverse encoding, and unknown handling');

// A occupied melody command must survive; the song-wide T can use another
// channel. Explicit empty phrases keep that command at its absolute row.
const lateDoc=api.fromJSON({bpm:128,bars:4,notes:[0,16,32,48].map(step=>({
  lane:'Melody',step,note:'C4',len:4,stamp:'trumpet',motion:step===48?'arp':undefined
}))});
const lateState=CT.docState(lateDoc); lateState.tempoAt=[[48,80]];
const lateModel=L.readSong(L.fromDocument(CT.docFromState(lateState)).bytes);
assert.strictEqual(L.sequenceRows(lateModel,0).find(r=>r.row===48).commandId,L.COMMANDS.C);
assert.strictEqual(L.sequenceRows(lateModel,1).find(r=>r.row===48).commandId,L.COMMANDS.T);
assert.deepStrictEqual(L.toSongJSON(lateModel).tempoAt,[[48,80]]);
console.log('ok tempo allocation preserves occupied effects and command-only channel timing');
const tailDoc=api.fromJSON({bpm:128,bars:4,notes:[{
  lane:'Melody',step:24,note:'C4',len:16,stamp:'trumpet'
}]});
const tailState=CT.docState(tailDoc); tailState.tempoAt=[[48,80]];
const tailRows=L.sequenceRows(L.readSong(L.fromDocument(CT.docFromState(tailState)).bytes),0);
assert.strictEqual(tailRows.find(r=>r.row===40).commandId,L.COMMANDS.K,
  'a command-only tail must not erase an earlier note-off');
const conflict=L.readSong(L.emptySong());
conflict.sequence.forEach(r=>r.fill(255)); conflict.chainPhrases.forEach(r=>r.fill(255));
for(let ch=0;ch<2;ch++) {
  conflict.sequence[0][ch]=ch; conflict.chainPhrases[ch][0]=ch;
  conflict.phraseCommands[ch][0]=15; conflict.phraseCommandVals[ch][0]=80+10*ch;
}
assert.throws(()=>L.toSongJSON(conflict),/conflicting tempo commands/);
const saturated=CT.docState(lateDoc);
saturated.tempoAt=[[4,80],[4,81],[4,82],[4,83],[4,84]];
assert.throws(()=>L.fromDocument(CT.docFromState(saturated)),/no free command column/);
console.log('ok conflicting native T and saturated command columns reject explicitly');

function nativeChecks(commandRow) {
  if (!rom || !fs.existsSync(rom)) { console.log('SKIP native command versions: set LSDJ_ROM'); return; }
  assert(fs.existsSync(play) && fs.existsSync(trace), 'native harness binaries required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-command-versions-'));
  const doc = api.fromJSON({ title:'Versions', bpm:128, bars:3, notes:[
    {lane:'Melody', step:6, note:'C4', len:6, stamp:'trumpet', velocity:0.4},
    {lane:'Melody', step:16, note:'E4', len:6, stamp:'trumpet', velocity:0.4},
    {lane:'Melody', step:24, note:'G4', len:6, stamp:'trumpet', velocity:0.4}
  ] });
  const oldSav = Buffer.from(api.toLsdjSav([doc]).bytes), old = L.readSong(oldSav);
  const phrase = old.chainPhrases[old.sequence[0][0]][Math.floor(commandRow/16)];
  old.phraseCommands[phrase][commandRow%16] = 15; // format-7 T, NOT encoder-derived
  old.phraseCommandVals[phrase][commandRow%16] = 80;
  // Unused phrase/table markers observe the ROM's command-column migration,
  // without executing arbitrary effects. Raw 1 is NOT an A/B semantic oracle:
  // this ROM's upgrader leaves it at 1 while shifting raw 2 and above.
  for(let i=0;i<16;i++) {
    old.phraseCommands[200][i]=i+1;
    old.tables1[31][i]=i+1; old.tableCommands[31][i]=i+1;
  }
  oldSav.set(L.writeSong(old));
  const original = path.join(dir,'original.sav'), upgradedSong = path.join(dir,'upgraded.song');
  fs.writeFileSync(original, oldSav, {flag:'wx'});
  cp.execFileSync(play, [rom, original, '400', '1'], {
    env:{...process.env, LSDJ_BOOT_SONG:upgradedSong}, stdio:'ignore'
  });
  assert(fs.existsSync(upgradedSong), 'rebuild tools/lsdjplay.c with LSDJ_BOOT_SONG support');
  const upgraded = fs.readFileSync(upgradedSong), newer = L.readSong(upgraded);
  assert.strictEqual(old.formatVersion,7); assert.strictEqual(newer.formatVersion,22);
  assert.strictEqual(newer.phraseCommands[phrase][commandRow%16],16, 'ROM migrates T to raw 16');
  const tRow=L.sequenceRows(newer,0).find(r=>r.row===commandRow);
  assert.strictEqual(tRow.command,16,'raw structural byte remains intact');
  assert.strictEqual(tRow.commandId,L.COMMANDS.T,'normalized structural identity is separate');
  for(const name of ['phraseCommands','tables1','tableCommands']) {
    const slot = name==='phraseCommands'?200:31;
    for(let i=1;i<16;i++) assert.strictEqual(newer[name][slot][i],i+2, name+' ROM migration');
    assert.strictEqual(newer[name][slot][0],1, 'record raw-1 upgrader behavior without assuming A/B parity');
  }
  assert.deepStrictEqual(Buffer.from(L.writeSong(newer)),upgraded,'raw newer-format bytes survive');
  const newSav = Buffer.from(oldSav); newSav.set(upgraded);
  const current = path.join(dir,'current.sav'); fs.writeFileSync(current,newSav,{flag:'wx'});
  const nativeRows = file => cp.execFileSync(trace,[rom,file,'400','300'],{
    encoding:'utf8',stdio:['ignore','pipe','ignore']
  }).split('\n').filter(s=>/^(frame,|\d+,)/.test(s)).join('\n');
  const before = nativeRows(original), after = nativeRows(current);
  assert(before.includes('VOL1'), 'volume-aware trace required');
  assert.strictEqual(after,before,'original and ROM-upgraded saves have identical frame/register/volume traces');
  const a=L.toSongJSON(old), b=L.toSongJSON(newer);
  assert.deepStrictEqual(b.json,a.json,'K note lengths and pitches survive newer format import');
  assert.deepStrictEqual(b.tempoAt,[[commandRow,80]],'newer T remains a tempo change, not V');
  const aDoc=api.fromLsdsng(oldSav).doc, bDoc=api.fromLsdsng(newSav).doc;
  assert.deepStrictEqual(CT.docState(bDoc).tempoAt,[[commandRow,80]],'document codec retains row-zero and later T');
  assert.deepStrictEqual(api.toJSON(bDoc),api.toJSON(aDoc),'full document import preserves the same performance');
  const reexport = path.join(dir,'reexport.sav');
  fs.writeFileSync(reexport,Buffer.from(api.toLsdjSav([bDoc]).bytes),{flag:'wx'});
  // Duty/pitch registers can differ while silent (the exporter clears them).
  // Compare the audible state and the timing of each change instead.
  function audibleRows(csv) {
    const lines=csv.split('\n'), header=lines.shift().split(','); let previous=''; const out=[];
    for(const line of lines) {
      const row=line.split(',').map(Number), get=k=>row[header.indexOf(k)];
      const vol=get('ON1')?get('VOL1'):0;
      const state=vol?[vol,get('NR11')>>6,get('NR13')|((get('NR14')&7)<<8)]:[0];
      const key=JSON.stringify(state);
      if(key!==previous){out.push([row[0],state]);previous=key;}
    }
    const start=out.find(x=>x[1][0]>0)[0];
    return out.filter(x=>x[0]>=start).map(x=>[x[0]-start,x[1]]);
  }
  assert.deepStrictEqual(audibleRows(nativeRows(reexport)),audibleRows(after),'re-export preserves native K/T pulse state and frame timing');
  const seq=new A.Sequencer(CT.songOf(bDoc).gb,44100), browser=[]; let previous='';
  for(let f=0;f<300;f++) {
    seq._runFrame(); seq.apu._advance(A.FRAME_CYCLES);
    const channel=seq.apu.ch[0], vol=channel.on?channel.vol:0;
    const state=vol?[vol,channel.duty,channel.freq]:[0], key=JSON.stringify(state);
    if(key!==previous){browser.push([f,state]); previous=key;}
  }
  const first=browser.find(x=>x[1][0]>0)[0];
  const events=browser.filter(x=>x[0]>=first).map(x=>[x[0]-first,x[1]]), actual=audibleRows(after);
  assert.strictEqual(events.length,actual.length,'browser has the native sounding transitions');
  events.forEach((event,i)=>{
    assert.deepStrictEqual(event[1],actual[i][1],'browser pulse volume/duty/pitch');
    assert(Math.abs(event[0]-actual[i][0])<=1,'browser K/T transition within the existing one-frame sampling boundary');
  });
  console.log('ok ROM-upgraded format 22: K/T at row '+commandRow+', table/phrase migration, and native re-export timing');
}
nativeChecks(0); // T on the first row, previously excluded by the document codec
nativeChecks(16); // T alongside a note
nativeChecks(20); // command-only T partway through a sounding note
