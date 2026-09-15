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
  const result=await frame.evaluate(async()=>{
   const policy=document.permissionsPolicy||document.featurePolicy;
   const allowed=['accelerometer','gyroscope','magnetometer'].map(name=>policy.allowsFeature(name));
   let missing=false;Object.defineProperty(window,'DeviceMotionEvent',{configurable:true,value:undefined});try{await enableMotion();}catch(e){missing=e.message.includes('unavailable');}
   let permission='denied',calls=0;window.DeviceMotionEvent={requestPermission:async()=>{calls++;return permission;}};Object.defineProperty(window,'DeviceOrientationEvent',{configurable:true,value:{requestPermission:async()=>permission}});
   // Replace only the three sensor subscriptions with a fixture registry. No
   // browser sensor listener or physical permission request occurs in this test.
   const add=window.addEventListener.bind(window),listeners={};window.addEventListener=(type,handler,...args)=>{if(['devicemotion','deviceorientation','deviceorientationabsolute'].includes(type)){(listeners[type]??=[]).push(handler);return;}return add(type,handler,...args);};
   await enableMotion();const denied=Object.keys(listeners).length===0;permission='granted';await enableMotion();await enableMotion();
   listeners.devicemotion[0]({acceleration:{x:-1,y:0,z:1},accelerationIncludingGravity:{x:-9.81,y:0,z:9.81},rotationRate:{alpha:-180,beta:0,gamma:180}});
   listeners.deviceorientation[0]({alpha:90,beta:0,gamma:90});listeners.deviceorientationabsolute[0]({alpha:180,beta:-180,gamma:0});
   const value=p=>p.queryArc(0,1)[0].value;
   return {allowed,missing,denied,calls,counts:Object.values(listeners).map(l=>l.length),values:[accX,accY,accZ,gravX,gravY,gravZ,rotA,rotB,rotG,oriA,oriB,oriG,absOriA,absOriB,absOriG].map(value),aliases:accX===accelerationX&&rotX===rotationBeta&&oriZ===orientationAlpha&&absOriY===absoluteOrientationGamma,pattern:note('c3*4').gain(accX.range(.1,.3)).queryArc(0,1).map(h=>h.value.gain)};
  });
  assert.deepEqual(result.allowed,[true,true,true]);assert(result.missing&&result.denied&&result.aliases);assert.equal(result.calls,2);assert.deepEqual(result.counts,[1,1,1]);assert.deepEqual(result.values,[0,.5,1,0,.5,1,0,.5,1,.25,.5,1,.5,0,.5]);assert.deepEqual(result.pattern,[.1,.1,.1,.1]);
  await page.getByLabel('Strudel music').fill('await enableMotion(); note("c3*4").s("triangle").gain(accX.range(.05,.2))');await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>0));
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: opaque-frame motion policies, missing API, fixture permission denial/grant, idempotent listeners, all fifteen sensor formulas, aliases and actual source-driven playback. Synthetic sensors and silent sink only.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
