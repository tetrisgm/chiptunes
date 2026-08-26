"""Learn the instrument / wave / arpeggio banks from the corpus.

v1 used 16 hand-picked instruments and one wave shape. These are the timbres
Game Boy composers actually used, ranked by how much music they account for.
"""
import json, os, collections
import numpy as np

D = r'./dataset-v4'
OUT = r'./instruments-v1.json'
REC = np.dtype([('frame','<i4'),('ch','u1'),('val','<i2'),('vel','u1'),
                ('duty','u1'),('env','u1'),('waveid','<i4'),('arp','u1')])
N_PULSE, N_WAVE_INST, N_NOISE = 32, 16, 16
N_WAVE_TABLES, N_ARP = 16, 16

def main():
    man = [json.loads(l) for l in open(os.path.join(D,'manifest.jsonl'), encoding='utf-8') if l.strip()]
    ok = [m for m in man if m['ok']]
    print('scanning %d tracks' % len(ok))
    def envq(e):
        # volume and direction matter; the exact period step barely does
        return ((e >> 4) & 0x0f, (e >> 3) & 1, min(3, e & 7))
    pulse = collections.Counter(); noise = collections.Counter()
    arp = collections.Counter(); waveuse = collections.Counter()
    wave_by_id = {}
    for i, m in enumerate(ok):
        p = os.path.join(D,'tracks',m['stem']+'.bin')
        if not os.path.exists(p): continue
        a = np.fromfile(p, dtype=REC)
        pm = a[(a['ch']==0)|(a['ch']==1)]
        for d, e, r in zip(pm['duty'].tolist(), pm['env'].tolist(), pm['arp'].tolist()):
            pulse[(d,) + envq(e) + (1 if r else 0,)] += 1
        nm = a[a['ch']==3]
        for d, e in zip(nm['duty'].tolist(), nm['env'].tolist()):
            noise[(d, e)] += 1
        for r in a['arp'].tolist():
            if r: arp[r] += 1
        wm = a[a['ch']==2]
        for w, r in zip(wm['waveid'].tolist(), wm['arp'].tolist()):
            if w >= 0: waveuse[w] += 1
        if i % 2000 == 0:
            wf = os.path.join(D,'waves',m['stem']+'.json')
        wf = os.path.join(D,'waves',m['stem']+'.json')
        if os.path.exists(wf):
            for k, v in json.load(open(wf)).items():
                wave_by_id.setdefault(int(k), v)
    print('distinct pulse timbres %d, noise %d, arp codes %d, wave tables %d'
          % (len(pulse), len(noise), len(arp), len(wave_by_id)))

    # --- wave tables: keep the most-used, dedup by content ---
    seen = {}
    for wid, n in waveuse.most_common():
        tb = wave_by_id.get(wid)
        if tb and tb not in seen:
            seen[tb] = n
        if len(seen) >= N_WAVE_TABLES * 4: break
    wave_tables = [t for t, _ in sorted(seen.items(), key=lambda kv: -kv[1])][:N_WAVE_TABLES]
    while len(wave_tables) < N_WAVE_TABLES:
        wave_tables.append('0123456789abcdeffedcba9876543210')
    wave_rank = {t: i for i, t in enumerate(wave_tables)}
    id_to_slot = {}
    for wid, tb in wave_by_id.items():
        if tb in wave_rank: id_to_slot[wid] = wave_rank[tb]

    # --- arpeggio tables: the most common ornament codes ---
    arp_codes = [c for c, _ in arp.most_common(N_ARP - 1)]
    def code_to_table(code):
        if code >= 128:
            x = code - 128
            a = (x // 3) - 24; b = (x % 3) - 24
            a = max(-12, min(12, a)); b = max(-12, min(12, b))
            return [0, a & 0xff, b & 0xff, 0, a & 0xff, b & 0xff, 0x80, 0]
        a = max(-12, min(12, code - 64 - 24))
        return [0, a & 0xff, 0, a & 0xff, 0x80, 0, 0, 0]
    arp_tables = [[0,0x80,0,0,0,0,0,0]] + [code_to_table(c) for c in arp_codes]
    while len(arp_tables) < N_ARP: arp_tables.append([0,0x80,0,0,0,0,0,0])
    arp_slot = {c: i + 1 for i, c in enumerate(arp_codes)}

    # --- instruments ---
    inst = []
    pulse_map = {}
    pulse_spec = []          # (duty, vol, dir, per, hasArp) for nearest match
    top_arp = [c for c, _ in arp.most_common(4)]
    for key, n in pulse.most_common():
        if len(inst) >= N_PULSE: break
        if key in pulse_map: continue
        d, vol, dr, per, has = key
        pulse_map[key] = len(inst)
        pulse_spec.append([d, vol, dr, per, has])
        env = (vol << 4) | (dr << 3) | per
        arpid = arp_slot.get(top_arp[0], 0xFF) if (has and top_arp) else 0xFF
        inst.append([(d & 3) << 6, env, arpid, 0])
    while len(inst) < N_PULSE:
        pulse_spec.append([2, 15, 1, 0, 0]); inst.append([0x80, 0xF0, 0xFF, 0])
    wave_map = {}
    for slot in range(N_WAVE_INST):
        wt = slot % max(1, len(wave_tables))
        wave_map[wt] = len(inst)
        inst.append([wt, 0, 0xFF, 0])
    noise_map = {}; noise_spec = []
    for (d, e), n in noise.most_common():
        if len(inst) >= N_PULSE + N_WAVE_INST + N_NOISE: break
        if (d, e) in noise_map: continue
        noise_map[(d, e)] = len(inst)
        noise_spec.append([d, (e >> 4) & 0x0f])
        inst.append([d & 0xff, e, 0xFF, 0])
    while len(inst) < N_PULSE + N_WAVE_INST + N_NOISE:
        noise_spec.append([0, 15]); inst.append([0x00, 0xF1, 0xFF, 0])

    out = dict(nInst=len(inst), instruments=inst, waveTables=wave_tables,
               arpTables=arp_tables,
               pulseMap={','.join(str(x) for x in k): v for k, v in pulse_map.items()},
               noiseMap={','.join(str(x) for x in k): v for k, v in noise_map.items()},
               waveIdToSlot={str(k): v for k, v in id_to_slot.items()},
               waveSlotToInst={str(k): v for k, v in wave_map.items()},
               arpSlot={str(k): v for k, v in arp_slot.items()},
               pulseSpec=pulse_spec, noiseSpec=noise_spec,
               pulseBase=0, noiseBase=N_PULSE + N_WAVE_INST)
    json.dump(out, open(OUT, 'w'), indent=1)
    tot = sum(pulse.values())
    covered = sum(n for k, n in pulse.items() if k in pulse_map)
    print('\ninstruments %d (pulse %d, wave %d, noise %d)' % (len(inst), N_PULSE, N_WAVE_INST, N_NOISE))
    print('pulse timbre coverage: %.1f%% of pulse notes hit an exact learned instrument'
          % (100*covered/max(1,tot)))
    print('wave tables kept %d; arp tables %d' % (len(wave_tables), len(arp_tables)))
    print('wrote %s' % OUT)

if __name__ == '__main__':
    main()
