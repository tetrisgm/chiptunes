'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {WebSocketServer}=require('ws'),{chromium}=require('playwright'),{configureAudio}=require('./algorave-browser-audio.cjs');
const root=path.resolve(__dirname,'../.algorave-preview'),source="setcpm(120); note('c3 e3 g3 b3').s('supersaw').gain(.2).oschost('127.0.0.1').oscport(57120).osc()";
const until=async predicate=>{const deadline=Date.now()+15000;while(!predicate()){if(Date.now()>deadline)throw Error('OSC receiver did not reach the expected state.');await new Promise(r=>setTimeout(r,25));}};
(async()=>{
  // Binding must succeed before a browser can run .osc(): never send test events
  // to an existing bridge or a physical synthesizer on the owner's port.
  const receiver=http.createServer(),messages=[],origins=[];let connections=0,browser,nativeServer;
  await new Promise((resolve,reject)=>{receiver.once('error',reject);receiver.listen(8080,'localhost',resolve);});
  const ws=new WebSocketServer({server:receiver});ws.on('connection',(socket,request)=>{connections++;origins.push(request.headers.origin);socket.on('message',data=>messages.push({received:Date.now(),...JSON.parse(data.toString())}));});
  try{
    if(process.argv.includes('--serve')){
      nativeServer=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.join(root,name==='/'?'index.html':name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
      await new Promise(resolve=>nativeServer.listen(0,'127.0.0.1',resolve));
      ws.on('connection',socket=>socket.on('message',data=>{const m=JSON.parse(data.toString()),args=Object.fromEntries(Array.from({length:m.args.length/2},(_,i)=>m.args.slice(i*2,i*2+2)));if(messages.length%4===0)console.log(JSON.stringify({events:messages.length,midinote:args.midinote,cps:args.cps,timestamp:m.timestamp}));}));
      console.log('Temporary native OSC receiver; no UDP forwarding. http://127.0.0.1:'+nativeServer.address().port);
      await new Promise(resolve=>process.once('SIGINT',resolve));return;
    }
    browser=await chromium.launch({headless:true});const page=await browser.newPage(),diagnostics=[];page.on('console',m=>{if(/WebSocket|OSC|connect-src|network|Mixed|error/i.test(m.text())&&diagnostics.length<12)diagnostics.push(m.text().slice(0,600));});page.setDefaultTimeout(20000);await configureAudio(page);await page.context().grantPermissions([],{origin:'https://osc.example.test'});
    // A secure page exercises the browser's loopback WebSocket policy as well as
    // the opaque music frame's CSP. No external app or synth is contacted.
    await page.route('https://osc.example.test/**',route=>{
      const name=new URL(route.request().url()).pathname,file=path.join(root,name==='/'?'index.html':name);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});
    });
    await page.goto('https://osc.example.test/');await page.waitForFunction(()=>window.algoravePreview);const frame=page.frames().find(f=>f!==page.mainFrame());
    const controls=await frame.evaluate(()=>{
      const hap=note('c3').s('saw').bank('test_').roomsize(.7).speed(2).unit('c').channels('1:2').queryArc(0,1)[0];
      return {origin:origin,secure:isSecureContext,exports:[typeof osc,typeof oscTrigger,typeof parseControlsFromHap],value:parseControlsFromHap(hap,2)};
    });assert.equal(controls.origin,'null');assert(controls.secure);assert.deepEqual(controls.exports,['function','function','function']);assert.equal(controls.value.midinote,48);assert.equal(controls.value.s,'test_saw');assert.equal(controls.value.size,.7);assert.equal(controls.value.speed,1);assert.equal(controls.value.delta,.5);assert.equal(controls.value.channels,'[1,2]');
    await page.getByLabel('Strudel music').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('local-network permission'));assert.equal(connections,0,'denied permission sends nothing');await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);await page.context().grantPermissions(['local-network-access'],{origin:'https://osc.example.test'});await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);try{await until(()=>messages.length>=5);}catch(error){console.error(JSON.stringify({status:await page.locator('#status').innerText(),connections,diagnostics,signal:await page.evaluate(()=>({time:algoravePreview.signal.time,playing:algoravePreview.playing}))}));throw error;}
    const decoded=m=>Object.fromEntries(Array.from({length:m.args.length/2},(_,i)=>m.args.slice(i*2,i*2+2)));
    for(const msg of messages){assert.equal(msg.address,'/dirt/play');assert.equal(msg.host,'127.0.0.1');assert.equal(msg.port,57120);assert(Number.isFinite(msg.timestamp)&&Math.abs(msg.timestamp-msg.received)<2000);const v=decoded(msg);assert.equal(v.cps,2);assert.equal(v.s,'supersaw');assert.equal(v.gain,.2);assert([48,52,55,59].includes(v.midinote));}
    assert(origins.every(v=>v==='null'));assert.equal(connections,1);
    const beforeReconnect=messages.length;for(const socket of ws.clients)socket.terminate();await until(()=>connections===2&&messages.length>beforeReconnect+2);
    const changed=source.replace("'c3 e3 g3 b3'","'c4 e4 g4 b4'");await page.getByLabel('Strudel music').fill(changed);await page.locator('#run').click();await page.waitForFunction(changed=>algoravePreview.session.applied.music===changed,changed);await until(()=>messages.some(m=>decoded(m).midinote===60));
    await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);const afterUndo=messages.length;await until(()=>messages.slice(afterUndo).some(m=>decoded(m).midinote===48));
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);await new Promise(r=>setTimeout(r,250));const stopped=messages.length;await new Promise(r=>setTimeout(r,600));assert.equal(messages.length,stopped,'Stop ceases wire events');
    await page.reload();await page.waitForFunction(()=>window.algoravePreview);assert.equal(await page.evaluate(()=>algoravePreview.playing),false);assert.equal(await page.evaluate(()=>algoravePreview.editors.music.value),source);await new Promise(r=>setTimeout(r,350));assert.equal(messages.length,stopped,'reload does not start OSC');
    await page.locator('#play').click();await until(()=>messages.length>stopped+2);
    // Shut down only the receiver created here; unavailable-bridge errors must
    // reach the UI rather than disappearing into an unhandled rejection.
    for(const socket of ws.clients)socket.terminate();await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>receiver.close(resolve));
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Could not connect to OSC server'));
    await page.locator('#play').click();await page.waitForFunction(()=>!algoravePreview.playing);
    console.log('PASS: upstream OSC exports/control conversion; actual secure-page opaque-frame loopback WebSocket payloads/timestamps, reconnect, Run/Undo wire changes, Stop, deferred reload, and visible unavailable-bridge errors. Temporary receiver only; no UDP/synth/provider calls.');
  }finally{
    await browser?.close();if(nativeServer){nativeServer.closeAllConnections();await new Promise(resolve=>nativeServer.close(resolve));}for(const socket of ws.clients)socket.terminate();if(receiver.listening){await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>receiver.close(resolve));}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
