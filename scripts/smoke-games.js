#!/usr/bin/env node
// Game smoke through the REAL loader path: serves dist/, boots the app in
// headless Chromium, waits for Packs.init, loads every discovered game pack via
// the runtime loader (dist/packs/games/<id>/pack.js eval), then runs the
// per-game make/frame loop in-page against a synthetic music bus.
// Also:
//   - corrupted-pack isolation: a /packs tree with one broken pack.js and one
//     broken pack.json must boot, flag both as errors, and load everything else
//   - silent watch-mode soak: /watch animates (window.__rrrFrame.seq advances)
//     with ZERO AudioContext instantiations
//
// Usage: node scripts/smoke-games.js [--frames 180] [--watch-soak 15000]
// (pass --watch-soak 60000 for the full 60s soak; default is a 15s equivalent)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { scanGamePacks } = require('./game-roster.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function arg(name, fallback) {
  const ix = process.argv.indexOf(`--${name}`);
  if (ix >= 0 && process.argv[ix + 1]) return process.argv[ix + 1];
  const hit = process.argv.find(v => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const FRAMES = Math.max(30, Number(arg('frames', 180)) || 180);
const WATCH_SOAK_MS = Math.max(3000, Number(arg('watch-soak', 15000)) || 15000);

function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.wasm')) return 'application/wasm';
  if (file.endsWith('.zst')) return 'application/octet-stream';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

// Static dist server mirroring serve.py semantics: /packs/* and /lib/* 404 when
// missing (no SPA fallback — the loader depends on real 404s), everything else
// falls back to index.html. packsRoot lets the corruption test swap /packs.
function startServer(packsRoot) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file;
      const noFallback = rel === 'packs' || rel.startsWith('packs/') || rel === 'lib' || rel.startsWith('lib/');
      if (rel === 'packs' || rel.startsWith('packs/')) {
        file = path.normalize(path.join(packsRoot, rel.replace(/^packs\/?/, '')));
        if (!file.startsWith(packsRoot)) file = null;
      } else {
        file = path.normalize(path.join(DIST, rel));
        if (!file.startsWith(DIST)) file = null;
      }
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (noFallback) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
        file = path.join(DIST, 'index.html');
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(500); res.end(String(err.message || err)); return; }
        res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

// ---- synthetic music bus (runs IN PAGE; kept in sync with the old vm harness) ----
const PAGE_HELPERS = `
function __smokeMusicFrame(i){
  const step = i;
  const bar = Math.floor(step / 16);
  const phase = (step % 4) / 4;
  const pulse = Math.max(0, 1 - phase * 1.25);
  const note = { id:'lead:'+step, hi:((step*7)%24)/23, band:(step*7)%24, mag:0.35+0.45*pulse, hz:220+((step*37)%780), role:'lead', channel:'mock' };
  const counter = { id:'counter:'+step, hi:((step*5+9)%24)/23, band:(step*5+9)%24, mag:0.25+0.25*(step%3===0?1:0), role:'counter', channel:'mock' };
  const bassOn = step % 8 === 0 ? 0.9 : 0.22;
  const percOn = step % 4 === 0 ? 0.8 : (step % 2 === 0 ? 0.35 : 0.12);
  const bands = { bass:bassOn, mid:0.32 + 0.2*pulse, treble:0.18 + 0.35*(step%2) };
  const waveform = Array.from({length:96}, (_, x) => Math.sin((x + step*2)*0.18) * (0.08 + bands.mid*0.18));
  const spectrum = Array.from({length:48}, (_, x) => Math.max(0, Math.sin(x*0.31 + step*0.12)) * (0.12 + bands.treble*0.35));
  return {
    beatPulse:pulse, pulse:pulse, kick:bassOn,
    snare:step % 8 === 4 ? 0.85 : 0, hat:step % 2 ? 0.55 : 0.15,
    drop:step === 48, bar:bar, barPhase:(step % 16)/16, phrase:Math.floor(step/64),
    energy:Math.max(bands.bass, bands.mid, bands.treble),
    energyLevel:Math.min(10, 3 + Math.round((bands.bass + bands.mid + bands.treble)*2)),
    bpm:132, hue:(bar % 12)/12, bands, waveform, spectrum, fullSpectrum:spectrum,
    noteOns:[note, counter], primaryNotes:[note],
    roles:{
      lead:{energy:note.mag,onset:pulse,hi:note.hi,notes:[note]},
      primary:{energy:note.mag,onset:pulse,hi:note.hi,notes:[note]},
      melody:{energy:note.mag,onset:pulse,hi:note.hi,notes:[note]},
      counter:{energy:counter.mag,onset:counter.mag,hi:counter.hi,notes:[counter]},
      bass:{energy:bands.bass,onset:bassOn,hi:0.12,notes:[]},
      perc:{energy:percOn,onset:percOn,hi:0.78,notes:[]},
      noise:{energy:bands.treble,onset:step % 2 ? 0.45 : 0.05,hi:0.9,notes:[]},
      pad:{energy:0.18,onset:0,hi:0.45,notes:[]}
    }
  };
}
function __smokeSND(i){
  const cl = __smokeMusicFrame(i);
  const gr = { gstep:i, phase:(i%4)/4, beat:Math.floor(i/4), bar:Math.floor(i/16), bpm:132, spb:60/132, step16:60/132/4 };
  const noop = () => {};
  return { clock:()=>cl, grid:()=>gr, vis:()=>cl, energy:()=>cl.energy,
    event:noop, note:noop, fx:noop, tone:noop, drum:noop, bass:noop, act:noop, lead:noop };
}
`;

