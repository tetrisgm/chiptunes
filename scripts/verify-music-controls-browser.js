#!/usr/bin/env node
'use strict';
// Real shared artifact, compiler, preview worker, CodeMirror history and chip.
// All HTTP is intercepted with local files; no provider, microphone or deployment.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.resolve(__dirname,'../dist'),origin='https://chiptunes.app';
const source=`// Preserve comments, Unicode 🎵 and untouched numeric spelling.
song({tempo:180,bars:8});
pattern("lead",notes("C4 E4 G4 B4").stepsPerBar(4).gate(/* length */ 9.123456e-1).velocity(0.70).transpose(-02));
track("lead").instrument("p0").transpose(12).play("lead",{repeat:8});
`;
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try{
    const context=await browser.newContext({viewport:{width:1800,height:1100},serviceWorkers:'block'});
    const errors=[],provider=[];
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/api/music/chat'){provider.push(request.method());return route.abort();}
      if(url.pathname==='/api/music/chat/access')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:false,providers:[]})});
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,body:'{}'});
      const file=['/','/create','/create/'].includes(url.pathname)?path.join(dist,'index.html'):path.resolve(dist,'.'+url.pathname);
      if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
    });
    await context.addInitScript(()=>{
      window.controlContexts=[];window.controlMic=0;
      for(const name of ['AudioContext','webkitAudioContext'])if(window[name])window[name]=new Proxy(window[name],{construct(T,args){const value=Reflect.construct(T,args);controlContexts.push(value);return value;}});
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{controlMic++;throw Error('Capture forbidden');};
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    page.on('console',message=>{if(message.type()==='error'&&/CodeMirror|Calls to EditorView\.update/.test(message.text()))errors.push(message.text());});
    await page.goto(origin+'/?screen=off');
    await page.getByLabel('Musical source code',{exact:true}).waitFor();
    const code=page.getByLabel('Musical source code',{exact:true});
    const numbers=page.locator('.mw-code .cm-source-control input[type=number]');
    const snapshot=()=>page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    const gate=()=>page.getByRole('spinbutton',{name:'pattern lead gate (all uses) value',exact:true});
    const gateRange=()=>page.getByRole('slider',{name:'pattern lead gate (all uses) slider',exact:true});
    async function waitControls(){await page.waitForFunction(()=>document.querySelectorAll('.mw-code .cm-source-control input[type=number]').length===4);}
    await code.fill(source);await waitControls();
    assert.equal((await snapshot()).draft,source,'mounting controls never normalizes literal text');
    assert.equal((await snapshot()).playing,null,'preview controls never autoplay');
    assert.equal(await numbers.count(),4,'real compiler exposes pattern and track literals');
    await page.locator('.mw-loop').check();await code.press('ControlOrMeta+Enter');
    await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().playing===CT_MUSIC_WORKSPACE.snapshot().validated.id&&Audio.musicVisualState()?.status==='playing');
    const first=await snapshot();
    assert.equal(first.validated.source,source);assert.equal(first.validated.compiled.controls.length,4);
    await page.evaluate(()=>{
      window.controlCommands=[];
      for(const name of ['musicPlay','musicQueue','musicPause','musicStop','musicSeek']){
        const original=Audio[name];Audio[name]=function(...args){controlCommands.push(name);return original.apply(this,args);};
      }
    });
    const initial=await page.evaluate(()=>({revision:CT_MUSIC_WORKSPACE.snapshot().playing,activation:Audio.musicVisualState().activation}));
    async function unchanged(){
      assert.deepEqual(await page.evaluate(()=>({revision:CT_MUSIC_WORKSPACE.snapshot().playing,activation:Audio.musicVisualState().activation})),initial);
      assert.deepEqual(await page.evaluate(()=>controlCommands),[],'source controls/preview never issue transport commands');
    }
    await gate().fill('0.8');await code.focus();
    const edited=source.replace('9.123456e-1','0.8');
    await page.waitForFunction(text=>CT_MUSIC_WORKSPACE.snapshot().draft===text,edited);await waitControls();
    assert.equal((await snapshot()).draft,edited,'one exact literal patch preserves all other source');
    assert.equal((await snapshot()).validated.source,source,'control edits remain an unapplied draft');
    assert.match(await page.locator('.mw-chart-status').textContent(),/Draft preview/);
    await unchanged();
    // A slow, repeated native keyboard gesture is still one history entry.
    await gateRange().focus();await page.keyboard.down('ArrowLeft');await page.waitForTimeout(650);
    await page.keyboard.down('ArrowLeft');await page.waitForTimeout(650);await page.keyboard.up('ArrowLeft');
    await waitControls();const dragged=(await snapshot()).draft;
    assert.notEqual(dragged,edited);await gateRange().focus();await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(text=>CT_MUSIC_WORKSPACE.snapshot().draft===text,edited);await waitControls();
    await code.focus();
    await code.press('ControlOrMeta+z');await page.waitForFunction(text=>CT_MUSIC_WORKSPACE.snapshot().draft===text,source);await waitControls();
    await code.press('ControlOrMeta+Shift+z');await page.waitForFunction(text=>CT_MUSIC_WORKSPACE.snapshot().draft===text,edited);await waitControls();
    await code.press('ArrowLeft');assert.equal(await numbers.count(),4,'normal cursor movement retains controls');
    await unchanged();
    // Invalid/foreign text revokes controls immediately; an old DOM callback
    // cannot mutate it or restore an earlier compiler result.
    await gate().evaluate(el=>window.retiredMusicControl=el);
    await code.fill(edited+'broken(');
    await page.waitForFunction(()=>document.querySelectorAll('.mw-code .cm-source-control input').length===0);
    await page.evaluate(()=>{retiredMusicControl.value='.4';retiredMusicControl.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal((await snapshot()).draft,edited+'broken(');
    await code.press('ControlOrMeta+Enter');await unchanged();
    await code.fill(edited);await waitControls();
    await code.press('ControlOrMeta+Enter');
    await page.waitForFunction(id=>{const s=CT_MUSIC_WORKSPACE.snapshot();return s.validated.id!==id&&s.playing===s.validated.id;},first.validated.id);
    const applied=await snapshot();
    assert.equal(applied.validated.source,edited);
    assert.notEqual(applied.validated.compiled.gb.notes[0].frames,first.validated.compiled.gb.notes[0].frames);
    assert.equal(applied.validated.compiled.gb.notes[0].midi,first.validated.compiled.gb.notes[0].midi);
    assert.deepEqual(await page.evaluate(()=>controlCommands),['musicQueue'],'only explicit Run queues the changed score');
    // Opening an equal-source project must revoke the prior project's handles
    // even when the CodeMirror document does not change.
    await gate().evaluate(el=>window.retiredMusicControl=el);
    await page.evaluate(()=>{retiredMusicControl.dispatchEvent(new Event('pointerdown'));retiredMusicControl.value='.6';retiredMusicControl.dispatchEvent(new Event('input',{bubbles:true}));});
    const replacement=(await snapshot()).draft;
    await page.evaluate(async source=>CT_MUSIC_WORKSPACE.open({source,explicit:true}),replacement);await waitControls();
    await page.evaluate(()=>{retiredMusicControl.value='.3';retiredMusicControl.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal((await snapshot()).draft,replacement,'equal-source new project invalidates old gesture authority');
    assert.equal((await snapshot()).playing,null,'import stays stopped');
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());
    await page.evaluate(()=>{retiredMusicControl.value='.2';retiredMusicControl.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal((await snapshot()).draft,replacement);
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());await waitControls();
    assert.equal((await snapshot()).draft,replacement,'reopen restores current compiler controls without a source edit');
    const exact=await page.evaluate(()=>{const c=CT_MUSIC_WORKSPACE.snapshot().validated.compiled;return CT_MUSIC_LANGUAGE.materialize(c.gb,c.settings);});
    await code.fill(exact);await page.waitForFunction(()=>/Draft preview/.test(document.querySelector('.mw-chart-status').textContent));
    assert.equal(await numbers.count(),0,'exact event imports stay code-only');
    assert.equal((await snapshot()).draft,exact);
    assert.deepEqual(provider,[]);assert.deepEqual(errors,[]);
    assert.deepEqual(await page.evaluate(()=>({contexts:controlContexts.length,mic:controlMic})),{contexts:1,mic:0});
    console.log('PASS real music controls: compiler/worker metadata, exact patches, grouped undo/redo, draft-only sound, explicit boundary Run, stale DOM/project/close isolation and exact-source fallback. '+await page.locator('.mw-build').textContent());
    await page.evaluate(async()=>{CT_MUSIC_WORKSPACE.close();await Promise.allSettled(controlContexts.map(c=>c.close()));});
    await context.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
