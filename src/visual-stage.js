// Independent visual draft/live state. No music mutation or autonomous clock.
(function(G,factory){
  var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else G.CT_VISUAL_STAGE=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function identity(t){return t?[t.epoch,t.activation,t.revision,t.discontinuity].join(':'):null;}
  function create(options){
    options=options||{};
    var language=options.language,renderer=options.renderer;
    if(!language||!renderer)throw Error('Visual language and renderer required');
    var presets=language.PRESETS,scenes=presets.map(function(p){return {id:p.id,label:p.label};}).concat(options.games||[]);
    var draft=presets[0].source,draftScene=presets[0].id,live=null,pending=null,suspended=null;
    var error=null,renderError=null,diagnostics=[],notice='',frozen=false,blackout=false,revision=0,reanchor=0,lastFrame=null;
    function changed(){if(options.onChange)options.onChange();}
    function find(id){return presets.find(function(p){return p.id===id;});}
    function isProgram(id){return id.indexOf('visual:')===0;}
    function snapshot(){
      var rs=renderer.snapshot();
      return {scene:live?live.scene:'off',enabled:!!live&&live.scene!=='off',scenes:copy(scenes),
        draftScene:draftScene,draft:draft,liveSource:live&&live.source||'',revision:revision,
        state:(error||renderError)?'error':pending?'queued':(!live||draftScene!==live.scene||(isProgram(draftScene)&&draft!==live.source))?'draft':'live',
        error:error||renderError,diagnostics:copy(diagnostics),notice:notice,frozen:frozen,blackout:blackout,
        edited:!!live&&!!live.program&&(!find(live.scene)||find(live.scene).source!==live.source),
        controls:live&&live.program?live.program.controls.map(function(c){return Object.assign({},c,{value:rs.values[c.name]});}):[],
        pending:pending?{scene:pending.scene,label:label(pending.scene),bar:pending.targetStep/16+1,step:pending.targetStep}:null,
        renderer:rs};
    }
    function label(id){var s=scenes.find(function(s){return s.id===id;});return s?s.label:id==='off'?'Off':'Custom visual';}
    function candidate(){
      if(!isProgram(draftScene))return {scene:draftScene,source:'',program:null,values:{}};
      var compiled=language.compile(draft);
      if(!compiled.ok){diagnostics=compiled.diagnostics||[];error=diagnostics[0]&&diagnostics[0].message||'Invalid visual program';return null;}
      var values={},previous=renderer.snapshot().values||{};
      var same=live&&(draftScene===live.scene||(live.scene==='off'&&suspended&&draftScene===suspended.scene));
      compiled.program.controls.forEach(function(c){values[c.name]=same&&Object.prototype.hasOwnProperty.call(previous,c.name)?Math.max(c.min,Math.min(c.max,previous[c.name])):c.value;});
      return {scene:draftScene,source:draft,program:compiled.program,values:values};
    }
    function activate(next){
      // The renderer validates before mutation. Recoverable errors leave live
      // state and its last complete framebuffer unchanged.
      try{if(next.program)renderer.apply(next.program,next.values);}
      catch(e){error='Visual apply failed: '+e.message;return false;}
      if(next.scene==='off'&&live&&live.scene!=='off')suspended=live;
      live=next;revision++;pending=null;error=null;renderError=null;diagnostics=[];notice='';reanchor++;
      return true;
    }
    function apply(when,t){
      if(when!=='now'&&when!=='bar')throw Error('Visual boundary must be now or bar');
      error=null;diagnostics=[];notice='';var next=candidate();
      if(!next){changed();return snapshot();}
      if(when==='bar'){
        if(!t||t.paused||t.status!=='playing'||!t.grid||!Number.isFinite(t.grid.gstep)){
          error='Play music before queueing a visual for the next bar.';
        }else pending=Object.assign(next,{identity:identity(t),targetStep:(Math.floor(t.grid.gstep/16)+1)*16});
      }else activate(next);
      changed();return snapshot();
    }
    function selectDraft(id){
      var preset=find(id);
      if(id!=='off'&&id!=='visual:custom'&&!scenes.some(function(s){return s.id===id;}))throw Error('Unknown visual scene');
      if(live&&live.scene==='off'&&suspended&&id===suspended.scene&&suspended.program)draft=suspended.source;
      else if(preset)draft=preset.source;
      draftScene=id;error=null;diagnostics=[];notice='';changed();return snapshot();
    }
    function setDraft(source){
      if(typeof source!=='string'||source.length>32768)throw Error('Visual source is limited to 32 KiB');
      draft=source;
      // Preserve a preset identity while editing it: it is an editable program,
      // not a preset engine. Switching away and back explicitly reloads it.
      if(!isProgram(draftScene))draftScene='visual:custom';
      error=null;diagnostics=[];notice='';changed();return snapshot();
    }
    function cancel(reason){pending=null;notice=reason||'Queued visual cancelled.';changed();return snapshot();}
    function observe(t){
      if(pending){
        if(!t||!['playing','paused'].includes(t.status)||identity(t)!==pending.identity)cancel('Queued visual cancelled: music timeline changed.');
        else if(!t.paused&&t.grid.gstep>=pending.targetStep){activate(pending);changed();}
      }
    }
    function tick(t,clock){
      observe(t);
      if(!live||!live.program)return {canvas:null,error:error};
      if(frozen)return lastFrame||{canvas:null,error:error};
      var result=renderer.render({contextTime:t&&t.renderContextTime||0,paused:!t||t.paused,
        identity:identity(t)+':'+reanchor,grid:t&&t.grid||{},clock:clock||{noteOns:[]}});
      lastFrame=result;
      var currentError=result.error?String(result.error):null;
      if(currentError!==renderError){renderError=currentError;changed();}
      return result;
    }
    function setControl(name,value){
      if(!live||!live.program)throw Error('This scene has no visual program controls');
      var result=renderer.setControl(name,value);
      if(result&&result.ok===false)throw Error(result.error||'Invalid visual control');
      changed();return snapshot();
    }
    // Portable visual composition data: the live scene, its edited source and
    // its named control values. Draft-only edits, queued boundaries, freeze,
    // blackout and renderer internals are session state and are NOT saved.
    function serialize(){
      if(!live)return null;
      // Off suspends a world rather than discarding it, so saving while Off
      // must carry the suspended program, not an empty scene. Otherwise
      // switching visuals Off and saving would silently destroy the source and
      // control values the performer had applied.
      var off=live.scene==='off',subject=off?suspended:live;
      if(!subject)return off?{scene:'off',source:'',values:{},off:true}:null;
      var values={},current=renderer.snapshot().values||{},tuned=false;
      if(subject.program)subject.program.controls.forEach(function(c){
        if(Object.prototype.hasOwnProperty.call(current,c.name)){
          values[c.name]=current[c.name];
          if(current[c.name]!==c.value)tuned=true;
        }
      });
      // The stage always boots into the first preset, so an untouched default
      // is not composition data. Saving it would give every music-only project
      // a visual block it never asked for and change records that should be
      // byte-identical to ones written before visuals were persisted.
      if(!off&&subject.scene===presets[0].id&&subject.source===presets[0].source&&!tuned)return null;
      var out={scene:subject.scene,source:subject.program?subject.source:'',values:values};
      if(off)out.off=true;
      return out;
    }
    // A saved visual is untrusted input from a project record. It may name a
    // scene this build no longer has, or a program that no longer compiles;
    // neither may prevent the stage from starting.
    function toDefault(){
      draft=presets[0].source;draftScene=presets[0].id;
      error=null;renderError=null;diagnostics=[];
      activate(candidate());
    }
    function restoreSaved(saved){
      // Absent is not malformed: a project that never used visuals opens on the
      // default scene silently, while a broken saved visual says so.
      if(saved===null||saved===undefined){toDefault();notice='';return true;}
      try{
        if(typeof saved!=='object'||typeof saved.scene!=='string')throw Error('Malformed saved visual');
        var id=saved.scene;
        if(id!=='off'&&!isProgram(id)&&!scenes.some(function(s){return s.id===id;}))throw Error('Unknown saved visual scene');
        if(isProgram(id)){
          if(typeof saved.source!=='string'||saved.source.length>32768)throw Error('Invalid saved visual source');
          // A preset this build no longer ships must not discard the saved
          // program: the source is self-contained, so keep it and relabel it
          // as an edited custom scene rather than retaining an id that
          // selectDraft would later reject.
          if(id!=='visual:custom'&&!scenes.some(function(s){return s.id===id;}))id='visual:custom';
          draft=saved.source;
        }else{var preset=find(id);if(preset)draft=preset.source;}
        draftScene=id;
        var next=candidate();
        if(!next)throw Error('Saved visual no longer compiles');
        if(saved.values&&typeof saved.values==='object'&&next.program)next.program.controls.forEach(function(c){
          var v=saved.values[c.name];
          if(typeof v==='number'&&Number.isFinite(v))next.values[c.name]=Math.max(c.min,Math.min(c.max,v));
        });
        if(!activate(next))throw Error('Saved visual could not be applied');
        // Restore the suspended world first, then suspend it again, so Off
        // reopens Off while still retaining the program behind it.
        if(saved.off===true){draftScene='off';if(!activate(candidate()))throw Error('Saved visual could not be suspended');}
        return true;
      }catch(e){
        toDefault();
        notice='Saved visual could not be restored; the default scene is running.';
        return false;
      }
    }
    function freeze(value){frozen=!!value;reanchor++;changed();return snapshot();}
    function mask(value){blackout=!!value;changed();return snapshot();}
    function reset(){renderer.reset();lastFrame=null;reanchor++;notice='Visual state reset; music unchanged.';changed();return snapshot();}
    function panic(){pending=null;blackout=true;notice='Panic: visual output blacked out.';changed();return snapshot();}
    if(options.restore)restoreSaved(options.restore);else activate(candidate());
    return {snapshot:snapshot,setDraft:setDraft,selectDraft:selectDraft,apply:apply,cancel:cancel,observe:observe,tick:tick,
      serialize:serialize,restoreSaved:function(saved){var ok=restoreSaved(saved);changed();return ok;},
      setScene:function(id,t){selectDraft(id);return apply('now',t);},setControl:setControl,
      freeze:freeze,blackout:mask,reset:reset,panic:panic};
  }
  return Object.freeze({create:create});
});
