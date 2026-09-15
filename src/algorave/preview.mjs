import { example } from './examples.mjs';
import { codeEditor } from './code-editor.mjs';
import contract from './project.cjs';
import { ProjectSession } from './session.mjs';
import { AgentClient } from './agent-client.mjs';
import { MusicBridge } from './music-bridge.mjs';
import { MusicSignals } from './music-signals.mjs';
import { ShaderRuntime } from './shader-runtime.mjs';
import {fetchSample,inspectSampleWav,SAMPLE_LIMITS} from './sample-assets.mjs';
import {loadSamples,saveSamples} from './sample-persistence.mjs';
import {sampleIds,exportSampleProject,importSampleProject,SAMPLE_PROJECT_BYTES} from './sample-project.mjs';
const $ = id => document.getElementById(id);
const status = $('status');
const music = codeEditor($('music'), {language:'music',label:'Strudel music'});
const visual = codeEditor($('visual'), {language:'visual',label:'GLSL visual'});
let signal = {}, playing = false, last = 0, focus = 'music', playRequested = false, openRequested = false, visualPass = 'Image';
let bridge, shader, pendingProposal, pendingContext, uiBusy = false, saveTimer;
let sampleStorePromise,sampleAbort;
const sampleStore=()=>sampleStorePromise||(sampleStorePromise=loadSamples().catch(error=>{sampleStorePromise=null;throw error;}));
const initial = example();
const signals = new MusicSignals(), agent = new AgentClient();
const runtime = {
  async prepare(next, previous) {
    const pendingSample=sampleAbort;
    const musicChanged = next.music !== previous.music || JSON.stringify(next.samples)!==JSON.stringify(previous.samples) || playRequested || openRequested;
    const shouldPlay = !openRequested && (playing || playRequested);
    const visualChanged = JSON.stringify(next.visuals) !== JSON.stringify(previous.visuals);
    const visualCandidate = visualChanged ? shader.prepare(next.visuals) : null;
    let token;
    try { if (musicChanged) {
      const ids=sampleIds(next),store=ids.length?await sampleStore():null;
      const assets=ids.map(id=>({id,bytes:store.get(id)}));
      ({ token } = await bridge.request('prepare', next.music,{samples:next.samples,assets}));
    } }
    catch (error) { visualCandidate?.dispose(); throw error; }
    return {
      async apply() {
        if(pendingSample?.signal.aborted)throw Error('Sample loading cancelled.');
        if(pendingSample)$('sample-cancel').disabled=true;
        // Both candidates have been validated. Apply the visual transaction first;
        // if audio activation fails, restore the previous applied visual source.
        let visualApplied = false;
        try {
          if (visualCandidate) { visualCandidate.apply(); visualApplied = true; }
          if (musicChanged) {
            const result = await bridge.request('commit', undefined, { token, play:shouldPlay });
            playing = result.playing; token = undefined;
          }
        } catch (error) {
          if (visualApplied) shader.set(previous.visuals);
          throw error;
        }
      },
      dispose() {
        visualCandidate?.dispose();
        if (token !== undefined) void bridge.request('discard', undefined, {token}).catch(() => {});
      },
    };
  },
};
let storage;
try { storage = localStorage; } catch {}
const session = new ProjectSession(initial, runtime, storage);
function showProject() {
  music.value = session.draft.music;
  visual.switchDocument(session.draft.visuals[visualPass] || '', visualPass);
  $('channels').value = JSON.stringify(session.draft.visuals.channels);
  $('undo').disabled = !session.history.length || uiBusy;
  $('agent-undo').disabled = $('undo').disabled;
}
showProject();
shader = new ShaderRuntime($('canvas'), { onStatus: text => { status.textContent = text; } });
shader.set(session.applied.visuals);
const resize = new ResizeObserver(() => {
  try { const rect = $('canvas').getBoundingClientRect(); shader.resize(rect.width * devicePixelRatio, rect.height * devicePixelRatio); }
  catch (error) { status.textContent = error.message; }
});
resize.observe($('canvas'));
window.addEventListener('pagehide', () => { resize.disconnect(); shader.dispose(); agent.cancel(); sampleAbort?.abort(); clearTimeout(saveTimer); music.destroy(); visual.destroy(); });
function message(error) { status.textContent = error.message || String(error); if($('sample-dialog').open)$('sample-feedback').textContent=status.textContent; }
music.onLimit = visual.onLimit = text => message(text);
function save(explicit = false) {
  try { session.save({replaceUnreadable:explicit}); if (explicit) status.textContent = 'Saved on this device'; }
  catch (error) { message(error); }
}
function changed() {
  try {
    const next = structuredClone(session.draft); next.music = music.value;
    if (visualPass !== 'Image' && visual.value === '') delete next.visuals[visualPass];
    else next.visuals[visualPass] = visual.value;
    session.edit(next);
    clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 400);
  } catch (error) { message(error); }
}
music.oninput = changed; visual.oninput = changed;
function lock(value) {
  uiBusy = value; music.readOnly = value; visual.readOnly = value;
  for (const id of ['run','play','apply','undo','pass','set-channels','channels','open','examples','sample-open','sample-add']) $(id).disabled = value;
  $('undo').disabled = value || !session.history.length;
  $('agent-undo').disabled = $('undo').disabled;
  $('apply').disabled = value || !pendingProposal?.edits.length;
}
async function action(fn) {
  if (uiBusy) return;
  lock(true);
  try { await fn(); showProject(); save(); }
  catch (error) { message(error); }
  finally { lock(false); $('play').textContent = playing ? 'Stop' : 'Play'; }
}
async function run() {
  await action(async () => {
    const next = structuredClone(session.applied);
    if (focus === 'visual') next.visuals = structuredClone(session.draft.visuals);
    else { next.music = session.draft.music; playRequested = true; }
    try {
      if(playRequested&&!playing)await bridge.request('unlock');
      await session.activate(next, {draftAfter:session.draft}); status.textContent = focus === 'visual' ? 'Visuals updated' : 'Music updated';
    }
    catch (error) {
      const match = focus === 'visual' ? /(?:ERROR|WARNING):\s*0:(\d+):/.exec(error.message) : /\((\d+):(\d+)\)/.exec(error.message);
      if (match) (focus === 'visual' ? visual : music).error(error.message, {line:Number(match[1]),column:Number(match[2] || 0)});
      throw error;
    }
    finally { playRequested = false; }
  });
}
$('mode').onchange = () => { document.body.dataset.mode = $('mode').value; focus = $('mode').value === 'visuals' ? 'visual' : 'music'; };
music.onfocus = () => focus = 'music'; visual.onfocus = () => focus = 'visual';
$('pass').onchange = () => { visualPass = $('pass').value; visual.switchDocument(session.draft.visuals[visualPass] || '', visualPass); focus = 'visual'; };
$('set-channels').onclick = () => {
  try { const next = structuredClone(session.draft); next.visuals.channels = JSON.parse($('channels').value); session.edit(next); save(); status.textContent = 'Channel draft updated · Run visuals to apply'; }
  catch (error) { message(error); }
};
$('run').onclick = run;
$('play').onclick = async () => {
  if (!playing) { focus = 'music'; await run(); return; }
  await action(async () => { await bridge.request('stop'); playing = false; status.textContent = 'Stopped'; });
};
async function openProject(next) {
  await action(async () => {
    status.textContent = 'Opening project…';
    openRequested = true;
    try { await session.activate(contract.project(next)); music.resetHistory(); visual.resetHistory(); visualPass = 'Image'; $('pass').value = 'Image'; pendingProposal = null; $('proposal').hidden = true; status.textContent = 'Project opened · press Play'; }
    finally { openRequested = false; }
  });
}
$('open').onclick = () => $('project-file').click();
$('project-file').onchange = async () => {
  const file = $('project-file').files[0]; $('project-file').value = '';
  if (!file) return;
  const generation = session.generation;
  try {
    if (file.size > SAMPLE_PROJECT_BYTES) throw Error('Project files must be at most 24 MiB including samples.');
    const imported = await importSampleProject(JSON.parse(await file.text()));
    if (generation !== session.generation) throw Error('The draft changed while the file was being read. Open it again.');
    if(imported.store){
      const store=await sampleStore();
      for(const {id} of imported.store.snapshot().assets)await store.put(imported.store.get(id));
      await saveSamples(store);
      if(generation!==session.generation)throw Error('The draft changed while samples were being saved. Open it again.');
    }
    await openProject(imported.project);
  } catch (error) { message(Error('Could not open this audiovisual project: ' + error.message)); }
};
$('examples').onchange = async () => {
  const name = $('examples').value; $('examples').value = '';
  if (name) await openProject(example(name));
};
async function leaveFor(path) {
  await action(async()=>{
    session.save();
    await bridge.request('stop');playing=false;bridge.dispose();
    // Change the query/path too, so this is a full navigation rather than a
    // same-document hash change that could leave another engine alive.
    window.top.location.assign(path);
  });
}
$('chip-projects').onclick=()=>leaveFor('/create?editor=chip#music');
$('listen').onclick=()=>leaveFor('/listen');
$('help-open').onclick = () => $('help').showModal();
$('help-close').onclick = () => $('help').close();
$('save').onclick = () => save(true);
$('download').onclick = async () => {
  try{
  const snapshot=contract.project(session.draft),store=sampleIds(snapshot).length?await sampleStore():null;
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportSampleProject(snapshot,store),null,2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'chiptunes-algorave.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  }catch(error){message(error);}
};
$('sample-open').onclick=()=>{$('menu').open=false;$('sample-feedback').textContent='';$('sample-dialog').showModal();};
$('sample-cancel').onclick=()=>{sampleAbort?.abort();$('sample-dialog').close();};
$('sample-dialog').addEventListener('cancel',event=>{if($('sample-cancel').disabled)event.preventDefault();else sampleAbort?.abort();});
$('sample-add').onclick=()=>action(async()=>{
  const name=$('sample-name').value.trim(),file=$('sample-file').files[0],url=$('sample-url').value.trim();
  if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||['constructor','prototype'].includes(name))throw Error('Use a lowercase sample name starting with a letter.');
  if(Boolean(file)===Boolean(url))throw Error('Choose one WAV file or enter one public sample URL.');
  const generation=session.generation;sampleAbort=new AbortController();
  try{
    status.textContent='Loading sample…';$('sample-feedback').textContent=status.textContent;
    if(file&&file.size>SAMPLE_LIMITS.fileBytes)throw Error('Sample files must be at most 4 MiB.');
    const bytes=file?new Uint8Array(await file.arrayBuffer()):(await fetchSample(url,{signal:sampleAbort.signal})).bytes;
    inspectSampleWav(bytes);if(sampleAbort.signal.aborted)throw Error('Sample loading cancelled.');
    const store=await sampleStore(),{id}=await store.put(bytes);
    await saveSamples(store);
    if(sampleAbort.signal.aborted)throw Error('Sample loading cancelled.');
    if(generation!==session.generation)throw Error('The project changed while the sample loaded. Try again.');
    const next=contract.project({...session.draft,samples:{...session.draft.samples,[name]:[id]}});
    await session.activate(next);$('sample-dialog').close();$('sample-file').value='';$('sample-url').value='';
    status.textContent='Sample loaded · use s("'+name+'")';
  }finally{sampleAbort=null;$('sample-cancel').disabled=false;}
});
async function fullscreen(code) {
  const target = code ? document.documentElement : $('output');
  try {
    if (!target.requestFullscreen) throw Error('Fullscreen is unavailable in this browser.');
    $('menu').open = false;
    // Keep the performance view focused on the editors and their output.
    $('agent').hidden = true; $('agent-toggle').setAttribute('aria-expanded','false');
    await target.requestFullscreen();
    if (code) (focus === 'visual' ? visual : music).focus();
  } catch (error) { message(error); }
}
$('fullscreen').onclick = () => fullscreen(false);
$('fullscreen-code').onclick = () => fullscreen(true);
$('undo').onclick = () => action(async () => { await session.undo(); pendingProposal = null; $('proposal').hidden = true; status.textContent = 'Undone'; });
$('agent-undo').onclick = () => $('undo').onclick();
$('apply').onclick = () => action(async () => {
  if (!pendingProposal || !pendingContext) return;
  await session.accept(pendingProposal, pendingContext);
  pendingProposal = null; $('proposal').hidden = true; status.textContent = 'Proposal applied';
});
$('agent-toggle').onclick = async () => {
  const opening = $('agent').hidden; $('agent').hidden = !opening;
  $('agent-toggle').setAttribute('aria-expanded', String(opening));
  if (!opening) return;
  try { const access = await agent.access(); $('unlock-form').hidden = access.authenticated === true; $('agent-status').textContent = access.authenticated ? 'Ask for music, visuals, or both.' : 'Unlock to use the agent. Manual editing works without it.'; }
  catch (error) { $('agent-status').textContent = error.message; }
};
$('unlock-form').onsubmit = async event => {
  event.preventDefault(); const password = $('password').value; $('password').value = '';
  try { await agent.unlock(password); $('unlock-form').hidden = true; $('agent-status').textContent = 'Agent unlocked'; }
  catch (error) { $('agent-status').textContent = error.message; }
};
$('logout').onclick = async () => {
  agent.cancel();
  try { await agent.logout(); $('unlock-form').hidden = false; $('agent-status').textContent = 'Locked'; }
  catch (error) { $('agent-status').textContent = error.message; }
};
$('ask-form').onsubmit = async event => {
  event.preventDefault(); if (agent.active) return;
  $('ask').disabled = true; $('cancel').hidden = false;
  pendingProposal = null; $('proposal').hidden = true;
  try {
    const context = await session.requestContext($('prompt').value);
    $('agent-status').textContent = 'Writing a proposal…';
    const proposal = await agent.request(context, $('provider').value);
    if (await contract.revision(session.draft) !== context.baseRevision) throw Error('The source changed while the agent was writing. Ask again.');
    pendingContext = context; pendingProposal = proposal;
    $('explanation').textContent = proposal.explanation;
    $('proposal').hidden = false; $('apply').disabled = !proposal.edits.length || uiBusy;
    $('agent-status').textContent = proposal.edits.length ? 'Review and Apply to use this edit.' : 'Answered without changing code.';
  } catch (error) { $('agent-status').textContent = error.message; }
  finally { $('ask').disabled = false; $('cancel').hidden = true; }
};
$('cancel').onclick = () => agent.cancel();
music.onRun = () => { focus = 'music'; run(); };
visual.onRun = () => { focus = 'visual'; run(); };

