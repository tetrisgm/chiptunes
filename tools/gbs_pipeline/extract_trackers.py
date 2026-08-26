"""Tracker modules -> note events in the dataset-v4 schema, via libopenmpt.

Trackers are the one source where patterns/rows are EXPLICIT, so there is no
timing inference at all: row duration is 2.5*speed/tempo seconds by format
definition, with Fxx/A/T effects tracked as they change it. Channels are
role-mapped onto the four GB-style voices (lead, second, bass, drums); extra
melodic channels are dropped and the drop share is reported as a gate metric.
"""
import ctypes, os, sys, json, struct, collections, re

LIB = ctypes.CDLL('/opt/homebrew/lib/libopenmpt.dylib')
LIB.openmpt_module_create_from_memory2.restype = ctypes.c_void_p
LIB.openmpt_module_create_from_memory2.argtypes = [ctypes.c_char_p, ctypes.c_size_t] + [ctypes.c_void_p]*7
LIB.openmpt_module_format_pattern_row_channel.restype = ctypes.c_void_p
LIB.openmpt_module_format_pattern_row_channel.argtypes = [ctypes.c_void_p]*1 + [ctypes.c_int32]*3 + [ctypes.c_size_t, ctypes.c_int]
LIB.openmpt_module_get_metadata.restype = ctypes.c_void_p
LIB.openmpt_module_get_metadata.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
LIB.openmpt_free_string.argtypes = [ctypes.c_void_p]
M = ctypes.c_void_p
LIB.openmpt_module_get_num_orders.restype = ctypes.c_int32
LIB.openmpt_module_get_num_orders.argtypes = [M]
LIB.openmpt_module_get_order_pattern.restype = ctypes.c_int32
LIB.openmpt_module_get_order_pattern.argtypes = [M, ctypes.c_int32]
LIB.openmpt_module_get_pattern_num_rows.restype = ctypes.c_int32
LIB.openmpt_module_get_pattern_num_rows.argtypes = [M, ctypes.c_int32]
LIB.openmpt_module_get_num_channels.restype = ctypes.c_int32
LIB.openmpt_module_get_num_channels.argtypes = [M]
LIB.openmpt_module_get_current_tempo.restype = ctypes.c_int32
LIB.openmpt_module_get_current_tempo.argtypes = [M]
LIB.openmpt_module_get_current_speed.restype = ctypes.c_int32
LIB.openmpt_module_get_current_speed.argtypes = [M]
LIB.openmpt_module_get_pattern_row_channel_command.restype = ctypes.c_uint8
LIB.openmpt_module_get_pattern_row_channel_command.argtypes = [M] + [ctypes.c_int32]*3 + [ctypes.c_int]
LIB.openmpt_module_format_pattern_row_channel.argtypes = [M] + [ctypes.c_int32]*3 + [ctypes.c_size_t, ctypes.c_int]
LIB.openmpt_module_destroy.argtypes = [M]

CMD_EFFECT, CMD_PARAM, CMD_VOLUME = 3, 5, 4
NOTE_RE = re.compile(r'^([A-G][-#b])(\d)')
CLS = {'C-':0,'C#':1,'D-':2,'D#':3,'E-':4,'F-':5,'F#':6,'G-':7,'G#':8,'A-':9,'A#':10,'B-':11,
       'Db':1,'Eb':3,'Gb':6,'Ab':8,'Bb':10}
REC = struct.Struct('<iBhBBBiB')          # dataset-v4 record
FPS = 59.7275

def s_(p):
    if not p: return ''
    s = ctypes.string_at(p).decode('utf-8', 'replace')
    LIB.openmpt_free_string(p)
    return s

