// PLATFORMER renderer: sprite/tile presentation only. It consumes state + modifiers.
(function(){
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function hr(hex, deg){
    return (typeof hueRot === 'function') ? hueRot(hex, deg || 0) : hex;
  }
  function rect(x,y,w,h,c){
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
  }
  function drawPix(rows, map, x, y, cell, flip){
    cell = cell || 1;
    var w = 0;
    for(var r=0;r<rows.length;r++) if(rows[r].length > w) w = rows[r].length;
    g.save();
    if(flip){
      g.translate(Math.round(x + w * cell), Math.round(y));
      g.scale(-1, 1);
      x = 0; y = 0;
    }
    // same rects, same order as rect() — but skip redundant fillStyle sets (rows are runs) + hoist ceil
    var cs = Math.ceil(cell), last = null;
    for(var j=0;j<rows.length;j++){
      var row = rows[j], ry = Math.round(y + j * cell);
      for(var i=0;i<row.length;i++){
        var col = map[row[i]];
        if(!col) continue;
        if(col !== last){ g.fillStyle = col; last = col; }
        g.fillRect(Math.round(x + i * cell), ry, cs, cs);
      }
    }
    g.restore();
  }
  function spriteSize(rows){
    var w = 0;
    for(var r=0;r<rows.length;r++) if(rows[r].length > w) w = rows[r].length;
    return { w:w, h:rows.length };
  }
  function drawScaledSprite(rows, map, x, y, cell, flip, scale){
    if(!scale || Math.abs(scale - 1) < 0.001){
      drawPix(rows, map, x, y, cell, flip);
      return;
    }
    var w = 0;
    for(var r=0;r<rows.length;r++) if(rows[r].length > w) w = rows[r].length;
    var h = rows.length;
    g.save();
    g.translate(x + w * cell * 0.5, y + h * cell * 0.5);
    g.scale(scale, scale);
    drawPix(rows, map, -w * cell * 0.5, -h * cell * 0.5, cell, flip);
    g.restore();
  }

  var PLATFORMER_STAND = [
    '.....rrrr.......',
    '...rrrrrrrr.....',
    '...rrRrrrr......',
    '....hhhssss.....',
    '...hhssses......',
    '...hssssssn.....',
    '....hssmmm......',
    '.....ssss.......',
    '...rrrbrrr......',
    '..rrrbbbrrr.....',
    '.ssrbbbbbrss....',
    '...bbbbbbb......',
    '...bbb.bbb......',
    '..kkk...kkk.....',
    '.kkk.....kkk....'
  ];
  var PLATFORMER_RUN1 = [
    '.....rrrr.......',
    '...rrrrrrrr.....',
    '...rrRrrrr......',
    '....hhhssss.....',
    '...hhssses......',
    '...hssssssn.....',
    '....hssmmm......',
    '.....ssss.......',
    '...rrrbrrr......',
    '.ssrrbbbrr......',
    '....bbbbbss.....',
    '...bbbb.........',
    '..kkk..bbbb.....',
    '.......kkkk.....',
    '................'
  ];
  var PLATFORMER_RUN2 = [
    '.....rrrr.......',
    '...rrrrrrrr.....',
    '...rrRrrrr......',
    '....hhhssss.....',
    '...hhssses......',
    '...hssssssn.....',
    '....hssmmm......',
    '.....ssss.......',
    '...rrrbrrr......',
    '..ssrbbbbrrss...',
    '....bbbbb.......',
    '.....bbb........',
    '....kk.kk.......',
    '...kk...kk......',
    '................'
  ];
  var PLATFORMER_RUN3 = [
    '.....rrrr.......',
    '...rrrrrrrr.....',
    '...rrRrrrr......',
    '....hhhssss.....',
    '...hhssses......',
    '...hssssssn.....',
    '....hssmmm......',
    '.....ssss.......',
    '...rrrbrrr......',
    '.ssrrbbbrr......',
    '....bbbbbss.....',
    '.......bbbb.....',
    '...bbb..kkk.....',
    '..kkkk..........',
    '................'
  ];
  var PLATFORMER_JUMP = [
    '.....rrrr.......',
    '...rrrrrrrr.....',
    '...rrRrrrr......',
    '....hhhssss.....',
    '...hhssses......',
    '...hssssssn.....',
    '....hssmmm......',
    '.....ssss.......',
    '..ssrrbbbrr.....',
    '.ssrbbbbbr......',
    '...bbbbbbb......',
    '..bbb..bbb......',
    '.kkk....kkk.....',
    '................',
    '................'
  ];
  var WALKER = [
    '....oooo....',
    '...oooooo...',
    '..oooooooo..',
    '.ookoooooko.',
    'ookwoookwoo',
    'ookkooookko',
    '..oooooooo..',
    '.oooooooooo.',
    'kkk......kkk'
  ];
  var WALKER_FLAT = [
    '..oooooooo..',
    '.ookwoookwo.',
    'kkkoooookkk.'
  ];
  var SHELL = [
    '....gggg....',
    '...ggGGgg...',
    '..ggGGGGgg..',
    '..kkwwkk....',
    '.gkwwwwkg...',
    '.ggkkkkgg...',
    '..ssssss....',
    '.ssssssss...',
    '.sSssssSs...',
    '..ssssss....',
    '..kk..kk....'
  ];
  var SPIKER = [
    '..r..r..r...',
    '.rrrrrrrr..',
    'rrRRRRRRrr.',
    'rRwwRRwwRr.',
    'rRRRRRRRRr.',
    '.rrrrrrrr..',
    '..kk..kk...'
  ];
  var BEETLE = [
    '...bbbb....',
    '..bbbbbb...',
    '.bbBBBBbb..',
    'bbBwwBwwbb.',
    'bbBBBBBBbb.',
    '.bbbbbbbb..',
    '..kk..kk...'
  ];
  var COIN_FACE = [
    '...yy...',
    '..yyyy..',
    '.ywwwwy.',
    'ywyyyywy',
    'ywyyyywy',
    'ywyyyywy',
    'ywyyyywy',
    'ywyyyywy',
    'ywyyyywy',
    'ywyyyywy',
    'ywyyyywy',
    '.ywwwwy.',
    '..yyyy..',
    '...yy...'
  ];
  var COIN_EDGE = [
    '...yy...',
    '...yy...',
    '...ww...',
    '...yy...',
    '...yy...',
    '...yy...',
    '...yy...',
    '...yy...',
    '...yy...',
    '...yy...',
    '...yy...',
    '...ww...',
    '...yy...',
    '...yy...'
  ];
  var STAR = [
    '......y......',
    '......Y......',
    '.....YYY.....',
    '.....YYY.....',
    'yyyyYYYYYyyyy',
    '.yYYYYYYYYYy.',
    '..YYYYYYYYY..',
    '...YYYYYYY...',
    '...YYYYYYY...',
    '..YYYY.YYYY..',
    '.YYY.....YYY.',
    '.YY.......YY.',
    'Y...........Y'
  ];
  var CLOUD = [
    '......kkkk......',
    '....kkwwwwkk....',
    '..kkwwwwwwwwkk..',
    '.kwwwwkwwkwwwwk.',
    'kwwwwwwwwwwwwwwk',
    'kwwwwwwwwwwwwwwk',
    '.kkwwwwwwwwwwkk.',
    '...kkkkkkkkkk...'
  ];
  var BUSH = [
    '...gggg....gggg...',
    '..ggGGgg..ggGGgg..',
    '.ggGGGGggggGGGGgg.',
    'ggGGGGGGGGGGGGGGgg',
    'ggGGGGGGGGGGGGGGgg',
    '.gggggggggggggggg.'
  ];
  var HILL = [
    '........GGGGGGGG........',
    '.....GGGGggggggGGGG.....',
    '...GGggggGGGGggggGGG....',
    '..GGggGGGGGGGGGGggGG....',
    '.GGggGGGGGGGGGGGGggGG...',
    'GGggGGGGGGGGGGGGGGggGG..'
  ];

  var MAP = {
    r:'#d82800',
    b:'#0040c8',
    s:'#f8b888',
    n:'#f8b888',
    h:'#7c3000',
    e:'#141010',
    m:'#5a2608',
    k:'#141010',
    w:'#ffffff',
    y:'#f8d030',
    o:'#985018',
    g:'#20a820',
    G:'#58d838',
    R:'#f85838',
    B:'#5c78d8',
    S:'#b0b8e8'
  };

  function drawQuestion(x,y,pulse,hue,used){
    var s = 1 + (pulse || 0);
    g.save();
    g.translate(x + 8, y + 8);
    g.scale(s, s);
    x = -8; y = -8;
    var base = used ? '#9a5a20' : '#f8a020';
    rect(x,y,16,16,base);
    rect(x,y,16,2,'#ffd878');
    rect(x,y,2,16,'#ffd878');
    rect(x+14,y,2,16,'#5b2800');
    rect(x,y+14,16,2,'#5b2800');
    rect(x+2,y+2,2,2,'#fff0a0');
    rect(x+12,y+2,2,2,'#fff0a0');
    rect(x+2,y+12,2,2,'#7a3100');
    rect(x+12,y+12,2,2,'#7a3100');
    if(!used){
      rect(x+6,y+4,4,2,'#7a3100');
      rect(x+10,y+6,2,3,'#7a3100');
      rect(x+7,y+9,3,2,'#7a3100');
      rect(x+7,y+12,2,2,'#7a3100');
      rect(x+6,y+3,4,1,'#fff0a0');
    }
    g.restore();
  }
  function drawBrick(x,y,hue,pulse,wood){
    var s = 1 + (pulse || 0) * 0.6;
    g.save();
    g.translate(x + 8, y + 8);
    g.scale(s, s);
    x = -8; y = -8;
    var base = wood ? hr('#d89038', hue) : hr('#c86028', hue);
    rect(x,y,16,16,base);
    rect(x,y,16,2,hr('#f8c078', hue));
    rect(x,y+7,16,1,'#5b2800');
    rect(x+7,y,1,7,'#5b2800');
    rect(x+3,y+8,1,8,'#5b2800');
    rect(x+11,y+8,1,8,'#5b2800');
    rect(x,y+15,16,1,'#5b2800');
    g.restore();
  }
  function drawGroundTile(x,y,hue,bounce){
    y += bounce || 0;
    rect(x,y,16,16,hr('#d87828', hue));
    rect(x,y,16,3,hr('#f8c080', hue));
    rect(x,y+3,16,2,'#141010');
    rect(x+1,y+6,3,8,'#7a3308');
    rect(x+6,y+6,3,8,'#7a3308');
    rect(x+11,y+6,3,8,'#7a3308');
    rect(x,y+14,16,2,'#141010');
  }
  function drawEarthTile(x,y,hue,underground){
    var base = underground ? hr('#443050', hue) : hr('#9a5528', hue);
    var dark = underground ? '#201428' : '#5b2800';
    var hi = underground ? hr('#725080', hue) : hr('#bd7440', hue);
    rect(x,y,16,16,base);
    rect(x,y,16,1,dark);
    rect(x+2,y+3,3,2,hi);
    rect(x+9,y+5,4,2,dark);
    rect(x+5,y+10,3,2,dark);
    rect(x+12,y+12,2,2,hi);
  }
  function drawPipe(p,hue){
    var x=p.x, y=p.y, w=p.w, h=p.h;
    rect(x - 2, y, w + 4, 13, hr('#38b838', hue));
    rect(x - 2, y, 5, 13, '#90f870');
    rect(x + w - 5, y, 7, 13, '#087818');
    rect(x, y + 12, w, h - 12, hr('#20a828', hue));
    rect(x + 4, y + 13, 5, h - 13, '#90f870');
    rect(x + w - 7, y + 13, 7, h - 13, '#087818');
    rect(x - 2, y + 12, w + 4, 2, '#064810');
  }
  function drawGoal(goal,hue,t){
    var x = goal.x, y = goal.y;
    if(goal.type === 'castle'){
      rect(x - 8, M_GROUND() - 54, 54, 54, hr('#d8b060', hue));
      rect(x - 8, M_GROUND() - 58, 14, 8, hr('#b88438', hue));
      rect(x + 12, M_GROUND() - 62, 14, 12, hr('#b88438', hue));
      rect(x + 32, M_GROUND() - 58, 14, 8, hr('#b88438', hue));
      rect(x + 12, M_GROUND() - 26, 18, 26, '#201008');
      rect(x - 2, M_GROUND() - 42, 8, 8, '#fff0a0');
      rect(x + 34, M_GROUND() - 42, 8, 8, '#fff0a0');
      return;
    }
    if(goal.type === 'pipe'){
      drawPipe({ x:x, y:M_GROUND() - 48, w:32, h:48 }, hue);
      rect(x + 7, M_GROUND() - 57, 18, 9, hr('#20a828', hue));
      return;
    }
    rect(x + 10, M_GROUND() - 96, 2, 96, '#f8f8f8');
    rect(x + 12, M_GROUND() - 92, 25, 14, goal.triggered ? '#f8d030' : hr('#d82800', hue));
    rect(x + 12, M_GROUND() - 78, 18, 8, goal.triggered ? '#ffffff' : '#f8b888');
    rect(x + 6, M_GROUND() - 4, 10, 4, '#f8f8f8');
    if(goal.triggered){
      rect(x + 18, M_GROUND() - 106 + Math.sin((t || 0) * 12) * 2, 6, 6, '#f8d030');
    }
  }
  function drawCoin(c, hop, hue, t){
    var y = c.y - hop * Math.max(0, Math.sin((c.phase || 0) + (t || 0) * 7));
    if(c.pop) y -= c.pop * 5;
    var frame = Math.floor((t || 0) * 10 + (c.phase || 0) * 5 + (c.pop || 0) * 7) % 4;
    var rows = (frame === 1 || frame === 3) ? COIN_EDGE : COIN_FACE;
    drawPix(rows, { y:hr('#f8d030', hue), w:'#fff0a0' }, c.x, y, 1, false);
  }
  function drawStar(s, hue, t){
    var y = s.y;
    if(s.pop) y -= s.pop * 5;
    var twinkle = Math.floor((t || 0) * 12 + (s.id || 0)) % 2;
    drawPix(STAR, { Y:twinkle ? '#fff0a0' : '#f8d030', y:hr('#e08000', hue) }, s.x, y, 1, false);
  }
  function drawWalker(e, hop, hue, beatScale){
    var rows = e.squash > 0 ? WALKER_FLAT : WALKER;
    var cell = e.squash > 0 ? 1.45 : 1.55;
    var size = spriteSize(rows);
    var hopY = hop * (e.squash > 0 ? 0 : Math.max(0, Math.sin(e.step || 0)));
    var x = e.x + (e.w || 16) * 0.5 - size.w * cell * 0.5;
    var y = e.y + (e.h || 16) - size.h * cell - hopY;
    drawScaledSprite(rows, { o:hr('#985018', hue), k:'#141010', w:'#ffffff' }, x, y, cell, e.vx > 0, beatScale);
  }
  function drawEnemy(e, hop, hue, beatScale){
    if(e.type === 'walker'){
      drawWalker(e, hop, hue, beatScale);
      return;
    }
    var rows = e.type === 'shell' ? SHELL : e.type === 'spiker' ? SPIKER : BEETLE;
    var cell = e.type === 'shell' ? 1.45 : 1.55;
    var size = spriteSize(rows);
    var hopY = hop * Math.max(0, Math.sin(e.step || 0));
    var x = e.x + (e.w || 16) * 0.5 - size.w * cell * 0.5;
    var y = e.y + (e.h || 16) - size.h * cell - hopY;
    drawScaledSprite(rows, {
      k:'#141010',
      w:'#ffffff',
      g:hr('#20a820', hue),
      G:hr('#58d838', hue),
      r:hr('#d82800', hue * 0.4),
      R:hr('#f85838', hue * 0.4),
      b:hr('#3058b8', hue * 0.25),
      B:hr('#5c78d8', hue * 0.25),
      s:'#504050',
      S:'#b0b8e8'
    }, x, y, cell, e.vx > 0, beatScale);
  }
  function platformerRows(st){
    var m = st.platformer;
    if(!m.onGround) return PLATFORMER_JUMP;
    if(Math.abs(m.vx) < 18) return PLATFORMER_STAND;
    var f = Math.floor(m.run) % 3;
    return f === 0 ? PLATFORMER_RUN1 : f === 1 ? PLATFORMER_RUN2 : PLATFORMER_RUN3;
  }
  function drawPlatformer(st, beatScale){
    var m = st.platformer;
    var flash = m.hurt > 0 && Math.floor(m.hurt * 18) % 2 === 0;
    var map = Object.assign({}, MAP);
    if(flash){
      map.r = '#ffffff';
      map.b = '#f8d030';
      map.s = '#ffffff';
    }
    if(m.star > 0){   // invincible: cycle the palette so the hero visibly sparkles
      var cyc = ['#f8d030','#38b838','#f85838','#5c78d8'];
      var ph = Math.floor((st.t || 0) * 18) % 4;
      map.r = cyc[ph];
      map.b = cyc[(ph + 2) % 4];
      map.s = cyc[(ph + 1) % 4];
    }
    var rows = platformerRows(st);
    // The PLAYER: white body inside a hard black outline, and bigger than the
    // enemies. Super Mario Land's hero is the brightest thing on screen; ranked
    // like any other sprite ours landed in the middle shades and came out dark
    // and muddy, indistinguishable from a goomba.
    var _PH=(typeof CT_PAL!=='undefined')&&CT_PAL, _hero=_PH&&_PH.installed;
    if(_hero) map=_PH.heroMap(map);
    var cell = _hero ? 1.95 : 1.46;
    var size = spriteSize(rows);
    var facingLeft = m.vx < -28;
    var lean = (m.onGround && Math.abs(m.vx) > 42) ? (facingLeft ? -1.5 : 1.5) : 0;
    var x = m.x + m.w * 0.5 - size.w * cell * 0.5 + lean;
    var y = m.y + m.h - size.h * cell;
    drawScaledSprite(rows, map, x, y, cell, facingLeft, beatScale);
  }

  function render(ctx){
    var st = ctx.state;
    var A = ctx.A;
    if(!st || !A || typeof g === 'undefined') return;
    var mod = ctx.modifiers || {};
    var hue = mod.paletteHue || 0;
    var energy = clamp(mod.energy || 0, 0, 1);
    var beatScale = 1 + clamp(mod.scalePulse || 0, 0, 0.08);
    var coinHop = mod.coinHop || 0;
    var enemyHop = mod.enemyHop || 0;
    var cloudHop = mod.cloudHop || 0;
    var blockPulse = mod.blockPulse || 0;
    var groundBounce = Math.min(2.2, mod.groundBounce || 0);
    var theme = st.courseTheme || (st.variant === 2 ? 'underground' : st.variant === 1 ? 'castle' : 'outdoor');
    var underground = theme === 'underground';
    var castle = theme === 'castle';

    st.nativeW = Math.max(1, Math.round(st.nativeH * A.w / A.h));
    var sx = A.w / st.nativeW;
    var sy = A.h / st.nativeH;
    var sc = Math.max(sx, sy);
    var ox = A.x + (A.w - st.nativeW * sc) * 0.5;
    var oy = A.y + (A.h - st.nativeH * sc) * 0.5;
    var cam = st.cameraX || 0;
    var skyTop = underground ? hr('#0a0718', hue * 0.12) : castle ? hr('#141018', hue * 0.08) : hr('#70e0d0', hue * 0.32);
    var skyBot = underground ? hr('#19112a', hue * 0.12) : castle ? hr('#282038', hue * 0.08) : hr('#9cf0e0', hue * 0.28);
    // The sky is the FIELD, in every theme and by assignment rather than by
    // luck. Measured on its own the outdoor sky (#70e0d0, luma 0.740) quantises
    // to the DARKEST ink; it only ever looked right because the screen-covering
    // fill happened to claim the field first, and that depends on draw order,
    // on the theme, and on which of the two backdrop fills lands larger. When it
    // did not win, the whole sky came out as ink and the level was unreadable.
    var _PS2 = (typeof CT_PAL !== 'undefined') && CT_PAL;
    if(_PS2 && _PS2.installed){ skyTop = _PS2.role('field'); skyBot = _PS2.role('field'); }

    g.save();
    g.imageSmoothingEnabled = false;
    var pageGrad = g.createLinearGradient(A.x, A.y, A.x, A.y + A.h);
    pageGrad.addColorStop(0, skyTop);
    pageGrad.addColorStop(1, skyBot);
    g.fillStyle = pageGrad;
    g.fillRect(A.x, A.y, A.w, A.h);
    g.beginPath();
    g.rect(A.x, A.y, A.w, A.h);
    g.clip();
    g.translate(ox, oy);
    g.scale(sc, sc);

    var grad = g.createLinearGradient(0, 0, 0, st.nativeH);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(1, skyBot);
    g.fillStyle = grad;
    g.fillRect(0, 0, st.nativeW, st.nativeH);

    if(!underground && !castle){
      var firstCloud = Math.floor((cam * 0.28 - 96) / 96) * 96;
      for(var cx=firstCloud; cx<cam*0.28 + st.nativeW + 128; cx+=96){
        var px = cx - cam * 0.28 + 38;
        var py = 18 + ((cx / 96) % 3) * 14 - cloudHop;
        drawPix(CLOUD, { k:'#141010', w:'#ffffff' }, px, py, 2, false);
      }
    }

    for(var d=0; d<st.decor.length; d++){
      if(underground || castle) continue;
      var deco = st.decor[d];
      var dx = deco.x - cam * (deco.type === 'cloud' ? 0.28 : 1);
      if(dx < -110 || dx > st.nativeW + 110) continue;
      // Scenery on the two LIGHT shades only -- see decorMap(). Clouds, hills
      // and bushes were being ranked like sprites, so their darker tone came out
      // as ink and a bush read with the same weight as a goomba.
      var _PD2 = (typeof CT_PAL !== 'undefined') && CT_PAL;
      var DC = function(m){ return (_PD2 && _PD2.installed) ? _PD2.decorMap(m) : m; };
      if(deco.type === 'cloud') drawPix(CLOUD, DC({ k:'#141010', w:'#ffffff' }), dx, 30 + Math.sin(st.t + deco.phase) * 1.2 - cloudHop, 2, false);
      // Hills and bushes are ground greenery — anchor their BOTTOM to the ground line so they never
      // float in the sky (cell>1 scales them up; the y is ground minus the scaled sprite height).
      else if(deco.type === 'hill') drawPix(HILL, DC({ G:hr('#58d838', hue * 0.2), g:hr('#20a820', hue * 0.2) }), dx, M_GROUND() - spriteSize(HILL).h * 4, 4, false);
      else drawPix(BUSH, DC({ G:hr('#58d838', hue * 0.2), g:hr('#20a820', hue * 0.2) }), dx, M_GROUND() - spriteSize(BUSH).h * 2, 2, false);
    }

    // Death pits must read as bottomless. A gap (uncovered) column is painted as a clean dark
    // void from the ground surface line straight down to the FULL viewport bottom, instead of
    // leaving the sky/horizon band showing (which made pits look shallow). Keyed off groundY +
    // nativeH — which always map to the full field height — so the void reaches bottom at ANY
    // viewport height/aspect. Drawn before entities so coins/enemies over the pit stay on top.
    // A pit must read as a hole in the field, so it takes ink outright.
    var voidTop = (_PS2 && _PS2.installed) ? _PS2.role('ink')
                : (underground ? '#05030e' : castle ? '#08060f' : '#0a1420');
    var voidGrad = g.createLinearGradient(0, st.groundY, 0, st.nativeH + 16);
    voidGrad.addColorStop(0, voidTop);
    voidGrad.addColorStop(1, '#010007');
    var minTile = Math.floor((cam - 16) / 16) * 16;
    var maxTile = cam + st.nativeW + 32;
    for(var gx=minTile; gx<maxTile; gx+=16){
      var covered = false;
      for(var gi=0; gi<st.ground.length; gi++){
        var gr = st.ground[gi];
        if(gx + 16 > gr.x && gx < gr.x + gr.w){ covered = true; break; }
      }
      if(!covered){
        g.fillStyle = voidGrad;
        g.fillRect(Math.round(gx - cam), st.groundY, 16, st.nativeH - st.groundY + 16);
        continue;
      }
      for(var gy=st.groundY; gy<st.nativeH + 16; gy+=16){
        if(gy === st.groundY) drawGroundTile(gx - cam, gy, hue * 0.18, groundBounce);
        else drawEarthTile(gx - cam, gy, hue * 0.12, underground || castle);
      }
    }

    for(var pi=0; pi<st.pipes.length; pi++){
      var p = st.pipes[pi];
      if(p.x - cam > -48 && p.x - cam < st.nativeW + 48) drawPipe({ x:p.x - cam, y:p.y, w:p.w, h:p.h }, hue * 0.2);
    }

    for(var gi2=0; gi2<st.goals.length; gi2++){
      var goal = st.goals[gi2];
      if(goal.x - cam > -64 && goal.x - cam < st.nativeW + 64) drawGoal({ x:goal.x - cam, y:goal.y, type:goal.type, triggered:goal.triggered }, hue * 0.18, st.t);
    }

    for(var bi=0; bi<st.blocks.length; bi++){
      var b = st.blocks[bi];
      if(b.broken) continue;
      var bx = b.x - cam;
      if(bx < -24 || bx > st.nativeW + 24) continue;
      var by = b.y - Math.sin((b.bump || 0) * Math.PI) * 5;
      if(b.type === 'question') drawQuestion(bx, by, blockPulse, hue * 0.22, b.used);
      else drawBrick(bx, by, hue * 0.16, blockPulse, b.type === 'woodBlock');
    }

    for(var ci=0; ci<st.coins.length; ci++){
      var c = st.coins[ci];
      var cpx = c.x - cam;
      if(cpx > -24 && cpx < st.nativeW + 24) drawCoin({ x:cpx, y:c.y, phase:c.phase, pop:c.pop }, coinHop, hue * 0.35, st.t);
    }

    for(var si=0; st.stars && si<st.stars.length; si++){
      var sPickup = st.stars[si];
      var spx = sPickup.x - cam;
      if(spx > -24 && spx < st.nativeW + 24) drawStar({ x:spx, y:sPickup.y, pop:sPickup.pop, id:sPickup.id }, hue * 0.3, st.t);
    }

    for(var ei=0; ei<st.enemies.length; ei++){
      var e = st.enemies[ei];
      if(e.gone) continue;
      var ex = e.x - cam;
      if(ex > -28 && ex < st.nativeW + 28) drawEnemy({ type:e.type, x:ex, y:e.y, w:e.w, h:e.h, vx:e.vx, squash:e.squash, step:e.step }, enemyHop, hue * 0.18, beatScale);
    }

    if(!st.platformer.hidden){
      g.save();
      g.translate(-cam, 0);
      drawPlatformer(st, beatScale);
      g.restore();
    }

    g.restore();
  }

  function M_GROUND(){
    return (typeof PlatformerDefinition !== 'undefined' && PlatformerDefinition.GROUND_Y) || 192;
  }

  VisualizerGame.layer('platformer', 'renderer', {
    packVersion: 2,
    key: 'platformer',
    adapter: 'custom-canvas-pack',
    presentation: [
      'NES-scale side-scroller viewport',
      'custom pixel sprites for Platformer, enemies, coins, star power-up, blocks, pipes, clouds, hills, bushes, and ground tiles',
      'camera-followed horizontal platforming',
      'music bops on sprites only, never collision geometry'
    ],
    performance: {
      oneActiveLoop:true,
      ownsAnimationLoop:false,
      maxEntities:96,
      maxParticles:0,
      maxEventsPerFrame:64,
      usesReactStatePerFrame:false,
      allocations:'state arrays are capped and old world chunks are pruned'
    },
    drawContract: [
      'consume simulation state and render modifiers',
      'keep hitboxes stable while sprites pulse',
      'draw only visible world objects',
      'skip inactive visualizers through the shared runtime'
    ],
    render: render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });

  if(typeof window !== 'undefined') window.PlatformerRenderer = { render:render };
  else this.PlatformerRenderer = { render:render };
})();
