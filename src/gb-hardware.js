// Game Boy DMG hardware model — the single source of truth every surface shares.
//
// The composer writes FOR this machine rather than writing freely and being
// squeezed onto it afterwards, which is what a 1993 game composer did and what
// makes chiptune sound like chiptune. Three consumers read this file: the
// arranger (voicing decisions), the APU synth (playback), and the .gbs writer
// (ROM export). Because all three share these constants, the ROM is a
// serialisation of what you heard, not an approximation of it.
//
// Frequency registers are 11-bit period values, and the two families differ by
// an octave -- which is exactly why bass lives on the wave channel:
//     pulse: f = 131072 / (2048 - X)   -> floor 64 Hz   (~MIDI 36, C2)
//     wave:  f =  65536 / (2048 - X)   -> floor 32 Hz   (~MIDI 24, C1)
(function (G) {
  'use strict';

  var FPS = 59.7275;                  // DMG frame rate; all timing lands here
  var CH = { PULSE1: 0, PULSE2: 1, WAVE: 2, NOISE: 3 };
  var DUTIES = [0.125, 0.25, 0.5, 0.75];        // NR11 bits 6-7
  var WAVE_LEVELS = [0, 1, 0.5, 0.25];          // NR32: mute/full/half/quarter
  var NOISE_DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];

  // Playable range per family, derived from the period registers above.
  var RANGE = {
    pulse: { lo: 36, hi: 108 },
    wave:  { lo: 24, hi: 96  }
  };

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // -> { period, hz, midi } with midi clamped into the channel's real range.
  function midiToPeriod(midi, family) {
    var r = RANGE[family] || RANGE.pulse;
    var m = Math.max(r.lo, Math.min(r.hi, Math.round(midi)));
    var num = family === 'wave' ? 65536 : 131072;
    var x = Math.round(2048 - num / midiToHz(m));
    if (x < 0) x = 0; if (x > 2047) x = 2047;
    return { period: x, hz: num / (2048 - x), midi: m };
  }

  function inRange(midi, family) {
    var r = RANGE[family] || RANGE.pulse;
    return midi >= r.lo && midi <= r.hi;
  }

  // Beats -> integer DMG frames. Everything the composer emits gets pinned to
  // this grid; a note between frames cannot exist on the hardware.
  function beatToFrame(beat, bpm) { return Math.round(beat * (60 / bpm) * FPS); }
  function frameToSec(f) { return f / FPS; }

  function quantDuty(d) {
    var best = 0, bd = 9;
    for (var i = 0; i < DUTIES.length; i++) {
      var x = Math.abs(DUTIES[i] - d);
      if (x < bd) { bd = x; best = i; }
    }
    return best;                       // 0..3, the NR11 duty index
  }

  // A learned patch (chip-instruments.js, gameboy only) -> the driver's 4-byte
  // instrument record: [duty|waveSlot|noisePoly, envelope, arpId, flags].
  function patchToInstrument(p, waveSlot) {
    var env = p.envelope || { initial: 1, rate: 0, direction: 'down' };
    var vol = Math.max(0, Math.min(15, Math.round((env.initial != null ? env.initial : 1) * 15)));
    var dir = env.direction === 'up' ? 1 : 0;
    var pace = Math.max(0, Math.min(7, Math.round(env.rate || 0)));
    var nrx2 = (vol << 4) | (dir << 3) | pace;
    if (p.type === 'pulse') return [quantDuty(p.duty) << 6, nrx2, 0xFF, 0];
    // flags bit 0 says "byte0 is a wave slot". Without it a wave slot cannot
    // be told from a pulse's duty byte, and the composer does sometimes put a
    // pulse instrument on channel 3 -- see waveSlotOf.
    if (p.type === 'wave')  return [waveSlot & 0xFF, nrx2, 0xFF, 1];
    // noise: NR43 = clockShift<<4 | width<<3 | divisor
    var width = p.mode === 7 ? 1 : 0;
    var shift = Math.max(0, Math.min(13, Math.round(p.clockShift || 0)));
    var div = Math.max(0, Math.min(7, Math.round(p.period || 0)));
    return [(shift << 4) | (width << 3) | div, nrx2, 0xFF, 0];
  }

  // AUTHORED TIMBRES. The corpus contributes only 23 instruments, and half of
  // its pulses are the same flat 50% square -- which is why every song sounded
  // like the same instrument. This palette is written the way an LSDJ kit is:
  // four duties crossed with five envelope characters (pluck, stab, sustain,
  // soft, swell), six wave shapes from buzzy to mellow for the bass channel,
  // and four extra noises. They join the corpus patches in the same bank and
  // ride into the browser chip and the cartridge identically.
  var WAVE_SLOTS = 32;                   // tables the cartridge carries (16 bytes each)
  function _env(initial, rate, dir) { return { initial: initial, rate: rate, direction: dir || 'down' }; }
  function _wt(fn) { var t = []; for (var i = 0; i < 32; i++) t.push(Math.max(0, Math.min(15, Math.round(fn(i))))); return t; }
  var AUTHORED = (function () {
    var out = [], id = 0;
    function pulse(duty, env) { out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'pulse', duty: duty, envelope: env, authored: 'p' + (id++) } }); }
    var E = { pluck: _env(1, 1), stab: _env(0.87, 2), sus: _env(0.8, 0), soft: _env(0.53, 4), swell: _env(0.2, 3, 'up') };
    [0.125, 0.25, 0.5, 0.75].forEach(function (d) {
      pulse(d, E.pluck); pulse(d, E.stab); pulse(d, E.sus); pulse(d, E.soft);
    });
    pulse(0.75, E.swell); pulse(0.5, E.swell);
    var WAVES = {
      triangle: _wt(function (i) { return i < 16 ? i : 31 - i; }),
      saw:      _wt(function (i) { return i / 2; }),
      square:   _wt(function (i) { return i < 16 ? 15 : 0; }),
      organ:    _wt(function (i) { return 7.5 + 5 * Math.sin(i / 32 * 2 * Math.PI) + 2.5 * Math.sin(i / 32 * 4 * Math.PI); }),
      sine:     _wt(function (i) { return 7.5 + 7.5 * Math.sin(i / 32 * 2 * Math.PI); }),
      thin:     _wt(function (i) { return i < 4 ? 15 : 0; })
    };
    Object.keys(WAVES).forEach(function (k) {
      out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'wave', table4bit: WAVES[k], envelope: _env(1, 0), authored: 'w-' + k } });
    });
    out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'wave', table4bit: WAVES.sine, envelope: _env(0.6, 0), authored: 'w-sine-soft' } });
    out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'wave', table4bit: WAVES.saw, envelope: _env(0.6, 0), authored: 'w-saw-soft' } });
    // noises: bright tick, crisp hat, snap snare, deep punch
    out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'noise', clockShift: 1, period: 1, mode: 15, envelope: _env(0.66, 1), authored: 'n-tick' } });
    out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'noise', clockShift: 2, period: 2, mode: 7,  envelope: _env(0.8, 1),  authored: 'n-hat' } });
    out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'noise', clockShift: 4, period: 3, mode: 15, envelope: _env(0.87, 2), authored: 'n-snap' } });
    out.push({ weight: 0.5, patch: { system: 'gameboy', type: 'noise', clockShift: 6, period: 5, mode: 15, envelope: _env(1, 1),    authored: 'n-punch' } });

    // EDITOR TIMBRES. Everything above is what the composer draws from, and
    // its pools are indexed by hash(seed) % pool.length -- so adding one patch
    // there would re-instrument every song ever shared. These carry
    // editorOnly, the composer filters them out, and they sort last (a lower
    // weight) so no existing instrument index moves. They exist because the
    // editor's palette was thin: the chip has far more to say than the corpus
    // happened to use.
    function ed(patch) {
      patch.system = 'gameboy'; patch.editorOnly = true;
      out.push({ weight: 0.25, patch: patch });
    }
    // pulse: the three real duties (75% is 25% inverted) across the envelope
    // shapes the corpus never reached -- slower decays, quiet sustains, swells
    var ED_ENV = {
      decay: _env(1, 3), fade: _env(1, 5), long: _env(1, 7),
      tap: _env(0.53, 1), ghost: _env(0.4, 0), quiet: _env(0.53, 2),
      bloom: _env(0.13, 6, 'up'), rise: _env(0.2, 1, 'up')
    };
    [0.125, 0.25, 0.5].forEach(function (d) {
      Object.keys(ED_ENV).forEach(function (k) { ed({ type: 'pulse', duty: d, envelope: ED_ENV[k], authored: 'ed-p-' + d + '-' + k }); });
    });
    // wave: the last three free slots in the cartridge's table of sixteen
    var ED_WAVES = {
      pwm:  _wt(function (i) { return i < 8 ? 15 : 0; }),                       // a 25% pulse, thinner than square
      bell: _wt(function (i) { var a = i / 32 * 2 * Math.PI;
              return 7.5 + 4 * Math.sin(a) + 2.5 * Math.sin(3 * a) + 1.5 * Math.sin(5 * a); }),
      reso: _wt(function (i) { var a = i / 32 * 2 * Math.PI;
              return 7.5 + 5 * Math.sin(a) + 3 * Math.sin(7 * a); })
    };
    Object.keys(ED_WAVES).forEach(function (k) {
      ed({ type: 'wave', table4bit: ED_WAVES[k], envelope: _env(1, 0), authored: 'ed-w-' + k });
    });
    // wave: the cartridge now carries 32 tables, so the bass voice gets the
    // rest of the classic single-cycle shapes instead of the six it had
    var TAU = Math.PI * 2;
    var ED_WAVES2 = {
      sqr75:  function (i) { return i < 24 ? 15 : 0; },
      ramp:   function (i) { return 15 - i / 2; },
      tri2:   function (i) { var j = i % 16; return j < 8 ? j * 2 : (15 - j) * 2; },
      sine2:  function (i) { return 7.5 + 7.5 * Math.sin(i / 32 * TAU * 2); },
      half:   function (i) { return 15 * Math.abs(Math.sin(i / 32 * Math.PI)); },
      expo:   function (i) { return 15 * Math.exp(-i / 10); },
      stair:  function (i) { return (i >> 3) * 5; },
      stair8: function (i) { return (i >> 2) * 2.1; },
      vox:    function (i) { var a = i / 32 * TAU;
                return 7.5 + 4 * Math.sin(a) + 2 * Math.sin(3 * a) + 2 * Math.sin(7 * a); },
      organ2: function (i) { var a = i / 32 * TAU;
                return 7.5 + 4 * Math.sin(a) + 3 * Math.sin(2 * a) + 1.5 * Math.sin(4 * a); },
      nasal:  function (i) { var a = i / 32 * TAU;
                return 7.5 + 3 * Math.sin(a) + 3 * Math.sin(5 * a) + 2 * Math.sin(9 * a); },
      notch:  function (i) { return i < 12 ? 15 : i < 16 ? 8 : 0; },
      spike:  function (i) { return i < 3 ? i * 5 : i < 6 ? 15 - (i - 3) * 5 : 0; },
      clip:   function (i) { return Math.max(0, Math.min(15, 7.5 + 12 * Math.sin(i / 32 * TAU))); },
      chirp:  function (i) { return 7.5 + 7.5 * Math.sin(i * i / 90); },
      wobble: function (i) { var a = i / 32 * TAU; return 7.5 + 6 * Math.sin(a + 1.4 * Math.sin(2 * a)); }
    };
    Object.keys(ED_WAVES2).forEach(function (k) {
      ed({ type: 'wave', table4bit: _wt(ED_WAVES2[k]), envelope: _env(1, 0), authored: 'ed-w2-' + k });
    });
    // noise: the corpus only ever asked for 15-bit noise at the top of the
    // range. 7-bit width is the chip's metallic mode, and the low shifts are
    // where the big drums live.
    [{ s: 0, p: 0, m: 7,  e: _env(1, 1),    n: 'ring' },
     { s: 2, p: 0, m: 7,  e: _env(1, 2),    n: 'zap' },
     { s: 4, p: 0, m: 7,  e: _env(0.87, 1), n: 'bleep' },
     { s: 6, p: 2, m: 7,  e: _env(1, 3),    n: 'clank' },
     { s: 8, p: 0, m: 7,  e: _env(1, 1),    n: 'clonk' },
     { s: 1, p: 4, m: 15, e: _env(1, 2),    n: 'clap' },
     { s: 3, p: 0, m: 15, e: _env(1, 1),    n: 'rim' },
     { s: 3, p: 6, m: 15, e: _env(1, 4),    n: 'crash' },
     { s: 5, p: 2, m: 15, e: _env(1, 2),    n: 'thud' },
     { s: 7, p: 0, m: 15, e: _env(1, 1),    n: 'boom' },
     { s: 8, p: 4, m: 15, e: _env(1, 2),    n: 'drop' },
     { s: 9, p: 0, m: 15, e: _env(1, 0),    n: 'roar' },
     { s: 2, p: 7, m: 15, e: _env(0.6, 0),  n: 'wind' },
     { s: 0, p: 5, m: 15, e: _env(0.53, 3), n: 'brush' }
    ].forEach(function (d) {
      ed({ type: 'noise', clockShift: d.s, period: d.p, mode: d.m, envelope: d.e, authored: 'ed-n-' + d.n });
    });
    return out;
  })();

  // Build the full bank the driver and the synth both index into.
  function buildBank(patches) {
    var gb = (patches || []).filter(function (x) { return x.patch && x.patch.system === 'gameboy'; });
    gb = gb.concat(AUTHORED);
    gb.sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
    var waves = [], waveOf = {}, inst = [], meta = [];
    gb.forEach(function (row) {
      var p = row.patch, slot = 0;
      if (p.type === 'wave') {
        var key = (p.table4bit || []).join(',');
        if (waveOf[key] == null && waves.length < WAVE_SLOTS) {
          waveOf[key] = waves.length;
          waves.push((p.table4bit || []).slice(0, 32));
        }
        slot = waveOf[key] || 0;
      }
      if (inst.length >= 128) return;
      meta.push({ index: inst.length, type: p.type, patch: p, waveSlot: slot, weight: row.weight || 1 });
      inst.push(patchToInstrument(p, slot));
    });
    while (waves.length < WAVE_SLOTS) waves.push(new Array(32).fill(0));
    while (inst.length < 128) inst.push([0, 0, 0xFF, 0]);
    return { instruments: inst, waveTables: waves, arpTables: [], meta: meta };
  }

  // A note -> the four bytes the hardware wants, and the ONE place that decides
  // them. The cartridge driver and the browser's chip both write these, so a
  // song cannot mean two different things depending on where it is played --
  // which is exactly what happened when each side did its own conversion.
  //
  // rec is [byte0, nrx2, arpId, flags]: byte0 is the duty for a pulse, the wave
  // slot for channel 3, and the whole NR43 divisor/width/shift byte for noise.
  function noteRegisters(n, bank) {
    var inst = (bank && bank.instruments) || [];
    var rec = inst[n.inst] || [0, 0xF0, 0xFF, 0];
    var ch = n.ch | 0;
    // The envelope's starting volume is scaled by note velocity before it is
    // written; that is what gives one instrument its dynamics. Neither the
    // cartridge nor the APU can multiply at play time, so it is baked in here.
    var v0 = (rec[1] >> 4) & 15;
    var nativePulse = ch < 2 && n.trigger != null;
    var vol = Math.max(0, Math.min(15, Math.round(nativePulse ? 15 * (n.vel == null ? 1 : n.vel)
      : v0 * (0.35 + 0.65 * (n.vel == null ? 1 : n.vel)))));
    var nrx1, nrx2 = (vol << 4) | (nativePulse ? 8 : rec[1] & 0x0F), nrx3, nrx4, p;
    // A note may ask for a period the twelve-tone table has no name for: det
    // shifts it by whole period units. That is what detuning two channels
    // against each other is, and there is no other way to say it.
    var det = n.det | 0;
    if (ch === 0 || ch === 1) {
      p = midiToPeriod(n.midi, 'pulse').period + det;
      p = Math.max(0, Math.min(2047, p));
      nrx1 = rec[0] & 0xC0;                         // duty, zero length
      nrx3 = p & 0xFF;
      nrx4 = 0x80 | ((p >> 8) & 7);                 // trigger, length disabled
    } else if (ch === 2) {
      p = midiToPeriod(n.midi, 'wave').period + det;
      p = Math.max(0, Math.min(2047, p));
      // Channel 3 has no envelope -- it has four output levels. Map the
      // envelope's starting volume onto the closest one.
      nrx1 = 0;
      nrx2 = (vol >= 12 ? 1 : vol >= 6 ? 2 : vol >= 1 ? 3 : 0) << 5;
      nrx3 = p & 0xFF;
      nrx4 = 0x80 | ((p >> 8) & 7);
    } else {
      nrx1 = 0;
      nrx3 = rec[0] & 0xFF;                         // NR43 straight through
      nrx4 = 0x80;
    }
    return [nrx1, nrx2, nrx3, nrx4];
  }

  // Which wave slot an instrument asks for (channel 3 only).
  // The cartridge driver walks waveAddr forward index*16 bytes with an 8-bit
  // counter, so a wave index was never limited to a nibble -- only our own
  // record was. WAVE_SLOTS is the one number both sides read.
  //
  // A note on channel 3 does not have to carry a WAVE instrument: the composer
  // can land a pulse patch there, and then byte0 is a duty (0x80, say), not a
  // slot. The old nibble mask hid that by turning it into slot 0; the flag bit
  // keeps that behaviour honestly, and it is what makes >16 slots safe.
  function waveSlotOf(inst, index) {
    var rec = (inst || [])[index];
    if (!rec || !(rec[3] & 1)) return 0;
    return Math.min(WAVE_SLOTS - 1, rec[0] & 0xFF);
  }

  // A native pitch-only row continues the current voice, including its silent
  // state after KILL. Suppress a note-off at the continuation boundary (also
  // accepting the legacy one-frame articulation gap); longer gaps still cut.
  // Shared by browser and cartridge scheduling.
  function noteOffFrames(notes) {
    var order = notes.map(function (n, i) { return { n: n, i: i }; });
    order.sort(function (a, b) { return a.n.frame - b.n.frame || a.i - b.i; });
    var next = [], off = [];
    for (var i = order.length - 1; i >= 0; i--) {
      var item = order[i], n = item.n, ch = n.ch | 0;
      var end = (n.frame | 0) + Math.max(1, n.frames | 0), following = next[ch];
      off[item.i] = following && following.trigger === false &&
        Math.abs(following.frame - end) <= 1 ? null : end;
      next[ch] = n;
    }
    return off;
  }

  // ---- GROOVE: the only clock a tracker has --------------------------------
  //
  // A row lasts a whole number of frames, and a GROOVE is the short repeating
  // list of those tick counts. It does two jobs with one mechanism: it reaches
  // tempi between the rungs of the ladder, and it is where SWING lives.
  //
  // That second job is why this moved here from the editor. Swing used to be a
  // fractional nudge applied to each offbeat note -- which is not a thing LSDj
  // can hold, because LSDj has no position between two rows. It put 92% of our
  // off-grid notes off the grid. Expressed as a groove instead, the ROWS are
  // uneven and every note still sits exactly on one, which is both what a
  // tracker does and what the hardware does.
  //
  // ⚠️ ONLY TWO SHAPES, and that is the whole point. The first version reached
  // any tempo by making k of every four rows one tick longer -- [6,7,7,7],
  // [5,5,5,6] -- which is arithmetically neat and musically a LIMP; the ear
  // locks onto anything repeating every bar. So: [n] is even, [n,n+1] is a
  // symmetric alternation (a mild shuffle, a feel a musician would choose), and
  // a swing groove is an explicit long-short PAIR. Nothing lopsided.
  function grooveSpread(base, k) {
    if (k <= 0) return [base];
    if (k >= 2) return [base + 1];
    return [base, base + 1];
  }
  // CHOSEN BY SEARCH, not by arithmetic, because the answer has to be a tempo
  // the DOCUMENT can hold as well as one the machine can play. Rounding
  // straight to the nearest groove put bpm 70 on a 32nd grid at 68.9, below the
  // storable minimum -- the header wrote a negative offset, it wrapped through
  // the mask, and the song came back at 179. So: enumerate the grooves around
  // the target, discard any whose tempo cannot be represented, keep the closest.
  function grooveFor(bpm, swing, stepsPerBar) {
    var want = (60 / bpm) * 4 / stepsPerBar * FPS;      // frames per row, real
    var best = null, cand = [], i, b;
    if (swing) {
      // A shuffle is a long-short PAIR, defined on the pair rather than on the
      // average, so it keeps its character at every tempo.
      // `swing` may arrive as a RATIO (0.56 -- how much of the pair the long
      // half takes) or as a bare flag from the editor, which means the default
      // shuffle. Anything outside a sane ratio is treated as the flag, so a
      // `true` cannot silently become a pair of [pair, 2].
      var ratio = (typeof swing === 'number' && swing > 0.5 && swing < 0.8) ? swing : 0.62;
      for (i = -1; i <= 1; i++) {
        var pair = Math.max(4, Math.round(want * 2) + i);
        var lng = Math.max(2, Math.round(pair * ratio));
        cand.push([lng, Math.max(2, pair - lng)]);
      }
    } else {
      for (var base = Math.max(2, Math.floor(want) - 1); base <= Math.floor(want) + 1; base++)
        cand.push([base]);
    }
    for (i = 0; i < cand.length; i++) {
      b = bpmOfGroove(cand[i], stepsPerBar);
      if (b < 70 || b > 180) continue;                  // the header cannot carry it
      var d = Math.abs(b - bpm);
      if (!best || d < best.d) best = { g: cand[i], d: d };
    }
    return best ? best.g : [Math.max(2, Math.round(want))];
  }
  // The TRUE tempo of a groove, which is what the song actually plays at. A
  // document may carry any bpm; what it gets is the nearest one the machine can
  // hold, and reporting the asked-for number instead of the played one is how a
  // player comes to disagree with its own clock.
  function bpmOfGroove(g, stepsPerBar) {
    var sum = 0;
    for (var i = 0; i < g.length; i++) sum += g[i];
    return (240 * FPS) / (stepsPerBar * (sum / g.length));
  }
  // The frame a ROW starts on: sum the groove around the loop. Integer by
  // construction, which is the point -- there is no rounding here to drift.
  function rowFrame(g, row) {
    var n = g.length, sum = 0, i;
    for (i = 0; i < n; i++) sum += g[i];
    row = row | 0;
    var f = Math.floor(row / n) * sum, rem = row % n;
    for (i = 0; i < rem; i++) f += g[i];
    return f;
  }
  // frames in ONE row -- the average over the groove, for note lengths
  function framesPerRow(g) {
    var sum = 0;
    for (var i = 0; i < g.length; i++) sum += g[i];
    return sum / g.length;
  }

  // ---- LSDJ'S OWN CLOCK ----------------------------------------------------
  //
  // Measured off the real ROM in mGBA with a one-note-per-row ruler song, tempo
  // 60 to 255 (scripts/verify-lsdj-emulator.js):
  //
  //   ticks per second = 0.4 x TEMPO
  //   frames per tick  = 149.31875 / TEMPO        (149.31875 = 2.5 x FPS)
  //
  // A GROOVE is how many ticks each row lasts, default 6 -- which makes a row
  // 895.9125/TEMPO frames, so TEMPO is bpm with four rows to the beat.
  //
  // ⚠️ FRAMES PER TICK IS FRACTIONAL AND LSDJ DOES NOT ROUND IT. It runs an
  // accumulator, so rows come out as a MIX of two whole frame counts -- at tempo
  // 120 the trace is 7s and 8s interleaved. That matters twice over:
  //
  //   * it is why LSDj reaches every tempo and our eight-rung ladder did not.
  //     The ladder was our invention, and it offers LESS than the machine.
  //   * it is NOT the limp this project removed earlier. That was a four-step
  //     pattern with one odd step out, repeating every bar, which the ear locks
  //     onto instantly. An accumulator spreads the same total unevenness with no
  //     short period at all, which is why nobody has ever called LSDj lopsided.
  // ⚠️ 895.88, NOT 895.9125, AND ROUND, NOT CEIL -- both measured rather than
  // derived. The physical constant is 15 x FPS = 895.9125, and a model built on
  // it disagreed with LSDj about which individual rows get the spare frame on up
  // to 20% of rows. Fitting the real thing instead -- eight tempi, a hundred row
  // gaps each, straight off the ROM -- lands on
  //
  //     row k starts at round(k * 895.88 / TEMPO)
  //
  // which reproduces 796 of 800 measured gaps. Six of the eight tempi match
  // PERFECTLY; the four misses are two adjacent pairs, which is the signature of
  // the trace sampling at a frame edge rather than of the model being wrong.
  //
  // The averages were always right. This is about the ORDER of the spare frames,
  // which is what makes two players sound identical rather than merely equal in
  // tempo.
  var LSDJ_ROW_NUM = 895.88;                  // frames per row x TEMPO, measured
  var LSDJ_TICK_NUM = LSDJ_ROW_NUM / 6;       // ...and LSDj's default row is 6 ticks

  function lsdjFramesPerTick(tempo) { return LSDJ_TICK_NUM / tempo; }

  // The frame a tick STARTS on.
  function lsdjTickFrame(tempo, tick) {
    return Math.round(tick * LSDJ_TICK_NUM / tempo);
  }

  // The frame a ROW starts on, given the groove in TICKS.
  function lsdjRowFrame(tempo, ticks, row) {
    var n = ticks.length, sum = 0, i;
    for (i = 0; i < n; i++) sum += ticks[i];
    row = row | 0;
    var whole = Math.floor(row / n), rem = row % n, t = whole * sum;
    for (i = 0; i < rem; i++) t += ticks[i];
    return lsdjTickFrame(tempo, t);
  }

  function lsdjFramesPerRow(tempo, ticks) {
    return framesPerRow(ticks) * LSDJ_TICK_NUM / tempo;
  }

  // The tempo whose default 6-tick row is closest to this many frames. Integer,
  // because LSDj cannot store a fractional tempo either -- that is a limit we
  // SHARE with it rather than one we add.
  function lsdjTempoForRow(frames) {
    return Math.max(40, Math.min(255, Math.round(6 * LSDJ_TICK_NUM / frames)));
  }

  // THE GROOVE, IN LSDJ'S UNITS. Six ticks a row is LSDj's default and makes
  // TEMPO mean bpm; a shuffle keeps the same total so the tempo does not move,
  // and moves the beat inside it. [7,5] is the mild swing an LSDj musician
  // reaches for, [8,4] the hard one.
  //
  // These are the only shapes on offer because they are the only ones LSDj has:
  // whole ticks, and a pair that sums to twice the base. Our old frame-groove
  // could express ratios between them, which sounds like more and is really
  // just a number the machine cannot hold.
  function lsdjGrooveTicks(swing, stepsPerBar) {
    var base = Math.max(1, Math.round(6 * 16 / (stepsPerBar || 16)));
    if (!swing) return [base];
    var lng = Math.max(1, Math.min(2 * base - 1, Math.round(2 * base * (
      typeof swing === 'number' && swing > 0.5 && swing < 0.8 ? swing : 0.583))));
    return [lng, 2 * base - lng];
  }
  var LSDJ_TEMPO_MIN = 40, LSDJ_TEMPO_MAX = 255;

  var API = {
    FPS: FPS, CH: CH, DUTIES: DUTIES, WAVE_LEVELS: WAVE_LEVELS,
    noteRegisters: noteRegisters, waveSlotOf: waveSlotOf, noteOffFrames: noteOffFrames,
    NOISE_DIVISORS: NOISE_DIVISORS, RANGE: RANGE, WAVE_SLOTS: WAVE_SLOTS,
    midiToHz: midiToHz, midiToPeriod: midiToPeriod, inRange: inRange,
    beatToFrame: beatToFrame, frameToSec: frameToSec,
    quantDuty: quantDuty, patchToInstrument: patchToInstrument, buildBank: buildBank,
    grooveSpread: grooveSpread, grooveFor: grooveFor, bpmOfGroove: bpmOfGroove,
    rowFrame: rowFrame, framesPerRow: framesPerRow,
    LSDJ_TICK_NUM: LSDJ_TICK_NUM, lsdjFramesPerTick: lsdjFramesPerTick,
    lsdjTickFrame: lsdjTickFrame, lsdjRowFrame: lsdjRowFrame,
    lsdjFramesPerRow: lsdjFramesPerRow, lsdjTempoForRow: lsdjTempoForRow,
    lsdjGrooveTicks: lsdjGrooveTicks,
    LSDJ_TEMPO_MIN: LSDJ_TEMPO_MIN, LSDJ_TEMPO_MAX: LSDJ_TEMPO_MAX
  };
  G.CT_GB = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
