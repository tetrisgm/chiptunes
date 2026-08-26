"""Listening-batch builder: the owner-facing half of the acceptance process.

The acceptance design (2026-08-11):
  1. Machines reject, the owner accepts. Automatic gates kill outputs that are
     measurably broken (fragments, drones, missing voices) so no human ever
     hears them. Everything that survives is rendered and ranked; the owner's
     ear makes the actual quality call. Ears outrank metrics -- this project
     repeatedly produced outputs that passed every proxy and failed as music.
  2. Verdicts are data. Each keep/reject lands in verdicts.jsonl and
     accumulates across batches; once enough accepted tracks exist they become
     a fine-tune set (rejection-sampling SFT). No learned reward model at this
     scale: one rater's few hundred judgments cannot train a reward that
     survives being optimized against (Goodhart), but they CAN safely select
     training examples.
  3. The filter itself gets audited: each batch renders a couple of rejects,
     labeled as such, so silent filter drift is caught by ear too.

Usage:
  python3 audition.py --gbs-dir <generated> --out <batch-dir> \
      --gbsplay <path-to-gbsplay> [--driver-dir <sym dir>] [--limit 12]

Output: ranked mp3s named r01_<song>.mp3 ... plus x1_<song>__REJECT_<why>.mp3
filter-audit samples, and batch.json with per-track metrics, gate results and
the exact corpus reference bands used.
"""
import argparse, glob, json, os, random, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_report as SR

# Product-shape gates: remove short/sparse/underfilled output before listening.
# They are not labels for bad music. A fixed 1,000-track GB audit on 2026-08-14
# rejected 17.2% even after short/sparse source tracks were excluded. Corpus
# medians (69 s, entropy 2.86, leap 0.364, 4 voices, spanBalance 0.99) describe
# the center of the distribution, not a false-reject guarantee.
GATES = dict(seconds=25.0, events=120, voices=3,
             spanBalance=0.6, pcEntropy=1.8, leapShare=0.08)

# Corpus medians for the ranking heuristic (ordering only, never acceptance).
CORPUS = dict(pcEntropy=2.855, leapShare=0.364, consonance=0.788,
              reuse=3.942, modulationsPerMin=3.86, keyStability=0.556,
              spanBalance=0.99)


def gate(r):
    why = []
    if r['seconds'] < GATES['seconds']: why.append('short')
    if r['events'] < GATES['events']: why.append('sparse')
    if r['voices'] < GATES['voices']: why.append('voices=%d' % r['voices'])
    for k in ('spanBalance', 'pcEntropy', 'leapShare'):
        v = r.get(k)
        if v is not None and v < GATES[k]:
            why.append('%s=%.2f' % (k, v))
    return why


def band_score(r):
    """How many metrics land within [0.5x, 1.5x] of the corpus median."""
    n = 0
    for k, m in CORPUS.items():
        v = r.get(k)
        if v is None:
            continue
        if 0.5 * m <= v <= 1.5 * m:
            n += 1
    return n


def render(gbs, mp3, gbsplay, seconds):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as t:
        wav = t.name
    try:
        with open(os.devnull, 'rb') as devnull:
            subprocess.run([gbsplay, '-o', 'wav', '-O', wav, '-E', 'l',
                            '-r', '44100', '-f', '3', '-g', '0',
                            '-t', str(int(seconds)), '-T', '60', '-q',
                            gbs, '1', '1'],
                           stdin=devnull, capture_output=True, timeout=300)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav,
                        '-b:a', '192k', mp3], capture_output=True, timeout=300)
        return os.path.exists(mp3) and os.path.getsize(mp3) > 4096
    finally:
        try:
            os.unlink(wav)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gbs-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--gbsplay', required=True)
    ap.add_argument('--driver-dir')
    ap.add_argument('--limit', type=int, default=12,
                    help='max keepers to render; respect the listener')
    ap.add_argument('--audit-rejects', type=int, default=2)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    song_addr = None
    if a.driver_dir:
        try:
            song_addr = SR.syms(os.path.join(a.driver_dir, 'tracker2.sym'))['Song']
        except Exception:
            pass

    rows = []
    for p in sorted(glob.glob(os.path.join(a.gbs_dir, '*.gbs'))):
        r = SR.analyze(SR.decode_gbs(p, song_addr))
        if r is None:
            r = dict(seconds=0.0, events=0, voices=0)
        r['file'] = os.path.basename(p)
        r['path'] = p
        r['rejected'] = gate(r)
        r['band'] = band_score(r)
        rows.append(r)

    keep = sorted([r for r in rows if not r['rejected']],
                  key=lambda r: (-r['band'], -r['seconds']))
    rej = [r for r in rows if r['rejected']]
    random.seed(int(time.time()))
    audit = random.sample(rej, min(a.audit_rejects, len(rej)))

    rendered = []
    for i, r in enumerate(keep[:a.limit], 1):
        name = 'r%02d_%s.mp3' % (i, os.path.splitext(r['file'])[0])
        if render(r['path'], os.path.join(a.out, name), a.gbsplay,
                  min(r['seconds'] + 4, 120)):
            r['mp3'] = name
            rendered.append(r)
    for i, r in enumerate(audit, 1):
        name = 'x%d_%s__REJECT_%s.mp3' % (
            i, os.path.splitext(r['file'])[0], '-'.join(r['rejected'])[:40])
        if render(r['path'], os.path.join(a.out, name), a.gbsplay,
                  min(max(r['seconds'], 20) + 4, 60)):
            r['mp3'] = name

    for r in rows:
        r.pop('path', None)
    summary = dict(total=len(rows), passed=len(keep), rejected=len(rej),
                   rendered=len(rendered), gates=GATES, corpusBands=CORPUS,
                   rejectReasons={})
    for r in rej:
        for w in r['rejected']:
            k = w.split('=')[0]
            summary['rejectReasons'][k] = summary['rejectReasons'].get(k, 0) + 1
    json.dump(dict(summary=summary, tracks=rows),
              open(os.path.join(a.out, 'batch.json'), 'w'), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
