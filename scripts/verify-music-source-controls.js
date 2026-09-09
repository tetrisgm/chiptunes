'use strict';
// Compiler-shaped metadata fixtures, NOT compiler integration coverage.
// Standalone public API harness; its bundle never touches shared dist.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {build}=require('esbuild'),{chromium}=require('playwright');
const span=(from,to)=>({start:{offset:from,line:1,column:from+1},end:{offset:to,line:1,column:to+1}});
function fixture(source,projectId='one'){
  const controls=[];
  for(const match of source.matchAll(/\.(gate|velocity|transpose)\(([^)]+)\)/g)){
    const kind=match[1],from=match.index+kind.length+2,to=from+match[2].length;
    controls.push({kind,value:Number(match[2]),literalSpan:span(from,to),callSpan:span(match.index,match.index+match[0].length),ownerSpan:span(0,source.length),ownerType:'pattern',ownerName:'p',min:kind==='gate'?.001:kind==='velocity'?0:-128,max:kind==='transpose'?128:1,integer:kind==='transpose'});
  }
  return {source,projectId,compiled:{gb:{notes:[]},diagnostics:[],controls}};
}
const original='pattern("p", notes("C4 .").gate(9.123456e-1).velocity(0.70).transpose(-02)) // untouched 🎵';
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chiptunes-source-controls-'));let browser;let checks=0;
  try{
    await build({stdin:{contents:`import {EditorView} from '@codemirror/view';import {EditorState} from '@codemirror/state';import {history,undo,redo,undoDepth} from '@codemirror/commands';import {sourceControls} from './src/music-source-controls.mjs';
      window.mount=(source)=>{window.v?.destroy();window.c?.destroy();window.c=sourceControls();window.v=new EditorView({parent:document.querySelector('main'),state:EditorState.create({doc:source,extensions:[history(),c.extensions,EditorView.updateListener.of(u=>{if(u.docChanged&&window.clearOnEdit)c.setContext(null);})]})});c.attach(v);};window.undo=()=>undo(v);window.redo=()=>redo(v);window.depth=()=>undoDepth(v.state);`,resolveDir:path.resolve(__dirname,'..'),loader:'js'},bundle:true,format:'iife',outfile:path.join(dir,'harness.js')});
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());await page.setContent('<main></main>');await page.addScriptTag({path:path.join(dir,'harness.js')});
    const value=()=>page.evaluate(()=>v.state.doc.toString());
    async function mount(source=original,context=fixture(source)){await page.evaluate(source=>{clearOnEdit=false;mount(source);},source);const result=await page.evaluate(context=>c.setContext(context),context);await page.evaluate(()=>new Promise(queueMicrotask));return result;}
    async function input(text,index=0){await page.evaluate(({text,index})=>{const el=document.querySelectorAll('.cm-source-control input[type=number]')[index];el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));},{text,index});}
    async function finish(){await page.evaluate(()=>document.querySelector('.cm-source-control input')?.dispatchEvent(new Event('pointerup',{bubbles:true})));await page.evaluate(()=>new Promise(queueMicrotask));}
    assert.equal((await mount()).controls,3);assert.equal(await value(),original);assert.equal(await page.evaluate(()=>depth()),0);
    assert.equal(await page.locator('output').first().textContent(),'9.123456e-1');await input('.9123456');assert.equal(await value(),original);await finish();checks++;

    await mount();await page.evaluate(()=>clearOnEdit=true);await input('.9');await page.waitForTimeout(650);await input('.001');await page.waitForTimeout(650);await input('.87654');
    assert.equal(await page.locator('.cm-source-control').count(),1,'active control survives host null');assert.equal(await value(),original.replace('9.123456e-1','0.87654'));
    await finish();assert.equal(await page.locator('.cm-source-control').count(),0);assert.equal(await page.evaluate(()=>depth()),1,'slow drag one undo');await page.evaluate(()=>undo());assert.equal(await value(),original);await page.evaluate(()=>redo());assert.equal(await value(),original.replace('9.123456e-1','0.87654'));checks++;

    await mount();await input('.8');await finish();let source=await value();await page.evaluate(context=>c.setContext(context),fixture(source));await input('.7');await finish();assert.equal(await page.evaluate(()=>depth()),2);await page.evaluate(()=>v.dispatch({changes:{from:v.state.doc.length,insert:'x'}}));await page.evaluate(()=>undo());assert.equal(await value(),original.replace('9.123456e-1','0.7'));await page.evaluate(()=>undo());assert.equal(await value(),original.replace('9.123456e-1','0.8'));checks++;

    await mount();await page.evaluate(()=>window.old=document.querySelector('input[type=number]'));await input('.8');await page.evaluate(()=>v.dispatch({changes:{from:0,insert:'// foreign\n'}}));source=await value();await page.evaluate(()=>{old.value='.3';old.dispatchEvent(new Event('input'));});assert.equal(await value(),source);assert.equal(await page.locator('.cm-source-control').count(),0);checks++;

    await mount();await page.evaluate(()=>window.old=document.querySelector('input[type=number]'));await input('.8');source=await value();await page.evaluate(context=>c.setContext(context),fixture(source,'two'));await page.evaluate(()=>{old.value='.3';old.dispatchEvent(new Event('input'));});assert.equal(await value(),source,'equal-source new project invalidates old callbacks');checks++;

    await mount();await page.evaluate(()=>window.old=document.querySelector('input[type=number]'));await input('.8');await page.evaluate(()=>undo());assert.equal(await value(),original);await page.evaluate(()=>{old.value='.3';old.dispatchEvent(new Event('input'));});assert.equal(await value(),original);assert.equal(await page.locator('.cm-source-control').count(),0);checks++;

    await mount();await input('.8');await page.evaluate(()=>{const at=v.state.doc.toString().indexOf('0.8')+2;v.dispatch({changes:{from:at,to:at+1,insert:'7'}});});await page.evaluate(()=>undo());assert.equal(await value(),original.replace('9.123456e-1','0.8'),'foreign adjacent edit isolated before history records it');await page.evaluate(()=>undo());assert.equal(await value(),original);checks++;

    await mount();await input('.8');source=await value();await page.evaluate(context=>c.setContext(context),fixture(source));await input('.6');await page.evaluate(context=>c.setContext(context),fixture(source));await finish();assert.equal(await value(),original.replace('9.123456e-1','0.6'));assert.equal(await page.locator('.cm-source-control').count(),0,'older compiler result cannot restore controls');
    await page.evaluate(context=>c.setContext(context),fixture(await value()));assert.equal(await page.locator('.cm-source-control').count(),3,'latest matching context restores controls');checks++;

    await mount();for(const bad of ['0','1.1','NaN','Infinity']){await input(bad);assert.equal(await value(),original);}await finish();await input('2.5',2);assert.equal(await value(),original);await finish();checks++;

    await mount();const range=page.locator('input[type=range]').first();await range.focus();assert.equal(await range.evaluate(e=>e===document.activeElement),true);await page.keyboard.press('ArrowLeft');assert.notEqual(await value(),original);await page.evaluate(()=>undo());assert.equal(await value(),original);checks++;

    await mount();await range.focus();await page.keyboard.down('ArrowLeft');const firstKey=await value();await page.waitForTimeout(650);await page.keyboard.down('ArrowLeft');assert.notEqual(await value(),firstKey,'repeat actually edits twice');await page.keyboard.up('ArrowLeft');assert.equal(await page.evaluate(()=>depth()),1,'held keyboard repeat is one gesture');await page.evaluate(()=>undo());assert.equal(await value(),original);checks++;

    await mount();await page.evaluate(()=>clearOnEdit=true);await range.focus();await page.keyboard.press('ArrowLeft');const firstGesture=await value();assert.equal(await page.locator('input').count(),0,'no authority while preview pending');await page.evaluate(context=>c.setContext(context),fixture(firstGesture));assert.equal(await range.evaluate(e=>e===document.activeElement),true,'matching preview restores the focused range');await page.keyboard.press('ArrowLeft');assert.notEqual(await value(),firstGesture,'next keyboard gesture edits without refocusing');assert.equal(await page.evaluate(()=>depth()),2);await page.evaluate(()=>undo());assert.equal(await value(),firstGesture);await page.evaluate(()=>undo());assert.equal(await value(),original);checks++;

    for(const action of ['foreign','project','focus']){
      await mount();await range.focus();await page.keyboard.press('ArrowLeft');
      if(action==='foreign')await page.evaluate(()=>v.dispatch({changes:{from:0,insert:' '}}));
      if(action==='focus')await page.locator('.cm-content').focus();
      await page.evaluate(context=>c.setContext(context),fixture(await value(),action==='project'?'new':'one'));
      assert.equal(await range.evaluate(e=>e===document.activeElement),false,action+' must not restore old focus');
    }checks++;

    await mount();await page.locator('input[type=number]').first().focus();await input('.8');assert.equal(await page.locator('input[type=number]').first().evaluate(e=>e===document.activeElement),true,'own transaction retains focus');await page.keyboard.press('Escape');await page.evaluate(()=>undo());assert.equal(await value(),original);checks++;

    const many='pattern("p",notes("C4")'+'.gate(.5)'.repeat(40)+')';assert.equal((await mount(many)).controls,24);assert.equal(await page.locator('.cm-source-control').count(),24);assert.match(await page.locator('.cm-source-controls-omitted').textContent(),/16 more/);checks++;

    assert.equal((await mount('event({frame:0})')).controls,0);assert.equal(await page.locator('input').count(),0);let bad=fixture(original);bad.compiled.controls[0].literalSpan.end.offset--;assert.equal((await mount(original,bad)).ok,false);bad=fixture(original);bad.compiled.controls[0].ownerType='track';assert.equal((await mount(original,bad)).ok,false);checks++;

    const track='track("bass").transpose(-12)';const trackContext=fixture(track);trackContext.compiled.controls[0].ownerType='track';assert.equal((await mount(track,trackContext)).controls,1);await input('-128');await finish();assert.equal(await value(),track.replace('-12','-128'));await page.evaluate(()=>undo());assert.equal(await value(),track);assert.equal((await mount('pattern("p",notes("C4").gate(.5+.1))')).ok,false);checks++;

    assert.equal((await mount(original.replace('-02','+02'))).ok,false,'leading plus is not compiler numeric grammar');
    for(const call of ['. /*a*/ gate(/*b*/ .50 /*c*/)','. // a\n gate /*x*/ ( // b\n .50 // c\n)']){
      const source='pattern("p",notes("C4")'+call+'.velocity(.7))';
      const context=fixture(source);const from=source.indexOf('.50'),start=source.indexOf(call);
      context.compiled.controls.unshift({kind:'gate',value:.5,literalSpan:span(from,from+3),callSpan:span(start,start+call.length),ownerSpan:span(0,source.length),ownerType:'pattern',ownerName:'p',min:.001,max:1,integer:false});
      assert.equal((await mount(source,context)).controls,2,'commented call does not hide other valid controls');await input('.6');await finish();assert.equal(await value(),source.replace('.50','0.6'),'trivia preserved exactly');
      const malformed=structuredClone(context);malformed.compiled.controls[0].literalSpan.start.offset++;assert.equal((await mount(source,malformed)).ok,false);
    }checks++;

    await mount();await page.evaluate(()=>{window.old=document.querySelector('input[type=number]');c.cancelGesture();});await page.evaluate(()=>{old.value='.3';old.dispatchEvent(new Event('input'));});assert.equal(await value(),original);await page.evaluate(context=>{c.setContext(context);c.destroy();},fixture(original));await page.evaluate(()=>{old.value='.4';old.dispatchEvent(new Event('input'));});assert.equal(await value(),original);checks++;
    assert.deepEqual(errors,[]);console.log(`music-source-controls: ${checks} checks passed (compiler-shaped fixtures; standalone Chromium harness)`);
  }finally{await browser?.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
