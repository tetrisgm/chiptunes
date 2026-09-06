// THE EDITABLE AUTHORITY FOR AN IMPORTED NATIVE LSDj SONG (STRUCTURE ONLY).
//
// `readSong` (src/lsdj.js) reads a 0x8000 song image into raw byte arrays that
// mirror the file exactly, and `writeSong` inverts it, so a native round trip
// is byte-identical. This module wraps that model as the single source of truth
// and lets callers edit ACTUAL native slots/rows while EXPORT rewrites only the
// regions that were edited and copies every untouched byte verbatim. That is
// the lossless edit/export boundary.
//
// WHAT THIS IS NOT: a player. It runs no audio engine and makes NO claim that
// any note, instrument, command, table or format version sounds correct.
// `playbackStatus()` says so unconditionally. Structural edit support is a
// different question from playback and is the only thing claimed here.
//
// Full (nd1) shares use a separate, strictly bounded canonical validator rather
// than the foreign-file decoder (which permits noncanonical acyclic layouts).
// The validator below enforces forward
// in-bounds jumps, complete operands, exact 32768-byte output with no padding
// fill, and canonical form via recompression equality. Sizes are bounded before
// base64 or JSON is touched, and base64 must be canonical (round-trip equal).
// serialize() always emits a share this module's own deserializer will accept,
// falling back from the compact diff to the standalone full image when a diff
// would exceed the size bound (or when the full image is simply smaller).
(function (G) {
  'use strict';
  var _req = (typeof require === 'function') ? require : null;
  var LSDJ = _req ? _req('./lsdj.js') : G.CT_LSDJ;
  if (!LSDJ) throw new Error('lsdj-native-document: lsdj.js must load first');

  var SONG_BYTES = 0x8000, VERSION = 'nd1';
  var DEFAULT_HISTORY = 256, MAX_TITLE = 64, MAX_RUNS = 16384;
  var BLOCK = 512, MAX_BLOCKS = 191;
  var MAX_B64_CHARS = Math.ceil(MAX_BLOCKS * BLOCK / 3) * 4;   // largest canonical stream
  var MAX_SHARE_CHARS = 262144;                               // reject hostile huge JSON early
  var RLE = 0xC0, SA = 0xE0, DEF_WAVE = 0xF0, DEF_INST = 0xF1, EOF = 0xFF;
  // From liblsdj (MIT); canonical-share validation expands these runs separately
  // from the more permissive layout rules of the foreign-file decoder.
  var DEFAULT_WAVE = Object.freeze([0x8E, 0xCD, 0xCC, 0xBB, 0xAA, 0xA9, 0x99, 0x88,
                                    0x87, 0x76, 0x66, 0x55, 0x54, 0x43, 0x32, 0x31]);
  var DEFAULT_INSTRUMENT = Object.freeze([0xA8, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x03, 0x00,
                                          0x00, 0xD0, 0x00, 0x00, 0x00, 0xF3, 0x00, 0x00]);

  if (LSDJ.SONG_BYTES !== SONG_BYTES) throw new Error('lsdj-native-document: unexpected SONG_BYTES');

  // Snapshot + freeze field descriptors so external mutation of LSDJ.FIELDS
  // cannot change our addressing.
  var FIELD = Object.create(null);
  LSDJ.FIELDS.forEach(function (f) { FIELD[f.k] = Object.freeze({ k: f.k, at: f.at, n: f.n, w: f.w }); });
  Object.freeze(FIELD);

  var PRIV = new WeakMap();
  function priv(self) { var s = PRIV.get(self); if (!s) throw new Error('lsdj-native-document: not a NativeDocument'); return s; }

  function equalBytes(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function validateInt(v, lo, hi, what) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi)
      throw new RangeError('lsdj-native-document: ' + what + ' must be an integer in [' + lo + '..' + hi + '] (got ' + JSON.stringify(v) + ')');
    return v;
  }
  function validateByte(v, what) { return validateInt(v, 0, 255, what || 'byte value'); }
  function validateTitle(t) {
    if (t == null) return '';
    if (typeof t !== 'string') throw new TypeError('lsdj-native-document: title must be a string');
    if (t.length > MAX_TITLE) throw new RangeError('lsdj-native-document: title exceeds ' + MAX_TITLE + ' chars');
    return t;
  }

  // Resolve one addressable byte, validating indices against the field's shape.
  // Scalar and single-row indices are validated consistently (a scalar's row and
  // offset must both be 0), so the generic API can never silently ignore them.
  function resolveTarget(model, key, i, j) {
    var f = FIELD[key];
    if (!f) throw new RangeError('lsdj-native-document: unknown field "' + key + '"');
    if (f.n === 1 && f.w === 1) {
      validateInt(i, 0, 0, key + ' index'); validateInt(j, 0, 0, key + ' offset');
      return { get: function () { return model[key]; }, set: function (v) { model[key] = v; } };
    }
    if (f.n === 1) {
      validateInt(i, 0, 0, key + ' index'); validateInt(j, 0, f.w - 1, key + ' offset');
      var row = model[key];
      return { get: function () { return row[j]; }, set: function (v) { row[j] = v; } };
    }
    validateInt(i, 0, f.n - 1, key + ' index'); validateInt(j, 0, f.w - 1, key + ' offset');
    var row2 = model[key][i];
    return { get: function () { return row2[j]; }, set: function (v) { row2[j] = v; } };
  }

  // ---- hashing / canonical base64 ----------------------------------------
  function fnv1a(bytes) {
    var h = 0x811c9dc5, i;
    for (i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      var h1 = i + 1 < bytes.length, h2 = i + 2 < bytes.length;
      s += B64[a >> 2] + B64[((a & 3) << 4) | (h1 ? b >> 4 : 0)] +
           (h1 ? B64[((b & 15) << 2) | (h2 ? c >> 6 : 0)] : '=') + (h2 ? B64[c & 63] : '=');
    }
    return s;
  }
  function b64decCanonical(str, maxChars) {
    if (typeof str !== 'string') throw new Error('lsdj-native-document: base64 payload is not a string');
    if (str.length === 0 || str.length % 4 !== 0) throw new Error('lsdj-native-document: base64 payload is truncated');
    if (str.length > maxChars) throw new Error('lsdj-native-document: base64 payload exceeds the size limit');
    var out = [], i;
    for (i = 0; i < str.length; i += 4) {
      var s2 = str[i + 2], s3 = str[i + 3];
      var c0 = B64.indexOf(str[i]), c1 = B64.indexOf(str[i + 1]);
      var c2 = s2 === '=' ? 0 : B64.indexOf(s2), c3 = s3 === '=' ? 0 : B64.indexOf(s3);
      if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error('lsdj-native-document: base64 has invalid characters');
      if ((s2 === '=' || s3 === '=') && i + 4 < str.length) throw new Error('lsdj-native-document: base64 padding is misplaced');
      if (s2 === '=' && s3 !== '=') throw new Error('lsdj-native-document: base64 padding is misplaced');
      var n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
      out.push((n >> 16) & 0xFF);
      if (s2 !== '=') out.push((n >> 8) & 0xFF);
      if (s3 !== '=') out.push(n & 0xFF);
    }
    var bytes = Uint8Array.from(out);
    if (b64enc(bytes) !== str) throw new Error('lsdj-native-document: base64 is not canonical (unused padding bits set)');
    return bytes;
  }

  // ---- strict, bounded compressed-stream decoder -------------------------
  // Canonical LSDJ.compress(song, 1) output only: 512-byte blocks, forward
  // sequential (+1) block jumps, complete operands, exactly 32768 output bytes.
  // Terminates on any deviation; never loops (i and block index only advance).
  function strictDecodeSong(bytes) {
    var len = bytes.length;
    if (len < BLOCK || len % BLOCK !== 0 || len > MAX_BLOCKS * BLOCK)
      throw new Error('lsdj-native-document: compressed payload is not a whole number of canonical blocks');
    var out = new Uint8Array(SONG_BYTES), n = 0, i = 0, done = false;
    var guard = 0, guardMax = len + SONG_BYTES + 16;
    function need(k) { if (i + k > len) throw new Error('lsdj-native-document: truncated compressed operand'); }
    function put(v) { if (n >= SONG_BYTES) throw new Error('lsdj-native-document: compressed payload overflows a song'); out[n++] = v; }
    while (!done) {
      if (++guard > guardMax) throw new Error('lsdj-native-document: compressed stream did not terminate');
      if (i >= len) throw new Error('lsdj-native-document: compressed stream ended without EOF');
      var b = bytes[i++];
      if (b === RLE) {
        need(1); var v = bytes[i++];
        if (v === RLE) put(RLE);
        else { need(1); var cnt = bytes[i++]; for (var r = 0; r < cnt; r++) put(v); }
      } else if (b === SA) {
        need(1); var a = bytes[i++];
        if (a === SA) put(SA);
        else if (a === DEF_WAVE) { need(1); var wc = bytes[i++]; for (var p = 0; p < wc; p++) for (var kw = 0; kw < 16; kw++) put(DEFAULT_WAVE[kw]); }
        else if (a === DEF_INST) { need(1); var ic = bytes[i++]; for (var q = 0; q < ic; q++) for (var ki = 0; ki < 16; ki++) put(DEFAULT_INSTRUMENT[ki]); }
        else if (a === EOF) { done = true; }
        else {
          var curBlock = Math.floor((i - 2) / BLOCK) + 1;      // 1-based, base 1
          if (a !== curBlock + 1) throw new Error('lsdj-native-document: non-forward or non-sequential block jump');
          var target = (a - 1) * BLOCK;
          if (target >= len) throw new Error('lsdj-native-document: block jump out of bounds');
          i = target;
        }
      } else put(b);
    }
    if (n !== SONG_BYTES) throw new Error('lsdj-native-document: compressed payload did not fill exactly one song');
    // Canonical form: the stream must be exactly what compress() emits for this
    // song. This rejects trailing/padding tampering and any non-canonical encoding.
    var re = LSDJ.compress(out, 1);
    if (!equalBytes(re, bytes)) throw new Error('lsdj-native-document: full share is not the canonical compression of its song');
    return out;
  }

  // ---- construction ------------------------------------------------------
  function NativeDocument(base, meta) {
    if (!(this instanceof NativeDocument)) throw new Error('lsdj-native-document: use NativeDocument.fromSong');
    if (!(base instanceof Uint8Array)) throw new TypeError('lsdj-native-document: fromSong expects a Uint8Array song image');
    if (base.length !== SONG_BYTES) throw new RangeError('lsdj-native-document: fromSong expects exactly ' + SONG_BYTES + ' bytes; parse .sav/.lsdsng upstream');
    var title = validateTitle(meta && meta.title);
    var limit = (meta && meta.historyLimit != null) ? validateInt(meta.historyLimit, 1, 1 << 20, 'historyLimit') : DEFAULT_HISTORY;
    var img = Uint8Array.from(base);
    PRIV.set(this, { base: img, model: LSDJ.readSong(img), touched: Object.create(null), undo: [], redo: [], historyLimit: limit, title: title });
    Object.freeze(this);
  }
  NativeDocument.fromSong = function (bytes, meta) { return new NativeDocument(bytes, meta); };
  var P = NativeDocument.prototype;

  P.title = function () { return priv(this).title; };

  // ---- copying readers ---------------------------------------------------
  P.field = function (key) {
    var s = priv(this), f = FIELD[key];
    if (!f) throw new RangeError('lsdj-native-document: unknown field "' + key + '"');
    if (f.n === 1 && f.w === 1) return s.model[key];
    if (f.n === 1) return Uint8Array.from(s.model[key]);
    return s.model[key].map(function (r) { return Uint8Array.from(r); });
  };
  P.fieldRow = function (key, i) {
    var s = priv(this), f = FIELD[key];
    if (!f) throw new RangeError('lsdj-native-document: unknown field "' + key + '"');
    if (f.n === 1) throw new RangeError('lsdj-native-document: "' + key + '" is not indexed by row');
    validateInt(i, 0, f.n - 1, key + ' index');
    return Uint8Array.from(s.model[key][i]);
  };
  P.phrase = function (p) {
    return { notes: this.fieldRow('phraseNotes', p), instruments: this.fieldRow('phraseInstruments', p),
             commands: this.fieldRow('phraseCommands', p), values: this.fieldRow('phraseCommandVals', p) };
  };
  P.chain = function (c) { return { phrases: this.fieldRow('chainPhrases', c), transpose: this.fieldRow('chainTranspose', c) }; };
  P.sequenceRow = function (s) { return this.fieldRow('sequence', s); };
  P.instrument = function (i) { return this.fieldRow('instrumentParams', i); };
  P.instrumentName = function (i) { return this.fieldRow('instrumentNames', i); };
  P.groove = function (g) { return this.fieldRow('grooves', g); };
  P.wave = function (w) { return this.fieldRow('waves', w); };
  P.tableTranspose = function (t) { return this.fieldRow('tables0', t); };
  P.tableCommandColumn = function (t) { return this.fieldRow('tableCommands', t); };
  P.tableValueColumn = function (t) { return this.fieldRow('tableValues', t); };
  P.tempo = function () { return this.field('tempo'); };
  P.transpose = function () { return this.field('transpose'); };
  P.formatVersion = function () { return this.field('formatVersion'); };

  // ---- private commit: atomic, validated, no duplicate targets -----------
  function commit(self, list) {
    var s = priv(self), i, seen = Object.create(null);
    var resolved = [];
    for (i = 0; i < list.length; i++) {
      var w = list[i], tag = w.key + '#' + w.i + '#' + w.j;
      if (seen[tag]) throw new Error('lsdj-native-document: a single edit may not write the same byte twice');
      seen[tag] = true;
      validateByte(w.value, (w.key || 'field') + ' value');
      resolved.push({ key: w.key, i: w.i, j: w.j, value: w.value & 0xFF, target: resolveTarget(s.model, w.key, w.i, w.j) });
    }
    var writes = [];
    for (i = 0; i < resolved.length; i++) {
      var r = resolved[i], before = r.target.get();
      if (before === r.value) continue;
      r.target.set(r.value);
      writes.push({ key: r.key, i: r.i, j: r.j, before: before, after: r.value });
      s.touched[r.key] = true;
    }
    if (writes.length) {
      s.undo.push({ writes: writes });
      if (s.undo.length > s.historyLimit) s.undo.shift();
      s.redo.length = 0;
    }
    return self;
  }

  P.setFieldByte = function (key, i, j, value) { return commit(this, [{ key: key, i: i, j: j, value: value }]); };
  P.setScalar = function (key, value) {
    var f = FIELD[key];
    if (!f || f.n !== 1 || f.w !== 1) throw new RangeError('lsdj-native-document: "' + key + '" is not a scalar field');
    return commit(this, [{ key: key, i: 0, j: 0, value: value }]);
  };
  P.setPhraseNote = function (p, r, v) { return commit(this, [{ key: 'phraseNotes', i: p, j: r, value: v }]); };
  P.setPhraseInstrument = function (p, r, v) { return commit(this, [{ key: 'phraseInstruments', i: p, j: r, value: v }]); };
  P.setPhraseCommand = function (p, r, v) { return commit(this, [{ key: 'phraseCommands', i: p, j: r, value: v }]); };
  P.setPhraseValue = function (p, r, v) { return commit(this, [{ key: 'phraseCommandVals', i: p, j: r, value: v }]); };
  P.setPhraseRow = function (p, r, o) {
    if (!o || typeof o !== 'object') throw new TypeError('lsdj-native-document: row spec must be an object');
    var list = [];
    if (o.note != null) list.push({ key: 'phraseNotes', i: p, j: r, value: o.note });
    if (o.instrument != null) list.push({ key: 'phraseInstruments', i: p, j: r, value: o.instrument });
    if (o.command != null) list.push({ key: 'phraseCommands', i: p, j: r, value: o.command });
    if (o.value != null) list.push({ key: 'phraseCommandVals', i: p, j: r, value: o.value });
    if (!list.length) throw new Error('lsdj-native-document: row spec set no fields');
    return commit(this, list);
  };
  P.setChainPhrase = function (c, r, v) { return commit(this, [{ key: 'chainPhrases', i: c, j: r, value: v }]); };
  P.setChainTranspose = function (c, r, v) { return commit(this, [{ key: 'chainTranspose', i: c, j: r, value: v }]); };
  P.setSequence = function (s, ch, chain) { return commit(this, [{ key: 'sequence', i: s, j: ch, value: chain }]); };
  P.setInstrumentByte = function (i, off, v) { return commit(this, [{ key: 'instrumentParams', i: i, j: off, value: v }]); };
  P.setInstrumentNameByte = function (i, off, v) { return commit(this, [{ key: 'instrumentNames', i: i, j: off, value: v }]); };
  P.setInstrumentAllocByte = function (off, v) { return commit(this, [{ key: 'instrumentAlloc', i: 0, j: off, value: v }]); };
  P.setTableAllocByte = function (off, v) { return commit(this, [{ key: 'tableAlloc', i: 0, j: off, value: v }]); };
  P.setPhraseAllocByte = function (off, v) { return commit(this, [{ key: 'phraseAlloc', i: 0, j: off, value: v }]); };
  P.setChainAllocByte = function (off, v) { return commit(this, [{ key: 'chainAlloc', i: 0, j: off, value: v }]); };
  P.setTableTranspose = function (t, r, v) { return commit(this, [{ key: 'tables0', i: t, j: r, value: v }]); };
  P.setTableCommand = function (t, r, v) { return commit(this, [{ key: 'tableCommands', i: t, j: r, value: v }]); };
  P.setTableValue = function (t, r, v) { return commit(this, [{ key: 'tableValues', i: t, j: r, value: v }]); };
  P.setGroove = function (g, step, v) { return commit(this, [{ key: 'grooves', i: g, j: step, value: v }]); };
  P.setWaveByte = function (w, off, v) { return commit(this, [{ key: 'waves', i: w, j: off, value: v }]); };
  P.setTempo = function (v) { return this.setScalar('tempo', v); };
  P.setTranspose = function (v) { return this.setScalar('transpose', v); };

  // ---- undo / redo -------------------------------------------------------
  function replay(s, entry, useAfter) {
    for (var k = 0; k < entry.writes.length; k++) {
      var w = entry.writes[k];
      resolveTarget(s.model, w.key, w.i, w.j).set(useAfter ? w.after : w.before);
      s.touched[w.key] = true;
    }
  }
  P.canUndo = function () { return priv(this).undo.length > 0; };
  P.canRedo = function () { return priv(this).redo.length > 0; };
  P.undoDepth = function () { return priv(this).undo.length; };
  P.redoDepth = function () { return priv(this).redo.length; };
  P.undo = function () { var s = priv(this), e = s.undo.pop(); if (!e) return false; replay(s, e, false); s.redo.push(e); return true; };
  P.redo = function () { var s = priv(this), e = s.redo.pop(); if (!e) return false; replay(s, e, true); s.undo.push(e); return true; };
  P.dirtyFields = function () { return Object.keys(priv(this).touched); };

  // ---- export ------------------------------------------------------------
  P.toSong = function () {
    var s = priv(this), out = Uint8Array.from(s.base);
    Object.keys(s.touched).forEach(function (k) {
      var f = FIELD[k], v = s.model[k], j;
      if (f.n === 1 && f.w === 1) { out[f.at] = v & 0xFF; return; }
      var rows = f.n === 1 ? [v] : v;
      for (j = 0; j < rows.length && j < f.n; j++) out.set(rows[j].subarray(0, f.w), f.at + j * f.w);
    });
    return out;
  };

  // ---- diff / share ------------------------------------------------------
  P.diff = function () {
    var s = priv(this), out = this.toSong(), runs = [], i = 0;
    while (i < SONG_BYTES) {
      if (out[i] === s.base[i]) { i++; continue; }
      var start = i, d = [];
      while (i < SONG_BYTES && out[i] !== s.base[i]) { d.push(out[i]); i++; }
      runs.push({ o: start, d: d });
    }
    return { base: fnv1a(s.base), runs: runs };
  };
  NativeDocument.applyDiff = function (baseBytes, diff) {
    if (!(baseBytes instanceof Uint8Array) || baseBytes.length !== SONG_BYTES)
      throw new Error('lsdj-native-document: base must be a 32768-byte song image');
    var out = Uint8Array.from(baseBytes);
    if (!diff || typeof diff !== 'object') throw new Error('lsdj-native-document: malformed diff');
    if (typeof diff.base !== 'string' || diff.base !== fnv1a(out))
      throw new Error('lsdj-native-document: diff base hash is missing or does not match this song');
    if (!Array.isArray(diff.runs) || diff.runs.length > MAX_RUNS) throw new Error('lsdj-native-document: diff runs are missing or excessive');
    var prevEnd = -1, total = 0, r, k, val;
    for (var ri = 0; ri < diff.runs.length; ri++) {
      r = diff.runs[ri];
      if (!r || typeof r !== 'object' || !Number.isInteger(r.o) || !Array.isArray(r.d) || r.d.length === 0)
        throw new Error('lsdj-native-document: malformed or empty diff run');
      if (ri > 0 && r.o <= prevEnd + 1) throw new Error('lsdj-native-document: diff runs must be ordered, non-overlapping and non-adjacent');
      if (ri === 0 && r.o < 0) throw new Error('lsdj-native-document: diff run out of bounds');
      if (r.o + r.d.length > SONG_BYTES) throw new Error('lsdj-native-document: diff run out of bounds');
      total += r.d.length;
      if (total > SONG_BYTES) throw new Error('lsdj-native-document: diff is larger than a song');
      for (k = 0; k < r.d.length; k++) {
        val = r.d[k];
        if (!Number.isInteger(val) || val < 0 || val > 255) throw new Error('lsdj-native-document: diff run contains a non-byte value');
        out[r.o + k] = val;
      }
      prevEnd = r.o + r.d.length - 1;
    }
    return out;
  };
  // A share the module's OWN deserializer will accept for ANY valid edit. The
  // diff form is compact but can exceed the deserializer's size bound when an
  // edit touches most of the song; and for a large edit the standalone full
  // image is often smaller anyway. So serialize() emits the diff only when it is
  // within the bound AND no larger than the full image, and otherwise falls back
  // to the full share. Both forms stay valid inputs to deserialize(); the
  // hostile-input size bound is unchanged. serializeFull() forces the full form.
  P.serialize = function () {
    var diffStr = JSON.stringify({ v: VERSION, mode: 'diff', title: this.title(), diff: this.diff() });
    var fullStr = this.serializeFull();
    var best = (diffStr.length <= MAX_SHARE_CHARS && diffStr.length <= fullStr.length) ? diffStr : fullStr;
    if (best.length > MAX_SHARE_CHARS)
      throw new Error('lsdj-native-document: share exceeds the size limit even as a full image');
    return best;
  };
  P.serializeFull = function () {
    var song = this.toSong();
    return JSON.stringify({ v: VERSION, mode: 'full', title: this.title(), hash: fnv1a(song), song: b64enc(LSDJ.compress(song, 1)) });
  };
  NativeDocument.deserialize = function (str, base) {
    if (typeof str === 'string' && str.length > MAX_SHARE_CHARS) throw new Error('lsdj-native-document: share exceeds the size limit');
    var o = (typeof str === 'string') ? JSON.parse(str) : str;
    if (!o || typeof o !== 'object') throw new Error('lsdj-native-document: malformed share');
    if (o.v !== VERSION) throw new Error('lsdj-native-document: unknown or missing share version "' + o.v + '"');
    var title = validateTitle(o.title);
    if (o.mode === 'full') {
      if (typeof o.hash !== 'string' || typeof o.song !== 'string') throw new Error('lsdj-native-document: malformed full share');
      var bytes = b64decCanonical(o.song, MAX_B64_CHARS);
      var song = strictDecodeSong(bytes);               // bounded, canonical, no legacy decoder
      if (fnv1a(song) !== o.hash) throw new Error('lsdj-native-document: full share failed its content-hash integrity check');
      return new NativeDocument(song, { title: title });
    }
    if (o.mode === 'diff') {
      if (!base) throw new Error('lsdj-native-document: a diff share needs its base song');
      return new NativeDocument(NativeDocument.applyDiff(base, o.diff), { title: title });
    }
    throw new Error('lsdj-native-document: unknown share mode "' + o.mode + '"');
  };

  // ---- factual inventory & honest playback status ------------------------
  function countNonzero(row) { var c = 0, i; for (i = 0; i < row.length; i++) if (row[i] !== 0) c++; return c; }
  P.inventory = function () {
    var s = priv(this);
    // instrumentAlloc/tableAlloc are per-slot bytes (the exporter sets the slot
    // byte to a nonzero value): count nonzero slots, do not popcount. phrase/
    // chain allocation are bitmaps whose semantics we do not reinterpret here,
    // so return their raw bytes rather than a claimed count.
    return {
      formatVersion: s.model.formatVersion, tempo: s.model.tempo,
      allocatedInstrumentSlots: countNonzero(s.model.instrumentAlloc),
      allocatedTableSlots: countNonzero(s.model.tableAlloc),
      phraseAllocRaw: Uint8Array.from(s.model.phraseAlloc),
      chainAllocRaw: Uint8Array.from(s.model.chainAlloc),
      editedFields: Object.keys(s.touched)
    };
  };
  P.playbackStatus = function () {
    return { available: false, verified: false,
      reason: 'lsdj-native-document edits native song STRUCTURE only. It runs no ' +
        'audio engine and makes no claim that any note, instrument, command, ' +
        'table or format version plays correctly. Playback fidelity is ' +
        'established by the audio and verification layers, not here.' };
  };

  var API = { NativeDocument: NativeDocument, VERSION: VERSION, fnv1a: fnv1a };
  G.CT_LSDJ_DOC = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
