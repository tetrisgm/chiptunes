# YouTube 24/7 live — go-live runbook (~5 min when you're ready)

The video leg (`broadcast/video.js` → `rrr-youtube` service) is **built, deployed on the box, and
inert**. It renders the `/radio` page (game visuals + the shared live audio, inherently in sync
because it's one page tuned to the same deterministic broadcast as the website + Roon stream) at
**720p30 H.264 + AAC 192k** and pushes FLV to YouTube RTMP. It stays stopped until a stream key
exists, so nothing runs (or costs) until you flip it on.

**Already done (verified):** Playwright Chromium installed for the `rrr` service user · ffmpeg 6.1
with libx264 · `/etc/retro-rave-radio.env` has `FFMPEG` + `VIDEO_ENC=libx264` + empty `YT_STREAM_KEY`
· `rrr-youtube.service` installed + disabled · pipeline dry-run produces valid H.264+AAC on both mac
and the ARM box.

---

## What only YOU can do (accounts) — do these once

1. **Enable live streaming on the YouTube channel.** YouTube → Create → **Go live**. First-time only:
   the channel must be verified and live-streaming enabled, which can take **up to 24 hours** to
   activate. Start this a day before you actually want to go live.
2. **Create the stream + copy the key.** YouTube Studio → **Create → Go Live → Stream** tab. Set
   title (e.g. "Retro Rave Radio — infinite generative chiptune"), visibility, category. Under
   *Stream settings* copy the **Stream key** (looks like `xxxx-xxxx-xxxx-xxxx-xxxx`). Leave the RTMP
   URL default (`rtmp://a.rtmp.youtube.com/live2/`) — `video.js` already targets it.

## Flip it on (2 commands on the box)

```bash
ssh ubuntu@146.235.201.5

# put the key in the env file (kept root:rrr 640, never in shell history):
sudo sed -i 's#^YT_STREAM_KEY=.*#YT_STREAM_KEY=PASTE-YOUR-KEY-HERE#' /etc/retro-rave-radio.env

# start + enable at boot:
sudo systemctl enable --now rrr-youtube

# watch it come up (YouTube Studio should show ingest "Good/Excellent" within ~30s):
journalctl -u rrr-youtube -f
```

Then in YouTube Studio press **Go Live**. The stream shows the same on-air track as
`stream.ramine.net` and the website, with the game visuals.

## Turn it off

```bash
sudo systemctl disable --now rrr-youtube
# and clear the key so a stray restart can't reconnect:
sudo sed -i 's#^YT_STREAM_KEY=.*#YT_STREAM_KEY=#' /etc/retro-rave-radio.env
```

## Notes / knobs (all in `/etc/retro-rave-radio.env`, then `systemctl restart rrr-youtube`)

- `VIDEO_W` / `VIDEO_H` / `VIDEO_FPS` (default `1280` / `720` / `30`), `VIDEO_BITRATE` (default
  `4500k`). 720p30 software x264 is ~1 core; the box (2 OCPU) runs it alongside the ~0.12-core audio
  stream comfortably — no resize needed.
- The video leg is **independent of the website** and of the MP3 stream — it can be enabled/disabled
  any time without touching `rrr-stream` or Cloudflare.
- RTMP goes **box → YouTube directly** (not through the cloudflared tunnel; that only carries the
  ≤192k MP3).
- Prove the whole pipeline any time without YouTube:
  `sudo -u rrr bash -lc 'cd /opt/retro-rave-radio && FFMPEG=/usr/bin/ffmpeg node broadcast/video.js --dry-run /tmp/t.flv --seconds 12'`
  then `ffprobe /tmp/t.flv` — expect an h264 video + aac audio stream.
