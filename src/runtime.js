// AUTO-SPLIT from index.html — classic script, shares global scope (load order matters).
// Scene loop, home/routes, watch mode, input wiring (must load LAST).
const _RRR_DESKTOP_MODE=(function(){ try{ return new URLSearchParams(location.search||'').get('mode')||''; }catch(e){ return ''; } })();
const _WALLPAPER_MODE=_RRR_DESKTOP_MODE==='wallpaper' && !!(window.RRRNative && window.RRRNative.isDesktop);   // Electron-only; a bare ?mode=wallpaper on the web must NOT strip the UI
const _WALLPAPER_AUDIO=(function(){ try{ return new URLSearchParams(location.search||'').get('audio')!=='0'; }catch(e){ return true; } })();
// CRT strength x5 (owner 2026-08-22): default was 0.3. ?scanlines=0..1 overrides.
let _RRR_SCANLINE_STRENGTH=(function(){ try{ var raw=new URLSearchParams(location.search||'').get('scanlines'),v=Number(raw); return raw!=null&&isFinite(v)?Math.max(0,Math.min(1,v)):1.0; }catch(e){ return 1.0; } })();
const _POPOVER_MODE=_RRR_DESKTOP_MODE==='popover' && !!(window.RRRNative && window.RRRNative.isDesktop);   // Electron menu-bar popover (a controller, plays no audio itself)
const _BROWSE_MODE=_RRR_DESKTOP_MODE==='browse' && !!(window.RRRNative && window.RRRNative.isDesktop);     // Electron desktop control-center window (Portal-style; also a controller)
// BROADCAST render (the YouTube video leg, broadcast/video.js x11grabs the whole window): pure game,
// zero chrome. Force-hides every DOM overlay via CSS so the grab captures ONLY the #stage canvas —
// deterministic, independent of the idle-hide timers the manual playExternal path never drives.
const _RRR_BROADCAST=(function(){ try{ return new URLSearchParams(location.search||'').get('broadcast')==='1'; }catch(e){ return false; } })();
try{ if(_RRR_BROADCAST && document.body) document.body.classList.add('rrr-broadcast'); }catch(e){}
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
  if(GAME_BY_KEY.hover && !_BROKEN_GAMES.hover && notKey!=='hover') return 'hover';   // hover is always inlined
  for(var i=0;i<POOL.length;i++){ if(POOL[i].key!==notKey) return POOL[i].key; }
  return (GAME_BY_KEY.hover && !_BROKEN_GAMES.hover) ? 'hover' : null;
}
function _safeMake(gm, A, U, variant){
  if(!gm) return null;
  try{ var st=gm.make(A, U, variant); gm._err=0; return st||{}; }
  catch(e){ _markGameBroken(gm, 'make', e); return null; }
}

// ----- a single game played full-screen on its own tab (its visuals + its soundfont) -----
let selGame=null, selState=null, selVar=0, gameT=0, gameLastSect='';
let randomMode=false, randomT=0, lastRandomIdx=-1;   // RANDOM rides the same path as a tab, auto-switching games on an interval
let _recentGameKeys=[];   // recent RANDOM picks — the next pick avoids the last 2 for more variety
let _lastSceneState=null, _lastSceneGameKey='';             // reset the rotation timer only when the GAME changes (a same-game watchdog re-make must not restart the 30s window)
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
  // Stand down to audio-only ONLY when the page is truly hidden — minimised, another tab, or fully
  // occluded (all report document.hidden). A visible-but-UNFOCUSED window keeps animating at full rate,
  // so you can park it on the side and watch the games play themselves — desktop app AND browser alike.
  // (Blur was never a reliable "background" signal anyway: touch devices, and any window with a playing
  // media element, report unfocused while fully visible.)
  if(document.hidden) return true;
  // The Create editor is an opaque full-screen takeover: simulating and painting the stage
  // beneath it is pure waste, and it visibly drags the editor's own frame rate down.
  try{ if(typeof CT_CREATE!=='undefined' && CT_CREATE.isOpen()) return true; }catch(e){}
  return false;
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
let SCENE_TIME=30, sceneTimer=0, sceneBeatenFlag=false;     // RANDOM-mode visual rotation interval (seconds). Fixed selections stay pinned.
// One interval for every surface (web player, /watch, YouTube broadcast, wallpaper) — default 30s. The
// desktop wallpaper app can override it via ?rotate=<seconds> (a Settings control) and live-update it.
let _RRR_SCENE_SECONDS=(function(){ try{ var raw=new URLSearchParams(location.search||'').get('rotate'),v=Number(raw); return raw!=null&&isFinite(v)?Math.max(3,Math.min(3600,Math.round(v))):0; }catch(e){ return 0; } })();
try{ window.__rrrSetSceneSeconds=function(s){ s=Number(s); if(isFinite(s)&&s>0) _RRR_SCENE_SECONDS=Math.max(3,Math.min(3600,Math.round(s))); };
  window.__rrrSceneSeconds=function(){ return _RRR_SCENE_SECONDS || SCENE_TIME; }; }catch(e){}
// "beaten" = the on-screen game finished its level THIS scene — a RISING EDGE of its generic clear flag (e.g. Byte Maze clears all
//  dots -> st.win; Blast clears all enemies -> st.won; Hover flips trip<->fight -> st.win). This is an OPT-IN convention, not a
//  per-game branch: a game gets early rotation only if it sets st.win/st.won; otherwise it just rides the timer. Endless games
//  (Squadron waves, Blocks, ...) never set these, so they change purely on the timer. (We ignore stage counters like st.wave too.)
function sceneBeaten(st){
  if(!st) return false;
  var clearing = (st.win>0)||(st.won>0);
  var edge = clearing && !st._wasClr;
  st._wasClr = !!clearing;
  return edge;
}
// Games fill the ENTIRE viewport, edge to edge — no chrome, no margins, at ANY aspect ratio (this is how
// we represent games everywhere: website, wallpaper, stream). A small overscan on every side means the
// beat/click screen-shake shakes FILLED content instead of revealing a black border. Games cover-fill this
// rect (see each renderer); the overscan is hidden past the viewport edge.
// The floors here were absolute pixels chosen when the stage was always the
// viewport (~720 tall). The stage is now the console framebuffer -- 180 rows on
// the DMG -- where an 8px floor is 4.4% of the screen instead of 1.1%. Scale
// them to H so the layout is the same PROPORTION at either resolution.
function sceneOverscan(U){ return Math.max(Math.round(H*0.011), Math.round((U||18)*0.6)); }
// A small bottom safe-inset so the transport bar (web) / dock (wallpaper) never swallows the bottom of
// gameplay. The game LAYOUT area stops `sb` short of the viewport bottom (content lifts above the bar);
// the reserved strip is filled by bleeding the game's own bottom edge down (see scnGame) — never a black bar.
// The YouTube/broadcast leg has NO chrome to avoid, so it takes NO inset — and skips the per-frame edge
// bleed entirely (a canvas→same-canvas drawImage is nearly free on a GPU but collapses the render rate on
// the box's software renderer, which was dropping the 30fps stream to a few real fps).
// The transport bar covers ~7.5% of the viewport at any size. As an absolute
// 42px floor this reserved 23% of a 180-row framebuffer and left a dead band
// under every game -- the games visibly stopped short of the bottom edge.
function sceneSafeBottom(){ if(_RRR_BROADCAST) return 0;
  // The GAME VIEW reserves nothing. This inset exists to keep gameplay clear of
  // a full-width transport bar, and in the game view there is no longer one:
  // the chrome is three floating pills that fade out on their own. What the
  // reservation actually produced was a dead strip the pack never painted,
  // filled by stretching a single corner pixel across the width -- fine under a
  // platformer's ground, and unmistakably a corrupt band under a radial game
  // like the vortex, where that one pixel is whichever sector happened to be in
  // the corner. Measured on the vortex: a flat band of luminance 38 against 31
  // for the picture above it. Dropping it also gives every game the bottom 5.5%
  // of the screen back, which is the third time this project has had to answer
  // "the games don't fill the screen".
  //
  // The wallpaper dock and the ordinary bottom bar (library/browse) are real
  // full-width chrome, so those keep the inset.
  try{ if(!_WALLPAPER_MODE && document.body && document.body.classList.contains('ai-visual')) return 0; }catch(e){}
  // Proportional ONLY on the Game Boy framebuffer, where H is 180 and the old
  // absolute 42px floor reserved 23% of the screen. The normal view keeps the
  // original formula exactly -- it is not the thing being fixed.
  if(_panelMode()) return Math.max(1, Math.round(H*0.075));
  return Math.round(Math.min(Math.max(H*0.055, 42), 108)); }
