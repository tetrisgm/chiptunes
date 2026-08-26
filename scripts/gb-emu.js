// A Game Boy, in JavaScript: the CPU that runs the cartridge, wired to the same
// APU the website plays through.
//
// The point is not emulation for its own sake. "The ROM is a serialisation of
// what you heard" is a claim, and the only way to check it is to run the actual
// bytes a flash cart would get and listen to what comes out. The CPU here is an
// LR35902 implementing exactly the opcodes the driver uses -- it THROWS on
// anything else, deliberately: an unimplemented opcode means the assembler
// emitted something the driver was not supposed to contain.
//
//   node scripts/gb-emu.js <seed> [seconds] [out.wav]
//
// writes rom.wav (the cartridge, executed) and site.wav (the same score through
// the browser's chip) so they can be compared by ear as well as by number.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

const HW = globalThis.CT_GB_HARDWARE = require(path.join(ROOT, 'src', 'gb-hardware.js'));
const APU = require(path.join(ROOT, 'src', 'gb-apu.js'));

const CPU = require(path.join(ROOT, 'src', 'gb-cpu.js'));
const Cpu = CPU.Cpu;

// ----------------------------------------------------------------- render
// Execute the cartridge and record what the APU makes of it.
function renderRom(rom, opts) {
  opts = opts || {};
  const sr = opts.sampleRate || 44100;
  const total = Math.ceil((opts.seconds || 10) * sr);
  const out = new Float32Array(total);
  const apu = new APU.Apu(sr);
  const cps = APU.MASTER / sr;
  let owed = 0, n = 0;

  const cpu = new Cpu(rom, {
    // Only the sound registers reach the chip; everything else is the driver
    // talking to the LCD or to itself.
    onIo: (reg, val) => { if (reg >= 0x10 && reg <= 0x3F) apu.write(reg, val); },
    onCycles: (c) => {
      owed += c;
      while (owed >= cps && n < total) { apu._advance(cps); out[n++] = apu._mix(); owed -= cps; }
    }
  });
  while (n < total) cpu.step();
  return { pcm: out, cpu: cpu };
}

// ------------------------------------------------------------------- wav
function wav(pcm, sr) {
  const n = pcm.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

module.exports = { Cpu, renderRom, wav };

if (require.main === module) {
  const fs = require('fs');
  const ROM = require(path.join(ROOT, 'src', 'gb-rom.js'));
  const composer = require(path.join(ROOT, 'src', 'composer.js'));
  const seed = process.argv[2] || 'velvet-engines-melt-tide-1a2b3c4d';
  const seconds = Number(process.argv[3] || 20);
  const sr = 44100;
  const score = composer.compile(seed);
  const rom = ROM.buildRom(score, { title: 'CHIPTUNES' });

  console.log(seed + '  (' + seconds + 's at ' + sr + ' Hz)');
  let t0 = Date.now();
  const { pcm, cpu } = renderRom(rom, { seconds, sampleRate: sr });
  console.log('  cartridge executed: ' + cpu.frame + ' LCD frames, ' +
              (cpu.cycles / APU.MASTER).toFixed(2) + 's of machine time, ' + (Date.now() - t0) + 'ms');
  t0 = Date.now();
  const site = APU.render({ notes: score.gb.notes, bank: score.gb.bank, totalFrames: score.gb.totalFrames }, sr)
                  .subarray(0, pcm.length);
  console.log('  browser chip rendered the same score, ' + (Date.now() - t0) + 'ms');
  fs.writeFileSync(path.join(ROOT, 'rom.wav'), wav(pcm, sr));
  fs.writeFileSync(path.join(ROOT, 'site.wav'), wav(site, sr));
  console.log('  wrote rom.wav and site.wav');
}
