"""Assemble a valid .gbs from the driver blob + a register-event song."""
import struct, os

HERE = os.path.dirname(os.path.abspath(__file__))
LOADADDR = 0x3000
SYMS = {}
for ln in open(os.path.join(HERE, 'driver.sym'), encoding='utf-8'):
    p = ln.split()
    if len(p) == 2 and ':' in p[0]:
        SYMS[p[1]] = int(p[0].split(':')[1], 16)
INIT, PLAY, SONG = SYMS['Init'], SYMS['Play'], SYMS['Song']
BLOB = open(os.path.join(HERE, 'driver.gb'), 'rb').read()
DRIVER = BLOB[LOADADDR:SONG]          # code only, up to the Song label

def song_bytes(events):
    """events: list of ('wait', n) | ('w', reg_off, value)  reg_off from $FF10"""
    out = bytearray()
    for e in events:
        if e[0] == 'wait':
            n = int(e[1])
            while n > 0:
                step = min(127, n)
                out.append(step)
                n -= step
        else:
            _, reg, val = e
            assert 0 <= reg <= 0x2f, reg
            out.append(0x80 | reg)
            out.append(int(val) & 0xff)
    out.append(0x00)                  # end -> driver restarts
    return bytes(out)

def build(events, title='Chiptunes', author='Chiptunes.app', copyright='2026'):
    data = DRIVER + song_bytes(events)
    h = bytearray(0x70)
    h[0:3] = b'GBS'
    h[3] = 1                                   # version
    h[4] = 1                                   # songs
    h[5] = 1                                   # first song
    struct.pack_into('<HHHH', h, 6, LOADADDR, INIT, PLAY, 0xDFF0)
    h[0x0e] = 0                                # TMA
    h[0x0f] = 0                                # TAC: VBlank timing
    def put(off, s):
        b = s.encode('latin-1', 'replace')[:32]
        h[off:off+len(b)] = b
    put(0x10, title); put(0x30, author); put(0x50, copyright)
    return bytes(h) + data

if __name__ == '__main__':
    # a C major scale on pulse1 -- just enough to prove the chain end to end
    NOTES = [(0x83,0x2f),(0x86,0x2f),(0x89,0x2f),(0x8b,0x2f),
             (0x8e,0x2f),(0x90,0x2f),(0x92,0x2f),(0x93,0x2f)]
    freqs = [1046,1102,1155,1181,1228,1272,1291,1331]   # rough C4..C5 in GB freq regs
    ev = [('w', 0x16, 0x80), ('w', 0x15, 0xff), ('w', 0x14, 0x77)]   # NR52/NR51/NR50
    for f in freqs:
        ev += [('w', 0x01, 0x80),          # NR11 duty 50%
               ('w', 0x02, 0xf0),          # NR12 env: vol 15, no decay
               ('w', 0x03, f & 0xff),      # NR13 freq lo
               ('w', 0x04, 0x80 | ((f >> 8) & 7)),   # NR14 trigger + freq hi
               ('wait', 20)]
    ev.append(('wait', 40))
    gbs = build(ev, title='Scale Test')
    open(os.path.join(HERE, 'test.gbs'), 'wb').write(gbs)
    print('wrote test.gbs  %d bytes  (driver %d, song %d)' % (len(gbs), len(DRIVER), len(gbs)-0x70-len(DRIVER)))
    print('INIT $%04x  PLAY $%04x  SONG $%04x' % (INIT, PLAY, SONG))
