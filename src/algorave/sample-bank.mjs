import {inspectSampleWav} from './sample-assets.mjs';
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
// One instance per audio frame. Upstream keeps decoded buffers for that frame's
// lifetime, including loads that fail after caching; reservations never shrink.
export class SampleBank {
  #assets=new Map();#banks=new Map();#decoded=0;#closed=false;
  constructor({sampleRate,loadBuffer,registerSamples,createURL=bytes=>URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})),revokeURL=url=>URL.revokeObjectURL(url),decodedLimit=64*1024*1024,assetLimit=32,bankLimit=64}){
    if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||![decodedLimit,assetLimit,bankLimit].every(n=>Number.isSafeInteger(n)&&n>0)||typeof loadBuffer!=='function'||typeof registerSamples!=='function')throw Error('Invalid sample-bank configuration.');
    Object.assign(this,{sampleRate,loadBuffer,registerSamples,createURL,revokeURL,decodedLimit,assetLimit,bankLimit});
  }
  async #load(id,input){
    if(this.#closed)throw Error('Sample bank is closed.');
    if(!validId(id)||!(input instanceof Uint8Array))throw Error('Invalid sample content.');
    const bytes=input.slice(),info=inspectSampleWav(bytes,this.sampleRate);
    if(await hash(bytes)!==id)throw Error('Sample content does not match its saved identity.');
    if(this.#closed)throw Error('Sample bank is closed.');
    if(this.#assets.has(id))return this.#assets.get(id).ready;
    if(this.#assets.size>=this.assetLimit||this.#decoded+info.decodedBytes>this.decodedLimit)throw Error('Audio sample memory is full. Reload the workspace to load a new collection.');
    const record={url:null,ready:null,decodedBytes:info.decodedBytes};
    this.#decoded+=info.decodedBytes;this.#assets.set(id,record);
    record.ready=Promise.resolve().then(async()=>{
      if(this.#closed)throw Error('Sample bank is closed.');
      record.url=this.createURL(bytes);
      const buffer=await this.loadBuffer(record.url);
      if(this.#closed)throw Error('Sample bank is closed.');
      if(!buffer||buffer.sampleRate!==this.sampleRate||buffer.numberOfChannels!==info.channels||!Number.isSafeInteger(buffer.length)||buffer.length<1||buffer.length*buffer.numberOfChannels*4>info.decodedBytes)
        throw Error('Decoded sample differs from its validated WAV layout.');
      return record.url;
    });
    return record.ready;
  }
  async prepare(map,resolveAsset){
    if(this.#closed)throw Error('Sample bank is closed.');
    if(!map||typeof map!=='object'||Array.isArray(map)||typeof resolveAsset!=='function')throw Error('Invalid sample map.');
    const entries=Object.entries(map).map(([name,ids])=>[name,Array.isArray(ids)?[...ids]:ids]);
    if(entries.length>32)throw Error('Too many sample names.');
    for(const [name,ids] of entries)if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||['constructor','prototype'].includes(name)||!Array.isArray(ids)||!ids.length||ids.length>32||!ids.every(validId))throw Error('Invalid sample name or content list.');
    const mapping=Object.create(null);
    for(const [name,ids] of entries){
      const alias='ctasset_'+await hash(new TextEncoder().encode(JSON.stringify(ids)));
      if(this.#closed)throw Error('Sample bank is closed.');
      if(!this.#banks.has(alias)){
        if(this.#banks.size>=this.bankLimit)throw Error('Too many sample-bank variations. Reload the workspace to load a new collection.');
        // Reserve before any await. Failed preparations cannot repeatedly grow
        // upstream caches, nor replace a previously registered logical name.
        const ready=Promise.resolve().then(async()=>{
          const urls=[];for(const id of ids)urls.push(await this.#load(id,resolveAsset(id)));
          if(this.#closed)throw Error('Sample bank is closed.');
          await this.registerSamples({[alias]:urls});return alias;
        });
        this.#banks.set(alias,ready);
      }
      mapping[name]=await this.#banks.get(alias);
    }
    Object.freeze(mapping);
    return Object.freeze({mapping,resolve(value){
      const logical=value.bank&&value.s?`${value.bank}_${value.s}`:value.s;
      const alias=typeof logical==='string'?mapping[logical.toLowerCase()]:null;
      if(!alias)return {...value};
      const next={...value,s:alias};delete next.bank;return next;
    }});
  }
  snapshot(){return {assets:this.#assets.size,banks:this.#banks.size,decodedBytes:this.#decoded,closed:this.#closed};}
  close(){if(this.#closed)return;this.#closed=true;for(const record of this.#assets.values())if(record.url)this.revokeURL(record.url);}
}
