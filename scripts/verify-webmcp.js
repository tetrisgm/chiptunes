// DO THE WEBMCP TOOLS ACTUALLY REGISTER, AND DO THEY WORK?
//
// This exists because of a bug that no amount of local testing would have
// found. The registration looked at `navigator.modelContext`. The spec surface
// is `document.modelContext`. Every browser that actually implements WebMCP --
// the ChatGPT desktop app's in-app browser, and Chrome with
// chrome://flags/#enable-webmcp-testing -- would have found NO TOOLS AT ALL,
// while the page looked perfectly healthy and `window.chiptunes` worked fine.
// The shim used in testing had been written against the same wrong surface, so
// the test and the code agreed with each other and both were wrong.
//
// So the shim here is deliberately the SPEC one, installed before any page
// script runs, exactly as an agent browser injects it. And it is not enough to
// check that tools appear: each one is called, on the real built bundle, and
// its answer checked.
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
      const rel = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '');
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

// The agent browser's side of the contract, as the spec defines it: an object
// on `document` with registerTool, injected before the page's own scripts.
const SHIM = `
  window.__mcpTools = [];
  document.modelContext = {
    registerTool: function (t) {
      if (!t || typeof t.name !== 'string' || typeof t.execute !== 'function')
        throw new Error('bad tool descriptor');
      window.__mcpTools.push(t);
      return { unregister: function () {} };
    }
  };
  window.__mcpCall = async function (name, args) {
    var t = window.__mcpTools.filter(function (x) { return x.name === name; })[0];
    if (!t) throw new Error('no such tool: ' + name);
    var r = await t.execute(args || {});
    return JSON.parse(r.content[0].text);
  };
`;

// VERIFY_URL=https://chiptunes.app runs this against the DEPLOYED site rather
// than the local build. A gate that only ever sees dist/ cannot tell you that
// the thing judges will open works, and every WebMCP bug so far has been about
// what the browser really receives.
const LIVE = process.env.VERIFY_URL || '';

