// The automation lane has to mean the same thing in both players.
//
// A Game Boy instrument is not just a note-on: it is what the driver writes on
// every frame afterwards -- a duty flipped mid-note, a wave table swapped, a
// period nudged, a channel panned. Create emits those as score.gb.auto, the
// browser's Sequencer applies them, and the cartridge driver has its own
// opcodes for them. Two implementations of one idea drift unless something
// checks, so this builds a score that uses every kind of automation, runs the
// browser chip and the real ROM on an emulated CPU, and compares the register
// writes frame by frame.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

globalThis.CT_GB_HARDWARE = require(path.join(ROOT, 'src', 'gb-hardware.js'));
const HW = globalThis.CT_GB_HARDWARE;
const APU = require(path.join(ROOT, 'src', 'gb-apu.js'));
const ROM = require(path.join(ROOT, 'src', 'gb-rom.js'));
const CPU = require(path.join(ROOT, 'src', 'gb-cpu.js'));
const INSTR = require(path.join(ROOT, 'src', 'chip-instruments.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const bank = HW.buildBank((globalThis.CT_CHIP_INSTRUMENTS || INSTR).patches);
const pulse = bank.meta.find(m => m.type === 'pulse').index;
const wave = bank.meta.find(m => m.type === 'wave').index;
const noise = bank.meta.find(m => m.type === 'noise').index;

// One note per channel, each with a different kind of movement under it.
const score = {
  gb: {
    bank,
    totalFrames: 240,
    loopFrames: 0,
    notes: [
      { ch: 0, frame: 10, frames: 60, midi: 60, inst: pulse, vel: 1, pri: 8 },
      { ch: 1, frame: 10, frames: 60, midi: 67, inst: pulse, vel: 1, pri: 5 },
      { ch: 2, frame: 80, frames: 60, midi: 40, inst: wave,  vel: 1, pri: 5 },
      { ch: 3, frame: 80, frames: 20, midi: null, inst: noise, vel: 1, pri: 9 }
    ],
    // duty flips, a pan, a period nudge, all on their own frames
    auto: [
      { f: 10, r: 0x11, v: 0x40 },        // NR11: 25% duty, right on the note
      { f: 22, r: 0x11, v: 0x80 },        // ...50%
      { f: 34, r: 0x11, v: 0xC0 },        // ...75%
      { f: 16, r: 0x16, v: 0x00 },        // NR21: channel 2 down to 12.5%
      { f: 40, r: 0x25, v: 0xF1 },        // NR51: pan
      { f: 44, r: 0x25, v: 0xFF },        // ...and back
      { f: 50, r: 0x13, v: 0x20 },        // NR13/NR14: pitch, without retrigger
      { f: 50, r: 0x14, v: 0x07 },
      { f: 90, r: 0x1C, v: 0x40 }         // NR32: the wave channel's level
    ],
    vibOff: [{ f: 10, ch: 0 }, { f: 10, ch: 1 }],
    // and a wave table swapped under the sounding note
    waveLoads: [{ f: 92, slot: 2 }, { f: 104, slot: 5 }]
  }
};

// ---- what the browser chip writes -----------------------------------------
function browserWrites(sc, frames) {
  const seq = new APU.Sequencer(sc.gb, 44100);
  const out = [];
  const real = seq.apu.write.bind(seq.apu);
  seq.apu.write = (reg, val) => { out.push({ frame: seq.frame, reg: reg & 0xFF, val: val & 0xFF }); real(reg, val); };
  const perFrame = Math.round(seq.samplesPerFrame);
  const buf = new Float32Array(perFrame);
  for (let f = 0; f < frames; f++) seq.render(buf, 0, perFrame);
  return out;
}

// ---- what the cartridge writes --------------------------------------------
function romWrites(sc, frames) {
  const rom = ROM.buildRom(sc, { title: 'AUTOTEST' });
  const out = [];
  const cpu = new CPU.Cpu(rom, {
    onIo: (reg, val) => { if (reg >= 0x10 && reg <= 0x3F) out.push({ frame: cpu.frame, reg, val }); }
  });
  while (cpu.frame < frames) cpu.step();
  return { writes: out, rom };
}

const FRAMES = 150;
const bw = browserWrites(score, FRAMES);
const rw = romWrites(score, FRAMES);

ok(bw.length > 0, 'the browser chip wrote registers (' + bw.length + ')');
ok(rw.writes.length > 0, 'the cartridge wrote registers (' + rw.writes.length + ')');

// every automation write must appear on both sides, on its own frame
let missBrowser = null, missRom = null, hitB = 0, hitR = 0;
for (const a of score.gb.auto) {
  const near = (list, tol) => list.some(w => w.reg === a.r && w.val === a.v && Math.abs(w.frame - a.f) <= tol);
  if (near(bw, 1)) hitB++; else if (!missBrowser) missBrowser = a;
  if (near(rw.writes, 2)) hitR++; else if (!missRom) missRom = a;
}
ok(hitB === score.gb.auto.length,
   'the browser applied every automation write (' + hitB + '/' + score.gb.auto.length + ')' +
   (missBrowser ? ' -- first miss: frame ' + missBrowser.f + ' reg $' + missBrowser.r.toString(16) : ''));
ok(hitR === score.gb.auto.length,
   'the cartridge applied every automation write (' + hitR + '/' + score.gb.auto.length + ')' +
   (missRom ? ' -- first miss: frame ' + missRom.f + ' reg $' + missRom.r.toString(16) : ''));

// and the two must agree on the ORDER of writes to the same register, or a
// duty sweep would land in a different sequence on the cartridge
// ...ignoring each player's power-on writes, which verify-rom already checks
// (the browser's happen in the Sequencer's constructor, before this spy exists)
function seqFor(list, reg) {
  return list.filter(w => w.reg === reg && w.frame >= 5).map(w => w.val).join(',');
}
for (const reg of [0x11, 0x16, 0x25]) {
  const b = seqFor(bw, reg), r = seqFor(rw.writes, reg);
  ok(b === r, 'register $' + reg.toString(16) + ' gets the same values in the same order' +
     (b === r ? ' (' + b + ')' : '\n         browser:   ' + b + '\n         cartridge: ' + r));
}

// vibrato hand-off: with it, the driver must not touch the period itself
const vibWrites = bw.filter(w => (w.reg === 0x13 || w.reg === 0x14) && w.frame > 12 && w.frame < 60);
ok(vibWrites.length === 2,
   'the driver left the pitch alone once the note took it over (' + vibWrites.length + ' period writes, expected the 2 automated ones)');

const romVib = rw.writes.filter(w => (w.reg === 0x13 || w.reg === 0x14) && w.frame > 12 && w.frame < 60);
ok(romVib.length === 2,
   'the cartridge did the same (' + romVib.length + ')');

// a table swapped mid-note reaches wave RAM on both sides
const bWave = bw.filter(w => w.reg >= 0x30 && w.reg <= 0x3F && w.frame > 90).length;
const rWave = rw.writes.filter(w => w.reg >= 0x30 && w.reg <= 0x3F && w.frame > 90).length;
ok(bWave === 32 && rWave === 32,
   'both players reloaded wave RAM twice under the sounding note (' + bWave + ' / ' + rWave + ' byte writes)');

ok(rw.rom.length === 0x8000, 'the cartridge is still 32 KiB with the new opcodes');

console.log(fail ? '\nverify-automation: ' + fail + ' FAILED' : '\nverify-automation: both players move the same way');
process.exit(fail ? 1 : 0);
