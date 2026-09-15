'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  const before=await page.evaluate(()=>structuredClone(algoravePreview.session.applied));
  const source='await initTidal(); tidal(\'s "bd*4"\')';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
  await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>0)).catch(async error=>{console.error(await page.locator('#status').innerText());throw error;});
  const values=await frame.evaluate(()=>tidal('s "bd sd"').queryArc(0,1).map(h=>({s:h.value.s,time:Number(h.whole.begin)})));
  assert.deepEqual(values,[{s:'bd',time:0},{s:'sd',time:.5}]);
  const changed='await initTidal(); tidal(\'s "hh*8"\')';await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();await page.waitForFunction(source=>algoravePreview.session.applied.music===source,changed);
  await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),source);await page.locator('#menu summary').click();
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: bundled Haskell WASM parser, Tidal pattern values/timing, actual Strudel audio, Run/Undo and Stop in opaque frame. Silent sink; native acceptance pending.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
