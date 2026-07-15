// AUTO-SPLIT from index.html — classic script, shares global scope (load order matters).
// Scene loop, home/routes, watch mode, input wiring (must load LAST).
const _RRR_DESKTOP_MODE=(function(){ try{ return new URLSearchParams(location.search||'').get('mode')||''; }catch(e){ return ''; } })();
const _WALLPAPER_MODE=_RRR_DESKTOP_MODE==='wallpaper' && !!(window.RRRNative && window.RRRNative.isDesktop);   // Electron-only; a bare ?mode=wallpaper on the web must NOT strip the UI
const _WALLPAPER_AUDIO=(function(){ try{ return new URLSearchParams(location.search||'').get('audio')!=='0'; }catch(e){ return true; } })();
const _POPOVER_MODE=_RRR_DESKTOP_MODE==='popover' && !!(window.RRRNative && window.RRRNative.isDesktop);   // Electron menu-bar popover (a controller, plays no audio itself)
const _BROWSE_MODE=_RRR_DESKTOP_MODE==='browse' && !!(window.RRRNative && window.RRRNative.isDesktop);     // Electron desktop control-center window (Portal-style; also a controller)
// ----- GAME REGISTRY: derived from window.CT_GAMES. The inline fallback pack(s) register at parse time;
//  the rest arrive through Packs.init() / Packs.onChange (runtime-loaded game packs). No hardcoded roster. -----
let GAMES=[], GAME_BY_KEY={}, POOL=[];
const _BROKEN_GAMES={};                                     // pack broke this session (make/frame threw) -> rotation skips it
function _rebuildGameRegistry(){
  GAMES=[]; GAME_BY_KEY={};
  Object.keys(typeof CT_GAMES!=='undefined' ? CT_GAMES : {}).forEach(function(key){
    var gm=CT_GAMES[key]; if(!gm || !gm.make || !gm.frame) return;
    gm.key=key; GAMES.push(gm); GAME_BY_KEY[key]=gm;
  });
  if(typeof VisualizerGame !== 'undefined' && VisualizerGame.installAll) VisualizerGame.installAll(GAME_BY_KEY);
  POOL = GAMES.filter(gm => gm && !gm.hiddenFromRandom && !_BROKEN_GAMES[gm.key]);   // RANDOM montage draws from healthy public packs
}
_rebuildGameRegistry();
function _markGameBroken(gm, phase, err){
  var key=gm && gm.key; if(!key || _BROKEN_GAMES[key]) return;
  _BROKEN_GAMES[key]=String(phase||'err');
  try{ console.error('[game-pack] broken this session:', key, phase, err); }catch(e){}
  try{ if(document&&document.documentElement) document.documentElement.dataset.rrrBrokenGames=Object.keys(_BROKEN_GAMES).join(','); }catch(e2){}
  POOL = GAMES.filter(g => g && !g.hiddenFromRandom && !_BROKEN_GAMES[g.key]);
}
function _fallbackGameKey(notKey){
  if(GAME_BY_KEY.balloon && !_BROKEN_GAMES.balloon && notKey!=='balloon') return 'balloon';   // balloon is always inlined
  for(var i=0;i<POOL.length;i++){ if(POOL[i].key!==notKey) return POOL[i].key; }
  return (GAME_BY_KEY.balloon && !_BROKEN_GAMES.balloon) ? 'balloon' : null;
}
function _safeMake(gm, A, U, variant){
  if(!gm) return null;
  try{ var st=gm.make(A, U, variant); gm._err=0; return st||{}; }
  catch(e){ _markGameBroken(gm, 'make', e); return null; }
}

// ----- a single game played full-screen on its own tab (its visuals + its soundfont) -----
let selGame=null, selState=null, selVar=0, gameT=0, gameLastSect='';
let randomMode=false, randomT=0, lastRandomIdx=-1;   // RANDOM rides the same path as a tab, auto-switching games on an interval
let _lastSceneState=null;                                   // detect a scene swap (from ANY path) so the timer restarts
let _hiddenAt=0, _reseatScene=false;                        // background-tab return: rAF freezes while hidden but the audio beat-clock keeps
//  running, so on return a game would fast-forward through every missed grid step. On a non-trivial return we RE-SEAT the live scene
//  (fresh make() -> its clock re-anchors to NOW) so it just plays what's current instead of replaying the gap. UNIVERSAL: every game.
let _bgAudioOnly=false, _pendingVisualRefresh=false;         // true while the page is hidden OR the window/tab is unfocused: audio keeps running, visuals/UI stand down.
let _bgAudioOnlySince=0;
function _nowMs(){ return (typeof performance!=='undefined'&&performance.now) ? performance.now() : Date.now(); }
function _backgroundAudioOnlyActive(){ return !!_bgAudioOnly; }
function _backgroundUiDormant(){ return (typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive()); }
function _shouldBackgroundAudioOnly(){
  if(typeof document==='undefined') return false;
  if(_WALLPAPER_MODE) return !!document.hidden;              // a non-activating desktop window never owns focus
  return !!(document.hidden || (document.hasFocus && !document.hasFocus()));
}
function _publishAudioOnlyMode(on, reason){
  try{
    if(document.documentElement){
      document.documentElement.classList.toggle('audio-background', on);
      document.documentElement.dataset.rrrAudioOnly = on ? '1' : '0';
      document.documentElement.dataset.rrrAudioOnlyReason = reason || '';
    }
    if(document.body) document.body.classList.toggle('audio-background', on);
  }catch(e){}
  try{
    if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent('rrr-audio-only', {detail:{active:on, reason:reason||'', since:_bgAudioOnlySince}}));
  }catch(e){}
}
function _syncBackgroundAudioOnly(){
  var on=_shouldBackgroundAudioOnly();
  if(_bgAudioOnly!==on){
    _bgAudioOnly=on;
    _bgAudioOnlySince=on?_nowMs():0;
    _publishAudioOnlyMode(on, on?(document.hidden?'hidden':'blur'):'foreground');
    try{ if(typeof Audio!=='undefined' && Audio.setBackgroundAudioOnly) Audio.setBackgroundAudioOnly(on); }catch(e){}
    if(on){
      try{ if(typeof _stopFrameLoop==='function') _stopFrameLoop(); }catch(e){}
      try{ if(typeof _closePlaybarMenu==='function') _closePlaybarMenu(); }catch(e){}
      try{ if(window.closeMixPanel) window.closeMixPanel(); }catch(e){}
      try{ if(window.closeTrackPanel) window.closeTrackPanel(); }catch(e){}
    } else {
      lastFrame = _nowMs();
      try{ if(typeof Audio!=='undefined' && Audio.resume) Audio.resume(); }catch(e){}
      try{ if(typeof _scheduleFrameLoop==='function') _scheduleFrameLoop(); }catch(e){}
    }
  }
  return on;
}
if(typeof window!=='undefined') window._backgroundAudioOnlyActive = _backgroundAudioOnlyActive;
let SCENE_TIME=30, sceneTimer=0, sceneBeatenFlag=false;     // RANDOM-mode visual rotation timer. Fixed game selections stay pinned.
const WATCH_SCENE_TIME=60;                                  // watch mode rotates slower (wallpaper pacing)
// "beaten" = the on-screen game finished its level THIS scene — a RISING EDGE of its generic clear flag (e.g. Pac-Man clears all
//  dots -> st.win; Bomberman clears all enemies -> st.won; Balloon flips trip<->fight -> st.win). This is an OPT-IN convention, not a
//  per-game branch: a game gets early rotation only if it sets st.win/st.won; otherwise it just rides the timer. Endless games
//  (Galaga waves, Tetris, ...) never set these, so they change purely on the timer. (We ignore stage counters like st.wave too.)
function sceneBeaten(st){
  if(!st) return false;
  var clearing = (st.win>0)||(st.won>0);
  var edge = clearing && !st._wasClr;
  st._wasClr = !!clearing;
  return edge;
}
function fullArea(U){ const m=Math.round(U*1.6); return { x:m, y:m, w:W-2*m, h:H-2*m }; }
// run one active visualizer pack into rect A. Audio is sampled once, then handed
// to the shared pack runner with input, source events, and mutable game state.
function quietPausedSND(){
  const base = (Audio && Audio.SND) ? Audio.SND : {};
  const gr = base.grid ? base.grid() : {gstep:0,phase:0,beat:0,bar:0,spb:0.5,step16:0.125,bpm:120};
  const raw = base.clock ? base.clock() : {};
  const e = Math.min(0.24, raw.energy || 0.18);
  const cl = Object.assign({}, raw, {
    pulse:0, beatPulse:0, kick:0, snare:0, hat:0, drop:false, idle:true, paused:true,
    energy:e, energyLevel:Math.min(3, raw.energyLevel || 3),
    bands:{ bass:e*0.18, mid:e*0.24, treble:e*0.18 },
    noteOns:[], primaryNotes:[]
  });
  const snd = Object.assign({}, base);
  ['event','note','lead','fx','tone','drum','bass','act'].forEach(k=>{ snd[k]=function(){}; });
  snd.grid = function(){ return gr; };
  snd.clock = function(){ return cl; };
  snd.energy = function(){ return e; };
  return snd;
}
function primePausedGameState(st, snd){
  if(!st) return;
  const gr = snd && snd.grid ? snd.grid() : {}, cl = snd && snd.clock ? snd.clock() : {};
  const beat = gr.beat || 0, bar = gr.bar || 0, step = gr.gstep || 0, phrase = cl.phrase || 0;
  st._lastBeat = beat; st.lastBeat = beat; st._mvBeat = beat;
  st._lastPhrase = phrase; st.lastPhrase = phrase; st._mvBar = bar; st._mvStep = Math.floor(step);
  ['beatPulse','kickPulse','phraseFlash','topFlash','shake','_shake','flash'].forEach(k=>{
    if(typeof st[k] === 'number') st[k] = 0;
  });
}
// ===== WATCH MODE clock: a runtime-owned wall-clock beat grid @112 BPM, anchored when watch mode is entered.
//  NEVER touches the AudioContext (watch mode has none). idle:false paused:false -> visualizer 'silence' stays false,
//  so games FULLY play (autopilot wallpaper); emit fns are no-ops; hue drifts slowly for palette movement. =====
let _watchAnchorMs=0;
function watchClockSND(){
  if(!_watchAnchorMs) _watchAnchorMs=_nowMs();
  const bpm=112, spb=60/bpm, t=Math.max(0,(_nowMs()-_watchAnchorMs)/1000);
  const beatF=t/spb, beat=Math.floor(beatF), phase=beatF-beat;
  const bar=Math.floor(beat/4), barPhase=(beatF/4)%1, phrase=Math.floor(bar/4);
  let beatPulse=Math.max(0,1-phase); beatPulse*=beatPulse;
  const phrasePulse=Math.max(0,1-((beatF/16)%1));
  const hue=(0.62+t*0.004)%1, e=0.16;
  const gr={ gstep:beat, phase:phase, beat:beat, bar:bar, spb:spb, step16:spb/4, bpm:bpm };
  const cl={ bpm:bpm, beat:beat, bar:bar, phrase:phrase, barPhase:barPhase,
    beatPulse:beatPulse, pulse:beatPulse, phrasePulse:phrasePulse, kick:0, snare:0, hat:0,
    drop:false, idle:false, paused:false, silence:false, energy:e, energyLevel:2, hue:hue,
    section:'groove', bands:{bass:e*0.5, mid:e*0.5, treble:e*0.35}, roles:{},
    noteOns:[], primaryNotes:[], waveform:[], spectrum:[] };
  const snd={};
  ['event','note','lead','fx','tone','drum','bass','act'].forEach(k=>{ snd[k]=function(){}; });
  snd.grid=function(){ return gr; };
  snd.clock=function(){ return cl; };
  snd.vis=function(){ return cl; };
  snd.energy=function(){ return e; };
  return snd;
}
let _frameRX = null, _frameSND = null;
function makeCachedFrameSND(base, rx){
  base = base || {};
  let gotGrid = false, gotClock = false, gr = null, cl = null;
  const snd = Object.assign({}, base);
  snd.grid = function(){
    if(!gotGrid){
      gotGrid = true;
      try{ gr = (base && typeof base.grid === 'function') ? base.grid() : null; }catch(e){ gr = null; }
      if(!gr) gr = (MV && MV.defaults && MV.defaults.grid) || {gstep:0,phase:0,beat:0,bar:0,spb:0.5,step16:0.125,bpm:120};
    }
    return gr;
  };
  snd.clock = function(){
    if(!gotClock){
      gotClock = true;
      if(rx) cl = rx;
      else {
        try{ cl = (base && typeof base.clock === 'function') ? base.clock() : null; }catch(e){ cl = null; }
      }
      if(!cl) cl = (MV && MV.defaults && MV.defaults.clock) || {beatPulse:0,bar:0,phrase:0,energy:0,energyLevel:0,bands:{},roles:{}};
    }
    return cl;
  };
  snd.vis = function(){ return rx || snd.clock(); };
  snd.energy = function(){
    const v = snd.clock(), b = (v && v.bands) || {};
    return Math.max(v && v.energy || 0, b.bass || 0, b.mid || 0, b.treble || 0);
  };
  return snd;
}
function runGame(game, state, dt, U, A, events){
  const paused = (typeof _transportIsPaused === 'function' && _transportIsPaused());
  const snd = _frameSND || (paused ? quietPausedSND() : makeCachedFrameSND(Audio && Audio.SND, _frameRX));
  if(paused) primePausedGameState(state, snd);
  if(state && typeof MV !== 'undefined' && MV.frame){
    state._mvFrame = MV.frame(snd, state, (game && (game.key || game.name)) || 'game');
  }
  const input = buildIN(A);
  if(typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
    VisualizerGame.run(game, {dt, U, A, IN:input, SND:snd, state, sourceEvents:events});
  }
  return state && state.$viz && state.$viz.resetRequested ? state.$viz.resetRequested : null;
}
let curGameKey=null;
// ----- pack-aware game keys: deep links / prefs validate against the DISCOVERED manifest ids (Packs.list),
//  not just the loaded CT_GAMES — a valid-but-unloaded key triggers that pack's load and shows balloon meanwhile. -----
function _gameKeyKnown(key){
  if(!key) return false;
  if(GAME_BY_KEY[key]) return true;
  try{
    if(typeof Packs!=='undefined' && Packs.list){
      var L=Packs.list()||[];
      for(var i=0;i<L.length;i++){ var p=L[i]; if(p && p.kind==='game' && p.id===key) return true; }
    }
  }catch(e){}
  return false;
}
function _ensureGamePackLoaded(key){
  if(!key || key==='random' || GAME_BY_KEY[key] || _BROKEN_GAMES[key]) return;
  try{
    if(typeof Packs==='undefined' || !Packs.get) return;
    var h=Packs.get(key);
    if(h && h.manifest && h.manifest.kind==='game' && h.loadGame){
      h.loadGame().then(function(){ _onGamePacksChanged(); },
        function(err){ _markGameBroken({key:key}, 'load', err); });
    }
  }catch(e){}
}
function selectGame(key, preserve, forceVar){
  const U = Math.max(4, Math.round(Math.min(W,H)/100));
  // start on a RANDOM variant (e.g. Pac-Man picks one of its maze shapes at random on load);
  // scnGame still cycles variants on section changes for more variety. forceVar = replay an EXACT variant (prev/next history).
  selGame = GAME_BY_KEY[key] || null;
  selVar = (forceVar!=null && selGame) ? (forceVar % (selGame.variants||1)) : (selGame ? Math.floor(Math.random()*(selGame.variants||1)) : 0);
  gameT = 0; gameLastSect = '';
  if(selGame){
    selState=_safeMake(selGame, fullArea(U), U, selVar);
    if(selState==null){ selGame=null; selState=null; }
  }
  // Visualizer selection is presentation only. Generated/chip/mic audio owns the sound engine.
  curGameKey = key;
}
function randomKey(){                                          // pick a random healthy game (≠ last) — RANDOM "clicks" this tab
  const pool = POOL.length ? POOL : GAMES.filter(gm=>gm && !_BROKEN_GAMES[gm.key]);
  if(!pool.length) return _fallbackGameKey('') || 'balloon';
  let i; do { i = Math.floor(Math.random()*pool.length); } while(pool.length>1 && i===lastRandomIdx);
  lastRandomIdx = i; return pool[i].key;
}
function urlGamePref(){
  try{
    var q=new URLSearchParams(location.search||'');
    var raw=(q.get('game') || q.get('visual') || '').toLowerCase().trim();
    if(raw==='random') return 'random';
    if(raw && _gameKeyKnown(raw)){ _ensureGamePackLoaded(raw); return raw; }
    return null;
  }catch(e){ return null; }
}
function selectedGamePref(){
  return urlGamePref() || ((typeof Radio!=='undefined' && Radio.state && Radio.state.game) ? Radio.state.game : 'random');
}
function fixedGamePref(){
  const pref = selectedGamePref();
  return (pref && pref!=='random' && _gameKeyKnown(pref)) ? pref : null;
}
function setUrlGamePref(key){
  key = (key==='random' || _gameKeyKnown(key)) ? key : 'random';
  try{
    var q=new URLSearchParams(location.search||'');
    q.delete('visual');
    q.set('game', key);
    var qs=q.toString();
    var url=(location.pathname||'/') + (qs ? '?' + qs : '') + (location.hash||'');
    if(typeof history!=='undefined' && history.replaceState && (location.pathname + (location.search||'') + (location.hash||''))!==url){
      history.replaceState(null, '', url);
    }
  }catch(e){}
}
function chooseVisualizerGame(key){
  key = (key==='random' || _gameKeyKnown(key)) ? key : 'random';
  _ensureGamePackLoaded(key);
  setUrlGamePref(key);
  var delegated = (typeof window!=='undefined' && typeof window.onRadioGame==='function');
  if(typeof Radio!=='undefined' && Radio.setGame) Radio.setGame(key);
  if(!delegated){ randomMode = (key==='random'); showGame(key); }
  if(typeof _syncGamePicker==='function') _syncGamePicker();
  if(typeof updateNow==='function') updateNow();
}
function advanceRandomVisualizer(){
  if(fixedGamePref()) return false;
  randomMode=true; showGame('random'); return true;
}
// VISUAL-ONLY game swap. The game is purely the music video — selecting OR auto-shuffling a game NEVER touches the
// music; tempo/feel come ONLY from the generated track token. Leaves randomMode for the caller to set.
// A key that is discovered-but-not-loaded (or broken) falls back to balloon while its pack loads.
function showGame(key){
  let showKey = (key==='random') ? randomKey() : key;
  let gm = GAME_BY_KEY[showKey];
  if((!gm || _BROKEN_GAMES[showKey]) && showKey){
    _ensureGamePackLoaded(showKey);
    showKey=_fallbackGameKey(showKey)||showKey;
    gm=GAME_BY_KEY[showKey]||null;
  }
  const U = Math.max(4, Math.round(Math.min(W,H)/100));
  sceneKind = gm ? 'game' : 'abs';
  curGameKey = showKey; selGame = gm||null; selVar = gm ? Math.floor(Math.random()*(gm.variants||1)) : 0; gameT=0; gameLastSect='';
  if(selGame){
    selState=_safeMake(selGame, fullArea(U), U, selVar);
    if(selState==null){                                        // pack broke on make -> one hop to the fallback (balloon is inline)
      const fb=_fallbackGameKey(showKey);
      selGame=fb?GAME_BY_KEY[fb]:null; curGameKey=fb||showKey; sceneKind=selGame?'game':'abs';
      selState=selGame?(_safeMake(selGame, fullArea(U), U, 0)||{}):null; selVar=0;
    }
  }
  if(!(typeof _transportIsPaused === 'function' && _transportIsPaused())) flash = Math.min(1, (flash||0)+0.3);
  if(typeof updateNow==='function') updateNow();
}
function _markWatchdogReset(reset){
  try{
    if(document && document.documentElement && reset){
      document.documentElement.dataset.rrrGameReset = reset.key + ':' + reset.reason;
      document.documentElement.dataset.rrrGameResetMode = reset.mode || '';
    }
  }catch(e){}
  try{ if(reset && console && console.warn) console.warn('[game-watchdog] reset', reset.key, reset.reason, reset); }catch(e){}
}
function _resetSelectedGameFromWatchdog(reset, U, A){
  if(!selGame) return;
  _markWatchdogReset(reset);
  if(randomMode){
    showGame(randomKey());
    sceneTimer = 0;
    sceneBeatenFlag = false;
    return;
  }
  const nv = Math.max(1, selGame.variants || 1);
  if(nv > 1){
    const jump = 1 + Math.floor(Math.random() * Math.max(1, nv - 1));
    selVar = (selVar + jump) % nv;
  }
  selState=_safeMake(selGame, A || fullArea(U), U, selVar);
  if(selState==null){ showGame(_fallbackGameKey(selGame&&selGame.key)||'random'); return; }
  _lastSceneState = selState;
  sceneTimer = 0;
  sceneBeatenFlag = false;
  gameT = 0;
  if(!(typeof _transportIsPaused === 'function' && _transportIsPaused())) flash = Math.min(1, (flash || 0) + 0.22);
}
function scnGame(dt,U,bpm,sect,events){
  sceneT += dt; shake = Math.max(0, shake - dt*4);
  g.fillStyle = '#000'; g.fillRect(0,0,W,H);
  function jolt(){ flash=Math.min(1,flash+0.4); shock=0.6; shockColor=palColor(7); flashColor=hexToRgb(shockColor); }
  // Fixed game selections are sticky. RANDOM is the only mode allowed to auto-cut to another visual scene.
  // The timer restarts whenever the scene object changes, so each random pick gets its full window.
  if(selState !== _lastSceneState){ _lastSceneState = selState; sceneTimer = 0; sceneBeatenFlag = false; if(selState) selState._wasClr = (selState.win>0||selState.won>0); }
  if(randomMode){
    if(selState && sceneBeaten(selState)) sceneBeatenFlag = true;     // latch a level-clear so a brief win flag isn't missed
    sceneTimer += dt;
    var limit = (_watchOnly && !_watchMicActive) ? WATCH_SCENE_TIME : SCENE_TIME;   // wallpaper mode rotates slower
    var swap = (sceneTimer >= limit) || (sceneBeatenFlag && sceneTimer >= 5);       // timer, or beaten (5s floor so quick clears don't churn)
    if(!selGame){ showGame(randomKey()); jolt(); }                                 // first pick (VISUAL-only — music untouched)
    else if(swap){ showGame(randomKey()); jolt(); }                                // -> a DIFFERENT game (VISUAL-only)
  }
  gameLastSect = sect;
  if(!selGame) return;
  const A = fullArea(U);
  const [ax,ay] = shakeXY(3.5); g.save(); g.translate(ax,ay);   // higher mult so a click jolt actually reads (beat-zoom is now the global _beatPump)
  g.save(); g.beginPath(); g.rect(A.x,A.y,A.w,A.h); g.clip();
  let watchdogReset = null, frameErr = null;
  try { watchdogReset = runGame(selGame, selState, dt, U, A, events); }
  catch(e){ frameErr=e; if(!selGame._err){ console.error('frame() failed:', selGame.name, e); } selGame._err=(selGame._err||0)+1; }
  g.restore(); g.restore();
  if(frameErr && selGame._err>=3){                              // repeated frame throws -> the PACK is broken; rotate off it
    _markGameBroken(selGame, 'frame', frameErr);
    showGame(randomMode ? 'random' : (_fallbackGameKey(selGame.key)||'random'));
    return;
  }
  if(watchdogReset) _resetSelectedGameFromWatchdog(watchdogReset, U, A);
}
function freeArea(U){ const m=Math.round(U*1.4), top=Math.max(Math.round(U*5.5), Math.round(H*0.05));
  return { x:m, y:top, w:W-2*m, h:H-top-m }; }
function pickGame(U){
  const A = freeArea(U);
  const pool = POOL.length ? POOL : GAMES.filter(gm=>gm && !_BROKEN_GAMES[gm.key]);   // healthy games (balloon is always inline)
  if(!pool.length){ curGame=null; curState=null; return; }
  let i; do { i = Math.floor(Math.random()*pool.length); } while(pool.length>1 && i===lastGameIdx);
  lastGameIdx = i; curGame = pool[i]; curGame._err = 0;
  const nv = curGame.variants||1, variant = Math.floor(Math.random()*nv);
  curState=_safeMake(curGame, A, U, variant);
  if(curState==null){ curGame=null; curState=null; return; }   // broken pack marked; next frame picks another
  // Random visualizer changes are presentation-only; they never swap procedural music presets.
  flash = Math.min(1, flash+0.5); shock = 0.7; shockColor = palColor(remStage*5); flashColor = hexToRgb(shockColor);
}
function scnAbs(dt,U,bpm,sect,events){
  vigT += dt; sceneT += dt; shake = Math.max(0, shake - dt*4);   // decay the swap impact (flash/shock decay in frame())
  if(!curGame) pickGame(U);
  else if(sect!==lastSect && lastSect!=='' && vigT>3){ vigT=0; remStage++; pickGame(U); }
  else if(vigT>10){ vigT=0; remStage++; pickGame(U); }
  lastSect = sect;
  g.fillStyle = '#000'; g.fillRect(0,0,W,H);
  const A = freeArea(U);
  const [ax,ay] = shakeXY(2); g.save(); g.translate(ax,ay);
  g.save(); g.beginPath(); g.rect(A.x,A.y,A.w,A.h); g.clip();
  let watchdogReset = null;
  if(curGame){ try { watchdogReset = runGame(curGame, curState, dt, U, A, events); }
    catch(e){ if(!curGame._err){ console.error('frame() failed:', curGame.name, e); } curGame._err=(curGame._err||0)+1;
      if(curGame._err>=3){ _markGameBroken(curGame, 'frame', e); pickGame(U); } } }
  g.restore(); g.restore();
  if(watchdogReset){ _markWatchdogReset(watchdogReset); pickGame(U); }
  // small corner tag — no game name, no score
  const top = Math.max(Math.round(U*5.5), Math.round(H*0.05));
  g.textBaseline='middle'; g.textAlign='left'; g.font='bold '+Math.round(top*0.46)+'px monospace';
  g.fillStyle='#f878f8'; g.fillText('REMIX', Math.round(U*1.4), Math.round(top*0.52));
  const rw = g.measureText('REMIX').width;
  g.fillStyle='rgba(255,255,255,0.78)'; g.fillText('· STAGE '+remStage, Math.round(U*1.4)+rw+Math.round(U), Math.round(top*0.52));
  g.textBaseline='alphabetic';
}

let lastFrame = performance.now();
/* ---------- PARTICLE FX: visible feedback for hovering + clicking (drawn over the scene) ---------- */
const PARTS = [];
function addPart(x,y,o){ o=o||{}; if(PARTS.length>260) return;
  PARTS.push({ x, y,
    vx:(o.vx!=null?o.vx:(Math.random()*2-1)*40),
    vy:(o.vy!=null?o.vy:-30-Math.random()*60),
    g:(o.g!=null?o.g:140),
    life:(o.life||0.55), max:(o.life||0.55),
    sz:(o.sz||3+Math.random()*3), col:(o.col||'#fff') }); }
// X = music density, Y = pitch (up=higher) — tint the trail by that pitch so the control reads visually.
function pitchHue(){ return Math.round(40 + (1-INP.y)*250); }   // bottom→warm, top→violet/blue
let _trailLast = -1e9;
function spawnTrail(){ if(performance.now()-_trailLast < 14) return; _trailLast = performance.now();
  addPart(INP.x*W, INP.y*H, { col:'hsl('+pitchHue()+',95%,'+(60+Math.round((1-INP.y)*14))+'%)',
    vx:(Math.random()*2-1)*24, vy:-18-Math.random()*32, life:0.5+Math.random()*0.3, sz:3.5+Math.random()*3.5, g:70 }); }
function spawnBurst(x,y,n,hue){ for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2, sp=70+Math.random()*170;
  addPart(x,y,{ col:'hsl('+(((hue!=null?hue:pitchHue())+(Math.random()*60-30))|0)+',95%,'+(62+Math.random()*18|0)+'%)',
    vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-30, life:0.5+Math.random()*0.45, sz:4.5+Math.random()*5, g:160 }); } }
