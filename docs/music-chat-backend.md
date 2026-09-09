# Music conversation and proposal backend contract

## Status

`server/music-chat-handler.js` is a provider-neutral Fetch handler factory.
The hosted gateway integrates owner-funded providers and private authentication;
the standalone factory still denies unconfigured requests with HTTP 503.
The conversational extension is deployed in web release b7a6d0d.
Code/playback do not depend on a configured backend.

The module implements the request/response boundary and validates musical edits.
It never substitutes the deterministic interpreter for a real model. Test
adapters are named fixtures and exercise the real handler without network calls.
`src/music-chat.js` validates the browser boundary; the workspace owns the
transcript and explicit proposal application.

## Host and adapter interfaces

CommonJS export: `createMusicChatHandler(options) -> async (Request) -> Response`.
Node's standard Fetch/ReadableStream interfaces are used. The host must retain
one factory instance across requests; constructing it per request discards its
in-flight and replay protection. The gateway mounts this same handler.

Without **all** of the following trusted injections the handler denies requests:

| Injection | Required contract |
| --- | --- |
| `origin` | Exact HTTP(S) origin, no trailing slash. URL origin and browser Origin header must both match |
| `authenticate(request, {signal})` | Resolve to `{subject: nonemptyString}` only after validating real credentials/session; null/false denies. Stable subject, at most 256 characters. Host owns authentication and CSRF/session policy |
| `rateLimit({subject, signal})` | Resolve to literal `true` only when permitted. Anything else denies with 429. Host owns distributed quota, concurrency, abuse and spend limits |
| `adapter.authorized` | Literal `true`, set in trusted host configuration only after owner authorization. This flag is an integration assertion, not proof of permission or a credential |
| `adapter.propose(args)` | Make at most one authorized model request; return a Web `ReadableStream<Uint8Array>` containing one JSON proposal |

Adapter arguments are exactly:

```text
system          server-owned instructions and restricted-language capabilities
input           JSON string containing bounded, untrusted musical context
signal          AbortSignal for cancellation, timeout and completion cleanup
tools           frozen empty array
toolChoice      "none"
maxCalls        1
maxOutputTokens 8192
maxOutputBytes  65536
```

An adapter must map `system` to the provider's trusted instruction channel and
`input` to an untrusted user-data channel. It must not interpolate source into
system instructions, enable tools, follow tool calls, add conversations supplied
by the client as privileged messages, retry, call a fallback model, or execute
source. It must reject tool-call/nontext/structured-provider error responses
instead of treating them as proposal text. Convert vendor framing/SSE to a
bounded UTF-8 JSON stream; this handler does not parse provider protocols.

The adapter must enforce the supplied output/token/call bounds **upstream**,
enforce an explicitly approved input-context/token/spend policy before sending,
and honor cancellation by stopping the underlying request and closing the stream.
Byte bounds are not token or currency budgets. A 512 KiB source allowance is not
authorization to pay for that much model context. The adapter must either accept
the approved complete context or fail honestly; it must not silently truncate a
song. Provider-specific token counting, account access, pricing and cost limits
belong to the trusted host integration. No paid call can be made by this module alone.

No HTTP request, principal, credentials, logger, shell, tool implementation or
provider secrets are passed to the adapter in the musical input. Credentials
belong inside the trusted adapter/host, never in browser data. This module
does not read environment secrets, log source/prompts, or expose exception text.
The host/adapter must follow the same logging rule; the handler cannot control
their logging or guarantee cancellation of a non-cooperating remote provider.

## Wire format and limits

POST JSON to the same-origin endpoint (client default `/api/music/chat`).
Request fields are `id`, `request`, `source`, `baseRevision`, with optional
`selection`, `constraints`, `language`, `diagnostics`, `conversation`. Unknown top-level keys are
rejected. IDs use 1–128 ASCII letters/digits/underscore/hyphen. Nonempty request
text is limited to 2,000 UTF-16 code units. Selection is null or
`{ch, fromFrame, toFrame}`. It is context; constraints carry enforceable scope.

