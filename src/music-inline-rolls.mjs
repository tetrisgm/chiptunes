// A bounded view of supplied compiler output. No parsing, compilation or audio.
import {Decoration, EditorView, WidgetType} from '@codemirror/view';
import {StateEffect, StateField} from '@codemirror/state';

export const INLINE_LIMITS=Object.freeze({widgets:12,declarations:11,occurrences:24,notes:128,events:50000,source:1048576});
const names=['Melody','Harmony','Bass','Drums'];
const pitch=m=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][m%12]+(Math.floor(m/12)-1);
function spanOK(s,length){return s&&s.start&&s.end&&Number.isInteger(s.start.offset)&&Number.isInteger(s.end.offset)&&s.start.offset>=0&&s.end.offset>s.start.offset&&s.end.offset<=length;}
function spanCopy(s){return s?{start:{...s.start},end:{...s.end}}:undefined;}
const spanKey=s=>s.start.offset+':'+s.end.offset;
function createModel(context){
  const {source,compiled}=context||{};
  if(typeof source!=='string'||source.length>INLINE_LIMITS.source||!compiled?.gb||!Array.isArray(compiled.gb.notes)||
    !Array.isArray(compiled.mapping)||compiled.gb.notes.length>INLINE_LIMITS.events||compiled.mapping.length>INLINE_LIMITS.events||
    !Array.isArray(compiled.diagnostics)||compiled.diagnostics.some(d=>d.severity==='error'))return null;
  const declarations=new Map(),omitted=new Set();
  for(const m of compiled.mapping){
    if(m?.pattern==null)continue; // Empty-string pattern names are valid.
    if(typeof m.pattern!=='string')return null;
    const n=compiled.gb.notes[m.noteIndex];
    if(!Number.isInteger(m.noteIndex)||!n||!Number.isInteger(n.ch)||n.ch<0||n.ch>3||!Number.isInteger(n.frame)||n.frame<0||
      !Number.isInteger(n.frames)||n.frames<=0||!Number.isSafeInteger(n.frame+n.frames)||
      (n.ch!==3&&(!Number.isInteger(n.midi)||n.midi<0||n.midi>127))||!spanOK(m.span,source.length))return null;
    const call=spanOK(m.playSpan,source.length)?m.playSpan:spanOK(m.occurrenceSpan,source.length)?m.occurrenceSpan:null;
    // One roll beneath the pattern, with explicit compiled play/track choices.
    // Do not duplicate its notes beneath every track invocation.
    const locations=[['pattern',m.span]];
    for(const [kind,location] of locations){
      const key=kind+':'+spanKey(location);
      if(!declarations.has(key)){
        if(declarations.size>=INLINE_LIMITS.declarations){omitted.add(key);continue;}
        declarations.set(key,{key,kind,location:spanCopy(location),pattern:String(m.pattern).slice(0,100),groups:new Map(),variants:new Map(),omittedGroups:new Set(),count:0,selected:0});
      }
      const d=declarations.get(key);d.count++;
      const variantKey=(call?spanKey(call):'unknown')+':'+n.ch;
      const groupKey=variantKey+':'+String(m.occurrence);
      if(!d.groups.has(groupKey)){
        if(d.groups.size>=INLINE_LIMITS.occurrences){
          // Prefer one representative of each distinct play/channel before
          // spending the budget on repeats of the first track in source order.
          const spare=!d.variants.has(variantKey)&&Array.from(d.groups.values()).reverse().find(g=>d.variants.get(g.variantKey)>1);
          if(!spare){d.omittedGroups.add(groupKey);continue;}
          d.groups.delete(spare.key);d.variants.set(spare.variantKey,d.variants.get(spare.variantKey)-1);d.omittedGroups.add(spare.key);
        }
        d.variants.set(variantKey,(d.variants.get(variantKey)||0)+1);
        d.groups.set(groupKey,{key:groupKey,variantKey,channel:n.ch,track:String(m.track||names[n.ch]).slice(0,100),occurrence:m.occurrence,
          call:spanCopy(call),trackSpan:spanOK(m.trackSpan,source.length)?spanCopy(m.trackSpan):null,
          patternSpan:spanCopy(m.span),notes:[],count:0,min:127,max:0,start:Infinity,end:-Infinity,bounds:true,boundStart:null,boundEnd:null});
      }
      const g=d.groups.get(groupKey);g.count++;g.start=Math.min(g.start,n.frame);g.end=Math.max(g.end,n.frame+n.frames);
      if(n.ch!==3){g.min=Math.min(g.min,n.midi);g.max=Math.max(g.max,n.midi);}
      const a=m.occurrenceStartFrame,b=m.occurrenceEndFrame;
      if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||n.frame<a||n.frame+n.frames>b)g.bounds=false;
      else if(g.boundStart===null){g.boundStart=a;g.boundEnd=b;}
      else if(g.boundStart!==a||g.boundEnd!==b)g.bounds=false;
      if(g.notes.length<INLINE_LIMITS.notes)g.notes.push({noteIndex:m.noteIndex,channel:n.ch,frame:n.frame,end:n.frame+n.frames,midi:n.midi,inst:n.inst,
        pattern:String(m.pattern),occurrence:m.occurrence,span:spanCopy(m.span),tokenSpan:spanOK(m.tokenSpan,source.length)?spanCopy(m.tokenSpan):undefined,
        playSpan:spanCopy(call)});
    }
  }
  for(const d of declarations.values()){
    d.groups=Array.from(d.groups.values());
    for(const g of d.groups){if(g.bounds){g.start=g.boundStart;g.end=g.boundEnd;}g.notes.sort((a,b)=>a.frame-b.frame||a.noteIndex-b.noteIndex);}
  }
  return {source,declarations:Array.from(declarations.values()),omittedDeclarations:omitted.size};
}

