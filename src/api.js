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
var REF = _req ? _req('./reference-styles.js') : _G.CT_REFERENCE_STYLES;
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
    genres: Object.keys(WORD_GENRES),
    gameGenres: Object.keys(WORD_GAME_GENRES),
    forms: Object.keys(WORD_FORMS),
    techniques: Object.keys(WORD_TECHNIQUES),
    meter: 'Everything is in four. There is no time-signature dial, so a waltz is not expressible and asking for one says so rather than pretending.',
    titles: REF && REF.names ? REF.names() : [],
    references: 'Naming a game from `titles` is READ AS a genre description -- genre, styles, major/minor, a tempo band, a mood, one technique -- and the reading is always said back so you can disagree with it. It is not an imitation: nothing here is trained on or derived from anybody else\'s music, and a title can only set dials you could type yourself. A name that is not on the list is REFUSED rather than quietly ignored, because it maps to nothing at all.',
    operations: ['tempo', 'transpose', 'register', 'mode', 'velocity', 'thin', 'double',
                 'subdivide', 'drop', 'trim', 'repeat', 'swing', 'resolve', 'motion',
                 'shape', 'fade'],
    layers: LAYER_SETS.map(function (l) { return { name: l.name, lanes: l.keep, use: l.use }; }),
    variety: 'Cohesion devices are opt-in on purpose. soundtrack() shares a KEY by default, which costs no variety; a shared motif needs motif:true and is transposed per cue rather than copied. Nothing is shared between two different soundtracks.',
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
  dreamier: [{ op: 'tempo', percent: -8 }, { op: 'motion', lane: 'Melody', motion: 'echo' }, { op: 'thin', lane: 'Drums' }],
  // compounds, spelled out for the same reason the simple ones are: a word that
  // means something different each time it is used is not a vocabulary
  heroic:     [{ op: 'mode', to: 'major' }, { op: 'tempo', percent: 6 }, { op: 'register', lane: 'Melody', octaves: 1 }, { op: 'velocity', delta: 0.1 }],
  mysterious: [{ op: 'mode', to: 'minor' }, { op: 'tempo', percent: -10 }, { op: 'thin', lane: 'Drums' }, { op: 'motion', lane: 'Melody', motion: 'echo' }],
  menacing:   [{ op: 'mode', to: 'minor' }, { op: 'register', lane: 'Melody', octaves: -1 }, { op: 'register', lane: 'Bass', octaves: -1 }, { op: 'velocity', delta: 0.1 }],
  frantic:    [{ op: 'tempo', percent: 22 }, { op: 'subdivide', lane: 'Drums' }, { op: 'velocity', delta: 0.12 }],
  playful:    [{ op: 'mode', to: 'major' }, { op: 'tempo', percent: 10 }, { op: 'swing', on: true }, { op: 'register', lane: 'Melody', octaves: 1 }],
  solemn:     [{ op: 'tempo', percent: -18 }, { op: 'thin', lane: 'Drums' }, { op: 'register', lane: 'Bass', octaves: -1 }],
  tense:      [{ op: 'mode', to: 'minor' }, { op: 'thin', lane: 'Melody' }, { op: 'velocity', delta: -0.05 }, { op: 'tempo', percent: 5 }],
  // EXPLORING IS A FEELING WITH A SHAPE: unhurried, thin underneath, long
  // notes, and a melody that answers itself. It is the trait that makes a
  // wandering game sound like one, and there was no way to ask for it.
  exploratory:[{ op: 'tempo', percent: -8 }, { op: 'thin', lane: 'Harmony' },
               { op: 'fade', fade: 0 }, { op: 'motion', lane: 'Melody', motion: 'echo' }]
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
      case 'resolve': {
        // End on the tonic. That is what "make it resolve" means, and it is
        // exact: move the LAST melodic note to the nearest pitch whose class is
        // the key. Nothing is composed.
        var lastCell = null;
        st.cells.forEach(function (c) {
          if (isDrum(c) || c.midi == null) return;
          if (o.lane != null && laneOf(c) !== lane) return;
          if (!lastCell || (c.c | 0) > (lastCell.c | 0)) lastCell = c;
        });
        if (!lastCell) { skipped.push('nothing melodic to resolve'); break; }
        var want = st.key | 0, pcNow = ((lastCell.midi % 12) + 12) % 12;
        var upBy = ((want - pcNow) % 12 + 12) % 12, downBy = upBy - 12;
        lastCell.midi += (Math.abs(downBy) < upBy ? downBy : upBy);
        lastCell.r = rowFor(lastCell.midi);
        applied.push('resolved to the tonic (' + noteName(lastCell.midi) + ')'); break;
      }
      case 'double': {
        // DENSITY UP, HONESTLY -- and constrained by the hardware in a way that
        // took a failing test to notice. `thin` had no opposite because
        // inventing notes is composing; doubling only DERIVES from notes already
        // present, which is fine. But the DMG has ONE VOICE PER CHANNEL: an
        // octave copy left on its own lane sounds at the same instant as the
        // note it came from, and the voice allocator correctly drops one of
        // them, so the operation silently did nothing. A double has to land on
        // a DIFFERENT lane that is free at that moment, and if none is, this
        // says so instead of pretending.
        var oct = o.octaves == null ? -1 : o.octaves;
        var toLane = o.to != null ? LANES.indexOf(o.to) : -1;
        if (o.to != null && toLane < 0) { skipped.push('unknown lane ' + o.to); break; }
        var melodic = [0, 1, 2];                       // Drums cannot carry a pitch
        var busy = {};                                 // lane -> occupied step ranges
        st.cells.forEach(function (c) {
          if (isDrum(c)) return;
          var L = laneOf(c);
          (busy[L] = busy[L] || []).push([c.c | 0, (c.c | 0) + (c.len || 1)]);
        });
        var free = function (L, from, to2) {
          return !(busy[L] || []).some(function (r) { return from < r[1] && to2 > r[0]; });
        };
        var add2 = [], noRoom = 0;
        st.cells.slice().forEach(function (c) {
          if (isDrum(c) || c.midi == null || !pick(c)) return;
          var midi = c.midi + 12 * oct;
          if (midi < 24 || midi > 108) return;
          var from = c.c | 0, to2 = from + (c.len || 1);
          var target = toLane >= 0 ? (free(toLane, from, to2) ? toLane : -1)
                                   : (melodic.filter(function (L) { return L !== laneOf(c) && free(L, from, to2); })[0]);
          if (target == null || target < 0) { noRoom++; return; }
          var cp = JSON.parse(JSON.stringify(c));
          cp.midi = midi; cp.r = rowFor(midi);
          cp.vel = Math.max(0.05, (c.vel == null ? 0.8 : c.vel) * 0.8);
          cp.ch = target === 2 ? undefined : target;
          cp.st = target === 2 ? 'bassg' : target === 1 ? 'bell' : 'piano';
          if (cp.ch === undefined) delete cp.ch;
          // ⚠️ MOVING A NOTE BETWEEN LANES MEANS MOVING IT BETWEEN CHANNELS, and
          // the channels are not interchangeable on this chip. An instrument
          // record belongs to one: a wave table is meaningless on a pulse
          // channel and a duty is meaningless on the wave channel. Carrying the
          // source note's `inst` across is precisely the fault HANDOFF.md
          // records as guarded ("the instrument has to belong to the channel"),
          // and it would also send the copy straight back to the lane it came
          // from, because cellVoice() reads the instrument to decide.
          // Drop everything channel-specific and let the stamp speak.
          delete cp.inst; delete cp.dy; delete cp.fd; delete cp.wv; delete cp.nz; delete cp.ns;
          // the sweep unit is channel 1's alone
          if (target !== 0) { delete cp.z; delete cp.u; }
          (busy[target] = busy[target] || []).push([from, to2]);
          add2.push(cp);
        });
        st.cells = st.cells.concat(add2);
        applied.push('doubled ' + (o.lane || 'everything') + ' ' + (oct < 0 ? 'an octave down' : 'an octave up') +
                     ' onto a free voice (' + add2.length + ' notes)');
        if (noRoom) skipped.push(noRoom + ' note(s) had no free voice to double into: the chip has one voice per lane');
        break;
      }
      case 'subdivide': {
        // The other honest way to add density: a held note becomes two of half
        // the length. Derived, not invented.
        var add3 = [], splitN = 0;
        st.cells.forEach(function (c) {
          if (!pick(c)) return;
          var len = c.len || 1;
          if (len < 2) return;
          var half = Math.floor(len / 2);
          c.len = half;
          var cp = JSON.parse(JSON.stringify(c));
          cp.c = (c.c | 0) + half; cp.len = len - half;
          add3.push(cp); splitN++;
        });
        st.cells = st.cells.concat(add3);
        applied.push('subdivided ' + (o.lane || 'everything') + ' (' + splitN + ' notes)'); break;
      }
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
  // SCENES has carried `resolve: true` on victory and game_over since scenes
  // were added, and brief() never read it, so the two cues that most need a
  // clean ending were the two not getting one. It is a transform, so it goes
  // in with the others -- before the length trim, since trimming can remove
  // the bar the resolved note lands in and the trim is what defines the end.
  if (spec.resolve) ops.push({ op: 'resolve' });
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
  // A SHARED MOTIF IS WHAT MAKES IT A SOUNDTRACK RATHER THAN A PLAYLIST. Take
  // the opening melodic figure of the first cue and plant it at the head of
  // every other one, replacing whatever melody they had there. They are already
  // in one key, so it lands without transposition. Only possible because the
  // music is symbolic: you cannot move a figure between two waveforms.
  // ⚠️ A SHARED MOTIF IS OFF BY DEFAULT, and that is a deliberate reversal.
  // Cohesion devices are exactly how a generator starts sounding the same, and
  // the owner has been burned by that repeatedly. Shared KEY already makes cues
  // belong together and costs no variety; a recurring figure is a stronger,
  // riskier claim, so it is opt-in with `motif: true`.
  //
  // And when it is on, the figure is VARIED rather than copied: each cue gets it
  // at a different transposition and register, so they are related the way a
  // leitmotif is related, not identical. Measured either way by
  // scripts/verify-diversity.js, which fails if output gets samey.
  var motif = null;
  if (b.motif === true && cues.length > 1) {
    var src = CT_CREATE.docState(cues[0].doc), grid0 = src.grid || 16;
    // Look for the first two-bar window that actually HAS a phrase in it. The
    // opening bars of a cue are often empty or a single held note, and taking
    // whatever is at bar 0 meant a soundtrack sometimes reported no motif at
    // all -- which read as the feature being broken rather than the cue being
    // sparse there.
    var figure = [], motifBar = 0, motifLane = 0, why = null;
    // Search the WHOLE cue, and take Harmony if Melody has nothing: both are
    // pulse voices, and a figure stated on the second pulse is an ordinary
    // thing for this hardware. Some cues genuinely have no melodic phrase at
    // all -- a drone or a percussion-led piece -- and in that case there is
    // nothing to share and it should say so rather than share silence.
    for (var ln = 0; ln < 2 && !figure.length; ln++) {
      for (var w = 0; w < src.bars && !figure.length; w++) {
        var lo = w * grid0, hi = lo + grid0 * 2;
        var got = src.cells.filter(function (c) {
          return !isDrum(c) && c.midi != null && laneOf(c) === ln && (c.c | 0) >= lo && (c.c | 0) < hi;
        });
        if (got.length >= 3) {
          motifBar = w; motifLane = ln;
          figure = got.map(function (c) {
            var cp = JSON.parse(JSON.stringify(c)); cp.c = (c.c | 0) - lo; return cp;
          });
        }
      }
    }
    if (figure.length < 2) why = 'the first cue has no melodic phrase to build on';
    if (figure.length >= 2) {
      motif = { notes: figure.length, bars: 2, fromBar: motifBar,
                lane: LANES[motifLane],
                pitches: figure.slice(0, 8).map(function (c) { return noteName(c.midi); }) };
      // musical relations, not repetition: the octave, the fifth, the fourth
      // below, the sixth. Each cue hears the figure somewhere else.
      var RELATION = [0, 7, -5, 12, 3, -12, 5];
      for (var i = 1; i < cues.length; i++) {
        var stc = CT_CREATE.docState(cues[i].doc), g = stc.grid || 16, win = g * 2;
        var shiftBy = RELATION[i % RELATION.length];
        stc.cells = stc.cells.filter(function (c) {
          return !(!isDrum(c) && c.midi != null && laneOf(c) === 0 && (c.c | 0) < win);
        });
        stc.cells = stc.cells.filter(function (c) {
          return !(!isDrum(c) && c.midi != null && laneOf(c) === motifLane && (c.c | 0) < win);
        });
        figure.forEach(function (c) {
          var cp = JSON.parse(JSON.stringify(c));
          cp.c = Math.round((c.c | 0) * (g / grid0));       // rescale if the grid differs
          cp.midi = c.midi + shiftBy;
          if (cp.midi < 24 || cp.midi > 108) cp.midi = c.midi;
          cp.r = rowFor(cp.midi);
          if (cp.c < win) stc.cells.push(cp);
        });
        var re = CT_CREATE.docFromState(stc);
        if (re) {
          var sc = cues[i].scene;
          cues[i] = Object.assign({}, cues[i], { doc: re }, describe(re),
                                  { scene: sc, motif: { transposedBy: shiftBy } });
        }
      }
    }
  }
  return { key: rootName, mode: b.mode || null, motif: motif,
           motifSkipped: (b.motif === true && !motif) ? why : undefined, cues: cues };
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
  'intro': 'title', 'opening': 'title', 'attract mode': 'title',
  'menu': 'menu', 'pause': 'menu', 'main menu': 'menu', 'file select': 'menu',
  'character select': 'menu', 'options screen': 'menu',
  // NOT 'exploring': it is a feeling, not a place, and as a scene word it beat
  // "cave" in "a gloomy song about exploring a cave" purely for being longer.
  // It is a mood now, and the overworld still has four ways to ask for it.
  'overworld': 'overworld', 'world map': 'overworld',
  'field': 'overworld', 'travelling': 'overworld', 'traveling': 'overworld',
  'town': 'town', 'village': 'town', 'inn': 'town', 'tavern': 'town',
  'shop': 'shop', 'store': 'shop', 'market': 'shop', 'merchant': 'shop',
  'cave': 'cave', 'dungeon': 'cave', 'underground': 'cave', 'cavern': 'cave',
  'temple': 'cave', 'crypt': 'cave', 'catacombs': 'cave', 'labyrinth': 'cave',
  'sewer': 'cave', 'sewers': 'cave', 'ruins': 'cave', 'caves': 'cave', 'dungeons': 'cave',
  'battle': 'battle', 'fight': 'battle', 'combat': 'battle',
  'encounter': 'battle', 'skirmish': 'battle', 'duel': 'battle',
  'boss': 'boss', 'boss fight': 'boss', 'final boss': 'boss', 'boss battle': 'boss',
  'final battle': 'boss',
  'victory': 'victory', 'win': 'victory', 'fanfare': 'victory',
  'level complete': 'victory', 'stage clear': 'victory', 'results': 'victory',
  'game over': 'game_over', 'death': 'game_over', 'defeat': 'game_over',
  'you died': 'game_over', 'continue screen': 'game_over',
  'credits': 'credits', 'ending': 'credits', 'outro': 'credits',
  'staff roll': 'credits', 'end credits': 'credits'
};
var WORD_MOODS = {
  happy: 'happier', happier: 'happier', cheerful: 'happier', upbeat: 'happier', joyful: 'happier',
  sunny: 'happier', warm: 'happier',
  sad: 'sadder', sadder: 'sadder', melancholy: 'sadder', melancholic: 'sadder', sorrowful: 'sadder',
  mournful: 'sadder', wistful: 'sadder', bittersweet: 'sadder', lonely: 'sadder', nostalgic: 'sadder',
  dark: 'darker', darker: 'darker', sinister: 'darker', ominous: 'darker', evil: 'darker',
  grim: 'darker', bleak: 'darker',
  bright: 'brighter', brighter: 'brighter', sparkly: 'brighter', hopeful: 'brighter', shimmering: 'brighter',
  calm: 'calmer', calmer: 'calmer', relaxed: 'calmer', gentle: 'calmer', chill: 'calmer', peaceful: 'calmer',
  quiet: 'calmer', serene: 'calmer',
  intense: 'intense', intenser: 'intense', aggressive: 'intense', urgent: 'intense', epic: 'intense',
  heavy: 'intense', driving: 'intense', relentless: 'intense',
  sparse: 'sparser', sparser: 'sparser', simpler: 'sparser', minimal: 'sparser', emptier: 'sparser',
  dreamy: 'dreamier', dreamier: 'dreamier', ethereal: 'dreamier', floaty: 'dreamier', hazy: 'dreamier',
  // compounds of the above, so a word means the same thing every time
  heroic: 'heroic', triumphant: 'heroic', victorious: 'heroic', noble: 'heroic',
  mysterious: 'mysterious', eerie: 'mysterious', haunting: 'mysterious', creepy: 'mysterious',
  spooky: 'mysterious', uneasy: 'mysterious',
  menacing: 'menacing', threatening: 'menacing', foreboding: 'menacing', brooding: 'menacing',
  frantic: 'frantic', panicked: 'frantic', desperate: 'frantic', hectic: 'frantic',
  playful: 'playful', bouncy: 'playful', silly: 'playful', jaunty: 'playful',
  solemn: 'solemn', stately: 'solemn', ceremonial: 'solemn', reverent: 'solemn',
  tense: 'tense', anxious: 'tense', nervous: 'tense', suspenseful: 'tense',
  exploratory: 'exploratory', exploring: 'exploratory', exploration: 'exploratory',
  wandering: 'exploratory', roaming: 'exploratory',
  gloomy: 'darker', moody: 'darker', murky: 'darker',
  adventurous: 'heroic', daring: 'heroic', valiant: 'heroic',
  whimsical: 'playful', mischievous: 'playful',
  somber: 'solemn', sombre: 'solemn', majestic: 'solemn', dignified: 'solemn',
  atmospheric: 'dreamier', spacious: 'dreamier'
};
// GENRES ARE REAL DIALS. The composer's fourteen styles ARE genres, so mapping
// a genre word onto them is a true statement about what the machine will do --
// unlike a franchise name, which could only be a guess wearing a trademark.
var WORD_GENRES = {
  anthem: ['anthem'], anthemic: ['anthem'],
  house: ['house'], techno: ['techno'], trance: ['trance'],
  dnb: ['dnb'], jungle: ['dnb'], breakbeat: ['breaks'], breaks: ['breaks'],
  arcade: ['arcade'], rock: ['rock'], punk: ['punk'], hardcore: ['punk'],
  funk: ['funk'], funky: ['funk'], groovy: ['funk'],
  hiphop: ['boombap'], boombap: ['boombap'], lofi: ['boombap', 'chill'],
  ambient: ['drone', 'chill'], drone: ['drone'],
  ballad: ['ballad'],
  dance: ['house', 'trance'], electronic: ['techno', 'house'], rave: ['trance', 'techno'],
  metal: ['punk', 'rock'], surf: ['rock'], disco: ['house', 'funk']
};

