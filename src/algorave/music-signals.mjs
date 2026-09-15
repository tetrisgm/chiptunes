// Bridge the audio clock to rendered frames. All times are seconds except the
// absolute monotonic observation timestamps, which are milliseconds.
export class MusicSignals {
  constructor() { this.snapshot = null; this.events = []; this.epoch = -1; }
  receive(signal) {
    if (signal.epoch !== this.epoch) { this.events = []; this.epoch = signal.epoch; }
    this.snapshot = signal;
    if (!signal.playing) this.events = [];
    else this.events.push(...signal.events);
    this.events = this.events.filter(e => Math.max(e.time,e.end||e.time) >= signal.time - 1).slice(-512);
  }
  highlights(observedAt) {
    if(!this.snapshot?.playing)return [];
    const {time}=this.at(observedAt);
    return this.events.filter(event=>time>=event.time&&time<event.end).flatMap(event=>(event.locations||[]).map(location=>({...location,style:event.markcss||`outline:solid 2px ${event.color||'currentColor'}`})));
  }
  at(observedAt) {
    const s = this.snapshot;
    if (!s) return {};
    // Do not extrapolate indefinitely through a suspended/backgrounded engine.
    const advance = Math.max(0, Math.min(.25, (observedAt - s.observedAt) / 1000));
    const time = s.time + advance;
    let kick = 0;
    if (s.playing) for (const event of this.events) {
      const age = time - event.time;
      if (event.sound === 'bd' && age >= 0 && age < 1) kick = Math.max(kick, Math.exp(-age * 14));
    }
    return { time, cycle: s.playing ? s.cycle + advance * s.cps : 0, kick,
      sampleRate: s.sampleRate, frequency: s.frequency, waveform: s.waveform };
  }
}
