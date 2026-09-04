# Chiptunes.app and WebMCP

**Live:** <https://chiptunes.app> · **Repo:** this one, MIT licensed ·
**Tools:** 16, registered on `document.modelContext` and `navigator.modelContext`

A register-level Game Boy sound chip, a deterministic composer, and a
music studio that an agent can drive from inside the page — with no
server, no API key, and nothing metered.

---

## Why this is a strong fit for WebMCP

Most agent-facing music tools are a hosted model behind a key. That shape forces
three compromises WebMCP removes entirely:

**The capability travels with the page.** The composer, the DMG emulation, the
MIDI writer and the cartridge builder are all in the bundle already, because the
website needs them. Exposing them through `document.modelContext` costs one
file. An agent that can open a tab can write music — no credential to obtain, no
account to create, no quota to exhaust, no bill to run up. There is nothing to
sign up for because there is no server to sign up to.

**A song is 1.6 ms, so an agent can afford to iterate.** `chiptunes_variations`
returns twelve complete, different songs in about **80 ms**, measured in the
page by the gate. Against a hosted model, generating twenty candidates to offer
a real choice is a minute of waiting and twenty billable generations, so nobody
does it. Here it is free and instant, which changes what an agent should
*attempt*, not just how fast it finishes.

**The agent and the person are looking at the same thing.** This is the part a
server-side API cannot do at all. The tools operate the session the user is
actually watching: what is on air, skip it, put this song on the deck, open the
tracker, change the display. The user hears the result as the agent works, and
can grab the mouse at any point — the agent's tools are thin calls into the same
functions the buttons call, so the two can never end up in different states.

---

## How it creates a better user experience

Ask for music the way you would ask a person, and be told the truth about what
happened:

> *"a dungeon theme like Castlevania, 40 seconds, no drums"*
>
> → `like Castlevania (platformer), used for: rock/punk, 145-172 bpm, menacing,
> intense, arpeggiated · scene: cave · length: 40s · without Drums`

Three things that summary is doing, all of which exist because a generator that
quietly does something adjacent is worse than one that says no:

- **It names back what it understood**, dial by dial, so you can disagree with a
  reading instead of guessing why the output is wrong.
- **It refuses out loud.** A waltz, vocals, a guitar, a Dorian mode, reverb, or
  a game it does not know — each comes back with the reason. "Everything here is
  in four; the composer has no meter dial" is more use than a 4/4 ballad.
- **The words move the notes**, and that is measured rather than claimed. Over
  22 songs each, happy vs sad separates on major-flavoured material 0.94/0.00,
  tempo 144/120, phrase arc +1.8/−1.6, consonance 0.99/0.64. `npm run
  test:language` asserts every gap, and that each song is sorted correctly **93%
  of the time by the writing alone** — with major/minor and tempo excluded from
  the classifier, since those are the easy half.

And what comes out is yours: a share link carrying the whole arrangement in the
URL fragment (which browsers never send to a server), a Standard MIDI file, or a
32 KB `.gb` cartridge that boots on real hardware. The provenance is a
deterministic algorithm in a public repository, not a model trained on other
people's recordings — which is the whole question for anyone shipping a game.

---

## What people and agents can do together that was hard before

**Score a game in one conversation, in the browser, for nothing.**

A developer says "I need music for my platformer — menu, overworld, boss, game
over". The agent calls `chiptunes_capabilities` to learn the actual vocabulary
instead of guessing, composes each cue, and — because it cannot listen — calls
`chiptunes_analyse` to *check its own work*: is the boss cue really minor, is it
denser than the menu, does the game-over cue end on the tonic. It offers twelve
boss themes rather than one, because twelve cost 80 ms. The user hears each in
the page as it is put on the deck, says "that one, but gloomier", and the agent
transforms the exact song they just heard — not an approximation of it, the same
document. Then it hands over MIDI and a cartridge.

None of that loop is possible against an opaque waveform behind a key. It needs
music that is **symbolic** (so it can be measured and transformed exactly),
**free and instant** (so breadth is affordable), and **in the page** (so the
user and the agent share one session). WebMCP is what makes the third one true.

The measurement loop is the part I would point at specifically: an agent working
with audio is normally blind, guessing from a prompt whether the output matched.
Here it can ask.

---

