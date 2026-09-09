#!/usr/bin/env node
'use strict';
// Real workspace/project/compiler source in Chromium. Editor/chat/audio and
// Web Locks are explicit fixtures; no dist, bundle, build, credentials or network.
const assert=require('node:assert/strict'),path=require('node:path');
const {test}=require('node:test');
const {chromium}=require('playwright');
const api=require('../src/api.js'),create=require('../src/create.js');
const KEY='ct-music-workspace-v1';
async function fixture(run){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.context().setOffline(true);
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin==='https://chiptunes.app'&&url.pathname==='/create')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
      return route.abort();
    });
    await page.goto('https://chiptunes.app/create');
    async function boot(legacy){
      for(const file of ['gb-hardware.js','music-language.js','music-project.js'])await page.addScriptTag({path:path.resolve(__dirname,'../src',file)});
      await page.evaluate(legacy=>{
        window.audioMutations=0;
        window.Audio={musicStop(){},enterCreate(){},onMusicState(){return ()=>{};},musicPlay(){audioMutations++;},musicQueue(){audioMutations++;}};
        // Actual legacy codec output generated in Node; exercise workspace's
        // recovery/materialization code, not a second handwritten conversion.
        window.CT_CREATE=legacy?{songOf:code=>code===legacy.doc?legacy.song:null,docState:code=>code===legacy.doc?legacy.state:null}:{};
        window.CT_MUSIC_CHAT={Client:class{cancel(){}},Access:class{cancel(){}async request(){return {authenticated:false,providers:[],limits:{dailyCalls:20}};}}};
        window.CT_MUSIC_CODE_EDITOR={help:{},mount(_el,_source,change){window.changeDraft=value=>{_source=value;change(value);};return {value(){return _source;},set(value){_source=value;},focus(){},diagnostics(){},selection(){return [];},highlightPlaying(){}};}};
        window.CT_MUSIC_CHAT_UI={mount(){return {update(){},focus(){}};}};
      },legacy||null);
      await page.addScriptTag({path:path.resolve(__dirname,'../src/music-workspace.js')});
    }
    await run(page,boot);
  }finally{await browser.close();}
}
async function saved(page,source){await page.waitForFunction(({key,source})=>{
  const value=localStorage.getItem(key);return value&&JSON.parse(value).draft===source;
},{key:KEY,source});}
test('legacy swung recovery preserves exact native GB and compiler clock; original record unchanged',()=>fixture(async(page,boot)=>{
  const state=create.docState(api.fromJSON({title:'Swing recovery',bpm:120,bars:2,grid:16,notes:[{lane:'Melody',step:1,note:'C5',len:1}]}));
  state.swing=1;const doc=create.docFromState(state),legacy={doc,state:create.docState(doc),song:create.songOf(doc)};
  await page.evaluate(doc=>localStorage.setItem('ct-create-draft',doc),doc);await boot(legacy);
  await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
  const result=await page.evaluate(()=>{const s=CT_MUSIC_WORKSPACE.snapshot(),compiled=s.validated.compiled;return {gb:compiled.gb,swing:compiled.settings.swing,step:CT_MUSIC_LANGUAGE.createClock(compiled.settings)(.25),draft:s.draft,legacy:localStorage.getItem('ct-create-draft'),playing:s.playing,calls:audioMutations};});
  assert.deepEqual(result.gb,JSON.parse(JSON.stringify(legacy.song.gb)));assert.equal(result.swing,true);
  assert.equal(result.step,9);assert.equal(result.gb.notes[0].frame,9);assert.equal(result.legacy,doc);assert.equal(result.playing,null);assert.equal(result.calls,0);
  await saved(page,result.draft);await page.reload();await boot(legacy);await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
  assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),result.draft);
}));
test('consumed source share reloads autosaved edits and last valid revision, not original hash',()=>fixture(async(page,boot)=>{
  await boot();await page.evaluate(()=>{
    const p=CT_MUSIC_PROJECT.create('song({tempo:120,bars:4})\n// shared\n',{compile:CT_MUSIC_LANGUAGE.compile,assetsVersion:'ct-gb-bank-1'});
    history.replaceState(null,'','/create#music='+encodeURIComponent(btoa(p.serialize())));
  });await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
  assert.equal(new URL(page.url()).hash,'#music');
  const original=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.source);
  const edited=original+'this is an invalid unfinished draft';await page.evaluate(source=>changeDraft(source),edited);await saved(page,edited);
  await page.reload();await boot();await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
  const result=await page.evaluate(()=>{const s=CT_MUSIC_WORKSPACE.snapshot();return {draft:s.draft,valid:s.validated.source,playing:s.playing,calls:audioMutations};});
  assert.equal(result.draft,edited);assert.equal(result.valid,original);assert.equal(result.playing,null);assert.equal(result.calls,0);
  const newer=edited+'!';await page.evaluate(source=>changeDraft(source),newer);await saved(page,newer);
}));
test('pending explicit import waiting for autosave cannot replace a closed/reopened workspace',()=>fixture(async(page,boot)=>{
  await boot();await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
  const original=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);await saved(page,original);
  const kept=original+'// keep this unfinished change\n';
  await page.evaluate(source=>{
    window.lockJobs=[];Object.defineProperty(navigator,'locks',{configurable:true,value:{request(_key,callback){return new Promise(resolve=>lockJobs.push(()=>resolve(callback())));}}});
    changeDraft(source);
    window.pendingImport=CT_MUSIC_WORKSPACE.open({source:'song({tempo:90,bars:2})\n// stale link',explicit:true});
  },kept);
  await page.waitForFunction(()=>lockJobs.length>0);
  await page.evaluate(async()=>{
    CT_MUSIC_WORKSPACE.close();await CT_MUSIC_WORKSPACE.open();
    while(lockJobs.length)lockJobs.shift()();await pendingImport;
  });
  assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),kept);
  await saved(page,kept);assert.equal(await page.evaluate(()=>audioMutations),0);
}));
test('pending file read is cancelled by close/reopen before prompting or replacing recovery',()=>fixture(async(page,boot)=>{
  await boot();await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
  const original=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);await saved(page,original);
  await page.evaluate(()=>{
    window.confirmations=0;window.confirm=()=>{confirmations++;return true;};
    const click=HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click=function(){if(this.type==='file')window.pendingFileInput=this;else click.call(this);};
    document.querySelector('[data-action=open]').click();
  });
  await page.waitForFunction(()=>!!window.pendingFileInput);
  await page.evaluate(()=>{
    Object.defineProperty(pendingFileInput,'files',{value:[{size:100,text:()=>new Promise(resolve=>{window.resolveFile=resolve;})}]});
    window.pendingFileRead=pendingFileInput.onchange();
  });
  await page.evaluate(async()=>{
    CT_MUSIC_WORKSPACE.close();await CT_MUSIC_WORKSPACE.open();
    const other=CT_MUSIC_PROJECT.create('song({tempo:90,bars:2})\n// cancelled file',{compile:CT_MUSIC_LANGUAGE.compile,assetsVersion:'ct-gb-bank-1'});
    resolveFile(other.serialize());await pendingFileRead;
  });
  assert.equal(await page.evaluate(()=>confirmations),0,'closed import must not revive a replacement confirmation');
  assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),original);
}));
