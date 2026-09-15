// One deterministic tracker musician. Musical depth lives here; product
// selection, critics, candidates, templates, and taste models do not.
(function(){
'use strict';
var G=typeof globalThis!=='undefined'?globalThis:window,REV='musician-12';
if(typeof module!=='undefined'&&!G.CT_STYLE_CORPUS){try{require('./style-corpus.js');}catch(e){}}
if(typeof module!=='undefined'&&module.exports&&!G.CT_CHIP_INSTRUMENTS)require('./chip-instruments.js');
if(typeof module!=='undefined'&&module.exports&&!G.CT_MELODY)require('./melody.js');
if(typeof module!=='undefined'&&module.exports&&!G.CT_GB)require('./gb-hardware.js');
if(typeof module!=='undefined'&&module.exports&&!G.CT_GB_VOICES)require('./gb-voices.js');
function hash(s){s=String(s);var h=2166136261>>>0;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed,label){var a=hash(REV+':'+seed+':'+label);return function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function pick(r,a){return a[Math.floor(r()*a.length)%a.length];}function ri(r,a,b){return a+Math.floor(r()*(b-a+1));}
function chance(r,p){return r()<p;}function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function mod(v,n){return((v%n)+n)%n;}function round(v){return Math.round(v*1000)/1000;}
function weighted(r,rows){if(!rows||!rows.length)return null;var total=rows.reduce(function(n,x){return n+(x.count||x.tracks||1);},0),at=r()*total;
  for(var i=0;i<rows.length;i++){at-=rows[i].count||rows[i].tracks||1;if(at<=0)return rows[i];}return rows[rows.length-1];}
function trainedModel(r){var all=G.CT_CHIP_INSTRUMENTS&&G.CT_CHIP_INSTRUMENTS.composition||{},rows=Object.keys(all).map(function(k){return{id:k,tracks:all[k].tracks,model:all[k]};});
  return weighted(r,rows)||{id:'nes',model:null};}
function roleCell(r,model,role,key){var m=model&&model.roleModels&&model.roleModels[role];return weighted(r,m&&m[key]);}
function semiDegree(n,len){len=len||7;var s=Math.sign(n),a=Math.abs(n);return s*Math.max(a?1:0,Math.round(a*len/12));}
function midi(d,key,scale,base){var L=scale.length;return base+key+scale[mod(d,L)]+Math.floor(d/L)*12;}
function mutateRows(r,rows,amount){var out=rows.slice();if(chance(r,amount)&&out.length>2)out.splice(ri(r,1,out.length-1),1);
  if(chance(r,amount)){var n=ri(r,1,15);if(out.indexOf(n)<0)out.push(n);}return out.sort(function(a,b){return a-b;});}

// Weighted so the workhorses of game music (pentatonics, aeolian, dorian) turn
// up often and the exotic colours stay special. Non-heptatonic scales are the
// point: a 5-note hirajoshi and a 6-note whole-tone do not just change which
// notes appear, they change what the harmony can even do.
// This is a radio you leave on behind something. The old weights put 60% of
// songs in dark or exotic scales (phrygian-dominant, in-sen, whole-tone...),
// which reads as oppressive over an hour. Bright and gently-minor modes carry
// the station now; the spice survives at spice levels, and the scales that
// only ever sounded like tension cues (whole-tone, in-sen, phrygian-dom) are
// gone from a background stream entirely.
// STYLES. The owner's read was exact: four really different songs and
// everything else derivative -- because one energy profile (pump bass,
// four-on-floor, arp shimmer, ~142 BPM) sat under almost every seed. A song
// now draws a STYLE first: a coherent bundle of tempo band, kit pattern,
// bass engine, accompaniment pool, harmony type, swing and melody density,
// built from the standard genre vocabulary chip musicians actually write in
// (four-on-floor with offbeat hats and claps for house and trance, the
// two-step break for dnb, boom-bap swing, backbeat rock, funk syncopation).
// Fourteen styles crossed with progression, rhythm-cell, pad and kit
// variation puts the distinct-basis count in the hundreds.
var STYLES=[
 {id:'anthem', w:9,bpm:[140,152],sw:0,   kick:'four',    hats:'off8',   bass:'pump',   pads:'arp16', modes:'maj',prog:'anthem',mel:1.0},
 {id:'house',  w:7,bpm:[120,128],sw:0.56,kick:'four',    hats:'off8',   bass:'offbeat',pads:'arp8',  modes:'maj',prog:'vamp2', mel:0.8},
 {id:'trance', w:7,bpm:[134,142],sw:0,   kick:'four',    hats:'off8',   bass:'roll',   pads:'arp16', modes:'any',prog:'vamp2', mel:0.9},
 {id:'techno', w:6,bpm:[128,136],sw:0,   kick:'four',    hats:'roll16', bass:'roll',   pads:'arp16', modes:'min',prog:'static',mel:0.55},
 {id:'dnb',    w:6,bpm:[160,172],sw:0,   kick:'break',   hats:'roll16', bass:'roll',   pads:'echo',  modes:'min',prog:'vamp2', mel:0.7},
 {id:'breaks', w:6,bpm:[126,134],sw:0.56,kick:'break',   hats:'eighth', bass:'pump',   pads:'alberti',modes:'maj',prog:'func', mel:0.9},
 {id:'arcade', w:8,bpm:[148,158],sw:0,   kick:'sync',    hats:'eighth', bass:'pump',   pads:'arp8',  modes:'maj',prog:'func',  mel:1.1},
 {id:'rock',   w:7,bpm:[130,142],sw:0,   kick:'backbeat',hats:'eighth', bass:'root5',  pads:'none',  modes:'maj',prog:'func',  mel:1.0},
 {id:'punk',   w:5,bpm:[150,162],sw:0,   kick:'backbeat',hats:'eighth', bass:'root5',  pads:'none',  modes:'maj',prog:'func',  mel:1.1},
 {id:'funk',   w:5,bpm:[102,112],sw:0.56,kick:'sync',    hats:'off8',   bass:'offbeat',pads:'echo',  modes:'min',prog:'vamp2', mel:0.85},
 {id:'boombap',w:4,bpm:[84,94],  sw:0.60,kick:'boom',    hats:'eighth', bass:'walk',   pads:'held',  modes:'min',prog:'vamp2', mel:0.6},
 {id:'chill',  w:5,bpm:[96,108], sw:0,   kick:'half',    hats:'quarter',bass:'walk',   pads:'held',  modes:'maj',prog:'func',  mel:0.5},
 {id:'ballad', w:3,bpm:[76,88],  sw:0,   kick:'half',    hats:'sparse', bass:'walk',   pads:'held',  modes:'any',prog:'func',  mel:0.6},
 {id:'drone',  w:2,bpm:[70,82],  sw:0,   kick:'none',    hats:'sparse', bass:'walk',   pads:'held',  modes:'maj',prog:'static',mel:0.35}
];
// Each style reads its pattern pools from the corpus bucket that matches its
// feel: 74,552 VGM MIDI files mined on the PC into joint kit patterns
// (kick+snare+hat as one bar, so they cohere), bass onset masks, and 4-bar
// chord-root movements, bucketed by drum signature and tempo.
var STYLE_BUCKET={anthem:'four_fast',trance:'four_fast',house:'four_mid',techno:'four_mid',
  dnb:'break_fast',breaks:'break_mid',arcade:'backbeat_fast',punk:'backbeat_fast',
  rock:'backbeat_mid',funk:'sync_slow',boombap:'sync_slow',chill:'nodrum_mid',
  ballad:'nodrum_slow',drone:'nodrum_slow'};
function corpusBucket(style){
  var C=G.CT_STYLE_CORPUS;if(!C||!style)return null;
  return C[STYLE_BUCKET[style.id]]||null;
}
function pickPair(r,rows){
  if(!rows||!rows.length)return null;
  var t=0,i;for(i=0;i<rows.length;i++)t+=rows[i][1];
  var at=r()*t;
  for(i=0;i<rows.length;i++){at-=rows[i][1];if(at<=0)return rows[i][0];}
  return rows[rows.length-1][0];
}
function normalizedPremise(raw){
  if(!raw||typeof raw!=='object')return null;
  var known={};STYLES.forEach(function(s){known[s.id]=1;});
  var styles=Array.isArray(raw.styles)?raw.styles.filter(function(s,i,a){return known[s]&&a.indexOf(s)===i;}):null;
  var mode=raw.mode==='maj'||raw.mode==='min'?raw.mode:null;
  var bpmMin=Number.isFinite(raw.bpmMin)?Math.max(0,Math.round(raw.bpmMin)):0;
  var bpmMax=Number.isFinite(raw.bpmMax)?Math.max(0,Math.round(raw.bpmMax)):999;
  if(!styles||!styles.length)styles=null;
  if(!styles&&!mode&&bpmMin<=0&&bpmMax>=999)return null;
  return{styles:styles,mode:mode,bpmMin:bpmMin,bpmMax:bpmMax};
}
function styleModes(style){
  if(style&&style.modes==='maj')return MODES.filter(function(m){return MAJ_MODES[m.name];});
  if(style&&style.modes==='min')return MODES.filter(function(m){return !MAJ_MODES[m.name];});
  return MODES;
}
function styleAnswers(style,p){
  if(p.styles&&p.styles.indexOf(style.id)<0)return false;
  if(p.mode&&!styleModes(style).some(function(m){return (p.mode==='maj')===!!MAJ_MODES[m.name];}))return false;
  return Math.max(style.bpm[0],p.bpmMin)<=Math.min(style.bpm[1],p.bpmMax);
}
function pickStyle(token,premise){
  var pool=premise?STYLES.filter(function(s){return styleAnswers(s,premise);}):STYLES;
  if(!pool.length)return null;
  var t=0,i;for(i=0;i<pool.length;i++)t+=pool[i].w;
  var at=hash(token+':style')%t;
  for(i=0;i<pool.length;i++){at-=pool[i].w;if(at<0)return pool[i];}
  return pool[0];
}
var MODES=[
  {name:'ionian',scale:[0,2,4,5,7,9,11],w:12},   {name:'mixolydian',scale:[0,2,4,5,7,9,10],w:10},
  {name:'lydian',scale:[0,2,4,6,7,9,11],w:10},   {name:'pent-major',scale:[0,2,4,7,9],w:8},
  {name:'dorian',scale:[0,2,3,5,7,9,10],w:3},    {name:'aeolian',scale:[0,2,3,5,7,8,10],w:1},
  {name:'blues',scale:[0,3,5,6,7,10],w:1}
];
var MAJ_MODES={ionian:1,mixolydian:1,lydian:1,'pent-major':1};
function pickMode(r,style,premise){
  var pool=styleModes(style);
  if(premise&&premise.mode){var constrained=pool.filter(function(m){return (premise.mode==='maj')===!!MAJ_MODES[m.name];});if(constrained.length)pool=constrained;}
  var t=0,i;for(i=0;i<pool.length;i++)t+=pool[i].w;var at=r()*t;
  for(i=0;i<pool.length;i++){at-=pool[i].w;if(at<=0)return pool[i];}return pool[0];}
// Sections used to differ only in drum-mutation rate and a velocity nudge, so
// every song was the same two textures (full / thin) in a different order --
// 59 distinct sequences that all sounded alike. A section now carries a PROFILE
// saying which voices play, what register the tune sits in, how the rhythm
// feels and where the harmony sits, so a break is a different piece of music
// from a drop rather than the same one quieter.
var SECTIONS={
  opening: {voices:{bass:1,arp:0,pad:1,drums:0},oct:0,feel:'half',    shift:0,e:2.8,act:0.30},
  groove:  {voices:{bass:1,arp:1,pad:0,drums:1},oct:0,feel:'straight',shift:0,e:5.0,act:0.62},
  flow:    {voices:{bass:1,arp:0,pad:1,drums:1},oct:0,feel:'straight',shift:0,e:4.6,act:0.55},
  lift:    {voices:{bass:1,arp:1,pad:0,drums:1},oct:1,feel:'straight',shift:0,e:6.6,act:0.72},
  drive:   {voices:{bass:1,arp:1,pad:0,drums:1},oct:0,feel:'double',  shift:0,e:7.2,act:0.80},
  break:   {voices:{bass:1,arp:0,pad:1,drums:0},oct:0,feel:'half',    shift:0,e:3.0,act:0.28},
  hush:    {voices:{bass:1,arp:1,pad:0,drums:0},oct:-1,feel:'half',   shift:0,e:2.6,act:0.24},
  build:   {voices:{bass:1,arp:1,pad:0,drums:1},oct:0,feel:'straight',shift:0,e:5.9,act:0.68},
  drop:    {voices:{bass:1,arp:1,pad:1,drums:1},oct:0,feel:'straight',shift:0,e:7.4,act:0.78},
  resolve: {voices:{bass:1,arp:1,pad:1,drums:0},oct:0,feel:'half',    shift:0,e:2.4,act:0.20}
};
// Macro shapes. Game music is usually a short loop, not a pop arc, so the
// templates lean that way -- but the song's overall SHAPE now varies too,
// instead of every track being intro -> middle -> resolve.
// chipzel on her own tracks: "looping tracks that escalate in intensity".
// Every body is a STAIRCASE -- energy climbs to the end, with one dip so the
// last climb hits harder.
var FORMS=[
  {id:'climb',  body:['groove','lift','break','drive','lift','drop']},
  {id:'surge',  body:['flow','groove','lift','hush','drive','drop']},
  {id:'loop',   body:['groove','lift','groove','build','drive','drop']},
  {id:'call',   body:['groove','break','lift','build','drop','drop']},
  {id:'anthem', body:['flow','lift','build','drop','break','drop']}
];
var CALM_FORMS=['climb','surge','loop'];
function makeForm(token,bars,model,bpm,heat){
  // A radio track has to arrive: 2-4 bars of opening, not 4-8.
  var r=rng(token,'form'),out=[],at=0;
  // A calm song must not be handed the 'hard' template: below the midline the
  // shape comes from the gentle set, and 'hard' exists only for the hottest.
  var pool=FORMS;
  if(heat<0.45)pool=FORMS.filter(function(f){return CALM_FORMS.indexOf(f.id)>=0;});
  else if(heat<0.62)pool=FORMS.filter(function(f){return f.id!=='hard';});
  var tpl=pool[hash(token+':form')%pool.length];
  var opening=pick(r,[2,2,3,4]),ending=pick(r,[4,4,6]);
  function put(n,role){var p=SECTIONS[role]||SECTIONS.groove;
    out.push({startBar:at,bars:n,role:role,e:p.e+(r()-0.5)*1.2,activity:p.act+(r()-0.5)*0.16,
              voices:p.voices,oct:p.oct,feel:p.feel,shift:p.shift});at+=n;}
  put(opening,'opening');
  var remain=bars-opening-ending;
  var change=model&&model.sectionChangeRate&&model.sectionChangeRate.p50||2.5;
  // sections cap at 8 bars: the scene changes before it wears out
  var target=clamp(Math.round(60/change*bpm/240),4,8),k=0;
  while(remain>0){
    var choices=[4,6,8].filter(function(n){return n<=remain&&(remain-n===0||remain-n>=4)&&Math.abs(n-target)<=4;});
    if(!choices.length)choices=[4,6,8].filter(function(n){return n<=remain&&(remain-n===0||remain-n>=4);});
    var n=remain<=8?remain:pick(r,choices);
    put(n,tpl.body[k%tpl.body.length]);k++;remain-=n;}
  put(ending,'resolve');
  out.formId=tpl.id;return out;
}

function atSection(form,bar){for(var i=form.length-1;i>=0;i--)if(bar>=form[i].startBar)return form[i];return form[0];}
// Chord roots used to be a random walk from a random start -- 5.8 of 7 degrees
// visited per song and only 12% of phrases beginning on the tonic, so the ear
// never learned where home was. Progressions are drawn from a small functional
// grammar now (the same loops game and pop music actually run), stated in
// 7-degree space and mapped onto shorter scales. The every-3rd-phrase variant
// is a DECEPTIVE CADENCE -- the last chord resolves somewhere unexpected but
// still diatonic -- rather than a chromatic alteration out of key.
var PROG_MAJ=[[0,5,3,4],[0,3,4,0],[0,4,5,3],[0,3,0,4],[0,5,1,4],[0,1,4,0]];
var PROG_MIN=[[0,5,2,6],[0,3,4,0],[0,6,5,4],[0,2,5,6],[0,3,0,6],[0,5,3,4]];
var PROG_ANTHEM=[[0,4,5,3],[0,5,3,4],[0,3,4,4],[0,4,3,4]];
var PROG_VAMP2=[[0,0,3,3],[0,0,5,5],[0,0,4,4],[0,0,6,6],[0,3,0,3],[0,5,0,5]];
var PROG_STATIC=[[0,0,0,0],[0,0,0,6],[0,0,0,3]];
function makeHarmony(token,model,mode,style){
  var scale=mode.scale,len=scale.length,r=rng(token,'harmony');
  var majorish=scale.indexOf(4)>=0;
  var kind=style&&style.prog||'func';
  var pool=kind==='anthem'?PROG_ANTHEM:kind==='vamp2'?PROG_VAMP2:kind==='static'?PROG_STATIC
          :(majorish?PROG_MAJ:PROG_MIN);
  var prog=pick(r,pool).slice();
  // 40% of non-static songs take a mined 4-bar root movement instead: the
  // semitone trigram walks from the tonic and lands on the nearest scale
  // degrees. "0,0,0" (static harmony, the most common bar movement in all of
  // VGM) is excluded here because the static styles already own it.
  var B=corpusBucket(style);
  if(kind!=='static'&&B&&chance(r,0.4)){
    var rows=(B.progs||[]).filter(function(p){return p[0]!=='0,0,0';});
    var tri=pickPair(r,rows);
    if(tri){
      var mv=String(tri).split(',').map(Number),semi=0,mp=[0];
      for(var mi=0;mi<3;mi++){semi=(semi+mv[mi])%12;mp.push(semi);}
      prog=mp.map(function(sm){var bd=0,bv=99;
        for(var di=0;di<len;di++){var dd=Math.min(Math.abs(scale[di]-sm),12-Math.abs(scale[di]-sm));
          if(dd<bv){bv=dd;bd=di;}}
        return bd;});
    }
  }
  if(kind==='func'&&chance(r,0.35)){var second=pick(r,pool);if(second[0]===0)prog=prog.concat(second);}
  var map7=function(d){return len===7?d:clamp(Math.round(d*len/7),0,len-1);};
  var roots=prog.map(map7);
  var altered=roots.slice();
  var dec=map7(roots[roots.length-1]===map7(5)?3:5);
  altered[altered.length-1]=dec;
  return{roots:roots,altered:altered};
}
// The kit is the style's signature: four-on-the-floor with the clap on 2 and
// 4 for house and trance, the two-step break for dnb, boom-bap's dragged
// kicks, the rock backbeat. Small deterministic mutations keep two songs in
// one style from sharing a bar, and a third of non-rolling kits swap their
// hat line for a REAL bar mask learned from the GB corpus.
var KIT={
  four:    {k:[0,4,8,12], s:[4,12]},
  'break': {k:[0,10],     s:[4,12]},
  backbeat:{k:[0,8],      s:[4,12]},
  boom:    {k:[0,7,10],   s:[4,12]},
  sync:    {k:[0,3,8,11], s:[4,12]},
  half:    {k:[0],        s:[8]},
  none:    {k:[],         s:[]}
};
var HATLINE={
  off8:[2,6,10,14], eighth:[0,2,4,6,8,10,12,14],
  roll16:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  quarter:[0,4,8,12], sparse:[0,8]
};
function maskRows(m){var out=[];for(var q=0;q<16;q++)if(m>>q&1)out.push(q);return out;}
function makeGroove(token,model,heat,style){
  var r=rng(token,'groove'),sync=r(),density=r();
  var kick,snare,hat;
  // 60% of songs play a REAL bar from the mined corpus: kick, snare and hats
  // together, so the pattern coheres the way a sequenced bar does
  var B=corpusBucket(style),mined=B&&chance(r,0.6)?pickPair(r,B.kits):null;
  if(mined){kick=maskRows(mined[0]);snare=maskRows(mined[1]);hat=maskRows(mined[2]);}
  else{
    var kit=KIT[style&&style.kick]||KIT.four;
    kick=kit.k.slice();snare=kit.s.slice();
    hat=(HATLINE[style&&style.hats]||HATLINE.eighth).slice();
  }
  // mutation: one extra kick somewhere sensible, sometimes; one hat dropped
  if(kick.length&&chance(r,0.4)){var ex=pick(r,[6,10,14,3,11]);if(kick.indexOf(ex)<0)kick.push(ex);}
  if(hat.length>4&&chance(r,0.5))hat.splice(ri(r,0,hat.length-1),1);
  if(style&&style.hats!=='roll16'&&chance(r,0.33)){
    var learned=roleCell(r,model,'percussion','barMasks');
    if(learned){var mask=parseInt(learned.id,16);hat=[];for(var q=0;q<16;q++)if(mask&(1<<q))hat.push(q);}
  }
  kick.sort(function(a,b){return a-b;});
  return{kick:kick,snare:snare,hat:hat,sync:sync,density:density,half:(style&&style.kick)==='half'};
}
function makeMotif(token,label,min,max,model,role){
  var r=rng(token,label),n=ri(r,min,max),steps=[ri(r,0,3)],degrees=[ri(r,-2,3)],gaps=[];
  var rhythm=roleCell(r,model,role,'rhythmCells'),intervals=roleCell(r,model,role,'intervalCells');
  var rg=rhythm?rhythm.id.split('-').map(Number):[1,2,2,3,4,5],iv=intervals?intervals.id.split(',').map(Number).map(semiDegree):[-2,-1,1,1,2];
  // The drawn gap used to be computed, pushed, used -- and then immediately
  // overwritten by the cell on the next line, so the randomness was dead code
  // and the cell cycled from index 0 forever. Rotate the cell instead, and let
  // the drawn gap actually stand in where the cell has nothing to say.
  var rot=ri(r,0,Math.max(0,rg.length-1));
  for(var i=1;i<n;i++){var gap=pick(r,[1,2,2,3,4,5]);
    gap=clamp(rg[(rot+i-1)%rg.length]||gap,1,8);gaps.push(gap);steps.push(steps[i-1]+gap);
    var leap=iv[(i-1)%iv.length];degrees.push(clamp(degrees[i-1]+leap,-7,11));}
  return{steps:steps,degrees:degrees,gaps:gaps};
}
function wavetable(r,n){var a=[];for(var i=0;i<n;i++)a.push(round((0.8+r()*0.4)/Math.pow(i+1,1.15+r()*1.8)));return a;}
function chipPatch(r,types,system){
  var bank=G.CT_CHIP_INSTRUMENTS&&G.CT_CHIP_INSTRUMENTS.patches||[],rows=bank.filter(function(x){return types.indexOf(x.patch.type)>=0;});
  if(system&&chance(r,.82)){var local=rows.filter(function(x){return x.patch.system===system;});if(local.length)rows=local;}
  if(!rows.length)return null;var total=rows.reduce(function(n,x){return n+Math.sqrt(x.weight||1);},0),at=r()*total;
  for(var i=0;i<rows.length;i++){at-=Math.sqrt(rows[i].weight||1);if(at<=0)return rows[i].patch;}return rows[rows.length-1].patch;
}
function patchEnv(p){
  var e=p&&p.envelope||{},rate=e.rate||0,dec=.055+(rate+1)*.055;
  if(e.constant)return{a:.002,d:.02,s:clamp(e.initial||.7,.08,1),r:.025};
  if(e.direction==='up')return{a:clamp(dec*.35,.02,.3),d:.02,s:clamp(e.initial+.35,.25,1),r:.035};
  return{a:.002,d:dec,s:e.loop ? .22 : 0,r:.025};
}
function noiseRate(p){if(!p||p.system!=='gameboy')return 0;var d=[8,16,32,48,64,80,96,112][p.period||0];return 524288/d/Math.pow(2,(p.clockShift||0)+1);}
function voice(r,id,osc,gain,opts){opts=opts||{};var v={id:id,osc:osc,gainMul:gain,duty:opts.duty||0.5,
    env:opts.env||{a:0.003,d:0.07,s:0.5,r:0.06},sendEcho:opts.echo||0,drive:opts.drive||0};
  var p=opts.patch;if(p){v.osc=p.type==='wave'?'wavetable':p.type;v.env=patchEnv(p);if(p.duty)v.duty=p.duty;
    if(p.type==='wave')v.waveTable=p.table.slice();if(p.type==='noise')v.noise={mode:p.mode,period:p.period,followFreq:false};}
  if(opts.pan!=null)v.pan=opts.pan;if(opts.vib)v.vib={rate:3.8+r()*3.6,depth:0.08+r()*0.24,delay:0.14+r()*0.5};
  if(opts.cut)v.filter={type:'lp',cutHz:opts.cut,q:0.65+r()*0.8,envAmt:(r()-0.5)*0.7,envT:0.08+r()*0.28};
  if(v.osc==='pulse'){v.chip={tickHz:60,dutyEnv:opts.duties||[v.duty],dutyEnvLoop:true,retrig:opts.retrig||0};
    if(p&&p.sweep&&p.sweep.shift)v.chip.sweep={enabled:p.sweep.enabled!==false,period:Math.max(1,p.sweep.period||1),shift:p.sweep.shift,direction:p.sweep.direction};}
  if(v.osc==='wavetable'&&!v.waveTable){v.partials=wavetable(r,ri(r,5,11));v.crunchBits=chance(r,0.3)?ri(r,5,7):0;}return v;
}
function palette(token,system){
  var r=rng(token,'palette'),bright=r(),space=r()*0.7,echo=0.025+space*0.14;
  var leadPatch=chipPatch(r,['pulse','wave'],system),bassPatch=chance(r,.58)?chipPatch(r,['pulse','wave'],system):null,arpPatch=chipPatch(r,['pulse','wave'],system);
  var snarePatch=chipPatch(r,['noise'],system),hatPatch=chipPatch(r,['noise'],system);
  var leadOsc=leadPatch?leadPatch.type:pick(r,['pulse','tri','wavetable']),bassOsc=bassPatch?bassPatch.type:pick(r,['tri','tri','pulse','wavetable']);
  return{voices:{
    lead:voice(r,'lead',leadOsc,0.09+r()*0.045,{patch:leadPatch,duty:pick(r,[.125,.25,.5]),echo:echo*.7,vib:true,cut:900+bright*4300}),
    bass:voice(r,'bass',bassOsc,0.42+r()*0.16,{patch:bassPatch,duty:.25,cut:600+bright*1200,env:{a:.002,d:.05,s:.72,r:.035},drive:r()*.35}),
    arp:voice(r,'harmony',arpPatch?arpPatch.type:'pulse',0.075+r()*.045,{patch:arpPatch,duty:pick(r,[.125,.25,.5]),echo:echo*.7,cut:700+bright*3000}),
    pad:voice(r,'pad',pick(r,['sine','tri','wavetable']),0.055+r()*.045,{echo:echo,cut:500+bright*2200,env:{a:.035+r()*.06,d:.18,s:.5,r:.3+r()*.35}}),
    fx:voice(r,'fx',pick(r,['noise','tri','wavetable']),.025+r()*.025,{echo:echo,cut:900+bright*2300})
  },percs:{
    kick:{id:'kick',kind:'kick',tone:{freq:125+r()*55,end:38+r()*18,sweepT:.04+r()*.035,level:.82+r()*.2,decT:.07+r()*.04,osc:'tri'},noise:{mode:15,period:8,level:.02,decT:.015,hp:0},click:{level:.06+r()*.08,decT:.002},gainMul:.58+r()*.12,pan:0,sendEcho:0},
    snare:{id:'snare',kind:'snare',tone:{freq:150,end:100,sweepT:.02,level:.02,decT:.03,osc:'sine'},noise:{mode:snarePatch?snarePatch.mode:15,period:snarePatch?snarePatch.period:ri(r,0,2),rateHz:noiseRate(snarePatch),level:.22+r()*.16,decT:.035+(snarePatch&&snarePatch.envelope?snarePatch.envelope.rate*.004:r()*.025),hp:.42+r()*.18},click:{level:.006,decT:.001},gainMul:.25+r()*.1,pan:0,sendEcho:0},
    hat:{id:'hat',kind:'hat',tone:{freq:500,end:500,sweepT:.01,level:0,decT:.02,osc:'pulse'},noise:{mode:hatPatch?hatPatch.mode:15,period:hatPatch?hatPatch.period:ri(r,0,3),rateHz:noiseRate(hatPatch),level:.24+r()*.17,decT:.012+(hatPatch&&hatPatch.envelope?hatPatch.envelope.rate*.002:r()*.018),hp:.7+r()*.18},click:{level:.006,decT:.001},gainMul:.22+r()*.09,pan:.2,sendEcho:0},
    extra:{id:'extra',kind:chance(r,.5)?'tom':'zap',tone:{freq:140+r()*180,end:70+r()*80,sweepT:.05+r()*.08,level:.2+r()*.2,decT:.07+r()*.09,osc:'tri'},noise:{mode:15,period:8,level:.06,decT:.04,hp:.1},click:{level:.01,decT:.002},gainMul:.23+r()*.1,pan:-.2,sendEcho:echo*.25}
  },echo:{beats:pick(r,[.375,.5,.75,1]),fb:.1+space*.24,level:echo,damp:.52+r()*.25,spreadMs:ri(r,8,25),pingPong:true},
  panLayout:{lead:-.18,bass:0,arp:.2,pad:-.1,fx:.32,kick:0,snare:0,hat:.2,extra:-.2}};
}
// Which Game Boy channel carries which musical role. This is a compositional
// choice, not a mapping applied afterwards: a song whose tune sits on the wave
// channel is a different piece of music from one whose tune sits on a pulse.
var PLANS=[
  {id:'pulse-lead', mel:0, harm:1, bass:2, drums:1, arpFrames:4},
  {id:'wave-lead',  mel:2, harm:0, bass:1, drums:1, arpFrames:5},
  {id:'twin-pulse', mel:0, harm:1, bass:2, drums:1, arpFrames:4},
  {id:'sparse',     mel:0, harm:-1,bass:2, drums:1, arpFrames:6},
  {id:'duo',        mel:0, harm:-1,bass:2, drums:0, arpFrames:5},
  {id:'arp-led',    mel:-1,harm:1, bass:2, drums:1, arpFrames:4}
];
// Per-style timbre: each style names the envelope characters and duties its
// lead wants, and whether its bass wave is buzzy (saw, square, thin) or
// mellow (triangle, sine, organ). The pools filter the bank; the hash picks
// within the pool, so two songs in one style still differ.
var TIMBRE={
 anthem:{lead:['pluck','stab'],duty:[0.5,0.25],bass:'buzzy'},
 house:{lead:['stab','soft'],duty:[0.25,0.5],bass:'buzzy'},
 trance:{lead:['pluck','stab'],duty:[0.5,0.25],bass:'buzzy'},
 techno:{lead:['pluck'],duty:[0.25,0.125],bass:'buzzy'},
 dnb:{lead:['pluck','stab'],duty:[0.125,0.25],bass:'buzzy'},
 breaks:{lead:['stab'],duty:[0.25,0.5],bass:'buzzy'},
 arcade:{lead:['pluck','stab'],duty:[0.5,0.25],bass:'buzzy'},
 rock:{lead:['sus','stab'],duty:[0.5,0.75],bass:'buzzy'},
 punk:{lead:['sus'],duty:[0.75,0.5],bass:'buzzy'},
 funk:{lead:['stab','pluck'],duty:[0.25,0.125],bass:'mellow'},
 boombap:{lead:['soft','stab'],duty:[0.25,0.125],bass:'mellow'},
 chill:{lead:['soft','sus'],duty:[0.5,0.25],bass:'mellow'},
 ballad:{lead:['soft','sus'],duty:[0.5,0.75],bass:'mellow'},
 drone:{lead:['swell','soft'],duty:[0.75,0.5],bass:'mellow'}
};
var MELLOW_KIT={boombap:1,chill:1,ballad:1,drone:1};
function pickBank(token,style){
  var B=G.CT_GB&&G.CT_CHIP_INSTRUMENTS?G.CT_GB.buildBank(G.CT_CHIP_INSTRUMENTS.patches):null;
  if(!B)return null;
  // editorOnly patches exist for the Create palette alone. The pools below are
  // indexed by hash(token) % pool.length, so letting one in would re-instrument
  // every song that was ever shared.
  var by=function(t){return B.meta.filter(function(m){return m.type===t&&!(m.patch&&m.patch.editorOnly);});};
  var pulses=by('pulse'),waves=by('wave'),noises=by('noise');
  function envClass(m){var rec=B.instruments[m.index],v0=(rec[1]>>4)&15,pace=rec[1]&7,dir=(rec[1]>>3)&1;
    if(dir)return 'swell'; if(pace===0)return 'sus'; if(v0<=8)return 'soft';
    return pace<=1?'pluck':'stab';}
  function waveClass(m){var t=B.waveTables[m.waveSlot]||[],big=0;
    for(var i=1;i<t.length;i++)if(Math.abs(t[i]-t[i-1])>=6)big++;
    return big>=1?'buzzy':'mellow';}
  var pref=(style&&TIMBRE[style.id])||TIMBRE.anthem;
  function pool(list,fils){for(var i=0;i<fils.length;i++){var f=list.filter(fils[i]);if(f.length)return f;}return list;}
  var leadPool=pool(pulses,[
    function(m){return pref.lead.indexOf(envClass(m))>=0&&pref.duty.indexOf(m.patch.duty)>=0;},
    function(m){return pref.lead.indexOf(envClass(m))>=0;}]);
  var lm=leadPool[hash(token+':v-lead')%leadPool.length];
  var altPool=pool(pulses,[
    function(m){return m.patch.duty!==lm.patch.duty&&pref.lead.indexOf(envClass(m))>=0;},
    function(m){return m.patch.duty!==lm.patch.duty;}]);
  var harmPool=pool(pulses,[
    function(m){return m.patch.duty!==lm.patch.duty&&(envClass(m)==='soft'||envClass(m)==='sus');},
    function(m){return m.patch.duty!==lm.patch.duty;}]);
  var bassPool=pool(waves,[function(m){return waveClass(m)===pref.bass;}]);
  var at=function(a,salt){return a.length?a[hash(token+':'+salt)%a.length].index:0;};
  var ns=noises.slice().sort(function(a,b){return (a.patch.clockShift||0)-(b.patch.clockShift||0);});
  var third=Math.max(1,Math.floor(ns.length/3));
  var hatPool=MELLOW_KIT[style&&style.id]?ns.slice(third,third*2):ns.slice(0,third);
  return {bank:B,inst:{
    lead:lm?lm.index:0, harm:at(harmPool,'v-harm'),
    leadAlt:at(altPool,'v-lead-alt'),
    blip:at(pulses,'v-blip'), bass:at(bassPool,'v-bass'),
    hat:at(hatPool,'v-hat'), snare:at(ns.slice(third,third*2),'v-snare'),
    kick:at(ns.slice(-third),'v-kick')}};
}
function compile(token,rawPremise){
  var premise=normalizedPremise(rawPremise);
  token=String(token||'chiptunes');var pr=rng(token,'premise'),trained=trainedModel(pr),model=trained.model;
  var style=pickStyle(token,premise);
  if(!style)throw new Error('No composer style satisfies this premise');
  var mode=pickMode(pr,style,premise),key=ri(pr,0,11),SLEN=mode.scale.length;
  // heat is intensity WITHIN the style now: how hard a house track pushes,
  // not whether the song is a banger at all
  var heat=0.45+((hash(token+':heat')%1000)/1000)*0.45;
  // the style owns its tempo band; heat leans toward its top
  var bpmLo=style.bpm[0],bpmHi=style.bpm[1];
  if(premise){var lo=Math.max(bpmLo,premise.bpmMin),hi=Math.min(bpmHi,premise.bpmMax);if(lo<=hi){bpmLo=lo;bpmHi=hi;}}
  var bpm=Math.round(bpmLo+(bpmHi-bpmLo)*(((hash(token+':bpmf')%100)/100)*0.6+heat*0.4));
  // "Tracks too long, sections too long": ~85 seconds, not two minutes.
  var bars=clamp(Math.round((88*bpm/240)/4)*4,36,56),form=makeForm(token,bars,model,bpm,heat),harm=makeHarmony(token,model,mode,style),groove=makeGroove(token,model,heat,style);
  var bassMotif=makeMotif(token,'bass-motif',3,6,model,'bass'),leadMotif=makeMotif(token,'lead-motif',5,10,model,'lead'),events=[],ordinal=0;
  // The composer writes ONTO THE MACHINE. Every note is placed on one of the
  // four channels as it is thought of; a channel cannot hold two notes, so
  // nothing downstream ever removes anything and the browser and the ROM are
  // playing the same piece rather than two versions of it.
  var PLAN=PLANS[hash(token+':plan')%PLANS.length],GBB=pickBank(token,style);
  // SWING. Half the station shuffles: every offbeat eighth slides late by a
  // fixed fraction of the beat. It is the single cheapest unit of fun the
  // grid owns, and the NES songbook leaned on it constantly.
  var SW=style.sw||0;
  function sw8(t){ if(!SW)return t; var f=t-Math.floor(t); return Math.abs(f-0.5)<0.03?t+(SW-0.5):t; }
  var V=(G.CT_GB_VOICES&&GBB)?new G.CT_GB_VOICES.Voices(bpm):null;
  var CH={lead:PLAN.mel,extra:PLAN.mel,arp:PLAN.harm>=0?PLAN.harm:PLAN.mel,
          pad:PLAN.harm,echo:PLAN.harm,bass:PLAN.bass,kick:3,snare:3,hat:3};
  var PRI={kick:9,snare:7,hat:3,lead:8,extra:6,arp:4,echo:3,pad:2,bass:5};
  var INS=GBB?{lead:GBB.inst.lead,extra:GBB.inst.lead,arp:GBB.inst.harm,pad:GBB.inst.harm,
               echo:GBB.inst.lead,bass:GBB.inst.bass,kick:GBB.inst.kick,snare:GBB.inst.snare,hat:GBB.inst.hat}:{};
  function add(t,dur,ch,note,vel,artic,extra,instOv,sweep){t=sw8(t);var e={tBeat:round(t),dur:round(dur),ch:ch,vel:round(vel),seed:hash(token+':event:'+ordinal++)};
    if(note!=null)e.midi=Math.round(note);if(artic)e.artic=artic;if(extra)Object.assign(e,extra);events.push(e);
    if(V){var c=CH[ch];if(c!=null&&c>=0){var f=V.frameOf(t),fr=Math.max(1,V.frameOf(t+dur)-f);
      var ins=instOv!=null?instOv:INS[ch];
      // A plan can route harmony to the WAVE channel, and that role carries a
      // pulse instrument -- whose byte0 is a duty, not a wave slot. It played
      // whatever table happened to be loaded. Channel 3 gets a wave instrument.
      if(GBB){var rec=GBB.bank.instruments[ins];
        // The instrument has to belong to the channel it lands on. A wave
        // record's byte0 is a table index and a pulse record's is a duty, so
        // the wrong one there is not a different sound -- it is a misread byte.
        // Both directions happen: a plan can route harmony to channel 3, and it
        // can route bass to a pulse channel while keeping its wave patch.
        if(c===2&&(!rec||!(rec[3]&1))) ins=GBB.inst.bass;
        else if(c<2&&rec&&(rec[3]&1)) ins=GBB.inst.lead;}
      V.place(c,f,fr,e.midi!=null?e.midi:null,ins,e.vel,PRI[ch]||1,sweep);}}}
  // ACCOMPANIMENT VOCABULARY. The old pad was one idiom -- a frame-rate chord
  // arpeggio, tones rotating 10-60 times a second -- on nearly every track.
  // That is a tracker STAB effect, not a bed; as a bed it reads as a machine
  // vibrating. Real GB accompaniment is a vocabulary, so each song owns one
  // texture, weighted by heat: a held tone, an offbeat echo, an alberti
  // figure, an arpeggio at MUSICAL rate (eighths you can hear as notes), or
  // nothing at all -- the most common GB texture there is.
  var PADPOOLS={arp16:['arp16','arp8','alberti'],arp8:['arp8','alberti','echo'],
                held:['held','echo','none'],echo:['echo','held','none'],
                none:['none','held','echo'],alberti:['alberti','arp8','echo']};
  var padPool=PADPOOLS[style.pads]||PADPOOLS.held;
  var padStyle=padPool[hash(token+':pad-style')%padPool.length];
  function padTexture(beat,durBeats,root){
    if(!V||PLAN.harm<0||padStyle==='none'||durBeats<1)return;
    var SL=mode.scale.length;
    if(padStyle==='held'){
      var d=(Math.floor(beat/16)%2)?root+4:root;      // root, then the fifth, by 4-bar phrase
      add(beat,Math.max(1,durBeats-.1),'pad',midi(d,key,mode.scale,60),.11);
      return;
    }
    if(padStyle==='echo'){
      for(var b=0;b+2<=durBeats+.01;b+=2)
        add(beat+b+1.5,.35,'pad',midi(root+((b/2)%2?4:2),key,mode.scale,60),.10);
      return;
    }
    var pat=padStyle==='alberti'?[0,4,2,4]:[0,2,4,SL];
    var stepB=padStyle==='arp16'?.25:.5, durN=padStyle==='arp16'?.2:.42;
    for(var i=0,t=0;t<durBeats-.01;i++,t+=stepB)
      add(beat+t,durN,'pad',midi(root+pat[i%pat.length],key,mode.scale,60),.095);
  }
  for(var bar=0;bar<bars;bar++){
    var sec=atSection(form,bar),local=bar-sec.startBar,phrase=Math.floor(bar/harm.roots.length),roots=phrase%3===2?harm.altered:harm.roots;
    var VC=sec.voices||{bass:1,arp:1,pad:1,drums:1},FEEL=sec.feel||'straight',SHIFT=sec.shift||0;
    var drumsOn=VC.drums&&!(heat<0.4&&sec.role==='flow');
    var root=mod(roots[bar%roots.length]+SHIFT,SLEN),nextRoot=mod(roots[(bar+1)%roots.length]+SHIFT,SLEN),r=rng(token,'bar-'+bar),thin=!drumsOn;
    events.push({kind:'chord',tBeat:bar*4,chordOffset:mode.scale[root],chordPcs:[0,2,4].map(function(d){return mod(key+mode.scale[mod(root+d,SLEN)],12);})});
    var amount=sec.role==='drop'?.04:sec.role==='build'?.08:.12,kicks=mutateRows(r,groove.kick,amount),snares=mutateRows(r,groove.snare,amount*.5),hats=mutateRows(r,groove.hat,amount);
    if(thin){kicks=kicks.filter(function(x,i){return i===0||x===8&&sec.role==='break';});snares=sec.role==='break'?snares.slice(0,1):[];hats=hats.filter(function(x){return x%4===0;});}
    var kv=.40+.24*heat;
    if(drumsOn){kicks.forEach(function(row){add(bar*4+row/4,.08,'kick',null,row===0?kv:kv*.72,row===0?{accent:1}:null);});
    snares.forEach(function(row){add(bar*4+row/4,.1,'snare',null,.16+.08*heat+(row%4===0?.03:0));});
    hats.forEach(function(row){add(bar*4+row/4,.05,'hat',null,row%4===0?.08+.05*heat:.05+.03*heat);
      if(FEEL==='double'&&heat>0.55&&row%2===0)add(bar*4+(row+1)/4,.04,'hat',null,.05);});}
    if(local===sec.bars-1&&sec.role!=='resolve')add(bar*4+3.5,.1,'extra',null,.22,{accent:1});
    // FIVE bass engines, one per style family. pump: root-octave oom-pah.
    // root5: root-fifth rock. offbeat: house bass on the "and"s only.
    // roll: the driving eighth ostinato under techno, trance and dnb.
    // walk: the melodic line calm songs keep.
    var bassStyle=(hash(token+':bass-style')%4===3)?'walk':style.bass;
    if(VC.bass&&FEEL!=='half'&&!thin&&bassStyle!=='walk'){
      if(bassStyle==='offbeat'){
        [2,6,10,14].forEach(function(row){
          add(bar*4+row/4,.32,'bass',midi(root,key,mode.scale,36),.42+(sec.e-5)*.012);
        });
      }else{
        for(var pb=0;pb<8;pb++){
          var pd=root;
          if(bassStyle==='pump')pd=(pb%2)?root+SLEN:root;
          else if(bassStyle==='root5')pd=(pb%2)?root+4:root;
          else if(bassStyle==='roll')pd=(pb===3||pb===7)?root+SLEN:root;
          if(pb===7)pd=mod(nextRoot-root+3,SLEN)-3+root;
          add(bar*4+pb*.5,bassStyle==='roll'?.22:.26,'bass',midi(pd,key,mode.scale,36),.40+(sec.e-5)*.012+(pb%2?0:.04));
        }
      }
    }else{
    // half of walking basses stride on onsets mined from real VGM bass lines
    var minedBass=(hash(token+':bass-mined')%2===0)?(function(){var B2=corpusBucket(style);
      var m=B2?pickPair(rng(token,'bass-mask'),B2.bass):null;
      return m?maskRows(m).slice(0,heat<0.5?3:4):null;})():null;
    var bassRows=!VC.bass?[]:FEEL==='half'?[0,8]:thin?[0]:(minedBass&&minedBass.length?minedBass:bassMotif.steps.map(function(x){return mod(x*2,16);}).filter(function(x,i,a){return a.indexOf(x)===i;}).sort(function(a,b){return a-b;}).slice(0,heat<0.5?3:4));
    bassRows.forEach(function(row,i){var md=bassMotif.degrees[i%bassMotif.degrees.length],degree=root+(i===bassRows.length-1&&row>=12?mod(nextRoot-root+3,SLEN)-3:md);
      var next=i+1<bassRows.length?bassRows[i+1]:16,art=i&&Math.abs(md-bassMotif.degrees[(i-1)%bassMotif.degrees.length])>2?{from:midi(root,key,mode.scale,36)}:null;
      add(bar*4+row/4,clamp((next-row)/4-.04,.1,1.7),'bass',midi(degree,key,mode.scale,36),.43+(sec.e-5)*.012,art);});
    }
    var gesture=hash(token+':gesture:'+Math.floor(bar/8))%4;
    if(VC.arp&&bar%(heat<0.45?4:2)===0){
      if(gesture===0)[0,2,4].forEach(function(d,i){add(bar*4+1.5+i*.05,.32,'arp',midi(root+d,key,mode.scale,48),.095);});
      else if(gesture===1)add(bar*4+.5,1.25,'arp',midi(root,key,mode.scale,48),.1,{arp:[0,mode.scale[2],mode.scale[4],12]});
      else if(gesture===2)[0,2,4].forEach(function(d,i){add(bar*4+i*.5,.28,'arp',midi(root+d,key,mode.scale,48),.09);});
      else if(VC.pad)padTexture(bar*4,3.5,root);
    }else if(VC.pad&&bar%4===0)padTexture(bar*4,Math.min(7.5,(sec.bars-local)*4-.2),root);
  }
  // CH1 melody, written as phrases across the whole song rather than a motif
  // re-stamped every bar (see melody.js for why the old cell-cycling failed).
  if(G.CT_MELODY){
    var rootFor=function(b){var ph=Math.floor(b/harm.roots.length),rr=ph%3===2?harm.altered:harm.roots;return rr[b%rr.length];};
    var mel=G.CT_MELODY.write({token:token,rng:rng(token,'melody'),hash:hash,model:model,
      semiDegree:semiDegree,bars:bars,sections:form,rootAt:rootFor,scaleLen:SLEN,
      melDensity:style.mel});
    var mr2=rng(token,'melody-art');
    // Three LSDJ habits land here. LEGATO: a note holds until the next one
    // arrives instead of stabbing and dying, which is most of the difference
    // between a melody and morse code. DUTY CHANGE: hot sections switch the
    // lead to the contrasting pulse width, so a chorus SOUNDS like a chorus.
    // ECHO: when the second pulse is free, each held note answers itself a
    // dotted-eighth later at half volume -- the oldest trick on the machine.
    var HOT={lift:1,drive:1,drop:1,build:1};
    // The echo channel is the delayed copy of the lead, the way two-pulse chip
    // music has always done it -- it needs the second pulse free of a running
    // arpeggio texture, nothing more. Legato filled the note gaps, so gating
    // echo on a gap silenced it almost everywhere (8 of 40 songs).
    var echoOn=(padStyle==='none'||padStyle==='held'||padStyle==='echo')&&PLAN.harm>=0&&(hash(token+':echo')%10<7);
    var placed=[];
    mel.forEach(function(n){
      var beat=n.bar*4+n.pos16/4;
      if(beat>=bars*4)return;
      // Keep the lead in a singable register: above ~MIDI 88 a Game Boy pulse
      // stops reading as a tune and starts reading as a whistle.
      var soct=0,sb=null;for(var si=0;si<form.length;si++)if(n.bar>=form[si].startBar&&n.bar<form[si].startBar+form[si].bars)sb=form[si];
      if(sb&&sb.oct)soct=sb.oct*12;
      // THE BUG THAT MADE IT "RANDOM SOUNDS": midi() adds base+key+scale, so
      // the base IS pitch material and must be a C (multiple of 12). The lead
      // sat on 65 -- an F -- so the whole melody played a fourth off its own
      // harmony, every chord anchor scrambled, out-of-key notes on a seventh
      // of its pitches. The arp gestures sat on 55, a fifth off. Bass (36) and
      // pads (60) were correct, which is why the BACKING felt right and the
      // TUNE felt random.
      var mp=midi(n.degree,key,mode.scale,60)+soct;
      while(mp>88)mp-=12; while(mp<58)mp+=12;
      placed.push({beat:beat,mp:mp,accent:n.accent,land:!!n.answer,hot:!!(sb&&HOT[sb.role])});
    });
    placed.forEach(function(n,i){
      var gap=(i+1<placed.length?placed[i+1].beat:n.beat+2)-n.beat;
      // bounce: runs detach (staccato), held notes still sing (legato) --
      // all-legato was most of why the station read as wistful
      var dur=gap<=0.75?clamp(gap*0.55,.14,.45):clamp(gap*0.9,.25,2.4);
      // The cadence landing gets a hardware FALL: NR10 pace 3, downward,
      // shift 6 -- a gentle pitch drop off the end of the phrase, the oldest
      // articulation the sweep unit owns. Channel 1 only; the chip and the
      // cartridge both honour the same byte.
      var swb=(n.land&&gap>=1&&CH.lead===0)?0x3E:0;
      add(n.beat,dur,'lead',n.mp,.19+mr2()*.05,
        n.accent?{accent:1,dutyStart:pick(mr2,[.125,.25,.5])}:null,
        null,(n.hot&&INS.leadAlt!=null)?INS.leadAlt:null,swb);
      if(echoOn&&gap>=0.45)add(n.beat+.75,.3,'echo',n.mp,.08,null);
    });
  }
  var end=bars*4,lastRoot=harm.roots[(bars-1)%harm.roots.length];add(end-.5,1.25,'bass',midi(lastRoot,key,mode.scale,36),.08);
  events.sort(function(a,b){return(a.tBeat||0)-(b.tBeat||0);});
  var gbNotes=V?V.collect():[];
  var lastN=gbNotes.length?gbNotes[gbNotes.length-1]:null;
  var tracker={format:'CTRACK-1',hardware:'CHIP',mode:mode.name,trainedModel:trained.id,instrumentBank:G.CT_CHIP_INSTRUMENTS&&G.CT_CHIP_INSTRUMENTS.corpusFingerprint||''};
  if(premise)tracker.premise={styles:premise.styles?premise.styles.slice():null,mode:premise.mode,bpmMin:premise.bpmMin,bpmMax:premise.bpmMax};
  return{v:4,composerRevision:REV,token:token,bpm:bpm,
    gb:{plan:PLAN.id,fps:(G.CT_GB?G.CT_GB.FPS:59.7275),notes:gbNotes,
        bank:GBB?GBB.bank:null,instruments:GBB?GBB.inst:null,
        totalFrames:lastN?lastN.frame+lastN.frames:0},beatsPerBar:4,totalBars:bars,endsCleanAtBeat:end,transitionTailBeats:1.25,
    gainScalar:.76,palette:palette(token,trained.id),sections:form,musical:{scale:mode.scale.slice(),rootMidi:60+key,motifDegs:leadMotif.degrees.slice(),leadHint:'lead'},
    form:form.formId,style:style.id,tracker:tracker,background:{attentionBudget:.1},events:events};
}
function duration(token){var s=compile(token);return s.totalBars*4*60/s.bpm;}
// The style table, read-only, so callers can tell whether a premise is
// SATISFIABLE before handing it over. Ten of these fourteen are major-only
// and each has a narrow native tempo range, so a premise combining a style
// with an incompatible mode or tempo band leaves pickStyle() with an empty
// pool -- and the caller's fallback then drops the styles, which is the one
// part of the request it was least entitled to throw away.
function styles(){return STYLES.map(function(s){return {id:s.id,bpm:s.bpm.slice(),modes:s.modes};});}
var API={V:3,id:'rrr_core',revision:REV,compile:compile,duration:duration,styles:styles};
G.CT_COMPOSERS=G.CT_COMPOSERS||{};G.CT_COMPOSERS.rrr_core=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
