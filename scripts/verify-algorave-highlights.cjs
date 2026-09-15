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
  const source='setcpm(60); s("bd sd").markcss(\'background-color: red\')';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cm-playing-note').length>0).catch(async error=>{console.error(await page.evaluate(()=>({status:document.getElementById('status').textContent,events:algoravePreview.signals.events.slice(-2)})));throw error;});
  const seen=new Set();for(let i=0;i<12;i++){for(const text of await page.locator('.cm-playing-note').allTextContents())seen.add(text);await page.waitForTimeout(100);}
  assert(seen.has('bd')&&seen.has('sd'),JSON.stringify([...seen]));
  assert.equal(await page.locator('.cm-playing-note').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 0, 0)');
  await page.getByLabel('Strudel music').fill(source+' // unrun');await page.waitForFunction(()=>!document.querySelector('.cm-playing-note'));
  await page.locator('#run').click();await page.waitForFunction(()=>document.querySelector('.cm-playing-note'));
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing&&!document.querySelector('.cm-playing-note'));
  console.log('PASS: real Strudel event locations highlight both alternating sounds, markcss applies, unrun edits clear stale positions, Run restores marks and Stop clears them. Silent sink; native acceptance pending.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
