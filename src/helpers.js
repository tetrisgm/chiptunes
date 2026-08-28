// AUTO-SPLIT from index.html — classic script, shares global scope (load order matters).
// Draw/colour helpers + particles + the CT_GAMES registry (load after audio).
const hsl = (h,s,l)=> 'hsl('+(Math.round(((h%360)+360)%360))+','+Math.round(Math.max(0,Math.min(100,s)))+'%,'+Math.round(Math.max(0,Math.min(100,l)))+'%)';
var _hueMemo = {}, _hueN = 0;
function hueRot(hex, deg){   // rotate a #rrggbb's hue by deg, RETURN HEX (composes with lighten/darken/pix); grays unaffected
  // Under an installed indexed palette (the DMG and NES screens) hue rotation
  // FIGHTS the quantizer: every rotated colour lands on a different nearest
  // scheme entry, so a girder that pulses hue over the bar renders as three
  // clashing colours striped together. The dungeon learned this and zeroed its
  // own rotation; the other eleven packs never did. The juice is for the
  // continuous-colour CRT face only, so the guard lives here, once.
  if(typeof CT_PAL!=='undefined' && CT_PAL && CT_PAL.installed) return hex;
  if(typeof hex!=='string' || hex[0]!=='#' || hex.length<7) return hex;
  deg = Math.round(deg);
  var key = hex + '|' + deg;
  var memo = _hueMemo[key];
  if(memo !== undefined) return memo;
  var r=parseInt(hex.slice(1,3),16)/255, g2=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  var mx=Math.max(r,g2,b), mn=Math.min(r,g2,b), d=mx-mn, h=0, l=(mx+mn)/2, s=d===0?0:d/(1-Math.abs(2*l-1));
  if(d!==0){ if(mx===r)h=((g2-b)/d)%6; else if(mx===g2)h=(b-r)/d+2; else h=(r-g2)/d+4; h*=60; }
  var H=(((h+deg)%360)+360)%360/360, q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  if(s===0) return hex;
  var out='#'+_hx(_ch(p,q,H+1/3))+_hx(_ch(p,q,H))+_hx(_ch(p,q,H-1/3));
  if(_hueN>4096){ _hueMemo={}; _hueN=0; }        // a session changes palette; do not hoard
  _hueMemo[key]=out; _hueN++;
  return out;
}
// Hoisted out of hueRot: they were rebuilt on every call, and this runs per
// sprite per frame -- hue rotation and the two closures it allocated were 5% of
// all samples taken during play. The memo above is keyed on the colour and a
// WHOLE degree: the rotation advances continuously over a bar, so exact-value
// keys would never hit, and a sub-degree difference cannot survive being
// rounded to an 8-bit channel anyway.
function _ch(p,q,t){ t=(t%1+1)%1; if(t<1/6)return p+(q-p)*6*t; if(t<0.5)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; }
function _hx(v){ return ('0'+Math.round(Math.max(0,Math.min(1,v))*255).toString(16)).slice(-2); }
// ===== MV — music-visual toolkit: the shared "beat = pulse, bar = palette, phrase = variation, energy = intensity"
// language every game uses. Pass the clock from SND.clock() (or {} if absent). Keeps all games' reactivity consistent. =====
const MV = {
  defaults: {
    grid: {gstep:0,phase:0,beat:0,bar:0,spb:0.5,step16:0.125,bpm:120},
    clock: {beatPulse:0,bar:0,barPhase:0,phrase:0,energy:0.12,energyLevel:2,bands:{bass:0,mid:0,treble:0},noteOns:[],primaryNotes:[],roles:{},idle:true}
  },
  role: (cl, name)=>{
    var roles=(cl&&cl.roles)||{}, r=roles[name] || (name==='lead'&&(roles.primary||roles.melody)) || null;
    if(r) return r;
    var bands=(cl&&cl.bands)||{}, notes=(cl&&cl.noteOns)||[], primary=(cl&&cl.primaryNotes)||[];
    if(name==='lead') return {energy:cl&&cl.energy||0, onset:cl&&cl.beatPulse||0, hi:MV.bright(cl), notes:primary.length?primary:notes};
    if(name==='counter') return {energy:(cl&&cl.energy||0)*0.65, onset:cl&&cl.snare||0, hi:0.55, notes:notes.slice(1,5)};
    if(name==='bass') return {energy:bands.bass||0, onset:cl&&cl.kick||0, hi:0.12, notes:[]};
    if(name==='perc') return {energy:Math.max(cl&&cl.kick||0, cl&&cl.snare||0, cl&&cl.hat||0), onset:Math.max(cl&&cl.kick||0, cl&&cl.snare||0, cl&&cl.hat||0), hi:0.75, notes:[]};
    if(name==='noise') return {energy:Math.max(cl&&cl.hat||0, bands.treble||0), onset:cl&&cl.hat||0, hi:0.9, notes:[]};
    return {energy:bands.mid||0, onset:0, hi:0.5, notes:[]};
  },
  notes: (cl, role, max)=>{
    var r=MV.role(cl, role||'lead'), ns=(r&&r.notes)||[];
    return max ? ns.slice(0,max) : ns;
  },
  noteHi: n => Math.max(0,Math.min(1, n&&typeof n.hi==='number' ? n.hi : (((n&&n.band)||8)/23))),
  noteBand: n => Math.max(0,Math.min(31, n&&typeof n.band==='number' ? n.band : Math.round(MV.noteHi(n)*23))),
  noteMag: n => Math.max(0,Math.min(1, n&&typeof n.mag==='number' ? n.mag : (n&&typeof n.energy==='number' ? n.energy : 0.25))),
  noteKey: n => String((n&&n.id!=null?n.id:(n&&n.native&&n.native.id!=null?n.native.id:(n&&n.channel||'n')+':'+(n&&n.band||0)+':'+(n&&n.hz||0)))),
  frame: (SND, st, key)=>{
    var gr=MV.defaults.grid, cl=MV.defaults.clock, vis=null;
    try{ if(SND&&typeof SND.grid==='function') gr=SND.grid()||gr; }catch(e){}
    try{ if(SND&&typeof SND.clock==='function') cl=SND.clock()||cl; }catch(e){}
    try{ if(SND&&typeof SND.vis==='function') vis=SND.vis()||null; }catch(e){}
    var roles={
      lead:MV.role(cl,'lead'), counter:MV.role(cl,'counter'), bass:MV.role(cl,'bass'),
      perc:MV.role(cl,'perc'), noise:MV.role(cl,'noise'), pad:MV.role(cl,'pad')
    };
    var bpm=Math.max(1, gr.bpm || cl.bpm || (vis&&vis.bpm) || 120), spb=gr.spb || (60/bpm);
    var out={
      cl:cl, gr:gr, vis:vis, roles:roles,
      lead:roles.lead, counter:roles.counter, bass:roles.bass, perc:roles.perc, noise:roles.noise, pad:roles.pad,
      bpm:bpm, spb:spb, gstep:gr.gstep||0, phase:gr.phase||0, beat:gr.beat||0, bar:gr.bar||cl.bar||0,
      beatPulse:MV.beat(cl), pulse:MV.pulse(cl), barHue:MV.barHue(cl), phrase:MV.phrase(cl),
      energy:MV.energy(cl), energyLevel:Math.max(0,Math.min(10,(cl.energyLevel||0))), bright:MV.bright(cl),
      drop:MV.isDrop(cl), idle:!!(cl.idle||cl.paused), paused:!!cl.paused
    };
    if(st){
      key=key||'frame';
      var bk='_mvfBeat_'+key, sk='_mvfStep_'+key, rk='_mvfBar_'+key, dk='_mvfDrop_'+key;
      out.newBeat = st[bk]!=null && out.beat!==st[bk]; st[bk]=out.beat;
      out.newStep = st[sk]!=null && Math.floor(out.gstep)!==st[sk]; st[sk]=Math.floor(out.gstep);
      out.newBar = st[rk]!=null && out.bar!==st[rk]; st[rk]=out.bar;
      out.dropEdge = out.drop && !st[dk]; st[dk]=!!out.drop;
      st._mvFrame = out;
    } else out.newBeat=out.newStep=out.newBar=out.dropEdge=false;
    return out;
  },
  beat:   cl => cl ? (cl.beatPulse||0) : 0,                                   // 0-1 reactive beat pulse (kick/lead-driven)
  bar:    cl => cl ? (cl.bar||0) : 0,
  phrase: cl => cl ? (cl.phrase||0) : 0,
  // sprite SCALE pulse on the beat — subtle by default (1.00 .. 1.00+amt); use bigger amt only for drops/big hits
  pulse:  (cl, amt)=> 1 + (amt==null?0.035:amt) * (cl?(cl.beatPulse||0):0),
  // smooth hue rotation that advances over BARS (palette shift); pass into hueRot(color, MV.barHue(cl))
  barHue: (cl, perBar)=>{ perBar=(perBar==null?16:perBar); return cl ? ((cl.bar||0)*perBar + (cl.barPhase||0)*perBar) : 0; },
  tint:   (cl, hex, perBar)=> hueRot(hex, MV.barHue(cl, perBar)),             // rotate a #hex by the bar-hue
  // phrase-STABLE choice (variation at phrase boundaries, not per-frame): same value for a whole phrase
  pick:   (cl, arr)=> (arr&&arr.length) ? arr[(cl?(cl.phrase||0):0) % arr.length] : null,
  pidx:   (cl, n)=> cl ? ((cl.phrase||0) % Math.max(1,n)) : 0,
  energy: cl => cl ? Math.max(0,Math.min(1,(cl.energyLevel||5)/10)) : 0.5,    // 0-1 section intensity (scale shake/glow/flash by this)
  isDrop: cl => cl ? ((cl.energyLevel||0) >= 9) : false,                      // drop/peak -> allow stronger juice
  // ===== MUSIC-DRIVEN GAME toolkit (the 30-rules vocabulary): bind LOGIC + SPAWNING to the bus, consistently across games.
  //  Latches take the grid (SND.grid()) + the game state (to store the last tick); the rest take the clock (SND.clock()). =====
  onBeat: (gr, st)=>{ if(!gr||!st) return false; var b=gr.beat||0; if(st._mvBeat==null){ st._mvBeat=b; return false; } if(b===st._mvBeat) return false; st._mvBeat=b; return true; },   // true ONCE per quarter
  onBar:  (gr, st)=>{ if(!gr||!st) return false; var b=gr.bar||0;  if(st._mvBar==null){ st._mvBar=b; return false; }  if(b===st._mvBar) return false;  st._mvBar=b;  return true; },          // true ONCE per bar
  step:   (gr, st, n, key)=>{ if(!gr||!st) return false; n=n||1; key=key||'default'; var s=Math.floor((gr.gstep||0)/n), k='_mvStep_'+key; if(st[k]==null){ st[k]=s; return false; } if(s===st[k]) return false; st[k]=s; return true; }, // independent once-per-n-sixteenths latch
  onStep: (gr, st, n)=> MV.step(gr, st, n, 'default'),   // shared single latch
  edge:   (st, key, on)=>{ if(!st) return !!on; key='_mvEdge_'+(key||'x'); var hit=!!on && !st[key]; st[key]=!!on; return hit; },
  beatSeconds:(gr, beats, fallback)=> Math.max(0.001, (beats||1) * (gr&&gr.spb ? gr.spb : 60/Math.max(1, fallback||120))),
  simRate:(gr, base)=> Math.max(0.25, Math.min(2.5, (gr&&gr.bpm?gr.bpm:(base||120))/(base||120))),
  density:(cl, base, extra)=> Math.round((base||0) + (extra||0)*MV.energy(cl)),                 // RULE: count scales with section energy (sparse calm, crowded peaks)
  bright: (cl)=>{ if(!cl||!cl.bands) return 0.5; var b=cl.bands.bass||0,m=cl.bands.mid||0,tr=cl.bands.treble||0,s=b+m+tr+0.001; return Math.max(0,Math.min(1,(tr*1.35+m*0.5)/s)); },   // 0=low/bass-heavy .. 1=high/treble-heavy — a source-agnostic "note pitch" proxy for spawn HEIGHT
  drop:   (cl, st)=>{ var d=MV.isDrop(cl); if(d && !st._mvDrop){ st._mvDrop=true; return true; } if(!d) st._mvDrop=false; return false; },   // true ONCE on the rising edge of a drop (one-shot big moment)
};
function spr(name,cx,cy,px,tintIdx,alpha){ const s=SPRITES[name]; if(!s) return;
  const cvs = s.tint ? s.variants[(((tintIdx||0)%s.variants.length)+s.variants.length)%s.variants.length] : s.canvas;
  if(alpha!=null) g.globalAlpha = Math.max(0,alpha);
  g.drawImage(cvs, Math.round(cx-s.w*px/2), Math.round(cy-s.h*px/2), Math.round(s.w*px), Math.round(s.h*px)); g.globalAlpha=1; }
