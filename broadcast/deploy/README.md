# Retro Rave Radio — broadcaster deployment (Oracle Cloud Always Free)

The broadcaster turns the live schedule (`src/live.js`) into an **MP3 stream** (Roon/VLC/hardware
radios, via `stream.ramine.net`) and a **YouTube RTMP video feed** (game visuals + audio). It is
completely independent of the website — the site on Cloudflare Pages never depends on this box.

Two long-running services (systemd):
- **`rrr-stream`** — `broadcast/broadcaster.js`: headless render farm → ffmpeg → MP3 on `127.0.0.1:1340/radio.mp3`
- **`rrr-youtube`** — `broadcast/video.js`: headless `/radio` page → H.264/AAC → YouTube RTMP (inert until you set a stream key)

Both follow the SAME deterministic clock schedule, so Roon, browsers, and YouTube are all "on air"
together. The box must be NTP-synced (Ubuntu is by default) — that's what keeps it aligned.

---

## What YOU do (owner-gated — needs your accounts)

### 1. Create the free Oracle box (~15 min, one time)
1. Sign up at <https://signup.cloud.oracle.com> — a credit card is required for identity only; **Always Free** shapes are never billed.
2. Pick a home **region** with ARM capacity (if "out of capacity", try another region or retry later — it's the well-known Oracle friction).
3. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 22.04** (or 24.04), **aarch64**.
   - Shape: **VM.Standard.A1.Flex** — set **2 OCPU / 12 GB** (well within the Always-Free 4 OCPU / 24 GB; leaves headroom).
   - Add your **SSH public key** (paste `~/.ssh/id_ed25519.pub`; create one with `ssh-keygen -t ed25519` if needed).
   - Create. Note the **public IP**.
4. SSH in: `ssh ubuntu@<public-ip>`.

### 2. Get the code onto the box + run setup
```bash
sudo git clone https://github.com/tetrisgm/retro-rave-radio /opt/retro-rave-radio   # or your repo URL
sudo bash /opt/retro-rave-radio/broadcast/deploy/setup.sh
```
`setup.sh` installs ffmpeg + Node + Playwright Chromium, builds `dist/`, and starts `rrr-stream`.
Re-run it any time to pull + rebuild + restart.

### 3. Expose the MP3 stream as `stream.ramine.net` (cloudflared, $0, no open ports)
```bash
# install cloudflared (arm64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login                         # opens a URL — authorize the ramine.net zone in your browser
cloudflared tunnel create rrr-stream             # note the tunnel ID it prints
cloudflared tunnel route dns rrr-stream stream.ramine.net
```
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <the rrr-stream tunnel ID>
credentials-file: /home/ubuntu/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: stream.ramine.net
    service: http://127.0.0.1:1340
  - service: http_status:404
```
Run it as a service: `sudo cloudflared service install && sudo systemctl enable --now cloudflared`.
Now **`https://stream.ramine.net/radio.mp3`** is the URL to paste into **Roon → Live Radio → Add**.

### 4. (Phase 3) Enable the YouTube feed
1. YouTube → **Create → Go live → Stream** → copy the **Stream key**.
2. On the box: `sudo nano /etc/retro-rave-radio.env` → set `YT_STREAM_KEY=<key>` → save.
3. `sudo systemctl enable --now rrr-youtube`
4. Watch health: `journalctl -u rrr-youtube -f`. YouTube Studio should show ingest "Good/Excellent".

---

## What's automated (the kit)
- `setup.sh` — provision/update (idempotent).
- `rrr-stream.service` / `rrr-youtube.service` — systemd units (auto-restart, restart caps).
- `/etc/retro-rave-radio.env` — `FFMPEG`, `RRR_STREAM_PORT`, `VIDEO_ENC=libx264`, `YT_STREAM_KEY`.

## Keeping in sync with the website
Same repo = same `src/live.js` = same schedule. **When you change `src/composer.js` or `src/live.js`
and redeploy the site (`npm run deploy`), also `sudo bash …/setup.sh` on the box** so both realize
the identical schedule. (Composer *version* bumps are handled cleanly by the `LIVE_VERSIONS` table —
they flip at an hour boundary — but the box still needs the new code.)

## Ops cheat-sheet
```bash
systemctl status rrr-stream rrr-youtube cloudflared
journalctl -u rrr-stream -f          # broadcaster log (on-air track, ffmpeg)
curl -s 127.0.0.1:1340/healthz       # {ok, clients, title}
```

## Cost / resilience notes
- Always Free reclaims **idle** instances; a 24/7 encoder is never idle, so this is safe.
- The broadcaster is **stateless** (re-derives everything from the clock) — if the box is ever lost,
  redeploy anywhere and it rejoins the same schedule. Nothing irreplaceable lives here.
- YouTube RTMP goes **direct** box→YouTube (never through the tunnel). Only the ≤192k MP3 uses cloudflared.
