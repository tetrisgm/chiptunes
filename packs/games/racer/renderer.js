// RACER renderer: legally distinct 8-bit motocross bikes, riders, ramps, mud, and stadium detail.
(function(){
  function rr(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));}
  function hr(c,h){return typeof hueRot==='function'?hueRot(c,h||0):c;}
  function line(x1,y1,x2,y2,c,w){g.strokeStyle=c;g.lineWidth=w||1;g.beginPath();g.moveTo(Math.round(x1)+.5,Math.round(y1)+.5);g.lineTo(Math.round(x2)+.5,Math.round(y2)+.5);g.stroke();}
  function px(rows,map,x,y,s,flip){
    // This is a LOCAL pixel helper with its own signature, so it never went
    // through the shared pix() and its sprites kept mapping by absolute
    // luminance: the bike's thirteen colours collapsed and the rider drew as a
    // smudge. Same per-sprite role ranking the rest of the roster uses.
    var _PR=(typeof CT_PAL!=='undefined')&&CT_PAL;
    if(_PR&&_PR.installed) map=_PR.spriteMap(map);
    var w=0;for(var r=0;r<rows.length;r++)if(rows[r].length>w)w=rows[r].length;
    g.save();
    if(flip){g.translate(x+w*s,y);g.scale(-1,1);x=0;y=0;}
    for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++){var c=map[rows[j][i]];if(c)rr(x+i*s,y+j*s,s,s,c);}
    g.restore();
  }
  var LANES=[96,122,148,174];
  var BIKE_A=[
    '..........hhhhhh............',
    '.........hhhhhvw............',
    '.........hhhvvww............',
    '..........hssss...aa.........',
    '........ssssss...aaa.........',
    '.......sss.ss...aa...........',
    '......sss.ddBBBBBBF..........',
    '.....ddd..BBYYYYBBFF.........',
    '....ddd...BYkkkkYB.FF........',
    '...dddd...BBBBBBBB..FF.......',
    '..TTTTT....BBB.....TTTTT.....',
    '.TT...TT..BB.BB..TT...TT....',
    'TT.t.t.TTBB...BFTT.t.t.TT...',
    'TT.....TT.......TT.....TT....',
    '.TT...TT.........TT...TT.....',
    '..TTTTT...........TTTTT......'
  ];
  var BIKE_B=[
    '..........hhhhhh............',
    '.........hhhhhvw............',
    '.........hhhvvww............',
    '..........hssss...aa.........',
    '........ssssss...aaa.........',
    '.......sss.ss...aa...........',
    '......sss.ddBBBBBBF..........',
    '.....ddd..BBYYYYBBFF.........',
    '....ddd...BYkkkkYB.FF........',
    '...dddd...BBBBBBBB..FF.......',
    '..TTTTT....BBB.....TTTTT.....',
    '.TT.t.TT..BB.BB..TT.t.TT....',
    'TT...t.TTBB...BFTT...t.TT...',
    'TT.t...TT.......TT.t...TT....',
    '.TT...TT.........TT...TT.....',
    '..TTTTT...........TTTTT......'
  ];
  function bike(cx,laneY,z,frame,heat,opp,pulse,tilt,hue,boost,wheelie,land){
    // A Game Boy racer puts the rider at ~15% of screen width; at 1.18 on a
    // 256-wide framebuffer this sat near 13% and lost its shape once quantised.
    var _big=(typeof CT_DMG_NATIVE!=='undefined')&&CT_DMG_NATIVE;
    var s=_big?1.6:1.18,rows=((frame|0)&1)?BIKE_B:BIKE_A;
    var frameCol=hr(opp?'#35b865':'#e8453c',hue),frameDark=opp?'#15502a':'#8c1818';
    var suit=hr(opp?'#8f55d8':'#315dcc',hue),helmet=hr(opp?'#38c46a':'#ed4b42',hue);
    var y=laneY+20+z-rows.length*s-(pulse>.5?1:0),x=cx-14*s;
    var poseTilt=(tilt||0)-(wheelie||0)*.34;
    // Contact shadow sits on the CONTACT LINE (laneY+20 — where wheels and terrain
    // meet). It shrinks with height but never disappears, so a super jump keeps a
    // readable marker of where the bike is going to come down.
    var gf=Math.max(0,1+(z||0)/78),sw=10+32*gf;
    rr(cx+1-sw*.5,laneY+18,sw,3,'rgba(0,0,0,'+(.10+.20*gf).toFixed(2)+')');
    // landing dust: kicked out sideways along the contact line as the jump resolves
    if(land>0)for(var n=0;n<4;n++){
      var sp=6+(1-land)*17+(n>>1)*5;
      rr(cx+1+(n&1?sp:-sp),laneY+18-(1-land)*3,3,2,'rgba(226,190,138,'+(land*.5).toFixed(2)+')');
    }
    g.save();g.translate(cx-11,laneY+18+z);g.rotate(poseTilt);g.translate(-(cx-11),-(laneY+18+z));
    // The rider the viewer is following gets the hero treatment; opponents keep
    // the ordinary sprite ranking, so the two read apart at a glance.
    var _rmap={T:'#101318',t:'#a9bac8',B:frameCol,Y:hr('#f0c746',hue),k:'#273143',f:'#dbe4ee',F:'#66758a',h:helmet,v:'#f7fbff',w:'#10151d',s:suit,a:'#efb586',d:frameDark};
    var _PR2=(typeof CT_PAL!=='undefined')&&CT_PAL;
    if(!opp && _PR2 && _PR2.installed) _rmap=_PR2.heroMap(_rmap);
    px(rows,_rmap,x,y,s,false);
    if((boost||0)>.15){var flame=3+Math.round(boost*5);rr(x-flame,y+9*s,flame+2,3,'#ff6b2c');rr(x-flame-2,y+10*s,flame,1,'#ffe36b');}
    else if(heat>.75&&!opp){rr(x-5,y+8*s,5,2,'#ff8c30');rr(x-8,y+8*s,3,1,'#ffe070');}
    g.restore();
  }
  // On the Game Boy panel the sky, the track and the lane bands were all
  // authored between luma 0.44 and 0.48 -- one shade apart at most -- so the
  // whole screen quantised into a single mid mass with the lane dividers and
  // the riders invisible inside it. RC picks the shade by ROLE instead, which
  // is how a Game Boy racer separates sky, track and furniture.
  function RC(hex,hue,role){
    var P=(typeof CT_PAL!=='undefined')&&CT_PAL;
    return (P&&P.installed)?P.role(role):hr(hex,hue);
  }
  function crowd(st,hue){
    var viewW=st.nativeW;
    rr(0,0,viewW,74,RC('#6fc8e4',hue,'field'));rr(0,8,viewW,13,RC('#1b2430',hue,'fore'));
    rr(0,21,viewW,20,RC('#2b3c58',hue,'back'));rr(0,42,viewW,17,RC('#d0b05a',hue,'back'));
    rr(0,59,viewW,15,RC('#4c8b32',hue,'fore'));
    // 72 crowd dots cycle 5 fixed colors with a frame-constant hue: tint the 5 ONCE (bit-identical)
    var cc=['#f8f8f8','#d03030','#3058d0','#f0d040','#38b848'],ct=[hr(cc[0],hue*.4),hr(cc[1],hue*.4),hr(cc[2],hue*.4),hr(cc[3],hue*.4),hr(cc[4],hue*.4)];
    var crowdCount=Math.ceil((viewW+16)/17)*4;
    for(var i=0;i<crowdCount;i++){
      var x=(i*17-(st.worldX*.09)%17)%(viewW+14)-8,y=24+(i%4)*4;
      rr(x,y,3,2,ct[i%5]);
    }
    var flagCount=Math.ceil((viewW+84)/49);
    for(i=0;i<flagCount;i++){var fx=((i*49-st.worldX*.18)%(viewW+84))-42;rr(fx,48,2,15,'#ffffff');rr(fx+2,48+Math.sin(st.t*4+i)*2,10,6,hr(i%2?'#d83030':'#f0d850',hue));}
  }
  function track(st,hue){
    var viewW=st.nativeW;
    rr(0,74,viewW,134,RC('#b35c24',hue,'field'));rr(0,208,viewW,16,RC('#4c2c18',hue,'ink'));
    for(var i=0;i<4;i++){
      var y=LANES[i];
      rr(0,y-12,viewW,23,RC(i%2?'#c66b2b':'#bd6428',hue,i%2?'field':'back'));
      rr(0,y+11,viewW,2,RC('#f0c060',hue,'ink'));
      rr(0,y-13,viewW,1,'rgba(255,255,255,.22)');
      for(var x=-(st.worldX%32);x<viewW+14;x+=32){rr(x,y+3,13,1,'rgba(80,35,10,.35)');rr(x+18,y-5,8,1,'rgba(255,220,140,.2)');}
      for(x=-(st.worldX%18);x<viewW+14;x+=18)rr(x,y+8,3,1,'rgba(70,30,12,.25)');
    }
    rr(0,77,viewW,2,RC('#7b3b18',hue,'ink'));rr(0,201,viewW,3,RC('#7b3b18',hue,'ink'));
  }
  // Mud sits ON the contact line (base = the wheel line) and is the DARK band the
  // rider actually bogs down in, so what looks slow is what is slow.
  function mud(x,base,w,hue,p,t){
    var churn=Math.min(1,p||0);
    rr(x,base-8,w,8,hr('#4d2812',hue));rr(x+1,base-6,w-2,4,'rgba(0,0,0,.34)');
    rr(x,base-9,w,1,'rgba(24,10,3,.5)');
    for(var i=2;i<w-4;i+=9)rr(x+i,base-7+((i+((t*3)|0))%2),5,2,'rgba(255,225,120,.16)');
    // spray: deterministic, driven by the churn level a bike in the mud pushes up
    if(churn>.25)for(var n=0;n<3;n++){
      var sx=x+6+n*(w-14)/3,sy=base-9-((n*5+((t*22)|0)%7)%6)*churn;
      rr(sx,sy,3,2,'rgba(96,52,24,'+(churn*.55).toFixed(2)+')');
    }
  }
  // base = the contact line the wheels ride on; the surface drawn here is exactly
  // the surface rampSurface() reports to the physics.
  function rampShape(x,base,w,h,type,hue,pulse){
    var lift=(pulse||0)*2,color=hr('#d96d28',hue),top=hr('#ffd080',hue),edge='#6b3218';
    g.save();g.translate(0,-lift);
    if(type==='whoops'){
      var hw=w/3;
      for(var n=0;n<3;n++){var sx=x+n*hw;g.fillStyle=color;g.beginPath();g.moveTo(sx,base);g.lineTo(sx+hw/2,base-h);g.lineTo(sx+hw,base);g.closePath();g.fill();line(sx,base,sx+hw/2,base-h,top,2);line(sx+hw/2,base-h,sx+hw,base,edge,2);}
    }else if(type==='tabletop'){
      var ed=Math.min(.32,13/w)*w;
      g.fillStyle=color;g.beginPath();g.moveTo(x,base);g.lineTo(x+ed,base-h);g.lineTo(x+w-ed,base-h);g.lineTo(x+w,base);g.closePath();g.fill();
      line(x+2,base-1,x+ed,base-h,top,2);line(x+ed,base-h,x+w-ed,base-h,top,3);line(x+w-ed,base-h,x+w,base,edge,2);
    }else{
      g.fillStyle=color;g.beginPath();g.moveTo(x,base);g.lineTo(x+w,base-h);g.lineTo(x+w,base);g.closePath();g.fill();
      line(x+2,base-1,x+w,base-h,top,2);line(x+w,base-h,x+w,base,edge,2);
      // kicker lip: reads as the launch edge the bikes fly off
      rr(x+w-2,base-h-1,3,Math.min(6,h),hr('#ffe6a8',hue));
    }
    for(var i=0;i<w;i+=8)rr(x+i,base-4,3,3,'rgba(90,40,15,.28)');
    g.restore();
  }
  function drawElement(e,x,hue,m,t){
    // base = e.y+20 = the bike contact line. Ramps used to be drawn 21px ABOVE it,
    // so a bike at full ramp height still rendered below the ramp and the slopes
    // read as scenery. Now the sprite climbs the wedge it is standing on.
    if(e.type==='mud')mud(x,e.y+20,e.w,hue,(m.mud||0)*.5+(e.pulse||0),t);
    else if(e.type==='ramp'||e.type==='tabletop'||e.type==='whoops')rampShape(x,e.y+20,e.w,e.h,e.type==='ramp'?e.kind:e.type,hue,e.pulse||0);
  }
  function render(ctx){
    var st=ctx.state,A=ctx.A,m=st.music||{},hue=(m.hue||0)*.14;
    st.nativeW=Math.max(1,Math.round(st.nativeH*A.w/A.h));
    st.bike.screenX=Math.min(70,Math.max(18,st.nativeW*.27));
    var sc=Math.max(A.w/st.nativeW,A.h/st.nativeH),ox=A.x+(A.w-st.nativeW*sc)/2,oy=A.y+(A.h-st.nativeH*sc)/2;
    g.save();g.translate(ox,oy);g.scale(sc,sc);g.beginPath();g.rect(0,0,st.nativeW,st.nativeH);g.clip();
    crowd(st,hue);track(st,hue);
    var actors=[],terrain=[];
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i],x=e.x-st.worldX+st.bike.screenX;
      if(x<-56||x>st.nativeW+30)continue;
      if(e.type==='opponent')actors.push({kind:'opp',x:x,y:e.y,e:e});else terrain.push({x:x,y:e.y,e:e});
    }
    // terrain now overlaps neighbouring lanes (it is anchored to the contact line),
    // so nearer lanes must paint last, exactly like the riders.
    terrain.sort(function(a,b){return a.y-b.y;});
    for(i=0;i<terrain.length;i++)drawElement(terrain[i].e,terrain[i].x,hue,m,st.t||0);
    actors.push({kind:'hero',x:st.bike.screenX,y:st.bike.laneY,e:st.bike});
    actors.sort(function(a,b){return a.y-b.y;});
    for(i=0;i<actors.length;i++){
      var a=actors[i];
      if(a.kind==='opp')bike(a.x+16,a.y,a.e.z||0,a.e.phase*18,.2,true,(m.opponentPulse||0)+(a.e.pulse||0)*.6,a.e.tilt||0,hue,a.e.boost||0,a.e.wheelie||0,a.e.land||0);
      else bike(a.x+10,a.e.laneY,a.e.z,a.e.frame,a.e.heat,false,(m.engine||0)*.5,a.e.tilt,hue,a.e.boost,a.e.wheelie,a.e.land||0);
    }
    if(m.drop){g.globalAlpha=.16;rr(0,0,st.nativeW,st.nativeH,'#ffffff');g.globalAlpha=1;}
    g.restore();
  }
  VisualizerGame.layer('racer','renderer',{
    packVersion:2,key:'racer',adapter:'custom-canvas-pack',
    presentation:['8-bit arcade motocross side camera with four detailed lanes','legally distinct hand-authored pixel dirt bikes have treaded wheels, forks, engines, frames, helmets, arms, boots, and forward-leaning riders','ramps, tabletops, whoops and mud are drawn on the wheel contact line, so a rider visibly climbs the exact surface the physics reports','all riders rotate onto slopes, fly off ramp lips in big arcs, pitch nose-up climbing and nose-down falling, land with dust, boost, and lift the front wheel','a shrinking contact shadow keeps the landing spot readable at the top of a super jump','opponent riders advance under their own world speed instead of being fixed scenery','dark mud bands churn and spray while a bike is bogged down in them','track has stadium crowd, flags, tire grooves, lane dividers, mud, slope ramps, tabletops, and whoops','music pulses engine, ramp highlights, crowd flags, and palette without moving collision geometry'],
    performance:{oneActiveLoop:true,ownsAnimationLoop:false,maxEntities:120,maxParticles:44,maxEventsPerFrame:50,usesReactStatePerFrame:false},render:render,
    dispose:function(ctx){if(ctx&&ctx.state&&ctx.state.$viz)ctx.state.$viz.disposed=true;}
  });
})();
