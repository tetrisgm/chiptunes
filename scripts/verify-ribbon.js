// The track ribbon: the whole song along the bottom, doubling as the scrubber.
//
// A music player draws a waveform where the progress bar goes. A Game Boy's
// waveform is its notes, and since the station plays a document they are simply
// there to read -- so the strip shows every note of the track at once, what has
// played lit and what is coming dimmed, with the bar lines behind it.
//
// It is drawn by the frame loop, which is the one place in this app where a
// careless full redraw turns into judder, so this also checks it stays cheap:
// the song is baked once per track and blitted twice a frame.
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
const shown = p => p.evaluate(() => {
  const c = document.getElementById('noteribbon');
  return !!c && getComputedStyle(c).display !== 'none';
});
const pixels = p => p.evaluate(() => {
  const c = document.getElementById('noteribbon');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let any = 0, lit = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 8) { any++; if (d[i + 3] > 140) lit++; } }
  return { any, lit, w: c.width, h: c.height };
});

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p.mouse.click(800, 500);
  await wait(7000);

  ok(await shown(p), 'the ribbon is up while the station plays');
  const geo = await p.evaluate(() => {
    const c = document.getElementById('noteribbon'), r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             fromBottom: Math.round(innerHeight - r.bottom), vw: innerWidth };
  });
  ok(geo.w >= geo.vw - 2, 'it spans the window (' + geo.w + ' of ' + geo.vw + ')');
  ok(geo.fromBottom === 0, 'sitting on the bottom edge');
  ok(geo.h > 20 && geo.h < 90, 'and stays a strip rather than a second view (' + geo.h + 'px tall)');

  const a = await pixels(p);
  const notes = await p.evaluate(() => Audio.currentScore().gb.notes.length);
  ok(a.any > 500, 'it has drawn the track (' + notes + ' notes, ' + a.any + ' painted pixels)');
  await wait(7000);
  const c2 = await pixels(p);
  ok(c2.lit > a.lit, 'and the played part grows as the song plays (' + a.lit + ' -> ' + c2.lit + ' lit pixels)');
  ok(Math.abs(c2.any - a.any) < a.any * 0.25, 'while the track itself stays put (baked once, not redrawn)');

  const cost = await p.evaluate(() => window.__rrrFrame.cost);
  ok(cost < 8, 'the frame still costs ' + cost + 'ms with it on');

  // it belongs to the station: the editor has its own grid
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('a,button')]
      .find(x => /create/i.test(x.textContent || '') || /create/i.test(x.getAttribute('href') || ''));
    if (b2) b2.click();
  });
  await wait(4500);
  ok(!(await shown(p)), 'it gets out of the way when the editor opens');
  await p.evaluate(() => {
    const t = document.querySelector('.cr-tour'); if (t) t.remove();
    const c = [...document.querySelectorAll('button')].find(x => /^close$/i.test(x.textContent.trim()));
    if (c) c.click();
  });
  await wait(4000);
  ok(await shown(p), 'and comes back on Close');
  ok(!errs.length, 'no page errors' + (errs.length ? ' -- ' + errs[0] : ''));

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-ribbon: ' + fail + ' FAILED'
                   : '\nverify-ribbon: the whole track reads along the bottom');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
