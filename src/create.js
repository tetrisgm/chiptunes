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
    var go = function (ev) {
      gestured = true;
      try { if (typeof Audio !== 'undefined' && Audio.resume) Audio.resume(true); } catch (e) {}
      // if the gesture WAS the transport button, let its own handler decide,
      // or we would start here and it would immediately pause again
      var onPlay = ev && ev.target && ev.target.closest && ev.target.closest('[data-cr="play"]');
      if (!onPlay && wantStart && isOpen()) { wantStart = false; startPlayback(pausedAt); }
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      armGesture.done = false;
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }
  function startPlayback(fromMs) {
    clearTimeout(repostTimer);
    camFollow = true;
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
    viewBar = 0; camX = 0; camFollow = true; selCol = -1; selCh = -1;
    if (root.querySelector('.n-track')) { buildTrack(); }
    pausedAt = 0;
    dirty();
    startPlayback(0);   // after dirty: its clearTimeout cancels the queued repost,
                        // which used to seek past the song's first notes
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
      ['This song was just written for you.', 'Each square is one moment of a bar. Tap a note to edit it below; tap an empty square (with a voice picked) to add one.'],
      ['Four voices, like a tiny band.', 'All shows everything at once. Melody, Harmony, Bass and Drums are the Game Boy\u2019s four sounds: pick one to add notes, tap its speaker to mute it.'],
      ['The song scrolls sideways.', 'Bars sit next to each other. Drag a bar\u2019s strip to travel; its little buttons nudge, loop, duplicate or remove it. The dashed block at the end adds a bar.'],
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
    var heldSteps = Math.max(1, cell.len || 1);            // hear it for as long as it lasts
    Audio.pokeCreate({ ch: voice === 'wave' ? 2 : 1, frames: Math.min(600, Math.round(per * heldSteps)),
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
  var stepEls = [], lastPh = -1, lastPlayBar = -1;
  var camX = 0, camFollow = true;
  function renderTransport() {
    var b = root.querySelector('[data-cr="play"]');
    if (b) {
      b.textContent = playing ? '\u275a\u275a Pause' : '\u25b6 Play';
      b.classList.toggle('waiting', !playing && wantStart);
    }
  }
  function renderChans() {
    root.querySelectorAll('.n-tab').forEach(function (b) {
      var i = +b.dataset.ch;
      b.classList.toggle('sel', viewCh === i);
      if (i < 0) return;
      b.classList.toggle('muted', !!chMuted[i]);
      b.style.color = CH[i].color;
      var spk = b.querySelector('.n-spk');
      if (spk) spk.textContent = chMuted[i] ? '\ud83d\udd07' : '\ud83d\udd08';
      var ic = chanIcon(i);
      var old = b.querySelector('canvas');
      if (old !== ic) { if (old) old.remove(); b.insertBefore(ic, b.firstChild); }
    });
  }
  function renderBars() {
    var pb = -1;
    if (playing) {
      var perMs = (60 / curBpm() / 4) * 1000;
      var col = loopBar >= 0 ? loopBar * 16 : ((performance.now() - playT0) / perMs) % cols();
      pb = loopBar >= 0 ? loopBar : Math.floor(col / 16);
    }
    lastPlayBar = pb;
    root.querySelectorAll('.n-bb').forEach(function (el) {
      var b = +el.dataset.bar;
      el.classList.toggle('view', b === viewBar);
      el.classList.toggle('loop', b === loopBar);
      el.classList.toggle('queued', b === queuedBar);
      el.classList.toggle('play', b === pb);
    });
    root.querySelectorAll('.n-bblabel').forEach(function (el) {
      var lb = +el.parentNode.dataset.bar;
      el.textContent = '#' + (lb + 1) + (lb === loopBar ? ' \u00b7 looping' : '');
    });
    applyCam();
  }
  function renderGrid() {
    if (!stepEls.length) return;
    var track = root.querySelector('.n-track');
    track.classList.toggle('allview', viewCh < 0);
    if (viewCh < 0) { renderGridAll(track); return; }
    track.style.color = CH[viewCh].color;
    var mutedCh = !!effMask()[viewCh];
    track.classList.toggle('chmuted', mutedCh);
    for (var i = 0; i < stepEls.length; i++) {
      var el = stepEls[i], col = +el.dataset.col;
      var ci = cellIndexAt(viewCh, col);
      var tail = ci < 0 ? tailIndexAt(viewCh, col) : -1;
      var x = ci >= 0 ? S.cells[ci] : null;
      el.classList.toggle('on', !!x);
      el.classList.toggle('tail', tail >= 0);
      el.classList.toggle('sulk', !!(x && x.x));
      el.classList.toggle('sel', selCh === viewCh && selCol === col);
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
        lnEl.textContent = (x.len || 1) > 1 ? '\u00d7' + x.len : '';
      } else {
        el.classList.remove('rest');
        pbEl.style.opacity = '';
        nnEl.textContent = ''; lnEl.textContent = '';
      }
    }
  }
  // All: every voice in one grid, a labelled pill per voice per step
  // All: only what is actually sounding. Empty squares stay empty.
  function renderGridAll(track) {
    track.classList.remove('chmuted');
    track.style.color = 'rgba(232,227,250,0.9)';
    var em = effMask();
    for (var i = 0; i < stepEls.length; i++) {
      var el = stepEls[i], col = +el.dataset.col;
      var pills = '', any = false;
      for (var ch = 0; ch < 4; ch++) {
        var ci = cellIndexAt(ch, col);
        var x = ci >= 0 ? S.cells[ci] : null;
        if (!x) {
          // an empty slot draws nothing; a still-ringing note gets a hairline
          pills += tailIndexAt(ch, col) >= 0
            ? '<em class="tl"><s style="background:' + CH[ch].color + '"></s></em>'
            : '<em class="sp"></em>';
          continue;
        }
        any = true;
        var vel = x.vel != null ? x.vel : 0.8;
        var label = vel === 0 ? '\u2013' : (x.r >= MEL_ROWS ? DRUM_NAMES[x.r - MEL_ROWS]
                                     : noteName(x.midi != null ? x.midi : rowMidi(x.r)));
        pills += '<em class="pl' + (x.x ? ' sulk' : '') + (em[ch] ? ' off' : '') +
                 (selCh === ch && selCol === col ? ' sel' : '') + '" data-pill="' + ch + '" style="color:' + CH[ch].color +
                 ';border-color:' + CH[ch].color + '">' + label + '</em>';
      }
      el.classList.toggle('on', any);
      el.classList.toggle('sel', selCol === col && selCh >= 0);
      el.classList.remove('tail', 'rest', 'sulk');
      el.querySelector('.allpills').innerHTML = pills;
    }
  }
  // The note editor: what a selected square holds, in words and buttons.
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
  function renderEdit() {
    var ed = root.querySelector('.n-edit');
    if (!ed) return;
    var x = selCell();
    var ch = x ? selCh : pen.ch;
    var isDrum = x ? x.r >= MEL_ROWS : ch === 3;
    var midi = x ? (x.midi != null ? x.midi : rowMidi(x.r)) : pen.midi;
    var drum = x ? (x.r - MEL_ROWS) : pen.drum;
    var vsteps = Math.round((x ? (x.vel != null ? x.vel : 0.8) : pen.vel) * 8);
    var len = x ? (x.len || 1) : pen.len;

    var html = '<div class="n-edcol n-edwho">' +
      '<span class="n-edlab">' + (x ? 'This note' : 'Next note') + '</span>' +
      '<b>' + (x ? CH[selCh].n + ' \u00b7 bar ' + (Math.floor(selCol / 16) + 1) + ' \u00b7 step ' + (selCol % 16 + 1)
                 : 'tap a square to place it') + '</b></div>';

    if (!x) {
      html += '<div class="n-edcol"><span class="n-edlab">Voice</span><div class="n-edbtns">' +
        CH.map(function (c, i) {
          return '<button type="button" class="n-edb n-edvoice' + (pen.ch === i ? ' on' : '') + '" data-pen="v' + i + '">' +
                 '<em style="color:' + c.color + '">' + c.n + '</em></button>';
        }).join('') + '</div></div>';
    }
    if (isDrum) {
      html += '<div class="n-edcol"><span class="n-edlab">Drum</span><div class="n-edbtns">' +
        DRUM_NAMES.map(function (dn, di) {
          return '<button type="button" class="n-edb' + (drum === di ? ' on' : '') + '" data-ed="d' + di + '">' + dn + '</button>';
        }).join('') + '</div></div>';
    } else {
      html += '<div class="n-edcol"><span class="n-edlab">Pitch</span><div class="n-edbtns">' +
        '<button type="button" class="n-edb" data-ed="oct-">Octave down</button>' +
        '<button type="button" class="n-edb" data-ed="pitch-">Lower</button>' +
        '<b class="n-edval">' + noteName(midi) + '</b>' +
        '<button type="button" class="n-edb" data-ed="pitch+">Higher</button>' +
        '<button type="button" class="n-edb" data-ed="oct+">Octave up</button>' +
        '</div></div>';
    }
    html += '<div class="n-edcol"><span class="n-edlab">Volume</span><div class="n-edbtns">' +
      '<button type="button" class="n-edb" data-ed="vol-">Softer</button>' +
      '<b class="n-edval">' + (vsteps === 0 ? 'silent' : vsteps + ' / 8') + '</b>' +
      '<button type="button" class="n-edb" data-ed="vol+">Louder</button>' +
      '</div></div>';
    html += '<div class="n-edcol"><span class="n-edlab">Length</span><div class="n-edbtns">' +
      '<button type="button" class="n-edb" data-ed="len-">Shorter</button>' +
      '<b class="n-edval">' + len + ' step' + (len > 1 ? 's' : '') + '</b>' +
      '<button type="button" class="n-edb" data-ed="len+">Longer</button>' +
      '</div></div>';
    if (ch !== 3) {
      html += '<div class="n-edcol"><span class="n-edlab">Sound</span><div class="n-edbtns">' +
        '<button type="button" class="n-edb" data-ed="sound">Choose\u2026</button></div></div>';
    }
    if (x) html += '<div class="n-edcol"><span class="n-edlab">&nbsp;</span>' +
      '<button type="button" class="n-eddel" data-ed="del">Remove note</button></div>';
    ed.innerHTML = html;
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
    if (what === 'sound') { openPad(x ? selCh : pen.ch); return; }
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
    if (pen.ch === 3) { c.r = MEL_ROWS + pen.drum; }
    else {
      c.r = rowForMidi(pen.midi); c.midi = pen.midi;
      c.st = CH[pen.ch].stamp;
      if (pen.ch < 2) c.ch = pen.ch;
      if (chInst[pen.ch] != null) c.inst = chInst[pen.ch];
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
  function updatePh(col) {
    if (col === lastPh) return;
    if (lastPh >= 0 && stepEls[lastPh]) stepEls[lastPh].classList.remove('ph');
    if (col >= 0 && stepEls[col]) stepEls[col].classList.add('ph');
    lastPh = col;
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
    if (location.pathname !== '/create') ownRoute(encode());   // something else moved the URL; take it back, song and all
    var col = loopBar >= 0 ? loopBar * 16 + (elapsed / perMs) % 16 : (elapsed / perMs) % cols();
    var pb = Math.floor(col / 16);
    if (camFollow) { centerOn(pb, false); applyCam(); }
    if (pb !== viewBar) { viewBar = pb; renderBars(); }
    else if (pb !== lastPlayBar) renderBars();
    updatePh(Math.floor(col));
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
  function addBar() {
    if (S.bars >= 48) { hint('48 bars is the limit \u2014 that is about a minute and a half.'); return; }
    snapshot(); S.bars++; viewBar = S.bars - 1;
    if (loopBar >= 0) loopBar = viewBar;
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
  var CHIPS = ['happy', 'sad', 'upbeat', 'chill', 'spooky', 'epic', 'retro', 'funky', 'dreamy', 'battle'];
  function buildUI() {
    root.innerHTML =
      '<div class="n-utils">' +
        '<button type="button" class="cr-btn" data-cr="undo">\u21a9 Undo</button>' +
        '<button type="button" class="cr-btn" data-cr="redo">\u21aa Redo</button>' +
        '<button type="button" class="cr-btn" data-cr="share">Copy link</button>' +
        '<button type="button" class="cr-btn" data-cr="wav">Save WAV</button>' +
        '<button type="button" class="cr-btn" data-cr="rom">Save cartridge</button>' +
        '<button type="button" class="cr-btn cr-close" data-cr="close">Close</button>' +
      '</div>' +
      '<div class="n-moodrow"><span class="n-moodlab">Write me a song that is\u2026</span>' +
        '<span class="n-moodchips">' +
        CHIPS.map(function (c) { return '<button type="button" class="cr-chip" data-mood="' + c + '">' + c + '</button>'; }).join('') +
        '</span></div>' +
      '<div class="n-tabs">' +
        '<button type="button" class="n-tab n-all" data-ch="-1">All</button>' +
        CH.map(function (c, i) {
          return '<button type="button" class="n-tab" data-ch="' + i + '">' +
                 '<span>' + c.n + '</span>' +
                 '<i class="n-spk" data-mute="' + i + '"></i></button>';
        }).join('') + '</div>' +
      '<div class="n-mid"><div class="n-track"></div></div>' +
      '<div class="n-edit"></div>' +
      '<div class="n-transport">' +
        '<button type="button" class="cr-btn" data-cr="rewind">\u23ee Start</button>' +
        '<button type="button" class="cr-btn cr-primary n-play" data-cr="play">\u25b6 Play</button>' +
        '<label class="cr-lab">Speed <b class="n-bpmval">' + S.bpm + '</b> BPM' +
        '<input type="range" min="70" max="180" step="2" value="' + S.bpm + '" data-cr="bpm"></label>' +
      '</div>';
    buildTrack();
  }
  // one 4x4 block per bar; its own tools sit UNDER it, then its name
  function buildTrack() {
    var track = root.querySelector('.n-track');
    var html = '';
    for (var b = 0; b < S.bars; b++) {
      html += '<div class="n-bb" data-bar="' + b + '"><div class="n-bblabel"></div><div class="n-bbgrid">';
      for (var s2 = 0; s2 < 16; s2++) {
        html += '<div class="n-step' + (s2 % 4 === 0 ? ' beat' : '') + '" data-col="' + (b * 16 + s2) + '">' +
                '<u>' + (s2 + 1) + '</u><i class="pb"></i><span class="nn"></span><b class="ln"></b>' +
                '<div class="allpills"></div></div>';
      }
      html += '</div><div class="n-bbtools">' +
              '<button type="button" class="n-hb" data-barshift="-1" data-bar="' + b + '">\u25c0 Earlier</button>' +
              '<button type="button" class="n-hb" data-barshift="1" data-bar="' + b + '">Later \u25b6</button>' +
              '<button type="button" class="n-hb n-lp" data-loopbar="' + b + '">\u21ba Loop</button>' +
              '<button type="button" class="n-hb" data-dupbar="' + b + '">\u29c9 Copy</button>' +
              '<button type="button" class="n-hb" data-delbar="' + b + '">\u2212 Delete</button>' +
              '</div></div>';
    }
    html += '<button type="button" class="n-addbar" data-cr="baradd"><b>+</b><span>add a bar</span></button>';
    track.innerHTML = html;
    stepEls = [].slice.call(track.querySelectorAll('.n-step'));
    sizeTrack();
  }

  var bbW = 0, bbGap = 18, trackPad = 8;
  function sizeTrack() {
    var mid = root.querySelector('.n-mid');
    if (!mid) return;
    var r = mid.getBoundingClientRect();
    if (!r.width || !r.height) return;
    bbGap = r.width < 520 ? 26 : 52;           // bars need air between them to read as separate
    // the block is the grid PLUS its tools row and its name line
    var reserve = r.width < 520 ? 84 : 92;     // the name line above, the tools row below
    bbW = Math.max(140, Math.min(r.width * (r.width < 520 ? 0.9 : 0.52), r.height - reserve, 560));
    root.style.setProperty('--bbw', bbW + 'px');
    root.style.setProperty('--bbgap', bbGap + 'px');
    // half a screen of air at each end, so the FIRST and LAST bars can sit
    // in the middle exactly like every bar between them
    trackPad = Math.max(8, Math.round((r.width - bbW) / 2));
    root.style.setProperty('--trackpad', trackPad + 'px');
  }
  function trackStride() { return bbW + bbGap; }
  function camMax() {
    var mid = root.querySelector('.n-mid'), track = root.querySelector('.n-track');
    var w = mid ? mid.getBoundingClientRect().width : 0;
    return Math.max(0, (track ? track.scrollWidth : 0) - w);
  }
  function centerOn(bar, snap) {
    var mid = root.querySelector('.n-mid');
    var w = mid ? mid.getBoundingClientRect().width : 0;
    var want = Math.max(0, Math.min(camMax(), trackPad + bar * trackStride() - (w - bbW) / 2));
    camX = snap ? want : camX + (want - camX) * (Math.abs(want - camX) > w ? 1 : 0.18);
  }
  function applyCam() {
    var track = root.querySelector('.n-track');
    if (track) track.style.transform = 'translateX(' + (-Math.round(camX)) + 'px)';
    // the voice tabs ride directly above the bar you are on
    var tabs = root.querySelector('.n-tabs');
    if (tabs) tabs.style.transform = 'translateX(' + Math.round(trackPad + viewBar * trackStride() - camX) + 'px)';
  }
  function barUnderCamera() {
    var mid = root.querySelector('.n-mid');
    var w = mid ? mid.getBoundingClientRect().width : 0;
    return Math.max(0, Math.min(S.bars - 1, Math.round((camX + w / 2 - bbW / 2 - trackPad) / trackStride())));
  }

  // ---- input ---------------------------------------------------------------
  function wireEvents() {
    // Space plays/pauses
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' || !isOpen() || ev.metaKey || ev.altKey || ev.ctrlKey) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      ev.preventDefault(); ev.stopPropagation();
      togglePlay();
    }, true);

    var mid = root.querySelector('.n-mid'), pan = null;

    // a square: tap an empty one to add a note, tap a note to edit it below
    mid.addEventListener('click', function (ev) {
      if (ev.target.closest('.n-bbhead') || ev.target.closest('.n-addbar')) return;
      var el = ev.target.closest('.n-step'); if (!el) return;
      var col = +el.dataset.col;
      viewBar = Math.floor(col / 16);
      var pill = ev.target.closest('[data-pill]');
      if (pill) {                                   // All view: that voice's note
        var pc = +pill.dataset.pill;
        selectNote(pc, col);
        auditionCell(S.cells[cellIndexAt(pc, col)]);
        return;
      }
      // a square that already holds (or is inside) a note: select and hear it
      var order2 = viewCh < 0 ? [0, 1, 2, 3] : [viewCh];
      for (var oi = 0; oi < order2.length; oi++) {
        var ch2 = order2[oi], hit = cellIndexAt(ch2, col);
        if (hit < 0 && viewCh >= 0) hit = tailIndexAt(ch2, col);
        if (hit >= 0) {
          var cellHit = S.cells[hit];
          selectNote(ch2, cellHit.c);
          auditionCell(cellHit);
          return;
        }
      }
      // empty: place the note the panel below is describing
      snapshot();
      var made = penCell(col);
      S.cells.push(made);
      selCh = pen.ch; selCol = col;
      dirty(); renderEdit(); auditionCell(made); tourAdvance(0);
      hint('Placed a ' + (pen.ch === 3 ? DRUM_NAMES[pen.drum] : noteName(pen.midi)) + '. Change it below, or tap elsewhere to place another.');
    });

    // the bar heads: pan by dragging, and carry the bar's own tools
    mid.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.n-step') || ev.target.closest('button')) return;
      ev.preventDefault(); mid.setPointerCapture(ev.pointerId);
      pan = { x: ev.clientX, cam: camX };
      camFollow = false;
    });
    mid.addEventListener('pointermove', function (ev) {
      if (!pan) return;
      camX = Math.max(0, Math.min(camMax(), pan.cam - (ev.clientX - pan.x)));
      applyCam();
      var nb = barUnderCamera();
      if (nb !== viewBar) { viewBar = nb; renderBars(); }
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      mid.addEventListener(t, function () { pan = null; });
    });
    mid.addEventListener('wheel', function (ev) {
      if (camMax() <= 0) return;
      ev.preventDefault();
      camFollow = false;
      camX = Math.max(0, Math.min(camMax(), camX + (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY)));
      applyCam();
      var nb2 = barUnderCamera();
      if (nb2 !== viewBar) { viewBar = nb2; renderBars(); }
    }, { passive: false });

    // voice tabs: tap to work on a voice, tap the speaker to mute it
    var tabs = root.querySelector('.n-tabs'), holdTimer = 0, holdFired = false;
    tabs.addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest('.n-tab');
      if (!b || ev.target.closest('[data-mute]')) return;
      holdFired = false;
      var ch = +b.dataset.ch;
      if (ch < 0) return;
      holdTimer = setTimeout(function () {
        holdFired = true;
        viewCh = ch; renderChans(); renderGrid(); renderBars(); openPad(ch);
      }, 480);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      tabs.addEventListener(t, function () { clearTimeout(holdTimer); });
    });
    tabs.addEventListener('click', function (ev) {
      var mb = ev.target.closest('[data-mute]');
      if (mb) {
        ev.stopPropagation();
        var mi = +mb.dataset.mute;
        chMuted[mi] = !chMuted[mi];
        applyMute();
        hint(CH[mi].n + (chMuted[mi] ? ' is muted. Tap the speaker again to bring it back.' : ' is back.'));
        return;
      }
      var b = ev.target.closest('.n-tab'); if (!b || holdFired) return;
      var ch = +b.dataset.ch;
      viewCh = ch;
      if (ch >= 0) { pen.ch = ch; if (selCh !== ch) { selCol = -1; selCh = -1; } }
      renderChans(); renderGrid(); renderBars(); renderEdit();
      hint(ch < 0 ? 'Every voice at once. Tap a note to hear and edit it; tap an empty square to place the note shown below.'
                  : CH[ch].tip);
      tourAdvance(1);
    });

    root.addEventListener('click', function (ev) {
      var fb = ev.target.closest('button'); if (fb) fb.blur();
      var tb = ev.target.closest('[data-tour]');
      if (tb) {
        if (tb.dataset.tour === 'skip') tourDone(); else tourAdvance(tourStep);
        return;
      }
      var edb = ev.target.closest('[data-ed]');
      if (edb) { editValue(edb.dataset.ed); return; }
      var pnb = ev.target.closest('[data-pen]');
      if (pnb) { editValue(pnb.dataset.pen); return; }
      var sh = ev.target.closest('[data-barshift]');
      if (sh) { shiftBar(+sh.dataset.barshift, +sh.dataset.bar); return; }
      var lp = ev.target.closest('[data-loopbar]');
      if (lp) { setLoopBar(+lp.dataset.loopbar); renderAll(); return; }
      var du = ev.target.closest('[data-dupbar]');
      if (du) { dupBar(+du.dataset.dupbar); return; }
      var de = ev.target.closest('[data-delbar]');
      if (de) { delBar(+de.dataset.delbar); return; }
      var mc = ev.target.closest('[data-mood]');
      if (mc) { composeIntoGrid(mc.dataset.mood); tourAdvance(3); return; }
      var b = ev.target.closest('[data-cr]');
      if (!b) return;
      var k = b.dataset.cr;
      if (k === 'play') { gestured = true; togglePlay(); }
      else if (k === 'rewind') { pausedAt = 0; if (playing) startPlayback(0); else { camFollow = true; centerOn(0, true); viewBar = 0; renderBars(); } hint('Back to the start.'); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'baradd') { addBar(); }
      else if (k === 'share') {
        try { navigator.clipboard.writeText(location.origin + '/create#s=' + encode()); if (G._toast) G._toast('Link copied. The link IS the song \ud83c\udfb5'); } catch (e) {}
      }
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
