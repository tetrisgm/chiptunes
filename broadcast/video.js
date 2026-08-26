// video.js — Phase 3: the YouTube 24/7 video leg. A persistent headless-Chromium /radio page renders the
// game visuals; MediaRecorder records the canvas to webm/vp8 and ships 1s chunks over a localhost WebSocket
// to ffmpeg, which re-encodes to H.264 and pushes FLV to YouTube RTMP. On the box the AUDIO is DECOUPLED:
// ffmpeg muxes the clean local MP3 directly (see the AUDIO note below), so the sound never rides through the
// browser. Encoder defaults to libx264 (Oracle Linux/ARM AND local); on macOS set VIDEO_ENC=h264_videotoolbox
// for near-zero-CPU local runs.
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
// The render loop (game raster) and the WebAudio synth are the CPU pigs, both resolution-INDEPENDENT.
// On a GPU-less box we cap the page's render FPS (frees ~4x on a 60fps loop nobody watches locally).
//
// AUDIO (DECOUPLED — the box default): the leg captures VIDEO ONLY; ffmpeg muxes the box's clean local MP3
// (VIDEO_AUDIO_URL) as the timeline MASTER (input 0). So the audio is byte-for-byte the Roon stream and never
// rides through the jittery, load-sensitive browser — the browser plays that MP3 only to drive the reactive
// visuals. This is THE crackle fix: an earlier attempt muxed the MP3 as a SECOND live input, and two
// independent clocks (VFR browser video + the MP3) made ffmpeg starve the audio to hold sync -> ~1 dropout/sec
// = the "crackle". Making the audio the master and the video a conforming passenger fixed it. Coupled (audio in
// the same webm, VIDEO_AUDIO_URL unset) is the local-dry-run fallback but ties audio to the browser (synth
// underruns / MediaRecorder timestamp jitter), so the box always runs decoupled.
const RENDER_FPS = +(process.env.VIDEO_RENDER_FPS || FPS);       // cap the page's own render loop (default: match capture)
const AUDIO_URL = process.env.VIDEO_AUDIO_URL || '';             // SET => decoupled (ffmpeg reads this MP3 as master; box default); '' => coupled synth (dry-run fallback)
const AV_OFFSET = +(process.env.VIDEO_AV_OFFSET || 0);           // video timestamp shift in seconds; negative advances video (decoupled only)
// Match the broadcaster's stream tame (highshelf) so the coupled browser audio isn't harsher than Roon.
const VIDEO_AF = process.env.VIDEO_AF !== undefined ? process.env.VIDEO_AF : 'highshelf=f=11000:g=-4';
// The webm the browser records is an intermediate over localhost (free bandwidth) that ffmpeg re-encodes,
// so keep it GENEROUS — if it's starved, the flat game colors are already grainy before x264 ever sees them.
const WEBM_BPS = +(process.env.VIDEO_WEBM_BPS || 12000000);
// ffmpeg can remain alive after both tee/FIFO RTMP outputs have reached EOF. In that state systemd still
// sees a healthy process while no encoded packets leave the box. `-progress pipe:3` below is the source of
// truth: if its output timestamp/frame stops advancing for this long, restart the WHOLE leg. Repeated known
// EOF/FIFO diagnostics trip sooner. The knobs exist only to make the watchdog deterministically testable.
const OUTPUT_STALL_MS = +(process.env.VIDEO_OUTPUT_STALL_MS || 60000);
const OUTPUT_CHECK_MS = +(process.env.VIDEO_OUTPUT_CHECK_MS || 10000);
const WEDGE_WINDOW_MS = +(process.env.VIDEO_WEDGE_WINDOW_MS || 30000);
const WEDGE_HITS = +(process.env.VIDEO_WEDGE_HITS || 3);
// CAPTURE path. 'mediarecorder' (default) records the canvas to VP8 via MediaRecorder, which ffmpeg then
// DECODES and re-encodes to H.264 — TWO encodes, and the VP8 pass is the box's biggest CPU hog (~3 cores at
// 720p). 'x11grab' cuts it: run HEADED Chrome on a virtual X display (Xvfb) and let ffmpeg grab RAW frames off
// that display (a memcpy, ~free), then do the ONE cheap H.264 encode. No VP8, no MediaRecorder — that frees
// the headroom the 4-core box needs for 720p. Requires `xvfb` + the full (non-shell) Chromium. Linux only.
const CAPTURE = (process.env.VIDEO_CAPTURE || 'mediarecorder').toLowerCase();
const XDISPLAY = process.env.VIDEO_XDISPLAY || ':99';