// GAME GENRES, which is usually what somebody means when they name a game.
// These are ordinary genre words, not marks belonging to anybody.
var WORD_GAME_GENRES = {
  platformer: { styles: ['arcade', 'anthem'], mode: 'major' },
  shmup: { styles: ['dnb', 'techno'], mode: 'minor' },
  shooter: { styles: ['dnb', 'techno'], mode: 'minor' },
  racing: { styles: ['anthem', 'trance'], mode: 'major', bpmMin: 145 },
  puzzle: { styles: ['chill', 'house'], mode: 'major' },
  rpg: { styles: ['anthem', 'ballad'], mode: 'major' },
  jrpg: { styles: ['anthem', 'ballad'], mode: 'major' },
  adventure: { styles: ['anthem', 'arcade'], mode: 'major' },
  horror: { styles: ['drone', 'ballad'], mode: 'minor' },
  roguelike: { styles: ['chill', 'drone'], mode: 'minor' },
  fighting: { styles: ['rock', 'punk'], mode: 'minor', bpmMin: 140 },
  stealth: { styles: ['chill', 'drone'], mode: 'minor' },
  strategy: { styles: ['chill', 'anthem'], mode: 'major' },
  sports: { styles: ['anthem', 'breaks'], mode: 'major' },
  metroidvania: { styles: ['chill', 'anthem'], mode: 'minor' }
};

