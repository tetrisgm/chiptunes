// ===== composer.js — rrr_core: the built-in generative chiptune composer (the reference composer PACK). =====
// Registers CT_COMPOSERS.rrr_core = { V:3, compile(token)->Score, fingerprint(token)->Fingerprint }.
// PURE by contract: no DOM, no WebAudio, no Math.random, no Date. Same token -> identical Score.
// All randomness flows from per-stage streams: mulberry32(hash32('rrr3:'+V+':'+token+':'+stage)).
//
// Score (v3):
//   { v:3, token, bpm, swing, keyPc, mode:[semitone intervals], gainScalar,
//     palette:{ voices:{lead,bass,chord,pad?,counter?}, percs:{kick,snare,hat,fx}, echo, panLayout, samples? },
//     sections:[{atBar,bars,role:'groove|flow|bridge|break|build|drop|outro',e}],
//     totalBars, endsCleanAtBeat,
//     events:[{tBeat,dur,ch,midi?,vel,artic?,seed}] }        // sorted by tBeat
//   ch: lead|bass|chord|pad|counter|kick|snare|hat|fx. swing is applied by the ENGINE to off-16ths
//   (events are on a straight grid). Hat events with dur>=0.4 beats are OPEN hats (percs.hat.openDecay).
// These mirror the worklet's VoiceDef/PercDef contract (audio.js buildPaletteMsg maps wave->osc and
// baseMidi->baseFreq; everything else must already match the worklet field names/nesting).
// VoiceDef: { id, wave:'pulse|tri|saw|sine|wavetable|sample', duty?, partials?, crunchBits?, sampleId?,
//   env:{a,d,s,r}, filter?:{cutHz,q,envAmt,envT}, vib?:{rate,depth(SEMITONES),delay},
//   chip?:{arpHz,dutyEnv[],dutyEnvLoop,tickHz}, glide?, detune?, sub?, gainMul, pan, sendEcho }
// PercDef:  { id, kind:'kick|snare|hat|tom|zap', tone:{freq,end,sweepT,level,decT,osc},
//   noise?:{mode,period,level,decT,hp}, click?:{level,decT}, openDecay?, gainMul, pan, sendEcho }
// EchoDef:  { beats, fb, level, damp:0..1, spreadMs, pingPong }   panLayout: { mode:'soft|hardLCR', pos:{role:-1..1} }
// Sample:   { id, rate, baseMidi, loop?:{start,end}, pcm:Float32Array }   (synthesized in compile)
// Fingerprint: { bpm, keyPc, brightness, waveClass, grooveFamily, density, energyPeak, echoDepth, leadMode }
(function(){
'use strict';
var G = typeof globalThis!=='undefined' ? globalThis : (typeof window!=='undefined' ? window : this);
var V = 3;

// ---------- deterministic base ----------
function hash32(str){ str=''+str; var h=2166136261>>>0;
  for(var i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function mulberry32(a){ a=a>>>0; return function(){ a=(a+0x6D2B79F5)|0;
  var t=Math.imul(a^(a>>>15), 1|a); t=(t+Math.imul(t^(t>>>7), 61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function R(token,stage){ return mulberry32(hash32('rrr3:'+V+':'+token+':'+stage)); }
function clamp(x,a,b){ return x<a?a:(x>b?b:x); }
function cl01(x){ return clamp(x,0,1); }
function pick(r,a){ return a[(r()*a.length)|0]; }
function wpick(r,pairs){ var tot=0,i; for(i=0;i<pairs.length;i++) tot+=pairs[i][1];
  var x=r()*tot; for(i=0;i<pairs.length;i++){ x-=pairs[i][1]; if(x<=0) return pairs[i][0]; } return pairs[pairs.length-1][0]; }
function rint(r,a,b){ return a+Math.min(b-a,(r()*(b-a+1))|0); }
function gauss(r,mu,sig){ var u=r(); if(u<1e-12)u=1e-12; return mu+sig*Math.sqrt(-2*Math.log(u))*Math.cos(6.28318530718*r()); }
function rr(x){ return Math.round(x*100)/100; }
function rd3(x){ return Math.round(x*1000)/1000; }
function uniqSort(a){ var s={},o=[],i; for(i=0;i<a.length;i++) if(!s[a[i]]){ s[a[i]]=1; o.push(a[i]); } o.sort(function(x,y){return x-y;}); return o; }
function takeSome(r,pool,n){ pool=pool.slice(); var out=[]; while(n-->0&&pool.length) out.push(pool.splice((r()*pool.length)|0,1)[0]); return out; }
function normToken(tok){ tok=String(tok==null?'':tok).toLowerCase().trim();
  if(tok.indexOf('rrr_core.')===0) tok=tok.slice(9); return tok||'silent-fallback-token'; }

// ---------- stage A: palette — continuous sampling of the timbre space ----------
var WT_RECIPES=[
  {id:'organ', p:[1,0.62,0.82,0.3,0.5,0.16,0.3,0.1]},
  {id:'hollow',p:[1,0.02,0.56,0.02,0.3,0.01,0.13,0.05]},
  {id:'glass', p:[1,0.04,0.4,0.02,0.2,0.02,0.34,0.02,0.15]},
  {id:'reed',  p:[1,0.7,0.36,0.55,0.2,0.3,0.12,0.15]},
  {id:'soft',  p:[1,0.46,0.27,0.15,0.08,0.04]},
  {id:'bell',  p:[1,0.32,0.02,0.5,0.02,0.02,0.4,0.02,0.02,0.22]}
];
function mkPartials(r,recipe,brightness){
  var ro=Math.max(0,0.55*(1-brightness)), out=[], i;
  for(i=0;i<recipe.p.length;i++) out.push(rd3(clamp(recipe.p[i]*Math.pow(i+1,-ro)*(0.78+0.44*r()),0,1)));
  out[0]=1; return out;
}
function famOf(v){ if(!v) return 'none';
  if(v.wave==='pulse') return 'pulse';
  if(v.wave==='saw') return 'saw';
  if(v.wave==='wavetable'||v.wave==='sample') return 'wave';
  return 'wave'; }   // tri/sine read as soft "wave" class
function stPalette(token){
  var r=R(token,'A');
  var brightness=cl01((r()+r())/2 + (r()-0.5)*0.24);
  var grit=cl01(0.15+0.7*r() + (0.5-brightness)*0.25);
  var era=wpick(r,[['nes',0.3],['gb',0.27],['sega',0.2],['snes',0.23]]);
  var eraAmt=0.5+0.5*r();
  // LEAD-PRESENCE MOOD (deterministic per token): 'full' = hook-driven as ever;
  // 'sparse' = ~a third of the melody at half volume (lead as occasional color);
  // 'none' = instrumental groove — the accompaniment IS the track (the owner:
  // "it's better in the background with the lead muted" — now a first-class
  // genre). The radio queue mixes all three; Radio.setMood pins one.
  var leadMode=wpick(r,[['full',0.38],['sparse',0.32],['none',0.30]]);
  var DUTIES=[0.125,0.25,0.5];
  function leadFam(){ return wpick(r,[
    ['pulse',1.0+((era==='nes'||era==='gb')?0.9*eraAmt:0)],
    ['wavetable',0.5+(era==='snes'?0.75*eraAmt:(era==='gb'?0.3*eraAmt:0))],
    ['saw',0.42+(era==='sega'?0.95*eraAmt:0)+brightness*0.2],
    ['tri',0.22+(1-brightness)*0.3],
    ['sample',0.10+(era==='snes'?0.14*eraAmt:0)] ]); }
  function envP(a,d,s,rl,j){ j=j==null?0.35:j;
    return {a:rd3(a*(1-j/2+j*r())), d:rd3(d*(1-j/2+j*r())), s:rd3(cl01(s*(1-j/2+j*r()))), r:rd3(rl*(1-j/2+j*r()))}; }
  function filt(cutBase,cutSpan,q){ return {cutHz:Math.round(cutBase+cutSpan*Math.pow(brightness,1.15)*(0.7+0.6*r())),
    q:rd3(q), envAmt:rd3(0.6+2.4*r()), envT:rd3(0.06+0.5*r())}; }
  function gainFor(base,q,detune){ var g=base/(1+Math.max(0,(q||1)-1.2)*0.16); if(detune) g*=0.92; return rd3(g); }
  var samples=[];   // recipes; PCM baked in compile()
  function sampleRecipe(kind,role){
    var rate=16000, f0=kind==='choir'?220:(kind==='organette'?261.6:329.6);
    var cyc=Math.max(24,Math.round(rate/f0)); f0=rate/cyc;
    var rec={ id:'smp_'+role, kind:kind, rate:rate, f0:f0, cyc:cyc,
      ratio:rd3(kind==='bell'?3.01:(1.99+0.03*r())), fmI:rd3(1.2+2.4*r()), fmDec:rd3(4+8*r()),
      ampDec:rd3(2.2+3*r()), bright:rd3(0.3+0.6*r()),
      loop:(kind==='choir'||kind==='organette'), baseMidi:rd3(69+12*Math.log(f0/440)/Math.LN2) };
    samples.push(rec); return rec.id;
  }
  // --- lead ---
  var lf=leadFam(), lead={ id:'lead', wave:lf, gainMul:0, pan:0 };
  if(lf==='pulse'){ lead.duty=pick(r,DUTIES);
    if(r()<0.38){ var dsteps=[lead.duty, pick(r,DUTIES.filter(function(d){return d!==lead.duty;}))], dhz=pick(r,[7.5,15,30]);
      // one-shot duty sweep (LSDJ practice: duty envelopes are attack transients);
      // a LOOPING toggle at 7.5-30Hz was a rough AM buzz for the whole note.
      lead.chip={dutyEnv:dsteps, dutyEnvLoop:false, tickHz:clamp(dhz*dsteps.length,5,240)}; } }
  if(lf==='wavetable'){ var rec=pick(r,WT_RECIPES); lead.partials=mkPartials(r,rec,brightness);
    if(era==='gb'||grit>0.62) lead.crunchBits=4; }
  if(lf==='sample') lead.sampleId=sampleRecipe(r()<0.6?'fmpluck':'bell','lead');
  var acid = lf==='saw' && r()<0.18;
  var lq = acid? rd3(5+4*r()) : rd3(0.7+1.9*r());
  lead.env=envP(0.005,0.12,0.78,0.08);
  lead.filter=filt(acid?500:1000, acid?2600:7000, lq);
  // vib depth is SEMITONES in the worklet contract — real chip vibrato is subtle
  // (0.08–0.38 st). This was 8–38 (intended cents), which the worklet clipped to
  // 12 and played as SEMITONES: a ±octave 4–7Hz siren on every held lead note.
  lead.vib={rate:rd3(4.2+2.6*r()), depth:rd3(0.08+((era==='gb')?0.30:0.24)*r()), delay:rd3(0.05+0.14*r())};
  if(acid){ lead.glide=rd3(0.04+0.05*r()); lead.env.s=rd3(0.5); }
  if(r()<0.22 && lf!=='sample') lead.detune=Math.round(6+16*r());
  lead.gainMul=gainFor(0.5,lq,lead.detune); lead.sendEcho=rd3(0.1+0.2*r());
  // --- chord (the LSDJ arp/stab voice) ---
  var cfam=wpick(r,[['pulse',1.1],['wavetable',0.6+(era==='snes'?0.5:0)],['saw',0.35+(era==='sega'?0.5:0)]]);
  var chord={ id:'chord', wave:cfam, gainMul:0, pan:0 };
  if(cfam==='pulse') chord.duty=pick(r,[0.25,0.25,0.5,0.125]);
  if(cfam==='wavetable'){ chord.partials=mkPartials(r,pick(r,WT_RECIPES),brightness); if(era==='gb') chord.crunchBits=4; }
  var cq=rd3(0.8+1.6*r());
  chord.env=envP(0.003,0.08,0.12,0.05);
  chord.filter=filt(900,6000,cq);
  chord.chip={arpHz:wpick(r,[[60,1.2],[30,1]])};   // arp rate lives under chip.* in the worklet contract
  chord.gainMul=gainFor(0.4,cq); chord.sendEcho=rd3(0.12+0.22*r());
  // --- bass ---
  var bfam=wpick(r,[['tri',1.0+(era==='nes'?0.6:0)],['pulse',0.5],['saw',0.35+(era==='sega'?0.55:0)],['sine',0.3],['wavetable',0.25]]);
  var bass={ id:'bass', wave:bfam, gainMul:0, pan:0 };
  if(bfam==='pulse') bass.duty=pick(r,[0.25,0.5]);
  if(bfam==='wavetable') bass.partials=mkPartials(r,pick(r,[WT_RECIPES[0],WT_RECIPES[5]]),0.3);
  var bacid = bfam==='saw' && r()<0.3;
  var bq = bacid? rd3(4+5*r()) : rd3(0.7+1.2*r());
  bass.env=envP(0.005,0.2,0.55,0.06);
  bass.filter={cutHz:Math.round(bacid?(380+320*r()):(320+520*r())), q:bq, envAmt:rd3(bacid?2.2+1.6*r():0.8+0.8*r()), envT:rd3(0.1+0.4*r())};
  if(bacid) bass.glide=rd3(0.03+0.04*r());
  if(bfam==='sine'||r()<0.25) bass.sub=rd3(0.15+0.2*r());
  bass.gainMul=gainFor(0.62,bq); bass.sendEcho=0.02;
  // --- pad / counter (optional) ---
  var pad=null, counter=null;
  if(r() < 0.5+(era==='snes'?0.22:0)-(era==='gb'?0.15:0)){
    var pfam=wpick(r,[['wavetable',1],['pulse',0.6],['saw',0.5],['sine',0.3],['sample',0.18+(era==='snes'?0.12:0)]]);
    pad={ id:'pad', wave:pfam, gainMul:0, pan:0 };
    if(pfam==='pulse'){ pad.duty=0.5; pad.detune=Math.round(6+10*r()); }
    if(pfam==='saw'){ pad.detune=Math.round(8+14*r()); }
    if(pfam==='wavetable') pad.partials=mkPartials(r,pick(r,[WT_RECIPES[4],WT_RECIPES[0],WT_RECIPES[3]]),brightness*0.8);
    if(pfam==='sample') pad.sampleId=sampleRecipe(r()<0.55?'choir':'organette','pad');
    pad.env={a:rd3(0.25+0.35*r()), d:rd3(0.4+0.3*r()), s:rd3(0.8+0.12*r()), r:rd3(0.4+0.3*r())};
    pad.filter=filt(700,3600,1);
    pad.gainMul=gainFor(0.3,1,pad.detune); pad.sendEcho=rd3(0.3+0.25*r());
  }
  if(r()<0.55){
    counter={ id:'counter', wave: lf==='pulse'?'pulse':wpick(r,[['pulse',1],['wavetable',0.6],['tri',0.5]]), gainMul:0, pan:0 };
    if(counter.wave==='pulse') counter.duty=pick(r,DUTIES.filter(function(d){ return d!==lead.duty; }));
    if(counter.wave==='wavetable') counter.partials=mkPartials(r,pick(r,WT_RECIPES),brightness);
    counter.env=envP(0.005,0.1,0.6,0.09);
    counter.filter=filt(800,5200,1);
    counter.vib={rate:rd3(4+2*r()), depth:rd3(0.06+0.14*r()), delay:rd3(0.08+0.12*r())};   // semitones (see lead.vib)
    counter.gainMul=0.34; counter.sendEcho=rd3(0.14+0.2*r());
  }
  // exotic-budget: at most 2 wavetable/sample melodic voices; extras demote to pulse
  var vs=[lead,chord,pad,counter], exotic=0, i2;
  for(i2=0;i2<vs.length;i2++){ var vv=vs[i2]; if(!vv) continue;
    if(vv.wave==='wavetable'||vv.wave==='sample'){ exotic++;
      if(exotic>2){ vv.wave='pulse'; vv.duty=vv.duty||0.25; delete vv.partials; delete vv.crunchBits; delete vv.sampleId; exotic--; } } }
  samples=samples.filter(function(s){ return (lead.sampleId===s.id)||(pad&&pad.sampleId===s.id); });
  // --- percussion — per-track drum personality. Emits the worklet PercDef contract directly
  //     (tone/noise/click nested + gainMul), anchored near the engine's known-good defaults. ---
  // The 7-stage LFSR ("short mode") is the famously METALLIC GB ring — great as
  // an occasional hat color, but a whole track of mode-7 snares reads as a cheap
  // metal "tshk" hammering every backbeat. Snare bodies default to white noise
  // (mode 15) with short mode only as a sometimes-GB accent; mode-7 hats avoid
  // period 0 (its brightest, ringiest setting).
  var snareMode=(era==='gb'&&r()<0.35)?7:15;
  var hatMode=(r()<0.6?7:15);
  var percs={
    kick:{ id:'kick', kind:'kick',
      tone:{ freq:Math.round(150+180*r()), end:Math.round(40+18*r()), sweepT:rd3(0.04+0.05*r()), level:rd3(0.95+0.35*r()), decT:rd3(0.075+0.06*r()), osc:'sine' },
      click:{ level:rd3(era==='snes'?0.06+0.14*r():0.18+0.4*r()) },
      gainMul:1, pan:0, sendEcho:0 },
    snare:{ id:'snare', kind:'snare',
      tone:{ freq:Math.round(165+85*r()), end:Math.round(140+40*r()), sweepT:0.02, level:rd3(0.16+0.2*r()+(era==='snes'?0.1:0)), decT:rd3(0.03+0.03*r()), osc:'sine' },
      noise:{ mode:snareMode, period:2+((r()*5)|0), level:rd3(0.72+0.28*r()), decT:rd3(0.08+0.09*r()), hp:rd3(0.3+0.35*r()) },
      click:{ level:rd3(0.1+0.2*r()) },
      gainMul:1, pan:rd3((r()<0.5?-1:1)*0.06), sendEcho:rd3(0.04+0.1*r()) },
    hat:{ id:'hat', kind:'hat',
      tone:{ level:0 },
      noise:{ mode:hatMode, period:hatMode===7?1+((r()*2)|0):(r()<0.55?0:1), level:rd3(0.62+0.28*r()), decT:rd3(0.016+0.03*r()), hp:rd3(0.6+0.32*r()) },
      click:{ level:rd3(0.25+0.2*r()) }, openDecay:rd3(0.15+0.2*r()),
      gainMul:rd3(0.7+0.25*r()), pan:rd3((r()<0.5?-1:1)*(0.22+0.2*r())), sendEcho:0 },   // hats wider (width gap vs refs)
    fx:{ id:'fx', kind:'zap',
      tone:{ freq:Math.round(240+220*r()), end:Math.round(2400+2400*r()), sweepT:rd3(0.16+0.16*r()), level:rd3(0.5+0.24*r()), decT:rd3(0.2+0.2*r()), osc:'saw' },
      noise:{ mode:15, period:3, level:rd3(0.08+0.16*r()), decT:rd3(0.2+0.2*r()) },
      click:{ level:0 },
      gainMul:0.5, pan:0, sendEcho:rd3(0.1+0.15*r()) }
  };
  // --- echo + pans --- (worklet-native EchoDef: level, damp 0..1 dark<-..->0 bright, spreadMs.
  //     The old {wet, dampHz, spread} fields were silently ignored: level stuck at the 0.2
  //     default and damp clipped to 1 = repeats lowpassed to mud.)
  var wet=cl01((0.12+0.34*r())*(era==='nes'?0.55:(era==='gb'?0.75:(era==='snes'?1.25:1))));
  var dampHz=2200+4500*r();   // intended repeat brightness, mapped to the worklet's 0..1 damp
  // WIDTH: measured against the reference records, renders were 3-6x narrower
  // than EVERY ref (side/mid 0.055 vs Chipzel 0.173 / Disasterpeace 0.318 —
  // zero overlap between distributions). Chipzel's LSDJ hard-pan "big" reads
  // instantly. Wider soft pans, more ping-pong echo, more echo spread.
  var echo={ beats:wpick(r,[[0.375,1.2],[0.5,1],[0.75,0.6],[0.25,0.4]]), fb:rd3(0.22+0.3*r()),
    level:rd3(clamp(wet,0.06,0.5)), damp:rd3(clamp(1-(dampHz-1500)/7000,0.15,0.85)),
    spreadMs:Math.round(10+(0.3+0.6*r())*30), pingPong:(r()<0.45) };
  var hard = r() < (era==='gb'?0.3:0.1);
  var sgn = r()<0.5?1:-1;
  var pos={ lead:0, counter:rd3(sgn*(hard?1:0.5+0.2*r())), chord:rd3(-sgn*(hard?1:0.4+0.18*r())),
    bass:0, pad:rd3(sgn*(hard?0:0.3+0.16*r())), kick:0, snare:percs.snare.pan, hat:percs.hat.pan, fx:0 };
  var panLayout={ mode:hard?'hardLCR':'soft', pos:pos };
  if(counter) counter.pan=pos.counter;
  chord.pan=pos.chord; if(pad) pad.pan=pos.pad;
  // --- waveClass (fingerprint axis) ---
  var flead=famOf(lead), fchord=famOf(chord);
  var waveClass = (flead==='pulse'&&fchord==='pulse')?'pulse' : (flead==='saw')?'saw' : (flead==='wave'&&fchord==='wave')?'wave' : (flead===fchord?flead:'mixed');
  if(leadMode==='sparse'){ lead.gainMul=rd3(lead.gainMul*0.5); if(counter) counter.gainMul=rd3(counter.gainMul*0.5); }
  var voices={ lead:lead, bass:bass, chord:chord };
  if(pad) voices.pad=pad; if(counter) voices.counter=counter;
  return { brightness:brightness, grit:grit, era:era, waveClass:waveClass, leadMode:leadMode,
    voices:voices, percs:percs, echo:echo, panLayout:panLayout, sampleRecipes:samples };
}

// ---------- stage B: groove — tempo, family-constrained drums, hats, fills ----------
function tent(x,c,w){ return Math.max(0,1-Math.abs(x-c)/w); }
function stGroove(token,pal){
  var r=R(token,'B');
  var z=gauss(r,0,1), bpm=Math.round(clamp(138+22*z,92,188));
  var density=cl01(0.56 - z*0.13 + (r()-0.5)*0.3);
  var family=wpick(r,[
    ['four',     0.5+1.4*tent(bpm,124,26)],
    ['backbeat', 0.9+0.5*tent(bpm,132,45)],
    ['break',    0.15+1.3*tent(bpm,166,26)+0.4*tent(bpm,96,10)],
    ['halftime', 0.1+1.0*tent(bpm,158,30)*(1.2-density)],
    ['gallop',   0.1+1.1*tent(bpm,160,24)] ]);
  var swing=0;
  if((family==='four'||family==='backbeat') && bpm<=152 && r()<0.4) swing=0.08+0.14*r();
  else if(family==='break' && r()<0.15) swing=0.06+0.08*r();
  swing=Math.min(0.24,rr(swing));
  var humanize=rd3(0.002+0.007*r());
  function genPat(){
    var k=[], s=[], gs=[];
    if(family==='four'){ k=[0,4,8,12]; if(r()<0.6) s=[4,12]; if(r()<0.28) gs=[15]; }
    else if(family==='backbeat'){ k=[0].concat(takeSome(r,[6,7,8,10,14,3],1+(density>0.5?1:0)+(r()<0.4?1:0))); s=[4,12]; gs=takeSome(r,[7,9,15],r()<0.5?1:0); }
    else if(family==='break'){ k=[0].concat(takeSome(r,[3,6,7,10,11],1+(r()<0.6?1:0)+(density>0.6?1:0))); s=[4,12]; gs=takeSome(r,[7,9,14,15],(r()<0.7?1:0)+(r()<0.35?1:0)); }
    else if(family==='halftime'){ k=[0].concat(takeSome(r,[6,10,3],r()<0.55?1:0)); s=[8]; gs=takeSome(r,[14,15],r()<0.4?1:0); }
    else { k=[0,8].concat(r()<0.6?[3,11]:[6,14]); s=[4,12]; gs=takeSome(r,[7,15],r()<0.3?1:0); }
    return { k:uniqSort(k), s:uniqSort(s), gs:uniqSort(gs.filter(function(x){ return s.indexOf(x)<0; })),
      kv:rd3(0.88+0.08*r()), sv:rd3(0.66+0.1*r()), gv:rd3(0.24+0.1*r()) };
  }
  var patA=genPat(), patB=genPat(), guard=0;
  while(guard++<6 && JSON.stringify([patB.k,patB.s])===JSON.stringify([patA.k,patA.s])) patB=genPat();
  var hatSteps;
  if(density>0.64) hatSteps=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  else if(density>0.36) hatSteps=[0,2,4,6,8,10,12,14];
  else hatSteps=[2,6,10,14];
  hatSteps=hatSteps.filter(function(st){ return st===0 || r()>0.06; });
  var open=(family==='four'||family==='backbeat')&&r()<0.7 ? takeSome(r,[2,6,10,14],1+(r()<0.35?1:0)) : (r()<0.25?takeSome(r,[2,10],1):[]);
  var hatAcc = family==='four' ? [2,6,10,14] : (density>0.64?[0,4,8,12]:[0,8]);
  var accentSteps=uniqSort(patA.k.concat(family==='four'?[2,6,10,14]:patA.s));
  // fill vocabulary DERIVED from the track's own pattern (never a fixed-grid stamp)
  var fMap={}; patA.s.concat(patA.k).forEach(function(x){ if(x>=8) fMap[x]=1; });
  [10,12,13,14,15].forEach(function(x){ if(r()<0.75) fMap[x]=1; });
  // UNTUNED roll: pitched snares (midi on a noise sweep) read as a cheap
  // metallic "donk", and this fill fires at ~75% of section boundaries — it
  // was one of the most-repeated sounds in the mix. The velocity ramp alone
  // carries the crescendo.
  var cresc=Object.keys(fMap).map(Number).sort(function(a,b){return a-b;}).map(function(st){
    return { st:st, ch:'snare', vel:rd3(0.34+0.5*(st-8)/7), midi:null }; });
  var stMap={}; patA.k.forEach(function(x){ stMap[x>=8?x:x+8]=1; }); if(r()<0.7) stMap[14]=1;
  var stut=Object.keys(stMap).map(Number).sort(function(a,b){return a-b;}).map(function(st){
    return { st:st, ch:'kick', vel:rd3(0.6+0.02*(st-8)), midi:null }; });
  if(r()<0.6) stut.push({st:15,ch:'snare',vel:0.78,midi:null});
  var fills=[ {id:'cresc',steps:cresc}, {id:'stut',steps:stut}, {id:'cut',steps:[]} ];
  return { bpm:bpm, swing:swing, humanize:humanize, family:family, density:rd3(density),
    patA:patA, patB:patB, hat:{steps:hatSteps, open:uniqSort(open), acc:hatAcc, hv:rd3(0.2+0.1*r())},
    accentSteps:accentSteps, fills:fills };
}

// ---------- stage C: harmony — mode by brightness, degree-walk loop with cadence, voice-led chords ----------
var MODES=[
  {id:'major',    iv:[0,2,4,5,7,9,11], b:0.82, w:1.0},
  {id:'lydian',   iv:[0,2,4,6,7,9,11], b:0.92, w:0.35},
  {id:'mixo',     iv:[0,2,4,5,7,9,10], b:0.68, w:0.8},
  {id:'penta_maj',iv:[0,2,4,7,9],      b:0.78, w:0.4},
  {id:'dorian',   iv:[0,2,3,5,7,9,10], b:0.48, w:0.85},
  {id:'minor',    iv:[0,2,3,5,7,8,10], b:0.30, w:1.0},
  {id:'penta_min',iv:[0,3,5,7,10],     b:0.34, w:0.35},
  {id:'harm_min', iv:[0,2,3,5,7,8,11], b:0.22, w:0.35},
  {id:'mel_min',  iv:[0,2,3,5,7,9,11], b:0.42, w:0.3},
  {id:'phrygian', iv:[0,1,3,5,7,8,10], b:0.12, w:0.3},
  {id:'phryg_dom',iv:[0,1,4,5,7,8,10], b:0.18, w:0.12},
  {id:'hirajoshi',iv:[0,2,3,7,8],      b:0.26, w:0.05},
  {id:'kumoi',    iv:[0,2,3,7,9],      b:0.5,  w:0.05}
];
var PARENT={ penta_maj:'major', penta_min:'minor', hirajoshi:'minor', kumoi:'dorian' };
var DEG_NEXT={
  0:[[5,3],[3,3],[1,1.6],[4,1.6],[2,0.8],[6,0.5]],
  1:[[4,3],[6,1.2],[0,1],[3,1],[2,0.5]],
  2:[[5,2.5],[3,2],[1,1],[6,0.6]],
  3:[[4,2.6],[0,2],[1,1.2],[6,0.8],[5,1],[2,0.5]],
  4:[[0,3],[5,2],[3,1],[6,0.6]],
  5:[[3,2.6],[1,2],[4,2],[2,1],[0,1.2]],
  6:[[0,3],[5,1.5],[4,0.8]]
};
function ivOf(id){ for(var i=0;i<MODES.length;i++) if(MODES[i].id===id) return MODES[i].iv; return MODES[0].iv; }
function nearestForPc(pc,target,lo,hi){
  var m=target+((pc-((target%12)+12)%12)+12)%12, alt=m-12, out;
  out = (Math.abs(alt-target)<Math.abs(m-target) && alt>=lo) ? alt : m;
  while(out>hi) out-=12; while(out<lo) out+=12; return out;
}
function voiceChord(prev,deg,iv7,keyPc,seventh){
  var l=iv7.length, tones=seventh?[0,2,4,6]:[0,2,4], pcs=[], i;
  for(i=0;i<tones.length;i++) pcs.push(((keyPc+iv7[(deg+tones[i])%l])%12+12)%12);
  var out=[];
  if(!prev){
    var cur=nearestForPc(pcs[0],58,52,64); out.push(cur);
    for(i=1;i<pcs.length;i++){ cur=cur+((pcs[i]-cur%12)+12)%12 || cur+12; out.push(Math.min(76,cur)); }
  } else {
    for(i=0;i<pcs.length;i++) out.push(nearestForPc(pcs[i], prev[Math.min(i,prev.length-1)], 52,76));
    out.sort(function(a,b){return a-b;});
  }
  for(i=1;i<out.length;i++) while(out[i]<=out[i-1]) out[i]+=12;
  for(i=0;i<out.length;i++) out[i]=clamp(out[i],52,79);
  return out;
}
function stHarmony(token,pal){
  var r=R(token,'C');
  var keyPc=(r()*12)|0;
  var pairs=MODES.map(function(m){ return [m, m.w*Math.exp(-Math.pow(m.b-pal.brightness,2)/(2*0.2*0.2))]; });
  var mode=wpick(r,pairs);
  var chordIv = mode.iv.length>=7 ? mode.iv : ivOf(PARENT[mode.id]||'major');
  var hr=wpick(r,[[1,1.6],[2,0.8],[0.5,0.7]]);
  var seventh = r() < (0.16+(pal.era==='snes'?0.24:0)+(pal.brightness>0.6?0.06:0));
  var start=wpick(r,[[0,3],[5,1],[3,0.5]]);
  var loopA=[start], i;
  for(i=1;i<3;i++){
    var opts=DEG_NEXT[loopA[i-1]].filter(function(p){ return p[0]!==loopA[i-1]; });
    loopA.push(wpick(r,opts));
  }
  var cad=wpick(r,[[4,3],[3,1.5],[6,1],[1,1]]);
  if(cad===loopA[2]) cad=(cad===4?6:4);
  loopA.push(cad);
  if(start!==0 && loopA.indexOf(0)<0) loopA[1]=0;   // a loop must visit home
  var loopB=loopA.slice(), SUB={0:5,1:3,2:5,3:1,4:6,5:3,6:4};
  var vi=1+((r()*2)|0); loopB[vi]=SUB[loopB[vi]];
  if(r()<0.4){ var altCad=wpick(r,[[4,1],[6,1],[3,1]]); if(altCad!==loopB[2]) loopB[3]=altCad; }
  if(loopB.join()===loopA.join()) loopB[2]=SUB[loopB[2]];
  var voicA=[], voicB=[], pv=null;
  for(i=0;i<4;i++){ pv=voiceChord(pv,loopA[i],chordIv,keyPc,seventh); voicA.push(pv); }
  for(i=0;i<4;i++){ pv=voiceChord(pv,loopB[i],chordIv,keyPc,seventh); voicB.push(pv); }
  var cadPre = (chordIv===mode.iv||mode.iv.length>=7) ? 4 : 4;
  var voicPre=voiceChord(voicA[3],cadPre,chordIv,keyPc,false);
  var voicFin=voiceChord(voicPre,0,chordIv,keyPc,false);
  var lift = r()<0.22 ? (r()<0.6?1:2) : 0;
  return { keyPc:keyPc, mode:mode, chordIv:chordIv, hr:hr, seventh:seventh,
    loopA:loopA, loopB:loopB, voicA:voicA, voicB:voicB,
    cadPre:cadPre, voicPre:voicPre, voicFin:voicFin, lift:lift };
}

// ---------- stage D: motifs — hook from 3 generators, constraints by construction, derived figures ----------
var ONSETS=[
  {p:[0,3,6,8,11,14],   d:0.62, tag:'synco'},
  {p:[0,2,4,7,8,12,14], d:0.7,  tag:'run'},
  {p:[0,4,6,8,12],      d:0.42, tag:'anthem'},
  {p:[0,3,4,8,11,12],   d:0.6,  tag:'gallop'},
  {p:[0,2,3,8,10,11],   d:0.55, tag:'stutter'},
  {p:[0,6,8,14],        d:0.34, tag:'sparse'},
  {p:[0,2,6,8,10,14],   d:0.55, tag:'push'},
  {p:[0,4,8,10,12,14],  d:0.5,  tag:'drive'},
  {p:[0,3,8,11,12],     d:0.5,  tag:'latin'},
  {p:[0,2,4,8,10,12],   d:0.55, tag:'even'},
  {p:[0,1,4,8,9,12],    d:0.5,  tag:'doubleup'},
  {p:[0,4,7,8,12,15],   d:0.55, tag:'pickup'},
  // sparse cells — the real-library norm (GB pulse1 median 3.8 notes/bar,
  // p25 2.3; the old pool bottomed out at 4 and modal picks were 6)
  {p:[0,4,8],           d:0.24, tag:'triple'},
  {p:[0,3,8],           d:0.22, tag:'callshort'},
  {p:[0,6,10,12],       d:0.32, tag:'offcall'},
  {p:[0,2,8],           d:0.24, tag:'snap'}
];
// merged, de-platformed corpus interval cells (single weighted pool; scale-degree deltas)
var CELLS=[
  [[0,0,0,0],1.6],[[-1,-1,-1,-1],1.1],[[0,1,0,0],1],[[0,0,1,0],1],
  [[0,-1,0,0],1],[[0,0,-1,0],1],[[-1,0,0,0],0.8],[[0,0,0,1],0.8],
  [[0,2,-2,0],0.9],[[0,2,0,-2],0.9],[[0,-2,0,2],0.8],[[0,4,-2,-2],0.7],
  [[0,4,2,-2],0.7],[[0,2,4,2],0.8],[[-2,0,2,4],0.6],[[0,7,0,-7],0.45],
  [[-7,7,-7,7],0.3],[[0,3,-3,3],0.4],[[0,-3,3,-3],0.35]
];
var INTENTS=['rising','arch','question','call','pedal','zigzag','leapfill','gapfill'];
function contourMotif(r,intent,n){
  var m=[], v=0, i, h;
  function st(p,p2){ return (r()<p?1:0)+(r()<(p2||0)?1:0); }
  switch(intent){
    case 'rising':  v=-3; for(i=0;i<n;i++){ m.push(v); v+=st(0.75,0.3)-(r()<0.15?1:0); } break;
    case 'arch':    h=n>>1; v=0; for(i=0;i<n;i++){ m.push(v); v+=(i<h?st(0.85,0.3):-st(0.85,0.3)); } break;
    case 'question':v=0; for(i=0;i<n;i++){ m.push(v); v+=st(0.7)-(r()<0.2?1:0); } m[n-1]=4; break;
    case 'call':    for(i=0;i<n;i++) m.push([0,2,0,3][i%4]+(r()<0.3?(r()<0.5?1:-1):0)); break;
    case 'pedal':   for(i=0;i<n;i++) m.push(r()<0.7?0:(r()<0.5?-1:2)); break;
    case 'zigzag':  v=0; for(i=0;i<n;i++){ m.push(v); v+=(i%2===0?1:-1)*(1+st(0.5)); } break;
    case 'leapfill':m.push(0); v=4+st(0.6,0.4); for(i=1;i<n;i++){ m.push(v); v-=1+(r()<0.3?1:0); } break;
    default:        v=0; for(i=0;i<n;i++){ m.push(v); v+=(i===0?3+st(0.6):-st(0.7,0.2)); } break;   // gapfill
  }
  return m;
}
function corpusMotif(r,n){
  var m=[pick(r,[0,0,0,2,4,-2])], guard=0, i;
  while(m.length<n && guard++<24){
    var c=wpick(r,CELLS);
    for(i=0;i<c.length && m.length<n;i++) m.push(clamp(m[m.length-1]+c[i],-6,9));
  }
  while(m.length<n) m.push(m[m.length-1]);
  return m.slice(0,n);
}
function chordToneNear(x,deg,L){
  var set=[deg,deg+2,deg+4], best=x, bd=1e9, o, j;
  for(o=-2;o<=2;o++) for(j=0;j<3;j++){ var c=set[j]+o*L, d=Math.abs(c-x); if(d<bd){ bd=d; best=c; } }
  return best;
}
function skeletonMotif(r,n,anchors,chordDegAt,L){
  var m=[], cur=pick(r,[0,2,4]), i;
  for(i=0;i<n;i++){
    if(anchors[i]) cur=chordToneNear(cur+rint(r,-2,2), chordDegAt(i), L);
    else cur+=wpick(r,[[1,1],[-1,1],[2,0.5],[-2,0.5],[0,0.7]]);
    m.push(cur);
  }
  return m;
}
function discipline(m,anchors,chordDegAt,L,maxRun){
  maxRun=maxRun||3;   // per-hook 'hammer' style may raise this to 5 — the corpus' #1 cell is a hammered pitch
  var out=m.slice(), i, lastLeap=0, same=0;
  for(i=0;i<out.length;i++){
    out[i]=Math.round(out[i]||0);
    if(i>0){
      var leap=out[i]-out[i-1];
      if(Math.abs(leap)>5) out[i]=out[i-1]+(leap>0?5:-5);
      if(Math.abs(lastLeap)>=4 && Math.abs(out[i]-out[i-1])>=3 && (out[i]-out[i-1])*lastLeap>0)
        out[i]=out[i-1]-(lastLeap>0?1:-1);          // stepwise recovery after a leap
      if(out[i]===out[i-1]) same++; else same=0;
      if(same>=maxRun) out[i]+=((i%2)?1:-1);
    }
    if(anchors[i]) out[i]=chordToneNear(out[i],chordDegAt(i),L);
    out[i]=clamp(out[i],-7,10);
    if(i>0) lastLeap=out[i]-out[i-1];
  }
  var allSame=true; for(i=1;i<out.length;i++) if(out[i]!==out[0]) allSame=false;
  if(allSame) for(i=0;i<out.length;i++) out[i]=[0,2,4,2][i%4]+out[0];
  out[out.length-1]=clamp(chordToneNear(out[out.length-1],chordDegAt(out.length-1),L),-7,10);
  return out;
}
function degSemis(d,iv){ var l=iv.length, k=((d%l)+l)%l; return iv[k]+12*Math.floor(d/l); }
function singability(m,onsets,accents,iv){
  var s=m.map(function(d){ return degSemis(d,iv); }), i;
  var mx=-99, mn=99; for(i=0;i<s.length;i++){ if(s[i]>mx)mx=s[i]; if(s[i]<mn)mn=s[i]; }
  var span=mx-mn, sc=0;
  sc += 1-cl01(Math.abs(span-10.5)/10);
  // 2-pitch hooks are LEGAL chiptune (hammered riffs); reward repeats in the
  // corpus band (GB repeatRate p50 0.47) instead of punishing economy.
  var seen={}, uniq=0; for(i=0;i<m.length;i++) if(!seen[m[i]]){ seen[m[i]]=1; uniq++; }
  sc += (uniq>=2&&uniq<=7)?0.8:0.3;
  var reps=0; for(i=1;i<m.length;i++) if(m[i]===m[i-1]) reps++;
  var rr=reps/Math.max(1,m.length-1);
  sc += (rr>=0.2&&rr<=0.55)?0.5:(rr>0.55?0.2:0);
  var steps=0, flips=0, prevDir=0, leaps=0;
  for(i=1;i<s.length;i++){ var d=s[i]-s[i-1];
    if(Math.abs(d)<=2) steps++;
    if(Math.abs(d)>7) leaps++;
    var dir=d>0?1:(d<0?-1:0);
    if(dir&&prevDir&&dir!==prevDir) flips++;
    if(dir) prevDir=dir; }
  var f=steps/Math.max(1,s.length-1);
  sc += (f>=0.5&&f<=0.92)?0.8:0.3;
  sc += (flips>=2&&flips<=5)?0.7:0.25;
  sc -= leaps*0.5;
  var hits=0; for(i=0;i<onsets.length;i++) if(accents.indexOf(onsets[i]%16)>=0) hits++;
  sc += (hits/Math.max(1,onsets.length)>=0.34)?0.5:0.1;
  return sc;
}
function stMotif(token,pal,gr,ha){
  var r=R(token,'D');
  var L=ha.mode.iv.length;
  var hookBars = wpick(r,[[2,1.2],[1,0.8+(gr.density>0.6?0.4:0)]]);
  // rhythm: pick an onset template scored against the groove's own accents, then vary bar 2
  var best=null, bs=-1, i;
  for(i=0;i<ONSETS.length;i++){
    var t=ONSETS[i], ov=0, j;
    for(j=0;j<t.p.length;j++) if(gr.accentSteps.indexOf(t.p[j])>=0) ov++;
    // density target is DAMPED (x0.72): the groove's drum density shouldn't drag
    // the melody to the same busyness — the lead is a voice, not a hi-hat. More
    // scoring noise (0.28) so sparse cells actually win sometimes instead of the
    // argmax always landing on 6-onset templates.
    var sc=0.45*ov/t.p.length + 0.45*(1-Math.abs(t.d-gr.density*0.72)) + (t.tag==='gallop'&&gr.family==='gallop'?0.3:0) + r()*0.28;
    if(sc>bs){ bs=sc; best=t; }
  }
  var onsets=best.p.slice();
  if(hookBars===2){
    var b2=best.p.slice();
    if(r()<0.5 && b2.length>3) b2.splice(1+((r()*(b2.length-1))|0),1);
    if(r()<0.6){ var mi=1+((r()*(b2.length-1))|0); var moved=b2[mi]+(r()<0.5?1:-1);
      if(moved>0&&moved<16&&b2.indexOf(moved)<0) b2[mi]=moved; }
    b2=uniqSort(b2); while(b2.length&&b2[b2.length-1]>13) b2.pop(); if(!b2.length) b2=[0,8];
    onsets=onsets.concat(b2.map(function(x){ return x+16; }));
  }
  var N=onsets.length, span=hookBars*16;
  var len16=[], anchors=[];
  // ARTICULATION: real chip leads phrase with RESTS. The old rule set every
  // note's length to the full gap to the next onset — a wall-to-wall legato
  // ribbon with 0 rest steps (measured 94.5% 16th occupancy vs the real-library
  // norm of ~half of bars holding a full beat of silence). Now a per-hook gate
  // style caps note lengths (tight/norm keep air between notes) and the last
  // note in each bar HOLDS — the classic GB phrase ending (sustain + vibrato +
  // echo tail into the gap).
  var gate=wpick(r,[['tight',0.9],['norm',1.2],['legato',0.5]]);
  for(i=0;i<N;i++){
    var nx=(i<N-1?onsets[i+1]:span);
    var maxL=Math.min(8,nx-onsets[i]);
    var lastInBar=(i===N-1)||(Math.floor(onsets[i+1]/16)>Math.floor(onsets[i]/16));
    var L16;
    if(lastInBar||gate==='legato') L16=maxL;                                   // hold the phrase-ender
    else if(gate==='tight') L16=Math.min(maxL,1+((r()<0.3)?1:0));              // staccato cell
    else L16=Math.min(maxL,wpick(r,[[1,0.5],[2,1.2],[3,0.4],[4,0.5]]));        // spoken, with air
    len16.push(L16);
    anchors.push(onsets[i]%4===0);
  }
  function chordDegAt(idx){
    var st=onsets[idx], ci=Math.floor((st/16)/ha.hr)%4;
    return ha.loopA[ci];
  }
  // Pitch construction is AA' BY CONSTRUCTION, not a through-composed walk.
  // Real hooks are a CELL and its ANSWER: the corpus' #1 interval 4-gram is
  // literally 0,0,0,0 (hammered pitch, 51% of GB tracks) and one cell owns
  // 21-28% of a track's melodic motion — while the old generators ran ONE
  // random walk across the whole 2-bar span (bar-2/bar-1 pitch similarity
  // MEDIAN 0.0; only 22% of hooks were statement+answer). Now the generators
  // produce BAR 1 only; bar 2 restates bar 1's cell on its own (already
  // rhythm-varied) onset grid, transposed as an answer, tail resolved to the
  // cadence. hammer legalizes 4-5 note pitch runs (corpus norm, was capped 3).
  var N1=0; for(i=0;i<N;i++) if(onsets[i]<16) N1++;
  var hammer=r()<0.4, maxRun=hammer?5:3;
  var gen=wpick(r,[['contour',0.4],['corpus',0.35],['skeleton',0.25]]);
  var intent=pick(r,INTENTS);
  var a1=anchors.slice(0,N1);
  var bestM=null, bestSc=-1e9, tries=0;
  while(tries++<8){
    var raw = gen==='contour' ? contourMotif(r,intent,N1)
            : gen==='corpus'  ? corpusMotif(r,N1)
            : skeletonMotif(r,N1,a1,chordDegAt,L);
    var m=discipline(raw,a1,chordDegAt,L,maxRun);
    var sc=singability(m,onsets.slice(0,N1),gr.accentSteps,ha.mode.iv);
    if(sc>bestSc){ bestSc=sc; bestM=m; }
    if(sc>=2.6) break;
  }
  // HAMMERIZE: raising the run cap alone creates nothing — the walk generators
  // rarely EMIT repeats. For hammer-style hooks, collapse small steps onto the
  // previous pitch (anchors kept): the corpus' signature 0,0,0,0 cell appears
  // because real writers hammer a pitch and let the envelope/duty do the work.
  if(hammer){ for(i=1;i<N1;i++){ if(!a1[i] && Math.abs(bestM[i]-bestM[i-1])<=2 && r()<0.55) bestM[i]=bestM[i-1]; } }
  // PEAK SHAPING: give the cell ONE clear climax on a strong step (only 33% of
  // hooks had a unique strong-beat peak; real hooks nearly always do).
  (function(){
    var mx=-99, mi=-1;
    for(i=0;i<N1;i++) if(bestM[i]>mx){ mx=bestM[i]; mi=i; }
    var uniq=bestM.filter(function(d){ return d===mx; }).length===1;
    if(!(uniq && onsets[mi]%4===0)){
      var target=-1;                                      // strong-step onset in the back half of the cell
      for(i=N1-1;i>=0;i--) if(onsets[i]%4===0 && onsets[i]>=6 && onsets[i]<16){ target=i; break; }
      if(target<0) for(i=N1-1;i>=0;i--) if(onsets[i]%4===0){ target=i; break; }
      if(target>=0){
        var pk=clamp(mx+1+((r()<0.3&&mx<9)?1:0),-7,10);
        var okL=target===0 || Math.abs(pk-bestM[target-1])<=5;
        var okR=target===N1-1 || Math.abs(pk-bestM[target+1])<=5;
        if(okL&&okR) bestM[target]=pk;
      }
    }
  })();
  var degs=bestM.slice();
  if(hookBars===2){
    var N2=N-N1;
    var tr=wpick(r,[[0,1.2],[-1,0.8],[1,0.5],[-2,0.4],[2,0.25]]);   // the answer's transposition
    for(i=0;i<N2;i++) degs.push(clamp(bestM[i%N1]+tr,-7,10));
    // tail cadence: the answer RESOLVES instead of wandering off
    degs[N-1]=clamp(chordToneNear(degs[N-1],chordDegAt(N-1),L),-7,10);
    if(N2>=3 && r()<0.6) degs[N-2]=clamp(degs[N-1]+(r()<0.5?1:-1),-7,10);
    // one smoothing pass across the bar boundary (keeps leaps sane, keeps anchors)
    degs=discipline(degs,anchors,chordDegAt,L,maxRun);
  }
  // lead register base: median lands near 72 (singable), then folded to 58..90 at emit
  var semis=degs.map(function(d){ return degSemis(d,ha.mode.iv); }).slice().sort(function(a,b){return a-b;});
  var med=semis[semis.length>>1], leadBase=60, cand=[36,48,60,72], bd=1e9;
  for(i=0;i<cand.length;i++){ var dd=Math.abs(cand[i]+ha.keyPc+med-72); if(dd<bd){ bd=dd; leadBase=cand[i]; } }
  // derived figures
  var FIGS={ four:[['offbeat8',1],['pump8',0.8],['octave8',0.7]],
    backbeat:[['pump8',1],['synco',0.9],['octave8',0.6]],
    break:[['synco',1],['stab',0.8],['pump8',0.6]],
    halftime:[['sublong',1],['synco2',0.8]],
    gallop:[['drive16',1],['octave8',0.9],['pump8',0.5]] };
  var bassFig=wpick(r,FIGS[gr.family]||FIGS.backbeat);
  if(pal.brightness>0.6 && gr.bpm>=140 && r()<0.5) bassFig='octave8';
  var CFIGS={ four:[['offstab',1.1],['arp16',0.9],['arp8',0.6]],
    backbeat:[['stabsync',1],['arp8',0.8],['pulse4',0.5]],
    break:[['stabsync',1],['arp16',0.8],['offstab',0.6]],
    halftime:[['pulse4',1],['arp8',0.7]],
    gallop:[['arp16',1],['arp8',0.8],['stabsync',0.6]] };
  // Arp personality = SHAPE x RHYTHM, not just up/down 8ths. ord adds broken
  // (alternating pairs) and pedal (return-to-root) figures; rhythm spans
  // quarters (r4, long gliding notes) through dotted-8th drive (dot), gated
  // 16ths (gate, one step muted per cycle) and straight r8/r16 — weighted by
  // groove family. Before this, every arp in every track was a straight
  // up-or-down cycle at a fixed rate ("two or three kinds, always the same
  // rhythm" — the owner heard it exactly).
  var ARH={ four:[['r8',1],['r16',0.8],['dot',0.55],['r4',0.4]],
    backbeat:[['r8',1],['dot',0.7],['gate',0.6],['r4',0.4]],
    break:[['r8',1],['dot',0.6],['r4',0.5]],
    halftime:[['r4',1],['r8',0.7],['dot',0.4]],
    gallop:[['gate',1],['r16',0.9],['dot',0.6]] };
  var arpFig={ mode:wpick(r,CFIGS[gr.family]||CFIGS.backbeat),
    ord:wpick(r,[['up',1],['down',0.6],['updown',0.8],['broken',0.7],['pedal',0.6]]),
    rhythm:wpick(r,ARH[gr.family]||ARH.backbeat),
    span:(r()<0.35?2:1), stabArp:r()<0.78 };
  var altChord = /arp/.test(arpFig.mode) ? 'offstab' : 'arp16';
  // the alternate arp (chordVar sections) flips BOTH axes for real contrast
  var altOrd=pick(r,['up','updown','broken','pedal'].filter(function(o){ return o!==arpFig.ord; }));
  var altRhythm=pick(r,['r8','dot','r4','r16'].filter(function(x){ return x!==arpFig.rhythm; }));
  var counterFig={ mode:r()<0.5?'echo':'invert' };
  return { hookBars:hookBars, onsets:onsets, len16:len16, degs:degs, anchors:anchors, gen:gen,
    leadBase:leadBase, bassFig:bassFig, arpFig:arpFig, altChord:altChord,
    altOrd:altOrd, altRhythm:altRhythm, counterFig:counterFig };
}

// ---------- stage E: arrangement — form grammar, novelty by construction, energy arc ----------
function peakEnergy(token){ return 9+((R(token,'peak')()<0.45)?1:0); }
function stArrange(token,pal,gr,ha,mo){
  var r=R(token,'E');
  var peakE=peakEnergy(token);
  var barSec=240/gr.bpm;
  function mk(role,bars,e){ return {role:role,bars:bars,e:e}; }
  var list=[
    mk('groove', wpick(r,[[4,0.7],[6,0.8],[8,1]]), 6),
    mk('flow', 8, 5),
    mk('groove', 8, 7),
    mk('bridge', 8, wpick(r,[[5,1],[6,1.2]])),
    mk('break', rint(r,2,4), 3),
    mk('build', 4, 8),
    mk('drop', wpick(r,[[8,1.2],[12,1],[16,0.5]]), peakE)
  ];
  var outBars=rint(r,3,4);
  function secsOf(){ var b=0,i; for(i=0;i<list.length;i++) b+=list[i].bars; return (b+outBars)*barSec; }
  var gi=0;
  while(secsOf()<95 && gi<9){
    var g=gi%3;
    if(g===0) list.push(mk('flow',8,5));
    else if(g===1) list.push(mk('groove',8,7));
    else { list.push(mk('break',rint(r,2,3),3)); list.push(mk('build',4,8)); list.push(mk('drop',rint(r,8,12),peakE)); }
    gi++;
  }
  list.push(mk('outro',outBars,2));
  var hasC=!!pal.voices.counter, hasP=!!pal.voices.pad;
  var grooveN=0;
  function desc(S,idx){
    var role=S.role, d={ lead:1, counter:0, chord:1, bass:1, pad:0, drums:'A', op:'asis',
      regShift:0, loopPos:0, duty:null, chordVar:0, leadEvery:1, throw:0, riser:0 };
    if(role==='groove'){
      grooveN++;
      d.chord = (grooveN===1 && r()<0.5) ? 0 : 1;
      d.counter = hasC && r()<0.3 ? 1 : 0;
      d.pad = hasP && r()<0.3 ? 1 : 0;
      d.drums = grooveN===1 ? 'A' : pick(r,['A','B']);
      d.op = grooveN===1 ? 'asis' : pick(r,['asis','endvar','nudge']);
      d.loopPos = pick(r,[0,0,'B']);
      if(grooveN>1 && r()<0.12) d.regShift=12;
      if(grooveN>1 && r()<0.22) d.leadEvery=2;   // later grooves sometimes call-and-answer too
    } else if(role==='flow'){
      // flow = the mellow stretch: call-and-answer even without a counter voice
      // (silent answer bars over chord+bass+drums are the classic breakdown)
      d.counter=hasC?1:0; d.leadEvery=hasC?2:(r()<0.3?2:1);
      d.pad = hasP && r()<0.7 ? 1 : 0;
      d.drums = wpick(r,[['B',1],['half',0.7],['A',0.5]]);
      d.op = pick(r,['fragment','invert','nudge']);
      d.regShift = pick(r,[0,0,-12]);
      d.loopPos = pick(r,[0,'B',2]);
    } else if(role==='bridge'){
      d.counter = hasC && r()<0.5 ? 1 : 0;
      d.pad = hasP && r()<0.5 ? 1 : 0;
      d.drums = pick(r,['B','half']);
      d.op = pick(r,['invert','retro','augment']);
      d.regShift = pick(r,[-12,0,12]);
      d.loopPos = pick(r,['B',2]);
      d.chordVar = r()<0.6 ? 1 : 0;
    } else if(role==='break'){
      var v=wpick(r,[['bassHat',1.2],['chordThrow',1],['padGhost',hasP?0.6:0]]);
      d.lead=0; d.counter=0;
      d.chord = v==='chordThrow'?1:0; d.throw = v==='chordThrow'?1:0;
      d.bass = v!=='padGhost'?1:0; d.pad = v==='padGhost'?1:0;
      d.drums = pick(r,['sparse','half']);
      d.loopPos = pick(r,[0,'B']);
    } else if(role==='build'){
      d.lead=0; d.counter=0; d.pad=0; d.drums='build'; d.riser=1; d.loopPos=0;
    } else if(role==='drop'){
      d.counter=hasC?1:0; d.pad=hasP?1:0; d.drums='A';
      d.op = wpick(r,[['asis',1.2],['octave',0.8],['endvar',0.7]]);
      d.regShift = d.op==='octave'?12:0;
      d.loopPos=0;
      if(pal.voices.lead.wave==='pulse' && r()<0.35) d.duty=pick(r,[0.125,0.25,0.5]);
    } else { // outro
      d.counter=0; d.pad=hasP?1:0; d.drums='half'; d.op='asis';
    }
    // LEAD-PRESENCE MOOD overrides (pal.leadMode): 'none' silences melody
    // everywhere (accompaniment carries — chord on, pad likelier); 'sparse'
    // keeps the lead only as occasional color: the drop (payoff), the first
    // groove in call-answer form, sometimes a bridge. flow goes instrumental.
    var lm=pal.leadMode||'full';
    if(lm==='none'){
      d.lead=0; d.counter=0;
      if(role==='groove'||role==='flow'||role==='bridge'||role==='drop') d.chord=1;
      if(hasP && !d.pad && r()<0.4) d.pad=1;
    } else if(lm==='sparse'){
      if(role==='groove'){ d.lead=(grooveN===1||r()<0.15)?1:0; if(d.lead) d.leadEvery=2; }
      else if(role==='flow'){ d.lead=0; }
      else if(role==='bridge'){ d.lead=r()<0.25?1:0; }
      else if(role==='drop'){ d.leadEvery=2; }   // even the payoff answers rather than preaches
      if(!d.lead) d.counter=0;
    }
    if(role!=='drop' && role!=='outro' && role!=='break' && role!=='build' &&
       pal.voices.lead.wave==='pulse' && r()<0.3) d.duty=pick(r,[0.125,0.25,0.5]);
    // LAYER BUDGET: counter and pad never stack in one section. A GB runs the
    // lead + ONE companion pulse + wave bass + noise; five pitched layers at
    // once (lead+chord+counter+pad+bass, as drops used to flag) reads as chaos
    // on any speaker. Chord stays (it's the LSDJ arp identity); the third
    // accompaniment slot is counter XOR pad.
    if(d.counter&&d.pad){ if(r()<0.5) d.counter=0; else d.pad=0; }
    for(var k in d) S[k]=d[k];
  }
  function maskStr(S){ return 'L'+S.lead+'C'+S.counter+'H'+S.chord+'B'+S.bass+'P'+S.pad; }
  function diffCount(a,b){ var n=0;
    if(maskStr(a)!==maskStr(b)) n++;
    if(a.regShift!==b.regShift) n++;
    if(a.op!==b.op) n++;
    if(a.drums!==b.drums) n++;
    if(String(a.loopPos)!==String(b.loopPos)) n++;
    return n; }
  var i;
  for(i=0;i<list.length;i++){
    desc(list[i],i);
    if(i>0){
      var tries=0;
      while(diffCount(list[i-1],list[i])<2 && tries++<8){
        if(list[i].role==='groove') grooveN--;   // keep first-groove bookkeeping stable on resample
        desc(list[i],i);
      }
      if(diffCount(list[i-1],list[i])<2){
        var order=['A','B','half','sparse'], ci=order.indexOf(list[i].drums);
        list[i].drums=order[(ci+1)%order.length];
        if(hasP) list[i].pad=list[i].pad?0:1; else if(hasC) list[i].counter=list[i].counter?0:1;
        else list[i].regShift=list[i].regShift===0?12:0;
      }
    }
  }
  // fills at boundaries, derived from the groove's own vocabulary; risers only into PEAK
  for(i=0;i<list.length-1;i++){
    var nx=list[i+1];
    if(list[i].role==='build'){ list[i].fill=null; continue; }   // build rolls itself
    if(r()<0.75){
      list[i].fill = nx.role==='break' ? (r()<0.6?'cut':'cresc')
                   : nx.role==='drop'  ? 'cresc'
                   : pick(r,['cresc','stut']);
    } else list[i].fill=null;
  }
  var atBar=0;
  for(i=0;i<list.length;i++){ list[i].atBar=atBar; atBar+=list[i].bars; }
  var liftBar=-1;
  if(ha.lift) for(i=0;i<list.length;i++) if(list[i].role==='drop') liftBar=list[i].atBar;
  return { sections:list, totalBars:atBar, peakE:peakE, liftBar:liftBar };
}

// ---------- sample baking (compile-time PCM synthesis; deterministic) ----------
function bakeSample(rec){
  var rate=rec.rate, TAU=6.28318530718, n, pcm, i, t;
  if(rec.kind==='fmpluck'||rec.kind==='bell'){
    n=(rate*0.32)|0; pcm=new Float32Array(n);
    var ratio=rec.kind==='bell'?rec.ratio:2, I=rec.fmI*(rec.kind==='bell'?1.4:1);
    for(i=0;i<n;i++){ t=i/rate;
      var im=I*Math.exp(-t*rec.fmDec);
      pcm[i]=Math.sin(TAU*rec.f0*t + im*Math.sin(TAU*rec.f0*ratio*t))*Math.exp(-t*rec.ampDec);
    }
    return { id:rec.id, rate:rate, baseMidi:rec.baseMidi, pcm:normPcm(pcm) };
  }
  // looped additive (choir / organette): integer-period partials -> seamless loop
  var cyc=rec.cyc, attack=cyc*4, loopLen=cyc*8; n=attack+loopLen; pcm=new Float32Array(n);
  var parts = rec.kind==='choir' ? [[1,1],[2,0.32],[3,0.44],[4,0.2],[5,0.3],[8,0.12*rec.bright]]
                                 : [[1,1],[2,0.55],[3,0.3],[4,0.5],[6,0.22],[8,0.35*rec.bright]];
  for(i=0;i<n;i++){ t=i/rate; var s=0, env=i<attack?(i/attack):1, j;
    for(j=0;j<parts.length;j++) s+=parts[j][1]*Math.sin(TAU*rec.f0*parts[j][0]*i/rate);
    pcm[i]=s*env*(rec.kind==='choir'?(0.85+0.15*Math.sin(TAU*5.2*t)):1);
  }
  return { id:rec.id, rate:rate, baseMidi:rec.baseMidi, loop:{start:attack,end:n}, pcm:normPcm(pcm) };
}
function normPcm(p){ var mx=0,i; for(i=0;i<p.length;i++){ var a=Math.abs(p[i]); if(a>mx)mx=a; }
  if(mx>0){ var g=0.9/mx; for(i=0;i<p.length;i++) p[i]*=g; } return p; }

// ---------- stage F: compile — walk the plan into the event stream ----------
function compile(token){
  token=normToken(token);
  var pal=stPalette(token), gr=stGroove(token,pal), ha=stHarmony(token,pal),
      mo=stMotif(token,pal,gr,ha), ar=stArrange(token,pal,gr,ha,mo);
  var samples=pal.sampleRecipes.map(bakeSample);
  var ev=[], seedR=R(token,'seed'), humR=R(token,'hum');
  var iv=ha.mode.iv, L=iv.length, CL=ha.chordIv.length;
  function lift(bar){ return (ha.lift&&ar.liftBar>=0&&bar>=ar.liftBar)?ha.lift:0; }
  function push(t,d,ch,midi,vel,artic){
    var e={ tBeat:Math.round(Math.max(0,t)*1000)/1000, dur:Math.round(Math.max(0.02,d)*1000)/1000,
      ch:ch, vel:rd3(clamp(vel,0.04,1)), seed:(seedR()*4294967296)>>>0 };
    if(midi!=null) e.midi=Math.round(midi);
    if(artic) e.artic=artic;
    ev.push(e);
  }
  function hum(){ return (humR()*2-1)*gr.humanize; }
  function segChord(S,barInSec,step){
    var loop = S.loopPos==='B'?ha.loopB:ha.loopA, voic = S.loopPos==='B'?ha.voicB:ha.voicA;
    var off = S.loopPos===2?2:0;
    var ci=(Math.floor((barInSec+step/16)/ha.hr)+off)%4;
    return { deg:loop[ci], voic:voic[ci], idx:ci };
  }
  function bassRoot(deg,bar){
    var pc=((ha.keyPc+ha.chordIv[((deg%CL)+CL)%CL]+lift(bar))%12+12)%12;
    return 36+pc;   // 36..47
  }
  function leadMidi(deg,bar,reg){
    var m=mo.leadBase+ha.keyPc+degSemis(deg,iv)+(reg||0)+lift(bar);
    while(m<58) m+=12; while(m>90) m-=12;
    return m;
  }
  function arpTable(voic){
    var b=voic[0], out=[0], i;
    for(i=1;i<voic.length;i++){ var o=((voic[i]-b)%12+12)%12; if(o&&out.indexOf(o)<0) out.push(o); }
    out.sort(function(a,b2){return a-b2;});
    return out.length>1?out:null;
  }
  var secGainOf=function(e){ return clamp(0.66+0.036*e,0.6,1.02); };
  var prevLeadMidi=null;

  // ----- per-part emitters -----
  function emitDrums(S,si,bar,rf){
    var t0=(S.atBar+bar)*4, sg=0.8+0.2*secGainOf(S.e), fillBar=(S.fill&&bar===S.bars-1);
    var variant=S.drums;
    if(variant==='none') return;
    if(variant==='build'){
      var bt=bar/S.bars, i;
      for(i=0;i<16;i+=4) push(t0+i/4,0.25,'kick',null,(0.68+0.3*bt)*sg);
      for(i=0;i<16;i++) if(i%2===0||bar>=S.bars-2) push(t0+i/4+hum(),0.1,'hat',null,(0.16+0.2*bt)*sg*(i%4===0?1.3:1));
      if(bar===S.bars-1){ for(i=0;i<16;i++) push(t0+i/4,0.12,'snare',null,(0.3+0.55*i/15)*sg); }
      else if(bar===S.bars-2){ for(i=8;i<16;i+=2) push(t0+i/4,0.12,'snare',null,(0.4+0.3*(i-8)/8)*sg); }
      return;
    }
    var pat = variant==='B'?gr.patB:gr.patA, i2, st;
    var half = variant==='half', sparse = variant==='sparse';
    var kSteps = half?[0]:(sparse?[0,8]:pat.k);
    var sSteps = half?[8]:(sparse?[]:pat.s);
    var gSteps = (half||sparse)?[]:pat.gs;
    var lastFill = fillBar?8:16;
    for(i2=0;i2<kSteps.length;i2++){ st=kSteps[i2]; if(st>=lastFill) continue;
      push(t0+st/4,0.25,'kick',null,pat.kv*sg*(st===0?1.05:1)); }
    for(i2=0;i2<sSteps.length;i2++){ st=sSteps[i2]; if(st>=lastFill) continue;
      push(t0+st/4,0.2,'snare',null,pat.sv*sg); }
    for(i2=0;i2<gSteps.length;i2++){ st=gSteps[i2]; if(st>=lastFill) continue;
      push(t0+st/4,0.12,'snare',null,pat.gv*sg); }
    var hatVel=gr.hat.hv*((half||sparse)?0.75:1);
    for(i2=0;i2<gr.hat.steps.length;i2++){ st=gr.hat.steps[i2];
      if((half||sparse)&&gr.hat.steps.length>8&&st%2===1) continue;
      var isOpen=gr.hat.open.indexOf(st)>=0 && !half && !sparse;
      push(t0+st/4+hum(), isOpen?0.5:0.1, 'hat', null,
        (isOpen?0.38:hatVel*(gr.hat.acc.indexOf(st)>=0?1.35:1))*sg*(fillBar&&st>=8?0.75:1));
    }
    if(fillBar){
      var fill=null, fi;
      for(fi=0;fi<gr.fills.length;fi++) if(gr.fills[fi].id===S.fill) fill=gr.fills[fi];
      if(fill) for(fi=0;fi<fill.steps.length;fi++){ var fs=fill.steps[fi];
        push(t0+fs.st/4,0.12,fs.ch,fs.midi!=null?fs.midi:null,fs.vel*sg); }
    }
  }
  function emitBass(S,si,bar,rf){
    var t0=(S.atBar+bar)*4, sg=secGainOf(S.e), base=0.8*sg;
    var ch=segChord(S,bar,0), root=bassRoot(ch.deg,S.atBar+bar);
    var nx=segChord(S,bar+1,0), nroot=bassRoot(nx.deg,S.atBar+bar+1), changes=nroot!==root;
    var fig=mo.bassFig, i, st;
    if(S.role==='break'||fig==='sublong'){ push(t0,ha.hr>=1?3.7:1.8,'bass',root,0.72*sg);
      if(ha.hr===0.5){ var c2=segChord(S,bar,8); push(t0+2,1.8,'bass',bassRoot(c2.deg,S.atBar+bar),0.7*sg); }
      return; }
    if(S.role==='build'){
      var bt=bar/S.bars;
      for(i=0;i<16;i+=(bar===S.bars-1?1:2)) push(t0+i/4,0.2,'bass',root,(0.62+0.3*bt)*sg*(i%4===0?1.08:1));
      return;
    }
    if(S.role==='outro') return;   // outro bass is emitted with the cadence
    var hi = root<=40 ? root+12 : root+7;
    function stepRoot(st2){ var c=segChord(S,bar,st2); return bassRoot(c.deg,S.atBar+bar); }
    if(fig==='pump8'){ for(i=0;i<16;i+=2){ var m=stepRoot(i);
        if(i===14&&changes&&rf()<0.5) m=nroot+(rf()<0.5?-1:-2);
        push(t0+i/4,0.42,'bass',m,base*(i%8===0?1.1:0.92)); } }
    else if(fig==='octave8'){ for(i=0;i<16;i+=2){ var m2=stepRoot(i);
        push(t0+i/4,0.4,'bass',(i%4===2)?(m2<=40?m2+12:m2+7):m2,base*(i%8===0?1.08:0.9)); } }
    else if(fig==='offbeat8'){ for(i=2;i<16;i+=4) push(t0+i/4,0.42,'bass',stepRoot(i),base); }
    else if(fig==='synco'||fig==='synco2'){
      var steps=fig==='synco2'?[0,6,10]:[0,3,6,10,12];
      for(i=0;i<steps.length;i++){ st=steps[i]; var m3=stepRoot(st);
        if((st===6||st===10)&&rf()<0.4) m3+=7;
        push(t0+st/4,0.45,'bass',m3,base*(st===0?1.1:0.95)); }
      if(changes&&rf()<0.5) push(t0+14/4,0.4,'bass',nroot-1,base*0.85);
    }
    else if(fig==='stab'){ var ss=[0,3,8,11]; for(i=0;i<ss.length;i++) push(t0+ss[i]/4,0.3,'bass',stepRoot(ss[i]),base*(ss[i]===0?1.1:0.95)); }
    else { // drive16 (gallop fuel)
      var mask=[0,3,4,6,8,11,12,14];
      for(i=0;i<mask.length;i++){ st=mask[i]; var m4=stepRoot(st);
        push(t0+st/4,0.2,'bass',(st===6||st===14)&&rf()<0.3?hi:m4,base*(st%8===0?1.1:0.88)); }
    }
  }
  function emitChord(S,si,bar,rf){
    var t0=(S.atBar+bar)*4, sg=secGainOf(S.e), lf=lift(S.atBar+bar);
    var modeName = S.chordVar?mo.altChord:mo.arpFig.mode;
    if(S.role==='break'&&S.throw){
      if(bar===0||(bar===2&&S.bars>=3&&rf()<0.6)){
        var c=segChord(S,bar,0), at=arpTable(c.voic);
        push(t0,0.5,'chord',c.voic[0]+lf,0.66*sg,{arp:at||[0,4,7],accent:1,sendEcho:0.95});
      }
      return;
    }
    if(S.role==='build'){
      var cb=segChord(S,0,0), voicB2=(S.loopPos==='B'?ha.voicB:ha.voicA)[3];
      var atB=arpTable(voicB2), bt=bar/S.bars;
      push(t0,0.5,'chord',voicB2[0]+lf,(0.5+0.24*bt)*sg,{arp:atB||[0,4,7],accent:bar===S.bars-1?1:0,drive:bar===S.bars-1?0.25:0});
      return;
    }
    if(S.role==='outro') return;   // cadence handles it
    var i, st;
    if(modeName==='offstab'||modeName==='stabsync'||modeName==='pulse4'){
      var steps = modeName==='offstab'?[2,6,10,14] : modeName==='stabsync'?[0,3,8,11] : [0,4,8,12];
      for(i=0;i<steps.length;i++){ st=steps[i];
        var ch2=segChord(S,bar,st), at2=mo.arpFig.stabArp?arpTable(ch2.voic):null;
        var a={}; if(at2) a.arp=at2; if(st===steps[0]) a.accent=1; if(modeName!=='pulse4') a.cutMul=0.6;   // 0.6x freq, not an absolute Hz
        push(t0+st/4+hum(), modeName==='pulse4'?0.7:0.4, 'chord', ch2.voic[0]+lf,
          (modeName==='pulse4'?0.5:0.62)*sg*(st===steps[0]?1.06:0.96), (a.arp||a.accent||a.cutMul)?a:null);
      }
    } else {
      // Arp = SHAPE x RHYTHM (mo.arpFig.ord / .rhythm; chordVar sections flip to
      // the alternate pair for real contrast). Rhythms: r16 straight 16ths, r8
      // 8ths, dot dotted-8th drive (every 3 steps), gate gated 16ths (one step
      // muted per 4), r4 long quarters. Section-aware: drops lift one density
      // notch, flow/bridge drop one. Under a lead the busy rhythms (r16/gate)
      // thin to r8 + a small duck so the lead stays the top voice — but dot/r4
      // KEEP their character (the old rule forced every under-lead arp to
      // identical straight 8ths, which is why they all sounded the same).
      // (Octave-drop under lead was tried and reverted: it re-indexed the arp
      // onto lead pitches and made 12 seeds worse. Density is the safe lever.)
      var ord = S.chordVar ? mo.altOrd : mo.arpFig.ord;
      var rhy = S.chordVar ? mo.altRhythm : mo.arpFig.rhythm;
      if(S.role==='drop' && rhy==='r8') rhy='r16';
      else if((S.role==='flow'||S.role==='bridge') && rhy==='r16') rhy='r8';
      if(S.lead && (rhy==='r16'||rhy==='gate')) rhy='r8';
      var RH={ r16:{stepN:1,dur:0.22}, r8:{stepN:2,dur:0.42}, dot:{stepN:3,dur:0.32},
        gate:{stepN:1,dur:0.22,mask:[1,1,0,1]}, r4:{stepN:4,dur:0.85} };
      var rh=RH[rhy]||RH.r8, idx=0;
      for(st=0;st<16;st+=rh.stepN){
        if(rh.mask && !rh.mask[(st/rh.stepN)%rh.mask.length]){ idx++; continue; }
        var ch3=segChord(S,bar,st), notes=ch3.voic.slice();
        if(mo.arpFig.span===2) notes=notes.concat([notes[0]+12]);
        var n=notes.length, j;
        if(ord==='down') j=n-1-(idx%n);
        else if(ord==='updown'){ var cyc=2*n-2||1, p=idx%cyc; j=p<n?p:cyc-p; }
        else if(ord==='broken'){ var bo=[0,2,1,3]; j=bo[idx%Math.min(4,n)]%n; }        // alternating pairs
        else if(ord==='pedal'){ j=(idx%2===0)?0:(1+((idx>>1)%(n-1||1))); }             // return-to-root
        else j=idx%n;
        push(t0+st/4+hum(),rh.dur,'chord',notes[j]+lf,
          0.5*sg*(st%4===0?1.12:0.92)*(S.lead?0.85:1)*(rhy==='r4'?1.06:1));
        idx++;
      }
    }
  }
  function applyOp(op,rf){
    var degs=mo.degs.slice(), onsets=mo.onsets.slice(), len=mo.len16.slice(), i;
    if(op==='endvar'||op==='nudge'){
      var n=op==='endvar'?2:1+((rf()*2)|0);
      for(i=0;i<n;i++){
        var at=op==='endvar'?degs.length-1-i:((rf()*degs.length)|0);
        if(at>=0&&at<degs.length) degs[at]=clamp(degs[at]+(rf()<0.5?1:-1)*(1+(rf()<0.3?1:0)),-7,10);
      }
      degs[degs.length-1]=clamp(chordToneNear(degs[degs.length-1],0,L),-7,10);
    } else if(op==='invert'){ var d0=degs[0]; degs=degs.map(function(d){ return clamp(2*d0-d,-7,10); }); }
    else if(op==='retro'){ degs=degs.slice().reverse(); }
    else if(op==='fragment'){
      var keep=[], kd=[], kl=[];
      for(i=0;i<onsets.length;i++) if(onsets[i]%16<8){ keep.push(onsets[i]%16); kd.push(degs[i]); kl.push(Math.min(len[i],8-(onsets[i]%16))); }
      if(!keep.length){ keep=[0]; kd=[degs[0]]; kl=[4]; }
      onsets=[]; degs=[]; len=[];
      var reps=mo.hookBars*2, rIdx;
      for(rIdx=0;rIdx<reps;rIdx++) for(i=0;i<keep.length;i++){ onsets.push(keep[i]+8*rIdx); degs.push(kd[i]); len.push(kl[i]); }
    } else if(op==='augment'){
      var o2=[],d2=[],l2=[];
      for(i=0;i<onsets.length;i+=2){ var na=onsets[i]*2; if(na>=mo.hookBars*16) break;
        o2.push(na); d2.push(degs[i]); l2.push(Math.min(8,len[i]*2)); }
      if(o2.length>=2){ onsets=o2; degs=d2; len=l2; }
    }
    if(op==='invert'||op==='retro') degs[degs.length-1]=clamp(chordToneNear(degs[degs.length-1],0,L),-7,10);
    for(i=1;i<degs.length;i++){ var lp=degs[i]-degs[i-1]; if(Math.abs(lp)>5) degs[i]=degs[i-1]+(lp>0?5:-5); }
    return { degs:degs, onsets:onsets, len:len };
  }
  function emitLead(S,si,bar,rf,seq){
    if(S.leadEvery>1 && Math.floor(bar/mo.hookBars)%S.leadEvery===1) return;
    var t0=(S.atBar+bar)*4, sg=secGainOf(S.e);
    var cyc=bar%mo.hookBars, i, first=true;
    for(i=0;i<seq.onsets.length;i++){
      var on=seq.onsets[i]; if(on<cyc*16||on>=(cyc+1)*16) continue;
      var st=on-cyc*16, m=leadMidi(seq.degs[i],S.atBar+bar,S.regShift);
      var l16=seq.len[i], dur=l16*0.25*(l16===1&&gr.density>0.5?0.7:0.92);
      var a=null;
      // Accent ONLY the phrase-start note. The old rule accented every groove
      // accent-step hit (76% of lead notes — templates are argmax-picked for
      // accent overlap), and the composer baked a 1.1x on top of the worklet's
      // own 1.3x accent multiplier: a double accent that made 3 of 4 lead notes
      // the loudest thing in the mix. Worklet's 1.3x alone is the accent now.
      if(first && gr.accentSteps.indexOf(st)>=0){ a=a||{}; a.accent=1; }
      first=false;
      if(prevLeadMidi!=null && Math.abs(m-prevLeadMidi)>=5 && rf()<0.3){ a=a||{}; a.slide=rd3(0.04+0.04*rf()); a.from=prevLeadMidi; }
      if(S.duty!=null && st===seq.onsets[0]%16){ a=a||{}; a.dutyStart=S.duty; }
      if(prevLeadMidi===m && l16<=2 && rf()<0.35){ a=a||{}; a.tie=1; }
      push(t0+st/4,dur,'lead',m,0.74*sg*(a&&a.accent?1.0:0.94),a);
      prevLeadMidi=m;
    }
  }
  // The counter is the ANSWER voice: it speaks only where the lead rests — the
  // leadEvery answer statements and phrase-breath bars — with a short 2-4 note
  // phrase derived from the hook tail, then silence. (The old version tried to
  // stuff every intra-bar gap of the hook's occupancy map; the legato hook had
  // no gaps, so it emitted ZERO notes across every track ever generated — dead
  // code — and call-and-response never made it to the speakers.)
  function emitCounter(S,si,bar,rf,answering){
    if(!answering) return;
    var t0=(S.atBar+bar)*4, sg=secGainOf(S.e);
    var reg = S.regShift===-12?0:-12;
    var n=2+((rf()*3)|0); if(n>mo.degs.length) n=mo.degs.length;   // 2-4 notes
    var st0=rf()<0.6?0:2, k;
    for(k=0;k<n;k++){
      var idx=mo.degs.length-n+k, d=mo.degs[idx];
      d = mo.counterFig.mode==='invert' ? 2*mo.degs[0]-d : d-2;
      if(k===n-1) d=chordToneNear(d,segChord(S,bar,Math.min(15,st0+k*2)).deg,L);
      var m=leadMidi(clamp(d,-7,10),S.atBar+bar,reg);
      push(t0+(st0+k*2)/4+hum(),(k===n-1?0.9:0.42),'counter',m,0.5*sg*(k===0?1:0.92));
    }
  }
  function emitPad(S,si,bar){
    var t0=(S.atBar+bar)*4, sg=secGainOf(S.e), lf=lift(S.atBar+bar);
    var blockBars=Math.max(1,ha.hr), i;
    if(bar%blockBars!==0) return;
    var reps=ha.hr===0.5?2:1;
    for(i=0;i<reps;i++){
      var c=segChord(S,bar,i*8), durBars=Math.min(blockBars,S.bars-bar);
      var dur=ha.hr===0.5?1.9:durBars*4-0.15, j;
      // Pad = a rootless 2-note upper dyad, sustained an octave below the chord
      // stabs. The bass owns the root and the chord stab leads on voic[0], so
      // doubling either at unison was pure masking (was ~72% of all register
      // collisions). Instead the pad holds guide tones — 3rd+7th on a seventh
      // chord, 3rd+5th on a triad — a warm harmonic bed that clears both the
      // chord's mid-high register and the bass's low end.
      for(j=1;j<c.voic.length;j++){ if(c.voic.length>=4&&j===2) continue;   // drop the 5th when a 7th is present (bass covers root+5th)
        push(t0+i*2+j*0.01,dur,'pad',c.voic[j]+lf-12,(0.42+0.02*S.e)*sg*0.55); }
    }
  }
  // ----- walk the sections -----
  var si, S, bar;
  for(si=0;si<ar.sections.length;si++){
    S=ar.sections[si];
    var rf=R(token,'F:'+si);
    if(S.role==='outro'){
      var t0=S.atBar*4, lf2=lift(S.atBar);
      var atP=arpTable(ha.voicPre), atF=arpTable(ha.voicFin);
      // pre-dominant pull...
      push(t0,1.4,'chord',ha.voicPre[0]+lf2,0.6,{arp:atP||[0,4,7],accent:1});
      push(t0,1.8,'bass',bassRoot(ha.cadPre,S.atBar),0.74);
      if(pal.leadMode!=='none'){
        push(t0+2,0.9,'lead',leadMidi(2,S.atBar,0),0.66);
        push(t0+3,0.9,'lead',leadMidi(1,S.atBar,0),0.62);
      }
      push(t0,0.25,'kick',null,0.8);
      // ...home.
      push(t0+4,3,'chord',ha.voicFin[0]+lf2,0.62,{arp:atF||[0,4,7],accent:1,sendEcho:0.6});
      push(t0+4,3,'bass',bassRoot(0,S.atBar+1),0.76);
      if(pal.leadMode!=='none') push(t0+4,3.4,'lead',leadMidi(0,S.atBar+1,0),0.72,{sendEcho:0.5});
      push(t0+4,0.25,'kick',null,0.85);
      push(t0+4,0.5,'hat',null,0.36);
      if(S.pad){ var vf=ha.voicFin, pj; for(pj=0;pj<vf.length;pj++) push(t0+4+pj*0.01,3.4,'pad',vf[pj]+lf2,0.3); }
      continue;   // the rest of the outro bars are the echo tail
    }
    if(S.riser) push(S.atBar*4,S.bars*4-0.25,'fx',null,0.45+0.05*S.e/2,{sendEcho:0.25});
    // PHRASE BREATHING: after every 3rd/4th hook statement the lead rests a bar
    // while the groove keeps pumping — the classic chiptune verse move (real GB:
    // ~half of per-channel bars hold a full beat of silence; this lead used to
    // play 81% of ALL bars with 23-bar unbroken runs). Irregular by seed — the
    // interval AND phase vary per section, never a fixed 4/8-bar grid. Drops
    // stay full-on (they're the payoff); track opening never rests.
    var restEvery=(S.lead && S.bars>=6 && S.role!=='drop')?3+((rf()*2)|0):0;
    var restPhase=restEvery?((rf()*restEvery)|0):0;
    // PERIOD STRUCTURE: statements alternate A A' A A'' — even statements play
    // the section's op as-is, odd ones a varied answer. Without this, 1-bar
    // hooks restated VERBATIM every bar for a whole section (41% of tracks):
    // the "only ever repeats" failure, the mirror of through-composition.
    var seqA=applyOp(S.op,R(token,'F:op:'+si));
    var seqB=applyOp(S.op==='asis'?'endvar':S.op,R(token,'F:op2:'+si));
    for(bar=0;bar<S.bars;bar++){
      var stmt=Math.floor(bar/mo.hookBars);
      var restBar = restEvery>0 && bar>0 && (S.atBar+bar)>=2 &&
        stmt%restEvery===restPhase && bar%mo.hookBars===mo.hookBars-1;
      var answering = restBar ||
        (S.lead && S.leadEvery>1 && Math.floor(bar/mo.hookBars)%S.leadEvery===1);
      emitDrums(S,si,bar,rf);
      if(S.bass) emitBass(S,si,bar,rf);
      if(S.chord) emitChord(S,si,bar,rf);
      if(S.lead && !restBar) emitLead(S,si,bar,rf,(stmt%2===1)?seqB:seqA);
      if(S.counter&&pal.voices.counter) emitCounter(S,si,bar,rf,answering);
      if(S.pad&&pal.voices.pad) emitPad(S,si,bar);
    }
    if(S.role==='build' && pal.leadMode!=='none'){   // 2-note chromatic pickup into the drop
      var hm=leadMidi(mo.degs[0],S.atBar+S.bars,0);
      push((S.atBar+S.bars)*4-0.5,0.22,'lead',hm-2,0.7);
      push((S.atBar+S.bars)*4-0.25,0.22,'lead',hm-1,0.74);
      prevLeadMidi=hm-1;
    }
    if(S.role==='drop'&&bar>0){   // drop downbeat splash
      push(S.atBar*4,0.6,'hat',null,0.42);
    }
  }
  // ----- order, cap, normalize -----
  var CHORD_ORD={kick:0,snare:1,hat:2,bass:3,chord:4,lead:5,counter:6,pad:7,fx:8};
  ev.sort(function(a,b){ return a.tBeat-b.tBeat || CHORD_ORD[a.ch]-CHORD_ORD[b.ch] || (a.midi||0)-(b.midi||0); });
  if(ev.length>6000){
    var kept=[], hatOdd=0, over=ev.length-6000, i3;
    for(i3=ev.length-1;i3>=0;i3--){ var e2=ev[i3];
      if(over>0 && e2.ch==='hat' && ((e2.tBeat*4)%2+2)%2>=0.5 && e2.dur<0.4){ over--; continue; }
      kept.push(e2);
    }
    kept.reverse(); ev=kept;
  }
  var bins={}, k2, mx=0;
  for(k2=0;k2<ev.length;k2++){ var e3=ev[k2], b2=Math.floor(e3.tBeat);
    var w=(e3.ch==='kick'||e3.ch==='snare'||e3.ch==='hat'||e3.ch==='fx')?0.45:1;
    bins[b2]=(bins[b2]||0)+e3.vel*w; }
  for(k2 in bins) if(bins[k2]>mx) mx=bins[k2];
  var gainScalar=rr(clamp(3.1/Math.max(3.1,mx),0.55,1));
  var palette={ voices:pal.voices, percs:pal.percs, echo:pal.echo, panLayout:pal.panLayout, leadMode:pal.leadMode };
  if(samples.length) palette.samples=samples;
  return {
    v:3, token:token, bpm:gr.bpm, swing:gr.swing, keyPc:ha.keyPc, mode:iv.slice(),
    gainScalar:gainScalar, palette:palette,
    sections:ar.sections.map(function(s){ return {atBar:s.atBar,bars:s.bars,role:s.role,e:s.e}; }),
    totalBars:ar.totalBars, endsCleanAtBeat:ar.totalBars*4,
    events:ev
  };
}

// ---------- fingerprint: stages A-C only (cheap; used by the radio queue) ----------
function fingerprint(token){
  token=normToken(token);
  var pal=stPalette(token), gr=stGroove(token,pal), ha=stHarmony(token,pal);
  return { bpm:gr.bpm, keyPc:ha.keyPc, brightness:rr(pal.brightness), waveClass:pal.waveClass,
    grooveFamily:gr.family, density:gr.density, energyPeak:peakEnergy(token), echoDepth:pal.echo.level, leadMode:pal.leadMode };
}

var API={ V:3, id:'rrr_core', compile:compile, fingerprint:fingerprint };
G.CT_COMPOSERS = G.CT_COMPOSERS || {};
G.CT_COMPOSERS.rrr_core = API;
if(typeof module!=='undefined' && module.exports) module.exports = API;
})();
