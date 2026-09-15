'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const contract=require('../src/algorave/project.cjs'),root=path.resolve(__dirname,'../.algorave-preview');
const source='vec2 mainSound(int samp,float time){return vec2(sin(6.2831853*440.*time)*.2);}',changed=source.replace('440.','660.');
const nativeFixture=`
const originalConnect=AudioNode.prototype.connect,mutedOutputs=new WeakMap();
AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){let mute=mutedOutputs.get(this.context);if(!mute){mute=this.context.createGain();mute.gain.value=0;originalConnect.call(mute,destination);mutedOutputs.set(this.context,mute);}return originalConnect.call(this,mute,...args);}return originalConnect.call(this,destination,...args);};
addEventListener('DOMContentLoaded',()=>{const meter=document.createElement('p');meter.style='position:fixed;bottom:24px;left:12px;background:#111;color:white;padding:8px;z-index:9999';document.body.append(meter);setInterval(()=>{const app=window.algoravePreview,media=app?.shader.passes.find(p=>p.name==='Sound')?.images[0]?.media,bytes=media?.update();meter.textContent='MUTED TEST · Sound '+(media?media.time.toFixed(1)+'s · spectrum '+Math.max(...bytes.slice(0,512)):'absent');},250);});
`;
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');let body=fs.readFileSync(file);if(process.argv.includes('--serve')&&file.endsWith('index.html'))body=body.toString().replace('</head>','<script>'+nativeFixture+'</script></head>');res.end(body);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 if(process.argv.includes('--serve')){
  const project={version:1,runtime:contract.RUNTIME,music:'silence',visuals:{Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(0.,1.,0.,1.);}',Sound:source,channels:{Image:[],Sound:[]}}};
  fs.writeFileSync(path.join(root,'native-sound-project.json'),JSON.stringify(project));
  console.log('Muted native Sound test: http://127.0.0.1:'+server.address().port);
  await new Promise(resolve=>process.once('SIGINT',resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));return;
 }
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(30000);await configureAudio(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const project={version:1,runtime:contract.RUNTIME,music:'silence',visuals:{Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(0.,1.,0.,1.);}',Sound:source,channels:{Image:[],Sound:[]}}};
  assert.deepEqual(contract.project(project),project);
  await page.locator('#project-file').setInputFiles({name:'sound.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.waitForFunction(source=>algoravePreview.session.applied.visuals.Sound===source&&!algoravePreview.session.busy,source);
  assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
  await page.locator('#mode').selectOption('visuals');await page.locator('#pass').selectOption('Sound');
  await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
  await page.waitForFunction(()=>{const media=algoravePreview.shader.passes.find(p=>p.name==='Sound')?.images[0].media;return media?.time>.1&&media.update().slice(0,512).some(v=>v>0);});
  await page.getByLabel('GLSL visual').fill(changed);await page.locator('#run').click();
  await page.waitForFunction(source=>algoravePreview.session.applied.visuals.Sound===source&&!algoravePreview.session.busy,changed);
  await page.locator('#menu summary').click();await page.locator('#undo').click();
  await page.waitForFunction(source=>algoravePreview.session.applied.visuals.Sound===source&&!algoravePreview.session.busy,source);await page.locator('#menu summary').click();
  await page.evaluate(()=>{window.previousSound=algoravePreview.shader.passes.find(p=>p.name==='Sound').images[0].media;});
  await page.getByLabel('GLSL visual').fill('broken GLSL');await page.locator('#run').click();await page.waitForFunction(()=>!algoravePreview.session.busy&&document.getElementById('status').textContent.includes('Sound:'));
  assert.equal(await page.evaluate(()=>algoravePreview.shader.passes.find(p=>p.name==='Sound').images[0].media===window.previousSound),true,'failed compile keeps the actual playing resource');
  assert.equal(await page.evaluate(()=>algoravePreview.session.applied.visuals.Sound),source);assert.equal(await page.evaluate(()=>algoravePreview.playing),true);
  // Stop while the real 180-second GPU render is yielding between blocks.
  // The current resource must survive and the candidate must never apply later.
  await page.getByLabel('GLSL visual').fill(changed);await page.locator('#run').click();
  await page.waitForFunction(()=>algoravePreview.session.busy&&algoravePreview.shader.loads.size>0);
  await page.locator('#play').click();
  await page.waitForFunction(()=>!algoravePreview.session.busy&&!algoravePreview.playing);
  assert.equal(await page.evaluate(()=>algoravePreview.session.applied.visuals.Sound),source);
  assert.deepEqual(await page.evaluate(()=>({loads:algoravePreview.shader.loads.size,candidates:algoravePreview.shader.candidates.size,same:algoravePreview.shader.passes.find(p=>p.name==='Sound').images[0].media===previousSound})),{loads:0,candidates:0,same:true});

  await page.reload();await page.waitForFunction(()=>window.algoravePreview&&!document.getElementById('play').disabled);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
  assert.equal(await page.evaluate(()=>algoravePreview.session.applied.visuals.Sound),source);
  const textureResult=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(191,0,0)';ctx.fillRect(0,0,2,2);const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const out=document.createElement('canvas'),runtime=new algoravePreview.shader.constructor(out,{resolveImage:async()=>blob});
    try{
      const candidate=await runtime.prepareAsync({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}',Sound:'vec2 mainSound(int samp,float time){return vec2(texture(iChannel0,vec2(.5)).r*2.-1.);}',channels:{Sound:[{type:'texture',src:'asset:'+('a'.repeat(64)),filter:'nearest'}]}});candidate.apply();
      const media=runtime.passes.find(p=>p.name==='Sound').images[0].media;await runtime.unlockAudio();media.setPlaying(true);
      const deadline=performance.now()+3000;while(performance.now()<deadline){if(media.update()[600]>175)return {wave:media.bytes[600],samples:media.sampleCount};await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Texture Sound waveform never arrived');
    }finally{runtime.dispose();}
  });
  assert(Math.abs(textureResult.wave-191)<=2,JSON.stringify(textureResult));assert.equal(textureResult.samples,180*44100*2);
  console.log('PASS: Sound project Open stopped, pass editor, Play, Run, Undo, compile failure retains applied source/playback, Stop during GPU generation with resource retention/cleanup and saved reload. Silent sink; native and channel acceptance remain pending.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
