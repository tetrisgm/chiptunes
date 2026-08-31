#!/usr/bin/env bash
# Deliberate, manually invoked delivery for the Chiptunes web and broadcast
# artifacts. The desktop wallpaper product now lives in tetrisgm/wallpaper.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${CHIPTUNES_DELIVERY_MODE:-public}" in
  local) npm run build ;;
  public) npm run deploy ;;
  *) echo "CHIPTUNES_DELIVERY_MODE must be local or public" >&2; exit 2 ;;
esac
