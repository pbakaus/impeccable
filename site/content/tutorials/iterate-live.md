---
title: Iterate on UI with Live Mode
tagline: "Pick an element, generate three variants, accept one. Canvas-like iteration without leaving your code."
order: 2
description: "Use /impeccable live to visually iterate on a real element in your dev server: pick, annotate, generate three variants, accept the one you want, and have it written back to source."
---

## What you'll build

You will use `/impeccable live` on your dev server to iterate on a single piece of UI (a hero, a card, a section) and end with one of three AI-generated variants written back to source as real code. You'll see the canvas-style picking, annotation, and three-up cycling flow.

Total time: about ten minutes. Most of that is picking what to iterate on.

## Prerequisites

- Impeccable installed (see [getting started](/tutorials/getting-started) if you have not). Run `/impeccable teach` first if you haven't yet: variants lean on `PRODUCT.md` and `DESIGN.md` for brand fit.
- A running dev server with HMR (Vite, Next.js, SvelteKit, Astro, Nuxt, Bun) OR a static HTML file open in a browser.
- A page with at least one piece of UI you'd like to iterate on. A newsletter card, a hero, a pricing tier, something small enough to hold in your head.

## Step 1. Start live mode

From your harness, run:

```
/impeccable live
```

The skill starts a small local helper server on port 8400 and injects a `<script>` tag into your dev entry file that loads the picker. If your project has a strict Content Security Policy, the first run detects it and offers a one-time, dev-only patch for `script-src` and `connect-src`. Accept the patch: it is guarded by `NODE_ENV === "development"` and you can revert any time.

Open your dev server URL (not port 8400, that's the helper server, not the app). You'll see a dark pill at the bottom of the page with **Pick** highlighted.

## Step 2. Pick an element

<div class="docs-viz-step">
  <div class="docs-viz-picker-row">
    <div class="docs-viz-picker-target">
      <span class="docs-viz-picker-pin">1</span>
      Newsletter signup
      <span class="docs-viz-picker-note">more playful</span>
    </div>
  </div>
</div>

Click the element you want to iterate on. A picker outline appears around it, and a light context bar pops up next to the selection with a command chip on the left and a freeform text field.

A few things you can do before pressing Go:

- **Click the command chip** (default is `impeccable`, the freeform action). Pick a specific action like `bolder`, `delight`, `layout`, or `typeset` to constrain the variants along one dimension.
- **Type in the freeform field.** "More playful." "Less SaaS." "Feel like a newsletter from a magazine."
- **Drop a comment pin** by clicking anywhere on the picked element. The pin's position is load-bearing: a comment near the title is about the title, not the whole element.
- **Draw a stroke** by dragging across the element. Closed loop = "this part matters." Arrow = direction. Cross = "delete this." The skill reads strokes by shape, not by pixel content.

When the brief feels clear, hit **Go**.

## Step 3. Cycle through the three variants

<div class="docs-viz-step">
  <div class="docs-viz-variants">
    <div class="docs-viz-variant docs-viz-variant--v1">
      <span class="docs-viz-variant-badge">1 / 3</span>
      <span class="docs-viz-variant-kicker">No. 04</span>
      <p class="docs-viz-variant-title">Letters, <em>occasionally</em>.</p>
      <span class="docs-viz-variant-btn">Send me one</span>
    </div>
    <div class="docs-viz-variant docs-viz-variant--v2 is-active">
      <span class="docs-viz-variant-badge">2 / 3</span>
      <span class="docs-viz-variant-kicker">Dispatch</span>
      <p class="docs-viz-variant-title">Design notes, <br>every other<br>Thursday.</p>
      <span class="docs-viz-variant-btn">Join →</span>
    </div>
    <div class="docs-viz-variant docs-viz-variant--v3">
      <span class="docs-viz-variant-badge">3 / 3</span>
      <span class="docs-viz-variant-kicker">Field Notes</span>
      <p class="docs-viz-variant-title">A monthly letter, for people who still read email.</p>
      <span class="docs-viz-variant-btn">Receive ✺</span>
    </div>
  </div>
</div>

You'll see a spinner ("Generating variants...") and within a few seconds, three variants hot-swap into the page in place. Not a preview, the actual rendered DOM on your actual dev server with your actual context.

Use the arrow keys (or the prev / next buttons on the context bar) to cycle through them. A counter at the top right shows `1 / 3`, `2 / 3`, `3 / 3`.

The three variants are designed to be **genuinely different**, not three riffs on one idea. Freeform variants anchor to three different design archetypes (broadsheet masthead, oversized-glyph poster, catalog-style spec rows, and so on). Action-specific variants vary along the dimension the action names: `colorize` gives you three hue families, `animate` gives you three motion vocabularies, `layout` gives you three structural arrangements.

If two variants feel like they rhyme, that is the skill's "squint test" failure mode. You can tell the picker "try again, all three felt too similar" and get a fresh set.

## Step 4. Accept one

<div class="docs-viz-step" style="text-align:center">
  <span class="docs-viz-accept-pill">Variant 2 written to source</span>
</div>

When you find the one you like, click **Accept** on the context bar (or press Enter). Three things happen:

1. The picked element is replaced with the accepted variant on the page.
2. The variant is written back to source: the same file your picker was injected into, or the component source if live detected a generated file during step 1.
3. If the accept touched CSS, the relevant rules are consolidated into your project's real stylesheet, not left inline.

Discard all three (press Escape) and the original stays. No trace, no commented-out leftovers.

## Step 5. Stop live mode

When you are done iterating, stop the helper:

- Say **"stop live mode"** in your harness chat, or
- Click the **×** on the picker pill, or
- Close the browser tab: the helper detects the dropped connection after eight seconds and exits cleanly.

The stop also strips the `<script>` tag from your dev entry and stops the helper server on port 8400.

## What to try next

- Run `/impeccable live` on a different page after a `/impeccable polish` pass to A/B the polished version against two more directions.
- Pair with [critique with the overlay](/tutorials/critique-with-overlay): run critique first, fix priority issues, then use live to explore redirections on the element critique flagged.
- Reach for `/impeccable craft` when you want the shape-then-build flow (a new feature end-to-end, not a single element).

## Common issues

- **The picker never appears on the page.** Either the helper did not start (look for errors in the terminal) or CSP is blocking the inject. Re-run `/impeccable live` and let it re-check CSP. If you declined the patch on first run, delete the `cspChecked` line in `.impeccable/live/config.json` and re-run.
- **"element lives in a generated file"** on Go. Live detected that the picked element is in a compiled output, not a source file. It routes the accept through a fallback path so the variant still lands in true source. Follow the hint; don't force-accept into the generated file.
- **Variants don't feel brand-aligned.** Check that `PRODUCT.md` and `DESIGN.md` exist at the project root. Without them, live leans toward generic defaults. Run `/impeccable teach` and `/impeccable document` first.
- **The helper port is in use.** Another live session left its server running. `npx impeccable live stop` releases the port.
