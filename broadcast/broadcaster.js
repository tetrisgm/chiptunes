// broadcaster.js — Chiptunes.app as internet-radio streams (Roon/VLC/etc). MULTI-CHANNEL:
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
const PORT = +argVal('--port', process.env.CHIPTUNES_STREAM_PORT || process.env.RRR_STREAM_PORT || 1340);
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const SR = 48000;
const BITRATE = process.env.CHIPTUNES_STREAM_BITRATE || process.env.RRR_STREAM_BITRATE || '256k';   // 192k -> 256k: more headroom for the dense/bright synth so lossy encode adds less grit
const BITRATE_KBPS = parseInt(BITRATE, 10) || 256;
// The generated chiptune is deliberately HOT and very bright (dense broadband energy to ~18kHz). On
// lossy stream codecs (MP3 here, then YouTube's opus on top) that bright top-end smears into audible
// harshness/"crackle". A gentle high-shelf cut on the STREAM tames it without touching the website's
// direct-worklet playback. Env-tunable so it's trivial to dial or disable ('' = no filter).
const STREAM_AF = process.env.CHIPTUNES_STREAM_AF !== undefined ? process.env.CHIPTUNES_STREAM_AF : (process.env.RRR_STREAM_AF !== undefined ? process.env.RRR_STREAM_AF : 'highshelf=f=11000:g=-4');
const ICY_METAINT = 16000;
const BURST_BYTES = 256 * 1024;         // ~10s @192k: instant start for new clients
const CLIENT_MAX_BUFFER = 1024 * 1024;  // drop a stalled listener before its queued writes grow without bound
const DRIFT_MAX_MS = 10000;

