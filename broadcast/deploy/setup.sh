#!/usr/bin/env bash
# setup.sh — provision / update the Chiptunes.app broadcaster on an Ubuntu ARM64 box
# (Oracle Cloud Always Free A1.Flex). Idempotent: run again any time to pull + rebuild + restart.
#
#   sudo bash broadcast/deploy/setup.sh
#
# Installs ffmpeg + Node 22, builds dist/, and (re)starts the two systemd services. Playwright
# Chromium remains installed only for the YouTube video leg; chiptunes-stream renders audio in Node.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/chiptunes}"
SERVICE_USER="${SERVICE_USER:-chiptunes}"
ENV_FILE="/etc/chiptunes.env"

echo "==> apt deps (ffmpeg with libx264/libmp3lame/aac, Node audio runtime, git, curl)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ffmpeg git curl ca-certificates libjack-jackd2-0 xvfb x11-utils   # xvfb: virtual display for the x11grab video-leg capture
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
# Chiptunes.app broadcaster env. Linux ffmpeg + software H.264 (ARM has no videotoolbox).
FFMPEG=/usr/bin/ffmpeg
CHIPTUNES_STREAM_PORT=1340
# ONE station by construction: broadcaster.js serves a single channel (the shared live.js schedule) on the
# radio root + /radio.pcm (the YouTube leg's mux tap) + /everything. There are no mood mounts, and no
# CHIPTUNES_CHANNELS / CHIPTUNES_PRIMARY_MOOD knobs anymore — radio + YouTube are identical to the site's one station.
VIDEO_ENC=libx264
# YouTube video leg (GPU-less box, so every stage must be cheap):
#  - VIDEO_CAPTURE=x11grab: headed Chrome renders onto a virtual X display (Xvfb) and ffmpeg grabs RAW frames
#    off it -> a SINGLE H.264 encode. This CUTS the old VP8 pass (MediaRecorder->vp8 then ffmpeg vp8->h264 was
#    ~3 cores at 720p; x11grab frees it, so 720p fits 4 cores at load ~3.2). Needs xvfb + the full Chromium.
#  - VIDEO_AUDIO_URL: ffmpeg muxes this local stream DIRECTLY as the timeline master (decoupled) — the audio
#    never rides through the browser, so it can't crackle. The .pcm mount is the broadcaster's LOSSLESS tap
#    (raw f32le): YT listeners get PCM->AAC->opus instead of PCM->MP3->AAC->opus (one lossy generation fewer).
#    The page still PLAYS the .mp3 variant to drive the reactive visuals (derived automatically).
#  - VIDEO_RENDER_FPS caps the page render loop. Unset VIDEO_CAPTURE for the mediarecorder/vp8 fallback.
VIDEO_CAPTURE=x11grab
VIDEO_NO_GPU=1  # GPU-less server: skip the ANGLE-SwiftShader GPU process (measured ~0.1 core); user devices are unaffected
VIDEO_XDISPLAY=:99
# 720p24 on the GPU-less box. 1080p30 SATURATED the 4 cores (load ~2.7-4): the render loop kept missing its
# frame budget under x264 contention, so x11grab captured unchanged frames and x264 padded them — 100k+
# "duplicated frames" == the visible stutter. 720p halves the raster + encode, and capture FPS == render FPS
# means there is NOTHING to duplicate by construction (no CFR padding). Load dropped to ~1.4-1.8 — always realtime.
VIDEO_W=1280
VIDEO_H=720
VIDEO_FPS=24
VIDEO_RENDER_FPS=24         # MUST equal VIDEO_FPS so capture never outruns the page render (zero duplicated frames)
VIDEO_BITRATE=5500k  # 720p24; generous ingest so YouTube's re-encode stays clean on the flat game colors
VIDEO_AUDIO_URL=http://127.0.0.1:1340/radio.pcm
# Paste your YouTube "Stream key" here to enable the video leg, then: systemctl restart chiptunes-youtube
YT_STREAM_KEY=
# Aggregate live-count reporter (chiptunes-presence-reporter): shared secret that authenticates the box to the
# radio-presence Worker so it can fold YouTube + internet-radio listeners into the site's live count. Must
# EXACTLY match the Worker's EXTERNAL_PRESENCE_SECRET (set once with:
#   cd cloudflare && npx wrangler secret put EXTERNAL_PRESENCE_SECRET). Empty = reporter stays off.
PRESENCE_SECRET=
EOF
  chmod 640 "${ENV_FILE}"; chown root:"${SERVICE_USER}" "${ENV_FILE}"
