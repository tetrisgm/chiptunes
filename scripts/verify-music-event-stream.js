'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const api=require('../src/music-event-stream.js');
const {create}=api;
const source=fs.readFileSync(require.resolve('../src/music-event-stream.js'),'utf8');
const ids=result=>result.events.map(event=>event.id);

test('CommonJS/global API and scalar-only detached snapshots',()=>{
  assert.equal(globalThis.CT_MUSIC_EVENT_STREAM,api);
  assert.deepEqual(Object.keys(api),['create']);
  const journal=create(),initial=journal.snapshot();
  assert.deepEqual(initial,{capacity:2048,size:0,generation:0,sequence:0,overflow:0});
  assert.deepEqual(Object.keys(journal),['append','clear','reader','snapshot']);
  assert(Object.isFrozen(journal));
  initial.size=999;initial.capacity=1;initial.sequence=99;
  assert.equal(journal.append({id:1}),1);
  assert.deepEqual(journal.snapshot(),{capacity:2048,size:1,generation:0,sequence:1,overflow:0});
  assert(Object.values(journal.snapshot()).every(Number.isSafeInteger));
});

test('independent replay and default tail readers never repeat consumed events',()=>{
  const journal=create({capacity:4});
  journal.append({id:1});journal.append({id:2});
  const a=journal.reader({replay:true}),b=journal.reader({replay:true}),tail=journal.reader();
  assert.deepEqual(Object.keys(a),['read','close']);
  assert.deepEqual(tail.read(),{events:[],dropped:0,reset:false,generation:0,cursor:2});
  assert.deepEqual(a.read(1),{events:[{id:1}],dropped:0,reset:false,generation:0,cursor:1});
  assert.deepEqual(ids(b.read()),[1,2]);
  assert.deepEqual(ids(a.read()),[2]);
  assert.deepEqual(ids(a.read()),[]);
  journal.append({id:3});
  for(const reader of [tail,a,b]){
    assert.deepEqual(reader.read(),{events:[{id:3}],dropped:0,reset:false,generation:0,cursor:3});
    assert.deepEqual(reader.read(),{events:[],dropped:0,reset:false,generation:0,cursor:3});
  }
});

test('source sequence and identity are opaque, independent of journal order',()=>{
  const journal=create({capacity:4}),reader=journal.reader();
  const events=[{sequence:900,source:'first',generation:42,revision:9,midi:null},{sequence:-3,source:'second',generation:0,revision:'r-1',midi:60},{sequence:900},{pitch:-200,frame:-10,strength:5}];
  events.forEach((event,i)=>assert.equal(journal.append(event),i+1));
  assert.deepEqual(reader.read(),{events,dropped:0,reset:false,generation:0,cursor:4});
  assert.equal(journal.clear('seek'),1);
  assert.equal(journal.append({sequence:0}),5);
  assert.deepEqual(reader.read(),{events:[{sequence:0}],dropped:0,reset:true,generation:1,cursor:5});
});

test('overflow counts only each reader\'s unread losses, once, across wraps',()=>{
  const journal=create({capacity:3}),slow=journal.reader(),fast=journal.reader();
  for(let id=1;id<=2;id++)journal.append({id});
  assert.deepEqual(ids(fast.read()),[1,2]);
  for(let id=3;id<=6;id++)journal.append({id});
  assert.deepEqual(slow.read(1),{events:[{id:4}],dropped:3,reset:false,generation:0,cursor:4});
  assert.deepEqual(fast.read(2),{events:[{id:4},{id:5}],dropped:1,reset:false,generation:0,cursor:5});
  journal.append({id:7});journal.append({id:8});
  assert.deepEqual(slow.read(),{events:[{id:6},{id:7},{id:8}],dropped:1,reset:false,generation:0,cursor:8});
  assert.deepEqual(fast.read(),{events:[{id:6},{id:7},{id:8}],dropped:0,reset:false,generation:0,cursor:8});
  assert.equal(slow.read().dropped,0);
  assert.deepEqual(journal.snapshot(),{capacity:3,size:3,generation:0,sequence:8,overflow:5});
  assert.deepEqual(journal.reader({replay:true}).read(),{events:[{id:6},{id:7},{id:8}],dropped:0,reset:false,generation:0,cursor:8});
});

