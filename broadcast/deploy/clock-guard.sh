#!/usr/bin/env bash
# Clock-sync guard. The broadcaster and every browser derive the on-air track from wall-clock UTC, so
# if this box's clock drifts from NTP the stream renders the WRONG position and desyncs from the
# website — a failure NO byte/audio probe can see (the stream flows perfectly, just out of phase).
# NTP normally self-heals; if timesyncd is wedged and the clock is unsynchronized, kick it. Runs every
# ~5 min via chiptunes-clock-guard.timer.
set -u
synced="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"
[ "$synced" = "yes" ] && exit 0
logger -t chiptunes-clock-guard "clock NOT NTP-synchronized (NTPSynchronized=$synced) — restarting systemd-timesyncd"
systemctl restart systemd-timesyncd 2>/dev/null || systemctl restart chrony 2>/dev/null || true
