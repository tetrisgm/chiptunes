// MEGA MAN 2 renderer: custom NES-scale pixel sprites and steel-stage tiles.
(function(){
  function rr(x,y,w,h,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h)); }
  function hr(c,h){ return typeof hueRot==='function'?hueRot(c,h||0):c; }
  function pixRows(rows,map,x,y,s,flip){
    var w=0; for(var r=0;r<rows.length;r++) if(rows[r].length>w) w=rows[r].length;
    g.save(); if(flip){ g.translate(x+w*s,y); g.scale(-1,1); x=0; y=0; }
    for(var j=0;j<rows.length;j++) for(var i=0;i<rows[j].length;i++){ var col=map[rows[j][i]]; if(col) rr(x+i*s,y+j*s,s,s,col); }
    g.restore();
  }
  var HERO1=['....bbbb....','...bbbbbb...','..bbccccbb..','.bbccffffb.','.bcccffefb.','.bbccffMfb.','..bcccccb..','..bBccBBb..','.BBbbbBBB..','.BBbYYbBB..','..BYYYYB...','..BYY..YB..','.BB....BB.','ss......ss'];
  var HERO2=['....bbbb....','...bbbbbb...','..bbccccbb..','.bbccffffb.','.bcccffefb.','.bbccffMfb.','..bcccccb..','..bBccBBb..','.BBbbbBBB..','.BBbYYbBB..','..BYYYYB...','.BY....YB.','BB......BB','.ss....ss.'];
  var HEROJ=['....bbbb....','...bbbbbb...','..bbccccbb..','.bbccffffb.','.bcccffefb.','.bbccffMfb.','..bcccccb..','.BBbBBbBB..','BB.BYYB.BB','...BYYB....','..BYYYYB...','.BBY..YB..','ss......ss.'];
  var MET=['...rrrr...','..rrrrrr..','.rryyyyrr.','rryyyyyyrr','rrykkyykr','..yyyyyy..','..bbbbbb..','.bb....bb.'];
  var DRONE=['..mmmmm..','.mwwwwwm.','mmwkkwmm','.mmmmmm.','..m..m..'];
  var TURRET=['...mmmm...','..mwwwwm..','.mmkkkkmm.','mmkrrrrkmm','..krrrrk..','..krrrrk..','.bbbbbbbb.'];
  var WALKER=['...gggg...','..ggGGgg..','.ggGwwGgg.','ggGGkkGGgg','..GGGGGG..','.BBg..gBB.','BB......BB'];
  var HOPPER=['...yyyy...','..yYYYYy..','.yyYkkYyy.','..YYYYYY..','...YYYY...','..rr..rr..','.rr....rr.'];
  var SHIELD=['...BBBB...','..BmmmmB..','.BmmwwmmB.','BBmkkkkmBB','BBmmmmmmBB','.BBBBBBBB.','..ss..ss..'];
  var CAPS=['..ww..','.wggw.','wggggw','.wggw.','..ww..'];
  var BUSTER=['.cc.','cwwc','cwwc','.cc.'];
  var MAP={b:'#1438d8',B:'#1f78ff',c:'#75d8ff',f:'#f7bd82',e:'#061030',M:'#7a3818',w:'#ffffff',k:'#0b1038',Y:'#0f54b8',s:'#081038',r:'#d02020',y:'#f6d050',m:'#d8d8e8',g:'#39ff78',G:'#7aff9a'};
  function enemyRows(type){
    if(type==='drone') return DRONE;
    if(type==='turret') return TURRET;
    if(type==='walker') return WALKER;
    if(type==='hopper') return HOPPER;
    if(type==='shield') return SHIELD;
    return MET;
  }
  function drawHero(h,st,scale){
    var rows=!h.onGround?HEROJ:(((h.run|0)%2)?HERO2:HERO1), s=2, x=h.x-st.cameraX-6, y=h.y-4;
    g.save(); g.translate(x+14,y+14); g.scale(scale,scale); pixRows(rows,MAP,-14,-14,s,h.dir<0); g.restore();
  }
  function drawStage(st,A,a){
    var hue=(st.music&&st.music.hue||0)*0.16, cam=st.cameraX;
    rr(0,0,256,224,hr('#0a1230',hue));
    for(var i=0;i<18;i++){ var x=((i*37-(cam*0.25)%37)|0), y=20+((i*23)%92); rr(x,y,1+(i%2),1,hr('#78d8ff',hue)); }
    rr(0,140,256,84,hr('#101a3d',hue));
    if(st.rooms) for(i=0;i<st.rooms.length;i++){
      var r=st.rooms[i], rx=r.x-cam; if(rx+r.w<-8||rx>264) continue;
      var left=Math.max(0,rx), right=Math.min(256,rx+r.w);
      rr(left,18,right-left,122,hr(r.kind==='shaft'?'#101f43':'#0d1735',hue));
      for(var ly=31;ly<136;ly+=20) rr(left,ly,right-left,1,'rgba(120,216,255,.08)');
      if(rx>-8&&rx<264){ rr(rx,18,2,122,hr('#35538b',hue)); rr(rx+2,72,4,38,hr('#1b2a55',hue)); }
      if(rx+r.w>-8&&rx+r.w<264){ rr(rx+r.w-2,18,2,122,hr('#35538b',hue)); rr(rx+r.w-6,72,4,38,hr('#1b2a55',hue)); }
    }
    function tile(tx,y,w,h,kind){
      var base=kind==='platform'?'#2b63a8':'#263f76';
      rr(tx,y,w,h,hr(base,hue));
      rr(tx,y,w,3,hr(kind==='platform'?'#a0ecff':'#78d8ff',hue));
      rr(tx+1,y+5,Math.max(1,w-2),2,'rgba(0,0,0,.32)');
      rr(tx+Math.max(0,w-2),y,2,h,'rgba(0,0,0,.28)');
      if(h>17) rr(tx+3,y+13,Math.max(1,w-6),2,'rgba(255,255,255,.08)');
    }
    for(i=0;i<st.solids.length;i++){
      var s=st.solids[i], sx=s.x-cam; if(sx+s.w<-20||sx>276) continue;
      var clipL=Math.max(0,sx), clipR=Math.min(256,sx+s.w);
      rr(clipL,s.y,clipR-clipL,s.h,hr(s.kind==='platform'?'#1e4f8f':'#1d356a',hue));
      var start=Math.floor(s.x/16)*16;
      for(var wx=start;wx<s.x+s.w;wx+=16){
        var tileL=Math.max(wx,s.x), tileR=Math.min(wx+16,s.x+s.w), tx=tileL-cam;
        if(tx<-18||tx>258||tileR<=tileL) continue;
        tile(tx,s.y,tileR-tileL,s.h,s.kind);
      }
    }
    for(i=0;i<st.ladders.length;i++){ var l=st.ladders[i], lx=l.x-cam; if(lx>-20&&lx<270){ for(var ly=l.y;ly<l.y+l.h;ly+=8){ rr(lx,ly,14,2,hr('#9ae8ff',hue)); } rr(lx, l.y,2,l.h,hr('#9ae8ff',hue)); rr(lx+12,l.y,2,l.h,hr('#9ae8ff',hue)); } }
  }
  function render(ctx){
    var st=ctx.state,A=ctx.A,m=st.music||{}, sc=Math.min(A.w/st.nativeW,A.h/st.nativeH), ox=A.x+(A.w-st.nativeW*sc)/2, oy=A.y+(A.h-st.nativeH*sc)/2;
    g.save(); g.translate(ox,oy); g.scale(sc,sc); g.beginPath(); g.rect(0,0,st.nativeW,st.nativeH); g.clip();
    drawStage(st,A,ctx.audio);
    var pulse=1+(m.beat||0)*0.05;
    for(var pi=0;pi<st.pickups.length;pi++){ var p=st.pickups[pi], x=p.x-st.cameraX; if(x>-20&&x<270) pixRows(CAPS,MAP,x,p.y-(p.pulse||0)*3,2,false); }
    for(var si=0;si<st.shots.length;si++){ var sh=st.shots[si], sx=sh.x-st.cameraX; pixRows(BUSTER,{c:hr('#56f7ff',(m.hue||0)*0.3),w:'#ffffff'},sx-1,sh.y-1,2,sh.vx<0); }
    for(var ei=0;ei<st.enemies.length;ei++){ var e=st.enemies[ei]; if(!e.alive) continue; var ex=e.x-st.cameraX; if(ex<-25||ex>275) continue; g.save(); g.translate(ex+e.w/2,e.y+e.h/2); var ep=1+(m.enemyPulse||0)*0.05+(e.pulse||0)*0.08; g.scale(ep,ep); pixRows(enemyRows(e.type),MAP,-8,-8,2,e.vx>0); g.restore(); }
    drawHero(st.hero,st,pulse);
    if(m.drop){ g.globalAlpha=0.18; rr(0,0,256,224,'#bffcff'); g.globalAlpha=1; }
    g.restore();
  }
  VisualizerGame.layer('mega_man_2','renderer',{packVersion:2,key:'mega_man_2',adapter:'custom-canvas-pack',presentation:['NES side-scroller viewport','custom pixel robot, met, drone, capsule, ladder, and steel tiles','camera-followed run-and-gun action','music pulse never changes hitboxes'],performance:{oneActiveLoop:true,ownsAnimationLoop:false,maxEntities:96,maxParticles:40,maxEventsPerFrame:48,usesReactStatePerFrame:false,allocations:'bounded arrays pruned by camera'},render:render,dispose:function(ctx){if(ctx&&ctx.state&&ctx.state.$viz)ctx.state.$viz.disposed=true;}});
})();
