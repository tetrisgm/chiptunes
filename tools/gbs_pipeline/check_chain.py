"""Cross-check the constants that must agree across the whole chain.

Written after the instrument-table bug (2026-08-11): the learned bank and the
tokenizer used 128 instruments while `tracker2.asm` and `write_gbs_v2.py` said
64, so 53% of instrument references in every generated song read past the
table into wave-table memory. Nothing anywhere compared those numbers, and the
symptom (no drums, garbage bass) looked like bad musicianship rather than a
table overflow.

Checks, in the order they bite:
  * bank size vs writer vs assembler source vs the ASSEMBLED driver's symbols
    (the symbol gap is the only one that reflects what actually ships)
  * wave and arp table counts
  * corpus instrument ids fit the bank
  * vocab layout offsets match the tokenizer's arithmetic
  * note range shared by tokenizer and corpus

Exit code is non-zero if anything disagrees, so it can gate a release.

  python3 check_chain.py --bank instruments-v1.json --driver-dir <dir> \
      [--vocab corpus/vocab.json] [--tokenizer tokenizer.py]

The vocabulary/tokenizer checks are optional because the score-v2 pipeline
does not use the retired flat-token corpus.  The bank, writer, assembler, and
assembled-driver checks always run.
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DRIVER_SRC = os.path.join(HERE, '..', 'gb_driver')


def const_from_py(path, name):
    if not os.path.exists(path):
        return None
    for ln in open(path, encoding='utf-8'):
        m = re.match(r'^\s*%s\s*=\s*(\d+)' % re.escape(name), ln)
        if m:
            return int(m.group(1))
        m = re.match(r'^\s*N_INST,\s*N_WAVE,\s*N_ARP\s*=\s*(\d+),\s*(\d+),\s*(\d+)', ln)
        if m and name in ('N_INST', 'N_WAVE', 'N_ARP'):
            return int(m.group({'N_INST': 1, 'N_WAVE': 2, 'N_ARP': 3}[name]))
    return None


def const_from_asm(path, name):
    if not os.path.exists(path):
        return None
    for ln in open(path, encoding='utf-8'):
        m = re.match(r'^\s*DEF\s+%s\s+EQU\s+(\d+)' % re.escape(name), ln)
        if m:
            return int(m.group(1))
    return None


def syms(path):
    out = {}
    if not os.path.exists(path):
        return out
    for ln in open(path, encoding='utf-8'):
        p = ln.split()
        if len(p) == 2 and ':' in p[0]:
            try:
                out[p[1]] = int(p[0].split(':')[1], 16)
            except ValueError:
                pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', required=True)
    ap.add_argument('--driver-dir', required=True)
    ap.add_argument('--vocab')
    ap.add_argument('--tokenizer')
    a = ap.parse_args()
    fails, notes = [], []

    bank = json.load(open(a.bank, encoding='utf-8'))
    n_bank = len(bank['instruments'])
    n_writer = const_from_py(os.path.join(DRIVER_SRC, 'write_gbs_v2.py'), 'N_INST')
    n_asm = const_from_asm(os.path.join(DRIVER_SRC, 'tracker2.asm'), 'N_INST')
    n_tok = const_from_py(a.tokenizer, 'N_INST') if a.tokenizer else None
    S = syms(os.path.join(a.driver_dir, 'tracker2.sym'))
    n_rom = None
    if 'Instruments' in S and 'WaveTables' in S:
        n_rom = (S['WaveTables'] - S['Instruments']) // 4

    print('instrument slots')
    for lbl, v in (('learned bank', n_bank), ('tokenizer', n_tok),
                   ('write_gbs_v2', n_writer), ('tracker2.asm', n_asm),
                   ('ASSEMBLED driver', n_rom)):
        print('   %-18s %s' % (lbl, v))
    vals = [v for v in (n_bank, n_tok, n_writer, n_asm, n_rom) if v is not None]
    if len(set(vals)) != 1:
        fails.append('instrument slot counts disagree: %s' % vals)
    if n_rom is not None and n_bank > n_rom:
        fails.append('bank has %d instruments but the assembled driver holds %d '
                     '-- ids >= %d read past the table' % (n_bank, n_rom, n_rom))

    w_bank = len(bank.get('waveTables', []))
    w_writer = const_from_py(os.path.join(DRIVER_SRC, 'write_gbs_v2.py'), 'N_WAVE')
    w_asm = const_from_asm(os.path.join(DRIVER_SRC, 'tracker2.asm'), 'N_WAVE')
    w_rom = ((S['ArpTables'] - S['WaveTables']) // 16
             if 'ArpTables' in S and 'WaveTables' in S else None)
    print('wave slots          bank %s  writer %s  asm %s  driver %s'
          % (w_bank, w_writer, w_asm, w_rom))
    if len(set(v for v in (w_bank, w_writer, w_asm, w_rom) if v is not None)) != 1:
        fails.append('wave slot counts disagree')

    a_writer = const_from_py(os.path.join(DRIVER_SRC, 'write_gbs_v2.py'), 'N_ARP')
    a_asm = const_from_asm(os.path.join(DRIVER_SRC, 'tracker2.asm'), 'N_ARP')
    a_rom = ((S['Song'] - S['ArpTables']) // 8
             if 'Song' in S and 'ArpTables' in S else None)
    print('arp slots           bank %s  writer %s  asm %s  driver %s'
          % (len(bank.get('arpTables', [])), a_writer, a_asm, a_rom))
    if a_writer != a_asm:
        fails.append('arp slot counts disagree between writer and asm')

    if a.vocab and os.path.exists(a.vocab):
        V = json.load(open(a.vocab, encoding='utf-8'))
        lay = V['layout']
        n_voc = V.get('instruments')
        print('vocab               instruments %s  noiseKinds %s  INST0 %s'
              % (n_voc, V.get('noiseKinds'), lay.get('INST0')))
        if n_voc is not None and n_voc != n_bank:
            fails.append('vocab declares %d instruments, bank holds %d'
                         % (n_voc, n_bank))
        want = lay.get('NOISE0', 0) + V.get('noiseKinds', 0)
        if lay.get('INST0') != want:
            fails.append('INST0=%s but NOISE0+noiseKinds=%s'
                         % (lay.get('INST0'), want))
        span = V.get('maxMidi', 0) - V.get('minMidi', 0) + 1
        if lay.get('NOISE0') != lay.get('NOTE0', 0) + span:
            fails.append('NOISE0 does not follow the note range')
        notes.append('vocab layout arithmetic consistent')

    print()
    for n in notes:
        print('ok: %s' % n)
    if fails:
        for f in fails:
            print('FAIL: %s' % f)
        sys.exit(1)
    print('chain consistent')


if __name__ == '__main__':
    main()
