#!/usr/bin/env node
'use strict';

// Diagnostic, not a parity gate: frame-sample both engines' active pitch state.
// Their start origins differ, and pitch alone says nothing about timbre.
// Build tools/lsdjplay.c and provide LSDJPLAY and a private LSDJ_ROM.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const api = require('../src/api.js');
const create = require('../src/create.js');
const APU = require('../src/gb-apu.js');
const L = require('../src/lsdj.js');
const rom = process.env.LSDJ_ROM, player = process.env.LSDJPLAY;
if (!rom || !player) throw new Error('Set LSDJ_ROM and LSDJPLAY; this diagnostic must run both engines.');
const doc = api.brief({ scene: 'battle', seconds: 30, token: '7f3a12bc55de90aa' }).doc;
const song = create.songOf(doc);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-pitches-'));
const sav = path.join(tmp, 'fixture.sav');
const midi = (period, ch) => Math.round(69 + 12 * Math.log2((ch === 2 ? 65536 : 131072) / (2048 - period) / 440));
const intended = [0, 1, 2].map(ch => new Set(song.gb.notes.filter(n => n.ch === ch).map(n => n.midi)));
const browser = [new Set(), new Set(), new Set()];
const seq = new APU.Sequencer(song.gb, 44100);
const buffer = new Float32Array(Math.round(seq.samplesPerFrame));
for (let f = 0; f < 2400; f++) {
  seq.render(buffer, 0, buffer.length);
  seq.apu.ch.slice(0, 3).forEach((ch, i) => { if (ch.on) browser[i].add(midi(ch.freq, i)); });
}
try {
  const bytes = Buffer.from(api.toLsdjSav([doc], { name: 'TEST' }).bytes);
  // Optional controlled intervention in the first pulse instrument only.
  // This changes the private diagnostic save, never the document or export.
  if (process.argv.length > 2) {
    const offset = Number(process.argv[2]), value = Number(process.argv[3]);
    if (!Number.isInteger(offset) || offset < 0 || offset > 15 ||
        !Number.isInteger(value) || value < 0 || value > 255) throw new Error('Expected byte offset 0..15 and value 0..255');
    bytes[L.OFFSETS.INSTRUMENT_PARAMS + 16 + offset] = value;
    console.log('Diagnostic instrument 1 byte ' + offset + ' = ' + value);
  }
  fs.writeFileSync(sav, bytes);
  if (process.env.LSDJ_TRACE) {
    const trace = cp.execFileSync(process.env.LSDJ_TRACE, [rom, sav, '400', '80'], {
      stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 1 << 20
    }).split('\n').filter(l => /^(frame,|\d+,)/.test(l));
    const header = trace.shift().split(',');
    console.log('First pulse register snapshots', trace.map(l => {
      const row = l.split(',').map(Number);
      return Object.fromEntries(['frame', 'NR10', 'NR12', 'NR13', 'NR14'].map(k => [k, row[header.indexOf(k)]]));
    }));
  }
  const output = cp.execFileSync(player, [rom, sav, '400', '2400'], {
    env: { ...process.env, LSDJ_TRACE_PITCH: '1' }, maxBuffer: 8 << 20,
    stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8'
  });
  const rows = output.split('\n').filter(l => l.startsWith('PITCH ')).map(l => l.split(' ').slice(1).map(Number));
  if (!rows.length) throw new Error('No PITCH samples; rebuild tools/lsdjplay.c.');
  for (let ch = 0; ch < 3; ch++) {
    const active = rows.filter(r => r[1] === ch && r[3]);
    const actual = new Set(active.map(r => midi(r[2], ch)));
    const extra = [...actual].filter(n => !browser[ch].has(n));
    console.log(JSON.stringify({ channel: ch, written: [...intended[ch]],
      browserActivePitches: [...browser[ch]], lsdjActivePitches: [...actual],
      lsdjOnlyPitches: extra,
      firstUnexpectedSamples: active.filter(r => extra.includes(midi(r[2], ch))).slice(0, 12)
    }));
  }
} finally {
  if (fs.existsSync(sav)) fs.unlinkSync(sav);
  fs.rmdirSync(tmp);
}
