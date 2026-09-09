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
    console.log('PASS editor selection: detached ranges, source-first callbacks, no decoration notifications, undo preserved');
  }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
