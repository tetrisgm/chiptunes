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
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const probe=async(p,ms)=>{const t0=Date.now();let peak=0;while(Date.now()-t0<ms){
 const v=await p.evaluate(()=>{const o=Audio.outputProbe();return o?o.peak:0;});
 if(v>peak)peak=v;await wait(90);}return peak;};
(async()=>{
 const h=await server();
 const b=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const p=await b.newPage({viewport:{width:1380,height:860}});
 p.on('pageerror',e=>console.log('[PAGEERROR]',String(e).slice(0,300)));
 p.on('console',m=>{if(m.type()==='error')console.log('[err]',m.text().slice(0,160));});
 await p.goto(`http://127.0.0.1:${h.port}/create`,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>document.querySelector('#createscreen.show'),null,{timeout:30000});
 await wait(1800);
 console.log('idle (want ~0):',(await probe(p,1200)).toFixed(3));
 const grid=await p.$('#createscreen canvas'); const box=await grid.boundingBox();
 const clickCell=async(fx,fy)=>{await p.mouse.click(box.x+box.width*fx,box.y+box.height*fy);};
 // poke BEFORE any play
 const pokeP=(async()=>probe(p,700))(); await clickCell(0.1,0.3); 
 console.log('poke before play (want >0):',(await pokeP).toFixed(3));
 for(const [fx,fy] of [[0.3,0.5],[0.5,0.3],[0.7,0.6]]) {await clickCell(fx,fy); await wait(150);}
 await wait(400);
 await p.click('[data-cr="play"]'); await wait(600);
 console.log('playing (want >0):',(await probe(p,3000)).toFixed(3),'owner:',await p.evaluate(()=>Audio.chipDiag().owner));
 await p.click('[data-cr="play"]'); await wait(600);
 console.log('stopped in editor (want ~0):',(await probe(p,1500)).toFixed(3),'owner:',await p.evaluate(()=>Audio.chipDiag().owner));
 // poke AFTER stop
 const poke2=(async()=>probe(p,700))(); await clickCell(0.85,0.4);
 console.log('poke after stop (want >0):',(await poke2).toFixed(3));
 await wait(800);
 await p.keyboard.press('Escape'); await wait(3000);
 console.log('radio after esc (want >0):',(await probe(p,3500)).toFixed(3),'owner:',await p.evaluate(()=>Audio.chipDiag().owner));
 await b.close();h.s.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
