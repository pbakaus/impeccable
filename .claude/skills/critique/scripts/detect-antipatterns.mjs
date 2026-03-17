#!/usr/bin/env node

/**
 * Anti-Pattern Detector for Impeccable
 *
 * Scans HTML files using jsdom (computed styles) by default,
 * with regex fallback for non-HTML files (CSS, JSX, TSX).
 * URLs are scanned via Puppeteer for full browser rendering.
 *
 * Usage:
 *   node detect-antipatterns.mjs [file-or-dir...]   # jsdom for HTML, regex for rest
 *   node detect-antipatterns.mjs https://...         # Puppeteer (auto)
 *   node detect-antipatterns.mjs --fast [files...]   # regex-only (skip jsdom)
 *   node detect-antipatterns.mjs --json              # JSON output
 *
 * Exit codes: 0 = clean, 2 = findings
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Anti-pattern definitions
// ---------------------------------------------------------------------------

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
  // -------------------------------------------------------------------------
  // Color & contrast anti-patterns
  // -------------------------------------------------------------------------
  {
    id: 'pure-black-white',
    name: 'Pure black or white',
    description:
      'Pure #000 or #fff never appears in nature. Tint your blacks and whites slightly toward your brand hue for a more natural, cohesive feel.',
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
];

/** Check if content looks like a full page (not a component/partial) */
function isFullPage(content) {
  // Strip HTML comments before checking — they might mention <html>/<head> in prose
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  return /<!doctype\s|<html[\s>]|<head[\s>]/i.test(stripped);
}

function getAP(id) {
  return ANTIPATTERNS.find(a => a.id === id);
}

function finding(id, filePath, snippet, line = 0) {
  const ap = getAP(id);
  return { antipattern: id, name: ap.name, description: ap.description, file: filePath, line, snippet };
}

// ---------------------------------------------------------------------------
// Computed-style detection (shared by jsdom + Puppeteer + browser)
// ---------------------------------------------------------------------------

/**
 * Check if an RGB color string is neutral (gray/structural).
 */
function isNeutralColor(color) {
  if (!color || color === 'transparent') return true;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return true;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return (Math.max(r, g, b) - Math.min(r, g, b)) < 30;
}

/**
 * Parse an RGB/RGBA color string into { r, g, b, a } (0-255 for rgb, 0-1 for a).
 * Returns null if unparseable.
 */
function parseRgb(color) {
  if (!color || color === 'transparent') return null;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

/**
 * Compute relative luminance (WCAG 2.x formula).
 * Input: { r, g, b } with values 0-255.
 */
function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Compute WCAG contrast ratio between two colors.
 * Returns a number >= 1.
 */
function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a color is pure black or pure white.
 */
function isPureBlackOrWhite(c) {
  if (!c) return false;
  return (c.r === 0 && c.g === 0 && c.b === 0) ||
         (c.r === 255 && c.g === 255 && c.b === 255);
}

/**
 * Check if a color has meaningful chroma (is "colored" vs gray/neutral).
 * Uses simple RGB saturation check.
 */
function hasChroma(c, threshold = 30) {
  if (!c) return false;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) >= threshold;
}

/**
 * Get the approximate hue (0-360) from RGB.
 */
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

/**
 * Resolve the effective background color for an element by walking up ancestors.
 * Returns { r, g, b } or { r: 255, g: 255, b: 255 } as fallback (white).
 */
function resolveBackground(el, window) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = window.getComputedStyle(current);
    // Try backgroundColor first, then fall back to parsing the inline background shorthand
    // (jsdom doesn't decompose background shorthand to backgroundColor reliably)
    let bg = parseRgb(style.backgroundColor);
    if (!bg || bg.a < 0.1) {
      // jsdom doesn't reliably decompose background shorthand — parse raw style attr
      const rawStyle = current.getAttribute?.('style') || '';
      const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
      const inlineBg = bgMatch ? bgMatch[1].trim() : '';
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
      if (bg.a >= 0.5) return bg;
    }
    current = current.parentElement;
  }
  return { r: 255, g: 255, b: 255 }; // default to white
}

/**
 * Analyze an element's colors for anti-patterns.
 * Needs the element, its computed style, AND access to the window for ancestor bg resolution.
 */
