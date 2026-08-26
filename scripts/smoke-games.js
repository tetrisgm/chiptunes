#!/usr/bin/env node
'use strict';
// Product smoke: every fixed bundled game can be selected and advances in the
// real browser runtime without throwing. Pack installation and corruption tests
// no longer exist because Chiptunes is not a plug-in host.
const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('playwright');
const {scanGamePacks}=require('./game-roster.cjs');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist');
const FRAMES=Math.max(30,Number((process.argv.find(x=>x.startsWith('--frames='))||'').split('=')[1])||90);
function server(){
  return new Promise((resolve,reject)=>{
    const s=http.createServer((req,res)=>{
      let rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,'');
      let file=path.join(DIST,rel||'index.html');
      if(!file.startsWith(DIST)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(DIST,'index.html');
      fs.readFile(file,(err,buf)=>{if(err){res.writeHead(500);res.end(String(err));return;}
        res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream','cache-control':'no-store'});res.end(buf);});
    });
    s.on('error',reject);s.listen(0,'127.0.0.1',()=>resolve({s,url:`http://127.0.0.1:${s.address().port}/radio?game=hover`}));
  });
}
(async()=>{
  const ids=scanGamePacks().map(p=>p.id).sort();
  const host=await server(),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e&&e.stack||e)));
  try{
    await page.goto(host.url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.CT_GAMES&&Object.keys(CT_GAMES).length>=14&&window.__rrrFrame,null,{timeout:60000});
    const registered=await page.evaluate(()=>Object.keys(CT_GAMES).sort());
    for(const id of ids){
      if(!registered.includes(id)){errors.push(`${id}: not bundled`);continue;}
      const before=await page.evaluate(()=>window.__rrrFrame.seq);
      await page.evaluate(id=>{window.chooseVisualizerGame(id);},id);
      await page.waitForFunction(({before,id})=>window.__rrrFrame.seq>=before+3&&document.documentElement.dataset.rrrGame===id,{before,id},{timeout:10000});
      for(let i=0;i<FRAMES/3;i++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    }
    // The roster is fixed and every pack name must stay generic (see AGENTS.md):
    // anything registered that the source tree does not declare is a regression.
    for(const id of registered)if(!ids.includes(id))errors.push(`${id}: registered but not a declared pack`);
  }finally{await browser.close();host.s.close();}
  if(errors.length){console.error(errors.join('\n\n'));process.exit(1);}
  console.log(`smoke-games: ${ids.length} bundled games selected and advanced`);
})().catch(err=>{console.error(err&&err.stack||err);process.exit(1);});