test('clear releases history, reports reset once per reader, and keeps sequence',()=>{
  const journal=create({capacity:3}),a=journal.reader(),b=journal.reader();
  journal.append({id:1});journal.append({id:2});
  a.read(1);
  assert.equal(journal.clear('revision'),1);
  assert.deepEqual(journal.snapshot(),{capacity:3,size:0,generation:1,sequence:2,overflow:0});
  assert.deepEqual(a.read(),{events:[],dropped:0,reset:true,generation:1,cursor:2});
  assert.equal(a.read().reset,false);
  assert.equal(journal.append({id:3}),3);
  assert.deepEqual(b.read(),{events:[{id:3}],dropped:0,reset:true,generation:1,cursor:3});
  assert.deepEqual(a.read(),{events:[{id:3}],dropped:0,reset:false,generation:1,cursor:3});
  journal.clear();journal.clear('');
  assert.equal(a.read().generation,3);
  assert.equal(b.read().reset,true);
  assert.equal(journal.reader({replay:true}).read().reset,false);
  assert.equal(journal.append({id:4}),4);
});

test('overflow before and after multiple unseen clears remains exact',()=>{
  const journal=create({capacity:2}),slow=journal.reader(),part=journal.reader(),fast=journal.reader();
  journal.append({id:1});journal.append({id:2});
  part.read(1);fast.read();
  journal.append({id:3}); // Only slow lost this eviction of 1.
  journal.clear('seek'); // 2 and 3 are deliberately discarded.
  journal.append({id:4});journal.append({id:5});journal.append({id:6});
  journal.clear('loop'); // All three readers lost 4, but not 5 or 6.
  journal.clear('empty');
  journal.append({id:7});journal.append({id:8});journal.append({id:9});journal.append({id:10});
  for(const [reader,dropped] of [[slow,4],[part,3],[fast,3]]){
    assert.deepEqual(reader.read(1),{events:[{id:9}],dropped,reset:true,generation:3,cursor:9});
    assert.deepEqual(reader.read(),{events:[{id:10}],dropped:0,reset:false,generation:3,cursor:10});
    assert.deepEqual(ids(reader.read()),[]);
  }
  assert.equal(journal.snapshot().overflow,4);
});

test('a clear after prior overflow does not charge pre-reader losses',()=>{
  const journal=create({capacity:2});
  for(let id=1;id<=5;id++)journal.append({id});
  const tail=journal.reader(),replay=journal.reader({replay:true});
  journal.clear();
  journal.append({id:6});journal.append({id:7});journal.append({id:8});
  for(const reader of [tail,replay])assert.deepEqual(reader.read(),{events:[{id:7},{id:8}],dropped:1,reset:true,generation:1,cursor:8});
  const empty=journal.reader();
  journal.clear();
  assert.deepEqual(empty.read(),{events:[],dropped:0,reset:true,generation:2,cursor:8});
});

test('append input, every reader output and result containers are detached',()=>{
  const journal=create(),event={id:1,sequence:90,name:'pulse',value:.5,on:true,off:false,empty:null};
  const expected={...event};
  journal.append(event);
  event.id=2;event.sequence=-1;event.name='changed';delete event.value;event.nested={};
  const first=journal.reader({replay:true}).read();
  assert.deepEqual(first.events,[expected]);
  first.events[0].id=50;first.events[0].nested=[];
  delete first.events[0].name;first.events.push({id:200});first.cursor=1000;first.generation=1000;
  const next=journal.reader({replay:true}).read();
  assert.deepEqual(next.events,[expected]);
  assert.notEqual(next.events[0],first.events[0]);
  const nullProto=Object.assign(Object.create(null),{id:3,text:'é 🎵',zero:-0});
  Object.defineProperty(nullProto,'hidden',{value:1,enumerable:false});
  journal.append(nullProto);nullProto.id=99;
  const frozen=Object.freeze({id:4});journal.append(frozen);
  const copied=journal.reader({replay:true}).read().events;
  assert.deepEqual(copied[1],{id:3,text:'é 🎵',zero:-0,hidden:1});
  assert.deepEqual(copied[2],{id:4});
  assert.equal(Object.getPrototypeOf(copied[1]),Object.prototype);
});

