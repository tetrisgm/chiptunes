// One source authority. Notes and exports use validated revisions; typing never
// changes audio. Legacy and native editors retain their own document boundaries.
(function(G){
  'use strict';
  var root,editor,project,storage,client,sourceLoading=false,saveTimer,queueTokens={},queueRevisions={},queueActivations={},playingRevision=null,audioState={status:'stopped',frame:0};
  var selection=null,proposal=null,requestId=null,serial=0,previousFocus,inerted=[],conflict=false,unsub=null;
  var unsaved=false,saveEpoch=0,editorLoading=null,previousRoute=null;
  var agentInstance=null,agentRecords=new Map(),policyEpoch=0;
  var connection=null;
  var chatAccess=null,chatAccessEpoch=0,chatUnlocked=false,chatAccessBusy=false,chatProviders=[];
  function renderChatAccess(message){
    var select=$('.mw-chat-provider'),chosen=select.value;
    if(Array.from(select.options).map(function(o){return o.value;}).join(',')!==chatProviders.map(function(p){return p.id;}).join(',')){
      select.replaceChildren();
      chatProviders.forEach(function(p){var option=document.createElement('option');option.value=p.id;option.textContent=p.id==='openai'?'OpenAI':'Claude';select.appendChild(option);});
      if(chatProviders.some(function(p){return p.id===chosen;}))select.value=chosen;
    }
    select.disabled=chatAccessBusy||!!requestId||!chatProviders.length;
    $('[data-action=chat]').disabled=!chatUnlocked||chatAccessBusy||!chatProviders.length||!!requestId;
    $('[data-action=chat-unlock]').disabled=chatAccessBusy||chatUnlocked;
    $('[data-action=chat-logout]').disabled=chatAccessBusy||!chatUnlocked;
    $('[data-action=chat-access-refresh]').disabled=chatAccessBusy;
    $('.mw-owner-password').disabled=chatAccessBusy||chatUnlocked;
    if(message)$('.mw-chat-access-status').textContent=message;
  }
  async function updateChatAccess(method){
    if(chatAccessBusy)return;
    var password=$('.mw-owner-password').value;$('.mw-owner-password').value='';
    if(method==='POST'&&!password){renderChatAccess('Enter the owner password.');return;}
    var run=++chatAccessEpoch;chatAccessBusy=true;
    if(method==='DELETE'){cancelChat('cancelled');chatUnlocked=false;renderProposal();}
    renderChatAccess('Checking chat access…');
    try{
      if(method!=='GET')await chatAccess.request(method,password);
      password='';if(run!==chatAccessEpoch)return;
      var result=await chatAccess.request('GET');if(run!==chatAccessEpoch)return;
      if(typeof result.authenticated!=='boolean'||!Array.isArray(result.providers)||!result.limits||!Number.isSafeInteger(result.limits.dailyCalls)||result.limits.dailyCalls<1)throw Error('Chat access is unavailable.');
      chatProviders=result.providers.filter(function(p){return p&&['openai','anthropic'].indexOf(p.id)!==-1;});chatUnlocked=result.authenticated;
      renderChatAccess(!chatProviders.length?'Chat providers are unavailable.':(chatUnlocked?'Unlocked.':'Locked. Enter the owner password to use chat.')+' Daily limit: '+result.limits.dailyCalls+' calls.');
    }catch(e){if(run!==chatAccessEpoch)return;chatUnlocked=false;renderChatAccess(e.message);}
    finally{password='';if(run===chatAccessEpoch){chatAccessBusy=false;renderChatAccess();}}
  }
  function renderConnection(s){
    $('.mw-connect-status').textContent=s.message;
    var gateway=location.protocol==='https:'&&s.available;
    $('.mw-mcp-setup').hidden=!gateway;$('.mw-mcp-unavailable').hidden=gateway;
    $('.mw-mcp-endpoint').value=gateway?location.origin+'/api/mcp':'';
    $('.mw-sign-in').hidden=s.phase!=='signed-out'&&s.phase!=='access-denied';
    var select=$('.mw-client'),chosen=select.value;select.replaceChildren();
    var placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose an authorized client';select.appendChild(placeholder);
    s.clients.forEach(function(c){var option=document.createElement('option');option.value=c.clientId;option.textContent=c.clientId;select.appendChild(option);});
    select.value=chosen;select.disabled=s.phase!=='disconnected';
    $('[data-action=connect]').disabled=s.phase!=='disconnected'||!select.value;
    $('[data-action=disconnect]').disabled=!s.connected&&s.phase!=='connecting';
    $('[data-action=refresh-clients]').disabled=['connecting','connected','checking'].indexOf(s.phase)!==-1;
  }
  // Local page bridge only: these methods confer no authentication or transport trust.
  function detached(value){return JSON.parse(JSON.stringify(value));}
  function validUnicode(s){
    for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);
      if(c>=0xD800&&c<=0xDBFF){var n=s.charCodeAt(++i);if(!(n>=0xDC00&&n<=0xDFFF))return false;}
      else if(c>=0xDC00&&c<=0xDFFF)return false;
    }return true;
  }
  function boundedProposal(input){
    function need(ok){if(!ok)throw Error('Invalid bounded proposal');}
    function bytes(s,limit){need(typeof s==='string'&&s.length<=limit&&validUnicode(s));var n=new TextEncoder().encode(s).length;need(n<=limit);return n;}
    function boundary(s,i){return !(i>0&&i<s.length&&/[\uD800-\uDBFF]/.test(s[i-1])&&/[\uDC00-\uDFFF]/.test(s[i]));}
    var source=input.context&&input.context.source,sourceBytes=bytes(source,524288);
    need(validUnicode(input.explanation));
    need(Array.isArray(input.edits)&&input.edits.length>0&&input.edits.length<=32);
    var end=0,previous=-1,inserted=0,removed=0,candidate='';
    input.edits.forEach(function(e){
      need(e&&Object.keys(e).length===3&&['from','to','text'].every(function(k){return Object.prototype.hasOwnProperty.call(e,k);}));
      need(Number.isSafeInteger(e.from)&&Number.isSafeInteger(e.to)&&e.from>=end&&e.from>previous&&e.to>=e.from&&e.to<=source.length);
      need(boundary(source,e.from)&&boundary(source,e.to)&&!(e.from===0&&e.to===source.length));
      inserted+=bytes(e.text,16384);removed+=new TextEncoder().encode(source.slice(e.from,e.to)).length;
      need(inserted<=16384&&removed<=16384);
      candidate+=source.slice(end,e.from)+e.text;end=e.to;previous=e.from;
    });
    candidate+=source.slice(end);need(candidate!==source&&removed<sourceBytes);bytes(candidate,524288);
  }
  function exactContext(a,b){
    if(a===b)return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    var keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(b,k)&&exactContext(a[k],b[k]);});
  }
  function agentContext(){
    if(!project||!root||root.hidden)return {ok:false,code:'workspace-closed'};
    var s=snap(),tracks=+$('.mw-scope').value,lock=$('.mw-lock').value,region=$('.mw-region').checked;
    var constraints={locks:lock==='none'?[]:[{type:lock,tracks:[0]}]};
    if(tracks>=0)constraints.scope={tracks:[tracks]};
    if(region&&selection)constraints.scope={tracks:[selection.ch],fromFrame:selection.fromFrame,toFrame:selection.toFrame};
    return detached({ok:true,projectInstance:agentInstance,draftEpoch:s.draftEpoch,baseRevision:s.validated?s.validated.id:null,source:s.draft,
      editable:!!s.validated&&s.draft===s.validated.source&&!conflict,
      policy:{epoch:policyEpoch,scope:tracks,lock:lock,region:region,selection:selection,constraints:constraints}});
  }
  function invalidateAgent(){
    if(proposal&&proposal.capturedContext&&['ready','proposed'].indexOf(proposal.status)!==-1&&!exactContext(proposal.capturedContext,agentContext())){
      project.cancelRequest(proposal.id);proposal.status='superseded';
      if(requestId===proposal.id){requestId=null;if(client)client.cancel();}
      return true;
    }return false;
  }
  function agentPolicyChanged(){policyEpoch++;if(invalidateAgent())renderProposal();renderState();}
  function agentProposalStatus(id){
    if(invalidateAgent()){renderProposal();renderState();}
    var record=agentRecords.get(id);
    return record?detached({ok:true,id:id,status:record.status,revision:record.revision||null,diff:record.diff||null}):{ok:false,code:'unknown-proposal'};
  }
  function agentPropose(input){
    try{
      if(!input||Object.keys(input).some(function(k){return ['id','context','edits','explanation'].indexOf(k)===-1;})||
        typeof input.id!=='string'||!input.id.length||input.id.length>128||typeof input.explanation!=='string'||input.explanation.length>5000)
        return {ok:false,code:'invalid-proposal'};
      boundedProposal(input);
      var context=agentContext();
      if(!context.ok||!context.editable||!exactContext(input.context,context))return {ok:false,code:'stale-context'};
      input={id:input.id,explanation:input.explanation,edits:input.edits.map(function(e){return {from:e.from,to:e.to,text:e.text};})};
      if(agentRecords.has(input.id))return {ok:false,code:'duplicate-request'};
      if(agentRecords.size>=1024)return {ok:false,code:'request-limit'};
      var started=project.beginRequest(input.id);if(!started.ok)return started;
      var result=project.validateProposal({id:input.id,baseRevision:context.baseRevision,baseSource:context.source,edits:input.edits},context.policy.constraints);
      if(!result.ok){project.cancelRequest(input.id);agentRecords.set(input.id,{status:'invalid'});return result;}
      proposal={id:input.id,status:'ready',agentContext:context,capturedContext:context,explanation:input.explanation,edits:input.edits,diff:result.diff};
      agentRecords.set(input.id,proposal);renderProposal();renderState();
      return agentProposalStatus(input.id);
    }catch(e){return {ok:false,code:'invalid-proposal'};}
  }
  function agentDisconnect(){
    if(proposal&&proposal.agentContext&&proposal.status==='ready'){project.cancelRequest(proposal.id);proposal.status='cancelled';}
    agentInstance=G.crypto.randomUUID();
    if(root&&!root.hidden){renderProposal();renderState();}
    return {ok:true};
  }
  var KEY='ct-music-workspace-v1',ASSETS=G.CT_MUSIC_ASSETS_VERSION||'ct-gb-bank-1',view='notes';
  var $=function(s){return root.querySelector(s);};
  function api(){return G.CT_MUSIC_PROJECT;}
  function engine(){return Audio;}
  function opts(){return {compile:G.CT_MUSIC_LANGUAGE.compile,assetsVersion:ASSETS};}
  function snap(){return project.snapshot();}
  function status(text){$('.mw-status').textContent=text;}
  function check(result){if(!result||!result.ok)throw Error(result&&result.message||result&&result.code||'Operation failed');return result;}
  function announceError(e){status(e.message||String(e));}
  function diagnostics(items){
    items=items||[];
    $('.mw-diagnostics').textContent=items.map(function(d){return (d.severity||'error')+': '+d.message;}).join('\n');
    if(editor)editor.diagnostics(items.map(function(d){return Object.assign({},d,{from:d.span&&d.span.start.offset||d.from||0,to:d.span&&d.span.end.offset||d.to||0});}));
  }
  function scheduleSave(){unsaved=true;saveEpoch++;clearTimeout(saveTimer);saveTimer=setTimeout(save,250);}
  async function save(){
    clearTimeout(saveTimer);saveTimer=null;
    if(!storage||conflict){unsaved=true;return;}
    var p=project,epoch=saveEpoch;
    var write=function(){
      if(p!==project)return;
      var result=storage.save(p,{includePrivate:true});
      if(!result.ok){unsaved=true;conflict=result.code==='storage-conflict';status(conflict?'Another tab changed this project. Download your project before reloading.':'Draft could not be saved locally. Download a project file to keep it.');}
      else if(epoch===saveEpoch)unsaved=false;
    };
    try{if(G.navigator&&navigator.locks)await navigator.locks.request(KEY,write);else write();}
    catch(e){if(p===project){unsaved=true;status('Draft could not be saved locally. Download a project file to keep it.');}}
  }
  function cancelChat(state){
    if(client)client.cancel();
    var active=project&&snap().request;
    if(active)project.cancelRequest(active.id);
    requestId=null;
    if(proposal&&(proposal.status==='ready'||proposal.status==='proposed'))proposal.status=state||'superseded';
  }
  function resetAudio(){
    try{engine().musicStop();}
    finally{
      if(project)project.stop();queueTokens={};queueRevisions={};queueActivations={};playingRevision=null;
      audioState={status:'stopped',frame:0};
      if(root){$('.mw-seek').value='0';var cursor=$('.mw-playhead');if(cursor)cursor.style.left='0px';}
    }
  }
  function sourceChanged(text){
    if(sourceLoading)return;
    var result=project.editDraft(text);if(!result.ok){announceError(result);return;}
    cancelChat('superseded');renderProposal();renderState();scheduleSave();
  }
  async function ensureEditor(){
    if(editor)return;
    if(editorLoading)return editorLoading;
    editorLoading=(async function(){
    if(!G.CT_MUSIC_CODE_EDITOR){
      await new Promise(function(resolve,reject){
        var script=document.createElement('script');script.src='/lib/music-code-editor.js?v='+encodeURIComponent(G.CT_MUSIC_EDITOR_VERSION||'1');
        script.onload=resolve;script.onerror=function(){script.remove();reject(Error('Code editor could not load'));};document.head.appendChild(script);
      });
    }
    editor=G.CT_MUSIC_CODE_EDITOR.mount($('.mw-code'),snap().draft,sourceChanged);
    $('.mw-help pre').textContent=Object.values(G.CT_MUSIC_CODE_EDITOR.help).join('\n');
    })();
    try{await editorLoading;}finally{editorLoading=null;}
  }
  function syncEditor(){if(editor){sourceLoading=true;editor.set(snap().draft);sourceLoading=false;}}
  function selectView(next,focusCode){
    view=next;root.dataset.view=next;
    $('.mw-notes').hidden=next==='code';$('.mw-code').hidden=next!=='code';
    root.querySelectorAll('[data-view]').forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.view===next));b.tabIndex=b.dataset.view===next?0:-1;});
    if(next==='code')ensureEditor().then(function(){if(focusCode!==false&&!root.hidden&&view==='code')editor.focus();}).catch(announceError);
  }
  function renderState(){
    renderChatAccess();
    if(connection)connection.contextChanged();
    var s=snap(),v=s.validated;
    $('.mw-state').textContent='Draft '+(v&&s.draft===v.source?'validated':'edited')+' · Valid '+(v?v.id:'none')+
      ' · Queued '+(s.pending?s.pending.revisionId:'none')+' · Playing '+(s.playing||'none')+' · '+audioState.status+(audioState.suspended?' (audio suspended)':'');
    $('[data-action=undo]').disabled=!s.canUndo;$('[data-action=redo]').disabled=!s.canRedo;
    $('[data-action=play]').disabled=!v;
    $('.mw-seek').max=v?Math.max(0,v.compiled.gb.totalFrames-1):0;
    $('.mw-context').textContent='Base '+(v?v.id:'none')+' · '+(selection?['Melody','Harmony','Bass','Drums'][selection.ch]+' · frames '+selection.fromFrame+'–'+selection.toFrame:'Whole song');
    $('[data-action=cancel]').disabled=!requestId;
  }
  function renderNotes(){
    var s=snap(),v=s.validated,pane=$('.mw-notes');pane.replaceChildren();
    if(!v){pane.textContent='Apply valid code to see notes.';return;}
    var gb=v.compiled.gb,settings=v.compiled.settings||{},bars=settings.bars||Math.max(1,Math.ceil(gb.totalFrames/120));
    var width=Math.max(pane.clientWidth-28,Math.min(12000,bars*80)),total=gb.totalFrames||1;
    var inner=document.createElement('div');inner.style.width=width+'px';inner.style.position='relative';
    var ruler=document.createElement('div');ruler.className='mw-bar-ruler';ruler.setAttribute('aria-label','Bar boundaries on the compiled song clock');
    ruler.style.cssText='height:26px;position:relative;font-size:11px;color:#b6bfd5';
    inner.appendChild(ruler);
    // Reuse the compiler clock. Thin labels (not timing) to at most 256 marks;
    // label indices remain absolute, including after a tempo-map segment.
    try{
      var clock=G.CT_MUSIC_LANGUAGE.createClock(settings),lo=0,hi=65536;
      while(lo<hi){var mid=(lo+hi)>>1;if(clock(mid*4)<total)lo=mid+1;else hi=mid;}
      var stride=Math.max(1,Math.ceil(lo/255));
      for(var i=0;i<lo;i+=stride){
        var frame=clock(i*4);
        var mark=document.createElement('span');mark.textContent='Bar '+(i+1);mark.title='Frame '+frame;
        mark.style.cssText='position:absolute;white-space:nowrap;top:0;left:'+(frame/total*width)+'px';ruler.appendChild(mark);
        var line=document.createElement('div');line.setAttribute('aria-hidden','true');
        line.style.cssText='position:absolute;pointer-events:none;top:26px;bottom:0;border-left:1px solid #ffffff12;z-index:1;left:'+(frame/total*width)+'px';inner.appendChild(line);
      }
      var end=document.createElement('span');end.textContent='End';end.title='Frame '+total;
      end.style.cssText='position:absolute;right:0;top:0';ruler.appendChild(end);
    }catch(e){ruler.textContent='Bar clock unavailable: '+e.message;}
    ['Melody','Harmony','Bass','Drums'].forEach(function(name,ch){
      var lane=document.createElement('div');lane.className='mw-lane';lane.setAttribute('aria-label',name);
      lane.style.background='#10121b';
      var label=document.createElement('div');label.className='mw-lane-label';label.textContent=name;lane.appendChild(label);
      gb.notes.forEach(function(n,i){
        if(n.ch!==ch)return;
        var b=document.createElement('button');b.className='mw-note';b.type='button';
        b.style.left=(n.frame/total*width)+'px';b.style.width=Math.max(6,Math.min(n.frames,total-n.frame)/total*width)+'px';
        b.style.top=(28+(ch===3?12:Math.max(0,50-((n.midi||36)-24)*0.55)))+'px';
        b.setAttribute('aria-label',name+' note '+(n.midi==null?'noise':n.midi)+' frame '+n.frame+' length '+n.frames);
        b.setAttribute('aria-pressed','false');b.dataset.note=String(i);
        if((v.compiled.diagnostics||[]).some(function(d){return d.code==='CHIP_OVERLAP'&&d.noteIndex===i;})){b.style.background='#c46a54';b.title='Chip overlap: inspect diagnostics';}
        if(n.frame+n.frames>total){b.style.background='#c46a54';b.title='Finite song end cuts this event; source duration is retained.';}
        b.addEventListener('click',function(){
          selection={ch:ch,fromFrame:n.frame,toFrame:n.frame+n.frames};
          agentPolicyChanged();
          pane.querySelectorAll('.mw-note').forEach(function(el){el.setAttribute('aria-pressed',String(el===b));});
          var m=v.compiled.mapping.find(function(x){return x.noteIndex===i;});
          $('.mw-selection').textContent='Selected '+name+' · '+(m&&m.pattern?'pattern '+m.pattern+', occurrence '+m.occurrence:'explicit event')+' · frames '+n.frame+'–'+(n.frame+n.frames);
          renderState();
          if(m){selectView('code');ensureEditor().then(function(){editor.select(m.span.start.offset,m.span.end.offset);}).catch(announceError);}
        });lane.appendChild(b);
      });inner.appendChild(lane);
    });
    var cursor=document.createElement('div');cursor.className='mw-playhead';cursor.style.left=Math.max(0,(audioState.frame||0)/total*width)+'px';inner.appendChild(cursor);pane.appendChild(inner);
  }
  function boundaries(revision){
    if(typeof engine().musicBoundaries!=='function')throw Error('Tempo-aware audio boundaries are unavailable');
    // Activation is scheduled on the sounding revision's clock, not the draft's.
    // Reserve one slot for musicPrepare's terminal boundary (engine cap: 256).
    return engine().musicBoundaries(revision.compiled,{fromFrame:Math.max(0,Math.ceil(audioState.frame||0)),limit:255});
  }
  function onAudio(e){
    if(!root||root.hidden||!project)return;
    var proposalStatus=proposal&&proposal.status;
    if(e.status==='suspended')audioState.suspended=true;
    if(e.status==='resumed')audioState.suspended=false;
    // Notifications describe an event, not a transport mode. In particular a
    // queued/prepared revision must not turn a paused transport into playing.
    if(['playing','paused','stopped','ended','error'].indexOf(e.status)!==-1)
      audioState.status=e.status==='ended'?'stopped':e.status;
    if(e.frame!=null&&['position','loop','playing','paused'].indexOf(e.status)!==-1)audioState.frame=e.frame;
    if(e.status==='prepared'&&queueTokens[e.revision])queueActivations[e.revision]=e.activation;
    if(e.status==='playing'&&e.reason==='activate'&&e.revision&&queueTokens[e.revision]){
      var ack=project.ack(e.revision,queueTokens[e.revision]);
      if(ack.ok){playingRevision=queueRevisions[e.revision];if(proposal&&proposal.revision===e.revision)proposal.status='playing';}
      delete queueTokens[e.revision];delete queueRevisions[e.revision];delete queueActivations[e.revision];
    }
    if(['cancelled','superseded','stale'].indexOf(e.status)!==-1&&queueTokens[e.revision]&&
      (queueActivations[e.revision]==null||queueActivations[e.revision]===e.activation)){
      project.cancel(queueTokens[e.revision]);delete queueTokens[e.revision];delete queueRevisions[e.revision];delete queueActivations[e.revision];
      if(proposal&&proposal.revision===e.revision)proposal.status=e.status==='stale'?'superseded':e.status;
    }
    if(e.status==='stopped'||e.status==='ended'||e.status==='error'){
      project.stop();queueTokens={};queueRevisions={};queueActivations={};playingRevision=null;audioState.frame=0;
      if(e.status==='error')status(e.message||'Audio engine failed');
    }
    renderState();if(proposalStatus!==(proposal&&proposal.status))renderProposal();
    var v=snap().validated,cursor=$('.mw-playhead');
    if(v&&cursor){var inner=cursor.parentElement;cursor.style.left=(Math.max(0,audioState.frame||0)/(v.compiled.gb.totalFrames||1)*inner.clientWidth)+'px';}
    $('.mw-seek').value=String(audioState.frame||0);
  }
  function activate(revision,forcePlay){
    if(!revision)throw Error('Apply valid code before playing');
    var previous=Object.keys(queueTokens);
    // An Apply while musicPlay awaits initialization supersedes that start too.
    if(previous.length&&!playingRevision){resetAudio();forcePlay=true;previous=[];}
    previous.forEach(function(id){if(engine().musicCancel)engine().musicCancel(id);project.cancel(queueTokens[id]);});queueTokens={};queueRevisions={};queueActivations={};
    if(forcePlay||audioState.status==='playing'||audioState.status==='paused'){
      var owner=project,queued=check(project.queue(revision.id)),token=queued.pending.queueId;
      queueTokens[revision.id]=token;queueRevisions[revision.id]=revision;
      function rejected(error){
        if(project!==owner||queueTokens[revision.id]!==token)return;
        owner.cancel(token);delete queueTokens[revision.id];delete queueRevisions[revision.id];delete queueActivations[revision.id];
        if(proposal&&proposal.revision===revision.id)proposal.status='validated';
        try{if(forcePlay)resetAudio();else if(engine().musicCancel)engine().musicCancel(revision.id);}catch(_){}
        announceError(error);renderState();renderProposal();
      }
      try{
        var settings={revision:revision.id,baseRevision:snap().playing,boundaries:forcePlay?[]:boundaries(playingRevision||revision),loop:$('.mw-loop').checked};
        var result=forcePlay?engine().musicPlay(revision.compiled.gb,settings):engine().musicQueue(revision.compiled.gb,settings);
        if(result&&typeof result.then==='function')Promise.resolve(result).then(function(value){
          if(value===false||value&&value.ok===false)rejected(Error(value&&value.message||'Audio revision rejected'));
        },rejected);
        else if(result===false||result&&result.ok===false)throw Error(result&&result.message||'Audio revision rejected');
      }catch(e){rejected(e);throw e;}
    }
    renderState();
  }
  function applied(result){
    check(result);cancelChat('superseded');syncEditor();renderNotes();diagnostics(result.revision.compiled.diagnostics);scheduleSave();activate(result.revision,false);
    status(result.unchanged?'Source is already validated':'Validated '+result.revision.id);renderState();
  }
  function download(bytes,name,mime){
    var blob=new Blob([bytes],{type:mime||'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},4000);
  }
  function createSource(text,provenance){
    var next=api().create(text,Object.assign(opts(),{provenance:provenance}));
    if(!next.snapshot().validated)throw Error(next.snapshot().diagnostics.map(function(d){return d.message;}).join('\n'));
    cancelChat();resetAudio();project=next;selection=null;proposal=null;agentInstance=G.crypto.randomUUID();
    syncEditor();renderNotes();renderProposal();renderState();scheduleSave();
  }
  function generate(){
    var request=$('.mw-generate-text').value.trim();if(!request)throw Error('Describe the song to generate');
    var current=snap();
    if(current.validated&&current.draft!==current.validated.source&&!G.confirm('Replace the unfinished draft with a generated song? Download the project first to keep the draft.'))return;
    var token=Song.mint(),result=G.CT_API.ask(request,{brief:{token:token}});
    if(!result.ok)throw Error(result.error||'Could not interpret that musical request');
    var song=G.CT_CREATE.songOf(result.doc);
    var source=G.CT_MUSIC_LANGUAGE.materialize(song.gb,{title:song.title,tempo:song.bpm,bars:song.bars});
    if(snap().validated){
      check(project.editDraft(source));var revision=check(project.applyDraft());
      check(project.setProvenance({prompt:request,seed:token}));applied(revision);
    }
    else createSource(source,{prompt:request,seed:token});
    status('Generated once. '+(result.applied||[]).join('; '));selectView('code');
  }
  async function requestChat(){
    if(!chatUnlocked||chatAccessBusy||!chatProviders.some(function(p){return p.id===$('.mw-chat-provider').value;}))throw Error('Unlock chat and select an available provider.');
    client.provider=$('.mw-chat-provider').value;
    var s=snap(),text=$('.mw-chat-input').value.trim();if(!text)throw Error('Write a musical request');
    var capturedContext=agentContext();
    var owner=project,id='request-'+crypto.randomUUID(),req=check(project.beginRequest(id));requestId=id;
    proposal={id:id,status:'proposed',capturedContext:capturedContext};renderProposal();renderState();
    var tracks=+$('.mw-scope').value,constraints={locks:[]};
    if($('.mw-lock').value!=='none')constraints.locks.push({type:$('.mw-lock').value,tracks:[0]});
    if(/\bkeep (?:the )?melody\b/i.test(text)&&!constraints.locks.some(function(lock){return lock.type==='track';}))constraints.locks.push({type:'track',tracks:[0]});
    if(tracks>=0)constraints.scope={tracks:[tracks]};
    // This explicit intent is narrower than the default Whole song selector.
    if(tracks<0&&/\bsimplify\s+(?:the\s+)?drums\b/i.test(text)&&/\bkeep\s+(?:the\s+)?melody\b/i.test(text))constraints.scope={tracks:[3]};
    if($('.mw-region').checked&&selection)constraints.scope={tracks:[selection.ch],fromFrame:selection.fromFrame,toFrame:selection.toFrame};
    try{
      var response=await client.request({id:id,request:text,source:req.baseSource,baseRevision:req.baseRevision,selection:selection,
        constraints:constraints,language:{version:G.CT_MUSIC_LANGUAGE.VERSION,help:G.CT_MUSIC_CODE_EDITOR&&G.CT_MUSIC_CODE_EDITOR.help||{}},diagnostics:(s.diagnostics||[]).slice(0,32)});
      if(project!==owner||requestId!==id)return;
      if(invalidateAgent()){renderProposal();renderState();return;}
      if(response.id!==id)throw Error('Chat response belongs to another request');
      var validated=project.validateProposal({id:id,baseRevision:response.baseRevision,baseSource:req.baseSource,edits:response.edits},constraints);
      check(validated);
      proposal={id:id,status:'ready',capturedContext:capturedContext,explanation:response.explanation,edits:response.edits,diff:validated.diff};
    }catch(e){
      if(project!==owner||requestId!==id)return;
      if(e.code==='locked'){chatUnlocked=false;renderChatAccess(e.message);}
      owner.cancelRequest(id);proposal={status:'invalid',explanation:e.message};status(e.message);
    }
    finally{if(project===owner&&requestId===id){requestId=null;renderProposal();renderState();}}
  }
  function renderProposal(){
    invalidateAgent();
    var el=$('.mw-proposals');el.replaceChildren();if(!proposal)return;
    var box=document.createElement('div');box.className='mw-proposal';
    var title=document.createElement('b');title.textContent=proposal.status;box.appendChild(title);
    var p=document.createElement('p');p.textContent=proposal.explanation||'Requesting a musical edit…';box.appendChild(p);
    if(proposal.diff){var summary=document.createElement('p');summary.textContent=proposal.diff.summary;box.appendChild(summary);}
    (proposal.edits||[]).forEach(function(edit){
      var diff=document.createElement('pre'),source=snap().draft;
      diff.textContent='− '+source.slice(edit.from,edit.to)+'\n+ '+edit.text;box.appendChild(diff);
    });
    if(proposal.status==='ready'){
      var displayedProposal=proposal;
      ['Apply','Reject'].forEach(function(label){
        var b=document.createElement('button');b.type='button';b.textContent=label;
        b.addEventListener('click',function(){try{
          if(proposal!==displayedProposal)return;
          if(label==='Apply'){if(proposal.capturedContext&&(invalidateAgent()||proposal.status!=='ready'))throw Error('Proposal context changed; request a new proposal');var r=check(project.applyProposal(proposal.id));proposal.revision=r.revision.id;proposal.status='queued';applied(r);if(!snap().pending)proposal.status='validated';status(r.diff.summary);}
          else{project.cancelRequest(proposal.id);proposal.status='rejected';}
          renderProposal();
        }catch(e){proposal.status='superseded';announceError(e);renderProposal();}});
        box.appendChild(b);
      });
    }el.appendChild(box);
  }
  function build(){
    root=document.createElement('section');root.id='musicworkspace';root.hidden=true;root.setAttribute('aria-label','Create music workspace');
    root.innerHTML='<header class="mw-top"><h1>Create · Music workspace</h1><button data-action="close">Back</button></header>'+
      '<div class="mw-transport"><button data-action="play">▶ Play</button><button data-action="pause">Pause</button><button data-action="stop">■ Stop</button>'+
      '<label><input type="checkbox" class="mw-loop"> Audition loop</label><input class="mw-seek" type="range" min="0" max="0" value="0" aria-label="Seek frame">'+
      '<button class="mw-primary" data-action="apply">Apply code</button><button data-action="undo">Undo revision</button><button data-action="redo">Redo revision</button></div>'+
      '<div class="mw-state" aria-live="polite"></div>'+
      '<nav class="mw-tabs" role="tablist" aria-label="Workspace view"><button role="tab" data-view="notes">Notes</button><button role="tab" data-view="code">Code</button><button role="tab" class="mw-mobile-chat" data-view="chat">Chat</button></nav>'+
      '<div class="mw-body"><main class="mw-main"><div class="mw-selection">Notes show the validated revision. Select a note to locate its source.</div><div class="mw-mainview mw-notes"></div><div class="mw-mainview mw-code" hidden></div>'+
      '<div class="mw-diagnostics" role="status"></div><details class="mw-help"><summary>Music function help</summary><pre></pre></details></main>'+
      '<aside class="mw-chat" aria-label="Musical collaboration"><h2>Chat</h2><p class="mw-context"></p>'+
      '<section class="mw-connect" aria-label="Connect a music agent"><h2>Connect</h2>'+
      '<div class="mw-mcp-setup" hidden><p>Add this remote MCP server in your agent, sign in with the same account, then refresh clients. Authorizing a client does not share a song; Connect below does.</p><label>Remote MCP server<input class="mw-mcp-endpoint" type="text" readonly></label><button data-action="copy-mcp">Copy MCP endpoint</button></div>'+
      '<p class="mw-mcp-unavailable">Remote MCP setup requires the HTTPS gateway and an available connection API. It is unavailable on the Cloudflare site without that API. Sign in if prompted, then refresh clients.</p>'+
      '<p>Connecting uploads your current music source, selected region, and edit constraints to this service for the client you choose. Validated edits and context changes are shared while connected. Every proposal requires your explicit Apply.</p>'+
      '<label>Agent client<select class="mw-client"><option value="">Choose an authorized client</option></select></label><div class="mw-actions"><button data-action="refresh-clients">Refresh clients</button><button data-action="connect" disabled>Connect</button><button data-action="disconnect" disabled>Disconnect</button></div>'+
      '<p class="mw-connect-status" role="status">Connection unavailable in this build.</p><a class="mw-sign-in" href="/sign-in" hidden>Sign in to connect</a></section>'+
      '<label>Generate with the composer<input class="mw-generate-text" maxlength="500" placeholder="Make something happy"></label><button data-action="generate">Generate song</button>'+
      '<section class="mw-chat-access" aria-label="Built-in chat access"><h2>Built-in chat</h2><p>Use the owner password, not an API key. Request proposal sends your music source and request to the selected provider. Unlocking makes no model call.</p>'+
      '<label>Provider<select class="mw-chat-provider" aria-label="Chat provider"></select></label><label>Owner password<input class="mw-owner-password" type="password" autocomplete="off" maxlength="1024"></label>'+
      '<div class="mw-actions"><button data-action="chat-unlock">Unlock chat</button><button data-action="chat-logout" disabled>Lock chat</button><button data-action="chat-access-refresh">Refresh access</button></div><p class="mw-chat-access-status" role="status">Checking chat access…</p></section>'+
      '<label>Ask a musical agent<textarea class="mw-chat-input" maxlength="2000" placeholder="Simplify the drums, keep the melody"></textarea></label><small>Code and playback work without chat. Proposals require Apply.</small>'+
      '<label>Edit scope <select class="mw-scope"><option value="-1">Whole song</option><option value="0">Melody</option><option value="1">Harmony</option><option value="2">Bass</option><option value="3">Drums</option></select></label>'+
      '<label>Melody lock <select class="mw-lock"><option value="none">Unlocked</option><option value="track">Whole track</option><option value="pitchrhythm">Pitch and rhythm</option><option value="instrument">Instrument</option><option value="arrangement">Arrangement</option></select></label>'+
      '<label><input class="mw-region" type="checkbox"> Restrict to selected note region</label>'+
      '<div class="mw-actions"><button data-action="chat">Request proposal</button><button data-action="cancel">Cancel request</button></div><div class="mw-proposals" aria-live="polite"></div></aside></div>'+
      '<footer class="mw-actions"><button data-action="save">Save draft locally</button><button data-action="download">Download project</button><button data-action="open">Open project</button><button data-action="share">Copy project link</button>'+
      '<select class="mw-format" aria-label="Export format"><option value="wav">WAV</option><option value="midi">MIDI</option><option value="rom">Game Boy ROM</option><option value="lsdsng">LSDj</option></select><button data-action="export">Export validated revision</button><small class="mw-build"></small></footer>'+
      '<p class="mw-status" role="status" aria-live="polite"></p>';
    document.body.appendChild(root);
    $('.mw-build').textContent='Music v'+G.CT_MUSIC_LANGUAGE.VERSION+' · '+(G.CT_MUSIC_BUILD_VERSION||'development');
    root.addEventListener('keydown',function(e){
      if(e.defaultPrevented){e.stopPropagation();return;}
      if(e.key==='Tab'&&!e.defaultPrevented){
        var focusable=Array.from(root.querySelectorAll('button,input,select,textarea,a[href],[tabindex],[contenteditable=true],summary')).filter(function(el){
          return !el.disabled&&el.tabIndex>=0&&!el.closest('[hidden],[inert]')&&el.getClientRects().length>0;
        });
        var first=focusable[0],last=focusable[focusable.length-1];
        if(first&&((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last))){e.preventDefault();(e.shiftKey?last:first).focus();}
      }
      var tab=e.target.closest('[role=tab]');
      if(tab&&['ArrowLeft','ArrowRight','Home','End'].indexOf(e.key)!==-1){
        var tabs=Array.from(root.querySelectorAll('[role=tab]')).filter(function(el){return el.getClientRects().length>0;});
        var index=tabs.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        e.preventDefault();selectView(tabs[next].dataset.view,false);tabs[next].focus();
      }
      if(e.key==='Escape'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.stopImmediatePropagation();close();return;}
      if(e.code==='Space'&&!e.target.closest('input,textarea,select,button,[contenteditable=true]')){
        e.preventDefault();try{if(audioState.status==='playing')engine().musicPause(true);else if(snap().validated)activate(snap().validated,true);}catch(error){announceError(error);}
      }
      e.stopPropagation();
    });
    root.addEventListener('click',function(e){
      var tab=e.target.closest('button[data-view]');if(tab){selectView(tab.dataset.view);return;}
      var b=e.target.closest('[data-action]');if(!b)return;
      Promise.resolve().then(function(){return action(b.dataset.action);}).catch(announceError);
    });
    $('.mw-seek').addEventListener('change',function(){engine().musicSeek(+this.value);});
    $('.mw-client').addEventListener('change',function(){if(connection)renderConnection(connection.state());});
    ['.mw-scope','.mw-lock','.mw-region'].forEach(function(s){$(s).addEventListener('change',agentPolicyChanged);});
    G.addEventListener('storage',function(e){if(e.key===KEY&&root&&!root.hidden){conflict=true;invalidateAgent();renderProposal();renderState();status('Another tab changed this project. Download this draft before reloading.');}});
    G.addEventListener('beforeunload',function(e){if(conflict||saveTimer||unsaved){save();e.preventDefault();e.returnValue='';}});
  }
  async function action(name){
    if(name==='chat-unlock')await updateChatAccess('POST');
    else if(name==='chat-logout')await updateChatAccess('DELETE');
    else if(name==='chat-access-refresh')await updateChatAccess('GET');
    else if(name==='copy-mcp'){
      if(!connection||!connection.state().available||location.protocol!=='https:')throw Error('MCP endpoint unavailable');
      await navigator.clipboard.writeText(location.origin+'/api/mcp');status('Copied remote MCP endpoint. Add it in your agent, then refresh clients.');
    }
    else if(name==='connect'){if(connection)await connection.connect($('.mw-client').value);}
    else if(name==='disconnect'){if(connection)connection.disconnect();}
    else if(name==='refresh-clients'){if(connection)await connection.refresh();}
    else if(name==='apply'){var r=project.applyDraft();diagnostics(r.diagnostics);applied(r);}
    else if(name==='undo'||name==='redo')applied(project[name]());
    else if(name==='play'){var v=snap().validated;if(v)activate(v,true);}
    else if(name==='pause')engine().musicPause(audioState.status!=='paused');
    else if(name==='stop'){resetAudio();renderState();}
    else if(name==='close')close();
    else if(name==='generate')generate();
    else if(name==='chat')await requestChat();
    else if(name==='cancel'){cancelChat('rejected');proposal={status:'rejected',explanation:'Request cancelled'};renderProposal();renderState();}
    else if(name==='save')await save();
    else if(name==='download')download(project.serialize({includePrivate:true}),'chiptunes-project.json','application/json');
    else if(name==='share'){
      var text=project.serialize(),bytes=new TextEncoder().encode(text);
      if(bytes.length>12000)throw Error('Project is too large for a self-contained link. Download a project file.');
      var binary='';bytes.forEach(function(b){binary+=String.fromCharCode(b);});
      var link=location.origin+'/create#music='+encodeURIComponent(btoa(binary));
      await navigator.clipboard.writeText(link);status('Copied project link. Chat and private provenance excluded; opening does not play.');
    }else if(name==='open'){
      var input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.onchange=async function(){try{
        var owner=project,file=input.files[0];if(!file)return;if(file.size>8388608)throw Error('Project file is too large');
        var loaded=check(api().restore(await file.text(),opts()));
        if(project!==owner||root.hidden)return;
        if(!G.confirm('Replace this workspace? Download the current project first to keep a copy.'))return;
        cancelChat();resetAudio();project=loaded.project;selection=null;proposal=null;agentInstance=G.crypto.randomUUID();
        syncEditor();renderNotes();renderProposal();renderState();diagnostics(snap().diagnostics);scheduleSave();
      }catch(e){announceError(e);}};input.click();
    }else if(name==='export'){
      var v=snap().validated;if(!v)throw Error('Apply valid code before exporting');
      var format=$('.mw-format').value,report=G.CT_MUSIC_EXPORTS.inspect(v.compiled,format);
      if(!report.ok)throw Error((report.errors||report.losses||[]).join('\n')||'This revision cannot be exported to '+format);
      var allowLosses=false;
      if(report.losses&&report.losses.length){allowLosses=G.confirm(report.losses.join('\n')+'\nExport with these limitations?');if(!allowLosses)return;}
      status('Rendering '+v.id+'…');
      var output=await G.CT_MUSIC_EXPORTS.exportRevision(Object.assign({validated:true},v),format,{allowLosses:allowLosses});
      download(output.bytes,output.name,output.mime);status('Exported validated '+v.id+(output.warnings&&output.warnings.length?' · '+output.warnings.join('; '):''));
    }
  }
  async function open(initial){
    if(!root)build();
    if(!root.hidden)return;
    previousFocus=document.activeElement;
    previousRoute=location.pathname+location.search+location.hash;
    if(!project){
      client=new G.CT_MUSIC_CHAT.Client();
      try{
        storage=api().createStorageAdapter(localStorage,KEY);var saved=storage.load();
        if(!saved.ok)throw Error(saved.message||'Storage unavailable');
        // Legacy entry supplies the current radio song as a fallback, not an
        // explicit import. Recovery wins; #music and file imports override below.
        if(saved.serialized){var restored=api().restore(saved.serialized,opts());if(restored.ok)project=restored.project;else{conflict=true;status(restored.message+' · Original saved project preserved');}}
      }catch(e){storage=null;status('Local storage unavailable. Download a project file to keep your work.');}
      if(!project){
        var initialSettings=Object.assign({},initial&&initial.settings||{});
        if(initialSettings.stepsPerBar==null&&initialSettings.grid!=null)initialSettings.stepsPerBar=initialSettings.grid;
        var source=initial?G.CT_MUSIC_LANGUAGE.materialize(initial.gb,initialSettings):'song({tempo:128,bars:4})\n\n// Write patterns here, or generate a song from Chat.\n';
        project=api().create(source,opts());unsaved=true;
      }
      var shared=location.hash.match(/^#music=(.+)$/);
      if(shared){try{
        if(shared[1].length>20000)throw Error('Share is too large');
        var decoded=atob(decodeURIComponent(shared[1])),bytes=Uint8Array.from(decoded,function(c){return c.charCodeAt(0);});
        var imported=check(api().restore(new TextDecoder().decode(bytes),opts()));project=imported.project;unsaved=true;
        if(saved&&saved.serialized){conflict=true;status('Shared project opened separately. Your existing local draft is preserved; download this project to keep it.');}
      }catch(e){announceError(e);}}
    }
    if(G.CT_CREATE.stopForNative)G.CT_CREATE.stopForNative();engine().enterCreate();
    if(!/^#music(?:=|$)/.test(location.hash))history.replaceState(null,'','/create#music');
    agentInstance=G.crypto.randomUUID();root.hidden=false;inerted=[];
    if(!chatAccess)chatAccess=new G.CT_MUSIC_CHAT.Access();
    chatUnlocked=false;updateChatAccess('GET');
    if(!connection&&G.CT_MUSIC_AGENT_CONNECTION)connection=G.CT_MUSIC_AGENT_CONNECTION.create({workspace:G.CT_MUSIC_WORKSPACE,onChange:renderConnection});
    if(connection)connection.open();
    Array.from(document.body.children).forEach(function(el){if(el!==root&&!el.hasAttribute('inert')){el.setAttribute('inert','');inerted.push(el);}});
    if(!unsub)unsub=engine().onMusicState(onAudio);
    renderNotes();renderProposal();renderState();diagnostics(snap().diagnostics);selectView(view);
    $('[data-action=play]').focus();
    await ensureEditor();syncEditor();if(unsaved&&!conflict)scheduleSave();
  }
  function close(){
    if(!root||root.hidden)return;
    chatAccessEpoch++;chatAccessBusy=false;chatUnlocked=false;$('.mw-owner-password').value='';if(chatAccess)chatAccess.cancel();
    if(connection)connection.close();
    save();cancelChat('superseded');try{resetAudio();}catch(e){announceError(e);}
    root.hidden=true;inerted.forEach(function(el){el.removeAttribute('inert');});inerted=[];
    if(previousRoute)history.replaceState(null,'',previousRoute);
    if(unsub){unsub();unsub=null;}
    if(previousFocus&&previousFocus.isConnected)previousFocus.focus();
  }
  G.CT_MUSIC_WORKSPACE={open:open,close:close,isOpen:function(){return !!root&&!root.hidden;},snapshot:function(){return project&&snap();},
    agentContext:agentContext,agentPropose:agentPropose,agentProposalStatus:agentProposalStatus,agentDisconnect:agentDisconnect};
})(typeof globalThis!=='undefined'?globalThis:window);