## How WebMCP was implemented

One file: [`src/webmcp.js`](../src/webmcp.js).

```js
document.modelContext.registerTool({
  name: 'chiptunes_ask',
  description: 'Describe music in a sentence and hear it...',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  execute: async (input) => ({ content: [{ type: 'text', text: JSON.stringify(run(input), null, 2) }] })
});
```

- **`what_can_i_do_here`** — the orientation tool. WebMCP has no page-to-agent
  instruction channel (`provideContext` was removed from the spec), so a page's
  only voice is its tool names, descriptions and results. This one is named as
  the question a person types, and returns prose meant to be relayed. **It
  answers on a cold load** — the text is a constant carried by the inline
  registrar, because the tool most likely to be called first must never reply
  "still loading". Gated with the bundle deliberately delayed 9 s.
- **`chiptunes_lsdj_cart`** — fills a Game Boy cartridge. Writes an LSDj `.sav`
  with up to 32 songs, phrases and chains and groove intact, ready to copy onto
  a flash cart. About 60 ms for eight songs, measured in the page. For somebody
  who writes on the hardware this is the whole offer: not a finished track, but
  a starting point in every slot.
- **15 more**, in two groups. *Operating the session:* `now_playing`,
  `play_mood`, `transport`, `current_song`, `play_song`, `editor`, `variant`,
  `screen`. *Composing without a server:* `capabilities`, `ask`, `compose`,
  `variations`, `analyse`, `export`.
- **The page adapts to who is driving.** On `/webmcp`, when a model context is
  present the explainer demotes to a corner bar and hands the screen to the
  instrument — an agent browser already has a chat, and the person wants to see
  and hear the thing. It is a default, set once: a host appearing later never
  snatches the panel from someone who asked for it.
- **Registered on every surface present** — `document.modelContext` (the spec
  and the Challenge rules), `navigator.modelContext` (the W3C draft and Chrome),
  and `window.modelContext` — deduped by object identity, with `provideContext`
  as an alternative shape. Registering on only one is how this broke the first
  time.
- **Three timing layers**, because an agent may enumerate tools the instant the
  document parses or inject its model context seconds later:
  1. a **pre-hydration registrar inlined as the first child of `<body>`**, which
     matters here because the bundle is `defer`red and therefore runs *after*
     parsing — an agent looking early would otherwise find nothing. Its
     descriptors are generated at build time from `src/webmcp.js` itself, so the
     inline copy cannot drift, and its execute stubs wait up to 10 s for the
     real dispatcher and then fail politely instead of hanging.
  2. the bundle's own registration when it runs;
  3. **two minutes of polling** plus retries on `load`, `focus`, `pointerdown`
     and `visibilitychange`.
- **Schemas declare `type`, `properties` AND `additionalProperties`**, normalised
  centrally rather than trusted to fourteen hand-written literals. A malformed
  input schema is the most common way a registration is dropped without a word.
- **Failures return `isError: true`** alongside the JSON, so the model can tell
  a failure from an answer.
- **Registration is per-tool inside try/catch**, so one descriptor a host
  dislikes cannot take the other thirteen down with it.
- **Agent calls are narrated on screen** — "🤖 agent: switched the screen to
  nes" — and a human clicking the same control is not, so a person watching
  always knows who did what. Gated both ways.
- **Tools return errors, never throw.** A thrown error reads to an agent as a
  broken page; a returned one is something it can tell the user about.
- **Same implementation as `window.chiptunes`**, so console, automation and
  WebMCP cannot diverge.

**A bug worth naming, because it is the reason the gate exists.** This code
originally registered on `navigator.modelContext`. The spec surface is
`document.modelContext`. In every browser that actually implements WebMCP — the
ChatGPT desktop app's in-app browser, Chrome with
`chrome://flags/#enable-webmcp-testing` — **not one tool would have registered**,
while the page looked perfectly healthy and every local test passed, because the
test shim had been written against the same wrong surface. The test and the code
agreed with each other and both were wrong.

[`scripts/verify-webmcp.js`](../scripts/verify-webmcp.js) now installs the
**spec** shim before any page script runs, exactly as an agent browser does, and
then *calls every tool for real* against the built bundle: register, learn the
vocabulary, ask in English, measure the result, be refused, generate twelve,
play one, export a link, a cartridge and a MIDI file. It runs in `npm test`. It
caught a second live bug immediately — `variations()` returns an envelope, not
an array, and the tool was calling `.map` on it.

