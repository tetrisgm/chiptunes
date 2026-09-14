import { MusicBridge } from './music-bridge.mjs';
import { ShaderRuntime } from './shader-runtime.mjs';
const $ = id => document.getElementById(id);
const music = $('music'), visual = $('visual'), status = $('status');
music.value = `setcpm(30)
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
const shader = new ShaderRuntime($('canvas'));
shader.set({ Image: visual.value });
let signal = {}, playing = false, last = 0, focus = 'music';
const frame = document.createElement('iframe');
frame.hidden = true; frame.setAttribute('sandbox','allow-scripts');
frame.setAttribute('allow','autoplay'); frame.title='Isolated music engine';
// Bundle is inlined so executable music needs no script/network access. The
// opaque origin disallows cookies/storage/parent DOM, even for arbitrary JS.
const response = await fetch('music-runtime.js');
if (!response.ok) throw Error('Music engine could not load.');
const script = await response.text();
frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src blob:; style-src 'unsafe-inline'"><script>${script.replace(/<\/script/gi,'<\\/script')}<\/script>`;
await new Promise(resolve => { frame.onload=resolve; document.body.append(frame); });
const bridge = new MusicBridge(frame, next => { signal = next; });
await bridge.ready;
$('play').disabled=false; $('run').disabled=false;
status.textContent='Ready · ⌘/Ctrl Enter to run'; $('build').textContent=BUILD_ID;
function message(error) { status.textContent=error.message || String(error); }
async function run() {
  $('run').disabled=true;
  try {
    if (focus==='visual') { shader.set({Image:visual.value}); status.textContent='Visuals updated'; }
    else { const result=await bridge.request('run',music.value); playing=result.playing; status.textContent='Music updated'; }
  } catch(error) { message(error); }
  finally { $('run').disabled=false; $('play').textContent=playing?'Stop':'Play'; }
}
$('mode').onchange=() => { document.body.dataset.mode=$('mode').value; focus=$('mode').value==='visuals'?'visual':'music'; };
music.onfocus=()=>focus='music'; visual.onfocus=()=>focus='visual';
$('run').onclick=run;
$('play').onclick=async()=> {
  if (!playing) { focus='music'; await run(); return; }
  try { await bridge.request('stop'); playing=false; $('play').textContent='Play'; status.textContent='Stopped'; } catch(error){message(error);}
};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();run();}});
function draw(now) {
  shader.render({time:now/1000,delta:last?(now-last)/1000:0,...signal});
  last=now; requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
// Test seam contains only this local proof's public runtime state, no app secrets.
window.algoravePreview={shader,bridge,get signal(){return signal;},get playing(){return playing;}};
