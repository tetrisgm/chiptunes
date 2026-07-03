// ZELDA renderer. Presentation only; consumes ZeldaDefinition's zeldaView payload.
const ZeldaRenderer = (function(){
  function render(ctx){
    ctx = ctx || {};
    var view = ctx.zeldaView || {};
    var A = view.A || ctx.A || {x:0,y:0,w:0,h:0};
    var U = view.U || ctx.U || 8;
    var st = view.st || ctx.state;
    if(!st) return undefined;
    var COLS = view.COLS || st.COLS || 16;
    var ROWS = view.ROWS || st.ROWS || 11;
    var GW = view.GW || st.GW || 6;
    var GH = view.GH || st.GH || 5;
    var cw = view.cw || st.cw || (A.w / COLS);
    var ch = view.ch || st.ch || (A.h / ROWS);
    var grid = view.grid || st.grid;
    var link = view.link || st.link || {};
    var clk = view.clk || {};
    var cl = view.cl || {};
    var energyMV = view.energyMV || 0;
    var dropMV = !!view.dropMV;
    var beatScale = view.beatScale || 1;
    var barHue = view.barHue || 0;
    var hueAll = view.hueAll == null ? barHue : view.hueAll;
    var dvec = view.dvec || {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
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
        var ox=A.x + (st._shake>0?(Math.sin(st.t*47)*shA):0), oy=A.y + (st._shake>0?(Math.cos(st.t*41)*shA):0);
        var sxoff=0, syoff=0;
        if(st.trans>0 && st.transDir){
          if(st.transDir==='left'){ sxoff=-A.w*st.trans; }
          else if(st.transDir==='right'){ sxoff=A.w*st.trans; }
          else if(st.transDir==='up'){ syoff=-A.h*st.trans; }
          else if(st.transDir==='down'){ syoff=A.h*st.trans; }
        }
        function groundCol(theme){
          // BAR=PALETTE + PHRASE=family: rotate floor hue over bars (+ per-phrase offset). Stays the theme's character.
          var b;
          if(theme==='forest') b=['#2E6810','#3C7A18'];
          else if(theme==='sand') b=['#D8B868','#E8C880'];
          else if(theme==='grave') b=['#5A6A3A','#6E7E4A'];
          else if(theme==='mountain') b=['#9C7838','#B08C48'];
          else if(theme==='cave') b=['#888878','#9C9C8C'];
          else if(theme==='armos') b=['#4A8C20','#5C9C30'];
          else b=['#4A8C20','#74A820'];
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
        function drawLink(lx,ly){
          var blink=(link.hurt>0 && ((st.t*24)|0)%2===0);
          if(blink) return;
          var px=cw*0.14;
          var bx=lx-cw*0.5, by=ly-ch*0.55;
          var T='#00A800', S='#FCB890', C='#1E7818', B='#0040A0', E='#101010';
          if(link.hp>=link.maxhp){ T='#00D800'; }
          var spr;
          if(link.dir==='down') spr=[
            '.CCCCC.',
            '.CCCCC.',
            '.SSSSS.',
            '.SESES.',
            'TTSSSTT',
            'TTTTTTT',
            '.TTBTT.',
            '.B...B.'];
          else if(link.dir==='up') spr=[
            '.CCCCC.',
            '.CCCCC.',
            '.CCCCC.',
            'TT...TT',
            'TTTTTTT',
            'TTTTTTT',
            '.TTBTT.',
            '.B...B.'];
          else if(link.dir==='left') spr=[
            '.CCCC..',
            '.CCCC..',
            'SESS...',
            'STSS...',
            'TTTT...',
            'TTTTT..',
            '.TBT...',
            '.BB....'];
          else spr=[
            '..CCCC.',
            '..CCCC.',
            '...SSES',
            '...SSTS',
            '...TTTT',
            '..TTTTT',
            '...TBT.',
            '....BB.'];
          pix(spr, bx, by, px, {C:C,T:T,S:S,B:B,E:E,'.':null});
          if(link.swing>0){ var sv3=dvec[link.dir];
            var k,len=4;
            for(k=0;k<len;k++){ rrect(lx+sv3[0]*(cw*0.25+k*cw*0.14)-cw*0.05, ly+sv3[1]*(ch*0.25+k*ch*0.14)-ch*0.05, cw*0.12, ch*0.12, k===len-1?'#FCFCFC':'#C0C0E0'); }
          }
        }
        function drawRoom(rg,theme,offx,offy,enemies2,rocks2,picks2,drawActors){
          var gc=groundCol(theme), r,c;
          for(r=0;r<ROWS;r++){ for(c=0;c<COLS;c++){
            var x=ox+offx+c*cw, y=oy+offy+r*ch, t=rg[r][c];
            var tpix=Math.min(cw,ch)/8, tx0=x+(cw-tpix*8)*0.5, ty0=y+(ch-tpix*8)*0.5;
            rrect(x,y,cw+1,ch+1,gc[0]);
            if(((c+r)&1)===0) rrect(x+cw*0.22,y+ch*0.22,cw*0.5,ch*0.5,gc[1]);
            if(t===3){
              var wv=Math.sin(st.t*5.2+c*1.6+r*0.9+(cl.bar||0)*0.7)*ch*(0.035+energyMV*0.025);
              var wv2=Math.sin(st.t*3.4+c*0.8-r*1.1)*ch*0.025;
              var waterCol=(theme==='cave'||theme==='grave')?'#0C4CA8':'#2C98E0';
              rrect(x,y,cw+1,ch+1,waterCol);
              rrect(x+cw*0.08,y+ch*0.18+wv,cw*0.48,ch*0.11,'rgba(180,240,252,0.82)');
              rrect(x+cw*0.44,y+ch*0.55+wv2,cw*0.42,ch*0.10,'rgba(12,84,176,0.72)');
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
              pix([
                'AAAAAAAB',
                'ACCCCCAB',
                'ACDCCCAB',
                'ACCCCCAB',
                'AAAAAAAB',
                'BBAABBBA',
                'BBABBBBA',
                'BBBBBBBB'
              ], tx0, ty0, tpix, {A:hueRot('#B07838',hueAll),B:hueRot('#5C3408',hueAll),C:hueRot('#C88C48',hueAll),D:hueRot('#F0C070',hueAll)});
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
              ], tx0, ty0, tpix, {A:hueRot('#5C3408',hueAll),B:hueRot('#A06830',hueAll),C:hueRot('#D0A060',hueAll),'.':null});
            }
            else if(t===2){
              var tp=1+(beatScale-1)*(1.8+energyMV);
              var tbob=Math.sin(st.t*2.4+c*0.9+r*0.7)*cw*0.035 + (beatScale-1)*cw*0.35;
              var tw=cw*tp, th=ch*tp, tx=x-(tw-cw)*0.5+tbob, ty=y-(th-ch)*0.35;
              var leaf=hueRot(theme==='grave'?'#586020':'#1E7818',hueAll), leaf2=hueRot(theme==='grave'?'#788030':'#3C9828',hueAll), bark=hueRot('#6B3E1E',hueAll);
              pix([
                '..LLLL..',
                '.LLHHLL.',
                'LLHLLHLL',
                'LLLLLLLL',
                '.LLHHLL.',
                '..BBBB..',
                '..BBBB..',
                '..B..B..'
              ], tx+(tw-tpix*8)*0.5, ty+(th-tpix*8)*0.5, tpix*tp, {L:leaf,H:leaf2,B:bark,'.':null});
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
              ], tx0, ty0, tpix, {A:hueRot('#7C4810',hueAll),B:hueRot('#C07818',hueAll),C:'#000000','.':null});
            }
            // BEAT = PULSE: obstacle tiles get a subtle beat-driven highlight rim (no scale -> grid stays readable).
            if((t===1||t===5||t===6||t===7) && beatScale>1.001){
              var gl=(beatScale-1)*(0.6+0.5*energyMV), gp=cw*0.5*Math.min(0.18,gl*4);
              rrect(x+gp,y+gp,(cw+1)-gp*2,(ch+1)-gp*2,'rgba(255,250,220,'+(gl*3).toFixed(3)+')');
            }
          }}
          if(drawActors && isCurrentRoomLocked()){
            var lex=roomExits(st.roomX,st.roomY), li;
            for(li=0;li<lex.length;li++){
              var ex=lex[li], dx=ox+offx+ex.gc*cw, dy=oy+offy+ex.gr*ch;
              rrect(dx+cw*0.08,dy+ch*0.08,cw*0.84,ch*0.84,'#5C3408');
              rrect(dx+cw*0.16,dy+ch*0.16,cw*0.68,ch*0.68,'#B07838');
              if(ex.dir==='left'||ex.dir==='right'){
                rrect(dx+cw*0.44,dy+ch*0.16,cw*0.12,ch*0.68,'#3C2408');
              } else {
                rrect(dx+cw*0.16,dy+ch*0.44,cw*0.68,ch*0.12,'#3C2408');
              }
              rrect(dx+cw*0.44,dy+ch*0.38,cw*0.12,ch*0.12,'#101010');
              rrect(dx+cw*0.48,dy+ch*0.48,cw*0.04,ch*0.18,'#101010');
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
          } else if(type==='triforce'){
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
          rrect(ox,oy,A.w,A.h,shop?'#0C0808':'#080818');
          var ix=ox+A.w*0.17, iy=oy+A.h*0.16, iw=A.w*0.66, ih=A.h*0.68;
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
            drawItemIcon(it.item,ox+A.w*0.5,iy+ih*(shop?0.33:0.42)+lift,0.12);
          }
          var walk=Math.min(1,it.t/0.75);
          drawLink(ox+A.w*0.5,iy+ih*(0.78-walk*0.18));
        }
        rrect(ox,oy,A.w,A.h,'#000000');
        if(st.interior){
          drawInterior(st.interior);
        } else {
          drawRoom(grid,st.theme,sxoff,syoff,st.enemies,st.rocks,st.pickups,true);
          if(st.trans>0 && st.prevGrid){
            var poffx=sxoff, poffy=syoff;
            if(st.transDir==='left') poffx=sxoff+A.w;
            else if(st.transDir==='right') poffx=sxoff-A.w;
            else if(st.transDir==='up') poffy=syoff+A.h;
            else if(st.transDir==='down') poffy=syoff-A.h;
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
            var lx=ox+sxoff+(link.px+0.5)*cw, ly=oy+syoff+(link.py+0.5)*ch;
            drawLink(lx,ly);
          }
        }
        if(st.win>0){
          var fade=Math.min(1,(2.6-st.winTimer)/2.6);
          rrect(ox,oy,A.w,A.h,'rgba(0,0,0,'+(fade*0.85)+')');
          var cxl=ox+A.w*0.5, cyl=oy+A.h*0.4;
          pix([
            '..XXXX..',
            '.XXXXXX.',
            '.XXXXXX.',
            '..XXXX..'
          ], cxl-cw*0.5, cyl, cw*0.12, {X:'#1E7818','.':null});
        }
        // EVENT JUICE: screen-level flash on big events (defeat/hurt/win), under the HUD; decays via st.flash.
        if(st.flash>0.01) rrect(ox,oy,A.w,A.h,'rgba(255,250,235,'+(Math.min(0.5,st.flash*0.45)).toFixed(3)+')');
        var hi2; var hx=ox+cw*0.3, hy=oy+ch*0.12;
        for(hi2=0;hi2<link.maxhp;hi2++){ var full=hi2<link.hp;
          pix(['.X.X.','XXXXX','.XXX.','..X..'], hx+hi2*(cw*0.42), hy, cw*0.08, {X:full?'#E04010':'#601010','.':null}); }
        if(st.keys>0){
          var kc=Math.min(3,st.keys|0), ki;
          for(ki=0;ki<kc;ki++){
            pix(['.XX.','.XX.','XXXX','.XX.','.X.X'], hx+ki*(cw*0.32), hy+ch*0.48, cw*0.07, {X:'#F8D850','.':null});
          }
        }
        var mmw=GW*(cw*0.26), mmh=GH*(ch*0.26), mmx=ox+A.w-mmw-cw*0.3, mmy=oy+ch*0.15;
        rrect(mmx-2,mmy-2,mmw+4,mmh+4,'#202060');
        var mgx,mgy;
        for(mgy=0;mgy<GH;mgy++){ for(mgx=0;mgx<GW;mgx++){
          var key2=mgx+'_'+mgy; var mc='#101030';
          if(st.visited[key2]) mc='#3CBCFC';
          if(mgx===st.dunGX&&mgy===st.dunGY) mc=st.visited[key2]?'#F8B800':'#806000';
          if(mgx===st.roomX&&mgy===st.roomY) mc='#FCFCFC';
          rrect(mmx+mgx*(cw*0.26),mmy+mgy*(ch*0.26),cw*0.22,ch*0.22,mc);
        }}
        return st;
  }

  var api = {
    packVersion: 3,
    key: 'zelda',
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

  VisualizerGame.layer('zelda', 'renderer', api);
  return api;
})();
