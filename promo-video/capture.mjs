import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const dist=path.resolve(here,'../dist');
const pub=path.join(here,'public');
fs.mkdirSync(pub,{recursive:true});

const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/, '');
  let file=path.join(dist,pathname||'index.html');
  if(!file.startsWith(dist)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) file=path.join(dist,'index.html');
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
await page.goto(url,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(3500);
await page.screenshot({path:path.join(pub,'landing.png')});

await page.locator('.rmood').filter({hasText:'happy'}).first().click();
await page.waitForFunction(()=>!document.querySelector('.rmood.busy')&&document.body.classList.contains('ai-visual'),null,{timeout:30000});
await page.waitForTimeout(4200);
await page.evaluate(()=>{ if(window._pokeVisualControls) window._pokeVisualControls(); });
await page.screenshot({path:path.join(pub,'playing.png')});

await page.locator('#noteribbon').click();
await page.waitForFunction(()=>document.querySelector('#createscreen.show'),null,{timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(()=>{ const t=document.querySelector('.cr-tour'); if(t)t.remove(); });
await page.screenshot({path:path.join(pub,'create.png')});

await browser.close();
server.close();
console.log('captured landing, playing, and Create at 1280x720');
