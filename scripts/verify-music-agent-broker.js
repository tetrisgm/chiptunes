'use strict';
const assert = require('node:assert/strict');
const {createMusicAgentBroker} = require('../server/music-agent-broker');
const {createMusicAgentSession} = require('../server/music-agent-session');
// Explicit fixture repository; not a production persistence implementation.
const records = new Map();
let serial = Promise.resolve(), ticks = 100;
const repository = {transact(id, fn) {
  const run = serial.then(()=>{
    const {record,result} = fn(records.has(id) ? structuredClone(records.get(id)) : null);
    if (record) records.set(id,structuredClone(record));
    return result;
  });
  serial = run.catch(()=>{}); return run;
}};
const broker = createMusicAgentBroker({repository,now:()=>ticks});
const browser = {kind:'browser',issuer:'https://identity.example',subject:'owner',browserId:'tab1'};
const agent = {kind:'agent',issuer:'https://identity.example',subject:'owner',clientId:'client1',scopes:['music:read','music:propose']};
async function main() {
  const core = createMusicAgentSession({now:()=>ticks});
  records.set('session1',{issuer:'https://identity.example',owner:'owner',browserId:'tab1',clientId:'client1',expiresAt:10000,revoked:false,state:core.exportState()});
  const snapshot = {source:'song({tempo:120,bars:1})\n',baseRevision:'r1',draftEpoch:0,selection:null,constraints:{locks:[]}};
  assert.equal((await broker.execute(browser,'session1','publish',snapshot)).ok,true);
  assert.equal((await broker.execute(agent,'session1','readContext')).source,snapshot.source);
  for (const p of [{...agent,issuer:'https://other.example'},{...agent,subject:'other'},{...agent,clientId:'other'},{...agent,scopes:[]},
      {...browser,browserId:'other'},null]) {
    assert.equal((await broker.execute(p,'session1',p?.kind==='browser'?'peek':'readContext')).code,'access_denied');
  }
  for (const method of ['publish','claim','acknowledge','revoke','exportState'])
    assert.equal((await broker.execute(agent,'session1',method,{})).code,'access_denied');
  assert.equal((await broker.execute(browser,'session1','propose',{})).code,'access_denied');
  assert.equal((await broker.execute(agent,undefined,'readContext')).code,'access_denied');
  assert.equal((await broker.execute(agent,'missing','readContext')).code,'access_denied');
  const ordered = await Promise.all([broker.execute(browser,'session1','revoke'),broker.execute(agent,'session1','readContext')]);
  assert.equal(ordered[0].status,'revoked'); assert.equal(ordered[1].code,'access_denied');
  assert.equal((await broker.execute(browser,'session1','publish',snapshot)).code,'access_denied');
  records.set('expired',{...records.get('session1'),revoked:false,expiresAt:99});
  assert.equal((await broker.execute(agent,'expired','readContext')).code,'access_denied');
  ticks=50;
  assert.equal((await broker.execute(agent,'expired','readContext')).code,'access_denied');
  assert.equal(records.get('expired').revoked,true);
  records.set('badclock',{...records.get('session1'),revoked:false,expiresAt:1000});
  ticks=NaN;
  assert.equal((await broker.execute(agent,'badclock','readContext')).code,'access_denied');
  ticks=50;
  assert.equal((await broker.execute(agent,'badclock','readContext')).code,'access_denied');
  records.set('throwclock',{...records.get('session1'),revoked:false,expiresAt:1000});
  const throwing=createMusicAgentBroker({repository,now(){throw Error('clock unavailable');}});
  assert.equal((await throwing.execute(agent,'throwclock','readContext')).code,'access_denied');
  assert.equal((await broker.execute(agent,'throwclock','readContext')).code,'access_denied');
  const broken = createMusicAgentBroker({repository:{transact(){throw Error('PRIVATE secret source');}}});
  assert.deepEqual(await broken.execute(agent,'session1','readContext'),{ok:false,code:'session_unavailable'});
  console.log('PASS music agent broker: ownership, scopes, capability separation, serialized revoke, expiry, sanitized failure (fixture repository)');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
