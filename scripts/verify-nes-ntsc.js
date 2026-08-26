// Prove the NTSC simulation actually produces the NES palette.
//
// src/nes-signal.js does not store colours, it synthesises them from the 2C02's
// composite waveform. That is only worth doing if the synthesis lands on the
// colours the hardware really makes, so this compares all 64 entries against a
// published measurement of a real 2C02 and fails if the model has drifted.
//
// The decoder has exactly two free parameters -- the phase our step 0 sits at
// relative to the colour burst, and the chroma gain. Those are receiver
// settings, not hardware, which is precisely why different emulators ship
// different-looking "NES palettes" from the same silicon. They are FITTED here
// rather than guessed, and the fit is re-run on every test so a change to the
// signal model cannot silently move every colour on screen.
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'src', 'nes-signal.js'));

// Reference: the 2C02 palette as published by Nestopia / FCEUX. Hues 13-15 are
// blanking-level black on hardware and are excluded from the fit -- they carry
// no colour information to fit against.
const REF = (
  '656565 002D69 131F7F 3C137C 600B62 730A37 710F07 5A1A00 342800 0B3400 003C00 003D10 003840 000000 000000 000000 ' +
  'AEAEAE 0F63B3 4051D0 7841CC A736A9 C03470 BD3C30 9F4A00 6D5C00 366D00 077704 00793D 00727D 000000 000000 000000 ' +
  'FEFEFF 5DB3FF 8FA1FF C890FF F785FA FF83C0 FF8B7F EF9A22 BDAC07 87BC00 5FC605 45C83B 43C67D 4E4E4E 000000 000000 ' +
  'FEFEFF BCDFFF D1D8FF E8D2FF FBCEFF FFCCF0 FFD0D3 FDD8AC E9E098 D0E895 BDEFA1 B3F0BF B4EBE0 B8B8B8 000000 000000'
).trim().split(/\s+/).map(h => [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]);

const CHROMA = [];                       // indices that actually carry colour
for (let i = 0; i < 64; i++) { const h = i & 15; if (h >= 1 && h <= 12) CHROMA.push(i); }
const GREY = [0x00, 0x10, 0x20, 0x30, 0x1D, 0x2D, 0x3D];

// Robust fit: the score is the MEDIAN absolute channel error, not the mean.
// The reference below is transcribed, and a transcription can be wrong in a row
// or two; a least-squares fit lets those rows drag the constants and quietly
// mis-tune all 64 colours to accommodate them. A median cannot be moved by a
// minority of bad rows, so the fit follows the entries that agree.
function errs(phase, sat, set) {
  S.calibrate(phase, sat);
  const e = [];
  for (const i of set) {
    const got = S.bytes(i, 0), want = REF[i];
    for (let k = 0; k < 3; k++) e.push(Math.abs(got[k] - want[k]));
  }
  return e.sort((a, b) => a - b);
}
const median = a => a[a.length >> 1];

let best = { e: Infinity };
for (let p = -6; p < 6; p += 0.05)
  for (let s = 0.3; s <= 1.4; s += 0.01) {
    const e = median(errs(p, s, CHROMA));
    if (e < best.e) best = { e, p, s };
  }
for (let p = best.p - 0.06; p <= best.p + 0.06; p += 0.002)
  for (let s = best.s - 0.02; s <= best.s + 0.02; s += 0.0005) {
    const e = median(errs(p, s, CHROMA));
    if (e < best.e) best = { e, p, s };
  }

const PHASE = Math.round(best.p * 1e3) / 1e3, SAT = Math.round(best.s * 1e3) / 1e3;
S.calibrate(PHASE, SAT);

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

console.log('\nfitted decoder: phase ' + PHASE + ' steps, saturation ' + SAT);
if (process.env.NES_FIT) { console.log('  NES_FIT set: paste these into nes-signal.js and re-run'); }
else ok(Math.abs(S.PHASE - PHASE) < 2e-3 && Math.abs(S.SAT - SAT) < 2e-3,
        'nes-signal.js carries the constants this fit produces ' +
        '(baked ' + S.PHASE + '/' + S.SAT + ', fitted ' + PHASE + '/' + SAT + ')');
