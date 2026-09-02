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

var API_VERSION = 1;

var Song = require('./seed.js');
var composer = require('./composer.js');
var CT_CREATE = require('./create.js');
var GB_ROM = require('./gb-rom.js');
var GB_APU = require('./gb-apu.js');
var HW = require('./gb-hardware.js');

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

module.exports = {
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
  midiOf: midiOf
};
