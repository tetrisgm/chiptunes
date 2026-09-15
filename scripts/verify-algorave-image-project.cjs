'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),esbuild=require('esbuild');
const {chromium}=require('playwright'),{PNG}=require('pngjs'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
const png=new PNG({width:2,height:2});png.data=Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);const bytes=PNG.sync.write(png);
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:`import {loadImages,saveImages} from './src/algorave/image-persistence.mjs';import {ImageByteStore} from './src/algorave/image-assets.mjs';import {decodeShaderImage} from './src/algorave/shader-images.mjs';window.assets={loadImages,saveImages,ImageByteStore,decodeShaderImage};`},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
(async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/probe'){res.setHeader('content-type','text/html');return res.end('<script src="/probe.js"></script>');}
    if(req.url==='/probe.js'){res.setHeader('content-type','text/javascript');return res.end(bundle);}
    const file=path.join(root,req.url==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.setDefaultTimeout(20000);await configureAudio(page);
    let remoteImages=0;await context.route('**/*',route=>{if(route.request().resourceType()==='image'&&!route.request().url().startsWith(origin))remoteImages++;return route.continue();});
    await page.goto(origin);await page.waitForFunction(()=>window.algoravePreview);
    await page.locator('#mode').selectOption('visuals');await page.locator('#advanced summary').first().click();
    const first=page.locator('#channel-editor fieldset').first();await first.getByLabel('Image Input',{exact:true}).selectOption('texture');
    await first.getByLabel('Image Import image',{exact:true}).setInputFiles({name:'original-grid.png',mimeType:'image/png',buffer:bytes});
    await page.waitForFunction(()=>document.getElementById('channels').value.includes('asset:'));
    assert.equal(await first.getByLabel('Image Image URL',{exact:true}).inputValue(),'');
    assert.equal(await first.getByLabel('Image Image URL',{exact:true}).getAttribute('placeholder'),'Imported image (saved)');
    await first.getByLabel('Image Filter',{exact:true}).selectOption('nearest');await page.locator('#set-channels').click();
    await page.getByLabel('GLSL visual',{exact:true}).fill('void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec2(.25,.25));}');
    await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');
    const pixel=target=>target.evaluate(()=>{const s=algoravePreview.shader;s.render();const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];});
    assert.deepEqual(await pixel(page),[255,0,0,255]);
    const applied=await page.evaluate(()=>algoravePreview.session.applied);assert.match(applied.visuals.channels.Image[0].src,/^asset:[a-f0-9]{64}$/);
    await first.getByLabel('Image Flip vertically',{exact:true}).check();await page.locator('#set-channels').click();await page.locator('#run').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');assert.deepEqual(await pixel(page),[0,0,255,255]);
    await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.deepEqual(await pixel(page),[255,0,0,255]);
    const downloaded=page.waitForEvent('download');await page.locator('#download').click();const download=await downloaded,archive=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(archive.format,'ct-algorave-assets');assert.equal(archive.images.length,1);assert.deepEqual(Buffer.from(archive.images[0].data,'base64'),bytes);
    await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.deepEqual(await pixel(page),[255,0,0,255]);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    // Failed image decode must not persist bytes or replace the working pass.
    await page.locator('#mode').selectOption('visuals');await page.locator('#advanced summary').first().click();
    const invalid=bytes.subarray(0,24);await first.getByLabel('Image Import image',{exact:true}).setInputFiles({name:'broken.png',mimeType:'image/png',buffer:invalid});
    await page.waitForFunction(()=>!document.querySelector('#channel-editor fieldset').disabled);assert.deepEqual(await pixel(page),[255,0,0,255]);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'local-images-narrow.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // Portable import on a fresh browser profile, with no image network route.
    const {SampleByteStore}=await import('../src/algorave/sample-assets.mjs'),{drumWav}=await import('../src/algorave/drum-samples.mjs');
    const samples=new SampleByteStore(),wav=new Uint8Array(drumWav('sd',16000)),sample=await samples.put(wav);
    archive.samples=[{id:sample.id,data:Buffer.from(wav).toString('base64')}];archive.project.samples={clap:[sample.id]};archive.project.music='s("clap")';
    const fresh=await browser.newContext(),opened=await fresh.newPage();await configureAudio(opened);await opened.goto(origin);await opened.waitForFunction(()=>window.algoravePreview);
    await opened.locator('#project-file').setInputFiles({name:'portable.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    await opened.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');assert.deepEqual(await pixel(opened),[255,0,0,255]);
    await opened.reload();await opened.waitForFunction(()=>window.algoravePreview);assert.deepEqual(await pixel(opened),[255,0,0,255]);
    assert.equal(await opened.evaluate(()=>algoravePreview.playing),false);
    await opened.locator('#play').click();await opened.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    await opened.locator('#play').click();await opened.waitForFunction(()=>!algoravePreview.playing);
    const bad=structuredClone(archive);bad.images[0].data='AAAA';await opened.locator('#project-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});
    await opened.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Could not open'));assert.deepEqual(await pixel(opened),[255,0,0,255]);
    const undecodable=structuredClone(archive);const brokenId=require('node:crypto').createHash('sha256').update(invalid).digest('hex');
    undecodable.images=[{id:brokenId,data:invalid.toString('base64')}];undecodable.project.visuals.channels.Image[0].src='asset:'+brokenId;
    await opened.locator('#project-file').setInputFiles({name:'undecodable.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(undecodable))});
    await opened.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Could not open'));assert.deepEqual(await pixel(opened),[255,0,0,255]);
    await fresh.close();
    // Independent tabs save by immutable merge, retaining assets needed by Undo.
    const probe=await context.newPage();await probe.goto(origin+'/probe');
    const persisted=await probe.evaluate(async input=>{
      const {loadImages,saveImages}=assets,first=await loadImages(),second=await loadImages(),before=first.snapshot();
      const altered=Uint8Array.from(input);altered[altered.length-1]^=1;const added=await second.put(altered);await saveImages(second);await saveImages(first);
      const final=await loadImages();return {before,after:final.snapshot(),added:final.has(added.id)};
    },[...bytes]);
    assert.equal(persisted.before.count,1,'failed decode did not persist a second image');assert.equal(persisted.after.count,2);assert(persisted.added);
    assert.equal(remoteImages,0);await context.close();
    console.log('PASS: imported image pixels/flip, Run/Undo, saved reload, portable fresh-profile Open, corrupt import retention, immutable multi-tab storage, narrow layout; original PNG fixture, zero provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