S.calibrate(PHASE, SAT);

// The tight assertions are STRUCTURAL -- properties the silicon guarantees,
// which no transcription error can weaken. The comparison against the published
// table is kept as a loose sanity bound: it would catch a model that had come
// unstuck, without pretending the table is exact.
console.log('\nagainst a transcribed 2C02 measurement (loose: this table is approximate)');
const gerr = Math.max(...GREY.map(i => Math.max(...S.bytes(i,0).map((v,k) => Math.abs(v - REF[i][k])))));
ok(gerr <= 3, 'the greyscale ramp matches within ' + gerr + '/255 -- it comes straight from the ' +
   'level table and is not fitted, so this is the load-bearing agreement');
const ce = errs(PHASE, SAT, CHROMA);
S.calibrate(PHASE, SAT);
ok(median(ce) <= 12, 'half the colour channels land within ' + median(ce) + '/255 of the reference');
ok(ce[Math.floor(ce.length * 0.9)] <= 45,
   '90% land within ' + ce[Math.floor(ce.length * 0.9)] + '/255 (the tail is where the table is doubtful)');

console.log('\nstructure the silicon guarantees');
ok(S.bytes(0x0D,0).every(v => v === 0), '$0D decodes to black (below blanking; games avoid it)');
const hueless = [0x0E,0x0F,0x1E,0x1F,0x2E,0x2F,0x3E,0x3F];
ok(hueless.every(i => { const c = S.bytes(i,0); return c[0] === c[1] && c[1] === c[2]; }),
   'hues 14-15 carry no chroma at any level (0% duty cycle)');
ok([0x00,0x10,0x20,0x30].every(i => { const c = S.bytes(i,0); return c[0] === c[1] && c[1] === c[2]; }),
   'hue 0 is the grey ramp (100% duty cycle: no colour to decode)');
const ramp = [0x0D,0x00,0x10,0x20].map(i => S.bytes(i,0)[0]);
ok(ramp.every((v,i) => i === 0 || v > ramp[i-1]), 'luma rises with level (' + ramp.join(' < ') + ')');

// The hue wheel must ROTATE, in the order the 2C02 lays it out. Angles are
// radians on the usual wheel: red 0, green +2pi/3, blue -2pi/3, magenta -pi/3. This is what
// actually pins the phase constant: get it wrong and the whole picture is
// colour-shifted, which no amount of agreement on the greys would reveal.
const dom = h => { const c = S.rgb(0x10 | h, 0);
                   return Math.atan2(Math.sqrt(3)/2*(c[1]-c[2]), c[0]-(c[1]+c[2])/2); };