// ONE station. There is a single channel following the shared schedule (src/live.js blockPlaylist) —
// no mood variants. The PRIMARY aliases (/, /radio.mp3, /stream, /; — what Roon + the YouTube leg
// consume) plus its own /everything mounts all answer this one stream.
const PRIMARY_ALIASES = ['/', '/radio.mp3', '/stream', '/;'];
const CHANNELS = [
  { mood: 'everything',   name: 'Chiptunes.app',                genre: 'Chiptune Electronic Generative Chillwave',
    desc: 'Endless generative chiptune that never plays the same track twice - a shared broadcast, in sync for everyone tuned in.',
    paths: ['/everything', '/everything.mp3'] },
];
const SITE_URL = 'https://chiptunes.app';
const LOGO_URL = 'https://stream.chiptunes.app/logo.png';
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
    this.ffFailures = 0;
    this.ffRestartTimer = null;
    this.needsReanchor = false;
    this.pcmClients = new Set();   // lossless local tap consumers (the YouTube video leg)
    this.pcmPos = 0;               // bytes since encoder start, for 8-byte (one f32 stereo frame) join alignment
    this.lastProgressAt = now();   // liveness: actual encoded MP3/PCM output; a stale value => wedged channel
  }
  // --- ffmpeg (raw f32le PCM in -> MP3 out + LOSSLESS f32le tap out) with restart supervision ---
  // The second output (fd 3) is the same -re-paced, same-tamed signal WITHOUT the MP3 generation. The
  // YouTube video leg muxes it straight to AAC over localhost, so YT listeners get PCM->AAC->opus instead
  // of PCM->MP3->AAC->opus — one lossy generation fewer, for ~zero CPU (pcm_f32le is a passthrough).
  spawnFfmpeg() {
    const a = ['-hide_banner', '-loglevel', 'warning', '-re', '-f', 'f32le', '-ar', String(SR), '-ac', '2',
      '-i', 'pipe:0',
      '-vn', ...(STREAM_AF ? ['-filter:a', STREAM_AF] : []), '-c:a', 'libmp3lame', '-b:a', BITRATE, '-f', 'mp3', 'pipe:1',
      '-vn', ...(STREAM_AF ? ['-filter:a', STREAM_AF] : []), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:3'];
    const ff = spawn(FFMPEG, a, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const startedAt = now(); let lastOutputAt = 0;
    ff.stderr.on('data', d => { const s = String(d).trim(); if (s && /error|fail/i.test(s)) log('[' + this.mood + '] ffmpeg:', s); });
    ff.stdin.on('error', () => {});
    ff.stdout.on('data', c => { if (this.ff !== ff) return; lastOutputAt = this.lastProgressAt = now(); this.broadcast(c); });
    this.pcmPos = 0;   // fresh encoder = fresh frame-aligned PCM stream
    ff.stdio[3].on('error', () => {});
    ff.stdio[3].on('data', c => { if (this.ff !== ff) return; lastOutputAt = this.lastProgressAt = now(); this.broadcastPcm(c); });
    ff.on('error', e => log('[' + this.mood + '] ffmpeg spawn error: ' + e.message));
    // `close`, unlike `exit`, means every stdio fd is closed: no old fd3 bytes can arrive after pcmPos resets.
    ff.on('close', (code, sig) => {
      if (!running || this.ff !== ff) return;
      this.ff = null;
      this.needsReanchor = true;
      this.pendingTail = null;   // the failed track's future echo must not bleed onto the wall-clock rejoin
      // An abrupt pipe close can end 1-7 bytes into an f32-stereo frame. A fresh encoder starts aligned,
      // so force raw clients to reconnect instead of concatenating a permanently misframed stream.
      this.pcmPos = 0;           // reconnects can arrive during backoff, before spawnFfmpeg resets it again
      for (const c of this.pcmClients) c.drop();
      const closedAt = now();
      if (lastOutputAt && closedAt - startedAt > 30000 && closedAt - lastOutputAt < 5000) this.ffFailures = 0;
      const delay = Math.min(10000, 500 * Math.pow(2, Math.min(this.ffFailures++, 5)));
      log('[' + this.mood + '] ffmpeg closed (' + code + '/' + sig + ') - restarting in ' + delay + 'ms');
      this.ffRestartTimer = setTimeout(() => { this.ffRestartTimer = null; if (running) this.spawnFfmpeg(); }, delay);
    });
    this.ff = ff;
    return ff;
  }
  // --- HTTP fanout ---
  pushBurst(chunk) { this.burst = Buffer.concat([this.burst, chunk]); if (this.burst.length > BURST_BYTES) this.burst = this.burst.subarray(this.burst.length - BURST_BYTES); }
  writeAudio(c, chunk) {
    if (c.res.destroyed || c.res.writableEnded || c.res.writableLength > CLIENT_MAX_BUFFER) { c.drop(); return; }
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
  // Lossless tap fanout: no burst (consumers start at the live edge); joins are aligned to an 8-byte
  // f32-stereo frame boundary (a mid-frame start would swap channels / shift samples for the whole session).
  broadcastPcm(chunk) {
    for (const c of this.pcmClients) {
      try {
        if (c.res.destroyed || c.res.writableEnded || c.res.writableLength > CLIENT_MAX_BUFFER) { c.drop(); continue; }
        let buf = chunk;
        if (c.skip) { const s = Math.min(c.skip, buf.length); buf = buf.subarray(s); c.skip -= s; }
        if (buf.length) c.res.write(buf);
      } catch (e) {}
    }
    this.pcmPos += chunk.length;
  }
  addPcmClient(res) {
    const c = { res, skip: (8 - (this.pcmPos % 8)) % 8 };
    this.pcmClients.add(c);
    c.drop = () => { this.pcmClients.delete(c); try { if (!res.destroyed) res.destroy(); } catch (e) {} };
    res.on('error', c.drop); res.on('close', c.drop);
  }
  headers(wantMeta) {
    const h = {
      'content-type': 'audio/mpeg', 'cache-control': 'no-cache, no-store', 'connection': 'close',
      'access-control-allow-origin': '*',   // so the YouTube video leg's headless page can play this stream through a (CORS-clean) MediaElementSource
      'icy-name': this.name, 'icy-description': this.desc, 'icy-genre': this.genre,
      'icy-url': SITE_URL, 'icy-br': String(BITRATE_KBPS), 'icy-sr': String(SR), 'icy-pub': '1',
      'icy-logo': LOGO_URL, 'ice-audio-info': `bitrate=${BITRATE_KBPS};samplerate=${SR};channels=2`,
    };
    if (wantMeta) h['icy-metaint'] = String(ICY_METAINT);
    return h;
  }
  addClient(res, wantMeta, sendBurst = true) {
    const c = { res, meta: wantMeta, bytesSinceMeta: 0, sentTitle: null };
    c.drop = () => { this.clients.delete(c); try { if (!res.destroyed) res.destroy(); } catch (e) {} };
    if (sendBurst && this.burst.length) { try { this.writeAudio(c, this.burst); } catch (e) {} }
    if (res.destroyed || res.writableEnded) return;
    this.clients.add(c);
    res.on('error', c.drop); res.on('close', c.drop);
  }
  // --- render + schedule (shared renderer, the one shared schedule) ---
  descAt(nowMs) { const r = Live.resolveAt(nowMs); return { blockN: r.blockN, i: r.i, offsetSec: r.offsetSec }; }
  async renderDesc(desc) {
    const pl = Live.blockPlaylist(desc.blockN);
    const slot = pl[desc.i];
    const composerId = Live.versionFor(desc.blockN).composerId;
    const rendered = await renderer.render(slot.token, composerId);
    return rendered ? { token: slot.token, slot, isStraddler: desc.i === pl.length - 1, blockN: desc.blockN, i: desc.i, rendered } : null;
  }
  feedPcm(f32) {
    const ff0 = this.ff;   // if ffmpeg respawns mid-feed, abandon this stale write so the loop advances
    return new Promise((resolve) => {
      const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
      const CH = 32 * 1024; let off = 0;
      const pump = () => {
        if (!running || this.ff !== ff0 || !ff0 || !ff0.stdin.writable) return resolve();
        while (off < buf.length) {
          const ok = ff0.stdin.write(buf.subarray(off, Math.min(buf.length, off + CH)));
          off = Math.min(buf.length, off + CH);
          if (!ok) {
            const onDrain = () => { clearTimeout(t); pump(); };
            // A healthy -re pipe drains within a chunk. A never-firing drain (wedged/dead ffmpeg) must
            // not block the loop forever — re-pump after 2s, which re-checks this.ff and bails on respawn.
            const t = setTimeout(() => { ff0.stdin.removeListener('drain', onDrain); pump(); }, 2000);
            ff0.stdin.once('drain', onDrain);
            return;
          }
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
      // Hold the one prefetched render while ffmpeg backs off. Advancing without a paced sink would
      // render/discard whole tracks in a tight loop and monopolize the shared renderer.
      while (running && !this.ff) await sleep(100);
      if (!running) break;
      const cur = await job;
      if (!cur) { log('[' + this.mood + '] render failed - rejoining'); await sleep(1000); d = this.descAt(now()); joinOffset = d.offsetSec; job = this.renderDesc(d); continue; }
      if (this.needsReanchor) {
        this.needsReanchor = false;
        const r = Live.resolveAt(now());
        d = { blockN: r.blockN, i: r.i }; joinOffset = r.offsetSec; job = this.renderDesc(d);
        continue;
      }
      const slotWallStart = cur.blockN * Live.BLOCK_MS + cur.slot.start * 1000;
      const drift = now() - (slotWallStart + joinOffset * 1000);
      if (Math.abs(drift) > DRIFT_MAX_MS) {
        const r = Live.resolveAt(now());
        if (r.token !== cur.token) { log('[' + this.mood + '] re-anchor drift ' + (drift / 1000).toFixed(1) + 's -> ' + Song.title(r.token)); d = { blockN: r.blockN, i: r.i }; joinOffset = r.offsetSec; job = this.renderDesc(d); continue; }
        joinOffset = r.offsetSec;
      }
      const sr = cur.rendered.sampleRate;
      const all = new Float32Array(cur.rendered.pcm.buffer, cur.rendered.pcm.byteOffset, cur.rendered.pcm.length >> 2);
      const bodyEndSec = cur.isStraddler ? (Live.BLOCK_SEC - cur.slot.start) : cur.slot.dur;
      const offSec = Math.max(0, Math.min(joinOffset, bodyEndSec - 0.1));
      const offFrame = Math.floor(offSec * sr);
      const bodyEndFrame = Math.min(all.length >> 1, Math.floor(bodyEndSec * sr));
      // body: zero-copy VIEW (saves a ~58MB alloc+copy per track). Safe: cur.rendered is used exactly
      // once, and overlapAdd's in-place mix then scribbles a buffer that is discarded after feedPcm
      // (which already honors byteOffset). tail STAYS a real copy — it outlives this track as pendingTail.
      const body = all.subarray(offFrame * 2, bodyEndFrame * 2);
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
  start() {
    this.spawnFfmpeg();
    // self-restart a crashed schedule loop (re-derives from the wall clock) instead of dying silently
    const run = () => this.scheduleLoop().catch(e => { log('[' + this.mood + '] loop crashed, restarting in 2s: ' + (e && e.stack || e)); if (running) setTimeout(run, 2000); });
    run();
  }
  source() {   // Icecast status source object
    return { listenurl: 'https://stream.chiptunes.app' + this.paths[0], server_name: this.name, server_description: this.desc,
      server_type: 'audio/mpeg', server_url: SITE_URL, genre: this.genre, bitrate: BITRATE_KBPS, samplerate: SR, channels: 2,
      title: this.title, listeners: this.clients.size, mood: this.mood };
  }
}

// ONE station: the single channel answers the primary mounts (radio root + /radio.pcm) as well as
// its own /everything paths. No subsetting — there is exactly one stream.
const channels = CHANNELS.map(c => new Channel(c));
const primary = channels[0];
if (primary) primary.paths = [...primary.paths, ...PRIMARY_ALIASES];
const byPath = {}; for (const ch of channels) for (const p of ch.paths) byPath[p] = ch;
// lossless local tap: every /<x>.mp3 mount also exists as /<x>.pcm (raw f32le 48k stereo, no burst/ICY)
const byPcmPath = {}; for (const ch of channels) for (const p of ch.paths) if (p.endsWith('.mp3')) byPcmPath[p.replace(/\.mp3$/, '.pcm')] = ch;

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1'), p = url.pathname;
    if (p === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channels: channels.map(c => ({ mood: c.mood, title: c.title, listeners: c.clients.size })) })); return; }
    if (p === '/logo.png' || p === '/favicon.ico') { if (!LOGO) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); res.end(LOGO); return; }
    if (p === '/channels.json') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ station: 'Chiptunes.app', site: SITE_URL, streams: channels.map(c => ({
        mood: c.mood, name: c.name, description: c.desc, genre: c.genre, url: 'https://stream.chiptunes.app' + c.paths[0],
        bitrate: BITRATE_KBPS, format: 'mp3', nowPlaying: c.title })) }, null, 2)); return; }
    if (p === '/status-json.xsl') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ icestats: { server_id: 'Chiptunes.app', host: 'stream.chiptunes.app', source: channels.map(c => c.source()) } })); return; }
    if (p === '/7.html') { const c = channels[0]; res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body>${c.clients.size},1,${c.clients.size},1000,${c.clients.size},${BITRATE_KBPS},${String(c.title).replace(/[<>]/g, '')}</body></html>`); return; }
    const pcmCh = byPcmPath[p];
    if (pcmCh) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-rrr-format': `f32le ${SR}Hz stereo`,
        'cache-control': 'no-cache, no-store', 'connection': 'close', 'access-control-allow-origin': '*' });
      pcmCh.addPcmClient(res);
      log('[' + pcmCh.mood + '] pcm tap + (' + pcmCh.pcmClients.size + ')');
      return;
    }
    const ch = byPath[p];
    if (!ch) { res.writeHead(404); res.end('not found'); return; }
    const wantMeta = String(req.headers['icy-metadata'] || '') === '1';
    res.writeHead(200, ch.headers(wantMeta));
    // The video visualizer must join at the same live edge as its no-burst PCM mux input. Public
    // listeners keep the instant-start burst; this opt-out is used only by broadcast/video.js.
    ch.addClient(res, wantMeta, url.searchParams.get('live') !== '1');
    log('[' + ch.mood + '] client + (' + ch.clients.size + ' listening)');
  } catch (e) { try { res.writeHead(500); res.end(); } catch (e2) {} log('request error: ' + (e && e.message)); }
});

async function main() {
  log('starting shared render farm (headless Chromium)…');
  renderer = new Renderer({ sampleRate: SR, log });
  await renderer.start();
  for (const ch of channels) ch.start();
  // In-process liveness heartbeat: if ANY channel stops making render/feed progress for >45s, the
  // process is wedged (the deadlock class) — exit so systemd Restart=always recovers it in ~10s at the
  // correct wall-clock position. Covers EVERY channel (the external watchdog only probes /radio.mp3).
  const STALL_MS = 45000;
  setInterval(() => {
    const stale = channels.filter(c => now() - c.lastProgressAt > STALL_MS);
    if (stale.length) { log('liveness: channels stalled [' + stale.map(c => c.mood).join(',') + '] >' + (STALL_MS / 1000) + 's — exiting for systemd restart'); shutdown(1); }
  }, 15000).unref();
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
// Log THEN exit on a fatal: a swallowed uncaught error leaves the process "active but broken" and
// Restart=always never fires (the anti-pattern that manufactures the deadlock state). shutdown() ends
// ffmpeg/renderer cleanly; systemd brings it back at the correct wall-clock position.
process.on('uncaughtException', (e) => { log('uncaughtException: ' + (e && e.stack || e)); shutdown(1); });
process.on('unhandledRejection', (e) => { log('unhandledRejection: ' + (e && e.stack || e)); shutdown(1); });

main().catch(e => { log('fatal: ' + (e && e.stack || e)); shutdown(1); });
