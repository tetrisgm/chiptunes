// METROID renderer: NES-scale armored hunter, bounded hatches, vertical rooms, morph ball, caverns, and ledges.
(function(){
  function rr(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));}
  function hr(c,h){return typeof hueRot==='function'?hueRot(c,h||0):c;}
  function px(rows,map,x,y,s,flip){
    var w=0;for(var r=0;r<rows.length;r++)if(rows[r].length>w)w=rows[r].length;
    g.save();if(flip){g.translate(x+w*s,y);g.scale(-1,1);x=0;y=0;}
    for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++){var c=map[rows[j][i]];if(c)rr(x+i*s,y+j*s,s,s,c);}
    g.restore();
  }
  var SAM1=[
    '.....oooo.....',
    '....oooooo....',
    '...ooorrrv....',
    '..ooorrrvv....',
    '..oorrrrv.....',
    '...rrrrr......',
    '..rrYYYYrCC...',
    '.rrrYYYYrCCC..',
    '.rrYYYYrrCC...',
    '..rYYYYYr.....',
    '.bbYYYYbb.....',
    '..bYYYYb......',
    '.bbY..Ybb.....',
    '..bb..bb......',
    '.ss....ss.....'
  ];
  var SAM2=[
    '.....oooo.....',
    '....oooooo....',
    '...ooorrrv....',
    '..ooorrrvv....',
    '..oorrrrv.....',
    '...rrrrr......',
    '..rrYYYYrCC...',
    '.rrrYYYYrCCC..',
    '.rrYYYYrrCC...',
    '..rYYYYYr.....',
    '..bYYYYbb.....',
    '.bbYYYYb......',
    'bb.Y..Ybb.....',
    's.....bb......',
    'ss.....ss.....'
  ];
  var SAMJ=[
    '....oooo......',
    '...oorrrv.....',
    '..oorrrvv.....',
    '.rrYYYYrCC....',
    'rrrYYYYrCCC...',
    '..rYYYYrrCC...',
    '.bbYYYYbb.....',
    'bb.Y..Y.bb....',
    's........s....'
  ];
  var BALL=['..oooo..','.oorroo.','oorrYYoo','orrYYYYo','orrYYYYo','oorrYYoo','.oorroo.','..oooo..'];
  var CRAWL=['..gggg..','.gkkkkg.','gggkkggg','.gggggg.','g.g..g.g'];
  var RIP=['.mmmmmm.','mmwwwwmm','.mmkkmm.','..mmmm..'];
  var SKREE=['..pp..','.pwwp.','ppkkpp','.pppp.','..pp..'];
  var WAVER=['..a..a..','.aaaaa.','aawwwaa','.aakaa.','..a.a..'];
  var ORB=['.cc.','cwwc','cwwc','.cc.'];
  var BEAM=['.yy.','ywwy','ywwy','.yy.'];
  var MAP={o:'#e07824',r:'#d03818',v:'#46f060',Y:'#f0b030',b:'#2460c8',C:'#f2d080',s:'#141020',w:'#f8e080',k:'#080808',g:'#58d060',m:'#c8c8d8',p:'#b454d8',a:'#5ad0f0',c:'#58f0f0'};
  function drawTile(tx,y,w,h,kind,hue){
    var base=kind==='floor'?'#4a295e':kind==='platform'?'#633476':kind==='tunnelRoof'?'#55306a':kind==='ceiling'?'#3b2353':'#39204d';
    rr(tx,y,w,h,hr(base,hue));
    rr(tx,y,w,3,hr(kind==='floor'?'#a767b7':'#d080d8',hue));
    rr(tx+2,y+6,Math.max(1,w-4),2,'rgba(0,0,0,.34)');
    if(h>18)rr(tx+3,y+15,Math.max(1,w-6),2,'rgba(255,255,255,.07)');
    rr(tx+Math.max(0,w-2),y,2,h,'rgba(0,0,0,.28)');
  }
  function doorCore(open,p,hue){
    if(g.beginPath&&g.ellipse){
      g.beginPath();g.ellipse(0,0,13+p*3,28+p*4,0,0,Math.PI*2);g.fillStyle=hr(open?'#16384c':'#2180c8',hue);g.fill();
      g.beginPath();g.ellipse(0,0,8+p*2,21+p*3,0,0,Math.PI*2);g.fillStyle=open?'#050716':hr('#58f0f0',hue);g.fill();
    }else{
      rr(-8,-24,16,48,hr(open?'#16384c':'#2180c8',hue));
      rr(-4,-18,8,36,open?'#050716':hr('#58f0f0',hue));
    }
    rr(-11,-20,3,40,'rgba(255,255,255,.3)');
    rr(8,-20,3,40,'rgba(0,0,0,.35)');
  }
  function drawDoor(d,camX,camY,hue){
    var x=d.x-camX,y=d.y-camY,p=d.pulse||0,cx=x+d.w/2,cy=y+d.h/2;
    g.save();g.globalAlpha=.98;g.translate(cx,cy);
    if(d.side==='top'||d.side==='bottom')g.rotate(Math.PI/2);
    doorCore(!!d.open,p,hue);
    g.restore();
  }
  function drawRooms(st,camX,camY,hue){
    for(var i=0;i<st.rooms.length;i++){
      var r=st.rooms[i],x=r.x-camX,y=r.y-camY;
      if(x+r.w<-20||x>276||y+r.h<-20||y>244)continue;
      rr(x,y,r.w,r.h,hr(r.kind==='shaftUp'||r.kind==='shaftDown'?'#080616':'#090716',hue));
      for(var yy=Math.floor((r.y+18)/18)*18;yy<r.y+r.h;yy+=18)rr(x,yy-camY,r.w,1,'rgba(116,74,142,.12)');
      rr(x,y,3,r.h,hr('#4b2b63',hue));
      rr(x+r.w-3,y,3,r.h,hr('#4b2b63',hue));
      rr(x,y,r.w,3,hr('#4b2b63',hue));
      rr(x,y+r.h-3,r.w,3,hr('#4b2b63',hue));
    }
  }
  function render(ctx){
    var st=ctx.state,A=ctx.A,m=st.music||{},sc=Math.min(A.w/st.nativeW,A.h/st.nativeH),ox=A.x+(A.w-st.nativeW*sc)/2,oy=A.y+(A.h-st.nativeH*sc)/2,hue=(m.hue||0)*.22,camX=st.cameraX||0,camY=st.cameraY||0;
    g.save();g.translate(ox,oy);g.scale(sc,sc);g.beginPath();g.rect(0,0,256,224);g.clip();
    rr(0,0,256,224,hr('#070512',hue));
    drawRooms(st,camX,camY,hue);
    for(var i=0;i<28;i++){
      var sx=((i*31-camX*.12)%280)-20,sy=((i*37-camY*.08)%230);
      rr(sx,18+sy%150,1+(i%3===0?1:0),1,hr('#553b78',hue));
    }
    for(i=0;i<st.solids.length;i++){
      var s=st.solids[i],x=s.x-camX,y=s.y-camY;
      if(x+s.w<-20||x>276||y+s.h<-20||y>244)continue;
      var start=Math.floor(s.x/16)*16;
      for(var wx=start;wx<s.x+s.w;wx+=16){
        var tileL=Math.max(wx,s.x),tileR=Math.min(wx+16,s.x+s.w),tx=tileL-camX;
        if(tx<-18||tx>258||tileR<=tileL)continue;
        drawTile(tx,y,tileR-tileL,s.h,s.kind,hue);
      }
    }
    for(i=0;i<st.doors.length;i++){var d=st.doors[i],dx=d.x-camX,dy=d.y-camY;if(dx+d.w>-30&&dx<286&&dy+d.h>-30&&dy<254)drawDoor(d,camX,camY,hue);}
    for(i=0;i<st.pickups.length;i++){var p=st.pickups[i],pxx=p.x-camX,py=p.y-camY;if(!p.got&&pxx>-15&&pxx<265&&py>-15&&py<235)px(ORB,MAP,pxx,py-(p.pulse||0)*3,2,false);}
    for(i=0;i<st.shots.length;i++){var sh=st.shots[i],bx=sh.x-camX,by=sh.y-camY;px(BEAM,{y:hr('#ffe878',hue),w:'#ffffff'},bx-1,by-1,2,false);}
    for(i=0;i<st.enemies.length;i++){
      var e=st.enemies[i];if(!e.alive)continue;var ex=e.x-camX,ey=e.y-camY;if(ex<-25||ex>275||ey<-25||ey>245)continue;
      g.save();g.translate(ex+e.w/2,ey+e.h/2);g.scale(1+(m.enemyPulse||0)*.055+(e.pulse||0)*.06,1+(m.enemyPulse||0)*.055+(e.pulse||0)*.06);
      px(e.type==='ripper'?RIP:e.type==='skree'?SKREE:e.type==='waver'?WAVER:CRAWL,MAP,-8,-7,2,false);
      g.restore();
    }
    var hs=1+(m.beat||0)*.04,h=st.hero,airborne=!h.onGround&&!h.morph;
    g.save();g.translate(h.x-camX+8,h.y-camY+(h.morph?7:14));g.scale(hs,hs);
    if(h.morph)px(BALL,MAP,-8,-8,2,h.dir<0);
    else{
      if(airborne)g.rotate(((st.t*11)%6.283)*(h.dir<0?-1:1));
      px(airborne?SAMJ:((h.run|0)%2?SAM2:SAM1),MAP,airborne?-12:-14,airborne?-10:-15,2,h.dir<0);
    }
    g.restore();
    if(m.drop){g.globalAlpha=.14;rr(0,0,256,224,'#b18cff');g.globalAlpha=1;}
    g.restore();
  }
  VisualizerGame.layer('metroid','renderer',{packVersion:3,key:'metroid',adapter:'custom-canvas-pack',presentation:['NES exploration platform viewport','orange armored hunter with green visor, arm cannon, running legs, somersault jump, and morph ball','bounded shoot-to-open hatch doors that clamp the camera to each room','world-aligned cavern tiles, vertical shafts, one-way platforms, and low tunnels','music pulse is visual only'],performance:{oneActiveLoop:true,ownsAnimationLoop:false,maxEntities:140,maxParticles:32,maxEventsPerFrame:48,usesReactStatePerFrame:false},render:render,dispose:function(ctx){if(ctx&&ctx.state&&ctx.state.$viz)ctx.state.$viz.disposed=true;}});
})();
