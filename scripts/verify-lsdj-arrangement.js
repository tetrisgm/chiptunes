#!/usr/bin/env node
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const api = require('../src/api');
const L = require('../src/lsdj');
const H = require('../src/gb-hardware');

const rom = process.env.LSDJ_ROM;
const trace = process.env.LSDJ_TRACE || '/tmp/lsdjtrace';
const hasRom = rom && fs.existsSync(rom) && fs.existsSync(trace);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-arrangement-'));

function modelFor(doc) {
  return L.readSong(Buffer.from(api.toLsdjSav([doc]).bytes));
}
function clearArrangement(m) {
  m.sequence.forEach(row => row.fill(255));
  m.chainPhrases.forEach(row => row.fill(255));
  m.chainTranspose.forEach(row => row.fill(0));
}
function setChain(m, chain, phrases) {
  m.chainPhrases[chain].fill(255);
  phrases.forEach((phrase, i) => { m.chainPhrases[chain][i] = phrase; });
}
function phraseAt(m, midi) {
  for (let p = 0; p < m.phraseNotes.length; p++) {
    for (let r = 0; r < 16; r++) {
      if (m.phraseNotes[p][r] === midi - 36 + 1) return { phrase: p, row: r };
    }
  }
  throw new Error('phrase not found for MIDI ' + midi);
}
function baseDoc(bars = 3) {
  return api.fromJSON({ title: 'Arrangement audit', bpm: 128, bars, notes: [
    { lane: 'Melody', step: 6, note: 'C4', len: 4, stamp: 'trumpet', velocity: .4 },
    { lane: 'Melody', step: 22, note: 'E4', len: 4, stamp: 'trumpet', velocity: .4 },
    { lane: 'Melody', step: 38, note: 'G4', len: 4, stamp: 'trumpet', velocity: .4 }
  ]});
}
function exportedFixture() {
  const m = modelFor(baseDoc());
  const c = phraseAt(m, 60), e = phraseAt(m, 64), g = phraseAt(m, 67);
  clearArrangement(m);
  setChain(m, 0, [c.phrase, 255, g.phrase]);
  setChain(m, 10, [e.phrase, 255]);
  m.sequence[0][0] = 0;
  m.sequence[1][0] = 10;
  return { m, c, e, g };
}
function notes(report) { return report.json.notes.map(n => [n.note, n.step]); }

console.log('LSDj arrangement rows: end markers, row zero, and independent cycles');
{
  const { m, c, e, g } = exportedFixture();
  const raw = L.playedNotes(m, 0).filter(n => n.midi === 60 || n.midi === 67);
  assert(raw.some(n => n.midi === 67), 'legacy structural walk retains stale ghost G');
  m.sequence[1][0] = 255;
  assert.deepStrictEqual(notes(L.toSongJSON(m)), [['C4', 6]], 'chain end ignores stale G');

  m.sequence[1][0] = 10;
  assert.deepStrictEqual(notes(L.toSongJSON(m)), [['C4', 6], ['E4', 22]], 'next sequence row is reachable');

  m.sequence[1][0] = 255; m.sequence[2][0] = 10;
  assert.deepStrictEqual(notes(L.toSongJSON(m)), [['C4', 6]], 'sequence hole ends the arrangement');

  m.sequence[0][0] = 255; m.sequence[1][0] = 0;
  assert.deepStrictEqual(notes(L.toSongJSON(m)), [], 'leading sequence hole is silent');

  m.sequence[0][0] = 0; setChain(m, 0, [255]); m.sequence[1][0] = 10;
  assert.deepStrictEqual(notes(L.toSongJSON(m)), [], 'empty first chain is silent');

  // Restore the exported fixture and make channel cycles 16 and 32 rows long.
  clearArrangement(m); setChain(m, 0, [c.phrase]); setChain(m, 10, [e.phrase, g.phrase]);
  m.sequence[0][0] = 0; m.sequence[0][1] = 10;
  const arrangement = L.arrangementRows(m);
  assert.deepStrictEqual(arrangement[0].filter(n => n.note).map(n => n.row), [6, 22]);
  assert.deepStrictEqual(arrangement[1].filter(n => n.note).map(n => n.row), [6, 22]);
  assert.deepStrictEqual(notes(L.toSongJSON(m)), [['C4', 6], ['E4', 6], ['C4', 22], ['G4', 22]],
    'independent cycles unroll to their LCM');
  assert.strictEqual(L.toSongJSON(m).json.bars, 2, 'LCM arrangement duration is two bars');
}

