---
title: Critique with the visual overlay
tagline: "Use /impeccable critique plus the browser overlay to review a live page with ground truth."
order: 4
description: "Run a full design critique that combines LLM assessment, the automated detector, and a live browser overlay so you can see exactly which elements trigger which anti-patterns on the page you're looking at."
---

## What you'll build

You will run a complete design critique against a live page in your browser, with every flagged anti-pattern highlighted directly on the element that caused it. No screenshots, no guesswork, no paragraph of findings you have to map back to the code.

Total time: about ten minutes.

## Prerequisites

- Impeccable installed in your project (see [getting started](/tutorials/getting-started) if you have not).
- A harness with browser automation available (Claude Code with the Chrome extension, or similar).
- A page you want to critique, either local (`localhost:3000/pricing`) or deployed.

## Step 1. Run /impeccable critique

From your harness, run:

```
/impeccable critique the pricing page at localhost:3000/pricing
```

The skill kicks off two independent assessments in parallel. They run in separate sub-agents so one does not bias the other.

### What the LLM assessment does

The first assessment reads your source code and, if browser automation is available, opens the live page in a new tab. It walks the full impeccable skill DO/DON'T catalog and scores the page against Nielsen's 10 heuristics, the 8-item cognitive load checklist, and the brand fit from your `PRODUCT.md`.

It labels the tab it opens with `[LLM]` in the title so you can tell which one is which.

### What the automated detector does

The second assessment runs `npx impeccable detect` against the page. This is deterministic: around thirty specific pattern checks that fire or do not fire. Gradient text, purple palettes, side-tab borders, nested cards, line length problems, low contrast, tiny body text, and the rest. The [full catalog](/anti-patterns) lists every rule and which layer (CLI, browser, or LLM-only) catches it.

You get back a JSON list of every finding with its element selector, the rule that fired, and a short description.

## Step 2. Open the visual overlay

Impeccable ships with a visual mode that highlights every detected anti-pattern directly on the page. Here is what it looks like running on a deliberately-bad synthwave landing page:

<div class="tutorial-embed">
  <div class="tutorial-embed-header">
    <span class="tutorial-embed-dot red"></span>
    <span class="tutorial-embed-dot yellow"></span>
    <span class="tutorial-embed-dot green"></span>
    <span class="tutorial-embed-title">Live detection overlay</span>
  </div>
  <iframe src="/antipattern-examples/visual-mode-demo.html" class="tutorial-embed-iframe" loading="lazy" title="Impeccable visual overlay running on a demo page"></iframe>
</div>

Every outlined element has a floating label naming the rule that fired. Hover an outline to see the full finding. This is exactly what you will see on your own page.

You have two ways to open it:

1. **[Chrome extension](https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf)**: one-click activation on any page. Click the Impeccable icon in the toolbar and every anti-pattern gets highlighted instantly.
2. **Inside `/impeccable critique`**: the skill opens a browser tab labeled `[Human]` with the detector active during the browser portion of the assessment. You do not need to do anything extra.

For this tutorial, the easiest option is the Chrome extension. Install it, navigate to your pricing page, and click the Impeccable icon. You will see the overlay appear immediately on the live page.

## Step 3. Merge the two assessments

Back in your harness, `/impeccable critique` has finished and produced a combined report. It looks something like:

```
AI slop verdict: FAIL
  Detected tells: gradient-text (2), ai-color-palette (1),
                  nested-cards (1), side-tab (3)

Heuristic scores (avg 2.8/4):
  Visibility of status: 3 (good)
  Match between system and real world: 2 (partial)
  Consistency and standards: 2 (partial)
  ...

Cognitive load: 3/8 failures (moderate)
  Visible options at primary decision: 6 (flag)
  Decision points stacked at top: yes (flag)
  Progressive disclosure: absent on advanced pricing toggles

What's working:
  - Clear price hierarchy
  - Strong headline

Priority issues:
  1. Hero uses gradient text on the main price
     Why: AI tell, reduces contrast, hurts scannability
     Fix: solid ink color at one weight heavier
  2. Feature comparison table has 4 nested card levels
     Why: visual noise, unclear hierarchy
     Fix: flatten to a table with zebra striping

Questions to answer:
  - Is the free tier a real product or a funnel?
  - What does a user feel when they land here from an ad vs from search?
```

## Step 4. Fix the findings

The report gives you a priority list. You can work through them one at a time, ask the model to fix them all at once, or anything in between. What matters is using the overlay to verify:

1. Keep the overlay open in one tab.
2. Make fixes in code (or ask the model to fix everything).
3. Reload. The overlay re-scans and resolved findings disappear.

This feedback loop is the reason the overlay matters. You see fixes land in real time, and you never ship a "fix" that did not actually satisfy the rule.

## Step 5. Re-run when you are done

After you have worked through the priority list, run `/impeccable critique` again. The goal is a clean AI slop verdict and at least a 3.5 average on the heuristics. Cognitive load should be below 2 failures.

If something still fires, fix it or write a suppression comment explaining why the rule does not apply in your context (the detector respects a small set of opt-out pragmas, but use them sparingly).

## What to try next

- [Iterate on the critique findings with Live Mode](/tutorials/iterate-live). Pick the element critique flagged, drop a comment, get three redirections hot-swapped in place, and write the accepted one back to source.
- `/impeccable audit the same page` to catch the implementation issues critique does not cover (accessibility, performance, theming).
- `/impeccable polish` if the critique report is clean and you want the last-mile refinement pass.
- `/impeccable distill` if critique flagged "too busy" or "cognitive load". Distill removes what should not be there.

## Common issues

- **The overlay shows no findings but critique says there are problems**. The detector catches deterministic patterns. Critique catches judgment calls. They are complementary, not redundant.
- **The LLM assessment and the detector disagree**. That is normal. The LLM is subjective. The detector is deterministic. When they disagree, look at both and make a call.
- **The overlay breaks the page layout**. Rare, but some CSS can interact with the injected overlay styles. Use the [Chrome extension](https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf) for the most reliable experience, or run `npx impeccable detect` from the CLI and apply findings manually.
