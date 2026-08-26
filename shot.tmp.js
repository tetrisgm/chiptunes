const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('playwright');
const DIST=path.join(__dirname,'dist');
function server(){return new Promise(r=>{const s=http.createServer((q,e)=>{
 let rel=decodeURIComponent(new URL(q.url,'http://x').pathname).replace(/^\/+/,'');
 let f=path.join(DIST,rel||'index.html');
 if(!f.startsWith(DIST)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(DIST,'index.html');
 fs.readFile(f,(x,b)=>{if(x){e.writeHead(500);e.end();return;}
  e.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});e.end(b);});
});s.listen(0,'127.0.0.1',()=>r({s,port:s.address().port}));});}
(async()=>{
 const h=await server();
 const b=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const p=await b.newPage({viewport:{width:1380,height:860}});
 const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
 await p.goto(`http://127.0.0.1:${h.port}/create`,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.CT_CREATE&&document.getElementById('createscreen'),null,{timeout:60000});
 await p.waitForTimeout(1200);
 // place a little riff via real pointer events on the canvas
 const cvb=await p.evaluate(()=>{const c=document.querySelector('.cr-cv').getBoundingClientRect();
   return {x:c.x,y:c.y,w:c.width,h:c.height};});
 // approximate cells: use CT_CREATE internals? place via clicks across the grid
 for(const [fx,fy] of [[0.1,0.3],[0.2,0.45],[0.3,0.3],[0.42,0.2],[0.1,0.93],[0.3,0.93],[0.5,0.93],[0.2,0.86]]){
   await p.mouse.click(cvb.x+cvb.w*fx, cvb.y+cvb.h*fy);
   await p.waitForTimeout(80);
 }
 const st=await p.evaluate(()=>{
   const hash=location.hash;
   return {cells:(localStorage.getItem('ct-create-draft')||'').length>0,
     hashLen:hash.length, path:location.pathname};});
 // play
 await p.click('[data-cr="play"]'); await p.waitForTimeout(1500);
 const chip=await p.evaluate(()=>({diag:Audio.chipDiag(),stat:window.__rrrChip&&{peak:+window.__rrrChip.peak.toFixed(3),frame:window.__rrrChip.frame}}));
 console.log('state:',JSON.stringify(st));
 console.log('chip while playing:',JSON.stringify(chip));
 console.log('page errors:',errs.length?errs:'none');
 await p.screenshot({path:process.argv[2]});
 // Esc closes and hands the chip back
 await p.keyboard.press('Escape'); await p.waitForTimeout(600);
 const closed=await p.evaluate(()=>!CT_CREATE.isOpen());
 console.log('Esc closes:',closed);
 await b.close();h.s.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
