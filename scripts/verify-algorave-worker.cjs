'use strict';
throw Error('Retired serialized-worker acceptance. Run npm run test:algorave-runtime; its upstream runtime cannot preempt infinite JavaScript loops.');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
  const worker=esbuild.buildSync({entryPoints:['src/algorave/pattern-worker.mjs'],bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
  const probe=esbuild.buildSync({stdin:{contents:`import {PatternClient} from './src/algorave/pattern-client.mjs'; window.patternProbe=()=>new PatternClient(${JSON.stringify(worker)});`,resolveDir:path.resolve(__dirname,'..')},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
  const server=http.createServer((req,res)=>{
    const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(15000);
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.algoravePreview);
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0)).catch(async error=>{
      console.error(await page.evaluate(()=>({playing:algoravePreview.playing,status:document.getElementById('status').textContent,signalTime:algoravePreview.signal.time})));throw error;
    });
    const good=await page.evaluate(()=>algoravePreview.session.applied.music);
    // Simulate a delayed audio-frame event loop, as observed during native
    // Safari interaction. The upstream clock catches up in one callback burst.
    const audioFrame=page.frames().find(f=>f!==page.mainFrame());
    const beforeDelay=await page.evaluate(()=>algoravePreview.signal.time);
    await audioFrame.evaluate(()=>{const until=performance.now()+2500;while(performance.now()<until){}});
    await page.waitForFunction(t=>algoravePreview.signal.time>t+2.5,beforeDelay);
    assert.equal(await page.evaluate(()=>algoravePreview.playing),true,'expired clock slices must not stop music');
    await page.waitForFunction(()=>algoravePreview.signal.frequency?.some(n=>n>0));
    for(const source of ['while(true) {} s("bd")','await new Promise(()=>{}); s("bd")','function recurse(){return recurse()} recurse();']){
      const before=await page.evaluate(()=>algoravePreview.signal.time);
      await page.getByLabel('Strudel music').fill(source);
      await page.getByRole('button',{name:'Run',exact:true}).click();
      // Main frame remains interactive while evaluation is pending.
      assert.equal(await page.evaluate(()=>document.getElementById('music')!==null),true);
      await page.waitForFunction(()=>!document.getElementById('run').disabled,{timeout:10000});
      assert.match(await page.locator('#status').textContent(),/timed out|call stack/i);
      assert.equal(await page.evaluate(()=>algoravePreview.session.applied.music),good);
      assert.equal(await page.evaluate(()=>algoravePreview.playing),true);
      await page.waitForFunction(t=>algoravePreview.signal.time>t+.1,before);
      assert(await page.evaluate(()=>algoravePreview.signal.frequency.some(n=>n>0)));
    }
    // Query ordinary upstream patterns in the same opaque frame, with known
    // independent onset/duration expectations (including sustained notes).
    const frame=page.frames().find(f=>f!==page.mainFrame());
    const policy=await frame.evaluate(()=>document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    assert.match(policy,/(?:^|;)\s*connect-src blob:\s*(?:;|$)/);
    assert.match(policy,/(?:^|;)\s*worker-src blob:\s*(?:;|$)/);
    await frame.addScriptTag({content:probe});
    const events=await frame.evaluate(async()=>{
      const client=patternProbe();
      try{await client.prepare('setcpm(120); note("c3 e3").s("triangle").legato(2)',.5,0);
        return {cps:client.cps,whole:await client.query(0,1,client.cps),sustain:await client.query(.1,.4,client.cps)};
      }finally{client.dispose();}
    });
    assert.equal(events.cps,2);assert.deepEqual(events.whole.map(e=>[e.begin,e.end,e.duration]),[[0,.5,1],[.5,1,1]]);assert.deepEqual(events.sustain,[]);
    assert.deepEqual(events.whole.map(e=>e.value.note),['c3','e3']);
    const isolation=await frame.evaluate(async()=>{
      const client=patternProbe();try{
        await client.prepare(`if(typeof window!=='undefined' || typeof document!=='undefined' || typeof localStorage!=='undefined') throw Error('private state exposed');
          try { indexedDB.open('ct-algorave-samples-v1'); throw Error('private database exposed'); } catch(e) { if(e.name!=='SecurityError')throw e; }
          s("bd")`,.5,0);
        return (await client.query(0,1,.5)).length;
      }finally{client.dispose();}
    });assert.equal(isolation,1);
    // A lazy loop after preflight must stop safely and accept a repaired Run.
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByLabel('Strudel music').fill('setcpm(120); new Pattern(state => { if(Number(state.span.begin)>2.2) { while(true){} } return s("bd*4").query(state); })');
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>algoravePreview.playing);
    await page.waitForFunction(()=>!algoravePreview.playing&&document.getElementById('status').textContent.includes('query timed out'),null,{timeout:10000}).catch(async error=>{console.error(await page.evaluate(()=>({playing:algoravePreview.playing,status:document.getElementById('status').textContent,signal:algoravePreview.signal.cycle})));throw error;});
    assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1);
    await page.getByLabel('Strudel music').fill(good);
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    console.log('PASS: native worker event timing/durations, onset filtering, private-state isolation, infinite/async/recursive candidate recovery with continuous prior audio, lazy-loop stop and repaired playback.');
  }catch(error){console.error('worker check failed:',error);throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
