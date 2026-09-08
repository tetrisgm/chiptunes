/* Restricted music source v1. No JavaScript evaluation.
 * Explicit mode is lossless for finite JSON data (including extra note/bank
 * fields). Undefined object properties are omitted by JSON normalization;
 * undefined array entries, sparse arrays, class instances and cycles fail.
 * song({totalFrames,loopFrames?,settings?}) selects exact mode; song({tempo,
 * bars,...}) selects shorthand defaults. performance({bank:{...},...}) supplies
 * other GB fields, never notes or the dedicated event arrays. Empty optional
 * arrays are declared with performance({auto:[]}) etc. Calls are order-stable.
 * notes accepts space-separated pitches/rests, optionally C4:2@0.5 (step length,
 * velocity); chains: stepsPerBar, gate, velocity, transpose, register (octave).
 * register preserves pitch class at that point in the ordered transformation.
 * Tracks: lead/pulse1=0, arp/pad/pulse2=1, bass/wave=2, drums/noise=3.
 * Instrument names are bank.meta name/id/patch.authored; wave-bass aliases
 * w-triangle. No pitch clamping, truncation, sorting or overlap suppression.
 * Mapping indexes gb.notes; span is definition/event, occurrenceSpan is play.
 * Each span has start/end {offset,line,column}: UTF-16 offsets, exclusive end,
 * one-based line/column. tempoAt:[[row,tempo],...] opts into Create's LSDj
 * segment clock; rows use settings.stepsPerBar (16 default), swing uses the
 * shared groove. Fractional gate rows interpolate adjacent boundary frames.
 * Resource limits are deterministic operation/data budgets, not wall time.
 */
