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
 * cycleV1 is the second pattern constructor, accepted only as pattern()'s
 * second argument; it never reinterprets a saved notes() string. Equal slots
 * divide one cycle: [..] subdivides a slot, <..> alternates one branch per
 * visit, ~ rests, *N repeats in place (1-16), and C2(k,n,r) distributes k hits
 * over n slots on a single pitch atom, with positive r rotating LEFT.
 * cycleV1 chains: fast, slow (integer 1-16), rev(), every(period,'rev',offset)
 * (period 1-64, explicit zero-based offset), wrapping the preceding expression
 * in written order; gate applies after rhythm and the last gate wins; velocity,
 * transpose and register behave as on notes; stepsPerBar is rejected.
 * One output cycle is one four-beat bar here, through the same clock below;
 * a cycle is not inherently a bar in Tidal. Phase is song-global, so
 * play({atBar,repeat}) selects the onset window [atBar, atBar+repeat) without
 * restarting alternation, without manufacturing a retrigger by slicing a
 * sustain, and without trimming a tail. Reversal of an event crossing its own
 * reversal cycle is rejected with a located diagnostic, never approximated.
 * Evaluation uses bounded BigInt rationals with absolute endpoint conversion.
 * This is a bounded dialect guided by Tidal, not Tidal compatibility.
 * Tracks: lead/pulse1=0, arp/pad/pulse2=1, bass/wave=2, drums/noise=3.
 * Instrument names are bank.meta name/id/patch.authored; wave-bass aliases
 * w-triangle. No pitch clamping, truncation, sorting or overlap suppression.
 * Mapping indexes gb.notes; span is definition/event, occurrenceSpan is play.
 * Pattern notes additionally carry tokenSpan (raw pitch, including escapes),
 * playSpan (only the dot through this play call's closing parenthesis), and
 * trackSpan (the entire track declaration, including its transformations), plus
 * occurrenceStartFrame/occurrenceEndFrame (full repeat, including rests/gaps).
 * cycleV1 rows additionally carry patternType:'cycleV1' and cycleEvent, a
 * stable token@start/end rational identity used to deduplicate fragments of
 * one event inside a single play. notes() rows carry no patternType at all,
 * so a consumer must read an absent patternType as notes(). For cycles,
 * occurrence counts output cycles from the play's own start, and its
 * occurrenceStartFrame/EndFrame span a fixed four beats.
 * Legacy occurrenceSpan still extends from after the dot to the track end.
 * Exact events have none of these pattern-only fields; all-rest plays emit no
 * note mappings. Occurrence ends are exclusive and are not clipped to song end.
 * Each span has start/end {offset,line,column}: UTF-16 offsets, exclusive end,
 * one-based line/column. Successful compiles also expose controls for direct
 * literal gate/velocity/transpose on notes and transpose on tracks, once per
 * source call (including unused declarations). literalSpan is the numeric
 * token, callSpan runs from the dot through the close, and ownerSpan covers
 * the declaration through its final close, excluding trailing trivia/semicolon.
 * Controls are source ordered and published only after all validation succeeds.
 * The first LIMITS.controls calls are retained; controlsOmitted counts the rest
 * without changing musical validity. Failed compiles expose controls:[] and
 * controlsOmitted:0.
 * tempoAt:[[row,tempo],...] opts into Create's LSDj
 * segment clock; rows use settings.stepsPerBar (16 default), swing uses the
 * shared groove. Fractional gate rows interpolate adjacent boundary frames.
 * Resource limits are deterministic operation/data budgets, not wall time.
 */
(function (G) {
  'use strict';
  var H = typeof module !== 'undefined' && module.exports ? require('./gb-hardware.js') : G.CT_GB;
  var K = typeof module !== 'undefined' && module.exports ? require('./gb-kits.js') : G.CT_GB_KITS;
  var LIMITS = Object.freeze({ source: 1048576, depth: 32, nodes: 500000, events: 50000, controls: 50000,
    frames: 216000, repeats: 4096, steps: 65536, work: 2000000, instruments: 50128,
    cycleNodes: 4096, cycleDepth: 16, cycleTransforms: 32, cycleWork: 200000, cycleBits: 256 });
  var CONTROL_BOUNDS = { gate: [0.001, 1, false], velocity: [0, 1, false], transpose: [-128, 128, true] };
  var NOTE_BOUNDS = { stepsPerBar: [1, 256, true], gate: CONTROL_BOUNDS.gate,
    velocity: CONTROL_BOUNDS.velocity, transpose: CONTROL_BOUNDS.transpose, register: [-128, 128, true] };
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
  Parser.prototype.string = function (raw) {
    this.skip(); var start = this.i, quote = this.s[this.i++], out = '';
    while (this.i < this.s.length) {
      var c = this.s[this.i++];
      if (c === quote) { if (raw) raw.push(this.i - 1); return out; }
      // One decoded UTF-16 unit per iteration, even for a Unicode escape.
      // Adjacent raw boundaries also preserve escapes used as whitespace.
      if (raw) raw.push(this.i - 1);
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
  Parser.prototype.value = function (depth, raw, numberSpan) {
    need(depth <= LIMITS.depth && ++this.nodes <= LIMITS.nodes, 'Data resource limit', this.i);
    this.skip(); var c = this.s[this.i], v, k;
    if (c === '"' || c === "'") return this.string(raw);
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
    if (m) {
      // Only the direct numeric token gets a span; nested data and surrounding
      // trivia never contribute. Keep spelling in the source, not a reprint.
      if (numberSpan) numberSpan.push(this.i, this.i + m[0].length);
      this.i += m[0].length; v = Number(m[0]); need(Number.isFinite(v), 'Non-finite number', this.i); return v;
    }
    k = this.id(); if (k === 'true') return true; if (k === 'false') return false; if (k === 'null') return null;
    fail('Only literal data is allowed', this.i - k.length);
  };
  // Transform controls use exactly one argument. Capture its token while the
  // existing literal parser consumes it; argument validation remains unchanged.
  Parser.prototype.args = function (rawArgs, firstNumberSpan) { var a = []; this.expect('('); if (!this.take(')')) { do { var raw = rawArgs ? [] : null; a.push(this.value(0, raw, a.length === 0 ? firstNumberSpan : null)); if (rawArgs) rawArgs.push(raw); } while (this.take(',')); this.expect(')'); } return a; };
  Parser.prototype.chain = function () { var a = []; while (this.take('.')) { var at = this.i, name = this.id(), numberSpan = own(CONTROL_BOUNDS, name) ? [] : null, args = this.args(null, numberSpan); a.push({ name: name, args: args, at: at, end: this.i, numberSpan: numberSpan }); } return a; };
  // cycleV1 is explicit syntax, never a reinterpretation of saved notes().
  // Parsing constructs bounded data; expansion still belongs to compile().
  function cycleTree(text, raw, spend) {
    var i = 0, nodes = 0, atoms = 0;
    function at() { return raw[i]; }
    function skip() { while (i < text.length && /\s/.test(text[i])) i++; }
    function integer() { skip(); var start = i; while (/[0-9]/.test(text[i] || ' ')) i++; need(i > start, 'Expected cycle integer', at()); return Number(text.slice(start, i)); }
    function expect(c) { skip(); need(text[i] === c, 'Expected cycle ' + c, at()); i++; }
    function node(type, data, children, offset) {
      spend(offset); need(++nodes <= LIMITS.cycleNodes, 'Cycle syntax node limit', offset);
      var depth = 1;
      (children || []).forEach(function (child) { depth = Math.max(depth, child.depth + 1); });
      need(depth <= LIMITS.cycleDepth, 'Cycle nesting limit', offset);
      return Object.assign({ type: type, depth: depth, at: offset }, data);
    }
    function euclid(hits, slots) {
      // Distribute the shorter collection among the longer, retaining the
      // remainder at each Euclidean step. This fixes a reproducible phase.
      if (hits === 0 || hits === slots) return Array(slots).fill(hits !== 0);
      var a = Array.from({ length: hits }, function () { return [true]; });
      var b = Array.from({ length: slots - hits }, function () { return [false]; });
      while (a.length > 1 && b.length > 1) {
        var count = Math.min(a.length, b.length), combined = [];
        for (var n = 0; n < count; n++) combined.push(a[n].concat(b[n]));
        var rest = a.length > count ? a.slice(count) : b.slice(count);
        a = combined; b = rest;
      }
      return a.concat(b).flat();
    }
    function sequence(close, alternate, nesting) {
      need(nesting <= LIMITS.cycleDepth, 'Cycle nesting limit', at());
      skip(); var start = at(), children = [];
      while (i < text.length && text[i] !== close) {
        children.push(item(nesting));
        var before = i; skip();
        need(i === text.length || text[i] === close || i > before, 'Separate cycle slots with whitespace', at());
      }
      need(children.length > 0, 'Empty cycle group', start);
      if (close) expect(close);
      return node(alternate ? 'alternate' : 'sequence', { children: children }, children, start);
    }
    function item(nesting) {
      skip(); var start = at(), value;
      if (text[i] === '[' || text[i] === '<') {
        var alternate = text[i++] === '<'; value = sequence(alternate ? '>' : ']', alternate, nesting + 1);
      } else if (text[i] === '~') { i++; value = node('rest', {}, [], start); }
      else {
        var match = /^([A-Ga-g])([#b]?)(-?\d+)/.exec(text.slice(i));
        need(match, 'Expected cycle pitch, ~, [group] or <alternation>', start);
        var octave = Number(match[3]); need(num(octave, -128, 128, true), 'Invalid cycle octave', start);
        i += match[0].length;
        value = node('note', { token: atoms++, from: start, to: at(), midi: (octave + 1) * 12 +
          { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0) }, [], start);
      }
      // Postfix operators are adjacent to their item, never free-floating slots.
      while (text[i] === '*' || text[i] === '(') {
        var operation = text[i++], offset = raw[i - 1], n;
        if (operation === '*') {
          n = integer(); need(num(n, 1, 16, true), 'Cycle repetition must be an integer 1–16', offset);
          value = node('repeat', { child: value, count: n }, [value], offset);
        } else {
          need(value.type === 'note', 'Euclidean suffix requires one pitch atom', offset);
          var hits = integer(); expect(','); n = integer(); skip(); var rotation = 0;
          if (text[i] === ',') { i++; rotation = integer(); }
          expect(')');
          need(num(n, 1, 64, true) && num(hits, 0, n, true) && num(rotation, 0, n - 1, true), 'Invalid Euclidean hits, slots or left rotation', offset);
          var mask = euclid(hits, n);
          value = node('euclid', { child: value, mask: mask.map(function (_, index) { return mask[(index + rotation) % n]; }) }, [value], offset);
        }
      }
      return value;
    }
    var root = sequence(null, false, 0); skip(); need(i === text.length, 'Unexpected cycle notation', at()); return root;
  }
  function cycleRows(pat, atBar, repeat, gate, spend, playAt) {
    // Only bounded integer arithmetic is used before the common clock boundary.
    // Intermediate products have at most twice the bounded operand bit count.
    var MAX = (1n << BigInt(LIMITS.cycleBits)) - 1n;
    function rational(n, d) {
      d = d === undefined ? 1n : d; if (d < 0n) { n = -n; d = -d; }
      var a = n < 0n ? -n : n, b = d;
      while (b) { var rem = a % b; a = b; b = rem; }
      n /= a; d /= a;
      need(d > 0n && d <= MAX && n <= MAX && n >= -MAX, 'Cycle rational precision limit', playAt);
      return { n: n, d: d };
    }
    function add(a, b) { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
    function sub(a, b) { return rational(a.n * b.d - b.n * a.d, a.d * b.d); }
    function mul(a, b) { return rational(a.n * b.n, a.d * b.d); }
    function div(a, b) { return rational(a.n * b.d, a.d * b.n); }
    function cmp(a, b) { var delta = a.n * b.d - b.n * a.d; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
    function floor(a) { return a.n >= 0n ? a.n / a.d : (a.n - a.d + 1n) / a.d; }
    function ceil(a) { return -floor({ n: -a.n, d: a.d }); }
    function minimum(a, b) { return cmp(a, b) < 0 ? a : b; }
    function maximum(a, b) { return cmp(a, b) > 0 ? a : b; }
    function number(a) { return Number(a.n) / Number(a.d); }
    function decimal(n) {
      var parts = String(n).toLowerCase().split('e'), mantissa = parts[0].split('.');
      var exponent = Number(parts[1] || 0) - (mantissa[1] || '').length;
      var digits = BigInt(mantissa.join(''));
      return exponent >= 0 ? rational(digits * 10n ** BigInt(exponent)) : rational(digits, 10n ** BigInt(-exponent));
    }
    function push(out, event) { need(out.length <= LIMITS.events, 'Cycle intermediate event limit', playAt); out.push(event); }
    function identity(event) { return event.note.token + '@' + event.start.n + '/' + event.start.d + ':' + event.end.n + '/' + event.end.d; }
    function unique(events) {
      var seen = new Set(), out = [];
      events.forEach(function (event) { spend(playAt); var key = identity(event); if (!seen.has(key)) { seen.add(key); push(out, event); } });
      return out;
    }
    function tree(node, phase, start, end, from, to, out) {
      spend(node.at);
      if (cmp(end, from) <= 0 || cmp(start, to) >= 0) return;
      if (node.type === 'rest') return;
      if (node.type === 'note') { push(out, { note: node, start: start, end: end }); return; }
      if (node.type === 'alternate') {
        var count = BigInt(node.children.length);
        tree(node.children[Number(phase % count)], phase / count, start, end, from, to, out); return;
      }
      var n = node.type === 'sequence' ? node.children.length : node.type === 'repeat' ? node.count : node.mask.length;
      var size = div(sub(end, start), rational(BigInt(n)));
      for (var index = 0; index < n; index++) {
        spend(node.at);
        if (node.type === 'euclid' && !node.mask[index]) continue;
        var next = node.type === 'sequence' ? node.children[index] : node.child;
        var a = add(start, mul(size, rational(BigInt(index))));
        var b = add(start, mul(size, rational(BigInt(index + 1))));
        tree(next, node.type === 'repeat' ? phase * BigInt(n) + BigInt(index) : phase, a, b, from, to, out);
      }
    }
    var wrappers = pat.chains.filter(function (c) { return ['fast', 'slow', 'rev', 'every'].includes(c.name); });
    function query(level, from, to) {
      spend(playAt); var out = [];
      if (level >= 0) {
        var wrapper = wrappers[level];
        if (wrapper.name === 'fast' || wrapper.name === 'slow') {
          var factor = wrapper.name === 'fast' ? rational(BigInt(wrapper.args[0])) : rational(1n, BigInt(wrapper.args[0]));
          return query(level - 1, mul(from, factor), mul(to, factor)).map(function (event) {
            spend(wrapper.at); return { note: event.note, start: div(event.start, factor), end: div(event.end, factor) };
          });
        }
      }
      var first = floor(from), last = ceil(to);
      need(last - first <= BigInt(LIMITS.cycleWork), 'Cycle query work limit', playAt);
      for (var cycle = first; cycle < last; cycle++) {
        spend(playAt);
        var start = rational(cycle), end = rational(cycle + 1n), a = maximum(from, start), b = minimum(to, end);
        if (level < 0) tree(pat.cycle, cycle, start, end, a, b, out);
        else {
          var reverse = wrapper.name === 'rev' || Number(cycle % BigInt(wrapper.args[0])) === wrapper.args[2];
          var pivot = rational(2n * cycle + 1n);
          var events = query(level - 1, reverse ? sub(pivot, b) : a, reverse ? sub(pivot, a) : b);
          if (reverse) events.reverse();
          events.forEach(function (event) {
            spend(wrapper.at);
            if (reverse) {
              need(cmp(event.start, start) >= 0 && cmp(event.end, end) <= 0,
                'Cannot reverse a note crossing a cycle; put rev before slow', wrapper.at);
              event = { note: event.note, start: sub(pivot, event.end), end: sub(pivot, event.start) };
            }
            push(out, event);
          });
        }
      }
      return level < 0 ? out : unique(out);
    }
    var from = decimal(atBar), to = add(from, rational(BigInt(repeat))), gateRatio = decimal(gate);
    return unique(query(wrappers.length - 1, from, to)).filter(function (event) {
      return cmp(event.start, from) >= 0 && cmp(event.start, to) < 0;
    }).map(function (event) {
      spend(playAt);
      return { start: number(event.start), end: number(add(event.start, mul(sub(event.end, event.start), gateRatio))), midi: event.note.midi, vel: 1,
        token: event.note.token, from: event.note.from, to: event.note.to, cycleEvent: identity(event), occurrence: Number(floor(sub(event.start, from))) };
    });
  }
  function compile(source) {
    var settings = {}, mapping = [], diagnostics = [], p, gb = null;
    var lines = [0];
    function pos(offset) { var lo = 0, hi = lines.length; while (lo + 1 < hi) { var mid = (lo + hi) >> 1; if (lines[mid] <= offset) lo = mid; else hi = mid; } return { offset: offset, line: lo + 1, column: offset - lines[lo] + 1 }; }
    function span(a, b) { return { start: pos(a), end: pos(b) }; }
    try {
      need(typeof source === 'string' && source.length <= LIMITS.source, 'Source size limit');
      for (var li = 0; li < source.length; li++) if (source[li] === '\n') lines.push(li + 1);
      need(H && H.beatToFrame, 'CT_GB hardware dependency is required');
      p = new Parser(source); var patterns = Object.create(null), plays = [], seen = Object.create(null), eventCount = 0, eventSpans = {}, work = 0, cycleWork = 0, controlCalls = [], controlsOmitted = 0;
      function spend(n, at) { work += n; need(work <= LIMITS.work, 'Compilation work limit', at); }
      function spendCycle(at) { need(++cycleWork <= LIMITS.cycleWork, 'Cycle compilation work limit', at); spend(1, at); }
      function recordControls(chains, ownerType, ownerName, at, end) {
        var ownerSpan;
        // Visit declarations, never expanded plays/notes: source order and one
        // descriptor per call follow directly, even for repeated or silent uses.
        chains.forEach(function (c) {
          if (!own(CONTROL_BOUNDS, c.name) || ownerType === 'track' && c.name !== 'transpose') return;
          // This is view metadata, not a new music resource gate. The source
          // limit bounds the total call count; retain only the first 50,000.
          if (controlCalls.length === LIMITS.controls) { controlsOmitted++; return; }
          if (!ownerSpan) ownerSpan = span(at, end);
          controlCalls.push({ call: c, ownerType: ownerType, ownerName: ownerName, ownerSpan: ownerSpan });
        });
      }
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
          p.expect(','); var constructor = p.id(); need(constructor === 'notes' || constructor === 'cycleV1', 'Pattern requires notes() or cycleV1()', p.i); var rawArgs = []; args = p.args(rawArgs); chains = p.chain(); p.expect(')');
          need(args.length === 1 && typeof args[0] === 'string', constructor + ' requires a string', at);
          var rhythmic = 0;
          chains.forEach(function (c) {
            if (constructor === 'cycleV1' && ['fast', 'slow', 'rev', 'every'].includes(c.name)) {
              need(++rhythmic <= LIMITS.cycleTransforms, 'Cycle transformation limit', c.at);
              if (c.name === 'rev') need(c.args.length === 0, 'rev takes no arguments', c.at);
              else if (c.name === 'every') need(c.args.length === 3 && num(c.args[0], 1, 64, true) && c.args[1] === 'rev' && num(c.args[2], 0, c.args[0] - 1, true), 'Use every(period, "rev", offset)', c.at);
              else need(c.args.length === 1 && num(c.args[0], 1, 16, true), 'Cycle speed must be an integer 1–16', c.at);
              return;
            }
            need(own(NOTE_BOUNDS, c.name), 'Unknown notes transformation', c.at);
            need(constructor !== 'cycleV1' || c.name !== 'stepsPerBar', 'cycleV1 uses cycles; stepsPerBar belongs to notes()', c.at);
            var b = NOTE_BOUNDS[c.name]; need(c.args.length === 1 && num(c.args[0], b[0], b[1], b[2]), 'Invalid notes transformation argument', c.at);
          });
          patterns[pn] = { text: args[0], raw: rawArgs[0], chains: chains, at: at, end: p.i,
            cycle: constructor === 'cycleV1' ? cycleTree(args[0], rawArgs[0], spendCycle) : null };
          recordControls(chains, 'pattern', pn, at, p.i);
        } else {
          args = p.args(); chains = p.chain();
          need(args.length === 1, name + ' requires one argument', at);
          var v = args[0];
          if (name === 'track') {
            need(typeof v === 'string', 'Track requires a lane name', at); plays.push({ lane: v, chains: chains, at: at, end: p.i });
            // chain() skips trivia when looking for the next dot. Its last
            // call end is the declaration close; keep legacy mapping ends as-is.
            if (chains.length) recordControls(chains, 'track', v, at, chains[chains.length - 1].end);
          }
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
        // Create appends sound variants to the 128 stock records. Indices are
        // array addresses, not seven-bit hardware IDs; ROM emits registers.
        if (own(b, 'instruments')) need(Array.isArray(b.instruments) && b.instruments.length <= LIMITS.instruments && b.instruments.every(function (r) { return Array.isArray(r) && r.length === 4 && r.every(function (v) { return num(v, 0, 255, true); }); }), 'Invalid instrument bank: at most ' + LIMITS.instruments + ' four-byte records');
        if (own(b, 'waveTables')) need(Array.isArray(b.waveTables) && b.waveTables.length <= H.WAVE_SLOTS && b.waveTables.every(function (r) { return Array.isArray(r) && r.length === 32 && r.every(function (v) { return num(v, 0, 15, true); }); }), 'Invalid wave bank: at most 32 tables of 32 nibbles');
        if (own(b, 'arpTables')) need(Array.isArray(b.arpTables) && b.arpTables.length <= 256 && b.arpTables.every(function (r) { return Array.isArray(r) && r.length <= 256 && r.every(function (v) { return num(v, -128, 255, true); }); }), 'Invalid arpeggio tables');
        if (own(b, 'meta')) need(Array.isArray(b.meta) && b.meta.length <= ((b.instruments || []).length) && b.meta.every(function (m) { return object(m) && num(m.index, 0, (b.instruments || []).length - 1, true) && ['pulse', 'wave', 'noise'].includes(m.type) && (!own(m, 'patch') || object(m.patch) && (!own(m.patch, 'table4bit') || Array.isArray(m.patch.table4bit) && m.patch.table4bit.length === 32 && m.patch.table4bit.every(function (v) { return num(v, 0, 15, true); }))); }), 'Invalid bank metadata');
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
          if (pat.cycle) {
            var cycleGate = 1;
            pat.chains.forEach(function (x) { if (x.name === 'gate') cycleGate = x.args[0]; });
            var cycleNotes = cycleRows(pat, atBar, repeat, cycleGate, spendCycle, c.at);
            pat.chains.concat(transforms).forEach(function (x) {
              spend(1, x.at);
              if (x.name === 'velocity' || x.name === 'transpose' || x.name === 'register') cycleNotes.forEach(function (row) {
                spend(1, x.at);
                if (x.name === 'velocity') row.vel = x.args[0];
                else row.midi = x.name === 'transpose' ? row.midi + x.args[0] : (x.args[0] + 1) * 12 + ((row.midi % 12) + 12) % 12;
              });
            });
            need(eventCount + cycleNotes.length <= LIMITS.events, 'Event expansion limit', c.at);
            cycleNotes.forEach(function (row) {
              spend(1, c.at); var frame = time(row.start * 4);
              add('notes', { ch: lanes[t.lane], frame: frame, frames: Math.max(1, time(row.end * 4) - frame), midi: row.midi, inst: inst, vel: row.vel }, pat.at, pat.end);
              Object.assign(mapping[mapping.length - 1], { pattern: c.args[0], patternType: 'cycleV1', occurrence: row.occurrence,
                patternNote: row.token, cycleEvent: row.cycleEvent, track: t.lane, tokenSpan: span(row.from, row.to),
                occurrenceSpan: span(c.at, t.end), playSpan: span(c.at - 1, c.end), trackSpan: span(t.at, t.end),
                occurrenceStartFrame: time((atBar + row.occurrence) * 4), occurrenceEndFrame: time((atBar + row.occurrence + 1) * 4) });
            });
            return;
          }
          var tokens = pat.text.match(/\S+/g) || [], tokenOffset = 0, step = 0, rows = [], spb = 16, gate = 1;
          spend(tokens.length * (1 + pat.chains.length + transforms.length), c.at);
          need(tokens.length > 0 && tokens.length <= LIMITS.steps, 'Pattern step limit', pat.at);
          tokens.forEach(function (token) {
            tokenOffset = pat.text.indexOf(token, tokenOffset);
            var m = /^(\.|[A-Ga-g][#b]?-?\d+)(?::(\d+(?:\.\d+)?))?(?:@(\d+(?:\.\d+)?))?$/.exec(token);
            need(m, 'Invalid note token ' + token, pat.at); var length = m[2] == null ? 1 : Number(m[2]), vel = m[3] == null ? 1 : Number(m[3]);
            need(num(length, 0.001, LIMITS.steps) && num(vel, 0, 1), 'Invalid length or velocity', pat.at);
            if (m[1] !== '.') { var pitch = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(m[1]); rows.push({ step: step, length: length, midi: (Number(pitch[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch[1].toUpperCase()] + (pitch[2] === '#' ? 1 : pitch[2] === 'b' ? -1 : 0), vel: vel }); }
            if (m[1] !== '.') rows[rows.length - 1].tokenSpan = span(pat.raw[tokenOffset], pat.raw[tokenOffset + m[1].length]);
            tokenOffset += token.length;
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
          for (var rep = 0; rows.length && rep < repeat; rep++) {
            var occurrenceStartFrame = time(atBar * 4 + rep * step * 4 / spb);
            var occurrenceEndFrame = time(atBar * 4 + (rep + 1) * step * 4 / spb);
            rows.forEach(function (r, ri) {
            var beat = atBar * 4 + (rep * step + r.step) * 4 / spb, frame = time(beat);
            add('notes', { ch: lanes[t.lane], frame: frame, frames: Math.max(1, time(beat + r.length * gate * 4 / spb) - frame), midi: r.midi, inst: inst, vel: r.vel }, pat.at, pat.end);
            Object.assign(mapping[mapping.length - 1], { pattern: c.args[0], occurrence: rep, patternNote: ri, track: t.lane, occurrenceSpan: span(c.at, t.end),
              tokenSpan: r.tokenSpan, playSpan: span(c.at - 1, c.end), trackSpan: span(t.at, t.end), occurrenceStartFrame: occurrenceStartFrame, occurrenceEndFrame: occurrenceEndFrame });
          });
          }
        });
      });
      gb.notes.forEach(function (n, i) {
        var at = mapping[i].span.start.offset;
        need(num(n.ch, 0, 3, true) && num(n.frame, 0, LIMITS.frames, true) && num(n.frames, 1, LIMITS.frames, true), 'Invalid note channel or timing', at);
        need(n.frame < gb.totalFrames, 'Note starts at or beyond song end', at);
        need(n.frame + n.frames <= LIMITS.frames, 'Note end exceeds global frame limit', at);
        if (n.frame + n.frames > gb.totalFrames) {
          need(mapping[i].pattern === null, 'Note extends beyond song end', at);
          diagnostics.push({ severity: 'warning', code: 'SONG_END_CUT',
            message: 'Finite song end cuts this exact event; its source duration is preserved',
            span: mapping[i].span, noteIndex: i, cutFrame: gb.totalFrames,
            noteEndFrame: n.frame + n.frames });
        }
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
      // Tracks, emitted pitches/timing, banks and dedicated event arrays have
      // all validated. Every retained call now has one direct numeric token.
      var controls = controlCalls.map(function (entry) {
        var c = entry.call, b = CONTROL_BOUNDS[c.name];
        return { kind: c.name, value: c.args[0], literalSpan: span(c.numberSpan[0], c.numberSpan[1]),
          callSpan: span(c.at - 1, c.end), ownerSpan: entry.ownerSpan, ownerType: entry.ownerType,
          ownerName: entry.ownerName, min: b[0], max: b[1], integer: b[2] };
      });
      return { gb: gb, settings: settings, mapping: mapping, diagnostics: diagnostics, controls: controls, controlsOmitted: controlsOmitted };
    } catch (e) { return { gb: null, settings: settings, mapping: [], controls: [], controlsOmitted: 0, diagnostics: [{ severity: 'error', code: 'INVALID_SOURCE', message: e.message, span: span(e.at == null ? p ? p.i : 0 : e.at, e.at == null ? p ? p.i : 0 : e.at) }] }; }
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
