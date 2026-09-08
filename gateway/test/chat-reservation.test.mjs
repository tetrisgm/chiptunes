import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../server/music-chat-handler.js';
const origin='https://music.example';
const request=(id,source='song({tempo:120,bars:4})\n')=>new Request(origin+'/api/music/chat',{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({id,source,baseRevision:'r1',request:'Change tempo',constraints:{}})
});
const base={origin,authenticate:async()=>({subject:'owner'}),rateLimit:async()=>true};
test('uncertain provider timeout retains durable lease',async()=>{
  let releases=0;
  const handle=handler.createMusicChatHandler({...base,timeoutMs:10,
    reserveRequest:async()=>({ok:true,release:async()=>{releases++;}}),
    adapter:{authorized:true,propose:()=>new Promise(()=>{})}});
  assert.notEqual((await handle(request('timeout'))).status,200);
  assert.equal(releases,0);
});
test('durable admission does not exhaust local replay capacity on invalid input',async()=>{
  let reservations=0;
  const handle=handler.createMusicChatHandler({...base,
    reserveRequest:async()=>{reservations++;return {ok:false,code:'access_unavailable'};},
    adapter:{authorized:true,propose:async()=>{throw Error('must not call');}}});
  for(let i=0;i<handler.LIMITS.rememberedRequests+1;i++)
    assert.equal((await handle(request('invalid-'+i,'invalid music'))).status,400);
  const response=await handle(request('valid'));
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'access_unavailable'});
  assert.equal(reservations,1);
});
test('durable conflict and quota errors retain safe status mappings',async()=>{
  for(const [code,status] of [['duplicate_request',409],['request_active',409],['daily_limit',429],['minute_limit',429],['access_unavailable',503]]){
    const handle=handler.createMusicChatHandler({...base,reserveRequest:async()=>({ok:false,code}),
      adapter:{authorized:true,propose:async()=>{throw Error('must not call');}}});
    assert.equal((await handle(request(code))).status,status);
  }
});
