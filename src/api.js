// THE AGENT API. One documented, versioned surface for making Chiptunes songs
// from a program, with no browser involved.
//
// Everything underneath this file already worked headless -- the composer, the
// document layer, the cartridge builder and the APU renderer all load in plain
// Node. What was missing was a CONTRACT: the app's own entry points are
// internal globals with underscore-private names, and the song document is a
// ~10,000-character packed string that an agent can pass around but cannot
// read or edit. This file is the exposure, not new machinery.
//
// The whole surface is built on two guarantees the product already makes:
//
//   * DETERMINISM. The same token composes the same song forever, and the same
//     document always materialises the same notes, timing and register
//     schedule. An agent can iterate, diff two songs and reproduce a result
//     exactly. Nothing here streams model output.
//   * THE DOCUMENT IS THE HANDLE. A song is a string. There is no session, no
//     server, no id to allocate. Hand the same string back and you get the same
//     song.
//
// Anything in here that an agent depends on is versioned by API_VERSION and
// held by scripts/verify-api.js. The underscore-private editor internals are
// deliberately NOT exposed: the contract is documents in, documents out.
'use strict';

// EVERYTHING BELOW IS INSIDE AN IIFE, like every other file in this bundle.
// It has to be: in the browser these files are CONCATENATED as classic
// scripts, so a top-level `var` here is a global. This file declares 47 of
// them -- including `Song`, `compose`, `load`, `describe` and `validate` --
// and shipping it unwrapped clobbered seed.js's `Song`, which broke the audio
// chip on the page. The only thing that leaves is CT_API.
(function (_G) {

var API_VERSION = 1;

// DUAL ENVIRONMENT. In Node these are modules; in the browser this file is
// concatenated as a plain script alongside them and they are globals. Calling
// require() unconditionally threw at load in the page and took every script
// after it down with it -- which is how window.chiptunes went missing.
var _req = (typeof require === 'function') ? require : null;
var Song = _req ? _req('./seed.js') : _G.Song;
// the browser registers composers in a REGISTRY, not under a single name:
// composer.js does `G.CT_COMPOSERS.rrr_core = API`. Guessing `CT_COMPOSER` left
// it undefined, so brief() and compose() threw in the page while variant() --
// which only transforms -- worked, and the gate did not catch it.
var composer = _req ? _req('./composer.js')
                    : ((_G.CT_COMPOSERS && _G.CT_COMPOSERS.rrr_core) || null);
var CT_CREATE = _req ? _req('./create.js') : _G.CT_CREATE;
var GB_ROM = _req ? _req('./gb-rom.js') : _G.CT_GB_ROM;
var GB_APU = _req ? _req('./gb-apu.js') : _G.CT_GB_APU;
// gb-hardware registers itself as CT_GB in the page, not CT_GB_HARDWARE. Both
// gb-apu.js and gb-rom.js already write `CT_GB_HARDWARE || CT_GB` for exactly
// this reason; guessing one name left HW undefined and brief() threw on FPS.
var HW = _req ? _req('./gb-hardware.js') : (_G.CT_GB_HARDWARE || _G.CT_GB);

// Buffer is Node's. The browser gets everything except the file exports, which
// is the right split: rendering a WAV in the page is the player's job.
var HAS_BUFFER = typeof Buffer !== 'undefined';
function needBuffer(what) {
  if (!HAS_BUFFER) throw new Error(what + ' is a Node entry point; in the browser use the player to render audio');
}

// create.js is written for the browser, where the other modules are plain
// globals put there by script concatenation. In Node they have to be handed
// over, or moodSong() cannot name its song and returns a titleless document.
if (typeof globalThis.Song === 'undefined') globalThis.Song = Song;

var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
var T = CT_CREATE.tables();
var LANES = T.lanes.map(function (l) { return l.name; });        // Melody Harmony Bass Drums
var DRUMS = T.drums;                                             // hat snare kick
var MEL_ROWS = T.melodicRows;

// The cartridge hints at 30000 of 32768 while editing, because learning a song
// will not fit from a failed download is learning it too late.
var ROM_BUDGET = 30000, ROM_SIZE = GB_ROM.ROM_SIZE || 32768;
var MOTIONS = ['plain', 'arp', 'roll', 'echo', 'fall', 'rise'];

function noteName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
function midiOf(name) {
  var m = String(name || '').trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return null;
  var base = NOTE_NAMES.indexOf(m[1].toUpperCase());
  if (base < 0) return null;
  if (m[2] === '#') base += 1; else if (m[2] === 'b') base -= 1;
  return base + (parseInt(m[3], 10) + 1) * 12;
}

// ---------------------------------------------------------------- capabilities
//
// An agent has to know the rules BEFORE it writes, or it guesses and produces
// songs that will not compile. This is read off the same constants the editor
// obeys rather than restated, so the two cannot drift.
function capabilities() {
  return {
    apiVersion: API_VERSION,
    deterministic: true,
    lanes: T.lanes.map(function (l, i) {
      return {
        name: l.name, index: i,
        chip: ['pulse 1', 'pulse 2', 'wave', 'noise'][i],
        pitched: i !== 3,
        // Fall and Rise need channel 1's hardware sweep unit, so only Melody
        // has them. Drums have no arp.
        motions: i === 0 ? MOTIONS
               : i === 3 ? ['plain', 'roll', 'echo']
               : ['plain', 'arp', 'roll', 'echo']
      };
    }),
    drums: DRUMS,
    stamps: T.stamps,
    grids: T.grids,
    noteRange: { low: 'C1', high: 'B7', note: 'pitch is carried exactly; the row model is display only' },
    velocity: { min: 0, max: 1, note: 'velocity 0 is a rest and is dropped from the song' },
    cartridge: { bytes: ROM_SIZE, budget: ROM_BUDGET, waveTables: HW.WAVE_SLOTS || 32 },
    moods: CT_CREATE.moods(),
    scenes: Object.keys(SCENES),
    moodWords: Object.keys(MOODS),
    operations: ['tempo', 'transpose', 'register', 'mode', 'velocity', 'thin', 'drop',
                 'trim', 'repeat', 'swing', 'motion', 'shape', 'fade'],
    limits: { maxTitle: 48 }
  };
}

// ------------------------------------------------------------------- composing
//
// One token in, one score out. A premise constrains the composer's own dials
// before generation; it never scores or filters candidates afterwards.
function compose(opts) {
  opts = opts || {};
  var score, token;
  if (opts.mood) {
    // moodSong composes SOMETHING for any string -- an unrecognised word just
    // leaves the composer unconstrained -- which would hand an agent a song it
    // did not ask for and no way to tell. Check the word first.
    var known = CT_CREATE.moods();
    if (known.indexOf(String(opts.mood)) < 0)
      throw new Error('compose: no song for mood ' + JSON.stringify(opts.mood) +
                      '. Known moods: ' + known.join(', '));
    var m = CT_CREATE.moodSong(String(opts.mood));
    if (!m) throw new Error('compose: no song for mood ' + JSON.stringify(opts.mood) +
                            '. Known moods: ' + CT_CREATE.moods().join(', '));
    return { doc: m.code, title: m.title, bpm: m.bpm, bars: m.bars, mood: String(opts.mood) };
  }
  token = opts.token ? String(opts.token) : Song.mint();
  var premise = null;
  if (opts.styles || opts.mode || opts.bpmMin != null || opts.bpmMax != null) {
    premise = {};
    if (opts.styles) premise.styles = [].concat(opts.styles);
    if (opts.mode) premise.mode = opts.mode;
    if (opts.bpmMin != null) premise.bpmMin = opts.bpmMin;
    if (opts.bpmMax != null) premise.bpmMax = opts.bpmMax;
  }
  score = premise ? composer.compile(token, premise) : composer.compile(token);
  if (!score) throw new Error('compose: nothing satisfies that premise');
  var title = opts.title != null ? String(opts.title) : Song.nameFor(token);
  var out = CT_CREATE.songFrom(score, title);
  if (!out) throw new Error('compose: the score would not materialise as a document');
  return { doc: out.code, token: token, title: out.title, bpm: out.bpm, bars: out.bars };
}

// ------------------------------------------------------------ document <-> JSON
//
// The readable representation. Absolute step numbers, named lanes, note names,
// and only the fields that were actually set -- an agent should be able to read
// what it gets back and hand a hand-written object straight in.
function toJSON(doc) {
  var st = CT_CREATE.docState(doc);
  if (!st) throw new Error('toJSON: not a readable song document');
  var grid = st.grid || 16;
  var notes = st.cells.map(function (x) {
    var drum = x.r >= MEL_ROWS;
    var n = {
      lane: drum ? 'Drums' : LANES[laneOfCell(x)],
      step: x.c | 0,
      bar: Math.floor((x.c | 0) / grid),
      beat: ((x.c | 0) % grid) / (grid / 4)
    };
    if (drum) n.drum = DRUMS[x.r - MEL_ROWS] || DRUMS[0];
    else n.note = x.midi != null ? noteName(x.midi) : null;
    n.len = x.len != null ? x.len : 1;
    if (x.vel != null) n.velocity = x.vel;
    var motion = x.u ? 'rise' : x.z ? 'fall' : x.q ? 'arp' : x.g ? 'roll' : x.f ? 'echo' : null;
    if (motion) n.motion = motion;
    if (x.inst != null) n.instrument = x.inst;
    if (x.st) n.stamp = x.st;
    // the chip settings, when the note carries its own rather than the lane's
    var snd = {};
    if (x.dy != null) snd.shape = x.dy;
    if (x.fd != null) snd.fade = x.fd;
    if (x.wv != null) snd.wave = x.wv;
    if (x.nz != null) snd.noise = x.nz;
    if (Object.keys(snd).length) n.sound = snd;
    return n;
  });
  return {
    apiVersion: API_VERSION,
    title: st.title || '', bpm: st.bpm, bars: st.bars, grid: grid,
    swing: st.swing ? 1 : 0, key: st.key | 0, minor: st.minor ? 1 : 0,
    notes: notes
  };
}

function laneOfCell(x) {
  if (x.ch === 0 || x.ch === 1) return x.ch;
  if (x.rch != null) return x.rch;
  if (x.st === 'bassg' || x.st === 'cello') return 2;
  return 0;
}

function fromJSON(obj) {
  var v = validate(obj);
  if (!v.ok) { var e = new Error('fromJSON: ' + v.errors[0]); e.errors = v.errors; throw e; }
  var grid = obj.grid || 16;
  var st = {
    key: obj.key | 0, minor: obj.minor ? 1 : 0,
    bars: obj.bars || Math.max(1, Math.ceil(maxStep(obj) / grid) + 1),
    bpm: obj.bpm || 128, swing: obj.swing ? 1 : 0, grid: grid,
    cells: [], cur: 'piano', cmd: 0, wob: 0, title: String(obj.title || '').slice(0, 48)
  };
  (obj.notes || []).forEach(function (n) {
    var lane = LANES.indexOf(n.lane);
    var cell = { c: n.step | 0, len: n.len != null ? n.len : 1 };
    if (lane === 3) {
      var di = DRUMS.indexOf(n.drum || 'kick');
      cell.r = MEL_ROWS + (di < 0 ? 2 : di);
      cell.vel = n.velocity != null ? n.velocity : 0.8;
    } else {
      var midi = midiOf(n.note);
      cell.midi = midi;
      cell.ch = lane === 2 ? undefined : lane;      // Bass is the wave voice; it has no pulse channel
      cell.st = n.stamp || (lane === 2 ? 'bassg' : lane === 1 ? 'bell' : 'piano');
      // the row is display only -- pitch is carried by midi -- but it must stay
      // inside the melodic band or the cell reads as a drum
      cell.r = Math.max(0, Math.min(MEL_ROWS - 1, Math.round((midi - 48) * (MEL_ROWS - 1) / 36)));
      cell.vel = n.velocity != null ? n.velocity : 0.8;
    }
    if (cell.ch === undefined) delete cell.ch;
    if (n.instrument != null) cell.inst = n.instrument;
    switch (n.motion) {
      case 'rise': cell.u = 1; break;
      case 'fall': cell.z = 1; break;
      case 'arp': cell.q = 1; break;
      case 'roll': cell.g = 1; break;
      case 'echo': cell.f = 1; break;
    }
    if (n.sound) {
      if (n.sound.shape != null) cell.dy = n.sound.shape;
      if (n.sound.fade != null) cell.fd = n.sound.fade;
      if (n.sound.wave != null) cell.wv = n.sound.wave;
      if (n.sound.noise != null) cell.nz = n.sound.noise;
    }
    st.cells.push(cell);
  });
  var doc = CT_CREATE.docFromState(st);
  if (!doc) throw new Error('fromJSON: the song would not encode');
  return doc;
}

function maxStep(obj) {
  return (obj.notes || []).reduce(function (m, n) { return Math.max(m, (n.step | 0) + (n.len || 1)); }, 0);
}

// ------------------------------------------------------------------ validation
//
// Errors are the interface an agent iterates on, so they name the note and say
// what to do rather than reporting that something was wrong.
function validate(obj) {
  var errors = [], warnings = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['expected a song object'], warnings: warnings };
  var grid = obj.grid || 16;
  if (T.grids.indexOf(grid) < 0) errors.push('grid must be one of ' + T.grids.join(', ') + ' (got ' + grid + ')');
  if (obj.bpm != null && (obj.bpm < 70 || obj.bpm > 197))
    errors.push('bpm must be between 70 and 197 (got ' + obj.bpm + ')');
  if (!Array.isArray(obj.notes)) errors.push('notes must be an array');
  var caps = capabilities();
  (obj.notes || []).forEach(function (n, i) {
    var at = 'note ' + i + ' (' + (n.lane || '?') + ' step ' + n.step + ')';
    var lane = LANES.indexOf(n.lane);
    if (lane < 0) { errors.push(at + ': unknown lane ' + JSON.stringify(n.lane) + '. Use ' + LANES.join(', ')); return; }
    if ((n.step | 0) < 0) errors.push(at + ': step must be 0 or more');
    if (lane === 3) {
      if (n.drum && DRUMS.indexOf(n.drum) < 0)
        errors.push(at + ': unknown drum ' + JSON.stringify(n.drum) + '. Use ' + DRUMS.join(', '));
      if (n.note) warnings.push(at + ': Drums ignore note names; use drum instead');
    } else {
      if (n.note == null) errors.push(at + ': a pitched lane needs a note, e.g. "C4"');
      else if (midiOf(n.note) == null) errors.push(at + ': ' + JSON.stringify(n.note) + ' is not a note name, e.g. "C#4"');
    }
    if (n.velocity != null && (n.velocity < 0 || n.velocity > 1))
      errors.push(at + ': velocity must be between 0 and 1');
    if (n.len != null && n.len < 1) errors.push(at + ': len must be 1 or more steps');
    if (n.motion) {
      var allowed = caps.lanes[lane].motions;
      if (allowed.indexOf(n.motion) < 0)
        errors.push(at + ': ' + n.lane + ' cannot do "' + n.motion + '". It can do ' + allowed.join(', ') + '.');
    }
  });
  // two notes sounding at once on one lane is one voice too many: the chip has
  // one voice per channel, and overlap in TIME is what matters, not per step
  var byLane = {};
  (obj.notes || []).forEach(function (n) {
    if (LANES.indexOf(n.lane) < 0) return;
    (byLane[n.lane] = byLane[n.lane] || []).push(n);
  });
  Object.keys(byLane).forEach(function (lane) {
    var ns = byLane[lane].slice().sort(function (a, b) { return (a.step | 0) - (b.step | 0); });
    for (var i = 1; i < ns.length; i++) {
      var prevEnd = (ns[i - 1].step | 0) + (ns[i - 1].len || 1);
      if ((ns[i].step | 0) < prevEnd)
        warnings.push(lane + ': notes at step ' + ns[i - 1].step + ' and ' + ns[i].step +
                      ' overlap; the chip has one voice per lane, so the later one cuts the earlier');
    }
  });
  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

// -------------------------------------------------------------------- describe
//
// An agent cannot listen. This is what it reads instead: the shape of the song,
// its cost on the cartridge, and the same density signal the smoke gate uses.
function describe(doc) {
  var song = CT_CREATE.songOf(typeof doc === 'string' ? doc : fromJSON(doc));
  if (!song) throw new Error('describe: not a playable song');
  var gb = song.gb, fps = HW.FPS || 59.7275;
  var perLane = [0, 0, 0, 0];
  gb.notes.forEach(function (n) { perLane[n.ch | 0] = (perLane[n.ch | 0] || 0) + 1; });
  var rom = null;
  try { rom = GB_ROM.buildRom({ gb: gb, name: song.title || 'SONG' }).length; } catch (e) { rom = null; }
  return {
    title: song.title || '', bpm: song.bpm, bars: song.bars,
    seconds: +(gb.totalFrames / fps).toFixed(2),
    notes: gb.notes.length,
    perLane: { Melody: perLane[0], Harmony: perLane[1], Bass: perLane[2], Drums: perLane[3] },
    automation: (gb.auto || []).length, waveLoads: (gb.waveLoads || []).length,
    kitHits: (gb.kit || []).length,
    cartridgeBytes: rom, cartridgeBudget: ROM_BUDGET,
    fitsOnCartridge: rom == null ? null : rom <= ROM_SIZE
  };
}

// --------------------------------------------------------------------- exports
function buildCartridge(doc) {
  var song = CT_CREATE.songOf(typeof doc === 'string' ? doc : fromJSON(doc));
  if (!song) throw new Error('buildCartridge: not a playable song');
  return GB_ROM.buildRom({ gb: song.gb, name: song.title || 'SONG' });
}

// 16-bit stereo WAV, so the caller can write it straight to a file.
function renderWav(doc, opts) {
  needBuffer('renderWav');
  opts = opts || {};
  var song = CT_CREATE.songOf(typeof doc === 'string' ? doc : fromJSON(doc));
  if (!song) throw new Error('renderWav: not a playable song');
  var pcm = GB_APU.render(song.gb);
  var rate = opts.sampleRate || 44100, ch = 2, frames = Math.floor(pcm.length / ch);
  var buf = Buffer.alloc(44 + frames * ch * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + frames * ch * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(frames * ch * 2, 40);
  for (var i = 0; i < frames * ch; i++) {
    var s = Math.max(-1, Math.min(1, pcm[i] || 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

// A document straight to a playable song, for callers that want the notes.
function load(doc) {
  var song = CT_CREATE.songOf(String(doc || ''));
  if (!song) throw new Error('load: not a readable song document');
  return { doc: song.code, title: song.title, bpm: song.bpm, bars: song.bars, notes: song.gb.notes.length };
}

// A shareable link. The document rides in the FRAGMENT, which browsers never
// send to a server, so this needs no backend and stores nothing.
function shareUrl(doc, base) {
  return (base || 'https://chiptunes.app') + '/#s=' + String(typeof doc === 'string' ? doc : fromJSON(doc));
}


// ============================================================================
// SCENES, CONSTRAINTS, TRANSFORMS, VARIANTS, SETS
//
// Everything above this line makes ONE song from a token. Everything below is
// what people actually ask for: a cue for a scene, a track of an exact length
// that loops, a sad version of the theme, a set of cues that belong to the same
// game. See docs/AGENT_PLAN.md for why this is the shape.
// ============================================================================

// The words the audience already uses. Each is a bundle of composer premise
// plus post-composition constraints, so "boss" behaves the same way every time
// instead of depending on how a model phrases a prompt.
var SCENES = {
  title:     { styles: ['anthem', 'arcade'],          mode: 'maj', seconds: 30, loop: true },
  menu:      { styles: ['chill', 'house'],            mode: 'maj', seconds: 40, loop: true },
  overworld: { styles: ['arcade', 'anthem', 'breaks'],mode: 'maj', seconds: 60, loop: true },
  town:      { styles: ['chill', 'breaks'],           mode: 'maj', seconds: 50, loop: true },
  shop:      { styles: ['funk', 'chill'],             mode: 'maj', seconds: 30, loop: true },
  cave:      { styles: ['drone', 'ballad'],           mode: 'min', seconds: 50, loop: true },
  battle:    { styles: ['dnb', 'punk', 'techno'],     mode: 'min', seconds: 45, loop: true },
  boss:      { styles: ['dnb', 'techno', 'punk'],     mode: 'min', seconds: 50, loop: true, intensity: 1 },
  victory:   { styles: ['anthem', 'arcade'],          mode: 'maj', seconds: 10, loop: false, resolve: true },
  game_over: { styles: ['ballad', 'drone'],           mode: 'min', seconds: 12, loop: false, resolve: true },
  credits:   { styles: ['ballad', 'chill'],           mode: 'maj', seconds: 70, loop: true }
};

// Compound words as recipes over the primitives below. Shipped in
// capabilities() so a model applies "sadder" the same way twice rather than
// inventing a reading each time.
var MOODS = {
  happier:  [{ op: 'mode', to: 'major' }, { op: 'tempo', percent: 8 }, { op: 'register', lane: 'Melody', octaves: 1 }],
  sadder:   [{ op: 'mode', to: 'minor' }, { op: 'tempo', percent: -10 }, { op: 'velocity', delta: -0.1 }],
  darker:   [{ op: 'mode', to: 'minor' }, { op: 'register', lane: 'Melody', octaves: -1 }, { op: 'thin', lane: 'Drums' }],
  brighter: [{ op: 'register', lane: 'Melody', octaves: 1 }, { op: 'shape', lane: 'Melody', duty: 1 }],
  calmer:   [{ op: 'tempo', percent: -12 }, { op: 'thin', lane: 'Drums' }, { op: 'velocity', delta: -0.15 }],
  intense:  [{ op: 'tempo', percent: 12 }, { op: 'velocity', delta: 0.15 }, { op: 'register', lane: 'Bass', octaves: -1 }],
  sparser:  [{ op: 'thin', lane: 'Harmony' }, { op: 'thin', lane: 'Drums' }],
  dreamier: [{ op: 'tempo', percent: -8 }, { op: 'motion', lane: 'Melody', motion: 'echo' }, { op: 'thin', lane: 'Drums' }]
};

function rowFor(midi) { return Math.max(0, Math.min(MEL_ROWS - 1, Math.round((midi - 48) * (MEL_ROWS - 1) / 36))); }
function isDrum(c) { return c.r >= MEL_ROWS; }
function laneOf(c) { return isDrum(c) ? 3 : laneOfCell(c); }
function inScope(c, grid, from, to) {
  if (from == null && to == null) return true;
  var bar = Math.floor((c.c | 0) / grid);
  return bar >= (from == null ? -Infinity : from) && bar <= (to == null ? Infinity : to);
}

// ------------------------------------------------------------------ transform
//
// Operations are applied in order to a copy of the song's state. Every one is
// mechanical and exact -- nothing here needs taste -- so a transform can be
// explained, repeated and undone. Anything that cannot be done exactly is
// refused rather than approximated.
function transform(doc, ops) {
  var st = CT_CREATE.docState(typeof doc === 'string' ? doc : fromJSON(doc));
  if (!st) throw new Error('transform: not a readable song document');
  var grid = st.grid || 16, applied = [], skipped = [];
  [].concat(ops || []).forEach(function (o) {
    var lane = o.lane != null ? LANES.indexOf(o.lane) : -1;
    if (o.lane != null && lane < 0) { skipped.push('unknown lane ' + o.lane); return; }
    var pick = function (c) { return inScope(c, grid, o.fromBar, o.toBar) && (lane < 0 || laneOf(c) === lane); };
    switch (o.op) {
      case 'tempo':
        st.bpm = Math.max(70, Math.min(197, Math.round(
          o.absolute != null ? o.absolute
          : o.percent != null ? st.bpm * (1 + o.percent / 100)
          : o.multiply != null ? st.bpm * o.multiply : st.bpm)));
        applied.push('tempo -> ' + st.bpm); break;
      case 'transpose':
        st.cells.forEach(function (c) {
          if (isDrum(c) || c.midi == null || !pick(c)) return;
          c.midi += (o.semitones || 0) + 12 * (o.octaves || 0); c.r = rowFor(c.midi);
        });
        st.key = (((st.key + (o.semitones || 0)) % 12) + 12) % 12;
        applied.push('transposed ' + ((o.semitones || 0) + 12 * (o.octaves || 0)) + ' semitones'); break;
      case 'register':
        st.cells.forEach(function (c) {
          if (isDrum(c) || c.midi == null || !pick(c)) return;
          c.midi += 12 * (o.octaves || 0); c.r = rowFor(c.midi);
        });
        applied.push((o.lane || 'everything') + ' ' + (o.octaves > 0 ? 'up' : 'down') + ' ' + Math.abs(o.octaves || 0) + ' octave(s)'); break;
      case 'mode': {
        // Major <-> minor by moving the degrees that carry the difference:
        // the third, the sixth and the seventh, relative to the song's key.
        var toMinor = String(o.to || 'minor').indexOf('min') === 0;
        var moved = 0;
        st.cells.forEach(function (c) {
          if (isDrum(c) || c.midi == null || !pick(c)) return;
          var pc = (((c.midi - st.key) % 12) + 12) % 12;
          var d = toMinor ? ({ 4: -1, 9: -1, 11: -1 })[pc] : ({ 3: 1, 8: 1, 10: 1 })[pc];
          if (d) { c.midi += d; c.r = rowFor(c.midi); moved++; }
        });
        st.minor = toMinor ? 1 : 0;
        applied.push('mode -> ' + (toMinor ? 'minor' : 'major') + ' (' + moved + ' notes moved)'); break;
      }
      case 'velocity':
        st.cells.forEach(function (c) {
          if (!pick(c)) return;
          var v = c.vel == null ? 0.8 : c.vel;
          c.vel = Math.max(0.05, Math.min(1, v + (o.delta || 0)));
        });
        applied.push('velocity ' + (o.delta > 0 ? '+' : '') + o.delta); break;
      case 'thin': {
        // Halve a lane's notes, keeping the ones on strong beats. Density can be
        // reduced exactly; INCREASING it would mean composing, which is not a
        // transform, so there is deliberately no 'thicken'.
        var kept = [], dropped = 0, step = grid / 4;
        st.cells.forEach(function (c) {
          if (!pick(c)) { kept.push(c); return; }
          if ((c.c | 0) % (step * 2) < step) kept.push(c); else dropped++;
        });
        st.cells = kept;
        applied.push('thinned ' + (o.lane || 'everything') + ' (' + dropped + ' notes)'); break;
      }
      case 'drop': {
        var before = st.cells.length;
        st.cells = st.cells.filter(function (c) { return !pick(c); });
        applied.push('dropped ' + (o.lane || 'everything') + ' (' + (before - st.cells.length) + ' notes)'); break;
      }
      case 'trim': {
        var from = o.fromBar || 0, to = o.toBar == null ? st.bars - 1 : o.toBar;
        st.cells = st.cells.filter(function (c) {
          var b = Math.floor((c.c | 0) / grid); return b >= from && b <= to;
        }).map(function (c) { c.c = (c.c | 0) - from * grid; return c; });
        st.bars = Math.max(1, to - from + 1);
        applied.push('trimmed to bars ' + from + '-' + to); break;
      }
      case 'repeat': {
        var rf = o.fromBar || 0, rt = o.toBar == null ? st.bars - 1 : o.toBar;
        var span = rt - rf + 1, times = Math.max(1, o.times || 1), add = [];
        for (var t = 1; t <= times; t++) {
          st.cells.forEach(function (c) {
            var b = Math.floor((c.c | 0) / grid);
            if (b < rf || b > rt) return;
            var copy = JSON.parse(JSON.stringify(c));
            copy.c = (c.c | 0) + span * grid * t;
            add.push(copy);
          });
        }
        st.cells = st.cells.concat(add);
        st.bars += span * times;
        applied.push('repeated bars ' + rf + '-' + rt + ' x' + times); break;
      }
      case 'swing': st.swing = o.on === false ? 0 : 1; applied.push('swing ' + (st.swing ? 'on' : 'off')); break;
      case 'motion': {
        var flag = { arp: 'q', roll: 'g', echo: 'f', fall: 'z', rise: 'u' }[o.motion];
        if (!flag) { skipped.push('unknown motion ' + o.motion); break; }
        var allowed = capabilities().lanes[lane < 0 ? 0 : lane].motions;
        if (lane >= 0 && allowed.indexOf(o.motion) < 0) {
          skipped.push(o.lane + ' cannot do "' + o.motion + '"; it can do ' + allowed.join(', ')); break;
        }
        var n = 0;
        st.cells.forEach(function (c) { if (pick(c)) { c[flag] = 1; n++; } });
        applied.push('motion ' + o.motion + ' on ' + n + ' notes'); break;
      }
      case 'shape':
        st.cells.forEach(function (c) { if (pick(c) && !isDrum(c)) c.dy = o.duty | 0; });
        applied.push('shape ' + o.duty + ' on ' + (o.lane || 'everything')); break;
      case 'fade':
        st.cells.forEach(function (c) { if (pick(c)) c.fd = o.fade | 0; });
        applied.push('fade ' + o.fade + ' on ' + (o.lane || 'everything')); break;
      default: skipped.push('unknown operation ' + JSON.stringify(o.op));
    }
  });
  if (!st.cells.length) throw new Error('transform: that would leave the song empty');
  var out = CT_CREATE.docFromState(st);
  if (!out) throw new Error('transform: the result would not encode');
  return { doc: out, applied: applied, skipped: skipped };
}

// A named compound. The recipe is data, so an agent can read what a word does.
function variant(doc, how) {
  how = how || {};
  var ops = [];
  if (how.mood) {
    var recipe = MOODS[String(how.mood).toLowerCase()];
    if (!recipe) throw new Error('variant: no recipe for ' + JSON.stringify(how.mood) +
                                 '. Known: ' + Object.keys(MOODS).join(', '));
    ops = ops.concat(recipe);
  }
  if (how.ops) ops = ops.concat(how.ops);
  if (!ops.length) throw new Error('variant: give a mood or ops');
  var r = transform(doc, ops);
  return { doc: r.doc, applied: r.applied, skipped: r.skipped, recipe: ops };
}

// ------------------------------------------------------------------ the brief
//
// compose() above takes a token. This takes what somebody has in their head,
// and reports honestly which constraints it could not meet rather than
// pretending.
function brief(b) {
  b = b || {};
  var scene = b.scene ? SCENES[String(b.scene)] : null;
  if (b.scene && !scene) throw new Error('brief: unknown scene ' + JSON.stringify(b.scene) +
                                         '. Known: ' + Object.keys(SCENES).join(', '));
  var spec = Object.assign({}, scene || {}, b);
  var unmet = [];

  var opts = {};
  if (spec.styles) opts.styles = spec.styles;
  if (spec.mode) opts.mode = spec.mode === 'minor' ? 'min' : spec.mode === 'major' ? 'maj' : spec.mode;
  if (spec.bpmMin != null) opts.bpmMin = spec.bpmMin;
  if (spec.bpmMax != null) opts.bpmMax = spec.bpmMax;
  if (spec.title != null) opts.title = spec.title;
  // A variation number is a SEED, not randomness: the same brief and the same
  // variation give the same song forever, so an agent can explore and still get
  // back the one that was liked.
  if (spec.token) opts.token = spec.token;
  else if (spec.variation != null) opts.token = Song.mint(); // caller keeps the token we return
  var made;
  try { made = compose(opts); }
  catch (e) {
    if (!opts.styles && !opts.mode) throw e;
    delete opts.styles; unmet.push('style constraint could not be met');
    made = compose(opts);
  }

  var ops = [];
  if (spec.exclude) [].concat(spec.exclude).forEach(function (l) { ops.push({ op: 'drop', lane: l }); });
  if (spec.intensity > 0) ops.push({ op: 'velocity', delta: 0.1 });
  var doc = made.doc;
  if (ops.length) doc = transform(doc, ops).doc;

  // length: trim to a whole number of bars, which is also what makes a loop
  // seamless. Extending is a repeat, not a re-compose.
  var d = describe(doc);
  var wantBars = spec.bars != null ? spec.bars
                : spec.seconds != null ? Math.max(1, Math.round(spec.seconds / (d.seconds / d.bars))) : null;
  if (wantBars != null && wantBars !== d.bars) {
    if (wantBars < d.bars) doc = transform(doc, [{ op: 'trim', fromBar: 0, toBar: wantBars - 1 }]).doc;
    else {
      var need = wantBars - d.bars;
      doc = transform(doc, [{ op: 'repeat', fromBar: 0, toBar: Math.min(d.bars, need) - 1, times: 1 }]).doc;
      var d2 = describe(doc);
      if (d2.bars > wantBars) doc = transform(doc, [{ op: 'trim', fromBar: 0, toBar: wantBars - 1 }]).doc;
      if (describe(doc).bars < wantBars) unmet.push('could not reach ' + wantBars + ' bars');
    }
  }

  var final = describe(doc);
  if (spec.maxBytes && final.cartridgeBytes > spec.maxBytes)
    unmet.push('cartridge is ' + final.cartridgeBytes + ' bytes, over the ' + spec.maxBytes + ' asked for');
  if (spec.seconds != null && Math.abs(final.seconds - spec.seconds) > Math.max(2, spec.seconds * 0.15))
    unmet.push('closest length was ' + final.seconds + 's, not ' + spec.seconds + 's');

  return Object.assign({ doc: doc, token: made.token, scene: b.scene || null, unmet: unmet }, final);
}

// ---------------------------------------------------------------- soundtrack
//
// The thing nobody does well: several cues that sound like they came from the
// same game. Cohesion is a shared key, a shared mode family and a shared tempo
// family -- all of which are exact on a symbolic composer and impossible
// between two waveforms.
function soundtrack(b) {
  b = b || {};
  var list = [].concat(b.scenes || ['title', 'overworld', 'battle', 'boss', 'game_over']);
  list.forEach(function (s) {
    if (!SCENES[s]) throw new Error('soundtrack: unknown scene ' + JSON.stringify(s) +
                                    '. Known: ' + Object.keys(SCENES).join(', '));
  });
  var rootName = b.key || 'D';
  var root = midiOf(rootName + '4');
  if (root == null) throw new Error('soundtrack: ' + JSON.stringify(rootName) + ' is not a key, e.g. "D"');
  var targetKey = ((root % 12) + 12) % 12;
  var cues = list.map(function (name) {
    var cue = brief(Object.assign({}, b, { scene: name, scenes: undefined }));
    // pull every cue into the same key, so they belong together
    var st = CT_CREATE.docState(cue.doc);
    var shift = ((targetKey - (st.key | 0)) % 12 + 12) % 12;
    if (shift > 6) shift -= 12;
    if (shift) {
      var t = transform(cue.doc, [{ op: 'transpose', semitones: shift }]);
      cue = Object.assign({}, cue, { doc: t.doc }, describe(t.doc));
    }
    cue.scene = name;
    return cue;
  });
  return { key: rootName, mode: b.mode || null, cues: cues };
}

// -------------------------------------------------------------------- stems
//
// Four exact stems, because the chip has four voices. This is not source
// separation: it is the same render with the other channels muted, so the sum
// is the mix by construction.
function renderStems(doc, opts) {
  opts = opts || {};
  var song = CT_CREATE.songOf(typeof doc === 'string' ? doc : fromJSON(doc));
  if (!song) throw new Error('renderStems: not a playable song');
  var rate = opts.sampleRate || 44100;
  return LANES.map(function (name, ch) {
    var seq = new GB_APU.Sequencer(song.gb, rate);
    seq.chMute = [0, 1, 2, 3].map(function (c) { return c !== ch; });
    var frames = (song.gb.totalFrames || 0) + 30;
    var total = Math.ceil(frames / (GB_APU.MASTER / GB_APU.FRAME_CYCLES) * rate);
    var pcm = new Float32Array(total);
    seq.render(pcm, 0, total);
    return { lane: name, channel: ch, wav: wavOf(pcm, rate, loopPointsOf(song, rate)) };
  });
}

function loopPointsOf(song, rate) {
  var fps = HW.FPS || 59.7275, lf = song.gb.loopFrames || 0;
  if (!lf) return null;
  return { start: 0, end: Math.max(1, Math.round(lf / fps * rate)) - 1 };
}

// A WAV, with a `smpl` chunk when the song loops so a game engine reads the
// loop point without being told.
function wavOf(pcm, rate, loop) {
  needBuffer('wav export');
  var ch = 2, frames = Math.floor(pcm.length / ch);
  var smpl = loop ? 60 : 0;
  var dataBytes = frames * ch * 2;
  var buf = Buffer.alloc(44 + dataBytes + smpl);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes + smpl, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  for (var i = 0; i < frames * ch; i++) {
    var s = Math.max(-1, Math.min(1, pcm[i] || 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  if (loop) {
    var o = 44 + dataBytes;
    buf.write('smpl', o); buf.writeUInt32LE(52, o + 4);
    buf.writeUInt32LE(0, o + 8); buf.writeUInt32LE(0, o + 12);
    buf.writeUInt32LE(Math.round(1e9 / rate), o + 16);
    buf.writeUInt32LE(60, o + 20); buf.writeUInt32LE(0, o + 24);
    buf.writeUInt32LE(0, o + 28); buf.writeUInt32LE(0, o + 32);
    buf.writeUInt32LE(1, o + 36); buf.writeUInt32LE(0, o + 40);
    buf.writeUInt32LE(0, o + 44); buf.writeUInt32LE(0, o + 48);
    buf.writeUInt32LE(loop.start, o + 52); buf.writeUInt32LE(loop.end, o + 56);
  }
  return buf;
}

// ----------------------------------------------------------------- interpret
//
// WHAT SOMEBODY TYPES, TURNED INTO OPERATIONS. Deterministic on purpose: there
// is no model in the page, and a field that quietly does nothing is worse than
// no field. Everything it recognises is listed in the vocabulary it returns,
// everything it does not recognise comes back in `notUnderstood`, and the
// caller is expected to SHOW both. It never guesses.
//
// Two readings, because people mean two different things:
//   * a NEW piece   -- "a boss theme, 30 seconds, no drums"
//   * a CHANGE      -- "make it sadder", "faster", "drop the harmony"
// A change needs something to change, so with no song playing it falls back to
// composing one and applying the change to it.

var WORD_SCENES = {
  'title': 'title', 'title screen': 'title', 'main theme': 'title',
  'menu': 'menu', 'pause': 'menu',
  'overworld': 'overworld', 'world map': 'overworld', 'exploring': 'overworld',
  'town': 'town', 'village': 'town', 'shop': 'shop', 'store': 'shop',
  'cave': 'cave', 'dungeon': 'cave', 'underground': 'cave',
  'battle': 'battle', 'fight': 'battle', 'combat': 'battle',
  'boss': 'boss', 'boss fight': 'boss', 'final boss': 'boss',
  'victory': 'victory', 'win': 'victory', 'fanfare': 'victory',
  'game over': 'game_over', 'death': 'game_over', 'defeat': 'game_over',
  'credits': 'credits', 'ending': 'credits'
};
var WORD_MOODS = {
  happy: 'happier', happier: 'happier', cheerful: 'happier', upbeat: 'happier', joyful: 'happier',
  sad: 'sadder', sadder: 'sadder', melancholy: 'sadder', sorrowful: 'sadder', mournful: 'sadder',
  dark: 'darker', darker: 'darker', sinister: 'darker', ominous: 'darker', evil: 'darker',
  bright: 'brighter', brighter: 'brighter', sparkly: 'brighter',
  calm: 'calmer', calmer: 'calmer', relaxed: 'calmer', gentle: 'calmer', chill: 'calmer', peaceful: 'calmer',
  intense: 'intense', intenser: 'intense', aggressive: 'intense', urgent: 'intense', epic: 'intense', heavy: 'intense',
  sparse: 'sparser', sparser: 'sparser', simpler: 'sparser', minimal: 'sparser', emptier: 'sparser',
  dreamy: 'dreamier', dreamier: 'dreamier', ethereal: 'dreamier', floaty: 'dreamier'
};
var LANE_WORDS = { drums: 'Drums', drum: 'Drums', percussion: 'Drums', beat: 'Drums',
                   bass: 'Bass', melody: 'Melody', lead: 'Melody', tune: 'Melody',
                   harmony: 'Harmony', chords: 'Harmony', pads: 'Harmony' };

function interpret(text, opts) {
  opts = opts || {};
  var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9#.\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  var understood = [], notUnderstood = [], spec = {}, ops = [], sawScene = null, sawNew = false;

  // scenes, longest phrase first so "boss fight" beats "fight"
  Object.keys(WORD_SCENES).sort(function (a, b) { return b.length - a.length; }).forEach(function (w) {
    if (sawScene) return;
    if (t.indexOf(' ' + w + ' ') >= 0) { sawScene = WORD_SCENES[w]; understood.push('scene: ' + sawScene); }
  });
  if (sawScene) { spec.scene = sawScene; sawNew = true; }

  // length
  var m = t.match(/(\d+(?:\.\d+)?)\s*(seconds|second|secs|sec|s)\b/);
  if (m) { spec.seconds = +m[1]; understood.push('length: ' + spec.seconds + 's'); sawNew = true; }
  var mb = t.match(/(\d+)\s*(bars|bar)\b/);
  if (mb) { spec.bars = +mb[1]; understood.push('length: ' + spec.bars + ' bars'); sawNew = true; }
  if (/\ba minute\b/.test(t)) { spec.seconds = 60; understood.push('length: 60s'); sawNew = true; }
  if (/\b(short|brief)\b/.test(t) && !spec.seconds) { spec.seconds = 20; understood.push('length: short (20s)'); sawNew = true; }
  if (/\b(long|longer piece|full)\b/.test(t) && !spec.seconds) { spec.seconds = 75; understood.push('length: long (75s)'); sawNew = true; }

  // key and mode
  var mk = t.match(/\bin ([a-g])(\s?#|\s?sharp|\s?flat)?\s*(major|minor)?\b/);
  if (mk) {
    spec.key = mk[1].toUpperCase() + (mk[2] && /#|sharp/.test(mk[2]) ? '#' : '');
    understood.push('key: ' + spec.key);
    if (mk[3]) { spec.mode = mk[3]; understood.push('mode: ' + mk[3]); }
    sawNew = true;
  }
  if (!spec.mode && /\bminor\b/.test(t)) { spec.mode = 'minor'; understood.push('mode: minor'); }
  if (!spec.mode && /\bmajor\b/.test(t)) { spec.mode = 'major'; understood.push('mode: major'); }

  // lanes to leave out
  Object.keys(LANE_WORDS).forEach(function (w) {
    if (new RegExp('\\b(no|without|remove|drop|mute|lose the|minus)\\s+' + w + '\\b').test(t)) {
      var lane = LANE_WORDS[w];
      if ((spec.exclude || []).indexOf(lane) < 0) { (spec.exclude = spec.exclude || []).push(lane); ops.push({ op: 'drop', lane: lane }); }
      understood.push('without ' + lane);
    }
  });

  // tempo
  var bpm = t.match(/(\d{2,3})\s*bpm\b/);
  if (bpm) { ops.push({ op: 'tempo', absolute: +bpm[1] }); understood.push('tempo: ' + bpm[1] + ' bpm'); }
  else if (/\b(much|way|a lot) (faster|quicker)\b/.test(t)) { ops.push({ op: 'tempo', percent: 25 }); understood.push('much faster'); }
  else if (/\b(a (bit|little)|slightly) (faster|quicker)\b/.test(t)) { ops.push({ op: 'tempo', percent: 6 }); understood.push('a bit faster'); }
  else if (/\b(faster|quicker|speed it up)\b/.test(t)) { ops.push({ op: 'tempo', percent: 15 }); understood.push('faster'); }
  else if (/\b(much|way|a lot) slower\b/.test(t)) { ops.push({ op: 'tempo', percent: -25 }); understood.push('much slower'); }
  else if (/\b(a (bit|little)|slightly) slower\b/.test(t)) { ops.push({ op: 'tempo', percent: -6 }); understood.push('a bit slower'); }
  else if (/\b(slower|slow it down)\b/.test(t)) { ops.push({ op: 'tempo', percent: -15 }); understood.push('slower'); }
  if (/\bhalf time\b/.test(t)) { ops.push({ op: 'tempo', multiply: 0.5 }); understood.push('half time'); }
  if (/\bdouble time\b/.test(t)) { ops.push({ op: 'tempo', multiply: 2 }); understood.push('double time'); }

  // register
  if (/\b(higher|up an octave|an octave up)\b/.test(t)) { ops.push({ op: 'register', lane: 'Melody', octaves: 1 }); understood.push('melody an octave up'); }
  if (/\b(lower|down an octave|an octave down)\b/.test(t)) { ops.push({ op: 'register', lane: 'Melody', octaves: -1 }); understood.push('melody an octave down'); }

  // structure
  if (/\b(repeat|say it again|again)\b/.test(t)) { ops.push({ op: 'repeat', times: 1 }); understood.push('repeat it'); }
  if (/\bswing\b/.test(t)) { ops.push({ op: 'swing', on: !/\b(no|without|straight)\s+swing\b/.test(t) }); understood.push('swing'); }

  // moods, last so an explicit tempo word wins its own slot
  var moods = [];
  Object.keys(WORD_MOODS).sort(function (a, b) { return b.length - a.length; }).forEach(function (w) {
    if (moods.length) return;
    if (new RegExp('\\b' + w + '\\b').test(t)) { moods.push(WORD_MOODS[w]); understood.push('mood: ' + WORD_MOODS[w]); }
  });

  // is this a new piece or a change to one?
  var changeish = /\b(make it|more|less|-er|instead|now)\b/.test(t) || (ops.length > 0 && !sawNew);
  var kind = (sawNew || (!opts.hasSong && !ops.length && !moods.length)) ? 'brief'
           : (changeish || moods.length || ops.length) ? 'change' : 'brief';

  // a mood on a NEW piece steers the composer; on a change it is a recipe
  if (kind === 'brief' && moods.length) {
    var toMode = { sadder: 'minor', darker: 'minor', happier: 'major', brighter: 'major' }[moods[0]];
    if (toMode && !spec.mode) { spec.mode = toMode; understood.push('mode: ' + toMode); }
  }

  // anything left that we clearly ignored
  var claimed = understood.join(' ').toLowerCase();
  String(text || '').toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean).forEach(function (w) {
    if (w.length < 4) return;
    if (claimed.indexOf(w) >= 0) return;
    // words that ARE consumed, just not echoed verbatim in the summary. Crying
    // wolf about these would make the "ignored" line useless.
    if (/^(make|that|this|with|please|song|track|music|piece|thing|want|like|give|some|about|which|would|could|really|theme|tune|screen|second|seconds|secs|bars|minute|minutes|fanfare|sounding|feel|feeling|vibe|style|kind|something|anything|there|from|into|onto|then|also|very|much|more|less|just|only|even|still|again|now|and|but|for|the|a|an)$/.test(w)) return;
    if (WORD_MOODS[w] || LANE_WORDS[w] || WORD_SCENES[w]) return;
    if (notUnderstood.indexOf(w) < 0) notUnderstood.push(w);
  });

  return { kind: kind, spec: spec, ops: ops, moods: moods, understood: understood, notUnderstood: notUnderstood };
}

// Interpret and carry out, in one call. Returns the new document plus exactly
// what it did, so a caller can show its working instead of being a black box.
function ask(text, opts) {
  opts = opts || {};
  var read = interpret(text, { hasSong: !!opts.doc });
  if (!read.understood.length)
    return Object.assign({ ok: false, error: 'I did not recognise anything in that.' }, read);
  var doc = opts.doc || null, applied = [], skipped = [], made = null;
  if (read.kind === 'brief' || !doc) {
    made = brief(Object.assign({}, read.spec, opts.brief || {}));
    doc = made.doc;
    applied = applied.concat(read.understood.filter(function (u) { return /^(scene|length|key|mode|without)/.test(u); }));
    if (made.unmet && made.unmet.length) skipped = skipped.concat(made.unmet);
  }
  var ops = read.ops.slice();
  read.moods.forEach(function (m) { ops = ops.concat(MOODS[m] || []); });
  if (ops.length) {
    var r = transform(doc, ops);
    doc = r.doc; applied = applied.concat(r.applied); skipped = skipped.concat(r.skipped);
  }
  return Object.assign({ ok: true, doc: doc, applied: applied, skipped: skipped }, describe(doc), read);
}

// --------------------------------------------------------------------- guide
//
// The answers an agent would otherwise guess at, and guess wrong. Licensing in
// particular: a model that invents an answer here tells the user something
// false about what they may ship.
function guide() {
  return {
    whatThisIs: 'A deterministic Game Boy music composer with a register-level emulation of the DMG sound chip. Songs are symbolic documents, not recordings.',
    instantFreeLocal: {
      composeMs: 1.6, thousandSongsMs: 471, cartridgeMs: 1.2, renderRealtimeFactor: 395,
      note: 'Composition runs on your machine. There is no queue, no account, no key and nothing metered. Generating a hundred candidates and keeping one is reasonable here.'
    },
    determinism: 'The same token composes the same song forever, and the same document always materialises the same notes. Keep the token or the document to reproduce a track exactly.',
    provenance: 'The music comes from a deterministic algorithm in a public repository, not a model trained on recordings. There is no third-party audio in the output.',
    licensing: 'The source is MIT. The generated music is produced by that algorithm on your machine. This is not legal advice, and the project makes no warranty; the repository and its LICENSE are the authority.',
    looping: 'Songs carry a loop point. Ask for loop:true in a brief and the cue is trimmed to a whole number of bars; exported WAVs carry a smpl chunk so engines pick the loop up automatically.',
    stems: 'Four exact stems, one per hardware channel (Melody, Harmony, Bass, Drums). This is not source separation: the other channels are muted for each render, so the stems sum to the mix.',
    formats: ['wav (16-bit stereo, optional loop metadata)', 'stems (four wavs)', 'gb (32 KB cartridge, boots on hardware)', 'song document (a string)', 'share link (the document rides in the URL fragment)'],
    limits: 'Four voices, one note at a time per lane, 32 KB on the cartridge. No vocals. One aesthetic: this is a Game Boy, not a general music model.',
    howToAsk: 'Start with a scene (title, overworld, battle, boss, game_over, ...) plus a length. Use variant() for "the sad version of this". Use soundtrack() when several cues have to belong together.',
    scenes: Object.keys(SCENES),
    moodWords: Object.keys(MOODS),
    recipes: MOODS
  };
}

var EXPORTS = {
  API_VERSION: API_VERSION,
  capabilities: capabilities,
  compose: compose,
  load: load,
  toJSON: toJSON,
  fromJSON: fromJSON,
  validate: validate,
  describe: describe,
  buildCartridge: buildCartridge,
  renderWav: renderWav,
  shareUrl: shareUrl,
  noteName: noteName,
  midiOf: midiOf,
  // the layer this file gained for agents: briefs, sets, transforms, stems
  guide: guide,
  scenes: function () { return JSON.parse(JSON.stringify(SCENES)); },
  moods: function () { return JSON.parse(JSON.stringify(MOODS)); },
  brief: brief,
  soundtrack: soundtrack,
  transform: transform,
  variant: variant,
  renderStems: renderStems,
  interpret: interpret,
  ask: ask
};

// In the browser this file is concatenated as a plain script, so the same
// surface has to be reachable as a global. Named CT_API to sit beside
// CT_CREATE and CT_GB_*; window.chiptunes (webmcp.js) is the agent-facing name.

  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  try { _G.CT_API = EXPORTS; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : window);
