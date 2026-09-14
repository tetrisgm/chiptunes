'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {usesSimple}=require('../src/create-entry.js');
for(const [url,expected] of [['/',true],['/create',true],['/create/',true],['/?broadcast=1',false],['/create?editor=chip',false],['/#s=doc',false],['/create#music=source',false],['/create#music-transfer=nonce',false],['/create#music',false],['/listen',false],['/track/example',false],['/webmcp',false],['/get',false]]){
  assert.equal(usesSimple(new URL(url,'http://localhost')),expected,url);
}
const root=path.resolve(__dirname,'../dist');
(async()=>{
  const server=http.createServer((req,res)=>{
    let file=path.join(root,new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(404);return res.end();}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file))file=path.join(root,'index.html');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
    let requests=[];page.on('request',request=>requests.push(request.url()));
    await page.goto(origin+'/');
    const frame=()=>page.frames().find(f=>new URL(f.url()||'about:blank').pathname==='/algorave/index.html');
    await page.waitForFunction(()=>document.getElementById('algorave-workspace'));
    await page.frameLocator('#algorave-workspace').getByRole('button',{name:'Play',exact:true}).waitFor();
    let workspace=frame();await workspace.waitForFunction(()=>window.algoravePreview);
    assert.equal(await page.evaluate(()=>typeof CT_MUSIC_WORKSPACE),'undefined');
    assert.equal(requests.some(url=>/\/app\.[a-f0-9]+\.js/.test(url)),false,'default does not load the legacy engine');
    assert.equal(await workspace.locator('#agent').isVisible(),false);
    assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    await workspace.getByRole('button',{name:'Play',exact:true}).click();
    await workspace.waitForFunction(()=>algoravePreview.signal.frequency?.some(n=>n>0));
    await workspace.locator('#menu').evaluate(el=>el.open=true);
    await workspace.getByRole('button',{name:'Chip projects',exact:true}).click();
    await page.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.isOpen());
    assert.equal(page.frames().length,1,'full navigation disposes all Strudel frames');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null);
    const chip=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
    await page.getByRole('button',{name:'Strudel + GLSL',exact:true}).click();
    await page.frameLocator('#algorave-workspace').getByRole('button',{name:'Play',exact:true}).waitFor();
    workspace=frame();await workspace.waitForFunction(()=>window.algoravePreview);
    assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    const saved=await page.evaluate(()=>localStorage.getItem('ct-music-workspace-v1'));
    assert(saved,'chip project saved before leaving');
    await workspace.getByRole('button',{name:'Play',exact:true}).click();
    await workspace.waitForFunction(()=>algoravePreview.playing);
    await page.reload();workspace=frame();
    await page.frameLocator('#algorave-workspace').getByRole('button',{name:'Play',exact:true}).waitFor();
    workspace=frame();await workspace.waitForFunction(()=>window.algoravePreview);
    assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('ct-music-workspace-v1')),saved,'new editor leaves saved chip bytes untouched');
    await page.screenshot({path:path.join(root,'../.algorave-preview/default-entry.png')});
    await page.setViewportSize({width:390,height:844});
    await workspace.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
    await page.screenshot({path:path.join(root,'../.algorave-preview/default-entry-narrow.png')});
    await page.setViewportSize({width:1440,height:900});
    // Existing consumed share links still open the saved chip project unchanged.
    await page.goto(origin+'/create#music');await page.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.isOpen());
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),chip);
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null);
    // A real legacy cartridge share retains its notes through the new dispatcher.
    const api=require('../src/api.js'),create=require('../src/create.js');
    const doc=api.fromJSON({title:'Preserved chip',bpm:120,bars:1,grid:16,notes:[{lane:'Melody',step:0,note:'C5',len:4}]});
    await page.goto(origin+'/#s='+doc);await page.waitForFunction(()=>window.CT_MUSIC_WORKSPACE?.isOpen());
    assert.deepEqual(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.compiled.gb.notes),create.songOf(doc).gb.notes);
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null);
    console.log('PASS: shared-build default minimal entry, legacy engine excluded, real Strudel playback, chip navigation/recovery, no concurrent frames, reload without autoplay, exact saved-chip bytes and legacy note links.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