const theme=EditorView.baseTheme({
  '.cm-inline-roll':{font:'12px/1.4 system-ui',color:'#d8dfeb',background:'#121b26',border:'1px solid #35445a',padding:'8px',maxWidth:'100%',boxSizing:'border-box'},
  '.cm-inline-roll header':{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'},
  '.cm-inline-roll select':{font:'inherit',color:'inherit',background:'#202c3c',maxWidth:'100%',padding:'3px',border:'1px solid #536078',borderRadius:'4px'},
  '.cm-inline-context':{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'5px 0',font:'11px/1.4 monospace',maxHeight:'48px',overflow:'auto'},
  '.cm-inline-scroll':{maxHeight:'180px',overflow:'auto',overscrollBehavior:'contain'},
  '.cm-inline-grid':{position:'relative',minWidth:'360px',marginLeft:'52px',background:'repeating-linear-gradient(90deg,transparent 0,transparent calc(25% - 1px),#8ca6c329 calc(25% - 1px),#8ca6c329 25%)'},
  '.cm-inline-row':{position:'absolute',height:'14px',left:'0',right:'0',borderTop:'1px solid #62718a26'},
  '.cm-inline-row-label':{position:'absolute',left:'-50px',width:'47px',fontSize:'10px',color:'#adbdd0',whiteSpace:'nowrap'},
  '.cm-inline-note':{position:'absolute',height:'12px',minWidth:'3px',padding:'0',border:'1px solid #75cbb0',borderRadius:'2px',background:'#2a715e',cursor:'pointer',boxSizing:'border-box'},
  '.cm-inline-note[data-sounding=true]':{background:'#d9f77c',borderColor:'#f0ffc1'},
  '.cm-inline-roll :focus-visible':{outline:'2px solid #ecfcb8',outlineOffset:'1px'},
  '.cm-inline-playhead':{position:'absolute',top:'0',bottom:'0',width:'2px',background:'#f6d978',pointerEvents:'none'},
  '.cm-inline-roll footer':{fontSize:'11px',color:'#a8bacd',paddingTop:'5px',whiteSpace:'normal'},
  '.cm-inline-omitted':{padding:'8px',font:'12px system-ui',color:'#e2c78a',whiteSpace:'normal'}
});

export function inlineRolls({onNoteSelect}={}){
  const effect=StateEffect.define(),mounted=new Set();
  let model=null,contextDoc=null,view=null,playback=null,latestPlayback=null,closed=false,contextEpoch=0;
  const usable=()=>!closed&&model&&view&&view.state.doc===contextDoc;
  function updatePlayback(record){
    // Bounded by 11 mounted rolls * 128 drawn notes, never by the full score.
    const p=playback,g=record.group,active=!!p&&p.playing&&p.frame>=g.start&&p.frame<g.end;
    record.cursor.hidden=!active;
    if(active)record.cursor.style.left=((p.frame-g.start)/(g.end-g.start)*100)+'%';
    // Only the host's acknowledged chip-voice winners may be called sounding.
    // Interval overlap alone cannot detect a voice stolen by another pattern.
    for(const item of record.buttons){const sounding=active&&p.noteIndices.has(item.note.noteIndex);
      if(item.sounding!==sounding){item.sounding=sounding;item.dom.dataset.sounding=String(sounding);}}
  }
  function paint(record){
    const d=record.declaration,g=d.groups[d.selected];record.group=g;
    const scrollTop=record.scroll.scrollTop,scrollLeft=record.scroll.scrollLeft;
    record.grid.replaceChildren();record.buttons=[];
    const contextSpan=g.trackSpan||g.call;
    const excerpt=contextSpan?model.source.slice(contextSpan.start.offset,contextSpan.end.offset):'';
    record.context.textContent=(excerpt?excerpt.slice(0,350)+(excerpt.length>350?'…':''):'Play mapping unavailable')+
      (g.trackSpan?'\nTrack source: only operations before the selected play apply.':'\nCompiled pitches include transforms; full track transform span unavailable.');
    const rows=g.channel===3?[...new Set(g.notes.map(n=>n.inst))].sort((a,b)=>a-b):Array.from({length:g.max-g.min+1},(_,i)=>g.max-i);
    const rowIndex=new Map(rows.map((row,i)=>[row,i]));record.grid.style.height=Math.max(28,rows.length*14)+'px';
    for(const [i,row] of rows.entries()){
      const line=document.createElement('div');line.className='cm-inline-row';line.style.top=i*14+'px';
      const label=document.createElement('span');label.className='cm-inline-row-label';label.textContent=g.channel===3?'Noise '+row:pitch(row);line.append(label);record.grid.append(line);
    }
    for(const note of g.notes){
      const button=document.createElement('button');button.type='button';button.className='cm-inline-note';button.dataset.noteIndex=String(note.noteIndex);
      button.style.left=((note.frame-g.start)/(g.end-g.start)*100)+'%';button.style.width=((note.end-note.frame)/(g.end-g.start)*100)+'%';
      button.style.top=(rowIndex.get(g.channel===3?note.inst:note.midi)*14+1)+'px';
      const description=(g.channel===3?'Noise instrument '+note.inst:pitch(note.midi))+' · frames '+note.frame+'–'+note.end+' · '+g.track+' · occurrence '+String(note.occurrence==null?'unknown':note.occurrence+1);
      button.setAttribute('aria-label',description);button.title=description;
      button.addEventListener('click',()=>{
        if(!usable()||record.owner!==model)return;
        const source=model.source;
        // Host owns both source selection and agent-region policy. Do not
        // dispatch a second selection or infer authorization inside the view.
        onNoteSelect?.({source,noteIndex:note.noteIndex,channel:note.channel,fromFrame:note.frame,toFrame:note.end,
          pattern:note.pattern,occurrence:note.occurrence,span:spanCopy(note.span),tokenSpan:spanCopy(note.tokenSpan),playSpan:spanCopy(note.playSpan)});
      });
      record.buttons.push({note,dom:button,sounding:null});record.grid.append(button);
    }
    record.cursor=document.createElement('div');record.cursor.className='cm-inline-playhead';record.cursor.setAttribute('aria-hidden','true');record.grid.append(record.cursor);
    record.footer.textContent='Frames '+g.start+'–'+g.end+' · '+(g.bounds?'Full occurrence; gaps are rests/silence.':'Note extent only; rest bounds unavailable.')+
      (g.count>g.notes.length?' '+(g.count-g.notes.length)+' additional notes omitted; use the overview.':'')+
      (d.omittedGroups.size?' '+d.omittedGroups.size+' additional occurrences omitted; use the overview.':'');
    record.scroll.scrollTop=scrollTop;record.scroll.scrollLeft=scrollLeft;updatePlayback(record);view.requestMeasure();
  }
  class Roll extends WidgetType{
    constructor(declaration,context){super();this.declaration=declaration;this.context=context;}
    eq(other){return this.declaration===other.declaration&&this.context===other.context;}
    get estimatedHeight(){return 250;}
    toDOM(editor){
      const dom=document.createElement('section');dom.className='cm-inline-roll';dom.setAttribute('aria-label',this.declaration.kind+' roll '+this.declaration.pattern);dom.contentEditable='false';
      const header=document.createElement('header'),title=document.createElement('strong'),select=document.createElement('select');
      title.textContent=this.declaration.kind==='pattern'?'Pattern '+this.declaration.pattern:'Track occurrence';select.setAttribute('aria-label','Track and occurrence');
      this.declaration.groups.forEach((g,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=names[g.channel]+' / '+g.track+' · occurrence '+(g.occurrence==null?'unknown':g.occurrence+1)+' · frame '+g.start+' · call '+(g.call?.start.line||'?');select.append(option);});
      select.value=String(this.declaration.selected);header.append(title,select);dom.append(header);
      const context=document.createElement('p'),scroll=document.createElement('div'),grid=document.createElement('div'),footer=document.createElement('footer');
      context.className='cm-inline-context';scroll.className='cm-inline-scroll';scroll.tabIndex=0;scroll.setAttribute('aria-label','Piano roll; scroll for pitches and time');grid.className='cm-inline-grid';scroll.append(grid);dom.append(context,scroll,footer);
      const record={dom,owner:this.context,declaration:this.declaration,context,scroll,grid,footer,group:null,buttons:[],cursor:null};mounted.add(record);dom._inlineRecord=record;
      select.addEventListener('change',()=>{if(!usable()||record.owner!==model)return;this.declaration.selected=+select.value;paint(record);});
      paint(record);return dom;
    }
    destroy(dom){mounted.delete(dom._inlineRecord);}
  }
  class Omitted extends WidgetType{
    constructor(count){super();this.count=count;}
    eq(other){return other.count===this.count;}
    toDOM(){const dom=document.createElement('div');dom.className='cm-inline-omitted';dom.textContent=this.count+' additional pattern declarations omitted from inline rolls. Use the whole-song overview.';return dom;}
  }
  const field=StateField.define({
    create:()=>Decoration.none,
    update(value,tr){
      if(tr.docChanged)return Decoration.none;
      for(const e of tr.effects)if(e.is(effect))return e.value;
      return value;
    },provide:f=>EditorView.decorations.from(f)
  });
  return {
    extensions:[field,theme,EditorView.updateListener.of(update=>{if(update.docChanged){contextEpoch++;model=null;contextDoc=null;playback=null;latestPlayback=null;}})],
    attach(editor){view=editor;},
    setContext(context){
      if(closed)return {ok:false,code:'destroyed'};
      const epoch=++contextEpoch,doc=view.state.doc;
      const next=context&&context.source===doc.toString()?createModel(context):null;
      playback=null;model=null;contextDoc=null;
      // Hosts may call here inside onChange/onSelectionChange. Always defer
      // the effect so no nested CodeMirror update can occur. Both epoch and
      // immutable Text identity reject effects made stale by edits or disposal.
      queueMicrotask(()=>{
        if(closed||epoch!==contextEpoch||view.state.doc!==doc)return;
        model=next;contextDoc=next?doc:null;
        const ranges=[];
        if(model){
          for(const d of model.declarations){const at=doc.lineAt(d.location.end.offset).to;ranges.push(Decoration.widget({widget:new Roll(d,model),block:true,side:1}).range(at));}
          if(model.omittedDeclarations)ranges.push(Decoration.widget({widget:new Omitted(model.omittedDeclarations),block:true,side:2}).range(ranges[0]?.from||0));
        }
        view.dispatch({effects:effect.of(Decoration.set(ranges,true))});
        playback=usable()&&latestPlayback?.source===model.source?latestPlayback:null;
        for(const record of mounted)updatePlayback(record);
      });
      return context&&!next?{ok:false,code:'invalid-or-stale-context'}:{ok:true,widgets:next?next.declarations.length+(next.omittedDeclarations?1:0):0,omittedDeclarations:next?.omittedDeclarations||0};
    },
    setPlayback(value){
      if(closed)return;
      latestPlayback=value&&typeof value.source==='string'&&Number.isFinite(value.frame)&&value.frame>=0?
        {source:value.source,frame:value.frame,playing:value.playing===true,
          noteIndices:new Set(Array.isArray(value.noteIndices)&&value.noteIndices.length<=4&&value.noteIndices.every(i=>Number.isInteger(i)&&i>=0&&i<INLINE_LIMITS.events)?value.noteIndices:[])}:null;
      playback=usable()&&latestPlayback?.source===model.source?latestPlayback:null;
      for(const record of mounted)updatePlayback(record);
    },
    destroy(){closed=true;contextEpoch++;model=null;contextDoc=null;playback=null;latestPlayback=null;mounted.clear();}
  };
}
