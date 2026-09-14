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
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) throw Error('Visuals need WebGL 2.');
    this.floatBuffers = this.gl.getExtension('EXT_color_buffer_float');
    this.passes = []; this.frame = 0; this.disposed = false;
    this.audio = this.texture(512, 2, new Uint8Array(1024));
    this.empty = this.texture(1, 1, new Uint8Array(1));
    this.mouse = [0,0,0,0];
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
  target() {
    if (!this.floatBuffers) throw Error('Feedback buffers need floating-point WebGL support.');
    const g = this.gl, result = this.texture(this.canvas.width, this.canvas.height);
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
    const shaders = [], program = g.createProgram();
    try {
      for (const [kind, code] of [[g.VERTEX_SHADER, VERTEX], [g.FRAGMENT_SHADER,
        HEADER + '\n#line 1 1\n' + common + '\n#line 1 0\n' + source + '\nvoid main(){mainImage(outputColor,gl_FragCoord.xy);}' ]]) {
        const shader = g.createShader(kind); shaders.push(shader);
        g.shaderSource(shader, code); g.compileShader(shader);
        if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(shader));
        g.attachShader(program, shader);
      }
      g.linkProgram(program);
      if (!g.getProgramParameter(program, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(program));
      return program;
    } catch (error) { g.deleteProgram(program); throw error; }
    finally { shaders.forEach(s => g.deleteShader(s)); }
  }
  // Transactional prepare: a bad pass never replaces any working pass.
  prepare(document) {
    if (!document || typeof document.Image !== 'string') throw Error('An Image shader is required.');
    const common = document.Common || '', next = [];
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
    return {
      apply: () => {
        if (settled) throw Error('Shader candidate already consumed.');
        settled = true; this.deletePasses(this.passes); this.passes = next; this.frame = 0;
      },
      dispose: () => { if (!settled) { settled = true; this.deletePasses(next); } },
    };
  }
  set(document) { this.prepare(document).apply(); }
  uniform(pass, name, kind, ...values) {
    if (!pass.uniforms.has(name)) pass.uniforms.set(name, this.gl.getUniformLocation(pass.program, name));
    this.gl[kind](pass.uniforms.get(name), ...values);
  }
  render({ time = 0, delta = 0, cycle = 0, kick = 0, sampleRate = 44100, frequency, waveform, date = new Date() } = {}) {
    const g = this.gl;
    if (this.disposed || g.isContextLost()) return false;
    if (frequency?.length === 512 && waveform?.length === 512) {
      const bytes = new Uint8Array(1024); bytes.set(frequency); bytes.set(waveform,512);
      g.bindTexture(g.TEXTURE_2D, this.audio.texture);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 512, 2, g.RED, g.UNSIGNED_BYTE, bytes);
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
        this.uniform(pass,`iChannelTime[${i}]`,'uniform1f',input ? time : 0);
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
  dispose() { this.disposed = true; this.deletePasses(this.passes); this.deleteTarget(this.audio); this.deleteTarget(this.empty); this.passes=[]; }
}
