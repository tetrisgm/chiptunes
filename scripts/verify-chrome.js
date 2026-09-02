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
  ok(!await p.$('#intro .intro-hero'), 'the obsolete splash screen is absent');
  const ask = await p.evaluate(() => {
    const lab = document.querySelector('#rmoods .rmood-ask .rmood-lab');
    const pill = document.querySelector('#rmoods .rbtn.rmood');
    if (!lab || !pill) return null;
    const f = e => { const c = getComputedStyle(e); return c.fontSize + '/' + c.fontWeight + '/' + c.fontFamily; };
    const lr = lab.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    const moods=[...document.querySelectorAll('.rmood')].filter(b => !b.classList.contains('rmood-scratch') && !b.classList.contains('rmood-select'));
    const scratch=document.querySelector('.rmood-scratch');
    const valueCopy=document.querySelector('#rmoods .rmood-brand');
    const tops=moods.map(b => Math.round(b.getBoundingClientRect().top));
    return { sameFont: f(lab) === f(pill), size: getComputedStyle(lab).fontSize,
             sameRow: new Set(tops).size === 1, firstHappy: moods[0] && moods[0].textContent.trim() === 'happy',
             scratchOneLine: !!scratch && getComputedStyle(scratch).whiteSpace === 'nowrap' && scratch.scrollHeight <= scratch.clientHeight,
             scratchWidth: scratch ? Math.round(scratch.getBoundingClientRect().width) : 0,
             valueCopy:valueCopy ? valueCopy.textContent.replace(/\s+/g,' ').trim() : '',
             text: lab.textContent.trim() };
  });
  ok(!!ask, 'the ask is on the landing page');
  ok(ask && ask.sameFont, 'the question is set exactly like the answers (' + (ask && ask.size) + ')');
  ok(ask && ask.sameRow, 'the four moods share one line');
  ok(ask && ask.firstHappy, 'and Happy is the first mood');
  ok(ask && ask.scratchOneLine && ask.scratchWidth >= 280,
    'Start from scratch stays on one line in a wider button (' + (ask && ask.scratchWidth) + 'px)');
  ok(ask && /CREATE OR LISTEN\./.test(ask.valueCopy) && /automatically, one after another/.test(ask.valueCopy),
    'the value proposition leads with automatic creation and listening');
  ok(ask && /COMPLETE SONGS\./.test(ask.valueCopy) && /not loops/.test(ask.valueCopy) && /AUTHENTIC HARDWARE\./.test(ask.valueCopy),
    'the landing copy explains composition and hardware authenticity');
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
    const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t:b.top, b:b.bottom, h: b.height }; };
    const right = document.querySelector('#playbar .pb-right');
    const vol = document.querySelector('#playbar .pb-voldial'), adv = document.getElementById('pbAdvanced');
    const sc = document.getElementById('pbScreen'), bpm = document.querySelector('#playbar .pb-bpmdial');
    const fs = document.getElementById('rfullscreen');
    const track = document.querySelector('#playbar .pb-ctrl'), transport=document.querySelector('#playbar .pb-main-ctrl');
    const left=document.querySelector('#playbar .pb-left'), title=document.getElementById('pbTitle'), share=document.getElementById('pbShare');
    const playbar=document.getElementById('playbar');
    const kids = [...right.children].filter(e => e.getClientRects().length);
    const cs = e => getComputedStyle(e);
    const surface=e=>{ const s=cs(e); return [s.backgroundColor,s.backgroundImage,s.borderTopColor,s.borderTopWidth,s.borderTopStyle,s.boxShadow]; };
    return {
      onlyVolume: kids.filter(e => e !== fs).length === 1 && kids.filter(e => e !== fs)[0].contains(vol),
      screenHidden: !sc || !sc.getClientRects().length,
      bpmHidden: !bpm || !bpm.getClientRects().length,
      volRight: R(vol).r, fsRight: fs ? R(fs).r : -1, rightEdge: R(right).r,
      volumeText: document.getElementById('pbVolume').textContent.replace(/\s+/g, ' ').trim(),
      advancedGone: !adv || !adv.getClientRects().length,
      volumeSlider: (() => { const s=document.getElementById('pbVol'); return s && s.getClientRects().length ? Math.round(R(s).r-R(s).l) : 0; })(),
      trackCenter: Math.round((R(track).l+R(track).r)/2), viewportCenter:Math.round(innerWidth/2),
      transportBeforeTrack: R(transport).r < R(track).l,
      trackMidY:Math.round((track.getBoundingClientRect().top+track.getBoundingClientRect().bottom)/2),
      transportMidY:Math.round((transport.getBoundingClientRect().top+transport.getBoundingClientRect().bottom)/2),
      leftMidY:Math.round((left.getBoundingClientRect().top+left.getBoundingClientRect().bottom)/2),
      volumeMidY:Math.round((vol.getBoundingClientRect().top+vol.getBoundingClientRect().bottom)/2),
      barMidY:Math.round((playbar.getBoundingClientRect().top+innerHeight)/2), barH:Math.round(R(playbar).h),
      trackPad:parseFloat(cs(track).paddingTop)+parseFloat(cs(track).paddingBottom),
      matchingSurfaces:[track,transport,vol].map(surface),
      titleAtLeft:!!title&&!!share&&R(title).l>=R(left).l-1&&R(share).l>=R(title).r&&Math.abs((R(title).t+R(title).b-R(share).t-R(share).b)/2)<3,
      metadataWidth:Math.round(R(left).r-R(left).l),
      shareVisible:!!share&&R(share).r<=innerWidth&&R(share).l>=R(left).l&&R(share).r<=R(left).r+1&&R(share).h>=38,
      zonesClear:R(left).r<=R(track).l-8&&R(track).r<=R(vol).l-8,
      titleType:[cs(title).fontFamily,cs(title).fontSize,cs(title).fontWeight,cs(title).lineHeight,cs(title).textShadow,cs(title).webkitTextStrokeWidth],
      volH: Math.round(R(vol).h), rightPos: cs(right).position, barCls: document.body.className
    };
  });
  ok(bar.onlyVolume, 'the right dock contains only the volume chip');
  ok(bar.screenHidden && bar.bpmHidden, 'Visualizer and BPM are absent from the bar');
  ok(/^VOL\s*\d+/.test(bar.volumeText), 'volume remains readable (' + bar.volumeText + ')');
  ok(bar.advancedGone, 'the separate advanced volume icon is gone');
  ok(bar.volumeSlider >= 140, 'the complete volume slider is visible (' + bar.volumeSlider + 'px)');
  ok(bar.transportBeforeTrack && bar.trackCenter > bar.viewportCenter,
     'transport and progress share the flexible middle lane');
  ok([bar.trackMidY,bar.transportMidY,bar.leftMidY,bar.volumeMidY].every(y=>Math.abs(y-bar.barMidY)<=6),
     'metadata, transport, progress and volume share one baseline ('+[bar.leftMidY,bar.transportMidY,bar.trackMidY,bar.volumeMidY].join('/')+' vs '+bar.barMidY+')');
  ok(bar.titleAtLeft, 'the track name sits at the bottom-left with its share button');
  ok(bar.metadataWidth >= 400 && bar.shareVisible,
     'the metadata zone is wide and keeps sharing visible ('+bar.metadataWidth+'px)');
  ok(bar.zonesClear, 'metadata, transport/progress and volume occupy clear player zones');
  ok(bar.titleType[1] === '25px' && bar.titleType[2] === '600' && bar.titleType[4] === 'none' && bar.titleType[5] === '0px',
     'the track title uses the page typography (' + bar.titleType.join(', ') + ')');
  ok(bar.barH >= 94 && bar.trackPad >= 16,
     'the bar and track chip have room around the title ('+bar.barH+'px bar, '+bar.trackPad+'px track padding)');
  ok(bar.matchingSurfaces.every(x => JSON.stringify(x) === JSON.stringify(bar.matchingSurfaces[0])),
     'track, transport and volume share one black surface treatment');
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
    for (const sel of ['.pb-voldial']) {
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
  ok(hover['.pb-voldial:cancelled'] === false,
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
    const gh = document.querySelector('.plmade-github');
    const stars = gh && gh.querySelector('.plmade-star-count');
    const made = document.getElementById('madeby'), hn = made && made.querySelector('.plmade-hn');
    const twitter = made && [...made.querySelectorAll('.plmade-btn')].find(x => /twitter\.com/.test(x.href || ''));
    const labels = made ? [...made.querySelectorAll('.plmade-btn .plink-t')].filter(x => x.getClientRects().length).map(x => x.textContent.trim()) : [];
    const r = made && made.getBoundingClientRect();
    const rail=document.getElementById('plinks'), rr=rail&&rail.getBoundingClientRect();
    const railButtons=rail ? [...rail.querySelectorAll('.plink')].filter(x=>x.getClientRects().length) : [];
    const railGap=railButtons.length>1 ? Math.round(railButtons[1].getBoundingClientRect().top-railButtons[0].getBoundingClientRect().bottom) : 0;
    const type=[made&&made.querySelector('.plmade-name'), made&&made.querySelector('.plmade-t'), rail&&rail.querySelector('.plink-t')]
      .map(x=>{ if(!x) return []; const s=getComputedStyle(x); return [
        s.fontFamily,s.fontSize,s.fontWeight,s.fontStyle,s.lineHeight,s.letterSpacing,
        s.textTransform,s.textShadow,s.getPropertyValue('-webkit-text-stroke-width')
      ]; });
    const ghRect=gh&&gh.getBoundingClientRect(), ghStyle=gh&&getComputedStyle(gh), starStyle=stars&&getComputedStyle(stars);
    const twitterStyle=twitter&&getComputedStyle(twitter);
    return { githubHref:gh&&gh.href, githubLabel:gh&&gh.getAttribute('aria-label'),
      starText:stars&&stars.textContent.trim(),
      hnVisible:!!hn && !!hn.getClientRects().length,
      githubVisible:!!ghRect && ghRect.width>0 && ghRect.height>0,
      githubHeight:ghRect&&Math.round(ghRect.height), githubBackground:ghStyle&&ghStyle.backgroundColor,
      githubRadius:ghStyle&&ghStyle.borderRadius, starDivider:starStyle&&starStyle.borderLeftWidth,
      githubSurface:ghStyle&&[ghStyle.backgroundImage,ghStyle.borderColor,ghStyle.boxShadow,ghStyle.color],
      twitterSurface:twitterStyle&&[twitterStyle.backgroundImage,twitterStyle.borderColor,twitterStyle.boxShadow,twitterStyle.color],
      labels, left:r ? Math.round(r.left) : -1, aboveRail:!!r&&!!rr&&r.bottom<rr.top, type, railGap };
  });
  ok(/github\.com\/tetrisgm\/chiptunes\/?$/.test(credit.githubHref || ''),
     'GitHub goes to the repository (' + credit.githubHref + ')');
  ok(credit.githubVisible && /^\d[\d,.]*[kKmM]?$/.test(credit.starText || '') && /star/i.test(credit.githubLabel || ''),
     'the GitHub control visibly exposes its live star count (' + credit.starText + ')');
  ok(credit.githubHeight === 48 && credit.githubRadius === '999px' && credit.starDivider === '1px' &&
     JSON.stringify(credit.githubSurface) === JSON.stringify(credit.twitterSurface),
     'the live GitHub control uses the same moulded Game Boy material as Twitter and Hacker News');
  ok(credit.hnVisible && credit.labels.length === 0,
     'playing keeps the other social links compact and icon-only');
  ok(credit.left <= 20 && credit.aboveRail, 'the playing credit sits above the left rail (' + credit.left + 'px)');
  ok(credit.type.every(x => JSON.stringify(x) === JSON.stringify(credit.type[0])),
     'the product name, credit and rail use one type style (' + credit.type[0].join(', ') + ')');
  ok(credit.railGap >= 12, 'the top-left action buttons have breathing room ('+credit.railGap+'px)');

  // ---- 6. a phone is a first-class launch surface -------------------------
  console.log('phone layout');
  const mobile = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobileErrs = [];
  mobile.on('pageerror', e => mobileErrs.push(String(e).slice(0, 140)));
  await mobile.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(1500);
  const mobileLanding = await mobile.evaluate(() => {
    const title=document.querySelector('.rmood-title'), legal=document.querySelector('.rmood-legal'), hero=document.getElementById('rmoods');
    const tr=title&&title.getBoundingClientRect(), lr=legal&&legal.getBoundingClientRect(), hr=hero&&hero.getBoundingClientRect();
    return { titleVisible:!!tr&&tr.top>=0&&tr.bottom<=innerHeight,
      legalVisible:!!lr&&lr.top>=0&&lr.bottom<=innerHeight,
      heroFits:!!hr&&hr.left>=0&&hr.right<=innerWidth,
      noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth };
  });
  ok(mobileLanding.titleVisible && mobileLanding.legalVisible && mobileLanding.heroFits,
     'the phone landing page keeps its title, story and independent-project clarification visible');
  ok(mobileLanding.noHorizontalOverflow, 'the phone landing page has no horizontal overflow');
  await mobile.getByText('happy', { exact:true }).click();
  await wait(2500);
  await mobile.evaluate(() => { if (window._dockFullscreen) window._dockFullscreen(); });
  await wait(100);
  const mobilePlayer = await mobile.evaluate(() => {
    // THE GENERATED NAME DECIDES HOW WIDE THE TITLE LANE WANTS TO BE, so a
    // short one hides the bug where a long one carried the share button 300px
    // along, under the transport and outside .pb-left's own clip. Forced here
    // rather than in a separate step because the bar's ticker rewrites the
    // title, which made the check pass or fail by luck of the draw.
    const _t = document.getElementById('pbTitle');
    if (_t) _t.textContent = 'Thunderous Crystal Panther Adventure Deluxe Turbo III';
    const ids=['pbShare','pbPrev','pbPlay','pbNext','pbVolume','rfullscreen'];
    const rects=ids.map(id=>{ const el=document.getElementById(id), r=el&&el.getBoundingClientRect();
      return {id, visible:!!r&&r.width>0&&r.height>0, left:r&&r.left, right:r&&r.right, top:r&&r.top, bottom:r&&r.bottom}; });
    const playTop=rects.find(y=>y.id==='pbPlay').top;
    const R=e=>{ if(!e) return null; const r=e.getBoundingClientRect();
      return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height,vis:e.getClientRects().length>0&&r.width>0&&r.height>0}; };
    // the song strip, the Edit key it carries, and the credit
    const bar=R(document.getElementById('playbar')), strip=R(document.querySelector('#playbar .pb-ctrl'));
    const ribbon=R(document.getElementById('noteribbon')), expand=R(document.getElementById('pbExpand'));
    const made=document.getElementById('madeby');
    const gh=made&&made.querySelector('.plmade-github'), nm=made&&made.querySelector('.plmade-name');
    // the ask: the question on its own line, every mood together under it
    const lab=R(document.querySelector('#rmoods .rmood-ask .rmood-lab'));
    const moods=[...document.querySelectorAll('#rmoods .rmood-ask .rmood:not(.rmood-scratch)')].map(e=>Object.assign({t:e.textContent.trim()},R(e)));
    return { rects, noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,
      noOverlap:rects.slice(0,-1).every((x,i)=>!x.visible||!rects[i+1].visible||x.right<=rects[i+1].left),
      sameBaseline:rects.filter(x=>x.visible).every(x=>Math.abs(x.top-playTop)<=8),
      bar, strip, ribbon, expand,
      expandPointer:!!document.getElementById('pbExpand')&&getComputedStyle(document.getElementById('pbExpand')).pointerEvents!=='none',
      creditVisible:!!R(made)&&R(made).vis, githubVisible:!!R(gh)&&R(gh).vis, nameVisible:!!R(nm)&&R(nm).vis,
      creditAboveRail:(()=>{ const m=R(made), rail=R(document.getElementById('plinks')); return !!m&&!!rail&&m.b<=rail.t; })(),
      lab, moods,
      fsRight:rects.find(x=>x.id==='rfullscreen').right, barRight:bar&&bar.r };
  });
  ok(mobilePlayer.rects.every(x=>x.visible&&x.left>=0&&x.right<=390),
     'share, transport, volume and fullscreen all remain reachable on a 390px phone');
  ok(mobilePlayer.sameBaseline && mobilePlayer.noHorizontalOverflow && mobilePlayer.noOverlap,
     'the phone player keeps its controls on one baseline without horizontal overflow (' +
     mobilePlayer.rects.map(x => x.id.replace(/^pb/, '') + ' ' + Math.round(x.left) + '-' + Math.round(x.right)).join(', ') + ')');
  // The NEXT button used to sit underneath the volume dial, because the
  // transport wanted 112px in a 105px column. It has to be reachable, not
  // merely present in the DOM.
  {
    const next = mobilePlayer.rects.find(x => x.id === 'pbNext');
    const vol = mobilePlayer.rects.find(x => x.id === 'pbVolume');
    ok(next.visible && next.right <= vol.left,
       'the phone transport shows NEXT clear of the volume control (' + Math.round(vol.left - next.right) + 'px)');
  }
  ok(mobilePlayer.barRight - mobilePlayer.fsRight <= 12,
     'full screen ends at the phone bar\'s right edge, with no hole after it (' +
     Math.round(mobilePlayer.barRight - mobilePlayer.fsRight) + 'px)');
  // The strip was a 7px sliver absolutely positioned along the bar's bottom
  // edge, 24px wide with a zero-width canvas: the notes were not drawn at all.
  ok(!!mobilePlayer.strip && mobilePlayer.strip.vis && mobilePlayer.strip.w >= 320 &&
     mobilePlayer.strip.b <= mobilePlayer.rects.find(x => x.id === 'pbPlay').top,
     'the phone song strip takes its own row above the transport (' +
     Math.round(mobilePlayer.strip ? mobilePlayer.strip.w : -1) + 'px wide)');
  ok(!!mobilePlayer.ribbon && mobilePlayer.ribbon.vis && mobilePlayer.ribbon.w >= 200 && mobilePlayer.ribbon.h >= 16,
     'the notes are actually drawn in it (' + Math.round(mobilePlayer.ribbon ? mobilePlayer.ribbon.w : -1) + 'x' +
     Math.round(mobilePlayer.ribbon ? mobilePlayer.ribbon.h : -1) + ')');
  ok(!!mobilePlayer.expand && mobilePlayer.expand.vis && mobilePlayer.expandPointer && mobilePlayer.expand.h >= 22,
     'the strip carries a standing Edit key -- a phone has no hover to reveal one');
  ok(mobilePlayer.creditVisible && mobilePlayer.nameVisible && mobilePlayer.githubVisible && mobilePlayer.creditAboveRail,
     'the phone playing screen still says what this is and where the source is');
  // "Write me a song that is…" is one running sentence with the moods on a wide
  // window. In a 390px column the label alone is ~214px, so it takes its own
  // line and the moods sit together underneath rather than one beside it.
  ok(!!mobilePlayer.lab && mobilePlayer.moods.length >= 3 &&
     mobilePlayer.moods.every(m => m.t >= mobilePlayer.lab.b - 1),
     'the phone ask puts the question on its own line');
  ok(mobilePlayer.moods.length >= 3 &&
     mobilePlayer.moods.every(m => Math.abs(m.t - mobilePlayer.moods[0].t) <= 2),
     'and every mood on one line under it (' + mobilePlayer.moods.map(m => m.t).join('/') + ')');
  ok(mobileErrs.length === 0, 'no phone page errors' + (mobileErrs.length ? ': ' + mobileErrs[0] : ''));
  await mobile.close();

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.s.close();
  console.log(fail ? '\nFAILED (' + fail + ')' : '\nall good');
  process.exit(fail ? 1 : 0);
})();
