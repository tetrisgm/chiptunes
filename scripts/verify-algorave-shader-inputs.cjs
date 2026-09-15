'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),esbuild=require('esbuild');
const {chromium}=require('playwright'),{PNG}=require('pngjs');
const contract=require('../src/algorave/project.cjs'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview'),url='https://textures.example.test/grid.png';
const base={version:1,runtime:contract.RUNTIME,music:'s("bd")',visuals:{Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}'}};
for(const input of [{type:'texture',src:'javascript:alert(1)'},{type:'texture',src:'https://user:secret@example.test/a.png'},{type:'keyboard',src:url},{type:'buffer',source:'D'},{type:'texture',src:url,vflip:'true'},{type:'audio',filter:'invalid'},{type:'texture',src:url,unexpected:true}])assert.throws(()=>contract.project({...base,visuals:{...base.visuals,channels:{Image:[input]}}}));
const detached={type:'texture',src:url,filter:'mipmap',wrap:'repeat',vflip:true,srgb:true};
const normalized=contract.project({...base,visuals:{...base.visuals,channels:{Image:[detached,'keyboard']}}});detached.src='changed';assert.equal(normalized.visuals.channels.Image[0].src,url);
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:`import {ShaderRuntime} from './src/algorave/shader-runtime.mjs';window.s=new ShaderRuntime(document.querySelector('canvas'),{onStatus:text=>window.statusText=text});window.pixel=()=>{const g=s.gl,b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];};`},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
const png=new PNG({width:2,height:2});png.data=Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);const bytes=PNG.sync.write(png);
const gray=new PNG({width:1,height:1});gray.data=Buffer.from([128,128,128,255]);const grayBytes=PNG.sync.write(gray);
(async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/probe'){res.setHeader('content-type','text/html');return res.end('<canvas width="8" height="8"></canvas><textarea aria-label="Unrelated editor"></textarea><script src="/probe.js"></script>');}
    if(req.url==='/probe.js'){res.setHeader('content-type','text/javascript');return res.end(bundle);}
    const file=path.join(root,req.url==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(20000);let imageRequests=0;
    async function routes(target){await target.route('https://textures.example.test/**',route=>{
      const headers=route.request().headers();assert(!headers.cookie&&!headers.authorization&&!headers.referer);imageRequests++;
      return route.fulfill({status:route.request().url().includes('missing')?404:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:route.request().url().includes('gray')?grayBytes:bytes});
    });}
    await routes(page);await page.goto(origin+'/probe');await page.waitForFunction(()=>window.s);
    const sample=async(input,expression='texture(iChannel0,vec2(.25,.25))')=>page.evaluate(async({input,expression})=>{
      const candidate=await s.prepareAsync({Image:`void mainImage(out vec4 c,in vec2 p){c=${expression};}`,channels:{Image:[input]}});candidate.apply();s.render();return pixel();
    },{input,expression});
    const texture={type:'texture',src:url,filter:'nearest'};
    assert.deepEqual(await sample(texture),[255,0,0,255]);
    assert.deepEqual(await sample({...texture,vflip:true}),[0,0,255,255]);
    assert.deepEqual(await sample({...texture,wrap:'repeat'},'texture(iChannel0,vec2(1.25,.25))'),[255,0,0,255]);
    assert.deepEqual(await sample({...texture,wrap:'clamp'},'texture(iChannel0,vec2(1.25,.25))'),[0,255,0,255]);
    const linear=await sample({...texture,filter:'linear'},'texture(iChannel0,vec2(.5,.25))');assert(Math.abs(linear[0]-128)<=1&&Math.abs(linear[1]-128)<=1);
    const mip=await sample({...texture,filter:'mipmap'},'textureLod(iChannel0,vec2(.25),1.)');assert(mip.slice(0,3).every(value=>Math.abs(value-128)<=1));
    const srgb=await sample({...texture,src:'https://textures.example.test/gray.png',srgb:true});assert(srgb.slice(0,3).every(value=>Math.abs(value-55)<=1));
    const before=await page.evaluate(()=>({document:s.document,pixel:pixel()}));
    await assert.rejects(sample({...texture,src:'https://textures.example.test/missing.png'}),/HTTP 404/);
    assert.deepEqual(await page.evaluate(()=>({document:s.document,pixel:pixel()})),before);
    const transaction=await page.evaluate(async()=>{
      const previous=s.passes[0].images[0].texture;
      const candidate=await s.prepareAsync({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.,0.,0.,1.);}'});
      candidate.apply({retainPrevious:true});s.render();const during=s.gl.isTexture(previous);await candidate.rollback();candidate.dispose();s.render();
      return {during,restored:s.gl.isTexture(previous),pixel:pixel()};
    });assert(transaction.during&&transaction.restored);assert.deepEqual(transaction.pixel,srgb);
    const uniforms=await sample(texture,'vec4(iChannelResolution[0].xy/vec2(2.),iChannelTime[0],1.)');assert.deepEqual(uniforms,[255,255,0,255]);
    const samplerIsolation=await page.evaluate(()=>{
      s.set({A:'void mainImage(out vec4 c,in vec2 p){c=p.x<4.?vec4(1.,0.,0.,1.):vec4(0.,1.,0.,1.);}',Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(texture(iChannel0,vec2(.5,.5)).r,texture(iChannel1,vec2(.5,.5)).r,0.,1.);}',channels:{Image:[{type:'buffer',source:'A',filter:'nearest'},{type:'buffer',source:'A',filter:'linear'}]}});s.render();return pixel();
    });assert.equal(samplerIsolation[0],0);assert(Math.abs(samplerIsolation[1]-128)<=1);
    await sample('keyboard','vec4(texelFetch(iChannel0,ivec2(65,0),0).r,texelFetch(iChannel0,ivec2(65,1),0).r,texelFetch(iChannel0,ivec2(65,2),0).r,1.)');
    await page.locator('canvas').click();await page.keyboard.down('a');
    assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[255,255,255,255]);
    assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[255,0,255,255]);
    await page.keyboard.down('a');assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[255,0,255,255]);
    await page.keyboard.up('a');assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[0,0,255,255]);
    await page.keyboard.press('a');assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[0,255,0,255]);
    await page.getByLabel('Unrelated editor').fill('a');assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[0,0,0,255]);
    const resizedRollback=await page.evaluate(async()=>{
      s.set({A:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,p/iResolution.xy)+vec4(.1,0.,0.,0.);}',Image:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,p/iResolution.xy);}',channels:{A:['A'],Image:['A']}});s.render();s.render();
      const candidate=s.prepare({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(0.,1.,0.,1.);}'});candidate.apply({retainPrevious:true});s.resize(16,16);await candidate.rollback();candidate.dispose();s.render();
      const result={pixel:pixel(),width:s.passes[0].targets[0].width};s.resize(8,8);return result;
    });assert.equal(resizedRollback.width,16);assert(Math.abs(resizedRollback.pixel[0]-76)<=2,'rollback retains resized feedback content');
    await sample(texture);await page.evaluate(()=>{window.loss=s.gl.getExtension('WEBGL_lose_context');loss.loseContext();});await page.waitForFunction(()=>s.lost);
    await page.evaluate(()=>loss.restoreContext());await page.waitForFunction(()=>window.statusText==='Visuals recovered');
    assert.deepEqual(await page.evaluate(()=>{s.render();return pixel();}),[255,0,0,255]);
    await page.evaluate(()=>{window.transaction=s.prepare({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(0.,1.,0.,1.);}'});transaction.apply({retainPrevious:true});window.loss=s.gl.getExtension('WEBGL_lose_context');loss.loseContext();});
    await page.waitForFunction(()=>s.lost);await page.evaluate(()=>loss.restoreContext());await page.waitForFunction(()=>!s.lost&&s.passes.length>0);
    assert.deepEqual(await page.evaluate(async()=>{await transaction.rollback();transaction.dispose();s.render();return pixel();}),[255,0,0,255],'rollback rebuilds the prior texture after context loss');
    assert.equal(await page.evaluate(()=>s.gl.getError()),0);await page.close();
    // Exercise the real channel controls, Run, persistence and project Undo.
    const workspace=await browser.newPage({viewport:{width:1440,height:900}});await routes(workspace);await configureAudio(workspace);
    await workspace.goto(origin);await workspace.waitForFunction(()=>window.algoravePreview);
    const original=await workspace.evaluate(()=>algoravePreview.session.applied);
    await workspace.locator('#mode').selectOption('visuals');await workspace.locator('#advanced summary').first().click();
    const first=workspace.locator('#channel-editor fieldset').first();await first.getByLabel('Image Input',{exact:true}).selectOption('texture');
    await first.getByLabel('Image Image URL',{exact:true}).fill(url);await workspace.locator('#set-channels').click();
    await workspace.getByLabel('GLSL visual',{exact:true}).fill('void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec2(.25,.25));}');
    await workspace.locator('#run').click();await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');
    const applied=await workspace.evaluate(()=>algoravePreview.session.applied);assert.equal(applied.visuals.channels.Image[0].src,url);
    await workspace.reload();await workspace.waitForFunction(()=>window.algoravePreview);assert.deepEqual(await workspace.evaluate(()=>algoravePreview.session.applied),applied);assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false);
    await workspace.locator('#mode').selectOption('visuals');await workspace.getByLabel('GLSL visual',{exact:true}).fill('void mainImage(out vec4 c,in vec2 p){c=vec4(0.,1.,0.,1.);}');await workspace.locator('#run').click();
    await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');await workspace.locator('#menu summary').click();await workspace.locator('#undo').click();
    await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.deepEqual(await workspace.evaluate(()=>algoravePreview.session.applied),applied);
    assert.equal(applied.music,original.music);await workspace.locator('#menu summary').click();await workspace.setViewportSize({width:390,height:844});await workspace.locator('#advanced summary').first().click();
    await workspace.screenshot({path:path.join(root,'shader-inputs-narrow.png')});assert(await workspace.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await workspace.setViewportSize({width:1440,height:900});await workspace.locator('#play').click();await workspace.waitForFunction(()=>algoravePreview.playing);
    const delayed='https://textures.example.test/delayed.png';let release,arrived;
    const loading=new Promise(resolve=>arrived=resolve);
    await workspace.route(delayed,route=>new Promise(resolve=>{release=async()=>{await route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:bytes});resolve();};arrived();}));
    await workspace.route(origin+'/api/music/chat/access',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({authenticated:true,providers:[{id:'openai'}]})}));
    await workspace.route(origin+'/api/music/chat',route=>{
      const context=route.request().postDataJSON(),channels=JSON.stringify({...context.project.visuals.channels,Image:[{type:'texture',src:delayed}]});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({id:context.id,baseRevision:context.baseRevision,explanation:'Change the music and texture.',edits:[
        {document:'music',from:0,to:context.project.music.length,text:'setcpm(120); note("c3*4").s("triangle").gain(.2)'},
        {document:'channels',from:0,to:JSON.stringify(context.project.visuals.channels).length,text:channels},
      ]})});
    });
    await workspace.locator('#agent-toggle').click();await workspace.locator('#prompt').fill('Change the music and texture.');await workspace.locator('#ask').click();await workspace.locator('#apply').waitFor({state:'visible'});
    await workspace.locator('#apply').click();await loading;await workspace.locator('#play').click();await workspace.waitForFunction(()=>!algoravePreview.playing);
    await release();await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Proposal applied');assert.equal(await workspace.evaluate(()=>algoravePreview.playing),false,'Stop during texture preparation prevents late music restart');
    const saved=await workspace.evaluate(()=>algoravePreview.session.applied);
    await workspace.route('https://textures.example.test/**',route=>route.abort());
    await workspace.reload();await workspace.waitForFunction(()=>window.algoravePreview);
    assert.deepEqual(await workspace.evaluate(()=>algoravePreview.session.applied),saved);
    assert.match(await workspace.locator('#status').textContent(),/Saved visual could not load/);
    await workspace.locator('#play').click();await workspace.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    await workspace.close();console.log('PASS: texture orientation/filter/wrap/mips/sRGB, sampler independence, keyboard edges, feedback/resize/context rollback, input UI and Undo, Stop during paired loading, and music recovery with an unavailable saved image. Fixture images; '+imageRequests+' bounded requests; one agent fixture, zero provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
