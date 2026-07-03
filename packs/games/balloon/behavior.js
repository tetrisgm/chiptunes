// BALLOON FIGHT autonomous behavior. Chooses intent; does not draw or mutate rules.
(function(){
  const H = VisualizerGame.helpers;

  function clamp(v, lo, hi){ return H.clamp(v, lo, hi); }
  function nearestCollectible(st, p){
    let best = null, bestScore = 1e9;
    const cam = st.cameraX || 0;
    for(let i=0;i<st.collectibles.length;i++){
      const b = st.collectibles[i];
      if(!b || b.got) continue;
      const dx = b.x - p.x;
      if(st.mode === 'trip' && dx < -20) continue;
      const dy = b.y - p.y;
      const forwardBias = st.mode === 'trip' ? Math.max(0, -dx) * 8 : 0;
      const score = Math.abs(dx) * 1.1 + Math.abs(dy) * 1.8 + forwardBias - (b.strength || 0) * 18;
      if(score < bestScore){ bestScore = score; best = b; }
    }
    if(best) return best;
    if(st.mode === 'fight'){
      for(let i=0;i<st.enemies.length;i++){
        const e = st.enemies[i];
        if(!e || !e.alive) continue;
        const score = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 1.3;
        if(score < bestScore){ bestScore = score; best = { x:e.x, y:e.y - 16, hunt:true }; }
      }
    }
    return best;
  }
  function dangerPush(st, p){
    let pushX = 0, pushY = 0, danger = 0;
    const scan = st.hazards || [];
    for(let i=0;i<scan.length;i++){
      const h = scan[i];
      if(!h || !h.alive) continue;
      const dx = h.x - p.x, dy = h.y - p.y, d = Math.sqrt(dx*dx + dy*dy) || 1;
      if(d > 54) continue;
      const w = (54 - d) / 54;
      pushX -= dx / d * w;
      pushY -= dy / d * w;
      danger = Math.max(danger, w);
    }
    for(let i=0;i<st.enemies.length;i++){
      const e = st.enemies[i];
      if(!e || !e.alive) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.sqrt(dx*dx + dy*dy) || 1;
      if(d > 42) continue;
      const w = (42 - d) / 42;
      pushX -= dx / d * w * 0.55;
      pushY -= dy / d * w * 0.35;
      danger = Math.max(danger, w * 0.7);
    }
    if(st.fish && st.fish.active){
      const fx = st.cameraX + st.fish.x;
      const dx = fx - p.x, dy = st.fish.y - p.y, d = Math.sqrt(dx*dx + dy*dy) || 1;
      if(d < 58){
        const w = (58 - d) / 58;
        pushX -= dx / d * w * 1.2;
        pushY -= dy / d * w * 0.8;
        danger = Math.max(danger, w);
      }
    }
    return { x:pushX, y:pushY, danger };
  }
  function manualIntent(ctx){
    const input = ctx.IN || {};
    return {
      steer:(input.right?1:0) - (input.left?1:0),
      flap:!!(input.up || input.action),
      target:null,
      manual:true,
      reason:'input'
    };
  }
  function update(ctx){
    const st = ctx.state;
    if(!st || st.pack !== 'balloon' || !st.player) return;
    if(ctx.IN && ctx.IN.active){
      st.intent = manualIntent(ctx);
      return;
    }
    const p = st.player;
    const music = st.music || {};
    const target = nearestCollectible(st, p);
    const avoid = dangerPush(st, p);
    let goalX, goalY;
    if(target){
      goalX = target.x;
      goalY = target.y - (target.hunt ? 4 : 0);
    } else if(st.mode === 'trip'){
      goalX = st.cameraX + 96 + Math.sin(st.t * 0.37) * 28;
      goalY = 82 + Math.sin(st.t * 0.6) * 30;
    } else {
      goalX = 128 + Math.sin(st.t * 0.52) * 56;
      goalY = 80 + Math.sin(st.t * 0.7) * 34;
    }
    goalX += avoid.x * 42;
    goalY += avoid.y * 35;
    const safeTop = 24, safeBottom = st.waterY - 38;
    goalY = clamp(goalY, safeTop, safeBottom);
    let dx = goalX - p.x;
    let dy = goalY - p.y;
    let steer = clamp(dx / 46, -1, 1);
    if(st.mode === 'trip'){
      const leftBand = st.cameraX + 44;
      const rightBand = st.cameraX + 172;
      if(p.x < leftBand) steer = Math.max(steer, 0.55);
      if(p.x > rightBand) steer = Math.min(steer, -0.45);
    }
    const altitudeUrgency = clamp((dy < 0 ? -dy / 34 : -dy / 70), -0.6, 1.1);
    const beatLift = (music.beat || 0) * 0.18 + (music.leadEnergy || 0) * 0.12;
    const flap = dy < -5 || avoid.danger > 0.62 || p.y > safeBottom - 8 || altitudeUrgency + beatLift > 0.55;
    st.intent = {
      steer,
      flap,
      target:target ? { x:target.x, y:target.y, type:target.type || (target.hunt ? 'enemy' : 'collectible') } : null,
      danger:avoid.danger,
      reason:target ? (target.hunt ? 'enemy' : 'collectible') : 'patrol'
    };
  }

  const BalloonBehavior = {
    packVersion:2,
    key:'balloon',
    goals:['collect balloons','avoid bombs','avoid fish','bounce enemies','stay readable on screen'],
    update
  };

  VisualizerGame.layer('balloon', 'behavior', BalloonBehavior);
  (typeof window !== 'undefined' ? window : globalThis).BalloonBehavior = BalloonBehavior;
})();
