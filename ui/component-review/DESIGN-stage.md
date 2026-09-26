# Review stage: design brief

The plan and asset review asks a person to make a handful of visual judgments quickly and confidently. Every screen answers one question, at the size it deserves, with context available on demand.

## The user's questions, in order

1. **What am I doing, and how long will it take?** Intro.
2. **Is this one right?** One item at a time.
3. **Did they fix what I asked?** Round 2 and later.
4. **Is anything missing, and am I done?** Summary.

## Flow

**Intro** (a single screen, skipped with Enter). Round 1: "7 things to check before any page code is written. About two minutes." Show the comp large with the regions to decide outlined, and one line on what the two kinds of decision mean (a generated image; a region that will be drawn in code). Round 2+: "The agent worked on your notes for 2 items. 5 approvals are kept." One primary action: Start.

**Stage** (one item). The item fills the viewport between a slim top bar and a decision bar.
- Asset: comp crop and generated asset side by side at the largest size that fits, equal height, labeled with eyebrows (IN THE COMP, GENERATED). No toggles for the common case.
- Plan item: the comp crop, large and tight on the region, with a plain sentence under it ("Will be drawn in code: brushed steel band under the hero") and, if flagged, the observation as a quiet vermilion note. No second pane.
- Round 2+ changed item: open with the user's own words from the last round as a quote ("You asked: Boats should be moored along the quay."). Then Before, After, Comp as a three-up at equal height. For a reclassified region, show the new generated asset next to the comp crop and the old plan sentence struck through.
- Locator: a small comp thumbnail docked in the stage corner with the region highlighted. Click or press C to open the full comp as an overlay with all regions (the map). The map is context, not a second workspace.
- Inspection that delights and is useful for fidelity:
  - Synced loupe: hovering either image shows a magnified circle at the same relative point on both images.
  - Hold Space to flip: while held, the generated asset is replaced in place by the comp crop at the same size (and back on release), for instant difference-spotting. A small hint shows once.
  - Backdrop choice only appears for transparent assets, as a kit switch in the image caption, defaulting to the comp colour.
- Decision bar (bottom, centered): the two kit buttons (primary and secondary) with their key caps inline, plus the quiet third action for plan items. After a decision, the stage advances to the next undecided item with a short slide on --ks-ease; Undo is a toast ("Approved Hero figure. Undo").

**Top bar**: title (small), round, and progress as a row of LEDs, one per item, gold for decided and patina for the current one; each LED is a button (tooltip with the name) for random access. Nothing else.

**Summary** (after the last item, or from the progress row): a contact sheet of every item with its decision (thumbnail, name, state, the user's note), each clickable to revisit. Below it, the full comp with all regions outlined and the question "Anything on the comp we didn't cover?" with Mark missing here (drawing a box, as today). Then the single primary action: "Approve plan and assets" or "Send notes" (with counts). This replaces the separate checkbox, the persistent Mark missing button and the legend.

Code regions without a decision ("set in code") appear only in the summary's comp overlay and the full map, with "Make it an image" available on click, so they never add to the queue.

## Visual language

Site kit only (vendor/): paper, ink, one hairline rule per boundary, eyebrows for labels, kit buttons, strips and switches. The stage uses the paper ground; images get a thin --ks-rule outline and no card. Motion: stage transitions 240ms on --ks-ease, the LED fills 160ms; respect prefers-reduced-motion. Type: Alumni Sans for the one title per screen, Albert Sans elsewhere.

## Keyboard

Enter start or confirm; A approve / code is fine; N needs work / make it an image; F something else; J/K or arrows move; C comp overlay; Space hold to flip; Cmd+Z undo; Esc close. Show key caps on the buttons themselves, not in a separate hint row.

## Narrow widths

Stage stacks the two images vertically (comp above, generated below), the locator moves into the top bar, and the decision bar is sticky at the bottom.
