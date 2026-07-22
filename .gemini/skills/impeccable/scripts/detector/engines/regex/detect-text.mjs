import { GENERIC_FONTS, OVERUSED_FONTS, EM_DASH_FLOOR, EM_DASH_CHARS_PER_DASH } from '../../shared/constants.mjs';
import { isNeutralColor } from '../../shared/color.mjs';
import { extractGoogleFontFamilies } from '../../shared/fonts.mjs';
import { checkSourceDesignSystem } from '../../design-system.mjs';
import { scanCssTextForGlow, scanCssTextForGridBackground, scanCssTextForMarquee, scanCssTextForRadialHalo } from '../../rules/checks.mjs';
import { isFullPage } from '../../shared/page.mjs';
import { applyInlineIgnores } from '../../shared/inline-ignores.mjs';
import { finding } from '../../findings.mjs';
import { profileFindings, profileStep } from '../../profile/profiler.mjs';

// ---------------------------------------------------------------------------
// Regex fallback (non-HTML files: CSS, JSX, TSX, etc.)
// ---------------------------------------------------------------------------

const hasRounded = (line) => /\brounded(?:-\w+)?\b/.test(line);
const hasBorderRadius = (line) => /border-radius/i.test(line);
const isSafeElement = (line) => /<(?:blockquote|nav[\s>]|pre[\s>]|code[\s>]|a\s|input[\s>]|span[\s>])/i.test(line);


/** Strip HTML to plain text — drops script/style/comments/tags so
 *  content-text analyzers don't false-positive on code or CSS. */
function stripHtmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

const PAGE_ANALYZER_EXTS = new Set(['.html', '.htm', '.astro', '.vue', '.svelte']);

function extFromFilePath(filePath) {
  return filePath ? (filePath.match(/\.\w+$/)?.[0] || '').toLowerCase() : '';
}

function shouldRunPageAnalyzers(content, filePath) {
  if (!isFullPage(content)) return false;
  const ext = extFromFilePath(filePath);
  return !ext || PAGE_ANALYZER_EXTS.has(ext);
}

function firstOverusedGoogleFont(text) {
  return extractGoogleFontFamilies(text).find(f => OVERUSED_FONTS.has(f)) || '';
}

// CSS named colors whose channels are equal (achromatic). Anything outside
// this set falls through to the format parsers, and an unrecognized spelling
// stays non-neutral so a real accent is never skipped.
const NEUTRAL_COLOR_KEYWORDS = new Set([
  'transparent', 'currentcolor',
  'black', 'white', 'gray', 'grey', 'silver',
  'dimgray', 'dimgrey', 'darkgray', 'darkgrey', 'lightgray', 'lightgrey',
  'gainsboro', 'whitesmoke',
]);

function hexChannels(color) {
  const long = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i);
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  const short = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])(?:[0-9a-f])?$/i);
  if (short) return [1, 2, 3].map((i) => parseInt(short[i] + short[i], 16));
  return null;
}

/**
 * Split one box-shadow layer into top-level tokens.
 *
 * Whitespace inside parens does not separate tokens: `rgb(0 0 0)` and
 * `var(--x, 4px)` are each a single value, and splitting them on spaces would
 * read their innards as separate lengths.
 */
