'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview');
const until=async fn=>{const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('MQTT fixture timed out');await new Promise(r=>setTimeout(r,25));}};
for(const name of ['mqtt','paho-mqtt']){
 const dir=path.resolve(__dirname,'../src/algorave/vendor',name),manifest=JSON.parse(fs.readFileSync(path.join(dir,'UPSTREAM.json')));
 for(const f of manifest.files){const file=path.join(dir,manifest.modified.includes(f.path)?'upstream':'',f.path);assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),f.sha256);}
}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await configureAudio(page);page.on("pageerror",e=>console.error("PAGE",e.message));
  const packets=[],publishes=[];let reject=false,hold=false,held,connections=0;
  await page.routeWebSocket('wss://mqtt.example.test/',socket=>{
   connections++;
   socket.onMessage(message=>{
    const b=Buffer.from(message),type=b[0]>>4;packets.push(type);
    if(type===1){if(hold)held=socket;else socket.send(Buffer.from([0x20,2,0,reject?5:0]));}
    if(type===12)socket.send(Buffer.from([0xd0,0]));
    if(type===3){let i=1;while(b[i++]&128){}const length=b.readUInt16BE(i);i+=2;publishes.push({topic:b.toString('utf8',i,i+length),payload:b.toString('utf8',i+length)});}
   });
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.algoravePreview);
  const source=`setcpm(120); note("c3 e3").mqtt(undefined,undefined,'fixture','wss://mqtt.example.test/','fixture')`;
  await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing).catch(async e=>{console.error(await page.locator("#status").innerText());throw e;});
  await until(()=>publishes.length>=3);assert.equal(connections,1);assert(publishes.every(m=>m.topic==='fixture'));
  const first=JSON.parse(publishes[0].payload);assert.equal(first.cps,2);assert.equal(first.duration,.25);assert(['c3','e3'].includes(first.note));
  const changed=source.replace('c3 e3','c4 e4');await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();await page.waitForFunction(s=>algoravePreview.session.applied.music===s,changed);await until(()=>publishes.some(m=>JSON.parse(m.payload).note==='c4'));
  await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');await page.locator('#menu summary').click();assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.evaluate(()=>{
   const hap=pure({note:'a3',topic:['nested','topic']}).mqtt(undefined,undefined,undefined,'wss://mqtt.example.test/','fixture',0,false).queryArc(0,1)[0];
   hap.context.onTrigger(hap,0,1,0);
   const scalar=pure('scalar').mqtt(undefined,undefined,'scalar','wss://mqtt.example.test/','fixture',0,false).queryArc(0,1)[0];
   scalar.context.onTrigger(scalar,0,1,0);
   const late=pure('late').mqtt(undefined,undefined,'late','wss://mqtt.example.test/','fixture',2,false).queryArc(0,1)[0];
   late.context.onTrigger(late,0,1,0);
  });
  await until(()=>publishes.some(m=>m.topic==='scalar'));assert.equal(publishes.find(m=>m.topic==='scalar').payload,'scalar');
  await until(()=>publishes.some(m=>m.topic==='/nested/topic'));assert.deepEqual(JSON.parse(publishes.find(m=>m.topic==='/nested/topic').payload),{note:'a3',topic:['nested','topic']});
  await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);await until(()=>packets.includes(14));const stopped=publishes.length;
  await page.waitForTimeout(2200);assert.equal(publishes.length,stopped);assert(!publishes.some(m=>m.topic==='late'));
  await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);assert.equal(connections,1);
  hold=true;await page.locator('#play').click();await until(()=>held);await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);held.send(Buffer.from([0x20,2,0,0]));await page.waitForTimeout(200);assert.equal(publishes.length,stopped);
  hold=false;reject=true;await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('MQTT connection failed'));await page.locator('#play').click();
  console.log('PASS: opaque-frame Paho MQTT wire encoding, payload/topic/metadata, Run/Undo, delayed-send cancellation, disconnect, stopped reload, late connection and visible broker rejection. Intercepted WSS fixture; no broker/device/credentials used.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
