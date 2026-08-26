// PLATFORMER definition: level nouns, platform rules, collision, scoring, and events.
// No drawing and no raw audio reads live in this layer.
(function(){
  var M = {};

  M.W = 256;
  M.H = 224;
  M.T = 16;
  M.GROUND_Y = 192;
  M.PHYS = {
    // Normalized from SMB-style physics for this 256x224 canvas: fast run,
    // strong skid, variable jump hold, and a much heavier released/falling arc.
    walkCap: 122,
    runCap: 190,
    accel: 1080,
    skidAccel: 1840,
    releaseDecel: 900,
    jumpMin: 318,
    jumpRunBonus: 52,
    holdGravity: 900,
    releaseGravity: 2300,
    fallGravity: 2600,
    terminalFall: 640,
    stompBounce: 224
  };

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function overlap(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function addEvent(st, type, detail){
    if(!st.events) st.events = [];
    if(st.events.length < 64) st.events.push({ type:type, detail:detail || null });
  }
  function hash01(a, b, c){
    var n = (Math.imul(a || 1, 374761393) ^ Math.imul((b || 0) + 1, 668265263) ^ Math.imul((c || 0) + 1, 2246822519)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function segmentRand(st, i, salt){
    return hash01((st.seed || 1) + (st.level || 0) * 4099, i || 0, salt || 0);
  }
  function choose(arr, r){
    return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
  }
  var COURSE_THEMES = ['outdoor', 'underground', 'castle'];
  function themeIndex(theme){
    var idx = COURSE_THEMES.indexOf(theme);
    return idx < 0 ? 0 : idx;
  }
  function themeForVariant(variant){
    return COURSE_THEMES[((variant || 0) % COURSE_THEMES.length + COURSE_THEMES.length) % COURSE_THEMES.length];
  }
  function courseThemeForGoal(type){
    if(type === 'castle') return 'castle';
    if(type === 'pipe') return 'underground';
    return 'outdoor';
  }
  function pickGoalType(st, segmentIndex){
    var types = ['flag', 'castle', 'pipe'];
    var allowed = [];
    for(var i=0;i<types.length;i++) if(types[i] !== st.lastExitType) allowed.push(types[i]);
    var picked = choose(allowed.length ? allowed : types, segmentRand(st, segmentIndex, 31));
    st.lastExitType = picked;
    return picked;
  }
  var ENEMY_PAIRS = [
    ['walker', 'shell'],
    ['shell', 'beetle'],
    ['walker', 'spiker'],
    ['beetle', 'spiker']
  ];
  function enemyPair(st){
    return ENEMY_PAIRS[((st.level || 0) % ENEMY_PAIRS.length + ENEMY_PAIRS.length) % ENEMY_PAIRS.length];
  }
  function enemyConfig(type){
    if(type === 'shell') return { w:16, h:22, vx:-30, stompable:true };
    if(type === 'spiker') return { w:16, h:16, vx:-34, stompable:false };
    if(type === 'beetle') return { w:16, h:14, vx:-28, stompable:true };
    return { w:16, h:16, vx:-36, stompable:true };
  }
  function addEntity(st, type, role, ref){
    if(!st.entities) st.entities = [];
    if(st.entities.length < 96) st.entities.push({ type:type, role:role, ref:ref || null });
  }
  function groundCovers(st, x){
    for(var i=0;i<st.ground.length;i++){
      var g0 = st.ground[i];
      if(x >= g0.x && x <= g0.x + g0.w) return true;
    }
    return false;
  }
  function addGround(st, x, w){
    if(w <= 0) return;
    st.ground.push({ x:x, y:M.GROUND_Y, w:w, h:M.H - M.GROUND_Y + 48, kind:'ground' });
  }
  function nearestEnemyDistance(st, x){
    var d = Infinity;
    for(var i=0;i<st.enemies.length;i++){
      var e = st.enemies[i];
      if(e.gone || e.squash > 0) continue;
      d = Math.min(d, Math.abs(e.x - x));
    }
    return d;
  }
  function enemySpawnClear(st, x, w, h){
    var body={x:x,y:M.GROUND_Y-h,w:w,h:h};
    if(!groundCovers(st,x+w*0.5))return false;
    var i,o;
    for(i=0;i<st.blocks.length;i++){o=st.blocks[i];if(!o.broken&&overlap(body,o))return false;}
    for(i=0;i<st.pipes.length;i++){o=st.pipes[i];if(overlap(body,o))return false;}
    return true;
  }
  function safeEnemyX(st, x, w, h){
    var offsets=[0,18,-18,36,-36,54,-54,72,-72],i,candidate;
    for(i=0;i<offsets.length;i++){
      candidate=x+offsets[i];
      if(nearestEnemyDistance(st,candidate)>=54&&enemySpawnClear(st,candidate,w,h))return candidate;
    }
    return null;
  }
  function addEnemy(st, x, type){
    if(st.enemies.length >= 64) return;
    var pair = enemyPair(st);
    type = type || pair[Math.floor(segmentRand(st, st.segmentIndex || 0, 50 + st.enemies.length * 3) * pair.length) % pair.length];
    var cfg = enemyConfig(type);
    x=safeEnemyX(st,x,cfg.w,cfg.h);
    if(x==null)return;
    st.enemies.push({
      id:++st.nextObjId,
      type:type, role:'counter',
      x:x, y:M.GROUND_Y - cfg.h, w:cfg.w, h:cfg.h,
      vx:cfg.vx, vy:0, dir:-1, squash:0, gone:false, step:0,
      stompable:cfg.stompable
    });
  }
  function addCoin(st, x, y, phase){
    if(st.coins.length >= 180) return;
    st.coins.push({ id:++st.nextObjId, type:'coin', role:'lead', x:x, y:y, w:8, h:14, got:false, pop:0, phase:phase || 0 });
  }
  function addCoins(st, x, y, count, mode){
    count = clamp(count || 3, 1, 8);
    for(var i=0;i<count;i++){
      var yy = y;
      if(mode === 'arc') yy = y - Math.sin((i / Math.max(1, count - 1)) * Math.PI) * 26;
      else if(mode === 'rise') yy = y - i * 5;
      else if(mode === 'fall') yy = y - (count - 1 - i) * 5;
      addCoin(st, x + i * 16, yy, i * 0.17);
    }
  }
  // Star pickup: pops up out of a question block, then falls, bounces along the ground and drifts
  // forward until the hero catches it (grants the 7s invincible star state). Role 'lead' so it rides
  // the same audio bus as coins.
  function addStar(st, x, y){
    if(!st.stars) st.stars = [];
    if(st.stars.length >= 24) return;
    st.stars.push({ id:++st.nextObjId, type:'star', role:'lead', x:x, y:y, w:14, h:14, vx:52, vy:-180, got:false, pop:0 });
  }
  function addBlockRow(st, x, y, count, qEvery){
    count = clamp(count || 2, 1, 12);
    for(var i=0;i<count;i++){
      st.blocks.push({
        id:++st.nextObjId,
        type:(qEvery && i % qEvery === 0) ? 'question' : 'brick',
        role:'perc',
        x:x + i * 16, y:y, w:16, h:16,
        used:false, bump:0
      });
    }
  }
  function addPipe(st, x, heightTiles){
    heightTiles = clamp(heightTiles || 3, 2, 3);
    st.pipes.push({
      type:'pipe', role:'bass',
      x:x, y:M.GROUND_Y - heightTiles * 16, w:32, h:heightTiles * 16
    });
  }
  function addGoal(st, x, type){
    if(!st.goals || st.goals.length >= 12) return;
    st.goals.push({
      type:type || 'flag',
      role:'world',
      x:x,
      y:M.GROUND_Y - 64,
      w:type === 'pipe' ? 32 : 28,
      h:64,
      triggered:false
    });
  }
  function addStairs(st, x, count){
    count = clamp(count || 3, 2, 4);
    for(var i=0;i<count;i++){
      for(var h=0;h<=i;h++){
        st.blocks.push({ id:++st.nextObjId, type:'woodBlock', role:'bass', x:x + i * 16, y:M.GROUND_Y - (h + 1) * 16, w:16, h:16, used:false, bump:0 });
      }
    }
  }
  function addBlockBridge(st, x, y, count){
    count = clamp(count || 7, 5, 12);
    for(var i=0;i<count;i++){
      var type = (i === 1 || i === count - 2) ? 'question' : 'brick';
      st.blocks.push({ id:++st.nextObjId, type:type, role:'perc', x:x + i * 16, y:y, w:16, h:16, used:false, bump:0 });
    }
  }
  function addBlockStack(st, x, y, count){
    count = clamp(count || 6, 5, 10);
    addBlockBridge(st, x, y, count);
    if(count >= 6){
      for(var i=1;i<count-1;i+=2){
        st.blocks.push({ id:++st.nextObjId, type:'brick', role:'perc', x:x + i * 16, y:y - 16, w:16, h:16, used:false, bump:0 });
      }
    }
  }
  function addBlockPlatform(st, x, y, count){
    count = clamp(count || 7, 5, 10);
    for(var i=0;i<count;i++){
      var q = (i === 0 || i === count - 1 || (count > 7 && i === Math.floor(count * 0.5)));
      st.blocks.push({ id:++st.nextObjId, type:q ? 'question' : 'brick', role:'perc', x:x + i * 16, y:y, w:16, h:16, used:false, bump:0 });
    }
    if(count > 6){
      st.blocks.push({ id:++st.nextObjId, type:'brick', role:'perc', x:x + 32, y:y - 16, w:16, h:16, used:false, bump:0 });
      st.blocks.push({ id:++st.nextObjId, type:'brick', role:'perc', x:x + (count - 3) * 16, y:y - 16, w:16, h:16, used:false, bump:0 });
    }
  }
  function addDecor(st, x, kind){
    if(st.decor.length >= 80) return;
    var phase = hash01((st.seed || 1), Math.floor(x), kind === 'cloud' ? 7 : kind === 'hill' ? 11 : 13) * 6.28;
    st.decor.push({ type:kind, role:kind === 'cloud' ? 'noise' : 'world', x:x, y:0, phase:phase });
  }

  M.addSegment = function(st){
    var i = st.segmentIndex++;
    var x = st.nextX;
    if(i > 0 && i % 12 === 0){
      addGround(st, x, 560);
      addCoins(st, x + 32, M.GROUND_Y - 52, 5, 'line');
      addGoal(st, x + 168, pickGoalType(st, i));
      st.nextX = x + 592;
      return;
    }
    // Enemy-dense pool: the widened viewport shows much more world, so enemies must be FREQUENT or the hero
    // scrolls past empty ground (owner: "platformer doesn't face any enemies"). 'enemy' is now ~1/3 of segments.
    var pool = ['enemy','coins','gap','pipe','enemy','blocks','enemy','coins','pipeBlocks','enemy','gap','coins','blockBridge','enemy','blockPlatform','steps','blockStack'];
    var kind = i < 2 ? 'flat' : choose(pool, segmentRand(st, i, 1));
    if(i>=2&&i%8===5)kind='gap';
    if(kind === st.lastKind) kind = choose(pool, segmentRand(st, i, 2));
    if((kind === 'steps') && i - (st.lastStepsIndex || -99) < 5) kind = segmentRand(st, i, 3) < 0.5 ? 'blocks' : 'pipe';
    if(kind === 'gap' && st.lastKind === 'gap') kind = 'coins';
    if(kind === 'steps') st.lastStepsIndex = i;
    st.lastKind = kind;

    var lead = 64 + Math.floor(segmentRand(st, i, 4) * 4) * 16;
    var body = 128 + Math.floor(segmentRand(st, i, 5) * 4) * 16;

    var decorKind = segmentRand(st, i, 6) < 0.22 ? 'hill' : (segmentRand(st, i, 7) < 0.58 ? 'cloud' : 'bush');
    addDecor(st, x + 36 + Math.floor(segmentRand(st, i, 8) * 5) * 18, decorKind);
    if(segmentRand(st, i, 45) < 0.62){
      addDecor(st, x + 30 + Math.floor(segmentRand(st, i, 46) * 7) * 18, 'cloud');
    }

    if(kind === 'gap'){
      addGround(st, x, lead);
      var gapW = 24 + Math.floor(segmentRand(st, i, 20) * 3) * 8;
      addGround(st, x + lead + gapW, body);
      addCoins(st, x + lead - 8, M.GROUND_Y - 48, 4, 'arc');
      st.nextX = x + lead + gapW + body;
      return;
    }

    addGround(st, x, lead + body);

    if(kind === 'pipe'){
      addPipe(st, x + lead + 24, 2 + Math.floor(segmentRand(st, i, 10) * 2));
      addCoins(st, x + lead + 68, M.GROUND_Y - 54, 3, 'line');
    } else if(kind === 'coins'){
      var mode = choose(['line','arc','rise','fall'], segmentRand(st, i, 11));
      addCoins(st, x + lead, M.GROUND_Y - 42 - Math.floor(segmentRand(st, i, 12) * 3) * 8, 4 + Math.floor(segmentRand(st, i, 13) * 4), mode);
    } else if(kind === 'enemy'){
      var pair = enemyPair(st);
      addEnemy(st, x + lead + 18, pair[0]);
      addEnemy(st, x + lead + 82, pair[1]);                                   // always a pair now
      if(segmentRand(st, i, 14) < 0.55) addEnemy(st, x + lead + 146, pair[0]); // often a third
      addCoins(st, x + lead + 44, M.GROUND_Y - 58, 3, 'arc');
    } else if(kind === 'blocks'){
      addBlockRow(st, x + lead + 8, M.GROUND_Y - 64, 6 + Math.floor(segmentRand(st, i, 15) * 5), 4);
      addCoins(st, x + lead + 16, M.GROUND_Y - 88, 5 + Math.floor(segmentRand(st, i, 16) * 4), 'line');
    } else if(kind === 'blockBridge'){
      addBlockBridge(st, x + lead + 4, M.GROUND_Y - 64, 6 + Math.floor(segmentRand(st, i, 22) * 5));
      addCoins(st, x + lead + 12, M.GROUND_Y - 92, 6 + Math.floor(segmentRand(st, i, 23) * 3), 'arc');
    } else if(kind === 'blockStack'){
      addBlockStack(st, x + lead, M.GROUND_Y - 64, 6 + Math.floor(segmentRand(st, i, 24) * 4));
      addCoins(st, x + lead + 18, M.GROUND_Y - 108, 5, 'line');
    } else if(kind === 'blockPlatform'){
      addBlockPlatform(st, x + lead + 2, M.GROUND_Y - 64, 6 + Math.floor(segmentRand(st, i, 25) * 4));
      addCoins(st, x + lead + 18, M.GROUND_Y - 104, 5 + Math.floor(segmentRand(st, i, 26) * 3), 'arc');
    } else if(kind === 'pipeBlocks'){
      addPipe(st, x + lead + 8, 2);
      addBlockRow(st, x + lead + 58, M.GROUND_Y - 64, 5 + Math.floor(segmentRand(st, i, 17) * 4), 4);
      addCoins(st, x + lead + 62, M.GROUND_Y - 90, 5, 'arc');
    } else if(kind === 'steps'){
      addStairs(st, x + lead + 12, 2 + Math.floor(segmentRand(st, i, 18) * 2));
      addCoins(st, x + lead + 74, M.GROUND_Y - 70, 3 + Math.floor(segmentRand(st, i, 19) * 2), 'fall');
    } else {
      addCoins(st, x + lead, M.GROUND_Y - 44, 3, 'line');
    }

    st.nextX = x + lead + body;
  };

  M.ensureAhead = function(st){
    while(st.nextX < Math.max(st.platformer.x, st.cameraX || 0) + (st.nativeW || M.W) + 1044) M.addSegment(st);
  };
  // Enemy director: seeded enemy segments alone can leave the hero with nothing to face (wide viewport +
  // variable scroll speed). Guarantee >=2 live enemies in the near-ahead window, spawning fresh ones just
  // off the right edge (they walk left into view). addEnemy's anti-cluster + 64 cap still apply.
  M.ensureEnemiesAhead = function(st){
    var vw = st.nativeW || M.W, lo = st.cameraX, hi = st.cameraX + vw + 520, near = 0, i, e;
    for(i=0;i<st.enemies.length;i++){ e = st.enemies[i]; if(!e.gone && !(e.squash > 0) && e.x >= lo && e.x <= hi) near++; }
    if(near >= 2) return;
    var pair = enemyPair(st), edge = st.cameraX + vw + 28;
    st._enemyDir = (st._enemyDir || 0) + 1;
    addEnemy(st, edge, pair[st._enemyDir % pair.length]);
    if(near < 1) addEnemy(st, edge + 74, pair[(st._enemyDir + 1) % pair.length]);
  };

  M.solidRects = function(st, minX, maxX){
    var out = [];
    for(var i=0;i<st.ground.length;i++){
      var g0 = st.ground[i];
      if(g0.x + g0.w >= minX && g0.x <= maxX) out.push(g0);
    }
    for(i=0;i<st.blocks.length;i++){
      var b = st.blocks[i];
      if(b.broken) continue;
      if(b.x + b.w >= minX && b.x <= maxX) out.push(b);
    }
    for(i=0;i<st.pipes.length;i++){
      var p = st.pipes[i];
      if(p.x + p.w >= minX && p.x <= maxX) out.push(p);
    }
    return out;
  };

  M.lookAhead = function(st){
    var m = st.platformer;
    var base = m.x + m.w + Math.max(24, Math.abs(m.vx) * 0.34);
    var out = { gap:Infinity, gapWidth:0, landing:Infinity, wall:Infinity, enemy:Infinity, block:Infinity, pipe:Infinity };
    for(var d=18; d<=106; d+=8){
      if(!groundCovers(st, base + d)){
        out.gap = d;
        for(var d2=d; d2<=170; d2+=8){
          if(groundCovers(st, base + d2)){
            out.gapWidth = d2 - d;
            out.landing = d2;
            break;
          }
        }
        break;
      }
    }
    var body = { x:m.x + m.w, y:m.y + 4, w:94, h:m.h - 6 };
    var solids = M.solidRects(st, m.x, m.x + 126);
    for(var i=0;i<solids.length;i++){
      var s = solids[i];
      if(s.kind === 'ground') continue;
      var ahead = s.x - (m.x + m.w);
      if(ahead < 0 || ahead > 112) continue;
      if(s.type === 'pipe') out.pipe = Math.min(out.pipe, ahead);
      else if(overlap(body, s)) out.wall = Math.min(out.wall, ahead);
    }
    for(i=0;i<st.blocks.length;i++){
      var b = st.blocks[i], bd = b.x - m.x;
      if(b.broken || (b.type === 'question' && b.used)) continue;
      if(bd > 0 && bd < 80 && b.y < m.y) out.block = Math.min(out.block, bd);
    }
    for(i=0;i<st.enemies.length;i++){
      var e = st.enemies[i];
      if(e.gone || e.squash > 0) continue;
      var ed = e.x - (m.x + m.w);
      if(ed > -8 && ed < 94) out.enemy = Math.min(out.enemy, ed);
    }
    return out;
  };

  M.make = function(A, U, variant){
    var initialTheme = themeForVariant(variant || 0);
    var st = {
      pack:'platformer',
      variant:variant || 0,
      courseTheme:initialTheme,
      t:0,
      nativeW:A&&A.h?Math.max(1,Math.round(M.H*A.w/A.h)):M.W,
      nativeH:M.H,
      seed:0x51f15 + (variant || 0) * 997,
      groundY:M.GROUND_Y,
      segmentIndex:0,
      nextX:128,
      cameraX:0,
      lastKind:null,
      lastStepsIndex:-99,
      lastExitType:null,
      pendingCourseTheme:null,
      goalEntry:null,
      events:[],
      entities:[],
      nextObjId:0,
      ground:[],
      blocks:[],
      pipes:[],
      coins:[],
      stars:[],
      enemies:[],
      decor:[],
      goals:[],
      level:0,
      fanfare:0,
      music:{ speedBias:1, phraseFamily:0, skyHue:0, beatScale:1, coinHop:0, enemyHop:0, cloudHop:0, blockPulse:0 },
      intent:{ left:false, right:true, jump:false, jumpHeld:false, speedBias:1 },
      platformer:{ type:'platformer', role:'perc', x:24, y:M.GROUND_Y - 24, w:14, h:24, vx:0, vy:0, dir:1, onGround:false, run:0, jumpWasDown:false, hurt:0, star:0, hidden:false, pose:'run' },
      score:0
    };
    addGround(st, -256, 560);
    addDecor(st, 28, 'hill');
    addDecor(st, 86, 'bush');
    addDecor(st, 172, 'cloud');
    addDecor(st, 232, 'cloud');
    M.ensureAhead(st);
    return st;
  };

  function hitBlock(st, block){
    if(!block || block.kind === 'ground' || block.type === 'pipe' || block.bump > 0.01 || block.broken) return;
    block.bump = 1;
    addEvent(st, 'blockHit', { x:block.x, type:block.type });
    if(block.type === 'question' && !block.used){
      block.used = true;
      // Usually a coin pops out; occasionally a star (deterministic per block).
      if(hash01(st.seed || 1, Math.floor(block.x), (block.id || 0) + 7) < 0.17){
        addStar(st, block.x + 1, block.y - 16);
        st.score += 1000;
        addEvent(st, 'starSpawned', { x:block.x, y:block.y });
      } else {
        addCoin(st, block.x + 4, block.y - 18, 0);
        st.coins[st.coins.length - 1].pop = 1;
        st.score += 100;
        addEvent(st, 'coinCollected', { source:'block' });
      }
    } else if(block.type === 'brick'){
      block.broken = true;
      block.bump = 0;
      st.score += 10;
      addEvent(st, 'brickBroken', { x:block.x, y:block.y });
    }
  }

  function moveAxis(st, axis, amount){
    var m = st.platformer;
    if(!amount) return;
    var rects = M.solidRects(st, m.x - 40, m.x + 96);
    if(axis === 'x'){
      m.x += amount;
      for(var i=0;i<rects.length;i++){
        var r = rects[i];
        if(!overlap(m, r)) continue;
        if(amount > 0) m.x = r.x - m.w;
        else m.x = r.x + r.w;
        m.vx = 0;
      }
    } else {
      var prevY = m.y;
      m.y += amount;
      m.onGround = false;
      for(i=0;i<rects.length;i++){
        r = rects[i];
        if(!overlap(m, r)) continue;
        if(amount > 0){
          m.y = r.y - m.h;
          m.vy = 0;
          m.onGround = true;
        } else {
          m.y = r.y + r.h;
          m.vy = 0;
          hitBlock(st, r);
        }
      }
      if(!m.onGround && prevY + m.h <= M.GROUND_Y && m.y + m.h >= M.GROUND_Y && groundCovers(st, m.x + m.w * 0.5)){
        m.y = M.GROUND_Y - m.h;
        m.vy = 0;
        m.onGround = true;
      }
    }
  }

  function respawnAfterPit(st){
    var m = st.platformer;
    M.ensureAhead(st);
    var best = null;
    for(var i=0;i<st.ground.length;i++){
      var gr = st.ground[i];
      if(gr.x > m.x + 8 && gr.w >= 48 && (!best || gr.x < best.x)) best = gr;
    }
    m.x = best ? best.x + 24 : st.cameraX + Math.min(132, Math.max(28, st.nativeW * 0.52));
    m.y = M.GROUND_Y - m.h;
    m.vx = Math.max(118, Math.abs(m.vx || 0));
    m.vy = 0;
    m.onGround = true;
    st.cameraX = Math.max(0, m.x - Math.min(118, Math.max(24, st.nativeW * 0.46)));
    addEvent(st, 'sectionLooped', { reason:'fall', respawnX:m.x });
  }

  function startNextCourse(st){
    var keepScore = st.score || 0;
    var nextTheme = st.pendingCourseTheme || 'outdoor';
    var nextVariant = themeIndex(nextTheme);
    st.variant = nextVariant;
    st.courseTheme = nextTheme;
    st.seed = 0x51f15 + nextVariant * 997 + ((st.level || 0) + 1) * 4099;
    st.segmentIndex = 0;
    st.nextX = 128;
    st.cameraX = 0;
    st.lastKind = null;
    st.lastStepsIndex = -99;
    st.nextObjId = 0;
    // Object ids restart with the course, so every autopilot memory keyed by id must be dropped
    // here or a stale enemy lock / ignore entry silently re-binds to a brand-new object.
    st.aiEnemyLockId = null; st.aiEnemyLockT = null; st.aiEnemyLockDir = 0;
    st.aiEnemyIgnore = null; st.aiCollectIgnore = null; st.aiObjective = null;
    st.ground.length = 0;
    st.blocks.length = 0;
    st.pipes.length = 0;
    st.coins.length = 0;
    if(st.stars) st.stars.length = 0;
    st.enemies.length = 0;
    st.decor.length = 0;
    st.goals.length = 0;
    st.level = (st.level || 0) + 1;
    st.fanfare = 0;
    st.pendingCourseTheme = null;
    st.goalEntry = null;
    st.score = keepScore;
    st.platformer.x = 24;
    st.platformer.y = M.GROUND_Y - st.platformer.h;
    st.platformer.vx = 118;
    st.platformer.vy = 0;
    st.platformer.onGround = true;
    st.platformer.jumpWasDown = false;
    st.platformer.star = 0;
    st.platformer.hidden = false;
    addGround(st, -256, 560);
    if(nextTheme === 'outdoor'){
      addDecor(st, 28, 'hill');
      addDecor(st, 86, 'bush');
      addDecor(st, 172, 'cloud');
      addDecor(st, 232, 'cloud');
    }
    M.ensureAhead(st);
    addEvent(st, 'courseStarted', { variant:nextVariant, theme:nextTheme, level:st.level });
  }

  function updateGoals(st, dt){
    var m = st.platformer;
    if(st.fanfare > 0){
      st.fanfare -= dt;
      if(st.goalEntry){
        st.goalEntry.t += dt;
        if(st.goalEntry.type === 'castle'){
          var doorX = st.goalEntry.x + 18;
          m.vx = m.x < doorX ? 62 : 0;
          if(m.x >= doorX - 1){
            m.x = doorX;
            m.hidden = st.goalEntry.t > 0.48;
          }
        } else if(st.goalEntry.type === 'pipe'){
          var pipeX = st.goalEntry.x + 9;
          m.vx = 0;
          m.x += (pipeX - m.x) * clamp(dt * 7, 0, 1);
          if(st.goalEntry.t > 0.22){
            m.y += 46 * dt;
            m.hidden = st.goalEntry.t > 0.78;
          }
        } else {
          m.vx = Math.max(m.vx, 96);
        }
      } else {
        m.vx = Math.max(m.vx, 96);
      }
      if(st.fanfare <= 0) startNextCourse(st);
      return;
    }
    for(var i=0;i<st.goals.length;i++){
      var goal = st.goals[i];
      if(goal.triggered) continue;
      if(m.x + m.w >= goal.x + 8){
        goal.triggered = true;
        st.fanfare = 1.35;
        st.pendingCourseTheme = courseThemeForGoal(goal.type);
        st.goalEntry = { type:goal.type, x:goal.x, t:0 };
        m.vx = Math.max(m.vx, 132);
        addEvent(st, 'levelComplete', { type:goal.type, x:goal.x, variant:st.variant });
        break;
      }
    }
  }

  function updateEnemies(st, dt){
    var solids, i, e;
    M.ensureEnemiesAhead(st);   // keep enemies coming regardless of scroll speed / seed sparsity
    for(i=0;i<st.enemies.length;i++){
      e = st.enemies[i];
      if(e.gone) continue;
      if(e.squash > 0){
        e.squash -= dt;
        if(e.squash <= 0) e.gone = true;
        continue;
      }
      if(e.x < st.cameraX - 160 || e.x > st.cameraX + st.nativeW + 260) continue;
      e.step += dt * (5 + Math.abs(e.vx || 0) * 0.18);
      e.vy += 900 * dt;
      var nextX=e.x+e.vx*dt,footX=nextX+(e.vx<0?2:e.w-2);
      if(e.y+e.h>=M.GROUND_Y-2&&!groundCovers(st,footX)){
        e.vx*=-1;e.dir=e.vx<0?-1:1;nextX=e.x+e.vx*dt;
      }
      e.x=nextX;
      solids = M.solidRects(st, e.x - 28, e.x + 44);
      for(var s=0;s<solids.length;s++){
        var r = solids[s];
        if(r.kind === 'ground') continue;
        if(overlap(e, r)){
          if(e.vx < 0) e.x = r.x + r.w;
          else e.x = r.x - e.w;
          e.vx *= -1;
          e.dir=e.vx<0?-1:1;
        }
      }
      for(s=0;s<solids.length;s++){
        r=solids[s];
        if(r.kind==='ground'||!overlap(e,r))continue;
        var left=r.x-e.w-1,right=r.x+r.w+1;
        e.x=groundCovers(st,left+e.w*.5)?left:right;
        e.vx=(e.x<r.x?-1:1)*Math.max(18,Math.abs(e.vx||0));e.dir=e.vx<0?-1:1;
        st.enemyUnstucks=(st.enemyUnstucks||0)+1;
      }
      e.y += e.vy * dt;
      if(groundCovers(st, e.x + e.w * 0.5) && e.y + e.h >= M.GROUND_Y){
        e.y = M.GROUND_Y - e.h;
        e.vy = 0;
      }
      if(e.y > M.H + 80) e.gone = true;
    }
  }

  function updatePlatformerEnemyContacts(st){
    var m = st.platformer;
    for(var i=0;i<st.enemies.length;i++){
      var e = st.enemies[i];
      if(e.gone || e.squash > 0) continue;
      if(!overlap(m, e)) continue;
      // Star power: touching ANY enemy instantly kills it and Platformer takes no damage.
      if(m.star > 0){
        e.squash = 0.36;
        st.score += 200;
        addEvent(st, 'enemyStomped', { x:e.x, star:true });
        continue;
      }
      var foot = m.y + m.h;
      var stomp = m.vy > 0 && foot >= e.y - 5 && foot <= e.y + Math.min(14, e.h * 0.82) && m.y < e.y;
      if(stomp && e.stompable !== false){
        e.squash = 0.36;
        m.vy = -M.PHYS.stompBounce;
        m.onGround = false;
        st.score += 100;
        addEvent(st, 'enemyStomped', { x:e.x });
      } else {
        m.hurt = 0.6;
        m.vx = -90;
        m.vy = -210;
        addEvent(st, 'playerHurt', { x:m.x });
      }
    }
  }

  function updateCoins(st, dt){
    var m = st.platformer;
    for(var i=st.coins.length-1;i>=0;i--){
      var c = st.coins[i];
      if(c.got){
        c.pop += dt * 2.4;
        c.y -= 70 * dt;
        if(c.pop > 1.1) st.coins.splice(i,1);
        continue;
      }
      if(c.pop > 0){
        c.pop += dt * 2.6;
        c.y -= 64 * dt;
        if(c.pop > 1.0) st.coins.splice(i,1);
        continue;
      }
      if(overlap(m, c)){
        c.got = true;
        c.pop = 0.2;
        st.score += 50;
        addEvent(st, 'coinCollected', { x:c.x, y:c.y });
      } else if(c.x < st.cameraX - 96) {
        st.coins.splice(i,1);
      }
    }
  }

  function updateStars(st, dt){
    if(!st.stars || !st.stars.length) return;
    var m = st.platformer;
    var mx = m.x + m.w * 0.5, my = m.y + m.h * 0.5;
    for(var i=st.stars.length-1;i>=0;i--){
      var s = st.stars[i];
      if(s.got){
        s.pop += dt * 2.4;
        s.y -= 62 * dt;
        if(s.pop > 1.1) st.stars.splice(i,1);
        continue;
      }
      // Homing star: a gentle magnet toward Platformer so he always catches it — works no matter if
      // the star is above/below or ahead/behind. The star's velocity EASES toward a vector aimed
      // at Platformer (never a teleport), so the initial pop-out arc is still visible before it curves
      // in, and it seeks a little harder the farther it is so it reliably closes the gap. Terrain
      // is ignored on purpose (a magic star can't get wedged behind a block or stuck on the floor).
      var dx = mx - (s.x + s.w * 0.5);
      var dy = my - (s.y + s.h * 0.5);
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var homeSpeed = 190 + Math.min(150, dist * 0.85);
      var desiredVx = dx / dist * homeSpeed;
      var desiredVy = dy / dist * homeSpeed;
      var steer = Math.min(1, 4.0 * dt);   // per-frame turn toward Platformer: lively seek, not instant
      s.vx += (desiredVx - s.vx) * steer;
      s.vy += (desiredVy - s.vy) * steer;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if(overlap(m, s)){
        s.got = true; s.pop = 0.2;
        st.score += 1000;
        m.star = Math.max(m.star || 0, 7.0);   // 7 seconds of invincibility
        addEvent(st, 'starCollected', { x:s.x, y:s.y });
        continue;
      }
      if(s.x < st.cameraX - 200 || s.y > M.H + 160) st.stars.splice(i,1);
    }
  }

  function pruneWorld(st){
    var min = st.cameraX - 360;
    function keep(o){ return !o.gone && o.x + (o.w || 32) > min; }
    st.ground = st.ground.filter(keep);
    st.blocks = st.blocks.filter(function(o){ return keep(o) && !o.broken; });
    st.pipes = st.pipes.filter(keep);
    st.enemies = st.enemies.filter(keep);
    st.stars = (st.stars || []).filter(keep);
    st.goals = st.goals.filter(keep);
    st.decor = st.decor.filter(function(d){ return d.x > min; });
  }

  M.syncEntities = function(st){
    st.entities.length = 0;
    addEntity(st, 'platformer', 'perc', st.platformer);
    addEntity(st, 'ground', 'bass', st.ground[0] || null);
    if(st.coins[0]) addEntity(st, 'coin', 'lead', st.coins[0]);
    if(st.stars && st.stars[0]) addEntity(st, 'star', 'lead', st.stars[0]);
    if(st.enemies[0]) addEntity(st, 'enemy', 'counter', st.enemies[0]);
    if(st.decor[0]) addEntity(st, 'cloud', 'noise', st.decor[0]);
    if(st.goals && st.goals[0]) addEntity(st, 'levelGoal', 'world', st.goals[0]);
    addEntity(st, 'palette', 'world', null);
    addEntity(st, 'paletteAccent', 'drop', null);
  };

  M.update = function(ctx){
    var st = ctx.state, dt = clamp(ctx.dt || 0.016, 0, 0.05);
    if(!st || !st.platformer) return;
    st.t += dt;
    st.events.length = 0;
    st.humanActive = !!(ctx.IN && ctx.IN.active);

    var audio = ctx.audio || {};
    if(audio.paused){
      st.idleT = (st.idleT || 0) + dt;
      M.syncEntities(st);
      return;
    }

    M.ensureAhead(st);

    var m = st.platformer;
    var wasGrounded = !!m.onGround;
    var intent = st.intent || {};
    var speedBias = clamp((st.music && st.music.speedBias) || intent.speedBias || 1, 0.82, 1.34);
    var P = M.PHYS;
    var starBoost = m.star > 0 ? 1.3 : 1;   // star state: noticeably faster
    var maxRun = P.runCap * speedBias * starBoost;
    var accel = P.accel * speedBias * starBoost;
    var skid = P.skidAccel;
    var friction = P.releaseDecel;
    var dir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);

    if(dir){
      var rate = (dir > 0 && m.vx < 0) || (dir < 0 && m.vx > 0) ? skid : accel;
      m.vx += dir * rate * dt;
      m.vx = clamp(m.vx, -maxRun, maxRun);
      m.dir = dir;
    } else if(m.vx > 0) {
      m.vx = Math.max(0, m.vx - friction * dt);
    } else if(m.vx < 0) {
      m.vx = Math.min(0, m.vx + friction * dt);
    }
    if(st.fanfare > 0 && !(st.goalEntry && st.goalEntry.type !== 'flag')) m.vx = clamp(m.vx, 82, 112);

    var jumpNow = !!intent.jump && !m.jumpWasDown;
    if(jumpNow && m.onGround){
      var runLift = clamp(Math.abs(m.vx) / Math.max(1, maxRun), 0, 1);
      m.vy = -(P.jumpMin + runLift * P.jumpRunBonus);
      m.onGround = false;
      addEvent(st, 'jumpStarted', { x:m.x, run:runLift });
    }
    m.jumpWasDown = !!intent.jump;

    var gravity = m.vy < 0
      ? (intent.jumpHeld ? P.holdGravity : P.releaseGravity)
      : P.fallGravity;
    m.vy += gravity * dt;
    m.vy = clamp(m.vy, -420, P.terminalFall);

    moveAxis(st, 'x', m.vx * dt);
    moveAxis(st, 'y', m.vy * dt);
    if(!wasGrounded && m.onGround) addEvent(st, 'landing', { x:m.x, speed:Math.abs(m.vx) });

    if(m.onGround && Math.abs(m.vx) > 8) m.run += dt * Math.abs(m.vx) / 18;
    if(m.hurt > 0) m.hurt -= dt;
    if(m.star > 0){ m.star -= dt; if(m.star <= 0){ m.star = 0; addEvent(st, 'starEnded', {}); } }

    if(m.y > M.H + 60){
      respawnAfterPit(st);
    }

    updateEnemies(st, dt);
    updatePlatformerEnemyContacts(st);
    updateCoins(st, dt);
    updateStars(st, dt);
    updateGoals(st, dt);
    for(var bi=0; bi<st.blocks.length; bi++) if(st.blocks[bi].bump > 0) st.blocks[bi].bump = Math.max(0, st.blocks[bi].bump - dt * 5.2);

    var screenX = m.x - (st.cameraX || 0);
    var baseAnchor = Math.min(108, Math.max(28, st.nativeW * 0.38));
    var anchor = baseAnchor + Math.sin((st.t || 0) * 0.42) * Math.min(18, st.nativeW * 0.08);
    if(screenX > Math.min(154, st.nativeW * 0.62)) anchor = Math.min(124, Math.max(24, st.nativeW * 0.5));
    else if(screenX < Math.min(72, st.nativeW * 0.29)) anchor = Math.min(86, Math.max(20, st.nativeW * 0.35));
    var target = m.x - anchor;
    if(target < 0) target = 0;
    st.cameraX += (target - st.cameraX) * Math.min(1, dt * 7.5);
    if(st.cameraX < 0) st.cameraX = 0;

    pruneWorld(st);
    M.syncEntities(st);
  };

  VisualizerGame.layer('platformer', 'definition', {
    packVersion: 2,
    key: 'platformer',
    name: 'Platformer-style side-scrolling platformer',
    family: 'side-scrolling platformer',
    description: 'Fast autonomous platform run with readable NES-scale tiles, pipes, blocks, moving enemies, coin routes, real pits, and grounded jump arcs.',
    entities: ['platformer','ground','coin','star','enemy','questionBlock','brick','pipe','stairBlock','cloud','hill','bush','levelGoal','palette','paletteAccent'],
    rules: ['run acceleration','brief safe coin backtracking','grounded single jump','variable jump height','solid tile collision','enemy wall and ledge avoidance','enemy stomp','coin collection','block hit','camera follow','pit avoidance and safe respawn','level endpoint transition'],
    events: ['jumpStarted','landing','coinCollected','starSpawned','starCollected','starEnded','enemyStomped','blockHit','playerHurt','sectionLooped','levelComplete','courseStarted'],
    performance: { maxCoins:180, maxEnemies:64, maxBlocks:180, maxDecor:80 },
    physics: M.PHYS,
    update: M.update
  });

  if(typeof window !== 'undefined') window.PlatformerDefinition = M;
  else this.PlatformerDefinition = M;
})();
