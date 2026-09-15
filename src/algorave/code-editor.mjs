import { minimalSetup } from 'codemirror';
import { EditorView, Decoration, WidgetType, keymap, lineNumbers } from '@codemirror/view';
import { parse } from 'acorn';
import { EditorState, ChangeSet, StateEffect, StateField, Compartment, Prec } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { StreamLanguage, bracketMatching, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { shader as glsl } from '@codemirror/legacy-modes/mode/clike';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { setDiagnostics } from '@codemirror/lint';

const activeNotes=StateEffect.define();
const setSliders=StateEffect.define();
const sliderMarks=StateField.define({
  create:()=>Decoration.none,
  update(value,tr){
    if(tr.docChanged){
      const mapped=[];
      for(let it=value.iter();it.value;it.next()){
        const spec=it.value.spec,from=tr.changes.mapPos(it.from,-1),to=tr.changes.mapPos(spec.to,1);
        if(to>from)mapped.push(Decoration.widget({...spec,to}).range(from));
      }
      value=Decoration.set(mapped,true);
    }
    for(const effect of tr.effects)if(effect.is(setSliders))value=effect.value;
    return value;
  },provide:field=>EditorView.decorations.from(field),
});
class SliderWidget extends WidgetType {
  constructor(config,onChange){super();Object.assign(this,config);this.onChange=onChange;this.id='slider_'+config.from;}
  toDOM(view){
    const input=document.createElement('input');input.type='range';input.className='cm-slider';
    input.setAttribute('aria-label','Slider value');input.min=this.min;input.max=this.max;
    input.step=this.step??(this.max-this.min)/1000;input.value=this.value;
    for(let it=view.state.field(sliderMarks).iter();it.value;it.next())if(it.value.spec.widget===this){input.value=view.state.doc.sliceString(it.from,it.value.spec.to);break;}
    input.style.cssText='width:64px;margin:0 6px;vertical-align:middle';
    input.disabled=view.state.facet(EditorState.readOnly);
    input.addEventListener('input',()=>{
      if(view.state.facet(EditorState.readOnly))return;
      let range;for(let it=view.state.field(sliderMarks).iter();it.value;it.next())if(it.value.spec.widget===this){range={from:it.from,to:it.value.spec.to};break;}
      if(!range)return;
      const next=input.value;
      view.dispatch({changes:{...range,insert:next}});
      this.onChange(this.id,Number(next));
    });
    return input;
  }
  ignoreEvent(){return true;}
}
const noteMarks=StateField.define({
  create:()=>Decoration.none,
  update(value,tr){
    if(tr.docChanged)value=Decoration.none;
    for(const effect of tr.effects)if(effect.is(activeNotes))value=Decoration.set(effect.value.filter(mark=>mark.start>=0&&mark.end<=tr.newDoc.length&&mark.end>mark.start).map(mark=>Decoration.mark({class:'cm-playing-note',attributes:{style:mark.style}}).range(mark.start,mark.end)),true);
    return value;
  },provide:field=>EditorView.decorations.from(field),
});
const musicHelp = {
  setcpm:'Cycles per minute. setcpm(30) gives four-beat cycles at 120 BPM.',
  note:'Pitched pattern, for example note("c3 [eb3 g3] ~ bb3").',
  s:'Sound pattern. Drums: bd, sd, hh, oh. Synths include sine and triangle; standard sample libraries load online.',
  bank:'Select a drum machine, for example s("bd*4").bank("tr909").',
  piano:'Play the standard sampled piano with pitch-aware panning, for example note("c4 e4 g4").piano().',
  xen:'Microtonal pitch sequence, for example freq("0 5 10".xen("19edo")).',
  gain:'Amplitude. Start quietly, for example .gain(.2).',
  fast:'Run a pattern faster, for example .fast(2).', slow:'Stretch a pattern in time, for example .slow(2).',
  lpf:'Low-pass cutoff in Hz, for example .lpf(800).', rev:'Reverse a pattern within its cycle.',
};
const visualHelp = {
  mainImage:'void mainImage(out vec4 color, in vec2 pixel)',
  iResolution:'Output width, height and pixel aspect ratio (vec3).',
  iTime:'Audio-aligned time in seconds (float).', iMouse:'Pixel coordinates and signed click position (vec4).',
  iChannel0:'First texture input. Image defaults to the 512×2 audio texture.',
  ctKick:'Envelope from scheduled bd hits. Use it to pulse a visual with the kick.',
  ctCycle:'Current musical cycle (float).', ctBeat:'Four-beat cycle phase, from 0 to 1.',
};
const colors = HighlightStyle.define([
  {tag:tags.keyword,color:'#c4a7e7'}, {tag:tags.string,color:'#a6d189'},
  {tag:[tags.number,tags.bool],color:'#efb879'}, {tag:tags.typeName,color:'#8cdae8'},
  {tag:tags.variableName,color:'#dae4f2'}, {tag:tags.function(tags.variableName),color:'#89b4fa'},
  {tag:[tags.operator,tags.punctuation],color:'#becbe0'}, {tag:tags.comment,color:'#8995ae'},
  {tag:tags.invalid,color:'#ff7e9a'},
]);
const theme = EditorView.theme({
  '&':{height:'100%',fontSize:'14px',backgroundColor:'transparent',color:'#e0e4f0'},
  '.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'1.65'},
  '.cm-content':{caretColor:'#c3b9ff',padding:'8px 0'},
  '.cm-gutters':{backgroundColor:'#101116',border:'none',color:'#656c80'},
  '.cm-lineNumbers .cm-gutterElement':{padding:'0 12px 0 0',minWidth:'24px'},
  '.cm-activeLine':{backgroundColor:'#ffffff04'},
  '&.cm-focused':{outline:'none'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground':{backgroundColor:'#7777b944'},
  '.cm-tooltip':{backgroundColor:'#232632',color:'#e9e9ee',border:'1px solid #555969'},
  '.cm-tooltip-autocomplete > ul':{fontFamily:'inherit'},
}, {dark:true});

export function codeEditor(parent, { language, label }) {
  const readonly = new Compartment(), help = language === 'music' ? musicHelp : visualHelp;
  let previousMarks='',highlightSource=null,highlightChanges=null,sliderSource=null;
  let muted = false, destroyed = false, serial = 0, readOnly = false, documentKey = 'default';
  const documents = new Map();
  const editor = { oninput:null, onfocus:null, onRun:null };
  const extensions = [
    minimalSetup, noteMarks, sliderMarks, lineNumbers(), language === 'music' ? javascript() : StreamLanguage.define(glsl),
    bracketMatching(), closeBrackets(), syntaxHighlighting(colors), theme,
    readonly.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
    EditorView.contentAttributes.of({'aria-label':label,'aria-multiline':'true',spellcheck:'false'}),
    Prec.highest(keymap.of([{key:'Mod-Enter',run:() => { editor.onRun?.(); return true; }}])),
    autocompletion({override:[context => {
      const word = context.matchBefore(/\w*/);
      if (!word || (!context.explicit && word.from === word.to)) return null;
      return {from:word.from,options:Object.entries(help).map(([label,info])=>({label,info,type:language==='music'?'function':'variable'}))};
    }]}),
    EditorState.transactionFilter.of(transaction => {
      if (new TextEncoder().encode(transaction.newDoc.toString()).length <= 65536) return transaction;
      editor.onLimit?.('Code is limited to 64 KiB. This edit was not inserted.'); return [];
    }),
    EditorView.domEventHandlers({focus:() => {editor.onfocus?.();}}),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      previousMarks='';
      if(highlightChanges)highlightChanges=highlightChanges.compose(update.changes);
      const ticket = ++serial;
      if (!muted) editor.oninput?.();
      queueMicrotask(() => { if (!destroyed && ticket === serial) view.dispatch(setDiagnostics(view.state,[])); });
    }),
  ];
  const stateFor = source => EditorState.create({doc:source,extensions});
  const view = new EditorView({parent,state:stateFor('')});
  function replace(source, key = documentKey) {
    if (key === documentKey && source === view.state.doc.toString()) return;
    documents.set(documentKey, view.state);
    const cached = documents.get(key);
    const state = key !== documentKey && cached?.doc.toString() === source ? cached : stateFor(source);
    previousMarks='';highlightSource=null;highlightChanges=null;sliderSource=null;serial++; muted = true;
    try {
      view.setState(state); documentKey = key;
      view.dispatch({effects:readonly.reconfigure([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)])});
    } finally { muted = false; }
  }
  editor.switchDocument = replace;
  editor.resetHistory = () => {
    documents.clear(); serial++;previousMarks='';highlightSource=null;highlightChanges=null;sliderSource=null;
    view.setState(stateFor(view.state.doc.toString()));
    view.dispatch({effects:readonly.reconfigure([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)])});
  };
  Object.defineProperties(editor, {
    value:{get:()=>view.state.doc.toString(),set:source=>replace(source)},
    readOnly:{set:value=>{readOnly=value;view.dispatch({effects:readonly.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value)])});for(const input of view.dom.querySelectorAll('.cm-slider'))input.disabled=value;}},
    hasFocus:{get:()=>view.hasFocus},
  });
  editor.error = (message, {line,column=0} = {}) => {
    if (!Number.isInteger(line) || line < 1 || line > view.state.doc.lines) return;
    const row = view.state.doc.line(line),from=Math.min(row.to,row.from+Math.max(0,column));
    view.dispatch(setDiagnostics(view.state,[{from,to:Math.min(row.to,from+1),severity:'error',message}]));
  };
  editor.highlight=(marks,source=view.state.doc.toString())=>{
    if(source!==highlightSource){
      const current=view.state.doc.toString();let start=0,end=0;
      while(start<source.length&&start<current.length&&source[start]===current[start])start++;
      while(end<source.length-start&&end<current.length-start&&source[source.length-1-end]===current[current.length-1-end])end++;
      highlightChanges=ChangeSet.of({from:start,to:source.length-end,insert:current.slice(start,current.length-end)},source.length);
      highlightSource=source;previousMarks='';
    }
    marks=marks.filter(mark=>mark.start>=0&&mark.end<=source.length).map(mark=>({...mark,start:highlightChanges.mapPos(mark.start,1),end:highlightChanges.mapPos(mark.end,-1)})).filter(mark=>mark.end>mark.start);
    const key=JSON.stringify(marks);if(key===previousMarks)return;previousMarks=key;
    view.dispatch({effects:activeNotes.of(marks)});
  };
  editor.focus = () => view.focus();
  editor.sliders = source => {
    if(language!=='music'||source===sliderSource)return;
    // Use the same source positions and defaults as upstream sliderWithID.
    // Existing decorations map through unrun edits without changing runtime IDs.
    if(source!==view.state.doc.toString())return;
    const widgets=[];
    const visit=node=>{
      if(!node||typeof node!=='object')return;
      if(node.type==='CallExpression'&&node.callee.name==='slider'&&node.arguments[0]){
        const [value,min,max,step]=node.arguments;
        widgets.push({from:value.start,to:value.end,value:source.slice(value.start,value.end),min:min?.value??0,max:max?.value??1,step:step?.value});
      }
      for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
    };
    try{visit(parse(source,{ecmaVersion:2022,allowAwaitOutsideFunction:true}));}catch{return;}
    sliderSource=source;
    view.dispatch({effects:setSliders.of(Decoration.set(widgets.map(config=>Decoration.widget({widget:new SliderWidget(config,(id,value)=>editor.onSlider?.(id,value)),to:config.to,side:-1}).range(config.from)),true))});
  };
  editor.destroy = () => { destroyed=true;view.destroy(); };
  return editor;
}
