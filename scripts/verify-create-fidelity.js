#!/usr/bin/env node
'use strict';

// Phase 0 characterization, not a lossless acceptance gate. A LOSS passing
// means the named loss still exists. When fixed, replace that assertion with
// a preservation assertion. No build, browser, network, or file writes.
const assert = require('node:assert/strict');
const api = require('../src/api.js');
const CT = require('../src/create.js');
const HW = require('../src/gb-hardware.js');
require('../src/gb-kits.js');
const clone = x => JSON.parse(JSON.stringify(x));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
}
function state() {
  return CT.docState(api.fromJSON({ bpm: 127, bars: 4, notes: [
    { lane: 'Melody', step: 4, note: 'C4', len: 2, velocity: 1 },
    { lane: 'Harmony', step: 12, note: 'G4', len: 2, velocity: 1 },
    { lane: 'Bass', step: 20, note: 'C3', len: 2, velocity: 1 },
    { lane: 'Drums', step: 28, drum: 'kick', velocity: 1 }
  ] }));
}
function pack(s) {
  const doc = CT.docFromState(s);
  assert.ok(doc, 'fixture must encode');
  assert.ok(CT.docState(doc), 'fixture must decode');
  return doc;
}
function readable(doc) { return api.fromJSON(api.toJSON(doc)); }
function gb(doc) {
  const song = CT.songOf(doc);
  assert.ok(song, 'fixture must materialize audible note events');
  return song.gb;
}
const bank = gb(pack(state())).bank;
const pulse = bank.meta.find(m => m.type === 'pulse').index;
const noise = bank.meta.find(m => m.type === 'noise').index;
function score() {
  return { bpm: 127, gainScalar: 0.76, gb: {
    bank: clone(bank), totalFrames: 300, loopFrames: 0, gainScalar: 0.375,
    notes: [
      { ch: 0, frame: 31, frames: 13, midi: 60, inst: pulse, vel: 0.731, pri: 8, det: 7, sweep: 0x12, trigger: false },
      { ch: 3, frame: 80, frames: 17, midi: null, inst: noise, vel: 1, pri: 9 }
    ],
    auto: [{ f: 35, r: 0x11, v: 0x40 }, { f: 35, r: 0x11, v: 0x80 }],
    vibOff: [{ f: 32, ch: 0 }], waveLoads: [{ f: 38, slot: 2 }], kit: [{ f: 90, id: 0 }]
  } };
}
function imported(s) {
  const result = CT.songFrom(s, 'Fidelity audit');
  assert.ok(result && result.gb, 'concrete fixture must import');
  return result;
}

test('PRESERVE packed offsets -32/+31 and exact lengths 1/4095', () => {
  const s = state();
  Object.assign(s.cells[0], { of: -32, lf: 1 });
  Object.assign(s.cells[1], { of: 31, lf: 4095 });
  const doc = pack(s), back = CT.docState(doc);
  for (const i of [0, 1]) for (const k of ['of', 'lf']) assert.equal(back.cells[i][k], s.cells[i][k], k);
  assert.deepEqual(gb(doc), gb(pack(back)), 'packed no-op must preserve the entire rebuilt score');
});

test('LOSS readable JSON drops exact onset/duration; len is only grid length', () => {
  const s = state(); Object.assign(s.cells[0], { of: 3, lf: 11 });
  const doc = pack(s), back = CT.docState(readable(doc));
  assert.equal(back.cells[0].of, undefined, 'known loss: of is omitted');
  assert.equal(back.cells[0].lf, undefined, 'known loss: lf is omitted');
  assert.equal(gb(doc).notes[0].frame - gb(readable(doc)).notes[0].frame, 3);
  assert.equal(gb(doc).notes[0].frames, 11);
  assert.notEqual(gb(readable(doc)).notes[0].frames, 11, 'known loss: duration reconstructed from len');
});

test('PRESERVE packed tempo map/master; LOSS readable map/master', () => {
  const s = state(); s.tempoAt = [[0, 120], [16, 80]]; s.master = 5;
  const doc = pack(s), back = CT.docState(doc), r = CT.docState(readable(doc));
  assert.deepEqual(back.tempoAt, s.tempoAt); assert.equal(back.master, 5);
  assert.equal(gb(doc).gainScalar, 6 / 16);
  assert.deepEqual(r.tempoAt, [], 'known loss: readable tempo map reset');
  assert.equal(r.master, null, 'known loss: readable master reset');
  assert.equal(gb(readable(doc)).gainScalar, undefined);
  assert.notEqual(gb(doc).notes[2].frame, gb(readable(doc)).notes[2].frame);
});