test('closed readers fail clearly, close is idempotent and other readers survive',()=>{
  const journal=create({capacity:1}),closed=journal.reader(),live=journal.reader();
  closed.close();closed.close();
  assert.throws(()=>closed.read(),/closed/);
  assert.throws(()=>closed.read(0),/closed/);
  for(let id=1;id<=4;id++){journal.append({id});journal.clear('reset');}
  journal.append({id:5});
  assert.throws(()=>closed.read(),/closed/);
  assert.deepEqual(live.read(),{events:[{id:5}],dropped:0,reset:true,generation:4,cursor:5});
});

test('capacity and read bounds are strict and omitted arguments have defaults',()=>{
  for(const capacity of [0,-1,1.5,4097,Infinity,-Infinity,NaN,'2',null,true,2n,{},[],undefined])
    assert.throws(()=>create({capacity}),/finite scalars|Capacity/);
  assert.equal(create({}).snapshot().capacity,2048);
  assert.equal(create(Object.create(null)).snapshot().capacity,2048);
  for(const capacity of [1,4096]){
    const journal=create({capacity}),reader=journal.reader();
    for(let id=0;id<capacity+3;id++)journal.append({id});
    assert.equal(journal.snapshot().size,capacity);
    assert.equal(reader.read(512).dropped,3);
  }
  const journal=create({capacity:4096}),reader=journal.reader();
  for(let id=0;id<900;id++)journal.append({id});
  assert.equal(reader.read().events.length,256);
  for(const limit of [0,-1,1.5,513,Infinity,-Infinity,NaN,'2',null,true,2n,{},[]])assert.throws(()=>reader.read(limit),/Read limit/);
  assert.deepEqual(ids(reader.read(1)),[256],'invalid reads do not advance the cursor');
  assert.equal(reader.read(512).events.length,512);
  assert.equal(reader.read(undefined).events.length,131);
});

test('reader options and failed reads cannot acknowledge a pending reset or loss',()=>{
  for(const options of [null,[],false,4,'replay',{replay:1},{replay:'true'},{replay:undefined},{unknown:true},{replay:true,capacity:2}])
    assert.throws(()=>create().reader(options));
  for(const options of [null,[],false,4,'capacity',{unknown:2},{capacity:2,max:4096}])assert.throws(()=>create(options));
  const journal=create({capacity:1}),reader=journal.reader({});
  journal.append({id:1});journal.append({id:2});journal.clear();journal.append({id:3});
  assert.throws(()=>reader.read(513),/Read limit/);
  assert.deepEqual(reader.read(),{events:[{id:3}],dropped:1,reset:true,generation:1,cursor:3});
});

test('field and string boundaries accept valid scalars without coercion',()=>{
  const journal=create(),boundary={};
  for(let i=0;i<24;i++)boundary['f'+i]=i;
  boundary.f0='x'.repeat(256);boundary.f1='';boundary.f2=null;
  assert.equal(journal.append(boundary),1);
  assert.equal(journal.append({['k'.repeat(64)]:'🎵'.repeat(128),tiny:Number.MIN_VALUE,large:Number.MAX_VALUE}),2);
  assert.equal(journal.append({}),3);
  const before=journal.snapshot();
  for(const event of [{...boundary,extra:1},{['k'.repeat(65)]:1},{'':1},{text:'x'.repeat(257)},{text:'🎵'.repeat(129)}]){
    assert.throws(()=>journal.append(event));assert.deepEqual(journal.snapshot(),before);
  }
  assert.equal(journal.clear('x'.repeat(256)),1);
});

