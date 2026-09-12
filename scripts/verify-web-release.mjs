#!/usr/bin/env node
// Deliberate production acceptance, NEVER part of npm test or a scheduled job.
// Default: read-only build/access/presence checks and denied anonymous requests.
// --paid: explicit owner-authorized smoke test, at most TWO model requests,
// using a fresh browser context and synthetic music. No retries. Credentials
// remain in process memory; never log request headers, cookies or passwords.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const origin='https://chiptunes.app',gateway='https://chiptunes-agent-gateway.vercel.app';
const paid=process.argv.includes('--paid');
assert(process.argv.slice(2).every(a=>a==='--paid'),'Only --paid is supported');
const root=fileURLToPath(new URL('../',import.meta.url));
const html=fs.readFileSync(root+'dist/index.html','utf8');
const artifact=html.match(/app\.[a-f0-9]+\.js/)[0];
const bundle=fs.readFileSync(root+'dist/'+artifact);
const build=bundle.toString().match(/CT_MUSIC_BUILD_VERSION="([a-f0-9]+)"/)[1];
let stage='public preflight',calls=0,browser;
async function get(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(20000),redirect:'error'});}
try{
  for(const base of [origin,gateway]){
    const response=await get(base+'/create');assert.equal(response.status,200);
    assert.equal((await response.text()).match(/app\.[a-f0-9]+\.js/)?.[0],artifact);
    const js=await get(base+'/'+artifact);assert.equal(js.status,200);
    assert(Buffer.from(await js.arrayBuffer()).equals(bundle),'public artifact differs from tested bytes');
  }
  const access=await get(origin+'/api/music/chat/access');assert.equal(access.status,200);
  const info=await access.json();assert.equal(info.authenticated,false);
  assert.deepEqual(info.providers.map(p=>p.id).sort(),['anthropic','openai']);
  assert.match(access.headers.get('cache-control'),/no-store/);
  for(const [requestOrigin,status] of [[origin,401],['https://example.invalid',403]]){
    const denied=await get(origin+'/api/music/chat',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,status);
  }
  const count=await get(origin+'/api/presence/count');assert.equal(count.status,200);
  assert(Number.isFinite((await count.json()).listeners));
  await new Promise((resolve,reject)=>{
    const socket=new WebSocket('wss://chiptunes.app/api/presence');let greeting=false;
    const done=error=>{clearTimeout(timer);socket.close();error?reject(error):resolve();};
    const timer=setTimeout(()=>done(Error('Presence timeout')),15000);
    socket.addEventListener('error',()=>done(Error('Presence socket failed')),{once:true});
    socket.addEventListener('message',event=>{
      if(event.data==='pong'){if(greeting)done();return;}
      try{const value=JSON.parse(event.data);if(Number.isFinite(value.listeners)){greeting=true;socket.send('ping');}}catch{}
    });
  });
  console.log('PASS matching public artifact '+artifact+' / Music '+build+'; same-origin access, anonymous/foreign denial, presence count and WebSocket ping/pong.');
  if(paid){
    stage='fresh browser';
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1800,height:1100},serviceWorkers:'block'});
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/api/music/chat'&&request.method()==='POST'){
        calls++;console.log('Authorized production model request '+calls+'/2 ('+request.headers()['x-music-provider']+').');
        if(calls>2)return route.abort();
      }
      return route.continue();
    });
    const page=await context.newPage();page.setDefaultTimeout(40000);
    const pageErrors=[];page.on('pageerror',()=>pageErrors.push('pageerror'));
    await page.goto(origin+'/create');
    const code=page.getByLabel('Musical source code',{exact:true});await code.waitFor();
    assert.match(await page.locator('.mw-build').textContent(),new RegExp(build));
    assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot().playing),null);
    stage='owner unlock';
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    let password=execFileSync('security',['find-generic-password','-s','chiptunes-chat-owner','-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trimEnd();
    await page.locator('.mw-owner-password').fill(password);password='';
    await page.locator('[data-action=chat-unlock]').click();
    await page.waitForFunction(()=>document.querySelector('.mcui-status')?.textContent.startsWith('Unlocked.'));
    assert.equal(await page.locator('.mw-owner-password').inputValue(),'');
    const cookies=await context.cookies(origin);
    const owner=cookies.find(c=>c.name==='__Host-ct-chat-owner');
    assert(owner&&owner.secure&&owner.httpOnly&&owner.sameSite==='Strict'&&owner.domain==='chiptunes.app'&&owner.path==='/');
    assert.equal(calls,0);
    await page.locator('.mw-chat-provider').selectOption('openai');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    stage='prepare synthetic source';
    const source='// Production acceptance: synthetic music, no saved user project.\nsong({tempo:132,bars:8})\npattern("beat",cycleV1("C2 C2 C2 C2").gate(.15))\ntrack("drums").instrument("n-tick").play("beat",{repeat:8})\n';
    await code.fill(source);await code.press('ControlOrMeta+Enter');
    await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().playing===CT_MUSIC_WORKSPACE.snapshot().validated.id&&Audio.musicVisualState()?.status==='playing');
    const snapshot=()=>page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
    async function propose(provider,request){
      const before=await snapshot();
      await page.locator('.mcui textarea').fill(request);
      const response=page.waitForResponse(r=>r.url()===origin+'/api/music/chat'&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Send',exact:true}).click();
      const result=await response;
      if(result.status()!==200){let body;try{body=await result.json();}catch{};console.log('Provider result status '+result.status()+' / '+String(body?.error||body?.code||'unavailable').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60));throw Error('Provider request failed');}
      const apply=page.getByRole('log',{name:'Conversation'}).getByRole('button',{name:'Apply',exact:true});await apply.waitFor();
      const pending=await snapshot();assert.equal(pending.draft,before.draft);assert.equal(pending.playing,before.playing);
      await apply.click();
      await page.waitForFunction(id=>{const s=CT_MUSIC_WORKSPACE.snapshot();return s.validated.id!==id&&s.playing===s.validated.id;},before.validated.id);
      const next=await snapshot();assert(next.validated.compiled.gb.notes.length>0);
      assert(next.draft.includes('cycleV1(')&&next.draft.includes('// Production acceptance'));
      assert.equal(next.validated.compiled.settings.bars,8);
      assert.equal(next.validated.compiled.settings.tempo,132);
      console.log('PASS '+provider+' proposal stays draft until Apply; validated source reaches the existing player.');
      return {before,next};
    }
    stage='OpenAI composition';
    const composed=await propose('OpenAI','Compose a complete eight-bar C-major chiptune at 132 BPM. Keep my drum pattern and its play exactly unchanged. Add a readable named cycleV1 bass pattern on wave-bass and an alternating cycleV1 melody on p0, both played for eight output cycles. Preserve the comment and song settings. Use localized insertions, not exact events.');
    for(const ch of [0,2,3])assert(composed.next.validated.compiled.gb.notes.some(n=>n.ch===ch));
    stage='Claude scoped variation';
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('.mw-chat-provider').selectOption('anthropic');
    await page.locator('.mw-scope').selectOption('2');await page.getByRole('button',{name:'Done',exact:true}).click();
    const edited=await propose('Claude','Transpose only the bass pattern up two semitones by appending .transpose(2) to its cycleV1 chain. Preserve all other source, settings, instruments, drum and melody notes, and arrangement.');
    assert.deepEqual(edited.next.validated.compiled.gb.notes.filter(n=>n.ch!==2),edited.before.validated.compiled.gb.notes.filter(n=>n.ch!==2));
    assert.notDeepEqual(edited.next.validated.compiled.gb.notes.filter(n=>n.ch===2),edited.before.validated.compiled.gb.notes.filter(n=>n.ch===2));
    stage='revision undo and recovery';
    await page.locator('[data-action=undo]').click();
    await page.waitForFunction(source=>{const s=CT_MUSIC_WORKSPACE.snapshot();return s.draft===source&&s.playing===s.validated.id;},composed.next.draft);
    assert.deepEqual((await snapshot()).validated.compiled.gb,composed.next.validated.compiled.gb);
    await page.locator('[data-action=stop]').click();
    await page.locator('.mw-project-tools>summary').click();await page.locator('[data-action=save]').click();
    await page.waitForFunction(source=>JSON.parse(localStorage.getItem('ct-music-workspace-v1'))?.draft===source,composed.next.draft);
    await page.reload();await code.waitFor();assert.equal((await snapshot()).draft,composed.next.draft);assert.equal((await snapshot()).playing,null);
    stage='logout';await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[data-action=chat-logout]').click();
    await page.waitForFunction(()=>document.querySelector('.mcui-status')?.textContent.startsWith('Locked.'));
    assert(!(await context.cookies(origin)).some(c=>c.name==='__Host-ct-chat-owner'));
    assert.equal(calls,2);assert.equal(pageErrors.length,0);
    console.log('PASS exact Undo, private-session save/reload without autoplay, host-only owner cookie and logout; 2 paid calls, no retries.');
  }
}catch(error){
  // Intentionally omit thrown values/Playwright call logs: they may contain
  // credential-bearing arguments during an unlock failure.
  console.error('FAIL web release at '+stage+' ('+error.name+'); paid requests attempted: '+calls+'. No automatic retry.');process.exitCode=1;
}finally{if(browser)await browser.close();}
