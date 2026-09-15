'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
  let reads=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/source-read'){reads++;res.setHeader('access-control-allow-origin','*');return res.end('ok');}
    const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(20000);
    await configureAudio(page);
    await page.goto(origin);await page.waitForFunction(()=>window.algoravePreview);
    const frame=page.frames().find(f=>f!==page.mainFrame());
    await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(x=>x>0)).catch(async error=>{
      console.error(await page.evaluate(()=>({playing:algoravePreview.playing,status:document.getElementById('status').textContent})));
      console.error(await frame.evaluate(()=>({audio:getAudioContext().state,time:getAudioContext().currentTime})));throw error;
    });
    const initial=await page.evaluate(()=>structuredClone(algoravePreview.session.applied));
    const tempo=await page.evaluate(()=>algoravePreview.signal.cps);
    assert.deepEqual(await frame.evaluate(()=>{
      const result={};
      for(const [name,read] of Object.entries({parent:()=>parent.document.body,storage:()=>localStorage.getItem('secret'),database:()=>indexedDB.open('ct-algorave-samples-v1')})){
        try{read();result[name]=false;}catch(error){result[name]=error.name==='SecurityError';}
      }
      return result;
    }),{parent:true,storage:true,database:true});
    const source=`await fetch('${origin}/source-read'); let hits=0; setcpm(30); note("c3*4").s("triangle").gain(.2).onTrigger(()=>{globalThis.runtimeHits=++hits;},false)`;
    // Preparing a proposal parses source but does not execute its side effects.
    const token=await page.evaluate(async source=>(await algoravePreview.bridge.request('prepare',source)).token,source);
    assert.equal(reads,0);
    await page.evaluate(async token=>algoravePreview.bridge.request('discard',undefined,{token}),token);
    const run=async source=>{
      await page.getByLabel('Strudel music').fill(source);await page.locator('#run').click();
      await page.waitForFunction(()=>!algoravePreview.session.busy&&!document.getElementById('run').disabled);
    };
    await run(source);assert.equal(reads,1,'source side effects execute once on Run');
    await frame.waitForFunction(()=>globalThis.runtimeHits>1,null,{polling:50});
    const good=await page.evaluate(()=>structuredClone(algoravePreview.session.applied));
    await frame.evaluate(()=>{globalThis.originalBd=soundMap.get().bd;});
    const customBd="registerSound('bd',(time,value,onended)=>{const node=getAudioContext().createOscillator();node.onended=onended;node.start(time);return {node,stop:t=>node.stop(t)};});";
    for(const source of ['this is invalid (','setcpm(999); missingFunction()',customBd+'missingFunction()']){
      await run(source);
      assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),good);
      assert.equal(await page.evaluate(()=>algoravePreview.playing),true);
      await page.waitForFunction(cps=>algoravePreview.signal.cps===cps,tempo);
      assert.equal(await frame.evaluate(()=>soundMap.get().bd===globalThis.originalBd),true,'failed registration restores the previous sound');
    }
    await run(customBd+'s("bd*4").gain(.1)');
    assert.equal(await frame.evaluate(()=>soundMap.get().bd===globalThis.originalBd),false);
    await page.locator('#menu summary').click();await page.locator('#undo').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');
    await page.locator('#menu summary').click();
    assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),good);
    assert.equal(await frame.evaluate(()=>soundMap.get().bd===globalThis.originalBd),true,'Undo restores the actual sound registry, not just its source');
    // Upstream clock recovery skips expired slices without stopping the REPL.
    const before=await page.evaluate(()=>algoravePreview.signal.time);
    await frame.evaluate(()=>{const until=performance.now()+2500;while(performance.now()<until){}});
    await page.waitForFunction(time=>algoravePreview.signal.time>time+2.5,before);
    assert.equal(await page.evaluate(()=>algoravePreview.playing),true);
    // Stop remains available during an asynchronous source evaluation. A late
    // completion must not commit the candidate or resume the stopped engine.
    await page.getByLabel('Strudel music').fill('await new Promise(resolve=>setTimeout(resolve,2000)); note("g6*8").s("square")');
    await page.locator('#run').click();await page.waitForFunction(()=>algoravePreview.session.busy);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.waitForFunction(()=>!algoravePreview.session.busy&&!document.getElementById('run').disabled);
    assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),good);
    // dough() bypasses Superdough's orbit mixer. The complete output tap must
    // still supply the shader's waveform/spectrum for that upstream DSP path.
    await run("await dough('function trigger(v){} function dsp(t){return Math.sin(t*1382.3)*.1;}');");
    await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(x=>x>0));
    // A known 220 Hz DSP tone must occupy the Shadertoy 2048-point FFT bin.
    // A 1024-point analyser still produces nonzero bytes but puts it at half
    // the expected index, visibly changing frequency-reactive shaders.
    await page.waitForFunction(()=>{
      const {frequency,waveform,sampleRate}=algoravePreview.signal;
      const peak=frequency.indexOf(Math.max(...frequency));
      return frequency.length===512&&waveform.length===512&&
        Math.abs(peak-220*2048/sampleRate)<=1&&
        Math.max(...waveform)-Math.min(...waveform)>10;
    });
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    const beforeOpen=reads;
    await page.evaluate(async source=>{
      const {token}=await algoravePreview.bridge.request('prepare',source,{defer:true,restore:true,checkpoint:0});
      await algoravePreview.bridge.request('commit',undefined,{token,play:false});
    },source);
    assert.equal(reads,beforeOpen,'opening a project must not execute its source');
    await run(initial.music);await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(x=>x>0));
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    console.log('PASS: full Strudel closures, source execution exactly once, private-state isolation, syntax/evaluation rollback, tempo retention, delayed-clock recovery, async Stop/cancellation and repaired playback.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
