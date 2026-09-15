// A shader owns no transport. The caller supplies time, audio and event signals.
import contract from './project.cjs';
import {loadShaderImage,decodeShaderImage,imageKey,IMAGE_PIXELS} from './shader-images.mjs';
import {createShaderAudioHub,createShaderAudio,decodeShaderAudio,loadShaderAudio} from './shader-audio.mjs';
import {createShaderCamera} from './shader-camera.mjs';
import {loadShaderVideo,decodeShaderVideo} from './shader-video.mjs';
import {loadShaderVolume,decodeShaderVolume} from './shader-volume.mjs';
const inputInfo=input=>typeof input==='string'?{type:['audio','keyboard'].includes(input)?input:'buffer',source:input}:input||{type:'empty'};
const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform vec3 iResolution;
uniform float iTime, iTimeDelta, iFrameRate, iSampleRate;
uniform int iFrame;
uniform vec4 iMouse, iDate;
uniform float iChannelTime[4];
uniform vec3 iChannelResolution[4];
// Chiptunes extensions: cycles, four-beat phase, and a scheduled kick envelope.
uniform float ctCycle, ctBeat, ctKick;
out vec4 outputColor;
#define texture2D texture
#define textureCube texture
`;
const ORDER = ['A', 'B', 'C', 'D', 'Cube', 'Image'];
const cubeInput = input => {const info=inputInfo(input);return info.type==='cubemap'||info.type==='buffer'&&info.source==='Cube';};
// OpenGL cube face directions, inverse to the samplerCube face/UV mapping.
const CUBE_MAIN = `
uniform int ctCubeFace;
void main(){
  vec2 p=2.*gl_FragCoord.xy/iResolution.xy-1.;
  vec3 d=ctCubeFace==0?vec3(1.,-p.y,-p.x):
    ctCubeFace==1?vec3(-1.,-p.y,p.x):
    ctCubeFace==2?vec3(p.x,1.,p.y):
    ctCubeFace==3?vec3(p.x,-1.,-p.y):
    ctCubeFace==4?vec3(p.x,-p.y,1.):vec3(-p.x,-p.y,-1.);
  mainCubemap(outputColor,gl_FragCoord.xy,vec3(0.),normalize(d));
}`;
export class ShaderRuntime {
  constructor(canvas, { onStatus = () => {}, resolveImage = async () => {throw Error('Imported image content is missing.');} } = {}) {
    this.resolveImage = resolveImage; this.canvas = canvas; this.onStatus = onStatus; this.generation = 0; this.candidates = new Set();
    this.document = null; this.lost = false;
    this.audioHub=createShaderAudioHub();this.loads=new Set();this.retained=new Set();
    this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) throw Error('Visuals need WebGL 2.');
    this.floatBuffers = this.gl.getExtension('EXT_color_buffer_float');
    this.passes = []; this.frame = 0; this.disposed = false;
    this.audioBytes = new Uint8Array(1024); this.audioBytes.fill(128, 512);
    this.audio = this.texture(512, 2, this.audioBytes);
    this.empty = this.texture(1, 1, new Uint8Array(1));
    this.keyboardBytes=new Uint8Array(768);this.keyboard=this.texture(256,3,this.keyboardBytes);
    this.keyHandlers={
      keydown:event=>{
        if(document.activeElement!==canvas||!this.passes.some(pass=>pass.channels.some(input=>inputInfo(input).type==='keyboard')))return;
        const key=event.keyCode;if(key<0||key>255||!Number.isInteger(key))return;
        if(!this.keyboardBytes[key]&&!event.repeat){this.keyboardBytes[key]=255;this.keyboardBytes[256+key]=255;this.keyboardBytes[512+key]^=255;}
        if([32,37,38,39,40].includes(key))event.preventDefault();
      },
      keyup:event=>{if(event.keyCode>=0&&event.keyCode<256)this.keyboardBytes[event.keyCode]=0;},
      blur:()=>this.keyboardBytes.fill(0,0,512),
    };
    this.previousTabIndex=canvas.getAttribute('tabindex');canvas.tabIndex=0;
    for(const [name,handler]of Object.entries(this.keyHandlers))window.addEventListener(name,handler);
    this.mouse = [0,0,0,0];
    this.handlers = {
      webglcontextlost: event => {
        event.preventDefault(); this.lost = true; this.generation++;
        for(const controller of this.loads)controller.abort();
        for(const passes of [this.passes,...[...this.retained].map(p=>p.passes)])for(const texture of new Set(passes.flatMap(p=>p.images))){texture.media?.close();texture.media=null;}
        for(const previous of this.retained)previous.invalid=true;
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
        this.keyboard=this.texture(256,3,this.keyboardBytes);
        if(saved)this.prepareAsync(saved).then(candidate=>{candidate.apply();this.onStatus('Visuals recovered');}).catch(error=>{if(!this.disposed)this.onStatus('Visual recovery failed: '+error.message);});
      },
      pointerdown: event => {
        if (event.button !== 0) return;
        this.pointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
        canvas.focus({preventScroll:true});
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
      for (const pass of [...this.passes,...[...this.retained].filter(previous=>!previous.invalid).flatMap(previous=>previous.passes)]) {
        // Cubemap output is a fixed square, independent of the display viewport.
        if (!pass.targets.length || pass.name==='Cube') continue;
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
  imageTexture(bitmap,srgb=false){
    const g=this.gl,limit=g.getParameter(g.MAX_TEXTURE_SIZE);
    if(bitmap.width>limit||bitmap.height>limit)throw Error('Texture exceeds this graphics device’s size limit.');
    const texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,texture);
    try{
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      g.texImage2D(g.TEXTURE_2D,0,srgb?g.SRGB8_ALPHA8:g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,bitmap);
      if(g.getError()!==g.NO_ERROR)throw Error('Visual texture allocation failed.');
      g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);
      g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
      return {texture,width:bitmap.width,height:bitmap.height};
    }catch(error){g.deleteTexture(texture);throw error;}
  }
  videoTexture(media,input){
    const g=this.gl;
    if(media.width>g.getParameter(g.MAX_TEXTURE_SIZE)||media.height>g.getParameter(g.MAX_TEXTURE_SIZE))throw Error('Video exceeds this graphics device’s size limit.');
    const result={...this.texture(1,1,new Uint8Array([0])),width:media.width,height:media.height,media:media.retain(),source:input.src,vflip:input.vflip===true,srgb:input.srgb===true};
    try{this.updateVideo(result);return result;}catch(error){this.deleteTarget(result);throw error;}
  }
  updateVideo(texture){
    const g=this.gl,video=texture.media.video;if(video.readyState<2)return;
    g.bindTexture(g.TEXTURE_2D,texture.texture);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,texture.vflip);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    try{
      g.texImage2D(g.TEXTURE_2D,0,texture.srgb?g.SRGB8_ALPHA8:g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,video);
      if(g.getError()!==g.NO_ERROR)throw Error('Video texture upload failed.');
      texture.width=video.videoWidth;texture.height=video.videoHeight;texture.mipmaps=false;
    }finally{g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);}
  }
  cubeTexture(bitmaps,srgb=false){
    const g=this.gl,size=bitmaps[0].width;
    if(bitmaps.length!==6||bitmaps.some(b=>b.width!==size||b.height!==size))throw Error('Cube texture faces must be square and have the same dimensions.');
    if(size>g.getParameter(g.MAX_CUBE_MAP_TEXTURE_SIZE))throw Error('Cube texture exceeds this graphics device’s size limit.');
    const texture=g.createTexture();g.bindTexture(g.TEXTURE_CUBE_MAP,texture);
    try{
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      bitmaps.forEach((bitmap,i)=>g.texImage2D(g.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,srgb?g.SRGB8_ALPHA8:g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,bitmap));
      if(g.getError()!==g.NO_ERROR)throw Error('Cube texture allocation failed.');
      g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_MAG_FILTER,g.LINEAR);
      for(const axis of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T,g.TEXTURE_WRAP_R])g.texParameteri(g.TEXTURE_CUBE_MAP,axis,g.CLAMP_TO_EDGE);
      return {texture,width:size,height:size,target:g.TEXTURE_CUBE_MAP};
    }catch(error){g.deleteTexture(texture);throw error;}
  }
  volumeTexture(volume,srgb=false){
    const g=this.gl,{width,height,depth,components}=volume;
    if(Math.max(width,height,depth)>g.getParameter(g.MAX_3D_TEXTURE_SIZE))throw Error('Volume exceeds this graphics device’s size limit.');
    let data=volume.data,format=[g.RED,g.RG,g.RGB,g.RGBA][components-1],internal=[g.R8,g.RG8,g.RGB8,g.RGBA8][components-1];
    if(srgb){
      internal=g.SRGB8_ALPHA8;format=g.RGBA;
      if(components!==4){data=new Uint8Array(width*height*depth*4);for(let i=0;i<width*height*depth;i++){data.set(volume.data.subarray(i*components,(i+1)*components),i*4);data[i*4+3]=255;}}
    }
    const texture=g.createTexture();g.bindTexture(g.TEXTURE_3D,texture);
    try{
      g.pixelStorei(g.UNPACK_ALIGNMENT,1);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      g.texImage3D(g.TEXTURE_3D,0,internal,width,height,depth,0,format,g.UNSIGNED_BYTE,data);
      if(g.getError()!==g.NO_ERROR)throw Error('Volume texture allocation failed.');
      g.texParameteri(g.TEXTURE_3D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_3D,g.TEXTURE_MAG_FILTER,g.LINEAR);
      for(const axis of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T,g.TEXTURE_WRAP_R])g.texParameteri(g.TEXTURE_3D,axis,g.CLAMP_TO_EDGE);
      return {texture,width,height,depth,target:g.TEXTURE_3D};
    }catch(error){g.deleteTexture(texture);throw error;}
  }
  sampler(input){
    const g=this.gl,info=inputInfo(input),sampler=g.createSampler();
    const filter=info.filter||(info.type==='keyboard'?'nearest':'linear'),wrap=info.wrap||'clamp';
    g.samplerParameteri(sampler,g.TEXTURE_MIN_FILTER,filter==='nearest'?g.NEAREST:filter==='mipmap'?g.LINEAR_MIPMAP_LINEAR:g.LINEAR);
    g.samplerParameteri(sampler,g.TEXTURE_MAG_FILTER,filter==='nearest'?g.NEAREST:g.LINEAR);
    const edge=wrap==='repeat'?g.REPEAT:wrap==='mirror'?g.MIRRORED_REPEAT:g.CLAMP_TO_EDGE;
    g.samplerParameteri(sampler,g.TEXTURE_WRAP_S,edge);g.samplerParameteri(sampler,g.TEXTURE_WRAP_T,edge);g.samplerParameteri(sampler,g.TEXTURE_WRAP_R,edge);
    return sampler;
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
  cubeTarget() {
    if(!this.floatBuffers)throw Error('Cubemap output needs floating-point WebGL support.');
    const g=this.gl,size=Math.min(1024,g.getParameter(g.MAX_CUBE_MAP_TEXTURE_SIZE),g.getParameter(g.MAX_RENDERBUFFER_SIZE));
    const result={texture:g.createTexture(),fbo:g.createFramebuffer(),width:size,height:size,target:g.TEXTURE_CUBE_MAP};
    try{
      g.bindTexture(g.TEXTURE_CUBE_MAP,result.texture);
      g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_MIN_FILTER,g.LINEAR);
      g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_MAG_FILTER,g.LINEAR);
      for(const axis of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T,g.TEXTURE_WRAP_R])g.texParameteri(g.TEXTURE_CUBE_MAP,axis,g.CLAMP_TO_EDGE);
      // A framebuffer attachment must belong to a complete cube texture.
      for(let face=0;face<6;face++)g.texImage2D(g.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,g.RGBA16F,size,size,0,g.RGBA,g.HALF_FLOAT,null);
      g.bindFramebuffer(g.FRAMEBUFFER,result.fbo);
      for(let face=0;face<6;face++){
        g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_CUBE_MAP_POSITIVE_X+face,result.texture,0);
        if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Cubemap output allocation failed.');
        g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);
      }
      if(g.getError()!==g.NO_ERROR)throw Error('Cubemap output allocation failed.');
      return result;
    }catch(error){this.deleteTarget(result);throw error;}
  }
  compile(source, common = '', channels = [], cube = false) {
    const g = this.gl;
    if (this.disposed || this.lost || g.isContextLost()) throw Error('Visuals are waiting for the graphics context.');
    const shaders = [], program = g.createProgram();
    try {
      for (const [kind, code] of [[g.VERTEX_SHADER, VERTEX], [g.FRAGMENT_SHADER,
        HEADER + Array.from({length:4},(_,i)=>`uniform ${cubeInput(channels[i])?'samplerCube':inputInfo(channels[i]).type==='volume'?'sampler3D':'sampler2D'} iChannel${i};\n`).join('') + '\n#line 1 1\n' + common + '\n#line 1 0\n' + source + (cube?CUBE_MAIN:'\nvoid main(){mainImage(outputColor,gl_FragCoord.xy);}') ]]) {
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
  prepare(document, images=new Map()) {
    if (!document || typeof document.Image !== 'string') throw Error('An Image shader is required.');
    document = structuredClone(document);
    const common = document.Common || '', next = [], generation = this.generation, imageTextures=new Map();
    let imagePixels=0;
    if (typeof common !== 'string' || common.length > 65536) throw Error('Common code is too large.');
    try {
      for (const name of ORDER) {
        const source = document[name];
        if (source === undefined) continue;
        if (typeof source !== 'string' || source.length > 65536) throw Error(`${name} code is too large.`);
        const row = document.channels?.[name] || (name === 'Image' ? ['audio'] : []);
        if (!Array.isArray(row) || row.length > 4) throw Error(`${name}: unsupported channel.`);
        const channels=row.map(input=>contract.channel(input,document));
        let program;
        try { program = this.compile(source, common, channels, name==='Cube'); } catch (e) { throw Error(`${name}: ${e.message}`); }
        const pass = { name, program, channels, uniforms: new Map(), targets: [], images:[],samplers:[],read: 0 };
        next.push(pass);
        for(let i=0;i<4;i++){
          const input=inputInfo(channels[i]);pass.samplers.push(this.sampler(channels[i]));
          if(input.type==='music'||input.type==='mic'){
            const key=JSON.stringify([input.type,input.src]);
            if(!imageTextures.has(key)){
              const shared=this.passes.flatMap(p=>p.images).find(t=>t.media?.kind===input.type&&t.source===input.src);
              if(input.type==='music'&&!shared&&!images.get(imageKey(input)))throw Error('Audio is not loaded. Use asynchronous preparation.');
              const media=shared?shared.media.retain():createShaderAudio(this.audioHub,{microphone:input.type==='mic',buffer:input.type==='music'?images.get(imageKey(input)):null});
              imageTextures.set(key,{...this.texture(512,2,media.bytes),media,source:input.src});
            }
            pass.images[i]=imageTextures.get(key);
          }else if(input.type==='webcam'){
            const key=JSON.stringify(['webcam',input.vflip===true,input.srgb===true]);
            if(!imageTextures.has(key)){
              const shared=[...imageTextures.values(),...this.passes.flatMap(p=>p.images)].find(t=>t.media?.kind==='webcam');
              const media=shared?shared.media.retain():createShaderCamera({maxSize:Math.min(4096,this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE))});
              try{imageTextures.set(key,this.videoTexture(media,input));}finally{media.close();}
            }
            pass.images[i]=imageTextures.get(key);
          }else if(input.type==='texture'||input.type==='cubemap'||input.type==='volume'||input.type==='video'){
            const sources=contract.textureSources(input),bitmaps=sources.map(src=>images.get(imageKey({src,vflip:input.vflip,type:input.type})));
            if(bitmaps.some(bitmap=>!bitmap))throw Error('Texture is not loaded. Use asynchronous preparation.');
            const key=JSON.stringify([input.type,sources,input.vflip===true,input.srgb===true]);
            if(!imageTextures.has(key)){
              imagePixels+=bitmaps.reduce((sum,b)=>sum+b.width*b.height*(b.depth||1),0);if(imagePixels>IMAGE_PIXELS*4)throw Error('Combined texture resolution exceeds 64 million pixels/voxels.');
              imageTextures.set(key,input.type==='video'?this.videoTexture(bitmaps[0],input):input.type==='cubemap'?this.cubeTexture(bitmaps,input.srgb===true):input.type==='volume'?this.volumeTexture(bitmaps[0],input.srgb===true):this.imageTexture(bitmaps[0],input.srgb===true));
            }
            pass.images[i]=imageTextures.get(key);
          }
        }
        if (name !== 'Image') { pass.targets.push(name==='Cube'?this.cubeTarget():this.target()); pass.targets.push(name==='Cube'?this.cubeTarget():this.target()); }
      }
    } catch (error) { this.deletePasses(next); throw error; }
    let settled = false,previous;
    const candidate = {
      apply: ({retainPrevious=false}={}) => {
        if (settled || generation !== this.generation || this.lost || this.disposed || this.gl.isContextLost()) {
          candidate.dispose(); throw Error('The visual output changed. Run this edit again.');
        }
        settled = true; this.candidates.delete(candidate);
        const nextMedia=new Set(next.flatMap(p=>p.images).map(t=>t.media));
        for(const texture of new Set(this.passes.flatMap(p=>p.images)))if(!nextMedia.has(texture.media))texture.media?.setPlaying(false);
        if(retainPrevious){previous={passes:this.passes,frame:this.frame,document:this.document};this.retained.add(previous);}else this.deletePasses(this.passes);
        this.passes = next; this.frame = 0; this.document = document;
      },
      rollback:async()=>{
        if(!previous)return;
        const restore=previous;previous=undefined;this.retained.delete(restore);
        if(restore.invalid){
          this.generation++;for(const controller of this.loads)controller.abort();
          // A lost context already released its resources. Passing those stale
          // handles to the restored context creates INVALID_OPERATION errors.
          if(!this.lost)this.deletePasses(this.passes);
          this.passes=[];this.document=restore.document;
          if(!this.lost&&!this.disposed)(await this.prepareAsync(restore.document)).apply();
        }else{this.deletePasses(next);this.passes=restore.passes;this.frame=restore.frame;this.document=restore.document;}
      },
      dispose: () => {
        if(previous){this.retained.delete(previous);if(!previous.invalid)this.deletePasses(previous.passes);previous=undefined;}
        if (!settled) { settled = true; this.candidates.delete(candidate); this.deletePasses(next); }
      },
    };
    this.candidates.add(candidate);
    return candidate;
  }
  async prepareAsync(document){
    const normalized=contract.project({version:1,runtime:contract.RUNTIME,music:'',visuals:document}).visuals;
    const inputs=Object.values(normalized.channels).flat().flatMap(input=>contract.textureSources(input).map(src=>({src,vflip:input.vflip,type:input.type})));
    if(!inputs.length)return this.prepare(normalized);
    const generation=this.generation,controller=new AbortController(),images=new Map();this.loads.add(controller);
    const timer=setTimeout(()=>controller.abort(),15000);let pixels=0,audioSamples=0;
    try{
      // Sequential decoding bounds in-flight allocations; identical inputs are shared.
      for(const input of inputs){
        const key=imageKey(input);if(images.has(key))continue;
        const previousAudio=input.type==='music'&&this.passes.flatMap(pass=>pass.images).find(t=>t.media?.kind==='music'&&t.source===input.src);
        if(previousAudio){audioSamples+=previousAudio.media.sampleCount;if(audioSamples>32*1024*1024)throw Error('Combined audio inputs exceed 32 million decoded samples.');images.set(key,null);continue;}
        const options={signal:controller.signal,vflip:input.vflip},id=contract.imageId(input.src);
        const decode=input.type==='music'?decodeShaderAudio:input.type==='video'?decodeShaderVideo:input.type==='volume'?decodeShaderVolume:decodeShaderImage,load=input.type==='music'?loadShaderAudio:input.type==='video'?loadShaderVideo:input.type==='volume'?loadShaderVolume:loadShaderImage;
        const existing=input.type==='video'&&this.passes.flatMap(pass=>pass.images).find(texture=>texture.media&&texture.source===input.src);
        const bitmap=existing?existing.media.retain():id?await decode(await this.resolveImage(id),options):await load(input.src,options);images.set(key,bitmap);
        if(input.type==='music'){audioSamples+=bitmap.length*bitmap.numberOfChannels;if(audioSamples>32*1024*1024)throw Error('Combined audio inputs exceed 32 million decoded samples.');}
        pixels+=bitmap.width*bitmap.height*(bitmap.depth||1)||0;if(pixels>IMAGE_PIXELS*4)throw Error('Combined texture resolution exceeds 64 million pixels/voxels.');
      }
      if(controller.signal.aborted||generation!==this.generation||this.disposed||this.lost)throw Error('Visual output changed while textures loaded. Run again.');
      return this.prepare(normalized,images);
    }finally{clearTimeout(timer);this.loads.delete(controller);for(const bitmap of images.values())bitmap?.close?.();}
  }
  set(document) { this.prepare(document).apply(); }
  uniform(pass, name, kind, ...values) {
    if (!pass.uniforms.has(name)) pass.uniforms.set(name, this.gl.getUniformLocation(pass.program, name));
    this.gl[kind](pass.uniforms.get(name), ...values);
  }
  unlockAudio(){return this.audioHub.unlock();}
  setPlaying(playing){if(!playing)this.audioHub.suspend();for(const texture of new Set(this.passes.flatMap(pass=>pass.images)))texture.media?.setPlaying(playing,this.onStatus);}
  render({ playing = true, time = 0, delta = 0, cycle = 0, kick = 0, sampleRate = 44100, frequency, waveform, date = new Date() } = {}) {
    const g = this.gl;
    if (this.disposed || this.lost || g.isContextLost()) return false;
    if (frequency?.length === 512 && waveform?.length === 512) {
      this.audioBytes.set(frequency); this.audioBytes.set(waveform,512);
      g.bindTexture(g.TEXTURE_2D, this.audio.texture);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 512, 2, g.RED, g.UNSIGNED_BYTE, this.audioBytes);
      this.audio.mipmaps=false;
    }
    g.bindTexture(g.TEXTURE_2D,this.keyboard.texture);g.texSubImage2D(g.TEXTURE_2D,0,0,0,256,3,g.RED,g.UNSIGNED_BYTE,this.keyboardBytes);this.keyboard.mipmaps=false;
    for(const texture of new Set(this.passes.flatMap(pass=>pass.images)))if(texture.media){
      texture.media.setPlaying(playing,this.onStatus);
      if(texture.media.bytes){g.bindTexture(g.TEXTURE_2D,texture.texture);g.texSubImage2D(g.TEXTURE_2D,0,0,0,512,2,g.RED,g.UNSIGNED_BYTE,texture.media.update());texture.mipmaps=false;}else this.updateVideo(texture);
    }
    const completed = new Map();
    for (const pass of this.passes) {
      const write = pass.targets[1-pass.read];
      g.bindFramebuffer(g.FRAMEBUFFER, write?.fbo || null);
      const width=write?.width||this.canvas.width,height=write?.height||this.canvas.height;
      g.viewport(0,0,width,height); g.useProgram(pass.program);
      this.uniform(pass,'iResolution','uniform3f',width,height,1);
      this.uniform(pass,'iTime','uniform1f',time); this.uniform(pass,'iTimeDelta','uniform1f',delta);
      this.uniform(pass,'iFrameRate','uniform1f',delta > 0 ? 1/delta : 0);
      this.uniform(pass,'iFrame','uniform1i',this.frame); this.uniform(pass,'iSampleRate','uniform1f',this.audioHub.sampleRate||sampleRate);
      this.uniform(pass,'iMouse','uniform4fv',this.mouse);
      this.uniform(pass,'iDate','uniform4f',date.getFullYear(),date.getMonth(),date.getDate(),date.getHours()*3600+date.getMinutes()*60+date.getSeconds()+date.getMilliseconds()/1000);
      this.uniform(pass,'ctCycle','uniform1f',cycle); this.uniform(pass,'ctBeat','uniform1f',((cycle*4)%1+1)%1);
      this.uniform(pass,'ctKick','uniform1f',kick);
      for (let i=0;i<4;i++) {
        const input = inputInfo(pass.channels[i]);
        const buffer = this.passes.find(p => p.name === input.source);
        // Earlier passes are current-frame; self/later references are previous-frame.
        const texture = input.type === 'audio' ? this.audio : input.type==='keyboard'?this.keyboard:pass.images[i]||completed.get(input.source)||buffer?.targets[buffer.read]||this.empty;
        const target=texture.target||g.TEXTURE_2D;
        g.activeTexture(g.TEXTURE0+i); g.bindTexture(target,texture.texture);
        if(input.filter==='mipmap'&&!texture.mipmaps){g.generateMipmap(target);texture.mipmaps=true;}
        g.bindSampler(i,pass.samplers[i]);
        this.uniform(pass,`iChannel${i}`,'uniform1i',i);
        this.uniform(pass,`iChannelResolution[${i}]`,'uniform3f',texture.width,texture.height,texture.depth||1);
        this.uniform(pass,`iChannelTime[${i}]`,'uniform1f',texture.media ? texture.media.time??texture.media.video.currentTime : input.type === 'audio' ? time : 0);
      }
      if(pass.name==='Cube'){
        for(let face=0;face<6;face++){
          g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_CUBE_MAP_POSITIVE_X+face,write.texture,0);
          this.uniform(pass,'ctCubeFace','uniform1i',face);g.drawArrays(g.TRIANGLES,0,3);
        }
      }else g.drawArrays(g.TRIANGLES,0,3);
      if (write) {write.mipmaps=false;completed.set(pass.name,write);}
    }
    this.passes.forEach(p => { if (p.targets.length) p.read = 1-p.read; });
    this.frame++;
    this.keyboardBytes.fill(0,256,512);
    return true;
  }
  deleteTarget(target) { target.media?.close();this.gl.deleteTexture(target.texture); if (target.fbo) this.gl.deleteFramebuffer(target.fbo); }
  deletePasses(passes) {
    const images=new Set();
    for (const pass of passes) { this.gl.deleteProgram(pass.program); pass.targets.forEach(t => this.deleteTarget(t));pass.images.forEach(t=>images.add(t));pass.samplers.forEach(s=>this.gl.deleteSampler(s)); }
    images.forEach(image=>this.deleteTarget(image));
  }
  dispose() {
    if (this.disposed) return;
    for (const [name, handler] of Object.entries(this.handlers)) this.canvas.removeEventListener(name, handler);
    for(const [name,handler]of Object.entries(this.keyHandlers))window.removeEventListener(name,handler);
    if(this.previousTabIndex===null)this.canvas.removeAttribute('tabindex');else this.canvas.setAttribute('tabindex',this.previousTabIndex);
    for(const controller of this.loads)controller.abort();
    for(const previous of this.retained)if(!previous.invalid)this.deletePasses(previous.passes);this.retained.clear();
    for (const candidate of [...this.candidates]) candidate.dispose();
    this.disposed = true; this.deletePasses(this.passes); this.deleteTarget(this.audio); this.deleteTarget(this.empty);this.deleteTarget(this.keyboard);this.passes=[];this.audioHub.close(); }
}