// FORMS -- what shape the piece takes.
var WORD_FORMS = {
  fanfare:  { styles: ['anthem'], mode: 'major', seconds: 10, loop: false },
  lullaby:  { styles: ['ballad'], mode: 'major', seconds: 45, bpmMax: 90 },
  dirge:    { styles: ['drone', 'ballad'], mode: 'minor', bpmMax: 82 },
  hymn:     { styles: ['ballad'], mode: 'major', bpmMax: 95 },
  march:    { styles: ['anthem', 'rock'], mode: 'major', bpmMin: 110, bpmMax: 130 },
  sting:    { styles: ['arcade'], seconds: 6, loop: false }
};

// TECHNIQUES -- things this chip does, named the way a musician names them.
var WORD_TECHNIQUES = {
  arpeggiated: { op: 'motion', motion: 'arp' }, arpeggios: { op: 'motion', motion: 'arp' },
  arps: { op: 'motion', motion: 'arp' }, arpeggio: { op: 'motion', motion: 'arp' },
  echoing: { op: 'motion', lane: 'Melody', motion: 'echo' },
  rolled: { op: 'motion', motion: 'roll' },
  staccato: { op: 'fade', fade: 6 }, plucky: { op: 'fade', fade: 6 },
  sustained: { op: 'fade', fade: 0 }, legato: { op: 'fade', fade: 0 },
  punchy: { op: 'velocity', delta: 0.12 }, muted: { op: 'velocity', delta: -0.15 },
  syncopated: { op: 'swing', on: true }, swung: { op: 'swing', on: true },
  shuffled: { op: 'swing', on: true },
  doubled: { op: 'double', lane: 'Bass' }, halftime: { op: 'tempo', multiply: 0.5 }
};

var LANE_WORDS = { drums: 'Drums', drum: 'Drums', percussion: 'Drums', beat: 'Drums',
                   bass: 'Bass', melody: 'Melody', lead: 'Melody', tune: 'Melody',
                   harmony: 'Harmony', chords: 'Harmony', pads: 'Harmony' };

