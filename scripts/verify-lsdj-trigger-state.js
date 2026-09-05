#!/usr/bin/env node
'use strict';
// Native blank instrument fields are pitch changes, not fresh note-ons.
// Check document/edit/export preservation, browser state, cartridge writes,
// and independently observed state in the owner's real LSDj ROM when present.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const api = require('../src/api'), CT = require('../src/create'), L = require('../src/lsdj');
const H = require('../src/gb-hardware'), A = require('../src/gb-apu');
const CPU = require('../src/gb-cpu'), ROM = require('../src/gb-rom');
const rom = process.env.LSDJ_ROM, trace = process.env.LSDJ_TRACE || '/tmp/lsdjtrace';
const hasRom = rom && fs.existsSync(rom) && fs.existsSync(trace);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-trigger-test-'));
const files = [];
function nativeState(bytes, ch) {
  const file = path.join(tmp, 'fixture-' + files.length + '.sav');
  files.push(file); fs.writeFileSync(file, bytes);
  const rows = cp.execFileSync(trace, [rom, file, '400', '185'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).split('\n').filter(l => /^(frame,|\d+,)/.test(l));
  const header = rows.shift().split(',');
  assert(header.includes('VOL' + (ch + 1)), 'rebuild tools/lsdjtrace.c for volume observations');
  const pick = (row, name) => +row[header.indexOf(name)];
  const states = rows.map(line => {
    const row = line.split(','), base = ch ? 2 : 1;
    return { f: +row[0], vol: pick(row, 'ON' + (ch + 1)) ? pick(row, 'VOL' + (ch + 1)) : 0,
      duty: pick(row, 'NR' + base + '1') >> 6,
      period: pick(row, 'NR' + base + '3') | ((pick(row, 'NR' + base + '4') & 7) << 8) };
  });
  const start = states.find(s => s.vol > 0).f;
  return offset => states.filter(s => s.f <= start + offset).slice(-1)[0];
}
try {
  assert.deepStrictEqual(H.noteOffFrames([
    { ch: 0, frame: 0, frames: 10 }, { ch: 0, frame: 10, frames: 10, trigger: false }
  ]), [null, 20], 'continuation must not cut the held voice');
  assert.deepStrictEqual(H.noteOffFrames([
    { ch: 0, frame: 0, frames: 10 }, { ch: 0, frame: 12, frames: 10, trigger: false }
  ]), [10, 22], 'a gap must retain the real note-off');
  for (const [lane, ch] of [['Melody', 0], ['Harmony', 1]]) for (const scenario of ['hold', 'killed', 'restart', 'zero']) {
    const pitchOnly = scenario === 'hold' || scenario === 'killed';
    const doc = api.fromJSON({ title: 'Triggers', bpm: 128, bars: 2, notes: [
      { lane, step: 6, note: 'C4', len: scenario === 'hold' ? 10 : 8, stamp: 'trumpet', velocity: 0.4, sound: { shape: 3 } },
      { lane, step: 16, note: 'E4', len: 6, stamp: 'trumpet', velocity: scenario === 'zero' ? 0.2 : 0.4, sound: { shape: 3 } },
      { lane, step: 24, note: 'G4', len: 4, stamp: 'trumpet', velocity: 0.4, sound: { shape: 3 } }
    ] });
    const bytes = Buffer.from(api.toLsdjSav([doc]).bytes);
    const model = L.readSong(bytes.subarray(0, L.SONG_BYTES));
    const ph = model.chainPhrases[model.sequence[0][ch]][1];
    // Instrument-only selection followed by a blank instrument is a distinct
    // native case: it can latch new duty settings without resetting volume.
    // Until its row event is represented, import must explicitly report it.
    const latched = L.readSong(bytes.subarray(0, L.SONG_BYTES));
    const firstPhrase = latched.chainPhrases[latched.sequence[0][ch]][0];
    latched.phraseInstruments[firstPhrase][15] = 63;
    latched.phraseInstruments[ph][0] = 255;
    assert.strictEqual(L.playedNotes(latched, ch)[1].effectiveInstrument, 63);
    assert(L.toSongJSON(latched).warnings.some(w => w.includes('instrument-only')),
      'latched instrument-only state must not be silently claimed as supported');
    if (pitchOnly) bytes[L.OFFSETS.PHRASE_INSTRUMENTS + ph * 16] = 255;
    if (scenario === 'zero') bytes[L.OFFSETS.INSTRUMENT_PARAMS + model.phraseInstruments[ph][0] * 16 + 1] = 0;
    const imported = api.fromLsdsng(bytes).doc;
    const json = api.toJSON(imported);
    assert.strictEqual(json.notes[1].trigger, !pitchOnly);
    assert.strictEqual(json.notes[1].stamp, 'trumpet');
    const edited = api.transform(imported, [{ op: 'transpose', semitones: 2 }]).doc;
    assert.strictEqual(api.toJSON(edited).notes[1].trigger, !pitchOnly, 'edit must retain trigger state');
    assert.strictEqual(api.toJSON(api.fromJSON(json)).notes[1].trigger, !pitchOnly);
    const reexport = Buffer.from(api.toLsdjSav([imported]).bytes);
    const returned = L.playedNotes(L.readSong(reexport.subarray(0, L.SONG_BYTES)), ch);
    assert.strictEqual(returned[1].instrument === 255, pitchOnly);
    const song = CT.songOf(imported), seq = new A.Sequencer(song.gb, 44100);
    const states = [];
    for (let f = 0; f < 230; f++) {
      seq._runFrame(); seq.apu._advance(A.FRAME_CYCLES);
      const c = seq.apu.ch[ch]; states.push({ f, vol: c.on ? c.vol : 0, period: c.freq, duty: c.duty });
    }
    const first = states.find(s => s.vol > 0).f;
    const second = states[first + 75], third = states[first + 131];
    assert.strictEqual(second.vol, scenario === 'killed' || scenario === 'zero' ? 0 : 6, lane + ' ' + scenario + ' volume');
    assert.strictEqual(second.period, H.midiToPeriod(64, 'pulse').period);
    assert.strictEqual(third.vol, 6, 'explicit instrument restarts after silence');
    // Execute the actual generated cartridge; a no-trigger pitch update must
    // not be accidentally turned back into a note-on by the ROM encoder.
    const built = ROM.buildRom(song), writes = [];
    const cpu = new CPU.Cpu(built.bytes || built, { onIo: (r, v) => writes.push({ f: cpu.frame, r, v }) });
    while (cpu.frame < 200) cpu.step();
    const lo = 0x13 + ch * 5, hi = lo + 1, period = H.midiToPeriod(64, 'pulse').period;
    const at = writes.findIndex((w, i) => w.r === lo && w.v === (period & 255) &&
      writes[i + 1] && writes[i + 1].r === hi && (writes[i + 1].v & 7) === (period >> 8));
    assert(at >= 0, 'cartridge reaches the second pitch');
    assert.strictEqual(!!(writes[at + 1].v & 128), !pitchOnly, 'cartridge trigger bit');
    if (hasRom) {
      const original = nativeState(bytes, ch), exported = nativeState(reexport, ch);
      for (const offset of [5, 60, 75, 115, 131]) {
        const browser = states[first + offset], actual = original(offset), roundtrip = exported(offset);
        assert.strictEqual(browser.vol, actual.vol, lane + ' ' + scenario + ' native volume at ' + offset);
        if (browser.vol) assert.strictEqual(browser.duty, actual.duty, 'native pulse duty');
        // Our note-off clears the high period bits; LSDj retains them while
        // silent. Check sounding pitches, plus the explicit pitch-only update.
        if (browser.vol || offset === 75)
          assert(Math.abs(browser.period - actual.period) <= 1, 'native pitch at ' + offset + ': browser ' + browser.period + ', LSDj ' + actual.period);
        assert.strictEqual(roundtrip.vol, actual.vol, 're-export native volume');
        assert.strictEqual(roundtrip.period, actual.period, 're-export native pitch');
        assert.strictEqual(roundtrip.duty, actual.duty, 're-export native duty');
      }
    }
    console.log('ok ' + lane + ' ' + scenario + ': document, edit, browser, cartridge' + (hasRom ? ', real LSDj and re-export' : ''));
  }
  if (!hasRom) console.log('SKIPPED real LSDj: set LSDJ_ROM and LSDJ_TRACE to the private ROM and rebuilt harness');
} finally {
  files.forEach(f => fs.unlinkSync(f)); fs.rmdirSync(tmp);
}
