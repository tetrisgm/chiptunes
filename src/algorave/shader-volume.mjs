import {IMAGE_BYTES,fetchShaderBlob} from './shader-images.mjs';
export const VOLUME_TYPE='application/x-shadertoy-volume';
export const isVolume=bytes=>bytes.length>=4&&bytes[0]===66&&bytes[1]===73&&bytes[2]===78&&bytes[3]===10;
// Shadertoy BIN\n: little-endian uint32 width, height, depth, components,
// followed by unsigned byte voxels, x fastest, then y, then z.
export function parseVolume(bytes,{vflip=false}={}){
  if(!(bytes instanceof Uint8Array)||bytes.length<21||bytes.length>IMAGE_BYTES||!isVolume(bytes))throw Error('Use a Shadertoy .bin volume (16 MiB maximum).');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const [width,height,depth,components]=[4,8,12,16].map(offset=>header.getUint32(offset,true));
  const length=width*height*depth*components;
  if(!width||!height||!depth||components<1||components>4||!Number.isSafeInteger(length)||length!==bytes.length-20)throw Error('Volume dimensions or voxel data are invalid.');
  const source=bytes.subarray(20),data=Uint8Array.from(source);
  if(vflip){const row=width*components;for(let z=0;z<depth;z++)for(let y=0;y<height;y++)data.set(source.subarray((z*height+y)*row,(z*height+y+1)*row),(z*height+height-1-y)*row);}
  return {width,height,depth,components,data,close(){}};
}
export async function decodeShaderVolume(blob,{signal,vflip=false}={}){
  if(signal?.aborted)throw Error('Texture loading cancelled.');
  if(!blob.size||blob.size>IMAGE_BYTES)throw Error('Volume file must contain between 21 bytes and 16 MiB.');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(signal?.aborted)throw Error('Texture loading cancelled.');
  return parseVolume(bytes,{vflip});
}
export async function loadShaderVolume(src,options={}){
  return decodeShaderVolume(await fetchShaderBlob(src,{signal:options.signal,types:[VOLUME_TYPE,'application/octet-stream','binary/octet-stream']}),options);
}
