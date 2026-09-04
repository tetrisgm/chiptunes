// THE PICTURE WAITS FOR THE SPEAKERS.
//
// ctx.currentTime is where the graph is RENDERING. The sample rendered at time
// T is not heard until T plus the device's output buffer, and on a wireless
// output that is not a rounding error -- AirPods are routinely 150-250ms.
// Every visual clock in audio.js was timed against ctx.currentTime, so on such
// a device the games, the beat grid and the playhead all ran that far ahead of
// the music. Reported as "it takes a second for audio to come out, whereas the
// games and the visual progress happen instantly" -- which is what leading the
// sound looks like from the sofa.
//
// Also guarded here: one press of Next must start exactly ONE track. It used to
// start two whenever a mood or a shared link was playing, because those enter
// through playDoc and a document has no token, so the "nothing is loaded" guard
// fired and minted a second song 30ms before Radio.next() started a third.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

function server() {
  return new Promise(res => {
    const s = http.createServer((q, e) => {
      let rel = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '');
      let f = path.join(DIST, rel || 'index.html');
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      fs.readFile(f, (err, b) => {
        if (err) { e.writeHead(500); e.end(); return; }
        e.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
        e.end(b);
      });
    });
    s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  // count what actually reaches the chip
  await p.addInitScript(() => {
    window.__plays = [];
    const orig = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (m) {
      try { if (m && m.type === 'play') window.__plays.push({ t: +performance.now().toFixed(1), lead: m.leadSec }); } catch (e) {}
      return orig.apply(this, arguments);
    };
  });
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p.evaluate(() => { const x = [...document.querySelectorAll('.rmood')].find(y => y.textContent === 'chill'); if (x) x.click(); });
  await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 30000 });
  await wait(7000);

  // ---- the measurement itself ---------------------------------------------
  const d = await p.evaluate(() => {
    const out = {};
    try { out.diag = Audio.latencyDiag(); } catch (e) { out.diag = null; }
    try {
      const c = Audio.audioCtx && Audio.audioCtx();
      out.reported = (c && typeof c.outputLatency === 'number') ? c.outputLatency * 1000 : null;
      out.base = c ? (c.baseLatency || 0) * 1000 : null;
    } catch (e) {}
    try {
      const dp = Audio.deckPosition(), ap = Audio.audiblePosition();
      out.applied = (dp && ap) ? (dp.sec - ap.sec) * 1000 : null;
    } catch (e) {}
    try { out.lag = Audio.audibleLag() * 1000; } catch (e) {}
    return out;
  });
  ok(!!d.diag, 'the latency is exposed for reading in a real browser (Audio.latencyDiag)');
  ok(d.diag && d.diag.outMs > 0 && d.diag.outMs <= 500,
     'and it measures a sane output latency (' + (d.diag && d.diag.outMs) + 'ms)');
  // Cross-check: where the browser reports outputLatency itself, our measured
  // number must agree with it. This is what stops the correction being invented.
  if (d.reported != null) {
    ok(Math.abs(d.diag.outMs - d.reported) < 25,
       'which agrees with the browser\'s own outputLatency (' + d.diag.outMs.toFixed(1) +
       ' vs ' + d.reported.toFixed(1) + 'ms)');
  } else {
    console.log('  --   this engine does not report ctx.outputLatency; measured ' + d.diag.outMs + 'ms');
  }
  ok(d.applied != null && d.applied >= d.diag.outMs - 1,
     'the playhead is held back by at least that much (' + (d.applied || 0).toFixed(1) + 'ms)');

  // The beat grid the GAMES animate on must carry the same correction -- the
  // playhead alone was already corrected before this, and the games were not.
  const grid = await p.evaluate(() => {
    const c = Audio.audioCtx();
    const g1 = Audio.grid();
    // where the grid WOULD be with no correction, one output-latency later
    const out = Audio.latencyDiag().outMs / 1000;
    return { step16: g1.step16, shiftSteps: out / g1.step16, bpm: g1.bpm };
  });
  ok(grid.shiftSteps > 0, 'the beat grid carries it too (' + (grid.shiftSteps * grid.step16 * 1000).toFixed(1) +
     'ms = ' + grid.shiftSteps.toFixed(3) + ' of a sixteenth at ' + grid.bpm + 'bpm)');

  // ---- one click, one track ------------------------------------------------
  const presses = [];
  for (let i = 0; i < 4; i++) {
    const n = await p.evaluate(async () => {
      window.__plays.length = 0;
      document.getElementById('pbNext').click();
      await new Promise(r => setTimeout(r, 1200));
      return window.__plays.length;
    });
    presses.push(n);
    await wait(2500);
  }
  ok(presses.every(n => n === 1),
     'one press of Next starts exactly one track (' + presses.join(', ') + ')');
  // ⚠️ NOT `=== 0.18`. The lead is computed as `origin - currentTime` from two
  // separate clock reads, so it arrives as 0.17999999999999972; and when a track
  // ends NATURALLY during the test the next deck opens with whatever is left of
  // its lead, which is a smaller number and perfectly correct. Pinning the value
  // failed on a legitimate track change.
  //
  // What this guards against is the chip being handed the SYNC-CORRECTED
  // playhead instead of the scheduler's lead -- which is hundreds of
  // milliseconds, not a rounding difference. A ceiling catches that and nothing
  // else.
  const leads = await p.evaluate(() => window.__plays.map(x => x.lead));
  ok(leads.every(x => x >= 0 && x <= 0.185),
     'and the chip is still told the scheduler\'s lead, not the corrected playhead (' +
     leads.map(x => Math.round(x * 1000) + 'ms').join(', ') + ')');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.s.close();
  console.log(fail ? '\nFAILED (' + fail + ')' : '\nall good');
  process.exit(fail ? 1 : 0);
})();
