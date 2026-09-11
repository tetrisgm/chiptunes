// Bounded visual IR v1. No clock/transport ownership: the caller supplies one
// fresh clock.noteOns batch per render. Canvas resources live for this instance.
(function (G) {
  'use strict';
  var TAU = Math.PI * 2, MAX_DT = 0.1, MAX_ITEMS = 512, MAX_EVENTS = 64;
  // Floor on shedding. Below this a scene stops reading as itself, and the
  // right answer is a simpler program, not an emptier one.
  var MIN_QUALITY = 0.25;
  var own = Object.prototype.hasOwnProperty;
  var OPS = ['tunnel', 'tiles', 'orbits', 'ribbons', 'sparks'];
  var SIGNALS = ['audio.bass', 'audio.mid', 'audio.treble', 'audio.level',
    'beat.phase', 'bar.phase', 'lead.hit', 'lead.pitch', 'counter.hit',
    'counter.pitch', 'bass.hit', 'bass.pitch', 'drums.hit'];
  var PARAMS = {
    size: [0.5, 0.01, 2], speed: [0.5, -4, 4], spin: [0, -4, 4],
    spread: [0.7, 0, 2], hue: [0, -8, 8], opacity: [0.8, 0, 1],
    react: [0, 0, 2], thickness: [1, 0.25, 8]
  };
  var PARAM_NAMES = Object.keys(PARAMS);
  var DEFAULT_PALETTE = ['#84f3d5', '#b089ff', '#ffbf69'];

  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function unit(n) { return finite(n) ? clamp(n, 0, 1) : 0; }
  function fract(n) { return n - Math.floor(n); }
  function fail(message) { throw TypeError(message); }
  function message(error) {
    try { if (error && typeof error.message === 'string') return error.message.slice(0, 240); } catch (_) {}
    return 'Visual rendering failed';
  }
  function number(n, min, max, label) {
    if (!finite(n) || n < min || n > max) fail('Invalid ' + label);
    return n;
  }
  function integer(n, min, max, label) {
    number(n, min, max, label);
    if (!Number.isInteger(n)) fail('Invalid ' + label);
    return n;
  }
  function color(c) {
    if (typeof c !== 'string' || c.length !== 7 || !/^#[0-9a-f]{6}$/i.test(c)) fail('Invalid visual color');
    return c;
  }
  function controlName(n) {
    return typeof n === 'string' && n.length <= 24 && /^[a-z][a-z0-9_]{0,23}$/.test(n);
  }
  function validLabel(label) {
    if (typeof label !== 'string' || !label.length || label.length > 80) return false;
    var length = 0;
    for (var i = 0; i < label.length; i++, length++) {
      var a = label.charCodeAt(i), b = label.charCodeAt(i + 1);
      if (a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff) i++;
    }
    return length <= 40;
  }
  // Only bounded, own data fields are copied. Getters, inherited fields, exotic
  // prototypes, extra keys and sparse/decorated arrays are not compiled data.
  function record(input, keys, label) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid ' + label);
    var proto = Object.getPrototypeOf(input);
    if (proto !== null && proto !== Object.prototype) fail('Invalid ' + label + ' prototype');
    var names = Reflect.ownKeys(input), out = Object.create(null);
    if (names.length > keys.length) fail('Too many ' + label + ' fields');
    for (var i = 0; i < names.length; i++) {
      var key = names[i], d = Object.getOwnPropertyDescriptor(input, key);
      if (!keys.includes(key) || !d || !own.call(d, 'value')) fail('Invalid ' + label + ' field');
      out[key] = d.value;
    }
    return out;
  }
  function list(input, max, label) {
    if (!Array.isArray(input)) fail('Invalid ' + label);
    var length = Object.getOwnPropertyDescriptor(input, 'length').value;
    integer(length, 0, max, label + ' length');
    if (Reflect.ownKeys(input).length !== length + 1) fail('Invalid ' + label + ' entries');
    var out = [];
    for (var i = 0; i < length; i++) {
      var d = Object.getOwnPropertyDescriptor(input, String(i));
      if (!d || !own.call(d, 'value')) fail('Invalid ' + label + ' entry');
      out.push(d.value);
    }
    return out;
  }
  function fallback(object, key, value) { return own.call(object, key) ? object[key] : value; }
  function expression(value, controls) {
    if (finite(value)) return value;
    var ref = record(value, ['type', 'name', 'scale', 'offset'], 'reference');
    if (ref.type === 'param') {
      if (own.call(ref, 'scale') || own.call(ref, 'offset') || !controlName(ref.name) || !own.call(controls, ref.name))
        fail('Invalid parameter reference');
      return { type: 'param', name: ref.name };
    }
    if (ref.type !== 'signal' || !SIGNALS.includes(ref.name)) fail('Invalid signal reference');
    return { type: 'signal', name: ref.name,
      scale: number(fallback(ref, 'scale', 1), -16, 16, 'signal scale'),
      offset: number(fallback(ref, 'offset', 0), -16, 16, 'signal offset') };
  }
  function validate(input) {
    var p = record(input, ['version', 'visual', 'controls', 'layers'], 'program');
    if (p.version !== 1) fail('Unsupported visual program version');
    var v = record(p.visual, ['background', 'palette', 'feedback', 'seed'], 'visual');
    var palette = list(fallback(v, 'palette', DEFAULT_PALETTE), 8, 'palette');
    if (palette.length < 2) fail('Palette needs at least two colors');
    palette = palette.map(color);
    var visual = { background: color(fallback(v, 'background', '#090615')), palette: palette,
      feedback: number(fallback(v, 'feedback', 0.8), 0, 0.95, 'feedback'),
      seed: integer(fallback(v, 'seed', 1), 0, 65535, 'seed') };
    var controls = Object.create(null), declarations = list(p.controls, 8, 'controls');
    for (var i = 0; i < declarations.length; i++) {
      var c = record(declarations[i], ['name', 'label', 'min', 'max', 'step', 'value'], 'control');
      if (!controlName(c.name) || own.call(controls, c.name)) fail('Invalid or duplicate control name');
      if (!validLabel(c.label)) fail('Invalid control label');
      number(c.min, -16, 16, 'control minimum'); number(c.max, -16, 16, 'control maximum');
      if (c.min >= c.max || !finite(c.step) || c.step <= 0 || c.step > c.max - c.min) fail('Invalid control range or step');
      number(c.value, c.min, c.max, 'control value');
      controls[c.name] = c;
    }
    var layers = list(p.layers, 8, 'layers'), count = 0;
    layers = layers.map(function (input) {
      var l = record(input, ['op', 'count', 'blend'].concat(PARAM_NAMES), 'layer');
      if (!OPS.includes(l.op)) fail('Unknown visual operation');
      var layer = { op: l.op, count: integer(fallback(l, 'count', 24), 1, 128, 'layer count'),
        blend: fallback(l, 'blend', 'source-over') };
      if (!['source-over', 'lighter', 'screen'].includes(layer.blend)) fail('Invalid layer blend');
      count += layer.count;
      if (count > MAX_ITEMS) fail('Visual item limit exceeded');
      PARAM_NAMES.forEach(function (name) { layer[name] = expression(fallback(l, name, PARAMS[name][0]), controls); });
      return layer;
    });
    return { visual: visual, controls: controls, layers: layers, count: count,
      colors: palette.map(function (c) { var n = parseInt(c.slice(1), 16); return [n >>> 16, (n >>> 8) & 255, n & 255]; }) };
  }
  function hash(seed, item, salt) {
    var h = (seed ^ Math.imul(item + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function paint(colors, position) {
    var index = fract(position / colors.length) * colors.length;
    var a = colors[Math.floor(index)], b = colors[(Math.floor(index) + 1) % colors.length], mix = fract(index);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * mix) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * mix) + ',' + Math.round(a[2] + (b[2] - a[2]) * mix) + ')';
  }
  function saved(ctx, draw) { ctx.save(); try { draw(); } finally { ctx.restore(); } }
  // A primitive means a completed stroke, fill, rect, or image draw. Neon uses
  // two strokes of the same bounded path, never a blur/filter or extra surface.
  function neon(ctx, tint, alpha, width) {
    ctx.strokeStyle = tint; ctx.globalAlpha = alpha * 0.15; ctx.lineWidth = width * 3.5; ctx.stroke();
    ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke();
  }
  function polygon(ctx, x, y, radius, angle) {
    ctx.beginPath();
    for (var k = 0; k < 4; k++) {
      var a = angle + k * TAU / 4, px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
      if (!k) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function tunnel(ctx, p, env) {
    var t = env.phase, s = env.small, turn = t * p.spin * 0.22;
    var cx = env.width / 2 + Math.sin(t * p.speed * 0.17) * s * 0.12 * p.spread;
    var cy = env.height / 2 + Math.cos(t * p.speed * 0.13) * s * 0.08 * p.spread;
    for (var i = 0; i < p.count; i++) {
      var depth = fract(i / p.count + t * p.speed * 0.14), scale = Math.pow(depth, 2.1);
      var r = s * (0.012 + scale * 1.6 * p.size) * (1 + p.react * 0.22);
      var angle = Math.PI / 4 + turn + (1 - depth) * p.spread * 0.9;
      var alpha = p.opacity * Math.sin(depth * Math.PI) * (0.35 + depth * 0.65);
      var tint = paint(env.colors, i * 0.16 + p.hue + depth * 1.3);
      polygon(ctx, cx, cy, r, angle);
      neon(ctx, tint, alpha, p.thickness * (0.45 + depth * 1.5));
      // Two short perspective rails share one path: three primitives/item.
      var farther = Math.max(0, depth - 1 / p.count);
      var r2 = s * (0.012 + Math.pow(farther, 2.1) * 1.6 * p.size) * (1 + p.react * 0.22);
      var a2 = Math.PI / 4 + turn + (1 - farther) * p.spread * 0.9;
      ctx.beginPath();
      for (var k = 0; k < 2; k++) {
        var offset = k * Math.PI;
        ctx.moveTo(cx + Math.cos(angle + offset) * r, cy + Math.sin(angle + offset) * r);
        ctx.lineTo(cx + Math.cos(a2 + offset) * r2, cy + Math.sin(a2 + offset) * r2);
      }
      ctx.globalAlpha = alpha * 0.32; ctx.lineWidth = p.thickness * 0.6; ctx.stroke();
    }
  }
  function tiles(ctx, p, env) {
    var cols = Math.min(p.count, Math.max(1, Math.ceil(Math.sqrt(p.count * env.width / env.height))));
    var rows = Math.ceil(p.count / cols), cell = Math.min(env.width / cols, env.height / rows) * (0.45 + p.spread);
    ctx.translate(env.width / 2, env.height / 2); ctx.rotate(env.phase * p.spin * 0.08);
    for (var i = 0; i < p.count; i++) {
      var x = (i % cols - (cols - 1) / 2) * cell, y = (Math.floor(i / cols) - (rows - 1) / 2) * cell;
      var wave = 0.5 + 0.5 * Math.sin(Math.hypot(x, y) / Math.max(1, cell) * 0.85 - env.phase * p.speed * 2.2);
      var d = Math.max(0.5, cell * 0.58 * p.size * (0.55 + wave * 0.45 + p.react * 0.35));
      var left = Math.round(x - d / 2), top = Math.round(y - d / 2);
      var tint = paint(env.colors, i / cols + wave + p.hue);
      ctx.fillStyle = tint; ctx.globalAlpha = p.opacity * (0.08 + wave * 0.18);
      ctx.fillRect(left, top, d, d);
      ctx.strokeStyle = tint; ctx.lineWidth = p.thickness; ctx.globalAlpha = p.opacity * (0.22 + wave * 0.7);
      ctx.strokeRect(left, top, d, d);
      ctx.fillStyle = '#f0fcff'; ctx.globalAlpha = p.opacity * wave * 0.7;
      var dot = Math.max(0.5, Math.min(d / 3, p.thickness * (1.5 + p.react)));
      ctx.fillRect(left, top, dot, dot);
    }
  }
  function orbits(ctx, p, env) {
    for (var i = 0; i < p.count; i++) {
      var h = hash(env.seed, i, env.layer), u = (i + 0.5) / p.count;
      var turn = env.phase * p.spin * 0.16 + h * Math.PI;
      var angle = env.phase * p.speed * (0.45 + h) + u * TAU;
      var rx = env.small * (0.1 + u * 0.52 * p.spread) * (0.35 + p.size) * (1 + p.react * 0.18);
      var ry = rx * (0.28 + h * 0.5);
      var cx = env.width / 2 + Math.cos(h * TAU) * env.small * p.spread * 0.08;
      var cy = env.height / 2 + Math.sin(h * TAU) * env.small * p.spread * 0.08;
      var tint = paint(env.colors, u * env.colors.length + p.hue);
      ctx.strokeStyle = tint; ctx.lineWidth = p.thickness * 0.5; ctx.globalAlpha = p.opacity * 0.1;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, turn, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, turn, angle - 0.6 - p.react * 0.5, angle);
      neon(ctx, tint, p.opacity * (0.5 + h * 0.5), p.thickness);
      var x = rx * Math.cos(angle), y = ry * Math.sin(angle);
      ctx.globalAlpha = p.opacity; ctx.fillStyle = '#edffff'; ctx.beginPath();
      ctx.arc(cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn),
        Math.max(0.5, p.thickness * (1.25 + p.react)), 0, TAU); ctx.fill();
    }
  }
  function ribbons(ctx, p, env) {
    var w = env.width, h = env.height, t = env.phase * p.speed;
    ctx.translate(w / 2, h / 2); ctx.rotate(Math.sin(env.phase * 0.13) * p.spin * 0.24); ctx.translate(-w / 2, -h / 2);
    for (var i = 0; i < p.count; i++) {
      var u = (i + 0.5) / p.count, salt = hash(env.seed, i, env.layer);
      var y = h * (0.5 + (u - 0.5) * p.spread * 1.2);
      var amplitude = h * 0.3 * p.size * (0.45 + p.react * 0.4);
      var a = Math.sin(t * 0.73 + u * 4.5), b = Math.cos(t * 0.61 + u * 3.4 + salt * 0.25);
      var tint = paint(env.colors, u * env.colors.length + p.hue + Math.sin(t * 0.1) * 0.3);
      ctx.beginPath(); ctx.moveTo(-w * 0.12, y + a * amplitude);
      ctx.bezierCurveTo(w * 0.1, y - b * amplitude * 1.6, w * 0.32, y + a * amplitude * 1.7, w * 0.5, y);
      ctx.bezierCurveTo(w * 0.7, y - a * amplitude * 1.7, w * 0.88, y + b * amplitude * 1.6, w * 1.12, y - a * amplitude);
      neon(ctx, tint, p.opacity * (0.35 + 0.65 * Math.sin(u * Math.PI)), p.thickness * (0.6 + p.size));
    }
  }
  function sparks(ctx, p, env) {
    var t = env.phase;
    for (var i = 0; i < p.count; i++) {
      var salt = hash(env.seed, i, env.layer), jitter = hash(env.seed, i, env.layer + 19);
      var life = fract(salt + t * p.speed * (0.11 + jitter * 0.1));
      var angle = jitter * TAU + t * p.spin * 0.2 + life * p.spin * 0.35;
      var radius = env.small * Math.pow(life, 0.8) * (0.15 + p.spread * 0.8) * (1 + p.react * 0.3);
      var cx = env.width / 2, cy = env.height / 2;
      var x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
      var trail = env.small * (0.008 + life * 0.04) * p.size * (0.3 + Math.abs(p.speed));
      var alpha = p.opacity * Math.sin(life * Math.PI) * (0.4 + jitter * 0.6);
      var tint = paint(env.colors, jitter * env.colors.length + life + p.hue);
      ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * trail, y - Math.sin(angle) * trail); ctx.lineTo(x, y);
      neon(ctx, tint, alpha, p.thickness * (0.5 + p.size * 0.4));
      var size = Math.max(0.5, (1 + p.size * 2) * (0.5 + jitter) * (1 + p.react * 0.5));
      ctx.fillStyle = '#f0fcff'; ctx.globalAlpha = alpha; ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    }
  }
  var DRAW = { tunnel: tunnel, tiles: tiles, orbits: orbits, ribbons: ribbons, sparks: sparks };

  function create(options) {
    options = options || {};
    if (typeof options.createCanvas !== 'function') fail('createCanvas is required');
    var width = finite(options.width) ? clamp(Math.floor(options.width), 1, 960) : 960;
    var height = finite(options.height) ? clamp(Math.floor(options.height), 1, 540) : 540;
    var front = options.createCanvas(width, height), back = options.createCanvas(width, height);
    if (!front || !back || front === back) fail('createCanvas must return two distinct canvases');
    front.width = back.width = width; front.height = back.height = height;
    var frontCtx = front.getContext('2d'), backCtx = back.getContext('2d');
    if (!frontCtx || !backCtx || frontCtx === backCtx) fail('Two distinct 2D contexts are required');
    var program = null, values = Object.create(null), signals = Object.create(null);
    var phase = 0, frameCount = 0, renderErrors = 0, error = null, lastTime = null, lastIdentity = null;
    var wasPaused = true, hasFrame = false, feedbackValid = false, dirty = true, dt = 0;
    // The renderer owns no clock and no ambient services, so it cannot measure
    // its own cost. The host measures frame cost and hands back a quality
    // level; this module only spends it. MIN_QUALITY keeps a shed frame
    // recognisable instead of degenerating to one item per layer.
    var quality = 1, drawnItems = 0;
    var acknowledgedGrid = { gstep: 0, phase: 0, bar: 0, bpm: 120 };
    SIGNALS.forEach(function (name) { signals[name] = 0; });

    // Invalid Apply throws before any renderer state changes; the stage owns
    // draft diagnostics. Rendering failures are instead recoverable results.
    // Explicit values win; otherwise matching saved controls survive an Apply.
    function apply(input, suppliedValues) {
      var next = validate(input), names = Object.keys(next.controls);
      var supplied = suppliedValues === undefined ? Object.create(null) : record(suppliedValues, names, 'control values');
      var nextValues = Object.create(null);
      names.forEach(function (name) {
        var c = next.controls[name], value = own.call(supplied, name) ? supplied[name] :
          own.call(values, name) ? values[name] : c.value;
        if (!finite(value)) fail('Invalid saved control value');
        nextValues[name] = clamp(value, c.min, c.max);
      });
      program = next; values = nextValues; dirty = true;
      return { ok: true, error: null };
    }
    function setControl(name, value) {
      if (!controlName(name) || !program || !own.call(program.controls, name) || !finite(value))
        return { ok: false, error: 'Invalid control or value' };
      var c = program.controls[name], next = clamp(value, c.min, c.max);
      if (values[name] !== next) { values[name] = next; dirty = true; }
      return { ok: true, value: next, error: null };
    }
    function resolve(layer) {
      // Shedding lever: every draw operation loops over p.count, so scaling it
      // reduces real drawn work rather than merely reporting a lower quality.
      // At least one item per layer always survives, so a shed frame is still
      // the same composition, thinner — never a blank stage.
      var p = { count: Math.max(1, Math.round(layer.count * quality)) };
      PARAM_NAMES.forEach(function (name) {
        var ref = layer[name], v = typeof ref === 'number' ? ref :
          ref.type === 'param' ? values[ref.name] : signals[ref.name] * ref.scale + ref.offset;
        p[name] = clamp(v, PARAMS[name][1], PARAMS[name][2]);
      });
      return p;
    }
    function updateSignals(clock, grid, paused) {
      // Positive executed events alone trigger role envelopes. Unknown raw MIDI
      // never overwrites the last known pitch, and semantic role summaries are
      // deliberately not an onset source. No event ids/history are retained.
      var roles = ['lead', 'counter', 'bass', 'drums'];
      for (var i = 0; i < roles.length; i++) {
        var key = roles[i] + '.hit', hit = signals[key] * Math.exp(-dt * (roles[i] === 'bass' ? 5 : 8));
        signals[key] = hit < 0.00001 ? 0 : hit;
      }
      var notes = clock.noteOns;
      if (!paused && Array.isArray(notes)) {
        for (var i = 0, n = Math.min(MAX_EVENTS, notes.length); i < n; i++) {
          var event = notes[i];
          if (!event || typeof event !== 'object') continue;
          if (event.kind !== undefined && !['noteOn', 'sample', 'register'].includes(event.kind)) continue;
          var role = event.role, strength = finite(event.strength) ? event.strength : event.mag;
          if (role === 'perc' || role === 'noise') role = 'drums';
          if (!roles.includes(role) || !finite(strength) || strength <= 0) continue;
          signals[role + '.hit'] = Math.max(signals[role + '.hit'], unit(strength));
          if (role !== 'drums' && event.kind !== 'register' && event.kind !== 'sample' && finite(event.midi))
            signals[role + '.pitch'] = unit((event.midi - 24) / 84);
        }
      }
      var analysis = clock.analysis, measured = !paused && analysis && analysis.available === true;
      var bands = measured && analysis.bands || {};
      signals['audio.bass'] = unit(bands.bass); signals['audio.mid'] = unit(bands.mid); signals['audio.treble'] = unit(bands.treble);
      signals['audio.level'] = measured ? unit(analysis.rms) : 0;
      var step = finite(grid.gstep) && grid.gstep >= 0 ? Math.floor(grid.gstep) : 0;
      var fraction = unit(grid.phase);
      acknowledgedGrid.gstep = step; acknowledgedGrid.phase = fraction;
      acknowledgedGrid.bar = finite(grid.bar) && grid.bar >= 0 ? Math.floor(grid.bar) : Math.floor(step / 16);
      acknowledgedGrid.bpm = finite(grid.bpm) && grid.bpm > 0 ? clamp(grid.bpm, 1, 1000) : 120;
      signals['beat.phase'] = ((step % 4) + fraction) / 4;
      signals['bar.phase'] = ((step % 16) + fraction) / 16;
    }
    function render(input) {
      try {
        input = input || {};
        var time = finite(input.contextTime) && input.contextTime >= 0 ? input.contextTime : null;
        // Identity is a caller-owned scalar token, never coerced/stringified.
        // Retaining arbitrary objects here could pin an unbounded transport graph.
        var id = input.identity;
        if (!(id == null || typeof id === 'string' && id.length <= 256 || finite(id))) fail('Invalid visual transport identity');
        id = id == null ? null : id;
        var paused = input.paused === true, clock = input.clock || {}, grid = input.grid || {};
        // Clamped rather than rejected: a bad quality hint must never turn into
        // a render failure that blanks the stage.
        quality = finite(input.quality) ? clamp(input.quality, MIN_QUALITY, 1) : 1;
        dt = !paused && !wasPaused && id === lastIdentity && time !== null && lastTime !== null ? clamp(time - lastTime, 0, MAX_DT) : 0;
        lastTime = time; lastIdentity = id; wasPaused = paused;
        // At most 100 ms of visual catch-up; a backwards/invalid clock only
        // reanchors. Pause/unfreeze do not replay elapsed wall time or events.
        phase = (phase + dt) % 1048576;
        updateSignals(clock, grid, paused);
        if (paused && hasFrame && !dirty && !error) return { canvas: front, error: null };
        if (!program) return { canvas: front, error: null };
        if (front.width !== width || front.height !== height || back.width !== width || back.height !== height)
          fail('Visual canvas dimensions changed externally');
        var env = { phase: phase, width: width, height: height, small: Math.min(width, height),
          colors: program.colors, seed: program.visual.seed, layer: 0 };
        saved(backCtx, function () {
          backCtx.setTransform(1, 0, 0, 1, 0, 0); backCtx.globalCompositeOperation = 'source-over';
          backCtx.globalAlpha = 1; backCtx.shadowBlur = 0; backCtx.lineCap = 'round'; backCtx.lineJoin = 'round';
          backCtx.fillStyle = program.visual.background; backCtx.fillRect(0, 0, width, height);
          if (feedbackValid && program.visual.feedback > 0) {
            // A small outward drift gives motion real trails without allocating
            // histories, gradients, patterns, images, or per-particle resources.
            var zoom = 1 + dt * (0.035 + signals['bass.hit'] * 0.025);
            backCtx.globalAlpha = Math.pow(program.visual.feedback, Math.max(dt, 1 / 60) * 60);
            backCtx.drawImage(front, (width - width * zoom) / 2, (height - height * zoom) / 2, width * zoom, height * zoom);
          }
          drawnItems = 0;
          program.layers.forEach(function (layer, index) {
            var p = resolve(layer); env.layer = index;
            drawnItems += p.count;
            if (p.opacity === 0) return;
            saved(backCtx, function () {
              backCtx.globalCompositeOperation = layer.blend;
              DRAW[layer.op](backCtx, p, env);
            });
          });
        });
        var swap = front; front = back; back = swap;
        swap = frontCtx; frontCtx = backCtx; backCtx = swap;
        hasFrame = feedbackValid = true; dirty = false; error = null;
        frameCount = Math.min(Number.MAX_SAFE_INTEGER, frameCount + 1);
        return { canvas: front, error: null };
      } catch (e) {
        error = message(e); renderErrors = Math.min(Number.MAX_SAFE_INTEGER, renderErrors + 1);
        return { canvas: front, error: error };
      }
    }
    function reset() {
      phase = 0; dt = 0; lastTime = null; lastIdentity = null; wasPaused = true;
      SIGNALS.forEach(function (name) { signals[name] = 0; });
      // Invalidate feedback; leave the published pixels intact until the next
      // complete draw, so even a draw failure just after Reset keeps last-good.
      feedbackValid = false; dirty = true; error = null;
      return snapshot();
    }
    function snapshot() {
      return { values: Object.assign({}, values), phase: phase, frames: frameCount,
        canvasCount: 2, width: width, height: height, error: error, renderErrors: renderErrors,
        dt: dt, signals: Object.assign({}, signals), grid: Object.assign({}, acknowledgedGrid), layers: program ? program.layers.length : 0,
        items: program ? program.count : 0, hasFrame: hasFrame,
        quality: quality, drawnItems: drawnItems };
    }
    return Object.freeze({ apply: apply, setControl: setControl, render: render, reset: reset, snapshot: snapshot });
  }
  var api = Object.freeze({ create: create }); G.CT_VISUAL_RENDERER = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