async function loadAllPacks(page, ids) {
  return page.evaluate(async (ids) => {
    const out = {};
    for (const id of ids) {
      try {
        if (window.Packs && typeof Packs.ensureGame === 'function') {
          await Packs.ensureGame(id);
        } else if (window.Packs && typeof Packs.get === 'function') {
          const h = Packs.get(id);
          if (h && typeof h.loadGame === 'function') await h.loadGame();
          else throw new Error('no PackHandle/loadGame for ' + id);
        } else {
          throw new Error('window.Packs is missing');
        }
        const g = window.CT_GAMES && window.CT_GAMES[id];
        out[id] = { registered: !!g, make: !!(g && typeof g.make === 'function'), frame: !!(g && typeof g.frame === 'function') };
      } catch (e) {
        out[id] = { registered: false, err: String(e && e.message || e) };
      }
    }
    return out;
  }, ids);
}

async function bootPage(browser, url, initScript) {
  const page = await browser.newPage();
  if (initScript) await page.addInitScript(initScript);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.Packs && typeof Packs.init === 'function' && window.CT_GAMES && window.MV && window.VisualizerGame,
    null, { timeout: 20000 }
  );
  await page.evaluate(() => Packs.init()); // idempotent; never rejects (contract)
  return { page, pageErrors };
}

