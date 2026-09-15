'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.on('pageerror',e=>console.error('PAGE',e.message));await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  const source='s("bd*4").gain(slider(0.2,0,1))';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
  await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>0));
  const sliderId='slider_'+source.indexOf('0.2');
  await frame.evaluate(id=>{window.sliderProbe=sliderWithID(id,.2);},sliderId);
  const value=()=>frame.evaluate(()=>sliderProbe.queryArc(0,1)[0].value);
  assert.equal(await value(),.2);
  const control=page.getByRole('slider',{name:'Slider value'});
  await control.press('End');await page.waitForFunction(()=>algoravePreview.editors.music.value.includes('slider(1,'));
  await frame.waitForFunction(()=>sliderProbe.queryArc(0,1)[0].value===1,{},{polling:50,timeout:3000});
  await control.press('Home');await page.waitForFunction(()=>algoravePreview.editors.music.value.includes('slider(0,'));await frame.waitForFunction(()=>sliderProbe.queryArc(0,1)[0].value===0,{},{polling:50});
  await page.getByLabel('Strudel music').press('ControlOrMeta+Home');await page.getByLabel('Strudel music').press('Enter');
  await control.press('End');assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),'\n'+source.replace('0.2','1'));
  await frame.waitForFunction(()=>sliderProbe.queryArc(0,1)[0].value===1,{},{polling:50,timeout:3000});

  await page.evaluate(sliderId=>algoravePreview.bridge.request('slider',undefined,{sliderId,value:.8}),sliderId);
  assert.equal(await value(),.8,'existing pattern reads changed value without evaluation');
  const rejected=await page.evaluate(async()=>{try{await algoravePreview.bridge.request('slider',undefined,{sliderId:'slider_missing',value:.5});return false;}catch{return true;}});
  assert(rejected);
  await page.getByLabel('Strudel music').fill(source+"; throw Error('reject slider edit')");
  assert.equal(await page.getByRole('slider',{name:'Slider value'}).count(),0,'whole-source replacement removes stale slider targets');
  await page.locator('#run').click();await page.waitForFunction(()=>!algoravePreview.session.busy&&!document.getElementById('run').disabled);
  assert.equal(await value(),.8,'failed evaluation restores live slider value');
  await frame.evaluate(id=>sliderWithID(id,.2),sliderId);assert.equal(await value(),.2,'evaluation restores source value');
  await page.getByLabel('Strudel music').fill(source);await page.waitForFunction(()=>document.querySelector('.cm-slider')?.value==='0.2');
  const changed=source.replace('0.2','0.5');await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();
  await page.waitForFunction(changed=>algoravePreview.session.applied.music===changed,changed);
  await page.waitForFunction(()=>document.querySelector('.cm-slider')?.value==='0.5');
  await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');
  assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);
  await page.waitForFunction(()=>document.querySelector('.cm-slider')?.value==='0.2');await page.locator('#menu summary').click();
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: slider syntax plays, private-port updates affect an existing pattern, unknown IDs reject, evaluation restores source value. Inline keyboard changes and unrun insertion mapping pass; native acceptance pending.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
