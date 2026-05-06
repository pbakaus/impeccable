# Craft Flow

Build a feature with impeccable UX and UI quality: shape the design, land the visual direction, build real production code, inspect and improve in-browser until it meets a high-end studio bar.

Before writing code, you need: PRODUCT.md loaded, register identified and the matching reference loaded, and a confirmed design direction for this task (either from `shape` or supplied by the user). PRODUCT.md is project context, not a task-specific brief.

Treat any approved visual direction (generated mock or stated reference) as a concrete contract for composition, hierarchy, density, atmosphere, signature motifs, and distinctive visual moves. Don't let mocks replace structure, copy, accessibility, or state design. But if the live result lacks the approved direction's major ingredients, the implementation is wrong.

## Step 1: Shape the Design

Run {{command_prefix}}impeccable shape, passing along whatever feature description the user provided. Shape is **required** for craft; it is what produces a confirmed direction.

**You must end your response after presenting the shape output and wait for the user.** Do not present a brief or direction statement and then continue to write code in the same response. The user gets to confirm, override, or course-correct. This is non-negotiable: a craft run that skips the user-confirmation pause is broken.

If the user already supplied a confirmed brief or ran shape separately, use it and skip this step.

When the original prompt + PRODUCT.md already answer scope, content, and visual direction with no real ambiguity, the shape output can be **compact** (3-5 bullets stating what you're building and the visual lane, ending with one or two specific questions or "confirm or override"). The full 10-section structured brief is reserved for genuinely ambiguous, multi-screen, or stakeholder-heavy tasks. Don't pad a clear brief into a long one to look thorough; equally, don't skip the pause to look efficient.

## Step 2: Load References

Based on the design brief's "Recommended References" section, consult the relevant impeccable reference files. At minimum, always consult:

- [spatial-design.md](spatial-design.md) for layout and spacing
- [typography.md](typography.md) for type hierarchy

Then add references based on the brief's needs:
- Complex interactions or forms? Consult [interaction-design.md](interaction-design.md)
- Animation or transitions? Consult [motion-design.md](motion-design.md)
- Color-heavy or themed? Consult [color-and-contrast.md](color-and-contrast.md)
- Responsive requirements? Consult [responsive-design.md](responsive-design.md)
- Heavy on copy, labels, or errors? Consult [ux-writing.md](ux-writing.md)

## Step 3: Land the Visual Direction (Capability-Gated)

Before implementation, generate high-fidelity visual comps when all of these are true:

- The work is **net-new** or visually open-ended enough that composition exploration will improve the build.
- The brief's scope is **mid-fi, high-fi, or production-ready**.
- The current harness gives you native image generation (Codex's `image_gen`, an equivalent MCP tool, or similar). Don't ask the user to set up external APIs, shell scripts, or one-off tooling.

When those conditions are met, this step is mandatory for **both brand and product work**. If image generation isn't natively available, skip silently and proceed; don't announce the skip to the user.

Do not skip this step because the eventual UI should be semantic, editable, code-native, responsive, or accessible. Those are implementation requirements, not reasons to avoid visual exploration.

### Purpose

Use the mock step to find a stronger visual lane than code-first generation would reliably discover on its own. The brief remains authoritative on user, purpose, content, constraints, states, and anti-goals. The mock clarifies composition, hierarchy, density, typography, and visual tone.

### What to generate

Generate **1 to 3** high-fidelity north-star comps based on the confirmed brief. If shape already produced direction probes, use those results as input and generate a more resolved mock from the winning lane, not another unrelated exploration.

- For brand work, push visual identity, composition, and mood aggressively.
- For product work, still push hierarchy, topology, density, and tone, but keep the comps grounded in realistic product structure and states.
- For landing pages and long-form brand surfaces, show enough of the next section or second fold to establish the system beyond the hero.

The comps must be genuinely different in primary visual direction, not just color variants.

### Approval loop

Show the comps and ask what should carry forward. If the user asks for changes or the best direction is still weak, generate a focused revision before implementation. Continue until one direction is approved, or until the user explicitly delegates the choice.

If the user delegates, pick the strongest direction and explain the decision using the brief, not personal taste.

Before moving to implementation, summarize:

- What to carry into code
- What **not** to literalize from the mock

This summary is required before Step 4. It is the handoff between visual exploration and semantic implementation.

### Mock fidelity inventory

Before building, inventory the approved mock's major visible ingredients:

- Hero silhouette and dominant composition.
- Signature motifs: planets, devices, portraits, charts, route lines, insets, badges, or other memorable objects.
- Nav and primary CTA treatment.
- Section sequence visible in the mock, especially the second fold.
- Image-native content the concept depends on.
- Typography, density, color/material treatment, and motion cues.

For each ingredient, decide how it will be implemented: semantic HTML/CSS/SVG, generated asset, sourced project asset, icon library, canvas/WebGL, or an explicitly accepted omission. Do not substitute a different hero composition or new visual driver after approval unless the user approves the change.

If a photographic, architectural, product, or place-led mock becomes generic CSS scenery, decorative diagrams, cards, bullets, or copy, stop and fix it. That is not a harmless interpretation; it is a broken implementation.

Treat the mock as a **north star**, not a screenshot to trace. Do **not** rasterize core UI text or let the mock override the confirmed brief. But if the live result lacks the mock's major visible ingredients, the implementation is wrong.

## Step 4: Asset Extraction (Need-Gated)

If the approved direction needs raster assets, create them before building. Do not replace required imagery with generic cards, bullets, emoji, fake metrics, decorative CSS panels, or filler copy.

Use the native asset producer (`impeccable_asset_producer` in Codex, `impeccable-asset-producer` in Claude Code) to create clean assets from the hi-fi mock and crops. If you do not have explicit permission to use agents, stop and ask:

```text
Asset production will work better as a scoped subagent job. Should I spawn the Impeccable asset producer subagent for this step?
```

Do not skip asset production or silently do it inline. Inline asset production is allowed only if the user declines subagents, the harness cannot spawn the authorized agent, or the user explicitly asks for single-thread mode.

Pass the approved mock, crop/contact-sheet paths, output directory, dimensions/formats, transparency needs, constraints, and avoid list to the asset producer. Attach image generation capability to the spawned agent when the harness supports it; do not load image-generation reference material into the parent thread first.

Keep UI text, navigation, body copy, and structure semantic and editable. Prefer HTML/CSS/SVG/canvas when they can credibly reproduce an ingredient; use real/generated/stock imagery when the mock or subject matter calls for actual visual content.

## Step 5: Build to Production Quality

Implement the feature following the design brief. Build in passes so structure, visual system, states, motion/media, and responsive behavior each get deliberate attention. The list below is the definition of done, not inspiration.

### Production bar

- Use real or realistic content. Remove placeholder copy, placeholder images, dead links, fake controls, and unused scaffold before presenting.
- Preserve the approved mock's major ingredients. Missing hero objects, missing world/product imagery, different section structure, downgraded CTA/nav treatment, or generic replacements for distinctive motifs are blocking defects unless the user accepted the change.
- Build semantically first: real headings, landmarks, labels, form associations, button/link semantics, accessible names, and state announcements where needed.
- Calibrate spacing, alignment, grid placement, and vertical rhythm deliberately. Do not accept default gaps, arbitrary margins, unbalanced whitespace, or accidental optical misalignment.
- Make typography intentional: chosen font loading strategy, clear hierarchy, readable measure, stable line breaks, tuned wrapping, and no overflow at mobile or large desktop sizes.
- Design realistic state coverage: default, hover where supported, focus-visible, active, disabled, loading, error, success, empty, overflow, long text, short text, and first-run states where relevant.
- Make interaction quality feel finished: keyboard paths, touch targets, feedback timing, scroll behavior, transitions between states, and no hover-only functionality.
- Use icons from the project's established icon set when available. If no set exists, choose a coherent library or use accessible text controls; do not mix unrelated icon styles.
- Optimize imagery and media: correct dimensions, useful alt text, lazy loading below the fold, modern formats when practical, responsive `srcset` / `picture` for raster assets, and no project-referenced asset left outside the workspace.
- Make motion feel premium: use atmospheric blur, filter, mask, shadow, or reveal effects when they improve the experience; avoid casual layout-property animation, bound expensive effects, verify smoothness in-browser, respect reduced motion, and avoid choreography that blocks task completion.
- Preserve maintainability: reusable local patterns, clear component boundaries, project conventions, no rasterized UI text, and no hard-coded one-off hacks when a better local pattern exists.
- Fit the technical context: production build passes, no obvious console errors, no avoidable layout shift, no needless dependency, and no broken asset path.
- If you discover a design question that materially changes the brief or approved direction, stop and ask rather than guessing.

## Step 6: Browser-Based Iteration

**This step is critical.** Open the result in a browser and look at it. In Codex, use browser-use or equivalent; otherwise use Playwright or ask the user for screenshots. Inspect screenshots, not just DOM or terminal output.

Detector or QA output is defect evidence only. A clean detector, empty array, or script pass never means the design is strong. Do not cite clean automated checks as proof that the work is finished.

### Required viewport pass

Check the experience at the viewports that matter for the brief. Default minimum:

- Mobile narrow
- Tablet or small laptop
- Desktop wide

For each viewport, capture or inspect the rendered state and look for visual defects: overlap, clipping, weak hierarchy, off-grid alignment, awkward whitespace, cramped controls, unreadable type, broken imagery, hover-only functionality, layout shift, and text overflow.

For brand-register and long-form surfaces, inspect each major section individually, not only the full page. Full-page screenshots hide spacing, clipping, and cascade defects; when something looks off in a full-page thumbnail, take a targeted screenshot of that section to actually see the problem.

### Critique and fix loop

After the first browser pass, write an honest critique for yourself. If you find material defects, patch them and re-inspect. Continue until no material issues remain against the checklist below.

If the first inspection genuinely finds nothing material (the screenshots match the brief, the checklist is clean), say so and ship. **Do not invent a defect to demonstrate iteration.** A fake fix ("found one issue: form labels could be better; verified labels are correct") is worse than a confident "first pass clean, shipping."

Be ruthlessly honest. Most first passes have real defects; if yours doesn't, that's worth examining (am I looking carefully? did I take a useful screenshot, not just a full-page thumbnail?) but it's not a reason to fabricate work.

1. **Does it match the brief?** Compare the live result against every section of the design brief. Fix discrepancies.
2. **Does it match the approved mock?** Compare screenshots against the mock fidelity inventory: hero silhouette, major motifs, imagery, nav/CTA, section sequence, density, color/materials, and second-fold substance. Missing major ingredients are P0 defects.
3. **Does it pass the AI slop test?** If someone saw this and said "AI made this," would they believe it immediately? If yes, it needs more design intention.
4. **Check against impeccable's DON'T guidelines.** Fix any anti-pattern violations.
5. **Check every state.** Navigate through empty, error, loading, and edge case states. Each one should feel intentional, not like an afterthought.
6. **Check responsive behavior.** The design should adapt compositionally, not merely shrink.
7. **Check craft details.** Spacing consistency, optical alignment, type hierarchy, color contrast, image quality, icon coherence, interactive feedback, motion timing, and focus treatment.
8. **Check performance basics.** No obviously oversized images, avoidable layout thrash, blocking animations, or heavy assets without a reason.

The exit bar is not "it works." It is: the rendered result looks intentional at all checked viewports, all expected states are handled, no placeholders remain unless explicitly accepted, and the implementation quality would be defensible in a high-end studio review.

## Step 7: Present

Present the result to the user:
- Show the feature in its primary state
- Summarize the browser/viewports checked and the most important fixes made after inspection
- Walk through the key states (empty, error, responsive)
- Explain design decisions that connect back to the design brief and, when used, the chosen north-star mock. Include any accepted deviations from the mock; do not hide unimplemented mock ingredients.
- Note any remaining limitations or follow-up risks honestly
- Ask: "What's working? What isn't?"

Iterate based on feedback. Good design is rarely right on the first pass.
