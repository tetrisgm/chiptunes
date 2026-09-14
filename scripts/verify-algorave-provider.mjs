// Explicit, bounded live-provider capture. Default invocation prints the plan and
// makes no network request. Browser/audio acceptance consumes the saved proposals
// separately, after the sustained run. Never read a user's saved project here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createChatProvider} from '../gateway/lib/chat-providers.mjs';
import handlerModule from '../server/music-chat-handler.js';
import contract from '../src/algorave/project.cjs';
import {example} from '../src/algorave/examples.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=[
  {target:'music',request:'Add a syncopated bassline to this groove. Keep the drum layer, tempo and all visuals unchanged. Use the available synths.'},
  {target:'visuals',request:'Make a colorful tunnel that pulses with the actual kick events using ctKick. Keep all music unchanged.'},
  {target:'both',request:'Make the music darker by changing the melody and bass notes, and change the visual colors to deep blue and violet. Keep the tempo and drum rhythm unchanged.'},
];
const models={openai:process.env.CHAT_OPENAI_MODEL||'gpt-5.4-mini-2026-03-17',anthropic:process.env.CHAT_ANTHROPIC_MODEL||'claude-sonnet-4-6'};
const plan={providers:models,callsPerProvider:3,maxOutputTokensPerCall:4096,timeoutMs:30000,retries:0,source:'Original bundled groove; then the preceding accepted data-only candidate. No private project or chat.',cases};
async function capture(provider,{fixture=false}={}){
  let calls=0;
  const result={provider,model:models[provider],fixture,started:new Date().toISOString(),status:'running',cases:[],calls:0,compiled:false};
  const receipt=path.join(root,'.algorave-preview',`provider-${provider}${fixture?'-fixture':''}.json`);
  // Never overwrite an earlier paid capture, including a partial failure.
  if(!fixture&&fs.existsSync(receipt))throw Error('A provider receipt already exists; review it before another paid attempt.');
  const save=()=>{fs.mkdirSync(path.dirname(receipt),{recursive:true});fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');};
  const fetcher=fixture?async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    assert.equal(body.max_output_tokens??body.max_tokens,4096);
    const c=JSON.parse(provider==='openai'?body.input[0].content:body.messages[0].content);
    const documents=c.target==='both'?['music','Image']:[c.target==='visuals'?'Image':'music'];
    const edits=documents.map(document=>{const source=contract.sourceFor(c.project,document);return {document,oldText:source,newText:source+'\n// acceptance fixture'};});
    const output=JSON.stringify({id:c.id,baseRevision:c.baseRevision,edits,explanation:'Fixture response, not provider quality evidence.'});
    return Response.json(provider==='openai'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}:{stop_reason:'end_turn',content:[{type:'text',text:output}]});
  }:async(...args)=>{calls++;if(calls>3)throw Error('Call budget exceeded');return fetch(...args);};
  const env=fixture?{OPENAI_API_KEY:'sk-fixture',ANTHROPIC_API_KEY:'sk-fixture',CHAT_OPENAI_MODEL:models.openai,CHAT_ANTHROPIC_MODEL:models.anthropic}:process.env;
  const adapter=createChatProvider(provider,env,{fetch:fetcher});
  if(!adapter)throw Error('Provider credentials are not available in this process. No request sent.');
  const origin='http://127.0.0.1';
  const handler=handlerModule.createMusicChatHandler({origin,adapter,authenticate:async()=>({subject:'local-acceptance'}),rateLimit:async()=>true});
  let project=example('groove');
  save();
  try{
    for(const item of cases){
      const context=await contract.context({kind:'algorave',id:crypto.randomUUID(),...item,project,baseRevision:await contract.revision(project)});
      const response=await handler(new Request(origin+'/api/music/chat',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(context)}));
      result.calls=calls;
      if(!response.ok)throw Error('Provider/gateway rejected the request with HTTP '+response.status+'. No retry.');
      const proposal=await response.json(),candidate=contract.candidateFrom(project,proposal,context);
      if(item.target!=='visuals')assert.notEqual(candidate.music,project.music,'The requested music change is missing.');
      if(item.target!=='music')assert.notDeepEqual(candidate.visuals,project.visuals,'The requested visual change is missing.');
      if(item.target==='music')assert.deepEqual(candidate.visuals,project.visuals);
      if(item.target==='visuals')assert.equal(candidate.music,project.music);
      result.cases.push({context,proposal,candidate});project=candidate;save();
    }
    assert.equal(calls,3);result.status='captured';result.finished=new Date().toISOString();save();
    console.log(`${fixture?'Fixture':'Live'} capture: ${provider}, ${calls} calls; source/runtime acceptance still required. ${receipt}`);
  }catch(error){result.calls=calls;result.status='failed';result.error=String(error.message);save();throw error;}
}
const [mode='--plan',provider]=process.argv.slice(2);
try{
  if(mode==='--plan')console.log(JSON.stringify(plan,null,2));
  else if(mode==='--self-test'){for(const id of ['openai','anthropic'])await capture(id,{fixture:true});}
  else if(mode==='--live'&&['openai','anthropic'].includes(provider))await capture(provider);
  else throw Error('Use --plan, --self-test, or --live openai|anthropic. Live calls require owner authorization.');
}catch(error){console.error(error.message);process.exitCode=1;}
