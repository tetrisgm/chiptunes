// broadcaster.js — Retro Rave Radio as a real internet-radio stream (Phase 2, for Roon/VLC/etc).
// Follows the SAME src/live.js clock schedule as the website, renders each scheduled track to PCM
// (broadcast/renderer.js — the app's own Engine.render), splices them GAPLESS + SAMPLE-ALIGNED via
// echo-tail overlap-add, and pipes the result through one long-lived ffmpeg -> MP3, fanned out over
// a tiny HTTP server (chunked audio/mpeg + ICY now-playing titles). Nothing here touches the website:
// kill this and only the Roon stream stops. Run: node broadcast/broadcaster.js [--port 1340]
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
const ICY_METAINT = 16000;
const BURST_BYTES = 256 * 1024;         // ~10s @192k: instant start for new clients

// STATION metadata — this is how the stream DESCRIBES ITSELF so any radio app (Roon, VLC,
// hardware) that opens the URL auto-discovers name/genre/site/bitrate/logo/now-playing without
// the listener typing anything. Exposed three ways: ICY response headers, an Icecast-compatible
// /status-json.xsl, and a Shoutcast-legacy /7.html. (The richer directory-only fields — tags,
// keywords, explicit/ad-free badges — still require a real directory listing; see the README.)
const STATION = {
  name: 'Retro Rave Radio',
  description: 'Endless generative chiptune that never plays the same track twice - a shared broadcast, in sync for everyone tuned in.',
  genre: 'Chiptune Electronic Generative Chillwave',
  url: 'https://radio.ramine.net',
  bitrateKbps: 192,
  logoUrl: 'https://stream.ramine.net/logo.png',
  contentType: 'audio/mpeg',
};
let LOGO = null;   // assets/station-icon.png, loaded at startup, served at /logo.png
try { LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'station-icon.png')); } catch (e) { /* served 404 if absent */ }

const now = () => Date.now();            // wall clock (Date.now allowed here — this is a daemon, not a workflow script)
function log(...a) { process.stdout.write('[bcast ' + new Date().toISOString() + '] ' + a.join(' ') + '\n'); }

// ---------------- schedule walk (SEQUENTIAL playback + drift-guarded re-anchor) ----------------
// Play the schedule's tracks in deterministic sequence (stable, gapless: the next track is always
// prefetched during the current one, so there is never a feed gap). Only when playback has drifted
// >DRIFT_MAX from the wall clock — the ~15s first-render latency at startup, or slow-box rate jitter
// — do we RE-ANCHOR to the true on-air position. This is stable where the earlier "re-resolve every
// track from now()" churned: on a loaded 2-core box that re-rendered near every boundary (audible
// gaps). Now re-anchor fires ~once at startup and rarely after; steady state is pure sequential play.
const DRIFT_MAX_MS = 10000;
async function renderDesc(desc) {
  const pl = Live.blockPlaylist(desc.blockN);
  const slot = pl[desc.i];
  const composerId = Live.versionFor(desc.blockN).composerId;
  const rendered = await renderer.render(slot.token, composerId);
  if (!rendered) return null;
  return { token: slot.token, slot, isStraddler: desc.i === pl.length - 1, blockN: desc.blockN, i: desc.i, rendered };
}
function descAt(nowMs) { const r = Live.resolveAt(nowMs); return { blockN: r.blockN, i: r.i, offsetSec: r.offsetSec }; }
function overlapAdd(body, tail) {   // add previous track's tail onto this body's head, clamped
  if (!tail || !tail.length) return body;
  const n = Math.min(body.length, tail.length);
  for (let i = 0; i < n; i++) { let v = body[i] + tail[i]; body[i] = v > 1 ? 1 : (v < -1 ? -1 : v); }
  return body;
}

// ---------------- ffmpeg: raw f32le PCM in -> MP3 out ----------------
function spawnFfmpeg() {
  const a = ['-hide_banner', '-loglevel', 'warning', '-re',
    '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0',
    '-vn', '-c:a', 'libmp3lame', '-b:a', BITRATE, '-f', 'mp3', 'pipe:1'];
  const ff = spawn(FFMPEG, a, { stdio: ['pipe', 'pipe', 'pipe'] });
  ff.stderr.on('data', d => { const s = String(d).trim(); if (s) log('ffmpeg:', s); });
  ff.stdin.on('error', () => {});   // EPIPE when ffmpeg dies mid-write — the exit handler restarts it
  return ff;
}

// ---------------- HTTP fanout (chunked MP3 + ICY metadata) ----------------
const clients = new Set();
let burst = Buffer.alloc(0);
let curTitle = 'Retro Rave Radio';

function pushBurst(chunk) { burst = Buffer.concat([burst, chunk]); if (burst.length > BURST_BYTES) burst = burst.subarray(burst.length - BURST_BYTES); }

