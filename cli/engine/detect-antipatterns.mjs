#!/usr/bin/env node

/**
 * Anti-Pattern Detector for Impeccable
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * Universal file — auto-detects environment (browser vs Node) and adapts.
 *
 * Node usage:
 *   node detect-antipatterns.mjs [file-or-dir...]   # jsdom for HTML, regex for rest
 *   node detect-antipatterns.mjs https://...         # Puppeteer (auto)
 *   node detect-antipatterns.mjs --fast [files...]   # regex-only (skip jsdom)
 *   node detect-antipatterns.mjs --json              # JSON output
 *
 * Browser usage:
 *   <script src="detect-antipatterns-browser.js"></script>
 *   Re-scan: window.impeccableScan()
 *
 * Exit codes: 0 = clean, 2 = findings
 */

// ─── Environment ────────────────────────────────────────────────────────────

const IS_BROWSER = typeof window !== 'undefined';
const IS_NODE = !IS_BROWSER;

// @browser-strip-start
let fs, path, fileURLToPath;
if (!IS_BROWSER) {
  fs = (await import('node:fs')).default;
  path = (await import('node:path')).default;
  fileURLToPath = (await import('node:url')).fileURLToPath;
}
// @browser-strip-end

// ─── Section 1: Constants ───────────────────────────────────────────────────

const SAFE_TAGS = new Set([
  'blockquote', 'nav', 'a', 'input', 'textarea', 'select',
  'pre', 'code', 'span', 'th', 'td', 'tr', 'li', 'label',
  'button', 'hr', 'html', 'head', 'body', 'script', 'style',
  'link', 'meta', 'title', 'br', 'img', 'svg', 'path', 'circle',
  'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use',
]);

// Per-check safe-tags override for the border (side-tab / border-accent)
// rule. We intentionally re-allow <label> here because card-shaped clickable
// labels (e.g. .checklist-item wrapping a checkbox + content) are one of the
// canonical side-tab anti-pattern shapes and must be detected. The rule's
// other preconditions (non-neutral color, width >= 2px on a single side,
// radius > 0 or width >= 3, element size >= 20x20 in the browser path)
// already filter out plain inline form labels so this does not introduce
// false positives. See modern-color-borders.html for the test matrix.
const BORDER_SAFE_TAGS = new Set(
  [...SAFE_TAGS].filter(t => t !== 'label')
);

const OVERUSED_FONTS = new Set([
  // Older monoculture (still ubiquitous):
  'inter', 'roboto', 'open sans', 'lato', 'montserrat', 'arial', 'helvetica',
  // Newer monoculture (the Anthropic-skill / Vercel / GitHub default wave):
  'fraunces', 'instrument sans',
  'geist', 'geist sans', 'geist mono',
  'mona sans',
  'plus jakarta sans', 'space grotesk', 'recoleta',
]);

// Brand-associated fonts: don't flag these as "overused" on the brand's own domains.
// Keys are font names, values are arrays of hostname suffixes where the font is allowed.
const GOOGLE_DOMAINS = [
  'google.com', 'youtube.com', 'android.com', 'chromium.org',
  'chrome.com', 'web.dev', 'gstatic.com', 'firebase.google.com',
];
const VERCEL_DOMAINS = ['vercel.com', 'nextjs.org', 'v0.app'];
const GITHUB_DOMAINS = ['github.com', 'githubnext.com'];
const BRAND_FONT_DOMAINS = {
  'roboto': GOOGLE_DOMAINS,
  'google sans': GOOGLE_DOMAINS,
  'product sans': GOOGLE_DOMAINS,
  'geist': VERCEL_DOMAINS,
  'geist sans': VERCEL_DOMAINS,
  'geist mono': VERCEL_DOMAINS,
  'mona sans': GITHUB_DOMAINS,
};

function isBrandFontOnOwnDomain(font) {
  if (typeof location === 'undefined') return false;
  const allowed = BRAND_FONT_DOMAINS[font];
  if (!allowed) return false;
  const host = location.hostname.toLowerCase();
  return allowed.some(suffix => host === suffix || host.endsWith('.' + suffix));
}

const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui',
  'inherit', 'initial', 'unset', 'revert',
]);

// Serif faces that show up in italic-display heroes. The rule also fires when
// the primary face is unknown but the stack ends in the generic `serif` token,
// which catches custom/private faces with a serif fallback.
const KNOWN_SERIF_FONTS = new Set([
  'fraunces', 'recoleta', 'newsreader', 'playfair display', 'playfair',
  'cormorant', 'cormorant garamond', 'garamond', 'eb garamond',
  'tiempos', 'tiempos headline', 'tiempos text',
  'lora', 'vollkorn', 'spectral',
  'source serif pro', 'source serif 4', 'source serif',
  'ibm plex serif', 'merriweather',
  'libre caslon', 'libre baskerville', 'baskerville',
  'georgia', 'times new roman', 'times',
  'dm serif display', 'dm serif text',
  'instrument serif', 'gt sectra', 'ogg', 'canela',
  'freight display', 'freight text',
]);

