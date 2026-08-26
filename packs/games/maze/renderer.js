// BYTE MAZE renderer. Presentation only: consumes state plus render inputs and draws the maze.
const MazeRenderer = (function(){
  function poseFor(dir){
    if(dir===0)return {angle:-Math.PI/2,mirrorX:1};
    if(dir===2)return {angle:Math.PI/2,mirrorX:1};
    return {angle:0,mirrorX:dir===3?-1:1};
  }

  function render(A, U, st, view){
    view = view || {};
    var cl = view.cl || {};
    var rows = st.rows, cols = st.cols, grid = st.grid, pac = st.pac;
    // COVER on the normal view (the maze bleeds off a wide screen), but FIT on
    // the Game Boy panel so the whole board is visible at Game Boy cell size and
    // centred, the way a handheld maze sits on a wide display. Covering here
    // would push a 23x21 board off the bottom of a 144-row screen.
    var _fit = (typeof CT_DMG_NATIVE!=='undefined' && CT_DMG_NATIVE);
    // Size from the HEIGHT so the board fills the screen vertically -- flooring
    // the min of both axes left a band of dead field above and below it.
    var ts = _fit ? Math.max(3, Math.round((A.h) / rows))
                  : Math.ceil(Math.max((A.w) / cols, (A.h) / rows));
    if(ts < 3) ts = 3;
    var mazeW = ts * cols, mazeH = ts * rows;
    var ox = A.x + (A.w - mazeW) / 2, oy = A.y + (A.h - mazeH) / 2;
    function CX(c){ return ox + (c + 0.5) * ts; }
    function CY(r){ return oy + (r + 0.5) * ts; }
      rrect(A.x, A.y, A.w, A.h, '#000000');
      // PALETTE walks a sequence of colours — ONE colour per BAR, gradually crossfading between them
      // (so e.g. 4 bars passes through 4 colours), paced by the BPM grid; each BEAT pulses the current
      // colour a little. No continuous spin, no whitening.
      var V = view.V || {pulse:0};
      var GR = view.GR || {gstep:0, phase:0};
      var PAL = (st.wallCol && st.wallCol[1]==='f') ? [310,340,20,260,210,160] : [210,250,300,340,40,160];
      var barF = (GR.gstep + GR.phase) / 16;             // continuous bar position
      var bi = Math.floor(barF), frac = barF - bi;
      var hA = PAL[((bi%PAL.length)+PAL.length)%PAL.length], hB = PAL[(((bi+1)%PAL.length)+PAL.length)%PAL.length];
      var dH = ((hB - hA + 540) % 360) - 180;            // shortest-path crossfade between this bar's colour and the next
      var wallH = ((hA + dH*frac) % 360 + 360) % 360;
      wallH = (wallH + MV.barHue(cl) + 360) % 360;       // BAR=PALETTE: ride the shared MV bar-hue on top of the crossfade
      var pl = Math.max(V.pulse||0, MV.beat(cl));        // BEAT pulse — music-clock driven with the shared fallback pulse
      var en = MV.energy(cl), drop = MV.isDrop(cl);      // ENERGY scales brightness/glow; drops allow a little more
      var wcc = 'hsl('+Math.round(wallH)+','+Math.round(68+pl*10)+'%,'+Math.round(46+pl*(7+en*6))+'%)';
      // BEAT=PULSE: walls breathe a hair on the beat (subtle scale, slightly bigger only on drops)
      var wp = MV.pulse(cl, drop?0.05:0.03), wgrow = (wp-1)*ts;
      for(var r=0;r<rows;r++){
        for(var c=0;c<cols;c++){
          if(grid[r][c]!=='#') continue;
          var x=ox+c*ts, y=oy+r*ts;
          rrect(x-wgrow*0.5, y-wgrow*0.5, ts+1+wgrow, ts+1+wgrow, wcc);   // solid wall block; pulses subtly on the beat
        }
      }
      var half=ts*0.5;
      for(var dr2=0;dr2<rows;dr2++) for(var dc2=0;dc2<cols;dc2++){
        if(grid[dr2][dc2]==='-'){ var dx0=ox+dc2*ts, dy0=oy+dr2*ts; rrect(dx0, dy0+half-Math.max(1,ts*0.07), ts, Math.max(2,ts*0.16), st.doorCol); }
      }
      var pelR=Math.max(1, ts*0.11), powR=Math.max(2, ts*0.30);
      var powOn=(Math.floor(st.time*5)%2)===0;
      for(var pr3=0;pr3<rows;pr3++){
        for(var pc3=0;pc3<cols;pc3++){
          var t=grid[pr3][pc3];
          if(t==='.'){ rrect(CX(pc3)-pelR, CY(pr3)-pelR, Math.max(2,pelR*2), Math.max(2,pelR*2), st.dotCol); }
          else if(t==='o'){ if(powOn){ g.save(); g.translate(CX(pc3),CY(pr3)); g.rotate(Math.PI/4); rrect(-powR*0.72,-powR*0.72,powR*1.44,powR*1.44,st.dotCol); g.restore(); } }
        }
      }
      // EVENT=JUICE: tiny local sparkle blooming at the last eaten pellet (scaled by section energy)
      if(st.eatFlash>0){
        var er=ts*(0.35+(1-st.eatFlash)*0.9)*(0.7+MV.energy(cl)*0.6);
        g.globalAlpha=st.eatFlash*0.55;
        g.fillStyle='#ffffff'; g.beginPath(); g.arc(CX(st.eatX), CY(st.eatY), er, 0, Math.PI*2); g.fill();
        g.globalAlpha=1;
      }
      function drawGhost(gh){
        var gcc=gh.sc+(gh.c-gh.sc)*gh.off, grr=gh.sr+(gh.r-gh.sr)*gh.off;
        var x=ox+(gcc+0.5)*ts, y=oy+(grr+0.5)*ts;
        var s=ts*1.1*MV.pulse(cl, drop?0.05:0.03), u=s/8;   // BEAT=PULSE: drones swell a hair on the beat
        var gx=Math.round(x-s/2), gy=Math.round(y-s/2);
        var bodyCol=MV.tint(cl, gh.col), returnMode=gh.mode==='eyes', glitchShow=false;   // BAR=PALETTE accent on the rival shell
        if(gh.mode==='fright'){
          glitchShow=true;
          var ending = st.fright<1.6 && (Math.floor(st.time*8)%2===0);
          bodyCol = ending ? '#ffffff' : '#4f35d9';
        }
        if(returnMode){
          // Defeated drones return as a small rotating signal beacon, never as a pair of eyes.
          g.save(); g.translate(x,y); g.rotate(st.time*3+gh.persona);
          pix(['..W..','.WKW.','WKKKW','.WKW.','..W..'],-u*2.5,-u*2.5,u,{W:'#ffffff',K:'#7c5cff'});
          g.restore();
        } else {
          // Rounded hover-rivals keep the classic maze-chase readability, but use a single visor,
          // side fins, and two square thrusters instead of a face and scalloped ghost skirt.
          pix(['..AAAA..','.ACCCCA.','ACCCCCCA','CCVVVVCC','CCVKKVCC','CCCCCCCC','.CC..CC.','CC....CC'],
              gx,gy,u,{A:'#d9f7ff',C:bodyCol,V:glitchShow?'#ffea65':'#f8fbff',K:'#151128'});
          if(glitchShow){
            pix(['X.X.X.X.','.X.X.X.X'],gx,gy+u*3,u,{X:ending?'#ff5f9f':'#8df06f'});
          } else {
            var pdir=gh.dir, pdx=(pdir===1?0.55:pdir===3?-0.55:0), pdy=(pdir===2?0.55:pdir===0?-0.55:0);
            rrect(gx+u*(3.35+pdx),gy+u*(3.2+pdy),u*1.3,u*1.3,'#f8fbff');
          }
        }
      }
      for(var gd=0; gd<st.ghosts.length; gd++){ if(st.ghosts[gd].mode!=='eyes') drawGhost(st.ghosts[gd]); }
      for(var gd2=0; gd2<st.ghosts.length; gd2++){ if(st.ghosts[gd2].mode==='eyes') drawGhost(st.ghosts[gd2]); }
  
      var pgx=pac.sc+(pac.c-pac.sc)*pac.off, pgy=pac.sr+(pac.r-pac.sr)*pac.off;
      var px2=ox+(pgx+0.5)*ts, py2=oy+(pgy+0.5)*ts;
      if(!(st.dead && st.freeze>0.2)){
        var prad=ts*0.52*(1+st.kick*0.10), unit=prad/5;
        var pose=poseFor(pac.dir);
        var runner=pac.mouth>0.5 ? ['....A.....','..PPPPP...','.PPPPPPP..','PPWPPP....','PPPPPP....','PPDDDD....','PPPPPPP...','.PPPPPPP..','..PPPPP...'] : ['....A.....','..PPPPP...','.PPPPPPP..','PPWPPPPPP.','PPPPPPPPP.','PPPPDDPPP.','PPPPPPPPP.','.PPPPPPP..','..PPPPP...'];
        g.save(); g.translate(px2,py2); g.rotate(pose.angle);g.scale(pose.mirrorX,1);
        if(st.dead)g.scale(Math.max(0.2,st.freeze),Math.max(0.2,st.freeze));
        // The PLAYER: white body, hard black outline. Its authored colours are a
        // pink body with a teal antenna and a dark eye -- ranked by luminance
        // those spread across the middle shades and it read as a dull orange
        // blob rather than the bright thing eating the pellets.
        var _PM=(typeof CT_PAL!=='undefined')&&CT_PAL;
        var _rmap={A:'#70f0dc',P:'#ff5f91',W:'#f8fbff',D:'#24152f'};
        if(_PM&&_PM.installed) _rmap=_PM.heroMap(_rmap);
        pix(runner,-unit*5,-unit*4.5,unit,_rmap);
        g.restore();
      }
  
      if(st.flash>0){ g.globalAlpha=Math.min(0.35, st.flash*0.3); rrect(A.x, A.y, A.w, A.h, '#ffffff'); g.globalAlpha=1; }
  }

  return { render: render, poseFor: poseFor };
})();

(function(){
  function render(ctx){
    ctx = ctx || {};
    var A = ctx.A || {x:0, y:0, w:0, h:0};
    var U = ctx.U || 8;
    var st = ctx.state || ctx.st;
    if(!st) return undefined;
    return MazeRenderer.render(A, U, st, ctx.mazeView || ctx.view || {});
  }

  VisualizerGame.layer('maze', 'renderer', {
    packVersion: 3,
    key: 'maze',
    adapter: 'custom-canvas-pack',
    draw: MazeRenderer.render,
    presentation: [
      'pixel maze',
      'round antenna mascot and visor hover-rival sprites',
      'CRT scanline',
      'render-only wall shake',
      'capped pellet sparkle pool'
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 5000,
      maxParticles: 1800,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: 'renderer consumes ctx.mazeView built by MazeDefinition.update'
    },
    drawContract: [
      'consume simulation state and render modifiers',
      'keep collision state separate from visual pulses',
      'pool or cap transient effects',
      'skip heavy visual work when the runtime enters background audio mode'
    ],
    render: render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });
})();
