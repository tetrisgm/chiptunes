"""Gather every rating session into one dataset.

Batches accumulated across two rating scales and two instruments:
  * absolute grades, 1-4 (cal-01, c2-01, oracle-01, ablate-01/02)
  * absolute grades, 1-9 (ft-01 onward)
  * forced-choice A/B  (ab-01/02/03)

Absolute grades are normalised to 0-1 so the two scales can live together
(1-4 -> (g-1)/3, 1-9 -> (g-1)/8). That is a linear assumption and it is a
compromise: the two scales were not anchored to each other, so treat
cross-scale comparisons as approximate and prefer within-batch contrasts.

**Only ratings taken through a correct render chain are usable as taste
data.** Everything before the 128-slot instrument fix (2026-08-11) judged
audio whose bass and drums were garbage, so those rows are kept for the record
but flagged `chainBroken` and excluded from training sets by default.

  python3 collect_verdicts.py --batches <dir> [--include-broken] [--out x.json]
"""
import argparse, glob, json, os

# batches rated before the 128-instrument fix landed
BROKEN_CHAIN = {'cal-01', 'c2-01', 'oracle-01', 'ablate-01', 'ablate-02',
                'ab-01', 'ab-02', 'ab-03'}
SCALE4 = {'cal-01', 'c2-01', 'oracle-01', 'ablate-01', 'ablate-02'}


def norm(grade, batch):
    if batch in SCALE4:
        return (grade - 1) / 3.0
    return (grade - 1) / 8.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--batches', required=True)
    ap.add_argument('--out', default=None)
    ap.add_argument('--include-broken', action='store_true')
    a = ap.parse_args()

    graded, pairs = [], []
    for d in sorted(glob.glob(os.path.join(a.batches, '*'))):
        # `current` is a symlink the review server follows; counting it would
        # double every rating in the batch it points at
        if not os.path.isdir(d) or os.path.islink(d):
            continue
        batch = os.path.basename(d)
        vp, kp = os.path.join(d, 'verdicts.jsonl'), os.path.join(d, 'key.json')
        if not (os.path.exists(vp) and os.path.exists(kp)):
            continue
        key = json.load(open(kp))
        broken = batch in BROKEN_CHAIN
        last = {}
        for ln in open(vp, encoding='utf-8'):
            try:
                r = json.loads(ln)
            except ValueError:
                continue
            if r.get('id') in key:
                last[r['id']] = r
        for tid, r in last.items():
            meta = key[tid]
            g = r.get('grade')
            if isinstance(meta, dict):                     # A/B pair
                if not isinstance(g, str):
                    continue
                pairs.append(dict(batch=batch, id=tid, song=meta.get('song'),
                                  a=meta.get('a'), b=meta.get('b'), choice=g,
                                  repeat=bool(meta.get('repeat')),
                                  chainBroken=broken))
            else:                                          # absolute grade
                if not isinstance(g, int):
                    continue
                src = meta
                graded.append(dict(batch=batch, id=tid, source=src,
                                   kind=src.split(':', 1)[0],
                                   stem=src.split(':', 1)[1] if ':' in src else src,
                                   grade=g, score=round(norm(g, batch), 4),
                                   chainBroken=broken))
    usable = [r for r in graded if a.include_broken or not r['chainBroken']]
    gen = [r for r in usable if r['kind'] == 'gen']
    summary = dict(
        batches=len(set(r['batch'] for r in graded + pairs)),
        gradedTotal=len(graded), gradedUsable=len(usable),
        generatedUsable=len(gen),
        abPairs=len(pairs), abPairsUsable=len([p for p in pairs
                                               if a.include_broken or not p['chainBroken']]),
        keepersAtHalf=len([r for r in gen if r['score'] >= 0.5]),
    )
    out = dict(summary=summary, graded=graded, pairs=pairs)
    if a.out:
        json.dump(out, open(a.out, 'w'), indent=1)
    print(json.dumps(summary, indent=1))
    by = {}
    for r in graded:
        by.setdefault(r['batch'], []).append(r)
    print('\n%-12s %6s %7s %8s  %s' % ('batch', 'n', 'scale', 'chain', 'mean score'))
    for b in sorted(by):
        rs = by[b]
        print('%-12s %6d %7s %8s  %.3f'
              % (b, len(rs), '1-4' if b in SCALE4 else '1-9',
                 'BROKEN' if b in BROKEN_CHAIN else 'ok',
                 sum(r['score'] for r in rs) / len(rs)))
    if pairs:
        print('\nA/B pairs by batch:')
        pb = {}
        for p in pairs:
            pb.setdefault(p['batch'], []).append(p)
        for b in sorted(pb):
            print('  %-10s %3d pairs (%s)'
                  % (b, len(pb[b]), 'BROKEN chain' if b in BROKEN_CHAIN else 'ok'))


if __name__ == '__main__':
    main()
