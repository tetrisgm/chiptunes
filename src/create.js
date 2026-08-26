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
    eraser: { pal: { p: '#FF9EC4', d: '#D96A9A', b: '#7FD4FF', w: '#FFFFFF' }, px: [
      '..........', '..bbbbbb..', '.bwbbbbb..', '.bbbbbbb..', '.pppppppp.',
      '.pwpppppd.', '.pppppppd.', '.ppppppdd.', '..dddddd..', '..........'] }
  };

  var CACHE = {};
  function sprite(name, size) {
    var k = name + ':' + size;
    if (CACHE[k]) return CACHE[k];
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
    STAMPS.forEach(function (st) {
      var pool = meta.filter(function (m) {
        if (st.ch === 'pulse') return m.type === 'pulse' && m.patch.duty === st.duty && envClass(BANK.instruments[m.index]) === st.env;
        return m.type === 'wave' && (st.wave === 'buzzy') === waveBig(m);
      });
      if (!pool.length) pool = meta.filter(function (m) { return m.type === st.ch; });
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
             cells: [], cur: 'piano', zip: 0, wob: 0 };
  }
  function cols() { return S.bars * 16; }
  function cellAt(c, r) {
    for (var i = 0; i < S.cells.length; i++)
      if (S.cells[i].c === c && S.cells[i].r === r) return i;
    return -1;
  }
  function snapshot() { undoStack.push(JSON.stringify(S)); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(S)); S = JSON.parse(undoStack.pop()); dirty(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(S)); S = JSON.parse(redoStack.pop()); dirty(); }

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
  function buildSong() {
    resolveBank();
    var notes = [], per = framesPer16();
    S.cells.forEach(function (x) { delete x.x; });
    for (var c = 0; c < cols(); c++) {
      var here = S.cells.filter(function (x) { return x.c === c; });
      var pulses = 0, wave = false, drums = {};
      here.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
      here.forEach(function (x) {
        if (x.r >= MEL_ROWS) {                              // drum lane
          var d = DRUMS[x.r - MEL_ROWS];
          if (drums[3]) { x.x = 1; return; }
          drums[3] = 1;
          notes.push({ ch: 3, frame: colFrame(c), frames: Math.max(2, Math.round(per * 0.6)),
                       midi: null, inst: INSTOF[d.id], vel: d.vel, pri: 9 - d.lane });
          return;
        }
        var st = null;
        for (var i = 0; i < STAMPS.length; i++) if (STAMPS[i].id === x.st) st = STAMPS[i];
        if (!st) { x.x = 1; return; }
        var frames = Math.max(2, Math.round(per * (x.w ? 8 : 0.96)) - 1);
        var note = { frame: colFrame(c), frames: frames, midi: rowMidi(x.r),
                     inst: INSTOF[st.id], vel: 0.8, pri: 5 };
        if (st.ch === 'wave') {
          if (wave) { x.x = 1; return; }
          wave = true; note.ch = 2;
        } else {
          if (pulses >= 2) { x.x = 1; return; }
          note.ch = pulses; pulses++;
          if (x.z && note.ch === 0) note.sweep = 0x3E;      // the fall off the note
        }
        notes.push(note);
      });
    }
    notes.sort(function (a, b) { return a.frame - b.frame; });
    var total = Math.round(cols() * per);
    return { notes: notes, bank: BANK, totalFrames: total,
             loopFrames: total };
  }

  // ---- serialize: the song IS the URL --------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function encode() {
    var out = [1, S.key, S.minor, S.bars, Math.round(S.bpm / 2), S.swing];
    S.cells.forEach(function (x) {
      var st = x.r >= MEL_ROWS ? 15 : Math.max(0, STAMPS.map(function (s) { return s.id; }).indexOf(x.st));
      out.push(x.c & 63, ((x.c >> 6) << 5) | x.r, st | (x.z ? 16 : 0) | (x.w ? 32 : 0));
    });
    return out.map(function (v) { return B64[v & 63]; }).join('');
  }
  function decode(str) {
    try {
      var v = []; for (var i = 0; i < str.length; i++) { var ix = B64.indexOf(str[i]); if (ix < 0) return null; v.push(ix); }
      if (v[0] !== 1) return null;
      var st2 = freshState();
      st2.key = v[1] % 12; st2.minor = v[2] & 1; st2.bars = [2, 4, 8].indexOf(v[3]) >= 0 ? v[3] : 4;
      st2.bpm = Math.max(70, Math.min(180, v[4] * 2)); st2.swing = v[5] & 1;
      var ids = STAMPS.map(function (s) { return s.id; });
      for (var j = 6; j + 2 < v.length + 1 && j + 2 <= v.length - 0; j += 3) {
        var c = v[j] | ((v[j + 1] >> 5) << 6), r = v[j + 1] & 31, b = v[j + 2];
        var cell = { c: c, r: r, t: j };
        if (r < MEL_ROWS) { cell.st = ids[b & 15] || 'piano'; if (b & 16) cell.z = 1; if (b & 32) cell.w = 1; }
        st2.cells.push(cell);
      }
      return st2;
    } catch (e) { return null; }
  }

  // ---- DOM + canvas --------------------------------------------------------
  var root = null, cv = null, g = null, playing = false, playT0 = 0, order = 0;
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
    var song = buildSong();
    var pos = song.loopFrames > 0
      ? Math.round(((performance.now() - playT0) / 1000) * FPS) % song.loopFrames : 0;
    if (typeof Audio !== 'undefined' && Audio.playCreate) Audio.playCreate(song, song.loopFrames, pos);
    draw();
  }
  // The dice: write a small song into the grid. Ambient randomness is fine
  // HERE -- this is a hand tool, not the station's musical path; the result
  // is ordinary cells, undoable and shareable like anything placed by hand.
  function shuffleFill() {
    snapshot();
    resolveBank();
    S.cells = []; order = 0;
    var R = Math.random;
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function put(c, r, st, w) {
      if (cellAt(c, r) >= 0) return;
      var cell = { c: c, r: r, t: ++order, a: performance.now() };
      if (st) cell.st = st;
      if (w) cell.w = 1;
      S.cells.push(cell);
    }
    var melPool = ['piano', 'trumpet', 'flute', 'bell'];
    var mel = pick(melPool);
    var harm = pick(melPool.filter(function (x) { return x !== mel; }));
    var bass = pick(['bassg', 'cello']);
    var prog = pick([[0, 5, 3, 4], [0, 3, 4, 4], [5, 3, 0, 4], [0, 4, 5, 3], [0, 2, 5, 4]]);
    // drums: one lane per column, so nobody ever sulks
    for (var c = 0; c < cols(); c++) {
      var g8 = c % 8;
      if (g8 === 0) put(c, MEL_ROWS + 2);
      else if (g8 === 4) put(c, MEL_ROWS + 1);
      else if (c % 2 === 0) put(c, MEL_ROWS);
      else if (R() < 0.18) put(c, MEL_ROWS);
    }
    for (var b = 0; b < S.bars; b++) {
      var deg = prog[b % prog.length];
      // bass on the wave: root walking to the fifth, with room to breathe
      for (var q = 0; q < 4; q++) {
        if (q === 3 && R() < 0.5) continue;
        var d = (q === 2) ? (deg + 4) % 7 : deg;
        put(b * 16 + q * 4, MEL_ROWS - 1 - d, bass);
      }
      // melody an octave up: chord tones with rests and the odd passing tone
      var tones = [deg + 7, deg + 9, deg + 11];
      for (var e = 0; e < 8; e++) {
        if (R() < 0.35) continue;
        var d2 = R() < 0.3 ? deg + 7 + Math.floor(R() * 5) : pick(tones);
        while (d2 > MEL_ROWS - 1) d2 -= 7;
        put(b * 16 + e * 2, MEL_ROWS - 1 - d2, mel);
      }
      // sometimes a held harmony note answers mid-bar
      if (R() < 0.6) {
        var dh = deg + 9; while (dh > MEL_ROWS - 1) dh -= 7;
        put(b * 16 + 8, MEL_ROWS - 1 - dh, harm, 1);
      }
    }
    dirty();
    if (!playing) startPlayback();
  }

  function startPlayback() {
    var song = buildSong();
    if (typeof Audio !== 'undefined' && Audio.playCreate) Audio.playCreate(song, song.loopFrames);
    playing = true; playT0 = performance.now();
    var pb = root.querySelector('[data-cr="play"]'); if (pb) pb.textContent = '■ Stop';
    draw();
  }
  // A silent host song keeps the chip's sequencer alive while the editor is
  // open, so placement pokes are audible before (and between) plays.
  function armChip() {
    resolveBank();
    if (typeof Audio !== 'undefined' && Audio.playCreate)
      Audio.playCreate({ notes: [], bank: BANK, totalFrames: 0x7fffffff }, 0);
  }
  function stopPlayback() {
    armChip();
    playing = false;
    var pb = root.querySelector('[data-cr="play"]'); if (pb) pb.textContent = '▶ Play';
    draw();
  }

  // The grid is S.bars phrase panels of 16 steps with a gutter between them:
  // the four boxes you see ARE the loop, in order, and then it comes around.
  function layout() {
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    var W = r.width, H = r.height;
    var gap = S.bars > 4 ? 6 : 14;
    var cw = Math.min(46, Math.max(8, (W - 80 - (S.bars - 1) * gap) / cols()));
    var chm = Math.min(34, Math.max(16, (H - 44) / (ROWS + 0.8)));
    var gw = cw * cols() + (S.bars - 1) * gap;
    return { W: W, H: H, dpr: dpr, cw: cw, chh: chm, gap: gap, gw: gw,
             gx: (W - gw) / 2, gy: (H - chm * ROWS) / 2 + 6 };
  }
  function colX(c, L) {
    return L.gx + Math.floor(c / 16) * (16 * L.cw + L.gap) + (c % 16) * L.cw;
  }
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
    var sc = scaleArr();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < cols(); c++) {
        var x = colX(c, L), y = L.gy + r * L.chh;
        var drum = r >= MEL_ROWS;
        var deg = drum ? 0 : ((MEL_ROWS - 1 - r) % 7);
        g.fillStyle = drum ? 'rgba(255,255,255,0.10)'
          : deg === 0 ? 'rgba(120,220,160,0.20)'
          : (c % 4 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)');
        g.fillRect(x + 1, y + 1, L.cw - 2, L.chh - 2);
      }
    }
    // panel chrome: each bar is a boxed 16-step phrase, numbered, and the
    // loop arrow after the last one says the song comes back around
    for (var b = 0; b < S.bars; b++) {
      var bx = L.gx + b * (16 * L.cw + L.gap);
      g.strokeStyle = 'rgba(232,227,250,0.30)'; g.lineWidth = 1;
      g.strokeRect(bx - 3.5, L.gy - 3.5, 16 * L.cw + 7, ROWS * L.chh + 7);
      g.fillStyle = 'rgba(232,227,250,0.55)'; g.font = '600 11px system-ui'; g.textBaseline = 'bottom';
      g.fillText(String(b + 1), bx + 2, L.gy - 8);
    }
    g.fillStyle = 'rgba(232,227,250,0.5)'; g.font = '600 16px system-ui'; g.textBaseline = 'middle';
    g.fillText('\u21ba', L.gx + L.gw + 10, L.gy + ROWS * L.chh / 2);
    // the drum lanes wear their instruments' faces
    g.globalAlpha = 0.45;
    DRUMS.forEach(function (d, i) {
      var ly = L.gy + (MEL_ROWS + i) * L.chh + (L.chh - 16) / 2;
      g.drawImage(sprite(d.id, 16), L.gx - 24, ly, 16, 16);
    });
    g.globalAlpha = 1;
    // stamps
    var now = performance.now();
    S.cells.forEach(function (x) {
      var px = colX(x.c, L), py = L.gy + x.r * L.chh;
      var size = Math.min(L.cw, L.chh) - 3;
      var pop = x.a ? Math.max(0, 1 - (now - x.a) / 220) : 0;
      var s2 = size * (1 + pop * 0.35);
      var name = x.r >= MEL_ROWS ? DRUMS[x.r - MEL_ROWS].id : x.st;
      if (x.x) g.globalAlpha = 0.32;
      var wob = x.x ? Math.sin(now / 130 + x.c) * 2 : 0;
      g.drawImage(sprite(name, 40), px + (L.cw - s2) / 2 + wob, py + (L.chh - s2) / 2, s2, s2);
      g.globalAlpha = 1;
      if (x.z) { g.drawImage(sprite('slide', 20), px + L.cw - 12, py - 2, 12, 12); }
      if (x.w) { g.drawImage(sprite('vibrato', 20), px - 2, py - 2, 12, 12); }
      if (pop > 0) animating = true;
    });
    // playhead: a marker sweeping the phrases in order, wrapping at the loop
    if (playing) {
      var per16ms = (60 / S.bpm / 4) * 1000;
      var col = ((performance.now() - playT0) / per16ms) % cols();
      var hb = Math.floor(col / 16);
      var hx = L.gx + hb * (16 * L.cw + L.gap) + (col - hb * 16) * L.cw;
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
    var x = ev.clientX - r0.left - L.gx;
    var b = Math.floor(x / (16 * L.cw + L.gap));
    var off = x - b * (16 * L.cw + L.gap);
    if (off >= 16 * L.cw + 2) return null;                 // in the gutter
    var c = b * 16 + Math.max(0, Math.min(15, Math.floor(off / L.cw)));
    var r = Math.floor((ev.clientY - r0.top - L.gy) / L.chh);
    if (x < 0 || c < 0 || c >= cols() || r < 0 || r >= ROWS) return null;
    return { c: c, r: r };
  }
  function applyAt(h, first) {
    var i = cellAt(h.c, h.r);
    if (first) dragMode = (S.cur === 'eraser' || i >= 0) ? 'erase' : 'place';
    if (dragMode === 'erase') { if (i >= 0) S.cells.splice(i, 1); dirty(); return; }
    if (i >= 0) return;
    var cell = { c: h.c, r: h.r, t: ++order, a: performance.now() };
    if (h.r < MEL_ROWS) {
      cell.st = S.cur;
      if (S.zip) cell.z = 1;
      if (S.wob) cell.w = 1;
    }
    S.cells.push(cell);
    dirty();
    // audition the placed note right now, through the chip
    resolveBank();
    var per = framesPer16();
    if (typeof Audio !== 'undefined' && Audio.pokeCreate) {
      if (h.r >= MEL_ROWS) {
        var d = DRUMS[h.r - MEL_ROWS];
        Audio.pokeCreate({ ch: 3, frames: Math.round(per), midi: null, inst: INSTOF[d.id], vel: d.vel });
      } else {
        var st = STAMPS.filter(function (s) { return s.id === S.cur; })[0] || STAMPS[0];
        Audio.pokeCreate({ ch: st.ch === 'wave' ? 2 : 1, frames: Math.round(per * 2),
                             midi: rowMidi(h.r), inst: INSTOF[st.id], vel: 0.8,
                             sweep: (S.zip && st.ch !== 'wave') ? 0x3E : 0 });
      }
    }
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
                       sweep: (S.zip && st.ch !== 'wave') ? 0x3E : 0 });
  }

  // ---- palette + toolbar ---------------------------------------------------
  function renderPalette() {
    var pal = root.querySelector('.cr-pal');
    function btn(cls, attr, name, tip, on) {
      return '<button type="button" class="cr-stamp' + cls + (on ? ' on' : '') + '" ' + attr +
             ' title="' + tip + '" data-tip="' + tip + '"><span class="cr-name">' + name + '</span></button>';
    }
    var html = '';
    STAMPS.forEach(function (st) {
      html += btn('', 'data-stamp="' + st.id + '"', st.label, st.tip, S.cur === st.id);
    });
    html += '<span class="cr-palsep"></span>';
    html += btn(' cr-mod', 'data-mod="zip"', 'Slide', 'Slide: new notes zip off downward', !!S.zip);
    html += btn(' cr-mod', 'data-mod="wob"', 'Vibrato', 'Vibrato: new notes hold and sing', !!S.wob);
    html += '<span class="cr-palsep"></span>';
    html += btn('', 'data-stamp="eraser"', 'Eraser', 'Eraser: click or sweep to remove notes', S.cur === 'eraser');
    pal.innerHTML = html;
    pal.querySelectorAll('.cr-stamp').forEach(function (b) {
      var name = b.dataset.stamp || (b.dataset.mod === 'zip' ? 'slide' : 'vibrato');
      b.insertBefore(sprite(name, 30), b.firstChild);
    });
  }
  // Mario Paint's music screen had no key picker, no scale menu, no swing
  // switch: the staff kept you in key and a slider set the pace. Same here --
  // the rows ARE the scale (C major stays the house key; old links that
  // carry another key still decode and play), and the toolbar is a toy.
  function toolbarHTML() {
    return '<div class="cr-title"><b>Create</b><span>place instruments, hear the chip</span></div>' +
      '<div class="cr-tools">' +
      '<button type="button" class="cr-btn cr-primary" data-cr="play" data-tip="Play the loop from the top (Space)">▶ Play</button>' +
      '<label class="cr-lab" data-tip="Tempo: how fast the loop plays">' + S.bpm + ' BPM<input type="range" min="70" max="180" step="2" value="' + S.bpm + '" data-cr="bpm"></label>' +
      '<button type="button" class="cr-btn" data-cr="undo" title="Undo" data-tip="Undo the last change">↩</button>' +
      '<button type="button" class="cr-btn" data-cr="redo" title="Redo" data-tip="Redo what you undid">↪</button>' +
      '<button type="button" class="cr-btn" data-cr="clear" data-tip="Wipe the whole grid clean">Clear</button>' +
      '<button type="button" class="cr-btn" data-cr="dice" data-tip="Roll a fresh little song into the grid">\ud83c\udfb2 Dice</button>' +
      '<span class="cr-sep"></span>' +
      '<button type="button" class="cr-btn" data-cr="share" data-tip="Copy a link that IS your song">Copy link</button>' +
      '<button type="button" class="cr-btn" data-cr="wav" data-tip="Download your song as audio (WAV)">WAV</button>' +
      '<button type="button" class="cr-btn" data-cr="rom" data-tip="Download a real Game Boy cartridge file (.gb)">ROM</button>' +
      '<button type="button" class="cr-btn cr-close" data-cr="close" data-tip="Back to the radio (Esc)">×</button>' +
      '</div>';
  }

  function exportRom() {
    var song = buildSong();
    var score = { gb: { notes: song.notes, bank: song.bank, totalFrames: song.totalFrames, fps: FPS } };
    try {
      var rom = G.CT_GB_ROM.buildRom(score, { title: 'MY CREATION' });
      _saveBlob(new Blob([rom], { type: 'application/octet-stream' }), 'my-creation.gb');
      if (G._toast) G._toast('Downloaded my-creation.gb. It boots on a real Game Boy 🎮');
    } catch (e) { if (G._toast) G._toast('ROM export failed: ' + (e && e.message || e)); }
  }
  function exportWav() {
    var song = buildSong(), sr = 44100;
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
      '<div class="cr-main"><canvas class="cr-cv"></canvas></div>' +
      '<div class="cr-pal"></div>';
    document.body.appendChild(root);
    cv = root.querySelector('.cr-cv'); cv.__ctpalRaw = true; g = cv.getContext('2d');
    renderPalette();
    requestAnimationFrame(function () { root.classList.add('show'); draw(); });
    document.body.classList.add('create-open');
    armChip();
    try { history.replaceState(null, '', '/create' + (S.cells.length ? '#s=' + encode() : '')); } catch (e) {}

    root.addEventListener('click', function (ev) {
      var st = ev.target.closest('[data-stamp]');
      if (st) { S.cur = st.dataset.stamp; renderPalette(); auditionStamp(S.cur); return; }
      var md = ev.target.closest('[data-mod]');
      if (md) {
        if (md.dataset.mod === 'zip') S.zip = S.zip ? 0 : 1; else S.wob = S.wob ? 0 : 1;
        renderPalette();
        // demo the modifier the moment it turns on, on whatever critter is in hand
        if ((md.dataset.mod === 'zip' && S.zip) || (md.dataset.mod === 'wob' && S.wob))
          auditionStamp(S.cur === 'eraser' ? 'piano' : S.cur);
        return;
      }
      var b = ev.target.closest('[data-cr]');
      if (!b) return;
      var k = b.dataset.cr;
      if (k === 'play') { playing ? stopPlayback() : startPlayback(); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'clear') { snapshot(); S.cells = []; dirty(); }
      else if (k === 'dice') { shuffleFill(); }
      else if (k === 'share') {
        try { navigator.clipboard.writeText(location.origin + '/create#s=' + encode()); if (G._toast) G._toast('Link copied. The link IS the song 🎵'); } catch (e) {}
      }
      else if (k === 'wav') { exportWav(); }
      else if (k === 'rom') { exportRom(); }
    });
    root.addEventListener('input', function (ev) {
      var b = ev.target.closest('[data-cr="bpm"]'); if (!b) return;
      S.bpm = +b.value; b.parentNode.firstChild.textContent = S.bpm + ' BPM';
      dirty();
    });
    var lastHit = null;
    cv.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); cv.setPointerCapture(ev.pointerId);
      var h = hitCell(ev); if (!h) return;
      snapshot(); lastHit = h; applyAt(h, true);
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!dragMode) return;
      var h = hitCell(ev); if (!h) return;
      // pointer events arrive sparser than cells: walk the line between the
      // last sample and this one, or a fast sweep skips columns.
      if (lastHit) {
        var dc = h.c - lastHit.c, dr = h.r - lastHit.r;
        var n = Math.max(Math.abs(dc), Math.abs(dr));
        for (var i = 1; i <= n; i++)
          applyAt({ c: lastHit.c + Math.round(dc * i / n), r: lastHit.r + Math.round(dr * i / n) }, false);
      } else applyAt(h, false);
      lastHit = h;
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () { dragMode = null; lastHit = null; });
    });
    window.addEventListener('resize', draw);
  }
  function close() {
    stopPlayback();
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (root) root.classList.remove('show');
    document.body.classList.remove('create-open');
    try { history.replaceState(null, '', '/'); } catch (e) {}
    if (G._closeCreateReturn) G._closeCreateReturn();
  }
  function isOpen() { return !!(root && root.classList.contains('show')); }

  G.CT_CREATE = { open: open, close: close, isOpen: isOpen };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CT_CREATE;
})(typeof globalThis !== 'undefined' ? globalThis : window);
