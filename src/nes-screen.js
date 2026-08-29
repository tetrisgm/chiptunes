// The NES picture, on screen.
//
// A Game Boy's display is a panel you can photograph, so src/dmg-screen.js runs
// a measured model of one. An NES has no display at all -- it has a modulator,
// and what you remember seeing is a composite signal being decoded badly by a
// television. So the equivalent job here is not to filter the image, it is to
// TRANSMIT it and receive it back.
//
//   stage -> palette index -> composite waveform -> NTSC decode -> CRT
//
// Everything that makes an NES look like an NES lives in that round trip:
//
// - Chroma is carried on a subcarrier at a quarter of the luma bandwidth, so
//   colour smears sideways across several pixels while edges stay sharp. That
//   asymmetry is the single most recognisable thing about the format.
// - Each scanline starts four phase steps later than the one above it, so the
//   residual subcarrier that leaks into luma marches diagonally: dot crawl.
// - Colours the palette does not contain appear anyway at high-contrast edges,
//   because the decoder cannot tell a fast luma transition from chroma. Games
//   used this on purpose.
//
// None of it is added afterwards as an effect. It falls out of decoding the
// waveform src/nes-signal.js generates, which scripts/verify-nes-ntsc.js checks
// against a real 2C02.
(function (G) {
  'use strict';

  var SIG = G.CT_NES_SIGNAL;

  // An NES frame is 256x240. As with the Game Boy panel the CELL SIZE is fixed
  // and the grid follows the viewport, so pixels stay NES-sized at any
  // resolution and a 16:9 stage shows more world rather than a squashed one.
  // 6 output pixels per NES pixel puts a 1440p viewport at 240 rows -- the
  // console's own vertical resolution.
  //
  // Square cells, deliberately. Real hardware has an 8:7 pixel aspect, so a
  // faithful panel would be 8/7 wider than tall per pixel; applying it here
  // would resample every column on a display whose pixels are square, trading
  // the sharpness this whole pipeline exists to preserve for a stretch nobody
  // asked about. The Game Boy panel makes the same choice for the same reason.
  var CELL_PX = 6;

  var VS = '#version 300 es\nin vec2 p;out vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0,1);}';

  // --- pass 1: the picture, as palette indices ------------------------------
  // The canvas is 8-bit RGB and its edges are antialiased, so an exact lookup
  // would miss every stroke. Nearest of 64 always resolves, and because
  // nes-palette.js has already snapped the art to entries that ARE in the
  // table, interior pixels land exactly.
  var IDX_FS = '#version 300 es\nprecision highp float;in vec2 v;out vec4 o;\n' +
    'uniform sampler2D src;uniform sampler2D pal;\n' +
    'void main(){vec3 c=texture(src,vec2(v.x,1.0-v.y)).rgb;\n' +
    '  float best=1e9;int bi=0;\n' +
    '  for(int i=0;i<64;i++){vec3 p=texelFetch(pal,ivec2(i,0),0).rgb;\n' +
    '    vec3 d=p-c;float e=dot(d,d);if(e<best){best=e;bi=i;}}\n' +
    '  o=vec4(float(bi)/255.0,0,0,1);}';

  // --- pass 2: transmit and receive -----------------------------------------
  // Signal levels and the two decoder constants are the SAME numbers
  // nes-signal.js carries. If they ever diverge the on-screen colours stop
  // matching the colours the art was quantised to, which is invisible in code
  // and obvious on screen; the constants are injected from that module at
  // compile time rather than written twice.
  function ntscFs(phase, sat, atten, levels) {
    return '#version 300 es\nprecision highp float;in vec2 v;out vec4 o;\n' +
    'uniform sampler2D idx;uniform vec2 srcSize;uniform int frame;uniform int emph;\n' +
        'const float LEV[8]=float[8](' + levels.map(function (x) { return x.toFixed(4); }).join(',') + ');\n' +
    'const float PH=' + phase.toFixed(4) + ';const float SAT=' + sat.toFixed(4) + ';\n' +
    'const float AT=' + atten.toFixed(4) + ';\n' +
    'bool inph(int hue,int p){return ((hue+p)%12)<6;}\n' +
    // one pixel's composite level at absolute phase p
    'float lvl(int id,int p){int hue=id&15;int lum=(id>>4)&3;p=((p%12)+12)%12;\n' +
    '  bool hi; if(hue==0) hi=true; else if(hue>=13) hi=false; else hi=inph(hue,p);\n' +
    '  float s=hi?LEV[4+lum]:LEV[lum];\n' +
    '  if(emph>0){ if((emph&1)!=0&&inph(12,p))s*=AT; if((emph&2)!=0&&inph(4,p))s*=AT;\n' +
    '              if((emph&4)!=0&&inph(8,p))s*=AT; }\n' +
    '  return s;}\n' +
    'void main(){\n' +
    // v.y runs 0 at the BOTTOM of the framebuffer, and pass 1 already wrote the
    // index texture the same way up (it sampled the canvas with 1.0-v.y), so
    // reading it back at 1.0-v.y flips the picture a second time. The CRT pass
    // and the default framebuffer are both y-up too, so that flip survives all
    // the way to the screen: every game draws upside down. This is the same
    // mistake, in the same place, that mirrored the Game Boy panel -- reasoning
    // about the geometry is what gets it wrong, drawing one asymmetric frame is
    // what catches it.
    '  float fx=v.x*srcSize.x;\n' +
    '  int row=clamp(int(floor(v.y*srcSize.y)),0,int(srcSize.y)-1);\n' +
    // The scanline phase offset counts from the TOP of the picture, which is the
    // far end of the framebuffer, so dot crawl leans the way it does on hardware.
    '  int line=int(srcSize.y)-1-row;\n' +
    // Five index fetches cover the whole filter window: a window of +/-12 phase
    // steps spans three NES pixels, and every step inside a pixel shares its
    // index. Fetching per STEP instead cost 25 texture reads for the same five
    // answers.
    '  int c0=int(floor(fx));\n' +
    '  int ids[5];\n' +
    '  for(int k=0;k<5;k++){int c=clamp(c0+k-2,0,int(srcSize.x)-1);\n' +
    '    ids[k]=int(texelFetch(idx,ivec2(c,row),0).r*255.0+0.5);}\n' +
    // Each scanline begins four phase steps after the one above (341 dots x 8
    // steps, mod 12) and the frame advances it again. This single line is the
    // whole of dot crawl: it moves the residual subcarrier diagonally, which is
    // why the pattern repeats every three rows and creeps between frames.
    '  int rowPhase=line*4+frame*8;\n' +
    '  int S0=int(floor(fx*8.0));\n' +
    '  float y=0.0,i=0.0,q=0.0,wy=0.0,wc=0.0;\n' +
    '  for(int j=-12;j<=12;j++){\n' +
    '    int S=S0+j; int c=S>>3; int k=clamp(c-c0+2,0,4);\n' +
    '    int A=S+rowPhase;\n' +
    '    float s=lvl(ids[k],A);\n' +
    '    int aj=abs(j);\n' +
    // Luma integrates over exactly ONE subcarrier cycle and chroma over two,
    // with half weight on the end samples so each window is a whole number of
    // periods. That is not a detail -- it is the difference between a picture
    // and a strobe. A Gaussian window of comparable width leaves the subcarrier
    // only partly cancelled, and the residual rides on luma: measured, a flat
    // field of a saturated colour then swings 123/255 as the sub-pixel phase
    // walks, so every solid area shimmers. Over a whole period the sum is zero
    // by construction, and a flat field of any of the 64 entries decodes to
    // EXACTLY its palette colour at every phase (verified, 0.00/255).
    //
    // Dot crawl and artifact colour still appear, and appear where they should:
    // at edges, where the window straddles two colours and the cancellation no
    // longer applies. That is also where a real set shows them.
    '    float a=aj<6?1.0:(aj==6?0.5:0.0);\n' +
    '    float b=aj<12?1.0:(aj==12?0.5:0.0);\n' +
    '    float th=6.28318530718*(float(A)+PH)/12.0;\n' +
    '    y+=s*a; wy+=a;\n' +
    '    i+=s*cos(th)*b; q+=s*sin(th)*b; wc+=b;\n' +
    '  }\n' +
    '  y/=wy; i=i/wc*2.0*SAT; q=q/wc*2.0*SAT;\n' +
    '  vec3 rgb=vec3(y+0.956*i+0.621*q, y-0.272*i-0.647*q, y-1.106*i+1.703*q);\n' +
    '  o=vec4(clamp(rgb,0.0,1.0),1.0);}';
  }

  // --- pass 3: the set ------------------------------------------------------
  // Aperture grille, scanlines whose beam widens where the picture is bright,
  // bloom, and a vignette. The beam-width term is what stops scanlines reading
  // as a grid laid over the image: on a real tube a bright line spills into the
  // gap and a dark one does not, so the lines DISAPPEAR in highlights, which is
  // exactly where a uniform overlay looks most obviously fake.
  var CRT_FS = '#version 300 es\nprecision highp float;in vec2 v;out vec4 o;\n' +
    'uniform sampler2D src;uniform vec2 outSize;uniform vec2 srcSize;\n' +
    'uniform float scan;uniform float mask;uniform float bloom;uniform float vig;\n' +
    'uniform float gamma;uniform float bright;\n' +
    'vec3 samp(vec2 uv){return texture(src,uv).rgb;}\n' +
    'void main(){\n' +
    '  vec2 uv=v;\n' +
    '  vec3 c=samp(uv);\n' +
    // Bloom: a wide, cheap horizontal-plus-vertical spread. Phosphor glow is
    // mostly what makes an NES photograph look warm rather than clinical.
    '  vec3 bl=vec3(0.0);float bw=0.0;\n' +
    '  for(int k=-4;k<=4;k++){float t=float(k);float w=exp(-t*t/8.0);\n' +
    '    bl+=samp(uv+vec2(t*2.5/outSize.x,0.0))*w;\n' +
    '    bl+=samp(uv+vec2(0.0,t*2.5/outSize.y))*w;bw+=2.0*w;}\n' +
    '  bl/=bw;\n' +
    '  c=c+bl*bloom;\n' +
    // Scanlines, in SOURCE rows so the line count is the console's and does not
    // change with the window size.
    '  float ry=(1.0-uv.y)*srcSize.y;\n' +
    '  float f=fract(ry)-0.5;\n' +
    '  float lum=dot(c,vec3(0.299,0.587,0.114));\n' +
    '  float width=mix(0.34,0.86,clamp(lum,0.0,1.0));\n' +
    '  float beam=exp(-f*f/(2.0*width*width));\n' +
    '  c*=mix(1.0,beam,scan);\n' +
    // Aperture grille: RGB stripes on a three-pixel period, in OUTPUT pixels.
    '  float px=gl_FragCoord.x;\n' +
    '  int s=int(mod(px,3.0));\n' +
    '  vec3 m=s==0?vec3(1.0,0.6,0.9):(s==1?vec3(0.9,1.0,0.6):vec3(0.6,0.9,1.0));\n' +
    '  c*=mix(vec3(1.0),m,mask);\n' +
    '  vec2 d=uv-0.5;\n' +
    '  c*=mix(1.0,clamp(1.0-vig*dot(d,d)*2.6,0.0,1.0),1.0);\n' +
    '  c=pow(max(c,0.0),vec3(gamma))*bright;\n' +
    '  o=vec4(clamp(c,0.0,1.0),1.0);}';

  var TUNE = {
    scan: 0.55,
    mask: 0.42,
    bloom: 0.30,
    vig: 0.42,
    gamma: 0.92,
    bright: 1.16
  };

  function compile(gl, vs, fs, label) {
    function sh(t, s) {
      var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(label + ': ' + gl.getShaderInfoLog(o));
      return o;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  // A reported extension is not a promise the attachment will be complete, and
  // an incomplete framebuffer throws nothing -- it just renders black. Checked,
  // with an RGBA8 fallback. (dmg-screen.js learned this the same way.)
  function makeTarget(gl, w, h, nearest) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var f2 = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f2);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f2);
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

  function NesScreen(source, opts) {
    opts = opts || {};
    this.source = source;
    this.cellPx = opts.cellPx || CELL_PX;
    this.tune = Object.assign({}, TUNE, opts.tune || {});
    this.emphasis = 0;
    this.frameCount = 0;
    this._srcW = 0;
    this._srcH = 0;
    this.ready = false;
    this.canvas = document.createElement('canvas');
    this._watchSize();
    this.canvas.id = 'nes';
    this.canvas.className = 'crt';
    this.canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;' +
      'z-index:6;pointer-events:none;display:none;';
    var gl = this.gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power'
    });
    this.ok = !!gl;
  }

  // No network fetch: unlike the Game Boy panel there is no vendored preset to
  // load, so the pipeline is ready as soon as three programs compile. That also
  // means it cannot be defeated by a routing fallback answering a shader path
  // with the app shell, which is what silently disabled the DMG panel in
  // production for a while.
  NesScreen.prototype.load = function () {
    var gl = this.gl, self = this;
    return new Promise(function (resolve, reject) {
      try {
        self.pIdx = compile(gl, VS, IDX_FS, 'nes-index');
        self.pNtsc = compile(gl, VS, ntscFs(SIG.PHASE, SIG.SAT, SIG.ATTEN, SIG.LEVELS), 'nes-ntsc');
        self.pCrt = compile(gl, VS, CRT_FS, 'nes-crt');
        self.vao = gl.createVertexArray();
        gl.bindVertexArray(self.vao);
        var b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // the 64 entries, straight from the signal model
        var tbl = SIG.table(0), px = new Uint8Array(64 * 4);
        for (var i = 0; i < 64; i++) {
          px[i*4] = tbl[i][0]; px[i*4+1] = tbl[i][1]; px[i*4+2] = tbl[i][2]; px[i*4+3] = 255;
        }
        self.palTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, self.palTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        self.srcTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, self.srcTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        self.ready = true;
        resolve(self);
      } catch (e) { reject(e); }
    });
  };

  NesScreen.prototype.resize = function () {
    var gl = this.gl;
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
    // The console signal cannot carry detail beyond this output budget, while
    // every CRT pass still pays for each pixel. Bound the full-screen chain so
    // high-DPI Safari does not rasterize display oversampling indefinitely.
    var maxPx = 2000000, px = (G.innerWidth || 1) * (G.innerHeight || 1) * dpr * dpr;
    if (px > maxPx) dpr *= Math.sqrt(maxPx / px);
    var w = Math.max(1, Math.round((this.canvas.clientWidth || G.innerWidth || 1) * dpr));
    var h = Math.max(1, Math.round((this.canvas.clientHeight || G.innerHeight || 1) * dpr));
    if (this.vw === w && this.vh === h) return;
    this.vw = w; this.vh = h;
    this.canvas.width = w; this.canvas.height = h;
    var cw = Math.max(64, Math.min(640, Math.round(w / this.cellPx)));
    var ch = Math.max(64, Math.min(480, Math.round(h / this.cellPx)));
    this.cells = { w: cw, h: ch };
    // The stage becomes EXACTLY this, so one canvas pixel is one NES pixel and
    // nothing is downsampled. Drawing at display resolution and shrinking
    // afterwards authors detail finer than the console could hold and then
    // throws it away, which is the graphics version of writing music for a
    // synthesiser and squeezing it onto the APU afterwards.
    G.CT_NES_NATIVE = { w: cw, h: ch };
    var drop = function (t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };
    drop(this.rtIdx); drop(this.rtNtsc);
    // The decode runs at the resolution the SIGNAL has, not the resolution the
    // monitor has. One NES pixel is eight subcarrier phase steps and the filter
    // spans twenty-five of them, so beyond about four samples per pixel there is
    // nothing further to resolve -- and each of those samples costs a 25-tap
    // loop. At 1440p that was 3.7M fragments doing 92M iterations a frame for
    // detail the composite signal cannot carry. Four times native horizontally,
    // three times vertically, never more than the output: same picture, a third
    // of the work, and it is the difference between this running on a phone and
    // not. The CRT pass still runs at full output resolution, so the scanlines
    // and the mask stay as sharp as the display.
    var nw = Math.min(w, cw * 4), nh = Math.min(h, ch * 3);
    this.rtIdx = makeTarget(gl, cw, ch, true);
    this.rtNtsc = makeTarget(gl, nw, nh, false);
    this.broken = !(this.rtIdx && this.rtNtsc);
  };


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
  NesScreen.prototype.sleep = function () {
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
  NesScreen.prototype.wake = function () {
    if (!this._asleep) return;
    this._asleep = false;
    this._sizeDirty = true;
    this.vw = this.vh = -1;      // belt and braces: never take the early return
  };
  NesScreen.prototype.setMode = function (on) {
    this.wanted = !!on;
    if (on) this.wake(); else this.sleep();
    // Force a resize on the way back in -- see the note in dmg-screen.js.
    // resize() early-returns on an unchanged viewport, so without this the stage
    // never returns to the console's framebuffer.
    if (on) { this.vw = this.vh = -1; return; }
    if (!on) {
      G.CT_NES_NATIVE = null;
      this.canvas.style.display = 'none';
      this.source.style.visibility = '';
    }
    // Turning it on does NOT show the canvas: it is opaque and covers the
    // viewport, so revealing it before a frame has been rendered into it is a
    // black screen. The swap happens in frame(), once there is something there.
  };


  // UNIFORM LOCATIONS ARE LOOKED UP ONCE PER PROGRAM, NOT ONCE PER FRAME.
  // getUniformLocation is a synchronous driver query. This loop was running it
  // for MVP, three *Size vectors, FrameCount and EVERY preset parameter, on
  // every pass, on every frame -- hundreds of driver round-trips a frame for
  // answers that cannot change: a program's uniform layout is fixed when it
  // links. Cached against the program object, so it dies with it.
  NesScreen.prototype._ul = function (prog, name) {
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
  NesScreen.prototype._watchSize = function () {
    var self = this;
    this._sizeDirty = true;
    try {
      if (typeof ResizeObserver === 'undefined') return;   // fall back to reading every frame
      this._ro = new ResizeObserver(function () { self._sizeDirty = true; });
      this._ro.observe(this.canvas);
    } catch (e) { this._ro = null; }
  };
  NesScreen.prototype.frame = function () {
    if (!this.ok || !this.ready) return;
    if (this._asleep) return;   // asleep: its targets are gone until setMode(true)
    var gl = this.gl, self = this;
    this.resize();
    if (this.broken) return;
    var w = this.vw, h = this.vh, t = this.tune;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    // Keep source texture allocation stable across frames. Re-specify storage
    // only for a real dimension change and use a sub-image upload normally.
    var sw = Math.max(1, this.source.width|0), sh = Math.max(1, this.source.height|0);
    if (this._srcW !== sw || this._srcH !== sh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this._srcW = sw; this._srcH = sh;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.source);

    // 1. index
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtIdx.fbo);
    gl.viewport(0, 0, this.rtIdx.w, this.rtIdx.h);
    gl.useProgram(this.pIdx);
    gl.uniform1i(self._ul(this.pIdx, 'src'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.uniform1i(self._ul(this.pIdx, 'pal'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. modulate and demodulate
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtNtsc.fbo);
    gl.viewport(0, 0, this.rtNtsc.w, this.rtNtsc.h);
    gl.useProgram(this.pNtsc);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rtIdx.tex);
    gl.uniform1i(self._ul(this.pNtsc, 'idx'), 0);
    gl.uniform2f(self._ul(this.pNtsc, 'srcSize'), this.rtIdx.w, this.rtIdx.h);
    gl.uniform1i(self._ul(this.pNtsc, 'frame'), this.frameCount | 0);
    gl.uniform1i(self._ul(this.pNtsc, 'emph'), this.emphasis | 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. the television
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.pCrt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rtNtsc.tex);
    gl.uniform1i(self._ul(this.pCrt, 'src'), 0);
    gl.uniform2f(self._ul(this.pCrt, 'outSize'), w, h);
    gl.uniform2f(self._ul(this.pCrt, 'srcSize'), this.rtIdx.w, this.rtIdx.h);
    ['scan','mask','bloom','vig','gamma','bright'].forEach(function (k) {
      var l = self._ul(this.pCrt, k);
      if (l) gl.uniform1f(l, t[k]);
    }, this);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.frameCount++;
    if (this.wanted) {
      if (this.canvas.style.display !== 'block') this.canvas.style.display = 'block';
      if (this.source.style.visibility !== 'hidden') this.source.style.visibility = 'hidden';
    }
  };

  var API = { NesScreen: NesScreen, CELL_PX: CELL_PX, TUNE: TUNE };
  G.CT_NES_SCREEN = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
