#!/usr/bin/env python3
"""Terminal rater: get through a listening batch at a couple hundred verdicts
an hour. Chat is fine for 12 clips; it is not a tool for thousands.

  python3 rate.py <batch-dir>

Plays each unrated mp3 (afplay) and takes one keypress:

  k / y  keep          n  reject        m  maybe
  f      favorite (a keep with a star -- the SFT set weights these up)
  r      replay        s  skip for now  q  quit (progress is saved)

Verdicts append to <batch-dir>/verdicts.jsonl, one JSON object per line:
  {"file": ..., "verdict": "keep|reject|maybe|favorite", "utc": ...}
Re-running skips already-rated files, so sessions can stop anytime.
"""
import glob, json, os, subprocess, sys, termios, time, tty


def one_key():
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        return sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    batch = sys.argv[1]
    outp = os.path.join(batch, 'verdicts.jsonl')
    done = set()
    if os.path.exists(outp):
        for ln in open(outp, encoding='utf-8'):
            try:
                done.add(json.loads(ln)['file'])
            except (ValueError, KeyError):
                pass
    files = sorted(os.path.basename(p)
                   for p in glob.glob(os.path.join(batch, '*.mp3')))
    todo = [f for f in files if f not in done]
    if not todo:
        print('nothing unrated in %s (%d already done)' % (batch, len(done)))
        return
    print('%d to rate (%d already done). k=keep n=reject m=maybe '
          'f=favorite r=replay s=skip q=quit' % (len(todo), len(done)))
    verdicts = {'k': 'keep', 'y': 'keep', 'n': 'reject', 'm': 'maybe',
                'f': 'favorite'}
    kept = 0
    out = open(outp, 'a', encoding='utf-8')
    for i, f in enumerate(todo, 1):
        path = os.path.join(batch, f)
        while True:
            player = subprocess.Popen(['afplay', path])
            print('[%d/%d  keeps %d] %s > ' % (i, len(todo), kept, f),
                  end='', flush=True)
            c = one_key().lower()
            player.terminate()
            print(c)
            if c == 'r':
                continue
            if c == 's':
                break
            if c == 'q':
                out.close()
                print('saved %s' % outp)
                return
            if c in verdicts:
                v = verdicts[c]
                if v in ('keep', 'favorite'):
                    kept += 1
                out.write(json.dumps(dict(file=f, verdict=v,
                                          utc=time.strftime('%Y-%m-%dT%H:%M:%SZ',
                                                            time.gmtime())))
                          + '\n')
                out.flush()
                break
    out.close()
    print('done. saved %s' % outp)


if __name__ == '__main__':
    main()
