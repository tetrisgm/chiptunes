// EXCITEBIKE definition: NES-style motocross lanes, bikes, ramps, mud, jumps, and heat.
(function(){
  var D={
    W:256,H:224,TRACK_TOP:76,LANES:[96,122,148,174],VIEW_X:70,
    PHYS:{gravity:760,jump:242,runMin:104,runMax:190,laneEase:9.5}
  };
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function ev(st,t,d){if(st.events.length<50)st.events.push({type:t,detail:d||null});}
  function laneY(lane){return D.LANES[clamp(lane|0,0,D.LANES.length-1)];}
  function frontX(st){return st.worldX+st.bike.screenX+22;}
  function add(st,type,x,lane,opt){
    if(st.elements.length>=96)return;
    opt=opt||{};
    var spec={
      ramp:{w:30,h:18,kind:'single'},
      tabletop:{w:48,h:18,kind:'tabletop'},
      whoops:{w:58,h:12,kind:'whoops'},
      mud:{w:38,h:9,kind:'mud'},
      opponent:{w:34,h:20,kind:'opponent',vx:-4+((x+lane*7)%5)*3}
    }[type]||{w:24,h:10,kind:type};
    st.elements.push({
      type:type,kind:opt.kind||spec.kind,role:type==='mud'?'bass':type==='opponent'?'counter':'lead',
      x:x,y:laneY(lane),lane:clamp(lane|0,0,3),w:opt.w||spec.w,h:opt.h||spec.h,
      vx:opt.vx==null?(spec.vx||0):opt.vx,used:false,hit:false,pulse:0,phase:(x*.017+lane)
    });
  }
  function decor(st,x,w,kind){st.decor.push({x:x,w:w,kind:kind});}
  function segment(st){
    var i=st.seg++,x=st.nextX,kind=i<2?'intro':['tabletop','opponents','mudSplit','whoopLane','doubleRamps','mixed','stadium'][i%7];
    decor(st,x,210,kind);
    if(kind==='intro'){
      add(st,'ramp',x+90,1,{kind:'single'});add(st,'opponent',x+150,2);
    }else if(kind==='tabletop'){
      add(st,'tabletop',x+54,(i+1)%4);add(st,'ramp',x+136,(i+2)%4,{kind:'steep'});add(st,'opponent',x+178,(i+3)%4);
    }else if(kind==='opponents'){
      add(st,'opponent',x+54,(i+1)%4,{vx:4});add(st,'opponent',x+104,(i+2)%4,{vx:-7});add(st,'ramp',x+152,(i+3)%4);
    }else if(kind==='mudSplit'){
      add(st,'mud',x+48,i%4);add(st,'mud',x+94,(i+1)%4);add(st,'tabletop',x+132,(i+2)%4);add(st,'opponent',x+190,(i+3)%4);
    }else if(kind==='whoopLane'){
      add(st,'whoops',x+50,1);add(st,'whoops',x+114,1);add(st,'mud',x+176,3);add(st,'opponent',x+206,0);
    }else if(kind==='doubleRamps'){
      add(st,'ramp',x+48,0,{kind:'single'});add(st,'ramp',x+82,0,{kind:'single'});add(st,'tabletop',x+146,2);add(st,'opponent',x+202,3);
    }else if(kind==='mixed'){
      add(st,'mud',x+46,2);add(st,'ramp',x+78,0,{kind:'steep'});add(st,'opponent',x+126,1);add(st,'whoops',x+172,3);
    }else{
      add(st,'tabletop',x+44,3);add(st,'ramp',x+116,2);add(st,'opponent',x+164,1);add(st,'mud',x+204,0);
    }
    st.nextX=x+220;
  }
  function ensure(st){while(st.nextX<st.worldX+840)segment(st);}
  function sameLane(a,b){return Math.abs(a-b)<.52;}
  function scoreLane(st,l){
    var b=st.bike,fx=frontX(st),score=Math.abs(l-b.targetLane)*9,hasRamp=false;
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i],d=e.x-fx;if(d<14||d>126||e.lane!==l)continue;
      if(e.type==='mud')score+=32*(1-d/150);
      else if(e.type==='opponent')score+=36*(1-d/150);
      else if(e.type==='ramp'||e.type==='tabletop'||e.type==='whoops'){hasRamp=true;score-=12*(1-d/170);}
    }
    return score-(hasRamp?4:0);
  }
  D.lookAhead=function(st){
    var b=st.bike,fx=frontX(st),o={ramp:false,mud:false,bike:false,targetLane:b.targetLane,landing:false};
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i],d=e.x-fx;if(d<10||d>118)continue;
      if(sameLane(e.lane,b.targetLane)){
        if(e.type==='ramp'||e.type==='tabletop'||e.type==='whoops')o.ramp=true;
        if(e.type==='mud')o.mud=true;
        if(e.type==='opponent')o.bike=true;
      }
    }
    var best=b.targetLane,bestScore=scoreLane(st,b.targetLane);
    for(var l=0;l<4;l++){var sc=scoreLane(st,l);if(sc<bestScore){best=l;bestScore=sc;}}
    o.targetLane=best;
    return o;
  };
  function sync(st){
    st.entities.length=0;
    st.entities.push({type:'riderMotorbike',role:'world'},{type:'opponentMotorbike',role:'counter'},{type:'slopeRamp',role:'lead'},{type:'mudPatch',role:'bass'},{type:'laneMarkers',role:'perc'},{type:'crowdFlags',role:'noise'},{type:'finishBanner',role:'drop'});
  }
  D.make=function(A,U,v){
    var st={
      key:'excitebike',variant:v|0,nativeW:D.W,nativeH:D.H,t:0,seg:0,nextX:0,worldX:0,speed:124,events:[],entities:[],intent:{},music:{},
      bike:{screenX:D.VIEW_X,lane:1,targetLane:1,laneY:laneY(1),z:0,zv:0,onGround:true,tilt:0,heat:0,frame:0,lean:0,boost:0},
      elements:[],decor:[]
    };
    for(var i=0;i<6;i++)segment(st);
    return st;
  };
  D.update=function(ctx){
    var st=ctx.state,dt=Math.min(ctx.dt||.016,.04),b=st.bike,m=st.music||{},I=st.intent||{},P=D.PHYS;
    st.t+=dt;st.events.length=0;ensure(st);
    if(ctx.audio&&ctx.audio.paused){sync(st);return;}
    var bpmScale=clamp((m.bpm||154)/154,.72,1.36),energy=clamp(m.energy||0,0,1);
    if(I.up)b.targetLane=Math.max(0,b.targetLane-1);
    if(I.down)b.targetLane=Math.min(3,b.targetLane+1);
    if(I.targetLane!=null)b.targetLane=clamp(I.targetLane,0,3);
    var targetY=laneY(b.targetLane),oldY=b.laneY;
    b.laneY+=(targetY-b.laneY)*Math.min(1,dt*P.laneEase);
    b.lane=b.targetLane;
    b.lean=clamp((b.laneY-oldY)*.045,-.34,.34);
    var speedTarget=(118+energy*38)*bpmScale+(I.throttle?16:0)-(I.engineBrake?22:0);
    st.speed+=(speedTarget-st.speed)*Math.min(1,dt*2.7);
    st.speed=clamp(st.speed,P.runMin,P.runMax);
    st.worldX+=st.speed*dt;
    if(!b.onGround){
      b.zv+=P.gravity*dt;b.z+=b.zv*dt;b.tilt*=Math.pow(.14,dt);
      if(b.z>=0){b.z=0;b.zv=0;b.onGround=true;b.tilt*=.42;ev(st,'landing');}
    }else{
      b.z=0;b.zv=0;b.tilt*=Math.pow(.22,dt);
    }
    b.heat=clamp(b.heat+Math.max(0,st.speed-128)*dt*.0048-(I.engineBrake?.34*dt:.08*dt),0,1);
    if(b.heat>.96){st.speed*=.968;b.heat=.9;ev(st,'overheat');}
    b.frame+=dt*st.speed/13;
    var fx=frontX(st),bikeLane=b.targetLane;
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i];e.x+=e.vx*dt;e.phase+=dt*(1.5+energy*3);e.pulse=Math.max(0,e.pulse-dt*3.5);
      var d=e.x-fx,near=d>-8&&d<22&&sameLane(e.lane,bikeLane);
      if(!near||e.used)continue;
      if((e.type==='ramp'||e.type==='tabletop'||e.type==='whoops')&&b.onGround){
        e.used=true;e.pulse=1;
        var lift=e.type==='tabletop'?218:e.type==='whoops'?178:(e.kind==='steep'?258:232);
        b.z=-1;b.zv=-lift-(m.rampPulse||0)*26;b.onGround=false;b.tilt=e.type==='whoops'?.12:-.26;st.speed+=e.type==='whoops'?4:10;
        ev(st,'rampJump',{kind:e.type,lane:e.lane});
      }else if(e.type==='mud'&&b.z>-8){
        e.used=true;e.pulse=1;st.speed*=.74;b.heat=Math.max(0,b.heat-.18);b.tilt=.13;ev(st,'mudHit');
      }else if(e.type==='opponent'&&b.z>-13){
        e.used=true;e.pulse=1;st.speed*=.8;b.tilt=.5;ev(st,'overtakeBump');
      }
    }
    st.elements=st.elements.filter(function(e){return e.x>st.worldX-110&&e.x<st.worldX+980;});
    st.decor=st.decor.filter(function(d){return d.x+d.w>st.worldX-90&&d.x<st.worldX+980;});
    ensure(st);
    if(st.worldX>3200){
      st.worldX-=2600;st.nextX-=2600;
      for(i=0;i<st.elements.length;i++)st.elements[i].x-=2600;
      for(i=0;i<st.decor.length;i++)st.decor[i].x-=2600;
      ev(st,'lapComplete');
    }
    sync(st);
  };
  VisualizerGame.layer('excitebike','definition',{
    packVersion:2,key:'excitebike',name:'Excitebike-style motocross',family:'lane motocross racer',
    entities:['riderMotorbike','opponentMotorbike','slopeRamp','tabletopRamp','whoops','mudPatch','trackLane','stadiumCrowd','heatMeter'],
    rules:['four continuous lane movement','separate jump height and landing physics','slope/tabletop/whoop ramps','mud slowdown','opponent bike avoidance','engine heat buildup','lap loop','fixed side camera with scrolling track'],
    events:['rampJump','landing','mudHit','overtakeBump','overheat','lapComplete'],
    watchdog:{mode:'scroll',progress:24,motion:10},performance:{maxEntities:120,maxParticles:44},update:D.update
  });
  if(typeof window!=='undefined')window.ExcitebikeDefinition=D;else this.ExcitebikeDefinition=D;
})();
