// CREATE: a pocket tracker on the real chip, one screen, four voices.
//
// The interaction model is the classic mobile step-sequencer shape: a 4x4
// grid holds one bar of one voice; tap a square for a note, drag up and
// down for pitch, drag sideways for length. Four channel buttons (the DMG's
// two pulses, wave, noise) switch voices; a bar row walks the song; a mood
// box asks the radio's own composer to write a whole track onto the grid.
//
// Everything downstream is the radio's machinery: the same emulated APU,
// the same instrument bank, the same ROM and WAV exporters. Songs live in
// the URL fragment; nothing here ever feeds the station.
(function (G) {
  'use strict';

  // The groove maths lives in gb-hardware, and this file reads it at load time,
  // so under Node it has to be pulled in HERE rather than left to whichever
  // gate happened to require it first. It always was ordered that way by luck;
  // the luck ran out the moment anything required create.js on its own.
  if (typeof module !== 'undefined' && module.exports && !G.CT_GB) require('./gb-hardware.js');

  var FPS = 59.7275;
  var FRAME_CYCLES = 70224;               // master cycles in one LCD frame
  var MAJOR = [0, 2, 4, 5, 7, 9, 11];
  var MINOR = [0, 2, 3, 5, 7, 8, 10];
  var MEL_ROWS = 15;                        // two octaves + the octave top
  var DRUM_LANES = 3;                       // hat / snare / kick, top to bottom
  var ROWS = MEL_ROWS + DRUM_LANES;

  // stamps: legacy ids kept for links and instrument defaults
  var STAMPS = [
    { id: 'piano',   ch: 'pulse', duty: 0.5,   env: 'pluck' },
    { id: 'trumpet', ch: 'pulse', duty: 0.25,  env: 'stab' },
    { id: 'flute',   ch: 'pulse', duty: 0.5,   env: 'soft' },
    { id: 'bell',    ch: 'pulse', duty: 0.125, env: 'pluck' },
    { id: 'bassg',   ch: 'wave',  wave: 'buzzy' },
    { id: 'cello',   ch: 'wave',  wave: 'mellow' }
  ];
  // The sounds a note can be given, by name -- the whole bank, not a token
  // handful. A pulse voice's timbre is its duty and its shape is its
  // envelope, so the pulse names are that grid; 75% duty is the same timbre
  // as 25% on this chip, so it only fills in a shape 25% does not have.
  // The chip's whole voice, named. A pulse instrument is a DUTY (its timbre)
  // crossed with an ENVELOPE (its shape), which is how a tracker player thinks
  // of one, so that is how the palette reads: a family down the left, its
  // characters across. 75% duty is 25% inverted -- the same timbre -- so it
  // only fills a character 25% does not have.
  var ENV_ORDER = ['pluck', 'stab', 'soft', 'sus', 'swell'];
  // A NOTE'S SOUND IS THE CHIP'S OWN SETTINGS, named the way LSDJ names them.
  // A pulse instrument is a duty and an envelope. A wave instrument is a
  // table. A noise instrument is a shape, a pitch and an envelope. That is the
  // whole model -- there is nothing else in one, on this hardware or in LSDJ,
  // and a list of invented timbre names only hid it.
  var DUTY_PC = ['12.5%', '25%', '50%', '75%'];
  // Named starting points. LSDJ has none -- you learn the chip -- but a name
  // you can hear teaches the two settings under it faster than a manual does:
  // pick one and watch Shape and Fade move to what it is made of.
  var PRESETS = {
    pulse: [
      { n: 'Pluck', dy: 2, fd: 2 }, { n: 'Bell',  dy: 0, fd: 3 },
      { n: 'Stab',  dy: 1, fd: 1 }, { n: 'Reed',  dy: 1, fd: 4 },
      { n: 'Organ', dy: 2, fd: 0 }, { n: 'Thin',  dy: 0, fd: 0 },
      { n: 'Soft',  dy: 3, fd: 5 }, { n: 'Swell', dy: 2, fd: 12 }
    ],
    noise: [
      { n: 'Kick',  nz: 12, ns: 0, fd: 1 }, { n: 'Snare', nz: 6, ns: 0, fd: 2 },
      { n: 'Hat',   nz: 1,  ns: 0, fd: 1 }, { n: 'Clap',  nz: 4, ns: 0, fd: 2 },
      { n: 'Tom',   nz: 9,  ns: 0, fd: 2 }, { n: 'Rumble', nz: 13, ns: 0, fd: 5 },
      { n: 'Ping',  nz: 2,  ns: 1, fd: 1 }, { n: 'Zap',   nz: 7, ns: 1, fd: 2 }
    ]
  };
  function presetOn(list, p) {
    var hit = -1;
    list.forEach(function (ps, i) {
      var same = true;
      for (var k in ps) if (k !== 'n' && ps[k] !== p[k]) same = false;
      if (same) hit = i;
    });
    return hit;
  }
  // LSDJ's ENV: 0 holds, 1..7 fades out (1 fastest), 9..F fades in (9 fastest)
  function fadeLabel(fd) {
    if (!fd || fd === 8) return 'hold';
    return (fd < 8 ? 'out ' : 'in ') + (fd < 8 ? fd : fd - 8);
  }
  // ordered by what the envelope DOES, so the stepper walks a straight line:
  // fastest fade out .. slowest .. hold .. slowest swell .. fastest
  var FADE_STEPS = [1, 2, 3, 4, 5, 6, 7, 0, 15, 14, 13, 12, 11, 10, 9];
  // the wave tables, roundest first, and the noise patches, brightest first.
  // A null is a MEASURED duplicate: see docs/HANDOFF.md.
  var WAVE_NAMES = ['Round', null, 'Cello', 'Vox', 'Wood', 'Reed', 'Thin', 'Saw',
                    'Growl', 'Ring', 'Chime', 'Glass', 'Metal', 'Buzz', 'Edge', 'Grit'];
  // MOTION: what the note DOES while it sounds. All of this already existed
  // in the build path (it is how trackers really did it -- one command
  // expanding into ordinary chip notes) and in the link format; the editor
  // simply had no way to reach it, which left every sound standing still.
  // Pitch slides need channel 1's sweep unit, so they are Melody's alone.
  var MOTIONS = [
    { n: 'Plain', k: '',  ch: [1, 1, 1, 1] },
    { n: 'Arp',   k: 'q', ch: [1, 1, 1, 0] },
    { n: 'Roll',  k: 'g', ch: [1, 1, 1, 1] },
    { n: 'Echo',  k: 'f', ch: [1, 1, 1, 1] },
    { n: 'Fall',  k: 'z', ch: [1, 0, 0, 0] },
    { n: 'Rise',  k: 'u', ch: [1, 0, 0, 0] }
  ];
  var MOTION_KEYS = ['q', 'g', 'f', 'z', 'u'];
  // (no sound is called Fall or Rise, and no motion is called Bloom: a word
  //  that means two things in one panel means neither)
  var SNDS = null;                          // resolved against the live bank
  var SLOTNAME = {};                        // every wave slot's name, listed or not
  var DRUMS = [
    { id: 'hat',   lane: 0, kind: 'hat',   vel: 0.5 },
    { id: 'snare', lane: 1, kind: 'snare', vel: 0.7 },
    { id: 'kick',  lane: 2, kind: 'kick',  vel: 0.9 }
  ];

  // ---- resolve stamps against the live bank --------------------------------
  var BANK = null, INSTOF = {};
  function envClass(rec) {
    var v0 = (rec[1] >> 4) & 15, pace = rec[1] & 7, dir = (rec[1] >> 3) & 1;
    if (dir) return 'swell'; if (pace === 0) return 'sus'; if (v0 <= 8) return 'soft';
    return pace <= 1 ? 'pluck' : 'stab';
  }
  function resolveBank() {
    if (BANK) return BANK;
    BANK = G.CT_GB.buildBank(G.CT_CHIP_INSTRUMENTS.patches);
    var meta = BANK.meta;
    // A wave table can be flat (span 0: pure DC, i.e. silence) -- the bank
    // holds a few as authored rests. A stamp must never resolve to one.
    function waveStats(m) {
      var t = BANK.waveTables[m.waveSlot] || [], mn = 99, mx = -99, big = 0;
      for (var i = 0; i < t.length; i++) {
        if (t[i] < mn) mn = t[i]; if (t[i] > mx) mx = t[i];
        if (i && Math.abs(t[i] - t[i - 1]) >= 6) big++;
      }
      return { span: mx - mn, big: big };
    }
    STAMPS.forEach(function (st) {
      var pool;
      if (st.ch === 'pulse') {
        pool = meta.filter(function (m) {
          return m.type === 'pulse' && m.patch.duty === st.duty && envClass(BANK.instruments[m.index]) === st.env;
        });
        if (!pool.length) pool = meta.filter(function (m) { return m.type === 'pulse'; });
      } else {
        var loud = meta.filter(function (m) { return m.type === 'wave' && waveStats(m).span >= 8; });
        pool = loud.filter(function (m) { return (st.wave === 'buzzy') === (waveStats(m).big >= 1); });
        if (!pool.length) pool = loud;
        pool.sort(function (a, b) {
          var A = waveStats(a), B = waveStats(b);
          return st.wave === 'buzzy' ? (B.big - A.big || B.span - A.span)
                                     : (A.big - B.big || B.span - A.span);
        });
        if (!pool.length) pool = meta.filter(function (m) { return m.type === 'wave'; });
      }
      INSTOF[st.id] = pool.length ? pool[0].index : 0;
    });
    var ns = meta.filter(function (m) { return m.type === 'noise'; })
                 .sort(function (a, b) { return (a.patch.clockShift || 0) - (b.patch.clockShift || 0); });
    var third = Math.max(1, Math.floor(ns.length / 3));
    INSTOF.hat = ns[0] ? ns[0].index : 0;
    INSTOF.snare = (ns[third] || ns[0]).index;
    INSTOF.kick = (ns[ns.length - 1] || ns[0]).index;
    buildSounds(meta);
    return BANK;
  }
  // ---- the named palette, read off the bank --------------------------------
  // A timbre is the SHAPE of its harmonic series: divide out loudness and
  // phase and two tables that sound alike look alike. That is how the wave
  // list stays honest -- ten names for ten timbres, not sixteen for twelve.
  function spectrum(t) {
    var N = t.length, mean = 0, i, k, n, out = [], sum = 0;
    for (i = 0; i < N; i++) mean += t[i];
    mean /= N || 1;
    for (k = 1; k <= N / 2; k++) {
      var re = 0, im = 0;
      for (n = 0; n < N; n++) {
        var a = -2 * Math.PI * k * n / N;
        re += (t[n] - mean) * Math.cos(a); im += (t[n] - mean) * Math.sin(a);
      }
      var mg = Math.sqrt(re * re + im * im);
      out.push(mg); sum += mg;
    }
    if (sum <= 0) return null;
    for (i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  }
  function buildSounds(meta) {
    SNDS = { wave: [] };
    // wave: one name per timbre, roundest first. Two tables that differ only
    // in loudness are ONE timbre: divide out level and phase and compare the
    // shape of the harmonic series.
    var seen = {}, shapes = [];
    meta.forEach(function (m) {
      if (m.type !== 'wave' || seen[m.waveSlot] != null) return;
      seen[m.waveSlot] = 1;
      var t = BANK.waveTables[m.waveSlot] || [];
      var sp = spectrum(t);
      if (!sp) return;                       // a flat table is an authored rest
      var cen = 0;
      for (var i = 0; i < sp.length; i++) cen += sp[i] * (i + 1);
      shapes.push({ inst: m.index, sp: sp, cen: cen });
    });
    shapes.sort(function (a, b) { return a.cen - b.cen; });
    var kept = [];
    shapes.forEach(function (w) {
      for (var i = 0; i < kept.length; i++) {
        var d = 0;
        for (var k = 0; k < w.sp.length; k++) d += Math.abs(w.sp[k] - kept[i].sp[k]);
        if (d < 0.16) return;                // the same timbre, louder or softer
      }
      kept.push(w);
    });
    kept.forEach(function (w, i) {
      if (WAVE_NAMES[i]) SNDS.wave.push({ n: WAVE_NAMES[i], fam: null, full: WAVE_NAMES[i], inst: w.inst });
    });
    // A composed note can point at a table the picker does not list -- the
    // dedupe keeps one of each timbre, and a song may hold one of the others.
    // Name those after the timbre they are a variant of, so the panel never
    // has to say "wave 7" at somebody.
    SLOTNAME = {};
    SNDS.wave.forEach(function (sd) { SLOTNAME[BANK.instruments[sd.inst][0] & 0xFF] = sd.n; });
    var seen2 = {};
    shapes.forEach(function (w) {
      var slot = BANK.instruments[w.inst][0] & 0xFF;
      if (SLOTNAME[slot] != null) return;
      var near = null, nd = 1e9;
      kept.forEach(function (k, i) {
        if (!WAVE_NAMES[i]) return;
        var d = 0;
        for (var j = 0; j < w.sp.length; j++) d += Math.abs(w.sp[j] - k.sp[j]);
        if (d < nd) { nd = d; near = WAVE_NAMES[i]; }
      });
      if (!near) near = 'Wave';
      seen2[near] = (seen2[near] || 1) + 1;
      SLOTNAME[slot] = near + ' ' + seen2[near];       // "Cello 2", not "wave 7"
    });
  }
  // ---- state ---------------------------------------------------------------
  var S = null, undoStack = [], redoStack = [];
  // HOW FINE THE GRID IS: steps in a bar. Sixteen is a sixteenth-note grid,
  // which is where most tracker music lives; twenty-four gives triplets and
  // thirty-two gives thirty-second notes. Everything that used to say "16"
  // asks spb() now, because a bar is not a fixed number of columns any more.
  var GRIDS = [16, 24, 32];
  function freshState() {
    // `tempoAt` is a list of [row, tempo] -- LSDj's T command, a tempo change
    // partway through a song. `master` is its M command, NR50's master volume,
    // which is song-wide rather than a note's. Both are empty for anything this
    // app composes; they exist so a song somebody else wrote survives import.
    return { key: 0, minor: 0, bars: 4, bpm: 128, swing: 0, grid: 16,
             cells: [], cur: 'piano', cmd: 0, wob: 0, title: '',
             tempoAt: [], master: null };
  }
  function spb() { return (S && S.grid) || 16; }
  function cols() { return S.bars * spb(); }
  function cellAt(c, r) {
    for (var i = 0; i < S.cells.length; i++)
      if (S.cells[i].c === c && S.cells[i].r === r) return i;
    return -1;
  }
  function snapshot() { dropLiveScore(); undoStack.push(JSON.stringify(S)); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
  function undo() { if (!undoStack.length) return; dropLiveScore(); redoStack.push(JSON.stringify(S)); S = JSON.parse(undoStack.pop()); dirty(); }
  function redo() { if (!redoStack.length) return; dropLiveScore(); undoStack.push(JSON.stringify(S)); S = JSON.parse(redoStack.pop()); dirty(); }

  // ---- music ---------------------------------------------------------------
  function scaleArr() { return S.minor ? MINOR : MAJOR; }
  function rowMidi(r) {                      // r: 0 = top melodic row
    var d = (MEL_ROWS - 1) - r;              // degree from the bottom
    return 48 + S.key + scaleArr()[d % 7] + 12 * Math.floor(d / 7);
  }
  // ---- TIME IS TICKS, AND A GROOVE IS THE ONLY WAY TO BEND IT --------------
  //
  // The hardware has no fractional frames. A step lasts an INTEGER number of
  // them. That is not a simplification, it is the whole timing model of every
  // Game Boy tracker, because it is the only thing the machine can do.
  //
  // This used to be a float: framesPer16() returned 6.27 and colFrame() rounded
  // the running total, so a "6.27 frame step" was really some steps of 6 frames
  // and some of 7, in whatever pattern the rounding happened to produce. That is
  // swing nobody asked for, it drifted with tempo, and it meant our tempi were
  // not reachable on the machine at all -- measured across 40 songs, only 7 sat
  // within a tenth of a frame of an integer step.
  //
  // A GROOVE is that unevenness made deliberate: a short repeating list of tick
  // counts. It is how a tracker reaches a tempo between the rungs of the ladder,
  // and it is how feel is expressed. Both jobs, one mechanism.
  //
  // Four steps is the longest groove used here on purpose. It gives quarter-of-
  // a-frame resolution on tempo, which is finer than the ear, and it stays a
  // pattern you could read off a screen. Eight would reach finer tempi and start
  // to sound like a limp.
  // ⚠️ ONLY TWO SHAPES ARE ALLOWED, AND THAT IS THE WHOLE POINT.
  //
  // The first version of this reached any tempo by making k of every four steps
  // one tick longer, which is arithmetically neat and musically wrong. A
  // four-step pattern with one odd step out -- [6,7,7,7], [5,5,5,6] -- is a
  // LIMP, and the ear locks onto anything that repeats every bar. It landed on
  // 51 songs out of 60, one step up to 19% off the average, and it is what made
  // the station sound worse after the tick rewrite than before it.
  //
  // The float rounding it replaced spread the same total error quasi-randomly
  // across steps, so it never formed a pattern and never became audible. That is
  // the thing to preserve: not the drift, but the absence of a repeating shape.
  //
  // So: [n] is even, and [n, n+1] is a symmetric alternation -- a mild shuffle,
  // which is a real feel a musician would choose. Nothing lopsided.
  var grooveSpread = G.CT_GB.grooveSpread;
  // CHOSEN BY SEARCH, not by arithmetic, because the answer has to be a tempo
  // the DOCUMENT can hold as well as one the machine can play. Rounding
  // straight to the nearest groove put bpm 70 on a 32nd grid at 68.9, which is
  // below the storable minimum -- the header wrote a negative offset, it wrapped
  // through the mask, and the song came back at 179. So: enumerate the grooves
  // around the target, discard any whose tempo cannot be represented, and keep
  // the closest of what remains.
  // ⚠️ ALL FOUR LIVE IN gb-hardware.js NOW, and these are the editor's handles
  // on them. They used to be written out here as well, which is two
  // implementations of the clock -- and the composer needed the same maths the
  // moment swing stopped being a nudge and became a groove. Two copies of a
  // clock is how a player comes to disagree with its own exporter.
  var grooveFor = G.CT_GB.grooveFor;
  var bpmOfGroove = G.CT_GB.bpmOfGroove;
  // ⚠️ THE CLOCK IS LSDJ'S NOW, and a groove is in TICKS. Measured off the real
  // ROM: ticks per second = 0.4 x TEMPO, so six ticks a row makes TEMPO ordinary
  // bpm with four rows to the beat, and a shuffle is a pair summing to twelve.
  //
  // What this replaces is a groove measured in FRAMES plus an eight-rung ladder
  // of the tempi that divide evenly into frames. LSDj has no such ladder: it
  // runs an accumulator and reaches every integer tempo, spending the leftover
  // as a mix of two whole frame counts. Our ladder was therefore offering LESS
  // than the machine, which is the one thing parity does not allow.
  function grooveTicks() {
    if (!S._groove || S._groove.bpm !== S.bpm || S._groove.sw !== S.swing || S._groove.spb !== spb())
      S._groove = { bpm: S.bpm, sw: S.swing, spb: spb(), g: G.CT_GB.lsdjGrooveTicks(S.swing, spb()) };
    return S._groove.g;
  }
  var groove = grooveTicks;
  // frames in ONE STEP -- the average over the groove, for note lengths
  function framesPer16() { return G.CT_GB.lsdjFramesPerRow(S.bpm, grooveTicks()); }
  // ⚠️ PIECEWISE, because the tempo can change partway through. With no changes
  // this is one call and behaves exactly as it always did; with them the frame
  // of a row is the sum over the segments before it. LSDj's T command is the
  // only thing that produces them, so nothing this app composes takes the slow
  // path.
  function colFrame(c) {
    var g = grooveTicks(), chg = S.tempoAt;
    if (!chg || !chg.length) return G.CT_GB.lsdjRowFrame(S.bpm, g, c);
    var f = 0, cur = S.bpm, at = 0, i;
    for (i = 0; i < chg.length && chg[i][0] < c; i++) {
      f += G.CT_GB.lsdjRowFrame(cur, g, chg[i][0] - at);
      cur = chg[i][1]; at = chg[i][0];
    }
    return f + G.CT_GB.lsdjRowFrame(cur, g, c - at);
  }
  // WHERE A NOTE ACTUALLY STARTS. The grid is where you place notes by hand;
  // a note may also carry an offset in frames, which is how a composed song
  // survives being imported -- the composer writes at frame resolution and
  // rounding every note to the nearest sixteenth is a different piece of music.
  function cellFrame(x) { return colFrame(x.c) + (x.of | 0); }
  // What voice does a cell want? Legacy stamps say pulse-or-wave; composed
  // cells carry the exact instrument, and the bank's meta says its channel.
  function cellVoice(x) {
    if (x.inst != null) {
      for (var i = 0; i < BANK.meta.length; i++) if (BANK.meta[i].index === x.inst)
        return BANK.meta[i].type === 'wave' ? 'wave' : BANK.meta[i].type === 'noise' ? 'noise' : 'pulse';
    }
    for (var j = 0; j < STAMPS.length; j++) if (STAMPS[j].id === x.st)
      return STAMPS[j].ch === 'wave' ? 'wave' : 'pulse';
    return null;
  }
  // MOVES: what happens to a note WHILE it sounds. On this chip that is the
  // whole difference between a tone and an instrument -- the driver writes
  // registers every frame, and these say which ones.
  var VIBTAB = [0, 3, 4, 3, 0, -3, -4, -3];
  function automate(x, note, out) {
    var ch = note.ch | 0, f0 = note.frame | 0, len = Math.max(2, note.frames | 0);
    var i, k;
    // A sixteenth at 150bpm is about six frames. These used to need eight or
    // more, so switching a move on for an ordinary note did nothing at all --
    // the step scales with the note now, and only something under three frames
    // is genuinely too short to move through.
    if (x.vb && ch !== 3 && note.midi != null && len > 3) {   // wobble: its own vibrato
      var preg = ch === 0 ? 0x13 : ch === 1 ? 0x18 : 0x1D;
      var per0 = G.CT_GB.midiToPeriod(note.midi, ch === 2 ? 'wave' : 'pulse').period;
      if (ch < 2) out.vibOff.push({ f: f0, ch: ch });        // the driver lets go
      var vstep = Math.max(2, Math.round(len / 6));
      for (i = Math.min(3, vstep), k = 0; i < len - 1; i += vstep, k++) {
        var p2 = Math.max(0, Math.min(2047, per0 + VIBTAB[k & 7]));
        out.auto.push({ f: f0 + i, r: preg, v: p2 & 0xFF });
        if (((p2 >> 8) & 7) !== ((per0 >> 8) & 7))
          out.auto.push({ f: f0 + i, r: preg + 1, v: (p2 >> 8) & 7 });
      }
    }
    if (x.sq && ch < 2 && len > 3) {                          // sweep: the duty walks
      var nrx1 = 0x11 + ch * 5;
      var rec0 = (songBank || BANK).instruments[note.inst] || [0];
      var d0 = (rec0[0] >> 6) & 3;
      var sstep = Math.max(2, Math.round(len / 4));
      for (i = sstep, k = 1; i < len - 1; i += sstep, k++)
        out.auto.push({ f: f0 + i, r: nrx1, v: (((d0 + k) & 3) << 6) });
    }
    if (x.mp && ch === 2 && len > 5) {                        // morph: the table changes
      var slot0 = G.CT_GB.waveSlotOf((songBank || BANK).instruments, note.inst);
      var tables = (songBank || BANK).waveTables.length;
      var mstep = Math.max(3, Math.round(len / 4));
      for (i = mstep, k = 1; i < len - 1; i += mstep, k++)
        out.waveLoads.push({ f: f0 + i, slot: (slot0 + k) % tables });
    }
    if (x.pn) out.pan.push({ f: f0, ch: ch, mode: x.pn, off: f0 + len });
    if (x.gl && ch !== 3 && note.midi != null && out.last[ch] != null) {
      // GLIDE: the pitch walks from the note before it to this one, in period
      // units, which is the only kind of slide the chip understands off
      // channel 1's sweep unit
      var greg = ch === 0 ? 0x13 : ch === 1 ? 0x18 : 0x1D;
      var kind = ch === 2 ? 'wave' : 'pulse';
      var from = out.last[ch], to = G.CT_GB.midiToPeriod(note.midi, kind).period + (note.det | 0);
      var steps = Math.min(12, Math.max(3, Math.round(len / 3)));
      for (var gi = 1; gi <= steps; gi++) {
        var gp = Math.round(from + (to - from) * (gi / steps));
        gp = Math.max(0, Math.min(2047, gp));
        out.auto.push({ f: f0 + gi, r: greg, v: gp & 0xFF });
        out.auto.push({ f: f0 + gi, r: greg + 1, v: (gp >> 8) & 7 });
      }
      if (ch < 2) out.vibOff.push({ f: f0, ch: ch });
    }
    if (ch !== 3 && note.midi != null)
      out.last[ch] = G.CT_GB.midiToPeriod(note.midi, ch === 2 ? 'wave' : 'pulse').period + (note.det | 0);
  }
  // NR51 is one byte for the whole machine, so panning is a running value:
  // collect what each note wants and write the byte only where it changes.
  function panWrites(pan, auto) {
    if (!pan.length) return;
    var edges = [];
    pan.forEach(function (p) {
      edges.push({ f: p.f, ch: p.ch, mode: p.mode });
      edges.push({ f: p.off, ch: p.ch, mode: 0 });
    });
    edges.sort(function (a, b) { return a.f - b.f; });
    var cur = 0xFF, want = [0, 0, 0, 0];
    edges.forEach(function (e) {
      want[e.ch] = e.mode;
      var v = 0;
      for (var c = 0; c < 4; c++) {
        var m = want[c];
        if (m !== 2) v |= (1 << (c + 4));    // left speaker
        if (m !== 1) v |= (1 << c);          // right speaker
      }
      if (v === cur) return;
      cur = v;
      auto.push({ f: e.f, r: 0x25, v: v });
    });
  }
  function buildSong() {
    resolveBank();
    freshSongBank();
    var moves = { auto: [], vibOff: [], waveLoads: [], pan: [], kit: [], last: [null, null, null, null] };
    var notes = [], per = framesPer16();
    var byCol = {};
    S.cells.forEach(function (x) { delete x.x; delete x.rch; (byCol[x.c] = byCol[x.c] || []).push(x); });
    var held = [[], [], [], []];              // what each voice is busy with, in frames
    function voiceFree(ch, from, to) {
      var l = held[ch];
      for (var i = 0; i < l.length; i++) if (from < l[i][1] && to > l[i][0]) return false;
      return true;
    }
    function claim(ch, from, to) { held[ch].push([from, to]); }
    for (var c = 0; c < cols(); c++) {
      var here = byCol[c] || [];
      here.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
      here.forEach(function (x) {
        if (x.vel === 0 && !x.nt) { x.rch = x.r >= MEL_ROWS ? 3 : x.rch; return; }   // native zero-volume triggers still change state
        if (x.r >= MEL_ROWS) {                              // drum lane
          var d = DRUMS[x.r - MEL_ROWS];
          var dF = cellFrame(x), dLen = Math.max(2, Math.round(per * (x.len || 0.6)));
          if (!voiceFree(3, dF, dF + dLen)) { x.x = 1; return; }
          claim(3, dF, dF + dLen); x.rch = 3;
          if (x.kt) {                                       // a KIT hit: four-bit
            var kid = (x.kt - 1) & 7;                       // sample on channel 3
            moves.kit.push({ f: cellFrame(x), id: kid });
            var kk = G.CT_GB_KITS && G.CT_GB_KITS.byId(kid);
            // the sample leaves a waveform in wave RAM that is not a table, so
            // the bass voice needs its own back when the hit is over
            if (kk) moves.waveLoads.push({ f: colFrame(c) + Math.ceil(kk.data.length / 32) * 32 * 512 / FRAME_CYCLES + 1,
                                           slot: laneWave() });
            return;
          }
          var dInst = instOf(x, 3);
          if (dInst == null) dInst = x.inst != null ? x.inst : INSTOF[d.id];
          var dVel = x.vel != null ? x.vel : d.vel;
          if (x.g) {                                        // drum ratchet
            var dHit = Math.max(2, Math.round(per / 2));
            for (var df = 0; df < per * (x.len || 1) - 1; df += dHit)
              notes.push({ ch: 3, frame: cellFrame(x) + df, frames: Math.max(2, dHit - 1),
                           midi: null, inst: dInst, vel: dVel, pri: 9 - d.lane });
          } else if (x.f) {                                 // drum echo
            var dv = dVel;
            for (var ds = 0; ds < Math.max(2, x.len || 4) && c + ds < cols(); ds++, dv *= 0.55)
              notes.push({ ch: 3, frame: colFrame(c + ds), frames: Math.max(2, Math.round(per * 0.5)),
                           midi: null, inst: dInst, vel: dv, pri: 9 - d.lane });
          } else {
            notes.push({ ch: 3, frame: cellFrame(x),
                         frames: x.len ? Math.max(2, Math.round(per * x.len) - 1) : Math.max(2, Math.round(per * 0.6)),
                         midi: null, inst: dInst, vel: dVel, pri: 9 - d.lane });
          }
          if (hasMoves(x)) automate(x, notes[notes.length - 1], moves);
          return;
        }
        var voice = cellVoice(x);
        if (!voice || voice === 'noise') { x.x = 1; return; }
        var steps = x.len ? x.len : (x.w ? 8 : 0.96);
        var totalF = x.lf ? Math.max(1, x.lf | 0) : Math.max(2, Math.round(per * steps) - 1);
        if (x.nt && !x.lf) totalF = Math.max(1, colFrame(c + steps) - cellFrame(x));
        var mInst = instOf(x, voice === 'wave' ? 2 : (x.ch === 1 ? 1 : 0));
        var note = { frame: cellFrame(x), frames: totalF, det: x.dt | 0,
                     midi: x.midi != null ? x.midi : rowMidi(x.r),
                     inst: mInst != null ? mInst : (x.inst != null ? x.inst : INSTOF[x.st]),
                     vel: x.vel != null ? x.vel : 0.8, pri: 5 };
        if (x.nt) note.trigger = x.nt === 1;
        if (voice === 'wave') {
          if (!voiceFree(2, note.frame, note.frame + totalF)) { x.x = 1; return; }
          claim(2, note.frame, note.frame + totalF); note.ch = 2; x.rch = 2;
        } else {
          // an exact channel claims its slot first, then the other pulse;
          // slides want channel 1's sweep unit; the rest take what is free
          var wantCh = (x.ch === 0 || x.ch === 1) ? x.ch
                     : (x.z || x.u || x.sweep != null) ? 0
                     : (voiceFree(0, note.frame, note.frame + totalF) ? 0 : 1);
          var ch = voiceFree(wantCh, note.frame, note.frame + totalF) ? wantCh
                 : voiceFree(1 - wantCh, note.frame, note.frame + totalF) ? 1 - wantCh : -1;
          if (ch < 0) { x.x = 1; return; }
          claim(ch, note.frame, note.frame + totalF); note.ch = ch; x.rch = ch;
          if (x.sweep != null) { if (note.ch === 0) note.sweep = x.sweep; }
          else if (note.ch === 0 && x.z) note.sweep = 0x3E;  // the fall off the note
          else if (note.ch === 0 && x.u) note.sweep = 0x36;  // ...and the rise
        }
        // COMMANDS expand into ordinary chip notes (how trackers really did it)
        if (x.q) {                                          // arp: strum the chord
          var iv = S.minor ? [0, 3, 7] : [0, 4, 7];
          var sub = Math.max(2, Math.round(per / 3));
          for (var f = 0, k = 0; f < totalF - 1; f += sub, k++)
            notes.push({ ch: note.ch, frame: note.frame + f, frames: Math.min(sub, totalF - f),
                         midi: note.midi + iv[k % 3], inst: note.inst, vel: note.vel, pri: 5, sweep: note.sweep });
        } else if (x.g) {                                   // retrig: half-step ratchet
          var hitF = Math.max(2, Math.round(per / 2));
          for (var f2 = 0; f2 < totalF - 1; f2 += hitF)
            notes.push({ ch: note.ch, frame: note.frame + f2, frames: Math.max(2, hitF - 1),
                         midi: note.midi, inst: note.inst, vel: note.vel, pri: 5, sweep: note.sweep });
        } else if (x.f) {                                   // echo: repeat and fade
          var st2 = 0, v2 = note.vel;
          for (st2 = 0; st2 < Math.max(2, Math.round(steps)) && c + st2 < cols(); st2++, v2 *= 0.6)
            notes.push({ ch: note.ch, frame: colFrame(c + st2), frames: Math.max(2, Math.round(per * 0.9)),
                         midi: note.midi, inst: note.inst, vel: v2, pri: 5, sweep: note.sweep });
        } else notes.push(note);
        if (!hasMoves(x) && note.midi != null && note.ch !== 3)
          moves.last[note.ch] = G.CT_GB.midiToPeriod(note.midi, note.ch === 2 ? 'wave' : 'pulse').period + (note.det | 0);
        if (hasMoves(x)) {
          var mine = notes.slice(-4).filter(function (n2) { return n2.frame === note.frame || n2.ch === note.ch; });
          automate(x, mine.length ? mine[mine.length - 1] : note, moves);
        }
      });
    }
    notes.sort(function (a, b) { return a.frame - b.frame; });
    notes.forEach(function (n) {
      if (n.trigger != null && n.ch < 2) moves.vibOff.push({ f: n.frame, ch: n.ch });
    });
    panWrites(moves.pan, moves.auto);
    // What this song would cost a 32KB cartridge. The export throws when it
    // does not fit, and a toast after the click is a poor way to learn.
    romBytes = 4200                                   // driver, tiles, screen, wave tables
             + notes.length * 8                       // note on + off + the delay bytes
             + moves.auto.length * 4 + moves.waveLoads.length * 3 + moves.kit.length * 3
             + moves.kit.reduce(function (a, k) {
                 var kk = G.CT_GB_KITS && G.CT_GB_KITS.byId(k.id);
                 return a + (kk ? kk.data.length / 2 : 0);
               }, 0);
    moves.auto.sort(function (a, b) { return a.f - b.f; });
    var total = Math.round(cols() * per);
    // M, LSDj's master volume, arrives as a document field and leaves as the
    // score's gain -- the same knob the player already honours for a composed
    // score, so nothing downstream needed teaching.
    return { notes: notes, bank: songBank || BANK, totalFrames: total,
             gainScalar: S.master == null ? undefined : Math.max(0.05, Math.min(1, (S.master + 1) / 16)),
             auto: moves.auto, vibOff: moves.vibOff, waveLoads: moves.waveLoads,
             kit: moves.kit, loopFrames: total };
  }

  // SHARING IS THE SAME ACT IN BOTH PLACES. The station's share button and this
  // one produce the same kind of link -- the document, packed, in the fragment
  // -- because after the merge there is only one kind of song. A song made here
  // and a song heard there are the same object, so handing one to somebody
  // cannot be two different gestures with two different results.
  function shareSong(btn) {
    var code = encode();
    var done = function (url) {
      var say = function (ok) {
        if (btn) { var t0 = btn.textContent; btn.textContent = ok ? 'Copied' : 'Press Cmd-C';
                   setTimeout(function () { btn.textContent = t0; }, 1300); }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText)
          navigator.clipboard.writeText(url).then(function () { say(true); }, function () { say(false); });
        else say(false);
      } catch (e) { say(false); }
    };
    var pack = (typeof G._packDoc === 'function') ? G._packDoc(code) : null;
    if (pack && pack.then) pack.then(function (p) { done(G.location.origin + '/#s=' + p); },
                                     function () { done(G.location.origin + '/#s=r' + code); });
    else done(G.location.origin + '/#s=r' + code);
  }

  // ---- serialize: the song IS the URL --------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var CODE_CMD = { 1: 'u', 2: 'q', 3: 'g', 4: 'f' };
  // 0 is "not in the set", so an unexpected character survives as a space
  var TITLE_A = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.";
  // v6: cells carry an extension with the exact instrument, pitch, length,
  // velocity, channel and sweep whenever any of them exists. bpm rides as
  // (bpm-70)/2. All older versions still decode.
  function encode() {
    var ids = STAMPS.map(function (s) { return s.id; });
    // v12: bars need more than six bits now that nothing caps them
    // v13: the TITLE rides inside the document. Names are derived from a token
    // and a document has no token, so without this a song opens under a
    // different name than the one the sender was looking at when they shared it.
    // The round trip is a fixed point because the tempo is simply CARRIED now.
    // It used to be snapped on both sides -- a document was born on an
    // eight-rung ladder, because a row had to be a whole number of frames. LSDj
    // proved that wrong: it accumulates, so every integer tempo is playable and
    // the rows come out as a mix of two frame counts. Nothing to snap to.
    var bpm = Math.max(70, Math.min(180, S.bpm | 0));
    // v14: a tempo-change list and a master volume, so a song that uses LSDj's
    // T or M commands survives import. Both are empty for anything composed
    // here, and a document with neither encodes IDENTICALLY to v13 apart from
    // the version byte -- so the new fields cost nothing when they are unused.
    var tAt = (S.tempoAt || []).filter(function (p2) {
      return p2 && p2.length === 2 && p2[0] >= 0 && p2[1] >= 40 && p2[1] <= 255;
    }).slice(0, 63);
    // v15 carries native pulse trigger state; ordinary documents stay v13/14.
    var nativeTriggers = S.cells.some(function (x) { return !!x.nt; });
    var out = [nativeTriggers ? 15 : tAt.length || S.master != null ? 14 : 13,
               S.key, S.minor, S.bars & 63, (bpm - 70) & 63,
               S.swing | (((bpm - 70) >> 6) << 1), (S.bars >> 6) & 63,
               Math.max(0, GRIDS.indexOf(spb()))];
    var t = String(S.title || '').slice(0, 48);
    out.push(t.length & 63);
    for (var ti = 0; ti < t.length; ti++) out.push(TITLE_A.indexOf(t.charAt(ti)) + 1 & 63);
    if (out[0] >= 14) {
      out.push((S.master == null ? 0 : (S.master & 15) + 1) & 63);
      out.push(tAt.length & 63);
      for (var qi = 0; qi < tAt.length; qi++)
        out.push(tAt[qi][0] & 63, (tAt[qi][0] >> 6) & 63,       // row, 12 bits
                 tAt[qi][1] & 63, (tAt[qi][1] >> 6) & 3);       // tempo, 8 bits
    }
    S.cells.forEach(function (x) {
      var st = x.r >= MEL_ROWS ? 15 : (x.st && x.st.charAt(0) === 'i' ? 14 : Math.max(0, ids.indexOf(x.st)));
      var ext = x.inst != null || x.vel != null || x.midi != null || (x.len || 1) > 1 || x.sweep != null || x.ch != null;
      var snd = x.dy != null || x.fd != null || x.wv != null || x.nz != null || x.ns != null;
      var mov = !!(x.vb || x.sq || x.mp || x.pn || x.gl || x.kt || x.dt || x.of || x.lf);
      var cmd = (x.u ? 1 : x.q ? 2 : x.g ? 3 : x.f ? 4 : 0) | (snd ? 8 : 0) | (mov ? 16 : 0) | (x.nt ? 32 : 0);
      out.push(x.c & 63, (x.c >> 6) & 63, x.r | (x.z ? 32 : 0), st | (x.w ? 16 : 0) | (ext ? 32 : 0), cmd);
      if (x.nt) out.push(x.nt & 3);
      if (ext) {
        var ip1 = x.inst != null ? x.inst + 1 : 0;           // 0 = no exact instrument
        var midi = x.midi != null ? (x.midi | 0) : 0;
        var hasSweep = x.sweep != null;
        out.push(ip1 & 63,
                 ((ip1 >> 6) & 3) | (hasSweep ? 4 : 0) | ((x.ch != null ? x.ch + 1 : 0) << 3) | (x.midi != null ? 32 : 0),
                 ((x.len || 1) - 1) & 63,
                 Math.round((x.vel != null ? x.vel : 0.8) * 63) & 63,
                 midi & 63, (midi >> 6) & 1);
        if (hasSweep) out.push(x.sweep & 63, (x.sweep >> 6) & 3);
      }
      if (snd) {                              // the chip settings, four chars
        out.push(((x.fd | 0) & 15) | (x.fd != null ? 16 : 0) | (x.ns != null ? 32 : 0),
                 ((x.dy | 0) & 3) | (x.dy != null ? 4 : 0) | (((x.ns | 0) & 1) << 3) |
                   (x.wv != null ? 16 : 0) | (x.nz != null ? 32 : 0),
                 (x.wv | 0) & 31,
                 (x.nz | 0) & 15);
      }
      if (mov) out.push((x.vb ? 1 : 0) | (x.sq ? 2 : 0) | (x.mp ? 4 : 0) | (((x.pn | 0) & 3) << 3) | (x.gl ? 32 : 0),
                        (x.kt | 0) & 15,                       // which sample, if any
                        ((x.dt | 0) + 16) & 63,                // detune, offset so it fits
                        ((x.of | 0) + 32) & 63,                // frames off the grid
                        (x.lf | 0) & 63, ((x.lf | 0) >> 6) & 63);   // exact length, when it has one
    });
    return out.map(function (v) { return B64[v & 63]; }).join('');
  }
  function decode(str) {
    try {
      var v = []; for (var i = 0; i < str.length; i++) { var ix = B64.indexOf(str[i]); if (ix < 0) return null; v.push(ix); }
      var ver = v[0];
      if (ver < 1 || ver > 15) return null;
      var st2 = freshState();
      st2.key = v[1] % 12; st2.minor = v[2] & 1;
      st2.bars = ver === 1 ? ([2, 4, 8].indexOf(v[3]) >= 0 ? v[3] : 4)
               : ver >= 12 ? Math.max(1, Math.min(4095, v[3] | ((v[6] & 63) << 6)))
                           : Math.max(1, Math.min(48, v[3]));
      st2.bpm = ver >= 11 ? Math.max(70, Math.min(180, 70 + (v[4] & 63) + (((v[5] >> 1) & 3) << 6)))
                          : Math.max(70, Math.min(180, ver >= 5 ? 70 + v[4] * 2 : v[4] * 2));
      st2.swing = v[5] & 1;
      st2.grid = ver >= 12 ? (GRIDS[v[7]] || 16) : ver >= 9 ? (GRIDS[v[6]] || 16) : 16;
      // TEMPO IS SNAPPED TO WHAT THE MACHINE CAN ACTUALLY HOLD. A document may
      // carry any bpm; what it gets is the nearest groove the hardware can play,
      // and the state has to report the tempo it PLAYS rather than the one it was
      // asked for. Reporting the asked-for number is how a player comes to
      // disagree with its own clock.
      // ⚠️ NO LONGER SNAPPED. A document used to be pulled onto an eight-rung
      // ladder of tempi whose rows divide evenly into frames, on the way in AND
      // on the way out, so the round trip stayed a fixed point. LSDj has no such
      // ladder -- it runs an accumulator and plays every integer tempo -- so the
      // snap was throwing away 103 of the 111 tempi in our own range and telling
      // the user it was a hardware limit. It was ours.
      st2.groove = G.CT_GB.lsdjGrooveTicks(st2.swing, st2.grid);
      var head = ver >= 12 ? 8 : ver >= 9 ? 7 : 6;
      if (ver >= 13) {                       // the title block, then the cells
        var tn = v[head] | 0, tt = '';
        for (var tq = 0; tq < tn; tq++) {
          var tc = v[head + 1 + tq] | 0;
          tt += tc > 0 ? TITLE_A.charAt(tc - 1) : ' ';
        }
        st2.title = tt.trim();
        head += 1 + tn;
      }
      // v14's two extra song-level fields, after the title and before the cells.
      // A v13 document simply has neither, which is why the version guards the
      // read rather than a flag inside it.
      if (ver >= 14) {
        var mv = v[head] | 0;
        st2.master = mv > 0 ? (mv - 1) & 15 : null;
        var tc2 = v[head + 1] | 0;
        head += 2;
        st2.tempoAt = [];
        for (var qj = 0; qj < tc2; qj++) {
          var row = (v[head] | 0) | ((v[head + 1] | 0) << 6);
          var tmp = (v[head + 2] | 0) | (((v[head + 3] | 0) & 3) << 6);
          if (tmp >= 40 && tmp <= 255) st2.tempoAt.push([row, tmp]);
          head += 4;
        }
      }
      var ids = STAMPS.map(function (s) { return s.id; });
      if (ver === 1) {
        for (var j = 6; j + 2 < v.length + 1; j += 3) {
          var c = v[j] | ((v[j + 1] >> 5) << 6), r = v[j + 1] & 31, b = v[j + 2];
          if (b == null) break;
          var cell = { c: c, r: r, t: j };
          if (r < MEL_ROWS) { cell.st = ids[b & 15] || 'piano'; if (b & 16) cell.z = 1; if (b & 32) cell.w = 1; }
          st2.cells.push(cell);
        }
      } else {
        var k = head;
        while (k + 3 < v.length + 1) {
          var c2 = v[k] | (v[k + 1] << 6), r2 = v[k + 2] & 31, b2 = v[k + 3];
          var cell2 = { c: c2, r: r2, t: k };
          var stc = b2 & 15;
          if (r2 < MEL_ROWS) { if (stc !== 14) cell2.st = ids[stc] || 'piano'; if (v[k + 2] & 32) cell2.z = 1; if (b2 & 16) cell2.w = 1; }
          k += 4;
          var cmdRaw = 0;
          if (ver >= 4) {   // v4+: one command char per cell
            cmdRaw = v[k];
            var cc = CODE_CMD[v[k] & 7];
            if (cc && r2 < MEL_ROWS + DRUM_LANES) cell2[cc] = 1;
            k += 1;
          }
          if (ver >= 15 && (cmdRaw & 32)) cell2.nt = v[k++] & 3;
          if (ver >= 3 && (b2 & 32) && k + 5 < v.length + 1) {
            var e1 = v[k + 1];
            var rawInst = v[k] | ((e1 & 3) << 6);
            if (ver >= 6) { if (rawInst > 0) cell2.inst = rawInst - 1; }
            else cell2.inst = rawInst;
            var chc = (e1 >> 3) & 3; if (chc) cell2.ch = chc - 1;   // & 7 used to swallow the midi flag into the channel
            var ln = (v[k + 2] & 63) + 1; if (ln > 1) cell2.len = ln;
            cell2.vel = v[k + 3] / 63;
            if (e1 & 32) cell2.midi = v[k + 4] | ((v[k + 5] & 1) << 6);
            k += 6;
            if (e1 & 4 && k + 1 < v.length + 1) { cell2.sweep = v[k] | ((v[k + 1] & 3) << 6); k += 2; }
            if (stc === 14 && r2 < MEL_ROWS && cell2.inst != null) cell2.st = 'i' + cell2.inst;
          }
          if (ver >= 7 && (cmdRaw & 8) && k + 3 < v.length + 1) {
            var s1 = v[k], s2 = v[k + 1];
            if (s1 & 16) cell2.fd = s1 & 15;
            if (s1 & 32) cell2.ns = (s2 >> 3) & 1;
            if (s2 & 4) cell2.dy = s2 & 3;
            if (s2 & 16) cell2.wv = v[k + 2] & 31;
            if (s2 & 32) cell2.nz = v[k + 3] & 15;
            k += 4;
          }
          if (ver >= 8 && (cmdRaw & 16) && k < v.length) {
            var mvb = v[k];
            if (mvb & 1) cell2.vb = 1;
            if (mvb & 2) cell2.sq = 1;
            if (mvb & 4) cell2.mp = 1;
            if ((mvb >> 3) & 3) cell2.pn = (mvb >> 3) & 3;
            if (mvb & 32) cell2.gl = 1;
            k += 1;
            if (ver >= 10 && k + 1 < v.length + 1) {
              if (v[k] & 15) cell2.kt = v[k] & 15;
              var dtv = v[k + 1] & 63;
              if (dtv !== 16) cell2.dt = dtv - 16;
              k += 2;
              if (ver >= 11 && k + 2 < v.length + 1) {
                var ofv = (v[k] & 63) - 32;
                if (ofv) cell2.of = ofv;
                var lfv = (v[k + 1] & 63) | ((v[k + 2] & 63) << 6);
                if (lfv) cell2.lf = lfv;
                k += 3;
              }
            }
          }
          st2.cells.push(cell2);
        }
      }
      st2.cells = st2.cells.filter(function (x) { return x.c < st2.bars * (st2.grid || 16); });
      return st2;
    } catch (e) { return null; }
  }

  // ---- playback: live score, loop-a-bar, transport --------------------------
  var root = null, playing = false, playT0 = 0, order = 0, pausedAt = 0;
  var liveScore = null, liveBpm = 0, liveMood = '';
  function curBpm() { return liveScore ? liveBpm : S.bpm; }
  function dropLiveScore() { liveScore = null; liveBpm = 0; }
  var chMuted = [false, false, false, false];
  function effMask() { return chMuted.slice(); }
  function applyMute() {
    if (typeof Audio !== 'undefined' && Audio.setChipMute) {
      var m = effMask();
      Audio.setChipMute(m[0] || m[1] || m[2] || m[3] ? m : null);
    }
    renderChans(); renderGrid();
  }
  var loopBar = -1, queuedBar = null, loopPhase = 0;
  function barFrames() { return FPS * 60 * 4 / curBpm(); }
  function songMs() {
    if (loopBar >= 0) return (barFrames() / FPS) * 1000;
    return liveScore ? (liveScore.totalFrames / FPS) * 1000
                     : cols() * ((60 / S.bpm) * 4 / spb()) * 1000;
  }
  function sliceForBar(song, b) {
    var bf = barFrames(), f0 = Math.round(b * bf), f1 = Math.round((b + 1) * bf);
    var notes = [];
    song.notes.forEach(function (n) {
      if (n.frame < f0 || n.frame >= f1) return;
      var m = { ch: n.ch, frame: n.frame - f0, frames: Math.min(n.frames, f1 - n.frame),
                midi: n.midi, inst: n.inst, vel: n.vel, pri: n.pri };
      if (n.sweep) m.sweep = n.sweep;
      if (n.trigger != null) m.trigger = n.trigger;
      notes.push(m);
    });
    return { notes: notes, bank: song.bank, totalFrames: f1 - f0, loopFrames: f1 - f0 };
  }
  function currentSong() {
    var song = liveScore || buildSong();
    return loopBar >= 0 ? sliceForBar(song, loopBar) : song;
  }
  function setLoopBar(b) {
    // live mode: while a bar loops, choosing ANOTHER bar queues it for the
    // loop point instead of jumping mid-phrase
    if (playing && loopBar >= 0 && b !== loopBar && b >= 0) {
      queuedBar = queuedBar === b ? null : b;
      hint(queuedBar != null ? 'Bar ' + (b + 1) + ' queued: it takes over at the loop point.' : 'Queue cleared.');
      renderBars();
      return;
    }
    loopBar = loopBar === b ? -1 : b;
    queuedBar = null; loopPhase = 0;
    if (loopBar >= 0) { viewBar = loopBar; hint('Looping bar ' + (loopBar + 1) + '. Tap another bar to queue it; tap ↺ again for the whole song.'); }
    else hint('Back to the whole song.');
    if (playing) startPlayback(0); else { pausedAt = 0; renderAll(); }
  }
  var repostTimer = 0, saveTimer = 0;
  // The editor owns the address bar while it is open: a refresh has to land
  // back here, with the song intact.
  function ownRoute(enc) {
    var want = '/create' + (enc ? '#s=' + enc : (location.hash || ''));
    if (location.pathname + location.hash === want) return;
    try { history.replaceState(null, '', want); } catch (e) {}
  }
  function dirty() {
    if (!root) return;
    if (!playing) { try { buildSong(); } catch (e) {} }   // refresh sulk + channel marks
    checkSulk();
    checkRoom();
    renderGrid(); renderBars(); renderEdit();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var enc = encode();
      ownRoute(enc);
      try { localStorage.setItem('ct-create-draft', enc); } catch (e) {}
    }, 400);
    if (playing) {
      clearTimeout(repostTimer);
      repostTimer = setTimeout(repostAtPosition, 160);
    }
  }
  function repostAtPosition() {
    if (!playing) return;
    owning = true; following = false;          // an edit is where the editor takes over
    var song = currentSong();
    var pos = song.loopFrames > 0
      ? Math.round(((performance.now() - playT0) / 1000) * FPS) % song.loopFrames : 0;
    if (typeof Audio !== 'undefined' && Audio.playCreate) Audio.playCreate(song, song.loopFrames, pos);
  }
  // TWO VIEWS OF ONE THING, NOT TWO PLAYERS.
  //
  // The station and the editor used to be separate players that swapped a chip
  // between them: opening the editor stopped the station, armed the chip with a
  // silent host song and started its own transport from the top; closing it
  // stopped that and restarted the station. Every silence anyone has reported
  // lived in that swap, and it also meant pressing Create dropped you at the
  // beginning of a song you were in the middle of.
  //
  // Since the merge the station is ALREADY playing this exact document, so
  // there is nothing to hand over: the editor opens FOLLOWING what is sounding
  // -- same song, same position, no gap and no restart -- and only takes the
  // chip when you actually change something. `owning` is that line. While it is
  // false the station is the player and this is a view of it.
  var owning = false, following = false;
  function stationPos() {
    try {
      if (typeof Audio === 'undefined' || !Audio.deckPosition) return null;
      var d = Audio.deckPosition();
      return (d && isFinite(d.sec) && d.sec >= -1) ? d : null;
    } catch (e) { return null; }
  }
  function stationPlaying() {
    try { return !!(Audio.started && !(Audio.isPaused && Audio.isPaused())); } catch (e) { return false; }
  }
  // Follow only when the chip is genuinely playing THIS song: same document,
  // and no manual tempo override, or the two clocks would drift apart.
  function canFollow(code) {
    var why = null, live = '';
    try { live = (Audio.currentDoc && Audio.currentDoc()) || ''; } catch (e) { why = 'currentDoc threw'; }
    if (!code) why = why || 'no code passed';
    else if (!live) why = why || 'station has no document';
    else if (live !== code) why = why || ('document differs (' + live.length + ' vs ' + code.length + ')');
    try { if (!why && Audio.tempoPinned && Audio.tempoPinned()) why = 'tempo pinned'; } catch (e) {}
    if (!why && !stationPos()) why = 'no deck position';
    if (!why && !stationPlaying()) why = 'station not playing';
    try { G.__followWhy = why || 'ok'; } catch (e) {}
    return !why;
  }
  function followStation() {
    var d = stationPos(); if (!d) return false;
    following = true; owning = false; gestured = true;
    playing = true;
    playT0 = performance.now() - Math.max(0, d.sec) * 1000;
    renderTransport(); renderBars(); scheduleTick();
    return true;
  }
  // A page that just loaded has no user gesture yet, so the browser keeps the
  // audio context suspended. Claiming to play then would be a lie: the
  // playhead would sweep in silence. Wait for the first touch instead.
  var gestured = false, wantStart = false;
  // If the station is already making noise then the browser's gesture gate was
  // cleared long ago -- by whatever click started the radio. This flag is
  // module-local and knew nothing about that, so opening the editor from a
  // playing station left it convinced nothing was allowed to sound: it armed
  // the chip (which stops the station) and then refused to start, and you got
  // an editor showing a song, with a play button, in silence.
  function audioLive() {
    try { return !!(Audio.started && Audio.running && Audio.running()); } catch (e) { return false; }
  }
  function armGesture() {
    if (armGesture.done) return;
    armGesture.done = true;
    var go = function () {
      // the first touch only unlocks the audio device. Nothing plays until you
      // ask: Play, the spacebar, or asking for a new song.
      gestured = true;
      wantStart = false;
      try { if (typeof Audio !== 'undefined' && Audio.resume) Audio.resume(true); } catch (e) {}
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      armGesture.done = false;
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }
  function startPlayback(fromMs) {
    clearTimeout(repostTimer);
    camFollow = true; camCatch = 0;
    if (!gestured && audioLive()) gestured = true;
    if (!gestured) {                       // nothing can sound yet: stay honest
      wantStart = true; pausedAt = Math.max(0, fromMs || 0);
      playing = false;
      armGesture();
      renderTransport(); renderBars();
      return;
    }
    var song = currentSong();
    var off = Math.max(0, fromMs || 0) % Math.max(1, songMs());
    if (!owning) { try { if (Audio.enterCreate) Audio.enterCreate(); } catch (e) {} }
    owning = true; following = false;
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate(song, song.loopFrames, Math.round(off / 1000 * FPS));
    // a fresh start ships with 60ms of scheduling lead before frame 0 sounds;
    // fold it into the clock or every repost seeks past the opening notes
    wantStart = false;
    playing = true; playT0 = performance.now() - off + (off > 0 ? 0 : 60);
    renderTransport(); renderBars(); scheduleTick();
  }
  function pausePlayback() {
    queuedBar = null;
    pausedAt = (performance.now() - playT0) % Math.max(1, songMs());
    // While following, this view does not own a transport to stop -- pausing
    // here is pausing the station, because they are the same playback.
    if (following) { try { if (Audio.setPlaying) Audio.setPlaying(false); } catch (e) {} }
    else armChip();
    playing = false;
    renderTransport(); renderBars(); updatePh(-1);
  }
  function togglePlay() {
    if (!root) return;
    if (playing) { pausePlayback(); return; }
    // ...and pressing play while still following resumes the station rather
    // than seizing the chip and starting a second copy of the same song.
    if (following && canFollowResume()) {
      try { if (Audio.setPlaying) Audio.setPlaying(true); } catch (e) {}
      if (followStation()) return;
    }
    startPlayback(pausedAt);
  }
  // the station is paused but still holds this song: resuming is a resume
  function canFollowResume() {
    try {
      var live = (Audio.currentDoc && Audio.currentDoc()) || '';
      return !!live && live === encode() && !!stationPos() &&
             !(Audio.tempoPinned && Audio.tempoPinned());
    } catch (e) { return false; }
  }
  // A silent host song keeps the chip's sequencer alive while the editor is
  // open, so placement pokes are audible before (and between) plays.
  function armChip() {
    resolveBank();
    owning = true; following = false;          // the silent host song IS taking the chip
    try { if (Audio.enterCreate) Audio.enterCreate(); } catch (e) {}
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate({ notes: [], bank: BANK, totalFrames: 0x7fffffff }, 0);
  }

  // Mood chips and written prompts share the public interpreter. A failed
  // request is reported before replacing the current document.
  var promptError = '';
  function promptFeedback(text) {
    var el = root && root.querySelector('.n-prompt-result');
    if (el) el.textContent = text || '';
  }

  // The dice and the mood box compose a REAL track: the same composer the
  // radio uses, constrained by the requested mood, and the whole
  // score projected onto the grid as exact, editable notes. It plays
  // verbatim (its own bank, every instrument) until the first hand edit.
  // Choosing a song and IMPORTING one are different jobs. Composition stays
  // with the editor; importScore fills whatever state is current, so the
  // radio can materialise a song without the editor being open at all.
  function composeIntoGrid(moodText, auto) {
    var made = moodSong(moodText);
    var st = made && decode(made.code);
    if (!st) { promptFeedback(promptError || 'Could not compose that request. Your song is unchanged.'); return false; }
    if (!auto) tourAdvance(3);
    if (auto) dropLiveScore(); else snapshot();
    resolveBank();
    S = st; order = S.cells.length;
    liveScore = made.gb;
    liveBpm = made.bpm;
    var bpmLabel = root && root.querySelector('.n-bpmval');
    var bpmSlider = root && root.querySelector('[data-cr="bpm"]');
    if (bpmLabel) bpmLabel.textContent = S.bpm;
    if (bpmSlider) bpmSlider.value = S.bpm;
    liveMood = String(moodText || '');
    try { buildSong(); } catch (e) {}          // resolve channel marks
    loopBar = -1; queuedBar = null;
    viewBar = 0; camX = 0; camFollow = true; camCatch = 0; selCol = -1; selCh = -1;
    if (root.querySelector('.n-track')) { buildTrack(); }
    pausedAt = 0;
    dirty();
    startPlayback(0);   // after dirty: its clearTimeout cancels the queued repost,
                        // which used to seek past the song's first notes
    promptFeedback(made.reading);
    return true;
  }
  // Fill the CURRENT state from a composed Score. Everything here reads S, so
  // withState() is how it is pointed at a scratch song instead of the editor's.
  function importScore(score, moodText) {
    lastComposed = score;
    var gb = score.gb;
    var sInst = (gb.bank && gb.bank.instruments) || gb.instruments || [];
    var sTables = (gb.bank && gb.bank.waveTables) || [];
    var per16f = FPS * 60 / ((score.bpm || 120) * 4);
    var winF = 64 * per16f;
    function pulseStamp(ch) {
      var counts = {};
      gb.notes.forEach(function (n) {
        if ((n.ch | 0) !== ch) return;
        var e = envClass(sInst[n.inst] || [0, 240]);
        counts[e] = (counts[e] || 0) + 1;
      });
      var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      return { pluck: 'piano', stab: 'trumpet', soft: 'flute', sus: 'flute', swell: 'flute' }[top] || (ch === 1 ? 'bell' : 'piano');
    }
    var stampFor = [pulseStamp(0), pulseStamp(1)];
    var waveStamp = 'bassg';
    for (var wi = 0; wi < gb.notes.length; wi++) {
      var wn = gb.notes[wi];
      if ((wn.ch | 0) !== 2) continue;
      var wt = sTables[(sInst[wn.inst] || [0])[0]] || null;
      if (wt) { var big = 0; for (var wj = 1; wj < wt.length; wj++) if (Math.abs(wt[wj] - wt[wj - 1]) >= 6) big++; if (!big) waveStamp = 'cello'; }
      break;
    }
    var keyRoot = (score.musical && score.musical.rootMidi) || 60;
    var scl = (score.musical && score.musical.scale) || MAJOR;
    function degOf(midi) {
      var rel = midi - keyRoot;
      var oct = Math.floor(rel / 12), pc = ((rel % 12) + 12) % 12;
      var bi = 0, bd = 99;
      for (var i = 0; i < scl.length; i++) {
        var d = Math.min(Math.abs(scl[i] - pc), 12 - Math.abs(scl[i] - pc));
        if (d < bd) { bd = d; bi = i; }
      }
      var deg = bi + (oct + 1) * 7;            // the score's root octave sits mid-grid
      while (deg > MEL_ROWS - 1) deg -= 7;
      while (deg < 0) deg += 7;
      return deg;
    }
    // NO BAR CAP. It used to clip at 48 and that was the largest single source
    // of loss when a composed song came in -- a hundred notes of a long song
    // simply gone. Playback has no reason to stop at a bar count; only the
    // cartridge does, and checkRoom() says so while there is time to act.
    S.key = ((keyRoot % 12) + 12) % 12; S.minor = scl.indexOf(3) >= 0 ? 1 : 0;
    S.bars = Math.max(1, Math.ceil((gb.totalFrames || winF) / (spb() * per16f)));
    // the EXACT tempo, not the nearest even one: rounding it moved every note
    // in the song, which is most of why an imported song stopped matching
    S.bpm = Math.max(70, Math.min(180, Math.round(score.bpm || 120)));
    S.cells = []; order = 0;
    var sorted = gb.notes.slice().sort(function (a, b) { return a.frame - b.frame || (b.pri || 0) - (a.pri || 0); });
    var LANE = { 9: 2, 7: 1, 3: 0 };           // kick / snare / hat, by note priority
    // A note lands on the frame the composer chose. The column is only where it
    // is DRAWN; the offset carries the rest, so nothing is quantised away.
    // Clashes are judged by whether two notes on a lane actually overlap IN
    // TIME -- the old rule counted notes per column, which threw away notes
    // that never collided on the hardware at all.
    importDrop = { past: 0, clash: 0, noPitch: 0 };
    var busy = [[], [], [], []];
    function freeAt(ch, from, to) {
      var l = busy[ch];
      for (var i = 0; i < l.length; i++) if (from < l[i][1] && to > l[i][0]) return false;
      return true;
    }
    sorted.forEach(function (n) {
      var ch = n.ch | 0;
      if (ch !== 3 && !(n.midi > 0)) { importDrop.noPitch++; return; }   // not a note
      var f0 = n.frame | 0;
      var c0 = Math.round(f0 / per16f);
      if (c0 < 0 || c0 >= cols()) { importDrop.past++; return; }
      var off = f0 - colFrame(c0);
      // the offset field is six bits; a step longer than that only happens at
      // very slow tempos, and then the column is close enough
      while (off > 31 && c0 + 1 < cols()) { c0++; off = f0 - colFrame(c0); }
      while (off < -32 && c0 > 0) { c0--; off = f0 - colFrame(c0); }
      off = Math.max(-32, Math.min(31, off));
      var f1 = f0 + Math.max(1, n.frames | 0);
      if (!freeAt(ch, f0, f1)) { importDrop.clash++; return; }   // on top of another note
      busy[ch].push([f0, f1]);
      var row = ch === 3 ? MEL_ROWS + (LANE[n.pri | 0] != null ? LANE[n.pri | 0] : 0)
                         : MEL_ROWS - 1 - degOf(n.midi | 0);
      var c = c0;
      var cell = { c: c, r: row, t: ++order, inst: n.inst, vel: n.vel != null ? n.vel : 0.8 };
      if (off) cell.of = off;
      if (ch !== 3) {
        cell.midi = n.midi | 0;
        var ln = Math.max(1, Math.round(n.frames / per16f));
        if (ln > 1) cell.len = ln;
        var exactLen = Math.max(1, n.frames | 0);
        if (exactLen !== Math.max(2, Math.round(per16f * (ln > 1 ? ln : 0.96)) - 1))
          cell.lf = Math.min(4095, exactLen);           // ...whenever the grid cannot say it
        if (ch === 2) cell.st = waveStamp;
        else {
          cell.ch = ch;
          cell.st = stampFor[ch] || 'piano';
          if (n.sweep) { cell.sweep = n.sweep; cell.z = 1; }
        }
      }
      S.cells.push(cell);
    });
  }

  // A Score becomes a Create document: the same import the editor does, run on
  // a scratch state, handed back as a playable song and a shareable code. This
  // is what makes the station's songs and the editor's songs the same thing.
  function withState(st, fn) {
    var prev = S, prevOrder = order;
    S = st; order = 0;
    try { return fn(); } finally { S = prev; order = prevOrder; }
  }
  // ...and the other direction: a document straight to a playable song, with no
  // editor involved. This is how the station plays a song somebody shared --
  // the link carries the document, and the document IS the song.
  function songOf(code) {
    resolveBank();
    var st = decode(String(code || ''));
    if (!st) return null;
    var out = null;
    withState(st, function () {
      try {
        out = { code: String(code), gb: buildSong(), bars: S.bars, bpm: S.bpm,
                title: S.title || '', cells: S.cells.length };
      } catch (e) { out = null; }
    });
    return (out && out.gb && out.gb.notes && out.gb.notes.length) ? out : null;
  }
  // The station, editor chips, and written briefs use the same interpretation
  // and resulting document. Optional token support makes this path reproducible
  // without opening an editor or minting a different song for each caller.
  function moodSong(moodText, opts) {
    resolveBank();
    promptError = '';
    try {
      var api = G.CT_API;
      if (!api || !api.ask) throw new Error('The song interpreter is unavailable in this build.');
      var r = api.ask(String(moodText || ''), { brief: opts || {} });
      if (!r.ok) { promptError = r.error; return null; }
      var made = songOf(r.doc);
      if (!made) throw new Error('That request produced no playable notes.');
      made.reading = 'Read as: ' + r.applied.join('; ');
      var gaps = (r.skipped || []).concat(r.notUnderstood || []);
      (r.unsupported || []).forEach(function (u) { gaps.push(u.asked + ': ' + u.why); });
      if (gaps.length) made.reading += '. Not applied: ' + gaps.join('; ');
      made.interpretation = r;
      return made;
    } catch (e) { promptError = String(e.message || e); return null; }
  }
  function songFrom(score, title) {
    resolveBank();
    var st = freshState(), out = null;
    withState(st, function () {
      try {
        importScore(score, '');
        S.title = String(title || '');
        out = { code: encode(), gb: buildSong(), bars: S.bars, bpm: S.bpm,
                cells: S.cells.length, title: S.title };
      } catch (e) { out = null; }
    });
    return out;
  }


  // ---- the sound map: pick a channel's instrument by dragging --------------
  var sndCh = -1;
  // What the NEXT note in each lane will use, in the chip's own terms
  var chDuty = [2, 1, 0, 0];              // Melody 50%, Harmony 25%
  var chFade = [2, 2, 0, 1];              // a gentle fade out
  var chWave = null;                      // Bass: which table
  var DRUM_SHIFT = [0, 2, 6];             // hat bright, snare mid, kick low
  function laneWave() {
    if (chWave != null) return chWave;
    resolveBank();
    var want = null;
    (SNDS && SNDS.wave || []).forEach(function (sd) { if (sd.n === 'Wood' && want == null) want = sd.inst; });
    if (want == null && SNDS && SNDS.wave && SNDS.wave.length) want = SNDS.wave[0].inst;
    return want == null ? 0 : (BANK.instruments[want][0] & 0xFF);
  }
  // The lane's own sound: what the NEXT note placed there will use. This used
  // to be a long-press on the lane name opening a scatter pad of unnamed dots
  // -- nobody found it, and nobody could read it when they did.
  function openSnd(ch) {
    closeSnd(); closePick();
    selCol = -1; selCh = -1; pen.ch = ch;
    var el = document.createElement('div');
    el.className = 'n-pick n-sndpop';
    el.innerHTML = '<div class="n-pickhead"><span>' + CH[ch].n + ' sound</span>' +
      '<button type="button" class="n-pclose" data-sndclose="1" title="Close">\u00d7</button></div>' +
      '<div class="n-pickrow n-pisnd" style="--vc:' + CH[ch].color + '">' + soundPanel(ch, null) + '</div>' +
      '<span class="n-pickfoot">the next note you place here</span>';
    root.appendChild(el);
    sndCh = ch;
    var ln = root.querySelector('.n-lane[data-ch="' + ch + '"]');
    var r = ln.getBoundingClientRect(), bx = el.getBoundingClientRect();
    el.style.left = Math.round(r.right + 8) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - bx.height - 8,
                                                   r.top + r.height / 2 - bx.height / 2))) + 'px';
    renderChans();
  }
  function closeSnd() {
    var e = root && root.querySelector('.n-sndpop');
    if (e) e.remove();
    sndCh = -1;
  }

  // ---- the songs shelf: this browser's saved songs -------------------------
  // ---- exports -------------------------------------------------------------
  function exportRom() {
    var song = liveScore || buildSong();
    try {
      var rom = G.CT_GB_ROM.buildRom({ gb: song }, { title: 'MY CREATION' });
      _saveBlob(new Blob([rom], { type: 'application/octet-stream' }), 'my-creation.gb');
      if (G._toast) G._toast('Downloaded my-creation.gb. It boots on a real Game Boy 🎮');
    } catch (e) { if (G._toast) G._toast('ROM export failed: ' + (e && e.message || e)); }
  }
  function exportWav() {
    var song = liveScore || buildSong(), sr = 44100;
    try {
      var pcm = G.CT_GB_APU.render(song, sr);
      _saveBlob(_pcmToWav(pcm, sr), 'my-creation.wav');
      if (G._toast) G._toast('Downloaded my-creation.wav');
    } catch (e) { if (G._toast) G._toast('WAV export failed: ' + (e && e.message || e)); }
  }

  // MIDI OUT. The export that leaves the Game Boy behind: format 1, a track per
  // hardware voice so the file carries the stems, drums on channel 10. The
  // encoder lives in src/api.js because the CLI and the MCP server need the
  // same one; it is reachable here as CT_API.
  function exportMidi() {
    try {
      if (!G.CT_API || !G.CT_API.toMidi) { if (G._toast) G._toast('MIDI export is unavailable in this build'); return; }
      var bytes = G.CT_API.toMidi(encode());
      var arr = (typeof bytes.length === 'number' && !(bytes instanceof Uint8Array)) ? new Uint8Array(bytes) : bytes;
      _saveBlob(new Blob([arr], { type: 'audio/midi' }), 'my-creation.mid');
      if (G._toast) G._toast('Downloaded my-creation.mid');
    } catch (e) { if (G._toast) G._toast('MIDI export failed: ' + (e && e.message || e)); }
  }

  // AN ARRANGEMENT TO KEEP WRITING, not a finished file to admire. What lands
  // in LSDj is the notes, the phrases, the chains, the tempo and the groove; the
  // voicing is deliberately left stock, because that is the part the musician
  // receiving it is better at than we are. The toast says what did not survive
  // rather than leaving it to be found by ear.
  function exportLsdsng() {
    try {
      if (!G.CT_API || !G.CT_API.toLsdsng) { if (G._toast) G._toast('LSDj export is unavailable in this build'); return; }
      var r = G.CT_API.toLsdsng(encode(), { name: (S.title || 'CHIPTUNE') });
      _saveBlob(new Blob([r.bytes], { type: 'application/octet-stream' }), r.filename);
      if (G._toast) G._toast('Downloaded ' + r.filename + ' \u2014 ' + r.phrases +
        ' phrases, tempo ' + r.tempo + '. Drums move to noise; instruments are stock.', { ms: 4200 });
    } catch (e) { if (G._toast) G._toast('LSDj export failed: ' + (e && e.message || e)); }
  }

  // ---- hints + tour --------------------------------------------------------
  var hintTimer = 0, hintedSulk = false;
  var HINT_IDLE = 'Click empty space in a lane to place a note at that height; hover or click a note to hear it.';
  // Only the hints that carry consequence reach the screen -- the rest would be
  // chatter. A cartridge that will not fit and notes that lost their own step
  // both count: they are things the editor did that you cannot otherwise see.
  function hint(t) {
    if (t && G._toast && /(muted|limit|Nothing|cartridge|share a step)/.test(t)) G._toast(t);
  }
  // 32KB is the cartridge, and a song can outgrow it -- long ones, or many
  // notes carrying movement, or several sampled drums. Say so while there is
  // still something to do about it.
  function checkRoom() {
    if (!romBytes) return;
    if (romBytes > 30000 && !romWarned) {
      romWarned = true;
      hint('This song is nearly too big for a cartridge \u2014 Download ROM may not fit. WAV and links have no limit.');
    } else if (romBytes < 26000) romWarned = false;
  }
  function checkSulk() {
    if (hintedSulk || !S) return;
    for (var i = 0; i < S.cells.length; i++) if (S.cells[i].x) {
      hintedSulk = true;
      hint('The Game Boy can only play four sounds at once. Faded notes are waiting for a free voice.');
      return;
    }
  }
  var tourStep = -1;
  function tourDone() {
    tourStep = -1;
    try { localStorage.setItem('ct-create-tour', '2'); } catch (e) {}
    var t = root && root.querySelector('.cr-tour'); if (t) t.remove();
  }
  function tourShow(step) {
    if (!root) return;
    tourStep = step;
    var t = root.querySelector('.cr-tour');
    if (!t) { t = document.createElement('div'); t.className = 'cr-tour'; root.appendChild(t); }
    var msgs = [
      ['This song was just written for you.',
       'Notes are blocks on their lane: further right is later, higher is a higher note, wider is longer. Hover one to hear it, click it to open its sound, drag it anywhere.'],
      ['Four voices, like a tiny band.',
       'Melody, Harmony, Bass and Drums each keep a lane. Under each name is the sound it is holding \u2014 click that to change what the next note there will use, or the speaker to mute the lane.'],
      ['The song runs left to right.',
       'Drag the lanes to travel through it, or press Follow to ride along with the music. Above the bar you are on: its number, + insert, and \u00d7 to delete it.'],
      ['Moods write songs.',
       'Tap a mood up top and the radio\u2019s composer writes a whole song here, yours to edit.'],
    ];
    t.innerHTML = '<b>' + msgs[step][0] + '</b><span>' + msgs[step][1] + '</span>' +
      '<div class="cr-tourbtns"><button type="button" data-tour="skip">Skip</button>' +
      '<button type="button" data-tour="next">' + (step === 3 ? 'Done' : 'Next') + '</button></div>' +
      '<i>' + (step + 1) + ' / 4</i>';
    // Point at the thing being described. These used to name .n-grid, .n-chans
    // and .n-bars -- all removed in the lane rewrite -- so three of four cards
    // fell back to the whole editor and floated in the middle of nothing.
    var anchor = [root.querySelector('.n-scroll'),    // the lanes themselves
                  root.querySelector('.n-side'),      // their names and sounds
                  // the CURRENT bar's label, not the whole ruler: the ruler is
                  // as wide as the song, so its centre is somewhere off screen
                  root.querySelector('.n-rbar.on') || root.querySelector('.n-ruler'),
                  root.querySelector('.n-moodrow')][step] || root;
    var ar = anchor.getBoundingClientRect();
    var tw = t.getBoundingClientRect().width || 250, th = t.getBoundingClientRect().height || 150;
    var cx = ar.left + ar.width / 2;
    if (step === 1) cx = ar.right + tw / 2 + 14;      // beside the lane names, not over them
    t.style.transform = 'none';
    t.style.left = Math.round(Math.max(10, Math.min(window.innerWidth - tw - 10, cx - tw / 2))) + 'px';
    var top = step === 0 ? ar.top + ar.height * 0.28
            : step === 1 ? ar.top + 20
            : ar.bottom + 14;
    if (top + th > window.innerHeight - 10) top = ar.top - th - 14;
    t.style.top = Math.round(Math.max(10, top)) + 'px';
  }
  function tourAdvance(from) {
    if (tourStep !== from) return;
    if (from >= 3) tourDone(); else tourShow(from + 1);
  }

  // hear a cell exactly as buildSong will play it
  var fxTimers = [];
  function clearFxPreview() { fxTimers.forEach(clearTimeout); fxTimers = []; }
  // a motion is a SEQUENCE, so the preview has to be one too -- a single poke
  // would make Arp, Roll and Echo all sound like a plain note
  function previewMotion(cell, ch, per) {
    var k = motionOf(cell), ms = 1000 / FPS;
    if (!k || k === 'z' || k === 'u') return false;
    var midi = cell.midi != null ? cell.midi : rowMidi(cell.r);
    var inst = cell.inst != null ? cell.inst
             : cell.r >= MEL_ROWS ? INSTOF[DRUMS[cell.r - MEL_ROWS].id] : INSTOF[cell.st];
    var vel = Math.max(HEARD_VEL, cell.vel != null ? cell.vel : (cell.r >= MEL_ROWS ? DRUMS[cell.r - MEL_ROWS].vel : 0.8));
    var drum = cell.r >= MEL_ROWS;
    var steps = Math.max(1, cell.len || 1), hits = [], i;
    if (k === 'q') {                          // the chord, strummed
      var iv = S.minor ? [0, 3, 7] : [0, 4, 7];
      var sub = Math.max(2, Math.round(per / 3));
      for (i = 0; i < 3; i++) hits.push({ at: i * sub, f: sub, midi: midi + iv[i], vel: vel });
    } else if (k === 'g') {                   // the same note, ratcheted
      var hitF = Math.max(2, Math.round(per / 2));
      for (i = 0; i < Math.min(6, Math.max(2, Math.round(steps * 2))); i++)
        hits.push({ at: i * hitF, f: Math.max(2, hitF - 1), midi: midi, vel: vel });
    } else {                                  // echo: repeat and fade
      var v = vel;
      for (i = 0; i < 4; i++, v *= 0.6) hits.push({ at: i * per, f: Math.round(per * 0.9), midi: midi, vel: v });
    }
    clearFxPreview();
    hits.forEach(function (h) {
      fxTimers.push(setTimeout(function () {
        Audio.pokeCreate({ ch: drum ? 3 : (cellVoice(cell) === 'wave' ? 2 : 1),
                           frames: h.f, midi: drum ? null : h.midi, inst: inst,
                           rec: recOf(cell, drum ? 3 : (cellVoice(cell) === 'wave' ? 2 : 1)), vel: h.vel });
      }, Math.round(h.at * ms)));
    });
    return true;
  }
  function recOf(cell, ch) {
    return hasSound(cell) ? recordFor(paramsOf(cell, ch), ch) : null;
  }
  // AN AUDITION IS MEANT TO BE HEARD. It used to play at the note's own
  // velocity for the note's own length -- a composed note at vel 0.2 lasting a
  // sixteenth is a blip you can miss entirely, which is exactly what hovering
  // and clicking felt like. Previews get a floor on both.
  var HEARD_VEL = 0.75, HEARD_FRAMES = 17;      // about 0.28s
  function auditionCell(cell, maxFrames) {
    resolveBank();
    if (typeof Audio === 'undefined' || !Audio.pokeCreate) return 1;
    var per = framesPer16();
    // a drag auditions many times a second: no sequences there
    if (maxFrames == null && previewMotion(cell, null, per))
      return cell.r >= MEL_ROWS ? 3 : (cellVoice(cell) === 'wave' ? 2 : 1);
    if (cell.r >= MEL_ROWS && cell.kt) {     // a sample auditions through the chip too
      if (Audio.pokeKit) Audio.pokeKit((cell.kt - 1) & 7);
      return 2;
    }
    if (cell.r >= MEL_ROWS) {
      var d = DRUMS[cell.r - MEL_ROWS];
      Audio.pokeCreate({ ch: 3, frames: Math.max(HEARD_FRAMES, Math.round(per)), midi: null,
                         inst: cell.inst != null ? cell.inst : INSTOF[d.id],
                         rec: recOf(cell, 3),
                         vel: Math.max(HEARD_VEL, cell.vel != null ? cell.vel : d.vel) });
      return 3;
    }
    var voice = cellVoice(cell) || 'pulse';
    var heldSteps = Math.max(1, cell.len || 1);            // hear it for as long as it lasts,
    var frames = Math.max(HEARD_FRAMES,                    // but never for less than a listen
                          Math.min(maxFrames || 600, Math.round(per * heldSteps)));
    Audio.pokeCreate({ ch: voice === 'wave' ? 2 : 1, frames: frames, det: cell.dt | 0,
                       midi: cell.midi != null ? cell.midi : rowMidi(cell.r),
                       inst: cell.inst != null ? cell.inst : INSTOF[cell.st],
                       rec: recOf(cell, voice === 'wave' ? 2 : (cell.ch === 1 ? 1 : 0)),
                       vel: Math.max(HEARD_VEL, cell.vel != null ? cell.vel : 0.8),
                       sweep: cell.sweep != null ? cell.sweep : (voice !== 'wave' && cell.z) ? 0x3E : (voice !== 'wave' && cell.u) ? 0x36 : 0 });
    return voice === 'wave' ? 2 : 1;
  }
  function stopAudition(ch) {
    if (typeof Audio !== 'undefined' && Audio.stopPoke) Audio.stopPoke(ch == null ? null : ch);
  }

  // ---- the view: one bar of one channel ------------------------------------
  var CH = [
    { n: 'Melody',  color: '#7BDCA0', stamp: 'piano', tip: 'Melody: the Game Boy\u2019s first pulse voice. Hold the button to choose its sound.' },
    { n: 'Harmony', color: '#57C4FF', stamp: 'bell',  tip: 'Harmony: the second pulse voice, for counter-lines and chords. Hold to choose its sound.' },
    { n: 'Bass',    color: '#E8A75D', stamp: 'bassg', tip: 'Bass: the wave voice, deep and warm. Hold to choose its sound.' },
    { n: 'Drums',   color: '#C9A4E8', stamp: null,    tip: 'Drums: the noise voice. Drag a note up for hat, middle for snare, down for kick.' }
  ];
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // a proper little speaker, on and off
  function speakerSvg(on) {
    return '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
      '<path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" fill="currentColor"/>' +
      (on ? '<path d="M15.2 9.1a4 4 0 0 1 0 5.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
            '<path d="M17.6 6.6a7.4 7.4 0 0 1 0 10.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
          : '<path d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>') +
      '</svg>';
  }
  function noteName(midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }
  var DRUM_NAMES = ['Hat', 'Snare', 'Kick'];
  // a tiny picture of the channel's current sound: the pulse's duty as a
  // square trace, the wave's actual table, sticks for the drums
  var chanIconCache = {};
  var viewCh = -1, viewBar = 0, lastDeg = [7, 9, 3, 2];
  var selCol = -1, selCh = -1;                 // the note being edited
  // The pen: the settings the next note gets. The panel below the track
  // always shows either the selected note or this.
  var pen = { ch: 0, midi: 60, drum: 2, vel: 0.8, len: 1 };
  function chOfCell(x) {
    if (x.r >= MEL_ROWS) return 3;
    var v = cellVoice(x);
    if (v === 'wave') return 2;
    if (x.ch === 0 || x.ch === 1) return x.ch;
    if (x.rch === 0 || x.rch === 1) return x.rch;
    return 0;
  }
  function cellIndexAt(ch, col) {
    for (var i = 0; i < S.cells.length; i++) {
      var x = S.cells[i];
      if (x.c === col && chOfCell(x) === ch) return i;
    }
    return -1;
  }
  function cellAtExcept(c, r, self) {
    for (var i = 0; i < S.cells.length; i++) {
      var x = S.cells[i];
      if (x !== self && x.c === c && x.r === r) return i;
    }
    return -1;
  }
  function tailIndexAt(ch, col) {
    for (var i = 0; i < S.cells.length; i++) {
      var x = S.cells[i];
      if (x.c < col && col < x.c + (x.len || 1) && chOfCell(x) === ch) return i;
    }
    return -1;
  }
  function degOfCell(x) {
    return x.r >= MEL_ROWS ? 2 - (x.r - MEL_ROWS) : (MEL_ROWS - 1) - x.r;
  }
  function applyDeg(x, deg) {
    if (x.r >= MEL_ROWS) {
      x.r = MEL_ROWS + (2 - deg);
      delete x.inst;                           // a moved drum adopts its lane's sound
    } else {
      x.r = MEL_ROWS - 1 - deg;
      delete x.midi;                           // hand pitches stay in key
    }
  }

  // ---- render --------------------------------------------------------------
  var lastPh = -1, lastPlayBar = -1, delArm = -1, delTimer = 0;
  var camX = 0, camFollow = true, camCatch = 0;
  function renderTransport() {
    var b = root.querySelector('[data-cr="play"]');
    if (b) {
      b.innerHTML = _pb(playing ? 'pause' : 'play');
      b.setAttribute('aria-label', playing ? 'Pause song' : 'Play song');
      b.setAttribute('aria-pressed', String(playing));
      b.classList.toggle('waiting', !playing && wantStart);
    }
  }
  // the four lanes name themselves down the left edge and carry their mute
  function renderChans() {
    renderFollow();
    root.querySelectorAll('.n-gbtn').forEach(function (b2) {
      b2.classList.toggle('on', +b2.dataset.cr.slice(4) === spb());
    });
    root.querySelectorAll('.n-lane').forEach(function (el) {
      var i = +el.dataset.ch;
      el.classList.toggle('muted', !!chMuted[i]);
      el.classList.toggle('pen', pen.ch === i);
      el.style.setProperty('--vc', CH[i].color);
      var spk = el.querySelector('.n-spk');
      if (spk) spk.innerHTML = speakerSvg(!chMuted[i]);
      var sn = el.querySelector('.n-lsnd');
      if (sn) sn.textContent = soundName(i);
    });
  }
  // the ruler: one number per bar, and the tools for the bar you are on
  function renderBars() {
    var ruler = root.querySelector('.n-ruler');
    if (ruler && ruler.childElementCount !== S.bars) {
      var html = '';
      for (var b2 = 0; b2 < S.bars; b2++)
        html += '<span class="n-rbar" data-bar="' + b2 + '" style="left:' + (b2 * spb() * stepW) + 'px;width:' + (spb() * stepW) + 'px">' +
                '<b>#' + (b2 + 1) + '</b>' +
                '<button type="button" class="n-rins" data-insbar="' + b2 + '" title="Insert an empty bar here">+ insert</button>' +
                '<button type="button" class="n-rdel" data-delbar="' + b2 + '" title="Delete this bar">\u00d7</button>' +
                '</span>';
      ruler.innerHTML = html;
    }
    if (ruler) ruler.querySelectorAll('.n-rbar').forEach(function (el) {
      var bi = +el.dataset.bar;
      el.classList.toggle('on', bi === viewBar);
      var del = el.querySelector('.n-rdel');
      if (del) {
        var armed = delArm === bi;
        del.textContent = armed ? '\u00d7 sure?' : '\u00d7';
        del.classList.toggle('arm', armed);
      }
    });
    var hl = root.querySelector('.n-barhl');
    if (hl) {
      hl.style.left = (viewBar * spb() * stepW) + 'px';
      hl.style.width = (spb() * stepW) + 'px';
    }
    applyCam();
  }
  // WHAT IS ON SCREEN. A song is up to 48 bars -- 26,000 pixels of track --
  // and the pane shows about 1,200 of them, so drawing every note built a
  // thousand elements to show forty. Everything downstream (layout, paint, and
  // every re-render an edit causes) paid for that, which is what made a click
  // cost 56ms in Safari.
  var visFrom = 0, visTo = 0;
  function visRange() {
    var pad = 24;                           // a bar or so of margin either side
    var w = viewW() || 1200;
    return [Math.max(0, Math.floor((camX - sidePad) / stepW) - pad),
            Math.min(cols(), Math.ceil((camX + w - sidePad) / stepW) + pad)];
  }
  // notes are drawn as blocks on their lane: as wide as they are long
  function renderGrid() {
    if (!root) return;
    var vis = visRange();
    visFrom = vis[0]; visTo = vis[1];
    var em = effMask();
    for (var ch = 0; ch < 4; ch++) {
      var row = root.querySelector('.n-row[data-ch="' + ch + '"]');
      if (!row) continue;
      row.classList.toggle('off', !!em[ch]);
      var html = '';
      S.cells.forEach(function (x) {
        if (chOfCell(x) !== ch) return;
        var len = Math.max(1, x.len || 1);
        if (x.c + len < visFrom || x.c > visTo) return;      // off screen: not drawn
        var vel = x.vel != null ? x.vel : 0.8;
        var label = vel === 0 ? '–'
          : (x.r >= MEL_ROWS ? DRUM_NAMES[x.r - MEL_ROWS] : noteName(x.midi != null ? x.midi : rowMidi(x.r)));
        // height in the lane IS pitch, read from the note itself (C2..C7) so
        // nothing flattens against the top of the old fifteen-row grid
        var deg;
        if (x.r >= MEL_ROWS) deg = (2 - (x.r - MEL_ROWS)) / 2;
        else {
          var mp = x.midi != null ? x.midi : rowMidi(x.r);
          deg = Math.max(0, Math.min(1, (mp - 36) / 60));
        }
        var mn = motionName(x);
        // a note that sits off the grid is DRAWN off the grid
        var offPx = x.of ? (x.of / framesPer16()) * stepW : 0;
        html += '<i class="n-note' + (x.x ? ' sulk' : '') + (vel === 0 ? ' rest' : '') +
                (mn ? ' fx' : '') + (selCol === x.c && selCh === ch ? ' sel' : '') + '"' +
                ' data-col="' + x.c + '" data-ch="' + ch + '" data-inst="' + (x.inst != null ? x.inst : -1) + '"' +
                (mn ? ' data-fx="' + mn + '"' : '') +
                ' style="left:' + (x.c * stepW + 1 + offPx) + 'px;width:' + (len * stepW - 2) + 'px;' +
                'bottom:' + Math.round(6 + deg * (laneH - 30)) + 'px;' +
                'opacity:' + (vel === 0 ? 0.35 : 0.5 + vel * 0.5) + '">' +
                '<b>' + label + (mn && len * stepW > 74 ? ' <em>' + mn + '</em>' : '') + '</b><u class="rz"></u></i>';
      });
      row.innerHTML = html;
    }
  }
  function selCell() {
    if (selCol < 0 || selCh < 0) return null;
    var i = cellIndexAt(selCh, selCol);
    return i >= 0 ? S.cells[i] : null;
  }
  // Pitch edits work in real semitones on the note's own midi, so the grid's
  // two-octave display never traps a note; the row is only where we draw it.
  function rowForMidi(m) {
    var best = 0, bd = 999;
    for (var r = 0; r < MEL_ROWS; r++) {
      var d = Math.abs(rowMidi(r) - m);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function movePitch(x, delta) {
    var m = x.midi != null ? x.midi : rowMidi(x.r);
    m = Math.max(24, Math.min(96, m + delta));
    x.midi = m;
    x.r = rowForMidi(m);
  }
  // a level anyone can read at a glance
  function meterBlocks(n, over) {
    var out = '';
    for (var i = 0; i < 8; i++) out += '<i class="' + (i < n ? 'f' : '') + '"></i>';
    return out + (over ? '<u>' + over + '</u>' : '');
  }
  // The note picker opens ON the square you touched: the instruments as
  // coloured buttons, the pitches as a row of note names you can simply read,
  // and the loudness and length as levels. No hidden mode, nothing to learn.
  var pickCol = -1, pickCh = -1, pickOpenedAt = 0;
  // what a lane offers, and what a note is using
  // What a note's sound actually IS. A hand-set note says so; a composed note
  // says it through the bank record it points at, and the panel has to show
  // the same thing either way.
  function paramsOf(x, ch) {
    resolveBank();
    var rec = x && x.inst != null ? BANK.instruments[x.inst] : null;
    var p = {};
    if (ch === 2) {
      p.wv = x && x.wv != null ? x.wv : rec && (rec[3] & 1) ? (rec[0] & 0xFF) : laneWave();
      return p;
    }
    if (ch === 3) {
      var band = x && x.r >= MEL_ROWS ? x.r - MEL_ROWS : pen.drum;
      p.nz = x && x.nz != null ? x.nz : rec ? (rec[0] >> 4) & 15 : DRUM_SHIFT[band];
      p.ns = x && x.ns != null ? x.ns : rec ? (rec[0] >> 3) & 1 : 0;
      p.fd = x && x.fd != null ? x.fd : rec ? envNibble(rec[1]) : 1;
      return p;
    }
    p.dy = x && x.dy != null ? x.dy : rec ? (rec[0] >> 6) & 3 : chDuty[ch];
    p.fd = x && x.fd != null ? x.fd : rec ? envNibble(rec[1]) : chFade[ch];
    return p;
  }
  function envNibble(nrx2) {
    var dir = (nrx2 >> 3) & 1, pace = nrx2 & 7;
    if (!pace) return 0;
    return dir ? 8 + pace : pace;
  }
  // ...and the four bytes those settings mean. Velocity scales byte 1 later,
  // exactly as it does for a composed note, so full volume lives here.
  function recordFor(p, ch) {
    var fd = p.fd || 0;
    var nrx2 = (15 << 4) | ((fd >= 8 ? 1 : 0) << 3) | ((fd >= 8 ? fd - 8 : fd) & 7);
    if (ch === 2) return [(p.wv | 0) & 0xFF, (15 << 4), 0xFF, 1];
    if (ch === 3) return [(((p.nz | 0) & 15) << 4) | (((p.ns | 0) & 1) << 3) | 0, nrx2, 0xFF, 0];
    return [((p.dy | 0) & 3) << 6, nrx2, 0xFF, 0];
  }
  // The bank a song is played through: the shared one, plus a record for every
  // hand-set sound in it. The cartridge stores register bytes per note, not an
  // instrument table, so materialising here costs the ROM nothing.
  var songBank = null, romBytes = 0, romWarned = false, lastComposed = null;
  var importDrop = { past: 0, clash: 0, noPitch: 0 };
  function freshSongBank() {
    resolveBank();
    songBank = { instruments: BANK.instruments.slice(), waveTables: BANK.waveTables,
                 arpTables: BANK.arpTables, meta: BANK.meta, _by: {} };
    return songBank;
  }
  function instOf(x, ch) {
    if (!hasSound(x)) return null;            // nothing hand-set: keep the note's own
    var rec = recordFor(paramsOf(x, ch), ch);
    var key = rec.join(',');
    var b = songBank || freshSongBank();
    if (b._by[key] != null) return b._by[key];
    for (var i = 0; i < b.instruments.length; i++) {
      var r = b.instruments[i];
      if (r && r[0] === rec[0] && r[1] === rec[1] && r[3] === rec[3]) { b._by[key] = i; return i; }
    }
    b.instruments.push(rec);
    b._by[key] = b.instruments.length - 1;
    return b._by[key];
  }
  function hasMoves(x) { return !!x && (x.vb || x.sq || x.mp || x.pn || x.gl); }
  function hasSound(x) {
    return !!x && (x.dy != null || x.fd != null || x.wv != null || x.nz != null || x.ns != null);
  }
  function soundName(ch) {
    if (ch === 3) return 'Kit';
    if (ch === 2) return waveName(laneWave());
    return DUTY_PC[chDuty[ch]] + ' \u00b7 ' + fadeLabel(chFade[ch]);
  }
  function motionsFor(ch) { return MOTIONS.filter(function (m) { return m.ch[ch]; }); }
  function motionOf(x) {
    for (var i = 0; i < MOTION_KEYS.length; i++) if (x && x[MOTION_KEYS[i]]) return MOTION_KEYS[i];
    return '';
  }
  function motionName(x) {
    var k = motionOf(x), hit = '';
    MOTIONS.forEach(function (m) { if (m.k === k) hit = m.n; });
    return k ? hit : '';
  }
  // the automation lane, as four plain switches. They combine with each other
  // and with a motion: a note can wobble AND arpeggiate.
  var MOVES = [
    { n: 'Wobble', k: 'vb', ch: [1, 1, 1, 0] },   // its own vibrato
    { n: 'Sweep',  k: 'sq', ch: [1, 1, 0, 0] },   // the duty walks
    { n: 'Morph',  k: 'mp', ch: [0, 0, 1, 0] },   // the wave table changes
    { n: 'Glide',  k: 'gl', ch: [1, 1, 1, 0] },   // slides from the note before it
    { n: 'Pan L',  k: 'pn', v: 1, ch: [1, 1, 1, 1] },
    { n: 'Pan R',  k: 'pn', v: 2, ch: [1, 1, 1, 1] }
  ];
  function moveBtns(ch, x) {
    return MOVES.filter(function (m) { return m.ch[ch]; }).map(function (m) {
      var on = m.v != null ? (x && x[m.k] === m.v) : !!(x && x[m.k]);
      return '<button type="button" class="n-pv' + (on ? ' on' : '') +
             '" data-ed="mv' + m.k + (m.v || '') + '" data-full="' + m.n + '">' + m.n + '</button>';
    }).join('');
  }
  function motionBtns(ch, x) {
    var cur = motionOf(x);
    return motionsFor(ch).map(function (m) {
      return '<button type="button" class="n-pv' + (m.k === cur ? ' on' : '') +
             '" data-ed="fx' + (m.k || '-') + '">' + m.n + '</button>';
    }).join('');
  }
  function waveName(slot) {
    resolveBank();
    return SLOTNAME[slot] || ('Wave ' + slot);
  }
  function row(label, inner) {
    return '<div class="n-prow"><i>' + label + '</i><span>' + inner + '</span></div>';
  }
  function step(minus, val, plus) {
    return '<button type="button" class="n-po" data-ed="' + minus + '">\u2212</button>' +
           '<b class="n-pval">' + val + '</b>' +
           '<button type="button" class="n-po" data-ed="' + plus + '">+</button>';
  }
  // The whole of a note's sound, in the chip's own terms.
  function soundPanel(ch, x) {
    var p = paramsOf(x, ch), out = '';
    if (ch === 2) {
      var slots = (SNDS.wave || []).map(function (sd) {
        return { slot: BANK.instruments[sd.inst][0] & 0xFF, n: sd.n };
      });
      // a note can hold a table this list does not name (a composed song, or a
      // link from a build with different names): show it rather than marking
      // nothing at all
      var known = slots.some(function (w) { return w.slot === p.wv; });
      if (!known && p.wv != null) slots.unshift({ slot: p.wv, n: waveName(p.wv) });
      out += row('Wave', slots.map(function (w) {
        return '<button type="button" class="n-pv' + (w.slot === p.wv ? ' on' : '') +
               '" data-ed="wv' + w.slot + '" data-full="' + w.n + '">' + w.n + '</button>';
      }).join(''));
      return out;
    }
    if (ch === 3) {
      var kits = (G.CT_GB_KITS && G.CT_GB_KITS.kits()) || [];
      out += row('Kit', '<button type="button" class="n-pv' + (!(x && x.kt) ? ' on' : '') +
                        '" data-ed="kt0" data-full="Chip">Chip</button>' +
        kits.map(function (kk) {
          return '<button type="button" class="n-pv' + (x && x.kt === kk.id + 1 ? ' on' : '') +
                 '" data-ed="kt' + (kk.id + 1) + '" data-full="' + kk.name + '">' + kk.name + '</button>';
        }).join('') + '<em class="n-phint">a sample borrows the Bass voice while it plays</em>');
      if (x && x.kt) return out;              // a sample has no noise settings
      var don = presetOn(PRESETS.noise, p);
      out += row('Sounds', PRESETS.noise.map(function (ps, i) {
        return '<button type="button" class="n-pv' + (i === don ? ' on' : '') +
               '" data-ed="ps3.' + i + '" data-full="' + ps.n + '">' + ps.n + '</button>';
      }).join(''));
      out += row('Noise', ['Free', 'Metal'].map(function (n2, i) {
        return '<button type="button" class="n-pv' + (i === (p.ns | 0) ? ' on' : '') +
               '" data-ed="ns' + i + '" data-full="' + n2 + '">' + n2 + '</button>';
      }).join(''));
      // the chip counts DOWN in pitch (a bigger shift is a lower sound); the
      // control counts up, because nobody thinks in clock shifts
      out += row('Pitch', step('nz-', 'pitch ' + (13 - p.nz), 'nz+'));
      out += row('Fade', step('fd-', fadeLabel(p.fd), 'fd+') +
                         '<em class="n-phint">out 1 is quickest \u00b7 in swells</em>');
      return out;
    }
    var pon = presetOn(PRESETS.pulse, p);
    out += row('Sounds', PRESETS.pulse.map(function (ps, i) {
      return '<button type="button" class="n-pv' + (i === pon ? ' on' : '') +
             '" data-ed="ps' + ch + '.' + i + '" data-full="' + ps.n + '">' + ps.n + '</button>';
    }).join(''));
    out += row('Shape', DUTY_PC.map(function (d, i) {
      return '<button type="button" class="n-pv' + (i === (p.dy | 0) ? ' on' : '') +
             '" data-ed="dy' + i + '" data-full="' + d + '">' + d + '</button>';
    }).join(''));
    out += row('Fade', step('fd-', fadeLabel(p.fd), 'fd+') +
                       '<em class="n-phint">out 1 is quickest \u00b7 in swells</em>');
    out += row('Detune', step('dt-', detLabel(x), 'dt+') +
                         '<em class="n-phint">off the note, for beating and unison</em>');
    return out;
  }
  function detLabel(x) {
    var d = (x && x.dt) | 0;
    return d === 0 ? 'in tune' : (d > 0 ? '+' : '') + d;
  }
  function closePick() {
    var el = root && root.querySelector('.n-pick');
    if (el) el.remove();
    pickCol = -1; pickCh = -1;
  }
  function openPick(col, ch) {
    closePick();
    var i = cellIndexAt(ch, col);
    if (i < 0) return;                        // the picker belongs to a note
    pickCol = col; pickCh = ch;
    pickOpenedAt = performance.now();
    var x = S.cells[i];
    var vel = x.vel != null ? x.vel : 0.8;
    var el = document.createElement('div');
    el.className = 'n-pick';
    el.innerHTML =
      '<div class="n-pickhead"><span>Sound</span>' +
        '<button type="button" class="n-pclose" data-ed="close" title="Close">\u00d7</button></div>' +
      '<div class="n-pickrow n-pisnd" style="--vc:' + CH[ch].color + '">' + soundPanel(ch, x) + '</div>' +
      '<div class="n-pickhead"><span>Motion</span></div>' +
      '<div class="n-pickrow n-pifx" style="--vc:' + CH[ch].color + '">' + motionBtns(ch, x) + '</div>' +
      '<div class="n-pickhead"><span>While it sounds</span></div>' +
      '<div class="n-pickrow n-pifx" style="--vc:' + CH[ch].color + '">' + moveBtns(ch, x) + '</div>' +
      '<div class="n-pickrow n-picklevels">' +
        '<span>Volume</span>' +
        '<button type="button" class="n-po" data-ed="vol-">\u2212</button>' +
        '<b class="n-meter">' + meterBlocks(Math.round(vel * 8)) + '</b>' +
        '<button type="button" class="n-po" data-ed="vol+">+</button>' +
      '</div>' +
      '<button type="button" class="n-pdel" data-ed="del">Remove this note</button>';
    root.appendChild(el);
    // sit it over the note, kept on screen
    var note = root.querySelector('.n-note[data-col="' + col + '"][data-ch="' + ch + '"]');
    var r = note ? note.getBoundingClientRect() : { left: 0, top: 0, width: 0, bottom: 0 };
    var w = el.getBoundingClientRect().width, hgt = el.getBoundingClientRect().height;
    el.style.left = Math.round(Math.max(10, Math.min(window.innerWidth - w - 10, r.left + r.width / 2 - w / 2))) + 'px';
    var top = r.top - hgt - 10;
    if (top < 8) top = Math.min(window.innerHeight - hgt - 8, r.bottom + 10);
    el.style.top = Math.round(top) + 'px';
  }

  // the picker IS the editor now: refreshing it is all "render the editor" means
  function renderEdit() {
    if (pickCol < 0) return;
    var was = pickOpenedAt;                   // a refresh is not a fresh open --
    openPick(pickCol, pickCh >= 0 ? pickCh : selCh);
    pickOpenedAt = was;                       // else the click-away guard never expires
  }
  // one handler for both: the selected note if there is one, the pen if not
  function editValue(what) {
    var x = selCell();
    if (what.charAt(0) === 'v' && !x) {          // pen voice
      pen.ch = +what.slice(1);
      if (viewCh >= 0 && viewCh !== pen.ch) { viewCh = pen.ch; renderChans(); renderGrid(); renderBars(); }
      renderEdit();
      return;
    }
    if (what === 'close') { closePick(); selCol = -1; selCh = -1; renderGrid(); return; }
    var sch = x ? chOfCell(x) : pen.ch;
    if (what.slice(0, 2) === 'ps') {          // a named starting point
      var pdot = what.indexOf('.');
      var pch = +what.slice(2, pdot), pix = +what.slice(pdot + 1);
      var ps = (pch === 3 ? PRESETS.noise : PRESETS.pulse)[pix];
      if (!ps) return;
      if (x) snapshot();
      ['dy', 'fd', 'nz', 'ns'].forEach(function (k) {
        if (ps[k] == null) return;
        if (x) x[k] = ps[k];
        else if (k === 'dy') chDuty[pch] = ps[k];
        else if (k === 'fd') chFade[pch] = ps[k];
        else if (k === 'nz') pen.drum = ps[k] <= 4 ? 0 : ps[k] <= 9 ? 1 : 2;
      });
      if (x && pch === 3) x.r = MEL_ROWS + (ps.nz <= 4 ? 0 : ps.nz <= 9 ? 1 : 2);
      if (x) { dirty(); renderEdit(); auditionCell(x); }
      else {
        renderChans();
        var pop3 = root.querySelector('.n-sndpop .n-pisnd');
        if (pop3) pop3.innerHTML = soundPanel(pch, null);
        auditionCell(penCell(0));
      }
      return;
    }
    var sp = what.slice(0, 2);
    if (sp === 'dy' || sp === 'wv' || sp === 'ns' || sp === 'fd' || sp === 'nz') {
      var pr = paramsOf(x, sch);
      if (x) snapshot();
      if (sp === 'dy') { pr.dy = +what.slice(2); chDuty[sch] = pr.dy; }
      else if (sp === 'wv') { pr.wv = +what.slice(2); chWave = pr.wv; }
      else if (sp === 'ns') { pr.ns = +what.slice(2); }
      else if (sp === 'fd') {
        var at = FADE_STEPS.indexOf(pr.fd == null ? 0 : pr.fd);
        if (at < 0) at = FADE_STEPS.indexOf(0);
        at = Math.max(0, Math.min(FADE_STEPS.length - 1, at + (what === 'fd+' ? 1 : -1)));
        pr.fd = FADE_STEPS[at];
        if (!x) chFade[sch] = pr.fd;
      } else {
        pr.nz = Math.max(0, Math.min(13, (pr.nz | 0) + (what === 'nz+' ? -1 : 1)));
      }
      if (x) {
        if (sch !== 2) x.fd = pr.fd;
        if (sch === 0 || sch === 1) x.dy = pr.dy;
        if (sch === 2) x.wv = pr.wv;
        if (sch === 3) {
          x.nz = pr.nz; x.ns = pr.ns;
          var band = pr.nz <= 1 ? 0 : pr.nz <= 4 ? 1 : 2;   // height still means pitch
          x.r = MEL_ROWS + band; pen.drum = band;
        }
        dirty(); renderEdit(); auditionCell(x);
      } else {
        if (sch === 3) { pen.drum = pr.nz <= 1 ? 0 : pr.nz <= 4 ? 1 : 2; }
        renderChans();
        var pop2 = root.querySelector('.n-sndpop .n-pisnd');
        if (pop2) pop2.innerHTML = soundPanel(sch, null);
        auditionCell(penCell(0));
      }
      return;
    }
    if (what.slice(0, 2) === 'kt') {          // a sampled drum, or back to the chip
      if (!x) { hint('Pick a drum first, then give it a sample.'); return; }
      snapshot();
      var kv = +what.slice(2);
      if (kv) x.kt = kv; else delete x.kt;
      dirty(); renderEdit(); auditionCell(x);
      return;
    }
    if (what.slice(0, 2) === 'dt') {          // fine tuning, in period units
      if (!x) { hint('Pick a note first, then detune it.'); return; }
      snapshot();
      x.dt = Math.max(-16, Math.min(16, (x.dt | 0) + (what === 'dt+' ? 1 : -1)));
      if (!x.dt) delete x.dt;
      dirty(); renderEdit(); auditionCell(x);
      return;
    }
    if (what.slice(0, 2) === 'mv') {          // what moves while the note sounds
      if (!x) { hint('Pick a note first, then give it a move.'); return; }
      var mk = what.slice(2, 4), mv = what.length > 4 ? +what.slice(4) : null;
      snapshot();
      if (mv != null) x[mk] = x[mk] === mv ? 0 : mv;
      else x[mk] = x[mk] ? 0 : 1;
      if (!x[mk]) delete x[mk];
      dirty(); renderEdit(); auditionCell(x);
      return;
    }
    if (what.slice(0, 2) === 'fx') {          // what the note does while it sounds
      var mk = what.slice(2);
      if (!x) { hint('Pick a note first, then give it a motion.'); return; }
      snapshot();
      MOTION_KEYS.forEach(function (k2) { delete x[k2]; });   // one at a time
      if (mk !== '-') x[mk] = 1;
      dirty(); renderEdit(); auditionCell(x);
      return;
    }
    if (!x) {
      if (what === 'pitch+' || what === 'pitch-') pen.midi = Math.max(24, Math.min(96, pen.midi + (what === 'pitch+' ? 1 : -1)));
      else if (what === 'oct+' || what === 'oct-') pen.midi = Math.max(24, Math.min(96, pen.midi + (what === 'oct+' ? 12 : -12)));
      else if (what === 'vol+' || what === 'vol-') pen.vel = Math.max(0, Math.min(8, Math.round(pen.vel * 8) + (what === 'vol+' ? 1 : -1))) / 8;
      else if (what === 'len+' || what === 'len-') pen.len = Math.max(1, Math.min(16, pen.len + (what === 'len+' ? 1 : -1)));
      else if (what.charAt(0) === 'd') pen.drum = +what.slice(1);
      renderEdit();
      auditionCell(penCell(0));
      return;
    }
    snapshot();
    if (what === 'pitch+' || what === 'pitch-') movePitch(x, what === 'pitch+' ? 1 : -1);
    else if (what === 'oct+' || what === 'oct-') movePitch(x, what === 'oct+' ? 12 : -12);
    else if (what === 'vol+' || what === 'vol-') {
      var v = Math.round((x.vel != null ? x.vel : 0.8) * 8) + (what === 'vol+' ? 1 : -1);
      x.vel = Math.max(0, Math.min(8, v)) / 8;
    } else if (what === 'len+' || what === 'len-') {
      var l = (x.len || 1) + (what === 'len+' ? 1 : -1);
      l = Math.max(1, Math.min(16, l));
      if (l > 1) x.len = l; else delete x.len;
    } else if (what === 'del') {
      var i = S.cells.indexOf(x);
      if (i >= 0) S.cells.splice(i, 1);
      selCol = -1; selCh = -1;
      dirty(); renderEdit();
      return;
    } else if (what.charAt(0) === 'd') {
      x.r = MEL_ROWS + (+what.slice(1));
      delete x.inst;
    }
    // the pen follows what you last set, so the next note matches
    pen.ch = selCh;
    if (x.r < MEL_ROWS) pen.midi = x.midi != null ? x.midi : rowMidi(x.r); else pen.drum = x.r - MEL_ROWS;
    pen.vel = x.vel != null ? x.vel : 0.8; pen.len = x.len || 1;
    dirty(); renderEdit();
    if (!(what === 'vol-' && x.vel === 0)) auditionCell(x);
  }
  // a throwaway cell that describes the pen, for auditioning and placing
  function penCell(col) {
    var c = { c: col, t: ++order };
    if (pen.ch === 3) {
      c.r = MEL_ROWS + pen.drum;
      c.nz = DRUM_SHIFT[pen.drum]; c.ns = 0; c.fd = chFade[3];
    } else {
      c.r = rowForMidi(pen.midi); c.midi = pen.midi;
      c.st = CH[pen.ch].stamp;
      if (pen.ch < 2) c.ch = pen.ch;
      if (pen.ch === 2) c.wv = laneWave();
      else { c.dy = chDuty[pen.ch]; c.fd = chFade[pen.ch]; }
    }
    c.vel = pen.vel;
    if (pen.len > 1) c.len = pen.len;
    return c;
  }
  function selectNote(ch, col) {
    selCh = ch; selCol = col;
    // marking one note does not need a thousand elements rebuilt
    root.querySelectorAll('.n-note.sel').forEach(function (el) { el.classList.remove('sel'); });
    var el2 = root.querySelector('.n-note[data-ch="' + ch + '"][data-col="' + col + '"]');
    if (el2) el2.classList.add('sel');
    renderEdit();
  }

  function renderAll() { renderTransport(); renderChans(); renderBars(); renderGrid(); renderEdit(); }
  // the playhead carries a FRACTION of a step, not a whole one: quantising it
  // made the line hop once per sixteenth (nine times a second) instead of
  // sweeping. Transform, so the move stays on the compositor.
  function playCol() {
    if (!playing) return -1;
    var perMs = (60 / curBpm() / 4) * 1000;
    var elapsed = performance.now() - playT0;
    return loopBar >= 0 ? loopBar * spb() + (elapsed / perMs) % spb() : (elapsed / perMs) % cols();
  }
  function updatePh(col) {
    if (Math.abs(col - lastPh) < 0.01) return;
    lastPh = col;
    var ph = root.querySelector('.n-ph');
    if (ph) {
      ph.style.display = col < 0 ? 'none' : 'block';
      if (col >= 0) ph.style.transform = 'translate3d(' + (col * stepW).toFixed(2) + 'px,0,0)';
    }
  }

  var tickId = 0;
  function scheduleTick() {
    if (!tickId) tickId = requestAnimationFrame(function () { tickId = 0; tick(); });
  }
  function tick() {
    if (!playing || !root) return;
    var perMs = (60 / curBpm() / 4) * 1000;
    var elapsed = performance.now() - playT0;
    if (liveScore && loopBar < 0 && elapsed >= songMs() + 250) {
      composeIntoGrid(liveMood, true);          // the song ended; the mood writes the next
      return;
    }
    if (loopBar >= 0 && queuedBar != null) {
      var ph = (elapsed / perMs) % spb();
      if (ph < loopPhase) {                     // the loop wrapped: switch bars
        loopBar = queuedBar; queuedBar = null; loopPhase = 0;
        viewBar = loopBar;
        startPlayback(0);
        renderAll();
        return;
      }
      loopPhase = ph;
    }
    if (location.pathname !== '/create') ownRoute(encode());   // something else moved the URL; take it back, song and all
    if (following) {
      // re-anchor to the station every frame: two clocks that merely started
      // together are two clocks, and this playhead has to sit on the note you
      // can hear rather than near it.
      var dp = stationPos();
      if (!dp || !stationPlaying()) { following = false; playing = false; renderTransport(); updatePh(-1); return; }
      playT0 = performance.now() - Math.max(0, dp.sec) * 1000;
    }
    var col = playCol();
    var pb = Math.floor(col / spb());
    if (camFollow) { followCol(col); applyCam(); }
    if (pb !== viewBar) { viewBar = pb; renderBars(); }
    lastPlayBar = pb;
    updatePh(col);
    scheduleTick();
  }

  // nudge this voice's bar left/right (wrapping), or move it an octave
  function shiftBar(dir, bar) {
    var b = bar == null ? viewBar : bar;
    var cellsHere = [];
    for (var s2 = 0; s2 < spb(); s2++) {
      var col = b * spb() + s2;
      if (viewCh < 0) { for (var c2 = 0; c2 < 4; c2++) { var j = cellIndexAt(c2, col); if (j >= 0) cellsHere.push(S.cells[j]); } }
      else { var i = cellIndexAt(viewCh, col); if (i >= 0) cellsHere.push(S.cells[i]); }
    }
    if (!cellsHere.length) { hint('Nothing to nudge in bar ' + (b + 1) + '.'); return; }
    snapshot();
    cellsHere.forEach(function (x) { x.c = b * spb() + ((x.c - b * spb() + dir + spb()) % spb()); });
    selCol = -1; selCh = -1;
    dirty();
  }
  // ---- bar operations ------------------------------------------------------
  function addBar(bar) {
    if (S.bars >= 48) { hint('48 bars is the limit \u2014 remove one to make room.'); return; }
    snapshot();
    if (bar != null) viewBar = bar;
    var width = spb(), at = viewBar * width;    // an empty bar opens HERE
    S.cells.forEach(function (x) { if (x.c >= at) x.c += width; });
    S.bars++;
    buildTrack(); centerOn(viewBar, true);
    dirty(); renderAll();
  }
  function dupBar(b) {
    if (S.bars >= 48) { hint('48 bars is the limit \u2014 remove one to make room.'); return; }
    snapshot();
    var copies = [];
    S.cells.forEach(function (x) {
      if (x.c >= (b + 1) * spb()) x.c += spb();
      else if (x.c >= b * spb()) {
        var cp = { c: x.c + spb(), r: x.r, t: ++order };
        Object.keys(x).forEach(function (k) {
          if (k !== 'c' && k !== 'r' && k !== 't') cp[k] = x[k];
        });
        copies.push(cp);
      }
    });
    S.cells = S.cells.concat(copies);
    S.bars++; viewBar = b + 1;
    if (loopBar >= 0) loopBar = viewBar;
    buildTrack(); centerOn(viewBar, true);
    dirty(); renderAll();
  }
  function delBar(b) {
    snapshot();
    S.cells = S.cells.filter(function (x) { return x.c < b * spb() || x.c >= (b + 1) * spb(); });
    if (S.bars > 1) {
      S.cells.forEach(function (x) { if (x.c >= (b + 1) * spb()) x.c -= spb(); });
      S.bars--;
    }
    if (viewBar >= S.bars) viewBar = S.bars - 1;
    if (loopBar >= S.bars) loopBar = S.bars - 1;
    buildTrack(); centerOn(viewBar, true);
    dirty(); renderAll();
  }

  // ---- build the screen ----------------------------------------------------
  // the player's own transport icons, so both screens look like one product
  function _pb(n) {
    try { if (typeof _pbIcon === 'function') return _pbIcon(n); } catch (e) {}
    return ({ prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2.2v12H6z"/><path d="M20 6 L9.5 12 L20 18 Z"/></svg>',
              play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5 L19 12 L7 19 Z"/></svg>',
              pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>' })[n] || '';
  }
  // the same two downloads the player offers, with the player's own icons
  function _ic(which) {
    try {
      if (which === 'wave' && typeof _IC_WAVE !== 'undefined') return _IC_WAVE;
      if (which === 'rom' && typeof _IC_ROM !== 'undefined') return _IC_ROM;
      if (which === 'share') return '<svg class="cr-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>';
    } catch (e) {}
    return '';
  }
  var CHIPS = ['happy', 'sad', 'upbeat', 'chill', 'spooky', 'epic', 'retro', 'funky', 'dreamy', 'battle'];
  function buildUI() {
    root.innerHTML =
      // THE ASK COMES FIRST. Writing a song is what this screen is for; Undo,
      // Redo and the three exports are what you do to one afterwards, so they
      // sat above the reason to be here.
      '<div class="n-moodrow"><span class="n-moodlab">Write me a song that is…</span>' +
        '<span class="n-moodchips">' +
        CHIPS.map(function (c) { return '<button type="button" class="cr-chip" data-mood="' + c + '">' + c + '</button>'; }).join('') +
        '</span></div>' +
      '<form class="n-prompt"><input class="cr-mood" aria-label="Describe your song" maxlength="500" placeholder="A dreamy cave theme in D minor, no drums" autocomplete="off">' +
        '<button type="submit" class="cr-btn">Write song</button></form>' +
      '<div class="n-prompt-result" role="status" aria-live="polite"></div>' +
      // ONE ROW THAT SCROLLS, not a wrapping block. Five pills do not fit
      // across a phone, and wrapping them cost a whole line of a screen that
      // is mostly song. This is the same nowrap + overflow-x treatment the
      // mood row above already uses.
      '<div class="n-utils">' +
        '<button type="button" class="cr-btn" data-cr="undo">↩ Undo</button>' +
        '<button type="button" class="cr-btn" data-cr="redo">↪ Redo</button>' +
        '<button type="button" class="cr-btn cr-dl" data-cr="share">' + _ic('share') + 'Copy link</button>' +
        '<button type="button" class="cr-btn cr-dl" data-cr="wav">' + _ic('wave') + 'Download WAV</button>' +
        '<button type="button" class="cr-btn cr-dl" data-cr="rom">' + _ic('rom') + 'Download ROM</button>' +
        // For the people who write on the hardware: an arrangement to open in
        // LSDj and keep working on, rather than a finished thing to admire.
        '<button type="button" class="cr-btn cr-dl" data-cr="lsdsng" title="One LSDj song: notes, phrases, chains, tempo and groove, ready to keep writing">' + _ic('rom') + 'Download LSDj</button>' +
        '<button type="button" class="cr-btn cr-dl" data-cr="midi" title="Standard MIDI, one track per voice">' + _ic('wave') + 'Download MIDI</button>' +
      '</div>' +
      // CLOSE IS AN X IN THE CORNER, not a labelled button in the utility row.
      // It is the one control that LEAVES, every sheet puts it top-right, and
      // as a worded pill it read as one more export action. Outside both rows
      // so it can be pinned to the sheet rather than carried by a flex line.
      '<button type="button" class="cr-btn cr-close" data-cr="close" title="Close the editor and go back to the game" aria-label="Close the editor"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg><span>Back to game</span></button>' +
      '<div class="n-mid">' +
        '<div class="n-side">' +
          '<div class="n-sidehead"></div>' +
          CH.map(function (c, i) {
            return '<div class="n-lane" data-ch="' + i + '"><b>' + c.n + '</b>' +
                   '<button type="button" class="n-lsnd" data-snd="' + i + '"></button>' +
                   '<i class="n-spk" data-mute="' + i + '"></i></div>';
          }).join('') +
        '</div>' +
        '<div class="n-scroll"><div class="n-bg"></div><div class="n-track">' +
          '<div class="n-ruler"></div>' +
          '<div class="n-barhl"></div>' +
          CH.map(function (c, i) { return '<div class="n-row" data-ch="' + i + '" style="--vc:' + c.color + '"></div>'; }).join('') +
          '<div class="n-ph"></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="n-sbarrow"><div class="n-sbar"><div class="n-sthumb"></div></div></div>' +
      '<div class="n-transport">' +
        '<div class="n-tctrl">' +
          '<button type="button" class="n-tbtn" data-cr="rewind" title="Back to the start">' + _pb('prev') + '</button>' +
          '<button type="button" class="n-tbtn n-play" data-cr="play" title="Play / Pause" aria-label="Play song" aria-pressed="false">' + _pb('play') + '</button>' +
        '</div>' +
        '<button type="button" class="n-tfollow' + (camFollow ? ' on' : '') + '" data-cr="follow" ' +
          'title="Keep the view on the music">Follow</button>' +
        '<label class="cr-lab">Speed <b class="n-bpmval">' + S.bpm + '</b> BPM' +
        '<input type="range" min="70" max="180" step="1" value="' + S.bpm + '" data-cr="bpm"></label>' +
        '<span class="cr-lab n-gridpick">Grid' + GRIDS.map(function (g) {
          return '<button type="button" class="n-gbtn" data-cr="grid' + g + '">' + g + '</button>';
        }).join('') + '</span>' +
      '</div>';
    sizeTrack();
  }
  function buildTrack() { sizeTrack(); renderBars(); renderGrid(); renderChans(); }
  var stepW = 30, laneH = 62, sidePad = 0;
  // Geometry used by the animation tick. Keep it in the resize/build path;
  // reading these rects from applyCam() every frame forced synchronous layout
  // while the playhead was moving.
  var trackViewW = 0, scrollBarW = 0;
  function sizeTrack() {
    var sc = root.querySelector('.n-scroll');
    if (!sc) return;
    var r = sc.getBoundingClientRect();
    if (!r.width || !r.height) return;
    trackViewW = r.width;
    var sb = root.querySelector('.n-sbar');
    scrollBarW = sb ? sb.getBoundingClientRect().width : 0;
    var narrow = r.width < 520;
    stepW = narrow ? 26 : 34;
    laneH = Math.max(48, Math.floor((r.height - 32) / 4));   // the four lanes fill the room
    sidePad = 0;                               // the song starts at the left edge
    root.style.setProperty('--stepw', stepW + 'px');
    root.style.setProperty('--laneh', laneH + 'px');
    root.style.setProperty('--sidepad', sidePad + 'px');
    root.style.setProperty('--barw', (spb() * stepW) + 'px');
    root.style.setProperty('--songw', (cols() * stepW) + 'px');
  }
  function songW() { return cols() * stepW; }
  function camMax() {
    var w = trackViewW;
    return Math.max(0, songW() + sidePad * 2 - w);
  }
  function centerOn(bar, snap) {
    var w = trackViewW;
    var want = Math.max(0, Math.min(camMax(), sidePad + (bar * spb() + spb() / 2) * stepW - w / 2));
    camX = snap ? want : camX + (want - camX) * (Math.abs(want - camX) > w ? 1 : 0.18);
    if (snap) camCatch = 0;
  }
  // the camera rides the playhead itself, not the bar it sits in. A target
  // that only moves once a bar makes the track lurch and then stand still for
  // the rest of the bar -- smooth frames, stuttering motion.
  function viewW() {
    return trackViewW;
  }
  function camForCol(col) {
    return Math.max(0, Math.min(camMax(), sidePad + (col + 0.5) * stepW - viewW() / 2));
  }
  function followCol(col) {
    var want = camForCol(col);
    if (camCatch) {                         // glide the last hand position home
      camCatch *= 0.86;
      if (Math.abs(camCatch) < 0.5) camCatch = 0;
    }
    camX = Math.max(0, Math.min(camMax(), want + camCatch));
  }
  // A hand scroll KEEPS the camera. Nothing guesses it back: an earlier rule
  // re-armed the follow as soon as the playhead came into view, which fought
  // the hand mid-drag -- drag the scrollbar left and the view snapped away
  // before you could reach bar 1. Play, Start, a new mood and the Follow
  // button hand it back, and nothing else does.
  function handScrolled() {
    camFollow = false;
    renderFollow();
    tourAdvance(2);                          // "the song runs left to right"
  }
  // Follow: jump to the music and ride along again
  function followNow() {
    tourAdvance(2);
    camFollow = true;
    var col = playCol();
    if (col >= 0) camCatch = camX - camForCol(col);   // glide, do not snap
    else { camCatch = 0; centerOn(lastPlayBar > 0 ? lastPlayBar : 0, true); applyCam(); viewBar = Math.max(0, lastPlayBar); renderBars(); }
    renderFollow();
  }
  function renderFollow() {
    var b = root && root.querySelector('[data-cr="follow"]');
    if (b) b.classList.toggle('on', camFollow);
  }
  function applyCam() {
    // scrolled far enough that the drawn window no longer covers the pane?
    var vis = visRange();
    if (vis[0] < visFrom || vis[1] > visTo) renderGrid();
    var track = root.querySelector('.n-track');
    if (track) track.style.transform = 'translate3d(' + (-camX).toFixed(2) + 'px,0,0)';
    // the scrollbar says where in the song you are, and how much of it you see
    var bar = root.querySelector('.n-sbar'), thumb = root.querySelector('.n-sthumb');
    if (bar && thumb) {
      var view = trackViewW;
      var total = Math.max(view, songW());
      var bw = scrollBarW;
      var tw = Math.max(28, Math.round(bw * view / total));
      var span = Math.max(1, camMax());
      thumb.style.width = tw + 'px';
      thumb.style.left = ((bw - tw) * (camX / span)).toFixed(2) + 'px';
    }
    // the gridlines repeat every bar, so the backdrop only ever needs to move
    // within one bar: a composited nudge instead of a full repaint
    var bg = root.querySelector('.n-bg');
    if (bg) {
      var barPx = spb() * stepW;
      var t = ((sidePad - camX) % barPx + barPx) % barPx;   // keep the bar lines on the bars
      bg.style.transform = 'translate3d(' + (t - barPx).toFixed(2) + 'px,0,0)';
    }
  }
  function barUnderCamera() {
    var w = trackViewW;
    return Math.max(0, Math.min(S.bars - 1, Math.floor((camX + w / 2 - sidePad) / (spb() * stepW))));
  }
  // a note can be dragged: these turn a pointer position into lane and pitch
  function laneAt(clientY) {
    var rows = root.querySelectorAll('.n-row');
    for (var i = 0; i < rows.length; i++) {
      var rr = rows[i].getBoundingClientRect();
      if (clientY >= rr.top && clientY <= rr.bottom) return +rows[i].dataset.ch;
    }
    return -1;
  }
  function pitchAt(ch, clientY) {
    var row = root.querySelector('.n-row[data-ch="' + ch + '"]');
    if (!row) return null;
    var rr = row.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (rr.bottom - clientY) / Math.max(1, rr.height)));
    if (ch === 3) return { drum: f > 0.66 ? 0 : f > 0.33 ? 1 : 2 };   // hat / snare / kick
    return { midi: Math.max(24, Math.min(96, Math.round(36 + f * 60))) };
  }
  function colAt(clientX) {
    var sc = root.querySelector('.n-scroll');
    if (!sc) return 0;
    var r = sc.getBoundingClientRect();
    return Math.max(0, Math.min(cols() - 1, Math.floor((clientX - r.left + camX - sidePad) / stepW)));
  }
  // What does this lane SOUND like around here? A composed song changes
  // patches from section to section, so a note joining a lane takes the
  // instrument its new neighbours are using -- otherwise the same written
  // note lands on a different sound than the ones beside it.
  // move a note to another voice in place, keeping what it was
  // Changing the grid keeps the music where it is in TIME and moves the
  // columns under it. Coarsening can land two notes on one step of a lane --
  // the chip only has one voice there, so say so rather than losing one quietly.
  function setGrid(g) {
    if (!S || g === spb()) return;
    snapshot();
    var from = spb(), seen = {}, clash = 0;
    S.cells.forEach(function (x) {
      x.c = Math.max(0, Math.round(x.c * g / from));
      if (x.len) x.len = Math.max(1, Math.round(x.len * g / from));
    });
    S.grid = g;
    S.cells.forEach(function (x) {
      var key = chOfCell(x) + ':' + x.c;
      if (seen[key]) clash++; else seen[key] = 1;
    });
    closePick(); closeSnd();
    sizeTrack(); buildTrack(); renderTransport(); dirty();
    hint(g + ' steps to the bar' + (clash ? ' \u2014 ' + clash + ' notes now share a step' : '') + '.');
  }
  function setCellVoice(x, v) {
    delete x.inst;                            // the settings below are the sound now
    if (v === 3) { delete x.dy; delete x.wv; x.nz = DRUM_SHIFT[pen.drum]; x.ns = 0; x.fd = chFade[3]; }
    else if (v === 2) { delete x.dy; delete x.nz; delete x.ns; delete x.fd; x.wv = laneWave(); }
    else { delete x.wv; delete x.nz; delete x.ns; x.dy = chDuty[v]; x.fd = chFade[v]; }
    MOTION_KEYS.forEach(function (k) {        // do not carry a motion into a lane that cannot play it
      if (!x[k]) return;
      var ok = false;
      MOTIONS.forEach(function (m) { if (m.k === k && m.ch[v]) ok = true; });
      if (!ok) delete x[k];
    });
    if (v === 3) {
      x.r = MEL_ROWS + pen.drum;
      delete x.midi; delete x.ch; delete x.st; delete x.z; delete x.sweep;
    } else {
      if (x.r >= MEL_ROWS) { x.r = rowForMidi(pen.midi); x.midi = pen.midi; }
      x.st = CH[v].stamp;
      if (v < 2) x.ch = v; else delete x.ch;
    }
  }
  // which lane and step a point falls on
  function hitAt(ev) {
    var sc = root.querySelector('.n-scroll');
    if (!sc) return null;
    var r = sc.getBoundingClientRect();
    var x = ev.clientX - r.left + camX - sidePad;
    var col = Math.floor(x / stepW);
    if (col < 0 || col >= cols()) return null;
    var rows = root.querySelectorAll('.n-row');
    for (var i = 0; i < rows.length; i++) {
      var rr = rows[i].getBoundingClientRect();
      if (ev.clientY >= rr.top && ev.clientY <= rr.bottom) return { col: col, ch: +rows[i].dataset.ch };
    }
    return null;
  }

  function wireEvents() {
    root.querySelector('.n-prompt').addEventListener('submit', function (ev) {
      ev.preventDefault();
      gestured = true; wantStart = false;
      try { if (typeof Audio !== 'undefined' && Audio.resume) Audio.resume(true); } catch (e) {}
      composeIntoGrid(root.querySelector('.cr-mood').value);
    });
    // Space plays/pauses
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' || !isOpen() || ev.metaKey || ev.altKey || ev.ctrlKey) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      ev.preventDefault(); ev.stopPropagation();
      gestured = true;
      try { if (typeof Audio !== 'undefined' && Audio.resume) Audio.resume(true); } catch (e) {}
      togglePlay();
    }, true);

    var sc = root.querySelector('.n-scroll'), pan = null;

    // a lane cell: tap a note to open it, tap empty space to add one there
    var dragged = false;
    sc.addEventListener('click', function (ev) {
      if (dragged || (pan && pan.moved)) { pressedNote = null; return; }
      var noteEl = ev.target.closest('.n-note');
      var hit = noteEl ? { ch: +noteEl.dataset.ch, col: +noteEl.dataset.col } : pressedNote;
      pressedNote = null;
      if (hit) {
        var nc = hit.col, nch = hit.ch;
        viewBar = Math.floor(nc / spb());
        selectNote(nch, nc);
        var i = cellIndexAt(nch, nc);
        if (i < 0) return;
        auditionCell(S.cells[i]);
        openPick(nc, nch);
        return;
      }
      var h = hitAt(ev); if (!h) return;
      // Below here the click was on EMPTY lane space -- the note block above
      // catches every click on a note, tail included, because the block is as
      // wide as the note is long. This used to look up whatever cell shared
      // the column and open its panel, so clicking high above a note opened
      // that note: the panel belongs to the note you actually hit.
      if (pickCol >= 0) { selCol = -1; selCh = -1; closePick(); renderGrid(); return; }
      var taken = cellIndexAt(h.ch, h.col);
      if (taken < 0) taken = tailIndexAt(h.ch, h.col);
      if (taken >= 0) return;                 // one note per step in a lane
      viewBar = Math.floor(h.col / spb());
      // place a note right where you clicked: this lane, and this height
      snapshot();
      pen.ch = h.ch;
      var pAt = pitchAt(h.ch, ev.clientY);
      if (pAt && pAt.midi != null) pen.midi = pAt.midi;
      if (pAt && pAt.drum != null) pen.drum = pAt.drum;
      var made = penCell(h.col);
      S.cells.push(made);
      selCh = h.ch; selCol = h.col;
      renderChans(); dirty(); auditionCell(made);
      openPick(h.col, h.ch);
      tourAdvance(0);
    });

    // drag a NOTE to move it: up and down for pitch (or drum), sideways in
    // time, into another lane to change voice. It sounds as it goes.
    // The drag handler takes POINTER CAPTURE on the scroller, so the click
    // that follows is delivered with the SCROLLER as its target, not the note
    // -- closest('.n-note') finds nothing and the panel never opens. So the
    // press remembers which note it was on, and the click uses that.
    var nd = null, pressedNote = null;
    sc.addEventListener('pointerdown', function (ev) {
      var el = ev.target.closest('.n-note');
      if (el) {
        var col = +el.dataset.col, ch = +el.dataset.ch, i = cellIndexAt(ch, col);
        if (i >= 0) {
          try { sc.setPointerCapture(ev.pointerId); } catch (e) {}
          var nb = el.getBoundingClientRect();
          nd = { cell: S.cells[i], ch: ch, sx: ev.clientX, sy: ev.clientY,
                 grab: colAt(ev.clientX) - col, moved: false, pokeAt: 0, poked: -1,
                 mode: (ev.clientX > nb.right - 14) ? 'len' : 'move' };
          return;
        }
      }
      pan = { x: ev.clientX, cam: camX, moved: false };
    });
    // HOVER: passing over a note plays it. It fires once when the pointer
    // ENTERS a note, never while it rests there, and never during a drag or a
    // pan -- those do their own auditioning. Touch has no hover, so this is
    // for a mouse or a trackpad only.
    var hoverKey = '', hoverCh = -1, hoverAt = 0;
    sc.addEventListener('pointermove', function (ev) {
      if (nd || (pan && pan.moved) || ev.pointerType === 'touch') return;
      // The editor opens UNDER a cursor that has not moved. The first
      // pointermove after that is the browser telling us where the pointer
      // already was, and if a note happened to arrive beneath it, it sounded --
      // a note played for no reason anyone could see. Arm on real movement.
      if (!hoverArmed) {
        if (hoverPx < 0) { hoverPx = ev.clientX; hoverPy = ev.clientY; return; }
        if (Math.abs(ev.clientX - hoverPx) < 3 && Math.abs(ev.clientY - hoverPy) < 3) return;
        hoverArmed = true;
      }
      var el = ev.target.closest('.n-note');
      if (!el) { hoverKey = ''; return; }
      var key = el.dataset.ch + ':' + el.dataset.col;
      if (key === hoverKey) return;
      hoverKey = key;
      var now = performance.now();
      if (now - hoverAt < 70) return;         // sweeping across the grid is not a solo
      hoverAt = now;
      var i = cellIndexAt(+el.dataset.ch, +el.dataset.col);
      if (i < 0) return;
      if (hoverCh >= 0) stopAudition(hoverCh);
      hoverCh = auditionCell(S.cells[i], Math.round(FPS * 0.35));
    });
    sc.addEventListener('pointerleave', function () {
      hoverKey = '';
      if (hoverCh >= 0) { stopAudition(hoverCh); hoverCh = -1; }
    });
    sc.addEventListener('pointermove', function (ev) {
      if (nd) {
        if (!nd.moved) {
          if (Math.abs(ev.clientX - nd.sx) < 4 && Math.abs(ev.clientY - nd.sy) < 4) return;
          nd.moved = true; snapshot();
        }
        var x = nd.cell;
        if (nd.mode === 'len') {                           // pulling the right edge
          var nl = Math.max(1, Math.min(cols() - x.c, colAt(ev.clientX) - x.c + 1));
          if (nl !== (x.len || 1)) {
            if (nl > 1) x.len = nl; else delete x.len;
            selCh = nd.ch; selCol = x.c;
            dirty();
          }
          return;
        }
        var lane = laneAt(ev.clientY);
        if (lane >= 0 && lane !== nd.ch) {                 // dropped onto another voice
          stopAudition(nd.poked >= 0 ? nd.poked : null);   // never leave the old voice ringing
          nd.poked = -1;
          if (x.r < MEL_ROWS) pen.midi = x.midi != null ? x.midi : rowMidi(x.r);
          else pen.drum = x.r - MEL_ROWS;
          setCellVoice(x, lane);
          nd.ch = lane;
        }
        var p2 = pitchAt(nd.ch, ev.clientY);
        if (p2 && p2.midi != null && x.r < MEL_ROWS) {
          if (p2.midi !== x.midi) { x.midi = p2.midi; x.r = rowForMidi(p2.midi); }
        } else if (p2 && p2.drum != null && x.r >= MEL_ROWS) {
          x.r = MEL_ROWS + p2.drum; pen.drum = p2.drum;
        }
        var nc = Math.max(0, Math.min(cols() - (x.len || 1), colAt(ev.clientX) - nd.grab));
        if (nc !== x.c && cellAtExcept(nc, x.r, x) < 0) x.c = nc;
        selCh = nd.ch; selCol = x.c;
        dirty();
        var t = performance.now();
        if (t - nd.pokeAt > 110) {                         // short, so nothing rings on
          nd.pokeAt = t;
          nd.poked = auditionCell(x, Math.round(FPS * 0.35));
        }
        return;
      }
      if (!pan) return;
      if (Math.abs(ev.clientX - pan.x) > 4) pan.moved = true;
      if (!pan.moved) return;
      camX = Math.max(0, Math.min(camMax(), pan.cam - (ev.clientX - pan.x)));
      handScrolled();
      applyCam();
      var nb = barUnderCamera();
      if (nb !== viewBar) { viewBar = nb; delArm = -1; renderBars(); }
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      sc.addEventListener(t, function () {
        if (nd) {
          stopAudition(null);                              // let go = silence, on every voice
          if (nd.moved) { dragged = true; renderEdit(); }  // a drag is not a click
          else pressedNote = { ch: nd.ch, col: nd.cell.c };
        }
        nd = null;
        setTimeout(function () { pan = null; dragged = false; }, 0);
      });
    });
    sc.addEventListener('wheel', function (ev) {
      if (camMax() <= 0) return;
      ev.preventDefault();
      var d = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * (ev.deltaMode === 1 ? 30 : 2.2);
      camX = Math.max(0, Math.min(camMax(), camX + d));
      handScrolled();
      applyCam();
      var nb2 = barUnderCamera();
      if (nb2 !== viewBar) { viewBar = nb2; renderBars(); }
    }, { passive: false });

    // the scrollbar: drag the thumb, or click anywhere on the track to jump
    var bar = root.querySelector('.n-sbar'), sdrag = null;
    function camFromBar(clientX) {
      var br = bar.getBoundingClientRect();
      var thumb = root.querySelector('.n-sthumb');
      var tw = thumb ? thumb.getBoundingClientRect().width : 30;
      var f = (clientX - br.left - tw / 2) / Math.max(1, br.width - tw);
      camX = Math.max(0, Math.min(camMax(), f * camMax()));
      handScrolled();
      applyCam();
      var nb = barUnderCamera();
      if (nb !== viewBar) { viewBar = nb; delArm = -1; renderBars(); }
    }
    bar.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      try { bar.setPointerCapture(ev.pointerId); } catch (e) {}
      sdrag = true; camFromBar(ev.clientX);
    });
    bar.addEventListener('pointermove', function (ev) { if (sdrag) camFromBar(ev.clientX); });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      bar.addEventListener(t, function () { sdrag = null; });
    });

    // Anything open closes when you click off it. This listens on the
    // document, not on the editor: a click on the lane column, the transport
    // or the page around them is still a click away from the panel.
    document.addEventListener('click', function (ev) {
      if (!isOpen()) return;
      // A handler that re-renders leaves the clicked element detached, and
      // closest() then finds nothing above it -- which reads as a click on the
      // page. It was ours: leave what is open alone.
      if (!ev.target.isConnected) return;
      // a grid re-render detaches the element that was clicked, so closest()
      // stops finding its square: never treat the click that just opened the
      // panel as a click outside it
      if (pickCol >= 0 && performance.now() - pickOpenedAt > 60 &&
          !ev.target.closest('.n-pick') && !ev.target.closest('.n-note')) { closePick(); renderGrid(); }
      if (sndCh >= 0 && !ev.target.closest('.n-pick') && !ev.target.closest('[data-snd]')) closeSnd();
    });

    // the lane names: tap the speaker to mute, the name to aim the next note
    root.querySelector('.n-side').addEventListener('click', function (ev) {
      var mb = ev.target.closest('[data-mute]');
      if (mb) {
        var mi = +mb.dataset.mute;
        chMuted[mi] = !chMuted[mi];
        applyMute();
        return;
      }
      var sb = ev.target.closest('[data-snd]');
      if (sb) { openSnd(+sb.dataset.snd); return; }
      var ln = ev.target.closest('.n-lane');
      if (!ln) return;
      pen.ch = +ln.dataset.ch;
      renderChans(); renderEdit();
      tourAdvance(1);
    });

    window.addEventListener('resize', function () {
      if (!isOpen()) return;
      sizeTrack(); renderBars(); renderGrid(); centerOn(viewBar, true); applyCam();
    });

    root.addEventListener('click', function (ev) {
      var fb = ev.target.closest('button'); if (fb) fb.blur();
      var sx = ev.target.closest('[data-sndclose]');
      if (sx) { closeSnd(); return; }
      var tb = ev.target.closest('[data-tour]');
      if (tb) {
        if (tb.dataset.tour === 'skip') tourDone(); else tourAdvance(tourStep);
        return;
      }
      var edb = ev.target.closest('[data-ed]');
      if (edb) {
        var wasDel = edb.dataset.ed === 'del';
        editValue(edb.dataset.ed);
        if (wasDel) closePick(); else if (pickCol >= 0) openPick(pickCol, pickCh);
        return;
      }
      var sh = ev.target.closest('[data-barshift]');
      if (sh) { shiftBar(+sh.dataset.barshift, viewBar); return; }
      var ins = ev.target.closest('[data-insbar]');
      if (ins) { addBar(+ins.dataset.insbar); return; }
      var de = ev.target.closest('[data-delbar]');
      if (de) {
        var bi2 = +de.dataset.delbar;
        if (delArm !== bi2) {                   // ask before throwing a bar away
          delArm = bi2;
          clearTimeout(delTimer);
          delTimer = setTimeout(function () { delArm = -1; renderBars(); }, 4000);
          renderBars();
          return;
        }
        clearTimeout(delTimer); delArm = -1;
        delBar(bi2);
        return;
      }
      var mc = ev.target.closest('[data-mood]');
      if (mc) {                               // asking for a song is asking for sound
        if (!gestured) {
          gestured = true; wantStart = false;
          try { if (typeof Audio !== 'undefined' && Audio.resume) Audio.resume(true); } catch (e) {}
        }
        composeIntoGrid(mc.dataset.mood); tourAdvance(3); return;
      }
      var b = ev.target.closest('[data-cr]');
      if (!b) return;
      var k = b.dataset.cr;
      if (k === 'play') { gestured = true; togglePlay(); }
      else if (k.slice(0, 4) === 'grid') { setGrid(+k.slice(4)); }
      else if (k === 'follow') { followNow(); }
      else if (k === 'rewind') { pausedAt = 0; if (playing) startPlayback(0); else { camFollow = true; centerOn(0, true); viewBar = 0; renderBars(); } hint('Back to the start.'); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'share') { shareSong(b); }
      else if (k === 'wav') { exportWav(); }
      else if (k === 'rom') { exportRom(); }
      else if (k === 'lsdsng') { exportLsdsng(); }
      else if (k === 'midi') { exportMidi(); }
    });
    root.addEventListener('input', function (ev) {
      var b = ev.target.closest('[data-cr="bpm"]'); if (!b) return;
      dropLiveScore();
      S.bpm = +b.value;
      var bv2 = root.querySelector('.n-bpmval'); if (bv2) bv2.textContent = S.bpm;
      dirty();
    });
    window.addEventListener('resize', function () {
      if (!isOpen()) return;
      sizeTrack(); centerOn(viewBar, true); renderBars();
    });
  }
  // ---- open / close --------------------------------------------------------
  // FROM SCRATCH: an empty grid, deliberately. The build path composes a song
  // when it finds no cells ("never a blank page, never a dead room"), which is
  // right when the editor is somewhere you land and wrong when emptiness is the
  // thing you asked for.
  var wantBlank = false;
  var hoverArmed = false, hoverPx = -1, hoverPy = -1;   // see the hover audition
  function openBlank() {
    wantBlank = true;
    hoverArmed = false; hoverPx = -1;
    if (root) {
      S = freshState(); order = 0;
      dropLiveScore(); loopBar = -1; queuedBar = null; viewBar = 0; camX = 0;
      selCol = -1; selCh = -1;
      root.classList.add('show');
      sizeTrack(); buildTrack(); renderAll();
      armChip(); pausedAt = 0; playing = false; renderTransport();
      ownRoute('');
      hint('An empty grid. Take the pencil to it, or pick a mood above.');
      wantBlank = false;
      return;
    }
    open('');
  }
  function open(code) {
    // open(code): the station hands over the song it is playing, so the editor
    // starts on exactly that -- the whole point of the two being one thing.
    hoverArmed = false; hoverPx = -1;
    if (root) {
      if (code) { var st = decode(code); if (st) { S = st; order = S.cells.length;
        loopBar = -1; queuedBar = null; viewBar = 0; camX = 0; selCol = -1; selCh = -1;
        dropLiveScore(); sizeTrack(); buildTrack(); renderAll(); } }
      root.classList.add('show');
      // The station is already playing this document. Show it, follow it, and
      // touch nothing -- no re-arm, no restart, no gap, and you land where the
      // song actually is rather than back at bar one.
      if (canFollow(code) && followStation()) return;
      armChip(); if (!playing) startPlayback(pausedAt); return;
    }
    var fromUrl = code || (location.hash.match(/#s=([A-Za-z0-9\-_]+)/) || [])[1];
    S = (fromUrl && decode(fromUrl)) || null;
    // "Start from scratch" means an empty grid. It used to fall through to the
    // URL and then to the saved draft, so it opened whatever you were last
    // working on -- a page full of notes, in answer to a request for none.
    if (!S && !wantBlank) { try { var d = localStorage.getItem('ct-create-draft'); if (d) S = decode(d); } catch (e) {} }
    if (!S) S = freshState();
    order = S.cells.length;
    root = document.createElement('div');
    root.id = 'createscreen';
    // arriving straight at /create: no fade, or the page behind shows through it
    if (location.pathname === '/create') root.classList.add('instant');
    document.body.appendChild(root);
    buildUI();
    wireEvents();
    requestAnimationFrame(function () {
      root.classList.add('show');
      sizeTrack(); buildTrack(); centerOn(viewBar, true); renderAll();
    });
    document.body.classList.add('create-open');
    if (audioLive()) gestured = true;
    // Do NOT arm the chip when the station is already playing this song: that
    // is what silenced it. Decide before anything is posted.
    var follow0 = canFollow(code);
    if (!follow0) armChip();
    ownRoute(S.cells.length ? encode() : '');
    pen.midi = rowMidi(lastDeg[0] != null ? MEL_ROWS - 1 - lastDeg[0] : 7);
    hint('');
    // never a blank page, never a dead room: a song is already here, and the
    // transport is already running
    if (wantBlank) {
      wantBlank = false;
      hint('An empty grid. Take the pencil to it, or pick a mood above.');
    } else if (!S.cells.length && G.CT_COMPOSERS) {
      var m0 = ['chill', 'happy', 'dreamy', 'funky'][Math.floor(Math.random() * 4)];
      var mi0 = root.querySelector('.cr-mood'); if (mi0) mi0.value = m0;
      composeIntoGrid(m0);
      hint('A ' + m0 + ' song is already rolling. Tap a mood for another, or take the pencil to this one.');
      var toured = false;
      try { toured = !!localStorage.getItem('ct-create-tour'); } catch (e) {}
      if (!toured) setTimeout(function () { if (isOpen()) tourShow(0); }, 1400);
    } else if (follow0 && followStation()) {
      try { buildSong(); } catch (e) {}
      renderAll();
    } else {
      try { buildSong(); } catch (e) {}
      startPlayback(0);
      renderAll();
    }
  }
  function close() {
    // Never took the chip: the station has been playing the whole time and
    // closing this is closing a VIEW. Stopping and restarting it here is what
    // used to drop the radio into silence.
    var justAView = following && !owning;
    if (!justAView) { if (playing) pausePlayback(); else armChip(); }
    pausedAt = 0;
    // Hand the chip back UNMUTED. This used to reset the editor's own array and
    // trust playScore() to clear the chip's mask; if anything returns to the
    // radio without going through playScore, a lane muted in here stays muted
    // out there, and the station plays with voices missing.
    chMuted = [false, false, false, false];
    if (typeof Audio !== 'undefined' && Audio.setChipMute) Audio.setChipMute(null);
    loopBar = -1; queuedBar = null;
    closeSnd();
    if (root) root.classList.remove('show');
    document.body.classList.remove('create-open');
    try { history.replaceState(null, '', '/'); } catch (e) {}
    following = false; owning = false;
    if (justAView) { if (G._closeCreateView) G._closeCreateView(); return; }
    if (G._closeCreateReturn) G._closeCreateReturn();
  }
  function isOpen() { return !!(root && root.classList.contains('show')); }

  // Escape closes the innermost thing first -- runtime asks before it closes
  // the whole editor
  function escape() {
    if (root && root.querySelector('.n-sndpop')) { closeSnd(); return true; }
    if (pickCol >= 0) { closePick(); selCol = -1; selCh = -1; renderGrid(); return true; }
    return false;
  }
  G.CT_CREATE = { open: open, close: close, isOpen: isOpen, togglePlay: togglePlay, escape: escape,
    // THE STATION'S SONGS ARE CREATE'S SONGS. songFrom() turns a composed Score
    // into a Create document -- a playable gb and the code that opens it in the
    // editor -- without the editor being open, so the radio can play documents
    // and "edit this" is the same song rather than an approximation of it.
    songFrom: songFrom,
    songOf: songOf,
    moodSong: moodSong,
    // THE AGENT SURFACE, and the only two things it needs from in here: a
    // document as plain state, and plain state back as a document. src/api.js
    // builds the readable JSON on top of these so an agent edits named lanes
    // and note names rather than a 10,000-character packed string. Copies in
    // and out, so nothing an agent hands us can alias the editor's live state.
    docState: function (code) {
      var st = decode(String(code || ''));
      return st ? JSON.parse(JSON.stringify(st)) : null;
    },
    docFromState: function (state) {
      var out = null;
      try {
        withState(JSON.parse(JSON.stringify(state)), function () { out = encode(); });
      } catch (e) { out = null; }
      return out;
    },
    // EVERY INTEGER, because that is what LSDj plays. This used to return eight
    // values -- the tempi whose rows divide evenly into whole frames -- and call
    // them the ladder the machine imposes. Measuring the real ROM showed LSDj
    // accumulates instead, spending the remainder as a mix of two frame counts,
    // so it reaches all of them. The eight were ours, not the machine's.
    tempos: function (grid) {
      var out = [];
      for (var b = 70; b <= 180; b++) out.push(b);
      return out;
    },
    // The groove a tempo resolves to, in LSDJ TICKS: how long each row lasts.
    grooveOf: function (bpm, swing, grid) {
      grid = GRIDS.indexOf(grid | 0) >= 0 ? (grid | 0) : 16;
      return G.CT_GB.lsdjGrooveTicks(swing ? 1 : 0, grid).slice();
    },
    // the tables an agent has to obey, read off the same constants the editor uses
    tables: function () {
      return {
        lanes: CH.map(function (c, i) { return { index: i, name: c.n, stamp: c.stamp }; }),
        drums: DRUMS.map(function (d) { return d.id; }),
        stamps: STAMPS.map(function (s) { return { id: s.id, channel: s.ch }; }),
        grids: GRIDS.slice(),
        melodicRows: MEL_ROWS, drumLanes: DRUM_LANES
      };
    },
    openBlank: openBlank,
    moods: function () { return CHIPS.slice(); },
    _dbg: function () {
      var mx = 0, withInst = 0, hist = [0, 0, 0, 0];
      if (S) S.cells.forEach(function (x) { if ((x.len || 1) > mx) mx = x.len || 1; if (x.inst != null) withInst++;
                                            try { hist[chOfCell(x)]++; } catch (e) {} });
      return { playing: playing, catch: Math.round(camCatch), live: !!liveScore, bars: S ? S.bars : 0,
               viewBar: viewBar, viewCh: viewCh, loopBar: loopBar, queued: queuedBar,
               follow: camFollow, camX: Math.round(camX), cells: S ? S.cells.length : 0, withInst: withInst, maxLen: mx,
               notes: S ? buildSong().notes.length : 0, chHist: hist, mood: liveMood,
               romBytes: romBytes,
               auto: S ? buildSong().auto.length : 0,
               waveLoads: S ? buildSong().waveLoads.length : 0 }; },
    _score: function () {                   // the exact song the chip is given
      var g = buildSong();
      return { notes: g.notes, auto: g.auto, vibOff: g.vibOff, waveLoads: g.waveLoads, kit: g.kit,
               totalFrames: g.totalFrames, loopFrames: g.loopFrames,
               instruments: g.bank.instruments, waveTables: g.bank.waveTables }; },
    _rec: function () {                     // what the selected note tells the chip
      var x = selCell(); if (!x) return null;
      var ch = chOfCell(x);
      return { ch: ch, params: paramsOf(x, ch), rec: recordFor(paramsOf(x, ch), ch), inst: instOf(x, ch) }; },
    _source: function () { return lastComposed; },
    _importDrop: function () { return importDrop; },
    _skipToEnd: function () { if (playing && liveScore) playT0 = performance.now() - songMs() - 300; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CT_CREATE;
})(typeof globalThis !== 'undefined' ? globalThis : window);
