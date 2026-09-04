// THE THREE FACES, AND WHAT THEY COST WHEN THEY ARE NOT ON SCREEN.
//
// Three claims, each of which has been wrong:
//
//  1. All three faces actually RENDER. A panel whose GL setup throws falls back
//     to the CRT silently -- the page still looks fine, it just is not the
//     screen it says it is. Reporting the mode is not enough; count colours.
//  2. Switching away FREES the pipeline. setMode(false) used to set display:none
//     and free nothing, so once the default "Random" had shown all three the
//     page held every render target at once -- ~300MB of backing store for two
//     pipelines nobody was looking at.
//  3. A woken panel rebuilds. Sleeping deletes the targets; if wake() does not
//     force resize() past its unchanged-viewport early return, the face comes
//     back at 1x1 and draws nothing.
//
// Runs HEADED with the real GPU on purpose: headless Chromium has no GPU and
// puts these WebGL panels through SwiftShader, where they measure 1-3fps with
// 879ms long tasks. That is an artifact and it has fooled this repo once.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

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
        if (err) { e.writeHead(404); e.end(); return; }
        const ct = f.endsWith('.js') ? 'text/javascript'
                 : f.endsWith('.woff2') ? 'font/woff2'
                 : f.endsWith('.webp') ? 'image/webp' : 'text/html';
        e.writeHead(200, { 'content-type': ct }); e.end(b);
      });
    });
    s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

// distinct colours in a screenshot: the only honest test that a face is drawing
async function colours(p, tag) {
  const f = path.join(SHOT, 'screens-' + tag + '.png');
  // A 3200x2000 headed Metal capture occasionally finishes just beyond
  // Playwright's 30s action default even though the page and fonts are ready.
  // Keep the real-GPU assertion; give the actual pixel readback enough time.
  //
  // 60s was not enough either: a full suite run on a busy machine (load average
  // 19, which this one reaches just by running the rest of the suite) timed the
  // capture out and took the whole run down with it -- reported as an uncaught
  // TimeoutError with no failing assertion, which is the least useful way for a
  // gate to fail. What is being asserted is that the face DRAWS, not that it
  // draws inside a minute, so the limit is generous on purpose.
  await p.screenshot({ path: f, timeout: 180000 });
  const png = PNG.sync.read(fs.readFileSync(f));
  const s = new Set();
  for (let i = 0; i < png.data.length; i += 4 * 97) s.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
  return s.size;
}

