---
title: Design Context
tagline: "Give Impeccable enough project memory to make specific design decisions."
description: "Understand why Impeccable needs design context, what to put in PRODUCT.md and DESIGN.md, and how to keep that context current."
section: concepts
order: 1
---

Impeccable works best when it can read the same product and design decisions you would give a human designer. Without that context, it has to infer audience, tone, palette, type, and component rules from code alone. That usually produces safer, more generic answers.

<p class="docs-context-note">If Impeccable gives you generic advice, the design context is usually missing, too vague, or stale.</p>

## The fast path

Run the setup once from your project root:

```text
/impeccable init
```

That creates `PRODUCT.md`, the strategy file. At the end, say yes when Impeccable offers to run:

```text
/impeccable document
```

That creates `DESIGN.md`, the visual-system file, plus a generated helper at `.impeccable/design.json`. Review the two markdown files. Edit anything that does not match the real product.

<div class="docs-context-flow" aria-label="How Impeccable uses design context">
  <div class="docs-context-flow-source">
    <span class="docs-context-flow-label">Strategy</span>
    <strong>PRODUCT.md</strong>
    <span>Audience, purpose, voice, register, anti-references.</span>
  </div>
  <div class="docs-context-flow-source">
    <span class="docs-context-flow-label">Visual system</span>
    <strong>DESIGN.md</strong>
    <span>Colors, type, components, radii, design rules.</span>
  </div>
  <div class="docs-context-flow-source docs-context-flow-source--generated">
    <span class="docs-context-flow-label">Generated</span>
    <strong>.impeccable/design.json</strong>
    <span>Structured metadata for automation. Do not hand-edit.</span>
  </div>
  <div class="docs-context-flow-output">
    <span class="docs-context-flow-label">Used by</span>
    <strong>Commands, hooks, detector, Live Mode</strong>
    <span>More specific edits, better audits, fewer false assumptions.</span>
  </div>
</div>

## What goes where

| File | What it should answer | Update it when |
|---|---|---|
| `PRODUCT.md` | Who is this for? What is the product trying to do? What should the brand feel like? Is this a brand surface or a product surface? What should the work avoid? | Audience, positioning, product purpose, voice, register, or anti-references change. |
| `DESIGN.md` | What colors, type stacks, component treatments, radii, elevation, and visual rules are allowed? | Palette, typography, components, tokens, spacing/radius scales, or design rules change. |
| `.impeccable/design.json` | What structured design data should automation use? | Do not edit it directly. Refresh it by running `/impeccable document`. |

The markdown files are the files you own. The generated JSON helps the detector, hooks, and Live Mode read the design system precisely.

## The most important choice: brand or product

Impeccable calls this choice the **register**. In daily use, just decide what kind of surface you are asking it to judge.

- **Brand surface:** marketing site, landing page, campaign, portfolio, editorial page. The visitor is evaluating, trusting, remembering, comparing, or feeling the brand.
- **Product surface:** app UI, dashboard, admin screen, workflow tool, settings page. The user is configuring, monitoring, searching, submitting, comparing data, or finishing a task.

The same visual move can be right in one register and wrong in the other. A campaign page can afford a huge image, expressive type, and one dominant idea per screen. A dashboard needs density, predictable controls, readable states, stable navigation, and quieter motion.

Many codebases have both. Set the project default to the surface you work on most, then be explicit when a task differs:

```text
/impeccable polish the marketing homepage as a brand surface
/impeccable audit the billing settings as a product surface
```

## How context changes the output

With context loaded, Impeccable can:

- preserve the right identity instead of "improving" it into something generic;
- pick the right standard for the surface: expressive brand page or efficient product UI;
- replace hardcoded visual choices with documented tokens and components;
- flag drift, such as fonts, colors, or border radii outside `DESIGN.md`;
- keep Live Mode variants aligned with the system instead of inventing new palettes.

The context does not replace judgment. Existing code still matters, and an intentional exception can be documented with a detector ignore. See [Config and ignores](/docs/config).

## Keeping context fresh

Use this rule:

| Change in the project | Run |
|---|---|
| New audience, positioning, product purpose, brand voice, or register | `/impeccable init` |
| New palette, type stack, component primitives, radius scale, or design rules | `/impeccable document` |
| A hook says `DESIGN.md` is newer than `.impeccable/design.json` | `/impeccable document` |
| One-off intentional detector finding | Add a narrow ignore with `/impeccable hooks ignore-value` or `npx impeccable ignores`. |

Treat context files like any other design artifact: review them in code review when they change, and update them when the product changes.

## Details when the default path is not enough

<details class="docs-context-details">
  <summary>Where Impeccable looks for context files</summary>
  <div>
    <p>For normal projects, put <code>PRODUCT.md</code> and <code>DESIGN.md</code> in the project root.</p>
    <p>Skill commands look in the root first. If root context is missing, they also check <code>.agents/context/</code> and <code>docs/</code>.</p>
    <p>The detector's design-system rules use the same root-first behavior for <code>DESIGN.md</code>. For generated design metadata, the primary path is <code>.impeccable/design.json</code>. Legacy <code>DESIGN.json</code> files are still accepted as fallbacks, but new projects should use <code>.impeccable/design.json</code>.</p>
  </div>
</details>

<details class="docs-context-details">
  <summary>What happens when docs and code disagree</summary>
  <div>
    <p><code>PRODUCT.md</code> wins on strategy: audience, tone, register, anti-references, and whether a change should preserve or reject the current identity.</p>
    <p><code>DESIGN.md</code> wins on visual decisions: color, typography, radius, elevation, component behavior, and system-specific do/don't rules.</p>
    <p>Existing code still matters. Commands read project files before editing and preserve real conventions when they are stronger or newer than the docs. A stale <code>DESIGN.md</code> is a signal to refresh the docs, not permission to ignore the implementation.</p>
  </div>
</details>

<details class="docs-context-details">
  <summary>Which detector rules unlock when DESIGN.md exists</summary>
  <div>
    <p>When <code>DESIGN.md</code> exists, <code>npx impeccable detect</code> and the design hook unlock design-system checks:</p>
    <ul>
      <li><code>design-system-font</code> flags primary fonts not declared in <code>DESIGN.md</code> typography.</li>
      <li><code>design-system-color</code> flags literal colors outside the documented palette or sidecar ramps.</li>
      <li><code>design-system-radius</code> flags border-radius values outside the documented rounded scale.</li>
    </ul>
    <p>These rules do not run when <code>DESIGN.md</code> is absent, when config disables design-system checks, or when you pass <code>--no-design-system</code> to the detector. See <a href="/docs/detector">Detector CLI</a>.</p>
  </div>
</details>