function drawParts(dt){ for(let i=PARTS.length-1;i>=0;i--){ const p=PARTS[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=p.g*dt; p.life-=dt;
    if(p.life<=0){ PARTS.splice(i,1); continue; }
    const a=p.life/p.max, s=Math.max(1,Math.round(p.sz*(0.35+a*0.65)));
    g.globalAlpha=a; g.fillStyle=p.col; g.fillRect((p.x-s/2)|0,(p.y-s/2)|0,s,s); }
  g.globalAlpha=1; }

// ===== UNIVERSAL REACTOR FX — every scene kind reacts to the music bus (Audio.vis()), generated OR external (chip/mic).
//  Cheap by design (one transform + a couple of fills) so it never starves the audio scheduler. =====
let _rxBeat=-1, _rxDropCD=0, _rxHue=0;
let _diagLast=0, _transportDiagCount=0, _transportDiagBranch='';
function _markTransportDiag(branch){ _transportDiagCount++; _transportDiagBranch=branch||''; }
// drive the universal FX from the GRID phase (correct for BOTH generated and external via the keystone clock),
// not the source-specific beatPulse scale (generated musPulse peaks ~0.3, external ~1.0 — they aren't comparable).
function _currentFrameGrid(){
  var snd = _frameSND || (typeof Audio!=='undefined' && Audio.SND);
  try{ if(snd && snd.grid) return snd.grid(); }catch(e){}
  return null;
}
function _gridBeatPulse(RX){ if(RX&&RX.paused) return {gp:RX.beatPulse||0,bar:RX.bar||0};
  var gr=_currentFrameGrid();
  if(!gr) return {gp:0,bar:0}; var bphase=(((gr.gstep%4)+(gr.phase||0))/4); var gp=Math.max(0,1-bphase); return { gp:gp*gp, bar:gr.bar||0 }; }
// unified intensity: generated's vis().energy decays to 0 with no gameplay action, so fall back to energyLevel (the
// arrangement/analyser section energy) — this is what makes both sources scale the FX consistently.
function _uEnergy(RX){ return Math.max(RX.energy||0, (RX.energyLevel||0)/10); }
function _beatPump(RX){ g.save();                                  // beat zoom-punch — consistent across sources, stronger when energetic
  var amt=Math.min(0.018, _gridBeatPulse(RX).gp*(0.008 + _uEnergy(RX)*0.012));
  if(amt>0.0008){ g.translate(W/2,H/2); g.scale(1+amt,1+amt); g.translate(-W/2,-H/2); } }
// energy vignette — gradient CACHED and rebuilt only when size or (quantized) energy changes, not every frame
var _vigGrad=null, _vigKey='';
function _vignette(e){ var key=(W|0)+'x'+(H|0)+':'+Math.round(e*20);
  if(key!==_vigKey){ _vigKey=key; var vig=Math.max(0.12, 0.52 - e*0.34);
    _vigGrad=g.createRadialGradient(W/2,H/2, Math.min(W,H)*(0.30+e*0.20), W/2,H/2, Math.max(W,H)*0.74);
    _vigGrad.addColorStop(0,'rgba(0,0,0,0)'); _vigGrad.addColorStop(1,'rgba(0,0,0,'+vig.toFixed(3)+')'); }
  g.fillStyle=_vigGrad; g.fillRect(0,0,W,H); }
function _postFX(RX){
  var e=_uEnergy(RX), gp=_gridBeatPulse(RX).gp, bass=(RX.bands?RX.bands.bass:0);
  var bloom=Math.min(0.16, gp*(e*0.11 + bass*0.10));               // KICK BLOOM: brief additive lighten on the beat
  if(bloom>0.004){ g.save(); g.globalCompositeOperation='lighter'; g.globalAlpha=bloom; g.fillStyle='#fff'; g.fillRect(0,0,W,H); g.restore(); }
  _vignette(e);                                                    // ENERGY VIGNETTE: tight/calm when quiet, blooms open when loud
  var ma=0.04+e*0.06;                                              // MOOD WASH: faint whole-screen colour drifting with the music's hue (skip when imperceptible)
  if(ma>=0.03){ g.save(); g.globalCompositeOperation='overlay'; g.globalAlpha=ma; g.fillStyle='hsl('+(((RX.hue||0)*360)|0)+',70%,52%)'; g.fillRect(0,0,W,H); g.restore(); } }
function _reactorFX(RX, dt){
  _rxHue=(RX.hue||0); var gr=_currentFrameGrid(), beat=gr?gr.beat:0, e=_uEnergy(RX);
  // a small spark accent on each BEAT — tinted by the music hue, scaled by energy (constant liveliness)
  if(beat!==_rxBeat){ _rxBeat=beat; if(e>0.1){ var n=1+Math.round(e*4); spawnBurst(W*(0.2+Math.random()*0.6), H*(0.3+Math.random()*0.36), n, (_rxHue*360)|0); } }
  // DROP MOMENT: designed payoff when the analyser detects a real drop (cooldown keeps it special)
  if(_rxDropCD>0) _rxDropCD-=dt;
  if(RX.drop && _rxDropCD<=0){ _rxDropCD=3.5;
    flash=Math.min(1,flash+0.9); shock=0.85; shockColor=palColor((remStage*5+((_rxHue*12)|0))); flashColor=hexToRgb(shockColor);
    for(var i=0;i<3;i++) spawnBurst(W*(0.2+Math.random()*0.6), H*(0.25+Math.random()*0.5), 10+(Math.random()*8|0), (_rxHue*360+Math.random()*60)|0);
    // AUTO-VJ CUT: only RANDOM mode changes visuals on drops; fixed game selections must stay pinned.
    if(typeof randomMode!=='undefined' && randomMode && typeof sceneTimer!=='undefined' && sceneTimer>7){ sceneTimer=SCENE_TIME+1; }
    if(typeof vigT!=='undefined' && vigT>7){ vigT=11; } }
}
function _writeDiagnostics(RX, paused, now){
  var diag=(typeof location!=='undefined' && /[?&](diag|debug)\b/.test(location.search||''));
  if(typeof document==='undefined' || !document.documentElement || now-_diagLast<(diag?240:1000)) return;
  _diagLast=now;
  var d=document.documentElement.dataset, bands=(RX&&RX.bands)||{}, wf=(RX&&RX.waveform)||[], w=0;
  for(var i=0;i<wf.length;i++) w=Math.max(w, Math.abs(+wf[i]||0));
  var e=RX ? Math.max(RX.energy||0, bands.bass||0, bands.mid||0, bands.treble||0, w||0) : 0;
  d.rrrStation=String(typeof _station!=='undefined'?_station:'');
  d.rrrNowSource=String(typeof _nowSource!=='undefined'?_nowSource:'');
  d.rrrNow=String(typeof _curName!=='undefined'?_curName:'');
  d.rrrGame=String(selGame&&selGame.key||'');
  d.rrrGameCount=String(typeof CT_GAMES!=='undefined'?Object.keys(CT_GAMES).length:0);
  d.rrrStarted=String(!!(Audio&&Audio.started));
  d.rrrRunning=String(!!(Audio&&Audio.running&&Audio.running()));
  d.rrrPaused=String(!!paused);
  d.rrrAudioPaused=String(!!(Audio&&Audio.isPaused&&Audio.isPaused()));
  d.rrrCtxState=String(Audio&&Audio.audioCtx&&Audio.audioCtx()?Audio.audioCtx().state:'');
  d.rrrRadioPlaying=String(!!(typeof Radio!=='undefined'&&Radio.state&&Radio.state.playing));
  d.rrrTransportBranch=String(_transportDiagBranch||'');
  d.rrrTransportCount=String(_transportDiagCount||0);
  d.rrrBpm=String(RX&&RX.bpm||0);
  d.rrrSignal=e.toFixed(4);
  d.rrrIdle=String(!!(RX&&RX.idle));
  // LIVE broadcast state (the two-browser same-track smoke reads these)
  try{ var LD=(typeof LiveCtl!=='undefined')?LiveCtl.debug():null;
    d.rrrLive=String(!!(LD&&LD.active));
    d.rrrLiveToken=String((LD&&LD.token)||'');
    d.rrrLiveOffset=String(LD?LD.offsetSec:-1);
    d.rrrLiveListeners=String(typeof window._presenceCount==='number'?window._presenceCount:-1);
  }catch(eL){}
}
let _frameTarget = 16.7, _renderEMA = 6;        // aim for 60fps; adapt down only when rendering is genuinely heavy
let _wallpaperFpsCap = _WALLPAPER_MODE ? 30 : 0, _wallpaperPerformancePaused = false;
let _frameReq = 0, _frameSeq = 0, _frameStoppedAt = 0;
function _frameDiag(){
  return {
    active:!!_frameReq,
    seq:_frameSeq,
    audioOnly:!!_bgAudioOnly,
    stoppedAt:_frameStoppedAt,
    target:+_frameTarget.toFixed(1),
    cost:+_renderEMA.toFixed(2)
  };
}
function _scheduleFrameLoop(){
  if(_frameReq || _backgroundAudioOnlyActive()) return;
  _frameReq = requestAnimationFrame(frame);
  if(typeof window!=='undefined') window.__rrrFrame = _frameDiag();
}
function _stopFrameLoop(){
  if(_frameReq){ try{ cancelAnimationFrame(_frameReq); }catch(e){} _frameReq = 0; }
  _frameStoppedAt = _nowMs();
  if(typeof window!=='undefined') window.__rrrFrame = _frameDiag();
}
function frame(now){
  _frameReq = 0;
  _frameSeq++;
  // MUSIC IS THE PRIORITY: the visuals/game are secondary. Do NO rendering work while the tab is hidden (the music
  // keeps playing off the worker-driven audio scheduler), and CAP the frame rate so the render can't starve the
  // audio scheduler (they share the main thread). When frames run heavy (busy CPU), we back the visuals off further.
  if(_syncBackgroundAudioOnly()){ lastFrame = now; return; }
  _scheduleFrameLoop();
  if(now - lastFrame < _frameTarget - 1) return;   // FPS cap -> yield the main thread to audio scheduling
  const _t0 = now;
  const dt = Math.max(0, Math.min(0.05,(now-lastFrame)/1000)); lastFrame = now;
  const paused = (typeof _transportIsPaused==='function' && _transportIsPaused());
  const simDt = paused ? 0 : dt;
  if(paused){
    if(typeof INP!=='undefined') INP.clickPulse = false;
    shake = 0; flash = 0; shock = 0;
  }
  const U = Math.max(4, Math.round(Math.min(W,H)/100));
  if(_reseatScene){ _reseatScene=false;                    // returned from a long background stint: rebuild the scene so it plays live (no fast-forward catch-up)
    if(sceneKind==='game' && selGame){ try{ selState = selGame.make(fullArea(U), U, selVar); }catch(e){ selState = selState||{}; } } }
  const silentWatch = !!(_watchOnly && !_watchMicActive);
  const cur = (Audio.started && !silentWatch) ? Audio.current() : null;
  const bpm = cur?cur.bpm:120, sect = cur?cur.sect:'verse';
  const events = (!paused && Audio.started && !silentWatch) ? Audio.consumeEvents() : [];
  // HARD-RESET the context each frame: unwind any unbalanced save()/translate()/clip() a game
  // module may have leaked, then restore the base transform — so nothing accumulates across frames.
  for(let i=0;i<8;i++) g.restore();
  g.setTransform(DPR,0,0,DPR,0,0); g.globalAlpha = 1;
  const RX = (Audio.started && Audio.vis && !silentWatch) ? Audio.vis() : null;   // the music bus, read ONCE per frame
  _frameRX = RX;
  _frameSND = silentWatch ? watchClockSND()                                       // watch mode: wall-clock grid, games play FULLY, no AudioContext
            : (paused ? quietPausedSND() : makeCachedFrameSND(Audio && Audio.SND, RX));
  _writeDiagnostics(RX, paused, now);
  if(RX && !paused) _beatPump(RX);                                // no camera pump while paused; games may still draw subtle idle state
  (sceneKind === 'game' ? scnGame : scnAbs)(simDt,U,bpm,sect,events);
  if(RX){ g.restore(); g.setTransform(DPR,0,0,DPR,0,0); g.globalAlpha=1;
    if(paused){ _vignette(0.16); }
    else if(RX.idle && !RX.paused){ _vignette(0.16); } else { _postFX(RX); if(!RX.paused) _reactorFX(RX, dt); } }   // paused is a calm held frame; no gameplay/drop spawns
  if(typeof INP!=='undefined') INP.clickPulse = false;     // one click = one frame's action
  if(shock>0.01){ const r=(1-shock)*Math.hypot(W,H)*0.6; g.globalAlpha=shock; g.strokeStyle=shockColor; g.lineWidth=Math.max(2,22*shock);
    g.beginPath(); g.arc(W/2,H/2,r,0,Math.PI*2); g.stroke(); g.globalAlpha=1; shock=Math.max(0,shock-dt*2.2); }
  if(flash>0.01){ g.fillStyle=`rgba(${flashColor},${0.10*flash})`; g.fillRect(0,0,W,H); flash=Math.max(0,flash-dt*3); }
  if(!paused) drawParts(dt);
  // adaptive: prefer smooth 60fps visuals; back off to ~42/30fps only when drawing cost threatens audio headroom.
  const _cost = (typeof performance!=='undefined'&&performance.now?performance.now():now) - _t0;
  _renderEMA += (_cost - _renderEMA) * 0.1;
  var adaptiveTarget = (_renderEMA > 24) ? 33 : (_renderEMA > 15 ? 24 : 16.7);
  _frameTarget = Math.max(adaptiveTarget, _wallpaperFpsCap ? 1000/_wallpaperFpsCap : 0);
  if(typeof window!=='undefined') window.__rrrFrame = _frameDiag();
  _frameRX = null; _frameSND = null;
}
_scheduleFrameLoop();
function _applyWallpaperPerformance(state){
  if(!_WALLPAPER_MODE || !state) return;
  var wasPaused=_wallpaperPerformancePaused;
  _wallpaperPerformancePaused=!!state.paused;
  var cap=Number(state.fpsCap);
  if(isFinite(cap) && cap>0) _wallpaperFpsCap=Math.max(1,Math.min(60,cap));
  window.__rrrWallpaperPerformance={paused:_wallpaperPerformancePaused,fpsCap:_wallpaperFpsCap,reason:String(state.reason||'')};
  if(document.documentElement){
    document.documentElement.dataset.rrrWallpaperPaused=_wallpaperPerformancePaused?'1':'0';
    document.documentElement.dataset.rrrWallpaperFps=String(_wallpaperFpsCap);
    document.documentElement.dataset.rrrWallpaperReason=String(state.reason||'');
  }
  if(_wallpaperPerformancePaused){
    _stopFrameLoop();
    // Actually SUSPEND the audio DSP (worklet + AudioContext) rather than only muting output, so a
    // covered/asleep wallpaper stops computing audio too. Only the audio-owner window runs a graph.
    if(_WALLPAPER_AUDIO){ try{ if(Audio&&Audio.setPlaying) Audio.setPlaying(false); }catch(e){} }
  } else {
    lastFrame=_nowMs();
    _scheduleFrameLoop();
    if(wasPaused){
      if(_WALLPAPER_AUDIO){ try{ if(Audio&&Audio.setPlaying) Audio.setPlaying(true); }catch(e){} }
      try{ if(Audio&&Audio.resume) Audio.resume(false); }catch(e){}
    }
  }
}
if(_WALLPAPER_MODE && window.RRRNative && window.RRRNative.onWallpaperPerformance){
  try{ window.RRRNative.onWallpaperPerformance(_applyWallpaperPerformance); }catch(e){}
}
// On return-to-foreground, re-anchor the frame clock so the first frame's dt is normal AND (if we were away long enough that the
// grid clock ran far ahead) flag the scene to re-seat — otherwise the game replays every missed beat-step in a visible fast-forward.
document.addEventListener('visibilitychange', ()=>{
  if(_syncBackgroundAudioOnly()){ _hiddenAt = _nowMs(); _syncWakeLock(); return; }
  const away = _hiddenAt ? _nowMs()-_hiddenAt : 0;
  lastFrame = _nowMs();
  if(Audio.resume) Audio.resume();                                                    // make sure the context didn't stay suspended
  try{ if(_silentEl) { const p=_silentEl.play(); if(p&&p.catch) p.catch(()=>{}); } }catch(e){}   // keep the media-playing flag alive
  if(_pendingVisualRefresh){ _pendingVisualRefresh=false; try{ _deriveGame(_curSlug); }catch(e){} }
  if(away > 1500 && sceneKind==='game' && selGame && selState) _reseatScene = true;   // >1.5s away -> ignore the gap, restart the scene live
  _hiddenAt = 0;
  _syncWakeLock();
});
window.addEventListener('blur', function(){
  if(!_hiddenAt) _hiddenAt = _nowMs();
  _syncBackgroundAudioOnly();
  _syncWakeLock();
});
window.addEventListener('focus', function(){
  if(_syncBackgroundAudioOnly()){ _syncWakeLock(); return; }
  const away = _hiddenAt ? _nowMs()-_hiddenAt : 0;
  lastFrame = _nowMs();
  if(Audio.resume) Audio.resume();
  try{ if(_silentEl) { const p=_silentEl.play(); if(p&&p.catch) p.catch(()=>{}); } }catch(e){}
  if(_pendingVisualRefresh){ _pendingVisualRefresh=false; try{ _deriveGame(_curSlug); }catch(e){} }
  if(away > 1500 && sceneKind==='game' && selGame && selState) _reseatScene = true;
  _hiddenAt = 0;
  _syncWakeLock();
});
window.addEventListener('pagehide', function(){ _releaseWakeLock(); });
window.addEventListener('pageshow', function(){ _syncWakeLock(); });

/* ============================================================
   INTERACTION
   ============================================================ */
const clamp = (v,a,b)=> v<a?a : v>b?b : v;

// ---------- INPUT: click/drag + keyboard drive the game character ----------
// HOVER does nothing (moving the mouse never takes over) · click/drag OR a key = engage player control.
// Space/J/K are global transport. Arrows/WASD steer the game; Control is the game action.
// idle ~1.5s -> the game's autopilot resumes. NO tap-tempo — input drives the GAME, the game drives the pace, the pace the sound.
const INP = { x:0.5, y:0.5, down:false, clickPulse:false, keys:Object.create(null), lastActive:-1e9 };
// DIRECTIONAL-ONLY controls: arrows or WASD, nothing else. Every game maps its
// actions to a direction or automates them — no action/Ctrl key exists.
const KEYMAP = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down',
  KeyA:'left', KeyD:'right', KeyW:'up', KeyS:'down' };
function shortcutTargetBlocked(ev){
  var el=ev&&ev.target;
  if(!el) return false;
  if(el.closest && el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],[data-shortcuts-off]')) return true;
  var tag=el.tagName;
  return !!(el.isContentEditable || tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT');
}
function consumeKeyEvent(ev){
  ev.preventDefault();
  ev.stopPropagation();
  if(ev.stopImmediatePropagation) ev.stopImmediatePropagation();
}
function handleTransportShortcut(ev){
  if(shortcutTargetBlocked(ev) || ev.metaKey || ev.altKey || ev.ctrlKey) return false;
  if(ev.code!=='Space' && ev.code!=='KeyJ' && ev.code!=='KeyK') return false;
  ev.preventDefault();
  if(_watchOnly && !_watchMicActive) return true;
  if(ev.code==='KeyJ'){ _transportPrev(); return true; }
  if(ev.code==='KeyK'){ _transportNext(); return true; }
  if(intro && !intro.classList.contains('hidden')) startAudio(true);
  else _transportToggle();
  return true;
}
function panelVisible(id){
  var el=document.getElementById(id);
  return !!(el && el.style.display!=='none' && !el.hidden && !el.classList.contains('hidden'));
}
function playbarMenuVisible(){ return !!(_pbMenuEl && _pbMenuEl.classList.contains('show')); }
function handleEscapeShortcut(ev){
  if(!ev || ev.key!=='Escape' || shortcutTargetBlocked(ev) || ev.metaKey || ev.altKey || ev.ctrlKey) return false;
  if(playbarMenuVisible()){ _closePlaybarMenu(); consumeKeyEvent(ev); return true; }
  if(panelVisible('trackpanel') && window.closeTrackPanel){ window.closeTrackPanel(); consumeKeyEvent(ev); return true; }
  if(panelVisible('mixpanel') && window.closeMixPanel){ window.closeMixPanel(); consumeKeyEvent(ev); return true; }
  if(gamePickerVisible()){ closeGamePicker(); consumeKeyEvent(ev); return true; }
  if(_welcomeModalVisible()){ closeWelcomeModal(); consumeKeyEvent(ev); return true; }
  if(window.toggleWelcomeModal){ window.toggleWelcomeModal(); consumeKeyEvent(ev); return true; }
  return false;
}
// position ONLY — moving the mouse must NOT take over gameplay or the music (no engage here).
function setPos(cx,cy){ INP.x=Math.max(0,Math.min(1,cx/W)); INP.y=Math.max(0,Math.min(1,cy/H)); }
// ENGAGE player control — ONLY a click/drag or a key does this: opens the "active" input window for the game.
function engage(){ INP.lastActive=performance.now(); }
// per-frame input view handed to a converted game's frame(); harness clears .click after each frame.
function buildIN(A){
  const now=performance.now(), ax=INP.x*W, ay=INP.y*H;
  return { x:INP.x, y:INP.y, ax, ay,
    lx:Math.max(A.x,Math.min(A.x+A.w,ax)), ly:Math.max(A.y,Math.min(A.y+A.h,ay)),
    down:INP.down, click:INP.clickPulse, keys:INP.keys, active:(now-INP.lastActive)<1500 };
}
// ----- TikTok gestures: DOUBLE-TAP = heart · SWIPE UP = skip (the whole scene scrolls with the finger) -----
const _gest={x0:0,y0:0,swiping:false,committed:false,dy:0}; let _lastTapT=0,_lastTapX=0,_lastTapY=0, _sceneAnim=false, _suppressSceneInputUntil=0;
function setSceneY(px){ cv.style.transition='none'; cv.style.transform='translateY('+px+'px)'; }
function snapSceneBack(){ cv.style.transition='transform .22s cubic-bezier(.2,.8,.3,1)'; cv.style.transform='translateY(0)'; setTimeout(()=>{ cv.style.transition='none'; cv.style.transform=''; },240); }
function commitSkip(dir){ dir=dir||1; var off=(dir>0?-H:H); _sceneAnim=true; cv.style.transition='transform .17s ease-in'; cv.style.transform='translateY('+off+'px)';   // current scene slides off in the swipe direction
  setTimeout(()=>{ if(dir>0) _transportNext(); else _transportPrev();    // swipe UP = next track, swipe DOWN = previous (exact)
    cv.style.transition='none'; cv.style.transform='translateY('+(-off)+'px)';                    // park the new scene on the opposite side
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ cv.style.transition='transform .28s cubic-bezier(.2,.8,.3,1)'; cv.style.transform='translateY(0)';   // slide the new scene into view
      setTimeout(()=>{ _sceneAnim=false; cv.style.transition='none'; cv.style.transform=''; },300); })); }, 170); }
function sceneGesturesBlocked(ev){
  var intro=document.getElementById('intro');
  if(intro && intro.style.display!=='none' && !intro.classList.contains('hidden')) return true;
  var t=ev&&ev.target;
  return !!(t && t.closest && t.closest('#gamepick,#watchbar,#trackpanel,#mixpanel,#presets,#transport,#playbar,#rlist,#rfullscreen,#rmic,#intro,#hometiles,.lib-nav,.detail'));
}
// TRACKPAD / wheel: a decisive two-finger vertical swipe changes the track (either direction), animating the scene the way you swiped.
let _whAcc=0, _whCool=false, _whTimer=0;
window.addEventListener('wheel', function(ev){
  if(_whCool || _sceneAnim) return;
  if(sceneGesturesBlocked(ev)){ _whAcc=0; return; }   // let library pages, panels, and controls scroll normally
  _whAcc += ev.deltaY;
  clearTimeout(_whTimer); _whTimer=setTimeout(()=>{ _whAcc=0; }, 170);                            // reset if the gesture pauses (so only a real swipe accumulates)
  if(Math.abs(_whAcc) > 90){ var dir=(_whAcc>0?1:-1); _whAcc=0; _whCool=true; commitSkip(dir);     // deltaY>0 (two-finger swipe up, natural scroll) -> slide up; down -> slide down
    setTimeout(()=>{ _whCool=false; }, 650); }                                                    // one change per fling
}, {passive:true});
cv.addEventListener('pointerdown', e=>{ if(sceneGesturesBlocked(e)) return;
  if(performance.now() < _suppressSceneInputUntil) return;
  if(_watchOnly && !_watchMicActive){
    setPos(e.clientX,e.clientY);
    _gest.x0=e.clientX; _gest.y0=e.clientY; _gest.swiping=false; _gest.committed=false; _gest.dy=0;
    INP.down=true; INP.clickPulse=true; engage();
    return;
  }
  const pausedGesture = _transportUserPaused();
  if(!pausedGesture){ startAudio(true); Audio.resume(true); unlockAudioSession(); }
  const nt=performance.now();
  if(nt-_lastTapT<320 && Math.abs(e.clientX-_lastTapX)<48 && Math.abs(e.clientY-_lastTapY)<48){ doHeart(); _lastTapT=0; }   // DOUBLE-TAP -> heart (giant, centred)
  else { _lastTapT=nt; _lastTapX=e.clientX; _lastTapY=e.clientY; }
  if(pausedGesture){ INP.down=false; INP.clickPulse=false; return; }
  _gest.x0=e.clientX; _gest.y0=e.clientY; _gest.swiping=false; _gest.committed=false; _gest.dy=0;
  INP.down=true; INP.clickPulse=true; setPos(e.clientX,e.clientY); engage();
  spawnBurst(e.clientX, e.clientY, 14);                 // click = visible particle burst
  shake = Math.min(1, shake + 0.7);                     // click also shakes the screen (like the beat hits)
});   // click / drag = engage player control (tap-tempo removed)
cv.addEventListener('pointermove', e=>{
  if(sceneGesturesBlocked(e)) return;
  if(INP.down && !_gest.committed){
    const dy=_gest.y0 - e.clientY, dx=e.clientX-_gest.x0;                                          // dy>0 = UP (next) · dy<0 = DOWN (prev)
    if(!_gest.swiping && Math.abs(dy)>46 && Math.abs(dy)>Math.abs(dx)*1.4){ _gest.swiping=true; }   // enter SKIP-swipe -> stop steering the game
    if(_gest.swiping){ _gest.dy=dy; setSceneY(-Math.max(-H,Math.min(H, dy*0.92))); return; }       // scene follows the finger (either direction)
  }
  setPos(e.clientX,e.clientY); spawnTrail(); if(INP.down) engage();                                // hover = trail; drag = engage
});
const _up=()=>{ if(_gest.swiping && !_gest.committed){ _gest.committed=true;                       // release a swipe -> next/prev if far enough, else snap back
    if(Math.abs(_gest.dy) > Math.min(H*0.16, 150)) commitSkip(_gest.dy>0?1:-1); else snapSceneBack(); _gest.swiping=false; }
  INP.down=false; };
cv.addEventListener('pointerup',_up); cv.addEventListener('pointercancel',_up); cv.addEventListener('pointerleave',_up);
window.addEventListener('keydown', e=>{
  if(handleEscapeShortcut(e)) return;
  if(handleTransportShortcut(e)) return;
  if(shortcutTargetBlocked(e)) return;
  if(!e.metaKey && !e.altKey && !e.ctrlKey && e.code==='KeyG'){
    e.preventDefault();
    if(typeof toggleGamePicker==='function') toggleGamePicker();
    return;
  }
  const act=KEYMAP[e.code]; if(!act) return;
  e.preventDefault();
  if(intro && !intro.classList.contains('hidden')){ startAudio(); return; }
  if(!e.repeat) INP.keys[act]=true;
  INP.lastActive=performance.now();
});
window.addEventListener('keyup', e=>{ const act=KEYMAP[e.code]; if(act) INP.keys[act]=false; });

/* ============================================================
   UI / startup
   ============================================================ */
const intro = document.getElementById('intro');
const hud = document.getElementById('hud');
const presetsBar = document.getElementById('presets');
const trackEl = document.getElementById('trackname');
const transportEl = document.getElementById('transport');
let bootDone = false;

