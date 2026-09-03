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

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.addInitScript(SHIM);
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(4000);

  const reg = await p.evaluate(() => ({
    where: window.chiptunes && window.chiptunes.webmcp,
    count: (window.__mcpTools || []).length,
    names: (window.__mcpTools || []).map(t => t.name),
    err: window.chiptunes && window.chiptunes.webmcpError || null
  }));
  ok(/^document\.modelContext\.registerTool$/.test(reg.where || ''),
     'the tools register on document.modelContext, which is the surface the spec defines (' + reg.where + ')');
  ok(reg.count >= 14, 'and all of them arrive (' + reg.count + ' tools)' + (reg.err ? ' -- ' + reg.err : ''));

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
  const boom = await p.evaluate(() => window.__mcpCall('chiptunes_play_song', { document: 'not-a-song' })
    .then(r => ({ threw: false, r })).catch(e => ({ threw: true, e: String(e) })));
  ok(!boom.threw && boom.r && boom.r.ok === false,
     'a bad argument comes back as a returned error, not an exception');

  // ---- /webmcp: the route a judge actually lands on -------------------
  // It must be the REAL app, or the tools register somewhere no agent looks.
  const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(String(e).slice(0, 160)));
  await p2.addInitScript(SHIM);
  await p2.goto(`http://127.0.0.1:${h.port}/webmcp`, { waitUntil: 'domcontentloaded' });
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
  ok(demo.registered >= 14 && /^document\.modelContext/.test(demo.webmcp || ''),
     'AND is the real app, so the tools register where an agent will look (' +
     demo.registered + ' on ' + demo.webmcp + ')');
  ok(demo.cards >= 14, 'it lists every tool from the live surface (' + demo.cards + ')');
  ok(demo.prompts >= 4 && demo.buttons >= 8,
     'with prompts to copy and buttons that call the tools (' + demo.prompts + ' prompts, ' + demo.buttons + ' buttons)');

  // The panel has to work for somebody with NO WebMCP browser, which is most
  // people and possibly a judge in a hurry.
  await p2.evaluate(() => {
    document.querySelector('#wmcp input.t').value = 'a happy shop theme, 20 seconds';
    document.querySelector('#wmcp button.b.p').click();
  });
  await wait(6000);
  const panelOut = await p2.evaluate(() => (document.querySelector('#wmcp pre') || {}).textContent || '');
  ok(/"ok": true/.test(panelOut) && /scene: shop/.test(panelOut),
     'and calling a tool from the panel really composes (' + panelOut.slice(0, 60).replace(/\n/g, ' ') + ')');

  const closed = await p2.evaluate(() => {
    document.querySelector('#wmcp .x').click();
    return { gone: !document.getElementById('wmcp'), path: location.pathname };
  });
  ok(closed.gone && closed.path === '/', 'and it closes onto the station, which was playing underneath all along');
  ok(!errs2.length, 'no page errors on /webmcp' + (errs2.length ? ' -- ' + errs2[0] : ''));

  ok(!errs.length, 'no page errors throughout' + (errs.length ? ' -- ' + errs[0] : ''));

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-webmcp: ' + fail + ' FAILED'
                   : '\nverify-webmcp: an agent can drive the page');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
