import {IMAGE_BYTES,decodeShaderImage} from './shader-images.mjs';
import {decodeShaderAudio} from './shader-audio.mjs';
import {decodeShaderVideo} from './shader-video.mjs';
import {isVolume,parseVolume,VOLUME_TYPE} from './shader-volume.mjs';
export const IMAGE_LIMITS=Object.freeze({fileBytes:IMAGE_BYTES,totalBytes:64*1024*1024,count:32});
// Identify encoded content independently of the filename or the archive metadata.
// A browser decode is still required before activating or saving imported content.
export function imageType(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>IMAGE_BYTES)throw Error('Invalid image file size (16 MiB maximum).');
  if(isVolume(bytes)){parseVolume(bytes);return VOLUME_TYPE;}
  const word=(start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
  if(word(0,4)==='RIFF'&&word(8,4)==='WAVE')return 'audio/wav';
  if(word(0,4)==='fLaC')return 'audio/flac';
  if(word(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224)return 'audio/mpeg';
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if([26,69,223,163].every((v,i)=>bytes[i]===v))return 'video/webm';
  if(word(0,4)==='OggS')return 'video/ogg';
  if(word(0,4)==='RIFF'&&word(8,4)==='WEBP')return 'image/webp';
  if(['GIF87a','GIF89a'].includes(word(0,6)))return 'image/gif';
  if(word(0,2)==='BM')return 'image/bmp';
  if(word(4,4)==='ftyp'){
    const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
    if(size>=16&&size<=bytes.length&&size%4===0){
      for(let offset=8;offset<size;offset+=4)if(offset!==12&&['avif','avis'].includes(word(offset,4)))return 'image/avif';
      for(let offset=8;offset<size;offset+=4)if(offset!==12&&['M4A ','M4B '].includes(word(offset,4)))return 'audio/mp4';
      for(let offset=8;offset<size;offset+=4)if(offset!==12&&['isom','iso2','mp41','mp42','avc1','M4V ','qt  '].includes(word(offset,4)))return 'video/mp4';
    }
  }
  throw Error('Use a PNG, JPEG, WebP, AVIF, GIF, BMP image, MP4/WebM/Ogg video audio, or Shadertoy .bin volume.');
}
export class ImageByteStore {
  #items=new Map();#total=0;
  async put(input){
    const bytes=input instanceof Uint8Array?Uint8Array.from(input):input;imageType(bytes);
    const id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(!this.#items.has(id)){
      if(this.#items.size>=IMAGE_LIMITS.count||this.#total+bytes.length>IMAGE_LIMITS.totalBytes)throw Error('Image collection is full (32 files or 64 MiB).');
      this.#items.set(id,bytes);this.#total+=bytes.length;
    }
    return Object.freeze({id,byteLength:bytes.length});
  }
  has(id){return this.#items.has(id);}
  get(id){const bytes=this.#items.get(id);if(!bytes)throw Error('Imported image content is missing.');return bytes.slice();}
  blob(id){const bytes=this.get(id);return new Blob([bytes],{type:imageType(bytes)});}
  fork(){const store=new ImageByteStore();store.#items=new Map(this.#items);store.#total=this.#total;return store;}
  snapshot(){return {count:this.#items.size,byteLength:this.#total,assets:[...this.#items].map(([id,bytes])=>({id,byteLength:bytes.length}))};}
}

export async function validateVisualAsset(blob,{audio=false}={}){
  const type=imageType(new Uint8Array(await blob.arrayBuffer()));
  if(audio||type.startsWith('audio/')){await decodeShaderAudio(blob);return type.replace('video/','audio/');}
  if(type.startsWith('video/')){try{(await decodeShaderVideo(blob)).close();}catch(error){await decodeShaderAudio(blob);return type.replace('video/','audio/');}}
  else if(type!==VOLUME_TYPE)(await decodeShaderImage(blob)).close();
  return type;
}
