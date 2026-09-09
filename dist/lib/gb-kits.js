// KIT SAMPLES: four-bit drums for channel 3.
//
// The DMG has one DAC -- 32 nibbles of wave RAM on channel 3 -- and every Game
// Boy game that plays a sample plays it here, by rewriting that buffer while
// the channel runs. LSDJ's kits are this. It is the last thing the editor could
// not say, and it is the reason a real drum sounds like a drum instead of a
// filtered noise burst.
//
// THE RATE IS CHOSEN, NOT ROUNDED. Channel 3 steps through its 32 nibbles at
// 4194304 / ((2048 - period) * 2) samples a second, so period 1792 gives
// exactly 8192 Hz and a 32-nibble buffer lasts exactly 1/256 s. The cartridge
// refills it from the timer interrupt, which with the 4096 Hz clock and
// TMA = 240 fires exactly 256 times a second: the sample clock and the refill
// clock are the same clock, so nothing drifts. Four kilohertz of bandwidth is
// enough for a kick's body and click, a snare's rasp, a hat's sizzle.
//
// The samples are SYNTHESISED here, deterministically, from oscillators and a
// seeded LFSR -- nothing is recorded and nothing is lifted, which keeps the
// repository the same kind of thing it has always been.
(function (G) {
  'use strict';

  var RATE = 8192;                       // samples a second, exact (period 1792)
  var PERIOD = 1792;                     // channel 3's frequency for that rate
  var BUF = 32;                          // nibbles in wave RAM
  var TMA = 240;                         // timer reload: 4096 / (256 - 240) = 256 Hz

  // a small deterministic noise source: the same kit every time, everywhere
  function lfsr(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s / 4294967296) * 2 - 1;
    };
  }
  function env(t, decay) { return Math.exp(-t / decay); }

  // Each recipe returns a float in -1..1 for time t (seconds); the sample is
  // then quantised to a nibble with 8 at the centre, because a DC step is what
  // clicks when the channel restarts between buffers.
  var RECIPES = [
    { id: 0, n: 'Kick', len: 0.11, f: function (t, rnd) {
        var f0 = 145 * Math.exp(-t / 0.028) + 48;          // the pitch drop IS the kick
        return Math.sin(2 * Math.PI * f0 * t) * env(t, 0.05) +
               (t < 0.004 ? rnd() * 0.5 * env(t, 0.0015) : 0);
      } },
    { id: 1, n: 'Snare', len: 0.13, f: function (t, rnd) {
        return rnd() * 0.75 * env(t, 0.045) +
               Math.sin(2 * Math.PI * 190 * t) * 0.5 * env(t, 0.055);
      } },
    { id: 2, n: 'Hat', len: 0.04, f: function (t, rnd) {
        return rnd() * env(t, 0.011);
      } },
    { id: 3, n: 'Open', len: 0.17, f: function (t, rnd) {
        return rnd() * env(t, 0.07);
      } },
    { id: 4, n: 'Clap', len: 0.14, f: function (t, rnd) {
        var burst = (t < 0.006 || (t > 0.009 && t < 0.014) || (t > 0.018 && t < 0.023)) ? 1
                  : env(Math.max(0, t - 0.023), 0.035) * 0.7;
        return rnd() * burst;
      } },
    { id: 5, n: 'Tom', len: 0.12, f: function (t, rnd) {
        var f0 = 210 * Math.exp(-t / 0.06) + 110;
        return Math.sin(2 * Math.PI * f0 * t) * env(t, 0.06);
      } },
    { id: 6, n: 'Rim', len: 0.03, f: function (t, rnd) {
        return (Math.sin(2 * Math.PI * 820 * t) * 0.6 + rnd() * 0.4) * env(t, 0.006);
      } },
    { id: 7, n: 'Bell', len: 0.10, f: function (t, rnd) {
        return (Math.sign(Math.sin(2 * Math.PI * 540 * t)) * 0.45 +
                Math.sign(Math.sin(2 * Math.PI * 800 * t)) * 0.35) * env(t, 0.045);
      } }
  ];

  var CACHE = null;
  function kits() {
    if (CACHE) return CACHE;
    CACHE = RECIPES.map(function (r) {
      var n = Math.round(r.len * RATE);
      n = Math.ceil(n / BUF) * BUF;                 // whole buffers: the last one
      var rnd = lfsr(0x9E3779B9 ^ (r.id * 2654435761));   // must not be half fed
      var data = new Uint8Array(n);
      for (var i = 0; i < n; i++) {
        var t = i / RATE;
        var v = i < r.len * RATE ? r.f(t, rnd) : 0;
        // a gentle fade over the last buffer, so a sample never ends on a step
        var left = n - i;
        if (left < BUF) v *= left / BUF;
        data[i] = Math.max(0, Math.min(15, Math.round(8 + v * 7)));
      }
      return { id: r.id, name: r.n, rate: RATE, period: PERIOD, data: data,
               buffers: n / BUF, seconds: n / RATE };
    });
    return CACHE;
  }
  function byId(id) { var k = kits(); return k[(id | 0) % k.length]; }
  // two nibbles to a byte, high first, exactly as wave RAM reads them
  function packed(id) {
    var d = byId(id).data, out = new Uint8Array(d.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = ((d[i * 2] & 15) << 4) | (d[i * 2 + 1] & 15);
    return out;
  }

  var API = { RATE: RATE, PERIOD: PERIOD, BUF: BUF, TMA: TMA,
              kits: kits, byId: byId, packed: packed, names: function () {
                return kits().map(function (k) { return k.name; }); } };
  G.CT_GB_KITS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
