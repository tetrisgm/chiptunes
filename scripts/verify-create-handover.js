// Only explicit Listen hands the station back playing. Legacy Close is silent
// when the editor owned the chip; closing a pure following view preserves the
// already-playing station without reposting its score.
//
// The editor takes the chip over: it owns the worklet, it can mute lanes, it
// can leave a four-bit sample sitting in wave RAM. Explicit Listen has to undo
// all of that, and the failure mode is not subtle -- the radio comes back silent,
// and pressing pause and play does not rescue it, because nothing reposts the
// score. That was reported from the wild and could not be reproduced by hand,
// which is exactly the kind of bug that needs a test standing over it.
//
// Every scenario below is a way of leaving the editor in a different state.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const canonicalOnly = process.argv.includes('--canonical-only');
const followingOnly = process.argv.includes('--following-only');
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
        if (err) { e.writeHead(500); e.end(); return; }
        e.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
        e.end(b);
      });
    });
    s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

const peak = async (p, ms) => {
  let k = 0;
  for (let i = 0; i < Math.ceil(ms / 200); i++) {
    k = Math.max(k, await p.evaluate(() => Audio.outputProbe().peak));
    await wait(200);
  }
  return k;
};
const audiblePeak = async (p, timeout = 10000) => {
  let k = 0;
  for (let elapsed = 0; elapsed < timeout && k <= 0.02; elapsed += 1000)
    k = Math.max(k, await peak(p, 1000));
  return k;
};

// Observation only: every call forwards unchanged arguments/return values.
// Never wrap a Close callback to grant Listen authority on the user's behalf.
const observeTransport = p => p.evaluate(() => {
  window.handoverTransport=[];
  for (const name of ['playScore','playCreate','enterCreate','musicPlay','musicQueue']) {
    const original=Audio[name];
    Audio[name]=function(...args){handoverTransport.push(name);return original.apply(this,args);};
  }
});
async function explicitListen(p,label,checkTransport=true) {
  await p.evaluate(async () => { await _openCreate(); });
  await p.waitForFunction(() => CT_MUSIC_WORKSPACE.isOpen());
  ok(await p.evaluate(() => !CT_CREATE.isOpen()&&!CT_MUSIC_WORKSPACE.snapshot().playing&&!CT_MUSIC_WORKSPACE.snapshot().pending),
    label+': canonical workspace opens stopped for explicit Listen');
  await p.getByRole('button',{name:'Listen',exact:true}).click();
  const state=await p.evaluate(() => ({workspace:CT_MUSIC_WORKSPACE.isOpen(),legacy:CT_CREATE.isOpen(),route:location.pathname}));
  console.log('  Listen '+label+': '+JSON.stringify(state));
  ok(!state.workspace&&!state.legacy,label+': explicit Listen leaves both editors closed');
  ok(state.route==='/listen',label+': explicit Listen keeps /listen');
  const returned=await audiblePeak(p);
  ok(returned>.02,label+': explicit Listen starts station audio ('+returned.toFixed(3)+')');
  if(!checkTransport)return;
  const beforePause=await p.evaluate(()=>({holding:Audio.isHolding(),paused:Audio.isPaused(),radioPlaying:Radio.state.playing,chip:Audio.chipDiag()}));
  await p.evaluate(() => { document.activeElement?.blur(); });
  await p.keyboard.press('Space'); await wait(1000);
  const paused=await p.evaluate(()=>({holding:Audio.isHolding(),paused:Audio.isPaused(),radioPlaying:Radio.state.playing,chip:Audio.chipDiag()}));
  ok(paused.paused,label+': station transport pauses after Listen');
  if(!paused.paused)console.log('  transport '+label+': '+JSON.stringify({beforePause,afterSpace:paused}));
  await p.keyboard.press('Space'); await wait(1800);
  const restarted=await audiblePeak(p);
  ok(restarted>.02,label+': station pause/play remains usable ('+restarted.toFixed(3)+')');
}

