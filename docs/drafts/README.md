# Deferred Claude drafts

`claude-2026-09-07.json` preserves work produced before Claude exhausted its
session allowance. It is **not production source or an approved patch**.

- `trackedDiff` and `newFiles` reconstruct the provisional composition/editor
  checkpoint against `0dd5655`. Source changes were removed from the shared
  checkout after review found unresolved correctness/data-loss issues.
- `reviewDrafts` preserves later Claude proposals. They are **alternatives**,
  not sequential patches to apply wholesale. Some hunks target stale source.
- The tested native-document foundation, bounded parser and observer are
  separately committed source; do not replace them with an older draft.

Known remaining issues: caller-pinned tempo can be changed by later mood ops;
reference readback can claim overridden traits. The first native UI lacks
keyboard isolation and atomic staged-row controls. Its later rewrite improves
staging/resume but duplicates an unsafe decoder, interpolates invalid draft
text into HTML, fails to consume Escape, and replaces unsaved state without
confirmation. The shared parser is already strict: reuse it, do not resurrect
the duplicated decoder. No native playback or sound parity exists in these
drafts. `docs/HANDOFF.md` records the focused tests and remaining work.
