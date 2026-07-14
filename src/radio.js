// ===== radio.js — the "radio" brain: player state + count-based learning (localStorage). =====
// The user no longer picks a genre — the composer samples the full space. Each generated track has a
// FINGERPRINT (tempoBand, brightness, grooveFamily, waveClass, energy) and the like/dislike counts LEARN
// which fingerprints you prefer. The runtime's candidate queue calls Radio.bias(axis,value) to nudge the
// next minted track toward what you 👍 and away from what you 👎, and reports the current fingerprint via
// Radio.setCurrent(). No DB / no accounts: Recently-Played + Liked lists + the counts all live in localStorage.
const Radio = (()=>{
  const LS = 'retrorave.radio.v2';                                          // v2: fingerprint axes (v1 idiom counts are abandoned)
  const KNOBS = ['tempoBand','brightness','grooveFamily','waveClass','energy','mood'];   // the learned fingerprint axes (NOT user-selectable)
  const TEMPO_MIN = 60, TEMPO_MAX = 220;                                    // manual DJ-deck range for every source
  // mood: 'any'|'full'|'sparse'|'none' — pins the generated queue's lead-presence genre.
  // live: the Everything station's SHARED clock schedule (src/live.js) — true means "tuned to
  // the broadcast" (default for fresh installs: you open the app and hear what everyone hears);
  // any skip/mood-pin/tempo-pin forks to the private minted queue. Invariant: live ⇒ mood==='any'.
  // tempo:null = auto: the track/deck BPM locked at track start.
  let state = { game:'random', tempo:null, playing:true, mood:'any', live:true };
  let prefs = { likes:[], dislikes:[], recent:[] };
  let counts = {};                                             // counts[axis][value] = {up,down}
  let cur = null;                                              // current track fingerprint (set by the engine)
  let listeners = [];

  function tally(fp, dir){ for(const k of KNOBS){ const v=fp[k]; if(v==null||v==='') continue;
    (counts[k]=counts[k]||{}); (counts[k][v]=counts[k][v]||{up:0,down:0}); if(dir>0) counts[k][v].up++; else counts[k][v].down++; } }
  function rebuild(){ counts={}; prefs.likes.forEach(e=>tally(e,1)); prefs.dislikes.forEach(e=>tally(e,-1)); }
  function load(){ try{ const d=JSON.parse(localStorage.getItem(LS)); if(d){ if(d.state) state=Object.assign(state,d.state); if(d.prefs) prefs=Object.assign(prefs,d.prefs); } }catch(e){} state.tempo=null; state.playing=true;
    if(state.mood && state.mood!=='any') state.live=false;   // invariant live⇒mood==='any': an upgrading user with a pinned mood is NOT live (default merged live:true in)
    rebuild(); }
  function save(){ try{ localStorage.setItem(LS, JSON.stringify({state:Object.assign({}, state, {tempo:null, playing:true}), prefs})); }catch(e){} }
  function emit(){ listeners.forEach(f=>{ try{ f(); }catch(e){} }); }

  // learning bias for a single axis value: >0 if liked, <0 if disliked, 0 if unseen. The runtime queue
  // sums these across the candidate's fingerprint axes so liked flavors win ties without ever forcing them.
  function bias(axis,val){ const c=counts[axis], s=(c&&c[val])||{up:0,down:0}; return (s.up - s.down)/1.5; }

  // the engine reports each new movement's fingerprint; we log it as "recently played"
  function setCurrent(fp){ cur=fp; if(!fp) return; prefs.recent.unshift(Object.assign({t:Date.now()}, fp)); if(prefs.recent.length>60) prefs.recent.length=60; save(); emit(); }

  function thumbUp(){ if(!cur) return; prefs.likes.unshift(Object.assign({t:Date.now()}, cur)); if(prefs.likes.length>200) prefs.likes.length=200; tally(cur,1); save(); emit(); }
  function thumbDown(){ if(cur){ prefs.dislikes.unshift(Object.assign({t:Date.now()}, cur)); if(prefs.dislikes.length>300) prefs.dislikes.length=300; tally(cur,-1); save(); emit(); } next(); }
  // next/prev delegate to the runtime, which keeps a HISTORY: ⏭ replays the next track you already saw (exact) or
  // rolls a fresh one at the end; ⏮ replays the previous one exactly (same track+game+settings).
  function next(){ if(typeof window!=='undefined' && window.onRadioNext) window.onRadioNext();
    else if(typeof Audio!=='undefined' && Audio.nextMovement) Audio.nextMovement(); }
  function prev(){ if(typeof window!=='undefined' && window.onRadioPrev) window.onRadioPrev(); }
  function playPause(){ state.playing=!state.playing; if(typeof Audio!=='undefined' && Audio.setPlaying) Audio.setPlaying(state.playing); save(); emit(); return state.playing; }
  function setGame(g){ state.game=g; if(typeof window!=='undefined'&&window.onRadioGame) window.onRadioGame(g); save(); emit(); }
  const MOODS=['any','full','sparse','none'];
  function setMood(m){ m=String(m||'any'); if(MOODS.indexOf(m)<0) m='any';
    if(m!=='any' && state.live) setLive(false);   // a mood pin is a fork off the shared broadcast
    state.mood=m; save(); emit(); return m; }
  function setLive(on){ on=!!on;
    if(state.live===on) return on;
    state.live=on;
    if(typeof window!=='undefined' && window.onRadioLive){ try{ window.onRadioLive(on); }catch(e){} }
    save(); emit(); return on; }
  function live(){ return !!state.live; }
  function mood(){ return MOODS.indexOf(state.mood)>=0 ? state.mood : 'any'; }
  function tempoBounds(){ return [TEMPO_MIN, TEMPO_MAX]; }
  function clampTempo(bpm){ bpm=+bpm; return isFinite(bpm) ? Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(bpm))) : TEMPO_MIN; }
  function setTempo(bpm){
    var liveBpm = null;
    if(typeof Audio!=='undefined' && Audio.trackBpm) liveBpm = Audio.trackBpm();
    if(liveBpm==null && typeof Audio!=='undefined' && Audio.detectedBpm) liveBpm = Audio.detectedBpm();
    if(liveBpm==null && typeof Audio!=='undefined' && Audio.grid) liveBpm = Audio.grid().bpm;
    state.tempo = bpm==null?null:clampTempo(bpm);
    if(state.tempo!=null && state.live) setLive(false);   // a tempo pin re-times the deck off the shared schedule -> fork

    if(typeof Audio!=='undefined'){
      if(state.tempo!=null){ if(Audio.setTempo) Audio.setTempo(state.tempo); }      // manual target -> apply now
      else if(Audio.extActive&&Audio.extActive()){ /* external/chip auto plays at native speed and displays detected BPM */ }
      else if(Audio.resetTempo) Audio.resetTempo(); }                                // AUTO -> current track's own BPM, not a new random tempo
    if(typeof window!=='undefined' && window._setPlaybackTempoBpm) window._setPlaybackTempoBpm(state.tempo, liveBpm);
    save(); emit(); return state.tempo; }
  function nudgeTempo(d){ const base = state.tempo!=null ? state.tempo :
    ((typeof Audio!=='undefined'&&Audio.trackBpm&&Audio.trackBpm()) || ((typeof Audio!=='undefined'&&Audio.grid)?Audio.grid().bpm:130));
    return setTempo(base + d); }

  return {
    init: load,
    get state(){ return state; }, get prefs(){ return prefs; }, get current(){ return cur; },
    counts:()=>counts,
    bias, setCurrent,
    thumbUp, thumbDown, next, prev, playPause, setGame, setMood, mood, setLive, live, setTempo, nudgeTempo,
    tempoBounds,
    onChange(cb){ listeners.push(cb); },
  };
})();