`language`/help supplied by the client is discarded, never used as capabilities.
Source/comments, request text and diagnostics are all untrusted data. The only
trusted capabilities are the module's `SYSTEM` constant and the actual compiler.
Changing the language requires reviewing both together. Prompt separation reduces
instruction confusion; structural and compiler validation enforce the boundary.

Optional `conversation` contains at most 12 `{role,content}` messages, with only
`user` and `assistant` roles and at most 16,384 UTF-8 content bytes total. These
are untrusted contextual data inside the provider input, never privileged
provider messages or evidence that a past suggested edit was applied. The
current source/revision and constraints remain authoritative.

| Bound | Value and meaning |
| --- | --- |
| Incoming HTTP body | 1,048,576 UTF-8 bytes (1 MiB), including JSON escaping and metadata |
| Source and candidate source | 524,288 UTF-8 bytes (512 KiB); full relevant source allowed |
| Provider response | 65,536 UTF-8 bytes (64 KiB), consumed incrementally |
| Response | 0–32 ordered localized edits; explanation at most 5,000 UTF-16 code units; zero edits means a conversational answer |
| Changed text | At most 16,384 UTF-8 bytes inserted and 16,384 deleted in aggregate |
| JSON nesting | 32; unsafe prototype keys and unpaired Unicode surrogates rejected |
| Deadline | 30 seconds across auth/quota/body/provider/output; optional timeoutMs may only reduce it |
| Calls/concurrency | One adapter call, no retry; one active request per subject, 32 active subjects per instance |
| Replay memory | 1,024 consumed subject/request-ID pairs per instance; capacity denies new requests, no eviction |

The source cap deliberately accommodates the reported 150–200 KiB materialized
songs. A test sends an entire 2,801-event explicit source in that range and
verifies the adapter receives it unchanged. Transport acceptance does not choose
a model or approve its context cost. JSON escaping can make a source under the
source limit exceed the body limit; the client/host should report that honestly.

Both input and output are incrementally byte-counted regardless of Content-Length
and decoded with fatal UTF-8 handling, including split multibyte sequences.
Responses are fully buffered within the bound and validated before any proposal
is returned. No partial model stream is forwarded to the browser. Cancel/timeout
races every asynchronous operation; a stalled fetch/read/cancel cannot hold the
handler's response indefinitely. Late adapter streams are cancelled as well.
Synchronous compilation uses the language's deterministic resource limits; the
timer cannot preempt synchronous JS. Deadline checks also use elapsed monotonic
time before subsequent work/response. A future hosting runtime must enforce its
own CPU/memory limits; this is not worker isolation.

## Proposal validation and application

The only successful response shape is:

```json
{
  "id": "request-1",
  "baseRevision": "r1",
  "edits": [{"from": 120, "to": 122, "text": "62"}],
  "explanation": "Proposed pitch change."
}
```

IDs must match the request. Edits have exactly `from`, `to`, `text`, with safe
integer UTF-16 offsets, half-open ranges within the supplied source, ascending
order, no overlaps or duplicate start positions, and no split surrogate pairs.
Whole-source replacement, collective removal of the whole source, unchanged
output and oversized changes are rejected. This is a bounded textual-locality
contract, not an AST-locality claim. Unknown response fields, tools, malformed
JSON or invalid music fail without retry.

For a text-only answer, `edits` is `[]` and `explanation` is the assistant message.
The UI completes the pending request without creating a revision or offering
Apply. Responses remain fully buffered and validated, not simulated streaming.
Private project history keeps a bounded recent transcript (64 messages,
131,072 UTF-8 JSON bytes); public shares and project transfers omit it.