function tokenizeShadowLayer(layer) {
  const tokens = [];
  let depth = 0;
  let current = '';
  for (const char of String(layer || '')) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function lastMatch(text, re) {
  const all = [...String(text || '').matchAll(re)];
  return all.length ? all[all.length - 1] : null;
}

function isShadowLength(token) {
  return /^-?\d*\.?\d+(?:px)?$/i.test(String(token || ''));
}

/**
 * Neutrality test for colors as written in source CSS.
 *
 * shared/color.mjs's isNeutralColor only parses the computed function forms a
 * browser or jsdom emits (rgb/oklch/lab/...) and deliberately reports every
 * other spelling as chromatic so an unknown format is never silently skipped.
 * That default is wrong for authored CSS, where `#000` and `black` are the
 * normal spellings: calling it directly reports a plain black hairline as a
 * colored stripe. Handle hex and named neutrals here, then defer.
 */
function isNeutralAuthoredColor(rawColor) {
  const c = String(rawColor || '').trim().toLowerCase();
  if (!c) return false;
  if (NEUTRAL_COLOR_KEYWORDS.has(c)) return true;
  // Modern rgb() takes space-separated channels (`rgb(0 0 0)`). shared/color.mjs
  // parses only the comma form a browser's getComputedStyle emits, so authored
  // space-separated neutrals fell through it and reported as chromatic — the
  // exemption this function exists for, missed. Normalize before delegating.
  if (/^rgba?\(/i.test(c)) {
    const channels = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (channels) {
      const values = [1, 2, 3].map((i) => Number(channels[i]));
      return (Math.max(...values) - Math.min(...values)) < 30;
    }
    return isNeutralColor(c);
  }
  if (/^(?:hsla?|oklch|oklab|lab|lch|hwb)\(/i.test(c)) return isNeutralColor(c);
  const channels = hexChannels(c);
  if (channels) return (Math.max(...channels) - Math.min(...channels)) < 30;
  return false;
}

function isNeutralBorderColor(str) {
  const m = str.match(/solid\s+((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+)/i);
  if (!m) return false;
  return isNeutralAuthoredColor(m[1]);
}

const REGEX_MATCHERS = [
  // --- Side-tab ---
  { id: 'side-tab', regex: /\bborder-[lrse]-(\d+)\b/g,
    test: (m, line) => { const n = +m[1]; return hasRounded(line) ? n >= 2 : n >= 4; },
    fmt: (m) => m[0] },
  { id: 'side-tab', regex: /border-(?:left|right)\s*:\s*(\d+)px\s+solid[^;]*/gi,
    test: (m, line) => { if (isSafeElement(line)) return false; if (isNeutralBorderColor(m[0])) return false; const n = +m[1]; return hasBorderRadius(line) ? n >= 2 : n >= 3; },
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
  { id: 'overused-font', regex: /font-family\s*:\s*['"]?(Inter|Roboto|Open Sans|Lato|Montserrat|Arial|Helvetica|Fraunces|Geist Sans|Geist Mono|Geist|Mona Sans|Plus Jakarta Sans|Space Grotesk|Recoleta|Instrument Sans|Instrument Serif)\b/gi,
    test: () => true,
    fmt: (m) => m[0] },
  { id: 'overused-font', regex: /fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi,
    test: (m) => {
      m.overusedGoogleFont = firstOverusedGoogleFont(m[0]);
      return Boolean(m.overusedGoogleFont);
    },
    fmt: (m) => `Google Fonts: ${m.overusedGoogleFont || firstOverusedGoogleFont(m[0])}` },
  // --- Gradient text ---
  { id: 'gradient-text', regex: /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/gi,
    test: (m, line) => /gradient/i.test(line),
    fmt: () => 'background-clip: text + gradient' },
  // --- Gradient text (Tailwind) ---
  { id: 'gradient-text', regex: /\bbg-clip-text\b/g,
    test: (m, line) => /\bbg-gradient-to-/i.test(line),
    fmt: () => 'bg-clip-text + bg-gradient' },
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
  { id: 'bounce-easing', regex: /animation(?:-name)?\s*:\s*([^;{}]*(?:bounce|elastic|wobble|jiggle|spring)[^;{}]*)/gi,
    test: () => true,
    fmt: (m) => {
      const token = m[1]
        .split(/[,\s]+/)
        .find((part) => /bounce|elastic|wobble|jiggle|spring/i.test(part));
      return `animation: ${token || m[1].trim()}`;
    } },
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
  // --- Broken image: src="" or src="#" or src=" " ---
  { id: 'broken-image', regex: /<img\b[^>]*?\bsrc\s*=\s*(?:""|''|"\s+"|'\s+'|"#"|'#')/gi,
    test: () => true,
    fmt: (m) => m[0].slice(0, 100) },
  // --- Broken image: <img> with no src attribute at all ---
  { id: 'broken-image', regex: /<img\b(?:(?!\bsrc\s*=)[^>])*>/gi,
    test: (m) => !/\bsrc\s*=/i.test(m[0]),
    fmt: (m) => m[0].slice(0, 100) },
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
    for (const f of extractGoogleFontFamilies(content)) fonts.add(f);
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
  // Em-dash overuse (ADVISORY): the AI cadence tell is em-dash *saturation*,
  // not the occasional dash. Humans use em-dashes legitimately, so this rule is
  // advisory (surfaced separately, never a failure, hook-skipped by default) and
  // its threshold is deliberately conservative. Two gates must both hold:
  //   1. Absolute floor of EM_DASH_FLOOR (8) dashes — a page with a handful
  //      never fires, no matter how short.
  //   2. Density: at least one dash per EM_DASH_CHARS_PER_DASH (500) characters
  //      of body text, so a long article that uses eight across several thousand
  //      words is left alone while a short, dash-per-clause landing page is not.
  // Raised from the old flat 5-dash floor, which fired on ordinary long prose.
  //
  // stripHtmlToText drops tags but leaves character-entity escapes intact, so
  // a model that writes `&mdash;`, `&#8212;`, or `&#x2014;` renders an em-dash
  // the counter never saw. Decode the em-dash entities (named, zero-padded
  // decimal, upper/lower hex) to the literal glyph first. En-dash entities are
  // deliberately left alone: the rule counts em-dashes, and the literal `–`
  // was never counted either.
  (content, filePath) => {
    const text = stripHtmlToText(content)
      .replace(/&mdash;|&#0*8212;|&#x0*2014;/gi, '—');
    let count = 0;
    const re = /[—]|--(?=\S)/g;
    while (re.exec(text) !== null) count++;
    if (count < EM_DASH_FLOOR) return [];
    // Saturation gate: dashes must be dense in the prose, not sprinkled through
    // a long document. textLength <= count * chars-per-dash means the density is
    // at or above the threshold.
    if (text.length > count * EM_DASH_CHARS_PER_DASH) return [];
    return [finding('em-dash-overuse', filePath, `${count} em-dashes in body text`)];
  },
  // Marketing buzzwords: SaaS phrase list
  (content, filePath) => {
    const text = stripHtmlToText(content);
    const lower = text.toLowerCase();
    const BUZZWORDS = [
      'streamline your', 'empower your', 'supercharge your',
      'unleash your', 'unleash the power', 'leverage the power',
      'built for the modern', 'trusted by leading', 'trusted by the world',
      'best-in-class', 'industry-leading', 'world-class', 'enterprise-grade',
      'next-generation', 'cutting-edge', 'transform your business',
      'revolutionize', 'game-changer', 'game changing',
      'mission-critical', 'best of breed', 'future-proof', 'future proof',
      'seamless experience', 'seamlessly integrate',
      'drive engagement', 'drive growth', 'drive results',
      'harness the power',
    ];
    let count = 0;
    let firstSample = '';
    for (const phrase of BUZZWORDS) {
      let from = 0;
      while (true) {
        const idx = lower.indexOf(phrase, from);
        if (idx === -1) break;
        count++;
        if (!firstSample) {
          firstSample = text.slice(Math.max(0, idx - 12), Math.min(text.length, idx + phrase.length + 12)).trim();
        }
        from = idx + phrase.length;
      }
    }
    if (count === 0) return [];
    return [finding('marketing-buzzword', filePath, `${count} buzzword phrase${count === 1 ? '' : 's'}: "${firstSample}"`)];
  },
  // Aphoristic cadence: manufactured-contrast + short-rebuttal
  (content, filePath) => {
    const text = stripHtmlToText(content);
    const NOT_A_RE = /\bNot an? [a-z][^.!?]{1,40}[.!]\s+[A-Z][^.!?]{1,60}[.!]/g;
    const SHORT_REBUTTAL_RE = /\b[A-Z][^.!?]{4,80}[.!]\s+(No|Just)\s+[a-z][^.!?]{2,60}[.!]/g;
    let count = 0;
    let firstSample = '';
    let m;
    NOT_A_RE.lastIndex = 0;
    while ((m = NOT_A_RE.exec(text)) !== null) {
      count++;
      if (!firstSample) firstSample = m[0].trim().slice(0, 80);
    }
    SHORT_REBUTTAL_RE.lastIndex = 0;
    while ((m = SHORT_REBUTTAL_RE.exec(text)) !== null) {
      count++;
      if (!firstSample) firstSample = m[0].trim().slice(0, 80);
    }
    if (count < 3) return [];
    return [finding('aphoristic-cadence', filePath, `${count} aphoristic constructions: "${firstSample}"`)];
  },
  // Dark glow / chromatic halo shadows (page-level). Shared scanner handles
  // any color format, single-level var() resolution, zero-offset halos on
  // any background, and text-shadow glows.
  (content, filePath) => {
    const hits = scanCssTextForGlow(content);
    if (hits.length === 0) return [];
    const lines = content.substring(0, hits[0].index).split('\n');
    return [finding('dark-glow', filePath, hits[0].snippet, lines.length)];
  },
  // Radial-gradient background halo on a dark page (the gradient sibling
  // of the dark-glow shadow tell).
  (content, filePath) => {
    const hits = scanCssTextForRadialHalo(content);
    if (hits.length === 0) return [];
    const lines = content.substring(0, hits[0].index).split('\n');
    return [finding('radial-halo', filePath, hits[0].snippet, lines.length)];
  },
  // Auto-scrolling marquees (<marquee> or infinite horizontal loop
  // animations).
  (content, filePath) => scanCssTextForMarquee(content).map(hit => finding('marquee', filePath, hit.snippet)),
];

// ---------------------------------------------------------------------------
// Structural CSS checks used by source files whose styles are not parsed by
// the static HTML engine.
// ---------------------------------------------------------------------------

const CHROMATIC_SHADOW_TOKEN_RE = /(?:^|-)(?:accent|kinpaku|patina|gold|red|orange|amber|yellow|lime|green|emerald|teal|cyan|blue|indigo|violet|purple|magenta|pink|rose|coral|aqua|mint|burgundy|crimson|scarlet)(?:-|$)/i;

function insetStripeColorIsChromatic(rawColor) {
  const color = String(rawColor || '').trim().replace(/\s*!important\s*$/i, '');
  if (/^(?:currentcolor|transparent|inherit|unset)$/i.test(color)) return false;
  const variable = color.match(/^var\(\s*(--[\w-]+)/i);
  if (variable) return CHROMATIC_SHADOW_TOKEN_RE.test(variable[1]);
  if (!/^(?:#|rgba?\(|hsla?\(|hwb\(|oklch\(|oklab\(|lch\(|lab\(|color\(|[a-z]+$)/i.test(color)) return false;
  return !isNeutralAuthoredColor(color);
}

/**
 * Blank out comment bodies while preserving every byte offset (and therefore
 * every line number) so commented-out CSS is not scanned as live rules.
 */
function blankCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

function scanInsetStripeCss(rawContent, filePath, lineOffset = 0) {
  const content = blankCssComments(rawContent);
  const findings = [];
  const ruleRe = /([^{};]+)\{([^{}]*)\}/g;
  let match;
  // Deriving each line with content.slice(0, offset).split('\n') re-scans the
  // whole prefix per rule, which is O(n^2) on a large stylesheet. Rule matches
  // arrive in source order, so carry a monotonic cursor instead: one pass total.
  let scanOffset = 0;
  let scanLine = 1;
  const lineAtOffset = (offset) => {
    while (scanOffset < offset) {
      if (content[scanOffset] === '\n') scanLine++;
      scanOffset++;
    }
    return scanLine;
  };
  while ((match = ruleRe.exec(content)) !== null) {
    // The selector group is `[^{};]+`, which greedily absorbs the whitespace and
    // newlines trailing the previous rule. Advance past that run before deriving
    // the line, or every rule after the first reports the preceding line.
    const selectorStart = match.index + (match[1].length - match[1].trimStart().length);
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector) continue;
    if (/:(?:hover|focus|focus-visible|focus-within|active|checked|target)\b/i.test(selector)) continue;
    if (/\[aria-selected\s*[*^$|~]?=\s*["']?true/i.test(selector)) continue;
    if (/\[aria-current(?!\s*[*^$|~]?=\s*["']?false)/i.test(selector)) continue;
    if (/(?:^|[\s._[-])(?:active|current|selected)(?![\w])/i.test(selector)) continue;
    if (/(?:^|[\s>+~,(])(?:button|hr|tr|td|th|table|blockquote|pre|code)(?![\w-])/i.test(selector)) continue;

    // Read the last of a repeated declaration, not the first: that is what the
    // cascade paints. Taking the first both flagged stripes that a later
    // `box-shadow: none` had cancelled and missed stripes that overrode an
    // earlier value, and mis-skipped rules whose narrow width was overridden.
    const width = lastMatch(match[2], /(?:^|;)\s*(?:width|inline-size)\s*:\s*(\d+(?:\.\d+)?)px/gi);
    if (width && Number(width[1]) <= 40) continue;
    const declaration = lastMatch(match[2], /(?:^|;)\s*box-shadow\s*:\s*([^;]+)/gi);
    if (!declaration || !/\binset\b/i.test(declaration[1])) continue;
    // `!important` qualifies the declaration, not the shadow value, so strip it
    // before the layers are read. Tokenizing split it into its own token, which
    // made the color count wrong and silently stopped flagging stripes declared
    // with it — a shape the previous regex handled.
    const shadowValue = declaration[1].replace(/\s*!\s*important\s*$/i, '').trim();

    for (const rawLayer of shadowValue.split(/,(?![^(]*\))/)) {
      const layer = rawLayer.trim();
      // Parse the layer by its grammar rather than by one spelling of it.
      // A box-shadow layer is `inset? && <length>{2,4} && <color>?` in any
      // order, so `inset 4px 0 red`, `4px 0 0 red inset`, and `red 4px 0 inset`
      // all paint the same stripe. Matching a fixed token order missed three
      // valid spellings in a row; enumerate the tokens instead. Tokenizing must
      // respect parens: `rgb(0 0 0)` is one color token, and splitting it on
      // whitespace would read its channels as lengths.
      const tokens = tokenizeShadowLayer(layer);
      if (!tokens.some((token) => /^inset$/i.test(token))) continue;
      const rest = tokens.filter((token) => !/^inset$/i.test(token));
      const lengths = rest.filter(isShadowLength);
      const colors = rest.filter((token) => !isShadowLength(token));
      // Only the two offsets are required; omitted blur/spread default to 0,
      // which is exactly the stripe shape. More than one non-length token is a
      // layer shape we do not claim to understand, so leave it alone.
      if (lengths.length < 2 || lengths.length > 4 || colors.length !== 1) continue;
      const values = lengths.map((token) => ({
        n: Number(token.replace(/px$/i, '')),
        hasPx: /px$/i.test(token),
      }));
      const x = values[0];
      const y = values[1];
      const blur = values[2] ? values[2].n : 0;
      const spread = values[3] ? values[3].n : 0;
      if ((x.n !== 0 && !x.hasPx) || (y.n !== 0 && !y.hasPx) || blur !== 0 || spread !== 0) continue;
      const ax = Math.abs(x.n);
      const ay = Math.abs(y.n);
      if (!((ax >= 3 && ax <= 12 && ay === 0) || (ay >= 3 && ay <= 12 && ax === 0))) continue;
      if (!insetStripeColorIsChromatic(colors[0])) continue;
      const edge = ay === 0 ? (x.n > 0 ? 'left' : 'right') : (y.n > 0 ? 'top' : 'bottom');
      const line = lineOffset + lineAtOffset(selectorStart);
      findings.push(finding('side-tab', filePath, `${selector} — inset box-shadow ${ay === 0 ? ax : ay}px stripe (${edge})`, line));
      break;
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Style block extraction (Astro/Vue/Svelte <style> blocks)
// ---------------------------------------------------------------------------

function extractStyleBlocks(content, ext) {
  ext = ext.toLowerCase();
  if (ext !== '.astro' && ext !== '.vue' && ext !== '.svelte') return [];
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

function runRegexMatchers(lines, filePath, lineOffset = 0, blockContext = null, options = {}) {
  const { profile, phase = 'regex-matchers' } = options || {};
  const findings = [];
  if (!profile) {
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

  for (const matcher of REGEX_MATCHERS) {
    const matcherFindings = profileFindings(profile, {
      engine: 'regex',
      phase,
      ruleId: matcher.id,
      target: filePath,
    }, () => {
      const matches = [];
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
            matches.push(finding(matcher.id, filePath, matcher.fmt(m, context), i + 1 + lineOffset));
          }
        }
      }
      return matches;
    });
    findings.push(...matcherFindings);
  }
  return findings;
}

/** Page-level analyzers that scan rendered text content (em-dash use,
 *  buzzword phrases, aphoristic cadence).
 *  These are detector-agnostic — they work on any HTML/text source
 *  and don't need a parsed DOM. Exported so detectHtml can call them
 *  for `.html` files (which otherwise skip the regex engine). */
const TEXT_CONTENT_ANALYZER_IDS = [
  'em-dash-overuse',
  'marketing-buzzword',
  'aphoristic-cadence',
];

function runTextContentAnalyzers(content, filePath, options = {}) {
  const profile = options?.profile;
  if (!shouldRunPageAnalyzers(content, filePath)) return [];
  // The 3 text-content analyzers are at indices 3-5 in REGEX_ANALYZERS.
  const findings = [];
  for (let i = 0; i < TEXT_CONTENT_ANALYZER_IDS.length; i++) {
    const analyzer = REGEX_ANALYZERS[3 + i];
    const ruleId = TEXT_CONTENT_ANALYZER_IDS[i];
    findings.push(...profileFindings(profile, {
      engine: 'regex',
      phase: 'text-content',
      ruleId,
      target: filePath,
    }, () => analyzer(content, filePath)));
  }
  return findings;
}

function detectText(content, filePath, options = {}) {
  const profile = options?.profile;
  const findings = [];
  const lines = content.split('\n');
  const ext = extFromFilePath(filePath);

  // Run regex matchers on the full file content (catches Tailwind classes, inline styles)
  // Enable block context for CSS files where related properties span multiple lines
  const cssLike = new Set(['.css', '.scss', '.sass', '.less']);
  findings.push(...runRegexMatchers(lines, filePath, 0, cssLike.has(ext) || null, {
    profile,
    phase: 'source',
  }));
  if (cssLike.has(ext)) findings.push(...scanInsetStripeCss(content, filePath));

  // Block-level CSS checks that need multiple declarations must run over the
  // complete source, not line-by-line. This covers standalone stylesheets,
  // component style blocks, inline styles, and CSS-in-JS templates.
  findings.push(...profileFindings(profile, {
    engine: 'regex',
    phase: 'source',
    ruleId: 'codex-grid-background',
    target: filePath,
  }, () => scanCssTextForGridBackground(content).map(hit => {
    const line = content.substring(0, hit.index).split('\n').length;
    return finding('codex-grid-background', filePath, hit.snippet, line);
  })));

  // Extract and scan <style> blocks from Astro/Vue/Svelte components.
  const styleBlocks = profile
    ? profileStep(profile, {
      engine: 'regex',
      phase: 'extract',
      ruleId: 'style-blocks',
      target: filePath,
    }, () => extractStyleBlocks(content, ext))
    : extractStyleBlocks(content, ext);
  for (const block of styleBlocks) {
    const blockLines = block.content.split('\n');
    findings.push(...runRegexMatchers(blockLines, filePath, block.startLine - 1, true, {
      profile,
      phase: 'style-block',
    }));
    // block.startLine is the first line *after* the <style> tag, but block.content
    // begins at the character right after that tag — so its own line 1 sits on the
    // tag's line, whether or not a newline follows immediately. lineAtOffset is
    // 1-based, so the offset is startLine - 2; startLine - 1 double-counted and
    // reported every selector one line low. runRegexMatchers keeps startLine - 1
    // because it indexes its split lines from zero.
    findings.push(...scanInsetStripeCss(block.content, filePath, block.startLine - 2));
  }

  // Extract and scan CSS-in-JS template literals
  const cssJsBlocks = profile
    ? profileStep(profile, {
      engine: 'regex',
      phase: 'extract',
      ruleId: 'css-in-js',
      target: filePath,
    }, () => extractCSSinJS(content, ext))
    : extractCSSinJS(content, ext);
  for (const block of cssJsBlocks) {
    const blockLines = block.content.split('\n');
    findings.push(...runRegexMatchers(blockLines, filePath, block.startLine - 1, true, {
      profile,
      phase: 'css-in-js',
    }));
    findings.push(...scanInsetStripeCss(block.content, filePath, block.startLine - 1));
  }

  if (options?.designSystem) {
    findings.push(...profileFindings(profile, {
      engine: 'regex',
      phase: 'source',
      ruleId: 'design-system',
      target: filePath,
    }, () => checkSourceDesignSystem(content, filePath, { designSystem: options.designSystem })));
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
  if (shouldRunPageAnalyzers(content, filePath)) {
    const analyzerIds = [
      'single-font',
      'flat-type-hierarchy',
      'monotonous-spacing',
      'em-dash-overuse',
      'marketing-buzzword',
      'aphoristic-cadence',
      'dark-glow',
    ];
    for (let i = 0; i < REGEX_ANALYZERS.length; i++) {
      const analyzer = REGEX_ANALYZERS[i];
      deduped.push(...profileFindings(profile, {
        engine: 'regex',
        phase: 'page-analyzer',
        ruleId: analyzerIds[i] || `analyzer-${i + 1}`,
        target: filePath,
      }, () => analyzer(content, filePath)));
    }
  }

  // Inline `impeccable-disable*` waivers travel with the file; honor them unless
  // explicitly bypassed (`--no-config` / `--no-inline-ignores`).
  return options?.inlineIgnores === false ? deduped : applyInlineIgnores(deduped, content);
}

export {
  REGEX_MATCHERS,
  REGEX_ANALYZERS,
  TEXT_CONTENT_ANALYZER_IDS,
  extractStyleBlocks,
  extractCSSinJS,
  runRegexMatchers,
  runTextContentAnalyzers,
  detectText,
};
