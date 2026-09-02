# Usage signals — design sketch

**Status: proposal, nothing built.** Owner asked for a sketch before code
(2026-09-02). The goal is on-page social proof for launch: numbers that show
people are using this, that look respectable at three listeners and good at
three thousand, and that no one can fairly call inflated.

## What already exists

- `cloudflare/worker.js` — a deployed Worker on `chiptunes.app/api/*` with one
  global Durable Object (`Presence`) holding every listener's WebSocket via the
  hibernation API. **Live right now**: `/api/presence/count` returns
  `{listeners, web, youtube, stream, now}`.
- `broadcast/presence-reporter.mjs` — the box POSTs YouTube + internet-radio
  listener counts every ~45s to `/api/presence/external`, folded into the total
  and expired after 3 minutes so a dead box cannot freeze a phantom count.
- **No client.** `runtime.js:4188` calls `Presence.start()` behind a
  `typeof Presence !== 'undefined'` guard, and nothing defines it — the module
  was removed when the LIVE badge went. The service has been running with
  nothing reading it.

So the hard part (a hibernating, cross-surface, privacy-clean presence service)
is already built and deployed. This plan adds cumulative counters beside it and
a client that displays both.

## The counters

All lifetime, none expiring, none resetting. Two groups, kept visually
separate so no number wears a label it has not earned.

**Usage (person-initiated)**

| key | counted when | headline reads |
| --- | --- | --- |
| `visits` | a page load fires the beacon | 128,400 visits |
| `listeners` | first-ever visit on this browser | 41,900 listeners |
| `sessions` | first activity after 30 min idle | 96,200 sessions |
| `songsHeard` | a song has played ≥30s | 184,302 songs listened to |
| `secsHeard` | accumulated playing seconds | 2,140,000 minutes listened |
| `takenAway` | WAV + ROM + share-link opened | 1,207 songs taken away |

**Output (machine-driven, labelled as output)**

| key | counted when | headline reads |
| --- | --- | --- |
| `tracksMade` | a track is composed | 214,000 tracks generated |

`tracksMade` is driven by autoplay — one tab left open overnight is several
hundred — so it never sits under a people-word. It is a fine "this thing has
been busy" line as long as it says *generated*.

**Peak** (`peakListeners`) is a ratchet on the existing concurrent count: only
ever raised, so it survives quiet weeks.

## Equivalences

One true number plus a division anyone can redo. Changes the unit, not the
quantity.

- `secsHeard` → "2,140,000 minutes listened — four years of continuous play"
- `takenAway` (ROM share) → "1,207 cartridges — 38 MB of ROM that boots on real
  hardware"
- `songsHeard` → "184,302 songs listened to — none of them ever heard twice"

Lead with minutes, not hours: it is a 60× larger number for the same fact.
Switch to hours only when minutes stops being legible.

## How the client reports — no identifier ever leaves the browser

This is the part worth getting right. **The browser decides, the server
counts.** There is no user id in any request.

```js
// first visit ever on this browser?
const isNew = !localStorage.getItem('ct-seen');   // then set it
// first activity in 30 minutes?
const isNewSession = (Date.now() - (+localStorage.getItem('ct-last') || 0)) > 18e5;
```

The beacon carries counts, never identity:

```
POST /api/presence/event
{ visit: 1, new: 1, session: 1, songs: 2, secs: 58, taken: 0, made: 3 }
```

The DO adds those integers to its totals. It never learns who sent them, and
storage holds seven numbers and nothing else. That is strictly more private
than the usual analytics id-per-visitor, and it keeps the product's existing
posture: nothing about a person is transmitted or stored.

**Cadence.** One beacon on load, then every 30s while audible, plus a final
`navigator.sendBeacon` on `pagehide`. Batching keeps the DO cold.

## Not reintroducing writes to the hot path

The DO is deliberately write-free on WebSocket join/leave so it hibernates and
burns no duration quota. Counters must not undo that.

- Increment **in memory**; flush to `ctx.storage` on a 10s debounce and on the
  external-reporter POST (already a write path).
- Worst case a hibernation eviction loses <10s of counts. It errs **downward**,
  which is the right direction for a number we are asking people to believe.
- Read path `/api/presence/totals` is cached `max-age=30` at the edge, so the
  strip costs the DO almost nothing regardless of traffic.

## Keeping the numbers honest

