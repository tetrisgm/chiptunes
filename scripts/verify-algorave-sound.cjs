'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http'),esbuild=require('esbuild');
const {chromium}=require('playwright');
const bundle=esbuild.buildSync({stdin:{resolveDir:path.resolve(__dirname,'..'),contents:"import {renderShaderSound} from './src/algorave/shader-sound.mjs';window.renderSound=renderShaderSound;"},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<script>'+bundle+'</script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async()=>{
   let progress=[];
   const buffer=await renderSound('vec2 mainSound(int samp,float time){return vec2(sin(TAU*440.*time)*.5,float(samp%1000)/500.-1.);}',{common:'const float TAU=6.28318530718;',sampleRate:48000,duration:3,onProgress:p=>progress.push(p)});
   let leftError=0,rightError=0;const left=buffer.getChannelData(0),right=buffer.getChannelData(1);
   for(let i=0;i<buffer.length;i++){leftError=Math.max(leftError,Math.abs(left[i]-.5*Math.sin(2*Math.PI*440*i/48000)));rightError=Math.max(rightError,Math.abs(right[i]-(i%1000/500-1)));}
   const clipped=await renderSound('vec2 mainSound(int samp,float time){return vec2(-2.,2.);}',{duration:.01});
   let cancelled=false,bad=false;const controller=new AbortController();
   try{await renderSound('vec2 mainSound(int samp,float time){return vec2(time);}',{signal:controller.signal,onProgress:()=>controller.abort()});}catch(e){cancelled=e.message.includes('cancelled');}
   try{await renderSound('broken GLSL');}catch(e){bad=e.message.includes('Sound:');}
   const recovered=await renderSound('vec2 mainSound(int samp,float time){return vec2(0.);}',{duration:.01});
   return {length:buffer.length,rate:buffer.sampleRate,channels:buffer.numberOfChannels,leftError,rightError,progress,clip:[clipped.getChannelData(0)[0],clipped.getChannelData(1)[0]],cancelled,bad,recovered:recovered.length};
  });
  assert.equal(result.length,144000);assert.equal(result.rate,48000);assert.equal(result.channels,2);
  assert(result.leftError<.001,JSON.stringify(result));assert(result.rightError<.00004,JSON.stringify(result));
  assert.deepEqual(result.clip,[-1,1]);assert.equal(result.progress.length,3);assert.equal(result.progress.at(-1),1);
  assert(result.cancelled&&result.bad);assert.equal(result.recovered,441);
  console.log('PASS: GLSL Sound stereo PCM, sample/time continuity across GPU blocks, Common, 48 kHz, clipping, cancellation, compile errors and recovery. No playback assertion.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
