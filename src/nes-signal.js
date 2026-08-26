// What the NES actually emits.
//
// The 2C02 has no RGB palette. It has a 6-bit index -- four LUMA levels by
// sixteen HUES -- and for each pixel it emits a square wave on the composite
// line: high for six of the twelve subcarrier phase steps, low for the other
// six, with the hue selecting WHERE in the cycle the transition falls. The
// colours everyone recognises are not stored anywhere; they are whatever an
// NTSC decoder makes of that square wave.
//
// So this file models the signal, and the palette is DERIVED from it. There is
// no table of 64 RGB triples to get subtly wrong, and the on-screen NTSC filter
// and the colour quantiser cannot disagree with each other, because both are
// this. scripts/verify-nes-ntsc.js checks the derivation against the measured
// 2C02 values that emulator authors publish.
(function (G) {
  'use strict';

  // Composite levels, normalised so black is 0 and white is 1. Index by luma
  // level for the low half of the wave, +4 for the high half. These are the
  // measured 2C02 voltages; the greys they produce are exact -- $00 -> 0.399
  // (0x66), $10 -> 0.684 (0xAE), $2D -> 0.307 (0x4E) -- which is the first sign
  // the model is right, since those entries never leave the low or high half.
  var LEVELS = [-0.116, 0.000, 0.307, 0.714,
                 0.399, 0.684, 1.000, 1.000];
  var ATTEN = 0.746;          // colour-emphasis attenuation, per emphasis bit

  // Six of twelve: the duty cycle IS the colour.
  function inPhase(hue, p) { return ((hue + p) % 12) < 6; }

  // Composite level of palette entry `idx` at absolute phase step `p`.
  // Hue 0 sits high for the whole cycle and hues 13-15 sit low for the whole
  // cycle, which is why those columns are the greyscale ramp and carry no
  // colour at all -- not a special case in the hardware, just a duty cycle of
  // 100% or 0%.
  function level(idx, p, emph) {
    var hue = idx & 0x0F, lum = (idx >> 4) & 0x03, v;
    if (hue === 0)      v = LEVELS[4 + lum];
    else if (hue >= 13) v = LEVELS[lum];
    else                v = inPhase(hue, p) ? LEVELS[4 + lum] : LEVELS[lum];
    if (emph) {
      // Each emphasis bit attenuates one half-cycle of the signal. Darkening
      // the picture is a side effect; the hardware is notching out a band.
      if ((emph & 1) && inPhase(0xC, p)) v *= ATTEN;
      if ((emph & 2) && inPhase(0x4, p)) v *= ATTEN;
      if ((emph & 4) && inPhase(0x8, p)) v *= ATTEN;
    }
    return v;
  }

  // Decoder calibration. PHASE aligns our phase-step 0 with the colour burst a
  // real receiver locks to, and SAT is the chroma gain. Both were FITTED, not
  // guessed: verify-nes-ntsc.js sweeps them against the published 2C02 values
  // and this pair is the minimum. Changing them without re-running that fit
  // will move every colour on screen.
  var PHASE = 4.05, SAT = 0.8;
  function calibrate(phase, sat) { PHASE = phase; SAT = sat; }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // A flat field of one palette entry, decoded the way a receiver would: average
  // the signal for luma, and correlate it against the subcarrier for the two
  // chroma axes. Over one full cycle this is exact, which is what makes it a
  // usable definition of "the colour of index N".
  function rgb(idx, emph) {
    var y = 0, i = 0, q = 0, p, s, th;
    for (p = 0; p < 12; p++) {
      s = level(idx, p, emph);
      th = 2 * Math.PI * (p + PHASE) / 12;
      y += s; i += s * Math.cos(th); q += s * Math.sin(th);
    }
    y /= 12; i = i / 12 * 2 * SAT; q = q / 12 * 2 * SAT;
    return [clamp01(y + 0.956 * i + 0.621 * q),
            clamp01(y - 0.272 * i - 0.647 * q),
            clamp01(y - 1.106 * i + 1.703 * q)];
  }

  function bytes(idx, emph) {
    var c = rgb(idx, emph);
    return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
  }
  function css(idx, emph) {
    var b = bytes(idx, emph);
    return 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')';
  }

  // The 64 entries, in index order. Hues 13-15 of every row are black or near
  // black on real hardware and $0D in particular is BLACKER than black -- a
  // signal below the blanking level, which some TVs refuse to display. Games
  // avoided it and so do we; the table keeps them so indices stay honest.
  function table(emph) {
    var out = [];
    for (var i = 0; i < 64; i++) out.push(bytes(i, emph));
    return out;
  }

  var API = { LEVELS: LEVELS, ATTEN: ATTEN, inPhase: inPhase, level: level,
              rgb: rgb, bytes: bytes, css: css, table: table, calibrate: calibrate,
              get PHASE() { return PHASE; }, get SAT() { return SAT; } };
  G.CT_NES_SIGNAL = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
