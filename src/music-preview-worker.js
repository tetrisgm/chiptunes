// Classic /lib worker. All imports are bundled siblings; source is parser data,
// never eval/Function/importScripts input. No model, fetch, storage or audio.
// Coordinator hashes this worker and its dependencies together. Only forward a
// hex version from our own URL; request/source data never controls import URLs.
var previewVersion=/^\?v=[a-fA-F0-9]+$/.test(self.location.search)?self.location.search:'';
importScripts('./gb-hardware.js'+previewVersion,'./gb-kits.js'+previewVersion,'./music-language.js'+previewVersion);
(function(G){
  'use strict';
  G.onmessage=function(event){
    var request=event.data,language=G.CT_MUSIC_LANGUAGE;
    if(!request||typeof request!=='object'||Array.isArray(request)||
      typeof request.source!=='string'||request.source.length>language.LIMITS.source||
      typeof request.projectId!=='string'||!request.projectId.length||request.projectId.length>128||
      !Number.isSafeInteger(request.draftEpoch)||request.draftEpoch<0||
      !Number.isSafeInteger(request.sequence)||request.sequence<1)return;
    var result={sequence:request.sequence,projectId:request.projectId,draftEpoch:request.draftEpoch};
    try{result.compiled=language.compile(request.source);}
    catch(e){result.error='compiler-failed';}
    G.postMessage(result);
  };
})(self);
