#!/usr/bin/env node
'use strict';
// Phase E checkbox 4, the half a harness can honestly hold.
//
// READ THIS BEFORE EXTENDING. This file proves a naive second-window mirror
// INHERITS its source's frame supply, which is the checkbox's own "if a simple
// mirror freezes" clause, and it proves the workspace clock survives a real
// editor blur. It does NOT prove anything about backgrounding or a second
// display, and it must never be described as if it did.
//
// The method matters: inject the CONSEQUENCE (stop the source producing
// frames), never the SIGNAL. Overriding document.hidden and firing a synthetic
// visibilitychange is the computed-state class the project contract rejects,
// and it is unsound here for a measurable reason: Playwright launches Chromium
// with backgrounding disabled, so rAF keeps running at full rate under such an
// override. That technique can make a freeze look real; it can never show one
// was fixed. Chromium only; not Safari, not a projector.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.resolve(__dirname,'../dist');
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'};
const SONG='song({tempo:150,bars:8});pattern("p",notes("C4 E4 G4 B4").stepsPerBar(4));track("lead").instrument("p0").play("p",{repeat:8});';

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
    const ctx=await browser.newContext({viewport:{width:1400,height:900}});
    const errors=[];
    await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await ctx.addInitScript(()=>{
      window.clockContexts=0;
      for(const n of ['AudioContext','webkitAudioContext'])if(window[n])window[n]=new Proxy(window[n],{construct(T,a){clockContexts++;return Reflect.construct(T,a);}});
    });
    const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/?screen=off');
    await page.waitForFunction(()=>window.CT_CREATE_PRESENTATION?.snapshot().visual&&window.CT_MUSIC_WORKSPACE?.snapshot()?.validated);
    await page.evaluate(async song=>{await CT_MUSIC_WORKSPACE.open({source:song,explicit:true});},SONG);
    await page.locator('[data-action=play]').click();
    await page.waitForFunction(()=>Audio.musicVisualState()?.status==='playing'&&Audio.musicVisualState().frame>4);

    await check('a naive second-window mirror has no frame supply of its own',async()=>{
      // This is the shape the checkbox warns about: a popup that drawImage()s
      // the opener's stage on its own rAF. Its own loop runs the whole time;
      // what it cannot do is invent frames the source is not producing. Landed
      // as a permanent regression so no future session ships this as output.
      const popup=await new Promise(async resolve=>{
        ctx.once('page',resolve);
        await page.evaluate(o=>{window.__mirror=window.open(o+'/?screen=off','mirror','width=320,height=200');},origin);
      });
      await popup.waitForLoadState('domcontentloaded');
      await popup.evaluate(()=>{
        // Mirror the opener's real stage canvas, exactly as a naive
        // implementation would, and count both our own ticks and how many of
        // them actually produced a different picture.
        window.__ticks=0;window.__distinct=0;
        const own=document.createElement('canvas');own.width=160;own.height=90;
        const g=own.getContext('2d');let last=null;
        const loop=()=>{
          window.__ticks++;
          try{
            const src=window.opener&&window.opener.document.getElementById('stage');
            if(src&&src.width){
              g.drawImage(src,0,0,own.width,own.height);
              const now=own.toDataURL();
              if(now!==last){window.__distinct++;last=now;}
            }
          }catch(e){/* a cross-document read failure is still "no frames" */}
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      await popup.waitForTimeout(1200);
      const painting=await popup.evaluate(()=>({ticks:window.__ticks,distinct:window.__distinct}));
      assert.ok(painting.ticks>10,'the mirror really is running its own frame loop');
      assert.ok(painting.distinct>1,'and while the source paints, it does mirror real frames');

      // Now stop the SOURCE producing new frames, using the product's own
      // Freeze control rather than faking a browser state.
      await page.evaluate(()=>CT_CREATE_PRESENTATION.freezeVisuals(true));
      await popup.evaluate(()=>{window.__ticks=0;window.__distinct=0;});
      await popup.waitForTimeout(1200);
      const frozen=await popup.evaluate(()=>({ticks:window.__ticks,distinct:window.__distinct}));
      assert.ok(frozen.ticks>10,'the mirror keeps ticking on its own clock');
      assert.equal(frozen.distinct,0,'but produces ZERO new frames: it inherits the source, it does not fix it');
      await page.evaluate(()=>CT_CREATE_PRESENTATION.freezeVisuals(false));
      await popup.close();
    });

    await check('a second window creates no second audio engine and no second renderer',async()=>{
      const before=await page.evaluate(()=>({contexts:clockContexts,
        canvases:CT_CREATE_PRESENTATION.snapshot().visual.renderer.canvasCount,
        status:Audio.musicVisualState().status}));
      const popup=await new Promise(async resolve=>{
        ctx.once('page',resolve);
        await page.evaluate(o=>{window.open(o+'/?screen=off','mirror2','width=320,height=200');},origin);
      });
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(600);
      const after=await page.evaluate(()=>({contexts:clockContexts,
        canvases:CT_CREATE_PRESENTATION.snapshot().visual.renderer.canvasCount,
        status:Audio.musicVisualState().status}));
      assert.deepEqual(after,before,'the opener keeps one audio engine, one renderer and keeps playing');
      await popup.close();
    });

    await check('acknowledged musical time survives a real editor blur',async()=>{
      // A REAL blur from fronting another page, not a synthetic Event('blur').
      // The radio generator deliberately re-clocks itself when the editor is
      // backgrounded; the workspace clock must not, because its acknowledgements
      // ride the worklet port rather than the deck scheduler. Nothing asserted
      // this before, and a regression here looks like drifting visuals at a gig
      // rather than a red test.
      const other=await ctx.newPage();
      await other.goto(origin+'/?screen=off');
      await other.bringToFront();
      await other.waitForTimeout(900);
      const during=await page.evaluate(()=>({frame:Audio.musicVisualState().frame,status:Audio.musicVisualState().status,contexts:clockContexts}));
      await page.bringToFront();
      await page.waitForTimeout(900);
      const after=await page.evaluate(()=>({frame:Audio.musicVisualState().frame,status:Audio.musicVisualState().status,contexts:clockContexts}));
      assert.equal(during.status,'playing','music keeps playing while the editor is not frontmost');
      assert.ok(after.frame>during.frame,'and acknowledged musical time keeps advancing across the blur');
      assert.equal(after.contexts,during.contexts,'with no second audio engine');
      await other.close();
    });

    await check('no page errors',async()=>{assert.deepEqual(errors,[]);});
    await page.locator('[data-action=stop]').click().catch(()=>{});
  }catch(error){failures++;console.error('FAIL harness: '+(error.stack||error));}
  finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
  const build=(()=>{try{const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');const m=html.match(/app\.[0-9a-f]+\.js/);return m?m[0]:'dist';}catch(e){return 'dist';}})();
  if(failures){console.error(`verify-audience-clock-browser: ${failures} failed`);process.exitCode=1;}
  else console.log(`PASS audience clock (${build}); a naive mirror inherits its source and the workspace clock survives blur. NOT backgrounding or second-display evidence.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
