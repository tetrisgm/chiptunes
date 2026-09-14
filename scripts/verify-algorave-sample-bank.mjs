import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SampleBank} from '../src/algorave/sample-bank.mjs';
import {SampleByteStore,inspectSampleWav} from '../src/algorave/sample-assets.mjs';
import {drumWav} from '../src/algorave/drum-samples.mjs';
async function fixture(options={}){
  const bytes=new SampleByteStore(),ids={};for(const name of ['bd','sd','hh'])ids[name]=(await bytes.put(new Uint8Array(drumWav(name)))).id;
  const urls=new Map(),registered=[],revoked=[];let loads=0;
  const bank=new SampleBank({sampleRate:48000,createURL(data){const url='blob:fixture/'+urls.size;urls.set(url,data);return url;},revokeURL(url){revoked.push(url);},
    async loadBuffer(url){loads++;const i=inspectSampleWav(urls.get(url));return {sampleRate:48000,numberOfChannels:i.channels,length:i.decodedBytes/i.channels/4};},
    async registerSamples(map){registered.push(structuredClone(map));},...options});
  return {bank,ids,registered,revoked,resolve:id=>bytes.get(id),get loads(){return loads;}};
}
test('preparing changed logical names leaves the old bank mapping and sample indices intact',async()=>{
  const f=await fixture();const old=await f.bank.prepare({bd:[f.ids.bd,f.ids.sd]},f.resolve);
  const before=old.resolve({s:'bd',n:1,gain:.4});
  const next=await f.bank.prepare({bd:[f.ids.hh]},f.resolve);
  assert.deepEqual(old.resolve({s:'bd',n:1,gain:.4}),before);
  assert.notEqual(next.mapping.bd,old.mapping.bd);assert.equal(before.n,1);assert.equal(before.gain,.4);
  assert(f.registered.every(map=>Object.keys(map)[0].startsWith('ctasset_')));
  const event={s:'triangle',note:'c3'};assert.deepEqual(next.resolve(event),event);assert.notEqual(next.resolve(event),event);
  const named=await f.bank.prepare({kit_bd:[f.ids.bd]},f.resolve);
  assert.deepEqual(named.resolve({bank:'KIT',s:'BD',n:0}),{s:named.mapping.kit_bd,n:0});
});
test('concurrent preparation deduplicates content, URLs and immutable aliases',async()=>{
  const f=await fixture();const [a,b]=await Promise.all([f.bank.prepare({one:[f.ids.bd]},f.resolve),f.bank.prepare({two:[f.ids.bd]},f.resolve)]);
  assert.equal(a.mapping.one,b.mapping.two);assert.equal(f.loads,1);assert.equal(f.registered.length,1);
  assert.equal(f.bank.snapshot().assets,1);assert.equal(f.bank.snapshot().banks,1);
  assert.throws(()=>{a.mapping.one='mutated';});
  const map={three:[f.ids.sd]},pending=f.bank.prepare(map,f.resolve);map.three[0]=f.ids.hh;
  const prepared=await pending,expected=await f.bank.prepare({four:[f.ids.sd]},f.resolve);
  assert.equal(prepared.mapping.three,expected.mapping.four,'caller mutation cannot change a pending bank');
});
test('memory/count quotas and hash mismatch retain previously prepared banks',async()=>{
  const f=await fixture({assetLimit:1});const a=await f.bank.prepare({bd:[f.ids.bd]},f.resolve);
  await assert.rejects(f.bank.prepare({hh:[f.ids.hh]},f.resolve),/memory is full/);
  assert.equal(a.resolve({s:'bd'}).s,a.mapping.bd);assert.equal(f.loads,1);
  const tiny=await fixture({decodedLimit:1});await assert.rejects(tiny.bank.prepare({bd:[tiny.ids.bd]},tiny.resolve),/memory is full/);assert.equal(tiny.loads,0);
  const bad=await fixture();await assert.rejects(bad.bank.prepare({bd:[bad.ids.bd]},()=>bad.resolve(bad.ids.hh)),/identity/);assert.equal(bad.loads,0);
});
test('failed decoder/registration attempts consume bounded reservations and never silently retry',async()=>{
  let calls=0;const f=await fixture({bankLimit:1,async loadBuffer(){calls++;throw Error('decode failed');}});
  await assert.rejects(f.bank.prepare({bd:[f.ids.bd]},f.resolve),/decode failed/);
  const before=f.bank.snapshot();assert(before.decodedBytes>0);
  await assert.rejects(f.bank.prepare({bd:[f.ids.bd]},f.resolve),/decode failed/);assert.equal(calls,1);assert.deepEqual(f.bank.snapshot(),before);
  await assert.rejects(f.bank.prepare({sd:[f.ids.sd]},f.resolve),/variations/);assert.equal(calls,1);
  f.bank.close();f.bank.close();assert.equal(f.revoked.length,1);await assert.rejects(f.bank.prepare({},f.resolve),/closed/);
  let registrations=0;const g=await fixture({async registerSamples(){registrations++;throw Error('registration failed');}});
  await assert.rejects(g.bank.prepare({bd:[g.ids.bd]},g.resolve),/registration failed/);
  await assert.rejects(g.bank.prepare({bd:[g.ids.bd]},g.resolve),/registration failed/);
  assert.equal(registrations,1);assert.equal(g.loads,1);
});
test('closing during decode revokes URLs and prevents late registration',async()=>{
  let release,started;const ready=new Promise(resolve=>started=resolve);
  const f=await fixture({loadBuffer(){started();return new Promise(resolve=>release=resolve);}});
  const pending=f.bank.prepare({bd:[f.ids.bd]},f.resolve);await ready;f.bank.close();
  release({sampleRate:48000,numberOfChannels:1,length:1});
  await assert.rejects(pending,/closed/);assert.equal(f.registered.length,0);assert.equal(f.revoked.length,1);
});
test('malformed maps and unexpected decode dimensions fail before registration',async()=>{
  const f=await fixture({async loadBuffer(){return {sampleRate:48000,numberOfChannels:200,length:1000000};}});
  for(const map of [[],{constructor:[f.ids.bd]},{bad:[]},{bd:['bad-id']},{UPPER:[f.ids.bd]}])await assert.rejects(f.bank.prepare(map,f.resolve));
  assert.equal(f.bank.snapshot().assets,0);
  await assert.rejects(f.bank.prepare({bd:[f.ids.bd]},f.resolve),/layout/);assert.equal(f.registered.length,0);
});
