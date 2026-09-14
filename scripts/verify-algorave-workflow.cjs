'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {createMusicChatHandler}=require('../server/music-chat-handler.js');
const root=path.resolve(__dirname,'../.algorave-preview');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  let calls=0;
  const handler=createMusicChatHandler({origin,authenticate:async()=>({subject:'fixture-owner'}),rateLimit:async()=>true,
    adapter:{authorized:true,async propose(options){
      calls++;assert.deepEqual(options.tools,[]);const c=JSON.parse(options.input),edits=[];
      const edit=(document,oldText,text)=>{
        const source=document==='music'?c.project.music:c.project.visuals[document],from=source.indexOf(oldText);assert(from>=0);
        edits.push({document,from,to:from+oldText.length,text});
      };
      if(c.request==='quiet')edit('music','.gain(.5)','.gain(.3)');
      if(c.request==='kick')edit('Image','bass * 5.','ctKick * 4.');
      if(c.request==='both'){edit('music','setcpm(30)','setcpm(36)');edit('Image','vec3(0,2,4)','vec3(4,2,0)');}
      if(c.request==='bad-music'){edit('music','setcpm(36)','setcpm(500); nonexistentPatternFunction()');edit('Image','vec3(4,2,0)','vec3(0,2,4)');}
      if(c.request==='bad-shader'){edit('music','setcpm(36)','setcpm(40)');edit('Image','void mainImage','invalid mainImage');}
      return new Response(JSON.stringify({id:c.id,baseRevision:c.baseRevision,edits,explanation:'Fixture '+c.request})).body;
    }}});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/music/chat/access',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:true,providers:[{id:'openai'}]})}));
    await page.route('**/api/music/chat',async route=>{
      const q=route.request(),r=await handler(new Request(q.url(),{method:'POST',headers:q.headers(),body:q.postData()}));
      await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});
    });
    await page.goto(origin);await page.waitForFunction(()=>window.algoravePreview);
    assert.equal(await page.locator('#agent').isVisible(),false);
    const original=await page.evaluate(()=>structuredClone(algoravePreview.session.draft));
    await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>algoravePreview.playing);
    await page.getByRole('button',{name:'Agent',exact:true}).click();
    const snapshot=()=>page.evaluate(()=>({draft:structuredClone(algoravePreview.session.draft),applied:structuredClone(algoravePreview.session.applied)}));
    async function ask(text){await page.locator('#prompt').fill(text);await page.locator('#ask').click();await page.locator('#proposal').waitFor({state:'visible'});}
    async function apply(){await page.locator('#apply').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Proposal applied');}
    await ask('quiet');assert.deepEqual((await snapshot()).draft,original,'proposal leaves source unchanged');await apply();
    assert.equal((await snapshot()).draft.music,original.music.replace('.gain(.5)','.gain(.3)'));
    assert.deepEqual((await snapshot()).draft.visuals,original.visuals);
    await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');
    assert.deepEqual((await snapshot()).draft,original,'Undo restores exact original code');await page.locator('#menu summary').click();
    await ask('kick');await apply();assert.equal((await snapshot()).draft.music,original.music);
    assert((await snapshot()).draft.visuals.Image.includes('ctKick * 4.'));
    await ask('both');await apply();await page.waitForFunction(()=>Math.abs(algoravePreview.signal.cps-.6)<.001);
    const accepted=await snapshot();assert(accepted.draft.music.includes('setcpm(36)'));
    const epoch=await page.evaluate(()=>algoravePreview.signal.epoch);
    await ask('bad-music');await page.locator('#apply').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('nonexistentPatternFunction'));
    assert.deepEqual(await snapshot(),accepted,'failed paired music validation changes neither document');
    assert.equal(await page.evaluate(()=>algoravePreview.signal.cps),.6,'staging cannot change live tempo');
    assert.equal(await page.evaluate(()=>algoravePreview.signal.epoch),epoch,'staging cannot restart transport');
    await ask('bad-shader');await page.locator('#apply').click();await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Image:'));
    assert.deepEqual(await snapshot(),accepted);assert.equal(await page.evaluate(()=>algoravePreview.signal.cps),.6);
    await ask('quiet');
    await page.getByLabel('Strudel music').fill(accepted.draft.music+'\n// manual edit');
    await page.locator('#apply').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('source changed'));
    assert.deepEqual((await snapshot()).applied,accepted.applied);
    await page.getByLabel('Strudel music').fill(accepted.draft.music);
    await page.locator('#agent-toggle').click();await page.locator('#mode').selectOption('both');
    await page.waitForFunction(()=>{
      const s=algoravePreview.shader,g=s.gl;
      const b=new Uint8Array(s.canvas.width*s.canvas.height*4);g.readPixels(0,0,s.canvas.width,s.canvas.height,g.RGBA,g.UNSIGNED_BYTE,b);
      return b.some((v,i)=>i%4!==3&&v>50);
    });
    await page.locator('#menu summary').click();await page.locator('#save').click();await page.locator('#menu summary').click();
    assert(await page.locator('#status').isVisible());
    assert(await page.evaluate(()=>document.getElementById('status').getBoundingClientRect().bottom<=innerHeight));
    await page.screenshot({path:path.join(root,'workspace-agent.png')});
    await page.reload();await page.waitForFunction(()=>window.algoravePreview);
    assert.deepEqual(await snapshot(),accepted,'save/reload restores music, shader and applied revision');
    assert.equal(await page.evaluate(()=>algoravePreview.playing),false,'reload never autoplays');
    assert.equal(await page.locator('#agent').isVisible(),false);
    assert.equal(calls,6);assert.deepEqual(errors,[]);
    console.log('PASS: real gateway fixtures through collapsed chat, music/visual/paired Apply, exact Undo, invalid paired retention, unchanged clock, saved reload without autoplay. Six fixture requests; zero live providers.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
