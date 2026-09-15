'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
for(const name of ['csound','csound-browser']){
 const dir=path.resolve(__dirname,'../src/algorave/vendor',name),manifest=JSON.parse(fs.readFileSync(path.join(dir,'UPSTREAM.json')));
 for(const f of manifest.files){const file=path.join(dir,manifest.modified.includes(f.path)?'upstream':'',f.path);assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),f.sha256);}
}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await configureAudio(page);page.on("pageerror",e=>console.error("PAGE",e.message));page.on("console",m=>{if(m.type()==="error")console.error("CONSOLE",m.text().slice(0,300));});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.evaluate(()=>{globalThis.csoundLogs=[];document.addEventListener('strudel.log',e=>csoundLogs.push(e.detail));});
  const source=`await loadCSound(); note("a3").gain(.5).csound('triangle')`;
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
  await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>20)).catch(async e=>{console.error(await page.locator('#status').innerText());throw e;});
  const peak=()=>page.evaluate(()=>{const f=algoravePreview.signal.frequency;return f.indexOf(Math.max(...f));});
  assert(Math.abs(await peak()-10)<=1,'220 Hz fundamental');
  const values=await frame.evaluate(()=>({aliases:loadCSound===loadcsound&&loadCSound===loadCsound,dominant:note('a3').csound('triangle').queryArc(0,1)[0].context.dominantTrigger}));
  assert.deepEqual(values,{aliases:true,dominant:true});
  const changed=`await loadCSound\`instr probe
asig oscili p5, p4
outs asig, asig
endin\`; note("e4").gain(.5).csound('probe')`;
  await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();await page.waitForFunction(s=>algoravePreview.session.applied.music===s,changed);
  await page.waitForFunction(()=>{const f=algoravePreview.signal.frequency;return Math.abs(f.indexOf(Math.max(...f))-15)<=1}).catch(async e=>{console.error({peak:await peak(),status:await page.locator('#status').innerText(),logs:await frame.evaluate(()=>csoundLogs.slice(-8))});throw e;});
  await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');await page.locator('#menu summary').click();assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);
  await page.waitForFunction(()=>{const f=algoravePreview.signal.frequency;return Math.abs(f.indexOf(Math.max(...f))-10)<=1});
  let fetched=0;await page.route('https://raw.githubusercontent.com/fixture/orchestra/main/test.orc',route=>{fetched++;return route.fulfill({status:200,contentType:'text/plain',body:'instr midiProbe\nasig oscili p5/127*.1, cpsmidinn(p4)\nouts asig, asig\nendin'});});
  const midi=`await loadOrc('github:fixture/orchestra/main/test.orc'); await loadOrc('github:fixture/orchestra/main/test.orc'); note("a4").csoundm('midiProbe')`;
  await page.getByLabel('Strudel music').fill(midi);await page.locator('#run').click();await page.waitForFunction(s=>algoravePreview.session.applied.music===s,midi);
  await page.waitForFunction(()=>{const f=algoravePreview.signal.frequency;return Math.abs(f.indexOf(Math.max(...f))-20)<=1});assert.equal(fetched,1);
  let attempts=0;
  await page.route('https://orchestra.example.test/retry.orc',route=>{
    attempts++;
    return route.fulfill(attempts===1?{status:503,body:'Unavailable'}:attempts===2?{status:200,body:'this is invalid orchestra code'}:{status:200,body:'instr retryProbe\nasig oscili p5, p4\nouts asig, asig\nendin'});
  });
  const retry=`await loadOrc('https://orchestra.example.test/retry.orc'); note("a3").csound('retryProbe')`;
  await page.getByLabel('Strudel music').fill(retry);
  for(const message of ['HTTP 503','could not be compiled']){
    await page.locator('#run').click();await page.waitForFunction(message=>!algoravePreview.session.busy&&document.getElementById('status').textContent.includes(message),message);
    assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),midi);
  }
  await page.locator('#run').click();await page.waitForFunction(s=>algoravePreview.session.applied.music===s,retry);assert.equal(attempts,3);
  await page.waitForFunction(()=>{const f=algoravePreview.signal.frequency;return Math.abs(f.indexOf(Math.max(...f))-10)<=1});
  await page.getByLabel('Strudel music').fill('missingCsoundFunction()');await page.locator('#run').click();await page.waitForFunction(()=>!algoravePreview.session.busy&&!document.getElementById('run').disabled);assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),retry);
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
  console.log('PASS: real local Csound WASM/worklet audio, 220/330/440 Hz fundamentals, aliases, custom instruments, cached loadOrc, HTTP/compile failure retry, csoundm, Run/Undo, failed-edit retention, Stop and deferred reload. Silent sink; native and broader lifecycle acceptance pending.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
