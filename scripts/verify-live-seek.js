// verify-live-seek.js — proves the LIVE mid-track join (startTrackAtOffset) plays the SAME
// audio a from-zero listener hears. Per the project rule, audio is verified by OFFLINE
// RENDER, never by trusting symbolic checks: for each schedule token we render
//   A: the full track from beat 0 (the resident listener)
//   B: the track with events re-timed exactly like the seek's cursor fast-forward
//      (drop tBeat < offsetBeats, shift the rest by -offsetBeats) — the joiner
// then compare the OVERLAP (past a 2s settle window that absorbs the two accepted
// differences: pads whose onsets precede the offset, and the empty echo line):
//   - normalized cross-correlation at the aligned lag (worklet voices seed per-event,
//     so the payload should be essentially identical)
//   - RMS level delta
//   - hard silence gate on both renders (peak == 0 is THE historical failure mode)
// Run: node build.js && node scripts/verify-live-seek.js [nTokens]
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const N_TOKENS = Math.max(1, +(process.argv[2] || 6));
const SETTLE_SEC = 2.0;          // accepted-divergence window after the join
const MIN_CORR = 0.90;           // aligned cross-correlation over the settled overlap
const MAX_RMS_DB = 1.0;          // level delta between joiner and resident

function mimeFor(f){ return f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'application/octet-stream'; }
function startServer(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, '')); if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' }); res.end(buf); });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

(async () => {
  const Live = require(path.join(ROOT, 'src', 'live.js'));
  const { chromium } = require('playwright');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('run node build.js first'); process.exit(1); }

  // schedule tokens from an arbitrary block, varied offsets
  const pl = Live.blockPlaylist(497321);
  const cases = [];
  for (let i = 0; i < N_TOKENS && i < pl.length; i++) {
    const frac = [0.33, 0.6, 0.15, 0.75, 0.45, 0.9][i % 6];
    cases.push({ token: pl[i].token, dur: pl[i].dur, offFrac: frac });
  }

  const { server, url } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Audio !== 'undefined' && Audio.Engine && typeof Audio.Engine.render === 'function', null, { timeout: 15000 });

  let fails = 0;
  for (const c of cases) {
    const res = await page.evaluate(async ({ token, offFrac }) => {
      const comp = window.CT_COMPOSERS.rrr_core;
      const score = comp.compile(token);
      const spb = 60 / score.bpm;
      const sr = 48000;
      // exact-sample offset so the A/B alignment shift is integral (no half-sample HF decorrelation)
      const durSec = score.totalBars * 4 * spb;
      let offSec = Math.round(durSec * offFrac * sr) / sr;
      const offBeats = offSec / spb;
      // B: the seek — exactly what startTrackAtOffset's cursor fast-forward feeds the worklet
      const evNum = (a, b) => (a != null && isFinite(+a)) ? +a : ((b != null && isFinite(+b)) ? +b : 0);
      const seekEvents = [];
      for (const ev of score.events) {
        const tb = evNum(ev.tBeat, ev.t);
        if (ev.kind === 'chord' || ev.kind === 'meta') { // meta stays (never sent to worklet, harmless)
          seekEvents.push(Object.assign({}, ev, { tBeat: tb - offBeats })); continue;
        }
        if (tb < offBeats) continue;
        seekEvents.push(Object.assign({}, ev, { tBeat: tb - offBeats }));
      }
      const seekScore = Object.assign({}, score, { events: seekEvents, totalBars: Math.ceil((score.totalBars * 4 - offBeats) / 4) });
      const A = await Audio.Engine.render(score, { sampleRate: sr });
      const B = await Audio.Engine.render(seekScore, { sampleRate: sr });
      // compare overlap: A shifted by offSec vs B, past the settle window
      const lead = 0.06;
      const shift = Math.round(offSec * sr);
      const start = Math.round((lead + 2.0) * sr);                       // settle window
      const n = Math.min(A.left.length - shift - start, B.left.length - start) - sr; // drop last 1s (tails)
      let peakA = 0, peakB = 0;
      for (let i = 0; i < A.left.length; i++) { const v = Math.abs(A.left[i]); if (v > peakA) peakA = v; }
      for (let i = 0; i < B.left.length; i++) { const v = Math.abs(B.left[i]); if (v > peakB) peakB = v; }
      if (n < sr * 4) return { token, err: 'overlap too short: ' + n };
      let dot = 0, ea = 0, eb = 0;
      for (let i = 0; i < n; i++) {
        const a = A.left[start + shift + i] + A.right[start + shift + i];
        const b = B.left[start + i] + B.right[start + i];
        dot += a * b; ea += a * a; eb += b * b;
      }
      const corr = (ea > 0 && eb > 0) ? dot / Math.sqrt(ea * eb) : 0;
      const rmsDb = (ea > 0 && eb > 0) ? 10 * Math.log10(eb / ea) : 99;
      return { token, offSec: +offSec.toFixed(2), durSec: +durSec.toFixed(1), corr: +corr.toFixed(4), rmsDb: +rmsDb.toFixed(2), peakA: +peakA.toFixed(3), peakB: +peakB.toFixed(3), overlapSec: +(n / sr).toFixed(1) };
    }, c);

    if (res.err) { console.error('FAIL', res.token, res.err); fails++; continue; }
    const silent = res.peakA === 0 || res.peakB === 0;
    const bad = silent || res.corr < MIN_CORR || Math.abs(res.rmsDb) > MAX_RMS_DB;
    console.log((bad ? 'FAIL' : ' ok '), res.token,
      `off=${res.offSec}s/${res.durSec}s overlap=${res.overlapSec}s corr=${res.corr} rmsΔ=${res.rmsDb}dB peaks=${res.peakA}/${res.peakB}`);
    if (bad) fails++;
  }

  await browser.close(); server.close();
  if (fails) { console.error(`verify-live-seek: ${fails}/${cases.length} FAILED`); process.exit(1); }
  console.log(`verify-live-seek ok: ${cases.length} tokens — the joiner hears what the resident hears (corr>=${MIN_CORR}, |rmsΔ|<=${MAX_RMS_DB}dB, no silence)`);
})().catch(e => { console.error('verify-live-seek crashed:', e); process.exit(1); });