// ===== 8-bit Zelda heart (shared icon) + TikTok-style flying-heart animation =====
function heartSVG(px){
  var P=px||30, grid=['01100110','13311221','13222221','12222221','01222210','00122100','00011000'],
      col={'1':'#5a0a18','2':'#ff2b43','3':'#ffb3c0'}, r='';
  for(var y=0;y<grid.length;y++) for(var x=0;x<8;x++){ var c=grid[y].charAt(x); if(c!=='0') r+='<rect x="'+x+'" y="'+y+'" width="1.03" height="1.03" fill="'+col[c]+'"/>'; }
  return '<svg width="'+P+'" height="'+Math.round(P*7/8)+'" viewBox="0 0 8 7" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">'+r+'</svg>';
}
function heartOutlineSVG(px){
  var P=px||30, grid=['01100110','10011001','10000001','10000001','01000010','00100100','00011000'], r='';
  for(var y=0;y<grid.length;y++) for(var x=0;x<8;x++){ if(grid[y].charAt(x)==='1') r+='<rect x="'+x+'" y="'+y+'" width="1.03" height="1.03" fill="currentColor"/>'; }
  return '<svg width="'+P+'" height="'+Math.round(P*7/8)+'" viewBox="0 0 8 7" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">'+r+'</svg>';
}
function setPlaybarHeartLiked(btn, liked){
  if(!btn) return;
  liked=!!liked;
  btn.classList.toggle('liked', liked);
  btn.title=liked?'Unlike':'Like';
  btn.setAttribute('aria-pressed', liked?'true':'false');
  if(btn._likedIconState===liked) return;
  btn._likedIconState=liked;
  btn.innerHTML=liked?heartSVG(20):heartOutlineSVG(20);
}
let _heartsEl=null; function heartsLayer(){ return _heartsEl||(_heartsEl=document.getElementById('hearts')); }
function spawnRiseHeart(x,y,size,dx,delay,dur){ const L=heartsLayer(); if(!L) return;
  const d=document.createElement('div'); d.className='fheart'; d.style.left=x+'px'; d.style.top=y+'px';
  d.style.setProperty('--rot',(Math.random()*44-22)+'deg'); d.style.setProperty('--dx',(dx||0)+'px');
  d.innerHTML=heartSVG(size); d.style.animation='heartRise '+(dur||1.4)+'s cubic-bezier(.3,.7,.4,1) '+(delay||0)+'s forwards';
  L.appendChild(d); d.addEventListener('animationend',()=>d.remove()); }
function bigHeartPop(){ const L=heartsLayer(); if(!L) return;
  const d=document.createElement('div'); d.className='fheart pop'; d.style.left='50%'; d.style.top='50%';   // dead-centre on the viewport
  d.innerHTML=heartSVG(Math.round(0.9*Math.min(window.innerWidth, window.innerHeight)));                   // ~90% of the screen
  d.style.animation='heartPop .9s ease-out forwards';
  L.appendChild(d); d.addEventListener('animationend',()=>d.remove()); }
// LIKE: double-tap/current heart always likes the specific current item; the playbar button can still toggle unlike.
function doHeart(){ var it=(typeof _curItem==='function') ? _curItem() : null;
  if(it && window._isLiked && window._likeToggle){ if(!_isLiked(it)) _likeToggle(it); }
  else if(typeof Radio!=='undefined' && Radio.thumbUp) Radio.thumbUp();
  if(typeof _heartBurstVisual==='function') _heartBurstVisual(); else bigHeartPop();
  var hb=document.getElementById('rheart'); if(hb){ hb.classList.add('act'); setTimeout(()=>hb.classList.remove('act'),420); }
  if(typeof _updatePlaybar==='function') _updatePlaybar(); }
window.doHeart=doHeart;

// ===== clean monochrome SVG icons (NO emoji — render identically on every OS, inherit currentColor) =====
const ICONS = {
  skip:    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 6 L11.5 12 L4 18 Z"/><path d="M11 6 L18.5 12 L11 18 Z"/><rect x="18.6" y="6" width="2.4" height="12" rx="1"/></svg>',
  dislike: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>',
  mixer:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/><circle cx="16" cy="7" r="2.6" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="2.6" fill="currentColor" stroke="none"/></svg>',
  menu:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>',
  more:    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/></svg>',
  fullscreen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5"/><path d="M3 3l7 7"/><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/><path d="M16 21h5v-5"/><path d="M21 21l-7-7"/></svg>',
  share:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="8 7 12 3 16 7"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  play:    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5 L19 12 L7 19 Z"/></svg>',
  pause:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>',
  home:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  mic:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/></svg>',
  radio:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="3"/><path d="M4.5 7.5a11 11 0 0 1 15 0"/><path d="M7 10a7 7 0 0 1 10 0"/></svg>',
  cart:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><line x1="9" y1="3" x2="9" y2="8"/><line x1="12" y1="3" x2="12" y2="8"/><rect x="9" y="15" width="6" height="3"/></svg>',
  listAdd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="14" y2="6"/><line x1="4" y1="12" x2="12" y2="12"/><line x1="4" y1="18" x2="10" y2="18"/><line x1="17" y1="11" x2="17" y2="21"/><line x1="12" y1="16" x2="22" y2="16"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 7h3c2.2 0 3.4 1.1 4.8 3.2l.4.6"/><path d="M16 21h5v-5"/><path d="M4 17h3c2.2 0 3.4-1.1 4.8-3.2l3.4-5.6C16.6 6.1 17.8 5 20 5h1"/><path d="M16.5 19H20"/></svg>',
  cloud:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.4A4 4 0 0 1 18 18z"/></svg>',
  spark:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>',
  note:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17V4l9-2v3"/><ellipse cx="7.4" cy="17" rx="2.8" ry="2.2" fill="currentColor" stroke="none"/><ellipse cx="16.4" cy="15" rx="2.8" ry="2.2" fill="currentColor" stroke="none"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6 L15 12 L9 18"/></svg>',
  chevUp:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 15 L12 8 L19 15"/></svg>',
  chevDown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9 L12 16 L19 9"/></svg>',
  spkOn:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9H7l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  spkOff:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9H7l5-4v14l-5-4H4z" fill="currentColor"/><line x1="16" y1="9" x2="21" y2="15"/><line x1="21" y1="9" x2="16" y2="15"/></svg>'
};
function svgIcon(name){ return ICONS[name]||''; }

