// CREATE: place little characters on a grid, hear them through the real chip.
//
// Not an LSDJ clone and never trying to be one: this is the Mario-Paint idea
// rebuilt for the DMG. Rows are scale degrees so everything placed is in key,
// stamps are original pixel critters, and the four hardware voices are a
// visible budget rather than a hidden failure: when a column asks for a third
// pulse, the loser sulks in grey and stays silent.
//
// Everything downstream is the radio's own machinery: the same emulated APU,
// the same 53-instrument bank, the same ROM and WAV exporters. Songs live in
// the URL fragment; nothing here ever feeds the station.
(function (G) {
  'use strict';

  var FPS = 59.7275;
  var MAJOR = [0, 2, 4, 5, 7, 9, 11];
  var MINOR = [0, 2, 3, 5, 7, 8, 10];
  var MEL_ROWS = 15;                        // two octaves + the octave top
  var DRUM_LANES = 3;                       // hat / snare / kick, top to bottom
  var ROWS = MEL_ROWS + DRUM_LANES;

  // ---- the cast ------------------------------------------------------------
  // 10x10 pixel critters, drawn from strings: '.'=clear, letters=palette.
  // 10x10 pixel instruments, drawn from strings: '.'=clear, letters=palette.
  var SPRITES = {
    piano: { pal: { w: '#F2F4F8', k: '#1A1A22', e: '#9AA4B8' }, px: [
      '..........', 'eeeeeeeeee', 'ewkwwkwkwe', 'ewkwwkwkwe', 'ewkwwkwkwe',
      'ewwwwwwwwe', 'ewwwwwwwwe', 'eeeeeeeeee', '..........', '..........'] },
    trumpet: { pal: { y: '#FFD23F', d: '#C99A1E' }, px: [
      '..........', '...y.y.y..', '.........y', 'yyyyyyyyyy', 'dddddddddd',
      '.........y', '..........', '..........', '..........', '..........'] },
    flute: { pal: { s: '#C9D6E8', d: '#8FA0BC', k: '#26303F' }, px: [
      '..........', '..........', '..........', 'ssssssssss', 'ssksskskss',
      'dddddddddd', '..........', '..........', '..........', '..........'] },
    bell: { pal: { g: '#FFC93C', d: '#D99E1B', k: '#241A0E' }, px: [
      '....gg....', '....gg....', '...gggg...', '..gggggg..', '..gggggg..',
      '.gggggggg.', 'gggggggggg', '....kk....', '..........', '..........'] },
    bassg: { pal: { b: '#C0563B', d: '#8A3A26', n: '#B58A4A', k: '#241A0E' }, px: [
      '........n.', '.......n..', '......n...', '.....n....', '....n.....',
      '.bbbn.....', 'bbbbbb....', 'bbkbbb....', '.bbbb.....', '..........'] },
    cello: { pal: { c: '#A8794A', d: '#7A5230', k: '#241A0E', n: '#5C3D1E' }, px: [
      '....n.....', '....n.....', '..ccccc...', '.ccccccc..', '.ckccckc..',
      '.ccccccc..', '.ccccccc..', '..ccccc...', '..........', '..........'] },
    hat: { pal: { y: '#FFD23F', s: '#9AA4B8' }, px: [
      '..........', 'yyyyyyyyyy', '....s.....', 'yyyyyyyyyy', '....s.....',
      '....s.....', '....s.....', '...sss....', '..........', '..........'] },
    snare: { pal: { r: '#FF6B57', w: '#F2F4F8', d: '#C63B2A' }, px: [
      '..........', '..........', 'rrrrrrrrrr', 'wwwwwwwwww', 'wwwwwwwwww',
      'rrrrrrrrrr', '.d......d.', '..........', '..........', '..........'] },
    kick: { pal: { r: '#FF6B57', w: '#F2F4F8' }, px: [
      '...rrrr...', '..rrwwrr..', '.rwwwwwwr.', '.rwwwwwwr.', '.rwwwwwwr.',
      '.rwwwwwwr.', '..rrwwrr..', '...rrrr...', '..........', '..........'] },
    slide: { pal: { z: '#59E3FF' }, px: [
      'zz........', '.zzz......', '..zzz.....', '...zzz....', '....zzz...',
      '.....zzz..', '....zzzzzz', '......zzzz', '........zz', '..........'] },
    vibrato: { pal: { j: '#C77BFF' }, px: [
      '..........', '..........', '..........', '.jj...jj..', 'j..j.j..j.',
      '....j....j', '..........', '..........', '..........', '..........'] },
    rise: { pal: { z: '#59FFB0' }, px: [
      '.......zz.', '......zzzz', '....zzzzzz', '.....zzz..', '....zzz...',
      '...zzz....', '..zzz.....', '.zzz......', 'zz........', '..........'] },
    arp: { pal: { y: '#FFD23F' }, px: [
      '..........', '.......yy.', '.......yy.', '....yy.yy.', '....yy.yy.',
      '.yy.yy.yy.', '.yy.yy.yy.', '.yy.yy.yy.', '..........', '..........'] },
    retrig: { pal: { r: '#FF8C57' }, px: [
      '..........', '.r...r....', '.rr..rr...', '.rrr.rrr..', '.rrrr.rrrr',
      '.rrr.rrr..', '.rr..rr...', '.r...r....', '..........', '..........'] },
    echo: { pal: { e: '#8E9BFF', d: '#5F6BC9' }, px: [
      '..........', '.ee.......', '.ee..dd...', '.ee..dd..d', '.ee..dd..d',
      '.ee..dd..d', '.ee..dd...', '.ee.......', '..........', '..........'] },
    play: { pal: { g: '#7BDCA0' }, px: [
      '..........', '..g.......', '..gg......', '..ggg.....', '..gggg....',
      '..ggg.....', '..gg......', '..g.......', '..........', '..........'] },
    pause: { pal: { g: '#7BDCA0' }, px: [
      '..........', '..gg..gg..', '..gg..gg..', '..gg..gg..', '..gg..gg..',
      '..gg..gg..', '..gg..gg..', '..........', '..........', '..........'] },
    more: { pal: { m: '#9AA4B8' }, px: [
      '..........', '.mm.mm.mm.', '.mm.mm.mm.', '..........', '.mm.mm.mm.',
      '.mm.mm.mm.', '..........', '.mm.mm.mm.', '.mm.mm.mm.', '..........'] },
    eraser: { pal: { p: '#FF9EC4', d: '#D96A9A', b: '#7FD4FF', w: '#FFFFFF' }, px: [
      '..........', '..bbbbbb..', '.bwbbbbb..', '.bbbbbbb..', '.pppppppp.',
      '.pwpppppd.', '.pppppppd.', '.ppppppdd.', '..dddddd..', '..........'] }
  };

  var CACHE = {};
  // 'i<N>' names render a generated waveform icon for bank instrument N:
  // the pulse's duty as a square trace, the wave's actual table, a speckle
  // for noise. Honest little pictures of the sound itself.
  function instIcon(idx, size) {
    resolveBank();
    var cv = document.createElement('canvas');
    cv.__ctpalRaw = true; cv.width = cv.height = size;
    var c = cv.getContext('2d');
    var m = null;
    for (var i = 0; i < BANK.meta.length; i++) if (BANK.meta[i].index === idx) m = BANK.meta[i];
    var pad = Math.max(1, size * 0.08), w = size - pad * 2, h = size - pad * 2;
    c.lineWidth = Math.max(1.5, size / 14); c.lineJoin = 'round';
    if (m && m.type === 'wave') {
      var t = BANK.waveTables[m.waveSlot] || [];
      c.strokeStyle = '#E8A75D'; c.beginPath();
      for (var x = 0; x < 32; x++) {
        var vx = pad + (x / 31) * w, vy = pad + (1 - (t[x] || 0) / 15) * h;
        x ? c.lineTo(vx, vy) : c.moveTo(vx, vy);
      }
      c.stroke();
    } else if (m && m.type === 'noise') {
      c.fillStyle = '#9AA4B8';
      for (var nx = 0; nx < 7; nx++) {
        var bh = (((idx * 31 + nx * 17) % 13) / 13) * h * 0.9 + h * 0.1;
        c.fillRect(pad + nx * (w / 7) + 1, pad + h - bh, w / 7 - 2, bh);
      }
    } else {
      var duty = (m && m.patch && m.patch.duty) || 0.5;
      c.strokeStyle = '#FFD23F'; c.beginPath();
      var y0 = pad + h * 0.15, y1 = pad + h * 0.85, half = w / 2;
      for (var p2 = 0; p2 < 2; p2++) {
        var x0 = pad + p2 * half, hi = half * duty;
        c.moveTo(x0, y1); c.lineTo(x0, y0); c.lineTo(x0 + hi, y0);
        c.lineTo(x0 + hi, y1); c.lineTo(x0 + half, y1);
      }
      c.stroke();
    }
    return cv;
  }
  function sprite(name, size) {
    var k = name + ':' + size;
    if (CACHE[k]) return CACHE[k];
    if (name.charAt(0) === 'i' && +name.slice(1) === +name.slice(1))
      return (CACHE[k] = instIcon(+name.slice(1), size));
    var def = SPRITES[name], cv = document.createElement('canvas');
    cv.__ctpalRaw = true;                    // UI pixels, not console art: the panel quantizer must not touch them
    cv.width = cv.height = size;
    var g = cv.getContext('2d'), cell = size / 10;
    for (var y = 0; y < 10; y++) for (var x = 0; x < 10; x++) {
      var ch = def.px[y][x];
      if (ch === '.' || !def.pal[ch]) continue;
      g.fillStyle = def.pal[ch];
      g.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
    }
    CACHE[k] = cv; return cv;
  }

  // stamps: id, character, how it finds its instrument in the live bank
  var STAMPS = [
    { id: 'piano',   ch: 'pulse', duty: 0.5,   env: 'pluck', label: 'Piano',   tip: 'A bright, plucky lead voice' },
    { id: 'trumpet', ch: 'pulse', duty: 0.25,  env: 'stab',  label: 'Trumpet', tip: 'A punchy, brassy stab' },
    { id: 'flute',   ch: 'pulse', duty: 0.5,   env: 'soft',  label: 'Flute',   tip: 'A soft, round tone' },
    { id: 'bell',    ch: 'pulse', duty: 0.125, env: 'pluck', label: 'Bell',    tip: 'A thin, sparkly chime' },
    { id: 'bassg',   ch: 'wave',  wave: 'buzzy',  label: 'Bass',  tip: 'A big buzzy bass voice' },
    { id: 'cello',   ch: 'wave',  wave: 'mellow', label: 'Cello', tip: 'A warm, mellow low voice' }
  ];
  var DRUMS = [
    { id: 'hat',   lane: 0, kind: 'hat',   vel: 0.5,  label: 'Hi-hat', tip: 'Top lane: a ticking hi-hat' },
    { id: 'snare', lane: 1, kind: 'snare', vel: 0.7,  label: 'Snare',  tip: 'Middle lane: a snappy snare' },
    { id: 'kick',  lane: 2, kind: 'kick',  vel: 0.9,  label: 'Kick',   tip: 'Bottom lane: a deep kick drum' }
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
    function waveBig(m) {
      var t = BANK.waveTables[m.waveSlot] || [], big = 0;
      for (var i = 1; i < t.length; i++) if (Math.abs(t[i] - t[i - 1]) >= 6) big++;
      return big >= 1;
    }
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
          // Bass wants the buzziest table; Cello the smoothest that still sings
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
    return BANK;
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
  function snapshot() { dropLiveScore(); undoStack.push(JSON.stringify(S)); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
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
  // Build the gb song + mark sulking cells. The DMG has 2 pulses, 1 wave and
  // 1 noise; contention is resolved left-to-right by placement order.
  // What voice does a cell want? Classic stamps say pulse-or-wave; drawer
  // stamps ('i<N>') and composed cells carry the exact instrument, and the
  // bank's meta says which channel that instrument belongs to.
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
    S.cells.forEach(function (x) { delete x.x; (byCol[x.c] = byCol[x.c] || []).push(x); });
    for (var c = 0; c < cols(); c++) {
      var here = byCol[c] || [];
      var slots = [false, false], wave = false, drum = false;
      here.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
      here.forEach(function (x) {
        if (x.r >= MEL_ROWS) {                              // drum lane
          var d = DRUMS[x.r - MEL_ROWS];
          if (drum) { x.x = 1; return; }
          drum = true;
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
          wave = true; note.ch = 2;
        } else {
          // an exact channel (composed cells) claims its slot first, then the
          // other pulse; slides want channel 1's sweep unit; hand cells take
          // the first free slot
          var wantCh = (x.ch === 0 || x.ch === 1) ? x.ch
                     : (x.z || x.u || x.sweep != null) ? 0 : (slots[0] ? 1 : 0);
          var ch = !slots[wantCh] ? wantCh : !slots[1 - wantCh] ? 1 - wantCh : -1;
          if (ch < 0) { x.x = 1; return; }
          slots[ch] = true; note.ch = ch;
          if (x.sweep != null) { if (note.ch === 0) note.sweep = x.sweep; }
          else if (note.ch === 0 && x.z) note.sweep = 0x3E;  // the fall off the note
          else if (note.ch === 0 && x.u) note.sweep = 0x36;  // ...and the rise
        }
        // COMMANDS expand into ordinary chip notes: nothing new in the
        // engine, everything stays parity-clean. The DMG never had an "arp
        // command" either; trackers just wrote fast notes.
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
          var st = 0, v2 = note.vel;
          for (st = 0; st < Math.max(2, Math.round(steps)) && c + st < cols(); st++, v2 *= 0.6)
            notes.push({ ch: note.ch, frame: colFrame(c + st), frames: Math.max(2, Math.round(per * 0.9)),
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
  // v3: cells may carry an extension with the exact instrument, pitch,
  // length, velocity, channel and sweep -- what makes a composed song
  // survive editing losslessly. v1/v2 links still decode.
  var CMD_CODE = { u: 1, q: 2, g: 3, f: 4 };
  var CODE_CMD = { 1: 'u', 2: 'q', 3: 'g', 4: 'f' };
  function encode() {
    var ids = STAMPS.map(function (s) { return s.id; });
    var out = [4, S.key, S.minor, S.bars, Math.round(S.bpm / 2), S.swing];
    S.cells.forEach(function (x) {
      var st = x.r >= MEL_ROWS ? 15 : (x.st && x.st.charAt(0) === 'i' ? 14 : Math.max(0, ids.indexOf(x.st)));
      var ext = x.inst != null;
      var cmd = x.u ? 1 : x.q ? 2 : x.g ? 3 : x.f ? 4 : 0;
      out.push(x.c & 63, (x.c >> 6) & 63, x.r | (x.z ? 32 : 0), st | (x.w ? 16 : 0) | (ext ? 32 : 0), cmd);
      if (ext) {
        var midi = x.midi != null ? (x.midi | 0) : 0;
        var hasSweep = x.sweep != null;
        out.push(x.inst & 63,
                 ((x.inst >> 6) & 3) | (hasSweep ? 4 : 0) | ((x.ch != null ? x.ch + 1 : 0) << 3) | (x.midi != null ? 32 : 0),
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
      if (ver < 1 || ver > 4) return null;
      var st2 = freshState();
      st2.key = v[1] % 12; st2.minor = v[2] & 1;
      st2.bars = ver === 1 ? ([2, 4, 8].indexOf(v[3]) >= 0 ? v[3] : 4)
                           : Math.max(1, Math.min(63, v[3]));
      st2.bpm = Math.max(70, Math.min(180, v[4] * 2)); st2.swing = v[5] & 1;
      var ids = STAMPS.map(function (s) { return s.id; });
      if (ver === 1) {
        for (var j = 6; j + 2 <= v.length - 1 + 1 && j + 2 < v.length + 1; j += 3) {
          if (j + 2 >= v.length + 1) break;
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
          if (ver >= 4) {
            var cc = CODE_CMD[v[k] & 7];
            if (cc && r2 < MEL_ROWS + DRUM_LANES) cell2[cc] = 1;
            k += 1;
          }
          if (ver >= 3 && (b2 & 32) && k + 5 < v.length + 1) {
            var e1 = v[k + 1];
            cell2.inst = v[k] | ((e1 & 3) << 6);
            var chc = (e1 >> 3) & 7; if (chc) cell2.ch = chc - 1;
            var ln = (v[k + 2] & 63) + 1; if (ln > 1) cell2.len = ln;
            cell2.vel = v[k + 3] / 63;
            if (e1 & 32) cell2.midi = v[k + 4] | ((v[k + 5] & 1) << 6);
            k += 6;
            if (e1 & 4 && k + 1 < v.length + 1) { cell2.sweep = v[k] | ((v[k + 1] & 3) << 6); k += 2; }
            if (stc === 14 && r2 < MEL_ROWS) cell2.st = 'i' + cell2.inst;
          }
          st2.cells.push(cell2);
        }
      }
      return st2;
    } catch (e) { return null; }
  }

  // ---- DOM + canvas --------------------------------------------------------
  var root = null, cv = null, g = null, playing = false, playT0 = 0, order = 0, pausedAt = 0;
  // A mood-composed song plays VERBATIM (its own bank, every instrument)
  // until the first hand edit, when the grid's version takes over. This is
  // what makes Create sound like the radio's generator, not a 6-stamp echo.
  var liveScore = null, liveBpm = 0, liveMood = '';
  // The timeline camera: the whole track is one horizontal strip; the view
  // scrolls through it and follows the playhead until you pan by hand.
  var camX = 0, camFollow = true, panMode = null;
  function curBpm() { return liveScore ? liveBpm : S.bpm; }
  function dropLiveScore() { liveScore = null; liveBpm = 0; }
  function songMs() {
    return liveScore ? (liveScore.totalFrames / FPS) * 1000
                     : cols() * (60 / S.bpm / 4) * 1000;
  }
  var repostTimer = 0, saveTimer = 0;
  function dirty() {
    if (!root) return;
    renderPalette(); draw();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var enc = encode();
      try { history.replaceState(null, '', '/create#s=' + enc); } catch (e) {}
      try { localStorage.setItem('ct-create-draft', enc); } catch (e) {}
    }, 400);
    if (playing) {
      clearTimeout(repostTimer);
      repostTimer = setTimeout(repostAtPosition, 160);
    }
  }
  // The song changed while it was playing: hand the chip the new version at
  // the position the playhead is already at. playT0 is untouched, so the
  // marching character keeps marching instead of snapping back to bar one.
  function repostAtPosition() {
    if (!playing) return;
    var song = liveScore || buildSong();
    var pos = song.loopFrames > 0
      ? Math.round(((performance.now() - playT0) / 1000) * FPS) % song.loopFrames : 0;
    if (typeof Audio !== 'undefined' && Audio.playCreate) Audio.playCreate(song, song.loopFrames, pos);
    draw();
  }
  // MOOD WORDS -> composer parameters. No AI anywhere: each word names the
  // deterministic composer's own dials (style, mode family, tempo band), and
  // a seed search finds a token whose compiled song satisfies them. The
  // composer itself is untouched and single-path; only the seed is chosen.
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

  // The dice compose a REAL track: the same composer the radio uses, a
  // random seed, and the busiest four bars of its Game Boy score projected
  // into the grid's vocabulary. A view of the songs the station writes.
  // (Ambient randomness only picks the seed; the composition itself is the
  // deterministic composer, untouched.)
  function composeIntoGrid(moodText, auto) {
    var C = (G.CT_COMPOSERS && G.CT_COMPOSERS.rrr_core) || null;
    if (!C || typeof C.compile !== 'function') return;
    if (auto) dropLiveScore(); else snapshot();     // auto-continue leaves the undo stack alone
    resolveBank();
    // seed search: compile random seeds until one satisfies the mood words
    // (a compile is ~0.4ms; a full search is invisible). Parameters only,
    // never output-quality scoring.
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
    // each pulse channel keeps ONE instrument face, from its envelope character
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
    // pitch: the score's own key folds onto the grid's diatonic rows
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
    S.key = 0; S.minor = scl.indexOf(3) >= 0 ? 1 : 0; S.bars = 4;   // a flat third anywhere (aeolian, dorian, blues) reads as minor
    S.bpm = Math.max(70, Math.min(180, Math.round((score.bpm || 120) / 2) * 2));
    var lab = root && root.querySelector('.cr-lab');
    if (lab) { lab.firstChild.textContent = S.bpm + ' BPM'; var sl = lab.querySelector('input'); if (sl) sl.value = S.bpm; }
    var sorted = gb.notes.slice().sort(function (a, b) { return a.frame - b.frame || (b.pri || 0) - (a.pri || 0); });
    var LANE = { 9: 2, 7: 1, 3: 0 };           // kick / snare / hat, by note priority
    // The WHOLE song lands on the timeline as editable cells, and plays at
    // full fidelity (its own bank, every instrument) until the first hand
    // edit takes over with the grid's version.
    S.bars = Math.max(1, Math.min(63, Math.ceil((gb.totalFrames || winF) / (16 * per16f))));
    S.cells = []; order = 0;
    var budget = {}, seen = {};
    sorted.forEach(function (n) {
      var c = Math.round(n.frame / per16f);
      if (c < 0 || c >= cols()) return;
      var bd = budget[c] = budget[c] || { p: 0, w: 0, d: 0 };
      var ch = n.ch | 0;
      var cell = { c: c, t: ++order, a: performance.now() };
      cell.inst = n.inst; cell.vel = n.vel != null ? n.vel : 0.8;
      if (ch === 3) {
        if (bd.d) return; bd.d = 1;
        cell.r = MEL_ROWS + (LANE[n.pri | 0] != null ? LANE[n.pri | 0] : 0);
      } else {
        cell.midi = n.midi | 0;
        var ln = Math.max(1, Math.round(n.frames / per16f));
        if (ln > 1) cell.len = ln;
        if (ch === 2) {
          if (bd.w) return; bd.w = 1;
          cell.r = MEL_ROWS - 1 - degOf(n.midi | 0);
          cell.st = waveStamp;
        } else {
          if (bd.p >= 2) return; bd.p++;
          cell.ch = ch;
          cell.r = MEL_ROWS - 1 - degOf(n.midi | 0);
          cell.st = stampFor[ch] || 'piano';
          if (n.sweep) { cell.sweep = n.sweep; cell.z = 1; }
        }
      }
      var key = cell.c + ':' + cell.r;
      if (seen[key]) return; seen[key] = 1;
      S.cells.push(cell);
    });
    liveScore = { notes: gb.notes, bank: gb.bank, totalFrames: gb.totalFrames, loopFrames: 0 };
    liveBpm = score.bpm || S.bpm;
    liveMood = String(moodText || '');
    camX = 0; camFollow = true;
    pausedAt = 0;
    startPlayback(0);
    dirty();
  }

  function startPlayback(fromMs) {
    clearTimeout(repostTimer);
    camFollow = true;
    var song = liveScore || buildSong();
    var off = Math.max(0, fromMs || 0) % Math.max(1, songMs());
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate(song, song.loopFrames, Math.round(off / 1000 * FPS));
    playing = true; playT0 = performance.now() - off;
    renderPalette(); draw();
  }
  function pausePlayback() {
    pausedAt = (performance.now() - playT0) % Math.max(1, songMs());
    armChip();
    playing = false;
    renderPalette(); draw();
  }
  function togglePlay() { if (!root) return; playing ? pausePlayback() : startPlayback(pausedAt); }
  // A silent host song keeps the chip's sequencer alive while the editor is
  // open, so placement pokes are audible before (and between) plays.
  function armChip() {
    resolveBank();
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate({ notes: [], bank: BANK, totalFrames: 0x7fffffff }, 0);
  }


  // The grid is a TIMELINE: the whole track as one horizontal strip of
  // 16-step bar panels, fixed cell size, with a camera that scrolls through
  // it (following the playhead until you pan by hand). Small songs sit
  // centered; long ones extend right, ending in a ghost "+" bar.
  var GHOST_W = 44;
  function layout() {
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    }
    var W = r.width, H = r.height;
    var gap = 12, cw = 26;
    var chm = Math.min(34, Math.max(16, (H - 44) / (ROWS + 0.8)));
    var gw = cw * cols() + (S.bars - 1) * gap;
    var fits = gw + GHOST_W + 88 <= W;
    var gx = fits ? (W - gw - GHOST_W) / 2 : 44;
    var maxCam = fits ? 0 : Math.max(0, gw + GHOST_W + 88 - W);
    if (camX > maxCam) camX = maxCam; if (camX < 0) camX = 0;
    return { W: W, H: H, dpr: dpr, cw: cw, chh: chm, gap: gap, gw: gw,
             gx: gx, gy: (H - chm * ROWS) / 2 + 6, maxCam: maxCam };
  }
  // absolute timeline x (camera-independent); the renderer subtracts camX
  function colXAbs(c, L) {
    return L.gx + Math.floor(c / 16) * (16 * L.cw + L.gap) + (c % 16) * L.cw;
  }
  function colX(c, L) { return colXAbs(c, L) - camX; }
  // One rAF chain, ever. The first version called requestAnimationFrame(draw)
  // once per popping cell AND once per frame while playing, none deduped: every
  // stamp placed during playback permanently added another full-redraw loop,
  // and the editor ground down the longer you played.
  var rafId = 0;
  function scheduleDraw() {
    if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; draw(); });
  }
  function draw() {
    if (!cv) return;
    var animating = playing;
    var L = layout();
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.W, L.H);
    var barW = 16 * L.cw + L.gap;
    var b0 = Math.max(0, Math.floor((camX - L.gx) / barW));
    var b1 = Math.min(S.bars - 1, Math.ceil((camX + L.W) / barW));
    for (var r = 0; r < ROWS; r++) {
      for (var c = b0 * 16; c < (b1 + 1) * 16; c++) {
        var x = colX(c, L), y = L.gy + r * L.chh;
        if (x + L.cw < 0 || x > L.W) continue;
        var drum = r >= MEL_ROWS;
        var deg = drum ? 0 : ((MEL_ROWS - 1 - r) % 7);
        g.fillStyle = drum ? 'rgba(255,255,255,0.10)'
          : deg === 0 ? 'rgba(120,220,160,0.20)'
          : (c % 4 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)');
        g.fillRect(x + 1, y + 1, L.cw - 2, L.chh - 2);
      }
    }
    // panel chrome: numbered bars with duplicate/remove controls, then the
    // ghost "+" bar that grows the song, then the loop mark
    for (var b = b0; b <= b1; b++) {
      var bx = L.gx + b * barW - camX;
      g.strokeStyle = 'rgba(232,227,250,0.30)'; g.lineWidth = 1;
      g.strokeRect(bx - 3.5, L.gy - 3.5, 16 * L.cw + 7, ROWS * L.chh + 7);
      g.fillStyle = 'rgba(232,227,250,0.55)'; g.font = '600 11px system-ui'; g.textBaseline = 'bottom';
      g.fillText(String(b + 1), bx + 2, L.gy - 8);
      g.fillStyle = 'rgba(232,227,250,0.4)'; g.font = '600 12px system-ui';
      g.fillText('\u29c9', bx + 16 * L.cw - 30, L.gy - 7);
      g.fillText('\u00d7', bx + 16 * L.cw - 12, L.gy - 7);
    }
    var endX = L.gx + S.bars * barW - L.gap + 10 - camX;
    if (endX < L.W + GHOST_W) {
      g.strokeStyle = 'rgba(232,227,250,0.22)'; g.setLineDash([4, 4]);
      g.strokeRect(endX, L.gy - 3.5, GHOST_W - 14, ROWS * L.chh + 7);
      g.setLineDash([]);
      g.fillStyle = 'rgba(232,227,250,0.5)'; g.font = '600 20px system-ui'; g.textBaseline = 'middle';
      g.fillText('+', endX + (GHOST_W - 14) / 2 - 6, L.gy + ROWS * L.chh / 2);
      g.font = '600 14px system-ui';
      g.fillText(liveScore ? '\u2192' : '\u21ba', endX + GHOST_W - 6, L.gy + ROWS * L.chh / 2);
    }
    // the drum lanes wear their instruments' faces, pinned to the left edge
    g.globalAlpha = 0.45;
    DRUMS.forEach(function (d, i) {
      var ly = L.gy + (MEL_ROWS + i) * L.chh + (L.chh - 16) / 2;
      g.drawImage(sprite(d.id, 16), 12, ly, 16, 16);
    });
    g.globalAlpha = 1;
    // stamps (only the visible ones)
    var now = performance.now();
    S.cells.forEach(function (x) {
      var px = colX(x.c, L), py = L.gy + x.r * L.chh;
      var lenSteps = x.len || 1;
      var tailEnd = lenSteps > 1 ? colX(Math.min(x.c + lenSteps - 1, cols() - 1), L) + L.cw : px + L.cw;
      if (tailEnd < 0 || px > L.W) return;
      if (lenSteps > 1) {
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(px + 2, py + L.chh * 0.3, tailEnd - px - 4, L.chh * 0.4);
      }
      var size = Math.min(L.cw, L.chh) - 3;
      var pop = x.a ? Math.max(0, 1 - (now - x.a) / 220) : 0;
      var s2 = size * (1 + pop * 0.35);
      var name = x.r >= MEL_ROWS ? DRUMS[x.r - MEL_ROWS].id : x.st;
      if (x.x) g.globalAlpha = 0.32;
      var wob = x.x ? Math.sin(now / 130 + x.c) * 2 : 0;
      g.drawImage(sprite(name, 40), px + (L.cw - s2) / 2 + wob, py + (L.chh - s2) / 2, s2, s2);
      g.globalAlpha = 1;
      var badge = x.z ? 'slide' : x.u ? 'rise' : x.q ? 'arp' : x.g ? 'retrig' : x.f ? 'echo' : null;
      if (badge) { g.drawImage(sprite(badge, 20), px + L.cw - 12, py - 2, 12, 12); }
      if (x.w) { g.drawImage(sprite('vibrato', 20), px - 2, py - 2, 12, 12); }
      if (pop > 0) animating = true;
    });
    // playhead: a marker sweeping the whole track; the camera keeps it in view
    if (playing) {
      var per16ms = (60 / curBpm() / 4) * 1000;
      if (liveScore) {
        var elapsed = performance.now() - playT0;
        if (elapsed >= songMs() + 250) {
          // the song ended; the mood writes the next one. This is the point:
          // not a loop, a station of your own.
          composeIntoGrid(liveMood, true);
          return;
        }
      }
      var col = ((performance.now() - playT0) / per16ms) % cols();
      var hb = Math.floor(col / 16);
      var hxAbs = L.gx + hb * barW + (col - hb * 16) * L.cw;
      if (camFollow && L.maxCam > 0) {
        var target = Math.max(0, Math.min(L.maxCam, hxAbs - L.gx - L.W * 0.35));
        camX = Math.abs(target - camX) > L.W * 1.5 ? target : camX + (target - camX) * 0.12;
      }
      var hx = hxAbs - camX;
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(hx, L.gy, 2, ROWS * L.chh);
      g.fillStyle = 'rgba(120,220,160,0.9)';
      g.beginPath();
      g.moveTo(hx - 6, L.gy - 14); g.lineTo(hx + 7, L.gy - 14); g.lineTo(hx + 0.5, L.gy - 4);
      g.closePath(); g.fill();
    }
    if (animating) scheduleDraw();
  }

  // ---- input ---------------------------------------------------------------
  var dragMode = null;
  function hitCell(ev) {
    var r0 = cv.getBoundingClientRect(), L = layout();
    var x = ev.clientX - r0.left - L.gx + camX;
    var b = Math.floor(x / (16 * L.cw + L.gap));
    var off = x - b * (16 * L.cw + L.gap);
    if (off >= 16 * L.cw + 2) return null;                 // in the gutter
    var c = b * 16 + Math.max(0, Math.min(15, Math.floor(off / L.cw)));
    var r = Math.floor((ev.clientY - r0.top - L.gy) / L.chh);
    if (x < 0 || c < 0 || c >= cols() || r < 0 || r >= ROWS) return null;
    return { c: c, r: r };
  }
  // header strip and ghost bar: pan, duplicate, remove, add
  function headerHit(ev) {
    var r0 = cv.getBoundingClientRect(), L = layout();
    var vx = ev.clientX - r0.left, vy = ev.clientY - r0.top;
    var x = vx - L.gx + camX;
    var barW = 16 * L.cw + L.gap;
    var endAbs = S.bars * barW - L.gap + 10;
    if (x >= endAbs && x <= endAbs + GHOST_W - 14 && vy >= L.gy - 26 && vy <= L.gy + ROWS * L.chh)
      return { type: 'add' };
    if (vy < L.gy - 2 && vy > L.gy - 26) {
      var b = Math.floor(x / barW), off = x - b * barW;
      if (b >= 0 && b < S.bars && off < 16 * L.cw) {
        if (off > 16 * L.cw - 36 && off < 16 * L.cw - 18) return { type: 'dup', bar: b };
        if (off >= 16 * L.cw - 16) return { type: 'del', bar: b };
      }
      return { type: 'pan' };
    }
    return null;
  }
  function addBar() {
    if (S.bars >= 63) return;
    snapshot(); S.bars++; dirty();
  }
  function dupBar(b) {
    if (S.bars >= 63) return;
    snapshot();
    var copies = [];
    S.cells.forEach(function (x) {
      if (x.c >= (b + 1) * 16) x.c += 16;
      else if (x.c >= b * 16) {
        var cp = { c: x.c + 16, r: x.r, t: ++order };
        if (x.st) cp.st = x.st; if (x.z) cp.z = 1; if (x.w) cp.w = 1;
        copies.push(cp);
      }
    });
    S.cells = S.cells.concat(copies);
    S.bars++; dirty();
  }
  function delBar(b) {
    snapshot();
    S.cells = S.cells.filter(function (x) { return x.c < b * 16 || x.c >= (b + 1) * 16; });
    if (S.bars > 1) {
      S.cells.forEach(function (x) { if (x.c >= (b + 1) * 16) x.c -= 16; });
      S.bars--;
    }
    dirty();
  }
  var lenCell = null, lenMoved = false, noteRow = -1;
  function placeAt(h) {
    var cell = { c: h.c, r: h.r, t: ++order, a: performance.now() };
    if (h.r < MEL_ROWS) {
      cell.st = S.cur;
      if (S.cur.charAt(0) === 'i' && isFinite(+S.cur.slice(1))) cell.inst = +S.cur.slice(1);
      if (S.cmd) cell[S.cmd] = 1;
      if (S.cmd === 'f' && !cell.len) cell.len = 4;   // an echo needs room to fade
      if (S.wob) cell.w = 1;
    } else if (S.cmd === 'g' || S.cmd === 'f') {
      cell[S.cmd] = 1;                                // drums ratchet and echo too
      if (S.cmd === 'f' && !cell.len) cell.len = 4;
    }
    S.cells.push(cell);
    dirty();
    auditionCell(cell);
    return cell;
  }
  // hear what was just placed, exactly as buildSong will play it
  function auditionCell(cell) {
    resolveBank();
    if (typeof Audio === 'undefined' || !Audio.pokeCreate) return;
    var per = framesPer16();
    if (cell.r >= MEL_ROWS) {
      var d = DRUMS[cell.r - MEL_ROWS];
      Audio.pokeCreate({ ch: 3, frames: Math.round(per), midi: null,
                         inst: cell.inst != null ? cell.inst : INSTOF[d.id],
                         vel: cell.vel != null ? cell.vel : d.vel });
      return;
    }
    var voice = cellVoice(cell) || 'pulse';
    Audio.pokeCreate({ ch: voice === 'wave' ? 2 : 1, frames: Math.round(per * (S.wob ? 6 : 2)),
                       midi: cell.midi != null ? cell.midi : rowMidi(cell.r),
                       inst: cell.inst != null ? cell.inst : INSTOF[cell.st],
                       vel: cell.vel != null ? cell.vel : 0.8,
                       sweep: cell.sweep != null ? cell.sweep
                            : (voice !== 'wave' && (cell.z || S.cmd === 'z')) ? 0x3E
                            : (voice !== 'wave' && (cell.u || S.cmd === 'u')) ? 0x36 : 0 });
  }
  function stepCell(h) {
    var i = cellAt(h.c, h.r);
    if (dragMode === 'erase') { if (i >= 0) { S.cells.splice(i, 1); dirty(); } return; }
    if (i < 0) placeAt(h);
  }

  // The drawer: every melodic instrument in the bank as a waveform icon.
  // Picking one makes it the stamp in hand; its cells carry the exact index.
  function toggleDrawer() {
    var d = root.querySelector('.cr-drawer');
    if (d) { d.remove(); draw(); return; }
    resolveBank();
    d = document.createElement('div');
    d.className = 'cr-drawer';
    var html = '';
    BANK.meta.forEach(function (m) {
      if (m.type === 'noise') return;                      // drums live on the lanes
      var tip = m.type === 'wave' ? 'Wave voice #' + m.index
              : 'Pulse ' + Math.round((m.patch.duty || 0.5) * 100) + '% ' + envClass(BANK.instruments[m.index]) + ' #' + m.index;
      html += '<button type="button" class="cr-inst" data-inst="' + m.index + '" title="' + tip + '" data-tip="' + tip + '">' +
              '<span class="cr-name">' + m.index + '</span></button>';
    });
    d.innerHTML = html;
    d.querySelectorAll('.cr-inst').forEach(function (b) {
      b.insertBefore(sprite('i' + b.dataset.inst, 26), b.firstChild);
    });
    root.insertBefore(d, root.querySelector('.cr-bottom'));
    markDrawer();
    draw();                                   // the grid canvas just changed height
  }
  function markDrawer() {
    var d = root.querySelector('.cr-drawer');
    if (!d) return;
    d.querySelectorAll('.cr-inst').forEach(function (b) {
      b.classList.toggle('on', S.cur === 'i' + b.dataset.inst);
    });
  }

  // Hear a critter the moment it is picked: tonic of the current key,
  // through the same chip and the same modifiers a placement would get.
  function auditionStamp(id) {
    if (id === 'eraser') return;
    resolveBank();
    var st = null;
    for (var i = 0; i < STAMPS.length; i++) if (STAMPS[i].id === id) st = STAMPS[i];
    if (!st || typeof Audio === 'undefined' || !Audio.pokeCreate) return;
    var per = framesPer16();
    Audio.pokeCreate({ ch: st.ch === 'wave' ? 2 : 1,
                       frames: Math.round(per * (S.wob ? 6 : 2)),
                       midi: 60 + S.key, inst: INSTOF[st.id], vel: 0.8,
                       sweep: st.ch !== 'wave' ? (S.cmd === 'z' ? 0x3E : S.cmd === 'u' ? 0x36 : 0) : 0 });
  }

  // ---- palette + toolbar ---------------------------------------------------
  function renderPalette() {
    var pal = root.querySelector('.cr-pal');
    function btn(cls, attr, name, tip, on) {
      return '<button type="button" class="cr-stamp' + cls + (on ? ' on' : '') + '" ' + attr +
             ' title="' + tip + '" data-tip="' + tip + '"><span class="cr-name">' + name + '</span></button>';
    }
    var html = btn(' cr-playstamp', 'data-cr="play"', playing ? 'Pause' : 'Play',
                   playing ? 'Pause (Space)' : 'Play your loop (Space)', playing);
    html += '<span class="cr-palsep"></span>';
    STAMPS.forEach(function (st) {
      html += btn('', 'data-stamp="' + st.id + '"', st.label, st.tip, S.cur === st.id);
    });
    html += '<span class="cr-palsep"></span>';
    html += btn(' cr-mod', 'data-mod="z"', 'Fall', 'Fall: new notes slide off downward', S.cmd === 'z');
    html += btn(' cr-mod', 'data-mod="u"', 'Rise', 'Rise: new notes sweep upward', S.cmd === 'u');
    html += btn(' cr-mod', 'data-mod="q"', 'Arp', 'Arp: new notes strum their chord, fast', S.cmd === 'q');
    html += btn(' cr-mod', 'data-mod="g"', 'Retrig', 'Retrig: new notes ratchet in half-steps', S.cmd === 'g');
    html += btn(' cr-mod', 'data-mod="f"', 'Echo', 'Echo: new notes repeat and fade', S.cmd === 'f');
    html += btn(' cr-mod', 'data-mod="wob"', 'Vibrato', 'Vibrato: new notes hold and sing', !!S.wob);
    html += '<span class="cr-palsep"></span>';
    html += btn('', 'data-stamp="eraser"', 'Eraser', 'Eraser: click or sweep to remove notes', S.cur === 'eraser');
    var pickedInst = S.cur.charAt(0) === 'i' && isFinite(+S.cur.slice(1));
    html += btn(' cr-more', 'data-cr="drawer"', pickedInst ? '#' + S.cur.slice(1) : 'More',
                'Every melodic instrument in the bank', pickedInst);
    pal.innerHTML = html;
    pal.querySelectorAll('.cr-stamp').forEach(function (b) {
      var MODICON = { z: 'slide', u: 'rise', q: 'arp', g: 'retrig', f: 'echo', wob: 'vibrato' };
      var name = b.dataset.cr === 'play' ? (playing ? 'pause' : 'play')
               : b.dataset.cr === 'drawer' ? (S.cur.charAt(0) === 'i' ? S.cur : 'more')
               : (b.dataset.stamp || MODICON[b.dataset.mod] || 'slide');
      b.insertBefore(sprite(name, 30), b.firstChild);
    });
  }
  // Mario Paint's music screen had no key picker, no scale menu, no swing
  // switch: the staff kept you in key and a slider set the pace. Same here --
  // the rows ARE the scale (C major stays the house key; old links that
  // carry another key still decode and play), and the toolbar is a toy.
  var CHIPS = ['happy', 'sad', 'upbeat', 'chill', 'spooky', 'epic', 'retro', 'funky', 'dreamy', 'battle'];
  function toolbarHTML() {
    return '<div class="cr-title"><b>Create:</b> <span>place instruments, hear the music</span></div>' +
      '<div class="cr-moodbox">' +
        '<input type="text" class="cr-mood" data-cr="mood" placeholder="a mood: happy, spooky, fast..." maxlength="60">' +
        '<button type="button" class="cr-btn cr-primary" data-cr="make" data-tip="Compose a song with this mood, the radio\u0027s own way">Make</button>' +
      '</div>' +
      '<div class="cr-tools">' +
      '<button type="button" class="cr-btn" data-cr="undo" title="Undo" data-tip="Undo the last change">↩</button>' +
      '<button type="button" class="cr-btn" data-cr="redo" title="Redo" data-tip="Redo what you undid">↪</button>' +
      '<button type="button" class="cr-btn" data-cr="clear" data-tip="Wipe the whole grid clean">Clear</button>' +
      '<button type="button" class="cr-btn" data-cr="dice" data-tip="Compose a real track into the grid, the radio\u0027s own way">\ud83c\udfb2 Dice</button>' +
      '<span class="cr-sep"></span>' +
      '<button type="button" class="cr-btn" data-cr="share" data-tip="Copy a link that IS your song">Copy link</button>' +
      '<button type="button" class="cr-btn" data-cr="wav" data-tip="Download your song as audio (WAV)">WAV</button>' +
      '<button type="button" class="cr-btn" data-cr="rom" data-tip="Download a real Game Boy cartridge file (.gb)">ROM</button>' +
      '<button type="button" class="cr-btn cr-close" data-cr="close" data-tip="Back to the radio (Esc)">×</button>' +
      '</div>';
  }

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

  // ---- open / close --------------------------------------------------------
  function open() {
    if (root) { root.classList.add('show'); armChip(); return; }
    var fromUrl = (location.hash.match(/#s=([A-Za-z0-9\-_]+)/) || [])[1];
    S = (fromUrl && decode(fromUrl)) || null;
    if (!S) { try { var d = localStorage.getItem('ct-create-draft'); if (d) S = decode(d); } catch (e) {} }
    if (!S) S = freshState();
    order = S.cells.length;
    root = document.createElement('div'); root.id = 'createscreen';
    root.innerHTML = '<div class="cr-top">' + toolbarHTML() + '</div>' +
      '<div class="cr-moods">' + CHIPS.map(function (c) {
        return '<button type="button" class="cr-chip" data-mood="' + c + '">' + c + '</button>';
      }).join('') + '</div>' +
      '<div class="cr-main"><canvas class="cr-cv"></canvas></div>' +
      '<div class="cr-bottom">' +
        '<div class="cr-pal"></div>' +
        '<div class="cr-bside">' +
          '<label class="cr-lab" data-tip="Tempo: how fast the loop plays">' + S.bpm + ' BPM<input type="range" min="70" max="180" step="2" value="' + S.bpm + '" data-cr="bpm"></label>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    cv = root.querySelector('.cr-cv'); cv.__ctpalRaw = true; g = cv.getContext('2d');
    renderPalette();
    requestAnimationFrame(function () { root.classList.add('show'); draw(); });
    document.body.classList.add('create-open');
    armChip();
    try { history.replaceState(null, '', '/create' + (S.cells.length ? '#s=' + encode() : '')); } catch (e) {}

    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' || !isOpen() || ev.metaKey || ev.altKey || ev.ctrlKey) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;      // typing a mood, not pausing
      ev.preventDefault(); ev.stopPropagation();
      togglePlay();
    }, true);
    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var mi = ev.target.closest && ev.target.closest('.cr-mood');
      if (!mi) return;
      ev.preventDefault(); ev.stopPropagation();
      mi.blur();
      composeIntoGrid(mi.value);
    });
    root.addEventListener('click', function (ev) {
      var fb = ev.target.closest('button'); if (fb) fb.blur();
      var st = ev.target.closest('[data-stamp]');
      if (st) { S.cur = st.dataset.stamp; renderPalette(); auditionStamp(S.cur); return; }
      var md = ev.target.closest('[data-mod]');
      if (md) {
        var mo = md.dataset.mod;
        if (mo === 'wob') S.wob = S.wob ? 0 : 1;
        else S.cmd = S.cmd === mo ? 0 : mo;                // one command in hand at a time
        renderPalette();
        if ((mo === 'wob' && S.wob) || (mo !== 'wob' && S.cmd === mo))
          auditionStamp(S.cur === 'eraser' || S.cur.charAt(0) === 'i' ? 'piano' : S.cur);
        return;
      }
      var di = ev.target.closest('[data-inst]');
      if (di) {
        S.cur = 'i' + di.dataset.inst;
        renderPalette(); markDrawer();
        auditionCell({ c: 0, r: 7, st: S.cur, inst: +di.dataset.inst });
        return;
      }
      var mc = ev.target.closest('[data-mood]');
      if (mc) {
        var mi = root.querySelector('.cr-mood'); if (mi) mi.value = mc.dataset.mood;
        composeIntoGrid(mc.dataset.mood);
        return;
      }
      var b = ev.target.closest('[data-cr]');
      if (!b) return;
      var k = b.dataset.cr;
      if (k === 'play') { togglePlay(); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'clear') { snapshot(); S.cells = []; dirty(); }
      else if (k === 'dice') { composeIntoGrid(''); }
      else if (k === 'make') { var mv = root.querySelector('.cr-mood'); composeIntoGrid(mv ? mv.value : ''); }
      else if (k === 'drawer') { toggleDrawer(); }
      else if (k === 'share') {
        try { navigator.clipboard.writeText(location.origin + '/create#s=' + encode()); if (G._toast) G._toast('Link copied. The link IS the song 🎵'); } catch (e) {}
      }
      else if (k === 'wav') { exportWav(); }
      else if (k === 'rom') { exportRom(); }
    });
    root.addEventListener('input', function (ev) {
      var b = ev.target.closest('[data-cr="bpm"]'); if (!b) return;
      dropLiveScore();
      S.bpm = +b.value; b.parentNode.firstChild.textContent = S.bpm + ' BPM';
      dirty();
    });
    var lastHit = null;
    cv.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); cv.setPointerCapture(ev.pointerId);
      var hh = headerHit(ev);
      if (hh) {
        if (hh.type === 'add') { addBar(); return; }
        if (hh.type === 'dup') { dupBar(hh.bar); return; }
        if (hh.type === 'del') { delBar(hh.bar); return; }
        panMode = { x: ev.clientX, cam: camX }; camFollow = false;
        return;
      }
      var h = hitCell(ev); if (!h) return;
      snapshot();
      var i = cellAt(h.c, h.r);
      if (S.cur === 'eraser') {
        dragMode = 'erase'; lastHit = h;
        if (i >= 0) { S.cells.splice(i, 1); dirty(); }
        return;
      }
      if (i >= 0) {
        // an existing note: drag right to stretch it, tap to remove it
        dragMode = 'len'; lenCell = S.cells[i]; lenMoved = false; lastHit = h;
        return;
      }
      lenCell = placeAt(h); noteRow = h.r; dragMode = 'note'; lastHit = h;
    });
    cv.addEventListener('wheel', function (ev) {
      var L = layout();
      if (L.maxCam <= 0) return;
      ev.preventDefault();
      var d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      camX = Math.max(0, Math.min(L.maxCam, camX + d));
      camFollow = false;
      draw();
    }, { passive: false });
    cv.addEventListener('pointermove', function (ev) {
      if (panMode) {
        var L = layout();
        camX = Math.max(0, Math.min(L.maxCam, panMode.cam - (ev.clientX - panMode.x)));
        draw();
        return;
      }
      if (!dragMode) return;
      var h = hitCell(ev); if (!h) return;
      if (dragMode === 'len' || (dragMode === 'note' && h.r === noteRow)) {
        if (h.c !== lenCell.c || h.r !== lenCell.r) lenMoved = true;
        if (h.r === lenCell.r) {
          var L2 = Math.max(1, Math.min(cols() - lenCell.c, h.c - lenCell.c + 1));
          if (L2 !== (lenCell.len || 1)) {
            if (L2 > 1) lenCell.len = L2; else delete lenCell.len;
            dirty();
          }
          lastHit = h; return;
        }
        if (dragMode === 'len') { lastHit = h; return; }
      }
      if (dragMode === 'note') dragMode = 'paint';         // left the row: line painting
      // pointer events arrive sparser than cells: walk the line between the
      // last sample and this one, or a fast sweep skips columns.
      if (lastHit) {
        var dc = h.c - lastHit.c, dr = h.r - lastHit.r;
        var n = Math.max(Math.abs(dc), Math.abs(dr));
        for (var i = 1; i <= n; i++)
          stepCell({ c: lastHit.c + Math.round(dc * i / n), r: lastHit.r + Math.round(dr * i / n) });
      } else stepCell(h);
      lastHit = h;
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () {
        if (dragMode === 'len' && !lenMoved && lenCell) {
          var i = S.cells.indexOf(lenCell);
          if (i >= 0) { S.cells.splice(i, 1); dirty(); }
        }
        dragMode = null; lastHit = null; panMode = null; lenCell = null;
      });
    });
    window.addEventListener('resize', draw);
  }
  function close() {
    if (playing) pausePlayback(); else armChip();
    pausedAt = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (root) root.classList.remove('show');
    document.body.classList.remove('create-open');
    try { history.replaceState(null, '', '/'); } catch (e) {}
    if (G._closeCreateReturn) G._closeCreateReturn();
  }
  function isOpen() { return !!(root && root.classList.contains('show')); }

  G.CT_CREATE = { open: open, close: close, isOpen: isOpen, togglePlay: togglePlay,
    _dbg: function () {
      var mx = 0, withInst = 0, cmds = 0;
      if (S) S.cells.forEach(function (x) { if ((x.len || 1) > mx) mx = x.len || 1; if (x.inst != null) withInst++;
                                            if (x.z || x.u || x.q || x.g || x.f) cmds++; });
      return { playing: playing, live: !!liveScore, bars: S ? S.bars : 0,
               camX: Math.round(camX), follow: camFollow, cur: S ? S.cur : '', cmd: S ? S.cmd : 0,
               cells: S ? S.cells.length : 0, withInst: withInst, maxLen: mx, cmds: cmds,
               notes: S ? buildSong().notes.length : 0, mood: liveMood }; },
    _skipToEnd: function () { if (playing && liveScore) playT0 = performance.now() - songMs() - 300; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CT_CREATE;
})(typeof globalThis !== 'undefined' ? globalThis : window);
