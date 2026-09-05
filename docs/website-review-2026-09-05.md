# Website and Create visual review — 2026-09-05

This is a bounded review of actual rendered screenshots, not a completion
claim for the website/player/Create overhaul or LSDj parity. No deployment
was performed. Chromium screenshots do not verify native Safari pointer or
trackpad behavior.

## Builds and method

The deployed home page loaded `app.73c91fbe2963.js`. The local artifact under
test loaded `app.f09d65a88508.js` (the arrangement/duration working change on
top of `508838d`). Each used a fresh headless Chromium page, waited for fonts
and one second after navigation or opening Create, then captured pixels.
The preliminary immediate-click Create capture was mid-transition; it is not
evidence of a half-height settled editor.

Desktop viewport: 1280 × 900. Local mobile-sized viewport: 390 × 844, without
claiming real phone/touch validation. Temporary script:
`/tmp/chiptunes-website-review.js`.

Settled screenshot directories (temporary, not permanent assets):

- Deployed desktop:
  `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/chiptunes-site-review-iEfLEg`
- Local desktop:
  `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/chiptunes-site-review-2m1MyC`
- Local mobile-sized:
  `/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/chiptunes-site-review-v5vzXe`

Each contains `landing.png` and `create.png`.

## Findings and intended follow-through

1. **Desktop landing content is clipped above the viewport.** Both versions
   show the hero's explanatory text but not its top/title. The creator/social
   strip overlays the top of the hero and extends past the right edge.
   `src/shell.html` positions `#madeby` near the top, with a non-wrapping
   `.plmade-row`; inspect this together with the centered hero's height.
   A layout pass needs an in-viewport or intentionally scrollable primary
   form, with attribution subordinate to the primary task. Do not infer a
   scrolling fix from bounding rectangles alone.
2. **Mobile landing's primary form extends beyond the visible bottom.** At
   390 × 844, “Make it” is partly below the capture's viewport boundary and
   the form is wider than the available interior. Actual reachability by
   scrolling remains to be tested. The dense explanatory copy dominates the
   initial screen; composing/listening should not require navigating past a
   large promotional block.
3. **Mobile Create clips parts of the transport and crowds the close button.**
   The left transport icon is cut off at the left viewport edge; the mood row
   runs beneath/near the close control. Several utility actions are offscreen.
   Some horizontal scrolling is deliberate for the timeline, but transport
   and close controls need independent, visible space. Reachability of the
   offscreen actions has not yet been tested.
4. **The local Create prompt is visibly present; production lacks it.** Local
   Create has the descriptive prompt field and “Write song” action, matching
   the earlier shared-interpreter work. This does not establish that the owner
   has received a deployed version. Neither build has visible native
   phrase/chain/table authoring in this blank-editor view.
5. **Hardware/export language is broader than the demonstrated fidelity.**
   The landing promises editing every instrument/effect and offers LSDj
   export alongside other outputs. Native envelopes, kits, tables and many
   commands remain imperfectly represented, as documented in
   `lsdj-editing-capabilities.md`. Create's “Kit”, “Wood”, pulse presets and
   16/24/32-step controls need explicit mapping tests, not assumptions from
   their labels. A 24-step display is not inherently an extra sound capability;
   the relevant question is whether its timing and resulting sound survive
   native export unchanged.
6. **Agent-tool count is stale.** The deployed landing advertises 15 WebMCP
   tools; browser tool discovery returns 16. This is secondary to layout and
   fidelity, but counts should come from the actual registry or be omitted.

No visual fix landed in the original arrangement checkpoint. The subsequent
local UI pass below addresses part of this review; deployment remains separate.

## Subsequent local responsive pass

The landing now uses a content-sized, normal-flow card and footer instead of
centering a tall fixed card above the viewport. Tall-desktop fixed heights and
fixed attribution placement were removed. The screen panel has a bounded
width, the phone title fits its interior, and shorter copy retains the product
explanation while stating that some LSDj sounds/effects still differ. The
hardcoded WebMCP tool count was removed rather than replaced with another
eventually stale number.

The landing also receives pointer input instead of allowing wheel events to
hit the fixed game canvas behind the card. This matters independently of
whether the document has a large `scrollHeight`: visible wheel-input checks
revealed the form, and clicking the empty “Make it” control focused its field.

Create's mood viewport physically stops before its corner close button; a
padding-only reserve allowed scrolling content underneath that button. Phone
transport uses two rows: rewind/play/follow/grid, then speed. Sound labels
grow vertically instead of spilling out of fixed-height buttons. Play/pause
now exposes its current action and state to assistive technology.

`scripts/verify-responsive-layout.js` covers 1280×900, 900×650, narrow-desktop
390×844, 320×568, and iPhone 13 emulation at 390×844. It uses correct asset MIME
types, waits for fonts and the startup overlay to retire, captures screenshots,
uses wheel input and actual clicks, generates a populated editor, checks
play/pause state, reveals the last utility action, and enters the player.
The initial sidecar test had incorrect bounding-box properties and grid IDs;
main corrected these before using its results as evidence. Another initial
wheel test hit the retiring `#hometiles` startup overlay, so the final test
explicitly waits for that overlay to disappear. Neither error was treated as
proof that the layout was wrong or right.

Reviewed final focused screenshots:
`/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/chiptunes-responsive-371FcH`.
This includes populated Create and player views, not only blank grids. All
five focused cases passed. Full-suite results are recorded in HANDOFF.md.
The final local JavaScript artifact is `app.34e325846018.js`; its accompanying
`dist/index.html` SHA-256 is
`798f84c724bb51172a5cdaadf8c023f7f7ab4edfd04944ba9a6fe68c263739a8`.
The JavaScript filename alone does not identify CSS changes in the HTML shell.
An eventual Safari deployment check still needs a visible full-build identity.

Remaining review points:

- Native macOS Safari pointer/trackpad verification of an explicitly deployed,
  visibly versioned build has not occurred. Chromium input tests and WebKit
  engine tests are not substitutes; no Safari interaction fix is claimed.
- Close from a cold-start Create session returns to the prior landing context,
  not an implicit handoff of the edited song to the player. This existing
  behavior was preserved; a clearer “listen to this edit” workflow remains a
  product-level improvement to consider.
- At 1280 pixels, the player capture appears to crowd/truncate its duration
  label near the volume area. This needs a focused layout reproduction and
  visible check, beyond the existing wider-player gate.
- The prompt interpretation is verbose on phones and uses a short scrollable
  status region. A concise primary interpretation plus expandable technical
  details would be easier to read; no such redesign has landed.
- No change here establishes native instrument, table, command or editing
  parity, or an aesthetic listening verdict for the composition changes.
