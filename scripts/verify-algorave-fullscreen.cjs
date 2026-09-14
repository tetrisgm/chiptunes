'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist');
(async()=>{
  const server=http.createServer((req,res)=>{
    let file=path.join(root,new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(404);return res.end();}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/create/');
    await page.frameLocator('#algorave-workspace').getByRole('button',{name:'Play',exact:true}).waitFor();
    const workspace=page.frames().find(frame=>frame.url().endsWith('/algorave/index.html'));
    await workspace.waitForFunction(()=>window.algoravePreview);
    await workspace.getByRole('button',{name:'Play',exact:true}).click();
    await workspace.waitForFunction(()=>algoravePreview.signal.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    const first=await workspace.evaluate(()=>({epoch:algoravePreview.signal.epoch,time:algoravePreview.signal.time}));
    for(const mode of ['music','visuals','both']){
      await workspace.locator('#mode').selectOption(mode);
      const before=await workspace.evaluate(()=>JSON.stringify(algoravePreview.session.draft));
      await workspace.locator('#menu').evaluate(el=>el.open=true);
      await workspace.getByRole('button',{name:'Fullscreen code + visuals',exact:true}).click();
      await workspace.waitForFunction(()=>document.fullscreenElement===document.documentElement);
      assert.equal(await page.evaluate(()=>document.fullscreenElement.id),'algorave-workspace');
      assert.equal(await workspace.locator('#menu').evaluate(el=>el.open),false);
      assert.equal(await workspace.locator('#agent').isVisible(),false);
      assert.equal(await workspace.getByRole('textbox',{name:'Strudel music'}).isVisible(),mode!=='visuals');
      assert.equal(await workspace.getByRole('textbox',{name:'GLSL visual'}).isVisible(),mode!=='music');
      assert.equal(await workspace.evaluate(()=>JSON.stringify(algoravePreview.session.draft)),before);
      // Editing and transport controls remain usable in the code presentation.
      assert.equal(await workspace.getByRole('button',{name:'Stop',exact:true}).isVisible(),true);
      if(mode==='both'){
        await workspace.getByRole('textbox',{name:'GLSL visual'}).fill('void mainImage(out vec4 c,in vec2 p) {\n  c=vec4(.2,.8,.3,1.);\n}');
        await workspace.getByRole('textbox',{name:'GLSL visual'}).press('ControlOrMeta+Enter');
        await workspace.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');
        await page.screenshot({path:path.join(root,'../.algorave-preview/fullscreen-code.png')});
      }
      await workspace.evaluate(()=>document.exitFullscreen());
      await workspace.waitForFunction(()=>!document.fullscreenElement);
      assert.equal(await workspace.evaluate(()=>algoravePreview.signal.epoch),first.epoch,'fullscreen and visual edits do not restart audio');
    }
    await workspace.locator('#menu').evaluate(el=>el.open=true);
    await workspace.getByRole('button',{name:'Fullscreen visuals',exact:true}).click();
    await workspace.waitForFunction(()=>document.fullscreenElement?.id==='output');
    await workspace.evaluate(()=>document.exitFullscreen());
    await workspace.waitForFunction(()=>!document.fullscreenElement);
    await workspace.waitForFunction(time=>algoravePreview.signal.time>time+.2,first.time);
    assert.equal(await workspace.evaluate(()=>algoravePreview.signal.epoch),first.epoch);
    await workspace.getByRole('button',{name:'Stop',exact:true}).click();
    await workspace.waitForFunction(()=>!algoravePreview.playing&&document.getElementById('status').textContent==='Stopped');
    assert.deepEqual(errors,[]);
    console.log('PASS: shared-frame fullscreen in Music/Visuals/Both, editing and transport controls, visuals-only fullscreen, unchanged project on entry, continuous audio epoch and successful exit/Stop.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