const ANTIPATTERNS = [
  // ── AI slop: tells that something was AI-generated ──
  {
    id: 'side-tab',
    category: 'slop',
    name: 'Side-tab accent border',
    description:
      'Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.',
    skillSection: 'Visual Details',
    skillGuideline: 'colored accent stripe',
  },
  {
    id: 'border-accent-on-rounded',
    category: 'slop',
    name: 'Border accent on rounded element',
    description:
      'Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.',
    skillSection: 'Visual Details',
    skillGuideline: 'colored accent stripe',
  },
  {
    id: 'overused-font',
    category: 'slop',
    name: 'Overused font',
    description:
      'Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.',
    skillSection: 'Typography',
    skillGuideline: 'overused fonts like Inter',
  },
  {
    id: 'single-font',
    category: 'slop',
    name: 'Single font for everything',
    description:
      'Only one font family is used for the entire page. Pair a distinctive display font with a refined body font to create typographic hierarchy.',
    skillSection: 'Typography',
    skillGuideline: 'only one font family for the entire page',
  },
  {
    id: 'flat-type-hierarchy',
    category: 'slop',
    name: 'Flat type hierarchy',
    description:
      'Font sizes are too close together — no clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).',
    skillSection: 'Typography',
    skillGuideline: 'flat type hierarchy',
  },
  {
    id: 'gradient-text',
    category: 'slop',
    name: 'Gradient text',
    description:
      'Gradient text is decorative rather than meaningful — a common AI tell, especially on headings and metrics. Use solid colors for text.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'gradient text for',
  },
  {
    id: 'ai-color-palette',
    category: 'slop',
    name: 'AI color palette',
    description:
      'Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'AI color palette',
  },
  {
    id: 'nested-cards',
    category: 'slop',
    name: 'Nested cards',
    description:
      'Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.',
    skillSection: 'Layout & Space',
    skillGuideline: 'Nest cards inside cards',
  },
  {
    id: 'monotonous-spacing',
    category: 'slop',
    name: 'Monotonous spacing',
    description:
      'The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.',
    skillSection: 'Layout & Space',
    skillGuideline: 'same spacing everywhere',
  },
  {
    id: 'everything-centered',
    category: 'slop',
    name: 'Everything centered',
    description:
      'Every text element is center-aligned. Left-aligned text with asymmetric layouts feels more designed. Center only hero sections and CTAs.',
    skillSection: 'Layout & Space',
    skillGuideline: 'Center everything',
  },
  {
    id: 'bounce-easing',
    category: 'slop',
    name: 'Bounce or elastic easing',
    description:
      'Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.',
    skillSection: 'Motion',
    skillGuideline: 'bounce or elastic easing',
  },
  {
    id: 'dark-glow',
    category: 'slop',
    name: 'Dark mode with glowing accents',
    description:
      'Dark backgrounds with colored box-shadow glows are the default "cool" look of AI-generated UIs. Use subtle, purposeful lighting instead — or skip the dark theme entirely.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'dark mode with glowing accents',
  },
  {
    id: 'icon-tile-stack',
    category: 'slop',
    name: 'Icon tile stacked above heading',
    description:
      'A small rounded-square icon container above a heading is the universal AI feature-card template — every generator outputs this exact shape. Try a side-by-side icon and heading, or let the icon sit in flow without its own container.',
    skillSection: 'Typography',
    skillGuideline: 'large icons with rounded corners above every heading',
  },
  {
    id: 'italic-serif-display',
    category: 'slop',
    name: 'Italic serif display headline',
    description:
      'Oversized italic serif (Fraunces, Recoleta, Playfair, Newsreader-italic) as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero. Set roman, or move to a non-serif display face. Editorial / magazine register may legitimately want this — judge by context.',
    skillSection: 'Typography',
    skillGuideline: 'oversized italic serif as the hero headline',
  },
  {
    id: 'hero-eyebrow-chip',
    category: 'slop',
    name: 'Hero eyebrow / pill chip',
    description:
      'A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline — or the same shape rendered as a pill chip — is now the default AI SaaS hero. Drop the eyebrow, integrate the kicker into the headline, or run it as a navigation breadcrumb instead.',
    skillSection: 'Typography',
    skillGuideline: 'tiny uppercase tracked label above the hero headline',
  },

  // ── Quality: general design and accessibility issues ──
  {
    id: 'pure-black-white',
    category: 'quality',
    name: 'Pure black background',
    description:
      'Pure #000000 as a background color looks harsh and unnatural. Tint it slightly toward your brand hue (e.g., oklch(12% 0.01 250)) for a more refined feel.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'pure black (#000)',
  },
  {
    id: 'gray-on-color',
    category: 'quality',
    name: 'Gray text on colored background',
    description:
      'Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.',
    skillSection: 'Color & Contrast',
    skillGuideline: 'gray text on colored backgrounds',
  },
  {
    id: 'low-contrast',
    category: 'quality',
    name: 'Low contrast text',
    description:
      'Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.',
  },
  {
    id: 'layout-transition',
    category: 'quality',
    name: 'Layout property animation',
    description:
      'Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.',
    skillSection: 'Motion',
    skillGuideline: 'Animate layout properties',
  },
  {
    id: 'line-length',
    category: 'quality',
    name: 'Line length too long',
    description:
      'Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line. Add a max-width (65ch to 75ch) to text containers.',
    skillSection: 'Layout & Space',
    skillGuideline: 'wrap beyond ~80 characters',
  },
  {
    id: 'cramped-padding',
    category: 'quality',
    name: 'Cramped padding',
    description:
      'Text is too close to the edge of its container. Add at least 8px (ideally 12-16px) of padding inside bordered or colored containers.',
  },
  {
    id: 'tight-leading',
    category: 'quality',
    name: 'Tight line height',
    description:
      'Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.',
  },
  {
    id: 'skipped-heading',
    category: 'quality',
    name: 'Skipped heading level',
    description:
      'Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.',
  },
  {
    id: 'justified-text',
    category: 'quality',
    name: 'Justified text',
    description:
      'Justified text without hyphenation creates uneven word spacing ("rivers of white"). Use text-align: left for body text, or enable hyphens: auto if you must justify.',
  },
  {
    id: 'tiny-text',
    category: 'quality',
    name: 'Tiny body text',
    description:
      'Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.',
  },
  {
    id: 'all-caps-body',
    category: 'quality',
    name: 'All-caps body text',
    description:
      'Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.',
    skillSection: 'Typography',
    skillGuideline: 'long body passages in uppercase',
  },
  {
    id: 'wide-tracking',
    category: 'quality',
    name: 'Wide letter spacing on body text',
    description:
      'Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.',
  },
];

// ─── Section 2: Color Utilities ─────────────────────────────────────────────

function isNeutralColor(color) {
  if (!color || color === 'transparent') return true;

  // rgb/rgba — use channel spread. Threshold 30 ≈ 11.7% of the 0–255 range.
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return (Math.max(+rgb[1], +rgb[2], +rgb[3]) - Math.min(+rgb[1], +rgb[2], +rgb[3])) < 30;
  }

  // oklch()/lch() — chroma is the second numeric component.
  // oklch chroma is ~0–0.4 in sRGB gamut; >= 0.02 reads as tinted, not gray.
  // lch chroma is ~0–150; >= 3 reads as tinted. jsdom emits both formats
  // literally (it does NOT convert them to rgb).
  const oklch = color.match(/oklch\(\s*[\d.%-]+\s+([\d.-]+)/i);
  if (oklch) return parseFloat(oklch[1]) < 0.02;
  const lch = color.match(/lch\(\s*[\d.%-]+\s+([\d.-]+)/i);
  if (lch) return parseFloat(lch[1]) < 3;

  // oklab()/lab() — a and b are signed axes; chroma = sqrt(a² + b²).
  // oklab a/b are ~-0.4..0.4, threshold 0.02. lab a/b are ~-128..127, threshold 3.
  const oklab = color.match(/oklab\(\s*[\d.%-]+\s+([\d.-]+)\s+([\d.-]+)/i);
  if (oklab) {
    const a = parseFloat(oklab[1]), b = parseFloat(oklab[2]);
    return Math.hypot(a, b) < 0.02;
  }
  const lab = color.match(/lab\(\s*[\d.%-]+\s+([\d.-]+)\s+([\d.-]+)/i);
  if (lab) {
    const a = parseFloat(lab[1]), b = parseFloat(lab[2]);
    return Math.hypot(a, b) < 3;
  }

  // hsl/hsla — saturation is the second numeric component (percent).
  // Modern jsdom usually converts hsl() to rgb, but handle it directly for
  // safety across versions and for any engine that preserves the format.
  const hsl = color.match(/hsla?\(\s*[\d.-]+\s*,?\s*([\d.]+)%/i);
  if (hsl) return parseFloat(hsl[1]) < 10;

  // hwb(hue whiteness% blackness%) — a pixel is fully gray when
  // whiteness + blackness >= 100; chroma-like saturation = 1 - (w+b)/100.
  const hwb = color.match(/hwb\(\s*[\d.-]+\s+([\d.]+)%\s+([\d.]+)%/i);
  if (hwb) {
    const w = parseFloat(hwb[1]), b = parseFloat(hwb[2]);
    return (1 - Math.min(100, w + b) / 100) < 0.1;
  }

  // Unknown / unrecognized format — err on the side of DETECTING rather
  // than silently skipping. This is the opposite of the previous default,
  // which was the root cause of the oklch bug.
  return false;
}

function parseRgb(color) {
  if (!color || color === 'transparent') return null;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseGradientColors(bgImage) {
  if (!bgImage || !bgImage.includes('gradient')) return [];
  const colors = [];
  for (const m of bgImage.matchAll(/rgba?\([^)]+\)/g)) {
    const c = parseRgb(m[0]);
    if (c) colors.push(c);
  }
  for (const m of bgImage.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1];
    if (h.length === 6) {
      colors.push({ r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 });
    } else {
      colors.push({ r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 });
    }
  }
  return colors;
}

function hasChroma(c, threshold = 30) {
  if (!c) return false;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) >= threshold;
}

function getHue(c) {
  if (!c) return 0;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

function colorToHex(c) {
  if (!c) return '?';
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ─── Section 3: Pure Detection ──────────────────────────────────────────────

function checkBorders(tag, widths, colors, radius) {
  if (BORDER_SAFE_TAGS.has(tag)) return [];
  const findings = [];
  const sides = ['Top', 'Right', 'Bottom', 'Left'];

  for (const side of sides) {
    const w = widths[side];
    if (w < 1 || isNeutralColor(colors[side])) continue;

    const otherSides = sides.filter(s => s !== side);
    const maxOther = Math.max(...otherSides.map(s => widths[s]));
    if (!(w >= 2 && (maxOther <= 1 || w >= maxOther * 2))) continue;

    const sn = side.toLowerCase();
    const isSide = side === 'Left' || side === 'Right';

    if (isSide) {
      if (radius > 0) findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px + border-radius: ${radius}px` });
      else if (w >= 3) findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px` });
    } else {
      if (radius > 0 && w >= 2) findings.push({ id: 'border-accent-on-rounded', snippet: `border-${sn}: ${w}px + border-radius: ${radius}px` });
    }
  }

  return findings;
}

// Returns true if the given text is composed entirely of emoji characters
// (plus whitespace / variation selectors). Emojis render as multicolor glyphs
// regardless of CSS `color`, so contrast checks against the element's text
// color are meaningless for these nodes.
const EMOJI_CHAR_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/u;
const EMOJI_CHARS_GLOBAL = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;
function isEmojiOnlyText(text) {
  if (!text) return false;
  if (!EMOJI_CHAR_RE.test(text)) return false;
  return text.replace(EMOJI_CHARS_GLOBAL, '').trim() === '';
}

function checkColors(opts) {
  const { tag, textColor, bgColor, effectiveBg, effectiveBgStops, fontSize, fontWeight, hasDirectText, isEmojiOnly, bgClip, bgImage, classList } = opts;
  if (SAFE_TAGS.has(tag)) {
    // Exception for <a> and <button> elements styled as buttons. SAFE_TAGS
    // exists to suppress contrast noise on inline links and unstyled controls,
    // where the element has no own background and the contrast against the
    // ancestor surface is already the intended visual. When the element has
    // its own opaque background and direct text, it is a styled button — and
    // contrast on its own surface is a real, frequent bug worth flagging.
    const isStyledButton = (tag === 'a' || tag === 'button')
      && hasDirectText
      && bgColor && bgColor.a > 0.5;
    if (!isStyledButton) return [];
  }
  const findings = [];

  // Pure black background (only solid or near-solid, not semi-transparent overlays)
  if (bgColor && bgColor.a >= 0.9 && bgColor.r === 0 && bgColor.g === 0 && bgColor.b === 0) {
    findings.push({ id: 'pure-black-white', snippet: '#000000 background' });
  }

  if (hasDirectText && textColor && !isEmojiOnly) {
    // Run background-dependent checks against either a solid bg or, if the
    // ancestor is a gradient, against every gradient stop (use the worst case).
    const bgs = effectiveBg ? [effectiveBg] : (effectiveBgStops && effectiveBgStops.length ? effectiveBgStops : null);
    if (bgs) {
      // Gray on colored background — flag if every stop is chromatic
      const textLum = relativeLuminance(textColor);
      const isGray = !hasChroma(textColor, 20) && textLum > 0.05 && textLum < 0.85;
      if (isGray && bgs.every(b => hasChroma(b, 40))) {
        const bgLabel = effectiveBg ? colorToHex(effectiveBg) : `gradient(${bgs.map(colorToHex).join(', ')})`;
        findings.push({ id: 'gray-on-color', snippet: `text ${colorToHex(textColor)} on bg ${bgLabel}` });
      }

      // Low contrast (WCAG AA) — worst case across all bg stops
      const ratios = bgs.map(b => contrastRatio(textColor, b));
      let worstIdx = 0;
      for (let i = 1; i < ratios.length; i++) if (ratios[i] < ratios[worstIdx]) worstIdx = i;
      const ratio = ratios[worstIdx];
      const isHeading = ['h1', 'h2', 'h3'].includes(tag);
      const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700) || isHeading;
      const threshold = isLargeText ? 3.0 : 4.5;
      if (ratio < threshold) {
        findings.push({ id: 'low-contrast', snippet: `${ratio.toFixed(1)}:1 (need ${threshold}:1) — text ${colorToHex(textColor)} on ${colorToHex(bgs[worstIdx])}` });
      }
    }

    // AI palette: purple/violet on headings
    if (hasChroma(textColor, 50)) {
      const hue = getHue(textColor);
      if (hue >= 260 && hue <= 310 && (['h1', 'h2', 'h3'].includes(tag) || fontSize >= 20)) {
        findings.push({ id: 'ai-color-palette', snippet: `Purple/violet text (${colorToHex(textColor)}) on heading` });
      }
    }
  }

  // Gradient text
  if (bgClip === 'text' && bgImage && bgImage.includes('gradient')) {
    findings.push({ id: 'gradient-text', snippet: 'background-clip: text + gradient' });
  }

  // Tailwind class checks
  if (classList) {
    const classStr = typeof classList === 'string' ? classList : Array.from(classList).join(' ');
    if (/\bbg-black\b(?!\/)/.test(classStr)) {
      findings.push({ id: 'pure-black-white', snippet: 'bg-black' });
    }

    const grayMatch = classStr.match(/\btext-(?:gray|slate|zinc|neutral|stone)-\d+\b/);
    const colorBgMatch = classStr.match(/\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/);
    if (grayMatch && colorBgMatch) {
      findings.push({ id: 'gray-on-color', snippet: `${grayMatch[0]} on ${colorBgMatch[0]}` });
    }

    if (/\bbg-clip-text\b/.test(classStr) && /\bbg-gradient-to-/.test(classStr)) {
      findings.push({ id: 'gradient-text', snippet: 'bg-clip-text + bg-gradient (Tailwind)' });
    }

    const purpleText = classStr.match(/\btext-(?:purple|violet|indigo)-\d+\b/);
    if (purpleText && (['h1', 'h2', 'h3'].includes(tag) || /\btext-(?:[2-9]xl)\b/.test(classStr))) {
      findings.push({ id: 'ai-color-palette', snippet: `${purpleText[0]} on heading` });
    }

    if (/\bfrom-(?:purple|violet|indigo)-\d+\b/.test(classStr) && /\bto-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-\d+\b/.test(classStr)) {
      findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet gradient (Tailwind)' });
    }
  }

  return findings;
}

function isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg) {
  if (!hasShadow && !hasBorder) return false;
  return hasRadius || hasBg;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Pure check: given a heading and metrics about its previousElementSibling,
// decide if the sibling is the canonical "icon-tile-stacked-above-heading" shape.
//
// Triggers when ALL of the following hold for the sibling:
//   • size 32–128px on both axes (not too small, not a hero image)
//   • aspect ratio 0.7–1.4 (squarish — excludes wide thumbnails / pill badges)
//   • has a non-transparent background-color, background-image, OR a visible border
//     (covers solid colors, white-with-border, gradients — anything that visually
//      defines a tile)
//   • border-radius < width/2 (excludes round avatars; rounded squares pass)
//   • contains an <svg> or icon-class <i> element that's smaller than the tile
//   • the tile sits above the heading (its bottom is above the heading's top)
function checkIconTile(opts) {
  const { headingTag, headingText, headingTop,
          siblingTag, siblingWidth, siblingHeight, siblingBottom,
          siblingBgColor, siblingBgImage, siblingBorderWidth, siblingBorderRadius,
          hasIconChild, iconChildWidth } = opts;
  if (!HEADING_TAGS.has(headingTag)) return [];
  if (!siblingTag) return [];
  // Don't recurse into nested headings (e.g. h2 above h3 in a section header)
  if (HEADING_TAGS.has(siblingTag)) return [];

  // Size window: 32–128px on each axis
  if (!(siblingWidth >= 32 && siblingWidth <= 128)) return [];
  if (!(siblingHeight >= 32 && siblingHeight <= 128)) return [];

  // Squarish aspect ratio
  const ratio = siblingWidth / siblingHeight;
  if (ratio < 0.7 || ratio > 1.4) return [];

  // Must have something that visually defines the tile
  const bgVisible = (siblingBgColor && siblingBgColor.a > 0.1)
    || (siblingBgImage && siblingBgImage !== 'none' && siblingBgImage !== '');
  const borderVisible = siblingBorderWidth > 0;
  if (!bgVisible && !borderVisible) return [];

  // Exclude circles (avatars). Rounded squares pass.
  if (siblingBorderRadius >= siblingWidth / 2) return [];

  // Must contain an icon element smaller than the tile
  if (!hasIconChild) return [];
  if (iconChildWidth && iconChildWidth >= siblingWidth * 0.95) return [];

  // Vertical stacking: tile must end above where the heading starts.
  // (Allow the check to skip when both top/bottom are 0 — jsdom layout case.)
  if (headingTop && siblingBottom && siblingBottom > headingTop + 4) return [];

  const text = (headingText || '').trim().slice(0, 60);
  return [{
    id: 'icon-tile-stack',
    snippet: `${Math.round(siblingWidth)}x${Math.round(siblingHeight)}px icon tile above ${headingTag} "${text}"`,
  }];
}

// Resolve the primary (non-generic) face from a font-family string and return
// whether the resolved primary is serif. Two paths:
//   1. Primary face is in KNOWN_SERIF_FONTS → serif.
//   2. Primary face is unknown but the stack ends in the generic `serif`
//      token → treat as serif. Authors who declare `font-family: 'X', serif`
//      almost always have a serif primary; a sans declared with a serif
//      fallback is a code smell, not the common case.
// Returns { primary, isSerif } so the snippet can name the face.
function resolveSerif(fontFamily) {
  if (!fontFamily) return { primary: null, isSerif: false };
  const tokens = fontFamily.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  const primary = tokens.find(f => f && !GENERIC_FONTS.has(f)) || null;
  if (!primary) return { primary: null, isSerif: false };
  if (KNOWN_SERIF_FONTS.has(primary)) return { primary, isSerif: true };
  if (tokens.includes('serif')) return { primary, isSerif: true };
  return { primary, isSerif: false };
}

function checkItalicSerif(opts) {
  const { tag, fontStyle, fontFamily, fontSize, headingText } = opts;
  if (fontStyle !== 'italic') return [];
  // Anchor the rule on hero-scale text. h1 is the canonical hero element;
  // h2 ≥ 48px catches the cases where the design demotes the visual hero
  // to an h2 but keeps the size.
  if (tag !== 'h1' && !(tag === 'h2' && fontSize >= 48)) return [];
  if (fontSize < 48) return [];
  const { primary, isSerif } = resolveSerif(fontFamily);
  if (!isSerif) return [];

  const text = (headingText || '').trim().slice(0, 60);
  return [{
    id: 'italic-serif-display',
    snippet: `italic serif ${tag} (${primary || 'serif'}) at ${Math.round(fontSize)}px "${text}"`,
  }];
}

// Sibling-relationship rule. Anchor on a hero-scale h1, look at the
// previousElementSibling, and gate on uppercase + tracked + small.
function checkHeroEyebrow(opts) {
  const {
    headingTag, headingText, headingFontSize,
    siblingTag, siblingText, siblingTextTransform,
    siblingFontSize, siblingLetterSpacing,
  } = opts;
  if (headingTag !== 'h1') return [];
  if (!headingFontSize || headingFontSize < 48) return [];
  if (!siblingTag) return [];
  // An h2 above an h1 is a different anti-pattern (heading hierarchy / dual
  // headings) — never an eyebrow.
  if (HEADING_TAGS.has(siblingTag)) return [];

  const text = (siblingText || '').trim();
  if (text.length < 2 || text.length > 30) return [];

  // Uppercase: either via text-transform, or the content is already typed
  // uppercase (no lowercase letters, at least one uppercase letter).
  const isUppercased = siblingTextTransform === 'uppercase'
    || (/[A-Z]/.test(text) && !/[a-z]/.test(text));
  if (!isUppercased) return [];

  if (!(siblingLetterSpacing >= 1.6)) return [];
  if (!(siblingFontSize > 0 && siblingFontSize <= 14)) return [];

  const headingTextSnippet = (headingText || '').trim().slice(0, 60);
  const eyebrowSnippet = text.slice(0, 40);
  return [{
    id: 'hero-eyebrow-chip',
    snippet: `eyebrow chip "${eyebrowSnippet}" above ${headingTag} "${headingTextSnippet}"`,
  }];
}

const LAYOUT_TRANSITION_PROPS = new Set([
  'width', 'height', 'padding', 'margin',
  'max-height', 'max-width', 'min-height', 'min-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]);

function checkMotion(opts) {
  const { tag, transitionProperty, animationName, timingFunctions, classList } = opts;
  if (SAFE_TAGS.has(tag)) return [];
  const findings = [];

  // --- Bounce/elastic easing ---
  if (animationName && animationName !== 'none' && /bounce|elastic|wobble|jiggle|spring/i.test(animationName)) {
    findings.push({ id: 'bounce-easing', snippet: `animation: ${animationName}` });
  }
  if (classList && /\banimate-bounce\b/.test(classList)) {
    findings.push({ id: 'bounce-easing', snippet: 'animate-bounce (Tailwind)' });
  }

  // Check timing functions for overshoot cubic-bezier (y values outside [0, 1])
  if (timingFunctions) {
    const bezierRe = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g;
    let m;
    while ((m = bezierRe.exec(timingFunctions)) !== null) {
      const y1 = parseFloat(m[2]), y2 = parseFloat(m[4]);
      if (y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1) {
        findings.push({ id: 'bounce-easing', snippet: `cubic-bezier(${m[1]}, ${m[2]}, ${m[3]}, ${m[4]})` });
        break;
      }
    }
  }

  // --- Layout property transition ---
  if (transitionProperty && transitionProperty !== 'all' && transitionProperty !== 'none') {
    const props = transitionProperty.split(',').map(p => p.trim().toLowerCase());
    const layoutFound = props.filter(p => LAYOUT_TRANSITION_PROPS.has(p));
    if (layoutFound.length > 0) {
      findings.push({ id: 'layout-transition', snippet: `transition: ${layoutFound.join(', ')}` });
    }
  }

  return findings;
}

function checkGlow(opts) {
  const { boxShadow, effectiveBg } = opts;
  if (!boxShadow || boxShadow === 'none') return [];
  if (!effectiveBg) return [];

  // Only flag on dark backgrounds (luminance < 0.1)
  const bgLum = relativeLuminance(effectiveBg);
  if (bgLum >= 0.1) return [];

  // Split multiple shadows (commas not inside parentheses)
  const parts = boxShadow.split(/,(?![^(]*\))/);
  for (const shadow of parts) {
    const colorMatch = shadow.match(/rgba?\([^)]+\)/);
    if (!colorMatch) continue;
    const color = parseRgb(colorMatch[0]);
    if (!color || !hasChroma(color, 30)) continue;

    // Extract px values — in computed style: "color Xpx Ypx BLURpx [SPREADpx]"
    const afterColor = shadow.substring(shadow.indexOf(colorMatch[0]) + colorMatch[0].length);
    const beforeColor = shadow.substring(0, shadow.indexOf(colorMatch[0]));
    const pxVals = [...beforeColor.matchAll(/([\d.]+)px/g), ...afterColor.matchAll(/([\d.]+)px/g)]
      .map(m => parseFloat(m[1]));

    // Third value is blur (offset-x, offset-y, blur, [spread])
    if (pxVals.length >= 3 && pxVals[2] > 4) {
      return [{ id: 'dark-glow', snippet: `Colored glow (${colorToHex(color)}) on dark background` }];
    }
  }

  return [];
}

/**
 * Regex-on-HTML checks shared between browser and Node page-level detection.
 * These don't need DOM access, just the raw HTML string.
 */
function checkHtmlPatterns(html) {
  const findings = [];

  // --- Color ---

  // Pure black background
  const pureBlackBgRe = /background(?:-color)?\s*:\s*(?:#000000|#000|rgb\(\s*0,\s*0,\s*0\s*\))\b/gi;
  if (pureBlackBgRe.test(html)) {
    findings.push({ id: 'pure-black-white', snippet: 'Pure #000 background' });
  }

  // AI color palette: purple/violet
  const purpleHexRe = /#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9|6366f1|764ba2|667eea)\b/gi;
  if (purpleHexRe.test(html)) {
    const purpleTextRe = /(?:(?:^|;)\s*color\s*:\s*(?:.*?)(?:#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9))|gradient.*?#(?:7c3aed|8b5cf6|a855f7|764ba2|667eea))/gi;
    if (purpleTextRe.test(html)) {
      findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet accent colors detected' });
    }
  }

  // Gradient text (background-clip: text + gradient)
  const gradientRe = /(?:-webkit-)?background-clip\s*:\s*text/gi;
  let gm;
  while ((gm = gradientRe.exec(html)) !== null) {
    const start = Math.max(0, gm.index - 200);
    const context = html.substring(start, gm.index + gm[0].length + 200);
    if (/gradient/i.test(context)) {
      findings.push({ id: 'gradient-text', snippet: 'background-clip: text + gradient' });
      break;
    }
  }
  if (/\bbg-clip-text\b/.test(html) && /\bbg-gradient-to-/.test(html)) {
    findings.push({ id: 'gradient-text', snippet: 'bg-clip-text + bg-gradient (Tailwind)' });
  }

  // --- Layout ---

  // Monotonous spacing
  const spacingValues = [];
  const spacingRe = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(\d+)px/gi;
  let sm;
  while ((sm = spacingRe.exec(html)) !== null) {
    const v = parseInt(sm[1], 10);
    if (v > 0 && v < 200) spacingValues.push(v);
  }
  const gapRe = /gap\s*:\s*(\d+)px/gi;
  while ((sm = gapRe.exec(html)) !== null) {
    spacingValues.push(parseInt(sm[1], 10));
  }
  const twSpaceRe = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)\b/g;
  while ((sm = twSpaceRe.exec(html)) !== null) {
    spacingValues.push(parseInt(sm[1], 10) * 4);
  }
  const remSpacingRe = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*([\d.]+)rem/gi;
  while ((sm = remSpacingRe.exec(html)) !== null) {
    const v = Math.round(parseFloat(sm[1]) * 16);
    if (v > 0 && v < 200) spacingValues.push(v);
  }
  const roundedSpacing = spacingValues.map(v => Math.round(v / 4) * 4);
  if (roundedSpacing.length >= 10) {
    const counts = {};
    for (const v of roundedSpacing) counts[v] = (counts[v] || 0) + 1;
    const maxCount = Math.max(...Object.values(counts));
    const dominantPct = maxCount / roundedSpacing.length;
    const unique = [...new Set(roundedSpacing)].filter(v => v > 0);
    if (dominantPct > 0.6 && unique.length <= 3) {
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      findings.push({
        id: 'monotonous-spacing',
        snippet: `~${dominant}px used ${maxCount}/${roundedSpacing.length} times (${Math.round(dominantPct * 100)}%)`,
      });
    }
  }

  // --- Motion ---

  // Bounce/elastic animation names
  const bounceRe = /animation(?:-name)?\s*:\s*[^;]*\b(bounce|elastic|wobble|jiggle|spring)\b/gi;
  if (bounceRe.test(html)) {
    findings.push({ id: 'bounce-easing', snippet: 'Bounce/elastic animation in CSS' });
  }

  // Overshoot cubic-bezier
  const bezierRe = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g;
  let bm;
  while ((bm = bezierRe.exec(html)) !== null) {
    const y1 = parseFloat(bm[2]), y2 = parseFloat(bm[4]);
    if (y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1) {
      findings.push({ id: 'bounce-easing', snippet: `cubic-bezier(${bm[1]}, ${bm[2]}, ${bm[3]}, ${bm[4]})` });
      break;
    }
  }

  // Layout property transitions
  const transRe = /transition(?:-property)?\s*:\s*([^;{}]+)/gi;
  let tm;
  while ((tm = transRe.exec(html)) !== null) {
    const val = tm[1].toLowerCase();
    if (/\ball\b/.test(val)) continue;
    const found = val.match(/\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/gi);
    if (found) {
      findings.push({ id: 'layout-transition', snippet: `transition: ${found.join(', ')}` });
      break;
    }
  }

  // --- Dark glow ---

  const darkBgRe = /background(?:-color)?\s*:\s*(?:#(?:0[0-9a-f]|1[0-9a-f]|2[0-3])[0-9a-f]{4}\b|#(?:0|1)[0-9a-f]{2}\b|rgb\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\))/gi;
  const twDarkBg = /\bbg-(?:gray|slate|zinc|neutral|stone)-(?:9\d{2}|800)\b/;
  if (darkBgRe.test(html) || twDarkBg.test(html)) {
    const shadowRe = /box-shadow\s*:\s*([^;{}]+)/gi;
    let shm;
    while ((shm = shadowRe.exec(html)) !== null) {
      const val = shm[1];
      const colorMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!colorMatch) continue;
      const [r, g, b] = [+colorMatch[1], +colorMatch[2], +colorMatch[3]];
      if ((Math.max(r, g, b) - Math.min(r, g, b)) < 30) continue;
      const pxVals = [...val.matchAll(/(\d+)px|(?<![.\d])\b(0)\b(?![.\d])/g)].map(p => +(p[1] || p[2]));
      if (pxVals.length >= 3 && pxVals[2] > 4) {
        findings.push({ id: 'dark-glow', snippet: `Colored glow (rgb(${r},${g},${b})) on dark page` });
        break;
      }
    }
  }

  return findings;
}

// ─── Section 4: resolveBackground (unified) ─────────────────────────────────

// Read the element's own background color, computed-style first, with a
// jsdom-friendly fallback that parses the inline `background:` shorthand
// from the raw style attribute. jsdom (~v29) does not decompose the
// shorthand into `backgroundColor`, so without this fallback the CLI silently
// returns null for any element styled via `background: rgb(...)` or
// `background: #abc`. Real browsers always decompose, so the fallback is
// a no-op there.
function readOwnBackgroundColor(el, computedStyle) {
  const bg = parseRgb(computedStyle.backgroundColor);
  if (IS_BROWSER || (bg && bg.a >= 0.1)) return bg;
  const rawStyle = el.getAttribute?.('style') || '';
  const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  const inlineBg = bgMatch ? bgMatch[1].trim() : '';
  if (!inlineBg) return bg;
  if (/gradient/i.test(inlineBg) || /url\s*\(/i.test(inlineBg)) return bg;
  const fromRgb = parseRgb(inlineBg);
  if (fromRgb) return fromRgb;
  const hexMatch = inlineBg.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 6) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  }
  return bg;
}

function resolveBackground(el, win) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);

    // If this element has a background-image (gradient or url), it's visually
    // opaque but we can't determine the effective color — bail out so callers
    // don't get a false solid-color answer.
    const bgImage = style.backgroundImage || '';
    if (bgImage && bgImage !== 'none' && (/gradient/i.test(bgImage) || /url\s*\(/i.test(bgImage))) {
      return null;
    }

    let bg = parseRgb(style.backgroundColor);
    if (!IS_BROWSER && (!bg || bg.a < 0.1)) {
      // jsdom doesn't decompose background shorthand — parse raw style attr
      const rawStyle = current.getAttribute?.('style') || '';
      const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
      const inlineBg = bgMatch ? bgMatch[1].trim() : '';
      // Check for gradient or url() image in inline style too
      if (/gradient/i.test(inlineBg) || /url\s*\(/i.test(inlineBg)) return null;
      bg = parseRgb(inlineBg);
      if (!bg && inlineBg) {
        const hexMatch = inlineBg.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
        if (hexMatch) {
          const h = hexMatch[1];
          if (h.length === 6) {
            bg = { r: parseInt(h.slice(0,2), 16), g: parseInt(h.slice(2,4), 16), b: parseInt(h.slice(4,6), 16), a: 1 };
          } else {
            bg = { r: parseInt(h[0]+h[0], 16), g: parseInt(h[1]+h[1], 16), b: parseInt(h[2]+h[2], 16), a: 1 };
          }
        }
      }
    }
    if (bg && bg.a > 0.1) {
      if (IS_BROWSER || bg.a >= 0.5) return bg;
    }
    current = current.parentElement;
  }
  return { r: 255, g: 255, b: 255 };
}

// Walk parents looking for a gradient background and return its color stops.
// Used as a fallback when resolveBackground() returns null because the
// effective background is a gradient (no single solid color to compare against).
function resolveGradientStops(el, win) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);
    const bgImage = style.backgroundImage || '';
    if (bgImage && bgImage !== 'none' && /gradient/i.test(bgImage)) {
      const stops = parseGradientColors(bgImage);
      if (stops.length > 0) return stops;
    }
    if (!IS_BROWSER) {
      // jsdom doesn't decompose `background:` shorthand — peek at the raw inline style
      const rawStyle = current.getAttribute?.('style') || '';
      const bgMatch = rawStyle.match(/background(?:-image)?\s*:\s*([^;]+)/i);
      if (bgMatch && /gradient/i.test(bgMatch[1])) {
        const stops = parseGradientColors(bgMatch[1]);
        if (stops.length > 0) return stops;
      }
    }
    current = current.parentElement;
  }
  return null;
}

// Parse a single CSS length token to pixels. Accepts "12px", "50%", a
// shorthand like "12px 4px" (uses the first value), or empty / null.
// Returns the pixel value, or null when the input is unparseable.
// Percentages convert against `widthPx` when one is supplied. Without a
// usable width (jsdom returns "auto" for many real-world elements,
// which parseFloat collapses to 0), fall back to the raw percentage
// number so callers gating on `> 0` (border-accent-on-rounded,
// isCardLike's hasRadius) still see a positive value, matching the
// original parseFloat("50%") === 50 behavior.
function parseRadiusToPx(value, widthPx) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  const num = parseFloat(first);
  if (Number.isNaN(num)) return null;
  if (/%$/.test(first)) {
    if (widthPx && widthPx > 0) return (num / 100) * widthPx;
    return num;
  }
  return num;
}