test('LOSS song end ignores tempo map although note onsets use it', () => {
  const s = state(); s.tempoAt = [[16, 80]];
  const song = gb(pack(s)), groove = HW.lsdjGrooveTicks(0, 16);
  const end = HW.lsdjRowFrame(127, groove, 16) + HW.lsdjRowFrame(80, groove, 48);
  assert.equal(song.totalFrames, Math.round(64 * HW.lsdjFramesPerRow(127, groove)));
  assert.notEqual(song.totalFrames, end, 'known loss: finite end uses base tempo only');
  assert.equal(song.loopFrames, song.totalFrames, 'current transport loop is coupled to finite length');
});

test('PRESERVE packed movement/sound fields; LOSS readable omits them', () => {
  const s = state();
  const extra = { vb: 1, sq: 1, pn: 2, gl: 1, dt: -7, sweep: 0x12 };
  Object.assign(s.cells[0], extra);
  s.cells[2].mp = 1; Object.assign(s.cells[3], { ns: 1, nz: 7, fd: 2 });
  const doc = pack(s), back = CT.docState(doc), r = CT.docState(readable(doc));
  for (const [key, value] of Object.entries(extra)) {
    assert.equal(back.cells[0][key], value, 'packed ' + key);
    assert.equal(r.cells[0][key], undefined, 'known readable loss: ' + key);
  }
  assert.equal(back.cells[2].mp, 1); assert.equal(r.cells[2].mp, undefined);
  assert.equal(back.cells[3].ns, 1); assert.equal(r.cells[3].ns, undefined);
  const a = gb(doc), b = gb(readable(doc));
  assert.ok(a.auto.length && a.vibOff.length && a.waveLoads.length, 'fixture actually expands movement streams');
  for (const key of ['auto', 'vibOff', 'waveLoads']) assert.deepEqual(b[key], [], 'known readable loss: ' + key);
});

test('PRESERVE packed kit selector; LOSS readable converts kit to noise', () => {
  const s = state(); s.cells[3].kt = 1;
  const doc = pack(s);
  assert.equal(CT.docState(doc).cells[3].kt, 1);
  assert.equal(gb(doc).kit.length, 1);
  assert.deepEqual(gb(readable(doc)).kit, [], 'known loss: kt omitted');
  assert.equal(gb(readable(doc)).notes.filter(n => n.ch === 3).length, 1);
});

test('PRESERVE trigger true/false/absent through packed and readable paths', () => {
  for (const nt of [undefined, 1, 2]) {
    const s = state(); if (nt != null) s.cells[0].nt = nt;
    for (const doc of [pack(s), readable(pack(s))]) {
      assert.equal(CT.docState(doc).cells[0].nt, nt);
      assert.equal(gb(doc).notes[0].trigger, nt == null ? undefined : nt === 1);
    }
  }
});

test('LOSS packed velocity quantization and overflow are silent', () => {
  const s = state(); Object.assign(s.cells[0], { vel: 0.731, of: 32, lf: 4096, dt: 48, len: 65 });
  const x = CT.docState(pack(s)).cells[0];
  assert.equal(x.vel, Math.round(0.731 * 63) / 63); assert.notEqual(x.vel, 0.731);
  assert.equal(x.of, -32, 'known wrap: offset 32 becomes -32');
  assert.equal(x.lf, undefined, 'known wrap: duration 4096 becomes absent');
  assert.equal(x.dt, -16, 'known wrap: detune 48 becomes -16');
  assert.equal(x.len, undefined, 'known wrap: grid length 65 becomes implicit 1');
});

test('LOSS packed state has no arbitrary event-stream or asset payload', () => {
  const s = state(), fixture = score().gb;
  for (const key of ['auto', 'vibOff', 'waveLoads', 'kit', 'bank', 'totalFrames', 'gainScalar']) s[key] = fixture[key];
  const back = CT.docState(pack(s));
  for (const key of ['auto', 'vibOff', 'waveLoads', 'kit', 'bank', 'totalFrames', 'gainScalar'])
    assert.equal(back[key], undefined, 'known packed omission: ' + key);
});

test('LOSS concrete import retains melodic timing but loses drum duration/trigger/detune/role', () => {
  const s = score(), made = imported(s), a = made.gb.notes[0], b = gb(made.code).notes[0];
  assert.equal(a.frame, 31); assert.equal(a.frames, 13); assert.equal(a.sweep, 0x12);
  assert.equal(b.frame, 31); assert.equal(b.frames, 13);
  assert.equal(a.trigger, undefined, 'known import loss: pitch-only event becomes ordinary trigger');
  assert.equal(a.det, 0, 'known import loss: detune'); assert.equal(a.pri, 5, 'known import loss: mixer role');
  assert.notEqual(made.gb.notes.find(n => n.ch === 3).frames, 17, 'known import loss: noise exact duration');
  assert.equal(b.vel, Math.round(s.gb.notes[0].vel * 63) / 63);
  assert.notDeepEqual(made.gb, gb(made.code), 'known loss: songFrom builds pre-encode velocity, songOf decodes quantized velocity');
});