const SNAP = `(() => {
  const px = c => (c && c.width && c.height) ? c.width * c.height * 4 : 0;
  let canv = 0; document.querySelectorAll('canvas').forEach(c => canv += px(c));
  let vig = 0, vigN = -1;
  try { _vigCache.forEach(c => vig += px(c)); vigN = _vigCache.size; } catch (e) {}
  const panel = n => { try { const p = n === 'dmg' ? _dmg : _nes; if (!p) return null;
    return { asleep: !!p._asleep, w: p.canvas ? p.canvas.width : 0, rts: (p.rts && p.rts.length) || 0 };
  } catch (e) { return null; } };
  return { canvasMB: +(canv / 1048576).toFixed(1), vigMB: +(vig / 1048576).toFixed(1), vigN,
           dmg: panel('dmg'), nes: panel('nes'),
           mode: (window.__rrrScreenMode && __rrrScreenMode()) || '?' };
})`;

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  try { fs.mkdirSync(SHOT, { recursive: true }); } catch (e) {}

  const renderer = await p.evaluate(() => {
    const c = document.createElement('canvas'); const g = c.getContext('webgl2');
    if (!g) return 'no webgl2';
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?';
  }).catch(() => '?');
  console.log('  renderer: ' + renderer);
  ok(!/SwiftShader/i.test(renderer), 'measuring on a real GPU, not SwiftShader');

  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3000);
  await p.evaluate(() => { const x = [...document.querySelectorAll('.rmood')].find(y => y.textContent === 'chill'); if (x) x.click(); });
  await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 30000 });
  await wait(5000);

  // 1 + 3: every face draws, including on the way back after being slept
  for (const face of ['dmg', 'nes', 'crt', 'dmg']) {
    await p.evaluate(m => window.__rrrScreenMode(m), face);
    await wait(3000);
    const s = await p.evaluate(SNAP + '()');
    const n = await colours(p, face);
    ok(s.mode === face, face + ': stays on ' + face + ' (reports "' + s.mode + '")');
    ok(n > 300, face + ': actually draws (' + n + ' distinct colours)');
  }

  // 2: only the face on screen holds a pipeline
  const seen = [];
  for (const face of ['crt', 'dmg', 'nes', 'crt']) {
    await p.evaluate(m => window.__rrrScreenMode(m), face);
    await wait(2500);
    seen.push(Object.assign({ face }, await p.evaluate(SNAP + '()')));
  }
  seen.forEach(s => console.log('       after ' + s.face.padEnd(4) +
    ' canvases ' + String(s.canvasMB).padStart(5) + 'MB  vignettes ' + String(s.vigMB).padStart(5) + 'MB(' + s.vigN + ')' +
    '  dmg=' + (s.dmg ? (s.dmg.asleep ? 'asleep' : 'awake ' + s.dmg.rts + 'rts') : '-') +
    '  nes=' + (s.nes ? (s.nes.asleep ? 'asleep' : 'awake ' + s.nes.rts + 'rts') : '-')));

  const onNes = seen[2], backOnCrt = seen[3];
  ok(!!onNes.dmg && onNes.dmg.asleep && onNes.dmg.rts === 0,
     'showing NES puts the DMG pipeline to sleep and frees its targets');
  ok(!!backOnCrt.dmg && backOnCrt.dmg.asleep && !!backOnCrt.nes && backOnCrt.nes.asleep,
     'showing the CRT sleeps both panels');
  ok(onNes.vigMB === 0, 'the CRT vignettes are dropped while a panel owns the screen (' + onNes.vigMB + 'MB)');
  ok(backOnCrt.vigMB > 0 && backOnCrt.vigMB < 60,
     'and come back bounded on return (' + backOnCrt.vigMB + 'MB, cap 48)');
  const peak = Math.max(...seen.map(s => s.canvasMB));
  ok(peak < 60, 'canvas backing never accumulates across faces (peak ' + peak + 'MB)');

  // ---- 4. RANDOM RE-ROLLS ON EVERY TRACK, INCLUDING A MOOD ------------------
  //
  // The gap this closes: every check above drives __rrrScreenMode() with a
  // PINNED face, so nothing watched the coin toss, and nothing advanced a
  // track. A mood pick composes a DOCUMENT, and a document has no token --
  // publishTrackReady used to carry only the slug, so the runtime's "did the
  // track change?" test was false for every mood a visitor tapped and the face
  // never re-rolled. Someone driving the station by tapping moods sat on
  // whichever face the boot toss picked, for the whole session. Reported from
  // a phone as "it plays in Game Boy for every song".
  //
  // Deterministic on purpose: the toss is stubbed to name the face we want, so
  // this asserts the re-roll actually HAPPENS rather than hoping three random
  // draws differ.
  {
    const p2 = await b.newPage({ viewport: { width: 1200, height: 820 } });
    const e2 = []; p2.on('pageerror', e => e2.push(String(e).slice(0, 160)));
    await p2.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
    await wait(2200);
    const FACES = ['crt', 'dmg', 'nes'];
    // force the next toss to land on `face`, tap a mood, report what happened
    const tapMood = async (mood, face) => {
      await p2.evaluate(i => { Math.random = () => (i + 0.5) / 3; }, FACES.indexOf(face));
      await p2.evaluate(m => {
        const b3 = [...document.querySelectorAll('.rmood')].find(x => x.textContent.trim() === m);
        if (b3) b3.click();
      }, mood);
      await wait(5000);
      return p2.evaluate(() => { const d = window.__rrrPanelDiag(); return { mode: d.mode, mix: d.mix }; });
    };
    const boot = await p2.evaluate(() => window.__rrrPanelDiag());
    ok(boot.mix === true, 'a fresh visit starts on Random rather than a pinned face');
    // three moods, each forced to a different face than the one before it
    const a = await tapMood('happy', 'dmg');
    const c = await tapMood('chill', 'nes');
    const d2 = await tapMood('epic', 'crt');
    ok(a.mode === 'dmg' && c.mode === 'nes' && d2.mode === 'crt',
       'every mood pick re-rolls the screen face (' + [a.mode, c.mode, d2.mode].join(' -> ') + ')');
    ok(a.mix && c.mix && d2.mix, 'and Random stays armed across them');
    ok(e2.length === 0, 'no page errors while re-rolling' + (e2.length ? ': ' + e2[0] : ''));
    await p2.close();
  }

  await b.close();

  // ---- 5. NOTHING FULL-SCREEN IS OPAQUE WHITE, ON EITHER ENGINE ------------
  //
  // Reported from a real iPhone: "sometimes the screen is white, it appears to
  // be when it's in modern mode". Modern is the only face that shows
  // `.crt.gain` -- an OPAQUE, almost entirely WHITE, full-viewport, z-index-5
  // canvas whose sole reason for being invisible is mix-blend-mode:multiply.
  // Every other overlay on the page is black-based, so a dropped blend darkens
  // them; a dropped blend on this one paints the window white. WebKit gets the
  // legacy divs instead, and this asserts that it does.
  //
  // ⚠️ Playwright's WebKit is NOT Safari: it rasterises the gain map fine and
  // shows none of the symptom. This checks the DEFENCE (which layer is shown),
  // not the symptom, because the symptom cannot be reproduced from here.
  {
    const { webkit } = require('playwright');
    for (const [eng, launcher] of [['webkit', webkit], ['chromium', chromium]]) {
      const eb = await launcher.launch();
      const ep = await eb.newPage({ viewport: { width: 900, height: 700 } });
      await ep.goto(`http://127.0.0.1:${h.port}/?screen=crt`, { waitUntil: 'domcontentloaded' });
      await wait(3500);
      const d = await ep.evaluate(() => {
        const diag = window.__rrrCrtDiag ? window.__rrrCrtDiag() : null;
        // any full-viewport element that is opaque and light, blend or no blend
        const risky = [...document.querySelectorAll('body > *')].filter(e => {
          const r = e.getBoundingClientRect(), c = getComputedStyle(e);
          if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.5) return false;
          if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.9) return false;
          return c.mixBlendMode === 'multiply' && /canvas/i.test(e.tagName);
        }).map(e => e.className);
        return { diag, risky };
      });
      ok(!!d.diag, eng + ': the CRT reports its own state (__rrrCrtDiag)');
      if (eng === 'webkit') {
        ok(d.diag && d.diag.forceLegacy && !d.diag.gainShown && d.risky.length === 0,
           'webkit is given the black-based legacy overlays, not the white gain canvas');
      } else {
        ok(d.diag && !d.diag.forceLegacy && d.diag.gainShown && !d.diag.blank,
           'chromium keeps the baked gain map (the reason it exists is a GPU-less box)');
      }
      await eb.close();
    }
  }

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  h.s.close();
  console.log(fail ? '\nFAILED (' + fail + ')' : '\nall good');
  process.exit(fail ? 1 : 0);
})();
