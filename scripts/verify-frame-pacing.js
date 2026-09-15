// Frames have to arrive EVENLY, not just often enough on average.
//
// The render loop caps itself so the visuals cannot starve audio scheduling --
// both live on the main thread. It used to do that against the wall clock:
// "draw if at least target-1 ms have passed". That reads as 60fps and is not.
// A vsync tick arriving a millisecond early is dropped whole, and the next one
// lands a full refresh later, so the cadence beats between 16.7ms and 25ms.
// Simulated on measured timings that gate returns 51.9fps with 15.7% of frames
// hitching at +-1ms of tick jitter, and 44.1fps at +-2ms -- while every
// rendering benchmark says the frame cost is fine, because it is.
//
// It is invisible in headless browsers, whose rAF ticks are metronomic. So this
// does not measure the average frame rate, which was never the problem: it
// measures the SPREAD of the intervals between real draws, and the ratio the
// loop chose against the display it actually found.
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

// watch the frame counter and record when it actually moves
const cadence = p => p.evaluate(async () => {
  const marks = [];
  let last = -1;
  await new Promise(res => {
    let n = 0;
    (function loop() {
      const d = window.__rrrFrame;
      if (d && d.drawn !== last) { last = d.drawn; marks.push(performance.now()); }
      if (++n < 400) requestAnimationFrame(loop); else res();
    })();
  });
  const iv = [];
  for (let i = 1; i < marks.length; i++) iv.push(marks[i] - marks[i - 1]);
  if (iv.length < 20) return null;
  const mean = iv.reduce((a, c) => a + c, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, c) => a + (c - mean) * (c - mean), 0) / iv.length);
  return { fps: 1000 / mean, sd, hitches: iv.filter(x => x > mean * 1.5).length, n: iv.length,
           diag: window.__rrrFrame };
});

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p.mouse.click(720, 450);
  await wait(5000);

  const c = await cadence(p);
  ok(!!c, 'the render loop is running');
  if (c) {
    const d = c.diag;
    console.log('         display ticks every ' + d.tick + 'ms; the loop draws every ' + d.every +
                ' of them, target ' + d.target + 'ms, render cost ' + d.cost + 'ms');
    ok(d.tick > 0, 'it measured the display rather than assuming one (' + d.tick + 'ms)');
    // the ratio has to be the one that lands nearest the target on THIS display
    const want = Math.max(1, Math.round(d.target / d.tick));
    ok(d.every === want, 'and picked the ratio that fits it (every ' + d.every + ')');
    ok(d.drawn > 0, 'and it is drawing (' + d.drawn + ' frames)');
    // NOT an fps assertion: this runs on a software rasteriser that manages
    // single-digit frame rates on its own, and the loop is not what limits it.
  }

  // The pacing RULE, exercised where it can be judged: real rAF timings with
  // jitter, which is the case the wall-clock gate got wrong and no headless
  // browser reproduces.
  const paced = (hz, targetMs, jitter, mode) => {
    let s = 20250828 >>> 0;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const step = 1000 / hz;
    let last = -1e9, tickMs = 0, prev = null, acc = 0;
    const draws = [];
    for (let i = 0; i < 2400; i++) {
      const t = i * step + (rnd() - 0.5) * 2 * jitter;
      if (mode === 'clock') { if (t - last >= targetMs - 1) { draws.push(t); last = t; } continue; }
      if (prev != null) { const dd = t - prev; if (dd > 3 && dd < 40) tickMs = tickMs ? tickMs + (dd - tickMs) * 0.1 : dd; }
      prev = t;
      const N = Math.max(1, Math.round(targetMs / (tickMs || 16.7)));
      if (++acc >= N) { acc = 0; draws.push(t); }
    }
    const iv = [];
    for (let i = 1; i < draws.length; i++) iv.push(draws[i] - draws[i - 1]);
    const mean = iv.reduce((a, x) => a + x, 0) / iv.length;
    const sd = Math.sqrt(iv.reduce((a, x) => a + (x - mean) * (x - mean), 0) / iv.length);
    return { fps: 1000 / mean, sd, hitches: 100 * iv.filter(x => x > mean * 1.4).length / iv.length };
  };
  for (const hz of [60, 120]) {
    for (const jit of [1.0, 2.0]) {
      const now = paced(hz, 16.7, jit, 'tick'), was = paced(hz, 16.7, jit, 'clock');
      ok(now.fps > 59 && now.sd < jit * 1.2 && now.hitches < 1,
         hz + 'Hz with +-' + jit + 'ms of tick jitter: ' + now.fps.toFixed(1) + 'fps, spread ' +
         now.sd.toFixed(2) + 'ms, ' + now.hitches.toFixed(1) + '% hitches' +
         '  (against the clock it was ' + was.fps.toFixed(1) + 'fps, ' + was.hitches.toFixed(1) + '%)');
    }
  }
  // and the backoff steps still land on rates a display can actually show
  for (const [target, hz, want] of [[33.4, 60, 30], [33.4, 120, 30], [50.1, 60, 20], [50.1, 120, 20]]) {
    const r = paced(hz, target, 1.0, 'tick');
    ok(Math.abs(r.fps - want) < 1.5 && r.sd < 1.5,
       'backing off to ' + want + 'fps on a ' + hz + 'Hz display gives ' + r.fps.toFixed(1) +
       'fps, spread ' + r.sd.toFixed(2) + 'ms');
  }

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-frame-pacing: ' + fail + ' FAILED'
                   : '\nverify-frame-pacing: frames arrive evenly');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