function checkElementColors(el, style, tag, window) {
  if (SAFE_TAGS.has(tag)) return [];
  const findings = [];

  const textColor = parseRgb(style.color);
  const bgColor = parseRgb(style.backgroundColor);
  const fontSize = parseFloat(style.fontSize) || 16;
  const fontWeight = parseInt(style.fontWeight) || 400;

  // Skip non-text elements (no text content)
  const hasText = el.textContent?.trim().length > 0;
  const hasDirectText = hasText && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

  // Pure black/white is handled via regex on raw HTML (jsdom's computed bg is unreliable)

  if (hasDirectText && textColor) {
    // --- Gray text on colored background ---
    const effectiveBg = resolveBackground(el, window);
    // Gray = low chroma AND mid-range luminance (not near-white or near-black)
    const textLum = relativeLuminance(textColor);
    const isGray = !hasChroma(textColor, 20) && textLum > 0.05 && textLum < 0.85;
    if (isGray && hasChroma(effectiveBg, 40)) {
      findings.push({
        id: 'gray-on-color',
        snippet: `text ${colorToHex(textColor)} on bg ${colorToHex(effectiveBg)}`,
      });
    }

    // --- Low contrast (WCAG AA) ---
    {
      const ratio = contrastRatio(textColor, effectiveBg);
      // jsdom may return fontSize in non-px units — also check tag-based heuristic
      const isHeading = ['h1', 'h2', 'h3'].includes(tag);
      const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700) || isHeading;
      const threshold = isLargeText ? 3.0 : 4.5;
      if (ratio < threshold) {
        findings.push({
          id: 'low-contrast',
          snippet: `${ratio.toFixed(1)}:1 (need ${threshold}:1) — text ${colorToHex(textColor)} on ${colorToHex(effectiveBg)}`,
        });
      }
    }
  }

  // --- Gradient text ---
  const bgClip = style.webkitBackgroundClip || style.backgroundClip || '';
  const bgImage = style.backgroundImage || '';
  if (bgClip === 'text' && bgImage.includes('gradient')) {
    findings.push({ id: 'gradient-text', snippet: 'background-clip: text + gradient' });
  }

  // --- AI color palette: purple/violet accent ---
  // Only flag vivid purple/violet as text color or background on accent-like elements
  if (hasDirectText && textColor && hasChroma(textColor, 50)) {
    const hue = getHue(textColor);
    // Purple/violet range: roughly 260-310
    if (hue >= 260 && hue <= 310 && relativeLuminance(textColor) < 0.3) {
      // Check if it's used on a heading or prominent text
      if (['h1', 'h2', 'h3'].includes(tag) || fontSize >= 20) {
        findings.push({ id: 'ai-color-palette', snippet: `Purple/violet text (${colorToHex(textColor)}) on heading` });
      }
    }
  }

  return findings;
}

/**
 * Analyze a single element's computed styles for border anti-patterns.
 * Returns array of { id, snippet } findings.
 */
function checkElementBorders(tag, style) {
  if (SAFE_TAGS.has(tag)) return [];
  const findings = [];

  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = {};
  const colors = {};
  for (const s of sides) {
    widths[s] = parseFloat(style[`border${s}Width`]) || 0;
    colors[s] = style[`border${s}Color`] || '';
  }
  const radius = parseFloat(style.borderRadius) || 0;

  for (const side of sides) {
    const w = widths[side];
    if (w < 1) continue;
    if (isNeutralColor(colors[side])) continue;

    const otherSides = sides.filter(s => s !== side);
    const maxOther = Math.max(...otherSides.map(s => widths[s]));
    const isAccent = w >= 2 && (maxOther <= 1 || w >= maxOther * 2);
    if (!isAccent) continue;

    const sideName = side.toLowerCase();
    const isSide = side === 'Left' || side === 'Right';

    if (isSide) {
      if (radius > 0) {
        findings.push({ id: 'side-tab', snippet: `border-${sideName}: ${w}px + border-radius: ${radius}px` });
      } else if (w >= 3) {
        findings.push({ id: 'side-tab', snippet: `border-${sideName}: ${w}px` });
      }
    } else {
      if (radius > 0 && w >= 2) {
        findings.push({ id: 'border-accent-on-rounded', snippet: `border-${sideName}: ${w}px + border-radius: ${radius}px` });
      }
    }
  }

  return findings;
}

