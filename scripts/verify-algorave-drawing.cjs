'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview'),vendor=path.resolve(__dirname,'../src/algorave/vendor/draw');
const upstream=JSON.parse(fs.readFileSync(path.join(vendor,'UPSTREAM.json')));
for(const file of upstream.files){
  const target=upstream.modified.includes(file.path)?path.join(vendor,'upstream',file.path):path.join(vendor,file.path);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),file.sha256);
}
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(20000);await configureAudio(page);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.algoravePreview);
    const frame=page.frames().find(f=>f!==page.mainFrame());assert.equal(await page.locator('#music-drawing').isVisible(),false);
    const run=async source=>{await page.getByLabel('Strudel music').fill(source);await page.locator('#run').click();await page.waitForFunction(()=>!document.getElementById('run').disabled);};
    const painted=()=>frame.waitForFunction(()=>{const c=document.querySelector('canvas');return c&&c.width>0&&c.height>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((n,i)=>i%4===3&&n>0);});
    const originalVisual=await page.evaluate(()=>algoravePreview.session.applied.visuals);
    await page.getByLabel('Strudel music').fill('s("rect").x(.1).y(.1).w(.5).h(.5).fill("cyan").animate()');
    await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
    await page.locator('#music-drawing').waitFor({state:'visible'});
    await frame.waitForFunction(()=>{const c=document.querySelector('canvas');if(!c?.width)return false;const p=c.getContext('2d').getImageData(Math.floor(c.width*.3),Math.floor(c.height*.3),1,1).data;return p[0]===0&&p[1]===255&&p[2]===255&&p[3]===255;});
    for(const method of ['pianoroll','scope','fscope','spectrum','punchcard','spiral','pitchwheel']){
      await run('setcpm(120); note("c3 eb3 g3 bb3").s("sawtooth").gain(.15).'+method+'()');
      assert.equal(await page.locator('#status').textContent(),'Music updated',method);
      await page.locator('#music-drawing').waitFor({state:'visible'});await painted();
      assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied.visuals),originalVisual);
      assert.equal(await frame.evaluate(()=>document.querySelectorAll('canvas').length),1);
      console.log('PASS upstream drawing: '+method);
    }
    for(const method of ['_pianoroll','_scope','_spectrum','_punchcard','_spiral','_pitchwheel']){
      await run('setcpm(120); note("c3 eb3 g3 bb3").s("sawtooth").gain(.15).'+method+'()');
      assert.equal(await page.locator('#status').textContent(),'Music updated',method);
      await frame.waitForFunction(()=>{const c=document.querySelector('canvas[data-inline-drawing]');return c&&c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((n,i)=>i%4===3&&n>0);},null,{polling:50});
      assert.equal(await frame.evaluate(()=>document.querySelectorAll('canvas[data-inline-drawing]').length),1);
      console.log('PASS upstream widget drawing: '+method);
    }
    const pair='stack(note("c3*4").s("sawtooth")._scope(), note("g3*4").s("triangle")._scope())';
    await run(pair);
    await frame.waitForFunction(()=>{const cs=[...document.querySelectorAll('canvas[data-inline-drawing]')];return cs.length===2&&cs.every(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0));},null,{polling:50});
    const ids=await frame.evaluate(()=>[...document.querySelectorAll('canvas[data-inline-drawing]')].map(c=>c.id));assert.equal(new Set(ids).size,2);
    await frame.evaluate(()=>window.widgetCanvases=[...document.querySelectorAll('canvas[data-inline-drawing]')]);
    await run(pair+'; missingDrawingFunction()');
    assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),pair);
    assert(await frame.evaluate(()=>widgetCanvases.every(c=>c.isConnected)&&document.querySelectorAll('canvas[data-inline-drawing]').length===2));
    const source="globalThis.evaluations=(globalThis.evaluations||0)+1; const ctx=getDrawContext(); note(\"c3*4\").s(\"triangle\").draw(()=>{globalThis.paints=(globalThis.paints||0)+1;ctx.fillStyle='red';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);},{id:'custom'})";
    await run(source);await frame.waitForFunction(()=>globalThis.paints>2);await frame.evaluate(()=>globalThis.oldCanvas=document.querySelector('canvas'));
    const good=await page.evaluate(()=>algoravePreview.session.applied);
    await page.getByLabel('Strudel music').fill("note(\"c4\").scope();await new Promise(resolve=>globalThis.failRelease=resolve);missingDrawingFunction()");
    await page.locator('#run').click();await frame.waitForFunction(()=>typeof globalThis.failRelease==='function',null,{polling:50}).catch(async error=>{console.error('Delayed drawing status:',await page.locator('#status').textContent());throw error;});
    assert.deepEqual(await frame.evaluate(()=>{const c=document.querySelector('canvas[data-drawing-preview]');return [...c.getContext('2d').getImageData(0,0,1,1).data];}),[255,0,0,255],'old pixels stay visible during asynchronous evaluation');
    await frame.evaluate(()=>globalThis.failRelease());await page.waitForFunction(()=>!document.getElementById('run').disabled);
    assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),good);
    assert.equal(await frame.evaluate(()=>globalThis.evaluations),1,'rollback never re-executes old source');
    assert.equal(await frame.evaluate(()=>oldCanvas===document.querySelector('canvas')),true,'rollback restores the actual canvas');
    const count=await frame.evaluate(()=>globalThis.paints);await frame.waitForFunction(count=>globalThis.paints>count,count);
    assert.deepEqual(await frame.evaluate(()=>[...oldCanvas.getContext('2d').getImageData(0,0,1,1).data]),[255,0,0,255]);
    await run('note("c4*4").s("triangle")');assert.equal(await page.locator('#music-drawing').isVisible(),false);
    await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');await page.locator('#menu summary').click();
    await page.locator('#music-drawing').waitFor({state:'visible'});assert.equal(await frame.evaluate(()=>globalThis.evaluations),2,'Undo executes restored source once');await painted();
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    const stopped=await frame.evaluate(()=>globalThis.paints);await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));assert.equal(await frame.evaluate(()=>globalThis.paints),stopped,'Stop freezes drawing callbacks');
    await page.locator('#play').click();await frame.waitForFunction(count=>globalThis.paints>count,stopped);
    const saved=await page.evaluate(()=>algoravePreview.session.applied);
    await page.locator('#project-file').setInputFiles({name:'drawing.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Project opened'));
    assert.equal(await page.locator('#music-drawing').isVisible(),false,'Open does not draw deferred source');assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    await page.locator('#play').click();await painted();
    await run('s("rect").x(.1).y(.1).w(.5).h(.5).fill("cyan").animate({callback:()=>{globalThis.animations=(globalThis.animations||0)+1;}})');await frame.waitForFunction(()=>globalThis.animations>2);await painted();
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);const animations=await frame.evaluate(()=>globalThis.animations);await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));assert.equal(await frame.evaluate(()=>globalThis.animations),animations);
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(root,'strudel-drawing-narrow.png')});
    assert.deepEqual(errors,[]);console.log('PASS: isolated visible drawing, upstream source provenance, rollback without re-evaluation, canvas retention, removal/Undo, Stop/Play, deferred Open, animation stop and narrow layout. No provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
