// broadcaster.js — Retro Rave Radio as internet-radio streams (Roon/VLC/etc). MULTI-CHANNEL:
// one shared headless-Chromium render farm (broadcast/renderer.js) feeds N mood channels, each a
// deterministic per-mood schedule from src/live.js with its own ffmpeg encoder + HTTP mount + ICY
// identity. The default channel is Everything; /mellow, /instrumental, /melodic are the mood streams.
// The render farm is only ~15% busy per channel, so one browser serves all four; the extra cost is
// just the tiny MP3 encoders. Each channel is self-describing (ICY headers + Icecast/Shoutcast status
// + logo) so any app that opens the URL auto-discovers it. Nothing here touches the website — kill
// this and only the streams stop. Run: node broadcast/broadcaster.js [--port 1340]
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const Live = require(path.join(ROOT, 'src', 'live.js'));
const Song = require(path.join(ROOT, 'src', 'seed.js'));
const { Renderer } = require('./renderer.js');

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = +argVal('--port', process.env.RRR_STREAM_PORT || 1340);
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const SR = 48000;
const BITRATE = '192k';
const BITRATE_KBPS = 192;
const ICY_METAINT = 16000;
const BURST_BYTES = 256 * 1024;         // ~10s @192k: instant start for new clients
const DRIFT_MAX_MS = 10000;

// The channels. mood maps to src/live.js's leadMode axis; paths are the URL mounts each answers.
const CHANNELS = [
  { mood: 'everything',   name: 'Retro Rave Radio',                genre: 'Chiptune Electronic Generative Chillwave',
    desc: 'Endless generative chiptune that never plays the same track twice - a shared broadcast, in sync for everyone tuned in.',
    paths: ['/', '/everything', '/radio.mp3', '/everything.mp3', '/stream', '/;'] },
  { mood: 'mellow',       name: 'Retro Rave Radio - Mellow',       genre: 'Chiptune Chillwave Downtempo',
    desc: 'Laid-back generative chiptune - grooves up front, melody as a garnish.',
    paths: ['/mellow', '/mellow.mp3'] },
  { mood: 'instrumental', name: 'Retro Rave Radio - Instrumental', genre: 'Chiptune Electronic Instrumental',
    desc: 'Pure generative grooves - no lead line, just the pocket.',
    paths: ['/instrumental', '/instrumental.mp3'] },
  { mood: 'melodic',      name: 'Retro Rave Radio - Melodic',      genre: 'Chiptune Electronic Melodic',
    desc: 'Hook-driven generative chiptune - the melody front and center.',
    paths: ['/melodic', '/melodic.mp3'] },
];
const SITE_URL = 'https://radio.ramine.net';
const LOGO_URL = 'https://stream.ramine.net/logo.png';
let LOGO = null;
try { LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'station-icon.png')); } catch (e) {}

