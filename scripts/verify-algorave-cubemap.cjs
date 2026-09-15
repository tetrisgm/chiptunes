'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),esbuild=require('esbuild');
const {chromium}=require('playwright'),{PNG}=require('pngjs'),{configureAudio}=require('./algorave-browser-audio.cjs');
const contract=require('../src/algorave/project.cjs'),root=path.resolve(__dirname,'../.algorave-preview');
const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255],[255,0,255,255],[0,255,255,255]],labels=['+X','-X','+Y','-Y','+Z','-Z'];
function png(color,width=2,height=2){const image=new PNG({width,height});for(let i=0;i<width*height;i++)image.data.set(color,i*4);return PNG.sync.write(image);}
const grid=new PNG({width:2,height:2});grid.data=Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);const gridBytes=PNG.sync.write(grid);
const bytes=colors.map(c=>png(c)),faces=colors.map((_,i)=>`https://cube.example.test/${i}.png`),cube={type:'cubemap',faces,filter:'nearest'};
const base={version:1,runtime:contract.RUNTIME,music:'',visuals:{Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}',channels:{Image:[cube]}}};
assert.deepEqual(contract.project(base).visuals.channels.Image[0],cube);
for(const bad of [{...cube,faces:faces.slice(1)},{...cube,faces:Array(6)},{...cube,faces:[...faces.slice(1),'data:fake']},{...cube,src:faces[0]},{type:'texture',src:faces[0],faces},{type:'audio',faces}])assert.throws(()=>contract.channel(bad,{}));
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:`import {ShaderRuntime} from './src/algorave/shader-runtime.mjs';window.s=new ShaderRuntime(document.querySelector('canvas'),{onStatus:text=>window.statusText=text});window.pixel=()=>{const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];};`},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
(async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/probe'){res.setHeader('content-type','text/html');return res.end('<canvas width="8" height="8"></canvas><script src="/probe.js"></script>');}
    if(req.url==='/probe.js'){res.setHeader('content-type','text/javascript');return res.end(bundle);}
    const file=path.join(root,req.url==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(20000);
    await page.route('https://cube.example.test/**',route=>{
      const name=new URL(route.request().url()).pathname;return route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:name==='/grid.png'?gridBytes:name==='/bad.png'?png(colors[0],2,1):name==='/gray.png'?png([128,128,128,255]):bytes[Number(name.slice(1,-4))]});
    });
    await page.goto(origin+'/probe');await page.waitForFunction(()=>window.s);
    const sample=(input,expression)=>page.evaluate(async({input,expression})=>{(await s.prepareAsync({Image:`void mainImage(out vec4 c,in vec2 p){c=${expression};}`,channels:{Image:[input]}})).apply();s.render();return pixel();},{input,expression});
    const directions=['vec3(1,0,0)','vec3(-1,0,0)','vec3(0,1,0)','vec3(0,-1,0)','vec3(0,0,1)','vec3(0,0,-1)'];
    for(const [i,direction]of directions.entries())assert.deepEqual(await sample(cube,`texture(iChannel0,${direction})`),colors[i]);
    const oriented={...cube,faces:['https://cube.example.test/grid.png',...faces.slice(1)]};
    assert.deepEqual(await sample(oriented,'texture(iChannel0,vec3(1,.5,.5))'),colors[0]);
    assert.deepEqual(await sample({...oriented,vflip:true},'texture(iChannel0,vec3(1,.5,.5))'),colors[2]);
    assert.deepEqual(await sample(oriented,'texture(iChannel0,vec3(1,-.5,-.5))'),[255,255,255,255]);
    assert.deepEqual(await sample({...cube,filter:'mipmap'},'textureLod(iChannel0,vec3(1,0,0),1.)'),colors[0]);
    assert.deepEqual(await sample(cube,'textureCube(iChannel0,vec3(0,0,-1))'),colors[5]);
    assert.deepEqual(await sample(cube,'vec4(iChannelResolution[0].xy/2.,iChannelTime[0],1.)'),[255,255,0,255]);
    const srgb=await sample({...cube,faces:Array(6).fill('https://cube.example.test/gray.png'),srgb:true},'texture(iChannel0,vec3(1,0,0))');assert(srgb.slice(0,3).every(v=>Math.abs(v-55)<=1));
    const mixed=await page.evaluate(async cube=>{
      (await s.prepareAsync({Image:'void mainImage(out vec4 c,in vec2 p){c=.5*(texture(iChannel0,vec3(1,0,0))+texture(iChannel1,vec2(.5)));}',channels:{Image:[cube,{type:'texture',src:cube.faces[1]}]}})).apply();s.render();return {pixel:pixel(),error:s.gl.getError()};
    },cube);assert.deepEqual(mixed.pixel,[128,128,0,255]);assert.equal(mixed.error,0);
    const before=await page.evaluate(()=>({document:s.document,pixel:pixel()}));
    await assert.rejects(sample({...cube,faces:[...faces.slice(0,5),'https://cube.example.test/bad.png']},'texture(iChannel0,vec3(1,0,0))'),/square/);
    assert.deepEqual(await page.evaluate(()=>({document:s.document,pixel:pixel()})),before);
    const retained=await page.evaluate(async()=>{const texture=s.passes[0].images[0].texture,candidate=s.prepare({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}'});candidate.apply({retainPrevious:true});const during=s.gl.isTexture(texture);await candidate.rollback();candidate.dispose();s.render();return {during,after:s.gl.isTexture(texture),pixel:pixel()};});
    assert(retained.during&&retained.after);assert.deepEqual(retained.pixel,mixed.pixel);
    await sample(cube,'texture(iChannel0,vec3(0,0,1))');await page.evaluate(()=>{window.loss=s.gl.getExtension('WEBGL_lose_context');loss.loseContext();});await page.waitForFunction(()=>s.lost);
    await page.evaluate(()=>loss.restoreContext());await page.waitForFunction(()=>window.statusText==='Visuals recovered');assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),colors[4]);
    await page.close();
    const workspace=await browser.newPage({viewport:{width:1440,height:900}});await configureAudio(workspace);await workspace.goto(origin);await workspace.waitForFunction(()=>window.algoravePreview);
    await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#advanced summary').first().click();const first=workspace.locator('#channel-editor fieldset').first();
    await first.getByLabel('Image Input',{exact:true}).selectOption('cubemap');
    for(let i=0;i<6;i++){
      await first.getByLabel('Image Import '+labels[i],{exact:true}).setInputFiles({name:`face-${i}.png`,mimeType:'image/png',buffer:bytes[i]});
      await workspace.waitForFunction(i=>JSON.parse(document.getElementById('channels').value).Image[0].faces[i].startsWith('asset:'),i);
    }
    await workspace.locator('#set-channels').click();const source='void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(0,1,0));}';await workspace.getByLabel('GLSL visual',{exact:true}).fill(source);await workspace.locator('#run').click();await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');
    const pixel=target=>target.evaluate(()=>{const s=algoravePreview.shader;s.render();const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];});
    assert.deepEqual(await pixel(workspace),colors[2]);
    const changed=source.replace('vec3(0,1,0)','vec3(0,-1,0)');await workspace.getByLabel('GLSL visual',{exact:true}).fill(changed);await workspace.locator('#run').click();await workspace.waitForFunction(source=>algoravePreview.session.applied.visuals.Image===source,changed);assert.deepEqual(await pixel(workspace),colors[3]);
    await workspace.locator('#menu summary').click();await workspace.locator('#undo').click();await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.deepEqual(await pixel(workspace),colors[2]);
    const downloaded=workspace.waitForEvent('download');await workspace.locator('#download').click();const download=await downloaded,archive=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(archive.images.length,6);
    await workspace.reload();await workspace.waitForFunction(()=>window.algoravePreview);assert.deepEqual(await pixel(workspace),colors[2]);assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    const fresh=await browser.newContext(),opened=await fresh.newPage();await configureAudio(opened);await opened.goto(origin);await opened.waitForFunction(()=>window.algoravePreview);
    await opened.locator('#project-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});await opened.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');assert.deepEqual(await pixel(opened),colors[2]);await fresh.close();
    await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#advanced summary').first().click();await workspace.setViewportSize({width:390,height:844});await workspace.screenshot({path:path.join(root,'cube-inputs-narrow.png')});assert(await workspace.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await workspace.close();
    console.log('PASS: six cube directions, samplerCube/legacy alias, mipmaps, sRGB, resolution/time, mixed sampler types, failed-face retention, GL rollback/recovery, six local face imports, Run/Undo/reload, portable fresh-profile Open and narrow layout. Original images, zero provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
