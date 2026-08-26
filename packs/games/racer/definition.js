// RACER definition: NES-style motocross lanes, bikes, ramps, mud, jumps, and heat.
(function(){
  var D={
    W:256,H:224,TRACK_TOP:76,LANES:[96,122,148,174],VIEW_X:70,
    // launch* build the ramp-lip impulse: a constant kick + a term that scales with
    // ramp STEEPNESS x speed + a term that scales with raw speed. A steep ramp taken
    // fast throws the bike several times higher than a shallow one taken slow.
    // apexPad is how far below the top of the frame a jump is allowed to peak.
    PHYS:{gravity:760,jump:242,runMin:104,runMax:190,laneEase:9.5,
      launchBase:118,launchSlope:1.5,launchSpeed:.45,apexPad:14,
      mudDrag:.14,mudMin:58}
  };
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function ev(st,t,d){if(st.events.length<50)st.events.push({type:t,detail:d||null});}
  function laneY(lane){return D.LANES[clamp(lane|0,0,D.LANES.length-1)];}
  function frontX(st){return st.worldX+st.bike.screenX+22;}
  function add(st,type,x,lane,opt){
    if(st.elements.length>=96)return;
    opt=opt||{};
    var spec={
      ramp:{w:40,h:20,kind:'single'},
      tabletop:{w:48,h:18,kind:'tabletop'},
      whoops:{w:58,h:12,kind:'whoops'},
      mud:{w:46,h:9,kind:'mud'},
      opponent:{w:34,h:20,kind:'opponent',vx:84+((x+lane*17)%7)*9}
    }[type]||{w:24,h:10,kind:type};
    // 'steep' was previously identical geometry to 'single'; give it a real profile
    // (shorter run-up, taller lip) so the two ramp kinds launch differently.
    if(type==='ramp'&&(opt.kind||spec.kind)==='steep')spec={w:30,h:24,kind:'steep'};
    var vx0=opt.vx==null?(spec.vx||0):opt.vx;
    st.elements.push({
      type:type,kind:opt.kind||spec.kind,role:type==='mud'?'bass':type==='opponent'?'counter':'lead',
      x:x,y:laneY(lane),lane:clamp(lane|0,0,3),w:opt.w||spec.w,h:opt.h||spec.h,
      vx:vx0,baseVx:vx0,inMud:false,used:false,hit:false,pulse:0,phase:(x*.017+lane),
      z:0,zv:0,onGround:true,tilt:0,wheelie:0,boost:0,air:0,land:0,lastSurface:null
    });
  }
  function decor(st,x,w,kind){st.decor.push({x:x,w:w,kind:kind});}
  function segment(st){
    var i=st.seg++,x=st.nextX,kind=i<2?'intro':['tabletop','opponents','mudSplit','whoopLane','doubleRamps','mixed','stadium'][i%7];
    decor(st,x,210,kind);
    if(kind==='intro'){
      add(st,'ramp',x+90,1,{kind:'single'});add(st,'opponent',x+150,2);
      add(st,'opponent',x+42,3);add(st,'ramp',x+188,0,{kind:'single'});
    }else if(kind==='tabletop'){
      add(st,'tabletop',x+54,(i+1)%4);add(st,'ramp',x+136,(i+2)%4,{kind:'steep'});add(st,'opponent',x+178,(i+3)%4);
      add(st,'opponent',x+30,i%4);add(st,'ramp',x+96,(i+3)%4,{kind:'single'});add(st,'mud',x+200,(i+1)%4);
    }else if(kind==='opponents'){
      add(st,'opponent',x+54,(i+1)%4,{vx:146});add(st,'opponent',x+104,(i+2)%4,{vx:88});add(st,'ramp',x+152,(i+3)%4);
      add(st,'opponent',x+28,i%4);add(st,'ramp',x+92,i%4,{kind:'single'});add(st,'opponent',x+188,(i+2)%4,{vx:120});
    }else if(kind==='mudSplit'){
      add(st,'mud',x+48,i%4);add(st,'mud',x+94,(i+1)%4);add(st,'tabletop',x+132,(i+2)%4);add(st,'opponent',x+190,(i+3)%4);
      add(st,'opponent',x+24,(i+2)%4);add(st,'ramp',x+72,(i+3)%4,{kind:'steep'});add(st,'mud',x+150,i%4);add(st,'whoops',x+206,(i+1)%4);
    }else if(kind==='whoopLane'){
      add(st,'whoops',x+50,1);add(st,'whoops',x+114,1);add(st,'mud',x+176,3);add(st,'opponent',x+206,0);
      add(st,'opponent',x+40,2);add(st,'mud',x+96,3);add(st,'ramp',x+150,0,{kind:'single'});add(st,'opponent',x+150,2);
    }else if(kind==='doubleRamps'){
      add(st,'ramp',x+48,0,{kind:'single'});add(st,'ramp',x+82,0,{kind:'single'});add(st,'tabletop',x+146,2);add(st,'opponent',x+202,3);
      add(st,'opponent',x+30,1);add(st,'ramp',x+118,0,{kind:'single'});add(st,'whoops',x+40,3);add(st,'mud',x+180,1);
    }else if(kind==='mixed'){
      add(st,'mud',x+46,2);add(st,'ramp',x+78,0,{kind:'steep'});add(st,'opponent',x+126,1);add(st,'whoops',x+172,3);
      add(st,'opponent',x+30,3);add(st,'ramp',x+124,2,{kind:'single'});add(st,'mud',x+180,0);add(st,'opponent',x+204,1);
    }else{
      add(st,'tabletop',x+44,3);add(st,'ramp',x+116,2);add(st,'opponent',x+164,1);add(st,'mud',x+204,0);
      add(st,'opponent',x+28,0);add(st,'ramp',x+80,1,{kind:'single'});add(st,'mud',x+150,3);add(st,'whoops',x+204,2);
    }
    st.nextX=x+220;
  }
  function ensure(st){while(st.nextX<st.worldX+(st.nativeW||D.W)+584)segment(st);}
  function sameLane(a,b){return Math.abs(a-b)<.52;}
  function rampSurface(st,x,lane){
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i];
      if((e.type!=='ramp'&&e.type!=='tabletop'&&e.type!=='whoops')||e.lane!==lane||x<e.x||x>e.x+e.w)continue;
      var p=clamp((x-e.x)/e.w,0,1),z=0,slope=0;
      if(e.type==='tabletop'){
        var edge=Math.min(.32,13/e.w);
        if(p<edge){z=-e.h*p/edge;slope=-e.h/(e.w*edge);}
        else if(p>1-edge){z=-e.h*(1-p)/edge;slope=e.h/(e.w*edge);}
        else z=-e.h;
      }else if(e.type==='whoops'){
        var wave=p*3,frac=wave-Math.floor(wave);
        if(frac<.5){z=-e.h*frac*2;slope=-e.h*6/e.w;}
        else{z=-e.h*(2-frac*2);slope=e.h*6/e.w;}
      }else{
        z=-e.h*p;slope=-e.h/e.w;
      }
      return {z:z,slope:slope,element:e};
    }
    return null;
  }
  // Highest a rider may peak without leaving the frame. Measured against where the
  // rider is actually DRAWN (the hero's eased laneY, an opponent's fixed y) as well
  // as the lane it is heading for, so a jump taken across a lane change still fits.
  function apexCap(rider,lane){
    var drawn=rider.laneY!=null?rider.laneY:(rider.y!=null?rider.y:laneY(lane));
    return Math.min(drawn,laneY(lane))-D.PHYS.apexPad;
  }
  function rideTerrain(st,rider,worldFront,lane,groundSpeed,dt){
    var surface=rampSurface(st,worldFront,lane),previous=rider.lastSurface,P=D.PHYS,speed=Math.max(40,Math.abs(groundSpeed));
    rider.land=Math.max(0,(rider.land||0)-dt*3.2);
    // 1. ON the surface: the rider is pinned to the ramp contour and pitched onto it.
    if(rider.onGround&&surface){
      rider.z=surface.z;rider.zv=surface.slope*speed;
      rider.tilt+=(clamp(Math.atan(surface.slope),-.62,.62)-rider.tilt)*Math.min(1,dt*15);
      rider.lastSurface=surface;
      surface.element.pulse=Math.max(surface.element.pulse,.45);
      return;
    }
    // 2. OFF THE LIP: super jump. The impulse scales with ramp steepness AND speed
    // (it used to be pinned to a constant -118 floor, which is why every launch was
    // an identical 9px hop), then is capped so the arc still peaks inside the frame.
    if(rider.onGround&&previous&&!surface&&previous.z<-2&&previous.slope<-.04){
      var steep=Math.min(1.7,-previous.slope);
      var v=P.launchBase+steep*speed*P.launchSlope+speed*P.launchSpeed;
      v=Math.min(v,Math.sqrt(2*P.gravity*Math.max(8,apexCap(rider,lane)+previous.z)));
      rider.onGround=false;rider.z=previous.z;rider.zv=-v;
      rider.tilt=clamp(Math.atan(previous.slope)*.85,-.55,-.12);
      rider.lastSurface=null;rider.air=0;rider.launch=v;
      rider.launchKind=previous.element.type==='ramp'?(previous.element.kind||'single'):previous.element.type;
      return;
    }
    rider.lastSurface=surface;
    if(!rider.onGround){
      rider.zv+=P.gravity*dt;rider.z+=rider.zv*dt;
      rider.air=(rider.air||0)+dt;
      // hard ceiling against the LIVE drawn lane: a lane change mid-flight can never
      // carry a bike off the top of the frame.
      var ceil=-Math.max(12,apexCap(rider,lane));
      if(rider.z<ceil){rider.z=ceil;if(rider.zv<0)rider.zv=0;}
      // 3. AIRBORNE: pitch tracks the flight path — nose up climbing, nose down falling.
      var pitch=clamp(Math.atan2(rider.zv,Math.max(70,speed*1.9))*.62,-.5,.42);
      rider.tilt+=(pitch-rider.tilt)*Math.min(1,dt*7);
      // 4. LANDING is terrain-aware: land ON whatever is underneath (table top, ramp
      // face, flat track) instead of always snapping to z=0 and sinking through it.
      var groundZ=surface?surface.z:0;
      if(rider.z>=groundZ&&rider.zv>=0){
        rider.z=groundZ;rider.zv=surface?surface.slope*speed:0;rider.onGround=true;
        rider.tilt*=.3;rider.land=Math.min(1,.35+(rider.air||0)*.7);rider.air=0;
      }
    }else{
      rider.z=0;rider.zv=0;rider.tilt*=Math.pow(.22,dt);
    }
  }
  function mudAt(st,x,lane){
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i];
      if(e.type==='mud'&&e.lane===lane&&x>e.x&&x<e.x+e.w)return e;
    }
    return null;
  }
  D.rampSurface=rampSurface;
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
      key:'racer',variant:v|0,nativeW:A&&A.h?Math.max(1,Math.round(D.H*A.w/A.h)):D.W,nativeH:D.H,t:0,seg:0,nextX:0,worldX:0,speed:124,events:[],entities:[],intent:{},music:{},
      bike:{screenX:A&&A.h?Math.min(D.VIEW_X,Math.max(18,Math.round(D.H*A.w/A.h)*.27)):D.VIEW_X,lane:1,targetLane:1,laneY:laneY(1),z:0,zv:0,onGround:true,tilt:0,heat:0,frame:0,lean:0,boost:0,wheelie:0,air:0,land:0,inMud:false,lastSurface:null},
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
    var boosting=!!I.boost&&b.heat<.9;
    // Mud (set at the end of the previous frame) has to move BOTH the target and the
    // floor of the clamp, or the clamp simply undoes the drag on the very next frame.
    var speedTarget=((118+energy*38)*bpmScale+(I.throttle?16:0)+(boosting?34:0)-(I.engineBrake?22:0))*(b.inMud?.52:1);
    st.speed+=(speedTarget-st.speed)*Math.min(1,dt*2.7);
    st.speed=clamp(st.speed,b.inMud?P.mudMin:P.runMin,P.runMax);
    st.worldX+=st.speed*dt;
    var heroWasGrounded=b.onGround;
    rideTerrain(st,b,frontX(st),b.targetLane,st.speed,dt);
    // rampJump now marks an ACTUAL launch off a lip (it used to also fire for every
    // ramp the hero merely sailed over), and the exit-speed bonus rides with it.
    if(heroWasGrounded&&!b.onGround){
      st.speed=Math.min(P.runMax,st.speed+(b.launchKind==='steep'?12:10));
      ev(st,'rampJump',{kind:b.launchKind,lane:b.targetLane,launch:Math.round(b.launch||0)});
    }
    if(!heroWasGrounded&&b.onGround)ev(st,'landing',{air:+(b.land||0).toFixed(2)});
    b.boost+=(Number(boosting)-b.boost)*Math.min(1,dt*9);
    var wheelieTarget=boosting&&b.onGround&&!b.lastSurface?1:0;
    b.wheelie+=(wheelieTarget-b.wheelie)*Math.min(1,dt*(wheelieTarget?8:5));
    b.heat=clamp(b.heat+Math.max(0,st.speed-128)*dt*.0048+(boosting?.12*dt:0)-(I.engineBrake?.34*dt:.08*dt),0,1);
    if(b.heat>.96){st.speed*=.968;b.heat=.9;ev(st,'overheat');}
    b.frame+=dt*st.speed/13;
    var fx=frontX(st),bikeLane=b.targetLane;
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i];e.x+=e.vx*dt;e.phase+=dt*(e.type==='opponent'?Math.max(7,e.vx/6):(1.5+energy*3));e.pulse=Math.max(0,e.pulse-dt*3.5);
      if(e.type==='opponent'){
        var rivalBoost=(Math.floor(e.phase*.22+e.lane)&3)===0;
        e.boost+=(Number(rivalBoost)-e.boost)*Math.min(1,dt*5);
        e.vx+=((e.baseVx||e.vx)-e.vx)*Math.min(1,dt*.6);
        var wasGrounded=e.onGround;
        rideTerrain(st,e,e.x+e.w*.72,e.lane,e.vx,dt);
        if(wasGrounded&&!e.onGround){e.vx+=6;e.pulse=Math.max(e.pulse,1);}
        e.wheelie+=(Number(rivalBoost&&e.onGround&&!e.lastSurface)-e.wheelie)*Math.min(1,dt*5);
        var ofx=e.x+e.w*.72,inMud=false;
        for(var q=0;q<st.elements.length;q++){
          var o2=st.elements[q];if(o2===e)continue;
          if(o2.type==='mud'&&o2.lane===e.lane&&ofx>o2.x&&ofx<o2.x+o2.w){inMud=true;o2.pulse=Math.max(o2.pulse,.7);}
          else if(o2.type==='opponent'&&o2.lane===e.lane&&o2.x>e.x&&o2.x-e.x<e.w*.9&&e.vx>o2.vx){e.vx=o2.vx*.92;e.pulse=Math.max(e.pulse,.8);o2.pulse=Math.max(o2.pulse,.6);}
        }
        // dark track = mud: sustained drag for as long as a wheel is in it, not a
        // one-frame nudge, so a rival visibly bogs down and claws its speed back.
        if(inMud&&e.onGround){e.vx=Math.max(42,e.vx*Math.pow(P.mudDrag,dt));if(!e.inMud)e.pulse=Math.max(e.pulse,1);}
        e.inMud=inMud&&e.onGround;
      }
      var d=e.x-fx,near=d>-8&&d<22&&sameLane(e.lane,bikeLane);
      if(!near||e.used)continue;
      if((e.type==='ramp'||e.type==='tabletop'||e.type==='whoops')&&b.z<-2){
        e.used=true;e.pulse=1;
      }else if(e.type==='opponent'&&b.z>-13){
        e.used=true;e.pulse=1;st.speed*=.8;b.tilt=.5;e.vx*=.86;ev(st,'overtakeBump');
      }
    }
    // Hero mud: the dark patches now drag continuously while a wheel is in them and
    // release when the bike clears them (or jumps them), instead of a single tap.
    var mudE=b.onGround&&b.z>-6?mudAt(st,fx,bikeLane):null;
    if(mudE){
      mudE.pulse=Math.max(mudE.pulse,.85);
      st.speed=Math.max(P.mudMin,st.speed*Math.pow(P.mudDrag,dt));
      b.tilt+=(.17-b.tilt)*Math.min(1,dt*9);
      b.heat=Math.max(0,b.heat-.22*dt);
      if(!b.inMud){b.inMud=true;ev(st,'mudHit',{lane:bikeLane});}
    }else b.inMud=false;
    st.elements=st.elements.filter(function(e){return e.x>st.worldX-110&&e.x<st.worldX+st.nativeW+724;});
    st.decor=st.decor.filter(function(d){return d.x+d.w>st.worldX-90&&d.x<st.worldX+st.nativeW+724;});
    ensure(st);
    if(st.worldX>3200+st.nativeW){
      st.worldX-=2600;st.nextX-=2600;
      for(i=0;i<st.elements.length;i++)st.elements[i].x-=2600;
      for(i=0;i<st.decor.length;i++)st.decor[i].x-=2600;
      ev(st,'lapComplete');
    }
    sync(st);
  };
  VisualizerGame.layer('racer','definition',{
    packVersion:2,key:'racer',name:'Racer-style motocross',family:'lane motocross racer',
    entities:['riderMotorbike','opponentMotorbike','slopeRamp','tabletopRamp','whoops','mudPatch','trackLane','stadiumCrowd','heatMeter'],
    rules:['four continuous lane movement','every bike is pinned to the ramp contour it is riding and pitches onto the slope','ramp lips fling every bike into a super jump whose height and airtime scale with speed and ramp steepness','jump apex is capped per lane so a launch always peaks inside the frame','landing resolves onto whatever surface is underneath, never through it','boost-driven wheelies','single/steep slope ramps, tabletops, and whoops each behave differently','dark mud patches drag any bike in them until it clears or jumps them','opponent bike avoidance','engine heat buildup','lap loop','fixed side camera with scrolling track'],
    events:['rampJump','landing','mudHit','overtakeBump','overheat','lapComplete'],
    watchdog:{mode:'scroll',progress:24,motion:10},performance:{maxEntities:120,maxParticles:44},update:D.update
  });
  if(typeof window!=='undefined')window.RacerDefinition=D;else this.RacerDefinition=D;
})();
