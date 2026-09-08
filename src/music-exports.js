/* Compiled revision export boundary; no compiler or native-import conversion.
 * Input: {id: nonempty string, validated: true, compiled: {gb, settings}}.
 * settings are compilation metadata: timing/master register writes MUST already
 * be in gb. No transport rate, mixer or audition state is applied here.
 * MIDI is a note sketch: fixed 62500 us/quarter, 16384 PPQN, 4389 ticks/frame
 * gives EXACT 70224/4194304 second frame times, including compiled tempo maps.
 * Chip registers, timbres, envelopes, detune/sweep/vibrato, trigger suppression,
 * wave changes and PCM kits cannot be represented faithfully by these notes.
 * WAV is mono PCM16, clipped/rounded from the shared Sequencer, ending at the
 * finite totalFrames boundary (no added tail). opts: sampleRate (8000..96000),
 * allowLosses (strict true), yield (optional async callback between PCM chunks).
 * revision in the result is the selected id, not a mutable revision object.
 *
 * LSDj capability audit (2026-09-08): no certified exact subset THROUGH THE
 * EXISTING EXPORTER. This is not a claim that the LSDj format cannot express
 * a subset. src/lsdj.js fromDocument/lsdsng takes CT_CREATE document cells,
 * not gb; it schedules c/len and ignores the exact of/lf timing fields.
 * instrumentFor rebuilds stamp/velocity instruments (and silently reuses a
 * nearest-volume instrument at 64 slots); the instrument writer uses plain
 * software sustain rather than arbitrary bank envelope bytes. waveTableFor
 * selects stock stamp tables, with multiple wave voices sharing one table.
 * Arbitrary auto/vibOff/waveLoads/kit arrays have no input mapping. Phrase
 * padding and omitted boundary KILLs do not certify totalFrames/song-end state.
 * readSong/writeSong prove native byte preservation, not gb equivalence;
 * toSongJSON is a document projection with additional semantic limitations.
 * Even the plain pulse/no-automation candidate lacks a certified start phase,
 * frame clock and finite end: verify-lsdj-emulator permits +/-1 frame note
 * lengths and <=2% row-gap mismatch after searching 40 phase offsets.
 * Enabling a subset requires a gb->native mapping, fail-closed capacity checks,
 * and an independent target-version execution comparison of exact event times,
 * relevant chip state and finite end. Neither installing CT_LSDJ nor accepting
 * losses supplies that proof. Native byte passthrough remains out of scope.
 */
