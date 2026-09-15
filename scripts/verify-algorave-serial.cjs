'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),esbuild=require('esbuild');
const {chromium}=require('playwright');
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:"import {pure} from '@strudel/core';import {getWriter} from './src/algorave/vendor/serial/serial.mjs';window.pure=pure;window.getWriter=getWriter;"},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<script>'+bundle+'</script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async()=>{
   let requests=0,opens=[],writes=[],closed=0,denied=true,release;
   const fixturePort={open:async options=>opens.push(options),close:async()=>closed++,writable:{getWriter:()=>({write:bytes=>{writes.push([...bytes]);return Promise.resolve();}})}};
   Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>{requests++;if(denied)throw Error('fixture denied');return fixturePort;}}});
   let rejected=false;try{await getWriter('fixture',9600);}catch(e){rejected=e.message==='fixture denied';}denied=false;
   const writer=await getWriter('fixture',9600),cached=await getWriter('fixture',9600);
   const trigger=(value,delay=0,crc=false,short=false)=>{const hap=pure(value).serial(9600,crc,short,'fixture').queryArc(0,1)[0];hap.context.onTrigger(hap,0,1,delay);};
   trigger({action:'go',speed:3});await new Promise(r=>setTimeout(r,150));const message=new TextDecoder().decode(new Uint8Array(writes[0]));
   trigger('cancelled',.2);window.dispatchEvent(new MessageEvent('message',{source:window,data:'strudel-stop'}));await new Promise(r=>setTimeout(r,350));const afterStop=writes.length;
   trigger('resumed');await new Promise(r=>setTimeout(r,150));
   navigator.serial.requestPort=()=>new Promise(resolve=>release=resolve);
   const pending=getWriter('late',115200);window.dispatchEvent(new MessageEvent('message',{source:window,data:'strudel-stop'}));release({open:async()=>{},close:async()=>closed++,writable:{getWriter:()=>{throw Error('late writer must not be acquired');}}});await pending;
   return {rejected,cached:writer===cached,requests,opens,message,afterStop,writes:writes.map(b=>new TextDecoder().decode(new Uint8Array(b))),closed};
  });
  assert(result.rejected&&result.cached);assert.equal(result.requests,2);assert.deepEqual(result.opens,[{baudRate:9600}]);assert.equal(result.message,'go(speed:3)');assert.equal(result.afterStop,1);assert.deepEqual(result.writes,['go(speed:3)','resumed']);assert.equal(result.closed,1);
  console.log('PASS: serial fixture denial/retry, writer cache, baud rate, upstream message formatting, Stop cancellation, resumed output and late-port close. No hardware or real port permission accessed.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
