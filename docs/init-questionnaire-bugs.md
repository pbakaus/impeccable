# Init Questionnaire Bug Ledger

This tracks the current `/impeccable init` questionnaire bugs, the intended product behavior, and the regression coverage used before recording live Flux journeys.

## Puppy Recording Follow-Up Bugs

- Symptom: the Puppy recording showed slide copy that was only lightly branded, for example `What proves Puppy Wear?`, `Who is Puppy Wear for?`, and option labels like `Recommended` / `Route 2`.
- Likely cause: the recording test's fake chat agent used static dataset templates instead of reading the accumulated answer event. The server prompt context also preferred generic choice labels over semantic choice values, so image prompts saw `Recommended` instead of the actual trust/audience/anti-goal.
- Intended fix: recording tests now use a context-aware agent that authors every post-first slide from actual prior answers and uploads; prompt context prefers `freeform`/`value` over generic UI labels.
- Regression test: Puppy-only live recording writes `slide-content-log.md`/`.json` and asserts no banned generic slide titles are used.
- Status: Fixed in source; Puppy live rerun pending in this turn.

## Regenerated Image Loading Is Invisible

- Symptom: when requesting more visual cues or palettes, old cards stayed visible until the new cards suddenly replaced them.
- Likely cause: the browser only showed the empty skeleton state when no prior batch existed.
- Intended fix: mark the active image slide as pending on new image requests and render the four loading placeholders until the next `image_batch` arrives.
- Regression test: Puppy recording captures `*-regenerating.png` screenshots and asserts four placeholders are visible after more-cue and palette-shift requests.
- Status: Fixed in runtime; Puppy live rerun pending in this turn.

## Visual/Palette Prompts Too Generic

- Symptom: image prompts leaned toward generic material studies rather than the user's specific product, trust signal, audience, anti-goals, selected cues, and uploads.
- Likely cause: route builders used generic route subjects and strategies, and palette prompts did not strongly restate uploaded references.
- Intended fix: visual cue and palette route prompts now embed the current product, differentiator, trust, audience, anti-goals, selected cue prompts, and uploaded asset roles in the production brief.
- Regression test: image-provider tests still verify route diversity and prompt structure; Puppy live session state/log is inspected for concrete Puppy terms in image request context.
- Status: Fixed in provider; Puppy live rerun pending in this turn.

## Recorded Journey Did Not Show Enough States

- Symptom: the Puppy video did not visibly prove all slide states, modal states, loading states, and the cursor overlay.
- Likely cause: the recorder captured only a small screenshot set, used a subtle cursor overlay, and closed modals quickly without separate screenshot evidence.
- Intended fix: Puppy recording now captures every slide family, regenerated loading states, selected-card states, visual cue modal, palette modal, typography modal, finish state, and uses a larger gold cursor with click feedback.
- Regression test: Puppy-only live recording artifact folder contains expanded screenshots plus MP4.
- Status: Fixed in recording suite; Puppy live rerun pending in this turn.

## Input Loses Focus While Typing

- Symptom: focused answer fields can lose focus or reset the caret while the page receives polling/EventSource updates.
- Likely cause: remote state updates re-render the active slide while the user is editing.
- Intended fix: keep active answer text as local draft state; commit only on Continue, Back, Enter, option click, upload, generation request, or final write; skip active answer re-rendering while a focused answer input is present.
- Regression test: browser test asserts focused draft state survives remote slide updates and the main flow types through explicit commits.
- Status: Fixed in runtime; covered by deterministic browser coverage.

## Slides Vertically Trap Overflow

- Symptom: tall cue, palette, upload, or typography slides can become unreachable when content exceeds viewport height.
- Likely cause: the full-screen stage and slides used `overflow: hidden`.
- Intended fix: keep the background full-screen, but make the active slide itself vertically scrollable and keep mobile nav reachable.
- Regression test: browser screenshot and overflow checks cover desktop/mobile slide reachability.
- Status: Fixed in runtime; covered by browser screenshots and overflow assertions.

## Question Titles Wrap Awkwardly

