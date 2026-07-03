// BOMBERMAN renderer. Presentation only; consumes BombermanDefinition's bombermanView payload.
const BombermanRenderer = (function(){
  function render(ctx){
    ctx=ctx||{};
    var view=ctx.bombermanView||{};
    var A=view.A||ctx.A||{x:0,y:0,w:0,h:0};
    var U=view.U||ctx.U||8;
    var dt=ctx.dt||0.016;
    var st=view.st||ctx.state;
    if(!st) return undefined;
    var P=view.P||st.P||{};
    var COLS=view.COLS||st.COLS||15;
    var ROWS=view.ROWS||st.ROWS||11;
    var bm=st.bm||{};
    var tile=view.tile||4;
    var ox=(view.ox==null)?A.x:view.ox;
    var oy=(view.oy==null)?A.y:view.oy;
    var mvEnergy=view.mvEnergy||0;
    var mvDrop=!!view.mvDrop;
    var cl=view.cl||{};
    function cellX(c){ return ox + c*tile; }
    function cellY(r){ return oy + r*tile; }
    // ============================================================
    //  DRAW
    // ============================================================
    // BEAT = PULSE: track the beat clock -> a decaying pulse for tile brightening / sprite scale
    var beat = (typeof cl.beat === 'number') ? cl.beat : -1;
    if(beat !== st._lastBeat){ st._lastBeat = beat; st.beatPulse = 1; }
    st.beatPulse = Math.max(0, (st.beatPulse||0) - dt*5);
    var bp = (st.beatPulse||0) * (mvDrop ? 1.5 : 1);     // 0..~1.5 beat pulse
    var tilePulse = MV.pulse(cl, mvDrop ? 0.05 : 0.03);  // sprite scale 1.00..~1.05 on the beat

    // BAR = PALETTE: one hue rotation that advances with the bar
    var bh = MV.barHue(cl);
    // PHRASE = VARIATION: shift the palette FAMILY by an extra hue band per phrase (stable for the whole phrase)
    var phShift = MV.pick(cl, [0, 40, 90, 150, 210, 280]) || 0;
    var hueAll = bh + phShift;
    if(st._lastPhrase !== cl.phrase){ st._lastPhrase = cl.phrase; st.phraseFlash = 0.16; }
    // tinted palette: wrap the key fills through the bar/phrase hue rotation
    function T(hex){ return hueRot(hex, hueAll); }
    var PT = {
      floorA:T(P.floorA), floorB:T(P.floorB),
      solidTop:T(P.solidTop), solidFace:T(P.solidFace), solidShade:T(P.solidShade), solidEdge:T(P.solidEdge),
      softTop:T(P.softTop), softFace:T(P.softFace), softShade:T(P.softShade), softMortar:T(P.softMortar),
      border:T(P.border), exit:T(P.exit)
    };

    rrect(A.x,A.y,A.w,A.h,PT.border);
    for(var r3=0;r3<ROWS;r3++){
      for(var c3=0;c3<COLS;c3++){
        if(st.solid[r3][c3]) continue;
        var fcol=((r3+c3)&1)?PT.floorA:PT.floorB;
        rrect(cellX(c3),cellY(r3),tile,tile,fcol);
        // BEAT pulse: a faint brighten washes the floor on the beat
        if(bp>0.02){ g.globalAlpha=Math.min(0.18,bp*0.18); rrect(cellX(c3),cellY(r3),tile,tile,'#ffffff'); g.globalAlpha=1; }
      }
    }

    // power-ups (bomb-in-a-badge), drawn under flames/sprites so a blast covers them
    drawPowerups();

    drawFlames();

    var bounce=Math.round(st.kickPulse*Math.min(2,tile*0.12));
    for(var r4=0;r4<ROWS;r4++){
      for(var c4=0;c4<COLS;c4++){
        if(st.solid[r4][c4]) drawSolid(cellX(c4),cellY(r4),tile);
        else if(st.soft[r4][c4]) drawSoft(cellX(c4),cellY(r4),tile);
      }
    }
    for(var bd=0;bd<st.bombs.length;bd++){
      var bob=st.bombs[bd]; drawBomb(cellX(bob.c),cellY(bob.r),tile,bob.t);
    }
    for(var ed=0;ed<st.enemies.length;ed++){
      var enm=st.enemies[ed];
      if(enm.kind==='bomber') drawRival(cellX(0)+enm.x*tile,cellY(0)+enm.y*tile,tile,enm.dir||0,enm.anim||0,enm.tint);
      else drawBalloom(cellX(0)+enm.x*tile,cellY(0)+enm.y*tile,tile,enm.tint,enm.wob);
    }
    if(bm.alive){
      drawBomberman(cellX(0)+bm.x*tile,cellY(0)+bm.y*tile,tile,bm.dir,bm.anim,bounce);
    } else if(bm.dead>0){
      // death blink
      if(((st.t*10)|0)&1) drawBomberman(cellX(0)+bm.x*tile,cellY(0)+bm.y*tile,tile,0,bm.anim,0);
    }
    for(var sd=0;sd<st.sparks.length;sd++){
      var spp=st.sparks[sd];
      var ssz=Math.max(1,Math.round(tile*0.12));
      rrect(Math.round(spp.x),Math.round(spp.y),ssz,ssz,spp.col);
    }

    // HUD: enemies-left
    var hudY=A.y+Math.round(U*0.4);
    for(var en3=0; en3<st.enemies.length; en3++){
      rrect(A.x+A.w-Math.round(U*1.2)-en3*Math.round(U*1.4), hudY, Math.round(U*0.9), Math.round(U*0.9), hueRot(P.tint,hueAll));
    }

    if(st.flash>0.01){
      // EVENT JUICE: explosion/death white-out, brighter on high-energy sections
      g.globalAlpha=Math.min(0.6, st.flash*(0.35 + 0.2*mvEnergy));
      rrect(A.x,A.y,A.w,A.h,'#ffffff');
      g.globalAlpha=1;
    }
    // PHRASE turnover: a brief, gentle wash so the palette-family swap reads as intentional
    if(st.phraseFlash>0.01){
      g.globalAlpha=Math.min(0.10, st.phraseFlash*(0.4+0.6*mvEnergy));
      rrect(A.x,A.y,A.w,A.h,hueRot('#ffffff',hueAll));
      g.globalAlpha=1;
    }

    // ============================================================
    //  DRAW HELPERS (8-bit visual style preserved)
    // ============================================================
    // BEAT pulse helper: grow a tile slightly on the beat (sprite scale via MV.pulse) + faint brighten
    function beatBox(x,t,scale){ return x - Math.round(t*(scale-1)/2); }
    function drawSolid(x,y,t){
      // BEAT = PULSE: solid blocks grow subtly on the beat
      var t2=Math.round(t*tilePulse), x2=beatBox(x,t,tilePulse), y2=beatBox(y,t,tilePulse);
      x=x2; y=y2; t=t2;
      var e=Math.max(1,Math.round(t*0.10));
      rrect(x,y,t,t,PT.solidEdge);
      rrect(x+e,y+e,t-2*e,t-2*e,PT.solidFace);
      rrect(x+e,y+e,t-2*e,Math.max(1,Math.round(t*0.18)),PT.solidTop);
      rrect(x+e,y+e,Math.max(1,Math.round(t*0.18)),t-2*e,PT.solidTop);
      var sh=Math.max(1,Math.round(t*0.16));
      rrect(x+e,y+t-e-sh,t-2*e,sh,PT.solidShade);
      rrect(x+t-e-sh,y+e,sh,t-2*e,PT.solidShade);
      if(bp>0.02){ g.globalAlpha=Math.min(0.22,bp*0.22); rrect(x+e,y+e,t-2*e,t-2*e,'#ffffff'); g.globalAlpha=1; }
    }
    function drawSoft(x,y,t){
      // BEAT = PULSE: soft blocks grow subtly on the beat
      var t2=Math.round(t*tilePulse), x2=beatBox(x,t,tilePulse), y2=beatBox(y,t,tilePulse);
      x=x2; y=y2; t=t2;
      var e=Math.max(1,Math.round(t*0.08));
      rrect(x,y,t,t,PT.softMortar);
      var inX=x+e,inY=y+e,inW=t-2*e,inH=t-2*e;
      rrect(inX,inY,inW,inH,PT.softFace);
      var bhh=Math.round(inH/2), gap=Math.max(1,Math.round(t*0.06)), m=PT.softMortar;
      rrect(inX,inY+bhh-Math.round(gap/2),inW,gap,m);
      var midX=inX+Math.round(inW/2);
      rrect(midX-Math.round(gap/2),inY,gap,bhh,m);
      rrect(inX+Math.round(inW*0.25)-Math.round(gap/2),inY+bhh,gap,inH-bhh,m);
      rrect(inX+Math.round(inW*0.75)-Math.round(gap/2),inY+bhh,gap,inH-bhh,m);
      rrect(inX,inY,inW,Math.max(1,Math.round(t*0.10)),PT.softTop);
      rrect(inX,inY+inH-Math.max(1,Math.round(t*0.12)),inW,Math.max(1,Math.round(t*0.12)),PT.softShade);
      if(bp>0.02){ g.globalAlpha=Math.min(0.20,bp*0.20); rrect(inX,inY,inW,inH,'#ffffff'); g.globalAlpha=1; }
    }
    function drawFlames(){
      for(var i=0;i<st.flames.length;i++){
        var fl=st.flames[i], k=fl.life/fl.max, x=cellX(fl.c), y=cellY(fl.r);
        var flick=((((st.t*16)|0)+fl.c+fl.r)&1)===0;
        var outer='#fc6810', mid='#fca000', core='#fff060';
        if(fl.kind==='c'){
          var inset=Math.round(tile*0.06*(1-k));
          rrect(x+inset,y+inset,tile-2*inset,tile-2*inset,outer);
          var mm=Math.round(tile*0.20);
          rrect(x+mm,y+mm,tile-2*mm,tile-2*mm,mid);
          var hh=Math.round(tile*0.34);
          rrect(x+hh,y+hh,tile-2*hh,tile-2*hh,core);
        } else {
          var thin=Math.round(tile*0.16);
          if(fl.kind==='h'||fl.kind==='tip'){
            rrect(x,y+thin,tile,tile-2*thin,outer);
            rrect(x,y+thin*2,tile,tile-4*thin>0?tile-4*thin:1,mid);
            if(flick) rrect(x+Math.round(tile*0.2),y+Math.round(tile*0.38),tile-Math.round(tile*0.4),Math.round(tile*0.24),core);
          } else {
            rrect(x+thin,y,tile-2*thin,tile,outer);
            rrect(x+thin*2,y,tile-4*thin>0?tile-4*thin:1,tile,mid);
            if(flick) rrect(x+Math.round(tile*0.38),y+Math.round(tile*0.2),Math.round(tile*0.24),tile-Math.round(tile*0.4),core);
          }
        }
      }
    }
    function drawBomb(x,y,t,ticks){
      var phase=(st.t*6+ticks*4), pulse=1+0.06*Math.sin(phase);
      var d=Math.round(t*0.74*pulse);
      var bx=x+Math.round((t-d)/2), by=y+Math.round(t-d)-Math.round(t*0.04);
      var blk='#101010';
      rrect(bx+Math.round(d*0.18),by,Math.round(d*0.64),d,blk);
      rrect(bx,by+Math.round(d*0.18),d,Math.round(d*0.64),blk);
      rrect(bx+Math.round(d*0.08),by+Math.round(d*0.08),Math.round(d*0.84),Math.round(d*0.84),blk);
      rrect(bx+Math.round(d*0.24),by+Math.round(d*0.18),Math.max(1,Math.round(d*0.16)),Math.max(1,Math.round(d*0.16)),'#787878');
      var cx=bx+Math.round(d*0.5);
      rrect(cx-Math.max(1,Math.round(d*0.06)),by-Math.round(d*0.16),Math.max(2,Math.round(d*0.12)),Math.round(d*0.18),'#a0a0a0');
      var sp=(((st.t*18)|0)%2===0)?'#ffe000':'#ff8000';
      var fy=by-Math.round(d*0.26);
      rrect(cx-Math.max(1,Math.round(d*0.08)),fy,Math.max(2,Math.round(d*0.16)),Math.max(2,Math.round(d*0.14)),sp);
      rrect(cx-Math.max(1,Math.round(d*0.03)),fy-Math.round(d*0.10),Math.max(1,Math.round(d*0.06)),Math.max(1,Math.round(d*0.10)),'#ffffff');
    }
    function drawBalloom(x,y,t,tint,wob){
      var px=Math.max(1,Math.round(t/8));
      var bob=Math.round(Math.sin(wob)*t*0.04);
      var look=(Math.sin(wob*0.5)>0)?1:0;
      var map={'B':'#a000a0','P':tint,'W':'#ffffff','K':'#101010','C':'#f868c8'};
      var rows = look
        ? ['..BBBB..','.BPPPPB.','BPWKPWKB','BPWKPWKB','BPPPPPPB','BPCPPCPB','.BPPPPB.','..BBBB..']
        : ['..BBBB..','.BPPPPB.','BPKWPKWB','BPKWPKWB','BPPPPPPB','BPCPPCPB','.BPPPPB.','..BBBB..'];
      pix(rows,Math.round(x),Math.round(y)+bob,px,map);
    }
    function drawBomberman(x,y,t,dir,anim,bounce){
      var px=Math.max(1,Math.round(t/9));
      var stp=(Math.sin(anim)>0)?1:0;
      bounce=bounce||0;
      var map={'W':'#ffffff','P':'#f8b8d8','B':'#0058f8','L':'#3878fc','O':'#202020','S':'#d0d0d0','A':'#f83800','F':'#f8d8c0'};
      var rows;
      if(dir===0){
        rows=['....A....','....W....','..WWWWW..','.WWWWWWW.','.WWWWWWW.','.WSSSSSW.','..BBBBB..','.BBLLLBB.','.BB.L.BB.','.OO...OO.', stp?'.OO...O..':'..O...OO.'];
      } else if(dir===2){
        rows=['....A....','....W....','..WWWWW..','.WWWWWWW.','.WFFFFFW.','.WOWWWOW.','.WPPPPPW.','..BBBBB..','.BBLLLBB.','.BB.L.BB.', stp?'.OO...O..':'..O...OO.'];
      } else if(dir===1){
        rows=['....A....','....W....','..WWWWW..','.WWWWWFF.','.WWWWWFF.','.WSSSSOW.','..BBBBB..','.BBLLLBB.','.BB.LLBB.','..OO..OO.', stp?'..OO...O.':'...O..OO.'];
      } else {
        rows=['....A....','....W....','..WWWWW..','.FFWWWWW.','.FFWWWWW.','.WOSSSSW.','..BBBBB..','.BBLLLBB.','.BBLL.BB.','.OO..OO..', stp?'.O...OO..':'.OO..O...'];
      }
      for(var i=0;i<rows.length;i++){
        if(rows[i].length<9) rows[i]=(rows[i]+'.........').slice(0,9);
        else if(rows[i].length>9) rows[i]=rows[i].slice(0,9);
      }
      pix(rows,Math.round(x),Math.round(y)-bounce,px,map);
    }
    // RIVAL BOMBER: a little duelist sprite, suit tinted by `tint` so it reads distinct from the blob monster.
    // (helmet visor + colored body + waddling boots; no balloon outline -> clearly "a bomber, not a balloom")
    function drawRival(x,y,t,dir,anim,tint){
      var px=Math.max(1,Math.round(t/9));
      var stp=(Math.sin(anim)>0)?1:0;
      var dark=hueRot(tint,0);                 // body uses the rival's own tint
      var map={'V':'#101010','W':'#ffffff','S':'#d0d0d0','C':tint,'D':'#202020','E':'#f8f8f8'};
      var rows = stp
        ? ['..SSSSS..','.SWWWWWS.','.SWVVVWS.','.SWVEVWS.','..SWWWS..','..CCCCC..','.CCCCCCC.','.CC.C.CC.','.DD...DD.','.DD....D.']
        : ['..SSSSS..','.SWWWWWS.','.SWVVVWS.','.SWVEVWS.','..SWWWS..','..CCCCC..','.CCCCCCC.','.CC.C.CC.','.DD...DD.','..D...DD.'];
      for(var i=0;i<rows.length;i++){
        if(rows[i].length<9) rows[i]=(rows[i]+'.........').slice(0,9);
        else if(rows[i].length>9) rows[i]=rows[i].slice(0,9);
      }
      pix(rows,Math.round(x),Math.round(y),px,map);
    }
    // POWER-UP: a diamond/rounded badge (palette tints) with a small round bomb inside, pulsing on the beat.
    function drawPowerups(){
      if(!st.powerups.length) return;
      var grow=1+0.10*(bp||0);                 // BEAT = PULSE: badge swells on the beat
      for(var i=0;i<st.powerups.length;i++){
        var pu=st.powerups[i], x=cellX(pu.c), y=cellY(pu.r);
        var s=Math.round(tile*0.78*grow), bx=x+Math.round((tile-s)/2), by=y+Math.round((tile-s)/2);
        // rounded badge: edge + bright face (use the soft-block tints so it sits in the palette)
        rrect(bx,by,s,s,PT.softShade);
        var e=Math.max(1,Math.round(s*0.12));
        rrect(bx+e,by+e,s-2*e,s-2*e,PT.softTop);
        var im=Math.max(1,Math.round(s*0.22));
        rrect(bx+im,by+im,s-2*im,s-2*im,PT.exit);
        // small round bomb centered inside (black body + grey glint + fuse spark)
        var d=Math.round(s*0.40), bcx=bx+Math.round(s*0.5), bcy=by+Math.round(s*0.56);
        var bxx=bcx-Math.round(d/2), byy=bcy-Math.round(d/2), blk='#101010';
        rrect(bxx+Math.round(d*0.18),byy,Math.round(d*0.64),d,blk);
        rrect(bxx,byy+Math.round(d*0.18),d,Math.round(d*0.64),blk);
        rrect(bxx+Math.round(d*0.08),byy+Math.round(d*0.08),Math.round(d*0.84),Math.round(d*0.84),blk);
        rrect(bxx+Math.round(d*0.22),byy+Math.round(d*0.20),Math.max(1,Math.round(d*0.16)),Math.max(1,Math.round(d*0.16)),'#909090');
        // fuse spark blinks with the beat clock
        var sp=(MV.beat(cl)||((((st.t*12)|0)%2)===0))?'#ffe000':'#ff8000';
        var fy=byy-Math.round(d*0.30);
        rrect(bcx-Math.max(1,Math.round(d*0.08)),fy,Math.max(2,Math.round(d*0.16)),Math.max(2,Math.round(d*0.22)),sp);
      }
    }
  
    return st;
  }

  var api = {
    packVersion: 3,
    key: "bomberman",
    adapter: "custom-canvas-pack",
    render: render,
    dispose:function(){},
    presentation: [
      "tile maze",
      "bomb/flame sprites",
      "pooled debris",
      "CRT scanline",
      "fixed entity caps"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 5000,
      maxParticles: 1800,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: "view payload plus capped transient arrays"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ]
  };
  VisualizerGame.layer('bomberman', 'renderer', api);
  return api;
})();
