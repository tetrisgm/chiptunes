// MEGA MAN 2 definition: side-scrolling run/jump/shoot rules. No drawing.
(function(){
  var D = {};
  D.W = 256; D.H = 224; D.GROUND = 184;
  D.PHYS = { run:98, accel:700, friction:760, gravity:1180, jump:322, fallMax:430 };

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function hit(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function ev(st, type, detail){ if(st.events.length < 48) st.events.push({ type:type, detail:detail || null }); }
  function rect(st, x,y,w,h,kind){ st.solids.push({ x:x, y:y, w:w, h:h, kind:kind || 'floor', role:'bass' }); }
  var ENEMY_TYPES = ['met', 'turret', 'drone', 'walker', 'hopper', 'shield'];
  function enemyConfig(type){
    if(type === 'turret') return { w:14, h:18, vx:0, hp:2, role:'perc' };
    if(type === 'drone') return { w:16, h:13, vx:-34, hp:2, role:'noise' };
    if(type === 'walker') return { w:16, h:18, vx:-26, hp:2, role:'counter' };
    if(type === 'hopper') return { w:14, h:16, vx:-18, hp:2, role:'counter' };
    if(type === 'shield') return { w:18, h:18, vx:-12, hp:3, role:'bass' };
    return { w:14, h:14, vx:-16, hp:1, role:'counter' };
  }
  function levelEnemyTypes(st, segIndex){
    var a = ENEMY_TYPES[(st.variant + (st.roomTheme || 0) + segIndex) % ENEMY_TYPES.length];
    var b = ENEMY_TYPES[(st.variant * 2 + (st.roomTheme || 0) + segIndex + 2) % ENEMY_TYPES.length];
    if(a === b) b = ENEMY_TYPES[(ENEMY_TYPES.indexOf(a) + 3) % ENEMY_TYPES.length];
    return [a,b];
  }
  function room(st, x, w, kind, floorY){
    if(!st.rooms) st.rooms = [];
    if(st.rooms.length < 40) st.rooms.push({ x:x, y:18, w:w, h:D.GROUND - 18, kind:kind || 'hall', floorY:floorY, role:'world' });
  }
  function addEnemy(st, type, x, y){
    if(st.enemies.length >= 18) return;
    var cfg = enemyConfig(type);
    st.enemies.push({ type:type, role:cfg.role, x:x, y:y, baseY:y, w:cfg.w, h:cfg.h, vx:cfg.vx, vy:0, hp:cfg.hp, alive:true, onGround:false, phase:(x*0.07)%6.28, pulse:0 });
  }
  function addCapsule(st, x, y){
    if(st.pickups.length < 24) st.pickups.push({ type:'weaponEnergy', role:'lead', x:x, y:y, w:8, h:12, got:false, pulse:0 });
  }
  function addLadder(st, x, topY, bottomY){
    st.ladders.push({ x:x, y:topY, w:14, h:bottomY - topY, role:'noise' });
  }
  function addEnemyPair(st, types, x, y){
    addEnemy(st, types[0], x, y - enemyConfig(types[0]).h);
    addEnemy(st, types[1], x + 62, y - enemyConfig(types[1]).h);
  }
  function addSegment(st){
    var i = st.seg++, x = st.nextX;
    var kinds = ['stairs','enemyHall','ladderRoom','pitBridge','upperRoute','droneNest','highRun','shaft','dropRoom','platforms'];
    var kind = i < 2 ? 'intro' : kinds[(i * 7 + (st.variant || 0) * 3) % kinds.length];
    var roomW = kind === 'pitBridge' ? 292 : (kind === 'shaft' || kind === 'upperRoute' ? 252 : 208);
    var prevY = st.floorY || D.GROUND;
    var target = i < 2 ? D.GROUND : D.GROUND - ([0,16,32,48,24,64,32,16,56,40][(i + (st.variant || 0)) % 10] || 0);
    target = clamp(target, D.GROUND - 72, D.GROUND);
    if(kind !== 'upperRoute' && kind !== 'shaft' && target < prevY - 24) target = prevY - 24;
    if(target > prevY + 24) target = prevY + 24;
    var y = target;
    st.floorY = y;
    room(st, x, roomW, kind, y);
    var types = levelEnemyTypes(st, i);

    if(kind === 'pitBridge'){
      rect(st, x, prevY, 72, D.H-prevY+40, 'floor');
      rect(st, x + 142, y, roomW - 142, D.H-y+40, 'floor');
      rect(st, x + 84, Math.min(prevY, y) - 42, 58, 10, 'platform');
      rect(st, x + 154, y - 66, 62, 10, 'platform');
      addEnemy(st, types[0], x + 170, y - 66 - enemyConfig(types[0]).h);
      if(i % 2) addCapsule(st, x + 104, Math.min(prevY, y) - 58);
      st.floorY = y;
      st.nextX = x + roomW;
      return;
    }
    if(kind === 'upperRoute' || kind === 'shaft'){
      var upperY = clamp(prevY - (kind === 'shaft' ? 72 : 56), D.GROUND - 84, D.GROUND - 32);
      rect(st, x, prevY, 70, D.H-prevY+40, 'floor');
      addLadder(st, x + 52, upperY, prevY);
      rect(st, x + 58, upperY, roomW - 102, 10, 'platform');
      rect(st, x + roomW - 46, upperY, 92, D.H-upperY+40, 'floor');
      if(kind === 'shaft'){
        rect(st, x + 96, upperY + 34, 52, 10, 'platform');
        addLadder(st, x + 150, upperY, upperY + 76);
        addEnemy(st, 'drone', x + 174, upperY - 44);
      }
      addEnemyPair(st, types, x + 96, upperY);
      if(i % 3 === 0) addCapsule(st, x + 136, upperY - 22);
      st.floorY = upperY;
      st.nextX = x + roomW;
      return;
    }
    if(kind === 'dropRoom'){
      var lowY = clamp(y + 48, D.GROUND - 24, D.GROUND);
      rect(st, x, y, 76, D.H-y+40, 'floor');
      rect(st, x + 76, y + 30, 48, 10, 'platform');
      rect(st, x + 138, lowY, roomW - 138, D.H-lowY+40, 'floor');
      addEnemyPair(st, types, x + 148, lowY);
      st.floorY = lowY;
      st.nextX = x + roomW;
      return;
    }

    rect(st, x, y, roomW, D.H-y+40, 'floor');
    if(kind === 'intro'){
      addEnemy(st, 'met', x + 122, y - enemyConfig('met').h);
    } else if(kind === 'stairs'){
      rect(st, x + 72, y - 28, 42, 10, 'platform');
      rect(st, x + 126, y - 56, 52, 10, 'platform');
      addEnemy(st, types[0], x + 98, y - 28 - enemyConfig(types[0]).h);
      addEnemy(st, types[1], x + 152, y - 56 - enemyConfig(types[1]).h);
    } else if(kind === 'enemyHall'){
      addEnemyPair(st, types, x + 78, y);
      addEnemy(st, 'turret', x + 166, y - 26);
    } else if(kind === 'ladderRoom'){
      rect(st, x + 88, y - 64, 56, 10, 'platform');
      addLadder(st, x + 106, y - 64, y);
      addEnemy(st, 'turret', x + 164, y - 26);
      addEnemy(st, types[0], x + 102, y - 64 - enemyConfig(types[0]).h);
    } else if(kind === 'platforms'){
      rect(st, x + 48, y - 30, 44, 10, 'platform');
      rect(st, x + 118, y - 58, 58, 10, 'platform');
      addEnemy(st, types[0], x + 72, y - 30 - enemyConfig(types[0]).h);
      addEnemy(st, types[1], x + 144, y - 58 - enemyConfig(types[1]).h);
    } else if(kind === 'droneNest'){
      addEnemy(st, 'drone', x + 150, y - 84);
      addEnemy(st, 'drone', x + 196, y - 66);
      addEnemy(st, types[0], x + 96, y - enemyConfig(types[0]).h);
    } else if(kind === 'highRun'){
      rect(st, x + 40, y - 44, 64, 10, 'platform');
      rect(st, x + 118, y - 44, 66, 10, 'platform');
      addEnemyPair(st, types, x + 74, y - 44);
    }
    st.nextX = x + roomW;
  }
  function ensure(st){ while(st.nextX < st.cameraX + 880) addSegment(st); }
  function moveAxis(st, ent, dx, dy){
    ent.x += dx; ent.y += dy; ent.onGround = false;
    for(var i=0;i<st.solids.length;i++){
      var s = st.solids[i];
      if(ent.climbing && dy < 0 && s.kind === 'platform') continue;
      if(!hit(ent, s)) continue;
      if(dy > 0){ ent.y = s.y - ent.h; ent.vy = 0; ent.onGround = true; }
      else if(dy < 0){ ent.y = s.y + s.h; ent.vy = 0; }
      else if(dx > 0){ ent.x = s.x - ent.w; ent.vx = 0; }
      else if(dx < 0){ ent.x = s.x + s.w; ent.vx = 0; }
    }
  }
  function groundAhead(st, x, probeY){
    probeY = probeY == null ? D.GROUND : probeY;
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];
      if((s.kind === 'floor' || s.kind === 'platform') && x >= s.x && x <= s.x+s.w && s.y >= probeY - 32 && s.y <= probeY + 58) return true;
    }
    return false;
  }
  function floorYAt(st, x){
    var best = Infinity;
    for(var i=0;i<st.solids.length;i++){
      var s = st.solids[i];
      if((s.kind === 'floor' || s.kind === 'platform') && x >= s.x && x <= s.x + s.w && s.y < best) best = s.y;
    }
    return best < Infinity ? best : D.GROUND;
  }
  function ladderAt(st, ent, pad){
    var cx = ent.x + ent.w * 0.5;
    pad = pad || 0;
    for(var i=0;i<st.ladders.length;i++){
      var l = st.ladders[i];
      if(cx >= l.x - pad && cx <= l.x + l.w + pad && ent.y + ent.h > l.y - 2 && ent.y < l.y + l.h + 2) return l;
    }
    return null;
  }
  function enemyUsesGravity(type){ return type !== 'drone' && type !== 'turret'; }
  function moveGroundEnemy(st, e, dt, m){
    if(e.type === 'hopper' && e.onGround && Math.sin(e.phase * 1.7) > 0.88) e.vy = -190;
    var oldVx = e.vx || 0;
    e.vy = clamp((e.vy || 0) + D.PHYS.gravity * dt * 0.9, -300, D.PHYS.fallMax);
    moveAxis(st, e, (e.vx || 0) * dt, 0);
    if(oldVx && !e.vx) e.vx = -oldVx;
    moveAxis(st, e, 0, e.vy * dt);
    if(e.onGround) e.baseY = e.y;
    if(e.y > D.H + 80) e.alive = false;
  }
  function syncEntities(st){
    st.entities.length = 0;
    st.entities.push({type:'hero', role:'world'}, {type:'palette', role:'drop'});
    st.entities.push({type:'platforms', role:'bass'}, {type:'buster', role:'perc'}, {type:'pickup', role:'lead'}, {type:'stars', role:'noise'});
    for(var i=0;i<Math.min(12, st.enemies.length);i++) if(st.enemies[i].alive) st.entities.push({type:'enemy', role:'counter'});
  }
  D.lookAhead = function(st){
    var h = st.hero, out = {
      gap:false, wall:false, enemy:false, enemyDist:Infinity,
      ladder:false, ladderTop:0, ladderBottom:0, ladderX:0, mustClimb:false,
      platformJump:false, upperPath:false
    };
    var footY = h.y + h.h + 10;
    out.gap = !groundAhead(st, h.x + 42, footY);
    var farGap = !groundAhead(st, h.x + 82, footY);
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i], d=s.x-(h.x+h.w);
      if(d>0 && d<38 && s.y < h.y+h.h-2 && s.y+s.h > h.y+5) out.wall = true;
      if(s.kind === 'platform' && d > 14 && d < 88 && s.y < h.y - 16 && s.y > h.y - 76) out.platformJump = true;
      if((s.kind === 'floor' || s.kind === 'platform') && d > 20 && d < 128 && s.y < h.y - 28 && s.y > h.y - 92) out.upperPath = true;
    }
    for(i=0;i<st.ladders.length;i++){
      var l=st.ladders[i], center=h.x+h.w*0.5, ld=l.x-(h.x+h.w);
      var aligned = center>=l.x-12&&center<=l.x+l.w+12&&h.y+h.h>l.y&&h.y<l.y+l.h+4;
      var approachable = ld>-12&&ld<70&&h.y+h.h>=l.y+l.h-18&&h.y+h.h<=l.y+l.h+30;
      if(aligned || approachable){
        out.ladder=true; out.ladderTop=l.y; out.ladderBottom=l.y+l.h; out.ladderX=l.x;
        out.mustClimb = ((out.gap || farGap || out.wall) || out.upperPath || out.platformJump) && l.x < h.x + 86 && l.y < h.y - 12;
        break;
      }
    }
    for(i=0;i<st.enemies.length;i++){
      var e=st.enemies[i];
      var ed = e.x - h.x;
      if(e.alive && ed > 0 && ed < 150 && Math.abs((e.y + e.h * 0.5) - (h.y + h.h * 0.5)) < 58){
        out.enemy = true;
        out.enemyDist = Math.min(out.enemyDist, ed);
      }
    }
    return out;
  };
  D.make = function(A,U,variant){
    var st = { key:'mega_man_2', variant:variant|0, nativeW:D.W, nativeH:D.H, t:0, seg:0, nextX:0, cameraX:0,
      hero:{ x:28, y:D.GROUND-24, w:14, h:24, vx:0, vy:0, dir:1, onGround:false, climbing:false, run:0, shootCd:0, hurt:0 },
      floorY:D.GROUND, roomTheme:(variant|0), rooms:[], solids:[], ladders:[], enemies:[], shots:[], pickups:[], particles:[], events:[], entities:[], intent:{}, music:{ beat:0, hue:0, energy:0 } };
    for(var i=0;i<5;i++) addSegment(st);
    return st;
  };
  D.update = function(ctx){
    var st=ctx.state, dt=Math.min(ctx.dt||0.016,0.04), h=st.hero, P=D.PHYS, m=st.music||{};
    st.t += dt; st.events.length = 0; ensure(st);
    if(ctx.audio && ctx.audio.paused){ syncEntities(st); return; }
    var inr=st.intent||{}, dir=(inr.right?1:0)-(inr.left?1:0), speedBias=clamp(inr.speedBias||m.speedBias||1,0.85,1.35);
    if(dir){ h.vx += dir*P.accel*dt; h.dir=dir; }
    else if(h.vx>0) h.vx=Math.max(0,h.vx-P.friction*dt); else if(h.vx<0) h.vx=Math.min(0,h.vx+P.friction*dt);
    h.vx=clamp(h.vx,-P.run*speedBias,P.run*speedBias);
    var ladder=ladderAt(st,h,5), climbDir=(inr.up?-1:0)+(inr.down?1:0);
    if(ladder && (climbDir || h.climbing)){
      h.climbing=true;
      h.x += ((ladder.x + ladder.w*0.5 - h.w*0.5) - h.x) * Math.min(1, dt*12);
      h.vx = 0;
      h.vy = climbDir ? climbDir * 70 : 0;
      h.onGround=false;
    } else h.climbing=false;
    if(inr.jump && h.onGround && !h.climbing){ h.vy=-P.jump; h.onGround=false; ev(st,'jumpStarted'); }
    h.vy=h.climbing?clamp(h.vy,-90,90):clamp(h.vy+P.gravity*dt,-460,P.fallMax);
    moveAxis(st,h,h.vx*dt,0); moveAxis(st,h,0,h.vy*dt);
    if(h.climbing && ladder && h.y + h.h <= ladder.y + 4){
      h.y = ladder.y - h.h;
      h.vy = 0;
      h.onGround = true;
      h.climbing = false;
    } else if(h.climbing && (!ladderAt(st,h,5) || (h.onGround && climbDir>0))) h.climbing=false;
    if(h.onGround) h.run += Math.abs(h.vx)*dt/14;
    h.shootCd=Math.max(0,h.shootCd-dt);
    if(inr.shoot && h.shootCd<=0 && st.shots.length<10){
      var shotW=6, shotH=6;
      h.shootCd=Math.max(0.12, (m.spb || 0.38) * 0.45); st.shots.push({x:h.x+(h.dir>0?h.w:-shotW),y:h.y+8,w:shotW,h:shotH,vx:h.dir*170,role:'perc',life:Math.max(0.5, (m.spb || 0.38) * 2.1)});
      ev(st,'busterFired');
    }
    for(var si=st.shots.length-1;si>=0;si--){
      var sh=st.shots[si]; sh.x+=sh.vx*dt; sh.life-=dt;
      for(var ei=0;ei<st.enemies.length;ei++){ var e=st.enemies[ei]; if(e.alive&&hit(sh,e)){ e.hp--; e.pulse=1; sh.life=0; ev(st,'enemyHit'); if(e.hp<=0){e.alive=false; ev(st,'enemyDestroyed');} break; } }
      if(sh.life<=0||sh.x<st.cameraX-40||sh.x>st.cameraX+D.W+80) st.shots.splice(si,1);
    }
    for(ei=0;ei<st.enemies.length;ei++){
      e=st.enemies[ei]; if(!e.alive) continue; e.phase+=dt*(2+(m.energy||0)*4); e.pulse=Math.max(0,e.pulse-dt*4);
      if(e.type==='drone'){
        e.x+=e.vx*dt;
        e.y = e.baseY + Math.sin(e.phase) * 10;
      } else if(e.type==='turret') {
        e.vx = 0;
      } else if(enemyUsesGravity(e.type)) {
        moveGroundEnemy(st, e, dt, m);
        if(!e.alive) continue;
      } else {
        e.x+=e.vx*dt;
      }
      if(hit(h,e)){ h.hurt=0.3; ev(st,'playerHit'); }
    }
    for(var pi=0;pi<st.pickups.length;pi++){ var p=st.pickups[pi]; if(!p.got && hit(h,p)){ p.got=true; ev(st,'pickupCollected'); } p.pulse=Math.max(0,p.pulse-dt*3); }
    if(h.y>D.H+40){ h.x=st.cameraX+44; h.y=floorYAt(st, h.x + 6)-24; h.vx=0; h.vy=0; ev(st,'respawned'); }
    st.cameraX += ((h.x-82)-st.cameraX)*Math.min(1,dt*4.5);
    if(st.cameraX<0) st.cameraX=0;
    var min=st.cameraX-80;
    st.solids=st.solids.filter(function(s){return s.x+s.w>min;});
    st.rooms=st.rooms.filter(function(s){return s.x+s.w>min;});
    st.ladders=st.ladders.filter(function(s){return s.x+s.w>min;});
    st.enemies=st.enemies.filter(function(e){return e.x>min&&e.x<st.cameraX+520;});
    st.pickups=st.pickups.filter(function(p){return !p.got && p.x>min&&p.x<st.cameraX+520;});
    syncEntities(st);
  };
  VisualizerGame.layer('mega_man_2','definition',{packVersion:2,key:'mega_man_2',name:'Mega Man 2-style action platformer',family:'run-and-gun platformer',entities:['hero','busterShot','metEnemy','turretEnemy','droneEnemy','walkerEnemy','hopperEnemy','shieldEnemy','weaponEnergyCapsule','ladder','steelPlatform','cityBackdrop'],rules:['run acceleration','single grounded jump','required ladder climbing','upper-route traversal','solid platform collision','buster firing','enemy damage','rare pickup collection','camera follow','pit recovery'],events:['jumpStarted','busterFired','enemyHit','enemyDestroyed','pickupCollected','playerHit','respawned'],performance:{maxEntities:96,maxParticles:40},update:D.update});
  if(typeof window!=='undefined') window.MegaMan2Definition=D; else this.MegaMan2Definition=D;
})();
