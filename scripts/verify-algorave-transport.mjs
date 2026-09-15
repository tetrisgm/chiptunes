import assert from 'node:assert/strict';
import {PatternTransport} from '../src/algorave/pattern-transport.mjs';
let now=10, tick;const errors=[],outputs=[],queries=[];
const transport=new PatternTransport({getTime:()=>now,output:(...args)=>outputs.push(args),onError:e=>errors.push(e),clockFactory:(_time,callback)=>{tick=callback;return {start(){},stop(){}};}});
const client=(cps=2)=>({cps,closed:false,async query(begin,end,speed){queries.push([begin,end,speed]);return [{begin,end:begin+1,duration:1,value:{s:'triangle'}}];},dispose(){this.closed=true;}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const first=client();transport.set(first,true);
tick(10,.05);await flush();
assert.deepEqual(queries[0],[0,.1,2]);assert.equal(outputs[0][1],10.1);assert.equal(outputs[0][2],.5);
assert.deepEqual(transport.position(10.1),{cycle:0,cps:2});
for(let i=1;i<1000;i++){tick(10+i*.05,.05);await flush();}
assert.equal(queries.at(-1)[1],100,'cycle windows use tick multiplication, not cumulative float addition');
// Same-tempo live swap continues at the next unplayed cycle.
const second=client();transport.set(second,true);tick(60,.05);await flush();
assert.equal(queries.at(-1)[0],100);assert(first.closed);
const third=client(1);transport.set(third,true);tick(60.05,.05);await flush();
assert(Math.abs(queries.at(-1)[0]-100.1)<1e-12);assert(Math.abs(queries.at(-1)[1]-100.15)<1e-12);assert.equal(queries.at(-1)[2],1);assert.equal(outputs.at(-1)[2],1);
// Missed windows advance, so playback never replays delayed beats.
now=61;const count=queries.length;tick(60.1,.05);await flush();assert.equal(queries.length,count);
tick(61,.05);await flush();assert(Math.abs(queries.at(-1)[0]-100.2)<1e-12);
// An old pending failure cannot stop a new generation after Stop/Run.
let rejectOld;const old=client();old.query=()=>new Promise((_,reject)=>rejectOld=reject);
transport.set(old,true);tick(61.05,.05);await flush();transport.stop();
const repaired=client();transport.set(repaired,true);tick(61.1,.05);rejectOld(Error('old failure'));await flush();
assert.equal(transport.playing,true);assert.equal(errors.length,0);assert.equal(queries.at(-1)[0],0);
// Current failures stop exactly once; another run recovers.
const bad=client();bad.query=async()=>{throw Error('current failure');};
transport.set(bad,true);tick(61.15,.05);await flush();assert.equal(transport.playing,false);assert.equal(errors.length,1);
transport.set(client(),true);tick(61.2,.05);await flush();assert.equal(transport.playing,true);
// Catch-up overflow must defer stop until after the native callback returns.
let insideClock=false,burstTick,overflowErrors=0;
const overflow=new PatternTransport({getTime:()=>0,output(){},onError(){overflowErrors++;},clockFactory:(_time,callback)=>{
  burstTick=callback;return {start(){},stop(){assert.equal(insideClock,false,'never stop/reset clock inside callback');}};
}});
overflow.set(client(),true);insideClock=true;
for(let i=0;i<40;i++)burstTick(i*.05,.05);
insideClock=false;await flush();assert.equal(overflowErrors,1);assert.equal(overflow.playing,false);overflow.dispose();
// A realistic delayed-clock burst consists of expired contiguous slices, not
// 40 future slices. Skip them with exactly the upstream musical-time advance.
let delayedTick,delayedNow=10;const delayedQueries=[],delayedOutputs=[],delayedErrors=[];
const delayed=new PatternTransport({getTime:()=>delayedNow,output:(event,time)=>delayedOutputs.push(time),onError:e=>delayedErrors.push(e),clockFactory:(_time,callback)=>{delayedTick=callback;return {start(){},stop(){}};}});
const delayedClient=client(2);delayedClient.query=async(begin,end)=>{delayedQueries.push([begin,end]);return [{begin,end,duration:end-begin,value:{s:'triangle'}}];};
delayed.set(delayedClient,true);delayedTick(10,.05);await flush();
delayedNow=60;
for(let i=1;i<=1000;i++)delayedTick(10+i*.05,.05);
assert(delayed.queue.length<8,'missed callbacks are bounded before the async drain');
await flush();assert.equal(delayed.playing,true);assert.deepEqual(delayedErrors,[]);
assert.equal(delayedQueries.at(-1)[0],100);
assert(Math.abs(delayedQueries.at(-1)[1]-100.1)<1e-12);
assert.equal(delayedOutputs.at(-1),60.1);
assert(delayedOutputs.slice(1).every(time=>time>=60),'expired notes must never burst on recovery');
delayed.dispose();
transport.dispose();
console.log('PASS: scheduled note deadlines/durations, 1000-window drift, phase-preserving swaps, tempo changes, missed windows and stale/current query failure recovery.');
