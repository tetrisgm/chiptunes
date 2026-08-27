// Kit samples have to sound the same on the cartridge as in the browser.
//
// This is the hardest of the parity claims, because the two sides get there by
// completely different routes: the browser walks a cycle counter and writes
// wave RAM when a buffer is due, while the cartridge takes a TIMER INTERRUPT
// 256 times a second and streams the same nibbles from ROM. If the rate, the
// buffer size or the retrigger differed by anything, the sample would come out
// at a different pitch or with a different grain.
//
// So: play every drum in the kit, render both, and compare the sound.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

globalThis.CT_GB_HARDWARE = require(path.join(ROOT, 'src', 'gb-hardware.js'));
const HW = globalThis.CT_GB_HARDWARE;
const KITS = require(path.join(ROOT, 'src', 'gb-kits.js'));
const APU = require(path.join(ROOT, 'src', 'gb-apu.js'));
const ROM = require(path.join(ROOT, 'src', 'gb-rom.js'));
const emu = require(path.join(ROOT, 'scripts', 'gb-emu.js'));
const INSTR = require(path.join(ROOT, 'src', 'chip-instruments.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const SR = 44100;

const bank = HW.buildBank((globalThis.CT_CHIP_INSTRUMENTS || INSTR).patches);

// one hit per drum, a quarter second apart, and nothing else playing
const hits = KITS.kits().map((k, i) => ({ f: 20 + i * 15, id: k.id }));
const score = { gb: { bank, notes: [], kit: hits, totalFrames: 20 + hits.length * 15 + 20, loopFrames: 0 } };

const SECONDS = (score.gb.totalFrames + 20) / HW.FPS;
const rom = ROM.buildRom(score, { title: 'KITTEST' });

ok(rom.length === 0x8000, 'the cartridge is 32 KiB');
let used = 0; for (let i = rom.length - 1; i >= 0; i--) if (rom[i] !== 0) { used = i + 1; break; }
ok(used < 0x8000, 'a song with the whole kit still fits (' + used + ' bytes of ' + rom.length + ')');
ok(rom[0x50] === 0xC3, 'the timer interrupt vector points at the streamer');

const romPcm = emu.renderRom(rom, { seconds: SECONDS, sampleRate: SR }).pcm;
const sitePcm = APU.render(score.gb, SR);

function energy(pcm, from, len) {
  let s = 0;
  for (let i = from; i < Math.min(pcm.length, from + len); i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, len));
}
// the driver acts after vblank, so the cartridge lags by about a frame
const LAG = Math.round(0.0176 * SR);

// 1. every hit is audible on both sides
let quietSite = [], quietRom = [];
hits.forEach((h, i) => {
  const at = Math.round((h.f / HW.FPS) * SR), win = Math.round(0.09 * SR);
  if (energy(sitePcm, at, win) < 0.01) quietSite.push(KITS.byId(h.id).name);
  if (energy(romPcm, at + LAG, win) < 0.01) quietRom.push(KITS.byId(h.id).name);
});
ok(!quietSite.length, 'every drum sounds in the browser' + (quietSite.length ? ' -- silent: ' + quietSite.join(', ') : ''));
ok(!quietRom.length, 'every drum sounds on the cartridge' + (quietRom.length ? ' -- silent: ' + quietRom.join(', ') : ''));

// 2. and they are the SAME sound: band energy over time, correlated
function bands(pcm, off) {
  // 16 log bands x every 10ms, which is enough to tell a kick from a hat and a
  // right rate from a wrong one
  const hop = Math.round(0.01 * SR), N = 512, out = [];
  for (let t = off; t + N < pcm.length; t += hop) {
    const row = [];
    for (let b = 0; b < 16; b++) {
      const f = 60 * Math.pow(2, b / 2.2);
      const w = 2 * Math.PI * f / SR;
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) {
        const x = pcm[t + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
        re += x * Math.cos(-w * i); im += x * Math.sin(-w * i);
      }
      row.push(Math.log10(1e-6 + Math.hypot(re, im) / N));
    }
    out.push(row);
  }
  return out;
}
const A = bands(romPcm, LAG), B = bands(sitePcm, 0);
const n = Math.min(A.length, B.length);
let ma = 0, mb = 0, cnt = 0;
for (let i = 0; i < n; i++) for (let b = 0; b < 16; b++) { ma += A[i][b]; mb += B[i][b]; cnt++; }
ma /= cnt; mb /= cnt;
let sa = 0, sb = 0, sab = 0, diff = 0;
for (let i = 0; i < n; i++) for (let b = 0; b < 16; b++) {
  const x = A[i][b], y = B[i][b];
  diff += Math.abs(x - y) * 20;
  sa += (x - ma) * (x - ma); sb += (y - mb) * (y - mb); sab += (x - ma) * (y - mb);
}
const corr = sab / Math.sqrt(sa * sb || 1), meanDb = diff / cnt;
ok(corr > 0.9, 'the cartridge and the browser play the same kit (spectrogram correlation ' + corr.toFixed(4) + ')');
ok(meanDb < 4, 'and at the same level (' + meanDb.toFixed(2) + ' dB per band on average)');

// 3. the rate is the one the hardware was asked for, not a rounded one
ok(KITS.RATE === 4194304 / ((2048 - KITS.PERIOD) * 2),
   'channel 3 at period ' + KITS.PERIOD + ' runs at exactly ' + KITS.RATE + ' samples a second');
ok(4096 / (256 - KITS.TMA) === KITS.RATE / KITS.BUF,
   'and the timer refills it exactly in step (' + (4096 / (256 - KITS.TMA)) + ' buffers a second)');

console.log(fail ? '\nverify-kit: ' + fail + ' FAILED' : '\nverify-kit: the drums are the same drums on both');
process.exit(fail ? 1 : 0);
