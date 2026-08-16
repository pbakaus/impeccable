# Comp fidelity: measuring the build against the comp

Status: shipped on `feat/comp-fidelity` (2026-08). Owner: skill (`skill/scripts/comp-*.mjs`, `build-phase.mjs`) plus two detector rules.

## The problem

v4's direction round and comp round produce beautiful comps. The build that follows is a lossy translation of them: invented chrome the comp never showed, materials flattened to CSS, illustrations approximated as SVG or `clip-path`, produced textures buried under opaque washes, and a first viewport that has the comp's section order and none of its craft. The finish reviewer catches this and orders a rebuild; the rebuild has the same problem; runs hit the turn cap.

Two recent factory runs (07-vintage-moto-forum and 05-experimental-album, gpt-5.6-sol, 2026-08) show the shape:

- 183 KB of skill prose read before the first write; the page written in one 1,500-line write at turn 30; no reproduction phase, no `hero-repro.png`, no side-by-side; turns 31-61 spent on servers, screenshots, and reviewer plumbing until the cap.
- A torn-paper arch shipped as a 17-vertex `clip-path: polygon`; a vellum slip as a flat gray rectangle; both produced paper textures unused on disk.

The root: every fidelity check in the build phase was the model judging its own reproduction from memory of an image, and the prose kept growing to argue it into behavior it cannot perform. Code-led builds "look better" only because they have no target to fail against.

## The change

Stop asking the model to reproduce pixels it can see but not render, and stop asking it to grade a reproduction it cannot see clearly. Make the translation mechanical wherever pixels are involved; keep the model's job to what it is good at (structure, semantics, controls, motion, responsive logic).

### 1. `comp-diff.mjs`: numbers and crops instead of conviction

Dependency-free (own PNG codec in `lib/png.mjs`). Given the comp and a build capture:

- aligns the build (scale to comp width, take the first-viewport rows; `--align stretch|cover` for other uses),
- scores structure (SSIM over blurred grayscale with a small translation search), color (quantized histogram intersection + Lab dominant-palette match), detail (high-frequency energy ratio per cell: did the material survive?), and bands (horizontal section boundaries line up?),
- per region (from the spec, or from the comp's own bands), with region-kind weights: a `plate` region is judged mostly on detail, a `text` region on structure,
- writes `side-by-side.png`, `heatmap.png`, `regions/<id>.png` paired crops at legible scale, and `report.json` with a verdict per region in the reviewer's vocabulary: `match` / `drift` / `missing` / `contradicted`,
- `--threshold` exits 3 below the bar.

Calibration on the moto run: comp vs itself 100%; comp shifted 12px 87% (match); comp with the illustration erased 90% overall but the plate region `missing` at 30%; comp recolored to navy 34% (`missing`); the real build 59% (`contradicted`, plate `missing`, index `contradicted`). Sibling comps of the same world score 55-59% against each other, so the metric separates "same design" from "same world, different composition." Runs in ~0.3-0.8 s.

### 2. `comp-spec.mjs`: the comp becomes a measured spec

`--grid` writes the comp with a labeled 10x10 grid; the model names regions by grid span (`E0:J4`) with a kind (`plate` / `image` / `texture` / `text` / `control` / `chrome`) in a small JSON file; `--regions` measures each region (normalized and pixel box, sampled palette, detail energy, aspect) and writes `.impeccable/build/spec.json`. Raster kinds get a `plate` path under `assets/plates/`. `--crop <id>` extracts the reference crop; `--plate-prompt <id>` prints the regeneration prompt; `--print` is the compact spec the build codes against. The spec is what "anything not in this list does not exist on the page" refers to.

### 3. `build-phase.mjs`: phases as a state machine on disk

`.impeccable/build/state.json`, phases `spec → plates → hero → sections → motion → responsive → review`, advanced only by the script:

- `spec` gate: spec.json exists, measures this comp, has regions.
- `plates` gate: every raster region's plate exists, decodes, is at least 1.5x the region's pixel width, and scores against the comp crop (`cover` alignment, kind-weighted, min 0.5).
- `hero` gate: `.impeccable/review/hero-repro.png` exists and comp-diff scores at least 0.72 with no region `missing` and at most a third `contradicted`. Writes `.impeccable/review/diff/hero/`. Attempts and scores are recorded.
- later phases record the moment; `--force --reason` is allowed and recorded, never silent.

`status` prints a NEXT line for the current phase, so the prose does not have to.

### 4. Plates: `generate-image.mjs --plate <id>`

One raster region end to end: crop the comp region, send the crop as the edits-endpoint reference with the spec's plate prompt (remove UI text and chrome, keep everything else), pick the closest supported size to the region's aspect, write to the plate path, embed the prompt, score against the crop, warn under 50%, refuse under `--min`. `IMPECCABLE_IMAGE_GEN_FAKE=1` yields the crop at 2x so offline pipelines walk the plate gate. Harness-native image tools use the crop and prompt the same way.

The asset producer agent's job shrinks to: produce the spec's plates, one line per plate, `blockers`, `assumptions`. No inventory of its own (the spec is the inventory), no strategy taxonomy.

### 5. Two detector rules

- `organic-clip-path`: `clip-path: polygon()` with 10+ off-grid vertices, or `clip-path: path()` with 3+ curve segments. Geometric clips (cut corners, diagonals, hexagons, arrows) pass; `circle()`/`inset()` pass.
- `buried-raster`: a `url()` layer under a gradient wash whose stops are all >= 0.9 alpha (or opaque), no blend mode; or a raster background / `<img>` at opacity < 0.15. Tints under 0.9, blends, and visible opacities pass.

Both in both engines (static jsdom + browser bundle), fixtures under `tests/fixtures/antipatterns/`.

### 6. Prose

`new-work.md` section 6 is now the phase list with its gates; the reproduction paragraph, the hero checkpoint paragraph, and visualize.md's inventory / medium-gate / produce sections are gone in favor of the scripts that enforce them. `visualize.md` dropped from 55 to 44 lines and new-work.md's section 6 from ~1,900 to ~1,300 words while gaining the actual mechanism. The finish reviewer reads the state file and the diff report first and starts its matrix from the measured verdicts.

## What this does not do

- It does not judge lettering character, ornament, or motion. The reviewer still owns those.
- It does not decide plates for the model: the model still names regions on the grid. The gate only refuses to proceed when a named raster region has no plate.
- The hero threshold (0.72) and plate threshold (0.5) are calibrated on two runs and synthetic perturbations; they will move with evidence. Both are constants at the top of `build-phase.mjs`.
- Operate surfaces (dashboards, editors) have few or no plates; the spec/diff still apply, the plates gate is trivially satisfied.

## Evaluating it: first sweep (2026-08-16, gpt-5.6-sol, openai lane)

Same niche (07-vintage-moto-forum), same approved comp C, main skill vs this branch, scored with `comp-diff.mjs` against the approved comp. Small numbers, one sample each; read as a smoke, not a verdict.

| Run | Skill | Turns / cost | comp-diff overall | Notes |
|---|---|---|---|---|
| exec cut, packet C, "Continue." | main | 9 / $0.88 | **55%** (contradicted; plate + index `missing`) | one 45 KB write, no plates, generic split hero |
| exec cut, packet C, "Continue." | branch | 17 / $0.95 | **54%** (contradicted; plate `missing`) | the packet's prefix predates the phase machinery; the model never re-read new-work.md and behaved like main |
| exec cut, packet C, ask names the phased build | branch | 96 / $5.24 (cost cap) | **66%** (drift; plate region 43%) | walked spec → grid → regions → plates → hero gate (72% fail, fix, 77% pass) → sections → motion → responsive; 12 turns lost hunting a screenshot the harness wrote host-side only (fixed in impeccable-evals); the exploded plate was produced (62% vs crop) but the page drew the region in SVG anyway (fixed: hero gate now refuses unreferenced plates) |
| full journey, comp-led | main | 49 / $3.23 | **56%** (contradicted; two bands `missing`) | dark comp with paper fiche rail; build keeps the section order and flattens the material |
| full journey, comp-led | branch (before the force/reference fixes) | 61 / $3.04 (turn cap) | **65-66%** (drift) | forced past the plates gate with "single-file delivery" (now refused); hero 44% structure but 83% color, plate placed |
| full journey, comp-led (after fixes), sample 2 | branch | 60 / $3.00 (30-min wall clock) | **59%** (contradicted; hero gate 61 → 63 → 62%) | three plates produced (paper 52%, carburetor 61%, photo), hero gate failed three times, model asked the simulated user, got "truthful translation", forced with the user's words (recorded), wall clock ended it in sections |
| full journey, sample 1 | branch | 37 / $2.5 | n/a | direction round, then wrote code with no comp round at all: a routing gap in the direction round that predates this branch (also seen on main in cf-full-branch-07b) |
| full journey, comp-led | main (2nd sample) | 24 / $1.38 | n/a (no comps: model went code-led) | same routing gap |
| exec cut, 01-observability composed checkpoint | main / branch | 9 / $0.68 vs 10 / $0.84 | 52% vs 48% | composed checkpoint quotes the OLD visualize.md verbatim into the prefix, so the branch text never reaches the model; not a test of this change |

Sweep totals: 12 runs, about $32 of OpenAI spend (gpt-5.6-sol + gpt-image-2).

What it says so far:

- When the phase machinery actually runs, fidelity moves from the mid-50s to the mid-60s on this comp, and the region rows say why the rest is missing (the exploded plate, the parts table, the CTA treatment). Same model, same comp.
- Execution-cut packets and composed checkpoints carry the old skill's text in their prefix; a resumed session follows the conversation it is in, not the mounted files. Comparisons of Setup-adjacent skill changes need full journeys or a fresh packet cut on the new skill.
- Two of the three run-time defects the sweep found were harness (screenshot not visible in the sandbox; packet workspace path) and are fixed in impeccable-evals `paul/packet-niche-execution-preflight`. The third (model forcing a gate, model ignoring its plate) is now refused by the script.
- Cost: the phased build spends more turns before the first write and more image calls (plates). The 96-turn run is dominated by the screenshot hunt and a font-inlining tangent, not by the gates. The 30-minute wall clock and 60-turn cap in the harness are tuned for the old one-write build; a phased build with three plates and a hero loop needs the execution cut kind's 100-turn budget or a longer wall clock.
- The hero gate at 72% is reachable (77% on the ask run) but the model's second and third attempts moved the score by one point each: it edits CSS values when the diff says a region is missing. The gate's message now names the region and the failure mode; the next lever is making the region crops the thing the model looks at (it opened the side-by-side once and the crops never).
- Whether a greenfield session enters comp-led at all is decided in the direction round, before any of this. Two of five full-journey samples (one per skill) skipped the comp round and wrote code; the config default is comp-led and image generation was on. That routing gap is separate from this change and worth its own fix.

Next: cut fresh packets on the branch skill for 02 and 07, sweep both lanes (openai + anthropic) at n=3, add one Operate niche (11-analytics-dashboard, plates near-empty) and one mobile niche (23-transit-mobile, portrait comp).