function log(...a) { process.stdout.write('[video ' + new Date().toISOString() + '] ' + a.join(' ') + '\n'); }

const WEDGE_SIGNATURE = /A non-NULL packet sent after an EOF|Failed to send packet to filter extract_extradata|FIFO queue full/i;

// Supervise what ffmpeg has ACTUALLY advanced through its output muxer, not browser input or process state.
// The injected clock/timer functions keep the production logic testable without timing-sensitive sleeps.
function watchFfmpegOutput(ff, onFailure, opts = {}) {
  const now = opts.now || Date.now;
  const stallMs = opts.stallMs || OUTPUT_STALL_MS;
  const checkMs = opts.checkMs || OUTPUT_CHECK_MS;
  const wedgeWindowMs = opts.wedgeWindowMs || WEDGE_WINDOW_MS;
  const wedgeHitsNeeded = opts.wedgeHits || WEDGE_HITS;
  const setEvery = opts.setInterval || setInterval;
  const clearEvery = opts.clearInterval || clearInterval;
  const echoStderr = opts.echoStderr !== false;
  let lastAdvanceAt = now(), lastOutTime = -1, lastFrame = -1, tripped = false;
  let progressBuf = '', stderrBuf = '', wedgeHits = [];

  const trip = (reason) => {
    if (tripped) return;
    tripped = true;
    onFailure(reason);
  };
  const progressLine = (line) => {
    const eq = line.indexOf('=');
    if (eq < 1) return;
    const key = line.slice(0, eq), value = Number(line.slice(eq + 1));
    if (!Number.isFinite(value)) return;
    if ((key === 'out_time_us' || key === 'out_time_ms') && value > lastOutTime) {
      lastOutTime = value; lastAdvanceAt = now();
    } else if (key === 'frame' && value > lastFrame) {
      lastFrame = value; lastAdvanceAt = now();
    }
  };
  const stderrLine = (line) => {
    if (!WEDGE_SIGNATURE.test(line)) return;
    const at = now();
    wedgeHits = wedgeHits.filter(t => at - t <= wedgeWindowMs);
    wedgeHits.push(at);
    log(`ffmpeg RTMP wedge signature ${wedgeHits.length}/${wedgeHitsNeeded} within ${Math.round(wedgeWindowMs / 1000)}s`);
    if (wedgeHits.length >= wedgeHitsNeeded) trip(`ffmpeg repeated EOF/FIFO wedge signature (${wedgeHits.length} hits)`);
  };
  const consume = (chunk, kind) => {
    let buf = (kind === 'progress' ? progressBuf : stderrBuf) + chunk.toString('utf8');
    const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
    for (const line of lines) (kind === 'progress' ? progressLine : stderrLine)(line);
    if (kind === 'progress') progressBuf = buf; else stderrBuf = buf;
  };
  const onProgress = chunk => consume(chunk, 'progress');
  const onStderr = chunk => { if (echoStderr) process.stderr.write(chunk); consume(chunk, 'stderr'); };
  if (!ff.stdio || !ff.stdio[3]) throw new Error('ffmpeg progress pipe missing');
  ff.stdio[3].on('data', onProgress);
  if (ff.stderr) ff.stderr.on('data', onStderr);
  const check = () => {
    if (!tripped && ff.exitCode === null && ff.signalCode === null && now() - lastAdvanceAt > stallMs) {
      trip(`ffmpeg encoded output stalled for >${Math.round(stallMs / 1000)}s while process remained alive`);
    }
  };
  const timer = setEvery(check, checkMs);
  if (timer && timer.unref) timer.unref();
  return {
    check,
    stop() {
      clearEvery(timer);
      ff.stdio[3].removeListener('data', onProgress);
      if (ff.stderr) ff.stderr.removeListener('data', onStderr);
    },
  };
}

