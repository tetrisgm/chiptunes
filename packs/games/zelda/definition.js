// ZELDA pack definition. State construction and simulation only; rendering is in renderer.js.
const ZeldaDefinition = (function(){
  function makeState(A, U, variant){
        var v=variant|0;
        var COLS=16, ROWS=11;
        var GW=6, GH=5;
        function rng(seed){ var s=seed>>>0||1; return function(){ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }
        var THEMES=['grass','forest','lake','mountain','cave','armos','sand','grave'];
        var startGX=0, startGY=GH-1;
        var dunGX=GW-1, dunGY=0;
        var world={ v:v, seed:0, horiz:{}, vert:{}, theme:{} };
        function roomKey(x,y){ return x+'_'+y; }
        function roomExits(rx,ry){
          var exits=[];
          if(rx>0 && world.horiz[(rx-1)+'_'+ry] != null) exits.push({dir:'left',gx:rx-1,gy:ry,gc:0,gr:world.horiz[(rx-1)+'_'+ry]});
          if(rx<GW-1 && world.horiz[rx+'_'+ry] != null) exits.push({dir:'right',gx:rx+1,gy:ry,gc:COLS-1,gr:world.horiz[rx+'_'+ry]});
          if(ry>0 && world.vert[rx+'_'+(ry-1)] != null) exits.push({dir:'up',gx:rx,gy:ry-1,gc:world.vert[rx+'_'+(ry-1)],gr:0});
          if(ry<GH-1 && world.vert[rx+'_'+ry] != null) exits.push({dir:'down',gx:rx,gy:ry+1,gc:world.vert[rx+'_'+ry],gr:ROWS-1});
          return exits;
        }
        function roomDegree(rx,ry){ return roomExits(rx,ry).length; }
        function freshWorldSeed(nv){
          var now=((typeof Date!=='undefined'&&Date.now)?Date.now():(+new Date()))>>>0;
          var rnd=(Math.random()*4294967296)>>>0;
          return (now ^ rnd ^ ((nv|0)?0x9E3779B9:0x85EBCA6B))>>>0;
        }
        function inWorld(x,y){ return x>=0&&x<GW&&y>=0&&y<GH; }
        function hasRoom(list,x,y){
          var i; for(i=0;i<list.length;i++) if(list[i][0]===x&&list[i][1]===y) return true;
          return false;
        }
        function edgeSeed(a,b,depth){
          var ax=a[0], ay=a[1], bx=b[0], by=b[1];
          return (world.seed ^ (ax*73856093) ^ (ay*19349663) ^ (bx*83492791) ^ (by*2654435761) ^ (depth*374761393))>>>0;
        }
        function generateCriticalPath(R){
          var path=[[startGX,startGY]], x=startGX, y=startGY, guard=0;
          function canRecover(nx,ny){
            return (nx<dunGX&&!hasRoom(path,nx+1,ny)) || (ny>dunGY&&!hasRoom(path,nx,ny-1));
          }
          while((x!==dunGX||y!==dunGY)&&guard++<96){
            var dist=(dunGX-x)+(y-dunGY);
            if(path.length>3 && dist>3 && R()<0.24){
              var detours=[];
              if(inWorld(x,y+1)&&!hasRoom(path,x,y+1)&&canRecover(x,y+1)) detours.push([x,y+1]);
              if(inWorld(x-1,y)&&!hasRoom(path,x-1,y)&&canRecover(x-1,y)) detours.push([x-1,y]);
              if(detours.length){
                var dd=detours[(R()*detours.length)|0];
                x=dd[0]; y=dd[1]; path.push([x,y]);
                continue;
              }
            }
            var opts=[];
            if(x<dunGX && !hasRoom(path,x+1,y)) opts.push([x+1,y]);
            if(y>dunGY && !hasRoom(path,x,y-1)) opts.push([x,y-1]);
            if(!opts.length){
              if(x<dunGX) opts.push([x+1,y]);
              else if(y>dunGY) opts.push([x,y-1]);
            }
            var pick=opts[(R()*opts.length)|0];
            x=pick[0]; y=pick[1]; path.push([x,y]);
          }
          if(path[path.length-1][0]!==dunGX || path[path.length-1][1]!==dunGY){
            path=[[startGX,startGY]];
            x=startGX; y=startGY;
            while(x<dunGX){ x++; path.push([x,y]); }
            while(y>dunGY){ y--; path.push([x,y]); }
          }
          return path;
        }
        function generateBranches(R,path){
          var used={}, i, branches=[], wanted=3+Math.floor(R()*3);
          for(i=0;i<path.length;i++) used[roomKey(path[i][0],path[i][1])]=true;
          function shuffledDirs(){
            var dirs=[[1,0],[-1,0],[0,1],[0,-1]], a;
            for(a=dirs.length-1;a>0;a--){ var b=(R()*(a+1))|0, tmp=dirs[a]; dirs[a]=dirs[b]; dirs[b]=tmp; }
            return dirs;
          }
          var tries=0;
          while(branches.length<wanted && tries++<120){
            var attachIndex=1+Math.floor(R()*Math.max(1,path.length-2));
            var attach=path[Math.min(path.length-2,attachIndex)];
            var branch=[], cx=attach[0], cy=attach[1], len=1+(R()<0.45?1:0), step;
            for(step=0;step<len;step++){
              var dirs=shuffledDirs(), picked=null, di;
              for(di=0;di<dirs.length;di++){
                var nx=cx+dirs[di][0], ny=cy+dirs[di][1], key=roomKey(nx,ny);
                if(!inWorld(nx,ny) || used[key]) continue;
                if(nx===dunGX&&ny===dunGY) continue;
                picked=[nx,ny]; break;
              }
              if(!picked) break;
              branch.push(picked); used[roomKey(picked[0],picked[1])]=true; cx=picked[0]; cy=picked[1];
            }
            if(branch.length) branches.push({attach:attach,nodes:branch});
          }
          return branches;
        }
        function pathTheme(progress,R){
          if(progress<0.18) return 'grass';
          if(progress<0.36) return R()<0.65?'forest':'grass';
          if(progress<0.58) return R()<0.55?'lake':'forest';
          if(progress<0.80) return R()<0.5?'mountain':'grave';
          return R()<0.55?'cave':'grave';
        }
        function regenWorld(nv,nextSeed){
          world.v=nv|0;
          world.seed=(nextSeed==null?freshWorldSeed(world.v):nextSeed)>>>0;
          var R=rng(world.seed ^ 0xA53A9D11), gx,gy;
          world.horiz={}; world.vert={}; world.theme={}; world.depth={}; world.critical={}; world.side={}; world.role={};
          world.lockRooms={}; world.keyRooms={}; world.lockDepth={};
          world.criticalPath=generateCriticalPath(R);
          world.branches=generateBranches(R,world.criticalPath);
          for(gy=0;gy<GH;gy++){ for(gx=0;gx<GW;gx++) world.theme[roomKey(gx,gy)]='grass'; }
          function markRoom(node,depth,role,theme){
            var key=roomKey(node[0],node[1]);
            world.depth[key]=Math.min(world.depth[key]==null?99:world.depth[key],depth);
            world.role[key]=role;
            if(role==='critical') world.critical[key]=true;
            if(role==='side') world.side[key]=true;
            if(theme) world.theme[key]=theme;
          }
          function openDoorBetween(a,b,depth){
            var ax=a[0], ay=a[1], bx=b[0], by=b[1], er=rng(edgeSeed(a,b,depth));
            if(ax!==bx){
              var hk=Math.min(ax,bx)+'_'+ay;
              if(world.horiz[hk] == null) world.horiz[hk] = 2 + Math.floor(er()*(ROWS-4));
            } else if(ay!==by){
              var vk=ax+'_'+Math.min(ay,by);
              if(world.vert[vk] == null) world.vert[vk] = 3 + Math.floor(er()*(COLS-6));
            }
          }
          function openBetween(a,b,depth,role){
            markRoom(b,depth,role,null);
            openDoorBetween(a,b,depth);
          }
          var path=world.criticalPath, pi;
          markRoom(path[0],0,'critical','grass');
          for(pi=1; pi<path.length; pi++) openBetween(path[pi-1], path[pi], pi, 'critical');
          for(pi=0; pi<path.length; pi++){
            world.theme[roomKey(path[pi][0],path[pi][1])]=pathTheme(pi/Math.max(1,path.length-1),R);
          }
          var branchThemes=['sand','armos','lake','grave','forest','mountain'], bi, si;
          for(bi=0; bi<world.branches.length; bi++){
            var branch=world.branches[bi], prev=branch.attach;
            var attachDepth=world.depth[roomKey(prev[0],prev[1])]||1;
            var theme=branchThemes[(bi+Math.floor(R()*branchThemes.length))%branchThemes.length];
            for(si=0; si<branch.nodes.length; si++){
              var node=branch.nodes[si], depth=attachDepth+si+1;
              openBetween(prev,node,depth,'side');
              markRoom(node,depth,'side',theme);
              prev=node;
            }
          }
          function depthGuess(x,y){ return Math.abs(x-startGX)+Math.abs(y-startGY); }
          for(gy=0;gy<GH;gy++){
            for(gx=0;gx<GW;gx++){
              var ak=roomKey(gx,gy);
              if(world.depth[ak] == null) markRoom([gx,gy], depthGuess(gx,gy), 'field', pathTheme(depthGuess(gx,gy)/(GW+GH-2), R));
            }
          }
          for(gy=GH-1;gy>=0;gy--){
            for(gx=0;gx<GW;gx++){
              if(gx===startGX && gy===startGY) continue;
              var parentOpts=[];
              if(gx>0) parentOpts.push([gx-1,gy]);
              if(gy<GH-1) parentOpts.push([gx,gy+1]);
              if(parentOpts.length) openDoorBetween([gx,gy], parentOpts[(R()*parentOpts.length)|0], depthGuess(gx,gy));
            }
          }
          for(gy=0;gy<GH;gy++){
            for(gx=0;gx<GW;gx++){
              if(gx<GW-1 && R()<0.32) openDoorBetween([gx,gy],[gx+1,gy], depthGuess(gx,gy)+1);
              if(gy<GH-1 && R()<0.34) openDoorBetween([gx,gy],[gx,gy+1], depthGuess(gx,gy)+1);
            }
          }
          function assignLocks(){
            var candidates=[], lastLockDepth=-99, count=0;
            for(gy=0;gy<GH;gy++){
              for(gx=0;gx<GW;gx++){
                var lk=roomKey(gx,gy), dep=world.depth[lk]||0;
                if((gx===startGX&&gy===startGY)||(gx===dunGX&&gy===dunGY)) continue;
                if(roomDegree(gx,gy)===1 && dep>=3) candidates.push({x:gx,y:gy,d:dep});
              }
            }
            candidates.sort(function(a,b){ return a.d-b.d; });
            for(var ci=0;ci<candidates.length;ci++){
              var cand=candidates[ci], ck=roomKey(cand.x,cand.y);
              if(cand.d-lastLockDepth<4) continue;
              if(R()<0.62 || count===0){
                world.lockRooms[ck]=true;
                world.lockDepth[ck]=cand.d;
                lastLockDepth=cand.d;
                count++;
                var ex=roomExits(cand.x,cand.y)[0];
                if(ex){
                  var keyRoom=roomKey(ex.gx,ex.gy);
                  if(!world.lockRooms[keyRoom]) world.keyRooms[keyRoom]=true;
                }
              }
              if(count>=4) break;
            }
          }
          assignLocks();
          world.theme[roomKey(dunGX,dunGY)]='cave';
          world.theme[roomKey(startGX,startGY)]='grass';
          world.goal=[dunGX,dunGY]; world.start=[startGX,startGY];
        }
        regenWorld(v);
        function roomSeed(rx,ry){ return ((rx*73856093)^(ry*19349663)^(world.seed||0)^(world.v?0x9e3779b1:0x12345))>>>0; }
        function buildRoom(rx,ry){
          var horiz=world.horiz, vert=world.vert;
          var theme=world.theme[rx+'_'+ry]||'grass';
          var rr=rng(roomSeed(rx,ry));
          var grid=[], r,c,row;
          for(r=0;r<ROWS;r++){ row=[]; for(c=0;c<COLS;c++) row.push(0); grid.push(row); }
          for(c=0;c<COLS;c++){ grid[0][c]=1; grid[ROWS-1][c]=1; }
          for(r=0;r<ROWS;r++){ grid[r][0]=1; grid[r][COLS-1]=1; }
          var lr,rr2,tc,bc;
          if(rx>0 && horiz[(rx-1)+'_'+ry] != null){ lr=horiz[(rx-1)+'_'+ry]; grid[lr][0]=0; grid[lr][1]=0; }
          if(rx<GW-1 && horiz[rx+'_'+ry] != null){ rr2=horiz[rx+'_'+ry]; grid[rr2][COLS-1]=0; grid[rr2][COLS-2]=0; }
          if(ry>0 && vert[rx+'_'+(ry-1)] != null){ tc=vert[rx+'_'+(ry-1)]; grid[0][tc]=0; grid[1][tc]=0; }
          if(ry<GH-1 && vert[rx+'_'+ry] != null){ bc=vert[rx+'_'+ry]; grid[ROWS-1][bc]=0; grid[ROWS-2][bc]=0; }
          function freeCell(cc,rrr){ return cc>1&&cc<COLS-1&&rrr>1&&rrr<ROWS-1&&grid[rrr][cc]===0; }
          function stamp(cx,cy,t,shape){
            var i;
            for(i=0;i<shape.length;i++){
              var cc=cx+shape[i][0], rrr=cy+shape[i][1];
              if(freeCell(cc,rrr)) grid[rrr][cc]=t;
            }
          }
          function addFlavor(tile,minN,extraN){
            var shapes=[
              [[0,0],[1,0],[-1,0],[0,1]],
              [[0,0],[1,0],[0,1],[1,1]],
              [[0,0],[-1,0],[1,0],[-1,1],[1,1]],
              [[0,0],[0,1],[0,2]],
              [[0,0],[1,0],[2,0]]
            ];
            var n=minN+Math.floor(rr()*(extraN+1)), i;
            for(i=0;i<n;i++){
              var cx=3+Math.floor(rr()*(COLS-6)), cy=2+Math.floor(rr()*(ROWS-4));
              stamp(cx,cy,tile,shapes[(rr()*shapes.length)|0]);
            }
          }
          function placeCaveMouth(preferred){
            var mouth=preferred!=null?preferred:(3+Math.floor(rr()*(COLS-6)));
            mouth=Math.max(3,Math.min(COLS-4,mouth));
            if(grid[2][mouth]!==1) grid[2][mouth]=4;
            grid[3][mouth]=0; grid[3][mouth-1]=0; grid[3][mouth+1]=0;
            if(grid[4] && grid[4][mouth]!==1) grid[4][mouth]=0;
          }
          if(theme==='forest'){
            var nt=14+Math.floor(rr()*10), k;
            addFlavor(2,2,2);
            for(k=0;k<nt;k++){ var tx=2+Math.floor(rr()*(COLS-4)), ty=2+Math.floor(rr()*(ROWS-4)); if(freeCell(tx,ty)) grid[ty][tx]=2; }
          } else if(theme==='grass'){
            var ng=3+Math.floor(rr()*4), k1;
            addFlavor(2,1,2);
            for(k1=0;k1<ng;k1++){ var gx2=2+Math.floor(rr()*(COLS-4)), gy2=2+Math.floor(rr()*(ROWS-4)); if(freeCell(gx2,gy2)) grid[gy2][gx2]=2; }
          } else if(theme==='lake'){
            var lx=4+Math.floor(rr()*3), lw=6+Math.floor(rr()*3), midR=Math.floor(ROWS/2);
            var ry2,cx2;
            for(ry2=2;ry2<ROWS-2;ry2++){ for(cx2=lx;cx2<lx+lw&&cx2<COLS-1;cx2++){ if(freeCell(cx2,ry2)) grid[ry2][cx2]=3; } }
            for(cx2=lx;cx2<lx+lw&&cx2<COLS-1;cx2++){ if(grid[midR][cx2]===3) grid[midR][cx2]=8; }
            addFlavor(2,1,1);
          } else if(theme==='mountain'){
            var k2, nc=10+Math.floor(rr()*8);
            addFlavor(5,2,3);
            for(k2=0;k2<nc;k2++){ var mx=2+Math.floor(rr()*(COLS-4)), my=2+Math.floor(rr()*(ROWS-4)); if(freeCell(mx,my)) grid[my][mx]=5; }
            var seg=2+Math.floor(rr()*2), s2;
            for(s2=0;s2<seg;s2++){ var wr=2+Math.floor(rr()*(ROWS-4)), wc0=2+Math.floor(rr()*5), ww=2+Math.floor(rr()*4), wc;
              for(wc=wc0;wc<wc0+ww&&wc<COLS-1;wc++){ if(freeCell(wc,wr)) grid[wr][wc]=5; } }
          } else if(theme==='cave'){
            var cc2; for(cc2=2;cc2<COLS-2;cc2++){ if(freeCell(cc2,2)) grid[2][cc2]=5; if(rr()<0.5&&freeCell(cc2,3)) grid[3][cc2]=5; }
            placeCaveMouth(rx===dunGX&&ry===dunGY?8:null);
            var k3,nb=3+Math.floor(rr()*3); for(k3=0;k3<nb;k3++){ var bx=2+Math.floor(rr()*(COLS-4)), by=5+Math.floor(rr()*(ROWS-7)); if(freeCell(bx,by)) grid[by][bx]=5; }
          } else if(theme==='armos'){
            var rowsN=2+Math.floor(rr()*2), ar;
            addFlavor(6,1,2);
            for(ar=0;ar<rowsN;ar++){ var sr=3+ar*3; if(sr>=ROWS-2) break; var sc;
              for(sc=3;sc<COLS-2;sc+=2){ if(freeCell(sc,sr)) grid[sr][sc]=6; } }
          } else if(theme==='sand'){
            addFlavor(5,1,2);
            var k4,ns=4+Math.floor(rr()*4); for(k4=0;k4<ns;k4++){ var sx=2+Math.floor(rr()*(COLS-4)), sy=2+Math.floor(rr()*(ROWS-4)); if(freeCell(sx,sy)) grid[sy][sx]=(rr()<0.5?5:2); }
          } else if(theme==='grave'){
            addFlavor(7,2,2);
            var k5,ngr=6+Math.floor(rr()*6); for(k5=0;k5<ngr;k5++){ var grx=2+Math.floor(rr()*(COLS-4)), gry=2+Math.floor(rr()*(ROWS-4)); if(freeCell(grx,gry)) grid[gry][grx]=7; }
          }
          var localKey=roomKey(rx,ry), localDepth=world.depth[localKey]||0;
          if(!(rx===startGX&&ry===startGY) && theme!=='cave' && !world.lockRooms[localKey]){
            var caveChance=(world.side[localKey]?0.62:0.12) + (theme==='mountain'?0.24:0) + (theme==='forest'&&localDepth>2?0.14:0) + (theme==='grave'?0.18:0);
            if(rr()<caveChance) placeCaveMouth(null);
          }
          if(rx===dunGX&&ry===dunGY){ if(grid[2][8]!==4){ grid[2][8]=4; grid[3][8]=0; } }
          if(lr != null){ grid[lr][1]=0; grid[lr][0]=0; }
          if(rr2 != null){ grid[rr2][COLS-2]=0; grid[rr2][COLS-1]=0; }
          if(tc != null){ grid[1][tc]=0; grid[0][tc]=0; }
          if(bc != null){ grid[ROWS-2][bc]=0; grid[ROWS-1][bc]=0; }
          function clearLane(cc,rrr){ if(cc>0&&cc<COLS-1&&rrr>0&&rrr<ROWS-1){ var t=grid[rrr][cc]; if(t!==0&&t!==4&&t!==8) grid[rrr][cc]=0; } }
          var midC=Math.floor(COLS/2), midR2=Math.floor(ROWS/2), q;
          if(lr != null){ for(q=1;q<=midC;q++) clearLane(q,lr); for(q=Math.min(lr,midR2);q<=Math.max(lr,midR2);q++) clearLane(midC,q); }
          if(rr2 != null){ for(q=COLS-2;q>=midC;q--) clearLane(q,rr2); for(q=Math.min(rr2,midR2);q<=Math.max(rr2,midR2);q++) clearLane(midC,q); }
          if(tc != null){ for(q=1;q<=midR2;q++) clearLane(tc,q); for(q=Math.min(tc,midC);q<=Math.max(tc,midC);q++) clearLane(q,midR2); }
          if(bc != null){ for(q=ROWS-2;q>=midR2;q--) clearLane(bc,q); for(q=Math.min(bc,midC);q<=Math.max(bc,midC);q++) clearLane(q,midR2); }
          grid[midR2][midC]=0;
          return { g:grid, theme:theme };
        }
        function buildEnemies(rx,ry,roomGrid){
          var rr=rng(roomSeed(rx,ry)^0xABCDEF);
          var g=roomGrid||buildRoom(rx,ry).g;
          var theme=world.theme[rx+'_'+ry]||'grass';
          var depth=world.depth[rx+'_'+ry] || 0;
          var n=(rx===startGX && ry===startGY) ? 0 : Math.min(4, 1 + Math.floor(depth / 3) + Math.floor(rr()*2));
          if(world.side[rx+'_'+ry]) n = Math.max(1, n - 1 + Math.floor(rr()*2));
          if(rx===dunGX && ry===dunGY) n = 6;
          else n = Math.min(8, n*2);
          if(world.lockRooms && world.lockRooms[rx+'_'+ry]) n = Math.max(n, 4);
          var arr=[], i;
          function tileOpen(cc,rrr,type){
            if(!(cc>1&&cc<COLS-2&&rrr>1&&rrr<ROWS-2)) return false;
            var t=g[rrr][cc];
            if(type==='zora') return t===3;
            if(type==='ghini') return t!==3 && t!==4;
            return t===0 || t===8;
          }
          function pickSpot(occupied,type){
            var tries=0, c,r,key;
            while(tries++<80){
              c=2+Math.floor(rr()*(COLS-4)); r=2+Math.floor(rr()*(ROWS-4)); key=c+'_'+r;
              if(!tileOpen(c,r,type)||occupied[key]) continue;
              if(rx===startGX&&ry===startGY&&Math.abs(c-startC)+Math.abs(r-startR)<5) continue;
              if(Math.abs(c-Math.floor(COLS/2))+Math.abs(r-Math.floor(ROWS/2))<2) continue;
              occupied[key]=true; return {c:c,r:r};
            }
            for(r=2;r<ROWS-2;r++){ for(c=2;c<COLS-2;c++){ key=c+'_'+r; if(tileOpen(c,r,type)&&!occupied[key]){ occupied[key]=true; return {c:c,r:r}; } } }
            if(type==='zora') return pickSpot(occupied,'octorok');
            return {c:Math.floor(COLS/2),r:Math.floor(ROWS/2)};
          }
          var occ={};
          var enemyPools={
            grass:['octorok','tektite','octorok'],
            forest:['moblin','deku','moblin','leever'],
            lake:['zora','zora','octorok','tektite'],
            mountain:['tektite','armosKnight','moblin','tektite'],
            cave:['keese','stalfos','gel','keese'],
            armos:['armosKnight','armosKnight','keese','moblin'],
            sand:['leever','leever','octorok','tektite'],
            grave:['ghini','stalfos','ghini','keese']
          };
          var pool=enemyPools[theme]||enemyPools.grass;
          for(i=0;i<n;i++){
            var type=pool[(rr()*pool.length)|0];
            var spot=pickSpot(occ,type);
            var moveBase=(type==='keese'||type==='gel')?0.28:(type==='leever'||type==='zora'?0.62:(type==='stalfos'?0.34:0.45));
            arr.push({ c:spot.c, r:spot.r, dir:'down', type:type, alive:true, flash:0, moveCd:moveBase+rr()*0.75, shootCd:0.8+rr()*1.7, hop:0, phase:rr()*6.283, seed:(roomSeed(rx,ry)+i*2654435761)>>>0 });
          }
          return arr;
        }
        function buildItems(rx,ry,roomGrid,enemies){
          var rr=rng(roomSeed(rx,ry)^0x55AA33);
          var g=roomGrid||buildRoom(rx,ry).g;
          var depth=world.depth[rx+'_'+ry] || 0;
          var n=(rx===startGX && ry===startGY) ? 1 : 1 + Math.floor(rr()*3);
          if(world.side[rx+'_'+ry]) n += 1;
          if(rx===dunGX && ry===dunGY) n = 1;
          var arr=[], i, kinds=depth>5 ? ['rupee','heart','bomb','heart'] : ['rupee','heart','rupee','bomb'];
          var occ={}, ei;
          if(enemies){ for(ei=0;ei<enemies.length;ei++) if(enemies[ei].alive) occ[enemies[ei].c+'_'+enemies[ei].r]=true; }
          occ[startC+'_'+startR]=true;
          function tileOpen(cc,rrr){ return cc>1&&cc<COLS-2&&rrr>1&&rrr<ROWS-2&&(g[rrr][cc]===0||g[rrr][cc]===8); }
          function pickSpot(){
            var tries=0,c,r,key;
            while(tries++<80){
              c=2+Math.floor(rr()*(COLS-4)); r=2+Math.floor(rr()*(ROWS-4)); key=c+'_'+r;
              if(!tileOpen(c,r)||occ[key]) continue;
              if(Math.abs(c-Math.floor(COLS/2))+Math.abs(r-Math.floor(ROWS/2))<2) continue;
              occ[key]=true; return {c:c,r:r};
            }
            for(r=2;r<ROWS-2;r++){ for(c=2;c<COLS-2;c++){ key=c+'_'+r; if(tileOpen(c,r)&&!occ[key]){ occ[key]=true; return {c:c,r:r}; } } }
            return {c:Math.floor(COLS/2),r:Math.floor(ROWS/2)};
          }
          if(world.keyRooms && world.keyRooms[rx+'_'+ry]){
            var keySpot=pickSpot();
            arr.push({ c:keySpot.c, r:keySpot.r, type:'key', t:rr()*3 });
          }
          for(i=0;i<n;i++){ var spot=pickSpot(); arr.push({ c:spot.c, r:spot.r, type:kinds[Math.floor(rr()*kinds.length)], t:rr()*3 }); }
          return arr;
        }
        var cw=A.w/COLS, ch=A.h/ROWS;
        var startC=2, startR=ROWS-3;
        var link={ c:startC, r:startR, px:startC, py:startR, dir:'down', hp:6, maxhp:6, hurt:0, swing:0, atkCd:0, moveHold:null };
        var visited={}; visited[startGX+'_'+startGY]=true;
        var roomVisits={}; roomVisits[startGX+'_'+startGY]=1;
        var rm0=buildRoom(startGX,startGY);
        return {
          v:v, COLS:COLS, ROWS:ROWS, GW:GW, GH:GH,
          world:world, regenWorld:regenWorld, dunGX:dunGX, dunGY:dunGY,
          buildRoom:buildRoom, buildEnemies:buildEnemies, buildItems:buildItems,
          cw:cw, ch:ch, link:link,
          roomX:startGX, roomY:startGY,
          grid:rm0.g, theme:rm0.theme, enemies:buildEnemies(startGX,startGY,rm0.g), pickups:buildItems(startGX,startGY,rm0.g,[]),
          rocks:[], placedBombs:[],
          visited:visited, visitCount:1, roomVisits:roomVisits, prevRoomKey:null, unlockedRooms:{}, keys:0, bombs:1, rupees:0, caveVisits:{},
          lastGstep:-1, aiTimer:0, t:0,
          trans:0, transDir:null, prevGrid:null, prevTheme:null, prevEnemies:null, prevRocks:null, prevPickups:null,
          flash:0, win:0, winTimer:0,
          interior:null, bombCd:0,
          _lastPhrase:null, _hueShift:0, _shake:0, _bursts:[]
        };
  }

  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt || 0;
    var U = ctx.U || 8;
    var A = ctx.A || {x:0,y:0,w:0,h:0};
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state;
    if(!st) return undefined;
        if(!(dt>0)) dt=0; if(dt>0.05) dt=0.05;
        st.t+=dt;
        var COLS=st.COLS, ROWS=st.ROWS, GW=st.GW, GH=st.GH;
        var cw=A.w/COLS, ch=A.h/ROWS; st.cw=cw; st.ch=ch;
        var grid=st.grid, link=st.link;
        var audio = ctx.audio || {};
        var raw = audio.raw || {};
        var clk = raw.gr || {gstep:0,beat:0,bar:0,phase:0,spb:0.45,step16:0,bpm:132};
        if(!(clk.spb>0)) clk.spb=0.45;
        function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }
        // ===== MV clock: beat=pulse, bar=palette, phrase=variation, event=juice =====
        var cl = raw.cl || {};
        var energyMV = MV.energy(cl), dropMV = MV.isDrop(cl);
        var beatScale = MV.pulse(cl, dropMV?0.05:0.03);   // subtle tile/enemy swell on the beat
        var barHue = MV.barHue(cl, 12);                    // smooth hue advance over bars
        // PHRASE = VARIATION: on phrase change, shift the palette FAMILY (hue offset) of the whole overworld.
        if(st._lastPhrase==null) st._lastPhrase=(cl.phrase||0);
        if((cl.phrase||0)!==st._lastPhrase){
          st._lastPhrase=(cl.phrase||0);
          var fam=[0,40,90,150,210,300];                  // distinct palette families per phrase (readable shifts)
          st._hueShift=MV.pick(cl, fam)||0;
        }
        var hueAll=barHue + st._hueShift;                  // combined bar + phrase-family rotation
        if(st._shake>0) st._shake-=dt*4; if(st._shake<0) st._shake=0;
        var stepped=false;
        if(clk.gstep!==st.lastGstep){ st.lastGstep=clk.gstep; stepped=true; }
        var dvec={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
        function passable(g,c,r){ if(c<0||c>=COLS||r<0||r>=ROWS) return false; var t=g[r][c]; return t===0||t===4||t===8; }
        function faceTowardCell(c,r){
          var dx=c-link.c, dy=r-link.r;
          if(Math.abs(dx)>Math.abs(dy)) link.dir=dx>0?'right':'left';
          else if(dy!==0) link.dir=dy>0?'down':'up';
          else if(dx!==0) link.dir=dx>0?'right':'left';
        }
        function isOneTileAway(o){ return o && Math.abs(o.c-link.c)+Math.abs(o.r-link.r)===1; }
        function enemyOccupies(c,r,ignore){
          var i; for(i=0;i<st.enemies.length;i++){ var e=st.enemies[i]; if(!e.alive||e===ignore) continue; if(e.c===c&&e.r===r) return true; }
          return false;
        }
        function attackCellForTarget(g,o){
          if(!o) return null;
          var cand=[
            {c:o.c-1,r:o.r,face:'right'},
            {c:o.c+1,r:o.r,face:'left'},
            {c:o.c,r:o.r-1,face:'down'},
            {c:o.c,r:o.r+1,face:'up'}
          ];
          var bestCell=null, bestScore=999, i;
          for(i=0;i<cand.length;i++){
            var q=cand[i];
            if(!passable(g,q.c,q.r)||enemyOccupies(q.c,q.r,o)) continue;
            var score=Math.abs(q.c-link.c)+Math.abs(q.r-link.r);
            if(score<bestScore){ bestScore=score; bestCell=q; }
          }
          return bestCell;
        }
        function swordHitsEnemy(o){
          var dx=o.c-link.c, dy=o.r-link.r, reach=1.5, half=1.0;
          if(link.dir==='right') return dx>0&&dx<=reach&&Math.abs(dy)<=half;
          if(link.dir==='left') return dx<0&&-dx<=reach&&Math.abs(dy)<=half;
          if(link.dir==='down') return dy>0&&dy<=reach&&Math.abs(dx)<=half;
          return dy<0&&-dy<=reach&&Math.abs(dx)<=half;
        }
        function roomExits(rx,ry){
          var exits=[];
          if(rx>0 && st.world.horiz[(rx-1)+'_'+ry] != null) exits.push({dir:'left',gx:rx-1,gy:ry,gc:0,gr:st.world.horiz[(rx-1)+'_'+ry]});
          if(rx<GW-1 && st.world.horiz[rx+'_'+ry] != null) exits.push({dir:'right',gx:rx+1,gy:ry,gc:COLS-1,gr:st.world.horiz[rx+'_'+ry]});
          if(ry>0 && st.world.vert[rx+'_'+(ry-1)] != null) exits.push({dir:'up',gx:rx,gy:ry-1,gc:st.world.vert[rx+'_'+(ry-1)],gr:0});
          if(ry<GH-1 && st.world.vert[rx+'_'+ry] != null) exits.push({dir:'down',gx:rx,gy:ry+1,gc:st.world.vert[rx+'_'+ry],gr:ROWS-1});
          return exits;
        }
        function roomDegree(rx,ry){ return roomExits(rx,ry).length; }
        function currentRoomKey(){ return st.roomX+'_'+st.roomY; }
        function aliveEnemyCount(){
          var n=0, i;
          for(i=0;i<st.enemies.length;i++) if(st.enemies[i].alive) n++;
          return n;
        }
        function isCurrentRoomLocked(){
          var key=currentRoomKey();
          return !!(st.world.lockRooms && st.world.lockRooms[key] && !(st.unlockedRooms && st.unlockedRooms[key]));
        }
        function unlockCurrentRoom(reason){
          var key=currentRoomKey();
          if(!st.unlockedRooms) st.unlockedRooms={};
          if(st.unlockedRooms[key]) return;
          st.unlockedRooms[key]=true;
          st.flash=Math.max(st.flash,0.28);
          st._shake=Math.max(st._shake,0.35);
          EVENT('major', reason==='key'?5:6, {name:'doorUnlocked'});
          if(SND&&SND.act)try{SND.act(0.24);}catch(e){}
        }
        function tryOpenCurrentLockedRoom(){
          if(!isCurrentRoomLocked()) return true;
          if(aliveEnemyCount()<=0){ unlockCurrentRoom('clear'); return true; }
          if(st.keys>0){ st.keys--; unlockCurrentRoom('key'); return true; }
          st.flash=Math.max(st.flash,0.18);
          st._shake=Math.max(st._shake,0.25);
          EVENT('state',4,{name:'lockedDoor'});
          return false;
        }
        function giveItem(type,amount){
          if(type==='heart'){ link.hp=Math.min(link.maxhp,link.hp+(amount||1)); }
          else if(type==='key'){ st.keys=(st.keys||0)+(amount||1); }
          else if(type==='bomb'){ st.bombs=(st.bombs||0)+(amount||2); }
          else if(type==='triforce'){ st.flash=1; st._shake=1.1; EVENT('major',10,{name:'dungeonPrize'}); }
          else st.rupees=(st.rupees||0)+(amount||5);
        }
        function caveItemForRoom(){
          var picks=['rupee','bomb','heart','key'];
          var idx=((st.world.seed||0) ^ (st.roomX*37) ^ (st.roomY*101))>>>0;
          return picks[idx%picks.length];
        }
        function enterInterior(kind,cc,rrr){
          if(st.interior) return true;
          var key=currentRoomKey();
          var type=kind || ((st.roomX===st.dunGX&&st.roomY===st.dunGY)?'dungeon':'shop');
          if(type==='shop' && st.caveVisits && st.caveVisits[key]){
            EVENT('minor',3,{name:'emptyCave'});
            return true;
          }
          if(!st.caveVisits) st.caveVisits={};
          if(type==='shop') st.caveVisits[key]=true;
          st.interior={type:type,t:0,given:false,item:type==='dungeon'?'triforce':caveItemForRoom(),c:cc,r:rrr};
          link.dir='up'; link.c=cc; link.r=rrr; link.px=cc; link.py=rrr; holdMoveDir(null);
          st.flash=Math.max(st.flash,type==='dungeon'?0.45:0.18);
          EVENT(type==='dungeon'?'major':'medium',type==='dungeon'?9:5,{name:type});
          if(SND&&SND.act)try{SND.act(type==='dungeon'?0.42:0.2);}catch(e){}
          return true;
        }
        function updateInterior(){
          var it=st.interior;
          if(!it) return;
          it.t+=dt;
          if(!it.given && it.t>0.85){
            giveItem(it.item,it.item==='rupee'?10:null);
            it.given=true;
            if(SND&&SND.act)try{SND.act(0.22);}catch(e){}
            EVENT(it.type==='dungeon'?'major':'medium',it.type==='dungeon'?10:5,{name:'pickup'});
          }
          var doneAt=it.type==='dungeon'?2.8:1.8;
          if(it.t>doneAt){
            var wasDungeon=it.type==='dungeon';
            link.c=it.c; link.r=Math.min(ROWS-2,it.r+1); link.px=link.c; link.py=link.r; link.dir='down';
            st.interior=null;
            if(wasDungeon){ st.win=1; st.winTimer=2.6; st.flash=1; st._shake=1.2; }
          }
        }
        function placeBomb(){
          if((st.bombs||0)<=0 || st.bombCd>0 || st.interior) return false;
          st.bombs--; st.bombCd=1.05;
          st.placedBombs.push({c:link.c,r:link.r,t:0,blast:0,exploded:false});
          if(st.placedBombs.length>3) st.placedBombs.shift();
          EVENT('medium',5,{name:'bombSet'});
          if(SND&&SND.act)try{SND.act(0.18);}catch(e){}
          return true;
        }
        function explodeBomb(bm){
          bm.exploded=true;
          bm.blast=0.36;
          st.flash=Math.max(st.flash,0.22);
          st._shake=Math.max(st._shake,0.5);
          EVENT('major',7,{name:'bomb'});
          if(SND&&SND.act)try{SND.act(0.32);}catch(e){}
          var i;
          for(i=0;i<st.enemies.length;i++){
            var en=st.enemies[i];
            if(!en.alive) continue;
            var dx=en.c-bm.c, dy=en.r-bm.r;
            if(dx*dx+dy*dy<=4){
              en.alive=false; en.flash=0.45;
              st._bursts.push({c:en.c,r:en.r,t:0});
              if(st._bursts.length>10) st._bursts.shift();
              if(st.pickups.length<12 && ((en.seed^st.world.seed)&3)===0) st.pickups.push({c:en.c,r:en.r,type:'rupee',t:0});
            }
          }
          for(var rr0=Math.max(1,bm.r-1); rr0<=Math.min(ROWS-2,bm.r+1); rr0++){
            for(var cc0=Math.max(1,bm.c-1); cc0<=Math.min(COLS-2,bm.c+1); cc0++){
              var tt=grid[rr0][cc0];
              if(tt===2||tt===5||tt===7){
                grid[rr0][cc0]=0;
                if(st.pickups.length<12 && (((cc0*31+rr0*17+st.world.seed)&7)===0)){
                  st.pickups.push({c:cc0,r:rr0,type:tt===2?'heart':'rupee',t:0});
                }
              }
            }
          }
          for(i=st.rocks.length-1;i>=0;i--){
            var pr=st.rocks[i], pc=Math.floor(pr.x/cw), rr=Math.floor(pr.y/ch);
            if(Math.abs(pc-bm.c)+Math.abs(rr-bm.r)<=2) st.rocks.splice(i,1);
          }
        }
        function updateBombs(){
          if(!st.placedBombs) st.placedBombs=[];
          var i;
          for(i=st.placedBombs.length-1;i>=0;i--){
            var bm=st.placedBombs[i];
            bm.t+=dt;
            if(!bm.exploded && bm.t>=0.95) explodeBomb(bm);
            if(bm.exploded){
              bm.blast-=dt;
              if(bm.blast<=0) st.placedBombs.splice(i,1);
            }
          }
        }

        if(st.trans>0){
          st.trans-=dt*3.4;
          if(st.trans<=0){ st.trans=0; st.prevGrid=null; st.prevEnemies=null; st.prevRocks=null; st.prevPickups=null; }
        }
        updateInterior();

        if(st.win>0){
          st.winTimer-=dt;
          if(st.winTimer<=0){
            st.v=st.v^1;
            st.regenWorld(st.v);
            st.roomX=0; st.roomY=GH-1;
            st.visited={}; st.visited['0_'+(GH-1)]=true; st.visitCount=1;
            st.roomVisits={}; st.roomVisits['0_'+(GH-1)]=1; st.prevRoomKey=null; st.unlockedRooms={}; st.keys=0; st.bombs=1; st.rupees=0; st.caveVisits={}; st.interior=null; st.placedBombs=[];
            link.c=2; link.r=ROWS-3; link.px=link.c; link.py=link.r; link.hp=link.maxhp; link.hurt=0; link.swing=0; link.dir='down'; link.moveHold=null;
            var rmw=st.buildRoom(0,GH-1); st.grid=rmw.g; st.theme=rmw.theme;
            st.enemies=st.buildEnemies(0,GH-1,st.grid); st.pickups=st.buildItems(0,GH-1,st.grid,st.enemies);
            st.rocks=[]; st.win=0; st.flash=0;
            grid=st.grid;
          }
        }

        function bfsStep(g,sc,sr,gc,gr){
          if(sc===gc&&sr===gr) return null;
          var seen={}, q=[], head=0;
          seen[sc+'_'+sr]=true;
          q.push({c:sc,r:sr,first:null});
          var order=[['up',0,-1],['right',1,0],['down',0,1],['left',-1,0]];
          while(head<q.length){
            var n=q[head++], i;
            for(i=0;i<4;i++){
              var d=order[i], nc=n.c+d[1], nr=n.r+d[2], key=nc+'_'+nr;
              if(nc<0||nc>=COLS||nr<0||nr>=ROWS) continue;
              if(seen[key]) continue;
              if(!passable(g,nc,nr)) continue;
              seen[key]=true;
              var fst=n.first||d[0];
              if(nc===gc&&nr===gr) return fst;
              q.push({c:nc,r:nr,first:fst});
              if(q.length>600) return fst;
            }
          }
          return null;
        }

        function syncLinkTile(){
          link.c=Math.max(0, Math.min(COLS-1, Math.round(link.px)));
          link.r=Math.max(0, Math.min(ROWS-1, Math.round(link.py)));
        }
        function holdMoveDir(dir){
          link.moveHold=dir||null;
          if(dir) link.dir=dir;
        }
        function canStandAt(px,py){
          var rad=0.32, pts=[
            [px-rad,py-rad],[px+rad,py-rad],
            [px-rad,py+rad],[px+rad,py+rad]
          ];
          for(var pi=0;pi<pts.length;pi++){
            if(!passable(grid, Math.floor(pts[pi][0]+0.5), Math.floor(pts[pi][1]+0.5))) return false;
          }
          return true;
        }
        function roomDoor(dir){
          if(dir==='left'&&st.roomX>0){ var l=st.world.horiz[(st.roomX-1)+'_'+st.roomY]; if(l!=null) return l; }
          if(dir==='right'&&st.roomX<GW-1){ var r=st.world.horiz[st.roomX+'_'+st.roomY]; if(r!=null) return r; }
          if(dir==='up'&&st.roomY>0){ var u=st.world.vert[st.roomX+'_'+(st.roomY-1)]; if(u!=null) return u; }
          if(dir==='down'&&st.roomY<GH-1){ var d=st.world.vert[st.roomX+'_'+st.roomY]; if(d!=null) return d; }
          return null;
        }
        function doorCorridorAllows(px,py,dir){
          var d=roomDoor(dir);
          if(d==null) return false;
          if(dir==='left') return px>-0.45 && px<0.7 && Math.abs(py-d)<0.42;
          if(dir==='right') return px<COLS-0.55 && px>COLS-1.7 && Math.abs(py-d)<0.42;
          if(dir==='up') return py>-0.45 && py<0.7 && Math.abs(px-d)<0.42;
          if(dir==='down') return py<ROWS-0.55 && py>ROWS-1.7 && Math.abs(px-d)<0.42;
          return false;
        }
        function changeRoom(leaving){
          if(!leaving) return false;
          if(!tryOpenCurrentLockedRoom()){ st.aiTimer=0.08; holdMoveDir(null); return true; }
          var fromRoomKey=currentRoomKey();
          st.prevGrid=st.grid; st.prevTheme=st.theme; st.prevEnemies=st.enemies; st.prevRocks=st.rocks; st.prevPickups=st.pickups;
          st.transDir=leaving.dir; st.trans=1;
          st.prevRoomKey=fromRoomKey;
          st.roomX=leaving.gx; st.roomY=leaving.gy;
          var rmn=st.buildRoom(st.roomX,st.roomY); st.grid=rmn.g; st.theme=rmn.theme; grid=st.grid;
          st.enemies=st.buildEnemies(st.roomX,st.roomY,st.grid); st.pickups=st.buildItems(st.roomX,st.roomY,st.grid,st.enemies); st.rocks=[]; st.placedBombs=[];
          var rkey=st.roomX+'_'+st.roomY;
          if(!st.roomVisits) st.roomVisits={};
          st.roomVisits[rkey]=(st.roomVisits[rkey]||0)+1;
          if(!st.visited[rkey]){ st.visited[rkey]=true; st.visitCount++; if(SND&&SND.act)try{SND.act(0.3);}catch(e){} EVENT('major',6); }
          else EVENT('minor',3);
          link.c=leaving.entryC; link.r=leaving.entryR; link.px=link.c; link.py=link.r; holdMoveDir(null);
          st.aiTimer=0.04;
          if(SND&&SND.lead)try{SND.lead(clk.spb*0.5,0.16);}catch(e){}
          if(SND&&SND.act)try{SND.act(0.18);}catch(e){}
          return true;
        }
        function tryContinuousRoomTransition(){
          var rr=Math.round(link.py), cc=Math.round(link.px);
          var leftDoor=roomDoor('left'), rightDoor=roomDoor('right'), upDoor=roomDoor('up'), downDoor=roomDoor('down');
          if(link.px<-0.18 && leftDoor!=null && Math.abs(link.py-leftDoor)<0.45) return changeRoom({dir:'left',gx:st.roomX-1,gy:st.roomY,entryC:COLS-2,entryR:leftDoor});
          if(link.px>COLS-0.82 && rightDoor!=null && Math.abs(link.py-rightDoor)<0.45) return changeRoom({dir:'right',gx:st.roomX+1,gy:st.roomY,entryC:1,entryR:rightDoor});
          if(link.py<-0.18 && upDoor!=null && Math.abs(link.px-upDoor)<0.45) return changeRoom({dir:'up',gx:st.roomX,gy:st.roomY-1,entryC:upDoor,entryR:ROWS-2});
          if(link.py>ROWS-0.82 && downDoor!=null && Math.abs(link.px-downDoor)<0.45) return changeRoom({dir:'down',gx:st.roomX,gy:st.roomY+1,entryC:downDoor,entryR:1});
          if(cc>=0&&cc<COLS&&rr>=0&&rr<ROWS&&grid[rr][cc]===4 && Math.abs(link.px-cc)<0.38 && Math.abs(link.py-rr)<0.38){
            return enterInterior((st.roomX===st.dunGX&&st.roomY===st.dunGY)?'dungeon':'shop',cc,rr);
          }
          return false;
        }

        syncLinkTile();
        var human=IN&&IN.active;
        var moveDir=null, wantAtk=false, wantBomb=false;
        var canControl=(st.trans<=0 && st.win<=0 && !st.interior);
        if(human&&canControl){
          holdMoveDir(null);
          if(IN.keys){
            if(IN.keys.up) moveDir='up'; else if(IN.keys.down) moveDir='down';
            else if(IN.keys.left) moveDir='left'; else if(IN.keys.right) moveDir='right';
            if(IN.keys.action) wantAtk=true;
          }
          if(IN.click) wantAtk=true;
        } else if(canControl){
          var aiIntent = ZeldaBehavior.decideAuto({
            st: st,
            link: link,
            grid: grid,
            GW: GW,
            GH: GH,
            COLS: COLS,
            ROWS: ROWS,
            cw: cw,
            ch: ch,
            dt: dt,
            clk: clk,
            dvec: dvec,
            passable: passable,
            faceTowardCell: faceTowardCell,
            isOneTileAway: isOneTileAway,
            attackCellForTarget: attackCellForTarget,
            isCurrentRoomLocked: isCurrentRoomLocked,
            currentRoomKey: currentRoomKey,
            roomDegree: roomDegree,
            bfsStep: bfsStep,
            holdMoveDir: holdMoveDir
          });
          if(aiIntent){
            moveDir = aiIntent.moveDir || null;
            wantAtk = !!aiIntent.wantAtk;
            wantBomb = !!aiIntent.wantBomb;
          }
        }

        if(moveDir && link.swing<=0 && canControl){
          var mv=dvec[moveDir]; link.dir=moveDir;
          var oldC=link.c, oldR=link.r;
          var speed=human?4.8:4.4;
          var nx=link.px+mv[0]*speed*dt, ny=link.py+mv[1]*speed*dt;
          if(mv[0]!==0){
            var laneY=Math.round(link.py), maxY=speed*dt*0.9;
            ny += Math.max(-maxY, Math.min(maxY, laneY-link.py));
          } else {
            var laneX=Math.round(link.px), maxX=speed*dt*0.9;
            nx += Math.max(-maxX, Math.min(maxX, laneX-link.px));
          }
          if(canStandAt(nx,ny) || doorCorridorAllows(nx,ny,moveDir)){
            link.px=nx; link.py=ny;
          } else {
            var alignX=link.px, alignY=link.py;
            if(mv[0]!==0) alignY += Math.max(-speed*dt, Math.min(speed*dt, Math.round(link.py)-link.py));
            else alignX += Math.max(-speed*dt, Math.min(speed*dt, Math.round(link.px)-link.px));
            if(canStandAt(alignX,alignY)){ link.px=alignX; link.py=alignY; }
            else if(!human){ holdMoveDir(null); st.aiTimer=0; }
          }
          syncLinkTile();
          if((oldC!==link.c||oldR!==link.r) && SND&&SND.act)try{SND.act(0.045);}catch(e){}
          tryContinuousRoomTransition();
        } else {
          syncLinkTile();
        }
        if(link.hurt>0) link.hurt-=dt;
        if(st.flash>0) st.flash-=dt*2;
        if(st.bombCd>0){ st.bombCd-=dt; if(st.bombCd<0) st.bombCd=0; }

        if(link.atkCd>0) link.atkCd-=dt;
        if(wantBomb && canControl){
          placeBomb();
          if(!human){ moveDir=null; holdMoveDir(null); }
        }
        if(wantAtk && link.swing<=0 && link.atkCd<=0 && canControl){
          link.swing=0.22; link.atkCd=0.3;
          if(SND&&SND.lead)try{SND.lead(clk.spb*0.5,0.16);}catch(e){}
          if(SND&&SND.act)try{SND.act(0.22);}catch(e){}
          EVENT('minor',4);
          var hi;
          for(hi=0;hi<st.enemies.length;hi++){ var oo=st.enemies[hi]; if(!oo.alive) continue;
            if(swordHitsEnemy(oo)){
              oo.alive=false; oo.flash=0.4;
              var drops=['rupee','heart','bomb'];
              st.pickups.push({c:oo.c,r:oo.r,type:drops[((st.t*1000)|0)%3],t:0});
              if(st.pickups.length>12) st.pickups.shift();
              if(SND&&SND.lead)try{SND.lead(clk.spb*0.5,0.17);}catch(e){}
              if(SND&&SND.act)try{SND.act(0.25);}catch(e){}
              EVENT('medium',6);
              st.flash=Math.min(1,0.35+0.4*energyMV);     // EVENT JUICE: defeat flash, scaled by energy
              st._shake=0.4+0.6*energyMV;
              st._bursts.push({c:oo.c,r:oo.r,t:0});       // tiny sprite burst at the kill
              if(st._bursts.length>10) st._bursts.shift();
            }
          }
        }
        if(link.swing>0){ link.swing-=dt; if(link.swing<0) link.swing=0; }
        if(isCurrentRoomLocked() && aliveEnemyCount()<=0) unlockCurrentRoom('clear');

        if(st.trans<=0 && st.win<=0 && !st.interior){
          updateBombs();
          var oj;
          for(oj=0;oj<st.enemies.length;oj++){ var oc=st.enemies[oj];
            if(oc.flash>0){ oc.flash-=dt; }
            if(oc.hop>0){ oc.hop-=dt; if(oc.hop<0) oc.hop=0; }
            if(!oc.alive) continue;
            oc.moveCd-=dt; oc.shootCd-=dt;
            if(oc.moveCd<=0 && stepped){
              oc.seed=(oc.seed*1664525+1013904223)>>>0;
              var rnd=oc.seed/4294967296;
              oc.moveCd=(oc.type==='keese'||oc.type==='gel'?0.22:(oc.type==='leever'||oc.type==='zora'?0.58:(oc.type==='stalfos'?0.3:0.38)))+rnd*(oc.type==='keese'||oc.type==='gel'?0.48:0.72);
              oc.seed=(oc.seed*1664525+1013904223)>>>0;
              var dlist=['up','down','left','right']; var dd2=dlist[(oc.seed>>>5)%4]; var dv2=dvec[dd2];
              if((oc.type==='moblin'||oc.type==='keese'||oc.type==='leever'||oc.type==='ghini'||oc.type==='stalfos'||oc.type==='armosKnight'||oc.type==='gel') && rnd<0.58){
                var dxl=link.c-oc.c, dyl=link.r-oc.r;
                if(Math.abs(dxl)>Math.abs(dyl)) dd2=dxl>0?'right':'left';
                else if(dyl!==0) dd2=dyl>0?'down':'up';
                dv2=dvec[dd2];
              }
              if(oc.type==='zora'){
                var zdx=link.c-oc.c, zdy=link.r-oc.r;
                if(Math.abs(zdx)>Math.abs(zdy)) dd2=zdx>0?'right':'left';
                else if(zdy!==0) dd2=zdy>0?'down':'up';
                dv2=dvec[dd2];
              }
              var nc2=oc.c+dv2[0], nr2=oc.r+dv2[1];
              function enemyCanEnter(en,cc,rrr){
                if(cc<0||cc>=COLS||rrr<0||rrr>=ROWS) return false;
                var tt=grid[rrr][cc];
                if(en.type==='zora') return tt===3;
                if(en.type==='ghini') return tt!==3 && tt!==4;
                return passable(grid,cc,rrr);
              }
              if(enemyCanEnter(oc,nc2,nr2) && !enemyOccupies(nc2,nr2,oc)){ oc.c=nc2; oc.r=nr2; oc.dir=dd2; if(oc.type==='tektite'||oc.type==='leever'||oc.type==='keese'||oc.type==='gel'||oc.type==='ghini') oc.hop=0.3; }
              else oc.dir=dd2;
            }
            if((oc.type==='octorok'||oc.type==='moblin'||oc.type==='zora'||oc.type==='deku') && oc.shootCd<=0){
              oc.seed=(oc.seed*1664525+1013904223)>>>0;
              oc.shootCd=(oc.type==='moblin'?1.25:(oc.type==='zora'?1.55:1))+(oc.seed/4294967296)*1.6;
              var sv2=dvec[oc.dir]||[0,1];
              var pkind=oc.type==='moblin'?'spear':(oc.type==='zora'?'wave':(oc.type==='deku'?'seed':'rock'));
              var pspeed=oc.type==='moblin'?3.7:(oc.type==='zora'?2.9:3.2);
              st.rocks.push({ x:(oc.c+0.5)*cw, y:(oc.r+0.5)*ch, vx:sv2[0]*cw*pspeed, vy:sv2[1]*ch*pspeed, t:0, kind:pkind });
              if(st.rocks.length>14) st.rocks.shift();
            }
          }
          var rj;
          for(rj=st.rocks.length-1;rj>=0;rj--){ var rp=st.rocks[rj]; rp.x+=rp.vx*dt; rp.y+=rp.vy*dt; rp.t+=dt;
            if(rp.x<0||rp.x>A.w||rp.y<0||rp.y>A.h||rp.t>3){ st.rocks.splice(rj,1); continue; }
            if(link.hurt<=0){
              var lx=(link.px+0.5)*cw, ly=(link.py+0.5)*ch;
              if(Math.abs(rp.x-lx)<cw*0.55 && Math.abs(rp.y-ly)<ch*0.55){
                st.rocks.splice(rj,1); link.hp--; link.hurt=0.9;
                var kb=dvec[link.dir]; var bc=link.c-kb[0], br=link.r-kb[1];
                if(passable(grid,bc,br)){ link.c=bc; link.r=br; link.px=bc; link.py=br; holdMoveDir(null); }
                if(SND&&SND.act)try{SND.act(0.2);}catch(e){}
                st._shake=Math.max(st._shake,(link.hp<=0?0.9:0.4)*(0.6+0.4*energyMV));   // EVENT JUICE: hurt shake
                if(link.hp<=0){ link.hp=link.maxhp; link.hurt=1.2; EVENT('major',8); st.flash=0.5; }
                else EVENT('medium',5);
              }
            }
          }
          var tk;
          for(tk=0;tk<st.enemies.length;tk++){ var en=st.enemies[tk]; if(!en.alive) continue;
            if(link.hurt<=0 && en.c===link.c && en.r===link.r){
              link.hp--; link.hurt=0.9;
              var kb2=dvec[link.dir]; var bc2=link.c-kb2[0], br2=link.r-kb2[1];
              if(passable(grid,bc2,br2)){ link.c=bc2; link.r=br2; link.px=bc2; link.py=br2; holdMoveDir(null); }
              if(SND&&SND.act)try{SND.act(0.2);}catch(e){}
              st._shake=Math.max(st._shake,(link.hp<=0?0.9:0.4)*(0.6+0.4*energyMV));   // EVENT JUICE: hurt shake
              if(link.hp<=0){ link.hp=link.maxhp; link.hurt=1.2; EVENT('major',8); st.flash=0.5; }
              else EVENT('medium',5);
            }
          }
          var pj;
          for(pj=st.pickups.length-1;pj>=0;pj--){ var pk=st.pickups[pj]; pk.t+=dt;
            if(pk.c===link.c&&pk.r===link.r){
              giveItem(pk.type,pk.type==='rupee'?1:null);
              st.pickups.splice(pj,1);
              if(SND&&SND.act)try{SND.act(0.15);}catch(e){}
              EVENT((pk.type==='key'||pk.type==='bomb')?'major':'medium',4,{name:'pickup'});
              continue;
            }
            if(pk.type!=='key' && pk.t>14) st.pickups.splice(pj,1);
          }
          var bj;
          for(bj=st._bursts.length-1;bj>=0;bj--){ st._bursts[bj].t+=dt; if(st._bursts[bj].t>0.35) st._bursts.splice(bj,1); }
          var lowHp=(link.hp<=2);
          if(lowHp && !st.danger){ st.danger=true; EVENT('state',6,{name:'danger',on:true}); }
          else if(!lowHp && st.danger){ st.danger=false; EVENT('state',6,{name:'danger',on:false}); }
        }

    ctx.zeldaView = {
      A:A, U:U, st:st, COLS:COLS, ROWS:ROWS, GW:GW, GH:GH,
      cw:cw, ch:ch, grid:grid, link:link, clk:clk, cl:cl,
      energyMV:energyMV, dropMV:dropMV, beatScale:beatScale,
      barHue:barHue, hueAll:hueAll, dvec:dvec
    };
    return st;
  }

  var api = {
    packVersion: 3,
    key: 'zelda',
    name: 'ZELDA',
    family: 'top-down adventure',
    description: 'Top-down room traversal with continuous hero motion, a procedural critical path, optional branches, themed rooms, location-specific enemies, projectiles, pickups, doors, and hazards.',
    source: 'procedural-graph-index + Zoria-inspired tile vocabulary',
    visualReference: 'Zoria Tileset by DragonDePlatino, CC-BY 4.0, https://opengameart.org/content/zoria-tileset',
    entities: [
      'hero', 'enemy', 'projectile', 'pickup', 'wall', 'door', 'bush', 'hazard', 'spark', 'scoreText'
    ],
    rules: [
      'continuous four-way hero movement with tile-grid collision',
      'generated critical-path room graph',
      'generated optional side-branch rooms',
      'matched doors between connected rooms',
      'theme progression from safe grass toward cave/goal rooms',
      'theme-specific enemy families',
      'water enemies spawn on water',
      'room contents seeded from the generated graph',
      'multi-exit room graph where any side can connect to another room',
      'rare locked one-exit challenge rooms gated by enemy clear or a prior key',
      'room bounds',
      'enemy collision',
      'projectile collision',
      'pickup collection',
      'key pickup and locked-door release',
      'door transitions',
      'hazard avoidance',
      'room loop'
    ],
    events: [
      'pickupCollected', 'enemyHit', 'projectileFired', 'doorEntered', 'enemyNear', 'roomCleared', 'nearMiss'
    ],
    simulation: {
      timestep: 'fixed by shared runtime; game code clamps large dt locally',
      collision: 'owned by definition.js',
      worldGraph: 'each load generates a connected room graph with a critical route, optional branches, extra side connections, rare locked challenge rooms no closer than four depth steps, matched doors, progression themes, and room-safe contents',
      musicKnowledge: 'normalized snapshot only'
    },
    watchdog: { mode:'rooms', progress:30, motion:12, loop:10 },
    makeState: makeState,
    update: update
  };

  VisualizerGame.layer('zelda', 'definition', api);
  return api;
})();
