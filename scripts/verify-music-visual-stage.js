#!/usr/bin/env node
'use strict';
// Read-only shared-dist acceptance: real Chromium layout, Canvas/WebGL renderers
// and acknowledged chip playback. No builds/providers, no physical Safari claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const dist = path.resolve(__dirname, '../dist');
const roster = ['hover', 'blast', 'bricks', 'trooper', 'climber', 'racer', 'crossing',
  'squadron', 'vortex', 'platformer', 'maze', 'pyramid', 'blocks', 'dungeon'].sort();
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.slang': 'text/plain', '.slangp': 'text/plain' };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, authenticated: false, providers: [{ id: 'openai', label: 'OpenAI' }] })); return;
    }
    let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep) && file !== dist) { response.writeHead(403); response.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/html' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function geometry(page, stacked = false) {
  const boxes = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const host = document.querySelector('.mw-stage-viewport');
    return { main: rect('.mw-main'), visuals: rect('.mw-visuals'), host: rect('.mw-stage-viewport'),
      code: rect('.mw-code'), notes: rect('.mw-notes'), width: innerWidth,
      mountedStage: host.contains(document.getElementById('stage')),
      canvases: [...host.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })) };
  });
  assert(boxes.host.width > 120 && boxes.host.height > 60, 'persistent preview has usable dimensions');
  assert(Math.abs(boxes.host.width / boxes.host.height - 16 / 9) < 0.025, 'stage host is landscape 16:9');
  assert(boxes.code.width > 200 && boxes.code.height > 80, 'music editor remains readable');
  assert(boxes.notes.width > 200 && boxes.notes.height > 60, 'diagnostic notes remain readable');
  assert(boxes.mountedStage, 'real stage is hosted, not a duplicate canvas preview');
  assert(boxes.canvases.length >= 1, 'stage contains real output canvases');
  if (stacked) assert(boxes.visuals.y >= boxes.main.bottom - 2, 'narrow stage stacks below music');
  else assert(boxes.visuals.x >= boxes.main.right - 2, 'desktop stage sits beside music');
  assert(boxes.host.right <= boxes.width + 2 && boxes.host.x >= -2, 'preview remains within window width');
  return boxes;
}
async function remember(page, mode) {
  await page.evaluate(mode => {
    const host = document.querySelector('.mw-stage-viewport');
    const panel = mode === 'dmg' ? _dmg : mode === 'nes' ? _nes : null;
    const targets = p => !p ? [] : [...(p.rts || []), ...(p.fb || []), p.native, p.rtIdx, p.rtNtsc].filter(Boolean);
    window.stageCheck = { host, mode, world: selState, game: selGame, epoch: _musicPresentationEpoch,
      panel, panelFrame: panel?.frameCount,
      targets: targets(panel).map(target => ({ target, tex: target.tex, fbo: target.fbo, width: target.w, height: target.h })), dimensions: [W, H, DPR],
      canvases: [...host.querySelectorAll('canvas')].map(node => ({ node, width: node.width, height: node.height })),
      source: CT_MUSIC_WORKSPACE.snapshot().draft, revision: CT_MUSIC_WORKSPACE.snapshot().validated.id,
      playing: CT_MUSIC_WORKSPACE.snapshot().playing,
      activation: Audio.musicVisualState()?.activation, frame: Audio.musicVisualState()?.frame,
      events: stageEvents.length, contexts: stageContexts, calls: stageCommands.length };
  }, mode);
}
async function unchanged(page, label) {
  const state = await page.evaluate(() => {
    const b = stageCheck, current = CT_MUSIC_WORKSPACE.snapshot(), audio = Audio.musicVisualState();
    const panel = b.mode === 'dmg' ? _dmg : b.mode === 'nes' ? _nes : null;
    const targets = !panel ? [] : [...(panel.rts || []), ...(panel.fb || []), panel.native, panel.rtIdx, panel.rtNtsc].filter(Boolean);
    return { world: selState === b.world, game: selGame === b.game, epoch: _musicPresentationEpoch === b.epoch,
      // Feedback ping-pong swaps read/write slots each frame; retain the same
      // allocated targets, not their transient array ordering.
      panel: panel === b.panel, phase: !panel || panel.frameCount >= b.panelFrame,
      buffers: targets.length === b.targets.length && targets.every(t => b.targets.some(old => old.target === t &&
        old.tex === t.tex && old.fbo === t.fbo && old.width === t.w && old.height === t.h)),
      dimensions: [W, H, DPR], previousDimensions: b.dimensions,
      canvases: b.canvases.every(c => c.node.isConnected && c.node.width === c.width && c.node.height === c.height),
      canvasCount: document.querySelector('.mw-stage-viewport').querySelectorAll('canvas').length,
      previousCanvasCount: b.canvases.length, oneStage: document.querySelectorAll('#stage').length === 1,
      source: current.draft === b.source && current.validated.id === b.revision && current.playing === b.playing,
      audio: audio?.activation === b.activation && audio?.frame >= b.frame && audio?.status === 'playing',
      events: stageEvents.slice(b.events), contexts: stageContexts === b.contexts,
      calls: stageCommands.slice(b.calls) };
  });
  for (const key of ['world', 'game', 'epoch', 'panel', 'phase', 'buffers', 'canvases', 'oneStage', 'source', 'audio', 'contexts'])
    assert.equal(state[key], true, `${label}: ${key} preserved`);
  assert.deepEqual(state.dimensions, state.previousDimensions, label + ': simulation/backbuffer size is stable');
  assert.equal(state.canvasCount, state.previousCanvasCount, label + ': no duplicate renderer canvas');
  assert.deepEqual(state.calls, [], label + ': presentation issues no audio commands');
  assert(state.events.every(e => e.status === 'position'), label + ': no playback reactivation/queue/seek/loop');
}
async function runMode(browser, origin, mode) {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1.5 });
  const errors = [], providerRequests = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/music/chat' && route.request().method() === 'POST') providerRequests.push(url.href);
    return url.origin === origin ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    window.stageContexts = 0;
    for (const key of ['AudioContext', 'webkitAudioContext']) {
      if (!window[key]) continue;
      window[key] = new Proxy(window[key], { construct(Target, args) { stageContexts++; return Reflect.construct(Target, args); } });
    }
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(origin + '/?screen=' + mode, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CT_MUSIC_WORKSPACE?.isOpen() && CT_MUSIC_WORKSPACE.snapshot()?.validated);
    assert.equal(await page.evaluate(() => typeof CT_CREATE_PRESENTATION.mount), 'function', 'requires Phase B shared artifact');
    await page.waitForFunction(() => CT_CREATE_PRESENTATION.snapshot().mounted);
    const adapter = await page.evaluate(() => CT_CREATE_PRESENTATION.snapshot());
    assert.deepEqual(adapter.scenes.filter(s=>!s.id.startsWith('visual:')).map(s => s.id).sort(), roster, 'fixed fourteen-game roster alongside procedural programs');
    assert(adapter.scenes.every(s => typeof s.label === 'string' && s.label.length));
    assert(adapter.enabled && adapter.width > 0 && adapter.height > 0);
    assert.equal(await page.evaluate(() => !!CT_MUSIC_WORKSPACE.snapshot().playing || !!CT_MUSIC_WORKSPACE.snapshot().pending), false);
    assert.equal(await page.evaluate(() => CT_CREATE.isOpen()), false, 'no legacy editor underneath');
    assert(await page.locator('.mw-visuals').getByText('Visuals', { exact: true }).first().isVisible());
    const initial = await geometry(page);
    const ratio = initial.main.width / (initial.main.width + initial.visuals.width);
    assert(Math.abs(ratio - .62) < .035, 'initial desktop creative split is approximately 62/38');
    // Pin one existing scene; changing scenes is explicitly allowed to create a
    // world. All subsequent layout operations must retain that world.
    await page.locator('.mw-scene').selectOption('platformer');
    await page.locator('[data-action=visual-apply]').click();
    await page.waitForFunction(() => CT_CREATE_PRESENTATION.snapshot().scene === 'platformer' && !!selState);
    if (mode !== 'crt') await page.waitForFunction(mode => {
      const p = mode === 'dmg' ? _dmg : _nes;
      return p && p.ready && p.vw > 1 && p.vh > 1 && document.querySelector('.mw-stage-viewport').contains(p.canvas);
    }, mode);
    await page.evaluate(async () => {
      // Long enough for bounded layout probes without a legitimate finite end.
      await CT_MUSIC_WORKSPACE.open({ source: 'song({tempo:120,bars:64});pattern("pulse",notes("C4 E4 G4 E4").stepsPerBar(4));track("lead").instrument("p0").play("pulse",{repeat:64});', explicit: true });
      window.stageEvents = []; window.stageCommands = [];
      Audio.onMusicState(e => stageEvents.push({ status: e.status, reason: e.reason }));
      for (const name of ['musicPlay', 'musicQueue', 'musicStop', 'musicPause', 'musicSeek', 'playScore', 'enterCreate']) {
        const original = Audio[name]; if (typeof original !== 'function') continue;
        Audio[name] = function (...args) { stageCommands.push(name); return original.apply(this, args); };
      }
    });
    await page.locator('[data-action=play]').click();
    await page.waitForFunction(() => Audio.musicVisualState()?.status === 'playing' && Audio.musicVisualState().frame > 3);
    assert.equal(await page.evaluate(() => stageContexts), 1, 'one real AudioContext owns music and visuals');
    await settle(page);
    // Actual source framebuffer pixels, not just computed CSS or a canvas tag.
    assert(await page.evaluate(() => {
      const c = document.getElementById('stage'), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const colors = new Set(); for (let i = 0; i < data.length; i += Math.max(4, Math.floor(data.length / 4096 / 4) * 4))
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size > 3;
    }), 'real renderer produces non-flat pixels');
    await remember(page, mode);
    await page.locator('[data-action=toggle-chat]').click(); await settle(page);
    await unchanged(page, mode + ' chat collapse');
    const splitter = page.locator('.mw-stage-splitter');
    await splitter.focus(); const value = await splitter.getAttribute('aria-valuenow');
    await splitter.press('ArrowLeft'); await settle(page);
    assert.notEqual(await splitter.getAttribute('aria-valuenow'), value, 'keyboard resizes creative split');
    await unchanged(page, mode + ' keyboard resize');
    const box = await splitter.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 12); await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 12, { steps: 5 }); await page.mouse.up(); await settle(page);
    await unchanged(page, mode + ' pointer resize');
    await page.locator('[data-action=visualizer]').click(); await settle(page);
    assert(await page.locator('.mw-stage-viewport').isVisible(), 'Perform retains the same stage');
    assert.equal(await page.locator('.mw-chat').isVisible(), false, 'Perform excludes private chat');
    await unchanged(page, mode + ' Perform');
    await page.keyboard.press('Escape'); await settle(page);
    assert(await page.locator('.mw-code').isVisible() && await page.locator('.mw-notes').isVisible(), 'Escape returns to composition');
    await unchanged(page, mode + ' return from Perform');
    await page.locator('[data-action=stage-fullscreen]').click();
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('.mw-stage-viewport'));
    assert.equal(await page.evaluate(() => !!document.fullscreenElement.querySelector('.mw-chat,.mcui,dialog,.mw-code,input,textarea')), false,
      'stage-only fullscreen contains no private/editor controls');
    await unchanged(page, mode + ' stage-only fullscreen');
    await page.evaluate(() => document.exitFullscreen()); await settle(page);
    await unchanged(page, mode + ' exit fullscreen');
    for (const width of [1400, 900, 430]) {
      await page.setViewportSize({ width, height: 1100 }); await settle(page);
      await geometry(page, width < 980);
      if (width === 1400) {
        assert.equal(await page.locator('.mw-chat').isVisible(), false, 'narrow-desktop chat defaults collapsed');
        const before = await page.locator('.mw-creative').boundingBox();
        await page.locator('[data-action=toggle-chat]').click(); await settle(page);
        assert(await page.locator('.mw-chat').isVisible(), 'chat opens independently as a drawer');
        const after = await page.locator('.mw-creative').boundingBox();
        assert(Math.abs(before.width - after.width) < 1, 'drawer does not squeeze music and visuals');
        await page.keyboard.press('Escape'); await settle(page);
        assert(await page.evaluate(() => CT_MUSIC_WORKSPACE.isOpen()), 'drawer Escape never closes composition');
        assert.equal(await page.locator('.mw-chat').isVisible(), false);
      }
      await unchanged(page, mode + ' viewport ' + width);
    }
    await page.locator('.mw-scene').selectOption('off'); await settle(page);
    await page.locator('[data-action=visual-apply]').click();await settle(page);
    assert.equal(await page.evaluate(() => CT_CREATE_PRESENTATION.snapshot().enabled), false);
    await unchanged(page, mode + ' optional visuals off');
    await page.locator('.mw-scene').selectOption('platformer'); await settle(page);
    await page.locator('[data-action=visual-apply]').click();await settle(page);
    await unchanged(page, mode + ' same scene restored');
    assert.deepEqual(errors, []); assert.deepEqual(providerRequests, []);
    console.log('PASS ' + mode + ': root stopped; persistent geometry; one world/canvas/backbuffers; resize/chat/Perform/Off preserve audio');
  } finally { await context.close(); }
}
(async () => {
  const { server, origin } = await serve();
  let browser, failures = 0;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    console.log('Shared artifact: ' + ([...html.matchAll(/(?:src|href)="([^"]*(?:app\.|music-workspace)[^"]*)"/g)].map(m => m[1]).join(', ') || 'see dist/index.html'));
    for (const mode of ['crt', 'dmg', 'nes']) {
      try { await runMode(browser, origin, mode); }
      catch (error) { failures++; console.error('FAIL ' + mode + ': ' + (error.stack || error)); }
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`verify-music-visual-stage: ${3 - failures}/3 modes passed; Chromium only, no physical Safari/output-window acceptance`);
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
