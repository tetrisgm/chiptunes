// METROID definition: bounded alien rooms, shoot-to-open hatches, morph tunnels, vertical shafts, and beams.
(function(){
  var D={W:256,H:224,TILE:16,STAND_W:14,STAND_H:28,MORPH_H:14,ROOM_W:512,ROOM_H:224,VERT_H:432,PHYS:{run:92,accel:720,friction:760,gravity:1040,jump:334,fallMax:420}};
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function hit(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
  function center(e){return {x:e.x+e.w*.5,y:e.y+e.h*.5};}
  function ev(st,t,d){if(st.events.length<48)st.events.push({type:t,detail:d||null});}
  function opp(s){return s==='right'?'left':s==='left'?'right':s==='top'?'bottom':'top';}
  function rect(st,room,x,y,w,h,k){
    st.solids.push({room:room.id,x:x,y:y,w:w,h:h,kind:k||'rock',role:k==='platform'?'counter':'bass'});
  }
  function roomById(st,id){
    for(var i=0;i<st.rooms.length;i++)if(st.rooms[i].id===id)return st.rooms[i];
    return st.rooms[0]||null;
  }
  function currentRoom(st){return roomById(st,st.currentRoom);}
  function doorById(st,id){
    for(var i=0;i<st.doors.length;i++)if(st.doors[i].id===id)return st.doors[i];
    return null;
  }
  function roomDoor(st,room,entry){
    for(var i=0;i<st.doors.length;i++){
      var d=st.doors[i];
      if(d.room===room.id&&!!d.entry===!!entry)return d;
    }
    return null;
  }
  function doorCenter(d){return {x:d.x+d.w*.5,y:d.y+d.h*.5};}
  function addRoom(st,x,y,w,h,kind,entrySide,exitSide){
    var r={id:st.nextRoomId++,x:x,y:y,w:w,h:h,kind:kind,entrySide:entrySide||'left',exitSide:exitSide||'right',floorY:y+h-36,route:[],role:'world'};
    st.rooms.push(r);
    return r;
  }
  function addDoorFrames(st,room,d){
    var top=room.y+16,bottom=room.y+room.h-12;
    if(d.side==='right'||d.side==='left'){
      rect(st,room,d.x,room.y,16,Math.max(0,d.y-room.y),'wall');
      rect(st,room,d.x,d.y+d.h,16,Math.max(0,room.y+room.h-(d.y+d.h)),'wall');
      rect(st,room,d.x-36,d.y+d.h-3,42,8,'platform');
    }else if(d.side==='top'){
      rect(st,room,room.x,room.y,Math.max(0,d.x-room.x),16,'wall');
      rect(st,room,d.x+d.w,room.y,Math.max(0,room.x+room.w-(d.x+d.w)),16,'wall');
      rect(st,room,d.x-24,d.y+d.h+30,96,8,'platform');
      rect(st,room,room.x,top,10,bottom-top,'wall');
      rect(st,room,room.x+room.w-10,top,bottom-top>0?10:0,bottom-top,'wall');
    }else{
      rect(st,room,room.x,room.y+room.h-16,Math.max(0,d.x-room.x),16,'wall');
      rect(st,room,d.x+d.w,room.y+room.h-16,Math.max(0,room.x+room.w-(d.x+d.w)),16,'wall');
      rect(st,room,d.x-24,d.y-40,96,8,'platform');
      rect(st,room,room.x,top,10,bottom-top,'wall');
      rect(st,room,room.x+room.w-10,top,10,bottom-top,'wall');
    }
  }
  function addDoor(st,room,side,target,entry,open){
    var x=room.x,y=room.y,w=16,h=48;
    if(side==='right'||side==='left'){
      x=side==='right'?room.x+room.w-16:room.x;
      y=clamp(room.floorY-48,room.y+40,room.y+room.h-64);
    }else{
      w=48;h=16;
      x=clamp(room.x+room.w*.5-24,room.x+42,room.x+room.w-90);
      y=side==='top'?room.y:room.y+room.h-16;
    }
    var d={id:st.nextDoorId++,room:room.id,target:target,side:side,x:x,y:y,w:w,h:h,open:!!open,entry:!!entry,pulse:0,role:'world'};
    st.doors.push(d);
    addDoorFrames(st,room,d);
    if(entry)room.entryDoorId=d.id;else room.exitDoorId=d.id;
    return d;
  }
  function enemy(st,room,type,x,y){
    if(st.enemies.length>=48)return;
    var size=type==='ripper'?{w:20,h:10,vx:-24,hp:2}:type==='skree'?{w:13,h:14,vx:0,hp:1}:type==='waver'?{w:16,h:12,vx:-20,hp:2}:{w:14,h:12,vx:-18,hp:1};
    st.enemies.push({room:room.id,type:type,role:type==='ripper'?'counter':'perc',x:x,y:y,w:size.w,h:size.h,vx:size.vx,vy:0,hp:size.hp,alive:true,phase:x*.037,pulse:0});
  }
  function orb(st,room,x,y){
    if(st.pickups.length<48)st.pickups.push({room:room.id,type:'orb',role:'lead',x:x,y:y,w:8,h:8,got:false,pulse:0});
  }
  function rewardLedge(st,room,x,y){
    rect(st,room,x,y,52,8,'platform');
    orb(st,room,x+22,y-24);
  }
  function waypoint(room,x,y,action){
    room.route.push({x:x,y:y,action:action||'move'});
  }
  function addHorizontalRoom(st,r,seed){
    var floor=r.floorY,kind=r.kind;
    rect(st,r,r.x,floor,r.w,48,'floor');
    rect(st,r,r.x,r.y,r.w,16,'ceiling');
    waypoint(r,r.x+38,floor-D.STAND_H,'move');
    if(kind==='morph'){
      var mx=r.x+196;
      rect(st,r,mx,floor-92,26,60,'wall');
      rect(st,r,mx+26,floor-32,126,16,'tunnelRoof');
      rect(st,r,mx+152,floor-92,24,60,'wall');
      waypoint(r,mx-28,floor-D.STAND_H,'morph');
      waypoint(r,mx+88,floor-D.MORPH_H,'morph');
      waypoint(r,mx+184,floor-D.STAND_H,'unmorph');
      rect(st,r,r.x+74,floor-54,58,8,'platform');
      rect(st,r,r.x+360,floor-72,62,8,'platform');
      enemy(st,r,'zoomer',r.x+92,floor-12);
      enemy(st,r,'ripper',r.x+358,floor-88);
      orb(st,r,mx+74,floor-44);
      rewardLedge(st,r,r.x+412,floor-116);
    }else if(kind==='platformHall'){
      rect(st,r,r.x+92,floor-44,62,8,'platform');
      rect(st,r,r.x+182,floor-76,62,8,'platform');
      rect(st,r,r.x+282,floor-54,76,8,'platform');
      waypoint(r,r.x+122,floor-44-D.STAND_H,'jump');
      waypoint(r,r.x+212,floor-76-D.STAND_H,'jump');
      waypoint(r,r.x+324,floor-54-D.STAND_H,'jump');
      enemy(st,r,'ripper',r.x+176,floor-96);
      enemy(st,r,'skree',r.x+316,floor-102);
      orb(st,r,r.x+206,floor-94);
      rewardLedge(st,r,r.x+382,floor-104);
    }else if(kind==='enemyHall'){
      rect(st,r,r.x+118,floor-38,54,8,'platform');
      rect(st,r,r.x+292,floor-60,58,8,'platform');
      rewardLedge(st,r,r.x+394,floor-98);
      enemy(st,r,'zoomer',r.x+126,floor-12);
      enemy(st,r,'waver',r.x+250,floor-70);
      enemy(st,r,'ripper',r.x+358,floor-86);
      orb(st,r,r.x+314,floor-78);
    }else{
      rect(st,r,r.x+96,floor-46,54,8,'platform');
      rect(st,r,r.x+226,floor-70,64,8,'platform');
      rect(st,r,r.x+352,floor-40,54,8,'platform');
      rewardLedge(st,r,r.x+404,floor-92);
      enemy(st,r,'zoomer',r.x+118,floor-12);
      enemy(st,r,'ripper',r.x+240,floor-88);
      orb(st,r,r.x+250,floor-88);
    }
  }
  function addVerticalRoom(st,r,seed){
    var bottom=r.y+r.h-36,goingUp=r.exitSide==='top'||r.entrySide==='bottom';
    rect(st,r,r.x,bottom,r.w,48,'floor');
    rect(st,r,r.x,r.y,r.w,16,'ceiling');
    var xs=[r.x+54,r.x+108,r.x+64,r.x+118,r.x+54,r.x+104,r.x+78],pw=100;
    var levels=[];
    for(var i=0;i<7;i++)levels.push(bottom-48-i*38);
    if(goingUp){
      waypoint(r,r.x+48,bottom-D.STAND_H,'move');
      for(i=0;i<levels.length;i++){
        var px=xs[i%xs.length],py=levels[i];
        rect(st,r,px,py,pw,8,'platform');
        waypoint(r,px+pw*.5,py-D.STAND_H,'jump');
        if(i%2===1)orb(st,r,px+44,py-22);
        if(i===3)rewardLedge(st,r,r.x+24,py-28);
      }
      enemy(st,r,'ripper',r.x+126,bottom-116);
      enemy(st,r,'skree',r.x+82,bottom-238);
      waypoint(r,r.x+r.w*.5,Math.max(r.y+42,levels[levels.length-1]-D.STAND_H),'move');
    }else{
      var topY=r.y+48;
      waypoint(r,r.x+r.w*.5,topY,'move');
      for(i=levels.length-1;i>=0;i--){
        px=xs[i%xs.length];py=levels[i];
        rect(st,r,px,py,pw,8,'platform');
        waypoint(r,px+pw*.5,py-D.STAND_H,'drop');
        if(i%2===0)orb(st,r,px+18,py-24);
        if(i===4)rewardLedge(st,r,r.x+r.w-86,py-26);
      }
      enemy(st,r,'waver',r.x+152,r.y+128);
      enemy(st,r,'zoomer',r.x+76,bottom-12);
      waypoint(r,r.x+r.w*.5,bottom-D.STAND_H,'drop');
    }
  }
  function addMorphDropRoom(st,r){
    var floor=r.floorY,mx=r.x+92;
    rect(st,r,r.x,floor,r.w,48,'floor');
    rect(st,r,r.x,r.y,r.w,16,'ceiling');
    rect(st,r,mx,floor-100,26,68,'wall');
    rect(st,r,mx+26,floor-32,128,16,'tunnelRoof');
    rect(st,r,mx+154,floor-100,24,68,'wall');
    rect(st,r,r.x+236,floor-54,74,8,'platform');
    waypoint(r,r.x+42,floor-D.STAND_H,'morph');
    waypoint(r,mx+82,floor-D.MORPH_H,'morph');
    waypoint(r,mx+196,floor-D.STAND_H,'unmorph');
    waypoint(r,r.x+272,floor-54-D.STAND_H,'jump');
    enemy(st,r,'ripper',r.x+270,floor-72);
    orb(st,r,mx+70,floor-44);
  }
  function content(st,r,seed){
    if(r.kind==='shaftUp'||r.kind==='shaftDown')addVerticalRoom(st,r,seed);
    else if(r.kind==='morphDrop')addMorphDropRoom(st,r);
    else addHorizontalRoom(st,r,seed);
  }
  function chooseExit(st,idx,entry){
    var seq=['right','right','top','right','bottom','right','right','top','right','bottom','right'];
    var side=seq[(idx+(st.variant||0)*3)%seq.length];
    if(entry==='top'&&side==='bottom')side='right';
    if(entry==='bottom'&&side==='top')side='right';
    if(idx>0&&idx%5===0)side='right';
    return side;
  }
  function kindFor(idx,entry,exit,variant){
    if(exit==='top'||entry==='bottom')return 'shaftUp';
    if(exit==='bottom'||entry==='top')return 'shaftDown';
    var kinds=['corridor','platformHall','morph','enemyHall','morphDrop'];
    return kinds[(idx*2+(variant||0)*2)%kinds.length];
  }
  function segmentPosition(prev,w,h){
    if(!prev)return {x:0,y:0};
    if(prev.exitSide==='right')return {x:prev.x+prev.w,y:prev.y+prev.h-h};
    if(prev.exitSide==='top')return {x:prev.x,y:prev.y-h};
    return {x:prev.x,y:prev.y+prev.h};
  }
  function addSegment(st){
    var idx=st.rooms.length,prev=idx?st.rooms[idx-1]:null,entry=prev?opp(prev.exitSide):'left',exit=chooseExit(st,idx,entry);
    var tall=exit==='top'||exit==='bottom'||entry==='top'||entry==='bottom';
    var w=tall?D.W:D.ROOM_W,h=tall?D.VERT_H:D.ROOM_H;
    var pos=segmentPosition(prev,w,h),kind=idx===0?'corridor':kindFor(idx,entry,exit,st.variant);
    var r=addRoom(st,pos.x,pos.y,w,h,kind,entry,exit);
    content(st,r,idx);
    if(prev){
      var d=addDoor(st,prev,prev.exitSide,r.id,false,false);
      addDoor(st,r,entry,prev.id,true,true);
      var p=doorCenter(d);
      prev.route.push({x:p.x,y:p.y-D.STAND_H*.5,action:'door',doorId:d.id});
    }
    return r;
  }
  function ensureFuture(st){
    while(st.rooms.length<st.currentRoom+8&&st.rooms.length<96)addSegment(st);
  }
  function floorAt(st,x,y,roomId){
    var best=Infinity;
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];
      if((roomId==null||s.room===roomId)&&(s.kind==='floor'||s.kind==='platform')&&x>=s.x&&x<=s.x+s.w&&s.y>=y-4&&s.y<best)best=s.y;
    }
    return best<Infinity?best:D.H+999;
  }
  function isClosedDoor(o){return o&&!o.open;}
  function closedDoorAt(st,ent){
    for(var i=0;i<st.doors.length;i++){var d=st.doors[i];if(isClosedDoor(d)&&hit(ent,d))return d;}
    return null;
  }
  function headBlocked(st,h,newH){
    var test={x:h.x+1,y:h.y-(newH-h.h),w:h.w-2,h:newH};
    for(var i=0;i<st.solids.length;i++)if(blocksVertical(test,st.solids[i],-1,h.y)&&hit(test,st.solids[i]))return true;
    return !!closedDoorAt(st,test);
  }
  function setMorph(st,want){
    var h=st.hero;
    if(want&&!h.morph){
      h.y+=h.h-D.MORPH_H; h.h=D.MORPH_H; h.morph=true; ev(st,'morphStarted');
    }else if(!want&&h.morph&&!headBlocked(st,h,D.STAND_H)){
      h.y-=D.STAND_H-h.h; h.h=D.STAND_H; h.morph=false; ev(st,'morphEnded');
    }
  }
  function blocksVertical(e,s,dy,prevY){
    if(s.kind==='platform'){
      if(e.dropThrough)return false;
      if(dy<=0)return false;
      if(prevY+e.h>s.y+3)return false;
    }
    return true;
  }
  function moveX(st,e,dx){
    if(!dx)return;
    e.x+=dx;
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];if(s.kind==='platform'||!hit(e,s))continue;
      if(dx>0){e.x=s.x-e.w;e.vx=0;}else{e.x=s.x+s.w;e.vx=0;}
    }
    var d=closedDoorAt(st,e);
    if(d){if(dx>0){e.x=d.x-e.w;e.vx=0;}else{e.x=d.x+d.w;e.vx=0;}}
  }
  function moveY(st,e,dy){
    if(!dy)return;
    var prevY=e.y;e.y+=dy;e.onGround=false;
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];if(!hit(e,s)||!blocksVertical(e,s,dy,prevY))continue;
      if(dy>0){e.y=s.y-e.h;e.vy=0;e.onGround=true;}
      else if(dy<0){e.y=s.y+s.h;e.vy=0;}
    }
    var d=closedDoorAt(st,e);
    if(d){
      if(dy>0){e.y=d.y-e.h;e.vy=0;e.onGround=true;}
      else if(dy<0){e.y=d.y+d.h;e.vy=0;}
    }
  }
  function routePoint(st){
    var r=currentRoom(st);if(!r)return null;
    var idx=st.routeIndex[r.id]||0,h=st.hero;
    while(idx<r.route.length){
      var wp=r.route[idx],dx=(h.x+h.w*.5)-wp.x,dy=(h.y+h.h*.5)-wp.y;
      var d=wp.doorId?doorById(st,wp.doorId):null;
      if(wp.action==='door'&&d&&!d.open)break;
      if(Math.abs(dx)<18&&Math.abs(dy)<26)idx++;
      else break;
    }
    if(idx>=r.route.length)idx=r.route.length-1;
    st.routeIndex[r.id]=Math.max(0,idx);
    return r.route[st.routeIndex[r.id]]||null;
  }
  function lowCeilingAhead(st,h,roomId){
    var dir=h.dir||1;
    var probe={x:h.x+(dir>0?h.w: -28),y:h.y+4,w:34,h:D.STAND_H-8};
    for(var i=0;i<st.solids.length;i++){
      var s=st.solids[i];if(s.room!==roomId)continue;
      if(s.kind==='tunnelRoof'&&hit(probe,s))return true;
    }
    return false;
  }
  function enemyAhead(st,h,roomId){
    var hx=h.x+h.w*.5,hy=h.y+h.h*.5,best=null,bestD=999;
    for(var i=0;i<st.enemies.length;i++){
      var e=st.enemies[i];if(!e.alive||e.room!==roomId)continue;
      var ex=e.x+e.w*.5,ey=e.y+e.h*.5,dx=ex-hx,dy=ey-hy,ad=Math.abs(dx);
      var inHorizontalLane=Math.abs(dy)<18&&ad<138;
      var aboveThreat=dy<-18&&Math.abs(dx)<42&&Math.abs(dy)<116;
      var nearThreat=ad<44&&Math.abs(dy)<52;
      if(inHorizontalLane||aboveThreat||nearThreat){
        var score=ad+Math.abs(dy)*.7;
        if(score<bestD){best=e;bestD=score;}
      }
    }
    return best;
  }
  function doorInBeamLane(h,d){
    if(!d||d.open)return false;
    var hx=h.x+h.w*.5,hy=h.y+h.h*.5,dc=doorCenter(d),dx=dc.x-hx,dy=dc.y-hy;
    if(d.side==='left'||d.side==='right')return Math.abs(dy)<36&&Math.abs(dx)<112;
    return Math.abs(dx)<42&&Math.abs(dy)<128;
  }
  function clampCamera(st,snap){
    var r=currentRoom(st);if(!r)return;
    var targetX=clamp(st.hero.x-92,r.x,r.x+Math.max(0,r.w-D.W));
    var targetY=clamp(st.hero.y-106,r.y,r.y+Math.max(0,r.h-D.H));
    if(snap){st.cameraX=targetX;st.cameraY=targetY;return;}
    var k=.22;
    st.cameraX+=clamp(targetX-st.cameraX,-18,18)*k;
    st.cameraY+=clamp(targetY-st.cameraY,-18,18)*k;
    st.cameraX=clamp(st.cameraX,r.x,r.x+Math.max(0,r.w-D.W));
    st.cameraY=clamp(st.cameraY,r.y,r.y+Math.max(0,r.h-D.H));
  }
  function spawnInRoom(st,r,entrySide){
    var h=st.hero;
    if(entrySide==='left'){h.x=r.x+28;h.y=r.floorY-h.h;h.dir=1;}
    else if(entrySide==='right'){h.x=r.x+r.w-44;h.y=r.floorY-h.h;h.dir=-1;}
    else if(entrySide==='top'){h.x=r.x+r.w*.5-h.w*.5;h.y=r.y+50;h.dir=1;}
    else {h.x=r.x+r.w*.5-h.w*.5;h.y=r.y+r.h-64-h.h;h.dir=1;}
    h.vx=h.vy=0;
    h.onGround=false;
  }
  function transitionIfNeeded(st){
    var r=currentRoom(st),h=st.hero;if(!r)return;
    var d=roomDoor(st,r,false);if(!d||!d.open)return;
    var pass=false;
    if(d.side==='right')pass=h.x+h.w>d.x+d.w-6||hit(h,d);
    else if(d.side==='left')pass=h.x<d.x+6||hit(h,d);
    else if(d.side==='top')pass=hit(h,d)||(h.y<d.y+d.h+74&&Math.abs((h.x+h.w*.5)-(d.x+d.w*.5))<54);
    else pass=hit(h,d)||(h.y+h.h>d.y-74&&Math.abs((h.x+h.w*.5)-(d.x+d.w*.5))<54);
    if(!pass)return;
    ensureFuture(st);
    var target=roomById(st,d.target);if(!target)return;
    st.currentRoom=target.id;
    st.routeIndex[target.id]=0;
    setMorph(st,false);
    spawnInRoom(st,target,opp(d.side));
    clampCamera(st,true);
    ev(st,'roomEntered',{room:target.id,side:opp(d.side)});
  }
  function sync(st){
    st.entities.length=0;
    st.entities.push({type:'samus',role:'world'},{type:'morphBall',role:'world'},{type:'energyOrb',role:'lead'},{type:'alien',role:'counter'},{type:'beam',role:'perc'},{type:'cavern',role:'bass'},{type:'hatchDoor',role:'world'},{type:'caveDust',role:'noise'},{type:'screenFlash',role:'drop'});
  }
  D.lookAhead=function(st){
    var h=st.hero,r=currentRoom(st),wp=routePoint(st),o={gap:false,enemy:false,shootEnemy:false,shootDoor:false,door:false,doorOpen:false,doorDist:Infinity,doorSide:'right',tunnel:false,ledge:false,nav:wp,room:r};
    if(!r)return o;
    var d=roomDoor(st,r,false),cp=center(h);
    if(d){
      var dc=doorCenter(d);
      o.door=!d.open;o.doorOpen=!!d.open;o.doorSide=d.side;o.doorDist=Math.sqrt(Math.pow(dc.x-cp.x,2)+Math.pow(dc.y-cp.y,2));
      o.shootDoor=doorInBeamLane(h,d);
    }
    var e=enemyAhead(st,h,r.id);
    o.enemy=!!e;o.shootEnemy=!!e;o.enemyTarget=e||null;
    o.tunnel=lowCeilingAhead(st,h,r.id)||(wp&&(wp.action==='morph'||wp.action==='unmorph'));
    o.gap=floorAt(st,h.x+(h.dir>0?44:-20),h.y+h.h+3,r.id)>h.y+h.h+58;
    if(wp&&wp.y<h.y-12)o.ledge=true;
    return o;
  };
  D.make=function(A,U,v){
    var st={key:'metroid',variant:v|0,nativeW:D.W,nativeH:D.H,t:0,currentRoom:0,nextRoomId:0,nextDoorId:0,cameraX:0,cameraY:0,rooms:[],routeIndex:{},
      hero:{x:30,y:0,w:D.STAND_W,h:D.STAND_H,vx:0,vy:0,dir:1,onGround:false,morph:false,run:0,shootCd:0},
      solids:[],doors:[],enemies:[],shots:[],pickups:[],events:[],entities:[],intent:{},music:{}};
    for(var i=0;i<8;i++)addSegment(st);
    spawnInRoom(st,st.rooms[0],'left');
    clampCamera(st,true);
    return st;
  };
  D.update=function(ctx){
    var st=ctx.state,dt=Math.min(ctx.dt||.016,.04),h=st.hero,P=D.PHYS,m=st.music||{};
    st.t+=dt;st.events.length=0;ensureFuture(st);if(ctx.audio&&ctx.audio.paused){sync(st);return;}
    var I=st.intent||{},dir=(I.right?1:0)-(I.left?1:0),bias=clamp(I.speedBias||1,.82,1.3);
    h.dropThrough=!!I.drop;
    setMorph(st,!!I.down||!!I.morph);
    if(dir){h.vx+=dir*P.accel*dt;h.dir=dir;}else if(h.vx>0)h.vx=Math.max(0,h.vx-P.friction*dt);else h.vx=Math.min(0,h.vx+P.friction*dt);
    h.vx=clamp(h.vx,-P.run*bias,P.run*bias);
    if(I.jump&&h.onGround&&!h.morph){h.vy=-P.jump*(I.jumpHigh?1.06:1);h.onGround=false;ev(st,'jumpStarted');}
    h.vy=clamp(h.vy+P.gravity*dt,-430,P.fallMax);
    moveX(st,h,h.vx*dt);moveY(st,h,h.vy*dt);
    if(h.onGround)h.run+=Math.abs(h.vx)*dt/13;
    h.shootCd=Math.max(0,h.shootCd-dt);
    if(I.shoot&&!h.morph&&h.shootCd<=0&&st.shots.length<10){
      var aim=I.aim||'right',vx=0,vy=0,w=6,hh=6,sx=h.x+(h.dir>0?h.w:0),sy=h.y+10;
      if(aim==='up'){vy=-172;sx=h.x+h.w*.5-3;sy=h.y-6;}
      else if(aim==='down'){vy=172;sx=h.x+h.w*.5-3;sy=h.y+h.h;}
      else {vx=(aim==='left'?-1:1)*172;h.dir=aim==='left'?-1:1;sx=h.x+(h.dir>0?h.w:-w);}
      h.shootCd=Math.max(.15,(m.spb||.42)*.42);
      st.shots.push({x:sx,y:sy,w:w,h:hh,vx:vx,vy:vy,life:Math.max(.62,(m.spb||.42)*1.9),role:'perc'});
      ev(st,'beamFired');
    }
    for(var si=st.shots.length-1;si>=0;si--){
      var sh=st.shots[si];sh.x+=sh.vx*dt;sh.y+=sh.vy*dt;sh.life-=dt;
      for(var di=0;di<st.doors.length;di++){var dr=st.doors[di];if(!dr.open&&hit(sh,dr)){dr.open=true;dr.pulse=1;sh.life=0;ev(st,'doorOpened',{side:dr.side});break;}}
      if(sh.life>0)for(var ei=0;ei<st.enemies.length;ei++){var e=st.enemies[ei];if(e.alive&&hit(sh,e)){e.hp--;e.pulse=1;sh.life=0;ev(st,'enemyHit');if(e.hp<=0){e.alive=false;ev(st,'enemyDestroyed');}break;}}
      if(sh.life<=0||sh.x<st.cameraX-50||sh.x>st.cameraX+D.W+90||sh.y<st.cameraY-50||sh.y>st.cameraY+D.H+90)st.shots.splice(si,1);
    }
    var r=currentRoom(st);
    for(ei=0;ei<st.enemies.length;ei++){
      e=st.enemies[ei];if(!e.alive||!r||e.room!==r.id)continue;e.phase+=dt*(2.4+(m.energy||0)*3.2);e.pulse=Math.max(0,e.pulse-dt*4);
      if(e.type==='ripper')e.x+=Math.sin(e.phase)*18*dt;
      else if(e.type==='skree'){if(Math.abs(e.x-h.x)<76)e.vy=Math.min(118,e.vy+250*dt);e.y+=e.vy*dt;}
      else if(e.type==='waver'){e.x+=e.vx*dt;e.y+=Math.sin(e.phase)*30*dt;}
      else e.x+=Math.sin(e.phase)*12*dt;
      if(hit(h,e))ev(st,'nearMiss');
    }
    for(var pi=0;pi<st.pickups.length;pi++){var p=st.pickups[pi];p.pulse=Math.max(0,p.pulse-dt*3);if(!p.got&&hit(h,p)){p.got=true;ev(st,'pickupCollected');}}
    for(di=0;di<st.doors.length;di++)st.doors[di].pulse=Math.max(0,(st.doors[di].pulse||0)-dt*3.4);
    transitionIfNeeded(st);
    r=currentRoom(st);
    if(r&&h.y>r.y+r.h+80){spawnInRoom(st,r,r.entrySide||'left');}
    clampCamera(st,false);
    sync(st);
  };
  VisualizerGame.layer('metroid','definition',{packVersion:3,key:'metroid',name:'Metroid-style alien exploration platformer',family:'exploration platformer',entities:['armoredHunter','morphBall','beamShot','crawler','ripper','skree','waver','energyOrb','platform','hatchDoor','alienCavern'],rules:['bounded rooms','camera clamps to room until hatch transition','continuous run','grounded jump','one-way platforms','morph ball tunnel traversal','beam firing','shoot-to-open doors','enemy damage','pickup collection','vertical shaft traversal','pitless room generation'],events:['jumpStarted','morphStarted','morphEnded','beamFired','doorOpened','roomEntered','enemyHit','enemyDestroyed','pickupCollected','nearMiss'],performance:{maxEntities:140,maxParticles:32},update:D.update});
  if(typeof window!=='undefined')window.MetroidDefinition=D;else this.MetroidDefinition=D;
})();
