// Same-origin browser transport. No credentials or reconnect state are persisted.
(function(G){
  'use strict';
  function create(options){
    var w=options.workspace,fetcher=options.fetch||G.fetch.bind(G),notify=options.onChange||function(){};
    var tabNonce=Array.from(G.crypto.getRandomValues(new Uint8Array(32)),function(b){return b.toString(16).padStart(2,'0');}).join('');
    // An explicit injected fetch is a test boundary; production always bootstraps
    // same-origin auth. Cache the module, never a session token.
    var auth=options.tokenProvider||(options.fetch?null:undefined);
    async function ready(){
      var controller=new AbortController(),timeout;
      requests.add(controller);
      try{
        await Promise.race([(async function(){
          if(auth===undefined)auth=await import('/api/auth');
          if(controller.signal.aborted)throw Error('unavailable');
          if(auth)await auth.ready();
        })(),new Promise(function(_,reject){
          controller.signal.addEventListener('abort',function(){reject(Error('unavailable'));},{once:true});
          timeout=setTimeout(function(){controller.abort();},15000);
        })]);
      }finally{clearTimeout(timeout);requests.delete(controller);}
    }
    var opened=false,epoch=0,session=null,base=null,generation=null,pending=null,timer=null;
    var requests=new Set(),clients=[],phase='closed',message='',available=false;
    function copy(v){return JSON.parse(JSON.stringify(v));}
    function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
    function snapshot(c){return {source:c.source,baseRevision:c.baseRevision,draftEpoch:c.draftEpoch,selection:c.policy.selection,constraints:c.policy.constraints};}
    function identity(){return {generation:generation,baseRevision:base.baseRevision,draftEpoch:base.draftEpoch};}
    function state(){return {phase:phase,message:message,clients:copy(clients),connected:phase==='connected',available:available};}
    function report(p,m){phase=p;message=m;notify(state());}
    async function request(body,detached){
      var controller=new AbortController(),timeout;
      if(!detached)requests.add(controller);
      try{
        // Race explicitly: injected fetch implementations may ignore abort.
        return await Promise.race([(async function(){
          var headers={'X-Music-Tab':tabNonce};
          if(body)headers['Content-Type']='application/json';
          if(auth){
            var token=await auth.getSessionToken();
            if(typeof token!=='string'||!token)throw Error('signed-out');
            headers.Authorization='Bearer '+token;
          }
          if(controller.signal.aborted)throw Error('unavailable');
          var response=await fetcher('/api/music-agent',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
            headers:headers,body:body?JSON.stringify(body):undefined,signal:controller.signal,keepalive:!!detached});
          if(!response.ok)throw Error(response.status===401?'signed-out':response.status===403?'access-denied':response.status===503?'unconfigured':'unavailable');
          var result=await response.json();if(!result||result.ok!==true)throw Error('unavailable');return result;
        })(),new Promise(function(_,reject){
          controller.signal.addEventListener('abort',function(){reject(Error('unavailable'));},{once:true});
          timeout=setTimeout(function(){controller.abort();},4000);
        })]);
      }finally{clearTimeout(timeout);requests.delete(controller);}
    }
    function post(action,input){return request(Object.assign({action:action,sessionId:session},input));}
    function disconnect(reason){
      var old=session;epoch++;clearTimeout(timer);timer=null;
      requests.forEach(function(c){c.abort();});requests.clear();
      session=null;base=null;generation=null;pending=null;
      w.agentDisconnect();report(opened?'disconnected':'closed',reason||'Disconnected. Connect explicitly to start a new session.');
      if(old)request({action:'revoke',sessionId:old},true).catch(function(){});
    }
    function fail(e){
      available=false;
      disconnect();
      if(opened)report(e.message==='signed-out'?'signed-out':e.message==='access-denied'?'access-denied':e.message==='unconfigured'?'unconfigured':'unavailable',
        (e.appliedLocally?'Applied locally; remote acknowledgement could not be confirmed. ':'')+
        (e.message==='signed-out'?'Sign in to connect.':e.message==='access-denied'?'Access denied. Sign in or check this client’s authorization, then refresh.':e.message==='unconfigured'?'Connection unavailable: gateway authentication is unconfigured.':'Connection unavailable. No active connection.'));
    }
    async function refresh(){
      if(!opened||session||phase==='connecting'||phase==='checking')return;
      var run=epoch;report('checking','Checking available clients…');
      try{
        await ready();if(run!==epoch||!opened)return;
        var result=await request();if(run!==epoch||!opened)return;
        if(!Array.isArray(result.clients))throw Error('unavailable');
        available=true;
        clients=result.clients.filter(function(c){return c&&typeof c.clientId==='string'&&c.clientId.length>0;}).map(function(c){return {clientId:c.clientId};});
        report('disconnected',clients.length?'Choose a client, then Connect.':'No authorized clients available.');
      }catch(e){if(run===epoch)fail(e);}
    }
    async function publish(c){
      var run=epoch,result=await post('publish',{snapshot:snapshot(c)});if(run!==epoch)return;
      if(!Number.isSafeInteger(result.generation)||result.generation<1)throw Error('unavailable');
      base=copy(c);generation=result.generation;
    }
    async function connect(clientId){
      if(!opened||phase!=='disconnected'||!clients.some(function(c){return c.clientId===clientId;}))return;
      var c=w.agentContext();if(!c.ok||!c.editable){report('disconnected','Apply valid code before connecting.');return;}
      var run=++epoch;report('connecting','Connecting and uploading source…');
      try{
        var result=await request({action:'create',clientId:clientId});
        if(run!==epoch)return;
        if(typeof result.sessionId!=='string'||!result.sessionId)throw Error('unavailable');
        session=result.sessionId;await publish(c);if(run!==epoch)return;
        if(!same(c,w.agentContext())){disconnect('Context changed during connection. Connect again.');return;}
        report('connected','Connected. Proposals require your explicit Apply.');schedule();
      }catch(e){if(run===epoch)fail(e);}
    }
    function schedule(){if(opened&&session)timer=setTimeout(tick,1000);}
    function contextChanged(){
      if(!session||!base)return;
      var c=w.agentContext();
      if(!c.ok||!c.editable||c.projectInstance!==base.projectInstance)
        disconnect('Draft or project changed. Apply valid code and connect again.');
    }
    async function tick(){
      timer=null;var run=epoch;
      try{
        var c=w.agentContext();
        if(!opened||!session)return;
        if(!c.ok||!c.editable||c.projectInstance!==base.projectInstance){disconnect('Draft or project changed. Apply valid code and connect again.');return;}
        await post('heartbeat',identity());if(run!==epoch)return;
        contextChanged();if(run!==epoch)return;c=w.agentContext();
        if(pending){
          var s=w.agentProposalStatus(pending.id),ack=null;
          // ready is validation only; revision evidence comes from the Apply UI.
          if(s.ok&&s.revision&&s.revision!==base.baseRevision&&c.baseRevision===s.revision&&c.draftEpoch>base.draftEpoch&&
            ['validated','applied','queued','playing'].indexOf(s.status)!==-1)ack='applied';
          else if(!same(c,base))ack='failed';
          else if(!s.ok||['invalid','superseded','cancelled','rejected'].indexOf(s.status)!==-1)ack=s.status==='rejected'?'rejected':'failed';
          if(ack){
            var result;
            try{result=await post('acknowledge',Object.assign(identity(),{id:pending.id,status:ack,snapshot:ack==='applied'?snapshot(c):null}));}
            catch(e){e.appliedLocally=ack==='applied';throw e;}
            if(run!==epoch)return;
            if(ack==='applied'){
              if(!Number.isSafeInteger(result.generation)||result.generation<=generation)throw Error('unavailable');
              generation=result.generation;base=copy(c);
            }
            pending=null;report('connected',ack==='applied'?'Applied in browser · '+s.status:'Proposal '+ack+'.');
            schedule();return;
          }
        }
        c=w.agentContext();
        if(!same(c,base)){await publish(c);if(run!==epoch)return;schedule();return;}
        if(!pending){
          var polled=await post('poll',identity());if(run!==epoch)return;
          var p=polled.proposal;
          // Reconcile after I/O, before handing any edits to the local validator.
          if(p){
            if(!same(base,w.agentContext())||p.generation!==generation||p.baseRevision!==base.baseRevision||p.draftEpoch!==base.draftEpoch){disconnect('Stale proposal discarded. Connect again.');return;}
            var accepted=w.agentPropose({id:p.id,context:copy(base),edits:p.edits,explanation:p.explanation});
            pending={id:p.id};
            if(!accepted.ok){await post('acknowledge',Object.assign(identity(),{id:p.id,status:'failed',snapshot:null}));if(run!==epoch)return;pending=null;}
            report('connected',accepted.ok?'Proposal ready and validated. Review it below; Apply is required.':'Proposal failed local validation.');
          }
        }
      }catch(e){if(run===epoch)fail(e);}
      if(run===epoch)schedule();
    }
    return {open:function(){if(opened)return;opened=true;available=false;epoch++;refresh();},close:function(){opened=false;disconnect();},
      connect:connect,disconnect:disconnect,refresh:refresh,state:state,contextChanged:contextChanged};
  }
  G.CT_MUSIC_AGENT_CONNECTION={create:create};
})(typeof globalThis!=='undefined'?globalThis:window);
