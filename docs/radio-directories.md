# Listing the station in radio directories

Everything a directory asks for, ready to paste. The values below are the ones
the live stream actually advertises — read off its ICY headers on 2026-08-29,
not invented for the form.

**These submissions are yours to make, not mine.** Every directory asks the
submitter to certify they hold the right to stream the material, and most tie
the listing to an account. That is a representation about ownership, so it has
to come from you.

## The station, as it describes itself

| Field | Value |
|---|---|
| Name | `Chiptunes.app` |
| Homepage | `https://chiptunes.app` |
| Stream URL | `https://radio.chiptunes.app` |
| Codec / bitrate | MP3, 256 kbps, 48 kHz, stereo |
| Genre | `Chiptune, Electronic, Generative, Chillwave` |
| Language | Instrumental / no spoken language |
| Country | (yours) |
| Logo | `https://stream.chiptunes.app/logo.png` |
| Playlist (M3U) | `https://chiptunes.app/radio.m3u` |
| Playlist (PLS) | `https://chiptunes.app/radio.pls` |

Short description (most forms cap around 200 characters):

> Endless generative chiptune that never plays the same track twice — a shared
> broadcast, in sync for everyone tuned in.

Longer description, where there is room for one:

> Chiptunes.app writes its own music. Every track is composed on the spot for
> the Game Boy's sound chip — two pulse voices, a wave channel and noise — and
> played through a cycle-accurate model of that hardware, so what you hear is
> what the console would have made. Nothing is sampled and nothing repeats.
> Every song can be downloaded as a real 32 KB cartridge that runs on the
> hardware itself.

Tags: `chiptune`, `game boy`, `8-bit`, `video game music`, `generative`,
`instrumental`, `electronic`, `lo-fi`, `focus`, `background`

## Where to submit, in the order worth doing

1. **Radio Browser** — https://www.radio-browser.info — open, free, no account,
   and used as the station source by other apps (Eter and others), so this one
   listing makes the station findable in players you never submit to. Do this
   first.
2. **Online Radio Box** — owner portal, straightforward, own mobile apps.
3. **myTuner** — broadcaster account; distributes to phone, car, TV and speaker
   apps. Registration includes the streaming-rights representation.
4. **radio.net** — broadcaster linking agreement; its apps carry CarPlay and
   Android Auto, which is the "listen away from the website" case.
5. **TuneIn** — evaluate last. Its current model separates non-US self-service
   submission from paid TuneIn On Air for US broadcasters.

## Already done, so don't redo it

The technical half of the "listen anywhere" package is built and live:

- the permanent MP3 stream, with `icy-name`, `icy-description`, `icy-genre`,
  `icy-url` and `icy-logo` set, and `icy-metaint` for per-track metadata;
- `/radio.m3u` and `/radio.pls`, served with `audio/x-mpegurl` and
  `audio/x-scpls` so players offer to open them rather than showing text;
- platform-aware handoff in the app: an Android intent with a `.pls` fallback,
  the `broadcasts://` deep link on iOS (name, stream and artwork) with a
  visibility check so the fallback only fires when the app is not installed,
  and copy-stream-URL everywhere;
- Media Session metadata, so lock screens and media keys show the track.

What is missing is only the directory listings above.