The original source and edited candidate compile using `src/music-language.js`.
`src/music-project.js.checkConstraints` checks supplied track/pitchrhythm/
instrument/arrangement locks and track/frame scope against the actual compiled
musical difference, not the explanation. This enforces supplied constraints; the
server has no independently stored project/lock authority or current revision.

The client must still verify request identity, its current base source/revision
and draft epoch, validate against its current constraints, and present Apply.
It must pass only `{id, baseRevision, baseSource, edits}` to the project validator,
keeping explanation separate. The project rejects unknown proposal fields.
Only an explicit project Apply creates a revision. Model explanation remains
untrusted suggested prose; applied summaries come from the project's musical
diff. A response cannot establish that playback activated the revision.

Consumed request IDs remain consumed after success, cancellation, invalid source,
or invalid provider output. A deliberate later request needs a new ID. The
process-local guard is not a distributed idempotency store and resets on restart;
host quota/idempotency must cover multiple instances and any remote call that
ignores cancellation. Capacity fails closed rather than silently evicting replay
records. No persistent job/store was installed to solve that future host concern.

HTTP failures contain only a stable error code: 503 unconfigured/capacity, 401
unauthorized, 403 origin, 405 method, 415 media type, 429 quota, 409 active/replay,
400 invalid JSON/context/source/constraints, 413 invalid or oversized body, 502
invalid provider stream/proposal/constraint violation or generic backend failure,
504 timeout, 499 cancellation. All handler responses are JSON with no-store and
nosniff. No provider exception body is returned.

## Client enforcement and verification

Run `node scripts/verify-music-chat.js`. No real provider is used. Tests exercise
the handler, actual `src/music-chat.js`, and the real language/project modules.
VM tests load the actual client source with a fake timer to test its 30-second
deadline without a 30-second wait. Backend tests use brief real deadlines.

Observed validation: 28/28 chat groups pass. The earlier backend verification
also passed the existing 16 language groups and 19 project groups.

Covered: default denial, auth/origin/quota, full-song context, one-call contract,
untrusted instruction separation, strict edits, compiler/lock enforcement, UTF-8
chunk splits/invalid bytes/oversize, stalled input/output/provider, abort,
concurrency, replay, offline/404/503/429, valid proposal/apply, duplicate project
response/application, late cancellation versus a newer request, and manual-edit
races. Main's updated client exact-ID check, fatal decoder, request/fallback byte
bounds and nonblocking oversized-stream cancellation have preservation tests.

The follow-up fixes the previously characterized client gaps:

- Timeout and explicit cancel race fetch, each stream read and fallback text
  consumption, even when the transport ignores AbortSignal. They settle promptly,
  abort the transport, cancel unread bodies without waiting for cancellation,
  release reader locks, and free active state. Late fetch bodies are cancelled;
  an older request's cleanup cannot clear a newer active request.
- The client validates the exact response envelope and every edit object, matching
  backend locality/range/count/byte bounds, sorted non-overlap, Unicode boundaries,
  and rejection of no-op/whole-source replacements. It snapshots the wire context
  so caller mutation cannot change the base identity during a request. Musical
  compilation and current revision/lock enforcement still belong to backend and
  project; transport success never authorizes application on its own.
- Each Client retains up to 1,024 request-ID tombstones, including failures and
  cancellations. Duplicate IDs are rejected; capacity fails closed without
  eviction. Starting a new client resets local memory, but does not reset backend
  replay protection. UI IDs must be collision-resistant across reloads (main's
  UUID generation outside the musical path), not a serial restarting at request-1.
- Default native fetch is bound to its global receiver, preventing browser
  `Illegal invocation`; injected fetch identity is retained. A brand-check fixture
  verifies the receiver, while main owns the full browser integration rerun.

Tests now assert preservation for all three former loss characterizations, plus
stalled-read/fallback/cancel cleanup, error-body cleanup, context mutation and
the native fetch receiver. No provider integration, billing, deployment, browser UI test,
production authentication, distributed quota, or real-model quality test has
been performed or claimed.