**A public increment endpoint is spammable, and that is the real risk here** —
the whole point of these numbers is credibility, so an inflated one is worse
than none. Mitigations, all cheap:

- **Clamp every field per request** to what the cadence can produce:
  `secs ≤ 90`, `songs ≤ 5`, `made ≤ 10`, `visit/new/session ≤ 1`. A forged
  request cannot contribute more than a real one.
- **Rate limit per IP** at the edge (Cloudflare rule), a few requests a minute.
- **Reject non-allowlisted origins**, same set the WS upgrade already uses.
- Numbers only ever increase; no endpoint can decrement.

**Bots come out for free.** Because `visits` is incremented by a JS beacon
rather than by an edge request, crawlers that never run scripts never count. No
bot list to maintain.

**The `stream` count is almost entirely BOTS — measured, 2026-09-02.** The
broadcaster was temporarily patched to log user-agent and `cf-connecting-ip` on
connect, watched for 150s, and restored (md5 back to `85453af…`). What was
actually connected:

| user-agent | ip | share |
| --- | --- | --- |
| `hackney/1.21.0` | 65.108.235.185 (Hetzner FI) | ~13 of 25 — the dominant source |
| `GlobradioHarvester/1.0 (+globradio.com)` | 35.158.29.84 | directory harvester |
| `ClaudeBot/1.0` | 216.73.216.198 | AI crawler |
| `NSPlayer/12.00` (Windows Media Player) | 159.26.100.223 | checker or listener |
| `Mozilla/5.0` | 174.57.151.78 (US residential) | possibly a real person |
| `curl/8.5.0` | 127.0.0.1 | our own watchdog |
| — | 2a06:98c0:3600::103 (Cloudflare) | our own monitor Worker |

**No Roon.** The earlier hypothesis — that the owner's own Roon was the standing
listener — is REFUTED; it never appeared. The real cause is that the station is
listed in radio directories (Radio Browser accepted it as
`967010ce-34f5-460d-beb4-67a196c49d9b`), and directories poll continuously to
verify a stream is alive. 4,416 connections in 24h, flat overnight, is the cost
of being listed. Nearly all of them request `/` rather than `/radio.mp3`.

**So the fix is dwell time, not a blocklist.** A directory checker connects for a
few seconds and drops; a person stays for minutes. Count a stream listener only
once its connection has lasted **≥60s**, which needs no user-agent list, cannot
be spoofed away, and matches the ≥30s rule used for web listeners. The reporter
should send that filtered figure, not `clients.size`.

**Still exclude our own devices** — the local `curl` watchdog and the monitor
Worker both register today, and self-counting is the one form of inflation with
no defence.

## Display

`window.__ctSignals()` returns the totals; the strip renders only fields over a
threshold, so day one shows nothing embarrassing and the numbers appear as they
are earned.

```
THRESHOLDS = { visits: 500, listeners: 100, sessions: 250,
               songsHeard: 1000, secsHeard: 60000 /* ~1000 min */,
               takenAway: 25, tracksMade: 5000, peakListeners: 15 }
```

Placement: a quiet line under the moods on the landing page (the hero already
carries the product story), and nothing on the playing screen — that surface is
already crowded and is where people came to listen, not to read.

## Copy that must change

`docs/launch/README.md:54` currently reads:

> The site is free, public-source, usable without an account, and does not send
> song-generation requests to a server.

Still literally true — composition stays in the browser — but it invites "so
what *do* you send?" Tighten to something that states the counters plainly,
because volunteering it is what makes the rest believable:

> Free, public-source, and usable without an account. Songs are composed in your
> browser, not on a server; the site keeps aggregate usage counts and no
> per-person identifier is ever sent or stored.

## Cost

Free tier throughout. One DO, ~7 integers, a 10s flush, a 30s-cached read. The
beacon is one request per visitor per 30s while audible.

## Open questions for the owner

1. **Storage in the DO.** It holds sockets today; this adds durable state. Small
   and reversible, but it is a change of character.
2. **`localStorage` flag.** Two keys (`ct-seen`, `ct-last`), first-party, never
   transmitted. Precedent exists (`ct-create-shelf`, `ct-create-tour`).
3. **Where the strip lives** — landing only, as proposed?
4. **Start date.** Counters begin at zero on deploy. Stating "since 2 Sept 2026"
   costs nothing and reads as confidence.
