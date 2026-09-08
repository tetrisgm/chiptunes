'use strict';
// Real PostgreSQL acceptance in an isolated temporary cluster. No TCP listener,
// no existing service/database, no external credentials, no persistent job.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {Pool}=require('../gateway/node_modules/pg');
const {createPostgresMusicAgentRepository}=require('../server/music-agent-postgres');
const {createMusicAgentBroker}=require('../server/music-agent-broker');
const {createMusicAgentSession}=require('../server/music-agent-session');
async function main(){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ct-agent-pg-'));
  await fs.chmod(temporary,0o700);
  let child,pool,exited;
  try{
    execFileSync('initdb',['-D',path.join(temporary,'data'),'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
    child=spawn('postgres',['-D',path.join(temporary,'data'),'-k',temporary,'-c','listen_addresses='],{stdio:'ignore'});
    exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
    pool=new Pool({host:temporary,user:os.userInfo().username,database:'postgres',max:4,connectionTimeoutMillis:1000});
    const deadline=Date.now()+10000;
    for(;;){try{await pool.query('SELECT 1');break;}catch{if(Date.now()>deadline)throw Error('temporary_database_unavailable');await new Promise(r=>setTimeout(r,50));}}
    await pool.query(await fs.readFile(path.join(__dirname,'../server/music-agent-schema.sql'),'utf8'));
    const repository=createPostgresMusicAgentRepository(pool),now=()=>Date.now();
    const browser={kind:'browser',issuer:'https://fixture.invalid',subject:'owner',browserId:'tab'};
    const agent={kind:'agent',issuer:browser.issuer,subject:'owner',clientId:'client',scopes:['music:read','music:propose']};
    await repository.create('session',{issuer:browser.issuer,owner:'owner',browserId:'tab',clientId:'client',
      scopes:agent.scopes,expiresAt:Date.now()+60000,revoked:false,state:createMusicAgentSession({now}).exportState()});
    const broker=createMusicAgentBroker({repository,now});
    assert.equal((await broker.execute(browser,'session','publish',{source:'song({tempo:120,bars:1})\n',baseRevision:'r1',draftEpoch:0,selection:null,constraints:{locks:[]}})).ok,true);
    const context=await broker.execute(agent,'session','readContext');
    const proposal=id=>({id,generation:context.generation,baseRevision:context.baseRevision,draftEpoch:context.draftEpoch,
      edits:[{from:0,to:0,text:'// proposed\n'}],explanation:'Comment only fixture'});
    const results=await Promise.all(['p1','p2'].map(id=>broker.execute(agent,'session','propose',proposal(id))));
    assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal(results.find(r=>!r.ok).code,'pending_proposal');
    const winner=results.find(r=>r.ok).id;
    const restarted=createMusicAgentBroker({repository:createPostgresMusicAgentRepository(pool),now});
    assert.equal((await restarted.execute(agent,'session','propose',proposal(winner))).code,'duplicate_proposal');
    assert.equal((await restarted.execute(agent,'session','status',{id:winner})).status,'pending');
    assert.equal((await restarted.execute({...agent,subject:'other'},'session','readContext')).code,'access_denied');
    await restarted.execute(browser,'session','revoke');
    assert.equal((await broker.execute(agent,'session','readContext')).code,'access_denied');
    await assert.rejects(repository.create('session',{issuer:browser.issuer,owner:'owner',browserId:'tab',clientId:'client',
      expiresAt:Date.now()+10000,revoked:false,state:{}}),/session_create_failed/);
    assert.equal((await broker.execute(agent,'session','readContext')).code,'access_denied');
    console.log('PASS real temporary PostgreSQL: migration, publication, simultaneous proposal row lock, persisted replay, broker restart, owner isolation, revoke, duplicate-safe creation');
  }finally{
    if(pool)await pool.end();
    if(child&&child.exitCode===null){child.kill('SIGTERM');await exited;}
    await fs.rm(temporary,{recursive:true,force:true});
  }
}
main().catch(()=>{console.error('FAIL isolated music agent database acceptance');process.exitCode=1;});
