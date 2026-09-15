// Sound is rendered offscreen so asynchronous PCM generation cannot alter the
// live Image/buffer context. The caller owns committing the resulting buffer.
export const SOUND_SECONDS=180;
const SIZE=256,BLOCK=SIZE*SIZE;
const vertex=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
export async function renderShaderSound(source,{common='',sampleRate=44100,duration=SOUND_SECONDS,signal,channels=[],bindInputs=()=>{},onProgress=()=>{}}={}){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!Number.isFinite(duration)||duration<=0||duration>SOUND_SECONDS)throw Error('Invalid Sound duration or sample rate.');
  if(typeof source!=='string'||typeof common!=='string'||source.length>65536||common.length>65536)throw Error('Sound code is too large.');
  if(channels.length>4||channels.some(type=>!['sampler2D','samplerCube','sampler3D'].includes(type)))throw Error('Invalid Sound channel type.');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;
  const g=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
  if(!g)throw Error('Sound needs WebGL 2.');
  const shaders=[],program=g.createProgram();
  let texture,framebuffer;
  const check=()=>{if(signal?.aborted)throw Error('Sound rendering cancelled.');if(g.isContextLost())throw Error('Sound graphics context was lost.');};
  try{
    check();
    const header=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform float iSampleRate;
uniform vec3 iChannelResolution[4];
uniform vec4 iDate;
uniform int ctSampleOffset;
out vec4 ctSound;
#define texture2D texture
#define textureCube texture
${Array.from({length:4},(_,i)=>`uniform ${channels[i]||'sampler2D'} iChannel${i};`).join('\n')}
`;
    const main=`
void main(){
 int samp=ctSampleOffset+int(gl_FragCoord.x)+256*int(gl_FragCoord.y);
 vec2 v=clamp(mainSound(samp,float(samp)/iSampleRate),-1.,1.);
 vec2 packed=floor((v*.5+.5)*65535.+.5);
 ctSound=vec4(mod(packed.x,256.),floor(packed.x/256.),mod(packed.y,256.),floor(packed.y/256.))/255.;
}`;
    for(const [kind,code]of [[g.VERTEX_SHADER,vertex],[g.FRAGMENT_SHADER,header+'\n#line 1 1\n'+common+'\n#line 1 0\n'+source+main]]){
      const shader=g.createShader(kind);shaders.push(shader);g.shaderSource(shader,code);g.compileShader(shader);
      if(!g.getShaderParameter(shader,g.COMPILE_STATUS))throw Error('Sound: '+g.getShaderInfoLog(shader));g.attachShader(program,shader);
    }
    g.linkProgram(program);if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error('Sound: '+g.getProgramInfoLog(program));
    texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,texture);g.texStorage2D(g.TEXTURE_2D,1,g.RGBA8,SIZE,SIZE);
    framebuffer=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
    if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Sound framebuffer allocation failed.');
    g.disable(g.DITHER);g.disable(g.BLEND);g.viewport(0,0,SIZE,SIZE);g.useProgram(program);
    g.uniform1f(g.getUniformLocation(program,'iSampleRate'),sampleRate);
    for(let i=0;i<4;i++)g.uniform1i(g.getUniformLocation(program,'iChannel'+i),i);
    const date=new Date();g.uniform4f(g.getUniformLocation(program,'iDate'),date.getFullYear(),date.getMonth(),date.getDate(),date.getHours()*3600+date.getMinutes()*60+date.getSeconds()+date.getMilliseconds()/1000);
    const buffer=new AudioBuffer({numberOfChannels:2,length:Math.ceil(sampleRate*duration),sampleRate});
    const left=buffer.getChannelData(0),right=buffer.getChannelData(1),bytes=new Uint8Array(BLOCK*4),offset=g.getUniformLocation(program,'ctSampleOffset');
    for(let start=0;start<buffer.length;start+=BLOCK){
      check();bindInputs(g,program,start/sampleRate);
      g.useProgram(program);g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.viewport(0,0,SIZE,SIZE);g.uniform1i(offset,start);
      g.drawArrays(g.TRIANGLES,0,3);g.readPixels(0,0,SIZE,SIZE,g.RGBA,g.UNSIGNED_BYTE,bytes);
      check();if(g.getError()!==g.NO_ERROR)throw Error('Sound rendering failed.');
      const count=Math.min(BLOCK,buffer.length-start);
      for(let i=0;i<count;i++){const j=i*4;left[start+i]=(bytes[j]+256*bytes[j+1])/65535*2-1;right[start+i]=(bytes[j+2]+256*bytes[j+3])/65535*2-1;}
      onProgress(Math.min(1,(start+count)/buffer.length));
      // Yield between blocks so Stop can cancel a long shader render.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    check();return buffer;
  }finally{
    if(framebuffer)g.deleteFramebuffer(framebuffer);if(texture)g.deleteTexture(texture);
    g.deleteProgram(program);shaders.forEach(shader=>g.deleteShader(shader));g.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