console.log('command reachability and document duration');
{
  const m = modelFor(baseDoc());
  const p = phraseAt(m, 60).phrase;
  const q = phraseAt(m, 64).phrase;
  clearArrangement(m); setChain(m, 0, [p, 255, q]); m.sequence[0][0] = 0;
  m.phraseCommands[p][4] = L.COMMANDS.T; m.phraseCommandVals[p][4] = 80;
  m.phraseCommands[q][12] = L.COMMANDS.T; m.phraseCommandVals[q][12] = 90;
  setChain(m, 1, [255]);
  assert.deepStrictEqual(L.toSongJSON(m).tempoAt, [[4, 80]], 'reachable command retained, command after end ignored');
  setChain(m, 1, [q, q]); m.sequence[0][1] = 1;
  m.phraseCommands[q][12] = 0;
  assert.deepStrictEqual(L.toSongJSON(m).tempoAt, [[4, 80], [20, 80]], 'T repeats with the shorter channel cycle');

  const four = api.fromJSON({ title: 'Four bars', bpm: 128, bars: 4, notes: [] });
  assert.strictEqual(L.toSongJSON(modelFor(four)).json.bars, 4, 'blank declared four-bar song keeps duration');
  const fourBack = api.fromLsdsng(api.toLsdjSav([four]).bytes).doc;
  assert.strictEqual(api.toJSON(fourBack).bars, 4, 'four-bar duration survives export/import');
  assert.strictEqual(L.sequenceRows(modelFor(four), 0).length, 64, 'empty tail remains structurally 64 rows');
  const tail = api.fromJSON({bpm:128,bars:4,notes:[
    {lane:'Melody',step:0,note:'C4',len:1,stamp:'trumpet',velocity:.4}
  ]});
  assert.strictEqual(api.toJSON(api.fromLsdsng(api.toLsdjSav([tail]).bytes).doc).bars,4,
    'a populated song preserves three explicitly empty trailing bars');
  for (let seed=0;seed<12;seed++) {
    const made=api.brief({scene:'battle',seconds:30,token:'arrangement-duration-'+seed});
    const declared=api.toJSON(made.doc).bars;
    const rows=L.arrangementRows(modelFor(made.doc));
    assert(rows.some(ch=>ch.length===declared*16),'generated document duration is preserved, not extended');
    assert.strictEqual(api.toJSON(api.fromLsdsng(api.toLsdjSav([made.doc]).bytes).doc).bars,declared);
  }
}

console.log('oversized independent cycles are rejected before row wrap');
{
  const m = L.readSong(L.emptySong());
  m.sequence.forEach(row => row.fill(255));
  m.chainPhrases.forEach(row => row.fill(255));
  m.chainTranspose.forEach(row => row.fill(0));
  setChain(m, 0, Array(16).fill(0));
  setChain(m, 1, Array(16).fill(0));
  setChain(m, 2, [0]); setChain(m, 3, [0,0,0]);
  m.sequence[0][0]=0; m.sequence[1][0]=2; // 17 phrases
  m.sequence[0][1]=1; m.sequence[1][1]=3; // 19 phrases
  assert.throws(() => L.arrangementRows(m), /exceeds.*4096/,
    'LCM beyond the 12-bit row budget must not wrap');
}

{
  const m=L.readSong(L.emptySong());clearArrangement(m);
  setChain(m,0,[0,0,0,1]);m.sequence[0][0]=0;
  for(const p of [0,1]) {m.phraseCommands[p].fill(L.COMMANDS.T);m.phraseCommandVals[p].fill(80);}
  assert.throws(()=>L.toSongJSON(m),/63 tempo-command limit/,'64 T rows must not silently truncate');
  m.phraseCommands[1][15]=0;
  assert.strictEqual(L.toSongJSON(m).tempoAt.length,63,'63 T rows fit without truncation');
}