(async () => {
  const h = LIVE ? { s: { close() {} }, port: 0 } : await server();
  const BASE = LIVE || `http://127.0.0.1:${h.port}`;
  if (LIVE) console.log('  ..     against ' + LIVE);
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.addInitScript(SHIM);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(4000);

  const reg = await p.evaluate(() => ({
    where: window.chiptunes && window.chiptunes.webmcp,
    count: (window.__mcpTools || []).length,
    names: (window.__mcpTools || []).map(t => t.name),
    err: window.chiptunes && window.chiptunes.webmcpError || null,
    pre: window.__ctWebmcpPre ? { count: window.__ctWebmcpPre.count, where: window.__ctWebmcpPre.where } : null
  }));
  ok(/^document\.modelContext\.registerTool/.test(reg.where || ''),
     'the tools register on document.modelContext, which is the surface the spec defines (' + reg.where + ')');
  ok(reg.count === 15, 'and all of them arrive, exactly once each (' + reg.count + ' tools)' + (reg.err ? ' -- ' + reg.err : ''));
  ok(reg.pre && reg.pre.count === 15,
     'the PRE-HYDRATION registrar got there first, before the deferred bundle ran (' +
     (reg.pre ? reg.pre.count + ' via ' + reg.pre.where.join(', ') : 'it did not run') + ')');

  // SCHEMAS. `type`, `properties` and `additionalProperties` are all required;
  // a malformed inputSchema is the most common way a registration is dropped
  // without a word from anybody.
  const schemas = await p.evaluate(() => (window.__mcpTools || []).map(t => ({
    name: t.name,
    type: t.inputSchema && t.inputSchema.type,
    props: !!(t.inputSchema && t.inputSchema.properties),
    addl: t.inputSchema && t.inputSchema.additionalProperties
  })));
  const wrong = schemas.filter(s => s.type !== 'object' || !s.props || s.addl !== false).map(s => s.name);
  ok(!wrong.length, 'every schema declares type, properties AND additionalProperties' +
     (wrong.length ? ' -- ' + wrong.join(', ') : ''));

  // Every descriptor has to be well formed, or an agent cannot call it.
  const shapes = await p.evaluate(() => (window.__mcpTools || []).map(t => ({
    name: t.name,
    hasDesc: typeof t.description === 'string' && t.description.length > 40,
    schema: t.inputSchema && t.inputSchema.type === 'object',
    exec: typeof t.execute === 'function'
  })));
  const bad = shapes.filter(s => !s.hasDesc || !s.schema || !s.exec).map(s => s.name);
  ok(!bad.length, 'every tool has a real description, an object input schema and an execute' +
     (bad.length ? ' -- ' + bad.join(', ') : ''));

  // ---- and now actually use them, as an agent would -------------------
  // The order below IS a session: find out what is possible, ask for something,
  // check it landed, offer alternatives, take it away.
  const caps = await p.evaluate(() => window.__mcpCall('chiptunes_capabilities'));
  ok(caps.scenes && caps.scenes.length >= 10 && caps.titles && caps.titles.length >= 100,
     'capabilities publishes the vocabulary rather than making an agent guess (' +
     caps.scenes.length + ' scenes, ' + caps.titles.length + ' titles)');

  const asked = await p.evaluate(() =>
    window.__mcpCall('chiptunes_ask', { text: 'a dungeon theme like Castlevania, 40 seconds, no drums' }));
  ok(asked.ok && asked.playing, 'ask composes from a sentence and puts it on the deck');
  ok((asked.applied || []).some(x => /Castlevania/.test(x)) &&
     (asked.applied || []).some(x => /scene: cave/.test(x)),
     'and reports what it understood (' + (asked.applied || []).slice(0, 2).join(' | ') + ')');
  ok(typeof asked.document === 'string' && asked.document.length > 20,
     'and hands back the whole song as a document');

  // The measurement loop: an agent cannot listen, so it has to be able to check.
  const an = await p.evaluate(() => window.__mcpCall('chiptunes_analyse'));
  ok(an && an.bpm > 0 && an.melody, 'analyse measures what is on air (' + an.bpm + ' bpm, ' +
     an.mode + ', ' + (an.melody.n) + ' melody notes)');

  const refused = await p.evaluate(() => window.__mcpCall('chiptunes_ask', { text: 'a waltz with vocals' }));
  ok(!refused.ok && /cannot/i.test(refused.error || ''),
     'and a request the machine cannot meet comes back as a reason, not a shrug (' +
     String(refused.error || '').slice(0, 60) + ')');

  // The thing that is cheap here and expensive everywhere else.
  const many = await p.evaluate(() => window.__mcpCall('chiptunes_variations', { scene: 'boss', seconds: 30, n: 12 }));
  ok(many.ok && many.options.length === 12, 'variations returns twelve complete songs (' + many.options.length + ')');
  ok(many.tookMs != null && many.tookMs < 4000,
     'in ' + many.tookMs + 'ms, in the page, with nothing uploaded and nothing metered');
  ok(new Set(many.options.map(o => o.document)).size === 12, 'and they are twelve DIFFERENT songs');
  ok(many.options.every(o => o.character && o.character.bpm !== undefined || o.bpm),
     'each carrying its own measurements, so an agent can choose without listening');

  const put = await p.evaluate(o => window.__mcpCall('chiptunes_play_song', { document: o }),
                               many.options[3].document);
  ok(put.ok, 'and any one of them can be put on the deck');

  const link = await p.evaluate(() => window.__mcpCall('chiptunes_export', { format: 'link' }));
  ok(link.ok && /#s=/.test(link.url || ''), 'export hands back a share link carrying the whole song');
  const rom = await p.evaluate(() => window.__mcpCall('chiptunes_export', { format: 'rom' }));
  ok(rom.ok && rom.bytes > 1000, 'and builds a real cartridge in the page (' + rom.bytes + ' bytes)');
  const midi = await p.evaluate(() => window.__mcpCall('chiptunes_export', { format: 'midi' }));
  ok(midi.ok && midi.bytes > 100, 'and a MIDI file (' + midi.bytes + ' bytes)');

  // Operating the session, which is the other half of the job.
  const np = await p.evaluate(() => window.__mcpCall('chiptunes_now_playing'));
  ok(np && np.title !== undefined, 'now_playing reports the session an agent is sharing with the user');
  const scr = await p.evaluate(() => window.__mcpCall('chiptunes_screen', { mode: 'dmg' }));
  ok(scr.ok, 'and the display can be changed');

  // A tool must never throw at the agent: a thrown error reads as a broken page.
  const boom = await p.evaluate(async () => {
    const t = window.__mcpTools.filter(x => x.name === 'chiptunes_play_song')[0];
    try {
      const raw = await t.execute({ document: 'not-a-song' });
      return { threw: false, isError: raw.isError, body: JSON.parse(raw.content[0].text) };
    } catch (e) { return { threw: true, e: String(e) }; }
  });
  ok(!boom.threw && boom.body && boom.body.ok === false,
     'a bad argument comes back as a returned error, not an exception');
  // ...and MARKED as an error, so the model can tell a failure from an answer
  // instead of reading '{"ok":false}' as a successful result.
  ok(boom.isError === true, 'and the result carries isError:true');

  // ---- /webmcp: the route a judge actually lands on -------------------
  // It must be the REAL app, or the tools register somewhere no agent looks.
  const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(String(e).slice(0, 160)));
  await p2.addInitScript(SHIM);
  await p2.goto(BASE + '/webmcp', { waitUntil: 'domcontentloaded' });
  await wait(4500);
  const demo = await p2.evaluate(() => ({
    panel: !!document.getElementById('wmcp'),
    cards: document.querySelectorAll('#wmcp .card').length,
    buttons: document.querySelectorAll('#wmcp button.b').length,
    prompts: document.querySelectorAll('#wmcp .prompt').length,
    webmcp: window.chiptunes && window.chiptunes.webmcp,
    registered: (window.__mcpTools || []).length,
    heading: (document.querySelector('#wmcp h1') || {}).textContent || ''
  }));
  ok(demo.panel && demo.heading.length > 10, 'the /webmcp route mounts the explainer ("' + demo.heading + '")');
  ok(demo.registered >= 15 && /^document\.modelContext/.test(demo.webmcp || ''),
     'AND is the real app, so the tools register where an agent will look (' +
     demo.registered + ' on ' + demo.webmcp + ')');
  ok(demo.cards >= 15, 'it lists every tool from the live surface (' + demo.cards + ')');
  ok(demo.prompts >= 4 && demo.buttons >= 8,
     'with prompts to copy and buttons that call the tools (' + demo.prompts + ' prompts, ' + demo.buttons + ' buttons)');

  // The panel has to work for somebody with NO WebMCP browser, which is most
  // people and possibly a judge in a hurry.
  await p2.evaluate(() => {
    document.querySelector('#wmcp input.t').value = 'a happy shop theme, 20 seconds';
    document.querySelector('#wmcp button.b.p').click();
  });
  await wait(6000);
  const panelOut = await p2.evaluate(() => (document.querySelector('#wmcp pre.out') || {}).textContent || '');
  ok(/"ok": true/.test(panelOut) && /scene: shop/.test(panelOut),
     'and calling a tool from the panel really composes (' + panelOut.slice(0, 60).replace(/\n/g, ' ') + ')');

  // ---- AGENT MODE: the explainer yields to the instrument --------------
  // A chat-bearing agent browser already has the explanation; what the person
  // wants then is to see and hear the thing. And the demotion is a DEFAULT, set
  // once -- a host appearing later must not snatch the panel away from someone
  // who asked for it.
  {
    const agent = await b.newPage({ viewport: { width: 1200, height: 860 } });
    await agent.addInitScript(SHIM);
    await agent.goto(BASE + '/webmcp', { waitUntil: 'domcontentloaded' });
    await wait(4500);
    const st = await agent.evaluate(() => ({
      mini: document.getElementById('wmcp').classList.contains('mini'),
      bar: (document.querySelector('#wmcp .bar') || {}).textContent || '',
      width: Math.round(document.querySelector('#wmcp .bar').getBoundingClientRect().width),
      landing: document.body.classList.contains('awaiting-mood'),
      url: location.pathname + location.hash
    }));
    ok(st.mini && /Agent driving/.test(st.bar),
       'with a host present the explainer demotes to a bar (' + st.bar.trim() + ')');
    ok(st.width < 500, 'which does not span the page (' + st.width + 'px)');
    // /webmcp is not a route runtime.js knows, so the station never entered its
    // landing state -- in agent mode that left a person staring at nothing.
    ok(st.landing && st.url === '/#webmcp',
       'and the station behind it is in its normal landing state (' + st.url + ')');
    const reopened = await agent.evaluate(() => {
      document.querySelector('#wmcp .bar button').click();
      return !document.getElementById('wmcp').classList.contains('mini');
    });
    ok(reopened, 'a person can still ask for the explainer');
    await agent.close();
  }

  const closed = await p2.evaluate(() => {
    document.querySelector('#wmcp .x').click();
    return { gone: !document.getElementById('wmcp'), path: location.pathname };
  });
  ok(closed.gone && closed.path === '/', 'and it closes onto the station, which was playing underneath all along');
  ok(!errs2.length, 'no page errors on /webmcp' + (errs2.length ? ' -- ' + errs2[0] : ''));

  // AGENT WORK HAS TO BE VISIBLE. A person watching should never have the music
  // change under them with no explanation, and in a demo nobody can tell a tool
  // call apart from a coincidence unless the page says so.
  const toast = await p.evaluate(async () => {
    const t = window.__mcpTools.filter(x => x.name === 'chiptunes_screen')[0];
    await t.execute({ mode: 'nes' });
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('rtoast');
    return el && el.classList.contains('show') ? el.textContent : '';
  });
  ok(/agent/.test(toast), 'an agent-driven call says so on screen (' + toast + ')');
  // ...and a human clicking in the page is NOT announced as an agent.
  const human = await p.evaluate(async () => {
    document.getElementById('rtoast').classList.remove('show');
    window.chiptunes.call('chiptunes_screen', { mode: 'dmg' });
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('rtoast');
    return el && el.classList.contains('show') ? el.textContent : '';
  });
  ok(!/agent/.test(human), 'while the same call made by a person is not (' + (human || 'nothing shown') + ')');

  // ---- ORIENTATION, ON A COLD PAGE ------------------------------------
  // The tool an agent calls FIRST, before the bundle has run. An introduction
  // that replies "still loading" is a worse greeting than silence, so it is
  // answered by the inline registrar from a constant and depends on nothing.
  {
    const intro = await p.evaluate(async () => {
      const t = window.__mcpTools.filter(x => x.name === 'what_can_i_do_here')[0];
      const raw = await t.execute({});
      return { isError: raw.isError, text: raw.content[0].text };
    });
    ok(!intro.isError && /Chiptunes/.test(intro.text) && intro.text.length > 400,
       'what_can_i_do_here introduces the page in prose (' + intro.text.length + ' chars)');
    ok(/chiptunes_ask/.test(intro.text) && /chiptunes_analyse/.test(intro.text),
       'and every capability it names maps to a tool that exists');
    const names = await p.evaluate(() => (window.__mcpTools || []).map(t => t.name));
    const promised = (intro.text.match(/chiptunes_[a-z_]+/g) || []);
    const missing = promised.filter(n => names.indexOf(n) < 0);
    ok(!missing.length, 'with nothing promised that is not registered' +
       (missing.length ? ' -- ' + missing.join(', ') : ''));
  }

  // ---- A HOST THAT ARRIVES LATE ---------------------------------------
  // The closest thing to ChatGPT's browser that can be automated, and the same
  // window that lets a person paste a mock context into the console. No model
  // context at load; one appears afterwards; the polling must find it.
  {
    const late = await b.newPage({ viewport: { width: 1200, height: 800 } });
    await late.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await wait(3000);
    const before = await late.evaluate(() => window.chiptunes && window.chiptunes.webmcp);
    ok(!before, 'with no host at load, nothing is registered (' + String(before) + ')');
    await late.evaluate(() => {
      window.__late = [];
      navigator.modelContext = { registerTool: t => { window.__late.push(t); return {}; } };
    });
    await wait(1500);
    const after = await late.evaluate(() => ({
      n: window.__late.length, where: window.chiptunes && window.chiptunes.webmcp
    }));
    ok(after.n >= 15 && /navigator/.test(after.where || ''),
       'and a host injected AFTER load is picked up within a second and a half (' +
       after.n + ' tools on ' + after.where + ')');
    const worked = await late.evaluate(async () => {
      const t = window.__late.filter(x => x.name === 'chiptunes_ask')[0];
      const raw = await t.execute({ text: 'a calm town theme, 20 seconds' });
      return JSON.parse(raw.content[0].text);
    });
    ok(worked.ok && /scene: town/.test((worked.applied || []).join(' ')),
       'and its tools really work, not just register');
    await late.close();
  }

  ok(!errs.length, 'no page errors throughout' + (errs.length ? ' -- ' + errs[0] : ''));

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-webmcp: ' + fail + ' FAILED'
                   : '\nverify-webmcp: an agent can drive the page');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