test('forged, nested, symbolic and nonfinite records fail without state changes',()=>{
  const journal=create({capacity:1}),reader=journal.reader();
  journal.append({id:1});
  const before=journal.snapshot();
  const arrayWithForgedPrototype=[];Object.setPrototypeOf(arrayWithForgedPrototype,null);
  const invalid=[null,undefined,1,true,'event',[],arrayWithForgedPrototype,()=>{},new Date(0),new Map(),new Set(),new Uint8Array(1),new Number(1),new String('x'),
    Object.create({id:1}),new (class Event{constructor(){this.id=1;}})(),
    {value:{}},{value:[]},{value:undefined},{value:()=>{}},{value:1n},{value:Symbol('x')},
    {value:NaN},{value:Infinity},{value:-Infinity},{value:new Number(2)},
    {[Symbol('hidden')]:1},{[Symbol.toStringTag]:'Object'},JSON.parse('{"__proto__":1}'),{prototype:1},{constructor:1}];
  for(const key of Object.getOwnPropertyNames(Object.prototype))invalid.push(Object.fromEntries([[key,1]]));
  const hidden={id:2};Object.defineProperty(hidden,'nested',{value:{}});invalid.push(hidden);
  for(const event of invalid){assert.throws(()=>journal.append(event));assert.deepEqual(journal.snapshot(),before);}
  assert.deepEqual(reader.read(),{events:[{id:1}],dropped:0,reset:false,generation:0,cursor:1});
  assert.equal(journal.append({id:2}),2);
});

test('accessors and coercion hooks never run, including hidden fields and options',()=>{
  const journal=create();let calls=0;
  for(const key of ['id','sequence','__proto__','constructor'])for(const enumerable of [true,false]){
    const event={};Object.defineProperty(event,key,{enumerable,get(){calls++;throw Error('Getter ran');}});
    assert.throws(()=>journal.append(event));
  }
  const setter={};Object.defineProperty(setter,'id',{set(){calls++;},enumerable:true});assert.throws(()=>journal.append(setter),/accessors/);
  const capacity={get capacity(){calls++;return 2;}};
  const replay={get replay(){calls++;return true;}};
  assert.throws(()=>create(capacity),/accessors/);assert.throws(()=>journal.reader(replay),/accessors/);
  const coercion={toString(){calls++;return '2';},valueOf(){calls++;return 2;}};
  assert.throws(()=>journal.append({id:coercion}));assert.throws(()=>journal.clear(coercion));
  assert.throws(()=>journal.reader().read(coercion));assert.throws(()=>create({capacity:coercion}));
  const inherited=Object.create({get id(){calls++;return 1;}});assert.throws(()=>journal.append(inherited));
  const tag={};Object.defineProperty(tag,Symbol.toStringTag,{get(){calls++;return 'Object';}});assert.throws(()=>journal.append(tag));
  const revoked=Proxy.revocable({},{});revoked.revoke();assert.throws(()=>journal.append(revoked.proxy));
  assert.equal(calls,0);assert.equal(journal.snapshot().sequence,0);
});

test('malformed/control strings and invalid clear reasons preserve history',()=>{
  const journal=create(),reader=journal.reader();journal.append({id:1});
  const before=journal.snapshot();
  const bad=['\u0000','\n','\t','\r','\u001f','\u007f','\u0085','\u009f','\ud800','\udfff','\ud800x','x\udc00','\ud800\ud800'];
  for(const text of bad){
    assert.throws(()=>journal.append({text}));
    assert.throws(()=>journal.append({[text]:1}));
    assert.throws(()=>journal.clear(text));
    assert.deepEqual(journal.snapshot(),before);
  }
  for(const reason of [null,1,true,{},[],NaN,Infinity,Symbol('x'),'x'.repeat(257)])assert.throws(()=>journal.clear(reason));
  assert.deepEqual(journal.snapshot(),before);
  assert.deepEqual(reader.read(),{events:[{id:1}],dropped:0,reset:false,generation:0,cursor:1});
});

