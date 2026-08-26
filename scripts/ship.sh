#!/usr/bin/env bash
# One bounded Chiptunes delivery pass. app.chiptunes.autorelease chooses local or
# public mode after the source tip settles.
#
# Two independent surfaces, each shipped ONLY when its inputs changed since the last ship:
#   - web + box  (chiptunes.app + the Oracle broadcaster/video leg)  <- src/ build.js packs/ broadcast/ lib/
#   - desktop app (signed+notarized .app to /Applications + dmg/zip)    <- src/ build.js packs/ desktop/
# (the desktop app embeds the web bundle, so src/build/packs changes affect both.)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
RUN_CAPPED="${CHIPTUNES_RUN_CAPPED:-$HOME/dev/stack/bin/run-capped}"
[ -x "$RUN_CAPPED" ] || exit 1

# PIPELINE MUTEX: a ship must never run while another delivery process owns the
# tree. The stale-safe PID lock defers the loser for the next controller pass. If the
# lock's owner PID is dead, reclaim it, so a crashed holder can never deadlock the pipeline forever.
PIPELOCK=/tmp/chiptunes-pipeline.lock
_acquire_pipe(){
  if mkdir "$PIPELOCK" 2>/dev/null; then echo $$ > "$PIPELOCK/pid"; return 0; fi
  local o; o="$(cat "$PIPELOCK/pid" 2>/dev/null || echo)"
  if [ -n "$o" ] && ! kill -0 "$o" 2>/dev/null; then
    rm -rf "$PIPELOCK" 2>/dev/null
    if mkdir "$PIPELOCK" 2>/dev/null; then echo $$ > "$PIPELOCK/pid"; return 0; fi
  elif [ -z "$o" ] && [ -n "$(find "$PIPELOCK" -prune -mmin +1 -print 2>/dev/null)" ]; then
    rm -rf "$PIPELOCK" 2>/dev/null
    if mkdir "$PIPELOCK" 2>/dev/null; then echo $$ > "$PIPELOCK/pid"; return 0; fi
  fi
  return 1
}
if ! _acquire_pipe; then
  echo "[ship] pipeline busy (codex pass editing the tree) — deferring; daemon retries in 5 min."
  # EX_TEMPFAIL tells the daemon this run did not ship. Returning success here
  # made it advance last-shipped-source and permanently skip the deferred work.
  exit 75
fi
trap '[ "$(cat "$PIPELOCK/pid" 2>/dev/null || echo)" = "$$" ] && rm -rf "$PIPELOCK" 2>/dev/null || true' EXIT

STATE_DIR="${CHIPTUNES_RELEASE_STATE:-$HOME/.config/chiptunes-release}"
mkdir -p "$STATE_DIR"
[ -f "$STATE_DIR/env" ] && . "$STATE_DIR/env"
MARK="$STATE_DIR/last-shipped-source"
last="${CHIPTUNES_RELEASE_BASELINE:-$(cat "$MARK" 2>/dev/null || echo "")}"
MODE="${CHIPTUNES_DELIVERY_MODE:-public}"
case "$MODE" in local|public) ;; *) echo "invalid CHIPTUNES_DELIVERY_MODE: $MODE" >&2; exit 2 ;; esac

# changed <pathspec...> : true if any of these paths changed since the last ship (or if first ever ship)
changed() { [ -z "$last" ] && return 0; ! git diff --quiet "$last"..HEAD -- "$@"; }

WEB_BUNDLE_PATHS=(src build.js packs docs assets scripts/game-roster.cjs scripts/lib)
WEB_PATHS=("${WEB_BUNDLE_PATHS[@]}" lib broadcast)
# Delivery/test scripts are intentionally excluded: release-mac.sh-only changes
# produced an identical notarized binary. These are artifact-byte inputs only.
DESKTOP_PATHS=(
  "${WEB_BUNDLE_PATHS[@]}"
  desktop/package.json desktop/package-lock.json desktop/main.js desktop/preload.js
  desktop/power.js desktop/settings.js desktop/tray.js desktop/wallpaper.js
  desktop/assets desktop/native desktop/binding.gyp desktop/entitlements.mac.plist
  desktop/steam_appid.txt desktop/scripts/build-native.js
)
did=0
WEB_BUNDLE_READY=0