- Symptom: titles become broken multi-line blocks or overflow the available width.
- Likely cause: large display type with narrow `ch` max-width and generic long titles.
- Intended fix: desktop titles use wider single-line space and shorter agent-authored wording; mobile titles balance without horizontal overflow.
- Regression test: browser text-overflow assertions include `h1`, and brand-specific title checks reject unchanged generic copy.
- Status: Fixed in runtime and test copy; covered by browser assertions.

## Post-First-Slide Copy Feels Templated

- Symptom: later questions can read like static framework labels such as `Who should feel seen?`.
- Likely cause: base schema copy or partial patching leaks through instead of complete agent-authored slide payloads.
- Intended fix: first slide remains static; every later slide should be replaced by a concise, brand-specific agent-authored payload.
- Regression test: browser flow rejects banned generic titles and asserts a brand name appears in post-first-slide titles.
- Status: Fixed for init defaults and deterministic path; live recording suite will validate full journeys.

## Flux Batch Fails On One Timeout

- Symptom: one timed-out route can fail the whole visual batch, leaving the page stuck generating.
- Likely cause: four Flux routes were launched in parallel with `Promise.all`, but no per-route retry/backoff existed.
- Intended fix: each card route retries independently with backoff before the batch fails clearly.
- Regression test: image-provider tests cover retry after timeout/failure and still returning four cards.
- Status: Fixed in provider; retry coverage added.

## Image Card Select And Expand Are Confusing

- Symptom: card click, checkbox/check state, and expand behavior feel crossed: selecting and expanding are not visually distinct.
- Likely cause: the whole card is selectable, but the expand control was subtle and there was no immediate checked indicator.
- Intended fix: card body click selects only; expand button opens modal only; selected cards show an explicit checkmark and modal close returns focus.
- Regression test: browser test clicks the card body and asserts no modal opens, then clicks expand and asserts the modal opens.
- Status: Fixed in runtime; covered by browser assertions.

## First Slide Shows Back

- Symptom: the first slide renders a Back button.
- Likely cause: navigation controls were rendered uniformly for all slides.
- Intended fix: render Back only after slide one.
- Regression test: browser test asserts the first slide has no Back button.
- Status: Fixed in runtime; covered by browser assertions.

## Choice/Freeform Answers Use Textarea

- Symptom: compact custom answers render as oversized textareas.
- Likely cause: text and choice inputs shared one textarea renderer.
- Intended fix: init choice/freeform answers use single-line inputs; the first idea slide remains a textarea for the longer concept sentence.
- Regression test: browser tests use `[data-answer-text]` and assert post-first-slide fields do not depend on textarea behavior.
- Status: Fixed for init while preserving existing non-init questionnaire textarea behavior.

## Suggested Answers Need Recommended Default

- Symptom: suggested choices can appear unselected, forcing unnecessary interaction.
- Likely cause: no default selected answer existed until the user clicked.
- Intended fix: init option groups select the first recommended card by default, show a `Recommended` badge, and Continue commits it when untouched.
- Regression test: browser test asserts the default selected recommended card before continuing.
- Status: Fixed for init; covered by browser assertions.

## Choose For Me Should Be Removed

- Symptom: a separate `Choose for me` button duplicates the recommended default behavior.
- Likely cause: older delegate UX remained visible.
- Intended fix: remove the visible delegate control; Continue uses the recommended answer when untouched.
- Regression test: browser test asserts no `data-delegate` control and no visible `Choose for me` copy.
- Status: Fixed in UI; delegate backend remains unused for compatibility.

## Number Keys And Enter Are Missing

- Symptom: users cannot quickly select choices or continue with the keyboard.
- Likely cause: keyboard handler only supported arrows and Enter-to-advance.
- Intended fix: number keys select option/image/type cards when not typing; Enter commits/continues; Enter in a single-line input submits the draft.
- Regression test: browser test presses a number key and asserts the matching option becomes selected.
- Status: Fixed in runtime; covered by browser assertions.

## Arrow-Key Guidance Is Invisible

- Symptom: the page does not reveal that up/down arrows move between slides.
- Likely cause: no visible shortcut hint existed.
- Intended fix: add a small bottom-right hint: `↑ Back · ↓ Next · 1-4 Select · Enter Continue`.
- Regression test: browser test asserts the hint is visible.
- Status: Fixed in runtime; covered by browser assertions.
