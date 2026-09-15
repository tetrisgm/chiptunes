'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
const vendor=path.resolve(__dirname,'../src/algorave/vendor/hydra-synth'),provenance=JSON.parse(fs.readFileSync(path.join(vendor,'UPSTREAM.json')));
for(const file of provenance.files){const target=path.join(vendor,provenance.modified.includes(file.path)?'upstream':'',file.path);assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex'),file.sha256);}
const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'hydra-media-')),videoFile=path.join(temp,'fixture.mp4');
require('node:child_process').execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=32x32:d=2:r=10','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',videoFile]);
const videoBytes=fs.readFileSync(videoFile);
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{
  const page=await browser.newPage();page.on("pageerror",e=>console.error("PAGE",e.message));await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  const source='globalThis.hydraProbe=await initHydra({enableStreamCapture:false}); src(s0).out(); silence';
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
  const image=await frame.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=8;const ctx=c.getContext('2d');ctx.fillStyle='cyan';ctx.fillRect(0,0,8,8);return c.toDataURL();});
  await frame.evaluate(url=>s0.initImage(url),image);
  await frame.waitForFunction(()=>s0.src instanceof HTMLImageElement&&s0.src.complete,null,{polling:50});
  const cyan=await frame.evaluate(()=>{tick(0);const gl=hydraProbe.canvas.getContext('webgl'),p=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});assert(cyan[1]>240&&cyan[2]>240&&cyan[0]<10);
  const videoUrl='https://media.example.test/fixture.mp4';
  await page.route(videoUrl,route=>route.fulfill({status:200,contentType:'video/mp4',headers:{'access-control-allow-origin':'*'},body:videoBytes}));
  const stale=await frame.evaluate(({image,videoUrl})=>{
    const create=document.createElement.bind(document);let img,vid,callback;
    document.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='img')img=el;if(tag==='video'){vid=el;const add=el.addEventListener.bind(el);el.addEventListener=(type,fn,...options)=>{if(type==='loadeddata')callback=fn;return add(type,fn,...options);};}return el;};
    try{
      s0.initImage(image);const imageCallback=img.onload;s0.clear();imageCallback();const imageCancelled=s0.src===null&&!img.hasAttribute('src');
      s0.initVideo(videoUrl);s0.clear();callback();return {imageCancelled,videoCancelled:s0.src===null&&!vid.hasAttribute('src')&&vid.paused};
    }finally{document.createElement=create;}
  },{image,videoUrl});assert.deepEqual(stale,{imageCancelled:true,videoCancelled:true});
  await frame.evaluate(url=>s0.initVideo(url),videoUrl);
  await frame.waitForFunction(()=>s0.src instanceof HTMLVideoElement&&s0.src.currentTime>0,null,{polling:50});
  const red=await frame.evaluate(()=>{globalThis.oldVideo=s0.src;tick(0);const gl=hydraProbe.canvas.getContext('webgl'),p=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});assert(red[0]>230&&red[1]<15&&red[2]<15);
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  assert(await frame.evaluate(()=>oldVideo.paused&&!oldVideo.hasAttribute('src')&&s0.src===null));
  console.log('PASS: real image and MP4 shader pixels, cancelled queued image/video callbacks cannot replace a cleared source, and Stop pauses/unloads owned video.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
