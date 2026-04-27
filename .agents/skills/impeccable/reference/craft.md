# Craft Flow

Build a feature with impeccable UX and UI quality through a structured process: shape the design, load the right references, then build and iterate visually until the result is delightful.

## Real Example: Neo Mirai

Neo Mirai is the full craft loop in public. A retro-futurist AI design conference started with generated brand and hi-fi reference images, then shipped as a responsive static site in `public/neo-mirai`.

Repro command:

```bash
$impeccable craft retro-futurist AI design conference website
```

The important detail is the artifact chain: brand toolkit, north-star mock, semantic implementation, regenerated assets, browser iteration, responsive fixes. The mock was not treated as a screenshot to trace. It was used as direction for a real page.

## Step 1: Shape the Design

Run $impeccable shape, passing along whatever feature description the user provided.

Wait for the design brief to be fully confirmed before proceeding. The brief is your blueprint, and every implementation decision should trace back to it.

If the user has already run $impeccable shape and has a confirmed design brief, skip this step and use the existing brief.

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

## Step 3: North Star Mock (Capability-Gated)

Before implementation, generate a small set of high-fidelity visual comps when all of these are true:

- The work is **net-new** or visually open-ended enough that composition exploration will improve the build.
- The brief's scope is **mid-fi, high-fi, or production-ready**.
- The current harness has **built-in image generation capability** (for example, Codex with a native image tool). Do **not** ask the user to set up external APIs, shell scripts, or one-off tooling just to do this.

When those conditions are met, this step is the default for **both brand and product work**.

### Purpose

Use the mock step to find a stronger visual lane than code-first generation would reliably discover on its own. The brief remains authoritative on user, purpose, content, constraints, states, and anti-goals. The mock clarifies composition, hierarchy, density, typography, and visual tone.

### What to generate

Generate **1 to 3** high-fidelity north-star comps based on the confirmed brief.

- For brand work, push visual identity, composition, and mood aggressively.
- For product work, still push hierarchy, topology, density, and tone, but keep the comps grounded in realistic product structure and states.

The comps must be genuinely different in primary visual direction, not just color variants.

### After generation

Choose a direction with the user, or if the user delegated the decision, pick the strongest one and explain why.

Before moving to implementation, summarize:

- What to carry into code
- What **not** to literalize from the mock

Treat the mock as a **north star**, not a screenshot to trace. Do **not** let it override the confirmed brief.

## Step 4: Asset Extraction (Optional)

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

Do **not** export assets for core UI text, navigation, body copy, or any structure that should stay semantic and editable in code.

Usually **1 to 5** extracted assets is enough. If the design can be built cleanly in HTML/CSS/SVG, prefer that over raster assets.

## Step 5: Build

Implement the feature following the design brief. Work in this order:

1. **Structure first**: HTML/semantic structure for the primary state. No styling yet.
2. **Layout and spacing**: Establish the spatial rhythm and visual hierarchy.
3. **Typography and color**: Apply the type scale and color system.
4. **Interactive states**: Hover, focus, active, disabled.
5. **Edge case states**: Empty, loading, error, overflow, first-run.
6. **Motion**: Purposeful transitions and animations (if appropriate).
7. **Responsive**: Adapt for different viewports. Don't just shrink; redesign for the context.

### During Build
- Test with real (or realistic) data at every step, not placeholder text
- Check each state as you build it, not all at the end
- If you discover a design question, stop and ask rather than guessing
- Every visual choice should trace back to something in the design brief or the chosen north-star direction
- Keep text semantic, layout real, and interactions accessible. Do not turn the mock into a pile of rasterized UI
- If assets were extracted, use them intentionally. They support the build; they do not replace interface structure

## Step 6: Visual Iteration

**This step is critical.** Do not stop after the first implementation pass.

Open the result in a browser window. If browser automation tools are available, use them to navigate to the page and visually inspect the result. If not, ask the user to open it and provide feedback.

Iterate through these checks visually:

1. **Does it match the brief?** Compare the live result against every section of the design brief. Fix discrepancies.
2. **Does it pass the AI slop test?** If someone saw this and said "AI made this," would they believe it immediately? If yes, it needs more design intention.
3. **Check against impeccable's DON'T guidelines.** Fix any anti-pattern violations.
4. **Check every state.** Navigate through empty, error, loading, and edge case states. Each one should feel intentional, not like an afterthought.
5. **Check responsive.** Resize the viewport. Does it adapt well or just shrink?
6. **Check the details.** Spacing consistency, type hierarchy clarity, color contrast, interactive feedback, motion timing.

After each round of fixes, visually verify again. **Repeat until you would be proud to show this to the user.** The bar is not "it works"; the bar is "this delights."

## Step 7: Present

Present the result to the user:
- Show the feature in its primary state
- Walk through the key states (empty, error, responsive)
- Explain design decisions that connect back to the design brief and, when used, the chosen north-star mock
- Ask: "What's working? What isn't?"

Iterate based on feedback. Good design is rarely right on the first pass.