test('LOSS concrete import drops automation/vibOff/waveLoads/kits/gain and exact end', () => {
  const s = score(), made = imported(s);
  for (const key of ['auto', 'vibOff', 'waveLoads', 'kit']) {
    assert.ok(s.gb[key].length); assert.deepEqual(made.gb[key], [], 'known import omission: ' + key);
  }
  assert.equal(made.gb.gainScalar, undefined, 'neither Score.gainScalar nor gb.gainScalar imported');
  assert.notEqual(made.gb.totalFrames, s.gb.totalFrames, 'known loss: end rounded to bars');
  assert.notEqual(made.gb.loopFrames, 0, 'known loss: finite source gains loopFrames');
});

test('LOSS concrete custom bank replaced even when instrument index survives', () => {
  const s = score();
  s.gb.bank.instruments[pulse][0] ^= 0xC0;
  s.gb.bank.waveTables[0][0] ^= 15;
  const made = imported(s);
  assert.equal(made.gb.notes[0].inst, pulse);
  assert.notDeepEqual(made.gb.bank.instruments[pulse], s.gb.bank.instruments[pulse], 'known loss: record bytes replaced');
  assert.notDeepEqual(made.gb.bank.waveTables, s.gb.bank.waveTables, 'known loss: wave asset replaced');
  assert.deepEqual(made.gb.bank.arpTables, bank.arpTables, 'rebuild takes bundled arp tables');
});

test('LOSS overlapping concrete notes silently removed on import', () => {
  const s = score(); s.gb.notes = [s.gb.notes[0], { ...s.gb.notes[0], frame: 32, midi: 64 }];
  assert.equal(imported(s).gb.notes.length, 1, 'known loss: same-channel overlap dropped, no returned diagnostic');
});

test('PRESERVE distinct concrete onsets in one display column', () => {
  const s = score(); s.gb.notes = [
    { ch: 0, frame: 28, frames: 1, midi: 60, inst: pulse, vel: 1, pri: 5 },
    { ch: 0, frame: 30, frames: 1, midi: 62, inst: pulse, vel: 1, pri: 5 }
  ];
  const made = imported(s), cells = CT.docState(made.code).cells;
  assert.equal(cells.length, 2); assert.equal(cells[0].c, cells[1].c);
  assert.deepEqual(gb(made.code).notes.map(n => [n.frame, n.frames]), [[28, 1], [30, 1]]);
});

test('LOSS readable fall preserves gesture but replaces explicit sweep byte', () => {
  const s = state(); Object.assign(s.cells[0], { z: 1, sweep: 0x12, inst: pulse });
  const doc = pack(s), json = api.toJSON(doc);
  assert.equal(json.notes[0].instrument, pulse); assert.equal(json.notes[0].motion, 'fall');
  assert.equal(gb(doc).notes[0].sweep, 0x12);
  assert.equal(gb(readable(doc)).notes[0].sweep, 0x3E, 'known approximation: fall default replaces explicit sweep');
});

test('LOSS packed tempo-map count truncates and row address wraps', () => {
  const s = state(); s.tempoAt = Array.from({ length: 64 }, (_, i) => [i, 80]);
  assert.equal(CT.docState(pack(s)).tempoAt.length, 63, 'known truncation: only 63 tempo changes');
  s.tempoAt = [[4096, 80]];
  assert.deepEqual(CT.docState(pack(s)).tempoAt, [[0, 80]], 'known wrap: 12-bit tempo row');
});

test('LOSS drum lf is stored but ignored by materialization', () => {
  const s = state(); s.cells[3].lf = 37;
  const doc = pack(s); assert.equal(CT.docState(doc).cells[3].lf, 37);
  assert.notEqual(gb(doc).notes.find(n => n.ch === 3).frames, 37, 'known loss: drum branch ignores lf');
});

test('PRESERVE repeated packed materialization and detached state ownership', () => {
  const s = state(), before = clone(s), doc = pack(s);
  assert.deepEqual(s, before, 'encoding must not mutate caller state');
  const a = gb(doc), b = gb(doc); assert.deepEqual(a, b);
  const copy = CT.docState(doc); copy.cells[0].midi = 99;
  assert.notEqual(CT.docState(doc).cells[0].midi, 99);
});

console.log(`\n${passed} characterization groups passed; ${failed} failed. LOSS means reproduced, not fixed.`);
process.exitCode = failed ? 1 : 0;
