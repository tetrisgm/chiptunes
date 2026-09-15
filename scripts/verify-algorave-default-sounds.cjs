'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {configureAudio,audioSink}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),results=[];
  try{
    const page=await browser.newPage();page.setDefaultTimeout(30000);await configureAudio(page);
    const fetched=[];page.on('response',response=>{
      if(response.url().startsWith('https://strudel.b-cdn.net/')||response.url().startsWith('https://felixroos.github.io/webaudiofontdata/'))fetched.push({url:response.url(),status:response.status()});
    });
    await page.goto(origin);await page.waitForFunction(()=>window.algoravePreview);
    const frame=page.frames().find(f=>f!==page.mainFrame());
    const inventory=await frame.evaluate(()=>{
      const map=soundMap.get();return {names:Object.keys(map),alias:map.tr909_bd===map.rolandtr909_bd,
        piano:note('c4').piano().queryArc(0,1).map(h=>h.value),
        tuning:mini('0 1 19').xen('19edo').queryArc(0,1).map(h=>h.value),
        api:['registerSoundfonts','setSoundfontUrl','loadSoundfont','startPresetNote'].map(name=>[name,typeof globalThis[name]])};
    });
    for(const name of ['bd','oh','tr909_bd','piano','bongo','wt_digital','mridangam_ka','casio','num','z_sine','gm_flute'])assert(inventory.names.includes(name),name+' registered');
    assert(inventory.alias,'drum-machine alias points to the original sampler');
    for(const [name,type]of inventory.api)assert.equal(type,'function',name);
    const piano=inventory.piano[0];assert.equal(piano.clip,1);assert.equal(piano.release,.1);assert.equal(piano.s,'piano');assert(Math.abs(piano.pan-(60/108*.5+.25))<1e-12);
    assert.equal(inventory.tuning[0],220);assert(Math.abs(inventory.tuning[1]-220*2**(1/19))<1e-10);assert.equal(inventory.tuning[2],440);
    const programs=[
      ['default drum bank','s("bd hh oh sd").gain(.3)'],
      ['drum-machine bank','s("bd*4").bank("tr909").gain(.3)'],
      ['piano helper','note("c4*4").piano().gain(.3)'],
      ['VCSL','s("bongo*4").gain(.3)'],
      ['wavetables','note("c3*4").s("wt_digital").gain(.3)'],
      ['mridangam','s("mridangam_ka*4").gain(.3)'],
      ['Dirt subset','s("casio*4").gain(.3)'],
      ['ZZFX','note("c3*4").s("z_sine").gain(.3)'],
      ['GM soundfont','note("c4*4").s("gm_flute").gain(.3)'],
      ['microtonal tuning','freq("0 5 10 19".xen("19edo")).s("sine").gain(.3)'],
    ];
    for(const [name,source]of programs){
      await page.getByLabel('Strudel music').fill('setcpm(120); '+source);await page.locator('#play').click();
      await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
      results.push({name,plays:true});console.log('PASS live sound: '+name);
      await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
      // A new program must create a new signal; no held spectrum from its predecessor.
      await page.reload();await page.waitForFunction(()=>window.algoravePreview);
    }
    assert(fetched.some(item=>item.url.includes('/piano/')&&item.status===200));
    assert(fetched.some(item=>item.url.includes('/webaudiofontdata/')&&item.status===200));
    await page.close();
    // Catalog outage is a separate, explicit fixture. Startup and local synth
    // playback must remain usable; it is not counted as live bank acceptance.
    const offline=await browser.newPage();await configureAudio(offline);
    await offline.route('https://strudel.b-cdn.net/**',route=>route.abort());
    await offline.goto(origin);await offline.waitForFunction(()=>window.algoravePreview);
    await offline.waitForFunction(()=>document.getElementById('status').textContent.includes('Could not load sound libraries'));
    await offline.getByLabel('Strudel music').fill('note("c3*4").s("triangle")');await offline.locator('#play').click();
    await offline.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    await offline.close();
    fs.writeFileSync(path.join(root,'default-sounds-receipt.json'),JSON.stringify({audioSink,build:fs.readFileSync(path.join(root,'workspace.js'),'utf8').match(/Algorave [a-f0-9]{12}/)?.[0],results,fetched},null,2)+'\n');
    console.log('PASS: default REPL banks, aliases, piano attributes, soundfont APIs, actual CDN/sample/font decoding, and separate catalog-outage recovery.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
