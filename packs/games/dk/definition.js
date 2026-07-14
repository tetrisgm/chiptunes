// DONKEY KONG pack definition. Rules, state construction, and simulation only; no canvas drawing or raw audio reads.
// ===== DK ===== (loads after helpers, before runtime)
var DK_STAGE_TYPES=[
  {
    name:'25m girders', n:6, rise:3.2, gapPad:1.1,
    ladders:[0.74,0.28,0.82,0.34,0.62],
    slopeDirs:[-1,1,-1,1,-1,1],
    dk:0.16, pauline:0.62, oil:0.06,
    maxBarrels:5, throwEvery:12, minGap:12.8, barrelSpeed:1.00,
    bg:'#06050D', girder:'#FC7458', girderDark:'#B83224', ladder:'#3CBCFC', ladderD:'#0078F8'
  },
  {
    name:'rivet climb', n:5, rise:1.05, gapPad:0.95,
    ladders:[0.22,0.58,0.36,0.78],
    slopeDirs:[0,1,0,-1,0],
    dk:0.18, pauline:0.70, oil:0.08,
    maxBarrels:4, throwEvery:14, minGap:13.6, barrelSpeed:0.95,
    bg:'#080615', girder:'#D85CFC', girderDark:'#7C2AA8', ladder:'#FCD858', ladderD:'#C47C20'
  },
  {
    name:'elevator works', n:7, rise:1.7, gapPad:1.2,
    ladders:[0.34,0.68,0.24,0.76,0.50],
    slopeDirs:[0,-1,1,0,-1,1],
    dk:0.18, pauline:0.58, oil:0.08,
    maxBarrels:5, throwEvery:13, minGap:13.2, barrelSpeed:1.02,
    bg:'#050812', girder:'#58A8FC', girderDark:'#1848A8', ladder:'#FCA858', ladderD:'#A85020'
  },
  {
    name:'cement factory', n:4, rise:2.35, gapPad:0.75,
    ladders:[0.64,0.32,0.72,0.30,0.56],
    slopeDirs:[-1,1,1,-1,1,-1],
    dk:0.17, pauline:0.64, oil:0.07,
    maxBarrels:6, throwEvery:15, minGap:14.0, barrelSpeed:0.92,
    bg:'#09070A', girder:'#FCB840', girderDark:'#A86018', ladder:'#58D8A8', ladderD:'#209870'
  }
];

function DK_clamp01(v,min,max){
  min=min==null?0.08:min; max=max==null?0.92:max;
  return Math.max(min, Math.min(max, v));
}

function DK_ladderPattern(count, level, stageType){
  var patterns={
    3:[0.22,0.72,0.46],
    4:[0.18,0.62,0.36,0.84],
    5:[0.16,0.62,0.32,0.84,0.48],
    6:[0.14,0.54,0.28,0.68,0.42,0.82]
  };
  var base=(patterns[count]||patterns[5]).slice();
  if(((level+stageType)&1)===1){
    for(var i=0;i<base.length;i++) base[i]=1-base[i];
  }
  if(((level+stageType)%3)===1) base.reverse();
  var shifts=[0,0.035,-0.035,0.02,-0.02];
  var shift=shifts[(Math.abs(level)+stageType)%shifts.length]||0;
  var out=[];
  for(var j=0;j<count;j++) out.push(DK_clamp01(base[j%base.length]+shift,0.08,0.92));
  return out;
}

