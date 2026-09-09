/* Bounded visual source, version 1. See docs/visual-language.md.
 * The lexer and parser only construct data; source never becomes JavaScript.
 * Tokens include punctuation, but exclude comments, whitespace and EOF. Depth
 * counts nested objects, arrays and reference calls, excluding statement calls.
 * Diagnostic offsets/columns use UTF-16; lines/columns are one-based, ends
 * exclusive. Source size is UTF-8, including comments and replacement bytes
 * for unpaired surrogates. Labels count Unicode code points.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.CT_VISUAL_LANGUAGE = factory();
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }

  var LIMITS = freeze({ sourceBytes: 32768, tokens: 4096, depth: 16, layers: 8,
    controls: 8, paletteMin: 2, paletteMax: 8, count: 128, totalCount: 512,
    primitivesPerItem: 4 });
  var OPERATIONS = freeze(['tunnel', 'tiles', 'orbits', 'ribbons', 'sparks']);
  var BLENDS = freeze(['source-over', 'lighter', 'screen']);
  var SIGNALS = freeze(['audio.bass', 'audio.mid', 'audio.treble', 'audio.level',
    'beat.phase', 'bar.phase', 'lead.hit', 'lead.pitch', 'counter.hit',
    'counter.pitch', 'bass.hit', 'bass.pitch', 'drums.hit']);
  // Shared renderer schema: dynamic numeric properties resolve and clamp to
  // min/max; static fields must already satisfy their range or enum.
  var LAYER_SCHEMA = freeze({
    count: { default: 24, min: 1, max: LIMITS.count, integer: true, dynamic: false },
    size: { default: 0.5, min: 0.01, max: 2, dynamic: true },
    speed: { default: 0.5, min: -4, max: 4, dynamic: true },
    spin: { default: 0, min: -4, max: 4, dynamic: true },
    spread: { default: 0.7, min: 0, max: 2, dynamic: true },
    hue: { default: 0, min: -8, max: 8, dynamic: true },
    opacity: { default: 0.8, min: 0, max: 1, dynamic: true },
    react: { default: 0, min: 0, max: 2, dynamic: true },
    thickness: { default: 1, min: 0.25, max: 8, dynamic: true },
    blend: { default: 'source-over', values: BLENDS, dynamic: false }
  });
  var VISUAL_DEFAULTS = freeze({ background: '#090615',
    palette: ['#84f3d5', '#b089ff', '#ffbf69'], feedback: 0.8, seed: 1 });
  var CONTROL_KEYS = ['label', 'min', 'max', 'step', 'value'];
  var ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  function Failure(code, message, at) {
    this.code = code;
    this.message = message;
    this.start = at ? at.start : 0;
    this.end = at ? at.end : this.start;
  }
  function fail(code, message, at) { throw new Failure(code, message, at); }
  function need(condition, code, message, at) { if (!condition) fail(code, message, at); }
  function nameText(value) { return JSON.stringify(value.length > 64 ? value.slice(0, 64) + '…' : value); }
  function newline(c) { return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029'; }
  function paired(source, index) {
    var first = source.charCodeAt(index), second = source.charCodeAt(index + 1);
    return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff;
  }
  function sourceBound(source) {
    // Stop at the first excess byte, even if the supplied string is enormous.
    var bytes = 0;
    for (var i = 0; i < source.length; i++) {
      var code = source.charCodeAt(i), width = paired(source, i) ? 2 : 1;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : width === 2 ? 4 : 3;
      need(bytes <= LIMITS.sourceBytes, 'SOURCE_LIMIT', 'Source exceeds 32768 UTF-8 bytes', { start: i, end: i + width });
      i += width - 1;
    }
  }
  function position(source, offset) {
    var line = 1, column = 1;
    for (var i = 0; i < offset; i++) {
      var c = source[i];
      if (c === '\r') { line++; column = 1; }
      else if (c === '\n') { if (source[i - 1] !== '\r') line++; column = 1; }
      else if (c === '\u2028' || c === '\u2029') { line++; column = 1; }
      else column++;
    }
    return { offset: offset, line: line, column: column };
  }

  function lex(source) {
    var tokens = [], i = 0;
    while (i < source.length) {
      var c = source[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && source[i + 1] === '/') {
        i += 2;
        while (i < source.length && !newline(source[i])) i++;
        continue;
      }
      var start = i, kind, value;
      need(tokens.length < LIMITS.tokens, 'TOKEN_LIMIT', 'Source exceeds 4096 tokens', { start: i, end: i + 1 });
      if ('(){}[],:;'.indexOf(c) !== -1) { kind = c; value = c; i++; }
      else if (c === '"') {
        kind = 'string'; value = ''; i++;
        while (i < source.length && source[i] !== '"') {
          c = source[i++];
          need(c.charCodeAt(0) >= 32, 'STRING_SYNTAX', 'Unescaped control character in JSON string', { start: i - 1, end: i });
          if (c === '\\') {
            var escapeStart = i - 1, escaped = source[i++];
            if (escaped === 'u') {
              var hex = source.slice(i, i + 4);
              need(/^[0-9a-fA-F]{4}$/.test(hex), 'STRING_SYNTAX', 'Expected four hexadecimal digits after \\u',
                { start: escapeStart, end: Math.min(i + 4, source.length) });
              value += String.fromCharCode(parseInt(hex, 16)); i += 4;
            } else {
              need(own(ESCAPES, escaped), 'STRING_SYNTAX', 'Invalid JSON string escape',
                { start: escapeStart, end: Math.min(i, source.length) });
              value += ESCAPES[escaped];
            }
          } else value += c;
        }
        need(source[i] === '"', 'STRING_SYNTAX', 'Unterminated JSON string', { start: start, end: source.length });
        i++;
      } else if (/[A-Za-z_]/.test(c)) {
        kind = 'identifier'; i++;
        while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i++;
        value = source.slice(start, i);
      } else if (/[0-9.\-]/.test(c)) {
        // Decimal literals, including .5, 1. and exponent notation. No radix
        // prefixes, leading-zero integers, separators, unary + or expressions.
        var match = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(source.slice(i));
        need(match, 'NUMBER_SYNTAX', 'Expected a decimal number literal', { start: start, end: start + 1 });
        i += match[0].length;
        need(i === source.length || !/[A-Za-z0-9_.$]/.test(source[i]), 'NUMBER_SYNTAX', 'Invalid decimal number literal', { start: start, end: i + 1 });
        value = Number(match[0]); kind = 'number';
        need(Number.isFinite(value), 'NUMBER_FINITE', 'Number literals must be finite', { start: start, end: i });
      } else fail('SYNTAX', 'Unexpected character ' + nameText(c), { start: start, end: start + 1 });
      tokens.push({ kind: kind, value: value, start: start, end: i });
    }
    tokens.push({ kind: 'eof', start: source.length, end: source.length });
    return tokens;
  }

  function Parser(tokens) { this.tokens = tokens; this.index = 0; }
  Parser.prototype.peek = function () { return this.tokens[this.index]; };
  Parser.prototype.take = function (kind) {
    if (this.peek().kind !== kind) return null;
    return this.tokens[this.index++];
  };
  Parser.prototype.expect = function (kind) {
    var token = this.peek();
    need(token.kind === kind, 'SYNTAX', 'Expected ' + kind, token);
    this.index++;
    return token;
  };
  Parser.prototype.value = function (depth) {
    var token = this.peek(), kind = token.kind, node;
    if (kind === 'number' || kind === 'string') { this.index++; return token; }
    need(kind === '{' || kind === '[' || (kind === 'identifier' && (token.value === 'param' || token.value === 'signal')),
      'VALUE_SYNTAX', 'Expected a literal, object, array, param or signal', token);
    need(depth < LIMITS.depth, 'DEPTH_LIMIT', 'Values exceed nesting depth 16', token);
    this.index++;
    node = { kind: kind === '{' ? 'object' : kind === '[' ? 'array' : 'reference', start: token.start };
    if (kind === '{') {
      node.fields = Object.create(null);
      if (this.peek().kind !== '}') {
        do {
          var key = this.peek();
          need(key.kind === 'identifier' || key.kind === 'string', 'SYNTAX', 'Expected an object key', key);
          this.index++;
          need(!own(node.fields, key.value), 'DUPLICATE_KEY', 'Duplicate key ' + nameText(key.value), key);
          this.expect(':');
          node.fields[key.value] = { key: key, value: this.value(depth + 1) };
        } while (this.take(','));
      }
      node.end = this.expect('}').end;
    } else {
      node.items = [];
      var end = kind === '[' ? ']' : ')';
      if (kind === 'identifier') { node.name = token.value; this.expect('('); }
      if (this.peek().kind !== end) {
        do { node.items.push(this.value(depth + 1)); } while (this.take(','));
      }
      node.end = this.expect(end).end;
    }
    return node;
  };
  Parser.prototype.parse = function () {
    var statements = [], counts = { visual: 0, control: 0, layer: 0 };
    while (this.peek().kind !== 'eof') {
      var token = this.expect('identifier'), name = token.value;
      need(own(counts, name), 'STATEMENT', 'Unknown statement ' + nameText(name), token);
      counts[name]++;
      if (name === 'visual') need(counts.visual === 1, 'DUPLICATE_VISUAL', 'Exactly one visual declaration is allowed', token);
      if (name === 'control') need(counts.control <= LIMITS.controls, 'CONTROL_LIMIT', 'At most 8 controls are allowed', token);
      if (name === 'layer') need(counts.layer <= LIMITS.layers, 'LAYER_LIMIT', 'At most 8 layers are allowed', token);
      this.expect('(');
      var label = null;
      if (name !== 'visual') { label = this.expect('string'); this.expect(','); }
      var value = this.value(0);
      this.expect(')');
      this.expect(';');
      statements.push({ name: name, label: label, value: value, start: token.start, end: value.end });
    }
    need(counts.visual === 1, 'MISSING_VISUAL', 'Exactly one visual declaration is required', this.peek());
    return statements;
  };

  function fields(node, allowed, required) {
    need(node.kind === 'object', 'TYPE', 'Expected an object', node);
    Object.keys(node.fields).forEach(function (key) {
      need(allowed.indexOf(key) !== -1, 'UNKNOWN_KEY', 'Unknown key ' + nameText(key), node.fields[key].key);
    });
    (required || []).forEach(function (key) {
      need(own(node.fields, key), 'MISSING_KEY', 'Missing required key ' + nameText(key), node);
    });
    return node.fields;
  }
  function number(node, min, max, integer) {
    need(node.kind === 'number', 'TYPE', 'Expected a static number', node);
    need(node.value >= min && node.value <= max && (!integer || Number.isInteger(node.value)), 'RANGE',
      'Expected ' + (integer ? 'an integer' : 'a number') + ' between ' + min + ' and ' + max, node);
    return node.value;
  }
  function string(node) {
    need(node.kind === 'string', 'TYPE', 'Expected a double-quoted string', node);
    return node.value;
  }
  function color(node) {
    var value = string(node);
    need(/^#[0-9a-fA-F]{6}$/.test(value), 'COLOR', 'Expected a six-digit hex color', node);
    return value;
  }
  function controlName(node) {
    var value = string(node);
    need(/^[a-z][a-z0-9_]{0,23}$/.test(value), 'CONTROL_NAME', 'Control names must match [a-z][a-z0-9_]{0,23}', node);
    return value;
  }
  function visual(node) {
    var f = fields(node, Object.keys(VISUAL_DEFAULTS));
    var result = { background: VISUAL_DEFAULTS.background, palette: VISUAL_DEFAULTS.palette.slice(),
      feedback: VISUAL_DEFAULTS.feedback, seed: VISUAL_DEFAULTS.seed };
    if (own(f, 'background')) result.background = color(f.background.value);
    if (own(f, 'palette')) {
      var palette = f.palette.value;
      need(palette.kind === 'array', 'TYPE', 'Palette must be an array', palette);
      need(palette.items.length >= LIMITS.paletteMin && palette.items.length <= LIMITS.paletteMax,
        'PALETTE_LIMIT', 'Palette must contain 2 to 8 colors', palette);
      result.palette = palette.items.map(color);
    }
    if (own(f, 'feedback')) result.feedback = number(f.feedback.value, 0, 0.95);
    if (own(f, 'seed')) result.seed = number(f.seed.value, 0, 65535, true);
    return result;
  }
  function control(statement) {
    var name = controlName(statement.label), f = fields(statement.value, CONTROL_KEYS, CONTROL_KEYS);
    var label = string(f.label.value), length = 0;
    for (var i = 0; i < label.length && length <= 40; i++, length++) if (paired(label, i)) i++;
    need(length >= 1 && length <= 40, 'CONTROL_LABEL', 'Control labels must contain 1 to 40 characters', f.label.value);
    var min = number(f.min.value, -16, 16), max = number(f.max.value, -16, 16);
    need(min < max, 'CONTROL_RANGE', 'Control min must be less than max', f.max.value);
    var step = number(f.step.value, 0, max - min);
    need(step > 0, 'CONTROL_STEP', 'Control step must be greater than zero', f.step.value);
    return { name: name, label: label, min: min, max: max, step: step, value: number(f.value.value, min, max) };
  }
  function dynamic(node, schema, controls) {
    if (node.kind === 'number') {
      // A literal is already resolved. Clamp it now; renderers clamp reference
      // results using this same schema after reading external control/signals.
      return Math.max(schema.min, Math.min(schema.max, node.value));
    }
    need(node.kind === 'reference', 'TYPE', 'Expected a number, param or signal', node);
    var args = node.items;
    if (node.name === 'param') {
      need(args.length === 1, 'ARITY', 'param expects one control name', node);
      var name = controlName(args[0]);
      need(own(controls, name), 'UNKNOWN_CONTROL', 'Unknown control ' + nameText(name), args[0]);
      return { type: 'param', name: name };
    }
    need(args.length >= 1 && args.length <= 3, 'ARITY', 'signal expects a name and optional scale, offset', node);
    var signal = string(args[0]);
    need(SIGNALS.indexOf(signal) !== -1, 'UNKNOWN_SIGNAL', 'Unknown signal ' + nameText(signal), args[0]);
    return { type: 'signal', name: signal, scale: args.length > 1 ? number(args[1], -16, 16) : 1,
      offset: args.length > 2 ? number(args[2], -16, 16) : 0 };
  }
  function layer(statement, controls) {
    var op = string(statement.label);
    need(OPERATIONS.indexOf(op) !== -1, 'OPERATION', 'Unknown layer operation ' + nameText(op), statement.label);
    var f = fields(statement.value, Object.keys(LAYER_SCHEMA)), result = { op: op };
    Object.keys(LAYER_SCHEMA).forEach(function (key) {
      var schema = LAYER_SCHEMA[key], node = own(f, key) ? f[key].value : null;
      if (!node) result[key] = schema.default;
      else if (schema.dynamic) result[key] = dynamic(node, schema, controls);
      else if (schema.values) {
        var value = string(node);
        need(schema.values.indexOf(value) !== -1, 'BLEND', 'Unknown blend ' + nameText(value), node);
        result[key] = value;
      } else result[key] = number(node, schema.min, schema.max, schema.integer);
    });
    return result;
  }
  function build(statements) {
    var result = { version: 1, visual: null, controls: [], layers: [] }, controls = Object.create(null), total = 0;
    // Resolve all declarations before references, while preserving layer order.
    statements.forEach(function (statement) {
      if (statement.name === 'visual') result.visual = visual(statement.value);
      if (statement.name === 'control') {
        var item = control(statement);
        need(!own(controls, item.name), 'DUPLICATE_CONTROL', 'Duplicate control ' + nameText(item.name), statement.label);
        controls[item.name] = item;
        result.controls.push(item);
      }
    });
    statements.forEach(function (statement) {
      if (statement.name !== 'layer') return;
      var item = layer(statement, controls);
      total += item.count;
      need(total <= LIMITS.totalCount, 'COUNT_LIMIT', 'The sum of layer counts must not exceed 512',
        own(statement.value.fields, 'count') ? statement.value.fields.count.value : statement.label);
      result.layers.push(item);
    });
    return freeze(result);
  }
  function compile(source) {
    try {
      need(typeof source === 'string', 'SOURCE_TYPE', 'Source must be a string');
      sourceBound(source);
      return { ok: true, program: build(new Parser(lex(source)).parse()), diagnostics: [] };
    } catch (error) {
      var known = error instanceof Failure, input = typeof source === 'string' ? source : '';
      return { ok: false, program: null, diagnostics: [{ severity: 'error',
        code: known ? error.code : 'INTERNAL', message: known ? error.message : 'Unable to compile visual source',
        span: { start: position(input, known ? error.start : 0), end: position(input, known ? error.end : 0) } }] };
    }
  }

  var PRESETS = freeze([
    {
      id: 'visual:neon-tunnel', label: 'Neon Tunnel',
      source: [
        '// Bass opens the tunnel; drums scatter bright sparks through its wake.',
        '// Remix the palette, swap the hit routes, or move a layer to the front.',
        'visual({',
        '  background: "#090615",',
        '  palette: ["#84f3d5", "#b089ff", "#ff729f", "#ffbf69"],',
        '  feedback: 0.86, seed: 17',
        '});',
        'control("motion", {label: "Motion", min: 0, max: 2, step: 0.01, value: 0.82});',
        'control("glow", {label: "Glow", min: 0, max: 1, step: 0.01, value: 0.72});',
        'control("twist", {label: "Twist", min: -2, max: 2, step: 0.01, value: 0.08});',
        '',
        '// Nested frames give the scene its depth.',
        'layer("tunnel", {',
        '  count: 32, size: 1.2, speed: param("motion"), spin: param("twist"),',
        '  spread: 0.85, hue: signal("lead.pitch", 2), opacity: param("glow"),',
        '  react: signal("bass.hit", 0.95), thickness: 1.5',
        '});',
        '// Broad, slow ribbons cross the tunnel with a soft screen blend.',
        'layer("ribbons", {',
        '  count: 5, size: 0.32, speed: -0.25, spin: 0.15, spread: 1.3,',
        '  hue: 2, opacity: 0.22, react: signal("audio.mid", 1.2),',
        '  thickness: 2, blend: "screen"',
        '});',
        'layer("sparks", {',
        '  count: 48, size: 0.02, speed: 0.6, spin: 0.2, spread: 1.4,',
        '  hue: signal("bar.phase", 4), opacity: param("glow"),',
        '  react: signal("drums.hit", 1.4), thickness: 0.75, blend: "lighter"',
        '});'
      ].join('\n')
    },
    {
      id: 'visual:pulse-grid', label: 'Pulse Grid',
      source: [
        '// A drum-driven tile field, bass ribbons, and lead accents.',
        'visual({',
        '  background: "#06121c",',
        '  palette: ["#40e0ff", "#ffe082", "#ff648d", "#9b8aff"],',
        '  feedback: 0.68, seed: 83',
        '});',
        'control("motion", {label: "Drift", min: -2, max: 2, step: 0.01, value: 0.25});',
        'control("cell", {label: "Tile size", min: 0.05, max: 0.6, step: 0.01, value: 0.28});',
        'control("glow", {label: "Glow", min: 0, max: 1, step: 0.01, value: 0.8});',
        '',
        '// Count changes the grid density; cell changes the space between tiles.',
        'layer("tiles", {',
        '  count: 64, size: param("cell"), speed: param("motion"), spread: 1.25,',
        '  hue: signal("beat.phase", 3), opacity: param("glow"),',
        '  react: signal("drums.hit", 1.7), thickness: 1.5',
        '});',
        'layer("ribbons", {',
        '  count: 6, size: 0.5, speed: -0.3, spin: signal("bass.pitch", 0.5, -0.25),',
        '  spread: 1.4, hue: 1, opacity: 0.3, react: signal("audio.bass", 1.1),',
        '  thickness: 2, blend: "screen"',
        '});',
        '// Swap lead.hit for counter.hit to move the bright accents to another lane.',
        'layer("sparks", {',
        '  count: 24, size: 0.04, speed: 0.9, spin: -0.4, spread: 1.2,',
        '  hue: 2, opacity: 0.7, react: signal("lead.hit", 1.2), blend: "lighter"',
        '});'
      ].join('\n')
    },
    {
      id: 'visual:orbit-loom', label: 'Orbit Loom',
      source: [
        '// Two counter-moving orbit fields weave through translucent ribbons.',
        'visual({',
        '  background: "#110d20",',
        '  palette: ["#ffd6a5", "#c8a7ff", "#76e6cc", "#ff8ba7"],',
        '  feedback: 0.9, seed: 211',
        '});',
        'control("motion", {label: "Orbit speed", min: -2, max: 2, step: 0.01, value: 0.4});',
        'control("twist", {label: "Weave", min: -2, max: 2, step: 0.01, value: 0.3});',
        'control("glow", {label: "Thread glow", min: 0, max: 1, step: 0.01, value: 0.65});',
        '',
        'layer("orbits", {',
        '  count: 18, size: 0.2, speed: param("motion"), spin: param("twist"),',
        '  spread: 1.3, hue: signal("lead.pitch", 3), opacity: param("glow"),',
        '  react: signal("lead.hit", 0.8), thickness: 2, blend: "lighter"',
        '});',
        '// Counter pitch bends the ribbons; the measured mid band widens them.',
        'layer("ribbons", {',
        '  count: 8, size: 0.6, speed: -0.35, spin: signal("counter.pitch", 0.6, -0.3),',
        '  spread: 1.1, hue: 1, opacity: 0.38, react: signal("audio.mid", 1.2),',
        '  thickness: 2, blend: "screen"',
        '});',
        '// A smaller reverse orbit makes the bass pulse visible inside the weave.',
        'layer("orbits", {',
        '  count: 9, size: 0.08, speed: -0.65, spin: -0.25, spread: 0.7,',
        '  hue: 2, opacity: param("glow"), react: signal("bass.hit", 0.9),',
        '  thickness: 1, blend: "lighter"',
        '});'
      ].join('\n')
    }
  ]);

  return freeze({ compile: compile, PRESETS: PRESETS, LIMITS: LIMITS,
    LAYER_SCHEMA: LAYER_SCHEMA, OPERATIONS: OPERATIONS, SIGNALS: SIGNALS,
    BLENDS: BLENDS, VISUAL_DEFAULTS: VISUAL_DEFAULTS });
});
