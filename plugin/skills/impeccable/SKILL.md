---
name: impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.
version: 4.0.0-alpha.9
user-invocable: true
argument-hint: "[craft|shape · audit|critique · animate|bolder|colorize|delight|layout|overdrive|quieter|typeset · adapt|clarify|distill · harden|onboard|optimize|polish · init|document|extract|live] [target]"
license: Apache 2.0
allowed-tools:
  - Bash(npx impeccable *)
  - Bash(node .claude/skills/impeccable/scripts/*)
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

Approach every design task as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. The client has already rejected work that felt templated; they are paying for a point of view. Claude is capable of extraordinary work. Don't hold back.

## Setup

1. Run `node .claude/skills/impeccable/scripts/context.mjs` once per session (if the runtime shows this skill's loaded base directory, run `node <skill-base-dir>/scripts/context.mjs`; keep cwd at the user's project). It prints the project's PRODUCT.md and DESIGN.md when they exist; follow what it prints, including any `UPDATE_AVAILABLE` directive (ask once, never block). If it reports `NO_PRODUCT_MD`: for `init`, `teach`, `craft`, `shape`, or wording that clearly maps to a from-scratch build flow, divert into `reference/init.md` first, **unless no user can respond** (a one-shot or automated run, or the user said not to ask): then write your own one-paragraph understanding of the product, audience, and the page's job from the brief and continue. For scoped evaluate/refine/fix requests against existing code, never divert into init; the existing code is the context.
2. If the user invoked a sub-command (`audit`, `polish`, `live`, ...), read **`reference/<command>.md`** (the `.native` variant from the Commands table when the platform is `ios`/`android`/`adaptive`) and follow it. On unattended runs, `craft` and `shape` collapse into this file's process: decide, record each decision in one line, build, self-review.
3. Read at least one project file (CSS / tokens / theme / a representative component) to learn what world you're in. If PRODUCT.md's `## Platform` is `ios` or `android`, also read `reference/<platform>.md` (`adaptive` reads both).
## How to design

**The brief wins.** Where the brief pins down a direction (a named aesthetic, an era, a place, a material, a specific font or palette), follow it exactly, including when it asks for a look this skill warns is saturated. Redirecting a pinned direction toward your own taste is a failure, not a save.

**Existing worlds are sacred.** Most of impeccable's work happens inside a site or app that already exists. When the surface has a committed design system (real tokens, deliberately chosen faces, a palette the brand owns), work inside that world: extend it, sharpen it, leave it unmistakably the same brand, and never degrade a working page's performance. Inventing parallel colors, fonts, or styles on an existing surface is a defect, not creativity.

**New identity work reads the playbook first.** When nothing committed exists (greenfield, or a codebase with no real tokens or chosen faces), or the user asks for a redesign that discards the current look, you MUST read [reference/new-work.md](reference/new-work.md) before making any design decision. Not optional, not skippable under time pressure: producing new identity without it yields the generic default this skill exists to prevent. A redesign is new work; derive the concept from the subject and the brief, not from the incumbent page's structure or styling. `context.mjs` prints this directive when it detects the situation. Scoped fixes inside an existing world don't need the playbook; the craft floor below governs them.

## Craft floor

Build to this floor without announcing it. The design detector (the project hook, `node .claude/skills/impeccable/scripts/detect.mjs --json <file>`, or `audit`) verifies most of it mechanically; any finding it raises is a defect to fix, not a suggestion.

- Contrast: body text ≥4.5:1 against its background (placeholders too); large text ≥3:1. Gray text on a colored background looks washed out: use a darker shade of the background's own hue, or a transparency of the text color.
- Shadows describe real light: an offset and a soft blur. A zero-offset colored halo is decoration announcing itself.
- Spacing has rhythm: generous separations, tight groupings; cramped padding reads as broken. Watch CSS specificity: classes that cancel each other's padding (a `.section` fighting a `.cta`) silently collapse section spacing. Verify computed spacing, not intended spacing.
- Type: body line length 65-75ch; display clamp() max ≤6rem; letter-spacing ≥-0.04em; `text-wrap: balance` on headings; modular scale ≥1.25 between steps; light-on-dark adds 0.05-0.1 line-height. Pair faces on a contrast axis, never two similar-but-not-identical ones; one family with committed weight contrast beats a timid pair. Test headings at every breakpoint; overflow means reduce the clamp or rewrite the copy.
- Structural devices (numbering, eyebrows, dividers) must encode something true about the content; the same device repeated above every section regardless of content is scaffolding.
- Motion is part of the build: one orchestrated moment beats scattered effects; ease-out exponential curves; `prefers-reduced-motion` alternatives always; reveals enhance an already-visible default (content gated on a class-triggered transition ships blank in hidden tabs and headless renderers). Responsive down to mobile and visible keyboard focus are part of the floor.
- Copy is design material: write from the user's side of the screen, active voice, a control says exactly what happens, errors explain what went wrong and how to fix it. Specific beats clever.

## Registers

Name the visitor's mode before designing; the page's grammar follows from it, and most ruined pages are one mode wearing another mode's grammar. The brief and the surface decide the mode; PRODUCT.md's `register` field survives only as a family hint (`brand` covers Persuade and Experience, `product` covers Operate and Read). Depth beyond the paragraphs below: [reference/new-work.md](reference/new-work.md) when inventing identity, [reference/operate.md](reference/operate.md) for substantial Operate and Read work.

**Persuade** (landing pages, marketing, campaigns; design IS the product). The deliverable is an impression that stops the scroll, earns the click, converts. Spans every genre (tech, luxury, consumer); don't collapse them into one look. Briefs that imply imagery must ship real, verified imagery; a colored rectangle where a photo belongs reads as incomplete. New Persuade surfaces take their typeface procedure and reject list from [reference/new-work.md](reference/new-work.md).

**Operate** (app UI, dashboards, admin, tools; design SERVES the task). A person getting something done: density, scanability, and consistency outrank expressiveness. These surfaces earn trust by feeling native to their platform: system font stacks and workhorse UI faces are legitimate and often correct here (the Persuade reject list does not apply). The brand lives in the details: focus states, empty states, microcopy, one owned accent.

**Read** (documentation, guides, editorial, long-form). The deliverable is comprehension: typographic rigor, a navigable structure the reader can hold in their head, hierarchy built for scanning, chrome that stays out of the way. Density follows the reader's task, not atmosphere, and nothing stands between the reader and the answer. The brand lives in type, spacing, and small accents.

**Experience** (an album, a portfolio, a publication, a body of work). The page IS the work: the artifact leads, the interface recedes, and the visitor meets the work itself in the first viewport at every screen size. Boldness here means trusting the work.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | Shape, then build a feature end-to-end | [reference/craft.md](reference/craft.md) |
| `shape [feature]` | Build | Plan UX/UI before writing code | [reference/shape.md](reference/shape.md) |
| `init` | Build | Set up project context: PRODUCT.md, DESIGN.md, live config, next steps | [reference/init.md](reference/init.md) |
| `document` | Build | Generate DESIGN.md from existing project code | [reference/document.md](reference/document.md) |
| `extract [target]` | Build | Pull reusable tokens and components into design system | [reference/extract.md](reference/extract.md) |
| `critique [target]` | Evaluate | UX design review with heuristic scoring | [reference/critique.md](reference/critique.md) |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) | [reference/audit.md](reference/audit.md) · native: [reference/audit.native.md](reference/audit.native.md) |
| `polish [target]` | Refine | Final quality pass before shipping | [reference/polish.md](reference/polish.md) |
| `bolder [target]` | Refine | Amplify safe or bland designs | [reference/bolder.md](reference/bolder.md) |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs | [reference/quieter.md](reference/quieter.md) |
| `distill [target]` | Refine | Strip to essence, remove complexity | [reference/distill.md](reference/distill.md) |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases | [reference/harden.md](reference/harden.md) |
| `onboard [target]` | Refine | Design first-run flows, empty states, activation | [reference/onboard.md](reference/onboard.md) |
| `animate [target]` | Enhance | Add purposeful animations and motion | [reference/animate.md](reference/animate.md) |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs | [reference/colorize.md](reference/colorize.md) |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts | [reference/typeset.md](reference/typeset.md) |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy | [reference/layout.md](reference/layout.md) |
| `delight [target]` | Enhance | Add personality and memorable touches | [reference/delight.md](reference/delight.md) |
| `overdrive [target]` | Enhance | Push past conventional limits | [reference/overdrive.md](reference/overdrive.md) |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages | [reference/clarify.md](reference/clarify.md) |
| `adapt [target]` | Fix | Adapt for different devices and screen sizes | [reference/adapt.md](reference/adapt.md) · native: [reference/adapt.native.md](reference/adapt.native.md) |
| `optimize [target]` | Fix | Diagnose and fix UI performance | [reference/optimize.md](reference/optimize.md) |
| `live` | Iterate | Visual variant mode: pick elements in the browser, generate alternatives | [reference/live.md](reference/live.md) |

Routing: **no argument** → read [reference/routing.md](reference/routing.md) and present the context-aware menu (never auto-run a command). **First word matches a command** (or `pin` / `unpin` / `hooks`) → load its reference (native variant on native platforms) and follow it; everything after the command name is the target. **Intent clearly maps to one command** ("fix the spacing" → `layout`, "rewrite this error" → `clarify`) → same; if two fit, ask once. **Otherwise** → general design invocation: apply Setup and this file's guidance. `teach` is a deprecated alias for `init`. If setup diverted into `init` for a `craft`/`shape` request, finish init, refresh context, then resume the original command.

**Pin / Unpin:** `node .claude/skills/impeccable/scripts/pin.mjs <pin|unpin> <command>` creates or removes a standalone `/<command>` shortcut. Report the script's result concisely; relay stderr verbatim on error.

**Hooks:** `/impeccable hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>` manages the design detector hook for this project (auto-runs the detector after UI file edits and surfaces findings). Load [reference/hooks.md](reference/hooks.md) when the user invokes it with any argument.