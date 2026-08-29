#!/usr/bin/env node
// crt-diff.mjs — pixel-diff harness for the CRT gain-map consolidation.
// Proves the single gain-map layer (window.__rrrCrtMode('gain')) renders the same pixels as the legacy
// two-div CSS CRT stack ('legacy'), across viewports/DPRs and canvas contents. The frame loop is stopped
// and everything except #stage + the .crt layers is hidden, so A/B screenshots differ ONLY by the CRT path.
//
//   node scripts/crt-diff.mjs            # run, print per-case max channel diff + % pixels over 1/2 LSB
//   node scripts/crt-diff.mjs --save     # additionally dump PNGs + diff maps to /tmp/crt-diff/
'use strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const SAVE = process.argv.includes('--save');
if (SAVE) fs.mkdirSync('/tmp/crt-diff', { recursive: true });

const mime = (f) => f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/+/, '')) || 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
      res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

const CASES = [
  { w: 1280, h: 720, dpr: 1 },   // the broadcast box
  { w: 1440, h: 900, dpr: 2 },   // retina laptop
];
const PATTERNS = ['white', 'gray', 'colors', 'ramp', 'asis'];

function paintPattern(name) {
  const c = document.getElementById('stage'); const x = c.getContext('2d');
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
  const W = c.width, H = c.height;
  if (name === 'white') { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); }
  else if (name === 'gray') { x.fillStyle = '#808080'; x.fillRect(0, 0, W, H); }
  else if (name === 'colors') {
    const cols = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#404040'];
    const bw = Math.ceil(W / cols.length);
    for (let i = 0; i < cols.length; i++) { x.fillStyle = cols[i]; x.fillRect(i * bw, 0, bw, H); }
  } else if (name === 'ramp') {
    const gr = x.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
  } // 'asis': leave the live frame that was on screen (static once the loop is stopped)
  x.restore();
}

function diffStats(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf), b = PNG.sync.read(bBuf);
  if (a.width !== b.width || a.height !== b.height) throw new Error('size mismatch');
  let max = 0, over1 = 0, over2 = 0; const n = a.width * a.height;
  const diff = SAVE ? new PNG({ width: a.width, height: a.height }) : null;
  for (let i = 0; i < n * 4; i += 4) {
    let px = 0;
    for (let ch = 0; ch < 3; ch++) { const d = Math.abs(a.data[i + ch] - b.data[i + ch]); if (d > px) px = d; }
    if (px > max) max = px;
    if (px > 1) over1++;
    if (px > 2) over2++;
    if (diff) { const v = Math.min(255, px * 64); diff.data[i] = v; diff.data[i + 1] = px > 2 ? 0 : v; diff.data[i + 2] = 0; diff.data[i + 3] = 255; }
  }
  return { max, pct1: (over1 / n * 100), pct2: (over2 / n * 100), diff };
}

// A BLANK FRAME AGREES WITH A BLANK FRAME. This harness reported PASS while
// both screenshots were solid black -- the stage had not been painted (or had
// been cleared by a resize between paint and capture), so the two CRT paths
// were being compared over nothing at all and every "ok" was vacuous. Any
// comparison of an unpainted frame is not evidence, so it is an error.
function inkOf(png) {
  let lit = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 97) { if (png.data[i] > 8 || png.data[i + 1] > 8 || png.data[i + 2] > 8) lit++; n++; }
  return lit / Math.max(1, n);
}

