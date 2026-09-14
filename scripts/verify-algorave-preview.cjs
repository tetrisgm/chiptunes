'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,args:[]});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // The malformed-source fixture intentionally produces an upstream console error.
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.algoravePreview,{timeout:30000});
    assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>algoravePreview.playing,{timeout:15000});
    await page.waitForFunction(()=>algoravePreview.signal.frequency?.some(n=>n>0),{timeout:15000});
    const first=await page.evaluate(()=>({cycle:algoravePreview.signal.cycle,time:algoravePreview.signal.time}));
    assert(first.cycle>=0);
    const original=await page.getByLabel('Strudel music').inputValue();
    await page.getByLabel('Strudel music').fill('note("c3 e3 g3").s("triangle").gain(.1)');
    await page.getByRole('button',{name:'Run',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Music updated');
    await page.getByLabel('Strudel music').fill('this is invalid (');
    await page.getByRole('button',{name:'Run',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('run').disabled===false);
    assert.equal(await page.evaluate(()=>algoravePreview.playing),true,'bad music keeps playback');
    assert(await page.evaluate(()=>algoravePreview.signal.time)>first.time);
    assert.equal(await page.evaluate(()=>algoravePreview.signal.playing),true);
    const frame=page.frames().find(f=>f!==page.mainFrame());
    const isolation=await frame.evaluate(()=>{
      let parentBlocked=false,storageBlocked=false;
      try{void parent.document.body;}catch{parentBlocked=true;}
      try{localStorage.getItem('secret');}catch{storageBlocked=true;}
      return {parentBlocked,storageBlocked};
    });
    assert.deepEqual(isolation,{parentBlocked:true,storageBlocked:true});
    const shader=await page.evaluate(()=>{
      const s=algoravePreview.shader,g=s.gl;
      const pixel=()=>{const b=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,b);return [...b];};
      s.set({Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.,0.,0.,1.);}'});s.render();const red=pixel();
      let rejected=false;try{s.set({Image:'bad shader'});}catch{rejected=true;}s.render();const retained=pixel();
      s.set({A:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,p/iResolution.xy)+vec4(.1,0.,0.,0.);}',
        Image:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,p/iResolution.xy);}',channels:{A:['A'],Image:['A']}});
      s.render();const one=pixel();s.render();const two=pixel();
      s.set({A:'void mainImage(out vec4 c,in vec2 p){c=vec4(-1.,2.,0.,1.);}',
        Image:'void mainImage(out vec4 c,in vec2 p){vec4 v=texture(iChannel0,p/iResolution.xy);c=vec4(v.r+1.,v.g*.25,0.,1.);}',channels:{Image:['A']}});
      s.render();const signed=pixel();
      return {red,rejected,retained,one,two,signed,error:g.getError()};
    });
    assert.deepEqual(shader.red,[255,0,0,255]);assert(shader.rejected);assert.deepEqual(shader.retained,shader.red);
    assert(shader.two[0]>shader.one[0]+20,'feedback accumulates previous frame');assert.equal(shader.error,0);assert.equal(shader.signed[0],0);assert(Math.abs(shader.signed[1]-128)<=1,'buffers preserve signed HDR values');
    await page.getByLabel('Strudel music').fill(original);
    await page.getByRole('button',{name:'Run',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Music updated');
    await page.evaluate(()=>algoravePreview.shader.set({Image:document.getElementById('visual').value}));
    await page.getByLabel('Editor view').selectOption('both');
    await page.screenshot({path:path.join(root,'desktop.png')});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'narrow.png')});
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.waitForFunction(()=>!algoravePreview.playing);
    assert.deepEqual(errors,[],'no unhandled page exceptions');
    console.log('PASS: real Strudel audio, live edit/error retention, opaque-origin isolation, shader pixel output, last-good retention, multipass feedback, narrow layout, stop.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
