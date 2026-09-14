// A worker per candidate prevents failed evaluation from blocking the active
// pattern. Every request has an external deadline that terminates the worker.
export class PatternClient {
  constructor(source, {prepareMs = 3000, queryMs = 1000} = {}) {
    this.prepareMs = prepareMs; this.queryMs = queryMs; this.next = 0; this.pending = new Map(); this.closed = false;
    const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
    this.worker = new Worker(url); URL.revokeObjectURL(url);
    const channel = new MessageChannel(); this.port = channel.port1;
    this.ready = new Promise((resolve,reject)=>{
      this.rejectReady = reject;
      this.readyTimer = setTimeout(()=>this.dispose(Error('Music worker did not start.')),10000);
      this.port.onmessage = ({data})=>{
        if(data?.type==='ready'){clearTimeout(this.readyTimer);resolve();return;}
        if(data?.type==='fatal'){this.dispose(Error(String(data.error).slice(0,2000)));return;}
        const pending=this.pending.get(data?.id);
        if(!pending)return;
        this.pending.delete(data.id);clearTimeout(pending.timer);
        if(data.error)pending.reject(Error(String(data.error).slice(0,2000)));else pending.resolve(data);
      };
    });
    this.ready.catch(()=>{});
    this.worker.onerror=event=>{event.preventDefault();this.dispose(Error('Music worker failed. Your draft is preserved.'));};
    this.worker.postMessage({type:'connect'},[channel.port2]);
  }
  async request(type, data) {
    await this.ready;if(this.closed)throw Error('Music worker is closed.');
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.dispose(Error(type==='prepare'?'Music evaluation timed out. Simplify the draft and Run again.':'Pattern query timed out. Simplify the draft and Run again.')),type==='prepare'?this.prepareMs:this.queryMs);
      this.pending.set(id,{resolve,reject,timer});this.port.postMessage({id,type,...data});
    });
  }
  async prepare(source, cps, cycle) {
    const result=await this.request('prepare',{source,cps,cycle});
    if(!Number.isFinite(result.cps)||result.cps<=0||result.cps>20)throw Error('Invalid pattern tempo.');
    this.cps=result.cps;return this;
  }
  async query(begin,end,cps) {
    const result=await this.request('query',{begin,end,cps});
    if(!Array.isArray(result.events)||result.events.length>4096)throw Error('Invalid pattern event count.');
    // Structured clone removes getters/functions, but values remain untrusted.
    let bytes=0;
    for(const event of result.events){
      if(!event||!Number.isFinite(event.begin)||!Number.isFinite(event.end)||!Number.isFinite(event.duration)||event.duration<0||event.duration>1e6||event.begin<begin-1e-8||event.begin>=end+1e-8||event.end<event.begin||!event.value||typeof event.value!=='object'||Array.isArray(event.value))throw Error('Invalid pattern event.');
      controls(event.value);
      const raw=JSON.stringify(event.value);bytes+=raw.length;
      if(bytes>262144)throw Error('Invalid music controls.');
      if(event.value.orbit!==undefined&&(!Number.isInteger(event.value.orbit)||event.value.orbit<0||event.value.orbit>15))throw Error('Orbit must be between 0 and 15.');
    }
    return result.events;
  }
  dispose(error = Error('Music worker closed.')) {
    if(this.closed)return;this.closed=true;clearTimeout(this.readyTimer);this.rejectReady(error);
    this.worker.terminate();this.port.close();
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
  }
}

function controls(value, depth=0) {
  if(depth>6)throw Error('Music controls are nested too deeply.');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e9)return;
  if(typeof value==='string'&&value.length<=2048)return;
  if(Array.isArray(value)&&value.length<=128){for(const item of value)controls(item,depth+1);return;}
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
    const entries=Object.entries(value);
    if(entries.length>128)throw Error('Too many music controls.');
    for(const [key,item]of entries){
      if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid music control.');
      controls(item,depth+1);
    }
    return;
  }
  throw Error('Music controls must be serializable values.');
}
