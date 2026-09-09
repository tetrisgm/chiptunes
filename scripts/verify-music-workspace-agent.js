'use strict';
// Source-only browser bridge checks; no build, provider, or hosted transport.
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const server=http.createServer((req,res)=>res.end('<!doctype html><body></body>'));
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const chatBundle=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/music-chat-ui.jsx')],bundle:true,write:false,format:'iife',globalName:'CT_MUSIC_CHAT_UI',define:{'process.env.NODE_ENV':'"production"'}});
    await page.addScriptTag({content:chatBundle.outputFiles[0].text});
    for(const file of ['gb-hardware.js','music-language.js','music-project.js','music-chat.js'])
      await page.addScriptTag({path:path.join(__dirname,'../src',file)});
    await page.evaluate(()=>{
      window.Audio={musicStop(){},enterCreate(){},onMusicState(){return ()=>{};}};
      window.CT_CREATE={};
      window.fetch=async(url,options)=>{
        if(options.credentials!=='same-origin')throw Error('Fixture requires same-origin credentials');
        // Explicit owner-session fixture; production still requires unlock.
        if(url==='/api/music/chat/access'){
          if(options.method!=='GET')throw Error('Unexpected access mutation');
          return new Response(JSON.stringify({ok:true,authenticated:true,providers:[{id:'openai',label:'OpenAI'}],limits:{dailyCalls:20}}));
        }
        if(url!=='/api/music/chat'||options.headers['X-Music-Provider']!=='openai')throw Error('Unexpected chat request');
        const request=JSON.parse(options.body);
        return new Promise(resolve=>{window.finishChat=()=>resolve(new Response(JSON.stringify({id:request.id,baseRevision:request.baseRevision,
          edits:[{from:0,to:0,text:'// chat\n'}],explanation:'Local Chat comment'}),{status:200}));});
      };
      window.CT_MUSIC_CODE_EDITOR={help:{},mount(el,text,change){
        window.editSource=value=>{text=value;change(value);};return {value(){return text;},set(value){text=value;},diagnostics(){},focus(){},select(){}};
      }};
    });
    await page.addScriptTag({path:path.join(__dirname,'../src/music-workspace.js')});
    await page.evaluate(()=>CT_MUSIC_WORKSPACE.open());
    await page.waitForFunction(()=>document.querySelector('.mcui-status').textContent.startsWith('Unlocked.'));
    const result=await page.evaluate(async()=>{
      const w=CT_MUSIC_WORKSPACE,checks=[];
      function check(value,label){if(!value)throw Error(label);checks.push(label);}
      function input(id,context=w.agentContext()){
        const from=context.source.indexOf('128');
        return {id,context,edits:[{from,to:from+3,text:'129'}],explanation:'Change tempo'};
      }
      const original=w.snapshot(),a=input('first');
      const bad=[
        {...input('bytes'),edits:[{from:0,to:0,text:'é'.repeat(8193)}]},
        {...input('unicode'),explanation:'\uD800'},
        {...input('unicode-edit'),edits:[{from:0,to:0,text:'\uDC00'}]},
        {...input('count'),edits:Array.from({length:33},(_,i)=>({from:i,to:i,text:'x'}))},
        {...input('overlap'),edits:[{from:0,to:3,text:'x'},{from:2,to:4,text:'y'}]},
        {...input('order'),edits:[{from:4,to:5,text:'x'},{from:1,to:2,text:'y'}]},
        {...input('whole'),edits:[{from:0,to:original.draft.length,text:'song({bars:1})'}]},
        {...input('noop'),edits:[{from:0,to:0,text:''}]},
        {...input('aggregate'),edits:[{from:0,to:0,text:'é'.repeat(4096)},{from:1,to:1,text:'é'.repeat(4097)}]},
        {...input('removal'),context:{...w.agentContext(),source:'x'.repeat(20000)},edits:[{from:0,to:16385,text:''}]},
        {...input('candidate'),context:{...w.agentContext(),source:'x'.repeat(524288)},edits:[{from:0,to:0,text:'x'}]},
        {...input('split'),context:{...w.agentContext(),source:'// 🎵\nsong({bars:1})'},edits:[{from:4,to:4,text:'x'}]},
        {...input('source-unicode'),context:{...w.agentContext(),source:'// \uD800'}},
        {...input('collective'),context:{...w.agentContext(),source:'abcd'},edits:[{from:0,to:2,text:'x'},{from:2,to:4,text:'y'}]},
        {...input('source'),context:{...w.agentContext(),source:'é'.repeat(262145)}}
      ];
      bad.forEach(b=>check(w.agentPropose(b).code==='invalid-proposal','bounds reject '+b.id));
      check(w.snapshot().request===null,'invalid bounds do not reserve request');
      check(w.agentPropose(a).status==='ready','proposal ready');
      a.edits[0].text='999';a.context.source='changed';
      check(w.snapshot().draft===original.draft,'proposal does not apply or alias caller');
      check(w.agentPropose(input('busy')).code==='request-active','single active request');
      document.querySelector('.mw-lock').value='track';
      // No change event: Apply must still compare the exact current context.
      [...document.querySelectorAll('.mcui-proposal button')].find(b=>b.textContent==='Apply').click();
      check(w.agentProposalStatus('first').status==='superseded','Apply rejects changed policy without event');
      check(w.snapshot().draft===original.draft,'stale Apply preserves source');
      document.querySelector('.mw-lock').value='none';
      check(w.agentPropose(input('apply')).status==='ready','new context accepted');
      [...document.querySelectorAll('.mcui-proposal button')].find(b=>b.textContent==='Apply').click();
      check(w.agentProposalStatus('apply').status==='validated','explicit Apply validates');
      check(w.snapshot().validated.id!==original.validated.id&&w.snapshot().playing===null,'one revision without autoplay');
      // Remaining proposals use a comment insertion, valid under every musical lock.
      function comment(id,context=w.agentContext()){return {id,context,edits:[{from:0,to:0,text:'// agent\n'}],explanation:'Comment'};}
      check(w.agentPropose(comment('edit')).status==='ready','comment ready');
      window.editSource(w.snapshot().draft+'// local\n');
      check(w.agentProposalStatus('edit').status==='superseded'&&!w.agentContext().editable,'draft edit invalidates');
      document.querySelector('[data-action=apply]').click();await Promise.resolve();await Promise.resolve();
      check(w.agentPropose(comment('policy')).status==='ready','validated draft usable');
      const lock=document.querySelector('.mw-lock');lock.value='track';lock.dispatchEvent(new Event('change'));
      lock.value='none';lock.dispatchEvent(new Event('change'));
      check(w.agentProposalStatus('policy').status==='superseded','policy change and revert invalidates');
      const stale=w.agentContext();check(w.agentPropose(comment('disconnect')).status==='ready','disconnect fixture ready');
      w.agentDisconnect();
      check(w.agentProposalStatus('disconnect').status==='cancelled','disconnect cancels proposal');
      check(w.agentPropose(comment('stale',stale)).code==='stale-context','disconnect rotates token');
      const token=w.agentContext().projectInstance;w.close();
      check(w.agentContext().code==='workspace-closed','closed context denied');
      await w.open();check(w.agentContext().projectInstance!==token,'reopen rotates token');
      window.editSource('song({totalFrames:120})\ninstruments([[128,240,255,0]])\nevent({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n');
      document.querySelector('[data-action=apply]').click();await Promise.resolve();await Promise.resolve();
      check(w.agentPropose(comment('selection')).status==='ready','selection fixture ready');
      document.querySelector('.mw-note').click();
      check(w.agentProposalStatus('selection').status==='superseded','note selection invalidates');
      check(w.agentContext().policy.selection.ch===0,'context includes selected region');
      async function startChat(){
        const deadline=Date.now()+2000;
        while(!document.querySelector('.mcui-status').textContent.startsWith('Unlocked.')){
          if(Date.now()>deadline)throw Error('Authenticated chat fixture did not become ready');
          await new Promise(r=>setTimeout(r,0));
        }
        window.finishChat=null;
        const input=document.querySelector('.mcui textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Add a comment');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('.mcui button[type=submit]').click();
        while(!window.finishChat){
          if(Date.now()>deadline)throw Error('Chat fixture was not called');
          await new Promise(r=>setTimeout(r,0));
        }
      }
      async function finishChat(){window.finishChat();for(let i=0;i<30;i++)await new Promise(r=>setTimeout(r,0));}
      function proposalState(){return document.querySelector('.mcui-proposal b').textContent;}
      await startChat();await finishChat();check(proposalState()==='ready','local Chat ready');
      const beforeChat=w.snapshot().validated.id;
      [...document.querySelectorAll('.mcui-proposal button')].find(b=>b.textContent==='Apply').click();
      check(w.snapshot().validated.id!==beforeChat,'local Chat explicit Apply works');
      await startChat();await finishChat();
      lock.value='track';lock.dispatchEvent(new Event('change'));
      check(proposalState()==='superseded'&&w.snapshot().request===null,'local Chat ready policy invalidation');
      lock.value='none';lock.dispatchEvent(new Event('change'));
      await startChat();
      lock.value='track';lock.dispatchEvent(new Event('change'));await finishChat();
      check(proposalState()==='superseded','late local Chat reply cannot revive changed policy');
      lock.value='none';lock.dispatchEvent(new Event('change'));
      await startChat();await finishChat();
      lock.value='track';
      [...document.querySelectorAll('.mcui-proposal button')].find(b=>b.textContent==='Apply').click();
      check(proposalState()==='superseded','local Chat Apply checks policy without event');
      lock.value='none';lock.dispatchEvent(new Event('change'));
      return checks;
    });
    const beforeImport=await page.evaluate(()=>CT_MUSIC_WORKSPACE.agentContext().projectInstance);
    const serialized=await page.evaluate(()=>CT_MUSIC_PROJECT.create(CT_MUSIC_WORKSPACE.snapshot().draft,{compile:CT_MUSIC_LANGUAGE.compile,assetsVersion:'ct-gb-bank-1'}).serialize());
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('.mw-project-tools>summary').click();
    const chooser=page.waitForEvent('filechooser');
    await page.click('[data-action=open]');
    await (await chooser).setFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(serialized)});
    await page.waitForFunction(token=>CT_MUSIC_WORKSPACE.agentContext().projectInstance!==token,beforeImport);
    result.push('file import rotates project instance');
    assert.deepEqual(errors,[]);console.log(result.length+' browser agent checks passed');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
