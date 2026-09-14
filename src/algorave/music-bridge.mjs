// The parent accepts data only through its private MessageChannel. Runtime messages
// are untrusted and never cause storage, network, source edits or HTML insertion.
export class MusicBridge {
  constructor(frame, onSignal = () => {}) {
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
        if (data.type === 'reply' && this.pending.has(data.id)) {
          const pending = this.pending.get(data.id);
          this.pending.delete(data.id); clearTimeout(pending.timer);
          data.error ? pending.reject(Error(String(data.error).slice(0, 2000))) : pending.resolve({ playing: data.playing === true });
        }
        if (data.type === 'signal' && Number.isFinite(data.time) && Number.isFinite(data.cycle)
          && Number.isFinite(data.cps) && Number.isFinite(data.sampleRate)
          && data.frequency instanceof Uint8Array && data.frequency.length === 512
          && data.waveform instanceof Uint8Array && data.waveform.length === 512) {
          onSignal({ time: data.time, cycle: data.cycle, cps: data.cps, playing: data.playing === true,
            sampleRate: data.sampleRate, frequency: data.frequency, waveform: data.waveform,
            events: Array.isArray(data.events) ? data.events.slice(0, 256).filter(e => e && Number.isFinite(e.time) && typeof e.sound === 'string').map(e => ({ time: e.time, sound: e.sound.slice(0,64) })) : [] });
        }
      };
    });
    frame.contentWindow.postMessage({ type: 'connect' }, '*', [channel.port2]);
  }
  async request(type, source) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Music evaluation timed out. Stop and reload the engine.')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.port.postMessage({ id, type, source });
    });
  }
  dispose() {
    clearTimeout(this.readyTimer);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(Error('Music engine closed.')); }
    this.pending.clear(); this.port.close(); this.frame.remove();
  }
}
