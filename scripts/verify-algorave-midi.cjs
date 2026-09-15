'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview'),origin='https://midi.example.test';
async function open(browser,fixture=false){
  const page=await browser.newPage();page.setDefaultTimeout(20000);await configureAudio(page);
  if(fixture)await page.addInitScript(()=>{
    const messages=[];window.midiFixture={messages,requests:0};
    const port=type=>({id:type,name:'Test '+type,manufacturer:'Fixture',type,state:'connected',connection:'closed',async open(){this.connection='open';return this;},async close(){this.connection='closed';return this;},send(data,timestamp){messages.push({data:Array.from(data),timestamp,now:performance.now()});},clear(){}});
    const input=port('input'),output=port('output');window.midiFixture.input=input;
    Object.defineProperty(navigator,'requestMIDIAccess',{value:async options=>{window.midiFixture.requests++;window.midiFixture.options=options;return {inputs:new Map([['input',input]]),outputs:new Map([['output',output]]),sysexEnabled:true,onstatechange:null};}});
  });
  await page.route(origin+'/**',route=>{const name=new URL(route.request().url()).pathname,file=path.join(root,name==='/'?'index.html':name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404});return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});});
  await page.goto(origin);await page.waitForFunction(()=>window.algoravePreview);return {page,frame:page.frames().find(f=>f!==page.mainFrame())};
}
(async()=>{
 const upstream=fs.readFileSync(path.resolve(__dirname,'../node_modules/@strudel/midi/midi.mjs'),'utf8');
 assert.equal(fs.readFileSync(path.resolve(__dirname,'../src/algorave/vendor/midi/midi.mjs'),'utf8'),upstream.replace("'../superdough/helpers.mjs'","'superdough/helpers.mjs'"),'only the broken package import changes');
 const browser=await chromium.launch({headless:true});try{
  const native=await open(browser);await native.page.context().grantPermissions([],{origin});
  const denied=await native.frame.evaluate(async()=>({origin:origin,secure:isSecureContext,api:typeof navigator.requestMIDIAccess,allowed:document.featurePolicy.allowsFeature('midi'),result:await navigator.requestMIDIAccess({sysex:true}).then(()=> 'unexpected success',e=>e.name)}));
  assert.equal(denied.origin,'null');assert(denied.secure);assert.equal(denied.api,'function');assert(denied.allowed);assert.equal(denied.result,'NotAllowedError');
  await native.page.getByLabel('Strudel music').fill("note('c3').midi()");await native.page.locator('#play').click();await native.page.waitForFunction(()=>/permission|denied|allowed/i.test(document.getElementById('status').textContent));await native.page.close();
  const {page,frame}=await open(browser,true);
  assert.deepEqual(await frame.evaluate(()=>[typeof enableWebMidi,typeof midin,typeof midikeys,typeof note('c').midi]),['function','function','function','function']);
  assert.equal(await frame.evaluate(()=>midiFixture.requests),0,'no MIDI permission request on load');
  const source="setcpm(120); note('c3 e3 g3 b3').velocity(.8).gain(.5).midichan(2).ccn(74).ccv(.5).midi('Test output')";
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();try{await frame.waitForFunction(()=>midiFixture.messages.filter(m=>(m.data[0]&240)===144).length>=5,undefined,{polling:50});}catch(e){console.log(await page.locator('#status').innerText());console.log(JSON.stringify(await frame.evaluate(()=>({requests:midiFixture.requests,messages:midiFixture.messages.slice(0,8),enabled:WebMidi.enabled}))));throw e;}
  const messages=await frame.evaluate(()=>midiFixture.messages);const notes=messages.filter(m=>(m.data[0]&240)===144);assert(notes.every(m=>m.data[0]===145&&[48,52,55,59].includes(m.data[1])&&m.data[2]===51));assert(messages.some(m=>m.data[0]===177&&m.data[1]===74&&m.data[2]===64));assert(messages.some(m=>(m.data[0]&240)===128),'note-off scheduled');
  const inputs=await frame.evaluate(async()=>{const cc=await midin('Test input');const before=cc(7,2).queryArc(0,1)[0].value;midiFixture.input.onmidimessage({data:new Uint8Array([177,7,100]),receivedTime:performance.now(),timeStamp:performance.now()});return {before,after:cc(7,2).queryArc(0,1)[0].value,other:cc(7,1).queryArc(0,1)[0].value,all:cc(7).queryArc(0,1)[0].value};});assert.equal(inputs.before,0);assert.equal(inputs.after,100/127);assert.equal(inputs.all,100/127);assert.equal(inputs.other,0);
  const changed=source.replace('c3 e3 g3 b3','c4 e4 g4 b4');await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();await frame.waitForFunction(()=>midiFixture.messages.some(m=>m.data[0]===145&&m.data[1]===60),undefined,{polling:50});
  await page.locator('#menu summary').click();const count=await frame.evaluate(()=>midiFixture.messages.length);await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);await frame.waitForFunction(n=>midiFixture.messages.slice(n).some(m=>m.data[0]===145&&m.data[1]===48),count,{polling:50});
  const keyboard="const keys = await midikeys('Test input'); keys(.25).midichan(3).midi('Test output')";
  await page.getByLabel('Strudel music').fill(keyboard);await page.locator('#run').click();await page.waitForFunction(code=>algoravePreview.session.applied.music===code,keyboard);
  await frame.evaluate(()=>midiFixture.input.onmidimessage({data:new Uint8Array([144,65,80]),receivedTime:performance.now(),timeStamp:performance.now()}));
  await frame.waitForFunction(()=>midiFixture.messages.some(m=>m.data[0]===146&&m.data[1]===65),undefined,{polling:50});
  await page.getByLabel('Strudel music').fill(source);await page.locator('#run').click();await page.waitForFunction(code=>algoravePreview.session.applied.music===code,source);
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);await frame.waitForFunction(()=>midiFixture.messages.some(m=>m.data[0]===252),undefined,{polling:50});await page.waitForTimeout(250);const stopped=await frame.evaluate(()=>midiFixture.messages.length);await page.waitForTimeout(600);assert.equal(await frame.evaluate(()=>midiFixture.messages.length),stopped);
  await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);assert.equal(await page.frames().find(f=>f!==page.mainFrame()).evaluate(()=>midiFixture.requests),0);
  console.log('PASS: native secure opaque-frame MIDI policy/denial; upstream MIDI note/velocity/channel/CC/note-off, control/keyboard input, Run/Undo, Stop and deferred reload with simulated ports. No hardware messages.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
