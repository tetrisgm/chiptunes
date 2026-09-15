import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const dist=path.resolve(here,'../dist');
const pub=path.join(here,'public');
fs.mkdirSync(pub,{recursive:true});
// The pixel font the compositions use, copied from the built site rather than
// duplicated in git, so it can never drift from the one the app ships.
try{ fs.copyFileSync(path.join(dist,'fonts','press-start-2p.woff2'), path.join(pub,'press-start-2p.woff2')); }
catch(e){ console.warn('press-start-2p.woff2 not found in dist/fonts — run `node build.js` first'); }

const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/, '');
  let file=path.join(dist,pathname||'index.html');
  if(!file.startsWith(dist)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) file=path.join(dist,'index.html');
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
await page.goto(url,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(3500);
await page.screenshot({path:path.join(pub,'landing.png')});

await page.locator('.rmood').filter({hasText:'happy'}).first().click();
await page.waitForFunction(()=>!document.querySelector('.rmood.busy')&&document.body.classList.contains('ai-visual'),null,{timeout:30000});
await page.waitForTimeout(4200);
await page.evaluate(()=>{ if(window._pokeVisualControls) window._pokeVisualControls(); });
await page.screenshot({path:path.join(pub,'playing.png')});

await page.locator('#noteribbon').click();
await page.waitForFunction(()=>document.querySelector('#createscreen.show'),null,{timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(()=>{ const t=document.querySelector('.cr-tour'); if(t)t.remove(); });
await page.screenshot({path:path.join(pub,'create.png')});

// ---- THE AGENT SIDE ---------------------------------------------------
// Stills cannot show this: the whole point is a sequence, where a tool call
// lands and the app answers. So this records a REAL agent session — a mock
// model context is installed exactly as an agent browser installs one, the
// tools are called through it, and the page reacts on camera. Nothing is
// staged: the toasts, the music and the exports are the product working.
const SHIM = `
  window.__T = [];
  document.modelContext = {
    registerTool: function (t) { window.__T.push(t); return { unregister: function () {} }; }
  };
  window.__call = async function (n, a) {
    var t = window.__T.filter(function (x) { return x.name === n; })[0];
    if (!t) throw new Error('no tool ' + n);
    return JSON.parse((await t.execute(a || {})).content[0].text);
  };
  window.__say = async function (n, a) {
    var t = window.__T.filter(function (x) { return x.name === n; })[0];
    return (await t.execute(a || {})).content[0].text;
  };
`;

// 1) the explainer, as a judge first sees it (no agent yet)
const plain = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
await plain.goto(url + '/webmcp', {waitUntil:'domcontentloaded'});
await plain.waitForTimeout(4000);
await plain.screenshot({path:path.join(pub,'webmcp.png')});
await plain.evaluate(() => {
  const b = [...document.querySelectorAll('#wmcp button.b')].find(x => /detect/i.test(x.textContent));
  if (b) b.click();
});
await plain.waitForTimeout(600);
await plain.screenshot({path:path.join(pub,'webmcp-probe.png')});
await plain.close();

// 2) an agent session, recorded
const ctx = await browser.newContext({
  viewport:{width:1280,height:720}, deviceScaleFactor:1,
  recordVideo:{dir:path.join(here,'raw'), size:{width:1280,height:720}}
});
await ctx.addInitScript(SHIM);
const ag = await ctx.newPage();
await ag.goto(url + '/webmcp', {waitUntil:'domcontentloaded'});

// THE TIMELINE IS RECORDED, NOT GUESSED. Page load takes a different amount of
// time on every capture, so caption positions derived by eye from one recording
// are wrong in the next one — and a caption naming the wrong tool while the
// app's own toast names the right one is worse than no caption. Every call is
// timestamped against the start of the recording and written out for the
// composition to read.
const t0 = Date.now();
const timeline = [];
const mark = name => timeline.push({name, at: Date.now() - t0});
const beat = ms => ag.waitForTimeout(ms);

mark('load');
await beat(3500);                                   // agent bar appears, station behind
await ag.screenshot({path:path.join(pub,'agent-landing.png')});

mark('what_can_i_do_here');
await ag.evaluate(() => window.__say('what_can_i_do_here'));   await beat(1800);
mark('chiptunes_ask');
await ag.evaluate(() => window.__call('chiptunes_ask',
  {text:'a dungeon theme like Castlevania, 40 seconds, no drums'}));  await beat(6000);
mark('chiptunes_analyse');
await ag.evaluate(() => window.__call('chiptunes_analyse'));   await beat(2600);
mark('chiptunes_variations');
await ag.evaluate(() => window.__call('chiptunes_variations',
  {scene:'boss', seconds:30, n:12}));                          await beat(2600);
await ag.evaluate(async () => {
  const r = await window.__call('chiptunes_variations', {scene:'boss', seconds:30, n:12});
  await window.__call('chiptunes_play_song', {document:r.options[2].document});
});                                                            await beat(5500);
mark('chiptunes_variant');
await ag.evaluate(() => window.__call('chiptunes_variant', {mood:'darker'}));  await beat(5000);
mark('chiptunes_screen');
await ag.evaluate(() => window.__call('chiptunes_screen', {mode:'dmg'}));      await beat(3500);
mark('chiptunes_export');
await ag.evaluate(() => window.__call('chiptunes_export', {format:'rom'}));    await beat(2600);
mark('end');
await ag.screenshot({path:path.join(pub,'agent-mode.png')});
await ctx.close();                                  // flushes the recording

await browser.close();
server.close();

// Playwright writes webm; Remotion is happiest with mp4, and this also trims
// the dead air at the head of the recording.
const raw = fs.readdirSync(path.join(here,'raw')).filter(f=>f.endsWith('.webm'));
if (raw.length) {
  const src = path.join(here,'raw',raw[raw.length-1]);
  const dst = path.join(pub,'agent-session.mp4');
  const {execFileSync} = await import('node:child_process');
  execFileSync('ffmpeg',['-y','-i',src,'-an','-vf','fps=30,scale=1280:720','-c:v','libx264','-crf','20','-preset','veryfast',dst],{stdio:'ignore'});
  fs.rmSync(path.join(here,'raw'),{recursive:true,force:true});
  // Playwright starts recording when the page opens, which is a beat before our
  // first mark; measuring the finished file and scaling to it removes that drift
  // instead of guessing a constant.
  const dur = Number(execFileSync('ffprobe',
    ['-v','error','-show_entries','format=duration','-of','csv=p=0',dst]).toString().trim());
  fs.writeFileSync(path.join(pub,'timeline.json'),
    JSON.stringify({videoSeconds:dur, lastMarkMs:timeline[timeline.length-1].at, events:timeline}, null, 2));
  console.log('recorded agent-session.mp4 (' + dur.toFixed(1) + 's) + timeline.json');
}
console.log('captured landing, playing, Create, /webmcp and an agent session at 1280x720');
