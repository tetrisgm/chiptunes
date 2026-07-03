class RetroRaveChipPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queueHead = 0;
    this.read = 0;
    this.paused = false;
    this.generation = 0;
    this.playedSourceFrames = 0;
    this.queuedOutputFrames = 0;
    this.underruns = 0;
    this._ticks = 0;
    this.port.onmessage = (ev) => this._message(ev.data || {});
  }

  _message(msg) {
    if (msg.type === 'reset') {
      this.queue = [];
      this.queueHead = 0;
      this.read = 0;
      this.generation = msg.generation || 0;
      this.playedSourceFrames = 0;
      this.queuedOutputFrames = 0;
      this.underruns = 0;
      this.paused = !!msg.paused;
      this._postStatus(true);
      return;
    }
    if (msg.type === 'pause') {
      this.paused = !!msg.paused;
      this._postStatus(true);
      return;
    }
    if (msg.type === 'enqueue') {
      if ((msg.generation || 0) !== this.generation || !msg.l) return;
      const l = msg.l;
      const r = msg.r || msg.l;
      const frames = Math.min(l.length || 0, r.length || 0);
      if (!frames) return;
      this.queue.push({
        l,
        r,
        frames,
        sourcePerOutput: Math.max(0, +(msg.sourceFrames || frames) / frames)
      });
      this.queuedOutputFrames += frames;
      this._compactQueue();
      this._postStatus(false);
    }
  }

  _compactQueue() {
    if (this.queueHead > 0 && (this.queueHead > 64 || this.queueHead > this.queue.length / 2)) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  _postStatus(force) {
    if (!force && (++this._ticks % 24) !== 0) return;
    this.port.postMessage({
      type: 'status',
      generation: this.generation,
      queuedOutputFrames: this.queuedOutputFrames,
      playedSourceFrames: this.playedSourceFrames,
      underruns: this.underruns,
      paused: this.paused
    });
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out && out[0];
    const R = out && (out[1] || out[0]);
    if (!L || !R) return true;
    if (this.paused) {
      L.fill(0);
      R.fill(0);
      this._postStatus(false);
      return true;
    }

    for (let i = 0; i < L.length; i++) {
      while (this.queueHead < this.queue.length && this.read >= this.queue[this.queueHead].frames) {
        this.read = 0;
        this.queueHead++;
      }
      const ch = this.queue[this.queueHead];
      if (!ch) {
        L[i] = 0;
        R[i] = 0;
        this.underruns++;
        continue;
      }
      L[i] = ch.l[this.read] || 0;
      R[i] = ch.r[this.read] || 0;
      this.read++;
      this.queuedOutputFrames = Math.max(0, this.queuedOutputFrames - 1);
      this.playedSourceFrames += ch.sourcePerOutput || 1;
    }
    this._compactQueue();
    this._postStatus(false);
    return true;
  }
}

registerProcessor('retro-rave-chip-pcm', RetroRaveChipPCM);
