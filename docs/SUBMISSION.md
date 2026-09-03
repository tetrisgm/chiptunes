# Devpost submission — copy from here

Everything the form asks for, in the order it asks. Nothing below needs editing
except the two owner-only items flagged at the bottom.

---

## Project name

```
Chiptunes.app
```

## Elevator pitch (200 char limit — this is 166)

```
Ask an agent for Game Boy music and hear it in the tab. 15 WebMCP tools drive a real DMG sound chip and a deterministic composer — no server, no key, nothing metered.
```

Two alternates, if you want a different emphasis:

- *(180)* `A Game Boy studio your agent can drive. 15 WebMCP tools compose, measure and export real chip music in the tab — twelve complete songs in 80 ms, no server, no key, nothing metered.`
- *(179)* `A register-level Game Boy sound chip and a composer, running in your tab. 15 WebMCP tools let an agent write, measure and export chiptunes. No server, no API key, nothing metered.`

## Thumbnail (JPG/PNG/GIF, 5 MB max, 3:2)

`promo-video/out/thumbnail.png` — 1200×800, 3:2, ~0.7 MB.
Square logo if anything else wants one: `promo-video/out/logo.png` (512×512).
Gallery: `promo-video/out/gallery/01.png` … `09.png`, same 3:2.

## Live URL

```
https://chiptunes.app/webmcp
```

No login, nothing to install, free. Works with or without a WebMCP browser.

## Repository

```
https://github.com/tetrisgm/chiptunes
```

MIT licensed (`LICENSE` at the root, so it shows in the About box).

## Video

`promo-video/out/chiptunes-webmcp.mp4` — 51 s, 1280×720. **Silent: narration
still to record.** Script and timings below.

---

# Project details (the "Project Story" box)

## Built with (tags)

```
javascript, webmcp, mcp, web-audio-api, audioworklet, webgl, glsl, canvas,
html5, css, node.js, playwright, remotion, cloudflare-pages, game-boy,
emulation, midi, procedural-generation, music-generation, chiptune
```

## "Try it out" links

```
https://chiptunes.app/webmcp
https://github.com/tetrisgm/chiptunes
https://chiptunes.app
```

## Image gallery (3:2, up to 15)

`promo-video/out/gallery/01.png` … `09.png` — nine 1200×800 slides, in order.
Every one of them is a **real frame** from the recorded agent session or the
live page, captioned with what it proves. Upload in numeric order.

## About the project *(paste as Markdown)*

