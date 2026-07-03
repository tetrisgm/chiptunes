// BALLOON FIGHT pack definition. Owns nouns, rules, collision, and progress.
(function(){
  const H = VisualizerGame.helpers;
  const W = 256, HGT = 224;
  const BALLOON_COLORS = ['#fc5454','#3cbcfc','#fcfc54','#54fc54','#fc54fc','#54fcfc'];
  const SLOT_Y = [44, 62, 82, 104, 126, 148];

  function rootObj(){
    return typeof window !== 'undefined' ? window : globalThis;
  }
  function clamp(v, lo, hi){ return H.clamp(v, lo, hi); }
  function box(o){
    return { x:o.x - (o.w || 10) / 2, y:o.y - (o.h || 10) / 2, w:o.w || 10, h:o.h || 10 };
  }
  function emit(ctx, type, detail){
    if(ctx && typeof ctx.emit === 'function') ctx.emit(type, detail || null);
  }
  function addBurst(st, x, y, col, n){
    n = Math.min(10, n || 5);
    for(let i=0;i<n && st.effects.length<96;i++){
      const a = st.rng.range(0, Math.PI * 2);
      st.effects.push({
        x, y, vx:Math.cos(a) * st.rng.range(14, 58), vy:Math.sin(a) * st.rng.range(12, 48),
        ttl:st.rng.range(0.22, 0.55), age:0, col:col || '#ffffff', size:st.rng.range(1, 2.8)
      });
    }
  }
  function resetPlayer(st, x){
    st.player.x = x == null ? st.cameraX + 62 : x;
    st.player.y = 68;
    st.player.vx = 18;
    st.player.vy = -12;
    st.player.balloons = Math.max(1, st.player.balloons || 2);
    st.player.inv = 1.2;
    st.player.state = 'fly';
    st.player.flapGap = 0;
  }
  function spawnStars(st){
    st.stars.length = 0;
    for(let i=0;i<26;i++){
      st.stars.push({
        x:st.rng.range(0, W),
        y:st.rng.range(10, 150),
        phase:st.rng.range(0, Math.PI * 2),
        size:st.rng.range(0.6, 1.6),
        twinkle:st.rng.range(0.6, 1.8)
      });
    }
  }
  function platform(x, y, w){
    return { x, y, w, h:8, type:'platform', alive:true };
  }
  function makeEnemy(st, x, y, i){
    return {
      id:'enemy-' + i,
      type:'enemy',
      x, y, w:13, h:22,
      vx:st.rng.range(-18, 18),
      vy:st.rng.range(-8, 8),
      face:1,
      balloons:2,
      phase:st.rng.range(0, Math.PI * 2),
      col:BALLOON_COLORS[(i + 1) % BALLOON_COLORS.length],
      alive:true,
      hit:0
    };
  }
  function setupFight(st){
    st.mode = 'fight';
    st.cameraX = 0;
    st.worldX = 0;
    st.frontier = W;
    st.stageLength = W;
    st.platforms = [
      platform(54, 82, 46),
      platform(168, 94, 48),
      platform(92, 134, 48),
      platform(202, 150, 40)
    ];
    st.collectibles.length = 0;
    st.hazards.length = 0;
    st.enemies.length = 0;
    for(let i=0;i<6;i++){
      st.enemies.push(makeEnemy(st, 42 + (i % 3) * 74 + st.rng.range(-10, 10), 44 + Math.floor(i / 3) * 46, i));
    }
    for(let i=0;i<7;i++){
      addCollectible(st, 32 + i * 32, 42 + Math.sin(i * 0.8) * 20 + (i % 2) * 18, BALLOON_COLORS[i % BALLOON_COLORS.length], i / 6, 0.55);
    }
    addHazard(st, 76, 118);
    addHazard(st, 184, 72);
    st.fish = { x:W * 0.5, y:st.waterY + 28, vy:0, active:false, phase:0, alive:true };
    resetPlayer(st, 70);
  }
  function setupTrip(st){
    st.mode = 'trip';
    st.worldX = 0;
    st.cameraX = 0;
    st.frontier = 190;
    st.stageLength = 2500 + st.rng.int(0, 5) * 180;
    st.platforms.length = 0;
    st.enemies.length = 0;
    st.collectibles.length = 0;
    st.hazards.length = 0;
    st.fish = { x:W * 0.5, y:st.waterY + 28, vy:0, active:false, phase:0, alive:true };
    resetPlayer(st, 58);
    while(st.frontier < 860) spawnTripCluster(st);
  }
  function chooseNextMode(st, from){
    if(from === 'trip') setupFight(st);
    else setupTrip(st);
    st.stage++;
  }
  function addCollectible(st, x, y, col, pitch, strength){
    st.collectibles.push({
      id:'balloon-' + st.nextId++,
      type:'collectible',
      x, y, baseY:y,
      w:12, h:16,
      col,
      pitch:pitch || 0.5,
      strength:strength || 0.4,
      phase:st.rng.range(0, Math.PI * 2),
      got:false,
      pulse:0
    });
  }
  function addHazard(st, x, y){
    st.hazards.push({
      id:'bomb-' + st.nextId++,
      type:'bomb',
      x, y, baseY:y,
      w:12, h:12,
      phase:st.rng.range(0, Math.PI * 2),
      pulse:0,
      alive:true
    });
  }
  function spawnTripCluster(st){
    const music = st.music || {};
    const idx = st.clusterIndex++;
    const energy = clamp(music.energy == null ? 0.35 : music.energy, 0, 1);
    const pitch = clamp(music.leadHi == null ? st.rng.range(0.2, 0.8) : music.leadHi, 0, 1);
    const slot = clamp(Math.round((1 - pitch) * (SLOT_Y.length - 1)) + st.rng.int(-1, 1), 0, SLOT_Y.length - 1);
    const baseY = SLOT_Y[slot];
    const count = 6 + Math.round(energy * 7) + st.rng.int(0, 2);
    const dx = 18 + st.rng.range(0, 5);
    const pattern = idx % 5;
    const dir = idx % 2 ? 1 : -1;
    const x0 = st.frontier + st.rng.range(8, 26);
    const col = BALLOON_COLORS[(idx + Math.round(pitch * 5)) % BALLOON_COLORS.length];
    for(let i=0;i<count;i++){
      let y = baseY;
      if(pattern === 1) y += Math.sin(i * 0.65) * 11;
      else if(pattern === 2) y += dir * i * 3.5;
      else if(pattern === 3) y -= Math.sin(i / Math.max(1, count - 1) * Math.PI) * 18 * dir;
      else if(pattern === 4) y += (i % 2 ? 7 : -7);
      addCollectible(st, x0 + i * dx, clamp(y, 32, st.waterY - 34), col, pitch, 0.45 + energy * 0.45);
    }
    const hazardLane = clamp(baseY + (baseY < 92 ? 55 : -50) + st.rng.range(-10, 10), 38, st.waterY - 28);
    if(st.rng.chance(0.35 + energy * 0.35)){
      const n = 2 + Math.round(energy * 3);
      for(let i=0;i<n;i++) addHazard(st, x0 + dx * (1.2 + i * 2.2), hazardLane + Math.sin(i) * 9);
    }
    st.frontier = x0 + count * dx + 90 + st.rng.range(0, 80);
  }
  function updateEffects(st, dt){
    for(let i=st.effects.length-1;i>=0;i--){
      const e = st.effects[i];
      e.age += dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy += 38 * dt;
      if(e.age >= e.ttl) st.effects.splice(i, 1);
    }
  }
  function updateFish(ctx, dt){
    const st = ctx.state, p = st.player, fish = st.fish;
    if(!fish) return;
    fish.phase += dt * (1.5 + (st.music ? st.music.bass : 0));
    const dx = p.x - (st.cameraX + fish.x);
    if(!fish.active && Math.abs(dx) < 36 && p.y > st.waterY - 48 && st.rng.chance(0.018 + (st.music ? st.music.bass * 0.04 : 0))){
      fish.active = true;
      fish.x = p.x - st.cameraX;
      fish.y = st.waterY + 24;
      fish.vy = -118;
      emit(ctx, 'fishLunged', { x:p.x, y:p.y });
    }
    if(fish.active){
      fish.y += fish.vy * dt;
      fish.vy += 150 * dt;
      if(fish.y > st.waterY + 26) fish.active = false;
      if(Math.abs((st.cameraX + fish.x) - p.x) < 15 && Math.abs(fish.y - p.y) < 18 && p.inv <= 0){
        p.balloons = Math.max(0, p.balloons - 1);
        p.inv = 1.1;
        addBurst(st, p.x, p.y, '#54fcfc', 8);
        emit(ctx, 'pop', { source:'fish' });
      }
    }
  }
  function playerPhysics(ctx, dt){
    const st = ctx.state, p = st.player, input = ctx.IN || {}, intent = st.intent || {};
    const music = st.music || {};
    const manual = !!input.active;
    let steer = manual ? ((input.right?1:0) - (input.left?1:0)) : (intent.steer || 0);
    let wantsFlap = manual ? !!(input.up || input.action) : !!intent.flap;
    p.inv = Math.max(0, p.inv - dt);
    p.flapGap = Math.max(0, p.flapGap - dt);
    p.vx += steer * 94 * dt;
    p.vx *= Math.pow(0.08, dt);
    p.vx = clamp(p.vx, -54, 68);
    if(wantsFlap && p.flapGap <= 0){
      p.vy -= 74 + (p.balloons > 1 ? 14 : 0);
      p.flap = 1;
      p.flapGap = 0.16;
      emit(ctx, 'flap', { x:p.x, y:p.y });
    }
    p.flap = Math.max(0, p.flap - dt * 6);
    p.vy += (86 - (p.balloons > 1 ? 14 : 0)) * dt;
    p.vy -= (music.beat || 0) * 10 * dt;
    p.vy *= Math.pow(0.18, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if(st.mode === 'trip'){
      const minX = st.cameraX + 22, maxX = st.cameraX + 198;
      if(p.x < minX){ p.x = minX; p.vx = Math.max(8, p.vx); }
      if(p.x > maxX){ p.x = maxX; p.vx = Math.min(-6, p.vx); }
    } else {
      if(p.x < 18){ p.x = 18; p.vx = Math.max(0, p.vx); }
      if(p.x > W - 18){ p.x = W - 18; p.vx = Math.min(0, p.vx); }
    }
    if(p.y < 20){ p.y = 20; p.vy = Math.max(6, p.vy); }
    if(p.y > st.waterY - 12){
      addBurst(st, p.x, st.waterY, '#54fcfc', 10);
      emit(ctx, 'splash', { x:p.x, y:st.waterY });
      resetPlayer(st, st.mode === 'trip' ? st.cameraX + 56 : 70);
    }
  }
  function updateTrip(ctx, dt){
    const st = ctx.state;
    const music = st.music || {};
    const tempo = clamp((music.bpm || 132) / 132, 0.65, 1.85);
    const speed = (46 + (music.energy || 0.35) * 28) * tempo;
    st.worldX += speed * dt;
    st.cameraX = st.worldX;
    while(st.frontier < st.worldX + 620 && st.frontier < st.stageLength + 380) spawnTripCluster(st);
    for(let i=st.collectibles.length-1;i>=0;i--){
      const b = st.collectibles[i];
      b.pulse = Math.max(0, b.pulse - dt * 4);
      b.y = b.baseY + Math.sin(st.t * 3.2 + b.phase) * (1.6 + (music.leadEnergy || 0) * 3);
      if(b.x < st.cameraX - 90 || b.got) st.collectibles.splice(i, 1);
    }
    for(let i=st.hazards.length-1;i>=0;i--){
      const h = st.hazards[i];
      h.pulse = Math.max(0, h.pulse - dt * 4);
      h.y = h.baseY + Math.sin(st.t * 3.8 + h.phase) * (2 + (music.percEnergy || 0) * 4);
      if(h.x < st.cameraX - 90 || !h.alive) st.hazards.splice(i, 1);
    }
    if(st.worldX > st.stageLength){
      emit(ctx, 'levelComplete', { mode:'trip', stage:st.stage });
      chooseNextMode(st, 'trip');
    }
  }
  function updateFight(ctx, dt){
    const st = ctx.state, p = st.player, music = st.music || {};
    let alive = 0;
    for(let i=0;i<st.enemies.length;i++){
      const e = st.enemies[i];
      if(!e.alive) continue;
      alive++;
      e.hit = Math.max(0, e.hit - dt * 5);
      e.phase += dt * 3;
      const away = Math.abs(e.x - p.x) < 28 && Math.abs(e.y - p.y) < 24 ? (e.x < p.x ? -1 : 1) : 0;
      e.vx += (away * 40 + Math.sin(st.t * 0.9 + i) * 14) * dt;
      e.vx = clamp(e.vx, -34, 34);
      e.vy += (Math.sin(st.t * 1.4 + i * 1.7) * 25 - 6 - (music.counterEnergy || 0) * 12) * dt;
      e.vy += 52 * dt;
      e.vy = clamp(e.vy, -40, 38);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if(e.x < 18 || e.x > W - 18){ e.vx *= -1; e.x = clamp(e.x, 18, W - 18); }
      if(e.y < 26){ e.y = 26; e.vy = 10; }
      if(e.y > st.waterY - 16){ e.y = st.waterY - 16; e.vy = -34; }
      e.face = e.vx >= 0 ? 1 : -1;
    }
    if(alive <= 0){
      emit(ctx, 'levelComplete', { mode:'fight', stage:st.stage });
      chooseNextMode(st, 'fight');
    }
  }
  function collisions(ctx){
    const st = ctx.state, p = st.player, pr = box(p);
    for(let i=0;i<st.collectibles.length;i++){
      const b = st.collectibles[i];
      if(b.got) continue;
      if(H.rectsOverlap(pr, box(b))){
        b.got = true;
        p.balloons = Math.min(3, p.balloons + 0.15);
        st.score += 50;
        addBurst(st, b.x, b.y, b.col, 6);
        emit(ctx, 'balloonCollected', { x:b.x, y:b.y, score:st.score });
      }
    }
    for(let i=0;i<st.hazards.length;i++){
      const h = st.hazards[i];
      if(!h.alive) continue;
      if(H.rectsOverlap(pr, box(h))){
        h.alive = false;
        if(p.inv <= 0){
          p.balloons = Math.max(1, p.balloons - 1);
          p.inv = 1.0;
          p.vy -= 42;
          addBurst(st, h.x, h.y, '#fc54fc', 10);
          emit(ctx, 'pop', { source:'bomb' });
        }
      }
    }
    for(let i=0;i<st.enemies.length;i++){
      const e = st.enemies[i];
      if(!e.alive) continue;
      if(H.rectsOverlap(pr, box(e))){
        if(p.vy > e.vy || p.y < e.y - 5){
          e.balloons--;
          e.hit = 1;
          p.vy = -72;
          st.score += 100;
          emit(ctx, 'enemyBounced', { x:e.x, y:e.y });
          addBurst(st, e.x, e.y - 8, e.col, 8);
          if(e.balloons <= 0){
            e.alive = false;
            emit(ctx, 'enemyDestroyed', { x:e.x, y:e.y, score:st.score });
          }
        } else {
          p.vx += e.x < p.x ? 34 : -34;
          e.vx *= -1;
          if(p.inv <= 0){ p.inv = 0.8; p.balloons = Math.max(1, p.balloons - 0.5); }
        }
      }
    }
  }
  function make(area, unit, variant){
    const seed = 'balloon:' + (variant || 0);
    const st = {
      pack:'balloon',
      mode:'trip',
      nativeW:W,
      nativeH:HGT,
      v:variant ? 1 : 0,
      seed,
      rng:H.rng(seed),
      nextId:1,
      t:0,
      stage:1,
      score:0,
      lives:3,
      waterY:178,
      worldX:0,
      cameraX:0,
      frontier:0,
      stageLength:2400,
      clusterIndex:0,
      player:{ type:'player', x:64, y:70, w:13, h:22, vx:0, vy:0, face:1, balloons:2, inv:0, flap:0, state:'fly', flapGap:0 },
      platforms:[],
      enemies:[],
      collectibles:[],
      hazards:[],
      effects:[],
      stars:[],
      fish:null,
      intent:{ steer:0, flap:false, target:null },
      music:{ bpm:132, energy:0.35, leadEnergy:0, counterEnergy:0, percEnergy:0, bass:0, beat:0, leadHi:0.5 },
      entities:[],
      watchdog: { meaningfulProgress:true }
    };
    spawnStars(st);
    if(variant) setupTrip(st);
    else setupFight(st);
    return st;
  }
  function update(ctx){
    const st = ctx.state;
    if(!st || st.pack !== 'balloon') return;
    const dt = clamp(ctx.dt || 0, 0, 0.05);
    if(dt <= 0) return;
    st.t += dt;
    updateEffects(st, dt);
    if(ctx.audio && ctx.audio.paused){
      st.player.flap = Math.max(0, st.player.flap - dt * 4);
      return;
    }
    playerPhysics(ctx, dt);
    if(st.mode === 'trip') updateTrip(ctx, dt);
    else updateFight(ctx, dt);
    updateFish(ctx, dt);
    collisions(ctx);
  }

  const BalloonDefinition = {
    packVersion:2,
    entities:['player','enemyBalloonist','collectibleBalloon','bomb','fish','water','platform','star','particle'],
    events:['flap','balloonCollected','enemyBounced','enemyDestroyed','fishLunged','splash','pop','levelComplete'],
    manifest:{
      key:'balloon',
      name:'BALLOON FIGHT',
      version:2,
      scene:'aerial balloon chase and trip',
      entities:['player','enemyBalloonist','collectibleBalloon','bomb','fish','water','platform','star','particle'],
      events:['flap','balloonCollected','enemyBounced','enemyDestroyed','fishLunged','splash','pop','levelComplete']
    },
    watchdog:{ mode:'scroll', progress:26, motion:12, loop:12 },
    make,
    update,
    rules:{ update:function(){} },
    spawnTripCluster,
    resetPlayer
  };

  VisualizerGame.layer('balloon', 'definition', BalloonDefinition);
  rootObj().BalloonDefinition = BalloonDefinition;
})();
