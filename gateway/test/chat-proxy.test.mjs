// Explicit mock upstream + real production owner verifier; no paid calls/secrets.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {proxyMusicChat,PUBLIC_ORIGIN as P,UPSTREAM_ORIGIN as U} from '../../cloudflare/music-chat-proxy.mjs';
import {createChatHandlers} from '../lib/chat-production.mjs';
const access='/api/music/chat/access',chat='/api/music/chat';
const req=(path=chat,{method='POST',headers={},body='{}',signal,origin=P}={})=>new Request(origin+path,{method,headers:{origin:P,'content-type':'application/json',...headers},...(method==='GET'?{}:{body}),signal,duplex:'half'});
const good=()=>Response.json({ok:true});
test('fixed target and minimal headers; no forwarding of auth-adjacent/private headers',async()=>{
  let calls=0;
  const r=await proxyMusicChat(req(chat,{headers:{cookie:'other=private; __Host-ct-chat-owner=v1.fixture',forwarded:'host=evil','x-forwarded-host':'evil','x-forwarded-proto':'http','x-secret':'private','x-music-provider':'anthropic','sec-fetch-site':'same-origin'}}),{fetch:async(url,init)=>{
    calls++;assert.equal(url,U+chat);assert.equal(init.redirect,'manual');
    assert.deepEqual(Object.fromEntries(init.headers),{'content-type':'application/json',cookie:'__Host-ct-chat-owner=v1.fixture',origin:P,'sec-fetch-site':'same-origin','x-music-provider':'anthropic'});
    return Response.json({ok:true},{headers:{'access-control-allow-origin':'*','x-secret':'private'}});
  }});
  assert.equal(r.status,200);assert.equal(calls,1);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-secret'),null);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('hostile inputs never fetch',async()=>{
  const cases=[req(chat+'?x=1'),req(chat+'?'),req(chat+'/'),req(chat,{origin:'https://evil.test'}),req(chat,{headers:{origin:'https://evil.test'}}),req(chat,{headers:{origin:''}}),req(chat,{headers:{authorization:'Bearer fixture'}}),req(chat,{headers:{upgrade:'websocket'}}),req(chat,{headers:{'sec-fetch-site':'cross-site'}}),req(chat,{headers:{'sec-fetch-mode':'navigate'}}),req(chat,{headers:{'sec-fetch-dest':'image'}}),req(chat,{headers:{'x-music-provider':'evil'}}),req(chat,{headers:{'content-type':'text/plain'}}),req(chat,{method:'DELETE'}),req(access,{headers:{cookie:'__Host-ct-chat-owner=a; __Host-ct-chat-owner=b'}}),req(access,{method:'DELETE',body:'unexpected'})];
  for(const request of cases){let calls=0;const r=await proxyMusicChat(request,{fetch:async()=>{calls++;return good();}});assert.ok(r.status>=400);assert.equal(calls,0);}
});
test('response cookie allowlist refuses broader scope, extra cookies and malformed attributes',async()=>{
  const cookie='__Host-ct-chat-owner=v1.fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=21600';
  for(const bad of [cookie+'; Domain=chiptunes.app',cookie.replace('HttpOnly; ',''),cookie.replace('Path=/','Path=/other'),'other=secret; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=21600',cookie+', other=secret']){
    const r=await proxyMusicChat(req(access),{fetch:async()=>Response.json({ok:true},{headers:{'set-cookie':bad}})});
    assert.equal(r.status,502);assert.equal(r.headers.get('set-cookie'),null);
  }
  assert.equal((await proxyMusicChat(req(chat),{fetch:async()=>Response.json({ok:true},{headers:{'set-cookie':cookie}})})).status,502);
});
test('redirects, errors and oversized responses do not retry or disclose upstream content',async()=>{
  for(const fetch of [async()=>new Response('secret',{status:302,headers:{location:'https://evil.test'}}),async()=>{throw Error('secret');},async()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}})]){
    let calls=0;const r=await proxyMusicChat(req(),{fetch:async(...args)=>{calls++;return fetch(...args);}});
    assert.equal(r.status,502);assert.equal(calls,1);assert.ok(!(await r.text()).includes('secret'));assert.equal(r.headers.get('location'),null);
  }
});
test('login/chat byte caps apply to actual body and declared size',async()=>{
  for(const [path,cap] of [[access,2048],[chat,1048576]]){
    let calls=0;const fetch=async()=>{calls++;return good();};
    assert.equal((await proxyMusicChat(req(path,{body:' '.repeat(cap)}),{fetch})).status,200);
    assert.equal((await proxyMusicChat(req(path,{body:' '.repeat(cap+1)}),{fetch})).status,413);
    assert.equal((await proxyMusicChat(req(path,{headers:{'content-length':String(cap+1)}}),{fetch})).status,413);assert.equal(calls,1);
  }
});
test('whole-operation deadline cancels stalled request, fetch and response bodies',async()=>{
  for(const phase of ['request','fetch','response']){
    let cancelled=false,signal,calls=0;
    const stalled=()=>new ReadableStream({cancel(){cancelled=true;}});
    const request=req(chat,{body:phase==='request'?stalled():'{}'});
    const r=await proxyMusicChat(request,{deadlineMs:15,fetch:async(_url,init)=>{
      calls++;signal=init.signal;if(phase==='fetch')return new Promise(()=>{});
      return new Response(stalled(),{headers:{'content-type':'application/json'}});
    }});
    assert.equal(r.status,504);assert.equal(calls,phase==='request'?0:1);
    if(signal)assert.equal(signal.aborted,true);if(phase!=='fetch')assert.equal(cancelled,true);
  }
});
test('client abort cancels upstream response consumption',async()=>{
  const controller=new AbortController();let cancelled=false,signal;
  const r=await proxyMusicChat(req(chat,{signal:controller.signal}),{fetch:async(_url,init)=>{
    signal=init.signal;setTimeout(()=>controller.abort(),5);
    return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
  }});assert.equal(r.status,499);assert.equal(signal.aborted,true);assert.equal(cancelled,true);
});
test('already-aborted requests do not fetch; exact response limit is permitted',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  assert.equal((await proxyMusicChat(req(chat,{signal:controller.signal}),{fetch:async()=>{calls++;return good();}})).status,499);
  assert.equal(calls,0);
  const response=await proxyMusicChat(req(),{fetch:async()=>new Response(' '.repeat(65536),{headers:{'content-type':'application/json'}})});
  assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,65536);
});
test('real owner login through mock transport: cookie remains host-only; direct upstream is not isolated',async()=>{
  const env={CHAT_ORIGIN:P,CHAT_OWNER_PASSWORD:'explicit-test-password-'.repeat(3),OPENAI_API_KEY:'sk-mock-key'};
  const pool={connect(){throw Error('No database work expected');}};
  const routes=createChatHandlers({env,pool,fetch:async()=>{throw Error('No provider calls expected');}});
  const send=async(url,init)=>routes.owner(new Request(url,init));
  const login=await proxyMusicChat(req(access,{body:JSON.stringify({password:env.CHAT_OWNER_PASSWORD})}),{fetch:send});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.ok(cookie.includes('Secure; HttpOnly; SameSite=Strict'));assert.ok(!cookie.includes('Domain='));
  const headers={cookie:cookie.split(';')[0]};
  assert.equal((await (await proxyMusicChat(req(access,{method:'GET',headers}),{fetch:send})).json()).authenticated,true);
  assert.equal((await (await routes.owner(req(access,{origin:U,method:'GET',headers}))).json()).authenticated,true);
  assert.equal((await routes.chat(req(chat,{origin:U}))).status,401);
  for(const change of [{headers:{origin:'https://evil.test'}},{headers:{authorization:'Bearer fixture'}},{headers:{'sec-fetch-site':'cross-site'}}]){
    assert.equal((await routes.chat(req(chat,{origin:U,...change}))).status,403);
  }
  assert.equal((await routes.owner(req(access+'?x=1',{origin:U,method:'GET'}))).status,403);
  assert.equal((await routes.owner(req(access,{origin:U,method:'DELETE',headers:{origin:''},body:null}))).status,403);
  assert.equal((await (await routes.owner(req(access,{origin:U,method:'GET',headers:{...headers,forwarded:'host=evil','x-forwarded-host':'evil'}}))).json()).authenticated,true,'forwarding headers are irrelevant, even with valid owner proof');
  for(const origin of ['https://evil.test',P]){
    const response=await routes.owner(req(access,{origin:'https://evil.test',method:'GET',headers:{origin,'x-forwarded-host':'chiptunes.app',forwarded:'host=chiptunes.app'}}));assert.equal(response.status,403);
  }
  assert.equal((await routes.owner(req(access,{origin:U,headers:{origin:U}}))).status,403);
  assert.equal((await proxyMusicChat(req(access,{method:'DELETE',body:null,headers}),{fetch:send})).headers.get('set-cookie').includes('Max-Age=0'),true);
  const legacy=createChatHandlers({env:{...env,CHAT_ORIGIN:U},pool});
  assert.equal((await legacy.owner(req(access,{origin:U,method:'GET',headers:{origin:U}}))).status,200);
  assert.equal((await legacy.owner(req(access,{origin:U,method:'GET'}))).status,403);
  assert.equal((await createChatHandlers({env:{},pool}).owner(req(access,{method:'GET'}))).status,503);
});
test('presence dispatch remains unchanged with an explicit DO stub (not native workerd proof)',async()=>{
  const source=(await fs.readFile(new URL('../../cloudflare/worker.js',import.meta.url),'utf8'))
    .replace('import { DurableObject } from "cloudflare:workers";','class DurableObject {}')
    .replace("import { proxyMusicChat } from './music-chat-proxy.mjs';",'')
    .replace('export default {','globalThis.worker = {').replace('export class Presence','class Presence');
  const ctx={Headers,Response,URL,proxyMusicChat};vm.runInNewContext(source,ctx);
  const calls=[];const env={EXTERNAL_PRESENCE_SECRET:'mock-presence',PRESENCE:{idFromName:n=>n,get:()=>({fetch:async(...args)=>{calls.push(args);return Response.json({listeners:3});}})}};
  const count=await ctx.worker.fetch(new Request(P+'/api/presence/count'),env);assert.equal((await count.json()).listeners,3);assert.equal(count.headers.get('cache-control'),'public, max-age=5');
  assert.equal((await ctx.worker.fetch(new Request(P+'/api/presence/external',{method:'POST'}),env)).status,401);
  assert.equal((await ctx.worker.fetch(new Request(P+'/api/presence',{headers:{upgrade:'websocket',origin:'https://evil.test'}}),env)).status,403);
  assert.equal(calls.length,1);
  const ws=new Request(P+'/api/presence',{headers:{upgrade:'websocket',origin:P}});
  assert.equal((await ctx.worker.fetch(ws,env)).status,200);assert.equal(calls[1][0],ws);
  const external=await ctx.worker.fetch(new Request(P+'/api/presence/external',{method:'POST',headers:{authorization:'Bearer mock-presence','content-type':'application/json'},body:'{"youtube":2,"stream":1}'}),env);
  assert.equal(external.status,200);assert.equal(calls[2][0],'https://do/external');assert.deepEqual(JSON.parse(calls[2][1].body),{youtube:2,stream:1});
  assert.equal((await ctx.worker.fetch(new Request(P+'/api/unknown'),env)).status,404);
});