// each scenario is a function run inside the open editor
const SCENARIOS = {
  'edited a note': async p => {
    await p.evaluate(async () => {
      const n = document.querySelector('.n-note'); if (!n) throw Error('Missing note for edit scenario');
      n.click(); await new Promise(r => setTimeout(r, 300));
      const v = [...document.querySelectorAll('.n-pick .n-po')].find(x => x.dataset.ed === 'vol+');
      if (!v) throw Error('Missing note volume control');
      v.click(); await new Promise(r => setTimeout(r, 250));
      const c = document.querySelector('.n-pclose'); if (c) c.click();
    });
  },
  'muted every lane': async p => {
    await p.evaluate(async () => {
      for (const c of [0, 1, 2, 3]) {
        const s = document.querySelector('.n-lane[data-ch="' + c + '"] .n-spk');
        if (!s) throw Error('Missing lane mute control '+c);
        s.click(); await new Promise(r => setTimeout(r, 120));
      }
    });
  },
  'left a sample in wave RAM': async p => {
    await p.evaluate(async () => {
      const d = document.querySelector('.n-note[data-ch="3"]'); if (!d) throw Error('Missing percussion note for sample scenario');
      d.click(); await new Promise(r => setTimeout(r, 300));
      const k = [...document.querySelectorAll('.n-pick .n-pv')].find(x => x.dataset.full === 'Kick');
      if (!k) throw Error('Missing Kick sample selector');
      k.click(); await new Promise(r => setTimeout(r, 300));
      const c = document.querySelector('.n-pclose'); if (c) c.click();
      if (!CT_CREATE._score().kit.length) throw Error('Kick selection did not schedule a sample');
    });
  },
  'still playing when closed': async () => {}      // closed mid-playback
};

