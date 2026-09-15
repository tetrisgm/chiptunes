// Camera frames stay in local WebGL. No device request occurs while preparing
// source, loading a project, or retaining an Undo transaction.
export function createShaderCamera({maxSize=4096}={}){
  const video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;
  let refs=1,closed=false,wanted=false,generation=0,stream=null;
  const stop=()=>{generation++;video.pause();if(stream)for(const track of stream.getTracks())track.stop();stream=null;video.srcObject=null;};
  const resource={kind:'webcam',video,get width(){return video.videoWidth||1;},get height(){return video.videoHeight||1;},
    retain(){if(closed)throw Error('Camera was released.');refs++;return resource;},
    setPlaying(value,onError=()=>{}){
      if(closed||wanted===value)return;wanted=value;if(!value){stop();return;}
      const token=++generation;
      const fail=error=>{if(closed||token!==generation||!wanted)return;stop();onError('Camera unavailable: '+(error.message||error)+'. Stop and Play to try again.');};
      if(!navigator.mediaDevices?.getUserMedia){fail(Error('this browser needs a secure page with camera support'));return;}
      navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280,max:maxSize},height:{ideal:720,max:maxSize}}}).then(async acquired=>{
        if(closed||token!==generation||!wanted){for(const track of acquired.getTracks())track.stop();return;}
        stream=acquired;video.srcObject=stream;
        for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>fail(Error('camera access ended')),{once:true});
        try{await video.play();}catch(error){fail(error);}
      },fail);
    },
    close(){if(closed||--refs>0)return;closed=true;wanted=false;stop();},
  };
  return resource;
}
