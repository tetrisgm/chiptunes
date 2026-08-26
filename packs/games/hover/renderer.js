// HOVER FIGHT renderer. Draws state plus transient modifiers; owns no rules.
(function(){
  const CLOUD = [
    '..wwww..',
    '.wwwwww.',
    'wwwwwwww',
    '.wwwwww.',
    '..w..w..'
  ];
  // PLAYER: a helmeted hero (gold dome + white visor + orange suit + green boots).
  // Deliberately distinct in both silhouette and palette from the bare-headed,
  // red/blue ENEMY sprite below so a viewer instantly reads which one is the player.
  // The head block (rows 0-3) is IDENTICAL in every frame: only the arms and legs move, so the
  // animation never blurs the helmet+visor silhouette that makes him readable against the enemies.
  // One wing-beat = PLAYER_FLAP[0] (arms driven down, the power stroke) -> [1] (arms out, mid) ->
  // [2] (arms up, recovery). Legs stay APART through the beat.
  const PLAYER_FLAP = [
    [ // 0: down-stroke — hands driven below the shoulders
      '..hhhh..',
      '.hhhhhh.',
      '.hssssh.',
      '..ffff..',
      '.oossoo.',
      'o.oooo.o',
      '..oooo..',
      '..g..g..'
    ],
    [ // 1: mid — arms straight out (the original single static pose)
      '..hhhh..',
      '.hhhhhh.',
      '.hssssh.',
      '..ffff..',
      '.oossoo.',
      'oooooooo',
      '..oooo..',
      '..g..g..'
    ],
    [ // 2: up — hands raised beside the helmet, ready for the next beat
      '..hhhh..',
      '.hhhhhh.',
      'ohssssho',
      'o.ffff.o',
      '.oossoo.',
      '..oooo..',
      '..oooo..',
      '..g..g..'
    ]
  ];
  // Glide/sink: arms angled down in a V and — the tell — legs TOGETHER, so a falling hero reads
  // instantly differently from a flapping one even at broadcast scale.
  const PLAYER_GLIDE = [
    '..hhhh..',
    '.hhhhhh.',
    '.hssssh.',
    '..ffff..',
    '.oossoo.',
    '.oooooo.',
    'o.oooo.o',
    '...gg...'
  ];
  // Row the lean shear pivots around (waist): rows above it lead the turn, boots trail behind.
  const LEAN_PIVOT = 4;
  // Enemies get a light 2-frame arm tuck so the sky feels alive, but nothing about their
  // bare-headed red/blue read changes — the player stays the distinct one.
  const ENEMY_FLAP = [
    [
      '..f..f..',
      '..ffff..',
      '.fkkkkf.',
      '..ssss..',
      '.yyyyy.',
      'yypppyy',
      '..p.p..'
    ],
    [
      '..f..f..',
      '..ffff..',
      '.fkkkkf.',
      '..ssss..',
      '.yyyyy.',
      '.ypppy.',
      '.p...p.'
    ]
  ];
  const FISH = [
    '..rrrr..',
    '.rrrrrr.',
    'rrwrrrtr',
    '.rrrrrr.',
    '..r..r..'
  ];
  const HOVER = [
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
  // `lean` shears the sprite by whole pixels per row (head leads, boots trail) for a pixel-grid tilt.
  // It is applied in SCREEN space, after the mirror, so the lean always follows the direction of
  // travel regardless of `flip`. Zero lean + no flip keeps the fast pix() path.
  function drawSprite(rows, map, tx, ty, px, flip, lean){
    const sh = lean || 0;
    if(!flip && !sh) return pix(rows, tx, ty, px, map);
    const cw = Math.ceil(px);
    for(let j=0;j<rows.length;j++){
      const r = rows[j];
      const ry = Math.round(ty + j * px);
      const rx = sh ? tx + Math.round(sh * (LEAN_PIVOT - j)) * px : tx;
      for(let i=0;i<r.length;i++){
        const c = map[flip ? r[r.length - 1 - i] : r[i]];
        if(!c) continue;
        g.fillStyle = c;
        g.fillRect(Math.round(rx + i * px), ry, cw, cw);
      }
    }
  }
  // Which body frame the player wears this tick. Driven by his OWN motion, never a free timer:
  // definition.js snaps p.flap to 1 the instant he flaps and decays it at 6/s, so (1 - p.flap) is
  // the normalised progress through one wing-beat and the arms therefore beat in time with the
  // actual flapping. With the beat spent he either glides (sinking) or holds the arms-up pose.
  function playerRows(p){
    if(p.flap > 0.02){
      const k = 1 - p.flap;
      return PLAYER_FLAP[k < 0.34 ? 0 : k < 0.67 ? 1 : 2];
    }
    return p.vy > 6 ? PLAYER_GLIDE : PLAYER_FLAP[2];
  }
  function render(ctx){
    const st = ctx.state, A = ctx.A, m = ctx.modifiers || {};
    if(!st || st.pack !== 'hover' || !A) return;
    const nw = st.nativeW || 256, nh = st.nativeH || 224;
    const scale = Math.min(A.w / nw, A.h / nh);
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

    const cloudCount = Math.ceil(nw / 72) + 2;
    for(let c=-1;c<cloudCount;c++){
      const cx = cam * 0.28 + c * 72 + 22;
      const cy = 26 + (c % 3) * 18 + Math.sin(st.t * 0.4 + c) * 2;
      // Background scenery on the light shades only. A one-colour cloud ranked
      // like a sprite becomes INK -- as heavy on screen as a hazard.
      var _PDC=(typeof CT_PAL!=='undefined')&&CT_PAL;
      var _cmap={ w:'#ffffff', '.':null };
      if(_PDC&&_PDC.installed) _cmap=_PDC.decorMap(_cmap);
      drawSprite(CLOUD, _cmap, sx(cx - 8), sy(cy), px, false);
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
      drawSprite(HOVER, { c:col, s:'#b8b8c8', k:'#101018', x:'#ffffff', '.':null }, -4 * px, -7 * px, px, false);
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
      for(let b=0;b<Math.max(1, e.hovers);b++){
        const bx = e.x + (b - 0.5) * 8;
        const by = e.y - 17 + Math.sin(st.t * 4 + e.phase + b) * 2;
        // NOT hue-rotated: e.col comes from the green-free ENEMY_HOVER_COLORS pool, and rotating it would sweep
        // some enemies straight through green — defeating the whole point of reserving green for the player.
        drawSprite(HOVER, { c:e.col, s:'#c8c8d8', '.':null }, sx(bx - 4), sy(by - 7), px, false);
      }
      g.save();
      g.translate(sx(e.x), sy(e.y));
      g.scale(pulse, pulse);
      // e.phase already advances every frame in updateFight (dt * 3), so the tuck cycles with the
      // enemy's own bob — deterministic, no timer of its own.
      drawSprite(ENEMY_FLAP[Math.sin(e.phase * 2) > 0 ? 0 : 1], { f:'#f0c090', k:'#101018', s:'#ffffff', y:'#fc5454', p:'#3c3cfc', '.':null }, -4 * px, -2 * px, px, flip);
      g.restore();
    }

    const p = st.player;
    const invAlpha = p.inv > 0 ? 0.55 + Math.sin(st.t * 36) * 0.25 : 1;
    g.globalAlpha = clamp(invAlpha, 0.25, 1);
    const bCount = Math.max(1, Math.round(p.hovers));
    // '#54fc54' (green) is the player's RESERVED hover color; enemy hovers draw from ENEMY_HOVER_COLORS
    // (definition.js), which excludes green. Both sides are drawn UNROTATED — hue-rotating them (as this used to)
    // slid the player off green and swept enemies onto it, so the player became impossible to pick out.
    for(let b=0;b<bCount;b++){
      const bx = p.x + (b - (bCount - 1) / 2) * 8;
      const by = p.y - 22 + Math.sin(st.t * 4.5 + b) * 1.8;
      drawSprite(HOVER, { c:'#54fc54', s:'#e8ffe8', '.':null }, sx(bx - 4), sy(by - 7), px, false);
    }
    const playerFlip = p.vx < -1;
    // Lean: a sub-sprite tilt straight off p.vx (which physics clamps to [-54, 68]), on top of the
    // existing flip. Small enough to read as body English, never as a new silhouette.
    const playerLean = clamp(p.vx / 150, -0.3, 0.3);
    // Balloon Kid's silhouette is the BALLOONS, not the figure: two rounded
    // shapes above the head on short strings, which is what makes the sprite
    // readable at Game Boy size and from across a room. Ours was a bare flapping
    // figure -- the Balloon Fight design -- and at 144 rows it read as a smudge.
    // Drawn above the body so the body art and its animation are untouched.
    if(typeof CT_DMG_NATIVE !== 'undefined' && CT_DMG_NATIVE){
      // Whole-pixel sway. A fractional offset lands the sprite between LCD
      // cells and the rounding flips every frame, which reads as a flicker.
      var bsway = Math.round(Math.sin(st.t * 2.6 + p.x * 0.05)) * px;
      drawSprite([
        '.OO..OO.',
        'OOOOOOOO',
        'OOOOOOOO',
        '.OO..OO.',
        '..o..o..',
        '...oo...'
      ], { O:'#ffffff', o:'#101010', '.':null },
        sx(p.x - 4) + bsway, sy(p.y - 2 - p.flap * 2) - px * 6, px, false, 0);
    }
    // The PLAYER. Five colours ranked by luminance gave a mid-shade speckle with
    // limbs and helmet all the same weight -- an insect, not a character. Ink
    // outline, solid body, white highlight, and drawn larger.
    var _PHV=(typeof CT_PAL!=='undefined')&&CT_PAL, _hv=_PHV&&_PHV.installed;
    var _pmap={ h:'#ffcc33', s:'#ffffff', f:'#f0c090', o:'#ff7a1a', g:'#54fc54', '.':null };
    if(_hv) _pmap=_PHV.heroMap(_pmap);
    drawSprite(playerRows(p), _pmap, sx(p.x - 4), sy(p.y - 2 - p.flap * 2), _hv?Math.round(px*1.4):px, playerFlip, playerLean);
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

  const HoverRenderer = {
    packVersion:2,
    key:'hover',
    adapter:'custom-canvas-pack',
    performance:{ oneActiveLoop:true, ownsAnimationLoop:false, usesReactStatePerFrame:false, maxEntities:220, maxParticles:96, maxEventsPerFrame:64 },
    render,
    dispose:function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  };

  VisualizerGame.layer('hover', 'renderer', HoverRenderer);
  (typeof window !== 'undefined' ? window : globalThis).HoverRenderer = HoverRenderer;
})();