```markdown
## Inspiration

Every AI music tool is a model behind an API key. You send a prompt, you wait,
you get back an opaque waveform, and you pay per attempt. That shape quietly
decides what an agent is allowed to try: nobody generates twenty candidates to
offer a real choice, because twenty candidates is a minute of waiting and twenty
billable generations.

Chiptunes already had the opposite shape and I hadn't noticed. It's a
register-level emulation of the Game Boy sound chip with a deterministic
composer, and all of it runs **in the browser tab** because the website needs it
there. A song takes 1.6 milliseconds. Nothing is uploaded, because there's
nothing to upload it to.

WebMCP is what turns that from an implementation detail into a capability. If
the composer is already in the page, then an agent that can open a tab can write
music — with no credential, no account, no quota and no bill. There is nothing
to sign up for because there is no server to sign up to.

## What it does

Fifteen tools on `document.modelContext`, in two groups.

**Composing, with no server involved:**

- `what_can_i_do_here` — the page introduces itself. WebMCP has no page-to-agent
  instruction channel (`provideContext` was removed from the spec), so a page's
  only voice is its tool names, descriptions and results. This one is named as
  the question a person types, and returns prose meant to be relayed.
- `chiptunes_ask` — *"a dungeon theme like Castlevania, 40 seconds, no drums"*,
  and it reports exactly what it understood, what it ignored, and what it
  refused.
- `chiptunes_variations` — **twelve complete, different songs in about 70 ms**,
  unranked. Nothing is scored or pre-selected; the choosing is the agent's.
- `chiptunes_analyse` — an agent can't listen, so it **measures**: how major or
  minor the pitch material is, whether phrases climb or fall, how much the
  melody agrees with the chords under it, how busy it is, whether it ends on the
  tonic.
- `chiptunes_export` — a share link carrying the whole arrangement in the URL
  fragment, a Standard MIDI file, or a **32 KB `.gb` cartridge that boots on
  real hardware** — all built in the page.

**Driving the session the user is watching:** what's on air, skip, put this song
on the deck, open the tracker, change the display, make the playing song
gloomier. The tools are thin calls into the same functions the buttons call, so
the agent and the person can never end up in different states — and the user
hears every step as it happens.

## How I built it

`src/webmcp.js` is the whole WebMCP layer. It registers on **every surface
present** — `document.modelContext` (the spec and these rules),
`navigator.modelContext` (the W3C draft and Chrome), `window.modelContext` —
deduped by object identity, per tool inside try/catch.

Timing turned out to be the hard part, in three layers. The app bundle is
`defer`red, so it runs *after* the document parses; an agent enumerating tools
early would find nothing at all. So a **pre-hydration registrar is inlined as
the first child of `<body>`**, with descriptors generated at build time from
`src/webmcp.js` itself so the inline copy can never drift from the module. Then
the bundle registers when it runs. Then two minutes of polling, plus retries on
`load`, `focus`, `pointerdown` and `visibilitychange`, for hosts that inject
late.

`what_can_i_do_here` gets special treatment: its text is a constant carried by
the inline registrar, so it answers on a completely cold page. It's the tool
most likely to be called first, and "still loading" is a worse greeting than
silence.

The page also **adapts to who is driving**. On `/webmcp`, when a model context
is present the explainer demotes to a corner bar and hands the screen to the
instrument — an agent browser already has a chat; the person wants to see and
hear the thing. And every agent-driven call is **announced on screen** ("🤖
agent: switched the screen to nes") while a human clicking the same control is
not, so nobody wonders why the music changed.

## Challenges I ran into

**The bug that would have sunk it.** I registered on `navigator.modelContext`.
The spec surface is `document.modelContext`. In every browser that actually
implements WebMCP, **not one tool would have registered** — and nothing would
have looked wrong: the page was healthy, the console API worked, and my test
passed, because the test shim had been written against the same wrong surface.
The test and the code agreed with each other and both were wrong.

That's why the gate now installs the **spec** shim before any page script, the
way an agent browser does, and calls every tool for real. It immediately found a
second bug that could only ever have appeared at the agent: `variations()`
returns an envelope, not an array, and the tool was calling `.map` on it.

**A registrar that was silently dead.** My inline registrar matched `<body` with
a regex — and hit the text `<body>` inside a **CSS comment** in the inline
stylesheet, injecting the whole script into the middle of a comment. The page
looked completely normal and had no tools.

**Making the words actually mean something.** A mood used to be three settings —
mode, tempo, octave — applied after the fact, so a happy song and a sad song
were the same tune under different lighting. I added four operations that change
how the music is *written*: consonance against the chord underneath, the rise or
fall of a phrase (in scale degrees, so it reshapes rather than detunes), leaps
turned into steps, and emphasis on the beat.

Then I built `analyse()` to check the claim, and it immediately caught a real
musical error of mine: I'd defined consonance as pitch-class set membership, so
a third above the bass counted as a clash. The same wrong definition sat in the
operation *and* the measurement, so they agreed with each other and were both
wrong.

## Accomplishments I'm proud of

**The claims are measured, not asserted.** Over 22 songs each, "happy" and "sad"
separate on major-flavoured pitch material 0.94/0.00, tempo 144/120, phrase arc
+1.8/−1.6, consonance 0.99/0.64 — and each song is classified correctly **93% of
the time by the writing alone**, with major/minor and tempo excluded from the
classifier because those are the easy half. `npm run test:language` asserts
every one of those gaps.

**The demo works without WebMCP.** Most visitors — and possibly a judge in a
hurry — don't have a WebMCP browser. The `/webmcp` page has a "Try it right now,
agent or not" row that calls the same implementation an agent gets, with the
JSON shown and the station audibly responding.

**And it tells you when it can't help.** A waltz, vocals, a guitar, a Dorian
mode, reverb, a game it doesn't know — each comes back with a reason.
*"Everything here is in four; the composer has no meter dial"* is more use than
a 4/4 ballad and a confident summary.

## What I learned

Two of my worst bugs this week had the same shape: **the test and the code
agreed with each other and were both wrong.** The WebMCP surface, and the
definition of consonance. A test that shares an assumption with the code under
test verifies nothing. Both are now checked against something external — the
spec's own API shape, and a measurement taken from the audio content.

And WebMCP's real advantage isn't "an API without the HTTP". It's that the
capability and the user are *in the same place*. The agent isn't fetching a
result to describe; it's operating an instrument the person is listening to, and
can hand back at any moment.

## What's next

Streaming a cue while an agent adjusts it, so a game developer can hear a boss
theme escalate live rather than in takes. And an agent-facing loop point editor
— the composer already knows its own bar structure, and adaptive game audio
needs exactly that.
```

