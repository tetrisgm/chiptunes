// DUNGEON renderer. Presentation only; consumes DungeonDefinition's dungeonView payload.
const DungeonRenderer = (function(){
  function render(ctx){
    ctx = ctx || {};
    var view = ctx.dungeonView || {};
    var A = view.A || ctx.A || {x:0,y:0,w:0,h:0};
    var U = view.U || ctx.U || 8;
    var st = view.st || ctx.state;
    if(!st) return undefined;
    var COLS = view.COLS || st.COLS || 16;
    var ROWS = view.ROWS || st.ROWS || 11;
    var GW = view.GW || st.GW || 6;
    var GH = view.GH || st.GH || 5;
    var cw = view.cw || st.cw || Math.max(A.w / COLS,A.h / ROWS);
    var ch = view.ch || st.ch || cw;
    var fieldW = view.fieldW || st.fieldW || COLS*cw;
    var fieldH = view.fieldH || st.fieldH || ROWS*ch;
    var fieldX = view.fieldX == null ? (A.x+(A.w-fieldW)*0.5) : view.fieldX;
    var fieldY = view.fieldY == null ? (A.y+(A.h-fieldH)*0.5) : view.fieldY;
    var grid = view.grid || st.grid;
    var hero = view.hero || st.hero || {};
    var clk = view.clk || {};
    var cl = view.cl || {};
    var energyMV = view.energyMV || 0;
    var dropMV = !!view.dropMV;
    var beatScale = view.beatScale || 1;
    var barHue = view.barHue || 0;
    // A FIXED PALETTE, shifted occasionally -- not a continuous rotation.
    // barHue advances 16 degrees every bar and is never wrapped, so over a
    // two-minute track this room walked the entire colour wheel several times
    // and no frame was ever the palette anyone authored: the ground went from
    // green to teal to violet while the sprites went with it. That is most of
    // why the art read as a muddy home-computer game rather than a console one
    // -- an NES holds four colours per tile and SWAPS between a few authored
    // sets, it does not slide between them.
    //
    // So the music still moves the palette, but at the structural level a game
    // would: a sibling offset every eight bars, mostly zero, never far enough
    // to leave the family. Beat and energy keep driving everything else.
    var HUE_STEPS = [0, 0, 0, -14, 14, -26];
    var _hueSeg = Math.floor((((cl && cl.bar) || 0)) / 8);
    var hueAll = (view.hueAll != null) ? view.hueAll
               : HUE_STEPS[((_hueSeg % HUE_STEPS.length) + HUE_STEPS.length) % HUE_STEPS.length];
    // ...and NONE of it on a console panel. There the palette IS the palette:
    // every colour is about to be snapped to the nearest of four shades or of
    // twenty-five scheme entries, so rotating the source first does not shift
    // the picture, it picks a DIFFERENT ENTRY. Measured: the canopy's green
    // turned a mere 26 degrees lands on the yellow family, and a wood comes out
    // yellow on cream with nothing between them. Quantise handed the unrotated
    // green a proper green at 0.50 luminance from the floor. The music still
    // moves the panel's look -- through which scheme the track selects, and
    // through beat and energy, which drive motion rather than hue.
    var _PH=(typeof CT_PAL!=='undefined')&&CT_PAL;
    if(_PH && _PH.installed) hueAll = 0;
    var dvec = view.dvec || {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
    var doorHalf = view.doorHalf == null ? 1 : view.doorHalf;   // exit opening = 2*doorHalf+1 tiles
    function roomExits(rx, ry){
      var exits = [];
      if(rx > 0 && st.world.horiz[(rx - 1) + '_' + ry] != null) exits.push({dir:'left', gx:rx - 1, gy:ry, gc:0, gr:st.world.horiz[(rx - 1) + '_' + ry]});
      if(rx < GW - 1 && st.world.horiz[rx + '_' + ry] != null) exits.push({dir:'right', gx:rx + 1, gy:ry, gc:COLS - 1, gr:st.world.horiz[rx + '_' + ry]});
      if(ry > 0 && st.world.vert[rx + '_' + (ry - 1)] != null) exits.push({dir:'up', gx:rx, gy:ry - 1, gc:st.world.vert[rx + '_' + (ry - 1)], gr:0});
      if(ry < GH - 1 && st.world.vert[rx + '_' + ry] != null) exits.push({dir:'down', gx:rx, gy:ry + 1, gc:st.world.vert[rx + '_' + ry], gr:ROWS - 1});
      return exits;
    }
    function currentRoomKey(){ return st.roomX + '_' + st.roomY; }
    function isCurrentRoomLocked(){
      var key = currentRoomKey();
      return !!(st.world.lockRooms && st.world.lockRooms[key] && !(st.unlockedRooms && st.unlockedRooms[key]));
    }
        // ============ DRAW ============
        // EVENT JUICE: micro screen-shake (room offset), decays fast; never a constant wobble.
        var shA=st._shake*cw*0.16;
        var ox=fieldX + (st._shake>0?(Math.sin(st.t*47)*shA):0), oy=fieldY + (st._shake>0?(Math.cos(st.t*41)*shA):0);
        var sxoff=0, syoff=0;
        if(st.trans>0 && st.transDir){
          if(st.transDir==='left'){ sxoff=-fieldW*st.trans; }
          else if(st.transDir==='right'){ sxoff=fieldW*st.trans; }
          else if(st.transDir==='up'){ syoff=-fieldH*st.trans; }
          else if(st.transDir==='down'){ syoff=fieldH*st.trans; }
        }
        function groundCol(theme){
          // BAR=PALETTE + PHRASE=family: rotate floor hue over bars (+ per-phrase offset). Stays the theme's character.
          // The GROUND IS LIGHT. It used to be a saturated mid-green -- the same
          // hue and nearly the same value as the trees standing on it -- so
          // foliage, floor and a green-tunicked hero all sat on top of each
          // other and nothing had a silhouette. Top-down console adventures put
          // pale ground under dark foliage precisely so the things that move are
          // the darkest and brightest objects on screen. Caves invert it: black
          // floor, bright everything else.
          var b;
          if(theme==='forest') b=['#E0C888','#D0B878'];
          else if(theme==='sand') b=['#F8E0B0','#E8D0A0'];
          else if(theme==='grave') b=['#48504A','#565E56'];
          else if(theme==='mountain') b=['#C8B090','#B8A080'];
          else if(theme==='cave') b=['#101010','#1C1C1C'];
          else if(theme==='armos') b=['#E8D8A0','#D8C890'];
          else b=['#E8D8A0','#D8C890'];
          // The floor is the FIELD. Its authored tones sit at ~0.30 luminance, so
          // by absolute mapping they became mid-ink and the whole dungeon was a
          // dark slab with dark sprites on it -- no Game Boy artist would spend
          // the darkest shades on ground the player walks over. Two adjacent
          // light shades give the floor its checker without taking ink from the
          // things that matter.
          var _P = (typeof CT_PAL !== 'undefined') && CT_PAL;
          // Same split as the foliage. On the Game Boy the ground has to BE the
          // field shade or the four-shade budget collapses; on the NES the
          // 'field' role is the backdrop register, which is the void behind the
          // tiles rather than anything you walk on -- letting the authored cream
          // through gives a floor instead of a hole.
          if(_P && _P.installed && _P.name==='dmg') return [_P.role('field'), _P.role('back')];
          return [hueRot(b[0],hueAll), hueRot(b[1],hueAll)];
        }
        function drawEnemy(o2,bx,by){
          var flash=(o2.flash>0 && ((st.t*30)|0)%2===0);
          // BEAT = PULSE: enemies swell on the beat (recentred so they don't drift).
          var enemyPulse=1+(beatScale-1)*(2.15+energyMV*0.9);
          var epx=cw*0.125*enemyPulse, egc=(epx-cw*0.125)*4;
          bx-=egc; by-=egc;
          if(o2.type==='octorok'){
            var bd=flash?'#FFFFFF':hueRot('#E04010',hueAll);
            pix([
              '..XXXX..',
              '.XXXXXX.',
              'XXWXXWXX',
              'XXWXXWXX',
              'XXXXXXXX',
              '.XXXXXX.',
              'X.X..X.X',
              'X......X'
            ], bx, by, epx, {X:bd, W:'#FCFCFC', '.':null});
            pix(['Y.Y'], bx+epx*2, by+epx*2.4, epx, {Y:'#101010'});
          } else if(o2.type==='tektite') {
            var tb=flash?'#FFFFFF':hueRot('#3CBCFC',hueAll), tl=flash?'#FFFFFF':hueRot('#1060C0',hueAll);
            var lift=o2.hop>0?-ch*0.12:0;
            pix([
              'L.L..L.L',
              '.L.LL.L.',
              '..XXXX..',
              '.XXXXXX.',
              '.XWXXWX.',
              '.XXXXXX.',
              'L.L..L.L',
              'L......L'
            ], bx, by+lift, epx, {X:tb, L:tl, W:'#FCFCFC', '.':null});
          } else if(o2.type==='moblin') {
            var mg=flash?'#FFFFFF':hueRot('#4CB438',hueAll), mt=flash?'#FFFFFF':hueRot('#8C5020',hueAll), ms=hueRot('#E0A060',hueAll);
            pix([
              '..GGGG..',
              '.GGGGGG.',
              'GGWGGWGG',
              'GGGGGGGG',
              '.TTTTTT.',
              '.TSSSST.',
              '..T..T..',
              '.TT..TT.'
            ], bx, by, epx, {G:mg,T:mt,S:ms,W:'#101010','.':null});
          } else if(o2.type==='keese') {
            var kc=flash?'#FFFFFF':hueRot('#5C3088',hueAll), kw=flash?'#FFFFFF':hueRot('#8C60D0',hueAll);
            var klift=Math.sin(st.t*10+o2.seed)*ch*0.05 + (o2.hop>0?-ch*0.08:0);
            pix([
              'W......W',
              'WW....WW',
              '.WWXXWW.',
              '..WXXW..',
              '..WXXW..',
              '.WW..WW.',
              'WW....WW',
              'W......W'
            ], bx, by+klift, epx, {X:kc,W:kw,'.':null});
          } else if(o2.type==='zora') {
            var zc=flash?'#FFFFFF':hueRot('#3CBCFC',hueAll), zd=flash?'#FFFFFF':hueRot('#0058A8',hueAll), zw='#B8F8F8';
            var zwave=Math.sin(st.t*5+o2.phase)*ch*0.05;
            pix([
              '..DDDD..',
              '.DXXXXD.',
              'DXWXXWXD',
              'DXXXXXXD',
              '.DXXXXD.',
              '..DXXD..',
              '.D....D.',
              'D......D'
            ], bx, by+zwave, epx, {X:zc,D:zd,W:zw,'.':null});
          } else if(o2.type==='ghini') {
            var gc0=flash?'#FFFFFF':hueRot('#E8E8F8',hueAll), gs=flash?'#FFFFFF':hueRot('#A870D8',hueAll);
            var floatY=Math.sin(st.t*4+o2.phase)*ch*0.08 + (o2.hop>0?-ch*0.05:0);
            pix([
              '..GGGG..',
              '.GGGGGG.',
              'GGSGGSGG',
              'GGGGGGGG',
              'GGGGGGGG',
              'GGGGGGGG',
              'GG.GG.GG',
              'G..G..G.'
            ], bx, by+floatY, epx, {G:gc0,S:'#101018','.':null});
            pix(['S.S'], bx+epx*2, by+floatY+epx*5.1, epx, {S:gs,'.':null});
          } else if(o2.type==='stalfos') {
            var bc0=flash?'#FFFFFF':'#F0F0D8', bs=flash?'#FFFFFF':hueRot('#808070',hueAll);
            pix([
              '..BBBB..',
              '.B.B.B.',
              '.BBBBB.',
              '..B.B..',
              '.SBBBB.S',
              'S.BBBB.S',
              '..B.B..',
              '.BB.BB.'
            ], bx, by, epx, {B:bc0,S:bs,'.':null});
          } else if(o2.type==='gel') {
            var gl=flash?'#FFFFFF':hueRot('#40D0F0',hueAll), gd=flash?'#FFFFFF':hueRot('#0060A8',hueAll);
            var ghop=(o2.hop>0?-ch*0.07:0);
            pix([
              '........',
              '..DDDD..',
              '.DXXXXD.',
              'DXXXXXXD',
              'DXWXXWXD',
              '.DXXXXD.',
              '..DDDD..',
              '........'
            ], bx, by+ghop, epx, {X:gl,D:gd,W:'#101018','.':null});
          } else if(o2.type==='deku') {
            var dc=flash?'#FFFFFF':hueRot('#48A830',hueAll), dw=flash?'#FFFFFF':hueRot('#7C4810',hueAll);
            pix([
              '..LLLL..',
              '.LLLLLL.',
              'LLWLLWLL',
              'LLLDDLLL',
              '..DDDD..',
              '.DDDDDD.',
              '..D..D..',
              '.DD..DD.'
            ], bx, by, epx, {L:dc,D:dw,W:'#101018','.':null});
          } else if(o2.type==='armosKnight') {
            var ac=flash?'#FFFFFF':hueRot('#B8B8A8',hueAll), ad=flash?'#FFFFFF':hueRot('#686858',hueAll), ae='#101018';
            pix([
              '..DDDD..',
              '.DCCCCD.',
              'DCWCCWCD',
              'DCCCCCCD',
              '.DCCCCD.',
              '..DCCD..',
              '.DD..DD.',
              'DD....DD'
            ], bx, by, epx, {C:ac,D:ad,W:ae,'.':null});
          } else {
            var lc=flash?'#FFFFFF':hueRot('#D86040',hueAll), ld=flash?'#FFFFFF':hueRot('#983820',hueAll), ls=hueRot('#D8B868',hueAll);
            var rise=(Math.sin(st.t*4+o2.seed)*0.5+0.5)*ch*0.06 + (o2.hop>0?-ch*0.08:0);
            pix([
              '..XXXX..',
              '.XXXXXX.',
              'XXWXXWXX',
              'XXXXXXXX',
              '.XXXXXX.',
              '..DDDD..',
              '.SSSSSS.',
              'SS....SS'
            ], bx, by-rise, epx, {X:lc,D:ld,S:ls,W:'#101010','.':null});
          }
        }
        function drawHero(lx,ly){
          var blink=(hero.hurt>0 && ((st.t*24)|0)%2===0);
          if(blink) return;
          // Ten rows, not eight, and a colour that is nobody else's. The hero
          // was a seven-pixel smudge in the same green as the trees he walks
          // past: a cap and a tunic in one hue, no arms, no boots, and at that
          // size the head was two rows. A console adventure gives its player a
          // cap, a face, arms and boots you can count -- that is what makes a
          // 16-pixel figure read as a person rather than a token.
          // SIXTEEN BY SIXTEEN, which is what a character sprite of this era
          // actually is. It was 8 wide by 10 tall, and at that size the head ate
          // six of the ten rows: a bobblehead on a stub of a body with two-pixel
          // arms. No amount of redrawing fixes proportions inside a grid that
          // small -- there is nowhere to put a shoulder. One sprite pixel per
          // framebuffer pixel on the Game Boy panel, four times the detail, and
          // the figure is still one tile wide.
          //
          // The proportions are the genre's rules rather than any one game's
          // art: head about two fifths of the height, shoulders at least as wide
          // as the cap above them, arms inside the body's own silhouette, legs
          // long enough to swap. Get those wrong and the figure reads as unwell
          // however carefully the pixels are placed.
          var px=Math.max(1,Math.round(cw/16));
          var bx=lx-px*8, by=ly-px*11;
          var T='#00D800', S='#FCB890', B='#301C08';
          // Full health used to swap the tunic for a pale mint. That was an
          // accent when the cap was a separate colour; now that cap and tunic
          // share one it repainted the entire figure, and mint sits close enough
          // to the skin tone that the hero became one pale blob with two boots.
          // A brighter GREEN says the same thing without costing the silhouette.
          if(hero.hp>=hero.maxhp){ T='#00F838'; }
          var E=B;                                     // outline and boots share the dark

          // A WALK CYCLE, driven by distance covered rather than by the clock,
          // so the legs step with the movement and stop dead when he does -- a
          // timer-driven cycle moonwalks on the spot the moment he stands still.
          // px/py interpolate between tiles, so their sum IS the distance walked.
          var _mv = Math.abs(hero.px-hero.c)>0.02 || Math.abs(hero.py-hero.r)>0.02 || !!hero.moveHold;
          var _ph = _mv ? (Math.floor(((hero.px||0)+(hero.py||0))*3.2) & 1) : 0;

          // PROPORTIONS, which is the whole of it. The figure was twelve wide by
          // thirteen tall -- nearly SQUARE -- with the head taking half of it,
          // and no arrangement of pixels rescues that: a square figure with a
          // huge head reads as unwell however carefully it is drawn. Narrow the
          // torso to eight (twelve only at the hands), keep the head to two
          // fifths, and use all sixteen rows so there are legs to walk on.
          //
          // These are the genre's construction rules rather than any one game's
          // artwork: cap brim wider than the face beneath it, shoulders under
          // the brim, hands inside the silhouette, a belt so the tunic is not
          // one slab, and three rows of leg so a stride has somewhere to happen.
          var body, legs;
          if(hero.dir==='down'){
            body=['................',
                  '.....TTTTTT.....',
                  '....TTTTTTTT....',
                  '...TTTTTTTTTT...',
                  '.....SSSSSS.....',
                  '.....SESSES.....',
                  '......SSSS......',
                  '....TTTTTTTT....',
                  '..SSTTTTTTTTSS..',
                  '..SSTTTTTTTTSS..',
                  '....TBBBBBBT....',
                  '....TTTTTTTT....',
                  '.....TTTTTT.....'];
            legs=[['.....TT..TT.....','.....TT..TT.....','.....BB..BB.....'],
                  ['....TT....TT....','....TT....TT....','....BB....BB....']];
          } else if(hero.dir==='up'){
            body=['................',
                  '.....TTTTTT.....',
                  '....TTTTTTTT....',
                  '...TTTTTTTTTT...',
                  '.....TTTTTT.....',
                  '.....TTTTTT.....',
                  '......TTTT......',
                  '....TTTTTTTT....',
                  '..SSTTTTTTTTSS..',
                  '..SSTTTTTTTTSS..',
                  '....TBBBBBBT....',
                  '....TTTTTTTT....',
                  '.....TTTTTT.....'];
            legs=[['.....TT..TT.....','.....TT..TT.....','.....BB..BB.....'],
                  ['....TT....TT....','....TT....TT....','....BB....BB....']];
          } else if(hero.dir==='left'){
            body=['................',
                  '....TTTTTT......',
                  '...TTTTTTT......',
                  '..TTTTTTTTT.....',
                  '...SSSSSS.......',
                  '..SESSSS........',
                  '...SSSS.........',
                  '...TTTTTT.......',
                  '.SSTTTTTT.......',
                  '.SSTTTTTT.......',
                  '...TBBBBT.......',
                  '...TTTTTT.......',
                  '....TTTT........'];
            legs=[['....TT.TT.......','....TT.TT.......','....BB.BB.......'],
                  ['...TT...TT......','...TT...TT......','...BB...BB......']];
          } else {
            body=['................',
                  '......TTTTTT....',
                  '......TTTTTTT...',
                  '.....TTTTTTTTT..',
                  '.......SSSSSS...',
                  '........SSSSES..',
                  '.........SSSS...',
                  '.......TTTTTT...',
                  '.......TTTTTTSS.',
                  '.......TTTTTTSS.',
                  '.......TBBBBT...',
                  '.......TTTTTT...',
                  '........TTTT....'];
            legs=[['.......TT.TT....','.......TT.TT....','.......BB.BB....'],
                  ['......TT...TT...','......TT...TT...','......BB...BB...']];
          }
          var spr=body.concat(legs[_ph]);
          // half a sprite-pixel of lift on the off step: the difference between
          // a figure that walks and one that slides along the floor
          if(_mv && _ph) by -= px*0.5;
          // The PLAYER, given the highest contrast on screen so it never reads
          // as one more creature: white body, hard black outline.
          var _PL=(typeof CT_PAL!=='undefined')&&CT_PAL;
          // Three entries, matching the three colours the sprite is drawn in.
          // 'C' was the separate cap colour and the sprite has not used it since
          // cap and tunic merged; leaving it in the map referenced a variable
          // that no longer existed and threw on the first frame.
          var _lmap={T:T,S:S,B:B,E:E,'.':null};
          if(_PL&&_PL.installed) _lmap=_PL.heroMap(_lmap);
          pix(spr, bx, by, px, _lmap);
          if(hero.swing>0){ var sv3=dvec[hero.dir];
            var _PS=(typeof CT_PAL!=='undefined')&&CT_PAL;
            if(_PS&&_PS.installed){
              // A BLADE. This was four 2px dots spaced along the swing arc --
              // at Game Boy size that is four specks, and nothing on screen
              // said "he swung a sword". One solid bar a tile long, in ink,
              // with a lit edge: readable in a single frame, which is all the
              // swing lasts.
              var bl=Math.round(cw*0.95), bt=Math.max(2,Math.round(ch*0.28));
              var horiz=sv3[0]!==0;
              var bw2=horiz?bl:bt, bh2=horiz?bt:bl;
              var bx2=lx+(horiz?(sv3[0]>0?cw*0.3:-bl-cw*0.3+cw*0.3):-bw2*0.5);
              var by2=ly+(horiz?-bh2*0.5:(sv3[1]>0?ch*0.3:-bl-ch*0.3+ch*0.3));
              rrect(bx2,by2,bw2,bh2,_PS.role('ink'));
              rrect(bx2+1,by2+1,Math.max(1,bw2-2),Math.max(1,bh2-2),_PS.role('field'));
            } else {
              var k,len=4;
              for(k=0;k<len;k++){ rrect(lx+sv3[0]*(cw*0.25+k*cw*0.14)-cw*0.05, ly+sv3[1]*(ch*0.25+k*ch*0.14)-ch*0.05, cw*0.12, ch*0.12, k===len-1?'#FCFCFC':'#C0C0E0'); }
            }
          }
        }
        function drawRoom(rg,theme,offx,offy,enemies2,rocks2,picks2,drawActors){
          var gc=groundCol(theme), r,c;
          // hueAll + theme are constant for the whole call: build each tile palette ONCE instead of
          // per-tile inside the 16x11 loop (same strings reach pix(), so output is bit-identical).
          var _PD=(typeof CT_PAL!=='undefined')&&CT_PAL;
          // SCENERY IS NOT A SPRITE. pix() hands its colour map to
          // CT_PAL.spriteMap(), which ranks a sprite's own colours and drops
          // them into a SPRITE sub-palette picked from their average hue -- the
          // right thing for an enemy, whose job is to be one readable creature,
          // and quite wrong for a tile. It repainted the wood into whichever
          // sprite family it landed on: pale blue on a cream floor, whatever the
          // authored green was.
          //
          // spriteMap passes a map through untouched when every colour is
          // already an exact palette entry, so quantising here says "this colour
          // was chosen, keep it" -- and quantise honours hue, which is the whole
          // point. Sprites still get ranked; the ground they stand on does not.
          var _q=(_PD&&_PD.installed) ? function(c){ return _PD.quantize(c); } : function(c){ return c; };
          var rockMap={A:_q(hueRot('#B07838',hueAll)),B:_q(hueRot('#5C3408',hueAll)),C:_q(hueRot('#C88C48',hueAll)),D:_q(hueRot('#F0C070',hueAll))};
          // Explicit roles, not ranked: with three colours the rank spread put the
          // wall BODY on the lightest ink shade and the band read as pale trim.
          // A room wall is the darkest thing on screen with a lit cap.
          var wallMap=(_PD&&_PD.installed)
            ? {A:_PD.role('ink'), B:_PD.role('ink'), D:_PD.role('fore')}
            : {A:hueRot('#8C6428',hueAll),B:hueRot('#40240A',hueAll),D:hueRot('#E0BC80',hueAll)};
          var stumpMap={A:_q(hueRot('#5C3408',hueAll)),B:_q(hueRot('#A06830',hueAll)),C:_q(hueRot('#D0A060',hueAll)),'.':null};
          // Foliage is the DARK mass on a light floor, with a darker stipple for
          // texture -- two greens and a trunk, the way a console tileset does it.
          var leafC=hueRot(theme==='grave'?'#4C5820':'#00A800',hueAll), leaf2C=hueRot(theme==='grave'?'#2C3410':'#006018',hueAll), barkC=hueRot('#7C4810',hueAll);
          // ROLES ON THE GAME BOY, HUE ON THE NES. A role is a contrast rank
          // against the field and carries no colour meaning -- which is exactly
          // right for four grey shades and exactly wrong for twenty-five. Asking
          // for role('fore') painted the canopy in whatever sat two thirds of the
          // way up the contrast order: measured, orange in the overworld scheme
          // and pink in the rose one, which is how a wood ends up looking like
          // soft toys. The NES has enough colours to say green, so it is told
          // green and quantise picks the nearest the scheme actually holds.
          var treeMap=(_PD&&_PD.installed&&_PD.name==='dmg')
            ? {L:_PD.role('fore'), H:_PD.role('back'), B:_PD.role('back'), '.':null}
            : {L:_q(leafC),H:_q(leaf2C),B:_q(barkC),'.':null};
          var graveMap={A:_q(hueRot('#7C4810',hueAll)),B:_q(hueRot('#C07818',hueAll)),C:_q('#000000'),'.':null};
          for(r=0;r<ROWS;r++){ for(c=0;c<COLS;c++){
            var x=ox+offx+c*cw, y=oy+offy+r*ch, t=rg[r][c];
            var tpix=Math.min(cw,ch)/8, tx0=x+(cw-tpix*8)*0.5, ty0=y+(ch-tpix*8)*0.5;
            rrect(x,y,cw+1,ch+1,gc[0]);
            // Floor texture the way a Game Boy top-down game does it: a small,
            // REGULAR mark one shade in, repeated every tile. The old version
            // filled half of every other tile, which at 16px reads as a coarse
            // checkerboard fighting the sprites rather than as ground.
            // ONE small mark a tile. Two of them on opposite corners tiled into
            // a dense speckle that fought every sprite standing on it, and at
            // four shades a bigger mark just makes the floor a dotted grid.
            var dp=Math.max(1,Math.round(tpix));
            rrect(x+dp*3,y+dp*3,dp,dp,gc[1]);
            if(t===3){
              var wv=Math.sin(st.t*5.2+c*1.6+r*0.9+(cl.bar||0)*0.7)*ch*(0.035+energyMV*0.025);
              var wv2=Math.sin(st.t*3.4+c*0.8-r*1.1)*ch*0.025;
              var waterCol=(theme==='cave'||theme==='grave')?'#0C4CA8':'#2C98E0';
              rrect(x,y,cw+1,ch+1,waterCol);
              // Opaque ripple bands. These were translucent washes, which a Game
              // Boy cannot draw at all -- 1-bit alpha simply deletes them, so the
              // water was a flat slab with no surface.
              rrect(x+cw*0.08,y+ch*0.18+wv,cw*0.48,ch*0.11,'#BEEFFC');
              rrect(x+cw*0.44,y+ch*0.55+wv2,cw*0.42,ch*0.10,'#0C54B0');
              if(beatScale>1.001) rrect(x+cw*0.12,y+ch*0.34,cw*0.76,ch*0.08,'rgba(255,255,255,'+Math.min(0.2,(beatScale-1)*5).toFixed(3)+')');
            }
            else if(t===8){
              var bw=Math.sin(st.t*4.4+c*1.1+r)*ch*0.025;
              rrect(x,y,cw+1,ch+1,'#2C98E0');
              rrect(x+cw*0.12,y+ch*0.24+bw,cw*0.42,ch*0.09,'rgba(180,240,252,0.55)');
              rrect(x,y,cw+1,ch+1,'#B07838');
              rrect(x+cw*0.08,y,cw*0.84,ch*0.16,'#7C4810'); rrect(x+cw*0.08,y+ch*0.84,cw*0.84,ch*0.16,'#7C4810');
            }
            if(t===1){
              // A WALL, not a brick. The old tile had notches and gaps on every
              // edge, so a room border drew as a row of separate rocks; these
              // butt together into a continuous band with a single lit top-left
              // edge, which is what makes a room read as a room.
              // Lit edge on the TOP ROW ONLY. Lighting each tile's left column
              // too drew a seam down every tile boundary, so a wall came out as
              // a row of separate bricks instead of one band.
              pix([
                'DDDDDDDD',
                'AAAAAAAA',
                'AAAAAAAA',
                'AAAAAAAA',
                'AAAAAAAA',
                'AAAAAAAA',
                'AAAAAAAA',
                'BBBBBBBB'
              ], tx0, ty0, tpix, wallMap);
            }
            else if(t===5){
              pix([
                '........',
                '..AAAA..',
                '.ABBBBA.',
                'ABBCBBBA',
                'ABBBBBAA',
                '.ABCCBA.',
                '..AAAA..',
                '........'
              ], tx0, ty0, tpix, stumpMap);
            }
            else if(t===2){
              var tp=1+(beatScale-1)*(1.8+energyMV);
              var tbob=Math.sin(st.t*2.4+c*0.9+r*0.7)*cw*0.035 + (beatScale-1)*cw*0.35;
              var tw=cw*tp, th=ch*tp, tx=x-(tw-cw)*0.5+tbob, ty=y-(th-ch)*0.35;
              
              // Canopy to the tile edges so neighbouring trees butt into one
              // wood rather than a field of separate mushrooms. The old tile was
              // inset two pixels on every side with a fat trunk under it, which
              // at this size read as a row of toadstools.
              pix([
                '.LLLLLL.',
                'LLLLLLLL',
                'LLHLLHLL',
                'LLLLLLLL',
                'LLHLLHLL',
                'LLLLLLLL',
                '.LLBBLL.',
                '...BB...'
              ], tx+(tw-tpix*8)*0.5, ty+(th-tpix*8)*0.5, tpix*tp, treeMap);
            }
            else if(t===6){
              pix([
                '..AAAA..',
                '.ABBBBA.',
                'ABCDDCBA',
                'ABBBBBBA',
                '.ABBBBA.',
                '..ABBA..',
                '.AA..AA.',
                'AA....AA'
              ], tx0, ty0, tpix, {A:'#5C5C50',B:'#A8A890',C:'#101018',D:'#101018','.':null});
            }
            else if(t===7){
              pix([
                '........',
                '..AAAA..',
                '.AAAAAA.',
                '.ABBBBA.',
                '.ABCCBA.',
                '.ABBBBA.',
                'AAAAAAAA',
                '.A....A.'
              ], tx0, ty0, tpix, {A:'#B8B8B0',B:'#8C8C84',C:'#4C4C48','.':null});
            }
            else if(t===4){
              pix([
                '..AAAA..',
                '.AABBAA.',
                'AABBBBAA',
                'ABCCCCBA',
                'ABCCCCBA',
                'ABCCCCBA',
                'AABCCBAA',
                'AAAAAAAA'
              ], tx0, ty0, tpix, graveMap);
            }
            // BEAT = PULSE: obstacle tiles get a subtle beat-driven highlight rim (no scale -> grid stays readable).
            if((t===1||t===5||t===6||t===7) && beatScale>1.001){
              var gl=(beatScale-1)*(0.6+0.5*energyMV), gp=cw*0.5*Math.min(0.18,gl*4);
              rrect(x+gp,y+gp,(cw+1)-gp*2,(ch+1)-gp*2,'rgba(255,250,220,'+(gl*3).toFixed(3)+')');
            }
          }}
          if(drawActors && isCurrentRoomLocked()){
            // The locked door must cover the WHOLE carved opening, not just its centre tile —
            // the lock gates the entire exit, so anything less draws open ground the hero
            // cannot actually walk through.
            var lex=roomExits(st.roomX,st.roomY), li, lk;
            for(li=0;li<lex.length;li++){
              var ex=lex[li], sideways=(ex.dir==='left'||ex.dir==='right');
              for(lk=-doorHalf;lk<=doorHalf;lk++){
                var dc=sideways?ex.gc:(ex.gc+lk), dr=sideways?(ex.gr+lk):ex.gr;
                if(dc<0||dc>=COLS||dr<0||dr>=ROWS) continue;
                var dx=ox+offx+dc*cw, dy=oy+offy+dr*ch;
                rrect(dx+cw*0.08,dy+ch*0.08,cw*0.84,ch*0.84,'#5C3408');
                rrect(dx+cw*0.16,dy+ch*0.16,cw*0.68,ch*0.68,'#B07838');
                if(sideways){
                  rrect(dx+cw*0.44,dy+ch*0.16,cw*0.12,ch*0.68,'#3C2408');
                } else {
                  rrect(dx+cw*0.16,dy+ch*0.44,cw*0.68,ch*0.12,'#3C2408');
                }
                if(lk===0){
                  rrect(dx+cw*0.44,dy+ch*0.38,cw*0.12,ch*0.12,'#101010');
                  rrect(dx+cw*0.48,dy+ch*0.48,cw*0.04,ch*0.18,'#101010');
                }
              }
            }
          }
          if(!drawActors) return;
          var i;
          for(i=0;i<picks2.length;i++){ var pk=picks2[i]; var px2=ox+offx+(pk.c+0.5)*cw, py2=oy+offy+(pk.r+0.5)*ch; var bob=Math.sin(pk.t*8)*ch*0.06;
            var bx2=px2-cw*0.3, by2=py2-ch*0.3+bob;
            if(pk.type==='heart'){
              pix(['.X.X.','XXXXX','XXXXX','.XXX.','..X..'], bx2, by2, cw*0.12, {X:'#E04010','.':null});
            } else if(pk.type==='bomb'){
              pix(['..FF.','...F.','.XXX.','XXXXX','XXXXX','.XXX.'], bx2, by2, cw*0.1, {X:'#283038', F:'#F8B800','.':null});
            } else if(pk.type==='key'){
              pix(['..XX.','..XX.','..XX.','XXXXX','..XX.','..XX.','..X.X'], bx2, by2-ch*0.05, cw*0.1, {X:'#F8D850','.':null});
            } else {
              pix(['.X.','XXX','XXX','XXX','.X.'], bx2+cw*0.05, by2, cw*0.13, {X:'#40D040','.':null});
              pix(['.L.','.L.'], bx2+cw*0.16, by2+ch*0.04, cw*0.13, {L:'#B8F8B8','.':null});
            }
          }
          for(i=0;i<enemies2.length;i++){ var o2=enemies2[i]; if(!o2.alive && o2.flash<=0) continue;
            drawEnemy(o2, ox+offx+(o2.c+0.05)*cw, oy+offy+(o2.r+0.02)*ch);
          }
          for(i=0;i<rocks2.length;i++){ var rp=rocks2[i];
            if(rp.kind==='spear'){
              var sx=(rp.vx||0), sy=(rp.vy||0), horizontal=Math.abs(sx)>Math.abs(sy);
              if(horizontal){
                rrect(ox+offx+rp.x-cw*0.34, oy+offy+rp.y-ch*0.04, cw*0.68, ch*0.08, '#C8A060');
                rrect(ox+offx+rp.x+(sx>0?cw*0.2:-cw*0.28), oy+offy+rp.y-ch*0.08, cw*0.16, ch*0.16, '#F8D850');
              } else {
                rrect(ox+offx+rp.x-cw*0.04, oy+offy+rp.y-ch*0.34, cw*0.08, ch*0.68, '#C8A060');
                rrect(ox+offx+rp.x-cw*0.08, oy+offy+rp.y+(sy>0?ch*0.2:-ch*0.28), cw*0.16, ch*0.16, '#F8D850');
              }
            } else if(rp.kind==='wave'){
              var wa=0.55+0.25*Math.sin(st.t*12+rp.t*8);
              rrect(ox+offx+rp.x-cw*0.18, oy+offy+rp.y-ch*0.18, cw*0.36, ch*0.36, 'rgba(120,220,252,'+wa.toFixed(3)+')');
              rrect(ox+offx+rp.x-cw*0.1, oy+offy+rp.y-ch*0.1, cw*0.2, ch*0.2, '#F8F8F8');
            } else if(rp.kind==='seed'){
              pix(['.X.','XXX','.X.'], ox+offx+rp.x-cw*0.16, oy+offy+rp.y-ch*0.16, cw*0.11, {X:'#48D848','.':null});
            } else {
              pix(['.X.','XXX','.X.'], ox+offx+rp.x-cw*0.18, oy+offy+rp.y-ch*0.18, cw*0.12, {X:'#C8A060','.':null});
            }
          }
        }
        function drawItemIcon(type,cx,cy,scale){
          var sz=cw*scale;
          if(type==='heart'){
            pix(['.X.X.','XXXXX','XXXXX','.XXX.','..X..'], cx-sz*2.5, cy-sz*2.5, sz, {X:'#E04010','.':null});
          } else if(type==='bomb'){
            pix(['..FF.','...F.','.XXX.','XXXXX','XXXXX','.XXX.'], cx-sz*2.5, cy-sz*3, sz, {X:'#283038', F:'#F8B800','.':null});
          } else if(type==='key'){
            pix(['..XX.','..XX.','..XX.','XXXXX','..XX.','..XX.','..X.X'], cx-sz*2.5, cy-sz*3.5, sz, {X:'#F8D850','.':null});
          } else if(type==='relic'){
            pix(['..X..','.XXX.','XXXXX','.....','.X.X.','XXXXX'], cx-sz*2.5, cy-sz*3, sz, {X:'#F8D850','.':null});
          } else {
            pix(['.X.','XXX','XXX','XXX','.X.'], cx-sz*1.5, cy-sz*2.5, sz, {X:'#40D040','.':null});
            pix(['.L.','.L.'], cx-sz*0.5, cy-sz*1.8, sz, {L:'#B8F8B8','.':null});
          }
        }
        function drawBombs(bombs,offx,offy){
          var i;
          for(i=0;i<bombs.length;i++){
            var bm=bombs[i], cx=ox+offx+(bm.c+0.5)*cw, cy=oy+offy+(bm.r+0.5)*ch;
            if(bm.exploded){
              var bp=Math.max(0,bm.blast/0.36), rad=cw*(1.25-bp*0.25), al=0.25+bp*0.45;
              rrect(cx-rad,cy-ch*0.13,rad*2,ch*0.26,'rgba(255,240,150,'+al.toFixed(3)+')');
              rrect(cx-cw*0.13,cy-rad,cw*0.26,rad*2,'rgba(255,240,150,'+al.toFixed(3)+')');
              rrect(cx-rad*0.55,cy-rad*0.55,rad*1.1,rad*1.1,'rgba(255,120,40,'+(bp*0.25).toFixed(3)+')');
            } else {
              var fuse=Math.max(0,1-bm.t/0.95), wob=Math.sin(st.t*22)*cw*0.03;
              pix(['..FF.','...F.','.XXX.','XXXXX','XXXXX','.XXX.'], cx-cw*0.27+wob, cy-ch*0.34, cw*0.09, {X:'#202830', F:fuse>0.35?'#F8D850':'#FCFCFC','.':null});
            }
          }
        }
        function drawInterior(it){
          var shop=it.type==='shop';
          rrect(ox,oy,fieldW,fieldH,shop?'#0C0808':'#080818');
          var ix=ox+fieldW*0.17, iy=oy+fieldH*0.16, iw=fieldW*0.66, ih=fieldH*0.68;
          rrect(ix,iy,iw,ih,shop?'#3C2408':'#182050');
          rrect(ix+cw*0.25,iy+ch*0.25,iw-cw*0.5,ih-ch*0.5,shop?'#6B3E1E':'#282870');
          var col1=shop?'#A06830':'#5454A8', col2=shop?'#C07818':'#8C8CE0';
          for(var tc=0;tc<12;tc++){
            rrect(ix+tc*(iw/12),iy,iw/24,ch*0.4,col1);
            rrect(ix+tc*(iw/12),iy+ih-ch*0.4,iw/24,ch*0.4,col1);
          }
          if(shop){
            rrect(ix+iw*0.28,iy+ih*0.38,iw*0.44,ih*0.14,'#8C5020');
            rrect(ix+iw*0.28,iy+ih*0.34,iw*0.44,ih*0.08,'#C88C48');
            pix(['..AAAA..','.AABBAA.','AABBBBAA','ABCCCCBA','ABCCCCBA','ABCCCCBA','AABCCBAA','AAAAAAAA'], ix+iw*0.43, iy+ih*0.24, Math.min(cw,ch)*0.12, {A:'#7C4810',B:'#C07818',C:'#000000','.':null});
          } else {
            rrect(ix+iw*0.12,iy+ih*0.20,cw*0.28,ch*1.2,'#F8B800');
            rrect(ix+iw*0.84,iy+ih*0.20,cw*0.28,ch*1.2,'#F8B800');
            rrect(ix+iw*0.12,iy+ih*0.18,cw*0.5,ch*0.26,'#F86020');
            rrect(ix+iw*0.82,iy+ih*0.18,cw*0.5,ch*0.26,'#F86020');
          }
          if(!it.given){
            var lift=Math.sin(st.t*6)*ch*0.06;
            drawItemIcon(it.item,ox+fieldW*0.5,iy+ih*(shop?0.33:0.42)+lift,0.12);
          }
          var walk=Math.min(1,it.t/0.75);
          drawHero(ox+fieldW*0.5,iy+ih*(0.78-walk*0.18));
        }
        rrect(ox,oy,fieldW,fieldH,'#000000');
        if(st.interior){
          drawInterior(st.interior);
        } else {
          drawRoom(grid,st.theme,sxoff,syoff,st.enemies,st.rocks,st.pickups,true);
          if(st.trans>0 && st.prevGrid){
            var poffx=sxoff, poffy=syoff;
            if(st.transDir==='left') poffx=sxoff+fieldW;
            else if(st.transDir==='right') poffx=sxoff-fieldW;
            else if(st.transDir==='up') poffy=syoff+fieldH;
            else if(st.transDir==='down') poffy=syoff-fieldH;
            drawRoom(st.prevGrid,st.prevTheme,poffx,poffy,st.prevEnemies||[],st.prevRocks||[],st.prevPickups||[],false);
          }
          drawBombs(st.placedBombs||[],sxoff,syoff);
          // EVENT JUICE: kill bursts — tiny expanding ring at each recent defeat (current room only).
          var bi2;
          for(bi2=0;bi2<st._bursts.length;bi2++){ var bu=st._bursts[bi2]; var bp=bu.t/0.35;
            var bcx=ox+sxoff+(bu.c+0.5)*cw, bcy=oy+syoff+(bu.r+0.5)*ch, br=cw*(0.2+bp*0.6), ba=(1-bp)*0.8;
            rrect(bcx-br,bcy-br*0.18,br*2,br*0.36,'rgba(252,252,200,'+ba.toFixed(3)+')');
            rrect(bcx-br*0.18,bcy-br,br*0.36,br*2,'rgba(252,252,200,'+ba.toFixed(3)+')');
          }
          if(st.win<=0){
            var lx=ox+sxoff+(hero.px+0.5)*cw, ly=oy+syoff+(hero.py+0.5)*ch;
            drawHero(lx,ly);
          }
        }
        if(st.win>0){
          var fade=Math.min(1,(2.6-st.winTimer)/2.6);
          rrect(ox,oy,fieldW,fieldH,'rgba(0,0,0,'+(fade*0.85)+')');
          var cxl=ox+fieldW*0.5, cyl=oy+fieldH*0.4;
          pix([
            '..XXXX..',
            '.XXXXXX.',
            '.XXXXXX.',
            '..XXXX..'
          ], cxl-cw*0.5, cyl, cw*0.12, {X:'#1E7818','.':null});
        }
        // EVENT JUICE only; health, keys and minimap are intentionally omitted.
        // A Game Boy does not white out the screen. This was a translucent
        // full-field wash, and with 1-bit alpha it snaps to FULLY OPAQUE white
        // the moment the flash passes half -- the room vanished on every swing,
        // and being screen-covering it also claimed the field shade. Skipped on
        // the panel; hardware would flicker the sprite instead.
        var _PF=(typeof CT_PAL!=='undefined')&&CT_PAL;
        if(st.flash>0.01 && !(_PF&&_PF.installed)) rrect(ox,oy,fieldW,fieldH,'rgba(255,250,235,'+(Math.min(0.5,st.flash*0.45)).toFixed(3)+')');
        return st;
  }

  var api = {
    packVersion: 3,
    key: 'dungeon',
    adapter: 'custom-canvas-pack',
    render: render,
    dispose: function(){},
    performance: {
      maxEntities: 64,
      maxParticles: 24,
      maxEventsPerFrame: 12,
      usesReactStatePerFrame: false
    }
  };

  VisualizerGame.layer('dungeon', 'renderer', api);
  return api;
})();
