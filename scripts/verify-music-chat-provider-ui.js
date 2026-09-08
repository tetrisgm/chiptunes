'use strict';
// Browser fixtures only: no owner credential, API key or model is used.
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {Client}=require('../src/music-chat');
const server=http.createServer((req,res)=>res.end('<!doctype html><body></body>'));
(async()=>{
  const context={id:'provider-test',request:'Add comment',source:'song({tempo:128,bars:4})\n',baseRevision:'r1',constraints:{locks:[]}};
  for(const provider of ['openai','anthropic']){
    const client=new Client({provider,fetch:async(url,o)=>{
      assert.equal(url,'/api/music/chat');assert.equal(o.headers['X-Music-Provider'],provider);
      assert.equal(o.credentials,'same-origin');assert.deepEqual(JSON.parse(o.body),context);
      return new Response(JSON.stringify({id:context.id,baseRevision:context.baseRevision,edits:[{from:0,to:0,text:'// provider\n'}],explanation:'Comment'}));
    }});await client.request(context);
  }
  await assert.rejects(new Client({provider:'unknown',fetch:()=>{throw Error('must not fetch');}}).request(context),/Unknown chat provider/);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
    for(const f of ['gb-hardware.js','music-language.js','music-project.js','music-chat.js'])await page.addScriptTag({path:path.join(__dirname,'../src',f)});
    await page.evaluate(()=>{
      window.Audio={musicStop(){},enterCreate(){},onMusicState(){return ()=>{};}};window.CT_CREATE={};
      window.CT_MUSIC_CODE_EDITOR={help:{},mount(el,text,change){window.editSource=change;return {set(){},diagnostics(){},focus(){},select(){}};}};
      window.fixture={authenticated:false,accessFailure:0,chatFailure:0,calls:[],accessMethods:[],passwordShape:true,hold:false};
      window.fetch=async(url,o)=>{
        const f=fixture;
        if(o.credentials!=='same-origin')throw Error('credentials mismatch');
        if(url==='/api/music/chat/access'){
          f.accessMethods.push(o.method);
          if(o.method==='POST'){
            const b=JSON.parse(o.body);f.passwordShape=f.passwordShape&&Object.keys(b).join(',')==='password';
            if(b.password!=='fixture-owner-password')return new Response('{}',{status:401});
            f.authenticated=true;
          }
          if(o.method==='DELETE')f.authenticated=false;
          if(f.accessFailure)return new Response('{}',{status:f.accessFailure});
          return new Response(JSON.stringify(o.method==='GET'?{ok:true,authenticated:f.authenticated,providers:[{id:'openai',label:'OpenAI'},{id:'anthropic',label:'Claude'}],limits:{dailyCalls:20}}:{ok:true}));
        }
        if(url!=='/api/music/chat')throw Error('unexpected endpoint');
        const body=JSON.parse(o.body);f.calls.push({body,provider:o.headers['X-Music-Provider']});
        if(f.chatFailure)return new Response('{}',{status:f.chatFailure});
        const response=()=>new Response(JSON.stringify({id:body.id,baseRevision:body.baseRevision,edits:[{from:0,to:0,text:'// fixture proposal\n'}],explanation:'Fixture proposal'}));
        if(f.hold)return new Promise(r=>{window.finishProposal=()=>r(response());});
        return response();
      };
    });
    await page.addScriptTag({path:path.join(__dirname,'../src/music-workspace.js')});await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
    await page.addStyleTag({path:path.join(__dirname,'../src/music-workspace.css')});
    await page.setViewportSize({width:1280,height:900});
    await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.includes('Locked.'));
    assert.equal(await page.locator('.mw-external-mcp').evaluate(el=>el.open),false,'external MCP is collapsed by default');
    assert.equal(await page.locator('.mw-connect').isVisible(),false,'MCP setup does not occupy the sidebar');
    assert.equal(await page.evaluate(()=>{
      const sidebar=document.querySelector('.mw-chat'),chat=document.querySelector('.mw-chat-access'),mcp=document.querySelector('.mw-external-mcp');
      const a=chat.getBoundingClientRect(),b=sidebar.getBoundingClientRect();
      return sidebar.scrollTop===0&&a.top>=b.top&&a.bottom<=b.bottom&&sidebar.lastElementChild===mcp&&!!(chat.compareDocumentPosition(mcp)&Node.DOCUMENT_POSITION_FOLLOWING);
    }),true,'built-in Chat is visible first without expanding or scrolling past MCP');
    assert.deepEqual(await page.locator('.mw-chat-provider option').allTextContents(),['OpenAI','Claude']);
    assert.equal(await page.locator('[data-action=chat]').isDisabled(),true);
    await page.locator('.mw-owner-password').fill('wrong-fixture-password');await page.locator('[data-action=chat-unlock]').click();
    await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.includes('not accepted'));
    assert.equal(await page.locator('.mw-owner-password').inputValue(),'');
    assert.equal(await page.locator('[data-action=chat]').isDisabled(),true);
    async function unlock(){
      await page.locator('.mw-owner-password').fill('fixture-owner-password');await page.locator('[data-action=chat-unlock]').click();
      await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.startsWith('Unlocked.'));
    }
    await unlock();assert.equal(await page.evaluate(()=>fixture.calls.length),0,'unlock is not a model call');
    assert.equal(await page.locator('.mw-owner-password').inputValue(),'');
    await page.locator('.mw-chat-provider').selectOption('anthropic');await page.locator('.mw-chat-input').fill('Add a comment');
    const before=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id);
    await page.locator('[data-action=chat]').click();await page.waitForFunction(()=>document.querySelector('.mw-proposal b')?.textContent==='ready');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),before,'proposal requires explicit Apply');
    assert.equal(await page.evaluate(()=>fixture.calls[0].provider),'anthropic');
    assert.equal(await page.evaluate(()=>fixture.passwordShape),true);
    assert.equal(await page.evaluate(()=>JSON.stringify(fixture.calls).includes('password')),false,'password absent from source/model payload');
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('fixture-owner-password')),false,'password not persisted');
    assert.equal(await page.evaluate(()=>Object.hasOwn(fixture.calls[0].body,'provider')),false,'body contract unchanged');
    await page.locator('.mw-proposal button').filter({hasText:/^Apply$/}).click();
    assert.notEqual(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),before);
    await page.locator('.mw-chat-provider').selectOption('openai');await page.evaluate(()=>{fixture.hold=true;});
    await page.locator('[data-action=chat]').click();await page.waitForFunction(()=>!!window.finishProposal);
    await page.locator('[data-action=cancel]').click();await page.evaluate(()=>finishProposal());
    assert.equal(await page.locator('.mw-proposal b').textContent(),'rejected','cancelled response cannot apply');
    assert.equal(await page.evaluate(()=>fixture.calls[1].provider),'openai');
    await page.evaluate(()=>{fixture.hold=false;fixture.chatFailure=401;});
    await page.locator('[data-action=chat]').click();await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.includes('Chat is locked'));
    assert.equal(await page.locator('[data-action=chat]').isDisabled(),true,'expired access locks model requests');
    await unlock();await page.locator('[data-action=chat-logout]').click();
    await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.startsWith('Locked.'));
    assert.equal(await page.evaluate(()=>fixture.accessMethods.includes('DELETE')),true);
    await page.evaluate(()=>{fixture.accessFailure=503;});await page.locator('[data-action=chat-access-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('.mw-chat-access-status').textContent.includes('unavailable'));
    assert.equal(await page.locator('[data-action=chat]').isDisabled(),true);
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());
    console.log('PASS built-in chat UI: provider header, unchanged payload, unlock failure, no automatic call, password isolation, explicit Apply, cancel, expired access, logout, unavailable');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
