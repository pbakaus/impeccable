# Craft Flow

Build a feature with impeccable UX and UI quality through a structured process: shape the design, land the visual direction, build real production code, then inspect and improve in-browser until the result meets a high-end studio bar.

## Build Gate

Craft cannot build until all of these are true:

1. PRODUCT context is valid and current.
2. The shape design brief is explicitly confirmed by the user for this task, unless the user already provided a confirmed brief.
3. Implementation references from the brief are loaded.
4. The shape visual probe decision is recorded: generated, skipped with reason, or already resolved.
5. The north-star mock decision is recorded: generated, skipped with reason, or not applicable.

PRODUCT.md and `teach` answers do **not** satisfy the shape gate. They are project context only. A compact self-authored brief does not satisfy the shape gate either. `shape=pass` requires a separate user response approving the shape brief or an already-confirmed brief supplied by the user.

Invalid image-skip reasons include: "the final implementation will be semantic HTML/CSS/SVG", "the diagram should stay editable", "a raster mock would not be used directly", or "the product is fictional." Generated probes and mocks are direction artifacts; they are not implementation assets.

## Craft Contract

Craft is not a first pass. It is a loop with these required artifacts:

1. Confirmed design brief from `shape`.
2. Approved visual direction, from generated probes / mocks when image generation is available.
3. Mock fidelity inventory: the visible ingredients from the approved direction that must survive into code.
4. Semantic, functional implementation using the project's real stack and conventions.
5. Browser evidence across relevant viewports.
6. At least one critique-and-fix pass after the first browser inspection, unless the first pass has no material defects.

Do not let generated mockups replace interface structure, copy, accessibility, responsive behavior, or state design. But do treat the approved mock as a concrete visual contract for composition, hierarchy, density, atmosphere, signature motifs, image needs, and distinctive visual moves. "North star" means "preserve the important visible ingredients in semantic code," not "use it as loose mood."

## Step 1: Shape the Design

Run /impeccable shape, passing along whatever feature description the user provided.

Wait for the design brief to be fully confirmed by the user before proceeding. The brief is your blueprint, and every implementation decision should trace back to it.

If this craft run resumed after `teach` created PRODUCT.md, run shape now. Do not treat the teach interview, PRODUCT.md, or a summary of project context as a substitute for shape. Shape is task-specific and must cover scope, content/states, visual direction, constraints, anti-goals, probes when applicable, and explicit brief confirmation.

If the user has already run /impeccable shape and has a confirmed design brief, skip this step and use the existing brief.

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
- The current harness has **built-in image generation capability** (for example, Codex with a native image tool). Do **not** ask the user to set up external APIs, shell scripts, or one-off tooling just to do this.

When those conditions are met, this step is mandatory for **both brand and product work** in Codex and any harness with built-in image generation. Use native image generation; in Codex, use the built-in `image_gen` tool via the imagegen skill. If image generation is unavailable, do not ask the user to install APIs or tooling. State in one line that the image step is skipped because the harness lacks native image generation, then proceed.

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

Treat the mock as a **north star**, not a screenshot to trace. Do **not** rasterize core UI text or let the mock override the confirmed brief. But if the live result lacks the mock's major visible ingredients, the implementation is wrong.

## Step 4: Asset Extraction (Need-Gated)

If the chosen direction includes image-native visual ingredients that would materially improve the implementation, generate them as separate assets before building.

Good candidates:

- stickers
- badges
- seals
- tickets
- graphic labels
- textures
- abstract objects
- decorative marks
- non-semantic scene elements

For travel, editorial, portfolio, venue, product showcase, entertainment, education, or any other image-led brand surface, visual assets are usually core content, not decoration. Do not ship abstract CSS panels where the approved mock or subject matter calls for real imagery, generated plates, illustrations, maps, product/object renders, or destination scenes.

Do **not** export assets for core UI text, navigation, body copy, or any structure that should stay semantic and editable in code.

Usually **1 to 5** extracted assets is enough. If the design can be built cleanly in HTML/CSS/SVG, prefer that over raster assets. If the mock contains major visual content that cannot be built credibly in code, asset extraction is not optional.

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

**This step is critical.** Do not stop after the first implementation pass.

Open the result in a browser. In Codex, use browser-use or equivalent browser automation when available; otherwise use Playwright or ask the user for screenshots. Inspect screenshots, not just DOM or terminal output.

### Required viewport pass

Check the experience at the viewports that matter for the brief. Default minimum:

- Mobile narrow
- Tablet or small laptop
- Desktop wide

For each viewport, capture or inspect the rendered state and look for visual defects: overlap, clipping, weak hierarchy, off-grid alignment, awkward whitespace, cramped controls, unreadable type, broken imagery, hover-only functionality, layout shift, and text overflow.

### Critique and fix loop

After the first browser pass, write a short critique for yourself and patch the implementation. Repeat browser inspection after fixes. Continue until no material issues remain against this checklist:

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
