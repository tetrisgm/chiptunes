#!/usr/bin/env bash
# Owner-facing arm64 release: verify -> build/sign -> notarize once -> staple/package -> install.
set -euo pipefail
cd "$(dirname "$0")/.."
exec < /dev/null
RUN_CAPPED="${CHIPTUNES_RUN_CAPPED:-$HOME/dev/stack/bin/run-capped}"
[ -x "$RUN_CAPPED" ] || exit 1
if [ "${CHIPTUNES_DESKTOP_RELEASE_CAPPED:-0}" != 1 ]; then
  export CHIPTUNES_DESKTOP_RELEASE_CAPPED=1
  exec "$RUN_CAPPED" --seconds "${CHIPTUNES_DESKTOP_RELEASE_MAX_SECS:-10800}" --grace 30 \
    --label chiptunes-desktop-release -- "$0" "$@"
fi

PROFILE="${APP_NOTARY_PROFILE:-pp-notary}"
VERSION="$(node -p "require('./package.json').version")"
APP="dist/mac-arm64/Chiptunes.app"
ZIP="dist/Chiptunes-${VERSION}-arm64.zip"
DMG="dist/Chiptunes-${VERSION}-arm64.dmg"
NOTARY_RESULT="dist/.notary-${VERSION}-arm64.json"
UPDATE_YML="dist/latest-mac.yml"
ZIP_VERIFY_DIR=""

cleanup() {
  if [[ -n "$ZIP_VERIFY_DIR" ]]; then
    rm -rf "$ZIP_VERIFY_DIR"
  fi
}
trap cleanup EXIT

notary_value() {
  local key="$1"
  /usr/bin/plutil -extract "$key" raw "$NOTARY_RESULT" 2>/dev/null || true
}

print_notary_log() {
  local submission_id="$1"
  local log_file="dist/notary-${submission_id}.json"

  if [[ -z "$submission_id" ]]; then
    echo "Notary submission failed before Apple returned a submission ID." >&2
    return
  fi

  echo "Notary submission ${submission_id} failed; fetching Apple's log:" >&2
  if xcrun notarytool log "$submission_id" --keychain-profile "$PROFILE" "$log_file"; then
    cat "$log_file" >&2
  else
    echo "Could not fetch the notary log for ${submission_id}." >&2
  fi
}

echo "Running local checks and builds..."
# Dependency auditing is advisory maintenance, not a release gate. Keep this
# path limited to tests plus build, signing, notarization, and Gatekeeper checks.
WEB_BUILD_PID=""
if [ "${CHIPTUNES_WEB_BUNDLE_READY:-0}" != "1" ]; then
  node ../build.js &
  WEB_BUILD_PID=$!
fi
npm run build:native:arm64 &
NATIVE_BUILD_PID=$!
npm run check &
CHECK_PID=$!
npm run test:desktop &
DESKTOP_TEST_PID=$!

LOCAL_FAILURE=0
JOBS=(
  "$NATIVE_BUILD_PID:native build"
  "$CHECK_PID:syntax checks"
  "$DESKTOP_TEST_PID:desktop tests"
)
if [ -n "$WEB_BUILD_PID" ]; then
  JOBS=("$WEB_BUILD_PID:web build" "${JOBS[@]}")
fi
for job in "${JOBS[@]}"
do
  pid="${job%%:*}"
  name="${job#*:}"
  if ! wait "$pid"; then
    echo "ERROR: ${name} failed." >&2
    LOCAL_FAILURE=1
  fi
done
if (( LOCAL_FAILURE != 0 )); then
  exit 1
fi

npm run test:native

rm -rf "$APP"
rm -f "$DMG" "$ZIP" "$DMG.blockmap" "$ZIP.blockmap" "$NOTARY_RESULT" "$UPDATE_YML"
# Build the DMG target up front instead of a bare directory. electron-builder only injects
# Resources/app-update.yml when an update-capable mac target (DMG or ZIP) is present; this keeps the
# signed app update-aware without adding a second packaging/signing pass.
./node_modules/.bin/electron-builder --mac dmg --arm64

codesign --verify --deep --strict "$APP"
SIGNING_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
printf '%s\n' "$SIGNING_INFO"
if [[ "$SIGNING_INFO" != *"Authority=Developer ID Application:"* ]]; then
  echo "ERROR: app is not signed with a Developer ID Application identity." >&2
  exit 1