function DK_configureStage(st,A,U,advance){
  var idx=((st.level||0)%DK_STAGE_TYPES.length+DK_STAGE_TYPES.length)%DK_STAGE_TYPES.length;
  var cfg=DK_STAGE_TYPES[idx];
  var lvl=st.level|0;
  var cycle=Math.floor(Math.max(0,lvl)/DK_STAGE_TYPES.length);
  var nShift=[0,1,-1,0][cycle%4]||0;
  var riseMul=[1,0.86,1.14,0.96][cycle%4]||1;
  st.stageType=idx;
  st.stageName=cfg.name;
  st.N=Math.max(4,Math.min(7,cfg.n+nShift));
  st.rise=cfg.rise*U*riseMul;
  st.gap=A.h/(st.N+cfg.gapPad);
  st.baseY=[];
  for(var r=0;r<st.N;r++) st.baseY[r]=A.y+A.h-st.gap*(r+1);
  st.throwDir=(cfg.dk<0.5)?1:-1;
  st.slopeDirs=[];
  for(var sd=0;sd<st.N;sd++){
    var fromTop=(st.N-1)-sd;
    st.slopeDirs[sd]=st.throwDir*((fromTop%2===0)?1:-1);
  }
  st.girderThick=Math.max(2,Math.round(1.2*U));
  st.ladders=[];
  var ladderFx=DK_ladderPattern(st.N-1,lvl,idx);
  for(var rr=0;rr<st.N-1;rr++){
    var fx=ladderFx[rr];
    st.ladders.push({tier:rr, fx:fx, broken:false, locked:false});
  }
  if(!st.dk) st.dk={};
  if(!st.pauline) st.pauline={};
  if(!st.oil) st.oil={};
  st.dk.fx=cfg.dk;
  st.dk.tier=st.N-1;
  st.dk.throwAnim=st.dk.throwAnim||0;
  st.pauline.tier=st.N-1;
  st.pauline.fx=cfg.pauline;
  st.oil.fx=cfg.oil;
  st.oil.tier=0;
  st.maxBarrels=cfg.maxBarrels;
  st.throwEvery=cfg.throwEvery;
  st.barrelMinGap=cfg.minGap*U;
  st.barrelSpeedScale=cfg.barrelSpeed;
  if(st.col){
    st.col.bg=cfg.bg;
    st.col.girder=cfg.girder;
    st.col.girderDark=cfg.girderDark;
    st.col.ladder=cfg.ladder;
    st.col.ladderD=cfg.ladderD;
  }
  if(advance){
    st.throwAcc=0;
    st.lastThrowAt=-99;
  }
}

function DK_resetJumper(st,A,U){
  var jm=st.jm;
  jm.x=A.x+A.w*0.10;
  jm.tier=0;
  jm.onLadder=false;
  jm.jumping=false;
  jm.jt=0;
  jm.climb=0;
  jm.vy=0;
  jm.curLad=-1;
  jm.face=1;
  jm.y=st.girderY(0,jm.x);
}

function DK_canThrowBarrel(st,tier,x,U){
  if((st.t-(st.lastThrowAt||-99))<0.82) return false;
  var minGap=st.barrelMinGap||12*U;
  for(var i=0;i<st.barrels.length;i++){
    var b=st.barrels[i];
    if(b.tier===tier && Math.abs(b.x-x)<minGap) return false;
    if(b.release>0 && Math.abs(b.x-x)<minGap*0.9) return false;
  }
  return true;
}

function DK_cullUnsafeBarrelClusters(st,U){
  var minGap=(st.barrelMinGap||12*U)*0.78;
  for(var ci=0;ci<st.barrels.length;ci++) st.barrels[ci]._remove=false;
  for(var tier=0;tier<st.N;tier++){
    var lane=[];
    for(var i=0;i<st.barrels.length;i++){
      var b=st.barrels[i];
      if(b.tier===tier && !b.falling && !(b.release>0)) lane.push(b);
    }
    lane.sort(function(a,b){ return a.x-b.x; });
    for(var j=lane.length-1;j>0;j--){
      if(Math.abs(lane[j].x-lane[j-1].x)<minGap) lane[j]._remove=true;
    }
  }
  for(var ri=st.barrels.length-1;ri>=0;ri--) if(st.barrels[ri]._remove) st.barrels.splice(ri,1);
}