test('browser global works without DOM, network, time, random, callbacks or timers',()=>{
  const sandbox={};
  for(const name of ['window','document','navigator','location','performance','Date','fetch','XMLHttpRequest','WebSocket','setTimeout','setInterval','queueMicrotask','requestAnimationFrame','process','require'])
    Object.defineProperty(sandbox,name,{get(){throw Error('Forbidden dependency: '+name);}});
  const context=vm.createContext(sandbox);
  vm.runInContext('Math.random = function(){throw Error("Random dependency")}',context);
  vm.runInContext(source,context);
  const result=vm.runInContext(`
    var journal=CT_MUSIC_EVENT_STREAM.create({capacity:2}),reader=journal.reader();
    journal.append({sequence:8});journal.append({sequence:8});journal.append({sequence:1});
    journal.clear('loop');journal.append({sequence:0});
    var result=reader.read();reader.close();result;
  `,context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{events:[{sequence:0}],dropped:1,reset:true,generation:1,cursor:4});
});

test('sequence reaches MAX_SAFE_INTEGER exactly and remains exhausted after clear',()=>{
  // Seed only the private counter in an in-memory VM copy: exercising the real
  // safe-integer boundary needs no public test option and no quadrillion loop.
  const needle='head=0,size=0,sequence=0,overflow=0';
  assert.equal(source.split(needle).length,2);
  const context=vm.createContext({});
  vm.runInContext(source.replace(needle,'head=0,size=0,sequence=Number.MAX_SAFE_INTEGER-2,overflow=0'),context);
  const result=vm.runInContext(`
    var journal=CT_MUSIC_EVENT_STREAM.create({capacity:1}),reader=journal.reader();
    var first=journal.append({sequence:0}),last=journal.append({sequence:0});
    var read=reader.read(),before=journal.snapshot(),failed=false;
    try{journal.append({sequence:0});}catch(error){failed=error instanceof RangeError;}
    var after=journal.snapshot();journal.clear();
    var afterClear=reader.read(),failedAgain=false;
    try{journal.append({sequence:0});}catch(error){failedAgain=error instanceof RangeError;}
    ({first,last,read,before,after,failed,afterClear,failedAgain,snapshot:journal.snapshot()});
  `,context);
  assert.equal(result.first,Number.MAX_SAFE_INTEGER-1);
  assert.equal(result.last,Number.MAX_SAFE_INTEGER);
  assert.equal(result.read.cursor,Number.MAX_SAFE_INTEGER);
  assert.equal(result.read.dropped,1);
  assert.equal(result.read.events.length,1);
  assert.equal(result.failed,true);assert.equal(result.failedAgain,true);
  assert.deepEqual(result.before,result.after);
  assert.equal(result.afterClear.cursor,Number.MAX_SAFE_INTEGER);
  assert.equal(result.afterClear.reset,true);
  assert.equal(result.afterClear.dropped,0);
  assert.equal(result.snapshot.sequence,Number.MAX_SAFE_INTEGER);
  assert.equal(result.snapshot.size,0);
});

