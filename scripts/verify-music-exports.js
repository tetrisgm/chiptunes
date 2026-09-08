#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const E = require('../src/music-exports.js');
const A = require('../src/gb-apu.js');
const R = require('../src/gb-rom.js');
const H = require('../src/gb-hardware.js');
const CPU = require('../src/gb-cpu.js');
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
  // Real Create may append to the default 128-entry bank. Neither the WAV
  // renderer nor ROM note encoding stores an instrument index in seven bits.
  const appended = fixture();
  appended.gb.auto = []; appended.gb.vibOff = []; appended.gb.waveLoads = []; appended.gb.kit = [];
  appended.gb.bank.instruments = Array.from({ length: 129 }, () => [0, 0, 255, 0]);
  appended.gb.bank.instruments[128] = [128, 240, 255, 0];
  appended.gb.notes = [{ ch: 0, frame: 3, frames: 17, midi: 60, inst: 128, vel: 1, trigger: true }];
  assert.equal(E.inspect(appended, 'wav').ok, true);
  const appendedWav = await E.exportRevision(revision(appended), 'wav', { sampleRate: sr });
  const appendedPcm = new Float32Array(pcm.length);
  new A.Sequencer(appended.gb, sr).render(appendedPcm, 0, appendedPcm.length);
  const av = new DataView(appendedWav.bytes.buffer);
  assert(appendedPcm.some(x => x !== 0), 'index 128 must sound, not fall back to silent index 0/127');
  appendedPcm.forEach((x, i) => { const s = Math.max(-1, Math.min(1, x)); assert.equal(av.getInt16(44 + i * 2, true), Math.round(s * (s < 0 ? 32768 : 32767)) || 0); });
  assert.equal(E.inspect(appended, 'rom').ok, true);
  const appendedRom = await E.exportRevision(revision(appended), 'rom');
  assert.deepEqual(appendedRom.bytes, R.buildRom({ gb: appended.gb }));
  const writes = [], cpu = new CPU.Cpu(appendedRom.bytes, { onIo: (reg, val) => writes.push([reg, val]) });
  while (cpu.frame < 30) cpu.step();
  const expected = H.noteRegisters(appended.gb.notes[0], appended.gb.bank);
  assert(writes.some((w, i) => w[0] === 0x11 && expected.every((value, j) => writes[i + j] && writes[i + j][0] === 0x11 + j && writes[i + j][1] === value)), 'actual ROM CPU writes the appended instrument register tuple');
  const missingInst = structuredClone(appended); missingInst.gb.notes[0].inst = 129;
  assert.equal(E.inspect(missingInst, 'wav').ok, false, 'missing bank entries still rejected');
  const noise = structuredClone(appended); noise.gb.notes[0].ch = 3; delete noise.gb.notes[0].midi;
  assert.equal(E.inspect(noise, 'wav').ok, true);
  assert.equal(E.inspect(noise, 'rom').ok, true);
  noise.gb.notes[0].midi = null;
  assert.equal(E.inspect(noise, 'wav').ok, true, 'explicit null noise pitch supported');
  assert.match(E.inspect(noise, 'midi').errors.join(';'), /no MIDI pitch/);
  await assert.rejects(E.exportRevision(revision(noise), 'midi', { allowLosses: true }), /no MIDI pitch/);
  const overEnd = structuredClone(appended);
  overEnd.gb.gainScalar = undefined;
  overEnd.gb.notes[0].frames = 130;
  overEnd.gb.vibOff = [{ f: 11.25, ch: 0 }, { f: 120, ch: 0 }];
  assert.equal(E.inspect(overEnd, 'wav').ok, true);
  assert.match(E.inspect(overEnd, 'rom').errors.join(';'), /beyond finite song end/);
  await assert.rejects(E.exportRevision(revision(overEnd), 'rom'), /beyond finite song end/);
  const endWav = await E.exportRevision(revision(overEnd), 'wav', { sampleRate: sr });
  assert.equal(endWav.bytes.length, appendedWav.bytes.length, 'finite duration preserved without rewriting held note');
  const endPcm = new Float32Array(pcm.length);
  new A.Sequencer(overEnd.gb, sr).render(endPcm, 0, endPcm.length);
  const ev = new DataView(endWav.bytes.buffer);
  endPcm.forEach((x, i) => { const s = Math.max(-1, Math.min(1, x)); assert.equal(ev.getInt16(44 + i * 2, true), Math.round(s * (s < 0 ? 32768 : 32767)) || 0); });
  const endMidi = await E.exportRevision(revision(overEnd), 'midi', { allowLosses: true });
  assert(endMidi.warnings.some(w => /note-offs are capped/.test(w)));
  assert.equal(overEnd.gb.notes[0].frames, 130, 'export does not mutate note lengths');
  const extraWave = fixture(), romSlots = Math.max(16, H.WAVE_SLOTS || 16);
  extraWave.gb.bank.waveTables = Array.from({ length: romSlots + 1 }, () => Array(32).fill(8));
  extraWave.gb.waveLoads = [{ f: 15, slot: romSlots }];
  assert.equal(E.inspect(extraWave, 'wav').ok, true);
  assert.match(E.inspect(extraWave, 'rom').errors.join(';'), /stored wave slots/);
  await assert.rejects(E.exportRevision(revision(extraWave), 'rom', { allowLosses: true }), /stored wave slots/);
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
  const browserAppended = await ctx.CT_MUSIC_EXPORTS.exportRevision(revision(appended), 'wav', { sampleRate: sr });
  assert.deepEqual(browserAppended.bytes, appendedWav.bytes);
  const browserMidi = await ctx.CT_MUSIC_EXPORTS.exportRevision(revision(fixture()), 'midi', { allowLosses: true });
  assert.deepEqual(browserMidi.bytes, mid.bytes);
  assert.equal(ctx.CT_MUSIC_EXPORTS.inspect(plain, 'lsdsng').ok, false);
  // Regression against actual generated Create data, not sanitized JSON copies:
  // specifically exercises optional undefined metadata and appended instruments.
  const api = require('../src/api.js'), CT = require('../src/create.js');
  const prompts = ['chill', 'happy', 'boss', 'cave', 'sad', 'title', 'battle', 'peaceful', 'fast', 'no drums'];
  const stats = { songs: 0, maxBank: 0, noiseWithoutMidi: 0, overEndNotes: 0 };
  for (let i = 0; i < 100; i++) {
    const prompt = prompts[i % prompts.length], token = 'music-exports-real-' + String(i).padStart(3, '0');
    const made = api.ask(prompt, { brief: { token } }), song = CT.songOf(made.doc);
    assert(song && song.gb, prompt + '/' + token + ': actual song required');
    const compiled = { gb: song.gb, settings: { tempo: song.bpm, bars: song.bars } };
    const report = E.inspect(compiled, 'wav');
    assert.equal(report.ok, true, prompt + '/' + token + ': ' + report.errors.join(';'));
    assert.equal(ctx.CT_MUSIC_EXPORTS.inspect(compiled, 'wav').ok, true, 'browser accepts same generated score');
    stats.songs++; stats.maxBank = Math.max(stats.maxBank, song.gb.bank.instruments.length);
    stats.noiseWithoutMidi += song.gb.notes.filter(n => n.ch === 3 && n.midi == null).length;
    stats.overEndNotes += song.gb.notes.filter(n => n.frame + n.frames > song.gb.totalFrames).length;
  }
  console.log('actual Create WAV inspection: ' + JSON.stringify(stats));
  console.log('verify-music-exports: PCM parity, MIDI frame times, ROM bytes, capabilities, revision isolation and bounds passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
