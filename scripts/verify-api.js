// THE AGENT CONTRACT.
//
// src/api.js, bin/chiptunes.js, mcp/server.js and the in-page surface are the
// four faces of one API, and the whole point of an API is that it does not move
// under the people using it. This gate holds:
//
//   1. The surface exists and is versioned.
//   2. Determinism, which is the product's central claim: the same token
//      composes the same song forever, and a document always materialises the
//      same notes.
//   3. A hand-authored song round-trips LOSSLESSLY through JSON -> document ->
//      JSON. If that ever stops being true an agent cannot edit anything.
//   4. Validation refuses what the chip cannot do, and says what to use instead.
//      The error text IS the interface an agent iterates on.
//   5. The exports are real: a 32 KB cartridge with a Nintendo logo and a
//      correct header checksum, and a WAV that is actually audible.
//   6. The MCP server speaks the protocol over stdio and its tools work.
//   7. The in-page surface registers its tools and reads the live session.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { chromium } = require('playwright');

const api = require('../src/api.js');
const DIST = path.join(__dirname, '..', 'dist');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-api-'));

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

// one stdio round trip against the MCP server
function mcp(messages) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')]);
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', () => {
      try {
        res(out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
      } catch (e) { rej(new Error('bad MCP output: ' + out.slice(0, 200) + ' ' + err.slice(0, 200))); }
    });
    p.stdin.write(messages.map(m => JSON.stringify(m)).join('\n') + '\n');
    p.stdin.end();
  });
}

