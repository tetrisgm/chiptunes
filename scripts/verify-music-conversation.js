'use strict';
// Offline browser conversation regression. Uses the built app and real client;
// only authenticated access/model HTTP responses are explicitly fixture data.
// No build, live network, credentials, paid model calls or deployment.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const dist=path.join(__dirname,'../dist'),origin='https://chiptunes.app',key='ct-music-workspace-v1';
const html=fs.readFileSync(path.join(dist,'create/index.html'),'utf8');
const app=html.match(/app\.[a-f0-9]+\.js/)[0],bundle=fs.readFileSync(path.join(dist,app));
const literal='PRIVATE_REPLY <img src=x onerror="globalThis.conversationInjected=true">';
async function main(){
  const browser=await chromium.launch({headless:true});
  const calls=[],errors=[];let held,hold=false;
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
    await context.setOffline(true);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/api/music/chat/access'){
        assert.equal(request.method(),'GET','fixture is already authenticated; no password needed');
        return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authenticated:true,providers:[{id:'openai',label:'OpenAI'}],limits:{dailyCalls:20}})});
      }
      if(url.pathname==='/api/music/chat'){
        assert.equal(request.method(),'POST');
        const input=request.postDataJSON();calls.push(input);
        assert.equal(request.headers()['x-music-provider'],'openai');
        const proposal=input.request.includes('edit');
        const output={id:input.id,baseRevision:input.baseRevision,edits:proposal?[{from:0,to:0,text:'// FIXTURE_EDIT\n'}]:[],explanation:proposal?'PRIVATE_PROPOSAL: add a comment':literal};
        const finish=()=>route.fulfill({contentType:'application/json',body:JSON.stringify(output)});
        if(hold){held=finish;return;}
        return finish();
      }
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,body:'{}'});
      if(['/create','/create/'].includes(url.pathname))return route.fulfill({contentType:'text/html',body:html});
      if(url.pathname==='/'+app)return route.fulfill({contentType:'text/javascript',body:bundle});
      const file=path.resolve(dist,'.'+url.pathname);
      if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
    });
    await context.addInitScript(origin=>{if(location.origin===origin)localStorage.setItem('ct-create-tour','1');},origin);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/create#music');
    await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content',{state:'attached'});
    await exercise(page,{calls,getHeld:()=>held,setHold:value=>{hold=value;if(value)held=undefined;},errors});
    console.log('PASS conversation: offline browser transcript, empty edits, follow-up context, explicit Apply/stale safety, private recovery/public omission ('+app+')');
  }finally{await browser.close();}
}
async function exercise(page,fixture){
  async function waitHeld(){
    for(let i=0;i<100&&!fixture.getHeld();i++)await page.waitForTimeout(25);
    assert.equal(typeof fixture.getHeld(),'function','fixture must receive the held request');
  }
  const input=page.locator('.mcui textarea'),send=page.getByRole('button',{name:'Send',exact:true});
  const log=page.getByRole('log',{name:'Conversation'}),settings=page.getByRole('dialog',{name:'Chat settings'});
  const snapshot=()=>page.evaluate(()=>CT_MUSIC_WORKSPACE.snapshot());
  await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().request===null && document.querySelector('.mcui-status')?.textContent.startsWith('Unlocked.'));
  assert.equal(await send.textContent(),'Send');assert.equal(await log.isVisible(),true);
  assert.equal(await settings.isVisible(),false,'settings are a closed dialog, not a permanent form');
  assert.equal(await page.locator('.mw-owner-password').isVisible(),false);
  assert.equal(await page.locator('.mw-chat-provider').isVisible(),false);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await settings.waitFor({state:'visible'});
  assert.equal(await settings.evaluate(el=>el.tagName),'DIALOG');
  assert.equal(await page.locator('.mw-owner-password').isVisible(),true);
  // Native dialogs can yield to browser chrome (activeElement becomes body),
  // but must never focus background page controls. Tab back enters the dialog.
  assert.equal(await settings.evaluate(el=>el.contains(document.activeElement)),true,'dialog receives focus');
  for(const key of ['Tab','Shift+Tab'])for(let i=0;i<20;i++){
    await page.keyboard.press(key);
    assert.equal(await settings.evaluate(el=>el.contains(document.activeElement)||document.activeElement===document.body),true,key+' cannot reach background controls');
  }
  if(await page.evaluate(()=>document.activeElement===document.body))await page.keyboard.press('Tab');
  assert.equal(await settings.evaluate(el=>el.contains(document.activeElement)),true,'Tab returns from browser chrome into dialog');
  await page.keyboard.press('Escape');
  assert.equal(await settings.isVisible(),false,'Escape dismisses settings');
  assert.equal(await page.evaluate(()=>CT_MUSIC_WORKSPACE.isOpen()),true,'modal Escape does not close workspace');
  assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).evaluate(el=>el===document.activeElement),true,'Escape restores opener focus');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await settings.waitFor({state:'visible'});
  await page.click('[data-action=chat-settings-close]');
  assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).evaluate(el=>el===document.activeElement),true,'Done restores opener focus');
  assert.equal(await settings.isVisible(),false);assert.equal(fixture.calls.length,0);
  const initial=await snapshot();
  await input.fill('PRIVATE_QUESTION explain this loop');await input.press('Shift+Enter');
  assert.equal(await input.inputValue(),'PRIVATE_QUESTION explain this loop\n','Shift+Enter inserts a newline');
  assert.equal(fixture.calls.length,0,'Shift+Enter does not submit');
  await input.press('Enter');
  await log.getByText(literal,{exact:true}).first().waitFor();
  assert.equal(fixture.calls.length,1,'Enter sends once');
  assert.equal(fixture.calls[0].request,'PRIVATE_QUESTION explain this loop');
  assert.equal(await input.inputValue(),'','sent input clears');
  assert.equal(await log.locator('img').count(),0,'reply HTML is rendered as text');
  assert.equal(await page.evaluate(()=>globalThis.conversationInjected),undefined);
  let state=await snapshot();
  assert.equal(state.draft,initial.draft);assert.equal(state.validated.id,initial.validated.id);
  assert.equal(state.pending,null);assert.equal(state.playing,null);
  assert.equal(await log.getByRole('button',{name:'Apply',exact:true}).count(),0,'text reply has no Apply control');
  await input.fill('PRIVATE_FOLLOWUP tell me more');await send.click();
  await page.waitForFunction(()=>document.querySelectorAll('.mcui-content').length>0);
  await log.getByText(literal,{exact:true}).nth(1).waitFor();
  assert.equal(fixture.calls.length,2);
  assert.deepEqual(fixture.calls[1].conversation,[
    {role:'user',content:'PRIVATE_QUESTION explain this loop'},
    {role:'assistant',content:literal}
  ],'follow-up carries previous user/assistant turns, not current request twice');
  assert.equal(fixture.calls[1].baseRevision,initial.validated.id);
  assert.equal(fixture.calls[1].source,initial.draft);
  await input.fill('Please edit with a comment');await send.click();
  const apply=log.getByRole('button',{name:'Apply',exact:true});await apply.waitFor();
  state=await snapshot();assert.equal(state.validated.id,initial.validated.id);assert.equal(state.draft,initial.draft);
  await apply.click();
  await page.waitForFunction(id=>CT_MUSIC_WORKSPACE.snapshot().validated.id!==id,initial.validated.id);
  const applied=await snapshot();assert.equal(applied.draft,'// FIXTURE_EDIT\n'+initial.draft);
  assert.equal(await apply.count(),0,'applied proposal cannot apply twice');
  // A second, held response targets the old base; typing invalidates its authority.
  fixture.setHold(true);await input.fill('Please edit again');await send.click();
  await waitHeld();
  assert.equal(fixture.calls.length,4);assert.equal(typeof fixture.getHeld(),'function');
  const editor=page.locator('#musicworkspace .cm-content');
  const manual=applied.draft+'\n// newer manual draft';await editor.fill(manual);
  await fixture.getHeld()().catch(()=>{});fixture.setHold(false);
  await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().request===null && document.querySelector('.mcui-status')?.textContent.startsWith('Unlocked.'));
  assert.equal((await snapshot()).draft,manual,'late reply cannot replace newer draft');
  assert.equal((await snapshot()).validated.id,applied.validated.id);
  assert.equal(await log.getByRole('button',{name:'Apply',exact:true}).count(),0,'stale response has no usable Apply');
  // Explicit Stop generation must reject a late reply independently of draft edits.
  // beginRequest requires draft === validated source. The preceding stale test
  // deliberately broke that precondition; restore it without applying a revision.
  await editor.fill(applied.draft);
  assert.equal((await snapshot()).draft,(await snapshot()).validated.source);
  const transcriptBefore=await log.locator('.mcui-assistant').allTextContents();
  fixture.setHold(true);await input.fill('Please edit after cancellation');await send.click();await waitHeld();
  assert.equal(fixture.calls.length,5);
  await page.getByRole('button',{name:'Stop generation',exact:true}).click();
  await page.waitForFunction(()=>CT_MUSIC_WORKSPACE.snapshot().request===null && document.querySelector('.mcui-status')?.textContent.startsWith('Unlocked.'));
  await fixture.getHeld()().catch(()=>{});fixture.setHold(false);
  await page.waitForTimeout(150); // Let a wrongly accepted late reply render.
  assert.equal(fixture.calls.length,5,'cancel never retries');
  assert.equal((await snapshot()).draft,applied.draft);assert.equal((await snapshot()).validated.id,applied.validated.id);
  assert.equal(await log.getByRole('button',{name:'Apply',exact:true}).count(),0,'cancelled reply cannot offer Apply');
  assert.deepEqual(await log.locator('.mcui-assistant').allTextContents(),transcriptBefore,'cancelled response never enters transcript');
  await editor.fill(manual); // Recoverable unfinished text remains the persistence fixture.
  await page.locator('.mw-project-tools>summary').click();
  await page.click('[data-action=save]');
  await page.waitForFunction(k=>{const saved=JSON.parse(localStorage.getItem(k));return saved?.draft.endsWith('// newer manual draft')&&saved.private?.chat?.some(m=>m.content.includes('PRIVATE_FOLLOWUP'));},key);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
  assert(saved.private.chat.some(m=>m.role==='assistant'&&m.content===literal));
  await page.reload();await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content',{state:'attached'});
  await page.getByRole('log',{name:'Conversation'}).getByText(literal,{exact:true}).first().waitFor();
  assert.equal((await snapshot()).draft,manual);assert.equal(fixture.calls.length,5,'reload never resends model requests');
  await page.locator('.mw-project-tools>summary').click();
  const downloading=page.waitForEvent('download');await page.click('[data-action=download]');
  const download=await downloading,privateExport=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.deepEqual(privateExport.private.chat,saved.private.chat,'private project download retains transcript');
  await page.click('[data-action=share]');
  await page.waitForFunction(()=>document.querySelector('.mw-status').textContent.includes('Copied project link'));
  const link=await page.evaluate(()=>navigator.clipboard.readText());
  const publicExport=JSON.parse(Buffer.from(decodeURIComponent(new URL(link).hash.slice('#music='.length)),'base64').toString('utf8'));
  assert.equal(publicExport.private,undefined);assert.equal(publicExport.draft,manual);
  assert.equal(JSON.stringify(publicExport).includes('PRIVATE_'),false,'public share excludes conversation');
  for(const call of fixture.calls){
    assert((call.conversation||[]).length<=12);
    assert((call.conversation||[]).reduce((n,m)=>n+Buffer.byteLength(m.content),0)<=16384);
    for(const message of call.conversation||[])assert.deepEqual(Object.keys(message).sort(),['content','role']);
  }
  assert.deepEqual(fixture.errors,[]);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
