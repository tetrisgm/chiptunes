# Music chat island — source attribution and integration contract

Adapted from Vercel AI Elements, release `ai-elements@1.9.0`, commit
`bc871264341cf54a7ea1fee36d951688ed2a1ff7`:

- https://github.com/vercel/ai-elements/blob/bc871264341cf54a7ea1fee36d951688ed2a1ff7/packages/elements/src/conversation.tsx
- https://github.com/vercel/ai-elements/blob/bc871264341cf54a7ea1fee36d951688ed2a1ff7/packages/elements/src/message.tsx
- https://github.com/vercel/ai-elements/blob/bc871264341cf54a7ea1fee36d951688ed2a1ff7/packages/elements/src/prompt-input.tsx

Copyright 2023 Vercel, Inc. Licensed under Apache License 2.0; the complete
upstream license is in `music-chat-ui.LICENSE.txt`. This is a substantially
modified adaptation, not the upstream drop-in components. Layout, role wrappers,
scroll-to-latest and Enter/IME submission patterns are adapted. Tailwind/shadcn,
Streamdown, all attachment paths, menus, icons, download, AI SDK types and
use-stick-to-bottom are removed. Plain DOM controls, scoped CSS, native scrolling
and ResizeObserver replace them. No third-party component implementation other
than the attributed AI Elements patterns is copied.

Runtime dependencies: `react@19.2.8` and `react-dom@19.2.8`, pinned exactly
in the root package; retain the lockfile for transitive dependencies.
No AI SDK, Next, Tailwind, shadcn,
Streamdown, icon or scrolling package is needed. Bundle production React and
preserve React/ReactDOM and transitive shipped dependency licenses separately.

Export: `mount(container, state, callbacks)` returning `update(fullState)`,
`focus()`, `destroy()`. Container must be empty and dedicated. Bundle as a locally
loaded browser island (named IIFE export if desired); import CSS once via the
shared build. Mount once, hide the host panel on collapse, unmount on disposal.
Host moves focus before hiding, remembers selection/focus, and restores it when
reopening. Host document capture shortcuts must exclude `.mcui`; bubbling alone
cannot defeat an earlier capture listener. No Settings dialog is created here.

State mapping from the current vanilla workspace:

| State | Controller mapping |
| --- | --- |
| `input` | Controller-owned composer string, initially current textarea value |
| `messages` | `project.getChat()` (already bounded/private) |
| `pending` | Boolean `requestId` |
| `canSend` | Access/provider available, not access-busy, and draft validated; controller decides |
| `accessMessage`, `error` | Existing access/status strings; no credentials |
| `suggestions` | Trusted static mood strings, only shown with empty history |
| `proposal` | Current proposal only: `id`, `status`, `summary` from diff, `preview` from source/edit text, `canApply` after invalidation/context checks |

Callbacks: `onInput(text)` synchronously updates host input and calls `update`;
`onSend(trimmedText)` dispatches existing requestChat with that text and only
clears input after beginRequest succeeds; `onStop()` dispatches existing cancel;
`onApply(id)` and `onReject(id)` must recheck current proposal identity and all
existing context/revision guards. `onSettings()` opens the existing host dialog;
`onHide()` calls existing collapse/focus handling. Host handles callback errors,
async completions and rejected requests and publishes new state; callbacks must
not return unhandled rejecting promises. Do not send from render or an effect.

`update` takes a complete immutable snapshot, not a patch. History never carries
action buttons. Request/project identity remains outside the island. Import or
close must cancel/invalidate in the host before replacing state. No persistence,
network, audio, compiler, proposal validation or provider logic is added here.