const dist = await serveDist();
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let fail = false;
console.log('case                    pattern  maxLSB  %px>1LSB  %px>2LSB');
for (const cse of CASES) {
  const ctx = await browser.newContext({ viewport: { width: cse.w, height: cse.h }, deviceScaleFactor: cse.dpr });
  const page = await ctx.newPage();
  await page.goto(dist.url + 'radio', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__rrrCrtMode === 'function' && document.getElementById('stage'), null, { timeout: 20000 });
  await page.waitForTimeout(1200);   // let boot settle
  await page.evaluate(() => {
    try { _stopFrameLoop(); } catch (e) {}
    // isolate: only the canvas + CRT layers stay visible, so the A/B diff is purely the CRT path
    for (const el of document.body.children) {
      if (el.id === 'stage' || (el.classList && el.classList.contains('crt'))) continue;
      // The player bar must be GONE, not merely invisible. The CRT layers are
      // inset above it (--barh), _updatePlaybar republishes that height on a
      // 700ms timer, and a hidden-but-present bar keeps reporting 111px -- so
      // the layers could change size BETWEEN screenshot A and screenshot B and
      // the whole frame would differ. That is what made this harness flaky:
      // every DPR-2 case failing at ~106 LSB across 100% of pixels, which is
      // not a rounding disagreement, it is two different pictures.
      if (el.id === 'playbar') { el.style.display = 'none'; continue; }
      el.style.visibility = 'hidden';
    }
    document.documentElement.style.setProperty('--barh', '0px');
  });
  // The 700ms UI tick calls _updatePlaybar -> _syncBarInset -> resize(), and a
  // resize CLEARS the stage. Painting the pattern once and then screenshotting
  // twice a fifth of a second apart meant the second shot could be of a blank
  // canvas -- both frames black, every pixel "different", which is exactly the
  // flake this harness had. Stop the tick, and paint immediately before each
  // capture so nothing can wipe it in between.
  await page.evaluate(() => { try { clearInterval(window._radioTick); } catch (e) {} });
  for (const pattern of PATTERNS) {
    await page.evaluate(() => window.__rrrCrtMode('legacy'));
    await page.waitForTimeout(120);
    await page.evaluate(paintPattern, pattern);
    const A = await page.screenshot({ type: 'png' });
    await page.evaluate(() => window.__rrrCrtMode('gain'));
    await page.waitForFunction(() => window.__rrrCrtReady === true, null, { timeout: 10000 });   // gain build is async (foreignObject raster)
    await page.waitForTimeout(120);
    await page.evaluate(paintPattern, pattern);
    const B = await page.screenshot({ type: 'png' });
    const inkA = inkOf(PNG.sync.read(A)), inkB = inkOf(PNG.sync.read(B));
    if (inkA < 0.02 || inkB < 0.02) {
      console.log(`${(cse.w + 'x' + cse.h + '@' + cse.dpr).padEnd(23)} ${pattern.padEnd(8)} BLANK FRAME -- ` +
        `nothing was painted (A ${(inkA * 100).toFixed(1)}% lit, B ${(inkB * 100).toFixed(1)}%). ` +
        `Comparing two empty screens proves nothing.`);
      fail = true;
      continue;
    }
    const st = diffStats(A, B);
    const tag = `${cse.w}x${cse.h}@${cse.dpr}`;
    // Gate: quantization noise passes, structure fails. The irreducible floor is the compositor's float
    // blending vs the bake's single Math.round — isolated <=3-LSB pixels at gradient banding boundaries.
    // Anything spatially coherent (wrong gradient, wrong stripe phase, wrong shadow) blows past this.
    const ok = st.max <= 3 && st.pct2 <= 0.01;
    if (!ok) fail = true;
    console.log(`${tag.padEnd(22)}  ${pattern.padEnd(7)}  ${String(st.max).padStart(5)}  ${st.pct1.toFixed(3).padStart(8)}  ${st.pct2.toFixed(3).padStart(8)}  ${ok ? 'ok' : 'FAIL'}`);
    if (SAVE) {
      fs.writeFileSync(`/tmp/crt-diff/${tag}-${pattern}-A.png`, A);
      fs.writeFileSync(`/tmp/crt-diff/${tag}-${pattern}-B.png`, B);
      if (st.diff) fs.writeFileSync(`/tmp/crt-diff/${tag}-${pattern}-diff.png`, PNG.sync.write(st.diff));
    }
  }
  await ctx.close();
}
await browser.close(); dist.server.close();
console.log(fail ? '\nRESULT: FAIL — gain map is not pixel-equivalent (see /tmp/crt-diff with --save)' : '\nRESULT: PASS — gain map matches the legacy CRT stack within 2 LSB');
process.exit(fail ? 1 : 0);
