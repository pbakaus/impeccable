/*
  Presentation metadata for the Hooks page of the design context document.

  The rule ids, names, and descriptions come from the canonical registry
  (cli/engine/registry/antipatterns.mjs); this module adds only how the document
  groups and labels them. `FINGERPRINT_IDS` promotes a handful of slop rules into
  their own "Fingerprints" family (model-specific signatures); `DISCIPLINES` gives
  every rule a discipline label for the collapsible groups. Both must cover the
  registry exactly — tests/hook-rule-presentation.test.js fails the suite when a
  rule is added without a discipline, so the document can never silently miss one.
*/

export const FINGERPRINT_IDS = new Set([
  'gpt-thin-border-wide-shadow',
  'repeating-stripes-gradient',
  'codex-grid-background',
  'theater-slop-phrase',
]);

export const DISCIPLINES = {
  'side-tab': 'Visual Details',
  'border-accent-on-rounded': 'Visual Details',
  'overused-font': 'Typography',
  'flat-type-hierarchy': 'Typography',
  'gradient-text': 'Color & Contrast',
  'ai-color-palette': 'Color & Contrast',
  'cream-palette': 'Color & Contrast',
  'nested-cards': 'Layout & Space',
  'monotonous-spacing': 'Layout & Space',
  'bounce-easing': 'Motion',
  'pulsing-dot': 'Motion',
  'blinking-cursor': 'Motion',
  'shape-assembled-illustration': 'Imagery',
  'organic-clip-path': 'Imagery',
  'buried-raster': 'Imagery',
  'dark-glow': 'Color & Contrast',
  'radial-halo': 'Color & Contrast',
  'radial-spotlight-glow': 'Color & Contrast',
  'marquee': 'Motion',
  'icon-tile-stack': 'Typography',
  'italic-serif-display': 'Typography',
  'hero-eyebrow-chip': 'Typography',
  'kicker-above-heading': 'Typography',
  'numbered-section-labels': 'Layout & Space',
  'em-dash-overuse': 'Copy',
  'marketing-buzzword': 'Copy',
  'aphoristic-cadence': 'Copy',
  'oversized-h1': 'Typography',
  'extreme-negative-tracking': 'Typography',
  'broken-image': 'Imagery',
  'script-error': 'Quality',
  'content-hidden-at-rest': 'Layout & Space',
  'edge-flush-cards': 'Layout & Space',
  'text-occlusion': 'Layout & Space',
  'first-viewport-column-overflow': 'Layout & Space',
  'gray-on-color': 'Color & Contrast',
  'low-contrast': 'Quality',
  'layout-transition': 'Motion',
  'line-length': 'Layout & Space',
  'cramped-padding': 'Layout & Space',
  'body-text-viewport-edge': 'Layout & Space',
  'tight-leading': 'Typography',
  'skipped-heading': 'Typography',
  'heading-rhythm': 'Layout & Space',
  'justified-text': 'Typography',
  'tiny-text': 'Typography',
  'undersized-ui-text': 'Typography',
  'all-caps-body': 'Typography',
  'wide-tracking': 'Typography',
  'text-overflow': 'Layout & Space',
  'repeated-container-text': 'Quality',
  'clipped-overflow-container': 'Layout & Space',
  'design-system-font': 'Typography',
  'design-system-color': 'Color & Contrast',
  'design-system-radius': 'Visual Details',
  'design-system-font-size': 'Typography',
  'gpt-thin-border-wide-shadow': 'Visual Details',
  'repeating-stripes-gradient': 'Visual Details',
  'codex-grid-background': 'Visual Details',
  'theater-slop-phrase': 'Copy',
  'image-hover-transform': 'Motion',
};

/* One entry per registry rule, in registry order, in the exact shape the
   document's Hooks module renders. */
export function composeHookRules(antipatterns) {
  return antipatterns.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    group: FINGERPRINT_IDS.has(rule.id) ? 'fingerprints' : rule.category,
    discipline: DISCIPLINES[rule.id],
  }));
}
