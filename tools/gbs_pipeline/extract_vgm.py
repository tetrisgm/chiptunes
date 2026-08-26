"""VGM/VGZ -> note events (dataset-v4 schema). Pure parser, no emulator.

Chips: SN76489 PSG (SMS/GG/Genesis) and YM2612 FM (Genesis). Timing is
sample-exact by format definition (44100 Hz waits), converted to GB frames.
GD3 tags give title/game/composer. Unhandled chips are counted, not guessed.
"""
import os, sys, json, gzip, struct, math, re, collections
from concurrent.futures import ThreadPoolExecutor

REC = struct.Struct('<iBhBBBiB')
FPS = 59.7275

def read_vgm(path):
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    if raw[:4] != b'Vgm ':
        return None
    return raw

def gd3(raw):
    off = struct.unpack_from('<I', raw, 0x14)[0]
    if not off: return {}
    g = 0x14 + off
    if raw[g:g+4] != b'Gd3 ': return {}
    n = struct.unpack_from('<I', raw, g+8)[0]
    parts = raw[g+12:g+12+n].decode('utf-16-le', 'replace').split('\x00')
    keys = ('trackEn','trackJp','gameEn','gameJp','sysEn','sysJp','authorEn','authorJp','date')
    return dict(zip(keys, parts))

def midi_of(hz):
    if hz < 16 or hz > 12000: return -1
    return int(round(69 + 12 * math.log2(hz / 440.0)))

