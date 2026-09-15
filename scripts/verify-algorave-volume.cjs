'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),esbuild=require('esbuild');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const contract=require('../src/algorave/project.cjs'),root=path.resolve(__dirname,'../.algorave-preview');
function volume(components=4,width=2,height=2,depth=2){
  const bytes=new Uint8Array(20+width*height*depth*components),view=new DataView(bytes.buffer);bytes.set([66,73,78,10]);[width,height,depth,components].forEach((v,i)=>view.setUint32(4+i*4,v,true));
  for(let z=0;z<depth;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=[x?255:0,y?255:0,z?255:0,255];bytes.set(color.slice(0,components),20+((z*height+y)*width+x)*components);}return bytes;
}
const bytes=volume(),url='https://volumes.example.test/grid.bin',input={type:'volume',src:url,filter:'nearest'};
const image='void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(.75,.25,.75));}';
const project={version:1,runtime:contract.RUNTIME,music:'',visuals:{Image:image,channels:{Image:[input]}}};
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:`import {ShaderRuntime} from './src/algorave/shader-runtime.mjs';window.s=new ShaderRuntime(document.querySelector('canvas'),{onStatus:text=>window.statusText=text});window.pixel=()=>{const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];};`},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
const near=(a,b)=>a.forEach((v,i)=>assert(Math.abs(v-b[i])<=2,`${a} != ${b}`));
(async()=>{
  const {parseVolume}=await import('../src/algorave/shader-volume.mjs'),{ImageByteStore}=await import('../src/algorave/image-assets.mjs'),{exportProject,importProject}=await import('../src/algorave/project-assets.mjs');
  assert.deepEqual(contract.project(project),project);assert.throws(()=>contract.channel({...input,faces:Array(6).fill(url)},{}));assert.throws(()=>contract.channel({...input,src:'data:bad'},{}));
  for(let components=1;components<=4;components++){const b=volume(components,3,2,2),decoded=parseVolume(b);assert.deepEqual([decoded.width,decoded.height,decoded.depth,decoded.components],[3,2,2,components]);assert.deepEqual(decoded.data,b.slice(20));decoded.data[0]=99;assert.equal(b[20],0);}
  const bads=[bytes.slice(0,-1),new Uint8Array([...bytes,0]),new Uint8Array(20),Uint8Array.from(bytes)];bads.at(-1)[0]=0;
  for(const offset of [4,8,12,16]){const b=Uint8Array.from(bytes);new DataView(b.buffer).setUint32(offset,0,true);bads.push(b);}
  const huge=Uint8Array.from(bytes);new DataView(huge.buffer).setUint32(4,0xffffffff,true);bads.push(huge);
  for(const b of bads)assert.throws(()=>parseVolume(b));
  assert.deepEqual([...parseVolume(bytes,{vflip:true}).data.slice(0,4)],[0,255,0,255]);
  const images=new ImageByteStore(),{id}=await images.put(bytes),local={...project,visuals:{...project.visuals,channels:{Image:[{...input,src:'asset:'+id}]}}};
  const archive=exportProject(local,{images}),restored=await importProject(archive);assert.deepEqual(restored.images.get(id),bytes);assert.deepEqual(restored.project,local);assert.equal(archive.images.length,1);
  await assert.rejects(importProject({...archive,images:[{id,data:Buffer.from(bads[0]).toString('base64')}]}));
  fs.writeFileSync(path.join(root,'native-volume-project.json'),JSON.stringify(archive));
  const server=http.createServer((req,res)=>{
    if(req.url==='/probe'){res.setHeader('content-type','text/html');return res.end('<canvas width="8" height="8"></canvas><script src="/probe.js"></script>');}
    if(req.url==='/probe.js'){res.setHeader('content-type','text/javascript');return res.end(bundle);}
    const file=path.join(root,req.url==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(20000);
    await page.route('https://volumes.example.test/**',route=>{
      const name=new URL(route.request().url()).pathname;let body=bytes;
      if(name==='/bad.bin')body=bads[0];else if(name==='/r.bin')body=volume(1,3,2,2);else if(name==='/rg.bin')body=volume(2,3,2,2);else if(name==='/rgb.bin')body=volume(3,3,2,2);else if(name==='/gray.bin'){body=volume(1,1,1,1);body[20]=128;}
      return route.fulfill({contentType:'application/octet-stream',headers:{'access-control-allow-origin':'*'},body:Buffer.from(body)});
    });
    await page.goto(origin+'/probe');await page.waitForFunction(()=>window.s);
    const sample=(channel,expression)=>page.evaluate(async({channel,expression})=>{(await s.prepareAsync({Image:`void mainImage(out vec4 c,in vec2 p){c=${expression};}`,channels:{Image:[channel]}})).apply();s.render();return {pixel:pixel(),error:s.gl.getError()};},{channel,expression});
    for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){const r=await sample(input,`texelFetch(iChannel0,ivec3(${x},${y},${z}),0)`);assert.deepEqual(r.pixel,[x*255,y*255,z*255,255]);assert.equal(r.error,0);}
    assert.deepEqual((await sample({...input,vflip:true},'texture(iChannel0,vec3(.25,.25,.25))')).pixel,[0,255,0,255]);
    near((await sample({...input,filter:'linear'},'texture(iChannel0,vec3(.5))')).pixel,[128,128,128,255]);
    near((await sample({...input,filter:'mipmap'},'textureLod(iChannel0,vec3(.5),1.)')).pixel,[128,128,128,255]);
    assert.deepEqual((await sample({...input,wrap:'repeat'},'texture(iChannel0,vec3(.25,.25,1.75))')).pixel,[0,0,255,255]);
    assert.deepEqual((await sample(input,'vec4(iChannelResolution[0]/2.,1.)')).pixel,[255,255,255,255]);
    assert.deepEqual((await sample(input,'vec4(iChannelTime[0],0.,0.,1.)')).pixel,[0,0,0,255]);
    for(const [name,color]of [['r',[255,0,0,255]],['rg',[255,255,0,255]],['rgb',[255,255,255,255]]])assert.deepEqual((await sample({...input,src:`https://volumes.example.test/${name}.bin`},'texelFetch(iChannel0,ivec3(2,1,1),0)')).pixel,color);
    near((await sample({...input,src:'https://volumes.example.test/gray.bin',srgb:true},'texture(iChannel0,vec3(.5))')).pixel,[55,0,0,255]);
    const mixed=await page.evaluate(async input=>{(await s.prepareAsync({A:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(.75,.25,.25));}',Cube:'void mainCubemap(out vec4 c,in vec2 p,in vec3 ro,in vec3 rd){c=texture(iChannel0,vec3(.25,.75,.25));}',Image:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(.25,.25,.75))+texture(iChannel1,vec2(.5))+texture(iChannel2,vec3(1,0,0));}',channels:{A:[input],Cube:[input],Image:[input,'A','Cube']}})).apply();s.render();return {pixel:pixel(),shared:s.passes.every(p=>p.images[0]===s.passes[0].images[0]),error:s.gl.getError()};},input);assert.deepEqual(mixed.pixel,[255,255,255,255]);assert(mixed.shared);assert.equal(mixed.error,0);
    const before=await page.evaluate(()=>({document:s.document,pixel:pixel()}));await assert.rejects(sample({...input,src:'https://volumes.example.test/bad.bin'},'texture(iChannel0,vec3(.5))'),/invalid/);assert.deepEqual(await page.evaluate(()=>({document:s.document,pixel:pixel()})),before);
    const rollback=await page.evaluate(async()=>{const texture=s.passes[0].images[0].texture,c=s.prepare({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(0.);}'});c.apply({retainPrevious:true});await c.rollback();c.dispose();s.render();return {pixel:pixel(),retained:s.gl.isTexture(texture),error:s.gl.getError()};});assert(rollback.retained);assert.deepEqual(rollback.pixel,[255,255,255,255]);assert.equal(rollback.error,0);
    await page.evaluate(()=>{window.loss=s.gl.getExtension('WEBGL_lose_context');loss.loseContext();});await page.waitForFunction(()=>s.lost);await page.evaluate(()=>loss.restoreContext());await page.waitForFunction(()=>statusText==='Visuals recovered');assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[255,255,255,255]);
    assert(await page.evaluate(()=>{const texture=s.passes[0].images[0].texture;s.dispose();return !s.gl.isTexture(texture);}));await page.close();
    const workspace=await browser.newPage({viewport:{width:1200,height:800}});await configureAudio(workspace);await workspace.goto(origin);await workspace.waitForFunction(()=>window.algoravePreview);await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#advanced summary').first().click();const first=workspace.locator('#channel-editor fieldset').first();await first.getByLabel('Image Input',{exact:true}).selectOption('volume');
    await first.getByLabel('Image Import volume',{exact:true}).setInputFiles({name:'grid.bin',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});await workspace.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Volume imported'));await workspace.locator('#set-channels').click();await workspace.getByLabel('GLSL visual',{exact:true}).fill(image);await workspace.locator('#run').click();await workspace.waitForFunction(image=>algoravePreview.session.applied.visuals.Image===image,image);
    const output=()=>workspace.evaluate(()=>{const s=algoravePreview.shader;s.render();const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];});assert.deepEqual(await output(),[255,0,255,255]);
    await first.getByLabel('Image Flip vertically',{exact:true}).check();await workspace.locator('#set-channels').click();await workspace.locator('#run').click();await workspace.waitForFunction(()=>algoravePreview.session.applied.visuals.channels.Image[0].vflip);assert.deepEqual(await output(),[255,255,255,255]);await workspace.locator('#menu summary').click();await workspace.locator('#undo').click();await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.deepEqual(await output(),[255,0,255,255]);
    const downloadEvent=workspace.waitForEvent('download');await workspace.locator('#download').click();const download=await downloadEvent,downloaded=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.deepEqual((await importProject(downloaded)).images.get(id),bytes);
    await workspace.reload();await workspace.waitForFunction(()=>window.algoravePreview);assert.deepEqual(await output(),[255,0,255,255]);assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    const fresh=await browser.newContext(),opened=await fresh.newPage();await configureAudio(opened);await opened.goto(origin);await opened.waitForFunction(()=>window.algoravePreview);await opened.locator('#project-file').setInputFiles({name:'volume.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(downloaded))});await opened.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');assert.equal(await opened.evaluate(()=>algoravePreview.session.applied.visuals.channels.Image[0].type),'volume');assert.equal(await opened.evaluate(()=>algoravePreview.playing),false);await fresh.close();
    await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#advanced summary').first().click();await workspace.setViewportSize({width:390,height:844});assert(await workspace.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await workspace.screenshot({path:path.join(root,'volume-input-narrow.png')});await workspace.close();
    console.log('PASS: volume header/size/immutability/archive validation; actual 3D voxels, R/RG/RGB/RGBA odd-row alignment, filtering/mips/depth wrap/sRGB, uniforms, shared mixed passes, failed load retention, rollback/recovery/disposal, local import/Run/Undo/download/fresh Open/stopped reload/narrow. Original fixtures; zero provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
