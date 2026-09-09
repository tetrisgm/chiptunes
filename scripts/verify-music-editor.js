#!/usr/bin/env node
'use strict';
// Standalone diagnostic, never builds dist or changes the workspace UI/tests.
// node scripts/verify-music-editor.js [fill|insertText|paste|set|all] [chars=150000]
// Add --workspace to reproduce against the current dist workspace (read-only).
// --pretty stresses line count; --single-line stresses wrapping. Clipboard paste
// is the normal-user regression; fill/insertText are deliberately diagnostic.
// Each case owns a fresh browser. Node watchdog and independent CDP profiler
// stop remain live when the renderer main thread blocks; owned browser is killed.
// Diagnosis 2026-09-08 (Chromium): contenteditable fill routes through Playwright
// keyboard.insertText -> CDP Input.insertText. That does native DOM insertion,
// bypassing CM's paste handler/transaction and its normal viewport discipline.
// Native Layout dominated the many-line stall; smaller-case JS profiles then
// showed DOMObserver.findChild/readChange/readMutation, not parser domination.
// Profiler.stop itself can block in native layout: browser-level tracing still
// captured Layout, and the separate Node watchdog terminated the owned process.
// Real clipboard paste uses CM handlers.paste -> doPaste. 150KB/12731 lines:
// paste 68ms vs fill/insertText watchdog. 1MiB/88299 lines: paste 87ms; a 1MiB
// single wrapped line: 75ms. Full equality and edit/undo passed, no truncation.
// These are standalone Chromium measurements, not Safari acceptance or a claim
// that all OS clipboard/IME paths have been tested. Do not loosen UI timeouts
// or clip source to accommodate the automation-only native insertion path.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'paste', chars = Number(process.argv[3] || 150000);
const workspace = process.argv.includes('--workspace');
const pretty = process.argv.includes('--pretty');
const singleLine = process.argv.includes('--single-line');
if (!['fill', 'insertText', 'paste', 'set', 'all'].includes(mode) || !Number.isInteger(chars) || chars < 100 || chars > 1048576) throw Error('Invalid mode/size');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-editor-profile-'));
const bounded = (promise, ms, label) => {
  let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timeout')), ms); })]).finally(() => clearTimeout(timer));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
function top(profile) {
  const map = new Map(profile.nodes.map(n => [n.id, n])); const totals = new Map();
  (profile.samples || []).forEach((id, i) => { totals.set(id, (totals.get(id) || 0) + (profile.timeDeltas[i] || 0)); });
  return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([id, us]) => {
    const n = map.get(id).callFrame; return { ms: Math.round(us / 1000), fn: n.functionName, url: n.url, line: n.lineNumber + 1 };
  });
}
async function main() {
  const bundle = await esbuild.build({ entryPoints: [path.join(root, 'src/music-code-editor.mjs')], bundle: true, write: false, format: 'iife', sourcemap: 'inline' });
  fs.writeFileSync(path.join(output, 'editor.js'), bundle.outputFiles[0].contents);
  let text = 'song({totalFrames:30000})\ninstruments([[128,240,255,0]])\n';
  for (let i = 0;; i++) {
    const line = 'event(' + JSON.stringify({ch:0,frame:i,frames:1,midi:60,inst:0,vel:0.8}, null, pretty ? 2 : 0) + ');\n';
    if (text.length + line.length > chars) break;
    text += line;
  }
  text += ' '.repeat(chars - text.length);
  if (singleLine) text = text.replace(/\n/g, ' ');
  const html = '<!doctype html><style>body{margin:0}#editor{height:650px;width:950px}</style><div id="editor"></div><script src="/editor.js"></script>';
  const server = http.createServer((req, res) => {
    if (req.url === '/editor.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].contents); }
    if (!workspace) { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
    let file = path.join(root, 'dist', new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(path.join(root, 'dist') + '/')) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'dist/index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('Artifacts: ' + output);
  try {
    for (const method of mode === 'all' ? ['set', 'paste', 'insertText', 'fill'] : [mode]) {
      const owned = await chromium.launchServer({ headless: true });
      const browser = await chromium.connect(owned.wsEndpoint());
      const result = { method, workspace, pretty, singleLine, requestedChars: chars }; let cdp, trace;
      try {
        const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage(); page.setDefaultTimeout(8000);
        page.on('pageerror', e => { (result.errors ||= []).push(e.message); });
        cdp = await ctx.newCDPSession(page);
        trace = await browser.newBrowserCDPSession();
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        await bounded((async () => {
          await page.addInitScript(() => localStorage.setItem('ct-create-tour', '1'));
          await page.goto(url + (workspace ? '/create' : '/'));
          if (workspace) {
            await page.evaluate(() => document.querySelector('.cr-tour')?.remove());
            await page.click('[data-cr=workspace]');
            await page.waitForSelector('#musicworkspace .cm-content', { state: 'attached' });
            await page.click('#musicworkspace .cm-content');
            text = await page.evaluate(() => CT_MUSIC_WORKSPACE.snapshot().draft);
          } else {
            await page.evaluate(source => {
              window.changes = 0;
              window.editor = CT_MUSIC_CODE_EDITOR.mount(document.querySelector('#editor'), source, () => window.changes++);
            }, text);
          }
          result.chars = text.length;
          result.lines = text.split('\n').length;
          await page.locator('.cm-content').fill('song({tempo:128,bars:2})\ninvalid(');
          if (workspace) await page.click('#musicworkspace [data-action=apply]');
          else await page.evaluate(() => editor.diagnostics([{ from: 23, to: 30, message: 'Invalid source' }]));
          await sleep(400);
          await page.evaluate(source => { window.largeSource = source; }, text);
          await page.evaluate(() => {
            window.pasteEvents = [];
            document.addEventListener('paste', e => pasteEvents.push(e), true);
          });
          if (method === 'paste') await page.evaluate(() => navigator.clipboard.writeText(largeSource));
          if (method !== 'fill' && method !== 'set') await page.locator('.cm-content').press('ControlOrMeta+a');
        })(), 15000, 'setup');
        await trace.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReturnAsStream' });
        await cdp.send('Profiler.start');
        const started = Date.now();
        try {
          await bounded((async () => {
            if (method === 'fill') await page.locator('.cm-content').fill(text);
            else if (method === 'insertText') await page.keyboard.insertText(text);
            else if (method === 'paste') await page.keyboard.press('ControlOrMeta+v');
            else {
              if (workspace) throw Error('set mode is standalone only');
              await page.evaluate(() => editor.set(largeSource));
            }
            await page.waitForFunction(w => (w ? CT_MUSIC_WORKSPACE.snapshot().draft : editor.value()) === largeSource, workspace);
            result.inputMs = Date.now() - started;
            if ((method === 'paste' || method === 'set') && result.inputMs > 2000) throw Error('2s editor input performance budget exceeded');
            if (method === 'paste') {
              result.pasteEvents = await page.evaluate(() => pasteEvents.map(e => ({ trusted: e.isTrusted, prevented: e.defaultPrevented })));
              if (!result.pasteEvents.some(e => e.trusted && e.prevented)) throw Error('Expected trusted clipboard paste handled by editor');
            }
            if (method === 'paste' && !workspace) {
              const editStarted = Date.now();
              await page.keyboard.press('ArrowLeft');
              await page.keyboard.press('Delete');
              await page.keyboard.press('ControlOrMeta+z');
              await page.waitForFunction(() => editor.value() === largeSource);
              result.editUndoMs = Date.now() - editStarted;
            }
            await sleep(750);
            result.metrics = await cdp.send('Runtime.getHeapUsage');
            result.dom = await cdp.send('Memory.getDOMCounters');
          })(), 10000, 'input');
          result.ok = true;
        } catch (e) { result.ok = false; result.error = e.message.split('\n')[0].slice(0, 500); result.elapsedMs = Date.now() - started; }
        // Inspector command has its own deadline, separate from the stuck input.
        try {
          const { profile } = await bounded(cdp.send('Profiler.stop'), 4000, 'profiler stop');
          fs.writeFileSync(path.join(output, method + '.cpuprofile'), JSON.stringify(profile)); result.hot = top(profile);
        } catch (e) { result.profileError = e.message; }
        try {
          const completed = new Promise(r => trace.once('Tracing.tracingComplete', r));
          await trace.send('Tracing.end');
          const { stream } = await bounded(completed, 3000, 'trace stop');
          let data = '';
          for (;;) {
            const part = await bounded(trace.send('IO.read', { handle: stream }), 2000, 'trace read');
            data += part.data; if (part.eof) break;
          }
          await trace.send('IO.close', { handle: stream });
          fs.writeFileSync(path.join(output, method + '.trace.json'), data);
          const totals = {};
          for (const e of JSON.parse(data).traceEvents) if (e.ph === 'X' && e.dur) totals[e.name] = (totals[e.name] || 0) + e.dur;
          result.timeline = Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0,15).map(([name,us]) => ({name, ms:Math.round(us/1000)}));
        } catch (e) { result.traceError = e.message; }
      } catch (e) { result.ok = false; result.error = e.message.split('\n')[0].slice(0, 500); }
      finally {
        owned.process().kill('SIGKILL');
        await bounded(owned.close().catch(() => {}), 2000, 'browser cleanup').catch(() => {});
      }
      fs.writeFileSync(path.join(output, method + '.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      if (!result.ok && (method === 'paste' || method === 'set')) process.exitCode = 1;
    }
  } finally { server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