function runGameLoopInPage(page, key, frames) {
  return page.evaluate(({ key, frames, helpers }) => {
    // eslint-disable-next-line no-eval
    (0, eval)(helpers);
    const failures = [];
    const game = window.CT_GAMES[key];
    if (!game) return [`${key}: not in CT_GAMES`];
    const layers = game.layers || {};
    const extracted = Object.keys(layers).length > 0;
    if ((!Array.isArray(game.bindings) || game.bindings.length < 8) && extracted) failures.push(`${key}: missing binding table`);
    if (extracted) {
      for (const layerName of ['definition', 'behavior', 'reactions', 'renderer']) {
        if (!layers[layerName]) failures.push(`${key}: missing ${layerName} layer`);
      }
      if (!Array.isArray(layers.definition && layers.definition.entities) || !layers.definition.entities.length) failures.push(`${key}: definition layer has no entities`);
      if (!Array.isArray(layers.definition && layers.definition.events) || !layers.definition.events.length) failures.push(`${key}: definition layer has no events`);
      if (!Array.isArray(layers.behavior && layers.behavior.goals) || !layers.behavior.goals.length) failures.push(`${key}: behavior layer has no goals`);
      if (!Array.isArray(layers.reactions && layers.reactions.bindings) || !layers.reactions.bindings.length) failures.push(`${key}: reactions layer has no bindings`);
    }
    try {
      const A = { x: 16, y: 16, w: 960, h: 640 };
      const U = 8;
      const st = game.make(A, U, 0);
      const seenRoles = new Set();
      for (let i = 0; i < frames; i++) {
        const snd = __smokeSND(i);
        window.MV.frame(snd, st, key);
        const input = { x: 0.5, y: 0.5, ax: 512, ay: 384, lx: 512, ly: 384, down: false, click: false, active: false, keys: {} };
        if (window.VisualizerGame && VisualizerGame.run) VisualizerGame.run(game, { key, dt: 1 / 60, U, A, IN: input, SND: snd, state: st, sourceEvents: [] });
        else { failures.push(`${key}: missing VisualizerGame.run`); break; }
        if (Array.isArray(st.entities)) for (const e of st.entities) if (e && e.role) seenRoles.add(e.role);
        const perf = (layers.renderer && layers.renderer.performance) || {};
        const maxEntities = perf.maxEntities || 1800;
        const maxParticles = perf.maxParticles || 1800;
        if (Array.isArray(st.entities) && st.entities.length > maxEntities) { failures.push(`${key}: entity cap exceeded (${st.entities.length} > ${maxEntities})`); break; }
        if (Array.isArray(st.particles) && st.particles.length > maxParticles) { failures.push(`${key}: particle cap exceeded (${st.particles.length} > ${maxParticles})`); break; }
      }
      if (extracted) {
        const declaredRoles = new Set();
        const roleMaps = [layers.reactions && layers.reactions.entityRoles, layers.reactions && layers.reactions.systems, layers.reactions && layers.reactions.targets];
        for (const map of roleMaps) {
          if (!map) continue;
          for (const k of Object.keys(map)) {
            declaredRoles.add(k.replace(/Target$/, ''));
            declaredRoles.add(String(map[k] || '').replace(/Target$/, ''));
          }
        }
        for (const role of ['lead', 'bass', 'perc', 'noise', 'drop']) {
          if (!seenRoles.has(role) && !declaredRoles.has(role)) failures.push(`${key}: no ${role} entities observed or declared during smoke run`);
        }
      }
    } catch (err) {
      failures.push(`${key}: ${err && err.stack || err}`);
    }
    return failures;
  }, { key, frames, helpers: PAGE_HELPERS });
}

// ---- corrupted-pack variant of dist/packs (games + composers only; music
//      skipped — can be GBs of user content and isolation is proven without it) ----
function buildCorruptedPacksDir(gameIds) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrr-smoke-packs-'));
  for (const name of ['index.json']) {
    const src = path.join(DIST, 'packs', name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, name));
  }
  for (const sub of ['games', 'composers']) {
    const src = path.join(DIST, 'packs', sub);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, sub), { recursive: true });
  }
  // Never corrupt balloon (it is additionally inlined as the never-brick fallback,
  // so a broken served copy would be shadowed instead of erroring).
  const candidates = gameIds.filter(id => id !== 'balloon');
  if (candidates.length < 3) throw new Error('need >=3 non-fallback game packs for the corruption test');
  const brokenJs = candidates[0];
  const brokenJson = candidates[1];
  const healthy = candidates[2];
  fs.appendFileSync(path.join(tmp, 'games', brokenJs, 'pack.js'), '\n]]]this is deliberately broken((\n');
  fs.writeFileSync(path.join(tmp, 'games', brokenJson, 'pack.json'), '{ "schema": "rrr-pack@3", broken');
  return { tmp, brokenJs, brokenJson, healthy };
}

