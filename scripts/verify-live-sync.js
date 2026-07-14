// verify-live-sync.js — the "two browsers, one broadcast" proof, on the REAL app:
//   1. two independent browser contexts open /radio?diag (fresh profiles, autoplay allowed)
//   2. both must report LIVE with the SAME schedule token, offsets within tolerance
//   3. skip in A -> A forks to private (live=false, pill class present), B STAYS live
//   4. back-to-live in A -> A converges back onto B's token
// Reads the d.rrrLive/d.rrrLiveToken/d.rrrLiveOffset diagnostics dataset (runtime.js).
// Run: node build.js && node scripts/verify-live-sync.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function mimeFor(f){ return f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.json')?'application/json':'application/octet-stream'; }
function startServer(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, '')); if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      const noFallback = rel.startsWith('packs/') || rel.startsWith('lib/');
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (noFallback) { res.writeHead(404); res.end('not found'); return; }
        file = path.join(DIST, 'index.html');
      }
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' }); res.end(buf); });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
function die(msg){ console.error('verify-live-sync FAIL:', msg); process.exit(1); }

async function readLive(page){
  return page.evaluate(() => {
    const d = document.documentElement.dataset;
    return { live: d.rrrLive === 'true', token: d.rrrLiveToken || '', offset: +(d.rrrLiveOffset || -1),
             deckTok: (typeof Audio !== 'undefined' && Audio.trackToken) ? Audio.trackToken() : '',
             canRejoin: document.body.classList.contains('live-can-rejoin') };
  });
}

(async () => {
  const { chromium } = require('playwright');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) die('run node build.js first');
  const { server, url } = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  await A.goto(url + '/radio?diag', { waitUntil: 'domcontentloaded' });
  await B.goto(url + '/radio?diag', { waitUntil: 'domcontentloaded' });

  // both must come up LIVE on the same schedule token
  for (const [name, page] of [['A', A], ['B', B]]) {
    await page.waitForFunction(() => document.documentElement.dataset.rrrLive === 'true', null, { timeout: 20000 })
      .catch(() => die(name + ' never went live (d.rrrLive)'));
  }
  await A.waitForTimeout(1500);
  let a = await readLive(A), b = await readLive(B);
  if (!a.live || !b.live) die(`not both live: A=${a.live} B=${b.live}`);
  if (!a.token || a.token !== b.token) die(`token mismatch: A=${a.token} B=${b.token}`);
  if (a.deckTok !== a.token) die(`A deck (${a.deckTok}) != schedule (${a.token})`);
  if (b.deckTok !== b.token) die(`B deck (${b.deckTok}) != schedule (${b.token})`);
  const offDelta = Math.abs(a.offset - b.offset);
  if (offDelta > 1.0) die(`offsets diverge: A=${a.offset}s B=${b.offset}s (Δ${offDelta.toFixed(2)}s)`);
  console.log(`both live on "${a.token}" — offsets A=${a.offset}s B=${b.offset}s (Δ${offDelta.toFixed(2)}s)`);

  // skip in A -> fork (A private, pill available), B stays live on schedule
  await A.evaluate(() => _transportNext());
  await A.waitForTimeout(1200);
  a = await readLive(A); b = await readLive(B);
  if (a.live) die('A still live after skip — fork did not happen');
  if (!a.canRejoin) die('A forked but live-can-rejoin class missing (no back-to-live pill)');
  if (!b.live) die('B lost live when A skipped (must be independent)');
  if (b.token !== b.deckTok) die('B deck fell off schedule during A fork');
  console.log(`A forked private (deck=${a.deckTok}), pill available; B still live on "${b.token}"`);

  // back-to-live in A -> converge with B again
  await A.evaluate(() => { LiveCtl.join(); });
  await A.waitForFunction(() => document.documentElement.dataset.rrrLive === 'true', null, { timeout: 10000 })
    .catch(() => die('A never rejoined live'));
  await A.waitForTimeout(1200);
  a = await readLive(A); b = await readLive(B);
  if (a.token !== b.token) die(`rejoin token mismatch: A=${a.token} B=${b.token}`);
  if (a.deckTok !== a.token) die('A deck not back on schedule after rejoin');
  if (Math.abs(a.offset - b.offset) > 1.0) die(`rejoin offsets diverge: A=${a.offset} B=${b.offset}`);
  console.log(`A rejoined — converged on "${a.token}" (offsets A=${a.offset}s B=${b.offset}s)`);

  // REGRESSION (review finding #1, CRITICAL): playing a specific track while live must FORK and
  // STAY forked — the drift tick must not yank the chosen track back to the broadcast.
  await A.evaluate(() => { LiveCtl.join(); });
  await A.waitForFunction(() => document.documentElement.dataset.rrrLive === 'true', null, { timeout: 10000 });
  const pick = await A.evaluate(() => {
    const slug = 'amber-shadows-wander-mist-qclsi6wt';   // an arbitrary explicit track (not the on-air one)
    _playGenerated(slug);
    return slug;
  });
  await A.waitForTimeout(6500);   // past the 5s settle guard + a couple ticks — the window the yank-back bug lived in
  a = await readLive(A);
  if (a.live) die('explicit _playGenerated did not fork — still live');
  if (a.deckTok !== pick) die(`chosen track "${pick}" was yanked away — deck now "${a.deckTok}" (the CRITICAL bug regressed)`);
  if (!a.canRejoin) die('after explicit pick, back-to-live pill missing');
  console.log(`explicit track pick "${pick}" forked and HELD through the drift window (no yank-back)`);

  // Radio persistence: A's reload must rejoin live automatically (state.live intent)
  await A.evaluate(() => { LiveCtl.join(); });
  await A.waitForFunction(() => document.documentElement.dataset.rrrLive === 'true', null, { timeout: 10000 });
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForFunction(() => document.documentElement.dataset.rrrLive === 'true', null, { timeout: 20000 })
    .catch(() => die('A reload did not rejoin the broadcast'));
  a = await readLive(A); b = await readLive(B);
  if (a.token !== b.token) die(`post-reload token mismatch: A=${a.token} B=${b.token}`);
  console.log(`A reload rejoined the broadcast on "${a.token}"`);

  await browser.close(); server.close();
  console.log('verify-live-sync ok: shared schedule, mid-track join, fork-on-skip, back-to-live, reload-rejoin all verified');
})().catch(e => { console.error('verify-live-sync crashed:', e); process.exit(1); });
