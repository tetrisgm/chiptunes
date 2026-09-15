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
  const source='s("bd*4").gain(slider(0.2,0,1))';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
  await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>0));
  const sliderId='slider_'+source.indexOf('0.2');
  await frame.evaluate(id=>{window.sliderProbe=sliderWithID(id,.2);},sliderId);
  const value=()=>frame.evaluate(()=>sliderProbe.queryArc(0,1)[0].value);
  assert.equal(await value(),.2);
  await page.evaluate(sliderId=>algoravePreview.bridge.request('slider',undefined,{sliderId,value:.8}),sliderId);
  assert.equal(await value(),.8,'existing pattern reads changed value without evaluation');
  const rejected=await page.evaluate(async()=>{try{await algoravePreview.bridge.request('slider',undefined,{sliderId:'slider_missing',value:.5});return false;}catch{return true;}});
  assert(rejected);
  await page.getByLabel('Strudel music').fill(source+"; throw Error('reject slider edit')");
  await page.locator('#run').click();await page.waitForFunction(()=>!algoravePreview.session.busy&&!document.getElementById('run').disabled);
  assert.equal(await value(),.8,'failed evaluation restores live slider value');
  await frame.evaluate(id=>sliderWithID(id,.2),sliderId);assert.equal(await value(),.2,'evaluation restores source value');
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: slider syntax plays, private-port updates affect an existing pattern, unknown IDs reject, evaluation restores source value. Inline widget and native acceptance pending.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