/**
 * Page-level typography checks using the document/window API.
 * Returns array of { id, snippet } findings.
 */
function checkPageTypography(document, window) {
  const findings = [];

  // --- Overused fonts ---
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

  // Check Google Fonts links in HTML
  const html = document.documentElement?.outerHTML || '';
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

  // --- Single font ---
  if (fonts.size === 1) {
    const els = document.querySelectorAll('*');
    if (els.length >= 20) {
      findings.push({ id: 'single-font', snippet: `Only font: ${[...fonts][0]}` });
    }
  }

  // --- Flat type hierarchy ---
  const sizes = new Set();
  const textEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button, div');
  for (const el of textEls) {
    const fs = parseFloat(window.getComputedStyle(el).fontSize);
    // Filter out sub-8px values (jsdom doesn't resolve relative units properly)
    if (fs >= 8 && fs < 200) sizes.add(Math.round(fs * 10) / 10);
  }
  if (sizes.size >= 3) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio < 2.0) {
      findings.push({ id: 'flat-type-hierarchy', snippet: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }
  }

  // --- Pure black/white (regex on raw HTML — jsdom doesn't resolve inline bg colors) ---
  const pureRe = /(?:color|background(?:-color)?)\s*:\s*(?:#000000|#000|rgb\(\s*0,\s*0,\s*0\s*\))\b/gi;
  if (pureRe.test(html)) {
    findings.push({ id: 'pure-black-white', snippet: 'Pure #000 in styles' });
  }
  const pureWhiteRe = /(?:color|background(?:-color)?)\s*:\s*(?:#ffffff|#fff|rgb\(\s*255,\s*255,\s*255\s*\))\b/gi;
  if (pureWhiteRe.test(html)) {
    findings.push({ id: 'pure-black-white', snippet: 'Pure #fff in styles' });
  }

  // --- AI color palette: purple/violet in raw CSS ---
  // Very conservative — only flag vivid purple in prominent contexts
  const purpleHexRe = /#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9|6366f1|764ba2|667eea)\b/gi;
  if (purpleHexRe.test(html)) {
    // Check if used on text (not just borders or backgrounds)
    const purpleTextRe = /(?:(?:^|;)\s*color\s*:\s*(?:.*?)(?:#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9))|gradient.*?#(?:7c3aed|8b5cf6|a855f7|764ba2|667eea))/gi;
    if (purpleTextRe.test(html)) {
      findings.push({ id: 'ai-color-palette', snippet: 'Purple/violet accent colors detected' });
    }
  }

  // --- Gradient text (regex on raw HTML — jsdom doesn't compute background-clip) ---
  const gradientRe = /(?:-webkit-)?background-clip\s*:\s*text/gi;
  let gm;
  while ((gm = gradientRe.exec(html)) !== null) {
    // Check nearby context for gradient
    const start = Math.max(0, gm.index - 200);
    const context = html.substring(start, gm.index + gm[0].length + 200);
    if (/gradient/i.test(context)) {
      findings.push({ id: 'gradient-text', snippet: 'background-clip: text + gradient' });
      break; // one finding is enough
    }
  }

  // Also check Tailwind gradient text
  if (/\bbg-clip-text\b/.test(html) && /\bbg-gradient-to-/.test(html)) {
    findings.push({ id: 'gradient-text', snippet: 'bg-clip-text + bg-gradient (Tailwind)' });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// jsdom detection (default for HTML files)
// ---------------------------------------------------------------------------

async function detectHtml(filePath) {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    // jsdom not available — fall back to regex
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
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;

  await new Promise(r => setTimeout(r, 50));

  const findings = [];

  // Element-level checks (borders + colors)
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const style = window.getComputedStyle(el);
    for (const f of checkElementBorders(tag, style)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of checkElementColors(el, style, tag, window)) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
  }

  // Page-level typography checks (only for full pages, not partials)
  if (isFullPage(html)) {
    for (const f of checkPageTypography(document, window)) {
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

  const browser = await puppeteer.default.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Serialize shared functions for page.evaluate
  const safeTags = [...SAFE_TAGS];
  const overusedFonts = [...OVERUSED_FONTS];
  const genericFonts = [...GENERIC_FONTS];

  const results = await page.evaluate((safeTags, overusedFonts, genericFonts) => {
    const safe = new Set(safeTags);
    const overused = new Set(overusedFonts);
    const generic = new Set(genericFonts);
    const findings = [];
    const sides = ['Top', 'Right', 'Bottom', 'Left'];

    // Element-level border checks
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (safe.has(tag)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;

      const style = getComputedStyle(el);
      const widths = {}, colors = {};
      for (const s of sides) {
        widths[s] = parseFloat(style[`border${s}Width`]) || 0;
        colors[s] = style[`border${s}Color`] || '';
      }
      const radius = parseFloat(style.borderRadius) || 0;

      for (const side of sides) {
        const w = widths[side];
        if (w < 1) continue;
        const c = colors[side];
        if (!c || c === 'transparent') continue;
        const cm = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (cm && (Math.max(+cm[1], +cm[2], +cm[3]) - Math.min(+cm[1], +cm[2], +cm[3])) < 30) continue;

        const others = sides.filter(s => s !== side);
        const maxOther = Math.max(...others.map(s => widths[s]));
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
    }

    // Typography checks
    const fonts = new Set();
    const overusedFound = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.type !== 1) continue;
        const ff = rule.style?.fontFamily;
        if (!ff) continue;
        const stack = ff.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
        const primary = stack.find(f => f && !generic.has(f));
        if (primary) {
          fonts.add(primary);
          if (overused.has(primary)) overusedFound.add(primary);
        }
      }
    }
    for (const f of overusedFound) findings.push({ id: 'overused-font', snippet: `Primary font: ${f}` });
    if (fonts.size === 1 && document.querySelectorAll('*').length > 20) {
      findings.push({ id: 'single-font', snippet: `Only font: ${[...fonts][0]}` });
    }

    const sizes = new Set();
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,label,button,div')) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0 && fs < 200) sizes.add(Math.round(fs * 10) / 10);
    }
    if (sizes.size >= 3) {
      const sorted = [...sizes].sort((a, b) => a - b);
      const ratio = sorted[sorted.length - 1] / sorted[0];
      if (ratio < 2.0) findings.push({ id: 'flat-type-hierarchy', snippet: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }

    return findings;
  }, safeTags, overusedFonts, genericFonts);

  await browser.close();
  return results.map(f => finding(f.id, url, f.snippet));
}

// ---------------------------------------------------------------------------
// Regex fallback (non-HTML files: CSS, JSX, TSX, etc.)
// ---------------------------------------------------------------------------

/** Check if Tailwind `rounded-*` appears on the same line */
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
  // --- Pure black/white ---
  { id: 'pure-black-white', regex: /(?:color|background(?:-color)?)\s*:\s*(#000000|#000|rgb\(0,\s*0,\s*0\)|#ffffff|#fff|rgb\(255,\s*255,\s*255\))\b/gi,
    test: () => true,
    fmt: (m) => `${m[0]}` },
  // --- Gradient text ---
  { id: 'gradient-text', regex: /background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/gi,
    test: (m, line) => /gradient/i.test(line),
    fmt: () => 'background-clip: text + gradient' },
  // --- Gradient text (Tailwind) ---
  { id: 'gradient-text', regex: /\bbg-clip-text\b/g,
    test: (m, line) => /\bbg-gradient-to-/i.test(line),
    fmt: () => 'bg-clip-text + bg-gradient' },
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
    return [finding('single-font', filePath, `Only font: ${name}`, line)];
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
];

/**
 * Regex-based detection for non-HTML files or --fast mode.
 */
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
          findings.push(finding(matcher.id, filePath, matcher.fmt(m), i + 1));
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
  console.log(`Usage: node detect-antipatterns.mjs [options] [file-or-dir-or-url...]

Scan files or URLs for known UI anti-patterns.

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
  node detect-antipatterns.mjs src/
  node detect-antipatterns.mjs index.html
  node detect-antipatterns.mjs https://example.com
  node detect-antipatterns.mjs --fast --json .`);
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
// Entry point + exports
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1]?.endsWith('detect-antipatterns.mjs');
if (isMainModule) main();

export {
  ANTIPATTERNS, SAFE_TAGS, OVERUSED_FONTS, GENERIC_FONTS,
  checkElementBorders, checkPageTypography, isNeutralColor, isFullPage,
  detectHtml, detectUrl, detectText,
  walkDir, formatFindings, SCANNABLE_EXTENSIONS, SKIP_DIRS,
};