(function (G) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;
  var H = node ? require('./gb-hardware.js') : G.CT_GB_HARDWARE;
  if (node) require('./gb-kits.js');
  var A = node ? require('./gb-apu.js') : G.CT_GB_APU;
  var R = node ? require('./gb-rom.js') : G.CT_GB_ROM;
  var FPS = 4194304 / 70224;
  var LIMITS = Object.freeze({ seconds: 600, samples: 28800000, events: 100000, nodes: 1000000 });
  var LOSS = 'MIDI preserves note frame times only: chip timbres, envelopes, noise pitch, detune, sweep, vibrato, trigger state, register automation, wave loads and PCM kits are not reproduced; velocity is quantized to MIDI.';
  function fail(message) { throw new Error('music-exports: ' + message); }
  function integer(x, lo, hi) { return Number.isInteger(x) && x >= lo && x <= hi; }
  function lsdjErrors(g) {
    var errors = [
      'LSDj capability unavailable: no verified exact compiled-gb conversion. Existing fromDocument/lsdsng accepts document rows, not gb frame events.',
      'LSDj exact timing/end unverified even for plain pulse notes: document of/lf are ignored; phrase padding and boundary KILL omission cannot certify totalFrames. Existing emulator checks tolerate timing differences; native byte roundtrip is not playback equivalence.'
    ];
    if (g.notes.length) errors.push('LSDj instrument mapping unverified: exporter rebuilds stamp/velocity instruments with plain software sustain, not the compiled bank; instrument exhaustion can silently approximate volume.');
    if ((g.auto || []).length || (g.vibOff || []).length) errors.push('LSDj register automation/vibrato handoff has no exact compiled-event mapping.');
    if ((g.waveLoads || []).length || g.notes.some(function (n) { return n.ch === 2; })) errors.push('LSDj compiled wave tables/reloads have no exact mapping: existing exporter selects stock stamp waves and shares one pinned table.');
    if ((g.kit || []).length) errors.push('LSDj PCM kit data requires compatible target ROM assets; existing document exporter does not serialize compiled kits.');
    return errors;
  }
  // Bound and copy before the first await: edits while a WAV yields cannot change it.
  function snapshot(value) {
    var count = 0, seen = new Set();
    function copy(v, depth) {
      if (++count > LIMITS.nodes || depth > 32) fail('compiled allocation limit');
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.length <= 65536) return v;
      if (!v || typeof v !== 'object' || seen.has(v)) fail('compiled data must be finite acyclic data');
      seen.add(v);
      var out;
      if (Array.isArray(v) || ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        if (v.length > LIMITS.nodes) fail('compiled allocation limit');
        out = Array.from(v, function (x) { return copy(x, depth + 1); });
      } else {
        out = {};
        Object.keys(v).forEach(function (k) {
          if (k === '__proto__' || k === 'constructor') fail('invalid data key');
          out[k] = copy(v[k], depth + 1);
        });
      }
      seen.delete(v); return out;
    }
    return copy(value, 0);
  }
  function validate(c) {
    if (!c || !c.gb || c.native || c.nativeDocument || c.gb.native) fail('compiled gb required; native imports unsupported');
    if (c.diagnostics && (!Array.isArray(c.diagnostics) || c.diagnostics.some(function (d) { return d.severity === 'error'; }))) fail('compiled revision has error diagnostics');
    var g = c.gb;
    if (!integer(g.totalFrames, 1, Math.floor(FPS * LIMITS.seconds))) fail('duration limit (1 frame to 600 seconds)');
    if (!Array.isArray(g.notes) || !g.bank || !Array.isArray(g.bank.instruments) || !Array.isArray(g.bank.waveTables)) fail('notes and instrument/wave bank required');
    var count = g.notes.length;
    ['auto', 'vibOff', 'waveLoads', 'kit'].forEach(function (k) {
      if (g[k] != null && !Array.isArray(g[k])) fail('invalid ' + k);
      count += (g[k] || []).length;
    });
    if (count > LIMITS.events) fail('event limit');
    g.bank.instruments.forEach(function (r) { if (!Array.isArray(r) || r.length !== 4 || !r.every(function (v) { return integer(v, 0, 255); })) fail('invalid instrument'); });
    g.bank.waveTables.forEach(function (r) { if (!Array.isArray(r) || r.length !== 32 || !r.every(function (v) { return integer(v, 0, 15); })) fail('invalid wave table'); });
    g.notes.forEach(function (n) {
      if (!integer(n.ch, 0, 3) || !integer(n.frame, 0, g.totalFrames - 1) || !integer(n.frames, 1, g.totalFrames - n.frame) || !integer(n.midi, 0, 127) || !integer(n.inst, 0, g.bank.instruments.length - 1)) fail('invalid note');
      if (n.vel != null && !(Number.isFinite(n.vel) && n.vel >= 0 && n.vel <= 1)) fail('invalid velocity');
    });
    ['auto', 'vibOff', 'waveLoads', 'kit'].forEach(function (k) { (g[k] || []).forEach(function (e) {
      if (!integer(e.f, 0, g.totalFrames - 1)) fail('invalid ' + k + ' frame');
      if (k === 'auto' && (!integer(e.r, 0x10, 0x3f) || !integer(e.v, 0, 255))) fail('invalid register write');
      if (k === 'vibOff' && !integer(e.ch, 0, 1)) fail('invalid vibrato channel');
      if (k === 'waveLoads' && !integer(e.slot, 0, g.bank.waveTables.length - 1)) fail('invalid wave slot');
      if (k === 'kit' && (!integer(e.id, 0, 7) || !G.CT_GB_KITS)) fail('kit capability unavailable');
    }); });
  }
  function check(c, format) {
    var errors = [], losses = [];
    try {
      validate(c);
      if (format === 'wav') { if (!A || !A.Sequencer) fail('shared APU unavailable'); }
      else if (format === 'midi') losses.push(LOSS);
      else if (format === 'rom') {
        if (!R || !H) fail('shared ROM exporter unavailable');
        R.buildRom({ gb: c.gb }); // Capacity and encoding checked by the shared exporter.
      } else if (format === 'lsdsng') errors = lsdjErrors(c.gb);
      else fail('unsupported format: ' + format);
    } catch (e) { errors.push(e.message); }
    return { ok: errors.length === 0, losses: losses, errors: errors };
  }
  function inspect(c, format) {
    try { return check(snapshot(c), format); }
    catch (e) { return { ok: false, losses: [], errors: [e.message] }; }
  }
  function midi(g) {
    var events = [], track = [0, 255, 81, 3, 0, 244, 36]; // 62500 us/qn
    g.notes.forEach(function (n, i) {
      events.push({ f: n.frame, off: false, n: n, i: i });
      events.push({ f: n.frame + n.frames, off: true, n: n, i: i });
    });
    events.sort(function (a, b) { return a.f - b.f || Number(b.off) - Number(a.off) || a.i - b.i; });
    function vlq(v) { var b = [v & 127]; while ((v = Math.floor(v / 128))) b.unshift((v & 127) | 128); track.push.apply(track, b); }
    var last = 0;
    events.forEach(function (e) {
      vlq((e.f - last) * 4389); last = e.f;
      track.push((e.off ? 128 : 144) | e.n.ch, e.n.midi, e.off ? 0 : Math.max(1, Math.round((e.n.vel == null ? 1 : e.n.vel) * 127)));
    });
    vlq((g.totalFrames - last) * 4389); track.push(255, 47, 0);
    var bytes = new Uint8Array(22 + track.length), v = new DataView(bytes.buffer);
    bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,64,0,77,84,114,107]);
    v.setUint32(18, track.length); bytes.set(track, 22); return bytes;
  }
  async function wav(g, opts) {
    var sr = opts.sampleRate == null ? 44100 : opts.sampleRate;
    if (!integer(sr, 8000, 96000)) fail('sampleRate must be an integer from 8000 to 96000');
    var length = Math.ceil(g.totalFrames / FPS * sr);
    if (length > LIMITS.samples) fail('sample allocation limit');
    var bytes = new Uint8Array(44 + length * 2), v = new DataView(bytes.buffer);
    bytes.set([82,73,70,70]); v.setUint32(4, bytes.length - 8, true);
    bytes.set([87,65,86,69,102,109,116,32], 8); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    bytes.set([100,97,116,97], 36); v.setUint32(40, length * 2, true);
    var seq = new A.Sequencer(g, sr), chunk = new Float32Array(8192);
    for (var at = 0; at < length; at += chunk.length) {
      var n = Math.min(chunk.length, length - at); seq.render(chunk, 0, n);
      for (var j = 0; j < n; j++) { var s = Math.max(-1, Math.min(1, chunk[j])); v.setInt16(44 + (at + j) * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true); }
      if (opts.yield && at + n < length) await opts.yield();
    }
    return bytes;
  }
  async function exportRevision(revision, format, opts) {
    opts = Object.assign({}, opts || {});
    if (!revision || revision.validated !== true || typeof revision.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(revision.id)) fail('validated revision with stable id required');
    var id = revision.id, c = snapshot(revision.compiled), report = check(c, format);
    if (!report.ok) fail(report.errors.join('; '));
    if (report.losses.length && opts.allowLosses !== true) fail('explicit allowLosses: true required: ' + report.losses.join('; '));
    if (opts.yield != null && typeof opts.yield !== 'function') fail('yield must be a function');
    var bytes = format === 'wav' ? await wav(c.gb, opts) : format === 'midi' ? midi(c.gb) : R.buildRom({ gb: c.gb });
    var ext = { wav: 'wav', midi: 'mid', rom: 'gb' }[format];
    return { bytes: bytes, mime: { wav: 'audio/wav', midi: 'audio/midi', rom: 'application/octet-stream' }[format], name: 'revision-' + id.replace(/[^A-Za-z0-9._-]/g, '_') + '.' + ext, warnings: report.losses.slice(), revision: id };
  }
  var API = { inspect: inspect, exportRevision: exportRevision, limits: LIMITS };
  G.CT_MUSIC_EXPORTS = API;
  if (node) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