(async () => {
  // ---- 1. the surface -----------------------------------------------------
  console.log('the surface');
  const required = ['capabilities', 'compose', 'load', 'toJSON', 'fromJSON', 'validate',
                    'describe', 'buildCartridge', 'renderWav', 'shareUrl'];
  ok(required.every(k => typeof api[k] === 'function'),
     'every documented entry point exists (' + required.length + ')');
  ok(api.API_VERSION === 1, 'the API is versioned (' + api.API_VERSION + ')');
  const caps = api.capabilities();
  ok(caps.lanes.length === 4 && caps.lanes[0].name === 'Melody' && caps.lanes[3].name === 'Drums',
     'capabilities names the four lanes');
  // the rules an agent has to obey, read off the app rather than restated
  ok(caps.lanes[0].motions.includes('fall') && !caps.lanes[1].motions.includes('fall'),
     'and says Fall is Melody-only (it needs channel 1\'s sweep unit)');
  ok(!caps.lanes[3].motions.includes('arp'), 'and that drums have no arp');
  ok(caps.moods.length > 0 && caps.grids.length > 0 && caps.cartridge.bytes === 32768,
     'and carries the moods, grids and cartridge size');

  // ---- 2. determinism -----------------------------------------------------
  console.log('determinism');
  const a1 = api.compose({ token: 'a62tjr3jz43fdvid' });
  const a2 = api.compose({ token: 'a62tjr3jz43fdvid' });
  ok(a1.doc === a2.doc && a1.title === a2.title,
     'the same token composes the same song, byte for byte (' + a1.title + ')');
  ok(api.describe(a1.doc).notes === api.describe(a2.doc).notes,
     'and the same document materialises the same notes');
  const m = api.compose({ mood: 'chill' });
  ok(!!m.doc && !!m.title, 'a mood composes a titled song (' + m.title + ')');
  let threw = null;
  try { api.compose({ mood: 'not-a-mood' }); } catch (e) { threw = e.message; }
  ok(/Known moods/.test(threw || ''), 'an unknown mood fails with the list of real ones');

  // ---- 3. the round trip, which is what makes editing possible ------------
  console.log('the round trip');
  const hand = {
    title: 'Gate Song', bpm: 120, bars: 2, grid: 16,
    notes: [
      { lane: 'Melody', step: 0, note: 'C4', len: 2, velocity: 0.8 },
      { lane: 'Melody', step: 8, note: 'G4', len: 4, velocity: 0.9, motion: 'arp' },
      { lane: 'Harmony', step: 0, note: 'E3', len: 8, velocity: 0.5 },
      { lane: 'Bass', step: 0, note: 'C2', len: 4, velocity: 0.9 },
      { lane: 'Drums', step: 0, drum: 'kick' },
      { lane: 'Drums', step: 4, drum: 'snare' }
    ]
  };
  const doc = api.fromJSON(hand);
  const back = api.toJSON(doc);
  ok(back.notes.length === hand.notes.length,
     'a hand-written song survives JSON -> document -> JSON (' + hand.notes.length + ' notes)');
  ok(back.title === hand.title && back.bpm === hand.bpm && back.grid === hand.grid,
     'with its title, tempo and grid');
  const same = hand.notes.every((n, i) => {
    const b = back.notes[i];
    return b && b.lane === n.lane && b.step === n.step && (b.note || b.drum) === (n.note || n.drum) &&
           (b.len || 1) === (n.len || 1) && (n.motion ? b.motion === n.motion : true);
  });
  ok(same, 'and every lane, step, pitch, length and motion intact');
  ok(api.fromJSON(back) === doc, 'and re-encoding the read-back gives the identical document');

  // ---- 4. validation ------------------------------------------------------
  console.log('validation');
  const bad = api.validate({ grid: 16, notes: [
    { lane: 'Drums', step: 0, drum: 'kick', motion: 'fall' },
    { lane: 'Melody', step: 0, note: 'H9' },
    { lane: 'Nope', step: 0, note: 'C4' }
  ] });
  ok(!bad.ok && bad.errors.length === 3, 'three bad notes give three errors');
  ok(bad.errors.some(e => /Drums cannot do "fall"/.test(e) && /It can do/.test(e)),
     'a motion the lane cannot play says what it can play instead');
  ok(bad.errors.some(e => /is not a note name/.test(e) && /C#4/.test(e)),
     'a bad pitch shows the shape of a real one');
  ok(bad.errors.some(e => /unknown lane/.test(e) && /Melody, Harmony, Bass, Drums/.test(e)),
     'a bad lane lists the real lanes');
  const overlap = api.validate({ grid: 16, notes: [
    { lane: 'Bass', step: 0, note: 'C2', len: 8 }, { lane: 'Bass', step: 2, note: 'E2', len: 4 }
  ] });
  ok(overlap.ok && overlap.warnings.some(w => /one voice per lane/.test(w)),
     'overlapping notes on one lane warn rather than fail');
  let ferr = null;
  try { api.fromJSON({ grid: 16, notes: [{ lane: 'Melody', step: 0, note: 'H9' }] }); } catch (e) { ferr = e; }
  ok(ferr && Array.isArray(ferr.errors), 'fromJSON refuses an invalid song and carries the errors');

  // ---- 5. the exports are real -------------------------------------------
  console.log('exports');
  const rom = api.buildCartridge(doc);
  ok(rom.length === 32768, 'the cartridge is 32 KB (' + rom.length + ')');
  // the Nintendo logo at $0104 is what the boot ROM checks before it will run
  const LOGO = [0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B];
  ok(LOGO.every((b, i) => rom[0x104 + i] === b), 'with the boot logo the hardware checks at $0104');
  let sum = 0; for (let i = 0x134; i <= 0x14C; i++) sum = (sum - rom[i] - 1) & 0xFF;
  ok(sum === rom[0x14D], 'and a correct header checksum (' + sum + ')');
  const wav = api.renderWav(doc);
  ok(wav.slice(0, 4).toString() === 'RIFF' && wav.slice(8, 12).toString() === 'WAVE',
     'the WAV is a real RIFF/WAVE file (' + wav.length + ' bytes)');
  let peak = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  ok(peak > 2000, 'and it is actually audible (peak ' + peak + ' of 32767)');
  ok(api.shareUrl(doc).startsWith('https://chiptunes.app/#s='),
     'a share link carries the song in the fragment, so nothing is uploaded');

  // ---- 5b. briefs, sets, variants and stems -------------------------------
  //
  // The tier that makes this usable rather than merely programmable: ask for a
  // scene of a given length, get cohesive sets, get a sad version, get stems.
  console.log('briefs, sets and variants');
  const g = api.guide();
  ok(g.scenes.length >= 8 && g.moodWords.length >= 6 && !!g.licensing && !!g.provenance,
     'guide() answers the questions an agent would otherwise guess at');
  ok(/deterministic algorithm/.test(g.provenance) && !/legal advice/.test(g.provenance) &&
     /not legal advice/.test(g.licensing),
     'and is careful about licensing rather than inventing an answer');

  const boss = api.brief({ scene: 'boss', seconds: 30, exclude: ['Drums'] });
  ok(boss.unmet.length === 0, 'a brief with a scene, a length and an exclusion is met (' + boss.unmet.join('; ') + ')');
  ok(Math.abs(boss.seconds - 30) <= 5, 'the length is close to what was asked (' + boss.seconds + 's of 30s)');
  ok(boss.perLane.Drums === 0 && boss.notes > 0, 'and the excluded lane really is absent');
  let bo = null;
  try { api.brief({ scene: 'nope' }); } catch (e) { bo = e.message; }
  ok(/Known:/.test(bo || ''), 'an unknown scene lists the real ones');

  const sad = api.variant(boss.doc, { mood: 'sadder' });
  const bd = api.describe(boss.doc), sd = api.describe(sad.doc);
  ok(sd.bpm < bd.bpm && sad.applied.some(x => /mode -> minor/.test(x)),
     'a sadder variant is slower and in the minor (' + bd.bpm + ' -> ' + sd.bpm + 'bpm)');
  ok(sd.notes === bd.notes, 'and keeps every note, so it is recognisably the same music');
  ok(api.describe(boss.doc).bpm === bd.bpm, 'and leaves the original alone');
  ok(Array.isArray(sad.recipe) && sad.recipe.length > 0, 'the recipe is data an agent can read');

  const tr = api.transform(boss.doc, [{ op: 'tempo', absolute: 100 }, { op: 'drop', lane: 'Harmony' }]);
  ok(api.describe(tr.doc).bpm === 100 && api.describe(tr.doc).perLane.Harmony === 0,
     'transforms are exact and compose in order');
  ok(api.transform(boss.doc, [{ op: 'nonsense' }]).skipped.length === 1,
     'and an unknown operation is reported, not silently ignored');

  const ost = api.soundtrack({ scenes: ['title', 'battle', 'game_over'], key: 'D' });
  ok(ost.cues.length === 3 && ost.cues.every(c => c.notes > 0), 'a soundtrack returns a cue per scene');
  const CT = require('../src/create.js');
  const keys = new Set(ost.cues.map(c => CT.docState(c.doc).key));
  ok(keys.size === 1, 'and every cue is in the same key, which is what makes them belong together');

  const stems = api.renderStems(boss.doc);
  ok(stems.length === 4 && stems.every(x => x.wav.slice(0, 4).toString() === 'RIFF'),
     'four stems render, one per hardware voice');
  const energy = w => { let e = 0; for (let i = 44; i + 1 < w.length; i += 2) e += Math.abs(w.readInt16LE(i)); return e; };
  const live = stems.filter(x => energy(x.wav) > 0);
  ok(live.length >= 2, 'and they carry real audio (' + live.map(x => x.lane).join(', ') + ')');
  ok(stems[3].wav.includes(Buffer.from('smpl')), 'with a smpl chunk so an engine reads the loop point');

  // ---- 5c. saying what you want -------------------------------------------
  //
  // The field in the product. It is deterministic on purpose -- there is no
  // model in the page -- so these are exact expectations, not vibes. The rule
  // that matters: it never silently does nothing.
  console.log('saying what you want');
  const said = [
    ['a boss theme, 30 seconds, no drums', 'brief', ['scene: boss', 'length: 30s', 'without Drums']],
    ['something happy for a title screen', 'brief', ['scene: title', 'mood: happier']],
    ['a sad cave theme in D minor', 'brief', ['scene: cave', 'key: D', 'mode: minor']],
    // "much" attaches to "sadder" here, not to "slower", so plain slower is the
    // right reading. Mood recipes are not intensity-scaled today.
    ['make it much sadder and slower', 'change', ['slower', 'mood: sadder']],
    ['much slower', 'change', ['much slower']],
    ['120 bpm and no bass', 'change', ['without Bass', 'tempo: 120 bpm']],
    ['a short victory fanfare', 'brief', ['scene: victory', 'length: short (20s)']]
  ];
  said.forEach(([text, kind, want]) => {
    const r = api.interpret(text, { hasSong: true });
    const got = r.understood.join(' | ');
    ok(r.kind === kind && want.every(w => r.understood.indexOf(w) >= 0),
       '"' + text + '" -> ' + r.kind + ': ' + got);
  });
  const nonsense = api.interpret('banana wobble frobnicate', { hasSong: true });
  ok(nonsense.understood.length === 0 && nonsense.notUnderstood.length === 3,
     'and nonsense is reported as not understood rather than guessed at');
  ok(api.interpret('a boss theme, 30 seconds', {}).notUnderstood.length === 0,
     'words it consumed are not reported as ignored (the warning stays meaningful)');

  const askA = api.ask('a boss theme, 30 seconds, no drums');
  ok(askA.ok && askA.perLane.Drums === 0 && Math.abs(askA.seconds - 30) <= 6,
     'ask() carries a whole sentence out (' + askA.seconds + 's, ' + askA.notes + ' notes)');
  const askB = api.ask('make it much slower', { doc: askA.doc });
  ok(askB.ok && askB.bpm < askA.bpm, 'and a change applies to the song it is given (' + askA.bpm + ' -> ' + askB.bpm + ')');
  const askC = api.ask('zzzz qqqq');
  ok(!askC.ok && /did not recognise/.test(askC.error), 'and nonsense refuses rather than composing something random');

  // ---- 6. the MCP server --------------------------------------------------
  console.log('the MCP server');
  const romPath = path.join(tmp, 'gate.gb');
  const msgs = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'compose', arguments: { token: 'a62tjr3jz43fdvid' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'song_to_json', arguments: { song: 'song_1', fromBar: 0, toBar: 0 } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'export_cartridge', arguments: { song: 'song_1', path: romPath } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'compose', arguments: { mood: 'nope' } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'describe', arguments: { song: 'song_404' } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'guide', arguments: {} } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'brief', arguments: { scene: 'battle', seconds: 20 } } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'variant', arguments: { song: 'song_2', mood: 'calmer' } } },
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'soundtrack', arguments: { scenes: ['title', 'boss'], key: 'A' } } }
  ]);
  const by = id => msgs.find(x => x.id === id);
  ok(by(1) && by(1).result.serverInfo.name === 'chiptunes' && !!by(1).result.protocolVersion,
     'it initializes and names itself');
  const tools = by(2).result.tools;
  ok(tools.length >= 8 && tools.every(t => t.name && t.description && t.inputSchema),
     'every tool has a description and a schema (' + tools.length + ' tools)');
  const composed = JSON.parse(by(3).result.content[0].text);
  ok(composed.id === 'song_1' && composed.notes > 0,
     'compose returns a short id rather than a 10k-character document');
  const win = JSON.parse(by(4).result.content[0].text);
  ok(win.notes.length > 0 && win.notes.length < win.window.of && win.notes.every(n => n.bar === 0),
     'reading is paged by bar (' + win.notes.length + ' of ' + win.window.of + ')');
  ok(fs.existsSync(romPath) && fs.statSync(romPath).size === 32768, 'it writes a real cartridge');
  ok(by(6).result.isError && /Known moods/.test(by(6).result.content[0].text),
     'a bad argument comes back as a readable tool error, not a protocol failure');
  ok(by(7).result.isError && /unknown song id/.test(by(7).result.content[0].text),
     'and an unknown song id says so');
  const gg = JSON.parse(by(8).result.content[0].text);
  ok(gg.scenes && gg.recipes && gg.instantFreeLocal,
     'guide is a tool, so an agent reads the rules instead of guessing');
  const br = JSON.parse(by(9).result.content[0].text);
  ok(br.id && br.notes > 0 && Array.isArray(br.unmet), 'brief works over MCP and reports unmet constraints');
  const va = JSON.parse(by(10).result.content[0].text);
  ok(va.id && va.id !== 'song_2' && va.applied.length > 0,
     'variant returns a NEW id, so "go back" is free');
  const so = JSON.parse(by(11).result.content[0].text);
  ok(so.cues.length === 2 && so.cues.every(c => c.id), 'soundtrack returns one id per cue');

  // ---- 7. the in-page surface --------------------------------------------
  console.log('the page');
  const h = await server();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  // a stub for the WebMCP surface, so registration is exercised on an engine
  // that does not ship it yet
  await p.addInitScript(() => {
    window.__registered = [];
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: { registerTool: t => window.__registered.push(t.name) }
    });
  });
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(2500);
  const page = await p.evaluate(() => ({
    present: typeof window.chiptunes === 'object',
    tools: (window.chiptunes && window.chiptunes.tools || []).map(t => t.name),
    webmcp: window.chiptunes && window.chiptunes.webmcp,
    registered: window.__registered || [],
    now: window.chiptunes && window.chiptunes.now_playing()
  }));
  ok(page.present && page.tools.length >= 6, 'window.chiptunes is on the page (' + page.tools.length + ' tools)');
  // ⚠️ THE BUNDLE IS CONCATENATED CLASSIC SCRIPTS, so a top-level `var` in any
  // source file is a GLOBAL. api.js declares 47 names including Song, compose,
  // load, describe and validate; shipping it unwrapped clobbered seed.js's Song
  // and killed the audio chip (chipDiag reported chip:false, chipGain:0) -- and
  // it only showed up under the full suite, never standalone. Both agent files
  // are inside IIFEs now, and this asserts they stay that way.
  const leaks = await p.evaluate(() => {
    const names = ['compose', 'brief', 'soundtrack', 'variant', 'transform', 'describe', 'validate',
                   'capabilities', 'renderWav', 'renderStems', 'toJSON', 'fromJSON', 'guide',
                   'SCENES', 'MOODS', 'LANES', 'EXPORTS', 'wavOf', 'rowFor', 'laneOfCell'];
    return { leaked: names.filter(n => n in window),
             songIsSeed: typeof Song === 'object' && typeof Song.mint === 'function' };
  });
  ok(leaks.leaked.length === 0,
     'and it leaks no globals of its own' + (leaks.leaked.length ? ': ' + leaks.leaked.join(', ') : ''));
  ok(leaks.songIsSeed, 'and Song is still seed.js, not something a later file overwrote');
  // COMPOSING IN THE PAGE, not just transforming. The first version of this
  // resolved the composer from a global that does not exist (it lives in the
  // CT_COMPOSERS registry), so brief() threw in the browser while variant()
  // worked -- and nothing here noticed until production did.
  const pageCompose = await p.evaluate(() => {
    if (typeof CT_API === 'undefined') return { api: false };
    try {
      const c = CT_API.brief({ scene: 'boss', seconds: 20 });
      const t = CT_API.compose({ mood: 'chill' });
      return { api: true, brief: c.title, seconds: c.seconds, notes: c.notes, mood: t.title };
    } catch (e) { return { api: true, error: e && e.message ? e.message : String(e) }; }
  });
  ok(pageCompose.api && !pageCompose.error && pageCompose.notes > 0,
     'brief() and compose() work IN THE PAGE' + (pageCompose.error ? ': ' + pageCompose.error :
      ' (' + pageCompose.brief + ', ' + pageCompose.seconds + 's)'));
  ok(page.webmcp === 'registerTool' && page.registered.length === page.tools.length,
     'and every tool is registered with WebMCP when the browser has it');
  ok(page.now && Array.isArray(page.now.moods) && page.now.moods.length > 0,
     'now_playing reads the live session (' + (page.now && page.now.moods.length) + ' moods)');
  const played = await p.evaluate(async () => {
    const r = window.chiptunes.play_mood({ mood: 'happy' });
    await new Promise(res => setTimeout(res, 6000));
    const now = window.chiptunes.now_playing();
    const cur = window.chiptunes.current_song();
    return { r, title: now.title, hasDoc: !!cur.document, len: cur.document ? cur.document.length : 0 };
  });
  ok(played.r.ok && played.title && played.title !== 'Chiptunes.app',
     'play_mood puts a song on air (' + played.title + ')');
  ok(played.hasDoc && played.len > 1000,
     'and current_song returns the document behind it (' + played.len + ' chars)');
  const rt = await p.evaluate(doc => {
    const r = window.chiptunes.play_song({ document: doc });
    return { ok: r.ok };
  }, doc);
  ok(rt.ok, 'a document made in Node plays in the page');
  // the API is in the page too, so an agent can transform what is playing
  const inPage = await p.evaluate(async () => {
    if (typeof CT_API === 'undefined') return { api: false };
    const before = window.chiptunes.current_song().document;
    const r = window.chiptunes.variant({ mood: 'sadder' });
    await new Promise(res => setTimeout(res, 3000));
    const after = window.chiptunes.current_song().document;
    return { api: true, ok: r.ok, applied: r.applied || [], changed: !!after && after !== before,
             canGoBack: !!r.previous && r.previous === before };
  });
  ok(inPage.api, 'the API is reachable in the page as CT_API');
  ok(inPage.ok && inPage.applied.some(x => /minor/.test(x)),
     'a variant of the song on air is composed in the browser (' + (inPage.applied || []).join('; ') + ')');
  ok(inPage.changed && inPage.canGoBack,
     'it replaces what is playing and hands back the previous document, so "go back" works');
  // the field, in the product, on the screen people are looking at
  const fieldOk = await p.evaluate(async () => {
    const fill = async (t) => {
      const f = document.querySelector('.rmood-sayin');
      const g = document.querySelector('.rmood-saygo');
      if (!f || !g) return null;
      f.value = t; g.click();
      await new Promise(r => setTimeout(r, 4000));
      const s = document.querySelector('.rmood-saidback');
      return { said: s ? s.textContent : '', bad: s ? /bad/.test(s.className) : false };
    };
    const cs = getComputedStyle(document.querySelector('.rmood-sayin'));
    const r = document.querySelector('.rmood-sayin').getBoundingClientRect();
    const before = (function () { try { return Audio.currentDoc() || ''; } catch (e) { return ''; } })();
    const made = await fill('a cave theme, 20 seconds, no drums');
    const after = (function () { try { return Audio.currentDoc() || ''; } catch (e) { return ''; } })();
    const junk = await fill('zzzz qqqq');
    const afterJunk = (function () { try { return Audio.currentDoc() || ''; } catch (e) { return ''; } })();
    return { pointer: cs.pointerEvents, onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0,
             made, changed: after !== before && !!after, junk, junkChanged: afterJunk !== after };
  });
  ok(fieldOk.pointer === 'auto' && fieldOk.onScreen,
     'the ask field is reachable on the playing screen (pointer-events ' + fieldOk.pointer + ')');
  ok(fieldOk.made && /scene: cave/.test(fieldOk.made.said) && /without Drums/.test(fieldOk.made.said),
     'typing a brief names back what it understood (' + (fieldOk.made && fieldOk.made.said || '').slice(0, 90) + ')');
  ok(fieldOk.changed, 'and actually puts that song on the deck');
  ok(fieldOk.junk && fieldOk.junk.bad && !fieldOk.junkChanged,
     'and nonsense says so and changes nothing, rather than composing at random');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); h.s.close();

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log(fail ? '\nFAILED (' + fail + ')' : '\nall good');
  process.exit(fail ? 1 : 0);
})();
