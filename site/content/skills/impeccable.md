---
tagline: "Get a next-step recommendation, or describe design work in plain English."
---

## When to use it

`/impeccable` is the main command. Use it in two ways:

- Run `/impeccable` by itself when you want the skill to inspect the project and recommend what to do next.
- Add a plain-English request when you know the outcome but not the exact command.

Reach for `/impeccable` directly when:

- **You are not sure where to start.** It checks whether setup files exist, looks at the current project state, and recommends two or three next commands. It asks before running anything.
- **You are not sure which command fits.** Describe what you want in plain English and let the skill pick the right approach.
- **The work spans multiple disciplines.** "Redo this hero section" touches layout, type, color, and motion. One command cannot own that.
- **You want freeform design help.** Use the main command when no specialist command maps cleanly to the work.

If this is a new project, start with `/impeccable init`. That creates the setup files every other command reads.

## How it works

Most AI-generated UIs fail the same way: generic fonts, purple gradients, card grids on card grids, glassmorphism everywhere. `/impeccable` gives the model stronger design instructions before it writes code.

Two files at your project root shape everything the skill does:

- **`PRODUCT.md`** says what the project is for: audience, product purpose, voice, anti-references, and whether the surface is brand or product.
- **`DESIGN.md`** says how the interface should look: colors, typography, components, elevation, and design rules.

Every command reads both files before generating. The most important setup choice is **brand vs product**: is this a marketing surface where the impression is the product, or an app surface where design helps someone finish a task? The docs call this choice **register**. See [Brand vs product](/tutorials/brand-vs-product) for examples.

On first use in a project, `/impeccable` may route you into `init`: a short interview that writes `PRODUCT.md` and offers to write `DESIGN.md`. Future commands read those files without asking again.

## Try it

Run it with no command to get your bearings:

```
/impeccable
```

It sizes up the project and points you at the best next move. For example: no `DESIGN.md` yet, run `document`; unresolved findings in files you are editing, run `polish`. It waits for you to choose.

Or describe what you want and it does the work directly:

```
/impeccable redo this hero section
```

```
/impeccable build me a pricing page for a developer tool
```

Both prompts are vague on purpose. `/impeccable` will choose the right command or run the work directly, using your setup files when they exist.

For visual iteration in the browser rather than chat:

```
/impeccable live
```

Pick any element on your running dev server. Drop a comment or stroke. Get three production-quality variants hot-swapped in via HMR. Accept the one you want and it writes back to source.

## Pin commands back as shortcuts

v3.0 consolidated 18 standalone skills into a single `/impeccable` with 23 commands. If you miss the short form of a command, pin it back:

```
/impeccable pin critique
```

From now on, `/critique` invokes `/impeccable critique` directly. It writes a lightweight redirect skill that delegates to the parent, so updates to the skill flow through without re-pinning.

Useful pins to try:

- `/impeccable pin polish` for final-pass work
- `/impeccable pin audit` for deterministic a11y/perf checks
- `/impeccable pin live` for the browser iteration flow
- `/impeccable pin critique` for design review

To remove: `/impeccable unpin critique`. Pins live as directories named after the command in your harness skills folder (`.claude/skills/critique/`, `.cursor/skills/critique/`, etc.), so you can also delete them manually.

## Pitfalls

- **Treating it like a style guide.** It is an opinionated design partner, not a linter. The defaults exist to raise the floor, not to overrule your judgment. If you have a real reason to push back (brand guideline, accessibility constraint, user research), push back and explain why. The skill will work with you. What produces worse output is ignoring the opinion without a reason.
- **Expecting it to fix existing code.** `/impeccable` is for creation. For refinement, reach for `/impeccable polish`, `/impeccable distill`, or `/impeccable critique` instead.
- **Running it before `init` has saved context.** On a fresh project it will interview you mid-flight, which is fine but slower. Running `/impeccable init` first is smoother.
- **Picking the wrong brand/product lane.** Marketing pages and app screens need different defaults. If `PRODUCT.md` has no `## Register` field (legacy), run `/impeccable init` to add it.
