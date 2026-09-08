'use strict';
const assert = require('node:assert/strict');
const {createPostgresMusicAgentRepository} = require('../server/music-agent-postgres');
// SQL contract fixture; actual database integration remains a separate gate.
async function main() {
  let calls=[],released=0,fail=false;
  const record={issuer:'https://identity.example',owner:'owner',browserId:'tab',clientId:'client',expiresAt:100,revoked:false,state:{version:1}};
  const pool={connect:async()=>({release(){released++;},async query(sql,args){
    calls.push({sql,args});
    if(fail&&sql.startsWith('UPDATE'))throw Error('database secret');
    return {rows:sql.startsWith('SELECT')?[{record:structuredClone(record)}]:[]};
  }})};
  const repository=createPostgresMusicAgentRepository(pool);
  assert.deepEqual(await repository.transact('session',r=>({record:{...r,revoked:true},result:{ok:true}})),{ok:true});
  assert.equal(calls[0].sql,'BEGIN');
  assert.match(calls[3].sql,/FOR UPDATE$/);
  assert.deepEqual(calls[3].args,['session']);
  assert.equal(calls.at(-1).sql,'COMMIT'); assert.equal(released,1);
  calls=[]; fail=true;
  await assert.rejects(repository.transact('session',r=>({record:r,result:{ok:true}})),/^Error: session_transaction_failed$/);
  assert.equal(calls.at(-1).sql,'ROLLBACK'); assert.equal(released,2);
  calls=[]; fail=false;
  await assert.rejects(repository.transact('session',async r=>({record:r,result:{ok:true}})),/session_transaction_failed/);
  assert.equal(calls.at(-1).sql,'ROLLBACK');
  await assert.rejects(repository.transact("session' OR true",()=>{}),/invalid_transaction/);
  calls=[];
  await repository.create('newsession',record);
  assert.match(calls[0].sql,/^INSERT/); assert.equal(calls[0].args[0],'newsession');
  assert.equal(JSON.parse(calls[0].args[1]).owner,'owner');
  let discarded;
  const broken=createPostgresMusicAgentRepository({connect:async()=>({
    async query(){throw Error('driver connection failed');},release(error){discarded=error;}
  })});
  await assert.rejects(broken.transact('session',()=>({record:null,result:{}})),/session_transaction_failed/);
  assert.equal(discarded.message,'rollback_failed');
  console.log('PASS Postgres music repository SQL contract fixture: row lock, parameters, commit, rollback, release, duplicate-safe creation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
