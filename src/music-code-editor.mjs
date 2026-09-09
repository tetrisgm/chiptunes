// CodeMirror supplies editing and compiler-derived visual feedback only. The
// host's restricted parser handles draft previews and explicit Run/Apply.
import { EditorView, basicSetup } from 'codemirror';
import { Decoration } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion } from '@codemirror/autocomplete';
import { setDiagnostics } from '@codemirror/lint';
import { inlineRolls } from './music-inline-rolls.mjs';

const help = {
  song: 'song({tempo:128,bars:16}) — finite song settings; bars are zero indexed.',
  pattern: 'pattern("name", notes("C2 . G2 .").stepsPerBar(8).gate(0.7))',
  notes: 'notes("C4 . E4 G4") — pitches and dot rests, in written order.',
  track: 'track("bass").instrument(0).play("name", {atBar:0,repeat:4})',
  event: 'event({ch:0,frame:0,frames:60,midi:60,inst:0,vel:0.8}) — exact frames.',
  instruments: 'instruments([...]) — explicit instrument register records.',
  waves: 'waves([...]) — explicit waveform assets.',
  performance: 'performance({...}) — explicit remaining performance/bank metadata; never packed code.',
  automation: 'automation({f:0,r:36,v:119}) — exact frame/register/value.',
  vibratoOff: 'vibratoOff({f:0,ch:0}) — disable driver vibrato.',
  waveLoad: 'waveLoad({f:0,slot:0}) — load a wave frame.',
  kit: 'kit({f:0,id:1}) — sample hit from the bundled kit bank.',
  transpose: 'transpose(semitones) — applies in source order.',
  register: 'register(octave) — moves pitch classes into the named scientific octave, in source order.',
  velocity: 'velocity(value) — replace token velocities with a value from 0 to 1.',
  gate: 'gate(fraction) — note length relative to its step.',
  stepsPerBar: 'stepsPerBar(count) — finite pattern resolution.',
  play: 'play("pattern", {atBar:0,repeat:1}) — finite pattern occurrence.',
  instrument: 'instrument(index) — select an instrument in this song bank.'
};
const theme = EditorView.theme({
  '&': {height:'100%',backgroundColor:'#10121b',color:'#e7eaf4',fontSize:'14px'},
  '.cm-scroller': {overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, monospace'},
  '.cm-content': {caretColor:'#b9d968',minHeight:'240px'},
  '.cm-gutters': {backgroundColor:'#141723',color:'#929bb4',border:'0'},
  '.cm-activeLine,.cm-activeLineGutter': {backgroundColor:'#ffffff08'},
  '.cm-selectionBackground,&.cm-focused .cm-selectionBackground': {backgroundColor:'#58734466'},
  '.cm-tooltip': {backgroundColor:'#252b3d',color:'#fff',border:'1px solid #596175'},
  '.cm-music-sounding': {backgroundColor:'#b9d96824',boxShadow:'inset 0 -2px #b9d968',borderRadius:'2px'},
}, {dark:true});

// Playback is a view decoration, never an edit or an undo transaction. Draft
// changes clear highlights until the host can map the sounding source exactly.
const soundingEffect = StateEffect.define();
const soundingField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) return Decoration.none;
    for (const effect of transaction.effects) if (effect.is(soundingEffect)) {
      const length=transaction.newDoc.length;
      const ranges=effect.value.filter(s=>Number.isInteger(s.from)&&Number.isInteger(s.to)&&s.from>=0&&s.to>s.from&&s.to<=length)
        .map(s=>Decoration.mark({class:'cm-music-sounding'}).range(s.from,s.to));
      return Decoration.set(ranges,true);
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});

globalThis.CT_MUSIC_CODE_EDITOR = {
  help,
  mount(parent, source, onChange, {onSelectionChange,onNoteSelect} = {}) {
    const rolls=inlineRolls({onNoteSelect});
    const view = new EditorView({doc:source,parent,extensions:[
      basicSetup, javascript(), theme, soundingField, rolls.extensions, EditorView.lineWrapping,
      EditorView.contentAttributes.of({'aria-label':'Musical source code','data-shortcuts-off':''}),
      autocompletion({override:[ctx=>{
        const word=ctx.matchBefore(/\w*/);
        if (!word || (!ctx.explicit && word.from===word.to)) return null;
        return {from:word.from,options:Object.keys(help).map(label=>({label,type:'function',info:help[label]}))};
      }]}),
      EditorView.updateListener.of(update=>{
        if(update.docChanged) onChange(update.state.doc.toString());
        if((update.selectionSet||update.docChanged)&&typeof onSelectionChange==='function')
          onSelectionChange(update.state.selection.ranges.map(r=>({from:r.from,to:r.to})));
      })
    ]});
    rolls.attach(view);
    return {
      value:()=>view.state.doc.toString(),
      selection:()=>view.state.selection.ranges.map(r=>({from:r.from,to:r.to})),
      set(source) { if(source!==view.state.doc.toString()) view.dispatch({changes:{from:0,to:view.state.doc.length,insert:source}}); },
      select(from,to=from) {
        from=Math.max(0,Math.min(view.state.doc.length,from||0)); to=Math.max(from,Math.min(view.state.doc.length,to||from));
        view.dispatch({selection:{anchor:from,head:to},scrollIntoView:true}); view.focus();
      },
      diagnostics(items=[]) {
        view.dispatch(setDiagnostics(view.state,items.map(d=>({
          from:Math.max(0,Math.min(view.state.doc.length,d.from||0)),
          to:Math.max(0,Math.min(view.state.doc.length,d.to||d.from||0)),
          severity:d.severity==='warning'?'warning':'error',message:d.message||String(d)
        }))));
      },
      highlightPlaying(spans=[]) { view.dispatch({effects:soundingEffect.of(spans.slice(0,4))}); },
      setPatternContext:context=>rolls.setContext(context),
      setPatternPlayback:state=>rolls.setPlayback(state),
      destroy:()=>{rolls.destroy();view.destroy();}, focus:()=>view.focus()
    };
  }
};
