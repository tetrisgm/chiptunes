// video.js — Phase 3: the YouTube 24/7 video leg. A persistent headless-Chromium /radio page
// (game visuals + the live audio, inherently in sync because it's ONE page tuned to the shared
// broadcast) taps canvas.captureStream + Audio.captureStream(), records webm/vp8+opus, and ships
// 1s chunks over a localhost WebSocket to ffmpeg, which transcodes to H.264/AAC and pushes FLV to
// YouTube RTMP. Encoder defaults to libx264 (works on the Oracle Linux/ARM target AND locally);
// on macOS you can set VIDEO_ENC=h264_videotoolbox for near-zero-CPU local runs.
//
// Standalone dry-run (proves the whole pipeline to a local file, no YouTube needed):
//   node broadcast/video.js --dry-run /tmp/rrr-yt-dryrun.flv --seconds 15
// Live:
//   YT_STREAM_KEY=xxxx node broadcast/video.js
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY_FILE = args.includes('--dry-run') ? argVal('--dry-run', '/tmp/rrr-yt-dryrun.flv') : null;
const DRY_SECONDS = +argVal('--seconds', 15);
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const VIDEO_ENC = process.env.VIDEO_ENC || 'libx264';
const W = +(process.env.VIDEO_W || 1920), H = +(process.env.VIDEO_H || 1080), FPS = +(process.env.VIDEO_FPS || 30);
const VBITRATE = process.env.VIDEO_BITRATE || '8000k';   // 1080p30 @ ~8Mbps (YouTube's rec). 1080p60 does NOT hold realtime even on 4 OCPU.

function log(...a) { process.stdout.write('[video ' + new Date().toISOString() + '] ' + a.join(' ') + '\n'); }

function mimeFor(f) { return f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.json') ? 'application/json' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'; }
function startDistServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, '')); if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      const noFallback = rel.startsWith('packs/') || rel.startsWith('lib/');
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { if (noFallback) { res.writeHead(404); res.end(); return; } file = path.join(DIST, 'index.html'); }
      fs.readFile(file, (e, b) => { if (e) { res.writeHead(500); res.end(); return; } res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' }); res.end(b); });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

// minimal RFC6455 server (binary frames, unmasked from us / masked from the browser) so the page
// can stream MediaRecorder chunks to Node without base64-over-CDP at video bitrates.
function startWsSink(onChunk) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 2) {
          const op = buf[0] & 0x0f, masked = buf[1] & 0x80; let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          const need = off + (masked ? 4 : 0) + len; if (buf.length < need) break;
          let payload;
          if (masked) { const mk = buf.subarray(off, off + 4); payload = Buffer.alloc(len); for (let i = 0; i < len; i++) payload[i] = buf.subarray(off + 4)[i] ^ mk[i & 3]; }
          else payload = buf.subarray(off, off + len);
          buf = buf.subarray(need);
          if (op === 0x8) { try { socket.end(); } catch (e) {} return; }        // close
          if ((op === 0x2 || op === 0x0) && payload.length) onChunk(Buffer.from(payload));  // binary
        }
      });
      socket.on('error', () => {}); socket.on('close', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function spawnFfmpeg(target) {
  // webm (vp8/opus) in -> H.264/AAC FLV out. -fps_mode cfr (MediaRecorder webm is VFR; YouTube wants CFR).
  // NO -re (MediaRecorder is already realtime) and NO nobuffer/probesize (those are raw-PCM-only; webm needs probing).
  const enc = VIDEO_ENC === 'h264_videotoolbox'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', '9000k', '-realtime', '1']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', '9000k', '-pix_fmt', 'yuv420p'];
  const a = ['-hide_banner', '-loglevel', 'warning', '-i', 'pipe:0',
    '-fps_mode', 'cfr', '-r', String(FPS), ...enc, '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-flvflags', 'no_duration_filesize', '-f', 'flv', target];
  const ff = spawn(FFMPEG, a, { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.stdin.on('error', () => {});
  return ff;
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing — run `node build.js`');
  const target = DRY_FILE || ('rtmp://a.rtmp.youtube.com/live2/' + (process.env.YT_STREAM_KEY || ''));
  if (!DRY_FILE && !process.env.YT_STREAM_KEY) throw new Error('set YT_STREAM_KEY (or use --dry-run <file>)');

  const { chromium } = require('playwright');
  const dist = await startDistServer();
  let ff = spawnFfmpeg(target);
  let bytes = 0;
  const ws = await startWsSink((chunk) => { bytes += chunk.length; if (ff && ff.stdin.writable) ff.stdin.write(chunk); });
  log('encoder=' + VIDEO_ENC + ' ' + W + 'x' + H + '@' + FPS + ' -> ' + (DRY_FILE ? ('dry-run file ' + target) : 'YouTube RTMP'));

  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(dist.url + 'radio', { waitUntil: 'domcontentloaded' });
  // arm audio + go live, then start capturing canvas + master audio into one MediaStream
  const started = await page.evaluate(async ({ wsPort, fps }) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    try { if (typeof startAudio === 'function') startAudio(true); if (Audio.resume) Audio.resume(true); } catch (e) {}
    // wait for live audio to actually be running (up to ~15s)
    for (let i = 0; i < 150; i++) { if (Audio.running && Audio.running() && Audio.trackToken && Audio.trackToken()) break; await sleep(100); }
    const cv = document.getElementById('stage');
    if (!cv) return { ok: false, err: 'no #stage canvas' };
    const vtrack = cv.captureStream(fps).getVideoTracks()[0];
    const astream = Audio.captureStream ? Audio.captureStream() : null;
    const atrack = astream && astream.getAudioTracks()[0];
    if (!atrack) return { ok: false, err: 'no audio track (captureStream null)' };
    const mixed = new MediaStream([vtrack, atrack]);
    const rec = new MediaRecorder(mixed, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 4500000, audioBitsPerSecond: 192000 });
    const sock = new WebSocket('ws://127.0.0.1:' + wsPort);
    sock.binaryType = 'arraybuffer';
    window.__rrrRec = rec; window.__rrrSock = sock;
    await new Promise((res) => { sock.onopen = res; sock.onerror = res; });
    rec.ondataavailable = (e) => { if (e.data && e.data.size && sock.readyState === 1) e.data.arrayBuffer().then(b => sock.send(b)); };
    rec.start(1000);   // 1s timeslice
    return { ok: true, hidden: document.hidden, vis: document.visibilityState, running: !!(Audio.running && Audio.running()), token: Audio.trackToken && Audio.trackToken() };
  }, { wsPort: ws.port, fps: FPS });

  log('page capture: ' + JSON.stringify(started));
  if (!started.ok) { log('FATAL: ' + started.err); }

  if (DRY_FILE) {
    await page.waitForTimeout(DRY_SECONDS * 1000);
    try { await page.evaluate(() => { window.__rrrRec && window.__rrrRec.stop(); window.__rrrSock && window.__rrrSock.close(); }); } catch (e) {}
    await page.waitForTimeout(800);
    ff.stdin.end();
    await new Promise(r => ff.on('exit', r));
    await browser.close(); dist.server.close(); ws.server.close();
    log('dry-run wrote ' + target + ' (' + (bytes / 1024 / 1024).toFixed(1) + ' MB of webm ingested)');
    return;
  }

  // live: keep running; supervise below (SIGINT to stop)
  const stop = async () => { try { ff.stdin.end(); } catch (e) {} try { await browser.close(); } catch (e) {} try { dist.server.close(); ws.server.close(); } catch (e) {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

main().catch(e => { log('fatal: ' + (e && e.stack || e)); process.exit(1); });
