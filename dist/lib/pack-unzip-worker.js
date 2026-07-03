// Off-main pack installer: unzips a sideloaded pack zip and writes it into
// OPFS /packs/<id>/ via createSyncAccessHandle (worker-only API — Safari has no
// main-thread OPFS writes). Hand-rolled central-directory parser + native
// DecompressionStream('deflate-raw'); no vendored zip library.
// Protocol: in {type:'install', id, buffer(transferred)} ->
//           out {type:'progress', id, done, total} ... then
//           {type:'installed', id, packId, manifest} | {type:'error', id, message}
(function(){
  'use strict';
  var CAP_TOTAL=512*1024*1024;      // uncompressed pack size cap
  var CAP_ENTRIES=20000;
  var CAP_MANIFEST=64*1024;
  var ID_RE=/^[a-z][a-z0-9_]{1,31}$/;

  function u16(b,o){ return b[o] | (b[o+1]<<8); }
  function u32(b,o){ return ((b[o] | (b[o+1]<<8) | (b[o+2]<<16))>>>0) + (b[o+3]*0x1000000); }
  function utf8(b){ return new TextDecoder('utf-8').decode(b); }

  function findEocd(b){
    var min=Math.max(0, b.length-22-65535);
    for(var i=b.length-22;i>=min;i--){
      if(b[i]===0x50 && b[i+1]===0x4b && b[i+2]===0x05 && b[i+3]===0x06) return i;
    }
    return -1;
  }
  function parseCentral(b){
    var e=findEocd(b);
    if(e<0) throw new Error('not a zip file (no end-of-central-directory)');
    var total=u16(b,e+10), cdSize=u32(b,e+12), cdOff=u32(b,e+16);
    if(total===0xffff || cdOff===0xffffffff || cdSize===0xffffffff) throw new Error('zip64 archives are not supported');
    if(total>CAP_ENTRIES) throw new Error('too many zip entries ('+total+')');
    if(cdOff+cdSize>b.length) throw new Error('corrupt central directory');
    var out=[], p=cdOff;
    for(var n=0;n<total;n++){
      if(p+46>b.length || u32(b,p)!==0x02014b50) throw new Error('corrupt central directory entry');
      var flag=u16(b,p+8), method=u16(b,p+10), csize=u32(b,p+20), usize=u32(b,p+24);
      var nlen=u16(b,p+28), xlen=u16(b,p+30), clen=u16(b,p+32), lho=u32(b,p+42);
      var name=utf8(b.subarray(p+46, p+46+nlen));
      p+=46+nlen+xlen+clen;
      if(flag & 0x1) throw new Error('encrypted zip entries are not supported');
      out.push({name:name, method:method, csize:csize, usize:usize, lho:lho, clean:cleanName(name)});
    }
    return out;
  }
  function cleanName(name){
    var n=String(name||'').replace(/\\/g,'/');
    if(!n || n.slice(-1)==='/') return null;                       // directory entry
    if(n[0]==='/' || /^[a-zA-Z]:/.test(n)) return null;            // absolute / drive path
    var segs=n.split('/');
    for(var i=0;i<segs.length;i++){
      var s=segs[i];
      if(!s || s==='.' || s==='..' || s==='__MACOSX') return null;
    }
    var base=segs[segs.length-1];
    if(base==='.DS_Store' || base==='Thumbs.db' || base.slice(0,2)==='._') return null;
    return segs.join('/');
  }
  function dataSlice(b, ent){
    var p=ent.lho;
    if(p+30>b.length || u32(b,p)!==0x04034b50) throw new Error('corrupt local header: '+ent.name);
    var nlen=u16(b,p+26), xlen=u16(b,p+28), off=p+30+nlen+xlen;
    if(off+ent.csize>b.length) throw new Error('truncated entry: '+ent.name);
    return b.subarray(off, off+ent.csize);
  }
  function inflateRaw(raw, usize, name){
    if(typeof DecompressionStream!=='function') return Promise.reject(new Error('this browser lacks DecompressionStream'));
    var ds=new DecompressionStream('deflate-raw');
    return new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer().then(function(buf){
      if(buf.byteLength!==usize) throw new Error('size mismatch after inflate: '+name);
      return new Uint8Array(buf);
    });
  }
  function bytesOf(b, ent){
    var raw=dataSlice(b, ent);
    if(ent.method===0){
      if(raw.length!==ent.usize) throw new Error('size mismatch: '+ent.name);
      return Promise.resolve(raw);
    }
    if(ent.method===8) return inflateRaw(raw, ent.usize, ent.name);
    return Promise.reject(new Error('unsupported compression method '+ent.method+': '+ent.name));
  }

  function pickRoot(entries){
    // pack.json at zip root, or under exactly one wrapping folder (how OSes zip a dir)
    var best=null;
    for(var i=0;i<entries.length;i++){
      var n=entries[i].clean;
      if(!n) continue;
      var segs=n.split('/');
      if(segs[segs.length-1]==='pack.json'){
        var depth=segs.length-1;
        if(best===null || depth<best.depth) best={depth:depth, prefix:segs.slice(0,-1).join('/'), ent:entries[i]};
      }
    }
    if(!best) throw new Error('no pack.json in zip');
    if(best.depth>1) throw new Error('pack.json is nested too deep (want root or one folder down)');
    return best;
  }
  function validateLite(m){
    // discovery re-validates fully on the main thread; this rejects garbage before any write
    if(!m || typeof m!=='object' || Array.isArray(m)) return 'pack.json is not an object';
    if(m.schema!=='rrr-pack@3') return 'schema must be rrr-pack@3';
    if(m.kind!=='game' && m.kind!=='music' && m.kind!=='composer') return 'unknown kind "'+m.kind+'"';
    if(typeof m.id!=='string' || !ID_RE.test(m.id)) return 'bad id (want ^[a-z][a-z0-9_]{1,31}$)';
    if(m.kind==='music' && m.entry!=null) return 'music packs are data-only (entry forbidden)';
    return '';
  }

  function writeFile(dirHandle, rel, bytes){
    var segs=rel.split('/'), p=Promise.resolve(dirHandle);
    for(var i=0;i<segs.length-1;i++){
      (function(s){ p=p.then(function(d){ return d.getDirectoryHandle(s, {create:true}); }); })(segs[i]);
    }
    return p.then(function(d){ return d.getFileHandle(segs[segs.length-1], {create:true}); })
      .then(function(fh){ return fh.createSyncAccessHandle(); })
      .then(function(ah){
        try{
          ah.truncate(0);
          ah.write(bytes, {at:0});
          ah.flush();
        } finally {
          ah.close();
        }
      });
  }
  function writeAll(packId, prefix, files, b, post){
    return navigator.storage.getDirectory()
      .then(function(root){ return root.getDirectoryHandle('packs', {create:true}); })
      .then(function(packs){
        return packs.removeEntry(packId, {recursive:true}).catch(function(){})   // reinstall = replace
          .then(function(){ return packs.getDirectoryHandle(packId, {create:true}); })
          .then(function(dst){
            var i=0;
            function step(){
              if(i>=files.length) return Promise.resolve();
              var ent=files[i++];
              return bytesOf(b, ent)
                .then(function(bytes){ return writeFile(dst, ent.clean.slice(prefix.length), bytes); })
                .then(function(){
                  if(i%8===0 || i===files.length) post({type:'progress', done:i, total:files.length});
                  return step();
                });
            }
            return step().catch(function(e){
              // half-install cleanup, then surface the original error
              return packs.removeEntry(packId, {recursive:true}).catch(function(){}).then(function(){ throw e; });
            });
          });
      });
  }

  function install(b, post){
    var entries=parseCentral(b);
    var root=pickRoot(entries);
    var prefix=root.prefix ? root.prefix+'/' : '';
    if(root.ent.usize>CAP_MANIFEST) throw new Error('pack.json exceeds 64KB');
    return bytesOf(b, root.ent).then(function(mb){
      var man;
      try{ man=JSON.parse(utf8(mb)); }catch(e){ throw new Error('pack.json is not valid JSON'); }
      var err=validateLite(man);
      if(err) throw new Error('invalid pack.json: '+err);
      var files=[], total=0;
      for(var i=0;i<entries.length;i++){
        var e2=entries[i];
        if(!e2.clean || e2.clean.length<=prefix.length || e2.clean.indexOf(prefix)!==0) continue;
        files.push(e2);
        total+=e2.usize;
      }
      if(!files.length) throw new Error('zip has no files under the pack root');
      if(total>CAP_TOTAL) throw new Error('pack exceeds 512MB uncompressed');
      return writeAll(man.id, prefix, files, b, post).then(function(){ return man; });
    });
  }

  self.onmessage=function(ev){
    var msg=ev.data||{};
    if(msg.type!=='install') return;
    function post(m){ m.id=msg.id; self.postMessage(m); }
    Promise.resolve()
      .then(function(){
        if(!msg.buffer || !msg.buffer.byteLength) throw new Error('empty zip');
        if(msg.buffer.byteLength>CAP_TOTAL) throw new Error('zip exceeds 512MB');
        if(!navigator.storage || !navigator.storage.getDirectory) throw new Error('this browser lacks OPFS storage');
        return install(new Uint8Array(msg.buffer), post);
      })
      .then(function(man){ post({type:'installed', packId:man.id, manifest:man}); })
      .catch(function(e){
        var m=(e && e.message) || String(e);
        if(e && (e.name==='QuotaExceededError' || /quota/i.test(m))) m='storage quota exceeded — remove packs or free disk space ('+m+')';
        post({type:'error', message:m});
      });
  };
})();
