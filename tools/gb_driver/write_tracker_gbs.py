"""Assemble a .gbs from the tracker driver blob + note events."""
import struct, os
HERE = os.path.dirname(os.path.abspath(__file__))
LOADADDR = 0x3000

def _syms(path):
    s = {}
    for ln in open(path, encoding='utf-8'):
        p = ln.split()
        if len(p) == 2 and ':' in p[0]:
            s[p[1]] = int(p[0].split(':')[1], 16)
    return s

SYM = _syms(os.path.join(HERE, 'tracker.sym'))
INIT, PLAY, SONG = SYM['Init'], SYM['Play'], SYM['Song']
BLOB = open(os.path.join(HERE, 'tracker.gb'), 'rb').read()
DRIVER = BLOB[LOADADDR:SONG]

def encode(events):
    """events: ('wait',n) | ('on',ch,note,inst) | ('off',ch)"""
    out = bytearray()
    for e in events:
        if e[0] == 'wait':
            n = int(e[1])
            while n > 0:
                step = min(127, n); out.append(step); n -= step
        elif e[0] == 'on':
            _, ch, note, inst = e
            out += bytes([0x80 | (ch & 3), int(note) & 0xff, int(inst) & 0xff])
        else:
            out.append(0x90 | (e[1] & 3))
    out.append(0x00)
    return bytes(out)

def build(events, title='Chiptunes', author='Chiptunes.app', copyright='2026'):
    data = DRIVER + encode(events)
    h = bytearray(0x70)
    h[0:3] = b'GBS'; h[3] = 1; h[4] = 1; h[5] = 1
    struct.pack_into('<HHHH', h, 6, LOADADDR, INIT, PLAY, 0xDFF0)
    h[0x0e] = 0; h[0x0f] = 0
    def put(off, s):
        b = s.encode('latin-1', 'replace')[:32]; h[off:off+len(b)] = b
    put(0x10, title); put(0x30, author); put(0x50, copyright)
    return bytes(h) + data

if __name__ == '__main__':
    R = 6                       # frames per 16th at ~150bpm
    ev = []
    # i-VI-III-VII in A minor, 4 bars, bass + arp chords + melody + drums
    prog = [(45,[57,60,64]), (41,[53,57,60]), (48,[60,64,67]), (43,[55,59,62])]
    mel  = [69,72,71,69,67,69,None,67, 65,67,69,None,64,65,67,None,
            72,71,72,74,72,71,None,69, 67,69,71,None,67,64,65,None]
    mi = 0
    for bar,(bass, chord) in enumerate(prog):
        for six in range(16):
            step = []
            if six == 0:
                step += [('off',2), ('on',2,bass,6)]          # wave bass
                step += [('on',1,chord[0],4)]                 # arpeggiated chord
            if six == 8:
                step += [('on',2,bass+12,6)]
            m = mel[mi % len(mel)]; mi += 1
            if m is not None:
                step += [('off',0), ('on',0,m,1)]
            if six % 4 == 0:
                step += [('on',3, 0x50 if six==0 else 0x30, 8 if six==0 else 10)]
            if six % 8 == 4:
                step += [('on',3,0x40,9)]
            ev += step + [('wait',R)]
    gbs = build(ev, title='Tracker Test')
    open(os.path.join(HERE,'tracker-test.gbs'),'wb').write(gbs)
    print('tracker-test.gbs %d bytes (driver %d, song %d)' % (len(gbs), len(DRIVER), len(gbs)-0x70-len(DRIVER)))