if (hasRom) {
  const { m, c, e, g } = exportedFixture();
  clearArrangement(m); setChain(m, 0, [c.phrase]); setChain(m, 10, [e.phrase, g.phrase]);
  m.sequence[0][0] = 0; m.sequence[0][1] = 10;
  const sav = Buffer.from(api.toLsdjSav([baseDoc()]).bytes);
  Buffer.from(L.writeSong(m)).copy(sav, 0);
  const file = path.join(tmp, 'unequal-cycles.sav'); fs.writeFileSync(file, sav, { flag: 'wx' });
  const reexport = path.join(tmp, 'unequal-cycles-reexport.sav');
  fs.writeFileSync(reexport, Buffer.from(api.toLsdjSav([api.fromLsdsng(sav).doc]).bytes), { flag: 'wx' });
  const expected = H.lsdjRowFrame(128, [6], 22) - H.lsdjRowFrame(128, [6], 6);
  function soundingFrames(input) {
    const csv = cp.execFileSync(trace, [rom, input, '400', '600'], { encoding: 'utf8', stdio:['ignore','pipe','ignore'] })
      .split('\n').filter(s => /^(frame,|\d+,)/.test(s));
    const header = csv.shift().split(',');
    assert(header.includes('VOL1'), 'volume-aware trace required');
    const states = csv.map(s => s.split(',').map(Number));
    const out = [];
    for (let ch = 0; ch < 2; ch++) {
      const base = ch + 1;
      for (const row of states) {
        const on = row[header.indexOf('ON' + base)] && row[header.indexOf('VOL' + base)] > 0;
        if (!on) continue;
        const period = row[header.indexOf('NR' + base + '3')] | ((row[header.indexOf('NR' + base + '4')] & 7) << 8);
        out.push([row[0], ch, period, row[header.indexOf('VOL' + base)]]);
      }
    }
    return out;
  }
  const original = soundingFrames(file), roundTrip = soundingFrames(reexport);
  assert.deepStrictEqual(roundTrip, original, 're-export preserves every sounding frame, channel, period, and volume');
  for (const kind of ['chain-end','next-sequence','sequence-hole','leading-hole','empty-first-chain','empty-second-chain']) {
    const fixture=exportedFixture();
    if(kind==='chain-end')fixture.m.sequence[1][0]=255;
    if(kind==='sequence-hole') {fixture.m.sequence[1][0]=255;fixture.m.sequence[2][0]=10;}
    if(kind==='leading-hole') {fixture.m.sequence[0][0]=255;fixture.m.sequence[1][0]=0;}
    if(kind==='empty-first-chain')setChain(fixture.m,0,[255]);
    if(kind==='empty-second-chain') {
      setChain(fixture.m,10,[255]);setChain(fixture.m,11,[fixture.e.phrase]);fixture.m.sequence[2][0]=11;
      assert.deepStrictEqual(notes(L.toSongJSON(fixture.m)),[['C4',6]],'empty later chain ends the current cycle');
    }
    const bytes=Buffer.from(sav); bytes.set(L.writeSong(fixture.m));
    const nativeFile=path.join(tmp,kind+'.sav');fs.writeFileSync(nativeFile,bytes,{flag:'wx'});
    const states=soundingFrames(nativeFile).filter(row=>row[1]===0);
    const onsets=states.filter((row,i)=>!i||row[0]!==states[i-1][0]+1);
    if(kind==='leading-hole'||kind==='empty-first-chain')assert.strictEqual(states.length,0,kind+' remains silent');
    else {
      assert.deepStrictEqual(onsets.map(row=>row[0]),[19,131,243,355,467,579],kind+' native loop timing');
      assert.deepStrictEqual(onsets.map(row=>row[2]),kind==='next-sequence'?
        [1547,1650,1547,1650,1547,1650]:Array(6).fill(1547),kind+' ignores unreachable pitches');
    }
  }
  function onset(ch, midi) {
    const period = H.midiToPeriod(midi, 'pulse').period;
    return original.find(row => row[1] === ch && Math.abs(row[2] - period) <= 1);
  }
  const c0 = onset(0, 60), e1 = onset(1, 64), g1 = onset(1, 67);
  assert(c0 && e1 && g1, 'unequal-cycle notes actually sound');
  assert.strictEqual(e1[0] - c0[0], 0, 'cycle starts align at row zero');
  assert.strictEqual(g1[0] - e1[0], expected, 'native row spacing is preserved');
  const tail=api.fromJSON({bpm:128,bars:4,notes:[
    {lane:'Melody',step:6,note:'C4',len:4,stamp:'trumpet',velocity:.4}
  ]});
  const tailFile=path.join(tmp,'declared-tail.sav');
  fs.writeFileSync(tailFile,Buffer.from(api.toLsdjSav([tail]).bytes),{flag:'wx'});
  const frames=soundingFrames(tailFile).filter(row=>row[1]===0);
  const starts=frames.filter((row,i)=>!i||row[0]!==frames[i-1][0]+1).map(row=>row[0]);
  assert.strictEqual(starts.length,2,'exactly two starts in 600 frames with a four-bar loop');
  assert.strictEqual(starts[1]-starts[0],448,'declared empty tail delays native loop restart by four bars');
  console.log('ok ROM trace: unequal-cycle frame parity and 448-frame declared-tail loop');
} else {
  console.log('SKIP ROM trace (set LSDJ_ROM and LSDJ_TRACE)');
}

console.log('ok verify-lsdj-arrangement');
