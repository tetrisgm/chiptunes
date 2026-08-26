"""Build the self-contained review page for a listening batch.

  python3 review_page.py --batch <dir-of-mp3s> --id cal-01 --out review.html

Audio is embedded as data URIs (the artifact CSP allows no external fetches),
so batches stay ~20 tracks at mono 96k. Verdicts are a 1-9 ordinal scale.
Revised 2026-08-11 after measuring the rater against themselves:
retest on identical audio swung 2 of 3 tracks by 2 grades on the old 4-level
scale, so granularity was never the limiting factor -- judgment drift was.
9 levels do not fix that drift, but they do split the large "middle" cluster
that a coarse scale collapses, and orderable pairs inside that cluster are
what the DPO stage actually consumes. Forced-choice A/B (compare_page.py)
remains the instrument for any A-vs-B DECISION; this scale is for quality
tracking and pair mining. Digits grade directly; arrows are the fast path
(down=2, up=7). State lives in localStorage keyed by
batch id; the export button copies {"batch", "verdicts"} JSON for pasting
back into the session, where it lands in verdicts.jsonl.
"""
import argparse, base64, glob, json, os

TEMPLATE = r'''<title>Chiptunes Review — __BATCH__</title>
<script>const LIVE=__LIVE__;</script>
<style>
:root{
  --bg:#F2F3EC; --ink:#22261F; --dim:#6E7463; --line:#D8DACC; --card:#FAFBF6;
  --go:#5F7F1E; --go-ink:#F4F7E7; --fav:#3E6212; --no:#A84B32; --meh:#B08C28;
  --chip:#E4E6DA;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#15170F; --ink:#E7EAD9; --dim:#8A907A; --line:#2C2F22; --card:#1C1F14;
  --go:#A6C43C; --go-ink:#161A0A; --fav:#C4DE62; --no:#C4674A; --meh:#CDA83F;
  --chip:#242819;
}}
:root[data-theme="light"]{
  --bg:#F2F3EC; --ink:#22261F; --dim:#6E7463; --line:#D8DACC; --card:#FAFBF6;
  --go:#5F7F1E; --go-ink:#F4F7E7; --fav:#3E6212; --no:#A84B32; --meh:#B08C28;
  --chip:#E4E6DA;
}
:root[data-theme="dark"]{
  --bg:#15170F; --ink:#E7EAD9; --dim:#8A907A; --line:#2C2F22; --card:#1C1F14;
  --go:#A6C43C; --go-ink:#161A0A; --fav:#C4DE62; --no:#C4674A; --meh:#CDA83F;
  --chip:#242819;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);
  font:15px/1.45 ui-monospace,'SF Mono',Menlo,monospace;
  max-width:680px;margin:0 auto;padding:28px 20px 60px;
  font-variant-numeric:tabular-nums}
h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;margin:0}
.sub{color:var(--dim);font-size:12px;margin:4px 0 0}
.bar{height:4px;background:var(--chip);border-radius:2px;margin:16px 0 26px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--go);width:0%;transition:width .2s}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;
  padding:22px 22px 18px;margin-bottom:18px}
.tid{font-size:34px;font-weight:700;letter-spacing:.04em}
.tstate{color:var(--dim);font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  margin-top:2px;min-height:16px}
.seek{height:10px;background:var(--chip);border-radius:5px;margin:18px 0 6px;
  cursor:pointer;position:relative}
.seek i{display:block;height:100%;background:var(--go);border-radius:5px;width:0%}
.time{display:flex;justify-content:space-between;color:var(--dim);font-size:12px}
.verd{display:grid;grid-template-columns:repeat(9,1fr);gap:5px;margin-top:18px}
.scalehint{display:flex;justify-content:space-between;color:var(--dim);
  font-size:11px;margin-top:6px}
.verd button{font:inherit;font-size:14px;font-weight:600;padding:12px 0;
  border:1px solid var(--line);background:var(--chip);color:var(--ink);
  border-radius:6px;cursor:pointer}
.verd button:focus-visible{outline:2px solid var(--go);outline-offset:2px}
.verd button.lo{background:var(--no);border-color:var(--no);color:#fff}
.verd button.mid{background:var(--meh);border-color:var(--meh);color:#fff}
.verd button.hi{background:var(--go);border-color:var(--go);color:var(--go-ink)}
.verd button.top{background:var(--fav);border-color:var(--fav);color:var(--go-ink)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));
  gap:8px;margin:6px 0 22px}
.grid button{font:inherit;font-size:12px;padding:9px 0;border-radius:6px;
  border:1px solid var(--line);background:var(--chip);color:var(--ink);cursor:pointer}
.grid button:focus-visible{outline:2px solid var(--go);outline-offset:2px}
.grid .cur{border-color:var(--ink)}
.grid .lo{background:var(--no);border-color:var(--no);color:#fff}
.grid .mid{background:var(--meh);border-color:var(--meh);color:#fff}
.grid .hi{background:var(--go);border-color:var(--go);color:var(--go-ink)}
.grid .top{background:var(--fav);border-color:var(--fav);color:var(--go-ink)}
@keyframes pulse{50%{opacity:.55}}
.grid .playing{animation:pulse 1.2s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.grid .playing{animation:none}}
.keys{color:var(--dim);font-size:12px;line-height:2}
.keys b{color:var(--ink);font-weight:600;background:var(--chip);
  padding:1px 7px;border-radius:4px;border:1px solid var(--line)}
.export{margin-top:16px;display:flex;gap:12px;align-items:center}
.export button{font:inherit;font-size:13px;letter-spacing:.06em;padding:11px 18px;
  background:var(--go);color:var(--go-ink);border:0;border-radius:6px;cursor:pointer}
.export button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
#toast{color:var(--dim);font-size:12px}
</style>
<h1>Chiptunes Review</h1>
<p class="sub">batch __BATCH__ · <span id="prog"></span></p>
<div class="bar"><i id="pbar"></i></div>
<div class="card">
  <div class="tid" id="tid">—</div>
  <div class="tstate" id="tstate">press space to play</div>
  <div class="seek" id="seek"><i id="sbar"></i></div>
  <div class="time"><span id="tcur">0:00</span><span id="tdur">0:00</span></div>
  <div class="verd" id="verd"></div>
  <div class="scalehint"><span>1 unusable</span><span>5 ok</span><span>9 great</span></div>
</div>
<div class="grid" id="grid"></div>
<div class="keys">
  <b>space</b> play/pause &nbsp; <b>←</b>/<b>→</b> prev/next &nbsp;
  <b>1–9</b> grade &nbsp; <b>↑</b> good (7) &nbsp; <b>↓</b> bad (2) &nbsp;
  <b>z</b> undo &nbsp; <b>r</b> restart
</div>
<div class="export">
  <button id="xbtn" onclick="doExport()">Save verdicts</button><span id="toast"></span>
</div>
<script>if(__LIVE__)document.getElementById("xbtn").textContent="Export backup";</script>
<script>
const BATCH="__BATCH__";
const TRACKS=__TRACKS__;
const KEY="ctreview:"+BATCH;
let grades={}; try{grades=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
if(LIVE){
  fetch("/verdicts").then(r=>r.json()).then(s=>{
    Object.assign(grades,s);save();
    const f=TRACKS.findIndex(t=>!grades[t.id]);
    if(f>=0)load(f);else render();
  }).catch(()=>{});
}
let cur=0, hist=[];
const audio=new Audio();
const first=TRACKS.findIndex(t=>!grades[t.id]);
if(first>=0)cur=first;
const $=id=>document.getElementById(id);
function fmt(s){s=Math.max(0,s|0);return (s/60|0)+":"+String(s%60).padStart(2,"0")}
function save(){localStorage.setItem(KEY,JSON.stringify(grades))}
function render(){
  const t=TRACKS[cur];
  $("tid").textContent=t.id.toUpperCase().replace("-"," ")+" / "+String(TRACKS.length).padStart(2,"0");
  const g=grades[t.id];
  $("tstate").textContent=g?("rated "+g+" / 9"):
    (audio.paused?"press space to play":"playing");
  for(let i=1;i<=9;i++){const b=$("v"+i);b.className=(g===i)?cls(i):""}
  const rated=TRACKS.filter(x=>grades[x.id]).length;
  const keeps=TRACKS.filter(x=>grades[x.id]>=6).length;
  $("prog").textContent=rated+"/"+TRACKS.length+" rated · "+keeps+" at 6+";
  $("pbar").style.width=(100*rated/TRACKS.length)+"%";
  const grid=$("grid");grid.innerHTML="";
  TRACKS.forEach((x,i)=>{
    const b=document.createElement("button");
    b.textContent=x.id.slice(-2);
    b.className=(grades[x.id]?(cls(grades[x.id])+" "):"")+
      (i===cur?"cur ":"")+((i===cur&&!audio.paused)?"playing":"");
    b.onclick=()=>{go(i,true)};
    grid.appendChild(b);
  });
}
function cls(g){return g<=3?"lo":g<=5?"mid":g<=8?"hi":"top"}
function buildScale(){
  const v=$("verd");v.innerHTML="";
  for(let i=1;i<=9;i++){const b=document.createElement("button");
    b.id="v"+i;b.textContent=i;b.onclick=()=>grade(i);v.appendChild(b)}
}
function load(i){
  cur=(i+TRACKS.length)%TRACKS.length;
  audio.src=TRACKS[cur].src;
  render();
}
function go(i,play){load(i);if(play)audio.play();render()}
function grade(g){
  const t=TRACKS[cur];
  hist.push([t.id,grades[t.id]]);
  grades[t.id]=g;save();
  if(LIVE)fetch("/verdict",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id:t.id,grade:g})})
    .then(r=>{if(!r.ok)$("toast").textContent="save failed — will retry on export"})
    .catch(()=>{$("toast").textContent="server unreachable — session may be closed"});
  const nxt=TRACKS.findIndex((x,i)=>i>cur&&!grades[x.id]);
  const any=TRACKS.findIndex(x=>!grades[x.id]);
  if(nxt>=0)go(nxt,true);else if(any>=0)go(any,true);else{audio.pause();render()}
}
function undo(){
  const h=hist.pop();if(!h)return;
  if(h[1]===undefined)delete grades[h[0]];else grades[h[0]]=h[1];
  save();go(TRACKS.findIndex(t=>t.id===h[0]),false);
}
function doExport(){
  const out=JSON.stringify({batch:BATCH,scale:"1=reject 2=meh 3=like 4=favorite",
    verdicts:grades});
  const toast=t=>{$("toast").textContent=t};
  if(window.claude&&window.claude.downloads){
    window.claude.downloads.save({filename:"verdicts-"+BATCH+".json",data:out})
      .then(()=>toast("saved — tell the session and it reads the file"),
            e=>{
        if(e&&e.code==="declined")toast("save declined");
        else if(e&&e.code==="rate_limited")toast("a save prompt is already open");
        else fallback();
      });
  }else fallback();
  function fallback(){
    if(navigator.clipboard&&navigator.clipboard.writeText)
      navigator.clipboard.writeText(out).then(
        ()=>toast("copied — paste it in the chat"),()=>toast(out));
    else toast(out);
  }
}
audio.addEventListener("timeupdate",()=>{
  $("sbar").style.width=(100*audio.currentTime/(audio.duration||1))+"%";
  $("tcur").textContent=fmt(audio.currentTime);
  $("tdur").textContent=fmt(audio.duration||0);
});
audio.addEventListener("ended",()=>{
  const nxt=TRACKS.findIndex((x,i)=>i>cur&&!grades[x.id]);
  if(nxt>=0)go(nxt,true);else render();
});
audio.addEventListener("play",render);
audio.addEventListener("pause",render);
$("seek").addEventListener("click",e=>{
  const r=e.currentTarget.getBoundingClientRect();
  audio.currentTime=((e.clientX-r.left)/r.width)*(audio.duration||0);
});
document.addEventListener("keydown",e=>{
  if(e.target.tagName==="INPUT")return;
  const k=e.key;
  if(k===" "){e.preventDefault();audio.paused?audio.play():audio.pause()}
  else if(k==="ArrowRight"){e.preventDefault();go(cur+1,!audio.paused)}
  else if(k==="ArrowLeft"){e.preventDefault();go(cur-1,!audio.paused)}
  else if(k==="ArrowUp"){e.preventDefault();grade(7)}
  else if(k==="ArrowDown"){e.preventDefault();grade(2)}
  else if(k>="1"&&k<="9"){grade(+k)}
  else if(k==="z"){undo()}
  else if(k==="r"){audio.currentTime=0;audio.play()}
});
buildScale();
load(cur);
</script>'''


