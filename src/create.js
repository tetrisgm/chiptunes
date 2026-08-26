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
  var KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // ---- the cast ------------------------------------------------------------
  // 10x10 pixel critters, drawn from strings: '.'=clear, letters=palette.
  var SPRITES = {
    pip: { pal: { y: '#FFD23F', o: '#FF8C1A', k: '#241A0E', w: '#FFFFFF' }, px: [
      '...yyyy...', '..yyyyyy..', '.yykyykyy.', '.yyyyyyyy.', 'oyyyyyyyy.',
      '.yyyyyyy..', '..yyyyyy..', '...oyyo...', '...o..o...', '..........'] },
    momo: { pal: { p: '#FF7BAE', d: '#D14B85', k: '#241A0E', w: '#FFFFFF' }, px: [
      '.p......p.', '.pp....pp.', '.pppppppp.', 'ppkppppkpp', 'pppppppppp',
      'ppp.ww.ppp', '.pppppppp.', '..pppppp..', '..p....p..', '..........'] },
    bloop: { pal: { g: '#57C4FF', d: '#2B7ECC', k: '#241A0E', w: '#FFFFFF' }, px: [
      '..g....g..', '.gkg..gkg.', '.ggg..ggg.', '.gggggggg.', 'gggggggggg',
      'gggggggggg', '.gggggggg.', '..gg..gg..', '..........', '..........'] },
    twinkle: { pal: { s: '#FFF06A', h: '#FFC93C', k: '#241A0E' }, px: [
      '....ss....', '....ss....', '.ssssssss.', '..ssssss..', '...ssss...',
      '..sshhss..', '.ss.hh.ss.', '....hh....', '..........', '..........'] },
    rumbo: { pal: { b: '#8E7BFF', d: '#5F4BD8', k: '#241A0E', w: '#FFFFFF' }, px: [
      '..........', '.bbbbbb...', 'bbbbbbbbb.', 'bkbbbbbbbb', 'bbbbbbbbbd',
      'bbbbbbbbb.', '.bbbbbbd..', '..b..b....', '..........', '..........'] },
    waffles: { pal: { t: '#E8A75D', d: '#B5763A', k: '#241A0E', w: '#FFFFFF' }, px: [
      '.t......t.', '.tt....tt.', '.tttttttt.', 'ttkttttktt', 'tttttttttt',
      'ttttkktttt', '.tttttttt.', '..t.tt.t..', '..........', '..........'] },
    boom: { pal: { m: '#A8794A', d: '#6E4B27', k: '#241A0E' }, px: [
      '..........', '..mmmmmm..', '.mmmmmmmm.', 'mmkmmmmkmm', 'mmmmmmmmmm',
      'mmmddddmmm', '.mmmmmmmm.', '..mm..mm..', '..........', '..........'] },
    snappy: { pal: { r: '#FF6B57', d: '#C63B2A', k: '#241A0E' }, px: [
      '.rr....rr.', 'rr.r..r.rr', '..rrrrrr..', '.rrkrrkrr.', '.rrrrrrrr.',
      'r.rrrrrr.r', '..rrrrrr..', '..r....r..', '..........', '..........'] },
    tick: { pal: { g: '#7ED957', d: '#4EA32E', k: '#241A0E' }, px: [
      '....gg....', '..gggggg..', '.ggggggggg'.slice(0,10), '.gggggggg.', '.gkggggkg.',
      '.gggggggg.', '..g.gg.g..', '..........', '..........', '..........'] },
    zippy: { pal: { z: '#59E3FF', f: '#FF8C1A', k: '#241A0E' }, px: [
      '....zz....', '...zzzz...', '...zkzz...', '...zzzz...', '...zzzz...',
      '..zzzzzz..', '...ffff...', '....ff....', '..........', '..........'] },
    wobble: { pal: { j: '#C77BFF', d: '#9245D6', k: '#241A0E' }, px: [
      '..........', '..jjjjjj..', '.jjjjjjjj.', '.jkjjjjkj.', '.jjjjjjjj.',
      '.jjjjjjjj.', '.j.j.j.j..', '..........', '..........', '..........'] }
  };
  var CACHE = {};
  function sprite(name, size) {
    var k = name + ':' + size;
    if (CACHE[k]) return CACHE[k];
    var def = SPRITES[name], cv = document.createElement('canvas');
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
    { id: 'pip',     ch: 'pulse', duty: 0.5,   env: 'pluck', label: 'Pip' },
    { id: 'momo',    ch: 'pulse', duty: 0.25,  env: 'stab',  label: 'Momo' },
    { id: 'bloop',   ch: 'pulse', duty: 0.5,   env: 'soft',  label: 'Bloop' },
    { id: 'twinkle', ch: 'pulse', duty: 0.125, env: 'pluck', label: 'Twinkle' },
    { id: 'rumbo',   ch: 'wave',  wave: 'buzzy',  label: 'Rumbo' },
    { id: 'waffles', ch: 'wave',  wave: 'mellow', label: 'Waffles' }
  ];
  var DRUMS = [
    { id: 'tick',   lane: 0, kind: 'hat',   vel: 0.5,  label: 'Tick' },
    { id: 'snappy', lane: 1, kind: 'snare', vel: 0.7,  label: 'Snappy' },
    { id: 'boom',   lane: 2, kind: 'kick',  vel: 0.9,  label: 'Boom' }
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
    INSTOF.tick = ns[0] ? ns[0].index : 0;
    INSTOF.snappy = (ns[third] || ns[0]).index;
    INSTOF.boom = (ns[ns.length - 1] || ns[0]).index;
    return BANK;
  }

  // ---- state ---------------------------------------------------------------
  var S = null, undoStack = [], redoStack = [];
  function freshState() {
    return { key: 0, minor: 0, bars: 4, bpm: 128, swing: 0,
             cells: [], cur: 'pip', zip: 0, wob: 0 };
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
        if (r < MEL_ROWS) { cell.st = ids[b & 15] || 'pip'; if (b & 16) cell.z = 1; if (b & 32) cell.w = 1; }
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
      repostTimer = setTimeout(function () { startPlayback(); }, 160);
    }
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

  function layout() {
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    var W = r.width, H = r.height;
    var cw = Math.min(46, Math.max(18, (W - 60) / cols()));
    var chm = Math.min(34, Math.max(16, (H - 30) / (ROWS + 0.8)));
    return { W: W, H: H, dpr: dpr, cw: cw, chh: chm,
             gx: (W - cw * cols()) / 2, gy: (H - chm * ROWS) / 2 };
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
        var x = L.gx + c * L.cw, y = L.gy + r * L.chh;
        var drum = r >= MEL_ROWS;
        var deg = drum ? 0 : ((MEL_ROWS - 1 - r) % 7);
        g.fillStyle = drum ? 'rgba(255,255,255,0.05)'
          : deg === 0 ? 'rgba(120,220,160,0.13)'
          : (c % 4 === 0 ? 'rgba(255,255,255,0.065)' : 'rgba(255,255,255,0.035)');
        if (Math.floor(c / 16) % 2 === 1) g.fillStyle = drum ? 'rgba(255,255,255,0.075)'
          : deg === 0 ? 'rgba(120,220,160,0.17)' : (c % 4 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.055)');
        g.fillRect(x + 1, y + 1, L.cw - 2, L.chh - 2);
      }
    }
    // bar numbers + drum labels
    g.fillStyle = 'rgba(232,227,250,0.5)'; g.font = '600 11px system-ui'; g.textBaseline = 'top';
    for (var b = 0; b < S.bars; b++) g.fillText(String(b + 1), L.gx + b * 16 * L.cw + 4, L.gy - 15);
    DRUMS.forEach(function (d, i) {
      g.fillText(d.label, L.gx - 0 + cols() * L.cw + 6, L.gy + (MEL_ROWS + i) * L.chh + 4);
    });
    // stamps
    var now = performance.now();
    S.cells.forEach(function (x) {
      var px = L.gx + x.c * L.cw, py = L.gy + x.r * L.chh;
      var size = Math.min(L.cw, L.chh) - 3;
      var pop = x.a ? Math.max(0, 1 - (now - x.a) / 220) : 0;
      var s2 = size * (1 + pop * 0.35);
      var name = x.r >= MEL_ROWS ? DRUMS[x.r - MEL_ROWS].id : x.st;
      if (x.x) g.globalAlpha = 0.32;
      var wob = x.x ? Math.sin(now / 130 + x.c) * 2 : 0;
      g.drawImage(sprite(name, 40), px + (L.cw - s2) / 2 + wob, py + (L.chh - s2) / 2, s2, s2);
      g.globalAlpha = 1;
      if (x.z) { g.drawImage(sprite('zippy', 20), px + L.cw - 12, py - 2, 12, 12); }
      if (x.w) { g.drawImage(sprite('wobble', 20), px - 2, py - 2, 12, 12); }
      if (pop > 0) animating = true;
    });
    // playhead: Tick marches along the top
    if (playing) {
      var per16ms = (60 / S.bpm / 4) * 1000;
      var col = ((performance.now() - playT0) / per16ms) % cols();
      var hx = L.gx + col * L.cw;
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(hx, L.gy, 2, ROWS * L.chh);
      var bob = Math.abs(Math.sin(performance.now() / 120)) * 5;
      g.drawImage(sprite('pip', 26), hx - 13, L.gy - 26 - bob, 26, 26);
    }
    if (animating) scheduleDraw();
  }

  // ---- input ---------------------------------------------------------------
  var dragMode = null;
  function hitCell(ev) {
    var r0 = cv.getBoundingClientRect(), L = layout();
    var c = Math.floor((ev.clientX - r0.left - L.gx) / L.cw);
    var r = Math.floor((ev.clientY - r0.top - L.gy) / L.chh);
    if (c < 0 || c >= cols() || r < 0 || r >= ROWS) return null;
    return { c: c, r: r };
  }
  function applyAt(h, first) {
    var i = cellAt(h.c, h.r);
    if (first) dragMode = i >= 0 ? 'erase' : 'place';
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

  // ---- palette + toolbar ---------------------------------------------------
  function renderPalette() {
    var pal = root.querySelector('.cr-pal');
    var html = '';
    STAMPS.forEach(function (st) {
      html += '<button type="button" class="cr-stamp' + (S.cur === st.id ? ' on' : '') + '" data-stamp="' + st.id + '" title="' + st.label + '"></button>';
    });
    html += '<span class="cr-palsep"></span>';
    html += '<button type="button" class="cr-stamp cr-mod' + (S.zip ? ' on' : '') + '" data-mod="zip" title="Zippy: the note slides off"></button>';
    html += '<button type="button" class="cr-stamp cr-mod' + (S.wob ? ' on' : '') + '" data-mod="wob" title="Wobble: the note holds and sings"></button>';
    pal.innerHTML = html;
    pal.querySelectorAll('.cr-stamp').forEach(function (b) {
      var name = b.dataset.stamp || (b.dataset.mod === 'zip' ? 'zippy' : 'wobble');
      b.appendChild(sprite(name, 34));
    });
  }
  function toolbarHTML() {
    var keys = KEYS.map(function (k, i) { return '<option value="' + i + '"' + (S.key === i ? ' selected' : '') + '>' + k + '</option>'; }).join('');
    return '<div class="cr-title"><b>Create</b><span>place the critters, hear the chip</span></div>' +
      '<div class="cr-tools">' +
      '<button type="button" class="cr-btn cr-primary" data-cr="play">▶ Play</button>' +
      '<select class="cr-sel" data-cr="key">' + keys + '</select>' +
      '<select class="cr-sel" data-cr="minor"><option value="0"' + (!S.minor ? ' selected' : '') + '>major</option><option value="1"' + (S.minor ? ' selected' : '') + '>minor</option></select>' +
      '<select class="cr-sel" data-cr="bars"><option' + (S.bars === 2 ? ' selected' : '') + '>2</option><option' + (S.bars === 4 ? ' selected' : '') + '>4</option><option' + (S.bars === 8 ? ' selected' : '') + '>8</option></select>' +
      '<label class="cr-lab">' + S.bpm + ' BPM<input type="range" min="70" max="180" step="2" value="' + S.bpm + '" data-cr="bpm"></label>' +
      '<button type="button" class="cr-btn' + (S.swing ? ' on' : '') + '" data-cr="swing">Swing</button>' +
      '<button type="button" class="cr-btn" data-cr="undo" title="Undo">↩</button>' +
      '<button type="button" class="cr-btn" data-cr="redo" title="Redo">↪</button>' +
      '<button type="button" class="cr-btn" data-cr="clear">Clear</button>' +
      '<span class="cr-sep"></span>' +
      '<button type="button" class="cr-btn" data-cr="share">Copy link</button>' +
      '<button type="button" class="cr-btn" data-cr="wav">WAV</button>' +
      '<button type="button" class="cr-btn" data-cr="rom">ROM</button>' +
      '<button type="button" class="cr-btn cr-close" data-cr="close">×</button>' +
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
    cv = root.querySelector('.cr-cv'); g = cv.getContext('2d');
    renderPalette();
    requestAnimationFrame(function () { root.classList.add('show'); draw(); });
    document.body.classList.add('create-open');
    armChip();
    try { history.replaceState(null, '', '/create' + (S.cells.length ? '#s=' + encode() : '')); } catch (e) {}

    root.addEventListener('click', function (ev) {
      var st = ev.target.closest('[data-stamp]');
      if (st) { S.cur = st.dataset.stamp; renderPalette(); return; }
      var md = ev.target.closest('[data-mod]');
      if (md) { if (md.dataset.mod === 'zip') S.zip = S.zip ? 0 : 1; else S.wob = S.wob ? 0 : 1; renderPalette(); return; }
      var b = ev.target.closest('[data-cr]');
      if (!b) return;
      var k = b.dataset.cr;
      if (k === 'play') { playing ? stopPlayback() : startPlayback(); }
      else if (k === 'close') { close(); }
      else if (k === 'undo') { undo(); }
      else if (k === 'redo') { redo(); }
      else if (k === 'clear') { snapshot(); S.cells = []; dirty(); }
      else if (k === 'swing') { snapshot(); S.swing = S.swing ? 0 : 1; b.classList.toggle('on', !!S.swing); dirty(); }
      else if (k === 'share') {
        try { navigator.clipboard.writeText(location.origin + '/create#s=' + encode()); if (G._toast) G._toast('Link copied. The link IS the song 🎵'); } catch (e) {}
      }
      else if (k === 'wav') { exportWav(); }
      else if (k === 'rom') { exportRom(); }
    });
    root.addEventListener('change', function (ev) {
      var b = ev.target.closest('[data-cr]'); if (!b) return;
      snapshot();
      if (b.dataset.cr === 'key') S.key = +b.value;
      else if (b.dataset.cr === 'minor') S.minor = +b.value;
      else if (b.dataset.cr === 'bars') S.bars = +b.value;
      S.cells = S.cells.filter(function (x) { return x.c < cols(); });
      dirty();
    });
    root.addEventListener('input', function (ev) {
      var b = ev.target.closest('[data-cr="bpm"]'); if (!b) return;
      S.bpm = +b.value; b.parentNode.firstChild.textContent = S.bpm + ' BPM';
      dirty();
    });
    cv.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); cv.setPointerCapture(ev.pointerId);
      var h = hitCell(ev); if (!h) return;
      snapshot(); applyAt(h, true);
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!dragMode) return;
      var h = hitCell(ev); if (h) applyAt(h, false);
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () { dragMode = null; });
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
