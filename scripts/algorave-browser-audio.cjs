'use strict';
// Real Web Audio DSP with a silent sink, isolated from intermittent host-device
// failures. This is NOT a speaker/device or native Safari playback check.
// https://developer.chrome.com/blog/audiocontext-setsinkid
const audioSink=process.env.ALGORAVE_AUDIO_DEVICE==='default'?'default':'none';
let announced=false;
async function configureAudio(page){
  if(!announced){console.log(`Chromium audio verification sink: ${audioSink}${audioSink==='none'?' (DSP/analyser only; no speaker assertion)':''}`);announced=true;}
  if(audioSink==='default')return;
  await page.addInitScript(()=>{
    const Native=globalThis.AudioContext;
    if(!Native||!('setSinkId' in Native.prototype))throw Error('Silent Web Audio sink is unavailable.');
    globalThis.AudioContext=class extends Native {
      constructor(options={}){super({...options,sinkId:{type:'none'}});if(this.sinkId?.type!=='none')throw Error('Silent Web Audio sink was not selected.');}
    };
  });
}
module.exports={configureAudio,audioSink};
