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
  const valid=(request,path)=>{
    try{const url=new URL(request.url);return url.origin===env.CHAT_ORIGIN&&url.pathname===path&&!url.search&&
      (!request.headers.has('origin')||request.headers.get('origin')===env.CHAT_ORIGIN);}catch{return false;}
  };
  return {
    async chat(request){
      if(!access.configured||!providers.length)return json(503,'provider_not_configured');
      if(!valid(request,'/api/music/chat'))return json(403,'origin_denied');
      const handler=handlers.get(request.headers.get('x-music-provider')||'openai');
      return handler?handler(request):json(400,'provider_unavailable');
    },
    async owner(request){
      if(!access.configured||!providers.length)return json(503,'provider_not_configured');
      if(!valid(request,'/api/music/chat/access'))return json(403,'origin_denied');
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
