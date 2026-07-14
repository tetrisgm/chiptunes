// ===== favorites.js — likes/recent/playlists/listen-stats for GENERATED tracks. =====
// Rehomed from the deleted library.js when the app went generative-only: this is
// the persistence layer the playbar heart, ban, liked-station, and listen stats
// sit on. Same localStorage key as before (retrorave.games.v1) so existing likes
// survive; legacy chip/tracker ids ('c:…'/'m:…') are tolerated in the store but
// parse to null here, so they simply stop surfacing anywhere.
(function(){
  var GK='retrorave.games.v1', G={plays:{}, recent:[], likes:{}, dislikes:{}, ratings:{}, playlists:{}, listen:null};
  try{ var d=JSON.parse(localStorage.getItem(GK)); if(d) G=Object.assign(G,d); }catch(e){}
  G.plays=G.plays||{}; G.recent=G.recent||[]; G.likes=G.likes||{}; G.dislikes=G.dislikes||{}; G.ratings=G.ratings||{}; G.playlists=G.playlists||{};
  function listenStore(){ var L=G.listen||(G.listen={});
    L.total=+L.total||0; L.aiTotal=+L.aiTotal||0;
    L.aiGenres=L.aiGenres||{}; L.albums=L.albums||{}; L.tracks=L.tracks||{}; L.platforms=L.platforms||{};
    return L;
  }
  listenStore();
  function gsave(){ try{ localStorage.setItem(GK, JSON.stringify(G)); }catch(e){} }
  if(typeof window!=='undefined') window.addEventListener('beforeunload', gsave);
  function itemId(it){ return (it && it.kind==='gen' && it.slug) ? 'g:'+it.slug : ''; }
  function idItem(id){
    if(!id || id.slice(0,2)!=='g:') return null;   // legacy 'c:'/'m:' ids stay in storage but never surface
    var sl=id.slice(2);
    return {kind:'gen', slug:sl, name:(window._deslug?_deslug(sl):sl)};
  }
  function recItem(e){ if(!e) return null; if(e.kind==='gen') return e; if(e.slug&&!e.kind) return {kind:'gen',slug:e.slug,name:e.name||e.slug}; return null; }
  function recordItem(it){ if(!it) return; var id=itemId(it); if(!id) return; G.plays[id]=(G.plays[id]||0)+1;
    G.recent=G.recent.filter(function(x){ var ri=recItem(x); return !ri || itemId(ri)!==id; });
    G.recent.unshift(Object.assign({t:Date.now()}, it)); if(G.recent.length>60) G.recent.length=60; gsave(); }
  var _listenSaveAt=0;
  function addSeconds(map,key,sec){ if(!key) return; key=String(key); map[key]=Math.max(0,(+map[key]||0)+sec); }
  function listFromMap(o){ return Object.keys(o||{}).sort(function(a,b){return o[b]-o[a];}).map(idItem).filter(Boolean); }
  window._recordListenSeconds=function(sec,it,info){
    sec=Math.max(0, Math.min(10, +sec||0)); if(sec<=0 || !it) return;
    var L=listenStore(), id=itemId(it), now=Date.now();
    L.total+=sec;
    if(it.kind==='gen' || it.slug){
      L.aiTotal+=sec; addSeconds(L.aiGenres, (info&&(info.genre||info.idiom))||'generated', sec);
      if(id) addSeconds(L.tracks, id, sec);
    }
    if(now-_listenSaveAt>5000){ _listenSaveAt=now; gsave(); }
  };
  window._recordGenPlay=function(slug,name){ if(slug) recordItem({kind:'gen',slug:slug,name:name||slug}); };
  window._libraryList=function(kind){ if(kind==='liked') return listFromMap(G.likes); if(kind==='disliked') return listFromMap(G.dislikes); if(kind==='recent') return (G.recent||[]).map(recItem).filter(Boolean); return []; };
  window._libraryItemId=itemId;
  window._likeToggle=function(it){ var id=itemId(it); if(!id) return false; if(G.likes[id]) delete G.likes[id]; else { G.likes[id]=Date.now(); delete G.dislikes[id]; } gsave(); return !!G.likes[id]; };
  window._isLiked=function(it){ return !!G.likes[itemId(it)]; };
  window._dislikeToggle=function(it){ var id=itemId(it); if(!id) return false; if(G.dislikes[id]) delete G.dislikes[id]; else { G.dislikes[id]=Date.now(); delete G.likes[id]; } gsave(); return !!G.dislikes[id]; };
  window._isDisliked=function(it){ return !!G.dislikes[itemId(it)]; };
  window._libraryPlaylistNames=function(){ return Object.keys(G.playlists||{}).sort(function(a,b){ return a.localeCompare(b); }); };
  window._libraryPlaylistItems=function(name){ return ((G.playlists||{})[name]||[]).map(idItem).filter(Boolean); };
  window._addItemToPlaylist=function(name,it){ name=String(name||'').trim(); var id=itemId(it); if(!name||!id) return false;
    var list=(G.playlists[name]=G.playlists[name]||[]); list=list.filter(function(x){ return x!==id; }); list.unshift(id); G.playlists[name]=list; gsave(); return true; };
})();
