# new-work E2E

A cheap, deterministic smoke suite for the interactive parts of new-work: the
serve-question decision page and the offline image generator. It is kept out of
`bun run test` and runs on demand.

```bash
bun run test:new-work-e2e
```

One-time setup: `npx playwright install chromium` (the suite drives a real
Chromium so the page runs its own JS, exactly as a user's tab would).

## What it covers

`tests/new-work-e2e.test.mjs` opens the served decision page with a real
browser and drives it through the scripted user bot, then asserts on the
serve-question protocol output:

- **pick assigned** returns the chosen `optionId`, the typed steer, the
  `hero`/`board` fields, and the `CHOSEN CARD` directive printed by `--wait`.
- **re-roll with steer** keeps the daemon alive, `--update` re-deals the next
  hand, the page reloads itself, and the following pick is terminal (state file
  cleaned up).
- **canon** returns `optionId: canon` and prints the `CANON CHOSEN` directive.
- **tab close** stops the page heartbeats so `--wait` exits 4 `PAGE CLOSED`.
- **text-only card** renders with no `.media` region when an option has no hero.
- **fake image generation**: same prompt yields identical bytes, the file
  exists, the `SYNTHETIC` marker is present, and different prompts produce
  different palettes.

The concept-seed direction roll (challengers, `ASSIGNED INDEX`, the no
PRODUCT.md gate) is pinned by the oracle corpus (`tests/oracle`, the `seed-*`
cases) and is not repeated here.

Both verbs run through the engine binary (`impeccable serve-question`,
`impeccable generate-image`) resolved by `tests/lib/engine-bin.mjs`:
`IMPECCABLE_BIN` or `skill/scripts/bin/<os>-<arch>/` (`bun run fetch:engine`).

## Pieces

- `user-bot.mjs` is a module plus CLI. Given a workspace dir it resolves the
  running daemon from `.impeccable/questions/<key>.state.json`, opens the page,
  and runs a JSON policy of real clicks: `{"pick":"assigned"}`,
  `{"reroll":true,"steer":"warmer"}`, `{"pick":"challenger-*"}`,
  `{"canon":true}`, `{"close":true}`. The deterministic tier passes an
  already-launched browser in; the CLI launches its own Chromium.
- `IMPECCABLE_IMAGE_GEN_FAKE=1` switches `impeccable generate-image` to
  the offline stand-in: no OpenAI call, no key, a `$0.00` cost line, and a
  deterministic image (SVG for `.svg` out with the wrapped prompt text and a
  `SYNTHETIC COMP` label; a valid palette-stripe PNG otherwise, with the prompt
  and marker in a PNG `tEXt` chunk).

## Planned LLM tier (not built yet)

The same scaffolding supports an opt-in LLM tier later, mirroring the two-layer
pattern in `tests/live-e2e`:

- A real model plays the user through the same scripted `user-bot.mjs` policy,
  choosing and steering instead of following canned actions.
- `IMPECCABLE_IMAGE_GEN_FAKE` still stands in for image spend, so a full
  concept-to-card cycle runs without paying per render.
- Assertions run against the tool-call trace via the skill-behavior harness,
  the same way `tests/skill-behavior` keys on the trace rather than free-form
  output.

Cost posture: the deterministic tier is free (no API calls, local Chromium).
The LLM tier hits a provider and costs money, so it stays opt-in and out of CI,
matching how `test:live-e2e` and `test:skill-behavior` are gated today.
