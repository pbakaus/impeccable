# Craft Flow: the collaborative build

This is the **supervised** build: the user gets guaranteed checkpoints (a confirmed direction, approved mocks where the harness generates them) before code exists, and a guided walkthrough after. This file is the *orchestration* of that build (when to pause, what to confirm, how to finish); the design thinking itself lives in SKILL.md and, for new identity work, [new-work.md](new-work.md). Rules stated there are not repeated here.

Before writing code, you need: PRODUCT.md loaded, a confirmed design direction for this task (from `shape` or supplied by the user), and, when SKILL.md's new-work gate applies, [new-work.md](new-work.md) read.

Treat any approved visual direction (generated mock or stated reference) as a concrete contract for composition, hierarchy, density, atmosphere, and signature motifs. Don't let mocks replace structure, copy, accessibility, or state design. But if the live result lacks the approved direction's major ingredients, the implementation is wrong.

### Gates: do not compress

Craft has **multiple user gates**, not one. When the harness has native image generation (Codex via `image_gen`), the gate sequence before code is:

1. **Shape brief confirmed** (Step 1)
2. **Direction questions answered** (codex.md Step A)
3. **Palette confirmed** (codex.md Step B)
4. **One mock direction approved or delegated** (codex.md Step D)

You must stop at every gate. **Shape confirmation alone is NOT a green light to start coding.** It is the green light to begin codex.md Step A. Compressing gates 2 through 4 because the shape brief felt complete is the dominant failure mode of this flow.

When the harness lacks native image generation, gates 2-4 collapse into the brief itself, and shape confirmation does advance straight to code.

**Unattended runs.** When no user can respond (a one-shot task, an automated run, or an explicit instruction not to ask questions), every gate collapses into a decision you make yourself. Hold the same bar the gate would have held: state the shape brief, the visual direction, and the palette as decided (one line each), then proceed straight through to build and the visual iteration pass. Do not stop to wait, and do not skip the direction thinking just because nobody will read the questions.

## Step 0: Project Foundation

Before shape, before code: figure out what kind of project you're working in. Run `ls`. Check for:

- An existing framework (`astro.config.*`, `next.config.*`, `svelte.config.*`, `vite.config.*`, a `package.json` with framework deps). **If found, use it.** No parallel builds, no second framework, no writing to `dist/` or `build/` directly. Whatever pipeline the project has, respect it.
- An existing component library, design system, or icon set. Read what's there before adding to it; use the project's set, don't introduce a second one.

If the directory is empty (greenfield), don't pick a framework silently. Ask the user (AskUserQuestion when available), with sensible defaults framed by the brief: Astro for content-led brand sites, SvelteKit/Next/Nuxt for app surfaces, single index.html for one-shot demos. Ask once; on unattended runs, decide and record.

## Step 1: Shape the Design

Run $impeccable shape, passing along the feature description. Shape is **required** for craft; it produces the confirmed direction. Present the shape output and stop for confirmation (unattended: produce the compact shape output for yourself and continue). If the user already supplied a confirmed brief or ran shape separately, use it and skip this step.

When the prompt + PRODUCT.md already answer scope, content, and visual direction with no real ambiguity, the shape output can be compact (3-5 bullets ending with "confirm or override"). Don't pad a clear brief; equally, don't skip the pause to look efficient.

## Step 2: References

Consult the reference files the brief's needs demand (interaction-heavy → [interaction-design.md](interaction-design.md); animation → [animate.md](animate.md); color-heavy → [colorize.md](colorize.md); responsive-critical → [adapt.md](adapt.md); copy-heavy → [clarify.md](clarify.md)). SKILL.md's craft floor always applies; don't re-read what's already loaded.

## Step 3: Visual Direction & Assets (Harness-Gated)

If the harness has **native image generation** (currently Codex via `image_gen`), this step is mandatory: **stop and load [codex.md](codex.md)**, follow Steps A-F, then return here. Otherwise, state in one line that the generation step is skipped for lack of native image generation, then implement directly from the brief as the visual contract.

Imagery obligations (real, verified assets; no CSS scenery where photographs belong) are defined in SKILL.md's modes and new-work.md; they bind here regardless of whether mocks were generated.

## Step 4: Build to Production Quality

Implement the feature following the design brief, in passes: structure, visual system, states, motion/media, responsive. SKILL.md's craft floor governs the visual bar; the engineering bar on top of it:

- **Real content.** No placeholder copy, placeholder images, dead links, fake controls, or unused scaffold at presentation time.
- **Preserve the approved direction's major ingredients.** Missing hero objects, imagery, section structure, or signature motifs are blocking defects unless the user accepted the change.
- **Semantic first.** Real headings, landmarks, labels, form associations, button/link semantics, accessible names.
- **Realistic state coverage.** Default, hover, focus-visible, active, disabled, loading, error, success, empty, overflow, long/short text, first-run.
- **Finished interaction quality.** Keyboard paths, touch targets, feedback timing, no hover-only functionality.
- **Respect the build pipeline.** Edit source and run the project's build; never write to `build/`/`dist/` with redirects, which skips the asset pipeline.
- **Technically clean.** Production build passes, no console errors, no avoidable layout shift, no needless dependencies.
- **Ask when uncertain.** If a discovery materially changes the brief or approved direction, stop and ask (unattended: decide, record, proceed).

## Step 5: Iterate Visually

Look at what you built like a designer would, with whatever eyes the harness gives you (browser, screenshot tool, Playwright, or the user). Responsive testing at mobile, tablet, desktop minimum; for long-form surfaces, inspect major sections individually. If a tool returns a file path, read the PNG back; a screenshot you didn't read doesn't count.

After the first pass, critique honestly against the brief and the approved direction, patch material defects, re-inspect. **Don't invent defects to demonstrate iteration**; a confident "first pass clean" beats a fake fix. Detector or QA output is defect evidence, never proof of completion.

## Step 6: Present

Show the feature in its primary state; summarize viewports checked and the important fixes made after inspection; walk through key states (empty, error, responsive); connect design decisions back to the brief and any chosen mock, including accepted deviations; note remaining limitations honestly. Ask: "What's working? What isn't?"
