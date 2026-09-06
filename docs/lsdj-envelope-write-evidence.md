# Native envelope register-write evidence (2026-09-07)

Local owner ROM: LSDj 9.4.2, upgraded song format 22. The ROM was not copied
into this repository or uploaded. `scripts/analyze-lsdj-envelope-writes.js`
generates immutable temporary fixtures, migrates them through the ROM, then
changes instrument bytes 1, 9 and A for raw-byte experiments. It records
ordered writes through `tools/lsdjwrites.c`, not frame-end register shadows.

## Observations

All matrices below used DMG and CGB, tempos 80 and 160, 360 playback frames,
and a long note with no KILL command. Stage matrices also compared note steps
0 and 6. `up` means an observed NR12 `08` write; `down` means the observed
`09/11/18` triple. These names are pattern interpretations, **not measured
physical volume**. mGBA's decay volume is not a reliable hardware oracle.

- 128 first-stage cases: initial level 8, target 0/F, rates 0..F. Nonzero
  rising cases produced seven up patterns; falling cases eight down patterns.
  Four rate-zero model/target pairs had no held updates. The other 60 paired
  tempo comparisons passed the analyzer's cadence tolerance. Rate 1 has
  multiple updates within one video frame; rate F is about 19 video frames
  per update. Approximate inter-update raw tick counts follow
  `23424 * [1,2,3,4,6,8,11,15,20,27,36,48,64,86,115]` for rates 1..F.
  This is a measured hypothesis, not an exact scheduler implementation.
- 64 default-stage cases: initial 8, first rate 1/F, second level 0/F,
  second rate 0/4, final byte 00. With bytes `81 F4 00`, seven up patterns
  precede fifteen down patterns; the second phase uses a different cadence.
- 64 third-stage cases: bytes `81 F4 40` produce seven up then eleven down
  patterns; `81 F4 C0` gives seven up then three down. Replacing the last
  byte with `44` or `C4` gives fifteen total down patterns. First rate F
  preserves these counts but slows the first phase.
- 64 edge cases: initial 0/F, first rate 0/F, second byte F4, third 40/44.
  First rate zero produced no held updates, even when initial and target
  were both F. `0F F4 40` produced fifteen up then eleven down patterns.
  `FF F4 40` produced eleven down patterns, with its first update delayed
  approximately one slow first-stage interval plus one second-stage interval
  (CGB/80/step0: 2,783,612 raw ticks). Equal starting and target levels do
  not establish that the first stage is skipped immediately.
- 32 zero-turn cases: `81 04 F0` produced eight down then fifteen up
  patterns. `81 04 F4` added fifteen more down patterns. Thus reaching the
  inferred zero level does not, by itself, stop later register writes.

The candidate reading is three level/rate segments, ending toward zero, but
zero-rate, equal-level delays, phase transitions, retriggers, commands and
cross-channel state need further verification. No production envelope or
native scheduler implementation follows from this note.

## Timing calibration

The calibrated observer separately reports raw ticks per video frame and
frame-boundary double-speed flags on stderr, leaving CSV writes unchanged.
Over 240 playback frames it measured DMG 140447.96666666667 ticks/frame
(double-speed flag 0), CGB 140448 ticks/frame (flag 1). This establishes the
observed cross-model ratio near 1 for this ROM and installed mGBA, not universal
physical units or instruction accuracy. Flag changes between sampled frame
boundaries could be missed. Production sound timing remains unimplemented.

First-update delays include onset/instruction phase. Comparing two onsets on
the music grid cannot distinguish a trigger-relative timer from a globally
aligned scheduler. The analyzer's exact rounded interval-ratio equality is
jitter-sensitive and must not be treated as a cadence pass/fail oracle.

## Reproducibility and retained reports

Temporary report root:
`/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/`.

| Matrix | Report directory | Cases |
|---|---|---:|
| First stage | `chiptunes-envelope-writes-evSiGZ/envelope-writes.json` | 128 |
| Default stages | `chiptunes-envelope-writes-3U2YTv/envelope-stages.json` | 64 |
| Third stage | `chiptunes-envelope-writes-ghC0Qr/envelope-stages.json` | 64 |
| Edges | `chiptunes-envelope-writes-ePKf9w/envelope-stages.json` | 64 |
| Zero turn | `chiptunes-envelope-writes-eanzcK/envelope-stages.json` | 32 |

Prompts, Claude responses and run logs: `/tmp/chiptunes-claude-52kTdZ/`.
Calibration log: `timing-calibration-test.log`; binary: `lsdjwrites-calibrated`.
Temporary reports can be regenerated with the script; they are not durable
assets. Earlier small report `chiptunes-envelope-writes-bQok78` had capture
cutoff/onset contamination and is superseded by these reports.

`--selftest` exercises CSV bounds, same-frame preservation, next-onset exclusion,
logical grouping and capture truncation without the ROM. ROM runs require
`LSDJ_ROM`, `LSDJPLAY` (migration) and `LSDJ_WRITES`. Explicit unavailable paths
fail. Generated SAVs and observer input files are hashed before/after probes.
