#!/usr/bin/env bash
# Liveness watchdog for the chiptunes-stream broadcaster.
#
# WHY: the pure-Node render loop can silently DEADLOCK — the process stays systemd-"active" (so
# Restart=always never fires) but stops producing audio: ffmpeg drops to 0% CPU, load goes to 0, the
# MP3 stream stalls, and listeners hear a short buffered loop then silence. Observed after ~3.5h uptime
# with nothing logged. This watchdog actually PULLS the live stream and restarts chiptunes-stream if it is
# not producing audio. The broadcaster is stateless (re-derives from the wall clock), so a restart
# recovers cleanly at the current on-air position.
#
# Installed as a systemd timer (chiptunes-stream-watchdog.timer, every ~3 min). Runs as root.
set -u
PORT="${RRR_STREAM_PORT:-1340}"
URL="http://127.0.0.1:${PORT}/radio.mp3"
MIN_BYTES="${RRR_WATCHDOG_MIN_BYTES:-50000}"   # a healthy ~192kbps stream yields ~190KB in 8s; a stalled one ~0

probe() { timeout 8 curl -s "$URL" 2>/dev/null | head -c 400000 | wc -c; }

b1="$(probe)"
[ "${b1:-0}" -ge "$MIN_BYTES" ] && exit 0
sleep 4                                          # double-check to ignore a transient blip
b2="$(probe)"
[ "${b2:-0}" -ge "$MIN_BYTES" ] && exit 0

logger -t chiptunes-stream-watchdog "stream stalled (${b1}B then ${b2}B in 8s, min ${MIN_BYTES}) — restarting chiptunes-stream"
systemctl reset-failed chiptunes-stream 2>/dev/null || true   # un-park a unit that ever hit a start-limit, so the restart is honored
systemctl restart chiptunes-stream
