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
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: 40 Hydra source replacements and clears retain '+result.initial+' textures; width-only and height-only canvas/texture resizing render actual cyan pixels.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
