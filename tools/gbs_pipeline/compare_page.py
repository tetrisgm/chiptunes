"""A/B comparison page: same song, two renders, pick the better one.

Absolute 1-4 grades proved too noisy for pipeline questions -- measured
test-retest on identical audio swung up to 2 grades (ablate-02, 2026-08-11),
which is larger than the effects being measured. Forced choice between two
renders of the SAME song removes the drifting internal scale: the rater only
has to answer "which sounds better", and every verdict is a preference pair
the DPO stage can consume directly.

Design:
  * Blind and side-randomised per pair -- A/B order is shuffled, so a habit of
    picking the first thing cannot masquerade as a result.
  * Hidden repeat pairs measure the rater against themselves; the readout
    reports consistency so a weak result is not mistaken for a real one.
  * Tie is a first-class answer. Forcing a choice on genuinely equal renders
    manufactures signal that is not there.

  python3 compare_page.py --pairs pairs.json --id cmp-01 --out page.html
  pairs.json: [{"song": "...", "a": "<mp3 path>", "b": "<mp3 path>",
                "aLabel": "exact", "bLabel": "global"}, ...]
Verdicts POST to /verdict on the local server as
  {"id": "pair-03", "choice": "a"|"b"|"tie"}
"""
import argparse, base64, json, os, random

