// Song links open the exact score in unified Create, silently. Radio compressed
// links, legacy bare/raw documents, and source-project links remain supported.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const DIST=path.resolve(__dirname,'../dist');
const server=http.createServer((req,res)=>{
  let file=path.join(DIST,decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(DIST+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(DIST,'index.html');
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
async function peak(page,ms,untilAudible=false){
  return page.evaluate(async({ms,untilAudible})=>{
    let peak=0;const end=performance.now()+ms;
    while(performance.now()<end){peak=Math.max(peak,Audio.outputProbe().peak);if(untilAudible&&peak>.02)break;await new Promise(r=>setTimeout(r,100));}
    return peak;
  },{ms,untilAudible});
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const errors=[];
  async function newPage(){
    const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
  }
  async function openShared(url,expected,label,expectedSource,expectedPath='/create'){
    const page=await newPage();
    try{
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.isOpen()&&CT_MUSIC_WORKSPACE.snapshot()?.validated,null,{timeout:40000});
      const state=await page.evaluate(()=>({snapshot:CT_MUSIC_WORKSPACE.snapshot(),path:location.pathname,legacy:!!document.querySelector('#createscreen.show')}));
      assert.equal(state.path,expectedPath,label+' uses the intended composition route');assert.equal(state.legacy,false,label+' does not mount legacy editor');
      assert.deepEqual(state.snapshot.validated.compiled.gb,expected.gb,label+' preserves entire exact score');
      assert.equal(state.snapshot.validated.compiled.settings.title,expected.title,label+' preserves title');
      if(expectedSource!==undefined)assert.equal(state.snapshot.draft,expectedSource,label+' preserves authored source and comments');
      assert.equal(state.snapshot.playing,null);assert.equal(state.snapshot.pending,null);
      assert((await peak(page,1500))<.02,label+' opens silently');
      for(let zoom=0;zoom<8&&await page.locator('.mw-note').count()===0;zoom++){
        await page.locator('.mw-note-group').first().click();
      }
      await page.locator('.mw-note').first().click();assert((await peak(page,700))<.02,label+' note selection/density navigation stays silent');
      await page.locator('[data-action=play]').click();
      await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().playing===CT_MUSIC_WORKSPACE.snapshot().validated.id,null,{timeout:30000});
      const sounding=await peak(page,15000,true);assert(sounding>.02,label+' explicit Play is audible; peak='+sounding);
      assert.deepEqual(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.compiled.gb),expected.gb,label+' Play does not alter score');
      console.log('PASS '+label+': exact score/title, canonical silent import, explicit Play audible');
    }finally{await page.context().close();}
  }
  try{
    const station=await newPage();await station.goto(origin+'/listen',{waitUntil:'domcontentloaded'});
    await station.locator('#rmoods .rmood[data-mood="chill"]').click();
    await station.waitForFunction(()=>Audio.currentDoc?.()&&Audio.currentScore?.()?.gb?.notes?.length,null,{timeout:30000});
    assert((await peak(station,20000,true))>.02,'station original is audible');
    const sent=await station.evaluate(()=>{
      const code=Audio.currentDoc(),song=CT_CREATE.songOf(code);
      // The document contract is finite JSON: absent and undefined object
      // fields are equivalent; every represented score field remains compared.
      return JSON.parse(JSON.stringify({code,gb:song.gb,title:song.title,radioGB:Audio.currentScore().gb,name:document.querySelector('#pbTitle').textContent.trim()}));
    });
    assert.deepEqual(sent.gb,sent.radioGB,'shared document represents the full radio score');
    assert.equal(sent.title,sent.name,'radio title belongs to shared document');
    let link='';
    for(let i=0;i<30;i++){
      await station.locator('#rshare').evaluate(el=>el.click());
      link=await station.evaluate(()=>navigator.clipboard.readText());
      if(/\/#s=z/.test(link))break;await station.waitForTimeout(100);
    }
    assert.match(link,/\/#s=z/,'radio Share copies a compressed document');
    await station.context().close();
    await openShared(link.replace(/^https?:\/\/[^/]+/,origin),sent,'radio compressed share',undefined,'/');
    await openShared(origin+'/#s=r'+sent.code,sent,'raw document share',undefined,'/');
    await openShared(origin+'/create#s='+sent.code,sent,'legacy bare document share');
    const editor=await newPage();await editor.goto(origin+'/create',{waitUntil:'domcontentloaded'});
    await editor.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.isOpen(),null,{timeout:40000});
    const authored=await editor.evaluate(()=>{
      // Keep this fixture inside the documented 12KB self-contained-link cap.
      // Native document materialization carries a large bank even for one note;
      // those full-bank documents are covered by the three #s cases above.
      const source='song({totalFrames:120,settings:{title:"Exact Unicode ♪",tempo:120,bars:1}})\n'+
        'instruments([[128,240,255,0]])\n'+
        'event({ch:0,frame:0,frames:60,midi:60,inst:0,vel:1})\n// Editor-authored comment ♪\n';
      const compiled=CT_MUSIC_LANGUAGE.compile(source);
      if(!compiled.gb)throw Error(JSON.stringify(compiled.diagnostics));
      return {gb:compiled.gb,title:compiled.settings.title,source};
    });
    await editor.locator('.cm-content').fill(authored.source);await editor.locator('[data-action=apply]').click();
    await editor.waitForFunction(source=>CT_MUSIC_WORKSPACE.snapshot().validated.source===source,authored.source,{timeout:30000});
    await editor.locator('[data-action=stop]').click();
    await editor.locator('.mw-project-tools>summary').click();await editor.locator('[data-action=share]').click();
    await editor.waitForFunction(()=>document.querySelector('.mw-status').textContent.includes('Copied project link')).catch(async e=>{throw Error(e.message+'; workspace: '+await editor.locator('.mw-status').textContent());});
    const sourceLink=await editor.evaluate(()=>navigator.clipboard.readText());
    assert.match(sourceLink,/\/create#music=/,'workspace shares source-project links');
    await editor.context().close();
    await openShared(sourceLink.replace(/^https?:\/\/[^/]+/,origin),authored,'workspace source share',authored.source);
    assert.deepEqual(errors,[],'no browser page errors');
    console.log('PASS verify-share: compressed/raw/bare/source links preserve exact songs without autoplay');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
