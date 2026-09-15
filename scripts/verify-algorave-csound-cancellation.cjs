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
  const baseline=`note("a3").s('sine')`;
  await page.getByLabel('Strudel music').fill(baseline);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(v=>v>20));
  await frame.evaluate(()=>{
    const worklet=getAudioContext().audioWorklet,add=worklet.addModule.bind(worklet);
    globalThis.csoundModuleCount=0;
    worklet.addModule=(...args)=>{csoundModuleCount++;return new Promise((resolve,reject)=>{globalThis.releaseCsound=()=>add(...args).then(resolve,reject);});};
  });
  const source=`await loadCSound(); note("a4").csound('triangle')`;
  await page.getByLabel('Strudel music').fill(source);await page.locator('#run').click();await frame.waitForFunction(()=>typeof releaseCsound==='function',null,{polling:50}).catch(async e=>{console.error(await page.evaluate(()=>({status:document.getElementById('status').textContent,source:algoravePreview.editors.music.value,busy:algoravePreview.session.busy})));throw e;});
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  await page.waitForFunction(()=>!algoravePreview.session.busy,null,{timeout:5000});
  assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),baseline);
  await frame.evaluate(()=>{releaseCsound();});
  await page.waitForTimeout(300);assert.equal(await frame.evaluate(()=>getAudioContext().state),'suspended');
  await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.session.applied.music.includes('loadCSound'));
  await page.waitForFunction(()=>{const f=algoravePreview.signal.frequency;return Math.abs(f.indexOf(Math.max(...f))-20)<=1});
  assert.equal(await frame.evaluate(()=>csoundModuleCount),1);
  await frame.evaluate(()=>{
    const fetchOriginal=fetch;
    globalThis.orchestraRequests=0;globalThis.orchestraAborted=false;
    globalThis.fetch=(url,options)=>{
      if(url!=='https://orchestra.example.test/slow.orc')return fetchOriginal(url,options);
      orchestraRequests++;
      if(orchestraRequests>1)return Promise.resolve(new Response('instr retry\nasig oscili p5, p4\nouts asig, asig\nendin'));
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{orchestraAborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true}));
    };
  });
  const orchestra=`await loadOrc('https://orchestra.example.test/slow.orc'); note("a3").csound('retry')`;
  await page.getByLabel('Strudel music').fill(orchestra);await page.locator('#run').click();await frame.waitForFunction(()=>orchestraRequests===1,null,{polling:50});
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing&&!algoravePreview.session.busy,null,{timeout:5000});
  assert.equal(await frame.evaluate(()=>orchestraAborted),true);
  assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),source);
  await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.session.applied.music.includes('slow.orc'));
  await page.waitForFunction(()=>{const f=algoravePreview.signal.frequency;return Math.abs(f.indexOf(Math.max(...f))-10)<=1});assert.equal(await frame.evaluate(()=>orchestraRequests),2);
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
  console.log('PASS: Stop releases a pending Csound initialization edit, late module loading stays suspended, and Play reuses one real WASM worklet with 440 Hz output; Stop aborts a pending orchestra fetch and Play retries it with 220 Hz output.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