---

## Prior work vs. work added during the Submission Period

The submission window opened **2026-08-25, 11:00 PT**.

**Pre-existing (not submitted for evaluation).** The product itself: the
register-level DMG emulation, the deterministic composer, the tracker, the
fourteen visualizers, the WebGL screen pipelines, the cartridge exporter, the
radio stream. Note that this repository's first commit is 2026-08-26 because the
public repository was initialised then; the project is older than that, and
`AGENTS.md` records design decisions from 2026-07-18 onward. **It is a
pre-existing project and is submitted as one.**

**Added during the window — every commit below is 2026-09-02**, and this is the
work offered for judging:

| commit | what it added |
| --- | --- |
| `f28effb` | the agent surfaces: the API, the CLI, an MCP stdio server, and **`src/webmcp.js`** |
| `841a804` | the plan, reworked around what people actually ask a music generator for |
| `a37a7ba` | instant / free / local, measured |
| `b06a0dd` | scenes, briefs, soundtracks, variants, exact stems |
| `c47b542` | the natural-language field in the product |
| `f9355bc` | MIDI export; unranked `variations` |
| `b9b0c7a` | the variety gate |
| `0389037`–`acbbeea` | the prompt vocabulary: genres, game genres, forms, techniques, honest refusals |
| `f58de0b`, `70dc219` | 115 game titles read as genre + character |
| `c9514ca` | the composing operations, so the words move the notes |
| *(this commit)* | `document.modelContext` registration, six composing tools, `verify-webmcp.js` |

Everything in `src/webmcp.js`, `src/api.js`, `src/reference-styles.js`,
`mcp/server.js`, `bin/chiptunes.js`, `scripts/verify-api.js`,
`scripts/verify-language.js` and `scripts/verify-webmcp.js` was written inside
the window. `git log --since=2026-08-25 -- src/webmcp.js src/api.js` shows it.

---

## Testing it

**Live URL:** <https://chiptunes.app> — no login, nothing to install, free.

In the **ChatGPT desktop app's in-app browser**, or **Chrome 149+** with
`chrome://flags/#enable-webmcp-testing` enabled and the browser restarted, open
the page and the 14 tools register automatically. Things worth asking for:

- *"What can this thing do?"* → `chiptunes_capabilities`
- *"Write me a dungeon theme like Castlevania, 40 seconds, no drums"* → `chiptunes_ask`
- *"Is it actually in a minor key? How busy is it?"* → `chiptunes_analyse`
- *"Give me a dozen boss themes to pick from"* → `chiptunes_variations`
- *"Make that one gloomier"* → `chiptunes_variant`
- *"I'll take it as a cartridge"* → `chiptunes_export`

**If your agent says it has no tools**, open `/webmcp` and press *"What did this
page detect?"*. It prints which of the three surfaces existed and how many tools
registered, which separates the two causes that otherwise look identical: the
page failed to register, or the page registered fine and the client is not
passing page-defined tools to its model. In ChatGPT's browser, site tools are
gated behind **Settings → Browser → Permissions → Enable site tools**.

Without a WebMCP browser at all, the same tools are on `window.chiptunes` — try
`chiptunes.tools`, then `chiptunes.call('chiptunes_ask', { text: 'a boss theme' })`
in the console. You can also make any browser a host by hand:

```js
navigator.modelContext = { registerTool: t => (window.T = window.T || []).push(t) };
// the page's polling picks it up within half a second
setTimeout(() => window.T[1].execute({ mood: 'happy' }), 1000);
```

```bash
npm install && npm run build && npm test     # 22 gates, including test:webmcp
npm run test:webmcp                          # this file's claims, checked
npm run test:webmcp:live                     # ...against the DEPLOYED site
```

`verify-webmcp` installs the spec's `document.modelContext` before any page
script (as an agent browser does), calls all 16 tools for real, and additionally
proves: the orientation tool answers with the bundle 9 s away; a host injected
*after* load is picked up within 1.5 s and its tools work; agent calls are
narrated on screen and human clicks are not; the explainer yields in agent mode.
`VERIFY_URL=` runs the whole thing against production.
