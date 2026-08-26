"""Score-level report card: does the music have harmony and form?

v6 passed every proxy metric while sounding empty, so this measures only the
things that were actually wrong, and always against the real GB corpus rather
than an absolute bar:

  keyStability   share of windows whose best-fit key equals the song's key.
                 v6 scored 1.00 against a corpus 0.92 -- it never modulated.
                 Higher is NOT better; closer to corpus is better.
  modulations    distinct key changes per minute.
  pcEntropy      pitch-class entropy in bits (chromaticism).
  leapShare      melodic intervals > 4 semitones (angular vs stepwise writing).
  consonance     share of bass/lead vertical intervals that are 3rds/5ths/6ths
                 /octaves. Real GB writing is highly consonant; a model that
                 never learned harmony scatters.
  reuse          events / distinct 8-event shapes: literal repetition, the
                 cheapest proxy for form.
  spanBalance    shortest voice span / longest. v6 hit 0.39-0.55 (voices
                 stopping at different times); corpus is 1.00.

Reads generated `.gbs` by decoding the driver's own song stream -- the exact
bytes the hardware will execute -- and corpus tracks from packed dataset-v4
event files, so both sides are measured by identical code.
"""
import argparse, collections, glob, json, math, os, random, struct

REC = struct.Struct('<iBhBBBiB')
# Krumhansl-Kessler major/minor profiles, used only to pick a best-fit key.
KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
CONSONANT = {0, 3, 4, 5, 7, 8, 9}          # unison/3rds/4th/5th/6ths mod 12
WINDOW_FRAMES = 480                         # ~8 s at 59.7275 fps


def syms(path):
    out = {}
    for ln in open(path, encoding='utf-8'):
        p = ln.split()
        if len(p) == 2 and ':' in p[0]:
            try:
                out[p[1]] = int(p[0].split(':')[1], 16)
            except ValueError:
                pass
    return out


def find_song_start(data):
    """Locate the song stream without a .sym.

    Driver revisions moved the Song symbol (bank sizes changed), so a sym from
    the wrong build silently decodes zero events. The stream is instead found
    by structure: it is the earliest offset that parses as a valid event stream
    and terminates with $00 exactly at end-of-file.
    """
    for start in range(0x70, len(data)):
        i = start
        ok = False
        while i < len(data):
            b = data[i]; i += 1
            if b == 0x00:
                ok = (i == len(data))
                break
            if b < 0x80:
                continue
            if (b & 0xF0) == 0x90:
                continue
            if (b & 0xF0) != 0x80:
                break                       # not a valid opcode: wrong offset
            i += 2
        if ok:
            return start
    return None


def decode_gbs(path, song_addr=None, load_addr=0x3000):
    """Run the driver's song stream the way the driver does -> (frame, ch, note)."""
    data = open(path, 'rb').read()
    # The structural probe validates its answer; a sym only asserts one. Prefer
    # the probe and keep the sym as the fallback.
    start = find_song_start(data)
    if start is None and song_addr is not None:
        cand = 0x70 + (song_addr - load_addr)
        start = cand if 0 < cand < len(data) else None
    if start is None:
        return []
    i, frame, out = start, 0, []
    while i < len(data):
        b = data[i]; i += 1
        if b == 0x00:
            break
        if b < 0x80:
            frame += b
            continue
        if (b & 0xF0) == 0x90:
            continue                        # note off carries no pitch
        ch = b & 3
        if i + 1 >= len(data):
            break
        note = data[i]; i += 2              # skip the instrument byte
        out.append((frame, ch, note))
    return out


def load_bin(path):
    data = open(path, 'rb').read()
    out = []
    for i in range(0, len(data) - REC.size + 1, REC.size):
        f, ch, val, vel, du, en, wid, arp = REC.unpack(data[i:i + REC.size])
        out.append((f, ch, val))
    return out


def best_key(pcs):
    """pcs: 12 weights -> (tonic, is_minor, correlation)."""
    total = sum(pcs)
    if total <= 0:
        return None
    v = [p / total for p in pcs]
    best = None
    for minor, prof in ((0, KK_MAJ), (1, KK_MIN)):
        for tonic in range(12):
            rot = [prof[(k - tonic) % 12] for k in range(12)]
            mp = sum(rot) / 12
            mv = sum(v) / 12
            num = sum((rot[k] - mp) * (v[k] - mv) for k in range(12))
            den = math.sqrt(sum((rot[k] - mp) ** 2 for k in range(12))
                            * sum((v[k] - mv) ** 2 for k in range(12)))
            r = num / den if den > 1e-12 else 0.0
            if best is None or r > best[2]:
                best = (tonic, minor, r)
    return best


