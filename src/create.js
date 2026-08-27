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

  var FPS = 59.7275;
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
  var PULSE_FAM = { '0.5': 'Square', '0.25': 'Reed', '0.125': 'Bell', '0.75': 'Reed' };
  var FAM_ORDER = ['Square', 'Reed', 'Bell'];
  // 'Ghost' (a quiet flat tone) is missing on purpose: it measured identical
  // to Hold, differing only in level, which the Volume control already does.
  var CHAR_ORDER = ['Pluck', 'Stab', 'Decay', 'Fade', 'Long', 'Hold', 'Tap', 'Quiet', 'Swell', 'Bloom'];
  function pulseChar(rec) {
    var v0 = (rec[1] >> 4) & 15, pace = rec[1] & 7, dir = (rec[1] >> 3) & 1;
    if (dir) return pace <= 2 ? 'Swell' : 'Bloom';
    if (pace === 0) return v0 >= 12 ? 'Hold' : 'Ghost';
    if (pace === 1) return v0 >= 12 ? 'Pluck' : 'Tap';
    if (pace === 2) return v0 >= 12 ? 'Stab' : 'Quiet';
    if (pace === 3) return 'Decay';
    return pace <= 5 ? 'Fade' : 'Long';
  }
  // the wave tables, roundest first, and the noise patches, brightest first.
  // A null is a MEASURED duplicate: see docs/HANDOFF.md.
  var WAVE_NAMES = ['Round', null, 'Cello', 'Vox', 'Wood', 'Reed', 'Thin', 'Saw',
                    'Growl', 'Ring', 'Chime', 'Glass', 'Metal', 'Buzz', 'Edge', 'Grit'];
  var NOISE_NAMES = ['Tick', 'Hat', null, 'Shaker', 'Wash', 'Snap', 'Snare', 'Sizzle', 'Tom', 'Rumble', 'Kick',
                     'Brush', 'Clap', 'Rim', 'Crash', 'Thud', 'Boom', 'Drop', 'Roar', 'Wind'];
  var METAL_NAMES = ['Ping', 'Zap', 'Bleep', null, 'Clonk'];
  var LANE_SOUND = ['Square Pluck', 'Bell Pluck', 'Wood', null];   // what each lane starts on
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
    // the row defaults are the named ones, so height and sound agree
    SNDS.noise.forEach(function (sd) {
      if (sd.n === 'Hat') INSTOF.hat = sd.inst;
      if (sd.n === 'Snare') INSTOF.snare = sd.inst;
      if (sd.n === 'Kick') INSTOF.kick = sd.inst;
    });
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
    SNDS = { pulse: [], wave: [], noise: [] };
    // pulse: family x character, in a fixed order so the panel is a grid
    var seenName = {}, byFam = {};
    meta.forEach(function (m) {
      if (m.type !== 'pulse') return;
      var fam = PULSE_FAM[String(m.patch.duty)];
      if (!fam) return;
      var ch2 = pulseChar(BANK.instruments[m.index]);
      var key = fam + ' ' + ch2;
      if (seenName[key]) return;              // first patch wins the name
      seenName[key] = 1;
      (byFam[fam] = byFam[fam] || {})[ch2] = m.index;
    });
    FAM_ORDER.forEach(function (fam) {
      CHAR_ORDER.forEach(function (ch2) {
        var ix = byFam[fam] && byFam[fam][ch2];
        if (ix != null) SNDS.pulse.push({ n: ch2, fam: fam, full: fam + ' ' + ch2, inst: ix });
      });
    });
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
    // noise: the chip has two noise modes. 15-bit is the drum family, ordered
    // bright hiss to low boom; 7-bit is the metallic one, which the corpus
    // never asked for at all.
    function order(list, names, fam) {
      list.slice().sort(function (a, b) {
        var d = (a.patch.clockShift || 0) - (b.patch.clockShift || 0);
        if (d) return d;
        d = (a.patch.period || 0) - (b.patch.period || 0);
        if (d) return d;
        return ENV_ORDER.indexOf(envClass(BANK.instruments[a.index])) -
               ENV_ORDER.indexOf(envClass(BANK.instruments[b.index]));
      }).forEach(function (m, i) {
        if (!names[i]) return;
        var sh = m.patch.clockShift || 0;
        SNDS.noise.push({ n: names[i], fam: fam, full: names[i], inst: m.index, row: sh <= 1 ? 0 : sh <= 4 ? 1 : 2 });
      });
    }
    var ns = meta.filter(function (m) { return m.type === 'noise'; });
    order(ns.filter(function (m) { return m.patch.mode !== 7; }), NOISE_NAMES, 'Drums');
    order(ns.filter(function (m) { return m.patch.mode === 7; }), METAL_NAMES, 'Metal');
  }
  // ---- state ---------------------------------------------------------------
  var S = null, undoStack = [], redoStack = [];
  function freshState() {
    return { key: 0, minor: 0, bars: 4, bpm: 128, swing: 0,
             cells: [], cur: 'piano', cmd: 0, wob: 0 };
  }
  function cols() { return S.bars * 16; }
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
  function framesPer16() { return (60 / S.bpm / 4) * FPS; }
  function colFrame(c) {
    var f = c * framesPer16();
    if (S.swing && (c % 4) >= 2) f += 0.28 * framesPer16();   // swung eighth pair
    return Math.round(f);
  }
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
  function buildSong() {
    resolveBank();
    var notes = [], per = framesPer16();
    var byCol = {};
    S.cells.forEach(function (x) { delete x.x; delete x.rch; (byCol[x.c] = byCol[x.c] || []).push(x); });
    for (var c = 0; c < cols(); c++) {
      var here = byCol[c] || [];
      var slots = [false, false], wave = false, drum = false;
      here.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
      here.forEach(function (x) {
        if (x.vel === 0) { x.rch = x.r >= MEL_ROWS ? 3 : x.rch; return; }   // volume zero: a rest that keeps its place
        if (x.r >= MEL_ROWS) {                              // drum lane
          var d = DRUMS[x.r - MEL_ROWS];
          if (drum) { x.x = 1; return; }
          drum = true; x.rch = 3;
          var dInst = x.inst != null ? x.inst : INSTOF[d.id];
          var dVel = x.vel != null ? x.vel : d.vel;
          if (x.g) {                                        // drum ratchet
            var dHit = Math.max(2, Math.round(per / 2));
            for (var df = 0; df < per * (x.len || 1) - 1; df += dHit)
              notes.push({ ch: 3, frame: colFrame(c) + df, frames: Math.max(2, dHit - 1),
                           midi: null, inst: dInst, vel: dVel, pri: 9 - d.lane });
          } else if (x.f) {                                 // drum echo
            var dv = dVel;
            for (var ds = 0; ds < Math.max(2, x.len || 4) && c + ds < cols(); ds++, dv *= 0.55)
              notes.push({ ch: 3, frame: colFrame(c + ds), frames: Math.max(2, Math.round(per * 0.5)),
                           midi: null, inst: dInst, vel: dv, pri: 9 - d.lane });
          } else {
            notes.push({ ch: 3, frame: colFrame(c),
                         frames: x.len ? Math.max(2, Math.round(per * x.len) - 1) : Math.max(2, Math.round(per * 0.6)),
                         midi: null, inst: dInst, vel: dVel, pri: 9 - d.lane });
          }
          return;
        }
        var voice = cellVoice(x);
        if (!voice || voice === 'noise') { x.x = 1; return; }
        var steps = x.len ? x.len : (x.w ? 8 : 0.96);
        var totalF = Math.max(2, Math.round(per * steps) - 1);
        var note = { frame: colFrame(c), frames: totalF,
                     midi: x.midi != null ? x.midi : rowMidi(x.r),
                     inst: x.inst != null ? x.inst : INSTOF[x.st],
                     vel: x.vel != null ? x.vel : 0.8, pri: 5 };
        if (voice === 'wave') {
          if (wave) { x.x = 1; return; }
          wave = true; note.ch = 2; x.rch = 2;
        } else {
          // an exact channel claims its slot first, then the other pulse;
          // slides want channel 1's sweep unit; the rest take what is free
          var wantCh = (x.ch === 0 || x.ch === 1) ? x.ch
                     : (x.z || x.u || x.sweep != null) ? 0 : (slots[0] ? 1 : 0);
          var ch = !slots[wantCh] ? wantCh : !slots[1 - wantCh] ? 1 - wantCh : -1;
          if (ch < 0) { x.x = 1; return; }
          slots[ch] = true; note.ch = ch; x.rch = ch;
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
      });
    }
    notes.sort(function (a, b) { return a.frame - b.frame; });
    var total = Math.round(cols() * per);
    return { notes: notes, bank: BANK, totalFrames: total,
             loopFrames: total };
  }

  // ---- serialize: the song IS the URL --------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var CODE_CMD = { 1: 'u', 2: 'q', 3: 'g', 4: 'f' };
  // v6: cells carry an extension with the exact instrument, pitch, length,
  // velocity, channel and sweep whenever any of them exists. bpm rides as
  // (bpm-70)/2. All older versions still decode.
  function encode() {
    var ids = STAMPS.map(function (s) { return s.id; });
    var out = [6, S.key, S.minor, S.bars, Math.round((S.bpm - 70) / 2) & 63, S.swing];
    S.cells.forEach(function (x) {
      var st = x.r >= MEL_ROWS ? 15 : (x.st && x.st.charAt(0) === 'i' ? 14 : Math.max(0, ids.indexOf(x.st)));
      var ext = x.inst != null || x.vel != null || x.midi != null || (x.len || 1) > 1 || x.sweep != null || x.ch != null;
      var cmd = x.u ? 1 : x.q ? 2 : x.g ? 3 : x.f ? 4 : 0;
      out.push(x.c & 63, (x.c >> 6) & 63, x.r | (x.z ? 32 : 0), st | (x.w ? 16 : 0) | (ext ? 32 : 0), cmd);
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
    });
    return out.map(function (v) { return B64[v & 63]; }).join('');
  }
  function decode(str) {
    try {
      var v = []; for (var i = 0; i < str.length; i++) { var ix = B64.indexOf(str[i]); if (ix < 0) return null; v.push(ix); }
      var ver = v[0];
      if (ver < 1 || ver > 6) return null;
      var st2 = freshState();
      st2.key = v[1] % 12; st2.minor = v[2] & 1;
      st2.bars = ver === 1 ? ([2, 4, 8].indexOf(v[3]) >= 0 ? v[3] : 4)
                           : Math.max(1, Math.min(48, v[3]));
      st2.bpm = Math.max(70, Math.min(180, ver >= 5 ? 70 + v[4] * 2 : v[4] * 2)); st2.swing = v[5] & 1;
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
        var k = 6;
        while (k + 3 < v.length + 1) {
          var c2 = v[k] | (v[k + 1] << 6), r2 = v[k + 2] & 31, b2 = v[k + 3];
          var cell2 = { c: c2, r: r2, t: k };
          var stc = b2 & 15;
          if (r2 < MEL_ROWS) { if (stc !== 14) cell2.st = ids[stc] || 'piano'; if (v[k + 2] & 32) cell2.z = 1; if (b2 & 16) cell2.w = 1; }
          k += 4;
          if (ver >= 4) {   // v4+: one command char per cell
            var cc = CODE_CMD[v[k] & 7];
            if (cc && r2 < MEL_ROWS + DRUM_LANES) cell2[cc] = 1;
            k += 1;
          }
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
          st2.cells.push(cell2);
        }
      }
      st2.cells = st2.cells.filter(function (x) { return x.c < st2.bars * 16; });
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
  function barFrames() { return 16 * FPS * 60 / (curBpm() * 4); }
  function songMs() {
    if (loopBar >= 0) return (barFrames() / FPS) * 1000;
    return liveScore ? (liveScore.totalFrames / FPS) * 1000
                     : cols() * (60 / S.bpm / 4) * 1000;
  }
  function sliceForBar(song, b) {
    var bf = barFrames(), f0 = Math.round(b * bf), f1 = Math.round((b + 1) * bf);
    var notes = [];
    song.notes.forEach(function (n) {
      if (n.frame < f0 || n.frame >= f1) return;
      var m = { ch: n.ch, frame: n.frame - f0, frames: Math.min(n.frames, f1 - n.frame),
                midi: n.midi, inst: n.inst, vel: n.vel, pri: n.pri };
      if (n.sweep) m.sweep = n.sweep;
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
    tourAdvance(2);
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
    var song = currentSong();
    var pos = song.loopFrames > 0
      ? Math.round(((performance.now() - playT0) / 1000) * FPS) % song.loopFrames : 0;
    if (typeof Audio !== 'undefined' && Audio.playCreate) Audio.playCreate(song, song.loopFrames, pos);
  }
  // A page that just loaded has no user gesture yet, so the browser keeps the
  // audio context suspended. Claiming to play then would be a lie: the
  // playhead would sweep in silence. Wait for the first touch instead.
  var gestured = false, wantStart = false;
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
    if (!gestured) {                       // nothing can sound yet: stay honest
      wantStart = true; pausedAt = Math.max(0, fromMs || 0);
      playing = false;
      armGesture();
      renderTransport(); renderBars();
      return;
    }
    var song = currentSong();
    var off = Math.max(0, fromMs || 0) % Math.max(1, songMs());
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
    armChip();
    playing = false;
    renderTransport(); renderBars(); updatePh(-1);
  }
  function togglePlay() { if (!root) return; playing ? pausePlayback() : startPlayback(pausedAt); }
  // A silent host song keeps the chip's sequencer alive while the editor is
  // open, so placement pokes are audible before (and between) plays.
  function armChip() {
    resolveBank();
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate({ notes: [], bank: BANK, totalFrames: 0x7fffffff }, 0);
  }

  // ---- moods: words -> the composer's own dials ----------------------------
  var MAJ_MODES = { ionian: 1, mixolydian: 1, lydian: 1, 'pent-major': 1 };
  var MOOD = {
    happy: { mode: 'maj', bpmMin: 110 }, cheerful: { mode: 'maj', bpmMin: 110 }, joyful: { mode: 'maj', bpmMin: 110 },
    sunny: { mode: 'maj', bpmMin: 104 }, bright: { mode: 'maj', bpmMin: 104 }, fun: { mode: 'maj', bpmMin: 110 },
    sad: { mode: 'min' }, melancholy: { mode: 'min' }, blue: { mode: 'min' },
    gloomy: { mode: 'min' }, lonely: { mode: 'min' }, moody: { mode: 'min' },
    dark: { mode: 'min', styles: ['techno', 'dnb', 'funk', 'boombap'] },
    spooky: { mode: 'min', styles: ['techno', 'funk', 'boombap', 'ballad'] },
    creepy: { mode: 'min', styles: ['techno', 'funk', 'boombap', 'ballad'] },
    scary: { mode: 'min', styles: ['techno', 'dnb', 'punk'] },
    haunted: { mode: 'min', styles: ['ballad', 'drone', 'techno'] },
    fast: { bpmMin: 145 }, quick: { bpmMin: 145 }, hyper: { bpmMin: 155 },
    frantic: { bpmMin: 155 }, racing: { bpmMin: 150 }, speedy: { bpmMin: 150 },
    slow: { bpmMax: 100 }, lazy: { bpmMax: 100 }, sleepy: { bpmMax: 92 },
    upbeat: { bpmMin: 124, mode: 'maj' }, energetic: { bpmMin: 132 },
    party: { styles: ['house', 'trance', 'anthem'] },
    dance: { styles: ['house', 'trance', 'anthem', 'techno'] },
    bouncy: { styles: ['house', 'breaks', 'funk'] },
    chill: { styles: ['chill', 'ballad'] }, calm: { styles: ['chill', 'ballad', 'drone'] },
    relaxed: { styles: ['chill', 'ballad'] }, mellow: { styles: ['chill', 'ballad'] },
    peaceful: { styles: ['chill', 'ballad', 'drone'] }, cozy: { styles: ['chill', 'boombap'] },
    dreamy: { styles: ['drone', 'ballad', 'trance'] }, ambient: { styles: ['drone'] },
    floaty: { styles: ['drone', 'trance'] },
    epic: { styles: ['anthem'] }, heroic: { styles: ['anthem'], mode: 'maj' },
    triumphant: { styles: ['anthem'], mode: 'maj' },
    retro: { styles: ['arcade'] }, arcade: { styles: ['arcade'] }, game: { styles: ['arcade'] },
    rock: { styles: ['rock', 'punk'] }, punk: { styles: ['punk'] }, metal: { styles: ['punk', 'rock'] },
    funky: { styles: ['funk', 'boombap'] }, groovy: { styles: ['funk', 'house', 'boombap'] },
    swing: { styles: ['funk', 'boombap', 'house', 'breaks'] },
    jazzy: { styles: ['funk', 'boombap', 'chill'], mode: 'min' },
    battle: { styles: ['dnb', 'punk', 'techno'], mode: 'min' },
    boss: { styles: ['dnb', 'techno', 'punk'], mode: 'min' },
    intense: { bpmMin: 140, mode: 'min' },
    house: { styles: ['house'] }, trance: { styles: ['trance'] }, techno: { styles: ['techno'] },
    dnb: { styles: ['dnb'] }, drum: { styles: ['dnb'] }, breaks: { styles: ['breaks'] },
    anthem: { styles: ['anthem'] }, boombap: { styles: ['boombap'] }, hiphop: { styles: ['boombap'] },
    ballad: { styles: ['ballad'] }, drone: { styles: ['drone'] }, funk: { styles: ['funk'] }
  };
  function parseMood(text) {
    var want = { styles: null, mode: null, bpmMin: 0, bpmMax: 999 };
    String(text || '').toLowerCase().split(/[^a-z]+/).forEach(function (w) {
      var m = MOOD[w]; if (!m) return;
      if (m.mode) want.mode = m.mode;
      if (m.bpmMin) want.bpmMin = Math.max(want.bpmMin, m.bpmMin);
      if (m.bpmMax) want.bpmMax = Math.min(want.bpmMax, m.bpmMax);
      if (m.styles) {
        if (!want.styles) want.styles = m.styles.slice();
        else {
          var both = want.styles.filter(function (x) { return m.styles.indexOf(x) >= 0; });
          want.styles = both.length ? both : want.styles.concat(m.styles);
        }
      }
    });
    return want;
  }
  function scoreMatches(sc, want) {
    var n = 0, total = 0;
    if (want.styles) { total++; if (want.styles.indexOf(sc.style) >= 0) n++; }
    if (want.mode) { total++;
      var mn = (sc.tracker && sc.tracker.mode) || '';
      if ((want.mode === 'maj') === !!MAJ_MODES[mn]) n++; }
    if (want.bpmMin > 0 || want.bpmMax < 999) { total++;
      if (sc.bpm >= want.bpmMin && sc.bpm <= want.bpmMax) n++; }
    return { hit: n, total: total };
  }

  // The dice and the mood box compose a REAL track: the same composer the
  // radio uses, a seed search over its declared parameters, and the whole
  // score projected onto the grid as exact, editable notes. It plays
  // verbatim (its own bank, every instrument) until the first hand edit.
  function composeIntoGrid(moodText, auto) {
    var C = (G.CT_COMPOSERS && G.CT_COMPOSERS.rrr_core) || null;
    if (!C || typeof C.compile !== 'function') return;
    if (!auto) tourAdvance(3);
    if (auto) dropLiveScore(); else snapshot();
    resolveBank();
    var want = parseMood(moodText);
    var score = null, bestScore = null, bestHit = -1;
    for (var trial = 0; trial < 140; trial++) {
      var cand = null;
      try { cand = C.compile('create-' + Math.random().toString(36).slice(2, 10)); } catch (e) { break; }
      if (!cand || !cand.gb || !cand.gb.notes || !cand.gb.notes.length) continue;
      var m = scoreMatches(cand, want);
      if (m.hit > bestHit) { bestHit = m.hit; bestScore = cand; }
      if (m.hit >= m.total) { score = cand; break; }
    }
    if (!score) score = bestScore;
    var gb = score && score.gb;
    if (!gb || !gb.notes || !gb.notes.length) return;
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
    S.key = 0; S.minor = scl.indexOf(3) >= 0 ? 1 : 0; S.bars = Math.max(1, Math.min(48, Math.ceil((gb.totalFrames || winF) / (16 * per16f))));
    S.bpm = Math.max(70, Math.min(180, Math.round((score.bpm || 120) / 2) * 2));
    var bv0 = root && root.querySelector('.n-bpmval');
    if (bv0) { bv0.textContent = S.bpm; var sl0 = root.querySelector('[data-cr="bpm"]'); if (sl0) sl0.value = S.bpm; }
    S.cells = []; order = 0;
    var sorted = gb.notes.slice().sort(function (a, b) { return a.frame - b.frame || (b.pri || 0) - (a.pri || 0); });
    var LANE = { 9: 2, 7: 1, 3: 0 };           // kick / snare / hat, by note priority
    var budget = {}, seen = {};
    // A crowded 16th used to throw its extra notes away. Now an overflow note
    // slides to the next free step for its voice (a chord becomes a quick
    // strum, two drums become a flam) and only vanishes if there is no room
    // within a step or two.
    sorted.forEach(function (n) {
      var c0 = Math.round(n.frame / per16f);
      if (c0 < 0 || c0 >= cols()) return;
      var ch = n.ch | 0;
      if (ch !== 3 && !(n.midi > 0)) return;   // a melodic note with no pitch is not a note
      var row = ch === 3 ? MEL_ROWS + (LANE[n.pri | 0] != null ? LANE[n.pri | 0] : 0)
                         : MEL_ROWS - 1 - degOf(n.midi | 0);
      var maxPush = ch === 3 ? 1 : 2;
      var c = -1;
      for (var k = 0; k <= maxPush; k++) {
        var cc = c0 + k;
        if (cc >= cols()) break;
        var bd = budget[cc] = budget[cc] || { p: 0, w: 0, d: 0 };
        var room = ch === 3 ? !bd.d : ch === 2 ? !bd.w : bd.p < 2;
        if (room && !seen[cc + ':' + row]) { c = cc; break; }
      }
      if (c < 0) return;                        // genuinely nowhere to put it
      var bd2 = budget[c];
      if (ch === 3) bd2.d = 1; else if (ch === 2) bd2.w = 1; else bd2.p++;
      seen[c + ':' + row] = 1;
      var cell = { c: c, r: row, t: ++order, inst: n.inst, vel: n.vel != null ? n.vel : 0.8 };
      if (ch !== 3) {
        cell.midi = n.midi | 0;
        var ln = Math.max(1, Math.round(n.frames / per16f));
        if (ln > 1) cell.len = ln;
        if (ch === 2) cell.st = waveStamp;
        else {
          cell.ch = ch;
          cell.st = stampFor[ch] || 'piano';
          if (n.sweep) { cell.sweep = n.sweep; cell.z = 1; }
        }
      }
      S.cells.push(cell);
    });
    var capF = Math.round(S.bars * 16 * per16f);      // the verbatim score clips to the same 48 bars
    liveScore = { notes: gb.notes.filter(function (n) { return n.frame < capF; }),
                  bank: gb.bank, totalFrames: Math.min(gb.totalFrames, capF), loopFrames: 0 };
    liveBpm = score.bpm || S.bpm;
    liveMood = String(moodText || '');
    try { buildSong(); } catch (e) {}          // resolve channel marks
    loopBar = -1; queuedBar = null;
    viewBar = 0; camX = 0; camFollow = true; camCatch = 0; selCol = -1; selCh = -1;
    if (root.querySelector('.n-track')) { buildTrack(); }
    pausedAt = 0;
    dirty();
    startPlayback(0);   // after dirty: its clearTimeout cancels the queued repost,
                        // which used to seek past the song's first notes
  }

  // ---- the sound map: pick a channel's instrument by dragging --------------
  var chInst = [null, null, null, null], sndCh = -1;
  // The lane's own sound: what the NEXT note placed there will use. This used
  // to be a long-press on the lane name opening a scatter pad of unnamed dots
  // -- nobody found it, and nobody could read it when they did.
  function openSnd(ch) {
    closeSnd(); closePick();
    selCol = -1; selCh = -1; pen.ch = ch;
    if (ch === 3) { hint('Drums pick their sound by height: high for hat, middle for snare, low for kick.'); return; }
    var el = document.createElement('div');
    el.className = 'n-pick n-sndpop';
    el.innerHTML = '<div class="n-pickhead"><span>' + CH[ch].n + ' sound</span>' +
      '<button type="button" class="n-pclose" data-sndclose="1" title="Close">\u00d7</button></div>' +
      '<div class="n-pickrow n-pisnd" style="--vc:' + CH[ch].color + '">' + soundBtns(ch, null) + '</div>' +
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
    var score = { gb: { notes: song.notes, bank: song.bank, totalFrames: song.totalFrames, fps: FPS } };
    try {
      var rom = G.CT_GB_ROM.buildRom(score, { title: 'MY CREATION' });
      _saveBlob(new Blob([rom], { type: 'application/octet-stream' }), 'my-creation.gb');
      if (G._toast) G._toast('Downloaded my-creation.gb. It boots on a real Game Boy 🎮');
    } catch (e) { if (G._toast) G._toast('ROM export failed: ' + (e && e.message || e)); }
  }
  function exportWav() {
    var song = liveScore || buildSong(), sr = 44100;
    try {
      var pcm = G.CT_GB_APU.render({ notes: song.notes, bank: song.bank, totalFrames: song.totalFrames }, sr);
      _saveBlob(_pcmToWav(pcm, sr), 'my-creation.wav');
      if (G._toast) G._toast('Downloaded my-creation.wav');
    } catch (e) { if (G._toast) G._toast('WAV export failed: ' + (e && e.message || e)); }
  }

  // ---- hints + tour --------------------------------------------------------
  var hintTimer = 0, hintedSulk = false;
  var HINT_IDLE = 'Tap an empty square to place the note shown below; tap a note to hear it and change it.';
  function hint(t) { if (t && G._toast && /(muted|limit|Nothing)/.test(t)) G._toast(t); }
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
      ['This song was just written for you.', 'Notes are blocks on their line: further right is later, higher is a higher note, wider is longer. Tap one to change it, or tap empty space to add one.'],
      ['Four voices, like a tiny band.', 'Melody, Harmony, Bass and Drums each get their own line, running left to right. Tap a line\u2019s speaker to mute it.'],
      ['The song scrolls sideways.', 'Drag the lines to travel through the song, or let them follow the music. The bar you are on is named at the bottom, with its own buttons.'],
      ['Moods write songs.', 'Tap a mood up top and the radio\u2019s composer writes a whole song here, yours to edit.'],
    ];
    t.innerHTML = '<b>' + msgs[step][0] + '</b><span>' + msgs[step][1] + '</span>' +
      '<div class="cr-tourbtns"><button type="button" data-tour="skip">Skip</button>' +
      '<button type="button" data-tour="next">' + (step === 3 ? 'Done' : 'Next') + '</button></div>' +
      '<i>' + (step + 1) + ' / 4</i>';
    var anchor = [root.querySelector('.n-grid'), root.querySelector('.n-chans'),
                  root.querySelector('.n-bars'), root.querySelector('.n-moodrow')][step];
    var ar = (anchor || root).getBoundingClientRect();
    t.style.transform = 'translateX(-50%)';
    t.style.left = '50%';
    if (step === 0) t.style.top = Math.round(ar.top + ar.height * 0.3) + 'px';
    else t.style.top = Math.round(Math.max(10, ar.top - 130)) + 'px';
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
    var vel = cell.vel != null ? cell.vel : (cell.r >= MEL_ROWS ? DRUMS[cell.r - MEL_ROWS].vel : 0.8);
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
                           frames: h.f, midi: drum ? null : h.midi, inst: inst, vel: h.vel });
      }, Math.round(h.at * ms)));
    });
    return true;
  }
  function auditionCell(cell, maxFrames) {
    resolveBank();
    if (typeof Audio === 'undefined' || !Audio.pokeCreate) return 1;
    var per = framesPer16();
    // a drag auditions many times a second: no sequences there
    if (maxFrames == null && previewMotion(cell, null, per))
      return cell.r >= MEL_ROWS ? 3 : (cellVoice(cell) === 'wave' ? 2 : 1);
    if (cell.r >= MEL_ROWS) {
      var d = DRUMS[cell.r - MEL_ROWS];
      Audio.pokeCreate({ ch: 3, frames: Math.round(per), midi: null,
                         inst: cell.inst != null ? cell.inst : INSTOF[d.id],
                         vel: cell.vel != null ? cell.vel : d.vel });
      return 3;
    }
    var voice = cellVoice(cell) || 'pulse';
    var heldSteps = Math.max(1, cell.len || 1);            // hear it for as long as it lasts
    var frames = Math.min(maxFrames || 600, Math.round(per * heldSteps));
    Audio.pokeCreate({ ch: voice === 'wave' ? 2 : 1, frames: frames,
                       midi: cell.midi != null ? cell.midi : rowMidi(cell.r),
                       inst: cell.inst != null ? cell.inst : INSTOF[cell.st],
                       vel: cell.vel != null ? cell.vel : 0.8,
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
  function chanIcon(ch) {
    resolveBank();
    var inst = ch === 3 ? -1 : (chInst[ch] != null ? chInst[ch] : INSTOF[CH[ch].stamp]);
    var key = ch + ':' + inst;
    if (chanIconCache[key]) return chanIconCache[key];
    var cv = document.createElement('canvas');
    cv.__ctpalRaw = true; cv.width = 30; cv.height = 14;
    var c = cv.getContext('2d');
    c.strokeStyle = c.fillStyle = CH[ch].color;
    c.lineWidth = 1.6; c.lineJoin = 'round';
    var m = null;
    for (var i = 0; i < BANK.meta.length; i++) if (BANK.meta[i].index === inst) m = BANK.meta[i];
    if (ch === 3) {
      for (var nx = 0; nx < 5; nx++) {
        var bh = (((nx * 17 + 5) % 9) / 9) * 9 + 3;
        c.fillRect(2 + nx * 6, 13 - bh, 3, bh);
      }
    } else if (m && m.type === 'wave') {
      var t = BANK.waveTables[m.waveSlot] || [];
      c.beginPath();
      for (var x = 0; x < 32; x++) {
        var vx = 1 + (x / 31) * 28, vy = 1 + (1 - (t[x] || 0) / 15) * 12;
        x ? c.lineTo(vx, vy) : c.moveTo(vx, vy);
      }
      c.stroke();
    } else {
      var duty = (m && m.patch && m.patch.duty) || 0.5;
      c.beginPath();
      var half = 14;
      for (var p2 = 0; p2 < 2; p2++) {
        var x0 = 1 + p2 * half, hi = half * duty;
        c.moveTo(x0, 12); c.lineTo(x0, 2); c.lineTo(x0 + hi, 2);
        c.lineTo(x0 + hi, 12); c.lineTo(x0 + half, 12);
      }
      c.stroke();
    }
    chanIconCache[key] = cv;
    return cv;
  }
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
      b.classList.toggle('waiting', !playing && wantStart);
    }
  }
  // the four lanes name themselves down the left edge and carry their mute
  function renderChans() {
    renderFollow();
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
        html += '<span class="n-rbar" data-bar="' + b2 + '" style="left:' + (b2 * 16 * stepW) + 'px;width:' + (16 * stepW) + 'px">' +
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
      hl.style.left = (viewBar * 16 * stepW) + 'px';
      hl.style.width = (16 * stepW) + 'px';
    }
    applyCam();
  }
  // notes are drawn as blocks on their lane: as wide as they are long
  function renderGrid() {
    if (!root) return;
    var em = effMask();
    for (var ch = 0; ch < 4; ch++) {
      var row = root.querySelector('.n-row[data-ch="' + ch + '"]');
      if (!row) continue;
      row.classList.toggle('off', !!em[ch]);
      var html = '';
      S.cells.forEach(function (x) {
        if (chOfCell(x) !== ch) return;
        var len = Math.max(1, x.len || 1);
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
        html += '<i class="n-note' + (x.x ? ' sulk' : '') + (vel === 0 ? ' rest' : '') +
                (mn ? ' fx' : '') + (selCol === x.c && selCh === ch ? ' sel' : '') + '"' +
                ' data-col="' + x.c + '" data-ch="' + ch + '" data-inst="' + (x.inst != null ? x.inst : -1) + '"' +
                (mn ? ' data-fx="' + mn + '"' : '') +
                ' style="left:' + (x.c * stepW + 1) + 'px;width:' + (len * stepW - 2) + 'px;' +
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
  function soundsFor(ch) {
    resolveBank();
    if (ch === 3) return SNDS.noise.map(function (sd) {
      return { n: sd.n, fam: sd.fam, full: sd.full, ed: 'nz' + sd.inst, inst: sd.inst, row: sd.row };
    });
    return (ch === 2 ? SNDS.wave : SNDS.pulse).map(function (sd) {
      return { n: sd.n, fam: sd.fam, full: sd.full, ed: 'snd' + sd.inst, inst: sd.inst };
    });
  }
  function laneInst(ch) {
    resolveBank();
    if (chInst[ch] != null) return chInst[ch];
    if (ch === 3) return INSTOF[DRUMS[pen.drum] ? DRUMS[pen.drum].id : 'kick'];
    var want = LANE_SOUND[ch], hit = null;   // the lane starts on a named sound
    (ch === 2 ? SNDS.wave : SNDS.pulse).forEach(function (sd) { if (sd.full === want) hit = sd.inst; });
    return hit != null ? hit : INSTOF[CH[ch].stamp];
  }
  function soundName(ch) {
    if (ch === 3) return 'Kit';
    var want = laneInst(ch), hit = null;
    soundsFor(ch).forEach(function (sd) { if (sd.inst === want) hit = sd.full; });
    return hit || 'Sound';
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
  function motionBtns(ch, x) {
    var cur = motionOf(x);
    return motionsFor(ch).map(function (m) {
      return '<button type="button" class="n-pv' + (m.k === cur ? ' on' : '') +
             '" data-ed="fx' + (m.k || '-') + '">' + m.n + '</button>';
    }).join('');
  }
  function soundBtns(ch, x) {
    var cur = x && x.inst != null ? x.inst
            : ch === 3 && x ? INSTOF[DRUMS[Math.max(0, x.r - MEL_ROWS)].id]
            : laneInst(ch);
    var list = soundsFor(ch), fams = [], byFam = {};
    list.forEach(function (sd) {
      var f = sd.fam || '';
      if (!byFam[f]) { byFam[f] = []; fams.push(f); }
      byFam[f].push(sd);
    });
    return fams.map(function (f) {
      return '<div class="n-pgrp"><i>' + f + '</i><span>' +
        byFam[f].map(function (sd) {
          return '<button type="button" class="n-pv' + (sd.inst === cur ? ' on' : '') +
                 '" data-ed="' + sd.ed + '" data-full="' + sd.full + '">' + sd.n + '</button>';
        }).join('') + '</span></div>';
    }).join('');
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
      '<div class="n-pickhead"><span>' + (ch === 3 ? 'Drum' : 'Sound') + '</span>' +
        '<button type="button" class="n-pclose" data-ed="close" title="Close">\u00d7</button></div>' +
      '<div class="n-pickrow n-pisnd" style="--vc:' + CH[ch].color + '">' + soundBtns(ch, x) + '</div>' +
      '<div class="n-pickhead"><span>Motion</span></div>' +
      '<div class="n-pickrow n-pifx" style="--vc:' + CH[ch].color + '">' + motionBtns(ch, x) + '</div>' +
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
    if (what.slice(0, 2) === 'fx') {          // what the note does while it sounds
      var mk = what.slice(2);
      if (!x) { hint('Pick a note first, then give it a motion.'); return; }
      snapshot();
      MOTION_KEYS.forEach(function (k2) { delete x[k2]; });   // one at a time
      if (mk !== '-') x[mk] = 1;
      dirty(); renderEdit(); auditionCell(x);
      return;
    }
    if (what.slice(0, 2) === 'nz') {          // a drum: sound and height together
      var ni = +what.slice(2), row = 2;
      soundsFor(3).forEach(function (sd) { if (sd.inst === ni && sd.row != null) row = sd.row; });
      pen.drum = row;
      if (x) {
        snapshot();
        x.r = MEL_ROWS + row; x.inst = ni; delete x.midi;
        dirty(); renderEdit(); auditionCell(x);
      } else auditionCell(penCell(0));
      renderChans();
      var npop = root.querySelector('.n-sndpop');
      if (npop) npop.querySelectorAll('.n-pv').forEach(function (bt) {
        bt.classList.toggle('on', bt.dataset.ed === what);
      });
      return;
    }
    if (what.slice(0, 3) === 'snd') {         // a named sound, for this note and the next
      var sch = x ? chOfCell(x) : pen.ch;
      var si = +what.slice(3);
      chInst[sch] = si;
      if (x) { snapshot(); x.inst = si; dirty(); renderEdit(); auditionCell(x); }
      else auditionCell(penCell(0));
      renderChans();
      var pop = root.querySelector('.n-sndpop');      // mark it, do not rebuild it:
      if (pop) pop.querySelectorAll('.n-pv').forEach(function (bt) {   // a rebuilt button is
        bt.classList.toggle('on', bt.dataset.ed === what);             // detached, and a detached
      });                                                              // target reads as "outside"
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
    if (pen.ch === 3) { c.r = MEL_ROWS + pen.drum; c.inst = INSTOF[DRUMS[pen.drum].id]; }
    else {
      c.r = rowForMidi(pen.midi); c.midi = pen.midi;
      c.st = CH[pen.ch].stamp;
      if (pen.ch < 2) c.ch = pen.ch;
      c.inst = laneInstAt(pen.ch, col);
    }
    c.vel = pen.vel;
    if (pen.len > 1) c.len = pen.len;
    return c;
  }
  function selectNote(ch, col) {
    selCh = ch; selCol = col;
    renderGrid(); renderEdit();
  }

  function renderAll() { renderTransport(); renderChans(); renderBars(); renderGrid(); renderEdit(); }
  // the playhead carries a FRACTION of a step, not a whole one: quantising it
  // made the line hop once per sixteenth (nine times a second) instead of
  // sweeping. Transform, so the move stays on the compositor.
  function playCol() {
    if (!playing) return -1;
    var perMs = (60 / curBpm() / 4) * 1000;
    var elapsed = performance.now() - playT0;
    return loopBar >= 0 ? loopBar * 16 + (elapsed / perMs) % 16 : (elapsed / perMs) % cols();
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
      var ph = (elapsed / perMs) % 16;
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
    var col = playCol();
    var pb = Math.floor(col / 16);
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
    for (var s2 = 0; s2 < 16; s2++) {
      var col = b * 16 + s2;
      if (viewCh < 0) { for (var c2 = 0; c2 < 4; c2++) { var j = cellIndexAt(c2, col); if (j >= 0) cellsHere.push(S.cells[j]); } }
      else { var i = cellIndexAt(viewCh, col); if (i >= 0) cellsHere.push(S.cells[i]); }
    }
    if (!cellsHere.length) { hint('Nothing to nudge in bar ' + (b + 1) + '.'); return; }
    snapshot();
    cellsHere.forEach(function (x) { x.c = b * 16 + ((x.c - b * 16 + dir + 16) % 16); });
    selCol = -1; selCh = -1;
    dirty();
  }
  // ---- bar operations ------------------------------------------------------
  function addBar(bar) {
    if (S.bars >= 48) { hint('48 bars is the limit \u2014 that is about a minute and a half.'); return; }
    snapshot();
    if (bar != null) viewBar = bar;
    var at = viewBar * 16;                      // an empty bar opens HERE
    S.cells.forEach(function (x) { if (x.c >= at) x.c += 16; });
    S.bars++;
    buildTrack(); centerOn(viewBar, true);
    dirty(); renderAll();
  }
  function dupBar(b) {
    if (S.bars >= 48) { hint('48 bars is the limit \u2014 remove one to make room.'); return; }
    snapshot();
    var copies = [];
    S.cells.forEach(function (x) {
      if (x.c >= (b + 1) * 16) x.c += 16;
      else if (x.c >= b * 16) {
        var cp = { c: x.c + 16, r: x.r, t: ++order };
        ['st', 'z', 'u', 'q', 'g', 'f', 'w', 'inst', 'midi', 'len', 'vel', 'ch', 'sweep'].forEach(function (k) {
          if (x[k] != null) cp[k] = x[k];
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
    S.cells = S.cells.filter(function (x) { return x.c < b * 16 || x.c >= (b + 1) * 16; });
    if (S.bars > 1) {
      S.cells.forEach(function (x) { if (x.c >= (b + 1) * 16) x.c -= 16; });
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
    } catch (e) {}
    return '';
  }
  var CHIPS = ['happy', 'sad', 'upbeat', 'chill', 'spooky', 'epic', 'retro', 'funky', 'dreamy', 'battle'];
  function buildUI() {
    root.innerHTML =
      '<div class="n-utils">' +
        '<button type="button" class="cr-btn" data-cr="undo">↩ Undo</button>' +
        '<button type="button" class="cr-btn" data-cr="redo">↪ Redo</button>' +
        '<button type="button" class="cr-btn cr-dl" data-cr="wav">' + _ic('wave') + 'Download WAV</button>' +
        '<button type="button" class="cr-btn cr-dl" data-cr="rom">' + _ic('rom') + 'Download ROM</button>' +
        '<button type="button" class="cr-btn cr-close" data-cr="close">Close</button>' +
      '</div>' +
      '<div class="n-moodrow"><span class="n-moodlab">Write me a song that is…</span>' +
        '<span class="n-moodchips">' +
        CHIPS.map(function (c) { return '<button type="button" class="cr-chip" data-mood="' + c + '">' + c + '</button>'; }).join('') +
        '</span></div>' +
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
          '<button type="button" class="n-tbtn n-play" data-cr="play" title="Play / Pause">' + _pb('play') + '</button>' +
        '</div>' +
        '<button type="button" class="n-tfollow' + (camFollow ? ' on' : '') + '" data-cr="follow" ' +
          'title="Keep the view on the music">Follow</button>' +
        '<label class="cr-lab">Speed <b class="n-bpmval">' + S.bpm + '</b> BPM' +
        '<input type="range" min="70" max="180" step="2" value="' + S.bpm + '" data-cr="bpm"></label>' +
      '</div>';
    sizeTrack();
  }
  function buildTrack() { sizeTrack(); renderBars(); renderGrid(); renderChans(); }
  var stepW = 30, laneH = 62, sidePad = 0;
  function sizeTrack() {
    var sc = root.querySelector('.n-scroll');
    if (!sc) return;
    var r = sc.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var narrow = r.width < 520;
    stepW = narrow ? 26 : 34;
    laneH = Math.max(48, Math.floor((r.height - 32) / 4));   // the four lanes fill the room
    sidePad = 0;                               // the song starts at the left edge
    root.style.setProperty('--stepw', stepW + 'px');
    root.style.setProperty('--laneh', laneH + 'px');
    root.style.setProperty('--sidepad', sidePad + 'px');
    root.style.setProperty('--barw', (16 * stepW) + 'px');
    root.style.setProperty('--songw', (cols() * stepW) + 'px');
  }
  function songW() { return cols() * stepW; }
  function camMax() {
    var sc = root.querySelector('.n-scroll');
    var w = sc ? sc.getBoundingClientRect().width : 0;
    return Math.max(0, songW() + sidePad * 2 - w);
  }
  function centerOn(bar, snap) {
    var sc = root.querySelector('.n-scroll');
    var w = sc ? sc.getBoundingClientRect().width : 0;
    var want = Math.max(0, Math.min(camMax(), sidePad + (bar * 16 + 8) * stepW - w / 2));
    camX = snap ? want : camX + (want - camX) * (Math.abs(want - camX) > w ? 1 : 0.18);
    if (snap) camCatch = 0;
  }
  // the camera rides the playhead itself, not the bar it sits in. A target
  // that only moves once a bar makes the track lurch and then stand still for
  // the rest of the bar -- smooth frames, stuttering motion.
  function viewW() {
    var sc = root.querySelector('.n-scroll');
    return sc ? sc.getBoundingClientRect().width : 0;
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
  }
  // Follow: jump to the music and ride along again
  function followNow() {
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
    var track = root.querySelector('.n-track');
    if (track) track.style.transform = 'translate3d(' + (-camX).toFixed(2) + 'px,0,0)';
    // the scrollbar says where in the song you are, and how much of it you see
    var bar = root.querySelector('.n-sbar'), thumb = root.querySelector('.n-sthumb');
    if (bar && thumb) {
      var sc2 = root.querySelector('.n-scroll');
      var view = sc2 ? sc2.getBoundingClientRect().width : 0;
      var total = Math.max(view, songW());
      var bw = bar.getBoundingClientRect().width;
      var tw = Math.max(28, Math.round(bw * view / total));
      var span = Math.max(1, camMax());
      thumb.style.width = tw + 'px';
      thumb.style.left = ((bw - tw) * (camX / span)).toFixed(2) + 'px';
    }
    // the gridlines repeat every bar, so the backdrop only ever needs to move
    // within one bar: a composited nudge instead of a full repaint
    var bg = root.querySelector('.n-bg');
    if (bg) {
      var barPx = 16 * stepW;
      var t = ((sidePad - camX) % barPx + barPx) % barPx;   // keep the bar lines on the bars
      bg.style.transform = 'translate3d(' + (t - barPx).toFixed(2) + 'px,0,0)';
    }
  }
  function barUnderCamera() {
    var sc = root.querySelector('.n-scroll');
    var w = sc ? sc.getBoundingClientRect().width : 0;
    return Math.max(0, Math.min(S.bars - 1, Math.floor((camX + w / 2 - sidePad) / (16 * stepW))));
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
  function laneInstAt(ch, col) {
    // a sound you PICKED for this lane wins: it is the one thing here that was
    // said out loud. Only an unspoken lane copies its neighbours.
    if (chInst[ch] != null) return chInst[ch];
    var best = null, bd = 1e9;
    for (var i = 0; i < S.cells.length; i++) {
      var x = S.cells[i];
      if (x.inst == null || chOfCell(x) !== ch) continue;
      var d = Math.abs(x.c - col);
      if (d < bd) { bd = d; best = x.inst; }
    }
    if (best != null) return best;
    resolveBank();
    return ch === 3 ? INSTOF[DRUMS[pen.drum].id] : INSTOF[CH[ch].stamp];
  }
  // move a note to another voice in place, keeping what it was
  function setCellVoice(x, v) {
    MOTION_KEYS.forEach(function (k) {        // do not carry a motion into a lane that cannot play it
      if (!x[k]) return;
      var ok = false;
      MOTIONS.forEach(function (m) { if (m.k === k && m.ch[v]) ok = true; });
      if (!ok) delete x[k];
    });
    if (v === 3) {
      x.r = MEL_ROWS + pen.drum;
      delete x.midi; delete x.ch; delete x.st; delete x.z; delete x.sweep;
      x.inst = laneInstAt(3, x.c);
    } else {
      if (x.r >= MEL_ROWS) { x.r = rowForMidi(pen.midi); x.midi = pen.midi; }
      x.st = CH[v].stamp;
      if (v < 2) x.ch = v; else delete x.ch;
      x.inst = laneInstAt(v, x.c);
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
      if (dragged || (pan && pan.moved)) return;
      var noteEl = ev.target.closest('.n-note');
      if (noteEl) {
        var nc = +noteEl.dataset.col, nch = +noteEl.dataset.ch;
        viewBar = Math.floor(nc / 16);
        selectNote(nch, nc);
        var i = cellIndexAt(nch, nc);
        if (i >= 0) auditionCell(S.cells[i]);
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
      viewBar = Math.floor(h.col / 16);
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
    var nd = null;
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
      if (mc) { composeIntoGrid(mc.dataset.mood); tourAdvance(3); return; }
      var b = ev.target.closest('[data-cr]');
      if (!b) return;
      var k = b.dataset.cr;
      if (k === 'play') { gestured = true; togglePlay(); }
      else if (k === 'follow') { followNow(); }
      else if (k === 'rewind') { pausedAt = 0; if (playing) startPlayback(0); else { camFollow = true; centerOn(0, true); viewBar = 0; renderBars(); } hint('Back to the start.'); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'wav') { exportWav(); }
      else if (k === 'rom') { exportRom(); }
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
  function open() {
    if (root) { root.classList.add('show'); armChip(); if (!playing) startPlayback(pausedAt); return; }
    var fromUrl = (location.hash.match(/#s=([A-Za-z0-9\-_]+)/) || [])[1];
    S = (fromUrl && decode(fromUrl)) || null;
    if (!S) { try { var d = localStorage.getItem('ct-create-draft'); if (d) S = decode(d); } catch (e) {} }
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
    armChip();
    ownRoute(S.cells.length ? encode() : '');
    pen.midi = rowMidi(lastDeg[0] != null ? MEL_ROWS - 1 - lastDeg[0] : 7);
    hint('');
    // never a blank page, never a dead room: a song is already here, and the
    // transport is already running
    if (!S.cells.length && G.CT_COMPOSERS) {
      var m0 = ['chill', 'happy', 'dreamy', 'funky'][Math.floor(Math.random() * 4)];
      var mi0 = root.querySelector('.cr-mood'); if (mi0) mi0.value = m0;
      composeIntoGrid(m0);
      hint('A ' + m0 + ' song is already rolling. Tap a mood for another, or take the pencil to this one.');
      var toured = false;
      try { toured = !!localStorage.getItem('ct-create-tour'); } catch (e) {}
      if (!toured) setTimeout(function () { if (isOpen()) tourShow(0); }, 1400);
    } else {
      try { buildSong(); } catch (e) {}
      startPlayback(0);
      renderAll();
    }
  }
  function close() {
    if (playing) pausePlayback(); else armChip();
    pausedAt = 0;
    chMuted = [false, false, false, false];    // playScore() clears the chip mask
    loopBar = -1; queuedBar = null;
    closeSnd();
    if (root) root.classList.remove('show');
    document.body.classList.remove('create-open');
    try { history.replaceState(null, '', '/'); } catch (e) {}
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
    _dbg: function () {
      var mx = 0, withInst = 0, hist = [0, 0, 0, 0];
      if (S) S.cells.forEach(function (x) { if ((x.len || 1) > mx) mx = x.len || 1; if (x.inst != null) withInst++;
                                            try { hist[chOfCell(x)]++; } catch (e) {} });
      return { playing: playing, catch: Math.round(camCatch), live: !!liveScore, bars: S ? S.bars : 0,
               viewBar: viewBar, viewCh: viewCh, loopBar: loopBar, queued: queuedBar,
               follow: camFollow, camX: Math.round(camX), cells: S ? S.cells.length : 0, withInst: withInst, maxLen: mx,
               notes: S ? buildSong().notes.length : 0, chHist: hist, mood: liveMood }; },
    _skipToEnd: function () { if (playing && liveScore) playT0 = performance.now() - songMs() - 300; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CT_CREATE;
})(typeof globalThis !== 'undefined' ? globalThis : window);