fi

echo "==> systemd units"
sed "s#@REPO@#${REPO_DIR}#g; s#@USER@#${SERVICE_USER}#g" "${REPO_DIR}/broadcast/deploy/chiptunes-stream.service" > /etc/systemd/system/chiptunes-stream.service
sed "s#@REPO@#${REPO_DIR}#g; s#@USER@#${SERVICE_USER}#g" "${REPO_DIR}/broadcast/deploy/chiptunes-youtube.service" > /etc/systemd/system/chiptunes-youtube.service
# liveness watchdog: restarts chiptunes-stream if the render loop silently deadlocks (stays "active" but stops producing audio)
chmod +x "${REPO_DIR}/broadcast/deploy/stream-watchdog.sh"
sed "s#@REPO@#${REPO_DIR}#g" "${REPO_DIR}/broadcast/deploy/chiptunes-stream-watchdog.service" > /etc/systemd/system/chiptunes-stream-watchdog.service
cp "${REPO_DIR}/broadcast/deploy/chiptunes-stream-watchdog.timer" /etc/systemd/system/chiptunes-stream-watchdog.timer
# clock-sync guard: keep the box clock NTP-aligned so the deterministic schedule can't desync from the site
chmod +x "${REPO_DIR}/broadcast/deploy/clock-guard.sh"
sed "s#@REPO@#${REPO_DIR}#g" "${REPO_DIR}/broadcast/deploy/chiptunes-clock-guard.service" > /etc/systemd/system/chiptunes-clock-guard.service
# YouTube broadcast guardian: self-healing go-live (needs /etc/chiptunes-youtube-oauth.json — see youtube-live.mjs auth)
sed "s#@REPO@#${REPO_DIR}#g" "${REPO_DIR}/broadcast/deploy/chiptunes-youtube-guardian.service" > /etc/systemd/system/chiptunes-youtube-guardian.service
cp "${REPO_DIR}/broadcast/deploy/chiptunes-youtube-guardian.timer" /etc/systemd/system/chiptunes-youtube-guardian.timer
cp "${REPO_DIR}/broadcast/deploy/chiptunes-clock-guard.timer" /etc/systemd/system/chiptunes-clock-guard.timer
# aggregate live-count reporter: folds YouTube + internet-radio listeners into the site total (needs PRESENCE_SECRET)
sed "s#@REPO@#${REPO_DIR}#g" "${REPO_DIR}/broadcast/deploy/chiptunes-presence-reporter.service" > /etc/systemd/system/chiptunes-presence-reporter.service
cp "${REPO_DIR}/broadcast/deploy/chiptunes-presence-reporter.timer" /etc/systemd/system/chiptunes-presence-reporter.timer
systemctl daemon-reload
systemctl enable chiptunes-stream
systemctl restart chiptunes-stream
systemctl enable --now chiptunes-stream-watchdog.timer
systemctl enable --now chiptunes-clock-guard.timer
if [ -f /etc/chiptunes-youtube-oauth.json ]; then systemctl enable --now chiptunes-youtube-guardian.timer; else echo "    (youtube guardian timer left off — no /etc/chiptunes-youtube-oauth.json)"; fi
if grep -q '^PRESENCE_SECRET=.\+' "${ENV_FILE}"; then systemctl enable --now chiptunes-presence-reporter.timer; else echo "    (presence reporter timer left off — no PRESENCE_SECRET in ${ENV_FILE})"; fi
# youtube leg only starts if a key is present
if grep -q '^YT_STREAM_KEY=.\+' "${ENV_FILE}"; then
  systemctl enable chiptunes-youtube
  systemctl restart chiptunes-youtube
else
  echo "    (chiptunes-youtube left stopped — no YT_STREAM_KEY yet)"
fi

echo "==> done. MP3 stream on 127.0.0.1:${CHIPTUNES_STREAM_PORT:-1340}/radio.mp3"
echo "    Expose it as stream.chiptunes.app with cloudflared (see broadcast/deploy/README.md)."
systemctl --no-pager status chiptunes-stream | head -5 || true
