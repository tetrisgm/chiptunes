'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),esbuild=require('esbuild');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const contract=require('../src/algorave/project.cjs'),root=path.resolve(__dirname,'../.algorave-preview');
const cube='void mainCubemap(out vec4 c,in vec2 p,in vec3 ro,in vec3 rd){c=vec4(.5+.5*rd,1.);}';
const image='void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(0,1,0));}';
const project={version:1,runtime:contract.RUNTIME,music:'',visuals:{Cube:cube,Image:image,channels:{Image:['Cube']}}};
assert.deepEqual(contract.project(project),project);
assert.throws(()=>contract.project({...project,visuals:{Image:image,channels:{Image:['Cube']}}}),/missing buffer/);
assert.throws(()=>contract.project({...project,visuals:{...project.visuals,channels:{Cube:['missing']}}}));
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:`import {ShaderRuntime} from './src/algorave/shader-runtime.mjs';window.s=new ShaderRuntime(document.querySelector('canvas'),{onStatus:text=>window.statusText=text});window.pixel=(x=0)=>{const g=s.gl,b=new Uint8Array(4);g.readPixels(x,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];};`},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
const near=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<=2,`${actual} != ${expected}`));};
(async()=>{
  const base=contract.project({...project,visuals:{Image:image,channels:{Image:[]}}}),baseRevision=await contract.revision(base);
  const proposal={id:'cube-add',baseRevision,explanation:'Generate a direction cube.',edits:[{document:'Cube',from:0,to:0,text:cube},{document:'channels',from:0,to:JSON.stringify(base.visuals.channels).length,text:JSON.stringify(project.visuals.channels)}]};
  assert.deepEqual(contract.candidateFrom(base,proposal,{id:proposal.id,baseRevision}),project);
  const server=http.createServer((req,res)=>{
    if(req.url==='/probe'){res.setHeader('content-type','text/html');return res.end('<canvas width="16" height="16"></canvas><script src="/probe.js"></script>');}
    if(req.url==='/probe.js'){res.setHeader('content-type','text/javascript');return res.end(bundle);}
    const file=path.join(root,req.url==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(20000);await page.goto(origin+'/probe');await page.waitForFunction(()=>window.s);
    const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,.5,.5],[.5,1,-.5],[-.5,-.5,-1]];
    const sampled=await page.evaluate(({cube,directions})=>{
      const source=`void mainImage(out vec4 c,in vec2 p){vec3 dirs[${directions.length}]=vec3[](${directions.map(d=>'vec3('+d.join(',')+')').join(',')});c=texture(iChannel0,dirs[min(int(p.x),${directions.length-1})]);}`;
      s.set({Cube:cube,Image:source,channels:{Image:['Cube']}});s.render();return {pixels:directions.map((_,i)=>pixel(i)),error:s.gl.getError(),size:s.passes.find(p=>p.name==='Cube').targets[0].width};
    },{cube,directions});
    directions.forEach((d,i)=>near(sampled.pixels[i],[...d.map(v=>(.5+.5*v/Math.hypot(...d))*255),255]));assert.equal(sampled.error,0);assert.equal(sampled.size,1024);
    const uniforms=await page.evaluate(()=>{
      s.set({Common:'vec4 pack(vec3 r){return vec4(r,1.);}',Cube:'void mainCubemap(out vec4 c,in vec2 p,in vec3 ro,in vec3 rd){c=pack(vec3(length(ro),length(rd),p.x/iResolution.x));}',Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(textureLod(iChannel0,vec3(1,0,0),2.).rg,iChannelResolution[0].x/1024.,1.);}',channels:{Image:[{type:'buffer',source:'Cube',filter:'mipmap'}]}});s.render();return {pixel:pixel(),error:s.gl.getError()};
    });near(uniforms.pixel,[0,255,255,255]);assert.equal(uniforms.error,0);
    const hdr=await page.evaluate(()=>{s.set({Cube:'void mainCubemap(out vec4 c,in vec2 p,in vec3 ro,in vec3 rd){c=vec4(-.25,2.,.5,1.);}',Image:'void mainImage(out vec4 c,in vec2 p){vec4 v=textureCube(iChannel0,vec3(1,0,0));c=vec4(v.r+.5,v.g/4.,v.b,1.);}',channels:{Image:['Cube']}});s.render();return pixel();});near(hdr,[64,128,128,255]);
    const feedback={A:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(1,0,0))+vec4(.01,0,0,0);}',Cube:'void mainCubemap(out vec4 c,in vec2 p,in vec3 ro,in vec3 rd){c=vec4(texture(iChannel0,vec2(.5)).r+.09,texture(iChannel1,rd).g+.1,0,1);}',Image:'void mainImage(out vec4 c,in vec2 p){vec4 v=texture(iChannel1,vec3(1,0,0));c=vec4(texture(iChannel0,vec2(.5)).r,v.rg,1.);}',channels:{A:['Cube'],Cube:['A','Cube'],Image:['A','Cube']}};
    const frames=await page.evaluate(feedback=>{s.set(feedback);const result=[];for(let i=0;i<3;i++){s.render({time:i/60});result.push(pixel());}return {result,error:s.gl.getError()};},feedback);
    frames.result.forEach((p,i)=>near(p,[(i*.1+.01)*255,(i+1)*.1*255,(i+1)*.1*255,255]));assert.equal(frames.error,0);
    const resize=await page.evaluate(()=>{const p=s.passes.find(p=>p.name==='Cube'),textures=p.targets.map(t=>t.texture);s.resize(23,17);s.render();return {same:p.targets.every((t,i)=>t.texture===textures[i]),pixel:pixel(),error:s.gl.getError(),size:p.targets[0].width};});assert(resize.same);assert.equal(resize.size,1024);near(resize.pixel,[79,102,102,255]);assert.equal(resize.error,0);
    const before=await page.evaluate(()=>({document:s.document,pixel:pixel()}));
    await assert.rejects(page.evaluate(()=>s.set({...s.document,Cube:'void mainCubemap(invalid'})),/Cube:/);
    assert.deepEqual(await page.evaluate(()=>({document:s.document,pixel:pixel()})),before);
    const rollback=await page.evaluate(async()=>{const old=s.passes.find(p=>p.name==='Cube').targets[0].texture,c=s.prepare({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}'});c.apply({retainPrevious:true});s.resize(31,19);await c.rollback();c.dispose();s.render();return {pixel:pixel(),retained:s.gl.isTexture(old),error:s.gl.getError()};});assert(rollback.retained);near(rollback.pixel,[105,128,128,255]);assert.equal(rollback.error,0);
    await page.evaluate(()=>{window.loss=s.gl.getExtension('WEBGL_lose_context');loss.loseContext();});await page.waitForFunction(()=>s.lost);await page.evaluate(()=>loss.restoreContext());await page.waitForFunction(()=>statusText==='Visuals recovered');near(await page.evaluate(()=>{s.render();return pixel();}),[3,26,26,255]);
    const disposed=await page.evaluate(()=>{const cube=s.passes.find(p=>p.name==='Cube'),targets=[...cube.targets];s.dispose();return targets.every(t=>!s.gl.isTexture(t.texture)&&!s.gl.isFramebuffer(t.fbo));});assert(disposed);await page.close();
    const workspace=await browser.newPage({viewport:{width:1100,height:800}});await configureAudio(workspace);await workspace.goto(origin);await workspace.waitForFunction(()=>window.algoravePreview);
    await workspace.locator('#project-file').setInputFiles({name:'generated-cube.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');
    const output=()=>workspace.evaluate(()=>{const s=algoravePreview.shader;s.render();const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];});near(await output(),[128,255,128,255]);
    await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#pass').selectOption('Cube');assert.equal(await workspace.getByLabel('GLSL visual',{exact:true}).innerText(),cube);
    const changed=cube.replace('.5+.5*rd','.5-.5*rd');await workspace.getByLabel('GLSL visual',{exact:true}).fill(changed);await workspace.locator('#run').click();await workspace.waitForFunction(changed=>algoravePreview.session.applied.visuals.Cube===changed,changed);near(await output(),[128,0,128,255]);
    await workspace.locator('#menu summary').click();await workspace.locator('#undo').click();await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Undone');near(await output(),[128,255,128,255]);assert.equal(await workspace.getByLabel('GLSL visual',{exact:true}).innerText(),cube);
    const downloadEvent=workspace.waitForEvent('download');await workspace.locator('#download').click();const download=await downloadEvent,archive=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.deepEqual(contract.project(archive),project);
    const fresh=await browser.newContext(),opened=await fresh.newPage();await configureAudio(opened);await opened.goto(origin);await opened.waitForFunction(()=>window.algoravePreview);await opened.locator('#project-file').setInputFiles({name:'cube-roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});await opened.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');assert.equal(await opened.evaluate(()=>algoravePreview.session.applied.visuals.Cube),cube);assert.equal(await opened.evaluate(()=>algoravePreview.playing),false);await fresh.close();
    await workspace.reload();await workspace.waitForFunction(()=>window.algoravePreview);near(await output(),[128,255,128,255]);assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#pass').selectOption('Cube');await workspace.locator('#advanced summary').first().click();assert(await workspace.locator('#channel-editor fieldset').first().getByLabel('Cube Input',{exact:true}).locator('option[value="Cube"]').count());
    await workspace.setViewportSize({width:390,height:844});assert(await workspace.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await workspace.close();
    console.log('PASS: mainCubemap directions/orientation, Common/uniforms, float HDR, mipmaps/legacy alias, prior-frame cube/self and current-frame 2D dependencies, resize retention, failed compile, rollback, context recovery/disposal, agent add-pass contract and real UI Cube Run/Undo/download/reload/narrow. Zero provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
