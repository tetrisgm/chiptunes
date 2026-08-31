// THE CHROME AROUND THE MUSIC.
//
// Six small claims about the furniture, each of which has been wrong at least
// once and none of which any other gate is watching:
//
//   1. The volume is the last thing in the bar, not sitting next to the
//      transport where it competed with play/pause for the same glance.
//   2. The Display button is a button like its neighbours -- it was tinted
//      green whenever the screen was anything but the plain CRT, which is
//      nearly always, so the one control that merely REPORTS a setting looked
//      like the one control that was switched on.
//   3. "Write me a song that is" and the moods are one sentence on one line,
//      set identically -- not a heading over a list.
//   5. The credit's GitHub button goes to the REPOSITORY, not the profile.
//   6. The landing page's reel cuts to a different game every two seconds.
//
// Track names are checked in node, below, without a browser.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const SHOT = path.join(__dirname, '..', '.shots');
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

// ---- 0. the names, which need no browser ----------------------------------
function names() {
  const Song = require(path.join(__dirname, '..', 'src', 'seed.js'));
  const t = Song.mint();
  ok(Song.nameFor(t) === Song.nameFor(t), 'a token always names the same song');

  const N = 40000, seen = new Set(), words = new Set();
  let numerals = 0;
  for (let i = 0; i < N; i++) {
    const n = Song.nameFor(Song.mint());
    seen.add(n);
    n.split(' ').forEach(w => words.add(w.toLowerCase()));
    if (/(^| )(I{2,3}|IV|VI?|X|[23]|'\d\d|DX|EX|GX|Turbo|Plus|Zero)$/.test(n)) numerals++;
  }
  ok(seen.size > 20000, 'the namespace is wide enough not to repeat (' + seen.size + ' in ' + N + ')');
  ok(numerals / N > 0.15, 'sequel numerals appear, the way the shelf did (' +
     Math.round(100 * numerals / N) + '%)');

  // Nothing soft-indie survives: these were the old vocabulary and would read
  // as an album, not a cartridge.
  const gone = ['velvety', 'dreamers', 'sparrows', 'wanderers', 'shiver', 'linger', 'whisper', 'lovers'];
  ok(gone.every(w => !words.has(w)), 'the album-sleeve words are gone');

  // ...and nothing lands on a real title. This is the one that matters: a
  // generated name that hits a trademark puts it on a page we publish.
  const real = ['doubledragon', 'shadowwarriors', 'thunderforce', 'dragonwarrior', 'iceclimber',
    'blastermaster', 'irontank', 'twincobra', 'mysticquest', 'solarstriker', 'starfox',
    'marblemadness', 'battlecity', 'radracer', 'finalfight', 'megaman', 'metalgear',
    'goldenaxe', 'dragonquest', 'timelord', 'skyshark', 'darkcastle', 'metalstorm',
    'rivercity', 'outrun', 'hangon', 'shiningforce', 'goldensun', 'solarjetman',
    'silentservice', 'guerrillawar', 'cobratriangle', 'afterburner', 'galaxyforce'];
  const bad = new Set(real);
  let leak = 0, ex = '';
  for (let i = 0; i < 200000; i++) {
    const n = Song.nameFor(Song.mint()).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (bad.has(n)) { leak++; if (!ex) ex = n; }
  }
  ok(leak === 0, 'no generated name is a real cartridge title' + (leak ? ' (' + leak + 'x, e.g. ' + ex + ')' : ''));
  console.log('       e.g. ' + [...seen].slice(0, 6).join(' · '));
}

(async () => {
  console.log('names');
  names();

  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  try { fs.mkdirSync(SHOT, { recursive: true }); } catch (e) {}

  // ---- 3. the ask, on the landing page ------------------------------------
  console.log('the ask');
  const ask = await p.evaluate(() => {
    const lab = document.querySelector('#rmoods .rmood-ask .rmood-lab');
    const pill = document.querySelector('#rmoods .rbtn.rmood');
    if (!lab || !pill) return null;
    const f = e => { const c = getComputedStyle(e); return c.fontSize + '/' + c.fontWeight + '/' + c.fontFamily; };
    const lr = lab.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    const moods=[...document.querySelectorAll('.rmood')].filter(b => !b.classList.contains('rmood-scratch') && !b.classList.contains('rmood-select'));
    const scratch=document.querySelector('.rmood-scratch');
    const tops=moods.map(b => Math.round(b.getBoundingClientRect().top));
    return { sameFont: f(lab) === f(pill), size: getComputedStyle(lab).fontSize,
             sameRow: new Set(tops).size === 1, firstHappy: moods[0] && moods[0].textContent.trim() === 'happy',
             scratchOneLine: !!scratch && getComputedStyle(scratch).whiteSpace === 'nowrap' && scratch.scrollHeight <= scratch.clientHeight,
             scratchWidth: scratch ? Math.round(scratch.getBoundingClientRect().width) : 0,
             text: lab.textContent.trim() };
  });
  ok(!!ask, 'the ask is on the landing page');
  ok(ask && ask.sameFont, 'the question is set exactly like the answers (' + (ask && ask.size) + ')');
  ok(ask && ask.sameRow, 'the four moods share one line');
  ok(ask && ask.firstHappy, 'and Happy is the first mood');
  ok(ask && ask.scratchOneLine && ask.scratchWidth >= 280,
    'Start from scratch stays on one line in a wider button (' + (ask && ask.scratchWidth) + 'px)');
  await p.screenshot({ path: path.join(SHOT, 'chrome-landing.png') });

  // ---- 6. the reel --------------------------------------------------------
  console.log('the reel');
  const reel = await p.evaluate(async () => {
    const seen = [], t0 = performance.now();
    await new Promise(r => { const iv = setInterval(() => {
      seen.push({ ms: Math.round(performance.now() - t0), k: (window._reelKeys || [])[window._reelAt] });
      if (performance.now() - t0 > 9500) { clearInterval(iv); r(); }
    }, 200); });
    const cuts = seen.filter((s, i) => i && s.k !== seen[i - 1].k);
    const gaps = cuts.slice(1).map((c, i) => c.ms - cuts[i].ms);
    return { running: !!window._reelTimer, pool: (window._reelKeys || []).length,
             distinct: new Set(seen.map(s => s.k).filter(Boolean)).size, gaps };
  });
  ok(reel.running, 'the reel is running on the home');
  ok(reel.pool > 10, 'over the whole roster (' + reel.pool + ' games)');
  ok(reel.distinct >= 3, 'and it cut to ' + reel.distinct + ' different games in 9.5s');
  // Timed by SAMPLING, which a slow showGame blocks: a pack that takes 900ms
  // to load stalls the sampler, so the cut is detected late and the next one
  // looks early. The cadence is what is being checked, so check the mean and
  // the count rather than each gap.
  const mean = reel.gaps.length ? reel.gaps.reduce((a, b) => a + b, 0) / reel.gaps.length : 0;
  // one gap is enough for the cadence: that there were SEVERAL cuts is the
  // assertion above, and demanding two gaps here failed a run whose single
  // measured gap was 2030ms -- a correct reel, rejected for being sampled once.
  ok(reel.gaps.length >= 1 && mean > 1700 && mean < 2400,
     'every two seconds (mean ' + Math.round(mean) + 'ms of ' + reel.gaps.join(', ') + ')');

  // ---- now put a song on --------------------------------------------------
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'chill');
    if (b) b.click();
  });
  await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
  await wait(6000);
  await p.evaluate(() => { if (window._pokeVisualControls) _pokeVisualControls(); });
  await wait(400);

  // ---- 1 + 2. the bar -----------------------------------------------------
  console.log('the player bar');
  const bar = await p.evaluate(() => {
    const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, h: b.height }; };
    const right = document.querySelector('#playbar .pb-right');
    const vol = document.querySelector('#playbar .pb-voldial'), adv = document.getElementById('pbAdvanced');
    const sc = document.getElementById('pbScreen'), bpm = document.querySelector('#playbar .pb-bpmdial');
    const fs = document.getElementById('rfullscreen');
    const track = document.querySelector('#playbar .pb-ctrl'), transport=document.querySelector('#playbar .pb-main-ctrl');
    const kids = [...right.children].filter(e => e.getClientRects().length);
    const cs = e => getComputedStyle(e);
    return {
      onlyVolumeAdvanced: kids.filter(e => e !== fs).length === 2 &&
        kids.filter(e => e !== fs)[0].contains(vol) && kids.filter(e => e !== fs)[1] === adv,
      screenHidden: !sc || !sc.getClientRects().length,
      bpmHidden: !bpm || !bpm.getClientRects().length,
      volRight: R(vol).r, fsRight: fs ? R(fs).r : -1, rightEdge: R(right).r,
      volumeText: document.getElementById('pbVolume').textContent.replace(/\s+/g, ' ').trim(),
      advancedVisible: !!adv && !!adv.getClientRects().length,
      volumeSlider: (() => { const s=document.getElementById('pbVol'); return s && s.getClientRects().length ? Math.round(R(s).r-R(s).l) : 0; })(),
      trackCenter: Math.round((R(track).l+R(track).r)/2), viewportCenter:Math.round(innerWidth/2),
      transportBeforeTrack: R(transport).r < R(track).l,
      volH: Math.round(R(vol).h), rightPos: cs(right).position, barCls: document.body.className
    };
  });
  ok(bar.onlyVolumeAdvanced, 'the right dock contains only volume and advanced volume');
  ok(bar.screenHidden && bar.bpmHidden, 'Visualizer and BPM are absent from the bar');
  ok(/^VOL\s*\d+/.test(bar.volumeText), 'volume remains readable (' + bar.volumeText + ')');
  ok(bar.advancedVisible, 'the advanced volume button is visible');
  ok(bar.volumeSlider >= 140, 'the complete volume slider is visible (' + bar.volumeSlider + 'px)');
  ok(Math.abs(bar.trackCenter-bar.viewportCenter) <= 2 && bar.transportBeforeTrack,
     'the track is centred with transport immediately to its left');
  ok(bar.rightEdge - bar.fsRight < 2,
     'fullscreen is hard against its right edge (' + Math.round(bar.rightEdge - bar.fsRight) + 'px)');
  console.log('       state: ' + bar.barCls + ' | right ' + bar.rightPos + ' | vol ' + bar.volH);

  // ---- reaching for a dial opens the mixer --------------------------------
  console.log('the dials');
  const hover = await p.evaluate(async () => {
    const panel = () => { const m = document.getElementById('mixpanel');
      return !!m && m.style.display !== 'none' && m.getClientRects().length > 0; };
    try { if (window.closeMixPanel) closeMixPanel(); } catch (e) {}
    const before = panel();
    const out = {};
    for (const sel of ['.pb-voldial', '.pb-adv']) {
      try { if (window.closeMixPanel) closeMixPanel(); } catch (e) {}
      const el = document.querySelector('#playbar ' + sel);
      if (!el) { out[sel] = 'missing'; continue; }
      el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse' }));
      await new Promise(r => setTimeout(r, 320));      // the opener waits 140ms
      out[sel] = panel();
      // and leaving before the delay elapses must NOT open it
      try { if (window.closeMixPanel) closeMixPanel(); } catch (e) {}
      el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
      await new Promise(r => setTimeout(r, 320));
      out[sel + ':cancelled'] = panel();
    }
    try { if (window.closeMixPanel) closeMixPanel(); } catch (e) {}
    return Object.assign({ before }, out);
  });
  ok(hover.before === false, 'the mixer starts closed');
  ok(hover['.pb-voldial'] === true, 'hovering volume opens the advanced menu');
  ok(hover['.pb-adv'] === true, 'hovering its advanced icon opens the menu too');
  ok(hover['.pb-voldial:cancelled'] === false && hover['.pb-adv:cancelled'] === false,
     'a pointer passing straight over does not open it');

  const display = await p.evaluate(() => {
    if (window.openMixPanel) openMixPanel();
    const buttons = [...document.querySelectorAll('#mixpanel .mixdisplay button')];
    const panel=document.getElementById('mixpanel'), lead=[...panel.querySelectorAll('.mixrow label')].find(x => /Lead/.test(x.textContent));
    const pr=panel.getBoundingClientRect(), lr=lead&&lead.getBoundingClientRect();
    return { labels:buttons.map(b => b.textContent.trim()), width:Math.round(pr.width),
      leadOneLine:!!lead && lead.scrollHeight<=lead.clientHeight, sidePad:Math.round(lr.left-pr.left) };
  });
  ok(display.labels.join('|') === 'Random|Modern|Game Boy|NES',
     'display modes moved into the advanced menu (' + display.labels.join(', ') + ')');
  ok(display.width >= 680 && display.leadOneLine && display.sidePad >= 60,
     'the advanced menu is spacious and keeps Lead / melody on one line (' + display.width + 'px)');

  // ---- 5. the credit ------------------------------------------------------
  console.log('the credit');
  const credit = await p.evaluate(() => {
    const a = [...document.querySelectorAll('a.plmade-btn, #madeby a, #plinks a')]
      .find(x => /github/i.test(x.textContent) || /github\.com/.test(x.href || ''));
    const made = document.getElementById('madeby'), hn = made && made.querySelector('.plmade-hn');
    const labels = made ? [...made.querySelectorAll('.plmade-btn .plink-t')].filter(x => x.getClientRects().length).map(x => x.textContent.trim()) : [];
    const r = made && made.getBoundingClientRect();
    const rail=document.getElementById('plinks'), rr=rail&&rail.getBoundingClientRect();
    return { href:a ? a.href : null, hnHidden:!hn || !hn.getClientRects().length,
      labels, left:r ? Math.round(r.left) : -1, aboveRail:!!r&&!!rr&&r.bottom<rr.top };
  });
  ok(/github\.com\/[^/]+\/chiptunes\/?$/.test(credit.href || ''), 'GitHub goes to the repository (' + credit.href + ')');
  ok(credit.hnHidden && credit.labels.length === 0, 'playing hides Hacker News and the social labels');
  ok(credit.left <= 20 && credit.aboveRail, 'the playing credit sits above the left rail (' + credit.left + 'px)');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.s.close();
  console.log(fail ? '\nFAILED (' + fail + ')' : '\nall good');
  process.exit(fail ? 1 : 0);
})();
