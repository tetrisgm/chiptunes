'use strict';
// Run against the normal build, serially with other browser/audio checks.
// Short runs exercise the harness; only >=1800 seconds count as soak acceptance.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {configureAudio,audioSink}=require('./algorave-browser-audio.cjs');
const seconds=Number(process.env.ALGORAVE_SOAK_SECONDS||1800);
assert(Number.isFinite(seconds)&&seconds>=30&&seconds<=7200);
const root=path.resolve(__dirname,'../dist'),receipt=path.resolve(__dirname,'../.algorave-preview/upstream-soak-'+seconds+'s-receipt.json');
(async()=>{
  const {drumWav}=await import('../src/algorave/drum-samples.mjs');
  const sampleFiles=['bd','sd'].map(name=>Buffer.from(drumWav(name,16000)));
  const server=http.createServer((req,res)=>{
    let file=path.join(root,new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  const result={started:new Date().toISOString(),requestedSeconds:seconds,acceptanceRun:seconds>=1800,sampleReplacement:true,audioEffect:'crush(4)',drawingChanges:true,audioSink,acousticAcceptance:false,status:'running',samples:[]};
  const write=()=>{fs.mkdirSync(path.dirname(receipt),{recursive:true});fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');};
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(15000);await configureAudio(page);
    const workers=new Set();let peakWorkers=0;
    page.on('worker',w=>{workers.add(w);peakWorkers=Math.max(peakWorkers,workers.size);w.on('close',()=>workers.delete(w));});
    await page.addInitScript(()=>{
      const counts=globalThis.soakResources={textures:0,programs:0,samplers:0,blobURLs:0};
      if(globalThis.WebGL2RenderingContext)for(const [create,remove,key] of [['createTexture','deleteTexture','textures'],['createProgram','deleteProgram','programs'],['createSampler','deleteSampler','samplers']]){
        const proto=WebGL2RenderingContext.prototype,a=proto[create],b=proto[remove],live=new WeakSet();
        proto[create]=function(...args){const v=a.apply(this,args);if(v){live.add(v);counts[key]++;}return v;};
        proto[remove]=function(v){if(v&&live.delete(v))counts[key]--;return b.call(this,v);};
      }
      const create=URL.createObjectURL,revoke=URL.revokeObjectURL,urls=new Set();
      URL.createObjectURL=function(...args){const u=create.apply(this,args);urls.add(u);counts.blobURLs=urls.size;return u;};
      URL.revokeObjectURL=function(u){urls.delete(u);counts.blobURLs=urls.size;return revoke.call(this,u);};
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/algorave/index.html');
    await page.waitForFunction(()=>window.algoravePreview);
    result.build=await page.locator('footer').textContent();
    await page.evaluate(()=>{
      const signals=algoravePreview.signals,receive=signals.receive.bind(signals);
      const m=globalThis.soak={signals:0,kicks:0,maxKickGap:0,maxSignalGap:0,silentMs:0,maxSilentMs:0,lastKick:null,lastObserved:null,lastPoll:performance.now(),epochs:[]};
      signals.receive=function(s){
        if(s.playing){
          m.signals++;if(!m.epochs.includes(s.epoch))m.epochs.push(s.epoch);
          if(m.lastObserved!==null)m.maxSignalGap=Math.max(m.maxSignalGap,(s.observedAt-m.lastObserved)/1000);m.lastObserved=s.observedAt;
          for(const e of s.events)if(e.sound==='bd'){
            if(m.lastKick!==null)m.maxKickGap=Math.max(m.maxKickGap,e.time-m.lastKick);
            m.lastKick=e.time;m.kicks++;
          }
        }
        receive(s);
      };
      setInterval(()=>{const now=performance.now(),delta=now-m.lastPoll;m.lastPoll=now;
        if(algoravePreview.playing){m.silentMs=algoravePreview.signal.frequency?.some(x=>x>0)?0:m.silentMs+delta;m.maxSilentMs=Math.max(m.maxSilentMs,m.silentMs);}
      },100);
    });
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(x=>x));
    const started=Date.now(),cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    let audioCdp;
    try{audioCdp=await page.context().newCDPSession(page.frames().find(f=>f!==page.mainFrame()));await audioCdp.send('Performance.enable');}
    catch{audioCdp=null;}
    result.separateAudioHeapMeasured=Boolean(audioCdp);
    for(let index=0;Date.now()-started<seconds*1000;index++){
      // Reuse two content identities while changing a playing logical bank.
      // This exercises decoded-buffer reuse, IndexedDB writes and exact bank
      // ownership of queued events without growing a collection on purpose.
      await page.locator('#menu').evaluate(el=>el.open=true);await page.locator('#sample-open').click();
      await page.locator('#sample-name').fill('bd');
      await page.locator('#sample-file').setInputFiles({name:'bd.wav',mimeType:'audio/wav',buffer:sampleFiles[index%2]});
      await page.locator('#sample-add').click();
      await page.waitForFunction(()=>!document.getElementById('sample-dialog').open&&!document.getElementById('run').disabled);
      // Changing tempo and notes must not reset the playing session.
      await page.locator('#mode').selectOption('music');
      const source=`setcpm(${index%2?32:28})\n$: s("bd*4, [~ hh]*4, ~ sd ~ sd").gain(.4).crush(4)\n$: note("<c3 eb3 ${index%2?'g3':'f3'} bb3>").s("triangle").decay(.2).sustain(0).gain(.2).${index%2?'scope':'pianoroll'}()`;
      await page.getByLabel('Strudel music').fill(source);await page.getByRole('button',{name:'Run',exact:true}).click();
      await page.waitForFunction(s=>algoravePreview.session.applied.music===s&&!document.getElementById('run').disabled,source);
      await page.locator('#mode').selectOption('visuals');
      const shader=`void mainImage(out vec4 c,in vec2 p){vec2 uv=p/iResolution.xy;c=vec4(uv, .2+.3*sin(iTime*${index%2?'2.':'1.'}+ctKick),1.);}`;
      await page.getByLabel('GLSL visual').fill(shader);await page.getByRole('button',{name:'Run',exact:true}).click();
      await page.waitForFunction(s=>algoravePreview.session.applied.visuals.Image===s&&!document.getElementById('run').disabled,shader);
      await page.locator('#mode').selectOption(index%2?'both':'music');
      const until=Math.min(started+seconds*1000,Date.now()+30000);
      while(Date.now()<until)await new Promise(resolve=>setTimeout(resolve,Math.min(1000,until-Date.now())));
      const metrics=await cdp.send('Performance.getMetrics');
      const sample=await page.evaluate(()=>({monitor:soak,resources:soakResources,playing:algoravePreview.playing,history:algoravePreview.session.history.length}));
      const audioFrame=page.frames().find(f=>f!==page.mainFrame());
      sample.audioResources=await audioFrame.evaluate(()=>({...soakResources,canvases:document.querySelectorAll('canvas').length}));
      Object.assign(sample,{elapsedSeconds:(Date.now()-started)/1000,workers:workers.size,heap:metrics.metrics.find(m=>m.name==='JSHeapUsedSize').value});
      sample.audioHeap=audioCdp?(await audioCdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value:null;
      result.samples.push(sample);result.peakWorkers=peakWorkers;write();
      assert(sample.playing,'unexpected transport stop');assert.equal(sample.monitor.epochs.length,1,'edit reset audio epoch');
      assert(sample.monitor.maxKickGap<1.5,'scheduled kick continuity gap');assert(sample.monitor.maxSignalGap<2,'audio signal delivery gap');
      assert(sample.monitor.maxSilentMs<3000,'unexpected analyser silence');assert(sample.history<=20);
      assert(sample.workers<=2,'retired pattern worker retained');assert(sample.resources.programs<=2&&sample.resources.textures<=4&&sample.resources.samplers<=4,'shader resources grew');
      assert(sample.audioResources.canvases<=1,'retired drawing canvas retained');
      assert(sample.audioResources.blobURLs<=5,'sample/worker blob URLs grew');
      console.log(JSON.stringify({elapsed:Math.round(sample.elapsedSeconds),kicks:sample.monitor.kicks,workers:sample.workers,heapMB:Math.round(sample.heap/1048576),maxKickGap:sample.monitor.maxKickGap}));
    }
    // Compare collected heaps after the history has warmed up, without forcing GC.
    const heaps=result.samples.slice(20).map(s=>s.heap);
    if(heaps.length>5)assert(Math.max(...heaps)-Math.min(...heaps)<64*1048576,'main-frame heap growth exceeded 64MiB');
    const audioHeaps=result.samples.slice(20).map(s=>s.audioHeap).filter(v=>v!==null);
    if(audioHeaps.length>5)assert(Math.max(...audioHeaps)-Math.min(...audioHeaps)<64*1048576,'audio-frame heap growth exceeded 64MiB');
    await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForFunction(()=>!algoravePreview.playing);
    result.status='passed';result.finished=new Date().toISOString();write();console.log('PASS '+(result.acceptanceRun?'30-minute runtime performance check (acoustic acceptance separate)':'short harness check')+'; '+receipt);
  }catch(error){result.status='failed';result.error=String(error.stack||error);write();throw error;}
  finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
