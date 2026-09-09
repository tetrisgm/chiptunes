#!/usr/bin/env node
'use strict';
// Canonical workflow against one existing dist build. Chat/access are offline
// HTTP fixtures; compilation, preview, chart, revisions and AudioWorklet are real.
// No build, provider call, credential, deployment or changes to other fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createMusicChatHandler } = require('../server/music-chat-handler.js');
const dist = path.resolve(__dirname, '../dist');
const origin = 'https://chiptunes.app', storageKey = 'ct-music-workspace-v1';
const html = fs.readFileSync(path.join(dist, 'create/index.html'), 'utf8');
const app = html.match(/app\.[a-f0-9]+\.js/)[0];
const bundle = fs.readFileSync(path.join(dist, app));
const completeRequest = 'Write a complete finite track with an introduction, a developed theme and an ending, using readable named patterns.';
const variationRequest = 'Vary only the bass pattern; keep the melody unchanged.';
const completeReply = 'Fixture composition: Lantern Path, a complete sixteen-bar track with intro, theme and ending.';
const variationReply = 'Fixture variation: change the bass opening from C2 to D2; all other tracks stay unchanged.';
const arrangement = `// Lantern Path: intro (bars 1–2), theme (3–12), ending (13–16).
song({title:"Lantern Path",tempo:90,bars:16})

pattern("arrival", notes("C5 . E5 . G5 . E5 .").stepsPerBar(8).gate(0.7))
pattern("lanternTheme", notes("E5 G5 A5 G5 E5 D5 C5 .").stepsPerBar(8).gate(0.7))
pattern("homeward", notes("G5 . E5 . D5 . C5:2").stepsPerBar(8).gate(0.9))
pattern("walkingBass", notes("C2 . G2 . C3 . G2 .").stepsPerBar(8).gate(0.65))
pattern("footsteps", notes("C2 . C2 . C2 . C2 .").stepsPerBar(8).gate(0.15))

track("lead").instrument("p0").play("arrival",{atBar:0,repeat:2}).play("lanternTheme",{atBar:2,repeat:10}).play("homeward",{atBar:12,repeat:4})
track("bass").instrument("wave-bass").play("walkingBass",{atBar:0,repeat:16})
track("drums").instrument("n-tick").play("footsteps",{atBar:0,repeat:16})
`;

