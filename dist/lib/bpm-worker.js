// In-app BPM fallback for pack tracks that ship without bpm metadata.
// Renders ~30s of the tune off-main through the SAME wasm decoders the player
// uses (libvgm for vgm/vgz, libgme for spc), then runs the shared onset/autocorr
// kernel (self.BPM_KERNEL from /lib/bpm-kernel.js — also used by pack-tools).
// Deterministic: same bytes -> same {bpm, conf}. No Math.random.
// Protocol: in {type:'analyze', id, buffer(transferred), ext, seconds?} ->
//           out {type:'bpm', id, bpm, conf} | {type:'error', id, message}
(function(){
  'use strict';
  var SR=44100, DEF_SECONDS=30;
  var vgmP=null, gmeP=null, kernelLoaded=false;

  function kernel(){
    if(!kernelLoaded){ importScripts('/lib/bpm-kernel.js'); kernelLoaded=true; }
    if(!self.BPM_KERNEL || typeof self.BPM_KERNEL.analyze!=='function') throw new Error('bpm-kernel unavailable');
    return self.BPM_KERNEL;
  }
  function vgm(){
    if(!vgmP){
      importScripts('/lib/libvgm.js');
      if(typeof self.createLibVgm!=='function') throw new Error('no createLibVgm');
      vgmP=self.createLibVgm({ locateFile:function(p){ return '/lib/'+p; }, print:function(){}, printErr:function(){} });
    }
    return vgmP;
  }
  function gme(){
    if(!gmeP){
      importScripts('/lib/libgme.js');
      if(typeof self.createLibGme!=='function') throw new Error('no createLibGme');
      gmeP=self.createLibGme({ locateFile:function(p){ return '/lib/'+p; }, print:function(){}, printErr:function(){} });
    }
    return gmeP;
  }
  function gunzip(bytes){
    if(typeof DecompressionStream!=='function') return Promise.reject(new Error('this browser lacks DecompressionStream'));
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
      .arrayBuffer().then(function(b){ return new Uint8Array(b); });
  }

  function renderVgm(bytes, seconds){
    return vgm().then(function(M){
      var dp=0, bp=0;
      try{
        dp=M._malloc(bytes.length);
        M.HEAPU8.set(bytes, dp);
        var err=M.ccall('vgm_load','number',['number','number','number'],[dp, bytes.length, SR]);
        if(err) throw new Error('vgm_load failed ('+err+')');
        var frames=2048, n=frames*2;                       // stereo int16
        bp=M._malloc(n*2);
        var want=Math.floor(SR*seconds), out=new Float32Array(want), w=0;
        while(w<want){
          M.ccall('vgm_render','number',['number','number'],[bp, frames]);
          var heap=M.HEAP16, base=bp>>1, take=Math.min(frames, want-w);
          for(var i=0;i<take;i++) out[w++]=((heap[base+i*2]||0)+(heap[base+i*2+1]||0))/65536;
          var ended=0;
          try{ ended=M._vgm_ended ? M._vgm_ended() : M.ccall('vgm_ended','number',[],[]); }catch(e){ ended=0; }
          if(ended) break;
        }
        return out.subarray(0, w);
      } finally {
        try{ if(M._vgm_free) M._vgm_free(); }catch(e0){}
        if(bp) try{ M._free(bp); }catch(e1){}
        if(dp) try{ M._free(dp); }catch(e2){}
      }
    });
  }
  function renderGme(bytes, seconds){
    return gme().then(function(M){
      var dp=0, op=0, bp=0, emu=0;
      try{
        dp=M._malloc(bytes.length);
        M.HEAPU8.set(bytes, dp);
        op=M._malloc(4);
        var err=M.ccall('gme_open_data','number',['number','number','number','number'],[dp, bytes.length, op, SR]);
        emu=M.getValue(op,'i32');
        if(err || !emu) throw new Error('gme_open_data failed ('+(err||'no emulator')+')');
        M._gme_start_track(emu, 0);
        if(M._gme_set_fade) M._gme_set_fade(emu, Math.max(8000, (seconds+4)*1000));
        var frames=1024, sc=frames*2;
        bp=M._malloc(sc*2);
        var want=Math.floor(SR*seconds), out=new Float32Array(want), w=0;
        while(w<want){
          M._gme_play(emu, sc, bp);
          var heap=M.HEAP16, base=bp>>1, take=Math.min(frames, want-w);
          for(var i=0;i<take;i++) out[w++]=((heap[base+i*2]||0)+(heap[base+i*2+1]||0))/65536;
          if(M._gme_track_ended && M._gme_track_ended(emu)) break;
        }
        return out.subarray(0, w);
      } finally {
        if(emu) try{ M._gme_delete(emu); }catch(e0){}
        if(bp) try{ M._free(bp); }catch(e1){}
        if(op) try{ M._free(op); }catch(e2){}
        if(dp) try{ M._free(dp); }catch(e3){}
      }
    });
  }

  function analyze(msg){
    var bytes=new Uint8Array(msg.buffer);
    var ext=String(msg.ext||'').toLowerCase().replace(/^\./,'');
    var seconds=Math.max(8, Math.min(45, +msg.seconds||DEF_SECONDS));
    var gz=bytes.length>2 && bytes[0]===0x1f && bytes[1]===0x8b;
    var p;
    if(ext==='spc') p=renderGme(bytes, seconds);
    else if(ext==='vgm' || ext==='vgz' || gz) p=(gz ? gunzip(bytes) : Promise.resolve(bytes)).then(function(x){ return renderVgm(x, seconds); });
    else return Promise.reject(new Error('unsupported format: '+(ext||'unknown')));
    return p.then(function(f32){
      var peak=0;
      for(var i=0;i<f32.length;i++){ var a=f32[i]<0?-f32[i]:f32[i]; if(a>peak) peak=a; }
      if(f32.length<SR || peak<0.0005) return {bpm:0, conf:0};     // silence / broken dump
      var r=kernel().analyze(f32, SR)||{};
      var bpm=Math.round(+r.bpm||0);
      var conf=+r.conf||0;
      return {bpm:(bpm>=50 && bpm<=240)?bpm:0, conf:Math.max(0, Math.min(1, conf))};
    });
  }

  var q=Promise.resolve();      // strictly one render at a time (wasm heap reuse)
  self.onmessage=function(ev){
    var msg=ev.data||{};
    if(msg.type!=='analyze') return;
    q=q.then(function(){ return analyze(msg); }).then(function(r){
      self.postMessage({type:'bpm', id:msg.id, bpm:r.bpm, conf:r.conf});
    }, function(e){
      self.postMessage({type:'error', id:msg.id, message:(e && e.message)||String(e)});
    });
  };
})();
