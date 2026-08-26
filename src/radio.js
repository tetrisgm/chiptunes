// Minimal player intent. Musical choices belong to the composer, not a taste
// model or recommendation layer.
const Radio=(()=>{
  const TEMPO_MIN=60,TEMPO_MAX=220;
  let state={game:'random',tempo:null,playing:true,live:true},current=null,listeners=[];
  function emit(){listeners.forEach(function(fn){try{fn();}catch(e){}});}
  function next(){if(window.onRadioNext)window.onRadioNext();else if(Audio&&Audio.nextMovement)Audio.nextMovement();}
  function prev(){if(window.onRadioPrev)window.onRadioPrev();}
  function playPause(){state.playing=!state.playing;if(Audio&&Audio.setPlaying)Audio.setPlaying(state.playing);emit();return state.playing;}
  function setGame(game){state.game=game;if(window.onRadioGame)window.onRadioGame(game);emit();}
  function setLive(on){state.live=!!on;if(window.onRadioLive)window.onRadioLive(state.live);emit();return state.live;}
  function setTempo(value){
    state.tempo=value==null?null:Math.max(TEMPO_MIN,Math.min(TEMPO_MAX,Math.round(+value||TEMPO_MIN)));
    if(state.tempo!=null&&state.live)setLive(false);
    if(Audio){if(state.tempo==null&&Audio.resetTempo)Audio.resetTempo();else if(Audio.setTempo)Audio.setTempo(state.tempo);}
    emit();return state.tempo;
  }
  return{
    init:function(){state.tempo=null;state.playing=true;},
    get state(){return state;},get current(){return current;},get prefs(){return{likes:[],dislikes:[],recent:[]};},
    setCurrent:function(value){current=value;emit();},
    next:next,prev:prev,playPause:playPause,setGame:setGame,setLive:setLive,live:function(){return state.live;},
    setTempo:setTempo,nudgeTempo:function(delta){return setTempo((state.tempo||(Audio.trackBpm&&Audio.trackBpm())||120)+delta);},
    tempoBounds:function(){return[TEMPO_MIN,TEMPO_MAX];},
    setMood:function(){return'any';},mood:function(){return'any';},
    thumbUp:function(){},thumbDown:next,bias:function(){return 0;},counts:function(){return{};},
    onChange:function(fn){if(typeof fn==='function')listeners.push(fn);}
  };
})();
