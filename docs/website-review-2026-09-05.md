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

No visual fix landed during this review. The native arrangement verification
was kept separate from UI changes. Next UI work should start with layout
reproductions and visible interaction checks at both viewport sizes, then
review a playing song and a populated Create document, not only blank state.