function completeEdits(source) {
  // Replace musical declarations only. Every existing header/comment and all
  // whitespace outside those spans survive; never replace the whole source.
  const declarations = arrangement.split('\n').filter(line => /^(song|pattern|track)\(/.test(line));
  const replacements = [declarations[0], declarations.slice(1, 4).join('\n'), ...declarations.slice(4)];
  const original = [...source.matchAll(/^(?:song|pattern|track)\([^\n]+/gm)];
  assert.equal(original.length, replacements.length, 'fixture recognizes the starter musical declarations');
  return original.map((match, index) => ({ from: match.index, to: match.index + match[0].length, text: replacements[index] }));
}
function applyEdits(source, edits) {
  return [...edits].reverse().reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), source);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const calls = [], errors = [], routeErrors = [];
  let page, track, manual, varied, adapterCalls = 0;
  const handleChat = createMusicChatHandler({ origin,
    authenticate: async () => ({ subject: 'offline-workflow-owner' }), rateLimit: async () => true,
    adapter: { authorized: true, async propose(options) {
      adapterCalls++;
      assert.deepEqual(options.tools, []); assert.equal(options.maxCalls, 1);
      const input = JSON.parse(options.input);
      let edits, explanation;
      if (adapterCalls === 1) {
        assert.equal(input.request, completeRequest);
        edits = completeEdits(input.source); explanation = completeReply;
        assert.equal(applyEdits(input.source, edits), track);
        assert(edits.every(edit => !(edit.from === 0 && edit.to === input.source.length)));
      } else {
        assert.equal(adapterCalls, 2, 'only two explicit mock adapter calls; no retries');
        assert.equal(input.request, variationRequest); assert.equal(input.source, manual);
        assert.deepEqual(input.constraints.scope, { tracks: [2] });
        assert(input.constraints.locks.some(lock => lock.type === 'track' && lock.tracks.includes(0)), 'melody lock reaches the handler');
        const from = input.source.indexOf('C2 . G2 . C3'); assert(from >= 0);
        edits = [{ from, to: from + 2, text: 'D2' }]; explanation = variationReply;
      }
      return new Response(JSON.stringify({ id: input.id, baseRevision: input.baseRevision, edits, explanation })).body;
    } }
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.setOffline(true);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      try {
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/music/chat/access') {
          assert.equal(request.method(), 'GET');
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, authenticated: true,
            providers: [{ id: 'openai', label: 'OpenAI' }], limits: { dailyCalls: 20 } }) });
        }
        if (url.pathname === '/api/music/chat') {
          assert.equal(request.method(), 'POST');
          assert.equal(request.headers()['x-music-provider'], 'openai');
          const input = request.postDataJSON(); calls.push(input);
          // Exercise real request/proposal validation and musical constraints.
          // Only authentication, quota and the model adapter are fixture data.
          const response = await handleChat(new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postData() }));
          const body = await response.text();
          assert.equal(response.status, 200, 'real chat handler must accept localized proposal: ' + body);
          return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, body: '{}' });
        if (['/create', '/create/'].includes(url.pathname)) return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/' + app) return route.fulfill({ contentType: 'text/javascript', body: bundle });
        const file = path.resolve(dist, '.' + url.pathname);
        if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
          return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
      } catch (error) {
        routeErrors.push(error.message);
        await route.fulfill({ status: 500, body: '{}' });
      }
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/create'); // No #music escape hatch or legacy open.
    await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content');
    await page.waitForFunction(() => document.querySelector('.mcui-status')?.textContent.startsWith('Unlocked.'));
    const snapshot = () => page.evaluate(() => CT_MUSIC_WORKSPACE.snapshot());
    const editor = page.locator('#musicworkspace .cm-content');
    const input = page.locator('.mcui textarea');
    const apply = page.getByRole('log', { name: 'Conversation' }).getByRole('button', { name: 'Apply', exact: true });
    const initial = await snapshot();
    track = applyEdits(initial.draft, completeEdits(initial.draft));
    manual = track.replace('E5 G5 A5 G5', 'F5 G5 A5 G5');
    varied = manual.replace('C2 . G2 . C3', 'D2 . G2 . C3');
    assert.deepEqual(track.split('\n').filter(line => line.startsWith('//')), initial.draft.split('\n').filter(line => line.startsWith('//')), 'complete arrangement preserves all starter comments');
    assert.equal(initial.playing, null); assert.equal(initial.pending, null);
    assert.equal(await page.evaluate(() => CT_CREATE.isOpen()), false, 'canonical entry never mounts legacy underneath');
    const expected = await page.evaluate(source => CT_MUSIC_LANGUAGE.compile(source), track);
    assert(expected.gb, JSON.stringify(expected.diagnostics));
    assert.equal(expected.settings.bars, 16);
    assert(expected.gb.totalFrames > 0 && Number.isFinite(expected.gb.totalFrames));
    assert(expected.gb.notes.every(n => n.frame + n.frames <= expected.gb.totalFrames), 'whole arrangement has a finite end');
    assert(expected.mapping.every(m => m.pattern), 'complete track is authored named patterns, never an event dump');
    assert(new Set(expected.mapping.map(m => m.pattern)).size >= 5, 'intro, theme, ending and accompaniment are named');

    async function assertChart(compiled) {
      // Scan the horizontal viewport, retaining note identities across renders.
      // Offscreen notes are deliberately absent from the bounded chart DOM.
      const wanted = compiled.gb.notes.map(n => `${['Melody', 'Harmony', 'Bass', 'Drums'][n.ch]} note ${n.midi == null ? 'noise' : n.midi} frame ${n.frame} length ${n.frames}`).sort();
      assert(wanted.length < 400);
      const chart = await page.locator('.mw-notes').evaluate(async pane => {
        const original = pane.scrollLeft, seen = new Map(); let maxMounted = 0;
        const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const end = Math.max(0, pane.scrollWidth - pane.clientWidth), step = Math.max(1, Math.floor(pane.clientWidth / 2));
        for (let left = 0; ; left = Math.min(end, left + step)) {
          pane.scrollLeft = left; await paint();
          const notes = pane.querySelectorAll('.mw-note'); maxMounted = Math.max(maxMounted, notes.length);
          notes.forEach(note => seen.set(note.dataset.note, note.getAttribute('aria-label')));
          if (left === end) break;
        }
        pane.scrollLeft = original; await paint();
        return { labels: [...seen.values()], maxMounted };
      });
      assert(chart.maxMounted <= 400, 'chart respects its mounted-event budget');
      assert.deepEqual(chart.labels.sort(), wanted, 'scrolling chart exposes every compiled pitch, frame and duration');
      assert(await page.getByRole('region', { name: 'Code editor', exact: true }).isVisible());
      assert(await page.getByRole('region', { name: 'Note chart', exact: true }).isVisible());
    }
    async function waitPlaying(id) {
      await page.waitForFunction(id => CT_MUSIC_WORKSPACE.snapshot().playing === id, id);
      await page.waitForFunction(id => Audio.musicVisualState()?.revision === id && Audio.musicVisualState().status === 'playing', id);
      await page.waitForFunction(() => window.__rrrChip && __rrrChip.peak > 0.001);
    }
    async function transition(click, idBefore) {
      const capture = await page.evaluate(() => ({ start: workflowEvents.length,
        boundaries: Array.from(Audio.musicBoundaries(CT_MUSIC_WORKSPACE.snapshot().validated.compiled)) }));
      await click();
      await page.waitForFunction(id => CT_MUSIC_WORKSPACE.snapshot().validated.id !== id, idBefore);
      const next = await snapshot(); await waitPlaying(next.validated.id);
      const ack = await page.evaluate(({ start, id }) => workflowEvents.slice(start).filter(e => e.status === 'playing' && e.reason === 'activate' && e.revision === id), { start: capture.start, id: next.validated.id });
      assert.equal(ack.length, 1, 'one real activation acknowledgement per applied edit');
      assert(capture.boundaries.includes(ack[0].frame), 'edit activates on the sounding musical boundary');
      return await snapshot();
    }

    await input.fill(completeRequest); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await apply.waitFor();
    assert.equal(calls.length, 1); assert.equal((await snapshot()).draft, initial.draft, 'proposal does not silently replace source');
    assert.equal((await snapshot()).playing, null);
    await apply.click();
    await page.waitForFunction(source => CT_MUSIC_WORKSPACE.snapshot().validated.source === source, track);
    const composed = await snapshot();
    assert.equal(composed.draft, track); assert.deepEqual(composed.validated.compiled.gb, expected.gb);
    assert.equal(composed.playing, null); assert.equal(composed.pending, null, 'Apply while stopped never autoplays');
    await assertChart(expected);
    await page.locator('.mw-loop').uncheck(); // Finite playback, not audition looping.
    await page.evaluate(() => { window.workflowEvents = []; Audio.onMusicState(e => workflowEvents.push({ ...e })); });
    await page.locator('[data-action=play]').click(); await waitPlaying(composed.validated.id);
    assert(await page.evaluate(id => workflowEvents.some(e => e.status === 'playing' && e.revision === id), composed.validated.id));
    console.log('  ok canonical entry → complete named-pattern proposal → Apply/chart → real finite Play');

    await editor.fill(manual);
    await page.waitForFunction(() => document.querySelector('.mw-chart-status').textContent.includes('Draft preview'));
    const manualCompiled = await page.evaluate(source => CT_MUSIC_LANGUAGE.compile(source), manual);
    await assertChart(manualCompiled);
    assert.equal((await snapshot()).validated.id, composed.validated.id, 'preview is not an applied revision');
    assert.equal((await snapshot()).playing, composed.validated.id, 'pitch preview leaves the previous score playing');
    const playedManual = await transition(() => editor.press('ControlOrMeta+Enter'), composed.validated.id);
    assert.equal(playedManual.draft, manual);
    assert.notDeepEqual(playedManual.validated.compiled.gb.notes, composed.validated.compiled.gb.notes);
    assert.deepEqual(playedManual.validated.compiled.gb.notes.filter(n => n.ch !== 0), composed.validated.compiled.gb.notes.filter(n => n.ch !== 0), 'manual pitch edit changes melody only');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.mw-scope').selectOption('2'); await page.locator('.mw-lock').selectOption('track');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await input.fill(variationRequest); await page.getByRole('button', { name: 'Send', exact: true }).click();
    await apply.waitFor();
    assert.equal((await snapshot()).draft, manual, 'scoped proposal requires explicit Apply');
    assert.equal(calls.length, 2); assert.equal(calls[1].baseRevision, playedManual.validated.id);
    assert.deepEqual(calls[1].conversation, [{ role: 'user', content: completeRequest }, { role: 'assistant', content: completeReply }]);
    const variation = await transition(() => apply.click(), playedManual.validated.id);
    assert.equal(variation.draft, varied);
    assert.notDeepEqual(variation.validated.compiled.gb.notes.filter(n => n.ch === 2), playedManual.validated.compiled.gb.notes.filter(n => n.ch === 2));
    assert.deepEqual(variation.validated.compiled.gb.notes.filter(n => n.ch !== 2), playedManual.validated.compiled.gb.notes.filter(n => n.ch !== 2), 'scope and melody lock preserve all other tracks');
    await assertChart(variation.validated.compiled);
    const undone = await transition(() => page.locator('[data-action=undo]').click(), variation.validated.id);
    assert.equal(undone.draft, manual); assert.deepEqual(undone.validated.compiled.gb, playedManual.validated.compiled.gb);
    await assertChart(undone.validated.compiled);
    console.log('  ok manual pitch preview/Run → scoped bass variation Apply → exact source/chart/audio undo');

    await input.fill('Keep this unsent message');
    await page.locator('[data-action=toggle-chat]').click();
    assert.equal(await page.locator('.mw-chat').isVisible(), false);
    const beforePresentation = await page.evaluate(() => ({ frame: Audio.musicVisualState().frame, events: workflowEvents.length }));
    await page.getByRole('button', { name: 'Visualizer', exact: true }).click();
    assert.equal(await page.evaluate(() => CT_MUSIC_WORKSPACE.isVisualizerOpen()), true);
    assert.equal(await page.locator('.mw-code').isVisible(), false, 'visualizer replaces composition presentation');
    await page.waitForFunction(frame => Audio.musicVisualState().frame > frame + 10, beforePresentation.frame);
    await page.getByRole('button', { name: 'Return to composition', exact: true }).click();
    assert.equal(await page.evaluate(() => CT_MUSIC_WORKSPACE.isVisualizerOpen()), false);
    assert.equal((await snapshot()).draft, manual); assert.equal((await snapshot()).playing, undone.validated.id);
    const presentation = await page.evaluate(start => ({ state: Audio.musicVisualState(), events: workflowEvents.slice(start) }), beforePresentation.events);
    assert(presentation.state.frame > beforePresentation.frame, 'presentation never rewinds playback');
    assert.equal(presentation.state.status, 'playing');
    assert(presentation.events.every(e => ['position'].includes(e.status)), 'presentation issues no stop, pause, loop, queue or activation');
    await assertChart(undone.validated.compiled);
    assert.equal(await page.locator('.mw-chat').isVisible(), false, 'composition return preserves collapsed chat');
    await page.locator('[data-action=toggle-chat]').click();
    assert.equal(await input.inputValue(), 'Keep this unsent message');
    await page.getByRole('log', { name: 'Conversation' }).getByText(variationReply, { exact: true }).waitFor();

    await page.locator('[data-action=pause]').click();
    await page.waitForFunction(() => Audio.musicVisualState().status === 'paused');
    await editor.fill(manual + '\ninvalid unfinished code');
    await page.waitForFunction(() => document.querySelector('.mw-chart-status').textContent === 'Previous chart · draft has errors');
    const heldFrame = await page.evaluate(() => Audio.musicVisualState().frame);
    await page.getByRole('button', { name: 'Visualizer', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => Audio.musicVisualState().status), 'paused');
    assert.equal(await page.evaluate(() => Audio.musicVisualState().frame), heldFrame);
    assert.equal((await snapshot()).draft, manual + '\ninvalid unfinished code');
    assert.equal((await snapshot()).validated.source, manual);
    await assertChart(undone.validated.compiled);
    await editor.fill(manual);

    await page.locator('.mw-project-tools>summary').click(); await page.locator('[data-action=save]').click();
    await page.waitForFunction(({ key, source }) => {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved?.draft === source && saved.private?.chat?.length === 4;
    }, { key: storageKey, source: manual });
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    await page.reload(); await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content');
    const restored = await snapshot();
    assert.equal(restored.draft, manual); assert.equal(restored.validated.source, manual);
    assert.deepEqual(restored.validated.compiled.gb, undone.validated.compiled.gb);
    assert.equal(restored.playing, null); assert.equal(restored.pending, null, 'reload never starts audio');
    await assertChart(restored.validated.compiled);
    await page.getByRole('log', { name: 'Conversation' }).getByText(variationReply, { exact: true }).waitFor();
    assert.deepEqual(await page.locator('.mcui-message p').allTextContents(), saved.private.chat.map(m => m.content), 'private transcript survives reload');
    assert.equal(await page.getByRole('log', { name: 'Conversation' }).getByRole('button', { name: 'Apply', exact: true }).count(), 0, 'reload cannot revive old proposals');
    assert.equal(calls.length, 2, 'presentation, save and reload never send requests');
    assert.equal(adapterCalls, 2, 'both proposals passed through the real handler and mock adapter exactly once');
    assert.equal(new URL(page.url()).origin, origin); assert.equal(new URL(page.url()).pathname, '/create');
    assert.deepEqual(routeErrors, []); assert.deepEqual(errors, []);
    console.log('  ok collapsed chat → visualizer/composition preserves playback/source → private save/reload');
    console.log('PASS unified workflow: offline complete-track/scoped-variation fixtures, real compiler/preview/AudioWorklet, canonical single workspace (' + app + ')');
  } catch (error) {
    if (page && !page.isClosed()) console.error(await page.locator('.mw-status,.mw-chart-status,.mcui-proposal,.mw-diagnostics').allTextContents());
    if (routeErrors.length) console.error('HTTP fixture errors:', routeErrors);
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