// ffmpeg owns a detached process group so cleanup can terminate its FIFO/tee descendants as one bounded unit.
function signalFfmpegTree(ff, signal) {
  if (!ff || !ff.pid || ff.exitCode !== null || ff.signalCode !== null) return;
  try {
    if (ff.__rrrProcessGroup) process.kill(-ff.pid, signal);
    else ff.kill(signal);
  } catch (e) {
    if (e && e.code !== 'ESRCH') log(`could not send ${signal} to ffmpeg process tree: ${e.message}`);
  }
}

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
function startWsSink(onChunk, onDisconnect) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
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
          if ((op === 0x2 || op === 0x0) && payload.length) onChunk(Buffer.from(payload), socket);  // binary
        }
      });
      let dropped = false;
      const drop = () => { if (dropped) return; dropped = true; if (onDisconnect) onDisconnect(); };
      socket.on('error', drop); socket.on('close', drop);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Start a headless X server (Xvfb) so a HEADED Chrome can render onto it and ffmpeg can x11grab it. Resolves
// once the X socket exists (Chrome/ffmpeg would otherwise race the display coming up).
function startXvfb(display, w, h) {
  let xv;
  const ready = new Promise((resolve, reject) => {
    const num = display.replace(/^:/, '');
    xv = spawn('Xvfb', [display, '-screen', '0', `${w}x${h}x24`, '-nolisten', 'tcp', '-noreset'], { stdio: ['ignore', 'inherit', 'inherit'] });
    xv.on('error', (e) => reject(new Error('Xvfb failed to start (is it installed? `apt-get install xvfb`): ' + e.message)));
    const sock = '/tmp/.X11-unix/X' + num;
    let tries = 0;
    const t = setInterval(() => {
      if (fs.existsSync(sock)) { clearInterval(t); resolve(xv); }
      else if (++tries > 100) { clearInterval(t); try { xv.kill(); } catch (e) {} reject(new Error('Xvfb socket never appeared: ' + sock)); }
    }, 100);
  });
  ready.child = xv;   // lets shutdown kill Xvfb even while the socket-ready poll is still pending
  return ready;
}

