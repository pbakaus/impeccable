---
title: Getting started
tagline: "From zero to your first polish pass in five minutes."
order: 1
description: "Install Impeccable, run /impeccable teach once to establish project context, and run /impeccable polish on something that already exists. The fastest path to seeing what Impeccable changes about AI-generated design."
---

## What you'll build

You will end this tutorial with Impeccable installed in your project, a `PRODUCT.md` plus `DESIGN.md` pair that captures your brand, audience, and visual system, and one hand-polished page that went through a polish pass. Total time: about ten minutes.

## Prerequisites

- An AI coding harness: Claude Code, Cursor, Gemini CLI, Codex CLI, or any of the other supported tools.
- A project with at least one HTML or component file you want to improve. A fresh scaffolded landing page works fine.

## How Impeccable works

Impeccable installs as a single agent skill called `impeccable`. You access all 23 sub-commands through it:

```
/impeccable <command> <target>
```

For example: `/impeccable polish the pricing page`, or `/impeccable audit the checkout`. Type `/impeccable` alone to see the full list.

If you use a command often, pin it with `/impeccable pin <command>` to create a standalone shortcut (for example, `/impeccable pin audit` gives you `/audit` directly).

## Step 1. Install

From the root of your project, run:

```
npx skills add pbakaus/impeccable
```

This auto-detects your harness and writes the skill files to the right location (e.g., `.claude/skills/`, `.cursor/skills/`). Reload your harness and type `/`. You should see `/impeccable` in the autocomplete. Type it and the skill's argument hint will show all available commands.

## Step 2. Teach Impeccable about your project

This is the most important step. Design without context produces generic output. The `/impeccable teach` command runs a short discovery interview and writes a `PRODUCT.md` file at the root of your project.

Run:

```
/impeccable teach
```

The first question is about **register**: is this a brand surface (marketing site, landing page, portfolio, where design IS the product) or a product surface (app UI, dashboard, tools, where design SERVES the product)? Register shapes every downstream default, from type lanes to motion energy. See [brand vs product](/tutorials/brand-vs-product) for how the two diverge. Teach will form a hypothesis from your codebase and ask you to confirm, rather than starting cold.

Then a handful of shorter questions:

- **Who is this product for?** Be specific. Not "users" but "solo founders evaluating a new tool on their phone between meetings".
- **What is the brand voice in three words?** Pick real words. "Warm and mechanical and opinionated" is better than "modern and clean".
- **Any visual references?** Named brands, products, or printed objects, not adjectives. "Klim Type Foundry specimen pages", not "technical and clean".
- **Anti-references?** Things the product should explicitly not look like, equally named.

Answer in your own words. The skill writes `PRODUCT.md` with the answers. Every future command run reads it automatically.

Open `PRODUCT.md` and read what it wrote. Edit anything that does not feel right. The file is yours.

## Step 2.5. Capture the visual system

At the end of `/impeccable teach`, the skill offers to run `/impeccable document` for you. Say yes. It scans your tokens (CSS custom properties, Tailwind config, CSS-in-JS themes), extracts colors and typography, asks one grouped question for the parts that need creative input (a Creative North Star, descriptive color names), and writes a `DESIGN.md` that follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/).

On a fresh project with no tokens yet, document runs in seed mode: five quick questions about color strategy, type direction, and motion energy, and writes a scaffold you can refresh once there is code.

`PRODUCT.md` carries strategy (who, what, why). `DESIGN.md` carries visuals (colors, typography, components). Every command reads both before generating.

## Step 3. Polish something

Pick a page that already exists. An about page, a settings screen, a pricing table, anything. Run:

```
/impeccable polish the pricing page
```

The skill will walk through alignment, spacing, typography, color, interaction states, transitions, and copy. It makes targeted fixes, not a rewrite. Expect a handful of small diffs that together lift the page from "done" to "done well".

A typical polish pass looks like:

```
Visual alignment: fixed 3 off-grid elements
Typography: tightened h1 kerning, fixed widow on feature list
Color: replaced one hardcoded hex with --color-accent token
Interaction: added missing hover state on FAQ items
Motion: softened modal entrance to 220ms ease-out-quart
Copy: removed stray 'Lorem' placeholder
```

Review the diff. If something does not feel right, ask the model to explain the change. If it still does not feel right, revert it. Impeccable is opinionated but not infallible.

## What to try next

- [Iterate visually with Live Mode](/tutorials/iterate-live) opens a browser picker on your dev server, generates three production-quality variants per element, and writes the accepted one back to source.
- `/impeccable critique the landing page` runs a full design review with scoring, persona tests, and automated detection. It is the best way to find what to fix next.
- `/impeccable audit the checkout` runs accessibility, performance, theming, responsive, and anti-pattern checks against the implementation. Useful before shipping.
- `/impeccable craft a pricing page for enterprise customers` runs the full shape-then-build flow on a brand new feature.
- **Pin your favorites.** If you reach for one command constantly, `/impeccable pin audit` makes `/audit` work as a standalone shortcut without reversing the consolidation.
- `/impeccable redo this hero section` works too. Any description after `/impeccable` applies the design principles to the task.

## Common issues

- **The skill says "no design context found"**. You skipped step 2. Run `/impeccable teach` first.
- **Commands do not appear in the harness**. Reload the harness after installing. If they still do not appear, check that the installer wrote files into the expected location (`.claude/skills/`, `.cursor/skills/`, etc.) and that your harness is picking up that directory.
- **The polish pass rewrote something you liked**. Say so. Revert the change, tell the model which specific edit to undo, and continue from there.
