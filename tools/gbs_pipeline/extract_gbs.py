"""GBS -> note events on an exact frame grid. 16-way, streaming, stdlib only.

Register writes come from gbsplay's iodumper as cycle deltas. Because we drive
the play clock ourselves, frame = cycles // (CPU / rate) is exact -- no timing
inference anywhere. We track APU register state and emit one note per NRx4
trigger, reading pitch/volume/timbre out of the state at that instant.
"""
import os, sys, json, math, struct, subprocess
from concurrent.futures import ProcessPoolExecutor

GBSPLAY = '/root/build/gbsplay/gbsplay'
ROOT = '/mnt/d/ChiptunesTraining/Corpus-GameBoy-GBS'
OUTDIR = '/mnt/d/ChiptunesTraining/dataset-v3/tracks'
WORK = '/mnt/d/ChiptunesTraining/Analysis-20260809/extract_worklist.json'
CPU = 4194304.0
REC = struct.Struct('<iBhBi')          # frame, channel, value, velocity, patch

TRIG = {0xff14: 0, 0xff19: 1, 0xff1e: 2, 0xff23: 3}

def midi_of(freq_reg, wave):
    if freq_reg >= 2048:
        return -1
    denom = 2048 - freq_reg
    if denom <= 0:
        return -1
    hz = (65536.0 if wave else 131072.0) / denom
    if hz < 16 or hz > 12000:
        return -1
    return int(round(69 + 12 * math.log2(hz / 440.0)))

def extract(job):
    path = os.path.join(ROOT, job['gbs'])
    secs = min(int(job['seconds']) + 2, 300)
    try:
        proc = subprocess.Popen(
            [GBSPLAY, '-o', 'iodumper', '-t', str(secs), path, str(job['song']), str(job['song'])],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        out, _ = proc.communicate(timeout=secs * 3 + 90)
    except (subprocess.TimeoutExpired, OSError):
        try: proc.kill()
        except Exception: pass
        return dict(job=job, ok=False, why='timeout')

    per = CPU / job['rate']
    reg = {}                       # 0xFF10..0xFF3F
    wave_ram = bytearray(16)
    cyc = 0
    notes = []
    last_on = {}
    arp = {}
    for ln in out.split(b'\n'):
        p = ln.split()
        if len(p) != 2 or b'=' not in p[1]:
            continue
        try:
            d = int(p[0], 16)
            a, v = p[1].split(b'=')
            a = int(a, 16); v = int(v, 16)
        except ValueError:
            continue
        cyc += d
        if 0xff30 <= a <= 0xff3f:
            wave_ram[a - 0xff30] = v
        reg[a] = v
        ch = TRIG.get(a)
        if ch is None or not (v & 0x80):
            continue
        frame = int(cyc // per)
        if ch == 0 or ch == 1:
            lo = reg.get(0xff13 if ch == 0 else 0xff18, 0)
            value = midi_of(((v & 0x07) << 8) | lo, wave=False)
            env = reg.get(0xff12 if ch == 0 else 0xff17, 0)
            vel = (env >> 4) & 0x0f
            duty = (reg.get(0xff11 if ch == 0 else 0xff16, 0) >> 6) & 0x03
            patch = duty * 256 + env
        elif ch == 2:
            lo = reg.get(0xff1d, 0)
            value = midi_of(((v & 0x07) << 8) | lo, wave=True)
            lvl = (reg.get(0xff1c, 0) >> 5) & 0x03
            vel = (0, 15, 8, 4)[lvl]
            patch = 1 << 20 | (hash(bytes(wave_ram)) & 0xffff)
        else:
            nr43 = reg.get(0xff22, 0)
            value = ((nr43 >> 4) & 0x0f) * 16 + (nr43 & 0x07) * 2 + ((nr43 >> 3) & 1)
            env = reg.get(0xff21, 0)
            vel = (env >> 4) & 0x0f
            patch = 2 << 20 | nr43
        if value < 0 or vel == 0:
            continue
        # Collapse sub-musical retriggers. A driver re-triggers a channel every
        # frame or two for arpeggio, vibrato and tremolo; those are ornaments on
        # one note, not separate notes. At 60fps a 16th at 150bpm is ~6 frames,
        # so anything within 2 frames cannot be a distinct melodic event.
        # Without this the note rate triples and sustained voices (the bass on
        # wave) get swamped by whatever retriggers fastest.
        last = last_on.get(ch)
        if last is not None and frame - last[0] <= 2:
            if last[1] != value:
                arp[ch] = arp.get(ch, 0) + 1     # ornamented, not a new note
            continue
        last_on[ch] = (frame, value)
        notes.append(REC.pack(frame, ch, value, vel, patch))
    if len(notes) < 24:
        return dict(job=job, ok=False, why='few notes (%d)' % len(notes))
    stem = '%s__%d' % (os.path.basename(job['gbs']).replace('.gbs', ''), job['song'])
    with open(os.path.join(OUTDIR, stem + '.bin'), 'wb') as fh:
        fh.write(b''.join(notes))
    return dict(job=job, ok=True, notes=len(notes), stem=stem,
                frames=int(cyc // per), ornaments=sum(arp.values()))

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    jobs = json.load(open(WORK, encoding='utf-8'))
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limit:
        jobs = jobs[:limit]
    print('extracting %d tracks, 16 workers' % len(jobs), flush=True)
    man = open('/mnt/d/ChiptunesTraining/dataset-v3/manifest.jsonl', 'w', encoding='utf-8')
    done = good = 0
    with ProcessPoolExecutor(max_workers=16) as ex:
        for r in ex.map(extract, jobs, chunksize=8):
            man.write(json.dumps(r, ensure_ascii=False) + '\n')
            done += 1; good += 1 if r['ok'] else 0
            if done % 500 == 0:
                print('  %d/%d  ok=%d' % (done, len(jobs), good), flush=True)
    man.close()
    print('DONE %d/%d ok' % (good, done), flush=True)
