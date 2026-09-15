import {fetchShaderBlob,IMAGE_BYTES} from './shader-images.mjs';
export const AUDIO_TYPES=['audio/wav','audio/x-wav','audio/wave','audio/mpeg','audio/mp3','audio/ogg','audio/webm','audio/mp4','audio/flac','audio/x-flac','video/ogg','video/webm','video/mp4'];
export function createShaderAudioHub(){
  let context;
  return {get context(){return context??=new AudioContext();},get sampleRate(){return context?.sampleRate;},
    unlock(){return this.context.resume();},suspend(){if(context?.state==='running')void context.suspend().catch(()=>{});},
    close(){if(context&&context.state!=='closed')void context.close().catch(()=>{});},
  };
}
export async function decodeShaderAudio(blob,{signal}={}){
  if(signal?.aborted)throw Error('Audio loading cancelled.');
  if(!blob.size||blob.size>IMAGE_BYTES)throw Error('Audio files must be at most 16 MiB.');
  const context=new OfflineAudioContext(2,128,44100),buffer=await context.decodeAudioData(await blob.arrayBuffer());
  if(signal?.aborted)throw Error('Audio loading cancelled.');
  if(buffer.length*buffer.numberOfChannels>32*1024*1024)throw Error('Decoded audio is too large (32 million samples maximum).');
  return buffer;
}
export async function loadShaderAudio(src,options={}){return decodeShaderAudio(await fetchShaderBlob(src,{signal:options.signal,types:AUDIO_TYPES}),options);}
export function createShaderAudio(hub,{buffer=null,microphone=false,loop=true}={}){
  let refs=1,closed=false,wanted=false,generation=0,source=null,stream=null,analyser=null,started=0,offset=0;
  const bytes=new Uint8Array(1024);bytes.fill(128,512);
  const clock=()=>{
    if(!source)return offset;
    const elapsed=hub.context.currentTime-started;
    if(microphone)return elapsed;
    return loop?(offset+elapsed)%buffer.duration:Math.min(buffer.duration,offset+elapsed);
  };
  const stop=()=>{generation++;if(source){offset=clock();if(!microphone)source.stop();source.disconnect();source=null;}if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;bytes.fill(0,0,512);bytes.fill(128,512);};
  const resource={kind:microphone?'mic':loop?'music':'sound',width:512,height:2,bytes,sampleCount:buffer?buffer.length*buffer.numberOfChannels:0,get time(){return clock();},
    retain(){if(closed)throw Error('Audio input was released.');refs++;return resource;},
    setPlaying(value,onError=()=>{}){
      if(closed||wanted===value)return;wanted=value;if(!value){stop();return;}
      const token=++generation,context=hub.context;
      const fail=error=>{if(closed||token!==generation||!wanted)return;stop();onError('Audio input unavailable: '+(error.message||error)+'. Stop and Play to try again.');};
      const connect=()=>{
        if(!analyser){analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.8;analyser.minDecibels=-100;analyser.maxDecibels=-30;if(!microphone)analyser.connect(context.destination);}
        started=context.currentTime;source.connect(analyser);
      };
      const begin=async()=>{
        await context.resume();if(closed||token!==generation||!wanted)return;
        if(microphone){
          if(!navigator.mediaDevices?.getUserMedia)throw Error('microphone needs a secure page and browser support');
          const acquired=await navigator.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
          if(closed||token!==generation||!wanted){acquired.getTracks().forEach(track=>track.stop());return;}
          stream=acquired;source=context.createMediaStreamSource(stream);offset=0;
          stream.getTracks().forEach(track=>track.addEventListener('ended',()=>fail(Error('microphone access ended')),{once:true}));connect();
        }else{source=context.createBufferSource();source.buffer=buffer;source.loop=loop;if(!loop&&offset>=buffer.duration)offset=0;connect();const active=source;active.onended=()=>{if(source!==active||token!==generation)return;offset=buffer.duration;active.disconnect();source=null;bytes.fill(0,0,512);bytes.fill(128,512);};source.start(0,offset);}
      };
      begin().catch(fail);
    },
    update(){if(source&&analyser){analyser.getByteFrequencyData(bytes.subarray(0,512));analyser.getByteTimeDomainData(bytes.subarray(512));}return bytes;},
    close(){if(closed||--refs>0)return;closed=true;wanted=false;stop();analyser?.disconnect();analyser=null;buffer=null;},
  };
  return resource;
}
