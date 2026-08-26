#!/usr/bin/env bash
# Long-running static dev server for Chiptunes on :1338, kept alive by launchd
# (~/Library/LaunchAgents/app.chiptunes.dev.plist). Mirrors the dev-site
# daemon: deliberately minimal, with NO process enumeration (pkill/pgrep/lsof
# all hang on this machine when an SMB mount goes stale) -- we track our own
# child via a pidfile and health-check the port with curl. The pinned PATH
# carries python3 under launchd's bare environment.
#
# Manage:
#   launchctl kickstart -k gui/$(id -u)/app.chiptunes.dev   # restart now
#   tail -f /tmp/chiptunes-dev.err.log                      # watch logs
#   launchctl bootout  gui/$(id -u)/app.chiptunes.dev       # stop + unload

set -u
PORT=1338
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$ROOT" || exit 1

# Clear any orphan from a previous run via our own pidfile (no process
# enumeration of any kind here -- see header).
PIDFILE=/tmp/chiptunes-http.pid
if [ -f "$PIDFILE" ]; then
  kill -9 "$(cat "$PIDFILE")" 2>/dev/null
  rm -f "$PIDFILE"
  sleep 1
fi

# Loopback-only, and serve ONLY ./dist (the built app) — never the project root, so src/,
# build.js, AGENTS.md, .agents/ etc. are NOT exposed over :1338 / the tunnel.
# serve.py adds an SPA fallback (unknown paths -> dist/index.html) so /maze, /auto, /squadron ...
# open straight into that game; still rooted at dist (no path-traversal escape — see serve.py).
python3 "$ROOT/scripts/serve.py" "$PORT" "$ROOT/dist" &
SRV_PID=$!
echo "$SRV_PID" > "$PIDFILE"
trap 'kill "$SRV_PID" 2>/dev/null' EXIT

sleep 3 # boot grace (the static server is up almost instantly)
FAILS=0
while kill -0 "$SRV_PID" 2>/dev/null; do
  if curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/"; then
    FAILS=0
  else
    FAILS=$((FAILS + 1))
    echo "[watchdog] health check failed ($FAILS/3)" >&2
    if [ "$FAILS" -ge 3 ]; then
      echo "[watchdog] http.server unresponsive on :$PORT, restarting" >&2
      kill -9 "$SRV_PID" 2>/dev/null
      exit 1
    fi
  fi
  sleep 20
done

echo "[watchdog] http.server exited, handing back to launchd" >&2
exit 1
