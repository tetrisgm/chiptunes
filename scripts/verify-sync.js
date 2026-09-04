// The picture has to sit on the sound.
//
// Reported from listening: "the music is not playing in sync with the progress
// of the track at the bottom -- it seems the music plays almost 1 sec after."
// Measured, that is exactly right, and the cause is a clock mismatch rather
// than a latency: the deck opens 0.18s in the future and the chip is told to
// wait the same, but the worklet starts counting that lead when the AUDIO
// THREAD receives the message, not when the main thread posted it. How late
// that is depends on what the machine was doing at the moment the track
// started -- measured across sessions at 20ms, 206ms and 1026ms. It is not a
// constant, so it cannot be corrected with one.
//
// The chip reports its true frame nine times a second. The difference between
// that and where the deck's clock thinks it is IS the correction, measured live
// and per track: Audio.audiblePosition() is deckPosition() minus it, and
// anything drawn for a person to look at uses it. Anything SCHEDULING audio
// keeps using deckPosition, which is the clock the scheduler runs on.
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
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p.evaluate(() => {
    const m = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'chill');
    if (m) m.click();
  });
  await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
  await wait(6000);

  const r = await p.evaluate(async () => {
    const FPS = (typeof CT_GB_HARDWARE !== 'undefined') ? CT_GB_HARDWARE.FPS : 59.7275;
    const raws = [], cors = [], lags = [];
    let last = -1;
    const t0 = performance.now();
    // sample only when a stat has JUST arrived: comparing a fresh clock against
    // a stat that may be a report-interval old measures the interval, not the lag
    //
    // COLLECT A SAMPLE, don't run a stopwatch. This was a flat 7-second window,
    // which is ~60 reports on an idle machine and was 7 on a loaded one -- and
    // every number below it is a MEDIAN, so a seven-point sample did not fail
    // because the playhead had drifted, it failed because there was nothing to
    // take a median of. Stopping at 40 also makes the idle case quicker than
    // the window it replaces.
    while (performance.now() - t0 < 25000 && raws.length < 40) {
      const c = window.__rrrChip;
      if (c && c.frame !== last) {
        last = c.frame;
        const raw = Audio.deckPosition(), aud = Audio.audiblePosition();
        if (raw && aud) {
          raws.push(raw.sec * FPS - c.frame); cors.push(aud.sec * FPS - c.frame);
          // ⚠️ SAMPLE THE LAG IN HERE TOO. It used to be read ONCE, after the
          // loop, and then compared against a median taken across the whole
          // window -- two numbers from different moments, of a quantity that
          // moves. That is why this gate kept failing on load and kept having
          // its tolerance widened: the tolerance was never the problem, the
          // measurement was. Both are medians over the same window now.
          lags.push((Audio.audibleLag ? Audio.audibleLag() : 0) * FPS);
        }
      }
      await new Promise(x => setTimeout(x, 3));
    }
    const med = a => { const x = a.slice().sort((u, v) => u - v); return x.length ? x[Math.floor(x.length / 2)] : 0; };
    return { n: raws.length, raw: med(raws) / FPS * 1000, cor: med(cors) / FPS * 1000,
             lagMed: med(lags) / FPS * 1000,
             lag: (Audio.audibleLag ? Audio.audibleLag() : 0) * 1000,
             hasApi: typeof Audio.audiblePosition === 'function' };
  });

  ok(r.hasApi, 'the audible position is exposed separately from the deck clock');
  ok(r.n > 15, 'measured against ' + r.n + ' fresh reports from the chip');
  console.log('         deck clock ran ' + r.raw.toFixed(0) + 'ms ahead of the chip this session' +
              ' (it varies: 20ms, 206ms and 1026ms all observed)');
  ok(Math.abs(r.cor) < 150,
     'the corrected playhead sits on the sound to within ' + Math.abs(r.cor).toFixed(0) +
     'ms (the chip reports ~9 times a second, so ~107ms is the floor)');
  ok(Math.abs(r.cor) <= Math.abs(r.raw) + 40,
     'and is never worse than the raw clock (' + r.cor.toFixed(0) + 'ms vs ' + r.raw.toFixed(0) + 'ms)');
  // ⚠️ COMPARE TWO MEDIANS OVER THE SAME WINDOW. This compared a single
  // instantaneous `lag`, read after the loop, against a median of `raw` taken
  // across it -- two samples of a moving quantity, from different moments. The
  // tolerance was widened twice to cover the gap and the gate still failed a
  // fourth full-suite run on load, at 418 against 642. The tolerance was never
  // the problem. Both sides are medians over the same window now, and the
  // allowance can go back to something that would actually catch a correction
  // that had stopped tracking.
  var tol = Math.max(120, Math.abs(r.raw) * 0.20);
  ok(Math.abs(r.lagMed - r.raw) < tol,
     'the correction it applied matches what was measured (' + r.lagMed.toFixed(0) + 'ms vs ' +
     r.raw.toFixed(0) + 'ms, tolerance ' + tol.toFixed(0) + 'ms)');
  ok(!errs.length, 'no page errors' + (errs.length ? ' -- ' + errs[0] : ''));

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-sync: ' + fail + ' FAILED'
                   : '\nverify-sync: the picture sits on the sound');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