(async () => {
  const h = await server();
  const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  console.log('Artifact: ' + (fs.readFileSync(path.join(DIST,'index.html'),'utf8').match(/app\.[a-f0-9]+\.js/)||['unknown'])[0]);
  for (const [name, setup] of canonicalOnly||followingOnly ? [] : Object.entries(SCENARIOS)) {
    const p = await b.newPage({ viewport: { width: 1380, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await p.goto(`http://127.0.0.1:${h.port}/listen`, { waitUntil: 'domcontentloaded' });
    await wait(3000);
    // Nothing plays until asked: a cold load holds and offers the moods.
    await p.evaluate(() => {
      const b2 = [...document.querySelectorAll('.rmood')].find(x => x.textContent === 'chill');
      if (b2) b2.click();
    });
    await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
    await wait(4000);
    // A generated arrangement can legitimately leave one second nearly empty
    // at a phrase boundary. Sample a musical window rather than treating that
    // quiet bar as a stopped audio engine.
    const before = await audiblePeak(p);

    await p.evaluate(async () => {
      // Establish runtime handback callbacks through canonical entry, then
      // explicitly select the compatibility editor for native chip scenarios.
      const code = Audio.currentDoc();
      await _openCreate();
      CT_MUSIC_WORKSPACE.close();
      CT_CREATE.open(code);
    });
    await p.waitForFunction(() => CT_CREATE.isOpen());
    await wait(4500);
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    // Canonical entry stopped the station. This explicit compatibility editor
    // now owns the chip; press Play only if its own transport is not running.
    await p.evaluate(async () => {
      const d = CT_CREATE._dbg && CT_CREATE._dbg();
      if (!d || !d.playing) { const b2 = document.querySelector('[data-cr="play"]'); if (b2) b2.click(); }
    });
    await wait(1800);
    await setup(p);
    await wait(1200);
    ok(await p.evaluate(() => Audio.chipDiag().owner==='create'),name+': compatibility editor owns the chip before Close');
    await observeTransport(p);
    await p.locator('[data-cr="close"]').click();
    await wait(3200);
    const after = await peak(p,1500);
    ok(before > 0.02, name + ': the station was playing to begin with (' + before.toFixed(3) + ')');
    ok(!await p.evaluate(() => CT_CREATE.isOpen()),name+': real legacy Close hides the editor');
    ok(after<.02,name+': real legacy Close leaves owned-chip playback silent ('+after.toFixed(3)+')');
    ok(await p.evaluate(() => !handoverTransport.includes('playScore')),name+': real legacy Close never reposts station score');
    await explicitListen(p,name);
    ok(!errs.length, name + ': no page errors' + (errs.length ? ' -- ' + errs[0] : ''));
    await p.close();
  }

  // Legacy shell coverage is compatibility-only, never the default /create UI.
  if (!canonicalOnly&&!followingOnly) {
    const p = await b.newPage({ viewport: { width: 1380, height: 900 } });
    await p.goto(`http://127.0.0.1:${h.port}/create`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.CT_MUSIC_WORKSPACE && CT_MUSIC_WORKSPACE.isOpen(), null, { timeout: 40000 });
    await p.evaluate(() => {
      // Plain canonical close is silent. Do not replace its runtime callback.
      CT_MUSIC_WORKSPACE.close();
      CT_CREATE.openBlank();
    });
    ok(await p.evaluate(() => !Audio.currentDoc()), 'cold compatibility fixture has not started the station');
    await p.waitForFunction(() => document.querySelector('#createscreen.show'), null, { timeout: 40000 });
    await wait(3600);
    const shell = await p.evaluate(() => {
      const sheet=document.getElementById('createscreen'), dock=document.getElementById('playbar');
      const r=sheet.getBoundingClientRect(), close=sheet.querySelector('[data-cr="close"]');
      const cr=close&&close.getBoundingClientRect();
      const utils=[...sheet.querySelectorAll('.n-utils .cr-btn')].filter(x=>x!==close)
        .map(x=>x.getBoundingClientRect()).filter(x=>x.width>0);
      return { top:Math.round(r.top), bottom:Math.round(r.bottom), height:Math.round(r.height), vh:innerHeight,
        dockVisible:!!dock && !!dock.getClientRects().length,
        shareIcon:!!sheet.querySelector('[data-cr="share"] .cr-share-icon'),
        closeLabel:close&&(close.getAttribute('aria-label')||''),
        closeIconOnly:!!close && [...close.children].every(c => c.tagName==='svg' || getComputedStyle(c).display==='none'),
        closeSize:cr&&[Math.round(cr.width),Math.round(cr.height)],
        closeInCorner:!!cr && (r.right-cr.right)<=16 && (cr.top-r.top)<=16,
        closeClearOfUtils:!!cr && utils.every(u=>u.right<=cr.left||u.bottom<=cr.top||u.top>=cr.bottom) };
    });
    ok(shell.height >= shell.vh*.9 && shell.top > 0 && Math.abs(shell.bottom-shell.vh)<2,
       'Create is a 90%+ bottom sheet with the game exposed above it');
    ok(!shell.dockVisible, 'Create hides the unrelated station dock');
    ok(shell.shareIcon, 'Create has a real share control');
    // CLOSE IS THE CORNER X. It used to be a worded pill inside the wrapping
    // utility row, where it took a second line and read as one more export
    // action rather than as the way out.
    ok(shell.closeIconOnly && shell.closeInCorner,
       'Create closes through an icon-only X in the top-right corner (' + (shell.closeSize||[]).join('x') + ')');
    ok(/close/i.test(shell.closeLabel) && shell.closeSize && shell.closeSize[0] >= 36 && shell.closeSize[1] >= 36,
       'and it is a labelled, finger-sized target (aria "' + shell.closeLabel + '")');
    ok(shell.closeClearOfUtils, 'with the utility row reserving room rather than running under it');
    await p.evaluate(() => { const t = document.querySelector('.cr-tour'); if (t) t.remove(); });
    await p.evaluate(async () => {
      const d = CT_CREATE._dbg && CT_CREATE._dbg();
      if (!d || !d.playing) { const b2 = document.querySelector('[data-cr="play"]'); if (b2) b2.click(); }
    });
    await wait(1800);
    await observeTransport(p);
    await p.locator('[data-cr="close"]').click();
    await wait(4500);
    const started = await peak(p, 3000);
    ok(started < 0.02, 'cold legacy Close stays silent (' + started.toFixed(3) + ')');
    ok(await p.evaluate(() => !Audio.currentDoc()&&!CT_CREATE.isOpen()&&!handoverTransport.includes('playScore')),
      'cold legacy Close neither starts station nor leaves legacy editor open');
    await explicitListen(p,'cold compatibility editor');
    await p.close();
  }

  if (!canonicalOnly) {
    const p=await b.newPage({viewport:{width:1380,height:900}}),errs=[];
    p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
    await p.goto(`http://127.0.0.1:${h.port}/create`,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.isOpen(),null,{timeout:40000});
    // The following-view test starts from audible playback, independently of
    // the separate pause/resume acceptance above. A transport failure must not
    // turn this into an accidental owned-chip test.
    await explicitListen(p,'pure following view setup',false);
    await observeTransport(p);
    const baseline=await p.evaluate(() => {
      const state={doc:Audio.currentDoc(),position:Audio.deckPosition()};
      CT_CREATE.open(state.doc);return state;
    });
    await p.waitForFunction(()=>CT_CREATE.isOpen());
    ok(await p.evaluate(()=>window.__followWhy==='ok'&&Audio.chipDiag().owner==='radio'),
      'pure following view opens on the station without taking its chip');
    await wait(1200);
    await p.locator('[data-cr="close"]').click();
    const retained=await audiblePeak(p);
    const closed=await p.evaluate(()=>({open:CT_CREATE.isOpen(),doc:Audio.currentDoc(),position:Audio.deckPosition(),calls:handoverTransport}));
    ok(!closed.open,'pure following Close hides only the view');
    ok(retained>.02,'pure following Close retains already-playing station ('+retained.toFixed(3)+')');
    ok(closed.calls.length===0,'pure following open/Close never re-arms chip or calls playScore ('+closed.calls.join(',')+')');
    ok(closed.doc===baseline.doc&&closed.position.tok===baseline.position.tok&&closed.position.sec>=baseline.position.sec,
      'pure following Close preserves exact station document and forward position');
    ok(!errs.length,'pure following view: no page errors'+(errs.length?' -- '+errs[0]:''));
    await p.close();
  }

  // Canonical entry owns a single workspace. Only explicit Listen hands back
  // station playback, whether entered cold or from a sounding station.
  for (const cold of followingOnly?[]:[true, false]) {
    const p = await b.newPage({ viewport: { width: 1380, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
    let stationScore;
    const label = cold ? 'canonical cold /create' : 'canonical station ribbon';
    await p.goto(`http://127.0.0.1:${h.port}/${cold ? 'create' : 'listen'}`, { waitUntil: 'domcontentloaded' });
    if (!cold) {
      await p.locator('.rmood').filter({ hasText: /^chill$/ }).click();
      await p.waitForFunction(() => !document.querySelector('.rmood.busy'), null, { timeout: 25000 });
      ok(await audiblePeak(p) > 0.02, label + ': station starts audibly');
      stationScore = await p.evaluate(() => JSON.parse(JSON.stringify(CT_CREATE.songOf(Audio.currentDoc()).gb)));
      await p.locator('#noteribbon').click();
    }
    await p.waitForFunction(() => window.CT_MUSIC_WORKSPACE && CT_MUSIC_WORKSPACE.isOpen(), null, { timeout: 40000 });
    ok(await p.evaluate(() => !CT_CREATE.isOpen()), label + ': no legacy editor underneath');
    const entry = await p.evaluate(() => {
      const s = CT_MUSIC_WORKSPACE.snapshot();
      return { playing: s.playing, pending: s.pending, gb: JSON.parse(JSON.stringify(s.validated.compiled.gb)) };
    });
    if (!cold) ok(require('node:util').isDeepStrictEqual(entry.gb, stationScore), label + ': preserves the exact station score');
    ok(await peak(p, 1200) === 0 && !entry.playing && !entry.pending, label + ': entry does not start or queue playback');
    await p.evaluate(() => CT_MUSIC_WORKSPACE.close());
    ok(!await p.evaluate(() => CT_MUSIC_WORKSPACE.isOpen()), label + ': plain Close hides workspace');
    ok(await peak(p,1500)<.02, label + ': plain Close does not hand back station audio');
    await p.evaluate(async () => { await _openCreate(); });
    await p.waitForFunction(() => CT_MUSIC_WORKSPACE.isOpen());
    await p.evaluate(() => {
      window.handoverRoutes=[];
      for (const method of ['replaceState','pushState']) {
        const original=history[method];
        history[method]=function(...args){
          handoverRoutes.push({method,from:location.pathname,to:String(args[2]),stack:new Error().stack});
          return original.apply(this,args);
        };
      }
    });
    await p.getByRole('button',{name:'Listen',exact:true}).click();
    const closed = await p.evaluate(() => ({ workspace: CT_MUSIC_WORKSPACE.isOpen(), legacy: CT_CREATE.isOpen(), route: location.pathname }));
    console.log('  closed '+label+': '+JSON.stringify(closed));
    ok(!closed.workspace, label + ': explicit Listen closes workspace');
    ok(!closed.legacy, label + ': explicit Listen leaves no legacy editor underneath');
    ok(closed.route === '/listen', label + ': explicit Listen keeps /listen (actual '+closed.route+')');
    if(closed.route!=='/listen')console.log('  route writes '+JSON.stringify(await p.evaluate(()=>handoverRoutes)));
    const returned = await audiblePeak(p);
    ok(returned > 0.02, label + ': explicit Listen hands audio to station (' + returned.toFixed(3) + ')');
    ok(!errs.length, label + ': no page errors' + (errs.length ? ' -- ' + errs[0] : ''));
    await p.close();
  }

  await b.close(); h.s.close();
  console.log(fail ? '\nverify-create-handover: ' + fail + ' FAILED'
                   : '\nverify-create-handover: real legacy Close semantics, explicit Listen handback and pure-view continuity pass');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
