// Literal-only source edits. Supplied compiler metadata is the sole authority.
import {EditorView, Decoration, WidgetType} from '@codemirror/view';
import {EditorState, StateField, StateEffect, Annotation, Transaction} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';

export const SOURCE_CONTROL_LIMITS=Object.freeze({controls:24,descriptors:50000,source:1048576});
const bounds={gate:[.001,1,false,.001],velocity:[0,1,false,.01],transpose:[-128,128,true,1]};
const numeric=/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
// Scan trivia only between compiler-provided boundaries. This does not parse
// expressions or discover calls; total scanning is bounded across descriptors.
function directCall(source,kind,call,literal,budget){
  let i=call[0];
  function trivia(end){
    while(i<end){
      if(--budget.left<0)return false;
      if(/\s/.test(source[i])){i++;continue;}
      if(source[i]==='/'&&source[i+1]==='/'){
        i+=2;while(i<end&&source[i]!=='\n'){if(--budget.left<0)return false;i++;}continue;
      }
      if(source[i]==='/'&&source[i+1]==='*'){
        i+=2;while(i<end&&!(source[i]==='*'&&source[i+1]==='/')){if(--budget.left<0)return false;i++;}
        if(i+2>end)return false;i+=2;continue;
      }
      break;
    }
    return true;
  }
  if(!trivia(literal[0]))return false;
  if(source[i]==='.'){i++;if(!trivia(literal[0]))return false;}
  if(source.slice(i,i+kind.length)!==kind)return false;i+=kind.length;
  if(!trivia(literal[0])||source[i++]!=='('||!trivia(literal[0])||i!==literal[0])return false;
  i=literal[1];
  return trivia(call[1])&&source[i++]===')'&&trivia(call[1])&&i===call[1];
}
const offsets=(s,n)=>s&&Number.isInteger(s.start?.offset)&&Number.isInteger(s.end?.offset)&&s.start.offset>=0&&s.end.offset>s.start.offset&&s.end.offset<=n?[s.start.offset,s.end.offset]:null;
function descriptors(context){
  const {source,compiled}=context;
  if(typeof source!=='string'||source.length>SOURCE_CONTROL_LIMITS.source||!compiled?.gb||
    !Array.isArray(compiled.controls)||compiled.controls.length>SOURCE_CONTROL_LIMITS.descriptors||
    !Array.isArray(compiled.diagnostics)||compiled.diagnostics.some(d=>d.severity==='error'))return null;
  const result=[],seen=new Set(),budget={left:source.length*2+compiled.controls.length*32};let count=0;
  for(const c of compiled.controls){
    const b=Object.hasOwn(bounds,c?.kind)?bounds[c.kind]:null,literal=offsets(c?.literalSpan,source.length),call=offsets(c?.callSpan,source.length),owner=offsets(c?.ownerSpan,source.length);
    if(!b||!literal||!call||!owner||!['pattern','track'].includes(c.ownerType)||typeof c.ownerName!=='string'||
      (c.ownerType==='track'&&c.kind!=='transpose')||c.min!==b[0]||c.max!==b[1]||c.integer!==b[2]||
      owner[0]>call[0]||owner[1]<call[1]||call[0]>literal[0]||call[1]<literal[1])return null;
    const text=source.slice(...literal);
    // Verify the descriptor denotes one direct call, never an expression.
    if(!numeric.test(text)||!Number.isFinite(c.value)||Number(text)!==c.value||c.value<b[0]||c.value>b[1]||
      (b[2]&&!Number.isInteger(c.value))||!directCall(source,c.kind,call,literal,budget))return null;
    const key=literal.join(':');if(seen.has(key))continue;seen.add(key);count++;
    if(result.length<SOURCE_CONTROL_LIMITS.controls)result.push({kind:c.kind,label:c.ownerType+' '+c.ownerName+' '+c.kind+(c.ownerType==='pattern'?' (all uses)':''),from:literal[0],to:literal[1],pos:call[1],text,value:c.value,b});
  }
  result.sort((a,b)=>a.pos-b.pos);
  return {records:result,omitted:count-result.length};
}