function icyMetaBlock(title) {
  const s = "StreamTitle='" + String(title).replace(/'/g, '') + "';";
  const b = Buffer.from(s, 'utf8');
  const blocks = Math.ceil((b.length) / 16);
  const out = Buffer.alloc(1 + blocks * 16);
  out[0] = blocks;                 // length byte = number of 16-byte blocks
  b.copy(out, 1);                  // rest is null-padded
  return out;
}
// write audio to a client, injecting ICY metadata at each metaint boundary if the client asked
function writeAudio(c, chunk) {
  if (!c.meta) { c.res.write(chunk); return; }
  let off = 0;
  while (off < chunk.length) {
    const room = ICY_METAINT - c.bytesSinceMeta;
    const take = Math.min(room, chunk.length - off);
    c.res.write(chunk.subarray(off, off + take));
    off += take; c.bytesSinceMeta += take;
    if (c.bytesSinceMeta >= ICY_METAINT) {
      if (c.sentTitle !== curTitle) { c.res.write(icyMetaBlock(curTitle)); c.sentTitle = curTitle; }
      else { c.res.write(Buffer.from([0])); }   // no change: single zero byte
      c.bytesSinceMeta = 0;
    }
  }
}
function broadcast(chunk) {
  pushBurst(chunk);
  for (const c of clients) { try { writeAudio(c, chunk); } catch (e) { /* drop; 'close' cleans up */ } }
}

// Icecast-compatible status doc — directory scrapers + apps that speak the Icecast API read this
// to auto-fill the whole station (name, description, genre, url, bitrate, current track, listeners).
function statusJson() {
  return JSON.stringify({ icestats: {
    server_id: 'Retro Rave Radio', host: 'stream.ramine.net',
    source: {
      listenurl: 'https://stream.ramine.net/', server_name: STATION.name,
      server_description: STATION.description, server_type: STATION.contentType,
      server_url: STATION.url, genre: STATION.genre, bitrate: STATION.bitrateKbps,
      samplerate: SR, channels: 2, stream_start_iso8601: null,
      title: curTitle, listeners: clients.size, 'audio-info': `bitrate=${STATION.bitrateKbps};samplerate=${SR};channels=2`,
    },
  } });
}

const server = http.createServer((req, res) => {
  try {   // a malformed request must NEVER crash the daemon (headers are latin1-only, etc.)
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, clients: clients.size, title: curTitle })); return; }
    // self-describing endpoints (station logo + Icecast/Shoutcast status APIs)
    if (url.pathname === '/logo.png' || url.pathname === '/favicon.ico') {
      if (!LOGO) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); res.end(LOGO); return;
    }
    if (url.pathname === '/status-json.xsl') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(statusJson()); return;
    }
    if (url.pathname === '/7.html') {   // Shoutcast v1 legacy stats line: listeners,status,peak,max,unique,bitrate,song
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body>${clients.size},1,${clients.size},1000,${clients.size},${STATION.bitrateKbps},${String(curTitle).replace(/[<>]/g, '')}</body></html>`); return;
    }
    if (url.pathname !== '/radio.mp3' && url.pathname !== '/' && url.pathname !== '/;' && url.pathname !== '/stream') { res.writeHead(404); res.end('not found'); return; }
    const wantMeta = String(req.headers['icy-metadata'] || '') === '1';
    const headers = {   // HTTP header values must be ASCII/latin1 — no em-dashes or other unicode.
      // ICY headers = how a stream self-describes to any radio app that opens the URL.
      'content-type': STATION.contentType, 'cache-control': 'no-cache, no-store', 'connection': 'close',
      'icy-name': STATION.name, 'icy-description': STATION.description, 'icy-genre': STATION.genre,
      'icy-url': STATION.url, 'icy-br': String(STATION.bitrateKbps), 'icy-sr': String(SR), 'icy-pub': '1',
      'icy-logo': STATION.logoUrl, 'ice-audio-info': `bitrate=${STATION.bitrateKbps};samplerate=${SR};channels=2`,
    };
    if (wantMeta) headers['icy-metaint'] = String(ICY_METAINT);
    res.writeHead(200, headers);
    const c = { res, meta: wantMeta, bytesSinceMeta: 0, sentTitle: null };
    if (burst.length) { try { writeAudio(c, burst); } catch (e) {} }   // instant start
    clients.add(c);
    const drop = () => { clients.delete(c); try { res.end(); } catch (e) {} };
    req.on('close', drop); res.on('error', drop); req.on('error', drop);
    log('client + (' + clients.size + ' listening) meta=' + wantMeta);
  } catch (e) { try { res.writeHead(500); res.end(); } catch (e2) {} log('request error: ' + (e && e.message)); }
});

// ---------------- supervisor ----------------
let running = true, ff = null, renderer = null, feedResolve = null;

function pipeFfmpegOut(f) {
  f.stdout.on('data', broadcast);
  f.on('exit', (code, sig) => {
    if (!running) return;
    log('ffmpeg exited (' + code + '/' + sig + ') — restarting, replaying burst');
    ff = spawnFfmpeg(); pipeFfmpegOut(ff);
    // the feeder writes to `ff.stdin`; it reads the live `ff` ref each write, so it recovers next chunk
  });
}
// write a Float32Array (interleaved) to ffmpeg stdin, respecting backpressure (= ffmpeg -re realtime pacing)
function feedPcm(f32) {
  return new Promise((resolve) => {
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const CH = 32 * 1024;
    let off = 0;
    const pump = () => {
      if (!running) return resolve();
      while (off < buf.length) {
        if (!ff || !ff.stdin.writable) { setTimeout(pump, 200); return; }   // ffmpeg mid-restart: wait
        const end = Math.min(buf.length, off + CH);
        const ok = ff.stdin.write(buf.subarray(off, end));
        off = end;
        if (!ok) { ff.stdin.once('drain', pump); return; }
      }
      resolve();
    };
    pump();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function scheduleLoop() {
  let pendingTail = null;
  let d = descAt(now());
  let joinOffset = d.offsetSec;              // mid-track only for the first body / after a re-anchor
  let job = renderDesc(d);
  while (running) {
    const cur = await job;
    if (!cur) { log('render failed — rejoining at current wall position'); await sleep(1000); d = descAt(now()); joinOffset = d.offsetSec; job = renderDesc(d); continue; }
    // DRIFT GUARD: compare this body's SCHEDULED wall start to now. Off by >DRIFT_MAX (startup
    // latency / slow-box jitter) -> re-anchor to the true on-air position. Fires ~once at startup;
    // steady state is stable sequential play (no per-track re-render, so no audible gaps).
    const slotWallStart = cur.blockN * Live.BLOCK_MS + cur.slot.start * 1000;
    const drift = now() - (slotWallStart + joinOffset * 1000);
    if (Math.abs(drift) > DRIFT_MAX_MS) {
      const r = Live.resolveAt(now());
      if (r.token !== cur.token) {
        log('re-anchor: drift ' + (drift / 1000).toFixed(1) + 's -> ' + Song.title(r.token));
        d = { blockN: r.blockN, i: r.i }; joinOffset = r.offsetSec; job = renderDesc(d); continue;
      }
      joinOffset = r.offsetSec;   // same track still on air — just fix the offset, keep the render
      log('re-sync: drift ' + (drift / 1000).toFixed(1) + 's within ' + Song.title(cur.token));
    }
    // slice body from joinOffset to the beat-grid end (or hour boundary for the straddler); tail = rest
    const sr = cur.rendered.sampleRate;
    const all = new Float32Array(cur.rendered.pcm.buffer, cur.rendered.pcm.byteOffset, cur.rendered.pcm.length >> 2);
    const bodyEndSec = cur.isStraddler ? (Live.BLOCK_SEC - cur.slot.start) : cur.slot.dur;
    const offSec = Math.max(0, Math.min(joinOffset, bodyEndSec - 0.1));
    const offFrame = Math.floor(offSec * sr);
    const bodyEndFrame = Math.min(all.length >> 1, Math.floor(bodyEndSec * sr));
    const body = Float32Array.from(all.subarray(offFrame * 2, bodyEndFrame * 2));
    const tail = Float32Array.from(all.subarray(bodyEndFrame * 2));
    curTitle = Song.title(cur.token);
    log('on air: ' + curTitle + '  (' + cur.token + ')  +' + offSec.toFixed(0) + 's  clients=' + clients.size);
    // advance to the next scheduled track (deterministic sequential = stable + gapless) and prefetch it
    const next = cur.isStraddler ? { blockN: cur.blockN + 1, i: 0 } : { blockN: cur.blockN, i: cur.i + 1 };
    joinOffset = 0;
    job = renderDesc(next);
    const mixed = overlapAdd(body, pendingTail);
    pendingTail = tail;
    await feedPcm(mixed);
  }
}

async function main() {
  log('starting renderer (headless Chromium render farm)…');
  renderer = new Renderer({ sampleRate: SR, log });
  await renderer.start();
  ff = spawnFfmpeg(); pipeFfmpegOut(ff);
  await new Promise((resolve, reject) => server.listen(PORT, '127.0.0.1', resolve).on('error', reject));
  log('stream live: http://127.0.0.1:' + PORT + '/radio.mp3  (add this URL in Roon/VLC)');
  scheduleLoop().catch(e => { log('schedule loop crashed: ' + (e && e.stack || e)); shutdown(1); });
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return; shuttingDown = true; running = false;
  log('shutting down…');
  try { server.close(); } catch (e) {}
  try { if (ff) { ff.stdin.end(); setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, 1500); } } catch (e) {}
  (renderer ? renderer.stop() : Promise.resolve()).finally(() => process.exit(code || 0));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
// 24/7 daemon: a stray socket/pipe error must not take down the whole render pipeline. Log and
// keep going; a genuinely fatal state is caught by the schedule-loop/renderer paths (or launchd).
process.on('uncaughtException', (e) => { log('uncaughtException: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { log('unhandledRejection: ' + (e && e.stack || e)); });

main().catch(e => { log('fatal: ' + (e && e.stack || e)); process.exit(1); });
