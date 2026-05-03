---
tagline: "The design intelligence behind every command."
---

## When to use it

`/impeccable` is the home command. Call it directly when you want freeform design work with the full guidebook loaded, without picking a specialized command. It is the fallback you reach for when none of the 23 specialists (`audit`, `polish`, `critique`, and the rest) map cleanly onto what you are trying to do.

Reach for `/impeccable` directly when:

- **You are not sure which command fits.** Describe what you want in plain English and let the skill pick the right approach.
- **The work spans multiple disciplines.** "Redo this hero section" touches layout, type, color, and motion. One command cannot own that.
- **You want the full design intelligence without constraints.** Every reference file loaded, every anti-pattern checked, no pre-set workflow.

For structured flows, reach for the specialized commands in the sidebar. Run `/impeccable teach` first on any new project to establish PRODUCT.md and DESIGN.md. `/impeccable craft` chains a discovery interview into a full build with live visual iteration. `/impeccable shape` produces a design brief without touching code. `/impeccable live` gives you a browser picker with three variants per element. The evaluation and refinement commands (`audit`, `critique`, `polish`, `typeset`, `layout`, `colorize`, and the rest) each own a specific slice of the work.

## How it works

Most AI-generated UIs fail the same way: generic fonts, purple gradients, card grids on card grids, glassmorphism everywhere. `/impeccable` gives your AI a strong point of view. It loads an opinionated design handbook plus a long list of anti-patterns, then pushes the model to commit to a specific aesthetic direction before writing a single line of code.

Two files at your project root shape everything the skill does:

- **`PRODUCT.md`** carries register (brand vs product), target users, brand personality, anti-references, design principles. Answers "who, what, why".
- **`DESIGN.md`** carries colors, typography, elevation, components, do's and don'ts, in the six-section Google Stitch format. Answers "how it looks".

Every command reads both files before generating. **Register** decides which defaults load. Brand (marketing, landing, portfolio, where design IS the product) and product (app UI, dashboards, tools, where design SERVES the product) have different defaults for type, motion, color, and density. Specifying it once in PRODUCT.md means `/impeccable typeset` will not push editorial-magazine fonts on a dashboard, and will not push product-fluent defaults on a campaign page. See the [brand vs product tutorial](/tutorials/brand-vs-product) for how the two diverge.

On first use in a project, the skill runs the `teach` flow automatically: a short interview that writes PRODUCT.md and then delegates to `/impeccable document` for DESIGN.md. Future commands read the files without asking again.

## Try it

```
/impeccable redo this hero section
```

```
/impeccable build me a pricing page for a developer tool
```

Both prompts are vague on purpose. `/impeccable` will pick a strong aesthetic direction consistent with your register, commit to non-default fonts, avoid the AI color palette, and make the kind of specific choices that a designer would make. No command name to pick first, no step-by-step workflow to follow.

For visual iteration in the browser rather than chat:

```
/impeccable live
```

Pick any element on your running dev server. Drop a comment or stroke. Get three production-quality variants hot-swapped in via HMR. Accept the one you want and it writes back to source.

## Pin commands back as shortcuts

v3.0 consolidated 18 standalone skills into a single `/impeccable` with 23 sub-commands. If you miss the short form of a specific command, pin it back:

```
/impeccable pin critique
```

From now on, `/critique` invokes `/impeccable critique` directly. It writes a lightweight redirect skill that delegates to the parent, so updates to the skill flow through without re-pinning.

Useful pins to try:

- `/impeccable pin polish` for final-pass work
- `/impeccable pin audit` for deterministic a11y/perf checks
- `/impeccable pin live` for the browser iteration flow
- `/impeccable pin critique` for design review

To remove: `/impeccable unpin critique`. Pins live as directories prefixed with `i-` in your harness skills folder (`.claude/skills/i-critique/`, `.cursor/skills/i-critique/`, etc.), so you can also delete them manually.

## Pitfalls

- **Treating it like a style guide.** It is an opinionated design partner, not a linter. The defaults exist to raise the floor, not to overrule your judgment. If you have a real reason to push back (brand guideline, accessibility constraint, user research), push back and explain why. The skill will work with you. What produces worse output is ignoring the opinion without a reason.
- **Expecting it to fix existing code.** `/impeccable` is for creation. For refinement, reach for `/impeccable polish`, `/impeccable distill`, or `/impeccable critique` instead.
- **Running it before `teach` has had a chance to save context.** On a fresh project it will interview you mid-flight, which is fine but slower. Running `/impeccable teach` explicitly as your very first command is a tiny bit smoother.
- **Skipping the register question.** Brand and product defaults diverge enough that running on the wrong register produces subtly off output. If `PRODUCT.md` has no `## Register` field (legacy), run `/impeccable teach` to add it.
