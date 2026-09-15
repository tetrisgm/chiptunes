'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  const allowed=await frame.evaluate(()=> (document.permissionsPolicy||document.featurePolicy).allowsFeature('serial'));assert.equal(allowed,true);
  await frame.evaluate(()=>{window.serialWrites=[];window.serialRequests=0;Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>{serialRequests++;return {open:async()=>{},writable:{getWriter:()=>({write:bytes=>{serialWrites.push(new TextDecoder().decode(bytes));return Promise.resolve();}})}};}}});});
  const source='setcpm(120); s("first*4").serial()',changed=source.replace('first','second');
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await frame.waitForFunction(()=>serialWrites.includes('s:first'),null,{polling:50}).catch(async error=>{console.error(await page.locator('#status').innerText(),await frame.evaluate(()=>({serialWrites:serialWrites.slice(0,4),serialRequests})));throw error;});
  await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();await frame.waitForFunction(()=>serialWrites.includes('s:second'),null,{polling:50});
  await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');await page.locator('#menu summary').click();
  await frame.waitForFunction(()=>serialWrites.at(-1)==='s:first',null,{polling:50});
  // Inject one far-future hap into the same module to make a surviving timer
  // observable independently of the scheduler's normal lookahead.
  await frame.evaluate(()=>{const hap=pure('must-not-send').serial().queryArc(0,1)[0];hap.context.onTrigger(hap,0,1,.8);});
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);await page.waitForTimeout(1200);
  assert.equal(await frame.evaluate(()=>serialWrites.includes('must-not-send')),false);
  assert.equal(await frame.evaluate(()=>serialRequests),1,'Run/Undo reuse the selected port');
  await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
  console.log('PASS: serial opaque-frame policy, source Play/Run/Undo, cached fake port, real Stop message cancelling future writes, and stopped reload. No hardware.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
