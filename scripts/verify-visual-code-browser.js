#!/usr/bin/env node
'use strict';
// Actual shared artifact and chip playback; no provider or microphone requests.
// Chromium checks are not native Safari/physical-input acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.resolve(__dirname,'../dist');
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
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
  let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
    const ctx=await browser.newContext({viewport:{width:1800,height:1100},deviceScaleFactor:2});
    const errors=[],provider=[];
    await ctx.route('**/*',route=>{
      const u=new URL(route.request().url());if(u.pathname==='/api/music/chat'&&route.request().method()==='POST')provider.push(u.href);
      return u.origin===origin?route.continue():route.abort();
    });
    await ctx.addInitScript(()=>{
      window.visualContexts=0;window.visualMic=0;
      for(const name of ['AudioContext','webkitAudioContext'])if(window[name])window[name]=new Proxy(window[name],{construct(T,args){visualContexts++;return Reflect.construct(T,args);}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{visualMic++;throw Error('Forbidden capture');};
    });
    const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/?screen=off');
    await page.waitForFunction(()=>window.CT_CREATE_PRESENTATION?.snapshot().visual&&window.CT_MUSIC_WORKSPACE?.snapshot()?.validated);
    const visual=()=>page.evaluate(()=>CT_CREATE_PRESENTATION.snapshot().visual);
    assert.equal((await visual()).scene,'visual:neon-tunnel');
    assert.equal(await page.locator('.mw-visual-code-disclosure').getAttribute('open'),null,'visual code starts optional');
    assert.equal(await page.evaluate(()=>!!CT_MUSIC_WORKSPACE.snapshot().playing),false,'no autoplay');
    await page.evaluate(async()=>{
      await CT_MUSIC_WORKSPACE.open({source:'song({tempo:180,bars:64});pattern("p",notes("C4 E4 G4 B4").stepsPerBar(4));track("lead").instrument("p0").play("p",{repeat:64});',explicit:true});
      window.visualCalls=[];
      for(const name of ['musicPlay','musicQueue','musicStop','musicPause','musicSeek','playScore','enterCreate']){
        const original=Audio[name];Audio[name]=function(...args){visualCalls.push(name);return original.apply(this,args);};
      }
    });
    await page.locator('[data-action=play]').click();
    await page.waitForFunction(()=>Audio.musicVisualState()?.status==='playing'&&Audio.musicVisualState().frame>4);
    let base=await page.evaluate(()=>({activation:Audio.musicVisualState().activation,source:CT_MUSIC_WORKSPACE.snapshot().draft,
      revision:CT_MUSIC_WORKSPACE.snapshot().validated.id,calls:visualCalls.length}));
    async function musicUnchanged(){
      assert.deepEqual(await page.evaluate(()=>({activation:Audio.musicVisualState().activation,source:CT_MUSIC_WORKSPACE.snapshot().draft,
        revision:CT_MUSIC_WORKSPACE.snapshot().validated.id,calls:visualCalls.length})),base,'visual action leaves music activation/source/commands unchanged');
    }
    await page.locator('.mw-visual-code-disclosure summary').click();
    const code=page.getByLabel('Visual source code',{exact:true});await code.waitFor();
    const original=(await visual()).draft;
    const control=page.locator('[data-visual-control]').first(),controlName=await control.getAttribute('data-visual-control');
    const controlBefore=(await visual()).controls.find(c=>c.name===controlName).value;
    await control.focus();await control.press('ArrowRight');await settle(page);
    assert.notEqual((await visual()).controls.find(c=>c.name===controlName).value,controlBefore);
    assert.equal((await visual()).draft,original,'slider never rewrites program');
    await code.fill(original+'\n// editable layered sketch\n');
    assert.equal((await visual()).state,'draft');
    assert.equal((await visual()).liveSource,original,'typing does not apply');
    await code.press('ControlOrMeta+Enter');await settle(page);
    assert.equal((await visual()).state,'live');assert.match((await visual()).liveSource,/editable layered sketch/);
    await musicUnchanged();
    await code.fill('while(true) {}');await code.press('ControlOrMeta+Enter');await settle(page);
    assert.equal((await visual()).state,'error');assert.match((await visual()).liveSource,/editable layered sketch/);
    await musicUnchanged();
    const heldFrames=(await visual()).renderer.frames;
    await page.waitForFunction(n=>CT_CREATE_PRESENTATION.snapshot().visual.renderer.frames>n,heldFrames);
    await code.fill(original);await code.press('ControlOrMeta+Enter');await settle(page);
    await page.locator('[data-action=visual-freeze]').click();await settle(page);
    const frozen=(await visual()).renderer;
    await page.waitForFunction(n=>Audio.musicVisualState().frame>n,await page.evaluate(()=>Audio.musicVisualState().frame+10));
    assert.equal((await visual()).renderer.phase,frozen.phase);assert.equal((await visual()).renderer.frames,frozen.frames);
    await page.locator('[data-action=visual-blackout]').click();
    assert(await page.locator('.ct-visual-blackout').isVisible());
    await page.locator('[data-action=visual-freeze]').click();await settle(page);
    await page.waitForFunction(n=>CT_CREATE_PRESENTATION.snapshot().visual.renderer.frames>n,frozen.frames);
    await page.locator('[data-action=visual-blackout]').click();await settle(page);assert.equal(await page.locator('.ct-visual-blackout').isVisible(),false);
    await musicUnchanged();
    await page.locator('.mw-scene').selectOption('visual:pulse-grid');
    assert.equal((await visual()).scene,'visual:neon-tunnel','scene choice prepares, not applies');
    await page.locator('.mw-visual-boundary').selectOption('bar');
    await page.waitForFunction(()=>Audio.musicVisualState().grid.gstep%16<4);
    await page.locator('[data-action=visual-apply]').click();assert((await visual()).pending);
    await page.locator('[data-action=visual-cancel]').click();assert.equal((await visual()).pending,null);
    await page.waitForFunction(()=>Audio.musicVisualState().grid.gstep%16<4);
    await page.locator('[data-action=visual-apply]').click();const queued=(await visual()).pending;
    assert(queued&&queued.scene==='visual:pulse-grid');
    await page.waitForFunction(()=>CT_CREATE_PRESENTATION.snapshot().visual.scene==='visual:pulse-grid');
    assert.equal((await visual()).pending,null);assert(await page.evaluate(step=>Audio.musicVisualState().grid.gstep>=step,queued.step));
    await musicUnchanged();
    // Queueing from Off must still poll the acknowledged boundary.
    await page.evaluate(()=>CT_CREATE_PRESENTATION.setScene('off'));
    await page.locator('.mw-scene').selectOption('visual:orbit-loom');
    await page.locator('[data-action=visual-apply]').click();
    await page.waitForFunction(()=>CT_CREATE_PRESENTATION.snapshot().visual.scene==='visual:orbit-loom');
    assert(await page.locator('#stage').isVisible());await musicUnchanged();
    await page.locator('.mw-scene').selectOption('visual:pulse-grid');
    await page.waitForFunction(()=>Audio.musicVisualState().grid.gstep%16<2);
    await page.locator('[data-action=visual-apply]').click();const pauseQueue=(await visual()).pending;assert(pauseQueue);
    await page.locator('[data-action=pause]').click();await page.waitForFunction(()=>Audio.musicVisualState().status==='paused');await settle(page);
    assert.deepEqual((await visual()).pending,pauseQueue,'actual pause holds the selected boundary');
    await page.locator('[data-action=pause]').click();await page.waitForFunction(()=>CT_CREATE_PRESENTATION.snapshot().visual.scene==='visual:pulse-grid');
    await page.locator('.mw-scene').selectOption('visual:neon-tunnel');
    await page.waitForFunction(()=>Audio.musicVisualState().grid.gstep%16<2);
    await page.locator('[data-action=visual-apply]').click();assert((await visual()).pending);
    await page.locator('.mw-seek').focus();await page.locator('.mw-seek').press('Home');
    await page.waitForFunction(()=>!CT_CREATE_PRESENTATION.snapshot().visual.pending);
    assert.match((await visual()).notice,/timeline changed/,'actual seek cancels pending visuals');
    assert.equal((await visual()).scene,'visual:pulse-grid');
    base=await page.evaluate(()=>({activation:Audio.musicVisualState().activation,source:CT_MUSIC_WORKSPACE.snapshot().draft,
      revision:CT_MUSIC_WORKSPACE.snapshot().validated.id,calls:visualCalls.length}));
    // A first procedural draw failure must hold the currently displayed game,
    // not replace it with that renderer's initial/previous framebuffer.
    await page.evaluate(()=>CT_CREATE_PRESENTATION.setScene('blocks'));await settle(page);
    await page.evaluate(()=>CT_CREATE_PRESENTATION.freezeVisuals(true));await settle(page);
    const displayed=await page.evaluate(()=>document.getElementById('stage').toDataURL());
    await page.evaluate(()=>{
      window.originalVisualStroke=CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke=function(...args){
        if(!this.canvas.isConnected&&this.canvas.width===960&&this.canvas.height===540)throw Error('Injected raster failure');
        return originalVisualStroke.apply(this,args);
      };
      CT_CREATE_PRESENTATION.setScene('visual:neon-tunnel');CT_CREATE_PRESENTATION.freezeVisuals(false);
    });
    try{
      await page.waitForFunction(()=>CT_CREATE_PRESENTATION.snapshot().visual.error==='Injected raster failure');
      assert.equal(await page.evaluate(()=>document.getElementById('stage').toDataURL()),displayed,'draw errors preserve the actual displayed frame across renderers');
      await musicUnchanged();
    }finally{await page.evaluate(()=>{CanvasRenderingContext2D.prototype.stroke=originalVisualStroke;delete window.originalVisualStroke;});}
    await page.waitForFunction(()=>!CT_CREATE_PRESENTATION.snapshot().visual.error);
    const phase=(await visual()).renderer.phase;
    await page.locator('.mw-visual-code-disclosure summary').click();await settle(page);
    assert((await visual()).renderer.phase>=phase);
    assert(await page.locator('.mw-stage-viewport').isVisible());
    // Stop, unlike Freeze/Blackout, is the music transport operation.
    await page.locator('[data-action=stop]').click();await page.waitForFunction(()=>Audio.musicVisualState()?.status==='stopped');
    assert.equal((await visual()).blackout,false);assert.equal((await visual()).frozen,false);
    await page.locator('[data-action=visual-reset]').click();await settle(page);assert.equal((await visual()).renderer.phase,0);
    // A paused native panel must update after Visual Apply, too.
    await page.locator('.mw-visual-boundary').selectOption('now');
    for(const mode of ['crt','dmg','nes']){
      await page.evaluate(mode=>window.__rrrScreenMode(mode),mode);
      if(mode!=='crt')await page.waitForFunction(mode=>(mode==='dmg'?_dmg:_nes)?.ready,mode);
      await page.locator('.mw-scene').selectOption('visual:neon-tunnel');await page.locator('[data-action=visual-apply]').click();await settle(page);
      assert.equal((await visual()).state,'live');
      assert(await page.evaluate(()=>{
        const c=document.getElementById('stage'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,s=new Set();
        for(let i=0;i<d.length;i+=Math.max(4,Math.floor(d.length/4096/4)*4))s.add(d[i]+','+d[i+1]+','+d[i+2]);return s.size>3;
      }),mode+' has a non-flat actual framebuffer');
    }
    await page.locator('[data-action=play]').click();await page.waitForFunction(()=>Audio.musicVisualState()?.status==='playing');
    await page.locator('[data-action=visual-panic]').click();await page.waitForFunction(()=>Audio.musicVisualState()?.status==='stopped');
    assert.equal((await visual()).blackout,true);assert.equal((await visual()).pending,null);
    await page.evaluate(async()=>{CT_MUSIC_WORKSPACE.close();await CT_MUSIC_WORKSPACE.open();});await settle(page);
    assert.equal((await visual()).blackout,true);assert(await page.locator('.ct-visual-blackout').isVisible(),'remount restores the whole-output blackout');
    assert.equal(await page.evaluate(()=>visualContexts),1);assert.equal(await page.evaluate(()=>visualMic),0);assert.deepEqual(provider,[]);assert.deepEqual(errors,[]);
    if(process.env.VERIFY_SCREENSHOT){await page.locator('[data-action=visual-blackout]').click();await page.locator('.mw-visual-code-disclosure summary').click();await page.screenshot({path:process.env.VERIFY_SCREENSHOT});}
    console.log('PASS real visual code: independent Apply/shortcut, bounded errors, sliders, queued/cancel/Off activation, freeze/blackout/reset/panic; CRT/DMG/NES; one AudioContext, no capture/provider. '+await page.locator('.mw-build').textContent());
    await ctx.close();
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