function fullArea(U){ const ov=sceneOverscan(U); const sb=sceneSafeBottom();
  return { x:-ov, y:-ov, w:W+2*ov, h:(H+ov)-sb, sb:sb }; }
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
let _silentTempoSince=0, _silentTempoFallback=null, _silentTempoToken='';
function silentTempoClock(base, rx){
  try{
    if(!Audio || (Audio.extActive&&Audio.extActive()) || !Radio || !Radio.state || Radio.state.tempo==null){
      _silentTempoSince=0; _silentTempoFallback=null; return null;
    }
    var manual=Number(Radio.state.tempo), native=Number(Audio.trackBpm&&Audio.trackBpm());
    var deck=Audio.deckPosition&&Audio.deckPosition(), token=deck&&deck.tok||'';
    if(!isFinite(manual)||!isFinite(native)||manual<180||manual<=native*1.12){
      _silentTempoSince=0; _silentTempoFallback=null; _silentTempoToken=token; return null;
    }
    if(token!==_silentTempoToken){ _silentTempoSince=0; _silentTempoFallback=null; _silentTempoToken=token; }
    var probe=Audio.outputProbe&&Audio.outputProbe();
    var bands=rx&&rx.bands||{}, signal=probe?Number(probe.signal)||0:Math.max(Number(bands.bass)||0,Number(bands.mid)||0,Number(bands.treble)||0);
    var wave=rx&&rx.waveform||[];
    if(!probe)for(var wi=0;wi<wave.length;wi++)signal=Math.max(signal,Math.abs(Number(wave[wi])||0));
    var now=_nowMs(), deckEnded=!!(deck&&deck.sec>=deck.durSec+0.15&&!deck.next);
    if(signal>0.004){ _silentTempoSince=0; _silentTempoFallback=null; return null; }
    if(!_silentTempoSince)_silentTempoSince=now;
    if(!_silentTempoFallback && (deckEnded||now-_silentTempoSince>=2500)){
      var g0=base&&base.grid?base.grid():{gstep:0,phase:0};
      _silentTempoFallback={ at:now, step:(Number(g0.gstep)||0)+(Number(g0.phase)||0), bpm:native };
    }
    if(!_silentTempoFallback)return null;
    var fb=_silentTempoFallback, bpm=Math.max(55,Math.min(220,fb.bpm)), step16=60/bpm/4;
    var step=fb.step+(now-fb.at)/1000/step16, gstep=Math.floor(step), phase=step-gstep;
    return { gstep:gstep,phase:phase,beat:(gstep/4)|0,bar:(gstep/16)|0,spb:60/bpm,step16:step16,bpm:Math.round(bpm),silentFallback:true };
  }catch(e){ return null; }
}
function makeCachedFrameSND(base, rx){
  base = base || {};
  let gotGrid = false, gotClock = false, gr = null, cl = null;
  const snd = Object.assign({}, base);
  const fallbackGrid=silentTempoClock(base,rx);
  snd.grid = function(){
    if(!gotGrid){
      gotGrid = true;
      if(fallbackGrid)gr=fallbackGrid;
      else try{ gr = (base && typeof base.grid === 'function') ? base.grid() : null; }catch(e){ gr = null; }
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
      if(fallbackGrid){
        var ph=((fallbackGrid.gstep%4)+fallbackGrid.phase)/4;
        cl=Object.assign({},cl,{bpm:fallbackGrid.bpm,beat:fallbackGrid.beat,bar:fallbackGrid.bar,
          beatPulse:Math.pow(1-fallbackGrid.phase,2),pulse:Math.pow(1-fallbackGrid.phase,2),barPhase:ph,
          silentTempoFallback:true});
      }
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
//  not just the loaded CT_GAMES — a valid-but-unloaded key triggers that pack's load and shows hover meanwhile. -----
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
  const U = _gameUnit(W, H);
  // start on a RANDOM variant (e.g. Byte Maze picks one of its maze shapes at random on load);
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
function randomKey(){                                          // pick a random healthy game — RANDOM "clicks" this tab
  const pool = POOL.length ? POOL : GAMES.filter(gm=>gm && !_BROKEN_GAMES[gm.key]);
  if(!pool.length) return _fallbackGameKey('') || 'hover';
  // Never repeat a game used within the last 2 picks (more variety); relax only if the pool is too small.
  var avoid2 = _recentGameKeys.slice(-2);
  var cands = pool.filter(function(gm){ return avoid2.indexOf(gm.key) < 0; });
  if(!cands.length) cands = pool.filter(function(gm){ return gm.key !== _recentGameKeys[_recentGameKeys.length-1]; });   // at least ≠ last
  if(!cands.length) cands = pool;
  var key = cands[Math.floor(Math.random()*cands.length)].key;
  _recentGameKeys.push(key); if(_recentGameKeys.length > 6) _recentGameKeys.shift();
  return key;
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
function cycleVisualizerGame(dir){
  var pool=(POOL&&POOL.length?POOL:GAMES).filter(function(gm){ return gm&&gm.key&&!_BROKEN_GAMES[gm.key]; });
  if(!pool.length) return false;
  var i=pool.map(function(gm){return gm.key;}).indexOf(curGameKey);
  if(i<0)i=0;
  i=(i+(Number(dir)<0?-1:1)+pool.length)%pool.length;
  randomMode=true;
  showGame(pool[i].key);
  return true;
}
// VISUAL-ONLY game swap. The game is purely the music video — selecting OR auto-shuffling a game NEVER touches the
// music; tempo/feel come ONLY from the generated track token. Leaves randomMode for the caller to set.
// A key that is discovered-but-not-loaded (or broken) falls back to hover while its pack loads.
function showGame(key){
  let showKey = (key==='random') ? randomKey() : key;
  let gm = GAME_BY_KEY[showKey];
  if((!gm || _BROKEN_GAMES[showKey]) && showKey){
    _ensureGamePackLoaded(showKey);
    showKey=_fallbackGameKey(showKey)||showKey;
    gm=GAME_BY_KEY[showKey]||null;
  }
  const U = _gameUnit(W, H);
  sceneKind = gm ? 'game' : 'abs';
  curGameKey = showKey; selGame = gm||null; selVar = gm ? Math.floor(Math.random()*(gm.variants||1)) : 0; gameT=0; gameLastSect='';
  if(selGame){
    selState=_safeMake(selGame, fullArea(U), U, selVar);
    if(selState==null){                                        // pack broke on make -> one hop to the fallback (hover is inline)
      const fb=_fallbackGameKey(showKey);
      selGame=fb?GAME_BY_KEY[fb]:null; curGameKey=fb||showKey; sceneKind=selGame?'game':'abs';
      selState=selGame?(_safeMake(selGame, fullArea(U), U, 0)||{}):null; selVar=0;
    }
  }
  // The NES scheme depends on the GAME as well as the track now, so it is
  // re-picked here too -- otherwise switching packs mid-track leaves a dungeon
  // holding a palette chosen for whatever was on screen before it.
  if(typeof _pickNesScheme==='function') _pickNesScheme(_curSlug);
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
  // A watchdog reset RE-MAKES the SAME game with fresh state — it must NEVER swap to a different game.
  // Only the rotation TIMER changes which game is shown (owner: time-based rotation only). We deliberately
  // do NOT reset sceneTimer here, so a mid-scene reset doesn't restart the rotation window.
  const nv = Math.max(1, selGame.variants || 1);
  if(nv > 1){
    const jump = 1 + Math.floor(Math.random() * Math.max(1, nv - 1));
    selVar = (selVar + jump) % nv;
  }
  selState=_safeMake(selGame, A || fullArea(U), U, selVar);
  if(selState==null){ showGame(_fallbackGameKey(selGame&&selGame.key)||'random'); return; }
  _lastSceneState = selState;
  gameT = 0;
  if(!(typeof _transportIsPaused === 'function' && _transportIsPaused())) flash = Math.min(1, (flash || 0) + 0.22);
}
function scnGame(dt,U,bpm,sect,events){
  sceneT += dt; shake = Math.max(0, shake - dt*4);
  g.fillStyle = '#000'; g.fillRect(0,0,W,H);
  function jolt(){ flash=Math.min(1,flash+0.4); shock=0.6; shockColor=palColor(7); flashColor=hexToRgb(shockColor); }
  // Fixed game selections are sticky. RANDOM is the only mode allowed to auto-cut to another visual scene.
  // The timer restarts whenever the scene object changes, so each random pick gets its full window.
  if(selState !== _lastSceneState){ _lastSceneState = selState; if(curGameKey !== _lastSceneGameKey){ _lastSceneGameKey = curGameKey; sceneTimer = 0; } }
  if(randomMode){
    sceneTimer += dt;
    var limit = _RRR_SCENE_SECONDS || SCENE_TIME;   // configurable interval (wallpaper Settings), else the 30s default
    var swap = (sceneTimer >= limit);               // TIME-BASED ONLY — a level-clear never cuts a scene short
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
  // Fill the reserved bottom strip (A.sb) with a flat sample of the game's BACKGROUND (the bottom-left
  // corner — never a centred sprite). Bleeding the full-width bottom row smeared any sprite pinned there
  // (Crossing's frog) into vertical streaks; a corner sample keeps the fill clean while covering the strip
  // (no black bar). Games' own bottom content (ground, well bg) sits above it.
  if(A.sb>0 && !frameErr){
    var edge=A.y+A.h;                                            // CSS-px screen y of the game's bottom edge (= H - sb)
    if(edge>2 && edge<H){
      var srcX=Math.max(0, Math.round(6*DPR)), srcY=Math.max(0, Math.round((edge-3)*DPR));
      try{ g.drawImage(cv, srcX, srcY, 1, 1, 0, edge-1, W, H-(edge-1)); }catch(e){}
    }
  }
  if(frameErr && selGame._err>=3){                              // repeated frame throws -> the PACK is broken; rotate off it
    _markGameBroken(selGame, 'frame', frameErr);
    showGame(randomMode ? 'random' : (_fallbackGameKey(selGame.key)||'random'));
    return;
  }
  if(watchdogReset) _resetSelectedGameFromWatchdog(watchdogReset, U, A);
}
// NOTE: there used to be a second, parallel "abstract visualizer" scene here (scnAbs / pickGame /
// freeArea, with its own curGame/curState/vigT/remStage/lastSect state). It only ran when NO game was
// available — but hover is always inlined, so sceneKind was always 'game' and that path was dead.
// Deleted. The single scnGame/selGame path above is the whole show; the no-game case renders black.

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
  // gate at 0.4% (owner 2026-07-16): a <0.4% zoom is sub-3px at 720p — invisible — but the fractional
  // transform pushed EVERY subsequent draw off Skia's integer fast paths. The visible punch (near the
  // beat, up to 1.8%) is untouched; only the imperceptible decay tail now renders untransformed.
  // no camera move on the Game Boy panel: a fractional zoom resamples the cell
  // grid and smears every pixel across its neighbours. (The save/restore pair is
  // still balanced -- only the transform is skipped.)
  if(amt>0.004 && !_panelMode()){ g.translate(W/2,H/2); g.scale(1+amt,1+amt); g.translate(-W/2,-H/2); } }
// energy vignette — the full-canvas radial-gradient FILL is the expensive part on software raster
// (per-pixel gradient eval ~2ms/frame at 720p): rasterize each (size, quantized-energy) variant ONCE
// into an offscreen canvas and drawImage it per frame (Skia's fast SIMD path). Small LRU because the
// quantized energy oscillates between adjacent buckets. Rasterize from the bucket center so reuse is
// deterministic instead of depending on whichever raw energy value first populated that cache key.
var _vigCache=new Map(), _VIG_LRU=12;
function _vignette(e){ var qe=Math.round(e*20)/20, key=(W|0)+'x'+(H|0)+':'+DPR+':'+qe;
  var cv2=_vigCache.get(key);
  if(!cv2){
    var vig=Math.max(0.02, 0.06 - qe*0.04);          // barely there; see VIG_BG
    // device-resolution offscreen + same DPR transform as the live context; the final native-size blit
    // below maps physical pixels 1:1 even when the capped DPR is fractional.
    cv2=document.createElement('canvas'); cv2.width=Math.max(1,Math.floor(W*DPR)); cv2.height=Math.max(1,Math.floor(H*DPR));
    var vg=cv2.getContext('2d'); vg.setTransform(DPR,0,0,DPR,0,0);
    // inner radius off the LONGER axis too, so a wide window does not start
    // darkening a third of the way in from each side
    var grad=vg.createRadialGradient(W/2,H/2, Math.max(W,H)*(0.42+qe*0.20), W/2,H/2, Math.max(W,H)*0.82);
    grad.addColorStop(0,'rgba(0,0,0,0)'); grad.addColorStop(1,'rgba(0,0,0,'+vig.toFixed(3)+')');
    vg.fillStyle=grad; vg.fillRect(0,0,W,H);
    _vigCache.set(key,cv2);
    if(_vigCache.size>_VIG_LRU){ _vigCache.delete(_vigCache.keys().next().value); }   // evict oldest
  } else { _vigCache.delete(key); _vigCache.set(key,cv2); }                            // refresh LRU order
  // Both canvases have identical floored physical dimensions. Blit in device space so a capped
  // fractional DPR cannot resample/shift the last row or column.
  g.save(); g.setTransform(1,0,0,1,0,0); g.drawImage(cv2,0,0); g.restore(); }
function _postFX(RX){
  var e=_uEnergy(RX), gp=_gridBeatPulse(RX).gp, bass=(RX.bands?RX.bands.bass:0);
  var bloom=Math.min(0.16, gp*(e*0.11 + bass*0.10));               // KICK BLOOM: brief additive lighten on the beat
  // gate at 1.2% alpha (owner 2026-07-16): below that the fill is quantization-level invisible, but it
  // still cost a full-canvas additive pass — this drops the imperceptible tail of each bloom decay.
  if(bloom>0.012){ g.save(); g.globalCompositeOperation='lighter'; g.globalAlpha=bloom; g.fillStyle='#fff'; g.fillRect(0,0,W,H); g.restore(); }
  _vignette(e); }                                                  // ENERGY VIGNETTE: tight/calm when quiet, blooms open when loud
  // MOOD WASH removed (owner 2026-07-16): its "skip when imperceptible" guard was dead code, so a
  // 4-10%-alpha full-canvas 'overlay' blend — the slowest blend path on software raster — ran every
  // frame for a wash that was barely visible. Cut entirely rather than tuned.
function _reactorFX(RX, dt){
  _rxHue=(RX.hue||0); var gr=_currentFrameGrid(), beat=gr?gr.beat:0, e=_uEnergy(RX);
  // a small spark accent on each BEAT — tinted by the music hue, scaled by energy (constant liveliness)
  if(beat!==_rxBeat){ _rxBeat=beat; if(e>0.1){ var n=1+Math.round(e*4); spawnBurst(W*(0.2+Math.random()*0.6), H*(0.3+Math.random()*0.36), n, (_rxHue*360)|0); } }
  // DROP MOMENT: designed payoff when the analyser detects a real drop (cooldown keeps it special)
  if(_rxDropCD>0) _rxDropCD-=dt;
  if(RX.drop && _rxDropCD<=0){ _rxDropCD=3.5;
    flash=Math.min(1,flash+0.9); shock=0.85; shockColor=palColor((_rxHue*12)|0); flashColor=hexToRgb(shockColor);
    for(var i=0;i<3;i++) spawnBurst(W*(0.2+Math.random()*0.6), H*(0.25+Math.random()*0.5), 10+(Math.random()*8|0), (_rxHue*360+Math.random()*60)|0);
    // (A drop no longer cuts to a new game — rotation is TIME-BASED ONLY. The drop still flashes/bursts.)
  }
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
// PACE BY VSYNC, NOT BY THE CLOCK. The cap used to be `now - lastFrame <
// target - 1`, which reads as "60fps" and is not: a rAF tick that arrives even
// 1ms early is dropped ENTIRELY, and the next one lands a whole refresh later.
// Simulated against real timings, that gate returns 51.9fps with 15.7% of
// frames hitching at +-1ms of tick jitter, and 44.1fps / 23.3% at +-2ms -- on a
// machine whose rendering is comfortably inside budget. It is judder the app
// inflicts on itself, and no rendering benchmark shows it, because rendering
// was never the problem. Headless browsers tick like metronomes, which is
// exactly why this survived every measurement taken here.
//   Counting ticks instead is exact by construction: measure the display's own
// interval, draw every Nth tick, and the cadence cannot drift. Same simulation:
// 60.0fps, 0% hitches, at every refresh rate and jitter tested. It also gets
// 120Hz right for free -- N becomes 2 -- where the clock gate quietly returned
// 55fps.
let _tickMs = 0, _tickAcc = 0, _tickPrev = 0, _drawSeq = 0, _pnlHold = 2;
let _wallpaperFpsCap = _WALLPAPER_MODE ? 30 : 0, _wallpaperPerformancePaused = false, _wallpaperMotionFrozen = false;
let _frameReq = 0, _frameSeq = 0, _frameStoppedAt = 0;
// ---- THE TRACK RIBBON ------------------------------------------------------
// The whole song end to end along the bottom, doubling as the progress bar.
// Music players put a waveform where the scrubber goes; a Game Boy's waveform
// is its notes, so this draws every note of the track at once -- what has
// played lit, what is coming dimmed. It can afford to be literal because since
// the merge the station IS playing a document, so the notes are simply there
// to read: score.gb.notes, four channels, frames on the x axis.
//
// Baked ONCE per track into two offscreen canvases (lit and dim) and blitted
// twice a frame, because a full redraw of a thousand notes every frame is
// exactly the kind of thing that turns a render budget into judder.
var _ribCv=null, _ribLit=null, _ribDim=null, _ribKey='', _ribW=0, _ribH=0, _ribFrames=0;
var _ribRect=null, _ribMeasureAt=0, _ribEMA=0;
if(typeof window!=='undefined') window.addEventListener('resize', function(){ _ribRect=null; }, {passive:true});
var RIB_COL=['#7BDCA0','#57C4FF','#E8A75D','#C9A4E8'];   // Melody, Harmony, Bass, Drums -- the editor's lanes
// The player bar's height, published as --barh so the stage and the CRT layers
// can end where it begins instead of running underneath it. Measured rather
// than hard-coded: it changes with the viewport, and it is 0 in the modes that
// hide the bar entirely.
var _barhLast=-1;
function _syncBarInset(){
  var h=0;
  try{
    var pb=document.getElementById('playbar');
    if(pb && pb.classList.contains('show') && getComputedStyle(pb).display!=='none'){
      var r=pb.getBoundingClientRect();
      // only when it is docked across the bottom; the old floating layout and
      // the popover/wallpaper modes leave the picture full-bleed
      if(r.width > window.innerWidth*0.9) h=Math.round(r.height);
    }
  }catch(e){ h=0; }
  if(h===_barhLast) return;
  _barhLast=h;
  try{ document.documentElement.style.setProperty('--barh', h+'px'); }catch(e){}
  try{ if(window.__ctResizeStage) window.__ctResizeStage(); }catch(e){}
  // the CRT bakes its gain map to the picture's size; it rebuilds on resize,
  // and the picture just changed size without the window doing so
  try{ window.dispatchEvent(new Event('resize')); }catch(e){}
}
window._syncBarInset=_syncBarInset;
// THE HOME'S MIDDLE IS THE CREDIT; THE ASK SITS IN THE CORNER. Owner's call.
// Done by moving the nodes rather than by positioning them from a distance: the
// hero is a centred flex column of unknown height, and a fixed element cannot
// be told to sit inside one.
var _homeArranged = null;
function _syncHomeLayout(){
  try{
    var wait = !!(document.body && document.body.classList.contains('awaiting-mood'));
    if(wait === _homeArranged) return;
    var rows = document.getElementById('rmoods');
    var made = document.getElementById('madeby');
    var ask  = rows && rows.querySelector('.rmood-ask');
    if(!rows || !made || !ask) return;
    if(wait){
      var brand = rows.querySelector('.rmood-brand');
      if(brand && brand.nextSibling !== made) rows.insertBefore(made, brand.nextSibling);
      else if(!brand && made.parentNode !== rows) rows.appendChild(made);
    } else if(made.parentNode !== document.body){
      document.body.appendChild(made);
    }
    _homeArranged = wait;
  }catch(e){}
}
window._syncHomeLayout=_syncHomeLayout;
function _ribbonVisible(){
  try{
    if(_WALLPAPER_MODE||_POPOVER_MODE||_BROWSE_MODE) return false;
    if(document.body && document.body.classList.contains('gb-open')) return false;
    var pb=document.getElementById('playbar');
    return !!(pb && pb.classList.contains('show'));
  }catch(e){ return false; }
}
function _ribbonBake(){
  var sc=null; try{ sc=(Audio.currentScore && Audio.currentScore())||null; }catch(e){}
  var notes=(sc && sc.gb && sc.gb.notes)||null;
  var empty=!notes || !notes.length;
  if(empty) notes=[];
  var total=empty ? 1 : ((sc.gb.totalFrames|0) || 1);
  // MEASURE RARELY. getBoundingClientRect inside the frame loop forces a style
  // and layout pass every frame -- with the playbar's flex row behind it that
  // alone cost 13ms a frame, which is most of a frame's budget spent asking how
  // wide something is that only changes when the window does.
  if(!_ribRect || _ribMeasureAt<=0){ _ribRect=_ribCv.getBoundingClientRect(); _ribMeasureAt=45; }
  else _ribMeasureAt--;
  var r=_ribRect;
  if(!r.width) return false;
  var dpr=Math.min(2, (window.devicePixelRatio||1));
  // rounded to 4 device pixels: a layout that settles a third of a pixel
  // differently must not count as a new size and re-bake the song
  var w=Math.max(4,Math.round(r.width*dpr/4)*4), h=Math.max(4,Math.round(r.height*dpr/4)*4);
  var key=(empty?'-':(sc.doc? sc.doc.length : notes.length))+':'+total+':'+notes.length+':'+w+'x'+h;
  if(key===_ribKey && _ribLit) return true;
  _ribKey=key; _ribW=w; _ribH=h; _ribFrames=empty?0:total;
  if(_ribCv.width!==w) _ribCv.width=w;
  if(_ribCv.height!==h) _ribCv.height=h;
  // FOUR LANES, THE WAY THE EDITOR STACKS THEM. Mapping every melodic voice
  // into one pitch band was wrong: the drums are usually more than half the
  // notes in a song, so the strip came out 69% purple and read as one colour
  // rather than as four voices. Melody, Harmony, Bass, Drums each get a lane in
  // their own colour, top to bottom, in the editor's order -- so this is a
  // miniature of the grid rather than a different picture of the same song.
  var pad=Math.max(1,Math.round(h*0.05));
  var laneH=(h-pad*2)/4, gap=Math.max(1,Math.round(laneH*0.14));
  var nh=Math.max(2, Math.round(laneH*0.42));   // room left over IS the pitch contour
  // each voice is scaled to ITS OWN range, so a bass line uses its whole lane
  var lo=[127,127,127,127], hi=[0,0,0,0], i, n;
  for(i=0;i<notes.length;i++){ n=notes[i];
    if(n.midi==null) continue; var ch0=(n.ch|0)&3;
    if(n.midi<lo[ch0]) lo[ch0]=n.midi; if(n.midi>hi[ch0]) hi[ch0]=n.midi; }
  for(i=0;i<4;i++){ if(hi[i]<lo[i]){ lo[i]=48; hi[i]=72; }
    if(hi[i]-lo[i]<7){ var m2=(hi[i]+lo[i])/2; lo[i]=m2-3.5; hi[i]=m2+3.5; } }
  // bar lines behind the notes: the request was to see the BARS of the song as
  // well as what is in them, and they are what makes the shape of an
  // arrangement readable -- where a section turns over, where the drums drop.
  var fpb=0;
  try{ var bpm=(sc.bpm||120); fpb=(typeof CT_GB_HARDWARE!=='undefined'?CT_GB_HARDWARE.FPS:59.7275)*(60/bpm)*4; }catch(e){}
  function paint(ctx, alpha){
    ctx.clearRect(0,0,w,h);
    if(fpb>0 && total/fpb < 400){
      var every=(total/fpb)>64?4:(total/fpb)>32?2:1;      // keep the ticks readable on a long song
      for(var bx=0;bx*fpb<total;bx+=every){
        var lx=Math.round((bx*fpb/total)*w)+0.5;
        // faint, and only every fourth one carries any weight: drawn at white
        // full height these read as a voice of their own rather than as a grid
        ctx.globalAlpha=alpha*(bx%(every*4)===0?0.10:0.045);
        ctx.fillStyle='#ffffff'; ctx.fillRect(lx,0,1,h);
      }
      ctx.globalAlpha=1;
    }
    for(var j=0;j<notes.length;j++){
      var q=notes[j];
      var ch=(q.ch|0)&3;
      var x=(q.frame/total)*w, ww=Math.max(2,((q.frames||1)/total)*w);
      var top=pad+ch*laneH;
      // pitch still moves the note WITHIN its lane, so the contour is readable
      var span=Math.max(0, laneH-gap-nh), y=top;
      if(q.midi!=null){ var t=(q.midi-lo[ch])/Math.max(1,(hi[ch]-lo[ch])); y=top+(1-t)*span; }
      else y=top+span*0.5;
      ctx.globalAlpha=alpha*(0.6+0.4*Math.min(1,(q.vel==null?0.8:q.vel)));
      ctx.fillStyle=RIB_COL[ch];
      ctx.fillRect(x, y, ww, nh);
    }
    ctx.globalAlpha=1;
  }
  if(!_ribLit){ _ribLit=document.createElement('canvas'); _ribDim=document.createElement('canvas');
    _ribLit.__ctpalRaw=true; _ribDim.__ctpalRaw=true; }   // baked offscreen, same rule
  _ribLit.width=w; _ribLit.height=h; _ribDim.width=w; _ribDim.height=h;
  paint(_ribLit.getContext('2d'), 1);
  paint(_ribDim.getContext('2d'), 0.38);   // low enough to read as 'not yet', high enough to keep its hue
  return true;
}
function _ribbonFrame(){
  if(!_ribCv){
    _ribCv=document.getElementById('noteribbon'); if(!_ribCv) return;
    // The strip is UI, not console art. CT_PAL hooks fillStyle on the 2D
    // prototype and quantises every canvas to the Game Boy's four shades or the
    // NES palette while one of those screens is on -- which snapped the lane
    // colours to whatever was nearest and made the strip a different set of
    // colours on every other track. __ctpalRaw is the existing opt-out; the
    // editor's own grid uses it for the same reason.
    _ribCv.__ctpalRaw=true;
  }
  var on=_ribbonVisible();
  if(document.body) document.body.classList.toggle('ribbon-on', on);
  if(!on) return;
  if(!_ribbonBake()) return;
  var g2=_ribCv.getContext('2d');
  g2.clearRect(0,0,_ribW,_ribH);
  g2.drawImage(_ribDim,0,0);                                   // the track ahead
  var pos=0;
  if(!_ribFrames){ _ribbonClock(0); return; }        // nothing loaded: the lanes, empty
  try{ var d=(Audio.audiblePosition && Audio.audiblePosition()) || (Audio.deckPosition && Audio.deckPosition());
       if(d && d.sec>0) pos=(d.sec*(typeof CT_GB_HARDWARE!=='undefined'?CT_GB_HARDWARE.FPS:59.7275))/_ribFrames; }catch(e){}
  pos=Math.max(0,Math.min(1,pos));
  var px=Math.round(pos*_ribW);
  if(px>0){ g2.save(); g2.beginPath(); g2.rect(0,0,px,_ribH); g2.clip();
            g2.drawImage(_ribLit,0,0); g2.restore(); }             // ...and the track behind
  g2.fillStyle='rgba(255,255,255,.85)'; g2.fillRect(px-1,0,2,_ribH);
  _ribbonClock(pos);
  _syncBarDials();
}
// elapsed / total, either side of the strip. Written only when the SECOND
// changes: this runs every frame and setting textContent is a layout write.
var _ribClockA='', _ribClockB='';
function _syncBarDials(){
  try{
    var b=document.getElementById('pbBpm'), br=document.getElementById('pbBpmRead');
    if(b){
      var d=Audio.deckPosition&&Audio.deckPosition();
      var bpm=null;
      try{ var sc=Audio.currentScore&&Audio.currentScore(); bpm=sc?Math.round(sc.bpm):null; }catch(e){}
      try{ if(typeof Radio!=='undefined'&&Radio.state&&Radio.state.tempo!=null) bpm=Math.round(Radio.state.tempo); }catch(e){}
      if(bpm && document.activeElement!==b){ b.value=String(bpm); }
      if(br) br.textContent = bpm ? String(bpm) : '\u2014';
    }
    var v=document.getElementById('pbVol');
    if(v && document.activeElement!==v && window._scopeMix){
      // the readout is kept by refreshVolumeDock; only the slider needs syncing
    }
  }catch(e){}
}
function _ribbonClock(pos){
  var fps=(typeof CT_GB_HARDWARE!=='undefined'?CT_GB_HARDWARE.FPS:59.7275);
  var total=_ribFrames?_ribFrames/fps:0, at=pos*total;
  var a=_mmss(at), b=_mmss(total);
  if(a!==_ribClockA){ var e1=document.getElementById('pbElapsed'); if(e1) e1.textContent=a; _ribClockA=a; }
  if(b!==_ribClockB){ var e2=document.getElementById('pbTotal'); if(e2) e2.textContent=b; _ribClockB=b; }
}
function _mmss(sec){
  if(!isFinite(sec)||sec<0) sec=0;
  var m=Math.floor(sec/60), s2=Math.floor(sec%60);
  return m+':'+(s2<10?'0':'')+s2;
}
function _frameDiag(){
  return {
    active:!!_frameReq,
    seq:_frameSeq,
    audioOnly:!!_bgAudioOnly,
    stoppedAt:_frameStoppedAt,
    target:+_frameTarget.toFixed(1),
    cost:+_renderEMA.toFixed(2),
    tick:+(_tickMs||0).toFixed(2),
    rib:+_ribEMA.toFixed(3),
    lag:+((typeof Audio!=='undefined'&&Audio.audibleLag)?Audio.audibleLag():0).toFixed(3),
    every:Math.max(1, Math.round(_frameTarget / (_tickMs || 16.7))),
    drawn:_drawSeq
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
  // learn the display's refresh interval from the ticks themselves
  if(_tickPrev){ var _d = now - _tickPrev;
    if(_d > 3 && _d < 40) _tickMs = _tickMs ? _tickMs + (_d - _tickMs) * 0.1 : _d; }
  _tickPrev = now;
  // FPS cap -> yield the main thread to audio scheduling. Every Nth vsync.
  var _N = Math.max(1, Math.round(_frameTarget / (_tickMs || 16.7)));
  if(++_tickAcc < _N) return;
  _tickAcc = 0;
  _drawSeq++;                                     // frames DRAWN; _frameSeq counts ticks seen
  const _t0 = now;
  const dt = Math.max(0, Math.min(0.05,(now-lastFrame)/1000)); lastFrame = now;
  const paused = (typeof _transportIsPaused==='function' && _transportIsPaused());
  const simDt = paused ? 0 : dt;
  if(paused){
    if(typeof INP!=='undefined') INP.clickPulse = false;
    shake = 0; flash = 0; shock = 0;
  }
  const U = _gameUnit(W, H);
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
  // one field claim per frame (see dmg-palette.js): the pack's first
  // screen-covering fill is the Game Boy's reflector, the rest are art
  if(_panelMode() && typeof CT_PAL!=='undefined') CT_PAL.beginFrame();
  if(RX && !paused) _beatPump(RX);                                // no camera pump while paused; games may still draw subtle idle state
  scnGame(simDt,U,bpm,sect,events);   // single scene path — games are always available; the no-game case renders black
  if(RX){ g.restore(); g.setTransform(DPR,0,0,DPR,0,0); g.globalAlpha=1;
    // The DMG gets NONE of this. Vignette, additive bloom and the spark bursts
    // are full-canvas passes drawn over art that has already been quantised to
    // four levels, and they put it straight back onto a continuous ramp --
    // measured down the middle of the stage: 94, 92, 90, 89, 88, 86, 70, none of
    // them a level the panel can display. The panel then re-quantises a degraded
    // picture and two blocks that should share a shade land either side of a bin
    // edge. On this screen the pack's own draw calls ARE the frame, and the
    // panel is the only post-process there is.
    if(_panelMode()){ /* the panel is the post-process */ }
    else if(paused){ _vignette(0.16); }
    else if(RX.idle && !RX.paused){ _vignette(0.16); } else { _postFX(RX); if(!RX.paused) _reactorFX(RX, dt); } }   // paused is a calm held frame; no gameplay/drop spawns
  if(typeof INP!=='undefined') INP.clickPulse = false;     // one click = one frame's action
  if(shock>0.01 && !_panelMode()){ const r=(1-shock)*Math.hypot(W,H)*0.6; g.globalAlpha=shock; g.strokeStyle=shockColor; g.lineWidth=Math.max(2,22*shock);
    g.beginPath(); g.arc(W/2,H/2,r,0,Math.PI*2); g.stroke(); g.globalAlpha=1; shock=Math.max(0,shock-dt*2.2); }
  // A full-screen wash is not something either console can do, and the panels
  // drop it. The NES has a real equivalent -- the PPU's colour-emphasis bits,
  // which attenuate two thirds of the signal and darken the whole picture at
  // once. That is how games actually flashed, so on this screen the flash drives
  // those bits instead of painting over the frame.
  if(_nes) _nes.emphasis = (_screenMode==='nes' && flash>0.35) ? 7 : 0;
  if(flash>0.01 && !_panelMode()){ g.fillStyle=`rgba(${flashColor},${0.10*flash})`; g.fillRect(0,0,W,H); }
  if(flash>0.01) flash=Math.max(0,flash-dt*3);
  if(!paused) drawParts(dt);
  // adaptive: prefer smooth 60fps visuals; back off to ~42/30fps only when drawing cost threatens audio headroom.
  const _cost = (typeof performance!=='undefined'&&performance.now?performance.now():now) - _t0;
  _renderEMA += (_cost - _renderEMA) * 0.1;
  // whole multiples of a 60fps frame: a display can only show 60/30/20, and
  // asking for the 42fps that "24" used to mean just means uneven frames.
  var adaptiveTarget = (_renderEMA > 24) ? 50.1 : (_renderEMA > 15 ? 33.4 : 16.7);
  _frameTarget = Math.max(adaptiveTarget, _wallpaperFpsCap ? 1000/_wallpaperFpsCap : 0);
  var _pnl = _panel();
  if(_pnl){
    // the panel decides the framebuffer size; the stage follows it
    var _N = _screenMode==='dmg' ? window.CT_DMG_NATIVE : window.CT_NES_NATIVE;
    if(_N && (cv.width!==_N.w || cv.height!==_N.h)) resize();
    // PAUSED MEANS PAUSED, INCLUDING THE SCREEN. The panel is deterministic
    // from its source, but it quantises a 500px framebuffer up to the window,
    // so the little that still moves while paused -- a decaying particle, a
    // flash tailing off -- flips whole blocks of output and the picture reads
    // as alive. Two more frames after the pause settle the tail, then hold.
    if(!paused) _pnlHold = 2;
    else if(_pnlHold > 0) _pnlHold--;
    if(!paused || _pnlHold > 0){
      try{ _pnl.frame(); }catch(e){ _screenMode='crt'; _applyScreenMode(); }
    }
  }
  // timed separately from _renderEMA, which covers the whole frame: the strip
  // has to be provably cheap on its own, not lost inside the game's cost
  try{ var _rt0=_nowMs(); _ribbonFrame(); _ribEMA += ((_nowMs()-_rt0) - _ribEMA)*0.1; }catch(e){}
  if((_frameSeq & 31)===0){ try{ _syncBarInset(); }catch(e){} try{ _syncHomeLayout(); }catch(e){} }
  if(typeof window!=='undefined') window.__rrrFrame = _frameDiag();
  _frameRX = null; _frameSND = null;
}
// ---- SCREEN MODE -----------------------------------------------------------
// Two consoles, simulated properly, and two escape hatches.
//
//   'dmg'  the Game Boy: a measured model of the DMG panel -- crosstalk,
//          persistence, the air-gap shadow, the grid, the grain.
//   'nes'  the NES: the picture is encoded to a composite waveform and decoded
//          back, so chroma bleeds, dot crawl marches and edges make colours the
//          palette does not contain. See src/nes-screen.js.
//   'crt'  the original CSS scanline overlay, kept because it is cheap and
//          because ?screen=crt is in links people have already shared.
//   'off'  raw stage, no post-process at all.
//
// dmg and nes are PANELS: each takes over the stage resolution, installs its
// own colour rules at draw time, and owns the whole post-process. crt and off
// leave the stage alone. Several gates below turn on that distinction rather
// than on a specific console, so _panelMode() is the thing to read.
var _dmg = null, _nes = null, _dmgWarned = false, _applyRetries = 0;
function _panelMode(){ return _screenMode==='dmg' || _screenMode==='nes'; }
function _panel(){ return _screenMode==='dmg' ? _dmg : _screenMode==='nes' ? _nes : null; }
// How big one drawn "unit" is, in framebuffer pixels. On a panel this is the
// console's own scale, and it is the difference between a game and a diagram.
//
// The two consoles need different numbers for the SAME apparent size, because
// their framebuffers are different: the NES panel runs 6 output pixels per NES
// pixel against the Game Boy's 10, so at any window it has about 1.67x the
// linear resolution. A unit of 2 there would draw every sprite two thirds the
// size it is on the Game Boy screen -- precisely the "everything is too zoomed
// out" this project has already fixed once. 3 restores the match.
// One sub-palette set per track, chosen from the slug so a given song always
// looks the same and a link reproduces its colours the way it reproduces its
// score. Real NES games do not share a palette, and neither should two tracks:
// with a single fixed set the whole station was one colour scheme forever.
//
// The sprite atlas is baked THROUGH the colour hook and drawImage bypasses it,
// so a scheme change has to re-bake or every sprite keeps the previous track's
// colours -- the same trap that made switching consoles mid-session wrong.
// Which palettes a game's art was drawn for. A cartridge ships its own; it does
// not inherit whatever the console happens to be holding. The dungeon is a
// top-down adventure and needs green for foliage and a pale earth to walk on,
// and four of the seven schemes contain no green at all -- so on most tracks its
// wood came out pink. Games not listed take any scheme, which is the point of
// having them.
var GAME_SCHEMES = {
  dungeon:   ['woodland', 'overworld'],
  platformer:['overworld', 'woodland'],
  crossing:  ['overworld', 'woodland'],
  // Girders are warm reds and oranges; a scheme with no red in it quantizes
  // the whole stage into one magenta family.
  climber:   ['inferno', 'neon']
};
function _pickNesScheme(slug){
  if(typeof CT_NES_PALETTE==='undefined') return;
  // The pack's own state outranks the static table: a game that changes its
  // stage colours mid-song (climber advances variants) says which scheme its
  // CURRENT art was drawn for.
  var stateHint=(typeof selState!=='undefined'&&selState&&selState.nesSchemes&&selState.nesSchemes.length)?selState.nesSchemes:null;
  var allowed = stateHint || GAME_SCHEMES[curGameKey] || null;
  var h = 2166136261, i, key = (slug||'') + '|' + (curGameKey||'');
  for(i=0;i<key.length;i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  var pool = allowed && allowed.length ? allowed.length : CT_NES_PALETTE.SCHEMES.length;
  var n = Math.abs(h) % pool;
  var before = CT_NES_PALETTE.scheme;
  CT_NES_PALETTE.selectScheme(n, allowed);
  if(CT_NES_PALETTE.scheme === before) return;
  if(_screenMode==='nes' && typeof rebuildSprites==='function') rebuildSprites();
}
// A stage advance swaps the variant mid-song, after every ordinary re-pick has
// already run. Watch cheaply and re-pick when the pack's declared scheme and
// the installed one disagree.
setInterval(function(){
  try{
    if(_screenMode!=='nes' || typeof CT_NES_PALETTE==='undefined') return;
    if(typeof selState==='undefined' || !selState || !selState.nesSchemes || !selState.nesSchemes.length) return;
    var cur=CT_NES_PALETTE.scheme && CT_NES_PALETTE.scheme.name;
    if(cur && selState.nesSchemes.indexOf(cur)<0) _pickNesScheme(_curSlug);
  }catch(e){}
}, 1000);
function _gameUnit(W, H){
  if(_screenMode==='dmg') return Math.max(2, Math.round(W/160));  // floored at 2: at 1 the integer unit halves every sprite
  if(_screenMode==='nes') return Math.max(3, Math.round(W/128));
  return Math.max(1, Math.round(Math.min(W,H)/100));
}
// 'mix' is a SELECTION, not a fourth render mode: _screenMode keeps holding the
// mode actually being rendered (eleven places read it), and _screenMix just
// records that it is re-rolled on every track. Adding a fourth value to
// _screenMode itself would have meant auditing every one of those reads.
var _screenMix = false;
// THE TOSS, in one place. Three faces, evenly: the plain view the station has
// always had, the Game Boy panel, and the NES one. It lives here rather than at
// each of the three call sites -- the initial pick, the per-track re-roll, and
// __rrrScreenMode('mix') -- because when it was written out three times the
// odds drifted apart the first time a face was added.
var _SCREEN_FACES = ['crt', 'dmg', 'nes'];
function _tossScreen(){ return _SCREEN_FACES[Math.floor(Math.random() * _SCREEN_FACES.length) % _SCREEN_FACES.length]; }
function _rollScreenMode(){
  if(!_screenMix) return;
  var next = _tossScreen();
  // "Same face" is only a no-op if that face is actually on screen. If the mode
  // says dmg but no panel was ever built, this short-circuit is what made the
  // state unrecoverable -- every subsequent dmg roll returned here.
  var settled = (next === _screenMode) &&
                !(next === 'dmg' && !_dmg) && !(next === 'nes' && !_nes);
  if(settled) return;
  _screenMode = next;
  try{ _applyScreenMode(); }catch(e){}
  try{ if(window._syncGameBoyPill) window._syncGameBoyPill(); }catch(e){}
}
var _screenMode = (function(){
  var pick=null;
  try{
    var q=new URLSearchParams(location.search||'').get('screen');
    if(q==='dmg'||q==='nes'||q==='crt'||q==='off') pick=q;
    else if(q==='mix') _screenMix=true;
    // The pill used to persist its choice, so one press during a session made
    // every later visit colour-only and the coin toss never ran again. Mix is
    // the product, not a remembered preference: every load starts there unless
    // ?screen= says otherwise, and the pill is an override for the session you
    // are in. Clear the old key so anyone still carrying a pin is released.
    localStorage.removeItem('rrrScreen');
  }catch(e){}
  if(pick) return pick;
  // No URL param and nothing saved: the toss IS the default. A visitor should
  // meet the console screens without having to find a control, and should see
  // all three faces come and go as the station plays. Touching the pill pins a
  // mode and stops the tossing; ?screen= and shift+D still win outright.
  _screenMix = true;
  return _tossScreen();
})();
function _applyScreenMode(){
  var stage = document.getElementById('stage');
  // Both of these used to be silent give-ups, and nothing ever came back to
  // try again: the panel module or the stage merely had to be a tick late and
  // the screen stayed on 'dmg' for the rest of the session with no panel behind
  // it. Retry instead. It is a race, which is why ?screen=dmg usually won it
  // and the coin toss -- rolling later, into a page mid-setup -- usually did not.
  var _waiting = (_screenMode==='dmg' && !_dmg && typeof CT_DMG_SCREEN==='undefined') ||
                 (_screenMode==='nes' && !_nes && typeof CT_NES_SCREEN==='undefined');
  if(!stage || _waiting){
    if(_screenMode!=='crt' && _applyRetries < 40){ _applyRetries++; setTimeout(_applyScreenMode, 50); }
    return;
  }
  _applyRetries = 0;
  if(_screenMode==='dmg' && !_dmg && typeof CT_DMG_SCREEN!=='undefined'){
    try{
      _dmg = new CT_DMG_SCREEN.DmgScreen(stage, {});
      if(!_dmg.ok){ _dmg = null; _screenMode='crt'; }
      else { stage.parentNode.insertBefore(_dmg.canvas, stage.nextSibling);
             _dmg.load().catch(function(e){
               // Do not fail silently. This reverted the screen with no trace,
               // which is exactly how a broken shader path went unnoticed.
               try{ console.error('[chiptunes] Game Boy panel unavailable:', e && e.message || e); }catch(_){}
               _dmg=null; _screenMode='crt'; _applyScreenMode();
               try{ if(window._syncGameBoyPill) window._syncGameBoyPill(); }catch(_){}
             }); }
    }catch(e){ _dmg = null; _screenMode = 'crt'; }
  }
  // The NES panel compiles three programs and is done -- no preset, no shader
  // files, nothing a routing fallback can answer with the app shell. That whole
  // class of silent failure does not exist on this path.
  if(_screenMode==='nes' && !_nes && typeof CT_NES_SCREEN!=='undefined'){
    try{
      _nes = new CT_NES_SCREEN.NesScreen(stage, {});
      if(!_nes.ok){ _nes = null; _screenMode='crt'; }
      else { stage.parentNode.insertBefore(_nes.canvas, stage.nextSibling);
             _nes.load().catch(function(e){
               try{ console.error('[chiptunes] NES panel unavailable:', e && e.message || e); }catch(_){}
               _nes=null; _screenMode='crt'; _applyScreenMode();
               try{ if(window._syncGameBoyPill) window._syncGameBoyPill(); }catch(_){}
             }); }
    }catch(e){ _nes = null; _screenMode = 'crt'; }
  }
  if(_dmg) _dmg.setMode(_screenMode==='dmg');
  if(_nes) _nes.setMode(_screenMode==='nes');
  resize();   // a panel decides what resolution the games draw at
  // The console's colour rules, at draw time, so the panel receives artwork the
  // hardware could actually have produced rather than 24-bit art with a filter
  // on top. CT_PAL guarantees only one console is hooked at a time.
  if(typeof CT_PAL!=='undefined'){
    // the sprite atlas was baked under the OTHER console; drawImage bypasses the
    // hook, so re-bake it or every sprite keeps the colours it was born with
    if(CT_PAL.use(_panelMode() ? _screenMode : null) &&
       typeof rebuildSprites==='function') rebuildSprites();
  }
  // Every CRT layer, including the WebGL GAIN canvas. That one is composited
  // with mixBlendMode:multiply and was managed only by the CRT module's own
  // setMode, which knows nothing about this one -- so it stayed visible in dmg
  // and off as well, multiplying the screen by whatever it last baked. With the
  // mode fixed for a whole session nobody hit it; 'mix' changes mode every
  // track, and it turned the screen black.
  var crt = document.querySelectorAll('.crt.scanlines,.crt.vignette,.crt.gain');
  for(var i=0;i<crt.length;i++) crt[i].style.display = 'none';
  // Back on the CRT, hand the decision to the module that owns those layers so
  // it restores whichever of legacy/gain it is actually in.
  if(_screenMode==='crt'){
    try{ if(window.__rrrCrtMode) window.__rrrCrtMode(window.__rrrCrtMode()); }
    catch(e){ for(var j=0;j<crt.length;j++) if(!crt[j].classList.contains('gain')) crt[j].style.display=''; }
  }
  document.documentElement.dataset.rrrScreen = _screenMode;
  // EVERY path that changes the screen ends here, so the label is synced here
  // rather than at the three call sites that remembered to. Setting the mode
  // directly -- the toss does not, but ?screen=, shift+D and __rrrScreenMode do
  // -- used to leave the button naming whichever screen it had last been told
  // about.
  try{ if(typeof _syncGameBoyPill==='function') _syncGameBoyPill(); }catch(e){}
}
if(typeof window!=='undefined'){
  // Development hooks for driving the visual pass -- switching packs without a
  // reload while looking at the panel. Behind ?debug=1 so they are not part of
  // the shipped surface; anyone who wants them can ask for them.
  if(new URLSearchParams(location.search||'').get('debug')==='1'){
    window.__rrrShowGame=function(k){ try{ showGame(k); }catch(e){ return 'err:'+e.message; } return curGameKey; };
    window.__rrrGameKeys=function(){ return (typeof GAMES!=='undefined'&&GAMES.map)?GAMES.map(function(g){return g.key;}):Object.keys(GAME_BY_KEY||{}); };
  }
  // Deliberately not persisted -- see the initialiser. This holds for the page
  // you are on; the next load tosses a coin again.
  window.__rrrScreenMode=function(m){
    if(m==='dmg'||m==='nes'||m==='crt'||m==='off'){
      _screenMix=false; _screenMode=m; _applyScreenMode();
    } else if(m==='mix'){
      _screenMix=true;
      _screenMode=_tossScreen(); _applyScreenMode();
    }
    return _screenMix ? ('mix:'+_screenMode) : _screenMode;
  };
  // Which panel actually exists, as opposed to which mode claims to be on. Every
  // black-screen bug on this project has been that pair disagreeing -- a mode of
  // 'dmg' with no panel behind it, a panel built but never framed -- and none of
  // it was visible from outside. Three lines, always on, not behind ?debug=1.
  window.__rrrPanelDiag=function(){
    return { mode:_screenMode, mix:_screenMix, dmg:!!_dmg, nes:!!_nes,
             nesReady:!!(_nes&&_nes.ready), nesBroken:!!(_nes&&_nes.broken),
             dmgReady:!!(_dmg&&_dmg.ready), retries:_applyRetries,
             native: window.CT_DMG_NATIVE || window.CT_NES_NATIVE || null,
             pal: (typeof CT_PAL!=='undefined') ? CT_PAL.name : null };
  };
  // __rrrScreenParam('bb_crosstalk', 0.2) — tune a panel by eye; no args lists.
  // The NES panel has no vendored passes, so its knobs live in one `tune`
  // object and are handled first.
  window.__rrrScreenParam=function(name, value){
    if(_screenMode==='nes'){
      if(!_nes) return null;
      if(name==null) return Object.assign({}, _nes.tune);
      if(name in _nes.tune && value!=null) _nes.tune[name]=value;
      var one={}; one[name]=_nes.tune[name]; return one;
    }
    if(!_dmg || !_dmg.passes) return null;
    var found={};
    _dmg.passes.forEach(function(p){
      if(name==null){ for(var k in p.params) found[k]=p.params[k]; return; }
      if(name in p.params){ if(value!=null) p.params[name]=value; found[name]=p.params[name]; }
    });
    return found;
  };
  // shift+D cycles nes -> dmg -> mix -> crt -> off while looking at it
  window.addEventListener('keydown', function(e){
    if(e.key!=='D'||!e.shiftKey||e.metaKey||e.ctrlKey||e.altKey) return;
    var t=e.target&&e.target.tagName; if(t==='INPUT'||t==='TEXTAREA') return;
    var cur = _screenMix ? 'mix' : _screenMode;
    window.__rrrScreenMode(cur==='nes'?'dmg':cur==='dmg'?'mix':cur==='mix'?'crt':cur==='crt'?'off':'nes');
  });
}
_scheduleFrameLoop();
if(_screenMode!=='crt') setTimeout(_applyScreenMode, 0);
function _applyWallpaperPerformance(state){
  if(!_WALLPAPER_MODE || !state) return;
  var wasPaused=_wallpaperPerformancePaused, wasStopped=wasPaused||_wallpaperMotionFrozen;
  _wallpaperPerformancePaused=!!state.paused;
  _wallpaperMotionFrozen=!!state.frozen;
  var stopped=_wallpaperPerformancePaused||_wallpaperMotionFrozen;
  var cap=Number(state.fpsCap);
  if(isFinite(cap) && cap>0) _wallpaperFpsCap=Math.max(1,Math.min(60,cap));
  window.__rrrWallpaperPerformance={paused:_wallpaperPerformancePaused,frozen:_wallpaperMotionFrozen,fpsCap:_wallpaperFpsCap,reason:String(state.reason||'')};
  if(document.documentElement){
    document.documentElement.dataset.rrrWallpaperPaused=_wallpaperPerformancePaused?'1':'0';
    document.documentElement.dataset.rrrWallpaperFrozen=_wallpaperMotionFrozen?'1':'0';
    document.documentElement.dataset.rrrWallpaperFps=String(_wallpaperFpsCap);
    document.documentElement.dataset.rrrWallpaperReason=String(state.reason||'');
  }
  if(stopped){
    _stopFrameLoop();
  } else {
    lastFrame=_nowMs();
    _scheduleFrameLoop();
  }
  // A power/occlusion pause suspends DSP. A deliberate visual freeze only holds the canvas while
  // the radio keeps playing, so switching between those states must update audio independently.
  if(_wallpaperPerformancePaused && !wasPaused){
    if(_WALLPAPER_AUDIO){ try{ if(Audio&&Audio.setPlaying) Audio.setPlaying(false); }catch(e){} }
  } else if(wasPaused && !_wallpaperPerformancePaused){
    if(_WALLPAPER_AUDIO){ try{ if(Audio&&Audio.setPlaying) Audio.setPlaying(true); }catch(e){} }
    try{ if(Audio&&Audio.resume) Audio.resume(false); }catch(e){}
  }
  if(wasStopped && !stopped){
    lastFrame=_nowMs();
    // Do not replay a freeze's accumulated visual events in one burst. Resume from the live music
    // position and rebuild the game scene on the next frame, matching long background wake-up.
    try{ if(Audio&&Audio.consumeEvents) Audio.consumeEvents(); }catch(e){}
    if(sceneKind==='game' && selGame && selState) _reseatScene=true;
  }
}
if(_WALLPAPER_MODE && window.RRRNative && window.RRRNative.onWallpaperPerformance){
  try{ window.RRRNative.onWallpaperPerformance(_applyWallpaperPerformance); }catch(e){}
}
// Off-screen capture host (the YouTube video leg, broadcast/video.js) caps the render FPS so a
// GPU-less broadcast box spends its cycles on audio scheduling, not on a 60fps game raster that
// nobody is watching locally. Ungated by wallpaper mode on purpose: it drives _frameTarget directly
// (see frame(), line ~594). 0 clears the cap. Returns the effective cap.
if(typeof window!=='undefined'){
  window.__rrrSetRenderFpsCap = function(fps){
    var c = Number(fps);
    if(c === 0){ _wallpaperFpsCap = 0; }
    else if(isFinite(c) && c > 0){ _wallpaperFpsCap = Math.max(1, Math.min(60, c)); }
    return _wallpaperFpsCap;
  };
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

// ---------- INPUT: watch-only — nobody controls the characters ----------
// Chiptunes is a music generator + wallpaper: the games ALWAYS play themselves (autopilot).
// Pointer gestures remain for the app (double-tap heart, swipe/wheel skip, particle bursts) and
// Space/J/K/G/Escape remain as player/app shortcuts — but no input ever reaches a game character.
// A directional keypress just explains that via a toast (throttled).
const INP = { x:0.5, y:0.5, down:false, clickPulse:false, keys:Object.create(null), lastActive:-1e9 };
const KEYMAP = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down',
  KeyA:'left', KeyD:'right', KeyW:'up', KeyS:'down' };
let _watchToastUntil=0;
function watchOnlyToast(){
  // Only while actually watching a game — never over the home overlay.
  var introEl=document.getElementById('intro');
  if(introEl && !introEl.classList.contains('hidden')) return;
  // ...and never before there IS a radio. On a cold load nothing is playing and
  // the moods are the only thing on the page: telling somebody to just listen,
  // over the buttons that would give them something to listen to, is answering
  // a question they have not asked yet with an instruction they cannot follow.
  try{ if(Audio.isHolding && Audio.isHolding()) return; }catch(e){}
  if(document.body && document.body.classList.contains('awaiting-mood')) return;
  var now=performance.now();
  var showing = now < _watchToastUntil;
  // First key/click shows it ~2.6s; each further key or click WHILE it's up keeps it on longer (capped ~6.5s).
  var dur = showing ? Math.min((_watchToastUntil-now)+1100, 6500) : 2600;
  _watchToastUntil = now + dur;
  if(typeof _toast==='function') _toast('This is a background radio. The games play themselves, like a screensaver. Just listen \ud83c\udfa7', { big:true, ms:dur });
}
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
  // the Create editor owns the transport keys while it is open (its own
  // capture-phase handler runs Space); swallow here so the radio never reacts
  try{ if(typeof CT_CREATE!=='undefined' && CT_CREATE.isOpen()){ return true; } }catch(e){}
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
function handleEscapeShortcut(ev){
  if(!ev || ev.key!=='Escape' || shortcutTargetBlocked(ev) || ev.metaKey || ev.altKey || ev.ctrlKey) return false;
  if(typeof CT_CREATE!=='undefined' && CT_CREATE.isOpen()){
    // the editor's own panels close first; Escape only leaves once nothing is open
    if(CT_CREATE.escape && CT_CREATE.escape()){ consumeKeyEvent(ev); return true; }
    CT_CREATE.close(); consumeKeyEvent(ev); return true; }
  var hm=document.getElementById('howmodal');
  if(hm && hm.classList.contains('show')){ hm.classList.remove('show'); consumeKeyEvent(ev); return true; }
  if(panelVisible('trackpanel') && window.closeTrackPanel){ window.closeTrackPanel(); consumeKeyEvent(ev); return true; }
  if(panelVisible('mixpanel') && window.closeMixPanel){ window.closeMixPanel(); consumeKeyEvent(ev); return true; }
  if(gamePickerVisible()){ closeGamePicker(); consumeKeyEvent(ev); return true; }
  if(_welcomeModalVisible()){ closeWelcomeModal(); consumeKeyEvent(ev); return true; }
  // Escape CLOSES things. It used to fall through to toggleWelcomeModal, so
  // pressing it with nothing open summoned the home page over the game -- the
  // one screen the station no longer has a way to reach on purpose.
  return false;
}
// position ONLY — moving the mouse must NOT take over gameplay or the music (no engage here).
function setPos(cx,cy){ INP.x=Math.max(0,Math.min(1,cx/W)); INP.y=Math.max(0,Math.min(1,cy/H)); }
// engage(): legacy timestamp for gesture bookkeeping — games never see input (buildIN is inert).
function engage(){ INP.lastActive=performance.now(); }
// per-frame input view handed to a converted game's frame(). WATCH-ONLY: this is intentionally
// INERT — neutral position, no keys, never active — so every game runs pure autopilot forever.
// All 16 packs read input only through here, so this one choke point removes character control.
const _INERT_KEYS = Object.freeze(Object.create(null));
function buildIN(A){
  const cx=A.x+A.w/2, cy=A.y+A.h/2;
  return { x:0.5, y:0.5, ax:cx, ay:cy, lx:cx, ly:cy,
    down:false, click:false, keys:_INERT_KEYS, active:false };
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
    watchOnlyToast();   // clicking the game (not a control) = same "just watch" hint as a keypress
    return;
  }
  const pausedGesture = _transportUserPaused();
  if(!pausedGesture){ startAudio(true); Audio.resume(true); unlockAudioSession(); }
  if(pausedGesture){ INP.down=false; INP.clickPulse=false; return; }
  _gest.x0=e.clientX; _gest.y0=e.clientY; _gest.swiping=false; _gest.committed=false; _gest.dy=0;
  INP.down=true; INP.clickPulse=true; setPos(e.clientX,e.clientY); engage();
  spawnBurst(e.clientX, e.clientY, 14);                 // click = visible particle burst
  shake = Math.min(1, shake + 0.7);                     // click also shakes the screen (like the beat hits)
  watchOnlyToast();                                     // clicking the game (not a control) = same "just watch" hint as a keypress
});   // click = particles/shake only — games stay on autopilot (watch-only)
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
  watchOnlyToast();   // nobody controls the characters — explain instead of steering
});
window.addEventListener('keyup', e=>{ const act=KEYMAP[e.code]; if(act) delete INP.keys[act]; });

/* ============================================================
   UI / startup
   ============================================================ */
const intro = document.getElementById('intro');
const hud = document.getElementById('hud');
const presetsBar = document.getElementById('presets');
const trackEl = document.getElementById('trackname');
const transportEl = document.getElementById('transport');
let bootDone = false;

// ===== 8-bit Dungeon heart (shared icon) + TikTok-style flying-heart animation =====
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
  return (typeof Song!=='undefined'&&Song.title) ? Song.title(body) : String(body||'').split('-').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ') || 'Chiptunes.app'; }

// One seed produces one song. The player never generates candidates or asks a
// taste/novelty model to choose which composition deserves to be heard.
function _mintToken(){
  return (typeof Song!=='undefined'&&Song.mint) ? Song.mint() : ('mix-'+(Date.now()>>>0).toString(36));
}
function _noteGeneratedPlaying(tok){
  try{if(typeof Radio!=='undefined'&&Radio.setCurrent)Radio.setCurrent({token:tok});}catch(e){}
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
let _curSlug='', _curName='Chiptunes.app', _nowSource='generated';
function _setGeneratedNowPlaying(slug){
  _nowSource='generated';
  var changed = !!slug && slug !== _curSlug;
  _curSlug = slug || _curSlug;
  // a shared document has no token to read a name off; it brought its own
  var shared=''; try{ shared=(Audio.sharedTitle && Audio.sharedTitle()) || ''; }catch(e){}
  _curName = (!slug && shared) ? shared : _deslug(_curSlug);
  _refreshShareLink();
  // A fresh toss per track when the screen is on 'mix' -- skipping re-rolls it
  // even when the same game comes back up.
  if(changed){
    _pickNesScheme(_curSlug);
    if(typeof _rollScreenMode==='function') _rollScreenMode();
  }
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
  // a rail pill like everything else: the icon alone made the one control in
  // the top-right read as a different kind of thing from the five on the left
  b.innerHTML = '<span class="plink-ic">' + svgIcon('fullscreen') + '</span>' +
                '<span class="plink-t">' + (on ? 'Exit full screen' : 'Full screen') + '</span>';
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
// Icons used by controls built during buildRadioUI(). They live HERE, above
// that function AND above the call to it further down, because `var` hoists
// the declaration and not the value: assigned any later in the module and the
// buttons render the string "undefined". Moving them merely above the
// function that uses them was not enough -- the call site is what matters.
var _IC_TV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="6.5" width="19" height="13" rx="2"/><path d="M8 3.5 12 6.5 16 3.5" stroke-linecap="round"/></svg>';
// A cartridge with a download arrow. Declared HERE, above buildPlaybar, and not
// with the other pill icons near the bottom of the file: `var` hoists the
// declaration but not the value, so the button rendered the string "undefined".
// A cartridge with a download arrow. The ROM export is the most surprising
// thing this project does and it was three levels deep in an overflow menu.
var _IC_ROM='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 3.5h9l5 5V17a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17z"/><path d="M8.5 21.5h7" stroke-linecap="round"/><path d="M12 8v5.5M9.6 11.4 12 13.8l2.4-2.4" stroke-linecap="round"/></svg>';
// Ask the station for a mood and it writes one and puts it on. Same words and
// the same machinery as the editor's row (CT_CREATE.moodSong), because they are
// two views of one thing and "write me a happy song" cannot mean two different
// acts depending on which one you are looking at.
function _moodOnAir(m, btn){
  if(btn) btn.classList.add('busy');
  // the search compiles up to 140 candidates; let the pressed state paint first
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    var doc=null;
    try{ doc=(typeof CT_CREATE!=='undefined' && CT_CREATE.moodSong) ? CT_CREATE.moodSong(m) : null; }catch(e){}
    if(btn) btn.classList.remove('busy');
    if(!doc || !doc.code){ if(window._toast) _toast('Could not write one just then'); return; }
    try{
      window._sharedSongPlaying=true;      // it is yours, not the broadcast's
      _forkFromLive();
      _trkHist=[]; _trkI=0;
      Audio.playDoc(doc.code);
    }catch(e){ if(window._toast) _toast('Could not play it'); return; }
    if(document.body) document.body.classList.remove('awaiting-mood');
    // No toast on success: the music starting IS the confirmation, and the name
    // is already on the playbar. A box announcing what you just asked for is
    // one more thing to read and then wait to go away.
    if(typeof _pokeVisualControls==='function') _pokeVisualControls();
  }); });
}
function buildRadioUI(){
  presetsBar.innerHTML='';
  try{
    var moods=(typeof CT_CREATE!=='undefined' && CT_CREATE.moods) ? CT_CREATE.moods() : [];
    if(moods.length){
      var row=document.createElement('div'); row.id='rmoods';
      // The name and the one line of what this is, in the middle of the page
      // above the choice -- the shape of an ordinary product landing page.
      // Only shown while the station is waiting to be asked; once something is
      // playing the left rail carries them again and this shrinks to a strip.
      var brand=document.createElement('span'); brand.className='rmood-brand';
      var bn=document.createElement('b'); bn.textContent='Chiptunes.app';
      var bs=document.createElement('i');
      bs.textContent='An endless Game Boy radio for your second screen: background music, games that play themselves.';
      brand.appendChild(bn); brand.appendChild(bs);
      row.appendChild(brand);
      // The ask -- the words and the pills -- moves as one piece: it is in the
      // hero while the page is being read, and in the bottom-left corner once
      // the credit takes the middle.
      var ask=document.createElement('div'); ask.className='rmood-ask';
      var lab=document.createElement('span'); lab.className='rmood-lab';
      lab.textContent='Write me a song that is\u2026';
      ask.appendChild(lab);
      var pills=document.createElement('span'); pills.className='rmood-pills';
      ask.appendChild(pills);
      row.appendChild(ask);
      moods.forEach(function(m){
        var b=mkRbtn(m, function(){ _moodOnAir(m, b); });
        b.classList.add('rmood'); b.title='Write a '+m+' song and play it';
        pills.appendChild(b);
      });
      // ...or none of the above: an empty grid and your own hands.
      var scratch=mkRbtn('Start from scratch', function(){
        if(typeof _openCreate==='function') _openCreate(true);
      });
      scratch.classList.add('rmood','rmood-scratch');
      scratch.title='Open the editor with an empty song';
      pills.appendChild(scratch);
      presetsBar.appendChild(row);
    }
  }catch(e){}
  // TEMPO = AUTO toggle + a continuous DJ-deck slider + clickable −/+ clamped to Radio.tempoBounds().
  const tg=document.createElement('div'); tg.id='rtempo'; tg.style.cssText='display:flex;align-items:center;gap:6px;';
  const auto=mkRbtn('auto', ()=>{ Radio.setTempo(null); syncTempoUI(); }); auto.title='Use this track BPM'; auto.style.padding='3px 8px;text-transform:uppercase;';
  const minus=mkRbtn('−', ()=>{ Radio.nudgeTempo(-1); syncTempoUI(); }); minus.id='rtempoMinus'; minus.title='−1 BPM'; minus.style.padding='3px 8px';
  const sl=document.createElement('input'); sl.type='range'; sl.id='rtemposlider'; sl.min=60; sl.max=220; sl.step=1;
  sl.title='BPM: drag to set the tempo'; sl.style.cssText='width:104px;vertical-align:middle;accent-color:#6cf;cursor:pointer;';
  sl.addEventListener('mousedown', function(ev){ ev.stopPropagation(); });
  sl.addEventListener('input', function(ev){ ev.stopPropagation(); Radio.setTempo(+sl.value); syncTempoUI(); });
  const plus=mkRbtn('+', ()=>{ Radio.nudgeTempo(1); syncTempoUI(); }); plus.id='rtempoPlus'; plus.title='+1 BPM'; plus.style.padding='3px 8px';
  const read=document.createElement('span'); read.id='rtemporead'; read.style.cssText='font:15px var(--mono);color:#9cf;min-width:74px;display:inline-block;';
  tg.append(auto, minus, sl, plus, read);
  document.body.appendChild(tg);                              // detached from the top bar — the MIX MENU adopts it (BPM lives in the mix menu now)
  // No hamburger. Everything it held is a button on the left rail now, which is
  // one fewer thing to open before you can do anything.
  var _stale=document.getElementById('rlist'); if(_stale) _stale.remove();
  let fsBtn=document.getElementById('rfullscreen');
  if(!fsBtn){ fsBtn=document.createElement('button'); fsBtn.type='button'; fsBtn.id='rfullscreen';
    fsBtn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); _pokeVisualControls(); _toggleFullscreen(); });
    document.body.appendChild(fsBtn); }
  _updateFullscreenButton();
  // TRACK TITLE (bottom-left) is the "details" affordance now — clicking it expands the full track recipe (YouTube/TikTok-style)
  if(trackEl && !trackEl._wired){ trackEl._wired=true; trackEl.addEventListener('click', ev=>{ ev.stopPropagation(); window.toggleTrackPanel && window.toggleTrackPanel(); }); }
  buildTransport();                                            // hidden compatibility rail; superseded by #playbar
  buildPlaybar();                                              // Roon-style bottom transport bar
  _buildPlayerLinks();                                         // top-right: Watch on YouTube · Add to radio · (Get the app on desktop)
  syncTempoUI();
  Radio.onChange(()=>{ syncRadioUI(); });
}
// PLAYER PLATFORM LINKS (top-right): Watch on YouTube · Add to radio · (Get the app — desktop only;
// no download on mobile since it's the desktop version). Visible in the player on web + mobile; hides on idle.
function _buildPlayerLinks(){
  if(document.getElementById('plinks')) return;
  // The _IC_* icon strings are hoisted `var`s assigned further down the module. buildRadioUI()
  // can run before those assignments execute, so if they're not ready yet, defer one microtask
  // (module init finishes synchronously first) and try again.
  if(typeof _IC_YT==='undefined' || !_IC_YT){ if(typeof queueMicrotask==='function') queueMicrotask(_buildPlayerLinks); else setTimeout(_buildPlayerLinks,0); return; }
  // On mobile these live in the hamburger menu (see openNavMenu) instead of the top-right pills.
  if(_homeIsMobile()) return;
  // THE RAIL. Six things a listener might want to do with the track that is
  // playing, down the left edge, plus the screen switcher -- which is not on the
  // owner's list but had no other way in once the hamburger went, and the two
  // console screens are the point of the project.
  var _os=_homeOS(), _osName=(_os==='win'?'Windows':_os==='linux'?'Linux':_os==='mac'?'Mac':'');
  var items=[
    // The Game Boy leads. It is the most surprising thing here -- this track,
    // as a cartridge, on the hardware -- and the cartridge download belongs
    // directly under the offer to run it rather than beside a WAV.
    // No Create button: the strip of notes along the bottom IS the way in, and
    // it opens the editor on the song you are actually listening to.
    {k:'try',   ic:_IC_GB,    t:'Open this track in a Game Boy emulator, running the cartridge itself', l:'Try on Game Boy emulator'},
    {k:'rom',   ic:_IC_ROM,   t:'Download the .gb cartridge (32 KB, runs on real hardware)', l:'Download as Game Boy ROM'},
    {k:'wav',   ic:_IC_WAVE,  t:'Download this track as an uncompressed WAV', l:'Download WAV'},
    // The YouTube Live link is retired for now (owner 2026-08-26): the video
    // leg is off and the box is being freed for other work. The channel, its
    // tokens and the go-live tooling all remain for when it returns.
    {k:'radio', ic:_IC_RADIO, t:'Listen on any radio app', l:'Web radio'}
    // The desktop app is not a thing you do with THIS track, which is what the
    // rail is for. It is its own offer, so it gets the card it had on the home
    // page, down in the corner above the track name. See _buildDesktopCard.
  ];   // no GitHub row: the credit below carries it, with the other two
  // X's mark, drawn rather than fetched: nothing here loads a third-party asset
  // Hacker News: the Y, drawn as strokes rather than the orange box, so it sits
  // in the same round button as the other two and takes currentColor with them
  var _IC_HN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '+
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M7 5l5 7 5-7"/><path d="M12 12v7"/></svg>';
  var _IC_X='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'+
    '<path d="M17.53 3h3.02l-6.6 7.54L21.75 21h-5.9l-4.62-6.04L5.94 21H2.91l7.06-8.07L2.5 3h6.05l4.18 5.52L17.53 3zm-1.06 16.17h1.67L7.6 4.73H5.81l10.66 14.44z"/></svg>';
  // the same pill as every other offer in the rail -- icon, then label
  function _madeLink(href, ic, label, tip){
    return '<a class="plink plmade-btn" href="'+href+'" target="_blank" rel="noopener" title="'+tip+'">'+
      '<span class="plink-ic">'+ic+'</span><span class="plink-t">'+label+'</span></a>';
  }
  var madeBy='<span class="plmade-t">An AI product experiment by Shokunin</span>'+
    '<div class="plmade-row">'+
      _madeLink('https://github.com/tetrisgm', _IC_GH, 'GitHub', 'tetrisgm on GitHub')+
      _madeLink('https://twitter.com/tetrisgm', _IC_X, 'Twitter', 'tetrisgm on X')+
      _madeLink('https://news.ycombinator.com/user?id=tetrisgm', _IC_HN, 'Hacker News', 'tetrisgm on Hacker News')+
    '</div>';
  // the credit is not something you DO with the track, so it is not a rail row:
  // its own corner of the picture, bottom-left, above the player bar
  var made=document.getElementById('madeby');
  if(!made){ made=document.createElement('div'); made.id='madeby'; document.body.appendChild(made); }
  var wrap=document.createElement('div'); wrap.id='plinks';
  // THE MASTHEAD. The rail's first row offers you a Game Boy, which only reads
  // as an offer once you know what the page is -- and with the home page gone
  // there is nowhere else left that says so. Name, then one line of what it does.
  var head='<div class="plhead"><b>Chiptunes.app</b>'+
    '<span>An endless Game Boy radio for your second screen: background music, games that play themselves.</span>'+
    '<button type="button" class="plink plhow" data-k="how" title="What this is and how it works">'+
    '<span class="plink-ic">'+_IC_INFO+'</span><span class="plink-t">How it works</span></button></div>';
  wrap.innerHTML=head+items.map(function(it){
    var extra='';
    if(it.subs) extra=it.subs.map(function(sb){
      return '<button class="plink'+(sb.needs?' plneeds-'+sb.needs:'')+'" type="button" data-k="'+sb.k+'" title="'+sb.t+'" aria-label="'+sb.t+'">'+
        '<span class="plink-ic">'+sb.ic+'</span><span class="plink-t">'+sb.l+'</span></button>';
    }).join('');
    return '<div class="plrow">'+
      '<button class="plink" type="button" data-k="'+it.k+'" title="'+it.t+'" aria-label="'+it.t+'">'+
      '<span class="plink-ic">'+it.ic+'</span><span class="plink-t">'+it.l+'</span></button>'+extra+'</div>';
  }).join('');
  made.innerHTML=madeBy;
  wrap.addEventListener('click', function(ev){ var b=ev.target.closest('.plink'); if(!b) return; ev.preventDefault(); ev.stopPropagation();
    if(typeof _pokeVisualControls==='function') _pokeVisualControls();
    var k=b.dataset.k;
    if(k==='yt') window.open(YT_HANDLE+'/live','_blank','noopener');
    else if(k==='gh') window.open(GITHUB_URL,'_blank','noopener');
    else if(k==='radio'){ try{ if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(RADIO_STREAM_URL); }catch(e){} if(window._toast) _toast('Radio stream URL copied. Paste it into any radio app 👾'); }
    else if(k==='rom'){ _downloadRom(); }
    else if(k==='wav'){ _downloadAudio('wav'); }
    else if(k==='try'){ _toggleGameBoyEmulator(); }
    else if(k==='how'){ _toggleHowModal(); }
    else if(k==='create'){ _openCreate(); }
    else if(k==='screen'){ _toggleGameBoyScreen(); }
    else if(k==='dl-mac'){ _startDownload(DL_MAC); }
    else if(k==='dl-win'){ _startDownload(DL_WIN); }
    else if(k==='dl-linux'){ _startDownload(DL_LINUX); }
  });
  document.body.appendChild(wrap);
  _buildDesktopCard(_os, _osName);
  _syncGameBoyPill(); _syncTryPill();
  _syncGameBoyPill();
}
// THE DESKTOP CARD, back from the home page that no longer exists. It was a row
// in the rail for a while, which put "install an application" next to five
// things that act on the track you are hearing -- a different kind of offer
// wearing the same clothes. The card says what the app is before it asks.
// CREATE: the Mario-Paint-spirit editor (src/create.js). Entering hands the
// chip to the user's song; leaving hands it back to the radio.
var _createStandalone=false;      // true when /create booted without the radio behind it
function _openCreate(blank){
  if(typeof CT_CREATE==='undefined') return;
  if(document.body) document.body.classList.add('ai-visual');
  if(_createStandalone){
    if(typeof _stopHomeBackdrop==='function') _stopHomeBackdrop();
    if(typeof hideHome==='function') hideHome();
  }
  // NOT enterCreate() here. That posts {type:'stop'} to the worklet, so merely
  // OPENING the editor killed the chip dead -- before the editor had decided
  // whether it wanted it. Since the station is already playing this document,
  // opening the notes view usually needs to take nothing at all. The editor
  // calls enterCreate itself at the moment it actually takes the chip.
  window._closeCreateReturn=function(){
    if(_createStandalone){                       // the station has not played yet: start it now
      _createStandalone=false;
      try{ _startEndlessRadio(); }catch(e){}
      // ...and take the chip back off the editor. This branch returned before
      // the playScore() below, so closing a cold-booted /create left the
      // worklet holding the editor's song and the station came back SILENT --
      // pause and play could not rescue it, because neither reposts a score.
      try{ if(typeof Audio!=='undefined'&&Audio.playScore) Audio.playScore(); }catch(e){}
      try{ _syncBackgroundAudioOnly(); }catch(e){}
      return;
    }
    try{ if(typeof Audio!=='undefined'&&Audio.playScore) Audio.playScore(); }catch(e){}
    // The frame loop parked itself while the editor was open (audio-only mode); nothing
    // else recalls the sync on close, and the game restarts live rather than mid-stumble.
    if(sceneKind==='game' && selGame && selState) _reseatScene=true;
    try{ _syncBackgroundAudioOnly(); }catch(e){}
  };
  // CLOSING A VIEW IS NOT A HANDOVER. When the editor never took the chip --
  // it was showing the song the station was already playing -- there is nothing
  // to give back, and calling playScore() here would stop and restart music
  // that never stopped. All that is left is bringing the visuals back.
  window._closeCreateView=function(){
    if(sceneKind==='game' && selGame && selState) _reseatScene=true;
    try{ _syncBackgroundAudioOnly(); }catch(e){}
  };
  // hand the editor the song that is playing, if there is one -- unless the
  // whole point was to start from nothing
  if(blank){ try{ CT_CREATE.openBlank(); }catch(e){ CT_CREATE.open(''); } return; }
  var _doc=null;
  try{ if(typeof Audio!=='undefined'&&Audio.currentDoc) _doc=Audio.currentDoc(); }catch(e){}
  CT_CREATE.open(_doc||undefined);
}
window._openCreate=_openCreate;

