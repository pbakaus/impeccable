/**
 * Realistic-looking PRODUCT.md / DESIGN.md fixtures.
 *
 * Long enough to clear the "<200 chars / placeholder" heuristic the loader
 * uses to decide whether to gate on `teach`. Plausible enough that the agent
 * treats them as real context rather than test scaffolding.
 */
export const PRODUCT_MD_SAMPLE = `# Acme Notes

## Register
brand

## Product Purpose
Acme Notes is a marketing-driven landing page for a research-grade note-taking
tool aimed at independent scientists and graduate students. The site needs to
communicate that the product respects the reader's intelligence — no SaaS
buzzwords, no metric-theater, no "trusted by leading teams" wallpaper.

## Users
Working researchers (PhD students, postdocs, principal investigators) who
already maintain disciplined note-taking systems and are choosing between
ours and rolling their own in a Zettelkasten plugin.

## Brand
Editorial, considered, technical. The product is for people who quote
Knuth. The voice is closer to a long-read magazine than to a startup
landing page.

## Anti-references
- Notion (too consumer / too rounded)
- Obsidian (too community-cottagecore)
- Any SaaS landing page with a hero-metric grid

## Strategic Principles
- Type does most of the work. The hero is words, not chrome.
- One named accent color, used sparingly.
- Never lead with screenshots. Lead with the idea.
`;

/**
 * Same project shape as PRODUCT_MD_SAMPLE but with no `## Register` field.
 * Exercises the cascade fallback (task cue then surface in focus) in
 * scenarios where context.mjs cannot detect the register and the agent
 * must follow the SKILL.md priority list to pick brand.md.
 */
export const PRODUCT_MD_SAMPLE_NO_REGISTER = `# Acme Notes

## Product Purpose
Acme Notes is a marketing-driven landing page for a research-grade note-taking
tool aimed at independent scientists and graduate students. The site needs to
communicate that the product respects the reader's intelligence: no SaaS
buzzwords, no metric-theater, no "trusted by leading teams" wallpaper.

## Users
Working researchers (PhD students, postdocs, principal investigators) who
already maintain disciplined note-taking systems and are choosing between
ours and rolling their own in a Zettelkasten plugin.

## Brand
Editorial, considered, technical. The product is for people who quote
Knuth. The voice is closer to a long-read magazine than to a startup
landing page.

## Anti-references
- Notion (too consumer / too rounded)
- Obsidian (too community-cottagecore)
- Any SaaS landing page with a hero-metric grid

## Strategic Principles
- Type does most of the work. The hero is words, not chrome.
- One named accent color, used sparingly.
- Never lead with screenshots. Lead with the idea.
`;

export const DESIGN_MD_SAMPLE = `# Acme Notes — Design System

## Colors
- \`--ink\`: oklch(0.16 0.02 250) — body copy
- \`--paper\`: oklch(0.98 0.01 90) — body background
- \`--accent\`: oklch(0.55 0.18 28) — terracotta, used at <8% surface

## Typography
- Display: GT Sectra (commercial), 700, tracking -0.02em
- Body: Inter, 400, 1.55 line-height, 65ch max
- Mono: JetBrains Mono, 400 (rare, only for callouts)

## Spacing
Multi-modular scale: 4 / 8 / 12 / 24 / 48 / 96 px.

## Elevation
Mostly flat. A single 1px hairline border at oklch(0.16 0.02 250 / 0.08)
separates major regions. No drop shadows under 16px blur.

## Components
- Buttons: text-only by default; a single solid primary in accent for CTAs.
- Cards: avoid; prefer hairlined regions and inline lists.
- Forms: floating labels, no border on the input — underline only.
`;