---

# Text description

## Why this use case is a strong fit for WebMCP

Most agent-facing music tools are a hosted model behind an API key. That shape
forces three compromises WebMCP removes completely.

**The capability travels with the page.** The composer, the register-level Game
Boy sound chip, the MIDI writer and the cartridge builder are already in the
bundle, because the website needs them. Exposing them through
`document.modelContext` costs one file. An agent that can open a tab can write
music: no credential to obtain, no account, no quota, no bill. There is nothing
to sign up for because there is no server to sign up to.

**A song is 1.6 ms, so an agent can afford to iterate.** `chiptunes_variations`
returns twelve complete, different songs in about 70 ms, measured in the page by
our gate. Against a hosted model, generating twenty candidates to offer a real
choice means a minute of waiting and twenty billable generations, so nobody does
it. Here it is free and instant, which changes what an agent should *attempt*,
not just how fast it finishes.

**The agent and the person are looking at the same thing.** A server-side API
cannot do this at all. The tools operate the session the user is actually
watching and hearing: what is on air, skip it, put this song on the deck, open
the tracker, change the display. The tools are thin calls into the same
functions the buttons call, so the two can never end up in different states, and
the user can take the mouse at any moment.

## How it creates a better user experience

Ask for music the way you would ask a person, and be told the truth about what
happened. *"A dungeon theme like Castlevania, 40 seconds, no drums"* comes back
as `like Castlevania (platformer), used for: rock/punk, 145-172 bpm, menacing,
intense, arpeggiated · scene: cave · length: 40s · without Drums`.

- **It names back what it understood**, dial by dial, so you can disagree with a
  reading instead of guessing why the output is wrong.
- **It refuses out loud.** A waltz, vocals, a guitar, a Dorian mode, reverb, a
  game it does not know — each comes back with a reason. *"Everything here is in
  four; the composer has no meter dial"* is more use than a 4/4 ballad.
- **The words move the notes, and that is measured rather than claimed.** Over
  22 songs each, happy vs sad separates on major-flavoured pitch material
  0.94/0.00, tempo 144/120, phrase arc +1.8/−1.6, consonance 0.99/0.64. Each
  song is sorted correctly 93% of the time **by the writing alone**, with
  major/minor and tempo excluded from the classifier.
- **Agent actions are announced on screen** — *🤖 agent: switched the screen to
  nes* — and a human clicking the same control is not, so nobody is left
  wondering why the music changed.

What comes out is yours: a share link carrying the whole arrangement in the URL
fragment (which browsers never send to a server), a Standard MIDI file, or a
32 KB `.gb` cartridge that boots on real hardware. Provenance is a deterministic
algorithm in a public repository, not a model trained on other people's
recordings — the whole question for anyone shipping a game.

## What people and agents can do together that was difficult or impossible before

**Score a game in one conversation, in the browser, for nothing.**

