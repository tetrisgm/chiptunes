'use strict';
// Isolated presentation regression, not a controller/provider or native Safari test.
// Bundles current JSX in memory only: never reads/writes dist or calls a provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildSync} = require('esbuild');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const bundle = buildSync({
    absWorkingDir:root, entryPoints:['src/music-chat-ui.jsx'], bundle:true,
    write:false, format:'iife', globalName:'CT_MUSIC_CHAT_UI', jsx:'transform',
    define:{'process.env.NODE_ENV':'"production"'}, minify:true
  }).outputFiles[0].text;
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({serviceWorkers:'block'});
    const requests = [], errors = [];
    // Block every outbound request, and also fail if any was attempted.
    context.on('request', request => requests.push(request.url()));
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push('Unexpected dialog: '+dialog.message()); await dialog.dismiss(); });
    await page.setContent('<button id="reopen">Reopen chat</button><div id="island" style="height:480px;width:360px;background:#121725;color:white"></div>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/music-chat-ui.css'),'utf8')});
    await page.addScriptTag({content:bundle});
    await page.evaluate(() => {
      window.calls = [];
      window.state = {input:'',messages:[],suggestions:['Gentle loop'],pending:false,canSend:true};
      window.ui = CT_MUSIC_CHAT_UI.mount(document.querySelector('#island'),state,{
        onInput(value) { state={...state,input:value}; ui.update(state); },
        onSend(value) { calls.push(['send',value]); state={...state,pending:true,input:''}; ui.update(state); },
        onStop() { calls.push(['stop']); state={...state,pending:false}; ui.update(state); },
        onApply(id) { calls.push(['apply',id]); },
        onReject(id) { calls.push(['reject',id]); },
        onSettings() { calls.push(['settings']); },
        onHide() {
          calls.push(['hide']);
          // Focus/collapse belongs to the host, represented explicitly by this fixture.
          document.querySelector('#reopen').focus();
          document.querySelector('#island').hidden=true;
        }
      });
      document.querySelector('#reopen').onclick=() => {
        document.querySelector('#island').hidden=false; ui.focus();
      };
    });
    const input = page.locator('.mcui textarea');
    const button = name => page.getByRole('button',{name,exact:true});
    const calls = () => page.evaluate(() => window.calls);
    const patch = change => page.evaluate(change => {state={...state,...change};ui.update(state);},change);
    await button('Gentle loop').click();
    assert.equal(await input.inputValue(),'Gentle loop');
    assert.deepEqual(await calls(),[],'suggestions must not submit');
    await input.press('Shift+Enter');
    assert((await input.inputValue()).includes('\n'));
    assert.deepEqual(await calls(),[]);
    await input.press('Enter');
    assert.deepEqual(await calls(),[['send','Gentle loop']]);
    assert(await page.getByText('Waiting for a reply…').isVisible());
    await input.fill('Preserve pending draft');
    await input.press('Enter');
    assert.equal((await calls()).length,1,'pending Enter cannot submit twice');
    await button('Hide chat').click();
    assert(await page.locator('#reopen').evaluate(el => el===document.activeElement));
    assert.equal(await page.locator('#island').isVisible(),false);
    await button('Reopen chat').click();
    assert.equal(await input.inputValue(),'Preserve pending draft');
    assert(await input.evaluate(el => el===document.activeElement));
    assert(await button('Stop generation').isVisible(),'collapse preserves request state');
    assert.equal((await calls()).filter(call => call[0]==='send').length,1);
    await button('Stop generation').click();
    assert.deepEqual((await calls()).at(-1),['stop']);

    await input.fill('IME');
    const beforeIME = (await calls()).length;
    // Synthetic composition covers the guard, not physical IME behavior.
    await input.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));
      el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    });
    assert.equal((await calls()).length,beforeIME);
    await input.evaluate(el => {
      el.setSelectionRange(0,el.value.length);
      const data=new DataTransfer();
      data.setData('text/plain','<img src=x onerror=alert(1)>');
      data.setData('text/html','<img src=https://example.invalid/paste>');
      el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    });
    assert.equal(await input.inputValue(),'<img src=x onerror=alert(1)>');
    assert.equal(await input.evaluate(el => el.selectionStart),'<img src=x onerror=alert(1)>'.length);
    const beforeFile = await input.inputValue();
    await input.evaluate(el => {
      const data=new DataTransfer();data.items.add(new File(['fixture'],'fixture.png',{type:'image/png'}));
      el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    });
    assert.equal(await input.inputValue(),beforeFile,'file-only paste is inert');
    assert.equal(await page.locator('.mcui form').evaluate(el => {
      const data=new DataTransfer();data.items.add(new File(['fixture'],'fixture.png'));
      return el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
    }),false,'file drop is prevented');

    const hostile='<img src="https://example.invalid/model" onerror="window.injected=true">'+
      '<script>window.injected=true</script><svg onload="window.injected=true"></svg>'+
      '<iframe src="https://example.invalid/frame"></iframe>![image](https://example.invalid/markdown)';
    await patch({messages:[{role:'assistant',content:hostile}],proposal:{id:'p1',status:'ready',summary:hostile,preview:hostile,canApply:true}});
    assert.equal(await page.locator('.mcui-message p').textContent(),hostile);
    assert.equal(await page.locator('.mcui-proposal pre').textContent(),hostile);
    assert.equal(await page.locator('#island img, #island svg, #island script, #island iframe, #island a').count(),0);
    assert.equal(await page.evaluate(() => window.injected),undefined);
    assert.equal(await page.locator('.mcui [data-action]').count(),0,'React controls must not trigger root action delegation');
    await button('Apply').click();
    assert.deepEqual((await calls()).at(-1),['apply','p1']);
    await patch({proposal:{id:'p1',status:'ready',summary:'No longer applicable',canApply:false}});
    assert(await button('Apply').isDisabled());
    await patch({proposal:null});
    assert.equal(await button('Apply').count(),0,'history alone never supplies Apply');

    await patch({messages:Array.from({length:30},(_,i) => ({role:'assistant',content:'Message '+i+'\nMore lines\nMore lines'}))});
    const log=page.locator('.mcui-log');
    await log.evaluate(el => {el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
    await button('Scroll to latest').waitFor();
    await page.evaluate(() => {state={...state,messages:[...state.messages,{role:'assistant',content:'Newest'}]};ui.update(state);});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await log.evaluate(el => el.scrollTop),0,'new output must not pull reader down');
    await button('Hide chat').click();await button('Reopen chat').click();
    assert.equal(await log.evaluate(el => el.scrollTop),0,'collapse retains reader position');
    await button('Scroll to latest').click();
    assert(await log.evaluate(el => el.scrollHeight-el.clientHeight-el.scrollTop<24));
    await page.evaluate(() => {state={...state,messages:[...state.messages,{role:'assistant',content:'Following newest'}]};ui.update(state);});
    assert(await log.evaluate(el => el.scrollHeight-el.clientHeight-el.scrollTop<24));
    const countBeforeDestroy=(await calls()).length;
    await page.evaluate(() => {ui.destroy();ui.destroy();ui.update(state);ui.focus();});
    assert.equal(await page.locator('#island').innerHTML(),'');
    assert.equal((await calls()).length,countBeforeDestroy,'lifecycle never dispatches actions');
    assert.deepEqual(errors,[]);
    assert.deepEqual(requests,[],'hostile content must not even attempt external requests');
    console.log('PASS isolated chat UI: Send/Stop, fill-only suggestions, ShiftEnter/synthetic IME, text-only paste/drop, hostile text/no requests, current Apply, scrolling, host collapse/focus, destroy; React '+require('react/package.json').version+' / ReactDOM '+require('react-dom/package.json').version+'; in-memory bundle, no dist writes.');
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
