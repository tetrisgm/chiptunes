// Leaving Create must hand the station back playing.
//
// The editor takes the chip over: it owns the worklet, it can mute lanes, it
// can leave a four-bit sample sitting in wave RAM. Closing it has to undo all
// of that, and the failure mode is not subtle -- the radio comes back silent,
// and pressing pause and play does not rescue it, because nothing reposts the
// score. That was reported from the wild and could not be reproduced by hand,
// which is exactly the kind of bug that needs a test standing over it.
//
// Every scenario below is a way of leaving the editor in a different state.
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

const peak = async (p, ms) => {
  let k = 0;
  for (let i = 0; i < Math.ceil(ms / 200); i++) {
    k = Math.max(k, await p.evaluate(() => Audio.outputProbe().peak));
    await wait(200);
  }
  return k;
};

// each scenario is a function run inside the open editor
const SCENARIOS = {
  'edited a note': async p => {
    await p.evaluate(async () => {
      const n = document.querySelector('.n-note'); if (!n) return;
      n.click(); await new Promise(r => setTimeout(r, 300));
      const v = [...document.querySelectorAll('.n-pick .n-po')].find(x => x.dataset.ed === 'vol+');
      if (v) { v.click(); await new Promise(r => setTimeout(r, 250)); }
      const c = document.querySelector('.n-pclose'); if (c) c.click();
    });
  },
  'muted every lane': async p => {
    await p.evaluate(async () => {
      for (const c of [0, 1, 2, 3]) {
        const s = document.querySelector('.n-lane[data-ch="' + c + '"] .n-spk');
        if (s) { s.click(); await new Promise(r => setTimeout(r, 120)); }
      }
    });
  },
  'left a sample in wave RAM': async p => {
    await p.evaluate(async () => {
      const d = document.querySelector('.n-note[data-ch="3"]'); if (!d) return;
      d.click(); await new Promise(r => setTimeout(r, 300));
      const k = [...document.querySelectorAll('.n-pick .n-pv')].find(x => x.dataset.full === 'Kick');
      if (k) { k.click(); await new Promise(r => setTimeout(r, 300)); }
      const c = document.querySelector('.n-pclose'); if (c) c.click();
    });
  },
  'still playing when closed': async () => {}      // closed mid-playback
};

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  for (const [name, setup] of Object.entries(SCENARIOS)) {
    const p = await b.newPage({ viewport: { width: 1380, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
    await wait(3000);
    // Nothing plays until asked: a cold load holds and offers the moods.
    await p.evaluate(() => {
      const b2 = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'chill');
      if (b2) b2.click();
    });
    await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
    await wait(4000);
    const before = await peak(p, 1000);

    await p.evaluate(() => {
      const b2 = [...document.querySelectorAll('a,button')]
        .find(x => /create/i.test(x.textContent || '') || /create/i.test(x.getAttribute('href') || ''));
      if (b2) b2.click();
    });
    await wait(4500);
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    // The editor opens FOLLOWING what is already sounding, so pressing play
    // here would pause it. Only press it if it is not already running.
    await p.evaluate(async () => {
      const d = CT_CREATE._dbg && CT_CREATE._dbg();
      if (!d || !d.playing) { const b2 = document.querySelector('[data-cr="play"]'); if (b2) b2.click(); }
    });
    await wait(1800);
    await setup(p);
    await wait(1200);

    await p.evaluate(() => {
      const c = [...document.querySelectorAll('button')].find(x => /^close$/i.test(x.textContent.trim()));
      if (c) c.click();
    });
    await wait(3200);
    const after = await peak(p, 2500);
    // and the transport still works afterwards
    await p.keyboard.press('Space'); await wait(1000);
    await p.keyboard.press('Space'); await wait(1800);
    const restarted = await peak(p, 2500);

    ok(before > 0.02, name + ': the station was playing to begin with (' + before.toFixed(3) + ')');
    ok(after > 0.02, name + ': it is playing again after Close (' + after.toFixed(3) + ')');
    ok(restarted > 0.02, name + ': and pause/play still works (' + restarted.toFixed(3) + ')');
    ok(!errs.length, name + ': no page errors' + (errs.length ? ' -- ' + errs[0] : ''));
    await p.close();
  }

  // the other way in: /create opened cold, with the station never started
  {
    const p = await b.newPage({ viewport: { width: 1380, height: 900 } });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#createscreen.show'), null, { timeout: 40000 });
    await wait(3600);
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    await p.evaluate(async () => {
      const d = CT_CREATE._dbg && CT_CREATE._dbg();
      if (!d || !d.playing) { const b2 = document.querySelector('[data-cr="play"]'); if (b2) b2.click(); }
    });
    await wait(1800);
    await p.evaluate(() => {
      const c = [...document.querySelectorAll('button')].find(x => /^close$/i.test(x.textContent.trim()));
      if (c) c.click();
    });
    await wait(4500);
    const started = await peak(p, 3000);
    ok(started > 0.02, 'opened cold at /create: closing it starts the station (' + started.toFixed(3) + ')');
    await p.close();
  }

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-create-handover: ' + fail + ' FAILED'
                   : '\nverify-create-handover: the station comes back every way out');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
