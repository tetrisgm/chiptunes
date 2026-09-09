'use strict';
// Browser regression against a frozen local build. Real AudioWorklet/processor;
// no build, provider calls, credentials, deployment, or production networking.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.join(__dirname,'../dist'),origin='https://chiptunes.app',key='ct-music-workspace-v1';
const html=fs.readFileSync(path.join(dist,'create/index.html'),'utf8');
const app=html.match(/app\.[a-f0-9]+\.js/)[0],bundle=fs.readFileSync(path.join(dist,app));
async function main(){
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  let paidCalls=0;const errors=[];
  try{
    async function context(site=origin){
      const c=await browser.newContext({viewport:{width:1440,height:1000}});
      await c.setOffline(true);
      await c.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==site)return route.abort();
        if(url.pathname==='/api/music/chat'){paidCalls++;return route.fulfill({status:503,body:'{}'});}
        if(url.pathname==='/api/music/chat/access')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:false,providers:[],limits:{dailyCalls:20}})});
        if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,body:'{}'});
        if(['/create','/create/'].includes(url.pathname))return route.fulfill({contentType:'text/html',body:html});
        if(url.pathname==='/'+app)return route.fulfill({contentType:'text/javascript',body:bundle});
        const file=path.resolve(dist,'.'+url.pathname);
        if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
        return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
      });
      await c.addInitScript(origin=>{if(location.origin===origin)localStorage.setItem('ct-create-tour','1');},site);
      c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
      return c;
    }
    async function open(page,site=origin){
      await page.goto(site+'/create#music');
      await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content',{state:'attached'});
    }
    const c=await context(),page=await c.newPage();await open(page);
    const snapshot=()=>page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    const editor=page.locator('#musicworkspace .cm-content');
    assert.equal(await page.locator('#musicworkspace').getAttribute('data-view'),'code','first run opens Code');
    const initial=await snapshot();
    assert(initial.validated,'starter compiles');
    assert(initial.draft.length<4000,'starter must be readable rather than a materialized full song');
    assert.match(initial.draft,/pattern\s*\(/);assert.match(initial.draft,/notes\s*\(/);
    assert(new Set(initial.validated.compiled.gb.notes.map(n=>n.ch)).size>=2,'starter sounds multiple channels');
    assert.equal(initial.playing,null,'first run never autoplays');
    assert.equal(await page.locator('.mw-loop').isChecked(),true,'audition loop enabled');
    assert.equal(await page.locator('.mw-loop').isEnabled(),true,'loop option is editable while stopped');
    await page.evaluate(()=>{window.livecodingEvents=[];Audio.onMusicState(e=>livecodingEvents.push({...e}));});
    await page.click('#musicworkspace [data-action=play]');
    await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().playing!==null);
    assert.equal(await page.locator('.mw-loop').isDisabled(),true,'loop policy cannot change while sounding');
    assert.match(await page.locator('.mw-loop').getAttribute('title'),/stop/i,'disabled option explains how to change it');
    await page.waitForFunction(()=>/Bar \d+.*Beat [1-4]\/4/.test(document.querySelector('.mw-position').textContent));
    const beat=await page.locator('#musicworkspace').getAttribute('data-beat');
    assert.match(beat,/^[0-3]$/);
    await page.waitForFunction(previous=>document.querySelector('#musicworkspace').dataset.beat!==previous,beat);
    assert.equal(await page.locator('#musicworkspace').getAttribute('data-sounding'),'true');
    await page.waitForSelector('#musicworkspace .cm-music-sounding');
    assert.equal((await snapshot()).draft,initial.draft,'playing decorations do not mutate source');
    const duration=initial.validated.compiled.gb.totalFrames*70224/4194304*1000;
    assert(duration<20000,'starter is a short live loop');
    await page.waitForFunction(()=>livecodingEvents.some(e=>e.status==='loop'),null,{timeout:duration+10000});
    assert.equal((await snapshot()).playing,initial.validated.id,'revision remains playing after song end');
    await page.waitForFunction(()=>window.__rrrChip&&__rrrChip.peak>0.001);
    await editor.press('ControlOrMeta+End');await page.keyboard.insertText('\n// temporary editor undo');
    await page.waitForFunction(()=>document.querySelectorAll('#musicworkspace .cm-music-sounding').length===0);
    await editor.press('ControlOrMeta+z');
    assert.equal((await snapshot()).draft,initial.draft,'playing decoration transactions never enter typing undo');
    await page.waitForSelector('#musicworkspace .cm-music-sounding');
    // Musical change, not a comment-only revision. Tempo changes all shorthand timing.
    const changed=initial.draft.replace(/tempo\s*:\s*(\d+)/,(_,n)=>'tempo: '+(Number(n)+7));
    assert.notEqual(changed,initial.draft,'starter exposes an editable tempo');
    await editor.fill(changed);
    await page.waitForFunction(()=>document.querySelectorAll('#musicworkspace .cm-music-sounding').length===0);
    assert.equal((await snapshot()).draft,changed,'clearing decorations preserves the edited draft');
    await page.evaluate(()=>{window.runBoundaries=Array.from(Audio.musicBoundaries(CT_MUSIC_WORKSPACE.snapshot().validated.compiled));window.runEventStart=livecodingEvents.length;});
    await editor.press('ControlOrMeta+Enter');
    const run=await snapshot();
    assert.notEqual(run.validated.id,initial.validated.id,'Run shortcut applies a new revision');
    assert.notDeepEqual(run.validated.compiled.gb.notes,initial.validated.compiled.gb.notes,'Run changes actual note timing');
    assert(run.pending||run.playing===run.validated.id,'live Run queues or is acknowledged');
    await page.waitForFunction(()=>{const s=CT_MUSIC_WORKSPACE.snapshot();return s.playing===s.validated.id;});
    await page.waitForSelector('#musicworkspace .cm-music-sounding');
    assert.equal((await snapshot()).draft,changed,'replacement decorations do not mutate applied source');
    const ack=await page.evaluate(id=>livecodingEvents.slice(runEventStart).filter(e=>e.status==='playing'&&e.revision===id&&e.reason==='activate'),run.validated.id);
    assert.equal(ack.length,1,'exactly one activation acknowledgement');
    const boundaries=await page.evaluate(()=>runBoundaries);
    assert(boundaries.includes(ack[0].frame),'Run activates on the sounding revision musical boundary');
    assert.equal(await page.locator('.mw-loop').isChecked(),true);
    assert.equal(await page.locator('.mw-loop').isDisabled(),true);
    await editor.fill(changed+'\ninvalid(');await editor.press('ControlOrMeta+Enter');
    await page.waitForFunction(()=>document.querySelectorAll('#musicworkspace .cm-music-sounding').length===0);
    const invalid=await snapshot();
    assert.equal(invalid.validated.id,run.validated.id);assert.equal(invalid.playing,run.validated.id);
    assert.match(await page.locator('.mw-diagnostics').textContent(),/error/i);
    const eventCount=await page.evaluate(()=>livecodingEvents.length);
    await page.waitForFunction(n=>livecodingEvents.slice(n).some(e=>e.status==='position'||e.status==='loop'),eventCount);
    await page.waitForFunction(()=>window.__rrrChip&&__rrrChip.peak>0.001);
    // Restore the valid draft, then undo the one applied musical transaction.
    await editor.fill(changed);await page.click('#musicworkspace [data-action=undo]');
    assert.equal((await snapshot()).draft,initial.draft);
    await page.waitForFunction(id=>CT_MUSIC_WORKSPACE.snapshot().playing===id,initial.validated.id);
    await page.waitForSelector('#musicworkspace .cm-music-sounding');
    assert.equal((await snapshot()).draft,initial.draft,'decorations leave project undo byte-exact');
    await page.click('#musicworkspace [data-action=redo]');
    await page.waitForFunction(()=>{const s=CT_MUSIC_WORKSPACE.snapshot();return s.playing===s.validated.id;});
    await page.click('#musicworkspace [data-action=pause]');
    await page.waitForFunction(()=>document.querySelector('.mw-position').textContent.startsWith('Paused'));
    assert.equal(await page.locator('.mw-loop').isDisabled(),true,'pause retains the immutable playing loop policy');
    await editor.fill(changed+'\n// queued while paused');await editor.press('ControlOrMeta+Enter');
    assert((await snapshot()).pending,'paused Run leaves a queued revision');
    assert.equal(await page.locator('.mw-loop').isDisabled(),true,'pending revision keeps loop option disabled');
    await page.click('#musicworkspace [data-action=stop]');
    await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().playing===null);
    assert.equal((await snapshot()).pending,null,'Stop cancels queued work');
    assert.equal(await page.locator('.mw-loop').isEnabled(),true,'Stop restores loop control');
    // Undo the paused revision so persistence below still targets the musical edit.
    await page.click('#musicworkspace [data-action=undo]');
    assert.equal((await snapshot()).validated.source,changed);
    await editor.fill(changed+'\n// unfinished retained\ninvalid(');
    await page.click('#musicworkspace [data-action=save]');
    await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).draft.endsWith('invalid('),key);
    const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
    await page.reload();await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content',{state:'attached'});
    const recovered=await snapshot();assert.equal(recovered.draft,saved.draft);
    assert.equal(recovered.validated.source,changed);assert.equal(recovered.playing,null);
    assert.equal(await page.locator('.mw-loop').isChecked(),true,'restored pattern project defaults to audition looping');
    assert.equal(await page.locator('.mw-loop').isEnabled(),true);
    // New loop must ask before replacing this recoverable unfinished project.
    const fresh=page.getByRole('button',{name:/^new loop$/i});
    page.once('dialog',d=>d.dismiss());await fresh.click();
    assert.equal((await snapshot()).draft,recovered.draft,'cancel preserves unfinished source');
    page.once('dialog',d=>d.accept());await fresh.click();
    const reset=await snapshot();assert(reset.validated);assert(reset.draft.length<4000);
    assert.equal(reset.playing,null,'New loop does not autoplay');
    // Seed another browser with an existing exact-event project + invalid draft.
    const exact=await page.evaluate(()=>{
      const s=CT_MUSIC_WORKSPACE.snapshot(),text=CT_MUSIC_LANGUAGE.materialize(s.validated.compiled.gb,s.validated.compiled.settings);
      const p=CT_MUSIC_PROJECT.create(text,{compile:CT_MUSIC_LANGUAGE.compile,assetsVersion:CT_MUSIC_ASSETS_VERSION});
      p.editDraft(text+'\n// existing exact draft\ninvalid(');return p.serialize({includePrivate:true});
    });
    const existingContext=await context();
    await existingContext.addInitScript(({key,exact,origin})=>{if(location.origin===origin&&!localStorage.getItem(key))localStorage.setItem(key,exact);},{key,exact,origin});
    const existing=await existingContext.newPage();await open(existing);
    const record=JSON.parse(exact),existingState=await existing.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    assert.equal(existingState.draft,record.draft);assert.equal(existingState.validated.source,record.lastValid.source);
    assert.equal(existingState.playing,null);
    // Main-site Chat is intentionally hidden; exercise the real hosted UI using local bytes.
    const gateway='https://chiptunes-agent-gateway.vercel.app',hostedContext=await context(gateway);
    const hosted=await hostedContext.newPage();await open(hosted,gateway);
    const hostedBefore=await hosted.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    await hosted.locator('.mw-chat-input').fill('shortcut must not run music');
    await hosted.locator('.mw-chat-input').press('ControlOrMeta+Enter');
    await hosted.waitForTimeout(250); // Allow an accidental asynchronous musicPlay to acknowledge.
    const hostedAfter=await hosted.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    assert.equal(hostedAfter.playing,null,'Chat shortcut never starts playback');
    assert.equal(hostedAfter.pending,null,'Chat shortcut never queues playback');
    assert.equal(hostedAfter.draft,hostedBefore.draft);
    assert.deepEqual(errors,[]);assert.equal(paidCalls,0);
    console.log('PASS livecoding: readable first-run loop, real wrap/audio, shortcut boundary Run, invalid-draft audio, undo/redo, recovery, safe New loop, existing exact-project preservation ('+app+')');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
