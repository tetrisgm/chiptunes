'use strict';
// Real popup/postMessage across the exact HTTPS origins, serving only local build
// bytes. No live gateway, credentials, model, deployment or source in a URL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const project=require('../src/music-project'),language=require('../src/music-language');
const dist=path.join(__dirname,'../dist'),key='ct-music-workspace-v1';
const html=fs.readFileSync(path.join(dist,'create/index.html'),'utf8');
const app=html.match(/app\.[a-f0-9]+\.js/)[0];
const appSource=fs.readFileSync(path.join(dist,app),'utf8');
const assets=appSource.match(/CT_MUSIC_ASSETS_VERSION="([^"]+)"/)[1];
const options={compile:language.compile,assetsVersion:assets};
const sender=project.create('song({tempo:120,bars:1})\n// sender valid\n',{...options,provenance:{private:'private-transfer-fixture'}});
sender.editDraft(sender.snapshot().draft+'// '+'🎵'.repeat(40000)+'\nbroken(');
const original=sender.serialize({includePrivate:true}),publicCopy=sender.serialize();
assert(Buffer.byteLength(publicCopy)>150000,'fixture exceeds share-link limit with Unicode source');
assert(JSON.parse(publicCopy).draft.startsWith('song({tempo:120,bars:1})'),'fixture retains the valid song prefix');
const hosted=project.create('song({tempo:140,bars:2})\n// hosted original\n',options).serialize();
const origin='https://chiptunes.app',gateway='https://chiptunes-agent-gateway.vercel.app';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:1000}});let modelCalls=0,sessionCreates=0;
    await context.setOffline(true);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(![origin,gateway].includes(url.origin))return route.abort();
      // New document navigation keeps routing local; a fulfilled HTTP redirect
      // can bypass Playwright routing for its subsequent network request.
      if(url.pathname==='/create')return route.fulfill({contentType:'text/html',body:'<script>location.replace("/create/"+location.hash)</script>'});
      if(url.pathname==='/api/music/chat'){modelCalls++;return route.fulfill({status:503,body:'{}'});}
      if(url.pathname==='/api/music-agent'){if(request.postDataJSON()?.action==='create')sessionCreates++;return route.fulfill({status:503,body:'{}'});}
      if(url.pathname==='/api/music/chat/access')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:false,providers:[],limits:{dailyCalls:20}})});
      if(url.pathname==='/api/auth')return route.fulfill({contentType:'text/javascript',body:'export async function ready(){throw Error("unconfigured")};export async function getSessionToken(){throw Error("unconfigured")}'});
      // Freeze the matching artifact pair: main may build concurrently.
      if(url.pathname==='/create/')return route.fulfill({contentType:'text/html',body:html});
      if(url.pathname==='/'+app)return route.fulfill({contentType:'text/javascript',body:appSource});
      const file=path.resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));
      if(!file.startsWith(dist+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
    });
    await context.addInitScript(({origin,gateway,original,hosted,key})=>{
      localStorage.setItem('ct-create-tour','1');
      if(!localStorage.getItem(key))localStorage.setItem(key,location.origin===origin?original:hosted);
      window.handoffMessages=0;window.handoffPrivate=false;
      addEventListener('message',e=>{if(e.origin===origin&&e.data?.type==='project'){
        handoffMessages++;handoffPrivate=Object.hasOwn(JSON.parse(e.data.serialized),'private');
      }});
    },{origin,gateway,original,hosted,key});
    const page=await context.newPage(),bootstrapErrors=[];
    page.on('pageerror',e=>bootstrapErrors.push(e.message));page.on('requestfailed',r=>bootstrapErrors.push(new URL(r.url()).pathname));page.on('response',r=>{if(r.status()>=400)bootstrapErrors.push(r.status()+' '+new URL(r.url()).pathname);});
    await page.goto(origin+'/create#music');
    await page.waitForFunction(()=>typeof CT_MUSIC_WORKSPACE==='object');
    await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content',{state:'attached'});
    assert.equal(await page.locator('[data-action=project-handoff]').isVisible(),false,'main-site chat has no second-workspace handoff bar');
    async function popup(){
      // Explicit compatibility transport fixture, not a primary product action.
      const opened=page.waitForEvent('popup');await page.evaluate(serialized=>{
        window.testTransferResult=null;window.testTransfer=CT_MUSIC_PROJECT_TRANSFER.send(serialized);
        testTransfer.result.then(result=>{window.testTransferResult=result;});
      },publicCopy);const next=await opened;
      await next.waitForFunction(()=>document.querySelector('[data-action=transfer-accept]')?.disabled===false);
      assert.equal(new URL(next.url()).hash,'#music','nonce consumed before workspace route rewrite');
      assert.equal(await next.locator('.mw-project-handoff').isVisible(),false,'sender action is main-origin only');
      assert.equal(await next.evaluate(()=>handoffMessages),0,'only bytes offered before Accept');
      assert((await next.locator('.mw-transfer-description').textContent()).includes(String(Buffer.byteLength(publicCopy))));
      assert.equal(await next.locator('[data-action=toggle-chat]').getAttribute('aria-expanded'),'false','narrow desktop chat stays collapsed');
      assert.equal(await next.locator('[data-action=transfer-accept]').isVisible(),true,'project consent is visible independently of chat');
      assert.equal(await next.locator('.mw-chat .mw-transfer-offer').count(),0,'incoming project is not chat content');
      return next;
    }
    const accepted=await popup();
    assert.equal(await accepted.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),JSON.parse(hosted).draft);
    await accepted.locator('[data-action=transfer-accept]').click();
    await accepted.waitForFunction(()=>document.querySelector('.mw-transfer-description').textContent.startsWith('Project accepted'));
    const state=await accepted.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    assert.equal(state.draft,JSON.parse(publicCopy).draft);assert.equal(state.validated.source,JSON.parse(publicCopy).lastValid.source);
    assert.equal(state.playing,null);assert.equal(state.pending,null);assert.equal(await accepted.evaluate(()=>handoffPrivate),false);
    assert.equal(await accepted.evaluate(key=>localStorage.getItem(key),key),hosted,'hosted storage not replaced');
    accepted.once('dialog',dialog=>dialog.dismiss());
    await accepted.locator('.mw-project-tools>summary').click();
    await accepted.locator('[data-action=save]').click();await accepted.waitForTimeout(350);
    assert((await accepted.locator('.mw-status').textContent()).includes('temporary copy'));
    assert.equal(await accepted.evaluate(key=>localStorage.getItem(key),key),hosted,'declined replacement protects hosted draft');
    await accepted.evaluate(()=>CT_MUSIC_WORKSPACE.close());
    assert.equal(await accepted.evaluate(key=>localStorage.getItem(key),key),hosted,'close cannot autosave transferred source');
    await accepted.close();
    await page.waitForFunction(()=>window.testTransferResult?.ok);
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),JSON.parse(original).draft);
    const cancelled=await popup();await cancelled.locator('[data-action=transfer-cancel]').click();
    assert.equal(await cancelled.evaluate(()=>handoffMessages),0);assert.equal(await cancelled.evaluate(key=>localStorage.getItem(key),key),hosted);await cancelled.close();
    const incompatible=await popup();
    // Force local incompatibility after consent; receiver must retain its project.
    await incompatible.evaluate(()=>{CT_MUSIC_PROJECT.restore=()=>({ok:false,code:'incompatible-project'});});
    await incompatible.locator('[data-action=transfer-accept]').click();
    await incompatible.waitForFunction(()=>document.querySelector('.mw-transfer-description').textContent.includes('incompatible'));
    assert.equal(await incompatible.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),JSON.parse(hosted).draft);await incompatible.close();
    const closing=await popup();
    await closing.evaluate(async()=>{document.querySelector('[data-action=transfer-accept]').click();await Promise.resolve();CT_MUSIC_WORKSPACE.close();});
    await closing.waitForTimeout(150);
    assert.equal(await closing.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),JSON.parse(hosted).draft,'close after Accept prevents late swap');
    await closing.close();
    const changed=await popup();
    await changed.locator('#musicworkspace .cm-content').click();await changed.locator('.cm-content').press('ControlOrMeta+End');await changed.keyboard.insertText('\n// hosted edit while consent pending');
    // Click synchronously after the edit, before the 250ms save timer fires.
    assert.equal(await changed.evaluate(key=>{
      const pending=!JSON.parse(localStorage.getItem(key)).draft.includes('hosted edit while consent pending');
      document.querySelector('[data-action=transfer-accept]').click();return pending;
    },key),true,'Accept happens before the pending 250ms save');
    await changed.waitForFunction(()=>document.querySelector('.mw-transfer-description').textContent.includes('Workspace changed'));
    assert.equal(await changed.evaluate(()=>handoffMessages),0,'changed workspace declines before source delivery');
    assert((await changed.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft)).includes('hosted edit while consent pending'));
    await changed.waitForTimeout(400);
    assert(JSON.parse(await changed.evaluate(key=>localStorage.getItem(key),key)).draft.includes('hosted edit while consent pending'),'declining transfer preserves the pending hosted save');
    await changed.close();
    const persisted=await popup();
    await persisted.locator('[data-action=transfer-accept]').click();
    await persisted.waitForFunction(()=>document.querySelector('.mw-transfer-description').textContent.startsWith('Project accepted'));
    persisted.once('dialog',dialog=>dialog.accept()); // Explicit replacement of this test-owned fixture only.
    await persisted.locator('.mw-project-tools>summary').click();
    await persisted.locator('[data-action=save]').click();
    await persisted.waitForFunction(()=>document.querySelector('.mw-status').textContent==='Project saved locally.');
    await persisted.reload();
    await persisted.waitForSelector('#musicworkspace:not([hidden]) .cm-content',{state:'attached'});
    const recovered=await persisted.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    assert.equal(recovered.draft,JSON.parse(publicCopy).draft,'confirmed transferred draft survives reload');
    assert.equal(recovered.validated.source,JSON.parse(publicCopy).lastValid.source,'last valid revision survives reload');
    assert.equal(recovered.playing,null);await persisted.close();
    assert.equal(modelCalls,0);assert.equal(sessionCreates,0);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),original,'sender private recovery remains local');
    console.log('PASS project handoff browser: exact-origin popup + path normalization, >150KB Unicode, metadata-only consent, draft/lastValid preserved, private excluded, hosted storage/save/close protected, Cancel, incompatible restore, close during Accept, pending edits protected, no automatic model/play/connect');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
