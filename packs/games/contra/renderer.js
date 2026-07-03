// CONTRA renderer: jungle side-scroll, Contra-like commando silhouette, panes, soldiers, and round bullets.
(function(){
  function rr(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));}
  function hr(c,h){return typeof hueRot==='function'?hueRot(c,h||0):c;}
  function px(rows,map,x,y,s,flip){var w=0;for(var r=0;r<rows.length;r++)if(rows[r].length>w)w=rows[r].length;g.save();if(flip){g.translate(x+w*s,y);g.scale(-1,1);x=0;y=0;}for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++){var c=map[rows[j][i]];if(c)rr(x+i*s,y+j*s,s,s,c);}g.restore();}
  function pbullet(x,y,c){
    rr(x+1,y,3,1,c);rr(x,y+1,5,3,c);rr(x+1,y+4,3,1,c);rr(x+2,y+2,1,1,'#ffffff');
  }
  var BODY1=[
    '..rrrr......',
    '.rssssr.....',
    '.rskksr.....',
    '..ssss......',
    '.ssGGss.....',
    'ssGGGGss....',
    '.sGGGGs.....',
    '..bGGb......',
    '.bb..bb.....',
    'bb....bb....',
    'ss....ss....'
  ];
  var BODY2=[
    '..rrrr......',
    '.rssssr.....',
    '.rskksr.....',
    '..ssss......',
    '.ssGGss.....',
    'ssGGGGss....',
    '.sGGGGs.....',
    '..bGGb......',
    'bb...bb.....',
    's.....bb....',
    'ss.....ss...'
  ];
  var BODYJ=[
    '..rrrr......',
    '.rssssr.....',
    '.rskksr.....',
    '..ssss......',
    '.ssGGss.....',
    'ssGGGGss....',
    '..bGGb......',
    '.bbGGbb.....',
    'bb....bb....',
    's......s....'
  ];
  var BODYROLL=[
    '..rrrr..',
    '.rssssr.',
    'rssGGssr',
    'sGGGGGGs',
    'sGbBBbGs',
    '.bbbbbb.',
    '..ss....',
    '...ss...'
  ];
  var SOLD=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..gGGg..','.ggGGgg.','..b..b..','.bb..bb.'];
  var RUNNER=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','.gGGgg..','ggGGGGg.','..b..bb.','.bb..s..'];
  var SNIPER=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..mmmm..','.mmGGmm.','..b..b..','.bb..bb.'];
  var TURRET=['..mmmm..','.mkkkkm.','mmmmmmmm','..rrrr..','.rrrrrr.','rrrrrrrr'];
  var FLYER=['..yyyy..','.ywwwwy.','yywkkwyy','.yyyyyy.','..y..y..'];
  var GREN=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..oGGo..','.ooGGoo.','..b..b..','.bb..bb.'];
  var CRAWLER=['.kkkkkk.','krrrrrrk','.rGGGGr.','..bbbb..'];
  var JUMPER=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..gGGg..','.ggGGgg.','.b....b','bb....bb'];
  var GUNNER=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..mmmm..','mmGGGGmm','.bbb..b.','bb....bb'];
  var PARA=['..wwww..','.wyyyyw.','wwyyyyww','..rrrr..','.rssssr.','.rskksr.','..rrrr..','..gGGg..','.ggGGgg.','..b..b..','.bb..bb.'];
  var PRONE=['...rrrrr.','..rssssr.','.rskkssr.','..gGGGGg.','bbbbbbbb'];
  var MORTAR=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..mmmm..','.mmGGmm.','..bmm...','.bbmm...'];
  var WALLCANNON=['..mmmm..','.mkkkkm.','mmmmmmmm','..mmmm..','.mrrrrm.','mmrrrrmm'];
  var DIVER=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','..bGGb..','.bbGGbb.','..b..b..','.bb..bb.'];
  var HEAVY=['..rrrr..','.rssssr.','.rskksr.','..rrrr..','.gGGGGg.','ggGGGGgg','..bGGb..','.bb..bb.','bb....bb'];
  var MEDAL=['.yy.','ywwy','yyyy','.yy.'];
  var POWER=['.yy..yy.','ywwyywwy','yyyyyyyy','.mmmmmm.','..yyyy..'];
  var CRATE=['rrrrrrrr','ryyyyyyr','ryryyryr','ryyyyyyr','ryryyryr','ryyyyyyr','ryrrrryr','rrrrrrrr'];
  var MAP={g:'#258c35',G:'#50c850',s:'#f0b890',k:'#0b0b0b',b:'#3058a8',B:'#173878',r:'#d82828',m:'#707070',y:'#f0c850',o:'#d86a28',w:'#ffffff'};
  function enemyRows(type){
    return type==='turret'?TURRET:type==='sniper'?SNIPER:type==='flyer'?FLYER:type==='runner'?RUNNER:type==='grenadier'?GREN:type==='crawler'?CRAWLER:type==='jumper'?JUMPER:type==='gunner'?GUNNER:type==='paratrooper'?PARA:type==='prone'?PRONE:type==='mortar'?MORTAR:type==='wallCannon'?WALLCANNON:type==='diver'?DIVER:type==='heavy'?HEAVY:SOLD;
  }
  function drawGun(x,y,aimX,aimY,flip,hue){
    var ax=aimX||1,ay=aimY||0;
    var ox=flip?-2:10,oy=ay<0?2:ay>0?9:6;
    var len=Math.sqrt(ax*ax+ay*ay)||1,dx=ax/len,dy=ay/len;
    for(var i=0;i<10;i++){
      var px=x+ox+dx*i,py=y+oy+dy*i;
      rr(px,py,2,2,hr('#303030',hue));
      if(i>6)rr(px,py,2,1,'#c8c8c8');
    }
  }
  function drawRooms(st,cam,hue){
    for(var i=0;i<st.rooms.length;i++){
      var r=st.rooms[i],x=r.x-cam;if(x+r.w<-20||x>276)continue;
      if(r.kind==='waterfall'){rr(x+118,42,28,142,hr('#285c88',hue));for(var y=48;y<184;y+=12)rr(x+122,y,20,2,'rgba(180,230,255,.35)');}
      else if(r.kind==='bridge'){rr(x,134,r.w,50,hr('#103f22',hue));}
    }
  }
  function tile(tx,y,w,h,kind,hue){
    var base=kind==='bridge'?'#8b5326':kind==='platform'?'#6b572b':kind==='towerDeck'?'#735021':kind==='towerPost'?'#4a341b':kind==='vine'?'#245f88':'#5b421e';
    rr(tx,y,w,h,hr(base,hue));
    rr(tx,y,w,3,hr(kind==='platform'||kind==='towerDeck'?'#d8bc5d':kind==='vine'?'#80d8ff':'#d0a050',hue));
    rr(tx+1,y+8,Math.max(1,w-2),2,'rgba(0,0,0,.35)');
    if(h>20)rr(tx+3,y+17,Math.max(1,w-6),2,'rgba(255,255,255,.08)');
    rr(tx+Math.max(0,w-2),y,2,h,'rgba(0,0,0,.28)');
  }
  function render(ctx){
    var st=ctx.state,A=ctx.A,m=st.music||{},cam=st.cameraX,hue=(m.hue||0)*.18,sc=Math.min(A.w/st.nativeW,A.h/st.nativeH),ox=A.x+(A.w-st.nativeW*sc)/2,oy=A.y+(A.h-st.nativeH*sc)/2;
    g.save();g.translate(ox,oy);g.scale(sc,sc);g.beginPath();g.rect(0,0,256,224);g.clip();
    rr(0,0,256,224,hr('#203858',hue));rr(0,112,256,112,hr('#13421e',hue));
    drawRooms(st,cam,hue);
    for(var i=0;i<18;i++){var lx=((i*41-cam*.3)%300)-30;rr(lx,72+(i%6)*11,24,3,hr('#2da344',hue));rr(lx+5,75+(i%3)*4,4,28,hr('#1b6f2d',hue));}
    for(i=0;i<st.solids.length;i++){
      var s=st.solids[i],x=s.x-cam;if(x+s.w<-20||x>276)continue;
      var start=Math.floor(s.x/16)*16;
      for(var wx=start;wx<s.x+s.w;wx+=16){
        var l=Math.max(wx,s.x),r=Math.min(wx+16,s.x+s.w),tx=l-cam;if(tx<-18||tx>258||r<=l)continue;
        tile(tx,s.y,r-l,s.h,s.kind,hue);
      }
    }
    for(i=0;i<st.crates.length;i++){var c=st.crates[i];if(!c.alive)continue;var cx=c.x-cam;if(cx>-24&&cx<276){g.save();g.translate(cx+c.w/2,c.y+c.h/2);g.scale(1+(c.pulse||0)*.05,1+(c.pulse||0)*.05);px(CRATE,MAP,-8,-8,2,false);g.restore();}}
    for(i=0;i<st.pickups.length;i++){var p=st.pickups[i],pxx=p.x-cam;if(pxx>-18&&pxx<274)px(p.type==='power'?POWER:MEDAL,MAP,pxx,p.y-(p.pulse||0)*3,2,false);}
    for(i=0;i<st.shots.length;i++){var sh=st.shots[i],sx=sh.x-cam;if(sh.weapon==='laser'){rr(sx,sh.y+1,10,2,hr('#ccf8ff',hue));rr(sx+2,sh.y,6,4,'#ffffff');}else pbullet(sx,sh.y,hr(sh.weapon==='spread'?'#ffe36a':'#fff0a0',hue));}
    for(i=0;i<st.enemyShots.length;i++){var b=st.enemyShots[i],bx=b.x-cam;pbullet(bx,b.y,'#ff7050');}
    for(i=0;i<st.enemies.length;i++){
      var e=st.enemies[i];if(!e.alive)continue;var ex=e.x-cam;if(ex<-28||ex>280)continue;
      g.save();g.translate(ex+e.w/2,e.y+e.h/2);g.scale(1+(m.enemyPulse||0)*.05+(e.pulse||0)*.06,1+(m.enemyPulse||0)*.05+(e.pulse||0)*.06);
      px(enemyRows(e.type),MAP,-8,-12,2,e.vx>0);
      g.restore();
    }
    var hs=1+(m.beat||0)*.035,heroRows=!st.hero.onGround?BODYJ:((st.hero.run|0)%2?BODY2:BODY1),flip=st.hero.dir<0,hx=st.hero.x-cam-6,hy=st.hero.y-2;
    var blink=st.hero.invuln>0&&((st.t*18)|0)%2===0;
    if(!blink){
      g.save();g.translate(hx+13,hy+12);g.scale(hs,hs);
      if(!st.hero.onGround){g.rotate((st.hero.roll||0)*(st.hero.dir>=0?1:-1));px(BODYROLL,MAP,-8,-8,2,flip);}
      else {px(heroRows,MAP,-13,-12,2,flip);drawGun(-13,-12,st.hero.aimX||st.hero.dir||1,st.hero.aimY||0,flip,hue);}
      g.restore();
    }
    if(m.drop){g.globalAlpha=.15;rr(0,0,256,224,'#ffe680');g.globalAlpha=1;}
    g.restore();
  }
  VisualizerGame.layer('contra','renderer',{packVersion:3,key:'contra',adapter:'custom-canvas-pack',presentation:['NES jungle run-and-gun viewport','shirtless bandana commando with blue pants, running legs, directional rifle, and tucked rolling jump','soldiers, runners, snipers, turrets, flyers, grenadiers, crawlers, jumpers, gunners, paratroopers, prone shooters, mortar teams, wall cannons, divers, heavy soldiers, medals, bridge gaps, watchtowers, crates, and upper platforms','full-screen round rifle bullets, spread shots, laser shots, and arcing grenades with reduced cadence','hit blink and shoot-lockout are visible without extra particle clutter'],performance:{oneActiveLoop:true,ownsAnimationLoop:false,maxEntities:176,maxParticles:48,maxEventsPerFrame:56,usesReactStatePerFrame:false},render:render,dispose:function(ctx){if(ctx&&ctx.state&&ctx.state.$viz)ctx.state.$viz.disposed=true;}});
})();
