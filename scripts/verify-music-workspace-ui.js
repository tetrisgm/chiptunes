'use strict';
// Source UI with the existing CodeMirror artifact. Offline exact-origin browser
// fixtures; no model, deployment or credentials.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    for(const origin of ['https://chiptunes.app','https://chiptunes-agent-gateway.vercel.app']){
      const page=await browser.newPage({viewport:{width:1280,height:900}});let accessCalls=0;
      await page.context().setOffline(true);
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/create')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
        if(url.pathname==='/api/music/chat/access'){accessCalls++;return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:false,providers:[{id:'openai',label:'OpenAI'}],limits:{dailyCalls:20}})});}
        return route.abort();
      });
      await page.goto(origin+'/create');
      async function boot(){
      for(const file of ['gb-hardware.js','music-language.js','music-project.js','music-chat.js','music-project-transfer.js'])await page.addScriptTag({path:path.resolve('src',file)});
      await page.addScriptTag({path:path.resolve('dist/lib/music-code-editor.js')});
      await page.evaluate(()=>{window.Audio={musicStop(){},enterCreate(){},onMusicState(cb){window.audioFixture=cb;return ()=>{};}};window.CT_CREATE={};});
      await page.addScriptTag({path:path.resolve('src/music-workspace.js')});await page.addStyleTag({path:path.resolve('src/music-workspace.css')});
      await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
      }
      await boot();
      assert.equal(await page.locator('#musicworkspace').getAttribute('data-view'),'code','fresh workspace opens in Code');
      assert.equal(await page.locator('.mw-loop').isChecked(),true,'starter audition loops');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null,'starter is silent until Run');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.compiled.mapping.every(m=>!!m.pattern)),true,'starter compiles to pattern-mapped notes');
      assert((await page.locator('[data-action=apply]').textContent()).includes('Run'));
      assert.equal(await page.locator('[data-action=new-loop]').isVisible(),true);
      const starter=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
      await page.locator('[data-action=save]').click();
      await page.waitForFunction(()=>!!localStorage.getItem('ct-music-workspace-v1'));
      await page.reload();await boot();
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),starter,'reload preserves authored source');
      assert.equal(await page.locator('.mw-loop').isChecked(),true,'restored all-pattern project defaults to looping');
      assert.equal(await page.locator('.mw-loop').isEnabled(),true);
      for(const status of ['playing','paused']){
        await page.evaluate(status=>audioFixture({status}),status);
        assert.equal(await page.locator('.mw-loop').isDisabled(),true,status+' prevents misleading live loop change');
        assert.equal(await page.locator('.mw-loop').getAttribute('title'),'Stop to change loop playback');
      }
      await page.evaluate(()=>audioFixture({status:'stopped'}));
      assert.equal(await page.locator('.mw-loop').isEnabled(),true,'Stop permits loop changes');
      const main=origin==='https://chiptunes.app';
      if(!main)await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.includes('Locked.'));
      assert.equal(await page.locator('.mw-chat-access').isVisible(),!main);
      assert.equal(await page.locator('.mw-chat-input').isVisible(),!main);
      assert.equal(await page.locator('[data-action=chat]').isVisible(),!main);
      assert.equal(await page.locator('[data-action=generate]').isVisible(),true);
      assert.equal(await page.locator('.mw-scope').isVisible(),true);
      assert.equal(await page.locator('.mw-lock').isVisible(),true);
      if(main){assert.equal(accessCalls,0);assert((await page.locator('.mw-project-handoff').textContent()).includes('Web Chat runs in the hosted workspace.'));}
      else assert((await page.locator('.mw-chat-input').locator('..').evaluate(el=>el.nextElementSibling.textContent)).includes('512 KiB UTF-8'));
      assert((await page.locator('.mw-help').textContent()).includes('Audio/file exports are limited to 10 minutes; project downloads preserve longer songs.'));
      const source='song({totalFrames:120})\ninstruments([[128,240,255,0]])\nevent({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n';
      await page.locator('[role=tab][data-view=code]').click();await page.locator('.cm-content').fill(source);await page.locator('[data-action=apply]').click();
      await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().draft===CT_MUSIC_WORKSPACE.snapshot().validated.source);
      assert((await page.locator('.mw-source-mode').textContent()).includes('Exact song source preserved.'));
      assert((await page.locator('.mw-source-mode').textContent()).includes('New loop'));
      await page.locator('[role=tab][data-view=notes]').click();await page.locator('.mw-note').click();
      await page.waitForFunction(()=>getSelection().toString().startsWith('event('));
      await page.locator('.cm-content').fill('// shifted offsets\n'+source);
      await page.locator('[role=tab][data-view=notes]').click();await page.locator('.mw-note').click();
      assert.equal(await page.locator('#musicworkspace').getAttribute('data-view'),'notes','stale mapping does not navigate');
      assert((await page.locator('.mw-selection').textContent()).includes('Source navigation unavailable while the draft differs'));
      assert.equal(await page.locator('.mw-note').getAttribute('aria-pressed'),'true','validated note stays selected');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.agentContext().policy.selection.ch),0);
      assert.equal(await page.evaluate(()=>getSelection().toString().includes('event(')),false,'no stale text selection');
      await page.locator('[role=tab][data-view=code]').click();const draft=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
      await page.setViewportSize({width:390,height:844});await page.locator('[role=tab][data-view=chat]').click();
      assert.equal(await page.locator('#mw-panel-chat').getAttribute('role'),'tabpanel');
      await page.locator('#mw-tab-chat').focus();await page.setViewportSize({width:1280,height:900});
      await page.waitForFunction(()=>document.querySelector('#musicworkspace').dataset.view==='code');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'mw-tab-code','focus returns from hidden mobile tab');
      assert.equal(await page.locator('#mw-tab-code').getAttribute('tabindex'),'0');
      assert.equal(await page.locator('#mw-tab-code').getAttribute('aria-selected'),'true');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),draft,'resize preserves editor source');
      await page.locator('#mw-tab-code').press('ArrowLeft');assert.equal(await page.locator('#mw-tab-notes').getAttribute('aria-selected'),'true');
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].filter(t=>t.getClientRects().length).every(t=>{
        const p=document.getElementById(t.getAttribute('aria-controls'));return p&&p.getAttribute('role')==='tabpanel'&&p.getAttribute('aria-labelledby')===t.id;
      })),true,'visible tabs have labelled panels');
      await page.locator('#mw-tab-notes').press('ArrowRight');await page.locator('.cm-content').focus();await page.keyboard.press('ControlOrMeta+z');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),source,'resize preserves editor undo history');
      await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());await page.close();
    }
    console.log('PASS workspace UI: validated mapping, stale-offset guard/selection, tab panels, mobile-to-desktop view/focus, source+undo preservation, main-site handoff-only Chat, hosted limits, shared controls');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
