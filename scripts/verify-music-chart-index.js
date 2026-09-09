'use strict';
const assert=require('node:assert/strict');
const {create}=require('../src/music-chart-index.js');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function n(ch,frame,frames=1){return {ch,frame,frames,midi:60,inst:0};}
function brute(notes,from,to,channels=[0,1,2,3]){
  return notes.map((note,index)=>({note,index})).filter(e=>channels.includes(e.note.ch)&&e.note.frame<to&&e.note.frame+e.note.frames>from)
    .sort((a,b)=>a.note.ch-b.note.ch||a.note.frame-b.note.frame||a.index-b.index);
}
function bounded(result,limit){
  assert(result.items.length+result.bins.length<=limit);
  if(result.overflow){assert.equal(result.items.length,0);assert.equal(result.bins.reduce((sum,b)=>sum+b.count,0),result.count);}
  else{assert.equal(result.bins.length,0);assert.equal(result.items.length,result.count);}
}
test('half-open endpoints include crossing long notes, exclude touching edges',()=>{
  const notes=[n(0,0,100),n(0,5,5),n(0,10,1),n(0,19,1),n(0,20,10),n(1,0,10)];
  const r=create(notes).query({fromFrame:10,toFrame:20});
  assert.deepEqual(r.items.map(e=>e.index),[0,2,3]);assert.equal(r.count,3);assert.equal(r.overflow,false);
});
test('original identity/index, unsorted notes, deterministic channel filtering',()=>{
  const notes=[n(3,30),n(1,5),n(0,5),n(1,5),n(0,1)];const before=JSON.stringify(notes),model=create(notes);
  const r=model.query({fromFrame:0,toFrame:40,channels:[1,0,1]});
  assert.deepEqual(r.items.map(e=>e.index),[4,2,1,3]);r.items.forEach(e=>assert.equal(e.note,notes[e.index]));
  assert.equal(JSON.stringify(notes),before,'never sorts or rewrites input');
  assert.equal(model.query({fromFrame:0,toFrame:40,channels:[]}).count,0);
});
test('empty score and fractional viewport boundaries',()=>{
  assert.deepEqual(create([]).query({fromFrame:0,toFrame:1}),{items:[],bins:[],count:0,overflow:false});
  const notes=[n(0,0,1),n(0,1,1)];assert.deepEqual(create(notes).query({fromFrame:.5,toFrame:1.5}).items,brute(notes,.5,1.5));
});
test('50k notes: viewport queries and counts match independent interval scan',()=>{
  const notes=Array.from({length:50000},(_,i)=>n(i%4,(i*7919)%200000,i%97===0?10000:1+i%500));
  const model=create(notes);
  for(let i=0;i<80;i++){
    const from=(i*2347)%200000,to=from+1+(i*113)%2000,channels=i%2?[0,2]:[0,1,2,3];
    const expected=brute(notes,from,to,channels),r=model.query({fromFrame:from,toFrame:to,channels,limit:1000});
    assert.equal(r.count,expected.length);bounded(r,1000);if(!r.overflow)assert.deepEqual(r.items,expected);
  }
});
test('dense bins partition every match including old spanning notes',()=>{
  const notes=Array.from({length:50000},(_,i)=>n(i%4,i%5===0?0:100+(i%900),i%5===0?2000:10));
  const model=create(notes),from=100,to=1000;
  for(const limit of [1,2,3,4,7,64,1000]){
    const r=model.query({fromFrame:from,toFrame:to,limit});bounded(r,limit);assert.equal(r.count,50000);assert(r.overflow);
    for(const bin of r.bins){
      assert(bin.toFrame>bin.fromFrame);assert(bin.fromFrame>=from&&bin.toFrame<=to);
      if(bin.channel===null){assert.equal(bin.channelCounts.reduce((s,c)=>s+c.count,0),50000);continue;}
      const expected=notes.filter(note=>note.ch===bin.channel&&note.frame<to&&note.frame+note.frames>from&&
        Math.max(note.frame,from)>=bin.fromFrame&&Math.max(note.frame,from)<bin.toFrame).length;
      assert.equal(bin.count,expected,'bin counts use clipped starts without duplication');
    }
  }
});
test('narrowing bin time/channel exposes exact notes rather than silently dropping',()=>{
  const notes=Array.from({length:50000},(_,i)=>n(i%4,i*4,1)),model=create(notes);
  const overview=model.query({fromFrame:0,toFrame:200000,limit:1000});assert(overview.overflow);bounded(overview,1000);
  const bin=overview.bins[42],detail=model.query({fromFrame:bin.fromFrame,toFrame:bin.toFrame,channels:[bin.channel],limit:1000});
  assert.equal(detail.overflow,false);assert.equal(detail.count,bin.count);
  assert.deepEqual(detail.items,brute(notes,bin.fromFrame,bin.toFrame,[bin.channel]));
});
test('inseparable simultaneous notes remain explicitly dense after narrowing',()=>{
  const notes=Array.from({length:50000},()=>n(2,0,100));const model=create(notes);
  for(const window of [[0,100],[50,51],[50.1,50.2]]){
    const r=model.query({fromFrame:window[0],toFrame:window[1],limit:10});bounded(r,10);assert.equal(r.count,50000);assert(r.overflow);
    assert.equal(r.bins.length,1);assert.equal(r.bins[0].channel,2);
  }
});
test('drill-down includes earlier crossing notes beyond a bin onset count',()=>{
  const notes=[n(0,0,100),n(0,60),n(0,70),n(0,80)],model=create(notes);
  const overview=model.query({fromFrame:0,toFrame:100,limit:2}),bin=overview.bins[1];
  assert.equal(bin.count,3);
  const detail=model.query({fromFrame:bin.fromFrame,toFrame:bin.toFrame,channels:[bin.channel]});
  assert.equal(detail.count,4);assert.equal(detail.items[0].index,0);
});
test('limits are exact, repeated queries deterministic, invalid inputs rejected',()=>{
  const model=create(Array.from({length:1001},(_,i)=>n(0,i)));
  assert.equal(model.query({fromFrame:0,toFrame:1000,limit:1000}).overflow,false);
  const r=model.query({fromFrame:0,toFrame:1001,limit:1000});assert(r.overflow);bounded(r,1000);
  assert.deepEqual(model.query({fromFrame:0,toFrame:1001,limit:1000}),r);
  for(const limit of [0,1001,-1,1.5,Infinity])assert.throws(()=>model.query({fromFrame:0,toFrame:10,limit}),/limit/);
  for(const window of [[0,0],[-1,1],[2,1],[0,Infinity]])assert.throws(()=>model.query({fromFrame:window[0],toFrame:window[1]}),/window/);
  assert.throws(()=>model.query({fromFrame:0,toFrame:10,channels:[4]}),/channels/);
  for(const notes of [null,Array(50001).fill(n(0,0)),[n(4,0)],[n(0,0,0)],[n(0,-1)],[n(0,.5)],[n(0,Number.MAX_SAFE_INTEGER,1)]])assert.throws(()=>create(notes));
});
console.log('PASS '+passed+' music chart index checks (50k visual-only fixtures; no build/network)');
