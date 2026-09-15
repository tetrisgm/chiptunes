// A shader owns no transport. The caller supplies time, audio and event signals.
const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime, iTimeDelta, iFrameRate, iSampleRate;
uniform int iFrame;
uniform vec4 iMouse, iDate;
uniform float iChannelTime[4];
uniform vec3 iChannelResolution[4];
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
// Chiptunes extensions: cycles, four-beat phase, and a scheduled kick envelope.
uniform float ctCycle, ctBeat, ctKick;
out vec4 outputColor;
#define texture2D texture
`;
const ORDER = ['A', 'B', 'C', 'D', 'Image'];
export class ShaderRuntime {
  constructor(canvas, { onStatus = () => {} } = {}) {
    this.canvas = canvas; this.onStatus = onStatus; this.generation = 0; this.candidates = new Set();
    this.document = null; this.lost = false;
    this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) throw Error('Visuals need WebGL 2.');
    this.floatBuffers = this.gl.getExtension('EXT_color_buffer_float');
    this.passes = []; this.frame = 0; this.disposed = false;
    this.audioBytes = new Uint8Array(1024); this.audioBytes.fill(128, 512);
    this.audio = this.texture(512, 2, this.audioBytes);
    this.empty = this.texture(1, 1, new Uint8Array(1));
    this.mouse = [0,0,0,0];
    this.handlers = {
      webglcontextlost: event => {
        event.preventDefault(); this.lost = true; this.generation++;
        for (const candidate of [...this.candidates]) candidate.dispose();
        this.onStatus('Visuals paused while the graphics context recovers. Music continues.');
      },
      webglcontextrestored: () => {
        if (this.disposed) return;
        const saved = this.document;
        this.lost = false; this.passes = [];
        this.floatBuffers = this.gl.getExtension('EXT_color_buffer_float');
        this.audio = this.texture(512, 2, this.audioBytes);
        this.empty = this.texture(1, 1, new Uint8Array(1));
        try { if (saved) this.set(saved); this.onStatus('Visuals recovered'); }
        catch (error) { this.onStatus('Visual recovery failed: ' + error.message); }
      },
      pointerdown: event => {
        if (event.button !== 0) return;
        this.pointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
        this.position(event); this.mouse[2] = Math.max(.0001, this.mouse[0]); this.mouse[3] = Math.max(.0001, this.mouse[1]);
      },
      pointermove: event => { if (event.pointerId === this.pointer) this.position(event); },
      pointerup: event => this.releasePointer(event),
      pointercancel: event => this.releasePointer(event),
      lostpointercapture: event => this.releasePointer(event),
    };
    for (const [name, handler] of Object.entries(this.handlers)) canvas.addEventListener(name, handler);
  }
  position(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse[0] = Math.max(0, Math.min(this.canvas.width, (event.clientX - rect.left) * this.canvas.width / rect.width));
    this.mouse[1] = Math.max(0, Math.min(this.canvas.height, (rect.bottom - event.clientY) * this.canvas.height / rect.height));
  }
  releasePointer(event) {
    if (event.pointerId !== this.pointer) return;
    this.mouse[2] = -Math.abs(this.mouse[2]); this.mouse[3] = -Math.abs(this.mouse[3]); this.pointer = null;
  }
  resize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return false;
    if (this.disposed || this.lost || this.gl.isContextLost()) return false;
    // Match the requested display size up to the actual device's GL limits.
    // A fixed 1080p ceiling changes gl_FragCoord/iResolution on larger displays.
    const g = this.gl, viewport = g.getParameter(g.MAX_VIEWPORT_DIMS);
    const limit = Math.min(g.getParameter(g.MAX_TEXTURE_SIZE), g.getParameter(g.MAX_RENDERBUFFER_SIZE));
    const scale = Math.min(1, Math.min(limit, viewport[0]) / width, Math.min(limit, viewport[1]) / height);
    width = Math.max(1, Math.floor(width * scale)); height = Math.max(1, Math.floor(height * scale));
    if (width === this.canvas.width && height === this.canvas.height) return false;
    const replacements = [];
    try {
      for (const pass of this.passes) {
        if (!pass.targets.length) continue;
        const pair = []; replacements.push({ pass, pair });
        for (const old of pass.targets) {
          const next = this.target(width, height); pair.push(next);
          g.bindFramebuffer(g.READ_FRAMEBUFFER, old.fbo); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, next.fbo);
          g.blitFramebuffer(0, 0, old.width, old.height, 0, 0, width, height, g.COLOR_BUFFER_BIT, g.NEAREST);
        }
      }
    } catch (error) { replacements.forEach(({ pair }) => pair.forEach(t => this.deleteTarget(t))); throw error; }
    // Candidates compiled against the old size cannot subsequently be activated.
    this.generation++;
    for (const candidate of [...this.candidates]) candidate.dispose();
    for (const { pass, pair } of replacements) { pass.targets.forEach(t => this.deleteTarget(t)); pass.targets = pair; }
    this.canvas.width = width; this.canvas.height = height;
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return true;
  }
  texture(width, height, bytes = null) {
    const g = this.gl, texture = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, texture);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    g.texImage2D(g.TEXTURE_2D, 0, bytes ? g.R8 : g.RGBA16F, width, height, 0, bytes ? g.RED : g.RGBA, bytes ? g.UNSIGNED_BYTE : g.HALF_FLOAT, bytes);
    return { texture, width, height };
  }
  target(width = this.canvas.width, height = this.canvas.height) {
    if (!this.floatBuffers) throw Error('Feedback buffers need floating-point WebGL support.');
    const g = this.gl, result = this.texture(width, height);
    result.fbo = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, result.fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, result.texture, 0);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) {
      this.deleteTarget(result); throw Error('Visual buffer allocation failed.');
    }
    g.clearColor(0,0,0,0); g.clear(g.COLOR_BUFFER_BIT);
    return result;
  }
  compile(source, common = '') {
    const g = this.gl;
    if (this.disposed || this.lost || g.isContextLost()) throw Error('Visuals are waiting for the graphics context.');
    const shaders = [], program = g.createProgram();
    try {
      for (const [kind, code] of [[g.VERTEX_SHADER, VERTEX], [g.FRAGMENT_SHADER,
        HEADER + '\n#line 1 1\n' + common + '\n#line 1 0\n' + source + '\nvoid main(){mainImage(outputColor,gl_FragCoord.xy);}' ]]) {
        const shader = g.createShader(kind); shaders.push(shader);
        g.shaderSource(shader, code); g.compileShader(shader);
        if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(shader) || 'Graphics context became unavailable during compilation.');
        g.attachShader(program, shader);
      }
      g.linkProgram(program);
      if (!g.getProgramParameter(program, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(program) || 'Graphics context became unavailable during linking.');
      return program;
    } catch (error) { g.deleteProgram(program); throw error; }
    finally { shaders.forEach(s => g.deleteShader(s)); }
  }
  // Transactional prepare: a bad pass never replaces any working pass.
  prepare(document) {
    if (!document || typeof document.Image !== 'string') throw Error('An Image shader is required.');
    document = structuredClone(document);
    const common = document.Common || '', next = [], generation = this.generation;
    if (typeof common !== 'string' || common.length > 65536) throw Error('Common code is too large.');
    try {
      for (const name of ORDER) {
        const source = document[name];
        if (source === undefined) continue;
        if (typeof source !== 'string' || source.length > 65536) throw Error(`${name} code is too large.`);
        const channels = document.channels?.[name] || (name === 'Image' ? ['audio'] : []);
        if (!Array.isArray(channels) || channels.length > 4 || channels.some(c => c !== null && c !== 'audio' && !ORDER.slice(0,4).includes(c))) throw Error(`${name}: unsupported channel.`);
        for (const c of channels) if (c && c !== 'audio' && typeof document[c] !== 'string') throw Error(`${name}: missing Buffer ${c}.`);
        let program;
        try { program = this.compile(source, common); } catch (e) { throw Error(`${name}: ${e.message}`); }
        const pass = { name, program, channels, uniforms: new Map(), targets: [], read: 0 };
        next.push(pass);
        if (name !== 'Image') { pass.targets.push(this.target()); pass.targets.push(this.target()); }
      }
    } catch (error) { this.deletePasses(next); throw error; }
    let settled = false;
    const candidate = {
      apply: () => {
        if (settled || generation !== this.generation || this.lost || this.disposed || this.gl.isContextLost()) {
          candidate.dispose(); throw Error('The visual output changed. Run this edit again.');
        }
        settled = true; this.candidates.delete(candidate); this.deletePasses(this.passes); this.passes = next; this.frame = 0; this.document = document;
      },
      dispose: () => { if (!settled) { settled = true; this.candidates.delete(candidate); this.deletePasses(next); } },
    };
    this.candidates.add(candidate);
    return candidate;
  }
  set(document) { this.prepare(document).apply(); }
  uniform(pass, name, kind, ...values) {
    if (!pass.uniforms.has(name)) pass.uniforms.set(name, this.gl.getUniformLocation(pass.program, name));
    this.gl[kind](pass.uniforms.get(name), ...values);
  }
  render({ time = 0, delta = 0, cycle = 0, kick = 0, sampleRate = 44100, frequency, waveform, date = new Date() } = {}) {
    const g = this.gl;
    if (this.disposed || this.lost || g.isContextLost()) return false;
    if (frequency?.length === 512 && waveform?.length === 512) {
      this.audioBytes.set(frequency); this.audioBytes.set(waveform,512);
      g.bindTexture(g.TEXTURE_2D, this.audio.texture);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 512, 2, g.RED, g.UNSIGNED_BYTE, this.audioBytes);
    }
    const completed = new Map();
    for (const pass of this.passes) {
      const write = pass.targets[1-pass.read];
      g.bindFramebuffer(g.FRAMEBUFFER, write?.fbo || null);
      g.viewport(0,0,this.canvas.width,this.canvas.height); g.useProgram(pass.program);
      this.uniform(pass,'iResolution','uniform3f',this.canvas.width,this.canvas.height,1);
      this.uniform(pass,'iTime','uniform1f',time); this.uniform(pass,'iTimeDelta','uniform1f',delta);
      this.uniform(pass,'iFrameRate','uniform1f',delta > 0 ? 1/delta : 0);
      this.uniform(pass,'iFrame','uniform1i',this.frame); this.uniform(pass,'iSampleRate','uniform1f',sampleRate);
      this.uniform(pass,'iMouse','uniform4fv',this.mouse);
      this.uniform(pass,'iDate','uniform4f',date.getFullYear(),date.getMonth(),date.getDate(),date.getHours()*3600+date.getMinutes()*60+date.getSeconds()+date.getMilliseconds()/1000);
      this.uniform(pass,'ctCycle','uniform1f',cycle); this.uniform(pass,'ctBeat','uniform1f',((cycle*4)%1+1)%1);
      this.uniform(pass,'ctKick','uniform1f',kick);
      for (let i=0;i<4;i++) {
        const input = pass.channels[i];
        const buffer = this.passes.find(p => p.name === input);
        // Earlier passes are current-frame; self/later references are previous-frame.
        const texture = input === 'audio' ? this.audio : completed.get(input) || buffer?.targets[buffer.read] || this.empty;
        g.activeTexture(g.TEXTURE0+i); g.bindTexture(g.TEXTURE_2D,texture.texture);
        this.uniform(pass,`iChannel${i}`,'uniform1i',i);
        this.uniform(pass,`iChannelResolution[${i}]`,'uniform3f',texture.width,texture.height,1);
        this.uniform(pass,`iChannelTime[${i}]`,'uniform1f',input === 'audio' ? time : 0);
      }
      g.drawArrays(g.TRIANGLES,0,3);
      if (write) completed.set(pass.name,write);
    }
    this.passes.forEach(p => { if (p.targets.length) p.read = 1-p.read; });
    this.frame++;
    return true;
  }
  deleteTarget(target) { this.gl.deleteTexture(target.texture); if (target.fbo) this.gl.deleteFramebuffer(target.fbo); }
  deletePasses(passes) { for (const pass of passes) { this.gl.deleteProgram(pass.program); pass.targets.forEach(t => this.deleteTarget(t)); } }
  dispose() {
    if (this.disposed) return;
    for (const [name, handler] of Object.entries(this.handlers)) this.canvas.removeEventListener(name, handler);
    for (const candidate of [...this.candidates]) candidate.dispose();
    this.disposed = true; this.deletePasses(this.passes); this.deleteTarget(this.audio); this.deleteTarget(this.empty); this.passes=[]; }
}