const DkDefinition = (function(){
  function makeState(A,U,variant){
    var st={};
    st.v=variant|0;
    st.U=U;
    st.t=0;
    st.flash=0;
    st.shake=0;
    st.level=variant|0;
    st.N=6;
    st.W=A.w; st.H=A.h;
    st.A={x:A.x,y:A.y,w:A.w,h:A.h};
    st.rise=3.2*U;
    st.gap=A.h/(st.N+1.1);
    st.baseY=[];
    for(var r=0;r<st.N;r++) st.baseY[r]=A.y+A.h - st.gap*(r+1);
    st.girderThick=Math.max(2, Math.round(1.2*U));
    st.ladders=[];
    st.slopeDirs=[];
    st.jm={ x:A.x+A.w*0.10, tier:0, y:0, vy:0, onLadder:false, curLad:-1, climb:0,
            jumping:false, jt:0, jx0:0, jx1:0, jy0:0, jy1:0, face:1, dead:0, win:0, anim:0 };
    st.jm.y=0;
    st.pauline={ tier:st.N-1, fx:0.62, bob:0 };
    st.dk={ fx:0.16, tier:st.N-1, throwAnim:0, beat:0 };
    st.oil={ fx:0.06, tier:0, flame:0 };
    st.barrels=[];
    st.maxBarrels=5;
    st.throwTimer=0;
    st.throwEvery=12;
    st.throwAcc=0;
    st.barrelSeq=0;
    st.lastThrowAt=-99;
    st.barrelMinGap=12*U;
    st.barrelSpeedScale=1;
    st.ai={ dir:1, jumpReq:false };
    st.score=0;
    st.lastGstep=-1;
    st.lastBeat=-1;
    st.col={
      bg:'#000000',
      girder:'#FC7458', girderDark:'#C03828', rivet:'#FCD8A8',
      ladder:'#3CBCFC', ladderD:'#0078F8',
      mRed:'#D03020', mBlue:'#0058F8', skin:'#FCB890',
      dkBrown:'#8B5A2B', dkDark:'#5C3A14', dkCream:'#FCD8A8',
      paulinePink:'#FCA8C0', paulineHair:'#FCD818',
      barrel:'#A85020', barrelDark:'#682810', barrelHoop:'#FCD8A8',
      oilBlue:'#0058F8', oilDark:'#0040A0', flameA:'#FC9838', flameB:'#FCD818', flameC:'#FC5028'
    };
    DK_configureStage(st,A,U,false);
    st.girderY=function(row,x){
      if(row<0)row=0; if(row>st.N-1)row=st.N-1;
      var A2=st.A;
      var f=(x-A2.x)/Math.max(1,A2.w); if(f<0)f=0; if(f>1)f=1;
      var dir=(st.slopeDirs&&st.slopeDirs[row]!==undefined)?st.slopeDirs[row]:((row%2===0)?-1:1);
      var dy = (dir===0)? st.rise*0.5 : ((dir>0)? (f*st.rise) : ((1-f)*st.rise));
      return st.baseY[row] + dy - st.rise*0.5;
    };
    st.ladX=function(L){ return st.A.x + st.A.w*L.fx; };
    DK_resetJumper(st,A,U);
    return st;
  
  }

  function update(ctx){
    ctx=ctx||{};
    var dt=ctx.dt, U=ctx.U, A=ctx.A, IN=ctx.IN, SND=ctx.SND, st=ctx.state;
    try{
      if(!st||!st.girderY){ return; }
      dt=Math.min(dt||0.016, 0.05);
      st.t+=dt;
      U=st.U||U;
      var col=st.col;
      var W=A.w,H=A.h;
      st.A.x=A.x; st.A.y=A.y; st.A.w=A.w; st.A.h=A.h;
      DK_configureStage(st,A,U,false);

      var audio=ctx.audio||{};
      var F=audio.raw||{};
      var grid=F.gr||{gstep:0,phase:0,beat:0,bar:0,spb:0.42,step16:0,bpm:142};
      var newStep=(grid.gstep!==st.lastGstep);
      st.lastGstep=grid.gstep;
      var newBeat=(grid.beat!==st.lastBeat);
      st.lastBeat=grid.beat;

      // ---- MV: music-reactive visual clock (beat=pulse, bar=palette, phrase=variation, event=juice) ----
      var cl=F.cl||{};
      var beatScale=MV.pulse(cl, MV.isDrop(cl)?0.06:0.03);   // sprite pulse on the beat
      var barH=MV.barHue(cl);                                 // palette rotation over bars
      var nrg=MV.energy(cl);                                  // 0-1 section intensity
      var TINT=function(hex){ return hueRot(hex, barH); };    // rotate a base colour by the bar
      // PHRASE = VARIATION: palette family only. Ladders stay stage-owned so
      // routes do not drift into adjacent or broken-looking layouts mid-run.
      if(st.lastPhrase===undefined) st.lastPhrase=-999;
      if(cl.phrase!==undefined && cl.phrase!==st.lastPhrase){
        st.lastPhrase=cl.phrase;
        st.palFam=MV.pidx(cl, 4);   // extra hue family nudge per phrase
      }
      if(st.palFam===undefined){ st.palFam=0; }
      var phraseHue=barH + (st.palFam||0)*22;
      var TINT2=function(hex){ return hueRot(hex, phraseHue); };

      var gy=function(r,x){ return st.girderY(r,x); };
      var downhillDir=function(tier){
        var sd=(st.slopeDirs&&st.slopeDirs[tier]!==undefined)?st.slopeDirs[tier]:((tier%2===0)?-1:1);
        return sd===0 ? ((tier%2===0)?-1:1) : sd;
      };
      var ladX=function(L){
        return st.A.x+st.A.w*DK_clamp01(L.fx);
      };
      function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }

      var jm=st.jm;
      var moveSpeed=(st.v===1? 31:28)*U;
      var climbSpeed=23*U;

      function upLadder(tier){
        for(var k=0;k<st.ladders.length;k++){
          var L=st.ladders[k];
          if(L.tier===tier && !L.broken) return k;
        }
        return -1;
      }

      var stepped=false, climbed=false, jumpedNow=false;
      if(jm.dead>0){
        jm.dead-=dt;
        st.flash=Math.max(st.flash,0.08);
        if(jm.dead<=0){
          DK_resetJumper(st,A,U);
        }
      } else if(jm.win>0){
        jm.win-=dt;
        st.flash=Math.max(st.flash,0.05);
        if(jm.win<=0){
          st.barrels.length=0;
          st.level=(st.level||0)+1;
          DK_configureStage(st,A,U,true);
          DK_resetJumper(st,A,U);
          st.score+=300;
        }
      } else {
        var human=(IN&&IN.active);
        var inL=false,inR=false,inU=false,inD=false,inJ=false;
        if(human&&IN.keys){
          inL=!!IN.keys.left; inR=!!IN.keys.right; inU=!!IN.keys.up; inD=!!IN.keys.down;
          // directional-only: UP climbs when at a ladder (same proximity test as
          // the grab below), and JUMPS anywhere else — no action key.
          var nearLad=false;
          if(inU && !jm.onLadder && !jm.jumping){
            for(var kj=0;kj<st.ladders.length;kj++){
              var Lj=st.ladders[kj];
              if(Lj.tier===jm.tier && !Lj.broken && Math.abs(ladX(Lj)-jm.x)<1.8*U){ nearLad=true; break; }
            }
          }
          inJ=!!(inU && !jm.onLadder && !nearLad);
        } else if(!human){
          var intent=DkBehavior.decideIntent({
            st:st,
            jm:jm,
            U:U,
            A:A,
            ladX:ladX,
            upLadder:upLadder
          });
          inL=!!intent.left;
          inR=!!intent.right;
          inU=!!intent.up;
          inD=!!intent.down;
          inJ=!!intent.jump;
          if(intent.face) jm.face=intent.face;
        }

        if(jm.jumping){
          jm.jt+=dt;
          var jd=0.46;
          var p=jm.jt/jd;
          if(p>=1){
            jm.jumping=false;
            jm.x=jm.jx1; jm.y=gy(jm.tier,jm.x);
            if(jm.barrelHop){ jm.barrelHop=false; EVENT('medium',5); st.shake=Math.max(st.shake||0, 0.18+0.12*nrg); st.flash=Math.max(st.flash, 0.06+0.06*nrg); }
          } else {
            jm.x=jm.jx0+(jm.jx1-jm.jx0)*p;
            var arc=4*p*(1-p);
            jm.y=gy(jm.tier,jm.x) - arc*3.4*U;
          }
        } else if(jm.onLadder){
          var L=st.ladders[jm.curLad];
          var bottomY=gy(L.tier, jm.x);
          var topY=gy(L.tier+1, jm.x);
          if(inU){
            jm.climb-=climbSpeed*dt;
            climbed=true;
            jm.anim+=dt*8;
          } else if(inD){
            jm.climb+=climbSpeed*dt;
            jm.anim+=dt*8;
          }
          jm.y=bottomY+jm.climb;
          if(jm.y<=topY){
            jm.y=topY; jm.tier=L.tier+1; jm.onLadder=false; jm.curLad=-1; jm.climb=0;
            jm.x=ladX(L);
          } else if(jm.y>=bottomY){
            jm.y=bottomY; jm.onLadder=false; jm.curLad=-1; jm.climb=0;
            jm.x=ladX(L);
          }
        } else {
          var moved=false;
          if(inR){ jm.x+=moveSpeed*dt; jm.face=1; moved=true; }
          if(inL){ jm.x-=moveSpeed*dt; jm.face=-1; moved=true; }
          if(jm.x<A.x+2*U) jm.x=A.x+2*U;
          if(jm.x>A.x+A.w-2*U) jm.x=A.x+A.w-2*U;
          jm.y=gy(jm.tier,jm.x);
          if(moved){ jm.anim+=dt*10; stepped=true; }
          if(inU){
            for(var k2=0;k2<st.ladders.length;k2++){
              var Lu=st.ladders[k2];
              if(Lu.tier===jm.tier && !Lu.broken && Math.abs(ladX(Lu)-jm.x)<1.8*U){
                jm.onLadder=true; jm.curLad=k2; jm.climb=0; jm.x=ladX(Lu);
                jm.y=gy(Lu.tier,jm.x);
                break;
              }
            }
          }
          if(inD){
            for(var k3=0;k3<st.ladders.length;k3++){
              var Ld=st.ladders[k3];
              if(Ld.tier===jm.tier-1 && !Ld.broken && Math.abs(ladX(Ld)-jm.x)<1.8*U){
                jm.onLadder=true; jm.curLad=k3; jm.x=ladX(Ld);
                jm.climb=-(gy(Ld.tier,jm.x)-gy(Ld.tier+1,jm.x));
                jm.y=gy(Ld.tier+1,jm.x);
                break;
              }
            }
          }
          if(inJ && !jm.jumping){
            jm.jumping=true; jm.jt=0; jm.jx0=jm.x;
            jm.jx1=jm.x + jm.face*4.2*U;
            if(jm.jx1<A.x+2*U) jm.jx1=A.x+2*U;
            if(jm.jx1>A.x+A.w-2*U) jm.jx1=A.x+A.w-2*U;
            jumpedNow=true;
            for(var hb=0;hb<st.barrels.length;hb++){
              var Hb=st.barrels[hb];
              if(Hb.tier===jm.tier && !Hb.falling && Math.abs(Hb.x-jm.x)<3.4*U){ jm.barrelHop=true; break; }
            }
          }
        }

        if(jm.tier>=st.N-1 && !jm.onLadder && !jm.jumping){
          if(jm.win<=0){ EVENT('major',9); st.flash=Math.max(st.flash,0.3+0.2*nrg); st.shake=Math.max(st.shake||0, 0.35+0.3*nrg); }
          jm.win=1.2;
        }
      }

      if(newStep){
        if(climbed){ EVENT('minor',2); try{ if(SND&&SND.lead) SND.lead(grid.spb*0.5, 0.12); }catch(e){} try{ if(SND&&SND.act) SND.act(0.04);}catch(e){} }
        else if(stepped){ EVENT('minor',2); try{ if(SND&&SND.lead) SND.lead(grid.spb*0.5, 0.10); }catch(e){} }
      }
      if(jumpedNow){ EVENT('minor',3); try{ if(SND&&SND.lead) SND.lead(grid.spb*0.4, 0.16); }catch(e){} st.shake=Math.max(st.shake||0, 0.10+0.10*nrg); }

      var dkX=A.x+A.w*st.dk.fx;
      st.dk.throwAnim=Math.max(0, st.dk.throwAnim-dt);
      if(newStep){
        st.throwAcc++;
        var topTier=st.N-1;
        var dirDown=st.throwDir || downhillDir(topTier);
        var handX=dkX+6.4*U*dirDown;
        var spawnX=dkX+11.4*U*dirDown;
        spawnX=Math.max(A.x+2*U, Math.min(A.x+A.w-2*U, spawnX));
        if(st.throwAcc>=st.throwEvery && st.barrels.length<st.maxBarrels && DK_canThrowBarrel(st,topTier,spawnX,U)){
          st.throwAcc=0;
          st.dk.throwAnim=0.42;
          st.lastThrowAt=st.t;
          st.barrelSeq++;
          var bouncing = (st.barrelSeq%4===1);
          var ladderDive = false;
          var handY=gy(topTier,dkX)-12.0*U;
          st.barrels.push({
            tier:topTier, x:handX, dir:dirDown,
            falling:false, fy:0, dropTo:0, spin:0, alive:true, justLad:false,
            y:handY,
            release:0.34, releaseTotal:0.34, throwX0:handX, throwX1:spawnX,
            throwY0:handY, throwY1:gy(topTier,spawnX),
            bouncing:bouncing, ladderDive:ladderDive, bouncePhase:(st.barrelSeq%7)*0.37,
            seq:st.barrelSeq
          });
          EVENT('minor',3);
          try{ if(SND&&SND.lead) SND.lead(grid.spb*0.5, 0.16); }catch(e){}
          try{ if(SND&&SND.act) SND.act(0.06); }catch(e){}
        }
      }

      var barrelSpeed=(st.v===1? 20:17)*U;
      barrelSpeed*=st.barrelSpeedScale||1;
      for(var bi=st.barrels.length-1; bi>=0; bi--){
        var B=st.barrels[bi];
        B.spin+=dt*8;
        if(B.release>0){
          B.release=Math.max(0,B.release-dt);
          var rp=1-(B.release/Math.max(0.001,B.releaseTotal||0.3));
          var arc=4*rp*(1-rp);
          B.x=(B.throwX0||B.x)+((B.throwX1||B.x)-(B.throwX0||B.x))*rp;
          B.y=(B.throwY0||B.y)+((B.throwY1||B.y)-(B.throwY0||B.y))*rp - arc*2.4*U;
          if(B.release<=0){
            B.x=B.throwX1||B.x;
            B.y=gy(B.tier,B.x);
          }
          continue;
        }
        if(B.falling){
          B.fy+=climbSpeed*1.4*dt;
          var bx=B.x;
          var fromY=gy(B.tier,bx);
          B.y=fromY+B.fy;
          var destY=gy(B.dropTo,bx);
          if(B.y>=destY){
            B.tier=B.dropTo; B.y=destY; B.falling=false; B.fy=0;
            B.dir=downhillDir(B.tier);   // roll downhill on the girder just landed on (zig-zag)
            B.justLad=false;
          }
        } else {
          B.x+=B.dir*barrelSpeed*dt;
          var bounceLift = B.bouncing ? Math.abs(Math.sin(B.spin*1.6 + (B.bouncePhase||0))) * 1.35*U : 0;
          B.y=gy(B.tier,B.x) - bounceLift;
          // reached the downhill edge -> tumble down to the girder below (zig-zag), or roll off the bottom
          var atEdge=(B.dir>0 ? (B.x > A.x+A.w-1.5*U) : (B.x < A.x+1.5*U));
          if(atEdge){
            if(B.tier>0){ B.x=(B.dir>0? A.x+A.w-1.5*U : A.x+1.5*U); B.falling=true; B.fy=0; B.dropTo=B.tier-1; B.justLad=false; continue; }
            else { st.barrels.splice(bi,1); continue; }
          }
          if(B.tier>0){
            for(var lk=0;lk<st.ladders.length;lk++){
              var Lb=st.ladders[lk];
              if(Lb.tier===B.tier-1 && !Lb.broken){
                var lxp=ladX(Lb);
                if(Math.abs(lxp-B.x)<1.0*U && !B.justLad){
                  B.justLad=true;
                  var seed=(Math.sin(B.x*12.9898+B.spin*78.233)*43758.5453);
                  seed=seed-Math.floor(seed);
                  if(B.ladderDive && seed<0.28){
                    B.falling=true; B.fy=0; B.dropTo=B.tier-1; B.x=lxp;
                    B.ladderDive=false;
                  }
                }
              }
            }
            var nearAny=false;
            for(var lk2=0;lk2<st.ladders.length;lk2++){
              var Lb2=st.ladders[lk2];
              if(Lb2.tier===B.tier-1 && !Lb2.broken && Math.abs(ladX(Lb2)-B.x)<1.4*U){ nearAny=true; }
            }
            if(!nearAny) B.justLad=false;
          }
        }
        if(jm.dead<=0 && jm.win<=0 && !jm.jumping){
          if(B.tier===jm.tier){
            var dxc=Math.abs(B.x-jm.x);
            var dyc=Math.abs(B.y-jm.y);
            if(dxc<1.6*U && dyc<2.2*U){
              if(jm.dead<=0){ EVENT('major',10); }
              jm.dead=0.9; st.flash=0.25+0.2*nrg; st.shake=Math.max(st.shake||0, 0.5+0.4*nrg);
            }
          }
        }
      }
      DK_cullUnsafeBarrelClusters(st,U);
      while(st.barrels.length>st.maxBarrels+2){ st.barrels.splice(0,1); }

      st.flash=Math.max(0, st.flash-dt*2.2);
      st.shake=Math.max(0, (st.shake||0)-dt*3.2);
      st.oil.flame+=dt;



      ctx.dkView={
        A:A,
        U:U,
        st:st,
        col:col,
        beatScale:beatScale,
        nrg:nrg,
        barH:barH,
        phraseHue:phraseHue,
        stepped:stepped,
        climbed:climbed,
        jumpedNow:jumpedNow
      };
    }catch(err){ }
  }

  return {
    makeState:makeState,
    update:update
  };
})();