def extract(path, outdir):
    raw = read_vgm(path)
    if raw is None: return dict(ok=False, why='not vgm')
    ver = struct.unpack_from('<I', raw, 0x08)[0]
    psg_clock = struct.unpack_from('<I', raw, 0x0C)[0] & 0x3fffffff or 3579545
    ym2612_clock = (struct.unpack_from('<I', raw, 0x2C)[0] if ver >= 0x110 and len(raw) > 0x30 else 0) & 0x3fffffff
    data = 0x40
    if ver >= 0x150 and len(raw) > 0x38:
        rel = struct.unpack_from('<I', raw, 0x34)[0]
        if rel: data = 0x34 + rel
    loop_sample = struct.unpack_from('<I', raw, 0x20)[0]
    tags = gd3(raw)

    i = data; sample = 0
    psg_latch = 0
    psg_tone = [0,0,0]; psg_vol = [15]*4
    psg_noise = 0
    fm_freq = {}                                   # ch -> (fnum, block)
    events = []                                    # (sample, srcchan, midi/kind, vel, kind)
    skipped = collections.Counter()
    n = len(raw)
    while i < n:
        c = raw[i]
        if c == 0x66: break
        elif c == 0x61: sample += struct.unpack_from('<H', raw, i+1)[0]; i += 3
        elif c == 0x62: sample += 735; i += 1
        elif c == 0x63: sample += 882; i += 1
        elif 0x70 <= c <= 0x7F: sample += (c & 0x0F) + 1; i += 1
        elif 0x80 <= c <= 0x8F: sample += (c & 0x0F); i += 1
        elif c == 0x67:
            sz = struct.unpack_from('<I', raw, i+3)[0]; i += 7 + sz
        elif c == 0x50:
            d = raw[i+1]; i += 2
            if d & 0x80:
                psg_latch = d
                ch = (d >> 5) & 3; typ = (d >> 4) & 1
                if typ:
                    old = psg_vol[ch]; psg_vol[ch] = d & 0x0F
                    if ch < 3 and old == 15 and psg_vol[ch] < 15 and psg_tone[ch] > 0:
                        hz = psg_clock / (32.0 * psg_tone[ch])
                        events.append((sample, 100+ch, midi_of(hz), 15-psg_vol[ch], 'tone'))
                    if ch == 3 and old == 15 and psg_vol[ch] < 15:
                        events.append((sample, 103, psg_noise & 0x07, 15-psg_vol[ch], 'noise'))
                else:
                    if ch < 3: psg_tone[ch] = (psg_tone[ch] & 0x3F0) | (d & 0x0F)
                    else: psg_noise = d & 0x0F
            else:
                ch = (psg_latch >> 5) & 3; typ = (psg_latch >> 4) & 1
                if not typ and ch < 3:
                    old = psg_tone[ch]
                    psg_tone[ch] = (psg_tone[ch] & 0x00F) | ((d & 0x3F) << 4)
                    if psg_vol[ch] < 15 and psg_tone[ch] > 0 and abs(psg_tone[ch]-old) > max(2, old//64):
                        hz = psg_clock / (32.0 * psg_tone[ch])
                        events.append((sample, 100+ch, midi_of(hz), 15-psg_vol[ch], 'tone'))
        elif c in (0x52, 0x53):
            port = c - 0x52; a, d = raw[i+1], raw[i+2]; i += 3
            base = 0 if port == 0 else 3
            if 0xA4 <= a <= 0xA6:
                ch = base + (a - 0xA4)
                f = fm_freq.get(ch, (0, 0))
                fm_freq[ch] = (f[0] & 0xFF | ((d & 7) << 8), (d >> 3) & 7)
            elif 0xA0 <= a <= 0xA2:
                ch = base + (a - 0xA0)
                f = fm_freq.get(ch, (0, 0))
                fm_freq[ch] = ((f[0] & 0x700) | d, f[1])
            elif a == 0x28 and port == 0:
                slots = (d >> 4) & 0x0F
                chn = d & 0x07
                ch = chn if chn < 3 else chn - 1
                if slots and 0 <= ch < 6 and ym2612_clock:
                    fnum, block = fm_freq.get(ch, (0, 0))
                    if fnum:
                        hz = fnum * ym2612_clock / (144.0 * (1 << (21 - block)))
                        events.append((sample, 200+ch, midi_of(hz), 12, 'tone'))
        elif c == 0x4F: i += 2
        elif c == 0x51: skipped['ym2413'] += 1; i += 3
        elif c in (0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x5C,0x5D,0x5E,0x5F): skipped['fm-other'] += 1; i += 3
        elif c == 0xB3: skipped['gb-dmg'] += 1; i += 3
        elif c == 0xB9: skipped['huc6280'] += 1; i += 3
        elif 0xB0 <= c <= 0xBF: skipped['other-b'] += 1; i += 3
        elif 0xC0 <= c <= 0xDF: i += 4
        elif 0xE0 <= c <= 0xFF: i += 5
        else: i += 1
    seconds = sample / 44100.0
    tone = [e for e in events if e[4] == 'tone' and e[2] > 0]
    drums = [e for e in events if e[4] == 'noise']
    if seconds < 15 or len(tone) + len(drums) < 48:
        return dict(ok=False, why='short/sparse', skipped=dict(skipped))
    # role mapping: per source channel stats -> 4 roles
    by = collections.defaultdict(list)
    for s, ch, v, vel, k in tone: by[ch].append((s, v, vel))
    stats = sorted(((ch, len(v), sorted(x[1] for x in v)[len(v)//2]) for ch, v in by.items() if len(v) >= 16),
                   key=lambda t: t[2])
    roles = {}
    if stats: roles[stats[0][0]] = 2
    for i2, s2 in enumerate(sorted(stats[1:], key=lambda t: -t[1])[:2]): roles[s2[0]] = i2
    dropped = sum(nv for ch, nv, _ in stats if ch not in roles)
    out = []
    for s, ch, v, vel, k in tone:
        r = roles.get(ch)
        if r is None: continue
        f = int(round(s * FPS / 44100.0))
        out.append(REC.pack(f, r, v, min(15, vel), 0, 0xF0, -1, 0))
    for s, ch, v, vel, k in drums:
        f = int(round(s * FPS / 44100.0))
        out.append(REC.pack(f, 3, v % 16, min(15, vel), 0, 0xF1, -1, 0))
    if len(out) < 48: return dict(ok=False, why='no mapped notes')
    out.sort(key=lambda b: struct.unpack('<i', b[:4])[0])
    stem = re.sub(r'[^A-Za-z0-9._-]', '_', os.path.relpath(path).replace(os.sep, '__'))[-110:]
    open(os.path.join(outdir, stem + '.bin'), 'wb').write(b''.join(out))
    return dict(ok=True, stem=stem, notes=len(out), seconds=round(seconds, 1),
                title=tags.get('trackEn',''), game=tags.get('gameEn',''),
                composer=tags.get('authorEn',''), loopSample=loop_sample,
                dropShare=round(dropped / max(1, len(tone)), 3), skipped=dict(skipped))

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    os.makedirs(os.path.join(dst, 'tracks'), exist_ok=True)
    files = [os.path.join(dp, f) for dp, _, fs in os.walk(src) for f in fs
             if f.rsplit('.', 1)[-1].lower() in ('vgm', 'vgz')]
    files.sort()
    if limit: files = files[:limit]
    print('vgm files: %d' % len(files), flush=True)
    outdir = os.path.join(dst, 'tracks')
    def one(p):
        try: r = extract(p, outdir)
        except Exception as e: r = dict(ok=False, why=type(e).__name__)
        r['file'] = os.path.relpath(p, src); return r
    man = open(os.path.join(dst, 'manifest.jsonl'), 'w', encoding='utf-8')
    ok = done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(one, files):
            man.write(json.dumps(r, ensure_ascii=False) + '\n')
            done += 1; ok += 1 if r.get('ok') else 0
            if done % 2000 == 0: print('  %d/%d ok=%d' % (done, len(files), ok), flush=True)
    man.close()
    print('DONE %d/%d ok' % (ok, done), flush=True)
