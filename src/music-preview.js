// Disposable preview transport. Never installs a revision or touches playback.
(function(G){
  'use strict';
  var SOURCE_LIMIT=1048576,EVENT_LIMIT=50000,FRAME_LIMIT=216000;
  var DEBOUNCE_MS=250,TIMEOUT_MS=3000;
  function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
  function integer(value,max){return Number.isSafeInteger(value)&&value>=0&&value<=max;}
  function inputOK(value){
    return object(value)&&typeof value.source==='string'&&value.source.length<=SOURCE_LIMIT&&
      typeof value.projectId==='string'&&value.projectId.length>0&&value.projectId.length<=128&&
      integer(value.draftEpoch,Number.MAX_SAFE_INTEGER);
  }
  function resultOK(result,source){
    function span(s){return object(s)&&object(s.start)&&object(s.end)&&
      integer(s.start.offset,source.length)&&integer(s.end.offset,source.length)&&s.end.offset>=s.start.offset&&
      integer(s.start.line,SOURCE_LIMIT+1)&&s.start.line>0&&integer(s.end.line,SOURCE_LIMIT+1)&&s.end.line>0&&
      integer(s.start.column,SOURCE_LIMIT+1)&&s.start.column>0&&integer(s.end.column,SOURCE_LIMIT+1)&&s.end.column>0;}
    if(!object(result)||!object(result.settings)||!Array.isArray(result.mapping)||!Array.isArray(result.diagnostics)||
      result.mapping.length>EVENT_LIMIT||result.diagnostics.length>2*EVENT_LIMIT+1)return false;
    if(!result.diagnostics.every(function(d){return object(d)&&typeof d.message==='string'&&d.message.length<=SOURCE_LIMIT&&
      ['error','warning','info'].indexOf(d.severity)!==-1&&(!d.span||span(d.span));}))return false;
    var errors=result.diagnostics.some(function(d){return d.severity==='error';});
    if(result.gb===null)return errors&&result.mapping.length===0;
    if(errors||!object(result.gb)||!Array.isArray(result.gb.notes)||result.gb.notes.length>EVENT_LIMIT||
      !integer(result.gb.totalFrames,FRAME_LIMIT)||result.mapping.length!==result.gb.notes.length)return false;
    var count=0;
    if(!['notes','auto','vibOff','waveLoads','kit'].every(function(key){
      if(result.gb[key]===undefined)return true;
      if(!Array.isArray(result.gb[key]))return false;count+=result.gb[key].length;return count<=EVENT_LIMIT;
    }))return false;
    if(!result.gb.notes.every(function(n){return object(n)&&integer(n.ch,3)&&integer(n.frame,FRAME_LIMIT)&&
      integer(n.frames,FRAME_LIMIT)&&n.frames>0&&n.frame+n.frames<=FRAME_LIMIT;}))return false;
    var seen=new Set();
    return result.mapping.every(function(m){
      if(!object(m)||!integer(m.noteIndex,result.gb.notes.length-1)||seen.has(m.noteIndex)||!span(m.span)||
        !['occurrenceSpan','tokenSpan','playSpan','trackSpan'].every(function(key){return m[key]===undefined||span(m[key]);}))return false;
      if(m.tokenSpan&&(m.tokenSpan.start.offset<m.span.start.offset||m.tokenSpan.end.offset>m.span.end.offset||m.tokenSpan.start.offset===m.tokenSpan.end.offset))return false;
      if(m.occurrenceStartFrame!==undefined||m.occurrenceEndFrame!==undefined){
        if(!integer(m.occurrenceStartFrame,Number.MAX_SAFE_INTEGER)||!integer(m.occurrenceEndFrame,Number.MAX_SAFE_INTEGER)||m.occurrenceEndFrame<m.occurrenceStartFrame)return false;
      }
      seen.add(m.noteIndex);return true;
    });
  }
  function create(options){
    options=options||{};
    var url=options.workerUrl||'/lib/music-preview-worker.js';
    // Only bundled same-origin classic workers, optionally cache-versioned.
    if(typeof url!=='string'||!/^\/lib\/[A-Za-z0-9_/-]+\.js(?:\?[A-Za-z0-9_.~%=&+-]*)?$/.test(url))
      throw Error('Preview worker must be a same-origin /lib JavaScript asset');
    var sequence=0,pending=null,worker=null,timer=null,deadline=null,destroyed=false;
    function clear(){
      if(timer!==null)G.clearTimeout(timer);if(deadline!==null)G.clearTimeout(deadline);
      timer=null;deadline=null;
      if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();worker=null;}
      pending=null;
    }
    function cancel(){sequence++;clear();}
    function current(capture){return !destroyed&&pending===capture&&capture.sequence===sequence;}
    function envelope(capture,extra){return Object.assign({},capture,extra);}
    function fail(capture,code,message){
      if(!current(capture))return;
      clear();if(typeof options.onError==='function')options.onError(envelope(capture,{code:code,message:message}));
    }
    function start(capture){
      timer=null;if(!current(capture))return;
      try{
        worker=new G.Worker(url);
        deadline=G.setTimeout(function(){fail(capture,'timeout','Draft preview timed out. Previous chart kept.');},TIMEOUT_MS);
        worker.onmessage=function(event){
          if(!current(capture))return;
          var data=event.data;
          // A stale/foreign result never changes the latest request's state.
          if(!object(data)||data.sequence!==capture.sequence||data.projectId!==capture.projectId||data.draftEpoch!==capture.draftEpoch)return;
          if(data.error){fail(capture,'worker-error','Draft preview is unavailable. Previous chart kept.');return;}
          if(!resultOK(data.compiled,capture.source)){fail(capture,'invalid-result','Draft preview returned invalid data. Previous chart kept.');return;}
          clear();if(typeof options.onResult==='function')options.onResult(envelope(capture,{compiled:data.compiled}));
        };
        worker.onerror=function(event){if(event&&event.preventDefault)event.preventDefault();fail(capture,'worker-error','Draft preview is unavailable. Previous chart kept.');};
        worker.onmessageerror=function(){fail(capture,'invalid-result','Draft preview returned unreadable data. Previous chart kept.');};
        worker.postMessage(envelope(capture));
      }catch(e){fail(capture,'worker-unavailable','Draft preview is unavailable. Previous chart kept.');}
    }
    return {
      schedule:function(value){
        if(destroyed)return {ok:false,code:'destroyed'};
        cancel();
        if(!inputOK(value)){
          if(typeof options.onError==='function')options.onError({sequence:sequence,code:'invalid-input',message:'Draft preview input exceeds supported bounds.'});
          return {ok:false,code:'invalid-input'};
        }
        var capture=pending={source:value.source,projectId:value.projectId,draftEpoch:value.draftEpoch,sequence:sequence};
        timer=G.setTimeout(function(){start(capture);},DEBOUNCE_MS);
        if(typeof options.onPending==='function')options.onPending(envelope(capture));
        return {ok:true,sequence:capture.sequence};
      },
      cancel:cancel,
      destroy:function(){if(destroyed)return;destroyed=true;cancel();}
    };
  }
  var api=Object.freeze({create:create});G.CT_MUSIC_PREVIEW=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