// draw an inline pixel-art sprite: rows = array of equal-length strings, each char looked up in map
// (char -> css colour; '.'/missing = transparent). top-left of the grid at (x,y); each cell is px square.
function pix(rows, x, y, px, map){
  // On the Game Boy panel an inline sprite gets shades by its ROLE within the
  // sprite, not by each colour's absolute luminance -- otherwise a five-colour
  // ship whose colours happen to sit high lands three of them on the same shade
  // and draws as one blob. Same rule the sprite atlas uses.
  var _PX = (typeof CT_PAL !== 'undefined') && CT_PAL;
  if(_PX && _PX.installed) map = _PX.spriteMap(map);
  // hot path (thousands of cells/frame in tile-heavy games): identical rects in identical order, but
  // skip redundant fillStyle sets (sprite rows are runs of the same char) + hoist the per-cell ceil.
  const cw=Math.ceil(px); let last=null;
  for(let j=0;j<rows.length;j++){ const r=rows[j], ry=Math.round(y+j*px);
    for(let i=0;i<r.length;i++){ const c=map[r[i]]; if(!c) continue;
      if(c!==last){ g.fillStyle=c; last=c; }
      g.fillRect(Math.round(x+i*px), ry, cw, cw); } } }

function resetScene(key){
  // RANDOM is no longer a separate "montage": it rides the SAME game path as a tab and just
  // auto-switches to a random game every interval — so the tab and RANDOM are pixel-identical.
  randomMode = (key === 'random');
  const sk = {random:'game', free:'abs'}[key];
  sceneKind = sk || ((typeof GAME_BY_KEY!=='undefined' && GAME_BY_KEY[key]) ? 'game' : 'abs');
  if(sceneKind==='game'){ randomT=0; selectGame(randomMode ? randomKey() : key); }  // RANDOM picks a random visible game, exactly like clicking its tab
  if(sceneKind==='abs'){ curGame=null; vigT=0; lastSect=''; remStage=1; }
}

const shakeXY = mult => { if(shake<=0.01) return [0,0]; const a=Math.round((mult||2.2)*shake); return [(Math.random()*2-1)*a|0,(Math.random()*2-1)*a|0]; };

// ---------- FREE: shuffled montage of 12 faithful 80s arcade/NES games (2 variants each) ----------
// Each game is a self-contained module { name, variants, make(A,U,variant)->state, frame(dt,U,A,evs,state) }
// drawing only via g / rrect / pix / palColor. The montage shuffles to a new random game (+ random
// variant) on each section change (>=3s dwell) or after ~10s. A small REMIX/STAGE tag sits on top.

// ---- game registry: each game pack's index.js assigns into this. Exposed on window so the pack
//      loader (packs.js), runtime-injected pack scripts, and the runtime all share ONE object. ----
const CT_GAMES = {};
if(typeof window!=='undefined'){ window.CT_GAMES = CT_GAMES; window.MV = MV; }
