// Fixed product transport, not an authentication boundary or an open proxy.
export const PUBLIC_ORIGIN='https://chiptunes.app';
export const UPSTREAM_ORIGIN='https://chiptunes-agent-gateway.vercel.app';
const OWNER='__Host-ct-chat-owner';
const CHAT='/api/music/chat',ACCESS=CHAT+'/access';
const json=(status,error)=>Response.json({ok:false,error},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=status=>{throw Object.assign(new Error('proxy_request_failed'),{status});};
// Dependency injection is exclusively an explicit unit-test seam.
export async function proxyMusicChat(request,{fetch:send=globalThis.fetch,deadlineMs=35000}={}){
  const url=new URL(request.url),h=request.headers;
  if(url.origin!==PUBLIC_ORIGIN||request.url!==PUBLIC_ORIGIN+url.pathname||url.username||url.password||url.search||url.hash||
    ![CHAT,ACCESS].includes(url.pathname))return json(403,'request_denied');
  if(!(url.pathname===CHAT?['POST']:['GET','POST','DELETE']).includes(request.method))return json(405,'method_not_allowed');
  if(h.has('authorization')||h.has('upgrade')||h.has('content-encoding')||
    (h.has('origin')&&h.get('origin')!==PUBLIC_ORIGIN)||
    (request.method!=='GET'&&h.get('origin')!==PUBLIC_ORIGIN)||
    (h.has('sec-fetch-site')&&h.get('sec-fetch-site')!=='same-origin')||
    (h.has('sec-fetch-mode')&&!['cors','same-origin'].includes(h.get('sec-fetch-mode')))||
    (h.has('sec-fetch-dest')&&h.get('sec-fetch-dest')!==''))return json(403,'request_denied');
  if(request.method==='POST'&&!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h.get('content-type')||''))return json(415,'json_required');
  const provider=h.get('x-music-provider');
  if(provider!==null&&!['openai','anthropic'].includes(provider))return json(400,'provider_unavailable');
  const headers=new Headers();
  for(const name of ['origin','content-type','x-music-provider','sec-fetch-site','sec-fetch-mode','sec-fetch-dest'])if(h.has(name))headers.set(name,h.get(name));
  const cookies=(h.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(OWNER+'='));
  if(cookies.length>1||cookies.some(s=>s.length>512||!/^__Host-ct-chat-owner=[A-Za-z0-9.-]*$/.test(s)))return json(403,'request_denied');
  if(cookies.length)headers.set('cookie',cookies[0]);
  const controller=new AbortController();let reader,timer,rejectStop,stopped=false;
  const stopPromise=new Promise((_,reject)=>{rejectStop=reject;});
  // An abort must settle even if a mocked/broken fetch or reader ignores signals.
  stopPromise.catch(()=>{});
  const stop=status=>{if(stopped)return;stopped=true;controller.abort();if(reader)void reader.cancel().catch(()=>{});rejectStop(Object.assign(new Error('proxy_stopped'),{status}));};
  const abort=()=>stop(499);
  request.signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>stop(504),deadlineMs);
  const bounded=async(body,cap,status)=>{
    if(!body)return null;
    reader=body.getReader();const chunks=[];let size=0;
    try{
      for(;;){const next=await Promise.race([reader.read(),stopPromise]);if(stopped)await stopPromise;if(next.done)break;
        size+=next.value.byteLength;if(size>cap)fail(status);chunks.push(next.value);}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;
    }finally{void reader.cancel().catch(()=>{});reader=null;}
  };
  try{
    if(request.signal.aborted)abort();if(stopped)await stopPromise;
    const cap=request.method==='POST'?(url.pathname===ACCESS?2048:1048576):0;
    const length=h.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>cap))fail(413);
    const body=await bounded(request.body,cap,413);
    const pending=Promise.resolve(send(UPSTREAM_ORIGIN+url.pathname,{method:request.method,headers,
      body:request.method==='POST'?body:undefined,signal:controller.signal,redirect:'manual'}));
    // Dispose late responses when an implementation ignores cancellation.
    void pending.then(r=>{if(stopped&&r.body)void r.body.cancel().catch(()=>{});},()=>{});
    const response=await Promise.race([pending,stopPromise]);
    if(response.status>=300&&response.status<400){if(response.body)void response.body.cancel().catch(()=>{});fail(502);}
    const bytes=await bounded(response.body,65536,502);
    if(!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type')||''))fail(502);
    const out=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    // Only the existing host-only owner cookie may cross this boundary.
    const setCookies=response.headers.getSetCookie?response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);
    if(setCookies.length>1)fail(502);
    for(const cookie of setCookies){
      if(url.pathname!==ACCESS||!/^__Host-ct-chat-owner=[A-Za-z0-9.-]*; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=(?:0|21600)$/.test(cookie)||cookie.length>1024)fail(502);
      out.append('Set-Cookie',cookie);
    }
    return new Response(bytes,{status:response.status,headers:out});
  }catch(e){controller.abort();return json(e.status||502,e.status===504?'upstream_timeout':e.status===499?'request_cancelled':'proxy_request_failed');}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}