// jsdom from 29.0.2 onward returns "" for the `border-radius` shorthand
// in computed style and "0" for longhand reads when the source rule used
// the shorthand. The rule engine relied on parseFloat(style.borderRadius)
// to identify circular avatars (border-radius >= width/2) and rounded
// cards (border-radius > 0); both checks broke silently. This helper
// recovers the radius via a chain of fallbacks. Browsers resolve the
// shorthand correctly and exit on the first line.
function resolveBorderRadiusPx(el, style, widthPx, win) {
  const fromComputed = parseRadiusToPx(style.borderRadius, widthPx);
  if (fromComputed !== null) return fromComputed;

  if (IS_BROWSER || !win) return 0;

  const fromLonghand = parseRadiusToPx(style.borderTopLeftRadius, widthPx);
  if (fromLonghand !== null && fromLonghand > 0) return fromLonghand;

  const fromInlineProp = parseRadiusToPx(el.style?.borderRadius, widthPx);
  if (fromInlineProp !== null) return fromInlineProp;

  const rawStyle = el.getAttribute?.('style') || '';
  const inlineMatch = rawStyle.match(/border-radius\s*:\s*([^;]+)/i);
  if (inlineMatch) {
    const fromRaw = parseRadiusToPx(inlineMatch[1].trim(), widthPx);
    if (fromRaw !== null) return fromRaw;
  }

  // Walk every stylesheet looking for matching rules. Take the maximum
  // pixel value across all matches so a circle declaration overridden by
  // a more specific rounded-square selector still registers as a circle
  // for the exclusion check (better to under-flag than to false-positive
  // on round avatars).
  let max = 0;
  const sheets = win.document?.styleSheets;
  if (sheets) {
    for (const sheet of sheets) {
      let rules;
      try { rules = sheet.cssRules || []; } catch { continue; }
      for (const rule of rules) {
        if (!rule.style || !rule.selectorText) continue;
        let matches = false;
        try { matches = el.matches(rule.selectorText); } catch { continue; }
        if (!matches) continue;
        const ruleValue = rule.style.borderRadius
          || (rule.style.getPropertyValue && rule.style.getPropertyValue('border-radius'))
          || rule.style.borderTopLeftRadius;
        const px = parseRadiusToPx(ruleValue, widthPx);
        if (px !== null && px > max) max = px;
      }
    }
  }
  return max;
}

// ─── Section 5: Element Adapters ────────────────────────────────────────────

// Browser adapters — call getComputedStyle/getBoundingClientRect on live DOM

function checkElementBordersDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (BORDER_SAFE_TAGS.has(tag)) return [];
  const rect = el.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return [];
  const style = getComputedStyle(el);
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = {}, colors = {};
  for (const s of sides) {
    widths[s] = parseFloat(style[`border${s}Width`]) || 0;
    colors[s] = style[`border${s}Color`] || '';
  }
  return checkBorders(tag, widths, colors, parseFloat(style.borderRadius) || 0);
}

function checkElementColorsDOM(el) {
  const tag = el.tagName.toLowerCase();
  // No early SAFE_TAGS bail here — checkColors() does its own gating that
  // includes the styled-button exception for <a> / <button> with their own
  // opaque background. Bailing here would prevent that exception from firing.
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return [];
  const style = getComputedStyle(el);
  const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasDirectText = directText.trim().length > 0;
  const effectiveBg = resolveBackground(el);
  return checkColors({
    tag,
    textColor: parseRgb(style.color),
    bgColor: readOwnBackgroundColor(el, style),
    effectiveBg,
    effectiveBgStops: effectiveBg ? null : resolveGradientStops(el),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    isEmojiOnly: isEmojiOnlyText(directText),
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute('class') || '',
  });
}

function checkElementIconTileDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (!HEADING_TAGS.has(tag)) return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];

  const sibRect = sibling.getBoundingClientRect();
  const headRect = el.getBoundingClientRect();
  const sibStyle = getComputedStyle(sibling);

  // The tile may either contain an <svg>/<i> icon child, OR the tile itself
  // may contain an emoji/symbol character directly as its only text content
  // (the "card-icon" pattern from many AI-generated demos).
  const iconChild = sibling.querySelector('svg, i[data-lucide], i[class*="fa-"], i[class*="icon"]');
  const iconRect = iconChild?.getBoundingClientRect();
  const sibDirectText = [...sibling.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasInlineEmojiIcon = sibling.children.length === 0 && isEmojiOnlyText(sibDirectText);

  return checkIconTile({
    headingTag: tag,
    headingText: el.textContent || '',
    headingTop: headRect.top,
    siblingTag: sibling.tagName.toLowerCase(),
    siblingWidth: sibRect.width,
    siblingHeight: sibRect.height,
    siblingBottom: sibRect.bottom,
    siblingBgColor: parseRgb(sibStyle.backgroundColor),
    siblingBgImage: sibStyle.backgroundImage || '',
    siblingBorderWidth: parseFloat(sibStyle.borderTopWidth) || 0,
    siblingBorderRadius: parseFloat(sibStyle.borderRadius) || 0,
    hasIconChild: !!iconChild || hasInlineEmojiIcon,
    iconChildWidth: iconRect?.width || 0,
  });
}

function checkElementItalicSerifDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'h1' && tag !== 'h2') return [];
  const style = getComputedStyle(el);
  return checkItalicSerif({
    tag,
    fontStyle: style.fontStyle || '',
    fontFamily: style.fontFamily || '',
    fontSize: parseFloat(style.fontSize) || 0,
    headingText: el.textContent || '',
  });
}

function checkElementHeroEyebrowDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'h1') return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];
  const headStyle = getComputedStyle(el);
  const sibStyle = getComputedStyle(sibling);
  return checkHeroEyebrow({
    headingTag: tag,
    headingText: el.textContent || '',
    headingFontSize: parseFloat(headStyle.fontSize) || 0,
    siblingTag: sibling.tagName.toLowerCase(),
    siblingText: sibling.textContent || '',
    siblingTextTransform: sibStyle.textTransform || '',
    siblingFontSize: parseFloat(sibStyle.fontSize) || 0,
    siblingLetterSpacing: parseFloat(sibStyle.letterSpacing) || 0,
  });
}

function checkElementMotionDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag)) return [];
  const style = getComputedStyle(el);
  return checkMotion({
    tag,
    transitionProperty: style.transitionProperty || '',
    animationName: style.animationName || '',
    timingFunctions: [style.animationTimingFunction, style.transitionTimingFunction].filter(Boolean).join(' '),
    classList: el.getAttribute('class') || '',
  });
}

function checkElementGlowDOM(el) {
  const tag = el.tagName.toLowerCase();
  const style = getComputedStyle(el);
  if (!style.boxShadow || style.boxShadow === 'none') return [];
  // Use parent's background — glow radiates outward, so the surrounding context matters
  // If resolveBackground returns null (gradient), try to infer from the gradient colors
  let parentBg = el.parentElement ? resolveBackground(el.parentElement) : resolveBackground(el);
  if (!parentBg) {
    // Gradient background — sample its colors to determine if it's dark
    let cur = el.parentElement;
    while (cur && cur.nodeType === 1) {
      const bgImage = getComputedStyle(cur).backgroundImage || '';
      const gradColors = parseGradientColors(bgImage);
      if (gradColors.length > 0) {
        // Average the gradient colors
        const avg = { r: 0, g: 0, b: 0 };
        for (const c of gradColors) { avg.r += c.r; avg.g += c.g; avg.b += c.b; }
        avg.r = Math.round(avg.r / gradColors.length);
        avg.g = Math.round(avg.g / gradColors.length);
        avg.b = Math.round(avg.b / gradColors.length);
        parentBg = avg;
        break;
      }
      cur = cur.parentElement;
    }
  }
  return checkGlow({ tag, boxShadow: style.boxShadow, effectiveBg: parentBg });
}

function checkElementAIPaletteDOM(el) {
  const style = getComputedStyle(el);
  const findings = [];

  // Check gradient backgrounds for purple/violet or cyan
  const bgImage = style.backgroundImage || '';
  const gradColors = parseGradientColors(bgImage);
  for (const c of gradColors) {
    if (hasChroma(c, 50)) {
      const hue = getHue(c);
      if (hue >= 260 && hue <= 310) {
        findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet gradient background' });
        break;
      }
      if (hue >= 160 && hue <= 200) {
        findings.push({ id: 'ai-color-palette', snippet: 'Cyan gradient background' });
        break;
      }
    }
  }

  // Check for neon text (vivid cyan/purple color on dark background)
  const textColor = parseRgb(style.color);
  if (textColor && hasChroma(textColor, 80)) {
    const hue = getHue(textColor);
    const isAIPalette = (hue >= 160 && hue <= 200) || (hue >= 260 && hue <= 310);
    if (isAIPalette) {
      const parentBg = el.parentElement ? resolveBackground(el.parentElement) : null;
      // Also check gradient parents
      let effectiveBg = parentBg;
      if (!effectiveBg) {
        let cur = el.parentElement;
        while (cur && cur.nodeType === 1) {
          const gi = getComputedStyle(cur).backgroundImage || '';
          const gc = parseGradientColors(gi);
          if (gc.length > 0) {
            const avg = { r: 0, g: 0, b: 0 };
            for (const c of gc) { avg.r += c.r; avg.g += c.g; avg.b += c.b; }
            avg.r = Math.round(avg.r / gc.length);
            avg.g = Math.round(avg.g / gc.length);
            avg.b = Math.round(avg.b / gc.length);
            effectiveBg = avg;
            break;
          }
          cur = cur.parentElement;
        }
      }
      if (effectiveBg && relativeLuminance(effectiveBg) < 0.1) {
        const label = hue >= 260 ? 'Purple/violet' : 'Cyan';
        findings.push({ id: 'ai-color-palette', snippet: `${label} neon text on dark background` });
      }
    }
  }

  return findings;
}

const QUALITY_TEXT_TAGS = new Set(['p', 'li', 'td', 'th', 'dd', 'blockquote', 'figcaption']);

// Resolve a CSS font-size value to pixels by walking up the parent chain.
// Browsers resolve em/rem/% to px in getComputedStyle, but jsdom returns the
// specified value verbatim — so for the Node path we walk parents ourselves.
function resolveFontSizePx(el, win) {
  const chain = []; // raw font-size strings, leaf → root
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const fs = (win ? win.getComputedStyle(cur) : getComputedStyle(cur)).fontSize;
    chain.push(fs || '');
    cur = cur.parentElement;
  }
  // Walk root → leaf, resolving each value relative to its parent context.
  let px = 16; // root default
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = chain[i];
    if (!v || v === 'inherit') continue;
    const num = parseFloat(v);
    if (isNaN(num)) continue;
    if (v.endsWith('px')) px = num;
    else if (v.endsWith('rem')) px = num * 16;
    else if (v.endsWith('em')) px = num * px;
    else if (v.endsWith('%')) px = (num / 100) * px;
    else px = num; // unitless — already resolved
  }
  return px;
}

// Resolve a CSS length value (line-height, letter-spacing, etc.) given a
// known font-size context. Returns null for "normal" / unparseable values.
function resolveLengthPx(value, fontSizePx) {
  if (!value || value === 'normal' || value === 'auto' || value === 'inherit') return null;
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (value.endsWith('px')) return num;
  if (value.endsWith('rem')) return num * 16;
  if (value.endsWith('em')) return num * fontSizePx;
  if (value.endsWith('%')) return (num / 100) * fontSizePx;
  // Unitless line-height = multiplier, return px equivalent
  return num * fontSizePx;
}

