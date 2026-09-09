'use strict';
// Source UI with the existing CodeMirror and React chat artifacts. Offline exact-origin browser
// fixtures; no model, deployment or credentials.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    for(const origin of ['https://chiptunes.app','https://chiptunes-agent-gateway.vercel.app']){
      const page=await browser.newPage({viewport:{width:1800,height:900}});let accessCalls=0;
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
      await page.addScriptTag({path:path.resolve('dist/lib/music-chat-ui.js')});
      await page.addStyleTag({path:path.resolve('src/music-chat-ui.css')});
      await page.evaluate(()=>{window.Audio={musicStop(){},enterCreate(){},onMusicState(cb){window.audioFixture=cb;return ()=>{};}};window.CT_CREATE={};});
      await page.addScriptTag({path:path.resolve('src/music-workspace.js')});await page.addStyleTag({path:path.resolve('src/music-workspace.css')});
      await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
      }
      await boot();
      assert.equal(await page.getByRole('region',{name:'Code editor',exact:true}).isVisible(),true,'fresh workspace exposes code');
      assert.equal(await page.getByRole('region',{name:'Note chart',exact:true}).isVisible(),true,'fresh workspace exposes chart');
      assert.equal(await page.locator('[role=tab],[role=tablist],[role=tabpanel]').count(),0,'composition has no obsolete tab semantics');
      assert.equal(await page.locator('.mw-loop').isChecked(),true,'starter audition loops');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null,'starter is silent until Run');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.compiled.mapping.every(m=>!!m.pattern)),true,'starter compiles to pattern-mapped notes');
      assert((await page.locator('[data-action=apply]').textContent()).includes('Run'));
      assert.equal(await page.locator('[data-action=new-loop]').isVisible(),true);
      const starter=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
      await page.locator('.mw-project-tools>summary').click();
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
      await page.waitForFunction(()=>document.querySelector('.mcui-status')?.textContent.includes('Locked.'));
      assert.equal(await page.locator('.mw-chat-access').isVisible(),false,'access settings stay outside conversation');
      assert.equal(await page.locator('.mcui textarea').isVisible(),true,'same-origin composer remains available');
      assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isVisible(),true);
      assert.equal(await page.locator('.mw-project-handoff').isVisible(),false,'normal Chat never requires a hosted transfer');
      assert.equal(await page.locator('[data-action=generate]').isVisible(),false);
      await page.locator('.mw-project-tools>summary').click();
      await page.locator('.mw-generate summary').click();
      assert.equal(await page.locator('[data-action=generate]').isVisible(),true);
      await page.locator('.mw-generate summary').click();
      await page.locator('.mw-project-tools>summary').click();
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      assert.equal(await page.locator('.mw-chat-access').isVisible(),true);
      assert.equal(await page.locator('.mw-scope').isVisible(),true);
      assert.equal(await page.locator('.mw-lock').isVisible(),true);
      assert(accessCalls>=2,'each boot checks same-origin access, including the main site');
      assert((await page.locator('.mw-chat-settings').textContent()).includes('512 KiB UTF-8'));
      await page.locator('[data-action=chat-settings-close]').click();
      assert((await page.locator('.mw-help').textContent()).includes('Audio/file exports are limited to 10 minutes; project downloads preserve longer songs.'));
      const source='song({totalFrames:120})\ninstruments([[128,240,255,0]])\nevent({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n';
      await page.locator('.cm-content').fill(source);await page.locator('[data-action=apply]').click();
      await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().draft===CT_MUSIC_WORKSPACE.snapshot().validated.source);
      assert((await page.locator('.mw-source-mode').textContent()).includes('Exact song source preserved.'));
      assert((await page.locator('.mw-source-mode').textContent()).includes('New loop'));
      await page.locator('.mw-note').click();
      await page.waitForFunction(()=>getSelection().toString().startsWith('event('));
      await page.locator('.cm-content').fill('// shifted offsets\n'+source);
      await page.locator('.mw-note').click();
      assert.equal(await page.locator('.mw-notes').isVisible(),true,'stale mapping leaves chart visible');
      assert.equal(await page.locator('.mw-code').isVisible(),true,'stale mapping leaves code visible');
      assert((await page.locator('.mw-selection').textContent()).includes('Source navigation unavailable while the draft differs'));
      assert.equal(await page.locator('.mw-note').getAttribute('aria-pressed'),'true','validated note stays selected');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.agentContext().policy.selection.ch),0);
      assert.equal(await page.evaluate(()=>getSelection().toString().includes('event(')),false,'no stale text selection');
      const draft=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
      const toggle=page.locator('[data-action=toggle-chat]');
      await page.locator('.mcui textarea').fill('Retain this draft across layout changes');
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>document.querySelector('.mw-chat').hidden);
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'toggle-chat','mobile collapse returns focus from hidden composer');
      assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await toggle.click();
      assert.equal(await page.locator('.mw-chat').isVisible(),true,'mobile chat opens as a drawer');
      assert.equal(await page.locator('.mw-notes').isVisible(),true);
      assert.equal(await page.locator('.mw-code').isVisible(),true,'drawer preserves composition');
      await page.setViewportSize({width:1800,height:900});
      assert.equal(await page.locator('.mcui textarea').evaluate(el=>el===document.activeElement),true,'resize keeps focus on the visible composer');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),draft,'resize preserves editor source');
      // Collapse still works when the browser has already blurred the composer.
      await page.locator('.mcui textarea').evaluate(el=>el.blur());
      assert.equal(await page.evaluate(()=>document.activeElement===document.body),true);
      await toggle.click();
      assert.equal(await page.locator('.mw-chat').isVisible(),false);
      assert.equal(await toggle.evaluate(el=>el===document.activeElement),true,'collapse leaves focus on its visible control');
      await toggle.click();
      assert.equal(await page.locator('.mcui textarea').inputValue(),'Retain this draft across layout changes');
      await page.getByRole('button',{name:'Settings',exact:true}).focus();
      await page.setViewportSize({width:390,height:844});
      await page.setViewportSize({width:1800,height:900});
      assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).evaluate(el=>el===document.activeElement),true,'resize does not steal focus while the drawer remains open');
      for(const name of ['Note chart','Code editor'])assert.equal(await page.getByRole('region',{name,exact:true}).isVisible(),true,'composition regions stay named and reachable');
      const splitter=page.getByRole('separator',{name:'Resize chart and code'});
      const chartShare=Number(await splitter.getAttribute('aria-valuenow'));
      const chartMax=Number(await splitter.getAttribute('aria-valuemax'));
      await splitter.focus();await splitter.press('ArrowDown');
      assert.equal(Number(await splitter.getAttribute('aria-valuenow')),Math.min(chartShare+5,chartMax),'keyboard divider increases chart share by five points within its limit');
      await page.locator('.cm-content').focus();await page.keyboard.press('ControlOrMeta+z');
      assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),source,'resize preserves editor undo history');
      await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());await page.close();
    }
    console.log('PASS workspace UI: validated mapping, stale-offset guard/selection, simultaneous regions, drawer/resize focus, source+undo preservation, same-origin Chat, shared limits, shared controls');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
