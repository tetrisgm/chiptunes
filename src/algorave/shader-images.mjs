// Decode public image inputs before touching the working GL passes.
export const IMAGE_BYTES = 16 * 1024 * 1024;
export const IMAGE_PIXELS = 16 * 1024 * 1024;
export async function loadShaderImage(src, {signal,vflip=false}={}) {
  const response=await fetch(src,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal});
  const reject=async message=>{await response.body?.cancel().catch(()=>{});throw Error(message);};
  if(!response.ok)return reject('Texture download failed: HTTP '+response.status);
  const type=response.headers.get('content-type')?.split(';')[0].trim();
  if(!['image/png','image/jpeg','image/webp','image/avif','image/gif','image/bmp'].includes(type))return reject('Texture must be a PNG, JPEG, WebP, AVIF, GIF or BMP image.');
  const size=Number(response.headers.get('content-length'));
  if(size>IMAGE_BYTES)return reject('Texture file is too large (16 MiB maximum).');
  const reader=response.body?.getReader();if(!reader)throw Error('Texture download has no body.');
  const chunks=[];let length=0,complete=false;
  try{
    for(;;){const {value,done}=await reader.read();if(done){complete=true;break;}
      length+=value.byteLength;if(length>IMAGE_BYTES)throw Error('Texture file is too large (16 MiB maximum).');chunks.push(value);
    }
  }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(signal?.aborted)throw Error('Texture loading cancelled.');
  const bitmap=await createImageBitmap(new Blob(chunks,{type}),{imageOrientation:vflip?'flipY':'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
  if(signal?.aborted||bitmap.width*bitmap.height>IMAGE_PIXELS){bitmap.close();throw Error(signal?.aborted?'Texture loading cancelled.':'Texture resolution is too large (16 megapixels maximum).');}
  return bitmap;
}

export const imageKey=input=>JSON.stringify([input.src,input.vflip===true]);
