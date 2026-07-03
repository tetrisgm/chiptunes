#!/usr/bin/env python3
# Static server for Retro Rave Radio with SPA FALLBACK so clean per-game URLs work:
# /pacman, /auto, /galaga ... all resolve to the single-page app (dist/index.html),
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
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1338
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "dist"
NO_FALLBACK_PREFIXES = ("/packs/", "/lib/")


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
        # Otherwise it's an app route (e.g. /pacman, /auto) -> serve the SPA shell.
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
    httpd = HTTPServer(("127.0.0.1", PORT), SPAHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
