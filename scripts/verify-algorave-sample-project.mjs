import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SampleByteStore} from '../src/algorave/sample-assets.mjs';
import {exportSampleProject,importSampleProject} from '../src/algorave/sample-project.mjs';
import {drumWav} from '../src/algorave/drum-samples.mjs';
import {example} from '../src/algorave/examples.mjs';
import contract from '../src/algorave/project.cjs';
async function fixture(){const store=new SampleByteStore(),bytes=new Uint8Array(drumWav('sd',16000)),{id}=await store.put(bytes);return {store,bytes,id,project:contract.project({...example(),samples:{clap:[id]}})};}
test('portable archive restores exact project and sample bytes; old project shape remains unchanged',async()=>{
  const f=await fixture(),archive=exportSampleProject(f.project,f.store),restored=await importSampleProject(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(restored.project,f.project);assert.deepEqual(restored.store.get(f.id),f.bytes);
  assert.deepEqual(exportSampleProject(example(),null),example());assert.deepEqual(await importSampleProject(example()),{project:example(),store:null});
});
test('agent context carries sample identity without binary data and preserves it across edits',async()=>{
  const f=await fixture(),context=await contract.context({kind:'algorave',id:'sample-test',request:'Change visual colors',target:'visuals',project:f.project,baseRevision:await contract.revision(f.project)});
  const serialized=JSON.stringify(context);assert(serialized.includes(f.id));assert(!serialized.includes(exportSampleProject(f.project,f.store).assets[0].data));
  const candidate=contract.candidateFrom(f.project,{id:context.id,baseRevision:context.baseRevision,explanation:'color',edits:[{document:'Image',from:0,to:0,text:'// color\n'}]},context);
  assert.deepEqual(candidate.samples,f.project.samples);assert.equal(candidate.music,f.project.music);
  assert.throws(()=>contract.project({...example(),samples:{bad:['missing']}}));
  assert.throws(()=>contract.project({...example(),samples:{constructor:[f.id]}}));
});
test('missing, duplicate, damaged and mislabeled sample content never opens',async()=>{
  const f=await fixture(),good=exportSampleProject(f.project,f.store);
  for(const change of [v=>v.assets=[],v=>v.assets.push(v.assets[0]),v=>v.assets[0].id='0'.repeat(64),v=>v.assets[0].data='AAAA',v=>v.assets[0].data+='!',v=>v.version=2]){
    const bad=structuredClone(good);change(bad);await assert.rejects(importSampleProject(bad));
  }
  const bad=structuredClone(good);const bytes=f.bytes.slice();bytes[bytes.length-1]^=1;let text='';for(const b of bytes)text+=String.fromCharCode(b);bad.assets[0].data=btoa(text);
  await assert.rejects(importSampleProject(bad),/identity/);
});
