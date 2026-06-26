---
title: Getting started
tagline: "From install to your first polish pass in about ten minutes."
order: 1
description: "Install Impeccable, run /impeccable init once to establish design context, and run /impeccable polish on something that already exists. The fastest path to seeing what Impeccable changes about AI-generated design."
---

## What you'll build

You will end this tutorial with Impeccable installed, design context saved, and one existing page improved with a polish pass. Total time: about ten minutes.

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
npx impeccable install
/impeccable init
/impeccable polish the page you care about
```

## Step 1. Install

<div class="docs-note">
  <span class="docs-note-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"/><path d="M14.5 14.25a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm-5 0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z"/></svg></span>
  <span class="docs-note-text"><strong>On the GitHub Copilot app?</strong> Impeccable is built in. Skip the install below and enable it under <strong>Settings &rarr; Experimental</strong>.</span>
</div>

From the root of your project, run:

```
npx impeccable install
```

This auto-detects your AI coding tool and writes the right skill files for it (for example, `.claude/skills/` or `.cursor/skills/`). It works with Cursor, Claude Code, GitHub Copilot, Gemini CLI, Codex CLI, and every other major harness. Reload your tool and type `/`. You should see `/impeccable` in the autocomplete. Type it and the argument hint will show the available commands.

Prefer a different setup? Claude Code users can install the plugin with `/plugin marketplace add pbakaus/impeccable`, and the general-purpose `npx skills add pbakaus/impeccable` still works (though it installs one shared build for all harnesses rather than the one compiled for yours).

When a new version ships later, run `npx impeccable update` from the same project root. `npx impeccable check` tells you first whether you are behind, and plugin users update from the `/plugin` menu instead.

On Claude Code, GitHub Copilot, Codex, and Cursor, the installer can also add Impeccable's automatic design hook. See [Design hooks](/docs/hooks) for harness-specific behavior and approval steps.

## Step 2. Set up Impeccable for your project

This is the most important step. Design without context produces generic output. The `/impeccable init` command runs a short setup interview and writes `PRODUCT.md` at the root of your project.

Run:

```
/impeccable init
```

The first question is simple: is this a **brand surface** or a **product surface**?

- **Brand surface:** marketing site, landing page, campaign, portfolio. The impression is the product.
- **Product surface:** app UI, dashboard, admin, workflow tool. The design helps someone finish a task.

The docs call this choice **register**. It changes the defaults Impeccable uses for type, color, density, and motion. See [Design Context](/docs/context) for examples. Init forms a hypothesis from your codebase and asks you to confirm it.

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

`PRODUCT.md` carries strategy (who, what, why). `DESIGN.md` carries visuals (colors, typography, components). Every command reads both before generating. See [Design Context](/docs/context) for the full model.

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
- `npx impeccable detect src/` runs the deterministic detector directly from the terminal. See [Detector CLI](/docs/detector).
- `/impeccable craft a pricing page for enterprise customers` runs the full shape-then-build flow on a brand new feature.
- **Pin your favorites.** If you reach for one command constantly, `/impeccable pin audit` makes `/audit` work as a standalone shortcut without reversing the consolidation.
- `/impeccable redo this hero section` works too. Any description after `/impeccable` applies the design principles to the task.

## Common issues

- **The skill says "no design context found"**. You skipped step 2. Run `/impeccable init` first.
- **Commands do not appear in the harness**. Reload the harness after installing. If they still do not appear, check that the installer wrote files into the expected location (`.claude/skills/`, `.cursor/skills/`, etc.) and that your harness is picking up that directory.
- **The polish pass rewrote something you liked**. Say so. Revert the change, tell the model which specific edit to undo, and continue from there.
