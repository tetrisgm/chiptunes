import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {ImageByteStore,IMAGE_LIMITS} from '../src/algorave/image-assets.mjs';
import {SampleByteStore} from '../src/algorave/sample-assets.mjs';
import {exportProject,importProject,imageIds} from '../src/algorave/project-assets.mjs';
import {exportSampleProject} from '../src/algorave/sample-project.mjs';
import {drumWav} from '../src/algorave/drum-samples.mjs';
import {example} from '../src/algorave/examples.mjs';
import contract from '../src/algorave/project.cjs';
const png=new PNG({width:2,height:2});png.data.fill(255);const bytes=new Uint8Array(PNG.sync.write(png));
async function fixture(){
  const images=new ImageByteStore(),samples=new SampleByteStore(),{id}=await images.put(bytes),sample=await samples.put(new Uint8Array(drumWav('sd',16000)));
  const project=contract.project({...example(),samples:{clap:[sample.id]},visuals:{...example().visuals,channels:{Image:[{type:'texture',src:'asset:'+id,vflip:true,filter:'nearest'}]}}});
  return {images,samples,id,project};
}
test('images are immutable, deduplicated, isolated across forks and bounded',async()=>{
  const images=new ImageByteStore(),input=Buffer.from(bytes),{id}=await images.put(input);input[0]=0;
  images.get(id)[0]=0;assert.deepEqual(images.get(id),bytes);await images.put(bytes);assert.equal(images.snapshot().count,1);
  const fork=images.fork(),other=bytes.slice();other[other.length-1]^=1;await fork.put(other);assert.equal(images.snapshot().count,1);assert.equal(fork.snapshot().count,2);
  assert.equal(images.blob(id).type,'image/png');assert.throws(()=>images.get('absent'),/missing/);
  await assert.rejects(images.put(new Uint8Array(IMAGE_LIMITS.fileBytes+1)),/size/);await assert.rejects(images.put(new Uint8Array(20)),/Use a/);
  for(let i=0;i<31;i++){const altered=bytes.slice();altered[altered.length-1]=i;await images.put(altered);}
  assert.equal(images.snapshot().count,32);const overflow=bytes.slice();overflow[overflow.length-1]=99;await assert.rejects(images.put(overflow),/full/);
});
test('mixed image and WAV archive restores exact bytes and preserves old formats',async()=>{
  const f=await fixture(),archive=exportProject(f.project,f),restored=await importProject(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(restored.project,f.project);assert.deepEqual(restored.images.get(f.id),bytes);
  for(const {id} of f.samples.snapshot().assets)assert.deepEqual(restored.store.get(id),f.samples.get(id));
  assert.deepEqual(imageIds(restored.project),[f.id]);
  const old=contract.project({...example(),samples:f.project.samples});assert.deepEqual(exportProject(old,f),exportSampleProject(old,f.samples));
  assert.deepEqual((await importProject(exportProject(old,f))).project,old);assert.deepEqual(exportProject(example()),example());
});
test('missing, duplicate, damaged and malformed image archives fail before activation',async()=>{
  const f=await fixture(),good=exportProject(f.project,f);
  for(const change of [v=>v.images=[],v=>v.images.push(v.images[0]),v=>v.images[0].id='0'.repeat(64),v=>v.images[0].data='AAAA',v=>v.images[0].data+='!',v=>v.version=2,v=>v.extra=true,v=>v.samples=[]]){
    const bad=structuredClone(good);change(bad);await assert.rejects(importProject(bad));
  }
  const bad=structuredClone(good),altered=bytes.slice();altered[altered.length-1]^=1;bad.images[0].data=Buffer.from(altered).toString('base64');await assert.rejects(importProject(bad),/identity/);
});
test('agent sees image references only, and unrelated edits retain them',async()=>{
  const f=await fixture(),context=await contract.context({kind:'algorave',id:'image-test',request:'Change colors',target:'visuals',project:f.project,baseRevision:await contract.revision(f.project)});
  assert(JSON.stringify(context).includes('asset:'+f.id));assert(!JSON.stringify(context).includes(Buffer.from(bytes).toString('base64')));
  const candidate=contract.candidateFrom(f.project,{id:context.id,baseRevision:context.baseRevision,explanation:'color',edits:[{document:'Image',from:0,to:0,text:'// color\n'}]},context);
  assert.deepEqual(candidate.visuals.channels,f.project.visuals.channels);
  for(const src of ['asset:foo','asset:'+'A'.repeat(64),'asset:'+'a'.repeat(64)+'?x','data:image/png;base64,AA=='])assert.throws(()=>contract.channel({type:'texture',src},{}));
});