// ONE NORMALISATION, shared with reference-styles.js so the table's keys and
// the sentence are the same shape. Two bugs came from having more than one:
// hyphens survived, so "boss-fight" matched nothing, and the `3/4` test could
// never fire because the slash had already become a space before it ran.
var _norm = (REF && REF.normalize) || function (s) {
  return String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ')
    .replace(/['‘’ʼ]/g, '').replace(/[^a-z0-9#]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
};

// "forty five seconds" is how people type a duration. Leaving it unparsed made
// the parser look worst at the one constraint it is genuinely good at.
var NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, sixteen: 16,
  eighteen: 18, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
var TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
             sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function _digits(s) {
  var w = s.split(' '), out = [];
  for (var i = 0; i < w.length; i++) {
    if (TENS[w[i]] != null && NUM_WORDS[w[i + 1]] != null && NUM_WORDS[w[i + 1]] < 10) {
      out.push(String(TENS[w[i]] + NUM_WORDS[w[i + 1]])); i++; continue;
    }
    out.push(NUM_WORDS[w[i]] != null ? String(NUM_WORDS[w[i]]) : w[i]);
  }
  return out.join(' ');
}
// Flats are spelled as sharps everywhere below this line, because the composer
// names twelve pitch classes and does not have two names for any of them.
var FLAT_TO_SHARP = { a: 'G#', b: 'A#', c: 'B', d: 'C#', e: 'D#', f: 'E', g: 'F#' };

// Can any of these styles sit in this tempo band? The composer's styles each
// have a narrow native range, and a premise naming both a style and a band
// outside it leaves pickStyle() with nothing to pick.
function _styleBand(styles) {
  var table = composer && composer.styles ? composer.styles() : null;
  if (!table || !styles || !styles.length) return null;
  var lo = Infinity, hi = -Infinity;
  styles.forEach(function (id) {
    var st = table.filter(function (x) { return x.id === id; })[0];
    if (!st) return;
    lo = Math.min(lo, st.bpm[0]); hi = Math.max(hi, st.bpm[1]);
  });
  return isFinite(lo) ? [lo, hi] : null;
}

// WHEN THE BAND CANNOT BE MET, PULL TOWARDS IT ANYWAY. "A platformer like
// Metroid" cannot sit at 88-118 -- the platformer styles live at 140-158 -- but
// silently discarding the band, which is what this used to do, is how naming
// Metroid came to change almost nothing. A platformer dragged 20% slower is
// still recognisably the thing that was asked for, and the summary says that is
// what happened rather than claiming the band.
function _bandPull(styles, lo, hi) {
  var band = _styleBand(styles);
  if (!band) return 0;
  var pct = Math.round(((lo + hi) / 2 / ((band[0] + band[1]) / 2) - 1) * 100);
  return Math.max(-25, Math.min(25, Math.abs(pct) < 4 ? 0 : pct));
}

// A TITLE'S CHARACTER IS SEVERAL TRAITS, AND THEY HAVE TO COMBINE WITHOUT
// PILING UP. Three recipes stacked raw would move the melody three octaves and
// the tempo by half, so the additive dials are summed and then clamped, and the
// structural ones (thin, subdivide, motion, swing, shape) are taken once each.
// `mode` is dropped throughout: the title's own major/minor already said that,
// and applying it two or three more times is how a blend turns to mud.
function _blendMoods(words, opts) {
  opts = opts || {};
  var tempo = 0, oct = {}, vel = 0, seen = {}, out = [];
  (words || []).forEach(function (w) {
    (MOODS[w] || []).forEach(function (o) {
      if (o.op === 'mode' && !opts.keepMode) return;
      if (o.op === 'mode') { var mk2 = 'mode'; if (seen[mk2]) return; seen[mk2] = 1; out.push(Object.assign({}, o)); return; }
      if (o.op === 'tempo') { tempo += (o.percent || 0); return; }
      if (o.op === 'register') { oct[o.lane] = (oct[o.lane] || 0) + (o.octaves || 0); return; }
      if (o.op === 'velocity') { vel += (o.delta || 0); return; }
      var k = o.op + ':' + (o.lane || '') + ':' + (o.motion || o.duty || '');
      if (seen[k]) return;
      seen[k] = 1; out.push(Object.assign({}, o));
    });
  });
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  if (!opts.skipTempo && tempo) out.push({ op: 'tempo', percent: clamp(Math.round(tempo), -25, 25) });
  Object.keys(oct).forEach(function (lane) {
    var n = clamp(oct[lane], -1, 1);
    if (n) out.push({ op: 'register', lane: lane, octaves: n });
  });
  if (vel) out.push({ op: 'velocity', delta: clamp(Math.round(vel * 100) / 100, -0.25, 0.25) });
  return out;
}

function _bandIsReachable(styles, lo, hi) {
  var table = composer && composer.styles ? composer.styles() : null;
  if (!table || !styles || !styles.length) return true;   // nothing to check against
  return styles.some(function (id) {
    var st = table.filter(function (x) { return x.id === id; })[0];
    return !st || Math.max(st.bpm[0], lo) <= Math.min(st.bpm[1], hi);
  });
}

function interpret(text, opts) {
  opts = opts || {};
  var src = String(text || '');
  // punctuation intact, for the handful of patterns that need it (3/4, 6/8)
  var raw = src.toLowerCase().replace(/\s+/g, ' ').trim();
  var norm = _norm(src);

  var understood = [], notUnderstood = [], spec = {}, ops = [], moods = [];
  var sawScene = null, sawNew = false, namedTechnique = false, modeTyped = false, unsupported = [];

  // 1. TITLES FIRST, and each match is blanked out of the sentence before
  //    anything else looks at it. Without that, "Kirby's Adventure" also
  //    registers as the game genre "adventure" and "Metal Gear" as the genre
  //    "metal", and the summary contradicts itself.
  var titles = (REF && REF.scan) ? REF.scan(norm) : [];
  var title = titles.length ? titles[0].entry : null;
  var chars = norm.split('');
  titles.forEach(function (m) { for (var i = m.start; i < m.end; i++) chars[i] = ' '; });
  var t = ' ' + _digits(chars.join('').replace(/\s+/g, ' ').trim()) + ' ';
  var has = function (w) { return t.indexOf(' ' + w + ' ') >= 0; };
  // EVERY RULE THAT FIRES EATS ITS OWN WORDS. Maintaining a hand-written list
  // of function words instead ("leave", "half", "brisk") meant the ignored line
  // cried wolf about words a rule had plainly consumed, one word at a time,
  // forever. Recording the matched span is the same thing done once.
  var consumed = [];
  var eat = function (m) { if (m) consumed.push(String(m[0] || m)); return m; };
  var re = function (r) { return !!eat(t.match(new RegExp(r))); };
  var longestFirst = function (o) {
    return Object.keys(o).sort(function (a, b) { return b.length - a.length || a.localeCompare(b); });
  };

  // 2. scenes, longest phrase first so "boss fight" beats "fight"
  longestFirst(WORD_SCENES).forEach(function (w) {
    if (sawScene || !has(w)) return;
    sawScene = WORD_SCENES[w]; understood.push('scene: ' + sawScene);
  });
  if (sawScene) { spec.scene = sawScene; sawNew = true; }

  // 3. genres and forms the user named THEMSELVES. These come before the
  //    title's dials and win over them, so "a platformer like Metroid" is a
  //    platformer -- the explicit word is the one they chose.
  longestFirst(WORD_GAME_GENRES).forEach(function (w) {
    if (spec.styles || !has(w)) return;
    var gg = WORD_GAME_GENRES[w];
    Object.keys(gg).forEach(function (k) { if (spec[k] == null) spec[k] = gg[k]; });
    understood.push('game genre: ' + w); sawNew = true;
  });
  longestFirst(WORD_GENRES).forEach(function (w) {
    if (spec.styles || !has(w)) return;
    spec.styles = WORD_GENRES[w].slice();
    understood.push('genre: ' + w); sawNew = true;
  });
  longestFirst(WORD_FORMS).forEach(function (w) {
    if (!has(w)) return;
    var ff = WORD_FORMS[w];
    Object.keys(ff).forEach(function (k) { if (spec[k] == null) spec[k] = ff[k]; });
    understood.push('form: ' + w); sawNew = true;
  });
  longestFirst(WORD_TECHNIQUES).forEach(function (w) {
    if (!has(w)) return;
    ops.push(Object.assign({}, WORD_TECHNIQUES[w]));
    understood.push('technique: ' + w); namedTechnique = true;
  });

  // 4. length
  var m = eat(t.match(/(\d+(?:\.\d+)?)\s*(?:seconds|second|secs|sec|s)\b/));
  var mm = eat(t.match(/(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min)\b/));
  if (m) { spec.seconds = +m[1]; understood.push('length: ' + spec.seconds + 's'); sawNew = true; }
  else if (mm) { spec.seconds = Math.round(+mm[1] * 60); understood.push('length: ' + spec.seconds + 's'); sawNew = true; }
  else if (re('\\ba minute and a half\\b')) { spec.seconds = 90; understood.push('length: 90s'); sawNew = true; }
  else if (re('\\bhalf a minute\\b')) { spec.seconds = 30; understood.push('length: 30s'); sawNew = true; }
  else if (re('\\ba minute\\b')) { spec.seconds = 60; understood.push('length: 60s'); sawNew = true; }
  var mb = eat(t.match(/(\d+)\s*(?:bars|bar)\b/));
  if (mb) { spec.bars = +mb[1]; understood.push('length: ' + spec.bars + ' bars'); sawNew = true; }
  if (spec.seconds == null && spec.bars == null) {
    if (re('\\b(short|brief|quick one|snippet|stinger)\\b')) { spec.seconds = 20; understood.push('length: short (20s)'); sawNew = true; }
    else if (re('\\b(long|lengthy|extended|full length)\\b')) { spec.seconds = 75; understood.push('length: long (75s)'); sawNew = true; }
  }

  // 5. key and mode
  var mk = eat(t.match(/\bin ([a-g])\s?(#|sharp|flat|b)?\s*(major|minor)?\b/));
  if (mk) {
    var letter = mk[1], acc = mk[2] || '';
    spec.key = /flat|^b$/.test(acc) ? FLAT_TO_SHARP[letter] : letter.toUpperCase() + (/#|sharp/.test(acc) ? '#' : '');
    understood.push('key: ' + spec.key);
    if (mk[3]) { spec.mode = mk[3]; understood.push('mode: ' + mk[3]); }
    sawNew = true;
  }
  // TYPED, as opposed to inherited. `platformer` carries mode:'major' as a
  // genre default, and treating that as the user's own word let it block a
  // title's mode -- so "a platformer like Metroid" came out major and cheerful,
  // which is the opposite of naming Metroid. Only a mode the user actually
  // wrote, or a scene's functional requirement, outranks a reference.
  if (mk && mk[3]) modeTyped = true;
  if (!modeTyped && has('minor')) { spec.mode = 'minor'; modeTyped = true; understood.push('mode: minor'); }
  else if (!modeTyped && has('major')) { spec.mode = 'major'; modeTyped = true; understood.push('mode: major'); }

  // 6. which voices to leave out. "no drums" is the single most common
  //    constraint anybody asks a music generator for -- room for dialogue and
  //    sound effects -- so it takes the filler words people actually type.
  var LANES = ['Melody', 'Harmony', 'Bass', 'Drums'];
  var exclude = function (lane, why) {
    if ((spec.exclude || []).indexOf(lane) >= 0) return;
    (spec.exclude = spec.exclude || []).push(lane);
    ops.push({ op: 'drop', lane: lane });
    understood.push(why);
  };
  Object.keys(LANE_WORDS).forEach(function (w) {
    if (re('\\b(no|without|remove|drop|mute|lose|minus|skip|leave out|leaving out|less)\\s+(the\\s+|any\\s+|its\\s+|all\\s+)?' + w + '\\b'))
      exclude(LANE_WORDS[w], 'without ' + LANE_WORDS[w]);
  });
  // "just bass and drums", "melody only" -- name what stays, drop the rest.
  var words = t.trim().split(' ');
  words.forEach(function (w, i) {
    if (!/^(only|just|nothing but|solely)$/.test(w)) return;
    var near = words.slice(Math.max(0, i - 3), i + 5);
    var keep = [];
    near.forEach(function (n) { if (LANE_WORDS[n] && keep.indexOf(LANE_WORDS[n]) < 0) keep.push(LANE_WORDS[n]); });
    if (!keep.length || keep.length === LANES.length) return;
    LANES.forEach(function (l) { if (keep.indexOf(l) < 0) exclude(l, 'without ' + l); });
    understood.push(keep.join(' and ') + ' only');
  });

  // 7. tempo
  var bpm = eat(t.match(/(\d{2,3})\s*bpm\b/));
  if (bpm) { ops.push({ op: 'tempo', absolute: +bpm[1] }); understood.push('tempo: ' + bpm[1] + ' bpm'); }
  else if (re('\\b(breakneck|blistering|frantic pace)\\b')) { ops.push({ op: 'tempo', percent: 30 }); understood.push('much faster'); }
  else if (re('\\b(much|way|a lot|far) (faster|quicker)\\b')) { ops.push({ op: 'tempo', percent: 25 }); understood.push('much faster'); }
  else if (re('\\b(a (bit|little|touch)|slightly) (faster|quicker)\\b')) { ops.push({ op: 'tempo', percent: 6 }); understood.push('a bit faster'); }
  else if (re('\\b(faster|quicker|speed it up|fast|brisk|upbeat tempo|snappy)\\b')) { ops.push({ op: 'tempo', percent: 15 }); understood.push('faster'); }
  else if (re('\\b(much|way|a lot|far) slower\\b')) { ops.push({ op: 'tempo', percent: -25 }); understood.push('much slower'); }
  else if (re('\\b(a (bit|little|touch)|slightly) slower\\b')) { ops.push({ op: 'tempo', percent: -6 }); understood.push('a bit slower'); }
  else if (re('\\b(slower|slow it down|slow|sluggish|plodding|laid back|dragging)\\b')) { ops.push({ op: 'tempo', percent: -15 }); understood.push('slower'); }
  if (has('half time') || has('halftime')) { ops.push({ op: 'tempo', multiply: 0.5 }); understood.push('half time'); }
  if (has('double time')) { ops.push({ op: 'tempo', multiply: 2 }); understood.push('double time'); }

  // 8. register
  if (re('\\b(higher|up an octave|an octave up|octave up)\\b')) { ops.push({ op: 'register', lane: 'Melody', octaves: 1 }); understood.push('melody an octave up'); }
  if (re('\\b(lower|down an octave|an octave down|octave down)\\b')) { ops.push({ op: 'register', lane: 'Melody', octaves: -1 }); understood.push('melody an octave down'); }

  // 9. structure
  if (re('\\b(repeat|say it again|again|twice as long)\\b')) { ops.push({ op: 'repeat', times: 1 }); understood.push('repeat it'); }
  if (has('swing')) { ops.push({ op: 'swing', on: !re('\\b(no|without|straight)\\s+swing\\b') }); understood.push('swing'); }
  if (re('\\b(resolve|resolved|resolves|end on the tonic|ends on the tonic|clean ending|proper ending)\\b')) {
    spec.resolve = true; ops.push({ op: 'resolve' }); understood.push('ends on the tonic'); sawNew = true;
  }
  // Every song is trimmed to a whole number of bars, which is the thing that
  // makes the join work. That is the claim, and verify-language checks it.
  if (re('\\b(loop|loops|looping|loopable|seamless|seamlessly)\\b')) {
    spec.loop = true; understood.push('loops (a whole number of bars, so it joins to itself)');
  }

  // 10. moods, last so an explicit tempo word wins its own slot
  // ALL OF THEM, NOT JUST THE FIRST. "gloomy and exploratory" is two traits and
  // taking one silently discarded the other -- the same bug the title character
  // had. They are blended below rather than concatenated, so three recipes
  // cannot stack into three octaves and half the tempo.
  longestFirst(WORD_MOODS).forEach(function (w) {
    if (!has(w) || moods.length >= 3) return;
    var m2 = WORD_MOODS[w];
    if (moods.indexOf(m2) >= 0) return;
    moods.push(m2); understood.push('mood: ' + m2);
  });

  // 11. and NOW the title fills whatever nobody named. Gap-fill is what keeps
  //     a reference a suggestion rather than an override.
  if (title) {
    var took = [];
    if (!spec.styles) { spec.styles = title.styles.slice(); took.push(title.styles.join('/')); }

    // A TITLE'S MODE IS A TRANSFORM, NOT A CONSTRAINT, and that is not a
    // stylistic choice -- it is what the composer's style table permits. Ten of
    // its fourteen styles are major-only (`modes:'maj'`), so asking for `rock`
    // AND `minor` empties the eligible pool, and brief()'s fallback then throws
    // the STYLES away and keeps the mode. Forty-eight of the titles here were
    // silently losing their genre that way while the summary still named it.
    //
    // A NAMED SCENE KEEPS ITS OWN MODE: a scene is a functional requirement --
    // a game-over cue must not come out jaunty -- while a title is an
    // atmosphere hint. A mode the user TYPED beats both.
    if (!modeTyped && !spec.scene && spec.mode !== title.mode) {
      ops.push({ op: 'mode', to: title.mode });
      took.push(title.mode);
    }

    // TEMPO: the band when the styles in force can reach it, and a pull towards
    // it when they cannot. Dropping it outright was the bug -- it meant naming
    // a slow, brooding game next to a fast genre changed nothing at all.
    var tempoHandled = false;
    if (title.bpmMin && spec.bpmMin == null) {
      if (_bandIsReachable(spec.styles, title.bpmMin, title.bpmMax)) {
        spec.bpmMin = title.bpmMin; spec.bpmMax = title.bpmMax;
        took.push(title.bpmMin + '-' + title.bpmMax + ' bpm');
        tempoHandled = true;
      } else {
        var pull = _bandPull(spec.styles, title.bpmMin, title.bpmMax);
        if (pull) {
          ops.push({ op: 'tempo', percent: pull });
          took.push(Math.abs(pull) + '% ' + (pull < 0 ? 'slower' : 'faster') +
                    ', towards its ' + title.bpmMin + '-' + title.bpmMax + ' bpm');
          tempoHandled = true;
        }
      }
    }

    // CHARACTER, AND IT APPLIES WHETHER OR NOT A GENRE WAS NAMED. This is the
    // whole point of the table. "A platformer like Metroid" is not just a
    // platformer: Metroid is gloomy, sparse and unhurried, and if naming it
    // only survives when nothing else is said then it may as well not be there.
    // Genre says what the piece is FOR, character says what it FEELS like, and
    // the two are orthogonal. A mood the user typed themselves still wins,
    // because that is a more specific request than a reference.
    if (!moods.length && title.character && title.character.length) {
      _blendMoods(title.character, { skipTempo: tempoHandled }).forEach(function (o) { ops.push(o); });
      took.push(title.character.join(', '));
    }
    if (!namedTechnique && title.tech && WORD_TECHNIQUES[title.tech]) {
      ops.push(Object.assign({}, WORD_TECHNIQUES[title.tech])); took.push(title.tech);
    }
    // The wording is deliberate and load-bearing. READ AS, not "sounds like":
    // the mapping is a genre description somebody wrote down, and the composer
    // writes its own music to it. And USED FOR lists only what the title
    // actually set -- when the user named "a platformer like Metroid" the genre
    // is theirs, and a summary saying "read as: metroidvania" would be
    // describing a dial that lost.
    understood.unshift('like ' + title.name + ' (' + title.genre + '), used for: ' +
                       (took.length ? took.join(', ') : 'nothing, you named it all yourself'));
    sawNew = true;
  }

  // is this a new piece or a change to one?
  var changeish = re('\\b(make it|more|less|instead|now|turn it|but)\\b') || (ops.length > 0 && !sawNew);
  var kind = (sawNew || (!opts.hasSong && !ops.length && !moods.length)) ? 'brief'
           : (changeish || moods.length || ops.length) ? 'change' : 'brief';

  // a mood on a NEW piece steers the composer; on a change it is a recipe
  if (kind === 'brief' && moods.length) {
    var toMode = { sadder: 'minor', darker: 'minor', happier: 'major', brighter: 'major' }[moods[0]];
    if (toMode && !spec.mode) { spec.mode = toMode; understood.push('mode: ' + toMode); }
  }

  // THINGS THIS MACHINE CANNOT DO, said out loud. Dropping them silently and
  // composing something adjacent is the failure mode: the user reads a
  // confident summary and assumes the part they cared about landed.
  if (/\b(waltz|3\s*\/\s*4|three four|6\s*\/\s*8|six eight|5\s*\/\s*4|7\s*\/\s*8|odd meter|odd time|polyrhythm)\b/.test(raw))
    unsupported.push({ asked: 'a different time signature', why: 'everything here is in four; the composer has no meter dial' });
  if (/\b(vocals?|singing|sung|lyrics|a voice|choir|acapella|a cappella)\b/.test(raw))
    unsupported.push({ asked: 'vocals', why: 'the Game Boy has two pulses, a wave and a noise channel, and none of them sings' });
  if (/\b(guitar|piano|violin|orchestra|orchestral|strings|brass|saxophone|trumpet|flute|cello|accordion|real drums)\b/.test(raw))
    unsupported.push({ asked: 'a real instrument', why: 'every sound is one of the four chip voices; there are no samples of real instruments' });
  if (/\b(dorian|phrygian|lydian|mixolydian|locrian|pentatonic|chromatic scale|whole tone)\b/.test(raw))
    unsupported.push({ asked: 'a mode other than major or minor', why: 'the composer picks a key and a major or minor scale; there is no modal dial' });
  if (/\b(stereo|panning|reverb|delay effect|chorus effect|sidechain)\b/.test(raw))
    unsupported.push({ asked: 'studio effects', why: 'the DMG mixes four voices and has no reverb, delay or panning automation to give you' });

  // A REFERENCE THIS TABLE DOES NOT KNOW is refused rather than ignored. There
  // is no model here: a name is matched against a published list, and a name
  // that is not on it maps to nothing at all. Composing something anyway and
  // letting the phrasing imply it worked is the dishonest option.
  var refm = raw.match(/\b(?:like|similar to|in the style of|sounds? like|reminiscent of|inspired by|vibes? of)\s+([a-z0-9'’#&. -]{2,40})/);
  var refName = refm ? refm[1].trim().replace(/[.,!?;:]+$/, '') : null;
  var reference = title ? { name: title.name, genre: title.genre, reads: title.reads, known: true }
                : refName ? { name: refName, known: false } : null;
  if (reference && !reference.known)
    unsupported.push({ asked: '"like ' + refName + '"',
                       why: 'I do not know that one. I match names against a published list of about a hundred games and read each as a genre, rather than imitating anything; nothing here is derived from anybody’s music. Ask for the genre instead, or name a game the list knows: Castlevania, Metroid, Tetris, Mega Man, Final Fantasy (the full list is capabilities().titles)' });

  // anything left that was clearly ignored. Scanned over the BLANKED sentence,
  // so a title's own words can never be reported as ignored.
  var claimed = understood.join(' ').toLowerCase();
  t.trim().split(' ').filter(Boolean).forEach(function (w) {
    if (w.length < 4 || /^\d+$/.test(w)) return;
    if (claimed.indexOf(w) >= 0 || consumed.join(' ').indexOf(w) >= 0) return;
    // words that ARE consumed, just not echoed verbatim. Crying wolf about
    // these would make the "ignored" line useless, which is worse than nothing.
    if (/^(make|makes|made|write|writes|compose|generate|create|need|want|give|gimme|please|should|could|would|maybe|really|very|much|more|less|just|only|even|still|again|now|then|also|about|which|with|from|into|onto|this|that|these|those|there|here|thing|something|anything|some|like|similar|style|sounds?|sounding|feel|feels|feeling|vibe|vibes|kind|sort|track|song|music|musical|piece|tune|theme|melody|loop|background|video|stream|game|games|level|stage|screen|scene|player|second|seconds|secs|minute|minutes|mins|bars|bar|tempo|beat|beats|type|good|great|nice|cool|little|thats|dont|cant|wont|isnt)$/.test(w)) return;
    if (WORD_MOODS[w] || LANE_WORDS[w] || WORD_SCENES[w]) return;
    if (WORD_GENRES[w] || WORD_GAME_GENRES[w] || WORD_FORMS[w] || WORD_TECHNIQUES[w]) return;
    if (/^(short|brief|long|full|lengthy|extended|fast|faster|slow|slower|quick|quicker|quickly|brisk|snappy|sluggish|plodding|dragging|blistering|breakneck|higher|lower|octave|swing|swung|repeat|resolve|resolved|resolves|tonic|seamless|seamlessly|loopable|looping|major|minor|sharp|flat|natural)$/.test(w)) return;
    if (unsupported.length) return;   // already explained, in better words
    if (notUnderstood.indexOf(w) < 0) notUnderstood.push(w);
  });

  return { kind: kind, spec: spec, ops: ops, moods: moods,
           understood: understood, notUnderstood: notUnderstood,
           reference: reference, unsupported: unsupported };
}

// Interpret and carry out, in one call. Returns the new document plus exactly
// what it did, so a caller can show its working instead of being a black box.
function ask(text, opts) {
  opts = opts || {};
  var read = interpret(text, { hasSong: !!opts.doc });
  if (!read.understood.length) {
    // A REFUSAL IS AN ANSWER. "like radiohead" understands nothing, and
    // returning the generic shrug threw away the one sentence that explains
    // why -- the user reads "I did not recognise anything" and assumes a
    // parser bug rather than a deliberate limit.
    var no = read.unsupported && read.unsupported.length ? read.unsupported[0] : null;
    return Object.assign({ ok: false,
      error: no ? ('I cannot do ' + no.asked + ': ' + no.why + '.')
                : 'I did not recognise anything in that. Try a scene (boss, title, cave), a length (30 seconds), a key (in D minor), a genre, a game from capabilities().titles, or a change (faster, sadder, no drums).' }, read);
  }
  // how much of what was asked for actually landed
  var words = String(text || '').split(/[^A-Za-z0-9#]+/).filter(function (w) { return w.length > 2; }).length;
  var doc = opts.doc || null, applied = [], skipped = [], made = null;
  if (read.kind === 'brief' || !doc) {
    made = brief(Object.assign({}, read.spec, opts.brief || {}));
    doc = made.doc;
    // Everything the brief itself decided. The narrower list this used to
    // carry (scene/length/key/mode/without) silently dropped the genre, the
    // form and the title reading -- exactly the parts a user most wants
    // confirmed, since those are the ones they cannot verify by ear in a
    // second. Ops report themselves separately, below, so nothing doubles up.
    applied = applied.concat(read.understood.filter(function (u) {
      return /^(like |scene|game genre|genre|form|mood|length|key|mode|without|loops|ends on|technique|[A-Z][a-z]+ (and|only))/.test(u);
    }));
    if (made.unmet && made.unmet.length) skipped = skipped.concat(made.unmet);
  }
  // Lanes the BRIEF already left out must not be dropped a second time by a
  // transform: brief() honours spec.exclude itself, so the op finds nothing and
  // the summary reads "dropped Drums (0 notes)" under a line that already said
  // "without Drums".
  var already = (made && read.spec.exclude) ? [].concat(read.spec.exclude) : [];
  var ops = read.ops.filter(function (o) { return !(o.op === 'drop' && already.indexOf(o.lane) >= 0); });
  // Blended, for the same reason a title's character is: concatenating three
  // recipes adds their tempo changes and their octave shifts together.
  // A TEMPO THE SENTENCE ALREADY ASKED FOR WINS. "a cheerful fast platformer"
  // has both an explicit "fast" and `happier`'s own +8%, and compounding them
  // ran the song to 180 bpm -- neither word asked for that.
  ops = ops.concat(_blendMoods(read.moods, {
    keepMode: true,
    skipTempo: ops.some(function (o) { return o.op === 'tempo'; })
  }));
  if (ops.length) {
    var r = transform(doc, ops);
    doc = r.doc; applied = applied.concat(r.applied); skipped = skipped.concat(r.skipped);
  }
  return Object.assign({ ok: true, doc: doc, applied: applied, skipped: skipped,
                         askedWords: words }, describe(doc), read);
}

// -------------------------------------------------------------------- layers
//
// VERTICAL REMIXING, the way game audio middleware wants it: the same cue at
// several intensities, so a game fades a layer in as the action rises. The
// layers ARE the four voices, so this costs nothing but naming them -- every
// layer is the same song with lanes removed, which means they are in time with
// each other by construction rather than by careful mixing.
// EIGHT STEPS OUT OF FOUR VOICES. Lane presence alone gives you four, which is
// too coarse to fade an action scene up. DENSITY is the other axis: each voice
// can arrive thinned before it arrives whole, and the bass can double at the
// top. That is why `thin`, `double` and `subdivide` had to exist first.
var LAYER_SETS = [
  { name: 'ambient',  keep: ['Bass'],                              thin: ['Bass'],    use: 'barely there: a held low line' },
  { name: 'pulse',    keep: ['Bass'],                              thin: [],          use: 'a heartbeat under dialogue' },
  { name: 'groove',   keep: ['Bass', 'Drums'],                     thin: ['Drums'],   use: 'walking around' },
  { name: 'drive',    keep: ['Bass', 'Drums'],                     thin: [],          use: 'moving with purpose' },
  { name: 'colour',   keep: ['Bass', 'Drums', 'Harmony'],          thin: ['Harmony'], use: 'something is coming' },
  { name: 'rise',     keep: ['Bass', 'Drums', 'Harmony'],          thin: [],          use: 'tension' },
  { name: 'lead',     keep: ['Bass', 'Drums', 'Harmony', 'Melody'],thin: ['Melody'],  use: 'engaged' },
  { name: 'full',     keep: ['Bass', 'Drums', 'Harmony', 'Melody'],thin: [], double: 'Bass', use: 'full intensity' }
];
function layers(doc) {
  var base = typeof doc === 'string' ? doc : fromJSON(doc);
  var prev = -1;
  return LAYER_SETS.map(function (set) {
    var ops = LANES.filter(function (l) { return set.keep.indexOf(l) < 0; })
                   .map(function (l) { return { op: 'drop', lane: l }; });
    (set.thin || []).forEach(function (l) { ops.push({ op: 'thin', lane: l }); });
    if (set.double) ops.push({ op: 'double', lane: set.double });
    var d = ops.length ? transform(base, ops).doc : base;
    var info = describe(d);
    // A LAYER THAT ADDS NOTHING HAS TO SAY SO. Not every song uses every voice
    // -- plenty have no Harmony at all -- and handing back two identical layers
    // as if they were an intensity step is a quiet lie. Say it instead.
    var adds = prev < 0 ? info.notes : info.notes - prev;
    prev = info.notes;
    var out = Object.assign({ layer: set.name, lanes: set.keep, use: set.use, doc: d, addsNotes: adds }, info);
    if (adds === 0) out.note = 'identical to the layer below: this song has nothing on ' +
      LANES.filter(function (l) { return set.keep.indexOf(l) >= 0 && info.perLane[l] === 0; }).join(', ');
    return out;
  });
}

// ---------------------------------------------------------------------- MIDI
//
// The export that takes this out of the Game Boy and into anybody's tools. It
// is only possible because the music is SYMBOLIC -- an audio model has nothing
// to hand you here. One track per hardware voice, so the MIDI carries the stems
// too, and drums go to channel 10 with General MIDI numbers so they land on a
// drum kit rather than as pitched noise.
var GM_DRUM = { hat: 42, snare: 38, kick: 36 };

function vlq(n) {                                   // MIDI variable-length quantity
  var bytes = [n & 0x7F];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7F) | 0x80); n >>= 7; }
  return bytes;
}
function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function be16(n) { return [(n >>> 8) & 255, n & 255]; }
function midiTrack(events, ppq) {
  // events: {tick, bytes}. Sorted, then delta-encoded.
  events.sort(function (a, b) { return a.tick - b.tick || (a.off ? -1 : 1); });
  var out = [], last = 0;
  events.forEach(function (e) {
    out = out.concat(vlq(Math.max(0, e.tick - last)), e.bytes);
    last = e.tick;
  });
  out = out.concat(vlq(0), [0xFF, 0x2F, 0x00]);     // end of track
  return [].concat([0x4D, 0x54, 0x72, 0x6B], be32(out.length), out);
}

// Returns a Node Buffer where there is one and a Uint8Array in the browser, so
// the page can put it straight into a Blob. Same bytes either way.
function toMidi(doc, opts) {
  opts = opts || {};
  var song = CT_CREATE.songOf(typeof doc === 'string' ? doc : fromJSON(doc));
  if (!song) throw new Error('toMidi: not a playable song');
  var ppq = opts.ppq || 480, fps = HW.FPS || 59.7275, bpm = song.bpm || 128;
  var ticksPerFrame = (ppq * bpm) / (60 * fps);
  var tick = function (f) { return Math.max(0, Math.round(f * ticksPerFrame)); };

  // track 0: tempo and name only, which is what format 1 expects
  var meta = [];
  var us = Math.round(60000000 / bpm);
  meta.push({ tick: 0, bytes: [0xFF, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  var name = String(song.title || 'Chiptunes').slice(0, 60);
  meta.push({ tick: 0, bytes: [0xFF, 0x03, name.length].concat(name.split('').map(function (c) { return c.charCodeAt(0) & 127; })) });

  var tracks = [midiTrack(meta, ppq)];
  LANES.forEach(function (laneName, ch) {
    var evs = [], chan = ch === 3 ? 9 : ch;         // MIDI channel 10 is drums
    evs.push({ tick: 0, bytes: [0xFF, 0x03, laneName.length].concat(laneName.split('').map(function (c) { return c.charCodeAt(0); })) });
    (song.gb.notes || []).forEach(function (n) {
      if ((n.ch | 0) !== ch) return;
      var note = ch === 3 ? (GM_DRUM[['hat', 'snare', 'kick'][Math.min(2, Math.max(0, (n.pri | 0) === 9 ? 2 : (n.pri | 0) === 7 ? 1 : 0))]] || 38)
                          : (n.midi == null ? null : (n.midi | 0));
      if (note == null) return;
      var v = Math.max(1, Math.min(127, Math.round((n.vel == null ? 0.8 : n.vel) * 127)));
      var on = tick(n.frame), off = Math.max(on + 1, tick(n.frame + Math.max(1, n.frames || 1)));
      evs.push({ tick: on, bytes: [0x90 | chan, note & 127, v] });
      evs.push({ tick: off, bytes: [0x80 | chan, note & 127, 0], off: true });
    });
    // a kit hit is a drum too, and it lives outside gb.notes
    if (ch === 3) (song.gb.kit || []).forEach(function (k) {
      var note = GM_DRUM[k.id] || GM_DRUM[['hat', 'snare', 'kick'][k.slot | 0]] || 38;
      var on = tick(k.f == null ? k.frame : k.f);
      evs.push({ tick: on, bytes: [0x90 | chan, note & 127, 100] });
      evs.push({ tick: on + Math.round(ppq / 8), bytes: [0x80 | chan, note & 127, 0], off: true });
    });
    tracks.push(midiTrack(evs, ppq));
  });

  var head = [].concat([0x4D, 0x54, 0x68, 0x64], be32(6), be16(1), be16(tracks.length), be16(ppq));
  var all = head;
  tracks.forEach(function (t) { all = all.concat(t); });
  return HAS_BUFFER ? Buffer.from(all) : new Uint8Array(all);
}

// --------------------------------------------------------------- variations
//
// N DISTINCT SONGS, RANKED BY NOBODY. AGENTS.md keeps best-of-N out of
// production composition: the product must not write several songs and score
// them. This does not score, sort or select -- it composes n from n different
// tokens and hands all of them back with their descriptions, which is the same
// act as pressing "next" n times. The choosing is the caller's, and that has
// always been allowed. Do not add a `best` argument to this.
function variations(spec, n) {
  n = Math.max(1, Math.min(50, n || 5));
  var out = [];
  for (var i = 0; i < n; i++) {
    var made = brief(Object.assign({}, spec || {}, { token: Song.mint() }));
    out.push(made);
  }
  return { asked: spec || {}, count: out.length, candidates: out,
           note: 'Unranked and unselected, in the order composed. Choosing is yours.' };
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
    formats: ['wav (16-bit stereo, optional loop metadata)', 'stems (four wavs)', 'midi (format 1, one track per voice, drums on channel 10)', 'gb (32 KB cartridge, boots on hardware)', 'song document (a string)', 'share link (the document rides in the URL fragment)'],
    choosing: 'variations(spec, n) composes n songs from n tokens and returns them all, unranked. Nothing here scores or selects for you; that is deliberate and it is your choice to make.',
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
  ask: ask,
  toMidi: toMidi,
  variations: variations,
  layers: layers
};

// In the browser this file is concatenated as a plain script, so the same
// surface has to be reachable as a global. Named CT_API to sit beside
// CT_CREATE and CT_GB_*; window.chiptunes (webmcp.js) is the agent-facing name.

  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  try { _G.CT_API = EXPORTS; } catch (e) {}
})(typeof globalThis !== 'undefined' ? globalThis : window);