A developer says *"I need music for my platformer — menu, overworld, boss, game
over."* The agent calls `chiptunes_capabilities` to learn the real vocabulary
instead of guessing, composes each cue, and — because it cannot listen — calls
`chiptunes_analyse` to **check its own work**: is the boss cue really minor, is
it denser than the menu, does the game-over cue end on the tonic. It offers
twelve boss themes instead of one, because twelve cost 70 ms. The user hears
each in the page as it goes on the deck, says *"that one, but gloomier,"* and
the agent transforms the exact song they just heard — the same document, not an
approximation. Then it hands over MIDI and a cartridge.

None of that loop works against an opaque waveform behind a key. It needs music
that is **symbolic** (so it can be measured and transformed exactly), **free and
instant** (so breadth is affordable), and **in the page** (so the user and the
agent share one session). WebMCP is what makes the third one true.

The measurement loop is the part worth pointing at: an agent working with audio
is normally blind, guessing from a prompt whether the output matched. Here it
can ask.

## How WebMCP was implemented

One file: `src/webmcp.js`.

```js
document.modelContext.registerTool({
  name: 'chiptunes_ask',
  description: 'Describe music in a sentence and hear it...',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } },
                 required: ['text'], additionalProperties: false },
  execute: async (input) => ({ content: [{ type: 'text', text: JSON.stringify(run(input), null, 2) }] })
});
```

- **15 tools.** `what_can_i_do_here` (orientation) · composing without a server:
  `capabilities`, `ask`, `compose`, `variations`, `analyse`, `export` · driving
  the live session: `now_playing`, `play_mood`, `transport`, `current_song`,
  `play_song`, `editor`, `variant`, `screen`.
- **Every surface, deduped**: `document.modelContext` (spec and these rules),
  `navigator.modelContext` (W3C draft and Chrome), `window.modelContext`.
- **Three timing layers.** Our bundle is `defer`red, so it runs *after* parsing
  and an agent enumerating early would find nothing. A **pre-hydration registrar
  is inlined as the first child of `<body>`**, its descriptors generated at build
  time from `src/webmcp.js` itself so the two cannot drift. Then the bundle
  registers. Then two minutes of polling, plus retries on `load`, `focus`,
  `pointerdown` and `visibilitychange`, for hosts that arrive late.
- **`what_can_i_do_here` answers on a cold load.** It is the tool most likely to
  be called first, and "still loading" is a worse greeting than silence, so its
  text is a constant carried by the inline registrar and depends on nothing. Our
  gate proves it with the bundle deliberately held back nine seconds.
- **Schemas declare `type`, `properties` and `additionalProperties`**, normalised
  centrally rather than trusted to fifteen hand-written literals. Failures return
  `isError: true` with a message that teaches the next step — *"No song is
  loaded yet. Compose one first with chiptunes_ask."* Registration is per-tool
  inside try/catch, so one descriptor a host dislikes cannot take the rest down.
- **The page adapts to who is driving.** On `/webmcp`, when a model context is
  present the explainer demotes to a corner bar and hands the screen to the
  instrument. Set once, so a host appearing later never snatches the panel from
  a person who asked for it.

**One bug worth naming**, because it is why the gate exists. This code first
registered on `navigator.modelContext`. The spec surface is
`document.modelContext`. In every browser that actually implements WebMCP, **not
one tool would have registered** — while the page looked healthy and every local
test passed, because the test shim had been written against the same wrong
surface. The test and the code agreed with each other and both were wrong.

`scripts/verify-webmcp.js` now installs the **spec** shim before any page script,
exactly as an agent browser does, and calls every tool for real against the built
bundle: register, orient, ask in English, measure the result, be refused,
generate twelve, play one, export a link, a cartridge and a MIDI file. It also
proves a host injected *after* load is picked up within 1.5 s. It runs in
`npm test`, and `npm run test:webmcp:live` runs the whole thing against
production. It caught a second live bug immediately: `variations()` returns an
envelope, not an array, and the tool was calling `.map` on it — a failure that
would only ever have appeared at the agent.

## Testing instructions for judges

Open **https://chiptunes.app/webmcp**. No login.

