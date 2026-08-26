// CLIMBER renderer. Presentation only; consumes ClimberDefinition's climberView payload.
const ClimberRenderer = (function(){
  function render(ctx){
    ctx=ctx||{};
    var view=ctx.climberView||{};
    var A=view.A||ctx.A||{x:0,y:0,w:0,h:0};
    var U=view.U||ctx.U||8;
    var st=view.st||ctx.state;
    if(!st) return undefined;
    var jm=st.jm||{};
    var col=view.col||st.col||{};
    var beatScale=view.beatScale||1;
    var nrg=view.nrg||0;
    var barH=view.barH||0;
    var phraseHue=view.phraseHue||barH;
    var stepped=!!view.stepped;
    function gy(r,x){ return st.girderY ? st.girderY(r,x) : (A.y+A.h); }
    function downhillDir(tier){
      var sd=(st.slopeDirs&&st.slopeDirs[tier]!==undefined)?st.slopeDirs[tier]:((tier%2===0)?-1:1);
      return sd===0 ? ((tier%2===0)?-1:1) : sd;
    }
    function ladX(L){ return st.A.x+st.A.w*CLIMBER_clamp01(L.fx); }
    var TINT=function(hex){ return hueRot(hex, barH); };
    var TINT2=function(hex){ return hueRot(hex, phraseHue); };
      var g_=(typeof g!=='undefined')? g : null;
      if(!g_) return;
      if(typeof rrect!=='function' || typeof pix!=='function') return;
      var px2=Math.max(1, Math.round(U*0.5));

      rrect(A.x, A.y, A.w, A.h, col.bg);

      // EVENT = JUICE: micro screen-shake on actions (scaled by energy), applied to the whole stage
      var shMag=(st.shake||0)*2.6*U*(0.5+0.5*nrg);
      var shX=0, shY=0;
      if(shMag>0.3){ shX=(Math.random()*2-1)*shMag; shY=(Math.random()*2-1)*shMag; }
      g_.save(); g_.translate(shX, shY);

      // BAR = PALETTE: girder/rivet colours rotate over the bar; BEAT = PULSE: girder thickness swells on the beat
      var girderC=TINT2(col.girder), girderDC=TINT2(col.girderDark), rivetC=TINT(col.rivet);
      var th=Math.max(2, Math.round(1.2*U*beatScale));
      var segs=18;
      for(var r=0;r<st.N;r++){
        for(var s=0;s<segs;s++){
          var x0=A.x + (A.w*s/segs);
          var x1=A.x + (A.w*(s+1)/segs);
          var y0=gy(r,x0);
          var y1=gy(r,x1);
          var yy=Math.min(y0,y1);
          var seg=x1-x0+1;
          rrect(x0, yy-th*0.5, seg, th, girderC);
          rrect(x0, yy+th*0.5, seg, Math.max(1,th*0.35), girderDC);
        }
      }

      for(var di=0;di<st.ladders.length;di++){
        var Ld2=st.ladders[di];
        var lx=ladX(Ld2);
        var topT=Ld2.tier+1;
        var yB=gy(Ld2.tier,lx);
        var yT=gy(topT,lx);
        var railW=Math.max(1,Math.round(U*0.35));
        var lw=2.0*U*beatScale;   // BEAT: ladder width swells on the beat
        var rc=TINT(col.ladder);   // BAR: ladder palette rotates
        rrect(lx-lw*0.5, yT, railW, yB-yT, rc);
        rrect(lx+lw*0.5-railW, yT, railW, yB-yT, rc);
        var nrung=Math.max(2, Math.round((yB-yT)/(1.3*U)));
        for(var rg=0; rg<=nrung; rg++){
          var ry=yT + (yB-yT)*rg/nrung;
          rrect(lx-lw*0.5, ry-railW*0.5, lw, railW, rc);
        }
      }

      if(st.stageType===1){
        // Rivet-board floors were reading as random dots on the playfield, so
        // this variant now relies on girder geometry and palette only.
      } else if(st.stageType===2){
        var railC=TINT(col.ladder);
        var elevatorCount=Math.max(2,(st.horizontalPaths||1)+1);
        for(var er=0;er<elevatorCount;er++){
          var ex=A.x+A.w*(0.12+0.76*(elevatorCount===1?0.5:er/(elevatorCount-1)));
          var ey0=gy(0,ex)-1.0*U;
          var ey1=gy(st.N-1,ex)-4.5*U;
          rrect(ex-0.35*U, ey1, 0.35*U, ey0-ey1, railC);
          rrect(ex+1.7*U, ey1, 0.35*U, ey0-ey1, railC);
          var carY=ey1+(ey0-ey1)*(0.5+0.42*Math.sin(st.t*0.7+er*2.1));
          rrect(ex-1.0*U, carY, 4.2*U, 0.7*U, TINT(col.rivet));
        }
      } else if(st.stageType===3){
        var panCount=Math.max(5,Math.round(A.w/Math.max(1,14*U)));
        for(var pan=0;pan<panCount;pan++){
          var pxp=A.x+A.w*(0.08+0.84*(panCount===1?0.5:pan/(panCount-1)));
          var py=gy(pan%Math.max(1,st.N-1),pxp)-2.0*U;
          pix([
            ".oooo.",
            "oYYYYo",
            "oYDDYo",
            ".oooo."
          ], pxp-3*U*0.28, py-3*U*0.28, U*0.28, {
            o:TINT(col.girderDark), Y:TINT(col.girder), D:TINT(col.bruteDark)
          });
        }
      }

      var oilx=A.x+A.w*st.oil.fx;
      var oily=gy(0,oilx);
      var ow=2.6*U, oh=3.2*U;
      rrect(oilx-ow*0.5, oily-oh, ow, oh, TINT(col.oilBlue));
      rrect(oilx-ow*0.5, oily-oh, ow, Math.max(1,oh*0.18), TINT(col.oilDark));
      rrect(oilx-ow*0.5, oily-oh*0.55, ow, Math.max(1,oh*0.12), TINT(col.oilDark));
      var fl=(Math.sin(st.oil.flame*22)+Math.sin(st.oil.flame*13.7))*0.25+0.5;
      var fh=(1.4+fl*1.1)*U;
      rrect(oilx-0.9*U, oily-oh-fh, 1.8*U, fh, col.flameA);
      rrect(oilx-0.5*U, oily-oh-fh-0.6*U, 1.0*U, fh*0.6+0.6*U, col.flameB);
      if(fl>0.6) rrect(oilx-0.25*U, oily-oh-fh-1.0*U, 0.5*U, 0.9*U, col.flameC);

      function mirrorRows(rows){
        var out=[];
        for(var mi=0; mi<rows.length; mi++){ out.push(rows[mi].split('').reverse().join('')); }
        return out;
      }

      var bruteX=A.x+A.w*st.brute.fx;
      var bruteY=gy(st.N-1, bruteX);
      var bruteScale=Math.max(1, U*0.72);
      var bruteLift=(st.brute.throwAnim>0)? -0.6*U : 0;
      var bruteDir=downhillDir(st.N-1);
      // Broad shoulders, low knuckles, a cream muzzle, and two high-contrast
      // eyes keep the silhouette readable as a gorilla at wallpaper scale.
      var bruteRows=(st.brute.throwAnim>0) ? [
        "BBB......bbbbbb............",
        ".BBB..bbbBBBBBBbbb.........",
        "..BBBbBBBBBBBBBBBBBbb......",
        "...bBBBBBFFFFFFFFBBBBBb....",
        "..bBBBBBFFWEFFWEFFBBBBBb...",
        ".bBBBBBBFFFFFFFFFFBBBBBBb..",
        "bBBBBBBBFFMMMMMMFFBBBBBBBb.",
        "BBBBBBBBFMMMMMMMMFBBBBBBBB.",
        "BBBBBBBBBFFFFFFFFBBBBBBBBB.",
        ".BBBBBBBBBBBBBBBBBBBBBBBBB.",
        "BBBBBBBBBCCCCCCBBBBBBBBBBBB",
        "BBBBBBBBBCCCCCCBBBBBBBBBBBB",
        "BBBBB..BBBCCCCCCBBB..BBBBB.",
        "BBBB...BBBCCCCCCBBB...BBBB.",
        "BBBB....BBBBBBBBBBB....BBBB",
        ".BBBB....BBBBBBBBB....BBBB.",
        ".BBBBB..BBBB...BBBB..BBBBB.",
        "..BBBBBBBBB.....BBBBBBBBB..",
        "...BBBBBBB.......BBBBBBB..."
      ] : [
        ".........bbbbbb............",
        "......bbbBBBBBBbbb.........",
        "....bbBBBBBBBBBBBBBbb......",
        "...bBBBBBFFFFFFFFBBBBBb....",
        "..bBBBBBFFWEFFWEFFBBBBBb...",
        ".bBBBBBBFFFFFFFFFFBBBBBBb..",
        "bBBBBBBBFFMMMMMMFFBBBBBBBb.",
        "BBBBBBBBFMMMMMMMMFBBBBBBBB.",
        "BBBBBBBBBFFFFFFFFBBBBBBBBB.",
        ".BBBBBBBBBBBBBBBBBBBBBBBBB.",
        "BBBBBBBBBCCCCCCBBBBBBBBBBBB",
        "BBBBBBBBBCCCCCCBBBBBBBBBBBB",
        "BBBBB..BBBCCCCCCBBB..BBBBB.",
        "BBBB...BBBCCCCCCBBB...BBBB.",
        "BBBB....BBBBBBBBBBB....BBBB",
        ".BBBB....BBBBBBBBB....BBBB.",
        ".BBBBB..BBBB...BBBB..BBBBB.",
        "..BBBBBBBBB.....BBBBBBBBB..",
        "...BBBBBBB.......BBBBBBB..."
      ];
      if(bruteDir<0) bruteRows=mirrorRows(bruteRows);
      pix(bruteRows, bruteX-13.5*bruteScale, bruteY-18.6*bruteScale+bruteLift, bruteScale, {
        b:col.bruteDark, B:col.bruteBrown, F:col.bruteCream, C:col.bruteCream,
        W:'#FFFFFF', E:'#101010', M:'#5C2410'
      });

      for(var bd=0;bd<st.barrels.length;bd++){
        var Bd=st.barrels[bd];
        var bx2=Bd.x, by2=Bd.y;
        var bu=Math.max(1, U*0.56*beatScale);   // BEAT: barrels pulse
        var barrelC=TINT(col.barrel), barrelDark=TINT(col.barrelDark);
        var sp=(Math.sin(Bd.spin)>0)?1:0;
        pix(sp ? [
          ".HHHH.",
          "HbBBbH",
          "HBDDBH",
          "HbBBbH",
          ".HHHH."
        ] : [
          ".HHHH.",
          "HBBbbH",
          "HbDDBH",
          "HBBbbH",
          ".HHHH."
        ], bx2-3*bu, by2-4.4*bu, bu, {
          H:col.barrelHoop, B:barrelC, b:barrelC, D:barrelDark
        });
      }

      if(!(jm.dead>0 && Math.floor(st.t*16)%2===0)){
        var jx=jm.x, jy=jm.y;
        var legA=(stepped||jm.jumping||jm.onLadder)? (Math.floor(jm.anim)%2) : 0;
        var jumperPx = Math.max(1,U*0.82);
        var jumperRows;
        if(jm.onLadder){
          jumperRows = legA ? [
            "....rrrrr....",
            "...rrrrrrr...",
            "...hhhshhh...",
            "..rrrBBrrr..",
            ".w.rBBBB.r..",
            "w..rBBBB..w.",
            "...BBBBBB...",
            "..B.BBBB.B..",
            "..B.BBBB.B..",
            "...B....B...",
            "...B....B...",
            "..kk....kk.."
          ] : [
            "....rrrrr....",
            "...rrrrrrr...",
            "...hhhshhh...",
            "..rrrBBrrr..",
            "..r.BBBBr.w.",
            ".w..BBBB..w.",
            "...BBBBBB...",
            "..B.BBBB.B..",
            "..B.BBBB.B..",
            "...B....B...",
            "...B....B...",
            "..kk....kk.."
          ];
        } else {
          jumperRows = [
            ".....rrrrr...",
            "....rrrrrrrr.",
            "....rrRrrrr..",
            ".....hhhsss..",
            "....hhssse...",
            "....hsssssn..",
            ".....hssmm...",
            "......ssss...",
            ".....rrrr....",
            legA ? "...wrrBBBr.." : "..rrrBBBrw..",
            legA ? "..wrrBBBBrr." : ".wrrBBBBrr..",
            "...rrBBBBrr..",
            "....BBBBB....",
            legA ? "...BB..BB..." : "....BBB.B...",
            legA ? "..kk....kk.." : "...kk..kk..."
          ];
          if(jm.face<0) jumperRows = mirrorRows(jumperRows);
        }
        // The PLAYER: ink outline, solid body, light detail, never the field.
        var _jmap = {
          r:col.mRed, s:col.skin, h:'#5C2410', B:col.mBlue, b:col.mBlue, E:'#101010',
          R:'#FF765E', n:col.skin, e:'#101010', m:'#5C2410', k:'#101010', w:'#FFFFFF'
        };
        var _PH=(typeof CT_PAL!=='undefined')&&CT_PAL;
        if(_PH&&_PH.installed) _jmap=_PH.heroMap(_jmap);
        pix(jumperRows, jx-5.5*jumperPx, jy-jumperRows.length*jumperPx, jumperPx, _jmap);
      }

      g_.restore();

      if(st.flash>0){
        rrect(A.x,A.y,A.w,A.h, 'rgba(252,80,40,'+Math.min(0.5,st.flash)+')');
      }
    return st;
  }

  return { render:render };
})();

(function(){
  VisualizerGame.layer('climber', 'renderer', {
    packVersion: 3,
    key: "climber",
    adapter: "custom-canvas-pack",
    presentation: [
      "pixel girders",
      "sprite runner/barrels",
      "ladder grid",
      "stage-specific props",
      "music-tinted sprites"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 96,
      maxParticles: 0,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: "renderer consumes climberView from ClimberDefinition.update"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    render: ClimberRenderer.render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });
})();