// ===== track TOKEN = the SEED = the shareable URL. Song.mint() -> '<phrase>-<code8>'.
//  Tokens minted under a NON-default composer carry its id: '<composerId>.<phrase>-<code8>' — deep links stay
//  deterministic per composer. There are no target/idiom prefixes anymore. =====
function _slugify(name){ return (typeof Song!=='undefined'&&Song.slugify) ? Song.slugify(name) : String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function _tokenBody(tok){ var s=String(tok||''), i=s.indexOf('.'); return i>0 ? s.slice(i+1) : s; }
function _deslug(slug){ var body=_tokenBody(slug);
  return (typeof Song!=='undefined'&&Song.title) ? Song.title(body) : String(body||'').split('-').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ') || 'Retro Rave Radio'; }

// ===== GENERATED QUEUE — composer-agnostic. Mint K=8 candidates, fingerprint each through the ACTIVE composer
//  (pure stages A–C: cheap, no audio), score them against what just played, take the argmax. This ONE mechanism
//  replaces the old idiom/quality-target/recency plumbing. Selection is deterministic given the minted candidates. =====
var _fpHist=[];                 // fingerprints of the generated tracks that actually PLAYED (novelty distance, max 4)
var _genArcPos=0;               // pacing-arc position: alternating hot/medium energy targets + a cooldown every ~5 tracks
function _activeComposerSafe(){ try{ return (typeof activeComposer==='function') ? activeComposer() : null; }catch(e){ return null; } }
function _mintComposerToken(){
  var body=(typeof Song!=='undefined'&&Song.mint) ? Song.mint() : ('mix-'+(Date.now()>>>0).toString(36));
  var cid=''; try{ cid=(typeof Packs!=='undefined'&&Packs.activeComposerId) ? String(Packs.activeComposerId()||'') : ''; }catch(e){}
  return (cid && cid!=='rrr_core') ? cid+'.'+body : body;
}
function _fingerprintToken(tok){
  var c=_activeComposerSafe();
  if(!c || !c.fingerprint) return null;
  try{ return c.fingerprint(tok)||null; }catch(e){ return null; }
}
// bucket the fingerprint onto Radio's learned axes (KNOBS: tempoBand/brightness/grooveFamily/waveClass/energy)
function _radioAxes(fp){
  if(!fp) return null;
  var bpm=+fp.bpm||0, br=+fp.brightness||0, ep=+fp.energyPeak||0;
  return {
    tempoBand: bpm<105?'slow':bpm<130?'mid':bpm<155?'fast':'hyper',
    brightness: br<0.34?'dark':br<0.67?'mid':'bright',
    grooveFamily: fp.grooveFamily||'',
    waveClass: fp.waveClass||'',
    energy: ep<6.5?'low':ep<8.25?'mid':'high',
    mood: fp.leadMode||''
  };
}
function _fpDistance(a,b){                                   // normalized mean axis distance in [0,1]
  if(!a||!b) return 1;
  var d=0, n=0, push=function(x){ d+=Math.max(0,Math.min(1,x)); n++; };
  push(Math.abs((+a.bpm||0)-(+b.bpm||0))/96);
  var kd=Math.abs((+a.keyPc||0)-(+b.keyPc||0)); push(Math.min(kd,12-kd)/6);
  push(Math.abs((+a.brightness||0)-(+b.brightness||0)));
  push(a.waveClass===b.waveClass?0:1);
  push(a.grooveFamily===b.grooveFamily?0:1);
  push(Math.abs((+a.density||0)-(+b.density||0)));
  push(Math.abs((+a.energyPeak||0)-(+b.energyPeak||0))/10);
  push(Math.abs((+a.echoDepth||0)-(+b.echoDepth||0)));
  push((a.leadMode||'full')===(b.leadMode||'full')?0:1);   // mood alternation counts as novelty
  return n?d/n:1;
}
function _minNoveltyDistance(fp){
  if(!_fpHist.length) return 1;
  var m=1;
  for(var i=Math.max(0,_fpHist.length-4); i<_fpHist.length; i++) m=Math.min(m,_fpDistance(fp,_fpHist[i]));
  return m;
}
function _pacingTarget(pos){
  if(pos%5===4) return [4.5,6.5];                            // cooldown every ~5 tracks
  return (pos%2===0) ? [7,9] : [5,7];                        // alternate hot / medium
}
function _pacingFit(fp,pos){
  if(!fp) return 0;
  var t=_pacingTarget(pos), e=+fp.energyPeak||0;
  var out=e<t[0]?(t[0]-e):(e>t[1]?(e-t[1]):0);
  return Math.max(0,1-out/3);
}
function _tempoFit(fp){                                      // soft |Δbpm|<=16 neighborhood vs the last played track
  var last=_fpHist.length?_fpHist[_fpHist.length-1]:null;
  if(!fp||!last||!last.bpm) return 1;
  var d=Math.abs((+fp.bpm||0)-(+last.bpm||0));
  return d<=16 ? 1 : Math.max(0, 1-(d-16)/48);
}
function _biasScore(fp){
  if(!fp || typeof Radio==='undefined' || !Radio.bias) return 0;
  var ax=_radioAxes(fp), s=0;
  if(!ax) return 0;
  for(var k in ax){ if(ax[k]!=null && ax[k]!==''){ try{ s+=(+Radio.bias(k, ax[k])||0); }catch(e){} } }
  return s;
}
function _nextGeneratedToken(){
  // Mood pinning: when Radio.mood() names a lead-presence genre ('full' hook-
  // driven / 'sparse' occasional color / 'none' instrumental), only matching
  // candidates compete; mint deeper to find them. 'any' = the default mix —
  // the composer samples the three genres per token and novelty scoring (fp
  // leadMode axis) keeps them alternating.
  var mood=null; try{ mood=(typeof Radio!=='undefined'&&Radio.mood)?Radio.mood():null; }catch(e){}
  if(mood==='any') mood=null;
  var K=mood?28:8, best=null, bestScore=-1e9, bestAny=null, bestAnyScore=-1e9, matched=0;
  for(var i=0;i<K;i++){
    var tok=_mintComposerToken(), fp=_fingerprintToken(tok);
    if(!fp){ if(!bestAny) bestAny=tok; continue; }           // no composer fingerprint available: first mint wins
    var s = 1.6*_minNoveltyDistance(fp) + 1.2*_pacingFit(fp,_genArcPos) + 0.8*_biasScore(fp) + 0.6*_tempoFit(fp);
    if(s>bestAnyScore){ bestAnyScore=s; bestAny=tok; }
    if(mood && (fp.leadMode||'full')!==mood) continue;
    matched++;
    if(s>bestScore){ bestScore=s; best=tok; }
    if(!mood && matched>=8) break;
  }
  _genArcPos++;
  return best || bestAny || _mintComposerToken();
}
function _mintToken(){ return _nextGeneratedToken(); }       // the fresh-track mint every auto-advance/skip path uses
function _noteGeneratedPlaying(tok){                          // a generated track is NOW playing: log fp for novelty + Radio learning
  var fp=_fingerprintToken(tok);
  if(!fp) return;
  _fpHist.push(fp); while(_fpHist.length>4) _fpHist.shift();
  try{ if(typeof Radio!=='undefined'&&Radio.setCurrent) Radio.setCurrent(Object.assign({token:tok}, fp, _radioAxes(fp)||{})); }catch(e){}
}
let _trkHist=[], _trkI=-1;                                                          // session history of slugs (for prev/next)
let _queue=null, _queueI=-1;                                                        // active PLAYLIST queue: generated items
function _pushHist(s){ _trkHist.length=_trkI+1; _trkHist.push(s); _trkI=_trkHist.length-1; return s; }
function _queueItem(it){ if(!it) return null;
  if(typeof it==='string') return {kind:'gen',slug:it,name:_deslug(it)};
  if(!it.kind && it.slug) return Object.assign({kind:'gen'}, it);
  return Object.assign({}, it);
}
function _clearPlaybackQueue(){ _queue=null; _queueI=-1; }
window._clearPlaybackQueue=_clearPlaybackQueue;
function _setPlaybackQueue(items, idx, opts){
  opts=opts||{};
  var arr=(items||[]).map(_queueItem).filter(function(it){ return it && _itemKey(it); });
  if(!arr.length){ _clearPlaybackQueue(); return false; }
  idx=Math.max(0, Math.min(idx|0, arr.length-1));
  if(opts.shuffle){
    var first=arr[idx], rest=arr.filter(function(_,i){ return i!==idx; });
    arr=[first].concat(_shuffle(rest)); idx=0;
  }
  _queue=arr; _queueI=idx; return true;
}
function _playQueueAt(idx){
  if(!_queue||!_queue.length) return false;
  idx=Math.max(0, Math.min(idx|0, _queue.length-1)); _queueI=idx;
  return _playListItem(_queue[_queueI], {keepQueue:true, fromQueue:true});
}
function _advanceQueue(delta){
  if(!_queue||!_queue.length) return false;
  var ni=_queueI+(delta||1);
  if(ni<0) return false;
  if(ni>=_queue.length){ _clearPlaybackQueue(); return true; }
  return _playQueueAt(ni);
}
// engine asks for the NEXT generated track's name. If the active playlist's next item is generated, return its slug.
// Advance within the generated queue; otherwise fall back to random radio.
function _radioMint(){ var s;
  // LIVE: the shared schedule supplies every auto-advance (before the playlist queue — live
  // and queues are mutually exclusive by construction, but live must win if both ever set).
  if(typeof LiveCtl!=='undefined' && LiveCtl.active()){
    var lt=LiveCtl.nextToken();
    if(lt) return _pushHist(lt);
  }
  if(_queue && _queueI+1 < _queue.length){
    var next=_queue[_queueI+1];
    if(next && (next.kind==='gen'||next.slug) && next.slug){ _queueI++; s=next.slug; }
    else { s=_curSlug || _mintToken(); setTimeout(function(){ _advanceQueue(1); },0); }
  }
  else { s=_mintToken(); _clearPlaybackQueue(); }
  return _pushHist(s); }
function playFromList(slugs, idx){
  slugs=(slugs||[]).filter(Boolean); if(!slugs.length) return;
  if(_setPlaybackQueue(slugs.map(function(s){ return {kind:'gen',slug:s}; }), idx)) _playQueueAt(_queueI); }
function _radioPrefsBackfill(kind){ return kind==='liked'?((Radio.prefs&&Radio.prefs.likes)||[])
  : kind==='recent'?((Radio.prefs&&Radio.prefs.recent)||[])
  : kind==='disliked'?((Radio.prefs&&Radio.prefs.dislikes)||[]) : []; }
function _itemKey(it){ if(!it) return ''; if(window._libraryItemId) return _libraryItemId(it);
  if(it.kind==='gen'||it.slug) return 'g:'+(it.slug||'');
  return ''; }
function _playlistItems(kind){
  var out=[], seen={};
  function add(it){ if(!it) return; if(!it.kind && it.slug) it=Object.assign({kind:'gen'}, it);
    var k=_itemKey(it); if(!k || seen[k]) return; seen[k]=1; out.push(it); }
  if(/^pl:/.test(kind||'') && window._libraryPlaylistItems){
    var name=''; try{ name=decodeURIComponent(String(kind).slice(3)); }catch(e){ name=String(kind).slice(3); }
    (_libraryPlaylistItems(name)||[]).forEach(add);
  } else {
    if(window._libraryList) (_libraryList(kind)||[]).forEach(add);
    _radioPrefsBackfill(kind).forEach(add);
  }
  return out;
}
function _playListItem(it, opts){ if(!it) return false; opts=opts||{};
  if(!opts.keepQueue) _clearPlaybackQueue();
  if((it.kind==='gen'||it.slug) && it.slug){ _playGenerated(it.slug, {keepQueue:!!opts.keepQueue}); return true; }
  return false;
}
function _playSection(key, startKey, opts){
  opts=opts||{};
  var arr=_playlistItems(key); if(!arr.length) return;
  var idx=startKey ? arr.findIndex(function(e){ return _itemKey(e)===startKey; }) : 0; if(idx<0) idx=0;
  if(opts.shuffle && !startKey) idx=(Math.random()*arr.length)|0;
  if(_setPlaybackQueue(arr, idx, {shuffle:!!opts.shuffle})) _playQueueAt(_queueI);
}
let _curSlug='', _curName='Retro Rave Radio', _nowSource='generated';
function _setGeneratedNowPlaying(slug){
  _nowSource='generated';
  _curSlug = slug || _curSlug;
  _curName = _deslug(_curSlug);
}
function _setExternalNowPlaying(name){
  _nowSource='external';
  _curSlug='';
  _curName=name || 'Loading...';
  if(typeof setMediaMeta==='function') setMediaMeta(_curName);
  if(!_backgroundUiDormant() && typeof updateNow==='function') updateNow();
}
window._setExternalNowPlaying=_setExternalNowPlaying;

// ----- the RADIO chrome: Browse modal toggle + Tempo + transport -----
function mkRbtn(txt, fn){ const b=document.createElement('button'); b.className='rbtn'; b.textContent=txt;
  b.addEventListener('click', ev=>{ ev.stopPropagation(); if(b.disabled) return; fn(b); }); return b; }
function _fullscreenElement(){
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function _fullscreenSupported(){
  var root=document.documentElement;
  return !!(root && (root.requestFullscreen || root.webkitRequestFullscreen));
}
function _updateFullscreenButton(){
  var b=document.getElementById('rfullscreen'); if(!b) return;
  var ok=_fullscreenSupported(), on=!!_fullscreenElement();
  if(document.body) document.body.classList.toggle('is-fullscreen', on);
  if(document.documentElement) document.documentElement.classList.toggle('is-fullscreen', on);
  if(on && typeof syncBrowseButton==='function') syncBrowseButton();
  b.classList.toggle('unsupported', !ok);
  b.classList.toggle('on', on);
  b.innerHTML = svgIcon('fullscreen');
  b.title = on ? 'Exit full screen' : 'Go full screen';
  b.setAttribute('aria-label', b.title);
  b.title = on ? 'Exit full screen' : 'Go full screen';
}
function _toggleFullscreen(){
  var root=document.documentElement, p=null;
  try{
    if(_fullscreenElement()){
      if(document.exitFullscreen) p=document.exitFullscreen();
      else if(document.webkitExitFullscreen) p=document.webkitExitFullscreen();
    } else if(root.requestFullscreen){
      try{ p=root.requestFullscreen({navigationUI:'hide'}); }
      catch(e){ p=root.requestFullscreen(); }
    } else if(root.webkitRequestFullscreen){
      p=root.webkitRequestFullscreen();
    } else if(window._toast) _toast('full screen is not available');
    if(p && p.catch) p.catch(function(){ if(window._toast) _toast('full screen is not available'); });
  }catch(e){ if(window._toast) _toast('full screen is not available'); }
  setTimeout(_updateFullscreenButton, 80);
}
document.addEventListener('fullscreenchange', _updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', _updateFullscreenButton);
function buildRadioUI(){
  presetsBar.innerHTML='';
  // TEMPO = AUTO toggle + a continuous DJ-deck slider + clickable −/+ clamped to Radio.tempoBounds().
  const tg=document.createElement('div'); tg.id='rtempo'; tg.style.cssText='display:flex;align-items:center;gap:6px;';
  const auto=mkRbtn('auto', ()=>{ Radio.setTempo(null); syncTempoUI(); }); auto.title='Use this track BPM'; auto.style.padding='3px 8px;text-transform:uppercase;';
  const minus=mkRbtn('−', ()=>{ Radio.nudgeTempo(-1); syncTempoUI(); }); minus.id='rtempoMinus'; minus.title='−1 BPM'; minus.style.padding='3px 8px';
  const sl=document.createElement('input'); sl.type='range'; sl.id='rtemposlider'; sl.min=60; sl.max=220; sl.step=1;
  sl.title='BPM — drag to set the tempo'; sl.style.cssText='width:104px;vertical-align:middle;accent-color:#6cf;cursor:pointer;';
  sl.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  sl.addEventListener('input', function(ev){ ev.stopPropagation(); Radio.setTempo(+sl.value); syncTempoUI(); });
  const plus=mkRbtn('+', ()=>{ Radio.nudgeTempo(1); syncTempoUI(); }); plus.id='rtempoPlus'; plus.title='+1 BPM'; plus.style.padding='3px 8px';
  const read=document.createElement('span'); read.id='rtemporead'; read.style.cssText='font:15px var(--mono);color:#9cf;min-width:74px;display:inline-block;';
  tg.append(auto, minus, sl, plus, read);
  document.body.appendChild(tg);                              // detached from the top bar — the MIX MENU adopts it (BPM lives in the mix menu now)
  let listBtn=document.getElementById('rlist');
  if(!listBtn){ listBtn=mkRbtn('', ()=>{ if(window.toggleWelcomeModal) window.toggleWelcomeModal(); });
    listBtn.id='rlist'; document.body.appendChild(listBtn); }
  listBtn.title='Open menu'; listBtn.innerHTML=svgIcon('menu');          // welcome/menu toggle -> fixed TOP-LEFT (see shell CSS)
  let fsBtn=document.getElementById('rfullscreen');
  if(!fsBtn){ fsBtn=document.createElement('button'); fsBtn.type='button'; fsBtn.id='rfullscreen';
    fsBtn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); _pokeVisualControls(); _toggleFullscreen(); });
    document.body.appendChild(fsBtn); }
  _updateFullscreenButton();
  // TRACK TITLE (bottom-left) is the "details" affordance now — clicking it expands the full track recipe (YouTube/TikTok-style)
  if(trackEl && !trackEl._wired){ trackEl._wired=true; trackEl.addEventListener('click', ev=>{ ev.stopPropagation(); window.toggleTrackPanel && window.toggleTrackPanel(); }); }
  buildTransport();                                            // hidden compatibility rail; superseded by #playbar
  buildPlaybar();                                              // Roon-style bottom transport bar
  syncTempoUI();
  Radio.onChange(()=>{ syncRadioUI(); });
}
// BOTTOM-RIGHT vertical action rail (TikTok-style): ❤ heart · ⤴ share · ⏭ skip.
// (Dislike moved INTO the track-details panel; track details = bottom-left title click; mixer/tempo = bottom-right volume control.)
function buildTransport(){
  if(!transportEl) return;
  transportEl.innerHTML='';
  const heartBtn=mkRbtn('', ()=>{ doHeart(); }); heartBtn.id='rheart'; heartBtn.classList.add('heartbtn'); heartBtn.title='Heart (double-tap the screen)'; heartBtn.innerHTML=heartSVG(32);
  const shareBtn=mkRbtn('', b=>{ shareTrackLink(b); }); shareBtn.id='rshare'; shareBtn.classList.add('share'); shareBtn.title='Copy link to this track'; shareBtn.innerHTML=svgIcon('share');   // TikTok-style: copy the song's URL
  const skipBtn=mkRbtn('', ()=>_transportNext()); skipBtn.id='rskip'; skipBtn.title='Skip (swipe up)'; skipBtn.innerHTML=svgIcon('skip');
  transportEl.append(heartBtn, shareBtn, skipBtn);
  // DESKTOP: a TikTok-style prev/next pair vertically centred on the right edge (the rail's skip is hidden there via CSS).
  if(!document.getElementById('radionav')){
    const nav=document.createElement('div'); nav.id='radionav';
    const prevB=mkRbtn('', ()=>_transportPrev()); prevB.id='rprev'; prevB.title='Previous (swipe down)'; prevB.innerHTML=svgIcon('chevUp');
    const nextB=mkRbtn('', ()=>_transportNext()); nextB.id='rnext'; nextB.title='Next (swipe up)'; nextB.innerHTML=svgIcon('chevDown');
    nav.append(prevB, nextB); document.body.appendChild(nav);
  }
}
// TikTok-style SHARE: copy the current track's URL (= radio.ramine.net/<slug>) to the clipboard, flash the button to a
// check + show a brief toast. Falls back to a hidden textarea + execCommand when the async clipboard API is unavailable.
function _toast(msg){ var t=document.getElementById('rtoast'); if(!t){ t=document.createElement('div'); t.id='rtoast'; document.body.appendChild(t); }
  t.textContent=msg; t.classList.add('show'); clearTimeout(_toast._t); _toast._t=setTimeout(function(){ t.classList.remove('show'); }, 1500); }
function shareTrackLink(btn){
  var url=location.href;
  var done=function(ok){ if(btn){ btn.classList.add('act'); btn.innerHTML=svgIcon('check'); setTimeout(function(){ btn.classList.remove('act'); btn.innerHTML=svgIcon('share'); }, 1300); }
    _toast(ok ? 'Link copied' : 'Press Ctrl/Cmd-C'); };
  function fallback(){ try{ var ta=document.createElement('textarea'); ta.value=url; ta.style.cssText='position:fixed;opacity:0;'; document.body.appendChild(ta); ta.focus(); ta.select(); var ok=false; try{ ok=document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); done(ok); }catch(e){ done(false); } }
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(function(){ done(true); }, fallback); }
  else fallback();
}
function syncTempoUI(){ const sl=document.getElementById('rtemposlider'), read=document.getElementById('rtemporead');
  if(!sl) return;
  const cur = Radio.state.tempo;                                   // null = station-picked (default), else a pinned BPM
  const detected = (Audio.started&&Audio.detectedBpm)?Audio.detectedBpm():null;
  const native = (Audio.started&&Audio.trackBpm)?Audio.trackBpm():null;
  const live = native!=null ? native : (detected!=null ? detected : ((Audio.started&&Audio.grid)?Audio.grid().bpm:null));
  const rng = (Radio.tempoBounds ? Radio.tempoBounds() : [60,220]); // one manual DJ-deck range shared by slider and +/- controls
  sl.min = rng[0]; sl.max = rng[1];
  const val = (cur!=null) ? cur : (live!=null ? live : 128);
  const knobVal = Math.max(+sl.min, Math.min(+sl.max, Math.round(val)));
  if(document.activeElement!==sl) sl.value = knobVal;   // don't fight the user mid-drag
  const minus=document.getElementById('rtempoMinus'), plus=document.getElementById('rtempoPlus');
  if(minus) minus.disabled = knobVal <= +sl.min;
  if(plus) plus.disabled = knobVal >= +sl.max;
  if(read){ read.textContent = (live!=null || cur!=null) ? (val+' BPM') : '—'; read.title = (cur==null) ? 'Track BPM / AUTO' : 'Manual BPM override'; }
}
function syncRadioUI(){ syncTempoUI(); }
function syncBrowseButton(){
  const btn=document.getElementById('rlist');
  if(btn){
    btn.classList.toggle('on', _welcomeModalVisible());
    btn.hidden=false; btn.removeAttribute('aria-hidden');
  }
}
function _welcomeModalVisible(){
  var introEl=document.getElementById('intro');
  return !!(introEl && introEl.style.display!=='none' && !introEl.classList.contains('hidden'));
}
function _welcomeCanDismiss(){
  return !!((typeof Audio!=='undefined' && Audio.started) || (typeof _watchOnly!=='undefined' && _watchOnly));
}
function openWelcomeModal(){
  if(typeof closeMixPanel==='function') closeMixPanel();
  if(typeof _closePlaybarMenu==='function') _closePlaybarMenu();
  if(window.openProductHome) window.openProductHome();
  else if(window.buildHome) window.buildHome();
  else { var introEl=document.getElementById('intro'); if(introEl){ _revealed=false; introEl.style.display=''; introEl.classList.remove('hidden','lib'); if(window.buildHomeTiles) window.buildHomeTiles(); } }
  if(typeof syncBrowseButton==='function') syncBrowseButton();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
}
function closeWelcomeModal(){
  if(!_welcomeCanDismiss()) return;
  if(window._hideLibContainer) _hideLibContainer();
  else { var introEl=document.getElementById('intro'); if(introEl){ _revealed=true; introEl.classList.add('hidden'); setTimeout(function(){ if(_revealed) introEl.style.display='none'; }, 500); } }
  if(typeof syncBrowseButton==='function') syncBrowseButton();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
}
window.toggleWelcomeModal=function(){ if(_welcomeModalVisible()) closeWelcomeModal(); else openWelcomeModal(); };
let _gamePickerEl=null;
function gamePickerVisible(){ return !!(_gamePickerEl && _gamePickerEl.classList.contains('show')); }
function gameLabel(key){
  if(key==='random') return 'Random';
  var gm=GAME_BY_KEY[key];
  if(gm && gm.name) return gm.name;
  // not loaded yet: use the discovered manifest name so the picker reads
  // "PAC-MAN" / "BRICKTAP", not a title-cased id, before the pack loads.
  try{
    if(typeof Packs!=='undefined' && Packs.get){ var h=Packs.get(key); if(h && h.manifest && h.manifest.name) return h.manifest.name; }
  }catch(e){}
  return key.replace(/_/g,' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
function buildGamePicker(){
  if(_gamePickerEl) return _gamePickerEl;
  var el=document.createElement('div');
  el.id='gamepick';
  el.innerHTML='<div class="gp-panel" role="dialog" aria-modal="true" aria-label="Choose visualizer game">'+
    '<div class="gp-head"><div><div class="gp-title">Choose visualizer</div><div class="gp-sub">Shortcut: G. Selection is written to the URL as <b>?game=</b>.</div></div>'+
    '<button class="gp-close" type="button" aria-label="Close">×</button></div><div class="gp-list"></div></div>';
  document.body.appendChild(el);
  el.addEventListener('click', function(ev){ if(ev.target===el) closeGamePicker(); });
  el.querySelector('.gp-close').addEventListener('click', function(ev){ ev.preventDefault(); closeGamePicker(); });
  _gamePickerEl=el;
  _fillGamePickerList();
  return el;
}
function _pickerGameKeys(){
  // The picker lists the full DISCOVERED roster, not just the eagerly-warmed
  // packs in CT_GAMES (radio warms only ~2 at startup; the rest load lazily).
  // Selecting an unloaded game triggers its pack load (chooseVisualizerGame ->
  // _ensureGamePackLoaded) and shows balloon meanwhile. Without this the picker
  // only ever offered the 2-3 warmed games.
  var seen={}, keys=[];
  function add(k){ if(!k||seen[k]||_BROKEN_GAMES[k]) return; var gm=GAME_BY_KEY[k]; if(gm&&gm.hiddenFromRandom) return; seen[k]=1; keys.push(k); }
  try{
    if(typeof Packs!=='undefined' && Packs.list){
      var L=Packs.list()||[], i;
      for(i=0;i<L.length;i++){ if(L[i] && L[i].kind==='game') add(L[i].id); }
    }
  }catch(e){}
  for(var j=0;j<GAMES.length;j++){ if(GAMES[j]) add(GAMES[j].key); }   // inline/loaded games the loader may not surface
  return keys.sort();
}
function _fillGamePickerList(){
  if(!_gamePickerEl) return;
  var list=_gamePickerEl.querySelector('.gp-list'); if(!list) return;
  var keys=['random'].concat(_pickerGameKeys());
  if(list._keys===keys.join(',')) return;                       // packs unchanged -> keep DOM
  list._keys=keys.join(','); list.innerHTML='';
  keys.forEach(function(key){
    var b=document.createElement('button');
    b.type='button'; b.className='gp-item'; b.dataset.game=key;
    b.innerHTML='<span><span class="gp-name"></span><span class="gp-key"></span></span><span class="gp-dot" aria-hidden="true"></span>';
    b.querySelector('.gp-name').textContent=gameLabel(key);
    b.querySelector('.gp-key').textContent=key==='random' ? '?game=random' : '?game=' + key;
    b.addEventListener('click', function(ev){ ev.preventDefault(); chooseVisualizerGame(key); closeGamePicker(); });
    list.appendChild(b);
  });
}
// packs arrived / changed: rebuild the registry, refresh the picker, and re-apply a fixed ?game= pref
// that was waiting on its pack to load (balloon was standing in for it).
function _onGamePacksChanged(){
  _rebuildGameRegistry();
  _fillGamePickerList();
  if(typeof _syncGamePicker==='function' && _gamePickerEl) _syncGamePicker();
  var fixed=fixedGamePref();
  if(fixed && GAME_BY_KEY[fixed] && curGameKey!==fixed && (sceneKind==='game'||_watchOnly)){ randomMode=false; showGame(fixed); }
}
// Warm the FULL discovered game roster in the background. The loader eagerly
// warms only ~2 packs at startup (fast radio start); the rest load lazily on
// explicit pick. But the RANDOM montage (watch / radio auto-shuffle) draws from
// POOL = loaded games only, so without this it would forever cycle just the 2-3
// warmed packs and every other game (Tetris, Mario, DK, Zelda, ...) would never
// appear. Loading each pack registers it into CT_GAMES -> _onGamePacksChanged
// rebuilds POOL, so the montage fills out to the whole roster within a beat.
function _warmAllGames(){
  try{
    if(typeof Packs==='undefined' || !Packs.list) return;
    var L=Packs.list()||[], i, p;
    for(i=0;i<L.length;i++){ p=L[i];
      if(p && p.kind==='game' && !GAME_BY_KEY[p.id] && !_BROKEN_GAMES[p.id]) _ensureGamePackLoaded(p.id);
    }
  }catch(e){}
}
function _syncGamePicker(){
  var el=buildGamePicker();
  _fillGamePickerList();
  var pref=selectedGamePref() || 'random';
  el.querySelectorAll('.gp-item').forEach(function(b){
    var on=b.dataset.game===pref;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on?'true':'false');
  });
}
function openGamePicker(){ buildGamePicker(); _syncGamePicker(); _gamePickerEl.classList.add('show'); if(typeof _pokeVisualControls==='function') _pokeVisualControls(); }
function closeGamePicker(){ if(_gamePickerEl) _gamePickerEl.classList.remove('show'); }
function toggleGamePicker(){ if(gamePickerVisible()) closeGamePicker(); else openGamePicker(); }
window.openGamePicker=openGamePicker;
window.closeGamePicker=closeGamePicker;
window.toggleGamePicker=toggleGamePicker;
document.addEventListener('click', function(ev){
  var introEl=document.getElementById('intro');
  if(introEl && ev.target===introEl && _welcomeModalVisible()) closeWelcomeModal();
});
document.addEventListener('keydown', handleEscapeShortcut, true);
buildRadioUI();
syncBrowseButton();
// HUD now-playing line, with the LIVE (tap-set) bpm
function refreshNow(){ updateNow(); }
// the BOTTOM-LEFT caption (TikTok-style): just the generative TRACK NAME — no bpm / game / genre.
function updateNow(){ if(!Audio.started){ if(typeof _updatePlaybar==='function')_updatePlaybar(); return; }
  if(trackEl) trackEl.innerHTML = '<span class="note">'+svgIcon('note')+'</span><span class="ttl">'+_curName+'</span><span class="more">details'+svgIcon('chevron')+'</span>';
  if(typeof _updatePlaybar==='function') _updatePlaybar();
}
// ===== Roon-style bottom transport bar: cover + track name + ⏮ ⏯ ⏭ + like (replaces the old caption + right rail) =====
var _pbEl=null, _pbMenuEl=null;
function _pbIcon(n){ return ({
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2.2v12H6z"/><path d="M20 6 L9.5 12 L20 18 Z"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.8 6H18v12h-2.2z"/><path d="M4 6 L14.5 12 L4 18 Z"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5 L19 12 L7 19 Z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>'
})[n]||''; }
function _wirePlaybarButton(id, fn){
  var b=document.getElementById(id); if(!b || b._pbWired) return; b._pbWired=true;
  function run(ev, opts){ if(ev){ if(!opts || opts.preventDefault!==false) ev.preventDefault(); ev.stopPropagation(); } fn(); }
  b.addEventListener('pointerdown', function(ev){
    if(ev.button!=null && ev.button!==0) return;
    b._pbPointerAt=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    // Do not cancel pointerdown: Safari/Chrome may need the follow-up click as the
    // trusted gesture that resumes an autoplay-gated AudioContext.
    run(ev, {preventDefault:false});
  });
  b.addEventListener('pointerup', function(ev){
    if(id!=='pbPlay' || (ev.button!=null && ev.button!==0)) return;
    var gated=(typeof Audio!=='undefined' && Audio.running && !Audio.running() && !(Audio.isPaused&&Audio.isPaused()));
    if(gated){ ev.stopPropagation(); if(Audio.resume) Audio.resume(true); if(typeof unlockAudioSession==='function') unlockAudioSession(); }
  });
  b.addEventListener('click', function(ev){
    var now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    if(b._pbPointerAt && now-b._pbPointerAt<650){ ev.preventDefault(); ev.stopPropagation(); return; }
    run(ev);
  });
}
var _backToLiveEl=null;
function buildBackToLiveButton(){                       // the #resumeMusic pattern: floating pill, shown via body class
  if(_backToLiveEl) return _backToLiveEl;
  if(!document.body) return null;
  var b=document.createElement('button');
  b.id='backToLive';
  b.type='button';
  b.title='Rejoin the live broadcast';
  b.innerHTML='<span class="btl-dot"></span><span>back to live</span>';
  document.body.appendChild(b);
  _backToLiveEl=b;
  _wirePlaybarButton('backToLive', function(){
    if(typeof startAudio==='function') startAudio(true);
    if(typeof Radio!=='undefined'&&Radio.setMood) Radio.setMood('any');    // rejoining Everything clears any pinned mood...
    if(typeof Radio!=='undefined'&&Radio.setTempo) Radio.setTempo(null);   // ...and any pinned tempo (live runs at native bpm; a stale pin would re-apply on the next fork)
    if(typeof _setTransportPlaying==='function') _setTransportPlaying();
    LiveCtl.join();
  });
  return b;
}
var _resumeMusicEl=null;
function buildResumeMusicButton(){
  if(_resumeMusicEl) return _resumeMusicEl;
  if(!document.body) return null;
  var b=document.createElement('button');
  b.id='resumeMusic';
  b.type='button';
  b.title='Resume music';
  b.innerHTML=_pbIcon('play')+'<span>resume music</span>';
  document.body.appendChild(b);
  _resumeMusicEl=b;
  _wirePlaybarButton('resumeMusic', _resumeMusicFromWatch);
  return b;
}
function buildPlaybar(){ _pbEl=document.getElementById('playbar'); if(!_pbEl||_pbEl._wired) return; _pbEl._wired=true;
  _pbEl.innerHTML='<div class="pb-left"><div class="pb-cover" id="pbCover" title="Open album"></div>'+
    '<div class="pb-info" id="pbInfo"><div class="pb-titleline"><div class="pb-title" id="pbTitle">—</div>'+
    '<button id="pbHeart" class="pb-heart-inline" title="Like" aria-pressed="false">'+heartOutlineSVG(20)+'</button>'+
    '<button id="pbItemMore" class="pb-item-more" title="More">'+svgIcon('more')+'</button></div><div class="pb-sub" id="pbSub"></div></div></div>'+
    '<div class="pb-ctrl"><div class="pb-main-ctrl"><button id="pbPrev" title="Previous">'+_pbIcon('prev')+'</button>'+
    '<button class="pb-play" id="pbPlay" title="Play / Pause">'+_pbIcon('pause')+'</button>'+
    '<button id="pbNext" title="Next">'+_pbIcon('next')+'</button></div>'+
    '</div>'+
    '<div class="pb-right"><button id="pbVolume" class="pb-volume" title="Volume / mix"><span class="pbv-icon">'+svgIcon('spkOn')+'</span><span id="pbVolRead">100</span></button></div>';
  _wirePlaybarButton('pbPrev', _transportPrev);
  _wirePlaybarButton('pbNext', _transportNext);
  _wirePlaybarButton('pbPlay', _transportToggle);
  _wirePlaybarButton('pbHeart', _transportHeart);
  _wirePlaybarButton('pbItemMore', _togglePlaybarMenu);
  _wirePlaybarButton('pbVolume', function(){ window.toggleMixPanel && window.toggleMixPanel(); });
  var volBtn=document.getElementById('pbVolume');
  if(volBtn && !volBtn._mixHoverWired){ volBtn._mixHoverWired=true;
    volBtn.addEventListener('mouseenter', function(){ if(window.openMixPanel) window.openMixPanel(); });
  }
  // The track title is just text. Album navigation lives on the cover and album name.
  document.getElementById('pbTitle').onclick=function(ev){ ev.stopPropagation(); if(_nowSource==='generated' && window.toggleTrackPanel) toggleTrackPanel(); };
  buildResumeMusicButton();
}
function _transportIsGated(){ return !!(_nowSource==='generated' && Audio.running && !Audio.running() && !(Audio.isPaused&&Audio.isPaused())); }
function _transportNeedsResume(){ return !!(Audio.started && Audio.running && !Audio.running() && !(Audio.isPaused&&Audio.isPaused())); }
function _transportIsPaused(){ if(_watchOnly && !_watchMicActive) return false; if(Audio.isPaused && Audio.isPaused()) return true; if(_transportIsGated() || _transportNeedsResume()) return true; return !(typeof Radio!=='undefined' && Radio.state ? Radio.state.playing : true); }
function _transportUserPaused(){ return !!(Audio && Audio.isPaused && Audio.isPaused() && !_transportIsGated()); }
function _syncPlayIcon(){ var paused=_transportIsPaused(), b=document.getElementById('pbPlay'), icon=paused?'play':'pause';
  if(b && b.dataset.icon!==icon){ b.dataset.icon=icon; b.innerHTML=_pbIcon(icon); }
  if(_watchOnly && !_watchMicActive){ if(typeof _clearMediaSession==='function') _clearMediaSession(); _syncWakeLock(); return; }
  if(typeof _syncMediaSession==='function') _syncMediaSession(false);
  else if('mediaSession' in navigator){ try{ navigator.mediaSession.playbackState=paused?'paused':'playing'; }catch(e){} }
  _syncWakeLock();
}
var _screenWakeLock=null, _screenWakeLockPending=false;
function _screenWakeLockAvailable(){
  return !!(typeof navigator!=='undefined' && navigator.wakeLock && navigator.wakeLock.request &&
    typeof document!=='undefined' && (typeof window==='undefined' || window.isSecureContext!==false));
}
function _setWakeLockState(state, detail){
  try{
    if(document.documentElement){
      document.documentElement.dataset.wakeLock=state||'off';
      if(detail) document.documentElement.dataset.wakeLockDetail=String(detail).slice(0,120);
      else delete document.documentElement.dataset.wakeLockDetail;
    }
  }catch(e){}
}
function _shouldHoldWakeLock(){
  return !!(_screenWakeLockAvailable() && Audio && Audio.started && !_transportIsPaused() &&
    typeof document!=='undefined' && document.visibilityState==='visible');
}
async function _requestWakeLock(){
  if(!_screenWakeLockAvailable()){ _setWakeLockState('unsupported'); return false; }
  if(typeof document!=='undefined' && document.visibilityState!=='visible'){ _releaseWakeLock(); return false; }
  if(_screenWakeLock || _screenWakeLockPending){ _setWakeLockState(_screenWakeLock?'held':'pending'); return true; }
  _screenWakeLockPending=true; _setWakeLockState('pending');
  try{
    var lock=await navigator.wakeLock.request('screen');
    _screenWakeLock=lock;
    lock.addEventListener('release', function(){
      if(_screenWakeLock===lock) _screenWakeLock=null;
      _setWakeLockState(_shouldHoldWakeLock()?'released-reacquiring':'released');
      if(_shouldHoldWakeLock()) setTimeout(_syncWakeLock, 250);
    });
    _setWakeLockState('held');
    return true;
  }catch(e){
    _setWakeLockState('error', e && (e.name||e.message||e));
    return false;
  }finally{
    _screenWakeLockPending=false;
  }
}
function _releaseWakeLock(){
  var lock=_screenWakeLock; _screenWakeLock=null;
  if(lock && lock.release){ try{ lock.release(); }catch(e){} }
  _setWakeLockState(_screenWakeLockAvailable()?'released':'unsupported');
}
function _syncWakeLock(){
  if(_shouldHoldWakeLock()) void _requestWakeLock();
  else _releaseWakeLock();
}
if(typeof window!=='undefined') window._syncWakeLock=_syncWakeLock;
var _visualControlsTimer=0, _wasAiVisual=false;
let _watchOnly=false, _watchMicActive=false, _micReturnState=null, _watchReturnState=null;
function _isAiRadioVisual(){
  var introEl=document.getElementById('intro');
  var viewOpen=!!(introEl && introEl.style.display!=='none' && !introEl.classList.contains('hidden'));
  var hasGeneratedSlug=!!(_curSlug || (typeof _readSlug==='function' && _readSlug()));
  var generatedActive=!!(_nowSource==='generated' && hasGeneratedSlug && !(Audio.extActive&&Audio.extActive()));
  var externalActive=!!(Audio.extActive && Audio.extActive());
  return !!(Audio.started && !viewOpen && (generatedActive || externalActive));
}
function _clearVisualControlsTimer(){ if(_visualControlsTimer){ clearTimeout(_visualControlsTimer); _visualControlsTimer=0; } }
function _setVisualControlsActive(active){
  if(!document.body) return;
  _clearVisualControlsTimer();
  document.body.classList.toggle('controls-active', !!active);
  if(active){
    _visualControlsTimer=setTimeout(function(){
      if(_isAiRadioVisual() || _watchOnly) document.body.classList.remove('controls-active');
      _visualControlsTimer=0;
    }, 3000);
  }
}
function _syncVisualChrome(){
  var on=false; try{ on=_isAiRadioVisual(); }catch(e){}
  var songOn=false; try{ songOn=!!(Audio.started && !viewOpen && !_watchOnly && _nowSource && _nowSource!=='watch'); }catch(e2){}
  if(document.body) document.body.classList.toggle('ai-visual', on);
  if(document.body){
    document.body.classList.toggle('song-visual', songOn);
    document.body.classList.toggle('watch-visual', !!_watchOnly);
    document.body.classList.toggle('watch-mic-active', !!_watchMicActive);
    document.body.classList.toggle('watch-can-resume', !!(_watchOnly && !_watchMicActive && _watchReturnState));
    // BACK TO LIVE pill: any forked/private generated session can rejoin the broadcast in one tap
    var canRejoin=false;
    try{
      var introEl3=document.getElementById('intro');
      var homeOpen=!!(introEl3 && introEl3.style.display!=='none' && !introEl3.classList.contains('hidden'));
      canRejoin=!!(typeof LiveCtl!=='undefined' && !LiveCtl.active() && Audio.started && !_watchOnly && !homeOpen &&
                   _nowSource==='generated' && !(Audio.extActive&&Audio.extActive()));
    }catch(e3){}
    document.body.classList.toggle('live-can-rejoin', canRejoin);
    if(canRejoin && typeof buildBackToLiveButton==='function') buildBackToLiveButton();
  }
  if(on || _watchOnly){
    if(!_wasAiVisual) _setVisualControlsActive(true);
  } else {
    _setVisualControlsActive(false);
  }
  _wasAiVisual=on || _watchOnly;
}
function _pokeVisualControls(){ _syncVisualChrome(); if(document.body && (document.body.classList.contains('ai-visual') || document.body.classList.contains('watch-visual'))) _setVisualControlsActive(true); }
['pointermove','pointerdown','touchstart','keydown','wheel'].forEach(function(type){
  window.addEventListener(type, _pokeVisualControls, {capture:true, passive:true});
});
function _ensureGeneratedTransport(){
  if(_nowSource!=='generated') return;
  if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal();
  _station='generated';
  if(Audio.gotoTrack && (!Audio.trackToken || !Audio.trackToken())){
    var slug=_curSlug || (typeof _mintToken==='function' ? _mintToken() : 'retro-rave-radio');
    _trkHist=[slug]; _trkI=0; Audio.gotoTrack(slug);
  }
}
function _transportToggle(){
  if(_transportNeedsResume()){
    _markTransportDiag('resume-gated');
    startAudio(true); if(Audio.resume) Audio.resume(true); if(typeof unlockAudioSession==='function') unlockAudioSession();
    if(Audio.setPlaying) Audio.setPlaying(true);
  }
  else if(_nowSource==='generated' && Audio.isPaused && Audio.isPaused()){
    _markTransportDiag('generated-paused');
    startAudio(true); if(Audio.resume) Audio.resume(true); if(typeof unlockAudioSession==='function') unlockAudioSession(); if(Audio.setPlaying) Audio.setPlaying(true);
    if(typeof Radio!=='undefined' && Radio.state && !Radio.state.playing && Radio.playPause) Radio.playPause();
  }
  else if(_transportIsGated()){
    _markTransportDiag('generated-gated');
    // Autoplay-gated direct links show a generated track before sound is actually running. First press should start it.
    startAudio(true); if(Audio.resume) Audio.resume(true); if(typeof unlockAudioSession==='function') unlockAudioSession(); if(Audio.setPlaying) Audio.setPlaying(true);
    if(typeof Radio!=='undefined' && Radio.state && !Radio.state.playing && Radio.playPause) Radio.playPause();
  }
  else if(typeof Radio!=='undefined' && Radio.playPause){ _markTransportDiag('radio-playpause'); Radio.playPause(); }
  else { _markTransportDiag('none'); }
  _syncPlayIcon();
}
	function _transportStop(){
	  _markTransportDiag('stop');
	  if(typeof enterWatchMode==='function') enterWatchMode({resumeMusic:true});
	}
// ===== LIVE: the Everything station's shared broadcast. src/live.js is the pure clock
//  schedule; this controller keeps the ENGINE on it: joins mid-track (gotoTrackAtOffset),
//  refreshes the "what's next" answer the engine mints through _radioMint, wall-anchors
//  each boundary (Audio.setLiveMode sync hook), and self-heals every tick — hour cold-open,
//  OS-sleep drift, pause/resume, autoplay-gate lag all reduce to "deck ≠ schedule -> re-seek".
//  Radio.state.live = persisted INTENT (forks clear it); LiveCtl.active() = engine is
//  actually following the schedule right now (watch mode stops it without clearing intent).
var LiveCtl = (function(){
  var active=false, cur=null, timer=0, offsetMs=0, misses=0, lastSeekAt=0, tokBlock={}, tokBlockN=0;
  function correctedNow(){ return Date.now()+offsetMs; }
  // presence 'now' echo corrects only GROSS clock skew, with hysteresis so a client sitting near
  // the ±15s threshold (jittered by network latency) can't flap offsetMs and reseek-storm the audio.
  function setClockOffset(ms){
    if(!isFinite(ms)) return;
    if(offsetMs!==0){
      if(Math.abs(ms)<10000) offsetMs=0;                     // clock resynced -> drop correction (10-15s deadband)
      else if(Math.abs(ms-offsetMs)>5000) offsetMs=ms;       // real drift moved -> retrack; ignore jitter
    } else if(Math.abs(ms)>15000){ offsetMs=ms; }
  }
  function resolve(){ try{ cur=Live.resolveAt(correctedNow()); }catch(e){ cur=null; } return cur; }
  function remember(tok, blockN){ if(!tok) return; if(tokBlock[tok]==null){ tokBlock[tok]=blockN; if(++tokBlockN>64){ tokBlock={}; tokBlockN=0; } } }
  // compile a live token under the composer of the block that token BELONGS to (not the block of
  // NOW): at a future LIVE_VERSIONS flip, a deckNext prepared just before the boundary is next
  // block's track 0 — it must render under the new composer even while now is still the old block.
  function composerGet(tok){
    try{
      var bN=(tok!=null && tokBlock[tok]!=null) ? tokBlock[tok] : Math.floor(correctedNow()/Live.BLOCK_MS);
      return Live.composerFor(bN);
    }catch(e){ return null; }
  }
  // prepareNextDeck asks: when does this next token start on the wall? (null = natural chain;
  // the hour straddler's successor cold-opens at the fixed boundary via tick, never the chain anchor)
  function syncFn(nextTok){
    if(!active) return null;
    var r=resolve();
    if(!r || r.boundary || nextTok!==r.nextToken) return null;
    return { startWallMs:r.nextStartWallMs, nowMs:correctedNow() };
  }
  // the engine's next-track mint while live: the schedule's successor of what the DECK is playing
  function nextToken(){
    if(!active) return null;
    var r=resolve(); if(!r) return null;
    remember(r.token, r.blockN); remember(r.nextToken, r.boundary ? r.blockN+1 : r.blockN);
    var deckTok=(Audio.trackToken && Audio.trackToken())||null;
    if(deckTok===r.nextToken){    // deck already promoted ahead of wall (bg drift): answer one further
      try{ var after=Live.resolveAt(r.nextStartWallMs+500); if(after && after.token===r.nextToken){ remember(after.nextToken, after.boundary?after.blockN+1:after.blockN); return after.nextToken; } }catch(e){}
    }
    return r.nextToken;
  }
  function seekToSchedule(){
    var r=resolve(); if(!r) return false;
    remember(r.token, r.blockN);
    var off=(correctedNow()-r.startWallMs)/1000;
    var ok=Audio.gotoTrackAtOffset && Audio.gotoTrackAtOffset(r.token, off);
    if(ok){ lastSeekAt=Date.now(); if(typeof _pushHist==='function') _pushHist(r.token); }
    return !!ok;
  }
  function tick(){
    if(!active) return;
    // Hidden tab: the scheduler runs on a deep background horizon and wall-anchors each boundary
    // (prepareNextDeck) — the deck pointer legitimately LAGS the schedule by seconds, so a token/drift
    // re-seek here would falsely cold-open (killAll) a correctly-playing track. Skip; the first
    // foreground tick's drift check snaps back if genuinely off. (Bg timers are throttled anyway.)
    if(typeof document!=='undefined' && document.hidden){ misses=0; return; }
    if((Audio.isPaused && Audio.isPaused()) || (Audio.running && !Audio.running())) { misses=0; return; }   // paused/gated: resume self-heals below
    var r=resolve(); if(!r) return;
    var pos=Audio.deckPosition && Audio.deckPosition();
    if(!pos){ return; }
    if(Date.now()-lastSeekAt<5000) return;                       // seek settle guard
    if(pos.tok!==r.token){
      // off-schedule: hour boundary (straddler running past the fixed cold-open), OS sleep,
      // or a chain that landed early/late. Two consecutive misses (~2s) = real, not a promote race.
      if(++misses>=2){ misses=0; seekToSchedule(); }
      return;
    }
    misses=0;
    var drift=pos.sec-(correctedNow()-r.startWallMs)/1000;       // deck vs wall inside the same track
    if(Math.abs(drift)>2.0) seekToSchedule();                    // suspensions freeze ctx.currentTime; the wall doesn't
  }
  function join(){
    if(active) return true;
    if(typeof Audio==='undefined' || !Audio.started || !Audio.gotoTrackAtOffset) return false;
    if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal();
    active=true; misses=0;
    Audio.setLiveMode(true, composerGet, syncFn);
    if(!seekToSchedule()){                                        // schedule unavailable (composer missing): never brick — fall back private
      active=false; Audio.setLiveMode(false);
      try{ if(typeof Radio!=='undefined'&&Radio.setLive) Radio.setLive(false); }catch(e){}
      return false;
    }
    try{ if(typeof Radio!=='undefined'&&Radio.setLive) Radio.setLive(true); }catch(e2){}
    if(!timer) timer=setInterval(tick, 1000);
    try{ if(history.replaceState && !window.__RRR_BOOT_PLAYER_ROUTE) history.replaceState(null,'','/radio'+(typeof _routeQueryExtras==='function'?_routeQueryExtras():'')); }catch(e3){}
    if(typeof _updatePlaybar==='function') _updatePlaybar();
    if(typeof _syncVisualChrome==='function') _syncVisualChrome();
    return true;
  }
  function stop(){                                                // disengage the engine; INTENT (Radio.state.live) untouched
    if(timer){ clearInterval(timer); timer=0; }
    if(!active) return;
    active=false;
    try{ Audio.setLiveMode(false); }catch(e){}
    if(typeof _updatePlaybar==='function') _updatePlaybar();
    if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  }
  function leave(){                                               // a FORK: skip/mood/tempo — intent cleared, pill appears
    stop();
    try{ if(typeof Radio!=='undefined'&&Radio.setLive) Radio.setLive(false); }catch(e){}
  }
  return { active:function(){ return active; }, join:join, stop:stop, leave:leave,
           nextToken:nextToken, setClockOffset:setClockOffset,
           debug:function(){ var r=active?resolve():null; return { active:active,
             token:r?r.token:'', offsetSec:r?+(((correctedNow()-r.startWallMs)/1000).toFixed(2)):-1 }; } };
})();
window.LiveCtl=LiveCtl;
// ANY explicit user pick of a specific track/source (Liked/Recent card, playlist, deep-link nav,
// mic, dropped file, thumb-down) is a FORK off the shared broadcast — otherwise LiveCtl's drift
// tick would yank the chosen track back to the schedule within ~2-3s. leave() clears the intent
// and surfaces the back-to-live pill, exactly like a skip. Idempotent when not live.
function _forkFromLive(){ if(typeof LiveCtl!=='undefined' && LiveCtl.active()) LiveCtl.leave(); }
window._forkFromLive=_forkFromLive;
// Radio.setLive is the single intent switch (setMood/setTempo funnels call it on fork) — mirror it into the engine.
window.onRadioLive=function(on){ if(!on) LiveCtl.stop(); };
// Everything-tile entry while live: same shell as _startEndlessRadio but the schedule supplies the track.
function _startLiveRadio(){
  if(typeof _exitWatchMode==='function') _exitWatchMode();
  _clearPlaybackQueue();
  if(typeof startAudio==='function') startAudio(true);            // boot path joins live itself when state.live is set
  _setTransportPlaying();
  if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal();
  _station='generated'; _nowSource='generated';
  try{ if(typeof Radio!=='undefined'&&Radio.setLive) Radio.setLive(true); }catch(e){}
  if(!LiveCtl.active() && !LiveCtl.join()){                                    // schedule broken -> private radio, never silence
    try{ if(typeof Radio!=='undefined'&&Radio.setLive) Radio.setLive(false); }catch(e2){}   // clear intent first (recursion guard)
    _startEndlessRadio(); return;
  }
  if(window._applyMixScopeForSource) window._applyMixScopeForSource();
  if(window.refreshMixPanel) window.refreshMixPanel();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof hideHome==='function') hideHome();
}
window._startLiveRadio=_startLiveRadio;
function _transportNext(){
  if(_watchOnly && !_watchMicActive){ advanceRandomVisualizer(); return; }
  if(LiveCtl.active()) LiveCtl.leave();                           // ANY skip = fork off the broadcast to the private queue
  if(_advanceQueue(1)) return;
  if(_nowSource==='generated') _ensureGeneratedTransport();
  if(typeof Radio!=='undefined'&&Radio.next){ Radio.next(); }
}
function _transportPrev(){
  if(_watchOnly && !_watchMicActive){ advanceRandomVisualizer(); return; }
  if(LiveCtl.active()) LiveCtl.leave();
  if(_advanceQueue(-1)) return;
  if(_nowSource==='generated') _ensureGeneratedTransport();
  if(typeof Radio!=='undefined'&&Radio.prev){ Radio.prev(); }
}
// the thing currently playing, as a tracking item (likes/dislikes/recent are track-specific)
function _curItem(){ if(_nowSource==='generated' && _curSlug) return {kind:'gen',slug:_curSlug,name:_curName}; return null; }
window._currentNowPlaying=function(){ var it=_curItem()||{}; return Object.assign({gameKey:curGameKey||'', paused:_transportIsPaused()}, it); };
var _listenStatsAt=0;
function _listenStatsTick(){
  var now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  if(!_listenStatsAt){ _listenStatsAt=now; return; }
  var dt=(now-_listenStatsAt)/1000; _listenStatsAt=now;
  if(dt<=0 || dt>12 || _transportIsPaused() || !window._recordListenSeconds) return;
  var it=_curItem(); if(!it) return;
  var info=null; try{ info=(Audio.trackInfo&&Audio.trackInfo()) || (Audio.nowPlaying&&Audio.nowPlaying()) || null; }catch(e){}
  _recordListenSeconds(dt,it,info);
}
// the heart-burst ANIMATION only (no Radio.prefs write) — the unified G store is the single source of truth for likes
function _heartBurstVisual(){ if(typeof bigHeartPop==='function') bigHeartPop();
  if(typeof spawnRiseHeart==='function'){ var cx=window.innerWidth*0.5, cy=window.innerHeight*0.62;
    for(var i=0;i<10;i++) spawnRiseHeart(cx+(Math.random()*window.innerWidth*0.46 - window.innerWidth*0.23), cy+(Math.random()*60-20), 22+Math.random()*30, (Math.random()*140-70), Math.random()*0.3, 1.2+Math.random()*0.9); } }
