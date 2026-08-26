# Chiptunes.app — broadcaster deployment (Oracle Cloud Always Free)

The broadcaster turns the live schedule (`src/live.js`) into an **MP3 stream** (Roon/VLC/hardware
radios, via `stream.chiptunes.app`) and a **YouTube RTMP video feed** (game visuals + audio). It is
completely independent of the website — the site on Cloudflare Pages never depends on this box.

Two long-running services (systemd):
- **`chiptunes-stream`** — `broadcast/broadcaster.js`: pure-Node offline render → ffmpeg → MP3 on `127.0.0.1:1340/radio.mp3`
- **`chiptunes-youtube`** — `broadcast/video.js`: headless `/radio` page → H.264/AAC → YouTube RTMP (inert until you set a stream key)

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
The GitHub repo is **private**, so `git clone` on the box won't work (it prompts for auth). Push
the working tree up with **rsync** from the dev machine instead (which is how it's actually deployed):
```bash
# from the dev machine (~/dev/chiptunes):
ssh ubuntu@<ip> 'sudo mkdir -p /opt/chiptunes /opt/stack/health-kit && sudo chown -R ubuntu:ubuntu /opt/chiptunes /opt/stack'
rsync -az --exclude node_modules --exclude dist ./ ubuntu@<ip>:/opt/chiptunes/
rsync -az --exclude node_modules ../stack/health-kit/ ubuntu@<ip>:/opt/stack/health-kit/
ssh ubuntu@<ip> 'cd /opt/chiptunes && git remote remove origin 2>/dev/null; sudo bash broadcast/deploy/setup.sh'
```
`setup.sh` installs ffmpeg + Node 22 + the native ARM64 Web Audio runtime, builds `dist/`, and
starts `chiptunes-stream`. It also installs Playwright Chromium for the separate YouTube video service.
(It removes the origin remote so its `git pull` step safely no-ops on the private repo.)

### 3. Expose the MP3 stream as `stream.chiptunes.app` (cloudflared, $0, no open ports)
```bash
# install cloudflared (arm64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login                         # opens a URL — authorize the chiptunes.app zone in your browser
cloudflared tunnel create chiptunes-stream             # note the tunnel ID it prints
cloudflared tunnel route dns chiptunes-stream stream.chiptunes.app
```
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <the chiptunes-stream tunnel ID>
credentials-file: /home/ubuntu/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: stream.chiptunes.app
    service: http://127.0.0.1:1340
  - service: http_status:404
```
Run it as a service: `sudo cloudflared service install && sudo systemctl enable --now cloudflared`.
Now **`https://stream.chiptunes.app/radio.mp3`** is the URL to paste into **Roon → Live Radio → Add**.

### 4. (Phase 3) Enable the YouTube feed
1. YouTube → **Create → Go live → Stream** → copy the **Stream key**.
2. On the box: `sudo nano /etc/chiptunes.env` → set `YT_STREAM_KEY=<key>` → save.
3. `sudo systemctl enable --now chiptunes-youtube`
4. Watch health: `journalctl -u chiptunes-youtube -f`. YouTube Studio should show ingest "Good/Excellent".

---

## What's automated (the kit)
- `setup.sh` — provision/update (idempotent).
- `chiptunes-stream.service` / `chiptunes-youtube.service` — systemd units (auto-restart, restart caps).
- `/etc/chiptunes.env` — `FFMPEG`, `RRR_STREAM_PORT`, `VIDEO_ENC=libx264`, `YT_STREAM_KEY`, `PRESENCE_SECRET`.

## Aggregate live count (one true total across every surface)
The site's listener number is meant to be **one total** across web + desktop **and** YouTube **and** the
internet-radio streams. The `radio-presence` Worker already counts web + desktop (each holds a WebSocket).
The box adds the two surfaces the Worker can't see, via **`broadcast/presence-reporter.mjs`**: every ~45s it
reads `127.0.0.1:1340/healthz` (sum of per-channel stream listeners) + the YouTube Live `concurrentViewers`,
and POSTs `{youtube, stream}` to `https://chiptunes.app/api/presence/external` with a Bearer secret. The DO
folds them in, so `listeners = web/desktop WS + youtube + stream`. External counts older than ~3 min are
dropped to 0 (a dead box never freezes a phantom total).

**Secret** — the box's `PRESENCE_SECRET` (in `/etc/chiptunes.env`) MUST equal the Worker's
`EXTERNAL_PRESENCE_SECRET`. Set the Worker side once (never committed):
```bash
cd cloudflare && npx wrangler secret put EXTERNAL_PRESENCE_SECRET   # paste the same value
```
Then put that same value in `/etc/chiptunes.env` on the box as `PRESENCE_SECRET=...`.

**Install the reporter timer on the box** (unit files ship in this dir; `setup.sh` also installs it when
`PRESENCE_SECRET` is set). One-liner to (re)install + start it standalone:
```bash
sudo sed "s#@REPO@#/opt/chiptunes#g" /opt/chiptunes/broadcast/deploy/chiptunes-presence-reporter.service > /etc/systemd/system/chiptunes-presence-reporter.service && sudo cp /opt/chiptunes/broadcast/deploy/chiptunes-presence-reporter.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now chiptunes-presence-reporter.timer
```
Watch it: `journalctl -u chiptunes-presence-reporter -f` (logs `reported youtube=N stream=M -> listeners=T`).
The YouTube leg reuses the guardian's OAuth creds (`/etc/chiptunes-youtube-oauth.json`); if they're absent the
YouTube contribution is just 0.

## Keeping in sync with the website
Same code = same `src/live.js`/`src/composer.js` = same schedule + audio. **When you change either and
redeploy the site (`npm run deploy`), push the same files to the box and rebuild** (private repo → rsync,
not `git pull`):
```bash
# from ~/dev/chiptunes, after committing + `npm run deploy`:
rsync -az --rsync-path="sudo rsync" src/composer.js src/live.js ubuntu@<ip>:/opt/chiptunes/src/
ssh ubuntu@<ip> 'sudo chown -R rrr:rrr /opt/chiptunes/src && sudo -u rrr bash -lc "cd /opt/chiptunes && node build.js" && sudo systemctl restart chiptunes-stream'
```
The broadcaster serves the built `dist/`, so `src` changes need a `node build.js` on the box before the
restart. (Composer *version* bumps are handled cleanly by the `LIVE_VERSIONS` table — they flip at an
hour boundary — but the box still needs the new code.)

## Ops cheat-sheet
```bash
systemctl status chiptunes-stream chiptunes-youtube cloudflared
journalctl -u chiptunes-stream -f          # broadcaster log (on-air track, ffmpeg)
curl -s 127.0.0.1:1340/healthz       # {ok, clients, title}
```

## Cost / resilience notes
- Always Free reclaims **idle** instances; a 24/7 encoder is never idle, so this is safe.
- The broadcaster is **stateless** (re-derives everything from the clock) — if the box is ever lost,
  redeploy anywhere and it rejoins the same schedule. Nothing irreplaceable lives here.
- YouTube RTMP goes **direct** box→YouTube (never through the tunnel). Only the ≤192k MP3 uses cloudflared.