// HOW IT WORKS. The page's one paragraph of copy earns a visitor's first ten
// seconds; this modal is for the visitor who gives it a minute. Same story as
// the README, condensed.
function _toggleHowModal(){
  var el=document.getElementById('howmodal');
  if(el){ el.classList.toggle('show'); return; }
  el=document.createElement('div'); el.id='howmodal';
  el.innerHTML='<div class="hm-card">'+
    '<button type="button" class="hm-close" aria-label="Close">\u00d7</button>'+
    '<h2>How this works</h2>'+
    '<p class="hm-lede">An endless Game Boy radio for your second screen. '+
    'Press play, leave it in the background, and get on with your day.</p>'+
    '<ul class="hm-list">'+
    '<li><b>Every song is written live, in your browser.</b> No server and no '+
    'playlist: a deterministic composer generates each track from the URL, so '+
    'a link plays the same song forever.</li>'+
    '<li><b>The sound chip is real.</b> A register-level emulation of the '+
    'Game Boy APU, hardware sweep and vibrato included.</li>'+
    '<li><b>Every song is a cartridge.</b> Download ROM gives you the track '+
    'as a 32 KB .gb file that boots on real hardware, verified to sound '+
    'identical to what you are hearing.</li>'+
    '<li><b>The music is measured.</b> Fourteen styles, with kit bars, bass '+
    'lines and chord movements mined from 74,552 video game MIDI files.</li>'+
    '<li><b>The games play themselves.</b> They react to the beat; they never '+
    'compose.</li>'+
    '<li><b>You can write your own.</b> Create opens a tracker on the same '+
    'chip: four lanes of notes you drag around, every instrument the hardware '+
    'has, movement under each note \u2014 vibrato, duty sweeps, arpeggios, '+
    'pitch slides \u2014 and four-bit sampled drums streamed into the wave '+
    'channel. Tap a mood and the composer writes a whole song for you to '+
    'edit. Share it as a link, a WAV, or a cartridge.</li>'+
    '<li><b>The screens are simulations.</b> Four real shades for the Game '+
    'Boy face; a modulated-and-decoded NTSC signal for the NES one.</li>'+
    '</ul>'+
    '<p class="hm-foot"><a href="'+GITHUB_URL+'" target="_blank" rel="noopener">'+
    'The code is open. Read the full story on GitHub.</a></p>'+
    '</div>';
  el.addEventListener('click', function(ev){
    if(ev.target===el || ev.target.closest('.hm-close')) el.classList.remove('show');
  });
  document.body.appendChild(el);
  requestAnimationFrame(function(){ el.classList.add('show'); });
}
window._toggleHowModal=_toggleHowModal;
function _buildDesktopCard(os, osName){
  if(document.getElementById('dlcard')) return;
  var me=(os==='win'?'win':os==='linux'?'linux':'mac');
  var ALL={mac:['dl-mac','Mac'], win:['dl-win','Windows'], linux:['dl-linux','Linux']};
  var order=[me].concat(['mac','win','linux'].filter(function(k){ return k!==me; }));   // the one you are on leads
  var card=document.createElement('div'); card.id='dlcard';
  card.innerHTML='<div class="dlc-h">On your desktop</div>'+
    '<div class="dlc-d">Use these games as an animated wallpaper.</div>'+
    '<div class="dlc-b">'+order.map(function(k){
      var a=ALL[k];
      return '<button type="button" data-k="'+a[0]+'" title="Download the '+a[1]+' desktop app">'+a[1]+'</button>';
    }).join('')+'</div>';
  card.addEventListener('click', function(ev){
    var b=ev.target.closest('button[data-k]'); if(!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if(typeof _pokeVisualControls==='function') _pokeVisualControls();
    var k=b.dataset.k;
    if(k==='dl-mac') _startDownload(DL_MAC);
    else if(k==='dl-win') _startDownload(DL_WIN);
    else if(k==='dl-linux') _startDownload(DL_LINUX);
  });
  document.body.appendChild(card);
}
// The three screens, as a thing a visitor can find. This was a two-way toggle
// against the plain view, then a two-way toggle between the consoles -- which
// left the plain view with no way back once it rejoined the rotation. It is a
// CYCLER now, over exactly the faces the toss uses, so every screen the station
// can show is reachable without knowing a URL parameter or a keyboard shortcut.
// FOUR STATES, not three. "Random" is a state you can select and see, not just
// what happens before you touch anything: the station has always re-rolled the
// screen every track, but one press pinned a face and there was no way back to
// it short of reloading. It is first in the cycle and it is the default.
//
// The distinction that matters: the button shows the SELECTED STATE, not the
// face currently on screen. Under Random the face changes every track, and
// relabelling the button "NES" when a skip happened to land there would mean
// the Random state vanished from the interface the moment it did its job.
var _SCREEN_STATES = ['random', 'crt', 'dmg', 'nes'];
var _SCREEN_LABEL = { random:'Random', crt:'CRT', dmg:'Game Boy', nes:'NES' };
var _SCREEN_LONG  = { random:'Random style: a new one each track', crt:'CRT screen',
                      dmg:'Game Boy screen', nes:'NES screen' };
// What is being RENDERED right now.
function _screenFace(){
  var cur=String((typeof window.__rrrScreenMode==='function' && window.__rrrScreenMode())||'');
  return cur.replace(/^mix:/, '');
}
// What the listener CHOSE. Under Random these differ, which is the whole point.
function _screenState(){
  var cur=String((typeof window.__rrrScreenMode==='function' && window.__rrrScreenMode())||'');
  return cur.indexOf('mix')===0 ? 'random' : cur;
}
function _toggleGameBoyScreen(){
  if(typeof window.__rrrScreenMode!=='function') return;
  var at=_SCREEN_STATES.indexOf(_screenState());
  // 'off' (shift+D only) is not in the cycle, so an unknown state lands on
  // Random rather than nowhere.
  var next=_SCREEN_STATES[(at+1) % _SCREEN_STATES.length];
  window.__rrrScreenMode(next==='random' ? 'mix' : next);
  _syncGameBoyPill();
  if(window._toast) _toast(_SCREEN_LONG[next]||next);
}
function _syncGameBoyPill(){
  try{
    var b=document.getElementById('pbScreen');
    if(!b) return;
    var st=_screenState(), face=_screenFace();
    var t=b.querySelector('.pbs-t');
    if(t) t.textContent='Display: '+(_SCREEN_LABEL[st]||'CRT');
    // Lit for anything other than the plain view. Under Random it stays lit
    // rather than blinking off on the tracks that roll a CRT -- it is reporting
    // the choice, not the roll.
    b.classList.toggle('on', st!=='crt');
    var showing=(face==='dmg'?'Game Boy':face==='nes'?'NES':'CRT');
    b.title = st==='random'
      ? ('Random style, showing '+showing+'. Click to pin CRT.')
      : ('Screen: '+showing+'. Click to switch.');
  }catch(e){}
}
window._syncGameBoyPill=_syncGameBoyPill;

// MOBILE NAV MENU — on phones the platform links live in a normal hamburger menu (a column of big link
// rows) instead of the top-right pills. Opened by the top-left menu button; click the backdrop or a row
// to close. Desktop keeps the pills + the hamburger-as-home behaviour.
var _navMenuEl=null;
var _NAV_HOME_IC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>';
var _NAV_LINK_IC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M14.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6"/></svg>';
function _navRow(k,ic,l,s){
  return '<button type="button" class="navitem" data-nav="'+k+'"><span class="navitem-ic">'+ic+'</span>'+
    '<span class="navitem-txt"><span class="navitem-l">'+_homeEsc(l)+'</span><span class="navitem-s">'+_homeEsc(s)+'</span></span>'+
    '<span class="navitem-chev" aria-hidden="true">›</span></button>';
}
function _ensureNavMenu(){
  if(_navMenuEl) return _navMenuEl;
  _navMenuEl=document.createElement('div'); _navMenuEl.id='navmenu'; document.body.appendChild(_navMenuEl);
  _navMenuEl.addEventListener('click', function(ev){
    var row=ev.target.closest('[data-nav]');
    if(!row){ if(ev.target===_navMenuEl || ev.target.closest('[data-nav-close]')) closeNavMenu(); return; }   // backdrop / × closes
    ev.preventDefault(); ev.stopPropagation();
    var k=row.dataset.nav; closeNavMenu();
    if(k==='gb'){ _toggleGameBoyScreen(); }
    else if(k==='rom'){ _downloadRom(); }
    else if(k==='home'){ if(window.openProductHome) openProductHome(); }
    else if(k==='how'){ _toggleHowModal(); }
    else if(k==='yt'){ window.open(YT_HANDLE+'/live','_blank','noopener'); }
    else if(k==='radio-open'){ _openRadioInApp(); }
    else if(k==='radio-listen'){ window.open(RADIO_STREAM_URL,'_blank','noopener'); }
    else if(k==='radio-copy'){ try{ if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(RADIO_STREAM_URL); }catch(e){} if(window._toast) _toast('Radio stream URL copied. Paste it into any radio app 👾'); }
  });
  document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') closeNavMenu(); });
  window.addEventListener('resize', function(){ if(!_homeIsMobile()) closeNavMenu(); });
  return _navMenuEl;
}
function navMenuVisible(){ return !!(_navMenuEl && _navMenuEl.classList.contains('show')); }
function openNavMenu(){
  var el=_ensureNavMenu();
  el.innerHTML='<div class="navmenu-panel" role="menu">'+
    '<div class="navmenu-head"><span class="navmenu-title">Chiptunes.app</span>'+
    '<button type="button" class="navmenu-close" data-nav-close aria-label="Close menu">×</button></div>'+
    // The screen is a preference, so it lives here rather than on a pill over
    // the game. The row names the face you are ON -- with three of them, a
    // control that advertises only the next one tells you nothing about the
    // one you are looking at.
    _navRow('gb',_IC_GB,_SCREEN_LABEL[_screenState()]||'Screen','Switch: Random, CRT, Game Boy, NES')+
    // On mobile the pills are hidden, so the cartridge export needs a way in here.
    _navRow('rom',_IC_ROM,'Download .gb ROM','This track as a 32 KB cartridge')+

    _navRow('radio-open',_IC_RADIO,'Add to your radio app','Open it in a radio app')+
    _navRow('radio-copy',_NAV_LINK_IC,'Copy stream URL','radio.chiptunes.app')+
    // The old 'Home' row led to a landing page that no longer exists as a
    // landing page. Same destination, named for what is actually there: the
    // desktop app and the wallpaper. On mobile the pills are hidden, so without
    // this row /get has no way in at all.
    _navRow('how',_IC_INFO,'How it works','What this is, in a minute')+
    _navRow('home',_IC_MON,'Get the desktop app','Mac, Windows or Linux, plus the wallpaper')+
    '</div>';
  el.classList.add('show');
}
function closeNavMenu(){ if(_navMenuEl) _navMenuEl.classList.remove('show'); }
window.toggleNavMenu=function(){ if(navMenuVisible()) closeNavMenu(); else openNavMenu(); };
window.closeNavMenu=closeNavMenu;
// BOTTOM-RIGHT vertical action rail (TikTok-style): ❤ heart · ⤴ share · ⏭ skip.
// (Dislike moved INTO the track-details panel; track details = bottom-left title click; mixer/tempo = bottom-right volume control.)
function buildTransport(){
  if(!transportEl) return;
  transportEl.innerHTML='';
  const shareBtn=mkRbtn('', b=>{ shareTrackLink(b); }); shareBtn.id='rshare'; shareBtn.classList.add('share'); shareBtn.title='Copy link to this track'; shareBtn.innerHTML=svgIcon('share');   // TikTok-style: copy the song's URL
  const skipBtn=mkRbtn('', ()=>_transportNext()); skipBtn.id='rskip'; skipBtn.title='Skip (swipe up)'; skipBtn.innerHTML=svgIcon('skip');
  transportEl.append(shareBtn, skipBtn);
  // DESKTOP: a TikTok-style prev/next pair vertically centred on the right edge (the rail's skip is hidden there via CSS).
  if(!document.getElementById('radionav')){
    const nav=document.createElement('div'); nav.id='radionav';
    const prevB=mkRbtn('', ()=>_transportPrev()); prevB.id='rprev'; prevB.title='Previous (swipe down)'; prevB.innerHTML=svgIcon('chevUp');
    const nextB=mkRbtn('', ()=>_transportNext()); nextB.id='rnext'; nextB.title='Next (swipe up)'; nextB.innerHTML=svgIcon('chevDown');
    nav.append(prevB, nextB); document.body.appendChild(nav);
  }
}
// TikTok-style SHARE: copy the current track's URL (= chiptunes.app/<slug>) to the clipboard, flash the button to a
// check + show a brief toast. Falls back to a hidden textarea + execCommand when the async clipboard API is unavailable.
function _toast(msg, opts){ opts=opts||{}; var t=document.getElementById('rtoast'); if(!t){ t=document.createElement('div'); t.id='rtoast'; document.body.appendChild(t); }
  t.textContent=msg; t.classList.toggle('big', !!opts.big); t.classList.add('show'); clearTimeout(_toast._t);
  _toast._t=setTimeout(function(){ t.classList.remove('show'); }, opts.ms||1500); }
// SHARING A SONG MEANS SHARING THE SONG.
//
// It used to copy location.href, which worked only because the generated name
// was in the path and the name was the seed. Both of those are gone: a name is
// a label now, and once a note has been moved no seed reproduces the song at
// all. So the link carries the DOCUMENT -- the same one the editor opens and
// the chip plays -- and it carries it the same way whether the song came off
// the station or out of Create. One format, one path, no invisible switch
// between a short link and a long one depending on whether you touched a note.
//
// It rides in the FRAGMENT, which no browser sends to a server: no request
// limit, no edge configuration, nothing to store and nothing to moderate.
// Documents run 4-14 KB and deflate takes about 70% off, so a shared song is
// 1.5-4 KB of URL. Long, but it works everywhere and it cannot rot.
function _b64u(bytes){ var s=''; for(var i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function _unb64u(str){ var t=String(str).replace(/-/g,'+').replace(/_/g,'/');
  while(t.length%4) t+='=';
  var b=atob(t), out=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++) out[i]=b.charCodeAt(i); return out; }
function _packDoc(code){                       // -> Promise<string>, 'z'=deflated 'r'=raw
  if(typeof CompressionStream==='undefined') return Promise.resolve('r'+code);
  try{
    var cs=new CompressionStream('deflate-raw'), w=cs.writable.getWriter();
    w.write(new TextEncoder().encode(code)); w.close();
    return new Response(cs.readable).arrayBuffer().then(function(buf){
      return 'z'+_b64u(new Uint8Array(buf)); }, function(){ return 'r'+code; });
  }catch(e){ return Promise.resolve('r'+code); }
}
function _unpackDoc(str){                      // -> Promise<string|null>
  if(!str) return Promise.resolve(null);
  var c=str.charAt(0);
  if(c==='r') return Promise.resolve(str.slice(1));
  if(c!=='z') return Promise.resolve(str);     // a bare document: /create#s= wrote these
  if(typeof DecompressionStream==='undefined') return Promise.resolve(null);
  try{
    var ds=new DecompressionStream('deflate-raw'), w=ds.writable.getWriter();
    w.write(_unb64u(str.slice(1))); w.close();
    return new Response(ds.readable).arrayBuffer().then(function(buf){
      return new TextDecoder().decode(new Uint8Array(buf)); }, function(){ return null; });
  }catch(e){ return Promise.resolve(null); }
}
// Packed ahead of the click: Safari will not accept a clipboard write that
// happens after an await, so the link has to be ready before the button is hit.
var _shareDoc='', _shareUrl='';
function _refreshShareLink(){
  var doc=''; try{ doc=(Audio.currentDoc && Audio.currentDoc()) || ''; }catch(e){}
  if(doc===_shareDoc) return;
  _shareDoc=doc; _shareUrl='';
  if(!doc) return;
  _packDoc(doc).then(function(packed){
    if(_shareDoc===doc) _shareUrl=location.origin+'/#s='+packed; });
}
window._refreshShareLink=_refreshShareLink;
window._packDoc=_packDoc;   // Create shares by the same route
function _shareLinkNow(){
  if(_shareUrl) return _shareUrl;
  var doc=''; try{ doc=(Audio.currentDoc && Audio.currentDoc()) || ''; }catch(e){}
  return doc ? location.origin+'/#s=r'+doc : location.href;   // uncompressed, but correct
}
function shareTrackLink(btn){
  var url=_shareLinkNow();
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
  if(read){ read.textContent = (live!=null || cur!=null) ? (val+' BPM') : '···'; read.title = (cur==null) ? 'Track BPM / AUTO' : 'Manual BPM override'; }
}
function syncRadioUI(){ syncTempoUI(); }
function syncBrowseButton(){ /* the menu button it synced no longer exists */ }
function _welcomeModalVisible(){
  var introEl=document.getElementById('intro');
  return !!(introEl && introEl.style.display!=='none' && !introEl.classList.contains('hidden'));
}
function _welcomeCanDismiss(){
  // The home's own game backdrop (_homeBackdrop) is NOT a dismiss target — clicking empty space on the
  // home must keep the home + its game, not drop into a bare watch state. Only real playback (or a full
  // wallpaper/watch session) can dismiss the home.
  return !!((typeof Audio!=='undefined' && Audio.started) || (typeof _watchOnly!=='undefined' && _watchOnly && !_homeBackdrop));
}
function openWelcomeModal(){
  if(typeof closeMixPanel==='function') closeMixPanel();
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
  // "BYTE MAZE" / "BRICKTAP", not a title-cased id, before the pack loads.
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
  // _ensureGamePackLoaded) and shows hover meanwhile. Without this the picker
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
// that was waiting on its pack to load (hover was standing in for it).
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
// warmed packs and every other game (Blocks, Platformer, CLIMBER, Dungeon, ...) would never
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
var _pbEl=null;
// FIRST LOAD. The game is already on screen and the sound is waiting behind the
// autoplay gate; the gesture that opens it was "click anywhere", which is not
// something a page can say out loud. A play button says it. It respends on
// pointer-DOWN, and materialises rather than fading, so it reads as a real
// surface arriving over the game.
function _buildBigPlay(){
  if(document.getElementById('bigplay')) return;
  var b=document.createElement('button');
  b.id='bigplay'; b.type='button'; b.title='Play'; b.setAttribute('aria-label','Play');
  b.innerHTML=_pbIcon('play')+
    '<span class="bp-cap">An endless Game Boy radio. Press play, put it on your second screen, and get on with your day.</span>';
  b.addEventListener('pointerdown', function(){ b.classList.add('press'); });
  ['pointerup','pointercancel','pointerleave','blur'].forEach(function(t){
    b.addEventListener(t, function(){ b.classList.remove('press'); });
  });
  b.addEventListener('click', function(ev){
    ev.preventDefault(); ev.stopPropagation();
    startAudio(true);
    if(Audio.resume) Audio.resume(true);
    if(typeof unlockAudioSession==='function') unlockAudioSession();
    if(Audio.setPlaying) Audio.setPlaying(true);
    _syncBigPlay();
  });
  document.body.appendChild(b);
  _syncBigPlay();
}
var _bigPlayDone=false;
function _syncBigPlay(){
  var b=document.getElementById('bigplay'); if(!b) return;
  // The gate, not "is anything playing": Audio.started goes true at boot on the
  // player route whether or not the browser will let a sound out. These two are
  // the predicates the transport itself uses to decide it is waiting on a tap.
  var gated=false;
  try{ gated=!!(_transportNeedsResume() || _transportIsGated()); }catch(e){}
  if(!gated && typeof Audio!=='undefined' && Audio.started) _bigPlayDone=true;
  var visual=!!(document.body && document.body.classList.contains('ai-visual'));
  b.classList.toggle('show', visual && gated && !_bigPlayDone);
}
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
    // No overflow button. Everything it held is either a pill over the game now
    // (YouTube, radio, the desktop app, the ROM) or reachable by clicking the
    // track name, which is what people try first anyway.
    '<div class="pb-info" id="pbInfo"><div class="pb-titleline"><span class="pb-np">Now playing</span><div class="pb-title" id="pbTitle">···</div>'+
    '</div><div class="pb-sub" id="pbSub"></div></div></div>'+
    // The screen control sits with the transport: it changes what you are
    // LOOKING at, which belongs beside the controls for what you are hearing
    // rather than in a rail of places to take the track away with you.
    // The screen button sits OUTSIDE the transport group, with a matching
    // spacer opposite it, so the pill stays symmetric about the play button
    // however wide its label gets. See the grid note in shell.html.
    // The screen control sits BESIDE the transport, in its own pill. It used to
    // share one, balanced by an empty spacer the width of its own label so the
    // play button stayed on the centre line -- which bought a fixed centre at
    // the price of a visibly empty half. Two pills keep the centre AND lose the
    // hole: prev/play/next is symmetric and fixed at 142px, so the screen pill
    // hangs off a known edge and its label can be any width it likes.
    // THE TRACK READS UNDER THE TRANSPORT, the way a music player puts its
    // waveform under the scrubber: one group, controls on top, the whole song
    // and where you are in it beneath, elapsed and total either side.
    '<div class="pb-ctrl"><div class="pb-main-ctrl"><button id="pbPrev" title="Previous">'+_pbIcon('prev')+'</button>'+
    '<button class="pb-play" id="pbPlay" title="Play / Pause">'+_pbIcon('pause')+'</button>'+
    '<button id="pbNext" title="Next">'+_pbIcon('next')+'</button></div>'+
    '<div class="pb-scrub"><span class="pb-t" id="pbElapsed">0:00</span>'+
    '<span class="pb-wrap"><canvas id="noteribbon" title="Open these notes in the editor"></canvas>'+
    '<span class="pb-expand">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14l5-5 5 5"/></svg>'+
    'Edit</span></span>'+
    '<span class="pb-t" id="pbTotal">0:00</span></div></div>'+
    // THE RIGHT CLUSTER, the way a desk does it: what you are looking at, how
    // fast it is going, how loud it is -- each with its own slider when the
    // window has room, and the full mixer one press away.
    '<div class="pb-right">'+
      '<div class="pb-screendock"><button id="pbScreen" class="pb-screen" title="Switch screen: CRT, Game Boy, NES">'+_IC_TV+'<span class="pbs-t">Display</span></button></div>'+
      '<div class="pb-dial pb-bpmdial"><span class="pbd-lab">BPM</span>'+
        '<input type="range" id="pbBpm" min="60" max="220" step="1" value="128" title="Tempo">'+
        '<span class="pbd-read" id="pbBpmRead">\u2014</span></div>'+
      '<div class="pb-dial pb-voldial">'+
        '<button id="pbVolume" class="pb-volume" title="Volume, mixer &amp; BPM"><span class="pbv-icon">'+svgIcon('mixer')+'</span></button>'+
        '<input type="range" id="pbVol" min="0" max="150" step="1" value="100" title="Volume">'+
        '<span class="pbd-read" id="pbVolRead">100</span></div>'+
      '<button id="pbAdv" class="pb-adv" type="button" title="Advanced volumes" aria-label="Advanced volumes">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8h14M5 12h14M5 16h14"/><circle cx="9" cy="8" r="1.7" fill="currentColor"/><circle cx="15" cy="12" r="1.7" fill="currentColor"/><circle cx="8" cy="16" r="1.7" fill="currentColor"/></svg>'+
      '</button>'+
    '</div>';
  _buildBigPlay();
  // PULL THE NOTES UP. The strip already IS the editor's grid in miniature, so
  // the gesture that gets you the full one is to open the thing you are looking
  // at -- no separate button to find, and it lands on this song rather than on
  // a new one.
  (function(){
    var cv=document.getElementById('noteribbon');
    if(!cv) return;
    cv.style.pointerEvents='auto';
    cv.addEventListener('click', function(ev){
      ev.preventDefault(); ev.stopPropagation();
      if(typeof _pokeVisualControls==='function') _pokeVisualControls();
      // Nothing playing: the strip is an empty box, and an empty box is not a
      // door. "Start from scratch" is on the home for exactly this, and a click
      // that lands here by accident should do nothing at all.
      try{ if(Audio.isHolding && Audio.isHolding()) return; }catch(e){}
      var has=false;
      try{ var s2=Audio.currentScore&&Audio.currentScore(); has=!!(s2&&s2.gb&&s2.gb.notes&&s2.gb.notes.length); }catch(e){}
      if(!has) return;
      if(typeof _openCreate==='function') _openCreate(false);
    });
  })();
  _wirePlaybarButton('pbPrev', _transportPrev);
  _wirePlaybarButton('pbNext', _transportNext);
  _wirePlaybarButton('pbPlay', _transportToggle);
  _wirePlaybarButton('pbScreen', _toggleGameBoyScreen);
  _wirePlaybarButton('pbVolume', function(){ window.toggleMixPanel && window.toggleMixPanel(); });
  _wirePlaybarButton('pbAdv', function(){ window.toggleMixPanel && window.toggleMixPanel(); });
  (function(){
    var vol=document.getElementById('pbVol');
    if(vol) vol.addEventListener('input', function(ev){
      ev.stopPropagation();
      var v=Math.max(0, Math.min(1.5, (+vol.value||0)/100));
      if(window._sessionMixSet) window._sessionMixSet('master', v);
      else if(typeof Audio!=='undefined' && Audio.setMix) Audio.setMix('master', v);
      var r=document.getElementById('pbVolRead'); if(r) r.textContent=String(Math.round(v*100));
      if(typeof _pokeVisualControls==='function') _pokeVisualControls();
    });
    var bpm=document.getElementById('pbBpm');
    if(bpm) bpm.addEventListener('input', function(ev){
      ev.stopPropagation();
      if(typeof Radio!=='undefined' && Radio.setTempo) Radio.setTempo(+bpm.value);
      var r=document.getElementById('pbBpmRead'); if(r) r.textContent=String(bpm.value);
      if(typeof syncTempoUI==='function') syncTempoUI();
      if(typeof _pokeVisualControls==='function') _pokeVisualControls();
    });
    ['pbVol','pbBpm'].forEach(function(id){
      var el=document.getElementById(id);
      if(el) el.addEventListener('pointerdown', function(ev){ ev.stopPropagation(); });
    });
  })();
  var volBtn=document.getElementById('pbVolume');
  if(volBtn && !volBtn._mixHoverWired){ volBtn._mixHoverWired=true;
    volBtn.addEventListener('mouseenter', function(){ if(window.openMixPanel) window.openMixPanel(); });
  }
  // The track title IS the affordance for track details now that the overflow
  // menu is gone, so it opens them whatever the source.
  document.getElementById('pbTitle').onclick=function(ev){ ev.stopPropagation(); if(window.toggleTrackPanel) toggleTrackPanel(); };
  _placeTrackPill();            // adopt the title immediately, not on the first LIVE tick
  buildResumeMusicButton();
}
function _transportIsGated(){ return !!(_nowSource==='generated' && Audio.running && !Audio.running() && !(Audio.isPaused&&Audio.isPaused())); }
function _transportNeedsResume(){ return !!(Audio.started && Audio.running && !Audio.running() && !(Audio.isPaused&&Audio.isPaused())); }
function _transportIsPaused(){ if(_watchOnly && !_watchMicActive) return false;
  // waiting to be asked for a mood is a paused station: nothing is playing, so
  // the button must offer play and the game must not run
  try{ if(Audio.isHolding && Audio.isHolding()) return true; }catch(e){}
  if(Audio.isPaused && Audio.isPaused()) return true; if(_transportIsGated() || _transportNeedsResume()) return true; return !(typeof Radio!=='undefined' && Radio.state ? Radio.state.playing : true); }
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
// HOME BACKDROP: the live game plays BEHIND the home cards. It reuses _watchOnly (wall-clock grid,
// no AudioContext, never "paused") but this flag suppresses all watch/visual CHROME so the home stays
// clean. Cleared the instant the visitor enters a station or full watch mode.
let _homeBackdrop=false;
function _isAiRadioVisual(){
  var introEl=document.getElementById('intro');
  var viewOpen=!!(introEl && introEl.style.display!=='none' && !introEl.classList.contains('hidden'));
  // ONE consistent player state: any time music is playing and the home isn't showing, use the
  // ai-visual chrome (floating centre transport, top-right fullscreen, idle-hide, game stays). No
  // divergent 'dock' layout — the live broadcast used to fall into it because it has no track slug.
  return !!(Audio.started && !viewOpen);
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
      // THREE SECONDS, HELD, then it goes. The fade was tried as the countdown
      // -- start dissolving 350ms after the pointer stops and take three
      // seconds about it -- and it reads as the chrome being yanked away the
      // moment you stop moving, because that is what it is: the thing is
      // already dimming while you are still looking at it. The wait has to be
      // a wait.
    }, 3000);
  }
}
function _syncVisualChrome(){
  if(typeof _syncBigPlay==='function') _syncBigPlay();
  var introEl2=document.getElementById('intro');
  var homeOpen=!!(introEl2 && introEl2.classList.contains('product-home') && introEl2.style.display!=='none' && !introEl2.classList.contains('hidden'));
  // SELF-HEAL the backdrop flags. The home backdrop exists ONLY to render the game behind the HOME, so once the
  // home is closed and real audio is playing it is definitionally over. It used to be torn down only by
  // enterStation() (the click-a-tile path): landing directly on /radio boots, builds the home markup (starting a
  // backdrop before audio exists) and never clears it, so _homeBackdrop/_watchOnly stayed true for the whole
  // session. Because the guard below force-clears `ai-visual` while the backdrop is up, the player was stranded in
  // the bare dock layout — solid bottom bar, no top-right links. Clearing here fixes every entry path at once.
  if(_homeBackdrop && !homeOpen && typeof Audio!=='undefined' && Audio.started){
    _homeBackdrop=false; _watchOnly=false; _watchMicActive=false;
  }
  var on=false; try{ on=_isAiRadioVisual(); }catch(e){}
  if(_homeBackdrop) on=false;                          // the home backdrop shows NO visual/watch chrome
  var watchChrome=_watchOnly && !_homeBackdrop;
  var songOn=false; try{ songOn=!!(Audio.started && !viewOpen && !_watchOnly && _nowSource && _nowSource!=='watch'); }catch(e2){}
  if(document.body) document.body.classList.toggle('home-open', homeOpen);   // on the home the hamburger is pointless (it just reopens the home)
  if(document.body) document.body.classList.toggle('ai-visual', on);
  if(document.body){
    document.body.classList.toggle('song-visual', songOn);
    document.body.classList.toggle('watch-visual', !!watchChrome);
    document.body.classList.toggle('watch-mic-active', !!_watchMicActive);
    document.body.classList.toggle('watch-can-resume', !!(watchChrome && !_watchMicActive && _watchReturnState));
  }
  if(on || watchChrome){
    if(!_wasAiVisual) _setVisualControlsActive(true);
  } else {
    _setVisualControlsActive(false);
  }
  _wasAiVisual=on || watchChrome;
  // The title pill is borrowed by the top-left row in the game view and handed
  // back to the playbar grid otherwise; this is the one place that knows which
  // view is up.
  if(typeof _placeTrackPill==='function') _placeTrackPill();
}
// Start/stop the live game playing behind the home. Reuses the audioless wall-clock renderer.
function _startHomeBackdrop(){
  if(_watchOnly || (typeof Audio!=='undefined' && Audio.started)) return;   // already rendering, or a live player is playing — don't hijack it
  _homeBackdrop=true; _watchOnly=true; _watchMicActive=false; _watchReturnState=null;
  _watchAnchorMs=_nowMs();
  var pref=fixedGamePref();
  if(pref && GAME_BY_KEY[pref]){ randomMode=false; showGame(pref); }
  else { randomMode=true; showGame('random'); }
  if(typeof _scheduleFrameLoop==='function') _scheduleFrameLoop();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
}
function _stopHomeBackdrop(){
  if(!_homeBackdrop) return;
  _homeBackdrop=false; _watchOnly=false; _watchMicActive=false;
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
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
    var slug=_curSlug || (typeof _mintToken==='function' ? _mintToken() : 'chiptunes-app');
    _trkHist=[slug]; _trkI=0; Audio.gotoTrack(slug);
  }
}
function _transportToggle(){
  // Nothing loaded yet: the bar is up from the first paint, so its play button
  // has to mean something. It means "surprise me" -- one of the same moods,
  // which is the only way anything starts now.
  try{
    if(Audio.isHolding && Audio.isHolding()){
      var all=document.querySelectorAll('#rmoods .rmood:not(.rmood-scratch)');
      if(all.length){ all[(Math.random()*all.length)|0].click(); return; }
    }
  }catch(e){}
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
    // Somebody sent you a song. The schedule does not get to seek off the top
    // of it, which is exactly what this did: the shared document played for
    // half a second and the broadcast pulled the station back to its own track.
    if(window._sharedSongPlaying) return;
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
    try{ if(history.replaceState && !window.__RRR_BOOT_PLAYER_ROUTE) history.replaceState(null,'','/'+(typeof _routeQueryExtras==='function'?_routeQueryExtras():'')); }catch(e3){}
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
// so the chosen source stays selected. Idempotent when not live.
function _forkFromLive(){ if(typeof LiveCtl!=='undefined' && LiveCtl.active()) LiveCtl.leave(); }
window._forkFromLive=_forkFromLive;
// Radio.setLive is the single intent switch (setMood/setTempo funnels call it on fork) — mirror it into the engine.
window.onRadioLive=function(on){ if(!on) LiveCtl.stop(); };
// Everything-tile entry while live: same shell as _startEndlessRadio but the schedule supplies the track.
function _startLiveRadio(){
  // Leaving the home backdrop is part of ENTERING playback, not of clicking a tile — see _startEndlessRadio.
  if(typeof _stopHomeBackdrop==='function') _stopHomeBackdrop();
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
// Skip throttle: each skip cold-opens a fresh track, which fades the MASTER gain down and back up over
// ~120ms (Engine.killAll). Spamming Next faster than that keeps cancelling the recovery ramp and can leave
// the mix silent (the music "dies"). Enforce a minimum gap; a skip requested during the cooldown is
// coalesced into ONE trailing skip, so rapid taps still move forward without killing the audio.
let _skipLockUntil=0, _skipTrailDir=0, _skipTrailTimer=null;
function _skipThrottle(dir){
  var now=_nowMs();
  if(now < _skipLockUntil){
    _skipTrailDir=dir;
    if(!_skipTrailTimer) _skipTrailTimer=setTimeout(function(){ _skipTrailTimer=null; var d=_skipTrailDir; _skipTrailDir=0; if(d>0) _transportNext(); else if(d<0) _transportPrev(); }, Math.max(30, _skipLockUntil-_nowMs()+20));
    return false;
  }
  _skipLockUntil=now+200;
  return true;
}
function _transportNext(){
  if(!_skipThrottle(1)) return;
  if(_watchOnly && !_watchMicActive && _nowSource==='watch'){ advanceRandomVisualizer(); return; }   // only cycle the VISUAL in a genuinely silent watch session; if a track is playing (desktop/web), skip the SONG
  if(LiveCtl.active()) LiveCtl.leave();                           // ANY skip = fork off the broadcast to the private queue
  if(_advanceQueue(1)) return;
  if(_nowSource==='generated') _ensureGeneratedTransport();
  if(typeof Radio!=='undefined'&&Radio.next){ Radio.next(); }
}
function _transportPrev(){
  if(!_skipThrottle(-1)) return;
  if(_watchOnly && !_watchMicActive && _nowSource==='watch'){ advanceRandomVisualizer(); return; }   // only cycle the VISUAL in a genuinely silent watch session; if a track is playing (desktop/web), skip the SONG
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
  if(window._toast)_toast(dis?'Not for me. Skipping':'Removed');
  if(dis){ _transportNext(); }   // transport dislike is track-level; album detail dislike remains album-level
  }
// The track as audio, rendered by the same chip that is playing it -- so the
// file is the performance, not a re-synthesis of it.
//
// AAC, not MP3, and not because MP3 was too hard: no browser exposes an MP3
// ENCODER at all (WebCodecs reports codec 'mp3' unsupported everywhere), and
// every JavaScript one is a port of LAME under the LGPL, which is not a thing to
// staple to an MIT single-file artifact for one button. AAC is the same job done
// by the platform itself -- no dependency, no licence, and hardware-backed, so a
// two-minute track encodes in well under a second.
//
// The frames are ADTS, which means each one carries its own header and they
// concatenate into a playable file with no container to write. Verified by
// decoding the result back with decodeAudioData before this shipped. Where
// WebCodecs is missing the fallback is WAV: bigger, but exact and universal.
function _audioFilename(ext){
  // the token is 16 characters of base36 now; a file called that is no use to
  // anybody. Downloads carry the name, which is what the listener saw.
  var n = (_curName && _curName !== 'Chiptunes.app') ? _curName : 'chiptunes';
  return String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') + '.' + ext;
}
function _renderTrackPcm(score, sr){
  return CT_GB_APU.render({notes:score.gb.notes, bank:score.gb.bank, totalFrames:score.gb.totalFrames}, sr);
}
function _pcmToWav(pcm, sr){
  var n=pcm.length, buf=new ArrayBuffer(44+n*2), v=new DataView(buf);
  var wr=function(o,str){ for(var i=0;i<str.length;i++) v.setUint8(o+i, str.charCodeAt(i)); };
  wr(0,'RIFF'); v.setUint32(4, 36+n*2, true); wr(8,'WAVE');
  wr(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  wr(36,'data'); v.setUint32(40,n*2,true);
  for(var i=0;i<n;i++){ var x=Math.max(-1,Math.min(1,pcm[i])); v.setInt16(44+i*2, Math.round(x*32767), true); }
  return new Blob([buf], {type:'audio/wav'});
}
// AAC is the only other format a browser can hand you with no muxer and no
// library: ADTS frames are self-framing, so the encoder's output concatenates
// straight into a playable file. Opus encodes too but needs an Ogg container
// (page headers, granule positions, CRC) and FLAC/Vorbis/PCM are not offered at
// all -- checked against AudioEncoder.isConfigSupported, not assumed.
function _pcmToAac(pcm, sr){
  return new Promise(function(resolve, reject){
    if(typeof AudioEncoder==='undefined' || typeof AudioData==='undefined') return reject(new Error('no encoder'));
    var parts=[], failed=null;
    var enc=new AudioEncoder({
      output:function(chunk){ var b=new Uint8Array(chunk.byteLength); chunk.copyTo(b); parts.push(b); },
      error:function(e){ failed=e; }
    });
    try{
      enc.configure({codec:'mp4a.40.2', sampleRate:sr, numberOfChannels:1, bitrate:128000, aac:{format:'adts'}});
      for(var off=0; off<pcm.length; off+=4096){
        var len=Math.min(4096, pcm.length-off);
        enc.encode(new AudioData({format:'f32-planar', sampleRate:sr, numberOfFrames:len, numberOfChannels:1,
                                  timestamp:Math.round(off/sr*1e6), data:pcm.slice(off, off+len)}));
      }
      enc.flush().then(function(){
        try{ enc.close(); }catch(e){}
        if(failed) return reject(failed);
        var total=0, i; for(i=0;i<parts.length;i++) total+=parts[i].length;
        if(!total) return reject(new Error('encoder produced nothing'));
        var out=new Uint8Array(total), o=0;
        for(i=0;i<parts.length;i++){ out.set(parts[i], o); o+=parts[i].length; }
        resolve(new Blob([out], {type:'audio/aac'}));
      }, reject);
    }catch(e){ reject(e); }
  });
}
function _downloadAudio(fmt){
  fmt=fmt||'wav';
  var score=(Audio.currentScore && Audio.currentScore())||null;
  if(!score || !score.gb){ if(window._toast) _toast('Start a track first'); return; }
  if(typeof CT_GB_APU==='undefined'){ if(window._toast) _toast('Audio export unavailable'); return; }
  if(window._toast) _toast('Rendering the chip...');
  setTimeout(function(){
    var sr=44100, pcm;
    try{ pcm=_renderTrackPcm(score, sr); }
    catch(e){ if(window._toast) _toast('Audio export failed: '+(e&&e.message||e)); return; }
    // Each button names a format and hands you that format -- the extension is
    // never a property of the visitor's browser. A browser that cannot write AAC
    // is not offered the button at all (see the probe in _buildPlayerLinks).
    var mb=function(b){ return (Math.round(b.size/1048576*10)/10)+' MB'; };
    if(fmt==='aac'){
      _pcmToAac(pcm, sr).then(function(blob){
        _saveBlob(blob, _audioFilename('aac'));
        if(window._toast) _toast('Downloaded '+_audioFilename('aac')+' ('+mb(blob)+')');
      }, function(){ if(window._toast) _toast('This browser cannot encode AAC'); });
      return;
    }
    var blob=_pcmToWav(pcm, sr);
    _saveBlob(blob, _audioFilename('wav'));
    if(window._toast) _toast('Downloaded '+_audioFilename('wav')+' ('+mb(blob)+')');
  }, 30);
}
// A real download rather than a page describing one.
function _startDownload(url){
  try{
    var a=document.createElement('a');
    a.href=url; a.rel='noopener'; a.download='';
    document.body.appendChild(a); a.click(); a.remove();
    if(window._toast) _toast('Downloading the desktop app...');
  }catch(e){ window.open(url,'_blank','noopener'); }
}
function _saveBlob(blob, filename){
  var url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}
// TRY IT ON A GAME BOY. Its own screen: the exported cartridge running on the
// emulator, video and all.
//
// The audio comes from the CPU inside the AudioWorklet (src/lib/gb-chip-
// processor.js) because that is where the APU lives; the picture comes from a
// SECOND CPU here on the main thread driving src/gb-ppu.js. Two instances of a
// deterministic program from the same reset stay on the same content -- they can
// drift by a frame or two, which for a level meter nobody can see. Sharing one
// instance would mean shipping VRAM across a MessagePort sixty times a second to
// save an emulator that costs about 2% of a core.
var _gbEmuOn=false, _gbEmu=null;
function _openGameBoy(){
  var score=(Audio.currentScore && Audio.currentScore())||null;
  if(!score || !score.gb){ if(window._toast) _toast('Start a track first'); return; }
  if(typeof CT_GB_ROM==='undefined' || typeof CT_GB_CPU==='undefined' || typeof CT_GB_PPU==='undefined'){
    if(window._toast) _toast('The Game Boy emulator is unavailable'); return; }
  var rom;
  try{ rom=CT_GB_ROM.buildRom(score, { title:(_curName||'chiptunes') }); }
  catch(e){ if(window._toast) _toast('Could not build the cartridge: '+(e&&e.message||e)); return; }

  // playRom TRANSFERS the buffer to the audio thread, so the copy it gets must
  // not be the one this side keeps running.
  if(!Audio.playRom || !Audio.playRom(rom.slice())){ if(window._toast) _toast('The Game Boy chip is not ready yet'); return; }

  var el=_ensureGameBoyScreen();
  el.classList.add('show');
  document.body.classList.add('gb-open');
  _gbEmu={ rom:rom, cpu:new CT_GB_CPU.Cpu(rom, {}), ppu:new CT_GB_PPU.Ppu(),
           cv:el.querySelector('#gbLcd'), img:null, frame:0, raf:0, t0:0 };
  _gbEmu.ctx=_gbEmu.cv.getContext('2d');
  _gbEmu.img=_gbEmu.ctx.createImageData(160,144);
  _gbEmuOn=true; _syncTryPill();
  try{ if(history.pushState) history.pushState({gb:1},'','/gameboy'); }catch(e){}
  _gbEmu.t0=_nowMs();
  _gbTick();
}
function _gbTick(){
  var E=_gbEmu; if(!E) return;
  // Catch the CPU up to wall-clock at the console's own frame rate, capped so a
  // backgrounded tab does not try to execute a minute of machine time at once.
  var want=Math.floor((_nowMs()-E.t0)/1000*59.7275);
  var budget=Math.min(want-E.frame, 8);
  try{
    for(var i=0;i<budget;i++){ var target=E.cpu.frame+1; while(E.cpu.frame<target) E.cpu.step(); E.frame++; }
    if(budget>0){
      E.img.data.set(E.ppu.render(E.cpu.vram, E.cpu.io));
      E.ctx.putImageData(E.img,0,0);
    }
  }catch(e){
    // A crashed cartridge should say so on the screen rather than freeze it.
    _gbFail(e && e.message || String(e)); return;
  }
  E.raf=requestAnimationFrame(_gbTick);
}
function _gbFail(msg){
  var el=document.getElementById('gbscreen');
  if(el){ var n=el.querySelector('#gbErr'); if(n){ n.textContent='The cartridge stopped: '+msg; n.style.display='block'; } }
  if(_gbEmu && _gbEmu.raf) cancelAnimationFrame(_gbEmu.raf);
  if(_gbEmu) _gbEmu.raf=0;
}
function _closeGameBoy(opts){
  opts=opts||{};
  if(_gbEmu && _gbEmu.raf) cancelAnimationFrame(_gbEmu.raf);
  _gbEmu=null; _gbEmuOn=false;
  var el=document.getElementById('gbscreen'); if(el) el.classList.remove('show');
  document.body.classList.remove('gb-open');
  if(Audio.playScore) Audio.playScore();      // back to the composition, where it had got to
  _syncTryPill();
  if(!opts.noRoute){ try{ if(history.pushState) history.pushState({},'','/'); }catch(e){} }
}
function _toggleGameBoyEmulator(){ if(_gbEmuOn) _closeGameBoy(); else _openGameBoy(); }
// A cold load of /gameboy has no track yet: the station has to mint one first.
// Wait for a score rather than telling a visitor who followed the link to go and
// start something.
function _openGameBoyWhenReady(tries){
  tries=tries||0;
  if(_gbEmuOn) return;
  var s=(Audio.currentScore && Audio.currentScore())||null;
  if(s && s.gb && typeof CT_GB_CPU!=='undefined'){ _openGameBoy(); return; }
  if(tries<80) setTimeout(function(){ _openGameBoyWhenReady(tries+1); }, 100);
}
window._closeGameBoy=_closeGameBoy;
window._openGameBoy=_openGameBoy;

// The console itself. Drawn rather than photographed: a DMG's proportions, its
// screen well, and the four shades of its reflector.
function _ensureGameBoyScreen(){
  var el=document.getElementById('gbscreen');
  if(el) return el;
  el=document.createElement('div'); el.id='gbscreen';
  el.innerHTML=
    '<div class="gb-body">'+
      '<div class="gb-well">'+
        '<div class="gb-wellhead"><span class="gb-dot"></span>DOT MATRIX WITH STEREO SOUND</div>'+
        '<canvas id="gbLcd" width="160" height="144"></canvas>'+
        '<div id="gbErr" class="gb-err"></div>'+
      '</div>'+
      '<div class="gb-brand">CHIPTUNES<span>.app</span></div>'+
      '<div class="gb-controls">'+
        '<div class="gb-dpad"><i></i><b></b></div>'+
        '<div class="gb-ab"><span>B</span><span>A</span></div>'+
      '</div>'+
      '<div class="gb-slots"><i></i><i></i><i></i><i></i><i></i><i></i></div>'+
    '</div>'+
    '<div class="gb-side">'+
      '<h2>Running the cartridge</h2>'+
      '<p>This is the exported <code>.gb</code> ROM executing on an emulated '+
      'LR35902: the same 32&nbsp;KB file the button below gives you, and '+
      'the same one that boots on real hardware. The bars are the four sound '+
      'channels: two pulses, the wave channel, and noise.</p>'+
      '<div class="gb-actions">'+
        '<button type="button" class="gb-btn gb-primary" data-gb="rom">Download the .gb ROM</button>'+
        '<button type="button" class="gb-btn" data-gb="close">Back to the station</button>'+
      '</div>'+
    '</div>';
  el.addEventListener('click', function(ev){
    var b=ev.target.closest('[data-gb]');
    if(!b){ if(ev.target===el) _closeGameBoy(); return; }
    ev.preventDefault(); ev.stopPropagation();
    if(b.dataset.gb==='rom') _downloadRom();
    else _closeGameBoy();
  });
  document.addEventListener('keydown', function(ev){ if(ev.key==='Escape' && _gbEmuOn) _closeGameBoy(); });
  document.body.appendChild(el);
  return el;
}
function _syncTryPill(){
  try{
    var b=document.querySelector('#plinks .plink[data-k="try"]');
    if(!b) return;
    b.classList.toggle('on', _gbEmuOn);
    var t=b.querySelector('.plink-t'); if(t) t.textContent=_gbEmuOn?'Leave the Game Boy':'Try on Game Boy emulator';
  }catch(e){}
}
// Build the cartridge for whatever is playing and hand it to the browser. The
// score is already in memory -- the same object the synth is reading -- so this
// is the identical music, not a re-render.
function _downloadRom(){
  try{
    var score = (Audio.currentScore && Audio.currentScore()) || null;
    if(!score || !score.gb){ if(window._toast) _toast('Start a track first'); return; }
    if(typeof CT_GB_ROM==='undefined'){ if(window._toast) _toast('ROM export unavailable'); return; }
    var name = (_curName || 'chiptunes');
    var rom = CT_GB_ROM.buildRom(score, { title: name });
    var blob = new Blob([rom], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name + '.gb';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    if(window._toast) _toast('Downloaded ' + name + '.gb');
  }catch(e){
    if(window._toast) _toast('ROM export failed: ' + (e && e.message ? e.message : e));
  }
}

function _transportDetail(){ if(window.toggleTrackPanel){ toggleTrackPanel(); } }
// The live listener count (aggregated across web + desktop + YouTube + radio by the presence worker)
// lives in a pill top-left, just right of the menu button — not under the track name.
// The LIVE badge and the track title share one flex row to the right of the
// menu button. They cannot simply be positioned against the corner one after
// the other: the badge's width changes with the listener count, so anything
// placed at a fixed offset after it drifts.
//
// The title is #playbar .pb-left, not #trackname -- that one has been
// display:none since the playbar replaced the old caption. .pb-left is a GRID
// CHILD of #playbar in the ordinary bottom-bar view (library, browse), so it is
// only borrowed while the game view owns the screen and is put back after.
function _placeTrackPill(){
  // The name lives in the bottom-left corner in both views now, so there is
  // nothing to borrow it: it stays a child of #playbar and the corner is a
  // position on it. The top-centre row it used to move to is gone.
  var left=document.querySelector('#playbar .pb-left'), bar=document.getElementById('playbar');
  if(!left || !bar) return;
  var stale=document.getElementById('topmid');
  if(stale && stale.parentNode) stale.parentNode.removeChild(stale);
  if(left.parentNode!==bar) bar.insertBefore(left, bar.firstChild);   // grid column 1
}
window._placeTrackPill=_placeTrackPill;
// The LIVE badge. It says "you are hearing the shared broadcast" and carries the
// aggregate listener count -- and until now that was ALL it did: a <div> with no
// handler, so the most prominent thing on the screen was the one thing you could
// not press. It opens the live stream now, which is the only thing anyone could
// reasonably expect a live badge to do.
//
// It is a <button>, not a div with a click handler, so it is focusable and
// reachable from the keyboard like every other control.
function _updateLivePill(liveOn, n){
  // It was a badge in the top-left corner that duplicated a rail button: two
  // controls, both opening the same stream, one of them sitting on the game.
  // What the badge actually contributed was the red dot -- "this is live right
  // now" -- so the dot moved onto the YouTube row and the badge went away.
  var stale=document.getElementById('livepill');
  if(stale && stale.parentNode) stale.parentNode.removeChild(stale);
  var btn=document.querySelector('#plinks .plink[data-k="yt"]');
  if(!btn) return;
  var dot=btn.querySelector('.plink-dot');
  if(!liveOn){
    if(dot && dot.parentNode) dot.parentNode.removeChild(dot);
    btn.classList.remove('live');
    btn.title='Watch the 24/7 stream on YouTube Live';
    btn.setAttribute('aria-label','Watch the 24/7 stream on YouTube Live');
    return;
  }
  if(!dot){ dot=document.createElement('span'); dot.className='plink-dot'; btn.insertBefore(dot, btn.firstChild); }
  btn.classList.add('live');
  var lbl='Watch the live stream on YouTube'+(n!=null && n>0 ? (' ('+n+' listening)') : '');
  btn.title=lbl; btn.setAttribute('aria-label', lbl);
}
function _updatePlaybar(){ if(!_pbEl) buildPlaybar(); if(!_pbEl) return;
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  // The bar is furniture, not a consequence of playback: show it whether or not
  // anything is on, so it does not appear under the visitor the moment they
  // pick a mood. With nothing loaded it is a transport and an empty strip.
  _pbEl.classList.add('show');
  if(!Audio.started){ _listenStatsAt=0; if(typeof _syncVisualChrome==='function') _syncVisualChrome(); return; }
  _listenStatsTick();
  _pbEl.classList.add('show');
  var title=_curName||'···';
  var liveOn=(typeof LiveCtl!=='undefined' && LiveCtl.active());
  var n=(liveOn && typeof window._presenceCount==='number') ? window._presenceCount : null;
  _updateLivePill(liveOn, n);                                   // LIVE + aggregate listener count now lives top-left, by the menu
  var T=document.getElementById('pbTitle'), S=document.getElementById('pbSub'), C=document.getElementById('pbCover');
  if(T) T.textContent=title; if(S){ S.textContent=''; S.classList.remove('link','live'); S.title=''; }
  if(C){ C.classList.remove('has-cover'); C.classList.add('no-cover'); C.innerHTML=''; }
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
  try{
    // Mobile: the generated master is a MediaStream — bind it so THIS element IS the audio output.
    // A playing media element keeps the OS audio session (and the generation feeding it) alive on lock.
    if(!el._boundStream && Audio && Audio.outputStream){
      var st=Audio.outputStream();
      if(st){ el.srcObject=st; el._boundStream=true; try{ el.removeAttribute('src'); el.load(); }catch(e){} }
    }
  }catch(e){}
  var shouldPlay=!!(Audio && Audio.started && !_transportIsPaused() && !(_watchOnly && !_watchMicActive));
  try{
    if(shouldPlay){
      var p=el.play();
      if(p&&p.catch) p.catch(function(){ if(el._boundStream && Audio && Audio.useDestinationOutput) Audio.useDestinationOutput(); });   // element route blocked -> keep foreground sound
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
  s=String(s||'Chiptunes.app'); var h=2166136261>>>0;
  for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  return h>>>0;
}
function _mediaGeneratedArtwork(slug, title){
  var key=String(slug||title||'chiptunes-app');
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
    g.fillText('CHIPTUNES.APP', 256, 374);
    g.font='24px ui-monospace, Menlo, monospace'; g.fillStyle='rgba(252,252,248,.82)'; g.fillText('RADIO', 256, 414);
    _mediaArtCache[key]=c.toDataURL('image/png');
  }catch(e){
    _mediaArtCache[key]='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0a0814"/><text x="256" y="270" fill="#fcfcf8" font-family="monospace" font-size="46" text-anchor="middle">CHIPTUNES.APP</text></svg>');
  }
  // One 512x512 PNG data URL per track, each a couple of hundred kilobytes of
  // base64, kept for a track nobody will see again -- a listener who leaves the
  // station on all afternoon accumulates every one of them. Keep a few.
  var _keys = Object.keys(_mediaArtCache);
  if(_keys.length > 8) delete _mediaArtCache[_keys[0]];
  return _mediaArtCache[key];
}
function _mediaDescriptor(){
  var title=_curName||'Chiptunes.app', artist='Chiptunes.app', album='Chiptunes.app', art=null;
  if(_nowSource==='generated'){
    album='Endless generated radio';
    artist='Chiptunes.app';
    art=[{src:_mediaGeneratedArtwork(_curSlug,title), sizes:'512x512', type:'image/png'}];
  } else if(_nowSource==='watch'){
    title='Game visualizer';
    album='Screensaver mode';
  }
  if(!art) art=[{src:_mediaGeneratedArtwork('', title), sizes:'512x512', type:'image/png'}];
  return { title:title||'Chiptunes.app', artist:artist||'Chiptunes.app', album:album||'Chiptunes.app', artwork:art };
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
//  (Blocks/Bricks cycle through block colours per bar). So you can glance at the tab and see it alive.
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
    // Headless capture (the YouTube leg fullscreens Chromium; no tab strip exists): skip the sprite
    // draw + PNG encode + href swap — nobody can see them. The Audio.vis() call above is KEPT so the
    // analyser EMA/release cadence stays identical to a normal browser (pixel-safety of the visuals).
    if(typeof window!=='undefined' && window.__rrrHeadlessCapture) return;
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
// ============ CRT GAIN MAP ============
// The two CSS CRT overlays (.scanlines multiply + .vignette) forced the software compositor into a
// backdrop-copy + two full-screen blends EVERY canvas frame (~1.34ms/frame measured on the GPU-less
// broadcast box). Both layers are static and black-based, so their combined effect on any backdrop is
// a fixed per-pixel, per-channel GAIN: G = [(1-as)+as*Cs] * (1-av)  (multiply-with-alpha, then black
// source-over). We bake G ONCE per (viewport,DPR) — by compositing the exact same gradients/shadow
// over white — into one opaque canvas drawn with mix-blend-mode:multiply: a single blend layer that
// reproduces both. The legacy divs stay in the DOM as the fallback (and for the pixel-diff harness:
// window.__rrrCrtMode('legacy'|'gain')). Verified by scripts/crt-diff.mjs.
(function(){
  if(typeof document==='undefined' || typeof window==='undefined') return;
  var _gainCv=null, _gainKey='', _gainBuildSeq=0, _mode='gain', _rsT=0;
  // Rasterize a styled block with Chrome's OWN CSS engine (SVG foreignObject -> <img>): gradients,
  // box-shadow AND the engine's gradient dithering come out exactly as the legacy divs render them —
  // hand-recomputing the gradients in canvas measurably diverges (dither noise, kernel differences).
  function cssLayerImg(styleStr, w, h){
    return new Promise(function(res, rej){
      var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'
        +'<foreignObject width="100%" height="100%">'
        +'<div xmlns="http://www.w3.org/1999/xhtml" style="width:'+w+'px;height:'+h+'px;'+styleStr+'"></div>'
        +'</foreignObject></svg>';
      var img=new Image();
      img.onload=function(){ res(img); };
      img.onerror=function(){ rej(new Error('css layer raster failed')); };
      img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    });
  }
  // NOTE: keep these two style strings verbatim-in-sync with .scanlines/.vignette in shell.html
  // (MINUS the element opacity and mix-blend-mode — those are applied arithmetically below).
  var SCAN_BG='background:repeating-linear-gradient( to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.28) 2px, rgba(0,0,0,0.28) 4px), repeating-linear-gradient( to right, rgba(255,0,0,0.04) 0px, rgba(0,255,0,0.03) 1px, rgba(0,0,255,0.04) 2px);';
  // A VIGNETTE ON A WIDE WINDOW IS NOT A VIGNETTE, IT IS TWO DARK BARS.
  // `ellipse at center` fits itself to the box, so on a 1990x1250 window the
  // falloff runs out horizontally long before it runs out vertically and the
  // darkening lands as a vertical band down each side rather than as corners.
  // Three layers were stacked on top of each other -- this gradient, the inset
  // shadow below it, and the canvas radial in _vignette() -- and measured on a
  // wide window the edge column sat at 28% of the centre's brightness.
  // A CIRCLE sized to the LONGER axis keeps the falloff in the corners where a
  // real tube's is, at any aspect ratio.
  var VIG_BG='background:radial-gradient(circle farthest-corner at center, rgba(0,0,0,0) 82%, rgba(0,0,0,.09) 100%);box-shadow: inset 0 0 60px 0px rgba(0,0,0,.05);';
  function buildGain(w,h,dpr){
    return Promise.all([cssLayerImg(SCAN_BG,w,h), cssLayerImg(VIG_BG,w,h)]).then(function(imgs){
      var dw=Math.max(1,Math.round(w*dpr)), dh=Math.max(1,Math.round(h*dpr));
      var out=document.createElement('canvas'); out.width=dw; out.height=dh;
      var o=out.getContext('2d');
      function layerData(img){ var c=document.createElement('canvas'); c.width=dw; c.height=dh;
        var x=c.getContext('2d'); x.drawImage(img,0,0,dw,dh); return x.getImageData(0,0,dw,dh).data; }
      try{
        // float path (preferred): G = [(1-.3as)+.3as*Cs] * (1-.5av) per channel, computed in float from
        // the engine-rendered layers with ONE final quantization (the vignette is pure black => only its
        // alpha matters). Throws if the browser taints foreignObject rasters -> composite fallback below.
        var sd=layerData(imgs[0]), vd=layerData(imgs[1]);
        var G=o.createImageData(dw,dh), gd=G.data;
        for(var i=0;i<gd.length;i+=4){
          var as=(sd[i+3]/255)*_RRR_SCANLINE_STRENGTH, av=(vd[i+3]/255)*1.0, va=1-av;   // vignette factor was 0.5
          gd[i]  =Math.round(((1-as)+as*(sd[i]  /255))*va*255);
          gd[i+1]=Math.round(((1-as)+as*(sd[i+1]/255))*va*255);
          gd[i+2]=Math.round(((1-as)+as*(sd[i+2]/255))*va*255);
          gd[i+3]=255;
        }
        o.putImageData(G,0,0);
      }catch(e){
        // composite fallback: same math via canvas blending (two 8-bit intermediate quantizations)
        o.fillStyle='#fff'; o.fillRect(0,0,dw,dh);
        o.globalAlpha=_RRR_SCANLINE_STRENGTH; o.globalCompositeOperation='multiply'; o.drawImage(imgs[0],0,0,dw,dh);
        o.globalAlpha=1.0; o.globalCompositeOperation='source-over'; o.drawImage(imgs[1],0,0,dw,dh);   // matches the gain path above
        o.globalAlpha=1; o.globalCompositeOperation='source-over';
      }
      return out;
    });
  }
  function setMode(m){
    _mode=m;
    // This module rebuilds on window resize and re-shows its own layers, so
    // gating them from _applyScreenMode alone did not hold: switching to the
    // Game Boy panel resizes the stage, the resize fires, and the gain canvas
    // came straight back -- multiply-blended over the panel. It has to know
    // whether the CRT is the screen being shown at all.
    var off = (typeof _screenMode !== 'undefined' && _screenMode !== 'crt');
    var els=document.querySelectorAll('.crt.scanlines,.crt.vignette');
    for(var i=0;i<els.length;i++){
      els[i].style.display = off ? 'none' : ((m==='gain')?'none':'');
      if(els[i].classList.contains('scanlines')) els[i].style.opacity=String(_RRR_SCANLINE_STRENGTH);
    }
    if(_gainCv) _gainCv.style.display = off ? 'none' : ((m==='gain')?'':'none');
  }
  function apply(){
    var buildSeq=++_gainBuildSeq;
    // the gain map covers the PICTURE, which now ends above the player bar --
    // baking it to the whole window put its vignette a bar's height too low
    var _bi=0;
    try{ _bi=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--barh'))||0; }catch(e){}
    var w=window.innerWidth, h=Math.max(160, window.innerHeight-_bi);
    // The gain layer is a soft multiply mask over the whole window, composited
    // every frame -- at DPR 2 on a 1440p display that is five megapixels of
    // blending for a texture whose finest detail is a scanline. Capped at 1.5
    // it is indistinguishable and costs 44% fewer pixels.
    var dpr=Math.min(1.5, window.devicePixelRatio||1);
    var key=w+'x'+h+'@'+dpr+'#'+_RRR_SCANLINE_STRENGTH;
    if(key===_gainKey){ setMode(_mode==='legacy'?'legacy':'gain'); window.__rrrCrtReady=true; return; }
    window.__rrrCrtReady=false;
    buildGain(w,h,dpr).then(function(built){
      if(buildSeq!==_gainBuildSeq) return;   // a newer resize/build owns the overlay now
      if(!_gainCv){
        _gainCv=document.createElement('canvas');
        _gainCv.className='crt gain';
        _gainCv.style.mixBlendMode='multiply';
        // no inline size: .crt is inset above the player bar, and a 100% height
        // would measure against the window and reach back under it
        _gainCv.style.width=''; _gainCv.style.height='';
        var vigEl=document.querySelector('.crt.vignette');
        if(vigEl && vigEl.parentNode) vigEl.parentNode.insertBefore(_gainCv, vigEl.nextSibling);
        else document.body.appendChild(_gainCv);
      }
      _gainCv.width=built.width; _gainCv.height=built.height;
      _gainCv.getContext('2d').drawImage(built,0,0);
      _gainKey=key;
      setMode(_mode==='legacy'?'legacy':'gain');
      window.__rrrCrtReady=true;
    }).catch(function(){ if(buildSeq!==_gainBuildSeq) return; setMode('legacy'); window.__rrrCrtReady=true; });   // fallback: legacy divs stay on
  }
  window.__rrrCrtMode=function(m){ if(m==='gain'){ _mode='gain'; apply(); } else if(m==='legacy'){ _mode='legacy'; setMode('legacy'); window.__rrrCrtReady=true; } return _mode; };
  window.__rrrSetScanlineStrength=function(v){ v=Number(v); if(!isFinite(v))return _RRR_SCANLINE_STRENGTH; _RRR_SCANLINE_STRENGTH=Math.max(0,Math.min(1,v)); _gainKey=''; apply(); return _RRR_SCANLINE_STRENGTH; };
  window.addEventListener('resize', function(){ _gainBuildSeq++; window.__rrrCrtReady=false; clearTimeout(_rsT); _rsT=setTimeout(apply,150); });
  apply();
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
// A SONG IS NOT ITS NAME ANY MORE. The address bar used to carry the slug that
// generated the track, which made the name the seed and the URL the song. Songs
// are made now, not named into being: the station keeps the plain route and a
// song you want to keep is shared as a Create document, which is the song
// itself rather than an instruction for rebuilding it.
function _generatedRoute(){
  var p=(location.pathname||'/');
  return (p==='/radio'||p==='/watch') ? p : '/';
}
function _queryFlag(name){
  try{
    var q=new URLSearchParams(location.search||'');
    var v=(q.get(name)||'').toLowerCase();
    return q.has(name) && v!=='0' && v!=='false' && v!=='no';
  }catch(e){ return false; }
}
// A shared song rides in the fragment: /#s=<packed document>
function _readSharedDoc(){
  try{ var m=/[#&]s=([^&]+)/.exec(location.hash||''); return (m && m[1]) ? m[1] : null; }
  catch(e){ return null; }
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
  try{ if(typeof CT_CREATE!=='undefined' && CT_CREATE.isOpen()) return; }catch(eC){}  // the editor owns /create; a refresh must land back in it
  var intro=document.getElementById('intro');
  if(intro && !intro.classList.contains('hidden') && getComputedStyle(intro).display!=='none') return;  // Home owns the root route while it is visible
  var want = _generatedRoute() + _routeQueryExtras();
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
  if(document.body) document.body.classList.remove('awaiting-mood');
  if(_nowSource==='external' || (Audio.extActive&&Audio.extActive())) return;   // stale generated callbacks must not overwrite chip/mic/file titles
  if(slug) window._sharedSongPlaying=false;      // a real token means the station has moved on
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
  // On a player route the Home overlay was NEVER shown -- html.boot-player-route
  // hides it before first paint. Dropping that class here and then starting the
  // .hidden fade made it visible again for the length of the fade: half a second
  // of splash on every single load of the station. Take it out of the layout
  // first, and skip the fade there is nothing to fade from.
  var wasBoot=!!(document.documentElement && document.documentElement.classList.contains('boot-player-route'));
  if(wasBoot) intro.style.display='none';
  if(document.documentElement) document.documentElement.classList.remove('boot-player-route');
  intro.classList.add('hidden');
  if(!wasBoot) setTimeout(()=> intro.style.display='none', 500);
  hud.classList.add('show'); presetsBar.classList.add('show');
  if(typeof syncBrowseButton==='function') syncBrowseButton();
  if(typeof syncRadioUI==='function') syncRadioUI();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
  if(!window._radioTick) window._radioTick = setInterval(()=>{ if(Audio.started && !(typeof _backgroundAudioOnlyActive==='function' && _backgroundAudioOnlyActive())){ syncTempoUI(); updateNow(); } }, 700);   // keep bpm/now-line live only while the UI is visible
}
function startAudio(viaGesture, opts){
  if(_POPOVER_MODE || _BROWSE_MODE) return;                // controller windows must never become a second audio player
  if(viaGesture && typeof viaGesture==='object'){ opts=viaGesture; viaGesture=!!opts.viaGesture; }
  opts=opts||{};
  if(!bootDone){
    bootDone = true;
    var _wantSlug = _readSlug();               // capture any shared generated-track slug before booting audio
    var _wantDoc  = _readSharedDoc();          // ...or a whole shared SONG, which is the modern form
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
        if(_wantDoc){
          // A SHARED SONG OPENS PLAYING. The document is the song, so there is
          // nothing to look up and nothing to regenerate -- and the station
          // carries on normally afterwards, which is what makes a shared link
          // a way into the product rather than a dead end.
          _trkHist = []; _trkI = 0;
          // A shared song is a PRIVATE replay, like a shared slug always was.
          // The live schedule's tick re-seeks the station every few seconds and
          // will happily seek straight off the top of the song somebody sent
          // you -- which is exactly what it did.
          _unpackDoc(_wantDoc).then(function(code){
            var ok=false;
            try{
              window._sharedSongPlaying=true;      // before the leave, so no tick can race in
              _forkFromLive();
              ok = !!(code && Audio.playDoc && Audio.playDoc(code));
            }catch(e){ ok=false; }
            if(!ok){ window._sharedSongPlaying=false;
                     if(Audio.gotoTrack) Audio.gotoTrack(_mintToken()); }   // unreadable link: still play something
          });
        } else if(_wantSlug){
          _trkHist = [_wantSlug]; _trkI = 0;                    // a shared link plays what it names
          if(Audio.gotoTrack) Audio.gotoTrack(_wantSlug);
        } else {
          // NOTHING PLAYS UNTIL YOU ASK. A cold load used to mint a random
          // track and start it -- or join the scheduled broadcast, which
          // amounts to the same thing -- and either way it answered a question
          // nobody had put yet. The moods are the question, and the station
          // holds until one is picked, or until anything else explicitly starts
          // a track. The broadcast is still reachable; it just does not grab
          // the room on the way in.
          _trkHist = []; _trkI = 0;
          try{ if(Audio.holdForPick) Audio.holdForPick(true); }catch(e){}
          if(document.body) document.body.classList.add('awaiting-mood');
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
  if(typeof _syncMediaAnchor==='function') _syncMediaAnchor();   // mobile: bind + play the output-stream element now (it IS the audio output there)
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
  // Splash removed (owner: "we no longer need this splash screen"). The game plays as a silent wallpaper and
  // the GLOBAL first-gesture handler below starts the audio on the first click/tap/key — no prompt needed.
  return;
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
  // "TAP ANYWHERE TO START" IS NOT TRUE ANY MORE. A station that is waiting to
  // be asked for a mood has to keep waiting: this handler resumes whatever is
  // paused, holding now reads as paused (rightly -- nothing is playing), and
  // the result was that a click anywhere on the page picked a mood at random
  // and started it. The moods and the play button are the entry; a stray click
  // is not.
  try{ if(Audio.isHolding && Audio.isHolding()) return false; }catch(e){}
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
  if(_POPOVER_MODE || _BROWSE_MODE) return;
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
if(!_POPOVER_MODE && !_BROWSE_MODE && typeof _readSlug==='function' && _readSlug()){
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
  // ALWAYS leave the home backdrop first. It used to be torn down only in enterStation() (the click-a-tile
  // path), so landing directly on /radio — which routes straight here via _productRouteTo — left _homeBackdrop
  // (and _watchOnly) stuck true forever. _syncVisualChrome() force-clears `ai-visual` while the backdrop is up,
  // so the player fell back to the bare #playbar dock with no top-right links: the "separate /radio layout".
  // Tearing it down HERE means every entry into playback (route, tile, deep link) gets the one real player chrome.
  if(typeof _stopHomeBackdrop==='function') _stopHomeBackdrop();
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
  }catch(e){ if(window._toast)_toast('Microphone blocked. Allow mic access.'); return false; } }
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
    _curName=st.name||_curName||'Chiptunes.app';
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
  _watchOnly=false; _watchMicActive=false; _homeBackdrop=false;
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
// ===== HOME: ONE station — the shared LIVE broadcast. No mood picker anymore; a single
//  entry stays only so enterStation('st-any') has an id to resolve. =====
const HOME_TILES = [
  { id:'st-any', mood:'any', sprite:'maze', name:'Chiptunes.app', desc:'One endless generative chiptune station.', c:'#27d9e8' },
];
function _homeEsc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function _showProductHomeShell(){
  var intro=document.getElementById('intro'), el=document.getElementById('hometiles');
  if(!intro || !el) return null;
  if(typeof closeMixPanel==='function') closeMixPanel();
  if(document.documentElement) document.documentElement.classList.remove('boot-player-route');
  window.__RRR_BOOT_PLAYER_ROUTE=false;
  _revealed=false; intro.style.display=''; intro.classList.remove('hidden','lib'); intro.classList.add('product-home');
  el.classList.remove('lib','product-mode','project-mode');
  return el;
}
// ---- HOME = platform cards (like lofigirl's stream grid, our own retro look). The live game runs
//      BEHIND them; each card is one way to get Chiptunes: browser · desktop wallpaper · YouTube · radio.
var _IC_PLAY='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5v13l11-6.5z"/></svg>';
var _IC_GB='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="7.5" y="5" width="9" height="7" rx="1"/><path d="M9 16h2M10 15v2" stroke-linecap="round"/><circle cx="15" cy="16" r="1"/></svg>';
var _IC_WAVE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h2.5l2-6 3 13 3-9 2 4H21"/></svg>';
var _IC_GH='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>';
// The repository is public and the owner asked for a link to it; it is also the
// honest answer to "how does this work", which is most of why anyone asks.
var GITHUB_URL='https://github.com/tetrisgm/chiptunes';
var _IC_INFO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none"/></svg>';
var _IC_CREATE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 4v6M14 7h6M4 17h6" stroke-linecap="round"/></svg>';
var _IC_MON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="3.5" width="19" height="13" rx="1.5"/><path d="M9 20.5h6M12 16.5v4" stroke-linecap="round"/></svg>';
var _IC_YT='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.8 4.7 12 4.7 12 4.7s-6.8 0-8.5.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 4.8 2.8 2.8 0 0 0 2 2c1.7.5 8.5.5 8.5.5s6.8 0 8.5-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-4.8zM9.8 15.3V8.7l5.7 3.3z"/></svg>';
var _IC_RADIO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="14" r="3"/><rect x="2.5" y="8.5" width="19" height="12" rx="1.5"/><path d="M16 4.5l3 4M14 13h4M14 16.5h4"/></svg>';
// Platform glyphs for the Apple-landing-style desktop download buttons (Apple mark · Windows panes · Tux).
var _IC_APPLE='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.85 2.33-4.22 2.44-4.28-1.33-1.95-3.4-2.22-4.14-2.25-1.76-.18-3.44 1.04-4.33 1.04-.89 0-2.27-1.02-3.73-.99-1.92.03-3.69 1.12-4.68 2.84-2 3.46-.51 8.58 1.43 11.39.95 1.38 2.08 2.92 3.56 2.87 1.43-.06 1.97-.92 3.7-.92 1.73 0 2.22.92 3.73.89 1.54-.03 2.51-1.4 3.45-2.79 1.09-1.6 1.54-3.15 1.56-3.23-.03-.01-2.99-1.15-3.02-4.55zM14.28 3.87c.79-.96 1.32-2.29 1.17-3.62-1.13.05-2.5.76-3.31 1.71-.73.85-1.37 2.2-1.2 3.5 1.26.1 2.55-.64 3.34-1.59z"/></svg>';
var _IC_WIN='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.1l7.5-1v7.3H3zM11.3 4L21 2.6v9.8h-9.7zM3 12.9h7.5v7.2L3 19zM11.3 12.9H21v9.5l-9.7-1.35z"/></svg>';
var _IC_LINUX='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-2.2 0-3.8 1.8-3.8 4.2 0 1.3.2 2.1-.6 3.2-.9 1.2-2.6 2.9-3.2 5-.3 1 .2 1.6 1 1.4.5-.1.9-.5 1.2-1-.2 1.3-.5 2.3-1.1 3.2-.5.8 0 1.6 1 1.6h11c1 0 1.5-.8 1-1.6-.6-.9-.9-1.9-1.1-3.2.3.5.7.9 1.2 1 .8.2 1.3-.4 1-1.4-.6-2.1-2.3-3.8-3.2-5-.8-1.1-.6-1.9-.6-3.2C15.8 3.8 14.2 2 12 2zm-1.6 4.2c.4 0 .7.4.7 1s-.3 1-.7 1-.7-.4-.7-1 .3-1 .7-1zm3.2 0c.4 0 .7.4.7 1s-.3 1-.7 1-.7-.4-.7-1 .3-1 .7-1zM12 8.6c.7 0 1.6.4 1.6.9 0 .3-.8.8-1.6.8s-1.6-.5-1.6-.8c0-.5.9-.9 1.6-.9z"/></svg>';
var RADIO_STREAM_URL='https://radio.chiptunes.app';   // bare root is a first-class stream alias (see broadcaster PRIMARY_ALIASES) — cleaner to paste than /radio.mp3
var YT_HANDLE='https://www.youtube.com/@chiptunesapp';
// Immutable channel id (an @handle can be renamed/reassigned; the UC id never rots).
var YT_CHANNEL_ID='UCck8mz53plGiDjR3Ar5Ytgg';
var YT_SUB_URL='https://www.youtube.com/channel/'+YT_CHANNEL_ID+'?sub_confirmation=1';   // one-click subscribe-confirm popup
// Ambient live embed (auto-follows whatever's live — no video id). Always-playing + muted + made
// non-interactive (pointer-events:none in CSS), so the "more videos" overlay — which only shows on
// pause/hover — never triggers. controls/rel/iv/fs/disablekb strip the rest of the chrome. Can't remove
// the tiny watermark/LIVE badge (baked in). referrerpolicy on the iframe is the real "Error 153" fix.
var YT_LIVE_EMBED='https://www.youtube-nocookie.com/embed/live_stream?channel='+YT_CHANNEL_ID+'&autoplay=1&mute=1&playsinline=1&controls=0&rel=0&iv_load_policy=3&fs=0&disablekb=1&modestbranding=1';
var DL_MAC='https://updates.chiptunes.app/Chiptunes-mac.zip';
var DL_WIN='https://updates.chiptunes.app/Chiptunes-win-x64.exe';
var DL_LINUX='https://updates.chiptunes.app/Chiptunes-linux-x86_64.AppImage';
// Ordered for a balanced 2×2 grid: the two media-rich cards (browser moods · live embed) on top,
// The browser card is the hero (full-width top row — it's the primary, most-obvious way to listen);
// desktop · YouTube · radio sit three-across beneath it. No leading icon tiles — Apple-clean text cards.
var PLATFORMS = [
  { plat:'web', accent:'#27d9e8', title:'In your browser',
    desc:'One endless station: a shuffle of every mood of generative chiptune, the exact same stream you get on YouTube and the radio. Plays instantly, nothing to install.',
    actions:[{k:'web-listen', label:'Listen now'}] },            // the single shared LIVE station (same everywhere)
  { plat:'desktop', accent:'#8f7ae0', title:'On your desktop',
    desc:'A music-reactive scene you can run in a window, or set as a living desktop wallpaper. Mac, Windows and Linux.',
    actions:[{k:'dl-mac', label:'Mac', href:DL_MAC}, {k:'dl-win', label:'Windows', href:DL_WIN}, {k:'dl-linux', label:'Linux', href:DL_LINUX}] },

  { plat:'radio', accent:'#5ee08a', title:'On any radio app',
    desc:'A real internet radio station. Paste the stream into your radio app, or listen right here.',
    url:'radio.chiptunes.app', copy:true,
    actions:[
      {k:'radio-listen', label:'Listen now'},                    // opens the bare stream (browser plays the MP3)
      {k:'radio-open', label:'Add to radio app', only:'mobile'},     // iOS Broadcasts / Android intent chooser
    ] },
];
function _homeIsMobile(){ try{ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent||'') || ('ontouchstart' in window) || (navigator.maxTouchPoints||0)>0; }catch(e){ return false; } }
// Detect the visitor's desktop OS so we can highlight their download (the Apple-landing convention).
function _homeOS(){
  try{
    var uad=navigator.userAgentData, p=(uad&&uad.platform)||navigator.platform||'', ua=navigator.userAgent||'';
    if(/Mac/i.test(p)||/Mac OS X/i.test(ua)) return 'mac';
    if(/Win/i.test(p)||/Windows/i.test(ua)) return 'win';
    if(/Linux|X11/i.test(p)||(/Linux/i.test(ua)&&!/Android/i.test(ua))) return 'linux';
  }catch(e){}
  return '';
}
var _DL_ICON={ 'dl-mac':_IC_APPLE, 'dl-win':_IC_WIN, 'dl-linux':_IC_LINUX };
var _DL_OS={ 'dl-mac':'mac', 'dl-win':'win', 'dl-linux':'linux' };
function _platBtn(a){
  // Desktop downloads get the Apple-landing treatment: platform glyph + name, the visitor's own OS
  // rendered as the filled primary, the others as glass secondaries.
  if(/^dl-/.test(a.k)){
    var primary = !_homeIsMobile() && _homeOS()===_DL_OS[a.k];
    return '<a class="pc-btn pc-dl'+(primary?' is-primary':'')+'" data-k="'+a.k+'" href="'+_homeEsc(a.href)+'">'+
      '<span class="pc-dl-ic">'+(_DL_ICON[a.k]||'')+'</span><span class="pc-dl-t">'+_homeEsc(a.label)+'</span></a>';
  }
  var attrs='class="pc-btn" data-k="'+a.k+'"';
  if(a.href) return '<a '+attrs+' href="'+_homeEsc(a.href)+'">'+_homeEsc(a.label)+'</a>';
  return '<button '+attrs+' type="button">'+_homeEsc(a.label)+'</button>';
}
function _platCard(p){
  var badge = p.badge ? '<span class="live-badge">'+p.badge+'</span>' : '';
  var acts = (p.actions||[]).filter(function(a){ return !a.only || (a.only==='mobile')===_homeIsMobile(); });
  var body = '';
  // YouTube: ambient live player. The iframe is non-interactive (CSS pointer-events:none) so the pause/hover
  // "more videos" grid never shows; a transparent overlay link opens the channel (subscribe/full-screen there).
  if(p.embed && !_homeIsMobile()){
    body += '<div class="pc-embed'+(p.ambient?' pc-embed-ambient':'')+'">'+
      '<iframe src="'+_homeEsc(p.embed)+'" title="'+_homeEsc(p.title)+' (live)" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>'+
      '<a class="pc-embed-open" href="'+_homeEsc(YT_HANDLE)+'/live" target="_blank" rel="noopener" aria-label="Watch on YouTube Live: open the channel to subscribe"></a></div>';
  }
  // Radio: one compact line — the stream URL, a Copy button, and the listen/add action right beside it.
  if(p.url){
    body += '<div class="pc-radiorow"><code class="pc-url">'+_homeEsc(p.url)+'</code>'+
      (p.copy?'<button class="pc-copy" type="button" data-k="radio-copy" aria-label="Copy stream URL">Copy</button>':'')+
      acts.map(_platBtn).join('')+'</div>';
  } else if(acts.length){
    // desktop downloads (and the mobile-only YouTube button) — pinned to the card bottom for alignment
    body += '<div class="pc-actions">'+acts.map(_platBtn).join('')+'</div>';
  }
  return '<div class="pcard" data-plat="'+p.plat+'" style="--pc:'+p.accent+'">'+
    '<h3 class="pc-title">'+_homeEsc(p.title)+badge+'</h3>'+
    '<p class="pc-desc">'+p.desc+'</p>'+body+'</div>';
}
// "Open in your radio app" — no OS has a canonical internet-radio app, so this is best-effort per
// platform: Android raises the audio-app chooser via an intent (with a .pls fallback baked in); iOS
// tries Broadcasts (the most popular iOS radio app) and falls back to the .pls playlist if it's not
// installed; anything else just gets the .pls. Always paired with a copy-URL button that never fails.
function _openRadioInApp(){
  var stream=RADIO_STREAM_URL, ua=navigator.userAgent||'';
  if(/Android/i.test(ua)){
    location.href='intent://radio.chiptunes.app/#Intent;scheme=https;action=android.intent.action.VIEW;type=audio/mpeg;S.browser_fallback_url=https%3A%2F%2Fchiptunes.app%2Fradio.pls;end';
    return;
  }
  if(/iPhone|iPad|iPod/i.test(ua)){
    var t=setTimeout(function(){ location.href='/radio.pls'; }, 1400);   // Broadcasts not installed -> playlist file
    var vis=function(){ if(document.hidden){ clearTimeout(t); document.removeEventListener('visibilitychange',vis); } };
    document.addEventListener('visibilitychange',vis);   // app opened -> page hides -> cancel the fallback
    // artwork too: Broadcasts shows it in the station list, on the lock screen
    // and in CarPlay, and a station added without one is a grey square there
    location.href='broadcasts://add?name=Chiptunes.app&address='+encodeURIComponent(stream)+
      '&artworkAddress='+encodeURIComponent('https://chiptunes.app/station-icon.png');
    return;
  }
  location.href='/radio.pls';
}
function _homeAction(k, btnEl){
  if(k==='dl-mac' || k==='dl-win' || k==='dl-linux'){ return; }  // real <a> download links — let the browser handle them
  if(k==='web-listen'){ if(typeof enterStation==='function') enterStation('st-any'); return; }   // the one shared LIVE station
  if(k==='yt-live'){ window.open(YT_HANDLE+'/live','_blank','noopener'); return; }   // channel/live — unmute, full-screen, subscribe there
  if(k==='radio-listen'){ window.open(RADIO_STREAM_URL,'_blank','noopener'); return; }   // open the bare stream — the browser plays the MP3
  if(k==='radio-open'){ _openRadioInApp(); return; }
  if(k==='radio-copy'){
    var flash=function(){ if(!btnEl) return; if(!btnEl.dataset.label) btnEl.dataset.label=btnEl.textContent; btnEl.textContent='Copied'; setTimeout(function(){ btnEl.textContent=btnEl.dataset.label; },1500); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(RADIO_STREAM_URL).then(flash,flash); else flash();
    return;
  }
}
// There is ONE station — the shared LIVE broadcast. The old station-picker overlay is gone.
function buildHomeTiles(){ var el=_showProductHomeShell(); if(!el) return;
  if(typeof _startHomeBackdrop==='function') _startHomeBackdrop();   // live game plays behind the cards
  el.innerHTML = '<div class="platforms-head"><h2 class="platforms-title">So many ways to listen.</h2>'+
    '<p class="platforms-sub">Chiptunes.app plays wherever you are: in your browser, on your desktop, on YouTube, or on any radio app.</p></div>'+
    '<div class="platforms">'+PLATFORMS.map(_platCard).join('')+'</div>';
  if(!el._wired){ el._wired=true; el.addEventListener('click', function(ev){
    var btn=ev.target.closest('.pc-btn,.pc-copy'); if(!btn) return;
    var k=btn.dataset.k;
    if(!/^dl-/.test(k)){ ev.preventDefault(); ev.stopPropagation(); }   // dl-* are real <a> downloads; the rest handled here
    _homeAction(k, btn);
  }); }
}
window.buildHomeTiles=buildHomeTiles;
// The platform page lives at /get now, not at /. '/' is the player: a visitor
// should land in the thing, not on a page describing it. Keeping the page ON a
// route (rather than making it a bare overlay) is what keeps the back button
// honest -- as an overlay over the player it had no URL and no way out except
// the transport, which is not an obvious "close".
function openProductHome(opts){
  opts=opts||{};
  buildHomeTiles();
  if(!opts.noRoute && typeof history!=='undefined' && history.pushState && _pathParts(location.pathname)[0]!=='get'){
    try{ (opts.replace&&history.replaceState ? history.replaceState : history.pushState).call(history,{product:1},'','/get'); }catch(e){}
  }
  if(typeof syncBrowseButton==='function') syncBrowseButton();
  if(typeof _syncVisualChrome==='function') _syncVisualChrome();
}
window.openProductHome=openProductHome;
// ----- route table: / and /radio are the PLAYER · /get is the platform page ·
//  /browse[...] (library-owned) · /watch · /track/<slug>.
//  Legacy heads (listen|play|create|wip) land on the player. Returns false for
//  library/track routes. -----
function _productRouteFromPath(path){
  var head=String(_pathParts(path)[0]||'').toLowerCase();
  if(!head) return {mode:'radio'};                 // '/' IS the player now
  if(head==='radio') return {mode:'radio'};
  if(head==='get') return {mode:'home'};
  if(head==='gameboy') return {mode:'gameboy'};
  if(head==='watch') return {mode:'watch'};
  if(head==='listen'||head==='play'||head==='wip') return {mode:'radio', legacy:true};
  if(head==='create') return {mode:'create'};
  return null;
}
window._productRouteTo=function(path, opts){
  var r=_productRouteFromPath(path);
  if(!r) return false;
  opts=Object.assign({replace:true}, opts||{});
  if(r.legacy && typeof history!=='undefined' && history.replaceState){ try{ history.replaceState(null,'','/'); }catch(e){} }
  if(r.mode==='gameboy'){ _startEndlessRadio(); _openGameBoyWhenReady(); return true; }
  if(r.mode==='create'){ _createStandalone=true; _openCreate(); return true; }
  if(r.mode==='radio'){ _startEndlessRadio(); return true; }
  if(r.mode==='watch'){ enterWatchMode({noRoute:true}); return true; }
  openProductHome(Object.assign({noRoute:true}, opts));   // already ON /get; do not push it again
  return true;
};
// ----- station entry: the three tiles + every music-pack id + mic + liked. -----
function enterStation(id){
  id=String(id||'');
  if(typeof _stopHomeBackdrop==='function') _stopHomeBackdrop();   // leave the home backdrop -> real audio
  var mst=null;
  for(var hi=0;hi<HOME_TILES.length;hi++) if(HOME_TILES[hi].id===id){ mst=HOME_TILES[hi]; break; }
  if(mst){
    // The one station is the shared LIVE broadcast. Clear any stale mood/tempo pin (from an older
    // build that had a picker) so returning listeners land on the live station, then join it.
    try{ if(typeof Radio!=='undefined'&&Radio.setMood) Radio.setMood('any'); }catch(e){}
    try{ if(typeof Radio!=='undefined'&&Radio.setTempo) Radio.setTempo(null); }catch(e2){}
    _startLiveRadio(); return;
  }
  if(id==='radio' || id==='generated'){ _startEndlessRadio(); return; }
  if(id==='watch'){ enterWatchMode(); return; }
  if(typeof _exitWatchMode==='function') _exitWatchMode();
  if(id==='mic'){ startAudio(true, {external:true}); _playMic(); hideHome(); return; }
  if(id==='liked'){
    startAudio(true);
    var L=_playlistItems('liked');
    if(L.length) _playSection('liked'); else if(window._toast)_toast('No liked tracks yet. Heart some first.');
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
// The bundled roster is ready synchronously; this compatibility hook only
// rebuilds the picker after all definitions have registered.
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
// ----- BOOT ROUTE: '/' and /radio ARE the player; /get is the platform page;
//  /watch is the silent wallpaper; legacy heads collapse to the player. -----
// Old station links are accepted as compatibility no-ops; one radio means
// they may never alter or fork the generated sequence.
try{
  var _mq=new URLSearchParams(location.search||'').get('mood');
  if(_mq && typeof Radio!=='undefined' && Radio.setMood) Radio.setMood(String(_mq).toLowerCase());
}catch(e){}
// Only when we are actually going there. Building it unconditionally also
// started a muted game behind it on every load -- including loads that were
// about to start real playback and immediately tear that backdrop down again.
if(String(_pathParts(location.pathname||'/')[0]||'').toLowerCase()==='get') buildHomeTiles();
(function(){
  // Popover/browse renderers are ASSIGNED (window._renderX=function) further down this same bundle, so
  // calling them synchronously here is call-before-definition — a TypeError the old silent catch hid,
  // shipping a BLACK window (v0.1.3 desktop bug). Defer one tick so the whole bundle has evaluated,
  // and log failures instead of swallowing them.
  if(_POPOVER_MODE){ setTimeout(function(){ try{ _renderPopover(); }catch(e){ console.error('popover render failed:', e); } },0); return; }   // controller UI; no audio, no scene loop
  if(_BROWSE_MODE){ setTimeout(function(){ try{ _renderBrowse(); }catch(e){ console.error('browse render failed:', e); } },0); return; }      // Portal-style control center; no audio, no scene loop
  if(_WALLPAPER_MODE){
    if(document.body) document.body.classList.add('wallpaper-visual');
    var _wpStation=''; try{ _wpStation=new URLSearchParams(location.search||'').get('station')||''; }catch(e0){}
    if(_WALLPAPER_AUDIO){
      if(_wpStation && typeof enterStation==='function') enterStation(_wpStation);   // popover-chosen station on the audio-owner display
      else startAudio(true);
      // The wallpaper audio-owner window has NO user gesture, but Electron sets
      // autoplayPolicy:'no-user-gesture-required', so it MUST unlock + un-pause the transport exactly
      // like the play button does — else the AudioContext never fully starts and the wallpaper renders
      // its visuals in SILENCE (owner bug 2026-07-18: "no music while using the video background").
      try{
        if(Audio.resume) Audio.resume(true);
        if(typeof unlockAudioSession==='function') unlockAudioSession();
        if(Audio.setPlaying) Audio.setPlaying(true);
      }catch(e){ console.error('wallpaper audio start failed:', e); }
    } else { enterWatchMode({noRoute:true}); }
    if(window.__rrrWallpaperPerformance) _applyWallpaperPerformance(window.__rrrWallpaperPerformance);
    return;
  }
  var head=String(_pathParts(location.pathname||'/')[0]||'').toLowerCase();
  // 'create' left this retired-routes list 2026-08-26: it is the editor now
  if(head==='listen'||head==='play'||head==='wip'){
    if(typeof history!=='undefined' && history.replaceState){ try{ history.replaceState(null,'','/'); }catch(e){} }
    head='';
  }
  if(head==='gameboy'){ if(document.body) document.body.classList.add('ai-visual');
    startAudio(false); _openGameBoyWhenReady(); return; }
  // The editor is the page here, not an overlay: open it straight away.
  // Booting the radio first flashed a game behind it for a moment, and the
  // station is not needed until Create hands back on close.
  if(head==='create'){ if(document.body) document.body.classList.add('ai-visual');
    document.body.classList.add('create-open');   // hide the stage before anything can paint
    _createStandalone=true; _openCreate(); return; }
  if(head==='get') return;                                       // the platform page; #intro is already up
  if(head==='watch'){ enterWatchMode({noRoute:true}); return; }
  // '' is the ROOT, and the root is the player. A visitor used to land on a
  // page describing the station with the game running muted behind it, and had
  // to press Listen now to reach the thing being described. startAudio's
  // no-gesture path reveals the game immediately and arms the first tap to
  // start the sound, which is the same thing a shared /track link has always
  // done -- so autoplay policy costs a tap, not the whole experience.
  if(head===''||head==='radio'){
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
  var e=function(s){ return (s==null||s==='') ? '·' : String(s); };
  function fmtT(s){ s=Math.max(0,Math.round(s||0)); return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2); }
  function trackText(){ var ext=''; try{ if(window._currentExternalTrackDetailsText) ext=window._currentExternalTrackDetailsText(); }catch(e){}
    if(ext) return ext;
    var t=Audio.trackInfo && Audio.trackInfo(); if(!t) return 'press start';
    var I=t.instruments||{}, P=t.patterns||{}, L=[];
    L.push('=== CHIPTUNES.APP TRACK ===');
    L.push('dialect: '+e(t.dialect)+'   era: '+e(t.era)+'   hardware: '+e(t.hardware));
    L.push('bpm: '+e(t.bpm)+'   key: '+e(t.key)+'   groove: '+e(t.grooveFamily));
    L.push('development: '+e(t.development)+'   motion: '+e(t.motion)+'   space: '+e(t.space));
    L.push('attention: '+(t.attention==null?'·':Math.round(t.attention*100)+'%')+
      '   lead-active: '+(t.leadActiveShare==null?'·':Math.round(t.leadActiveShare*100)+'%')+
      '   critic: '+e(t.quality));
    L.push('playhead: '+fmtT(t.elapsedSec)+'  (bar '+e(t.trackBar)+'/'+e(t.totalBars)+', section '+e(t.section)+')');
    L.push('INSTRUMENTS  lead:'+e(I.lead)+'  bass:'+e(I.bass)+'  harmony:'+e(I.arp)+'  air:'+e(I.pad)+'  texture:'+e(I.fx));
    L.push('STRUCTURE  harmony:'+e(P.harmony)+'  motif:'+e(P.motif)+'  groove:'+e(P.groove)+'  form:'+e(P.form));
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
      b.textContent = ok ? 'copied!' : 'selected. Press Ctrl/Cmd C'; setTimeout(function(){ b.textContent=label; }, ok?1200:2400); }); return b; }

  var panel=document.createElement('div'); panel.id='trackpanel'; panel.style.display='none';
  // --- NOW PLAYING (friendly summary; lives here now, moved out of the mix menu) ---
  var h0=document.createElement('div'); h0.className='tph'; h0.appendChild(document.createTextNode('NOW PLAYING'));
  var np=document.createElement('div'); np.className='tpnp';
  function npChip(k,v){ return '<span class="npc"><b>'+k+'</b>'+e(v)+'</span>'; }
  function updateNP(){ var ext=null; try{ if(window._currentExternalTrackSummary) ext=window._currentExternalTrackSummary(); }catch(e){}
    if(ext){ np.innerHTML=npChip('source',ext.source)+npChip('platform',ext.platform)+npChip('album',ext.album)+npChip('track',ext.track)+npChip('title',ext.title)+(ext.publisher?npChip('publisher',ext.publisher):''); return; }
    var n=Audio.nowPlaying&&Audio.nowPlaying(); if(!n){ np.innerHTML='<span class="npc">press start</span>'; return; }
    np.innerHTML = npChip('dialect',n.dialect)+npChip('era',n.era)+npChip('bpm',n.bpm)+npChip('motion',n.motion)
      +npChip('development',n.development)+npChip('lead',n.lead)+npChip('harmony',n.arp)+npChip('section',n.section); }
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
  var _systemAudioStream=null, _systemAudioSource=null, _systemAudioStatus='off';
  function desktopDiagnostic(event,data){
    try{
      if(window.RRRNative&&window.RRRNative.reportAudioDiagnostic){
        var payload=Object.assign({event:event},data||{}),p=window.RRRNative.reportAudioDiagnostic(payload);
        if(p&&typeof p.catch==='function')p.catch(function(){});
      }
    }catch(e){}
  }
  function stopSystemAudio(returnToRadio){
    if(_systemAudioStream){ try{ _systemAudioStream.getTracks().forEach(function(t){t.stop();}); }catch(e){} }
    _systemAudioStream=null; _systemAudioSource=null; _systemAudioStatus='off';
    if(returnToRadio && Audio.extActive&&Audio.extActive()) _backToGenerated();
    desktopDiagnostic('system-audio-state',{status:'off'});
  }
  function setSystemAudio(enabled){
    enabled=!!enabled;
    if(!_WALLPAPER_AUDIO){ return Promise.resolve(false); }
    if(!enabled){ stopSystemAudio(true); return Promise.resolve(true); }
    if(_systemAudioStatus==='active'&&_systemAudioStream)return Promise.resolve(true);
    _systemAudioStatus='starting'; desktopDiagnostic('system-audio-state',{status:'starting'});
    try{ startAudio(true,{external:true}); }catch(e){}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
      _systemAudioStatus='error'; desktopDiagnostic('system-audio-state',{status:'error',error:'System audio capture is unavailable'}); return Promise.resolve(false);
    }
    return navigator.mediaDevices.getDisplayMedia({audio:true,video:true}).then(function(stream){
      var tracks=stream.getAudioTracks();
      stream.getVideoTracks().forEach(function(t){t.stop();});
      if(!tracks.length)throw new Error('macOS returned no system audio track');
      stopSystemAudio(false);
      var ctx=Audio.audioCtx&&Audio.audioCtx(); if(!ctx)throw new Error('audio context unavailable');
      var source=ctx.createMediaStreamSource(new MediaStream(tracks)),boost=ctx.createGain(); boost.gain.value=1.5;
      source.connect(boost); Audio.playExternal(boost,{source:'system',monitor:false});
      _systemAudioStream=stream; _systemAudioSource=source; _systemAudioStatus='active';
      _station='system'; _nowSource='external';
      if(typeof _setExternalNowPlaying==='function')_setExternalNowPlaying('System audio');
      tracks[0].onended=function(){ if(_systemAudioStream===stream){ stopSystemAudio(true); _systemAudioStatus='error'; desktopDiagnostic('system-audio-state',{status:'error',error:'System audio capture ended'}); } };
      desktopDiagnostic('system-audio-state',{status:'active',trackLabel:tracks[0].label||''});
      return true;
    }).catch(function(error){
      stopSystemAudio(false); _systemAudioStatus='error';
      desktopDiagnostic('system-audio-state',{status:'error',error:String(error&&error.message||error)});
      return false;
    });
  }
  function stId(){ return 'st-any'; }   // one station
  function nowPlaying(){
    try{
      var mix=(typeof window._sessionMixGet==='function') ? window._sessionMixGet() :
        ((typeof Audio!=='undefined' && Audio.getMix) ? Audio.getMix() : {});
      var bounds=(typeof Radio!=='undefined' && Radio.tempoBounds) ? Radio.tempoBounds() : [60,220];
      var nativeBpm=(function(){ try{ return Audio.trackBpm?Audio.trackBpm():null; }catch(e){ return null; } })();
      var details=(function(){ try{ return Audio.nowPlaying?Audio.nowPlaying():null; }catch(e){ return null; } })()||{};
      var liveDebug=(function(){ try{ return LiveCtl&&LiveCtl.debug?LiveCtl.debug():null; }catch(e){ return null; } })();
      var deck=(function(){ try{ return Audio.deckPosition?Audio.deckPosition():null; }catch(e){ return null; } })();
      return {
        title:(typeof _curName!=='undefined' && _curName) ? String(_curName) : '',
        station:stId(),
        live:!!(typeof LiveCtl!=='undefined' && LiveCtl.active && LiveCtl.active()),
        listeners:(typeof window._presenceCount==='number') ? window._presenceCount : null,
        playing:!!(typeof Audio!=='undefined' && Audio.running && Audio.running()),
        bpm:nativeBpm,
        tempo:{ manual:(Radio&&Radio.state)?Radio.state.tempo:null, native:nativeBpm, min:bounds[0], max:bounds[1] },
        mix:mix,
        dialect:details.dialect||null,
        era:details.era||null,
        development:details.development||null,
        motion:details.motion||null,
        token:(liveDebug&&liveDebug.token)||(deck&&deck.tok)||'',
        offsetSec:(liveDebug&&liveDebug.offsetSec!=null)?liveDebug.offsetSec:(deck&&deck.sec!=null?deck.sec:null)
      };
    }catch(e){ return { title:'', station:'st-any', live:false, playing:false, listeners:null, bpm:null, tempo:null, mix:null, token:'', offsetSec:null }; }
  }
  window.RRR={
    isControl:true,
    enterStation:function(id){ try{ enterStation(id); }catch(e){} },
    station:stId,
    transport:function(dir){ try{ if(dir==='prev')_transportPrev(); else if(dir==='toggle')_transportToggle(); else _transportNext(); }catch(e){} },
    setMasterVol:function(v){ v=Math.max(0,Math.min(2,+v||0)); try{ if(typeof _sessionMixSet==='function')_sessionMixSet('master',v); else if(Audio&&Audio.setMix)Audio.setMix('master',v); }catch(e){} },
    setMix:function(role,v){ try{ if(typeof _sessionMixSet==='function')_sessionMixSet(role,Math.max(0,Math.min(2,+v||0))); else if(Audio&&Audio.setMix)Audio.setMix(role,v); }catch(e){} },
    resetMix:function(){ try{ var roles=['lead','bass','kick','snare','hat','arp','pad','fx']; if(typeof _sessionMixReset==='function')_sessionMixReset(roles); else if(Audio&&Audio.setMix)roles.forEach(function(role){Audio.setMix(role,1);}); }catch(e){} },
    setTempo:function(v){ try{ if(Radio&&Radio.setTempo)Radio.setTempo(v==null?null:+v); }catch(e){} },
    visualizer:function(dir){ try{ return cycleVisualizerGame(dir); }catch(e){ return false; } },
    setSystemAudio:setSystemAudio,
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
      else if(cmd.type==='mix') window.RRR.setMix(cmd.role,cmd.value);
      else if(cmd.type==='resetMix') window.RRR.resetMix();
      else if(cmd.type==='tempo') window.RRR.setTempo(cmd.value);
      else if(cmd.type==='visualizer') window.RRR.visualizer(cmd.dir);
      else if(cmd.type==='scanlines' && window.__rrrSetScanlineStrength) window.__rrrSetScanlineStrength(cmd.value);
      else if(cmd.type==='sceneSeconds' && window.__rrrSetSceneSeconds) window.__rrrSetSceneSeconds(cmd.value);
      else if(cmd.type==='systemAudio') window.RRR.setSystemAudio(!!cmd.value);
    }); }catch(e){} }
    if(_WALLPAPER_AUDIO && window.RRRNative.reportNowPlaying){
      var _lastNp='', _pendingNp='';
      setInterval(function(){ try{ var n=nowPlaying(), k=JSON.stringify(n); if(k!==_lastNp && k!==_pendingNp){
        _pendingNp=k; var sent=window.RRRNative.reportNowPlaying(n);
        if(sent&&typeof sent.then==='function') sent.then(function(){ _lastNp=k; if(_pendingNp===k)_pendingNp=''; },function(e){ if(_pendingNp===k)_pendingNp=''; console.error('[desktop] now-playing report failed:',e); });
        else { _lastNp=k; _pendingNp=''; }
      } }catch(e){ _pendingNp=''; console.error('[desktop] now-playing report failed:',e); } }, 1500);
    }
    if(_WALLPAPER_AUDIO && window.RRRNative.reportAudioDiagnostic){
      var _diagSilentAt=0,_diagSilentReported=false,_diagToken='',_diagCtx='';
      function audioSnapshot(){
        var ctx=Audio.audioCtx&&Audio.audioCtx(),deck=Audio.deckPosition&&Audio.deckPosition(),np=Audio.nowPlaying&&Audio.nowPlaying();
        var rx=Audio.vis&&Audio.vis(),probe=Audio.outputProbe&&Audio.outputProbe(),b=rx&&rx.bands||{},wave=rx&&rx.waveform||[];
        var signal=probe?+probe.signal||0:Math.max(+b.bass||0,+b.mid||0,+b.treble||0);
        if(!probe)for(var i=0;i<wave.length;i++)signal=Math.max(signal,Math.abs(+wave[i]||0));
        return {context:ctx?{state:ctx.state,currentTime:ctx.currentTime,sampleRate:ctx.sampleRate,baseLatency:ctx.baseLatency,outputLatency:ctx.outputLatency}:null,
          audio:{started:!!Audio.started,running:!!(Audio.running&&Audio.running()),paused:!!(Audio.isPaused&&Audio.isPaused()),external:!!(Audio.extActive&&Audio.extActive()),systemAudio:_systemAudioStatus},
          deck:deck,nowPlaying:np,signal:signal,outputProbe:probe,reactor:rx?{bpm:rx.bpm,idle:rx.idle,section:rx.section,bands:b,silentTempoFallback:!!_silentTempoFallback}:null,
          radio:{playing:!!(Radio&&Radio.state&&Radio.state.playing),live:!!(Radio&&Radio.live&&Radio.live()),tempo:Radio&&Radio.state?Radio.state.tempo:null},
          scheduler:window.__rrrSched||null,schedulerClock:window.__rrrSchedClock||null,audioResume:window.__rrrAudioResume||null,
          transport:window.__rrrTransport||null,frame:window.__rrrFrame||null,visibility:document.visibilityState,online:navigator.onLine};
      }
      function reportAudio(){
        try{
          var snap=audioSnapshot(),now=Date.now(),tok=snap.deck&&snap.deck.tok||'',ctxState=snap.context&&snap.context.state||'none';
          if(tok!==_diagToken){ desktopDiagnostic('track-token',{previous:_diagToken,current:tok,snapshot:snap}); _diagToken=tok; }
          if(ctxState!==_diagCtx){ desktopDiagnostic('audio-context',{previous:_diagCtx,current:ctxState,snapshot:snap}); _diagCtx=ctxState; }
          var shouldSound=snap.audio.running&&!snap.audio.external&&!snap.audio.paused;
          if(shouldSound&&snap.signal<0.004){
            if(!_diagSilentAt)_diagSilentAt=now;
            if(!_diagSilentReported&&now-_diagSilentAt>=10000){ _diagSilentReported=true; desktopDiagnostic('silence-start',{silentMs:now-_diagSilentAt,snapshot:snap}); }
          }else if(_diagSilentAt){
            if(_diagSilentReported)desktopDiagnostic('silence-end',{silentMs:now-_diagSilentAt,snapshot:snap});
            _diagSilentAt=0; _diagSilentReported=false;
          }
          desktopDiagnostic('heartbeat',{silentMs:_diagSilentAt?now-_diagSilentAt:0,snapshot:snap});
        }catch(e){ desktopDiagnostic('diagnostic-error',{error:String(e&&e.message||e)}); }
      }
      setInterval(reportAudio,5000); setTimeout(reportAudio,1200);
      document.addEventListener('visibilitychange',function(){desktopDiagnostic('visibility',{state:document.visibilityState});});
      window.addEventListener('online',function(){desktopDiagnostic('network',{online:true});});
      window.addEventListener('offline',function(){desktopDiagnostic('network',{online:false});});
      window.addEventListener('error',function(e){desktopDiagnostic('renderer-error',{message:e.message||'',filename:e.filename||'',line:e.lineno||0});});
      window.addEventListener('unhandledrejection',function(e){desktopDiagnostic('renderer-rejection',{reason:String(e.reason&&e.reason.message||e.reason||'unknown')});});
    }
    window.addEventListener('beforeunload',function(){ if(_systemAudioStream)stopSystemAudio(false); });
  }

  // ---- the menu-bar popover control panel (rendered ONLY in the Electron popover window) ----
  window._renderPopover=function(){
    var host=document.getElementById('popover'); if(!host) return;
    var MIX_ROWS=[['lead','Lead / melody'],['bass','Bass'],['kick','Kick'],['snare','Snare / clap'],['hat','Hi-hats'],['arp','Arp'],['pad','Pad'],['fx','FX / risers']];
    var css=document.createElement('style');
    css.textContent=
      'html,body{background:transparent;margin:0}'+
      '#popover{font-family:var(--pixel);color:#f4f2ff;-webkit-user-select:none;user-select:none;height:100vh}'+
      '.pv{display:flex;flex-direction:column;height:100vh;background:linear-gradient(180deg,#141024,#0b0916);border:1px solid rgba(255,255,255,.07);border-radius:18px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.6)}'+
      '.pv-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-color:#514573 transparent}'+
      '.pv-body{display:flex;flex-direction:column;gap:25px;padding:28px 24px 24px}'+
      '.pv-transport{display:flex;align-items:center;justify-content:center;gap:28px}'+
      '.pv-tb{width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f2ff;font-size:18px;cursor:pointer}'+
      '.pv-tb.play{width:72px;height:72px;font-size:28px;background:#f878f8;border-color:#f878f8;color:#160b1f;box-shadow:0 8px 26px rgba(248,120,248,.38)}'+
      '.pv-tb:active{transform:scale(.94)}'+
      '.pv-mixhead{display:flex;align-items:center;justify-content:space-between;color:#6cf;font-size:12px;letter-spacing:.5px;margin-bottom:11px}'+
      '.pv-reset,.pv-auto,.pv-step{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#f4f2ff;border-radius:8px;height:32px;padding:0 10px;font-family:var(--pixel);font-weight:800;cursor:pointer}'+
      '.pv-auto.on{background:#6888fc;color:#0b0916;border-color:#6888fc}'+
      '.pv-tempo{display:grid;grid-template-columns:auto auto minmax(120px,1fr) auto 76px;gap:9px;align-items:center;padding-bottom:15px;border-bottom:1px solid rgba(255,255,255,.12)}'+
      '.pv-tempo input,.pv-mixrow input{width:100%;min-width:0;accent-color:#6cf}'+
      '.pv-temporead,.pv-mixval{text-align:right;color:#d8fff3;font:700 13px var(--mono)}'+
      '.pv-control-section{padding-top:2px}.pv-control-section+.pv-control-section{padding-top:18px;border-top:1px solid rgba(255,255,255,.12)}'+
      '.pv-levelhead{margin-top:0}.pv-mixrow{display:grid;grid-template-columns:34px minmax(115px,150px) minmax(150px,1fr) 54px;gap:10px;align-items:center;margin:10px 0}'+
      '.pv-mixrow.master{margin-top:16px;padding:12px 9px;border:1px solid rgba(94,224,138,.35);border-radius:10px;background:rgba(94,224,138,.08)}'+
      '.pv-mixrow label{font-size:12px;color:#b9b2d4}.pv-mixrow.master label{font-size:15px;color:#fff;font-weight:900}.pv-mixrow.master input{accent-color:#5ee08a}'+
      '.pv-mute{width:32px;height:32px;border:0;border-radius:8px;background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:15px}.pv-mute.on{color:#ff7272;background:rgba(255,93,93,.15)}'+
      '.pv-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:13px 16px;background:rgba(0,0,0,.34);border-top:1px solid rgba(255,255,255,.08)}'+
      '.pv-version{border:0;background:transparent;color:#a69fc2;font:700 11px var(--pixel);letter-spacing:.3px;cursor:pointer;padding:8px 4px}.pv-version:hover{color:#fff;text-decoration:underline}'+
      '.pv-spacer{flex:1}.pv-bic{width:40px;height:40px;border-radius:11px;border:0;background:rgba(255,255,255,.07);color:#d8d1ee;font-size:17px;cursor:pointer}'+
      '.pv-bic:active{transform:scale(.94)}'+
      '@media(max-width:580px){.pv-body{padding:18px}.pv-mixrow{grid-template-columns:32px 104px minmax(110px,1fr) 50px}.pv-tempo{grid-template-columns:auto auto minmax(90px,1fr) auto 66px}}';
    document.head.appendChild(css);

    function esc(x){ var d=document.createElement('div'); d.textContent=String(x==null?'':x); return d.innerHTML; }
    var mixRows=MIX_ROWS.map(function(r){ return '<div class="pv-mixrow" data-role="'+r[0]+'"><button class="pv-mute" title="Mute '+esc(r[1])+'">🔊</button><label>'+esc(r[1])+'</label><input type="range" min="0" max="2" step="0.05" value="1"><span class="pv-mixval">100%</span></div>'; }).join('');
    host.innerHTML=
      '<div class="pv">'+
      ' <div class="pv-scroll"><div class="pv-body">'+
      '    <div class="pv-transport">'+
      '      <button class="pv-tb" id="pvPrev" title="Previous track">⏮</button>'+
      '      <button class="pv-tb play" id="pvPlay" title="Play / Pause">▶</button>'+
      '      <button class="pv-tb" id="pvNext" title="Next track">⏭</button></div>'+
      '    <section class="pv-control-section"><div class="pv-mixhead"><span>VOLUME</span></div>'+
      '      <div class="pv-mixrow master" data-role="master"><button class="pv-mute" title="Mute volume">🔊</button><label>Volume</label><input type="range" min="0" max="2" step="0.05" value="0.4"><span class="pv-mixval">40%</span></div></section>'+
      '    <section class="pv-control-section"><div class="pv-mixhead pv-levelhead"><span>LEVELS</span><button class="pv-reset" id="pvReset">reset levels</button></div>'+
             mixRows+
      '    </section>'+
      '    <section class="pv-control-section"><div class="pv-mixhead"><span>TEMPO · BPM</span></div>'+
      '      <div class="pv-tempo"><button class="pv-auto" id="pvTempoAuto">auto</button><button class="pv-step" id="pvTempoMinus">−</button><input id="pvTempo" type="range" min="60" max="220" step="1" value="130"><button class="pv-step" id="pvTempoPlus">+</button><span class="pv-temporead" id="pvTempoRead">130 BPM</span></div></section>'+
      '  </div></div>'+
      '  <div class="pv-bar">'+
      '    <button class="pv-version" id="pvVersion" title="Check for updates">v?</button><span class="pv-spacer"></span>'+
      '    <button class="pv-bic" id="pvGear" title="Desktop settings">⚙</button>'+
      '    <button class="pv-bic" id="pvQuit" title="Quit Chiptunes.app">⏻</button>'+
      '  </div>'+
      '</div>';

    var N=window.RRRNative||{};
    var _state={ appVersion:'?', audioMuted:false, volume:.4, station:'st-any', nowPlaying:null, update:{phase:'idle'} };
    var _lastNonZero={};
    function ctl(action, extra){ try{ if(N.control){ var p=N.control(Object.assign({action:action}, extra||{})); if(p&&typeof p.catch==='function')p.catch(function(e){console.error('[desktop] control failed:',e);}); return p; } }catch(e){console.error('[desktop] control failed:',e);} return null; }
    document.getElementById('pvPrev').onclick=function(){ ctl('transport',{dir:'prev'}); };
    document.getElementById('pvPlay').onclick=function(){ ctl('transport',{dir:'toggle'}); };
    document.getElementById('pvNext').onclick=function(){ ctl('transport',{dir:'next'}); };
    document.getElementById('pvGear').onclick=function(){ ctl('openWindow'); };
    document.getElementById('pvQuit').onclick=function(){ ctl('confirmQuit'); };
    document.getElementById('pvVersion').onclick=function(){ ctl('checkForUpdates'); };

    function setMixRow(row,value,send){
      var role=row.getAttribute('data-role'), slider=row.querySelector('input'), read=row.querySelector('.pv-mixval'), mute=row.querySelector('.pv-mute');
      value=Math.max(0,Math.min(2,Number(value==null?1:value)));
      if(value>0.001)_lastNonZero[role]=value;
      if(document.activeElement!==slider)slider.value=String(value);
      read.textContent=Math.round(value*100)+'%'; mute.textContent=value<=0.001?'🔇':'🔊'; mute.classList.toggle('on',value<=0.001);
      if(send)ctl('setMix',{role:role,value:value});
    }
    Array.prototype.forEach.call(host.querySelectorAll('.pv-mixrow'),function(row){
      var role=row.getAttribute('data-role'), slider=row.querySelector('input'), mute=row.querySelector('.pv-mute');
      slider.oninput=function(){ setMixRow(row,+slider.value,true); };
      mute.onclick=function(){ var cur=+slider.value||0; setMixRow(row,cur>0.001?0:(_lastNonZero[role]||1),true); };
    });
    document.getElementById('pvReset').onclick=function(){ MIX_ROWS.forEach(function(r){ var row=host.querySelector('.pv-mixrow[data-role="'+r[0]+'"]'); if(row)setMixRow(row,1,false); }); ctl('resetMix'); };
    function tempoValue(){ var np=_state.nowPlaying||{}, t=np.tempo||{}; return t.manual!=null?+t.manual:(t.native!=null?+t.native:(np.bpm||130)); }
    function setTempo(value){ var sl=document.getElementById('pvTempo'); value=Math.max(+sl.min,Math.min(+sl.max,Math.round(value))); sl.value=String(value); document.getElementById('pvTempoRead').textContent=value+' BPM'; ctl('setTempo',{value:value}); }
    document.getElementById('pvTempo').oninput=function(){ setTempo(+this.value); };
    document.getElementById('pvTempoAuto').onclick=function(){ ctl('setTempo',{value:null}); };
    document.getElementById('pvTempoMinus').onclick=function(){ setTempo(tempoValue()-1); };
    document.getElementById('pvTempoPlus').onclick=function(){ setTempo(tempoValue()+1); };

    function apply(s){
      if(!s) return; _state=Object.assign(_state,s);
      var update=_state.update||{}, version='v'+String(_state.appVersion||'?');
      if(update.phase==='checking')version+=' · checking…';
      else if(update.phase==='downloading')version+=' · downloading…';
      else if(update.phase==='ready')version+=' · update ready';
      document.getElementById('pvVersion').textContent=version;
      var np=s.nowPlaying||_state.nowPlaying||{};
      document.getElementById('pvPlay').innerHTML=np.playing?'⏸':'▶';
      var mix=Object.assign({master:s.volume==null ? .4 : s.volume,lead:1,bass:1,kick:1,snare:1,hat:1,arp:1,pad:1,fx:1},np.mix||{});
      if(s.volume!=null)mix.master=s.volume;
      Array.prototype.forEach.call(host.querySelectorAll('.pv-mixrow'),function(row){ setMixRow(row,mix[row.getAttribute('data-role')],false); });
      var tempo=np.tempo||{}, sl=document.getElementById('pvTempo');
      sl.min=String(tempo.min||60); sl.max=String(tempo.max||220);
      var tv=tempo.manual!=null?tempo.manual:(tempo.native!=null?tempo.native:(np.bpm||130));
      if(document.activeElement!==sl)sl.value=String(Math.max(+sl.min,Math.min(+sl.max,Math.round(tv))));
      document.getElementById('pvTempoRead').textContent=Math.round(tv)+' BPM';
      document.getElementById('pvTempoAuto').classList.toggle('on',tempo.manual==null);
      document.getElementById('pvTempoMinus').disabled=+sl.value<=+sl.min;
      document.getElementById('pvTempoPlus').disabled=+sl.value>=+sl.max;
    }
    if(N.onDesktopState) N.onDesktopState(apply);
    else if(N.desktopState) N.desktopState().then(apply)['catch'](function(){});
  };

  // ---- the Portal-style desktop control center (the app's main window: ?mode=browse) ----
  window._renderBrowse=function(){
    var host=document.getElementById('browse'); if(!host) return;
    var css=document.createElement('style');
    css.textContent=
      '#browse{font-family:var(--pixel);color:#f4f2ff;min-height:100vh;-webkit-user-select:none;user-select:none;padding:38px 28px}'+
      '.bz-wrap{max-width:900px;margin:0 auto}'+
      '.bz-h1{font-size:28px;letter-spacing:.5px;font-weight:900}'+
      '.bz-tag{color:#b9b2d6;font-size:14px;margin:7px 0 30px}'+
      '.bz-sec{margin-bottom:26px}'+
      '.bz-sect{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#8f88b3;margin-bottom:11px}'+
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
      '.bz-range{display:flex;align-items:center;gap:11px;min-width:260px}.bz-range input{width:210px;accent-color:var(--accent2)}'+
      '.bz-read{width:44px;text-align:right;color:#d8fff3;font:700 12px var(--mono)}';
    document.head.appendChild(css);

    function esc(x){ var d=document.createElement('div'); d.textContent=String(x==null?'':x); return d.innerHTML; }
    function sw(on){ return '<div class="bz-sw'+(on?' on':'')+'"></div>'; }

    host.innerHTML=
      '<div class="bz-wrap">'+
      '  <div class="bz-h1">Desktop Settings</div>'+
      '  <div class="bz-tag">Choose where the animated wallpaper appears and how much power it uses.</div>'+
      '  <div class="bz-sec"><div class="bz-sect">Displays</div><div id="bzDisplays"></div></div>'+
      '  <div class="bz-sec"><div class="bz-sect">Wallpaper</div><div id="bzSettings"></div></div>'+
      '</div>';

    var N=window.RRRNative||{};
    var _state={ wallpaperEnabled:false, motionFrozen:false, fpsCap:30, powerSaver:false, openAtLogin:false,
      systemAudioReactive:false,systemAudioStatus:'off',scanlineStrength:.3,displays:[] };
    function ctl(a,x){ try{ if(N.control){ var p=N.control(Object.assign({action:a},x||{})); if(p&&typeof p.catch==='function')p.catch(function(e){console.error('[desktop] control failed:',e);}); } }catch(e){console.error('[desktop] control failed:',e);} }

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
        '<div class="bz-set"><div class="sl"><b>Animated wallpaper</b><div class="sd">Run the visuals behind your desktop icons</div></div><div id="bzWallpaper">'+sw(s.wallpaperEnabled)+'</div></div>'+
        '<div class="bz-set"><div class="sl"><b>Freeze motion</b><div class="sd">Hold the current frame while the radio keeps playing</div></div><div id="bzFreeze">'+sw(s.motionFrozen)+'</div></div>'+
        '<div class="bz-set"><div class="sl"><b>Frame rate</b><div class="sd">Higher = smoother, more power</div></div><div class="bz-seg" id="bzFps">'+[15,30,60].map(function(f){return '<button data-f="'+f+'"'+(s.fpsCap===f?' class="on"':'')+'>'+f+'</button>';}).join('')+'</div></div>'+
        '<div class="bz-set"><div class="sl"><b>Battery saver</b><div class="sd">Drop to 15fps on battery</div></div><div id="bzPower">'+sw(s.powerSaver)+'</div></div>'+
        '<div class="bz-set"><div class="sl"><b>React to system audio</b><div class="sd">Use Mac audio for the wallpaper beat and BPM. Analysis only; never recorded or transmitted.'+(s.systemAudioStatus==='error'?' Permission or capture error. Toggle off and on to retry.':'')+'</div></div><div id="bzSystemAudio">'+sw(s.systemAudioReactive)+'</div></div>'+
        '<div class="bz-set"><div class="sl"><b>Scanline strength</b><div class="sd">Control the CRT scanline overlay</div></div><div class="bz-range"><input id="bzScanlines" type="range" min="0" max="1" step="0.01" value="'+Number(s.scanlineStrength==null ? .3 : s.scanlineStrength)+'"><span class="bz-read" id="bzScanRead">'+Math.round(Number(s.scanlineStrength==null ? .3 : s.scanlineStrength)*100)+'%</span></div></div>'+
        '<div class="bz-set"><div class="sl"><b>Launch at login</b><div class="sd">Start the wallpaper when you log in</div></div><div id="bzLogin">'+sw(s.openAtLogin)+'</div></div>';
      document.querySelector('#bzWallpaper .bz-sw').onclick=function(){ ctl('setWallpaperEnabled',{value:!s.wallpaperEnabled}); };
      document.querySelector('#bzFreeze .bz-sw').onclick=function(){ if(s.wallpaperEnabled) ctl('setMotionFrozen',{value:!s.motionFrozen}); };
      Array.prototype.forEach.call(el.querySelectorAll('#bzFps button'), function(b){ b.onclick=function(){ ctl('setFps',{value:+b.getAttribute('data-f')}); }; });
      document.querySelector('#bzPower .bz-sw').onclick=function(){ ctl('setPowerSaver',{value:!s.powerSaver}); };
      document.querySelector('#bzSystemAudio .bz-sw').onclick=function(){ ctl('setSystemAudioReactive',{value:!s.systemAudioReactive}); };
      document.getElementById('bzScanlines').oninput=function(){ document.getElementById('bzScanRead').textContent=Math.round(+this.value*100)+'%'; ctl('setScanlineStrength',{value:+this.value}); };
      document.querySelector('#bzLogin .bz-sw').onclick=function(){ ctl('setLogin',{value:!s.openAtLogin}); };
    }

    var _structKey='';
    function apply(s){
      if(!s) return; _state=Object.assign(_state,s);
      var key=JSON.stringify({w:_state.wallpaperEnabled,z:_state.motionFrozen,f:_state.fpsCap,p:_state.powerSaver,
        a:_state.systemAudioReactive,as:_state.systemAudioStatus,l:_state.openAtLogin,d:_state.displays});
      if(key!==_structKey){ _structKey=key;
        renderDisplays(_state.displays);
        renderSettings(_state);
      }
    }
    if(N.onDesktopState) N.onDesktopState(apply);
    else if(N.desktopState) N.desktopState().then(apply)['catch'](function(){});
  };
})();