test('wrapped ring indexing stays precise near the safe-integer ceiling after partial reads',()=>{
  const needle='head=0,size=0,sequence=0,overflow=0';
  assert.equal(source.split(needle).length,2);
  const context=vm.createContext({});
  vm.runInContext(source.replace(needle,'head=0,size=0,sequence=Number.MAX_SAFE_INTEGER-7,overflow=0'),context);
  const result=vm.runInContext(`
    var journal=CT_MUSIC_EVENT_STREAM.create({capacity:4}),reader=journal.reader();
    for(var id=1;id<=7;id++)journal.append({id});
    ({first:reader.read(3),last:reader.read(1),empty:reader.read()});
  `,context);
  assert.deepEqual(Array.from(result.first.events,event=>event.id),[4,5,6]);
  assert.equal(result.first.dropped,3);
  assert.equal(result.first.cursor,Number.MAX_SAFE_INTEGER-1);
  assert.deepEqual(Array.from(result.last.events,event=>event.id),[7]);
  assert.equal(result.last.cursor,Number.MAX_SAFE_INTEGER);
  assert.equal(result.empty.events.length,0);
});

test('generation exhaustion fails atomically without wrapping or clearing history',()=>{
  // Lower only the guard ceiling in this realm; run unchanged production code.
  const context=vm.createContext({});
  vm.runInContext('Number = Object.create(Number,{MAX_SAFE_INTEGER:{value:2}})',context);
  vm.runInContext(source,context);
  const result=vm.runInContext(`
    var journal=CT_MUSIC_EVENT_STREAM.create(),reader=journal.reader();
    journal.clear();journal.clear();journal.append({id:1});
    var before=journal.snapshot(),failed=false;
    try{journal.clear();}catch(error){failed=error instanceof RangeError;}
    ({failed,before,after:journal.snapshot(),read:reader.read()});
  `,context);
  assert.equal(result.failed,true);assert.deepEqual(result.before,result.after);
  assert.equal(result.read.events[0].id,1);assert.equal(result.read.generation,2);
});

test('deterministic mixed-operation model checks exact loss/reset for many consumers',()=>{
  // This deliberately unbounded reference keeps every append/disposition. The
  // production journal must agree while its retained count stays <= capacity.
  for(const capacity of [1,2,7,32]){
    const journal=create({capacity}),history=[],readers=[];let generation=0,state=0x6d2b79f5;
    function random(n){state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;}
    function addReader(replay){
      const retained=history.filter(event=>event.status==='retained');
      readers.push({actual:journal.reader({replay}),cursor:replay&&retained.length?retained[0].id-1:history.length,generation,closed:false});
    }
    function checkRead(reader,limit){
      if(reader.closed){assert.throws(()=>reader.actual.read(limit),/closed/);return;}
      const after=history.slice(reader.cursor),reset=reader.generation!==generation;
      const dropped=after.filter(event=>event.status==='overflow').length;
      const events=after.filter(event=>event.status==='retained').slice(0,limit).map(event=>({id:event.id,sequence:event.id%3}));
      const retained=history.filter(event=>event.status==='retained');
      const base=retained.length?retained[0].id-1:history.length;
      const cursor=events.length?events[events.length-1].id:(reset?base:Math.max(reader.cursor,base));
      assert.deepEqual(reader.actual.read(limit),{events,dropped,reset,generation,cursor});
      reader.cursor=cursor;reader.generation=generation;
    }
    addReader(false);
    for(let step=0;step<2500;step++){
      const action=random(12);
      if(action<7){
        const retained=history.filter(event=>event.status==='retained');
        if(retained.length===capacity)retained[0].status='overflow';
        const id=history.length+1;history.push({id,status:'retained'});
        assert.equal(journal.append({id,sequence:id%3}),id);
      }else if(action===7){
        for(const event of history)if(event.status==='retained')event.status='clear';
        generation++;assert.equal(journal.clear('epoch'),generation);
      }else if(action===8&&readers.length<40)addReader(random(2)===0);
      else if(action===9&&readers.length>1){const reader=readers[1+random(readers.length-1)];reader.actual.close();reader.closed=true;}
      else checkRead(readers[random(readers.length)],1+random(12));
      assert.deepEqual(journal.snapshot(),{capacity,size:history.filter(event=>event.status==='retained').length,generation,sequence:history.length,overflow:history.filter(event=>event.status==='overflow').length});
    }
    for(const reader of readers)checkRead(reader,512);
  }
});