// Attach once. Context/null may be supplied from an EditorView update listener:
// decoration dispatches are deferred and checked against the captured document.
// null retains only an active, exact own-edit chain; cancelGesture revokes it too.
export function sourceControls(){
  const replace=StateEffect.define(),own=Annotation.define();
  let view=null,dead=false,epoch=0,records=[],active=null,projectId,contextDoc=null,pending=null,omitted=0,focusBookmark=null;
  function focusMoved(event){if(focusBookmark&&event.target!==focusBookmark.element)focusBookmark=null;}
  function disable(){for(const r of records)if(r.dom)for(const input of r.dom.querySelectorAll('input'))input.disabled=!!active&&active.record!==r||!active&&contextDoc!==view?.state.doc;}
  function authorized(r){return !dead&&view&&records.includes(r)&&(active?active.record===r&&active.doc===view.state.doc:contextDoc===view.state.doc);}
  function begin(r){
    if(!authorized(r))return false;
    if(!active)active={record:r,doc:view.state.doc,time:Date.now(),changed:false};
    return true;
  }
  function input(r,value){
    if(!begin(r)||!numeric.test(value))return;
    const n=Number(value);
    if(!Number.isFinite(n)||n<r.b[0]||n>r.b[1]||(r.b[2]&&!Number.isInteger(n)))return;
    if(view.state.doc.sliceString(r.from,r.to)!==r.text){cancelGesture();return;}
    if(n===Number(r.text))return; // Mount/no-op preserves authored precision, exponent and sign.
    const text=String(n),gesture=active;
    // History's join predicate remains time-gated. A shared gesture timestamp
    // plus explicit boundaries joins slow inputs without changing global delay.
    const annotations=[own.of(gesture),Transaction.userEvent.of('input.type.source-control'),Transaction.time.of(gesture.time)];
    if(!gesture.changed)annotations.push(isolateHistory.of('before'));
    gesture.changed=true;
    view.dispatch({changes:{from:r.from,to:r.to,insert:text},annotations});
    if(active===gesture&&r.dom){r.dom.querySelector('output').textContent=text;for(const el of r.dom.querySelectorAll('input'))el.value=text;}
  }
  function finish(){
    if(!active)return;
    const r=active.record,focused=view.dom.ownerDocument.activeElement;
    if(active.changed&&r.dom?.contains(focused))focusBookmark={doc:view.state.doc,projectId,from:r.from,to:r.to,kind:r.kind,type:focused.type,element:focused};
    const changed=active.changed;active=null;
    if(changed&&view&&!dead)view.dispatch({annotations:isolateHistory.of('after')});
    if(pending){const next=pending;pending=null;setContext(next);}
    else if(contextDoc!==view?.state.doc)clear();
    else disable();
  }
  class Control extends WidgetType{
    constructor(record){super();this.record=record;}
    eq(other){return other.record===this.record;}
    toDOM(){
      const r=this.record,dom=document.createElement('span');r.dom=dom;dom.className='cm-source-control';dom.contentEditable='false';
      const label=document.createElement('span');label.textContent=r.kind+' ';dom.append(label);
      for(const type of ['range','number']){
        const el=document.createElement('input');el.type=type;el.min=String(r.b[0]);el.max=String(r.b[1]);el.step=String(r.b[3]);el.value=r.text;
        el.setAttribute('aria-label',r.label+(type==='range'?' slider':' value'));
        el.addEventListener('pointerdown',()=>{if(begin(r))active.held=true;});
        el.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)&&begin(r))active.held=true;if(e.key==='Escape'){e.stopPropagation();finish();}});
        el.addEventListener('input',()=>input(r,el.value));
        el.addEventListener('change',()=>{if(active?.record===r&&!active.held)finish();});
        for(const event of ['pointerup','pointercancel','lostpointercapture','keyup','blur'])el.addEventListener(event,()=>{if(active?.record===r)finish();});
        dom.append(el);
      }
      const output=document.createElement('output');output.textContent=r.text;dom.append(output);return dom;
    }
    ignoreEvent(){return true;}
  }
  class Omission extends WidgetType{
    constructor(count){super();this.count=count;}
    eq(other){return other.count===this.count;}
    toDOM(){const el=document.createElement('span');el.className='cm-source-controls-omitted';el.textContent=` ${this.count} more source controls omitted; edit their literals in code.`;return el;}
  }
  const field=StateField.define({create:()=>Decoration.none,update(value,tr){
    if(tr.docChanged)value=tr.annotation(own)&&tr.annotation(own)===active?value.map(tr.changes):Decoration.none;
    for(const effect of tr.effects)if(effect.is(replace))value=effect.value;
    return value;
  },provide:f=>EditorView.decorations.from(f)});
  function draw(){
    const ticket=++epoch,doc=view?.state.doc;
    queueMicrotask(()=>{
      if(dead||!view||ticket!==epoch||view.state.doc!==doc)return;
      const items=records.map(r=>Decoration.widget({widget:new Control(r),side:1}).range(r.pos));
      if(omitted&&records.length)items.push(Decoration.widget({widget:new Omission(omitted),side:2}).range(records.at(-1).pos));
      view.dispatch({effects:replace.of(Decoration.set(items,true))});disable();
      const bookmark=focusBookmark;
      if(bookmark&&contextDoc===doc&&bookmark.doc===doc&&bookmark.projectId===projectId){
        const r=records.find(r=>r.from===bookmark.from&&r.to===bookmark.to&&r.kind===bookmark.kind);
        const focused=view.dom.ownerDocument.activeElement;
        focusBookmark=null;
        if(r&&(focused===view.dom.ownerDocument.body||focused===bookmark.element))r.dom?.querySelector(`input[type=${bookmark.type}]`)?.focus({preventScroll:true});
      }
    });
  }
  function clear(){records=[];contextDoc=null;omitted=0;draw();}
  function cancelGesture(isolate=true){
    focusBookmark=null;
    pending=null;const changed=active?.changed;active=null;
    const doc=view?.state.doc;
    if(isolate&&changed&&view&&!dead)queueMicrotask(()=>{if(!dead&&view&&view.state.doc===doc&&!active)view.dispatch({annotations:isolateHistory.of('after')});});
    clear();
  }
  function setContext(context){
    if(dead||!view)return {ok:false};
    if(context===null){contextDoc=null;pending=null;if(active){records=records.filter(r=>r===active.record);omitted=0;draw();}else clear();return {ok:true};}
    if(context.projectId==null){cancelGesture();return {ok:false};}
    if(projectId!==context.projectId){cancelGesture();projectId=context.projectId;}
    if(context.source!==view.state.doc.toString()){if(!active)clear();return {ok:false};}
    const model=descriptors(context);if(!model){cancelGesture();return {ok:false};}
    if(active){pending=context;return {ok:true,controls:model.records.length,omitted:model.omitted};}
    records=model.records;omitted=model.omitted;contextDoc=view.state.doc;draw();return {ok:true,controls:records.length,omitted};
  }
  const listener=EditorView.updateListener.of(update=>{
    if(!update.docChanged&&!update.selectionSet)return;
    for(const tr of update.transactions){
      if(tr.docChanged&&active&&tr.annotation(own)===active){
        for(const r of records){r.from=tr.changes.mapPos(r.from,-1);r.to=tr.changes.mapPos(r.to,1);r.pos=tr.changes.mapPos(r.pos,1);}
        active.record.text=tr.newDoc.sliceString(active.record.from,active.record.to);active.doc=tr.newDoc;contextDoc=null;pending=null;
      }else if(tr.docChanged||tr.selection){cancelGesture(false);break;}
    }
    disable();
  });
  return {extensions:[field,listener,EditorState.transactionExtender.of(tr=>
    active&&(tr.docChanged||tr.selection)&&tr.annotation(own)!==active?{annotations:isolateHistory.of('before')}:null),EditorView.baseTheme({
    '.cm-source-control':{display:'inline-flex',alignItems:'center',gap:'4px',padding:'2px 5px',font:'12px system-ui',border:'1px solid #738099',borderRadius:'4px',marginLeft:'6px'},
    '.cm-source-control input[type=range]':{width:'75px'},'.cm-source-control input[type=number]':{width:'70px'},
    '.cm-source-control output':{fontVariantNumeric:'tabular-nums'},'.cm-source-control :focus-visible':{outline:'2px solid currentColor'},
    '.cm-source-controls-omitted':{font:'12px system-ui'}
  })],attach(v){if(view||dead)throw Error('Source controls already attached or destroyed');view=v;view.dom.ownerDocument.addEventListener('focusin',focusMoved);},setContext,cancelGesture,
    destroy(){view?.dom.ownerDocument.removeEventListener('focusin',focusMoved);dead=true;epoch++;active=null;pending=null;records=[];contextDoc=null;focusBookmark=null;view=null;}};
}
