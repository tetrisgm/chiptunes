// Sharing a song shares THE SONG -- and does it the same way from both places.
//
// The old share button copied location.href. That only ever worked because the
// generated name sat in the path and the name was the composer's seed; both are
// gone, and once a note has been moved no seed reproduces the song at all. So a
// link carries the document, packed into the fragment, and it is the same link
// whether the song came off the station or out of the editor. This checks the
// whole loop: share it, open it as somebody else, and compare note for note.
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

const sig = p => p.evaluate(() => {
  const s = (Audio.currentScore && Audio.currentScore()) || null;
  const n = (s && s.gb && s.gb.notes) || [];
  return { name: (document.getElementById('pbTitle') || {}).textContent.trim(),
           notes: n.length,
           sig: n.slice(0, 80).map(x => x.frame + ':' + x.ch + ':' + x.midi).join(','),
           peak: Audio.outputProbe().peak, route: location.pathname };
});

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 },
                                   permissions: ['clipboard-read', 'clipboard-write'] });
  const errs = [];
  const local = u => u.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${h.port}`);

  // ---- 1. share what the station is playing --------------------------------
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p.mouse.click(720, 450);
  await wait(6000);
  const sent = await sig(p);
  await p.evaluate(() => { const s = document.getElementById('rshare'); if (s) s.click(); });
  await wait(1800);
  const link = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(/\/#s=/.test(link), 'the station\'s share button copies a song link (' + link.length + ' chars)');
  ok(/\/#s=z/.test(link), 'and it is compressed -- ' + link.length + ' chars for a ' + sent.notes + '-note song');

  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p2.goto(local(link), { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p2.mouse.click(720, 450);
  await wait(7000);
  await p2.evaluate(async () => { for (let i = 0; i < 30; i++) {
    if (Audio.outputProbe().peak > 0.02) break; await new Promise(r => setTimeout(r, 200)); } });
  const got = await sig(p2);
  ok(got.notes === sent.notes && got.sig === sent.sig,
     'opening it plays the same song, note for note (' + sent.notes + ' notes)');
  ok(got.name === sent.name, 'under the same name ("' + got.name + '")');
  ok(got.peak > 0.02, 'and it is sounding (' + got.peak.toFixed(3) + ')');
  ok(got.route === '/', 'on the station, not in the editor (' + got.route + ')');
  await p2.close();

  // ---- 2. share a song out of the editor -----------------------------------
  const p3 = await ctx.newPage();
  p3.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p3.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
  await p3.waitForFunction(() => document.querySelector('#createscreen.show'), null, { timeout: 40000 });
  await wait(3600);
  await p3.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
  await p3.evaluate(() => document.querySelector('[data-mood="battle"]').click());
  await wait(5000);
  const made = await p3.evaluate(() => {
    const s = CT_CREATE._score();
    return { notes: s.notes.length, sig: s.notes.slice(0, 80).map(x => x.frame + ':' + x.ch + ':' + x.midi).join(',') };
  });
  await p3.evaluate(() => { const b2 = document.querySelector('[data-cr="share"]'); if (b2) b2.click(); });
  await wait(1800);
  const link2 = await p3.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(/\/#s=/.test(link2), 'the editor\'s share button copies the same kind of link (' + link2.length + ' chars)');
  ok(!/\/create/.test(link2), 'pointing at the station, not at the editor');

  const p4 = await ctx.newPage();
  p4.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p4.goto(local(link2), { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await p4.mouse.click(720, 450);
  await wait(7000);
  const heard = await p4.evaluate(async () => {
    const s = (Audio.currentScore && Audio.currentScore()) || null;
    const n = (s && s.gb && s.gb.notes) || [];
    let peak = 0;                       // one reading lands in the gap between notes
    for (let i = 0; i < 40; i++) {
      peak = Math.max(peak, Audio.outputProbe().peak);
      if (peak > 0.02) break;
      await new Promise(r => setTimeout(r, 200));
    }
    return { notes: n.length, sig: n.slice(0, 80).map(x => x.frame + ':' + x.ch + ':' + x.midi).join(','), peak };
  });
  ok(heard.notes === made.notes && heard.sig === made.sig,
     'a song made in the editor plays back the same on the station (' + made.notes + ' notes)');
  ok(heard.peak > 0.02, 'and it is sounding (' + heard.peak.toFixed(3) + ')');

  ok(!errs.length, 'no page errors' + (errs.length ? ' -- ' + errs[0] : ''));
  await b.close(); h.s.close();
  console.log(fail ? '\nverify-share: ' + fail + ' FAILED'
                   : '\nverify-share: a shared link is the song, from either side');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