function spawnFfmpeg(target) {
  // webm (vp8[/opus]) in -> H.264/AAC FLV out. -fps_mode cfr (MediaRecorder webm is VFR; YouTube wants CFR).
  // NO -re (MediaRecorder is already realtime) and NO nobuffer/probesize (those are raw-PCM-only; webm needs probing).
  // NO `-tune zerolatency` (that forces x264's less-efficient SLICED threading — a quality tax on a stream
  // sitting behind ~30s of YouTube buffer), but ALSO no full lookahead/B-frames: measured on the 4-core box at
  // 720p, x264's default rc-lookahead=40 + bframes=3 oversubscribed the run queue (load 3.2 -> ~4.9, frame-
  // pacing risk). The fit: frame threading + bframes=0 + a short lookahead — better bits than zerolatency,
  // without the thread pileup. Tunable via VIDEO_X264_PARAMS. bufsize = 2x bitrate (standard VBV).
  const kbps = parseInt(VBITRATE, 10) || 6000;
  const X264_PRESET = process.env.VIDEO_X264_PRESET || 'veryfast';
  // aq-mode=3: adaptive quantization biased toward flat/dark regions — targets banding on the big sky
  // gradients (this content's main visible artifact) for negligible CPU.
  const X264_PARAMS = process.env.VIDEO_X264_PARAMS || 'bframes=0:rc-lookahead=10:aq-mode=3';
  const enc = VIDEO_ENC === 'h264_videotoolbox'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', (kbps * 2) + 'k', '-realtime', '1']
    : ['-c:v', 'libx264', '-preset', X264_PRESET, '-x264-params', X264_PARAMS, '-b:v', VBITRATE, '-maxrate', VBITRATE, '-bufsize', (kbps * 2) + 'k', '-pix_fmt', 'yuv420p', '-sc_threshold', '0'];
  // ONE input: the browser's webm (video + audio together) over the WS. Coupled = no second live clock to
  // drift against (a dual-input mux gapped the audio). thread_queue_size covers MediaRecorder's ~1s bursts.
  //
  // PLAYER-SMOOTHNESS (the real "crackle"): raw-segment captures of this stream measure clean, but YouTube's
  // LIVE PLAYER decodes+syncs it in real time — and the browser game's constant motion makes libx264 scatter
  // scene-cut keyframes (irregular GOP), which makes that player hitch, and a hitching player crackles the
  // audio even though the samples are perfect. Fix: force an IDR exactly every 2s (-sc_threshold 0 kills
  // scene-cut keyframes) + regenerate clean monotonic PTS (+genpts) + async-resample the audio to the output
  // clock so the player never re-syncs. This is the standard "smooth YouTube Live" encode.
  const gop = String(FPS * 2);
  const kf = ['-g', gop, '-keyint_min', gop, '-force_key_frames', 'expr:gte(t,n_forced*2)'];
  // Video source: x11grab reads RAW frames straight off the Xvfb display (a memcpy — no VP8); otherwise the
  // webm pipe MediaRecorder feeds us. x11grab is already steady CFR, so it muxes cleanly against the audio.
  const vin = CAPTURE === 'x11grab'
    // Raw 1080p frames are ~8 MiB each: a 512-packet queue could retain ~4 GiB if x264 falls behind.
    // Keep only a fraction of a second; stale live frames are useless and must not OOM the box.
    ? ['-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(FPS), '-video_size', `${W}x${H}`, '-thread_queue_size', '8', '-i', XDISPLAY + '.0']
    : ['-fflags', '+genpts', '-thread_queue_size', '512', '-i', 'pipe:0'];
  let inputs, maps, audioCodec;
  if (AUDIO_URL) {
    // DECOUPLED (the robust default on the box): ffmpeg streams the clean MP3 DIRECTLY as input 0 = the
    // timeline MASTER. It is byte-for-byte the Roon stream, untouched by the browser or box load. The video is
    // input 1 and merely conforms to the audio clock (CFR, drop/dup) — it never affects the audio, because the
    // audio does not ride through the browser at all (the browser plays the MP3 only to drive the reactive
    // visuals; we capture video-only). aresample keeps the audio continuous; the MP3 is already tamed upstream.
    const reconnect = /^https?:/i.test(AUDIO_URL) ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2'] : [];
    // .pcm = the broadcaster's LOSSLESS local tap (raw f32le, no MP3 generation) — needs explicit demux args.
    const rawFmt = /\.pcm(\?|$)/i.test(AUDIO_URL) ? ['-f', 'f32le', '-ar', '48000', '-ac', '2'] : [];
    const videoOffset = AV_OFFSET ? ['-itsoffset', String(AV_OFFSET)] : [];
    inputs = ['-thread_queue_size', '1024', ...reconnect, ...rawFmt, '-i', AUDIO_URL, ...videoOffset, ...vin];
    maps = ['-map', '0:a:0', '-map', '1:v:0'];
    audioCodec = ['-filter:a', 'aresample=async=1:min_hard_comp=0.1:first_pts=0', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2'];
  } else {
    // COUPLED SYNTH (local dry-run / no stream): synth audio rides in the same webm as the video.
    inputs = vin;
    maps = [];
    const af = [...(VIDEO_AF ? [VIDEO_AF] : []), 'aresample=async=1:min_hard_comp=0.1:first_pts=0'].join(',');
    audioCodec = ['-filter:a', af, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2'];
  }
  // dry-run bound: a webm pipe ends when the browser stops (-shortest); x11grab + the MP3 are both endless -> hard -t.
  const dryBound = !DRY_FILE ? [] : (CAPTURE === 'x11grab' ? ['-t', String(DRY_SECONDS)] : (AUDIO_URL ? ['-shortest'] : []));
  // Live push goes to BOTH YouTube ingest URLs via the tee muxer (YouTube auto-fails-over between them):
  // onfail=ignore keeps the stream alive if one leg dies; independent FIFOs absorb short stalls and drop
  // obsolete packets on overflow so a slow ingest cannot block the encoder. Upload doubles (~1.5MB/s total
  // — trivial). Dry-runs and explicit
  // VIDEO_BACKUP_INGEST=0 keep the plain single-flv output. (tee needs explicit -map, so decoupled-only.)
  const KEY = process.env.YT_STREAM_KEY || '';
  const tee = !DRY_FILE && KEY && maps.length && (process.env.VIDEO_BACKUP_INGEST || '1') === '1';
  const slave = (u) => `[f=flv:flvflags=no_duration_filesize:onfail=ignore]${u}`;
  const out = tee
    ? ['-f', 'tee', '-use_fifo', '1', '-fifo_options', 'drop_pkts_on_overflow=1:attempt_recovery=1:recover_any_error=1:recovery_wait_time=1',
      slave('rtmp://a.rtmp.youtube.com/live2/' + KEY) + '|' + slave('rtmp://b.rtmp.youtube.com/live2?backup=1/' + KEY)]
    : ['-flvflags', 'no_duration_filesize', '-f', 'flv', target];
  const a = ['-hide_banner', '-loglevel', (process.env.VIDEO_FFLOG || 'warning'),
    '-progress', 'pipe:3', '-stats_period', '5', ...inputs,
    '-fps_mode', 'cfr', '-r', String(FPS), ...maps, ...enc, ...kf,
    ...audioCodec,
    ...dryBound,
    ...out];
  const grouped = process.platform !== 'win32';
  const ff = spawn(FFMPEG, a, { stdio: ['pipe', 'inherit', 'pipe', 'pipe'], detached: grouped });
  ff.__rrrProcessGroup = grouped;
  ff.stdin.on('error', () => {});
  return ff;
}

let emergencyCleanup = null;
async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing — run `node build.js`');
  if (CAPTURE !== 'mediarecorder' && CAPTURE !== 'x11grab') throw new Error('VIDEO_CAPTURE must be mediarecorder or x11grab (got ' + CAPTURE + ')');
  if (CAPTURE === 'x11grab' && !AUDIO_URL) throw new Error('VIDEO_CAPTURE=x11grab requires VIDEO_AUDIO_URL (x11grab supplies video only)');
  const target = DRY_FILE || ('rtmp://a.rtmp.youtube.com/live2/' + (process.env.YT_STREAM_KEY || ''));
  if (!DRY_FILE && !process.env.YT_STREAM_KEY) throw new Error('set YT_STREAM_KEY (or use --dry-run <file>)');

  const { chromium } = require('playwright');
  const dist = await startDistServer();
  let stopping = false;
  let ff = null, ws = null, xvfb = null, browser = null, page = null, bytes = 0, cleanupPromise = null;
  let feedBlockTimer = null, feedDrain = null, feedSocket = null, ffWatch = null, reloadTimer = null;
  const within = (work, ms) => new Promise(resolve => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, ms);
    try { Promise.resolve(work()).then(done, done); } catch (e) { done(); }
  });
  const clearFeedBlock = () => {
    if (feedBlockTimer) clearTimeout(feedBlockTimer);
    if (feedDrain && ff && ff.stdin) ff.stdin.removeListener('drain', feedDrain);
    feedBlockTimer = null; feedDrain = null; feedSocket = null;
  };
  const waitChild = (child, ms) => new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { child.removeListener('close', done); resolve(); }, ms);
    child.once('close', done);
  });
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    stopping = true;
    cleanupPromise = (async () => {
      if (ffWatch) { ffWatch.stop(); ffWatch = null; }
      if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
      clearFeedBlock();
      if (page && !page.isClosed()) await within(() => page.evaluate(() => { window.__rrrRec && window.__rrrRec.stop(); window.__rrrSock && window.__rrrSock.close(); }), 1500);
      try { if (ff && ff.stdin) ff.stdin.end(); } catch (e) {}
      signalFfmpegTree(ff, 'SIGTERM');
      if (browser) await within(() => browser.close(), 2000);
      try { dist.server.close(); } catch (e) {}
      try { if (ws) ws.server.close(); } catch (e) {}
      try { if (xvfb) xvfb.kill(); } catch (e) {}
      await Promise.all([waitChild(ff, 2000), waitChild(xvfb, 2000)]);
      signalFfmpegTree(ff, 'SIGKILL');
      try { if (xvfb && xvfb.exitCode === null && xvfb.signalCode === null) xvfb.kill('SIGKILL'); } catch (e) {}
    })();
    return cleanupPromise;
  };
  emergencyCleanup = cleanup;
  const stop = async () => { await cleanup(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);   // setup can take ~15s; own partial children too
  let failing = false;
  const fail = (message) => {
    if (stopping || failing) return;
    failing = true;
    log(message + ' — exiting so systemd restarts the leg cleanly');
    cleanup().finally(() => process.exit(1));
  };
  // ffmpeg supervision: we DON'T respawn ffmpeg in place — on an unexpected death we exit non-zero and let
  // systemd restart the whole leg cleanly (fresh browser + Xvfb + ffmpeg). Same self-heal as the broadcaster.
  const superviseFf = () => {
    if (!DRY_FILE) ffWatch = watchFfmpegOutput(ff, fail);
    else if (ff.stderr) ff.stderr.pipe(process.stderr);   // dry-run still drains diagnostics; its watchdog is intentionally off
    ff.on('error', e => { if (!stopping && !DRY_FILE) fail('ffmpeg failed to start: ' + e.message); });
    ff.on('exit', (code, sig) => {
      if (stopping || DRY_FILE) return;
      fail('ffmpeg exited unexpectedly (code=' + code + ' sig=' + sig + ')');
    });
  };

  if (CAPTURE === 'x11grab') {
    // headed Chrome renders onto a virtual X display; ffmpeg grabs it below (after the browser is painting).
    const xvfbReady = startXvfb(XDISPLAY, W, H); xvfb = xvfbReady.child; await xvfbReady;
    process.env.DISPLAY = XDISPLAY;
  } else {
    // MediaRecorder feeds a live webm pipe, so ffmpeg must be up before the page starts recording.
    ff = spawnFfmpeg(target); superviseFf();
    ws = await startWsSink(
      (chunk, socket) => {
        bytes += chunk.length;
        if (!ff || !ff.stdin || !ff.stdin.writable) return;
        if (!ff.stdin.write(chunk) && !feedBlockTimer) {
          feedSocket = socket; socket.pause();
          feedDrain = () => {
            const resume = feedSocket; clearFeedBlock();
            try { if (resume && !resume.destroyed) resume.resume(); } catch (e) {}
          };
          ff.stdin.once('drain', feedDrain);
          feedBlockTimer = setTimeout(() => {
            if (feedDrain && ff && ff.stdin) ff.stdin.removeListener('drain', feedDrain);
            clearFeedBlock();
            fail('ffmpeg input stayed backpressured for 10s');
          }, 10000);
        }
      },
      () => fail('capture WebSocket disconnected')
    );
  }
  log('encoder=' + VIDEO_ENC + ' ' + W + 'x' + H + '@' + FPS + ' renderCap=' + RENDER_FPS + ' capture=' + CAPTURE
    + ' audio=' + (AUDIO_URL ? ('DECOUPLED ffmpeg-reads:' + AUDIO_URL) : 'in-browser synth (coupled)')
    + ' -> ' + (DRY_FILE ? ('dry-run file ' + target) : 'YouTube RTMP'));

  const headed = CAPTURE === 'x11grab';   // headed => Playwright uses the full Chromium (not the headless shell) automatically
  // VIDEO_NO_GPU=1 (box-side env, GPU-less servers only): without it Chromium spins up a GPU process
  // running ANGLE SwiftShader (GL emulated on CPU) for compositing. --disable-gpu routes compositing
  // through the plain software path instead. This launcher never runs on user devices, so laptops and
  // phones keep real GPU acceleration untouched.
  const noGpu = process.env.VIDEO_NO_GPU === '1' ? ['--disable-gpu'] : [];
  browser = await chromium.launch({
    headless: !headed,
    channel: process.env.VIDEO_BROWSER_CHANNEL || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', ...noGpu,
      ...(headed ? ['--window-position=0,0', `--window-size=${W},${H}`, '--hide-scrollbars', '--disable-infobars', '--noerrdialogs', '--no-first-run'] : [])],
  });
  browser.on('disconnected', () => fail('Chromium disconnected unexpectedly'));
  page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('crash', () => fail('Chromium page crashed'));
  page.on('close', () => fail('Chromium page closed unexpectedly'));
  page.on('pageerror', error => fail('Chromium page error: ' + (error && error.message || error)));
  // arm audio (+ MediaRecorder for the vp8 path); x11grab needs only the MP3 playing + the render cap.
  const pcmTap = /\.pcm(\?|$)/i.test(AUDIO_URL);
  const visualAudioBase = AUDIO_URL && AUDIO_URL.replace(/\.pcm(\?|$)/i, '.mp3$1');
  // `live=1` is our broadcaster's no-burst opt-out. Never add it to an arbitrary external/signed URL.
  const visualAudioUrl = pcmTap ? (visualAudioBase + (AUDIO_URL.includes('?') ? '&' : '?') + 'live=1') : visualAudioBase;
  // loadAndArm navigates the render page and (re)arms the MP3-driven visuals. Called once at startup and
  // again on every hot-reload (a content-only deploy) — WITHOUT touching ffmpeg, so the RTMP feed to
  // YouTube never drops. ffmpeg grabs the X display + reads the MP3 directly, both independent of this page.
  let fullscreenDone = false;
  async function loadAndArm() {
    await page.goto(dist.url + 'radio?broadcast=1', { waitUntil: 'domcontentloaded' });   // ?broadcast=1 => pure game, zero chrome (see _RRR_BROADCAST)
    if (headed && !fullscreenDone) {
      // Playwright's headed window keeps a toolbar/tab bar that x11grab would capture (and it crops the game).
      // Fullscreen the window over CDP so the page fills the whole display and x11grab sees ONLY the game.
      try {
        const cdp = await page.context().newCDPSession(page);
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
        await page.waitForTimeout(300);   // let the canvas resize() settle to the fullscreen size
        log('window -> fullscreen (chrome hidden for x11grab)');
      } catch (e) { throw new Error('fullscreen set failed: ' + (e && e.message || e)); }
      fullscreenDone = true;
    }
    return page.evaluate(async ({ wsPort, fps, renderCap, playUrl, webmBps, capture }) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    let cap = null;
    window.__rrrHeadlessCapture = true;   // page-side hint: skip work invisible in capture (favicon PNG churn) without touching rendered pixels
    try { if (typeof window.__rrrSetRenderFpsCap === 'function' && renderCap > 0) cap = window.__rrrSetRenderFpsCap(renderCap); } catch (e) {}
    let mode = 'synth';
    if (playUrl) {
      // DECOUPLED: play the box's clean MP3 in-browser ONLY to drive the reactive visuals — playExternal
      // mutes the synth and feeds the analyser the games read. We do NOT capture this audio; ffmpeg muxes
      // the MP3 directly (see spawnFfmpeg), so the audio never rides through the jittery, load-sensitive
      // browser. Capture VIDEO ONLY. Decoding an MP3 is also far lighter than the synth.
      try {
        const ctx = Audio.audioCtx && Audio.audioCtx();
        if (!ctx) return { ok: false, err: 'no audioCtx' };
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
        // NOTE: the app shadows the global `Audio` with its engine object, so `new Audio()` throws
        // ("Audio is not a constructor"). Build the media element explicitly.
        const el = document.createElement('audio'); el.crossOrigin = 'anonymous'; el.preload = 'auto'; el.src = playUrl;
        window.__rrrAudioEl = el;
        await el.play().catch(() => {});
        const srcNode = ctx.createMediaElementSource(el);
        if (Audio.playExternal) Audio.playExternal(srcNode, { source: 'stream' });   // visuals react to the analyser
        mode = 'mp3-visuals';
        // wait for real audio to flow (element playing + past its first frames)
        let flowing = false;
        for (let i = 0; i < 150; i++) { if (!el.paused && el.currentTime > 0.15) { flowing = true; break; } await sleep(100); }
        if (!flowing) return { ok: false, err: 'mp3 did not start flowing' };
      } catch (e) { return { ok: false, err: 'mp3 play failed: ' + (e && e.message || e) }; }
    } else {
      try { if (typeof startAudio === 'function') startAudio(true); if (Audio.resume) Audio.resume(true); } catch (e) {}
      let flowing = false;
      for (let i = 0; i < 150; i++) { if (Audio.running && Audio.running() && Audio.trackToken && Audio.trackToken()) { flowing = true; break; } await sleep(100); }
      if (!flowing) return { ok: false, err: 'synth did not start flowing' };
    }
    const cv = document.getElementById('stage');
    if (!cv) return { ok: false, err: 'no #stage canvas' };
    // x11grab: nothing to record in-page — ffmpeg grabs the rendered display. The page just keeps painting
    // the game (its render loop) + playing the MP3 for the visuals. No canvas.captureStream, no VP8.
    if (capture !== 'mediarecorder') return { ok: true, mode, renderCap: cap };
    const vtrack = cv.captureStream(fps).getVideoTracks()[0];
    // DECOUPLED (playUrl): VIDEO ONLY — ffmpeg supplies the audio. SYNTH: capture audio too (one webm).
    let tracks = [vtrack], mime = 'video/webm;codecs=vp8';
    if (!playUrl) {
      const astream = Audio.captureStream ? Audio.captureStream() : null;
      const atrack = astream && astream.getAudioTracks()[0];
      if (!atrack) return { ok: false, err: 'no audio track (captureStream null)' };
      tracks = [vtrack, atrack]; mime = 'video/webm;codecs=vp8,opus';
    }
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: webmBps, audioBitsPerSecond: 256000 });
    const sock = new WebSocket('ws://127.0.0.1:' + wsPort);
    sock.binaryType = 'arraybuffer';
    window.__rrrRec = rec; window.__rrrSock = sock;
    await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error('capture WebSocket failed')); });
    rec.onerror = () => { try { sock.close(); } catch (e) {} };
    rec.ondataavailable = (e) => { if (e.data && e.data.size && sock.readyState === 1) e.data.arrayBuffer()
      .then(b => { if (sock.readyState === 1) sock.send(b); })
      .catch(() => { try { sock.close(); } catch (e2) {} }); };
    rec.start(1000);   // 1s timeslice
    return { ok: true, mode, renderCap: cap };
  }, { wsPort: ws ? ws.port : 0, fps: FPS, renderCap: RENDER_FPS,
    // the page drives the visuals by PLAYING the stream — MediaElementSource can't decode a raw .pcm tap,
    // so it plays the MP3 mount without its listener startup burst, matching the PCM tap's live edge.
    playUrl: visualAudioUrl, webmBps: WEBM_BPS, capture: CAPTURE });
  }
  const started = await loadAndArm();

  log('page capture: ' + JSON.stringify(started));
  if (!started.ok) throw new Error('page capture failed: ' + started.err);

  if (CAPTURE === 'x11grab' && started.ok) {
    // the headed browser is now painting the game onto :DISPLAY — start ffmpeg grabbing it (raw -> one h264).
    ff = spawnFfmpeg(target); superviseFf();
    log('x11grab -> single h264 on ' + XDISPLAY);
  }

  // HOT-RELOAD: when the box's dist/ is rebuilt (a content-only deploy), reload the render page IN PLACE to
  // pick up new game/site code WITHOUT tearing down ffmpeg — the RTMP feed to YouTube never drops (viewers
  // see a ~1s repaint, not a reconnect). Encoder changes (broadcast/video.js) still restart the whole leg.
  if (!DRY_FILE && CAPTURE === 'x11grab' && started.ok) {
    const stampFile = path.join(DIST, 'index.html');
    const readStamp = () => { try { return fs.statSync(stampFile).mtimeMs; } catch (e) { return 0; } };
    let lastStamp = readStamp(), reloading = false;
    reloadTimer = setInterval(() => {
      if (reloading || stopping) return;
      const m = readStamp();
      if (!m || m === lastStamp) return;
      lastStamp = m; reloading = true;
      log('dist changed -> hot-reloading render page (stream stays live)');
      Promise.resolve(loadAndArm())
        .then(r => log('hot-reload armed: ' + JSON.stringify(r)))
        .catch(e => log('hot-reload failed (non-fatal; retries next tick): ' + (e && e.message)))
        .finally(() => { reloading = false; });
    }, 4000);
  }

  if (DRY_FILE) {
    await page.waitForTimeout(DRY_SECONDS * 1000);
    stopping = true;   // the recorder/socket closes below are expected, not supervision failures
    try { await page.evaluate(() => { window.__rrrRec && window.__rrrRec.stop(); window.__rrrSock && window.__rrrSock.close(); }); } catch (e) {}
    await page.waitForTimeout(800);
    try { if (ff && ff.stdin) ff.stdin.end(); } catch (e) {}
    // x11grab ffmpeg self-ends at -t; the pipe path ends on stdin EOF. Wait, then force-kill so we never hang.
    await waitChild(ff, 8000);
    try { if (ff && ff.exitCode === null) ff.kill('SIGKILL'); } catch (e) {}
    await waitChild(ff, 1000);
    if (!ff || ff.exitCode !== 0) throw new Error('dry-run ffmpeg failed (code=' + (ff && ff.exitCode) + ', signal=' + (ff && ff.signalCode) + ')');
    const outStat = fs.statSync(target);
    if (!outStat.isFile() || !outStat.size) throw new Error('dry-run output is empty: ' + target);
    await cleanup();
    log('dry-run wrote ' + target + ' (' + (bytes / 1024 / 1024).toFixed(1) + ' MB ingested)');
    return;
  }
  // live: keep running; ffmpeg/browser/socket + signals are supervised above
}

module.exports = { signalFfmpegTree, watchFfmpegOutput };
if (require.main === module) main().catch(async e => { log('fatal: ' + (e && e.stack || e)); if (emergencyCleanup) await emergencyCleanup(); process.exit(1); });
