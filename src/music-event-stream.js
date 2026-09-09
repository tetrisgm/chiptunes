// Bounded, pull-only journal. Source validation/identity belongs to the caller.
// CT_MUSIC_EVENT_STREAM.create({capacity=2048}) accepts capacities 1..4096.
// append(event) -> journal sequence (1-based, never reset by clear). Records
// have Object.prototype or null prototypes and <=24 own data fields. Keys are
// 1..64 UTF-16 units; string values are 0..256. Strings must be well-formed and
// contain no C0/C1 controls. Prototype keys, symbols, accessors, nested values,
// undefined, functions, bigints and nonfinite numbers are rejected. Other
// values are strings, booleans or null. No source fields are added/rewritten.
// clear(reason?) -> new generation (initially 0); an optional bounded string
// reason is validated but not retained. Deliberately cleared events aren't loss.
// reader({replay=false}) -> {read(limit=256), close()}; limits are 1..512.
// read -> {events,dropped,reset,generation,cursor}. Events are detached records;
// cursor is the last consumed/skipped JOURNAL sequence, not event.sequence.
// dropped counts unread overflow losses since this reader's last successful
// read (or creation), including losses before/intervening clears. reset means
// at least one clear since that read/creation, then recovery at oldest retained.
// snapshot -> {capacity,size,generation,sequence,overflow}; overflow is lifetime
// evictions, including already-read entries. All counters are safe integers;
// exhausted sequence/generation counters throw before changing journal state.
(function(G){
  'use strict';
  var MAX_COUNTER=Number.MAX_SAFE_INTEGER;
  var hasOwn=Object.prototype.hasOwnProperty;

  function validString(value,max,nonempty){
    if(typeof value!=='string'||value.length>max||(nonempty&&!value.length))return false;
    for(var i=0;i<value.length;i++){
      var code=value.charCodeAt(i);
      if(code<32||(code>=127&&code<=159))return false;
      if(code>=0xd800&&code<=0xdbff){
        var next=value.charCodeAt(++i);
        if(!(next>=0xdc00&&next<=0xdfff))return false;
      }else if(code>=0xdc00&&code<=0xdfff)return false;
    }
    return true;
  }

  function copyRecord(record){
    if(!record||typeof record!=='object'||Array.isArray(record))throw TypeError('Event must be a plain scalar record');
    var proto=Object.getPrototypeOf(record);
    if(proto!==null&&proto!==Object.prototype)throw TypeError('Event must have a plain or null prototype');
    var keys=Reflect.ownKeys(record);
    if(keys.length>24)throw RangeError('Event must have at most 24 fields');
    var copy=Object.create(null);
    for(var i=0;i<keys.length;i++){
      var key=keys[i];
      if(!validString(key,64,true)||key==='prototype'||hasOwn.call(Object.prototype,key))throw TypeError('Invalid event field name');
      // Descriptors also cover nonenumerable fields, without invoking getters.
      var descriptor=Object.getOwnPropertyDescriptor(record,key);
      if(!descriptor||!hasOwn.call(descriptor,'value'))throw TypeError('Event accessors are not allowed');
      var value=descriptor.value,type=typeof value;
      if(!(value===null||type==='boolean'||(type==='number'&&Number.isFinite(value))||validString(value,256,false)))
        throw TypeError('Event values must be finite scalars with bounded valid strings');
      copy[key]=value;
    }
    return copy;
  }

  function option(options,name,fallback){
    if(options===undefined)return fallback;
    var copy=copyRecord(options),keys=Object.keys(copy);
    if(keys.length>1||(keys.length===1&&keys[0]!==name))throw TypeError('Only '+name+' is supported');
    return keys.length?copy[name]:fallback;
  }

  function boundedInteger(value,max,name){
    if(!Number.isInteger(value)||value<1||value>max)throw RangeError(name+' must be an integer from 1 through '+max);
    return value;
  }

  function create(options){
    var capacity=boundedInteger(option(options,'capacity',2048),4096,'Capacity');
    var slots=new Array(capacity),head=0,size=0,sequence=0,overflow=0;
    // Readers pin only one tiny scalar record, never a retired ring or a chain
    // of generations. A clear replaces this record; old readers can still see
    // precisely where overflow stopped in their original generation.
    var epoch={generation:0,evictedThrough:0,overflowTotal:0};

    function append(event){
      var copy=copyRecord(event);
      if(sequence>=MAX_COUNTER)throw RangeError('Journal sequence exhausted');
      sequence++;
      if(size===capacity){
        slots[head]=copy;
        head=(head+1)%capacity;
        overflow++;
        epoch.evictedThrough=sequence-capacity;
        epoch.overflowTotal=overflow;
      }else{
        slots[(head+size)%capacity]=copy;
        size++;
      }
      return sequence;
    }

    function clear(reason){
      if(reason!==undefined&&!validString(reason,256,false))throw TypeError('Clear reason must be a bounded valid string');
      if(epoch.generation>=MAX_COUNTER)throw RangeError('Journal generation exhausted');
      slots.fill(undefined);
      head=0;size=0;
      epoch={generation:epoch.generation+1,evictedThrough:sequence,overflowTotal:overflow};
      return epoch.generation;
    }

    function reader(options){
      var replay=option(options,'replay',false);
      if(typeof replay!=='boolean')throw TypeError('Replay must be boolean');
      var cursor=replay?sequence-size:sequence,seen=epoch,closed=false;
      function read(limit){
        if(closed)throw Error('Music event reader is closed');
        limit=boundedInteger(limit===undefined?256:limit,512,'Read limit');
        var reset=seen!==epoch;
        // In the reader's original generation, only evictions AFTER its cursor
        // were unread. Every later generation's eviction was unread. Cleared
        // entries never enter either term, however many clears were missed.
        var dropped=Math.max(0,seen.evictedThrough-cursor)+(overflow-seen.overflowTotal);
        var base=sequence-size,next=reset?base:Math.max(cursor,base);
        var count=Math.min(limit,sequence-next),events=[];
        // Subtract sequence values before adding small ring offsets, so even
        // the intermediate arithmetic stays exact at MAX_SAFE_INTEGER.
        for(var i=0;i<count;i++)events.push(Object.assign({},slots[(head+(next-base)+i)%capacity]));
        cursor=next+count;seen=epoch;
        return {events:events,dropped:dropped,reset:reset,generation:epoch.generation,cursor:cursor};
      }
      function close(){closed=true;seen=null;}
      return Object.freeze({read:read,close:close});
    }

    function snapshot(){
      return {capacity:capacity,size:size,generation:epoch.generation,sequence:sequence,overflow:overflow};
    }
    return Object.freeze({append:append,clear:clear,reader:reader,snapshot:snapshot});
  }

  var api=Object.freeze({create:create});G.CT_MUSIC_EVENT_STREAM=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