(async () => {
  const packs = scanGamePacks();
  if (!packs.length) throw new Error('no game packs found under packs/games/');
  const ids = packs.map(p => p.id);

  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing. Run `node build.js` first.');
  if (!fs.existsSync(path.join(DIST, 'packs', 'index.json'))) throw new Error('dist/packs/index.json missing. Run `node build.js` first.');
  for (const id of ids) {
    for (const f of ['pack.js', 'pack.json']) {
      const p = path.join(DIST, 'packs', 'games', id, f);
      if (!fs.existsSync(p)) throw new Error(`dist pack artifact missing: ${path.relative(ROOT, p)}. Run \`node build.js\` first.`);
    }
  }

  const failures = [];
  const { server, url } = await startServer(path.join(DIST, 'packs'));
  const browser = await chromium.launch({ headless: true });
  let corrupt = null;
  try {
    // ---- 1) real loader path: every discovered pack reaches CT_GAMES ----
    const { page, pageErrors } = await bootPage(browser, url);
    const loadReport = await loadAllPacks(page, ids);
    for (const id of ids) {
      const r = loadReport[id] || {};
      if (r.err) failures.push(`${id}: loader error: ${r.err}`);
      else if (!r.registered) failures.push(`${id}: pack loaded but not registered in CT_GAMES`);
      else if (!r.make || !r.frame) failures.push(`${id}: CT_GAMES entry missing make/frame (make=${r.make} frame=${r.frame})`);
    }

    // ---- 2) per-game make/frame loop (in-page, real CT_GAMES) ----
    for (const id of ids) {
      if (loadReport[id] && loadReport[id].make && loadReport[id].frame) {
        const gameFailures = await runGameLoopInPage(page, id, FRAMES);
        failures.push(...gameFailures);
      }
    }
    if (pageErrors.length) failures.push(`uncaught page errors during main smoke: ${pageErrors.slice(0, 5).join(' | ')}`);
    await page.close();

    // ---- 3) corrupted-pack isolation ----
    corrupt = buildCorruptedPacksDir(ids);
    const { server: badServer, url: badUrl } = await startServer(corrupt.tmp);
    try {
      const { page: badPage } = await bootPage(browser, badUrl);
      const healthyIds = [corrupt.healthy, 'balloon'].filter(id => ids.includes(id));
      const probe = await loadAllPacks(badPage, [corrupt.brokenJs, corrupt.brokenJson, ...healthyIds]);
      const states = await badPage.evaluate(() => {
        const out = {};
        try { for (const p of Packs.list()) out[p.id] = { state: p.state, error: p.error || null }; } catch (e) { out.__listErr = String(e); }
        return out;
      });
      const js = states[corrupt.brokenJs];
      if (!js || (js.state !== 'error' && !js.error)) failures.push(`corruption: broken pack.js (${corrupt.brokenJs}) not flagged as error (got ${JSON.stringify(js)})`);
      const jn = states[corrupt.brokenJson];
      if (jn && jn.state !== 'error' && !jn.error) failures.push(`corruption: broken pack.json (${corrupt.brokenJson}) listed without error state (got ${JSON.stringify(jn)})`);
      for (const id of healthyIds) {
        const r = probe[id] || {};
        if (!r.registered || !r.make) failures.push(`corruption: healthy pack ${id} failed to load next to broken ones: ${r.err || JSON.stringify(r)}`);
      }
      await badPage.close();
    } finally {
      badServer.close();
    }

    // ---- 4) watch-mode soak: frames advance, zero AudioContexts ----
    const acCounter = `(() => {
      window.__acCount = 0;
      for (const k of ['AudioContext', 'webkitAudioContext']) {
        const Orig = window[k];
        if (!Orig) continue;
        const Wrapped = function (...a) { window.__acCount++; return new Orig(...a); };
        Wrapped.prototype = Orig.prototype;
        Object.defineProperty(window, k, { value: Wrapped, configurable: true, writable: true });
      }
    })();`;
    const watchPage = await browser.newPage();
    await watchPage.addInitScript(acCounter);
    await watchPage.goto(url + 'watch', { waitUntil: 'domcontentloaded' });
    await watchPage.waitForFunction(() => window.__rrrFrame && window.__rrrFrame.seq > 0, null, { timeout: 20000 });
    const seq0 = await watchPage.evaluate(() => window.__rrrFrame.seq);
    await watchPage.waitForTimeout(WATCH_SOAK_MS);
    const after = await watchPage.evaluate(() => ({ seq: window.__rrrFrame.seq, active: window.__rrrFrame.active, ac: window.__acCount }));
    const advanced = after.seq - seq0;
    const minFrames = Math.floor((WATCH_SOAK_MS / 1000) * 15); // >=15fps floor under headless load
    if (advanced < minFrames) failures.push(`watch soak: only ${advanced} frames in ${WATCH_SOAK_MS}ms (expected >= ${minFrames})`);
    if (after.ac !== 0) failures.push(`watch soak: ${after.ac} AudioContext(s) created — watch mode must never touch WebAudio`);
    await watchPage.close();
  } finally {
    await browser.close();
    server.close();
    if (corrupt) { try { fs.rmSync(corrupt.tmp, { recursive: true, force: true }); } catch (e) { /* temp cleanup best-effort */ } }
  }

  if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
  console.log(`smoke-games: ${ids.length} packs loaded through the real runtime loader, make/frame+caps clean, corruption isolated, watch soak ${WATCH_SOAK_MS}ms silent`);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
