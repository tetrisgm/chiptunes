// renderer.js — the broadcaster's pure-Node audio source. It turns live-schedule tokens into raw
// stereo PCM through the app's unchanged Audio.Engine.render implementation, backed by the
// Rust-based node-web-audio-api rather than a headless-Chromium render farm.
'use strict';

const { NodeRenderEngine } = require('./node-render.js');

class Renderer {
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 48000;
    this.log = opts.log || (() => {});
    this.node = new NodeRenderEngine();
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.node.start();
    this.started = true;
  }

  // Render one live token -> { sampleRate, frames, pcm: Buffer(f32le interleaved LR) }.
  // SERIALIZED: the broadcaster's mood channels share this renderer. Keeping the established
  // mutex preserves deterministic resource use and prevents four large offline buffers from
  // landing in RAM at once even though pure-Node renders are now much faster than Chromium.
  async render(token, composerId) {
    const previous = this._q || Promise.resolve();
    let done;
    this._q = new Promise(resolve => { done = resolve; });
    // Belt-and-suspenders behind both node-render attempts: a wedged predecessor must never pin the
    // queue forever, while a healthy cold render must never be overlapped by another audio context.
    try { await Promise.race([previous, new Promise(r => setTimeout(r, 195000))]); } catch (e) {}
    try { return await this._render(token, composerId); } finally { done(); }
  }

  async _render(token, composerId) {
    if (!this.started) await this.start();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.node.render(token, composerId, this.sampleRate);
      } catch (e) {
        this.log(`render ${token} attempt ${attempt + 1} failed: ${e && e.message || e}`);
        try { this.node.reset(); } catch (resetError) {
          this.log('node audio reset failed: ' + (resetError && resetError.message || resetError));
        }
      }
    }
    return null; // caller decides fallback (never substitute a random token — that desyncs schedule)
  }

  async stop() {
    this.node.stop();
    this.started = false;
  }
}

module.exports = { Renderer };