def analyze(events):
    """events: [(frame, ch, val)] with ch 3 = noise (excluded from pitch math)."""
    pitched = [(f, c, v) for f, c, v in events if c != 3 and 12 <= v <= 120]
    if len(pitched) < 24:
        return None
    frames = [f for f, _, _ in events]
    span = max(frames) - min(frames)
    if span <= 0:
        return None
    seconds = span / 59.7275

    hist = [0] * 12
    for _, _, v in pitched:
        hist[v % 12] += 1
    song_key = best_key(hist)

    # --- key stability over sliding windows ---
    lo = min(f for f, _, _ in pitched)
    wins, same = 0, 0
    keys_seen = []
    w = lo
    top = max(f for f, _, _ in pitched)
    while w <= top:
        h = [0] * 12
        for f, _, v in pitched:
            if w <= f < w + WINDOW_FRAMES:
                h[v % 12] += 1
        if sum(h) >= 8:
            k = best_key(h)
            if k:
                wins += 1
                keys_seen.append((k[0], k[1]))
                if song_key and k[0] == song_key[0] and k[1] == song_key[1]:
                    same += 1
        w += WINDOW_FRAMES
    key_stability = same / wins if wins else None
    changes = sum(1 for a, b in zip(keys_seen, keys_seen[1:]) if a != b)
    modulations = changes / (seconds / 60) if seconds > 0 else 0.0

    total = sum(hist)
    pc_entropy = -sum((c / total) * math.log2(c / total)
                      for c in hist if c > 0) if total else 0.0

    # --- melodic intervals within each voice ---
    leaps = steps = 0
    for ch in (0, 1, 2):
        seq = [v for f, c, v in sorted(pitched) if c == ch]
        for a, b in zip(seq, seq[1:]):
            d = abs(b - a)
            if d == 0:
                continue
            if d > 4:
                leaps += 1
            else:
                steps += 1
    leap_share = leaps / (leaps + steps) if (leaps + steps) else None

    # --- vertical intervals: bass (ch2) against the leads, sampled per frame ---
    by_ch = {}
    for f, c, v in sorted(pitched):
        by_ch.setdefault(c, []).append((f, v))
    cons = tot = 0
    if 2 in by_ch:
        bass = by_ch[2]
        bi = 0
        for ch in (0, 1):
            for f, v in by_ch.get(ch, []):
                while bi + 1 < len(bass) and bass[bi + 1][0] <= f:
                    bi += 1
                if not bass:
                    break
                bf, bv = bass[min(bi, len(bass) - 1)]
                if abs(bf - f) > 30:          # only judge simultaneous sound
                    continue
                tot += 1
                if (v - bv) % 12 in CONSONANT:
                    cons += 1
            bi = 0
    consonance = cons / tot if tot else None

    # --- literal repetition ---
    shapes = collections.Counter()
    for ch in (0, 1, 2, 3):
        seq = [v for f, c, v in sorted(events) if c == ch]
        for i in range(0, max(0, len(seq) - 8)):
            shapes[tuple(seq[i:i + 8])] += 1
    reuse = (sum(shapes.values()) / len(shapes)) if shapes else None

    # --- voice span balance ---
    spans = []
    for ch in (0, 1, 2, 3):
        fs = [f for f, c, _ in events if c == ch]
        if len(fs) >= 4:
            spans.append(max(fs) - min(fs))
    span_balance = (min(spans) / max(spans)) if len(spans) >= 2 and max(spans) else None

    return dict(seconds=round(seconds, 1), events=len(events),
                voices=len(spans),
                keyStability=key_stability, modulationsPerMin=round(modulations, 2),
                pcEntropy=round(pc_entropy, 3), leapShare=leap_share,
                consonance=consonance, reuse=reuse, spanBalance=span_balance)


def agg(rows):
    keys = ('seconds', 'keyStability', 'modulationsPerMin', 'pcEntropy',
            'leapShare', 'consonance', 'reuse', 'spanBalance', 'voices')
    out = {}
    for k in keys:
        vals = sorted(r[k] for r in rows if r and r.get(k) is not None)
        out[k] = round(vals[len(vals) // 2], 3) if vals else None
    out['tracks'] = len(rows)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gbs', help='directory of generated .gbs files')
    ap.add_argument('--driver-dir', help='dir holding tracker2.sym')
    ap.add_argument('--corpus', help='dataset dir with tracks/*.bin for reference')
    ap.add_argument('--corpus-sample', type=int, default=400)
    a = ap.parse_args()

    report = {}
    if a.gbs:
        song_addr = syms(os.path.join(a.driver_dir, 'tracker2.sym'))['Song']
        rows = []
        for p in sorted(glob.glob(os.path.join(a.gbs, '*.gbs'))):
            r = analyze(decode_gbs(p, song_addr))
            if r:
                r['file'] = os.path.basename(p)
                rows.append(r)
        report['generated'] = agg(rows)
        report['generatedTracks'] = rows
    if a.corpus:
        files = glob.glob(os.path.join(a.corpus, 'tracks', '*.bin'))
        random.seed(7)
        if len(files) > a.corpus_sample:
            files = random.sample(files, a.corpus_sample)
        rows = [analyze(load_bin(p)) for p in files]
        report['corpus'] = agg([r for r in rows if r])
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