function _transportHeart(){ var it=_curItem(); if(!it){ _heartBurstVisual(); return; }
  var liked = window._likeToggle ? _likeToggle(it) : false;
  setPlaybarHeartLiked(document.getElementById('pbHeart'), liked);
  if(liked) _heartBurstVisual();
  if(window._toast)_toast(liked?'Liked':'Unliked'); }
function _transportAddPlaylist(){ var it=_curItem(); if(!it){ if(window._toast)_toast('No track playing'); return; }
  var name=''; try{ name=prompt('Add to playlist', 'My Playlist')||''; }catch(e){}
  name=String(name).trim(); if(!name) return;
  if(window._addItemToPlaylist && _addItemToPlaylist(name,it)){ if(window._toast)_toast('Added to '+name); }
  else if(window._toast)_toast('Could not add playlist item'); }
function _transportDislike(){ var it=_curItem(); if(!it||!window._dislikeToggle) return;
  var dis=_dislikeToggle(it);
  setPlaybarHeartLiked(document.getElementById('pbHeart'), false);
  if(window._toast)_toast(dis?'Not for me — skipping':'Removed');
  if(dis){ _transportNext(); }   // transport dislike is track-level; album detail dislike remains album-level
  }
function _pbMenuEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function _pbMenuItem(act,icon,label,sub,disabled){
  return '<button type="button" class="pbm-row" data-pbact="'+act+'"'+(disabled?' disabled':'')+'>'+
    '<span class="pbm-ico">'+svgIcon(icon)+'</span><span class="pbm-copy"><span class="pbm-label">'+_pbMenuEsc(label)+'</span>'+
    (sub?'<span class="pbm-sub">'+_pbMenuEsc(sub)+'</span>':'')+'</span></button>';
}
function _ensurePlaybarMenu(){
  if(_pbMenuEl) return _pbMenuEl;
  _pbMenuEl=document.createElement('div'); _pbMenuEl.id='pbMenu'; _pbMenuEl.setAttribute('role','menu'); document.body.appendChild(_pbMenuEl);
  _pbMenuEl.addEventListener('click', function(ev){
    var row=ev.target.closest('[data-pbact]'); if(!row || row.disabled) return;
    ev.preventDefault(); ev.stopPropagation();
    var act=row.dataset.pbact; _closePlaybarMenu();
    if(act==='ban') _transportDislike();
    else if(act==='info' && window.toggleTrackPanel) toggleTrackPanel();
  });
  document.addEventListener('click', function(ev){
    if(!_pbMenuEl || !_pbMenuEl.classList.contains('show')) return;
    if(ev.target && ev.target.closest && (ev.target.closest('#pbMenu') || ev.target.closest('#pbMore,#pbItemMore'))) return;
    _closePlaybarMenu();
  });
  document.addEventListener('keydown', function(ev){ if(shortcutTargetBlocked(ev)) return; if(ev.key==='Escape') _closePlaybarMenu(); });
  window.addEventListener('resize', _closePlaybarMenu);
  window.addEventListener('scroll', function(){ if(_pbMenuEl&&_pbMenuEl.classList.contains('show')) _placePlaybarMenu(); }, true);
  return _pbMenuEl;
}
function _currentMenuHeader(){
  var it=_curItem(), title=_curName||'Track', sub='';
  if(it){
    title=it.name || title;
    if(it.kind==='gen') sub=(typeof LiveCtl!=='undefined' && LiveCtl.active())?'Live broadcast':'Generated';
    else if(it.kind==='chip'){ var info=_currentAlbumInfo(); sub=((info&&info.title)||_prettyName(it.s||''))+(info&&info.platform?' · '+info.platform:''); }
  }
  return '<div class="pbm-head"><div class="pbm-title">'+_pbMenuEsc(title)+'</div><div class="pbm-headsub">'+_pbMenuEsc(sub||'Retro Rave Radio')+'</div></div>';
}
function _renderPlaybarMenu(){
  var it=_curItem(), canItem=!!it;
  _ensurePlaybarMenu().innerHTML=_currentMenuHeader()+
    '<div class="pbm-actions">'+
    _pbMenuItem('ban','dislike','Ban this track','Skip it and keep it out of rotation',!canItem)+
    _pbMenuItem('info','info','View track info','Open technical and library details',!Audio.started)+
    '</div>';
}
function _playbarMenuAnchor(){
  var item=document.getElementById('pbItemMore'), main=document.getElementById('pbMore');
  if(item && document.body && document.body.classList.contains('ai-visual')){
    try{ if(getComputedStyle(item).display!=='none') return item; }catch(e){}
  }
  return main || item;
}
function _placePlaybarMenu(){
  var btn=_playbarMenuAnchor(), el=_ensurePlaybarMenu(); if(!btn) return;
  var r=btn.getBoundingClientRect(), w=el.offsetWidth||300, h=el.offsetHeight||300, pad=10;
  var left=Math.min(window.innerWidth-w-pad, Math.max(pad, r.right-w));
  var top=Math.min(window.innerHeight-h-pad, Math.max(pad, r.top-h-10));
  el.style.left=Math.round(left)+'px'; el.style.top=Math.round(top)+'px';
}
function _closePlaybarMenu(){ if(_pbMenuEl) _pbMenuEl.classList.remove('show'); var b=document.getElementById('pbMore'), ib=document.getElementById('pbItemMore'); if(b) b.classList.remove('on'); if(ib) ib.classList.remove('on'); }
function _togglePlaybarMenu(){
  var el=_ensurePlaybarMenu(), btn=_playbarMenuAnchor();
  if(el.classList.contains('show')){ _closePlaybarMenu(); return; }
  _renderPlaybarMenu(); el.classList.add('show'); if(btn) btn.classList.add('on');
  _placePlaybarMenu(); if(window.closeMixPanel) closeMixPanel();
}
function _transportDetail(){ if(window.toggleTrackPanel){ toggleTrackPanel(); } }
function _updatePlaybar(){ if(!_pbEl) buildPlaybar(); if(!_pbEl) return;
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(!Audio.started){ _listenStatsAt=0; _pbEl.classList.remove('show'); if(typeof _syncVisualChrome==='function') _syncVisualChrome(); return; }
  _listenStatsTick();
  _pbEl.classList.add('show');
  var title=_curName||'—', sub='';
  var liveOn=(typeof LiveCtl!=='undefined' && LiveCtl.active());
  if(liveOn){
    var n=(typeof window._presenceCount==='number') ? window._presenceCount : null;
    sub = (n!=null && n>0) ? ('LIVE · '+n+' listening') : 'LIVE';   // count is decoration: 'LIVE' alone when the worker is unreachable
  }
  var T=document.getElementById('pbTitle'), S=document.getElementById('pbSub'), C=document.getElementById('pbCover'), H=document.getElementById('pbHeart');
  if(T) T.textContent=title; if(S){ S.textContent=sub; S.classList.remove('link'); S.title=''; S.classList.toggle('live', liveOn); }
  if(C){ C.classList.remove('has-cover'); C.classList.add('no-cover'); C.innerHTML=''; }
  var it=_curItem();
  setPlaybarHeartLiked(H, !!(it && window._isLiked && _isLiked(it)));
  if(_pbMenuEl && _pbMenuEl.classList.contains('show')){ _renderPlaybarMenu(); _placePlaybarMenu(); }
  if(window.refreshVolumeDock) window.refreshVolumeDock();
  _syncPlayIcon();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
}
// MEDIA SESSION: register the page as a real music player so iOS/desktop lock-screen controls can
// show the current track, album art, and previous/play-pause/next controls. This deliberately reuses
// the existing transport functions so it does not disturb the background-safe audio path.
var _mediaSessionReady=false, _mediaSessionMetaKey='', _mediaArtCache={}, _mediaAnchorEl=null, _silentWavSrc='';
function _silentWavDataUri(){
  if(_silentWavSrc) return _silentWavSrc;
  const sr=8000, n=(sr*0.4)|0, len=44+n*2, buf=new ArrayBuffer(len), v=new DataView(buf);
  const wr=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
  wr(0,'RIFF'); v.setUint32(4,36+n*2,true); wr(8,'WAVE'); wr(12,'fmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true); v.setUint32(28,sr*2,true);
  v.setUint16(32,2,true); v.setUint16(34,16,true); wr(36,'data'); v.setUint32(40,n*2,true);
  let bin=''; const u8=new Uint8Array(buf); for(let i=0;i<u8.length;i++) bin+=String.fromCharCode(u8[i]);
  _silentWavSrc='data:audio/wav;base64,'+btoa(bin);
  return _silentWavSrc;
}
function _ensureMediaAnchor(){
  if(_mediaAnchorEl || typeof document==='undefined') return _mediaAnchorEl;
  try{
    var el=document.createElement('audio');
    el.setAttribute('playsinline','');
    el.setAttribute('aria-hidden','true');
    el.preload='auto'; el.loop=true; el.controls=false; el.src=_silentWavDataUri();
    el.style.position='fixed'; el.style.left='-9999px'; el.style.width='1px'; el.style.height='1px'; el.style.opacity='0'; el.style.pointerEvents='none';
    document.body.appendChild(el);
    _mediaAnchorEl=el;
  }catch(e){}
  return _mediaAnchorEl;
}
function _syncMediaAnchor(){
  var el=_ensureMediaAnchor(); if(!el) return;
  var shouldPlay=!!(Audio && Audio.started && !_transportIsPaused() && !(_watchOnly && !_watchMicActive));
  try{
    if(shouldPlay){
      var p=el.play(); if(p&&p.catch) p.catch(function(){});
    } else if(!el.paused) {
      el.pause();
    }
  }catch(e){}
}
function _stopMediaAnchor(reset){
  var el=_mediaAnchorEl; if(!el) return;
  try{ el.pause(); if(reset) el.currentTime=0; }catch(e){}
}
function _mediaSessionSupported(){
  return !!(typeof navigator!=='undefined' && navigator.mediaSession);
}
function _mediaMetadataSupported(){
  return typeof MediaMetadata!=='undefined';
}
function _mediaAbs(src){
  try{ return new URL(src, location.href).href; }catch(e){ return src; }
}
function _mediaHash(s){
  s=String(s||'Retro Rave Radio'); var h=2166136261>>>0;
  for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  return h>>>0;
}
function _mediaGeneratedArtwork(slug, title){
  var key=String(slug||title||'retro-rave-radio');
  if(_mediaArtCache[key]) return _mediaArtCache[key];
  try{
    var c=document.createElement('canvas'), g=c.getContext('2d'), h=_mediaHash(key);
    c.width=c.height=512;
    var a=(h%360), b=((h>>>8)%360), d=((h>>>16)%360);
    var grad=g.createLinearGradient(0,0,512,512);
    grad.addColorStop(0, 'hsl('+a+',86%,36%)');
    grad.addColorStop(0.52, 'hsl('+b+',90%,20%)');
    grad.addColorStop(1, 'hsl('+d+',92%,50%)');
    g.fillStyle=grad; g.fillRect(0,0,512,512);
    g.globalAlpha=.38;
    for(var y=28;y<512;y+=28){ g.fillStyle=(y/28)%2?'#000':'#fff'; g.fillRect(0,y,512,7); }
    g.globalAlpha=.9;
    for(var i=0;i<72;i++){
      var x=((h>>>(i%24))*37 + i*59) % 512, yy=((h>>>(i%21))*53 + i*83) % 512;
      var sz=5+((h+i*17)%28), hue=(a+i*19)%360;
      g.fillStyle='hsl('+hue+',96%,'+(58+(i%4)*8)+'%)';
      g.fillRect((x/8|0)*8,(yy/8|0)*8,(sz/8|0)*8||8,(sz/8|0)*8||8);
    }
    g.globalAlpha=1;
    g.fillStyle='rgba(8,6,18,.72)'; g.fillRect(54,330,404,112);
    g.fillStyle='#fcfcf8'; g.font='44px ui-monospace, Menlo, monospace'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText('RETRO RAVE', 256, 374);
    g.font='24px ui-monospace, Menlo, monospace'; g.fillStyle='rgba(252,252,248,.82)'; g.fillText('RADIO', 256, 414);
    _mediaArtCache[key]=c.toDataURL('image/png');
  }catch(e){
    _mediaArtCache[key]='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0a0814"/><text x="256" y="244" fill="#fcfcf8" font-family="monospace" font-size="54" text-anchor="middle">RETRO RAVE</text><text x="256" y="304" fill="#f878f8" font-family="monospace" font-size="54" text-anchor="middle">RADIO</text></svg>');
  }
  return _mediaArtCache[key];
}
function _mediaDescriptor(){
  var title=_curName||'Retro Rave Radio', artist='Retro Rave Radio', album='Retro Rave Radio', art=null;
  if(_nowSource==='generated'){
    album='Endless generated radio';
    artist='Retro Rave Radio';
    art=[{src:_mediaGeneratedArtwork(_curSlug,title), sizes:'512x512', type:'image/png'}];
  } else if(_nowSource==='watch'){
    title='Game visualizer';
    album='Screensaver mode';
  }
  if(!art) art=[{src:_mediaGeneratedArtwork('', title), sizes:'512x512', type:'image/png'}];
  return { title:title||'Retro Rave Radio', artist:artist||'Retro Rave Radio', album:album||'Retro Rave Radio', artwork:art };
}
function _syncMediaSession(force){
  if(!_mediaSessionSupported()) return;
  try{
    var ms=navigator.mediaSession;
    if(!Audio.started || (_watchOnly && !_watchMicActive)){ _clearMediaSession(); return; }
    var d=_mediaDescriptor();
    var k=[d.title,d.artist,d.album,d.artwork&&d.artwork[0]&&d.artwork[0].src].join('\n');
    if(_mediaMetadataSupported() && (force || k!==_mediaSessionMetaKey)){
      ms.metadata=new MediaMetadata(d);
      _mediaSessionMetaKey=k;
    }
    ms.playbackState=_transportIsPaused()?'paused':'playing';
    _syncMediaAnchor();
  }catch(e){}
}
function _clearMediaSession(){
  _stopMediaAnchor(true);
  if(!_mediaSessionSupported()) return;
  try{
    var ms=navigator.mediaSession;
    ms.playbackState='none';
    if(_mediaMetadataSupported()) ms.metadata=null;
    _mediaSessionMetaKey='';
  }catch(e){
    try{ navigator.mediaSession.playbackState='none'; }catch(_e){}
    _mediaSessionMetaKey='';
  }
}
function setupMediaSession(){
  if(!_mediaSessionSupported()) return; var ms=navigator.mediaSession;
  _ensureMediaAnchor();
  if(!_mediaSessionReady){
    _mediaSessionReady=true;
    try{
      ms.setActionHandler('play',  function(){ if(_transportIsPaused() || (Audio.running && !Audio.running())) _transportToggle(); else if(Audio.resume) Audio.resume(true); _syncMediaSession(true); });
      ms.setActionHandler('pause', function(){ if(!_transportIsPaused()) _transportToggle(); _syncMediaSession(true); });
      ms.setActionHandler('nexttrack',     function(){ _transportNext(); _syncMediaSession(true); });
      ms.setActionHandler('previoustrack', function(){ _transportPrev(); _syncMediaSession(true); });
      try{ ms.setActionHandler('stop', function(){ _transportStop(); _clearMediaSession(); }); }catch(_stopActionUnsupported){}
    }catch(e){}
  }
  _syncMediaSession(true);
}
function setMediaMeta(){
  _syncMediaSession(true);
}

// ============================================================
//  REACTIVE FAVICON — the CURRENT GAME'S character, live in the tab strip: it PULSES on the beat,
//  GLOWS/brightens with loudness (beatPulse), and its colour DRIFTS dynamically with the music's hue
//  (Tetris/Breakout cycle through block colours per bar). So you can glance at the tab and see it alive.
//  (Chrome/Firefox repaint dynamic favicons; Safari ignores them. Updates ~8fps; throttled while hidden.)
// ============================================================
(function(){
  if(typeof document==='undefined') return;
  // Safari ignores JS/canvas favicon updates -> leave the STATIC head favicon in place (don't fight it).
  var _ua=navigator.userAgent||'';
  if(/safari/i.test(_ua) && !/chrome|chromium|crios|android|edg|fxios|opr|opera/i.test(_ua)) return;
  var fc=document.createElement('canvas'); fc.width=fc.height=32; var fg=fc.getContext('2d');
  var link=document.querySelector('link[rel~="icon"]');
  if(!link){ link=document.createElement('link'); link.rel='icon'; document.head.appendChild(link); }
  link.type='image/png';
  var _favLast=0;
  function draw(){
    if(typeof Audio==='undefined' || !Audio.started || !Audio.vis || typeof Sprites==='undefined') return;
    if(typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive()) return;
    var nm=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    var gap=(typeof document!=='undefined'&&document.hidden)?900:200;   // ~5fps visible, ~1fps hidden — cheap, and you can't see faster in the tab strip anyway (MUSIC PRIORITY)
    if(nm-_favLast<gap) return; _favLast=nm;
    var v=Audio.vis(); if(!v) return;
    var key=(typeof curGameKey!=='undefined'&&curGameKey)||'random';
    var t=(typeof performance!=='undefined'&&performance.now?performance.now():0)/600;
    Sprites.favicon(fg, key, v, t);                                 // shared pixel-sprite registry: the REAL game character, beat-reactive
    try{ link.href=fc.toDataURL('image/png'); }catch(e){}
  }
  var _favTimer=0;
  function startFav(){
    if(_favTimer || (typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive())) return;
    _favTimer=setInterval(draw, 200);   // visible only; background audio-only stops the interval entirely.
  }
  function stopFav(){
    if(_favTimer){ clearInterval(_favTimer); _favTimer=0; }
  }
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('rrr-audio-only', function(ev){ if(ev&&ev.detail&&ev.detail.active) stopFav(); else startFav(); });
  }
  startFav();
})();
// audio engine calls this when the active preset changes; it must not override a fixed visualizer selection.
window.updatePresetUI = (key, P)=>{
  var fixedKey=fixedGamePref();
  if(fixedKey && key!==fixedKey){
    randomMode=false;
    if(curGameKey!==fixedKey || !selGame) showGame(fixedKey);
    if(typeof syncRadioUI==='function') syncRadioUI();
    updateNow();
    return;
  }
  if(fixedKey){
    randomMode=false;
    if(curGameKey!==fixedKey || !selGame) showGame(fixedKey);
  } else {
    randomMode=true;
    showGame('random');
  }
  if(typeof syncRadioUI==='function') syncRadioUI(); updateNow();
};

// iOS: the Web Audio API OBEYS the hardware Silent switch, so the AudioContext is muted on the phone
// SPEAKER in Silent Mode (it still plays to AirPods/Bluetooth). Playing a silent, looping <audio> element
// on a user gesture flips the page's audio session to "playback", so our music plays through Silent Mode
// like a radio/music app. Harmless no-op on desktop + Android.
let _silentEl = null;
function _needsSilentAudioUnlock(){
  if(typeof navigator==='undefined') return false;
  var ua=navigator.userAgent||'', p=navigator.platform||'';
  return /iPhone|iPad|iPod/i.test(ua) || (p==='MacIntel' && (navigator.maxTouchPoints||0)>1);
}
function unlockAudioSession(){
  if(!_needsSilentAudioUnlock()) return;
  try{
    if(!_silentEl) _silentEl = (typeof _ensureMediaAnchor==='function') ? _ensureMediaAnchor() : null;
    if(!_silentEl) return;
    const p = _silentEl.play(); if(p && p.catch) p.catch(()=>{});
  }catch(e){}
}

// ---- URL routing: /track/<slug> is the current generated track. Each generated song updates it via replaceState;
// loading a track URL reseeds that exact song. The GAME is NOT in the URL path; ?game= is a presentation setting.
// Route table: / (home) · /radio · /watch · /track/<slug>. Legacy heads redirect home. ----
function _pathParts(path){
  var p=String(path||location.pathname||'/').split('?')[0].replace(/^\/+|\/+$/g,'');
  if(!p) return [];
  return p.split('/').map(function(x){ try{ return decodeURIComponent(x); }catch(e){ return x; } });
}
function _generatedRoute(slug){ return '/track/'+encodeURIComponent(String(slug||'').toLowerCase()); }
function _queryFlag(name){
  try{
    var q=new URLSearchParams(location.search||'');
    var v=(q.get(name)||'').toLowerCase();
    return q.has(name) && v!=='0' && v!=='false' && v!=='no';
  }catch(e){ return false; }
}
function _readSlug(){
  var p = (location.pathname||'/').replace(/^\/+|\/+$/g,'');
  var parts=p ? p.split('/').map(function(x){ try{ return decodeURIComponent(x); }catch(e){ return x; } }) : [];
  parts=parts.map(function(x){ return String(x||'').toLowerCase(); });
  if(parts[0]==='track' && parts[1] && !parts[2] && /^[a-z0-9][a-z0-9._-]*$/.test(parts[1])) return parts[1];   // '.' = composer-id prefix
  return null;
}
function _routeQueryExtras(){                                 // ?game= survives track-route rewrites (presentation pref)
  try{
    var q=new URLSearchParams(location.search||'');
    var game=(q.get('game') || q.get('visual') || '').toLowerCase().trim();
    if(game && (game==='random' || _gameKeyKnown(game))) return '?game='+encodeURIComponent(game);
  }catch(e){}
  return '';
}
function syncRoute(slug){
  if(!slug || typeof history==='undefined' || !history.replaceState) return;
  if(typeof LiveCtl!=='undefined' && LiveCtl.active()) return;   // LIVE owns the /radio route: reload rejoins the broadcast, not a /track replay
  if(Audio.extActive && Audio.extActive()) return;   // an external source (mic/file) owns the URL — don't overwrite it with the generated slug
  var intro=document.getElementById('intro');
  if(intro && !intro.classList.contains('hidden') && getComputedStyle(intro).display!=='none') return;  // Home owns the root route while it is visible
  var want = _generatedRoute(slug) + _routeQueryExtras();
  if((location.pathname + (location.search||'')) !== want){ try{ history.replaceState(null,'',want); }catch(e){} }
}
window.addEventListener('popstate', ()=>{ if(!bootDone) return;
  if(window._productRouteTo && _productRouteTo(location.pathname+location.search)) return; // / · /radio · /watch (+ legacy heads) are product routes, not track history
  if(typeof Audio==='undefined' || !Audio.gotoTrack) return;
  var s=_readSlug(); if(s && s!==_curSlug){ _forkFromLive(); if(_watchOnly && typeof _exitWatchMode==='function') _exitWatchMode(); _trkHist=[s]; _trkI=0; Audio.gotoTrack(s); } });