if changed "${WEB_PATHS[@]}"; then
  if [ "$MODE" = "local" ]; then
    echo "[ship] web bundle: building locally"
    "$RUN_CAPPED" --seconds "${CHIPTUNES_WEB_BUILD_MAX_SECS:-1800}" --grace 30 \
      --label chiptunes-web-local -- npm run build
    WEB_BUNDLE_READY=1
    did=1
  else
  echo "[ship] web+box: deploying (chiptunes.app + broadcaster box)…"
  # Retry transient failures. `wrangler pages deploy` intermittently fails with "The request to
  # Cloudflare's API timed out" — a network flake that used to fail the whole ship and pause the
  # daemon (drift). The deploy is idempotent (re-run redeploys the same bytes; deploy-box only
  # restarts the stream when a file actually changed), so retry a few times with a cooldown; only a
  # persistent failure fails the ship.
  n=0
  until "$RUN_CAPPED" --seconds "${CHIPTUNES_WEB_SHIP_MAX_SECS:-3600}" --grace 30 --label chiptunes-web -- npm run deploy; do
    n=$((n + 1))
    if [ "$n" -ge 3 ]; then echo "[ship] web+box: deploy still failing after $n attempts — real failure" >&2; exit 1; fi
    echo "[ship] web+box: deploy attempt $n failed (transient?) — retrying in 25s…"; sleep 25
  done
  WEB_BUNDLE_READY=1
  did=1
  fi
else
  echo "[ship] web+box: no relevant changes, skipping"
fi

if changed "${DESKTOP_PATHS[@]}"; then
  if [ "$MODE" = "local" ]; then
    echo "[ship] desktop: building and installing locally"
    "$RUN_CAPPED" --seconds "${CHIPTUNES_DESKTOP_LOCAL_MAX_SECS:-3600}" --grace 30 \
      --label chiptunes-desktop-local -- \
      env CHIPTUNES_WEB_BUNDLE_READY="$WEB_BUNDLE_READY" \
      "$REPO/desktop/scripts/install-local-mac.sh"
    echo "[ship] desktop installed locally"
    did=1
  else
  # The version bump is committed before the expensive signed/notarized build. If launchd or the
  # machine interrupts that build, HEAD remains the auto-ship commit while last-shipped-source stays
  # behind it. Resume that exact version on retry instead of burning another version and notarization.
  head_subject="$(git log -1 --format=%s)"
  if [[ "$head_subject" =~ ^desktop:\ v([0-9]+\.[0-9]+\.[0-9]+)\ \[auto-ship\]$ ]] \
     && [ "${BASH_REMATCH[1]}" = "$(node -p "require('./desktop/package.json').version")" ]; then
    ver="${BASH_REMATCH[1]}"
    echo "[ship] desktop: resuming interrupted v${ver} release (signed/notarized)…"
  else
    echo "[ship] desktop: bump + release (signed/notarized)…"
    node -e "const f='desktop/package.json',d=require('./'+f);const p=d.version.split('.');p[2]=String(+p[2]+1);d.version=p.join('.');require('fs').writeFileSync(f,JSON.stringify(d,null,2)+'\n')"
    ver="$(node -p "require('./desktop/package.json').version")"
    git add desktop/package.json
    git commit -q -m "desktop: v${ver} [auto-ship]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  fi
  "$RUN_CAPPED" --seconds "${CHIPTUNES_DESKTOP_SHIP_MAX_SECS:-10800}" --grace 30 --label chiptunes-desktop -- \
    env APP_NOTARY_PROFILE="${APP_NOTARY_PROFILE:-pp-notary}" \
    CHIPTUNES_WEB_BUNDLE_READY="$WEB_BUNDLE_READY" npm --prefix desktop run release:mac
  "$RUN_CAPPED" --seconds 300 --grace 10 --label chiptunes-push -- git push origin main
  echo "[ship] desktop v${ver} released + installed"
  did=1
  fi
else
  echo "[ship] desktop: no relevant changes, skipping"
fi

[ "$did" = 1 ] && echo "[ship] $MODE delivery done" || echo "[ship] nothing to deliver"