(function(){
  VisualizerGame.layer('dk', 'definition', {
    packVersion: 3,
    key: "dk",
    name: "DONKEY KONG",
    family: "climb platformer",
    description: "Girder climb scene with jumper, ladders, barrels, oil, rescue goal, and multiple stage structures.",
    source: "physical-split-pack",
    entities: [
      "jumper",
      "barrel",
      "girder",
      "ladder",
      "oil",
      "elevator",
      "platformProp",
      "donkeyKong",
      "pauline",
      "scoreEvent"
    ],
    rules: [
      "run and climb movement",
      "ladder transitions",
      "barrel release arc",
      "barrel rolling and falling",
      "barrel collision",
      "barrel jump scoring",
      "platform slope",
      "goal reach",
      "stage loop"
    ],
    events: [
      "barrelSpawned",
      "barrelJumped",
      "ladderClimbed",
      "goalReached",
      "barrelHit",
      "stageChanged"
    ],
    simulation: {
      timestep: "movement integrates dt, while barrel release and music events are gated by the shared grid snapshot from ctx.audio",
      collision: "slope-aware girder y, same-tier barrel hitboxes, ladder tier transitions",
      musicKnowledge: "normalized ctx.audio only; no direct raw bus reads",
      watchdog: { mode:"climb", progress:40, motion:10, loop:16 }
    },
    make: DkDefinition.makeState,
    update: DkDefinition.update
  });
})();
