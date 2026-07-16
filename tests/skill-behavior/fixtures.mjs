/**
 * Realistic-looking PRODUCT.md / DESIGN.md fixtures.
 *
 * Long enough to clear the "<200 chars / placeholder" heuristic the loader
 * uses to decide whether to gate on `init`. Plausible enough that the agent
 * treats them as real context rather than test scaffolding.
 */
export const PRODUCT_MD_SAMPLE = `# Acme Notes

## Platform
web

## Product Purpose
Acme Notes is a marketing-driven landing page for a research-grade note-taking
tool aimed at independent scientists and graduate students. The site needs to
communicate that the product respects the reader's intelligence — no SaaS
buzzwords, no metric-theater, no "trusted by leading teams" wallpaper.

## Users
Working researchers (PhD students, postdocs, principal investigators) who
already maintain disciplined note-taking systems and are choosing between
ours and rolling their own in a Zettelkasten plugin.

## Positioning
The research notebook that preserves a scientist's chain of thought instead
of flattening it into generic documents and folders.

## Audience World
Lab notebooks, margin annotations, citation trails, preprint PDFs, index cards,
and the quiet ritual of reconstructing why a conclusion was reached months ago.

## Cultural Context
Research monographs and working laboratory archives: precise, annotated,
accumulative, and visibly handled rather than pristine lifestyle publishing.

## Pinned Direction
Type-led and evidence-first. Never lead with product screenshots or generic
startup chrome.

## Brand Personality
Editorial, considered, technical. The product is for people who quote
Knuth. The voice is closer to a long-read magazine than to a startup
landing page.

## Anti-references
- Notion (too consumer / too rounded)
- Obsidian (too community-cottagecore)
- Any SaaS landing page with a hero-metric grid

## Design Principles
- Type does most of the work. The hero is words, not chrome.
- One named accent color, used sparingly.
- Never lead with screenshots. Lead with the idea.

## Accessibility & Inclusion
WCAG AA, fully keyboard accessible, readable at 200% zoom, and calm under
reduced motion.
`;

/**
 * Legacy product context with the modern strategic fields but no visual
 * world. Exercises init completion without a deprecated brand/product field.
 */
export const PRODUCT_MD_SAMPLE_NO_REGISTER = `# Acme Notes

## Platform
web

## Product Purpose
Acme Notes is a marketing-driven landing page for a research-grade note-taking
tool aimed at independent scientists and graduate students. The site needs to
communicate that the product respects the reader's intelligence: no SaaS
buzzwords, no metric-theater, no "trusted by leading teams" wallpaper.

## Users
Working researchers (PhD students, postdocs, principal investigators) who
already maintain disciplined note-taking systems and are choosing between
ours and rolling their own in a Zettelkasten plugin.

## Positioning
The research notebook that preserves a scientist's chain of thought instead
of flattening it into generic documents and folders.

## Audience World
Lab notebooks, margin annotations, citation trails, preprint PDFs, index cards,
and the ritual of reconstructing a conclusion months later.

## Cultural Context
Research monographs and working laboratory archives.

## Pinned Direction
Type-led and evidence-first; no startup chrome.

## Brand Personality
Editorial, considered, technical. The product is for people who quote
Knuth. The voice is closer to a long-read magazine than to a startup
landing page.

## Anti-references
- Notion (too consumer / too rounded)
- Obsidian (too community-cottagecore)
- Any SaaS landing page with a hero-metric grid

## Design Principles
- Type does most of the work. The hero is words, not chrome.
- One named accent color, used sparingly.
- Never lead with screenshots. Lead with the idea.

## Accessibility & Inclusion
WCAG AA, keyboard access, 200% zoom, and reduced motion support.
`;

/**
 * Native iOS app fixture with `## Platform` set to `ios`. Exercises Setup
 * step 5 — the agent must also load `reference/ios.md` (Apple HIG) on top of
 * the task-scoped visitor-mode guidance.
 */
