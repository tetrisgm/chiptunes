#!/usr/bin/env node
'use strict';
// Seven live edits through the shipped workspace, not a second demo/player.
// Every HTTP request is intercepted. Only the model/auth/quota are fixtures;
// the handler, compiler, worker, CodeMirror, chart and AudioWorklet are real.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {createMusicChatHandler}=require('../server/music-chat-handler.js');
const language=require('../src/music-language.js');
const {steps}=require('../src/music-cycle-examples.js');
const dist=path.resolve(__dirname,'../dist'),origin='https://chiptunes.app',key='ct-music-workspace-v1';
const requestText='Reverse only the melody on cycles 3 and 7, keeping all other parts and their arrangement unchanged.';
const replyText='Add every(4,"rev",3) to the lead pattern; the bass and drums are unchanged. Review and Apply to use this variation.';

(async()=>{
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  let page,calls=0;const errors=[],routeErrors=[];
  const handler=createMusicChatHandler({origin,authenticate:async()=>({subject:'offline-cycle-owner'}),rateLimit:async()=>true,
    adapter:{authorized:true,async propose(options){
      assert.equal(++calls,1,'one explicit fixture proposal, no retries or paid calls');
      assert.deepEqual(options.tools,[]);assert.equal(options.maxCalls,1);
      for(const syntax of ['cycleV1','every(period,"rev",offset)','song-global','put rev before slow','NOT whole repetitions'])assert(options.system.includes(syntax),syntax+' belongs to trusted server help');
      const input=JSON.parse(options.input);assert.equal(input.source,steps[2].source);assert.equal(input.request,requestText);
      const from=input.source.indexOf('.gate(.55)');assert(from>0);
      const edits=[{from,to:from,text:'.every(4,"rev",3)'}];
      assert.equal(input.source.slice(0,from)+edits[0].text+input.source.slice(from),steps[3].source);
      return new Response(JSON.stringify({id:input.id,baseRevision:input.baseRevision,edits,explanation:replyText})).body;
    }}});
  try{
    const context=await browser.newContext({viewport:{width:1800,height:1100},serviceWorkers:'block'});
    await context.setOffline(true);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      try{
        if(url.origin!==origin)return route.abort();
        if(url.pathname==='/api/music/chat/access'){
          assert.equal(request.method(),'GET');
          return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:true,providers:[{id:'openai',label:'OpenAI'}],limits:{dailyCalls:20}})});
        }
        if(url.pathname==='/api/music/chat'){
          assert.equal(request.method(),'POST');
          const response=await handler(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()}));
          const body=await response.text();assert.equal(response.status,200,body);
          return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
        }
        if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,body:'{}'});
        const file=['/','/create','/create/'].includes(url.pathname)?path.join(dist,'index.html'):path.resolve(dist,'.'+url.pathname);
        if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
        return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
      }catch(error){routeErrors.push(error.message);return route.fulfill({status:500,body:'{}'});}
    });
    await context.addInitScript(()=>{
      window.cycleContexts=[];window.cycleMic=0;
      for(const name of ['AudioContext','webkitAudioContext'])if(window[name])window[name]=new Proxy(window[name],{construct(T,args){const value=Reflect.construct(T,args);cycleContexts.push(value);return value;}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{cycleMic++;throw Error('Capture forbidden');};
    });
    page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error'&&/CodeMirror|Calls to EditorView\.update/.test(message.text()))errors.push(message.text());});
    await page.goto(origin+'/?screen=off');
    const code=page.getByLabel('Musical source code',{exact:true});await code.waitFor();
    await page.waitForFunction(()=>document.querySelector('.mcui-status')?.textContent.startsWith('Unlocked.'));
    const snapshot=()=>page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    const initial=await snapshot();assert.equal(initial.playing,null);
    assert.equal(await page.locator('.mw-live-step option').count(),7);
    await page.evaluate(()=>{
      window.cycleCanvases=Array.from(document.querySelectorAll('.mw-stage-viewport canvas'));
      window.cycleEvents=[];Audio.onMusicState(e=>cycleEvents.push({...e}));
      window.cycleCommands=[];
      for(const name of ['musicPlay','musicQueue','musicPause','musicStop','musicSeek']){
        const original=Audio[name];Audio[name]=function(...args){cycleCommands.push(name);return original.apply(this,args);};
      }
    });
    async function noCommands(start){assert.deepEqual(await page.evaluate(start=>cycleCommands.slice(start),start),[],'guide/preview/history never commands the player');}
    async function commandCount(){return page.evaluate(()=>cycleCommands.length);}
    async function chart(compiled){
      const labels=await page.locator('.mw-notes').evaluate(async pane=>{
        const first=pane.scrollLeft,seen=new Map(),end=Math.max(0,pane.scrollWidth-pane.clientWidth),step=Math.max(1,Math.floor(pane.clientWidth/2));
        const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        for(let left=0;;left=Math.min(end,left+step)){
          pane.scrollLeft=left;await paint();
          pane.querySelectorAll('.mw-note').forEach(n=>seen.set(n.dataset.note,n.getAttribute('aria-label')));
          if(left===end)break;
        }
        pane.scrollLeft=first;await paint();return [...seen.values()].sort();
      });
      const expected=compiled.gb.notes.map(n=>`${['Melody','Harmony','Bass','Drums'][n.ch]} note ${n.midi==null?'noise':n.midi} frame ${n.frame} length ${n.frames}`).sort();
      assert.deepEqual(labels,expected,'chart exposes the complete compiled cycle arrangement');
    }
    async function preview(source){
      await page.waitForFunction(source=>CT_MUSIC_WORKSPACE.snapshot().draft===source,source);
      await page.waitForFunction(()=>document.querySelector('.mw-chart-status').textContent.includes('Draft preview'));
      await chart(language.compile(source));
    }
    async function load(index){
      const before=await snapshot(),start=await commandCount();
      await page.locator('.mw-live-step').selectOption(steps[index].id);
      assert.equal((await snapshot()).draft,before.draft,'browsing examples never changes code');
      assert.equal(await page.locator('.mw-live-step-description').textContent(),steps[index].description);
      await page.getByRole('button',{name:'Load into code',exact:true}).click();
      await preview(steps[index].source);
      const after=await snapshot();assert.equal(after.validated.id,before.validated.id);assert.equal(after.playing,before.playing);
      await noCommands(start);
    }
    async function playing(id){
      await page.waitForFunction(id=>CT_MUSIC_WORKSPACE.snapshot().playing===id&&Audio.musicVisualState()?.revision===id&&Audio.musicVisualState().status==='playing',id);
      await page.waitForFunction(()=>window.__rrrChip?.peak>.001);
    }
    async function apply(source,click=()=>code.press('ControlOrMeta+Enter')){
      const before=await snapshot(),capture=await page.evaluate(()=>({events:cycleEvents.length,commands:cycleCommands.length,boundaries:Audio.musicBoundaries(CT_MUSIC_WORKSPACE.snapshot().validated.compiled)}));
      await click();await page.waitForFunction(id=>CT_MUSIC_WORKSPACE.snapshot().validated.id!==id,before.validated.id);
      const next=await snapshot();assert.equal(next.validated.source,source);await playing(next.validated.id);
      assert.deepEqual(next.validated.compiled.gb,language.compile(source).gb);
      const ack=await page.evaluate(({start,id})=>cycleEvents.slice(start).filter(e=>e.status==='playing'&&e.reason==='activate'&&e.revision===id),{start:capture.events,id:next.validated.id});
      assert.equal(ack.length,1,'one acknowledged activation');
      if(before.playing)assert(capture.boundaries.includes(ack[0].frame),'activation uses the sounding song clock');
      assert.deepEqual(await page.evaluate(start=>cycleCommands.slice(start),capture.commands),[before.playing?'musicQueue':'musicPlay']);
      return snapshot();
    }

    // The example is one isolated editor history entry, even next to typing.
    const personal=initial.draft+'\n// Keep my unfinished idea 🎵';await code.fill(personal);
    await page.locator('.mw-live-guide>summary').click();await load(0);
    await code.press('ControlOrMeta+z');assert.equal((await snapshot()).draft,personal);
    await code.press('ControlOrMeta+Shift+z');await preview(steps[0].source);await noCommands(0);
    await page.locator('.mw-loop').check();let live=await apply(steps[0].source);
    for(const i of [1,2]){await load(i);live=await apply(steps[i].source);}
    console.log('  ok noise → subdivided bass → alternating melody; guide draft/Undo, real preview/Run/boundary audio');

    const beforeProposal=live,start=await commandCount();
    await page.locator('.mcui textarea').fill(requestText);await page.getByRole('button',{name:'Send',exact:true}).click();
    const proposal=page.getByRole('log',{name:'Conversation'}).getByRole('button',{name:'Apply',exact:true});await proposal.waitFor();
    assert.equal((await snapshot()).draft,steps[2].source);assert.equal((await snapshot()).playing,beforeProposal.playing);await noCommands(start);
    live=await apply(steps[3].source,()=>proposal.click());
    assert.deepEqual(live.validated.compiled.gb.notes.filter(n=>n.ch!==0),beforeProposal.validated.compiled.gb.notes.filter(n=>n.ch!==0),'reviewed cycle variation preserves bass and drums');
    for(const i of [4,5,6]){await load(i);live=await apply(steps[i].source);}
    const full=live;
    live=await apply(steps[5].source,()=>page.locator('[data-action=undo]').click());
    live=await apply(steps[6].source,()=>page.locator('[data-action=redo]').click());
    assert.deepEqual(live.validated.compiled.gb,full.validated.compiled.gb);
    console.log('  ok reviewed periodic reversal → Euclidean drums → rests → restoration; exact revision Undo/Redo');

    // The visual half of the build-up exercise: while the restored arrangement
    // is still sounding, the shared stage must actually be drawing and its
    // music-derived signals must actually move, with the music phase unbroken.
    // This shows both surfaces are live and fed from the same acknowledged
    // clock. It is not a pixel-level causal proof and is not a claim about
    // Safari or a second display.
    const correspondence=()=>page.evaluate(()=>{
      const v=CT_CREATE_PRESENTATION.snapshot().visual,a=Audio.musicVisualState();
      return {scene:v.scene,enabled:v.enabled,state:v.state,frames:v.renderer.frames,hasFrame:v.renderer.hasFrame,
        signals:JSON.stringify(v.renderer.signals),phase:a&&a.frame,activation:a&&a.activation,
        revision:a&&a.revision,status:a&&a.status};
    });
    const visual0=await correspondence();
    assert.equal(visual0.enabled,true,'the persistent stage is running beside the music');
    assert.equal(visual0.status,'playing','the restored arrangement is still sounding');
    await page.waitForFunction(f=>CT_CREATE_PRESENTATION.snapshot().visual.renderer.frames>f+10,visual0.frames);
    const visual1=await correspondence();
    assert.ok(visual1.frames>visual0.frames,'the stage draws while the arrangement sounds');
    assert.equal(visual1.hasFrame,true,'and has published a complete frame');
    assert.ok(visual1.phase>visual0.phase,'the music phase advances across the same window');
    assert.equal(visual1.activation,visual0.activation,'with no new activation');
    assert.equal(visual1.revision,visual0.revision,'and no revision change');
    assert.notEqual(visual1.signals,visual0.signals,'music-derived visual signals move with the arrangement');
    console.log('  ok note/visual correspondence during the sounding arrangement, with continuous phase');

    // Honest error fallback: neither invalid text nor a failed Run affects sound.
    const stable=await snapshot(),invalid=steps[6].source.replace('cycleV1("C2(3,8)")','cycleV1("C2").slow(2).rev()'),invalidStart=await commandCount();
    await code.fill(invalid);
    await page.waitForFunction(()=>document.querySelector('.mw-chart-status').textContent.includes('draft has errors'));
    assert.match(await page.locator('.mw-diagnostics').textContent(),/crossing a cycle/);
    await code.press('ControlOrMeta+Enter');assert.equal((await snapshot()).validated.id,stable.validated.id);assert.equal((await snapshot()).playing,stable.playing);
    await noCommands(invalidStart);await chart(stable.validated.compiled);
    await code.fill(stable.draft);
    await page.locator('.mw-live-guide>summary').click();
    const layoutStart=await commandCount();
    await page.locator('[data-action=toggle-chat]').click();
    await page.getByRole('button',{name:'Focus visuals',exact:true}).click();
    await page.getByRole('button',{name:'Return to composition',exact:true}).click();
    await page.locator('[data-action=toggle-chat]').click();await noCommands(layoutStart);
    assert(await page.evaluate(()=>{const now=Array.from(document.querySelectorAll('.mw-stage-viewport canvas'));return now.length===cycleCanvases.length&&now.every((el,i)=>el===cycleCanvases[i]);}),'one persistent visual world');
    assert.deepEqual(await page.evaluate(()=>({contexts:cycleContexts.length,mic:cycleMic})),{contexts:1,mic:0});
    await page.locator('[data-action=stop]').click();
    await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().playing===null);
    // Save/reload the compact program and an unfinished error, never a flattened dump.
    await code.fill(stable.draft+'\n// My next change\ncycleV1(');
    const unfinished=(await snapshot()).draft;
    await page.locator('.mw-project-tools>summary').click();await page.locator('[data-action=save]').click();
    await page.waitForFunction(({key,source})=>JSON.parse(localStorage.getItem(key))?.draft===source,{key,source:unfinished});
    await page.reload();await code.waitFor();
    const restored=await snapshot();assert.equal(restored.draft,unfinished);assert.equal(restored.validated.source,stable.draft);
    assert.deepEqual(restored.validated.compiled.gb,stable.validated.compiled.gb);assert.equal(restored.playing,null);assert.equal(restored.pending,null);
    await page.getByRole('log',{name:'Conversation'}).getByText(replyText,{exact:true}).waitFor();
    assert.equal(await page.getByRole('log',{name:'Conversation'}).getByRole('button',{name:'Apply',exact:true}).count(),0,'reload does not revive proposals');
    const exact=await page.evaluate(()=>{const c=CT_MUSIC_WORKSPACE.snapshot().validated.compiled;return CT_MUSIC_LANGUAGE.materialize(c.gb,c.settings);});
    const materialized=language.compile(exact);assert.deepEqual(materialized.gb,stable.validated.compiled.gb);assert.deepEqual(materialized.settings,stable.validated.compiled.settings);
    assert.equal(calls,1);assert.deepEqual(routeErrors,[]);assert.deepEqual(errors,[]);
    console.log('  ok invalid draft retains sound/chart; save/reload preserves readable code, unfinished draft, private chat and exact materialization');
    console.log('PASS cycle live-set workflow ('+await page.locator('.mw-build').textContent()+'); no provider/microphone/deployment.');
    await page.evaluate(async()=>{CT_MUSIC_WORKSPACE.close();await Promise.allSettled(cycleContexts.map(c=>c.close()));});
    await context.close();
  }catch(error){if(page&&!page.isClosed())console.error(await page.locator('.mw-status,.mw-chart-status,.mw-diagnostics,.mcui-proposal').allTextContents());if(routeErrors.length)console.error(routeErrors);throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