// Only user-written music enters the opaque frame. No auth, storage or chat data.
const frame = document.createElement('iframe');
frame.hidden = true; frame.setAttribute('sandbox','allow-scripts'); frame.setAttribute('allow','autoplay'); frame.title = 'Isolated music engine';
const response = await fetch('music-runtime.js');
if (!response.ok) throw Error('Music engine could not load.');
const script = await response.text();
// Strudel embeds its built-in AudioWorklet modules as data scripts. Safari cannot
// load blob worklets from this opaque origin. Source workers remain blob-only,
// with no external network, application storage, credentials or parent access.
frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; worker-src blob:; connect-src blob:; img-src 'none'; media-src blob:; style-src 'unsafe-inline'"><script>${script.replace(/<\/script/gi,'<\\/script')}<\/script>`;
await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
bridge = new MusicBridge(frame, next => { signal = next; signals.receive(next); }, error => { playing=false; $('play').textContent='Play'; message(error); });
await bridge.ready; lock(false);
status.textContent = session.recoveryError || 'Ready · ⌘/Ctrl Enter to run'; $('build').textContent = BUILD_ID;
function draw(now) {
  shader.render({time:now/1000,delta:last?(now-last)/1000:0,...signals.at(performance.timeOrigin + now)});
  last = now; requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
window.algoravePreview = { editors:{music,visual}, shader, bridge, signals, session, get signal(){return signal;}, get playing(){return playing;} };
