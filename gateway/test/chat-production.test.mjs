// Real isolated PostgreSQL + production routes; model HTTP is a labeled fixture.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import pg from 'pg';
import {createChatHandlers} from '../lib/chat-production.mjs';
test('private built-in Chat: owner proof, both providers, validation, durable paid-call reservation and logout',async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ct-chat-route-'));let child,pool,exited;
  try{
    await fs.chmod(temporary,0o700);
    execFileSync('initdb',['-D',path.join(temporary,'data'),'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
    child=spawn('postgres',['-D',path.join(temporary,'data'),'-k',temporary,'-c','listen_addresses='],{stdio:'ignore'});
    exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
    pool=new pg.Pool({host:temporary,user:os.userInfo().username,database:'postgres',max:4,connectionTimeoutMillis:1000});
    const deadline=Date.now()+10000;
    for(;;){try{await pool.query('SELECT 1');break;}catch{if(Date.now()>deadline)throw Error('db_unavailable');await new Promise(r=>setTimeout(r,50));}}
    await pool.query(await fs.readFile(new URL('../../server/music-chat-access.sql',import.meta.url),'utf8'));
    const env={CHAT_ORIGIN:'https://music.example',CHAT_OWNER_PASSWORD:'owner-fixture-'.repeat(4),OPENAI_API_KEY:'sk-mock-openai',ANTHROPIC_API_KEY:'sk-mock-anthropic'};
    let calls=0;
    const fetch=async(url,init)=>{
      calls++;const sent=JSON.parse(init.body),input=JSON.parse(sent.input?.[0].content||sent.messages[0].content);
      const text=JSON.stringify({id:input.id,baseRevision:input.baseRevision,explanation:'Fixture tempo change',edits:[{oldText:'120',newText:'128'}]});
      return Response.json(url.includes('openai')?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:{stop_reason:'end_turn',content:[{type:'text',text}]});
    };
    let routes=createChatHandlers({env,pool,fetch});let cookie='';
    const owner=(method,body)=>routes.owner(new Request(env.CHAT_ORIGIN+'/api/music/chat/access',{method,headers:{origin:env.CHAT_ORIGIN,'content-type':'application/json',cookie},body:body?JSON.stringify(body):undefined}));
    assert.equal((await (await owner('GET')).json()).authenticated,false);
    assert.equal((await owner('POST',{password:'wrong'})).status,401);
    const login=await owner('POST',{password:env.CHAT_OWNER_PASSWORD});assert.equal(login.status,200);
    cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await owner('GET')).json()).authenticated,true);
    const source='song({tempo:120,bars:4})\n';
    const chat=(id,provider='openai',authorizationCookie=cookie,requestSource=source)=>routes.chat(new Request(env.CHAT_ORIGIN+'/api/music/chat',{method:'POST',headers:{origin:env.CHAT_ORIGIN,'content-type':'application/json',cookie:authorizationCookie,'x-music-provider':provider},body:JSON.stringify({id,baseRevision:'r1',source:requestSource,request:'Change tempo',constraints:{},selection:null})}));
    assert.equal((await chat('unauth','openai','')).status,401);assert.equal(calls,0);
    assert.equal((await chat('invalid','openai',cookie,'not valid music')).status,400);assert.equal(calls,0);
    for(const provider of ['openai','anthropic']){const r=await chat(provider,provider);assert.equal(r.status,200);assert.deepEqual((await r.json()).edits,[{from:12,to:15,text:'128'}]);}
    assert.equal(calls,2);
    routes=createChatHandlers({env,pool,fetch}); // A new server instance cannot reset billing/replay.
    assert.equal((await chat('openai')).status,409);assert.equal(calls,2);
    assert.equal((await chat('third')).status,429);assert.equal(calls,2);
    const budget=(await pool.query('SELECT day_count,active_request FROM music_chat_budget')).rows[0];
    assert.equal(budget.day_count,2);assert.equal(budget.active_request,null);
    assert.equal((await owner('DELETE')).headers.get('set-cookie').includes('Max-Age=0'),true);
    assert.equal((await createChatHandlers({env:{},pool,fetch}).chat(new Request(env.CHAT_ORIGIN+'/api/music/chat'))).status,503);
  }finally{
    if(pool)await pool.end();if(child&&child.exitCode===null){child.kill('SIGTERM');await exited;}
    await fs.rm(temporary,{recursive:true,force:true});
  }
});
