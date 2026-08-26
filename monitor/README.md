# chiptunes-monitor — off-box uptime monitor

A Cloudflare Worker on a **Cron Trigger (every 2 min)** that watches the radio from OUTSIDE the Oracle
box, so it catches the failures the on-box checks can't:

- a render **deadlock** the local watchdog misses,
- a dead **cloudflared tunnel** (public URL down while `127.0.0.1` is fine),
- a **dead box** entirely.

Each run:
1. Pulls `stream.chiptunes.app/radio.mp3` and counts **real audio bytes** (≥40KB in 6s; never `.text()`s
   the endless stream — reads the body, stops at enough bytes, cancels).
2. Fetches `chiptunes.app` and checks the page marker.
3. **2-strike debounce** (one blip is ignored), recording up→down / down→up **transitions**.
4. Emails `the configured alert address` only when a check transitions to **down**. Healthy checks and recovery
   transitions are recorded but do not send email.

State + outage history live in KV. `GET /status` returns the current state; `GET /check` runs the
probes once (for testing).

## Deploy
```
cd monitor
npx wrangler kv namespace create STATE        # paste the id into wrangler.jsonc kv_namespaces
npx wrangler deploy
```

## Owner step (once, ACCOUNT-WIDE): populate the shared SMTP secret
Alerts send via the stack's MXroute SMTP (see `stack/runbooks/email-smtp-dns.md`), from a Worker-native
SMTP client (`smtp.js`, since Workers can't use nodemailer). The `AUTH_EMAIL_SERVER` URL lives in the
**account-level "stack" Secrets Store** (id `c01d0546d02e45a19f66417800d4039d`) so you set it ONCE and
any Worker reuses it. Populate it (hidden prompt — you hold the password, so run it yourself):
```
npx wrangler secrets-store secret create c01d0546d02e45a19f66417800d4039d \
  --name AUTH_EMAIL_SERVER --scopes workers --remote
# paste: smtps://USER:PASSWORD@YOUR-SMTP-HOST:465
```
Until it's populated the Worker still detects outages and records them in KV / `/status`. Inspect
`alerts[].mail` after an outage to verify delivery.

### Reuse in any other project (no re-entering the secret)
Add the binding to that project's wrangler config, then read it with `await env.AUTH_EMAIL_SERVER.get()`:
```
"secrets_store_secrets": [
  { "binding": "AUTH_EMAIL_SERVER", "store_id": "c01d0546d02e45a19f66417800d4039d", "secret_name": "AUTH_EMAIL_SERVER" }
]
```

## Known blind spot (accepted residual)
The Worker's subrequest to `stream.chiptunes.app` stays inside Cloudflare's network, so a **public-internet-only**
edge/DNS issue can read healthy. It DOES catch the dominant modes (render deadlock, tunnel down, box
dead, blank deploy). A truly independent third-party dead-man (e.g. healthchecks.io expecting the daily
heartbeat) would close the "whole Cloudflare account down" gap — deferred.
