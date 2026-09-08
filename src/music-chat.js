// Transport only. A configured server authenticates and bills model requests.
// Source/comments are data; the only accepted result is a localized proposal.
(function(G){
  'use strict';
  var LIMIT=1024*1024;
  function exact(o,fields){return o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===fields.length&&fields.every(function(k){return Object.prototype.hasOwnProperty.call(o,k);});}
  function unicode(s){
    for(var i=0;i<s.length;i++){
      var c=s.charCodeAt(i);
      if(c>=0xD800&&c<=0xDBFF){var n=s.charCodeAt(++i);if(!(n>=0xDC00&&n<=0xDFFF))return false;}
      else if(c>=0xDC00&&c<=0xDFFF)return false;
    }return true;
  }
  function boundary(s,i){return !(i>0&&i<s.length&&/[\uD800-\uDBFF]/.test(s[i-1])&&/[\uDC00-\uDFFF]/.test(s[i]));}
  function cancelStream(stream){try{if(stream&&stream.cancel)Promise.resolve(stream.cancel()).catch(function(){});}catch(e){}}
  function validate(value,context){
    function need(ok){if(!ok)throw Error('Invalid chat proposal response');}
    need(exact(value,['id','baseRevision','edits','explanation']));
    need(value.id===context.id&&value.baseRevision===context.baseRevision&&
      typeof value.explanation==='string'&&value.explanation.length<=5000&&unicode(value.explanation));
    need(Array.isArray(value.edits)&&value.edits.length>0&&value.edits.length<=32);
    var end=0,previous=-1,inserted=0,removed=0,candidate='',encoder=new TextEncoder();
    value.edits.forEach(function(e){
      need(exact(e,['from','to','text']));
      need(Number.isSafeInteger(e.from)&&Number.isSafeInteger(e.to)&&e.from>=end&&e.from>previous&&
        e.to>=e.from&&e.to<=context.source.length&&typeof e.text==='string'&&unicode(e.text));
      need(boundary(context.source,e.from)&&boundary(context.source,e.to));
      need(!(e.from===0&&e.to===context.source.length));
      inserted+=encoder.encode(e.text).length;removed+=encoder.encode(context.source.slice(e.from,e.to)).length;
      need(inserted<=16384&&removed<=16384);
      candidate+=context.source.slice(end,e.from)+e.text;end=e.to;previous=e.from;
    });
    candidate+=context.source.slice(end);
    need(candidate!==context.source&&encoder.encode(candidate).length<=524288&&removed<encoder.encode(context.source).length);
  }
  function Client(options){
    options=options||{};
    this.endpoint=options.endpoint||'/api/music/chat';
    if(!/^\/api\/[a-z0-9/_-]+$/i.test(this.endpoint)) throw Error('Chat endpoint must be a same-origin API path');
    this.fetch=options.fetch||(G.fetch&&G.fetch.bind(G)); this.active=null; this.serial=0;this.requests=new Set();
  }
  Client.prototype.cancel=function(){
    if(this.active){this.active.stop('Chat request cancelled');this.active=null;}
    this.serial++;
  };
  Client.prototype.request=async function(context){
    if(this.active) throw Error('A chat request is already active');
    if(!context||typeof context.request!=='string'||context.request.length>2000) throw Error('Request must be at most 2000 characters');
    var body=JSON.stringify(context);
    if(new TextEncoder().encode(body).length>LIMIT) throw Error('Chat context is too large');
    // Snapshot the exact wire base: caller mutation while fetch is pending must
    // not change the identity or offsets against which the reply is checked.
    context=JSON.parse(body);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(context.id||'')||typeof context.id!=='string'||
       typeof context.baseRevision!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(context.baseRevision)||
       typeof context.source!=='string'||!unicode(context.source))throw Error('Invalid chat context');
    if(this.requests.has(context.id))throw Error('Duplicate chat request');
    if(this.requests.size>=1024)throw Error('Chat request limit reached');
    this.requests.add(context.id); // Keep tombstones on every outcome; never evict.
    var seq=++this.serial,controller=new AbortController(),self=this;
    var rejection,stopped=null,reader=null,response=null,complete=false;
    var aborted=new Promise(function(_,reject){rejection=reject;});aborted.catch(function(){});
    function stop(message){if(stopped)return;stopped=Error(message);rejection(stopped);controller.abort();cancelStream(reader||response&&response.body);}
    function run(fn){return stopped?Promise.reject(stopped):Promise.race([Promise.resolve().then(function(){if(stopped)throw stopped;return fn();}),aborted]);}
    this.active={seq:seq,controller:controller,stop:stop};
    var timer=setTimeout(function(){stop('Chat request timed out');},30000);
    try{
      response=await run(async function(){
        var result=await self.fetch(self.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body,signal:controller.signal});
        if(stopped)cancelStream(result&&result.body);
        return result;
      });
      if(!response.ok) throw Error(response.status===404||response.status===503?'Chat provider is not configured. Code and playback remain available.':response.status===429?'Chat is rate limited. Try again later.':'Chat request failed ('+response.status+')');
      var length=+(response.headers.get('content-length')||0);
      if(length>LIMIT) throw Error('Chat response is too large');
      reader=response.body&&response.body.getReader();var raw='';
      if(reader){
        var decoder=new TextDecoder('utf-8',{fatal:true}),bytes=0;
        while(true){
          var chunk=await run(function(){return reader.read();}); if(chunk.done){complete=true;break;}
          bytes+=chunk.value.length;
          if(bytes>LIMIT)throw Error('Chat response is too large');
          raw+=decoder.decode(chunk.value,{stream:true});
        }
        raw+=decoder.decode();
      }else{raw=await run(function(){return response.text();});if(new TextEncoder().encode(raw).length>LIMIT)throw Error('Chat response is too large');complete=true;}
      if(seq!==this.serial||controller.signal.aborted)throw Error('Chat request cancelled');
      var value=JSON.parse(raw);
      validate(value,context);
      return value;
    }finally{
      clearTimeout(timer);controller.abort();if(!complete)cancelStream(reader||response&&response.body);
      if(reader)try{reader.releaseLock();}catch(e){}
      if(self.active&&self.active.seq===seq)self.active=null;
    }
  };
  var api={Client:Client}; G.CT_MUSIC_CHAT=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
