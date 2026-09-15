'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.on('pageerror',e=>console.error('PAGE',e.message));await configureAudio(page);await page.addInitScript(()=>{window.bitmapStats={closed:0,received:0,requests:0};const close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){bitmapStats.closed++;return close.call(this);};});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await page.evaluate(()=>{const request=algoravePreview.bridge.request.bind(algoravePreview.bridge);algoravePreview.bridge.request=(...args)=>{if(args[0]==='drawings')bitmapStats.requests++;return request(...args).then(result=>{bitmapStats.received+=result.drawings?.length||0;return result;});};});
  const source='globalThis.scopePattern=note("c3").s("sawtooth").gain(.3).sustain(1).release(.1)._scope(); scopePattern';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
  await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>0));
  const probe=await frame.evaluate(()=>({values:scopePattern.queryArc(0,1).map(h=>h.value),ids:[...document.querySelectorAll('canvas[data-inline-drawing]')].map(c=>c.id)}));
  assert.equal(probe.values[0].analyze,probe.ids[0]);
  await page.waitForFunction(()=>{
    const c=document.querySelector('.cm-strudel-drawing');if(!c)return false;
    const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let y=0;y<c.height;y++)if(Math.abs(y-c.height/2)>c.height*.1)for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4;if(p[i+2]>100&&p[i]<200)return true;
    }
    return false;
  },null,{timeout:8000});
  for(let i=0;i<20;i++){
    const next=source.replace('c3',i%2?'eb3':'g3');
    await page.getByLabel('Strudel music').fill(next);await page.locator('#run').click();
    await page.waitForFunction(next=>algoravePreview.session.applied.music===next&&!algoravePreview.session.busy,next);
    await page.waitForFunction(()=>document.querySelectorAll('.cm-strudel-drawing').length===1);
    assert.equal(await frame.evaluate(()=>document.querySelectorAll('canvas').length),1);
  }
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  await page.waitForFunction(()=>algoravePreview.bridge.pending.size===0);
  const stats=await page.evaluate(()=>({...bitmapStats,canvases:document.querySelectorAll('.cm-strudel-drawing').length}));
  assert(stats.received>20);assert.equal(stats.closed,stats.received,'every received bitmap is closed');assert.equal(stats.canvases,1);
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(()=>bitmapStats),{closed:stats.closed,received:stats.received,requests:stats.requests},'Stop ends bitmap requests');
  await page.getByLabel('Strudel music').fill('s("bd*4")');await page.locator('#play').click();
  await page.waitForFunction(()=>algoravePreview.playing&&!document.querySelector('.cm-strudel-drawing')&&algoravePreview.bridge.pending.size===0);
  const plain=await page.evaluate(()=>bitmapStats.requests);await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>bitmapStats.requests),plain,'music without inline drawings does not poll for snapshots');
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: actual inline audio waveform, matching analyser ID, 20 source edits with one runtime/editor canvas, all '+stats.received+' transferred bitmaps closed, and no repeated requests after Stop. Silent sink; sustained/native acceptance pending.');

 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
