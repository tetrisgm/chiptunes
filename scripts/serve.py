#!/usr/bin/env python3
# Static server for Chiptunes.app with SPA FALLBACK so clean per-game URLs work:
# /maze, /auto, /squadron ... all resolve to the single-page app (dist/index.html),
# while real files (/, /favicon.ico if any) are served normally.
#
# PACK/LIB HONESTY: missing paths under /packs/ and /lib/ return a REAL 404 instead
# of the SPA shell. The pack loader probes those trees for manifests/archives; a
# fallback-200 HTML body would poison JSON/binary parses. Scoped to those two
# prefixes ONLY — a global "path has a dot => 404" heuristic would break album deep
# links (67 current album dirs contain dots).
#
# SECURITY: serves ONLY the given directory (dist) — SimpleHTTPRequestHandler is
# rooted there and sanitises '..', so src/, build.js, AGENTS.md, .agents/ are never
# exposed. The fallback only ever returns dist/index.html for a missing path; it can
# never reach outside dist. Loopback bind only (the cloudflared tunnel fronts it).
#
# Usage: serve.py <port> <directory>
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1338
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "dist"
NO_FALLBACK_PREFIXES = ("/packs/", "/lib/")


class BurstServer(ThreadingHTTPServer):
    # The pack loader opens 30+ connections in one burst. socketserver's default
    # listen backlog is 5, so the OS refuses the overflow (connection reset) and a
    # random subset of games vanishes each load. A deep backlog absorbs the burst.
    daemon_threads = True
    request_queue_size = 256


class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def send_head(self):
        # translate_path() strips ?query/#frag and is confined to DIRECTORY.
        local = self.translate_path(self.path)
        # Existing file or a directory with its own index -> serve it normally.
        if os.path.isdir(local) or os.path.exists(local):
            return super().send_head()
        # Missing pack/lib assets must 404 honestly (loader relies on it).
        clean = self.path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith(NO_FALLBACK_PREFIXES):
            self.send_error(404, "Not Found")
            return None
        # Otherwise it's an app route (e.g. /maze, /auto) -> serve the SPA shell.
        self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        # NEVER cache: this is a live-dev radio that's rebuilt constantly. Without this, browsers
        # heuristically cache the big inline-bundle HTML and a reload silently serves STALE code
        # (you change the music, the listener hears the old version). no-store forces a fresh fetch
        # every load. The app HTML is tiny-to-fetch and all JS is inlined, so there's no perf cost.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    # BurstServer = ThreadingHTTPServer with a deep listen backlog. The pack
    # loader fetches every pack.js/pack.json in one concurrent burst (30+ at
    # once); the stock server (single-threaded, backlog 5) refused most of the
    # burst, so cloudflared returned 502 for a random subset every load and a
    # different handful of games "disappeared" each refresh.
    httpd = BurstServer(("127.0.0.1", PORT), SPAHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
