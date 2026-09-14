import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchSample,sampleURL,SampleByteStore,inspectSampleWav,SAMPLE_LIMITS as L} from '../src/algorave/sample-assets.mjs';
import {drumWav} from '../src/algorave/drum-samples.mjs';
const url='https://raw.githubusercontent.com/owner/sounds/main/kick.wav';
test('WAV preflight bounds resampled allocation and rejects forged/truncated/compressed layouts',()=>{
  const original=new Uint8Array(drumWav('bd'));
  const info=inspectSampleWav(original);
  assert.equal(info.channels,1);assert.equal(info.sampleRate,22050);
  assert.equal(info.frames,Math.ceil(.45*22050));assert.equal(info.decodedBytes,Math.ceil(info.frames*48000/22050)*4);
  assert.equal(inspectSampleWav(original,44100).decodedBytes,info.frames*2*4);
  assert.throws(()=>inspectSampleWav(original,1),/sample rate/);
  const wrapped=new Uint8Array(original.length+20);wrapped.set(original,10);
  assert.deepEqual(inspectSampleWav(wrapped.subarray(10,-10)),info);
  for(const change of [v=>v.setUint32(4,5,true),v=>v.setUint16(20,17,true),v=>v.setUint16(22,100,true),v=>v.setUint32(24,1,true),v=>v.setUint32(28,1,true),v=>v.setUint16(32,3,true),v=>v.setUint32(40,0xffffffff,true)]){
    const bytes=original.slice();change(new DataView(bytes.buffer));assert.throws(()=>inspectSampleWav(bytes));
  }
  assert.throws(()=>inspectSampleWav(original.subarray(0,-1)),/complete/);
  const long=new Uint8Array(44+8000*31*2);long.set(original.subarray(0,44));const v=new DataView(long.buffer);
  v.setUint32(4,long.length-8,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint32(40,long.length-44,true);
  assert.throws(()=>inspectSampleWav(long),/30-second/);
});
test('URL policy rejects private origins, credentials, redirects and ambiguous input before fetching',async()=>{
  assert.equal(sampleURL(url),url);
  for(const bad of [null,{},'http://raw.githubusercontent.com/a','https://localhost/a','https://127.0.0.1/a','https://[::1]/a','https://chiptunes.app/a','https://raw.githubusercontent.com.evil.test/a','https://raw.githubusercontent.com@evil.test/a','https://user:pass@raw.githubusercontent.com/a',url+'?token=hidden',url+'#frag','data:audio/wav;base64,AA==']){
    let calls=0;await assert.rejects(fetchSample(bad,{fetcher:()=>{calls++;}}));assert.equal(calls,0);
  }
});
test('CORS download omits credentials/referrer and preserves complete streamed bytes',async()=>{
  const expected=Uint8Array.from([1,2,3,4]);let calls=0;
  const result=await fetchSample(url,{fetcher:async(u,options)=>{
    calls++;assert.equal(u,url);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.mode,'cors');assert.equal(options.referrerPolicy,'no-referrer');
    return new Response(new ReadableStream({start(c){c.enqueue(expected.slice(0,2));c.enqueue(expected.slice(2));c.close();}}));
  }});
  assert.equal(calls,1);assert.deepEqual(result,{url,bytes:expected});
});
test('declared and streaming byte limits reject and cancel without retries',async()=>{
  for(const declared of [String(L.fileBytes+1),'invalid']){let cancelled=false;
    await assert.rejects(fetchSample(url,{fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':declared}})}),/limit/);
    assert(cancelled);
  }
  let cancelled=false;
  await assert.rejects(fetchSample(url,{fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(L.fileBytes));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}))}),/limit/);
  assert(cancelled);
  await assert.rejects(fetchSample(url,{fetcher:async()=>new Response(new Uint8Array())}),/empty/);
  await assert.rejects(fetchSample(url,{fetcher:async()=>new Response('no',{status:404})}),/failed/);
});
test('aborted, stalled headers and stalled body all finish by the external deadline',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(fetchSample(url,{signal:controller.signal,fetcher:()=>{calls++;}}),/cancelled/);assert.equal(calls,0);
  await assert.rejects(fetchSample(url,{timeoutMs:10,fetcher:()=>new Promise(()=>{})}),/timed out/);
  let cancelled=false;
  await assert.rejects(fetchSample(url,{timeoutMs:10,fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))}),/timed out/);
  assert(cancelled);
});
test('SHA-256 identity, detached bytes, deduplication and concurrent insertion',async()=>{
  const store=new SampleByteStore(),input=new TextEncoder().encode('abc');
  const [a,b]=await Promise.all([store.put(input),store.put(input)]);assert.deepEqual(a,b);
  assert.equal(a.id,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  input[0]=0;const copy=store.get(a.id);assert.equal(copy[0],97);copy[0]=0;assert.equal(store.get(a.id)[0],97);
  assert.equal(store.snapshot().count,1);assert.equal(store.snapshot().byteLength,3);
  const view=store.snapshot();view.assets[0].id='changed';assert.equal(store.snapshot().assets[0].id,a.id);
  assert.throws(()=>store.get('missing'),/missing/);
});
test('collection count and byte quotas leave existing content intact',async()=>{
  const count=new SampleByteStore();for(let i=0;i<L.count;i++)await count.put(Uint8Array.of(i));
  await assert.rejects(count.put(Uint8Array.of(100)),/full/);assert.equal(count.snapshot().count,L.count);
  const bytes=new SampleByteStore();for(let i=0;i<L.totalBytes/L.fileBytes;i++){const data=new Uint8Array(L.fileBytes);data[0]=i;await bytes.put(data);}
  const before=bytes.snapshot();await assert.rejects(bytes.put(Uint8Array.of(77)),/full/);assert.deepEqual(bytes.snapshot(),before);
  await assert.rejects(bytes.put(new Uint8Array(L.fileBytes+1)));await assert.rejects(bytes.put(new Uint8Array()));
});
