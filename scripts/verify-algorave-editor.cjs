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
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
    const music=page.getByRole('textbox',{name:'Strudel music'}),visual=page.getByRole('textbox',{name:'GLSL visual'});
    const doc=()=>page.evaluate(()=>structuredClone(algoravePreview.session.draft));
    const original=await doc();assert(await page.locator('#music .cm-content span').count()>3,'Strudel syntax is highlighted');
    await music.click();await music.press('ControlOrMeta+Enter');await page.waitForFunction(()=>algoravePreview.playing);
    await music.press('Tab');assert.equal(await page.evaluate(()=>algoravePreview.editors.music.hasFocus),false,'Tab is not trapped');
    await page.waitForFunction(()=>Number.isSafeInteger(algoravePreview.signal.epoch)&&algoravePreview.signal.playing);
    const epoch=await page.evaluate(()=>algoravePreview.signal.epoch);
    await page.locator('#mode').selectOption('visuals');
    await visual.fill('void mainImage(out vec4 c,in vec2 p){c=vec4(1.)}');await visual.press('ControlOrMeta+Enter');
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Image:'));
    assert(await page.locator('#visual .cm-lintRange-error').count()>0,'GLSL error marks the source line');
    assert.equal(await page.evaluate(()=>algoravePreview.signal.epoch),epoch,'visual Run does not restart music');
    await visual.fill(original.visuals.Image);await visual.press('ControlOrMeta+Enter');
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Visuals updated');
    assert.equal(await page.locator('#visual .cm-lintRange-error').count(),0);
    // Histories belong to their shader pass. Undo in A must not insert Image code.
    await page.locator('#pass').selectOption('A');
    const buffer='void mainImage(out vec4 c,in vec2 p){c=vec4(.2,.4,.8,1.);}';
    await visual.fill(buffer);await visual.press('End');await visual.press('Enter');await visual.pressSequentially('// buffer note');
    await page.locator('#pass').selectOption('Image');
    assert.equal(await page.evaluate(()=>algoravePreview.editors.visual.value),original.visuals.Image);
    await page.locator('#pass').selectOption('A');await visual.press('ControlOrMeta+z');
    assert((await doc()).visuals.A.startsWith('void mainImage'));assert.equal((await doc()).visuals.Image,original.visuals.Image);
    await page.locator('#mode').selectOption('music');await music.fill('not');await music.press('Control+Space');
    await page.getByRole('option').filter({hasText:'note'}).first().waitFor();await music.press('Escape');
    await music.fill(original.music);
    await page.locator('#menu summary').click();
    for(const name of ['pulse','trails','groove']){
      await page.locator('#examples').selectOption(name);await page.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');
      assert.equal(await page.evaluate(()=>algoravePreview.playing),false,'examples load stopped');
      await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
      await page.waitForFunction(()=>algoravePreview.signal.frequency?.some(n=>n>0));
    }
    const beforeImport=await doc();
    const imported=structuredClone(beforeImport);imported.music='s("bd*2,hh*8").gain(.2)';
    imported.visuals={Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(.1,.8,.3,1.);}',channels:{Image:['audio']}};
    await page.locator('#project-file').setInputFiles({name:'performance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');
    assert.deepEqual(await doc(),imported);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    await music.press('ControlOrMeta+z');assert.deepEqual(await doc(),imported,'editor history from a previous project is not carried into an import');
    const downloaded=page.waitForEvent('download');await page.locator('#download').click();
    const download=await downloaded;assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),imported);
    await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');
    assert.deepEqual(await doc(),beforeImport,'import can be undone exactly');
    await page.locator('#project-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from('{"song":{"seed":1}}')});
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Could not open'));
    assert.deepEqual(await doc(),beforeImport,'legacy/unsupported input is not rewritten');
    await page.locator('#help-open').click();assert.equal(await page.getByRole('dialog').isVisible(),true);await page.locator('#help-close').click();
    await page.locator('#save').click();await page.locator('#menu summary').click();
    const lastFrame=await page.evaluate(()=>algoravePreview.shader.frame);
    await page.locator('#mode').selectOption('both');
    await page.waitForFunction(previous=>algoravePreview.shader.frame>previous+1,lastFrame);
    await page.waitForFunction(()=>{const s=algoravePreview.shader,g=s.gl,b=new Uint8Array(s.canvas.width*s.canvas.height*4);g.readPixels(0,0,s.canvas.width,s.canvas.height,g.RGBA,g.UNSIGNED_BYTE,b);return b.some((v,i)=>i%4!==3&&v>50);});
    await page.screenshot({path:path.join(root,'code-editors.png')});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(root,'code-editors-narrow.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: highlighted accessible editors, focused keyboard Run, GLSL line errors, per-pass Undo, completions, original examples, stopped import, portable download, import Undo, unsupported legacy preservation and narrow layout.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
