// PAC-MAN renderer. Presentation only: consumes state plus render inputs and draws the maze.
const PacmanRenderer = (function(){
  function render(A, U, st, view){
    view = view || {};
    var cl = view.cl || {};
    var rows = st.rows, cols = st.cols, grid = st.grid, pac = st.pac;
    var ts = Math.floor(Math.min((A.w) / cols, (A.h) / rows));
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
          else if(t==='o'){ if(powOn){ g.fillStyle=st.dotCol; g.beginPath(); g.arc(CX(pc3), CY(pr3), powR, 0, Math.PI*2); g.fill(); } }
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
        var s=ts*1.1*MV.pulse(cl, drop?0.05:0.03), u=s/8;   // BEAT=PULSE: ghosts swell a hair on the beat
        var gx=Math.round(x-s/2), gy=Math.round(y-s/2);
        var bodyCol=MV.tint(cl, gh.col), showBody=true, frightShow=false;   // BAR=PALETTE accent on the ghost body
        if(gh.mode==='eyes'){ showBody=false; }
        else if(gh.mode==='fright'){
          frightShow=true;
          var ending = st.fright<1.6 && (Math.floor(st.time*8)%2===0);
          bodyCol = ending ? '#ffffff' : '#2038ec';
        }
        if(showBody){
          // one gap-free sprite: domed top + scalloped feet, no seam between forehead and body
          pix(['..####..','.######.','########','########','########','########','########','##.##.##'],
              gx, gy, u, {'#':bodyCol});
        }
        var pdir=gh.dir;
        var pdx=(pdir===1?0.4:pdir===3?-0.4:0);
        var pdy=(pdir===2?0.4:pdir===0?-0.4:0);
        if(frightShow){
          // scared face: two small round eyes + a wavy pink mouth (ovals, so no hard horizontal edges)
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.ellipse(gx+u*2.6, gy+u*3.2, u*0.7, u*0.7, 0, 0, 6.2832);
          g.ellipse(gx+u*5.4, gy+u*3.2, u*0.7, u*0.7, 0, 0, 6.2832);
          g.fill();
          rrect(gx+u*1.4, gy+u*4.9, u*1.1, u*0.7, '#ffb8b8');
          rrect(gx+u*3.4, gy+u*4.9, u*1.1, u*0.7, '#ffb8b8');
          rrect(gx+u*5.4, gy+u*4.9, u*1.1, u*0.7, '#ffb8b8');
        } else {
          // round eyes: oval whites + blue pupils looking toward travel — ovals leave NO straight edge to read as a seam
          var elx = gx+u*2.6, erx = gx+u*5.4, eyy = gy+u*3.5;
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.ellipse(elx, eyy, u*1.15, u*1.5, 0, 0, 6.2832);
          g.ellipse(erx, eyy, u*1.15, u*1.5, 0, 0, 6.2832);
          g.fill();
          g.fillStyle = '#2121de';
          g.beginPath();
          g.ellipse(elx+pdx*u, eyy+pdy*u*1.1, u*0.6, u*0.78, 0, 0, 6.2832);
          g.ellipse(erx+pdx*u, eyy+pdy*u*1.1, u*0.6, u*0.78, 0, 0, 6.2832);
          g.fill();
        }
      }
      for(var gd=0; gd<st.ghosts.length; gd++){ if(st.ghosts[gd].mode!=='eyes') drawGhost(st.ghosts[gd]); }
      for(var gd2=0; gd2<st.ghosts.length; gd2++){ if(st.ghosts[gd2].mode==='eyes') drawGhost(st.ghosts[gd2]); }
  
      var pgx=pac.sc+(pac.c-pac.sc)*pac.off, pgy=pac.sr+(pac.r-pac.sr)*pac.off;
      var px2=ox+(pgx+0.5)*ts, py2=oy+(pgy+0.5)*ts;
      if(!(st.dead && st.freeze>0.2)){
        var prad=ts*0.52*(1+st.kick*0.10);
        var mouthOpen = pac.mouth*0.78;
        if(st.dead) mouthOpen = Math.min(Math.PI, mouthOpen + (1.4-st.freeze)*3);
        var baseAng=(pac.dir===1?0: pac.dir===2?Math.PI/2: pac.dir===3?Math.PI: -Math.PI/2);
        g.fillStyle='#ffff00';
        g.beginPath();
        g.moveTo(px2, py2);
        g.arc(px2, py2, prad, baseAng+mouthOpen, baseAng+Math.PI*2-mouthOpen, false);
        g.closePath();
        g.fill();
      }
  
      if(st.flash>0){ g.globalAlpha=Math.min(0.35, st.flash*0.3); rrect(A.x, A.y, A.w, A.h, '#ffffff'); g.globalAlpha=1; }
  }

  return { render: render };
})();

(function(){
  function render(ctx){
    ctx = ctx || {};
    var A = ctx.A || {x:0, y:0, w:0, h:0};
    var U = ctx.U || 8;
    var st = ctx.state || ctx.st;
    if(!st) return undefined;
    return PacmanRenderer.render(A, U, st, ctx.pacmanView || ctx.view || {});
  }

  VisualizerGame.layer('pacman', 'renderer', {
    packVersion: 3,
    key: 'pacman',
    adapter: 'custom-canvas-pack',
    draw: PacmanRenderer.render,
    presentation: [
      'pixel maze',
      'sprite player and ghosts',
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
      allocations: 'renderer consumes ctx.pacmanView built by PacmanDefinition.update'
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
