// Nothing plays until you ask for it.
//
// A cold load holds: the station writes nothing until a mood is picked, the
// play button is pressed, or a link names a song. This is easy to break from a
// distance, and it did break -- "tap anywhere to start the music" was still
// wired to the whole page, and once holding correctly reported as PAUSED (it
// is: nothing is playing) that handler read every stray click as "resume" and
// started a mood at random. A visitor who clicked the background got music
// they had not asked for.
//
// So this checks both halves: a click that means nothing starts nothing, and
// the two things that DO mean something still work.
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

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(4000);

  ok(await p.evaluate(() => !!(Audio.isHolding && Audio.isHolding())), 'a cold load holds');
  ok(await p.evaluate(() => document.body.classList.contains('awaiting-mood')),
     'and says so: the moods are the only thing on offer');
  ok((await peak(p, 2500)) < 0.02, 'nothing is sounding');
  // ...and nothing tells you to just listen, either. That hint is for somebody
  // watching a game; on the home it lands over the buttons that would give them
  // something to listen to.
  await p.keyboard.press('KeyX');
  await p.mouse.click(700, 300);
  await wait(900);
  const shouted = await p.evaluate(() => {
    const t = [...document.querySelectorAll('*')]
      .filter(e => /toast/i.test(String(e.className)) && e.getClientRects().length)
      .map(e => e.textContent.trim()).filter(Boolean);
    return t.join(' | ');
  });
  ok(!/background radio/i.test(shouted),
     'and nothing says "this is a background radio" before there is one' +
     (shouted ? ' -- saw: ' + shouted.slice(0, 60) : ''));
  ok(await p.evaluate(() => { const b2 = document.getElementById('pbPlay'); return b2 && b2.dataset.icon === 'play'; }),
     'the transport offers PLAY, not pause');

  // Clicks that mean nothing must start nothing. Address the inert surfaces by
  // role: fixed viewport coordinates become controls as the landing Game Boy
  // and player bar move between layouts.
  const checkInert = async (what, click) => {
    await click();
    await wait(1200);
    const q = await peak(p, 1500);
    const held = await p.evaluate(() => !!(Audio.isHolding && Audio.isHolding()));
    ok(q < 0.02 && held, 'clicking ' + what + ' starts nothing (' + q.toFixed(3) + ')');
  };
  const inertTargets = [
    ['#stage', 'pointerdown', 'the game scene'],
    ['.rmood-brand', 'click', 'the landing screen'],
    ['#playbar', 'click', 'the player-bar background'],
    ['.pb-lcd-head', 'click', 'the track header around its title']
  ];
  for (const [selector, type, what] of inertTargets) {
    const exists = await p.evaluate(sel => !!document.querySelector(sel), selector);
    ok(exists, what + ' exists');
    if (exists) await checkInert(what, () => p.evaluate(([sel, eventType]) => {
      const EventType = eventType === 'pointerdown' ? PointerEvent : MouseEvent;
      document.querySelector(sel).dispatchEvent(new EventType(eventType, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse'
      }));
    }, [selector, type]));
  }

  // ...and the two things that DO mean something still work
  await p.evaluate(() => { document.getElementById('pbPlay').click(); });
  await wait(3500);
  ok((await peak(p, 3000)) > 0.02, 'pressing play starts one anyway (it means "surprise me")');

  await p.reload({ waitUntil: 'domcontentloaded' });
  await wait(4000);
  await p.evaluate(() => {
    const C = CT_COMPOSERS.rrr_core;
    const original = C.compile;
    window.__moodCompileCalls = 0;
    C.compile = function () {
      window.__moodCompileCalls++;
      return original.apply(this, arguments);
    };
    // Naturally a trance token. An epic request must constrain this one token
    // to anthem, rather than compiling new tokens until anthem appears.
    Song.mint = () => '523e26qcl13jeeuu';
  });
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'epic');
    if (b2) b2.click();
  });
  await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
  await wait(3000);
  ok((await peak(p, 3000)) > 0.02, 'and picking a mood plays that');
  const moodResult = await p.evaluate(() => {
    const s = CT_CREATE._source();
    return { calls: window.__moodCompileCalls, style: s && s.style,
             premise: s && s.tracker && s.tracker.premise };
  });
  ok(moodResult.calls === 1, 'a mood composes exactly one token (' + moodResult.calls + ' call)');
  ok(moodResult.style === 'anthem' && moodResult.premise &&
     moodResult.premise.styles && moodResult.premise.styles[0] === 'anthem',
     'and that one score records and satisfies the epic premise');
  ok(!(await p.evaluate(() => document.body.classList.contains('awaiting-mood'))),
     'the hero stands down once something is on');
  ok(!errs.length, 'no page errors' + (errs.length ? ' -- ' + errs[0] : ''));

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-entry: ' + fail + ' FAILED'
                   : '\nverify-entry: nothing plays until it is asked for');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
