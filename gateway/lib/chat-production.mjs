import pg from 'pg';
import handlerModule from '../../server/music-chat-handler.js';
import {databasePoolOptions} from './postgres-store.mjs';
import {createChatAccess} from './chat-access.mjs';
import {createChatProvider,availableChatProviders} from './chat-providers.mjs';
const json=(status,error)=>Response.json({ok:false,error},{status,headers:{'Cache-Control':'no-store'}});
export function createChatHandlers({env=process.env,pool,fetch}={}){
  const options=databasePoolOptions(env);
  if(!pool&&options){pool=new pg.Pool(options);pool.on('error',()=>{});}
  const access=createChatAccess(pool,env),providers=availableChatProviders(env);
  const handlers=new Map(providers.map(({id})=>[id,handlerModule.createMusicChatHandler({
    origin:env.CHAT_ORIGIN,adapter:createChatProvider(id,env,fetch?{fetch}:{}),
    authenticate:access.auth,rateLimit:async()=>true,
    reserveRequest:async(subject,id)=>{
      const reservation=await access.reserve(subject,id);
      return {...reservation,release:reservation.ok?()=>access.release(subject,id):undefined};
    }
  })]));
  const normalize=(request,path)=>{
    try{
      const url=new URL(request.url),h=request.headers;
      const publicOrigin='https://chiptunes.app',transportOrigin='https://chiptunes-agent-gateway.vercel.app';
      const transport=env.CHAT_ORIGIN===publicOrigin&&url.origin===transportOrigin;
      if((url.origin!==env.CHAT_ORIGIN&&!transport)||request.url!==url.origin+path||url.username||url.password||url.pathname!==path||url.search||url.hash||
        h.has('authorization')||h.has('upgrade')||
        (h.has('origin')&&h.get('origin')!==env.CHAT_ORIGIN)||
        (request.method!=='GET'&&h.get('origin')!==env.CHAT_ORIGIN)||
        (h.has('sec-fetch-site')&&h.get('sec-fetch-site')!=='same-origin'))return null;
      if(!transport)return request;
      // The fixed transport URL and actual Origin were independently checked.
      // No Forwarded/X-Forwarded-* value participates in authorization.
      const headers=new Headers(h);
      for(const name of [...headers.keys()])if(name==='forwarded'||name==='host'||name.startsWith('x-forwarded-'))headers.delete(name);
      return new Request(publicOrigin+path,{method:request.method,headers,body:request.body,
        ...(request.body?{duplex:'half'}:{}),signal:request.signal});
    }catch{return null;}
  };
  return {
    async chat(request){
      if(!access.configured||!providers.length)return json(503,'provider_not_configured');
      request=normalize(request,'/api/music/chat');if(!request)return json(403,'origin_denied');
      const handler=handlers.get(request.headers.get('x-music-provider')||'openai');
      return handler?handler(request):json(400,'provider_unavailable');
    },
    async owner(request){
      if(!access.configured||!providers.length)return json(503,'provider_not_configured');
      request=normalize(request,'/api/music/chat/access');if(!request)return json(403,'origin_denied');
      if(request.method==='POST')return access.login(request);
      if(request.method==='DELETE')return access.logout(request);
      if(request.method!=='GET')return json(405,'method_not_allowed');
      return Response.json({ok:true,authenticated:!!access.auth(request),providers,limits:{dailyCalls:20}},
        {headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
  };
}
const production=createChatHandlers();
export const handleChat=request=>production.chat(request);
export const handleChatAccess=request=>production.owner(request);
