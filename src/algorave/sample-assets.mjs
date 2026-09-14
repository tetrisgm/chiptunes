// Data-only preparation for external samples. No executable source runs here.
// Kept separate from the live runtime until bank activation/persistence is wired.
export const SAMPLE_LIMITS=Object.freeze({fileBytes:4*1024*1024,totalBytes:16*1024*1024,count:32,timeoutMs:10000});
// Uncompressed WAV keeps decoded memory predictable before invoking Web Audio.
// Compressed/RF64/extensible formats need separate bounded decoders first.
export function inspectSampleWav(bytes,outputSampleRate=48000){
  if(!Number.isInteger(outputSampleRate)||outputSampleRate<8000||outputSampleRate>192000)throw Error('Unsupported audio output sample rate.');
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<44||bytes.byteLength>SAMPLE_LIMITS.fileBytes)throw Error('Invalid sample WAV size.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const word=offset=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(word(0)!=='RIFF'||word(8)!=='WAVE'||view.getUint32(4,true)+8!==bytes.length)throw Error('Use a complete RIFF/WAVE sample.');
  let format=null,data=null,offset=12;
  while(offset<bytes.length){
    if(offset+8>bytes.length)throw Error('Truncated WAV chunk.');
    const type=word(offset),size=view.getUint32(offset+4,true),start=offset+8,end=start+size;
    if(end>bytes.length||end+(size%2)>bytes.length)throw Error('Truncated WAV chunk.');
    if(type==='fmt '){
      if(format||size<16)throw Error('Invalid WAV format chunk.');
      format={encoding:view.getUint16(start,true),channels:view.getUint16(start+2,true),sampleRate:view.getUint32(start+4,true),byteRate:view.getUint32(start+8,true),blockAlign:view.getUint16(start+12,true),bits:view.getUint16(start+14,true)};
    }
    if(type==='data'){if(data!==null)throw Error('Use a single WAV data chunk.');data=size;}
    offset=end+(size%2);
  }
  if(!format||data===null||!data)throw Error('WAV format or audio data is missing.');
  const {encoding,channels,sampleRate,byteRate,blockAlign,bits}=format;
  if(![1,2].includes(channels)||sampleRate<8000||sampleRate>96000||
    !(encoding===1&&[8,16,24,32].includes(bits)||encoding===3&&bits===32)||
    blockAlign!==channels*bits/8||byteRate!==sampleRate*blockAlign||data%blockAlign)
    throw Error('Use mono/stereo PCM or float32 WAV at 8–96 kHz.');
  const frames=data/blockAlign,duration=frames/sampleRate;
  if(duration>30)throw Error('Sample exceeds the 30-second limit.');
  // decodeAudioData resamples to the AudioContext rate. Round upward for the
  // reservation; using the file rate would undercount a 22 kHz sample at 48 kHz.
  const decodedFrames=Math.ceil(frames*outputSampleRate/sampleRate);
  return Object.freeze({channels,sampleRate,frames,duration,outputSampleRate,decodedBytes:decodedFrames*channels*4});
}
export function sampleURL(value){
  if(typeof value!=='string'||value.length>2048)throw Error('Invalid sample URL.');
  let url;try{url=new URL(value);}catch{throw Error('Invalid sample URL.');}
  // Public raw files only. No application origin, credentials, redirect service,
  // localhost or general-purpose proxy. Custom source hosts can be added only
  // with a reviewed policy; never fetch a worker-supplied arbitrary URL.
  if(url.protocol!=='https:'||url.hostname!=='raw.githubusercontent.com'||url.port||url.username||url.password||url.search||url.hash)
    throw Error('Use a public HTTPS raw.githubusercontent.com sample URL without credentials or query parameters.');
  return url.href;
}
export async function fetchSample(value,{fetcher=globalThis.fetch,signal,timeoutMs=SAMPLE_LIMITS.timeoutMs}={}){
  const url=sampleURL(value);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>SAMPLE_LIMITS.timeoutMs)throw Error('Invalid sample deadline.');
  const controller=new AbortController();let reader,timer,listener,aborted;
  const cancelled=new Promise((_,reject)=>{
    aborted=()=>reject(Error('Sample download cancelled or timed out.'));
    controller.signal.addEventListener('abort',aborted,{once:true});
  });
  listener=()=>controller.abort();signal?.addEventListener('abort',listener,{once:true});
  if(signal?.aborted)controller.abort();
  timer=setTimeout(()=>controller.abort(),timeoutMs);
  const read=async()=>{
    if(controller.signal.aborted)throw Error('Sample download cancelled or timed out.');
    const response=await fetcher(url,{method:'GET',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
    if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('Sample download cancelled or timed out.');}
    if(!response.ok||response.redirected||!response.body){void response.body?.cancel().catch(()=>{});throw Error('Sample download failed.');}
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>SAMPLE_LIMITS.fileBytes)){
      void response.body.cancel().catch(()=>{});throw Error('Sample exceeds the 4 MiB download limit.');
    }
    reader=response.body.getReader();const chunks=[];let length=0;
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw Error('Invalid sample response.');
      length+=value.byteLength;if(length>SAMPLE_LIMITS.fileBytes)throw Error('Sample exceeds the 4 MiB download limit.');
      chunks.push(value);
    }
    if(!length)throw Error('Sample is empty.');
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {url,bytes};
  };
  try{return await Promise.race([read(),cancelled]);}
  finally{
    clearTimeout(timer);signal?.removeEventListener('abort',listener);controller.signal.removeEventListener('abort',aborted);
    controller.abort();if(reader)void reader.cancel().catch(()=>{});
  }
}
export class SampleByteStore {
  #items=new Map();#total=0;
  // Content identity survives a URL rename; every returned buffer is detached
  // from the stored bytes. This accounts for encoded bytes, not decoded PCM.
  async put(input){
    if(!(input instanceof Uint8Array)||!input.byteLength||input.byteLength>SAMPLE_LIMITS.fileBytes)throw Error('Sample must contain between 1 byte and 4 MiB.');
    const bytes=input.slice();
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    const id=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(!this.#items.has(id)){
      if(this.#items.size>=SAMPLE_LIMITS.count||this.#total+bytes.byteLength>SAMPLE_LIMITS.totalBytes)throw Error('Sample collection is full (32 files or 16 MiB).');
      this.#items.set(id,bytes);this.#total+=bytes.byteLength;
    }
    return Object.freeze({id,byteLength:bytes.byteLength});
  }
  get(id){const bytes=this.#items.get(id);if(!bytes)throw Error('Sample content is missing.');return bytes.slice();}
  snapshot(){return {count:this.#items.size,byteLength:this.#total,assets:[...this.#items].map(([id,bytes])=>({id,byteLength:bytes.byteLength}))};}
}
