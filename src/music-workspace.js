// One source authority. Notes and exports use validated revisions; typing never
// changes audio. Legacy and native editors retain their own document boundaries.
(function(G){
  'use strict';
  var root,editor,project,storage,client,sourceLoading=false,saveTimer,queueTokens={},queueRevisions={},queueActivations={},playingRevision=null,audioState={status:'stopped',frame:0};
  var selection=null,proposal=null,requestId=null,serial=0,previousFocus,inerted=[],conflict=false,unsub=null;
  var unsaved=false,saveEpoch=0,editorLoading=null,previousRoute=null,openEpoch=0,fileImportSerial=0;
  var agentInstance=null,agentRecords=new Map(),policyEpoch=0;
  var connection=null;
  var chatUI=null,chatLoading=null,chatDraft='',chatAccessMessage='Checking chat access…',chatUISignature=null;
  var viewEpoch=0,chatFocus=null,desktopChatOpen=true,mobileChatOpen=false,chartShare=55,musicShare=62;
  var soundingIndex=null,lastHighlight=null;
  var preview=null,previewChart=null,previewOwner=null,previewStatus='Validated chart';
  var chartIndex=null,chartRange=null,chartViewportKey='',chartRenderFrame=null;
  var inlineContext=null;
  var codeProject=null,codeProjectId=0;
  var CHART_GUTTER=68,NOTE_ROW=14,LANE_HEADER=25;
  var visualizerOpen=false,presentationOwner=null,presentationFocus=null,stageError='';
  var visualEditor=null,visualEditorLoading=false,visualControlSignature='',visualRenderQueued=false;
  // Restoring a saved visual is not a user edit and must not mark the project
  // unsaved, or opening a project would immediately dirty it.
  var visualRestoring=false;
  // The stage boots into its default scene before a project's saved visual can
  // be handed to it. Until that handover happens the stage's state says nothing
  // about this project, and treating it as an edit would erase the saved
  // visual on every reload.
  // Ownership, not a boolean: this is the exact project the stage was last
  // handed over to. project is reassigned on several paths (file import,
  // transfer accept, new loop, generate) and any path that does NOT re-run the
  // handover leaves owner !== project, which makes it read-only by default
  // rather than writing one project's visuals into another.
  var visualOwner=null;
  // A saved visual that could not be restored must never be erased by the
  // fallback default that replaced it. While this is set, "the stage is at its
  // default" means "nothing to say", not "delete what is stored".
  var visualRestoreFailed=false;
  function visualAdapter(){return G.CT_CREATE_PRESENTATION;}
  function renderVisualEditor(state){
    $('.mw-visual-authoring').hidden=!state;
    $('.mw-visual-performance').hidden=!state;
    if(!state)return;
    if(visualEditor&&visualEditor.value()!==state.draft){visualEditorLoading=true;visualEditor.set(state.draft);visualEditorLoading=false;}
    if(visualEditor)visualEditor.diagnostics((state.diagnostics||[]).map(function(d){return {
      from:d.span&&d.span.start?d.span.start.offset:0,to:d.span&&d.span.end?d.span.end.offset:0,message:d.message,severity:d.severity};}));
    $('[data-action=visual-cancel]').hidden=!state.pending;
    $('[data-action=visual-apply]').textContent=state.pending?'Replace queued visual':'Apply visuals';
    $('[data-action=visual-freeze]').textContent=state.frozen?'Unfreeze':'Freeze';
    $('[data-action=visual-freeze]').setAttribute('aria-pressed',String(state.frozen));
    $('[data-action=visual-blackout]').setAttribute('aria-pressed',String(state.blackout));
    var signature=JSON.stringify(state.controls.map(function(c){return [c.name,c.label,c.min,c.max,c.step];}));
    if(signature!==visualControlSignature){
      visualControlSignature=signature;var host=$('.mw-visual-parameters');host.replaceChildren();
      state.controls.forEach(function(c){
        var label=document.createElement('label'),title=document.createElement('span'),value=document.createElement('output'),input=document.createElement('input');
        title.textContent=c.label;value.dataset.controlOutput=c.name;input.type='range';input.min=c.min;input.max=c.max;input.step=c.step;
        input.dataset.visualControl=c.name;input.setAttribute('aria-label',c.label+' (visual)');
        label.append(title,value,input);host.appendChild(label);
        input.addEventListener('input',function(){try{visualAdapter().setVisualControl(c.name,+this.value);}catch(e){status(e.message);}});
      });
    }
    state.controls.forEach(function(c){
      var input=root.querySelector('[data-visual-control="'+c.name+'"]'),output=root.querySelector('[data-control-output="'+c.name+'"]');
      input.value=c.value;output.value=String(Math.round(c.value*1000)/1000);
    });
    $('.mw-visual-code-disclosure').hidden=state.draftScene.indexOf('visual:')!==0;
  }
  function ensureVisualEditor(){
    if(visualEditor||!G.CT_MUSIC_CODE_EDITOR)return;
    var state=visualAdapter().snapshot().visual;if(!state)return;
    visualEditor=G.CT_MUSIC_CODE_EDITOR.mount($('.mw-visual-code'),state.draft,function(source){
      if(!visualEditorLoading)try{visualAdapter().setVisualDraft(source);}catch(e){status(e.message);}
    },{dialect:'visual',onLimit:status});
  }
  function renderStage(){
    if(!root)return;
    var adapter=G.CT_CREATE_PRESENTATION,scene=$('.mw-scene'),state=adapter&&adapter.snapshot&&adapter.snapshot();
    if(state&&state.mounted){
      var options=[{id:'off',label:'Off'}].concat(state.scenes||[]);
      if(state.visual&&state.visual.draftScene==='visual:custom')options.push({id:'visual:custom',label:'Custom visual'});
      if(Array.from(scene.options).map(function(o){return o.value;}).join(',')!==options.map(function(o){return o.id;}).join(',')){
        scene.replaceChildren();options.forEach(function(item){var option=document.createElement('option');option.value=item.id;option.textContent=item.label;scene.appendChild(option);});
      }
      scene.value=state.visual?state.visual.draftScene:state.enabled?state.scene:'off';scene.disabled=false;
      $('.mw-stage-empty').hidden=!!state.enabled;
      $('.mw-stage-empty').textContent='Visuals off';
      $('.mw-visuals').dataset.enabled=String(!!state.enabled);
      $('.mw-stage-status').textContent=!state.enabled?'Visuals off · music is independent':audioState.status==='playing'?'Following live music':audioState.status==='paused'?'Music paused':'Ready · Run your music to drive this scene';
      if(state.visual){
        var v=state.visual,liveLabel=options.find(function(o){return o.id===state.scene;});
        var pendingLabel=v.pending?'Queued '+v.pending.label+' · bar '+v.pending.bar:'';
        $('.mw-stage-status').textContent=(v.error?'Error · '+v.error+' · Last working visual retained.'+(pendingLabel?' · '+pendingLabel:''):pendingLabel|| (v.state==='draft'?'Draft · Apply visuals to update the stage':v.notice||'Live · '+(liveLabel?liveLabel.label:'Custom visual')+(v.edited?' (edited)':'')))+(v.frozen?' · Frozen':'')+(v.blackout?' · Blackout':'');
        $('.mw-stage-status').dataset.state=v.state;
      }
      renderVisualEditor(state.visual);
    }else{
      scene.disabled=true;$('.mw-stage-empty').hidden=false;
      $('.mw-stage-empty').textContent='Visual stage unavailable';
      $('.mw-stage-status').textContent=stageError||'Code, notes and playback are still available.';
    }
    $('[data-action=visualizer]').disabled=!(state&&state.mounted);
    $('[data-action=stage-fullscreen]').disabled=!(state&&state.mounted);
  }
  function mountStage(){
    try{
      stageError='';
      if(G.CT_CREATE_PRESENTATION&&G.CT_CREATE_PRESENTATION.mount)G.CT_CREATE_PRESENTATION.mount($('.mw-stage-viewport'));
    }catch(e){stageError='Visual stage could not start. Music remains available.';}
    renderStage();
  }
  function fullscreenStage(){
    var host=$('.mw-stage-viewport'),request=host.requestFullscreen||host.webkitRequestFullscreen;
    if(!request){status('Fullscreen is unavailable in this browser. Use Focus visuals to enlarge the stage.');return;}
    // Called directly from the click to preserve browser user activation.
    try{var result=request.call(host);if(result&&result.catch)result.catch(function(){status('Fullscreen was declined. The stage and music are unchanged.');});}
    catch(e){status('Fullscreen was declined. The stage and music are unchanged.');}
  }
  function setVisualizer(visible){
    if(!G.CT_CREATE_PRESENTATION||!G.CT_CREATE_PRESENTATION.snapshot||!G.CT_CREATE_PRESENTATION.snapshot().mounted){status('Visualizer is unavailable in this build.');return;}
    if(visible&&!visualizerOpen)presentationFocus=document.activeElement;
    visualizerOpen=!!visible;presentationOwner=visible?project:null;
    root.dataset.presentation=visible?'visualizer':'composition';
    var button=$('[data-action=visualizer]');button.textContent=visible?'Return to composition':'Focus visuals';button.setAttribute('aria-pressed',String(visible));
    // Presentation changes only layout. The same stage stays mounted and music
    // keeps its acknowledged phase; private chat is never part of output.
    $('.mw-main').inert=!!visible;$('.mw-chat').inert=!!visible;
    if(visible)button.focus({preventScroll:true});
    if(!visible&&project)renderNotes();
    if(!visible&&presentationFocus&&presentationFocus.isConnected&&presentationFocus.getClientRects().length)presentationFocus.focus({preventScroll:true});
  }
  function chartContext(s){s=s||snap();return previewOwner===project&&previewChart&&(!s.validated||s.draft!==s.validated.source)?previewChart:s.validated;}
  function cancelPreview(){if(preview)preview.cancel();previewChart=null;previewOwner=null;previewStatus='Validated chart';}
  function schedulePreview(){
    var s=snap();
    if(s.validated&&s.draft===s.validated.source){cancelPreview();renderNotes();diagnostics(s.diagnostics);return;}
    if(!G.CT_MUSIC_PREVIEW){previewStatus='Previous chart · preview unavailable';return;}
    if(!preview)preview=G.CT_MUSIC_PREVIEW.create({workerUrl:'/lib/music-preview-worker.js?v='+(G.CT_MUSIC_PREVIEW_VERSION||'0'),
      onPending:function(){previewStatus='Previous chart · preview pending';$('.mw-chart-status').textContent=previewStatus;},
      onResult:function(result){
        var current=snap();if(root.hidden||result.projectId!==agentInstance||result.draftEpoch!==current.draftEpoch||result.source!==current.draft)return;
        if(result.compiled.gb){previewOwner=project;previewChart={id:'preview-'+result.sequence,source:result.source,compiled:result.compiled};previewStatus='Draft preview · not applied';}
        else previewStatus='Previous chart · draft has errors';
        diagnostics(result.compiled.diagnostics);renderNotes();renderState();
      },
      onError:function(result){if(root.hidden||result.projectId!==agentInstance)return;previewStatus=result.message;$('.mw-chart-status').textContent=previewStatus;}
    });
    preview.schedule({source:s.draft,projectId:agentInstance,draftEpoch:s.draftEpoch});
  }
  var mobileView=G.matchMedia('(max-width:1499px)');
  var outboundTransfer=null,inboundTransfer=null,transferProtected=false,transferBase=null;
  function sendProject(){
    var transport=G.CT_MUSIC_PROJECT_TRANSFER;
    if(!transport||location.origin!==transport.SENDER_ORIGIN)return;
    if(outboundTransfer)outboundTransfer.cancel();
    // Must stay synchronous inside the real click, before the action Promise.
    var sent=outboundTransfer=transport.send(project.serialize());
    status('Web Chat opened. Accept the copy in the new window.');
    sent.result.then(function(result){if(outboundTransfer!==sent)return;outboundTransfer=null;
      status(result.ok?'Project sent. Review it in web Chat. Original remains here.':'Project transfer ended ('+result.code+'). Your original project is unchanged.');});
  }
  function stageTransfer(received){
    inboundTransfer=received;$('.mw-transfer-offer').hidden=false;
    transferBase={owner:project,epoch:snap().draftEpoch,instance:agentInstance};
    $('[data-action=transfer-cancel]').textContent='Cancel';
    $('.mw-transfer-description').textContent='Waiting for the project offer…';
    $('[data-action=transfer-accept]').disabled=true;
    received.offer.then(function(offer){
      if(inboundTransfer!==received)return;
      if(!offer.ok){$('.mw-transfer-description').textContent='Transfer ended ('+offer.code+').';return;}
      $('.mw-transfer-description').textContent='Accept '+offer.bytes+' bytes from chiptunes.app? This copies the draft and last validated revision, without private chat or provenance. Your hosted saved project stays intact. Download the copy to keep it, or use Save draft locally to explicitly replace the hosted saved project.';
      $('[data-action=transfer-accept]').disabled=false;
    });
    received.result.then(function(result){if(inboundTransfer===received&&!result.ok){inboundTransfer=null;
      $('.mw-transfer-description').textContent='Transfer ended ('+result.code+'). Your hosted project is unchanged.';
      $('[data-action=transfer-accept]').disabled=true;}});
  }
  async function acceptTransfer(){
    var received=inboundTransfer;if(!received||$('[data-action=transfer-accept]').disabled)return;
    var owner=transferBase.owner,epoch=transferBase.epoch,instance=transferBase.instance;
    if(project!==owner||snap().draftEpoch!==epoch||agentInstance!==instance){
      received.cancel();inboundTransfer=null;$('.mw-transfer-description').textContent='Workspace changed while the offer was open. Import cancelled; your edits are kept. Send a fresh copy.';return;
    }
    $('[data-action=transfer-accept]').disabled=true;
    if(unsaved){
      await save();
      if(inboundTransfer!==received||root.hidden)return;
      if(unsaved||project!==owner||snap().draftEpoch!==epoch||agentInstance!==instance){
        received.cancel();inboundTransfer=null;$('.mw-transfer-description').textContent='Hosted edits could not be saved safely. Import cancelled; download or save your current project first.';return;
      }
    }
    var result=await received.accept();
    if(inboundTransfer!==received||root.hidden)return;
    inboundTransfer=null;
    if(!result.ok)return;
    if(project!==owner||snap().draftEpoch!==epoch||agentInstance!==instance){$('.mw-transfer-description').textContent='Workspace changed during transfer. Import cancelled; send a fresh copy.';return;}
    // Restore only after explicit Accept; never route through applied()/play.
    var loaded=api().restore(result.serialized,opts());
    if(!loaded.ok){$('.mw-transfer-description').textContent='Project is incompatible. Hosted project unchanged.';return;}
    clearTimeout(saveTimer);saveTimer=null;saveEpoch++;transferProtected=true;
    if(connection)connection.disconnect();cancelChat('superseded');resetAudio();
    project=loaded.project;selection=null;proposal=null;agentInstance=G.crypto.randomUUID();unsaved=true;
    restoreProjectVisuals();
    defaultProjectLoop();
    syncEditor();renderNotes();renderProposal();renderState();diagnostics(snap().diagnostics);
    $('.mw-transfer-description').textContent='Project accepted as a temporary copy. Hosted saved project preserved. Download to keep your edits, or choose Save draft locally and confirm replacement. Apply and playback remain explicit.';
    $('[data-action=transfer-cancel]').textContent='Dismiss';
    status('Transferred draft and last validated revision restored. Nothing was applied or played.');
  }
  var chatAccess=null,chatAccessEpoch=0,chatUnlocked=false,chatAccessBusy=false,chatProviders=[];
  function renderChatAccess(message){
    var select=$('.mw-chat-provider'),chosen=select.value;
    if(Array.from(select.options).map(function(o){return o.value;}).join(',')!==chatProviders.map(function(p){return p.id;}).join(',')){
      select.replaceChildren();
      chatProviders.forEach(function(p){var option=document.createElement('option');option.value=p.id;option.textContent=p.id==='openai'?'OpenAI':'Claude';select.appendChild(option);});
      if(chatProviders.some(function(p){return p.id===chosen;}))select.value=chosen;
    }
    select.disabled=chatAccessBusy||!!requestId||!chatProviders.length;
    $('[data-action=chat-unlock]').disabled=chatAccessBusy||chatUnlocked;
    $('[data-action=chat-logout]').disabled=chatAccessBusy||!chatUnlocked;
    $('[data-action=chat-access-refresh]').disabled=chatAccessBusy;
    $('.mw-owner-password').disabled=chatAccessBusy||chatUnlocked;
    if(message){chatAccessMessage=message;$('.mw-settings-status').textContent=message;}
    renderChatUI();
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
      renderChatAccess(!chatProviders.length?'Chat providers are unavailable.':(chatUnlocked?'Unlocked.':'Locked. Open Settings to unlock.')+' Daily limit: '+result.limits.dailyCalls+' calls.');
    }catch(e){if(run!==chatAccessEpoch)return;chatUnlocked=false;renderChatAccess(e.name==='SyntaxError'?'Chat is unavailable on this server. Code and playback still work.':e.message);}
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
  var KEY='ct-music-workspace-v1',ASSETS=G.CT_MUSIC_ASSETS_VERSION||'ct-gb-bank-1',view='code';
  var LOOP_SOURCE=[
    '// A four-bar loop. Edit a pattern, then Run (Cmd/Ctrl+Enter).',
    '// A dot is a rest. Eight steps make one bar; repeat fills four bars.',
    'song({tempo:128, bars:4})',
    '',
    'pattern("lead", notes("C4 . E4 . G4 . E4 .").stepsPerBar(8).gate(0.5))',
    'pattern("bass", notes("C2 C2 . C2 G2 . C2 .").stepsPerBar(8).gate(0.65))',
    'pattern("beat", notes("C2 . C2 . C2 . C2 .").stepsPerBar(8).gate(0.15))',
    '',
    '// Pulse, triangle bass, and a noise tick: the existing chip voices.',
    'track("lead").instrument("p0").play("lead", {repeat:4})',
    'track("bass").instrument("wave-bass").play("bass", {repeat:4})',
    'track("drums").instrument("n-tick").play("beat", {repeat:4})',
    '',
    '// Loop repeats the audition only. Downloads and exports stay finite.',
    ''
  ].join('\n');
  function loopProject(){
    var next=api().create(LOOP_SOURCE,opts());
    if(!next.snapshot().validated)throw Error('Starter loop could not compile. Current project kept.');
    return next;
  }
  function defaultProjectLoop(){
    var v=snap().validated,m=v&&v.compiled.mapping;
    $('.mw-loop').checked=!!(m&&m.length&&m.every(function(note){return !!note.pattern;}));
  }
  function newLoop(){
    var next=loopProject(); // Validate before offering to replace anything.
    if(project&&!G.confirm('Replace this workspace with a new loop? Download the current project first to keep its source and unfinished edits. The new loop will replace the local save when saving is available.'))return;
    if(outboundTransfer)outboundTransfer.cancel();outboundTransfer=null;
    if(inboundTransfer)inboundTransfer.cancel();inboundTransfer=null;$('.mw-transfer-offer').hidden=true;
    if(connection)connection.disconnect();cancelChat('superseded');resetAudio();
    project=next;selection=null;proposal=null;agentInstance=G.crypto.randomUUID();
    restoreProjectVisuals();
    $('.mw-loop').checked=true;
    syncEditor();renderNotes();renderProposal();renderState();diagnostics(snap().diagnostics);selectView('code');scheduleSave();
    status('New four-bar loop. Edit the patterns, then Run to hear it.');
  }
  function runDraft(){
    var start=audioState.status!=='playing'&&audioState.status!=='paused';
    var result=project.applyDraft();diagnostics(result.diagnostics);applied(result);
    if(start)activate(result.revision,true);
  }
  async function loadCycleExample(){
    var owner=project,epoch=openEpoch,draft=snap().draft,steps=G.CT_MUSIC_CYCLE_EXAMPLES&&G.CT_MUSIC_CYCLE_EXAMPLES.steps;
    var step=steps&&steps.find(function(item){return item.id===$('.mw-live-step').value;});
    if(!step)throw Error('Live-set example is unavailable in this build.');
    await ensureEditor();
    // Editor loading may outlive this project or a user's more recent edit.
    if(root.hidden||project!==owner||openEpoch!==epoch||snap().draft!==draft)return;
    editor.replaceDraft(step.source); // One undoable edit, same project/player.
    status(step.title+' loaded into code. Draft only; Run to hear it. Cmd/Ctrl-Z restores your previous code.');
  }
  function scheduledNoteLanes(gb,mapping){
    // Match the shared sequencer's off-before-on ordering, including an old
    // overlapping note's off cutting a newer voice. Pitch-only native rows
    // inherit the channel's current state; they cannot revive a killed voice.
    // This is scheduled note activity, not an amplitude/envelope meter.
    var lanes=[[],[],[],[]],active=[null,null,null,null],events=[],off=G.CT_GB.noteOffFrames(gb.notes),unmapped=[false,false,!!(gb.kit&&gb.kit.length),false];
    gb.notes.forEach(function(n,index){
      events.push({frame:n.frame,type:1,ch:n.ch,note:n,index:index});
      if(off[index]!=null)events.push({frame:off[index],type:0,ch:n.ch});
    });
    // Raw register writes have no pitch-token identity or lifetime. In
    // particular DAC/power-off can outlive later mapped triggers. Omit token
    // attribution for affected channels, rather than simulate a second APU.
    (gb.auto||[]).forEach(function(a){
      var ch=a.r>=0x10&&a.r<=0x14?0:a.r>=0x16&&a.r<=0x19?1:a.r>=0x1a&&a.r<=0x1e?2:a.r>=0x20&&a.r<=0x23?3:null;
      if(ch!==null)unmapped[ch]=true;
      else if(a.r>=0x24&&a.r<=0x26)unmapped=[true,true,true,true];
      else if(a.r>=0x30&&a.r<=0x3f)unmapped[2]=true;
    });
    events.sort(function(a,b){return a.frame-b.frame||a.type-b.type;});
    events.forEach(function(e){
      var ch=e.ch,n=e.note;
      // Kits can retrigger wave RAM between score frames, including after a
      // mapped note. Without sample ownership mappings the whole wave lane is
      // intentionally unattributed; do not approximate another audio engine.
      if(e.type!==1||unmapped[ch])active[ch]=null;
      else if(n.trigger===false&&ch<2){if(active[ch]!==null)active[ch]=e.index;}
      else{
        // Generic velocity has a 35% floor. Ask the shared register encoder,
        // rather than incorrectly treating vel:0 as a mute.
        var registers=G.CT_GB.noteRegisters(n,gb.bank);
        active[ch]=(ch===2?registers[1]&0x60:registers[1]&0xf8)?e.index:null;
      }
      var index=active[ch],item={frame:e.frame,index:index,span:index===null?null:mapping.get(index)},lane=lanes[ch];
      if(lane.length&&lane[lane.length-1].frame===e.frame)lane[lane.length-1]=item;else lane.push(item);
    });
    return lanes;
  }
  function renderPosition(s){
    var text='Stopped · Run to hear your code',beat=null;
    var spans=[],soundingNotes=[];
    if(playingRevision&&s.playing){
      if(!soundingIndex||soundingIndex.revision!==playingRevision){
        var mapping=new Map();playingRevision.compiled.mapping.forEach(function(m){mapping.set(m.noteIndex,m.tokenSpan||m.span);});
        var soundingClock=null;try{soundingClock=G.CT_MUSIC_LANGUAGE.createClock(playingRevision.compiled.settings||{});}catch(_){}
        soundingIndex={revision:playingRevision,clock:soundingClock,lanes:scheduledNoteLanes(playingRevision.compiled.gb,mapping)};
      }
      var clock=soundingIndex.clock,frame=Math.max(0,audioState.frame||0);
      var position='Frame '+Math.floor(frame);
      if(clock)try{
        var lo=0,hi=262144;
        while(lo<hi){var mid=Math.ceil((lo+hi)/2),at=clock(mid);if(!Number.isFinite(at))throw Error('Invalid clock');if(at<=frame)lo=mid;else hi=mid-1;}
        beat=lo%4;position='Bar '+(Math.floor(lo/4)+1)+' · Beat '+(beat+1)+'/4';
      }catch(_){soundingIndex.clock=null;}
      text=(audioState.suspended?'Audio suspended':audioState.status==='paused'?'Paused':'Sounding')+' '+s.playing+' · '+position;
      if(audioState.status==='playing'&&!audioState.suspended){
        soundingIndex.lanes.forEach(function(lane){
          var low=0,high=lane.length;
          while(low<high){var mid=(low+high)>>1;if(lane[mid].frame<=frame)low=mid+1;else high=mid;}
          var note=lane[low-1];if(note&&note.index!==null){
            soundingNotes.push(note.index);
            if(s.draft===playingRevision.source&&note.span)spans.push({from:note.span.start.offset,to:note.span.end.offset});
          }
        });
      }
    }else if(s.pending)text='Preparing first sound…';
    else soundingIndex=null;
    if(editor&&typeof editor.highlightPlaying==='function'){
      var signature=JSON.stringify(spans);if(signature!==lastHighlight){editor.highlightPlaying(spans);lastHighlight=signature;}
    }
    var chart=chartContext(s),chartPlaying=chart&&playingRevision&&chart.source===playingRevision.source;
    $('.mw-notes').querySelectorAll('.mw-note').forEach(function(el){
      el.classList.toggle('mw-note-sounding',!!chartPlaying&&soundingNotes.includes(Number(el.dataset.note)));
    });
    if(editor&&editor.setPatternPlayback)editor.setPatternPlayback({source:playingRevision&&playingRevision.source,frame:audioState.frame||0,
      playing:!!s.playing&&audioState.status==='playing'&&!audioState.suspended,noteIndices:soundingNotes});
    var overviewCursor=$('.mw-overview-playhead');
    if(overviewCursor){overviewCursor.hidden=!chartPlaying;overviewCursor.style.left=(chartPlaying?Math.max(0,Math.min(100,(audioState.frame||0)/(chart.compiled.gb.totalFrames||1)*100)):0)+'%';}
    if($('.mw-position').textContent!==text)$('.mw-position').textContent=text;
    root.dataset.beat=beat==null?'':String(beat);
    root.dataset.sounding=String(!!s.playing&&audioState.status==='playing'&&!audioState.suspended);
  }
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
  // The stage owns live visual state; the project record only carries it. A
  // session that never opened visuals contributes nothing and clears nothing.
  function captureVisual(p){
    try{
      var a=visualAdapter();
      // Only the project the stage was actually handed over to may be written.
      if(!p||p!==visualOwner||!a||typeof a.serializeVisuals!=='function')return;
      var next=a.serializeVisuals()||null;
      // null clears a stale visual when the user really did return to the
      // default, but never when the saved one simply failed to restore.
      if(next===null&&visualRestoreFailed)return;
      p.setVisual(next);
    }catch(e){/* visuals must never block a music save */}
  }
  // The stage emits state for many reasons that are not composition edits
  // (mounting, focus, scaling, renderer notices). Saving on all of them would
  // rewrite a project record merely because it was opened, so compare against
  // what the project already holds and save only a real difference.
  function visualChanged(){
    if(visualRestoring||!project||project!==visualOwner||transferProtected)return;
    try{
      var a=visualAdapter();
      if(!a||typeof a.serializeVisuals!=='function')return;
      var next=a.serializeVisuals()||null;
      // A default stage after a failed restore is not an instruction to delete
      // the visual that failed; only a real authored change is.
      if(next===null&&visualRestoreFailed)return;
      if(JSON.stringify(next)===JSON.stringify(project.visual||null))return;
      // The user authored something, so the stage is authoritative again.
      if(next!==null)visualRestoreFailed=false;
      project.setVisual(next);scheduleSave();
    }catch(e){/* visuals must never block music editing */}
  }
  // Hand this project's saved visual to the stage and record that the stage now
  // represents it. Called on every path that replaces `project`.
  function restoreProjectVisuals(){
    visualOwner=null;visualRestoreFailed=false;
    try{
      var a=visualAdapter();
      if(!project||!a||typeof a.restoreVisuals!=='function')return;
      var ok;
      visualRestoring=true;
      try{ok=a.restoreVisuals(project.visual);}finally{visualRestoring=false;}
      // A failed restore still takes ownership, so a newly authored visual can
      // be saved; it just may not delete the block it could not read.
      visualRestoreFailed=ok===false;
      visualOwner=project;
    }catch(e){visualRestoring=false;}
  }
  async function save(){
    clearTimeout(saveTimer);saveTimer=null;
    if(!storage||conflict||transferProtected){unsaved=true;return;}
    var p=project,epoch=saveEpoch;
    var write=function(){
      if(p!==project||transferProtected)return;
      captureVisual(p);
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
    inlineContext=null;
    var result=project.editDraft(text);if(!result.ok){announceError(result);return;}
    cancelChat('superseded');renderProposal();renderState();scheduleSave();
    schedulePreview();
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
    editor=G.CT_MUSIC_CODE_EDITOR.mount($('.mw-code'),snap().draft,sourceChanged,{onSelectionChange:sourceSelected,onNoteSelect:selectChartNote});
    syncPatternContext();
    $('.mw-help pre').textContent=Object.values(G.CT_MUSIC_CODE_EDITOR.help).join('\n');
    })();
    try{await editorLoading;}finally{editorLoading=null;}
  }
  function syncEditor(){cancelPreview();if(visualizerOpen&&presentationOwner!==project)setVisualizer(false);if(editor){
    var draft=snap().draft;if(editor.value()!==draft)inlineContext=null;
    sourceLoading=true;editor.set(draft);sourceLoading=false;
  }}
  function syncPatternContext(){
    if(!editor||!editor.setPatternContext)return;
    if(codeProject!==project){
      codeProject=project;codeProjectId++;inlineContext=null;
      if(editor.cancelSourceGesture)editor.cancelSourceGesture();
    }
    var s=snap(),v=chartContext(s),context=v&&s.draft===v.source?v:null;
    // Project snapshots are detached copies. Compare revision identity rather
    // than object identity so scrolling cannot reset an inline occurrence picker.
    if(context?(!inlineContext||inlineContext.owner!==project||inlineContext.id!==context.id||inlineContext.source!==context.source):!!inlineContext){
      editor.setPatternContext(context?{source:context.source,compiled:context.compiled,projectId:codeProjectId}:null);
      inlineContext=context?{owner:project,id:context.id,source:context.source}:null;
    }
  }
  function selectChartNote(item){
    var s=snap(),v=chartContext(s),i=typeof item==='number'?item:item.noteIndex;
    if(!v)return;
    var n=v.compiled.gb.notes[i],m=v.compiled.mapping.find(function(entry){return entry.noteIndex===i;});
    if(!n||!m)return;
    selection={ch:n.ch,fromFrame:n.frame,toFrame:n.frame+n.frames};agentPolicyChanged();
    $('.mw-notes').querySelectorAll('.mw-note').forEach(function(el){el.setAttribute('aria-pressed',String(Number(el.dataset.note)===i));});
    $('.mw-selection').textContent='Selected '+['Melody','Harmony','Bass','Drums'][n.ch]+' · '+(m.pattern!=null?'pattern '+m.pattern+', occurrence '+m.occurrence:'explicit event')+' · frames '+n.frame+'–'+(n.frame+n.frames);
    renderState();
    if(s.draft!==v.source){$('.mw-selection').textContent+=' · Source navigation unavailable while the draft differs from the chart.';return;}
    var mappingOwner=project,selected=selection;
    selectView('code');ensureEditor().then(function(){
      if(root.hidden||project!==mappingOwner||selection!==selected)return;
      if(snap().draft!==v.source||!chartContext()||chartContext().id!==v.id){$('.mw-selection').textContent+=' · Source navigation unavailable while the draft differs from the chart.';return;}
      var span=m.tokenSpan||m.span;editor.select(span.start.offset,span.end.offset);
    }).catch(announceError);
  }
  function sourceSelected(ranges){
    if(!project||!root)return;
    var s=snap(),v=chartContext(s),indices=new Set();
    if(v&&s.draft===v.source){
      function overlaps(span){return span&&ranges.some(function(r){
        var a=span.start.offset,b=span.end.offset;
        return r.from===r.to?r.from>=a&&r.from<b:r.from<b&&r.to>a;
      });}
      // Within a token select its occurrences, not every note in the containing
      // declaration. Outside tokens the definition/play remains a useful scope.
      var tokenMatches=v.compiled.mapping.filter(function(m){return overlaps(m.tokenSpan);});
      if(!ranges.every(function(r){return tokenMatches.some(function(m){return r.from>=m.span.start.offset&&r.to<=m.span.end.offset;});}))tokenMatches=[];
      (tokenMatches.length?tokenMatches:v.compiled.mapping).forEach(function(m){if(tokenMatches.length||overlaps(m.span)||overlaps(m.playSpan||m.occurrenceSpan))indices.add(m.noteIndex);});
    }
    // Cursor movement is visual feedback, never a change to agent edit scope.
    $('.mw-notes').querySelectorAll('.mw-note').forEach(function(el){el.classList.toggle('mw-source-selected',indices.has(Number(el.dataset.note)));});
  }
  function selectView(next,focusCode){
    var epoch=++viewEpoch;
    // Compatibility for existing callers: reveal/focus, never switch panes.
    view=next;
    if(next==='chat'){setChatOpen(true,focusCode!==false);return;}
    if(next==='notes'&&focusCode!==false)$('.mw-notes').focus({preventScroll:true});
    if(next==='code')ensureEditor().then(function(){if(epoch===viewEpoch&&focusCode!==false&&!root.hidden&&view==='code')editor.focus();}).catch(announceError);
  }
  // Panel geometry is a local viewing preference, not composition data. It
  // lives under its own key so it can never travel in a project record, a
  // download, a share link or a transfer: those carry what the music and
  // visuals ARE, not how this browser happened to be arranged.
  var LAYOUT_KEY='ct-music-layout-v1',layoutTimer=null,layoutLoaded=false,visualCodeOpen=false;
  function loadLayout(){
    if(layoutLoaded)return;layoutLoaded=true;
    try{
      var raw=localStorage.getItem(LAYOUT_KEY);if(!raw)return;
      var saved=JSON.parse(raw);if(!saved||typeof saved!=='object')return;
      // Every value is clamped by its own setter, so a hand-edited or stale
      // record cannot produce an unusable layout.
      if(typeof saved.musicShare==='number'&&isFinite(saved.musicShare))musicShare=Math.max(45,Math.min(75,Math.round(saved.musicShare)));
      if(typeof saved.chartShare==='number'&&isFinite(saved.chartShare))chartShare=Math.max(20,Math.min(75,Math.round(saved.chartShare)));
      if(typeof saved.desktopChatOpen==='boolean')desktopChatOpen=saved.desktopChatOpen;
      if(typeof saved.mobileChatOpen==='boolean')mobileChatOpen=saved.mobileChatOpen;
      if(typeof saved.visualCodeOpen==='boolean')visualCodeOpen=saved.visualCodeOpen;
    }catch(e){/* a broken layout preference must never block the workspace */}
  }
  function scheduleLayoutSave(){
    clearTimeout(layoutTimer);
    layoutTimer=setTimeout(function(){
      layoutTimer=null;
      try{
        localStorage.setItem(LAYOUT_KEY,JSON.stringify({musicShare:musicShare,chartShare:chartShare,
          desktopChatOpen:desktopChatOpen,mobileChatOpen:mobileChatOpen,visualCodeOpen:visualCodeOpen}));
      }catch(e){/* layout is a convenience; never report or block on it */}
    },250);
  }
  function chatIsOpen(){return mobileView.matches?mobileChatOpen:desktopChatOpen;}
  function renderChatLayout(){
    var expanded=chatIsOpen(),panel=$('.mw-chat');
    if(!expanded&&panel.contains(document.activeElement)){
      chatFocus=document.activeElement;$('[data-action=toggle-chat]').focus({preventScroll:true});
    }
    panel.hidden=!expanded;root.dataset.chatOpen=String(expanded);
    var button=$('[data-action=toggle-chat]');button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Hide chat':'Show chat';
  }
  function setChatOpen(expanded,focus){
    if(mobileView.matches)mobileChatOpen=expanded;else desktopChatOpen=expanded;
    scheduleLayoutSave();
    renderChatLayout();
    if(expanded&&focus){
      var target=chatFocus&&chatFocus.isConnected&&!chatFocus.disabled&&chatFocus.getClientRects().length?chatFocus:
        null;
      if(target)target.focus({preventScroll:true});else if(chatUI)chatUI.focus();
    }
  }
  function setChartShare(value){
    chartShare=Math.max(20,Math.min(75,Math.round(value)));
    $('.mw-composition').style.setProperty('--chart-share',chartShare+'fr');
    $('.mw-composition').style.setProperty('--code-share',(100-chartShare)+'fr');
    $('.mw-splitter').setAttribute('aria-valuenow',String(chartShare));
    $('.mw-splitter').setAttribute('aria-valuetext','Chart '+chartShare+' percent; code '+(100-chartShare)+' percent');
    scheduleLayoutSave();
  }
  function setMusicShare(value){
    musicShare=Math.max(45,Math.min(75,Math.round(value)));
    $('.mw-creative').style.setProperty('--music-share',musicShare+'fr');
    $('.mw-creative').style.setProperty('--visuals-share',(100-musicShare)+'fr');
    $('.mw-stage-splitter').setAttribute('aria-valuenow',String(musicShare));
    $('.mw-stage-splitter').setAttribute('aria-valuetext','Music '+musicShare+' percent; visuals '+(100-musicShare)+' percent');
    scheduleLayoutSave();
  }
  function renderState(){
    renderChatAccess();
    if(connection)connection.contextChanged();
    var s=snap(),v=s.validated;
    $('.mw-loop').disabled=audioState.status==='playing'||audioState.status==='paused'||!!s.pending;
    $('.mw-loop').title=$('.mw-loop').disabled?'Stop to change loop playback':'';
    $('.mw-state').title='Draft '+(v&&s.draft===v.source?'validated':'edited')+' · Valid '+(v?v.id:'none')+
      ' · Queued '+(s.pending?s.pending.revisionId:'none')+' · Playing '+(s.playing||'none')+' · '+audioState.status+(audioState.suspended?' (audio suspended)':'');
    var state=(v&&s.draft===v.source?'Code ready':'Edits waiting for Run')+(s.pending?' · Update queued for a musical boundary':'')+' · '+audioState.status+(audioState.suspended?' (audio suspended)':'');
    if($('.mw-state').textContent!==state)$('.mw-state').textContent=state;
    renderPosition(s);
    renderStage();
    $('[data-action=undo]').disabled=!s.canUndo;$('[data-action=redo]').disabled=!s.canRedo;
    $('[data-action=play]').disabled=!v;
    $('.mw-seek').max=v?Math.max(0,v.compiled.gb.totalFrames-1):0;
    $('.mw-context').textContent='Base '+(v?v.id:'none')+' · '+(selection?['Melody','Harmony','Bass','Drums'][selection.ch]+' · frames '+selection.fromFrame+'–'+selection.toFrame:'Whole song');
    renderChatUI();
  }
  function noteName(midi){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi%12)+12)%12]+(Math.floor(midi/12)-1);}
  function chartLanes(gb){
    var rows=[[],[],[],[]],metadata=new Map(((gb.bank||{}).meta||[]).map(function(m){return [m.index,m];}));
    gb.notes.forEach(function(n){rows[n.ch].push(n);});
    return rows.map(function(notes,ch){
      if(ch===3){
        var instruments=Array.from(new Set(notes.map(function(n){return n.inst;}))).sort(function(a,b){return a-b;});
        var shown=instruments.slice(0,16),overflow=instruments.length>shown.length;
        var labels=shown.map(function(inst){var m=metadata.get(inst);return m&&(m.name||m.id||m.patch&&m.patch.authored)||'Noise '+inst;});
        if(overflow)labels.push('Other drums');if(!labels.length)labels.push('Noise');
        return {labels:labels,drums:true,count:notes.length,overflow:overflow,
          row:function(n){var i=shown.indexOf(n.inst);return i<0?labels.length-1:i;},
          name:function(n){var m=metadata.get(n.inst);return m&&(m.name||m.id||m.patch&&m.patch.authored)||'Noise '+n.inst;}};
      }
      var min=notes.reduce(function(v,n){return Math.min(v,n.midi);},127),max=notes.reduce(function(v,n){return Math.max(v,n.midi);},0);
      if(!notes.length){min=[60,48,24][ch];max=min+11;}
      var low=Math.max(0,Math.floor(min/12)*12),high=Math.min(127,Math.ceil((max+1)/12)*12-1),labels=[];
      for(var midi=high;midi>=low;midi--)labels.push(noteName(midi));
      return {labels:labels,low:low,high:high,count:notes.length,row:function(n){return high-n.midi;},name:function(n){return noteName(n.midi);}};
    });
  }
  function renderOverview(v,from,to){
    var holder=$('.mw-overview'),gb=v.compiled.gb,total=gb.totalFrames||1;
    if(!chartIndex.overview){
      var canvas=document.createElement('canvas');canvas.width=1024;canvas.height=56;canvas.setAttribute('aria-hidden','true');
      var ctx=canvas.getContext('2d');
      if(ctx){
        ctx.fillStyle='#10121b';ctx.fillRect(0,0,1024,56);
        gb.notes.forEach(function(n){ctx.fillStyle=['#79d59d','#71bbeb','#e8b264','#bf9fde'][n.ch];
          ctx.globalAlpha=0.75;ctx.fillRect(n.frame/total*1024,n.ch*14+3,Math.max(1,Math.min(n.frames,total-n.frame)/total*1024),8);});
        ctx.globalAlpha=1;
      }
      chartIndex.overview=canvas;
    }
    if(holder.firstElementChild!==chartIndex.overview)holder.prepend(chartIndex.overview);
    Array.from(holder.querySelectorAll('canvas')).forEach(function(canvas){if(canvas!==chartIndex.overview)canvas.remove();});
    holder.setAttribute('aria-label','Whole song overview, '+gb.notes.length+' notes across four tracks. Activate to zoom near playback, or click a point to inspect it.');
    var window=$('.mw-overview-window');window.style.left=Math.max(0,from/total*100)+'%';window.style.width=Math.min(100,(to-from)/total*100)+'%';
  }
  function renderNotes(){
    var s=snap(),v=chartContext(s),pane=$('.mw-notes'),scrollTop=pane.scrollTop,scrollLeft=pane.scrollLeft;
    var focused=pane.contains(document.activeElement)?document.activeElement.dataset.chartKey:null;
    pane.replaceChildren();
    $('.mw-chart-status').textContent=previewStatus;
    $('.mw-source-mode').textContent=v&&v.compiled.mapping.some(function(m){return m.pattern===null;})?
      'Exact song source preserved. For a readable live-coding sketch, choose New loop above. Download this project first to keep it.':
      'Edit patterns or their gate, velocity and transpose controls, then Run (Cmd/Ctrl+Enter). Controls edit source literals only; changes join at a musical boundary while playing.';
    if(v&&((v.compiled.gb.auto||[]).length||(v.compiled.gb.kit||[]).length))$('.mw-source-mode').textContent+=' Token playback markers are unavailable on register/sample-driven tracks.';
    syncPatternContext();
    $('.mw-overview').hidden=!v;
    if(!v){pane.textContent='Apply valid code to see notes.';return;}
    var gb=v.compiled.gb,settings=v.compiled.settings||{},bars=settings.bars||Math.max(1,Math.ceil(gb.totalFrames/120));
    if(!chartIndex||chartIndex.owner!==project||chartIndex.id!==v.id||chartIndex.source!==v.source){
      chartIndex={owner:project,id:v.id,source:v.source,index:G.CT_MUSIC_CHART_INDEX&&G.CT_MUSIC_CHART_INDEX.create(gb.notes),
        mapping:new Map(v.compiled.mapping.map(function(m){return [m.noteIndex,m];})),
        lanes:chartLanes(gb),
        overlaps:new Set((v.compiled.diagnostics||[]).filter(function(d){return d.code==='CHIP_OVERLAP';}).map(function(d){return d.noteIndex;}))};
      chartRange=null;scrollLeft=0;
    }
    var total=gb.totalFrames||1,rangeStart=chartRange?chartRange.fromFrame:0,rangeEnd=chartRange?chartRange.toFrame:total,span=rangeEnd-rangeStart;
    var width=Math.max(120,pane.clientWidth-28-CHART_GUTTER,Math.min(12000,bars*80*(span/total)));
    var from=Math.min(rangeEnd-0.000001,rangeStart+Math.max(0,scrollLeft-80)/width*span),to=Math.min(rangeEnd,rangeStart+(scrollLeft+pane.clientWidth-CHART_GUTTER+80)/width*span);
    var visible=chartIndex.index?chartIndex.index.query({fromFrame:from,toFrame:Math.max(from+0.000001,to),limit:399}):{items:gb.notes.map(function(n,i){return {note:n,index:i};}),bins:[],overflow:false};
    if(focused&&focused.startsWith('note-')){
      var pinned=Number(focused.slice(5));
      if(gb.notes[pinned]&&!visible.items.some(function(item){return item.index===pinned;}))visible.items.push({note:gb.notes[pinned],index:pinned});
    }
    $('.mw-chart-reset').hidden=!chartRange;
    if(visible.overflow)$('.mw-chart-status').textContent=previewStatus+' · Dense region: '+visible.count+' notes shown as counted groups. Select a group to zoom.';
    renderOverview(v,rangeStart,rangeEnd);
    var inner=document.createElement('div');inner.style.width=(width+CHART_GUTTER)+'px';inner.style.position='relative';
    var ruler=document.createElement('div');ruler.className='mw-bar-ruler';ruler.setAttribute('aria-label','Bar boundaries on the compiled song clock');
    ruler.style.cssText='height:26px;position:relative;font-size:11px;color:#b6bfd5';
    inner.appendChild(ruler);
    // Reuse the compiler clock. Thin labels (not timing) to at most 256 marks;
    // label indices remain absolute, including after a tempo-map segment.
    try{
      var clock=G.CT_MUSIC_LANGUAGE.createClock(settings);
      function barAt(frame){var lo=0,hi=65536;while(lo<hi){var mid=Math.ceil((lo+hi)/2);if(clock(mid*4)<=frame)lo=mid;else hi=mid-1;}return lo;}
      var first=barAt(from),last=barAt(to),stride=Math.max(1,Math.ceil((last-first+1)/255));
      for(var i=first;i<=last;i+=stride){
        var frame=clock(i*4);
        if(frame>=rangeEnd)continue;
        var mark=document.createElement('span');mark.textContent='Bar '+(i+1);mark.title='Frame '+frame;
        if(frame>=rangeStart){mark.style.cssText='position:absolute;white-space:nowrap;top:0;left:'+(CHART_GUTTER+(frame-rangeStart)/span*width)+'px';ruler.appendChild(mark);}
        var barWidth=(clock((i+1)*4)-frame)/span*width,divisions=stride>1?1:barWidth>=192?16:barWidth>=64?4:1;
        for(var sub=0;sub<divisions;sub++){
          var gridFrame=clock(i*4+sub*4/divisions);if(gridFrame<rangeStart||gridFrame>=rangeEnd)continue;
          var line=document.createElement('div');line.className='mw-time-grid';line.dataset.frame=String(gridFrame);line.dataset.strength=sub===0?'bar':sub%(divisions/4)===0?'beat':'step';line.setAttribute('aria-hidden','true');
          line.style.left=(CHART_GUTTER+(gridFrame-rangeStart)/span*width)+'px';inner.appendChild(line);
        }
      }
      var end=document.createElement('span');end.textContent=chartRange?'Frame '+Math.ceil(rangeEnd):'End';end.title='Frame '+rangeEnd;
      end.style.cssText='position:absolute;right:0;top:0';ruler.appendChild(end);
    }catch(e){ruler.textContent='Bar clock unavailable: '+e.message;}
    ['Melody','Harmony','Bass','Drums'].forEach(function(name,ch){
      var layout=chartIndex.lanes[ch],lane=document.createElement('div');lane.className='mw-lane';lane.setAttribute('aria-label',name);lane.dataset.channel=String(ch);
      lane.style.height=(layout.count?LANE_HEADER+layout.labels.length*NOTE_ROW+1:46)+'px';
      var label=document.createElement('div');label.className='mw-lane-label';label.textContent=name+' · '+(!layout.count?'empty':layout.drums?'percussion':noteName(layout.low)+'–'+noteName(layout.high));lane.appendChild(label);
      var laneColor=['#79d59d','#71bbeb','#e8b264','#bf9fde'][ch];label.style.color=laneColor;
      (layout.count?layout.labels:[]).forEach(function(text,row){
        var pitchRow=document.createElement('div');pitchRow.className='mw-pitch-row';pitchRow.style.top=(LANE_HEADER+row*NOTE_ROW)+'px';
        if(!layout.drums){pitchRow.dataset.pitch=String(layout.high-row);pitchRow.dataset.accidental=String([1,3,6,8,10].includes((layout.high-row)%12));}
        var pitchLabel=document.createElement('span');pitchLabel.className='mw-pitch-label';pitchLabel.textContent=text;pitchLabel.title=text;pitchRow.appendChild(pitchLabel);lane.appendChild(pitchRow);
      });
      if(!layout.count){var empty=document.createElement('span');empty.className='mw-lane-empty';empty.textContent='No notes';lane.appendChild(empty);}
      if(layout.overflow)label.title='First 16 instruments have individual rows; remaining percussion is labelled on its notes in Other drums.';
      visible.items.forEach(function(item){var n=item.note,i=item.index;
        if(n.ch!==ch)return;
        var b=document.createElement('button');b.className='mw-note';b.type='button';
        b.style.background=['#244d38','#173e59','#553d22','#40304e'][ch];b.style.borderColor=laneColor;
        b.style.left=(CHART_GUTTER+(Math.max(n.frame,rangeStart)-rangeStart)/span*width)+'px';b.style.width=Math.max(6,(Math.min(n.frame+n.frames,rangeEnd)-Math.max(n.frame,rangeStart))/span*width)+'px';
        b.style.top=(LANE_HEADER+layout.row(n)*NOTE_ROW+1)+'px';
        b.setAttribute('aria-label',name+' note '+(n.midi==null?'noise':n.midi)+' frame '+n.frame+' length '+n.frames);
        b.textContent=layout.name(n);b.title=b.textContent+' · frame '+n.frame+' · '+n.frames+' frames';b.dataset.pitch=String(n.midi);b.dataset.instrument=String(n.inst);
        b.setAttribute('aria-pressed','false');b.dataset.note=String(i);b.dataset.chartKey='note-'+i;
        if(chartIndex.overlaps.has(i)){b.style.background='#c46a54';b.title='Chip overlap: inspect diagnostics';}
        if(n.frame+n.frames>total){b.style.background='#c46a54';b.title='Finite song end cuts this event; source duration is retained.';}
        b.addEventListener('click',function(){selectChartNote(i);});lane.appendChild(b);
      });
      visible.bins.forEach(function(bin){
        if(bin.channel!==ch)return;
        var group=document.createElement('button');group.type='button';group.className='mw-note-group';group.textContent=String(bin.count);
        group.dataset.chartKey='group-'+ch+'-'+bin.fromFrame;group.setAttribute('aria-label',bin.count+' '+name+' notes in frames '+Math.floor(bin.fromFrame)+'–'+Math.ceil(bin.toFrame)+'. Zoom into group');
        group.style.left=(CHART_GUTTER+(bin.fromFrame-rangeStart)/span*width)+'px';group.style.width=Math.max(12,(bin.toFrame-bin.fromFrame)/span*width)+'px';
        group.addEventListener('click',function(){
          if(bin.toFrame-bin.fromFrame<1){status(bin.count+' simultaneous notes in this region. Inspect their exact events in the code.');selectView('code');return;}
          chartRange={fromFrame:bin.fromFrame,toFrame:bin.toFrame};pane.scrollLeft=0;renderNotes();
        });lane.appendChild(group);
      });inner.appendChild(lane);
    });
    var cursor=document.createElement('div');cursor.className='mw-playhead';cursor.style.left=(CHART_GUTTER+Math.max(0,((audioState.frame||0)-rangeStart)/span*width))+'px';inner.appendChild(cursor);pane.appendChild(inner);
    cursor.dataset.rangeStart=String(rangeStart);cursor.dataset.rangeEnd=String(rangeEnd);
    cursor.hidden=!playingRevision||playingRevision.source!==v.source||audioState.frame<rangeStart||audioState.frame>=rangeEnd;
    pane.scrollTop=scrollTop;pane.scrollLeft=scrollLeft;if(editor&&editor.selection)sourceSelected(editor.selection());
    chartViewportKey=pane.scrollLeft+':'+pane.clientWidth;
    if(focused){var retained=Array.from(pane.querySelectorAll('[data-chart-key]')).find(function(el){return el.dataset.chartKey===focused;});if(retained)retained.focus({preventScroll:true});}
    renderPosition(s);
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
    var v=chartContext(),cursor=$('.mw-playhead');
    if(v&&cursor){var start=Number(cursor.dataset.rangeStart),end=Number(cursor.dataset.rangeEnd);cursor.hidden=!playingRevision||playingRevision.source!==v.source||audioState.frame<start||audioState.frame>=end;var inner=cursor.parentElement;cursor.style.left=(CHART_GUTTER+(Math.max(0,audioState.frame||0)-start)/(end-start)*(inner.clientWidth-CHART_GUTTER))+'px';}
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
        var settings={revision:revision.id,baseRevision:snap().playing,boundaries:forcePlay?[]:boundaries(playingRevision||revision),loop:$('.mw-loop').checked,settings:revision.compiled.settings};
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
    restoreProjectVisuals();
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
  function boundedChat(messages,count,limit){
    var result=[],encoder=new TextEncoder();
    // Preserve a contiguous recent suffix. Count JSON overhead as well as text.
    for(var i=messages.length-1;i>=0&&result.length<count;i--){
      var m=messages[i];
      if(!m||['user','assistant'].indexOf(m.role)===-1||typeof m.content!=='string'||m.content.length>10000||!validUnicode(m.content))continue;
      var next=[{role:m.role,content:m.content}].concat(result);
      if(encoder.encode(JSON.stringify(next)).length>limit)break;
      result=next;
    }return result;
  }
  function appendChat(role,content){
    check(project.setChat(boundedChat(project.getChat().concat([{role:role,content:content}]),64,131072)));
    scheduleSave();
  }
  function renderChatUI(){
    if(!chatUI||!project)return;
    var p=proposal,source=p&&p.edits?snap().draft:'';
    var state={input:chatDraft,messages:project.getChat(),pending:!!requestId,canSend:!chatAccessBusy,
      accessMessage:chatAccessMessage,suggestions:['A happy four-bar loop','A dreamy cave theme','Simplify the drums, keep the melody'],
      proposal:p?{id:p.id,status:p.status,canApply:p.status==='ready',
        summary:p.diff?p.diff.summary:p.explanation||'',
        preview:(p.edits||[]).map(function(e){return '− '+source.slice(e.from,e.to)+'\n+ '+e.text;}).join('\n')}:null};
    var signature=JSON.stringify(state);if(signature===chatUISignature)return;
    chatUISignature=signature;chatUI.update(state);
  }
  function resolveChatProposal(id,apply){
    try{
      if(!proposal||proposal.id!==id||proposal.status!=='ready')return;
      if(proposal.capturedContext&&(invalidateAgent()||proposal.status!=='ready'))throw Error('Proposal context changed; request a new proposal');
      if(apply){var r=check(project.applyProposal(id));proposal.revision=r.revision.id;proposal.status='queued';applied(r);if(!snap().pending)proposal.status='validated';status(r.diff.summary);}
      else{project.cancelRequest(id);proposal.status='rejected';}
      renderProposal();
    }catch(e){if(proposal)proposal.status='superseded';announceError(e);renderProposal();}
  }
  async function ensureChat(){
    if(chatUI)return;if(chatLoading)return chatLoading;
    chatLoading=(async function(){
      if(!G.CT_MUSIC_CHAT_UI)await new Promise(function(resolve,reject){
        var script=document.createElement('script');script.src='/lib/music-chat-ui.js?v='+encodeURIComponent(G.CT_MUSIC_CHAT_UI_VERSION||'1');
        script.onload=resolve;script.onerror=function(){script.remove();reject(Error('Chat UI could not load. Code and playback remain available.'));};document.head.appendChild(script);
      });
      chatUI=G.CT_MUSIC_CHAT_UI.mount($('.mw-chat-island'),{input:chatDraft,messages:[],pending:false,canSend:false},{
        onInput:function(text){chatDraft=text;renderChatUI();},
        onSend:function(){requestChat().catch(announceError);},
        onStop:function(){cancelChat('rejected');proposal={status:'rejected',explanation:'Request cancelled'};renderProposal();renderState();},
        onApply:function(id){resolveChatProposal(id,true);},onReject:function(id){resolveChatProposal(id,false);},
        onSettings:function(){$('.mw-chat-settings').showModal();},onHide:function(){setChatOpen(false);}
      });renderChatUI();
    })();
    try{await chatLoading;}finally{chatLoading=null;}
  }
  async function requestChat(){
    if(chatAccessBusy)return;
    if(!chatUnlocked||!chatProviders.some(function(p){return p.id===$('.mw-chat-provider').value;})){$('.mw-chat-settings').showModal();return;}
    client.provider=$('.mw-chat-provider').value;
    if(requestId)return;
    var s=snap(),text=chatDraft.trim();if(!text)throw Error('Write a musical request');
    var conversation=boundedChat(project.getChat(),12,16384);
    var capturedContext=agentContext();
    cancelChat('superseded');
    var owner=project,id='request-'+crypto.randomUUID(),req=check(project.beginRequest(id));requestId=id;
    appendChat('user',text);chatDraft='';
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
        constraints:constraints,conversation:conversation,language:{version:G.CT_MUSIC_LANGUAGE.VERSION,help:G.CT_MUSIC_CODE_EDITOR&&G.CT_MUSIC_CODE_EDITOR.help||{}},diagnostics:(s.diagnostics||[]).slice(0,32)});
      if(project!==owner||root.hidden||requestId!==id)return;
      if(invalidateAgent()){renderProposal();renderState();return;}
      if(response.id!==id)throw Error('Chat response belongs to another request');
      if(response.edits.length===0){
        owner.cancelRequest(id);appendChat('assistant',response.explanation);proposal=null;return;
      }
      var validated=project.validateProposal({id:id,baseRevision:response.baseRevision,baseSource:req.baseSource,edits:response.edits},constraints);
      check(validated);
      appendChat('assistant',response.explanation);
      proposal={id:id,status:'ready',chat:true,capturedContext:capturedContext,explanation:response.explanation,edits:response.edits,diff:validated.diff};
    }catch(e){
      if(project!==owner||requestId!==id)return;
      if(e.code==='locked'){chatUnlocked=false;renderChatAccess(e.message);}
      owner.cancelRequest(id);proposal={status:'invalid',explanation:e.message};status(e.message);
    }
    finally{if(project===owner&&requestId===id){requestId=null;renderProposal();renderState();}}
  }
  function renderProposal(){
    invalidateAgent();
    renderChatUI();
  }
  function build(){
    root=document.createElement('section');root.id='musicworkspace';root.hidden=true;root.dataset.presentation='composition';root.setAttribute('aria-label','Create music workspace');
    root.innerHTML='<header class="mw-top"><h1>Chiptunes · Live code</h1><button data-action="new-loop">New loop</button><button data-action="toggle-chat" aria-controls="mw-panel-chat" aria-expanded="true">Hide chat</button><button data-action="listen" title="Leave composition and listen to generated songs">Listen</button></header>'+
      '<div class="mw-transport"><button data-action="play">▶ Play</button><button data-action="pause">Pause</button><button data-action="stop">■ Stop</button>'+
      '<label><input type="checkbox" class="mw-loop"> Loop</label><input class="mw-seek" type="range" min="0" max="0" value="0" aria-label="Seek frame">'+
      '<button class="mw-primary" data-action="apply" title="Run code (Cmd/Ctrl+Enter)" aria-keyshortcuts="Meta+Enter Control+Enter">Run <kbd>⌘/Ctrl ↵</kbd></button><button data-action="undo">Undo revision</button><button data-action="redo">Redo revision</button></div>'+
      '<div class="mw-live-feedback"><div class="mw-position" aria-live="off">Stopped · Run to hear your code</div><div class="mw-beats" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="mw-state" aria-live="polite"></div></div>'+
      '<section class="mw-transfer-offer" aria-label="Incoming project" hidden><p class="mw-transfer-description" role="status"></p><div class="mw-actions"><button data-action="transfer-accept" disabled>Accept</button><button data-action="transfer-cancel">Cancel</button></div></section>'+
      '<div class="mw-body"><div class="mw-creative"><main id="mw-panel-music" class="mw-main" aria-label="Composition"><p class="mw-source-mode"></p><div class="mw-selection" role="status">Notes show the validated revision. Select a note to locate its source.</div><div class="mw-composition"><div id="mw-panel-notes" role="region" aria-label="Note chart" tabindex="0" class="mw-mainview mw-notes"></div><div class="mw-splitter" role="separator" tabindex="0" aria-label="Resize chart and code" aria-orientation="horizontal" aria-controls="mw-panel-notes mw-panel-code" aria-valuemin="20" aria-valuemax="75" aria-valuenow="45" title="Drag or use Up/Down arrows to resize chart and code; Home/End for limits"></div><div id="mw-panel-code" role="region" aria-label="Code editor" class="mw-mainview mw-code"></div></div>'+
      '<div class="mw-diagnostics" role="status"></div><details class="mw-live-guide"><summary>Build a live set · 7 steps</summary><div class="mw-live-guide-content"><label for="mw-live-step">Tidal-inspired patterns</label><div class="mw-live-step-actions"><select id="mw-live-step" class="mw-live-step" aria-describedby="mw-live-step-description mw-live-step-warning"></select><button data-action="load-cycle-example">Load into code</button></div><p id="mw-live-step-description" class="mw-live-step-description" aria-live="polite"></p><p id="mw-live-step-warning">Replaces your draft in one undoable edit. Run to hear it; the current music keeps playing until then.</p></div></details><details class="mw-help"><summary>Music help and limits</summary><pre></pre><p>Audio/file exports are limited to 10 minutes; project downloads preserve longer songs.</p></details></main>'+
      '<div class="mw-stage-splitter" role="separator" tabindex="0" aria-label="Resize music and visuals" aria-orientation="vertical" aria-controls="mw-panel-music mw-panel-visuals" aria-valuemin="45" aria-valuemax="75" aria-valuenow="62" title="Drag or use Left/Right arrows to resize music and visuals; Home/End for limits"></div>'+
      '<section id="mw-panel-visuals" class="mw-visuals" aria-label="Visual stage"><header class="mw-visual-header"><h2>Visuals</h2><button data-action="stage-fullscreen" title="Show only this visual output in fullscreen">Fullscreen</button></header>'+
      '<div class="mw-stage-viewport" role="img" aria-label="Music-driven visual output"><p class="mw-stage-empty">Preparing the visual stage…</p></div>'+
      '<div class="mw-scene-controls"><label for="mw-scene">Scene</label><select id="mw-scene" class="mw-scene" aria-label="Visual scene" disabled></select></div>'+
      '<div class="mw-visual-authoring" hidden><div class="mw-visual-parameters" aria-label="Live visual controls"></div><div class="mw-visual-apply"><select class="mw-visual-boundary" aria-label="Visual activation boundary"><option value="now">Now</option><option value="bar">Next bar</option></select><button data-action="visual-apply">Apply visuals</button><button data-action="visual-cancel" hidden>Cancel queued</button></div>'+
      '<details class="mw-visual-code-disclosure"><summary>Visual code <small>⌘/Ctrl ↵ applies visuals only</small></summary><div class="mw-visual-code" role="region" aria-label="Visual editor"></div><p class="mw-visual-reference">Compose layers: tunnel, tiles, orbits, ribbons, sparks. Read named controls with param("motion"), music with signal("bass.hit") or signal("audio.bass"). This bounded language does not run JavaScript.</p></details></div>'+
      '<p class="mw-stage-status" role="status">Preparing the visual stage…</p><div class="mw-visual-performance" hidden><button data-action="visual-freeze" aria-pressed="false" title="Hold visual state; music continues">Freeze</button><button data-action="visual-blackout" aria-pressed="false" title="Mask output; music and visual state continue">Blackout</button><button data-action="visual-reset" title="Clear visual feedback and phase only">Reset visuals</button><button data-action="visual-panic" title="Stop music, cancel queued visuals and black out output">Panic</button></div><p class="mw-stage-help">Code makes the music. The scene follows it. The applied scene, its source and its control values are saved with your project.</p></section></div>'+
      '<aside id="mw-panel-chat" class="mw-chat" aria-label="Musical collaboration">'+
      '<section class="mw-project-handoff" hidden><p>Web Chat runs in the hosted workspace. Open this project there to unlock Chat and request proposals.</p><button data-action="project-handoff">Open this project in web Chat</button><p>Copies your draft and last validated revision to web Chat without private chat or provenance. Accept in the new window; your original project stays here.</p></section>'+
      '<div class="mw-chat-island"></div></aside></div>'+
      '<dialog class="mw-chat-settings" aria-labelledby="mw-settings-title"><header class="mw-chat-header"><h2 id="mw-settings-title">Chat settings</h2><button data-action="chat-settings-close">Done</button></header><div class="mw-settings-content"><p class="mw-context"></p><section class="mw-chat-access" aria-label="Built-in chat access"><p class="mw-settings-status" role="status">Checking chat access…</p><p>Use the owner password, not an API key. Sending shares your music source, request, and recent conversation with the selected provider. Unlocking makes no model call.</p><p>Saved chat is private: public shares and transfers exclude it. Full project downloads include it.</p>'+
      '<label>Provider<select class="mw-chat-provider" aria-label="Chat provider"></select></label><label>Owner password<input class="mw-owner-password" type="password" autocomplete="off" maxlength="1024"></label>'+
      '<div class="mw-actions"><button data-action="chat-unlock">Unlock chat</button><button data-action="chat-logout" disabled>Lock chat</button><button data-action="chat-access-refresh">Refresh access</button></div></section><small>Chat supports source up to 512 KiB UTF-8; larger projects remain editable and downloadable.</small>'+
      '<label>Edit scope <select class="mw-scope"><option value="-1">Whole song</option><option value="0">Melody</option><option value="1">Harmony</option><option value="2">Bass</option><option value="3">Drums</option></select></label>'+
      '<label>Melody lock <select class="mw-lock"><option value="none">Unlocked</option><option value="track">Whole track</option><option value="pitchrhythm">Pitch and rhythm</option><option value="instrument">Instrument</option><option value="arrangement">Arrangement</option></select></label>'+
      '<label><input class="mw-region" type="checkbox"> Restrict to selected note region</label>'+
      '<details class="mw-external-mcp"><summary>External agent via MCP (optional)</summary><section class="mw-connect" aria-label="Connect a music agent"><h2>Connect</h2>'+
      '<div class="mw-mcp-setup" hidden><p>Add this remote MCP server in your agent, sign in with the same account, then refresh clients. Authorizing a client does not share a song; Connect below does.</p><label>Remote MCP server<input class="mw-mcp-endpoint" type="text" readonly></label><button data-action="copy-mcp">Copy MCP endpoint</button></div>'+
      '<p class="mw-mcp-unavailable">Remote MCP setup requires the HTTPS gateway and an available connection API. It is unavailable on the Cloudflare site without that API. Sign in if prompted, then refresh clients.</p>'+
      '<p>Connecting uploads your current music source, selected region, and edit constraints to this service for the client you choose. Validated edits and context changes are shared while connected. Every proposal requires your explicit Apply.</p>'+
      '<label>Agent client<select class="mw-client"><option value="">Choose an authorized client</option></select></label><div class="mw-actions"><button data-action="refresh-clients">Refresh clients</button><button data-action="connect" disabled>Connect</button><button data-action="disconnect" disabled>Disconnect</button></div>'+
      '<p class="mw-connect-status" role="status">Connection unavailable in this build.</p><a class="mw-sign-in" href="/sign-in" hidden>Sign in to connect</a></section></details></div></dialog>'+
      '<footer class="mw-actions mw-footer"><details class="mw-project-tools"><summary>Project tools</summary><div class="mw-actions"><button data-action="save">Save draft locally</button><button data-action="download">Download project</button><button data-action="open">Open project</button><button data-action="share">Copy project link</button>'+
      '<details class="mw-generate"><summary>Generate a full song (exact source)</summary><label>Describe the song<input class="mw-generate-text" maxlength="500" placeholder="Make something happy"></label><button data-action="generate">Generate song</button></details>'+
      '<details class="mw-exports"><summary>Export audio / files</summary><div class="mw-actions"><select class="mw-format" aria-label="Export format"><option value="wav">WAV</option><option value="midi">MIDI</option><option value="rom">Game Boy ROM</option><option value="lsdsng">LSDj</option></select><button data-action="export">Export validated revision</button></div></details></div></details><small class="mw-build"></small></footer>'+
      '<p class="mw-status" role="status" aria-live="polite"></p>';
    document.body.appendChild(root);
    var cycleSteps=G.CT_MUSIC_CYCLE_EXAMPLES&&G.CT_MUSIC_CYCLE_EXAMPLES.steps||[];
    cycleSteps.forEach(function(step,index){var option=document.createElement('option');option.value=step.id;option.textContent=(index+1)+'. '+step.title;$('.mw-live-step').appendChild(option);});
    function describeCycleStep(){var step=cycleSteps.find(function(item){return item.id===$('.mw-live-step').value;});$('.mw-live-step-description').textContent=step?step.description:'';}
    $('.mw-live-step').addEventListener('change',describeCycleStep);describeCycleStep();
    $('.mw-live-guide').hidden=!cycleSteps.length;
    var visualizerButton=document.createElement('button');visualizerButton.dataset.action='visualizer';visualizerButton.textContent='Focus visuals';visualizerButton.setAttribute('aria-pressed','false');visualizerButton.setAttribute('aria-controls','mw-panel-visuals');
    $('.mw-top').insertBefore(visualizerButton,$('[data-action=toggle-chat]'));
    var chartStatus=document.createElement('p');chartStatus.className='mw-chart-status';chartStatus.setAttribute('role','status');
    $('.mw-main').insertBefore(chartStatus,$('.mw-selection'));
    var chartReset=document.createElement('button');chartReset.className='mw-chart-reset';chartReset.dataset.action='chart-reset';chartReset.textContent='Show full song';chartReset.hidden=true;chartStatus.after(chartReset);
    var overview=document.createElement('button');overview.type='button';overview.className='mw-overview';overview.title='Whole song overview · click to inspect four bars; Enter inspects the current playback position';
    overview.innerHTML='<span class="mw-overview-window" aria-hidden="true"></span><span class="mw-overview-playhead" aria-hidden="true" hidden></span>';
    $('.mw-main').insertBefore(overview,$('.mw-composition'));
    overview.addEventListener('click',function(e){
      var v=chartContext();if(!v)return;
      var total=v.compiled.gb.totalFrames||1,rect=overview.getBoundingClientRect();
      var frame=e.detail?Math.max(0,Math.min(total,(e.clientX-rect.left)/rect.width*total)):audioState.frame||0;
      var clock=G.CT_MUSIC_LANGUAGE.createClock(v.compiled.settings||{}),lo=0,hi=65536;
      while(lo<hi){var mid=Math.ceil((lo+hi)/2);if(clock(mid*4)<=frame)lo=mid;else hi=mid-1;}
      var first=Math.max(0,lo-1),start=clock(first*4),end=Math.min(total,clock((first+4)*4));
      if(end<=start)return;
      chartRange={fromFrame:start,toFrame:end};$('.mw-notes').scrollLeft=0;renderNotes();
    });
    function refreshChartViewport(){
      if(root.hidden||!project||chartViewportKey===$('.mw-notes').scrollLeft+':'+$('.mw-notes').clientWidth||chartRenderFrame)return;
      chartRenderFrame=requestAnimationFrame(function(){chartRenderFrame=null;if(!root.hidden)renderNotes();});
    }
    $('.mw-notes').addEventListener('scroll',refreshChartViewport,{passive:true});
    if(G.ResizeObserver)new ResizeObserver(refreshChartViewport).observe($('.mw-notes'));
    $('.mw-help').appendChild($('.mw-source-mode'));
    var nativeTools=document.createElement('details');nativeTools.className='mw-native-tools';
    nativeTools.innerHTML='<summary>Native format tools</summary><p>Separate LSDj structure editor; your musical code stays here. No native playback.</p><button data-action="native-pick">Open LSDj</button><button data-action="native-json">Open native JSON</button><button data-action="native-resume">Resume LSDj edit</button>';
    $('.mw-project-tools>.mw-actions').appendChild(nativeTools);
    if(location.origin==='https://chiptunes-agent-gateway.vercel.app'){
      var recovery=document.createElement('p');recovery.className='mw-origin-recovery';
      recovery.appendChild(document.createTextNode('This is the compatibility address. Your saved draft and private chat remain in this browser origin. Download the project here, then open it in '));
      var canonical=document.createElement('a');canonical.href='https://chiptunes.app/create';canonical.target='_blank';canonical.rel='noopener';canonical.textContent='Chiptunes Create';recovery.appendChild(canonical);
      recovery.appendChild(document.createTextNode('. Nothing is moved or deleted automatically.'));$('.mw-project-tools').appendChild(recovery);
    }
    $('.mw-chat').addEventListener('focusin',function(e){chatFocus=e.target;});
    $('.mw-chat-settings').addEventListener('close',function(){$('.mw-owner-password').value='';});
    $('.mw-chat-settings').addEventListener('cancel',function(e){
      e.preventDefault();e.stopImmediatePropagation();this.close();
    });
    mobileView.addEventListener('change',function(){
      if(!root.hidden)renderChatLayout();
    });
    var splitter=$('.mw-splitter'),dragPointer=null;
    loadLayout();
    setChartShare(chartShare);setMusicShare(musicShare);renderChatLayout();
    if(visualCodeOpen)$('.mw-visual-code-disclosure').open=true;
    splitter.addEventListener('keydown',function(e){
      var delta=e.shiftKey?10:5;
      if(['ArrowUp','ArrowDown','Home','End'].indexOf(e.key)===-1)return;
      e.preventDefault();e.stopPropagation();setChartShare(e.key==='Home'?20:e.key==='End'?75:chartShare+(e.key==='ArrowUp'?-delta:delta));
    });
    splitter.addEventListener('pointerdown',function(e){
      if(e.button!==0||!e.isPrimary)return;
      e.preventDefault();splitter.focus({preventScroll:true});dragPointer=e.pointerId;splitter.setPointerCapture(e.pointerId);
    });
    splitter.addEventListener('pointermove',function(e){
      if(e.pointerId!==dragPointer)return;
      var rect=$('.mw-composition').getBoundingClientRect();setChartShare((e.clientY-rect.top)/rect.height*100);
    });
    function endResize(e){if(e.pointerId===dragPointer){dragPointer=null;if(splitter.hasPointerCapture(e.pointerId))splitter.releasePointerCapture(e.pointerId);}}
    splitter.addEventListener('pointerup',endResize);splitter.addEventListener('pointercancel',endResize);splitter.addEventListener('lostpointercapture',function(){dragPointer=null;});
    var stageSplitter=$('.mw-stage-splitter'),stagePointer=null;
    stageSplitter.addEventListener('keydown',function(e){
      if(['ArrowLeft','ArrowRight','Home','End'].indexOf(e.key)===-1)return;
      e.preventDefault();e.stopPropagation();var delta=e.shiftKey?10:5;
      setMusicShare(e.key==='Home'?45:e.key==='End'?75:musicShare+(e.key==='ArrowLeft'?-delta:delta));
    });
    stageSplitter.addEventListener('pointerdown',function(e){
      if(e.button!==0||!e.isPrimary)return;
      e.preventDefault();stageSplitter.focus({preventScroll:true});stagePointer=e.pointerId;stageSplitter.setPointerCapture(e.pointerId);
    });
    stageSplitter.addEventListener('pointermove',function(e){
      if(e.pointerId!==stagePointer)return;
      var rect=$('.mw-creative').getBoundingClientRect();if(rect.width)setMusicShare((e.clientX-rect.left)/rect.width*100);
    });
    function endStageResize(e){if(e.pointerId===stagePointer){stagePointer=null;if(stageSplitter.hasPointerCapture(e.pointerId))stageSplitter.releasePointerCapture(e.pointerId);}}
    stageSplitter.addEventListener('pointerup',endStageResize);stageSplitter.addEventListener('pointercancel',endStageResize);stageSplitter.addEventListener('lostpointercapture',function(){stagePointer=null;});
    $('.mw-scene').addEventListener('change',function(){
      try{
        var a=visualAdapter();if(a.snapshot().visual)a.selectVisualDraft(this.value);else a.setScene(this.value);
        renderStage();
      }catch(e){status('This visual scene could not be selected. Music is unchanged.');renderStage();}
    });
    $('.mw-visual-code-disclosure').addEventListener('toggle',function(){
      visualCodeOpen=this.open;scheduleLayoutSave();
      if(this.open)ensureVisualEditor();
    });
    G.addEventListener('ct-visual-state',function(){
      // CodeMirror change listeners run during an editor update. UI/diagnostic
      // synchronization must not dispatch another transaction reentrantly.
      visualChanged();
      if(visualRenderQueued)return;visualRenderQueued=true;
      queueMicrotask(function(){visualRenderQueued=false;if(root&&!root.hidden)renderStage();});
    });
    // Legacy transfer recovery remains supported, but normal Chat is same-origin.
    $('.mw-project-handoff').hidden=true;
    $('.mw-build').textContent='Music v'+G.CT_MUSIC_LANGUAGE.VERSION+' · '+(G.CT_MUSIC_BUILD_VERSION||'development');
    root.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.isComposing&&e.target.closest('.mw-visual-code')){
        e.preventDefault();e.stopImmediatePropagation();try{visualAdapter().applyVisual($('.mw-visual-boundary').value);}catch(error){announceError(error);}return;
      }
      if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.isComposing&&e.target.closest('.mw-code')){
        e.preventDefault();e.stopImmediatePropagation();try{runDraft();}catch(error){announceError(error);}return;
      }
    },true);
    root.addEventListener('keydown',function(e){
      if(e.defaultPrevented){e.stopPropagation();return;}
      if(e.key==='Escape'&&visualizerOpen){e.preventDefault();e.stopImmediatePropagation();setVisualizer(false);return;}
      if($('.mw-chat-settings').open){
        // The native modal owns focus trapping; Escape must not close Create.
        if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();$('.mw-chat-settings').close();return;}
        e.stopPropagation();return;
      }
      if(e.key==='Tab'&&!e.defaultPrevented){
        var focusable=Array.from(root.querySelectorAll('button,input,select,textarea,a[href],[tabindex],[contenteditable=true],summary')).filter(function(el){
          return !el.disabled&&el.tabIndex>=0&&!el.closest('[hidden],[inert]')&&el.getClientRects().length>0;
        });
        var first=focusable[0],last=focusable[focusable.length-1];
        if(first&&((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last))){e.preventDefault();(e.shiftKey?last:first).focus();}
      }
      if(e.key==='Escape'&&!e.ctrlKey&&!e.metaKey){
        e.preventDefault();e.stopImmediatePropagation();
        if(chatIsOpen())setChatOpen(false,false);
        // Composition is the primary product now. Escape never leaves it for
        // radio or starts another song; Listen is an explicit separate action.
        return;
      }
      if(e.code==='Space'&&!e.target.closest('input,textarea,select,button,[contenteditable=true]')){
        e.preventDefault();try{if(audioState.status==='playing')engine().musicPause(true);else if(snap().validated)activate(snap().validated,true);}catch(error){announceError(error);}
      }
      e.stopPropagation();
    });
    root.addEventListener('click',function(e){
      var tab=e.target.closest('button[data-view]');if(tab){selectView(tab.dataset.view);return;}
      var b=e.target.closest('[data-action]');if(!b)return;
      if(b.dataset.action==='stage-fullscreen'){fullscreenStage();return;}
      if(b.dataset.action==='project-handoff'){try{sendProject();}catch(error){status('Project transfer could not start. Check project size and popup permissions.');}return;}
      Promise.resolve().then(function(){return action(b.dataset.action);}).catch(announceError);
    });
    $('.mw-seek').addEventListener('change',function(){engine().musicSeek(+this.value);});
    $('.mw-client').addEventListener('change',function(){if(connection)renderConnection(connection.state());});
    ['.mw-scope','.mw-lock','.mw-region'].forEach(function(s){$(s).addEventListener('change',agentPolicyChanged);});
    G.addEventListener('storage',function(e){if(e.key===KEY&&root&&!root.hidden){conflict=true;invalidateAgent();renderProposal();renderState();status('Another tab changed this project. Download this draft before reloading.');}});
    G.addEventListener('beforeunload',function(e){if(conflict||saveTimer||unsaved){save();e.preventDefault();e.returnValue='';}});
  }
  async function action(name){
    if(name==='toggle-chat')setChatOpen(!chatIsOpen(),true);
    else if(name==='hide-chat')setChatOpen(false,false);
    else if(name==='chat-settings')$('.mw-chat-settings').showModal();
    else if(name==='chat-settings-close')$('.mw-chat-settings').close();
    else if(name==='transfer-accept')await acceptTransfer();
    else if(name==='transfer-cancel'){
      if(inboundTransfer)inboundTransfer.cancel();inboundTransfer=null;$('.mw-transfer-offer').hidden=true;
    }
    else if(name==='chat-unlock')await updateChatAccess('POST');
    else if(name==='chat-logout')await updateChatAccess('DELETE');
    else if(name==='chat-access-refresh')await updateChatAccess('GET');
    else if(name==='copy-mcp'){
      if(!connection||!connection.state().available||location.protocol!=='https:')throw Error('MCP endpoint unavailable');
      await navigator.clipboard.writeText(location.origin+'/api/mcp');status('Copied remote MCP endpoint. Add it in your agent, then refresh clients.');
    }
    else if(name==='connect'){if(connection)await connection.connect($('.mw-client').value);}
    else if(name==='disconnect'){if(connection)connection.disconnect();}
    else if(name==='refresh-clients'){if(connection)await connection.refresh();}
    else if(name==='new-loop')newLoop();
    else if(name==='load-cycle-example')await loadCycleExample();
    else if(name==='apply')runDraft();
    else if(name==='undo'||name==='redo')applied(project[name]());
    else if(name==='play'){var v=snap().validated;if(v)activate(v,true);}
    else if(name==='pause')engine().musicPause(audioState.status!=='paused');
    else if(name==='stop'){resetAudio();renderState();}
    else if(name==='close')close();
    else if(name==='listen')close({listen:true});
    else if(name==='visualizer')setVisualizer(!visualizerOpen);
    else if(name==='visual-apply')visualAdapter().applyVisual($('.mw-visual-boundary').value);
    else if(name==='visual-cancel')visualAdapter().cancelVisual();
    else if(name==='visual-freeze')visualAdapter().freezeVisuals(!visualAdapter().snapshot().visual.frozen);
    else if(name==='visual-blackout')visualAdapter().blackoutVisuals(!visualAdapter().snapshot().visual.blackout);
    else if(name==='visual-reset')visualAdapter().resetVisuals();
    else if(name==='visual-panic'){visualAdapter().panicVisuals();resetAudio();renderState();}
    else if(name==='chart-reset'){chartRange=null;$('.mw-notes').scrollLeft=0;renderNotes();}
    else if(name==='native-pick'||name==='native-json'||name==='native-resume'){
      if(!G.CT_LSDJ_NATIVE_EDITOR)throw Error('Native format tools are unavailable');
      resetAudio();renderState();
      G.CT_LSDJ_NATIVE_EDITOR[name==='native-pick'?'pick':name==='native-json'?'pickJson':'resume']();
    }
    else if(name==='generate')generate();
    else if(name==='chat')await requestChat();
    else if(name==='cancel'){cancelChat('rejected');proposal={status:'rejected',explanation:'Request cancelled'};renderProposal();renderState();}
    else if(name==='save'){
      if(transferProtected){
        if(!storage||conflict){status('Cannot safely replace the saved project. Download this copy to keep your edits.');return;}
        if(!G.confirm('Save this temporary copy as the browser recovery project? Any existing saved draft will be replaced. Cancel and download any project you want to keep first.')){
          status('This is a temporary copy. Existing saved project preserved.');return;
        }
        var savingProject=project;transferProtected=false;await save();
        if(project!==savingProject)return;
        if(unsaved){transferProtected=true;status('The temporary copy could not be fully saved. Download it to keep your latest edits.');}
        else{
          $('.mw-transfer-description').textContent='Transferred project saved locally after your confirmation. Reload restores this draft and its last validated revision.';
          status('Project saved locally.');
        }
      }else await save();
    }
    else if(name==='download')download(project.serialize({includePrivate:true}),'chiptunes-project.json','application/json');
    else if(name==='share'){
      captureVisual(project);
      var text=project.serialize(),bytes=new TextEncoder().encode(text),visualOmitted=false;
      // Visual source is allowed 32 KiB, larger than the whole link budget.
      // Drop visuals to keep the music shareable rather than refusing outright.
      if(bytes.length>12000&&project.visual){
        visualOmitted=true;text=project.serialize({excludeVisual:true});bytes=new TextEncoder().encode(text);
      }
      if(bytes.length>12000)throw Error('Project is too large for a self-contained link. Download a project file.');
      var binary='';bytes.forEach(function(b){binary+=String.fromCharCode(b);});
      var link=location.origin+'/create#music='+encodeURIComponent(btoa(binary));
      await navigator.clipboard.writeText(link);
      status('Copied project link. '+(visualOmitted?'Visuals were too large for the link and were omitted; download a project file to keep them. ':'')+
        'Chat and private provenance excluded; opening does not play.');
    }else if(name==='open'){
      var importRun=++fileImportSerial,importOpen=openEpoch,importProject=project,importSave=saveEpoch;
      function currentImport(){return importRun===fileImportSerial&&importOpen===openEpoch&&project===importProject&&importSave===saveEpoch&&!root.hidden;}
      var input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.onchange=async function(){try{
        if(!currentImport())return;
        var file=input.files[0];if(!file)return;if(file.size>8388608)throw Error('Project file is too large');
        var serialized=await file.text();if(!currentImport())return;
        var loaded=check(api().restore(serialized,opts()));
        if(!G.confirm('Replace this workspace? Download the current project first to keep a copy.'))return;
        cancelChat();resetAudio();project=loaded.project;selection=null;proposal=null;agentInstance=G.crypto.randomUUID();
        restoreProjectVisuals();
        defaultProjectLoop();
        syncEditor();renderNotes();renderProposal();renderState();diagnostics(snap().diagnostics);scheduleSave();
      }catch(e){if(currentImport())announceError(e);}};input.click();
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
    var opening=++openEpoch;
    // Validate explicit links before touching recovery, playback or the route.
    var explicit=initial&&initial.explicit===true,importedProject=null;
    if(explicit){
      if(typeof initial.source!=='string')throw Error('An explicit import needs musical source');
      importedProject=api().create(initial.source,opts());
      if(!importedProject.snapshot().validated)throw Error('Shared musical source is invalid');
    }
    if(!root)build();
    var alreadyOpen=!root.hidden;
    if(alreadyOpen&&!explicit)return;
    if(explicit&&project&&unsaved){
      var importOwner=project,importDraft=snap().draftEpoch;
      await save();
      if(opening!==openEpoch)return;
      if(project!==importOwner||snap().draftEpoch!==importDraft)throw Error('The draft changed while opening the song. Open the link again after saving.');
      if(unsaved)throw Error('Save or download the current draft before opening another song. Your edits are unchanged.');
    }
    var received=null,transport=G.CT_MUSIC_PROJECT_TRANSFER;
    // receive() must consume the capability before any workspace hash rewrite.
    if(transport&&location.origin===transport.RECEIVER_ORIGIN&&/^#music-transfer=/.test(location.hash))received=transport.receive();
    if(!alreadyOpen){
      previousFocus=document.activeElement;
      previousRoute=location.pathname==='/create'||/^#s=/.test(location.hash)?'/':location.pathname+location.search+location.hash;
    }
    if(!project){
      client=new G.CT_MUSIC_CHAT.Client();
      try{
        storage=api().createStorageAdapter(localStorage,KEY);var saved=storage.load();
        if(!saved.ok)throw Error(saved.message||'Storage unavailable');
        // Legacy entry supplies the current radio song as a fallback, not an
        // explicit import. Recovery wins; #music and file imports override below.
        if(saved.serialized){var restored=api().restore(saved.serialized,opts());if(restored.ok)project=restored.project;else{conflict=true;status(restored.message+' · Original saved project preserved');}}
      }catch(e){storage=null;status('Local storage unavailable. Download a project file to keep your work.');}
      if(!project&&!explicit&&!conflict&&G.CT_CREATE&&typeof G.CT_CREATE.songOf==='function')try{
        var legacy=localStorage.getItem('ct-create-draft');
        if(legacy){
          var legacySong=G.CT_CREATE.songOf(legacy),legacyState=G.CT_CREATE.docState(legacy);
          if(!legacySong||!legacyState)throw Error('Legacy draft could not be decoded');
          project=api().create(G.CT_MUSIC_LANGUAGE.materialize(legacySong.gb,{tempo:legacySong.bpm,bars:legacySong.bars,title:legacySong.title,
            tempoAt:legacyState.tempoAt||[],stepsPerBar:legacyState.grid||16,swing:!!legacyState.swing}),opts());
          unsaved=true;status('Recovered your previous composition as exact source. The original legacy draft is preserved.');
        }
      }catch(e){status('Previous composition could not be recovered. Its original browser record is preserved.');}
      if(!project){
        // The legacy entry deliberately supplies a song; preserve it exactly.
        // Only a fresh open without an initial song starts authored patterns.
        if(initial&&!explicit){
          var initialSettings=Object.assign({},initial.settings||{});
          if(initialSettings.stepsPerBar==null&&initialSettings.grid!=null)initialSettings.stepsPerBar=initialSettings.grid;
          project=api().create(G.CT_MUSIC_LANGUAGE.materialize(initial.gb,initialSettings),opts());
        }else{project=loopProject();$('.mw-loop').checked=true;}
        unsaved=true;
      }
      var shared=location.hash.match(/^#music=(.+)$/);
      if(shared){try{
        if(shared[1].length>20000)throw Error('Share is too large');
        var decoded=atob(decodeURIComponent(shared[1])),bytes=Uint8Array.from(decoded,function(c){return c.charCodeAt(0);});
        var imported=check(api().restore(new TextDecoder().decode(bytes),opts()));project=imported.project;unsaved=true;
        // Consume a successful public import once. Reload must recover edits,
        // not replay the original share over this browser's saved revision.
        history.replaceState(null,'','/create#music');
        if(saved&&saved.serialized){conflict=true;status('Shared project opened separately. Your existing local draft is preserved; download this project to keep it.');}
      }catch(e){announceError(e);}}
      defaultProjectLoop();
    }
    if(explicit){
      clearTimeout(saveTimer);saveTimer=null;saveEpoch++;
      if(connection)connection.disconnect();cancelChat('superseded');resetAudio();
      // Opening a link is not permission to overwrite this origin's recovery.
      transferProtected=true;project=importedProject;selection=null;proposal=null;unsaved=true;
      defaultProjectLoop();
      status('Shared song opened as a temporary copy. Existing saved draft preserved. Save draft locally asks before replacing it.');
    }
    if(G.CT_CREATE.stopForNative)G.CT_CREATE.stopForNative();engine().enterCreate();
    if(!/^#music(?:=|$)/.test(location.hash))history.replaceState(null,'',((location.pathname==='/'||location.pathname==='/create')?location.pathname:'/create')+location.search+'#music');
    agentInstance=G.crypto.randomUUID();root.hidden=false;if(!alreadyOpen)inerted=[];renderChatLayout();
    mountStage();
    restoreProjectVisuals();
    if(!chatAccess)chatAccess=new G.CT_MUSIC_CHAT.Access();
    chatUnlocked=false;updateChatAccess('GET');
    if(!connection&&G.CT_MUSIC_AGENT_CONNECTION)connection=G.CT_MUSIC_AGENT_CONNECTION.create({workspace:G.CT_MUSIC_WORKSPACE,onChange:renderConnection});
    if(connection&&!received)connection.open();
    if(received)stageTransfer(received);
    Array.from(document.body.children).forEach(function(el){if(el!==root&&el.id!=='nativeeditor'&&!(el.tagName==='INPUT'&&el.type==='file')&&!el.hasAttribute('inert')){el.setAttribute('inert','');inerted.push(el);}});
    if(!unsub)unsub=engine().onMusicState(onAudio);
    renderNotes();renderProposal();renderState();diagnostics(snap().diagnostics);selectView(view);
    $('[data-action=play]').focus();
    await ensureEditor();syncEditor();if(unsaved&&!conflict)scheduleSave();
    if(snap().validated&&snap().draft!==snap().validated.source)schedulePreview();
    try{await ensureChat();}catch(e){announceError(e);}
  }
  function close(options){
    if(!root||root.hidden)return;
    openEpoch++;
    // A closed workspace must not write stage activity back to the project it
    // was showing; the next open re-establishes the handover.
    visualOwner=null;visualRestoreFailed=false;
    cancelPreview();
    inlineContext=null;if(editor&&editor.cancelSourceGesture)editor.cancelSourceGesture();
    if(visualizerOpen)setVisualizer(false);
    if($('.mw-chat-settings').open)$('.mw-chat-settings').close();
    if(outboundTransfer)outboundTransfer.cancel();outboundTransfer=null;
    if(inboundTransfer)inboundTransfer.cancel();inboundTransfer=null;$('.mw-transfer-offer').hidden=true;
    chatAccessEpoch++;chatAccessBusy=false;chatUnlocked=false;$('.mw-owner-password').value='';if(chatAccess)chatAccess.cancel();
    if(connection)connection.close();
    save();cancelChat('superseded');try{resetAudio();}catch(e){announceError(e);}
    if(G.CT_CREATE_PRESENTATION&&G.CT_CREATE_PRESENTATION.unmount)G.CT_CREATE_PRESENTATION.unmount();
    root.hidden=true;inerted.forEach(function(el){el.removeAttribute('inert');});inerted=[];
    document.body.classList.remove('create-open');
    if(options&&options.listen)history.replaceState(null,'','/listen');
    else if(previousRoute)history.replaceState(null,'',previousRoute);
    if(unsub){unsub();unsub=null;}
    // Only a deliberate Listen action may start the secondary station path.
    if(typeof G._closeCreateReturn==='function')G._closeCreateReturn(options||{});
    if(previousFocus&&previousFocus.isConnected)previousFocus.focus();
  }
  G.CT_MUSIC_WORKSPACE={open:open,close:close,isOpen:function(){return !!root&&!root.hidden;},snapshot:function(){return project&&snap();},
    isVisualizerOpen:function(){return !!root&&!root.hidden&&visualizerOpen;},
    agentContext:agentContext,agentPropose:agentPropose,agentProposalStatus:agentProposalStatus,agentDisconnect:agentDisconnect};
})(typeof globalThis!=='undefined'?globalThis:window);
