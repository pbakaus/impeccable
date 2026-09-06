---
version: 1
slug: "crates-context-src-question-page-rs"
primary_target: "crates/context/src/question_page.rs"
related_targets: ["crates/context/src/serve_question.rs"]
---

## Scope

Operate mode: the existing local question picker. Help builders compare the
current hand, choose, steer, or re-roll. Preserve payloads, copy, choices,
confirmation, loading, error handling, and responsive deck behavior.

## Direction contract

THESIS: Quiet picker chrome lets the offered directions carry the character.
OWN-WORLD: Inherit impeccable-site's paper-and-instruments proposal: neutral paper,
ink type, patina state text, small gold marks, tactile controls. Use system fonts
and the existing outlined SVG logo; no font files or external font requests.
STORY: Compare the options, inspect details, choose or request another hand.
FIRST VIEWPORT: Small brand at top; readable heading and build-path switch above
the existing card deck; steering and re-roll actions remain reachable below.
FORM: Existing picker structure, user-pinned site theme; no concept roll required.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Authority

The user confirmed impeccable-site #34 (head eb5348e48fcd94d0d74895488b985988a401a2e2)
as the light-theme authority, with system fonts for the picker. This is a scoped adaptation,
not a rewrite of the repository's global DESIGN.md. No new raster assets.

## Built surface

Recorded from `crates/context/src/question_page.rs`, rendered
`.impeccable/review/after.html`, and the desktop/mobile captures alongside it.
Finish reviewer disposition: **ship**, with no requested fixes.

- **Paper and ink:** light-only chrome uses neutral paper (`oklch(97.8% 0 0)`),
  raised paper (`oklch(99.5% 0 0)`), ink headings (`oklch(13% 0 0)`), and body
  text (`oklch(22% 0 0)`). Dark instrument fills carry primary actions and image
  controls; gold appears in the logo, lead-card border, and active switch dot.
- **Local palette adaptations:** patina is the site's text-safe deep value
  (`oklch(49% 0.11 190)`); faint metadata shares muted ink (`oklch(46% 0 0)`).
  Dividers and the build-path switch boundary use ink at 12% opacity; other
  control boundaries use 45%. The lead-card outline (including hover) and
  active switch dot use default Kinpaku (`oklch(84% 0.19 80.46)`), not deep gold.
- **Explicit font override:** headings, body, and controls use `system-ui,
  -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; metadata uses
  `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`. Body is 15px/1.55;
  headings are 2rem at weight 600, reduced to 1.5rem in portrait; card titles
  are 1.125rem at weight 600. The existing wordmark is inline SVG path outlines
  with a tight viewBox, displayed at 164 × 30px. No font files are required.
- **Comparison layout:** a 90rem maximum content width shares its inset with
  the deck and footer. Landscape uses a horizontal snapping deck; portrait
  uses a vertical deck capped at `min(68dvh, 44rem)` with Back/More controls.
  The build-path switch moves below the heading in portrait. Footer controls
  are sticky in landscape and remain in document flow in portrait.
- **Tactile controls:** cards and dialogs use 8px corners and layered soft
  shadows. Actions and the steering field use 6px corners. The build-path
  switch has a recessed gray track, a raised active cap, and a gold dot;
  re-roll controls share the cap shadow and inset pressed state. Keyboard
  focus uses a 2px patina outline. Image zoom, card flips, loading placeholders,
  confirmation, and completion/error surfaces retain their existing roles.

These are picker-local facts, not a replacement global design system. Existing
card badges and dense uppercase metadata are preserved content treatments,
not new typography rules for other surfaces. The user-authorized system fonts
are an intentional local override. No raster assets were created or added.
