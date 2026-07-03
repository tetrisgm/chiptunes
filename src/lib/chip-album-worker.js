// Off-main album unpacker for /chip/<platform>/<album>/_album.tar.zst.
// The UI thread fetches the compressed archive, then transfers it here so
// zstd decompression and tar scanning cannot freeze input/rendering on mobile.
(function(){
  var ready=false;

  function ensureZstd(){
    if(ready && self.fzstd) return;
    importScripts('/lib/fzstd.js');
    if(!self.fzstd || !self.fzstd.decompress) throw new Error('fzstd unavailable');
    ready=true;
  }

  function str(buf, off, n){
    var x='';
    for(var i=0;i<n;i++){
      var c=buf[off+i];
      if(!c) break;
      x+=String.fromCharCode(c);
    }
    return x;
  }

  function parseTarMeta(buf){
    var out=[], off=0;
    while(off+512<=buf.length){
      var name=str(buf, off, 100);
      if(!name) break;
      var size=parseInt((str(buf, off+124, 12)||'').trim(), 8)||0;
      var type=buf[off+156];
      var dataOff=off+512;
      if(type===0 || type===48) out.push({ name:name, offset:dataOff, size:size });
      off=dataOff + Math.ceil(size/512)*512;
    }
    return out;
  }

  self.onmessage=function(ev){
    var msg=ev.data||{};
    if(msg.type!=='unpack') return;
    try{
      ensureZstd();
      var input=new Uint8Array(msg.buffer);
      var unpacked=self.fzstd.decompress(input);
      if(unpacked.byteOffset!==0 || unpacked.byteLength!==unpacked.buffer.byteLength){
        unpacked=new Uint8Array(unpacked);
      }
      var entries=parseTarMeta(unpacked);
      self.postMessage({ type:'unpacked', id:msg.id, key:msg.key, entries:entries, buffer:unpacked.buffer }, [unpacked.buffer]);
    }catch(e){
      self.postMessage({ type:'error', id:msg.id, key:msg.key, message:(e&&e.message)||String(e) });
    }
  };
})();
