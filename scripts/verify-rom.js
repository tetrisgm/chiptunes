// Prove the exported cartridge actually plays the song.
//
// "Download it and play it on hardware" is a claim, and the only honest way to
// back it without a cartridge and an oscilloscope is to execute the ROM. This
// runs the real bytes on an emulated LR35902 -- the same image a flash cart
// would get -- captures every write the driver makes to the sound registers,
// and checks them against what the score says should happen.
//
// The emulator implements exactly the opcodes the driver uses and throws on
// anything else, which is deliberate: an unimplemented opcode means the
// assembler emitted something the driver was not supposed to contain.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

globalThis.CT_GB_HARDWARE = require(path.join(ROOT, 'src', 'gb-hardware.js'));
const HW = globalThis.CT_GB_HARDWARE;
const ROM = require(path.join(ROOT, 'src', 'gb-rom.js'));
const composer = require(path.join(ROOT, 'src', 'composer.js'));

// --------------------------------------------------------------------- CPU
// The CPU lives in src/gb-cpu.js and is shared with scripts/gb-emu.js and with
// the browser's "Try on Game Boy emulator". It used to be copied here, and the
// copy immediately fell behind: the driver learned to draw and this file threw
// on the first opcode it had never seen.
const CPU = require(path.join(ROOT, 'src', 'gb-cpu.js'));

function run(rom, maxFrames) {
  const writes = [];
  const cpu = new CPU.Cpu(rom, {
    onIo: (reg, val) => { if (reg >= 0x10 && reg <= 0x3F) writes.push({ frame: cpu.frame, reg, val }); }
  });
  while (cpu.frame < maxFrames) cpu.step();
  return { writes, io: cpu.io, cpu };
}

// --------------------------------------------------------------- expectations
// Derived from the SCORE and the APU's own rules, not from the ROM encoder, so
// a mistake in the encoder shows up as a mismatch rather than agreeing with
// itself. Channel n's registers begin at $11 + n*5.
function expected(score) {
  const gb = score.gb, inst = gb.bank.instruments;
  const out = [];
  for (const n of gb.notes) {
    const rec = inst[n.inst] || [0, 0xF0, 0xFF, 0];
    const ch = n.ch | 0, base = 0x11 + ch * 5;
    const v0 = (rec[1] >> 4) & 15;
    const vol = Math.max(0, Math.min(15, Math.round(v0 * (0.35 + 0.65 * (n.vel == null ? 1 : n.vel)))));
    let d;
    if (ch === 0 || ch === 1) {
      const p = Math.max(0, Math.min(2047, HW.midiToPeriod(n.midi, 'pulse').period + (n.det | 0)));
      d = [rec[0] & 0xC0, (vol << 4) | (rec[1] & 15), p & 0xFF, 0x80 | ((p >> 8) & 7)];
    } else if (ch === 2) {
      const p = Math.max(0, Math.min(2047, HW.midiToPeriod(n.midi, 'wave').period + (n.det | 0)));
      const lvl = vol >= 12 ? 1 : vol >= 6 ? 2 : vol >= 1 ? 3 : 0;
      d = [0, lvl << 5, p & 0xFF, 0x80 | ((p >> 8) & 7)];
    } else {
      d = [0, (vol << 4) | (rec[1] & 15), rec[0] & 0xFF, 0x80];
    }
    out.push({ frame: n.frame | 0, reg: base, vals: d });
  }
  return out.sort((a, b) => a.frame - b.frame || a.reg - b.reg);
}

// ---------------------------------------------------------------------- main
const SEEDS = [
  'velvet-engines-melt-tide-1a2b3c4d',
  'restless-wolves-rise-static-8m4c2v7t',
  'silent-sparrows-glide-fog-5w9k3r6h'
];
const FRAMES = 240;                       // four seconds is plenty to catch drift
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

for (const seed of SEEDS) {
  console.log('\n' + seed);
  const score = composer.compile(seed);
  const rom = ROM.buildRom(score, { title: 'CHIPTUNES' });

  ok(rom.length === 0x8000, 'ROM is exactly 32 KiB');
  let hx = 0; for (let i = 0x134; i <= 0x14C; i++) hx = (hx - rom[i] - 1) & 0xFF;
  ok(hx === rom[0x14D], 'header checksum is the one the boot ROM computes');
  ok(rom[0x104] === 0xCE && rom[0x133] === 0x3E, 'boot logo intact (a cartridge without it will not start)');
  ok(rom[0x147] === 0x00 && rom[0x148] === 0x00, 'declares ROM-only, 32 KiB');

  const { writes, io } = run(rom, FRAMES);

  ok(io[0x26] === 0x80, 'driver powered the APU on (NR52)');
  ok(io[0x25] === 0xFF, 'every channel routed to both speakers (NR51)');
  ok(io[0x1A] === 0x80, 'channel 3 DAC enabled (NR30)');
  ok(writes.length > 0, 'driver wrote to the sound registers (' + writes.length + ' writes)');

  // every note that starts inside the window must appear, on its own frame,
  // with the four bytes the APU would have used
  const exp = expected(score).filter(e => e.frame < FRAMES - 2);
  let matched = 0, missed = null;
  for (const e of exp) {
    const hit = writes.some((w, i) =>
      w.reg === e.reg && w.val === e.vals[0] && Math.abs(w.frame - e.frame) <= 1 &&
      writes[i + 1] && writes[i + 1].val === e.vals[1] &&
      writes[i + 2] && writes[i + 2].val === e.vals[2] &&
      writes[i + 3] && writes[i + 3].val === e.vals[3]);
    if (hit) matched++; else if (!missed) missed = e;
  }
  ok(exp.length > 0, 'score has notes inside the verified window (' + exp.length + ')');
  ok(matched === exp.length,
     'every note reached the hardware as the APU would write it (' + matched + '/' + exp.length + ')' +
     (missed ? ' -- first miss: frame ' + missed.frame + ' reg $' + missed.reg.toString(16) : ''));

  const frames = new Set(writes.map(w => w.frame));
  ok(frames.size > 4, 'writes are spread across frames, not dumped at once (' + frames.size + ' distinct frames)');
}

console.log(fail ? '\nverify-rom: ' + fail + ' FAILED' : '\nverify-rom: the exported cartridge plays the score');
process.exit(fail ? 1 : 0);
