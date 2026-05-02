---
tagline: "Generate a spec-compliant DESIGN.md that captures your visual system so every AI agent stays on-brand."
---

<div class="docs-viz-hero">
  <div class="docs-viz-file">
    <div class="docs-viz-file-header">
      <span class="docs-viz-file-name">DESIGN.md</span>
      <span class="docs-viz-file-status">Google Stitch format</span>
    </div>
    <div class="docs-viz-designmd-section">
      <div class="docs-viz-designmd-head">
        <span class="docs-viz-designmd-num">01</span>
        <span class="docs-viz-designmd-title">Overview</span>
      </div>
      <p class="docs-viz-designmd-note">Creative North Star: <em>"The Editorial Sanctuary."</em> Quiet type, generous air, one committed accent.</p>
    </div>
    <div class="docs-viz-designmd-section">
      <div class="docs-viz-designmd-head">
        <span class="docs-viz-designmd-num">02</span>
        <span class="docs-viz-designmd-title">Colors</span>
      </div>
      <div class="docs-viz-designmd-swatches" aria-hidden="true">
        <span class="docs-viz-designmd-swatch" style="background:#1a1a1a"></span>
        <span class="docs-viz-designmd-swatch" style="background:#f5f3ef"></span>
        <span class="docs-viz-designmd-swatch" style="background:oklch(60% 0.22 30)"></span>
        <span class="docs-viz-designmd-swatch" style="background:oklch(90% 0.02 30)"></span>
      </div>
    </div>
    <div class="docs-viz-designmd-section">
      <div class="docs-viz-designmd-head">
        <span class="docs-viz-designmd-num">03</span>
        <span class="docs-viz-designmd-title">Typography</span>
      </div>
      <div class="docs-viz-designmd-type">
        <span class="docs-viz-designmd-type-display">Aa</span>
        <span class="docs-viz-designmd-type-body">Cormorant Garamond &middot; Instrument Sans</span>
      </div>
    </div>
    <div class="docs-viz-designmd-section">
      <div class="docs-viz-designmd-head">
        <span class="docs-viz-designmd-num">04</span>
        <span class="docs-viz-designmd-title">Elevation</span>
      </div>
      <p class="docs-viz-designmd-note">Flat by default. Shadows appear only as a response to state.</p>
    </div>
    <div class="docs-viz-designmd-section">
      <div class="docs-viz-designmd-head">
        <span class="docs-viz-designmd-num">05</span>
        <span class="docs-viz-designmd-title">Components</span>
      </div>
      <div class="docs-viz-designmd-comps" aria-hidden="true">
        <span class="docs-viz-designmd-btn">Subscribe</span>
        <span class="docs-viz-designmd-chip">filter</span>
        <span class="docs-viz-designmd-card">card</span>
      </div>
    </div>
    <div class="docs-viz-designmd-section">
      <div class="docs-viz-designmd-head">
        <span class="docs-viz-designmd-num">06</span>
        <span class="docs-viz-designmd-title">Do's and Don'ts</span>
      </div>
      <div class="docs-viz-designmd-rules">
        <span class="docs-viz-designmd-do">Tint neutrals toward the accent hue.</span>
        <span class="docs-viz-designmd-dont">Gradient text for emphasis.</span>
      </div>
    </div>
  </div>
  <p class="docs-viz-caption">The six sections are fixed, in a fixed order, with fixed names. Alongside, <code>DESIGN.json</code> ships as a machine-readable sidecar for the Live Mode design panel.</p>
</div>

## When to use it

Run `/impeccable document` once you have enough of a visual system to document: colors, typography, at least a button and a card. The command scans your codebase, extracts the tokens and component patterns it finds, and writes a `DESIGN.md` at the project root that follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/), six sections in a fixed order, interoperable with every other DESIGN.md-aware tool.

Reach for it when:

- **You just ran `/impeccable teach`** and `PRODUCT.md` now exists. Document is the matching visual-side file.
- **A command nudged you toward it.** Live, craft, and polish all read DESIGN.md. If it is missing, the skill suggests running document first.
- **The design has drifted** from an older DESIGN.md and the file no longer describes the live system.
- **Before a large redesign**, to capture current state as a reference for the next direction.

For projects with no code yet (fresh `teach` run, nothing built), there is a seed mode: `/impeccable document --seed` asks five quick strategic questions (color strategy, type direction, motion energy, references, anti-references) and writes a scaffold. Re-run in scan mode once there is code.

## How it works

The scan pass finds design assets in priority order: CSS custom properties, Tailwind config, CSS-in-JS themes, design token files, component source, the global stylesheet, and finally computed styles from the live rendered output if a browser is available. It auto-extracts everything it can, then asks one grouped question for the parts that need creative input: the **Creative North Star** (a single named metaphor for the whole system, like "The Editorial Sanctuary"), descriptive color names, the elevation philosophy, and the component character.

Output is a DESIGN.md with exactly six sections: Overview, Colors, Typography, Elevation, Components, Do's and Don'ts. Headers are fixed character-for-character so the file is parseable by other tools. Alongside it, `DESIGN.json` is written as a machine-readable sidecar. That sidecar is what the live-mode design panel uses to render *this project's* actual button, input, nav, and card tiles instead of a generic approximation.

Every other command reads DESIGN.md on invocation. Variants, polishes, audits, and new features inherit the visual system without being told.

## Try it

```
/impeccable document
```

On a project with tokens already defined, this takes about two minutes: the scan finds your palette and type stack, you pick a North Star from 2 or 3 options, confirm descriptive color names ("Deep Muted Teal-Navy", not "blue-800"), and the file lands at the project root.

On a fresh project:

```
/impeccable document --seed
```

Five questions, about five minutes. The file is a scaffold, marked with a `<!-- SEED -->` comment so it is honest about what it is. Re-run without the flag once you have implemented tokens.

## Pitfalls

- **Running it too early.** On a project with no implemented tokens, seed mode is right. Do not fabricate a full spec the code cannot back up. A fake DESIGN.md is worse than no DESIGN.md.
- **Treating DESIGN.md as documentation for humans only.** It is primarily for the AI. Every other command reads it. The format's forcefulness ("never", "always", Named Rules) is intentional.
- **Adding a Layout / Motion / Responsive top-level section.** The spec has six sections, in a fixed order, with fixed names. Fold layout or motion content into Overview (philosophy-level rules) or Components (per-component behavior).
- **Overwriting an existing DESIGN.md silently.** Document always confirms first. If you want to start fresh, rename the existing file out of the way or explicitly tell the skill to overwrite.
