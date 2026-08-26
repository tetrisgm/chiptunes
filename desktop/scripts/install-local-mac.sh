#!/usr/bin/env bash
# Build, Developer ID sign, verify, and atomically install a local Chiptunes app.
# This lane intentionally does not package, notarize, upload, or publish.
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."

if [ "${CHIPTUNES_WEB_BUNDLE_READY:-0}" != "1" ]; then
  node ../build.js
fi

npm run check
npm run test:desktop
npm run build:native:arm64
npm run test:native
rm -rf dist/mac-arm64
./node_modules/.bin/electron-builder --mac dir --arm64

APP="$PWD/dist/mac-arm64/Chiptunes.app"
INSTALL="/Applications/Chiptunes.app"
LEGACY="/Applications/Chiptunes.app"
STAGED="/Applications/.Chiptunes.app.new.$$"
PREVIOUS="/Applications/.Chiptunes.app.previous.$$"

[ -d "$APP" ] || { echo "missing built app: $APP" >&2; exit 1; }
codesign --verify --deep --strict "$APP"

running_pids() {
  ps ax -o pid=,command= | awk \
    '$2 == "/Applications/Chiptunes.app/Contents/MacOS/Chiptunes" ||
     $2 == "/Applications/Chiptunes.app/Contents/MacOS/Chiptunes" {print $1}'
}

WAS_RUNNING=0
[ -z "$(running_pids)" ] || WAS_RUNNING=1
rm -rf "$STAGED" "$PREVIOUS"
ditto "$APP" "$STAGED"

osascript -e 'tell application "Chiptunes" to quit' >/dev/null 2>&1 || true
osascript -e 'tell application "Chiptunes" to quit' >/dev/null 2>&1 || true
for _ in {1..20}; do
  [ -z "$(running_pids)" ] && break
  sleep 0.25
done
PIDS="$(running_pids)"
[ -z "$PIDS" ] || kill -TERM $PIDS 2>/dev/null || true
for _ in {1..20}; do
  [ -z "$(running_pids)" ] && break
  sleep 0.25
done
[ -z "$(running_pids)" ] || {
  rm -rf "$STAGED"
  echo "Chiptunes did not stop before local installation" >&2
  exit 1
}

[ ! -e "$INSTALL" ] || mv "$INSTALL" "$PREVIOUS"
if ! mv "$STAGED" "$INSTALL"; then
  [ ! -e "$PREVIOUS" ] || mv "$PREVIOUS" "$INSTALL"
  exit 1
fi
rm -rf "$LEGACY"
if ! codesign --verify --deep --strict "$INSTALL"; then
  rm -rf "$INSTALL"
  [ ! -e "$PREVIOUS" ] || mv "$PREVIOUS" "$INSTALL"
  exit 1
fi
rm -rf "$PREVIOUS"
[ "$WAS_RUNNING" = "0" ] || open -g "$INSTALL"
