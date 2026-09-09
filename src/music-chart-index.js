// Visual-only index over one immutable compiled note array. No music transforms.
// create(notes).query({fromFrame,toFrame,channels?,limit=1000}) returns
// {items:[{note,index}], bins:[], count, overflow}. Note indices always refer to
// the original array. Notes and query windows are half-open: [start,end).
// A match requires start < toFrame && end > fromFrame (positive durations).
// Queries accept fractional frame bounds; compiled note timings are integers.
// On overflow, items is empty and <=limit nonempty bins cover ALL matches.
// Bins {channel,fromFrame,toFrame,count} partition max(note.start,query.fromFrame),
// so counts sum exactly to the total. If limit < occupied channels, one bin has
// channel:null plus channels and channelCounts:[{channel,count}]. Query a bin's
// window/channel to drill down: crossing notes from earlier bins also intersect
// that narrower window, so detail count may exceed the bin's onset count.
(function(G){
  'use strict';
  var MAX_NOTES=50000,MAX_LIMIT=1000;
  function need(ok,message){if(!ok)throw Error(message);}
  function finiteFrame(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;}
  function lowerBound(values,value){
    var lo=0,hi=values.length;
    while(lo<hi){var mid=(lo+hi)>>>1;if(values[mid]<value)lo=mid+1;else hi=mid;}
    return lo;
  }
  function upperBound(values,value){
    var lo=0,hi=values.length;
    while(lo<hi){var mid=(lo+hi)>>>1;if(values[mid]<=value)lo=mid+1;else hi=mid;}
    return lo;
  }
  function create(notes){
    need(Array.isArray(notes)&&notes.length<=MAX_NOTES,'Chart index requires at most 50000 notes');
    var lanes=[[],[],[],[]];
    notes.forEach(function(note,index){
      need(note&&Number.isInteger(note.ch)&&note.ch>=0&&note.ch<4&&
        Number.isSafeInteger(note.frame)&&note.frame>=0&&Number.isSafeInteger(note.frames)&&note.frames>0&&
        Number.isSafeInteger(note.frame+note.frames),'Invalid chart note channel or interval');
      // Capture timing, but preserve the original note object and array index.
      // Callers treat compiled notes as immutable and rebuild for a new score.
      lanes[note.ch].push({note:note,index:index,start:note.frame,end:note.frame+note.frames});
    });
    lanes=lanes.map(function(entries){
      entries.sort(function(a,b){return a.start-b.start||a.index-b.index;});
      var starts=entries.map(function(e){return e.start;}),ends=entries.map(function(e){return e.end;}).sort(function(a,b){return a-b;});
      var size=1;while(size<entries.length)size*=2;
      var maximum=new Float64Array(size*2);
      entries.forEach(function(e,i){maximum[size+i]=e.end;});
      for(var i=size-1;i>0;i--)maximum[i]=Math.max(maximum[i*2],maximum[i*2+1]);
      return {entries:entries,starts:starts,ends:ends,size:size,maximum:maximum};
    });
    function count(lane,from,to){return lowerBound(lane.starts,to)-upperBound(lane.ends,from);}
    function collect(lane,from,to,items){
      // Augmented interval tree includes old, long notes crossing the viewport.
      function visit(node,lo,hi){
        if(lo>=lane.entries.length||lane.starts[lo]>=to||lane.maximum[node]<=from)return;
        if(hi-lo===1){var e=lane.entries[lo];items.push({note:e.note,index:e.index});return;}
        var mid=(lo+hi)>>>1;visit(node*2,lo,mid);visit(node*2+1,mid,hi);
      }
      visit(1,0,lane.size);
    }
    return Object.freeze({
      query:function(options){
        options=options||{};
        var from=options.fromFrame,to=options.toFrame,limit=options.limit===undefined?MAX_LIMIT:options.limit;
        need(finiteFrame(from)&&finiteFrame(to)&&to>from,'Chart query requires a finite nonempty [fromFrame,toFrame) window');
        need(Number.isInteger(limit)&&limit>=1&&limit<=MAX_LIMIT,'Chart query limit must be 1 through 1000');
        var channels=options.channels===undefined?[0,1,2,3]:options.channels;
        need(Array.isArray(channels)&&channels.length<=4&&channels.every(function(ch){return Number.isInteger(ch)&&ch>=0&&ch<4;}),'Invalid chart channels');
        channels=Array.from(new Set(channels)).sort(function(a,b){return a-b;});
        var counts=channels.map(function(ch){return {channel:ch,count:count(lanes[ch],from,to)};}).filter(function(c){return c.count>0;});
        var total=counts.reduce(function(n,c){return n+c.count;},0);
        var result={items:[],bins:[],count:total,overflow:total>limit};
        if(!result.overflow){
          counts.forEach(function(c){collect(lanes[c.channel],from,to,result.items);});
          // Deterministic ordering: channel, start frame, then original index.
          return result;
        }
        if(limit<counts.length){
          // One explicit mixed-channel bin is necessary when even one bin per
          // occupied channel would exceed the caller's mounted-element budget.
          result.bins.push({channel:null,channels:counts.map(function(c){return c.channel;}),channelCounts:counts,
            fromFrame:from,toFrame:to,count:total});return result;
        }
        var perChannel=Math.floor(limit/counts.length),extra=limit%counts.length;
        counts.forEach(function(c,channelIndex){
          var lane=lanes[c.channel],number=Math.min(c.count,perChannel+(channelIndex<extra?1:0));
          var expired=upperBound(lane.ends,from);
          for(var i=0;i<number;i++){
            var a=from+(to-from)*i/number,b=i===number-1?to:from+(to-from)*(i+1)/number;
            if(b<=a)continue;
            // Partition by max(note.start, viewport.from), not by duration.
            // Thus bins sum exactly to count and spanning notes appear once.
            var n=lowerBound(lane.starts,b)-(a===from?expired:lowerBound(lane.starts,a));
            if(n)result.bins.push({channel:c.channel,fromFrame:a,toFrame:b,count:n});
          }
        });
        return result;
      }
    });
  }
  var api=Object.freeze({create:create});G.CT_MUSIC_CHART_INDEX=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
