// Choose one editor before loading either engine. Shared chip links retain the
// existing page and URL; fresh Create visits use the small audiovisual workspace.
(function(G){
  'use strict';
  function usesSimple(location){
    var path=(location.pathname||'/').replace(/\/+$/,'')||'/';
    var query=new URLSearchParams(location.search||'');
    if(query.get('broadcast')==='1'||query.get('editor')==='chip')return false;
    if(path!=='/'&&path!=='/create')return false;
    return !/(?:^#|&)s=|^#music(?:=|$|-transfer=)/.test(location.hash||'');
  }
  if(typeof module==='object'&&module.exports){module.exports={usesSimple:usesSimple};return;}
  G.CT_USES_SIMPLE_CREATE=usesSimple;
  var initial=usesSimple(location);
  function routeChanged(){if(usesSimple(location)!==initial)location.reload();}
  G.addEventListener('hashchange',routeChanged);G.addEventListener('popstate',routeChanged);
  var script=document.currentScript;
  if(!usesSimple(location)){
    var legacy=document.createElement('script');legacy.src=script.dataset.legacy;
    legacy.onerror=function(){document.body.textContent='The chip editor could not load. Reload to try again.';};
    document.body.appendChild(legacy);return;
  }
  // A trusted same-origin UI frame isolates its CSS and lifecycle from the old
  // shell. User music still runs in its separate opaque frame and workers.
  var frame=document.createElement('iframe');frame.id='algorave-workspace';
  frame.title='Create music and visuals';frame.src='/algorave/index.html';
  frame.allow='autoplay; fullscreen';frame.allowFullscreen=true;
  frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;background:#101116;z-index:1';
  document.body.replaceChildren(frame);
  document.body.style.cssText='margin:0;overflow:hidden;background:#101116';
  document.title='Chiptunes — music and visuals';
})(typeof globalThis!=='undefined'?globalThis:this);
