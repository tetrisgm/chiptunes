// EXCITEBIKE renderer: NES motocross track with bikes, riders, lanes, ramps, mud, and stadium detail.
(function(){
  function rr(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));}
  function hr(c,h){return typeof hueRot==='function'?hueRot(c,h||0):c;}
  function line(x1,y1,x2,y2,c,w){g.strokeStyle=c;g.lineWidth=w||1;g.beginPath();g.moveTo(Math.round(x1)+.5,Math.round(y1)+.5);g.lineTo(Math.round(x2)+.5,Math.round(y2)+.5);g.stroke();}
  function px(rows,map,x,y,s,flip){
    var w=0;for(var r=0;r<rows.length;r++)if(rows[r].length>w)w=rows[r].length;
    g.save();
    if(flip){g.translate(x+w*s,y);g.scale(-1,1);x=0;y=0;}
    for(var j=0;j<rows.length;j++)for(var i=0;i<rows[j].length;i++){var c=map[rows[j][i]];if(c)rr(x+i*s,y+j*s,s,s,c);}
    g.restore();
  }
  var LANES=[96,122,148,174];
  var BIKE_A=[
    '...........rrrrr.........',
    '..........rrrrrrr........',
    '..........rrwwrr.........',
    '...........rrrr..........',
    '............ss...........',
    '.........rrrsss..........',
    '........rrrbbsskk........',
    '.......rrrbbbbkkk........',
    '......rrrbbbbbbyy........',
    '.......rrbbbbyyyyy.......',
    '........bbbyyyyyyyy......',
    '....kkkk..yyyggyyyykk....',
    '...kkkkkk..yggggyykkkk...',
    '...kkwwkk.yyggggyykwwk...',
    '...kkkkkk.yyyyggyykkkk...',
    '....kkkk...yy..yy.kkk....',
    '..........yy....yy.......',
    '.........gg......gg......',
    '........kk........kk.....'
  ];
  var BIKE_B=[
    '...........rrrrr.........',
    '..........rrrrrrr........',
    '..........rrwwrr.........',
    '...........rrrr..........',
    '............ss...........',
    '.........rrrsss..........',
    '........rrrbbsskk........',
    '.......rrrbbbkkk.........',
    '......rrrbbbbbyyy........',
    '.......rrbbbyyyyyy.......',
    '........bbbbyyyyyyy......',
    '....kkkk..yyggyyyyykk....',
    '...kkkkkk.ygggggyykkkk...',
    '...kkkwwk.yyggggyykkwk...',
    '...kkkkkk.yyyyggyykkkk...',
    '....kkkk..yy....yykkk....',
    '.........yy......yy......',
    '........gg........gg.....',
    '.......kk..........kk....'
  ];
  var BIKE_JUMP=[
    '............rrrrr........',
    '...........rrrrrrr.......',
    '...........rrwwrr........',
    '............rrrr.........',
    '............sss..........',
    '..........rrrss..........',
    '.........rrrbbsskk.......',
    '........rrrbbbbkk........',
    '.......rrrbbbbyyy........',
    '........rrbbbyyyyy.......',
    '.........bbbyyyyyyy......',
    '.....kkkk..yyggyyyykk....',
    '....kkkkkk.yggggyykkkk...',
    '....kkwwkk.yygggyykkwk...',
    '....kkkkkk.yyyygyykkkk...',
    '.....kkkk...yy..yykkk....',
    '...........yy....yy......',
    '..........gg......gg.....',
    '.........kk........kk....'
  ];
  var BIKE_CRASH=[
    '.........rrrr............',
    '.......rrrrrrr..........',
    '.......rrwwrr...........',
    '........ssss............',
    '......rrsssrr...........',
    '...kkkk..bbbbrr.........',
    '..kkkkkk..bbbrr.........',
    '..kkwwkk.yyyyrr...gg....',
    '..kkkkkk.yyyyyr..ggg....',
    '...kkkk..yyyyrrgggg.....',
    '.........yyyrrgg..gg....',
    '........gggggg...gg.....',
    '.....kkkkkk..gggggg.....',
    '....kkwwkkk....gg.......',
    '....kkkkkk..............',
    '.....kkkk...............'
  ];
  function recolor(base,opp,hue,heat){
    var main=opp?hr('#2db45a',hue):hr('#d83020',hue),dark=opp?'#15502a':'#8c1818';
    return {
      r:main,R:dark,b:opp?'#3650b8':'#2b58c8',y:hr('#f6d850',hue),s:'#f0b890',
      k:'#111111',w:'#f8f8f8',g:'#d8d8d8',h:heat>.75?'#ff8c30':0
    };
  }
  function bike(cx,laneY,z,frame,heat,opp,pulse,lean,hue){
    var y=laneY+13+z,rows=!opp&&heat>.96?BIKE_CRASH:(z<-3?BIKE_JUMP:((frame|0)%2?BIKE_B:BIKE_A)),p=1+(pulse||0)*.03,map=recolor(null,opp,hue,heat),s=1.45;
    g.save();
    rr(cx-19,laneY+14,38,3,'rgba(0,0,0,.28)');
    g.translate(cx,y);g.rotate((lean||0)+Math.sin(frame*.12)*(opp ? .012 : .02));g.scale(p,p);
    px(rows,map,-18,-25,s,false);
    if(heat>.75&&!opp){rr(18,-7,5,2,'#ff8c30');rr(22,-7,3,1,'#ffe070');}
    g.restore();
  }
  function crowd(st,hue){
    rr(0,0,256,74,hr('#6fc8e4',hue));rr(0,8,256,13,'#1b2430');rr(0,21,256,20,'#2b3c58');rr(0,42,256,17,'#d0b05a');rr(0,59,256,15,'#4c8b32');
    for(var i=0;i<72;i++){
      var x=(i*17-(st.worldX*.09)%17)%270-8,y=24+(i%4)*4,c=['#f8f8f8','#d03030','#3058d0','#f0d040','#38b848'][i%5];
      rr(x,y,3,2,hr(c,hue*.4));
    }
    for(i=0;i<8;i++){var fx=((i*49-st.worldX*.18)%340)-42;rr(fx,48,2,15,'#ffffff');rr(fx+2,48+Math.sin(st.t*4+i)*2,10,6,hr(i%2?'#d83030':'#f0d850',hue));}
    rr(174,12,56,18,'#f8f8f0');rr(178,16,48,10,'#202020');rr(181,18,19,3,'#f0d850');rr(204,18,17,3,'#d83030');
  }
  function track(st,hue){
    rr(0,74,256,134,hr('#b35c24',hue));rr(0,208,256,16,hr('#4c2c18',hue));
    for(var i=0;i<4;i++){
      var y=LANES[i];
      rr(0,y-12,256,23,hr(i%2?'#c66b2b':'#bd6428',hue));
      rr(0,y+11,256,2,hr('#f0c060',hue));
      rr(0,y-13,256,1,'rgba(255,255,255,.22)');
      for(var x=-(st.worldX%32);x<270;x+=32){rr(x,y+3,13,1,'rgba(80,35,10,.35)');rr(x+18,y-5,8,1,'rgba(255,220,140,.2)');}
      for(x=-(st.worldX%18);x<270;x+=18)rr(x,y+8,3,1,'rgba(70,30,12,.25)');
    }
    rr(0,77,256,2,'#7b3b18');rr(0,201,256,3,'#7b3b18');
  }
  function mud(x,y,hue,p){
    rr(x,y+4,38,8,hr('#5c2c13',hue));rr(x+2,y+6,34,3,'rgba(0,0,0,.35)');
    rr(x+5,y+4-(p||0)*2,8,2,'rgba(255,225,120,.25)');rr(x+22,y+5,8,2,'rgba(255,225,120,.18)');
  }
  function rampShape(x,y,w,h,type,hue,pulse){
    var lift=(pulse||0)*2,base=y+12,color=hr('#d96d28',hue),top=hr('#ffd080',hue),edge='#6b3218';
    g.save();g.translate(0,-lift);
    if(type==='whoops'){
      for(var n=0;n<3;n++){var sx=x+n*18;g.fillStyle=color;g.beginPath();g.moveTo(sx,base);g.lineTo(sx+9,base-10);g.lineTo(sx+18,base);g.closePath();g.fill();line(sx,base,sx+9,base-10,top,2);line(sx+9,base-10,sx+18,base,edge,2);}
    }else if(type==='tabletop'){
      g.fillStyle=color;g.beginPath();g.moveTo(x,base);g.lineTo(x+13,base-h);g.lineTo(x+w-13,base-h);g.lineTo(x+w,base);g.closePath();g.fill();
      line(x+2,base-1,x+13,base-h,top,2);line(x+13,base-h,x+w-13,base-h,top,3);line(x+w-13,base-h,x+w,base,edge,2);
    }else{
      g.fillStyle=color;g.beginPath();g.moveTo(x,base);g.lineTo(x+w,base-h);g.lineTo(x+w,base);g.closePath();g.fill();
      line(x+2,base-1,x+w,base-h,top,2);line(x+w,base-h,x+w,base,edge,2);
    }
    for(var i=0;i<w;i+=8)rr(x+i,base-4,3,3,'rgba(90,40,15,.28)');
    g.restore();
  }
  function drawElement(e,x,hue,m){
    if(e.type==='mud')mud(x,e.y-5,hue,(m.mud||0)+(e.pulse||0));
    else if(e.type==='ramp'||e.type==='tabletop'||e.type==='whoops')rampShape(x,e.y-13,e.w,e.h,e.type==='ramp'?e.kind:e.type,hue,e.pulse||0);
  }
  function heatHud(st){
    rr(19,14,63,9,'#111');rr(21,16,59,5,'#502818');rr(21,16,59*(st.bike.heat||0),5,st.bike.heat>.76?'#f03828':'#f0a020');
    rr(92,14,58,9,'#111');rr(94,16,54,5,'#263040');rr(94,16,54*(st.speed/190),5,'#e8e8e8');
  }
  function render(ctx){
    var st=ctx.state,A=ctx.A,m=st.music||{},sc=Math.min(A.w/st.nativeW,A.h/st.nativeH),ox=A.x+(A.w-st.nativeW*sc)/2,oy=A.y+(A.h-st.nativeH*sc)/2,hue=(m.hue||0)*.14;
    g.save();g.translate(ox,oy);g.scale(sc,sc);g.beginPath();g.rect(0,0,256,224);g.clip();
    crowd(st,hue);track(st,hue);
    var actors=[];
    for(var i=0;i<st.elements.length;i++){
      var e=st.elements[i],x=e.x-st.worldX+st.bike.screenX;
      if(x<-56||x>286)continue;
      if(e.type==='opponent')actors.push({kind:'opp',x:x,y:e.y,e:e});else drawElement(e,x,hue,m);
    }
    actors.push({kind:'hero',x:st.bike.screenX,y:st.bike.laneY,e:st.bike});
    actors.sort(function(a,b){return a.y-b.y;});
    for(i=0;i<actors.length;i++){
      var a=actors[i];
      if(a.kind==='opp')bike(a.x+16,a.y,a.e.pulse?-1:0,a.e.phase*18,.2,true,(m.opponentPulse||0)+(a.e.pulse||0)*.6,0,hue);
      else bike(a.x+10,a.e.laneY,a.e.z,a.e.frame,a.e.heat,false,(m.engine||0)*.5,a.e.lean+a.e.tilt,hue);
    }
    heatHud(st);
    if(m.drop){g.globalAlpha=.16;rr(0,0,256,224,'#ffffff');g.globalAlpha=1;}
    g.restore();
  }
  VisualizerGame.layer('excitebike','renderer',{
    packVersion:2,key:'excitebike',adapter:'custom-canvas-pack',
    presentation:['NES motocross side camera with four detailed lanes','all racers are rider-on-motorcycle sprites with wheels, frame, helmet, arms, and pedaling legs','track has stadium crowd, flags, scoreboard, tire grooves, lane dividers, mud, slope ramps, tabletops, and whoops','music pulses engine, ramp highlights, crowd flags, and palette without moving collision geometry'],
    performance:{oneActiveLoop:true,ownsAnimationLoop:false,maxEntities:120,maxParticles:44,maxEventsPerFrame:50,usesReactStatePerFrame:false},render:render,
    dispose:function(ctx){if(ctx&&ctx.state&&ctx.state.$viz)ctx.state.$viz.disposed=true;}
  });
})();
