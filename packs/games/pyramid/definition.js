// PYRAMID pack definition. Rules, state, and simulation update; no canvas drawing and no raw audio reads.
const PyramidDefinition = (function(){
  function layoutDims(A, U){
    var step = U * (3 + 6 * 0.66);
    var rows = Math.max(7, Math.ceil((A.h - U * 21) / step) + 1);
    var bottomCols = Math.max(rows, Math.floor(A.w * 0.72 / (U * 12)));
    var topCols = Math.max(1, bottomCols - rows + 1);
    return { rows:rows, topCols:topCols, wide:A.w/Math.max(1,A.h)>2.4 };
  }

  function rowCenter(st, r){
    var row = st.cubes[Math.max(0, Math.min(st.cubes.length - 1, r))];
    return Math.floor((row.length - 1) * 0.5);
  }

  function ballSpawnCount(st){
    // One-ball batches read cleanly through 16:9.  Truly wide trapezoids
    // need more than the old center-only trickle or most of the board never
    // sees a hazard during a scene.  Keep the batch bounded even on extreme
    // wallpaper spans.
    return st.wide ? 2 : 1;
  }

  function ballSpawnColumns(st, count){
    var row = st.cubes[Math.min(1, st.cubes.length - 1)] || st.cubes[0] || [0];
    var len = Math.max(1, row.length);
    if(count <= 0) return [];
    if(count === 1) return [Math.min(len - 1, Math.floor(Math.random() * len))];
    var out = [];
    // Evenly cover the playable width, with a small shared wander so batches
    // do not form a rigid fence.  The 10% margins keep every spawn on-board.
    var wander = (Math.random() - 0.5) * Math.min(0.08, 0.3 / count);
    for(var i=0; i<count; i++){
      var f = 0.1 + 0.8 * i / (count - 1) + wander;
      out.push(Math.max(0, Math.min(len - 1, Math.round(f * (len - 1)))));
    }
    return out;
  }

  function configureLayout(st, A, U){
    var dims = layoutDims(A, U);
    if(st.ROWS === dims.rows && st.topCols === dims.topCols) return;
    var old = st.cubes;
    var oldTop = st.topCols || 1;
    var cubes = [];
    for(var r=0; r<dims.rows; r++){
      var len = dims.topCols + r;
      var row = [];
      for(var c=0; c<len; c++) row.push(0);
      if(old && old[r]){
        var shift = Math.floor((len - old[r].length) * 0.5);
        for(var oc=0; oc<old[r].length; oc++){
          var nc = oc + shift;
          if(nc>=0 && nc<len) row[nc] = old[r][oc];
        }
      }
      cubes.push(row);
    }
    function remap(r, c){
      r = Math.max(0, Math.min(dims.rows - 1, r|0));
      var oldLen = old && old[r] ? old[r].length : oldTop + r;
      var shift = Math.floor((cubes[r].length - oldLen) * 0.5);
      return Math.max(0, Math.min(cubes[r].length - 1, (c|0) + shift));
    }
    st.ROWS = dims.rows;
    st.topCols = dims.topCols;
    st.wide = dims.wide;
    st.cubes = cubes;
    st.qr = Math.min(st.qr|0, dims.rows-1); st.qc = remap(st.qr, st.qc);
    st.hopr = Math.min(st.hopr|0, dims.rows-1); st.hopc = remap(st.hopr, st.hopc);
    for(var b=st.balls.length-1; b>=0; b--){
      if(st.balls[b].r>=dims.rows || st.balls[b].fr>=dims.rows){ st.balls.splice(b,1); continue; }
      st.balls[b].c=remap(st.balls[b].r,st.balls[b].c);
      st.balls[b].fc=remap(st.balls[b].fr,st.balls[b].fc);
    }
    var co=st.coily;
    if(co){
      co.r=Math.min(co.r|0,dims.rows-1); co.c=remap(co.r,co.c);
      co.fr=Math.min(co.fr|0,dims.rows-1); co.fc=remap(co.fr,co.fc);
    }
    st.flipFx.length=0;
  }

  function makeState(A, U, variant){
    var dims = layoutDims(A, U);
    var ROWS = dims.rows;
    var cubes = [], target = (variant===0)?1:2;
    for(var r=0;r<ROWS;r++){
      var row=[];
      for(var c=0;c<dims.topCols+r;c++) row.push(0);
      cubes.push(row);
    }
    var startCol=Math.floor((dims.topCols-1)*0.5);
    var pal;
    if(variant===0){
      pal = {
        bg:'#000000',
        top:'#2038ec', topL:'#1018a0', topR:'#0c1060',
        goal:['#ffd400'], inter:'#ffd400',
        qbody:'#f87800', qnose:'#f87800', qfoot:'#48b800', qeye:'#ffffff', qpup:'#000000',
        coily:'#a020f0', coilyEye:'#ffffff',
        ballR:'#fc5454', ballG:'#54fc54',
        disc:'#ffd400', discB:'#0078f8'
      };
    } else {
      pal = {
        bg:'#100020',
        top:'#b85820', topL:'#7c3a10', topR:'#4c2208',
        goal:['#36b0a8','#f070d0'], inter:'#36b0a8',
        qbody:'#f87800', qnose:'#f87800', qfoot:'#48b800', qeye:'#ffffff', qpup:'#000000',
        coily:'#a020f0', coilyEye:'#ffffff',
        ballR:'#fc5454', ballG:'#54fc54',
        disc:'#54fcfc', discB:'#9838f8'
      };
    }
    return {
      v:variant, pal:pal, ROWS:ROWS, topCols:dims.topCols, wide:dims.wide, cubes:cubes, target:target, level:1,
      qr:0, qc:startCol,
      hopT:1, hopr:0, hopc:startCol, qhopH:0, face:1, alive:true, toDiscIdx:0,
      onDisc:false, discRide:0, discSide:1,
      falling:false, fallT:0, fallX:0, fallY:0, fallVX:0,
      balls:[],
      coily:{r:0,c:startCol,t:1,fr:0,fc:startCol,active:false, egg:true, hatch:0},
      discs:[ {side:-1, used:false, rot:0}, {side:1, used:false, rot:0} ],
      flash:0, win:false, winT:0, t:0,
      lives:(variant===1?4:3), score:0, ballGate:1.0, coilyT:(variant===1?3.5:2.5),
      growlT:0, aiT:0, respawn:0,
      // --- music-reactive visual state ---
      lastPhrase:-1, goalScheme:0, shake:0, flipFx:[]
    };
  
  }

  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || {x:0, y:0, w:0, h:0};
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state || ctx.st;
    if(!st) return;
    configureLayout(st, A, U);
    if(dt>0.05) dt=0.05;
    if(!IN) IN={};
    if(IN.x==null) IN.x=0.5; if(IN.y==null) IN.y=0.5;
    if(!IN.keys) IN.keys={};
    if(!SND) SND={};
    if(typeof SND.note!=='function') SND.note=function(){};
    if(typeof SND.fx!=='function') SND.fx=function(){};
    if(typeof SND.drum!=='function') SND.drum=function(){};
    if(typeof SND.bass!=='function') SND.bass=function(){};
    if(typeof SND.tone!=='function') SND.tone=function(){};
    if(typeof SND.act!=='function') SND.act=function(){};
    function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }
    var P = st.pal;
    st.t += dt;

    // ===== MUSIC-REACTIVE CLOCK (master) =====
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};
    var barHue = (typeof MV!=='undefined') ? MV.barHue(cl) : 0;
    var beatPulse = (typeof MV!=='undefined') ? MV.pulse(cl, MV.isDrop(cl)?0.05:0.03) : 1;
    var energy = (typeof MV!=='undefined') ? MV.energy(cl) : 0.5;
    function HR(hex){ return (typeof hueRot==='function') ? hueRot(hex, barHue) : hex; }
    // PHRASE = VARIATION: shift the goal/target colour scheme at phrase boundaries.
    if(cl.phrase!=null && cl.phrase!==st.lastPhrase){
      st.lastPhrase = cl.phrase;
      if(typeof MV!=='undefined'){
        st.goalScheme = MV.pidx(cl, 4); // 0..3 -> rotate the target swatch family per phrase
      }
    }
    // ease decay of micro screen-shake
    if(st.shake>0) st.shake = Math.max(0, st.shake - dt*4);

    // EVENT JUICE: tiny cube-flip flashes that fade
    for(var fxi=st.flipFx.length-1; fxi>=0; fxi--){
      var fxo=st.flipFx[fxi]; fxo.a -= dt*3.2;
      if(fxo.a<=0) st.flipFx.splice(fxi,1);
    }

    // micro screen-shake offset (translate whole scene a few px on big events)
    var shx=0, shy=0;
    if(st.shake>0){
      var sa = st.shake * U * 2.2;
      shx = (Math.sin(st.t*47)*sa);
      shy = (Math.cos(st.t*39)*sa);
    }
    var qView = PyramidRenderer.view(A, U, st, { barHue:barHue, beatPulse:beatPulse, energy:energy });
    U=qView.U;
    var halfW = U*6;
    var topH  = U*3;
    var faceH = U*6;
    var stepDown = topH + faceH*0.66;
    var apexX = A.x + A.w*0.5;
    var apexY = A.y + A.h*0.16;
    qView.shx = shx;
    qView.shy = shy;
    qView.dt = dt;
    ctx.pyramidView = qView;
    ctx.pyramidActors = { balls: [], coily: null, falling: false, pyramid: false, flash: false };
    function cubePos(r,c){ return PyramidRenderer.cubePos(qView, r, c); }
    function inb(r,c){ return PyramidBehavior.inBounds(st, r, c); }
    function legalTargets(r,c){ return PyramidBehavior.legalTargets(r, c); }
    function allDone(){ return PyramidBehavior.allDone(st); }
    function discReachable(o){ return PyramidBehavior.discReachable(st, o); }

    // ===================================================================
    // INPUT + AI  (idle ~1.5s -> AI plays toward clearing the pyramid)
    // ===================================================================
    var act = IN.active;
    var canHop = (st.hopT>=1 && st.alive && !st.win && !st.falling && !st.onDisc && st.respawn<=0);

    // choose a hop direction this frame
    var chosen = null; // 'dl'|'dr'|'ul'|'ur'
    if(canHop){
      if(act){
        // ---- HUMAN: arrows / click pick a diagonal; pointer side biases ----
        var k = IN.keys;
        if(k.down && k.left) chosen='dl';
        else if(k.down && k.right) chosen='dr';
        else if(k.up && k.left) chosen='ul';
        else if(k.up && k.right) chosen='ur';
        else if(k.down) chosen = (IN.x < 0.5)?'dl':'dr';
        else if(k.up) chosen = (IN.x < 0.5)?'ul':'ur';
        else if(k.left) chosen = (IN.y > 0.5)?'dl':'ul';
        else if(k.right) chosen = (IN.y > 0.5)?'dr':'ur';
        else if(k.action){
          // action with no arrow: take the most useful diagonal the AI would
          chosen = aiChoose();
        }
        else if(IN.click){
          // click: pointer position relative to Pyramid picks the diagonal
          var qp = cubePos(st.qr, st.qc);
          var px = (IN.lx!=null)?IN.lx : (A.x + IN.x*A.w);
          var py = (IN.ly!=null)?IN.ly : (A.y + IN.y*A.h);
          var goDown = py > qp.y - topH;       // below Pyramid -> descend
          var goRight = px > qp.x;
          chosen = (goDown ? (goRight?'dr':'dl') : (goRight?'ur':'ul'));
        }
      } else {
        // ---- AI: cadence so the sound has a groove; then pick best move ----
        st.aiT -= dt;
        if(st.aiT<=0){
          st.aiT = 0.20;
          chosen = aiChoose();
        }
      }
    }

    function aiChoose(){ return PyramidBehavior.chooseMove(st); }

    // commit the chosen hop
    if(chosen){
      var opts2 = legalTargets(st.qr, st.qc);
      var pick=null;
      for(var oi=0;oi<opts2.length;oi++) if(opts2[oi].d===chosen){ pick=opts2[oi]; break; }
      if(pick){
        st.hopr=st.qr; st.hopc=st.qc;
        st.face = (pick.d==='dr'||pick.d==='ur')?1:-1;
        SND.fx('boop', (st.qr%3));
        EVENT('minor', 2);
        if(inb(pick.r,pick.c)){
          st.qr=pick.r; st.qc=pick.c; st.hopT=0; st.toDiscIdx=0;
        } else {
          // off the pyramid: disc rescue OR a deadly fall
          var dIdx = discReachable(pick);
          if(dIdx>0){
            st.qr=pick.r; st.qc=pick.c; st.hopT=0; st.toDiscIdx=dIdx; // onto disc
          } else {
            // FAILURE: hop off the edge -> fall to death
            st.falling=true; st.fallT=0;
            var fp=cubePos(st.hopr,st.hopc);
            st.fallX=fp.x; st.fallY=fp.y-topH-U*4;
            st.fallVX=(pick.c<0?-1:1)*U*8;
            st.alive=false;
            st.shake = Math.max(st.shake, 0.7+energy*0.3);
            SND.fx('fall');
            EVENT('medium', 6);
            if(st.coily.active && !st.coily.egg) EVENT('state', 5, {name:'danger', on:false});
          }
        }
      }
    }

    // ===== Pyramid hop animation + cube flip on land =====
    if(st.hopT < 1){
      st.hopT = Math.min(1, st.hopT + dt*6.0);
      st.qhopH = Math.sin(st.hopT*Math.PI)*U*4.5;
      if(st.hopT>=1){
        if(st.toDiscIdx>0){
          // landed on a rescue disc
          var dObj = st.discs[st.toDiscIdx-1];
          if(dObj && !dObj.used){
            dObj.used=true; st.onDisc=true; st.discRide=0; st.discSide=dObj.side;
            SND.fx('disc');
            EVENT('medium', 5);
          }
          st.toDiscIdx=0;
        } else if(inb(st.qr,st.qc)){
          var cur = st.cubes[st.qr][st.qc];
          if(cur < st.target){
            st.cubes[st.qr][st.qc]=cur+1;
            st.flash=Math.max(st.flash,0.3);
            // EVENT JUICE: local cube-flip flash at the landed cube
            var fpos=cubePos(st.qr,st.qc);
            st.flipFx.push({x:fpos.x, y:fpos.y, a:0.6+energy*0.4});
            st.score += 25;
            SND.fx('thunk');
            // bright flip blip, pitch by row (deeper rows -> higher)
            SND.fx('blip', st.qr*2 - 4);
            SND.note(st.qr % 7, 0.12, 0.5);
            // reaching the target colour = a real flip (medium); a partial step is minor texture
            EVENT((cur+1>=st.target)?'medium':'minor', (cur+1>=st.target)?5:3);
          } else {
            SND.fx('thunk');
          }
          if(!st.win && allDone()){
            st.win=true; st.winT=0; st.flash=1;
            SND.fx('win');
            EVENT('major', 10);
          }
        }
      }
    } else {
      st.qhopH = 0;
    }

    // ===== disc ride: carry Pyramid to the top, then resume at apex =====
    if(st.onDisc){
      st.discRide += dt;
      if(st.discRide>=0.9){
        st.onDisc=false;
        var discStart=rowCenter(st,0);
        st.qr=0; st.qc=discStart; st.hopr=0; st.hopc=discStart; st.hopT=1;
        // Coily, having chased off the edge, plunges - big respite to mop up cubes
        if(st.coily.active && !st.coily.egg){
          st.coily.active=false; st.coily.egg=true; st.coily.hatch=0;
          st.score += 100; SND.fx('fall'); st.coilyT = 5.5;
          EVENT('major', 8);
          EVENT('state', 5, {name:'danger', on:false});
        }
      }
    }

    // ===== win sequence -> advance level / variant cycle =====
    if(st.win){
      st.winT += dt;
      st.flash = (Math.sin(st.t*22)>0)?0.7:0.15;
      if(st.winT>1.5){
        // next level: keep the same colour target; bump enemy difficulty via level
        st.level++;
        for(var rr2=0;rr2<st.ROWS;rr2++)
          for(var cc2=0;cc2<st.cubes[rr2].length;cc2++) st.cubes[rr2][cc2]=0;
        var levelStart=rowCenter(st,0);
        st.win=false; st.winT=0; st.qr=0; st.qc=levelStart; st.hopr=0; st.hopc=levelStart; st.hopT=1;
        st.toDiscIdx=0; st.flash=0;
        st.balls=[]; st.coily={r:0,c:levelStart,t:1,fr:0,fc:levelStart,active:false,egg:true,hatch:0};
        st.discs=[ {side:-1,used:false,rot:0}, {side:1,used:false,rot:0} ];
        st.coilyT=2.5; st.ballGate=1.0; st.alive=true; st.aiT=0.3; st.respawn=0;
      }
    }

    // ===================================================================
    // ENEMIES
    // ===================================================================

    // ---- balls: spawn from top, bounce down random diagonals ----
    if(!st.win && st.alive){
      st.ballGate -= dt;
      if(st.ballGate<=0){
        st.ballGate = 1.6 + Math.random()*1.4 - Math.min(0.9, st.level*0.12);
        if(st.ballGate<0.4) st.ballGate=0.4;
        var ballCap = Math.min(12, Math.max(6, Math.ceil(6 * (st.topCols || 1) / 15)));
        var spawnN = Math.max(0, Math.min(ballSpawnCount(st), ballCap - st.balls.length));
        var spawnCols = ballSpawnColumns(st, spawnN);
        for(var bs=0; bs<spawnCols.length; bs++){
          // Wide boards spawn a bounded batch across row 1 instead of sending
          // every hazard down the two center diagonals. hops:0 means a fresh
          // ball still cannot kill until it settles at least once.
          var sc0 = spawnCols[bs];
          st.balls.push({r:1,c:sc0,t:0,fr:1,fc:sc0,hops:0,kind:(Math.random()<0.5)?'red':'green'});
        }
      }
    }
    for(var b=st.balls.length-1;b>=0;b--){
      var bl=st.balls[b];
      bl.t += dt*3.0;
      if(bl.t>=1){
        bl.fr=bl.r; bl.fc=bl.c;
        bl.r+=1; bl.c += (Math.random()<0.5)?1:0;
        bl.t=0; bl.hops=(bl.hops||0)+1;
        if(bl.r>=st.ROWS){ st.balls.splice(b,1); continue; }
      }
      var pf=cubePos(bl.fr,bl.fc), pt=cubePos(bl.r,bl.c);
      var bx=pf.x+(pt.x-pf.x)*bl.t;
      var by=pf.y+(pt.y-pf.y)*bl.t - Math.sin(bl.t*Math.PI)*U*3 - topH;
      ctx.pyramidActors.balls.push({x:bx, y:by, kind:bl.kind});
      // collision: ball shares Pyramid's cube while both are at rest.
      // a just-spawned ball (hops<1) can't kill on its spawn cube.
      if(st.alive && !st.onDisc && !st.falling && st.respawn<=0 && (bl.hops||0)>=1 &&
         bl.r===st.qr && bl.c===st.qc && st.hopT>=1){
        killPyramid();
      }
    }

    // ---- Coily: hatches from an egg, then chases Pyramid ----
    var co=st.coily;
    if(!st.win && st.alive){
      if(!co.active){
        st.coilyT -= dt;
        if(st.coilyT<=0 && st.respawn<=0){
          var coStart=rowCenter(st,0);
          co.active=true; co.egg=true; co.hatch=0; co.r=0; co.c=coStart; co.t=1; co.fr=0; co.fc=coStart;
          SND.fx('growl');
        }
      } else {
        if(co.egg){
          // egg bounces down a couple rows then hatches into the snake
          co.t += dt*3.0;
          if(co.t>=1){
            co.fr=co.r; co.fc=co.c;
            if(co.r+1<st.ROWS){ co.r+=1; co.c += (Math.random()<0.5)?1:0; if(co.c>=st.cubes[co.r].length)co.c=st.cubes[co.r].length-1; }
            co.t=0; co.hatch++;
            if(co.hatch>=2){ co.egg=false; SND.fx('growl',-4); EVENT('state', 6, {name:'danger', on:true}); }
          }
        } else {
          // snake hops toward Pyramid (purple chaser) - slightly slower than Pyramid
          // so a skilled player can keep ahead and lure it onto a disc
          co.t += dt*(2.2 + st.level*0.15);
          if(co.t>=1){
            co.fr=co.r; co.fc=co.c;
            var nr=co.r, nc=co.c;
            if(co.r < st.qr){ nr=co.r+1; nc=co.c+(st.qc>co.c?1:0); }
            else if(co.r > st.qr){ nr=co.r-1; nc=co.c-(st.qc<co.c?1:0); }
            else { if(st.qc>co.c){ nr=co.r+1; nc=co.c+1; } else if(st.qc<co.c){ nr=co.r+1; nc=co.c; } else { nr=co.r-1; nc=co.c; } }
            if(nr<0)nr=0; if(nr>=st.ROWS)nr=st.ROWS-1;
            if(nc<0)nc=0; if(nc>=st.cubes[nr].length)nc=st.cubes[nr].length-1;
            co.r=nr; co.c=nc; co.t=0;
            st.growlT -= 1;
            if(st.growlT<=0){ SND.fx('growl', -2); st.growlT=2; }
          }
          // caught? (Coily shares Pyramid's cube while Pyramid is at rest)
          if(st.alive && !st.onDisc && !st.falling && st.respawn<=0 &&
             co.r===st.qr && co.c===st.qc && st.hopT>=1){
            killPyramid();
          }
        }
      }
    }
    // draw Coily / egg
    if(co.active && !st.win){
      var cf=cubePos(co.fr,co.fc), ct=cubePos(co.r,co.c);
      var ccx=cf.x+(ct.x-cf.x)*co.t;
      var ccy=cf.y+(ct.y-cf.y)*co.t - Math.sin(co.t*Math.PI)*U*5;
      ctx.pyramidActors.coily = {co:co, x:ccx, y:ccy};
    }

    // death helper
    function killPyramid(){
      if(!st.alive || st.onDisc || st.falling) return;
      st.alive=false; st.falling=true; st.fallT=0;
      var fp=cubePos(st.qr,st.qc);
      st.fallX=fp.x; st.fallY=fp.y-topH-U*4;
      st.fallVX=(Math.random()<0.5?-1:1)*U*6;
      st.shake = Math.max(st.shake, 0.9+energy*0.4);
      SND.fx('fall');
      st.flash=Math.max(st.flash,0.5);
      EVENT('major', 9);
      // chase ends on death; enemies are cleared on respawn
      if(st.coily.active && !st.coily.egg) EVENT('state', 5, {name:'danger', on:false});
    }

    // ===================================================================
    // FAILURE animation + respawn
    // ===================================================================
    if(st.falling){
      st.fallT += dt;
      st.fallX += st.fallVX*dt;
      st.fallY += (U*30)*st.fallT*dt*6;
      ctx.pyramidActors.falling = true;
      if(st.fallT>0.8){
        st.falling=false;
        st.lives--;
        if(st.lives<0){
          // game over -> full reset of the board & lives
          st.lives=(st.v===1?4:3); st.score=0; st.level=1;
          for(var rr3=0;rr3<st.ROWS;rr3++)
            for(var cc3=0;cc3<st.cubes[rr3].length;cc3++) st.cubes[rr3][cc3]=0;
        }
        // respawn at apex; clear enemies briefly and restore the rescue discs
        var respawnCol=rowCenter(st,0);
        st.qr=0; st.qc=respawnCol; st.hopr=0; st.hopc=respawnCol; st.hopT=1; st.qhopH=0; st.toDiscIdx=0;
        st.alive=true; st.respawn=0.8;
        st.balls=[]; st.coily={r:0,c:respawnCol,t:1,fr:0,fc:respawnCol,active:false,egg:true,hatch:0};
        st.discs=[ {side:-1,used:false,rot:0}, {side:1,used:false,rot:0} ];
        st.coilyT=(st.v===1?3.2:2.2); st.ballGate=1.0; st.aiT=0.4;
      }
    }
    if(st.respawn>0) st.respawn=Math.max(0, st.respawn-dt);

    // ===================================================================
    // Pyramid draw (when alive and not falling)
    // ===================================================================
    ctx.pyramidActors.pyramid = true;

    // (HUD removed — the target-colour swatch + progress bar were UI clutter; the music video reads cleaner without them.)

    // ===================================================================
    // flash overlay (skip while winning - the win block owns flash then)
    // ===================================================================
    qView.dt = dt;
    ctx.pyramidActors.flash = st.flash > 0;
  
  }

  return {
    makeState: makeState,
    update: update
  };
})();

(function(){
  VisualizerGame.layer('pyramid', 'definition', {
    packVersion: 3,
    key: "pyramid",
    name: "PYRAMID",
    family: "isometric hop",
    description: "Isometric cube board with color flips, discs, balls, and Coily pressure.",
    source: "physical-pack-definition",
    entities: [
      "pyramid",
      "cube",
      "coily",
      "ball",
      "disc",
      "spark",
      "scoreText",
      "boardShadow"
    ],
    rules: [
      "diagonal hops",
      "cube color state",
      "enemy fall paths",
      "disc escape",
      "collision avoidance",
      "board completion",
      "round reset"
    ],
    events: [
      "cubeFlipped",
      "enemyNear",
      "discUsed",
      "enemyFell",
      "boardCleared",
      "hop"
    ],
    simulation: {
      timestep: "fixed by shared runtime; game code clamps large dt locally",
      collision: "owned by PyramidDefinition.update and PyramidBehavior helpers",
      musicKnowledge: "normalized ctx.audio only; no raw bus reads",
      watchdog: { mode:"board-completion", progress:60, motion:14, loop:16 }
    },
    make: PyramidDefinition.makeState,
    update: PyramidDefinition.update
  });
})();