fi
if [[ "$SIGNING_INFO" != *"runtime"* ]]; then
  echo "ERROR: hardened runtime is not enabled on the signed app." >&2
  exit 1
fi

# One DMG submission creates tickets for both the DMG and its nested app. After
# acceptance, staple both from that submission; ZIP cannot itself be stapled,
# so create it afterward from the stapled app.
# electron-builder leaves the .dmg itself UNSIGNED (only the app inside is signed). An unsigned dmg
# has no primary signature for `spctl -t open` to assess (it reports "no usable signature"), and a
# signed dmg is cleaner for distribution integrity. Sign it with the SAME Developer ID the app uses,
# derived from the app's own signature, BEFORE notarizing (notarization then covers the signed dmg).
SIGN_IDENTITY="$(codesign -dvv "$APP" 2>&1 | sed -n 's/^Authority=\(Developer ID Application:.*\)$/\1/p' | head -1)"
if [[ -z "$SIGN_IDENTITY" ]]; then
  echo "ERROR: could not determine the app's Developer ID signing identity to sign the DMG." >&2
  exit 1
fi
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
hdiutil verify "$DMG"

echo "Submitting DMG once for notarization..."
if ! xcrun notarytool submit "$DMG" \
  --keychain-profile "$PROFILE" \
  --wait \
  --output-format json >"$NOTARY_RESULT"
then
  cat "$NOTARY_RESULT" >&2 || true
  print_notary_log "$(notary_value id)"
  exit 1
fi
cat "$NOTARY_RESULT"

SUBMISSION_ID="$(notary_value id)"
NOTARY_STATUS="$(notary_value status)"
if [[ "$NOTARY_STATUS" != "Accepted" ]]; then
  echo "ERROR: unexpected notarization status: ${NOTARY_STATUS:-missing}" >&2
  print_notary_log "$SUBMISSION_ID"
  exit 1
fi

xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
rm -f "$NOTARY_RESULT"

./node_modules/.bin/electron-builder --mac zip --arm64 --prepackaged "$APP"

# A ZIP has no stapling format. Extract and assess its stapled app to verify the
# exact archive being shipped, while assessing the DMG as a distribution image.
ZIP_VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rrr-release-zip.XXXXXX")"
ditto -x -k "$ZIP" "$ZIP_VERIFY_DIR"
ZIP_APP="$ZIP_VERIFY_DIR/Chiptunes.app"
xcrun stapler validate "$ZIP_APP"
codesign --verify --deep --strict "$ZIP_APP"
spctl -a -vvv -t exec "$ZIP_APP"
spctl -a -vvv -t open --context context:primary-signature "$DMG"

# Removing a RUNNING app's bundle crashes the live process (this is exactly what killed the old
# Chiptunes.app during the rename). So gracefully quit any running instance first, remember
# whether it was up, then relaunch it in the background after the swap so an autonomous ship never
# crashes — nor silently closes — a Chiptunes the owner is using.
WAS_RUNNING=""
pgrep -f '/Applications/Chiptunes.app/Contents/MacOS/' >/dev/null 2>&1 && WAS_RUNNING=1
osascript -e 'tell application "Chiptunes" to quit' >/dev/null 2>&1 || true
osascript -e 'tell application "Chiptunes" to quit' >/dev/null 2>&1 || true
sleep 1
pkill -f '/Applications/Chiptunes.app/Contents/MacOS/' 2>/dev/null || true
pkill -f '/Applications/Chiptunes.app/Contents/MacOS/' 2>/dev/null || true
sleep 1

rm -rf '/Applications/Chiptunes.app'   # remove the pre-rename bundle so the two never coexist
rm -rf '/Applications/Chiptunes.app'
ditto "$APP" '/Applications/Chiptunes.app'
xcrun stapler validate '/Applications/Chiptunes.app'
codesign --verify --deep --strict '/Applications/Chiptunes.app'
spctl -a -vvv -t exec '/Applications/Chiptunes.app'
[ -n "$WAS_RUNNING" ] && open -g '/Applications/Chiptunes.app' && echo "relaunched running Chiptunes in background" || true
shasum -a 256 "$DMG" "$ZIP"

# Publish only after the signed/notarized artifacts have passed Gatekeeper and the local app has
# been installed. The versioned ZIP is uploaded first; latest-mac.yml is the atomic public flip.
# A network failure exits loudly so the daemon retries this version, but cannot damage the already
# installed local app.
( cd .. && node scripts/publish-mac-update.mjs )
