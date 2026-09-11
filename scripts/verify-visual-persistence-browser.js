#!/usr/bin/env node
'use strict';
// Actual shared artifact: does a reopened project restore its audiovisual
// composition? Unit checks prove the stage and record primitives; only this
// exercises the real save path through localStorage and a real page reload.
// Chromium only. Not native Safari, physical input or output-window acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.resolve(__dirname,'../dist');
const KEY='ct-music-workspace-v1';
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'};
const SONG='song({tempo:150,bars:8});pattern("p",notes("C4 E4 G4 B4").stepsPerBar(4));track("lead").instrument("p0").play("p",{repeat:8});';
const PROGRAM=[
  'visual({background:"#101020",palette:["#ff0066","#00ffcc"],feedback:0.5,seed:3});',
  'control("motion",{label:"Motion",min:0,max:2,step:0.01,value:0.5});',
  'layer("orbits",{count:8,size:0.4,speed:param("motion"),spin:0.1,spread:1,hue:1,opacity:0.8,react:signal("bass.hit",1),thickness:1});'
].join('\n');

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
      window.visualContexts=0;window.visualMic=0;
      for(const name of ['AudioContext','webkitAudioContext'])if(window[name])window[name]=new Proxy(window[name],{construct(T,a){visualContexts++;return Reflect.construct(T,a);}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{visualMic++;throw Error('Forbidden capture');};
    });
    const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    const ready=async()=>{
      await page.waitForFunction(()=>window.CT_CREATE_PRESENTATION?.snapshot().visual&&window.CT_MUSIC_WORKSPACE?.snapshot()?.validated);
    };
    const record=async()=>page.evaluate(k=>{const raw=localStorage.getItem(k);return raw?JSON.parse(raw):null;},KEY);
    const stage=async()=>page.evaluate(()=>CT_CREATE_PRESENTATION.snapshot().visual);
    const saved=async()=>{await page.waitForTimeout(400);return record();};

    await page.goto(origin+'/?screen=off');
    await ready();
    await page.evaluate(async song=>{await CT_MUSIC_WORKSPACE.open({source:song,explicit:false});},SONG);
    await page.waitForTimeout(400);

    await check('an untouched default stage writes no visual block',async()=>{
      const r=await record();
      assert.ok(r,'the project is saved locally');
      assert.equal(r.visual,undefined,'a music-only project carries no visual key');
      assert.equal((await stage()).scene,'visual:neon-tunnel');
    });

    await check('applying an edited visual program saves scene, source and values',async()=>{
      await page.evaluate(src=>{CT_CREATE_PRESENTATION.setVisualDraft(src);CT_CREATE_PRESENTATION.applyVisual('now');},PROGRAM);
      await page.evaluate(()=>CT_CREATE_PRESENTATION.setVisualControl('motion',1.75));
      const r=await saved();
      assert.ok(r.visual,'the record gained a visual block');
      // Editing a preset deliberately KEEPS its identity; only editing from a
      // non-program scene becomes visual:custom.
      assert.equal(r.visual.scene,'visual:neon-tunnel');
      assert.ok(r.visual.source.includes('orbits'),'the edited program source is saved');
      assert.equal(r.visual.values.motion,1.75,'the tuned control value is saved');
      assert.equal(r.version,1,'persisting visuals does not bump the record version');
    });

    await check('a real reload restores the audiovisual composition',async()=>{
      const before=await stage();
      const musicBefore=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
      await page.reload();
      await ready();
      await page.waitForTimeout(300);
      const after=await stage();
      assert.equal(after.scene,before.scene,'scene survives reload');
      assert.ok(after.liveSource.includes('orbits'),'edited visual source survives reload');
      const motion=after.controls.find(c=>c.name==='motion');
      assert.ok(motion,'the restored program still declares its control');
      assert.equal(motion.value,1.75,'control value survives reload');
      assert.equal(after.state,'live','the restored visual is live, not a pending draft');
      assert.equal(after.frozen,false);assert.equal(after.blackout,false);
      const music=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
      assert.equal(music.draft,musicBefore,'the music source is byte-identical across the reload');
      assert.equal(!!music.playing,false,'restoring a visual never starts playback');
    });

    await check('returning to the untouched default clears the saved visual',async()=>{
      // Re-selecting the SAME scene deliberately retains its tuned values, so a
      // genuine return to the default goes via another scene, which resets them.
      await page.evaluate(()=>{CT_CREATE_PRESENTATION.selectVisualDraft('visual:pulse-grid');CT_CREATE_PRESENTATION.applyVisual('now');});
      await page.waitForTimeout(300);
      await page.evaluate(()=>{CT_CREATE_PRESENTATION.selectVisualDraft('visual:neon-tunnel');CT_CREATE_PRESENTATION.applyVisual('now');});
      const r=await saved();
      assert.equal(r.visual,undefined,'the stale visual block is removed, not left behind');
    });

    await check('a corrupt saved visual still opens the music',async()=>{
      const musicBefore=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
      await page.evaluate(k=>{
        const r=JSON.parse(localStorage.getItem(k));
        // Valid at the record layer, so it reaches the stage; the stage is the
        // one that must reject it. A block that is malformed at the record
        // layer is dropped earlier and is covered by verify-music-project.
        r.visual={scene:'visual:custom',source:'this is not a visual program',values:{}};
        localStorage.setItem(k,JSON.stringify(r));
      },KEY);
      await page.reload();
      await ready();
      const after=await stage(),music=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
      assert.equal(after.scene,'visual:neon-tunnel','the stage falls back to its default scene');
      assert.match(after.notice,/could not be restored/,'and says so rather than failing silently');
      assert.equal(music.draft,musicBefore,'the music source is untouched');
    });

    await check('a visual that failed to restore is NOT erased by the fallback default',async()=>{
      // The stage is now sitting on its default because the saved visual could
      // not be applied. A save must not interpret that as "the user cleared
      // it": doing so would permanently destroy a composition that a different
      // build could still read.
      const before=await record();
      assert.ok(before.visual,'precondition: the unreadable visual is still stored');
      // Drive a real save. Typing into CodeMirror through Playwright does not
      // produce a document change (see docs/music-workspace.md), so a keystroke
      // here would make this check pass vacuously.
      page.once('dialog',d=>d.accept());
      await page.locator('.mw-project-tools>summary').click();
      await page.locator('[data-action=save]').click();
      const after=await saved();
      assert.ok(after.visual,'the unreadable visual survives an unrelated music save');
      assert.deepEqual(after.visual,before.visual,'and is preserved byte for byte');
    });

    await check('authoring a new visual after a failed restore does save',async()=>{
      await page.evaluate(src=>{CT_CREATE_PRESENTATION.setVisualDraft(src);CT_CREATE_PRESENTATION.applyVisual('now');},PROGRAM);
      const r=await saved();
      assert.ok(r.visual.source.includes('orbits'),'a deliberate new visual replaces the unreadable one');
    });

    await check('panel geometry persists in its own key and never enters the project record',async()=>{
      // Checkbox 2: local viewing preferences are durable but separate from
      // portable composition data. A record that carried them would ship one
      // machine's window arrangement to everyone who opened the link.
      const LAYOUT='ct-music-layout-v1';
      await page.evaluate(()=>{
        document.querySelector('.mw-stage-splitter').focus();
        for(let i=0;i<5;i++)document.querySelector('.mw-stage-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
        document.querySelector('.mw-splitter').focus();
        for(let i=0;i<5;i++)document.querySelector('.mw-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));
      });
      await page.waitForTimeout(400);
      const layout=await page.evaluate(k=>{const raw=localStorage.getItem(k);return raw?JSON.parse(raw):null;},LAYOUT);
      assert.ok(layout,'a separate layout key is written');
      assert.equal(typeof layout.musicShare,'number');
      assert.equal(typeof layout.chartShare,'number');
      const before=await page.evaluate(()=>({music:+getComputedStyle(document.querySelector('.mw-creative')).getPropertyValue('--music-share').trim().replace('fr',''),
        chart:+getComputedStyle(document.querySelector('.mw-composition')).getPropertyValue('--chart-share').trim().replace('fr','')}));
      // The project record must carry none of it.
      const raw=await page.evaluate(k=>localStorage.getItem(k),KEY);
      for(const key of ['musicShare','chartShare','desktopChatOpen','mobileChatOpen','visualCodeOpen'])
        assert.equal(raw.includes(key),false,'project record must not contain '+key);
      // And it survives a reload.
      await page.reload();await ready();await page.waitForTimeout(300);
      const after=await page.evaluate(()=>({music:+getComputedStyle(document.querySelector('.mw-creative')).getPropertyValue('--music-share').trim().replace('fr',''),
        chart:+getComputedStyle(document.querySelector('.mw-composition')).getPropertyValue('--chart-share').trim().replace('fr','')}));
      assert.deepEqual(after,before,'panel geometry is restored from its own key');
      assert.notEqual(after.music,62,'and is the adjusted value, not the default');
    });

    await check('no page errors, one AudioContext, no provider or capture calls',async()=>{
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>visualMic),0,'no microphone request');
      assert.equal(provider.length,0,'no provider call');
      assert.ok(await page.evaluate(()=>visualContexts)<=1,'at most one AudioContext');
    });
  }catch(error){failures++;console.error('FAIL harness: '+(error.stack||error));}
  finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
  const build=(()=>{try{const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');const m=html.match(/app\.[0-9a-f]+\.js/);return m?m[0]:'dist';}catch(e){return 'dist';}})();
  if(failures){console.error(`verify-visual-persistence-browser: ${failures} failed`);process.exitCode=1;}
  else console.log(`PASS audiovisual persistence (${build}); reload restores scene/source/values; Chromium only, no provider/microphone/deployment.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