def extract(path, outdir):
    data = open(path, 'rb').read()
    mod = LIB.openmpt_module_create_from_memory2(data, len(data), *([None]*7))
    if not mod: return dict(ok=False, why='load failed')
    try:
        ext = path.rsplit('.', 1)[-1].lower()
        title = s_(LIB.openmpt_module_get_metadata(mod, b'title')).strip()
        artist = s_(LIB.openmpt_module_get_metadata(mod, b'artist')).strip()
        n_ord = LIB.openmpt_module_get_num_orders(mod)
        n_ch = LIB.openmpt_module_get_num_channels(mod)
        tempo = LIB.openmpt_module_get_current_tempo(mod) or 125
        speed = LIB.openmpt_module_get_current_speed(mod) or 6
        if n_ord <= 0 or n_ch <= 0: return dict(ok=False, why='empty')
        per_ch = collections.defaultdict(list)
        seconds = 0.0
        for oi in range(n_ord):
            pat = LIB.openmpt_module_get_order_pattern(mod, oi)
            if pat < 0: continue
            rows = LIB.openmpt_module_get_pattern_num_rows(mod, pat)
            for row in range(rows):
                # tempo/speed effects from any channel take effect this row
                for ch in range(n_ch):
                    eff = LIB.openmpt_module_get_pattern_row_channel_command(mod, pat, row, ch, CMD_EFFECT)
                    par = LIB.openmpt_module_get_pattern_row_channel_command(mod, pat, row, ch, CMD_PARAM)
                    if ext in ('mod', 'xm') and eff == 0x0F and par > 0:
                        if par < 0x20: speed = par
                        else: tempo = par
                    elif ext in ('it', 's3m', 'mtm', 'mo3'):
                        if eff == 1 and par > 0: speed = par           # Axx
                        elif eff == 20 and par >= 0x20: tempo = par    # Txx
                frame = int(round(seconds * FPS))
                for ch in range(n_ch):
                    p = LIB.openmpt_module_format_pattern_row_channel(mod, pat, row, ch, 0, 0)
                    cell = s_(p)
                    m = NOTE_RE.match(cell)
                    if not m: continue
                    cls = CLS.get(m.group(1))
                    if cls is None: continue
                    midi = 12 * int(m.group(2)) + cls
                    if not (24 <= midi <= 108): continue
                    vol = LIB.openmpt_module_get_pattern_row_channel_command(mod, pat, row, ch, CMD_VOLUME)
                    vel = max(1, min(15, vol >> 2)) if vol else 12
                    per_ch[ch].append((frame, midi, vel))
                seconds += 2.5 * speed / max(32, tempo)
        if seconds < 20 or sum(len(v) for v in per_ch.values()) < 48:
            return dict(ok=False, why='too short/sparse')
        # --- role mapping onto 4 GB-style voices ---
        stats = []
        for ch, evs in per_ch.items():
            if len(evs) < 16: continue
            pitches = [e[1] for e in evs]
            stats.append((ch, len(evs), sorted(pitches)[len(pitches)//2], len(set(p % 12 for p in pitches))))
        drums = [c for c, n, med, dpc in stats if dpc <= 2]
        mel = sorted([s for s in stats if s[0] not in drums], key=lambda s: s[2])
        roles = {}
        if mel: roles[mel[0][0]] = 2                                  # lowest median -> bass/wave
        rest = sorted([s for s in mel[1:]], key=lambda s: -s[1])
        for i, s in enumerate(rest[:2]): roles[s[0]] = i              # two busiest -> pulses
        for c in drums: roles[c] = 3
        dropped = sum(n for c, n, _, _ in stats if c not in roles)
        total = sum(n for _, n, _, _ in stats)
        out = []
        for ch, evs in per_ch.items():
            r = roles.get(ch)
            if r is None: continue
            for f, midi, vel in evs:
                val = midi if r < 3 else (midi % 16)
                out.append(REC.pack(f, r, val, vel, 0, 0xF0, -1, 0))
        out.sort(key=lambda b: struct.unpack('<i', b[:4])[0])
        stem = re.sub(r'[^A-Za-z0-9._-]', '_', os.path.basename(path))[:100]
        open(os.path.join(outdir, stem + '.bin'), 'wb').write(b''.join(out))
        return dict(ok=True, stem=stem, notes=len(out), seconds=round(seconds, 1),
                    title=title, artist=artist, format=ext, channels=n_ch,
                    dropShare=round(dropped / max(1, total), 3))
    finally:
        LIB.openmpt_module_destroy(mod)

if __name__ == '__main__':
    if sys.argv[1] == '--one':
        # crash-isolated single-file mode: a segfaulting module kills only this
        # subprocess, and the driver records it instead of losing the pool
        try:
            r = extract(sys.argv[2], sys.argv[3])
        except Exception as e:
            r = dict(ok=False, why=type(e).__name__)
        print(json.dumps(r, ensure_ascii=False))
        sys.exit(0)
    src = sys.argv[1]; dst = sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    os.makedirs(os.path.join(dst, 'tracks'), exist_ok=True)
    files = []
    for dp, _, fs in os.walk(src):
        for f in fs:
            if f.rsplit('.', 1)[-1].lower() in ('mod','xm','it','s3m','mtm','mo3'):
                files.append(os.path.join(dp, f))
    files.sort()
    if limit: files = files[:limit]
    print('modules: %d' % len(files), flush=True)
    import subprocess
    from concurrent.futures import ThreadPoolExecutor
    outdir = os.path.join(dst, 'tracks')
    me = os.path.abspath(__file__)
    def one(path):
        try:
            pr = subprocess.run([sys.executable, me, '--one', path, outdir],
                                capture_output=True, timeout=180)
            line = pr.stdout.decode('utf-8', 'replace').strip().splitlines()
            r = json.loads(line[-1]) if line else dict(ok=False, why='crash rc=%s' % pr.returncode)
        except subprocess.TimeoutExpired:
            r = dict(ok=False, why='timeout')
        except Exception as e:
            r = dict(ok=False, why=type(e).__name__)
        r['file'] = os.path.relpath(path, src)
        return r
    man = open(os.path.join(dst, 'manifest.jsonl'), 'w', encoding='utf-8')
    ok = done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(one, files):
            man.write(json.dumps(r, ensure_ascii=False) + '\n')
            done += 1; ok += 1 if r.get('ok') else 0
            if done % 400 == 0: print('  %d/%d ok=%d' % (done, len(files), ok), flush=True)
    man.close()
    print('DONE %d/%d ok' % (ok, done), flush=True)
