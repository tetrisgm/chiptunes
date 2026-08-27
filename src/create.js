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
                           : Math.max(1, Math.min(63, v[3]));
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
  function dirty() {
    if (!root) return;
    if (!playing) { try { buildSong(); } catch (e) {} }   // refresh sulk + channel marks
    checkSulk();
    renderGrid(); renderBars();
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
  function repostAtPosition() {
    if (!playing) return;
    var song = currentSong();
    var pos = song.loopFrames > 0
      ? Math.round(((performance.now() - playT0) / 1000) * FPS) % song.loopFrames : 0;
    if (typeof Audio !== 'undefined' && Audio.playCreate) Audio.playCreate(song, song.loopFrames, pos);
  }
  function startPlayback(fromMs) {
    clearTimeout(repostTimer);
    viewPinned = false;
    var song = currentSong();
    var off = Math.max(0, fromMs || 0) % Math.max(1, songMs());
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate(song, song.loopFrames, Math.round(off / 1000 * FPS));
    playing = true; playT0 = performance.now() - off;
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
    S.key = 0; S.minor = scl.indexOf(3) >= 0 ? 1 : 0; S.bars = Math.max(1, Math.min(63, Math.ceil((gb.totalFrames || winF) / (16 * per16f))));
    S.bpm = Math.max(70, Math.min(180, Math.round((score.bpm || 120) / 2) * 2));
    var lab = root && root.querySelector('.cr-lab');
    if (lab) { lab.firstChild.textContent = S.bpm + ' BPM'; var sl = lab.querySelector('input'); if (sl) sl.value = S.bpm; }
    S.cells = []; order = 0;
    var sorted = gb.notes.slice().sort(function (a, b) { return a.frame - b.frame || (b.pri || 0) - (a.pri || 0); });
    var LANE = { 9: 2, 7: 1, 3: 0 };           // kick / snare / hat, by note priority
    var budget = {}, seen = {};
    sorted.forEach(function (n) {
      var c = Math.round(n.frame / per16f);
      if (c < 0 || c >= cols()) return;
      var bd = budget[c] = budget[c] || { p: 0, w: 0, d: 0 };
      var ch = n.ch | 0;
      var cell = { c: c, t: ++order };
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
    try { buildSong(); } catch (e) {}          // resolve channel marks
    loopBar = -1; queuedBar = null;
    viewBar = 0; viewPinned = false;
    pausedAt = 0;
    startPlayback(0);
    dirty();
  }

  // ---- the sound map: pick a channel's instrument by dragging --------------
  var PADPTS = null, chInst = [null, null, null, null];
  function padPoints() {
    if (PADPTS) return PADPTS;
    resolveBank();
    PADPTS = [];
    BANK.meta.forEach(function (m) {
      if (m.type === 'noise') return;
      var j = ((m.index * 37) % 13) / 13 * 0.07;
      var x, y;
      if (m.type === 'wave') {
        var t = BANK.waveTables[m.waveSlot] || [], big = 0;
        for (var i = 1; i < t.length; i++) if (Math.abs(t[i] - t[i - 1]) >= 6) big++;
        x = 0.15 + Math.min(1, big / 3) * 0.66 + j;
        y = 0.2 + ((m.index * 53) % 17) / 17 * 0.6;
      } else {
        var duty = (m.patch && m.patch.duty) || 0.5;
        x = (duty === 0.5 ? 0.2 : duty === 0.25 ? 0.48 : 0.74) + j;
        y = ({ pluck: 0.14, stab: 0.34, soft: 0.54, sus: 0.72, swell: 0.82 })[envClass(BANK.instruments[m.index])] + j;
      }
      PADPTS.push({ idx: m.index, x: Math.min(0.95, x), y: Math.min(0.92, y), wave: m.type === 'wave' });
    });
    return PADPTS;
  }
  function padFor(ch) { return padPoints().filter(function (p) { return p.wave === (ch === 2); }); }
  function drawPad(pc, ch) {
    var c = pc.getContext('2d');
    c.clearRect(0, 0, pc.width, pc.height);
    padFor(ch).forEach(function (pt) {
      var sel = chInst[ch] === pt.idx;
      c.beginPath();
      c.arc(pt.x * pc.width, pt.y * pc.height, sel ? 8 : 5, 0, Math.PI * 2);
      c.fillStyle = CH[ch].color;
      c.globalAlpha = sel ? 1 : 0.55;
      c.fill();
      if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
      c.globalAlpha = 1;
    });
  }
  var padPokeAt = 0;
  function padPick(ev, pc, ch) {
    var r = pc.getBoundingClientRect();
    var nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
    var best = null, bd = 9;
    padFor(ch).forEach(function (pt) {
      var d2 = (pt.x - nx) * (pt.x - nx) + (pt.y - ny) * (pt.y - ny) * 1.4;
      if (d2 < bd) { bd = d2; best = pt; }
    });
    if (!best || chInst[ch] === best.idx) return;
    chInst[ch] = best.idx;
    drawPad(pc, ch);
    renderChans();
    var t = performance.now();
    if (t - padPokeAt > 110) {
      padPokeAt = t;
      auditionCell({ c: 0, r: MEL_ROWS - 1 - lastDeg[ch], st: CH[ch].stamp, inst: best.idx });
    }
  }
  function openPad(ch) {
    if (ch === 3) return;
    closePad();
    var ov = document.createElement('div');
    ov.className = 'cr-padover';
    ov.innerHTML = '<div class="cr-padcard"><b>' + CH[ch].n + ' sound</b>' +
      '<canvas class="cr-pad" width="280" height="170"></canvas>' +
      '<span class="cr-padlab">drag to find a sound · bright → · longer ↓</span>' +
      '<button type="button" class="cr-btn" data-padclose="1">Done</button></div>';
    root.appendChild(ov);
    var pc = ov.querySelector('.cr-pad');
    pc.__ctpalRaw = true;
    drawPad(pc, ch);
    var down = false;
    pc.addEventListener('pointerdown', function (ev) { ev.preventDefault(); pc.setPointerCapture(ev.pointerId); down = true; padPick(ev, pc, ch); });
    pc.addEventListener('pointermove', function (ev) { if (down) padPick(ev, pc, ch); });
    ['pointerup', 'pointercancel'].forEach(function (t) { pc.addEventListener(t, function () { down = false; }); });
    ov.addEventListener('click', function (ev) {
      if (ev.target === ov || ev.target.closest('[data-padclose]')) closePad();
    });
  }
  function closePad() { var ov = root.querySelector('.cr-padover'); if (ov) ov.remove(); }

  // ---- the songs shelf: this browser's saved songs -------------------------
  function loadShelf() {
    try { return JSON.parse(localStorage.getItem('ct-create-shelf') || '[]') || []; } catch (e) { return []; }
  }
  function saveShelf(list) {
    try { localStorage.setItem('ct-create-shelf', JSON.stringify(list.slice(0, 30))); } catch (e) {}
  }
  function renderShelf() {
    var sh = root.querySelector('.cr-shelf');
    if (!sh) return;
    var list = loadShelf();
    var html = '<div class="cr-shelfrow cr-shelfsave">' +
      '<input type="text" class="cr-shelfname" placeholder="name this song" maxlength="40">' +
      '<button type="button" class="cr-btn" data-shelf="save">Save current</button></div>';
    list.forEach(function (it, i) {
      var d = decode(it.enc);
      var meta = d ? d.cells.length + ' notes · ' + d.bars + ' bars · ' + d.bpm + ' BPM' : '?';
      html += '<div class="cr-shelfrow"><b>' + String(it.name).replace(/[<>&]/g, '') + '</b>' +
              '<span>' + meta + '</span>' +
              '<button type="button" class="cr-btn" data-shelf-load="' + i + '">Load</button>' +
              '<button type="button" class="cr-btn" data-shelf-del="' + i + '" title="Delete">×</button></div>';
    });
    if (!list.length) html += '<div class="cr-shelfempty">Nothing saved yet. Songs you save live in this browser.</div>';
    sh.innerHTML = html;
  }
  function toggleShelf() {
    var sh = root.querySelector('.cr-shelf');
    if (sh) { sh.remove(); return; }
    sh = document.createElement('div');
    sh.className = 'cr-shelf';
    root.insertBefore(sh, root.querySelector('.cr-hint'));
    renderShelf();
  }

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
  var HINT_IDLE = 'Each square is a moment in the bar, left to right. Tap for a note, drag up for higher, sideways for longer, tap again to remove.';
  function hint(t) {
    var el = root && root.querySelector('.cr-hint');
    if (!el) return;
    el.textContent = t || HINT_IDLE;
    clearTimeout(hintTimer);
    if (t) hintTimer = setTimeout(function () { if (el) el.textContent = HINT_IDLE; }, 6000);
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
      ['This song was just written for you.', 'Each square is one moment of this bar, left to right, top to bottom. Tap for a note, tap again to remove. Drag up and down for pitch, sideways to stretch.'],
      ['Four voices, like a tiny band.', 'Melody, Harmony, Bass and Drums are the Game Boy\u2019s four sounds. Tap one to work on it, tap the lit one to silence it, hold one to pick its instrument.'],
      ['The bars walk the song.', 'Tap a number to look at that bar; ↺ loops the one you are on while you shape it.'],
      ['Moods write songs.', 'Type a feeling and press Make, or roll the dice. Everything it writes is yours to edit.']
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
    Audio.pokeCreate({ ch: voice === 'wave' ? 2 : 1, frames: Math.round(per * 2),
                       midi: cell.midi != null ? cell.midi : rowMidi(cell.r),
                       inst: cell.inst != null ? cell.inst : INSTOF[cell.st],
                       vel: cell.vel != null ? cell.vel : 0.8,
                       sweep: cell.sweep != null ? cell.sweep : (voice !== 'wave' && cell.z) ? 0x3E : (voice !== 'wave' && cell.u) ? 0x36 : 0 });
  }

  // ---- the view: one bar of one channel ------------------------------------
  var CH = [
    { n: 'Melody',  color: '#7BDCA0', stamp: 'piano', tip: 'Melody: the Game Boy\u2019s first pulse voice. Hold the button to choose its sound.' },
    { n: 'Harmony', color: '#57C4FF', stamp: 'bell',  tip: 'Harmony: the second pulse voice, for counter-lines and chords. Hold to choose its sound.' },
    { n: 'Bass',    color: '#E8A75D', stamp: 'bassg', tip: 'Bass: the wave voice, deep and warm. Hold to choose its sound.' },
    { n: 'Drums',   color: '#C9A4E8', stamp: null,    tip: 'Drums: the noise voice. Drag a note up for hat, middle for snare, down for kick.' }
  ];
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
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
  var viewCh = 0, viewBar = 0, viewPinned = false, lastDeg = [7, 9, 3, 2];
  // the parameter in hand: what a vertical drag on a step edits
  var param = 'note';
  var PARAMS = [
    { id: 'note', n: 'Note', tip: 'Drag a note up and down to change its pitch. Tap Note again and again to shuffle the pitches.' },
    { id: 'vol',  n: 'Vol',  tip: 'Drag a note up and down to change its loudness. All the way down silences that step (=). Multi-tap to randomize.' },
    { id: 'len',  n: 'Len',  tip: 'Drag a note up to make it longer. Multi-tap to randomize the lengths.' }
  ];
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
    if (x.r >= MEL_ROWS || (x.r < MEL_ROWS && viewCh === 3)) {
      x.r = MEL_ROWS + (2 - deg);
      delete x.inst;                           // a moved drum adopts its lane's sound
    } else {
      x.r = MEL_ROWS - 1 - deg;
      delete x.midi;                           // hand pitches stay in key
    }
  }
  function makeCell(ch, col, deg) {
    var cell = { c: col, t: ++order };
    if (ch === 3) {
      cell.r = MEL_ROWS + (2 - deg);
    } else {
      cell.r = MEL_ROWS - 1 - deg;
      cell.st = CH[ch].stamp;
      if (ch < 2) cell.ch = ch;
      if (chInst[ch] != null) cell.inst = chInst[ch];
    }
    S.cells.push(cell);
    return cell;
  }

  // ---- render --------------------------------------------------------------
  var stepEls = [], lastPh = -1, lastPlayBar = -1;
  function renderTransport() {
    var b = root.querySelector('[data-cr="play"]');
    if (b) b.textContent = playing ? '❚❚' : '▶';
  }
  function renderChans() {
    root.querySelectorAll('.n-chan').forEach(function (b) {
      var i = +b.dataset.ch;
      b.classList.toggle('sel', viewCh === i);
      b.classList.toggle('muted', !!chMuted[i]);
      b.style.color = CH[i].color;
      var ic = chanIcon(i);
      var old = b.querySelector('canvas');
      if (old !== ic) { if (old) old.remove(); b.insertBefore(ic, b.firstChild); }
    });
  }
  function renderBars() {
    var strip = root.querySelector('.n-barstrip');
    if (!strip) return;
    var pb = -1;
    if (playing) {
      var perMs = (60 / curBpm() / 4) * 1000;
      var col = loopBar >= 0 ? loopBar * 16 : ((performance.now() - playT0) / perMs) % cols();
      pb = loopBar >= 0 ? loopBar : Math.floor(col / 16);
    }
    lastPlayBar = pb;
    if (strip.childElementCount !== S.bars) {
      var html = '';
      for (var b = 0; b < S.bars; b++) html += '<button type="button" class="n-bar" data-bar="' + b + '">' + (b + 1) + '</button>';
      strip.innerHTML = html;
    }
    strip.querySelectorAll('.n-bar').forEach(function (el) {
      var b = +el.dataset.bar;
      el.classList.toggle('view', b === viewBar);
      el.classList.toggle('loop', b === loopBar);
      el.classList.toggle('queued', b === queuedBar);
      el.classList.toggle('play', b === pb);
    });
    var lp = root.querySelector('[data-cr="loop"]');
    if (lp) lp.classList.toggle('on', loopBar >= 0);
    var cur = strip.querySelector('.n-bar.view');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderGrid() {
    if (!stepEls.length) return;
    var grid = root.querySelector('.n-grid');
    grid.style.color = CH[viewCh].color;
    var cap = root.querySelector('.n-cap');
    if (cap) cap.textContent = CH[viewCh].n + ' · bar ' + (viewBar + 1) + ' of ' + S.bars +
                               (loopBar === viewBar && loopBar >= 0 ? ' · looping' : '');
    var mutedCh = !!effMask()[viewCh];
    for (var s = 0; s < 16; s++) {
      var col = viewBar * 16 + s, el = stepEls[s];
      var i = cellIndexAt(viewCh, col);
      var tail = i < 0 ? tailIndexAt(viewCh, col) : -1;
      var x = i >= 0 ? S.cells[i] : null;
      el.classList.toggle('on', !!x);
      el.classList.toggle('tail', tail >= 0);
      el.classList.toggle('sulk', !!(x && x.x));
      el.classList.toggle('mutedch', mutedCh);
      var pbEl = el.querySelector('.pb'), nnEl = el.querySelector('.nn'), lnEl = el.querySelector('.ln');
      if (x) {
        var deg = degOfCell(x);
        var top = viewCh === 3 ? [64, 40, 16][2 - (x.r - MEL_ROWS)] : Math.round((1 - deg / (MEL_ROWS - 1)) * 74 + 8);
        pbEl.style.top = top + '%';
        var vel = x.vel != null ? x.vel : 0.8;
        el.classList.toggle('rest', vel === 0);
        pbEl.style.opacity = vel === 0 ? 0.15 : 0.35 + vel * 0.6;
        nnEl.textContent = vel === 0 ? '=' :
          (x.r >= MEL_ROWS ? DRUM_NAMES[x.r - MEL_ROWS]
                           : noteName(x.midi != null ? x.midi : rowMidi(x.r)));
        nnEl.style.opacity = vel === 0 ? 0.5 : 0.55 + vel * 0.45;
        lnEl.textContent = (x.len || 1) > 1 ? '×' + x.len : '';
      } else {
        el.classList.remove('rest');
        pbEl.style.opacity = '';                 // inline opacity would ghost into empty squares
        nnEl.textContent = ''; lnEl.textContent = '';
      }
    }
  }
  function renderParams() {
    root.querySelectorAll('.n-param').forEach(function (b) {
      b.classList.toggle('on', param === b.dataset.param);
    });
    var sw = root.querySelector('[data-cr="swing"]');
    if (sw) sw.classList.toggle('on', !!(S && S.swing));
  }
  function renderAll() { renderTransport(); renderChans(); renderBars(); renderGrid(); renderParams(); }
  function updatePh(stepIdx) {
    if (stepIdx === lastPh) return;
    lastPh = stepIdx;
    for (var s = 0; s < 16; s++) stepEls[s].classList.toggle('ph', s === stepIdx);
  }

  // Multi-tapping a parameter button randomizes that parameter across the
  // bar's notes on this voice; each further tap within the window randomizes
  // harder. In-key, undoable, and only ever touches notes that exist.
  var randTaps = 0, randTimer = 0, randSnapped = false;
  function barCells() {
    var out = [];
    for (var s2 = 0; s2 < 16; s2++) {
      var i = cellIndexAt(viewCh, viewBar * 16 + s2);
      if (i >= 0) out.push(S.cells[i]);
    }
    return out;
  }
  function randomizeParam(which) {
    clearTimeout(randTimer);
    randTaps++;
    randTimer = setTimeout(function () { randTaps = 0; randSnapped = false; }, 700);
    if (randTaps < 2) return;                  // the first tap only selects
    var cellsHere = barCells();
    if (!cellsHere.length) { hint('No notes on this voice in this bar yet.'); return; }
    if (!randSnapped) { snapshot(); randSnapped = true; }
    var amt = Math.min(6, randTaps - 1);
    cellsHere.forEach(function (x) {
      if (which === 'note') {
        var span = x.r >= MEL_ROWS ? 2 : MEL_ROWS - 1;
        var nd = Math.max(0, Math.min(span, degOfCell(x) + Math.round((Math.random() * 2 - 1) * amt)));
        applyDeg(x, nd);
      } else if (which === 'vol') {
        x.vel = Math.max(1, Math.round(Math.random() * 8)) / 8;
      } else if (which === 'len') {
        var nl = Math.max(1, Math.min(8, 1 + Math.floor(Math.random() * amt)));
        if (nl > 1) x.len = nl; else delete x.len;
      }
    });
    dirty();
    hint('Shuffled the ' + (which === 'note' ? 'pitches' : which === 'vol' ? 'volumes' : 'lengths') + '. Keep tapping for wilder, undo to take it back.');
  }

  // the playhead ticker: follow, loop wraps, queued switches, next songs
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
    var col = loopBar >= 0 ? loopBar * 16 + (elapsed / perMs) % 16 : (elapsed / perMs) % cols();
    var pb = Math.floor(col / 16);
    if (loopBar < 0 && !viewPinned && pb !== viewBar) {
      viewBar = pb;
      renderBars(); renderGrid();
    } else if (pb !== lastPlayBar) renderBars();
    updatePh(pb === viewBar ? Math.floor(col) % 16 : -1);
    scheduleTick();
  }

  // nudge this voice's bar left/right (wrapping), or move it an octave
  function shiftBar(dir) {
    var cellsHere = barCells();
    if (!cellsHere.length) return;
    snapshot();
    cellsHere.forEach(function (x) {
      var s2 = (x.c - viewBar * 16 + dir + 16) % 16;
      x.c = viewBar * 16 + s2;
    });
    dirty();
  }
  function octaveBar(delta) {
    var cellsHere = barCells().filter(function (x) { return x.r < MEL_ROWS; });
    if (!cellsHere.length) return;
    snapshot();
    cellsHere.forEach(function (x) {
      var nd = Math.max(0, Math.min(MEL_ROWS - 1, degOfCell(x) + delta));
      applyDeg(x, nd);
    });
    dirty();
    auditionCell(cellsHere[0]);
  }

  // ---- bar operations ------------------------------------------------------
  function addBar() {
    if (S.bars >= 63) return;
    snapshot(); S.bars++; viewBar = S.bars - 1; viewPinned = true;
    if (loopBar >= 0) loopBar = viewBar;
    dirty(); renderBars();
  }
  function dupBar(b) {
    if (S.bars >= 63) return;
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
    S.bars++; viewBar = b + 1; viewPinned = true;
    if (loopBar >= 0) loopBar = viewBar;
    dirty();
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
    dirty();
  }

  // ---- build the screen ----------------------------------------------------
  var CHIPS = ['happy', 'sad', 'upbeat', 'chill', 'spooky', 'epic', 'retro', 'funky', 'dreamy', 'battle'];
  function buildUI() {
    root.innerHTML =
      '<div class="cr-top">' +
        '<button type="button" class="cr-btn n-play" data-cr="play" data-tip="Play or pause (Space)">▶</button>' +
        '<button type="button" class="cr-btn" data-cr="rewind" data-tip="Back to the top">\u23ee</button>' +
        '<label class="cr-lab" data-tip="Tempo">' + S.bpm + ' BPM<input type="range" min="70" max="180" step="2" value="' + S.bpm + '" data-cr="bpm"></label>' +
        '<span class="cr-sep"></span>' +
        '<button type="button" class="cr-btn" data-cr="undo" data-tip="Undo">↩</button>' +
        '<button type="button" class="cr-btn" data-cr="redo" data-tip="Redo">↪</button>' +
        '<button type="button" class="cr-btn" data-cr="dice" data-tip="Compose a surprise track">🎲</button>' +
        '<button type="button" class="cr-btn" data-cr="shelf" data-tip="Your saved songs">Songs</button>' +
        '<button type="button" class="cr-btn" data-cr="sharemenu" data-tip="Link, WAV, or a real cartridge">Share</button>' +
        '<button type="button" class="cr-btn cr-close" data-cr="close" data-tip="Back to the radio (Esc)">×</button>' +
      '</div>' +
      '<div class="n-moodrow">' +
        '<input type="text" class="cr-mood" data-cr="mood" placeholder="a mood: happy, spooky, fast..." maxlength="60">' +
        '<button type="button" class="cr-btn cr-primary" data-cr="make">Make</button>' +
        CHIPS.map(function (c) { return '<button type="button" class="cr-chip" data-mood="' + c + '">' + c + '</button>'; }).join('') +
      '</div>' +
      '<div class="n-mid"><div class="n-gridwrap"><div class="n-cap"></div><div class="n-grid"></div>' +
      '<div class="n-params">' +
        PARAMS.map(function (pp) {
          return '<button type="button" class="n-param" data-param="' + pp.id + '" title="' + pp.n + '" data-tip="' + pp.tip + '">' + pp.n + '</button>';
        }).join('') +
        '<span class="cr-sep"></span>' +
        '<button type="button" class="cr-btn n-tool" data-cr="shiftl" data-tip="Nudge this bar\u2019s notes one step earlier">\u25c0</button>' +
        '<button type="button" class="cr-btn n-tool" data-cr="shiftr" data-tip="Nudge this bar\u2019s notes one step later">\u25b6</button>' +
        '<button type="button" class="cr-btn n-tool" data-cr="octdn" data-tip="This voice\u2019s bar an octave down">Oct\u2212</button>' +
        '<button type="button" class="cr-btn n-tool" data-cr="octup" data-tip="This voice\u2019s bar an octave up">Oct+</button>' +
        '<button type="button" class="cr-btn n-tool" data-cr="swing" data-tip="Swing: the offbeats lean late">Swing</button>' +
      '</div></div></div>' +
      '<div class="n-chans">' + CH.map(function (c, i) {
        return '<button type="button" class="n-chan" data-ch="' + i + '" title="' + c.tip + '" data-tip="' + c.tip + '"><span>' + c.n + '</span></button>';
      }).join('') + '</div>' +
      '<div class="n-bars">' +
        '<button type="button" class="cr-btn n-loopbtn" data-cr="loop" data-tip="Loop this bar">↺</button>' +
        '<div class="n-barstrip"></div>' +
        '<button type="button" class="cr-btn" data-cr="baradd" data-tip="Add a bar">+</button>' +
        '<button type="button" class="cr-btn" data-cr="bardup" data-tip="Duplicate this bar">⧉</button>' +
        '<button type="button" class="cr-btn" data-cr="bardel" data-tip="Remove this bar">−</button>' +
      '</div>' +
      '<div class="cr-hint"></div>';
    var grid = root.querySelector('.n-grid');
    stepEls = [];
    for (var s = 0; s < 16; s++) {
      var el = document.createElement('div');
      el.className = 'n-step' + (s % 4 === 0 ? ' beat' : '');
      el.dataset.i = s;
      el.innerHTML = '<u>' + (s + 1) + '</u><i class="pb"></i><span class="nn"></span><b class="ln"></b>';
      grid.appendChild(el);
      stepEls.push(el);
    }
  }

  // ---- input ---------------------------------------------------------------
  function wireEvents() {
    // Space plays/pauses (typing in an input keeps its spaces)
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' || !isOpen() || ev.metaKey || ev.altKey || ev.ctrlKey) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
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
    root.addEventListener('mouseover', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-tip]');
      if (t) hint(t.dataset.tip);
    });

    // the step grid: tap toggles, vertical drag pitches, horizontal stretches
    var grid = root.querySelector('.n-grid'), sdrag = null;
    grid.addEventListener('pointerdown', function (ev) {
      var el = ev.target.closest('.n-step'); if (!el) return;
      ev.preventDefault(); grid.setPointerCapture(ev.pointerId);
      var step = +el.dataset.i, col = viewBar * 16 + step;
      snapshot();
      var i = cellIndexAt(viewCh, col), created = false, cell;
      if (i < 0) {
        cell = makeCell(viewCh, col, lastDeg[viewCh]);
        created = true;
        dirty(); auditionCell(cell); tourAdvance(0);
      } else cell = S.cells[i];
      sdrag = { cell: cell, created: created, sx: ev.clientX, sy: ev.clientY,
                deg: degOfCell(cell), len: cell.len || 1,
                vol: Math.round((cell.vel != null ? cell.vel : 0.8) * 8), axis: 0, pokeAt: 0 };
    });
    grid.addEventListener('pointermove', function (ev) {
      if (!sdrag) return;
      var dx = ev.clientX - sdrag.sx, dy = ev.clientY - sdrag.sy;
      if (!sdrag.axis) {
        if (Math.abs(dy) > 9) sdrag.axis = 'y';
        else if (Math.abs(dx) > 12) sdrag.axis = 'x';
        else return;
      }
      if (sdrag.axis === 'y') {
        if (param === 'vol') {
          var nv = Math.max(0, Math.min(8, sdrag.vol + Math.round(-dy / 22)));
          if (nv / 8 !== (sdrag.cell.vel != null ? sdrag.cell.vel : 0.8)) {
            sdrag.cell.vel = nv / 8;
            dirty();
            var tv = performance.now();
            if (nv > 0 && tv - sdrag.pokeAt > 110) { sdrag.pokeAt = tv; auditionCell(sdrag.cell); }
          }
          return;
        }
        if (param === 'len') {
          var nl2 = Math.max(1, Math.min(16, sdrag.len + Math.round(-dy / 24)));
          if (nl2 !== (sdrag.cell.len || 1)) {
            if (nl2 > 1) sdrag.cell.len = nl2; else delete sdrag.cell.len;
            dirty();
          }
          return;
        }
        var span = viewCh === 3 ? 2 : MEL_ROWS - 1;
        var per = viewCh === 3 ? 30 : 16;
        var nd = Math.max(0, Math.min(span, sdrag.deg + Math.round(-dy / per)));
        if (nd !== degOfCell(sdrag.cell)) {
          applyDeg(sdrag.cell, nd);
          lastDeg[viewCh] = nd;
          dirty();
          var t = performance.now();
          if (t - sdrag.pokeAt > 90) { sdrag.pokeAt = t; auditionCell(sdrag.cell); }
        }
      } else {
        var nl = Math.max(1, Math.min(16, sdrag.len + Math.round(dx / 30)));
        if (nl !== (sdrag.cell.len || 1)) {
          if (nl > 1) sdrag.cell.len = nl; else delete sdrag.cell.len;
          dirty();
        }
      }
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      grid.addEventListener(t, function () {
        if (sdrag && !sdrag.axis && !sdrag.created) {
          var i = S.cells.indexOf(sdrag.cell);
          if (i >= 0) { S.cells.splice(i, 1); dirty(); }
        }
        sdrag = null;
      });
    });

    // channels: tap switches, tap the lit one mutes, hold opens its sound
    var chans = root.querySelector('.n-chans'), holdTimer = 0, holdFired = false;
    chans.addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest('.n-chan'); if (!b) return;
      holdFired = false;
      var ch = +b.dataset.ch;
      holdTimer = setTimeout(function () {
        holdFired = true;
        if (ch !== 3) { viewCh = ch; renderChans(); renderGrid(); openPad(ch); }
      }, 480);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      chans.addEventListener(t, function () { clearTimeout(holdTimer); });
    });
    chans.addEventListener('click', function (ev) {
      var b = ev.target.closest('.n-chan'); if (!b || holdFired) return;
      var ch = +b.dataset.ch;
      if (viewCh === ch) {
        chMuted[ch] = !chMuted[ch];
        applyMute();
        hint(CH[ch].n + (chMuted[ch] ? ' is silenced. Tap again to bring it back.' : ' is back.'));
      } else {
        viewCh = ch;
        renderChans(); renderGrid();
        hint(CH[ch].tip);
        tourAdvance(1);
      }
    });

    // bars
    root.querySelector('.n-bars').addEventListener('click', function (ev) {
      var bb = ev.target.closest('.n-bar');
      if (bb) {
        var b = +bb.dataset.bar;
        if (loopBar >= 0) {
          setLoopBar(b);
          if (loopBar >= 0) viewBar = loopBar;
        } else {
          viewBar = b; viewPinned = true;
        }
        renderBars(); renderGrid();
        return;
      }
    });

    root.addEventListener('click', function (ev) {
      var fb = ev.target.closest('button'); if (fb) fb.blur();
      var tb = ev.target.closest('[data-tour]');
      if (tb) {
        if (tb.dataset.tour === 'skip') tourDone(); else tourAdvance(tourStep);
        return;
      }
      var shb = ev.target.closest('[data-shelf],[data-shelf-load],[data-shelf-del]');
      if (shb) {
        var list = loadShelf();
        if (shb.dataset.shelf === 'save') {
          var ni = root.querySelector('.cr-shelfname');
          var name = (ni && ni.value.trim()) || 'Song ' + (list.length + 1);
          list.unshift({ name: name, enc: encode(), ts: 0 });
          saveShelf(list); renderShelf();
          hint('Saved "' + name + '" to this browser.');
        } else if (shb.dataset.shelfLoad != null) {
          var it = list[+shb.dataset.shelfLoad];
          var st = it && decode(it.enc);
          if (st) {
            snapshot(); dropLiveScore();
            S = st; order = S.cells.length;
            loopBar = -1; queuedBar = null; viewBar = 0; viewPinned = false; pausedAt = 0;
            var lab = root.querySelector('.cr-lab');
            if (lab) { lab.firstChild.textContent = S.bpm + ' BPM'; var sl = lab.querySelector('input'); if (sl) sl.value = S.bpm; }
            dirty(); startPlayback(0);
            hint('Loaded "' + it.name + '".');
          }
        } else if (shb.dataset.shelfDel != null) {
          list.splice(+shb.dataset.shelfDel, 1);
          saveShelf(list); renderShelf();
        }
        return;
      }
      var pp = ev.target.closest('.n-param');
      if (pp) {
        var pid = pp.dataset.param;
        if (param === pid) randomizeParam(pid);
        else { param = pid; randTaps = 1; clearTimeout(randTimer); randTimer = setTimeout(function () { randTaps = 0; randSnapped = false; }, 700); }
        renderParams();
        hint(PARAMS.filter(function (q) { return q.id === pid; })[0].tip);
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
      else if (k === 'rewind') { pausedAt = 0; if (playing) startPlayback(0); else renderBars(); hint('Back to the top.'); }
      else if (k === 'shiftl' || k === 'shiftr') { shiftBar(k === 'shiftr' ? 1 : -1); }
      else if (k === 'octdn' || k === 'octup') { octaveBar(k === 'octup' ? 7 : -7); }
      else if (k === 'swing') { snapshot(); S.swing = S.swing ? 0 : 1; b.classList.toggle('on', !!S.swing); dirty(); hint(S.swing ? 'Swinging.' : 'Straight time.'); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'dice') { composeIntoGrid(''); }
      else if (k === 'make') { var mv = root.querySelector('.cr-mood'); composeIntoGrid(mv ? mv.value : ''); }
      else if (k === 'shelf') { toggleShelf(); }
      else if (k === 'loop') { setLoopBar(viewBar); renderAll(); }
      else if (k === 'baradd') { addBar(); }
      else if (k === 'bardup') { dupBar(viewBar); }
      else if (k === 'bardel') { delBar(viewBar); }
      else if (k === 'sharemenu') { toggleShare(); }
      else if (k === 'share') {
        try { navigator.clipboard.writeText(location.origin + '/create#s=' + encode()); if (G._toast) G._toast('Link copied. The link IS the song 🎵'); } catch (e) {}
        toggleShare();
      }
      else if (k === 'wav') { exportWav(); toggleShare(); }
      else if (k === 'rom') { exportRom(); toggleShare(); }
    });
    root.addEventListener('input', function (ev) {
      var b = ev.target.closest('[data-cr="bpm"]'); if (!b) return;
      dropLiveScore();
      S.bpm = +b.value; b.parentNode.firstChild.textContent = S.bpm + ' BPM';
      dirty();
    });
  }
  function toggleShare() {
    var sp = root.querySelector('.cr-sharepop');
    if (sp) { sp.remove(); return; }
    sp = document.createElement('div');
    sp.className = 'cr-sharepop';
    sp.innerHTML = '<button type="button" class="cr-btn" data-cr="share">Copy link</button>' +
      '<button type="button" class="cr-btn" data-cr="wav">WAV</button>' +
      '<button type="button" class="cr-btn" data-cr="rom">Game Boy ROM</button>';
    root.appendChild(sp);
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
    document.body.appendChild(root);
    buildUI();
    wireEvents();
    requestAnimationFrame(function () { root.classList.add('show'); renderAll(); });
    document.body.classList.add('create-open');
    armChip();
    try { history.replaceState(null, '', '/create' + (S.cells.length ? '#s=' + encode() : '')); } catch (e) {}
    hint('');
    // never a blank page, never a dead room: a song is already here, and the
    // transport is already running
    if (!S.cells.length && G.CT_COMPOSERS) {
      var m0 = ['chill', 'happy', 'dreamy', 'funky'][Math.floor(Math.random() * 4)];
      var mi0 = root.querySelector('.cr-mood'); if (mi0) mi0.value = m0;
      composeIntoGrid(m0);
      hint('A ' + m0 + ' song is already rolling. Type a mood, or take the pencil to it.');
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
    closePad();
    if (root) root.classList.remove('show');
    document.body.classList.remove('create-open');
    try { history.replaceState(null, '', '/'); } catch (e) {}
    if (G._closeCreateReturn) G._closeCreateReturn();
  }
  function isOpen() { return !!(root && root.classList.contains('show')); }

  G.CT_CREATE = { open: open, close: close, isOpen: isOpen, togglePlay: togglePlay,
    _dbg: function () {
      var mx = 0, withInst = 0, hist = [0, 0, 0, 0];
      if (S) S.cells.forEach(function (x) { if ((x.len || 1) > mx) mx = x.len || 1; if (x.inst != null) withInst++;
                                            try { hist[chOfCell(x)]++; } catch (e) {} });
      return { playing: playing, live: !!liveScore, bars: S ? S.bars : 0,
               viewBar: viewBar, viewCh: viewCh, loopBar: loopBar, queued: queuedBar,
               cells: S ? S.cells.length : 0, withInst: withInst, maxLen: mx,
               notes: S ? buildSong().notes.length : 0, chHist: hist, mood: liveMood }; },
    _skipToEnd: function () { if (playing && liveScore) playT0 = performance.now() - songMs() - 300; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CT_CREATE;
})(typeof globalThis !== 'undefined' ? globalThis : window);
