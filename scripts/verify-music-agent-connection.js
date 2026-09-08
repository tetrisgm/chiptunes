'use strict';
// Source-only browser panel + explicit fetch fixtures, no build or hosted auth.
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const server=http.createServer((req,res)=>res.end('<!doctype html><body></body>'));
async function mockAuthModule(page){
  await page.route('**/api/auth',route=>route.fulfill({contentType:'text/javascript',body:
    'export async function ready(){}; export async function getSessionToken(){return "fixture-session-token";}'}));
}
async function tokenProviderChecks(page){
  await page.clock.install();
  await page.evaluate(()=>{
    window.authFixture={calls:0,tokenCalls:0,start:Date.now(),mode:'ok',fresh:false,bindings:new Set()};
    const f=authFixture;
    window.authController=CT_MUSIC_AGENT_CONNECTION.create({workspace:{agentDisconnect(){}},
      tokenProvider:{ready:()=>new Promise(r=>setTimeout(r,5000)),getSessionToken:async()=>{
        f.tokenCalls++;
        if(f.mode==='hang')return new Promise(()=>{});
        if(f.mode!=='ok')throw Error(f.mode);
        return Date.now()-f.start>60000?'fixture-refreshed':'fixture-initial';
      }},fetch:async(url,o)=>{
        f.bindings.add(o.headers['X-Music-Tab']);
        f.calls++;f.fresh=o.headers.Authorization==='Bearer fixture-refreshed';
        if(o.credentials!=='same-origin')throw Error('credentials mismatch');
        return new Response(JSON.stringify({ok:true,clients:[]}));
      }});
    authController.open();
  });
  await page.clock.runFor(4100);
  assert.equal(await page.evaluate(()=>authController.state().phase),'checking','bootstrap excluded from 4s timeout');
  assert.equal(await page.evaluate(()=>authFixture.calls),0);
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(()=>authController.state().phase),'disconnected');
  await page.clock.runFor(61000);
  await page.evaluate(()=>{void authController.refresh();});await page.clock.runFor(5100);
  assert.equal(await page.evaluate(()=>authFixture.fresh),true,'fresh token after >60s');
  assert.equal(await page.evaluate(()=>authFixture.tokenCalls),2,'token obtained per request');
  assert.equal(await page.evaluate(()=>authFixture.bindings.size===1&&[...authFixture.bindings].every(b=>/^[0-9a-f]{64}$/.test(b))),true);
  const distinct=await page.evaluate(async()=>{
    let resolve;const result=new Promise(r=>{resolve=r;});
    const other=CT_MUSIC_AGENT_CONNECTION.create({workspace:{agentDisconnect(){}},fetch:async(url,o)=>{
      resolve(!authFixture.bindings.has(o.headers['X-Music-Tab']));return new Response(JSON.stringify({ok:true,clients:[]}));
    }});other.open();const different=await result;other.close();return different;
  });
  assert.equal(distinct,true,'separate controllers have distinct tab bindings');
  await page.evaluate(()=>{authFixture.mode='hang';void authController.refresh();});
  await page.clock.runFor(9100);
  assert.equal(await page.evaluate(()=>authController.state().phase),'unavailable','token acquisition is request-time bounded');
  assert.equal(await page.evaluate(()=>authFixture.calls),2,'timeout sends no unauthenticated fetch');
  for(const mode of ['signed-out','unconfigured','unavailable']){
    await page.evaluate(mode=>{authFixture.mode=mode;void authController.refresh();},mode);
    await page.clock.runFor(5100);
    assert.equal(await page.evaluate(()=>authController.state().phase),mode);
  }
  await page.evaluate(()=>{authFixture.mode='ok';void authController.refresh();authController.close();});
  await page.clock.runFor(5100);
  assert.equal(await page.evaluate(()=>authFixture.calls),2,'close during bootstrap prevents late fetch');
  await page.evaluate(()=>{
    window.stalledCalls=0;
    window.stalledController=CT_MUSIC_AGENT_CONNECTION.create({workspace:{agentDisconnect(){}},
      tokenProvider:{ready:()=>new Promise(r=>{window.finishReady=r;}),getSessionToken:async()=>{throw Error('must not request token');}},
      fetch:async()=>{stalledCalls++;throw Error('must not fetch');}});
    stalledController.open();
  });
  await page.clock.runFor(14000);
  assert.equal(await page.evaluate(()=>stalledController.state().phase),'checking');
  await page.clock.runFor(1100);
  assert.equal(await page.evaluate(()=>stalledController.state().phase),'unavailable','whole bootstrap capped at 15s');
  await page.evaluate(()=>{finishReady();});await page.clock.runFor(1);
  assert.equal(await page.evaluate(()=>stalledCalls),0,'late ready after timeout cannot fetch');
  await page.evaluate(()=>{window.stalledSettled=false;window.stalledWait=stalledController.refresh().then(()=>{stalledSettled=true;});stalledController.close();});
  await page.clock.runFor(1);
  assert.equal(await page.evaluate(()=>stalledSettled),true,'close immediately settles stalled bootstrap wait');
  await page.evaluate(()=>{finishReady();});await page.clock.runFor(16000);
  assert.equal(await page.evaluate(()=>stalledController.state().phase),'closed');
  assert.equal(await page.evaluate(()=>stalledCalls),0,'late ready after close cannot fetch');
  console.log('music agent connection: auth provider passed (slow ready, >60s refresh, token timeout, auth errors, 15s stalled ready, abort on close)');
}
async function integrated(browser){
  // Real service, broker, compiler and isolated PostgreSQL. Only authentication,
  // editor mounting and audio are fixtures; no hosted credentials are involved.
  const fs=require('node:fs/promises'),os=require('node:os');
  const {spawn,execFileSync}=require('node:child_process');
  const {Pool}=require('../gateway/node_modules/pg');
  const {createMusicAgentConnections}=require('../server/music-agent-connections');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ct-browser-connection-'));
  let child,pool,exited,page;
  try{
    await fs.chmod(temporary,0o700);
    execFileSync('initdb',['-D',path.join(temporary,'data'),'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
    child=spawn('postgres',['-D',path.join(temporary,'data'),'-k',temporary,'-c','listen_addresses='],{stdio:'ignore'});
    exited=new Promise(r=>{child.once('exit',r);child.once('error',r);});
    pool=new Pool({host:temporary,user:os.userInfo().username,database:'postgres',max:4,connectionTimeoutMillis:1000});
    const deadline=Date.now()+10000;
    for(;;){try{await pool.query('SELECT 1');break;}catch(e){if(Date.now()>deadline)throw Error('isolated database unavailable');await new Promise(r=>setTimeout(r,50));}}
    for(const file of ['music-agent-schema.sql','music-agent-connections.sql'])await pool.query(await fs.readFile(path.join(__dirname,'../server',file),'utf8'));
    let auth={issuer:'https://fixture.invalid',subject:'owner',browserId:'browser'};
    const agent={...auth,clientId:'real-service-client',scopes:['music:read','music:propose']};
    const service=createMusicAgentConnections({pool,authenticateBrowser:async request=>{
      const tab=request.headers.get('x-music-tab');
      if(!auth||!tab||!/^[0-9a-f]{64}$/.test(tab))return null;
      return {...auth,browserId:require('node:crypto').createHash('sha256').update(auth.browserId+':'+tab).digest('hex')};
    }});
    await service.store.observeClient(agent);
    const execute=(operation,input={})=>service.store.execute({principal:agent,scope:operation==='propose'?'music:propose':'music:read',operation,input});
    page=await browser.newPage();await mockAuthModule(page);const calls=[];let loseAck=false,tabBinding;
    await page.route('**/api/music-agent',async route=>{
      const req=route.request(),body=req.postData()?JSON.parse(req.postData()):null;
      assert.equal(req.headers().authorization,'Bearer fixture-session-token');
      const tab=req.headers()['x-music-tab'];
      assert.equal(/^[0-9a-f]{64}$/.test(tab),true);
      if(tabBinding)assert.equal(tab===tabBinding,true,'stable tab binding including revoke');else tabBinding=tab;
      const response=await service.handleBrowser(new Request(req.url(),{method:req.method(),headers:req.headers(),...(body?{body:JSON.stringify(body)}:{})}));
      const result=await response.json();calls.push({body,result,status:response.status});
      assert.equal(response.headers.get('cache-control'),'no-store');
      // Simulate losing a SUCCESSFUL ack response, the ambiguous failure case.
      if(loseAck&&body?.action==='acknowledge'){loseAck=false;await route.abort('failed');return;}
      await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.route('https://gateway.fixture.invalid/create',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
    await page.goto('https://gateway.fixture.invalid/create');
    for(const f of ['gb-hardware.js','music-language.js','music-project.js','music-chat.js','music-agent-connection.js'])await page.addScriptTag({path:path.join(__dirname,'../src',f)});
    await page.evaluate(()=>{
      window.Audio={musicStop(){},enterCreate(){},onMusicState(){return ()=>{};}};window.CT_CREATE={};
      window.CT_MUSIC_CODE_EDITOR={help:{},mount(el,text,change){window.editSource=change;return {set(){},diagnostics(){},focus(){},select(){}};}};
    });
    await page.addScriptTag({path:path.join(__dirname,'../src/music-workspace.js')});
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
    await page.waitForFunction(()=>document.querySelector('.mw-client').options.length===2);
    assert.equal(await page.locator('.mw-external-mcp').evaluate(el=>el.open),false);
    await page.locator('.mw-external-mcp > summary').click();
    assert.equal(await page.locator('.mw-mcp-setup').isVisible(),true);
    assert.equal(await page.locator('.mw-mcp-endpoint').inputValue(),'https://gateway.fixture.invalid/api/mcp');
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://gateway.fixture.invalid'});
    await page.locator('[data-action=copy-mcp]').click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://gateway.fixture.invalid/api/mcp');
    assert.equal(calls.some(c=>c.body?.action==='create'),false,'copy does not consent or upload');
    assert.deepEqual(await execute('getContext'),{ok:false,code:'not_paired'});
    await page.locator('.mw-client').selectOption('real-service-client');await page.locator('[data-action=connect]').click();
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.startsWith('Connected.'));
    const initial=await execute('getContext');
    assert.equal(initial.source,await page.evaluate(()=>CT_MUSIC_WORKSPACE.agentContext().source));
    async function propose(id){
      const c=await execute('getContext');
      const result=await execute('propose',{id,generation:c.generation,baseRevision:c.baseRevision,draftEpoch:c.draftEpoch,edits:[{from:0,to:0,text:'// '+id+'\n'}],explanation:id});
      assert.equal(result.status,'pending');
      await page.waitForFunction(id=>document.querySelector('.mw-proposal p')?.textContent===id&&document.querySelector('.mw-proposal b')?.textContent==='ready',id);
    }
    await propose('real-apply');
    assert.equal((await execute('getProposalStatus',{id:'real-apply'})).status,'claimed');
    assert.equal((await execute('getContext')).generation,initial.generation);
    assert.equal(calls.some(c=>c.body?.action==='acknowledge'),false);
    await page.locator('.mw-proposal button').filter({hasText:/^Apply$/}).click();
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.startsWith('Applied in browser'));
    const applied=await execute('getContext'),receipt=calls.find(c=>c.body?.action==='acknowledge');
    assert.equal(receipt.result.status,'applied');assert.equal(receipt.body.generation,initial.generation);
    assert.equal(applied.generation,initial.generation+1);assert.equal(applied.source,receipt.body.snapshot.source);
    assert.notEqual(applied.baseRevision,initial.baseRevision);assert(applied.draftEpoch>initial.draftEpoch);
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null);
    await propose('real-reject');
    await page.locator('.mw-proposal button').filter({hasText:/^Reject$/}).click();
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent==='Proposal rejected.');
    assert.equal((await execute('getProposalStatus',{id:'real-reject'})).status,'rejected');
    assert.equal((await execute('getContext')).generation,applied.generation);
    await propose('policy-stale');
    await page.locator('.mw-lock').selectOption('track');
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent==='Proposal failed.');
    const failed=calls.find(c=>c.body?.action==='acknowledge'&&c.body.id==='policy-stale');
    assert.equal(failed.body.status,'failed');assert.equal(failed.body.snapshot,null);
    assert.equal(failed.body.generation,applied.generation);assert.equal(failed.result.ok,true);
    assert.equal((await execute('getProposalStatus',{id:'policy-stale'})).status,'failed');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),receipt.body.snapshot.baseRevision);
    // Wait for publication of the new policy, after the old claim is failed.
    const policyDeadline=Date.now()+5000;
    while((await execute('getContext')).generation===applied.generation){
      if(Date.now()>policyDeadline)throw Error('new policy not published');
      await new Promise(r=>setTimeout(r,50));
    }
    await propose('lost-ack');loseAck=true;
    await page.locator('.mw-proposal button').filter({hasText:/^Apply$/}).click();
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.includes('Applied locally; remote acknowledgement could not be confirmed'));
    const local=await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id),local);
    assert.equal(calls.filter(c=>c.body?.action==='acknowledge'&&c.body.id==='lost-ack').length,1);
    assert.equal(calls.filter(c=>c.body?.action==='create').length,1,'no automatic reconnect');
    auth=null;await page.locator('[data-action=refresh-clients]').click();
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.startsWith('Access denied.'));
    assert.equal(await page.locator('.mw-sign-in').isVisible(),true);
    assert.equal(await page.locator('.mw-mcp-setup').isVisible(),false,'denied API does not advertise endpoint');
    assert.equal(await page.locator('[data-action=connect]').isDisabled(),true);
    assert(calls.some(c=>c.status===403&&c.result.code==='access_denied'));
    assert.equal(calls.filter(c=>c.result.ok===false&&c.body).length,0,'all authenticated wire operations accepted');
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());
    console.log('music agent connection: real handleBrowser + isolated PostgreSQL passed (claim, explicit Apply/generation, Reject, stale policy/failed ack, lost successful ack/no replay, 403)');
  }finally{
    if(page)await page.close();if(pool)await pool.end();
    if(child&&child.exitCode===null){child.kill('SIGTERM');await exited;}
    await fs.rm(temporary,{recursive:true,force:true});
  }
}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await mockAuthModule(page);
    await page.goto('http://127.0.0.1:'+server.address().port);
    for(const f of ['gb-hardware.js','music-language.js','music-project.js','music-chat.js','music-agent-connection.js'])
      await page.addScriptTag({path:path.join(__dirname,'../src',f)});
    await page.evaluate(()=>{
      window.Audio={musicStop(){},enterCreate(){},onMusicState(){return ()=>{};}};window.CT_CREATE={};
      window.CT_MUSIC_CODE_EDITOR={help:{},mount(el,text,change){window.editSource=change;return {set(){},diagnostics(){},focus(){},select(){}};}};
      window.calls=[];window.mode='ok';window.gen=0;window.remote=null;
      window.fetch=async(url,o)=>{
        if(url!=='/api/music-agent'||o.credentials!=='same-origin'||o.redirect!=='error')throw Error('transport');
        const b=o.body?JSON.parse(o.body):null;calls.push(b);
        if(mode==='503'||mode==='401')return new Response('{}',{status:Number(mode)});
        let result={ok:true};
        if(!b)result.clients=[{clientId:'fixture-client'}];
        else if(b.action==='create')result.sessionId='fixture-session';
        else if(b.action==='publish'){window.published=b.snapshot;result.generation=++gen;}
        else if(b.action==='poll'){
          if(mode==='race'){editSource(CT_MUSIC_WORKSPACE.snapshot().draft+'// raced\n');mode='ok';}
          result.proposal=remote;remote=null;
        }else if(b.action==='acknowledge'&&b.status==='applied')result.generation=++gen;
        return new Response(JSON.stringify(result));
      };
    });
    await page.addScriptTag({path:path.join(__dirname,'../src/music-workspace.js')});
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
    const connect=async()=>{
      await page.locator('.mw-client').selectOption('fixture-client');
      await page.locator('[data-action=connect]').click();
      await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.startsWith('Connected.'));
    };
    await page.waitForFunction(()=>document.querySelector('.mw-client').options.length===2);
    assert.equal(await page.locator('.mw-external-mcp').evaluate(el=>el.open),false);
    await page.locator('.mw-external-mcp > summary').click();
    assert.equal(await page.locator('.mw-mcp-setup').isVisible(),false,'HTTP does not advertise gateway endpoint');
    assert.equal(await page.evaluate(()=>calls.some(c=>c&&c.action==='create')),false,'opt-in before upload');
    await connect();
    assert.deepEqual(await page.evaluate(()=>published),await page.evaluate(()=>{
      const c=CT_MUSIC_WORKSPACE.agentContext();return {source:c.source,baseRevision:c.baseRevision,draftEpoch:c.draftEpoch,selection:c.policy.selection,constraints:c.policy.constraints};
    }));
    await page.evaluate(()=>{window.before=CT_MUSIC_WORKSPACE.snapshot().validated.id;remote={id:'proposal-one',generation:gen,baseRevision:published.baseRevision,draftEpoch:published.draftEpoch,edits:[{from:0,to:0,text:'// fixture\n'}],explanation:'Fixture proposal'};});
    await page.waitForFunction(()=>document.querySelector('.mw-proposal b')?.textContent==='ready');
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().validated.id===before),true);
    assert.equal(await page.evaluate(()=>calls.some(c=>c&&c.action==='acknowledge'&&c.status==='applied')),false);
    await page.locator('.mw-proposal button').filter({hasText:/^Apply$/}).click();
    await page.waitForFunction(()=>calls.some(c=>c&&c.action==='acknowledge'&&c.status==='applied'));
    const ack=await page.evaluate(()=>calls.find(c=>c&&c.action==='acknowledge'&&c.status==='applied'));
    assert.equal(ack.generation,1);assert.notEqual(ack.baseRevision,ack.snapshot.baseRevision);
    assert(ack.snapshot.draftEpoch>ack.draftEpoch);
    await page.evaluate(()=>{remote={id:'stale',generation:gen,baseRevision:CT_MUSIC_WORKSPACE.agentContext().baseRevision,draftEpoch:CT_MUSIC_WORKSPACE.agentContext().draftEpoch,edits:[{from:0,to:0,text:'// stale\n'}],explanation:'Stale fixture'};mode='race';});
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.includes('Draft or project changed'));
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.agentProposalStatus('stale').ok),false);
    await page.evaluate(()=>{mode='503';});await page.locator('[data-action=refresh-clients]').click();
    await page.waitForFunction(()=>document.querySelector('.mw-connect-status').textContent.includes('unavailable'));
    assert.equal(await page.locator('[data-action=connect]').isDisabled(),true);
    assert.equal(await page.locator('.mw-mcp-setup').isVisible(),false,'503 does not advertise endpoint');
    await page.evaluate(()=>{mode='401';});await page.locator('[data-action=refresh-clients]').click();
    await page.locator('.mw-sign-in').waitFor({state:'visible'});
    assert.equal(await page.locator('.mw-sign-in').getAttribute('href'),'/sign-in');
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.close());
    const count=await page.evaluate(()=>calls.length);await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>calls.length),count,'no polling after close');
    const lifecycle=await page.evaluate(async()=>{
      let signal,controller;
      const workspace={agentDisconnect(){},agentContext(){return {ok:false};}};
      controller=CT_MUSIC_AGENT_CONNECTION.create({workspace,fetch:async(url,o)=>{signal=o.signal;return new Promise(()=>{});}});
      controller.open();for(let i=0;i<10&&!signal;i++)await Promise.resolve();controller.close();
      const aborted=signal.aborted;
      controller.open();
      await new Promise(r=>setTimeout(r,4200));
      const timedOut=signal.aborted&&controller.state().phase==='unavailable';
      controller.close();return {aborted,timedOut};
    });
    assert.deepEqual(lifecycle,{aborted:true,timedOut:true});
    console.log('music agent connection: browser fetch fixtures passed (opt-in, exact snapshot, explicit Apply ack, stale I/O, 503, 401, close, abort, timeout)');
    await tokenProviderChecks(page);
    await integrated(browser);
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
