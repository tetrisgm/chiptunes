import assert from 'node:assert/strict';
import { ProjectSession, STORAGE_KEY } from '../src/algorave/session.mjs';
import { AgentClient } from '../src/algorave/agent-client.mjs';
import contract from '../src/algorave/project.cjs';
const base={version:1,runtime:contract.RUNTIME,music:'s("bd*4")',visuals:{Image:'void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}'}};
const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
let active=contract.project(base),fail=false,disposed=0;
const runtime={async prepare(next){if(fail)throw Error('invalid music');return {apply:async()=>{active=structuredClone(next);},dispose:()=>disposed++};}};
const session=new ProjectSession(base,runtime,storage);
const context=await session.requestContext('Quieter drums');
const proposal={id:context.id,baseRevision:context.baseRevision,explanation:'Quieter',edits:[{document:'music',from:0,to:base.music.length,text:'s("bd*4").gain(.2)'}]};
await session.accept(proposal,context);assert.equal(session.draft.music,'s("bd*4").gain(.2)');assert.equal(active.music,session.draft.music);assert.equal(disposed,1);
await session.activate(session.applied);
assert.equal(disposed,2,'unchanged Play still activates the runtime');
assert.equal(session.history.length,1,'unchanged Play must not bury the proposal in Undo history');
await session.undo();assert.deepEqual(session.draft,contract.project(base));assert.deepEqual(active,session.draft);
// Manual Run must revert its editor and keep the other editor's unrun draft.
const visualDraft={...contract.project(base).visuals,Image:base.visuals.Image+' // unrun'};
session.edit({...base,music:'s("missing_sample")',visuals:visualDraft});
await session.activate({...base,music:session.draft.music},{draftAfter:session.draft,historyDraft:{...session.draft,music:base.music}});
await session.undo();assert.equal(session.draft.music,base.music);assert.equal(session.applied.music,base.music);assert.deepEqual(session.draft.visuals,visualDraft);
// Agent Undo retains manual drafts that existed before the proposal.
session.edit({...base,music:'s("hh")'});
const draftContext=await session.requestContext('Use snare');
await session.accept({id:draftContext.id,baseRevision:draftContext.baseRevision,explanation:'Snare',edits:[{document:'music',from:0,to:session.draft.music.length,text:'s("sd")'}]},draftContext);
await session.undo();assert.equal(session.draft.music,'s("hh")');assert.equal(session.applied.music,base.music);
session.edit(base);
// Runtime registrations need their own history: repeated Play must neither
// consume document Undo nor release the sound checkpoint that Undo needs.
let checkpointId=0,lastRestore,retained=[];
const checkpointSession=new ProjectSession(base,{
  retain(ids){retained=ids;},
  async prepare(_next,_previous,options){lastRestore=options;let checkpoint;return {async apply(){checkpoint=++checkpointId;},get checkpoint(){return checkpoint;},dispose(){}};},
});
await checkpointSession.activate({...base,music:'s("sd")'});
const savedCheckpoint=checkpointSession.checkpoint;
await checkpointSession.activate({...base,music:'s("hh")'});
for(let i=0;i<25;i++)await checkpointSession.activate(checkpointSession.applied);
assert.equal(checkpointSession.history.length,2);assert(retained.includes(savedCheckpoint));
await checkpointSession.undo();assert.deepEqual(lastRestore,{restore:true,checkpoint:savedCheckpoint});
assert.equal(checkpointSession.applied.music,'s("sd")');
session.edit({...session.draft,music:'unfinished('});session.save();
const restored=new ProjectSession(base,runtime,storage);assert.equal(restored.draft.music,'unfinished(');assert.equal(restored.applied.music,base.music);
const currentContext=await restored.requestContext('Repair');
fail=true;await assert.rejects(restored.accept({...proposal,id:currentContext.id,baseRevision:currentContext.baseRevision,edits:[{document:'music',from:0,to:11,text:'s("sd")'}]},currentContext));
assert.equal(restored.applied.music,base.music);assert.equal(restored.draft.music,'unfinished(');assert.equal(restored.history.length,0);fail=false;
await assert.rejects(session.accept(proposal,context),/source changed/);
values.set(STORAGE_KEY,'{"broken":true}');assert.throws(()=>session.save(),/another tab/);
const corrupted=new ProjectSession(base,runtime,storage);assert(corrupted.recoveryError);assert.throws(()=>corrupted.save(),/could not be opened/);assert.equal(values.get(STORAGE_KEY),'{"broken":true}');
corrupted.save({replaceUnreadable:true});assert.equal(JSON.parse(values.get(STORAGE_KEY)).version,1);
const client=new AgentClient(async()=>new Promise(()=>{}));
const waiting=client.request(context);client.cancel();await assert.rejects(waiting,/cancelled/);assert.equal(client.active,null);
const deferredClient=new AgentClient(async()=>new Response(new ReadableStream({start(){},cancel(){}}),{headers:{'content-type':'application/json'}}));
const stalled=deferredClient.request(context);setTimeout(()=>deferredClient.cancel(),20);await assert.rejects(stalled,/cancelled/);
const oversized=new AgentClient(async()=>new Response('x'.repeat(70000),{headers:{'content-type':'application/json'}}));await assert.rejects(oversized.request(context),/too large/);
console.log('PASS: proposal Apply/Undo, draft/applied recovery, failed candidate retention, stale rejection, cross-tab/corrupt-save preservation and bounded/cancelled agent transport.');