- In **ChatGPT's desktop in-app browser**, site tools are gated behind
  **Settings → Browser → Permissions → Enable site tools** — worth checking
  first. In **Chrome 149+**, enable `chrome://flags/#enable-webmcp-testing` and
  restart.
- The panel shows a **live status line**: green with the tool count and the
  surface, or amber with instructions. Press **"What did this page detect?"** to
  see exactly which surfaces existed and how many tools registered.
- **No WebMCP browser? It still demonstrates.** The "Try it right now, agent or
  not" row calls the same implementation an agent gets, with the JSON shown and
  the station audibly responding.

Prompts to try: *"What can this page do?"* · *"Write me a dungeon theme like
Castlevania, 40 seconds, no drums"* · *"Is that actually in a minor key?"* ·
*"Give me a dozen boss themes, then play the third"* · *"Make it gloomier, then
hand me the cartridge."*

## Prior work vs. work added during the submission window

The window opened **2026-08-25, 11:00 PT**. **Chiptunes is a pre-existing
project and is submitted as one.** Pre-existing: the DMG emulation, the
composer, the tracker, the visualizers, the screen pipelines, the cartridge
exporter, the radio. (This repository's first commit is 2026-08-26 because the
public repo was initialised then; `AGENTS.md` records design decisions from July
onward.)

**Everything offered for judging landed 2026-09-02 and 2026-09-03**, inside the
window: `src/webmcp.js`, `src/webmcp-demo.js`, `src/api.js`,
`src/reference-styles.js`, `mcp/server.js`, `bin/chiptunes.js`,
`scripts/verify-webmcp.js`, `scripts/verify-api.js`,
`scripts/verify-language.js`, the `/webmcp` route and the pre-hydration
registrar in `build.js`. `git log --since=2026-08-25` shows it; the commit table
is in `docs/WEBMCP.md`.

---

# Narration script for the video

51 s of footage, silent. Read at a normal pace; the timings are where each shot
starts. Everything below is a claim the demo actually shows.

| at | on screen | say |
| --- | --- | --- |
| 0:00 | title card | "Chiptunes is a Game Boy studio that runs entirely in a browser tab — a register-level emulation of the DMG sound chip, and a composer that writes complete songs for it." |
| 0:03 | /webmcp panel | "For the WebMCP Challenge I exposed all of it as fifteen tools on document dot modelContext. No server, no API key, nothing metered — because the composer is already in the page." |
| 0:06 | detection probe | "The page tells you what it detected, so 'my agent can't see the tools' has a diagnosis instead of a shrug." |
| 0:09 | agent session begins | "Here's a real agent session. It starts by asking the page what it is." |
| 0:11 | chiptunes_ask | "Then it asks for music in plain English — a dungeon theme like Castlevania, forty seconds, no drums — and the page says exactly what it understood." |
| 0:16 | chiptunes_analyse | "An agent can't listen. So it measures instead: how minor the pitch material is, whether the phrases climb or fall, how busy it is." |
| 0:19 | chiptunes_variations | "A song takes one and a half milliseconds, so twelve complete, different songs come back in about seventy. Breadth is free here, and it isn't anywhere else." |
| 0:27 | chiptunes_variant | "It recomposes the exact song you just heard — not an approximation, the same document." |
| 0:32 | chiptunes_screen | "It drives the display too. You hear and see every step, and you can take the mouse back at any time." |
| 0:35 | chiptunes_export | "And it hands you a thirty-two kilobyte cartridge that boots on real hardware." |
| 0:39 | end card | "Chiptunes dot app slash webmcp. Open the tab, and ask for music." |

---

# ⚠️ Owner-only, still outstanding

1. **Register on Devpost** and create the submission (registration and
   submission both close **2026-09-03, 13:00 PT**).
2. **Record narration** over `chiptunes-webmcp.mp4` and upload to YouTube as
   **public**. The rules require audio covering what you built and how you used
   WebMCP; the script above does that in 51 s.
3. **Confirm the pre-existing-project framing** above is how you want it stated.
