#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const E = require('../src/music-exports.js');
const A = require('../src/gb-apu.js');
const R = require('../src/gb-rom.js');
const fixture = () => ({ gb: {
  totalFrames: 120,
  notes: [{ ch: 0, frame: 3, frames: 17, midi: 60, inst: 0, vel: 0.8 }],
  bank: { instruments: [[128, 242, 0, 0]], waveTables: [Array(32).fill(8)] },
  auto: [{ f: 9, r: 0x11, v: 64 }], vibOff: [{ f: 11, ch: 0 }],
  waveLoads: [{ f: 15, slot: 0 }], kit: [{ f: 21, id: 0 }]
}, settings: { bpm: 128 } });
const revision = compiled => ({ id: 'r-12', validated: true, compiled });
async function main() {
  const c = fixture(), rev = revision(c), sr = 8000;
  assert.equal(E.inspect(c, 'wav').ok, true);
  const wav = await E.exportRevision(rev, 'wav', { sampleRate: sr });
  const v = new DataView(wav.bytes.buffer);
  assert.equal(Buffer.from(wav.bytes.subarray(0, 4)).toString(), 'RIFF');
  assert.equal(v.getUint32(4, true), wav.bytes.length - 8);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), sr);
  const pcm = new Float32Array(Math.ceil(120 * 70224 / 4194304 * sr));
  new A.Sequencer(c.gb, sr).render(pcm, 0, pcm.length);
  assert.equal(wav.bytes.length, 44 + pcm.length * 2);
  assert(pcm.some(x => x !== 0));
  pcm.forEach((x, i) => { const s = Math.max(-1, Math.min(1, x)); assert.equal(v.getInt16(44 + i * 2, true), Math.round(s * (s < 0 ? 32768 : 32767)) || 0); });
  const mutable = fixture(); let yields = 0;
  const chunked = await E.exportRevision(revision(mutable), 'wav', { sampleRate: sr, yield: async () => { yields++; mutable.gb.notes[0].midi = 90; } });
  assert(yields > 0); assert.deepEqual(chunked.bytes, wav.bytes);
  assert.equal(chunked.revision, 'r-12');
  assert.equal(E.inspect(c, 'midi').losses.length, 1);
  await assert.rejects(E.exportRevision(rev, 'midi'), /allowLosses/);
  await assert.rejects(E.exportRevision(rev, 'midi', { allowLosses: 'true' }), /allowLosses/);
  const mid = await E.exportRevision(rev, 'midi', { allowLosses: true });
  assert.equal(Buffer.from(mid.bytes.subarray(0, 4)).toString(), 'MThd');
  const mv = new DataView(mid.bytes.buffer);
  assert.equal(mv.getUint16(12), 16384);
  assert.equal(mv.getUint32(18), mid.bytes.length - 22);
  let pos = 22, ticks = 0; const events = [];
  while (pos < mid.bytes.length) {
    let delta = 0, b; do { b = mid.bytes[pos++]; delta = delta * 128 + (b & 127); } while (b & 128);
    ticks += delta; const status = mid.bytes[pos++];
    if (status === 255) {
      const type = mid.bytes[pos++], len = mid.bytes[pos++];
      if (type === 81) assert.deepEqual(Array.from(mid.bytes.subarray(pos, pos + len)), [0, 244, 36]);
      if (type === 47) assert.equal(ticks, 120 * 4389);
      pos += len;
    } else { events.push([ticks, status, mid.bytes[pos++], mid.bytes[pos++]]); }
  }
  assert.deepEqual(events, [[3 * 4389, 144, 60, 102], [20 * 4389, 128, 60, 0]]);
  assert.equal(events[0][0] * 62500 / 16384 / 1000000, 3 * 70224 / 4194304);
  const rom = await E.exportRevision(rev, 'rom');
  assert.deepEqual(rom.bytes, R.buildRom({ gb: c.gb })); assert.equal(rom.bytes.length, 32768);
  let checksum = 0; for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - rom.bytes[i] - 1) & 255;
  assert.equal(rom.bytes[0x14d], checksum);
  assert.equal(E.inspect(c, 'lsdsng').ok, false);
  const lsdjReport = E.inspect(c, 'lsdsng');
  assert(lsdjReport.errors.some(e => /automation/.test(e)));
  assert(lsdjReport.errors.some(e => /wave tables/.test(e)));
  assert(lsdjReport.errors.some(e => /PCM kit/.test(e)));
  const plain = fixture();
  plain.gb.auto = []; plain.gb.vibOff = []; plain.gb.waveLoads = []; plain.gb.kit = [];
  plain.gb.notes[0].trigger = true; plain.gb.bank.instruments[0][1] = 240;
  const plainReport = E.inspect(plain, 'lsdsng');
  assert.equal(plainReport.ok, false);
  assert(plainReport.errors.some(e => /timing\/end/.test(e)));
  assert(!plainReport.errors.some(e => /PCM kit|register automation/.test(e)));
  // Actual shared exporter, isolated document input seam. No compiler or
  // approximation adapter is introduced into the production bridge.
  // Two different exact-frame documents collapse to identical native bytes.
  let state = { bpm: 128, grid: 16, bars: 1, groove: [6], cells: [
    { r: 0, ch: 0, c: 0, len: 1, midi: 60, st: 'piano', vel: 1, of: 0, lf: 2 }
  ] };
  const lctx = vm.createContext({ Uint8Array, atob, CT_CREATE: {
    docState: () => state, tables: () => ({ melodicRows: 12, drums: ['hat', 'snare', 'kick'] })
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lsdj.js'), 'utf8'), lctx);
  const before = lctx.CT_LSDJ.lsdsng('fixture');
  state = { ...state, cells: [{ ...state.cells[0], of: 3, lf: 5 }] };
  const after = lctx.CT_LSDJ.lsdsng('fixture');
  assert.deepEqual(before.file, after.file, 'existing LSDj writer ignores changed exact offset/length');
  assert(before.warnings.some(w => /envelope shapes are left plain/.test(w)));
  const native = lctx.CT_LSDJ.readSong(before.bytes);
  assert.deepEqual(lctx.CT_LSDJ.writeSong(native), before.bytes,
    'native byte roundtrip succeeds despite the demonstrated timing loss');
  await assert.rejects(E.exportRevision(rev, 'lsdsng', { allowLosses: true }), /no verified exact/);
  await assert.rejects(E.exportRevision({ ...rev, validated: false }, 'wav'), /validated revision/);
  await assert.rejects(E.exportRevision({ ...rev, id: '../oops' }, 'wav'), /stable id/);
  assert.equal(E.inspect({ ...c, native: true }, 'wav').ok, false);
  assert.equal(E.inspect(c, 'mp3').ok, false);
  for (const value of [0, Infinity, -1, 60000]) { const bad = fixture(); bad.gb.totalFrames = value; assert.equal(E.inspect(bad, 'wav').ok, false); }
  await assert.rejects(E.exportRevision(rev, 'wav', { sampleRate: 192000 }), /sampleRate/);
  const big = fixture(); big.gb.totalFrames = 35000;
  await assert.rejects(E.exportRevision(revision(big), 'wav', { sampleRate: 96000 }), /sample allocation/);
  const many = fixture(); many.gb.notes = Array(100001).fill(c.gb.notes[0]); assert.equal(E.inspect(many, 'wav').ok, false);
  const cyclic = fixture(); cyclic.settings.self = cyclic; assert.equal(E.inspect(cyclic, 'wav').ok, false);
  const overflow = fixture(); overflow.gb.totalFrames = 30000;
  overflow.gb.notes = Array.from({ length: 10000 }, (_, i) => ({ ch: i % 4, frame: i * 2, frames: 1, midi: 60, inst: 0 }));
  assert.equal(E.inspect(overflow, 'rom').ok, false);
  // Exercise the browser UMD branch without require, compiler, DOM or audio context.
  const ctx = vm.createContext({ Uint8Array, Float32Array, DataView, ArrayBuffer });
  for (const file of ['gb-hardware.js', 'gb-kits.js', 'gb-apu.js', 'gb-rom.js', 'music-exports.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), ctx);
  const browserWav = await ctx.CT_MUSIC_EXPORTS.exportRevision(revision(fixture()), 'wav', { sampleRate: sr });
  assert.deepEqual(browserWav.bytes, wav.bytes);
  const browserMidi = await ctx.CT_MUSIC_EXPORTS.exportRevision(revision(fixture()), 'midi', { allowLosses: true });
  assert.deepEqual(browserMidi.bytes, mid.bytes);
  assert.equal(ctx.CT_MUSIC_EXPORTS.inspect(plain, 'lsdsng').ok, false);
  console.log('verify-music-exports: PCM parity, MIDI frame times, ROM bytes, capabilities, revision isolation and bounds passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
