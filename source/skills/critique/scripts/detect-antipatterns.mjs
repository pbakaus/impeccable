#!/usr/bin/env node

/**
 * Anti-Pattern Detector for Impeccable
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
let fs, path;
if (!IS_BROWSER) {
  fs = (await import('node:fs')).default;
  path = (await import('node:path')).default;
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

const OVERUSED_FONTS = new Set([
  'inter', 'roboto', 'open sans', 'lato', 'montserrat', 'arial', 'helvetica',
]);

const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui',
  'inherit', 'initial', 'unset', 'revert',
]);

const ANTIPATTERNS = [
  {
    id: 'side-tab',
    name: 'Side-tab accent border',
    description:
      'Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.',
  },
  {
    id: 'border-accent-on-rounded',
    name: 'Border accent on rounded element',
    description:
      'Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.',
  },
  {
    id: 'overused-font',
    name: 'Overused font',
    description:
      'Inter, Roboto, Open Sans, Lato, Montserrat, and Arial are used on millions of sites. Choose a distinctive font that gives your interface personality.',
  },
  {
    id: 'single-font',
    name: 'Single font for everything',
    description:
      'Only one font family is used for the entire page. Pair a distinctive display font with a refined body font to create typographic hierarchy.',
  },
  {
    id: 'flat-type-hierarchy',
    name: 'Flat type hierarchy',
    description:
      'Font sizes are too close together — no clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).',
  },
  {
    id: 'pure-black-white',
    name: 'Pure black background',
    description:
      'Pure #000000 as a background color looks harsh and unnatural. Tint it slightly toward your brand hue (e.g., oklch(12% 0.01 250)) for a more refined feel.',
  },
  {
    id: 'gray-on-color',
    name: 'Gray text on colored background',
    description:
      'Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.',
  },
  {
    id: 'low-contrast',
    name: 'Low contrast text',
    description:
      'Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.',
  },
  {
    id: 'gradient-text',
    name: 'Gradient text',
    description:
      'Gradient text is decorative rather than meaningful — a common AI tell, especially on headings and metrics. Use solid colors for text.',
  },
  {
    id: 'ai-color-palette',
    name: 'AI color palette',
    description:
      'Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.',
  },
  {
    id: 'nested-cards',
    name: 'Nested cards',
    description:
      'Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.',
  },
  {
    id: 'monotonous-spacing',
    name: 'Monotonous spacing',
    description:
      'The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.',
  },
  {
    id: 'everything-centered',
    name: 'Everything centered',
    description:
      'Every text element is center-aligned. Left-aligned text with asymmetric layouts feels more designed. Center only hero sections and CTAs.',
  },
  {
    id: 'bounce-easing',
    name: 'Bounce or elastic easing',
    description:
      'Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.',
  },
  {
    id: 'layout-transition',
    name: 'Layout property animation',
    description:
      'Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.',
  },
  {
    id: 'dark-glow',
    name: 'Dark mode with glowing accents',
    description:
      'Dark backgrounds with colored box-shadow glows are the default "cool" look of AI-generated UIs. Use subtle, purposeful lighting instead — or skip the dark theme entirely.',
  },
  {
    id: 'line-length',
    name: 'Line length too long',
    description:
      'Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line. Add a max-width (65ch to 75ch) to text containers.',
  },
  {
    id: 'cramped-padding',
    name: 'Cramped padding',
    description:
      'Text is too close to the edge of its container. Add at least 8px (ideally 12-16px) of padding inside bordered or colored containers.',
  },
  {
    id: 'tight-leading',
    name: 'Tight line height',
    description:
      'Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.',
  },
  {
    id: 'skipped-heading',
    name: 'Skipped heading level',
    description:
      'Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.',
  },
  {
    id: 'justified-text',
    name: 'Justified text',
    description:
      'Justified text without hyphenation creates uneven word spacing ("rivers of white"). Use text-align: left for body text, or enable hyphens: auto if you must justify.',
  },
  {
    id: 'tiny-text',
    name: 'Tiny body text',
    description:
      'Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.',
  },
  {
    id: 'all-caps-body',
    name: 'All-caps body text',
    description:
      'Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.',
  },
  {
    id: 'wide-tracking',
    name: 'Wide letter spacing on body text',
    description:
      'Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.',
  },
];

// ─── Section 2: Color Utilities ─────────────────────────────────────────────

function isNeutralColor(color) {
  if (!color || color === 'transparent') return true;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return true;
  return (Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3])) < 30;
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
  return [...bgImage.matchAll(/rgba?\([^)]+\)/g)]
    .map(m => parseRgb(m[0]))
    .filter(Boolean);
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
  if (SAFE_TAGS.has(tag)) return [];
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

function checkColors(opts) {
  const { tag, textColor, bgColor, effectiveBg, fontSize, fontWeight, hasDirectText, bgClip, bgImage, classList } = opts;
  if (SAFE_TAGS.has(tag)) return [];
  const findings = [];

  // Pure black background (only solid or near-solid, not semi-transparent overlays)
  if (bgColor && bgColor.a >= 0.9 && bgColor.r === 0 && bgColor.g === 0 && bgColor.b === 0) {
    findings.push({ id: 'pure-black-white', snippet: '#000000 background' });
  }

  if (hasDirectText && textColor) {
    // Skip background-dependent checks if we can't determine the background (e.g. gradient)
    if (effectiveBg) {
      // Gray on colored background
      const textLum = relativeLuminance(textColor);
      const isGray = !hasChroma(textColor, 20) && textLum > 0.05 && textLum < 0.85;
      if (isGray && hasChroma(effectiveBg, 40)) {
        findings.push({ id: 'gray-on-color', snippet: `text ${colorToHex(textColor)} on bg ${colorToHex(effectiveBg)}` });
      }

      // Low contrast (WCAG AA)
      const ratio = contrastRatio(textColor, effectiveBg);
      const isHeading = ['h1', 'h2', 'h3'].includes(tag);
      const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700) || isHeading;
      const threshold = isLargeText ? 3.0 : 4.5;
      if (ratio < threshold) {
        findings.push({ id: 'low-contrast', snippet: `${ratio.toFixed(1)}:1 (need ${threshold}:1) — text ${colorToHex(textColor)} on ${colorToHex(effectiveBg)}` });
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
    if (/\bbg-black\b/.test(classStr)) {
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

function resolveBackground(el, win) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);

    // If this element has a gradient background, it's opaque but we can't determine the color
    const bgImage = style.backgroundImage || '';
    if (bgImage && bgImage !== 'none' && /gradient/i.test(bgImage)) {
      return null;
    }

    let bg = parseRgb(style.backgroundColor);
    if (!IS_BROWSER && (!bg || bg.a < 0.1)) {
      // jsdom doesn't decompose background shorthand — parse raw style attr
      const rawStyle = current.getAttribute?.('style') || '';
      const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
      const inlineBg = bgMatch ? bgMatch[1].trim() : '';
      // Check for gradient in inline style too
      if (/gradient/i.test(inlineBg)) return null;
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

// ─── Section 5: Element Adapters ────────────────────────────────────────────

// Browser adapters — call getComputedStyle/getBoundingClientRect on live DOM

function checkElementBordersDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (SAFE_TAGS.has(tag)) return [];
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
  if (SAFE_TAGS.has(tag)) return [];
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return [];
  const style = getComputedStyle(el);
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  return checkColors({
    tag,
    textColor: parseRgb(style.color),
    bgColor: parseRgb(style.backgroundColor),
    effectiveBg: resolveBackground(el),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute('class') || '',
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

function checkElementQualityDOM(el) {
  const tag = el.tagName.toLowerCase();
  // Skip browser extension injected elements
  const elId = el.id || '';
  if (elId.startsWith('claude-') || elId.startsWith('cic-')) return [];
  const style = getComputedStyle(el);
  const findings = [];

  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 10);
  const textLen = el.textContent?.trim().length || 0;
  const fontSize = parseFloat(style.fontSize) || 16;
  const rect = el.getBoundingClientRect();

  // --- Line length too long ---
  // Only flag if text is long enough to actually fill the line (>80 chars)
  if (hasDirectText && QUALITY_TEXT_TAGS.has(tag) && rect.width > 0 && textLen > 80) {
    const charsPerLine = rect.width / (fontSize * 0.5);
    if (charsPerLine > 85) {
      findings.push({ id: 'line-length', snippet: `~${Math.round(charsPerLine)} chars/line (aim for <80)` });
    }
  }

  // --- Cramped padding (skip small elements like labels/badges) ---
  if (hasDirectText && textLen > 20 && rect.width > 100 && rect.height > 30) {
    const borders = {
      top: parseFloat(style.borderTopWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
      bottom: parseFloat(style.borderBottomWidth) || 0,
      left: parseFloat(style.borderLeftWidth) || 0,
    };
    // Need at least 2 borders (a container), or a non-transparent background
    const borderCount = Object.values(borders).filter(w => w > 0).length;
    const hasBg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
    if (borderCount >= 2 || hasBg) {
      // Only check padding on sides that have borders or where bg creates containment
      const paddings = [];
      if (hasBg || borders.top > 0) paddings.push(parseFloat(style.paddingTop) || 0);
      if (hasBg || borders.right > 0) paddings.push(parseFloat(style.paddingRight) || 0);
      if (hasBg || borders.bottom > 0) paddings.push(parseFloat(style.paddingBottom) || 0);
      if (hasBg || borders.left > 0) paddings.push(parseFloat(style.paddingLeft) || 0);
      if (paddings.length > 0) {
        const minPad = Math.min(...paddings);
        if (minPad < 8) {
          findings.push({ id: 'cramped-padding', snippet: `${minPad}px padding (need >=8px)` });
        }
      }
    }
  }

  // --- Tight line height ---
  if (hasDirectText && textLen > 50 && !['h1','h2','h3','h4','h5','h6'].includes(tag)) {
    const lineHeight = parseFloat(style.lineHeight);
    if (lineHeight && lineHeight !== NaN) {
      const ratio = lineHeight / fontSize;
      if (ratio < 1.3 && ratio > 0) {
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
  if (hasDirectText && textLen > 20 && fontSize < 12) {
    if (!['sub', 'sup', 'code', 'kbd', 'samp', 'var'].includes(tag)) {
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
  if (hasDirectText && textLen > 20) {
    const tracking = parseFloat(style.letterSpacing);
    if (tracking > 0 && style.textTransform !== 'uppercase') {
      const trackingEm = tracking / fontSize;
      if (trackingEm > 0.05) {
        findings.push({ id: 'wide-tracking', snippet: `letter-spacing: ${trackingEm.toFixed(2)}em on body text` });
      }
    }
  }

  return findings;
}

function checkPageQualityDOM() {
  const findings = [];

  // --- Skipped heading levels ---
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let prevLevel = 0;
  for (const h of headings) {
    const level = parseInt(h.tagName[1]);
    if (prevLevel > 0 && level > prevLevel + 1) {
      findings.push({ type: 'skipped-heading', detail: `h${prevLevel} followed by h${level} (missing h${prevLevel + 1})` });
    }
    prevLevel = level;
  }

  return findings;
}

// Node adapters — take pre-extracted jsdom computed style

function checkElementBorders(tag, style) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = {}, colors = {};
  for (const s of sides) {
    widths[s] = parseFloat(style[`border${s}Width`]) || 0;
    colors[s] = style[`border${s}Color`] || '';
  }
  return checkBorders(tag, widths, colors, parseFloat(style.borderRadius) || 0);
}

function checkElementColors(el, style, tag, window) {
  const hasText = el.textContent?.trim().length > 0;
  const hasDirectText = hasText && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

  return checkColors({
    tag,
    textColor: parseRgb(style.color),
    bgColor: parseRgb(style.backgroundColor),
    effectiveBg: resolveBackground(el, window),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute?.('class') || el.className || '',
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
  const fonts = new Set();
  const overusedFound = new Set();

  for (const sheet of document.styleSheets) {
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

  const html = document.documentElement.outerHTML;
  const gfRe = /fonts\.googleapis\.com\/css2?\?family=([^&"'\s]+)/gi;
  let m;
  while ((m = gfRe.exec(html)) !== null) {
    for (const f of m[1].split('|').map(f => f.split(':')[0].replace(/\+/g, ' ').toLowerCase())) {
      fonts.add(f);
      if (OVERUSED_FONTS.has(f)) overusedFound.add(f);
    }
  }

  for (const font of overusedFound) {
    findings.push({ type: 'overused-font', detail: `Primary font: ${font}` });
  }
  if (fonts.size === 1 && document.querySelectorAll('*').length >= 20) {
    findings.push({ type: 'single-font', detail: `only font used is ${[...fonts][0]}` });
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
  const hasRadius = (parseFloat(style.borderRadius) || 0) > 0 ||
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
  const LABEL_BG = 'oklch(55% 0.25 350)';
  const OUTLINE_COLOR = 'oklch(60% 0.25 350)';

  // Inject hover styles via CSS (more reliable than JS event listeners)
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .impeccable-overlay:not(.impeccable-banner) {
      pointer-events: none;
      outline: 2px solid ${OUTLINE_COLOR};
      border-radius: 4px;
      transition: outline-color 0.3s ease;
    }
    .impeccable-overlay.impeccable-hover {
      outline-color: rgba(0,0,0,0.85);
      z-index: 100001 !important;
    }
    .impeccable-label-name,
    .impeccable-label-detail {
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .impeccable-label-detail {
      position: absolute; top: 100%; left: 0;
    }
    .impeccable-overlay.impeccable-hover .impeccable-label-name,
    .impeccable-overlay.impeccable-hover .impeccable-label-detail {
      transform: translateY(-100%);
    }
    .impeccable-hidden .impeccable-overlay:not(.impeccable-banner) {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(styleEl);

  const overlays = [];
  const TYPE_LABELS = {};
  for (const ap of ANTIPATTERNS) {
    TYPE_LABELS[ap.id] = ap.name.toLowerCase().substring(0, 26);
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
      positionOverlay(o);
    }
  }

  let resizeRAF;
  const onResize = () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(repositionOverlays);
  };
  window.addEventListener('resize', onResize);

  // Track target element visibility via IntersectionObserver.
  // Uses a huge rootMargin so all *rendered* elements count as intersecting,
  // while display:none / closed <details> / hidden modals etc. do not.
  // This is event-driven -- no polling needed.
  const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const overlay = entry.target._impeccableOverlay;
      if (!overlay) continue;
      if (entry.isIntersecting) {
        overlay.style.display = '';
        positionOverlay(overlay);
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

    const typeText = findings.map(f => TYPE_LABELS[f.type || f.id] || f.type || f.id).join(', ');
    const detailText = findings.map(f => f.detail || f.snippet).join(' | ');

    const label = document.createElement('div');
    label.className = 'impeccable-label';
    Object.assign(label.style, {
      position: 'absolute', top: '-22px', left: '0',
      clipPath: 'inset(0 -999px)',
    });

    const rowBase = {
      padding: '2px 8px', borderRadius: '3px', whiteSpace: 'nowrap',
      fontSize: '11px', fontWeight: '600', letterSpacing: '0.02em',
      color: 'white', lineHeight: '16px',
    };

    const nameRow = document.createElement('div');
    nameRow.className = 'impeccable-label-name';
    nameRow.textContent = typeText;
    Object.assign(nameRow.style, { ...rowBase, background: LABEL_BG, fontFamily: 'system-ui, sans-serif' });
    label.appendChild(nameRow);

    const detailRow = document.createElement('div');
    detailRow.className = 'impeccable-label-detail';
    detailRow.textContent = detailText;
    Object.assign(detailRow.style, { ...rowBase, background: 'rgba(0,0,0,0.85)', fontFamily: 'ui-monospace, monospace', fontWeight: '400' });
    label.appendChild(detailRow);

    outline.appendChild(label);

    // Start hidden; the IntersectionObserver will show it once the target is rendered
    outline.style.display = 'none';
    el._impeccableOverlay = outline;
    visibilityObserver.observe(el);

    // Drive hover state from the target element so pointer events pass through
    el.addEventListener('mouseenter', () => outline.classList.add('impeccable-hover'));
    el.addEventListener('mouseleave', () => outline.classList.remove('impeccable-hover'));

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
      height: '36px',
    });

    // Scrollable findings area
    const scrollArea = document.createElement('div');
    Object.assign(scrollArea.style, {
      flex: '1', minWidth: '0', overflowX: 'auto', overflowY: 'hidden',
      display: 'flex', gap: '8px', alignItems: 'center',
      padding: '0 12px', scrollSnapType: 'x mandatory',
      scrollbarWidth: 'none',
    });
    for (const f of findings) {
      const tag = document.createElement('span');
      tag.textContent = `${TYPE_LABELS[f.type] || f.type}: ${f.detail}`;
      Object.assign(tag.style, {
        background: 'rgba(255,255,255,0.15)', padding: '2px 8px',
        borderRadius: '3px', fontSize: '12px', fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap', flexShrink: '0', scrollSnapAlign: 'start',
      });
      scrollArea.appendChild(tag);
    }
    banner.appendChild(scrollArea);

    // Controls area (always visible on the right)
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
    document.body.appendChild(banner);
    overlays.push(banner);
  };

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

  const scan = function() {
    for (const o of overlays) o.remove();
    overlays.length = 0;
    visibilityObserver.disconnect();
    const allFindings = [];

    for (const el of document.querySelectorAll('*')) {
      if (el.classList.contains('impeccable-overlay') ||
          el.classList.contains('impeccable-label') ||
          el.classList.contains('impeccable-tooltip')) continue;
      // Skip browser extension elements (Claude, etc.)
      const elId = el.id || '';
      if (elId.startsWith('claude-') || elId.startsWith('cic-')) continue;

      const findings = [
        ...checkElementBordersDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementColorsDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementMotionDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementGlowDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementAIPaletteDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
        ...checkElementQualityDOM(el).map(f => ({ type: f.id, detail: f.snippet })),
      ];

      if (findings.length > 0) {
        highlight(el, findings);
        allFindings.push({ el, findings });
      }
    }

    const pageLevelFindings = [];

    const typoFindings = checkTypography();
    if (typoFindings.length > 0) {
      pageLevelFindings.push(...typoFindings);
      allFindings.push({ el: document.body, findings: typoFindings });
    }

    const layoutFindings = checkLayout();
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
    const qualityFindings = checkPageQualityDOM();
    if (qualityFindings.length > 0) {
      pageLevelFindings.push(...qualityFindings);
      allFindings.push({ el: document.body, findings: qualityFindings });
    }

    // Regex-on-HTML checks (shared with Node)
    const htmlPatternFindings = checkHtmlPatterns(document.documentElement.outerHTML);
    if (htmlPatternFindings.length > 0) {
      const mapped = htmlPatternFindings.map(f => ({ type: f.id, detail: f.snippet }));
      pageLevelFindings.push(...mapped);
      allFindings.push({ el: document.body, findings: mapped });
    }

    if (pageLevelFindings.length > 0) {
      showPageBanner(pageLevelFindings);
    }

    printSummary(allFindings);
    return allFindings;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 100));
  } else {
    setTimeout(scan, 100);
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

  // Element-level checks (borders + colors + motion)
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const style = window.getComputedStyle(el);
    for (const f of checkElementBorders(tag, style)) {
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
  }

  // Page-level checks (only for full pages, not partials)
  if (isFullPage(html)) {
    for (const f of checkPageTypography(document, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkPageLayout(document, window)) {
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
    path.dirname(new URL(import.meta.url).pathname),
    'detect-antipatterns-browser.js'
  );
  let browserScript;
  try {
    browserScript = fs.readFileSync(browserScriptPath, 'utf-8');
  } catch {
    throw new Error(`Browser script not found at ${browserScriptPath}`);
  }

  const browser = await puppeteer.default.launch({ headless: true });
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
  { id: 'overused-font', regex: /font-family\s*:\s*['"]?(Inter|Roboto|Open Sans|Lato|Montserrat|Arial|Helvetica)\b/gi,
    test: () => true,
    fmt: (m) => m[0] },
  { id: 'overused-font', regex: /fonts\.googleapis\.com\/css2?\?family=(Inter|Roboto|Open\+Sans|Lato|Montserrat)\b/gi,
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

function detectText(content, filePath) {
  const findings = [];
  const lines = content.split('\n');

  for (const matcher of REGEX_MATCHERS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      matcher.regex.lastIndex = 0;
      let m;
      while ((m = matcher.regex.exec(line)) !== null) {
        if (matcher.test(m, line)) {
          findings.push(finding(matcher.id, filePath, matcher.fmt(m, line), i + 1));
        }
      }
    }
  }

  // Page-level analyzers only run on full pages
  if (isFullPage(content)) {
    for (const analyzer of REGEX_ANALYZERS) {
      findings.push(...analyzer(content, filePath));
    }
  }

  return findings;
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
    out.push(`\n${file}`);
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
// CLI
// ---------------------------------------------------------------------------

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
        for (const file of walkDir(resolved)) {
          const ext = path.extname(file).toLowerCase();
          if (!fastMode && HTML_EXTENSIONS.has(ext)) {
            allFindings.push(...await detectHtml(file));
          } else {
            allFindings.push(...detectText(fs.readFileSync(file, 'utf-8'), file));
          }
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
  main as detectCli,
};

// @browser-strip-end
