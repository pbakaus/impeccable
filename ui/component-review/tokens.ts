/** Impeccable design-system tokens for the review UI.
 * Source of truth: impeccable-site/site/styles/kinpaku-tokens.css (and DESIGN.md). The bundle
 * cannot import the site, so the values the review uses are copied here under the same
 * --ks-* names. Change them there first, then mirror them here. */
export const ksTokens = `
:host{color-scheme:light;
 --ks-kinpaku:oklch(84% 0.19 80.46);--ks-kinpaku-rich:oklch(77% 0.13 82);--ks-kinpaku-deep:oklch(61% 0.085 78);--ks-on-gold:oklch(14% 0.018 95);--ks-gold-line:var(--ks-kinpaku-rich);
 --ks-patina:oklch(70% 0.12 188);--ks-patina-pale:oklch(82% 0.07 188);--ks-patina-deep:oklch(45% 0.10 190);--ks-patina-ink:oklch(41% 0.11 190);
 --ks-state-ink:var(--ks-patina-deep);--ks-focus-ring:var(--ks-patina-deep);
 --ks-vermilion:oklch(52% 0.16 35);
 --ks-paper:oklch(97.8% 0 0);--ks-paper-raised:oklch(99.5% 0 0);--ks-paper-deep:oklch(95% 0 0);--ks-gray:oklch(92% 0 0);--ks-gray-2:oklch(88% 0 0);
 --ks-instrument:oklch(24% 0 0);--ks-instrument-deep:oklch(17% 0 0);--ks-instrument-raised:oklch(31% 0 0);--ks-instrument-text:oklch(93% 0 0);--ks-instrument-muted:oklch(68% 0 0);
 --ks-ink:oklch(13% 0 0);--ks-text:oklch(22% 0 0);--ks-text-muted:oklch(46% 0 0);--ks-text-faint:oklch(51% 0 0);--ks-text-mute-deep:oklch(66% 0 0);
 --ks-rule:oklch(13% 0 0 / 0.08);--ks-edge:oklch(13% 0 0 / 0.45);
 --ks-radius-sm:3px;--ks-radius-md:8px;--ks-radius-pill:999px;
 --ks-control-sm:26px;--ks-control-md:32px;--ks-control-lg:44px;
 --ks-lift-1:0 1px 1px oklch(13% 0 0 / 0.05),0 2px 3px oklch(13% 0 0 / 0.04),0 6px 12px oklch(13% 0 0 / 0.05);
 --ks-lift-2:0 1px 1px oklch(13% 0 0 / 0.04),0 3px 5px oklch(13% 0 0 / 0.05),0 12px 20px oklch(13% 0 0 / 0.06),0 32px 48px oklch(13% 0 0 / 0.07);
 --ks-font:var(--font-sans,"Albert Sans"),"Avenir Next","Helvetica Neue",Arial,system-ui,sans-serif;
 --ks-font-display:var(--font-display,"Alumni Sans"),"Albert Sans",Arial,sans-serif;
 --ks-mono:var(--font-mono,"JetBrains Mono"),ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
 --ks-type-eyebrow-size:0.6875rem;--ks-type-eyebrow-track:0.14em;
 --ks-type-micro-size:0.6875rem;--ks-type-label-size:0.75rem;--ks-type-ui-size:0.8125rem;--ks-type-ui-lead:0.9375rem;
 --ks-type-small-size:0.875rem;--ks-type-subhead-size:1.25rem;--ks-type-title-lg-size:1.5rem;
 --ks-ease:cubic-bezier(0.2,0.8,0.2,1);--ks-quick:120ms;--ks-settle:200ms}
`;
