---
name: impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.
version: 4.0.0-alpha.9
license: Apache 2.0
allowed-tools:
  - Bash(npx impeccable *)
  - Bash(node .pi/skills/impeccable/scripts/*)
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

Approach every design task as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. The client has already rejected work that felt templated; they are paying for a point of view. the model is capable of extraordinary work. Don't hold back.

## Setup

1. Run `node .pi/skills/impeccable/scripts/context.mjs` once per session (if the runtime shows this skill's loaded base directory, run `node <skill-base-dir>/scripts/context.mjs`; keep cwd at the user's project). It prints the project's context and its directives; follow what it prints. Once its output is in the conversation, never rerun it on a later turn.
2. `craft` and `shape` are build-path exceptions: the new-work gate below owns their flow, and on unattended runs its checkpoints resolve without pausing. For any other invoked sub-command (`audit`, `polish`, `live`, ...), immediately read **`reference/<command>.md`** after `context.mjs` (the `.native` variant from the Commands table when the platform is `ios`/`android`/`adaptive`) and follow it. This read is a hard gate: do not inspect the target, run command-specific scripts, or edit files until the reference is loaded.
3. Read at least one project file (CSS / tokens / theme / a representative component) to learn what world you're in. If PRODUCT.md's `## Platform` is `ios` or `android`, also read `reference/<platform>.md` (`adaptive` reads both).

## How to design

**The brief wins.** Where the brief pins down a direction (a named aesthetic, an era, a place, a material, a specific font or palette), follow it exactly, including when it asks for a look this skill warns is saturated. Redirecting a pinned direction toward your own taste is a failure, not a save.

**Existing worlds are sacred.** Most of impeccable's work happens inside a site or app that already exists. When the surface has a committed design system (real tokens, deliberately chosen faces, a palette the brand owns), work inside that world: extend it, sharpen it, leave it unmistakably the same brand, and never degrade a working page's performance. Inventing parallel colors, fonts, or styles on an existing surface is a defect, not creativity. A scoped refinement keeps the named scope's content and media footprint unless the brief explicitly changes them; build the added emphasis by recomposing what is already there through hierarchy, proportion, rhythm, and the system's own motifs.

**New identity work reads the playbook first.** When nothing committed exists (greenfield, or a codebase with no real tokens or chosen faces), or the user explicitly asks for a redesign that discards the current look, you MUST read [reference/new-work.md](reference/new-work.md) before making any design decision. Missing DESIGN.md alone does not make work greenfield: code, tokens, chosen type, components, and assets are incumbent design authority. Preserve and extend them unless the user asked to replace them. Producing a genuinely new identity without the playbook yields the generic default this skill exists to prevent. Scoped fixes inside an existing world don't need it; the craft floor below governs them. `context.mjs` prints the appropriate authority directive.

## Modes

Name the visitor's mode before designing; the page's grammar follows from it, and most ruined pages are one mode wearing another mode's grammar. **The mode belongs to the surface, not the subject**: a landing page for a dense technical tool is still Persuade, with Persuade's full permission to be striking; a docs page for a fashion house is still Read. Deciding a page can be plain because its subject is workmanlike is the same category error in reverse. The brief and the surface decide the mode; PRODUCT.md's `register` field survives only as a family hint (`brand` covers Persuade and Experience, `product` covers Operate and Read). Depth beyond the paragraphs below: [reference/new-work.md](reference/new-work.md) when inventing identity, [reference/operate.md](reference/operate.md) for substantial Operate and Read work.

**Persuade** (the surface exists to win someone over; design IS the product). The deliverable is an impression that stops the scroll, earns the click, converts. Spans every genre; don't collapse them into one look. On new surfaces, briefs that imply imagery must ship real, verified imagery; a colored rectangle where a photo belongs reads as incomplete. New Persuade surfaces take their typeface procedure and reject list from [reference/new-work.md](reference/new-work.md).

**Operate** (the surface is a tool someone works in; design SERVES the task). A person getting something done: scanability and consistency outrank expressiveness. These surfaces earn trust by feeling native to their platform: system font stacks and workhorse UI faces are legitimate and often correct here (the Persuade reject list does not apply). The brand lives in the details: focus states, empty states, microcopy, one owned accent. The usage scene is part of the spec: an interface read outdoors, in motion, or at a glance must survive its real ambient light, and the theme follows the scene, not the category's habit.

**Read** (the surface exists to be understood; long-form, reference, guidance). The deliverable is comprehension, and comprehension is earned twice: a structure the reader can hold in their head with nothing standing between them and the answer, and a reading experience good enough to stay in, through typographic quality and whatever visual or interactive support genuinely helps the reader follow. The brand lives in type, spacing, and small accents.

**Experience** (the surface presents a body of work; the page IS the work). The artifact leads, the interface recedes, and the visitor meets the work itself in the first viewport at every screen size. Boldness here means trusting the work.

## Craft floor

Build to this floor without announcing it. The design detector (the project hook, `node .pi/skills/impeccable/scripts/detect.mjs --json <file>`, or `audit`) verifies most of it mechanically; resolve every finding before finalizing. Fix real defects, but use context judgment rather than distorting intentional design to appease a false positive. Classify any intentional exception explicitly and use the hook system's narrowest appropriate waiver when it must persist.

- Contrast: body text ≥4.5:1 against its background (placeholders too); large text ≥3:1. Gray text on a colored background looks washed out: use a darker shade of the background's own hue, or a transparency of the text color.
- Shadows describe real light: an offset and a soft blur. A zero-offset colored halo is decoration announcing itself.
- Spacing has rhythm: generous separations, tight groupings; cramped padding reads as broken; the space above a heading exceeds the space below it. Verify computed spacing, not intended spacing.
- Type: body line length 65-75ch; display clamp() max ≤6rem; letter-spacing ≥-0.04em; `text-wrap: balance` on headings; modular scale ≥1.25 between steps; light-on-dark adds 0.05-0.1 line-height. Pair faces on a contrast axis, never two similar-but-not-identical ones; one family with committed weight contrast beats a timid pair. Test headings at every breakpoint; overflow means reduce the clamp or rewrite the copy.
- Motion is part of the build: one orchestrated moment beats scattered effects; ease-out exponential curves; reveals enhance an already-visible default (content gated on a class-triggered transition ships blank in hidden tabs and headless renderers). Responsive down to mobile and visible keyboard focus are part of the floor.
- Ship real content (no placeholders, dead links, or fake controls) and cover the interaction states people will actually hit (hover, focus, disabled, loading, error, empty).
- Copy is design material: name things the way the page's own people speak, make every control say what it does, and make every error say what happened and what to do next.
- Before finishing, re-read the brief: every requirement it names must exist on the page, findable in seconds. A beautiful page missing an asked-for feature is unfinished.

## Commands

| Command | Category | Description | Reference |
|---|---|---|---|
| `craft [feature]` | Build | The standard build flow with attended checkpoints | [reference/new-work.md](reference/new-work.md) |
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

Routing: **no argument** → read [reference/routing.md](reference/routing.md) and present the context-aware menu (never auto-run a command). **First word matches a command** (or `pin` / `unpin` / `hooks`) → load its reference (native variant on native platforms) and follow it; everything after the command name is the target. **Intent clearly maps to one command** ("fix the spacing" → `layout`, "rewrite this error" → `clarify`) → same; if two fit, ask once. **Otherwise** → general design invocation: apply Setup and this file's guidance; builds flow through the new-work gate above, whose playbook carries the direction checkpoint and the finishing pass. `teach` routes to `init`, and `craft` routes to the standard build flow with attended checkpoints. If setup diverted into `init` for a build request, finish init, refresh context, then resume.

**Pin / Unpin:** `node .pi/skills/impeccable/scripts/pin.mjs <pin|unpin> <command>` creates or removes a standalone `/<command>` shortcut. Report the script's result concisely; relay stderr verbatim on error.

**Hooks:** `/impeccable hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>` manages the design detector hook for this project (auto-runs the detector after UI file edits and surfaces findings). Load [reference/hooks.md](reference/hooks.md) when the user invokes it with any argument.