import {fetchShaderBlob,IMAGE_BYTES,IMAGE_PIXELS} from './shader-images.mjs';
export const VIDEO_TYPES=['video/mp4','video/webm','video/ogg'];
export async function loadShaderVideo(src,options={}){
  return decodeShaderVideo(await fetchShaderBlob(src,{signal:options.signal,types:VIDEO_TYPES}),options);
}
// A decoded, muted video is owned by prepared GL textures. Loading never starts
// playback; retained transactions pause their old media until committed/rolled back.
export async function decodeShaderVideo(blob,{signal}={}){
  if(signal?.aborted)throw Error('Video loading cancelled.');
  if(!blob.size||blob.size>IMAGE_BYTES)throw Error('Video file must contain between 1 byte and 16 MiB.');
  const video=document.createElement('video'),url=URL.createObjectURL(blob);
  video.muted=true;video.defaultMuted=true;video.playsInline=true;video.loop=true;video.preload='auto';
  let refs=1,closed=false,wanted=false,failed=false;
  const resource={video,get width(){return video.videoWidth;},get height(){return video.videoHeight;},
    retain(){if(closed)throw Error('Video was released.');refs++;return resource;},
    setPlaying(value,onError=()=>{}){if(closed||wanted===value)return;wanted=value;
      if(!value){video.pause();return;}
      failed=false;video.play().then(()=>{if(closed||!wanted)video.pause();}).catch(error=>{if(!closed&&wanted&&!failed){failed=true;onError('Video playback failed: '+error.message);}});
    },
    close(){if(closed||--refs>0)return;closed=true;wanted=false;video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);},
  };
  try{
    await new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',errorHandler);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
      const ready=()=>finish(),errorHandler=()=>finish(Error('Video could not decode. Use a browser-supported MP4, WebM or Ogg video.')),abort=()=>finish(Error('Video loading cancelled.'));
      const timer=setTimeout(()=>finish(Error('Video loading timed out.')),15000);
      video.addEventListener('loadeddata',ready);video.addEventListener('error',errorHandler);signal?.addEventListener('abort',abort,{once:true});video.src=url;video.load();
    });
    if(!video.videoWidth||!video.videoHeight||video.videoWidth*video.videoHeight>IMAGE_PIXELS)throw Error('Video resolution is too large or invalid (16 megapixels maximum).');
    return resource;
  }catch(error){resource.close();throw error;}
}
