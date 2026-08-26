// Fixed bundled product roster. Chiptunes is not a plug-in host: games and the
// single composer are loaded by build.js before runtime.js.
(function(){
'use strict';
var listeners=[];
function games(){
  var map=window.CT_GAMES||{};
  return Object.keys(map).sort().map(function(id){
    var game=map[id]||{};
    return {id:id,kind:'game',name:game.name||id,version:'bundled',enabled:true,loaded:true,
      manifest:{id:id,kind:'game',name:game.name||id,version:'bundled'}};
  });
}
function get(id){
  var game=(window.CT_GAMES||{})[id];
  if(!game)return null;
  var info=games().filter(function(row){return row.id===id;})[0];
  return Object.assign({},info,{loadGame:function(){return Promise.resolve(game);}});
}
window.activeComposer=function(){
  return window.CT_COMPOSERS&&window.CT_COMPOSERS.rrr_core;
};
window.Packs={
  init:function(){return Promise.resolve(games());},
  list:games,
  get:get,
  onChange:function(fn){if(typeof fn==='function')listeners.push(fn);return function(){
    listeners=listeners.filter(function(x){return x!==fn;});
  };},
  activeComposerId:function(){return 'rrr_core';}
};
})();
