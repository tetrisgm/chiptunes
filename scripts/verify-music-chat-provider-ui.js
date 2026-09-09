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
          if(f.badJSON)return new Response('<!doctype html>static preview');
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
        const response=()=>new Response(JSON.stringify({id:body.id,baseRevision:body.baseRevision,edits:f.answer?[]:[{from:0,to:0,text:'// fixture proposal\n'}],explanation:f.answer?'This is a four-bar loop.':'Fixture proposal'}));
        if(f.hold)return new Promise(r=>{window.finishProposal=()=>r(response());});
        return response();
      };
    });
    await page.addScriptTag({path:path.join(__dirname,'../dist/lib/music-chat-ui.js')});
    await page.addStyleTag({path:path.join(__dirname,'../src/music-chat-ui.css')});
    await page.addScriptTag({path:path.join(__dirname,'../src/music-workspace.js')});await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
    await page.addStyleTag({path:path.join(__dirname,'../src/music-workspace.css')});
    await page.setViewportSize({width:1280,height:900});
    await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.includes('Locked.'));
    assert.equal(await page.locator('.mw-chat-settings').evaluate(el=>el.open),false,'Chat settings starts collapsed');
    assert.equal(await page.locator('.mw-owner-password').isVisible(),false,'owner controls are secondary');
    assert.equal(await page.locator('.mcui-status').isVisible(),true,'locked status stays visible');
    assert.equal(await page.locator('.mcui-log').getAttribute('role'),'log');
    assert.equal(await page.locator('.mw-external-mcp').evaluate(el=>el.open),false,'external MCP is collapsed by default');
    assert.equal(await page.locator('.mw-connect').isVisible(),false,'MCP setup does not occupy the sidebar');
    assert.equal(await page.evaluate(()=>{
      const sidebar=document.querySelector('.mw-chat'),chat=document.querySelector('.mcui-composer'),mcp=document.querySelector('.mw-external-mcp');
      const a=chat.getBoundingClientRect(),b=sidebar.getBoundingClientRect();
      return sidebar.scrollTop===0&&a.top>=b.top&&a.bottom<=b.bottom&&!sidebar.contains(mcp);
    }),true,'built-in Chat is visible first without expanding or scrolling past MCP');
    assert.deepEqual(await page.locator('.mw-chat-provider option').allTextContents(),['OpenAI','Claude']);
    await page.locator('.mcui textarea').fill('Keep this draft');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    assert.equal(await page.locator('.mw-chat-settings').evaluate(el=>el.open),true,'locked Send opens secure settings');
    assert.equal(await page.locator('.mcui textarea').inputValue(),'Keep this draft');
    await page.locator('.mw-owner-password').fill('wrong-fixture-password');await page.locator('[data-action=chat-unlock]').click();
    await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.includes('not accepted'));
    assert.equal(await page.locator('.mw-owner-password').inputValue(),'');
    assert.equal(await page.evaluate(()=>fixture.calls.length),0,'rejected unlock never calls the model');
    assert.equal(await page.locator('.mcui textarea').inputValue(),'Keep this draft','rejected unlock preserves the unsent request');
    async function unlock(){
      await page.locator('.mw-owner-password').fill('fixture-owner-password');await page.locator('[data-action=chat-unlock]').click();
      await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.startsWith('Unlocked.'));
    }
    await unlock();assert.equal(await page.evaluate(()=>fixture.calls.length),0,'unlock is not a model call');
    const settingsDraft=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft);
    await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Escape');
    assert.equal(await page.locator('.mw-chat-settings').evaluate(el=>el.open),false,'Escape closes only Settings after Tab/Shift+Tab');
    assert.equal(await page.locator('#musicworkspace').isVisible(),true,'modal Escape does not close workspace');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().draft),settingsDraft,'modal Escape preserves editor');
    assert.equal(await page.locator('.mcui-status').isVisible(),true,'unlocked status stays visible with settings closed');
    assert.equal(await page.locator('.mcui textarea').isVisible(),true);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('.mw-owner-password').inputValue(),'');
    await page.locator('.mw-chat-provider').selectOption('anthropic');await page.locator('[data-action=chat-settings-close]').click();await page.locator('.mcui textarea').fill('Add a comment');
    const before=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id);
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcui-proposal b')?.textContent==='ready');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),before,'proposal requires explicit Apply');
    assert.equal(await page.evaluate(()=>fixture.calls[0].provider),'anthropic');
    assert.equal(await page.evaluate(()=>fixture.passwordShape),true);
    assert.equal(await page.evaluate(()=>JSON.stringify(fixture.calls).includes('password')),false,'password absent from source/model payload');
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('fixture-owner-password')),false,'password not persisted');
    assert.equal(await page.evaluate(()=>Object.hasOwn(fixture.calls[0].body,'provider')),false,'body contract unchanged');
    await page.locator('.mcui-proposal button').filter({hasText:/^Apply$/}).click();
    assert.notEqual(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),before);
    assert.deepEqual(await page.locator('.mcui-message').evaluateAll(els=>els.map(el=>el.classList.contains('mcui-user')?'user':'assistant')),['user','assistant']);
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('.mw-chat-provider').selectOption('openai');await page.locator('[data-action=chat-settings-close]').click();await page.evaluate(()=>{fixture.hold=true;});
    await page.locator('.mcui textarea').fill('Another comment');
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>!!window.finishProposal);
    await page.getByRole('button',{name:'Stop generation',exact:true}).click();await page.evaluate(()=>finishProposal());
    assert.equal(await page.locator('.mcui-proposal b').textContent(),'rejected','cancelled response cannot apply');
    assert.equal(await page.evaluate(()=>fixture.calls[1].provider),'openai');
    await page.evaluate(()=>{fixture.hold=false;fixture.chatFailure=401;});
    await page.locator('.mcui textarea').fill('Check access');
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.includes('Chat is locked'));
    const expiredCalls=await page.evaluate(()=>fixture.calls.length);
    await page.locator('.mcui textarea').fill('Retain this request while locked');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    assert.equal(await page.locator('.mw-chat-settings').evaluate(el=>el.open),true,'expired access routes Send to unlock');
    assert.equal(await page.evaluate(()=>fixture.calls.length),expiredCalls,'expired access cannot send another model request');
    assert.equal(await page.locator('.mcui textarea').inputValue(),'Retain this request while locked');
    await unlock();
    await page.locator('[data-action=chat-settings-close]').click();
    await page.evaluate(()=>{fixture.chatFailure=0;fixture.answer=true;});
    const answerBase=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id);
    await page.locator('.mcui textarea').fill('Explain this');await page.locator('.mcui textarea').press('Shift+Enter');
    assert.equal(await page.locator('.mcui textarea').inputValue(),'Explain this\n','Shift+Enter keeps a newline');
    const callsBefore=await page.evaluate(()=>fixture.calls.length);
    await page.locator('.mcui textarea').press('Enter');
    await page.waitForFunction(()=>document.querySelector('.mcui-content').textContent.includes('This is a four-bar loop.'));
    assert.equal(await page.evaluate(()=>fixture.calls.length),callsBefore+1,'Enter sends once');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),answerBase,'answer does not apply a revision');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().request),null,'answer releases project request');
    assert.equal(await page.locator('.mcui-proposal button').count(),0,'text answer leaves no historical Apply buttons');
    assert.equal(await page.evaluate(()=>{
      const h=fixture.calls.at(-1).body.conversation;
      return h.length<=12&&new TextEncoder().encode(JSON.stringify(h)).length<=16384&&h.some(m=>m.role==='assistant')&&h.every(m=>Object.keys(m).sort().join(',')==='content,role');
    }),true,'bounded prior conversation sent with roles and content only');
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[data-action=chat-logout]').click();
    await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.startsWith('Locked.'));
    assert.equal(await page.evaluate(()=>fixture.accessMethods.includes('DELETE')),true);
    await page.evaluate(()=>{fixture.accessFailure=503;});await page.locator('[data-action=chat-access-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.includes('unavailable'));
    assert.equal(await page.locator('.mw-chat-settings').evaluate(el=>el.open),true,'unavailable access leaves recovery settings reachable');
    assert.equal(await page.locator('.mw-owner-password').inputValue(),'','unavailable access retains no password');
    await page.evaluate(()=>{fixture.accessFailure=0;fixture.badJSON=true;});await page.locator('[data-action=chat-access-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent==='Chat is unavailable on this server. Code and playback still work.');
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());
    console.log('PASS built-in chat UI: native settings, locked draft preservation, provider header, password isolation, explicit Apply, cancel, Enter/newline, text-only answer, bounded history, expired access, logout, unavailable');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
