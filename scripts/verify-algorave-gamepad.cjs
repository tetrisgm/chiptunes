'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview'),vendor=path.resolve(__dirname,'../src/algorave/vendor/gamepad');
for(const file of JSON.parse(fs.readFileSync(path.join(vendor,'UPSTREAM.json'))).files){
  const bytes=fs.readFileSync(path.join(vendor,file.path));assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),file.gitBlob);
}
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await configureAudio(page);page.setDefaultTimeout(20000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.algoravePreview);
    const frame=page.frames().find(f=>f!==page.mainFrame());
    const native=await frame.evaluate(()=>({allowed:(document.permissionsPolicy||document.featurePolicy)?.allowsFeature('gamepad'),count:navigator.getGamepads().length,origin:origin}));
    assert.equal(native.allowed,true,'real opaque frame permits the browser gamepad API');assert.equal(native.origin,'null');
    // Simulated controllers are installed only after the native policy/API check.
    const result=await frame.evaluate(()=>{
      const device=(index,axes)=>({index,axes,buttons:Array.from({length:16},()=>({value:0}))});
      window.testPads=[device(0,[-1,0,1,.5]),device(1,[1,1,-1,-1])];
      Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>testPads});
      const value=p=>p.queryArc(0,1)[0].value,pad=gamepad(0),second=gamepad(1);
      const axes=[pad.x1,pad.y1,pad.x2,pad.y2,pad.x1_2,pad.y1_2,pad.x2_2,pad.y2_2].map(value);
      const other=[second.x1,second.y1,second.x2,second.y2].map(value);
      const toggle=[value(pad.tglA)];testPads[0].buttons[0].value=1;toggle.push(value(pad.tglA),value(pad.tglA));
      testPads[0].buttons[0].value=0;toggle.push(value(pad.tglA));testPads[0].buttons[0].value=1;toggle.push(value(pad.tglA));
      testPads[0].buttons[0].value=.4;const analog=[value(pad.a),value(pad.A),value(pad.buttons[0].value)];
      const sequence=[];for(const button of [13,15,0]){testPads[0].buttons.forEach(b=>b.value=0);value(pad.raw);testPads[0].buttons[button].value=1;sequence.push(value(pad.checkSequence(['down','right','a'])));}
      const aliases=[value(pad.btnSeq('dra')),value(pad.btnseq('dra')),value(pad.btnSequence('dra'))];
      const pattern=note('c3*4').pan(pad.x1).gain(pad.a).queryArc(0,1).map(h=>({value:h.value,begin:Number(h.whole.begin)}));
      const states=getGamepadStates();clearGamepadStates();const cleared=getGamepadStates();
      return {axes,other,toggle,analog,sequence,aliases,pattern,states,cleared};
    });
    assert.deepEqual(result.axes,[0,.5,1,.75,-1,0,1,.5]);assert.deepEqual(result.other,[1,1,0,0]);
    assert.deepEqual(result.toggle,[0,1,1,1,0]);assert.deepEqual(result.analog,[.4,.4,.4]);assert.deepEqual(result.sequence,[0,0,1]);assert.deepEqual(result.aliases,[1,1,1]);
    assert.equal(Object.keys(result.states).length,32);assert.deepEqual(result.cleared,{});
    assert.deepEqual(result.pattern.map(h=>h.begin),[0,.25,.5,.75]);for(const h of result.pattern){assert.equal(h.value.pan,0);assert.equal(h.value.gain,1);}
    const source="const pad = gamepad(0); setcpm(120); note('c3*4').s('triangle').gain(pad.x1.range(.05,.2))";
    await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    await page.getByLabel('Strudel music').fill("note('c4*4').s('sine').gain(.1)");await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Music updated');
    await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);
    await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);
    assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);
    await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing&&algoravePreview.signal.frequency?.some(n=>n>0));
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    console.log('PASS: pinned gamepad source, native sandbox policy/API access, simulated independent axes/buttons/toggles/sequences, musical control/schedule, source Run/Undo and stopped reload. No physical-controller or acoustic assertion; no provider calls.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
