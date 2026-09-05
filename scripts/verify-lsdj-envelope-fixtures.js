'use strict';
// Owner-ROM evidence, not a claim of envelope playback parity. In particular,
// mGBA's model-dependent decay volume is not a hardware oracle.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const api = require('../src/api');
const L = require('../src/lsdj');
const rom = process.env.LSDJ_ROM;
if (!rom || !fs.existsSync(rom)) {
  console.log('SKIP envelope fixtures: set LSDJ_ROM, LSDJPLAY and LSDJ_TRACE');
  process.exit(0);
}
const play = process.env.LSDJPLAY || '/tmp/lsdjplay';
const trace = process.env.LSDJ_TRACE || '/tmp/lsdjtrace';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-envelope-fixtures-'));
function fixture(shape, bpm = 128, volume = 8, channel = 0) {
  const bytes = Buffer.from(api.toLsdjSav([api.fromJSON({bpm, bars:4, notes:[
    {lane:'Melody', step:6, note:'C4', len:4, stamp:'trumpet', velocity:volume/15}
  ]})]).bytes);
  const m = L.readSong(bytes), slot = L.playedNotes(m, 0)[0].instrument;
  m.instrumentParams[slot][1] = (volume << 4) | shape;
  m.instrumentParams[slot][3] = 0;
  m.phraseCommands.forEach(p => p.fill(0));
  m.phraseCommandVals.forEach(p => p.fill(0));
  if (channel === 1) m.sequence.forEach(row => { row[1] = row[0]; row[0] = 255; });
  bytes.set(L.writeSong(m));
  return {bytes, m, slot};
}
function save(name, bytes) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes, {flag:'wx'});
  return file;
}
function run(executable, file, frames, env = {}) {
  const before = fs.readFileSync(file);
  const result = cp.spawnSync(executable, [rom, file, '400', String(frames)], {
    encoding:'utf8', env:{...process.env, ...env}, maxBuffer:8*1024*1024
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.deepStrictEqual(fs.readFileSync(file), before, 'probe must not rewrite its source SAV; rebuild tools');
  return result;
}
function csv(output) {
  return output.split('\n').filter(s => /^(frame,|\d+,)/.test(s)).join('\n');
}
// Independently observed owner-ROM v7 -> v22 migration, not our encoder rules.
const rates = [0,5,7,8,9,10,11,11];
for (let shape = 0; shape < 16; shape++) {
  const {bytes,m,slot} = fixture(shape), file = save(`old-${shape}.sav`, bytes);
  const upgraded = path.join(dir, `upgraded-${shape}.song`);
  run(play, file, 1, {LSDJ_BOOT_SONG:upgraded});
  const raw = fs.readFileSync(upgraded), modern = L.readSong(raw);
  assert.strictEqual(m.formatVersion, 7);
  assert.strictEqual(modern.formatVersion, 22);
  const p = modern.instrumentParams[slot];
  assert.strictEqual(p[1], 0x80 | rates[shape & 7]);
  assert.strictEqual(p[9], shape > 8 ? 0xF0 : 0);
  assert.strictEqual(p[10], 0);
  const newer = Buffer.from(bytes); newer.set(raw);
  const modernFile = save(`modern-${shape}.sav`, newer);
  assert.strictEqual(csv(run(trace,file,180,{LSDJ_MODEL:'CGB'}).stdout),
    csv(run(trace,modernFile,180,{LSDJ_MODEL:'CGB'}).stdout), 'migration preserves observed snapshots');
}
// Rises are visible under both models. Test distinct initial volumes, both
// pulse channels and tempos; do not mislabel a continued rise as a note cut.
let cases = 0;
for (const model of ['DMG','CGB']) for (const bpm of [80,128,180])
for (const volume of [1,8,14]) for (const channel of [0,1]) {
  const {bytes} = fixture(9,bpm,volume,channel);
  const result = run(trace,save(`${model}-${bpm}-${volume}-${channel}.sav`,bytes),180,{LSDJ_MODEL:model});
  assert(result.stderr.includes(`MODEL=${model}`), 'rebuild model-reporting trace');
  const lines = csv(result.stdout).split('\n'), header = lines.shift().split(',');
  const on = header.indexOf(`ON${channel+1}`), vol = header.indexOf(`VOL${channel+1}`);
  const levels=[];
  for (const line of lines) {
    const row=line.split(',').map(Number);
    if (row[on] && levels[levels.length-1] !== row[vol]) levels.push(row[vol]);
  }
  assert.deepStrictEqual(levels,Array.from({length:16-volume},(_,i)=>volume+i),`${model}/${bpm}/${volume}/PU${channel+1}`);
  cases++;
}
// A typo must fail, not silently choose an unknown model; a missing save must
// not be created (the previous mCoreLoadSaveFile call did create one).
const missing = path.join(dir,'missing.sav');
for (const tool of [play,trace]) {
  const result=cp.spawnSync(tool,[rom,missing,'1','1'],{encoding:'utf8'});
  assert.notStrictEqual(result.status,0);
  assert(!fs.existsSync(missing));
}
const invalid=cp.spawnSync(trace,[rom,path.join(dir,'old-0.sav'),'1','1'],{
  encoding:'utf8',env:{...process.env,LSDJ_MODEL:'TYPO'}
});
assert.strictEqual(invalid.status,2);
console.log(`PASS envelope evidence: 16 migrations, ${cases} pulse/model/tempo/volume rises, immutable saves; ${dir}`);
