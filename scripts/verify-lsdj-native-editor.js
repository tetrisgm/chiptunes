// REAL USER-FACING NATIVE EDITING, DRIVEN THROUGH THE ACTUAL DOM.
//
// Node: the NativeDocument.setBytes transaction (compared against the ACTUAL
// base bytes). Playwright with real keyboard + fill/click: modal isolation
// (Tab-trap boundary both directions, Create inert then restored, Space stays
// paused with a real diagnostic, Escape from a focused input), atomic row edit
// that PRESERVES other staged rows, draft survival across navigation/close +
// Resume, exact export offsets with retained header, whole-.sav preservation,
// fresh-page JSON open, malformed-JSON and cyclic-.lsdsng rejection without
// hanging or losing the current document, and slow-A/fast-B last-import-wins via
// a controlled FileReader. Screenshots go to a unique temp dir.
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LSDJ = require(path.join(ROOT, 'src', 'lsdj.js'));
const NDOC = require(path.join(ROOT, 'src', 'lsdj-native-document.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const threw = fn => { try { fn(); return false; } catch (e) { return true; } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-native-'));

const O = LSDJ.OFFSETS;
const T0 = LSDJ.FIELDS.find(f => f.k === 'tables0').at;
const SENTINEL = 0x1700;

function lsdsngFixture(nameBytes, version) {
  const song = Uint8Array.from(LSDJ.emptySong()); song[SENTINEL] = 0xAB;
  const body = LSDJ.compress(song, 1);
  const file = new Uint8Array(9 + body.length);
  file.set(nameBytes.subarray(0, 8), 0); file[8] = version & 0xFF; file.set(body, 9);
  return { file, song };
}
function cyclicLsdsng() {                                  // SA -> block 1 (self): a hang trap
  const file = new Uint8Array(13); file.set([0x66, 0, 0, 0, 0, 0, 0, 0], 0); file[8] = 0;
  file[9] = 0xE0; file[10] = 0x01; file[11] = 0xE0; file[12] = 0x01; return file;
}
function malformedLsdsngs() {
  // 128 * 255 + 128 = 32768 decoded zero bytes, all in one physical block.
  // Hand-written streams keep these corruptions independent of the compressor.
  const full = [...Array.from({ length: 128 }, () => [0xC0, 0, 255]).flat(), 0xC0, 0, 128];
  const wrap = body => Uint8Array.from([...new Uint8Array(9), ...body]);
  return { earlyEOF: wrap([0, 0xE0, 0xFF]), overflow: wrap([...full, 0, 0xE0, 0xFF]), missingEOF: wrap(full) };
}
function savFixture() {
  const song = Uint8Array.from(LSDJ.emptySong()); song[SENTINEL] = 0xAB;
  const sav = new Uint8Array(0x20000); sav.set(song, 0);
  for (let k = 0x8000; k < 0x20000; k += 97) sav[k] = (k & 0xFF) ^ 0x5A;   // dense out-of-workmem content
  return { sav, song };
}
function jsonFor(mutate) {
  const d = NDOC.NativeDocument.fromSong(Uint8Array.from(LSDJ.emptySong()), { title: 'SHARED' });
  if (mutate) mutate(d); return d.serializeFull();
}
function server() {
  return new Promise(res => {
    const s = http.createServer((q, e) => {
      let rel = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '');
      let f = path.join(DIST, rel || 'index.html');
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      fs.readFile(f, (err, b) => { if (err) { e.writeHead(500); e.end(); return; }
        e.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); e.end(b); });
    });
    s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

// ---- Node: the atomic transaction, compared against the actual base ---------
(function () {
  const d = NDOC.NativeDocument.fromSong(Uint8Array.from(LSDJ.emptySong()));
  const base = d.toSong(), o1 = O.PHRASE_NOTES + 18, o2 = O.PHRASE_INSTRUMENTS + 18;
  d.setBytes([{ key: 'phraseNotes', i: 1, j: 2, value: 0x10 }, { key: 'phraseInstruments', i: 1, j: 2, value: 0x05 }]);
  ok(d.undoDepth() === 1, 'setBytes commits multiple fields as one undo entry');
  let s = d.toSong();
  ok(s[o1] === 0x10 && s[o2] === 0x05, 'setBytes wrote both bytes');
  d.undo(); s = d.toSong();
  ok(s[o1] === base[o1] && s[o2] === base[o2], 'one undo reverts the whole transaction to the actual base bytes');
  ok(threw(() => d.setBytes([{ key: 'phraseNotes', i: 1, j: 2, value: 5 }, { key: 'phraseNotes', i: 1, j: 2, value: 6 }])), 'duplicate targets rejected');
  ok(threw(() => d.setBytes([{ key: 'phraseNotes', i: 1, j: 2, value: 300 }])), 'an invalid byte is rejected atomically');
  ok(threw(() => d.setBytes(new Array(40000).fill({ key: 'phraseNotes', i: 0, j: 0, value: 0 }))), 'an over-length transaction is bounded/rejected');
  ok(d.toSong()[o1] === base[o1], 'a rejected transaction mutated nothing');
  for (const [name, bytes] of Object.entries(malformedLsdsngs())) {
    ok(threw(() => LSDJ.decompress(bytes.subarray(9), 1)), name + ': shared decoder rejects malformed stream');
    ok(threw(() => LSDJ.parseLsdsng(bytes)), name + ': shared .lsdsng parser rejects malformed stream');
  }
})();

const setCat = (p, label) => p.getByRole('tab', { name: label, exact: true }).click();
const setSlot = async (p, n) => { await p.locator('#nativeeditor .ne-slot').fill(String(n)); };
const cell = (p, r, c) => p.locator('#nativeeditor .ne-byte[data-row="' + r + '"][data-col="' + c + '"]');
const applyRow = (p, r) => p.locator('#nativeeditor .ne-apply[data-applyrow="' + r + '"]').click();
const nativeOpen = p => p.evaluate(() => !!document.querySelector('#nativeeditor.show'));
const focused = loc => loc.evaluate(e => e === document.activeElement);
// This dispatch tests the registered handler only, not a browser exit prompt or Safari.
const unloadPrevented = p => p.evaluate(() => {
  const ev = new Event('beforeunload', { cancelable: true });
  const allowed = window.dispatchEvent(ev);
  return !allowed && ev.defaultPrevented;
});
async function importFile(p, name, bytes) {
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(json => {
    if (json) CT_LSDJ_NATIVE_EDITOR.pickJson(); else CT_LSDJ_NATIVE_EDITOR.pick();
  }, name.endsWith('.json'))]);
  await ch.setFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream', buffer: Buffer.from(bytes) });
}
function dialogs(p, accept) {
  const seen = [];
  const handler = async d => { seen.push({ type: d.type(), message: d.message() }); if (accept) await d.accept(); else await d.dismiss(); };
  p.on('dialog', handler);
  return { seen, stop: () => p.off('dialog', handler) };
}
async function holdReads(p) {
  await p.evaluate(() => {
    const Real = window.FileReader;
    window.__nativeReads = [];
    class HeldReader {
      read(blob, method) {
        const r = new Real();
        r.onload = () => { this.result = r.result; window.__nativeReads.push(() => { if (this.onload) this.onload({ target: this }); }); };
        r.onerror = () => { if (this.onerror) this.onerror({ target: this }); };
        r[method](blob);
      }
      readAsText(blob) { this.read(blob, 'readAsText'); }
      readAsArrayBuffer(blob) { this.read(blob, 'readAsArrayBuffer'); }
    }
    window.FileReader = HeldReader;
    window.__restoreNativeReader = () => { window.FileReader = Real; };
  });
}
async function openLsdsng(p, buf) {
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), nativeAction(p,'[data-action="native-pick"]')]);
  await ch.setFiles({ name: 'fixture.lsdsng', mimeType: 'application/octet-stream', buffer: Buffer.from(buf) });
  await p.waitForFunction(() => document.querySelector('#nativeeditor.show'), null, { timeout: 15000 });
}
async function nativeAction(p,selector){
  if(await p.locator('.mw-project-tools').getAttribute('open')===null)await p.locator('.mw-project-tools>summary').click();
  if(await p.locator('.mw-native-tools').getAttribute('open')===null)await p.locator('.mw-native-tools>summary').click();
  // Isolate native dirty-state assertions from the fresh workspace's autosave.
  await p.waitForFunction(()=>JSON.parse(localStorage.getItem('ct-music-workspace-v1')||'{}').draft===CT_MUSIC_WORKSPACE.snapshot().draft);
  return p.click(selector);
}
async function focusEdges(p) {
  return p.evaluate(() => {
    const pn = document.getElementById('nativeeditor');
    const f = [...pn.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(e => e.getClientRects().length);
    return { first: f[0] === document.activeElement, last: f[f.length - 1] === document.activeElement };
  });
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('  FAIL  dist/ is not built; run the build first'); process.exit(1); }
  const nameBytes = new Uint8Array([0x66, 0x69, 0x78, 0x21, 0, 0, 0, 0]);   // 'fix!' -> distinct from projName()
  const fx = lsdsngFixture(nameBytes, 0x03);
  const sv = savFixture();
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  // ---- desktop: keyboard modality, staging, exports, races ----------------
  {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await wait(1000);
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });

    await openLsdsng(p, fx.file);
    ok(/not implemented/i.test(await p.evaluate(() => document.querySelector('#nativeeditor .ne-banner').textContent)), 'the panel states native playback is not implemented');
    ok(await p.getByRole('tab', { name: 'Song', exact: true }).count() === 1 && await p.getByRole('tab', { name: 'Alloc', exact: true }).count() === 1, 'scalar (Song) and allocation (Alloc) categories are reachable');
    ok(await p.locator('#nativeeditor .ne-byte').first().isVisible(), 'visible byte-grid controls are rendered');
    ok(await p.evaluate(() => document.getElementById('musicworkspace').hasAttribute('inert')), 'Create is inert while the native panel is open');

    // Tab-trap boundary, both directions
    await p.evaluate(() => { const pn = document.getElementById('nativeeditor'); const f = [...pn.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(e => e.getClientRects().length); f[f.length - 1].focus(); });
    await p.keyboard.press('Tab');
    ok((await focusEdges(p)).first, 'Tab from the last visible control wraps to the first');
    await p.evaluate(() => { const pn = document.getElementById('nativeeditor'); const f = [...pn.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(e => e.getClientRects().length); f[0].focus(); });
    await p.keyboard.press('Shift+Tab');
    ok((await focusEdges(p)).last, 'Shift+Tab from the first wraps to the last');

    // Space must not toggle Create (assert the diagnostic really exists)
    ok(await p.evaluate(() => typeof CT_CREATE._dbg === 'function'), 'the Create diagnostic exists (no fallback masking)');
    await p.getByRole('tab', { name: 'Phrases', exact: true }).focus();
    await p.keyboard.press('Space'); await wait(200);
    ok(await p.evaluate(() => CT_CREATE._dbg().playing) === false && await nativeOpen(p), 'Space does not reach Create through the modal (stays paused, panel open)');

    // atomic row edit that preserves OTHER staged rows
    await setCat(p, 'Phrases'); await setSlot(p, 3);
    await cell(p, 5, 0).fill('2A');            // stage row 5
    await cell(p, 6, 1).fill('7F');            // stage row 6 (different row)
    await applyRow(p, 5);                      // apply row 5 only
    ok(await focused(cell(p, 5, 0)), 'Apply restores keyboard focus to the applied row byte');
    ok(await cell(p, 5, 0).inputValue() === '2A', 'applying a row commits it');
    ok(await p.locator('#nativeeditor .ne-apply[data-applyrow="6"]').isEnabled() && await cell(p, 6, 1).inputValue() === '7F',
       'applying one row PRESERVES the other staged row (no data loss)');
    await applyRow(p, 6);

    // draft survives category navigation
    await cell(p, 8, 0).fill('4D');
    await setCat(p, 'Groove'); await setCat(p, 'Phrases'); await setSlot(p, 3);
    ok(await cell(p, 8, 0).inputValue() === '4D' && await p.locator('#nativeeditor tr[data-row="8"]').getAttribute('class').then(c => /staged/.test(c)),
       'an uncommitted edit survives category navigation');

    // more committed edits for the export check, then undo/redo
    await setCat(p, 'Instruments'); await setSlot(p, 2); await cell(p, 7, 0).fill('C0'); await applyRow(p, 7);
    await setCat(p, 'Tables'); await setSlot(p, 1); await cell(p, 4, 0).fill('0C'); await applyRow(p, 4);
    await p.click('#nativeeditor .ne-undo'); await wait(120);
    ok(await cell(p, 4, 0).inputValue() === '00', 'undo reverts the last applied row');
    await p.click('#nativeeditor .ne-redo'); await wait(120);
    ok(await cell(p, 4, 0).inputValue() === '0C', 'redo re-applies it');

    // export .lsdsng: flushes the pending row (8) too, exact offsets, header retained, sentinel
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#nativeeditor .ne-exp-sng')]);
    const outBuf = new Uint8Array(fs.readFileSync(await dl.path()));
    const song = LSDJ.parseLsdsng(outBuf).song;
    const pOff = O.PHRASE_NOTES + 3 * 16 + 5, p6 = O.PHRASE_INSTRUMENTS + 3 * 16 + 6, p8 = O.PHRASE_NOTES + 3 * 16 + 8;
    const iOff = O.INSTRUMENT_PARAMS + 2 * 16 + 7, tOff = T0 + 1 * 16 + 4;
    ok(song[pOff] === 0x2A && song[p6] === 0x7F && song[p8] === 0x4D && song[iOff] === 0xC0 && song[tOff] === 0x0C,
       'export flushes pending edits and writes every intended offset');
    ok(song[SENTINEL] === 0xAB, 'the unmapped sentinel survives export');
    ok([...outBuf.slice(0, 8)].join(',') === [...nameBytes].join(',') && outBuf[8] === 0x03, 'the original name + version bytes are retained on export');

    // native JSON, malformed rejection, cyclic .lsdsng rejection (no hang, doc kept)
    const [dlj] = await Promise.all([p.waitForEvent('download'), p.click('#nativeeditor .ne-exp-json')]);
    const jtxt = fs.readFileSync(await dlj.path(), 'utf8');
    ok(/"mode":"full"/.test(jtxt), 'the native share is a standalone full document');
    await setCat(p, 'Phrases'); await setSlot(p, 3);
    const keep = await cell(p, 5, 0).inputValue();
    const [cbad] = await Promise.all([p.waitForEvent('filechooser'), p.click('#nativeeditor .ne-imp-json')]);
    await cbad.setFiles({ name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(jtxt.replace(/"song":"./, '"song":"@')) });
    await wait(300);
    ok(await nativeOpen(p) && await cell(p, 5, 0).inputValue() === keep, 'a malformed native JSON is rejected without losing the current document');
    const [ccyc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => CT_LSDJ_NATIVE_EDITOR.pick())]);
    await ccyc.setFiles({ name: 'cyclic.lsdsng', mimeType: 'application/octet-stream', buffer: Buffer.from(cyclicLsdsng()) });
    await wait(500);
    await setCat(p, 'Phrases'); await setSlot(p, 3);
    ok(await nativeOpen(p) && await cell(p, 5, 0).inputValue() === keep, 'a cyclic .lsdsng is rejected without hanging or losing the document');

    // slow-A / fast-B: last-requested import wins (controlled FileReader)
    const raceDialogs = dialogs(p, true); // replacing the intentionally edited document is intended here
    await p.evaluate(() => {
      const Real = window.FileReader; let n = 0;
      function Fake() { this._r = new Real(); this.onload = null; this.onerror = null; this.result = null; }
      Fake.prototype.readAsText = function (blob) { const self = this, delay = (++n === 1) ? 400 : 20, r = this._r;
        r.onload = function () { self.result = r.result; setTimeout(function () { if (self.onload) self.onload({ target: self }); }, delay); };
        r.onerror = function () { if (self.onerror) self.onerror({ target: self }); }; r.readAsText(blob); };
      Fake.prototype.readAsArrayBuffer = function (blob) { const self = this, r = this._r;
        r.onload = function () { self.result = r.result; if (self.onload) self.onload({ target: self }); };
        r.onerror = function () { if (self.onerror) self.onerror({ target: self }); }; r.readAsArrayBuffer(blob); };
      window.FileReader = Fake;
    });
    const jA = jsonFor(d => d.setPhraseNote(0, 0, 0x41)), jB = jsonFor(d => d.setPhraseNote(0, 0, 0x42));
    const [ca] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => CT_LSDJ_NATIVE_EDITOR.pickJson())]);
    await ca.setFiles({ name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(jA) });
    const [cb] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => CT_LSDJ_NATIVE_EDITOR.pickJson())]);
    await cb.setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(jB) });
    await wait(800);
    await setCat(p, 'Phrases'); await setSlot(p, 0);
    ok(await cell(p, 0, 0).inputValue() === '42', 'slow-A/fast-B: the last-requested import wins and the late slow read is discarded');
    ok(raceDialogs.seen.length === 1 && raceDialogs.seen[0].type === 'confirm' && /replace/i.test(raceDialogs.seen[0].message),
       'slow-A/fast-B explicitly accepts exactly one intended replacement confirmation');
    raceDialogs.stop();

    const shotD = path.join(TMP, 'desktop.png'); await p.screenshot({ path: shotD }); console.log('  screenshot (desktop): ' + shotD);
    ok(!errs.length, 'no page errors on desktop' + (errs.length ? ' -- ' + errs[0] : ''));
    await p.close();
  }

  // ---- draft survives close, Resume brings it back; inert restored; Escape from input
  {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await wait(800); await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    await openLsdsng(p, fx.file);
    await setCat(p, 'Phrases'); await setSlot(p, 3);
    await cell(p, 2, 0).fill('11'); await applyRow(p, 2);       // committed
    await cell(p, 9, 0).fill('EE');                            // staged, uncommitted
    await cell(p, 9, 0).focus();
    await p.keyboard.press('Escape');                          // Escape from a focused input
    await wait(300);
    ok(!await nativeOpen(p) && await p.evaluate(() => !!document.querySelector('#musicworkspace:not([hidden])')), 'Escape from a focused input closes only the native panel; Create stays open');
    ok(!await p.evaluate(() => document.getElementById('musicworkspace').hasAttribute('inert')), 'Create is no longer inert after closing');
    ok(await p.evaluate(() => CT_MUSIC_WORKSPACE.snapshot().playing === null), 'closing did not start playback');
    await nativeAction(p,'[data-action="native-resume"]');
    await p.waitForFunction(() => document.querySelector('#nativeeditor.show'), null, { timeout: 10000 });
    await setCat(p, 'Phrases'); await setSlot(p, 3);
    ok(await cell(p, 2, 0).inputValue() === '11' && await cell(p, 9, 0).inputValue() === 'EE', 'Resume reopens the in-progress edit with committed AND staged values intact');
    await p.close();
  }

  // ---- replacement: pending, applied, and both, including a closed panel --
  for (const edits of ['applied', 'pending', 'both']) for (const closed of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    await openLsdsng(p, fx.file);
    ok(!await unloadPrevented(p), 'clean imported document does not prevent dispatched beforeunload');
    await setCat(p, 'Phrases'); await setSlot(p, 0);
    const base0 = await cell(p, 0, 0).inputValue(), base1 = await cell(p, 1, 0).inputValue();
    if (edits !== 'pending') { await cell(p, 0, 0).fill('21'); await applyRow(p, 0); }
    if (edits !== 'applied') await cell(p, 1, 0).fill('22');
    const label = edits + (closed ? ', closed' : ', open');
    if (closed) await p.click('#nativeeditor .ne-close');
    ok(await unloadPrevented(p), label + ': dirty document prevents dispatched beforeunload (handler only)');
    const cancel = dialogs(p, false);
    await importFile(p, 'replacement.json', jsonFor(d => d.setPhraseNote(0, 0, 0x43)));
    await p.waitForFunction(() => /Replacement cancelled/i.test(document.querySelector('#nativeeditor .ne-status').textContent), null, { timeout: 5000 });
    cancel.stop();
    ok(cancel.seen.length === 1 && cancel.seen[0].type === 'confirm' && /replace/i.test(cancel.seen[0].message), label + ': cancel is an actual replacement confirmation');
    ok(await nativeOpen(p) === !closed, label + ': cancel preserves panel visibility');
    if (closed) await nativeAction(p,'[data-action="native-resume"]');
    await setCat(p, 'Phrases'); await setSlot(p, 0);
    ok(await cell(p, 0, 0).inputValue() === (edits !== 'pending' ? '21' : base0) &&
       await cell(p, 1, 0).inputValue() === (edits !== 'applied' ? '22' : base1), label + ': cancel preserves applied and pending bytes');
    ok(await p.locator('#nativeeditor .ne-undo').isEnabled() === (edits !== 'pending') &&
       await p.locator('#nativeeditor .ne-apply[data-applyrow="1"]').isEnabled() === (edits !== 'applied'), label + ': cancel preserves history and pending status');
    if (closed) await p.click('#nativeeditor .ne-close');
    const accept = dialogs(p, true);
    await importFile(p, 'replacement.json', jsonFor(d => d.setPhraseNote(0, 0, 0x43)));
    await p.waitForFunction(() => /Opened native structure from JSON/.test(document.querySelector('#nativeeditor .ne-status').textContent), null, { timeout: 5000 });
    accept.stop();
    ok(accept.seen.length === 1 && accept.seen[0].type === 'confirm', label + ': accept is an actual replacement confirmation');
    ok(await nativeOpen(p), label + ': accepted replacement opens the panel');
    await setCat(p, 'Phrases'); await setSlot(p, 0);
    ok(await cell(p, 0, 0).inputValue() === '43' && await cell(p, 1, 0).inputValue() === base1 &&
       await p.locator('#nativeeditor tr.staged').count() === 0 && await p.locator('#nativeeditor .ne-undo').isDisabled(),
       label + ': accept replaces bytes, clears old drafts and history');
    ok(!await unloadPrevented(p), label + ': replacement is clean for dispatched beforeunload');
    await p.close();
  }

  // ---- shared malformed parser, hostile draft text, atomic export, read cancellation
  {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    await importFile(p, 'fixture.sav', sv.sav);
    await p.waitForFunction(() => document.querySelector('#nativeeditor.show'));
    await setCat(p, 'Phrases');
    ok(await focused(p.getByRole('tab', { name: 'Phrases', exact: true })), 'category click retains focus on the selected tab');
    await p.keyboard.press('ArrowRight');
    ok(await focused(p.getByRole('tab', { name: 'Instruments', exact: true })) &&
       await p.getByRole('tab', { name: 'Instruments', exact: true }).getAttribute('aria-selected') === 'true',
       'keyboard category navigation selects and focuses the next tab');
    await setCat(p, 'Phrases'); await setSlot(p, 0);
    await cell(p, 0, 1).fill('31'); await p.keyboard.press('Enter');
    ok(await focused(cell(p, 0, 1)) && await cell(p, 0, 1).inputValue() === '31' &&
       await p.locator('#nativeeditor .ne-apply[data-applyrow="0"]').isDisabled(), 'Enter applies the row and preserves focus on the same column');
    await cell(p, 1, 0).fill('32');

    await p.evaluate(() => {
      const parse = CT_LSDJ.parseLsdsng;
      window.__parseCalls = 0;
      CT_LSDJ.parseLsdsng = function (...args) { window.__parseCalls++; return parse.apply(this, args); };
    });
    const malformedDialogs = dialogs(p, true); // a mistaken successful parse must not be hidden by auto-dismiss
    for (const [name, bytes] of Object.entries(malformedLsdsngs())) {
      await p.locator('#nativeeditor .ne-status').evaluate(e => { e.textContent = ''; });
      await importFile(p, name + '.lsdsng', bytes);
      await p.waitForFunction(() => document.querySelector('#nativeeditor .ne-status').textContent.length > 0, null, { timeout: 5000 });
      ok(/not a valid LSDj song/i.test(await p.locator('#nativeeditor .ne-status').textContent()), name + ': editor reports malformed song');
      await setCat(p, 'Phrases'); await setSlot(p, 0);
      ok(await nativeOpen(p) && await cell(p, 0, 1).inputValue() === '31' && await cell(p, 1, 0).inputValue() === '32' &&
         await p.locator('#nativeeditor .ne-apply[data-applyrow="1"]').isEnabled(), name + ': rejection preserves applied and pending edits');
    }
    malformedDialogs.stop();
    ok(await p.evaluate(() => window.__parseCalls) === 3, 'all three malformed imports use the shared CT_LSDJ.parseLsdsng path');
    ok(malformedDialogs.seen.length === 0, 'malformed songs never request replacement confirmation');

    // Two-character invalid values fit the real input maxlength and exercise both
    // attribute quoting and entity escaping without changing the UI constraints.
    const quoted = '\'"', markup = '&<';
    await cell(p, 2, 0).fill(quoted); await cell(p, 3, 0).fill(markup);
    const gridCount = await p.locator('#nativeeditor .ne-byte').count();
    await setSlot(p, 1); await setSlot(p, 0);
    await setCat(p, 'Groove'); await setCat(p, 'Phrases');
    ok(await cell(p, 2, 0).inputValue() === quoted && await cell(p, 3, 0).inputValue() === markup,
       'invalid quotes and markup survive slot/category navigation verbatim');
    ok(await p.locator('#nativeeditor .ne-byte').count() === gridCount &&
       await cell(p, 2, 0).evaluate(e => e.getAttribute('data-row') === '2' && e.getAttribute('data-col') === '0' &&
         [...e.attributes].every(a => !a.name.includes('"') && !a.name.includes("'"))) &&
       await p.locator('#nativeeditor tr.invalid').count() === 2,
       'invalid draft quoting leaves grid structure, attributes and invalid rows intact');
    await p.evaluate(() => {
      const proto = CT_LSDJ_DOC.NativeDocument.prototype, set = proto.setBytes;
      window.__exportWrites = 0; window.__exportSaves = 0;
      proto.setBytes = function (...args) { window.__exportWrites++; return set.apply(this, args); };
      const save = window._saveBlob;
      window._saveBlob = function (...args) { window.__exportSaves++; if (save) return save.apply(this, args); };
    });
    const downloads = []; p.on('download', d => downloads.push(d));
    for (const format of ['sng', 'sav', 'json']) {
      await p.click('#nativeeditor .ne-exp-' + format);
      ok(/pending edits are invalid/i.test(await p.locator('#nativeeditor .ne-status').textContent()), format + ': invalid draft visibly blocks export');
      ok(await p.evaluate(() => window.__exportWrites === 0 && window.__exportSaves === 0), format + ': blocked export performs no partial transaction or save');
      ok(await cell(p, 1, 0).inputValue() === '32' && await p.locator('#nativeeditor .ne-apply[data-applyrow="1"]').isEnabled() &&
         await cell(p, 2, 0).inputValue() === quoted && await cell(p, 3, 0).inputValue() === markup, format + ': all valid and invalid drafts remain staged');
    }
    await wait(200);
    ok(downloads.length === 0, 'blocked exports emit no downloads');
    await p.click('#nativeeditor .ne-undo');
    ok(await cell(p, 0, 1).inputValue() === ('0' + sv.song[O.PHRASE_INSTRUMENTS].toString(16)).slice(-2).toUpperCase() &&
       await p.locator('#nativeeditor .ne-undo').isDisabled(), 'blocked exports add no undo entries: one undo reverts the original applied edit');

    for (const kind of ['json', 'lsdsng']) {
      await holdReads(p);
      const late = kind === 'json' ? Buffer.from(jsonFor(d => d.setPhraseNote(0, 0, 0x55))) : fx.file;
      const closeDialogs = dialogs(p, true);
      await importFile(p, 'late.' + kind, late);
      await p.waitForFunction(() => window.__nativeReads.length === 1, null, { timeout: 5000 });
      await p.click('#nativeeditor .ne-close');
      ok(await unloadPrevented(p), kind + ': pending invalid edits prevent dispatched beforeunload while closed');
      await p.evaluate(() => { window.__nativeReads.shift()(); window.__restoreNativeReader(); });
      ok(!await nativeOpen(p) && closeDialogs.seen.length === 0, kind + ': close invalidates the in-flight read without reopening or prompting');
      closeDialogs.stop();
      await nativeAction(p,'[data-action="native-resume"]'); await setCat(p, 'Phrases');
      ok(await cell(p, 1, 0).inputValue() === '32' && await cell(p, 2, 0).inputValue() === quoted &&
         await cell(p, 3, 0).inputValue() === markup, kind + ': Resume preserves drafts after the cancelled read completes');
    }
    ok(errs.length === 0, 'no page errors in malformed/draft/read regressions' + (errs.length ? ' -- ' + errs.join('; ') : ''));
    await p.close();
  }

  // ---- .sav whole-file preservation ---------------------------------------
  {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await wait(800); await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), nativeAction(p,'[data-action="native-pick"]')]);
    await ch.setFiles({ name: 'fixture.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(sv.sav) });
    await p.waitForFunction(() => document.querySelector('#nativeeditor.show'), null, { timeout: 15000 });
    await setCat(p, 'Phrases'); await setSlot(p, 0); await cell(p, 0, 0).fill('15'); await applyRow(p, 0);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#nativeeditor .ne-exp-sav')]);
    const out = new Uint8Array(fs.readFileSync(await dl.path()));
    ok(out.length === 0x20000, 'the .sav export is the whole 128 KB');
    ok(out[0] === 0x15 && out[SENTINEL] === 0xAB, 'the working-memory song carries the edit and the sentinel');
    let outsideSame = true; for (let k = 0x8000; k < 0x20000; k++) if (out[k] !== sv.sav[k]) { outsideSame = false; break; }
    ok(outsideSame, 'the entire region outside working memory is byte-identical to the original .sav');
    await p.close();
  }

  // ---- fresh page: open native JSON with no prior LSDj import --------------
  {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await wait(800); await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), nativeAction(p,'[data-action="native-json"]')]);
    await ch.setFiles({ name: 'doc.json', mimeType: 'application/json', buffer: Buffer.from(jsonFor(d => d.setPhraseNote(1, 1, 0x39))) });
    await p.waitForFunction(() => document.querySelector('#nativeeditor.show'), null, { timeout: 15000 });
    await setCat(p, 'Phrases'); await setSlot(p, 1);
    ok(await cell(p, 1, 0).inputValue() === '39', 'a standalone native JSON opens on a fresh page without importing LSDj first');
    await p.close();
  }

  // ---- phone: fits, controls visible, focusable ---------------------------
  {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#musicworkspace:not([hidden])'), null, { timeout: 40000 });
    await wait(800); await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    await openLsdsng(p, fx.file);
    const box = await p.evaluate(() => { const r = document.getElementById('nativeeditor').getBoundingClientRect(); return { l: r.left, rt: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    ok(box.l >= -1 && box.rt <= box.vw + 1 && box.t >= -1 && box.b <= box.vh + 1, 'the panel fits a 390x844 phone');
    ok(await p.locator('#nativeeditor .ne-cat').first().isVisible() && await p.locator('#nativeeditor .ne-apply').first().isVisible(), 'category tabs and an Apply control are visible on the phone');
    ok(await p.evaluate(() => { const i = document.querySelector('#nativeeditor .ne-byte'); i.focus(); return document.activeElement === i; }), 'a byte cell is keyboard-focusable on a phone');
    const shotP = path.join(TMP, 'phone.png'); await p.screenshot({ path: shotP }); console.log('  screenshot (phone):   ' + shotP);
    await p.close();
  }

  await b.close(); h.s.close();
  console.log(fail ? ('\n' + fail + ' check(s) failed') : '\nlsdj-native-editor: all checks passed');
  process.exit(fail ? 1 : 0);
})();
