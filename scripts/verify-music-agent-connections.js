'use strict';
// Real isolated PostgreSQL only: no network listener, existing DB or credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {Pool}=require('../gateway/node_modules/pg');
const {createMusicAgentConnections}=require('../server/music-agent-connections');
async function main() {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ct-connections-'));
  let child,pool,exited;
  try {
    await fs.chmod(temporary,0o700);
    execFileSync('initdb',['-D',path.join(temporary,'data'),'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
    child=spawn('postgres',['-D',path.join(temporary,'data'),'-k',temporary,'-c','listen_addresses='],{stdio:'ignore'});
    exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
    pool=new Pool({host:temporary,user:os.userInfo().username,database:'postgres',max:8,connectionTimeoutMillis:1000});
    const deadline=Date.now()+10000;
    for (;;) { try { await pool.query('SELECT 1'); break; } catch { if(Date.now()>deadline)throw Error('database_unavailable'); await new Promise(r=>setTimeout(r,50)); } }
    for (const file of ['music-agent-schema.sql','music-agent-connections.sql'])
      await pool.query(await fs.readFile(path.join(__dirname,'../server',file),'utf8'));
    const browser={issuer:'https://fixture.invalid',subject:'owner',browserId:'tab'};
    const agent={issuer:browser.issuer,subject:browser.subject,clientId:'client',scopes:['music:read','music:propose'],expiresAt:Date.now()/1000+600};
    let auth=browser;
    const make=()=>createMusicAgentConnections({pool,authenticateBrowser:async()=>auth});
    let service=make();
    const http=async(body)=>{
      const response=await service.handleBrowser(new Request('https://fixture.invalid/api/music-agent',body?
        {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}));
      assert.equal(response.headers.get('cache-control'),'no-store'); return response.json();
    };
    const exec=(operation,input={},p=agent)=>service.store.execute({principal:p,scope:operation==='propose'?'music:propose':'music:read',operation,input});
    assert.equal(await service.store.observeClient(agent),true);
    assert.deepEqual(await exec('getContext'),{ok:false,code:'not_paired'});
    assert.equal((await http()).clients[0].clientId,'client');
    const creates=await Promise.all([http({action:'create',clientId:'client'}),http({action:'create',clientId:'client'})]);
    assert.equal(creates.filter(r=>r.ok).length,1);
    const sessionId=creates.find(r=>r.ok).sessionId;
    assert.match(sessionId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const snapshot={source:'song({tempo:120,bars:1})\n',baseRevision:'r1',draftEpoch:0,selection:null,constraints:{}};
    assert.equal((await http({action:'publish',sessionId,snapshot})).ok,true);
    const context=await exec('getContext');
    const base={generation:context.generation,baseRevision:context.baseRevision,draftEpoch:context.draftEpoch};
    assert.equal(context.source,snapshot.source);
    assert.equal((await http({action:'heartbeat',sessionId,...base})).ok,true);
    assert.equal((await http({action:'heartbeat',sessionId,...base,draftEpoch:99})).code,'stale_snapshot');
    const proposal={id:'proposal',...base,edits:[{from:0,to:0,text:'// proposed\n'}],explanation:'Comment'};
    assert.equal((await exec('propose',proposal)).status,'pending');
    assert.equal((await http({action:'poll',sessionId,...base,generation:0})).code,'stale_snapshot');
    const polls=await Promise.all([http({action:'poll',sessionId,...base}),http({action:'poll',sessionId,...base})]);
    assert.equal(polls.filter(r=>r.proposal).length,1);
    assert.equal((await exec('getProposalStatus',{id:'proposal'})).status,'claimed');
    const candidate=polls.find(r=>r.proposal).proposal.candidate;
    assert.equal((await http({action:'acknowledge',sessionId,id:'proposal',...base,status:'applied',snapshot:{...snapshot,source:candidate,baseRevision:'r2',draftEpoch:1}})).status,'applied');
    service=make(); // Persistence across instances, no in-memory routing.
    assert.equal((await exec('getContext')).source,candidate);
    auth={...browser,browserId:'other'};
    assert.equal((await http()).clients[0].sessionId,null);
    for (const action of ['revoke','publish']) assert.equal((await http(action==='revoke'?{action,sessionId}:{action,sessionId,snapshot})).code,'access_denied');
    auth={...browser,subject:'other'};
    assert.deepEqual((await http()).clients,[]);
    assert.equal((await exec('getContext',{}, {...agent,clientId:'other'})).code,'not_paired');
    auth=browser;
    assert.equal((await http({action:'create',clientId:'unobserved'})).ok,false);
    assert.equal((await http({action:'create',clientId:'client',subject:'forged'})).code,'invalid_input');
    assert.equal((await http({action:'publish',sessionId,snapshot:{...snapshot,source:'PRIVATE invalid'}})).code,'invalid_source');
    assert.equal((await http({action:'publish',sessionId,snapshot})).ok,true);
    await pool.query("UPDATE music_agent_sessions SET record=jsonb_set(record,'{leaseExpiresAt}','0') WHERE id=$1",[sessionId]);
    assert.equal((await http({action:'publish',sessionId,snapshot})).code,'access_denied');
    assert.equal((await exec('getContext')).code,'not_paired');
    const fresh=await http({action:'create',clientId:'client'});
    assert.equal(fresh.ok,true); assert.notEqual(fresh.sessionId,sessionId);
    assert.equal((await http({action:'revoke',sessionId:fresh.sessionId})).ok,true);
    assert.equal((await http({action:'publish',sessionId:fresh.sessionId,snapshot})).ok,false);
    const readOnly={...agent,clientId:'read-only',scopes:['music:read']};
    await service.store.observeClient(readOnly);
    assert.equal((await service.browser({},'consent',{clientId:'read-only',lifetimeMs:3600001})).code,'invalid_input');
    const readSession=await http({action:'create',clientId:'read-only'});
    await http({action:'publish',sessionId:readSession.sessionId,snapshot});
    // New token scope must not silently expand the browser's existing consent.
    await service.store.observeClient({...readOnly,scopes:agent.scopes});
    assert.equal((await exec('propose',proposal,{...readOnly,scopes:agent.scopes})).ok,false);
    await pool.query("UPDATE music_agent_sessions SET record=jsonb_set(record,'{expiresAt}','0') WHERE id=$1",[readSession.sessionId]);
    assert.equal((await http({action:'heartbeat',sessionId:readSession.sessionId,...base})).ok,false);
    // Concurrent client admission and session creation enforce per-owner bounds.
    const clients=Array.from({length:40},(_,i)=>({...agent,subject:'bounds',clientId:'c'+i}));
    const observed=await Promise.all(clients.map(p=>service.store.observeClient(p)));
    assert.equal(observed.filter(Boolean).length,32);
    auth={...browser,subject:'bounds'};
    const list=(await http()).clients;
    const sessions=await Promise.all(list.map(c=>http({action:'create',clientId:c.clientId})));
    assert.equal(sessions.filter(r=>r.ok).length,8);
    assert.equal(await service.store.authorize({...agent,expiresAt:0},'music:read'),false);
    assert.equal(await service.store.authorize({...agent,scopes:[]},'music:read'),false);
    await assert.rejects(exec('publish',{}),/forbidden/);
    auth=null; assert.equal((await http()).code,'access_denied');
    console.log('PASS isolated PostgreSQL connections: standard OAuth observation, pairing race, ownership, durable routing, atomic poll/claim, separate ack, TTL terminal, revoke, client/session bounds, HTTP contract');
  } finally {
    if(pool)await pool.end();
    if(child&&child.exitCode===null){child.kill('SIGTERM');await exited;}
    await fs.rm(temporary,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error('FAIL connections acceptance:',e instanceof assert.AssertionError?e.message:'isolated test unavailable');process.exitCode=1;});