// Pure quality checks. Most run on computed CSS and DOM-only inputs (work in
// jsdom and the browser). Two checks (line-length, cramped-padding) gate on
// element rect dimensions, which jsdom can't compute — pass `rect: null` from
// the Node adapter to skip those.
//
// Both adapters resolve font-size, line-height and letter-spacing to pixels
// before calling this so the pure function only deals with numbers.
function checkQuality(opts) {
  const { el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect, lineMax = 80 } = opts;
  const findings = [];
  // Skip browser extension injected elements
  const elId = el.id || '';
  if (elId.startsWith('claude-') || elId.startsWith('cic-')) return findings;

  // --- Line length too long --- (browser-only: needs rect.width)
  if (rect && hasDirectText && QUALITY_TEXT_TAGS.has(tag) && rect.width > 0 && textLen > lineMax) {
    const charsPerLine = rect.width / (fontSize * 0.5);
    if (charsPerLine > lineMax + 5) {
      findings.push({ id: 'line-length', snippet: `~${Math.round(charsPerLine)} chars/line (aim for <${lineMax})` });
    }
  }

  // --- Cramped padding --- (browser-only: needs rect to skip small badges/labels)
  // Vertical and horizontal thresholds are independent because line-height
  // already provides built-in vertical breathing room (the line box is taller
  // than the cap height), but horizontal has no equivalent. Both scale with
  // font-size — bigger text demands proportionally more padding.
  //   vertical:   max(4px, fontSize × 0.3)
  //   horizontal: max(8px, fontSize × 0.5)
  if (rect && hasDirectText && textLen > 20 && rect.width > 100 && rect.height > 30) {
    const borders = {
      top: parseFloat(style.borderTopWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
      bottom: parseFloat(style.borderBottomWidth) || 0,
      left: parseFloat(style.borderLeftWidth) || 0,
    };
    const borderCount = Object.values(borders).filter(w => w > 0).length;
    const hasBg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
    if (borderCount >= 2 || hasBg) {
      const vPads = [], hPads = [];
      if (hasBg || borders.top > 0) vPads.push(parseFloat(style.paddingTop) || 0);
      if (hasBg || borders.bottom > 0) vPads.push(parseFloat(style.paddingBottom) || 0);
      if (hasBg || borders.left > 0) hPads.push(parseFloat(style.paddingLeft) || 0);
      if (hasBg || borders.right > 0) hPads.push(parseFloat(style.paddingRight) || 0);

      const vMin = vPads.length ? Math.min(...vPads) : Infinity;
      const hMin = hPads.length ? Math.min(...hPads) : Infinity;
      const vThresh = Math.max(4, fontSize * 0.3);
      const hThresh = Math.max(8, fontSize * 0.5);

      // Emit at most one finding per element — pick whichever axis is worse.
      if (vMin < vThresh) {
        findings.push({ id: 'cramped-padding', snippet: `${vMin}px vertical padding (need ≥${vThresh.toFixed(1)}px for ${fontSize}px text)` });
      } else if (hMin < hThresh) {
        findings.push({ id: 'cramped-padding', snippet: `${hMin}px horizontal padding (need ≥${hThresh.toFixed(1)}px for ${fontSize}px text)` });
      }
    }
  }

  // --- Tight line height ---
  if (hasDirectText && textLen > 50 && !['h1','h2','h3','h4','h5','h6'].includes(tag)) {
    if (lineHeightPx != null && fontSize > 0) {
      const ratio = lineHeightPx / fontSize;
      if (ratio > 0 && ratio < 1.3) {
        findings.push({ id: 'tight-leading', snippet: `line-height ${ratio.toFixed(2)}x (need >=1.3)` });
      }
    }
  }

  // --- Justified text (without hyphens) ---
  if (hasDirectText && style.textAlign === 'justify') {
    const hyphens = style.hyphens || style.webkitHyphens || '';
    if (hyphens !== 'auto') {
      findings.push({ id: 'justified-text', snippet: 'text-align: justify without hyphens: auto' });
    }
  }

  // --- Tiny body text ---
  // Only flag actual body content, not UI labels (buttons, tabs, badges, captions, footer text, etc.)
  if (hasDirectText && textLen > 20 && fontSize < 12) {
    const skipTags = ['sub', 'sup', 'code', 'kbd', 'samp', 'var', 'caption', 'figcaption'];
    const inUIContext = el.closest && el.closest('button, a, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], nav, footer, [class*="badge" i], [class*="chip" i], [class*="pill" i], [class*="tag" i], [class*="label" i], [class*="caption" i]');
    const isUppercase = style.textTransform === 'uppercase';
    if (!skipTags.includes(tag) && !inUIContext && !isUppercase) {
      findings.push({ id: 'tiny-text', snippet: `${fontSize}px body text` });
    }
  }

  // --- All-caps body text ---
  if (hasDirectText && textLen > 30 && style.textTransform === 'uppercase') {
    if (!['h1','h2','h3','h4','h5','h6'].includes(tag)) {
      findings.push({ id: 'all-caps-body', snippet: `text-transform: uppercase on ${textLen} chars of body text` });
    }
  }

  // --- Wide letter spacing on body text ---
  if (hasDirectText && textLen > 20 && style.textTransform !== 'uppercase') {
    if (letterSpacingPx != null && letterSpacingPx > 0 && fontSize > 0) {
      const trackingEm = letterSpacingPx / fontSize;
      if (trackingEm > 0.05) {
        findings.push({ id: 'wide-tracking', snippet: `letter-spacing: ${trackingEm.toFixed(2)}em on body text` });
      }
    }
  }

  return findings;
}

function checkElementQualityDOM(el) {
  const tag = el.tagName.toLowerCase();
  const style = getComputedStyle(el);
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 10);
  const textLen = el.textContent?.trim().length || 0;
  // Browser getComputedStyle resolves everything to px — direct parseFloat
  // works.
  const fontSize = parseFloat(style.fontSize) || 16;
  const lineHeightPx = resolveLengthPx(style.lineHeight, fontSize);
  const letterSpacingPx = resolveLengthPx(style.letterSpacing, fontSize);
  const rect = el.getBoundingClientRect();
  const lineMax = (typeof window !== 'undefined' && window.__IMPECCABLE_CONFIG__?.lineLengthMax) || 80;
  return checkQuality({ el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect, lineMax });
}

// Pure page-level skipped-heading walk. Takes a Document so it works in both
// the browser and jsdom.
function checkPageQualityFromDoc(doc) {
  const findings = [];
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let prevLevel = 0;
  let prevText = '';
  for (const h of headings) {
    const level = parseInt(h.tagName[1]);
    const text = (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (prevLevel > 0 && level > prevLevel + 1) {
      findings.push({
        id: 'skipped-heading',
        snippet: `<h${prevLevel}> "${prevText}" followed by <h${level}> "${text}" (missing h${prevLevel + 1})`,
      });
    }
    prevLevel = level;
    prevText = text;
  }
  return findings;
}

// Browser adapter (returns the legacy { type, detail } shape used by the overlay loop)
function checkPageQualityDOM() {
  return checkPageQualityFromDoc(document).map(f => ({ type: f.id, detail: f.snippet }));
}

// Node adapters — take pre-extracted jsdom computed style

// jsdom doesn't lay out OR resolve em/rem/% to px — so we pre-resolve every
// CSS length the rule needs ourselves (walking the parent chain for
// font-size inheritance), and pass `rect: null` to skip the two rules that
// genuinely need element rects (line-length, cramped-padding).
function checkElementQuality(el, style, tag, window) {
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 10);
  const textLen = el.textContent?.trim().length || 0;
  const fontSize = resolveFontSizePx(el, window);
  const lineHeightPx = resolveLengthPx(style.lineHeight, fontSize);
  const letterSpacingPx = resolveLengthPx(style.letterSpacing, fontSize);
  return checkQuality({ el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect: null });
}

function checkElementBorders(tag, style, overrides, resolvedRadius) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = {}, colors = {};
  for (const s of sides) {
    widths[s] = parseFloat(style[`border${s}Width`]) || 0;
    colors[s] = style[`border${s}Color`] || '';
    // jsdom silently drops any border shorthand containing var(), leaving
    // both width and color empty on the computed style. When the detectHtml
    // pre-pass pulled a resolved value off the rule, use it to fill in the
    // missing side so the side-tab check can run. Real browsers resolve
    // var() natively, so this fallback is a no-op in the browser path.
    if (widths[s] === 0 && overrides && overrides[s]) {
      widths[s] = overrides[s].width;
      colors[s] = overrides[s].color;
    } else if (colors[s] && colors[s].startsWith('var(') && overrides && overrides[s]) {
      // Longhand case: jsdom kept the width but left the color as the
      // literal `var(...)` string. Substitute the resolved color.
      colors[s] = overrides[s].color;
    }
  }
  // resolvedRadius lets the caller pre-resolve the radius via
  // resolveBorderRadiusPx so the value survives jsdom 29.1.0's broken
  // shorthand serialization. Falls back to the computed value for tests
  // and browser callers that don't pre-resolve.
  const radius = resolvedRadius != null
    ? resolvedRadius
    : (parseFloat(style.borderRadius) || 0);
  return checkBorders(tag, widths, colors, radius);
}

function checkElementColors(el, style, tag, window) {
  const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasDirectText = directText.trim().length > 0;

  const effectiveBg = resolveBackground(el, window);
  return checkColors({
    tag,
    textColor: parseRgb(style.color),
    bgColor: readOwnBackgroundColor(el, style),
    effectiveBg,
    effectiveBgStops: effectiveBg ? null : resolveGradientStops(el, window),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    isEmojiOnly: isEmojiOnlyText(directText),
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute?.('class') || el.className || '',
  });
}

function checkElementIconTile(el, tag, window) {
  if (!HEADING_TAGS.has(tag)) return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];

  const sibStyle = window.getComputedStyle(sibling);
  // jsdom doesn't lay out — read explicit pixel dimensions from CSS instead.
  const sibWidth = parseFloat(sibStyle.width) || 0;
  const sibHeight = parseFloat(sibStyle.height) || 0;

  const iconChild = sibling.querySelector('svg, i[data-lucide], i[class*="fa-"], i[class*="icon"]');
  let iconWidth = 0;
  if (iconChild) {
    const iconStyle = window.getComputedStyle(iconChild);
    iconWidth = parseFloat(iconStyle.width) || parseFloat(iconChild.getAttribute('width')) || 0;
  }
  // Or: tile contains an emoji/symbol character directly as its only content
  const sibDirectText = [...sibling.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasInlineEmojiIcon = sibling.children.length === 0 && isEmojiOnlyText(sibDirectText);

  return checkIconTile({
    headingTag: tag,
    headingText: el.textContent || '',
    headingTop: 0, // jsdom: no layout, skip vertical-stacking gate
    siblingTag: sibling.tagName.toLowerCase(),
    siblingWidth: sibWidth,
    siblingHeight: sibHeight,
    siblingBottom: 0,
    siblingBgColor: parseRgb(sibStyle.backgroundColor),
    siblingBgImage: sibStyle.backgroundImage || '',
    siblingBorderWidth: parseFloat(sibStyle.borderTopWidth) || 0,
    siblingBorderRadius: resolveBorderRadiusPx(sibling, sibStyle, sibWidth, window),
    hasIconChild: !!iconChild || hasInlineEmojiIcon,
    iconChildWidth: iconWidth,
  });
}

function checkElementItalicSerif(el, style, tag) {
  if (tag !== 'h1' && tag !== 'h2') return [];
  return checkItalicSerif({
    tag,
    fontStyle: style.fontStyle || '',
    fontFamily: style.fontFamily || '',
    fontSize: parseFloat(style.fontSize) || 0,
    headingText: el.textContent || '',
  });
}

function checkElementHeroEyebrow(el, style, tag, window) {
  if (tag !== 'h1') return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];
  const sibStyle = window.getComputedStyle(sibling);
  const siblingFontSize = parseFloat(sibStyle.fontSize) || 0;
  // resolveLengthPx returns null for 'normal' / 'auto'; coerce to 0 so the
  // gate falls through cleanly. jsdom returns letter-spacing verbatim
  // (e.g. '0.15em'), unlike real browsers, so this conversion is required.
  return checkHeroEyebrow({
    headingTag: tag,
    headingText: el.textContent || '',
    headingFontSize: parseFloat(style.fontSize) || 0,
    siblingTag: sibling.tagName.toLowerCase(),
    siblingText: sibling.textContent || '',
    siblingTextTransform: sibStyle.textTransform || '',
    siblingFontSize,
    siblingLetterSpacing: resolveLengthPx(sibStyle.letterSpacing, siblingFontSize) || 0,
  });
}

function checkElementMotion(tag, style) {
  return checkMotion({
    tag,
    transitionProperty: style.transitionProperty || '',
    animationName: style.animationName || '',
    timingFunctions: [style.animationTimingFunction, style.transitionTimingFunction].filter(Boolean).join(' '),
    classList: '',
  });
}

function checkElementGlow(tag, style, effectiveBg) {
  if (!style.boxShadow || style.boxShadow === 'none') return [];
  return checkGlow({ tag, boxShadow: style.boxShadow, effectiveBg });
}

// ─── Section 6: Page-Level Checks ───────────────────────────────────────────

// Browser page-level checks — use document/getComputedStyle globals

function checkTypography() {
  const findings = [];

  // Walk actual text-bearing elements and tally font usage by *computed style*.
  // This is much more accurate than scanning CSS rules — it ignores rules that
  // exist in the stylesheet but apply to nothing (e.g. demo classes showing
  // anti-patterns), and counts what the user actually sees.
  const fontUsage = new Map(); // primary font name → count of elements
  let totalTextElements = 0;
  for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, dd, blockquote, figcaption, a, button, label, span')) {
    // Skip impeccable's own elements
    if (el.closest && el.closest('.impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip')) continue;
    // Only count elements that actually have visible direct text
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasText) continue;
    const style = getComputedStyle(el);
    const ff = style.fontFamily;
    if (!ff) continue;
    const stack = ff.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
    const primary = stack.find(f => f && !GENERIC_FONTS.has(f));
    if (!primary) continue;
    fontUsage.set(primary, (fontUsage.get(primary) || 0) + 1);
    totalTextElements++;
  }

  if (totalTextElements >= 20) {
    // A font is "primary" if it's used by at least 15% of text elements
    const PRIMARY_THRESHOLD = 0.15;
    for (const [font, count] of fontUsage) {
      const share = count / totalTextElements;
      if (share < PRIMARY_THRESHOLD) continue;
      if (!OVERUSED_FONTS.has(font)) continue;
      if (isBrandFontOnOwnDomain(font)) continue;
      findings.push({ type: 'overused-font', detail: `Primary font: ${font} (${Math.round(share * 100)}% of text)` });
    }

    // Single-font check: only one distinct primary font across all text
    if (fontUsage.size === 1) {
      const only = [...fontUsage.keys()][0];
      findings.push({ type: 'single-font', detail: `only font used is ${only}` });
    }
  }

  const sizes = new Set();
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,label,button,div')) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs > 0 && fs < 200) sizes.add(Math.round(fs * 10) / 10);
  }
  if (sizes.size >= 3) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio < 2.0) {
      findings.push({ type: 'flat-type-hierarchy', detail: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }
  }

  return findings;
}

function isCardLikeDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag) || ['input','select','textarea','img','video','canvas','picture'].includes(tag)) return false;
  const style = getComputedStyle(el);
  const cls = el.getAttribute('class') || '';
  const hasShadow = (style.boxShadow && style.boxShadow !== 'none') || /\bshadow(?:-sm|-md|-lg|-xl|-2xl)?\b/.test(cls);
  const hasBorder = /\bborder\b/.test(cls);
  const hasRadius = parseFloat(style.borderRadius) > 0 || /\brounded(?:-sm|-md|-lg|-xl|-2xl|-full)?\b/.test(cls);
  const hasBg = (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') || /\bbg-(?:white|gray-\d+|slate-\d+)\b/.test(cls);
  return isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg);
}

function checkLayout() {
  const findings = [];
  const flaggedEls = new Set();

  for (const el of document.querySelectorAll('*')) {
    if (!isCardLikeDOM(el) || flaggedEls.has(el)) continue;
    const cls = el.getAttribute('class') || '';
    const style = getComputedStyle(el);
    if (style.position === 'absolute' || style.position === 'fixed') continue;
    if (/\b(?:dropdown|popover|tooltip|menu|modal|dialog)\b/i.test(cls)) continue;
    if ((el.textContent?.trim().length || 0) < 10) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 30) continue;

    let parent = el.parentElement;
    while (parent) {
      if (isCardLikeDOM(parent)) { flaggedEls.add(el); break; }
      parent = parent.parentElement;
    }
  }

  for (const el of flaggedEls) {
    let isAncestor = false;
    for (const other of flaggedEls) {
      if (other !== el && el.contains(other)) { isAncestor = true; break; }
    }
    if (!isAncestor) findings.push({ type: 'nested-cards', detail: 'Card inside card', el });
  }

  return findings;
}

// Node page-level checks — take document/window as parameters

