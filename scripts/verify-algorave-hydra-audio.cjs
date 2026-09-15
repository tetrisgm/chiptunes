'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
const vendor=path.resolve(__dirname,'../src/algorave/vendor/hydra-synth'),provenance=JSON.parse(fs.readFileSync(path.join(vendor,'UPSTREAM.json')));
for(const file of provenance.files){const target=path.join(vendor,provenance.modified.includes(file.path)?'upstream':'',file.path);assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex'),file.sha256);}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.on("pageerror",e=>console.error("PAGE",e.message));await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(resolve=>globalThis.grantMic=resolve)}));
  const source='globalThis.hydraProbe=await initHydra({detectAudio:true,enableStreamCapture:false}); solid(1,0,0,1).out(); s("bd*4")';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
  await frame.waitForFunction(()=>typeof grantMic==='function',null,{polling:50});
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  assert(await frame.evaluate(()=>hydraProbe.synth.a.disposed));
  await frame.evaluate(()=>{globalThis.lateStops=0;grantMic({getTracks:()=>[{stop(){lateStops++;}}]});});
  await frame.waitForFunction(()=>lateStops===1,null,{polling:50});
  assert(await frame.evaluate(()=>!hydraProbe.synth.a.context&&!hydraProbe.synth.a.stream));
  await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
  await frame.evaluate(()=>{const ctx=getAudioContext(),destination=ctx.createMediaStreamDestination();globalThis.fixtureOsc=ctx.createOscillator();fixtureOsc.connect(destination);fixtureOsc.start();globalThis.fixtureStream=destination.stream;grantMic(fixtureStream);});
  await frame.waitForFunction(()=>hydraProbe.synth.a.context,null,{polling:50});
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  await frame.waitForFunction(()=>hydraProbe.synth.a.context.state==='closed',null,{polling:50});
  assert(await frame.evaluate(()=>fixtureStream.getTracks().every(track=>track.readyState==='ended')));
  await frame.evaluate(()=>{fixtureOsc.stop();hydraProbe.synth.a.dispose();});
  await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
  await frame.evaluate(()=>{const ctx=getAudioContext(),destination=ctx.createMediaStreamDestination();globalThis.fixtureOsc=ctx.createOscillator();fixtureOsc.connect(destination);fixtureOsc.start();globalThis.fixtureStream=destination.stream;grantMic(fixtureStream);globalThis.oldAudio=hydraProbe.synth.a;});
  await frame.waitForFunction(()=>oldAudio.context,null,{polling:50});
  await page.getByLabel('Strudel music').fill(source+'; await new Promise(resolve=>globalThis.finishEdit=resolve); s("bd*4")');await page.locator('#run').click();
  await frame.waitForFunction(()=>typeof finishEdit==='function',null,{polling:50});
  await page.locator('#play').click();
  await frame.waitForFunction(()=>oldAudio.context.state==='closed'&&hydraProbe.synth.a.disposed,null,{polling:50});
  assert(await frame.evaluate(()=>fixtureStream.getTracks().every(track=>track.readyState==='ended')));
  await frame.evaluate(()=>{finishEdit();fixtureOsc.stop();grantMic({getTracks:()=>[{stop(){lateStops++;}}]});});
  await page.waitForFunction(()=>!algoravePreview.session.busy&&!algoravePreview.playing);
  await frame.waitForFunction(()=>lateStops===2,null,{polling:50});
  console.log('PASS: simulated microphone grant after Stop releases its track without creating an audio context; granted synthetic capture closes its context and track on Stop; repeated disposal is harmless; Stop during a pending edit closes both old and candidate capture. No physical microphone used.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
