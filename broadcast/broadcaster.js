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

const now = () => Date.now();            // wall clock (Date.now allowed here — this is a daemon, not a workflow script)
function log(...a) { process.stdout.write('[bcast ' + new Date().toISOString() + '] ' + a.join(' ') + '\n'); }

// ---------------- schedule walk (mirrors the site; overlap-add makes tails bleed, no drift) ----------------
// A "slot" descriptor = which scheduled track + where to start. renderSlot returns the track's
// interleaved-stereo PCM already sliced to its BODY (beat-grid duration, minus the join offset and
// minus any hour-boundary truncation) plus its TAIL (the ~1.8s echo ring-out). The feeder overlap-
// ADDS each track's tail onto the head of the next body — gapless like the site's cold-open segue,
// and total played time == sum of beat-grid durations, so the stream never drifts off wall clock.
function startDescriptor() {
  const r = Live.resolveAt(now());
  return { blockN: r.blockN, i: r.i, offsetSec: r.offsetSec };
}
async function renderSlot(renderer, d) {
  const pl = Live.blockPlaylist(d.blockN);
  const slot = pl[d.i];
  const isStraddler = (d.i === pl.length - 1);
  const composerId = Live.versionFor(d.blockN).composerId;
  const r = await renderer.render(slot.token, composerId);
  if (!r) return null;
  const sr = r.sampleRate;
  const all = new Float32Array(r.pcm.buffer, r.pcm.byteOffset, r.pcm.length >> 2);   // interleaved LR
  const offFrame = Math.max(0, Math.floor((d.offsetSec || 0) * sr));
  // body ends at the beat-grid duration (or the hour boundary for the straddler); tail is the rest
  const bodyEndSec = isStraddler ? (Live.BLOCK_SEC - slot.start) : slot.dur;
  const bodyEndFrame = Math.min(all.length >> 1, Math.floor(bodyEndSec * sr));
  const body = all.subarray(offFrame * 2, bodyEndFrame * 2);
  const tail = all.subarray(bodyEndFrame * 2);
  const next = isStraddler
    ? { blockN: d.blockN + 1, i: 0, offsetSec: 0 }
    : { blockN: d.blockN, i: d.i + 1, offsetSec: 0 };
  return { body: Float32Array.from(body), tail: Float32Array.from(tail), sr, next, token: slot.token, title: Song.title(slot.token) };
}
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

const server = http.createServer((req, res) => {
  try {   // a malformed request must NEVER crash the daemon (headers are latin1-only, etc.)
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, clients: clients.size, title: curTitle })); return; }
    if (url.pathname !== '/radio.mp3' && url.pathname !== '/') { res.writeHead(404); res.end('not found'); return; }
    const wantMeta = String(req.headers['icy-metadata'] || '') === '1';
    const headers = {   // HTTP header values must be ASCII/latin1 — no em-dashes or other unicode
      'content-type': 'audio/mpeg', 'cache-control': 'no-cache, no-store', 'connection': 'close',
      'icy-name': 'Retro Rave Radio', 'icy-description': 'Endless generative chiptune - the live broadcast', 'icy-genre': 'Chiptune',
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

async function scheduleLoop() {
  let desc = startDescriptor();
  let pendingTail = null;
  // render the first slot, then always render the NEXT while feeding the current (renders beat realtime)
  let slotP = renderSlot(renderer, desc);
  while (running) {
    let slot = await slotP;
    if (!slot) { log('render failed for a slot — retrying from current wall position'); await new Promise(r => setTimeout(r, 1000)); desc = startDescriptor(); slotP = renderSlot(renderer, desc); continue; }
    slotP = renderSlot(renderer, slot.next);   // prefetch next while we feed this one
    curTitle = slot.title;
    log('on air: ' + slot.title + '  (' + slot.token + ')  clients=' + clients.size);
    const body = overlapAdd(slot.body, pendingTail);
    pendingTail = slot.tail;
    await feedPcm(body);
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
