// The station's songs and the editor's songs are the same songs.
//
// The composer writes a Score; Create turns it into a document; the chip plays
// the document. That claim only means something if the document really holds
// what the composer wrote -- if it quantised the music on the way in, "edit
// what you are hearing" would open something else, and the whole merge would be
// a polite fiction. So: generate songs, materialise them, and compare note for
// note. Then check the document survives being written down and read back.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
  // Nothing plays until asked: pick a mood, which is the station's entry now.
  const startStation = async (pg) => {
    await pg.evaluate(() => {
      const b = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'chill');
      if (b) b.click();
    });
    await pg.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
  };
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

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1380, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(4000);

  // ---- 1. a composed song survives becoming a document ---------------------
  const fidelity = await p.evaluate(() => {
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const score = CT_COMPOSERS.rrr_core.compile('doc-gate-' + i);
      const t0 = performance.now();
      const doc = CT_CREATE.songFrom(score);
      const ms = performance.now() - t0;
      if (!doc || !doc.gb) { rows.push({ err: 'no document' }); continue; }
      const src = score.gb.notes, got = doc.gb.notes, used = new Set();
      let exact = 0;
      src.forEach(w => {
        for (let j = 0; j < got.length; j++) {
          if (used.has(j)) continue;
          const g = got[j];
          if ((g.ch | 0) === (w.ch | 0) &&
              (g.midi == null ? -1 : g.midi) === (w.midi == null ? -1 : w.midi) &&
              (g.frame | 0) === (w.frame | 0)) { used.add(j); exact++; break; }
        }
      });
      rows.push({ src: src.length, got: got.length, pct: 100 * exact / src.length, ms: +ms.toFixed(1),
                  bars: doc.bars, kb: +(doc.code.length / 1024).toFixed(1) });
    }
    return rows;
  });
  const good = fidelity.filter(r => !r.err);
  const pcts = good.map(r => r.pct);
  const worst = Math.min(...pcts), avg = pcts.reduce((a, c) => a + c, 0) / pcts.length;
  ok(good.length === fidelity.length, 'every song became a document (' + good.length + '/' + fidelity.length + ')');
  ok(worst > 95, 'the worst song keeps ' + worst.toFixed(1) + '% of its notes on the exact frame');
  ok(avg > 97, 'the average is ' + avg.toFixed(1) + '%');
  console.log('         (' + good.map(r => r.pct.toFixed(0) + '%').join(' ') + ')');
  const slowest = Math.max(...good.map(r => r.ms));
  ok(slowest < 60, 'materialising a song costs ' + slowest.toFixed(1) + 'ms at worst');
  console.log('         songs ran ' + Math.min(...good.map(r => r.bars)) + '-' + Math.max(...good.map(r => r.bars)) +
              ' bars, documents ' + Math.min(...good.map(r => r.kb)) + '-' + Math.max(...good.map(r => r.kb)) + ' KB');

  // ---- 2. the document survives being written down and read back ----------
  const trip = await p.evaluate(() => {
    const score = CT_COMPOSERS.rrr_core.compile('doc-gate-roundtrip');
    const doc = CT_CREATE.songFrom(score);
    location.hash = '#s=' + doc.code;
    return { code: doc.code, notes: doc.gb.notes.map(n => [n.frame, n.ch, n.midi, n.frames].join(':')).join(',') };
  });
  await p.goto(`http://127.0.0.1:${h.port}/create#s=${trip.code}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#createscreen.show'), null, { timeout: 40000 });
  await wait(3200);
  const back = await p.evaluate(() => {
    const s = CT_CREATE._score();
    return s.notes.map(n => [n.frame, n.ch, n.midi, n.frames].join(':')).join(',');
  });
  ok(back === trip.notes, 'the document opens in the editor as the same song, note for note');

  // ---- 3. and the station is playing one ----------------------------------
  await p.goto(`http://127.0.0.1:${h.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3500);
  await startStation(p);
  await wait(4000);
  // a single reading of a peak meter catches the gap between notes; watch it
  const onAir = await p.evaluate(async () => {
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      peak = Math.max(peak, Audio.outputProbe().peak);
      if (peak > 0.02) break;
      await new Promise(r => setTimeout(r, 200));
    }
    return { doc: (Audio.currentDoc && Audio.currentDoc()) || null, peak, route: location.pathname };
  });
  ok(!!onAir.doc, 'the song on air has a document behind it' + (onAir.doc ? ' (' + (onAir.doc.length / 1024).toFixed(1) + ' KB)' : ''));
  ok(onAir.peak > 0.02, 'and it is sounding (' + onAir.peak.toFixed(3) + ')');
  ok(onAir.route === '/', 'the address bar stays at the permanent root (' + onAir.route + ')');
  // Written briefs and the mood chips must drive the same document machinery.
  await p.evaluate(() => {
    localStorage.setItem('ct-create-tour', '1');
    CT_CREATE.openBlank();
    Song.mint = () => 'create-prompt-check';
  });
  await p.getByRole('textbox', { name: 'Describe your song' }).fill('a dreamy cave in D minor, no drums');
  await p.getByRole('button', { name: 'Write song', exact: true }).click();
  await p.waitForFunction(() => {
    const st = CT_CREATE.docState(location.hash.slice(3));
    return st && st.key === 2 && document.querySelector('.n-prompt-result').textContent.includes('key: D');
  });
  const promptState = await p.evaluate(() => {
    const code = location.hash.slice(3);
    const st = CT_CREATE.docState(code);
    const notes = CT_API.toJSON(code).notes;
    return { code, key: st.key, bpm: st.bpm,
      expected: CT_API.ask('a dreamy cave in D minor, no drums', { brief: { token: 'create-prompt-check' } }).doc,
      drums: notes.filter(n => n.lane === 'Drums').length,
      label: +document.querySelector('.n-bpmval').textContent,
      slider: +document.querySelector('[data-cr="bpm"]').value,
      reading: document.querySelector('.n-prompt-result').textContent };
  });
  ok(promptState.code === promptState.expected, 'Create submits the written brief through the shared interpreter');
  ok(promptState.key === 2 && promptState.drums === 0, 'the requested key and missing drums reach the document');
  ok(promptState.label === promptState.bpm && promptState.slider === promptState.bpm,
    'the tempo label and slider show the transformed tempo, including odd BPM');
  ok(promptState.reading.includes('Read as:') && promptState.reading.includes('key: D'),
    'Create visibly explains how it read the prompt');
  await p.getByRole('textbox', { name: 'Describe your song' }).fill('glorb blarg');
  await p.getByRole('button', { name: 'Write song', exact: true }).click();
  const rejected = await p.evaluate(() => ({ code: location.hash.slice(3),
    message: document.querySelector('.n-prompt-result').textContent }));
  ok(rejected.code === promptState.code && rejected.message.includes('did not recognise'),
    'an unrecognized prompt reports failure without replacing the current song');
  ok(!errs.length, 'no page errors' + (errs.length ? ' -- ' + errs[0] : ''));

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-song-document: ' + fail + ' FAILED'
                   : '\nverify-song-document: the station and the editor play the same songs');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