// ===== TRACK READY: the engine fires this (with the slug) after each build. Reflect it in the URL + caption + media
//  metadata. RANDOM visual mode derives a deterministic game from the slug; fixed game selections stay pinned. =====
// record a generated track as "played" only if it's STILL the current song a few seconds later — rapid skips do not
// pollute Recently-played (a play = you actually listened). Chip albums record on album-open.
var _genPlayTimer=null;
function _maybeRecordGen(){ if(_genPlayTimer) clearTimeout(_genPlayTimer); var slug=_curSlug, name=_curName;
  _genPlayTimer=setTimeout(function(){ if(_curSlug===slug && slug && !(Audio.extActive&&Audio.extActive()) && window._recordGenPlay){ _recordGenPlay(slug,name); } }, 4000); }
function _onTrack(slug){
  if(_nowSource==='external' || (Audio.extActive&&Audio.extActive())) return;   // stale generated callbacks must not overwrite chip/mic/file titles
  _setGeneratedNowPlaying(slug);
  _noteGeneratedPlaying(slug);                                    // fp history (queue novelty) + Radio.setCurrent (learning)
  syncRoute(_curSlug);                                            // address bar -> /track/slug (updates every song)
  if(typeof setMediaMeta==='function') setMediaMeta(_curName);
  _maybeRecordGen();                                             // -> Recently played (unified with chip albums)
  _deriveGame(_curSlug);                                          // game visuals seeded from the same slug
}
// Apply the selected visualizer mode when a generated track changes. A fixed game stays pinned.
// RANDOM means a fresh non-repeating visualizer pick, not a slug-derived fixed game.
function _deriveGame(token){
  if(typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive()){
    _pendingVisualRefresh=true;
    return;
  }
  var fixedKey=fixedGamePref();
  if(fixedKey){
    randomMode=false;
    if(curGameKey!==fixedKey || !selGame) showGame(fixedKey);
    else if(typeof updateNow==='function') updateNow();
    return;
  }
  advanceRandomVisualizer();
}

// reveal the app (hide the intro, show the HUD). Idempotent.
// (a user gesture cleared the autoplay gate) — so a direct track link can skip the intro the moment sound starts.
let _revealed=false;
function revealApp(){
  if(_revealed) return; _revealed=true;
  if(document.documentElement) document.documentElement.classList.remove('boot-player-route');
  intro.classList.add('hidden');
  setTimeout(()=> intro.style.display='none', 500);
  hud.classList.add('show'); presetsBar.classList.add('show');
  if(typeof syncBrowseButton==='function') syncBrowseButton();
  if(typeof syncRadioUI==='function') syncRadioUI();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(!window._radioTick) window._radioTick = setInterval(()=>{ if(Audio.started && !(typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive())){ syncTempoUI(); updateNow(); } }, 700);   // keep bpm/now-line live only while the UI is visible
}
function startAudio(viaGesture, opts){
  if(viaGesture && typeof viaGesture==='object'){ opts=viaGesture; viaGesture=!!opts.viaGesture; }
  opts=opts||{};
  if(!bootDone){
    bootDone = true;
    var _wantSlug = _readSlug();               // capture any shared generated-track slug before booting audio
    if(typeof Radio!=='undefined'){
      Radio.init();
      // PREV/NEXT walk a session HISTORY of slugs; a NEW skip mints a fresh random name (no deterministic ordering — but
      // every slug still plays the same song forever). The engine mints via _radioMint for auto-advance + plain skips.
      window.onRadioGame = g => { setUrlGamePref(g); randomMode = (g==='random'); showGame(g); };   // game selector = visual layer; ?game= makes it reloadable for testing
      window.onRadioNext = () => { _forkFromLive(); if(_trkI < _trkHist.length-1){ _trkI++; Audio.gotoTrack(_trkHist[_trkI]); } else if(Audio.nextMovement){ Audio.nextMovement(); } };   // forward in history, else a fresh track (thumbDown reaches here directly, bypassing _transportNext — fork here too)
      window.onRadioPrev = () => { _forkFromLive(); if(_trkI>0 && Audio.gotoTrack){ _trkI--; Audio.gotoTrack(_trkHist[_trkI]); }
        else if(_curSlug && Audio.gotoTrack){ Audio.gotoTrack(_curSlug); } };   // back through history; at the head, restart the current generated track
      if(Audio.onMintToken) Audio.onMintToken(_radioMint);          // engine asks the runtime to mint each fresh track's TOKEN (fp-scored queue)
      if(Audio.onTrackReady) Audio.onTrackReady(_onTrack);          // after each build: URL + caption + game, derived from the slug (registered BEFORE the first track)
      Audio.init(opts.external ? {external:{source:'chip'}} : undefined);
      if(!opts.external){
        _nowSource='generated';
        if(Radio.state.tempo!=null) Audio.setTempo(Radio.state.tempo);
        // START at the shared slug from the URL (reproduces that exact song — always a PRIVATE
        // replay), else: live intent set (fresh default) -> tune the shared broadcast mid-track;
        // otherwise MINT a fresh random-named track for a private endless session.
        if(!_wantSlug && typeof LiveCtl!=='undefined' && typeof Radio!=='undefined' && Radio.live && Radio.live() && LiveCtl.join()){
          _station='generated';
        } else {
          var _startSlug = _wantSlug || _mintToken();
          _trkHist = [_startSlug]; _trkI = 0;                   // history starts clean at the start track
          if(Audio.gotoTrack) Audio.gotoTrack(_startSlug);
        }
      }
      Audio.resume(!!viaGesture);
      setupMediaSession();                                    // register as a real MEDIA SESSION so the browser keeps the tab playing all day in the background (+ media-key / lock-screen controls)
      if(typeof Presence!=='undefined' && Presence.start) Presence.start();   // live listener count + clock check (pure decoration)
    } else {
      Audio.init(opts.external ? {external:{source:'chip'}} : undefined); Audio.resume(!!viaGesture);
    }
  }
  if(Audio.resume) Audio.resume(!!viaGesture);
  if(viaGesture && typeof unlockAudioSession==='function') unlockAudioSession();
  if(typeof _syncWakeLock==='function') _syncWakeLock();
  // a user gesture clears the autoplay gate -> reveal now. An AUTOSTART (direct track link, no gesture) STILL drops
  // you straight into the game — we reveal immediately and arm the first tap/key to start the sound (the browser
  // won't let audio play with zero interaction), nudged by a small hint instead of the full intro menu.
  revealApp();
  if(!(viaGesture || (Audio.running && Audio.running()))) armSoundGesture();
  else if(viaGesture){
    setTimeout(function(){
      if(Audio.started && Audio.running && !Audio.running() && !(Audio.isPaused&&Audio.isPaused())) armSoundGesture();
      if(typeof _syncPlayIcon==='function') _syncPlayIcon();
    }, 250);
  }
}
function primeAudioUnlock(external){
  if(typeof Audio==='undefined') return;
  try{
    if(!Audio.started && Audio.init) Audio.init(external ? {external:{source:'chip'}} : undefined);
    if(Audio.resume) Audio.resume(true);
    if(typeof unlockAudioSession==='function') unlockAudioSession();
  }catch(e){}
}
// just the nudge: a small "tap anywhere to start the music" hint while audio is gated (the GLOBAL first-gesture
// handler below actually starts it on any interaction).
function armSoundGesture(){
  if(Audio.running && Audio.running()) return;
  var hint=document.getElementById('soundhint');
  if(!hint){ hint=document.createElement('div'); hint.id='soundhint'; hint.innerHTML=
    '<div class="sh-card">'+
      '<div class="sh-brand">Retro Rave Radio</div>'+
      '<div class="sh-title">'+svgIcon('spkOn')+'<span>Tap anywhere to start</span></div>'+
      '<div class="sh-copy">Endless retro music that keeps making itself. Mini games that move to the beat.</div>'+
      '<div class="sh-keys" aria-label="Game controls"><div class="sh-key-row top"><span>↑</span></div><div class="sh-key-row"><span>←</span><span>↓</span><span>→</span></div></div>'+
      '<div class="sh-note">Play with the arrow keys, or just watch.</div>'+
    '</div>'; document.body.appendChild(hint); }
  hint.classList.add('show');
}
document.getElementById('start').addEventListener('click', ()=>startAudio(true));   // (hidden now; the HOME station tiles are the entry)
// THE WHOLE PAGE captures the first interaction (direct track links + "tap anywhere to start"). BUT on the HOME
// chooser the station TILES are the explicit entry, so stand down while it's showing.
function _gestureLaunchTarget(ev){
  var t=ev&&ev.target; if(!t||!t.closest) return null;
  return t.closest('[data-st],#start,#pbPlay');
}
function _gestureWantsExternal(el){ return false; }   // every station is the generated radio now (mic/file boot audio in their own handlers)
function _gestureShouldResumePaused(ev){
  if(!ev || !/^(pointerdown|mousedown|click|touchstart)$/.test(ev.type)) return false;
  if(shortcutTargetBlocked(ev)) return false;
  return !!(typeof _transportIsPaused==='function' && _transportIsPaused());
}
function _resumePausedFromGesture(ev){
  if(!_gestureShouldResumePaused(ev)) return false;
  _suppressSceneInputUntil=((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())+420;
  _transportToggle();
  if(Audio.resume) Audio.resume(true);
  if(typeof unlockAudioSession==='function') unlockAudioSession();
  var h=document.getElementById('soundhint'); if(h) h.classList.remove('show');
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
  if(Audio.running && Audio.running()) _audioUnlockEvents.forEach(function(t){ document.removeEventListener(t,_firstGesture,true); });
  else armSoundGesture();
  return true;
}
function _firstGesture(ev){
  if(shortcutTargetBlocked(ev)) return;
  var intro=document.getElementById('intro');
  if(!bootDone && intro && !intro.classList.contains('hidden') && getComputedStyle(intro).display!=='none'){
    var launch=_gestureLaunchTarget(ev);
    if(!launch) return;   // Home is up -> only launcher/play controls start audio
    // Launcher/library controls start audio inside their own click handlers. Do not prime here:
    // pre-routing Web Audio has caused audible chirps before the real source is connected.
    if(launch.matches && launch.matches('#start,#pbPlay')) primeAudioUnlock(_gestureWantsExternal(launch));
    return;
  }
  if(_watchOnly && !_watchMicActive) return;
  if(_resumePausedFromGesture(ev)) return;
  startAudio(true);
  if(Audio.resume) Audio.resume(true);
  if(typeof unlockAudioSession==='function') unlockAudioSession();
  var h=document.getElementById('soundhint'); if(h) h.classList.remove('show');
  if(Audio.running && Audio.running()) _audioUnlockEvents.forEach(function(t){ document.removeEventListener(t,_firstGesture,true); });
  else armSoundGesture();
}
const _audioUnlockEvents=['pointerdown','mousedown','click','keydown','touchstart','wheel'];
_audioUnlockEvents.forEach(function(t){ document.addEventListener(t,_firstGesture,true); });
let _station='generated', _micStream=null, _fileSrc=null;
// DIRECT GENERATED TRACK LINK (/track/<phrase>-<code8>): drop straight into the game (skip the menu); audio resumes on
// the first interaction above. Autoplay-allowed browsers start instantly; others show the hint until you touch anything.
if(typeof _readSlug==='function' && _readSlug()){
  if(document.body) document.body.classList.add('ai-visual');
  startAudio(false);
}

// =====================================================================================================
//  INPUT SOURCES. The games visualize the GENERATED radio, your LIKED tracks, dropped
//  audio files, or the MIC. Non-generated modes route external audio through
//  Audio.playExternal() so the analyser drives the beat clock; switching back calls Audio.stopExternal().
// =====================================================================================================
function _setTransportPlaying(){
  if(typeof Radio!=='undefined' && Radio.state && !Radio.state.playing && Radio.playPause) Radio.playPause();
  else if(Audio.setPlaying) Audio.setPlaying(true);
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
}
function _backToGenerated(){ if(typeof _exitWatchMode==='function') _exitWatchMode(); _clearPlaybackQueue(); var wasExt = Audio.extActive && Audio.extActive(); if(Audio.stopExternal) Audio.stopExternal(); _station='generated'; _nowSource='generated';
  if(window._applyMixScopeForSource) window._applyMixScopeForSource();
  if(window.refreshMixPanel) window.refreshMixPanel();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  // returning from an external source (chip/mic/file): the paused generative track can come back silent
  // (a long external session makes the scheduler resume-guard fast-forward it past its arrangement), so start FRESH.
  if(wasExt && Audio.gotoTrack) Audio.gotoTrack(_nextGeneratedToken()); }
// play a SPECIFIC generated track by its slug (from a Recently-played / Liked card) — leaves any chip source, reseeds that song
function _playGenerated(slug, opts){ opts=opts||{}; if(typeof _exitWatchMode==='function') _exitWatchMode(); if(!opts.keepQueue) _clearPlaybackQueue(); if(typeof startAudio==='function') startAudio(true);
  _forkFromLive();   // explicit track pick (card/playlist/deep link) leaves the broadcast — placed AFTER startAudio (cold boot joins live there)
  _setTransportPlaying();
  if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal();
  _station='generated'; _nowSource='generated';
  if(window._applyMixScopeForSource) window._applyMixScopeForSource();
  if(window.refreshMixPanel) window.refreshMixPanel();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(slug && Audio.gotoTrack){ _trkHist=[slug]; _trkI=0; Audio.gotoTrack(slug); }
  if(typeof hideHome==='function') hideHome(); }
window._playGenerated=_playGenerated;
// ===== TILE 1: Start Endless Radio — mint a fresh fp-scored token, play it, and put its route in the bar. =====
function _startEndlessRadio(){
  // live intent set (fresh install default / persisted "tuned in") -> the Everything broadcast
  // IS the endless radio; only a fork demotes to the private mint below. If already engaged
  // (back-button to /radio while live), stay put — don't fall through and mint a private track.
  if(typeof LiveCtl!=='undefined' && typeof Radio!=='undefined' && Radio.live && Radio.live()){
    if(LiveCtl.active()){ if(typeof hideHome==='function') hideHome(); return; }
    _startLiveRadio(); return;
  }
  if(typeof _exitWatchMode==='function') _exitWatchMode();
  _clearPlaybackQueue();
  var alreadyBooted=!!bootDone;
  if(typeof startAudio==='function') startAudio(true);
  _setTransportPlaying();
  if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal();
  _station='generated'; _nowSource='generated';
  if(alreadyBooted && Audio.gotoTrack){ var tok=_nextGeneratedToken(); _trkHist=[tok]; _trkI=0; Audio.gotoTrack(tok); }
  if(window._applyMixScopeForSource) window._applyMixScopeForSource();
  if(window.refreshMixPanel) window.refreshMixPanel();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof hideHome==='function') hideHome();
  if(_curSlug && typeof syncRoute==='function') syncRoute(_curSlug);   // replaceState -> /track/<slug> once the engine reports it
}
window._startEndlessRadio=_startEndlessRadio;
async function _playMic(){
	  _forkFromLive();   // switching to an external source leaves the broadcast (badge would otherwise lie + tick would yank the return)
	  _clearPlaybackQueue();
	  try{ const ctx=Audio.audioCtx(); if(!ctx) return false;
	    _setTransportPlaying();
	    _setExternalNowPlaying('Room microphone');
	    if(!_micStream) _micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const src=ctx.createMediaStreamSource(_micStream);
    const boost=ctx.createGain(); boost.gain.value=8; src.connect(boost);     // amplify so quiet sounds (speech) drive the visuals
    Audio.playExternal(boost, {source:'mic', monitor:false});                   // ANALYSE ONLY — never play the mic back (no echo/feedback)
    _station='mic'; if(window._applyMixScopeForSource) window._applyMixScopeForSource(); if(window.refreshMixPanel) window.refreshMixPanel(); return true;
  }catch(e){ if(window._toast)_toast('Microphone blocked — allow mic access'); return false; } }
function _stopMicStream(){
  if(_micStream){ try{ _micStream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} }); }catch(e){} _micStream=null; }
}
function _captureMicReturnState(){
  var wasGenerated=(_nowSource==='generated' && !(Audio.extActive&&Audio.extActive()));
  var slug=wasGenerated ? (_curSlug || ((Audio.trackToken&&Audio.trackToken()) || '') || (typeof _readSlug==='function'&&_readSlug()) || '') : '';
  return {
    station:_station,
    nowSource:_nowSource,
    slug:slug,
    name:_curName,
    live:!!(typeof LiveCtl!=='undefined' && LiveCtl.active()),
    route:(location.pathname||'/')+(location.search||'')
  };
}
function _captureWatchReturnState(){
  var item=null;
  try{ item=(typeof _curItem==='function') ? _curItem() : null; }catch(e){}
  if(!item && _nowSource==='generated'){
    var slug=_curSlug || ((Audio.trackToken&&Audio.trackToken()) || '') || (typeof _readSlug==='function'&&_readSlug()) || '';
    if(slug) item={kind:'gen', slug:slug, name:_curName||_deslug(slug)};
  }
  if(!item) return null;
  var q=null;
  try{ q=(_queue&&_queue.length) ? _queue.map(_queueItem).filter(Boolean) : null; }catch(e2){ q=null; }
  return {
    item:_queueItem(item),
    queue:q,
    queueI:Math.max(0,_queueI|0),
    station:_station,
    nowSource:_nowSource,
    name:_curName,
    live:!!(typeof LiveCtl!=='undefined' && LiveCtl.active()),
    route:(location.pathname||'/')+(location.search||'')
  };
}
function _restoreWatchQueue(st){
  if(st && st.queue && st.queue.length){
    _queue=st.queue.map(_queueItem).filter(Boolean);
    _queueI=Math.max(0, Math.min(st.queueI|0, _queue.length-1));
    return !!_queue.length;
  }
  _clearPlaybackQueue();
  return false;
}
function _resumeMusicFromWatch(){
  var st=_watchReturnState; if(!st) return;
  _watchReturnState=null;
  _watchOnly=false; _watchMicActive=false;
  _stopMicStream();
  // was tuned to the broadcast before watch: rejoin the schedule (a private replay of the
  // captured slug would silently demote live) — the join resolves the CURRENT on-air track.
  if(st.live && typeof _startLiveRadio==='function'){ _startLiveRadio(); return; }
  var hasQueue=_restoreWatchQueue(st);
  var item=st.item || null;
  var played=false;
  if(item && typeof _playListItem==='function') played=_playListItem(item, {keepQueue:hasQueue});
  if(!played && typeof _startEndlessRadio==='function') _startEndlessRadio();
  if(typeof hideHome==='function') hideHome();
  if(window._applyMixScopeForSource) window._applyMixScopeForSource();
  if(window.refreshMixPanel) window.refreshMixPanel();
  if(typeof updateNow==='function') updateNow();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
  if(typeof setupMediaSession==='function') setupMediaSession();
}
function _restoreAfterVisualizerMic(){
  var st=_micReturnState; _micReturnState=null;
  _watchOnly=false; _watchMicActive=false;
  _stopMicStream();
  try{ if(Audio.setPlaying) Audio.setPlaying(false); }catch(e){}
  try{ if(typeof Radio!=='undefined' && Radio.state) Radio.state.playing=false; }catch(e){}
  try{ if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal(); }catch(e){}
  try{ if(Audio.setPlaying) Audio.setPlaying(false); }catch(e2){}
  try{ if(typeof Radio!=='undefined' && Radio.state) Radio.state.playing=false; }catch(e3){}
  if(st){
    _station=st.station||'generated';
    _nowSource=st.nowSource||'generated';
    _curName=st.name||_curName||'Retro Rave Radio';
    if(st.nowSource==='generated' && st.slug){
      _station='generated';
      _nowSource='generated';
      _curSlug=st.slug;
      try{ if(Audio.gotoTrack) Audio.gotoTrack(st.slug); }catch(e4){}
      try{ if(Audio.setPlaying) Audio.setPlaying(false); }catch(e5){}
      try{ if(typeof Radio!=='undefined' && Radio.state) Radio.state.playing=false; }catch(e6){}
      try{ if(typeof syncRoute==='function') syncRoute(st.slug); }catch(e7){}
    }
  }
  if(window._applyMixScopeForSource) window._applyMixScopeForSource();
  if(window.refreshMixPanel) window.refreshMixPanel();
  if(typeof updateNow==='function') updateNow();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
  if(typeof setupMediaSession==='function') setupMediaSession();
}
function _stopAudiblePlaybackForWatch(){
  if(typeof LiveCtl!=='undefined') LiveCtl.stop();   // disengage the schedule (INTENT survives in the captured return state)
  _clearPlaybackQueue();
  try{ if(typeof _closePlaybarMenu==='function') _closePlaybarMenu(); }catch(e){}
  try{ if(window.closeMixPanel) window.closeMixPanel(); }catch(e){}
  try{ if(window.closeTrackPanel) window.closeTrackPanel(); }catch(e){}
  try{ if(_genPlayTimer){ clearTimeout(_genPlayTimer); _genPlayTimer=null; } }catch(e){}
  try{ if(_fileSrc){ _fileSrc.stop(); _fileSrc=null; } }catch(e){}
  try{ if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal(); }catch(e){}
  try{ if(Audio.setPlaying) Audio.setPlaying(false); }catch(e){}
  try{ if(typeof Radio!=='undefined' && Radio.state) Radio.state.playing=false; }catch(e){}
  try{ if(typeof _clearMediaSession==='function') _clearMediaSession(); }catch(e){}
}
function _exitWatchMode(){
  if(_watchMicActive){ _stopMicStream(); try{ if(Audio.extActive && Audio.extActive() && Audio.stopExternal) Audio.stopExternal(); }catch(e){} }
  _watchOnly=false; _watchMicActive=false;
  _watchReturnState=null;
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
}
function enterWatchMode(opts){
  opts=opts||{};
  _watchReturnState=opts.resumeMusic ? _captureWatchReturnState() : null;
  _watchOnly=true; _watchMicActive=false; _station='watch'; _nowSource='watch';
  _watchAnchorMs=_WALLPAPER_MODE ? (_nowMs()-Date.now()) : _nowMs();   // wallpaper: shared wall-clock epoch so every display's beat grid is in phase (else per-entry anchor)
  _stopMicStream();
  _stopAudiblePlaybackForWatch();
  if(!opts.noRoute && typeof history!=='undefined' && history.replaceState && (location.pathname||'/')!=='/watch'){
    try{ history.replaceState(null,'','/watch'+_routeQueryExtras()); }catch(e){}
  }
  if(document.documentElement) document.documentElement.classList.remove('boot-player-route');
  var fixedKey = (opts.game && GAME_BY_KEY[opts.game]) ? opts.game : fixedGamePref();
  if(fixedKey){
    randomMode=false;
    if(curGameKey!==fixedKey || !selGame) showGame(fixedKey);
  } else {
    randomMode=true;
    if(!selGame) showGame('random');
  }
  revealApp();
  if(typeof updateNow==='function') updateNow();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
  if(typeof _clearMediaSession==='function') _clearMediaSession();
}
async function _toggleWatchMic(){
  return _toggleVisualizerMic();
}
async function _toggleVisualizerMic(){
  if(_watchMicActive){
    _restoreAfterVisualizerMic();
    return;
  }
  _micReturnState=_captureMicReturnState();
  if(!_watchOnly) _stopAudiblePlaybackForWatch();
  else enterWatchMode();
  startAudio(true, {external:true});
  var ok=await _playMic();
  if(!ok){
    _restoreAfterVisualizerMic();
    return;
  }
  _watchOnly=true; _watchMicActive=true; _nowSource='external'; _curName='Room microphone';
  if(typeof updateNow==='function') updateNow();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(typeof _syncPlayIcon==='function') _syncPlayIcon();
}
window.enterWatchMode=enterWatchMode;
window._transportStop=_transportStop;
async function _playFile(file){ _forkFromLive(); _clearPlaybackQueue(); try{ const ctx=Audio.audioCtx(); if(!ctx) return false;
  _setTransportPlaying();
  if(Audio.playExternal) Audio.playExternal(null, {source:'file'});
  const buf=await ctx.decodeAudioData(await file.arrayBuffer());
  if(_fileSrc){ try{ _fileSrc.stop(); }catch(e){} }
  _fileSrc=ctx.createBufferSource(); _fileSrc.buffer=buf; _fileSrc.loop=true; Audio.playExternal(_fileSrc); _fileSrc.start(); _station='file';
  if(window._applyMixScopeForSource) window._applyMixScopeForSource(); if(window.refreshMixPanel) window.refreshMixPanel();
  _setExternalNowPlaying(file.name.replace(/\.[^.]+$/,'')); return true;
}catch(e){ if(window._toast)_toast('Could not play that file'); return false; } }