function checkPageTypography(doc, win) {
  const findings = [];

  const fonts = new Set();
  const overusedFound = new Set();

  for (const sheet of doc.styleSheets) {
    let rules;
    try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.type !== 1) continue;
      const ff = rule.style?.fontFamily;
      if (!ff) continue;
      const stack = ff.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
      const primary = stack.find(f => f && !GENERIC_FONTS.has(f));
      if (primary) {
        fonts.add(primary);
        if (OVERUSED_FONTS.has(primary)) overusedFound.add(primary);
      }
    }
  }

  // Check Google Fonts links in HTML
  const html = doc.documentElement?.outerHTML || '';
  const gfRe = /fonts\.googleapis\.com\/css2?\?family=([^&"'\s]+)/gi;
  let m;
  while ((m = gfRe.exec(html)) !== null) {
    const families = m[1].split('|').map(f => f.split(':')[0].replace(/\+/g, ' ').toLowerCase());
    for (const f of families) {
      fonts.add(f);
      if (OVERUSED_FONTS.has(f)) overusedFound.add(f);
    }
  }

  // Also parse raw HTML/style content for font-family (jsdom may not expose all via CSSOM)
  const ffRe = /font-family\s*:\s*([^;}]+)/gi;
  let fm;
  while ((fm = ffRe.exec(html)) !== null) {
    for (const f of fm[1].split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())) {
      if (f && !GENERIC_FONTS.has(f)) {
        fonts.add(f);
        if (OVERUSED_FONTS.has(f)) overusedFound.add(f);
      }
    }
  }

  for (const font of overusedFound) {
    findings.push({ id: 'overused-font', snippet: `Primary font: ${font}` });
  }

  // Single font
  if (fonts.size === 1) {
    const els = doc.querySelectorAll('*');
    if (els.length >= 20) {
      findings.push({ id: 'single-font', snippet: `only font used is ${[...fonts][0]}` });
    }
  }

  // Flat type hierarchy
  const sizes = new Set();
  const textEls = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button, div');
  for (const el of textEls) {
    const fontSize = parseFloat(win.getComputedStyle(el).fontSize);
    // Filter out sub-8px values (jsdom doesn't resolve relative units properly)
    if (fontSize >= 8 && fontSize < 200) sizes.add(Math.round(fontSize * 10) / 10);
  }
  if (sizes.size >= 3) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio < 2.0) {
      findings.push({ id: 'flat-type-hierarchy', snippet: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }
  }

  return findings;
}

function isCardLike(el, win) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag) || ['input', 'select', 'textarea', 'img', 'video', 'canvas', 'picture'].includes(tag)) return false;

  const style = win.getComputedStyle(el);
  const rawStyle = el.getAttribute?.('style') || '';
  const cls = el.getAttribute?.('class') || '';

  const hasShadow = (style.boxShadow && style.boxShadow !== 'none') ||
    /\bshadow(?:-sm|-md|-lg|-xl|-2xl)?\b/.test(cls) || /box-shadow/i.test(rawStyle);
  const hasBorder = /\bborder\b/.test(cls);
  const widthPx = parseFloat(style.width) || 0;
  const hasRadius = resolveBorderRadiusPx(el, style, widthPx, win) > 0 ||
    /\brounded(?:-sm|-md|-lg|-xl|-2xl|-full)?\b/.test(cls) || /border-radius/i.test(rawStyle);
  const hasBg = /\bbg-(?:white|gray-\d+|slate-\d+)\b/.test(cls) ||
    /background(?:-color)?\s*:\s*(?!transparent)/i.test(rawStyle);

  return isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg);
}

function checkPageLayout(doc, win) {
  const findings = [];

  // Nested cards
  const allEls = doc.querySelectorAll('*');
  const flaggedEls = new Set();
  for (const el of allEls) {
    if (!isCardLike(el, win)) continue;
    if (flaggedEls.has(el)) continue;

    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute?.('class') || '';
    const rawStyle = el.getAttribute?.('style') || '';

    if (['pre', 'code'].includes(tag)) continue;
    if (/\b(?:absolute|fixed)\b/.test(cls) || /position\s*:\s*(?:absolute|fixed)/i.test(rawStyle)) continue;
    if ((el.textContent?.trim().length || 0) < 10) continue;
    if (/\b(?:dropdown|popover|tooltip|menu|modal|dialog)\b/i.test(cls)) continue;

    // Walk up to find card-like ancestor
    let parent = el.parentElement;
    while (parent) {
      if (isCardLike(parent, win)) {
        flaggedEls.add(el);
        break;
      }
      parent = parent.parentElement;
    }
  }

  // Only report innermost nested cards
  for (const el of flaggedEls) {
    let isAncestorOfFlagged = false;
    for (const other of flaggedEls) {
      if (other !== el && el.contains(other)) {
        isAncestorOfFlagged = true;
        break;
      }
    }
    if (!isAncestorOfFlagged) {
      findings.push({ id: 'nested-cards', snippet: `Card inside card (${el.tagName.toLowerCase()})` });
    }
  }

  // Everything centered
  const textEls = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, div, button');
  let centeredCount = 0;
  let totalText = 0;
  for (const el of textEls) {
    const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length >= 3);
    if (!hasDirectText) continue;
    totalText++;

    let cur = el;
    let isCentered = false;
    while (cur && cur.nodeType === 1) {
      const rawStyle = cur.getAttribute?.('style') || '';
      const cls = cur.getAttribute?.('class') || '';
      if (/text-align\s*:\s*center/i.test(rawStyle) || /\btext-center\b/.test(cls)) {
        isCentered = true;
        break;
      }
      if (cur.tagName === 'BODY') break;
      cur = cur.parentElement;
    }
    if (isCentered) centeredCount++;
  }

  if (totalText >= 5 && centeredCount / totalText > 0.7) {
    findings.push({
      id: 'everything-centered',
      snippet: `${centeredCount}/${totalText} text elements centered (${Math.round(centeredCount / totalText * 100)}%)`,
    });
  }

  return findings;
}

// ─── Section 7: Browser UI (IS_BROWSER only) ────────────────────────────────

