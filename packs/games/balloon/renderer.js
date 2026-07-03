// BALLOON FIGHT renderer. Draws state plus transient modifiers; owns no rules.
(function(){
  const CLOUD = [
    '..wwww..',
    '.wwwwww.',
    'wwwwwwww',
    '.wwwwww.',
    '..w..w..'
  ];
  const PLAYER = [
    '..f..f..',
    '..ffff..',
    '.fkkkkf.',
    '..ssss..',
    '.rbbbb.',
    'rrbbbbrr',
    '..gggg..',
    '..g..g..'
  ];
  const ENEMY = [
    '..f..f..',
    '..ffff..',
    '.fkkkkf.',
    '..ssss..',
    '.yyyyy.',
    'yypppyy',
    '..p.p..'
  ];
  const FISH = [
    '..rrrr..',
    '.rrrrrr.',
    'rrwrrrtr',
    '.rrrrrr.',
    '..r..r..'
  ];
  const BALLOON = [
    '..cccc..',
    '.cccccc.',
    'cccccccc',
    'cccccccc',
    '.cccccc.',
    '..cccc..',
    '...ss...',
    '...ss...'
  ];
  const BOMB = [
    '..xx..',
    '.xkkx.',
    'xkkkkx',
    'xkkkkx',
    '.xkkx.',
    '..xx..'
  ];
  function clamp(v, lo, hi){ return VisualizerGame.clamp(v, lo, hi); }
  function drawSprite(rows, map, tx, ty, px, flip){
    if(!flip) return pix(rows, tx, ty, px, map);
    for(let j=0;j<rows.length;j++){
      const r = rows[j];
      for(let i=0;i<r.length;i++){
        const c = map[r[r.length - 1 - i]];
        if(!c) continue;
        g.fillStyle = c;
        g.fillRect(Math.round(tx + i * px), Math.round(ty + j * px), Math.ceil(px), Math.ceil(px));
      }
    }
  }
  function render(ctx){
    const st = ctx.state, A = ctx.A, m = ctx.modifiers || {};
    if(!st || st.pack !== 'balloon' || !A) return;
    const nw = st.nativeW || 256, nh = st.nativeH || 224;
    const scale = Math.max(A.w / nw, A.h / nh);
    const ox0 = A.x + (A.w - nw * scale) * 0.5;
    const oy0 = A.y + (A.h - nh * scale) * 0.5;
    const shake = m.shake || 0;
    const ox = ox0 + (Math.random() * 2 - 1) * 3 * shake;
    const oy = oy0 + (Math.random() * 2 - 1) * 3 * shake;
    const cam = st.mode === 'trip' ? st.cameraX : 0;
    const sx = x => ox + (x - cam) * scale;
    const sy = y => oy + y * scale;
    const sc = v => v * scale;
    const px = Math.max(1, Math.round(scale));
    const hue = m.paletteHue || 0;
    const skyTop = hueRot('#68d8f0', hue * 0.35);
    const skyBot = hueRot('#f0b8d8', hue * 0.28);
    const grad = g.createLinearGradient(0, A.y, 0, A.y + A.h);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(0.75, skyBot);
    grad.addColorStop(1, '#06142b');
    g.fillStyle = grad;
    g.fillRect(A.x, A.y, A.w, A.h);

    g.globalAlpha = 0.22;
    for(let i=0;i<st.stars.length;i++){
      const s = st.stars[i];
      const tw = 0.35 + Math.sin(st.t * s.twinkle + s.phase) * 0.25 + (st.music ? st.music.noiseEnergy : 0) * 0.35;
      g.fillStyle = '#ffffff';
      g.fillRect(sx(cam + ((s.x - cam * (0.12 + i % 3 * 0.04)) % nw + nw) % nw), sy(s.y), Math.max(1, sc(s.size * tw)), Math.max(1, sc(s.size * tw)));
    }
    g.globalAlpha = 1;

    for(let c=-1;c<7;c++){
      const cx = cam * 0.28 + c * 72 + 22;
      const cy = 26 + (c % 3) * 18 + Math.sin(st.t * 0.4 + c) * 2;
      drawSprite(CLOUD, { w:'#ffffff', '.':null }, sx(cx - 8), sy(cy), px, false);
    }

    for(let i=0;i<st.platforms.length;i++){
      const p = st.platforms[i];
      g.fillStyle = hueRot('#b8f8d8', hue * 0.2);
      g.fillRect(sx(p.x - p.w / 2), sy(p.y), sc(p.w), sc(5));
      g.fillStyle = 'rgba(0,80,50,.28)';
      g.fillRect(sx(p.x - p.w / 2), sy(p.y + 5), sc(p.w), sc(4));
    }

    for(let i=0;i<st.collectibles.length;i++){
      const b = st.collectibles[i];
      if(b.got || b.x < cam - 30 || b.x > cam + nw + 40) continue;
      const pulse = 1 + (b.pulse || 0) * 0.16 + (m.scalePulse || 0) * 0.5;
      const col = hueRot(b.col || '#54fc54', hue * 0.45 + (b.pitch || 0) * 80);
      g.save();
      g.translate(sx(b.x), sy(b.y));
      g.scale(pulse, pulse);
      drawSprite(BALLOON, { c:col, s:'#b8b8c8', k:'#101018', x:'#ffffff', '.':null }, -4 * px, -7 * px, px, false);
      g.restore();
    }

    for(let i=0;i<st.hazards.length;i++){
      const h = st.hazards[i];
      if(!h.alive || h.x < cam - 30 || h.x > cam + nw + 40) continue;
      const pulse = 1 + (h.pulse || 0) * 0.18;
      g.save();
      g.translate(sx(h.x), sy(h.y));
      g.scale(pulse, pulse);
      drawSprite(BOMB, { k:'#1b1028', x:hueRot('#fc54fc', hue), '.':null }, -3 * px, -3 * px, px, false);
      g.restore();
    }

    for(let i=0;i<st.enemies.length;i++){
      const e = st.enemies[i];
      if(!e.alive) continue;
      const pulse = 1 + (e.hit || 0) * 0.18 + (st.music ? st.music.counterEnergy * 0.04 : 0);
      const flip = e.face < 0;
      for(let b=0;b<Math.max(1, e.balloons);b++){
        const bx = e.x + (b - 0.5) * 8;
        const by = e.y - 17 + Math.sin(st.t * 4 + e.phase + b) * 2;
        drawSprite(BALLOON, { c:hueRot(e.col, hue * 0.4), s:'#c8c8d8', '.':null }, sx(bx - 4), sy(by - 7), px, false);
      }
      g.save();
      g.translate(sx(e.x), sy(e.y));
      g.scale(pulse, pulse);
      drawSprite(ENEMY, { f:'#f0c090', k:'#101018', s:'#ffffff', y:'#fc5454', p:'#3c3cfc', '.':null }, -4 * px, -2 * px, px, flip);
      g.restore();
    }

    const p = st.player;
    const invAlpha = p.inv > 0 ? 0.55 + Math.sin(st.t * 36) * 0.25 : 1;
    g.globalAlpha = clamp(invAlpha, 0.25, 1);
    const bCount = Math.max(1, Math.round(p.balloons));
    for(let b=0;b<bCount;b++){
      const bx = p.x + (b - (bCount - 1) / 2) * 8;
      const by = p.y - 22 + Math.sin(st.t * 4.5 + b) * 1.8;
      drawSprite(BALLOON, { c:hueRot('#54fc54', hue * 0.45 + b * 35), s:'#c8c8d8', '.':null }, sx(bx - 4), sy(by - 7), px, false);
    }
    const playerFlip = p.vx < -1;
    drawSprite(PLAYER, { f:'#f0c090', k:'#101018', s:'#ffffff', r:'#fc5454', b:'#2c5cfc', g:'#54fc54', '.':null }, sx(p.x - 4), sy(p.y - 2 - p.flap * 2), px, playerFlip);
    g.globalAlpha = 1;

    if(st.fish && st.fish.active){
      drawSprite(FISH, { r:'#fc5454', w:'#ffffff', t:'#54fcfc', '.':null }, sx(st.cameraX + st.fish.x - 4), sy(st.fish.y - 4), px, false);
    }

    for(let i=0;i<st.effects.length;i++){
      const e = st.effects[i];
      const a = 1 - e.age / e.ttl;
      g.globalAlpha = clamp(a, 0, 1);
      g.fillStyle = hueRot(e.col, hue * 0.35);
      g.fillRect(sx(e.x), sy(e.y), Math.max(1, sc(e.size)), Math.max(1, sc(e.size)));
    }
    g.globalAlpha = 1;

    const waterY = st.waterY;
    const amp = m.waterAmp || 4;
    const fine = m.waterFine || 1;
    g.beginPath();
    g.moveTo(A.x, sy(waterY));
    for(let i=0;i<=96;i++){
      const x = cam + i / 96 * nw;
      const wv = Math.sin(x * 0.055 + st.t * 2.8) * amp * 0.45 +
        Math.sin(x * 0.14 - st.t * 3.8) * fine +
        Math.sin(i * 0.9 + (st.music ? st.music.barProgress * Math.PI * 2 : 0)) * amp * 0.18;
      g.lineTo(sx(x), sy(waterY + wv));
    }
    g.lineTo(A.x + A.w, A.y + A.h);
    g.lineTo(A.x, A.y + A.h);
    g.closePath();
    g.fillStyle = hueRot('#0068b8', hue * 0.16);
    g.fill();
    g.strokeStyle = hueRot('#fca044', hue * 0.3);
    g.lineWidth = Math.max(1, scale * 0.5);
    g.stroke();

    g.fillStyle = 'rgba(4,8,24,.28)';
    for(let y=A.y;y<A.y+A.h;y+=Math.max(2, Math.round(scale * 0.65))){
      g.fillRect(A.x, y, A.w, 1);
    }
  }

  const BalloonRenderer = {
    packVersion:2,
    key:'balloon',
    adapter:'custom-canvas-pack',
    performance:{ oneActiveLoop:true, ownsAnimationLoop:false, usesReactStatePerFrame:false, maxEntities:220, maxParticles:96, maxEventsPerFrame:64 },
    render,
    dispose:function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  };

  VisualizerGame.layer('balloon', 'renderer', BalloonRenderer);
  (typeof window !== 'undefined' ? window : globalThis).BalloonRenderer = BalloonRenderer;
})();
