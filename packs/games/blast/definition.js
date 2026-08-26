// BLAST pack definition. Rules, state construction, and simulation only; no canvas drawing or raw audio reads.
const BlastDefinition = (function(){
  function gridSize(A){
    A=A||{w:15,h:11};
    var base=Math.max(1,Math.min(A.w/15,A.h/11));
    var rawCols=A.w/base,rawRows=A.h/base;
    var cols=Math.max(9,Math.round(rawCols));
    var rows=Math.max(9,Math.round(rawRows));
    if(!(cols&1))cols+=rawCols<cols?-1:1;
    if(!(rows&1))rows+=rawRows<rows?-1:1;
    return {cols:cols,rows:rows};
  }
  function enemyTarget(cols, rows, variant, levelType){
    // The classic arena is 15x11. Expanded aspect-ratio layouts add playable
    // cells, so retain roughly the same encounter density instead of leaving
    // the extra field empty. Rival bombers are more expensive than monsters;
    // keep separate conservative caps for both modes.
    var base=levelType==='rivals'?3:(variant===0?3:5);
    var areaScale=Math.max(1,((cols-2)*(rows-2))/(13*9));
    var cap=levelType==='rivals'?8:12;
    return Math.min(cap,Math.max(base,Math.round(base*areaScale)));
  }
  function makeState(A, U, variant){
    var P = variant === 0
      ? { floorA:'#00a800', floorB:'#008c00',
          solidTop:'#fce0a8', solidFace:'#d8a838', solidShade:'#9c6c1c', solidEdge:'#7c500c',
          softTop:'#fc7460', softFace:'#c83c2c', softShade:'#7c1c10', softMortar:'#fcb8a8',
          border:'#006400', tint:'#f868c8', exit:'#ffd000' }
      : { floorA:'#3cbcfc', floorB:'#0078f8',
          solidTop:'#d8f8ff', solidFace:'#6890f8', solidShade:'#2038a0', solidEdge:'#101870',
          softTop:'#bcd8ff', softFace:'#6888d8', softShade:'#283878', softMortar:'#e8f4ff',
          border:'#002060', tint:'#a0f060', exit:'#ffffff' };

    var dims=gridSize(A),COLS=dims.cols,ROWS=dims.rows,c,r;
    var solid = [], soft = [];
    for(r=0;r<ROWS;r++){
      solid[r]=[]; soft[r]=[];
      for(c=0;c<COLS;c++){
        var wall = (c===0||c===COLS-1||r===0||r===ROWS-1);
        var lattice = (r%2===0 && c%2===0);
        solid[r][c] = (wall||lattice)?1:0;
        soft[r][c] = 0;
      }
    }
    // soft blocks everywhere except the spawn pocket (keeps the player free to move/retreat)
    var density = variant===0 ? 0.55 : 0.66;
    for(r=1;r<ROWS-1;r++){
      for(c=1;c<COLS-1;c++){
        if(solid[r][c]) continue;
        // OPEN spawn area: 3x3 pocket + clear run-out corridors along row 1 and column 1 (gameplay starts faster)
        if((r<=2 && c<=2) || (r===1 && c<=4) || (c===1 && r<=4)) continue;
        if(Math.random() < density) soft[r][c] = 1;
      }
    }

    var bm = { c:1, r:1, x:1, y:1, dir:1, anim:0, alive:true, lives:3, dead:0, bombMax:2 };

    // count the soft blocks just placed -> baseline for the "half destroyed" reach bonus
    var softInit = 0;
    for(r=1;r<ROWS-1;r++) for(c=1;c<COLS-1;c++) if(soft[r][c]) softInit++;

    // LEVEL TYPE: ~55% STANDARD (walking monsters) / ~45% RIVALS (3 enemy bombermen)
    var levelType = (Math.random() < 0.45) ? 'rivals' : 'standard';

    var enemies = [], tries = 0;
    var targetEnemies=enemyTarget(COLS,ROWS,variant,levelType);
    if(levelType === 'rivals'){
      var rivalTints = ['#f83800','#00b800','#a040f8'];
      while(enemies.length < targetEnemies && tries < 300){
        tries++;
        var rc = 1 + Math.floor(Math.random()*(COLS-2));
        var rr = 1 + Math.floor(Math.random()*(ROWS-2));
        if(solid[rr][rc] || soft[rr][rc]) continue;
        if(rr<4 && rc<4) continue;
        enemies.push({ kind:'bomber', c:rc, r:rr, x:rc, y:rr, dir:Math.floor(Math.random()*4),
          tint:rivalTints[enemies.length%3], wob:Math.random()*6.28, step:0, anim:0,
          bombMax:2, bombCd:0, retreat:null, holdUntil:0 });
      }
    } else {
      while(enemies.length < targetEnemies && tries < 300){
        tries++;
        var ec = 1 + Math.floor(Math.random()*(COLS-2));
        var er = 1 + Math.floor(Math.random()*(ROWS-2));
        if(solid[er][ec] || soft[er][ec]) continue;
        if(er<4 && ec<4) continue;          // not on top of player spawn
        enemies.push({ kind:'monster', c:ec, r:er, x:ec, y:er, dir:Math.floor(Math.random()*4), tint:P.tint, wob:Math.random()*6.28, step:0 });
      }
    }
    var totalEnemies = enemies.length;

    // hidden exit under a random soft block (revealed when all enemies dead AND its block is gone)
    var exitC = 1, exitR = 1, ex = 0;
    for(var et=0; et<400 && !ex; et++){
      var xc = 1+Math.floor(Math.random()*(COLS-2));
      var xr = 1+Math.floor(Math.random()*(ROWS-2));
      if(soft[xr][xc]){ exitC=xc; exitR=xr; ex=1; }
    }

    return {
      v:variant, P:P, COLS:COLS, ROWS:ROWS,
      solid:solid, soft:soft, bm:bm, enemies:enemies, totalEnemies:totalEnemies,
      levelType:levelType, softInit:softInit, powerups:[],
      lives:3, level:1, won:0,                   // top-level mirrors for external readers
      bombs:[], flames:[], sparks:[],
      exitC:exitC, exitR:exitR, exitOpen:false, winTimer:0,
      t:0, kickPulse:0, flash:0,
      // music-reactive visual state
      beatPulse:0, _lastBeat:-1, _lastPhrase:-1, phraseFlash:0, shake:0, phFam:0,
      // AI brain
      ai:{ moveCd:0, retreat:null, holdUntil:0, bombCd:0 },
      // player movement cadence (grid-step throttle for human + tap timing)
      stepCd:0, bombCd:0
    };
  
  }

  function update(ctx){
    ctx=ctx||{};
    var dt=ctx.dt, U=ctx.U, A=ctx.A, IN=ctx.IN, SND=ctx.SND, st=ctx.state;
    var wanted=gridSize(A);
    if(st.COLS!==wanted.cols||st.ROWS!==wanted.rows){
      var fresh=makeState(A,U,st.v),keepViz=st.$viz,keepT=st.t||0,keepBeat=st._lastBeat,keepPhrase=st._lastPhrase;
      for(var oldKey in st)if(oldKey!=='$viz'&&Object.prototype.hasOwnProperty.call(st,oldKey))delete st[oldKey];
      for(var newKey in fresh)if(Object.prototype.hasOwnProperty.call(fresh,newKey))st[newKey]=fresh[newKey];
      if(keepViz)st.$viz=keepViz;
      st.t=keepT;st._lastBeat=keepBeat;st._lastPhrase=keepPhrase;
    }
    if(!(dt>0)) dt = 0.016;
    if(dt>0.05) dt = 0.05;
    var P = st.P, COLS = st.COLS, ROWS = st.ROWS;
    st.t += dt;
    if(st.kickPulse>0) st.kickPulse = Math.max(0, st.kickPulse - dt*4);
    if(st.flash>0)     st.flash     = Math.max(0, st.flash - dt*3);
    if(st.shake>0)        st.shake        = Math.max(0, st.shake - dt*2.2);
    if(st.phraseFlash>0)  st.phraseFlash  = Math.max(0, st.phraseFlash - dt*2);
    if(st.stepCd>0) st.stepCd -= dt;
    if(st.bombCd>0) st.bombCd -= dt;

    // guards for safe SND/IN
    IN = IN || {};
    var keys = IN.keys || {};
    function S_fx(n,s){ if(SND&&SND.fx) SND.fx(n, s||0); }
    function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }

    // ---- MUSIC CLOCK: beat=pulse, bar=palette, phrase=variation, event=juice ----
    var audio = ctx.audio || {};
    var F = audio.raw || {};
    var cl = F.cl || {};
    var mvEnergy = MV.energy(cl), mvDrop = MV.isDrop(cl);

    var tile = Math.ceil(Math.max(A.w/COLS,A.h/ROWS));
    if(!(tile>4)) tile = 4;
    var gw = tile*COLS, gh = tile*ROWS;
    // EVENT JUICE: explosion/death shake offsets the whole arena (amplitude scales with section energy)
    var shAmp = st.shake>0 ? st.shake * (3 + tile*0.10 + 4*mvEnergy) : 0;
    var shX = shAmp ? ((Math.random()*2-1)*shAmp)|0 : 0;
    var shY = shAmp ? ((Math.random()*2-1)*shAmp)|0 : 0;
    var ox = A.x + Math.floor((A.w - gw)/2) + shX;
    var oy = A.y + Math.floor((A.h - gh)/2) + shY;
    function cellX(c){ return ox + c*tile; }
    function cellY(r){ return oy + r*tile; }

    var bm = st.bm;

    // ---------- helpers: board queries ----------
    function inBounds(c,r){ return c>=1&&r>=1&&c<COLS-1&&r<ROWS-1; }
    function blocked(c,r){
      if(c<0||r<0||c>=COLS||r>=ROWS) return true;
      return st.solid[r][c]===1 || st.soft[r][c]===1;
    }
    function bombAt(c,r){
      for(var i=0;i<st.bombs.length;i++) if(st.bombs[i].c===c && st.bombs[i].r===r) return st.bombs[i];
      return null;
    }
    function enemyAt(c,r){
      for(var i=0;i<st.enemies.length;i++) if(st.enemies[i].c===c && st.enemies[i].r===r) return st.enemies[i];
      return null;
    }
    function softAt(c,r){ return inBounds(c,r) && st.soft[r][c]===1; }
    function walkable(c,r){ return inBounds(c,r) && !blocked(c,r) && !bombAt(c,r); }

    // bomb flame reach (classic short range = 2), +1 once MORE THAN HALF the destructible blocks are gone.
    function softCount(){ var n=0; for(var rr=1;rr<ROWS-1;rr++) for(var cc=1;cc<COLS-1;cc++) if(st.soft[rr][cc]) n++; return n; }
    function curReach(){
      var base=2;
      if(st.softInit>0 && (st.softInit - softCount())/st.softInit > 0.5) base=3;
      return base;
    }

    // cells a bomb at (bc,br) will scorch (stops at solids, first soft block)
    function blastCells(bc,br){
      var reach=curReach();
      var cells=[{c:bc,r:br}];
      var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      for(var d=0;d<4;d++){
        for(var step=1;step<=reach;step++){
          var nc=bc+dirs[d][0]*step, nr=br+dirs[d][1]*step;
          if(nc<0||nr<0||nc>=COLS||nr>=ROWS) break;
          if(st.solid[nr][nc]) break;
          cells.push({c:nc,r:nr});
          if(st.soft[nr][nc]) break;
        }
      }
      return cells;
    }

    // ---------- bomb fx ----------
    function addFlame(c,r,kind){
      for(var i=0;i<st.flames.length;i++){
        if(st.flames[i].c===c && st.flames[i].r===r){ st.flames[i].life=0.45; return; }
      }
      if(st.flames.length<70) st.flames.push({c:c,r:r,life:0.45,max:0.45,kind:kind});
    }
    function emitSparks(px,py,col){
      for(var s=0;s<6;s++){
        if(st.sparks.length>=48) break;
        var a = Math.random()*6.28, spd = 30+Math.random()*60;
        st.sparks.push({x:px,y:py,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-30,life:0.4+Math.random()*0.3,col:col});
      }
    }
    // ~28% chance a destroyed soft block reveals a bomb power-up
    function maybeDropPowerup(c,r){
      if(Math.random() < 0.28){
        for(var i=0;i<st.powerups.length;i++) if(st.powerups[i].c===c && st.powerups[i].r===r) return;
        st.powerups.push({c:c, r:r});
      }
    }
    function detonate(bc,br){
      var reach=curReach();
      addFlame(bc,br,'c');
      var dirs=[[1,0,'h'],[-1,0,'h'],[0,1,'v'],[0,-1,'v']];
      for(var d=0;d<4;d++){
        for(var step=1;step<=reach;step++){
          var nc=bc+dirs[d][0]*step, nr=br+dirs[d][1]*step;
          if(nc<0||nr<0||nc>=COLS||nr>=ROWS) break;
          if(st.solid[nr][nc]) break;
          if(st.soft[nr][nc]){
            st.soft[nr][nc]=0; addFlame(nc,nr,dirs[d][2]);
            emitSparks(cellX(nc)+tile/2, cellY(nr)+tile/2, P.softFace);
            maybeDropPowerup(nc,nr);
            break;
          }
          // chain other bombs
          var ob=bombAt(nc,nr);
          if(ob && ob.t<2.3) ob.t = 2.3;
          addFlame(nc,nr,(step===reach)?'tip':dirs[d][2]);
        }
      }
      emitSparks(cellX(bc)+tile/2, cellY(br)+tile/2, '#ffd000');
      st.flash = Math.max(st.flash, 0.5);
      // EVENT JUICE: explosion shakes the arena, scaled by section energy (bigger on the drop)
      st.shake = Math.max(st.shake, (0.5 + 0.5*mvEnergy) * (mvDrop?1.5:1));
      // EXPLOSION sound: noise burst + low tom
      S_fx('blast', 0);
      S_fx('tom', 0);
      EVENT('medium', 6);          // explosion = a hit, on the 8th
      st.kickPulse = 1;
    }

    // count live bombs owned by a given owner ('p' = player, or a rival ref)
    function bombsOwnedBy(owner){
      var n=0; for(var i=0;i<st.bombs.length;i++) if(st.bombs[i].owner===owner) n++;
      return n;
    }
    // place a bomb on bomber's cell (player). caps PLAYER-owned live bombs at bm.bombMax.
    function placeBomb(){
      if(!bm.alive) return false;
      if(bombAt(bm.c,bm.r)) return false;
      if(bombsOwnedBy('p') >= bm.bombMax) return false;   // dynamic per-owner cap
      st.bombs.push({c:bm.c, r:bm.r, t:0, lastTick:-1, owner:'p'});
      bm.lastBombC=bm.c; bm.lastBombR=bm.r;               // remember WHERE -> the AI won't bomb this same spot again next time
      S_fx('fuse', 0);            // place = fuse begins
      EVENT('minor', 3);          // placing a bomb = small frequent action
      return true;
    }
    // place a bomb for a RIVAL bomber on its cell (owner = the enemy ref, own cap)
    function placeRivalBomb(en){
      if(bombAt(en.c,en.r)) return false;
      if(bombsOwnedBy(en) >= (en.bombMax||2)) return false;
      st.bombs.push({c:en.c, r:en.r, t:0, lastTick:-1, owner:en});
      S_fx('fuse', 0);
      EVENT('minor', 2);
      return true;
    }

    // step the bomber one cell (with sound). returns true if moved.
    function stepBomber(dc,dr){
      if(!bm.alive) return false;
      if(dc===0 && dr===0) return false;
      bm.dir = (dc>0?1:dc<0?3:dr>0?2:0);
      var nc=bm.c+dc, nr=bm.r+dr;
      if(!walkable(nc,nr)) return false;
      bm.c=nc; bm.r=nr;
      S_fx('step', (bm.c+bm.r)%5);
      EVENT('minor', 2);          // grid step = tiny tick
      return true;
    }

    // ---------- BFS over OPEN walkable cells ----------
    // returns full path (array of {c,r}) start..goal, or null. avoidFn(c,r)=true => cell forbidden.
    function bfs(sc,sr, goalFn, avoidFn){
      var q=[{c:sc,r:sr}], head=0;
      var seen={}; seen[sc+','+sr]=null;
      var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      var found=null, guard=0;
      while(head<q.length && guard<800){
        guard++;
        var cur=q[head++];
        if(goalFn(cur.c,cur.r)){ found=cur; break; }
        for(var d=0;d<4;d++){
          var nc=cur.c+dirs[d][0], nr=cur.r+dirs[d][1];
          var key=nc+','+nr;
          if(seen.hasOwnProperty(key)) continue;
          if(!inBounds(nc,nr)) continue;
          if(st.solid[nr][nc]) continue;
          if(st.soft[nr][nc]) continue;       // can't walk through soft (must bomb)
          if(bombAt(nc,nr)) continue;
          if(avoidFn && avoidFn(nc,nr)) continue;
          seen[key]=cur.c+','+cur.r;
          q.push({c:nc,r:nr});
        }
      }
      if(!found) return null;
      var path=[], k=found.c+','+found.r;
      while(k!==null){ var pp=k.split(','); path.push({c:+pp[0],r:+pp[1]}); k=seen[k]; }
      path.reverse();
      return path; // path[0] is start
    }

    // ---------- cost-BFS that may DIG through soft blocks ----------
    // soft block = high cost (must be bombed), but lets the AI build a gradient TOWARD a far target.
    // returns the first-step direction {dc,dr} toward the nearest goal cell, or null.
    function digStepToward(goalFn){
      var SOFT_COST=6;
      var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      var best=null, bestCost=Infinity;
      // Dijkstra (small grid) from bomber over open+soft cells.
      var dist={}, prev={};
      var key0=bm.c+','+bm.r; dist[key0]=0;
      // simple array-based PQ (grid is tiny: <=165 cells)
      var pq=[{c:bm.c,r:bm.r,d:0}], guard=0;
      while(pq.length && guard<2000){
        guard++;
        // extract min
        var mi=0; for(var i=1;i<pq.length;i++) if(pq[i].d<pq[mi].d) mi=i;
        var cur=pq.splice(mi,1)[0];
        var ck=cur.c+','+cur.r;
        if(cur.d>dist[ck]) continue;
        if(goalFn(cur.c,cur.r) && (cur.c!==bm.c||cur.r!==bm.r)){
          if(cur.d<bestCost){ bestCost=cur.d; best=ck; }
          continue; // found a goal; don't expand past it
        }
        for(var d=0;d<4;d++){
          var nc=cur.c+dirs[d][0], nr=cur.r+dirs[d][1];
          if(!inBounds(nc,nr)) continue;
          if(st.solid[nr][nc]) continue;
          if(bombAt(nc,nr) && !(nc===bm.c&&nr===bm.r)) continue;
          var stepCost = st.soft[nr][nc] ? SOFT_COST : 1;
          var nk=nc+','+nr, nd=cur.d+stepCost;
          if(!(nk in dist) || nd<dist[nk]){
            dist[nk]=nd; prev[nk]=ck; pq.push({c:nc,r:nr,d:nd});
          }
        }
      }
      if(best===null) return null;
      // walk back to the first step from bomber
      var k=best, first=null;
      while(k!==undefined && prev[k]!==undefined){
        if(prev[k]===key0){ first=k; break; }
        k=prev[k];
      }
      if(first===null) return null;
      var fp=first.split(',');
      return {dc:(+fp[0])-bm.c, dr:(+fp[1])-bm.r};
    }

    // is cell currently dangerous (live flame OR in a bomb's pending blast)?
    function dangerNow(c,r){
      for(var i=0;i<st.flames.length;i++) if(st.flames[i].c===c && st.flames[i].r===r) return true;
      for(var b=0;b<st.bombs.length;b++){
        var bo=st.bombs[b];
        var cells=blastCells(bo.c,bo.r);
        for(var k=0;k<cells.length;k++) if(cells[k].c===c && cells[k].r===r) return true;
      }
      return false;
    }
    // danger including a HYPOTHETICAL bomb placed at (bc,br)
    function dangerHypo(c,r,bc,br){
      if(dangerNow(c,r)) return true;
      var cells=blastCells(bc,br);
      for(var k=0;k<cells.length;k++) if(cells[k].c===c && cells[k].r===r) return true;
      return false;
    }
    // cell adjacent to (or on) a roaming enemy -> unsafe footing
    function enemyThreat(c,r){
      if(enemyAt(c,r)) return true;
      var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      for(var d=0;d<4;d++){ if(enemyAt(c+dirs[d][0],r+dirs[d][1])) return true; }
      return false;
    }
    // ENEMY DANGER SET: a tile an enemy occupies OR could step into on its next move.
    // (enemies only walk open floor, so a free neighbour of an enemy is "about to be occupied").
    // This is the set the hunting AI must never path INTO — stepping there is suicide.
    function enemyZone(c,r){
      if(enemyAt(c,r)) return true;                 // would collide outright
      var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      for(var d=0;d<4;d++){                          // an enemy one tile away can advance onto us
        var en=enemyAt(c+dirs[d][0], r+dirs[d][1]);
        if(en) return true;
      }
      return false;
    }

    // ---------- WIN / RESPAWN ----------
    function loseLife(){
      if(!bm.alive) return;
      bm.alive=false; bm.dead=1.1; bm.lives--; st.lives=bm.lives;
      st.ai.retreat=null; st.ai.holdUntil=0;
      S_fx('hurt', 0);
      EVENT('major', 8);          // player death = big moment
      st.flash=1;
      st.shake = Math.max(st.shake, 0.7 + 0.4*mvEnergy);
      emitSparks(cellX(bm.c)+tile/2, cellY(bm.r)+tile/2, '#ffffff');
    }
    function respawn(){
      bm.alive=true; bm.c=1; bm.r=1; bm.x=1; bm.y=1; bm.dir=1; bm.dead=0;
      st.ai.retreat=null; st.ai.holdUntil=0; st.ai.bombCd=0;
      if(bm.lives<0){ bm.lives=3; st.lives=3; rebuildBoard(); } // out of lives -> fresh board
      // clear danger around spawn so we don't instantly die on respawn
      for(var i=st.flames.length-1;i>=0;i--){ if(st.flames[i].c<=2 && st.flames[i].r<=2) st.flames.splice(i,1); }
    }
    var RIVAL_TINTS = ['#f83800','#00b800','#a040f8'];
    function nextLevel(){
      st.level++;
      rebuildBoard();
      // standard levels gain a couple extra monsters with depth; rival levels stay at 3 duelists
      if(st.levelType==='standard'){
        var add = Math.min(2, st.level-1);
        for(var a=0;a<add;a++) spawnEnemy();
      }
      st.totalEnemies = st.enemies.length;
    }
    function spawnEnemy(){
      for(var tt=0; tt<80; tt++){
        var rc=1+Math.floor(Math.random()*(COLS-2));
        var rr=1+Math.floor(Math.random()*(ROWS-2));
        if(st.solid[rr][rc]||st.soft[rr][rc]) continue;
        if(rr<4&&rc<4) continue;
        if(bombAt(rc,rr)) continue;
        if(st.levelType==='rivals'){
          st.enemies.push({kind:'bomber', c:rc,r:rr,x:rc,y:rr,dir:Math.floor(Math.random()*4),
            tint:RIVAL_TINTS[st.enemies.length%3], wob:Math.random()*6.28, step:0, anim:0,
            bombMax:2, bombCd:0, retreat:null, holdUntil:0});
        } else {
          st.enemies.push({kind:'monster', c:rc,r:rr,x:rc,y:rr,dir:Math.floor(Math.random()*4),tint:P.tint,wob:Math.random()*6.28,step:0});
        }
        return;
      }
    }
    function rebuildBoard(){
      var c,r;
      // re-pick the level TYPE on every regeneration (~55% standard / ~45% rivals)
      st.levelType = (Math.random() < 0.45) ? 'rivals' : 'standard';
      for(r=1;r<ROWS-1;r++) for(c=1;c<COLS-1;c++){
        if(st.solid[r][c]) continue;
        st.soft[r][c]=0;
        if((r<=2&&c<=2)) continue;
        if(Math.random() < (st.v===0?0.55:0.66)) st.soft[r][c]=1;
      }
      // recount destructibles -> fresh baseline for the half-destroyed reach bonus
      st.softInit=0; for(r=1;r<ROWS-1;r++) for(c=1;c<COLS-1;c++) if(st.soft[r][c]) st.softInit++;
      st.bombs.length=0; st.flames.length=0; st.sparks.length=0;
      st.powerups.length=0;                       // power-ups vanish on level reset
      st.enemies.length=0;
      var n=(st.levelType==='rivals') ? 3 : (st.v===0?3:5);
      for(var e=0;e<n;e++) spawnEnemy();
      st.totalEnemies=st.enemies.length;
      st.exitOpen=false; st.won=0; st.winTimer=0;
      st.ai.retreat=null; st.ai.holdUntil=0; st.ai.bombCd=0;
      bm.bombMax=2;                               // reset bomb cap each level
      bm.c=1; bm.r=1; bm.x=1; bm.y=1; bm.alive=true; bm.dead=0;
    }

    // ============================================================
    //  CONTROL: human (IN.active) drives; else win-seeking AI
    // ============================================================
    var human = !!IN.active;
    var dirs4=[[1,0],[-1,0],[0,1],[0,-1]];

    if(st.won>0){
      // brief victory pause, then advance
      st.winTimer -= dt;
      if(st.winTimer<=0){ nextLevel(); }
    } else if(!bm.alive){
      bm.dead -= dt;
      if(bm.dead<=0) respawn();
    } else if(human){
      // ----- HUMAN: arrows/pointer move on a grid cadence, click = bomb -----
      var dc=0, dr=0;
      if(keys.left) dc=-1; else if(keys.right) dc=1;
      else if(keys.up) dr=-1; else if(keys.down) dr=1;
      // pointer steering: head toward pointer cell if held and no key
      if(dc===0 && dr===0 && IN.down && typeof IN.lx==='number'){
        var tc=Math.round((IN.lx-ox)/tile), tr=Math.round((IN.ly-oy)/tile);
        if(tc>bm.c) dc=1; else if(tc<bm.c) dc=-1;
        else if(tr>bm.r) dr=1; else if(tr<bm.r) dr=-1;
      }
      if((dc||dr) && st.stepCd<=0){
        if(stepBomber(dc,dr)) st.stepCd=0.12;
        else { bm.dir=(dc>0?1:dc<0?3:dr>0?2:0); st.stepCd=0.08; }
      }
      // directional-only: you steer, bombs drop themselves on a relaxed cadence
      // (per-owner bomb cap still applies); a pointer tap drops one instantly.
      if(IN.click && st.bombCd<=0){ if(placeBomb()) st.bombCd=0.3; }
      else if(st.bombCd<=0){ if(placeBomb()) st.bombCd=1.1; }
    } else {
      BlastBehavior.updatePlayer({
        st:st,
        bm:bm,
        dt:dt,
        dirs4:dirs4,
        bfs:bfs,
        digStepToward:digStepToward,
        powerupStep:powerupStep,
        blastCells:blastCells,
        dangerNow:dangerNow,
        dangerHypo:dangerHypo,
        enemyZone:enemyZone,
        enemyAt:enemyAt,
        softAt:softAt,
        walkable:walkable,
        bombsOwnedBy:bombsOwnedBy,
        placeBomb:placeBomb,
        stepBomber:stepBomber
      });
    }

    // ============================================================
    //  SIMULATION: bombs tick, flames, enemies move, collisions
    // ============================================================

    // smooth visual interpolation
    var spd=12*dt;
    bm.x += (bm.c-bm.x)*Math.min(1,spd);
    bm.y += (bm.r-bm.y)*Math.min(1,spd);
    bm.anim += dt*8;

    // bombs: fuse tick-down sound, then explode
    for(var bi=st.bombs.length-1;bi>=0;bi--){
      var bo=st.bombs[bi];
      bo.t += dt;
      var tk=Math.floor(bo.t*2.5);
      if(tk!==bo.lastTick && bo.t<2.4){ bo.lastTick=tk; S_fx('fuse', tk*2); }
      if(bo.t>2.4){ st.bombs.splice(bi,1); detonate(bo.c,bo.r); }
    }

    // flames decay
    for(var fi=st.flames.length-1;fi>=0;fi--){
      st.flames[fi].life -= dt;
      if(st.flames[fi].life<=0) st.flames.splice(fi,1);
    }

    // sparks physics
    for(var si=st.sparks.length-1;si>=0;si--){
      var spk=st.sparks[si];
      spk.x+=spk.vx*dt; spk.y+=spk.vy*dt; spk.vy+=120*dt; spk.life-=dt;
      if(spk.life<=0) st.sparks.splice(si,1);
    }
    if(st.sparks.length>48) st.sparks.length=48;

    // ----- nearest reachable power-up (open-floor BFS), shared by player & rivals -----
    // returns {dc,dr} first step toward the closest power-up tile, or null. avoidFn forbids cells.
    function powerupStep(sc,sr, avoidFn){
      if(st.powerups.length===0) return null;
      var q=[{c:sc,r:sr}], head=0, seen={}; seen[sc+','+sr]=null;
      var ds=[[1,0],[-1,0],[0,1],[0,-1]], found=null, guard=0;
      function isPup(c,r){ for(var i=0;i<st.powerups.length;i++) if(st.powerups[i].c===c&&st.powerups[i].r===r) return true; return false; }
      while(head<q.length && guard<400){
        guard++; var cur=q[head++];
        if(isPup(cur.c,cur.r) && !(cur.c===sc&&cur.r===sr)){ found=cur; break; }
        for(var d=0;d<4;d++){
          var nc=cur.c+ds[d][0], nr=cur.r+ds[d][1], key=nc+','+nr;
          if(seen.hasOwnProperty(key)) continue;
          if(!inBounds(nc,nr)||st.solid[nr][nc]||st.soft[nr][nc]||bombAt(nc,nr)) continue;
          if(avoidFn && avoidFn(nc,nr)) continue;
          seen[key]=cur.c+','+cur.r; q.push({c:nc,r:nr});
        }
      }
      if(!found) return null;
      var k=found.c+','+found.r, first=null;
      while(k!==null){ if(seen[k]===sc+','+sr){ first=k; break; } k=seen[k]; }
      if(first===null) return null;
      var fp=first.split(','); return {dc:(+fp[0])-sc, dr:(+fp[1])-sr};
    }

    // enemies update: monsters roam & chase loosely; rival bombers run a survival-first duel AI
    for(var e=0;e<st.enemies.length;e++){
      var en=st.enemies[e];
      en.step -= dt;
      en.x += (en.c-en.x)*Math.min(1,spd*0.8);
      en.y += (en.r-en.y)*Math.min(1,spd*0.8);
      en.wob += dt*5;
      if(en.kind==='bomber'){ en.anim=(en.anim||0)+dt*8; updateRival(en); continue; }
      if(en.step<=0){
        var ord=[[1,0],[0,1],[-1,0],[0,-1]];
        var pref;
        if(bm.alive && Math.random()<0.35){
          var pdc=bm.c-en.c, pdr=bm.r-en.r;
          if(Math.abs(pdc)>Math.abs(pdr)) pref=[pdc>0?0:2, pdr>0?1:3, pdc>0?2:0, pdr>0?3:1];
          else pref=[pdr>0?1:3, pdc>0?0:2, pdr>0?3:1, pdc>0?2:0];
        } else {
          pref=[en.dir,(en.dir+1)%4,(en.dir+3)%4,(en.dir+2)%4];
        }
        for(var k=0;k<4;k++){
          var d=ord[pref[k]], nc=en.c+d[0], nr=en.r+d[1];
          if(!inBounds(nc,nr)) continue;
          if(st.solid[nr][nc]||st.soft[nr][nc]) continue;
          if(bombAt(nc,nr)) continue;
          en.c=nc; en.r=nr; en.dir=pref[k]; break;
        }
        en.step = 0.34 + Math.random()*0.22;
      }
    }

    // ----- RIVAL BOMBER AI: flee blast > hold escape > hunt player / seek power-up, drop own bombs -----
    function updateRival(en){
      if(en.bombCd>0) en.bombCd-=dt;
      if(en.step>0) return;                          // grid-step cadence (same throttle as monsters)
      var dirsR=[[1,0],[-1,0],[0,1],[0,-1]];
      // can this rival step onto (c,r)? open floor, no bomb, not where the player or another rival is
      function rivalFree(c,r){
        if(!inBounds(c,r)||st.solid[r][c]||st.soft[r][c]||bombAt(c,r)) return false;
        if(bm.alive && bm.c===c && bm.r===r) return false;
        for(var i=0;i<st.enemies.length;i++){ var o=st.enemies[i]; if(o!==en && o.c===c && o.r===r) return false; }
        return true;
      }
      function stepRival(dc,dr){
        var nc=en.c+dc, nr=en.r+dr;
        if(!rivalFree(nc,nr)) return false;
        // QUICKER cadence than the old 0.30-0.46s so a rival can actually keep pace with the player and
        // line up on its row/column to bomb it (still a grid-locked Blast walk, just hunting speed).
        en.c=nc; en.r=nr; en.dir=(dc>0?0:dc<0?1:dr>0?2:3); en.step=0.16+Math.random()*0.08; return true;
      }
      // does a hypothetical bomb at (en.c,en.r) leave a real escape tile? (walls-aware cross via blastCells)
      function rivalHasEscape(){
        var cells=blastCells(en.c,en.r), inBlast={};
        for(var k=0;k<cells.length;k++) inBlast[cells[k].c+','+cells[k].r]=1;
        // BFS to any tile that is not in this blast and not currently dangerous
        var q=[{c:en.c,r:en.r}], head=0, seen={}, guardE=0; seen[en.c+','+en.r]=1;
        while(head<q.length && guardE<200){
          guardE++; var cur=q[head++];
          if(!(cur.c+','+cur.r in inBlast) && !dangerNow(cur.c,cur.r) && !(cur.c===en.c&&cur.r===en.r)) return true;
          for(var d=0;d<4;d++){ var nc=cur.c+dirsR[d][0], nr=cur.r+dirsR[d][1], key=nc+','+nr;
            if(seen[key]) continue;
            if(!rivalFree(nc,nr)) continue;
            seen[key]=1; q.push({c:nc,r:nr}); }
        }
        return false;
      }
      function blastHitsPlayer(bc,br){
        if(!bm.alive) return false;
        var cells=blastCells(bc,br);
        for(var k=0;k<cells.length;k++) if(cells[k].c===bm.c && cells[k].r===bm.r) return true;
        return false;
      }
      // first step toward the nearest SAFE, free tile from which a bomb would catch the player
      // (the firing position: lined up on the player's row/column within the walls-aware blast cross).
      // BFS over the rival's own walkable grid; never routes through live danger. Returns {dc,dr} or null.
      function fireStepTowardPlayer(){
        if(!bm.alive) return null;
        var q=[{c:en.c,r:en.r}], head=0, seen={}, guardF=0; seen[en.c+','+en.r]=null;
        var found=null;
        while(head<q.length && guardF<260){
          guardF++; var cur=q[head++];
          if(blastHitsPlayer(cur.c,cur.r) && !(cur.c===en.c&&cur.r===en.r)){ found=cur; break; }
          for(var d=0;d<4;d++){ var nc=cur.c+dirsR[d][0], nr=cur.r+dirsR[d][1], key=nc+','+nr;
            if(seen.hasOwnProperty(key)) continue;
            if(!rivalFree(nc,nr) || dangerNow(nc,nr)) continue;
            seen[key]=cur.c+','+cur.r; q.push({c:nc,r:nr}); }
        }
        if(!found) return null;
        var k=found.c+','+found.r, first=null;
        while(k!==null){ if(seen[k]===en.c+','+en.r){ first=k; break; } k=seen[k]; }
        if(first===null) return null;
        var fp=first.split(','); return {dc:(+fp[0])-en.c, dr:(+fp[1])-en.r};
      }
      // flee our own freshly-placed bomb: prefer a free, non-danger tile that is OUT of the bomb's cross.
      function fleeOwnBomb(bc,br){
        var cells=blastCells(bc,br), inBlast={};
        for(var k=0;k<cells.length;k++) inBlast[cells[k].c+','+cells[k].r]=1;
        var bestD=null, bestScore=-1;
        for(var d=0;d<4;d++){ var nc=en.c+dirsR[d][0], nr=en.r+dirsR[d][1];
          if(!rivalFree(nc,nr) || dangerNow(nc,nr)) continue;
          // strongly favour leaving the cross; tie-break on opening distance from the bomb
          var sc = (inBlast[nc+','+nr]?0:100) + (Math.abs(nc-bc)+Math.abs(nr-br));
          if(sc>bestScore){ bestScore=sc; bestD=dirsR[d]; } }
        if(bestD){ stepRival(bestD[0],bestD[1]); return true; }
        return false;
      }
      var inDanger = dangerNow(en.c,en.r);

      // (1) FLEE: standing in a blast cross -> step to the safest adjacent free tile
      if(inDanger){
        var bd=null, bestSafe=-1;
        for(var d=0;d<4;d++){ var nc=en.c+dirsR[d][0], nr=en.r+dirsR[d][1];
          if(!rivalFree(nc,nr)||dangerNow(nc,nr)) continue;
          var sc=Math.abs(nc-bm.c)+Math.abs(nr-bm.r);    // any safe tile; tie-break away nothing
          if(sc>bestSafe){ bestSafe=sc; bd=dirsR[d]; } }
        if(bd){ stepRival(bd[0],bd[1]); return; }
        // no clean tile: take any free non-danger neighbour
        for(var d2=0;d2<4;d2++){ var n2c=en.c+dirsR[d2][0], n2r=en.r+dirsR[d2][1];
          if(rivalFree(n2c,n2r) && !dangerNow(n2c,n2r)){ stepRival(dirsR[d2][0],dirsR[d2][1]); return; } }
        en.step=0.18; return;
      }

      // (2) ATTACK player: a bomb dropped HERE would catch the player in its walls-aware cross AND we
      //     have spare capacity, the re-arm gate is ready, and a verified escape exists -> drop it, then FLEE
      //     our own cross. blastHitsPlayer() already encodes reach + line-up + walls, so this fires from
      //     anywhere on the player's row/column within range (not just adjacent). AGGRESSIVE on purpose.
      if(bm.alive && en.bombCd<=0 && bombsOwnedBy(en)<(en.bombMax||2)
         && blastHitsPlayer(en.c,en.r) && rivalHasEscape()){
        if(placeRivalBomb(en)){ en.bombCd=0.4;      // lively re-fire cadence (still grid/step-locked)
          // immediately flee our own bomb's cross (prefer a tile OUTSIDE the blast)
          if(!fleeOwnBomb(en.c,en.r)) en.step=0.16;
          return;
        }
      }

      // (3) HUNT — APPROACH a FIRING POSITION (top movement priority while the player lives): BFS to the
      //     nearest safe tile from which our bomb would catch the player (line up on their row/column within
      //     blast reach), then step there. This is what makes rivals genuinely threaten. Falls back to a
      //     greedy chase along the larger axis. Never steps into live danger.
      if(bm.alive){
        var fs=fireStepTowardPlayer();
        if(fs && (fs.dc||fs.dr) && rivalFree(en.c+fs.dc,en.r+fs.dr) && !dangerNow(en.c+fs.dc,en.r+fs.dr)){
          stepRival(fs.dc,fs.dr); return;
        }
        var pdc=bm.c-en.c, pdr=bm.r-en.r;
        var order = (Math.abs(pdc)>=Math.abs(pdr))
          ? [[pdc>0?1:-1,0],[0,pdr>0?1:-1],[0,pdr>0?-1:1],[pdc>0?-1:1,0]]
          : [[0,pdr>0?1:-1],[pdc>0?1:-1,0],[pdc>0?-1:1,0],[0,pdr>0?-1:1]];
        for(var h=0;h<4;h++){ var nc=en.c+order[h][0], nr=en.r+order[h][1];
          if(rivalFree(nc,nr) && !dangerNow(nc,nr)){ stepRival(order[h][0],order[h][1]); return; } }
      }

      // (4) SEEK POWER-UP — fallback only when the player can't be hunted (dead) or no approach was possible.
      var pu=powerupStep(en.c,en.r, function(c,r){ return dangerNow(c,r); });
      if(pu && (pu.dc||pu.dr)){
        var puc=en.c+pu.dc, pur=en.r+pu.dr;
        if(rivalFree(puc,pur) && !dangerNow(puc,pur)){ stepRival(pu.dc,pu.dr); return; }
      }

      // (5) WANDER: keep moving so a stuck rival doesn't sit in a future blast
      var wd=dirsR[(((st.t*3)|0)+(en.dir||0))%4];
      if(rivalFree(en.c+wd[0],en.r+wd[1]) && !dangerNow(en.c+wd[0],en.r+wd[1])){ stepRival(wd[0],wd[1]); return; }
      en.step=0.20;
    }

    // FLAME collisions: kill enemies caught in flame
    for(var fl2=0;fl2<st.flames.length;fl2++){
      var f=st.flames[fl2];
      for(var ei=st.enemies.length-1;ei>=0;ei--){
        var en2=st.enemies[ei];
        if((en2.c===f.c && en2.r===f.r) || (Math.abs(en2.x-f.c)<0.5 && Math.abs(en2.y-f.r)<0.5)){
          emitSparks(cellX(f.c)+tile/2,cellY(f.r)+tile/2,'#ffffff');
          st.enemies.splice(ei,1);
          S_fx('kill', (ei%4)*2);            // enemy death blip
          EVENT('medium', 5);                // enemy defeated = chord stab
        }
      }
      // FAILURE: bomber caught in own/any blast
      if(bm.alive && bm.c===f.c && bm.r===f.r){ loseLife(); }
    }

    // FAILURE: touched by a MONSTER (rival bombers only threaten via their bombs, not touch)
    if(bm.alive){
      for(var ec2=0;ec2<st.enemies.length;ec2++){
        var ee=st.enemies[ec2];
        if(ee.kind==='bomber') continue;
        if(Math.abs(ee.x-bm.x)<0.55 && Math.abs(ee.y-bm.y)<0.55){ loseLife(); break; }
      }
    }

    // POWER-UP PICKUP: player walks onto a power-up -> raise bomb cap (cap 6)
    if(bm.alive){
      for(var pi=st.powerups.length-1;pi>=0;pi--){
        var pu2=st.powerups[pi];
        if(pu2.c===bm.c && pu2.r===bm.r){
          st.powerups.splice(pi,1);
          bm.bombMax=Math.min(6, bm.bombMax+1);
          S_fx('kill', 0);            // small pickup chime
          EVENT('medium', 4);
          st.flash=Math.max(st.flash,0.25);
          emitSparks(cellX(bm.c)+tile/2, cellY(bm.r)+tile/2, '#ffe000');
        }
      }
    }

    // LEVEL CLEAR: all enemies dead -> celebratory beat, brief debounce, then a fresh level (#3)
    if(st.won===0 && st.totalEnemies>0 && st.enemies.length===0){
      st.won=1; st.winTimer=1.2; S_fx('win',0); S_fx('win',7); EVENT('major', 9); st.flash=1;
    }


    ctx.blastView = {
      A:A, U:U, st:st, P:P, COLS:COLS, ROWS:ROWS, tile:tile, ox:ox, oy:oy,
      mvEnergy:mvEnergy, mvDrop:mvDrop, cl:cl
    };
    return st;

  }

  var api = {
      packVersion: 3,
  key: "blast",
  name: "BLAST",
  family: "maze bombs",
  description: "Top-down block maze with bombs, flames, enemies, pickups, and safe routing.",
  source: "split-pack-definition-rules",
  manifest: {
    key: "blast",
    title: "Blast",
    layers: ["definition", "behavior", "reactions", "renderer"],
    musicReactive: true
  },
  entities: [
    "player",
    "bomb",
    "flame",
    "softBlock",
    "hardBlock",
    "enemy",
    "pickup",
    "exit",
    "spark"
  ],
  rules: [
    "tile movement",
    "bomb placement",
    "fuse countdown",
    "flame propagation",
    "block destruction",
    "enemy collision",
    "pickup collection",
    "exit reveal"
  ],
  events: [
    "bombPlaced",
    "bombExploded",
    "blockDestroyed",
    "pickupCollected",
    "enemyNear",
    "exitOpened",
    "nearMiss"
  ],
  simulation: {
    timestep: "shared runner with local dt clamp",
    collision: "definition owns maze collision and bomb blast rules",
    musicKnowledge: "normalized ctx.audio snapshot only"
  },
  watchdog: { mode: "single-objective", progress: 70, motion: 14, loop: 16 },
    makeState: makeState,
    enemyTarget: enemyTarget,
    update: update
  };
  VisualizerGame.layer('blast', 'definition', api);
  return api;
})();