function _prettyName(fn){ try{ fn=decodeURIComponent(fn); }catch(e){} return String(fn).replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').replace(/([a-z])([A-Z0-9])/g,'$1 $2').replace(/\s+/g,' ').trim(); }
function _shuffle(a){ a=a.slice(); for(var i=a.length-1;i>0;i--){ var j=(Math.random()*(i+1))|0, t=a[i]; a[i]=a[j]; a[j]=t; } return a; }
const _GEN_MIX_KEYS=['master','lead','bass','kick','snare','hat','arp','pad','fx'];
const _ALL_MIX_KEYS=_GEN_MIX_KEYS;
const _SESSION_MIX={};                                                                        // in-memory only: refresh resets tempo/EQ
function _mixScopeKey(){
  if(_station==='generated' || _station==='liked') return 'generated';
  return 'source:'+(_station||'generated');
}
function _scopeMix(scope){ scope=scope||_mixScopeKey(); return _SESSION_MIX[scope] || (_SESSION_MIX[scope]={}); }
function _scopeMixValue(scope, key){ var s=_scopeMix(scope); return (typeof s[key]==='number') ? s[key] : 1; }
function _applyMixScopeForSource(){
  if(!Audio || !Audio.setMix) return _mixScopeKey();
  var scope=_mixScopeKey();
  _ALL_MIX_KEYS.forEach(function(k){ Audio.setMix(k, _scopeMixValue(scope, k)); });
  return scope;
}
window._applyMixScopeForSource=_applyMixScopeForSource;
window._sessionMixScope=_mixScopeKey;
window._sessionMixGet=function(){ var scope=_mixScopeKey(), out={}; _ALL_MIX_KEYS.forEach(function(k){ out[k]=_scopeMixValue(scope,k); }); return out; };
window._sessionMixSet=function(key, val){ var scope=_mixScopeKey(); _scopeMix(scope)[key]=Math.max(0, Math.min(3, +val||0)); if(Audio&&Audio.setMix) Audio.setMix(key, _scopeMix(scope)[key]); return _scopeMix(scope)[key]; };
window._sessionMixReset=function(keys){ var scope=_mixScopeKey(), s=_scopeMix(scope); (keys||_ALL_MIX_KEYS).forEach(function(k){ s[k]=1; if(Audio&&Audio.setMix) Audio.setMix(k,1); }); };
// ===== HOME: pick a STATION. Each station is a lead-presence mood of the generated
//  radio (Everything mixes all three), fronted by a game character sprite. =====
const HOME_TILES = [
  { id:'st-any',    mood:'any',    sprite:'pacman',  name:'Everything!',  desc:'The full mix — every mood in rotation.',      c:'#ffd23e' },
  { id:'st-sparse', mood:'sparse', sprite:'balloon', name:'Mellow',       desc:'Laid-back grooves, melody as a garnish.',     c:'#5ee08a' },
  { id:'st-none',   mood:'none',   sprite:'tetris',  name:'Instrumental', desc:'Pure grooves. No lead line at all.',          c:'#4fd8f8' },
  { id:'st-full',   mood:'full',   sprite:'mario',   name:'Melodic',      desc:'Hook-driven chiptunes, front and center.',    c:'#ff5d5d' },
];
function _homeEsc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function _homeTile(t){
  var img='';
  try{ if(typeof Sprites!=='undefined'&&Sprites.dataURL) img='<img class="htchar" alt="" src="'+Sprites.dataURL(t.sprite,96)+'">'; }catch(e){}
  return '<button class="hometile station" data-st="'+_homeEsc(t.id)+'" style="--stc:'+_homeEsc(t.c)+'">'+
    '<span class="htico">'+(img||svgIcon('shuffle'))+'</span><span class="httxt"><span class="htname">'+_homeEsc(t.name)+'</span><span class="htdesc">'+_homeEsc(t.desc)+'</span></span></button>';
}
function _showProductHomeShell(){
  var intro=document.getElementById('intro'), el=document.getElementById('hometiles');
  if(!intro || !el) return null;
  if(typeof closeMixPanel==='function') closeMixPanel();
  if(typeof _closePlaybarMenu==='function') _closePlaybarMenu();
  if(document.documentElement) document.documentElement.classList.remove('boot-player-route');
  window.__RRR_BOOT_PLAYER_ROUTE=false;
  _revealed=false; intro.style.display=''; intro.classList.remove('hidden','lib'); intro.classList.add('product-home');
  el.classList.remove('lib','product-mode','project-mode');
  return el;
}
function buildHomeTiles(){ var el=_showProductHomeShell(); if(!el) return;
  el.innerHTML = '<div class="stlabel">Select your station:</div><div class="strow">'+HOME_TILES.map(_homeTile).join('')+'</div>';
  if(!el._wired){ el._wired=true; el.addEventListener('click', function(ev){ var tile=ev.target.closest('.hometile'); if(!tile) return; ev.stopPropagation(); enterStation(tile.dataset.st); }); }
}
window.buildHomeTiles=buildHomeTiles;
function openProductHome(opts){
  opts=opts||{};
  buildHomeTiles();
  if(!opts.noRoute && typeof history!=='undefined' && history.pushState && (location.pathname+location.search)!=='/'){
    try{ (opts.replace&&history.replaceState ? history.replaceState : history.pushState).call(history,{product:1},'','/'); }catch(e){}
  }
  if(typeof syncBrowseButton==='function') syncBrowseButton();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
}
window.openProductHome=openProductHome;
// ----- route table: / · /radio · /browse[...] (library-owned) · /watch · /track/<slug>.
//  Legacy heads (listen|play|create|wip) replaceState home. Returns false for library/track routes. -----
function _productRouteFromPath(path){
  var head=String(_pathParts(path)[0]||'').toLowerCase();
  if(!head) return {mode:'root'};
  if(head==='radio') return {mode:'radio'};
  if(head==='watch') return {mode:'watch'};
  if(head==='listen'||head==='play'||head==='create'||head==='wip') return {mode:'root', legacy:true};
  return null;
}
window._productRouteTo=function(path, opts){
  var r=_productRouteFromPath(path);
  if(!r) return false;
  opts=Object.assign({replace:true}, opts||{});
  if(r.legacy && typeof history!=='undefined' && history.replaceState){ try{ history.replaceState(null,'','/'); }catch(e){} }
  if(r.mode==='radio'){ _startEndlessRadio(); return true; }
  if(r.mode==='watch'){ enterWatchMode({noRoute:true}); return true; }
  openProductHome(opts);
  return true;
};
// ----- station entry: the three tiles + every music-pack id + mic + liked. -----
function enterStation(id){
  id=String(id||'');
  var mst=null;
  for(var hi=0;hi<HOME_TILES.length;hi++) if(HOME_TILES[hi].id===id){ mst=HOME_TILES[hi]; break; }
  if(mst){
    try{ if(typeof Radio!=='undefined'&&Radio.setMood) Radio.setMood(mst.mood); }catch(e){}
    // Everything! = the shared LIVE broadcast (what everyone hears right now); mood tiles are
    // private by construction (setMood already cleared the live intent for non-any moods).
    if(mst.mood==='any'){ _startLiveRadio(); return; }
    _startEndlessRadio(); return;
  }
  if(id==='radio' || id==='generated'){ _startEndlessRadio(); return; }
  if(id==='watch'){ enterWatchMode(); return; }
  if(typeof _exitWatchMode==='function') _exitWatchMode();
  if(id==='mic'){ startAudio(true, {external:true}); _playMic(); hideHome(); return; }
  if(id==='liked'){
    startAudio(true);
    var L=_playlistItems('liked');
    if(L.length) _playSection('liked'); else if(window._toast)_toast('No liked tracks yet — heart some first');
    _station='liked'; if(window._applyMixScopeForSource) window._applyMixScopeForSource(); if(window.refreshMixPanel) window.refreshMixPanel(); if(typeof _syncVisualChrome==='function') _syncVisualChrome(); hideHome(); return;
  }
  _clearPlaybackQueue();
  if(window._toast) _toast('Unknown station "'+id+'"');
}
function hideHome(){ if(typeof revealApp==='function') revealApp(); }                 // revealApp() hides #intro (= the Home)
function showHome(){ var intro=document.getElementById('intro'); if(!intro) return; if(typeof _exitWatchMode==='function') _exitWatchMode(); if(document.documentElement) document.documentElement.classList.remove('boot-player-route'); window.__RRR_BOOT_PLAYER_ROUTE=false; _revealed=false; intro.style.display=''; intro.classList.remove('hidden'); openProductHome({replace:true}); if(typeof syncBrowseButton==='function') syncBrowseButton(); if(typeof _syncVisualChrome==='function') _syncVisualChrome(); }
// reveal/dismiss the library overlay WITHOUT changing the current view (used by the transport bar so the queue/detail
// shows over the scene; revealApp() had hidden #intro while a game scene plays, which is why taps "did nothing").
window._hideLibContainer=function(){ var intro=document.getElementById('intro'); if(!intro) return; _revealed=true; intro.classList.add('hidden'); setTimeout(function(){ if(_revealed) intro.style.display='none'; }, 500); };
// ----- WATCH CHROME: a pointer-reveal strip (Home · game picker · mic) that auto-hides after 3s.
//  Reuses the controls-active machinery; CSS shows it only under body.watch-visual. -----
function buildWatchChrome(){
  if(document.getElementById('watchbar') || !document.body) return;
  var bar=document.createElement('div'); bar.id='watchbar';
  function mk(id, icon, label, fn){
    var b=document.createElement('button'); b.id=id; b.type='button';
    b.innerHTML=svgIcon(icon)+'<span>'+label+'</span>';
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); if(typeof _pokeVisualControls==='function') _pokeVisualControls(); fn(); });
    bar.appendChild(b); return b;
  }
  mk('wbHome','home','home', function(){ showHome(); });
  mk('wbGame','play','choose game', function(){ if(typeof toggleGamePicker==='function') toggleGamePicker(); });
  mk('wbMic','mic','room mic', function(){ if(typeof _toggleWatchMic==='function') _toggleWatchMic(); });
  document.body.appendChild(bar);
}
buildWatchChrome();
// ----- GLOBAL DROP dispatch: .zip -> pack import · audio file -> party visualizer · anything else ignored. -----
window.addEventListener('dragover', function(ev){ ev.preventDefault(); });
window.addEventListener('drop', function(ev){ ev.preventDefault();
  var f=ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if(!f) return;
  if(/\.zip$/i.test(f.name||'') || /\bzip\b/.test(f.type||'')){
    if(typeof Packs!=='undefined' && Packs.importZip){ Packs.importZip(f); if(window._toast)_toast('importing pack: '+f.name); }
    else if(window._toast) _toast('pack import is unavailable');
    return;
  }
  if(/audio\/|\.(mp3|wav|ogg|flac|m4a|aac)$/i.test((f.type||'')+(f.name||''))){
    if(typeof _exitWatchMode==='function') _exitWatchMode();
    startAudio(true, {external:true}); _playFile(f); hideHome();
  }
});
// ----- PACKS wiring: registry (+picker) refresh once packs land, and on every later change. -----
if(typeof Packs!=='undefined' && Packs.init){
  try{
    Packs.init().then(function(){ _onGamePacksChanged(); setTimeout(_warmAllGames, 1200); },
                      function(){ _onGamePacksChanged(); setTimeout(_warmAllGames, 1200); });
    if(Packs.onChange) Packs.onChange(function(){
      _onGamePacksChanged();
      if(typeof _updatePlaybar==='function' && typeof Audio!=='undefined' && Audio.started && !_backgroundUiDormant()) _updatePlaybar();
    });
  }catch(e){}
}
// ----- BOOT ROUTE: home by default; /watch and /radio act immediately; legacy heads collapse to '/'. -----
// deep-linkable radio mood: ?mood=full|sparse|none pins the generated genre (like ?game=)
try{
  var _mq=new URLSearchParams(location.search||'').get('mood');
  if(_mq && typeof Radio!=='undefined' && Radio.setMood) Radio.setMood(String(_mq).toLowerCase());
}catch(e){}
buildHomeTiles();
(function(){
  if(_POPOVER_MODE){ try{ _renderPopover(); }catch(e){} return; }   // controller UI; no audio, no scene loop
  if(_BROWSE_MODE){ try{ _renderBrowse(); }catch(e){} return; }     // Portal-style control center; no audio, no scene loop
  if(_WALLPAPER_MODE){
    if(document.body) document.body.classList.add('wallpaper-visual');
    var _wpStation=''; try{ _wpStation=new URLSearchParams(location.search||'').get('station')||''; }catch(e0){}
    if(_WALLPAPER_AUDIO){
      if(_wpStation && typeof enterStation==='function') enterStation(_wpStation);   // popover-chosen station on the audio-owner display
      else startAudio(false);
    } else { enterWatchMode({noRoute:true}); }
    if(window.__rrrWallpaperPerformance) _applyWallpaperPerformance(window.__rrrWallpaperPerformance);
    return;
  }
  var head=String(_pathParts(location.pathname||'/')[0]||'').toLowerCase();
  if(head==='listen'||head==='play'||head==='create'||head==='wip'){
    if(typeof history!=='undefined' && history.replaceState){ try{ history.replaceState(null,'','/'); }catch(e){} }
    head='';
  }
  if(head==='watch'){ enterWatchMode({noRoute:true}); return; }
  if(head==='radio'){
    // live intent (fresh default / persisted): keep the /radio route and let startAudio's
    // no-slug branch join the shared broadcast; otherwise mint a private track as before.
    var liveBoot=false;
    try{ liveBoot=!!(typeof Radio!=='undefined' && Radio.live && Radio.live()); }catch(e0){}
    if(!liveBoot){
      var tok=_nextGeneratedToken();
      if(typeof history!=='undefined' && history.replaceState){ try{ history.replaceState(null,'',_generatedRoute(tok)+_routeQueryExtras()); }catch(e){} }
    }
    if(document.body) document.body.classList.add('ai-visual');
    startAudio(false);                                           // boots at the minted slug (or joins live); sound arms on first tap
  }
})();

// (the speaker button now opens this mixer; per-channel mute lives inside the panel)

/* ============================================================
   LIVE MIXER (top-right) — generated voice levels or active console-channel levels, depending on the source.
   Drives Audio.setMix(key,0..2). Values are session-only and scoped per source/platform; refresh resets them.
   ============================================================ */
(function(){
  if(typeof Audio==='undefined' || !Audio.setMix) return;
  var MASTER_ROW=['master','Volume'];
  var GEN_ROWS=[MASTER_ROW,['lead','Lead / melody'],['bass','Bass'],['kick','Kick'],['snare','Snare / clap'],['hat','Hi-hats'],['arp','Arp'],['pad','Pad'],['fx','FX / risers']];

  var panel=document.createElement('div'); panel.id='mixpanel'; panel.style.display='none';
  var tempoHead=document.createElement('div'); tempoHead.className='mixnp mixnp-tempo'; tempoHead.innerHTML='<div class="nph">TEMPO · BPM</div>'; panel.appendChild(tempoHead);
  var tempoSlot=document.createElement('div'); tempoSlot.id='mixtemposlot'; panel.appendChild(tempoSlot);
  var levelsHead=document.createElement('div'); levelsHead.className='mixhead'; levelsHead.innerHTML='<div class="nph">LEVELS</div>';
  var resetB=document.createElement('button'); resetB.className='mixbtn'; resetB.textContent='reset levels';
  levelsHead.appendChild(resetB); panel.appendChild(levelsHead);
  var rowsBox=document.createElement('div'); rowsBox.className='mixrows mixrows-levels'; panel.appendChild(rowsBox);
  function adoptTempo(){ var tg=document.getElementById('rtempo'); if(tg && tg.parentNode!==tempoSlot){ tempoSlot.appendChild(tg); } }   // ADOPT the #rtempo group built in buildRadioUI
  adoptTempo();
  var hint=document.createElement('div'); hint.className='mixhint'; hint.textContent='';
  panel.appendChild(hint);
  var volumeHead=document.createElement('div'); volumeHead.className='mixnp mixnp-volume'; volumeHead.innerHTML='<div class="nph">VOLUME</div>'; panel.appendChild(volumeHead);
  var masterBox=document.createElement('div'); masterBox.className='mixmaster'; panel.appendChild(masterBox);
  var slEls={}, valEls={}, muteEls={}, activeRows=[], activeLevelRows=[], lastNonZero={};
  function currentRows(){
    if(typeof _station!=='undefined' && _station!=='generated' && _station!=='liked') return [MASTER_ROW];
    return GEN_ROWS;
  }
  function splitRows(rows){
    var master=null, levels=[];
    (rows||[]).forEach(function(r){ if(r && r[0]==='master') master=r; else if(r) levels.push(r); });
    master=master||MASTER_ROW;
    return {master:master, levels:levels, all:[master].concat(levels)};
  }
  function activeMix(){ return (window._sessionMixGet&&window._sessionMixGet()) || Audio.getMix(); }
  function masterLevel(){ var m=activeMix(); return (m&&typeof m.master==='number') ? m.master : 1; }
  function refreshVolumeDock(){
    var v=masterLevel(), muted=v<=0.001, read=document.getElementById('pbVolRead'), btn=document.getElementById('pbVolume'), icon=btn&&btn.querySelector('.pbv-icon');
    if(read) read.textContent=String(Math.round(v*100));
    if(icon) icon.innerHTML=svgIcon(muted?'spkOff':'spkOn');
    if(btn){ btn.classList.toggle('muted', muted); btn.title='Volume '+Math.round(v*100)+'%'; }
  }
  window.refreshVolumeDock=refreshVolumeDock;
  function lastKey(role){ return ((window._sessionMixScope&&window._sessionMixScope())||'mix')+':'+role; }
  function updateMuteButton(role, v){
    var b=muteEls[role]; if(!b) return;
    var muted=v<=0.001;
    b.innerHTML=svgIcon(muted?'spkOff':'spkOn');
    b.classList.toggle('muted', muted);
    b.setAttribute('aria-pressed', muted?'true':'false');
    b.title=(muted?'Unmute ':'Mute ')+(b._mixLabel||role);
  }
  function setRoleLevel(role, v, keepFocus){
    v=Math.max(0, Math.min(2, +v||0));
    if(v>0.001) lastNonZero[lastKey(role)]=v;
    if(window._sessionMixSet) v=window._sessionMixSet(role, v); else Audio.setMix(role, v);
    if(slEls[role] && (!keepFocus || document.activeElement!==slEls[role])) slEls[role].value=v;
    if(valEls[role]) valEls[role].textContent=Math.round(v*100)+'%';
    updateMuteButton(role, v);
    if(role==='master') refreshVolumeDock();
    return v;
  }
  function applyVal(role, v){ setRoleLevel(role, v, true); }
  function appendMixRow(box, r, extraClass, mix){
    var row=document.createElement('div'); row.className='mixrow'+(extraClass?' '+extraClass:'');
    var mute=document.createElement('button'); mute.type='button'; mute.className='mixmute'; mute._mixLabel=r[1];
    mute.addEventListener('click', function(ev){ ev.stopPropagation(); var cur=activeMix()[r[0]]; if(typeof cur!=='number') cur=+(slEls[r[0]]&&slEls[r[0]].value)||1;
      if(cur>0.001){ lastNonZero[lastKey(r[0])]=cur; setRoleLevel(r[0], 0); }
      else setRoleLevel(r[0], lastNonZero[lastKey(r[0])]||1); });
    var lab=document.createElement('label'); lab.textContent=r[1];
    var sl=document.createElement('input'); sl.type='range'; sl.min=0; sl.max=2; sl.step=0.05;
    var cur=mix[r[0]]; sl.value=(typeof cur==='number')?cur:1;
    sl.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
    sl.addEventListener('input', function(ev){ ev.stopPropagation(); applyVal(r[0], +sl.value); });
    var val=document.createElement('span'); val.className='mixval'; val.textContent=Math.round((+sl.value)*100)+'%';
    slEls[r[0]]=sl; valEls[r[0]]=val; muteEls[r[0]]=mute; if(+sl.value>0.001) lastNonZero[lastKey(r[0])]=+sl.value;
    updateMuteButton(r[0], +sl.value);
    row.append(mute, lab, sl, val); box.appendChild(row);
  }
  function buildRows(){
    var split=splitRows(currentRows());
    activeRows=split.all; activeLevelRows=split.levels;
    if(window._applyMixScopeForSource) window._applyMixScopeForSource();
    slEls={}; valEls={}; muteEls={}; rowsBox.innerHTML=''; masterBox.innerHTML='';
    var mix=activeMix();
    levelsHead.style.display=activeLevelRows.length?'flex':'none';
    rowsBox.style.display=activeLevelRows.length?'':'none';
    resetB.disabled=!activeLevelRows.length;
    activeLevelRows.forEach(function(r){ appendMixRow(rowsBox, r, '', mix); });
    appendMixRow(masterBox, split.master, 'mixrow-master', mix);
    updateHint();
  }
  resetB.addEventListener('click', function(ev){ ev.stopPropagation(); var rows=activeLevelRows||[]; rows.forEach(function(r){ lastNonZero[lastKey(r[0])]=1; }); if(window._sessionMixReset) window._sessionMixReset(rows.map(function(r){ return r[0]; })); else rows.forEach(function(r){ Audio.setMix(r[0], 1); }); syncSliders(); refreshVolumeDock(); });
  function updateHint(){ if(!hint) return; var show=!!(activeLevelRows&&activeLevelRows.length); hint.style.display=show?'':'none'; hint.textContent=show?'Generated-track voice volumes.':''; }
  function syncSliders(){ var m=activeMix(); activeRows.forEach(function(r){ var v=(typeof m[r[0]]==='number')?m[r[0]]:1;
    if(v>0.001) lastNonZero[lastKey(r[0])]=v;
    if(slEls[r[0]] && document.activeElement!==slEls[r[0]]) slEls[r[0]].value=v; if(valEls[r[0]]) valEls[r[0]].textContent=Math.round(v*100)+'%'; updateMuteButton(r[0], v); }); refreshVolumeDock(); }
  window.refreshMixPanel=function(){ buildRows(); syncSliders(); };
  buildRows();
  document.body.appendChild(panel);
  function open(){ panel.style.display='block'; adoptTempo(); buildRows(); if(typeof syncTempoUI==='function') syncTempoUI(); syncSliders(); if(window.closeTrackPanel) window.closeTrackPanel(); }
  function toggle(){ var willOpen=(panel.style.display==='none'); if(willOpen) open(); else panel.style.display='none'; }
  window.openMixPanel=open; window.toggleMixPanel=toggle; window.closeMixPanel=function(){ panel.style.display='none'; };
  document.addEventListener('click', function(ev){ if(panel.style.display==='none') return;
    if(ev.target && ev.target.closest && ev.target.closest('#mixpanel,#pbVolume')) return;
    panel.style.display='none';
  });
  document.addEventListener('keydown', function(ev){ if(shortcutTargetBlocked(ev)) return;
    if(ev.key==='Escape' && panel.style.display!=='none'){ panel.style.display='none'; return; }
    if((ev.key==='m'||ev.key==='M')&&!ev.metaKey&&!ev.ctrlKey&&!ev.altKey){ toggle(); } });
  var css=document.createElement('style'); css.textContent=
    '#mixpanel{position:fixed;right:12px;bottom:86px;z-index:9999;text-align:left;font-family:var(--pixel);font-size:16px;color:#cfe;background:rgba(8,6,16,.97);border:1px solid #345;border-radius:8px;padding:15px 17px;width:430px;max-width:calc(100vw - 20px);max-height:calc(100vh - 104px);overflow-y:auto;box-shadow:0 6px 24px rgba(0,0,0,.6);}'+
    '.mixhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 10px;padding-top:11px;border-top:1px solid #234;}'+
    '.mixnp{margin:14px 0 8px;padding-top:11px;border-top:1px solid #234;}'+
    '.mixnp-tempo{margin:-2px 0 10px;padding-top:0;padding-bottom:12px;border-top:0;border-bottom:1px solid #234;}'+
    '.mixnp-volume{margin:15px 0 8px;padding-top:12px;border-top:1px solid #345;}'+
    '.mixnp .nph,.mixhead .nph{color:#6cf;font-size:13px;letter-spacing:0;}'+
    '.mixnp .npg{color:#e6c8ff;font-size:17px;margin:3px 0;text-transform:uppercase;letter-spacing:0;}'+
    '.mixnp .npd{color:#7787a8;font-size:14px;line-height:1.5;}'+
    '.mixnp .npd b{color:#aebbe0;font-weight:600;}'+
    '.mixrow{display:grid;grid-template-columns:30px minmax(100px,122px) minmax(140px,1fr) 48px;align-items:center;gap:9px;margin:7px 0;}'+
    '.mixrow-master{grid-template-columns:34px minmax(82px,108px) minmax(170px,1fr) 56px;margin:5px -3px 0;padding:10px 9px;border:1px solid rgba(102,204,255,.38);border-radius:7px;background:linear-gradient(90deg,rgba(102,204,255,.12),rgba(248,120,248,.07));}'+
    '.mixrow label{color:#9ab;line-height:1.15;overflow-wrap:anywhere;}'+
    '.mixrow-master label{color:#f7fbff;font-size:18px;}'+
    '.mixrow input[type=range]{width:100%;min-width:0;accent-color:#6cf;}'+
    '.mixrow-master input[type=range]{accent-color:var(--accent2);}'+
    '.mixval{text-align:right;color:#cfe;}'+
    '.mixrow-master .mixval{color:#f7fbff;font-size:17px;}'+
    '.mixmute{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;background:transparent;color:#dff;border:0;border-radius:5px;padding:0;cursor:pointer;}'+
    '.mixrow-master .mixmute{color:#f7fbff;}'+
    '.mixmute:hover{color:#6cf;background:rgba(102,204,255,.12);}'+
    '.mixmute.muted{color:#f87878;background:rgba(248,88,88,.13);}'+
    '.mixmute svg{width:18px;height:18px;}'+
    '.mixbtn{display:inline-flex;align-items:center;gap:5px;background:#234;color:#9cf;border:1px solid #456;border-radius:5px;padding:4px 11px;cursor:pointer;white-space:nowrap;font-family:var(--pixel);font-size:15px;}'+
    '.mixbtn:disabled{opacity:.45;cursor:default;}'+
    '.mixbtn svg{width:16px;height:16px;}'+
    '.mixbtn.muted{background:#622;color:#fbb;border-color:#944;}'+
    '#mixtemposlot #rtempo{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;width:100%;}'+
    '#mixtemposlot #rtempo .rbtn{height:34px;min-width:34px;padding:3px 9px;border-radius:4px;}'+
    '#mixtemposlot #rtemposlider{flex:1 1 auto;width:auto;min-width:120px;}'+
    '#mixtemposlot #rtemporead{min-width:68px;text-align:right;color:#cfe;}'+
    '.mixread{flex:1;min-width:0;background:#06040c;color:#7a9;border:1px solid #234;border-radius:5px;padding:3px 6px;font:10px ui-monospace,monospace;}'+
    '.mixhint{margin-top:7px;color:#7787a8;font:10px ui-monospace,monospace;line-height:1.35;}'+
    '@media (min-width:980px){#mixpanel{right:16px;bottom:96px;}}'+
    '@media (max-width:760px){#mixpanel{right:8px;bottom:86px;width:calc(100vw - 16px);}}';
  document.head.appendChild(css);
  refreshVolumeDock();
})();

/* ============================================================
   TRACK PANEL (bottom toggle, 📋) — live full track recipe with timestamps, COPYABLE; plus a DISLIKES log that 👎
   appends each disliked track's full details to, which you copy and paste to chat to discuss what's repetitive.
   ============================================================ */