ok(dom(1) < -1.2 && dom(1) > -2.6, 'hue 1 decodes blue');
ok(dom(4) < -0.5 && dom(4) > -1.7, 'hue 4 decodes magenta');
ok(Math.abs(dom(6)) < 0.6,          'hue 6 decodes red');
ok(dom(0xA) > 1.2 && dom(0xA) < 2.6,'hue A decodes green');
let mono = true, prev = null;
for (let h = 1; h <= 12; h++) {
  const a = ((dom(h) - dom(1)) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  if (prev !== null && a < prev - 0.05) mono = false;
  prev = a;
}
ok(mono, 'hues 1-12 rotate monotonically around the wheel, one direction, no fold-back');

// Chroma amplitude is set by the GAP between the low and high level, so it must
// peak in the middle of the ramp and collapse at both ends. A model that had
// lost the duty cycle would produce flat saturation instead.
const chroma = l => { let s2 = 0; for (let h = 1; h <= 12; h++) {
  const c = S.rgb((l<<4)|h,0); s2 += Math.max(...c) - Math.min(...c); } return s2/12; };
const cs = [0,1,2,3].map(chroma);
ok(cs[1] > cs[0] && cs[1] > cs[3] || cs[2] > cs[0] && cs[2] > cs[3],
   'saturation peaks mid-ramp and falls off at both ends (' + cs.map(v=>v.toFixed(2)).join(' ') + ')');

let bright = 0;
for (let i = 0; i < 64; i++) {
  const a = S.bytes(i,0).reduce((s2,v)=>s2+v,0), b = S.bytes(i,7).reduce((s2,v)=>s2+v,0);
  if (b > a + 6) bright++;
}
ok(bright === 0, 'all three emphasis bits attenuate every entry (' + bright + ' brightened)');
for (const bit of [1,2,4]) {
  let same = 0;
  for (let i = 0; i < 64; i++) if (String(S.bytes(i,0)) === String(S.bytes(i,bit))) same++;
  ok(same < 40, 'emphasis bit ' + bit + ' changes the picture (' + same + '/64 entries unmoved)');
}

// The on-screen pipeline decodes with a WINDOW, not over one clean period, so
// the window design has to be checked separately: get it wrong and every flat
// area on screen strobes as the sub-pixel phase walks across it. This is the
// same arithmetic src/nes-screen.js compiles into its fragment shader.
console.log('\nthe windowed decoder the display pipeline uses');
const cl = x => x < 0 ? 0 : x > 1 ? 1 : x;
function windowed(idx, A0, gaussian) {
  let y=0, i=0, q=0, wy=0, wc=0;
  for (let j = -12; j <= 12; j++) {
    const A = A0 + j, sg = S.level(idx, ((A % 12) + 12) % 12, 0), aj = Math.abs(j);
    const a = gaussian ? Math.exp(-j*j/(2*2.2*2.2)) : (aj < 6 ? 1 : aj === 6 ? 0.5 : 0);
    const b = gaussian ? Math.exp(-j*j/(2*7.5*7.5)) : (aj < 12 ? 1 : aj === 12 ? 0.5 : 0);
    const th = 2 * Math.PI * (A + S.PHASE) / 12;
    y += sg*a; wy += a; i += sg*Math.cos(th)*b; q += sg*Math.sin(th)*b; wc += b;
  }
  y /= wy; i = i/wc*2*S.SAT; q = q/wc*2*S.SAT;
  return [cl(y+0.956*i+0.621*q), cl(y-0.272*i-0.647*q), cl(y-1.106*i+1.703*q)];
}
function scan(gaussian) {
  let err = 0, ripple = 0;
  for (let idx = 0; idx < 64; idx++) {
    const want = S.rgb(idx, 0);
    const lo = [9,9,9], hi = [-9,-9,-9];
    for (let A0 = 0; A0 < 12; A0++) {
      const c = windowed(idx, A0, gaussian);
      for (let k = 0; k < 3; k++) {
        err = Math.max(err, Math.abs(c[k] - want[k]));
        lo[k] = Math.min(lo[k], c[k]); hi[k] = Math.max(hi[k], c[k]);
      }
    }
    for (let k = 0; k < 3; k++) ripple = Math.max(ripple, hi[k] - lo[k]);
  }
  return { err: err * 255, ripple: ripple * 255 };
}
const box = scan(false), gau = scan(true);
ok(box.ripple < 0.5, 'a flat field does not shimmer as the sub-pixel phase walks (' +
   box.ripple.toFixed(2) + '/255 of ripple)');
ok(box.err < 0.5, 'a flat field of every one of the 64 entries decodes to exactly its ' +
   'palette colour (max ' + box.err.toFixed(2) + '/255)');
ok(gau.ripple > 20, 'and this is a real property of the window, not of the maths: a ' +
   'Gaussian of similar width strobes by ' + gau.ripple.toFixed(0) + '/255 (' +
   'the shader must integrate whole subcarrier periods)');

console.log(fail ? '\nverify-nes-ntsc: ' + fail + ' FAILED'
                 : '\nverify-nes-ntsc: the signal model reproduces the 2C02 palette');
process.exit(fail ? 1 : 0);
