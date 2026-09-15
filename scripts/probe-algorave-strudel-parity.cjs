'use strict';
// Differential evidence, not an acceptance gate: execute the SAME programs in
// upstream initStrudel and the shipped workspace. A gap is reported, not hidden
// by translating its source to fit the workspace's current worker boundary.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const esbuild=require('esbuild'),{chromium}=require('playwright');
const {configureAudio,audioSink}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'..');
const reference=esbuild.buildSync({stdin:{resolveDir:root,contents:`
  import {initStrudel,getAudioContext,initAudio,getSuperdoughAudioController} from '@strudel/web';
  let engine,analyser;
  window.reference={ready:false,error:null};
  document.getElementById('start').onclick=async()=>{
    try {
      const audio=getAudioContext(); await audio.resume();
      engine=await initStrudel(); getSuperdoughAudioController(); await initAudio();
      analyser=audio.createAnalyser(); analyser.fftSize=1024;
      getSuperdoughAudioController().output.destinationGain.connect(analyser);
      window.reference={ready:true,error:null,
        async run(source){await engine.evaluate(source,false);if(engine.state.error)throw engine.state.error;await engine.start();},
        stop(){engine.stop();},
        snapshot(){return {audio:audio.state,time:audio.currentTime,started:engine.state.started,lastEnd:engine.scheduler.lastEnd,error:String(engine.state.error||'')};},
        level(){const bytes=new Uint8Array(512);analyser.getByteFrequencyData(bytes);return Math.max(...bytes);},
        get cps(){return engine.scheduler.cps;}
      };
    }catch(error){window.reference.error=String(error.message||error);}
  };
`},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;

(async()=>{
  const {drumWav}=await import('../src/algorave/drum-samples.mjs');
  const wav=Buffer.from(drumWav('bd'));
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/reference'){
      res.setHeader('content-type','text/html');
      // No production auth, private storage or network proxy is supplied.
      return res.end('<button id="start">Start upstream</button><script src="/reference.js"></script>');
    }
    if(url.pathname==='/reference.js'){res.setHeader('content-type','text/javascript');return res.end(reference);}
    if(url.pathname==='/probe.wav'){res.setHeader('access-control-allow-origin','*');res.setHeader('content-type','audio/wav');return res.end(wav);}
    const base=path.join(root,'dist'),file=path.join(base,url.pathname);
    if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const programs=[
    {name:'core synth and mini-notation',source:'setcpm(120); note("c3 [eb3 g3]").s("triangle").decay(.1).gain(.2)'},
    {name:'custom Web Audio sound',source:`registerSound('probesynth', (time,value,onended) => { const node=getAudioContext().createOscillator(); node.frequency.value=220; node.onended=onended; node.start(time); return {node,stop:t=>node.stop(t)}; }); setcpm(120); s("probesynth*4").gain(.2)`},
    {name:'onTrigger closure',source:'setcpm(120); note("c3*4").s("triangle").gain(.2).onTrigger(() => { globalThis.probeHits=(globalThis.probeHits||0)+1; }, false)'},
    {name:'samples() source loading',source:`await samples({probe:['${origin}/probe.wav']}); setcpm(120); s("probe*4").gain(.3)`},
  ];
  const browser=await chromium.launch({headless:true}),results=[];
  try {
    const selected=programs.filter(x=>!process.argv[2]||x.name===process.argv[2]);
    assert(selected.length,'Unknown probe case');
    // The reference finishes and closes before the workspace plays: no overlap.
    for(const item of selected){
      const result={...item,reference:{},workspace:{}};
      const page=await browser.newPage();page.setDefaultTimeout(20000);
      await configureAudio(page);
      const messages=[];page.on('console',message=>{messages.push(message.text().slice(0,300));if(messages.length>8)messages.shift();});
      try {
        await page.goto(origin+'/reference');await page.locator('#start').click();
        await page.waitForFunction(()=>reference.ready||reference.error);
        assert.equal(await page.evaluate(()=>reference.error),null);
        await page.evaluate(source=>reference.run(source),item.source);
        await page.waitForFunction(()=>reference.level()>0);
        if(item.name==='onTrigger closure')await page.waitForFunction(()=>globalThis.probeHits>0);
        result.reference={plays:true,level:await page.evaluate(()=>reference.level())};
      }catch(error){result.reference={plays:false,error:error.message,state:await page.evaluate(()=>reference.snapshot?.()),messages};}
      finally{await page.close();}
      const workspace=await browser.newPage();workspace.setDefaultTimeout(20000);
      await configureAudio(workspace);
      try {
        await workspace.goto(origin+'/algorave/index.html');await workspace.waitForFunction(()=>window.algoravePreview);
        await workspace.getByLabel('Strudel music').fill(item.source);await workspace.locator('#play').click();
        await workspace.waitForFunction(()=>!document.getElementById('play').disabled);
        const state=await workspace.evaluate(()=>({playing:algoravePreview.playing,status:document.getElementById('status').textContent}));
        if(!state.playing)throw Error(state.status);
        await workspace.waitForFunction(()=>algoravePreview.signal.frequency?.some(x=>x>0));
        if(item.name==='onTrigger closure')await workspace.frames().find(f=>f!==workspace.mainFrame()).waitForFunction(()=>globalThis.probeHits>0,null,{polling:50});
        result.workspace={plays:true};
      }catch(error){result.workspace={plays:false,error:error.message};}
      finally{await workspace.close();}
      results.push(result);console.log(JSON.stringify(result));
    }
    const receipt={audioSink,reference:'@strudel/web 1.3.0 initStrudel, unmodified scheduler/output',build:fs.readFileSync(path.join(root,'dist/algorave/workspace.js'),'utf8').match(/Algorave [a-f0-9]{12}/)?.[0],results};
    fs.writeFileSync(path.join(root,'.algorave-preview/strudel-parity-probe.json'),JSON.stringify(receipt,null,2)+'\n');
    assert(results.every(x=>x.reference.plays),'Reference failures prevent a useful parity comparison');
    console.log(`${results.filter(x=>x.reference.plays&&!x.workspace.plays).length} demonstrated workspace gaps; this probe does not claim full parity.`);
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
