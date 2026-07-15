#!/usr/bin/env bash
# setup.sh — provision / update the Retro Rave Radio broadcaster on an Ubuntu ARM64 box
# (Oracle Cloud Always Free A1.Flex). Idempotent: run again any time to pull + rebuild + restart.
#
#   sudo bash broadcast/deploy/setup.sh
#
# Installs ffmpeg + Node 22, builds dist/, and (re)starts the two systemd services. Playwright
# Chromium remains installed only for the YouTube video leg; rrr-stream renders audio in Node.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/retro-rave-radio}"
SERVICE_USER="${SERVICE_USER:-rrr}"
ENV_FILE="/etc/retro-rave-radio.env"

echo "==> apt deps (ffmpeg with libx264/libmp3lame/aac, Node audio runtime, git, curl)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ffmpeg git curl ca-certificates libjack-jackd2-0
if apt-cache show libasound2t64 >/dev/null 2>&1; then
  apt-get install -y libasound2t64       # Ubuntu 24.04+
else
  apt-get install -y libasound2          # Ubuntu 22.04
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "==> Node 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> service user ${SERVICE_USER}"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd -r -m -d "/home/${SERVICE_USER}" -s /usr/sbin/nologin "${SERVICE_USER}"

echo "==> repo at ${REPO_DIR}"
if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "    (clone the repo to ${REPO_DIR} first, then re-run) — e.g.:"
  echo "    sudo git clone <repo-url> ${REPO_DIR}"
  exit 1
fi
git -C "${REPO_DIR}" pull --ff-only || echo "    (pull skipped — detached/local checkout)"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${REPO_DIR}"

echo "==> npm deps + Playwright Chromium for the optional YouTube leg"
sudo -u "${SERVICE_USER}" bash -lc "cd ${REPO_DIR} && npm ci || npm install"
# Playwright needs its browser + OS libs; --with-deps pulls the apt packages Chromium needs headless.
sudo -u "${SERVICE_USER}" bash -lc "cd ${REPO_DIR} && npx playwright install chromium"
npx --prefix "${REPO_DIR}" playwright install-deps chromium || sudo -u "${SERVICE_USER}" bash -lc "cd ${REPO_DIR} && npx playwright install --with-deps chromium" || true

echo "==> build dist/"
sudo -u "${SERVICE_USER}" bash -lc "cd ${REPO_DIR} && node build.js"

echo "==> pure-Node audio renderer preflight"
sudo -u "${SERVICE_USER}" bash -lc "cd ${REPO_DIR} && node scripts/smoke-broadcast-renderer.js"

echo "==> env file ${ENV_FILE} (edit to add YT_STREAM_KEY for the YouTube leg)"
if [ ! -f "${ENV_FILE}" ]; then
  cat > "${ENV_FILE}" <<EOF
# Retro Rave Radio broadcaster env. Linux ffmpeg + software H.264 (ARM has no videotoolbox).
FFMPEG=/usr/bin/ffmpeg
RRR_STREAM_PORT=1340
VIDEO_ENC=libx264
# Paste your YouTube "Stream key" here to enable the video leg, then: systemctl restart rrr-youtube
YT_STREAM_KEY=
EOF
  chmod 640 "${ENV_FILE}"; chown root:"${SERVICE_USER}" "${ENV_FILE}"
fi

echo "==> systemd units"
sed "s#@REPO@#${REPO_DIR}#g; s#@USER@#${SERVICE_USER}#g" "${REPO_DIR}/broadcast/deploy/rrr-stream.service" > /etc/systemd/system/rrr-stream.service
sed "s#@REPO@#${REPO_DIR}#g; s#@USER@#${SERVICE_USER}#g" "${REPO_DIR}/broadcast/deploy/rrr-youtube.service" > /etc/systemd/system/rrr-youtube.service
systemctl daemon-reload
systemctl enable rrr-stream
systemctl restart rrr-stream
# youtube leg only starts if a key is present
if grep -q '^YT_STREAM_KEY=.\+' "${ENV_FILE}"; then
  systemctl enable rrr-youtube
  systemctl restart rrr-youtube
else
  echo "    (rrr-youtube left stopped — no YT_STREAM_KEY yet)"
fi

echo "==> done. MP3 stream on 127.0.0.1:${RRR_STREAM_PORT:-1340}/radio.mp3"
echo "    Expose it as stream.ramine.net with cloudflared (see broadcast/deploy/README.md)."
systemctl --no-pager status rrr-stream | head -5 || true
