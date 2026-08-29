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
  // Nothing plays until asked: pick a mood, which is the station's entry now.
  const startStation = async (pg) => {
    await pg.evaluate(() => {
      const b = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'chill');
      if (b) b.click();
    });
    await pg.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
  };
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
// a canvas whose PARENT is display:none still computes display:block itself
const shown = p => p.evaluate(() => {
  const c = document.getElementById('noteribbon');
  return !!c && c.getClientRects().length > 0;
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
  await startStation(p);
  await wait(7000);

  ok(await shown(p), 'the ribbon is up while the station plays');
  const geo = await p.evaluate(() => {
    const c = document.getElementById('noteribbon'), r = c.getBoundingClientRect();
    const ctrl = document.querySelector('#playbar .pb-ctrl');
    const cr = ctrl ? ctrl.getBoundingClientRect() : null;
    const play = document.getElementById('pbPlay');
    const pr = play ? play.getBoundingClientRect() : null;
    return { w: Math.round(r.width), h: Math.round(r.height),
             inCtrl: !!(ctrl && ctrl.contains(c)),
             belowButtons: !!(pr && r.top >= pr.bottom - 1),
             centred: cr ? Math.abs((cr.left + cr.right) / 2 - innerWidth / 2) : 999,
             fromBottom: cr ? Math.round(innerHeight - cr.bottom) : -1,
             times: [(document.getElementById('pbElapsed')||{}).textContent,
                     (document.getElementById('pbTotal')||{}).textContent] };
  });
  ok(geo.inCtrl, 'it lives inside the transport group, not floating on its own');
  ok(geo.belowButtons, 'sitting under the play button, the way a scrubber does');
  ok(geo.centred < 3, 'the group stays centred (' + geo.centred.toFixed(1) + 'px off)');
  ok(geo.fromBottom > 0 && geo.fromBottom < 60, 'and anchored to the bottom (' + geo.fromBottom + 'px up)');
  ok(geo.h > 20 && geo.h < 90, 'the track stays a strip rather than a second view (' + geo.h + 'px tall)');
  ok(/^\d+:\d\d$/.test(geo.times[0] || '') && /^\d+:\d\d$/.test(geo.times[1] || ''),
     'with elapsed and total either side (' + geo.times.join(' / ') + ')');

  // the four voices must be TOLD APART, in the editor's colours -- the first
  // cut mapped every voice into one pitch band and came out 69% drum-purple
  const voices = await p.evaluate(async () => {
    const c = document.getElementById('noteribbon');
    // Wait for a REAL bake. 200 painted pixels is satisfied by the empty strip
    // -- the bar is up from the first paint now, so there is a legitimate state
    // with almost nothing in it, and sampling colours then reads one voice or
    // none. A whole track paints tens of thousands.
    for (let t = 0; t < 60; t++) {
      const q = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < q.length; i += 4) if (q[i] > 40) { n++; if (n > 4000) break; }
      if (n > 4000) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const want = [[0x7B,0xDC,0xA0],[0x57,0xC4,0xFF],[0xE8,0xA7,0x5D],[0xC9,0xA4,0xE8]];
    const hit = [0, 0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue;
      let best = -1, bd = 60;
      for (let k = 0; k < 4; k++) {
        const dd = Math.abs(d[i] - want[k][0]) + Math.abs(d[i+1] - want[k][1]) + Math.abs(d[i+2] - want[k][2]);
        if (dd < bd) { bd = dd; best = k; }
      }
      if (best >= 0) hit[best]++;
    }
    const n = Audio.currentScore().gb.notes, per = [0,0,0,0];
    n.forEach(x => per[x.ch | 0]++);
    return { hit, per };
  });
  const sounding = voices.per.filter(x => x > 0).length;
  const drawn = voices.hit.filter(x => x > 20).length;
  ok(drawn >= Math.min(3, sounding),
     'each voice is drawn in its own editor colour (' + drawn + ' of ' + sounding +
     ' sounding voices found: ' + voices.hit.join('/') + ')');
  const tot = voices.hit.reduce((a, c) => a + c, 0) || 1;
  ok(Math.max(...voices.hit) / tot < 0.75,
     'and no single voice swamps the strip (' + (100 * Math.max(...voices.hit) / tot).toFixed(0) + '% at most)');

  const a = await pixels(p);
  const notes = await p.evaluate(() => Audio.currentScore().gb.notes.length);
  ok(a.any > 500, 'it has drawn the track (' + notes + ' notes, ' + a.any + ' painted pixels)');
  await wait(7000);
  const c2 = await pixels(p);
  ok(c2.lit > a.lit, 'and the played part grows as the song plays (' + a.lit + ' -> ' + c2.lit + ' lit pixels)');
  ok(Math.abs(c2.any - a.any) < a.any * 0.25, 'while the track itself stays put (baked once, not redrawn)');

  // its OWN cost, not the whole frame's -- the frame EMA covers the game and
  // the shaders and is dominated by whatever the software rasteriser is doing
  const rib = await p.evaluate(() => window.__rrrFrame.rib);
  ok(rib < 1.5, 'drawing it costs ' + rib + 'ms a frame (baked once, blitted twice)');

  // it belongs to the station: the editor has its own grid
  // ...and the strip is itself the way in: clicking it opens the editor
  await p.evaluate(() => { document.getElementById('noteribbon').click(); });
  await wait(4500);
  // The strip STAYS while the editor is open, deliberately: the bar owns the
  // bottom of the window and has to be the same height in both views, or
  // whatever is contained above it jumps by the difference when you open one.
  ok(await shown(p), 'it stays while the editor is open -- the bar keeps one height');
  const inset = await p.evaluate(() => {
    const cs = document.getElementById('createscreen');
    const pb = document.getElementById('playbar');
    if (!cs || !pb) return null;
    const a = cs.getBoundingClientRect(), b2 = pb.getBoundingClientRect();
    return { gap: Math.round(a.bottom - b2.top), vis: getComputedStyle(pb).visibility };
  });
  ok(inset && Math.abs(inset.gap) < 2, 'and the editor is contained above it (' +
     (inset ? inset.gap + 'px overlap' : 'not measured') + ')');
  ok(inset && inset.vis === 'visible', 'with the bar actually visible under it');
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
