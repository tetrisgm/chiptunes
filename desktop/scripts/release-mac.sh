#!/usr/bin/env bash
# Owner-facing arm64 release: verify -> build/sign -> notarize/staple -> package -> install.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${APP_NOTARY_PROFILE:-pp-notary}"
VERSION="$(node -p "require('./package.json').version")"
APP="dist/mac-arm64/Retro Rave Radio.app"
ZIP="dist/Retro-Rave-Radio-${VERSION}-arm64.zip"
DMG="dist/Retro-Rave-Radio-${VERSION}-arm64.dmg"
SUBMIT="dist/Retro-Rave-Radio-${VERSION}-arm64-notarize.zip"

node ../build.js
npm run check
npm run test:native
npm run test:desktop
npm audit
npm run pack:mac

rm -f "$SUBMIT"
ditto -c -k --keepParent "$APP" "$SUBMIT"
xcrun notarytool submit "$SUBMIT" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
rm -f "$SUBMIT" "$ZIP" "$DMG" "$ZIP.blockmap" "$DMG.blockmap"
./node_modules/.bin/electron-builder --mac dmg zip --arm64 --prepackaged "$APP"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

rm -rf '/Applications/Retro Rave Radio.app'
ditto "$APP" '/Applications/Retro Rave Radio.app'
codesign --verify --deep --strict '/Applications/Retro Rave Radio.app'
spctl -a -vvv -t exec '/Applications/Retro Rave Radio.app'
shasum -a 256 "$DMG" "$ZIP"