const now = () => Date.now();
function log(...a) { process.stdout.write('[bcast ' + new Date().toISOString() + '] ' + a.join(' ') + '\n'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function overlapAdd(body, tail) {   // add previous track's ~1.8s echo tail onto this body's head, clamped
  if (!tail || !tail.length) return body;
  const n = Math.min(body.length, tail.length);
  for (let i = 0; i < n; i++) { const v = body[i] + tail[i]; body[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
  return body;
}
function icyMetaBlock(title) {
  const s = "StreamTitle='" + String(title).replace(/'/g, '') + "';";
  const b = Buffer.from(s, 'utf8'), blocks = Math.ceil(b.length / 16);
  const out = Buffer.alloc(1 + blocks * 16); out[0] = blocks; b.copy(out, 1); return out;
}

let renderer = null, running = true;

class Channel {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.clients = new Set();
    this.burst = Buffer.alloc(0);
    this.title = this.name;
    this.pendingTail = null;
    this.ff = null;
  }
  // --- ffmpeg (raw f32le PCM in -> MP3 out) with restart supervision ---
  spawnFfmpeg() {
    const a = ['-hide_banner', '-loglevel', 'warning', '-re', '-f', 'f32le', '-ar', String(SR), '-ac', '2',
      '-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', BITRATE, '-f', 'mp3', 'pipe:1'];
    const ff = spawn(FFMPEG, a, { stdio: ['pipe', 'pipe', 'pipe'] });
    ff.stderr.on('data', d => { const s = String(d).trim(); if (s && /error|fail/i.test(s)) log('[' + this.mood + '] ffmpeg:', s); });
    ff.stdin.on('error', () => {});
    ff.stdout.on('data', c => this.broadcast(c));
    ff.on('exit', (code, sig) => { if (!running) return; log('[' + this.mood + '] ffmpeg exited (' + code + '/' + sig + ') - restarting'); this.ff = this.spawnFfmpeg(); });
    this.ff = ff; return ff;
  }
  // --- HTTP fanout ---
  pushBurst(chunk) { this.burst = Buffer.concat([this.burst, chunk]); if (this.burst.length > BURST_BYTES) this.burst = this.burst.subarray(this.burst.length - BURST_BYTES); }
  writeAudio(c, chunk) {
    if (!c.meta) { c.res.write(chunk); return; }
    let off = 0;
    while (off < chunk.length) {
      const take = Math.min(ICY_METAINT - c.bytesSinceMeta, chunk.length - off);
      c.res.write(chunk.subarray(off, off + take)); off += take; c.bytesSinceMeta += take;
      if (c.bytesSinceMeta >= ICY_METAINT) {
        if (c.sentTitle !== this.title) { c.res.write(icyMetaBlock(this.title)); c.sentTitle = this.title; }
        else c.res.write(Buffer.from([0]));
        c.bytesSinceMeta = 0;
      }
    }
  }
  broadcast(chunk) { this.pushBurst(chunk); for (const c of this.clients) { try { this.writeAudio(c, chunk); } catch (e) {} } }
  headers(wantMeta) {
    const h = {
      'content-type': 'audio/mpeg', 'cache-control': 'no-cache, no-store', 'connection': 'close',
      'icy-name': this.name, 'icy-description': this.desc, 'icy-genre': this.genre,
      'icy-url': SITE_URL, 'icy-br': String(BITRATE_KBPS), 'icy-sr': String(SR), 'icy-pub': '1',
      'icy-logo': LOGO_URL, 'ice-audio-info': `bitrate=${BITRATE_KBPS};samplerate=${SR};channels=2`,
    };
    if (wantMeta) h['icy-metaint'] = String(ICY_METAINT);
    return h;
  }
  addClient(res, wantMeta) {
    const c = { res, meta: wantMeta, bytesSinceMeta: 0, sentTitle: null };
    if (this.burst.length) { try { this.writeAudio(c, this.burst); } catch (e) {} }
    this.clients.add(c);
    const drop = () => { this.clients.delete(c); try { res.end(); } catch (e) {} };
    res.on('error', drop); res.on('close', drop);
  }
  // --- render + schedule (shared renderer, this channel's mood) ---
  descAt(nowMs) { const r = Live.moodResolveAt(this.mood, nowMs); return { blockN: r.blockN, i: r.i, offsetSec: r.offsetSec }; }
  async renderDesc(desc) {
    const pl = Live.moodBlockPlaylist(this.mood, desc.blockN);
    const slot = pl[desc.i];
    const composerId = Live.versionFor(desc.blockN).composerId;
    const rendered = await renderer.render(slot.token, composerId);
    return rendered ? { token: slot.token, slot, isStraddler: desc.i === pl.length - 1, blockN: desc.blockN, i: desc.i, rendered } : null;
  }
  feedPcm(f32) {
    return new Promise((resolve) => {
      const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
      const CH = 32 * 1024; let off = 0;
      const pump = () => {
        if (!running) return resolve();
        while (off < buf.length) {
          if (!this.ff || !this.ff.stdin.writable) { setTimeout(pump, 200); return; }
          const ok = this.ff.stdin.write(buf.subarray(off, Math.min(buf.length, off + CH)));
          off = Math.min(buf.length, off + CH);
          if (!ok) { this.ff.stdin.once('drain', pump); return; }
        }
        resolve();
      };
      pump();
    });
  }
  // SEQUENTIAL playback + drift-guarded re-anchor (stable on a loaded box; see the single-channel
  // history — re-resolving every track churned). Steady state = pure sequential play, no re-renders.
  async scheduleLoop() {
    let d = this.descAt(now());
    let joinOffset = d.offsetSec;
    let job = this.renderDesc(d);
    while (running) {
      const cur = await job;
      if (!cur) { log('[' + this.mood + '] render failed - rejoining'); await sleep(1000); d = this.descAt(now()); joinOffset = d.offsetSec; job = this.renderDesc(d); continue; }
      const slotWallStart = cur.blockN * Live.BLOCK_MS + cur.slot.start * 1000;
      const drift = now() - (slotWallStart + joinOffset * 1000);
      if (Math.abs(drift) > DRIFT_MAX_MS) {
        const r = Live.moodResolveAt(this.mood, now());
        if (r.token !== cur.token) { log('[' + this.mood + '] re-anchor drift ' + (drift / 1000).toFixed(1) + 's -> ' + Song.title(r.token)); d = { blockN: r.blockN, i: r.i }; joinOffset = r.offsetSec; job = this.renderDesc(d); continue; }
        joinOffset = r.offsetSec;
      }
      const sr = cur.rendered.sampleRate;
      const all = new Float32Array(cur.rendered.pcm.buffer, cur.rendered.pcm.byteOffset, cur.rendered.pcm.length >> 2);
      const bodyEndSec = cur.isStraddler ? (Live.BLOCK_SEC - cur.slot.start) : cur.slot.dur;
      const offSec = Math.max(0, Math.min(joinOffset, bodyEndSec - 0.1));
      const offFrame = Math.floor(offSec * sr);
      const bodyEndFrame = Math.min(all.length >> 1, Math.floor(bodyEndSec * sr));
      const body = Float32Array.from(all.subarray(offFrame * 2, bodyEndFrame * 2));
      const tail = Float32Array.from(all.subarray(bodyEndFrame * 2));
      this.title = Song.title(cur.token);
      const next = cur.isStraddler ? { blockN: cur.blockN + 1, i: 0 } : { blockN: cur.blockN, i: cur.i + 1 };
      joinOffset = 0;
      job = this.renderDesc(next);
      const mixed = overlapAdd(body, this.pendingTail);
      this.pendingTail = tail;
      await this.feedPcm(mixed);
    }
  }
  start() { this.spawnFfmpeg(); this.scheduleLoop().catch(e => log('[' + this.mood + '] loop crashed: ' + (e && e.stack || e))); }
  source() {   // Icecast status source object
    return { listenurl: 'https://stream.ramine.net' + this.paths[0], server_name: this.name, server_description: this.desc,
      server_type: 'audio/mpeg', server_url: SITE_URL, genre: this.genre, bitrate: BITRATE_KBPS, samplerate: SR, channels: 2,
      title: this.title, listeners: this.clients.size, mood: this.mood };
  }
}

const channels = CHANNELS.map(c => new Channel(c));
const byPath = {}; for (const ch of channels) for (const p of ch.paths) byPath[p] = ch;

const server = http.createServer((req, res) => {
  try {
    const p = new URL(req.url, 'http://127.0.0.1').pathname;
    if (p === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channels: channels.map(c => ({ mood: c.mood, title: c.title, listeners: c.clients.size })) })); return; }
    if (p === '/logo.png' || p === '/favicon.ico') { if (!LOGO) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); res.end(LOGO); return; }
    if (p === '/channels.json') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ station: 'Retro Rave Radio', site: SITE_URL, streams: channels.map(c => ({
        mood: c.mood, name: c.name, description: c.desc, genre: c.genre, url: 'https://stream.ramine.net' + c.paths[0],
        bitrate: BITRATE_KBPS, format: 'mp3', nowPlaying: c.title })) }, null, 2)); return; }
    if (p === '/status-json.xsl') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ icestats: { server_id: 'Retro Rave Radio', host: 'stream.ramine.net', source: channels.map(c => c.source()) } })); return; }
    if (p === '/7.html') { const c = channels[0]; res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body>${c.clients.size},1,${c.clients.size},1000,${c.clients.size},${BITRATE_KBPS},${String(c.title).replace(/[<>]/g, '')}</body></html>`); return; }
    const ch = byPath[p];
    if (!ch) { res.writeHead(404); res.end('not found'); return; }
    const wantMeta = String(req.headers['icy-metadata'] || '') === '1';
    res.writeHead(200, ch.headers(wantMeta));
    ch.addClient(res, wantMeta);
    log('[' + ch.mood + '] client + (' + ch.clients.size + ' listening)');
  } catch (e) { try { res.writeHead(500); res.end(); } catch (e2) {} log('request error: ' + (e && e.message)); }
});

async function main() {
  log('starting shared render farm (headless Chromium)…');
  renderer = new Renderer({ sampleRate: SR, log });
  await renderer.start();
  for (const ch of channels) ch.start();
  await new Promise((resolve, reject) => server.listen(PORT, '127.0.0.1', resolve).on('error', reject));
  log('streams live on 127.0.0.1:' + PORT + ' -> ' + channels.map(c => c.paths[0]).join(' '));
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return; shuttingDown = true; running = false;
  log('shutting down…');
  try { server.close(); } catch (e) {}
  for (const ch of channels) { try { if (ch.ff) { ch.ff.stdin.end(); setTimeout(() => { try { ch.ff.kill('SIGKILL'); } catch (e) {} }, 1200); } } catch (e) {} }
  (renderer ? renderer.stop() : Promise.resolve()).finally(() => process.exit(code || 0));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => log('uncaughtException: ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + (e && e.stack || e)));

main().catch(e => { log('fatal: ' + (e && e.stack || e)); process.exit(1); });
