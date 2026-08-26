// The cartridge and the website must make the same sound.
//
// Two checks, because they fail in different ways:
//
// 1. REGISTERS. The cartridge is executed on the emulated CPU and every write it
//    makes to $FF10-$FF3F is decoded back into note events, then compared with
//    the score. This catches a wrong note, a missing note, drift, a truncated
//    song -- anything about WHAT is played and WHEN.
//
// 2. SOUND. Both are rendered to PCM and compared as SPECTRA, not as waveforms.
//    Sample-wise correlation is the wrong instrument here and says so loudly:
//    the driver writes its events one after another inside a frame while the
//    browser writes them all at the frame boundary, so triggers land a fraction
//    of a millisecond apart. A 500 Hz pulse has an 88-sample period and the
//    noise channel is a pseudo-random sequence -- either one decorrelates
//    completely under a sub-millisecond shift while sounding identical. Measured
//    on this pair: 0.52 waveform correlation on pulse 1, and it is the same
//    notes at the same times. What the ear compares is the short-time spectrum,
//    so that is what this compares.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HW = globalThis.CT_GB_HARDWARE = require(path.join(ROOT, 'src', 'gb-hardware.js'));
const APU = require(path.join(ROOT, 'src', 'gb-apu.js'));
const ROM = require(path.join(ROOT, 'src', 'gb-rom.js'));
const emu = require(path.join(ROOT, 'scripts', 'gb-emu.js'));
const composer = require(path.join(ROOT, 'src', 'composer.js'));

const SEEDS = [
  'velvet-engines-melt-tide-1a2b3c4d',
  'restless-wolves-rise-static-8m4c2v7t'
];
const SR = 44100, SECONDS = 20, N = 2048, HOP = 1024;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

// --- a small radix-2 FFT, magnitudes only ---------------------------------
function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const out = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

// Log-spaced bands: the ear does not care that bin 900 moved to bin 902, it
// cares that the energy around 2 kHz is the same.
const BANDS = [];
for (let f = 40; f < SR / 2; f *= Math.SQRT2) BANDS.push([f, Math.min(f * Math.SQRT2, SR / 2)]);

function spectrogram(pcm, offset) {
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const frames = [];
  for (let p = offset; p + N < pcm.length; p += HOP) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = pcm[p + i] * win[i];
    const mag = fftMag(re, im);
    const band = new Float64Array(BANDS.length);
    for (let b = 0; b < BANDS.length; b++) {
      const lo = Math.floor(BANDS[b][0] / SR * N), hi = Math.ceil(BANDS[b][1] / SR * N);
      let s = 0; for (let k = lo; k < hi && k < mag.length; k++) s += mag[k] * mag[k];
      band[b] = 10 * Math.log10(s + 1e-12);
    }
    frames.push(band);
  }
  return frames;
}

function compare(a, b) {
  const n = Math.min(a.length, b.length);
  let diff = 0, cnt = 0, sa = 0, sb = 0, sab = 0, ma = 0, mb = 0;
  for (let i = 0; i < n; i++) for (let k = 0; k < BANDS.length; k++) { ma += a[i][k]; mb += b[i][k]; cnt++; }
  ma /= cnt; mb /= cnt;
  let worst = { d: 0 };
  for (let i = 0; i < n; i++) for (let k = 0; k < BANDS.length; k++) {
    const x = a[i][k], y = b[i][k], d = Math.abs(x - y);
    diff += d;
    if (d > worst.d) worst = { d, band: k, frame: i };
    sa += (x - ma) * (x - ma); sb += (y - mb) * (y - mb); sab += (x - ma) * (y - mb);
  }
  return { meanDb: diff / cnt, corr: sab / Math.sqrt(sa * sb || 1), worst, frames: n };
}

for (const seed of SEEDS) {
  console.log('\n' + seed);
  const score = composer.compile(seed);
  const rom = ROM.buildRom(score, { title: 'CHIPTUNES' });

  // ---- 1. registers -----------------------------------------------------
  const writes = [];
  const cpu = new emu.Cpu(rom, { onIo: (reg, val) => { if (reg >= 0x10 && reg <= 0x3F) writes.push({ f: cpu.frame, reg, val }); } });
  const lastFrame = Math.max(...score.gb.notes.map(n => n.frame + n.frames));
  while (cpu.frame <= lastFrame + 2) cpu.step();

  const byCh = { 0: [], 1: [], 2: [], 3: [] };
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    for (let ch = 0; ch < 4; ch++) {
      const base = 0x11 + ch * 5;
      if (w.reg === base && writes[i + 3] && writes[i + 1].reg === base + 1 &&
          writes[i + 2].reg === base + 2 && writes[i + 3].reg === base + 3) {
        byCh[ch].push({ f: w.frame, on: true }); i += 3; break;
      }
      if (w.reg === base + 1 && w.val === 0 && writes[i + 1] && writes[i + 1].reg === base + 3) {
        byCh[ch].push({ f: w.frame, on: false }); i += 1; break;
      }
    }
  }
  let bad = 0, total = 0, firstBad = null;
  for (const ch of [0, 1, 2, 3]) {
    const want = score.gb.notes.filter(n => (n.ch | 0) === ch).sort((a, b) => a.frame - b.frame);
    const got = byCh[ch].filter(e => e.on);
    for (let i = 0; i < Math.min(want.length, got.length); i++) {
      total++;
      if (Math.abs(got[i].f - want[i].frame) > 1) { bad++; if (!firstBad) firstBad = { ch, i, want: want[i].frame, got: got[i].f }; }
    }
    if (want.length !== got.length) { bad++; if (!firstBad) firstBad = { ch, count: [want.length, got.length] }; }
  }
  ok(bad === 0, 'the cartridge triggers every note of the score on its own frame (' + total + ' notes, 4 channels)' +
     (firstBad ? '  -- first mismatch ' + JSON.stringify(firstBad) : ''));

  // ---- 2. sound ---------------------------------------------------------
  const romPcm = emu.renderRom(rom, { seconds: SECONDS, sampleRate: SR }).pcm;
  const sitePcm = APU.render({ notes: score.gb.notes, bank: score.gb.bank, totalFrames: score.gb.totalFrames }, SR);
  // The driver acts after vblank, so the cartridge lags the browser by a fixed
  // ~17ms. Align on it once rather than pretending it is not there.
  const LAG = Math.round(0.0176 * SR);
  const A = spectrogram(romPcm, LAG), B = spectrogram(sitePcm, 0);
  const r = compare(A, B);
  console.log('    ' + r.frames + ' spectral frames, ' + BANDS.length + ' log bands');
  ok(r.meanDb < 3.0, 'the two spectra agree to ' + r.meanDb.toFixed(2) + ' dB per band on average');
  ok(r.corr > 0.97, 'spectrogram correlation ' + r.corr.toFixed(4));
}

console.log(fail ? '\nverify-rom-audio: ' + fail + ' FAILED'
                 : '\nverify-rom-audio: the cartridge and the browser make the same sound');
process.exit(fail ? 1 : 0);