(function (G) {
  'use strict';
  var H = typeof module !== 'undefined' && module.exports ? require('./gb-hardware.js') : G.CT_GB;
  var K = typeof module !== 'undefined' && module.exports ? require('./gb-kits.js') : G.CT_GB_KITS;
  var LIMITS = Object.freeze({ source: 1048576, depth: 32, nodes: 500000, events: 50000,
    frames: 216000, repeats: 4096, steps: 65536, work: 2000000 });
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function fail(message, at) { var e = new Error(message); e.at = at || 0; throw e; }
  function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function num(v, lo, hi, integer) { return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!integer || Number.isInteger(v)); }
  function need(ok, message, at) { if (!ok) fail(message, at); }
  // The one clock used by compilation and host bar-boundary calculations.
  // Snapshot settings into segments so callers may reuse a clock efficiently.
  function createClock(settings) {
    settings = settings == null ? {} : settings;
    need(object(settings), 'Clock settings must be an object');
    need(H && H.beatToFrame, 'CT_GB hardware dependency is required');
    var tempo = settings.tempo == null ? 120 : settings.tempo;
    var grid = settings.stepsPerBar == null ? 16 : settings.stepsPerBar;
    need(num(tempo, 1, 1000), 'Invalid tempo');
    need(num(grid, 1, 256, true), 'Invalid settings.stepsPerBar');
    var changes = settings.tempoAt, ticks, segments = [{ row: 0, frame: 0, tempo: tempo }];
    if (changes != null) {
      need(Array.isArray(changes) && changes.length <= 4096 && num(tempo, 40, 255, true), 'Invalid tempoAt clock');
      need(settings.swing == null || typeof settings.swing === 'boolean' || num(settings.swing, 0.5, 0.8), 'Invalid swing');
      ticks = H.lsdjGrooveTicks(settings.swing, grid);
      var prevRow = -1;
      changes.forEach(function (pair) {
        need(Array.isArray(pair) && pair.length === 2 && num(pair[0], 0, LIMITS.steps, true) && pair[0] > prevRow && num(pair[1], 40, 255, true), 'tempoAt requires increasing [row, tempo] pairs');
        var prev = segments[segments.length - 1];
        segments.push({ row: pair[0], tempo: pair[1], frame: prev.frame + H.lsdjRowFrame(prev.tempo, ticks, pair[0] - prev.row) });
        prevRow = pair[0];
      });
    }
    return function (beat) {
      // The largest allowed arrangement can have 65536 bars plus 4096
      // repetitions of 65536 steps at one step/bar. Reject unsafe row math.
      need(num(beat, 0, 4 * (65536 + 4096 * 65536)), 'Invalid beat position');
      if (!ticks) return H.beatToFrame(beat, tempo);
      var row = beat * grid / 4;
      need(row < 2147483647, 'Clock row limit');
      var lo = 0, hi = segments.length;
      while (lo + 1 < hi) { var mid = (lo + hi) >> 1; if (segments[mid].row <= row) lo = mid; else hi = mid; }
      var seg = segments[lo], relative = row - seg.row, floor = Math.floor(relative);
      var start = H.lsdjRowFrame(seg.tempo, ticks, floor);
      return Math.round(seg.frame + start + (relative - floor) * (H.lsdjRowFrame(seg.tempo, ticks, floor + 1) - start));
    };
  }
  function beatToFrame(settings, beat) { return createClock(settings)(beat); }
  function Parser(s) { this.s = s; this.i = 0; this.nodes = 0; }
  Parser.prototype.skip = function () {
    var s = this.s;
    while (this.i < s.length) {
      if (/\s/.test(s[this.i])) { this.i++; continue; }
      if (s.slice(this.i, this.i + 2) === '//') { while (this.i < s.length && s[this.i] !== '\n') this.i++; continue; }
      if (s.slice(this.i, this.i + 2) === '/*') { var end = s.indexOf('*/', this.i + 2); need(end >= 0, 'Unclosed comment', this.i); this.i = end + 2; continue; }
      break;
    }
  };
  Parser.prototype.take = function (c) { this.skip(); if (this.s[this.i] === c) { this.i++; return true; } return false; };
  Parser.prototype.expect = function (c) { need(this.take(c), 'Expected ' + c, this.i); };
  Parser.prototype.id = function () { this.skip(); var m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(this.s.slice(this.i)); need(m, 'Expected name', this.i); this.i += m[0].length; return m[0]; };
  Parser.prototype.string = function () {
    this.skip(); var start = this.i, quote = this.s[this.i++], out = '';
    while (this.i < this.s.length) {
      var c = this.s[this.i++];
      if (c === quote) return out;
      need(c.charCodeAt(0) >= 32, 'Control character in string', this.i - 1);
      if (c === '\\') {
        c = this.s[this.i++];
        var escapes = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (c === 'u') { var h = this.s.slice(this.i, this.i + 4); need(/^[0-9a-fA-F]{4}$/.test(h), 'Invalid Unicode escape', this.i); out += String.fromCharCode(parseInt(h, 16)); this.i += 4; }
        else { need(own(escapes, c), 'Invalid escape', this.i); out += escapes[c]; }
      } else out += c;
    }
    fail('Unclosed string', start);
  };
  Parser.prototype.value = function (depth) {
    need(depth <= LIMITS.depth && ++this.nodes <= LIMITS.nodes, 'Data resource limit', this.i);
    this.skip(); var c = this.s[this.i], v, k;
    if (c === '"' || c === "'") return this.string();
    if (c === '{' || c === '[') {
      this.i++; var arr = c === '[', close = arr ? ']' : '}'; v = arr ? [] : {};
      if (this.take(close)) return v;
      do {
        if (arr) v.push(this.value(depth + 1));
        else {
          this.skip(); k = /['"]/.test(this.s[this.i] || ' ') ? this.string() : this.id();
          need(!['__proto__', 'constructor', 'prototype'].includes(k) && !own(v, k), 'Forbidden or duplicate key', this.i);
          this.expect(':'); v[k] = this.value(depth + 1);
        }
        if (this.take(close)) return v;
        this.expect(',');
      } while (true);
    }
    var m = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (m) { this.i += m[0].length; v = Number(m[0]); need(Number.isFinite(v), 'Non-finite number', this.i); return v; }
    k = this.id(); if (k === 'true') return true; if (k === 'false') return false; if (k === 'null') return null;
    fail('Only literal data is allowed', this.i - k.length);
  };
  Parser.prototype.args = function () { var a = []; this.expect('('); if (!this.take(')')) { do { a.push(this.value(0)); } while (this.take(',')); this.expect(')'); } return a; };
  Parser.prototype.chain = function () { var a = []; while (this.take('.')) { var at = this.i; a.push({ name: this.id(), args: this.args(), at: at }); } return a; };
  function compile(source) {
    var settings = {}, mapping = [], diagnostics = [], p, gb = null;
    var lines = [0];
    function pos(offset) { var lo = 0, hi = lines.length; while (lo + 1 < hi) { var mid = (lo + hi) >> 1; if (lines[mid] <= offset) lo = mid; else hi = mid; } return { offset: offset, line: lo + 1, column: offset - lines[lo] + 1 }; }
    function span(a, b) { return { start: pos(a), end: pos(b) }; }
    try {
      need(typeof source === 'string' && source.length <= LIMITS.source, 'Source size limit');
      for (var li = 0; li < source.length; li++) if (source[li] === '\n') lines.push(li + 1);
      need(H && H.beatToFrame, 'CT_GB hardware dependency is required');
      p = new Parser(source); var patterns = Object.create(null), plays = [], seen = Object.create(null), eventCount = 0, eventSpans = {}, work = 0;
      function spend(n, at) { work += n; need(work <= LIMITS.work, 'Compilation work limit', at); }
      gb = { notes: [] };
      function add(key, value, at, end) {
        need(object(value), key + ' requires an object', at);
        need(++eventCount <= LIMITS.events, 'Event expansion limit', at);
        if (!own(gb, key)) gb[key] = [];
        gb[key].push(value);
        (eventSpans[key] || (eventSpans[key] = [])).push(at);
        if (key === 'notes') mapping.push({ noteIndex: gb.notes.length - 1, span: span(at, end), pattern: null, occurrence: null });
      }
      while (true) {
        p.skip(); if (p.i === source.length) break;
        var at = p.i, name = p.id(), args, chains;
        if (name === 'pattern') {
          p.expect('('); var pn = p.value(0); need(typeof pn === 'string' && !own(patterns, pn), 'Invalid or duplicate pattern name', at);
          p.expect(','); need(p.id() === 'notes', 'Pattern requires notes()', p.i); args = p.args(); chains = p.chain(); p.expect(')');
          need(args.length === 1 && typeof args[0] === 'string', 'notes requires a string', at);
          chains.forEach(function (c) {
            var bounds = { stepsPerBar: [1, 256, true], gate: [0.001, 1, false], velocity: [0, 1, false], transpose: [-128, 128, true], register: [-128, 128, true] };
            need(own(bounds, c.name), 'Unknown notes transformation', c.at);
            var b = bounds[c.name]; need(c.args.length === 1 && num(c.args[0], b[0], b[1], b[2]), 'Invalid notes transformation argument', c.at);
          });
          patterns[pn] = { text: args[0], chains: chains, at: at, end: p.i };
        } else {
          args = p.args(); chains = p.chain();
          need(args.length === 1, name + ' requires one argument', at);
          var v = args[0];
          if (name === 'track') { need(typeof v === 'string', 'Track requires a lane name', at); plays.push({ lane: v, chains: chains, at: at, end: p.i }); }
          else {
            need(chains.length === 0, 'Unsupported chain', at);
            var eventNames = { event: 'notes', automation: 'auto', vibratoOff: 'vibOff', waveLoad: 'waveLoads', kit: 'kit' };
            var key = own(eventNames, name) ? eventNames[name] : null;
            if (key) add(key, v, at, p.i);
            else if (['song', 'instruments', 'waves', 'performance'].includes(name)) {
              need(!seen[name], 'Duplicate ' + name, at); seen[name] = true;
              if (name === 'song') {
                need(object(v), 'song requires settings', at);
                if (own(v, 'totalFrames')) { need(Object.keys(v).every(function (k) { return ['totalFrames', 'loopFrames', 'settings'].includes(k); }), 'Exact song accepts totalFrames, loopFrames, settings', at); settings = v.settings || {}; need(object(settings), 'Invalid settings', at); gb.totalFrames = v.totalFrames; if (own(v, 'loopFrames')) gb.loopFrames = v.loopFrames; }
                else { settings = v; }
              } else if (name === 'performance') {
                need(object(v), 'performance requires an object', at);
                Object.keys(v).forEach(function (k) {
                  need(!['notes', 'totalFrames', 'loopFrames'].includes(k), 'Reserved performance field ' + k, at);
                  if (['auto', 'vibOff', 'waveLoads', 'kit'].includes(k)) need(Array.isArray(v[k]) && !v[k].length, 'Use individual event calls for ' + k, at);
                  if (k === 'bank') { need(object(v[k]) && !own(v[k], 'instruments') && !own(v[k], 'waveTables'), 'Use instruments() and waves() for bank assets', at); gb.bank = Object.assign(gb.bank || {}, v[k]); }
                  else { need(!own(gb, k), 'Duplicate performance field', at); gb[k] = v[k]; }
                });
              } else { need(Array.isArray(v), name + ' requires an array', at); gb.bank = gb.bank || {}; gb.bank[name === 'waves' ? 'waveTables' : 'instruments'] = v; }
            } else fail('Unknown call ' + name, at);
          }
        }
        p.take(';');
      }
      need(seen.song, 'song() is required');
      var tempo = settings.tempo == null ? 120 : settings.tempo;
      var changes = settings.tempoAt, time = createClock(settings);
      if (!own(gb, 'totalFrames') || plays.length) {
        need(num(tempo, 1, 1000), 'Invalid tempo');
        need(settings.beatsPerBar == null || settings.beatsPerBar === 4, 'Only four beats per bar are supported');
        if (!own(gb, 'totalFrames')) { need(num(settings.bars, 1, 65536, true), 'Finite bars required'); gb.totalFrames = time(settings.bars * 4); gb.loopFrames = gb.totalFrames; }
        if (!gb.bank) gb.bank = H.buildBank([]);
      }
      need(num(gb.totalFrames, 0, LIMITS.frames, true), 'Invalid totalFrames');
      if (own(gb, 'loopFrames')) need(num(gb.loopFrames, 0, gb.totalFrames, true), 'Invalid loopFrames');
      if (gb.bank) {
        var b = gb.bank;
        if (own(b, 'instruments')) need(Array.isArray(b.instruments) && b.instruments.length <= 128 && b.instruments.every(function (r) { return Array.isArray(r) && r.length === 4 && r.every(function (v) { return num(v, 0, 255, true); }); }), 'Invalid instrument bank: at most 128 four-byte records');
        if (own(b, 'waveTables')) need(Array.isArray(b.waveTables) && b.waveTables.length <= H.WAVE_SLOTS && b.waveTables.every(function (r) { return Array.isArray(r) && r.length === 32 && r.every(function (v) { return num(v, 0, 15, true); }); }), 'Invalid wave bank: at most 32 tables of 32 nibbles');
        if (own(b, 'arpTables')) need(Array.isArray(b.arpTables) && b.arpTables.length <= 256 && b.arpTables.every(function (r) { return Array.isArray(r) && r.length <= 256 && r.every(function (v) { return num(v, -128, 255, true); }); }), 'Invalid arpeggio tables');
        if (own(b, 'meta')) need(Array.isArray(b.meta) && b.meta.length <= 128 && b.meta.every(function (m) { return object(m) && num(m.index, 0, 127, true) && ['pulse', 'wave', 'noise'].includes(m.type) && (!own(m, 'patch') || object(m.patch) && (!own(m.patch, 'table4bit') || Array.isArray(m.patch.table4bit) && m.patch.table4bit.length === 32 && m.patch.table4bit.every(function (v) { return num(v, 0, 15, true); }))); }), 'Invalid bank metadata');
      }
      var lanes = { lead: 0, pulse1: 0, arp: 1, pad: 1, pulse2: 1, bass: 2, wave: 2, drums: 3, noise: 3 };
      function instrument(v, at) {
        if (typeof v === 'string') {
          if (v === 'wave-bass') v = 'w-triangle';
          var matches = ((gb.bank || {}).meta || []).filter(function (m) { return m.name === v || m.id === v || m.patch && m.patch.authored === v; });
          need(matches.length === 1, 'Unknown or ambiguous instrument ' + v, at); v = matches[0].index;
        }
        need(num(v, 0, ((gb.bank || {}).instruments || []).length - 1, true), 'Invalid instrument', at); return v;
      }
      plays.forEach(function (t) {
        need(own(lanes, t.lane), 'Unknown track lane', t.at); var inst = null, transforms = [];
        t.chains.forEach(function (c) {
          if (c.name === 'instrument') { need(c.args.length === 1, 'instrument requires one argument', c.at); inst = instrument(c.args[0], c.at); return; }
          if (c.name === 'transpose' || c.name === 'register') { need(c.args.length === 1 && num(c.args[0], -128, 128, true), 'Invalid pitch transformation', c.at); transforms.push(c); return; }
          need(c.name === 'play' && c.args.length >= 1 && c.args.length <= 2, 'Unsupported track operation', c.at);
          need(inst !== null, 'Set instrument before play', c.at);
          need(typeof c.args[0] === 'string', 'play requires a pattern name', c.at);
          var pat = patterns[c.args[0]], opt = c.args.length === 2 ? c.args[1] : {};
          need(pat && object(opt) && Object.keys(opt).every(function (k) { return ['atBar', 'repeat'].includes(k); }), 'Invalid pattern or play options', c.at);
          var atBar = opt.atBar == null ? 0 : opt.atBar, repeat = opt.repeat == null ? 1 : opt.repeat;
          need(num(atBar, 0, 65536) && num(repeat, 1, LIMITS.repeats, true), 'Invalid arrangement bounds', c.at);
          var tokens = pat.text.trim() ? pat.text.trim().split(/\s+/) : [], step = 0, rows = [], spb = 16, gate = 1;
          spend(tokens.length * (1 + pat.chains.length + transforms.length), c.at);
          need(tokens.length > 0 && tokens.length <= LIMITS.steps, 'Pattern step limit', pat.at);
          tokens.forEach(function (token) {
            var m = /^(\.|[A-Ga-g][#b]?-?\d+)(?::(\d+(?:\.\d+)?))?(?:@(\d+(?:\.\d+)?))?$/.exec(token);
            need(m, 'Invalid note token ' + token, pat.at); var length = m[2] == null ? 1 : Number(m[2]), vel = m[3] == null ? 1 : Number(m[3]);
            need(num(length, 0.001, LIMITS.steps) && num(vel, 0, 1), 'Invalid length or velocity', pat.at);
            if (m[1] !== '.') { var pitch = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(m[1]); rows.push({ step: step, length: length, midi: (Number(pitch[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch[1].toUpperCase()] + (pitch[2] === '#' ? 1 : pitch[2] === 'b' ? -1 : 0), vel: vel }); }
            step += length; need(step <= LIMITS.steps, 'Pattern length limit', pat.at);
          });
          pat.chains.concat(transforms).forEach(function (x) {
            var n = x.args[0]; need(x.args.length === 1, 'Transformation requires one argument', x.at);
            if (x.name === 'stepsPerBar') { need(num(n, 1, 256, true), 'Invalid stepsPerBar', x.at); spb = n; }
            else if (x.name === 'gate') { need(num(n, 0.001, 1), 'Invalid gate', x.at); gate = n; }
            else if (x.name === 'velocity') { need(num(n, 0, 1), 'Invalid velocity', x.at); rows.forEach(function (r) { r.vel = n; }); }
            else if (x.name === 'transpose' || x.name === 'register') { need(num(n, -128, 128, true), 'Invalid pitch transformation', x.at); rows.forEach(function (r) { r.midi = x.name === 'transpose' ? r.midi + n : (n + 1) * 12 + ((r.midi % 12) + 12) % 12; }); }
            else fail('Unknown notes transformation', x.at);
          });
          need(eventCount + rows.length * repeat <= LIMITS.events, 'Event expansion limit', c.at);
          spend(repeat * (1 + rows.length * (1 + (changes ? changes.length : 0))), c.at);
          for (var rep = 0; rep < repeat; rep++) rows.forEach(function (r, ri) {
            var beat = atBar * 4 + (rep * step + r.step) * 4 / spb, frame = time(beat);
            add('notes', { ch: lanes[t.lane], frame: frame, frames: Math.max(1, time(beat + r.length * gate * 4 / spb) - frame), midi: r.midi, inst: inst, vel: r.vel }, pat.at, pat.end);
            Object.assign(mapping[mapping.length - 1], { pattern: c.args[0], occurrence: rep, patternNote: ri, track: t.lane, occurrenceSpan: span(c.at, t.end) });
          });
        });
      });
      gb.notes.forEach(function (n, i) {
        var at = mapping[i].span.start.offset;
        need(num(n.ch, 0, 3, true) && num(n.frame, 0, LIMITS.frames, true) && num(n.frames, 1, LIMITS.frames, true), 'Invalid note channel or timing', at);
        need(n.frame + n.frames <= gb.totalFrames, 'Note extends beyond song end', at);
        need(typeof n.inst === 'number', 'Explicit event inst must be an index', at);
        instrument(n.inst, at);
        if (n.ch !== 3) need(num(n.midi, 0, 127, true) && H.inRange(n.midi, n.ch === 2 ? 'wave' : 'pulse'), 'Pitch outside chip range', at);
        if (own(n, 'vel')) need(num(n.vel, 0, 1), 'Invalid velocity', at);
        if (own(n, 'trigger')) need(typeof n.trigger === 'boolean', 'Invalid trigger state', at);
      });
      ['auto', 'vibOff', 'waveLoads', 'kit'].forEach(function (k) {
        (gb[k] || []).forEach(function (e, i) {
          var at = eventSpans[k][i];
          need(num(e.f, 0, gb.totalFrames), 'Invalid ' + k + ' frame', at);
          if (k === 'auto') need(num(e.r, 16, 63, true) && num(e.v, 0, 255, true), 'Invalid register write', at);
          if (k === 'vibOff') need(num(e.ch, 0, 1, true), 'Invalid vibrato channel', at);
          if (k === 'waveLoads') need(num(e.slot, 0, ((gb.bank || {}).waveTables || []).length - 1, true), 'Invalid wave slot', at);
          if (k === 'kit') need(num(e.id, 0, 255, true) && K && K.kits().some(function (kit) { return kit.id === e.id; }), 'Unknown kit id or missing CT_GB_KITS', at);
        });
      });
      var ends = [-1, -1, -1, -1];
      gb.notes.map(function (n, i) { return { n: n, i: i }; }).sort(function (a, b) { return a.n.frame - b.n.frame || a.i - b.i; }).forEach(function (item) {
        var n = item.n;
        if (n.frame < ends[n.ch]) diagnostics.push({ severity: 'warning', code: 'CHIP_OVERLAP', message: 'Overlapping notes on chip channel ' + n.ch, span: mapping[item.i].span, noteIndex: item.i });
        ends[n.ch] = Math.max(ends[n.ch], n.frame + n.frames);
      });
      return { gb: gb, settings: settings, mapping: mapping, diagnostics: diagnostics };
    } catch (e) { return { gb: null, settings: settings, mapping: [], diagnostics: [{ severity: 'error', code: 'INVALID_SOURCE', message: e.message, span: span(e.at == null ? p ? p.i : 0 : e.at, e.at == null ? p ? p.i : 0 : e.at) }] }; }
  }
  function materialize(gb, meta) {
    var nodes = 0, active = new Set();
    function check(v, depth) {
      need(depth <= LIMITS.depth && ++nodes <= LIMITS.nodes, 'Data resource limit');
      if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
      need(typeof v === 'object' && v && !active.has(v), 'Only acyclic finite JSON data is supported');
      need(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, 'Only plain data is supported');
      active.add(v);
      if (Array.isArray(v)) need(Object.keys(v).length === v.length, 'Sparse or decorated arrays are unsupported');
      Object.keys(v).forEach(function (k) { need(!['__proto__', 'constructor', 'prototype'].includes(k), 'Forbidden data key'); var d = Object.getOwnPropertyDescriptor(v, k); need(d && own(d, 'value'), 'Accessors are unsupported'); if (d.value !== undefined || Array.isArray(v)) check(d.value, depth + 1); });
      need(Object.getOwnPropertySymbols(v).length === 0, 'Symbol fields are unsupported'); active.delete(v);
    }
    check(gb, 0); check(meta || {}, 0); need(object(gb) && Array.isArray(gb.notes), 'GB notes required');
    var out = [], song = { totalFrames: gb.totalFrames, settings: meta || {} }, extra = {};
    if (own(gb, 'loopFrames')) song.loopFrames = gb.loopFrames;
    function emit(name, v) {
      if (name === 'song') out.push('// Song and source settings\n' + name + '(' + JSON.stringify(v, null, 2) + ');');
      else if (name === 'instruments' || name === 'waves') out.push('// ' + (name === 'instruments' ? 'Instrument records' : 'Wave tables (32 nibbles each)') + '\n' + name + '([\n' + v.map(function (row) { return '  ' + JSON.stringify(row); }).join(',\n') + '\n]);');
      else if (name === 'performance') out.push('// Performance and bank metadata\nperformance(' + JSON.stringify(v) + ');');
      else out.push(name + '(' + JSON.stringify(v) + ');');
    }
    emit('song', song);
    if (gb.bank) {
      if (own(gb.bank, 'instruments')) emit('instruments', gb.bank.instruments);
      if (own(gb.bank, 'waveTables')) emit('waves', gb.bank.waveTables);
      extra.bank = {}; Object.keys(gb.bank).forEach(function (k) { if (!['instruments', 'waveTables'].includes(k)) extra.bank[k] = gb.bank[k]; });
    }
    Object.keys(gb).forEach(function (k) { if (!['notes', 'bank', 'totalFrames', 'loopFrames', 'auto', 'vibOff', 'waveLoads', 'kit'].includes(k)) extra[k] = gb[k]; });
    var calls = { notes: 'event', auto: 'automation', vibOff: 'vibratoOff', waveLoads: 'waveLoad', kit: 'kit' };
    Object.keys(calls).forEach(function (k) { if (own(gb, k) && k !== 'notes' && gb[k].length === 0) extra[k] = []; });
    if (Object.keys(extra).length) emit('performance', extra);
    Object.keys(calls).forEach(function (k) { if (own(gb, k)) { need(Array.isArray(gb[k]), 'Expected event array'); if (gb[k].length) out.push('\n// ' + { notes: 'Note events', auto: 'Register automation', vibOff: 'Vibrato off', waveLoads: 'Wave loads', kit: 'Kit events' }[k]); gb[k].forEach(function (e) { emit(calls[k], e); }); } });
    var source = out.join('\n') + '\n', result = compile(source);
    need(result.gb, result.diagnostics.map(function (d) { return d.message; }).join('; '));
    function canonical(v) { if (Array.isArray(v)) return v.map(canonical); if (object(v)) { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canonical(v[k]); }); return o; } return v; }
    need(JSON.stringify(canonical(result.gb)) === JSON.stringify(canonical(gb)), 'Unsupported GB representation');
    return source;
  }
  var API = Object.freeze({ VERSION: '1', LIMITS: LIMITS, compile: compile, materialize: materialize,
    beatToFrame: beatToFrame, createClock: createClock });
  G.CT_MUSIC_LANGUAGE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
