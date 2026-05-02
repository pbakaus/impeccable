---
tagline: "Teach Impeccable who your product is for, once per project."
---

<div class="docs-viz-hero">
  <div class="docs-viz-file">
    <div class="docs-viz-file-header">
      <span class="docs-viz-file-name">PRODUCT.md</span>
      <span class="docs-viz-file-status">Loaded on every command</span>
    </div>
    <div class="docs-viz-file-body">
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Register</span>
        <span class="docs-viz-file-v">Product. Design serves the task.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Users</span>
        <span class="docs-viz-file-v">SREs on call, reading fast, often in the dark.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Brand voice</span>
        <span class="docs-viz-file-v">Calm, clinical, no hype.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Anti-references</span>
        <span class="docs-viz-file-v">Purple gradients. Glassmorphism. "Boost your productivity."</span>
      </div>
    </div>
    <div class="docs-viz-file-footer">Every command reads this before writing a line of code.</div>
  </div>
  <p class="docs-viz-caption">A finished PRODUCT.md. Strategy only: who, what, why. No colors, no fonts, no pixel values, those live in DESIGN.md.</p>
</div>

## When to use it

Run `/impeccable teach` once at the start of a project. It is the onramp. Without it, every other command will produce design that is technically competent but generically toned: stock SaaS voice, safe-default fonts, the AI color palette. With it, every command reads your answers before it generates.

Reach for it when:

- **You just installed Impeccable in a new project.** First thing to run. Other commands will nudge you toward it if you skip.
- **The project's brand direction has shifted.** New positioning, new audience, new voice. Re-run `teach` and the updated context flows through every command.
- **Another command said "no design context found"** and stopped. That is the signal: run teach, then resume.

## How it works

Teach writes two complementary files at the project root:

- **`PRODUCT.md`** is the strategic file. Register (brand or product), target users, product purpose, brand personality, anti-references, design principles, accessibility needs. Answers "who, what, why".
- **`DESIGN.md`** is the visual file. Colors, typography, elevation, components, do's and don'ts. Answers "how it looks". Written by the delegated `/impeccable document` command, which teach invokes at the end.

The flow scans the codebase first (README, package.json, components, tokens, brand assets) and forms a **register hypothesis**: brand (landing, marketing, portfolio, where design IS the product) or product (app UI, dashboards, tools, where design SERVES the product). Register is the first question, because it shapes every downstream answer: typography defaults, motion energy, color strategy, the reference set commands like `/impeccable typeset` pull from. After register, teach asks only what it could not infer: users, personality in three real words, references and anti-references, accessibility requirements.

PRODUCT.md is strategic only. No colors, no fonts, no pixel values. Those live in DESIGN.md. Keeping the two files separate is deliberate: strategy can stay stable while the visual system evolves.

## Try it

```
/impeccable teach
```

Expect a 5 to 8 minute interview. The first question is usually about register; the rest are short. Teach will quote back what it inferred from your code ("from the routes, this looks like a product surface, match?") so you are confirming, not starting from scratch.

At the end, teach offers to run `/impeccable document` for you. Say yes unless you have a specific reason to hold off. A real DESIGN.md is what keeps variants, polishes, and audits on-brand.

## Pitfalls

- **Skipping it to "just try a command quickly".** Every other command will interview you mid-flight instead. Running teach first is faster, not slower.
- **Giving generic answers.** "Modern and clean" is not useful. "Warm, mechanical, opinionated" is. Be specific. Be willing to disagree with safe defaults.
- **Treating PRODUCT.md as immutable.** The file is yours. If teach put something in there that is not quite right, edit it. Every command reads the current file.
- **Listing only adjectives for references.** Brands, products, printed objects: named, not described. "Klim Type Foundry specimen pages", not "technical and clean". Anti-references should be equally specific.
