'use strict';
// Production source slices with explicit audio/game fixtures. Browser layout
// assertions are not a claim of physical Safari or full-artifact acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const {chromium}=require('playwright');
const runtime=fs.readFileSync(require.resolve('../src/runtime.js'),'utf8');
const audio=fs.readFileSync(require.resolve('../src/audio.js'),'utf8');
function slice(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const adapter=slice(runtime,'function _musicWorkspaceOpen()','function _publishAudioOnlyMode(');
const sizing=slice(audio,"const cv = document.getElementById('stage');",'/* ---------- 8-bit sprite engine');
test('mounted live layers preserve canvas/world through resize, Perform, Off and exact detach',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    await page.setContent('<style>#stage,.crt{position:fixed;inset:0;width:100vw;height:100vh}.host{width:480px;height:400px}</style><main id="origin"><i id="before"></i><canvas id="stage"></canvas><div class="crt scanlines"></div><div class="crt vignette"></div><i id="after"></i></main><div class="host" id="host"></div><div class="host" id="perform"></div>');
    await page.addScriptTag({content:`
      var calls=[],world={frame:31},selState=world,gameT=17,selGame={key:'maze'},curGameKey='maze';
      var GAMES=[{key:'maze',name:'Maze'},{key:'blocks',name:'Blocks'}],randomMode=false;
      var _bgAudioOnly=false,lastFrame=1,_watchOnly=false,_trackTransitionTimer=0;
      var Audio=new Proxy({started:true},{get(o,k){if(k in o)return o[k];return ()=>{throw Error('Forbidden audio call: '+k)}}});
      var CT_MUSIC_WORKSPACE={isOpen:()=>true,isVisualizerOpen:()=>false};
      function _nowMs(){return 1} function _stopFrameLoop(){calls.push('stopDraw')} function _scheduleFrameLoop(){calls.push('draw')}
      function _fallbackGameKey(){return 'maze'} function showGame(key){calls.push('scene');selGame={key};curGameKey=key;selState={};gameT=0}
      ${sizing}
      ${adapter}
      var original=Array.from(document.getElementById('origin').childNodes), originalStyle=cv.getAttribute('style');
      var canvasDims=[cv.width,cv.height], stateBefore=selState;
      g.fillStyle='#ff0000';g.fillRect(0,0,4,4);
    `});
    const mounted=await page.evaluate(()=>CT_CREATE_PRESENTATION.mount(document.getElementById('host')));
    assert.equal(mounted.width,1200);assert.equal(mounted.height,800);assert.equal(mounted.scene,'maze');
    await page.evaluate(()=>{
      var p=CT_CREATE_PRESENTATION;
      if(_shouldBackgroundAudioOnly())throw Error('Persistent stage gated by Perform');
      var native=document.createElement('canvas');native.id='dmg';native.className='crt';
      cv.parentNode.insertBefore(native,cv.nextSibling);_visualLayer(native);
      var gain=document.createElement('canvas');gain.className='crt gain';
      var vig=document.querySelector('.vignette');vig.parentNode.insertBefore(gain,vig.nextSibling);_visualLayer(gain);
      p.setVisualizer(true);p.mount(document.getElementById('perform'));p.setVisualizer(false);
      p.setScene('off');if(!_shouldBackgroundAudioOnly())throw Error('Off must stop rendering');
      p.setScene('maze');p.setScene('maze');
      try{p.setScene('not-a-scene');throw Error('Accepted unknown scene')}catch(e){if(e.message==='Accepted unknown scene')throw e;}
    });
    await page.setViewportSize({width:900,height:700});
    await page.evaluate(()=>{document.getElementById('perform').style.width='333px';document.getElementById('perform').style.height='250px';});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.deepEqual(await page.evaluate(()=>({dims:[cv.width,cv.height],same:selState===stateBefore,t:gameT,pixel:Array.from(g.getImageData(0,0,1,1).data),scenes:calls.filter(c=>c==='scene').length})),{dims:[1200,800],same:true,t:17,pixel:[255,0,0,255],scenes:0});
    const layer=await page.locator('#dmg').boundingBox(),host=await page.locator('#perform').boundingBox();
    assert(layer.x>=host.x&&layer.y>=host.y&&layer.width<=host.width+1&&layer.height<=host.height+1);
    assert.equal(await page.evaluate(()=>{
      CT_CREATE_PRESENTATION.unmount();
      var nodes=Array.from(document.getElementById('origin').childNodes).filter(n=>original.includes(n));
      return nodes.every((n,i)=>n===original[i])&&cv.getAttribute('style')===originalStyle&&document.getElementById('dmg').parentNode.id==='origin'&&document.querySelector('.gain').parentNode.id==='origin'&&!document.querySelector('.ct-visual-surface')&&selState===stateBefore;
    }),true);
    await page.close();
  }finally{await browser.close();}
});
test('cold mount uses 960x540 and initializes a fallback only once',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<canvas id="stage"></canvas><div id="host" style="width:480px;height:270px"></div>');
    await page.addScriptTag({content:`var Audio={started:false},selGame=null,curGameKey='',GAMES=[{key:'maze',name:'Maze'}],randomMode=false,_bgAudioOnly=false,lastFrame=0,makes=0,_trackTransitionTimer=0;
      var CT_MUSIC_WORKSPACE={isOpen:()=>true,isVisualizerOpen:()=>false};function _nowMs(){return 0}function _stopFrameLoop(){}function _scheduleFrameLoop(){}function _fallbackGameKey(){return 'maze'}function showGame(k){makes++;selGame={key:k};curGameKey=k}
      ${sizing}\n${adapter}`});
    assert.deepEqual(await page.evaluate(()=>{var p=CT_CREATE_PRESENTATION,h=document.getElementById('host');p.mount(h);p.mount(h);p.setScene('off');p.setScene('maze');return [p.snapshot().width,p.snapshot().height,makes,cv.width,cv.height];}),[960,540,1,960,540]);
  }finally{await browser.close();}
});
test('native panel sizing preserves existing framebuffer/feedback while docked',()=>{
  for(const [file,type,kind] of [['dmg-screen.js','DmgScreen','dmg'],['nes-screen.js','NesScreen','nes']]){
    const source=fs.readFileSync(require.resolve('../src/'+file),'utf8');
    const fn=slice(source,'  '+type+'.prototype.resize = function () {','\n  };')+'\n  };';
    const context={G:{innerWidth:500,innerHeight:300,devicePixelRatio:3,__ctVisualViewport:k=>{assert.equal(k,kind);return {width:1200,height:800,dpr:1,outputWidth:1200,outputHeight:800};}}};
    context[type]=function(){};vm.runInNewContext(fn,context);
    const panel=new context[type]();panel.canvas={};panel.vw=1200;panel.vh=800;panel.fb={identity:1};
    const feedback=panel.fb;panel.resize();assert.equal(panel.fb,feedback);assert.equal(panel.canvas.width,undefined,'must return before resizing/deleting feedback');
  }
});
test('late native readiness settles a stopped stage, ignoring inactive panels',()=>{
  const calls=[],panel={resize:()=>calls.push('panel')},other={resize:()=>{throw Error('inactive resize')}};
  const s={_panel:()=>panel,resize:()=>calls.push('stage'),_pnlHold:0,_syncCreateRendering:()=>calls.push('draw')};
  vm.createContext(s);vm.runInContext(slice(runtime,'function _nativePanelReady(panel){','function _applyScreenMode(){'),s);
  s._nativePanelReady(other);assert.deepEqual(calls,[]);
  s._nativePanelReady(panel);assert.deepEqual(calls,['panel','stage','draw']);assert.equal(s._pnlHold,3);
  assert.equal(panel._sizeDirty,true);
});
test('stale radio reseat cannot recreate a mounted workspace world',()=>{
  const block=slice(runtime,'  if(_reseatScene){ _reseatScene=false;','  const silentWatch');
  const world={identity:1},s={_reseatScene:true,musicPresentation:{},sceneKind:'game',selGame:{make(){throw Error('World reset')}},selState:world};
  vm.runInNewContext(block,s);assert.equal(s.selState,world);assert.equal(s._reseatScene,false);
});
test('document Escape leaves the workspace open even when fullscreen returns focus to body',()=>{
  const code=slice(runtime,'function handleEscapeShortcut(ev){',"  if(!ev || ev.key!=='Escape'")+ 'return false;}';
  const s={CT_MUSIC_WORKSPACE:{isOpen:()=>true,close(){throw Error('Workspace closed')}},consumeKeyEvent(){throw Error('Escape consumed')}};
  vm.createContext(s);vm.runInContext(code,s);
  assert.equal(s.handleEscapeShortcut({key:'Escape',target:{tagName:'BODY'}}),false);
  assert.equal(s.handleEscapeShortcut({key:'Escape',target:null}),false);
});
test('station snow stays outside composition and cannot filter the mounted stage',()=>{
  const classes=new Set(['on']),bodyClasses=new Set(['track-transition']);
  const el={classList:{remove:k=>classes.delete(k),add:k=>classes.add(k)}};
  const s={_visualMount:{},_musicWorkspaceOpen:()=>true,_trackTransitionTimer:0,clearTimeout(){},setTimeout(){throw Error('Station transition scheduled')},
    document:{getElementById:()=>el,body:{classList:{remove:k=>bodyClasses.delete(k),add:k=>bodyClasses.add(k)}}}};
  vm.createContext(s);vm.runInContext(slice(runtime,'function _showTrackTransition(){','window._showTrackTransition='),s);
  s._showTrackTransition();assert.equal(classes.size,0);assert.equal(bodyClasses.size,0);
});
function routes(path='/',hash=''){
  const calls=[],s={location:{pathname:path,search:'',hash},_RRR_BROADCAST:false,_createEntryEpoch:0,_createStandalone:false,
    document:{body:{classList:{add(){}}}},console,Audio:{currentDoc:()=>null,playScore:()=>calls.push('playScore')},
    CT_CREATE:{},CT_MUSIC_LANGUAGE:{},CT_MUSIC_WORKSPACE:{open:async()=>{calls.push('open')},isOpen:()=>false},
    _musicWorkspaceOpen:()=>false,_readSharedDoc:()=>null,_unmountVisual:()=>{},_syncCreateRendering:()=>{},resize:()=>{},
    _startEndlessRadio:()=>calls.push('listen'),startAudio:()=>calls.push('start'),_openGameBoyWhenReady:()=>calls.push('gameboy'),enterWatchMode:()=>calls.push('watch'),openProductHome:()=>calls.push('get'),
    _stopHomeBackdrop(){},hideHome(){},_unpackDoc:async()=>null};
  s.window=s;s.addEventListener=()=>{};s.history={replaceState(_a,_b,url){s.location.pathname=url;s.location.hash='';}};
  vm.createContext(s);
  vm.runInContext(slice(runtime,'function _pathParts(path){','function _queryFlag('),s);
  vm.runInContext(slice(runtime,'var _createStandalone=false;','// HOW IT WORKS.'),s);
  vm.runInContext(slice(runtime,'function _productRouteFromPath(path){','// ----- station entry:'),s);
  return {s,calls};
}
test('root/create and explicit listening route dispatch preserve music-first ownership',async()=>{
  for(const path of ['/','/create']){const f=routes(path);f.s._productRouteTo(path);await Promise.resolve();assert.deepEqual(f.calls,['open']);}
  for(const [path,expected] of [['/listen','listen'],['/watch','watch'],['/get','get'],['/gameboy','listen']]){
    const f=routes(path);f.s._productRouteTo(path);assert.equal(f.calls[0],expected);
  }
  const f=routes('/create');f.s._openCreate();await Promise.resolve();f.calls.length=0;
  f.s._closeCreateReturn();assert.deepEqual(f.calls,[]);
  f.s._closeCreateReturn({listen:false});assert.deepEqual(f.calls,[]);
  f.s._closeCreateReturn({listen:true});assert.deepEqual(f.calls,['listen','playScore']);assert.equal(f.s.location.pathname,'/listen');
  assert.equal(f.s._generatedRoute(),'/listen');
});
test('actual boot branch opens root/#music stopped and preserves broadcast/listen/watch/gameboy',()=>{
  const marker="if(String(_pathParts(location.pathname||'/')[0]||'').toLowerCase()==='get') buildHomeTiles();";
  const boot=slice(runtime,marker,'// (the speaker button now opens this mixer;');
  for(const [path,hash,broadcast,expected] of [['/','',false,'open'],['/','#music=fixture',false,'open'],['/create','',false,'open'],['/listen','',false,'start'],['/','',true,'start'],['/watch','',false,'watch'],['/gameboy','',false,'start']]){
    const f=routes(path,hash);f.s._RRR_BROADCAST=broadcast;f.s.buildHomeTiles=()=>{};
    vm.runInContext(boot,f.s);assert.equal(f.calls[0],expected,path+hash);
  }
});
test('live station join retains the explicit Listen route after audio handback',()=>{
  const join=slice(runtime,'  function join(){','  function stop(){');
  const writes=[],s={active:false,misses:0,timer:0,composerGet(){},syncFn(){},tick(){},seekToSchedule:()=>true,
    Audio:{started:true,gotoTrackAtOffset(){},setLiveMode(){}},Radio:{setLive(){}},
    _generatedRoute:()=>'/listen',_routeQueryExtras:()=>'?game=maze',setInterval:()=>1,
    history:{replaceState(_a,_b,url){writes.push(url);}},window:{}};
  vm.createContext(s);vm.runInContext(join,s);assert.equal(s.join(),true);
  assert.deepEqual(writes,['/listen?game=maze']);
  assert.equal(s.join(),true);assert.equal(writes.length,1,'already-active join does not navigate');
  s.active=false;s.window.__RRR_BOOT_PLAYER_ROUTE=true;s.join();
  assert.equal(writes.length,1,'preserves existing boot-owned route guard');
});
test('cartridge close returns to listening, respecting noRoute and broadcast compatibility',()=>{
  const code=slice(runtime,'function _closeGameBoy(opts){','function _toggleGameBoyEmulator()');
  const writes=[],s={_gbEmu:null,_gbEmuOn:true,_syncTryPill(){},Audio:{playScore(){}},
    location:{pathname:'/gameboy'},_RRR_BROADCAST:false,
    document:{getElementById:()=>null,body:{classList:{remove(){}}}},history:{pushState(_a,_b,url){writes.push(url);}}};
  vm.createContext(s);vm.runInContext(slice(runtime,'function _generatedRoute(){','function _queryFlag(')+code,s);
  s._closeGameBoy();assert.deepEqual(writes,['/listen']);
  s._closeGameBoy({noRoute:true});assert.equal(writes.length,1);
  s._RRR_BROADCAST=true;s._closeGameBoy();assert.equal(writes[1],'/');
  s._RRR_BROADCAST=false;s.location.pathname='/watch';assert.equal(s._generatedRoute(),'/watch');
});
test('actual pre-paint shell sends old player bookmarks to Listen and hides the mood wall only for composition/output',()=>{
  const shell=fs.readFileSync(require.resolve('../src/shell.html'),'utf8');
  const code=shell.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  for(const [pathname,search,hash,redirect,prepaint] of [
    ['/player','','','/listen',false],
    ['/player/','?screen=dmg','#s=exact','/listen?screen=dmg#s=exact',false],
    ['/','','',null,true],['/','','#music=project',null,true],
    ['/','?broadcast=1','',null,false],['/listen','','',null,false],
    ['/create','','',null,true],['/watch','','',null,true]
  ]){
    const writes=[],classes=[],s={URLSearchParams,window:{},
      location:{hostname:'chiptunes.app',pathname,search,hash,replace:url=>writes.push(url)},
      document:{documentElement:{classList:{add:name=>classes.push(name)}}}};
    vm.runInNewContext(code,s);
    assert.deepEqual(writes,redirect?[redirect]:[],pathname+search+hash);
    assert.equal(classes.includes('boot-player-route'),prepaint,pathname+search+hash);
    assert.equal(!!s.window.__RRR_BOOT_PLAYER_ROUTE,prepaint);
  }
});
test('successful live track join clears cold-landing hold; failed or empty joins keep it',()=>{
  for(const valid of [true,false]){
    const s={_holdForPick:true,ctx:null,started:false,transportPaused:false,
      compileScore:()=>valid?{score:{},tok:'joined'}:null,
      Engine:{newGeneration:()=>1,setTempo(){}},
      mkDeck:()=>({tok:'joined',totalBeats:16,spb:.5,events:[],nativeBpm:120}),
      retimeDeckOrigin:(d,t)=>{d.origin=t;},gbPlay(){},sectionAt:()=>null,
      updateMusicalNow(){},setGridTempo(){},announceDeck(){},mnow:{},energy:0};
    vm.createContext(s);
    vm.runInContext(slice(audio,'  function startTrackAtOffset(','  function prepareNextDeck('),s);
    assert.equal(s.startTrackAtOffset('',0),null);assert.equal(s._holdForPick,true);
    assert.equal(s.startTrackAtOffset('joined',2),valid?'joined':null);
    assert.equal(s._holdForPick,!valid);
  }
});