export const PRODUCT_MD_SAMPLE_IOS = `# Tideline

## Platform
ios

## Product Purpose
Tideline is a native iOS app for coastal anglers: tide tables, solunar
windows, and a logbook. It SERVES the task — get in, read the conditions,
log a catch — so fluent iPhone users should trust it instantly rather than
relearn navigation. Earned familiarity over novelty.

## Users
Saltwater anglers checking conditions dockside on an iPhone, often one-handed
in bright sun and sometimes offline. They live in Apple Weather, Notes, and
Maps and expect the same gestures and controls here.

## Positioning
The fastest trustworthy read on whether the next coastal window is worth the trip.

## Audience World
Tide tables, chartplotters, dock logs, weather radar, tackle trays, wet gloves,
and the repeated glance from water to phone in hard daylight.

## Pinned Direction
Native iOS controls and navigation are non-negotiable; the logbook may carry
the product's distinctive character.

## Brand Personality
Calm, legible, marine. Identity shows through color, type accent, and the
logbook's character — never by reinventing the navigation bar or the back
gesture.

## Anti-references
- Web dashboards ported into a WebView
- Custom toggles and bespoke tab bars that fight the platform
- Cluttered, metric-theater home screens

## Design Principles
- Platform conformance is the structural bar; brand lives in the expressive layer.
- Standard navigation, SF Symbols, Dynamic Type, Dark Mode first-class.
- One accent tint drives interactive elements.

## Accessibility & Inclusion
Dynamic Type, VoiceOver, reduced motion, high contrast in direct sun, and
targets usable one-handed with wet hands.
`;

/**
 * Tiny static landing page fixture for scenarios that invoke sub-commands
 * (polish, audit) without standing up a full framework project. Gives the
 * agent something concrete to inspect so it doesn't bail with "what
 * should I work on?" before completing Setup.
 */
export const MINIMAL_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Acme Notes</title>
  <style>
    :root { --ink: #1a1a1a; --paper: #fafafa; --accent: #b7410e; }
    body { background: var(--paper); color: var(--ink); font-family: serif; max-width: 65ch; margin: 4rem auto; padding: 0 1.5rem; }
    h1 { font-size: 3rem; letter-spacing: -0.02em; line-height: 1.05; }
    a.cta { display: inline-block; background: var(--accent); color: var(--paper); padding: 0.5rem 1rem; text-decoration: none; }
  </style>
</head>
<body>
  <h1>For those who build their own index.</h1>
  <p>Acme Notes is not a productivity tool. It is an archive, designed for the researcher who treats their notes as an external brain.</p>
  <a class="cta" href="#start">Begin Archive</a>
</body>
</html>
`;

/**
 * Minimal SvelteKit project. Exercises Setup step 2 ("familiarize
 * yourself with any existing design system, conventions, and components"):
 * the agent should explore at least one of these code files before
 * producing a polish or craft pass.
 */
export const SVELTE_PROJECT_FILES = {
  'package.json': `${JSON.stringify(
    {
      name: 'acme-notes',
      type: 'module',
      dependencies: { svelte: '^4.0.0', '@sveltejs/kit': '^2.0.0' },
      scripts: { dev: 'vite dev', build: 'vite build' },
    },
    null,
    2,
  )}\n`,
  'svelte.config.js': `import adapter from '@sveltejs/adapter-auto';

export default {
  kit: { adapter: adapter() },
};
`,
  'src/app.css': `:root {
  --ink: oklch(0.16 0.02 250);
  --paper: oklch(0.98 0.01 90);
  --accent: oklch(0.55 0.18 28);
  --hairline: oklch(0.16 0.02 250 / 0.08);
}

body {
  background: var(--paper);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  line-height: 1.55;
}
`,
  'src/lib/components/Button.svelte': `<script>
  export let variant = 'primary';
</script>

<button class="btn btn-{variant}">
  <slot />
</button>

<style>
  .btn { font: inherit; border: 0; cursor: pointer; padding: 0.5rem 1rem; }
  .btn-primary { background: var(--accent); color: var(--paper); }
  .btn-ghost { background: transparent; color: var(--ink); border-bottom: 1px solid currentColor; }
</style>
`,
  'src/lib/components/Card.svelte': `<div class="card">
  <slot />
</div>

<style>
  .card {
    border-top: 1px solid var(--hairline);
    padding: 2rem 0;
  }
</style>
`,
  'src/routes/+page.svelte': `<script>
  import Button from '$lib/components/Button.svelte';
  import Card from '$lib/components/Card.svelte';
</script>

<svelte:head>
  <title>Acme Notes</title>
</svelte:head>

<main>
  <h1>For those who build their own index.</h1>
  <p>Acme Notes is not a productivity tool. It is an archive.</p>
  <Button>Begin Archive</Button>
  <Card>Some featured content.</Card>
</main>
`,
};

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
