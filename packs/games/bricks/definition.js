// BRICKS pack definition. Rules, nouns, simulation update, and collision only; drawing lives in renderer.js.
const BricksDefinition = (function(){
  var api = {};
  api.make = function(A, U, variant){
    var V = variant|0;
    var st = {
      v: V, t: 0,
      balls: [], bricks: [], caps: [], parts: [], stars: [],
      cols: 0, rows: 0, lw: 0,
      ax: 0, ay: 0, aw: 0, ah: 0,
      brickW: 0, brickH: 0, brickGap: 0, topY: 0,
      px: NaN, pw: 0, pwBase: 0, py: 0, ph: 0,
      baseSpeed: 620, speed: 620, // viewport-relative base is recomputed in layout
      lives: 3, level: 1, score: 0,
      onPaddle: true, launchT: 0,
      serveBallTarget: 1,
      timedBallT: 0, timedBallIndex: 0, nextTimedBall: 1, timedBallHistory: [],
      expandT: 0, flash: 0, shake: 0, msg: 0,
      hitStop: 0, bgPulse: 0, padSq: 0, padTilt: 0, pops: [],
      aiServe: 0, focusCol: -1,
      laidW: -1, laidH: -1, laidX: 0, laidY: 0
    };
    if (V === 1){
      for (var i=0;i<46;i++){
        st.stars.push({ x:Math.random(), y:Math.random(),
          s:Math.random()<0.3?2:1, tw:Math.random()*6.28, sp:0.2+Math.random()*0.5 });
      }
    }
    st.nextTimedBall=api._nextTimedBallDelay(st);
    return st;
  
  };

  api.update = function(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || { x:0, y:0, w:0, h:0 };
    var IN = ctx.IN;
    var SND = ctx.SND;
    var st = ctx.state;
    if(!st) return;

    dt = Math.min(dt||0, 0.05); st.t += dt;
    if(!IN) IN = { x:0.5, y:0.5, down:false, click:false, active:false, keys:{} };
    if(!IN.keys) IN.keys = {};
    var noSnd = !SND;
    function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }
    var V = st.v;
    // ===== MUSIC CLOCK (beat=pulse, bar=palette, phrase=variation, event=juice) =====
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};
    var gr = raw.gr || { gstep:0, phase:0, beat:0, bar:0, spb:0.5, bpm:120 };
    st.beatPulse = MV.pulse(cl, MV.isDrop(cl) ? 0.06 : 0.03);   // sprite scale on the beat
    st.barHue = MV.barHue(cl);                                   // palette rotation over bars
    st.mvE = MV.energy(cl);                                      // 0-1 section intensity for juice
    // PHRASE = VARIATION: pick a brick layout family that holds for the whole phrase
    st.brickPattern = MV.pidx(cl, 4);                            // 0=full, 1=checker, 2=pyramid, 3=columns
    var ph = MV.phrase(cl);
    if (st._lastPhrase == null) st._lastPhrase = ph;
    if (ph !== st._lastPhrase){ st._lastPhrase = ph; api._applyPattern(st); }
    // BEAT/EVENT background pulse: a subtle top-gradient brighten that rises on each beat and on drops,
    // then decays every frame. Deterministic (driven purely by the shared music clock, scaled by energy).
    var beatNow = cl.beatPulse || 0;
    st.bgPulse = Math.max((st.bgPulse||0)*Math.max(0,1-dt*3.0), beatNow*(0.45+0.55*(st.mvE||0.5)));
    if (MV.isDrop(cl)) st.bgPulse = Math.max(st.bgPulse, 0.55);
    // HIT-STOP: a tiny freeze-frame on big brick combos/drops for punch. Slows ONLY ball + debris
    // integration for ~2 frames; the music clock, beat-alignment, and spawn cadence keep real time.
    if (st.hitStop>0) st.hitStop = Math.max(0, st.hitStop - dt);
    var simScale = st.hitStop>0 ? 0.16 : 1;
    var pdt = dt * simScale;
    var CLASSIC=['#d23b2e','#d23b2e','#d77b27','#d77b27','#c9b328','#c9b328','#3f9e34','#3f9e34'];
    var NEON=['#e84a3c','#e6b13a','#3fa8e0','#3fc24a','#d23bb0','#e6e6e6','#caa23a'];

    // ---- (re)layout if the rect changed ----
    if (A.w!==st.laidW||A.h!==st.laidH||A.x!==st.laidX||A.y!==st.laidY||st.bricks.length===0){
      api._layout(st,A,U,V,CLASSIC,NEON);
      st.laidW=A.w; st.laidH=A.h; st.laidX=A.x; st.laidY=A.y;
    }
    var lw=st.lw;
    var innerL=st.ax+lw, innerR=st.ax+st.aw-lw, innerT=st.ay+lw, floor=st.ay+st.ah;

    // ===================== INPUT / CONTROL =====================
    var act = !!IN.active;
    // ---- paddle target (human pointer/keys OR win-seeking AI) ----
    var paddleHalf = st.pw/2;
    var wantCenter; // desired paddle CENTER x in px
    if (act){
      if (IN.keys.left && !IN.keys.right){ st.px -= st.aw*1.7*dt; wantCenter=null; }
      else if (IN.keys.right && !IN.keys.left){ st.px += st.aw*1.7*dt; wantCenter=null; }
      else {
        var ix = (typeof IN.x==='number') ? IN.x : 0.5;
        wantCenter = st.ax + (Math.max(0,Math.min(1,ix)))*st.aw;
      }
    } else {
      // ---- AI: predict ball landing x and aim to tunnel into the back rows ----
      wantCenter = BricksBehavior.aiTarget(st, U);
    }
    if (wantCenter!=null){
      var wantPx = wantCenter - paddleHalf;
      var follow = act ? 1 : Math.min(1, 16*dt);
      st.px += (wantPx - st.px) * follow;
    }
    st.px = Math.max(innerL, Math.min(innerR - st.pw, st.px));
    var paddleCx = st.px + st.pw/2;

    // ---- launch / relaunch (click or action; AI auto-serves when idle) ----
    if (st.onPaddle){
      st.aiServe += dt;
      var doLaunch = act ? (IN.click || IN.keys.up) : (st.aiServe > 0.35);   // directional-only: UP serves
      // keep the resting ball glued to the paddle
      for (var bi0=0; bi0<st.balls.length; bi0++){
        var rb=st.balls[bi0]; rb.x = paddleCx; rb.y = st.py - rb.r - 1; rb.vx=0; rb.vy=0;
      }
      if (doLaunch && st.balls.length){
        st.onPaddle = false; st.aiServe = 0;
        var sp0 = api._targetBallSpeed(st);
        // aim toward the focus column (AI) or straight-ish (player)
        var aim = act ? (Math.random()-0.5)*0.5 : BricksBehavior.aiServeAngle(st);
        // Normal boards still serve one classic ball. Ultrawide boards serve a
        // small deterministic fan so their much larger brick field retains the
        // same action density and clear pace without turning into visual noise.
        var launchCount=st.balls.length;
        for(var launchI=0;launchI<launchCount;launchI++){
          var spread=(launchI-(launchCount-1)*0.5)*0.24;
          var ang0=(-Math.PI/2)+aim+spread;
          var launchBall=st.balls[launchI];
          launchBall.vx=Math.cos(ang0)*sp0;
          launchBall.vy=-Math.abs(Math.sin(ang0)*sp0)||-sp0*0.7;
          if(launchBall.vy>-0.001)launchBall.vy=-sp0*0.6;
        }
        if(!noSnd) SND.fx('pad');
        EVENT('minor',2);
      }
    }

    // ===================== BALL PHYSICS =====================
    if (st.balls.length > 6) st.balls.length = 6;

    if (!st.onPaddle){
      st.timedBallT += dt;
      if(st.timedBallT>=st.nextTimedBall){
        st.timedBallT-=st.nextTimedBall;
        if(st.balls.length<6)api._spawnTimedBall(st,U,noSnd?null:SND);
        else st.timedBallIndex++;
        st.nextTimedBall=api._nextTimedBallDelay(st);
      }
      var SUBS = 7; // sub-step for multi-brick fidelity at readable ball speeds
      for (var i=st.balls.length-1; i>=0; i--){
        var b=st.balls[i]; var lost=false;
        // motion trail: a small fixed ring of recent positions (no per-frame allocation after init).
        if(!b.trail){ b.trail=[]; for(var tI=0;tI<8;tI++) b.trail.push({x:b.x,y:b.y}); b.trailHead=0; }
        if(b.sqT>0) b.sqT=Math.max(0, b.sqT-dt);   // squash-&-stretch timer eases out
        api._alignBallToBeat(st, b, gr, dt);
        for (var sstep=0; sstep<SUBS; sstep++){
          b.x += b.vx*pdt/SUBS; b.y += b.vy*pdt/SUBS;   // pdt slows briefly during a hit-stop
          // walls -> soft tick (+ horizontal/vertical squash + faint shake)
          if (b.x-b.r < innerL){ b.x=innerL+b.r; b.vx=Math.abs(b.vx); b.snx=1; b.sny=0; b.sqT=0.10; st.shake=Math.min(1,st.shake+0.02); if(!noSnd) SND.fx('wall'); EVENT('minor',1); }
          else if (b.x+b.r > innerR){ b.x=innerR-b.r; b.vx=-Math.abs(b.vx); b.snx=1; b.sny=0; b.sqT=0.10; st.shake=Math.min(1,st.shake+0.02); if(!noSnd) SND.fx('wall'); EVENT('minor',1); }
          if (b.y-b.r < innerT){ b.y=innerT+b.r; b.vy=Math.abs(b.vy); b.snx=0; b.sny=1; b.sqT=0.10; st.shake=Math.min(1,st.shake+0.02); if(!noSnd) SND.fx('wall'); EVENT('minor',1); }
          // paddle -> mid tick + angle by hit position (+ ball & paddle squash, tilt, shake)
          if (b.vy>0 && b.y+b.r>=st.py && b.y-b.r<=st.py+st.ph && b.x>=st.px-b.r && b.x<=st.px+st.pw+b.r){
            b.y = st.py - b.r;
            var rel = (b.x-(st.px+st.pw/2))/(st.pw/2);
            rel = Math.max(-1,Math.min(1,rel));
            var sp = Math.hypot(b.vx,b.vy) || api._targetBallSpeed(st);
            var ang = (-Math.PI/2) + rel*(Math.PI*0.40);
            b.vx = Math.cos(ang)*sp; b.vy = Math.sin(ang)*sp;
            if (b.vy > -0.001) b.vy = -Math.abs(sp)*0.35;
            // rally builds gently, capped; beat alignment handles musical timing.
            var spc=Math.min(st.baseSpeed*1.30, sp+st.baseSpeed*0.012);
            var kc=spc/(sp||1); b.vx*=kc; b.vy*=kc;
            b.snx=0; b.sny=1; b.sqT=0.13;              // ball squashes vertically on the deck
            st.padSq=1; st.padTilt=rel;                // paddle squashes + tilts toward the contact side
            st.shake=Math.min(1, st.shake+0.05);
            api._spark(st,b.x,st.py,'#ffffff',U);
            if(!noSnd) SND.fx('pad');
            EVENT('minor',2);
          }
          // bricks -> a NOTE rising per row up the wall
          api._hitBricks(st,b,U,noSnd?null:SND);
          // keep some vertical drive so the ball never grinds purely horizontally
          var spN=Math.hypot(b.vx,b.vy)||st.speed;
          var minVy=spN*0.22;
          if(Math.abs(b.vy)<minVy){ b.vy=(b.vy<0?-1:1)*minVy; var nx=Math.sqrt(Math.max(0,spN*spN-b.vy*b.vy)); b.vx=(b.vx<0?-1:1)*nx; }
          if (b.y-b.r > floor){ lost=true; break; }
        }
        if (lost){ st.balls.splice(i,1); }
        else { b.trailHead=(b.trailHead+1)%8; b.trail[b.trailHead].x=b.x; b.trail[b.trailHead].y=b.y; }
      }
      // FAILURE: every ball fell past the paddle -> lose a life, relaunch
      if (st.balls.length === 0){ api._loseLife(st,U,noSnd?null:SND); }
    }

    // ===================== WIN: all bricks cleared -> next level =====================
    var alive=0; for (var ci=0; ci<st.bricks.length; ci++) if (st.bricks[ci].a) alive++;
    if (alive===0){
      st.level++;
      st.speed = Math.min(st.baseSpeed*1.34, st.speed + st.baseSpeed*0.04);
      var enC=st.mvE||0.5;
      st.flash = 0.5+0.25*enC; st.shake = Math.min(1, st.shake+0.4+0.3*enC); st.msg = 1.4;
      st.focusCol = -1;
      api._buildBricks(st,V,CLASSIC,NEON);
      // serve fresh
      st.aiServe = 0;
      api._prepareServe(st,U);
      if(!noSnd) SND.fx('clear');
      EVENT('major',9);
    }

    // ===================== CAPSULES (falling power-ups) =====================
    for (var k=st.caps.length-1; k>=0; k--){
      var c=st.caps[k]; c.y += c.vy*dt; c.spin += dt*4;
      // caught by paddle?
      if (c.y+c.h>=st.py && c.x+c.w>=st.px && c.x<=st.px+st.pw && c.y<=st.py+st.ph){
        api._applyCap(st,c,U,noSnd?null:SND);
        st.caps.splice(k,1); continue;
      }
      if (c.y > floor) st.caps.splice(k,1);
    }
    if (st.caps.length>4) st.caps.splice(0, st.caps.length-4);

    // ---- expand timer ----
    if (st.expandT > 0){
      st.expandT -= dt;
      st.pw = st.pwBase * 1.6;
      if (st.expandT <= 0){ st.pw = st.pwBase; EVENT('state',5,{name:'powered',on:false}); }
      st.px = Math.max(innerL, Math.min(innerR - st.pw, st.px));
    }

    // ===================== PARTICLES =====================
    for (var pi=st.parts.length-1; pi>=0; pi--){
      var p=st.parts[pi]; p.x+=p.vx*pdt; p.y+=p.vy*pdt; p.vy+=300*pdt; p.life-=dt;
      if (p.life<=0) st.parts.splice(pi,1);
    }
    if (st.parts.length>80) st.parts.splice(0, st.parts.length-80);
    // combo score-pops rise + fade
    for (var qi=st.pops.length-1; qi>=0; qi--){
      var q=st.pops[qi]; q.y+=q.vy*dt; q.vy*=Math.max(0,1-dt*1.4); q.life-=dt;
      if (q.life<=0) st.pops.splice(qi,1);
    }
    // brick hit-flash + neighbour-jiggle decay (cheap single pass over the wall)
    for (var jb=0; jb<st.bricks.length; jb++){
      var brf=st.bricks[jb];
      if (brf.flash>0) brf.flash=Math.max(0, brf.flash-dt*6);
      if (brf.jig>0)   brf.jig=Math.max(0, brf.jig-dt*3.5);
    }
    // paddle squash/tilt ease-out
    if (st.padSq>0) st.padSq=Math.max(0, st.padSq-dt*5.5);
    st.padTilt*=Math.max(0,1-dt*6);
    // flash + shake decay lives in the SIM so headless/background frames still settle deterministically
    if (st.flash>0.001) st.flash*=Math.max(0,1-dt*11); else st.flash=0;
    if (st.shake>0.001) st.shake*=Math.max(0,1-dt*9);  else st.shake=0;
    if (st.msg>0) st.msg-=dt;

  };

  api._layout = function(st,A,U,V,CLASSIC,NEON){
    st.lw=Math.max(3,Math.round(U*0.9));
    st.ax=A.x; st.ay=A.y; st.aw=A.w; st.ah=A.h;
    var lw=st.lw, innerL=st.ax+lw, innerR=st.ax+st.aw-lw, innerW=Math.max(U*4,innerR-innerL);
    // Keep the brick sprite size stable and spend extra viewport space on more
    // bricks.  The old caps (18/16 columns) made ultrawide layouts look like a
    // small board floating between empty side walls.
    var targetBrickW=U*(V===0?5:5.5);
    st.cols=Math.max(8,Math.round(innerW/targetBrickW));
    st.brickW=innerW/st.cols;
    st.brickH=st.brickW*(V===0?0.40:0.36);
    st.brickGap=Math.max(1,st.brickH*0.12);
    st.topY=st.ay+lw+Math.max(U*2,st.ah*(V===0?0.07:0.06));
    var brickBand=st.ah*(V===0?0.39:0.36);
    st.rows=Math.max(5,Math.round(brickBand/(st.brickH+st.brickGap)));
    st.pwBase=st.brickW*(V===0?2.8:3.1);
    st.pw=(st.expandT>0)?st.pwBase*1.6:st.pwBase;
    st.ph=Math.max(U*1.1,U*1.6);
    st.py=st.ay+st.ah-lw-st.ph-U*1.5-st.brickH*2;   // lifted ~2 brick-rows off the bottom (mobile visibility)
    if(typeof st.px!=='number'||!isFinite(st.px)) st.px=st.ax+st.aw/2-st.pw/2;
    st.px=Math.max(innerL,Math.min(innerR-st.pw,st.px));
    st.baseSpeed=Math.max(360,Math.min(820,st.ah*0.92));
    st.speed=Math.max(st.baseSpeed*0.92, Math.min(st.baseSpeed*1.30, st.speed || st.baseSpeed*1.05));
    st.serveBallTarget=api._serveBallCount(st);
    api._buildBricks(st,V,CLASSIC,NEON);
    if(st.balls.length===0||(st.onPaddle&&st.balls.length!==st.serveBallTarget)){
      st.aiServe=0;
      api._prepareServe(st,U);
    }
  
  };

  api._buildBricks = function(st,V,CLASSIC,NEON){
    st.bricks=[];
    var pat=st.brickPattern||0;
    for(var r=0;r<st.rows;r++) for(var c=0;c<st.cols;c++){
      if(!api._inPattern(st,pat,r,c)) continue;   // PHRASE layout family carves the wall shape
      var col,hp=1,kind='b';
      if(V===0){ col=CLASSIC[r%CLASSIC.length]; }
      else {
        if(r===0){ col='#cfd2dd'; kind='silver'; hp=2; }
        else if((r+c)%6===0){ col='#caa23a'; kind='gold'; hp=2; }
        else col=NEON[(c+r)%5];
      }
      st.bricks.push({a:1,hp:hp,maxhp:hp,gx:c,gy:r,col:col,kind:kind});
    }
  
  };

  api._inPattern = function(st,pat,r,c){
    switch(pat){
      case 1: return ((r+c)&1)===0;                          // checkerboard
      case 2: { var mid=(st.cols-1)/2;                       // pyramid
                var span=((st.rows-r)/Math.max(1,st.rows))*((st.cols+1)/2);
                return Math.abs(c-mid) <= span; }
      case 3: return (c%3)!==2;                               // columns (gaps)
      default: return true;                                  // full wall
    }
  
  };

  api._applyPattern = function(st){
    var pat=st.brickPattern||0;
    for(var i=0;i<st.bricks.length;i++){
      var br=st.bricks[i];
      if(br.a && !api._inPattern(st,pat,br.gy,br.gx)) br.a=0;
    }
  
  };

  api._brickRect = function(st,br){
    var lw=st.lw;
    return { x:st.ax+lw+br.gx*st.brickW,
      y:st.topY+br.gy*(st.brickH+st.brickGap),
      w:st.brickW, h:st.brickH };
  
  };

  api._targetBallSpeed = function(st){
    return Math.max(240, Math.min((st.baseSpeed||620)*1.30, st.speed || st.baseSpeed || 620));
  
  };

  api._timedBallUnit = function(st){
    // Integer hash: random-looking but reproducible for the same variant,
    // level, and spawn number.
    var n=((st.timedBallIndex+1)*1103515245+(st.v+3)*12345+(st.level+7)*2654435761)>>>0;
    n^=n>>>16;n=Math.imul(n,2246822519)>>>0;n^=n>>>13;
    return (n>>>0)/4294967296;
  };

  api._nextTimedBallDelay = function(st){
    return 1+api._timedBallUnit(st)*2;
  };

  api._spawnTimedBall = function(st,U,SND){
    var u=api._timedBallUnit(st),sp=api._targetBallSpeed(st);
    var ang=(-Math.PI/2)+(u-.5)*1.05;
    var radius=api._ballRadius(U);
    st.balls.push({x:st.px+st.pw*.5,y:st.py-radius-1,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,r:radius});
    st.timedBallIndex++;
    st.timedBallHistory.push(st.t);
    if(st.timedBallHistory.length>24)st.timedBallHistory.shift();
    if(SND&&typeof SND.fx==='function')SND.fx('pad');
  };

  api._normalizeBallSpeed = function(b, target){
    var sp=Math.hypot(b.vx,b.vy);
    if(!sp || sp<1 || !target) return;
    var k=target/sp;
    b.vx*=k; b.vy*=k;
  
  };

  api._clampBallSpeed = function(st,b){
    var sp=Math.hypot(b.vx,b.vy);
    if(!sp || sp<1) return;
    var base=st.baseSpeed||620;
    var target=Math.max(base*0.76, Math.min(base*1.34, sp));
    if(Math.abs(target-sp)>0.5) api._normalizeBallSpeed(b,target);
  
  };

  api._nextBeatDelay = function(gr){
    var spb=Math.max(0.18, Math.min(0.95, (gr && gr.spb) || (60 / Math.max(80, Math.min(220, (gr && gr.bpm) || 120)))));
    var gstep=((gr && gr.gstep) || 0) % 4;
    var phase=Math.max(0, Math.min(0.999, (gr && gr.phase) || 0));
    var beatPhase=(gstep + phase) / 4;
    var delay=(1 - beatPhase) * spb;
    if(delay > spb - 0.018) delay = 0;
    return delay;
  
  };

  api._estimateNextBounceTime = function(st,b){
    var innerL=st.ax+st.lw, innerR=st.ax+st.aw-st.lw, innerT=st.ay+st.lw;
    var best=Infinity;
    if(b.vx>8) best=Math.min(best, ((innerR-b.r)-b.x)/b.vx);
    else if(b.vx<-8) best=Math.min(best, ((innerL+b.r)-b.x)/b.vx);
    if(b.vy<-8) best=Math.min(best, ((innerT+b.r)-b.y)/b.vy);
    if(b.vy>8 && b.x>=st.px-b.r-st.pw*0.12 && b.x<=st.px+st.pw+b.r+st.pw*0.12){
      best=Math.min(best, ((st.py-b.r)-b.y)/b.vy);
    }
    if(Math.abs(b.vy)>8){
      for(var i=0;i<st.bricks.length;i++){
        var br=st.bricks[i];
        if(!br.a) continue;
        var R=api._brickRect(st,br);
        if(b.x+b.r<R.x || b.x-b.r>R.x+R.w) continue;
        var t=null;
        if(b.vy<0 && b.y-b.r>=R.y+R.h) t=((b.y-b.r)-(R.y+R.h))/(-b.vy);
        else if(b.vy>0 && b.y+b.r<=R.y) t=(R.y-(b.y+b.r))/b.vy;
        if(t!=null && t>0) best=Math.min(best,t);
      }
    }
    return isFinite(best) && best>0 ? best : null;
  
  };

  api._alignBallToBeat = function(st,b,gr,dt){
    if(!b || st.onPaddle) return;
    api._clampBallSpeed(st,b);
    var delay=api._nextBeatDelay(gr);
    if(delay<0.055 || delay>0.55) return;
    var t=api._estimateNextBounceTime(st,b);
    if(t==null || t<0.07 || t>0.70) return;
    var ratio=t/delay;
    if(ratio<0.74 || ratio>1.26) return;
    var sp=Math.hypot(b.vx,b.vy) || api._targetBallSpeed(st);
    var desired=Math.max((st.baseSpeed||620)*0.78, Math.min((st.baseSpeed||620)*1.30, sp*ratio));
    var blend=Math.max(0,Math.min(0.16,(dt||0.016)*3.2));
    api._normalizeBallSpeed(b, sp + (desired-sp)*blend);
  
  };

  api._ballRadius = function(U){
    return Math.max(4,U*1.1);
  
  };

  api._serveBallCount = function(st){
    var aspect=(st.aw||1)/Math.max(1,st.ah||1);
    return Math.max(1,Math.min(4,Math.round(aspect/1.35)));

  };

  api._prepareServe = function(st,U){
    st.serveBallTarget=api._serveBallCount(st);
    st.balls.length=0;
    for(var i=0;i<st.serveBallTarget;i++)api._spawnBall(st,U,false);
    st.onPaddle=true;
    st.timedBallT=0;
    st.nextTimedBall=api._nextTimedBallDelay(st);

  };

  api._spawnBall = function(st,U,onPaddle){
    var radius=api._ballRadius(U);
    var cx=st.px+st.pw/2, cy=st.py-radius-1;
    st.balls.push({x:cx,y:cy,vx:0,vy:0,r:radius});
    if(onPaddle) st.onPaddle=true;
  
  };

  api._loseLife = function(st,U,SND){
    function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }
    st.lives--;
    if(SND) SND.fx('lose');
    EVENT('major',8);
    st.flash=Math.max(st.flash,0.3); st.shake=Math.min(1,st.shake+0.4);
    if(st.expandT>0) EVENT('state',5,{name:'powered',on:false});
    st.caps.length=0; st.expandT=0; st.pw=st.pwBase; st.focusCol=-1;
    if(st.lives<=0){
      // FAILURE bottoms out: rebuild the wall, reset run (visible setback, never a dead stop)
      st.lives=3; st.level=1; st.speed=st.baseSpeed*1.05; st.msg=1.2;
      var CLASSIC=['#d23b2e','#d23b2e','#d77b27','#d77b27','#c9b328','#c9b328','#3f9e34','#3f9e34'];
      var NEON=['#e84a3c','#e6b13a','#3fa8e0','#3fc24a','#d23bb0','#e6e6e6','#caa23a'];
      api._buildBricks(st,st.v,CLASSIC,NEON);
    }
    st.onPaddle=true; st.aiServe=0;
    api._prepareServe(st,U);
  
  };

  api._hitBricks = function(st,b,U,SND){
    function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }
    for(var bi=0; bi<st.bricks.length; bi++){
      var br=st.bricks[bi];
      if(!br.a) continue;
      var R=api._brickRect(st,br);
      if(b.x+b.r>R.x && b.x-b.r<R.x+R.w && b.y+b.r>R.y && b.y-b.r<R.y+R.h){
        var ox=Math.min((b.x+b.r)-R.x,(R.x+R.w)-(b.x-b.r));
        var oy=Math.min((b.y+b.r)-R.y,(R.y+R.h)-(b.y-b.r));
        if(ox<oy){ b.vx=(b.x<R.x+R.w/2)?-Math.abs(b.vx):Math.abs(b.vx); b.x += (b.x<R.x+R.w/2)?-ox:ox; b.snx=1; b.sny=0; }
        else { b.vy=(b.y<R.y+R.h/2)?-Math.abs(b.vy):Math.abs(b.vy); b.y += (b.y<R.y+R.h/2)?-oy:oy; b.snx=0; b.sny=1; }
        b.sqT=0.11;   // ball squashes along the contact normal
        br.hp-=1;
        var en=st.mvE||0.5;
        if(br.hp<=0){
          br.a=0; st.score+=7;
          // brick-break debris: a deterministic burst SEEDED by brick index + time (never Math.random)
          api._burst(st,R.x+R.w/2,R.y+R.h/2,br.col,U,(bi*131+Math.floor(st.t*97)+st.v*7)>>>0);
          // EVENT = JUICE: tiny local flash + faint shake on a single break, scaled by section energy
          st.flash=Math.max(st.flash,0.08+0.10*en);
          st.shake=Math.min(1, st.shake+0.045+0.05*en);
          // reaction spreads: the four orthogonal neighbours jiggle and flash briefly
          for(var ni=0;ni<st.bricks.length;ni++){
            var nb=st.bricks[ni]; if(!nb.a) continue;
            var dgx=nb.gx-br.gx, dgy=nb.gy-br.gy;
            if((dgx*dgx+dgy*dgy)===1){ nb.jig=Math.max(nb.jig||0,0.7); nb.flash=Math.max(nb.flash||0,0.35); }
          }
          // brick break = minor tick; a fast multi-brick combo escalates to a medium accent + a score pop
          var nowB=st.t;
          if(st._lastBreakT!=null && (nowB-st._lastBreakT)<0.30){ st._breakRun=(st._breakRun||1)+1; } else { st._breakRun=1; }
          st._lastBreakT=nowB;
          var combo=st._breakRun;
          api._pop(st,R.x+R.w/2,R.y+R.h/2,br.col,U,combo);   // rising +/xN pop where the brick died
          if(combo>=3){
            EVENT('medium',5);
            // multi-break combo = stronger flash, a kick of shake, and a tiny hit-stop, louder in high-energy sections
            st.flash=Math.max(st.flash,0.22+0.18*en);
            st.shake=Math.min(1,st.shake+0.12+0.18*en);
            st.hitStop=Math.max(st.hitStop, 0.03+0.02*en);
            if(combo>=6) st._breakRun=0;   // roll the accent but keep escalation bounded
          } else { EVENT('minor',2); }
          // NOTE rises per row up the wall: top row = highest degree (breaking the wall plays a scale)
          if(SND){
            var topRow=st.rows-1;
            var deg=(topRow-br.gy);                 // 0 at bottom row, rising toward top
            var vel=0.6+0.3*((st.rows-1-br.gy)/Math.max(1,st.rows-1));
            SND.note(deg, 0.12, vel);
          }
          // variant 1: deterministic chance to drop a capsule power-up (hashed on brick + spawn count + time)
          if(st.v===1 && st.caps.length<3 && api._hash01((bi*977+st.timedBallIndex)>>>0, Math.floor(st.t*53), 5)<0.16){
            api._dropCap(st,R,U);
          }
        } else {
          api._spark(st,b.x,b.y,'#ffffff',U);
          br.flash=Math.max(br.flash||0,0.8);      // hardened brick flashes white on a non-fatal hit
          st.shake=Math.min(1, st.shake+0.02);
          if(SND) SND.fx('brick', 4);              // hardened brick = a duller higher tick
          EVENT('minor',2);
        }
        return; // one brick per sub-step
      }
    }
  
  };

  api._dropCap = function(st,R,U){
    var roll=Math.random();
    var kind = roll<0.5 ? 'multi' : 'expand';
    var col = kind==='multi' ? '#3fa8e0' : '#3fc24a';
    st.caps.push({x:R.x+R.w*0.15,y:R.y+R.h,w:Math.max(U*2.4,st.brickW*0.7),
      h:Math.max(U*1.0,st.brickH*0.6),vy:Math.max(50,st.ah*0.18),spin:0,col:col,kind:kind});
    if(st.caps.length>4) st.caps.shift();
  
  };

  api._applyCap = function(st,c,U,SND){
    function EVENT(cat,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(cat,i,o); }catch(e){} }
    if(SND) SND.fx('cap');
    EVENT('major',7);
    st.flash=Math.max(st.flash,0.3);
    api._spark(st,c.x+c.w/2,st.py,c.col,U);
    if(c.kind==='multi'){
      var src=null;
      for(var i=0;i<st.balls.length;i++){ if(st.balls[i].vy<0){ src=st.balls[i]; break; } }
      if(!src) src=st.balls.length?st.balls[0]:null;
      var sp=src?(Math.hypot(src.vx,src.vy)||st.speed):st.speed;
      if(sp<10) sp=st.speed;
      for(var k=0;k<2 && st.balls.length<6;k++){
        var ang=(-Math.PI/2)+(Math.random()-0.5)*1.4;
        st.balls.push({x:src?src.x:st.px+st.pw/2,y:src?src.y:st.py-U*4,
          vx:Math.cos(ang)*sp,vy:-Math.abs(Math.sin(ang)*sp)||-sp*0.6,r:src?src.r:api._ballRadius(U)});
      }
      if(st.onPaddle){ st.onPaddle=false; st.aiServe=0; for(var j=0;j<st.balls.length;j++){ if(st.balls[j].vy===0){ st.balls[j].vy=-st.speed*0.8; } } }
    } else {
      if(st.expandT<=0) EVENT('state',5,{name:'powered',on:true});
      st.expandT=8; st.pw=st.pwBase*1.6;
    }
  
  };

  api._hash01 = function(a,b,c){
    // integer hash -> 0..1; random-looking but fully reproducible for the same seeds (determinism).
    var n=((Math.imul(a>>>0,2654435761)) ^ (Math.imul(b>>>0,40503)) ^ (Math.imul(c>>>0,2246822519)))>>>0;
    n^=n>>>15; n=Math.imul(n,2246822519)>>>0; n^=n>>>13; n=Math.imul(n,3266489917)>>>0; n^=n>>>16;
    return (n>>>0)/4294967296;
  };

  api._capParts = function(st){
    if(st.parts.length>80) st.parts.splice(0,st.parts.length-80);
  };

  api._pop = function(st,x,y,col,U,combo){
    // rising, fading combo/score pop where a brick died (renderer draws "+" or "xN")
    st.pops.push({x:x,y:y,vy:-Math.max(60,(st.ah||400)*0.16),life:0.55,max:0.55,col:col,combo:combo|0,s:Math.max(2,Math.round(U*0.55))});
    if(st.pops.length>12) st.pops.splice(0,st.pops.length-12);
  };

  api._burst = function(st,x,y,col,U,seed){
    // brick-break debris fan — seeded so the same break always throws the same sparks (headless-deterministic).
    seed=(seed==null?((Math.round(x)*2654435761)^(Math.round(y)*40503))>>>0:seed)>>>0;
    for(var i=0;i<6;i++){
      var u1=api._hash01(seed,i,11), u2=api._hash01(seed,i,23), u3=api._hash01(seed,i,37);
      var a=(i/6)*6.283+(u1-0.5)*0.9, sp=70+u2*150;
      st.parts.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-60,life:0.26+u3*0.30,s:Math.max(2,Math.round(U*0.5)),col:col});
    }
    api._capParts(st);

  };

  api._spark = function(st,x,y,col,U){
    var seed=((Math.round(x)*73856093)^(Math.round(y)*19349663)^(Math.floor((st.t||0)*120)*83492791))>>>0;
    for(var i=0;i<2;i++){
      var u1=api._hash01(seed,i,3), u2=api._hash01(seed,i,7);
      var a=-Math.PI/2+(u1-0.5)*2, sp=30+u2*60;
      st.parts.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.18,s:Math.max(1,Math.round(U*0.4)),col:col});
    }
    api._capParts(st);

  };

  return api;
})();

(function(){
  VisualizerGame.layer('bricks', 'definition', {
    packVersion: 2,
    key: "bricks",
    name: "BRICKTAP",
    family: "brick breaker",
    description: "Paddle and ball toy with bricks, impacts, clears, and controlled multiball pressure.",
    source: "split-pack-definition-rules",
    entities: [
      "paddle",
      "ball",
      "brick",
      "wall",
      "powerup",
      "impactSpark",
      "clearFlash",
      "scoreText"
    ],
    rules: [
      "ball physics",
      "paddle collision",
      "brick collision",
      "brick destruction",
      "wall bounce",
      "row clear",
      "round refill",
      "multiball cap"
    ],
    events: [
      "ballHitPaddle",
      "brickHit",
      "brickDestroyed",
      "rowCleared",
      "powerupCollected",
      "nearMiss"
    ],
    simulation: {
      timestep: "fixed by shared runtime; update clamps large dt locally",
      collision: "definition update owns ball, paddle, wall, brick, and capsule collisions",
      musicKnowledge: "consumes the shared normalized runner snapshot; no direct raw audio bus reads"
    },
    make: BricksDefinition.make,
    update: BricksDefinition.update
  });
})();