if (IS_BROWSER) {
  // Detect extension mode via the script tag's data attribute or the document element fallback.
  // currentScript is reliable for synchronously-executing scripts (which our IIFE is).
  const _myScript = document.currentScript;
  const EXTENSION_MODE = (_myScript && _myScript.dataset.impeccableExtension === 'true')
    || document.documentElement.dataset.impeccableExtension === 'true';

  const BRAND_COLOR = 'oklch(55% 0.25 350)';
  const BRAND_COLOR_HOVER = 'oklch(45% 0.25 350)';
  const LABEL_BG = BRAND_COLOR;
  const OUTLINE_COLOR = BRAND_COLOR;

  // Inject hover styles via CSS (more reliable than JS event listeners)
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes impeccable-reveal {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .impeccable-overlay:not(.impeccable-banner) {
      pointer-events: none;
      outline: 2px solid ${OUTLINE_COLOR};
      border-radius: 4px;
      transition: outline-color 0.15s ease;
      animation: impeccable-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
      animation-play-state: paused;
      border-top-left-radius: 0;
    }
    .impeccable-overlay.impeccable-visible {
      animation-play-state: running;
    }
    .impeccable-overlay.impeccable-hover {
      outline-color: ${BRAND_COLOR_HOVER};
      z-index: 100001 !important;
    }
    .impeccable-overlay.impeccable-hover .impeccable-label {
      background: ${BRAND_COLOR_HOVER};
    }
    .impeccable-overlay.impeccable-spotlight {
      z-index: 100002 !important;
    }
    .impeccable-overlay.impeccable-spotlight-dimmed {
      opacity: 0.15 !important;
      animation: none !important;
      filter: blur(3px);
    }
    .impeccable-spotlight-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      backdrop-filter: blur(3px) brightness(0.6);
      -webkit-backdrop-filter: blur(3px) brightness(0.6);
      pointer-events: none;
      z-index: 99998;
      opacity: 0;
      outline: none !important;
      animation: none !important;
    }
    .impeccable-spotlight-backdrop.impeccable-visible {
      opacity: 1;
    }
    .impeccable-hidden .impeccable-overlay${EXTENSION_MODE ? '' : ':not(.impeccable-banner)'} {
      display: none !important;
    }
    .impeccable-hidden .impeccable-overlay${EXTENSION_MODE ? '' : ':not(.impeccable-banner)'} {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(styleEl);

  // Spotlight backdrop element (created lazily on first use)
  let spotlightBackdrop = null;
  let spotlightTarget = null;
  let spotlightTimer = null;

  function getSpotlightBackdrop() {
    if (!spotlightBackdrop) {
      spotlightBackdrop = document.createElement('div');
      spotlightBackdrop.className = 'impeccable-spotlight-backdrop';
      document.body.appendChild(spotlightBackdrop);
    }
    return spotlightBackdrop;
  }

  function updateSpotlightClipPath() {
    if (!spotlightBackdrop || !spotlightTarget) return;
    const r = spotlightTarget.getBoundingClientRect();
    // Match the overlay's outer edge: element rect + 4px (2px overlay offset + 2px outline width)
    const inset = 4;
    const radius = 6; // outline border-radius (4) + outline width (2)
    const x1 = r.left - inset;
    const y1 = r.top - inset;
    const x2 = r.right + inset;
    const y2 = r.bottom + inset;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Outer rect + rounded inner rect (evenodd creates a hole)
    const path = `M0 0H${vw}V${vh}H0Z M${x1 + radius} ${y1}H${x2 - radius}A${radius} ${radius} 0 0 1 ${x2} ${y1 + radius}V${y2 - radius}A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}H${x1 + radius}A${radius} ${radius} 0 0 1 ${x1} ${y2 - radius}V${y1 + radius}A${radius} ${radius} 0 0 1 ${x1 + radius} ${y1}Z`;
    spotlightBackdrop.style.clipPath = `path(evenodd, "${path}")`;
  }

  function showSpotlight(target) {
    if (!target || !target.getBoundingClientRect) return;
    // Respect the spotlightBlur setting: if disabled, don't show the backdrop
    if (window.__IMPECCABLE_CONFIG__?.spotlightBlur === false) {
      spotlightTarget = target;
      return;
    }
    spotlightTarget = target;
    const bd = getSpotlightBackdrop();
    updateSpotlightClipPath();
    bd.classList.add('impeccable-visible');
  }

  function hideSpotlight() {
    spotlightTarget = null;
    if (spotlightTimer) { clearTimeout(spotlightTimer); spotlightTimer = null; }
    if (spotlightBackdrop) spotlightBackdrop.classList.remove('impeccable-visible');
  }

  function isInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  }

  // Reposition spotlight on scroll/resize
  window.addEventListener('scroll', () => {
    if (spotlightTarget) updateSpotlightClipPath();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (spotlightTarget) updateSpotlightClipPath();
  });

  const overlays = [];
  const TYPE_LABELS = {};
  const RULE_CATEGORY = {};
  for (const ap of ANTIPATTERNS) {
    TYPE_LABELS[ap.id] = ap.name.toLowerCase();
    RULE_CATEGORY[ap.id] = ap.category || 'quality';
  }

  function isInFixedContext(el) {
    let p = el;
    while (p && p !== document.body) {
      if (getComputedStyle(p).position === 'fixed') return true;
      p = p.parentElement;
    }
    return false;
  }

  function positionOverlay(overlay) {
    const el = overlay._targetEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (overlay._isFixed) {
      // Viewport-relative coords for fixed targets
      overlay.style.top = `${rect.top - 2}px`;
      overlay.style.left = `${rect.left - 2}px`;
    } else {
      // Document-relative coords for normal targets
      overlay.style.top = `${rect.top + scrollY - 2}px`;
      overlay.style.left = `${rect.left + scrollX - 2}px`;
    }
    overlay.style.width = `${rect.width + 4}px`;
    overlay.style.height = `${rect.height + 4}px`;
  }

  function repositionOverlays() {
    for (const o of overlays) {
      if (!o._targetEl || o.classList.contains('impeccable-banner')) continue;
      // Skip overlays whose target is currently hidden (display: none on the overlay)
      if (o.style.display === 'none') continue;
      positionOverlay(o);
    }
  }

  let resizeRAF;
  const onResize = () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(repositionOverlays);
  };
  window.addEventListener('resize', onResize);
  // Reposition on scroll too -- catches sticky/parallax shifts
  window.addEventListener('scroll', onResize, { passive: true });
  // Reposition when body resizes (lazy-loaded images, dynamic content, fonts loading)
  if (typeof ResizeObserver !== 'undefined') {
    const bodyResizeObserver = new ResizeObserver(onResize);
    bodyResizeObserver.observe(document.body);
  }

  // Track target element visibility via IntersectionObserver.
  // Uses a huge rootMargin so all *rendered* elements count as intersecting,
  // while display:none / closed <details> / hidden modals etc. do not.
  // This is event-driven -- no polling needed.
  let overlayIndex = 0;
  const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const overlay = entry.target._impeccableOverlay;
      if (!overlay) continue;
      if (entry.isIntersecting) {
        overlay.style.display = '';
        positionOverlay(overlay);
        if (!overlay._revealed) {
          overlay._revealed = true;
          if (firstScanDone) {
            // Subsequent reveals (re-scans, scroll-into-view): instant, no animation
            overlay.style.animation = 'none';
          } else {
            // Initial scan: staggered cascade reveal
            overlay.style.animationDelay = `${Math.min((overlay._staggerIndex || 0) * 60, 600)}ms`;
          }
          requestAnimationFrame(() => {
            overlay.classList.add('impeccable-visible');
            if (overlay._checkLabel) overlay._checkLabel();
          });
        }
      } else {
        overlay.style.display = 'none';
      }
    }
  }, { rootMargin: '99999px' });

  // Reposition overlays after CSS transitions end (e.g. reveal animations).
  // Listens at document level so it catches transitions on ancestor elements
  // (the transform may be on a parent, not the flagged element itself).
  document.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'transform') return;
    for (const o of overlays) {
      if (!o._targetEl || o.classList.contains('impeccable-banner') || o.style.display === 'none') continue;
      if (e.target === o._targetEl || e.target.contains(o._targetEl)) {
        positionOverlay(o);
      }
    }
  });

  const highlight = function(el, findings) {
    const hasSlop = findings.some(f => RULE_CATEGORY[f.type || f.id] === 'slop');

    const fixed = isInFixedContext(el);
    const rect = el.getBoundingClientRect();
    const outline = document.createElement('div');
    outline.className = 'impeccable-overlay';
    outline._targetEl = el;
    outline._isFixed = fixed;
    Object.assign(outline.style, {
      position: fixed ? 'fixed' : 'absolute',
      top: fixed ? `${rect.top - 2}px` : `${rect.top + scrollY - 2}px`,
      left: fixed ? `${rect.left - 2}px` : `${rect.left + scrollX - 2}px`,
      width: `${rect.width + 4}px`, height: `${rect.height + 4}px`,
      zIndex: '99999', boxSizing: 'border-box',
    });

    // Build per-finding label entries: ✦ prefix for slop
    const entries = findings.map(f => {
      const name = TYPE_LABELS[f.type || f.id] || f.type || f.id;
      const prefix = RULE_CATEGORY[f.type || f.id] === 'slop' ? '\u2726 ' : '';
      return { name: prefix + name, detail: f.detail || f.snippet };
    });
    const allText = entries.map(e => e.name).join(', ');

    const label = document.createElement('div');
    label.className = 'impeccable-label';
    Object.assign(label.style, {
      position: 'absolute', bottom: '100%', left: '-2px',
      display: 'flex', alignItems: 'center',
      whiteSpace: 'nowrap',
      fontSize: '11px', fontWeight: '600', letterSpacing: '0.02em',
      color: 'white', lineHeight: '14px',
      background: LABEL_BG,
      fontFamily: 'system-ui, sans-serif',
      borderRadius: '4px 4px 0 0',
    });

    const textSpan = document.createElement('span');
    textSpan.style.padding = '3px 8px';
    textSpan.textContent = allText;
    label.appendChild(textSpan);

    // State for cycling mode
    let cycleMode = false;
    let cycleIndex = 0;
    let isHovered = false;
    let prevBtn, nextBtn;

    function updateCycleText() {
      const e = entries[cycleIndex];
      textSpan.textContent = isHovered ? e.detail : e.name;
    }

    function enableCycleMode() {
      if (cycleMode || entries.length < 2) return;
      cycleMode = true;

      const btnStyle = {
        background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
        fontSize: '11px', cursor: 'pointer', padding: '3px 4px',
        fontFamily: 'system-ui, sans-serif', lineHeight: '14px',
        pointerEvents: 'auto',
      };

      const navGroup = document.createElement('span');
      Object.assign(navGroup.style, {
        display: 'inline-flex', alignItems: 'center', flexShrink: '0',
      });

      prevBtn = document.createElement('button');
      prevBtn.textContent = '\u2039';
      Object.assign(prevBtn.style, btnStyle);
      prevBtn.style.paddingLeft = '6px';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleIndex = (cycleIndex - 1 + entries.length) % entries.length;
        updateCycleText();
      });

      nextBtn = document.createElement('button');
      nextBtn.textContent = '\u203A';
      Object.assign(nextBtn.style, btnStyle);
      nextBtn.style.paddingRight = '2px';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleIndex = (cycleIndex + 1) % entries.length;
        updateCycleText();
      });

      navGroup.appendChild(prevBtn);
      navGroup.appendChild(nextBtn);
      label.insertBefore(navGroup, textSpan);
      textSpan.style.padding = '3px 8px 3px 4px';
      updateCycleText();
    }

    outline.appendChild(label);

    // Start hidden; the IntersectionObserver will show it once the target is rendered
    outline.style.display = 'none';
    outline._staggerIndex = overlayIndex++;
    el._impeccableOverlay = outline;
    visibilityObserver.observe(el);

    // After first paint, check label width vs outline
    outline._checkLabel = () => {
      if (entries.length > 1 && label.offsetWidth > outline.offsetWidth) {
        enableCycleMode();
      }
    };

    // Hover: show detail text, darken
    el.addEventListener('mouseenter', () => {
      isHovered = true;
      outline.classList.add('impeccable-hover');
      outline.style.outlineColor = BRAND_COLOR_HOVER;
      label.style.background = BRAND_COLOR_HOVER;
      if (cycleMode) {
        updateCycleText();
      } else {
        textSpan.textContent = entries.map(e => e.detail).join(' | ');
      }
    });
    el.addEventListener('mouseleave', () => {
      isHovered = false;
      outline.classList.remove('impeccable-hover');
      outline.style.outlineColor = '';
      label.style.background = LABEL_BG;
      if (cycleMode) {
        updateCycleText();
      } else {
        textSpan.textContent = allText;
      }
    });

    document.body.appendChild(outline);
    overlays.push(outline);
  };

  const showPageBanner = function(findings) {
    if (!findings.length) return;
    const banner = document.createElement('div');
    banner.className = 'impeccable-overlay impeccable-banner';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '100000',
      background: LABEL_BG, color: 'white',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      display: 'flex', alignItems: 'center', pointerEvents: 'auto',
      height: '36px', overflow: 'hidden', maxWidth: '100vw',
      transform: 'translateY(-100%)',
      transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
    }));

    // Scrollable findings area
    const scrollArea = document.createElement('div');
    Object.assign(scrollArea.style, {
      flex: '1', minWidth: '0', overflowX: 'auto', overflowY: 'hidden',
      display: 'flex', gap: '8px', alignItems: 'center',
      padding: '0 12px', scrollSnapType: 'x mandatory',
      scrollbarWidth: 'none',
    });
    for (const f of findings) {
      const prefix = RULE_CATEGORY[f.type] === 'slop' ? '\u2726 ' : '';
      const tag = document.createElement('span');
      tag.textContent = `${prefix}${TYPE_LABELS[f.type] || f.type}: ${f.detail}`;
      Object.assign(tag.style, {
        background: 'rgba(255,255,255,0.15)', padding: '2px 8px',
        borderRadius: '3px', fontSize: '12px', fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap', flexShrink: '0', scrollSnapAlign: 'start',
      });
      scrollArea.appendChild(tag);
    }
    banner.appendChild(scrollArea);

    // Controls area (only in standalone mode, not extension)
    if (!EXTENSION_MODE) {
      const controls = document.createElement('div');
      Object.assign(controls.style, {
        display: 'flex', alignItems: 'center', gap: '2px',
        padding: '0 8px', flexShrink: '0',
      });

      // Toggle visibility button
      const toggle = document.createElement('button');
      toggle.textContent = '\u25C9'; // circle with dot (visible state)
      toggle.title = 'Toggle overlay visibility';
      Object.assign(toggle.style, {
        background: 'none', border: 'none',
        color: 'white', fontSize: '16px', cursor: 'pointer', padding: '0 4px',
        opacity: '0.85', transition: 'opacity 0.15s',
      });
      let overlaysVisible = true;
      toggle.addEventListener('click', () => {
        overlaysVisible = !overlaysVisible;
        document.body.classList.toggle('impeccable-hidden', !overlaysVisible);
        toggle.textContent = overlaysVisible ? '\u25C9' : '\u25CB'; // filled vs empty circle
        toggle.style.opacity = overlaysVisible ? '0.85' : '0.5';
      });
      controls.appendChild(toggle);

      // Close button
      const close = document.createElement('button');
      close.textContent = '\u00d7';
      close.title = 'Dismiss banner';
      Object.assign(close.style, {
        background: 'none', border: 'none',
        color: 'white', fontSize: '18px', cursor: 'pointer', padding: '0 4px',
      });
      close.addEventListener('click', () => banner.remove());
      controls.appendChild(close);

      banner.appendChild(controls);
    }
    document.body.appendChild(banner);
    overlays.push(banner);
  };

  // Heuristic for skipping CSS-in-JS hashed class names like "css-1a2b3c" or "_2x4hG_".
  // These change between builds and produce brittle, ugly selectors.
  function isLikelyHashedClass(c) {
    if (!c) return true;
    if (/^(css|sc|emotion|jsx|module)-[\w-]{4,}$/i.test(c)) return true;
    if (/^_[\w-]{5,}$/.test(c)) return true;
    if (/^[a-z0-9]{6,}$/i.test(c) && /\d/.test(c)) return true;
    return false;
  }

  function buildSelectorSegment(el) {
    const tag = el.tagName.toLowerCase();
    let sel = tag;

    if (el.classList && el.classList.length > 0) {
      const classes = [...el.classList]
        .filter(c => !c.startsWith('impeccable-') && !isLikelyHashedClass(c))
        .slice(0, 2);
      if (classes.length > 0) {
        sel += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }

    // Disambiguate among siblings only if the parent has multiple matches
    const parent = el.parentElement;
    if (parent) {
      try {
        const matching = parent.querySelectorAll(':scope > ' + sel);
        if (matching.length > 1) {
          const sameType = [...parent.children].filter(c => c.tagName === el.tagName);
          const idx = sameType.indexOf(el) + 1;
          sel += `:nth-of-type(${idx})`;
        }
      } catch {
        const idx = [...parent.children].indexOf(el) + 1;
        sel = `${tag}:nth-child(${idx})`;
      }
    }
    return sel;
  }

  function generateSelector(el) {
    if (el === document.body) return 'body';
    if (el === document.documentElement) return 'html';
    if (el.id) return '#' + CSS.escape(el.id);

    const parts = [];
    let current = el;
    let depth = 0;
    const MAX_DEPTH = 10;

    while (current && current !== document.body && current !== document.documentElement && depth < MAX_DEPTH) {
      parts.unshift(buildSelectorSegment(current));

      // Anchor on an ancestor's ID and stop walking up
      if (current.id) {
        parts[0] = '#' + CSS.escape(current.id);
        break;
      }

      // Stop as soon as the partial selector uniquely identifies the target
      const trySelector = parts.join(' > ');
      try {
        const matches = document.querySelectorAll(trySelector);
        if (matches.length === 1 && matches[0] === el) {
          return trySelector;
        }
      } catch { /* invalid selector — keep walking */ }

      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  function isElementHidden(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (typeof el.checkVisibility === 'function') return !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    // Fallback: zero size or no offsetParent (covers display:none and detached subtrees)
    return el.offsetWidth === 0 && el.offsetHeight === 0;
  }

  function serializeFindings(allFindings) {
    return allFindings.map(({ el, findings }) => ({
      selector: generateSelector(el),
      tagName: el.tagName?.toLowerCase() || 'unknown',
      rect: (el !== document.body && el !== document.documentElement && el.getBoundingClientRect)
        ? el.getBoundingClientRect().toJSON() : null,
      isPageLevel: el === document.body || el === document.documentElement,
      isHidden: isElementHidden(el),
      findings: findings.map(f => {
        const ap = ANTIPATTERNS.find(a => a.id === (f.type || f.id));
        return {
          type: f.type || f.id,
          category: ap ? ap.category : 'quality',
          detail: f.detail || f.snippet,
          name: ap ? ap.name : (f.type || f.id),
          description: ap ? ap.description : '',
        };
      }),
    }));
  }

  const printSummary = function(allFindings) {
    if (allFindings.length === 0) {
      console.log('%c[impeccable] No anti-patterns found.', 'color: #22c55e; font-weight: bold');
      return;
    }
    console.group(
      `%c[impeccable] ${allFindings.length} anti-pattern${allFindings.length === 1 ? '' : 's'} found`,
      'color: oklch(60% 0.25 350); font-weight: bold'
    );
    for (const { el, findings } of allFindings) {
      for (const f of findings) {
        console.log(`%c${f.type || f.id}%c ${f.detail || f.snippet}`,
          'color: oklch(55% 0.25 350); font-weight: bold', 'color: inherit', el);
      }
    }
    console.groupEnd();
  };

  let firstScanDone = false;
  const scan = function() {
    for (const o of overlays) o.remove();
    overlays.length = 0;
    visibilityObserver.disconnect();
    overlayIndex = 0;
    const allFindings = [];
    const _disabled = EXTENSION_MODE ? (window.__IMPECCABLE_CONFIG__?.disabledRules || []) : [];
    const _ruleOk = (id) => !_disabled.length || !_disabled.includes(id);

    for (const el of document.querySelectorAll('*')) {
      // Skip impeccable's own elements and any descendants (overlays, labels, banner, nav buttons)
      if (el.closest('.impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip')) continue;
      // Skip browser extension elements (Claude, etc.)
      const elId = el.id || '';
      if (elId.startsWith('claude-') || elId.startsWith('cic-')) continue;
      // Skip the impeccable live-mode overlay (highlight, tooltip, bar, picker, toast).
      // These are inspector chrome, not part of the user's design.
      if (el.closest('[id^="impeccable-live-"]')) continue;
      // Skip html/body -- page-level findings go in the banner, not a full-page overlay
      if (el === document.body || el === document.documentElement) continue;

      const findings = [
        ...checkElementBordersDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementColorsDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementMotionDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementGlowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementAIPaletteDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementIconTileDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementItalicSerifDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementHeroEyebrowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementQualityDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
      ].filter(f => _ruleOk(f.type));

      if (findings.length > 0) {
        highlight(el, findings);
        allFindings.push({ el, findings });
      }
    }

    const pageLevelFindings = [];

    const typoFindings = checkTypography().filter(f => _ruleOk(f.type));
    if (typoFindings.length > 0) {
      pageLevelFindings.push(...typoFindings);
      allFindings.push({ el: document.body, findings: typoFindings });
    }

    const layoutFindings = checkLayout().filter(f => _ruleOk(f.type));
    for (const f of layoutFindings) {
      const el = f.el || document.body;
      delete f.el;
      // Merge into existing overlay if this element already has one
      const existing = el._impeccableOverlay;
      if (existing) {
        const nameRow = existing.querySelector('.impeccable-label-name');
        const detailRow = existing.querySelector('.impeccable-label-detail');
        const newType = TYPE_LABELS[f.type] || f.type;
        if (nameRow) nameRow.textContent += ', ' + newType;
        if (detailRow) detailRow.textContent += ' | ' + (f.detail || '');
      } else {
        highlight(el, [f]);
      }
      allFindings.push({ el, findings: [f] });
    }

    // Page-level quality checks (headings, etc.)
    const qualityFindings = checkPageQualityDOM().filter(f => _ruleOk(f.type));
    if (qualityFindings.length > 0) {
      pageLevelFindings.push(...qualityFindings);
      allFindings.push({ el: document.body, findings: qualityFindings });
    }

    // Regex-on-HTML checks (shared with Node)
    // Clone the document and strip impeccable-live overlay nodes before the
    // regex scan, so the inspector's own inline styles (transitions on top/
    // left/width/height, etc.) don't register as page anti-patterns.
    const docClone = document.documentElement.cloneNode(true);
    for (const node of docClone.querySelectorAll('[id^="impeccable-live-"]')) {
      node.remove();
    }
    const htmlPatternFindings = checkHtmlPatterns(docClone.outerHTML);
    if (htmlPatternFindings.length > 0) {
      const mapped = htmlPatternFindings.map(f => ({ type: f.id, detail: f.snippet })).filter(f => _ruleOk(f.type));
      pageLevelFindings.push(...mapped);
      allFindings.push({ el: document.body, findings: mapped });
    }

    if (pageLevelFindings.length > 0) {
      showPageBanner(pageLevelFindings);
    }

    if (!EXTENSION_MODE) printSummary(allFindings);

    // In extension mode, post serialized results for the DevTools panel
    if (EXTENSION_MODE) {
      window.postMessage({
        source: 'impeccable-results',
        findings: serializeFindings(allFindings),
        count: allFindings.length,
      }, '*');
    }

    // After this scan completes, all subsequent reveals are instant (no stagger, no animation)
    setTimeout(() => { firstScanDone = true; }, 1000);

    return allFindings;
  };

  if (EXTENSION_MODE) {
    // Extension mode: listen for commands, don't auto-scan
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.source !== 'impeccable-command') return;
      if (e.data.action === 'scan') {
        if (e.data.config) window.__IMPECCABLE_CONFIG__ = e.data.config;
        scan();
      }
      if (e.data.action === 'toggle-overlays') {
        const visible = !document.body.classList.contains('impeccable-hidden');
        document.body.classList.toggle('impeccable-hidden', visible);
        window.postMessage({ source: 'impeccable-overlays-toggled', visible: !visible }, '*');
      }
      if (e.data.action === 'remove') {
        for (const o of overlays) o.remove();
        overlays.length = 0;
        visibilityObserver.disconnect();
        styleEl.remove();
        if (spotlightBackdrop) { spotlightBackdrop.remove(); spotlightBackdrop = null; }
        document.body.classList.remove('impeccable-hidden');
      }
      if (e.data.action === 'highlight') {
        if (spotlightTimer) { clearTimeout(spotlightTimer); spotlightTimer = null; }
        try {
          const target = e.data.selector ? document.querySelector(e.data.selector) : null;
          if (target) {
            // Scroll first so positionOverlay reads the post-scroll rect
            if (!isInViewport(target) && target.scrollIntoView) {
              target.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
            for (const o of overlays) {
              if (o.classList.contains('impeccable-banner')) continue;
              const isMatch = o._targetEl === target;
              o.classList.toggle('impeccable-spotlight', isMatch);
              o.classList.toggle('impeccable-spotlight-dimmed', !isMatch);
              if (isMatch) {
                // Force the matching overlay visible immediately, don't wait for IntersectionObserver
                o.style.display = '';
                o.style.animation = 'none';
                o.classList.add('impeccable-visible');
                o._revealed = true;
                positionOverlay(o);
              }
            }
            showSpotlight(target);
          }
        } catch { /* invalid selector */ }
      }
      if (e.data.action === 'unhighlight') {
        hideSpotlight();
        for (const o of overlays) {
          o.classList.remove('impeccable-spotlight');
          o.classList.remove('impeccable-spotlight-dimmed');
        }
      }
    });
    window.postMessage({ source: 'impeccable-ready' }, '*');
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 100));
    } else {
      setTimeout(scan, 100);
    }
  }

  window.impeccableScan = scan;
}

// ─── Section 8: Node Engine ─────────────────────────────────────────────────
// @browser-strip-start

function getAP(id) {
  return ANTIPATTERNS.find(a => a.id === id);
}

function finding(id, filePath, snippet, line = 0) {
  const ap = getAP(id);
  return { antipattern: id, name: ap.name, description: ap.description, file: filePath, line, snippet };
}

/** Check if content looks like a full page (not a component/partial) */
function isFullPage(content) {
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  return /<!doctype\s|<html[\s>]|<head[\s>]/i.test(stripped);
}

// ---------------------------------------------------------------------------
// jsdom CSS-variable border override map
// ---------------------------------------------------------------------------
//
// jsdom's CSSOM silently drops any border shorthand that contains a var()
// reference — the computed style for the element then shows empty width,
// empty style, and a default black color. That's enough to hide the most
// common real-world side-tab pattern in AI-generated pages:
//
//   :root { --brand: #87a8ff; }
//   .card { border-left: 5px solid var(--brand); border-radius: 4px; }
//
// Real browsers (and therefore the browser detector path) resolve var()
// natively, so this only affects the Node jsdom path.
//
// This pre-pass walks the stylesheets, finds any rule whose per-side or
// all-sides border property contains var(), resolves the var() against
// :root-level custom properties (read from the documentElement's computed
// style, which jsdom DOES handle correctly), and attaches the resolved
// width+color to every element that matches the rule's selector. The
// Node-side `checkElementBorders` adapter consumes that map as a fallback
// whenever jsdom's computed style came back empty.
//
// Limitations (intentional, to keep the pass simple):
//   * Only :root-level custom properties are resolved. Scoped overrides on
//     descendants are not tracked — uncommon in practice and would require
//     a per-element cascade walk.
//   * @media / @supports wrapped rules are ignored (jsdom often mishandles
//     these anyway).
//   * The fallback only fills sides that jsdom left empty, so any rule
//     whose border parses normally still wins via the computed style.

const BORDER_SHORTHAND_RE = /^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double|groove|ridge|inset|outset)\s+(.+)$/i;

// isNeutralColor only understands rgba()/oklch()/lch()/lab()/hsl()/hwb().
// CSS variables typically hold hex or named colors, so normalize those to
// rgb() before handing the value off to the shared check. Anything we don't
// recognise is passed through unchanged — isNeutralColor then treats it as
// non-neutral, which is the safer default (matches the oklch-era bugfix).
const NAMED_COLORS = {
  white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128],
  grey: [128, 128, 128], silver: [192, 192, 192], red: [255, 0, 0],
  green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
};

function normalizeColorForCheck(value) {
  if (!value) return value;
  const v = value.trim();
  const hex6 = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex6) {
    const [r, g, b] = [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];
    return `rgb(${r}, ${g}, ${b})`;
  }
  const hex3 = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3) {
    const [r, g, b] = [
      parseInt(hex3[1] + hex3[1], 16),
      parseInt(hex3[2] + hex3[2], 16),
      parseInt(hex3[3] + hex3[3], 16),
    ];
    return `rgb(${r}, ${g}, ${b})`;
  }
  const named = NAMED_COLORS[v.toLowerCase()];
  if (named) return `rgb(${named[0]}, ${named[1]}, ${named[2]})`;
  return v;
}

