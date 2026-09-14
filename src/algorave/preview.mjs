import contract from './project.cjs';
import { ProjectSession } from './session.mjs';
import { AgentClient } from './agent-client.mjs';
import { MusicBridge } from './music-bridge.mjs';
import { MusicSignals } from './music-signals.mjs';
import { ShaderRuntime } from './shader-runtime.mjs';
const $ = id => document.getElementById(id);
const music = $('music'), visual = $('visual'), status = $('status');
music.value = `setcpm(30)
$: s("bd*4, [~ hh]*4, ~ sd ~ sd").gain(.5)
$: note("<c2 eb2 f2 g2>")
  .s("sawtooth").lpf(700).decay(.2).sustain(0).gain(.25)
$: note("c5 [eb5 g5] ~ bb4")
  .s("triangle").decay(.15).sustain(0).gain(.2)`;
visual.value = `void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = (pixel * 2. - iResolution.xy) / iResolution.y;
  float bass = texture(iChannel0, vec2(.025, .25)).r;
  float rings = sin(length(uv) * 18. - iTime * 3. - bass * 5.);
  vec3 ink = .5 + .5 * cos(iTime * .2 + uv.xyx + vec3(0,2,4));
  color = vec4(ink * smoothstep(-.2,.6,rings), 1.);
}`;
let signal = {}, playing = false, last = 0, focus = 'music', playRequested = false, visualPass = 'Image';
let bridge, shader, pendingProposal, pendingContext, uiBusy = false, saveTimer;
const initial = { version:1, runtime:contract.RUNTIME, music:music.value, visuals:{ Image:visual.value, channels:{Image:['audio']} } };
const signals = new MusicSignals(), agent = new AgentClient();
const runtime = {
  async prepare(next, previous) {
    const musicChanged = next.music !== previous.music || playRequested;
    const visualChanged = JSON.stringify(next.visuals) !== JSON.stringify(previous.visuals);
    const visualCandidate = visualChanged ? shader.prepare(next.visuals) : null;
    let token;
    try { if (musicChanged) ({ token } = await bridge.request('prepare', next.music)); }
    catch (error) { visualCandidate?.dispose(); throw error; }
    return {
      async apply() {
        // Both candidates have been validated. Apply the visual transaction first;
        // if audio activation fails, restore the previous applied visual source.
        let visualApplied = false;
        try {
          if (visualCandidate) { visualCandidate.apply(); visualApplied = true; }
          if (musicChanged) {
            const result = await bridge.request('commit', undefined, { token, play:playing || playRequested });
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
  visual.value = session.draft.visuals[visualPass] || '';
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
window.addEventListener('pagehide', () => { resize.disconnect(); shader.dispose(); agent.cancel(); clearTimeout(saveTimer); });
function message(error) { status.textContent = error.message || String(error); }
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
  for (const id of ['run','play','apply','undo','pass','set-channels','channels']) $(id).disabled = value;
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
    try { await session.activate(next, {draftAfter:session.draft}); status.textContent = focus === 'visual' ? 'Visuals updated' : 'Music updated'; }
    finally { playRequested = false; }
  });
}
$('mode').onchange = () => { document.body.dataset.mode = $('mode').value; focus = $('mode').value === 'visuals' ? 'visual' : 'music'; };
music.onfocus = () => focus = 'music'; visual.onfocus = () => focus = 'visual';
$('pass').onchange = () => { visualPass = $('pass').value; visual.value = session.draft.visuals[visualPass] || ''; focus = 'visual'; };
$('set-channels').onclick = () => {
  try { const next = structuredClone(session.draft); next.visuals.channels = JSON.parse($('channels').value); session.edit(next); save(); status.textContent = 'Channel draft updated · Run visuals to apply'; }
  catch (error) { message(error); }
};
$('run').onclick = run;
$('play').onclick = async () => {
  if (!playing) { focus = 'music'; await run(); return; }
  await action(async () => { await bridge.request('stop'); playing = false; status.textContent = 'Stopped'; });
};
$('save').onclick = () => save(true);
$('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session.draft,null,2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'chiptunes-algorave.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('fullscreen').onclick = () => $('output').requestFullscreen().catch(message);
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
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && [music,visual].includes(document.activeElement)) { event.preventDefault(); run(); } });

// Only user-written music enters the opaque frame. No auth, storage or chat data.
const frame = document.createElement('iframe');
frame.hidden = true; frame.setAttribute('sandbox','allow-scripts'); frame.setAttribute('allow','autoplay'); frame.title = 'Isolated music engine';
const response = await fetch('music-runtime.js');
if (!response.ok) throw Error('Music engine could not load.');
const script = await response.text();
frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src blob:; img-src 'none'; media-src blob:; style-src 'unsafe-inline'"><script>${script.replace(/<\/script/gi,'<\\/script')}<\/script>`;
await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
bridge = new MusicBridge(frame, next => { signal = next; signals.receive(next); });
await bridge.ready; lock(false);
status.textContent = session.recoveryError || 'Ready · ⌘/Ctrl Enter to run'; $('build').textContent = BUILD_ID;
function draw(now) {
  shader.render({time:now/1000,delta:last?(now-last)/1000:0,...signals.at(performance.timeOrigin + now)});
  last = now; requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
window.algoravePreview = { shader, bridge, signals, session, get signal(){return signal;}, get playing(){return playing;} };
