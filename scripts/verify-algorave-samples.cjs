'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../dist');
(async()=>{
  const {drumWav}=await import('../src/algorave/drum-samples.mjs');
  const bytes=Buffer.from(drumWav('sd',16000)),replacement=Buffer.from(drumWav('hh',16000));
  const server=http.createServer((req,res)=>{
    let file=path.join(root,new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(15000);
    await configureAudio(page);
    await page.goto(origin+'/algorave/index.html');await page.waitForFunction(()=>window.algoravePreview);
    const snapshot=()=>page.evaluate(()=>structuredClone(algoravePreview.session.applied));
    async function add(name,buffer){
      await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#sample-open').click();
      await page.locator('#sample-name').fill(name);await page.locator('#sample-file').setInputFiles({name:name+'.wav',mimeType:'audio/wav',buffer});
      await page.locator('#sample-add').click();await page.waitForFunction(()=>!document.getElementById('sample-dialog').open&&!document.getElementById('run').disabled);
    }
    await add('clap',bytes);assert.equal(await page.evaluate(()=>algoravePreview.playing),false,'import does not autoplay');
    const first=await snapshot();assert(first.samples.clap[0]);
    await page.getByLabel('Strudel music').fill('setcpm(30); s("clap*4").gain(.5).crush(4)');await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency.some(x=>x>0));
    const before=await snapshot(),epoch=await page.evaluate(()=>algoravePreview.signal.epoch);
    await page.getByLabel('Strudel music').fill('s("missing_sample")');await page.getByRole('button',{name:'Run',exact:true}).click();
    // Upstream resolves sounds at the scheduled event, including dynamic
    // registrations. A missing name is a visible runtime diagnostic, not a
    // restricted compiler rejection. Undo must recover the previous sample.
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('sound missing_sample not found'));
    assert.equal((await snapshot()).music,'s("missing_sample")');assert.equal(await page.evaluate(()=>algoravePreview.playing),true);
    await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#undo').click();
    await page.waitForFunction(music=>algoravePreview.session.applied.music===music,before.music);
    assert.deepEqual(await snapshot(),before);
    assert.equal(await page.getByLabel('Strudel music').innerText(),before.music,'Run Undo restores the editor as well as playback');
    await add('clap',replacement);const changed=await snapshot();assert.notDeepEqual(changed.samples,before.samples);
    assert.equal(await page.evaluate(()=>algoravePreview.signal.epoch),epoch,'sample edit keeps audio phase');
    await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#undo').click();
    await page.waitForFunction(id=>algoravePreview.session.applied.samples.clap[0]===id,before.samples.clap[0]);
    assert.deepEqual(await snapshot(),before,'Undo restores exact bank and source');
    const remote='https://raw.githubusercontent.com/fixture/samples/main/clap.wav';let remoteCalls=0;
    await page.route(remote,route=>{remoteCalls++;const headers=route.request().headers();assert(!headers.cookie&&!headers.authorization);return route.fulfill({contentType:'audio/wav',headers:{'access-control-allow-origin':'*'},body:replacement});});
    await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#sample-open').click();
    await page.locator('#sample-name').fill('remote');await page.locator('#sample-url').fill(remote);await page.locator('#sample-add').click();
    await page.waitForFunction(()=>algoravePreview.session.applied.samples.remote&&!document.getElementById('sample-dialog').open);
    assert.equal((await snapshot()).samples.remote[0],changed.samples.clap[0]);assert.equal(remoteCalls,1);
    await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#undo').click();
    await page.waitForFunction(()=>!algoravePreview.session.applied.samples.remote&&!document.getElementById('run').disabled);
    assert.deepEqual(await snapshot(),before);
    const agent=await page.evaluate(()=>algoravePreview.session.requestContext('Add a bassline','music'));
    assert.deepEqual(agent.project.samples,before.samples);assert(!JSON.stringify(agent).includes(bytes.toString('base64')));
    await page.reload();await page.waitForFunction(()=>window.algoravePreview);
    assert.deepEqual(await snapshot(),before);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>algoravePreview.signal.frequency?.some(x=>x>0)).catch(async error=>{
      console.error(await page.evaluate(()=>({status:document.getElementById('status').textContent,playing:algoravePreview.playing})));
      console.error(await page.frames().find(f=>f!==page.mainFrame()).evaluate(()=>({state:getAudioContext().state,time:getAudioContext().currentTime,sink:getAudioContext().sinkId})));throw error;
    });
    await page.locator('#menu').evaluate(el=>el.open=true);
    const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;
    const archive=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(archive.format,'ct-algorave-samples');assert.deepEqual(Buffer.from(archive.assets[0].data,'base64'),bytes);
    await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForFunction(()=>!algoravePreview.playing);
    // A fresh storage partition must restore entirely from the downloaded file.
    const fresh=await browser.newContext(),other=await fresh.newPage();other.setDefaultTimeout(15000);
    await configureAudio(other);
    await other.goto(origin+'/algorave/index.html');await other.waitForFunction(()=>window.algoravePreview);
    await other.locator('#project-file').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    await other.waitForFunction(()=>document.getElementById('status').textContent==='Project opened · press Play');
    assert.deepEqual(await other.evaluate(()=>algoravePreview.session.applied),before);
    assert.equal(await other.evaluate(()=>algoravePreview.playing),false);
    await other.getByRole('button',{name:'Play',exact:true}).click();await other.waitForFunction(()=>algoravePreview.signal.frequency?.some(x=>x>0));
    const bad=structuredClone(archive);bad.assets[0].data='AAAA';
    await other.locator('#project-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});
    await other.waitForFunction(()=>document.getElementById('status').textContent.includes('Could not open'));
    assert.deepEqual(await other.evaluate(()=>algoravePreview.session.applied),before);assert.equal(await other.evaluate(()=>algoravePreview.playing),true);
    await other.getByRole('button',{name:'Stop',exact:true}).click();await other.waitForFunction(()=>!algoravePreview.playing);
    await fresh.close();
    await page.setViewportSize({width:390,height:844});await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#sample-open').click();
    await page.locator('#sample-name').fill('bad/name');await page.locator('#sample-add').click();
    await page.waitForFunction(()=>document.getElementById('sample-feedback').textContent.includes('lowercase'));
    assert(await page.locator('#sample-feedback').isVisible());
    assert(await page.evaluate(()=>{const r=document.getElementById('sample-dialog').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight;}));
    await page.screenshot({path:path.resolve(__dirname,'../.algorave-preview/samples-dialog.png')});
    await context.close();
    console.log('PASS: WAV import through upstream sampler, no autoplay, playing bank replacement/phase/exact Undo, metadata-only agent context, IndexedDB reload, exact-byte project export and fresh-context restore, damaged archive retains playing project.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
