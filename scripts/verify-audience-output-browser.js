#!/usr/bin/env node
'use strict';
// Phase E checkbox 3: audience output on the real shared artifact. Two output
// layouts, independent of the authoring layout, neither of which exposes the
// whole app DOM. Chromium only; this is not a second-display or backgrounding
// check (that is checkbox 4) and not native Safari acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.resolve(__dirname,'../dist');
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'};
const SONG='song({tempo:150,bars:8});pattern("p",notes("C4 E4 G4 B4").stepsPerBar(4));track("lead").instrument("p0").play("p",{repeat:8});';
// Everything an audience must never see: private conversation, account and
// provider settings, saved history and project tools, and editing/error chrome.
const PRIVATE=['.mw-chat','.mw-footer','.mw-project-tools','.mw-chat-settings[open]','.mw-transfer-offer',
  '.mw-live-guide','.mw-help','.mw-diagnostics','.mw-visual-authoring','.mw-status','.mw-transport'];

(async()=>{
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://fixture');
    if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:false,providers:[]}));return;}
    let file=path.resolve(dist,'.'+decodeURIComponent(u.pathname));
    if(!file.startsWith(dist+path.sep)&&file!==dist){res.writeHead(403);res.end();return;}
    if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(dist,'index.html');
    res.setHeader('Content-Type',mime[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser,failures=0;
  const check=(name,fn)=>fn().then(()=>console.log('  ok   '+name),e=>{failures++;console.error('  FAIL '+name+': '+(e.message||e));});
  try{
    browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
    const ctx=await browser.newContext({viewport:{width:1800,height:1100}});
    const errors=[],provider=[];
    await ctx.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.pathname==='/api/music/chat'&&route.request().method()==='POST')provider.push(u.href);
      return u.origin===origin?route.continue():route.abort();
    });
    await ctx.addInitScript(()=>{
      window.outContexts=0;window.outMic=0;window.outCommands=[];
      for(const n of ['AudioContext','webkitAudioContext'])if(window[n])window[n]=new Proxy(window[n],{construct(T,a){outContexts++;return Reflect.construct(T,a);}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{outMic++;throw Error('Forbidden capture');};
    });
    const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    const visible=sel=>page.evaluate(s=>{const el=document.querySelector(s);
      if(!el)return false;const r=el.getBoundingClientRect();
      return r.width>0&&r.height>0&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';},sel);
    const mode=()=>page.evaluate(()=>document.getElementById('musicworkspace').dataset.presentation);
    const world=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.mw-stage-viewport canvas')).map(c=>c.width+'x'+c.height).join(','));
    const audio=()=>page.evaluate(()=>{const a=Audio.musicVisualState();return {status:a&&a.status,activation:a&&a.activation,contexts:outContexts};});

    await page.goto(origin+'/?screen=off');
    await page.waitForFunction(()=>window.CT_CREATE_PRESENTATION?.snapshot().visual&&window.CT_MUSIC_WORKSPACE?.snapshot()?.validated);
    await page.evaluate(async song=>{await CT_MUSIC_WORKSPACE.open({source:song,explicit:true});},SONG);

    await check('both audience layouts are offered, independently of the authoring layout',async()=>{
      const options=await page.evaluate(()=>Array.from(document.querySelectorAll('.mw-output-mode option')).map(o=>o.value));
      assert.deepEqual(options,['visualizer','performance'],'visuals-only and code-plus-visuals');
      assert.equal(await mode(),'composition','authoring layout is the default');
      assert.equal(await visible('.mw-chat'),true,'and chat is part of authoring, not output');
    });

    await check('visuals-only output shows the stage and no private or editing surface',async()=>{
      await page.locator('.mw-output-mode').selectOption('visualizer');
      await page.getByRole('button',{name:'Focus visuals',exact:true}).click();
      assert.equal(await mode(),'visualizer');
      assert.equal(await visible('.mw-stage-viewport'),true,'the stage is the output');
      assert.equal(await visible('.mw-code'),false,'code is not part of visuals-only output');
      for(const sel of PRIVATE)assert.equal(await visible(sel),false,sel+' must not be visible in output');
    });

    await check('code-plus-visuals output keeps the program readable and still hides everything private',async()=>{
      await page.locator('.mw-output-mode').selectOption('performance');
      assert.equal(await mode(),'performance','switching while output is showing re-lays it out');
      assert.equal(await visible('.mw-stage-viewport'),true,'the stage is still output');
      assert.equal(await visible('.mw-code'),true,'the performance program is readable');
      for(const sel of PRIVATE)assert.equal(await visible(sel),false,sel+' must not be visible in output');
    });

    await check('switching output layout never recomposes, restarts audio or resets the visual world',async()=>{
      await page.getByRole('button',{name:'Return to composition',exact:true}).click();
      await page.locator('[data-action=play]').click();
      await page.waitForFunction(()=>Audio.musicVisualState()?.status==='playing'&&Audio.musicVisualState().frame>4);
      const before=await audio(),worldBefore=await world(),revision=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id);
      await page.locator('.mw-output-mode').selectOption('visualizer');
      await page.getByRole('button',{name:'Focus visuals',exact:true}).click();
      await page.locator('.mw-output-mode').selectOption('performance');
      await page.getByRole('button',{name:'Return to composition',exact:true}).click();
      const after=await audio();
      assert.equal(after.status,'playing','music keeps playing across both output layouts');
      assert.equal(after.activation,before.activation,'with no new activation');
      assert.equal(after.contexts,before.contexts,'and no second audio engine');
      assert.ok(after.contexts<=1,'exactly one AudioContext for the whole session');
      assert.equal(await world(),worldBefore,'the same visual world is reused, not rebuilt');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),revision,'no recompose');
      await page.locator('[data-action=stop]').click();
      await page.waitForFunction(()=>Audio.musicVisualState()?.status!=='playing');
    });

    await check('the chosen output layout is a local preference that survives a reload',async()=>{
      await page.locator('.mw-output-mode').selectOption('performance');
      await page.waitForTimeout(400);
      const record=await page.evaluate(()=>localStorage.getItem('ct-music-workspace-v1'));
      assert.equal(record.includes('outputMode'),false,'output layout is never portable composition data');
      await page.reload();
      await page.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.snapshot()?.validated);
      assert.equal(await page.locator('.mw-output-mode').inputValue(),'performance','the choice is remembered locally');
    });

    await check('Escape leaves output and returns the authoring layout',async()=>{
      await page.getByRole('button',{name:'Focus visuals',exact:true}).click();
      assert.notEqual(await mode(),'composition');
      await page.keyboard.press('Escape');
      assert.equal(await mode(),'composition');
      assert.equal(await visible('.mw-chat'),true,'authoring surfaces come back');
    });

    await check('output carries its own on-screen build identifier while the footer stays hidden',async()=>{
      // A build id read at a different moment than the observation is inference,
      // not evidence. The footer copy is hidden in output, so audience layouts
      // need their own, and it must NOT be an unhide of .mw-footer (that would
      // put project tools, download, share and export on the projector).
      await page.getByRole('button',{name:'Focus visuals',exact:true}).click();
      assert.equal(await visible('.mw-output-build'),true,'output shows a build identifier');
      assert.equal(await visible('.mw-footer'),false,'and the footer is still hidden');
      const shown=(await page.locator('.mw-output-build').textContent()).trim();
      const footer=(await page.locator('.mw-build').textContent()).trim();
      assert.equal(shown,footer,'it is the same build string the footer carries');
      assert.match(shown,/^Music v\d+ · [0-9a-f]+$/,'and it names a concrete build');
    });

    await check('fullscreen takes the whole output layout, not just the stage',async()=>{
      // Fullscreening only .mw-stage-viewport would drop the code half of
      // code-plus-visuals, which is what makes it a performance surface.
      await page.locator('.mw-output-mode').selectOption('performance');
      const before=await page.evaluate(()=>{
        const s=CT_CREATE_PRESENTATION.snapshot().visual;
        return {canvases:s.renderer.canvasCount,w:s.renderer.width,h:s.renderer.height,
          revision:CT_MUSIC_WORKSPACE.snapshot().validated.id,contexts:outContexts};});
      await page.locator('[data-action=stage-fullscreen]').click();
      await page.waitForFunction(()=>document.fullscreenElement!==null);
      assert.equal(await page.evaluate(()=>document.fullscreenElement&&document.fullscreenElement.id),'musicworkspace',
        'the output root is the fullscreen element');
      assert.equal(await visible('.mw-code'),true,'the code half survives fullscreen');
      assert.equal(await visible('.mw-stage-viewport'),true,'and so does the stage');
      assert.equal(await visible('.mw-output-build'),true,'the build identifier is readable in fullscreen');
      // The private list must hold in the FULLSCREEN state, not only windowed.
      for(const sel of PRIVATE)assert.equal(await visible(sel),false,sel+' must not be visible in fullscreen output');
      const during=await page.evaluate(()=>{
        const s=CT_CREATE_PRESENTATION.snapshot().visual;
        return {canvases:s.renderer.canvasCount,w:s.renderer.width,h:s.renderer.height,
          revision:CT_MUSIC_WORKSPACE.snapshot().validated.id,contexts:outContexts};});
      assert.deepEqual(during,before,'one renderer, fixed buffers, no recompose, no second audio engine');
      await page.evaluate(()=>document.exitFullscreen());
      await page.waitForFunction(()=>document.fullscreenElement===null);
      await page.getByRole('button',{name:'Return to composition',exact:true}).click();
      assert.equal(await mode(),'composition','leaving fullscreen and output restores authoring');
      assert.equal(await visible('.mw-chat'),true);
    });

    await check('no page errors, no provider or capture calls',async()=>{
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>outMic),0);
      assert.equal(provider.length,0);
    });
  }catch(error){failures++;console.error('FAIL harness: '+(error.stack||error));}
  finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
  const build=(()=>{try{const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');const m=html.match(/app\.[0-9a-f]+\.js/);return m?m[0]:'dist';}catch(e){return 'dist';}})();
  if(failures){console.error(`verify-audience-output-browser: ${failures} failed`);process.exitCode=1;}
  else console.log(`PASS audience output (${build}); two layouts, one audio engine, no private UI; Chromium only, no second-display or Safari claim.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
