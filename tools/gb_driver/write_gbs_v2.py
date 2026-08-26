"""Assemble a .gbs from driver v2 + learned instrument banks + note events."""
import struct, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
LOADADDR = 0x3000
N_INST, N_WAVE, N_ARP = 128, 16, 16   # must match tracker2.asm + tokenizer

def _syms(p):
    s = {}
    for ln in open(p, encoding='utf-8'):
        q = ln.split()
        if len(q) == 2 and ':' in q[0]:
            s[q[1]] = int(q[0].split(':')[1], 16)
    return s

def load_driver(driver_dir=None):
    d = driver_dir or HERE
    sym = _syms(os.path.join(d, 'tracker2.sym'))
    blob = bytearray(open(os.path.join(d, 'tracker2.gb'), 'rb').read())
    return blob, sym

def build(events, banks, path, title='Chiptunes', author='Chiptunes.app', driver_dir=None,
          tail=24):
    """events: (frame, ch, note, inst); banks: dict from learn_instruments.py

    `tail` is how many frames the final note of each channel is allowed to
    ring before it is released. The driver treats $00 as *restart*, not stop,
    so without an explicit release the last note on every channel sustains
    through the rest of the loop and across the seam into the next pass --
    audibly a drone under the whole song. Measured on the pretrain clips:
    a 4.2 s song read as 12 s of unbroken tone.
    """
    blob, sym = load_driver(driver_dir)
    inst_at, wave_at, arp_at, song_at = sym['Instruments'], sym['WaveTables'], sym['ArpTables'], sym['Song']
    # instrument bank
    for i, rec in enumerate(banks['instruments'][:N_INST]):
        for j in range(4):
            blob[inst_at + i * 4 + j] = rec[j] & 0xff
    # wave bank: 32 nibbles -> 16 bytes
    for i, hexs in enumerate(banks['waveTables'][:N_WAVE]):
        tb = bytes.fromhex(hexs)[:16]
        for j in range(16):
            blob[wave_at + i * 16 + j] = tb[j] if j < len(tb) else 0
    # arpeggio bank
    for i, tab in enumerate(banks['arpTables'][:N_ARP]):
        for j in range(8):
            blob[arp_at + i * 8 + j] = tab[j] & 0xff
    driver = bytes(blob[LOADADDR:song_at])
    out = bytearray(); prev = 0; live = set()
    for f, ch, note, inst in events:
        gap = int(f) - prev
        while gap > 0:
            step = min(127, gap); out.append(step); gap -= step
        prev = int(f)
        out += bytes([0x80 | (ch & 3), int(note) & 0xff, int(inst) & 0xff])
        live.add(ch & 3)
    if live:
        gap = int(tail)
        while gap > 0:
            step = min(127, gap); out.append(step); gap -= step
        for ch in sorted(live):
            out.append(0x90 | ch)
    out.append(0x00)
    h = bytearray(0x70)
    h[0:3] = b'GBS'; h[3] = 1; h[4] = 1; h[5] = 1
    struct.pack_into('<HHHH', h, 6, LOADADDR, sym['Init'], sym['Play'], 0xDFF0)
    h[0x0e] = 0; h[0x0f] = 0
    def put(off, s):
        b = (s or '').encode('latin-1', 'replace')[:32]; h[off:off+len(b)] = b
    put(0x10, title); put(0x30, author); put(0x50, 'Chiptunes.app 2026')
    open(path, 'wb').write(bytes(h) + driver + bytes(out))
    return len(out)