function buildBorderOverrideMap(document, window) {
  const map = new Map();
  const rootStyle = window.getComputedStyle(document.documentElement);

  function resolveVar(value, depth = 0) {
    if (!value || depth > 10 || !value.includes('var(')) return value;
    return value.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)/g,
      (_, name, fallback) => {
        const v = rootStyle.getPropertyValue(name).trim();
        if (v) return resolveVar(v, depth + 1);
        if (fallback) return resolveVar(fallback.trim(), depth + 1);
        return '';
      }
    );
  }

  function parseShorthand(text) {
    const m = text.trim().match(BORDER_SHORTHAND_RE);
    if (!m) return null;
    return { width: parseFloat(m[1]), color: normalizeColorForCheck(m[3]) };
  }

  // Read from the per-property accessors on rule.style. jsdom preserves
  // each border-* shorthand it parsed, even when the overall cssText has
  // been truncated (e.g. a `border: 1px solid var(...)` followed by a
  // `border-left: ...` loses the first declaration but keeps the second).
  const SIDE_PROPS = [
    ['borderLeft', 'Left'],
    ['borderRight', 'Right'],
    ['borderTop', 'Top'],
    ['borderBottom', 'Bottom'],
    ['borderInlineStart', 'Left'],
    ['borderInlineEnd', 'Right'],
  ];

  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules || []; } catch { continue; }
    for (const rule of rules) {
      // CSSStyleRule only; skip @media / @keyframes / @supports wrappers.
      if (rule.type !== 1 || !rule.style || !rule.selectorText) continue;

      const perSide = {};

      for (const [prop, side] of SIDE_PROPS) {
        const val = rule.style[prop];
        if (!val || !val.includes('var(')) continue;
        const parsed = parseShorthand(resolveVar(val));
        if (parsed && parsed.color) perSide[side] = parsed;
      }

      // Uniform `border: <w> <style> var(...)` applies to every side the
      // per-side map didn't already claim.
      const borderAll = rule.style.border;
      if (borderAll && borderAll.includes('var(')) {
        const parsed = parseShorthand(resolveVar(borderAll));
        if (parsed && parsed.color) {
          for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
            if (!perSide[s]) perSide[s] = parsed;
          }
        }
      }

      // Longhand `border-*-color: var(...)` with width/style in separate
      // declarations. Rare in AI-generated pages, but cheap to cover.
      for (const [prop, side] of [
        ['borderLeftColor', 'Left'],
        ['borderRightColor', 'Right'],
        ['borderTopColor', 'Top'],
        ['borderBottomColor', 'Bottom'],
      ]) {
        const val = rule.style[prop];
        if (!val || !val.includes('var(')) continue;
        const resolved = resolveVar(val).trim();
        if (!resolved) continue;
        // Width may or may not come from this rule — that's fine; the
        // adapter only substitutes the color when jsdom left it as a
        // literal var() string.
        if (!perSide[side]) perSide[side] = { width: 0, color: normalizeColorForCheck(resolved) };
      }

      if (Object.keys(perSide).length === 0) continue;

      let matched;
      try { matched = document.querySelectorAll(rule.selectorText); }
      catch { continue; }

      for (const el of matched) {
        const existing = map.get(el);
        if (existing) {
          // Later rules overwrite earlier ones — approximates source-order
          // cascade for equal-specificity rules and is good enough for the
          // uncontested var()-dropped sides we're trying to recover.
          Object.assign(existing, perSide);
        } else {
          map.set(el, { ...perSide });
        }
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// jsdom detection (default for HTML files)
// ---------------------------------------------------------------------------

async function detectHtml(filePath) {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    const content = fs.readFileSync(filePath, 'utf-8');
    return detectText(content, filePath);
  }

  const html = fs.readFileSync(filePath, 'utf-8');
  const resolvedPath = path.resolve(filePath);
  const fileDir = path.dirname(resolvedPath);

  // Inline linked local stylesheets so jsdom can see them
  let processedHtml = html;
  const linkRes = [
    /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi,
  ];
  for (const re of linkRes) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      if (/^(https?:)?\/\//.test(href)) continue;
      const cssPath = path.resolve(fileDir, href);
      try {
        const css = fs.readFileSync(cssPath, 'utf-8');
        processedHtml = processedHtml.replace(m[0], `<style>/* ${href} */\n${css}\n</style>`);
      } catch { /* skip unreadable */ }
    }
  }

  const dom = new JSDOM(processedHtml, {
    url: `file://${resolvedPath}`,
  });
  const { window } = dom;
  const { document } = window;

  const findings = [];

  // Pre-pass: recover border declarations that jsdom dropped because they
  // contained a var() reference. The map is keyed by element and consulted
  // by the border check adapter as a fallback.
  const borderOverrides = buildBorderOverrideMap(document, window);

  // Element-level checks (borders + colors + motion)
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const style = window.getComputedStyle(el);
    const resolvedRadius = resolveBorderRadiusPx(el, style, parseFloat(style.width) || 0, window);
    for (const f of checkElementBorders(tag, style, borderOverrides.get(el), resolvedRadius)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementColors(el, style, tag, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementGlow(tag, style, resolveBackground(el.parentElement || el, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementMotion(tag, style)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementIconTile(el, tag, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementItalicSerif(el, style, tag)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementHeroEyebrow(el, style, tag, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementQuality(el, style, tag, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
  }

  // Page-level checks (only for full pages, not partials)
  if (isFullPage(html)) {
    for (const f of checkPageTypography(document, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkPageLayout(document, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkPageQualityFromDoc(document)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkHtmlPatterns(html)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
  }

  window.close();
  return findings;
}

// ---------------------------------------------------------------------------
// Puppeteer detection (for URLs)
// ---------------------------------------------------------------------------

async function detectUrl(url) {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error('puppeteer is required for URL scanning. Install: npm install puppeteer');
  }

  // Read the browser detection script — reuse it instead of reimplementing
  const browserScriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'detect-antipatterns-browser.js'
  );
  let browserScript;
  try {
    browserScript = fs.readFileSync(browserScriptPath, 'utf-8');
  } catch {
    throw new Error(`Browser script not found at ${browserScriptPath}`);
  }

  // CI runners (GitHub Actions Ubuntu) block unprivileged user namespaces, so
  // Chrome can't initialize its sandbox there. Disable the sandbox only when
  // running in CI; local users keep the default hardened launch.
  const launchArgs = process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  const browser = await puppeteer.default.launch({ headless: true, args: launchArgs });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Inject the browser detection script and collect results
  await page.evaluate(browserScript);
  const results = await page.evaluate(() => {
    if (!window.impeccableScan) return [];
    const allFindings = window.impeccableScan();
    return allFindings.flatMap(({ findings }) =>
      findings.map(f => ({ id: f.type, snippet: f.detail }))
    );
  });

  await browser.close();
  return results.map(f => finding(f.id, url, f.snippet));
}

// ---------------------------------------------------------------------------
// Regex fallback (non-HTML files: CSS, JSX, TSX, etc.)
// ---------------------------------------------------------------------------

const hasRounded = (line) => /\brounded(?:-\w+)?\b/.test(line);
const hasBorderRadius = (line) => /border-radius/i.test(line);
const isSafeElement = (line) => /<(?:blockquote|nav[\s>]|pre[\s>]|code[\s>]|a\s|input[\s>]|span[\s>])/i.test(line);

function isNeutralBorderColor(str) {
  const m = str.match(/solid\s+(#[0-9a-f]{3,8}|rgba?\([^)]+\)|\w+)/i);
  if (!m) return false;
  const c = m[1].toLowerCase();
  if (['gray', 'grey', 'silver', 'white', 'black', 'transparent', 'currentcolor'].includes(c)) return true;
  const hex = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (hex) {
    const [r, g, b] = [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
    return (Math.max(r, g, b) - Math.min(r, g, b)) < 30;
  }
  const shex = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (shex) {
    const [r, g, b] = [parseInt(shex[1] + shex[1], 16), parseInt(shex[2] + shex[2], 16), parseInt(shex[3] + shex[3], 16)];
    return (Math.max(r, g, b) - Math.min(r, g, b)) < 30;
  }
  return false;
}

const REGEX_MATCHERS = [
  // --- Side-tab ---
  { id: 'side-tab', regex: /\bborder-[lrse]-(\d+)\b/g,
    test: (m, line) => { const n = +m[1]; return hasRounded(line) ? n >= 1 : n >= 4; },
    fmt: (m) => m[0] },
  { id: 'side-tab', regex: /border-(?:left|right)\s*:\s*(\d+)px\s+solid[^;]*/gi,
    test: (m, line) => { if (isSafeElement(line)) return false; if (isNeutralBorderColor(m[0])) return false; const n = +m[1]; return hasBorderRadius(line) ? n >= 1 : n >= 3; },
    fmt: (m) => m[0].replace(/\s*;?\s*$/, '') },
  { id: 'side-tab', regex: /border-(?:left|right)-width\s*:\s*(\d+)px/gi,
    test: (m, line) => !isSafeElement(line) && +m[1] >= 3,
    fmt: (m) => m[0] },
  { id: 'side-tab', regex: /border-inline-(?:start|end)\s*:\s*(\d+)px\s+solid/gi,
    test: (m, line) => !isSafeElement(line) && +m[1] >= 3,
    fmt: (m) => m[0] },
  { id: 'side-tab', regex: /border-inline-(?:start|end)-width\s*:\s*(\d+)px/gi,
    test: (m, line) => !isSafeElement(line) && +m[1] >= 3,
    fmt: (m) => m[0] },
  { id: 'side-tab', regex: /border(?:Left|Right)\s*[:=]\s*["'`](\d+)px\s+solid/g,
    test: (m) => +m[1] >= 3,
    fmt: (m) => m[0] },
  // --- Border accent on rounded ---
  { id: 'border-accent-on-rounded', regex: /\bborder-[tb]-(\d+)\b/g,
    test: (m, line) => hasRounded(line) && +m[1] >= 1,
    fmt: (m) => m[0] },
  { id: 'border-accent-on-rounded', regex: /border-(?:top|bottom)\s*:\s*(\d+)px\s+solid/gi,
    test: (m, line) => +m[1] >= 3 && hasBorderRadius(line),
    fmt: (m) => m[0] },
  // --- Overused font ---
  { id: 'overused-font', regex: /font-family\s*:\s*['"]?(Inter|Roboto|Open Sans|Lato|Montserrat|Arial|Helvetica|Fraunces|Geist Sans|Geist Mono|Geist|Mona Sans|Plus Jakarta Sans|Space Grotesk|Recoleta|Instrument Sans)\b/gi,
    test: () => true,
    fmt: (m) => m[0] },
  { id: 'overused-font', regex: /fonts\.googleapis\.com\/css2?\?family=(Inter|Roboto|Open\+Sans|Lato|Montserrat|Fraunces|Plus\+Jakarta\+Sans|Space\+Grotesk|Instrument\+Sans|Mona\+Sans|Geist)\b/gi,
    test: () => true,
    fmt: (m) => `Google Fonts: ${m[1].replace(/\+/g, ' ')}` },
  // --- Pure black background ---
  { id: 'pure-black-white', regex: /background(?:-color)?\s*:\s*(#000000|#000|rgb\(0,\s*0,\s*0\))\b/gi,
    test: () => true,
    fmt: (m) => m[0] },
  // --- Gradient text ---
  { id: 'gradient-text', regex: /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/gi,
    test: (m, line) => /gradient/i.test(line),
    fmt: () => 'background-clip: text + gradient' },
  // --- Gradient text (Tailwind) ---
  { id: 'gradient-text', regex: /\bbg-clip-text\b/g,
    test: (m, line) => /\bbg-gradient-to-/i.test(line),
    fmt: () => 'bg-clip-text + bg-gradient' },
  // --- Tailwind pure black background ---
  { id: 'pure-black-white', regex: /\bbg-black\b/g,
    test: () => true,
    fmt: (m) => m[0] },
  // --- Tailwind gray on colored bg ---
  { id: 'gray-on-color', regex: /\btext-(?:gray|slate|zinc|neutral|stone)-(\d+)\b/g,
    test: (m, line) => /\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/.test(line),
    fmt: (m, line) => { const bg = line.match(/\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/); return `${m[0]} on ${bg?.[0] || '?'}`; } },
  // --- Tailwind AI palette ---
  { id: 'ai-color-palette', regex: /\btext-(?:purple|violet|indigo)-(\d+)\b/g,
    test: (m, line) => /\btext-(?:[2-9]xl|[3-9]xl)\b|<h[1-3]/i.test(line),
    fmt: (m) => `${m[0]} on heading` },
  { id: 'ai-color-palette', regex: /\bfrom-(?:purple|violet|indigo)-(\d+)\b/g,
    test: (m, line) => /\bto-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-\d+\b/.test(line),
    fmt: (m) => `${m[0]} gradient` },
  // --- Bounce/elastic easing ---
  { id: 'bounce-easing', regex: /\banimate-bounce\b/g,
    test: () => true,
    fmt: () => 'animate-bounce (Tailwind)' },
  { id: 'bounce-easing', regex: /animation(?:-name)?\s*:\s*[^;]*\b(bounce|elastic|wobble|jiggle|spring)\b/gi,
    test: () => true,
    fmt: (m) => m[0] },
  { id: 'bounce-easing', regex: /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g,
    test: (m) => {
      const y1 = parseFloat(m[2]), y2 = parseFloat(m[4]);
      return y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1;
    },
    fmt: (m) => `cubic-bezier(${m[1]}, ${m[2]}, ${m[3]}, ${m[4]})` },
  // --- Layout property transition ---
  { id: 'layout-transition', regex: /transition\s*:\s*([^;{}]+)/gi,
    test: (m) => {
      const val = m[1].toLowerCase();
      if (/\ball\b/.test(val)) return false;
      return /\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding\b|\bmargin\b/.test(val);
    },
    fmt: (m) => {
      const found = m[1].match(/\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/gi);
      return `transition: ${found ? found.join(', ') : m[1].trim()}`;
    } },
  { id: 'layout-transition', regex: /transition-property\s*:\s*([^;{}]+)/gi,
    test: (m) => {
      const val = m[1].toLowerCase();
      if (/\ball\b/.test(val)) return false;
      return /\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding\b|\bmargin\b/.test(val);
    },
    fmt: (m) => {
      const found = m[1].match(/\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/gi);
      return `transition-property: ${found ? found.join(', ') : m[1].trim()}`;
    } },
];

const REGEX_ANALYZERS = [
  // Single font
  (content, filePath) => {
    const fontFamilyRe = /font-family\s*:\s*([^;}]+)/gi;
    const fonts = new Set();
    let m;
    while ((m = fontFamilyRe.exec(content)) !== null) {
      for (const f of m[1].split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())) {
        if (f && !GENERIC_FONTS.has(f)) fonts.add(f);
      }
    }
    const gfRe = /fonts\.googleapis\.com\/css2?\?family=([^&"'\s]+)/gi;
    while ((m = gfRe.exec(content)) !== null) {
      for (const f of m[1].split('|').map(f => f.split(':')[0].replace(/\+/g, ' ').toLowerCase())) fonts.add(f);
    }
    if (fonts.size !== 1 || content.split('\n').length < 20) return [];
    const name = [...fonts][0];
    const lines = content.split('\n');
    let line = 1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].toLowerCase().includes(name)) { line = i + 1; break; } }
    return [finding('single-font', filePath, `only font used is ${name}`, line)];
  },
  // Flat type hierarchy
  (content, filePath) => {
    const sizes = new Set();
    const REM = 16;
    let m;
    const sizeRe = /font-size\s*:\s*([\d.]+)(px|rem|em)\b/gi;
    while ((m = sizeRe.exec(content)) !== null) {
      const px = m[2] === 'px' ? +m[1] : +m[1] * REM;
      if (px > 0 && px < 200) sizes.add(Math.round(px * 10) / 10);
    }
    const clampRe = /font-size\s*:\s*clamp\(\s*([\d.]+)(px|rem|em)\s*,\s*[^,]+,\s*([\d.]+)(px|rem|em)\s*\)/gi;
    while ((m = clampRe.exec(content)) !== null) {
      sizes.add(Math.round((m[2] === 'px' ? +m[1] : +m[1] * REM) * 10) / 10);
      sizes.add(Math.round((m[4] === 'px' ? +m[3] : +m[3] * REM) * 10) / 10);
    }
    const TW = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20, 'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36, 'text-5xl': 48, 'text-6xl': 60, 'text-7xl': 72, 'text-8xl': 96, 'text-9xl': 128 };
    for (const [cls, px] of Object.entries(TW)) { if (new RegExp(`\\b${cls}\\b`).test(content)) sizes.add(px); }
    if (sizes.size < 3) return [];
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio >= 2.0) return [];
    const lines = content.split('\n');
    let line = 1;
    for (let i = 0; i < lines.length; i++) { if (/font-size/i.test(lines[i]) || /\btext-(?:xs|sm|base|lg|xl|\d)/i.test(lines[i])) { line = i + 1; break; } }
    return [finding('flat-type-hierarchy', filePath, `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)`, line)];
  },
  // Monotonous spacing (regex)
  (content, filePath) => {
    const vals = [];
    let m;
    const pxRe = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(\d+)px/gi;
    while ((m = pxRe.exec(content)) !== null) { const v = +m[1]; if (v > 0 && v < 200) vals.push(v); }
    const remRe = /(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*([\d.]+)rem/gi;
    while ((m = remRe.exec(content)) !== null) { const v = Math.round(parseFloat(m[1]) * 16); if (v > 0 && v < 200) vals.push(v); }
    const gapRe = /gap\s*:\s*(\d+)px/gi;
    while ((m = gapRe.exec(content)) !== null) vals.push(+m[1]);
    const twRe = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)\b/g;
    while ((m = twRe.exec(content)) !== null) vals.push(+m[1] * 4);
    const rounded = vals.map(v => Math.round(v / 4) * 4);
    if (rounded.length < 10) return [];
    const counts = {};
    for (const v of rounded) counts[v] = (counts[v] || 0) + 1;
    const maxCount = Math.max(...Object.values(counts));
    const pct = maxCount / rounded.length;
    const unique = [...new Set(rounded)].filter(v => v > 0);
    if (pct <= 0.6 || unique.length > 3) return [];
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return [finding('monotonous-spacing', filePath, `~${dominant}px used ${maxCount}/${rounded.length} times (${Math.round(pct * 100)}%)`)];
  },
  // Everything centered (regex)
  (content, filePath) => {
    const lines = content.split('\n');
    let centered = 0, total = 0;
    for (const line of lines) {
      if (/<(?:h[1-6]|p|div|li|button)\b[^>]*>/i.test(line) && line.trim().length > 20) {
        total++;
        if (/text-align\s*:\s*center/i.test(line) || /\btext-center\b/.test(line)) centered++;
      }
    }
    if (total < 5 || centered / total <= 0.7) return [];
    return [finding('everything-centered', filePath, `${centered}/${total} text elements centered (${Math.round(centered / total * 100)}%)`)];
  },
  // Dark glow (page-level: dark bg + colored box-shadow with blur)
  (content, filePath) => {
    // Check if page has a dark background
    const darkBgRe = /background(?:-color)?\s*:\s*(?:#(?:0[0-9a-f]|1[0-9a-f]|2[0-3])[0-9a-f]{4}\b|#(?:0|1)[0-9a-f]{2}\b|rgb\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\))/gi;
    const twDarkBg = /\bbg-(?:gray|slate|zinc|neutral|stone)-(?:9\d{2}|800)\b/;
    const hasDarkBg = darkBgRe.test(content) || twDarkBg.test(content);
    if (!hasDarkBg) return [];

    // Check for colored box-shadow with blur > 4px
    const shadowRe = /box-shadow\s*:\s*([^;{}]+)/gi;
    let m;
    while ((m = shadowRe.exec(content)) !== null) {
      const val = m[1];
      const colorMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!colorMatch) continue;
      const [r, g, b] = [+colorMatch[1], +colorMatch[2], +colorMatch[3]];
      if ((Math.max(r, g, b) - Math.min(r, g, b)) < 30) continue; // skip gray
      // Check blur: look for pattern like "0 0 20px" (third number > 4)
      const pxVals = [...val.matchAll(/(\d+)px|(?<![.\d])\b(0)\b(?![.\d])/g)].map(p => +(p[1] || p[2]));
      if (pxVals.length >= 3 && pxVals[2] > 4) {
        const lines = content.substring(0, m.index).split('\n');
        return [finding('dark-glow', filePath, `Colored glow (rgb(${r},${g},${b})) on dark page`, lines.length)];
      }
    }
    return [];
  },
];

// ---------------------------------------------------------------------------
// Style block extraction (Vue/Svelte <style> blocks)
// ---------------------------------------------------------------------------

function extractStyleBlocks(content, ext) {
  ext = ext.toLowerCase();
  if (ext !== '.vue' && ext !== '.svelte') return [];
  const blocks = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.substring(0, m.index);
    const startLine = before.split('\n').length + 1;
    blocks.push({ content: m[1], startLine });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// CSS-in-JS extraction (styled-components, emotion)
// ---------------------------------------------------------------------------

const CSS_IN_JS_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx']);

function extractCSSinJS(content, ext) {
  ext = ext.toLowerCase();
  if (!CSS_IN_JS_EXTENSIONS.has(ext)) return [];
  const blocks = [];
  const re = /(?:styled(?:\.\w+|\([^)]+\))|css)\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.substring(0, m.index);
    const startLine = before.split('\n').length;
    blocks.push({ content: m[1], startLine });
  }
  return blocks;
}

function runRegexMatchers(lines, filePath, lineOffset = 0, blockContext = null) {
  const findings = [];
  for (const matcher of REGEX_MATCHERS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      matcher.regex.lastIndex = 0;
      let m;
      while ((m = matcher.regex.exec(line)) !== null) {
        // For extracted blocks, use nearby lines as context for multi-line CSS patterns
        const context = blockContext
          ? lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' ')
          : line;
        if (matcher.test(m, context)) {
          findings.push(finding(matcher.id, filePath, matcher.fmt(m, context), i + 1 + lineOffset));
        }
      }
    }
  }
  return findings;
}

function detectText(content, filePath) {
  const findings = [];
  const lines = content.split('\n');
  const ext = filePath ? (filePath.match(/\.\w+$/)?.[0] || '').toLowerCase() : '';

  // Run regex matchers on the full file content (catches Tailwind classes, inline styles)
  // Enable block context for CSS files where related properties span multiple lines
  const cssLike = new Set(['.css', '.scss', '.less']);
  findings.push(...runRegexMatchers(lines, filePath, 0, cssLike.has(ext) || null));

  // Extract and scan <style> blocks from Vue/Svelte SFCs
  const styleBlocks = extractStyleBlocks(content, ext);
  for (const block of styleBlocks) {
    const blockLines = block.content.split('\n');
    findings.push(...runRegexMatchers(blockLines, filePath, block.startLine - 1, true));
  }

  // Extract and scan CSS-in-JS template literals
  const cssJsBlocks = extractCSSinJS(content, ext);
  for (const block of cssJsBlocks) {
    const blockLines = block.content.split('\n');
    findings.push(...runRegexMatchers(blockLines, filePath, block.startLine - 1, true));
  }

  // Deduplicate findings (same antipattern + similar snippet, within 2 lines)
  const deduped = [];
  for (const f of findings) {
    const isDupe = deduped.some(d =>
      d.antipattern === f.antipattern &&
      d.snippet === f.snippet &&
      Math.abs(d.line - f.line) <= 2
    );
    if (!isDupe) deduped.push(f);
  }

  // Page-level analyzers only run on full pages
  if (isFullPage(content)) {
    for (const analyzer of REGEX_ANALYZERS) {
      deduped.push(...analyzer(content, filePath));
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '.svelte-kit', '__pycache__', '.turbo', '.vercel',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.scss', '.less',
  '.jsx', '.tsx', '.js', '.ts',
  '.vue', '.svelte', '.astro',
]);

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

function walkDir(dir) {
  const files = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkDir(full));
    else if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatFindings(findings, jsonMode) {
  if (jsonMode) return JSON.stringify(findings, null, 2);

  const grouped = {};
  for (const f of findings) {
    if (!grouped[f.file]) grouped[f.file] = [];
    grouped[f.file].push(f);
  }
  const out = [];
  for (const [file, items] of Object.entries(grouped)) {
    const importNote = items[0]?.importedBy?.length ? ` (imported by ${items[0].importedBy.join(', ')})` : '';
    out.push(`\n${file}${importNote}`);
    for (const item of items) {
      out.push(`  ${item.line ? `line ${item.line}: ` : ''}[${item.antipattern}] ${item.snippet}`);
      out.push(`    → ${item.description}`);
    }
  }
  out.push(`\n${findings.length} anti-pattern${findings.length === 1 ? '' : 's'} found.`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Stdin handling
// ---------------------------------------------------------------------------

async function handleStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks).toString('utf-8');
  try {
    const parsed = JSON.parse(input);
    const fp = parsed?.tool_input?.file_path;
    if (fp && fs.existsSync(fp)) {
      return HTML_EXTENSIONS.has(path.extname(fp).toLowerCase())
        ? detectHtml(fp) : detectText(fs.readFileSync(fp, 'utf-8'), fp);
    }
  } catch { /* not JSON */ }
  return detectText(input, '<stdin>');
}

// ---------------------------------------------------------------------------
// Import graph (multi-file awareness)
// ---------------------------------------------------------------------------

function resolveImport(specifier, fromDir, fileSet) {
  if (!/^[./]/.test(specifier)) return null; // skip bare specifiers
  const base = path.resolve(fromDir, specifier);
  if (fileSet.has(base)) return base;
  for (const ext of SCANNABLE_EXTENSIONS) {
    const withExt = base + ext;
    if (fileSet.has(withExt)) return withExt;
  }
  // index file convention
  for (const ext of SCANNABLE_EXTENSIONS) {
    const indexFile = path.join(base, 'index' + ext);
    if (fileSet.has(indexFile)) return indexFile;
  }
  return null;
}

function buildImportGraph(files) {
  const fileSet = new Set(files);
  const graph = new Map();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const dir = path.dirname(file);
    const imports = new Set();

    // ES imports: import ... from '...' and import '...'
    const esRe = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = esRe.exec(content)) !== null) {
      const resolved = resolveImport(m[1], dir, fileSet);
      if (resolved) imports.add(resolved);
    }

    // CSS @import
    const cssRe = /@import\s+(?:url\(\s*)?['"]?([^'");\s]+)['"]?\s*\)?/g;
    while ((m = cssRe.exec(content)) !== null) {
      const resolved = resolveImport(m[1], dir, fileSet);
      if (resolved) imports.add(resolved);
    }

    // SCSS @use / @forward
    const scssRe = /@(?:use|forward)\s+['"]([^'"]+)['"]/g;
    while ((m = scssRe.exec(content)) !== null) {
      const resolved = resolveImport(m[1], dir, fileSet);
      if (resolved) imports.add(resolved);
    }

    graph.set(file, imports);
  }
  return graph;
}

// ---------------------------------------------------------------------------
// Framework dev server detection
// ---------------------------------------------------------------------------

const FRAMEWORK_CONFIGS = [
  { name: 'Next.js', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], defaultPort: 3000,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-powered-by', value: /next/i } },
  { name: 'SvelteKit', files: ['svelte.config.js', 'svelte.config.ts'], defaultPort: 5173,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-sveltekit-page', value: null } },
  { name: 'Nuxt', files: ['nuxt.config.js', 'nuxt.config.ts'], defaultPort: 3000,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-powered-by', value: /nuxt/i } },
  { name: 'Vite', files: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'], defaultPort: 5173,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { body: /@vite\/client/ } },
  { name: 'Astro', files: ['astro.config.js', 'astro.config.ts', 'astro.config.mjs'], defaultPort: 4321,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { body: /astro/i } },
  { name: 'Angular', files: ['angular.json'], defaultPort: 4200,
    portRe: /"port"\s*:\s*(\d+)/,
    fingerprint: { body: /ng-version/i } },
  { name: 'Remix', files: ['remix.config.js', 'remix.config.ts'], defaultPort: 3000,
    portRe: /port\s*[:=]\s*(\d+)/,
    fingerprint: { header: 'x-powered-by', value: /remix/i } },
];

function detectFrameworkConfig(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const entrySet = new Set(entries);

  for (const cfg of FRAMEWORK_CONFIGS) {
    const match = cfg.files.find(f => entrySet.has(f));
    if (!match) continue;

    const configPath = path.join(dir, match);
    let port = cfg.defaultPort;
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const portMatch = content.match(cfg.portRe);
      if (portMatch) port = parseInt(portMatch[1], 10);
    } catch { /* use default */ }

    return { name: cfg.name, port, configPath, fingerprint: cfg.fingerprint };
  }
  return null;
}

/**
 * Check if a port is listening and optionally verify it matches the expected framework.
 * Returns { listening: true, matched: true/false } or { listening: false }.
 */
async function isPortListening(port, fingerprint = null) {
  if (!fingerprint) {
    // Simple TCP probe fallback
    const net = await import('node:net');
    return new Promise((resolve) => {
      const sock = net.default.createConnection({ port, host: '127.0.0.1' });
      sock.setTimeout(500);
      sock.on('connect', () => { sock.destroy(); resolve({ listening: true, matched: true }); });
      sock.on('error', () => resolve({ listening: false }));
      sock.on('timeout', () => { sock.destroy(); resolve({ listening: false }); });
    });
  }

  // HTTP probe with fingerprint matching
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);

    // Check header fingerprint
    if (fingerprint.header) {
      const val = res.headers.get(fingerprint.header);
      if (val && (!fingerprint.value || fingerprint.value.test(val))) {
        return { listening: true, matched: true };
      }
    }

    // Check body fingerprint
    if (fingerprint.body) {
      const body = await res.text();
      if (fingerprint.body.test(body)) {
        return { listening: true, matched: true };
      }
    }

    // Port is listening but doesn't match the expected framework
    return { listening: true, matched: false };
  } catch {
    return { listening: false };
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function confirm(question) {
  const rl = (await import('node:readline')).default.createInterface({
    input: process.stdin, output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      resolve(!answer || /^y(es)?$/i.test(answer.trim()));
    });
  });
}

function printUsage() {
  console.log(`Usage: impeccable detect [options] [file-or-dir-or-url...]

Scan files or URLs for UI anti-patterns and design quality issues.

Options:
  --fast    Regex-only mode (skip jsdom, faster but misses linked stylesheets)
  --json    Output results as JSON
  --help    Show this help message

Detection modes:
  HTML files     jsdom with computed styles (default, catches linked CSS)
  Non-HTML files Regex pattern matching (CSS, JSX, TSX, etc.)
  URLs           Puppeteer full browser rendering (auto-detected)
  --fast         Forces regex for all files

Examples:
  impeccable detect src/
  impeccable detect index.html
  impeccable detect https://example.com
  impeccable detect --fast --json .`);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const helpMode = args.includes('--help');
  const fastMode = args.includes('--fast');
  const targets = args.filter(a => !a.startsWith('--'));

  if (helpMode) { printUsage(); process.exit(0); }

  let allFindings = [];

  if (!process.stdin.isTTY && targets.length === 0) {
    allFindings = await handleStdin();
  } else {
    const paths = targets.length > 0 ? targets : [process.cwd()];

    for (const target of paths) {
      if (/^https?:\/\//i.test(target)) {
        try { allFindings.push(...await detectUrl(target)); }
        catch (e) { process.stderr.write(`Error: ${e.message}\n`); }
        continue;
      }

      const resolved = path.resolve(target);
      let stat;
      try { stat = fs.statSync(resolved); }
      catch { process.stderr.write(`Warning: cannot access ${target}\n`); continue; }

      if (stat.isDirectory()) {
        // Check for framework dev server config (skip in JSON mode to avoid polluting output)
        if (!jsonMode) {
          const fwConfig = detectFrameworkConfig(resolved);
          if (fwConfig) {
            const probe = await isPortListening(fwConfig.port, fwConfig.fingerprint);
            if (probe.listening && probe.matched) {
              process.stderr.write(
                `\n${fwConfig.name} dev server detected on localhost:${fwConfig.port}.\n` +
                `For more accurate results, scan the running site:\n` +
                `  npx impeccable detect http://localhost:${fwConfig.port}\n\n`
              );
            } else if (probe.listening && !probe.matched) {
              process.stderr.write(
                `\n${fwConfig.name} project detected (${path.basename(fwConfig.configPath)}).\n` +
                `Port ${fwConfig.port} is in use by another service. Start the ${fwConfig.name} dev server and scan via URL for best results.\n\n`
              );
            } else {
              process.stderr.write(
                `\n${fwConfig.name} project detected (${path.basename(fwConfig.configPath)}).\n` +
                `Start the dev server and scan via URL for best results:\n` +
                `  npx impeccable detect http://localhost:${fwConfig.port}\n\n`
              );
            }
          }
        }

        const files = walkDir(resolved);
        const htmlCount = files.filter(f => HTML_EXTENSIONS.has(path.extname(f).toLowerCase())).length;

        // Warn and confirm if scanning many files (jsdom is slow per HTML file)
        if (files.length > 50 && process.stdin.isTTY && !jsonMode) {
          process.stderr.write(
            `\nFound ${files.length} files (${htmlCount} HTML) in ${target}.\n` +
            `Scanning may take a while${htmlCount > 10 ? ' (jsdom processes each HTML file individually)' : ''}.\n` +
            `Use --fast to skip jsdom, or target a specific subdirectory.\n`
          );
          const ok = await confirm('Continue?');
          if (!ok) { process.stderr.write('Aborted.\n'); process.exit(0); }
        }

        // Build import graph for multi-file awareness
        const graph = buildImportGraph(files);
        // Build reverse map: file -> set of files that import it
        const importedByMap = new Map();
        for (const [importer, imports] of graph) {
          for (const imported of imports) {
            if (!importedByMap.has(imported)) importedByMap.set(imported, new Set());
            importedByMap.get(imported).add(importer);
          }
        }

        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          let fileFindings;
          if (!fastMode && HTML_EXTENSIONS.has(ext)) {
            fileFindings = await detectHtml(file);
          } else {
            fileFindings = detectText(fs.readFileSync(file, 'utf-8'), file);
          }
          // Annotate findings with import context
          const importers = importedByMap.get(file);
          if (importers && importers.size > 0) {
            const importerNames = [...importers].map(f => path.basename(f));
            for (const f of fileFindings) {
              f.importedBy = importerNames;
            }
          }
          allFindings.push(...fileFindings);
        }
      } else if (stat.isFile()) {
        const ext = path.extname(resolved).toLowerCase();
        if (!fastMode && HTML_EXTENSIONS.has(ext)) {
          allFindings.push(...await detectHtml(resolved));
        } else {
          allFindings.push(...detectText(fs.readFileSync(resolved, 'utf-8'), resolved));
        }
      }
    }
  }

  if (allFindings.length > 0) {
    process.stderr.write(formatFindings(allFindings, jsonMode) + '\n');
    process.exit(2);
  }
  if (jsonMode) process.stdout.write('[]\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (!IS_BROWSER) {
  const isMainModule = process.argv[1]?.endsWith('detect-antipatterns.mjs') ||
    process.argv[1]?.endsWith('detect-antipatterns.mjs/');
  if (isMainModule) main();
}

// @browser-strip-end

// ─── Section 9: Exports ─────────────────────────────────────────────────────
// @browser-strip-start

export {
  ANTIPATTERNS, SAFE_TAGS, OVERUSED_FONTS, GENERIC_FONTS,
  checkElementBorders, checkElementMotion, checkElementGlow, checkPageTypography, checkPageLayout, isNeutralColor, isFullPage,
  detectHtml, detectUrl, detectText,
  walkDir, formatFindings, SCANNABLE_EXTENSIONS, SKIP_DIRS,
  extractStyleBlocks, extractCSSinJS,
  buildImportGraph, resolveImport,
  detectFrameworkConfig, isPortListening, FRAMEWORK_CONFIGS,
  main as detectCli,
};

// @browser-strip-end
