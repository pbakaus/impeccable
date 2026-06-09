---
title: Getting started
tagline: "From install to your first polish pass in about ten minutes."
order: 1
description: "Install Impeccable, run /impeccable init once to establish project context, and run /impeccable polish on something that already exists. The fastest path to seeing what Impeccable changes about AI-generated design."
---

## What you'll build

You will end this tutorial with Impeccable installed, project context saved, and one existing page improved with a polish pass. Total time: about ten minutes.

## Prerequisites

- An AI coding harness: Claude Code, Cursor, GitHub Copilot, Gemini CLI, Codex CLI, or any of the other supported tools.
- A project with at least one HTML or component file you want to improve. A fresh scaffolded landing page works fine.

## How Impeccable works

Impeccable installs as a single agent skill called `impeccable`. You access all 23 commands through it:

```
/impeccable <command> <target>
```

For example: `/impeccable polish the pricing page`, or `/impeccable audit the checkout`. Type `/impeccable` alone to see the full list.

If you use a command often, pin it with `/impeccable pin <command>` to create a standalone shortcut (for example, `/impeccable pin audit` gives you `/audit` directly).

If you only remember one sequence, make it this:

```
npx impeccable skills install
/impeccable init
/impeccable polish the page you care about
```

## Step 1. Install

From the root of your project, run:

```
npx impeccable skills install
```

This auto-detects your AI coding tool and writes the right skill files for it (for example, `.claude/skills/` or `.cursor/skills/`). It works with Cursor, Claude Code, GitHub Copilot, Gemini CLI, Codex CLI, and every other major harness. Reload your tool and type `/`. You should see `/impeccable` in the autocomplete. Type it and the argument hint will show the available commands.

Prefer a different setup? Claude Code users can install the plugin with `/plugin marketplace add pbakaus/impeccable`, and the general-purpose `npx skills add pbakaus/impeccable` still works (though it installs one shared build for all harnesses rather than the one compiled for yours).

When a new version ships later, run `npx impeccable skills update` from the same project root. `npx impeccable skills check` tells you first whether you are behind, and plugin users update from the `/plugin` menu instead.

## Step 2. Set up Impeccable for your project

This is the most important step. Design without context produces generic output. The `/impeccable init` command runs a short setup interview and writes `PRODUCT.md` at the root of your project.

Run:

```
/impeccable init
```

The first question is simple: is this a **brand surface** or a **product surface**?

- **Brand surface:** marketing site, landing page, campaign, portfolio. The impression is the product.
- **Product surface:** app UI, dashboard, admin, workflow tool. The design helps someone finish a task.

The docs call this choice **register**. It changes the defaults Impeccable uses for type, color, density, and motion. See [Brand vs product](/tutorials/brand-vs-product) for examples. Init forms a hypothesis from your codebase and asks you to confirm it.

Then a handful of shorter questions:

- **Who is this product for?** Be specific. Not "users" but "solo founders evaluating a new tool on their phone between meetings".
- **What is the brand voice in three words?** Pick real words. "Warm and mechanical and opinionated" is better than "modern and clean".
- **Any visual references?** Named brands, products, or printed objects, not adjectives. "Klim Type Foundry specimen pages", not "technical and clean".
- **Anti-references?** Things the product should explicitly not look like, equally named.

Answer in your own words. The skill writes `PRODUCT.md` with the answers, and every future command reads it automatically.

Open `PRODUCT.md` and read what it wrote. Edit anything that does not feel right. The file is yours.

## Step 2.5. Capture the visual system

At the end of `/impeccable init`, the skill offers to run `/impeccable document` for you. Say yes. It looks at your existing colors, type, components, and tokens, then writes `DESIGN.md` in the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/).

On a fresh project with no visual system yet, document asks a few setup questions and writes a starting scaffold. Refresh it once there is real code.

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

- **The skill says "no design context found"**. You skipped step 2. Run `/impeccable init` first.
- **Commands do not appear in the harness**. Reload the harness after installing. If they still do not appear, check that the installer wrote files into the expected location (`.claude/skills/`, `.cursor/skills/`, etc.) and that your harness is picking up that directory.
- **The polish pass rewrote something you liked**. Say so. Revert the change, tell the model which specific edit to undo, and continue from there.
