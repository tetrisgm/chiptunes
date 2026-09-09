# Bounded visual programs (implementation contract)

The visual program is separate from music source. It cannot run JavaScript,
access the DOM/network, capture a microphone, load assets or allocate shaders.
This is a small Chiptunes language, not Hydra or Tidal syntax compatibility.
Layer order, drawing operations, signal routing and palette are editable.

```js
visual({background: "#090615", palette: ["#84f3d5", "#b089ff", "#ffbf69"], feedback: 0.84, seed: 17});
control("motion", {label: "Motion", min: 0, max: 2, step: 0.01, value: 0.8});
control("intensity", {label: "Intensity", min: 0, max: 1, step: 0.01, value: 0.7});
layer("tunnel", {count: 24, speed: param("motion"), size: 0.8, spin: signal("lead.pitch", 0.6), react: signal("bass.hit", 0.9), opacity: param("intensity")});
layer("orbits", {count: 18, speed: 0.4, size: 0.12, spread: 0.8, react: signal("drums.hit"), blend: "lighter"});
```

## Language and bounded intermediate form, version 1

Statements are `visual(object)` (exactly one), `control(name, object)` and
`layer(operation, object)`, terminated with semicolons. Whitespace and `//`
comments are permitted. Values are finite number literals, double-quoted JSON
strings, arrays, objects, `param(name)` and `signal(name[, scale[, offset]])`.
No expressions, assignment, property access, functions, loops or unknown keys.
Duplicate keys, controls and visual declarations fail. References resolve after
parsing, so declarations may follow uses. Diagnostics include source positions.

Limits: UTF-8 source 32 KiB, 4096 tokens, nesting depth 16, 8 layers, 8 controls,
palette 2–8 six-digit hex colors. Static integer counts 1–128 and the sum of
counts at most 512. Each operation emits at most 4 bounded primitives per item.
Program source cannot increase rendering resolution or allocate custom resources.

The module `CT_VISUAL_LANGUAGE` / CommonJS exports `compile(source)` returning
`{ok, program, diagnostics}` (no throws for invalid source), `PRESETS` (objects
with `id`, `label`, `source`), and `LIMITS`. Successful immutable program shape:

```
{version:1, visual:{background,palette,feedback,seed},
 controls:[{name,label,min,max,step,value}], layers:[{op,...parameters}]}
```

Defaults: background `#090615`, palette as above, feedback 0.8, seed 1.
Feedback is static 0–0.95; seed is integer 0–65535.
Control names match `[a-z][a-z0-9_]{0,23}`, labels 1–40 characters; finite
min/max between -16 and 16, min < max, step > 0 and <= range; value within range.
Control values live outside the source and never rewrite it.
`value` is the initial default. Reapplying the same scene retains matching live
values (clamped to any new declared range); newly declared controls use their
defaults. Off and returning to that same scene retain its edited live source
and values. Selecting a different starting scene loads its source/defaults.

Operations: `tunnel`, `tiles`, `orbits`, `ribbons`, `sparks`. Every layer accepts
the same bounded parameters, all optional except the operation:

| Parameter | Default | Evaluation range |
| --- | --- | --- |
| count (static integer) | 24 | 1–128 |
| size | 0.5 | 0.01–2 |
| speed | 0.5 | -4–4 |
| spin | 0 | -4–4 |
| spread | 0.7 | 0–2 |
| hue | 0 | -8–8 (palette offset) |
| opacity | 0.8 | 0–1 |
| react | 0 | 0–2 |
| thickness | 1 | 0.25–8 |
| blend (static) | `source-over` | `source-over`, `lighter`, `screen` |

Dynamic values compile to `{type:'param',name}` or
`{type:'signal',name,scale,offset}`; missing signal is 0, scale/offset default
1/0 and each bounded to -16–16. Resolved values clamp to each property range.
Allowed signals: `audio.bass`, `audio.mid`, `audio.treble`, `audio.level`,
`beat.phase`, `bar.phase`, `lead.hit`, `lead.pitch`, `counter.hit`,
`counter.pitch`, `bass.hit`, `bass.pitch`, `drums.hit`.
Pitch normalizes MIDI 24–108 to 0–1; raw register triggers lack pitch. Hit is
an event envelope, not a claim about audible level. Analysis uses the internal
pre-FX master. Read docs/music-signals.md for exact provenance and loss limits.

## Renderer contract

`CT_VISUAL_RENDERER.create({createCanvas,width=960,height=540})` allocates exactly
two canvases of that fixed size (dimensions independently capped at 960×540).
It has no animation loop, AudioContext, device capture or autonomous scheduler.
`apply(program, values)` validates compiled data and changes the graph without
resetting phase/feedback; `setControl(name,value)` changes saved parameter state.
`render({contextTime,paused,identity,grid,clock})` uses acknowledged music time
and returns `{canvas,error}`. `clock.noteOns` contains only this draw's fresh
events from the existing bounded consumer. Paused time and transport identity
changes reanchor time; catch-up dt is bounded. Hits decay using musical elapsed
time. Drawing into the back buffer becomes visible only after a successful
frame. Recoverable errors retain the last complete front buffer.
`reset()` clears only visual phase/feedback/envelopes; `snapshot()` returns
detached control values, phase, frame count, allocation and render-error state.

This statically bounded renderer prevents source-authored runaway loops and
resource allocation; it is not a promise of process/GPU performance isolation.
The application adapter owns explicit Apply/queue/cancel/freeze/blackout and
calls the renderer once per actual stage draw, never from music compilation.

## Activation semantics

Visual Apply can be immediate or queued to the next acknowledged bar boundary.
Queueing requires a playing music transport. Pause holds the queue; seek,
stop, new music activation/revision or a transport loop cancels it, rather than
silently applying to a different musical timeline. The queued label shows the
target bar. Invalid drafts retain the running program; applying a newer valid
draft replaces a pending change. Changing a slider changes only live control
state; queued parameters remain the explicit snapshot taken at Apply.
Invalid drafts do not cancel an earlier valid queued change: its target and
Cancel control remain visible alongside the error. Audio acknowledgements feed
the controller's `observe(transport)` even if drawing is hidden or Off; this
updates state without drawing or creating an independent interval. Detaching
the workspace cancels queued visual work. Display updates are not sample-accurate.

Freeze stops visual state advancement (music continues); unfreeze reanchors
without replaying missed hits. Blackout masks output but lets the visual state
continue. Reset clears visual feedback and phase, not music. Panic cancels a
queued visual change, blackouts output and explicitly stops music via the
workspace transport. None of these operations evaluates either editor draft.
