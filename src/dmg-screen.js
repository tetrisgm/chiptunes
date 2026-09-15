// The Game Boy panel, on screen.
//
// Runs the brickboy DMG display pipeline (vendored unmodified under
// lib/shaders/brickboy, Apache-2.0 -- see its NOTICE) over the 2D stage.
// src/slang-webgl.js translates the RetroArch slang dialect to GLSL ES 300 at
// load time; the six passes, their order, their constants and their 85 tuned
// parameters are the upstream project's work, derived from measurements of
// real hardware.
//
//   xtalk-field -> color-correct -> grid -> ghost -> defects -> finish
//
// One adaptation is unavoidable: the pipeline indexes in Game Boy pixels
// (BB_NATIVE 160x144, module 168x152 with the reflector margin) and uses
// texelFetch, so the stage is first downsampled to a native framebuffer.
// That is the honest reading of "make it a Game Boy screen" anyway.
(function (G) {
  'use strict';

  // ABSOLUTE. Relative, this resolved against whatever path the page happened
  // to be on: from /radio/ it became /radio/lib/shaders/... which the SPA
  // fallback answers with index.html and a 200. The fetch "succeeded", the
  // translator was handed HTML, load() rejected, and the runtime quietly
  // reverted to the normal view -- so the Game Boy screen simply never appeared
  // and nothing anywhere said why. Pass opts.base to serve from a sub-path.
  var DIR = '/lib/shaders/brickboy/';
  // A DMG is 160x144, but pinning the pipeline there squashes a widescreen
  // stage into a 10:9 buffer and destroys the art before the panel sees it.
  // Instead the CELL SIZE is fixed and the cell GRID follows the viewport, so
  // the dots stay Game-Boy-sized at any resolution and the aspect is preserved.
  // bb_panel.inc exists to hold exactly this geometry, so it is regenerated
  // rather than the .slang sources being edited.
  // 256x144 at 1440p: the Game Boy's own 144 rows. Fewer rows than this is not
  // "closer", it is smaller -- a 21-row maze at 103 rows gets 4.9px cells and
  // turns to noise. Vertical resolution is fixed by the hardware being imitated;
  // the thing that actually made the camera feel far away is WIDTH, since 16:9
  // shows 1.6x the world a 10:9 DMG does. That is solved per game by keeping the
  // playfield Game-Boy-shaped rather than stretching it across the screen.
  var CELL_PX = 10;           // output pixels per LCD cell
  var MARGIN_CELLS = 4;       // exposed reflector border, in cells (upstream: 4)

  // Upstream's defaults assume a 160x144 panel showing SPARSE Game Boy ink: a
  // few dark cells on a light field. Our playfields are dense solid masses, so
  // the crosstalk field -- which sums the darkness of up to 40 neighbouring
  // rows above and below -- runs much hotter than it was tuned for, and reads
  // as a shadow cast under every block and a phantom row above them. These are
  // the same knobs upstream exposes, eased off for the content we draw; set
  // `params` in the constructor to override.
  //
  // bb_density is NOT in here, and must not be: it is the physical contrast
  // wheel, and above 0.5 it mixes EVERY pixel toward the darkest shade. Raising
  // it to 0.62 in the hope of separating shades is what turned the whole panel
  // a flat olive. Shade separation is set by the art and the blit, never here.
  var ADAPTED = {
    bb_crosstalk:    0.20,   // upstream 0.34
    bb_xtalk_signed: 0.12,   // upstream 0.22
    bb_xtalk_edge:   0.24,   // upstream 0.40
    // Ghosting and bleed are authentic, but they were tuned for a panel whose
    // cells are far below the eye's resolution. Ours are 8 screen pixels, so the
    // same amount of smear spans visible distance and softens every edge the
    // art just gained -- sprites read as blurred blobs rather than pixels.
    bb_ghost_strength: 0.22, // upstream 0.52
    bb_bleed:          0.07, // upstream 0.16
    // Upstream renders the LCD mesh at 0.62 and pulls contrast to 0.88, which is
    // right for a 160x144 panel shown small: the mesh is below the eye's
    // resolution and reads as a soft wash. Ours is 8 SCREEN PIXELS per cell, so
    // a half-dissolved mesh does not soften -- it blurs neighbouring cells into
    // each other, and a one-cell border between two blocks disappears. Measured
    // on a dense block field (p92-p08 of column luminance, higher = more
    // separation): 0.62/0.88 -> 39, these values -> 55.
    bb_strength:     0.88,   // upstream 0.62
    bb_contrast:     1.00    // upstream 0.88
  };

  var BLIT_VS = '#version 300 es\nin vec2 p;out vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0,1);}';
  // The pass outputs live in framebuffer space (row 0 at the bottom) while the
// uploaded canvas has row 0 at the top, so the native buffer must be written
// flipped or `Original` and `PassOutput0` disagree by a flip -- which shows up
// as the image compositing against a mirrored copy of itself.
// A DMG draws dark ink on a light reflector; our stage draws bright sprites on
// a near-black field, so the downsample inverts luminance.
//
// It does NOT stretch. src/dmg-palette.js already snapped every colour the art
// sets onto four evenly spaced levels, and a second stretch here re-mapped them
// on top of that: with lo/hi = 0.02/0.55 the top half of the range clipped, so
// levels 0.68 and 1.00 both arrived as GB shade 3 and a block's fill became
// indistinguishable from its own outline. What is left to do is SNAP -- alpha
// compositing and gradients still land between levels -- onto the same four
// values color-correct.slang recovers shades from.
var BLIT_FS = '#version 300 es\nprecision highp float;in vec2 v;out vec4 o;uniform sampler2D t;\n' +
                'uniform float invert;uniform float lo;uniform float hi;\n' +
                'void main(){vec3 c=texture(t,vec2(v.x,1.0-v.y)).rgb;\n' +
                '  float l=dot(c,vec3(0.299,0.587,0.114));\n' +
                '  l=clamp((l-lo)/max(1e-4,hi-lo),0.0,1.0);\n' +
                '  l=mix(l,1.0-l,invert);\n' +
                '  l=floor(l*3.0+0.5)/3.0;\n' +
                '  o=vec4(vec3(l),1.0);}';

  function compile(gl, vs, fs, label) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(label + ': ' + gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    // the vendored passes name their vertex inputs Position / TexCoord
    gl.bindAttribLocation(p, 0, 'Position');
    gl.bindAttribLocation(p, 1, 'TexCoord');
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(label + ' link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  // Reporting EXT_color_buffer_float is not a promise that a half-float colour
  // attachment will actually be framebuffer-COMPLETE -- Safari in particular
  // hands back the extension and then refuses the attachment on some GPUs. An
  // incomplete framebuffer throws nothing: every pass renders into it happily
  // and the screen is simply black. So the status is checked, and a target that
  // will not complete as half-float is rebuilt as RGBA8.
  function makeTarget(gl, w, h, float) {
    function build(useFloat) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, useFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0,
                    gl.RGBA, useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(f); gl.deleteTexture(t); return null; }
      return { tex: t, fbo: f, w: w, h: h };
    }
    return (float && build(true)) || build(false);
  }

  function DmgScreen(source, opts) {
    opts = opts || {};
    this.source = source;
    this.base = opts.base || '';
    this.invert = opts.invert !== false;   // our art is light-on-dark; a DMG is not
    this.lo = opts.lo == null ? 0.0 : opts.lo;   // the palette hook already ranged it
    this.hi = opts.hi == null ? 1.0 : opts.hi;
    this.cellPx = opts.cellPx || CELL_PX;
    this.overrides = Object.assign({}, ADAPTED, opts.params || {});
    this.ready = false;
    this.frameCount = 0;
    this.cells = { w: 160, h: 144 };
    this._srcW = 0;
    this._srcH = 0;
    this.canvas = document.createElement('canvas');
    this._watchSize();
    this.canvas.id = 'dmg';
    this.canvas.className = 'crt';
    // A canvas is a REPLACED element: `inset:0` with width:auto resolves to the
    // INTRINSIC backing size, not the viewport, so the panel rendered at DPR
    // scale and overflowed. Explicit width/height pins it to the viewport while
    // the backing store stays at device resolution.
    this.canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;' +
      'z-index:6;pointer-events:none;display:none;';
    var gl = this.gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power'
    });
    this.ok = !!gl;
    if (!this.ok) return;
    // float framebuffers are required: the ghost feedback buffer IS the panel's
    // analog cell state, and 8 bits quantises the relaxation into visible steps.
    this.float = !!gl.getExtension('EXT_color_buffer_float');
  }

  DmgScreen.prototype.load = function () {
    var self = this, gl = this.gl, base = this.base + DIR;
    // A 200 is not proof the file arrived: an SPA fallback answers a missing
    // path with the app shell. Shader sources never begin with a tag, so that
    // is the tell, and it is worth saying out loud rather than failing as an
    // unrelated parse error three frames later.
    var get = function (f) {
      return fetch(base + f).then(function (r) {
        if (!r.ok) throw new Error('dmg: ' + r.status + ' fetching ' + base + f);
        return r.text();
      }).then(function (t) {
        if (/^\s*</.test(t)) throw new Error('dmg: ' + base + f + ' returned HTML, not a shader ' +
                                             '(a routing fallback is swallowing the path)');
        return t;
      });
    };
    return Promise.all([get('brickboy-dmg.slangp'), get('inc/bb_panel.inc')])
      .then(function (r) {
        var preset = G.CT_SLANG.parsePreset(r[0]);
        var includes = { 'bb_panel.inc': r[1] };
        self.preset = preset;
        return Promise.all(preset.passes.map(function (p) {
          return get(p.shader.replace('shaders/', '')).then(function (src) {
            var t = G.CT_SLANG.translate(src, { includes: includes });
            var params = t.params;
            for (var k in self.overrides) if (k in params) params[k] = self.overrides[k];
            return { def: p, source: src, prog: compile(gl, t.vertex, t.fragment, p.shader),
                     params: params };
          });
        }));
      })
      .then(function (passes) {
        self.passes = passes;
        self.blit = compile(gl, BLIT_VS, BLIT_FS, 'blit');
        var vao = self.vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        // Fullscreen triangle. Position and TexCoord need SEPARATE buffers: the
        // vendored vertex stage passes TexCoord straight through as UVs, so
        // feeding it clip-space coordinates samples far outside the texture.
        // UV v runs 0 at the TOP, matching RetroArch (finish.slang notes that
        // its vTexCoord is y-down).
        var posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        var uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        // y-UP, matching framebuffer space. RetroArch feeds these passes a y-DOWN
        // texcoord; with one, every pass output lands flipped against the buffer
        // it rendered into -- which nothing notices until color-correct.slang
        // reads Original (never flipped) and PassOutput0 (flipped once) at the
        // same coordinate and blends them. That composites the picture with a
        // vertical mirror of itself: every game drew as an X.
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 2,0, 0,2]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        self.srcTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, self.srcTex);
        [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
         [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]
          .forEach(function (kv) { gl.texParameteri(gl.TEXTURE_2D, kv[0], kv[1]); });
        return self.loadGrain();
      })
      .then(function () { self.ready = true; return self; });
  };

  DmgScreen.prototype.loadGrain = function () {
    var self = this, gl = this.gl;
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        self.grain = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, self.grain);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        resolve();
      };
      img.onerror = function () { self.grain = null; resolve(); };
      img.src = self.base + DIR + 'grain.png';
    });
  };

  DmgScreen.prototype.cellGrid = function (w, h) {
    var cw = Math.max(64, Math.min(512, Math.round(w / this.cellPx)));
    var ch = Math.max(64, Math.min(512, Math.round(h / this.cellPx)));
    return { w: cw, h: ch };
  };

  DmgScreen.prototype.panelInc = function (cells) {
    var mw = cells.w + MARGIN_CELLS * 2, mh = cells.h + MARGIN_CELLS * 2;
    return '#define BB_NATIVE  vec2(' + cells.w.toFixed(1) + ', ' + cells.h.toFixed(1) + ')\n' +
           '#define BB_MARGIN  ' + MARGIN_CELLS.toFixed(1) + '\n' +
           '#define BB_MODULE  vec2(' + mw.toFixed(1) + ', ' + mh.toFixed(1) + ')\n' +
           '#define BB_ACTIVE  vec4(BB_MARGIN / BB_MODULE.x, BB_MARGIN / BB_MODULE.y, ' +
           'BB_NATIVE.x / BB_MODULE.x, BB_NATIVE.y / BB_MODULE.y)\n';
  };

  DmgScreen.prototype.resize = function () {
    var gl = this.gl;
    // Output size comes from the VIEWPORT, not from the source. The source is
    // the Game Boy framebuffer and is deliberately tiny; sizing the panel to it
    // would render a 320x180 screen.
    // THE PANEL IS A SIMULATION OF A LOW-RESOLUTION SCREEN, so it does not
    // need a full Retina backing store: at DPR 2 a 1440p window is five
    // megapixels through the shader chain every frame, and this is the most
    // expensive thing the page does. 1.5 keeps the LCD grid and the scanlines
    // crisp and costs 44% fewer fragments than 2.
    // Nothing has moved since the last measurement, so do not ask the layout
    // engine again -- this runs on every frame and clientWidth is a forced
    // synchronous layout. _watchSize sets the flag when the box really changes.
    if (this._ro && !this._sizeDirty) return;
    this._sizeDirty = false;
    var dpr = Math.min(1.5, (G.devicePixelRatio || 1));
    // Keep the full-screen shader chain below roughly two million output
    // fragments per pass. Above that point the extra pixels are display
    // oversampling, not recoverable Game Boy detail, and Safari pays for all
    // of them on every pass.
    var maxPx = 2000000, px = (G.innerWidth || 1) * (G.innerHeight || 1) * dpr * dpr;
    if (px > maxPx) dpr *= Math.sqrt(maxPx / px);
    var w = Math.max(1, Math.round((this.canvas.clientWidth || G.innerWidth || 1) * dpr));
    var h = Math.max(1, Math.round((this.canvas.clientHeight || G.innerHeight || 1) * dpr));
    if (this.vw === w && this.vh === h) return;
    this.vw = w; this.vh = h;
    this.canvas.width = w; this.canvas.height = h;
    var self = this;
    // this.fb is sparse -- only the ghost pass keeps a feedback buffer, the rest
    // are null -- so the cleanup has to skip the holes or the FIRST resize after
    // startup throws on null.tex and the whole panel falls back to the CRT path.
    var drop = function (t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };
    (this.rts || []).forEach(drop);
    (this.fb || []).forEach(drop);
    var cells = this.cells = this.cellGrid(w, h);
    // The stage is asked to become EXACTLY this, so one canvas pixel is one LCD
    // cell and there is no downsample to survive. Point-sampling 8:1 threw away
    // 63 of every 64 pixels and picked the survivor arbitrarily, which is why a
    // one-pixel outline used to vanish and sprites broke up. A Game Boy game
    // draws 160x144 pixels and the panel shows those pixels; so does this.
    G.CT_DMG_NATIVE = { w: cells.w, h: cells.h };
    G.CT_DMG_CELL = 1;
    if (this.native) { gl.deleteTexture(this.native.tex); gl.deleteFramebuffer(this.native.fbo); }
    this.native = makeTarget(gl, cells.w, cells.h, false);
    gl.bindTexture(gl.TEXTURE_2D, this.native.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.rebuild(cells);
    this.rts = this.passes.map(function (p, i) {
      var isNative = p.def.scaleType === 'source' && i === 0;
      var pw = isNative ? cells.w : w, ph = isNative ? cells.h : h;
      return makeTarget(gl, pw, ph, p.def.float && self.float);
    });
    // ghost (pass 3) reads its own previous frame; give it a second buffer
    this.fb = this.passes.map(function (p, i) {
      return i === 3 ? makeTarget(gl, w, h, p.def.float && self.float) : null;
    });
  };

  // The grid pass bakes BB_NATIVE in at compile time, so a viewport change
  // means recompiling against the new geometry. Cheap and rare.
  DmgScreen.prototype.rebuild = function (cells) {
    if (this.builtFor && this.builtFor.w === cells.w && this.builtFor.h === cells.h) return;
    var gl = this.gl, inc = { 'bb_panel.inc': this.panelInc(cells) }, self = this;
    this.passes.forEach(function (p) {
      var t = G.CT_SLANG.translate(p.source, { includes: inc });
      if (p.prog) gl.deleteProgram(p.prog);
      p.prog = compile(gl, t.vertex, t.fragment, p.def.shader);
      // keep any parameter overrides the host has applied
      for (var k in t.params) if (!(k in p.params)) p.params[k] = t.params[k];
      for (var o in self.overrides) if (o in p.params) p.params[o] = self.overrides[o];
    });
    this.builtFor = { w: cells.w, h: cells.h };
  };

  // Hiding the stage before the panel has drawn a frame leaves a black screen
  // if the shaders are still loading or failed. The swap happens on the first
  // successful frame instead, so a broken pipeline degrades to the plain stage.

  // FREE THE PIPELINE YOU ARE NOT LOOKING AT.
  //
  // setMode(false) set display:none and freed nothing. The default screen
  // setting is "Random", which rolls between CRT, DMG and NES -- so within a
  // few minutes of an ordinary session the page is holding all three at full
  // backing resolution at once, and two of them are not on screen. At the
  // 2400x1500 these panels run at, that is on the order of 300MB of render
  // targets doing nothing, which on a memory-pressured Safari is not free
  // however idle it is.
  //
  // Sleeping drops every full-resolution target and shrinks the drawing buffer
  // to 1x1. The compiled programs and the parsed preset STAY: those are what is
  // expensive to rebuild, they are small, and a face that has been shown once
  // is likely to be shown again. vw/vh are cleared so resize() cannot take its
  // unchanged-viewport early return and rebuilds everything on the way back.
  DmgScreen.prototype.sleep = function () {
    if (this._asleep || !this.ok || !this.gl) return;
    this._asleep = true;
    var gl = this.gl;
    var drop = function (t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };
    (this.rts || []).forEach(drop);
    (this.fb || []).forEach(drop);
    drop(this.native); drop(this.rtIdx); drop(this.rtNtsc);
    this.rts = null; this.fb = null; this.native = null;
    this.rtIdx = null; this.rtNtsc = null;
    try { this.canvas.width = 1; this.canvas.height = 1; } catch (e) {}
    this.vw = this.vh = 0;
  };
  DmgScreen.prototype.wake = function () {
    if (!this._asleep) return;
    this._asleep = false;
    this._sizeDirty = true;
    this.vw = this.vh = -1;      // belt and braces: never take the early return
  };
  DmgScreen.prototype.setMode = function (on) {
    this.wanted = !!on;
    if (on) this.wake(); else this.sleep();
    // Turning the panel back on must force resize() to run again. Switching away
    // cleared the native size this panel publishes, and resize() returns early
    // when the viewport has not changed -- so on the way back the stage never
    // learned it was supposed to be a Game Boy framebuffer again, and the panel
    // sat at its 300x150 default showing the raw stage. Only dragging the window
    // could break the deadlock, and the screen control cycles modes, so this is
    // the ordinary path rather than a corner. Invalidating is the right lever
    // rather than republishing the cached grid: the viewport may genuinely have
    // changed while another panel had the screen. rebuild() skips recompiling
    // when the grid comes back the same, so this is cheap.
    if (on) { this.vw = this.vh = -1; return; }
    if (!on) {
      G.CT_DMG_CELL = 0; G.CT_DMG_NATIVE = null;
      this.canvas.style.display = 'none';
      this.source.style.visibility = '';
      return;
    }
    // Turning the panel ON does NOT show the canvas. It is opaque and covers the
    // viewport, so displaying it before anything has been rendered into it is a
    // black screen -- which is what you got in dmg mode until playback started
    // and the render loop produced a first frame. The stage was already gated on
    // that first frame; the canvas has to be gated on it too, or the two halves
    // of the swap disagree and the gap between them is black.
  };


  // UNIFORM LOCATIONS ARE LOOKED UP ONCE PER PROGRAM, NOT ONCE PER FRAME.
  // getUniformLocation is a synchronous driver query. This loop was running it
  // for MVP, three *Size vectors, FrameCount and EVERY preset parameter, on
  // every pass, on every frame -- hundreds of driver round-trips a frame for
  // answers that cannot change: a program's uniform layout is fixed when it
  // links. Cached against the program object, so it dies with it.
  DmgScreen.prototype._ul = function (prog, name) {
    var c = this._ulc || (this._ulc = new WeakMap());
    var m = c.get(prog);
    if (!m) { m = Object.create(null); c.set(prog, m); }
    var v = m[name];
    // `undefined` means not looked up yet; `null` is a real answer (no such
    // uniform, usually optimised out) and must be cached too, or every frame
    // re-asks the driver about the uniforms that do not exist.
    if (v === undefined) v = m[name] = this.gl.getUniformLocation(prog, name);
    return v;
  };
  // ...and the backing size is read on a real resize, not on every frame.
  // clientWidth/clientHeight force layout, and frame() called this 60 times a
  // second to be told the same number. A ResizeObserver covers every way the
  // box can change -- window resize, DPR change, and the --barh inset moving,
  // which a window-resize listener would have missed.
  DmgScreen.prototype._watchSize = function () {
    var self = this;
    this._sizeDirty = true;
    try {
      if (typeof ResizeObserver === 'undefined') return;   // fall back to reading every frame
      this._ro = new ResizeObserver(function () { self._sizeDirty = true; });
      this._ro.observe(this.canvas);
    } catch (e) { this._ro = null; }
  };
  DmgScreen.prototype.bind = function (prog, name, tex, unit) {
    var gl = this.gl, self = this, loc = self._ul(prog, name);
    if (!loc || !tex) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  DmgScreen.prototype.frame = function () {
    if (!this.ok || !this.ready) return;
    if (this._asleep) return;   // asleep: its targets are gone until setMode(true)
    var gl = this.gl, self = this;
    this.resize();
    var w = this.vw, h = this.vh;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);

    // stage -> native 160x144 Game Boy framebuffer
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // No flip on upload: canvas row 0 lands at v=0, which is what the vendored
    // passes expect (their vTexCoord is y-down, per finish.slang's note).
    // Allocate source storage only when the stage dimensions change. Reusing
    // it avoids driver allocation/synchronization work on every frame.
    var sw = Math.max(1, this.source.width|0), sh = Math.max(1, this.source.height|0);
    if (this._srcW !== sw || this._srcH !== sh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this._srcW = sw; this._srcH = sh;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.native.fbo);
    gl.viewport(0, 0, this.native.w, this.native.h);
    gl.useProgram(this.blit);
    gl.uniform1i(self._ul(this.blit, 't'), 0);
    gl.uniform1f(self._ul(this.blit, 'invert'), this.invert ? 1 : 0);
    gl.uniform1f(self._ul(this.blit, 'lo'), this.lo);
    gl.uniform1f(self._ul(this.blit, 'hi'), this.hi);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    var identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    var prevOut = this.native;
    for (var i = 0; i < this.passes.length; i++) {
      var pass = this.passes[i], prog = pass.prog, rt = this.rts[i];
      var last = i === this.passes.length - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : rt.fbo);
      gl.viewport(0, 0, last ? w : rt.w, last ? h : rt.h);
      gl.useProgram(prog);

      var mvp = self._ul(prog, 'MVP');
      if (mvp) gl.uniformMatrix4fv(mvp, false, identity);
      var setSize = function (name, tw, th) {
        var l = self._ul(prog, name);
        if (l) gl.uniform4f(l, tw, th, 1 / tw, 1 / th);
      };
      setSize('SourceSize', prevOut.w, prevOut.h);
      setSize('OriginalSize', this.native.w, this.native.h);
      setSize('OutputSize', last ? w : rt.w, last ? h : rt.h);
      var fc = self._ul(prog, 'FrameCount');
      if (fc) gl.uniform1ui(fc, this.frameCount >>> 0);
      // the upstream tuned defaults
      for (var k in pass.params) {
        var pl = self._ul(prog, k);
        if (pl) gl.uniform1f(pl, pass.params[k]);
      }

      this.bind(prog, 'Source', prevOut.tex, 0);
      this.bind(prog, 'Original', this.native.tex, 1);
      this.bind(prog, 'PassOutput0', this.rts[0].tex, 2);
      this.bind(prog, 'GrainTex', this.grain, 3);
      if (this.fb[i]) this.bind(prog, 'PassFeedback3', this.fb[i].tex, 4);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ghost: this frame's output becomes next frame's analog state
      if (this.fb[i]) { var t = this.rts[i]; this.rts[i] = this.fb[i]; this.fb[i] = t; prevOut = this.fb[i]; }
      else prevOut = rt;
    }
    this.frameCount++;

    // NOTE: there was a probe here that read back the centre of the frame and
    // treated an all-black result as proof the pipeline had failed. It was
    // guarding a black screen I never managed to reproduce, and it caused one:
    // readPixels on the default framebuffer returns zeros once the browser has
    // composited, so a perfectly healthy panel reported black, was marked dead,
    // and handed the screen back a frame after taking it. Removed. The
    // framebuffer-completeness check in makeTarget is the real guard, and that
    // one catches its failure at creation time where it can still be fixed.

    // One atomic swap, now that there is something to show: reveal the panel and
    // hide the stage in the same breath.
    if (this.wanted) {
      if (this.canvas.style.display !== 'block') this.canvas.style.display = 'block';
      if (this.source.style.visibility !== 'hidden') this.source.style.visibility = 'hidden';
    }
  };

  var API = { DmgScreen: DmgScreen, CELL_PX: CELL_PX };
  G.CT_DMG_SCREEN = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
