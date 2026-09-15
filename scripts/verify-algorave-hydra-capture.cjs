'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
const vendor=path.resolve(__dirname,'../src/algorave/vendor/hydra-synth'),provenance=JSON.parse(fs.readFileSync(path.join(vendor,'UPSTREAM.json')));
for(const file of provenance.files){const target=path.join(vendor,provenance.modified.includes(file.path)?'upstream':'',file.path);assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex'),file.sha256);}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{
  const page=await browser.newPage();page.on("pageerror",e=>console.error("PAGE",e.message));await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.evaluate(()=>{
    globalThis.captureStops=0;
    Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{configurable:true,value:async()=>[]});
    for(const method of ['getUserMedia','getDisplayMedia'])Object.defineProperty(navigator.mediaDevices,method,{configurable:true,value:()=>new Promise(resolve=>globalThis.grantCapture=resolve)});
  });
  for(const method of ['initCam','initScreen']){
    const source='globalThis.hydraProbe=await initHydra({enableStreamCapture:false}); s0.'+method+'(); src(s0).out(); s("bd*4")';
    await frame.evaluate(()=>globalThis.grantCapture=undefined);
    await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
    await frame.waitForFunction(()=>typeof grantCapture==='function',null,{polling:50});
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    const before=await frame.evaluate(()=>captureStops);
    await frame.evaluate(()=>grantCapture({getTracks:()=>[{stop(){captureStops++;}}]}));
    await frame.waitForFunction(before=>captureStops===before+1,before,{polling:50});
    assert(await frame.evaluate(()=>hydraProbe.s[0].src===null));
    await frame.evaluate(()=>globalThis.grantCapture=undefined);
    await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
    await frame.waitForFunction(()=>typeof grantCapture==='function',null,{polling:50});
    await frame.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');
      globalThis.captureStream=canvas.captureStream(30);grantCapture(captureStream);
      globalThis.paintCapture=setInterval(()=>{ctx.fillStyle='cyan';ctx.fillRect(0,0,32,32);captureStream.getVideoTracks()[0].requestFrame?.();},25);
    });
    await frame.waitForFunction(()=>hydraProbe.s[0].src?.videoWidth===32,null,{polling:50});
    await frame.waitForFunction(()=>{tick(0);const gl=hydraProbe.canvas.getContext('webgl'),p=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return p[0]<10&&p[1]>240&&p[2]>240;},null,{polling:50});
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    assert(await frame.evaluate(()=>captureStream.getTracks().every(track=>track.readyState==='ended')&&!hydraProbe.s[0].src?.srcObject));
    await frame.evaluate(()=>clearInterval(paintCapture));
    console.log('PASS '+method+': late grant released; synthetic video reaches shader; Stop releases active stream.');
  }
  console.log('PASS: Hydra camera/screen cancellation with simulated permissions and canvas streams. No physical camera or desktop capture accessed.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
