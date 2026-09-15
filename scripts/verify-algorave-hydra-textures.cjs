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
  const source='globalThis.hydraProbe=await initHydra({enableStreamCapture:false}); src(s0).out(); silence';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
  const result=await frame.evaluate(()=>{
    const source=hydraProbe.s[0],initial=hydraProbe.regl.stats.textureCount;
    for(let i=0;i<40;i++){const ctx=source.initCanvas(32+i,32);ctx.fillStyle='cyan';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);if(hydraProbe.regl.stats.textureCount!==initial)throw Error('Texture count grew');}
    if(source.src.width!==71||source.src.height!==32)throw Error('Width-only resize failed');
    source.initCanvas(71,64);if(source.src.height!==64)throw Error('Height-only initCanvas resize failed');
    source.src.height=96;const ctx=source.src.getContext('2d');ctx.fillStyle='cyan';ctx.fillRect(0,0,71,96);hydraProbe.tick(0);
    const dimensions=[source.tex.width,source.tex.height];
    const gl=hydraProbe.canvas.getContext('webgl'),pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    for(let i=0;i<40;i++)source.clear();
    return {initial,final:hydraProbe.regl.stats.textureCount,dimensions,pixel:[...pixel]};
  });
  assert.equal(result.initial,result.final);assert.deepEqual(result.dimensions,[71,96]);assert(result.pixel[0]<10&&result.pixel[1]>240&&result.pixel[2]>240,JSON.stringify(result));
  await frame.evaluate(()=>{
    const source=hydraProbe.s[0],listeners=new Set();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const ctx=canvas.getContext('2d');ctx.fillStyle='magenta';ctx.fillRect(0,0,32,32);
    source.pb={on:(event,fn)=>listeners.add(fn),off:(event,fn)=>listeners.delete(fn),initSource:name=>{for(const fn of listeners)fn(name,canvas)}};
    for(let i=0;i<40;i++)source.initStream('fixture');
    if(listeners.size!==1||source.src!==canvas)throw Error('Peer listeners grew or synchronous stream was missed');
    hydraProbe.tick(0);
    const gl=hydraProbe.canvas.getContext('webgl'),pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    if(pixel[0]<240||pixel[1]>10||pixel[2]<240)throw Error('Peer source did not render');
    const late=[...listeners][0];source.clear();late('fixture',canvas);
    if(listeners.size||source.src!==null)throw Error('Cleared peer source was replaced');
    source.pb.removeListener=source.pb.off;delete source.pb.off;
    source.initStream('fixture');
    globalThis.peerProbe={source,listeners,late:[...listeners][0],canvas};
  });
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  await frame.evaluate(()=>{
    const {source,listeners,late,canvas}=peerProbe;
    if(listeners.size)throw Error('Stop retained peer listener');
    source.src=null;late('fixture',canvas);
    if(source.src!==null)throw Error('Stopped peer callback remained active');
  });
  console.log('PASS: 40 Hydra source replacements and clears retain '+result.initial+' textures; width-only and height-only canvas/texture resizing render actual cyan pixels; peer sources render magenta, retain one listener, and cancel on clear/Stop.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
