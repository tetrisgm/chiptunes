'use strict';
// Standalone editor build in a unique temporary directory. Never shared dist.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {build}=require('esbuild'),{chromium}=require('playwright');
const language=require('../src/music-language.js');
const source='song({tempo:120,bars:8})\n'+
  'pattern("shared",notes(". C4 . D4 .").stepsPerBar(8))\n'+
  'track("lead").instrument("p0").transpose(12).play("shared",{repeat:2})\n'+
  'track("bass").instrument("wave-bass").play("shared",{repeat:2})\n'+
  'pattern("drums",notes("C2 . C2 .").stepsPerBar(8))\n'+
  'track("drums").instrument("n-tick").play("drums",{repeat:2})\n';
const compiled=language.compile(source);assert(compiled.gb,JSON.stringify(compiled.diagnostics));
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chiptunes-inline-rolls-'));
  let browser;
  try{
    const bundle=path.join(dir,'editor.js');
    await build({entryPoints:[path.resolve(__dirname,'../src/music-code-editor.mjs')],bundle:true,format:'iife',outfile:bundle});
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
    await page.setContent('<main id="editor" style="height:780px;width:900px"></main>');await page.addScriptTag({path:bundle});
    await page.evaluate(source=>{
      window.changes=[];window.selections=[];window.noteSelections=[];
      window.editor=CT_MUSIC_CODE_EDITOR.mount(document.querySelector('#editor'),source,v=>changes.push(v),{
        onSelectionChange:r=>selections.push(r),onNoteSelect:n=>{noteSelections.push(n);const span=n.tokenSpan||n.span;editor.select(span.start.offset,span.end.offset);}});
    },source);
    async function context(value){return page.evaluate(value=>editor.setPatternContext(value),value);}
    const result=await context({source,compiled});assert(result.ok);assert(result.widgets>0&&result.widgets<=12);
    assert.equal(result.widgets,2,'one roll per pattern, not duplicated beneath track calls');
    await page.waitForSelector('.cm-inline-roll');
    assert.equal(await page.evaluate(()=>editor.value()),source);assert.equal(await page.evaluate(()=>changes.length),0,'context makes no edit');
    const roll=page.locator('.cm-inline-roll').first();
    assert((await roll.textContent()).includes('Pattern shared'));
    assert.equal(await roll.locator('select option').count(),4,'shared pattern exposes both transformed tracks and repeats');
    assert((await roll.locator('.cm-inline-context').textContent()).includes('.transpose(12)'),'context shows the mapped track transformation');
    assert((await roll.locator('footer').textContent()).includes('Full occurrence'),'provided bounds show rests');
    assert.deepEqual(await roll.locator('.cm-inline-row-label').allTextContents(),['D5','C♯5','C5'],'one exact row per semitone, including silent intermediate pitch');
    const first=compiled.mapping.find(m=>m.pattern==='shared'&&compiled.gb.notes[m.noteIndex].ch===0&&m.occurrence===0),note=compiled.gb.notes[first.noteIndex];
    const drawn=await roll.locator('.cm-inline-note').first().evaluate(el=>({left:parseFloat(el.style.left),width:parseFloat(el.style.width)}));
    assert(drawn.left>0,'leading rest retained rather than scaling first note to zero');
    assert(Math.abs(drawn.left-(note.frame-first.occurrenceStartFrame)/(first.occurrenceEndFrame-first.occurrenceStartFrame)*100)<.001);
    await roll.locator('.cm-inline-note').first().focus();await page.keyboard.press('Enter');
    const selected=await page.evaluate(()=>({note:noteSelections.at(-1),selection:editor.selection(),value:editor.value()}));
    assert.equal(selected.note.noteIndex,first.noteIndex);assert.equal(selected.note.source,source);assert.equal(selected.value,source);
    assert.deepEqual(selected.selection,[{from:first.tokenSpan.start.offset,to:first.tokenSpan.end.offset}],'note keyboard activation selects exact token');
    await roll.locator('select').selectOption('2');
    assert.deepEqual(await roll.locator('.cm-inline-row-label').allTextContents(),['D4','C♯4','C4'],'selected bass occurrence shows actual lower compiled pitches');
    await roll.locator('select').selectOption('1');
    const repeat=compiled.mapping.find(m=>m.pattern==='shared'&&compiled.gb.notes[m.noteIndex].ch===0&&m.occurrence===1),repeatNote=compiled.gb.notes[repeat.noteIndex];
    await page.evaluate(({source,frame,index})=>editor.setPatternPlayback({source,frame,playing:true,noteIndices:[index]}),{source,frame:repeatNote.frame,index:repeat.noteIndex});
    assert.equal(await roll.locator('.cm-inline-note[data-sounding=true]').count(),1);
    assert.equal(await roll.locator('.cm-inline-playhead').isVisible(),true);
    await page.evaluate(({source,frame})=>editor.setPatternPlayback({source,frame,playing:true}),{source,frame:repeatNote.frame});
    assert.equal(await roll.locator('.cm-inline-note[data-sounding=true]').count(),0,'without explicit winners no note claims to be sounding');
    assert.equal(await roll.locator('.cm-inline-playhead').isVisible(),true,'occurrence cursor can still show phase');
    await page.evaluate(source=>editor.setPatternPlayback({source,frame:0,playing:false}),source);
    assert.equal(await roll.locator('.cm-inline-note[data-sounding=true]').count(),0,'pause clears sounding notes');
    await page.evaluate(({source,frame})=>editor.setPatternPlayback({source:source+'changed',frame,playing:true}),{source,frame:repeatNote.frame});
    assert.equal(await roll.locator('.cm-inline-playhead').isVisible(),false,'different sounding source never overlays preview');
    assert.equal(await page.evaluate(()=>changes.length),0,'selection and playback create no undo edits');
    // Poison the supplied full score after ingestion: ticks must not revisit it.
    await page.evaluate(({source,compiled})=>{
      editor.setPatternContext({source,compiled});
      Object.defineProperty(compiled.gb,'notes',{get(){throw Error('full score read during playback');}});
      for(let i=0;i<100;i++)editor.setPatternPlayback({source,frame:i,playing:true});
    },{source,compiled});
    const drums=page.locator('.cm-inline-roll').filter({hasText:'Pattern drums'});
    await page.evaluate(source=>editor.select(source.indexOf('pattern("drums"')),source);
    await drums.scrollIntoViewIfNeeded();assert((await drums.locator('.cm-inline-row-label').first().textContent()).startsWith('Noise '),'percussion has instrument rows, not fake pitches');
    const fallback=structuredClone(compiled);
    for(const m of fallback.mapping){delete m.tokenSpan;delete m.playSpan;delete m.trackSpan;delete m.occurrenceStartFrame;delete m.occurrenceEndFrame;}
    await context({source,compiled:fallback});await page.evaluate(()=>editor.select(0));
    assert((await page.locator('.cm-inline-roll').first().locator('footer').textContent()).includes('rest bounds unavailable'),'old mapping fallback is explicit');
    assert((await page.locator('.cm-inline-roll').first().locator('.cm-inline-context').textContent()).includes('full track transform span unavailable'));
    await page.evaluate(()=>{window.staleButton=document.querySelector('.cm-inline-note');});
    const before=await page.evaluate(()=>noteSelections.length);
    await context({source,compiled});await page.evaluate(()=>staleButton.click());assert.equal(await page.evaluate(()=>noteSelections.length),before,'detached previous-context widgets cannot select');
    await page.locator('.cm-content').focus();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type('// invalid draft (');
    assert.equal(await page.locator('.cm-inline-roll').count(),0,'typing clears widgets atomically');
    assert.equal((await context({source,compiled})).ok,false,'stale compiled source rejected');
    await page.keyboard.press('ControlOrMeta+z');assert.equal(await page.evaluate(()=>editor.value()),source,'typing undo preserved');
    assert.equal(await page.locator('.cm-inline-roll').count(),0,'undo cannot revive stale decorations');
    await context({source,compiled});assert((await context(null)).ok);assert.equal(await page.locator('.cm-inline-roll').count(),0);
    const invalid=language.compile(source+'broken(');assert.equal((await context({source,compiled:invalid})).ok,false,'invalid compiler result clears widgets');
    const longSource='song({tempo:255,bars:260})\npattern("p",notes("C4 ."))\n'+
      'track("lead").instrument("p0").play("p",{repeat:256})\n'+
      'track("bass").instrument("wave-bass").transpose(-12).play("p")\n';
    const longCompiled=language.compile(longSource);assert(longCompiled.gb,JSON.stringify(longCompiled.diagnostics));
    await page.evaluate(source=>editor.set(source),longSource);assert.equal((await context({source:longSource,compiled:longCompiled})).widgets,1);
    const longRoll=page.locator('.cm-inline-roll').first();
    const options=await longRoll.locator('select option').allTextContents();
    assert.equal(options.length,24);assert(options.some(text=>text.includes('Bass')),'256 lead repeats cannot swallow the transformed bass variant');
    await longRoll.locator('select').selectOption(String(options.findIndex(text=>text.includes('Bass'))));
    assert((await longRoll.locator('.cm-inline-context').textContent()).includes('.transpose(-12)'));
    assert.deepEqual(await longRoll.locator('.cm-inline-row-label').allTextContents(),['C3']);
    assert((await longRoll.locator('footer').textContent()).includes('233 additional occurrences omitted'));
    const overlapSource='song({tempo:120,bars:4})\npattern("held",notes("C4:8").stepsPerBar(4).gate(1))\n'+
      'pattern("steal",notes("E4").stepsPerBar(4).gate(1))\n'+
      'track("lead").instrument("p0").play("held")\ntrack("lead").instrument("p0").play("steal",{atBar:1})\n';
    const overlapCompiled=language.compile(overlapSource);assert(overlapCompiled.gb,JSON.stringify(overlapCompiled.diagnostics));
    const held=overlapCompiled.mapping.find(m=>m.pattern==='held').noteIndex,steal=overlapCompiled.mapping.find(m=>m.pattern==='steal').noteIndex;
    const frame=overlapCompiled.gb.notes[steal].frame;
    assert(overlapCompiled.gb.notes[held].frame+overlapCompiled.gb.notes[held].frames>frame,'fixture really overlaps on one chip channel');
    await page.evaluate(source=>editor.set(source),overlapSource);await context({source:overlapSource,compiled:overlapCompiled});
    await page.evaluate(({source,frame,steal})=>editor.setPatternPlayback({source,frame,playing:true,noteIndices:[steal]}),{source:overlapSource,frame,steal});
    assert.equal(await page.locator('.cm-inline-note[data-note-index="'+held+'"][data-sounding=true]').count(),0,'older long note is not sounding after another pattern steals its voice');
    assert.equal(await page.locator('.cm-inline-note[data-note-index="'+steal+'"][data-sounding=true]').count(),1,'only acknowledged latest trigger is sounding');
    const unnamedSource='song({tempo:120,bars:2})\npattern("",notes("C4 ."))\ntrack("lead").instrument("p0").play("")\n';
    const unnamedCompiled=language.compile(unnamedSource);assert(unnamedCompiled.gb,JSON.stringify(unnamedCompiled.diagnostics));
    await page.evaluate(source=>editor.set(source),unnamedSource);
    assert.equal((await context({source:unnamedSource,compiled:unnamedCompiled})).widgets,1,'empty-string pattern names retain their inline roll');
    await page.waitForSelector('.cm-inline-roll');assert.equal(await page.locator('.cm-inline-note').count(),1);
    // Large exact event imports receive zero widgets even with 50k mappings.
    const denseSource='event({})\n',span={start:{offset:0,line:1,column:1},end:{offset:9,line:1,column:10}};
    const exact={gb:{notes:Array.from({length:50000},(_,i)=>({ch:i%4,frame:i,frames:1,midi:60,inst:0}))},mapping:Array.from({length:50000},(_,i)=>({noteIndex:i,span,pattern:null})),diagnostics:[]};
    await page.evaluate(source=>editor.set(source),denseSource);
    assert.equal((await context({source:denseSource,compiled:exact})).widgets,0,'50k exact events stay code-only');
    // Supplied compiler-shaped dense fixture exercises display budgets only.
    const dense={...exact,mapping:exact.mapping.map((m,i)=>({...m,pattern:'dense',occurrence:Math.floor(i/2000),track:'lead',occurrenceStartFrame:0,occurrenceEndFrame:60000}))};
    const denseResult=await context({source:denseSource,compiled:dense});assert(denseResult.widgets<=12);
    await page.waitForSelector('.cm-inline-roll');
    assert(await page.locator('.cm-inline-note').count()<=12*128);
    assert((await page.locator('.cm-inline-roll footer').first().textContent()).includes('additional notes omitted'));
    assert((await page.locator('.cm-inline-roll footer').first().textContent()).includes('additional occurrences omitted'));
    const manySource=Array.from({length:30},(_,i)=>'pattern("p'+i+'", notes("C4"))').join('\n');
    let offset=0;const manyMapping=manySource.split('\n').map((line,i)=>{const start=offset;offset+=line.length+1;return {noteIndex:i,pattern:'p'+i,occurrence:0,span:{start:{offset:start,line:i+1,column:1},end:{offset:start+line.length,line:i+1,column:line.length+1}}};});
    await page.evaluate(source=>editor.set(source),manySource);
    const manyResult=await context({source:manySource,compiled:{gb:{notes:exact.gb.notes.slice(0,30)},mapping:manyMapping,diagnostics:[]}});
    assert.equal(manyResult.widgets,12);assert.equal(manyResult.omittedDeclarations,19);
    assert(await page.locator('.cm-inline-roll').count()<=11);assert(await page.locator('.cm-inline-omitted').count()<=1);
    await page.evaluate(({source,compiled})=>{
      editor.destroy();document.querySelector('#editor').replaceChildren();
      window.editor=CT_MUSIC_CODE_EDITOR.mount(document.querySelector('#editor'),source,value=>{
        editor.setPatternContext(value===source?{source,compiled}:null);
        editor.setPatternPlayback({source,frame:0,playing:true});
      });
      editor.setPatternContext({source,compiled});
      editor.set(source+'\ninvalid('); // Invalidates the pending decoration effect.
    },{source,compiled});
    assert.equal(await page.locator('.cm-inline-roll').count(),0,'edit-before-effect rejects late context');
    await page.locator('.cm-content').focus();await page.keyboard.press('ControlOrMeta+z');
    await page.waitForSelector('.cm-inline-roll');
    assert.equal(await page.evaluate(()=>editor.value()),source,'host context resupply after undo rebuilds widgets');
    await page.evaluate(({source,compiled})=>{
      editor.setPatternContext(null);editor.setPatternContext({source,compiled});editor.setPatternContext(null);
    },{source,compiled});
    assert.equal(await page.locator('.cm-inline-roll').count(),0,'latest queued null wins');
    await page.evaluate(({source,compiled})=>{editor.setPatternContext({source,compiled});editor.destroy();},{source,compiled});
    assert.equal(await page.locator('.cm-inline-roll').count(),0,'destroy rejects late effect');
    assert.deepEqual(errors,[],'no browser or nested-dispatch errors');
    console.log('PASS inline rolls: shared transforms/occurrences, semitone/percussion rows, rest bounds/fallback, token keyboard selection, exact source guards, bounded playback, typing undo, 50k exact/dense budgets');
  }finally{if(browser)await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
