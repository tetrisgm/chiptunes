"""Zero-export review server: rate in the browser, the session just knows.

  python3 review_server.py --batch <dir> [--port 8377]

Serves the review page at http://127.0.0.1:<port>/ with audio streamed from
the batch dir (no 16MB embed limit) and every keypress POSTed back:

  GET  /          the page (LIVE mode)
  GET  /audio/<f> a track
  GET  /verdicts  {"track-01": 3, ...} current state (page hydrates from this)
  POST /verdict   {"id": "track-01", "grade": 3} -> appended to
                  <batch>/verdicts.jsonl with utc + source label from key.json

The batch dir is typically a symlink (review-batches/current) repointed for
each new batch; restart the server after repointing. Localhost only.
"""
import argparse, json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from review_page import build_html

GRADES = range(1, 10)          # 1-9; see review_page.py for why


def load_state(batch):
    state = {}
    p = os.path.join(batch, 'verdicts.jsonl')
    if os.path.exists(p):
        for ln in open(p, encoding='utf-8'):
            try:
                r = json.loads(ln)
                state[r['id']] = r['grade']
            except (ValueError, KeyError):
                pass
    return state


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--batch', required=True)
    ap.add_argument('--port', type=int, default=8377)
    a = ap.parse_args()
    batch = os.path.realpath(a.batch)
    bid = os.path.basename(batch)
    # an A/B batch ships its own page (pairs.json + index.html); a grading
    # batch has its page generated from the mp3s in the dir
    idx = os.path.join(batch, 'index.html')
    if os.path.exists(idx):
        html = open(idx, encoding='utf-8').read()
        n = len(json.load(open(os.path.join(batch, 'pairs.json'))))
    else:
        html, n = build_html(batch, bid, 'serve')
    state = load_state(batch)
    key = {}
    kp = os.path.join(batch, 'key.json')
    if os.path.exists(kp):
        key = json.load(open(kp))
    log = open(os.path.join(batch, 'verdicts.jsonl'), 'a', encoding='utf-8')

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code, body, ctype='application/json'):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/' or self.path.startswith('/?'):
                self._send(200, html.encode(), 'text/html; charset=utf-8')
            elif self.path == '/verdicts':
                self._send(200, json.dumps(state).encode())
            elif self.path.startswith('/audio/'):
                f = os.path.basename(self.path[len('/audio/'):])
                p = os.path.join(batch, f)
                if os.path.isfile(p) and f.endswith(('.mp3', '.flac')):
                    self._send(200, open(p, 'rb').read(),
                               'audio/flac' if f.endswith('.flac') else 'audio/mpeg')
                else:
                    self._send(404, b'{}')
            else:
                self._send(404, b'{}')

        def do_POST(self):
            if self.path != '/verdict':
                return self._send(404, b'{}')
            try:
                ln = int(self.headers.get('Content-Length', 0))
                r = json.loads(self.rfile.read(ln))
                tid = str(r['id'])
                if 'choice' in r:
                    g = str(r['choice'])
                    assert g in ('a', 'b', 'tie')
                else:
                    g = int(r['grade'])
                    assert g in GRADES
            except Exception:
                return self._send(400, b'{"ok":false}')
            state[tid] = g
            log.write(json.dumps(dict(
                file=tid, id=tid, grade=g,
                source=key.get(tid, ''),
                utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))) + '\n')
            log.flush()
            self._send(200, b'{"ok":true}')

    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    print('review server: batch %s (%d tracks, %d rated) on '
          'http://127.0.0.1:%d/' % (bid, n, len(state), a.port), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
