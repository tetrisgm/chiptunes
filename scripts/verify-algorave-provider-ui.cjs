'use strict';
// Replay saved real replies through the UI without additional provider calls.
// --serve <provider> exposes the same local replay for native Safari checks.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),contract=require('../src/algorave/project.cjs');
async function serve(provider){
  assert(['openai','anthropic'].includes(provider));
  const capture=JSON.parse(fs.readFileSync(path.join(root,'.algorave-preview',`provider-${provider}.json`)));
  assert.equal(capture.fixture,false);assert.equal(capture.status,'captured');assert.equal(capture.cases.length,3);
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url==='/api/music/chat/access'){
        res.setHeader('content-type','application/json');return res.end(JSON.stringify({authenticated:true,providers:[{id:provider}]}));
      }
      if(req.url==='/api/music/chat'&&req.method==='POST'){
        let body='';for await(const chunk of req){body+=chunk;if(body.length>131072)throw Error('body limit');}
        const context=JSON.parse(body),item=capture.cases.find(x=>x.context.request===context.request);
        assert(item,'Use an exact captured request');assert.deepEqual(context.project,item.context.project,'Replay source must match the captured source');
        assert.equal(context.baseRevision,await contract.revision(context.project));
        const proposal={...item.proposal,id:context.id,baseRevision:context.baseRevision};
        assert.deepEqual(contract.candidateFrom(context.project,proposal,context),item.candidate);
        res.setHeader('content-type','application/json');return res.end(JSON.stringify(proposal));
      }
      const base=path.join(root,'dist'),file=path.join(base,new URL(req.url,'http://localhost').pathname==='/'?'algorave/index.html':new URL(req.url,'http://localhost').pathname);
      if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
      res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
    }catch{res.writeHead(409,{'content-type':'application/json'});res.end('{"error":"captured reply does not match this request/project"}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,capture,url:`http://127.0.0.1:${server.address().port}/algorave/index.html`};
}
(async()=>{
  if(process.argv[2]==='--serve'){
    const {url}=await serve(process.argv[3]);console.log(url);return;
  }
  const {chromium}=require('playwright');
  for(const provider of ['openai','anthropic']){
    const {server,capture,url}=await serve(provider),browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);await page.waitForFunction(()=>window.algoravePreview);
      await page.locator('#play').click();await page.waitForFunction(()=>algoravePreview.playing);
      await page.locator('#agent-toggle').click();
      const ask=async()=>{
        const response=page.waitForResponse(r=>r.url().endsWith('/api/music/chat')&&r.request().method()==='POST');
        await page.locator('#ask').click();assert.equal((await response).status(),200);
        await page.locator('#proposal').waitFor({state:'visible'});
      };
      const apply=async candidate=>{
        await page.locator('#apply').click();
        await page.waitForFunction(p=>JSON.stringify(algoravePreview.session.applied)===JSON.stringify(p),candidate);
      };
      for(const item of capture.cases){
        await page.locator('#prompt').fill(item.context.request);await ask();
        assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),item.context.project,'proposal cannot auto-apply');
        await apply(item.candidate);
        assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),item.candidate);
        await page.locator('#menu summary').click();await page.locator('#undo').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Undone');
        assert.deepEqual(await page.evaluate(()=>algoravePreview.session.draft),item.context.project,'exact UI Undo');
        await page.locator('#menu summary').click();
        await ask();await apply(item.candidate);
      }
      await page.locator('#mode').selectOption('both');await page.screenshot({path:path.join(root,'.algorave-preview',`provider-${provider}-ui.png`)});
      await page.locator('#menu summary').click();await page.locator('#save').click();await page.reload();await page.waitForFunction(()=>window.algoravePreview);
      assert.deepEqual(await page.evaluate(()=>algoravePreview.session.applied),capture.cases.at(-1).candidate);
      assert.equal(await page.evaluate(()=>algoravePreview.playing),false);assert.deepEqual(errors,[]);
      console.log(`PASS ${provider}: captured real replies through chat, Apply, exact Undo, re-Apply, save/reload; zero API calls`);
    }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
