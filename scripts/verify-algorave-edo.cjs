'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview'),vendor=path.resolve(__dirname,'../src/algorave/vendor/edo');
const provenance=JSON.parse(fs.readFileSync(path.join(vendor,'UPSTREAM.json')));
for(const file of provenance.files){
  const bytes=fs.readFileSync(path.join(vendor,file.path));
  assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),file.gitBlob,file.path+' matches upstream');
}
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(20000);await configureAudio(page);
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.algoravePreview);
    const frame=page.frames().find(f=>f!==page.mainFrame());
    const scales=await frame.evaluate(()=>({
      twelve:n('0 1 7').gain(.2).edoScale(['A3','LLsLLLs',2,1]).queryArc(0,1).map(h=>({value:h.value,begin:Number(h.whole.begin),end:Number(h.whole.end),scale:h.context.scaleDefinition})),
      sixteen:n('0 1 2 3 4 5 6').edoScale(['A4','LLsLLL',3,1]).queryArc(0,1).map(h=>h.value),
      standalone:edoScale(['A4','LLsLLLs',2,1],n('7')).firstCycleValues,
      pure:mini('0 7').edoScale(['A4','LLsLLLs',2,1]).firstCycleValues,
    }));
    for(const [i,step]of [0,2,12].entries()){
      const {value,begin,end,scale}=scales.twelve[i];assert(Math.abs(value.freq-220*2**(step/12))<.001);
      assert.equal(value.edo,12);assert.equal(value.gain,.2);assert.equal(value.n,undefined);
      assert.equal(begin,i/3);assert.equal(end,(i+1)/3);assert.deepEqual(scale,['A3','LLsLLLs',2,1]);
    }
    for(const [i,step]of [0,3,6,7,10,13,16].entries()){
      assert(Math.abs(scales.sixteen[i].freq-440*2**(step/16))<.001);assert.equal(scales.sixteen[i].edo,16);
    }
    assert.equal(scales.standalone[0].freq,880);assert.deepEqual(scales.pure,[69,81]);
    const source='setcpm(120); n("0 2 4 6 4 2").edoScale("A3:LLsLLLs:2:1").s("triangle").gain(.2)';
    await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();
    await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    const good=await page.evaluate(()=>algoravePreview.session.applied);
    await page.getByLabel('Strudel music').fill('setcpm(120); n("0 1 2 3 4 5").edoScale("A3:LLsLLL:3:1").s("triangle").gain(.2)');
    await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Music updated');
    await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');
    assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),good);
    await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);
    await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    console.log('PASS: pinned upstream EDO source hashes, 12/16-EDO mathematical pitches, schedule/controls/context, standalone and method APIs, native colon notation, playback, Undo and stopped reload. No provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