def build_html(batch, bid, mode='embed'):
    """mode 'embed' -> data URIs for the artifact; 'serve' -> /audio/ URLs +
    live POSTing for the local zero-export server."""
    tracks = []
    files = sorted(glob.glob(os.path.join(batch, '*.flac'))) or \
        sorted(glob.glob(os.path.join(batch, '*.mp3')))
    for p in files:
        tid = os.path.splitext(os.path.basename(p))[0]
        if mode == 'embed':
            mime = 'audio/flac' if p.endswith('.flac') else 'audio/mpeg'
            src = 'data:%s;base64,' % mime + \
                base64.b64encode(open(p, 'rb').read()).decode()
        else:
            src = '/audio/' + os.path.basename(p)
        tracks.append(dict(id=tid, src=src))
    return (TEMPLATE.replace('__BATCH__', bid)
            .replace('__LIVE__', 'true' if mode == 'serve' else 'false')
            .replace('__TRACKS__', json.dumps(tracks))), len(tracks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--batch', required=True)
    ap.add_argument('--id', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--mode', choices=('embed', 'serve'), default='embed')
    a = ap.parse_args()
    html, n = build_html(a.batch, a.id, a.mode)
    open(a.out, 'w', encoding='utf-8').write(html)
    mb = os.path.getsize(a.out) / 1e6
    print('wrote %s: %d tracks, %.1f MB %s' %
          (a.out, n, mb, '(OVER 16MB LIMIT!)' if mb > 16 and a.mode == 'embed' else ''))


if __name__ == '__main__':
    main()
