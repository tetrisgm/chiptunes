// renderer.js — the broadcaster's audio source: a headless-Chromium render FARM that turns
// live-schedule tokens into raw stereo PCM, using the app's own Audio.Engine.render (the SAME
// master chain as the site, so the stream's loudness matches what browsers hear). This is the
// audition harness's proven render path (scripts/audition-generated-music.js) minus the WAV/
// metrics — it emits interleaved Float32 instead, and hard-fails silent renders (peak==0 was
// a real offline-render-race failure mode). One browser, one page, restated between tracks on
// error; renders run much faster than realtime so the daemon can stay a track ahead of wall clock.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function mimeFor(f) {
  if (f.endsWith('.html')) return 'text/html; charset=utf-8';
  if (f.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (f.endsWith('.json')) return 'application/json; charset=utf-8';
  if (f.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}
// private loopback server over dist/ — /packs and /lib must 404 rather than SPA-fallback
function startDistServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      const noFallback = rel.startsWith('packs/') || rel.startsWith('lib/');
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (noFallback) { res.writeHead(404); res.end('not found'); return; }
        file = path.join(DIST, 'index.html');
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(500); res.end(String(err.message || err)); return; }
        res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

class Renderer {
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 48000;
    this.log = opts.log || (() => {});
    this.browser = null; this.page = null; this.server = null; this.url = null;
    this._chunks = [];
  }

  async start() {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing — run `node build.js`');
    const { chromium } = require('playwright');
    const s = await startDistServer();
    this.server = s.server; this.url = s.url;
    this.browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
    await this._newPage();
  }

  async _newPage() {
    if (this.page) { try { await this.page.close(); } catch (e) {} this.page = null; }
    const page = await this.browser.newPage();
    await page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof Audio !== 'undefined' && Audio.Engine && typeof Audio.Engine.render === 'function' && window.CT_COMPOSERS,
      null, { timeout: 20000 }
    );
    await page.exposeFunction('__rrrEmitPcm', (b64) => { this._chunks.push(Buffer.from(b64, 'base64')); });
    this.page = page;
  }

  // Render one live token -> { sampleRate, frames, pcm: Buffer(f32le interleaved LR) }.
  // composerId comes from the live schedule (version-pinned); we compile in-page through it.
  async render(token, composerId) {
    composerId = composerId || 'rrr_core';
    for (let attempt = 0; attempt < 2; attempt++) {
      this._chunks.length = 0;
      try {
        const meta = await this.page.evaluate(async ({ token, composerId, sr }) => {
          const comp = (window.CT_COMPOSERS && window.CT_COMPOSERS[composerId]) ||
            (window.CT_COMPOSERS && window.CT_COMPOSERS.rrr_core);
          if (!comp) throw new Error('composer ' + composerId + ' not registered');
          const score = comp.compile(token);
          const buf = await Audio.Engine.render(score, { sampleRate: sr });
          const L = buf.left, R = buf.right || buf.left, n = L.length;
          const inter = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
          const bytes = new Uint8Array(inter.buffer);
          const CH = 1 << 20;
          for (let off = 0; off < bytes.length; off += CH) {
            const slice = bytes.subarray(off, Math.min(bytes.length, off + CH));
            let s = '';
            for (let i = 0; i < slice.length; i += 0x8000) s += String.fromCharCode.apply(null, slice.subarray(i, Math.min(slice.length, i + 0x8000)));
            await window.__rrrEmitPcm(btoa(s));
          }
          return { sr: buf.sampleRate || sr, frames: n };
        }, { token, composerId, sr: this.sampleRate });

        const pcm = Buffer.concat(this._chunks);
        // hard silence gate: a full-length zero render (the offline worklet race) must never air
        let peak = 0;
        for (let i = 0; i + 4 <= pcm.length; i += 4 * 64) { const v = Math.abs(pcm.readFloatLE(i)); if (v > peak) peak = v; }
        if (peak === 0) throw new Error('render is PURE SILENCE (peak 0)');
        return { sampleRate: meta.sr, frames: meta.frames, pcm };
      } catch (e) {
        this.log(`render ${token} attempt ${attempt + 1} failed: ${e && e.message || e}`);
        try { await this._newPage(); } catch (e2) { this.log('page relaunch failed: ' + (e2 && e2.message)); }
      }
    }
    return null;   // caller decides fallback (never substitute a random token — that desyncs the schedule)
  }

  async stop() {
    try { if (this.page) await this.page.close(); } catch (e) {}
    try { if (this.browser) await this.browser.close(); } catch (e) {}
    try { if (this.server) this.server.close(); } catch (e) {}
    this.page = this.browser = this.server = null;
  }
}

module.exports = { Renderer };
