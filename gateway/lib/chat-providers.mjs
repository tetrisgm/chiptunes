// Provider credentials live only in this server module's closure. No retries:
// uncertain or cancelled requests must not silently incur a second charge.
const schema = {type:'object',additionalProperties:false,properties:{
  id:{type:'string'},baseRevision:{type:'string'},explanation:{type:'string'},
  edits:{type:'array',items:{type:'object',additionalProperties:false,properties:{
    oldText:{type:'string'},newText:{type:'string'}},required:['oldText','newText']}}
},required:['id','baseRevision','edits','explanation']};
const settings={
  openai:{key:'OPENAI_API_KEY',model:'CHAT_OPENAI_MODEL',fallback:'gpt-5.4-mini-2026-03-17',url:'https://api.openai.com/v1/responses'},
  anthropic:{key:'ANTHROPIC_API_KEY',model:'CHAT_ANTHROPIC_MODEL',fallback:'claude-sonnet-4-6',url:'https://api.anthropic.com/v1/messages'}
};
async function boundedJson(response,signal){
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('provider_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw Error('provider_unavailable');
  let length=0;const chunks=[];
  try{for(;;){if(signal.aborted)throw Error('cancelled');const {value,done}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>262144)throw Error('provider_response_limit');chunks.push(value);}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }finally{void reader.cancel().catch(()=>{});}
}
export function createChatProvider(provider,env=process.env,{fetch:fetcher=globalThis.fetch}={}){
  const config=settings[provider];if(!config)return null;
  const key=env[config.key],model=env[config.model]||config.fallback;
  if(typeof key!=='string'||!key.startsWith('sk-')||!key.trim()||!/^[-a-zA-Z0-9.]{1,100}$/.test(model))return null;
  return Object.freeze({authorized:true,async propose({system,input,signal,maxOutputTokens,maxOutputBytes,maxCalls}){
    if(maxCalls!==1||signal.aborted)throw Error('provider_unavailable');
    const context=JSON.parse(input);
    // Models identify exact text, never count character offsets. The host maps
    // unique anchors back to the unchanged UTF-16 edit contract deterministically.
    system=system.replace('Each edit has only from, to, text. Offsets are\nUTF-16 code units in the supplied source, half-open, non-overlapping and sorted.',
      'Each edit has only oldText and newText. oldText must be a nonempty exact substring of source occurring exactly once; include enough surrounding context to make it unique. newText replaces that substring. Do not calculate numeric offsets. Edits must not overlap.');
    const headers={'content-type':'application/json'};let body;
    if(provider==='openai'){
      headers.authorization='Bearer '+key;
      body={model,store:false,instructions:system,input:[{role:'user',content:input}],
        max_output_tokens:Math.min(4096,maxOutputTokens),text:{format:{type:'json_schema',name:'music_proposal',strict:true,schema}}};
    }else{
      headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';
      body={model,max_tokens:Math.min(4096,maxOutputTokens),system,messages:[{role:'user',content:input}],
        output_config:{format:{type:'json_schema',schema}}};
    }
    try{
      const response=await fetcher(config.url,{method:'POST',headers,body:JSON.stringify(body),signal,redirect:'error'});
      const data=await boundedJson(response,signal);let parts;
      if(provider==='openai'){
        if(data.status!=='completed'||!Array.isArray(data.output))throw Error('incomplete');
        if(data.output.some(x=>!['message','reasoning'].includes(x.type)))throw Error('unexpected_tool');
        parts=data.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]);
        if(parts.some(x=>x.type!=='output_text'))throw Error('refused');
      }else{
        if(data.stop_reason!=='end_turn'||!Array.isArray(data.content)||data.content.some(x=>x.type!=='text'))throw Error('incomplete');
        parts=data.content;
      }
      if(!parts.length||parts.some(x=>typeof x.text!=='string'))throw Error('invalid_output');
      const output=parts.map(x=>x.text).join('');
      if(Buffer.byteLength(output)>maxOutputBytes||signal.aborted)throw Error('invalid_output');
      const proposal=JSON.parse(output);
      if(!proposal||Array.isArray(proposal)||Object.keys(proposal).length!==4||
        !['id','baseRevision','explanation','edits'].every(k=>Object.hasOwn(proposal,k)))throw Error('invalid_output');
      if(proposal.id!==context.id||proposal.baseRevision!==context.baseRevision||!Array.isArray(proposal.edits)||proposal.edits.length>32)throw Error('invalid_output');
      const edits=proposal.edits.map(edit=>{
        if(!edit||Object.keys(edit).length!==2||typeof edit.oldText!=='string'||!edit.oldText||typeof edit.newText!=='string')throw Error('invalid_anchor');
        const from=context.source.indexOf(edit.oldText);
        if(from<0||context.source.indexOf(edit.oldText,from+1)!==-1)throw Error('ambiguous_anchor');
        return {from,to:from+edit.oldText.length,text:edit.newText};
      }).sort((a,b)=>a.from-b.from);
      return new Response(JSON.stringify({id:proposal.id,baseRevision:proposal.baseRevision,explanation:proposal.explanation,edits})).body;
    }catch{throw Error('provider_unavailable');}
  }});
}
export function availableChatProviders(env=process.env){
  return Object.keys(settings).filter(id=>createChatProvider(id,env)).map(id=>({id,label:id==='openai'?'OpenAI':'Claude'}));
}