TEMPLATE = r'''<title>Chiptunes A/B — __BATCH__</title>
<script>const LIVE=__LIVE__;const PAIRS=__PAIRS__;const BATCH="__BATCH__";</script>
<style>
:root{--bg:#F2F3EC;--ink:#22261F;--dim:#6E7463;--line:#D8DACC;--card:#FAFBF6;
  --a:#2E6F7E;--b:#8A5A2B;--go:#5F7F1E;--go-ink:#F4F7E7;--chip:#E4E6DA}
@media (prefers-color-scheme:dark){:root{--bg:#15170F;--ink:#E7EAD9;--dim:#8A907A;
  --line:#2C2F22;--card:#1C1F14;--a:#63B8CB;--b:#D69A5C;--go:#A6C43C;
  --go-ink:#161A0A;--chip:#242819}}
:root[data-theme="light"]{--bg:#F2F3EC;--ink:#22261F;--dim:#6E7463;--line:#D8DACC;
  --card:#FAFBF6;--a:#2E6F7E;--b:#8A5A2B;--go:#5F7F1E;--go-ink:#F4F7E7;--chip:#E4E6DA}
:root[data-theme="dark"]{--bg:#15170F;--ink:#E7EAD9;--dim:#8A907A;--line:#2C2F22;
  --card:#1C1F14;--a:#63B8CB;--b:#D69A5C;--go:#A6C43C;--go-ink:#161A0A;--chip:#242819}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.45 ui-monospace,'SF Mono',Menlo,monospace;
  max-width:660px;margin:0 auto;padding:28px 20px 60px;font-variant-numeric:tabular-nums}
h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;margin:0}
.sub{color:var(--dim);font-size:12px;margin:4px 0 0}
.bar{height:4px;background:var(--chip);border-radius:2px;margin:16px 0 26px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--go);width:0%;transition:width .2s}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:24px}
.pid{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.sides{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0 4px}
.side{border:2px solid var(--line);border-radius:8px;padding:18px 12px;text-align:center;
  cursor:pointer;background:var(--chip)}
.side:focus-visible{outline:2px solid var(--go);outline-offset:2px}
.side .k{font-size:30px;font-weight:700}
.side .h{font-size:11px;letter-spacing:.09em;color:var(--dim);margin-top:4px}
.side.playing{border-color:var(--ink)}
.side.A .k{color:var(--a)} .side.B .k{color:var(--b)}
.seek{height:9px;background:var(--chip);border-radius:5px;margin:16px 0 6px;cursor:pointer}
.seek i{display:block;height:100%;background:var(--go);border-radius:5px;width:0%}
.time{display:flex;justify-content:space-between;color:var(--dim);font-size:12px}
.choose{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:18px}
.choose button{font:inherit;font-size:12px;letter-spacing:.07em;padding:12px 4px;
  border:1px solid var(--line);background:var(--chip);color:var(--ink);border-radius:6px;cursor:pointer}
.choose button:focus-visible{outline:2px solid var(--go);outline-offset:2px}
.keys{color:var(--dim);font-size:12px;line-height:2;margin-top:20px}
.keys b{color:var(--ink);background:var(--chip);padding:1px 7px;border-radius:4px;
  border:1px solid var(--line)}
#toast{color:var(--dim);font-size:12px;margin-top:12px;min-height:16px}
</style>
<h1>Chiptunes A/B</h1>
<p class="sub">batch __BATCH__ · <span id="prog"></span></p>
<div class="bar"><i id="pbar"></i></div>
<div class="card">
  <div class="pid" id="pid">—</div>
  <div class="sides">
    <div class="side A" id="sA" tabindex="0" onclick="play('a')">
      <div class="k">A</div><div class="h">press A</div></div>
    <div class="side B" id="sB" tabindex="0" onclick="play('b')">
      <div class="k">B</div><div class="h">press B</div></div>
  </div>
  <div class="seek" id="seek"><i id="sbar"></i></div>
  <div class="time"><span id="tcur">0:00</span><span id="tdur">0:00</span></div>
  <div class="choose">
    <button onclick="pick('a')">← A better</button>
    <button onclick="pick('tie')">= same</button>
    <button onclick="pick('b')">B better →</button>
  </div>
  <div id="toast"></div>
</div>
<div class="keys">
  <b>a</b>/<b>b</b> hear that side &nbsp; <b>space</b> switch side, keeping position
  &nbsp; <b>←</b> A better &nbsp; <b>→</b> B better &nbsp; <b>=</b> same
  &nbsp; <b>z</b> undo
</div>
<script>
const KEY="ctcmp:"+BATCH;
let picks={}; try{picks=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
let cur=0, side='a', hist=[];
const audio=new Audio();
const $=id=>document.getElementById(id);
const fmt=s=>{s=Math.max(0,s|0);return (s/60|0)+":"+String(s%60).padStart(2,"0")};
const save=()=>localStorage.setItem(KEY,JSON.stringify(picks));
function first(){const i=PAIRS.findIndex(p=>!picks[p.id]);return i<0?0:i}
function render(){
  const p=PAIRS[cur];
  $("pid").textContent=p.id+" · "+(cur+1)+" of "+PAIRS.length;
  $("sA").className="side A"+(side==='a'&&!audio.paused?" playing":"");
  $("sB").className="side B"+(side==='b'&&!audio.paused?" playing":"");
  const done=PAIRS.filter(x=>picks[x.id]).length;
  $("prog").textContent=done+"/"+PAIRS.length+" compared";
  $("pbar").style.width=(100*done/PAIRS.length)+"%";
  const v=picks[p.id];
  $("toast").textContent=v?("recorded: "+(v==="tie"?"same":v.toUpperCase()+" better")):"";
}
function play(s){
  const p=PAIRS[cur], t=audio.currentTime;
  side=s; audio.src=(s==='a'?p.a:p.b);
  audio.currentTime=isFinite(t)?t:0; audio.play(); render();
}
function load(i){cur=(i+PAIRS.length)%PAIRS.length;side='a';audio.src=PAIRS[cur].a;render()}
function pick(c){
  const p=PAIRS[cur];
  hist.push([p.id,picks[p.id]]);
  picks[p.id]=c; save();
  if(LIVE)fetch("/verdict",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id:p.id,choice:c})}).catch(()=>{
      $("toast").textContent="server unreachable — session may be closed"});
  const n=PAIRS.findIndex((x,i)=>i>cur&&!picks[x.id]);
  const any=PAIRS.findIndex(x=>!picks[x.id]);
  if(n>=0){load(n);audio.play()}else if(any>=0){load(any);audio.play()}
  else{audio.pause();render();$("toast").textContent="all done — tell the session"}
}
function undo(){const h=hist.pop();if(!h)return;
  if(h[1]===undefined)delete picks[h[0]];else picks[h[0]]=h[1];
  save();load(PAIRS.findIndex(p=>p.id===h[0]))}
audio.addEventListener("timeupdate",()=>{
  $("sbar").style.width=(100*audio.currentTime/(audio.duration||1))+"%";
  $("tcur").textContent=fmt(audio.currentTime);
  $("tdur").textContent=fmt(audio.duration||0)});
audio.addEventListener("play",render); audio.addEventListener("pause",render);
$("seek").addEventListener("click",e=>{const r=e.currentTarget.getBoundingClientRect();
  audio.currentTime=((e.clientX-r.left)/r.width)*(audio.duration||0)});
document.addEventListener("keydown",e=>{
  const k=e.key.toLowerCase();
  if(k==="a"){e.preventDefault();play('a')}
  else if(k==="b"){e.preventDefault();play('b')}
  else if(k===" "){e.preventDefault();play(side==='a'?'b':'a')}
  else if(e.key==="ArrowLeft"){e.preventDefault();pick('a')}
  else if(e.key==="ArrowRight"){e.preventDefault();pick('b')}
  else if(k==="="||k==="t"){pick('tie')}
  else if(k==="z"){undo()}});
if(LIVE){fetch("/verdicts").then(r=>r.json()).then(s=>{
  Object.assign(picks,s);save();load(first())}).catch(()=>load(first()))}
else load(first());
</script>'''


def build(pairs, bid, mode='serve'):
    out = []
    for p in pairs:
        rec = dict(p)
        if mode == 'embed':
            for k in ('a', 'b'):
                mime = 'audio/flac' if p[k].endswith('.flac') else 'audio/mpeg'
                rec[k] = 'data:%s;base64,' % mime + \
                    base64.b64encode(open(p[k], 'rb').read()).decode()
        else:
            for k in ('a', 'b'):
                rec[k] = '/audio/' + os.path.basename(p[k])   # .flac served lossless
        out.append({k: rec[k] for k in ('id', 'a', 'b')})
    return (TEMPLATE.replace('__BATCH__', bid)
            .replace('__LIVE__', 'true' if mode == 'serve' else 'false')
            .replace('__PAIRS__', json.dumps(out)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', required=True)
    ap.add_argument('--id', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--mode', choices=('embed', 'serve'), default='serve')
    a = ap.parse_args()
    pairs = json.load(open(a.pairs))
    open(a.out, 'w', encoding='utf-8').write(build(pairs, a.id, a.mode))
    print('wrote %s: %d pairs' % (a.out, len(pairs)))


if __name__ == '__main__':
    main()
