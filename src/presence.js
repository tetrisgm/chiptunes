// ===== presence.js — the live listener count (and a free clock check). =====
// One WebSocket to the radio-presence worker (Cloudflare DO, radio.ramine.net/api/presence).
// The server pushes {type:'count', listeners, now}: `listeners` decorates the LIVE badge,
// `now` corrects ONLY gross client-clock skew (>15s) in the schedule math via LiveCtl.
// STRICTLY decoration: the radio plays identically when this never connects — every failure
// path here ends in "badge shows plain LIVE", never in touching playback.
var Presence = (function(){
'use strict';
var ws=null, tries=0, timer=0, closed=false, pinger=0, stableT=0;
var API_HOST='radio.ramine.net';   // the worker route lives on the prod domain; localhost/pages.dev connect cross-origin

function _url(){
  try{
    if(location.hostname==='radio.ramine.net') return 'wss://radio.ramine.net/api/presence';
  }catch(e){}
  return 'wss://'+API_HOST+'/api/presence';
}
function _apply(msg){
  if(!msg || msg.type!=='count') return;
  var n=(typeof msg.listeners==='number' && msg.listeners>=0) ? msg.listeners : null;
  window._presenceCount=n;
  if(typeof msg.now==='number' && isFinite(msg.now)){
    var skew=msg.now-Date.now();
    try{ if(typeof LiveCtl!=='undefined' && LiveCtl.setClockOffset) LiveCtl.setClockOffset(skew); }catch(e){}
  }
  // don't churn the DOM for a hidden/dormant tab (the count is invisible then anyway)
  try{
    var dormant=(typeof _backgroundUiDormant==='function') && _backgroundUiDormant();
    if(!dormant && typeof _updatePlaybar==='function' && typeof Audio!=='undefined' && Audio.started) _updatePlaybar();
  }catch(e2){}
}
function _schedule(){
  if(closed || timer) return;
  var backoff=Math.min(60000, 1000*Math.pow(2, Math.min(tries, 6)));
  var jitter=backoff*(0.5+Math.random()*0.5);                    // jittered backoff: a DO deploy drops everyone at once
  timer=setTimeout(function(){ timer=0; connect(); }, jitter);
}
function _clearTimers(){ if(pinger){ clearInterval(pinger); pinger=0; } if(stableT){ clearTimeout(stableT); stableT=0; } }
function connect(){
  if(closed || ws) return;
  var W=(typeof WebSocket!=='undefined')?WebSocket:null;
  if(!W){ window._presenceCount=null; return; }
  try{ ws=new W(_url()); }catch(e){ ws=null; tries++; _schedule(); return; }
  ws.onmessage=function(ev){ try{ _apply(JSON.parse(ev.data)); }catch(e){} };
  ws.onopen=function(){
    // reset backoff only after the socket PROVES stable (5s) — an accept-then-close flap would
    // otherwise reset tries=0 on every open and become a tight 1-2s reconnect loop.
    stableT=setTimeout(function(){ tries=0; stableT=0; }, 5000);
    // keepalive: the worker auto-answers 'ping'->'pong' WITHOUT waking the DO, so a stable set of
    // listeners (which get no join/leave broadcasts) doesn't get culled as idle and churn the count.
    pinger=setInterval(function(){ try{ if(ws && ws.readyState===1) ws.send('ping'); }catch(e){} }, 30000);
  };
  ws.onclose=function(){ _clearTimers(); ws=null; window._presenceCount=null; tries++; _schedule(); };
  ws.onerror=function(){ try{ ws && ws.close(); }catch(e){} };
}
function start(){ closed=false; connect(); }
function stop(){ closed=true; _clearTimers(); if(timer){ clearTimeout(timer); timer=0; }
  if(ws){ try{ ws.close(); }catch(e){} ws=null; } window._presenceCount=null; }

window._presenceCount=null;
return { start:start, stop:stop, count:function(){ return window._presenceCount; } };
})();
