"""Turn a directory of generated .gbs into a blind listening batch.

  python3 build_batch.py --gbs <dir> --out <batch-dir> --gbsplay <bin> \
      [--anchors <dir>] [--limit 50] [--repeats 4] [--seconds 70]

`--gbs` may be repeated and may carry a label (`--gbs A=path --gbs B=path`).
The label rides through into key.json as `gen:<label>:<stem>`, so one rating
session can compare generation settings without the rater knowing which is
which -- the same listening effort answers both "is it good" and "which
setting is better".

Steps: gate on measured brokenness (audition.GATES), sample survivors uniformly,
salt in real corpus tracks as blind anchors and a few hidden repeats, shuffle
into neutral track-NN names, render through the real emulator, and write
key.json.  Proxy metrics never rank musical quality.

Anchors and repeats are not decoration:
  * anchors calibrate the session -- a batch where real Game Boy music rates
    low means the rater was harsh or the render is unfair, not that the model
    regressed.
  * repeats are the same file twice under different names; agreement between
    them is the only measure of how much the batch's numbers can be trusted.
    Measured 2026-08-11: absolute grades swung 2 of 3 on identical audio.
"""
import argparse, glob, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_report as SR
import audition as A


def render(src, out, gbsplay, sub=1, seconds=70):
    wav = os.path.splitext(out)[0] + '.src.wav'
    with open(os.devnull, 'rb') as dn:
        subprocess.run([gbsplay, '-o', 'wav', '-O', wav, '-E', 'l', '-r', '44100',
                        '-f', '3', '-g', '0', '-t', str(seconds), '-T', '8', '-q',
                        src, str(sub), str(sub)],
                       stdin=dn, capture_output=True, timeout=600)
    # FLAC, not mp3: square waves are the worst case for a transform codec
    # (infinite harmonics, sharp transients). Measured against the emulator's
    # own output, 96k mono mp3 gave 14.7 dB SNR and even 320k only 22.4 dB --
    # audible smearing on exactly the content chiptunes are made of. Lossless
    # costs nothing over localhost.
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav,
                    '-compression_level', '8', out],
                   capture_output=True, timeout=600)
    if os.path.exists(wav):
        os.unlink(wav)
    return os.path.exists(out) and os.path.getsize(out) > 4096


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gbs', required=True, action='append',
                    help='dir, or LABEL=dir; repeatable')
    ap.add_argument('--out', required=True)
    ap.add_argument('--gbsplay', required=True)
    ap.add_argument('--anchors')
    ap.add_argument('--anchor-sub', type=int, default=2)
    ap.add_argument('--limit', type=int, default=50)
    ap.add_argument('--anchors-n', type=int, default=4)
    ap.add_argument('--repeats', type=int, default=4)
    ap.add_argument('--seconds', type=int, default=70)
    ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    rows = []
    for spec in a.gbs:
        label, _, d = spec.partition('=')
        if not d:
            label, d = '', label
        for p in sorted(glob.glob(os.path.join(d, '*.gbs'))):
            r = SR.analyze(SR.decode_gbs(p)) or dict(seconds=0, events=0, voices=0)
            r['path'] = p
            r['file'] = os.path.basename(p)
            r['label'] = label
            r['rejected'] = A.gate(r)
            rows.append(r)
    passed = [r for r in rows if not r['rejected']]
    rng = random.Random(a.seed or None)
    keep = []
    if len({r['label'] for r in rows}) > 1:
        # Take equally from each source, else a larger arm silently dominates.
        byl = {}
        for r in passed:
            byl.setdefault(r['label'], []).append(r)
        quota = max(1, a.limit // max(1, len(byl)))
        for L in sorted(byl):
            rng.shuffle(byl[L])
            keep.extend(byl[L][:quota])
            print('  %s: %d passed, %d taken' % (L or '(none)', len(byl[L]),
                                                 min(quota, len(byl[L]))))
    else:
        keep = rng.sample(passed, min(a.limit, len(passed)))
    reasons = {}
    for r in rows:
        for w in r['rejected']:
            k = w.split('=')[0]
            reasons[k] = reasons.get(k, 0) + 1
    print('gate: %d/%d passed; %d sampled  rejects %s'
          % (len(passed), len(rows), len(keep), reasons))
    picks = keep[:a.limit]

    items = [(r['path'],
              'gen:' + (r['label'] + ':' if r['label'] else '')
              + os.path.splitext(r['file'])[0], 1) for r in picks]
    if a.anchors:
        anc = sorted(glob.glob(os.path.join(a.anchors, '*.gbs')))[:a.anchors_n]
        items += [(p, 'corpus:' + os.path.splitext(os.path.basename(p))[0],
                   a.anchor_sub) for p in anc]
    items += [(s, l + '|repeat', sub)
              for s, l, sub in rng.sample(items, min(a.repeats, len(items)))]
    rng.shuffle(items)

    key = {}
    for i, (src, label, sub) in enumerate(items, 1):
        tid = 'track-%02d' % i
        if render(src, os.path.join(a.out, tid + '.flac'), a.gbsplay, sub, a.seconds):
            key[tid] = label
        else:
            print('  render failed: %s' % label)
    json.dump(key, open(os.path.join(a.out, 'key.json'), 'w'), indent=1)
    kinds = {}
    for v in key.values():
        k = v.split(':')[0] + ('|repeat' if v.endswith('|repeat') else '')
        kinds[k] = kinds.get(k, 0) + 1
    print('batch %s: %d tracks %s'
          % (os.path.basename(a.out), len(key), kinds))


if __name__ == '__main__':
    main()
