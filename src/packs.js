// packs.js — the pack platform: ONE loader, three kinds (game / music / composer).
// Everything third-party-addable routes through here: served /packs/ (first-party,
// published by build.js), OPFS (zip sideload), and linked local folders (Chromium
// File System Access — the interface a future Tauri/Workshop NativeDirSource fills).
// Global surface: window.Packs + window.activeComposer(). Loads BEFORE runtime.js.
window.CT_COMPOSERS = window.CT_COMPOSERS || {};
(function(){
  'use strict';
  var DEFAULT_COMPOSER='rrr_core';
  var CAP_MANIFEST=64*1024;             // pack.json
  var CAP_INDEX=20*1024*1024;           // albums.json / tracks.json / index.json
  var CAP_ARCHIVE=512*1024*1024;        // album .tar.zst / zip imports
  var CAP_CODE=20*1024*1024;            // pack.js / composer.js entry text
  var ID_RE=/^[a-z][a-z0-9_]{1,31}$/;
  var KINDS={game:1,music:1,composer:1};
  var SRC_RANK={inline:0, served:1, fsdir:2, opfs:3};   // duplicate ids: lowest rank wins
  var KIND_DIR={game:'games', composer:'composers', music:'music'};

  // ---- state ----------------------------------------------------------------
  var rows=new Map();                   // id -> winning row
  var shadows=[];                       // losing duplicate rows (state 'shadowed')
  var seq=0;                            // discovery order tiebreak
  var listeners=[], emitT=0;
  var initP=null;
  var activeComposerSel=DEFAULT_COMPOSER;
  var regCache=new Map();               // 'sourceKind:id' -> persisted registry record

  function _emit(){
    if(emitT) return;
    emitT=setTimeout(function(){ emitT=0; for(var i=0;i<listeners.length;i++){ try{ listeners[i](); }catch(e){} } }, 0);
  }
  function _timeout(p, ms){
    return new Promise(function(res, rej){
      var t=setTimeout(function(){ rej(new Error('timeout')); }, ms);
      p.then(function(v){ clearTimeout(t); res(v); }, function(e){ clearTimeout(t); rej(e); });
    });
  }

  // ---- IndexedDB 'rrr-packs' (registry + fs handles + bpm cache + kv) --------
  // Every op falls back to in-memory maps so a broken/blocked IDB can never brick init.
  var mem={registry:new Map(), handles:new Map(), bpm:new Map(), kv:new Map()};
  var dbP=null;
  function _openDb(){
    if(dbP) return dbP;
    dbP=new Promise(function(resolve){
      var idb=window.indexedDB;
      if(!idb) return resolve(null);
      var req;
      try{ req=idb.open('rrr-packs', 1); }catch(e){ return resolve(null); }
      var to=setTimeout(function(){ resolve(null); }, 2500);
      req.onupgradeneeded=function(){
        var db=req.result;
        if(!db.objectStoreNames.contains('registry')) db.createObjectStore('registry',{keyPath:'key'});
        if(!db.objectStoreNames.contains('handles'))  db.createObjectStore('handles',{keyPath:'sid'});
        if(!db.objectStoreNames.contains('bpm'))      db.createObjectStore('bpm',{keyPath:'key'});
        if(!db.objectStoreNames.contains('kv'))       db.createObjectStore('kv',{keyPath:'k'});
      };
      req.onsuccess=function(){ clearTimeout(to); resolve(req.result); };
      req.onerror=function(){ clearTimeout(to); resolve(null); };
      req.onblocked=function(){ clearTimeout(to); resolve(null); };
    });
    return dbP;
  }
  function _idbOp(store, mode, fn, fallback){
    return _openDb().then(function(db){
      if(!db) return fallback();
      return new Promise(function(resolve){
        var tx, st;
        try{ tx=db.transaction(store, mode); st=tx.objectStore(store); }catch(e){ return resolve(fallback()); }
        var req;
        try{ req=fn(st); }catch(e2){ return resolve(fallback()); }
        req.onsuccess=function(){ resolve(req.result); };
        req.onerror=function(){ resolve(fallback()); };
      });
    });
  }
  function _memKey(store, val){ return store==='registry'?val.key : store==='handles'?val.sid : store==='kv'?val.k : val.key; }
  function _idbGet(store, key){ return _idbOp(store,'readonly',function(st){ return st.get(key); },function(){ return mem[store].get(key)||null; }); }
  function _idbAll(store){ return _idbOp(store,'readonly',function(st){ return st.getAll(); },function(){ return Array.from(mem[store].values()); }); }
  function _idbPut(store, val){ mem[store].set(_memKey(store,val), val); return _idbOp(store,'readwrite',function(st){ return st.put(val); },function(){ return true; }); }
  function _idbDel(store, key){ mem[store].delete(key); return _idbOp(store,'readwrite',function(st){ return st.delete(key); },function(){ return true; }); }
  function _kvGet(k){ return _idbGet('kv',k).then(function(r){ return r?r.v:null; }); }
  function _kvPut(k,v){ return _idbPut('kv',{k:k,v:v}); }

  // ---- manifest validation (rrr-pack@3) --------------------------------------
  function _safeRel(p){
    if(typeof p!=='string' || !p || p[0]==='/' || p.indexOf('\\')>=0) return false;
    var seg=p.split('/');
    for(var i=0;i<seg.length;i++){ if(!seg[i] || seg[i]==='.' || seg[i]==='..') return false; }
    return true;
  }
  function _entryOf(m){ return m.entry || (m.kind==='game'?'pack.js':'composer.js'); }
  function _validate(m){
    if(!m || typeof m!=='object' || Array.isArray(m)) return 'pack.json is not an object';
    if(m.schema!=='rrr-pack@3') return 'schema must be rrr-pack@3';
    if(!KINDS[m.kind]) return 'unknown kind "'+m.kind+'"';
    if(typeof m.id!=='string' || !ID_RE.test(m.id)) return 'bad id (want ^[a-z][a-z0-9_]{1,31}$)';
    if(m.kind==='music'){
      if(m.entry!=null) return 'music packs are data-only (entry forbidden)';
      if(m.decoder!=='vgm' && m.decoder!=='gme' && m.decoder!=='openmpt') return 'bad decoder "'+m.decoder+'"';
      if(m.layout!=null && m.layout!=='album-archive' && m.layout!=='loose') return 'bad layout "'+m.layout+'"';
      if(m.albums!=null && !_safeRel(m.albums)) return 'bad albums path';
      if(m.tracks!=null && !_safeRel(m.tracks)) return 'bad tracks path';
    } else {
      if(!_safeRel(_entryOf(m))) return 'bad entry path';
      if(m.kind==='game' && !(m.app && m.app.contract===3)) return 'game pack needs app.contract 3';
      if(m.kind==='composer' && m.composerV!==3) return 'composer pack needs composerV 3';
    }
    return '';
  }

  // ---- byte hygiene (defends against SPA-fallback-200 on prod hosts) ---------
  function _encPath(p){ return p.split('/').map(encodeURIComponent).join('/'); }
  function _magicBad(rel, u8){
    function has(sig, off){ off=off||0; if(u8.length<off+sig.length) return false; for(var i=0;i<sig.length;i++) if(u8[off+i]!==sig[i]) return false; return true; }
    var GZ=[0x1f,0x8b], VGM=[0x56,0x67,0x6d,0x20]; // 'Vgm '
    var ext=(rel.match(/\.([a-z0-9]+)$/i)||['',''])[1].toLowerCase();
    if(ext==='zst') return has([0x28,0xb5,0x2f,0xfd]) ? '' : 'bad zstd magic';
    if(ext==='vgm'||ext==='vgz') return (has(VGM)||has(GZ)) ? '' : 'bad vgm magic';
    if(ext==='spc') return has([0x53,0x4e,0x45,0x53,0x2d,0x53,0x50,0x43,0x37,0x30,0x30]) ? '' : 'bad spc magic'; // 'SNES-SPC700'
    var head=''; for(var i=0;i<Math.min(u8.length,64);i++) head+=String.fromCharCode(u8[i]);
    if(/^\s*<(!doctype|html)/i.test(head) && ext!=='html' && ext!=='htm') return 'got HTML (missing file?)';
    return '';
  }

  // ---- per-source reads -------------------------------------------------------
  function _fsRead(dir, rel, cap){
    var segs=rel.split('/'), p=Promise.resolve(dir);
    for(var i=0;i<segs.length-1;i++){ (function(s){ p=p.then(function(d){ return d.getDirectoryHandle(s); }); })(segs[i]); }
    return p.then(function(d){ return d.getFileHandle(segs[segs.length-1]); })
      .then(function(fh){ return fh.getFile(); })
      .then(function(f){
        if(cap && f.size>cap) throw new Error(rel+' exceeds '+Math.round(cap/1048576)+'MB cap');
        return f.arrayBuffer();
      })
      .catch(function(e){
        if(e && (e.name==='NotFoundError'||e.name==='TypeMismatchError')){ var er=new Error(rel+' not found'); er.notFound=true; throw er; }
        throw e;
      });
  }
  function _readFile(row, rel, cap){
    cap=cap||CAP_ARCHIVE;
    if(!_safeRel(rel)) return Promise.reject(new Error('bad path '+rel));
    if(row.needsPermission) return Promise.reject(new Error('pack needs permission — reconnect its linked folder'));
    if(row.source==='served'){
      var url='/packs/'+_encPath(row.base+'/'+rel);
      return fetch(url).then(function(r){
        if(!r.ok){ var er=new Error('HTTP '+r.status+' '+url); if(r.status===404) er.notFound=true; throw er; }
        return r.arrayBuffer();
      }).then(function(buf){
        if(buf.byteLength>cap) throw new Error(rel+' exceeds '+Math.round(cap/1048576)+'MB cap');
        var bad=_magicBad(rel, new Uint8Array(buf));
        if(bad){ var er2=new Error(rel+': '+bad); er2.notFound=/HTML/.test(bad); throw er2; }
        return buf;
      });
    }
    if(row.dir) return _fsRead(row.dir, rel, cap);
    return Promise.reject(new Error('pack "'+row.id+'" has no readable files ('+row.source+')'));
  }
  function _readJSON(row, rel, cap){
    return _readFile(row, rel, cap||CAP_INDEX).then(function(buf){
      var t=new TextDecoder('utf-8').decode(buf);
      if(/^\s*</.test(t)){ var er=new Error(rel+' is HTML, not JSON'); er.notFound=true; throw er; }
      return JSON.parse(t);
    });
  }
  function _readText(row, rel, cap){
    return _readFile(row, rel, cap).then(function(buf){ return new TextDecoder('utf-8').decode(buf); });
  }
  function _fileURL(row, rel){
    if(!_safeRel(rel)) return Promise.reject(new Error('bad path '+rel));
    if(row.source==='served') return Promise.resolve('/packs/'+_encPath(row.base+'/'+rel));
    row.cache.urls=row.cache.urls||{};
    if(row.cache.urls[rel]) return Promise.resolve(row.cache.urls[rel]);
    return _readFile(row, rel).then(function(buf){
      var u=URL.createObjectURL(new Blob([buf]));
      row.cache.urls=row.cache.urls||{};
      row.cache.urls[rel]=u;
      return u;
    });
  }
  function _revokeUrls(row){
    var u=row && row.cache && row.cache.urls;
    if(!u) return;
    for(var k in u){ try{ URL.revokeObjectURL(u[k]); }catch(e){} }
    row.cache.urls={};
  }

  // ---- consent + state ---------------------------------------------------------
  function _sideJS(row){ return (row.source==='fsdir'||row.source==='opfs') && (row.kind==='game'||row.kind==='composer'); }
  function _ensureConsent(row){
    if(!_sideJS(row) || row.consent) return true;
    var ok=false;
    try{
      ok=window.confirm('Enable sideloaded '+row.kind+' pack "'+((row.manifest&&row.manifest.name)||row.id)+'"?\n\n'+
        'It runs code with FULL access to this app. Only continue if you trust its author.');
    }catch(e){}
    if(ok){ row.consent=true; } else { row.enabled=false; }
    _persistRow(row);
    return ok;
  }
  function _stateOf(row){
    if(row.shadowedBy) return 'shadowed';
    if(row.error) return 'error';
    if(row.needsPermission) return 'needs-permission';
    if(!row.enabled) return 'disabled';
    if(_sideJS(row) && !row.consent) return 'needs-consent';
    return 'ready';
  }
  function _info(row){
    var m=row.manifest||{};
    var o={ id:row.id, kind:row.kind||m.kind||'', name:m.name||row.id, version:m.version||'', author:m.author||'',
            source:row.source, state:_stateOf(row), manifest:m };
    if(row.error) o.error=row.error;
    if(row.sourceId) o.sourceId=row.sourceId;
    if(o.kind==='composer') o.activeComposer=(row.id===activeComposerSel);
    return o;
  }
  function _persistRow(row){
    if(row.source==='inline') return;
    var rec={ key:row.source+':'+row.id, id:row.id, sourceKind:row.source, sourceId:row.sourceId||'',
      dirName:row.dirName||'', enabled:!!row.enabled, consent:!!row.consent, manifest:row.manifest, ts:Date.now() };
    regCache.set(rec.key, rec);                    // keep the live cache coherent: _refresh() rebuilds rows from it
    _idbPut('registry', rec);
  }

  // ---- code eval (game/composer packs) ----------------------------------------
  // Entries are IIFE-wrapped by pack-tools; the window 'error' listener is
  // belt-and-braces so a bad pack flags itself instead of breaking the app.
  function _registered(id, kind){
    if(kind==='game'){ var g=window.CT_GAMES && window.CT_GAMES[id]; return !!(g && typeof g.make==='function' && typeof g.frame==='function'); }
    var c=window.CT_COMPOSERS && window.CT_COMPOSERS[id];
    return !!(c && c.V===3 && typeof c.compile==='function' && typeof c.fingerprint==='function');
  }
  function _evalPack(row, code){
    return new Promise(function(resolve, reject){
      var err='';
      function onErr(ev){ if(!err) err=(ev && (ev.message || (ev.error && ev.error.message))) || 'script error'; }
      window.addEventListener('error', onErr);
      var s=document.createElement('script');
      s.textContent='/* pack:'+row.source+':'+row.id+' */\n'+code+'\n';
      try{ (document.head||document.documentElement).appendChild(s); }
      catch(e){ err=err || (e && e.message) || 'eval failed'; }
      window.removeEventListener('error', onErr);
      if(s.parentNode) s.parentNode.removeChild(s);
      if(err) reject(new Error(err)); else resolve();
    });
  }
  function _loadCode(row, kind){
    if(row.kind!==kind) return Promise.reject(new Error(row.id+' is not a '+kind+' pack'));
    window.CT_GAMES=window.CT_GAMES||{};
    window.CT_COMPOSERS=window.CT_COMPOSERS||{};
    var reg = kind==='game' ? window.CT_GAMES : window.CT_COMPOSERS;
    if(_registered(row.id, kind)) return Promise.resolve(reg[row.id]);   // inline/bundled copy wins
    if(row.loadP) return row.loadP;
    if(row.error) return Promise.reject(new Error(row.error));
    if(row.needsPermission) return Promise.reject(new Error('pack needs permission — reconnect its linked folder'));
    if(!row.enabled) return Promise.reject(new Error('pack "'+row.id+'" is disabled'));
    if(!_ensureConsent(row)){ _emit(); return Promise.reject(new Error('consent declined for '+row.id)); }
    row.loadP=_readText(row, _entryOf(row.manifest), CAP_CODE)
      .then(function(code){ return _evalPack(row, code); })
      .then(function(){
        if(!_registered(row.id, kind)) throw new Error('pack did not register '+(kind==='game'?'CT_GAMES':'CT_COMPOSERS')+'.'+row.id);
        row.error='';
        _emit();
        return reg[row.id];
      })
      .catch(function(e){
        row.loadP=null;
        row.error=(e && e.message) || 'load failed';
        _emit();
        throw e;
      });
    return row.loadP;
  }

  // ---- music pack data ----------------------------------------------------------
  function _albums(row){
    if(row.kind!=='music') return Promise.reject(new Error(row.id+' is not a music pack'));
    if(row.cache.albums) return row.cache.albums;
    var p;
    // loose (tracker) packs have no albums.json — derive [[dir,count]] from tracks.json.
    if(row.manifest.layout==='loose' || (!row.manifest.albums)){
      p=_tracksIndex(row).then(function(t){
        var out=[], al=(t && t.albums)||[];
        for(var i=0;i<al.length;i++){ var a=al[i]; out.push([String(a.dir||''), (a.tracks&&a.tracks.length)||0]); }
        return out;
      });
    } else {
      p=_readJSON(row, row.manifest.albums||'albums.json', CAP_INDEX).then(function(a){
        if(!Array.isArray(a)) throw new Error('albums.json must be an array');
        var out=[];
        for(var i=0;i<a.length;i++){ var e=a[i]; if(Array.isArray(e) && typeof e[0]==='string') out.push([e[0], +e[1]||0]); }
        return out;
      });
    }
    row.cache.albums=p;
    p.catch(function(){ if(row.cache.albums===p) row.cache.albums=null; });
    return p;
  }
  function _tracksIndex(row){
    if(row.kind!=='music') return Promise.reject(new Error(row.id+' is not a music pack'));
    if(row.cache.tracks) return row.cache.tracks;
    var p=_readJSON(row, row.manifest.tracks||'tracks.json', CAP_INDEX).then(function(t){
      if(t && typeof t==='object' && t.schema && t.schema!=='rrr-tracks@1') throw new Error('unsupported tracks schema '+t.schema);
      return t;
    }).catch(function(e){ if(e && e.notFound) return null; throw e; });
    row.cache.tracks=p;
    p.catch(function(){ if(row.cache.tracks===p) row.cache.tracks=null; });
    return p;
  }

  function _handle(row){
    return {
      manifest: row.manifest,
      info: function(){ return _info(row); },
      readFile: function(rel, cap){ return _readFile(row, rel, cap); },
      readJSON: function(rel, cap){ return _readJSON(row, rel, cap); },
      fileURL: function(rel){ return _fileURL(row, rel); },
      loadGame: function(){ return _loadCode(row, 'game'); },
      loadComposer: function(){ return _loadCode(row, 'composer'); },
      albums: function(){ return _albums(row); },
      tracksIndex: function(){ return _tracksIndex(row); }
    };
  }

  // ---- discovery: served -----------------------------------------------------
  function _discoverServed(){
    return fetch('/packs/index.json').then(function(r){
      if(!r.ok) return [];
      return r.text().then(function(t){
        if(t.length>CAP_INDEX || /^\s*</.test(t)) return [];
        var idx=null;
        try{ idx=JSON.parse(t); }catch(e){ return []; }
        var list=Array.isArray(idx) ? idx : (idx && Array.isArray(idx.packs) ? idx.packs : []);
        var jobs=[];
        for(var i=0;i<list.length;i++){
          (function(ent){
            var p = typeof ent==='string' ? ent
              : (ent && typeof ent==='object' ? (ent.path || (KIND_DIR[ent.kind] && ent.id ? KIND_DIR[ent.kind]+'/'+ent.id : '')) : '');
            if(!p || !_safeRel(p)) return;
            jobs.push(fetch('/packs/'+_encPath(p)+'/pack.json').then(function(r2){
              if(!r2.ok) throw new Error('HTTP '+r2.status);
              return r2.text();
            }).then(function(t2){
              if(t2.length>CAP_MANIFEST) return {broken:p, error:'pack.json exceeds 64KB', source:'served', base:p};
              if(/^\s*</.test(t2)) return null;                    // SPA fallback HTML => not a pack
              var m=null;
              try{ m=JSON.parse(t2); }catch(e){ return {broken:p, error:'pack.json is not valid JSON', source:'served', base:p}; }
              var err=_validate(m);
              if(err) return {broken:p, brokenManifest:m, error:err, source:'served', base:p};
              return {manifest:m, source:'served', base:p};
            }).catch(function(){ return null; }));                  // unreachable served pack: skip quietly
          })(list[i]);
        }
        return Promise.all(jobs).then(function(xs){ return xs.filter(Boolean); });
      });
    }).catch(function(){ return []; });
  }

  // ---- discovery: OPFS ---------------------------------------------------------
  function _opfsRoot(){
    return (navigator.storage && navigator.storage.getDirectory)
      ? navigator.storage.getDirectory()
      : Promise.reject(new Error('no OPFS'));
  }
  function _discoverOpfs(){
    return _opfsRoot().then(function(root){
      return root.getDirectoryHandle('packs').then(function(dir){
        var out=[], it=dir.entries();
        function step(){
          return it.next().then(function(r){
            if(r.done) return out;
            var name=r.value[0], h=r.value[1];
            if(h.kind!=='directory') return step();
            return h.getFileHandle('pack.json')
              .then(function(fh){ return fh.getFile(); })
              .then(function(f){
                if(f.size>CAP_MANIFEST) throw new Error('pack.json exceeds 64KB');
                return f.text();
              })
              .then(function(t){
                var m=JSON.parse(t), err=_validate(m) || (m.id!==name ? 'pack id "'+m.id+'" does not match its folder' : '');
                if(err) out.push({broken:name, brokenManifest:m, error:err, source:'opfs', dir:h, dirName:name});
                else out.push({manifest:m, source:'opfs', dir:h, dirName:name});
              })
              .catch(function(e){ out.push({broken:name, error:(e&&e.message)||'unreadable pack.json', source:'opfs', dir:h, dirName:name}); })
              .then(step);
          });
        }
        return step();
      });
    }).catch(function(){ return []; });
  }

  // ---- discovery: linked directories (File System Access, Chromium) ------------
  function _cachedFsRows(sid){
    var out=[];
    regCache.forEach(function(rec){
      if(rec.sourceKind==='fsdir' && rec.sourceId===sid && rec.manifest)
        out.push({manifest:rec.manifest, source:'fsdir', sourceId:sid, dirName:rec.dirName||'', needsPermission:true});
    });
    return out;
  }
  function _scanDirForPacks(handle, sid){
    function readPack(dir, name){
      return dir.getFileHandle('pack.json')
        .then(function(fh){ return fh.getFile(); })
        .then(function(f){
          if(f.size>CAP_MANIFEST) throw new Error('pack.json exceeds 64KB');
          return f.text();
        })
        .then(function(t){
          var m=JSON.parse(t), err=_validate(m);
          if(err) return {broken:name, brokenManifest:m, error:err, source:'fsdir', sourceId:sid, dir:dir, dirName:name};
          return {manifest:m, source:'fsdir', sourceId:sid, dir:dir, dirName:name};
        })
        .catch(function(e){
          if(e && (e.name==='NotFoundError'||e.name==='TypeMismatchError')) return null;   // not a pack dir
          return {broken:name, error:(e&&e.message)||'unreadable pack.json', source:'fsdir', sourceId:sid, dir:dir, dirName:name};
        });
    }
    return readPack(handle, handle.name||'linked').then(function(self0){
      if(self0) return [self0];                                    // the linked dir IS a pack
      var out=[], it=handle.entries();
      function step(){
        return it.next().then(function(r){
          if(r.done) return out;
          var name=r.value[0], h=r.value[1];
          if(h.kind!=='directory') return step();
          return readPack(h, name).then(function(x){ if(x) out.push(x); return step(); });
        });
      }
      return step();
    });
  }
  function _scanFsSource(h, afterGesture){
    var handle=h && h.handle;
    if(!handle || typeof handle.queryPermission!=='function') return Promise.resolve([]);
    return Promise.resolve(handle.queryPermission({mode:'read'})).then(function(perm){
      if(perm!=='granted' && afterGesture && typeof handle.requestPermission==='function')
        return handle.requestPermission({mode:'read'});
      return perm;
    }).then(function(perm){
      if(perm!=='granted') return _cachedFsRows(h.sid);
      return _scanDirForPacks(handle, h.sid);
    }).catch(function(){ return _cachedFsRows(h.sid); });
  }
  function _discoverFsdir(){
    return _idbAll('handles').then(function(hs){
      if(!hs || !hs.length) return [];
      return Promise.all(hs.map(function(h){ return _scanFsSource(h, false); }))
        .then(function(xs){ return [].concat.apply([], xs); });
    }).catch(function(){ return []; });
  }

  // ---- merge + dedupe ------------------------------------------------------------
  function _brokenId(f){
    var s=String(f.broken||f.dirName||('pack'+seq)).toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^[^a-z]+/,'');
    return ID_RE.test(s) ? s : ('broken_'+(seq));
  }
  function _mkRow(f){
    var m=f.manifest||null, bm=f.brokenManifest||null;   // bm: parsed but failed validation — keep its identity for the error chip
    var id=m ? m.id : (bm && typeof bm.id==='string' && ID_RE.test(bm.id) ? bm.id : _brokenId(f));
    var kind=m ? m.kind : (bm && KINDS[bm.kind] ? bm.kind : '');
    var row={ id:id, kind:kind, manifest:m||bm||{schema:'rrr-pack@3', kind:'', id:id, name:String(f.broken||id)},
      source:f.source, base:f.base||'', dir:f.dir||null, sourceId:f.sourceId||'', dirName:f.dirName||'',
      seq:seq++, error:f.error||'', needsPermission:!!f.needsPermission, shadowedBy:'',
      enabled:true, consent:false, loadP:null, cache:{} };
    var rec=regCache.get(row.source+':'+row.id);
    if(rec){ row.enabled=rec.enabled!==false; row.consent=!!rec.consent; }
    return row;
  }
  function _inlineRow(id, kind){
    return { id:id, kind:kind, manifest:{schema:'rrr-pack@3', kind:kind, id:id, name:id, version:'0'},
      source:'inline', base:'', dir:null, sourceId:'', dirName:'', seq:seq++, error:'', needsPermission:false,
      shadowedBy:'', enabled:true, consent:true, loadP:null, cache:{} };
  }
  function _merge(found){
    var fresh=[], have={}, k;
    for(var i=0;i<found.length;i++){ var r=_mkRow(found[i]); fresh.push(r); have[r.id]=1; }
    var G=window.CT_GAMES||{};
    for(k in G){ if(!have[k] && _registered(k,'game')){ fresh.push(_inlineRow(k,'game')); have[k]=1; } }
    var C=window.CT_COMPOSERS||{};
    for(k in C){ if(!have[k] && _registered(k,'composer')){ fresh.push(_inlineRow(k,'composer')); have[k]=1; } }
    fresh.sort(function(a,b){ return (SRC_RANK[a.source]-SRC_RANK[b.source]) || (a.seq-b.seq); });
    var win=new Map(), losers=[];
    for(var j=0;j<fresh.length;j++){
      var f=fresh[j], w=win.get(f.id);
      if(!w) win.set(f.id, f);
      else { f.shadowedBy=w.source; losers.push(f); }
    }
    var next=new Map();
    win.forEach(function(nr, id){
      var old=rows.get(id);
      if(old && old.source===nr.source){
        // adopt: keep object identity (live PackHandles), refresh discovery-owned fields
        old.kind=nr.kind; old.manifest=nr.manifest; old.base=nr.base; old.dir=nr.dir;
        old.sourceId=nr.sourceId||old.sourceId; old.dirName=nr.dirName||old.dirName;
        old.error=nr.error; old.needsPermission=nr.needsPermission; old.shadowedBy='';
        old.enabled=nr.enabled; old.consent=nr.consent;
        next.set(id, old);
      } else next.set(id, nr);
    });
    rows.forEach(function(old, id){ if(next.get(id)!==old) _revokeUrls(old); });
    rows=next;
    shadows=losers;
    // cache fsdir manifests so a permission-lost boot can still list them
    rows.forEach(function(row){ if(row.source==='fsdir' && !row.needsPermission && row.manifest && row.kind) _persistRow(row); });
  }
  function _refresh(){
    return Promise.all([
      _timeout(_discoverServed(), 3000).catch(function(){ return []; }),
      _timeout(_discoverOpfs(), 3000).catch(function(){ return []; }),
      _timeout(_discoverFsdir(), 3000).catch(function(){ return []; })
    ]).then(function(xs){ _merge(xs[0].concat(xs[1], xs[2])); });
  }

  // ---- zip import (unzips off-main in pack-unzip-worker, lands in OPFS) ---------
  var zipW=null, zipSeq=0, zipJobs={};
  function _zipWorker(){
    if(zipW) return zipW;
    zipW=new Worker('/lib/pack-unzip-worker.js');
    zipW.onmessage=function(ev){
      var m=ev.data||{}, j=zipJobs[m.id];
      if(!j) return;
      if(m.type==='progress'){ if(j.prog){ try{ j.prog(m.done, m.total); }catch(e){} } return; }
      delete zipJobs[m.id];
      if(m.type==='installed') j.res({packId:m.packId, manifest:m.manifest});
      else j.rej(new Error(m.message||'zip install failed'));
    };
    zipW.onerror=function(e){
      var msg=(e && e.message) || 'unzip worker crashed';
      for(var k in zipJobs){ zipJobs[k].rej(new Error(msg)); delete zipJobs[k]; }
      try{ zipW.terminate(); }catch(e2){}
      zipW=null;
    };
    return zipW;
  }
  function _zipInstall(buf, prog){
    return new Promise(function(res, rej){
      var id=++zipSeq;
      zipJobs[id]={res:res, rej:rej, prog:prog};
      try{ _zipWorker().postMessage({type:'install', id:id, buffer:buf}, [buf]); }
      catch(e){ delete zipJobs[id]; rej(e); }
    });
  }
  function _importZip(file, onProgress){
    if(!file || typeof file.arrayBuffer!=='function') return Promise.reject(new Error('importZip needs a File'));
    if(file.size>CAP_ARCHIVE) return Promise.reject(new Error('pack zip exceeds 512MB'));
    return API.init()
      .then(function(){ return _kvGet('persisted'); })
      .then(function(v){
        if(!v && navigator.storage && navigator.storage.persist){
          try{ navigator.storage.persist().catch(function(){}); }catch(e){}
          _kvPut('persisted', 1);
        }
        return file.arrayBuffer();
      })
      .then(function(buf){ return _zipInstall(buf, onProgress); })
      .then(function(res){
        return _refresh().then(function(){
          var row=rows.get(res.packId);
          if(row && row.source==='opfs' && _sideJS(row)) _ensureConsent(row);   // ask once, right in the import gesture
          if(row) _persistRow(row);
          _emit();
          if(row) return _info(row);
          for(var i=0;i<shadows.length;i++) if(shadows[i].id===res.packId && shadows[i].source==='opfs') return _info(shadows[i]);
          return {id:res.packId, kind:res.manifest&&res.manifest.kind||'', name:res.manifest&&res.manifest.name||res.packId,
                  version:'', author:'', source:'opfs', state:'ready', manifest:res.manifest||{}};
        });
      });
  }

  // ---- BPM analysis facade (bpm-worker + IndexedDB bpmCache) ---------------------
  var bpmW=null, bpmSeq=0, bpmJobs={}, bpmQ=Promise.resolve();
  function _bpmWorker(){
    if(bpmW) return bpmW;
    bpmW=new Worker('/lib/bpm-worker.js');
    bpmW.onmessage=function(ev){
      var m=ev.data||{}, j=bpmJobs[m.id];
      if(!j) return;
      delete bpmJobs[m.id];
      if(m.type==='bpm') j.res({bpm:m.bpm||0, conf:m.conf||0});
      else j.rej(new Error(m.message||'bpm analysis failed'));
    };
    bpmW.onerror=function(e){
      var msg=(e && e.message) || 'bpm worker crashed';
      for(var k in bpmJobs){ bpmJobs[k].rej(new Error(msg)); delete bpmJobs[k]; }
      try{ bpmW.terminate(); }catch(e2){}
      bpmW=null;
    };
    return bpmW;
  }
  function _bpmKey(packId, album, file){ return packId+'/'+album+'/'+file; }

  // ---- composer selection -----------------------------------------------------------
  function _setComposerSel(id){
    activeComposerSel=id;
    _kvPut('activeComposer', id);
    _emit();
  }
  function _bootComposer(){
    if(activeComposerSel===DEFAULT_COMPOSER || _registered(activeComposerSel, 'composer')) return;
    var row=rows.get(activeComposerSel);
    if(row && row.kind==='composer') _loadCode(row, 'composer').catch(function(){});
  }
  function _prefetchGames(){
    // radio start needs playable scenes: warm the first two served game packs
    var arr=Array.from(rows.values()).sort(function(a,b){ return a.seq-b.seq; }), n=0;
    for(var i=0;i<arr.length && n<2;i++){
      var r=arr[i];
      if(r.kind!=='game' || r.source!=='served' || _stateOf(r)!=='ready' || _registered(r.id,'game')) continue;
      _loadCode(r, 'game').catch(function(){});
      n++;
    }
  }

  // ---- public API ---------------------------------------------------------------------
  var API={
    init: function(){
      if(initP) return initP;
      initP=_openDb()
        .then(function(){ return Promise.all([_idbAll('registry'), _kvGet('activeComposer')]); })
        .then(function(xs){
          regCache=new Map();
          for(var i=0;i<(xs[0]||[]).length;i++){ var rec=xs[0][i]; if(rec && rec.key) regCache.set(rec.key, rec); }
          if(typeof xs[1]==='string' && xs[1]) activeComposerSel=xs[1];
          return _refresh();
        })
        .then(function(){ _bootComposer(); _prefetchGames(); _emit(); })
        .catch(function(e){ try{ console.warn('Packs.init:', e); }catch(e2){} _emit(); });   // never rejects
      return initP;
    },
    list: function(){
      var ko={game:0, composer:1, music:2};
      var arr=Array.from(rows.values()).concat(shadows);
      arr.sort(function(a,b){
        return ((ko[a.kind]!=null?ko[a.kind]:3)-(ko[b.kind]!=null?ko[b.kind]:3)) || (a.seq-b.seq);
      });
      return arr.map(_info);
    },
    get: function(id){ var row=rows.get(id); return row ? _handle(row) : null; },
    setEnabled: function(id, on){
      var row=rows.get(id);
      if(!row || row.source==='inline') return false;
      if(on && !row.enabled){
        row.enabled=true;
        if(!_ensureConsent(row)){ _emit(); return false; }
      } else row.enabled=!!on;
      _persistRow(row);
      _emit();
      return row.enabled;
    },
    importZip: function(file, onProgress){ return _importZip(file, onProgress); },
    linkDirectory: function(){
      if(typeof window.showDirectoryPicker!=='function')
        return Promise.reject(new Error('folder linking needs the File System Access API (Chromium)'));
      return window.showDirectoryPicker({mode:'read'}).then(function(handle){
        var sid='fsdir_'+Date.now().toString(36)+'_'+(seq++);
        return API.init()
          .then(function(){ return _idbPut('handles', {sid:sid, name:handle.name||'', handle:handle}); })
          .then(_refresh)
          .then(function(){ _emit(); return sid; });
      });
    },
    reconnect: function(sourceId){
      // MUST be called from a user gesture (requestPermission)
      return API.init()
        .then(function(){ return _idbGet('handles', sourceId); })
        .then(function(h){
          if(!h) throw new Error('unknown linked folder '+sourceId);
          return _scanFsSource(h, true);
        })
        .then(function(){ return _refresh(); })
        .then(function(){
          _emit();
          var granted=true;
          rows.forEach(function(r){ if(r.sourceId===sourceId && r.needsPermission) granted=false; });
          return granted;
        });
    },
    unlinkDirectory: function(sourceId){
      return API.init().then(function(){
        var dels=[_idbDel('handles', sourceId)];
        regCache.forEach(function(rec, key){
          if(rec.sourceKind==='fsdir' && rec.sourceId===sourceId){ regCache.delete(key); dels.push(_idbDel('registry', key)); }
        });
        return Promise.all(dels);
      }).then(_refresh).then(function(){ _emit(); return true; });
    },
    sources: function(){
      return API.init().then(function(){ return _idbAll('handles'); }).then(function(hs){
        return (hs||[]).map(function(h){
          var pending=false;
          rows.forEach(function(r){ if(r.sourceId===h.sid && r.needsPermission) pending=true; });
          return {sourceId:h.sid, name:h.name||'', needsPermission:pending};
        });
      });
    },
    remove: function(id){
      var row=rows.get(id);
      if(!row) return Promise.reject(new Error('unknown pack '+id));
      if(row.source!=='opfs' && row.source!=='fsdir'){
        // "remove the thing I imported": a sideloaded copy shadowed by a built-in is still deletable
        for(var s=0;s<shadows.length;s++){ if(shadows[s].id===id && shadows[s].source==='opfs'){ row=shadows[s]; break; } }
      }
      if(row.source==='opfs'){
        _revokeUrls(row);
        return _opfsRoot()
          .then(function(root){ return root.getDirectoryHandle('packs'); })
          .then(function(dir){ return dir.removeEntry(row.dirName||id, {recursive:true}); })
          .catch(function(e){ if(!(e && e.name==='NotFoundError')) throw e; })
          .then(function(){ regCache.delete('opfs:'+id); return _idbDel('registry', 'opfs:'+id); })
          .then(_refresh)
          .then(function(){ _emit(); return true; });
      }
      if(row.source==='fsdir'){
        var sid=row.sourceId, cnt=0;
        rows.forEach(function(r){ if(r.source==='fsdir' && r.sourceId===sid) cnt++; });
        for(var i=0;i<shadows.length;i++) if(shadows[i].source==='fsdir' && shadows[i].sourceId===sid) cnt++;
        if(cnt<=1) return API.unlinkDirectory(sid);
        row.enabled=false;                                   // can't delete the user's files: disable instead
        _persistRow(row);
        _emit();
        return Promise.resolve(true);
      }
      return Promise.reject(new Error('built-in pack — use Packs.setEnabled("'+id+'", false)'));
    },
    onChange: function(cb){
      if(typeof cb!=='function') return function(){};
      listeners.push(cb);
      return function(){ var i=listeners.indexOf(cb); if(i>=0) listeners.splice(i,1); };
    },
    refresh: function(){ return API.init().then(_refresh).then(function(){ _emit(); }); },

    // lazy game loading
    ensureGame: function(id){
      if(_registered(id, 'game')) return Promise.resolve(window.CT_GAMES[id]);
      var row=rows.get(id);
      if(!row || row.kind!=='game') return Promise.reject(new Error('unknown game pack '+id));
      return _loadCode(row, 'game');
    },
    ensureComposer: function(id){
      if(_registered(id, 'composer')) return Promise.resolve(window.CT_COMPOSERS[id]);
      var row=rows.get(id);
      if(!row || row.kind!=='composer') return Promise.reject(new Error('unknown composer pack '+id));
      return _loadCode(row, 'composer');
    },
    discoveredGameIds: function(){
      var out=[], arr=Array.from(rows.values()).sort(function(a,b){ return a.seq-b.seq; });
      for(var i=0;i<arr.length;i++){
        var st=_stateOf(arr[i]);
        if(arr[i].kind==='game' && (st==='ready'||st==='needs-consent')) out.push(arr[i].id);
      }
      return out;
    },

    // composer selection
    activeComposerId: function(){ return activeComposerSel; },
    setActiveComposer: function(id){
      id=String(id||DEFAULT_COMPOSER);
      if(id===activeComposerSel) return Promise.resolve(true);
      if(id===DEFAULT_COMPOSER || _registered(id, 'composer')){ _setComposerSel(id); return Promise.resolve(true); }
      var row=rows.get(id);
      if(!row || row.kind!=='composer') return Promise.reject(new Error('unknown composer '+id));
      return _loadCode(row, 'composer').then(function(){ _setComposerSel(id); return true; });
    },

    // BPM: idle analysis for bpm-less tracks; cached in IndexedDB keyed packId/album/file
    bpmCached: function(packId, album, file){
      return _idbGet('bpm', _bpmKey(packId, album, file)).then(function(r){ return r ? {bpm:r.bpm||0, conf:r.conf||0} : null; });
    },
    analyzeBpm: function(opts){
      // opts: {packId, album, file, bytes:ArrayBuffer|Uint8Array (transferred!), ext:'vgm'|'vgz'|'spc', seconds?}
      opts=opts||{};
      var key=_bpmKey(opts.packId||'', opts.album||'', opts.file||'');
      return _idbGet('bpm', key).then(function(hit){
        if(hit) return {bpm:hit.bpm||0, conf:hit.conf||0};
        var buf=opts.bytes instanceof ArrayBuffer ? opts.bytes
          : (opts.bytes && opts.bytes.buffer ? opts.bytes.buffer.slice(opts.bytes.byteOffset, opts.bytes.byteOffset+opts.bytes.byteLength) : null);
        if(!buf) return Promise.reject(new Error('analyzeBpm needs bytes'));
        var run=function(){
          return new Promise(function(res, rej){
            var id=++bpmSeq;
            bpmJobs[id]={res:res, rej:rej};
            try{ _bpmWorker().postMessage({type:'analyze', id:id, buffer:buf, ext:opts.ext||'', seconds:opts.seconds||30}, [buf]); }
            catch(e){ delete bpmJobs[id]; rej(e); }
          });
        };
        var p=bpmQ.then(run, run);                 // strictly one analysis at a time
        bpmQ=p.then(function(){}, function(){});
        return p.then(function(r){
          _idbPut('bpm', {key:key, bpm:r.bpm||0, conf:r.conf||0, ts:Date.now()});
          return r;
        });
      });
    }
  };

  window.Packs=API;
  // The active composer: composer packs register into CT_COMPOSERS; rrr_core is the
  // bundled default and permanent fallback. audio.js compiles via activeComposer().
  window.activeComposer=function(){
    var C=window.CT_COMPOSERS||{};
    return C[activeComposerSel] || C[DEFAULT_COMPOSER] || null;
  };
})();