(function(){
  if(typeof Audio==='undefined' || !Audio.trackInfo) return;
  var e=function(s){ return (s==null||s==='') ? '—' : String(s); };
  function fmtT(s){ s=Math.max(0,Math.round(s||0)); return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2); }
  function trackText(){ var ext=''; try{ if(window._currentExternalTrackDetailsText) ext=window._currentExternalTrackDetailsText(); }catch(e){}
    if(ext) return ext;
    var t=Audio.trackInfo && Audio.trackInfo(); if(!t) return '— press start —';
    var I=t.instruments||{}, L=[];
    L.push('=== RETRO RAVE RADIO TRACK ===');
    L.push('genre: '+e(t.genre)+'   family: '+e(t.family)+'   bpm: '+e(t.bpm));
    L.push('key: '+e(t.key)+' '+e(t.scale)+'   harm: '+e(t.harm)+'   feel: '+e(t.feel));
    L.push('sound-design: '+e(t.soundDesign)+'   groove: '+e(t.groove));
    L.push('playhead: '+fmtT(t.elapsedSec)+'  (bar '+e(t.trackBar)+'/'+e(t.totalBars)+', section '+e(t.section)+')');
    L.push('INSTRUMENTS  lead:'+e(I.lead)+'  bass:'+e(I.bass)+'  arp:'+e(I.arp)+'  pad:'+e(I.pad)+(I.comp?('  comp:'+I.comp):'')+(I.top?('  top:'+I.top):''));
    L.push('HOOK: '+(t.hook?(t.hook.id+' ('+t.hook.role+', '+t.hook.bars+'bar)'):'—')+(t.technoHook?('   mode:'+t.technoHook):''));
    L.push('drumKit:'+e(t.drumKit)+'  bassPat:'+e(t.bassPat)+'  arpShape:'+e(t.arpShape)+'  drumStyle:'+e(t.drumStyle)+'  bassStyle:'+e(t.bassStyle));
    L.push('progression: '+e(t.progression));
    L.push('FORM (role / bars / time):');
    (t.form||[]).forEach(function(f){ L.push((f.current?'▶ ':'  ')+f.role+'  ['+f.bars+'b]  '+fmtT(f.startSec)+'-'+fmtT(f.endSec)+(f.current?'   <- now':'')); });
    return L.join('\n');
  }
  // ROBUST copy: fill the (visible, readonly) textarea, SELECT it, then execCommand('copy') (works without clipboard
  // permissions) + try navigator.clipboard as a bonus. Because the text is left selected, even total failure lets the
  // user just press ⌘/Ctrl-C. Only claims "copied!" when a copy actually succeeded; else "selected — ⌘C".
  function mkCopy(label, ta, getText){ var b=document.createElement('button'); b.className='mixbtn'; b.textContent=label; b.style.cssText='padding:2px 9px;font-size:10px;float:right;margin-left:6px;';
    b.addEventListener('click', function(ev){ ev.stopPropagation(); ta.value=getText(); ta.focus(); ta.select(); try{ ta.setSelectionRange(0, ta.value.length); }catch(e){}
      var ok=false; try{ ok=document.execCommand('copy'); }catch(e){}
      if(navigator.clipboard && navigator.clipboard.writeText){ try{ navigator.clipboard.writeText(ta.value).then(function(){},function(){}); ok=ok||true; }catch(e){} }
      b.textContent = ok ? 'copied!' : 'selected — press Ctrl/Cmd C'; setTimeout(function(){ b.textContent=label; }, ok?1200:2400); }); return b; }

  var panel=document.createElement('div'); panel.id='trackpanel'; panel.style.display='none';
  // --- NOW PLAYING (friendly summary; lives here now, moved out of the mix menu) ---
  var h0=document.createElement('div'); h0.className='tph'; h0.appendChild(document.createTextNode('NOW PLAYING'));
  // DISLIKE this track (moved here from the rail): record it (-> Disliked playlist + learning) + skip to the next.
  var disBtn=document.createElement('button'); disBtn.className='mixbtn tpdislike'; disBtn.style.cssText='float:right;padding:2px 10px;font-size:10px;';
  disBtn.innerHTML=svgIcon('dislike')+'<span>dislike</span>'; disBtn.title="Dislike this track (won't play again) + skip";
  disBtn.addEventListener('click', function(ev){ ev.stopPropagation();
    if(typeof _curItem==='function' && _curItem() && typeof _transportDislike==='function') _transportDislike();
    else Radio.thumbDown();
    if(window.closeTrackPanel) window.closeTrackPanel(); });
  h0.appendChild(disBtn);
  var np=document.createElement('div'); np.className='tpnp';
  function npChip(k,v){ return '<span class="npc"><b>'+k+'</b>'+e(v)+'</span>'; }
  function updateNP(){ var ext=null; try{ if(window._currentExternalTrackSummary) ext=window._currentExternalTrackSummary(); }catch(e){}
    if(ext){ np.innerHTML=npChip('source',ext.source)+npChip('platform',ext.platform)+npChip('album',ext.album)+npChip('track',ext.track)+npChip('title',ext.title)+(ext.publisher?npChip('publisher',ext.publisher):''); return; }
    var n=Audio.nowPlaying&&Audio.nowPlaying(); if(!n){ np.innerHTML='<span class="npc">— press start —</span>'; return; }
    np.innerHTML = npChip('genre',n.genre)+npChip('bpm',n.bpm)+npChip('feel',n.feel)+npChip('key',n.scale)
      +npChip('drums',n.drum)+npChip('bass',n.bassPattern)+npChip('lead',n.lead)+npChip('arp',n.arp)+npChip('pad',n.pad)+npChip('section',n.section); }
  // --- current track (live) ---  (textarea built first so the copy button can bind to it)
  var live=document.createElement('textarea'); live.readOnly=true; live.rows=15; live.className='tptext'; live.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  var h1=document.createElement('div'); h1.className='tph'; h1.style.marginTop='12px'; h1.appendChild(document.createTextNode('TRACK DETAILS')); h1.appendChild(mkCopy('copy', live, trackText));
  // Disliked tracks are stored with the rest of the local library lists and shown in Browse.
  panel.appendChild(h0); panel.appendChild(np); panel.appendChild(h1); panel.appendChild(live);
  var backdrop=document.createElement('div'); backdrop.id='trackbackdrop'; backdrop.addEventListener('click', function(){ closePanel(); });
  document.body.appendChild(backdrop); document.body.appendChild(panel);

  // grow a textarea to fit its content so the details NEVER scroll (no inner h/v scrollbars; the modal itself scrolls only if huge)
  function fitTa(ta){ if(!ta || panel.style.display==='none') return; ta.style.height='auto'; ta.style.height=(ta.scrollHeight+4)+'px'; }
  function updateLive(){ if(panel.style.display==='none' || (typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive())) return; updateNP(); if(document.activeElement!==live){ live.value=trackText(); fitTa(live); } }
  setInterval(updateLive, 700);
  function closePanel(){ panel.style.display='none'; backdrop.style.display='none'; }
  function toggle(){ var open=(panel.style.display==='none'); panel.style.display=open?'block':'none'; backdrop.style.display=open?'block':'none'; if(open){ updateLive(); if(window.closeMixPanel) window.closeMixPanel(); } }
  window.addEventListener('resize', function(){ fitTa(live); });
  window.toggleTrackPanel=toggle; window.closeTrackPanel=closePanel;

  var css=document.createElement('style'); css.textContent=
    '#trackbackdrop{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.55);display:none;}'+
    '#trackpanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;font-family:var(--pixel);font-size:16px;background:rgba(10,8,20,.98);border:1px solid #345;border-radius:12px;padding:18px 20px;width:min(920px,94vw);max-height:92vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.75);}'+
    '.tph{color:#6cf;font-size:14px;letter-spacing:.1em;margin-bottom:5px;overflow:hidden;text-transform:uppercase;}'+
    '.tptext{width:100%;box-sizing:border-box;font:13px var(--mono);line-height:1.5;background:#0e0e18;color:#bfe9ff;border:1px solid #2a2a44;border-radius:5px;padding:9px 11px;resize:none;overflow:hidden;white-space:pre-wrap;word-break:break-word;}'+
    '.tpnp{display:flex;flex-wrap:wrap;gap:6px;}'+
    '.npc{display:inline-flex;align-items:baseline;gap:5px;background:#141426;border:1px solid #2a2a44;border-radius:14px;padding:4px 11px;color:#dff;font:12px var(--mono);}'+
    '.npc b{color:#6cf;font-weight:400;text-transform:uppercase;font-size:10px;letter-spacing:.06em;}'+
    '.tpdislike svg{width:14px;height:14px;}'+
    '.tpdislike:hover{background:#622;color:#fbb;border-color:#944;}';
  document.head.appendChild(css);
})();

// ===== health-kit boot beacon (sampled, OFF by default) ==========================================
// The postbuild collector (scripts/health/report-build.mjs) is blind to the deployed edge — it runs
// on the build box. This is the runtime-with-no-server counterpart: on first load it snapshots the
// standardized document.documentElement.dataset.rrr* + window.__rrrFrame surface into a
// health-report@1 envelope and BEST-EFFORT POSTs it (trigger=bootBeacon) to a health ingest Worker.
//
// OFF unless the host sets window.RRR_HEALTH = { endpoint, sample?, token?, app?, version?, build?,
// sourceCommit?, channel? } (e.g. an inline <script> in the shell, or an env-stamped build). No
// endpoint => no-op. Head-sampled so only a fraction of loads report. Content-blind (numeric metrics
// only) and swallows every error — it must never affect playback.
(function bootBeacon(){
  if(typeof window==='undefined'||typeof document==='undefined') return;
  var fired=false;
  function fire(){
    if(fired) return; fired=true;
    try{
      var cfg=window.RRR_HEALTH; if(!cfg||!cfg.endpoint) return;                 // off by default
      var sample=(typeof cfg.sample==='number')?cfg.sample:0.05;
      if(!(Math.random()<sample)) return;                                        // head sampling
      var d=(document.documentElement&&document.documentElement.dataset)||{};
      var fr=window.__rrrFrame||{};
      var toNum=function(v){ var n=+v; return isFinite(n)?n:0; };
      var checks=[
        { id:'boot.frame-active', category:'smoke', status:(fr&&fr.active)?'pass':'warning', durationMs:0,
          metrics:{ frameSeq:toNum(fr&&fr.seq), audioOnly:(fr&&fr.audioOnly)?1:0, renderCost:toNum(fr&&fr.cost) } },
        { id:'boot.live-schedule', category:'unit', status:'pass', durationMs:0,
          metrics:{ live:(d.rrrLive==='true')?1:0, liveOffsetSec:toNum(d.rrrLiveOffset),
                    liveListeners:toNum(d.rrrLiveListeners), gameCount:toNum(d.rrrGameCount) } },
        { id:'boot.audio-ready', category:'smoke', status:'pass', durationMs:0,
          metrics:{ started:(d.rrrStarted==='true')?1:0, running:(d.rrrRunning==='true')?1:0,
                    bpm:toNum(d.rrrBpm), brokenGames:(d.rrrBrokenGames?String(d.rrrBrokenGames).split(',').filter(Boolean).length:0) } }
      ];
      var passed=0,failed=0,warnings=0,status='pass';
      for(var i=0;i<checks.length;i++){ var s=checks[i].status;
        if(s==='fail'){ failed++; status='fail'; } else if(s==='warning'){ warnings++; if(status!=='fail') status='warning'; } else passed++; }
      var report={
        schemaVersion:'health-report@1', app:cfg.app||'rrr', channel:cfg.channel||'release',
        version:cfg.version||'0.0.0', build:cfg.build||'dev', sourceCommit:cfg.sourceCommit||'',
        artifact:'static-web', trigger:'bootBeacon', generatedAt:new Date().toISOString(),
        status:status, checks:checks,
        metrics:{ checks:checks.length, passed:passed, failed:failed, warnings:warnings, skipped:0, totalDurationMs:0 }
      };
      var headers={ 'content-type':'application/json' };
      if(cfg.token) headers['authorization']='Bearer '+cfg.token;
      // fetch keepalive (sendBeacon can't carry an auth header); every error is swallowed.
      if(window.fetch) window.fetch(cfg.endpoint,{ method:'POST', headers:headers, body:JSON.stringify(report), keepalive:true, mode:'cors' })['catch'](function(){});
    }catch(e){ /* a beacon must never touch playback */ }
  }
  // fire once the diagnostics surface is populated; fall back if 'load' already passed.
  try{
    if(document.readyState==='complete') setTimeout(fire, 4000);
    else window.addEventListener('load', function(){ setTimeout(fire, 4000); });
    setTimeout(fire, 9000);
  }catch(e){}
})();

/* ============================================================
   DESKTOP CONTROL BRIDGE (window.RRR) + menu-bar POPOVER UI.
   Radio/Audio are const (not on window); this is the stable surface the Electron main process +
   popover window drive playback through. Present in every window; every call is no-op-safe.
   ============================================================ */
(function(){
  var MOOD_TO_ST={ any:'st-any', full:'st-full', sparse:'st-sparse', none:'st-none' };
  function stId(){ try{ return MOOD_TO_ST[Radio.mood()]||'st-any'; }catch(e){ return 'st-any'; } }
  function nowPlaying(){
    try{
      return {
        title:(typeof _curName!=='undefined' && _curName) ? String(_curName) : '',
        station:stId(),
        live:!!(typeof LiveCtl!=='undefined' && LiveCtl.active && LiveCtl.active()),
        listeners:(typeof window._presenceCount==='number') ? window._presenceCount : null,
        playing:!!(typeof Audio!=='undefined' && Audio.running && Audio.running()),
        bpm:(function(){ try{ return Audio.trackBpm?Audio.trackBpm():null; }catch(e){ return null; } })()
      };
    }catch(e){ return { title:'', station:'st-any', live:false, playing:false, listeners:null, bpm:null }; }
  }
  window.RRR={
    isControl:true,
    enterStation:function(id){ try{ enterStation(id); }catch(e){} },
    station:stId,
    transport:function(dir){ try{ if(dir==='prev')_transportPrev(); else if(dir==='toggle')_transportToggle(); else _transportNext(); }catch(e){} },
    setMasterVol:function(v){ v=Math.max(0,Math.min(2,+v||0)); try{ if(typeof _sessionMixSet==='function')_sessionMixSet('master',v); else if(Audio&&Audio.setMix)Audio.setMix('master',v); }catch(e){} },
    nowPlaying:nowPlaying
  };

  // Wallpaper audio-owner window: take live station/transport commands from main (no reload), and
  // report now-playing up so the popover can show the current track.
  if(_WALLPAPER_MODE && window.RRRNative){
    if(window.RRRNative.onCommand){ try{ window.RRRNative.onCommand(function(cmd){
      if(!cmd||!cmd.type) return;
      if(cmd.type==='enterStation' && cmd.id) window.RRR.enterStation(cmd.id);
      else if(cmd.type==='transport') window.RRR.transport(cmd.dir);
      else if(cmd.type==='masterVol') window.RRR.setMasterVol(cmd.value);
    }); }catch(e){} }
    if(_WALLPAPER_AUDIO && window.RRRNative.reportNowPlaying){
      var _lastNp='';
      setInterval(function(){ try{ var n=nowPlaying(), k=JSON.stringify(n); if(k!==_lastNp){ _lastNp=k; window.RRRNative.reportNowPlaying(n); } }catch(e){} }, 1500);
    }
  }

  // ---- the menu-bar popover control panel (rendered ONLY in the Electron popover window) ----
  window._renderPopover=function(){
    var host=document.getElementById('popover'); if(!host) return;
    var TILES=(typeof HOME_TILES!=='undefined' && HOME_TILES.length) ? HOME_TILES : [{id:'st-any',name:'Everything!'}];
    var css=document.createElement('style');
    css.textContent=
      '#popover{font-family:var(--pixel);color:#f4f2ff;padding:12px;-webkit-user-select:none;user-select:none}'+
      '.pv-card{background:linear-gradient(180deg,#1a1430,#0d0a1c);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.5)}'+
      '.pv-head{display:flex;align-items:center;gap:11px;margin-bottom:12px}'+
      '.pv-thumb{width:46px;height:46px;border-radius:12px;flex:0 0 auto;background:#2a2148;display:flex;align-items:center;justify-content:center;font-size:24px;overflow:hidden}'+
      '.pv-thumb img{width:100%;height:100%;image-rendering:pixelated}'+
      '.pv-meta{min-width:0;flex:1}'+
      '.pv-station{font-size:18px;font-weight:700;letter-spacing:.3px;line-height:1.1}'+
      '.pv-title{font-size:12px;color:#b9b2d6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}'+
      '.pv-title .live{color:#58f898;font-weight:700}'+
      '.pv-transport{display:flex;align-items:center;justify-content:center;gap:16px;margin:6px 0 14px}'+
      '.pv-tb{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#f4f2ff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}'+
      '.pv-tb.play{width:56px;height:56px;font-size:22px;background:#f878f8;border-color:#f878f8;color:#160b1f}'+
      '.pv-tb:active{transform:scale(.94)}'+
      '.pv-toggles{display:flex;gap:8px;margin-bottom:13px}'+
      '.pv-tog{flex:1;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);border-radius:12px;padding:9px 4px;text-align:center;cursor:pointer}'+
      '.pv-tog .i{font-size:18px;line-height:1}'+
      '.pv-tog .l{font-size:10px;color:#b9b2d6;margin-top:4px;text-transform:uppercase;letter-spacing:.4px}'+
      '.pv-tog.on{background:rgba(88,136,252,.22);border-color:#6888fc}'+
      '.pv-tog.on .l{color:#cdd6ff}'+
      '.pv-moods{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px}'+
      '.pv-mood{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);border-radius:10px;padding:8px;font-size:12px;cursor:pointer;text-align:left;color:#cfc8ea}'+
      '.pv-mood.on{background:rgba(248,120,248,.18);border-color:#f878f8;color:#fff}'+
      '.pv-foot{display:flex;gap:8px}'+
      '.pv-foot button{flex:1;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#cfc8ea;border-radius:10px;padding:8px;font-size:12px;cursor:pointer}';
    document.head.appendChild(css);

    function esc(x){ var d=document.createElement('div'); d.textContent=String(x==null?'':x); return d.innerHTML; }
    function thumbFor(id){
      try{ var t=TILES.filter(function(x){return x.id===id})[0]; if(t&&t.sprite&&typeof Sprites!=='undefined'&&Sprites.dataURL) return '<img src="'+Sprites.dataURL(t.sprite,46)+'">'; }catch(e){}
      return '♪';
    }
    var moodBtns=TILES.map(function(t){ return '<button class="pv-mood" data-st="'+esc(t.id)+'">'+esc(t.name||t.id)+'</button>'; }).join('');
    host.innerHTML=
      '<div class="pv-card">'+
      '  <div class="pv-head"><div class="pv-thumb" id="pvThumb">♪</div>'+
      '    <div class="pv-meta"><div class="pv-station" id="pvStation">Everything!</div>'+
      '      <div class="pv-title" id="pvTitle">Paused</div></div></div>'+
      '  <div class="pv-transport">'+
      '    <button class="pv-tb" id="pvPrev" title="Previous">⏮</button>'+
      '    <button class="pv-tb play" id="pvPlay" title="Play / Pause">▶</button>'+
      '    <button class="pv-tb" id="pvNext" title="Skip">⏭</button></div>'+
      '  <div class="pv-toggles">'+
      '    <div class="pv-tog" id="pvWall"><div class="i">🖼️</div><div class="l">Wallpaper</div></div>'+
      '    <div class="pv-tog" id="pvAudio"><div class="i">🔊</div><div class="l">Audio</div></div>'+
      '    <div class="pv-tog" id="pvFps"><div class="i">30</div><div class="l">FPS</div></div></div>'+
      '  <div class="pv-moods">'+moodBtns+'</div>'+
      '  <div class="pv-foot"><button id="pvOpen">Open Window</button><button id="pvQuit">Quit</button></div>'+
      '</div>';

    var N=window.RRRNative||{};
    var _state={ wallpaperEnabled:false, audioMuted:false, fpsCap:30, station:'st-any' };
    function ctl(action, extra){ try{ if(N.control) N.control(Object.assign({action:action}, extra||{})); }catch(e){} }
    document.getElementById('pvPrev').onclick=function(){ ctl('transport',{dir:'prev'}); };
    document.getElementById('pvPlay').onclick=function(){ ctl('transport',{dir:'toggle'}); };
    document.getElementById('pvNext').onclick=function(){ ctl('transport',{dir:'next'}); };
    document.getElementById('pvWall').onclick=function(){ ctl('setWallpaperEnabled',{value:!_state.wallpaperEnabled}); };
    document.getElementById('pvAudio').onclick=function(){ ctl('setAudioMuted',{value:!_state.audioMuted}); };
    document.getElementById('pvFps').onclick=function(){ var order=[30,60,15], i=order.indexOf(_state.fpsCap); ctl('setFps',{value:order[(i+1)%order.length]}); };
    document.getElementById('pvOpen').onclick=function(){ ctl('openWindow'); };
    document.getElementById('pvQuit').onclick=function(){ ctl('quit'); };
    Array.prototype.forEach.call(host.querySelectorAll('.pv-mood'), function(b){ b.onclick=function(){ ctl('setStation',{id:b.getAttribute('data-st')}); }; });

    function apply(s){
      if(!s) return; _state=Object.assign(_state,s);
      var st=s.station||_state.station||'st-any';
      var tile=TILES.filter(function(x){return x.id===st})[0]||TILES[0];
      document.getElementById('pvStation').textContent=(tile&&tile.name)||'Everything!';
      document.getElementById('pvThumb').innerHTML=thumbFor(st);
      var np=s.nowPlaying||{};
      var t=document.getElementById('pvTitle');
      if(np.live){ t.innerHTML='<span class="live">LIVE</span>'+(np.listeners?(' · '+np.listeners+' listening'):'')+(np.title?(' · '+esc(np.title)):''); }
      else if(np.playing && np.title){ t.textContent=np.title; }
      else { t.textContent=np.title?np.title:'Paused'; }
      document.getElementById('pvPlay').innerHTML=np.playing?'⏸':'▶';
      document.getElementById('pvWall').classList.toggle('on', !!s.wallpaperEnabled);
      document.getElementById('pvAudio').classList.toggle('on', !s.audioMuted && !!s.wallpaperEnabled);
      document.getElementById('pvFps').querySelector('.i').textContent=String(s.fpsCap||30);
      Array.prototype.forEach.call(host.querySelectorAll('.pv-mood'), function(b){ b.classList.toggle('on', b.getAttribute('data-st')===st); });
    }
    if(N.onDesktopState) N.onDesktopState(apply);
    else if(N.desktopState) N.desktopState().then(apply)['catch'](function(){});
  };

  // ---- the Portal-style desktop control center (the app's main window: ?mode=browse) ----
  window._renderBrowse=function(){
    var host=document.getElementById('browse'); if(!host) return;
    var TILES=(typeof HOME_TILES!=='undefined' && HOME_TILES.length) ? HOME_TILES : [{id:'st-any',name:'Everything!'}];
    var css=document.createElement('style');
    css.textContent=
      '#browse{font-family:var(--pixel);color:#f4f2ff;min-height:100vh;-webkit-user-select:none;user-select:none;padding:26px 26px 96px}'+
      '.bz-wrap{max-width:900px;margin:0 auto}'+
      '.bz-h1{font-size:26px;letter-spacing:1px;font-weight:700}.bz-h1 span{color:var(--accent)}'+
      '.bz-tag{color:#b9b2d6;font-size:13px;margin:4px 0 22px}'+
      '.bz-sec{margin-bottom:26px}'+
      '.bz-sect{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#8f88b3;margin-bottom:11px}'+
      '.bz-stations{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}'+
      '.bz-st{display:flex;gap:11px;align-items:center;border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border-radius:14px;padding:12px;cursor:pointer;transition:transform .08s}'+
      '.bz-st:active{transform:scale(.98)}'+
      '.bz-st.on{border-color:var(--accent);background:rgba(248,120,248,.16)}'+
      '.bz-st .art{width:48px;height:48px;border-radius:11px;background:#2a2148;flex:0 0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:22px}'+
      '.bz-st .art img{width:100%;height:100%;image-rendering:pixelated}'+
      '.bz-st .nm{font-size:15px;font-weight:700}.bz-st .ds{font-size:11px;color:#b0a9cf;margin-top:2px;line-height:1.25}'+
      '.bz-disp,.bz-set{display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.03);border-radius:12px;padding:12px 14px;margin-bottom:8px}'+
      '.bz-disp .di,.bz-set .sl{flex:1}.bz-disp .dn,.bz-set .sl>b{font-size:14px;font-weight:700}'+
      '.bz-disp .dm,.bz-set .sd{font-size:11px;color:#9a93bd;margin-top:2px}'+
      '.bz-badge{font-size:9px;text-transform:uppercase;letter-spacing:.6px;background:rgba(104,136,252,.25);color:#cdd6ff;border-radius:6px;padding:2px 6px;margin-left:6px}'+
      '.bz-sw{width:46px;height:26px;border-radius:14px;background:rgba(255,255,255,.14);position:relative;cursor:pointer;flex:0 0 auto;transition:background .12s}'+
      '.bz-sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .12s}'+
      '.bz-sw.on{background:var(--accent2)}.bz-sw.on::after{left:23px}'+
      '.bz-seg{display:flex;border:1px solid rgba(255,255,255,.14);border-radius:9px;overflow:hidden;flex:0 0 auto}'+
      '.bz-seg button{background:transparent;color:#cfc8ea;border:0;padding:6px 13px;font-size:13px;cursor:pointer}'+
      '.bz-seg button.on{background:var(--accent3);color:#0c0a1a}'+
      '.bz-tr{position:fixed;left:0;right:0;bottom:0;background:rgba(13,10,28,.94);border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:12px;padding:12px 22px}'+
      '.bz-tr .np{flex:1;min-width:0}.bz-tr .npt{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bz-tr .nps{font-size:11px;color:#9a93bd}.bz-tr .nps .live{color:#58f898;font-weight:700}'+
      '.bz-tb{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#f4f2ff;font-size:15px;cursor:pointer}'+
      '.bz-tb.play{background:var(--accent);border-color:var(--accent);color:#160b1f}';
    document.head.appendChild(css);

    function esc(x){ var d=document.createElement('div'); d.textContent=String(x==null?'':x); return d.innerHTML; }
    function art(id){ try{ var t=TILES.filter(function(x){return x.id===id})[0]; if(t&&t.sprite&&typeof Sprites!=='undefined'&&Sprites.dataURL) return '<img src="'+Sprites.dataURL(t.sprite,48)+'">'; }catch(e){} return '♪'; }
    function sw(on){ return '<div class="bz-sw'+(on?' on':'')+'"></div>'; }

    var stationCards=TILES.map(function(t){ return '<div class="bz-st" data-st="'+esc(t.id)+'"><div class="art">'+art(t.id)+'</div><div><div class="nm">'+esc(t.name||t.id)+'</div><div class="ds">'+esc(t.desc||'')+'</div></div></div>'; }).join('');
    host.innerHTML=
      '<div class="bz-wrap">'+
      '  <div class="bz-h1">RETRO <span>RAVE</span> RADIO</div>'+
      '  <div class="bz-tag">Your desktop control center — pick a station, choose your displays, run it as your wallpaper.</div>'+
      '  <div class="bz-sec"><div class="bz-sect">Station</div><div class="bz-stations" id="bzStations">'+stationCards+'</div></div>'+
      '  <div class="bz-sec"><div class="bz-sect">Displays</div><div id="bzDisplays"></div></div>'+
      '  <div class="bz-sec"><div class="bz-sect">Settings</div><div id="bzSettings"></div></div>'+
      '</div>'+
      '<div class="bz-tr"><div class="np"><div class="npt" id="bzNpt">Paused</div><div class="nps" id="bzNps"></div></div>'+
      '  <button class="bz-tb" id="bzPrev">⏮</button><button class="bz-tb play" id="bzPlay">▶</button><button class="bz-tb" id="bzNext">⏭</button></div>';

    var N=window.RRRNative||{};
    var _state={ station:'st-any', wallpaperEnabled:false, fpsCap:30, powerSaver:false, openAtLogin:false, displays:[] };
    function ctl(a,x){ try{ if(N.control) N.control(Object.assign({action:a},x||{})); }catch(e){} }
    Array.prototype.forEach.call(host.querySelectorAll('.bz-st'), function(b){ b.onclick=function(){ ctl('setStation',{id:b.getAttribute('data-st')}); }; });
    document.getElementById('bzPrev').onclick=function(){ ctl('transport',{dir:'prev'}); };
    document.getElementById('bzPlay').onclick=function(){ ctl('transport',{dir:'toggle'}); };
    document.getElementById('bzNext').onclick=function(){ ctl('transport',{dir:'next'}); };

    function renderDisplays(list){
      var el=document.getElementById('bzDisplays');
      if(!list||!list.length){ el.innerHTML='<div class="bz-disp"><div class="di"><div class="dn">No displays detected</div></div></div>'; return; }
      el.innerHTML=list.map(function(d){
        var badges=(d.primary?'<span class="bz-badge">Primary</span>':'')+(d.audioOwner?'<span class="bz-badge">Audio</span>':'');
        return '<div class="bz-disp" data-id="'+esc(d.id)+'"><div class="di"><div class="dn">'+esc(d.label)+badges+'</div><div class="dm">'+d.width+' × '+d.height+'</div></div>'+sw(d.enabled)+'</div>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('.bz-disp'), function(row){ var s=row.querySelector('.bz-sw'); if(!s) return; s.onclick=function(){ ctl('setDisplayEnabled',{id:row.getAttribute('data-id'), value:!s.classList.contains('on')}); }; });
    }
    function renderSettings(s){
      var el=document.getElementById('bzSettings');
      el.innerHTML=
        '<div class="bz-set"><div class="sl"><b>Animated wallpaper</b><div class="sd">Run RRR behind your desktop icons</div></div>'+sw(s.wallpaperEnabled)+'</div>'+
        '<div class="bz-set"><div class="sl"><b>Frame rate</b><div class="sd">Higher = smoother, more power</div></div><div class="bz-seg" id="bzFps">'+[15,30,60].map(function(f){return '<button data-f="'+f+'"'+(s.fpsCap===f?' class="on"':'')+'>'+f+'</button>';}).join('')+'</div></div>'+
        '<div class="bz-set"><div class="sl"><b>Battery saver</b><div class="sd">Drop to 15fps on battery</div></div>'+sw(s.powerSaver)+'</div>'+
        '<div class="bz-set"><div class="sl"><b>Launch at login</b><div class="sd">Start the wallpaper when you log in</div></div>'+sw(s.openAtLogin)+'</div>';
      var rows=el.querySelectorAll('.bz-set');
      rows[0].querySelector('.bz-sw').onclick=function(){ ctl('setWallpaperEnabled',{value:!s.wallpaperEnabled}); };
      Array.prototype.forEach.call(el.querySelectorAll('#bzFps button'), function(b){ b.onclick=function(){ ctl('setFps',{value:+b.getAttribute('data-f')}); }; });
      rows[2].querySelector('.bz-sw').onclick=function(){ ctl('setPowerSaver',{value:!s.powerSaver}); };
      rows[3].querySelector('.bz-sw').onclick=function(){ ctl('setLogin',{value:!s.openAtLogin}); };
    }

    var _structKey='';
    function apply(s){
      if(!s) return; _state=Object.assign(_state,s);
      var np=s.nowPlaying||{};
      document.getElementById('bzNpt').textContent=np.title?np.title:(np.playing?'Playing':'Paused');
      var nps=document.getElementById('bzNps');
      if(np.live){ nps.innerHTML='<span class="live">LIVE</span>'+(np.listeners?(' · '+np.listeners+' listening'):''); }
      else { nps.textContent=np.bpm?(np.bpm+' BPM'):''; }
      document.getElementById('bzPlay').innerHTML=np.playing?'⏸':'▶';
      var key=JSON.stringify({st:_state.station,w:_state.wallpaperEnabled,f:_state.fpsCap,p:_state.powerSaver,l:_state.openAtLogin,d:_state.displays});
      if(key!==_structKey){ _structKey=key;
        var st=_state.station||'st-any';
        Array.prototype.forEach.call(host.querySelectorAll('.bz-st'), function(b){ b.classList.toggle('on', b.getAttribute('data-st')===st); });
        renderDisplays(_state.displays);
        renderSettings(_state);
      }
    }
    if(N.onDesktopState) N.onDesktopState(apply);
    else if(N.desktopState) N.desktopState().then(apply)['catch'](function(){});
  };
})();
