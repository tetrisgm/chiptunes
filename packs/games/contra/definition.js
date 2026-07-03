// CONTRA definition: jungle run-and-gun rules, one-way panes, target-gated shots, crates, and hit recovery.
(function(){
  var D={W:256,H:224,GROUND:184,PHYS:{run:124,accel:880,friction:820,gravity:1260,jump:326,fallMax:455}};
  var ENEMY_CAP=56,SHOT_CAP=28,ENEMY_SHOT_CAP=24;
  var HARD={ground:1,bridge:1,wall:1};
  var ONEWAY={platform:1,towerDeck:1};
  var DECOR={towerPost:1,vine:1};
  var ENEMY={
    soldier:{w:12,h:22,hp:1,vx:-25,role:'counter',ground:true},
    runner:{w:12,h:22,hp:1,vx:-45,role:'counter',ground:true},
    sniper:{w:13,h:22,hp:1,vx:0,role:'counter'},
    turret:{w:18,h:16,hp:2,vx:0,role:'perc'},
    flyer:{w:16,h:12,hp:1,vx:-42,role:'counter',air:true},
    grenadier:{w:13,h:22,hp:2,vx:0,role:'counter'},
    crawler:{w:15,h:10,hp:1,vx:-31,role:'counter',ground:true},
    jumper:{w:12,h:22,hp:1,vx:-20,role:'counter',ground:true,jump:true},
    gunner:{w:14,h:22,hp:2,vx:0,role:'counter'},
    paratrooper:{w:15,h:24,hp:1,vx:-21,role:'counter',drop:true,dropSpeed:18},
    prone:{w:17,h:10,hp:1,vx:0,role:'counter',ground:true},
    mortar:{w:15,h:18,hp:2,vx:0,role:'counter',lobber:true},
    wallCannon:{w:16,h:16,hp:2,vx:0,role:'perc',cannon:true},
    diver:{w:12,h:22,hp:1,vx:-30,role:'counter',ground:true,leap:true},
    heavy:{w:16,h:24,hp:3,vx:-17,role:'counter',ground:true}
  };
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function hit(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
  function ev(st,t,d){if(st.events.length<56)st.events.push({type:t,detail:d||null});}
  function solid(st,x,y,w,h,k){st.solids.push({x:x,y:y,w:w,h:h,kind:k||'ground',role:ONEWAY[k]?'counter':DECOR[k]?'world':'bass'});}
  function room(st,x,w,kind){if(st.rooms.length<48)st.rooms.push({x:x,y:30,w:w,h:154,kind:kind,role:'world'});}
  function isHard(s){return !!HARD[s.kind];}
  function isOneWay(s){return !!ONEWAY[s.kind];}
  function addEnemy(st,type,x,y,dir){
    if(st.enemies.length>=ENEMY_CAP)return null;
    var spec=ENEMY[type]||ENEMY.soldier,vx=spec.vx||0;
    if(dir)vx=Math.abs(vx)*dir;
    var e={type:type,role:spec.role,x:x,y:y,w:spec.w,h:spec.h,vx:vx,vy:0,hp:spec.hp,alive:true,phase:x*.04,shootCd:.24+(x%7)*.07,pulse:0,onGround:false,baseY:y};
    st.enemies.push(e);
    return e;
  }
  function pickup(st,type,x,y,weapon){
    if(st.pickups.length>=34)return;
    st.pickups.push({type:type||'medal',role:type==='power'?'perc':'lead',weapon:weapon||'',x:x,y:y,w:type==='power'?12:9,h:type==='power'?10:9,got:false,pulse:0});
  }
  function crate(st,x,y,weapon){
    if(st.crates.length>=20)return;
    st.crates.push({type:'crate',role:'lead',weapon:weapon||'spread',x:x,y:y,w:18,h:18,hp:2,alive:true,pulse:0});
  }
  function addPane(st,x,y,w){solid(st,x,y,w,9,'platform');}
  function addTower(st,x,y,w){
    solid(st,x,y,w,9,'towerDeck');
    solid(st,x+3,y+9,5,D.GROUND-y-9,'towerPost');
    solid(st,x+w-8,y+9,5,D.GROUND-y-9,'towerPost');
  }
  function addEnemyAt(st,type,x,topY,dir){
    var spec=ENEMY[type]||ENEMY.soldier;
    return addEnemy(st,type,x,topY-spec.h,dir);
  }
  function addUpperRoute(st,x,y,mirror){
    if(mirror){
      addPane(st,x+26,y-106,58);
      addPane(st,x+84,y-78,64);
      addPane(st,x+148,y-110,60);
      addPane(st,x+204,y-82,48);
    }else{
      addPane(st,x+24,y-76,58);
      addPane(st,x+82,y-104,64);
      addPane(st,x+146,y-80,66);
      addPane(st,x+204,y-112,46);
    }
  }
  function addStepRoute(st,x,y,upRight){
    var dir=upRight?1:-1,base=upRight?x+24:x+196;
    for(var i=0;i<5;i++){
      addPane(st,base+dir*i*40,y-30-i*18,52);
    }
  }
  function floorAt(st,x){
    var best=Infinity;
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];
      if((isHard(s)||isOneWay(s))&&x>=s.x&&x<=s.x+s.w&&s.y<best)best=s.y;
    }
    return best<Infinity?best:D.GROUND;
  }
  function groundAhead(st,x,y){
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];
      if((isHard(s)||isOneWay(s))&&x>=s.x&&x<=s.x+s.w&&s.y>=y-40&&s.y<=y+60)return true;
    }
    return false;
  }
  function blockedAhead(st,h){
    var probe={x:h.x+h.w+(h.dir>=0?3:-18),y:h.y+4,w:14,h:h.h-7};
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];if(!isHard(s))continue;
      if(hit(probe,s))return true;
    }
    for(i=0;i<st.crates.length;i++){var c=st.crates[i];if(c.alive&&hit(probe,c))return true;}
    return false;
  }
  function addSegment(st){
    var kinds=['bridge','tiered','ambush','waterfall','turretNest','capsules','highRoad','watchline','canopy','bunkerRise','riverCross','cliffRun'];
    var i=st.seg++,x=st.nextX,kind=i<2?'jungle':kinds[i%kinds.length],y=D.GROUND,w=256+(i%3)*26;
    room(st,x,w,kind);
    if(kind==='bridge'){
      solid(st,x,y,86,D.H-y+40,'ground');
      solid(st,x+122,y,134,D.H-y+40,'bridge');
      addPane(st,x+38,y-38,82);addPane(st,x+106,y-68,92);addPane(st,x+176,y-42,74);
      addTower(st,x+152,y-94,32);
      addEnemy(st,'runner',x+35,y-22,1);addEnemy(st,'diver',x+78,y-22,1);addEnemy(st,'soldier',x+136,y-22,-1);addEnemy(st,'gunner',x+161,y-116,0);addEnemy(st,'flyer',x+212,y-104,-1);addEnemy(st,'paratrooper',x+230,y-170,-1);
      crate(st,x+184,y-60,'spread');pickup(st,'medal',x+96,y-50);
      st.nextX=x+w+34;return;
    }
    solid(st,x,y,w,D.H-y+40,'ground');
    addPane(st,x+30,y-34,72);
    addPane(st,x+91,y-62,86);
    addPane(st,x+160,y-38,82);
    if(kind==='jungle'){
      addUpperRoute(st,x,y,i%2);
      addEnemy(st,'soldier',x+72,y-22,-1);addEnemy(st,'runner',x+122,y-22,-1);addEnemyAt(st,'sniper',x+100,y-62,0);addEnemy(st,'crawler',x+180,y-10,-1);addEnemy(st,'paratrooper',x+218,y-166,-1);
      pickup(st,'medal',x+52,y-50);pickup(st,'medal',x+88,y-78);
    }else if(kind==='tiered'){
      addStepRoute(st,x,y,true);addPane(st,x+128,y-118,76);addPane(st,x+194,y-138,48);
      addTower(st,x+188,y-86,34);
      addEnemyAt(st,'sniper',x+48,y-90,0);addEnemyAt(st,'jumper',x+112,y-66,-1);addEnemyAt(st,'prone',x+142,y-118,0);addEnemy(st,'gunner',x+198,y-108,0);addEnemy(st,'runner',x+216,y-22,-1);
      crate(st,x+136,y-114,'laser');
    }else if(kind==='ambush'){
      addUpperRoute(st,x,y,true);
      addEnemy(st,'runner',x+20,y-22,1);addEnemyAt(st,'soldier',x+82,y-34,-1);addEnemy(st,'crawler',x+118,y-10,1);addEnemyAt(st,'grenadier',x+154,y-62,0);addEnemy(st,'flyer',x+210,y-98,-1);addEnemy(st,'heavy',x+235,y-24,-1);
      crate(st,x+72,y-52,'rapid');
    }else if(kind==='waterfall'){
      solid(st,x+118,42,28,142,'vine');
      addPane(st,x+20,y-58,74);addPane(st,x+70,y-88,70);addPane(st,x+128,y-116,72);addPane(st,x+186,y-86,70);addPane(st,x+218,y-130,48);
      addEnemy(st,'flyer',x+146,y-132,-1);addEnemyAt(st,'soldier',x+166,y-86,0);addEnemyAt(st,'jumper',x+220,y-130,-1);addEnemy(st,'runner',x+34,y-22,1);addEnemy(st,'paratrooper',x+244,y-174,-1);
      pickup(st,'medal',x+110,y-110);crate(st,x+212,y-120,'spread');
    }else if(kind==='turretNest'){
      addTower(st,x+54,y-64,34);addTower(st,x+128,y-112,38);addTower(st,x+196,y-82,34);
      addEnemy(st,'turret',x+58,y-80,0);addEnemy(st,'wallCannon',x+132,y-128,0);addEnemy(st,'gunner',x+206,y-104,0);addEnemyAt(st,'sniper',x+98,y-62,0);addEnemy(st,'runner',x+194,y-22,-1);addEnemy(st,'crawler',x+232,y-10,-1);
      crate(st,x+116,y-80,'laser');
    }else if(kind==='capsules'){
      addUpperRoute(st,x,y,false);
      for(var c=0;c<5;c++)pickup(st,'medal',x+52+c*25,y-48-Math.sin(c/4*Math.PI)*22);
      addEnemy(st,'soldier',x+76,y-22,1);addEnemyAt(st,'grenadier',x+134,y-104,0);addEnemy(st,'flyer',x+194,y-96,-1);addEnemy(st,'runner',x+222,y-22,-1);addEnemyAt(st,'prone',x+92,y-62,0);
      crate(st,x+170,y-56,'rapid');
    }else if(kind==='highRoad'){
      addPane(st,x+22,y-72,64);addPane(st,x+80,y-96,68);addPane(st,x+142,y-120,64);addPane(st,x+202,y-94,56);
      addEnemyAt(st,'soldier',x+54,y-72,0);addEnemyAt(st,'sniper',x+116,y-96,0);addEnemyAt(st,'jumper',x+180,y-120,-1);addEnemy(st,'runner',x+60,y-22,1);addEnemy(st,'crawler',x+210,y-10,-1);addEnemyAt(st,'mortar',x+220,y-94,0);
      crate(st,x+132,y-96,'spread');pickup(st,'medal',x+198,y-96);
    }else if(kind==='watchline'){
      addTower(st,x+34,y-74,34);addTower(st,x+102,y-116,34);addTower(st,x+166,y-92,34);addTower(st,x+222,y-70,30);
      addEnemy(st,'gunner',x+44,y-96,0);addEnemy(st,'grenadier',x+112,y-138,0);addEnemy(st,'sniper',x+176,y-114,0);addEnemy(st,'wallCannon',x+228,y-86,0);addEnemy(st,'runner',x+84,y-22,1);addEnemy(st,'runner',x+220,y-22,-1);
      crate(st,x+150,y-56,'laser');
    }else if(kind==='canopy'){
      addUpperRoute(st,x,y,false);addStepRoute(st,x+6,y,false);
      solid(st,x+118,48,18,136,'vine');solid(st,x+204,42,18,142,'vine');
      addEnemy(st,'paratrooper',x+58,y-172,1);addEnemyAt(st,'prone',x+88,y-104,0);addEnemyAt(st,'mortar',x+150,y-80,0);addEnemy(st,'flyer',x+202,y-132,-1);addEnemy(st,'diver',x+228,y-22,-1);
      pickup(st,'medal',x+124,y-128);crate(st,x+204,y-130,'spread');
    }else if(kind==='bunkerRise'){
      addPane(st,x+24,y-42,56);addPane(st,x+72,y-70,58);addPane(st,x+122,y-98,60);addPane(st,x+174,y-126,58);addTower(st,x+205,y-88,36);
      addEnemyAt(st,'wallCannon',x+78,y-70,0);addEnemyAt(st,'heavy',x+128,y-98,-1);addEnemyAt(st,'gunner',x+178,y-126,0);addEnemy(st,'crawler',x+52,y-10,1);addEnemy(st,'runner',x+232,y-22,-1);
      crate(st,x+106,y-88,'laser');pickup(st,'medal',x+188,y-144);
    }else if(kind==='riverCross'){
      addPane(st,x+24,y-46,58);addPane(st,x+74,y-78,54);addPane(st,x+138,y-48,66);addPane(st,x+198,y-84,56);
      addEnemy(st,'diver',x+44,y-22,1);addEnemy(st,'diver',x+152,y-22,-1);addEnemyAt(st,'prone',x+84,y-78,0);addEnemy(st,'flyer',x+198,y-122,-1);addEnemy(st,'paratrooper',x+230,y-168,-1);
      pickup(st,'medal',x+110,y-94);crate(st,x+208,y-102,'rapid');
    }else if(kind==='cliffRun'){
      addStepRoute(st,x,y,true);addPane(st,x+42,y-120,66);addPane(st,x+116,y-138,66);addPane(st,x+188,y-112,52);
      addEnemyAt(st,'sniper',x+50,y-120,0);addEnemyAt(st,'mortar',x+124,y-138,0);addEnemyAt(st,'prone',x+196,y-112,0);addEnemy(st,'heavy',x+76,y-24,1);addEnemy(st,'runner',x+220,y-22,-1);
      crate(st,x+150,y-156,'spread');pickup(st,'medal',x+92,y-140);
    }
    st.nextX=x+w;
  }
  function ensure(st){while(st.nextX<st.cameraX+900)addSegment(st);}
  function move(st,e,dx,dy){
    var px=e.x,py=e.y;
    e.x+=dx;e.y+=dy;
    if(dy>0)e.onGround=false;
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];if(DECOR[s.kind]||!hit(e,s))continue;
      if(isOneWay(s)){
        if(dy>0&&py+e.h<=s.y+3){e.y=s.y-e.h;e.vy=0;e.onGround=true;}
        continue;
      }
      if(!isHard(s))continue;
      if(dy>0){e.y=s.y-e.h;e.vy=0;e.onGround=true;}
      else if(dy<0){e.y=s.y+s.h;e.vy=0;}
      else if(dx>0){e.x=s.x-e.w;e.vx=0;}
      else if(dx<0){e.x=s.x+s.w;e.vx=0;}
    }
    if(dx&&e.x===px)e.vx=0;
  }
  function chooseTarget(st){
    var h=st.hero,best=null,bestScore=1e9,hcx=h.x+h.w*.5,hcy=h.y+h.h*.45;
    for(var i=0;i<st.enemies.length;i++){
      var e=st.enemies[i];if(!e.alive)continue;
      var ex=e.x+e.w*.5,ey=e.y+e.h*.45,dx=ex-hcx,dy=ey-hcy,adx=Math.abs(dx),ady=Math.abs(dy);
      if(adx>226||ady>126)continue;
      var score=adx+ady*.62+(dx<0?8:0)+(e.type==='turret'||e.type==='gunner'?-4:0);
      if(score<bestScore){bestScore=score;best={enemy:e,dx:dx,dy:dy,dist:Math.sqrt(dx*dx+dy*dy)};}
    }
    return best;
  }
  function spawnHeroShots(st,h,m){
    if(st.shots.length>=SHOT_CAP)return false;
    var ax=h.aimX==null?(h.dir||1):h.aimX,ay=h.aimY||0,len=Math.sqrt(ax*ax+ay*ay)||1,spb=m.spb||.36,weapon=h.weapon||'rifle';
    var speed=weapon==='laser'?346:302,life=weapon==='laser'?2.2:1.75,damage=weapon==='laser'?2:1;
    var baseX=h.x+(ax>=0?h.w:-5),baseY=h.y+(ay<0?5:ay>0?15:10);
    function shot(dx,dy,wide){
      var l=Math.sqrt(dx*dx+dy*dy)||1;
      st.shots.push({x:baseX,y:baseY,w:wide?8:5,h:wide?4:5,vx:dx/l*speed,vy:dy/l*speed,life:life,damage:damage,weapon:weapon,role:'perc'});
    }
    if(weapon==='spread'){
      shot(ax/len,ay/len,0);
      shot(ax/len,ay/len-.42,0);
      shot(ax/len,ay/len+.42,0);
      h.shootCd=Math.max(.2,spb*.48);
    }else{
      shot(ax/len,ay/len,weapon==='laser');
      h.shootCd=weapon==='rapid'?Math.max(.09,spb*.24):Math.max(.16,spb*.42);
    }
    ev(st,'rifleFired',{aimX:ax,aimY:ay,weapon:weapon});
    return true;
  }
  function breakCrate(st,c){
    c.alive=false;c.pulse=1;
    pickup(st,'power',c.x+3,c.y-14,c.weapon);
    ev(st,'crateDestroyed',{weapon:c.weapon});
  }
  function hitTargets(st,sh){
    for(var ci=0;ci<st.crates.length;ci++){
      var c=st.crates[ci];if(c.alive&&hit(sh,c)){c.hp-=sh.damage||1;c.pulse=1;sh.life=0;ev(st,'crateHit');if(c.hp<=0)breakCrate(st,c);return true;}
    }
    for(var ei=0;ei<st.enemies.length;ei++){
      var e=st.enemies[ei];if(e.alive&&hit(sh,e)){e.hp-=sh.damage||1;e.pulse=1;sh.life=0;ev(st,'enemyHit');if(e.hp<=0){e.alive=false;ev(st,'enemyDestroyed',{type:e.type});}return true;}
    }
    return false;
  }
  function hurtHero(st,h){
    if(h.invuln>0)return;
    h.hurt=1;h.invuln=1.15;h.noShoot=1;h.vx*=.28;h.vy=Math.min(h.vy,60);
    ev(st,'playerHit');
  }
  function enemyFire(st,e,h,m,ei){
    if(st.enemyShots.length>=ENEMY_SHOT_CAP)return;
    var ex=e.x+e.w*.5,ey=e.y+e.h*.45,dx=(h.x+h.w*.5)-ex,dy=(h.y+h.h*.45)-ey;
    var grenade=e.type==='grenadier'||e.type==='mortar',cannon=e.type==='turret'||e.type==='gunner'||e.type==='wallCannon';
    if(e.type==='mortar')dy-=58;
    var l=Math.sqrt(dx*dx+dy*dy)||1,spd=e.type==='mortar'?82:grenade?88:e.type==='wallCannon'?132:112;
    st.enemyShots.push({type:grenade?'grenade':'bullet',x:ex,y:ey,w:grenade?6:5,h:grenade?6:5,vx:dx/l*spd,vy:dy/l*spd,life:grenade?1.9:1.35,role:'counter'});
    e.shootCd=Math.max(.38,(m.spb||.36)*(cannon?0.9:(e.type==='prone'?1.05:1.45)))+(ei%3)*.08;
    ev(st,'enemyFired',{type:e.type});
  }
  function sync(st){
    st.entities.length=0;
    st.entities.push({type:'commando',role:'world'},{type:'pickup',role:'lead'},{type:'weaponCrate',role:'lead'},{type:'soldier',role:'counter'},{type:'runner',role:'counter'},{type:'grenadier',role:'counter'},{type:'crawler',role:'counter'},{type:'jumper',role:'counter'},{type:'gunner',role:'counter'},{type:'paratrooper',role:'counter'},{type:'proneShooter',role:'counter'},{type:'mortarLobber',role:'counter'},{type:'wallCannon',role:'perc'},{type:'riverDiver',role:'counter'},{type:'heavySoldier',role:'counter'},{type:'rifle',role:'perc'},{type:'jungleFloor',role:'bass'},{type:'watchtower',role:'counter'},{type:'jungleLeaves',role:'noise'},{type:'explosion',role:'drop'});
  }
  D.lookAhead=function(st){
    var h=st.hero,o={gap:false,enemy:false,bullet:false,platform:false,blocked:false,aimX:1,aimY:0,target:null};
    o.gap=!groundAhead(st,h.x+52,h.y+h.h+8);
    o.blocked=blockedAhead(st,h);
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i],d=s.x-(h.x+h.w);
      if(isOneWay(s)&&d>-10&&d<68&&s.y<h.y-8&&s.y>h.y-98)o.platform=true;
    }
    var tgt=chooseTarget(st);
    if(tgt){
      o.enemy=true;o.target=tgt.enemy;
      var ax=tgt.dx===0?0:(tgt.dx>0?1:-1),ay=0;
      if(tgt.dy<-18)ay=-1;else if(tgt.dy>22)ay=1;
      if(Math.abs(tgt.dx)<15&&ay)ax=0;
      o.aimX=ax||h.dir||1;o.aimY=ay;
    }
    for(i=0;i<st.enemyShots.length;i++){var b=st.enemyShots[i];if(Math.abs(b.x-h.x)<54&&Math.abs(b.y-h.y)<26)o.bullet=true;}
    return o;
  };
  D.make=function(A,U,v){
    var st={key:'contra',variant:v|0,nativeW:D.W,nativeH:D.H,t:0,seg:0,nextX:0,cameraX:0,rooms:[],
      hero:{x:30,y:D.GROUND-24,w:13,h:24,vx:0,vy:0,dir:1,aimX:1,aimY:0,onGround:false,run:0,roll:0,shootCd:0,hurt:0,invuln:0,noShoot:0,weapon:'rifle',powerT:0},
      solids:[],enemies:[],shots:[],enemyShots:[],pickups:[],crates:[],events:[],entities:[],intent:{},music:{}};
    for(var i=0;i<5;i++)addSegment(st);
    return st;
  };
  D.update=function(ctx){
    var st=ctx.state,dt=Math.min(ctx.dt||.016,.04),h=st.hero,P=D.PHYS,m=st.music||{};st.t+=dt;st.events.length=0;ensure(st);
    if(ctx.audio&&ctx.audio.paused){sync(st);return;}
    h.invuln=Math.max(0,h.invuln-dt);h.noShoot=Math.max(0,h.noShoot-dt);h.hurt=Math.max(0,h.hurt-dt);h.powerT=Math.max(0,(h.powerT||0)-dt);
    if(h.powerT<=0)h.weapon='rifle';
    var I=st.intent||{},dir=(I.right?1:0)-(I.left?1:0),bias=clamp(I.speedBias||1,.82,1.35),hurtMul=h.hurt>0?.46:1;
    if(dir){h.vx+=dir*P.accel*dt;h.dir=dir;}
    else if(h.vx>0)h.vx=Math.max(0,h.vx-P.friction*dt);else h.vx=Math.min(0,h.vx+P.friction*dt);
    h.vx=clamp(h.vx,-P.run*bias*hurtMul,P.run*bias*hurtMul);
    if(I.jump&&h.onGround){h.vy=-P.jump;h.onGround=false;ev(st,'jumpStarted');}
    h.vy=clamp(h.vy+P.gravity*dt,-450,P.fallMax);
    move(st,h,h.vx*dt,0);move(st,h,0,h.vy*dt);
    h.run+=Math.abs(h.vx)*dt/11;h.roll+=(!h.onGround?dt*(10+Math.abs(h.vx)*.04):0);
    h.aimX=I.aimX==null?(h.dir||1):I.aimX;h.aimY=I.aimY||0;if(h.aimX)h.dir=h.aimX;
    h.shootCd=Math.max(0,h.shootCd-dt);
    if(I.shoot&&h.noShoot<=0&&h.shootCd<=0)spawnHeroShots(st,h,m);
    for(var si=st.shots.length-1;si>=0;si--){
      var sh=st.shots[si];sh.x+=sh.vx*dt;sh.y+=sh.vy*dt;sh.life-=dt;hitTargets(st,sh);
      if(sh.life<=0||sh.x<st.cameraX-70||sh.x>st.cameraX+D.W+320||sh.y<-18||sh.y>D.H+18)st.shots.splice(si,1);
    }
    for(var ei=0;ei<st.enemies.length;ei++){
      var e=st.enemies[ei],spec=ENEMY[e.type]||ENEMY.soldier;if(!e.alive)continue;
      e.phase+=dt*(2.5+(m.energy||0)*2.5);e.pulse=Math.max(0,e.pulse-dt*4);e.shootCd-=dt;
      if(spec.drop&&!e.landed){
        e.vy=clamp((e.vy||spec.dropSpeed||18)+P.gravity*.24*dt,-80,148);
        move(st,e,e.vx*dt,0);move(st,e,0,e.vy*dt);
        if(e.onGround){e.landed=true;e.type='runner';e.vx=-36;ev(st,'enemyLanded',{type:'paratrooper'});}
      }
      else if(spec.air){e.x+=e.vx*dt;e.y+=Math.sin(e.phase)*18*dt;}
      else if(spec.ground){
        if((spec.jump||spec.leap)&&e.onGround&&Math.sin(e.phase)> (spec.leap?0.88:0.94))e.vy=spec.leap?-255:-205;
        e.vy=clamp((e.vy||0)+P.gravity*dt,-320,P.fallMax);
        move(st,e,e.vx*dt,0);move(st,e,0,e.vy*dt);
        if(!groundAhead(st,e.x+(e.vx<0?-8:e.w+8),e.y+e.h+6))e.vx*=-1;
      }
      if(e.x>st.cameraX-26&&e.x<st.cameraX+282&&e.shootCd<=0)enemyFire(st,e,h,m,ei);
      if(hit(h,e))hurtHero(st,h);
    }
    for(si=st.enemyShots.length-1;si>=0;si--){
      var es=st.enemyShots[si];es.x+=es.vx*dt;es.y+=es.vy*dt;if(es.type==='grenade')es.vy+=120*dt;es.life-=dt;
      if(hit(h,es)){hurtHero(st,h);es.life=0;ev(st,'nearMiss');}
      if(es.life<=0||es.x<st.cameraX-80||es.x>st.cameraX+D.W+80||es.y<-20||es.y>D.H+24)st.enemyShots.splice(si,1);
    }
    for(var pi=0;pi<st.pickups.length;pi++){
      var p=st.pickups[pi];p.pulse=Math.max(0,p.pulse-dt*3);
      if(!p.got&&hit(h,p)){
        p.got=true;
        if(p.type==='power'){h.weapon=p.weapon||'spread';h.powerT=12;ev(st,'weaponCollected',{weapon:h.weapon});}
        else ev(st,'pickupCollected');
      }
    }
    for(var ci=0;ci<st.crates.length;ci++)st.crates[ci].pulse=Math.max(0,(st.crates[ci].pulse||0)-dt*4);
    if(h.y>D.H+45){var rx=st.cameraX+70;h.x=rx;h.y=floorAt(st,rx+8)-h.h;h.vx=h.vy=0;h.hurt=.4;h.invuln=.9;ev(st,'respawned');}
    st.cameraX+=((h.x-86)-st.cameraX)*Math.min(1,dt*4.8);if(st.cameraX<0)st.cameraX=0;
    var min=st.cameraX-116,max=st.cameraX+700;
    st.rooms=st.rooms.filter(function(r){return r.x+r.w>min;});
    st.solids=st.solids.filter(function(s){return s.x+s.w>min;});
    st.enemies=st.enemies.filter(function(e){return e.x>min&&e.x<max;});
    st.pickups=st.pickups.filter(function(p){return !p.got&&p.x>min&&p.x<max;});
    st.crates=st.crates.filter(function(c){return c.alive&&c.x>min&&c.x<max;});
    sync(st);
  };
  VisualizerGame.layer('contra','definition',{packVersion:3,key:'contra',name:'Contra-style jungle run-and-gun',family:'run-and-gun platformer',entities:['commando','roundRifleShot','spreadShot','laserShot','enemySoldier','runner','sniper','turret','flyer','grenadier','crawler','jumper','gunner','paratrooper','proneShooter','mortarLobber','wallCannon','riverDiver','heavySoldier','enemyBullet','enemyGrenade','weaponCrate','weaponPowerup','medal','jungleGround','bridge','upperPlatform','watchtower','canopyRoute','bunkerRoute','riverRoute','cliffRoute'],rules:['fast run','grounded jump with rolling air pose','one-way platforms solid only from above','8-way rifle aiming','target-gated discrete firing','full-screen player shots','breakable weapon crates','enemy projectile avoidance','left and right enemy spawns','multi-pane platform traversal','paratroopers drop into runners','mortars lob arcing grenades','wall cannons guard elevated routes','river divers leap from low lanes','hit blink and one-second slow/shoot lockout','camera follow','pit recovery'],events:['jumpStarted','rifleFired','enemyFired','enemyLanded','enemyHit','enemyDestroyed','crateHit','crateDestroyed','weaponCollected','pickupCollected','nearMiss','playerHit','respawned'],performance:{maxEntities:176,maxParticles:48},update:D.update});
  if(typeof window!=='undefined')window.ContraDefinition=D;else this.ContraDefinition=D;
})();
