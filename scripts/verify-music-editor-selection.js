'use strict';
// Build only the editor into an isolated temporary directory, never shared dist.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {build}=require('esbuild'),{chromium}=require('playwright');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chiptunes-editor-selection-'));
  const bundle=path.join(dir,'editor.js');
  await build({entryPoints:[path.join(__dirname,'../src/music-code-editor.mjs')],bundle:true,format:'iife',outfile:bundle});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',message=>{if(message.type()==='error'&&/CodeMirror|Calls to EditorView\.update/.test(message.text()))errors.push(message.text());});
    await page.route('**/*',route=>route.abort());
    await page.setContent('<main id="editor" style="height:400px"></main>');
    await page.addScriptTag({path:bundle});
    const result=await page.evaluate(()=>{
      const source='song({tempo:128,bars:4})\npattern("lead",notes("C4 E4"))';
      const events=[];
      const editor=CT_MUSIC_CODE_EDITOR.mount(document.querySelector('#editor'),source,
        value=>events.push({type:'change',value}),
        {onSelectionChange:ranges=>events.push({type:'selection',ranges})});
      globalThis.testEditor=editor;
      editor.select(24,31);
      const selected=editor.selection();selected[0].from=999;
      const unchanged=editor.value()===source,detached=editor.selection();
      editor.highlightPlaying([{from:0,to:4}]);
      const count=events.length;
      editor.set(source+'\n// manual edit');
      return {unchanged,detached,count,events,source};
    });
    assert.equal(result.unchanged,true,'selection does not change musical source');
    assert.deepEqual(result.detached,[{from:24,to:31}],'selection read is detached');
    assert.equal(result.count,1,'playback decoration does not emit selection changes');
    assert.equal(result.events[0].type,'selection');
    assert.equal(result.events[1].type,'change','source notification precedes selection after edit');
    assert.equal(result.events[2].type,'selection');
    await page.locator('.cm-content').press('ControlOrMeta+z');
    assert.equal(await page.evaluate(()=>testEditor.value()),result.source,'selection/decoration do not break typing undo');
    await page.evaluate(()=>testEditor.destroy());
    await page.evaluate(()=>{
      let editor;
      editor=CT_MUSIC_CODE_EDITOR.mount(document.querySelector('#editor'),'abcd',()=>{
        editor.diagnostics([{from:0,to:1,message:'Current diagnostic'}]);
        editor.highlightPlaying([{from:0,to:1}]);
      });
      window.testEditor=editor;editor.set('efgh');
    });
    assert.equal(await page.locator('.cm-music-sounding').count(),1,'onChange feedback safely publishes after the update');
    assert.equal(await page.locator('.cm-lintRange-error').count(),1);
    await page.evaluate(()=>{
      testEditor.diagnostics([{from:2,to:3,message:'Superseded diagnostic'}]);
      testEditor.set('ijkl');
    });
    assert.equal(await page.locator('.cm-lintRange-error').count(),1,'older feedback never lands on a new document');
    assert.equal(await page.locator('.cm-lintRange-error').textContent(),'i');
    await page.evaluate(()=>{testEditor.highlightPlaying([{from:2,to:3}]);testEditor.diagnostics([]);testEditor.destroy();});
    await page.evaluate(()=>new Promise(queueMicrotask));assert.deepEqual(errors,[]);
    console.log('PASS editor selection: detached ranges, source-first callbacks, no decoration notifications, undo preserved; reentrant/stale/destroyed feedback safely deferred');
  }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
