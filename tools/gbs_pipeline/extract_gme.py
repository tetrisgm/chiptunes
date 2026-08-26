"""NSF/HES/KSS -> note events via the tapped libgme, frame-exact.

NES maps 1:1 onto the four GB-style roles (pulse, pulse, triangle->wave,
noise). HES wave channels carry real 32-sample wavetables, captured like GB
wave RAM. KSS is the same SN76489 the VGM parser handles.
"""
import os, sys, json, math, struct, subprocess, hashlib, collections
from concurrent.futures import ThreadPoolExecutor

TAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game-music-emu', 'tapdump')
REC = struct.Struct('<iBhBBBiB')
NES_CLK = 1789773.0

def midi_of(hz):
    if hz < 16 or hz > 12000: return -1
    return int(round(69 + 12 * math.log2(hz / 440.0)))

def parse_nes(lines):
    ev = []
    duty_env = {0: 0, 1: 0}
    tri_lin = 0
    timer = {0: 0, 1: 0, 2: 0}
    noise_per = 0; noise_env = 0
    for f, chip, a, d in lines:
        a -= 0x4000
        if a in (0x00, 0x04): duty_env[a // 4] = d
        elif a == 0x08: tri_lin = d
        elif a in (0x02, 0x06): ch = (a - 2) // 4; timer[ch] = (timer[ch] & 0x700) | d
        elif a == 0x0A: timer[2] = (timer[2] & 0x700) | d
        elif a in (0x03, 0x07):
            ch = (a - 3) // 4
            timer[ch] = (timer[ch] & 0xFF) | ((d & 7) << 8)
            t = timer[ch]
            if t >= 8:
                m = midi_of(NES_CLK / (16.0 * (t + 1)))
                de = duty_env[ch]
                vel = (de & 0x0F) if (de & 0x10) else 10
                if m > 0 and vel > 0:
                    ev.append((f, ch, m, max(1, min(15, vel)), (de >> 6) & 3, de, -1))
        elif a == 0x0B:
            timer[2] = (timer[2] & 0xFF) | ((d & 7) << 8)
            t = timer[2]
            if t >= 2 and tri_lin & 0x7F:
                m = midi_of(NES_CLK / (32.0 * (t + 1)))
                if m > 0: ev.append((f, 2, m, 12, 0, 0, -1))
        elif a == 0x0E: noise_per = d & 0x0F
        elif a == 0x0C: noise_env = d
        elif a == 0x0F:
            vel = (noise_env & 0x0F) if (noise_env & 0x10) else 10
            if vel > 0: ev.append((f, 3, noise_per, max(1, min(15, vel)), 0, noise_env, -1))
    return ev, {}

def parse_hes(lines):
    ev = []
    sel = 0
    freq = collections.defaultdict(int)
    ctrl = collections.defaultdict(int)
    noise = collections.defaultdict(int)
    wave = collections.defaultdict(list)
    waves = {}
    wave_id = collections.defaultdict(lambda: -1)
    for f, chip, a, d in lines:
        a -= 0x800
        if a == 0: sel = d & 7
        elif a == 2: freq[sel] = (freq[sel] & 0xF00) | d
        elif a == 3: freq[sel] = (freq[sel] & 0x0FF) | ((d & 0x0F) << 8)
        elif a == 6:
            wave[sel].append(d & 0x1F)
            if len(wave[sel]) >= 32:
                tb = bytes(wave[sel][-32:])
                h = int.from_bytes(hashlib.blake2b(tb, digest_size=4).digest(), 'little') & 0x7fffffff
                waves[h] = tb.hex(); wave_id[sel] = h
        elif a == 7 and sel >= 4: noise[sel] = d
        elif a == 4:
            was_on = ctrl[sel] & 0x80
            ctrl[sel] = d
            on = d & 0x80
            vel = max(1, min(15, ((d & 0x1F) >> 1)))
            if on and not was_on:
                if sel >= 4 and (noise[sel] & 0x80):
                    ev.append((f, 100 + sel, (noise[sel] & 0x1F) % 16, vel, 0, 0xF1, -1))
                else:
                    per = freq[sel] or 4096
                    m = midi_of(3579545.0 / (32.0 * per))
                    if m > 0: ev.append((f, sel, m, vel, 0, 0xF0, wave_id[sel]))
    return ev, waves

def parse_kss(lines):
    ev = []
    latch = 0; tone = [0, 0, 0]; vol = [15] * 4; npoly = 0
    ay_reg = [0] * 16
    for f, chip, a, d in lines:
        if chip == 2 and a == 0:
            if d & 0x80:
                latch = d; ch = (d >> 5) & 3; typ = (d >> 4) & 1
                if typ:
                    old = vol[ch]; vol[ch] = d & 0x0F
                    if ch < 3 and old == 15 and vol[ch] < 15 and tone[ch] > 0:
                        m = midi_of(3579545.0 / (32.0 * tone[ch]))
                        if m > 0: ev.append((f, ch, m, 15 - vol[ch], 0, 0xF0, -1))
                    if ch == 3 and old == 15 and vol[ch] < 15:
                        ev.append((f, 103, npoly & 7, 15 - vol[ch], 0, 0xF1, -1))
                else:
                    if ch < 3: tone[ch] = (tone[ch] & 0x3F0) | (d & 0x0F)
                    else: npoly = d & 0x0F
            else:
                ch = (latch >> 5) & 3; typ = (latch >> 4) & 1
                if not typ and ch < 3:
                    old = tone[ch]
                    tone[ch] = (tone[ch] & 0x00F) | ((d & 0x3F) << 4)
                    if vol[ch] < 15 and tone[ch] > 0 and abs(tone[ch] - old) > max(2, old // 64):
                        m = midi_of(3579545.0 / (32.0 * tone[ch]))
                        if m > 0: ev.append((f, ch, m, 15 - vol[ch], 0, 0xF0, -1))
        elif chip == 3 and a < 16:
            old = ay_reg[a]; ay_reg[a] = d
            if a in (8, 9, 10):
                ch = a - 8
                if (old & 0x0F) == 0 and (d & 0x0F) > 0:
                    per = ay_reg[ch * 2] | ((ay_reg[ch * 2 + 1] & 0x0F) << 8)
                    if per > 0:
                        m = midi_of(1789773.0 / (16.0 * per))
                        if m > 0: ev.append((f, 200 + ch, m, min(15, d & 0x0F), 0, 0xF0, -1))
    return ev, {}

def role_map(ev):
    """(frame, srcch, val, vel, duty, env, waveid) -> 4 roles"""
    drums = [e for e in ev if e[1] in (103,) or (100 <= e[1] < 200 and e[5] == 0xF1)]
    mel = [e for e in ev if e not in drums]
    if not mel: return []
    by = collections.defaultdict(list)
    for e in mel: by[e[1]].append(e)
    stats = sorted(((c, len(v), sorted(x[2] for x in v)[len(v)//2]) for c, v in by.items() if len(v) >= 16),
                   key=lambda t: t[2])
    roles = {}
    if stats: roles[stats[0][0]] = 2
    for i, s in enumerate(sorted(stats[1:], key=lambda t: -t[1])[:2]): roles[s[0]] = i
    out = []
    for f, c, v, vel, duty, env, wid in mel:
        r = roles.get(c)
        if r is None: continue
        out.append((f, r, v, vel, duty, env, wid))
    for f, c, v, vel, duty, env, wid in drums:
        out.append((f, 3, v % 16, vel, duty, env, -1))
    dropped = len(mel) - sum(1 for e in mel if e[1] in roles)
    return out, dropped / max(1, len(mel))

def nsf_tags(path):
    try:
        h = open(path, 'rb').read(0x80)
        if h[:5] not in (b'NESM\x1a',): return {}
        dec = lambda b: b.split(b'\x00')[0].decode('latin-1', 'replace').strip()
        return dict(game=dec(h[0x0E:0x2E]), composer=dec(h[0x2E:0x4E]))
    except OSError: return {}

def run_tap(path, track, secs):
    r = subprocess.run([TAP, path, str(track), str(secs)], capture_output=True, timeout=120)
    lines = []
    end = 0
    for ln in r.stdout.split(b'\n'):
        p = ln.split()
        if len(p) == 4:
            lines.append((int(p[0]), int(p[1]), int(p[2]), int(p[3])))
        elif len(p) == 2 and p[0] == b'END':
            end = int(p[1])
    return lines, end

def extract_file(path, system, outdir, wavedir):
    try:
        r = subprocess.run([TAP, path], capture_output=True, timeout=60)
        first = r.stdout.split(b'\n')[0].split()
        ntr = int(first[1]) if len(first) == 2 and first[0] == b'TRACKS' else 0
    except Exception:
        return []
    parser = {'nes': parse_nes, 'hes': parse_hes, 'kss': parse_kss}[system]
    tags = nsf_tags(path) if system == 'nes' else {}
    results = []
    for t in range(min(ntr, 40)):
        try:
            lines, end = run_tap(path, t, 75)
        except Exception:
            continue
        if end < 900: continue
        ev, waves = parser(lines)
        mapped = role_map(ev)
        if not mapped: continue
        out, drop = mapped
        if len(out) < 64: continue
        out.sort()
        stem = '%s__%d' % (os.path.basename(path).rsplit('.', 1)[0], t)
        stem = ''.join(c if c.isalnum() or c in '._-' else '_' for c in stem)[:110]
        with open(os.path.join(outdir, stem + '.bin'), 'wb') as fh:
            for f, rrole, v, vel, duty, env, wid in out:
                fh.write(REC.pack(f, rrole, v, min(15, max(1, vel)), duty & 0xFF, env & 0xFF, wid, 0))
        if waves:
            json.dump(waves, open(os.path.join(wavedir, stem + '.json'), 'w'))
        results.append(dict(ok=True, stem=stem, system=system, notes=len(out),
                            seconds=round(end / 60.0, 1), dropShare=round(drop, 3),
                            game=tags.get('game') or os.path.basename(os.path.dirname(path)),
                            composer=tags.get('composer', ''), track=t))
    return results

if __name__ == '__main__':
    jobs = []
    C = sys.argv[1]
    for system, sub, exts in (('nes', 'nes', ('.nsf',)), ('hes', 'turbografx-16', ('.hes',)),
                              ('kss', 'game-gear', ('.kss',)), ('kss', 'master-system', ('.kss',))):
        root = os.path.join(C, sub)
        for dp, _, fs in os.walk(root):
            for f in fs:
                if f.lower().endswith(exts):
                    jobs.append((os.path.join(dp, f), system))
    dst = sys.argv[2]
    outdir = os.path.join(dst, 'tracks'); wavedir = os.path.join(dst, 'waves')
    os.makedirs(outdir, exist_ok=True); os.makedirs(wavedir, exist_ok=True)
    if len(sys.argv) > 3: jobs = jobs[:int(sys.argv[3])]
    print('files: %d' % len(jobs), flush=True)
    man = open(os.path.join(dst, 'manifest.jsonl'), 'w', encoding='utf-8')
    done = tracks = 0
    def one(j):
        return extract_file(j[0], j[1], outdir, wavedir)
    with ThreadPoolExecutor(max_workers=8) as ex:
        for rs in ex.map(one, jobs):
            done += 1; tracks += len(rs)
            for r in rs:
                man.write(json.dumps(r, ensure_ascii=False) + '\n')
            if done % 200 == 0:
                print('  %d/%d files, %d tracks' % (done, len(jobs), tracks), flush=True)
    man.close()
    print('DONE %d files -> %d tracks' % (done, tracks), flush=True)
