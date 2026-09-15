// The parent accepts data only through its private MessageChannel. Runtime messages
// are untrusted and never cause storage, network, source edits or HTML insertion.
export class MusicBridge {
  constructor(frame, onSignal = () => {}, onError = () => {}, onDiagnostic = () => {}, onDrawing = () => {}) {
    this.frame = frame;
    this.pending = new Map();
    this.nextId = 0;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.ready = new Promise((resolve, reject) => {
      this.readyTimer = setTimeout(() => reject(Error('Music engine did not start.')), 20000);
      this.port.onmessage = ({ data }) => {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'ready') { clearTimeout(this.readyTimer); resolve(data.version); }
        if (data.type === 'fatal') { clearTimeout(this.readyTimer); reject(Error(String(data.error).slice(0, 2000))); }
        if (data.type === 'runtime-error') onError(Error(String(data.error).slice(0,2000)));
        if (data.type === 'diagnostic') onDiagnostic(Error(String(data.error).slice(0,2000)));
        if (data.type === 'drawing' && typeof data.visible === 'boolean') onDrawing(data.visible);
        if (data.type === 'reply' && this.pending.has(data.id)) {
          const pending = this.pending.get(data.id);
          this.pending.delete(data.id); clearTimeout(pending.timer);
          data.error ? pending.reject(Error(String(data.error).slice(0, 2000))) : pending.resolve({ playing: data.playing === true, ...(Number.isSafeInteger(data.token) ? { token: data.token } : {}), ...(Number.isSafeInteger(data.checkpoint)?{checkpoint:data.checkpoint}:{}) });
        }
        if (data.type === 'signal' && Number.isSafeInteger(data.epoch) && Number.isFinite(data.observedAt) && Number.isFinite(data.time) && Number.isFinite(data.cycle)
          && Number.isFinite(data.cps) && Number.isFinite(data.sampleRate)
          && data.frequency instanceof Uint8Array && data.frequency.length === 512
          && data.waveform instanceof Uint8Array && data.waveform.length === 512) {
          onSignal({ epoch: data.epoch, observedAt: data.observedAt, time: data.time, cycle: data.cycle, cps: data.cps, playing: data.playing === true,
            sampleRate: data.sampleRate, frequency: data.frequency, waveform: data.waveform,
            events: Array.isArray(data.events) ? data.events.slice(0, 256).filter(e => e && Number.isFinite(e.time) && typeof e.sound === 'string').map(e => ({ time:e.time,end:Number.isFinite(e.end)?Math.max(e.time,Math.min(e.time+3600,e.end)):e.time,sound:e.sound.slice(0,64),locations:Array.isArray(e.locations)?e.locations.slice(0,32).filter(l=>l&&Number.isSafeInteger(l.start)&&Number.isSafeInteger(l.end)&&l.start>=0&&l.end>l.start&&l.end<=65536).map(l=>({start:l.start,end:l.end})):[],markcss:typeof e.markcss==='string'?e.markcss.slice(0,1024):'',color:typeof e.color==='string'?e.color.slice(0,128):'' })) : [] });
        }
      };
    });
    frame.contentWindow.postMessage({ type: 'connect' }, '*', [channel.port2]);
  }
  async request(type, source, options = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.port.postMessage({id,type:'cancel'}); reject(Error('Music evaluation timed out. Stop and reload the engine.')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      if(type==='unlock')this.frame.contentWindow.postMessage({id,type},'*');
      else this.port.postMessage({ id, type, source, sliderId:options.sliderId,value:options.value,token: options.token, play: options.play === true, samples:options.samples,assets:options.assets,restore:options.restore===true,checkpoint:options.checkpoint,checkpoints:options.checkpoints,defer:options.defer===true });
    });
  }
  dispose() {
    clearTimeout(this.readyTimer);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(Error('Music engine closed.')); }
    this.pending.clear(); this.port.close(); this.frame.remove();
  }
}
