import {
  BORDER_SAFE_TAGS,
  EM_DASH_CHARS_PER_DASH,
  EM_DASH_FLOOR,
  GENERIC_FONTS,
  KNOWN_SERIF_FONTS,
  OVERUSED_FONTS,
  SAFE_TAGS,
  WCAG_LARGE_BOLD_TEXT_PX,
  WCAG_LARGE_TEXT_PX,
  isBrandFontOnOwnDomain,
} from '../shared/constants.mjs';
import {
  colorToHex,
  contrastRatio,
  getHue,
  hasChroma,
  isNeutralColor,
  parseGradientColors,
  parseRgb,
  relativeLuminance,
} from '../shared/color.mjs';
import { extractGoogleFontFamilies } from '../shared/fonts.mjs';

const DETECTOR_IS_BROWSER = typeof window !== 'undefined';

// ─── Section 3: Pure Detection ──────────────────────────────────────────────

function checkBorders(tag, widths, colors, radius, opts = {}) {
  // Badge-shaped <span>s (own visible background) are a real stripe target
  // for the top/bottom variant — the inline-tag exemption exists to quiet
  // text-level borders, not chips. They skip the left/right arms below.
  const spanBadge = tag === 'span' && !!opts.badgeLike;
  if (BORDER_SAFE_TAGS.has(tag) && !spanBadge) return [];
  // A live status/alert region wears a colored single-edge border as a
  // severity accent (toast, snackbar, callout), not as the side-tab tell.
  if (opts.statusContext) return [];
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
      if (spanBadge) continue;
      if (radius > 0) findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px + border-radius: ${radius}px` });
      else if (w >= 3) findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px` });
    } else {
      if (radius > 0 && w >= 2) findings.push({ id: 'border-accent-on-rounded', snippet: `border-${sn}: ${w}px + border-radius: ${radius}px` });
      // Horizontal variant of the side-tab stripe: a thick chromatic accent
      // riding the top or bottom edge of a card/badge/container. Same
      // dominant-edge + chroma gates as left/right, 3-12px band. Selected-
      // tab underlines are exempt via opts.tabContext (adapters look for
      // tablist/nav/tab ancestors and aria-selected); links, buttons,
      // table cells, and <hr> never reach here (BORDER_SAFE_TAGS).
      else if (!opts.tabContext && w >= 3 && w <= 12) {
        findings.push({ id: 'side-tab', snippet: `border-${sn}: ${w}px` });
      }
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
    // Exception for elements styled as controls or chips. SAFE_TAGS exists to
    // suppress contrast noise on inline links and unstyled spans, where the
    // element has no own background and the contrast against the ancestor
    // surface is already the intended visual. When the element paints its own
    // opaque background under direct text, it is a styled button, chip, or
    // badge regardless of tag, and contrast on its own surface is a real,
    // frequent bug worth flagging. (The shipped miss: a <span> severity chip
    // whose white text lost a specificity fight and rendered muted-on-red at
    // 1.2:1; the old a/button-only exception never looked at it.) The 9px
    // font floor keeps sub-text decorations out.
    const isStyledControl = hasDirectText
      && ((bgColor && bgColor.a > 0.5)
        // A gradient painted on the element itself is an own surface the
        // same way a solid background is. Without this branch a nav CTA
        // built as `<a>` with `background: linear-gradient(…)` and a text
        // color that fails against every stop sails through on the
        // SAFE_TAGS suppression (the shipped escape).
        || (bgImage && /gradient/i.test(bgImage)))
      && fontSize >= 9;
    if (!isStyledControl) return [];
  }
  const findings = [];

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
      const isLargeText = fontSize >= WCAG_LARGE_TEXT_PX || (fontSize >= WCAG_LARGE_BOLD_TEXT_PX && fontWeight >= 700);
      const threshold = isLargeText ? 3.0 : 4.5;
      if (ratio < threshold) {
        // Skip the false-positive class where text has alpha < 1 AND we
        // couldn't find an opaque ancestor (effectiveBg is null, we're
        // comparing against gradient-stop fallback). In jsdom mode the
        // detector can't resolve `var(--X)` color tokens, so a dark
        // section sitting between the text and the body's decorative
        // gradient is invisible to us — we end up measuring contrast
        // against the body's paper-grain noise instead of the real
        // local bg. Real low-contrast bugs use alpha=1 and have a
        // resolvable opaque ancestor; semi-transparent Tailwind tokens
        // like `text-paper/60` on `bg-ink` sections are the FP pattern.
        const isAlphaFallbackFP = !DETECTOR_IS_BROWSER && !effectiveBg && (textColor.a != null && textColor.a < 1);
        if (!isAlphaFallbackFP) {
          // Near-threshold ratios (e.g. 4.497) would round to the threshold
          // itself at one decimal and read as "4.5 needs 4.5" — show two
          // decimals there so the finding stays legible.
          const ratioLabel = ratio.toFixed(1) === threshold.toFixed(1) ? ratio.toFixed(2) : ratio.toFixed(1);
          findings.push({ id: 'low-contrast', snippet: `${ratioLabel}:1 (need ${threshold}:1) — text ${colorToHex(textColor)} on ${colorToHex(bgs[worstIdx])}` });
        }
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

// WCAG contrast for the :hover state of an element whose hover rules change
// its text color and/or background. The classic miss: a nav CTA whose
// author-intended hover pair passes AA, but a broader selector (e.g.
// `.nav-links a:hover`) wins the specificity fight and swaps in a color
// that fails. Only fires on elements that present as styled controls —
// direct text plus an opaque-ish own background in either state — so plain
// inline links keep the same suppression they get in checkColors.
function checkHoverContrast(opts) {
  const { tag, textColor, bg, ownBgAlpha, fontSize, fontWeight, hasDirectText, isEmojiOnly } = opts;
  if (!hasDirectText || isEmojiOnly || !textColor || !bg) return [];
  if (SAFE_TAGS.has(tag) && !(ownBgAlpha != null && ownBgAlpha > 0.5)) return [];
  const ratio = contrastRatio(textColor, bg);
  const isLargeText = fontSize >= WCAG_LARGE_TEXT_PX || (fontSize >= WCAG_LARGE_BOLD_TEXT_PX && fontWeight >= 700);
  const threshold = isLargeText ? 3.0 : 4.5;
  if (ratio >= threshold) return [];
  return [{
    id: 'low-contrast',
    snippet: `:hover state ${ratio.toFixed(1)}:1 (need ${threshold}:1) — text ${colorToHex(textColor)} on ${colorToHex(bg)}`,
  }];
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

// Color saturation check. Returns true when the color has visible
// chroma — i.e., it's an "accent color" rather than near-neutral.
// Handles rgb()/rgba(), #hex, oklch(), and hsl(). var() refs are
// expected to be pre-resolved by the caller.
function isAccentColor(cssColor) {
  if (!cssColor) return false;
  const s = String(cssColor).trim();
  // rgb / rgba — direct channel-distance check.
  const rgbM = /rgba?\(\s*(\d+)\s*,?\s+|\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s.replace(/rgba?\(\s*/, 'rgb(').replace(/,/g, ', '));
  const rgbStrict = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgbStrict) {
    const r = +rgbStrict[1], g = +rgbStrict[2], b = +rgbStrict[3];
    return (Math.max(r, g, b) - Math.min(r, g, b)) >= 40;
  }
  // #hex — 3, 4, 6, or 8 digit.
  const hexM = /^#([0-9a-f]{3,8})\b/i.exec(s);
  if (hexM) {
    let h = hexM[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('').slice(0, 6);
    else h = h.slice(0, 6);
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (Math.max(r, g, b) - Math.min(r, g, b)) >= 40;
    }
  }
  // oklch(L C H) — chroma C is what matters. Typical neutral grays
  // have C < 0.02; visible accents are 0.05+. CSS minification can
  // collapse spaces between L% and C ("oklch(43%.15 34)"), so we
  // extract all numbers and take the second rather than matching a
  // strict L-then-whitespace-then-C pattern.
  if (/^oklch\(/i.test(s)) {
    const nums = s.match(/\d*\.\d+|\d+/g);
    if (nums && nums.length >= 2) {
      const c = parseFloat(nums[1]);
      return !Number.isNaN(c) && c >= 0.05;
    }
  }
  // hsl(H, S%, L%) — saturation > 20% reads as accent.
  const hslM = /hsla?\(\s*[\d.]+\s*,\s*([\d.]+)%/i.exec(s);
  if (hslM) {
    const sat = parseFloat(hslM[1]);
    return !Number.isNaN(sat) && sat >= 20;
  }
  return false;
}

function resolveHeroHeadingSizePx(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return 0;

  const simpleLengthPx = (token) => {
    const match = /^(-?\d*\.?\d+)\s*(px|rem|em|%)?$/.exec(String(token || '').trim());
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    if (match[2] === 'rem' || match[2] === 'em') return amount * 16;
    if (match[2] === '%') return amount * 0.16;
    return amount;
  };

  const direct = simpleLengthPx(input);
  if (direct !== null) return direct;

  // Static CSS engines cannot resolve viewport units, but clamp's min/max
  // bounds still tell us whether the heading can ever reach hero scale.
  const clamp = /^clamp\((.*)\)$/.exec(input);
  if (clamp) {
    const parts = clamp[1].split(',');
    if (parts.length === 3) {
      const bounds = [simpleLengthPx(parts[0]), simpleLengthPx(parts[2])]
        .filter((candidate) => candidate !== null);
      if (bounds.length > 0) return Math.max(...bounds);
    }
  }

  return 0;
}

// Sibling-relationship rule. Anchor on a hero-scale h1, look at the
// previousElementSibling, and gate on EITHER the classic tracked-
// uppercase eyebrow OR the modern accent-colored bold eyebrow.
function checkHeroEyebrow(opts) {
  const {
    headingTag, headingText, headingFontSize,
    headingInApplicationContext,
    siblingTag, siblingText, siblingTextTransform,
    siblingFontSize, siblingLetterSpacing,
    siblingFontWeight, siblingColor,
    siblingHasAccentDashPseudo,
  } = opts;
  if (headingTag !== 'h1') return [];
  // This is specifically a marketing-hero cliché, not a ban on compact
  // context labels in product UI (for example, a station name inside a tab
  // panel). Browser-computed sizes are reliable; the static adapter also
  // resolves ordinary px/rem/em and clamp() bounds before reaching here.
  if (headingInApplicationContext) return [];
  if (!(headingFontSize >= 48)) return [];
  if (!siblingTag) return [];
  // An h2 above an h1 is a different anti-pattern (heading hierarchy / dual
  // headings) — never an eyebrow.
  if (HEADING_TAGS.has(siblingTag)) return [];

  const text = (siblingText || '').trim();
  if (text.length < 2 || text.length > 60) return [];
  if (!(siblingFontSize > 0 && siblingFontSize <= 14)) return [];

  // Branch A: classic tracked-uppercase eyebrow.
  const isUppercased = siblingTextTransform === 'uppercase'
    || (/[A-Z]/.test(text) && !/[a-z]/.test(text));
  const isClassicTracked = isUppercased && siblingLetterSpacing >= 1.6;

  // Branch B: modern accent-bold eyebrow — sentence case, low
  // tracking, but bold + accent-colored. The style choices changed;
  // the pattern is the same kicker-above-headline anti-pattern.
  const weight = Number(siblingFontWeight) || 400;
  const isAccentBold = weight >= 700 && isAccentColor(siblingColor || '');

  // Branch C: dash-prefix eyebrow — sentence case, low tracking, regular
  // weight, but announced by a short chromatic ::before/::after bar
  // (the kicker dash). Same label-above-headline pattern, third styling.
  const isDashPrefixed = !!siblingHasAccentDashPseudo;

  if (!isClassicTracked && !isAccentBold && !isDashPrefixed) return [];

  const headingTextSnippet = (headingText || '').trim().slice(0, 60);
  const eyebrowSnippet = text.slice(0, 40);
  const style = isClassicTracked ? 'tracked-caps' : isAccentBold ? 'accent-bold' : 'dash-prefix';
  return [{
    id: 'hero-eyebrow-chip',
    snippet: `eyebrow chip (${style}) "${eyebrowSnippet}" above ${headingTag} "${headingTextSnippet}"`,
  }];
}

function checkRepeatedSectionKickers(opts) {
  const { candidates, minCount = 3 } = opts;
  if (!Array.isArray(candidates) || candidates.length < minCount) return [];
  return candidates.map(candidate => ({
    id: 'repeated-section-kickers',
    snippet: `repeated section kicker "${candidate.kickerText}" before ${candidate.headingTag} "${candidate.headingText}" (${candidates.length} on page)`,
  }));
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

// Locate the color token in a single shadow layer. Returns
// { color, start, end } where color is the parsed {r,g,b,a} (null when the
// token exists but can't be parsed — e.g. an unresolved var() or an exotic
// color space), or null when no color token is present at all. Handles both
// serialization orders: computed style puts the color first
// ("rgb(…) 0px 0px 20px"), authored CSS usually puts it last
// ("0 0 20px #3b82f6").
function findShadowColor(layer) {
  const fn = layer.match(/(?:rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\([^)]*\)/i);
  if (fn) return { color: parseAnyColor(fn[0]), start: fn.index, end: fn.index + fn[0].length };
  const hex = layer.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) return { color: parseAnyColor(hex[0]), start: hex.index, end: hex.index + hex[0].length };
  const wordRe = /[a-zA-Z][a-zA-Z]*/g;
  let m;
  while ((m = wordRe.exec(layer)) !== null) {
    const named = CSS_NAMED_COLORS[m[0].toLowerCase()];
    if (named) return { color: { ...named, a: 1 }, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

// Extract the length values of a shadow layer in declaration order, with the
// color token removed so its components aren't misread as lengths. Handles
// computed-style px values AND authored unitless zeros ("0 0 20px"); rem/em
// approximate at 16px. Result order is offset-x, offset-y, blur, [spread].
function extractShadowLengths(layer, colorStart, colorEnd) {
  const stripped = colorStart != null
    ? layer.slice(0, colorStart) + ' ' + layer.slice(colorEnd)
    : layer;
  const vals = [];
  const re = /(-?\d*\.?\d+)(px|rem|em)?/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    let v = parseFloat(m[1]);
    if (m[2] === 'rem' || m[2] === 'em') v *= 16;
    vals.push(v);
  }
  return vals;
}

function checkGlow(opts) {
  const { boxShadow, textShadow, effectiveBg } = opts;
  const onDarkBg = effectiveBg ? relativeLuminance(effectiveBg) < 0.1 : false;

  // Scan one shadow list. Two glow tells, in any color format:
  //  1. Zero-offset chromatic halo (0 0 Npx <color>) — slop on ANY
  //     background; the light radiates evenly outward, which is never how
  //     real elevation shadows behave. Achromatic zero-offset shadows stay
  //     legal (soft ambient elevation), as do focus rings (blur 0).
  //  2. Any chromatic shadow with real blur on a dark background — the
  //     classic dark-mode glow accent.
  const scan = (value, prop) => {
    if (!value || value === 'none') return null;
    // Split multiple shadows (commas not inside parentheses)
    for (const layer of value.split(/,(?![^(]*\))/)) {
      const colorInfo = findShadowColor(layer);
      // No color token, or one we can't resolve (unresolved var(), exotic
      // color space): don't guess — skip rather than false-positive.
      if (!colorInfo || !colorInfo.color) continue;
      const color = colorInfo.color;
      if (!hasChroma(color, 30)) continue;
      const vals = extractShadowLengths(layer, colorInfo.start, colorInfo.end);
      // Third value is blur (offset-x, offset-y, blur, [spread])
      if (vals.length < 3 || vals[2] <= 4) continue;
      if (vals[0] === 0 && vals[1] === 0) {
        return { id: 'dark-glow', snippet: `Zero-offset ${prop} glow (${colorToHex(color)})` };
      }
      if (onDarkBg) {
        return { id: 'dark-glow', snippet: `Colored ${prop} glow (${colorToHex(color)}) on dark background` };
      }
    }
    return null;
  };

  const found = scan(boxShadow, 'box-shadow') || scan(textShadow, 'text-shadow');
  return found ? [found] : [];
}

// Collect CSS custom property declarations from raw stylesheet/HTML text.
// First declaration wins (:root declarations usually come first); good
// enough for the single-level var() resolution the text engines need.
function collectCssCustomProps(content) {
  const map = new Map();
  const re = /(--[\w-]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!map.has(m[1])) map.set(m[1], m[2].trim());
  }
  return map;
}

// Text-level glow scan shared by the regex engine and the page-level HTML
// pattern pass. Resolves single-level var() refs against custom properties
// collected from the same text, then applies the same two glow tells as
// checkGlow: zero-offset chromatic halo (any background) and chromatic
// blurred shadow when the page has a dark background. Returns
// [{ index, snippet }] — index is the offset of the shadow declaration.
// Dark-page heuristic for raw CSS/HTML text: dark hex/rgb literals, Tailwind
// dark bg utilities, or a ROOT-scoped (body/html/:root or <body style>)
// background that resolves — via var() — to a dark color. The var/modern-
// color extension is deliberately root-scoped: a light page with one dark
// accent chip must not turn every tinted drop shadow into a "dark page"
// signal. Shared by the glow and radial-halo text scanners.
function cssTextHasDarkRootBg(content, customProps) {
  const darkBgRe = /background(?:-color)?\s*:\s*(?:#(?:0[0-9a-f]|1[0-9a-f]|2[0-3])[0-9a-f]{4}\b|#(?:0|1)[0-9a-f]{2}\b|rgb\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\))/i;
  const twDarkBg = /\bbg-(?:gray|slate|zinc|neutral|stone)-(?:9\d{2}|800)\b/;
  if (darkBgRe.test(content) || twDarkBg.test(content)) return true;
  const rootScopes = [];
  const blockRe = /(?:^|[}\s,;>])(?:body|html|:root)\s*(?:,[^{]*)?\{([^}]*)\}/gi;
  let sm;
  while ((sm = blockRe.exec(content)) !== null) rootScopes.push(sm[1]);
  const inlineBody = content.match(/<body[^>]*\bstyle\s*=\s*"([^"]*)"/i);
  if (inlineBody) rootScopes.push(inlineBody[1]);
  for (const scope of rootScopes) {
    const bgRe = /background(?:-color)?\s*:\s*([^;{}]+)/gi;
    let bm;
    while ((bm = bgRe.exec(scope)) !== null) {
      const c = parseAnyColor(resolveVarRefs(bm[1].trim(), customProps));
      if (c && (c.a ?? 1) > 0.5 && relativeLuminance(c) < 0.1) return true;
    }
  }
  return false;
}

function scanCssTextForGlow(content) {
  const customProps = collectCssCustomProps(content);
  const hasDarkBg = cssTextHasDarkRootBg(content, customProps);

  const results = [];
  const shadowRe = /\b(box-shadow|text-shadow)\s*:\s*([^;{}]+)/gi;
  let m;
  while ((m = shadowRe.exec(content)) !== null) {
    const prop = m[1].toLowerCase();
    const value = resolveVarRefs(m[2].trim(), customProps);
    for (const layer of value.split(/,(?![^(]*\))/)) {
      const colorInfo = findShadowColor(layer);
      if (!colorInfo || !colorInfo.color || !hasChroma(colorInfo.color, 30)) continue;
      const vals = extractShadowLengths(layer, colorInfo.start, colorInfo.end);
      if (vals.length < 3 || vals[2] <= 4) continue;
      const zeroOffset = vals[0] === 0 && vals[1] === 0;
      if (!zeroOffset && !hasDarkBg) continue;
      results.push({
        index: m.index,
        snippet: zeroOffset
          ? `Zero-offset ${prop} glow (${colorToHex(colorInfo.color)})`
          : `Colored ${prop} glow (${colorToHex(colorInfo.color)}) on dark page`,
      });
      break; // one finding per declaration
    }
  }
  return results;
}

// Decorative grid or line-field backgrounds drawn with hairline
// linear-gradient layers tiled by a fixed pixel cell. Shared by the HTML
// pattern pass and the regex source engine so standalone CSS, component
// styles, and inline styles receive the same coverage. Both signals must
// co-occur in one declaration block; unrelated rules must not add up across
// the file. Returns [{ index, snippet }], capped at one finding per source to
// match the page-level HTML check's existing behavior.
function scanCssTextForGridBackground(content) {
  const hairlineRe = /\b\d{1,3}px\s*,\s*transparent\s+\d{1,3}px/gi;
  const invertedHairlineRe = /transparent\s+calc\(100%\s*-\s*\d{1,3}px\)/gi;
  const sizeDeclPxRe = /background-size\s*:[^;{}"']*\b\d{1,3}px\b/i;
  const sizeDeclPxPairRe = /background-size\s*:[^;{}"']*\b\d{1,3}px\s+\d{1,3}px/i;
  const shorthandPxAnyRe = /\/\s*\d{1,3}px\b/;
  const shorthandPxPairRe = /\/\s*\d{1,3}px\s+\d{1,3}px/;
  const bgDeclRe = /\bbackground(?:-image)?\s*:\s*([^;{}"']*)/gi;
  const blockRe = /\{([^{}]*)\}|style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
  let blk;
  while ((blk = blockRe.exec(content)) !== null) {
    const block = blk[1] || blk[2] || blk[3] || '';
    let hairlineCount = 0;
    let bgJoined = '';
    let bm;
    bgDeclRe.lastIndex = 0;
    while ((bm = bgDeclRe.exec(block)) !== null) {
      hairlineCount += (bm[1].match(hairlineRe) || []).length;
      hairlineCount += (bm[1].match(invertedHairlineRe) || []).length;
      bgJoined += `${bm[1]};`;
    }
    if (hairlineCount === 0) continue;
    const hasPxCell = sizeDeclPxRe.test(block) || shorthandPxAnyRe.test(bgJoined);
    const hasPxPairCell = sizeDeclPxPairRe.test(block) || shorthandPxPairRe.test(bgJoined);
    if ((hairlineCount >= 2 && hasPxCell) || hasPxPairCell) {
      return [{
        index: blk.index,
        snippet: hairlineCount >= 2
          ? 'two-axis grid-line gradient background'
          : 'px-tiled hairline line-field background',
      }];
    }
  }
  return [];
}

// Decorative chromatic halo drawn as a radial-gradient background on a dark
// page: a saturated center stop dissolving to transparent. The gradient
// sibling of the dark-glow shadow tell. Mechanical gates, in order:
//   * page has a dark root background (shared heuristic with the glow scan)
//   * declaration has no url() layer (photographic imagery is exempt)
//   * the gradient's first color stop is chromatic (RGB spread >= 24) and
//     visible (alpha >= 0.7 — deliberately translucent light-scene washes
//     composite with content instead of painting a flat halo, and stay legal)
//   * the gradient's last stop is transparent / near-zero alpha
//   * no small pixel-sized stop positions (<= 24px = dot/texture patterns)
//   * not a repeating-* gradient
// Achromatic vignettes fail the chroma gate; panel sheens that fade to an
// opaque surface color fail the transparent-end gate.
function scanCssTextForRadialHalo(content) {
  const customProps = collectCssCustomProps(content);
  if (!cssTextHasDarkRootBg(content, customProps)) return [];

  const findings = [];
  const seen = new Set();
  const declRe = /background(?:-image)?\s*:\s*([^;{}]+)/gi;
  let m;
  while ((m = declRe.exec(content)) !== null) {
    const value = resolveVarRefs(m[1].trim(), customProps);
    if (/url\s*\(/i.test(value)) continue;

    const gradRe = /(repeating-)?radial-gradient\(/gi;
    let g;
    while ((g = gradRe.exec(value)) !== null) {
      if (g[1]) continue; // repeating-* = pattern, not halo
      // Balanced-paren capture of the gradient arguments.
      let depth = 0, end = -1;
      const open = value.indexOf('(', g.index);
      for (let i = open; i < value.length; i++) {
        if (value[i] === '(') depth++;
        else if (value[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) break;
      const args = splitTopLevelCommas(value.slice(open + 1, end));
      if (args.length < 2) continue;

      // Optional prelude (shape / size / `at <pos>`) carries no color.
      const colorTokenRe = /(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\([^)]*(?:\([^)]*\))?[^)]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/i;
      const stops = args.filter(a => colorTokenRe.test(a));
      if (stops.length < 2) continue;

      // Dot/texture exemption: px-sized stop positions mean a repeating
      // background-size pattern, not a page-scale halo.
      const pxStop = stops.some(s => {
        const pm = s.match(/(-?[\d.]+)px\b/);
        return pm && Math.abs(parseFloat(pm[1])) <= 24;
      });
      if (pxStop) continue;

      const first = stops[0].match(colorTokenRe);
      const last = stops[stops.length - 1].match(colorTokenRe);
      if (!first || !last) continue;

      const lastColor = /^transparent$/i.test(last[0]) ? { r: 0, g: 0, b: 0, a: 0 } : parseAnyColor(last[0]);
      if (!lastColor || (lastColor.a ?? 1) > 0.05) continue;

      const firstColor = /^transparent$/i.test(first[0]) ? null : parseAnyColor(first[0]);
      if (!firstColor) continue;
      if ((firstColor.a ?? 1) < 0.7) continue;
      const spread = Math.max(firstColor.r, firstColor.g, firstColor.b) - Math.min(firstColor.r, firstColor.g, firstColor.b);
      if (spread < 24) continue;

      const snippet = `radial-gradient halo (${colorToHex(firstColor)} → transparent) on dark page`;
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      findings.push({ index: m.index, snippet });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Text-level CSS rule-block scanners (pseudo-element stripes, pulsing dots)
// ---------------------------------------------------------------------------

// Iterate `selector { declarations }` pairs in raw CSS/HTML text. The block
// body excludes braces, so nested structures (@media, @keyframes) naturally
// yield their innermost rules with the innermost selector text. Callers
// create the regex locally — a shared /g instance is not re-entrant.
const CSS_RULE_BLOCK_SOURCE = String.raw`([^{};]+)\{([^{}]*)\}`;

// Parse a declaration block into a prop → value map (last declaration wins,
// approximating the cascade inside one block). Values keep their raw text
// with any !important suffix stripped.
function parseCssDeclBlock(block) {
  const decls = new Map();
  for (const part of String(block || '').split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).replace(/\s*!important\s*$/i, '').trim();
    if (prop && value) decls.set(prop, value);
  }
  return decls;
}

function cssLengthToPx(value) {
  const m = String(value || '').trim().match(/^(-?[\d.]+)(px|rem|em)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === 'px' ? n : n * 16;
}

function isZeroOffset(value) {
  return value != null && /^-?0(?:px|%|rem|em)?$/.test(String(value).trim());
}

// Side-tab variant: the accent stripe drawn as an absolutely-positioned
// ::before/::after pseudo-element (narrow colored box hugging a vertical
// edge) instead of a border-left/right. The element-level border checks
// never see it — pseudo-elements aren't part of the DOM the cascade walks —
// so this scans stylesheet text directly, mirroring the border rule's
// gates: >= 3px thick, chromatic fill, full height against a side edge.
function scanCssTextForPseudoStripe(content) {
  const customProps = collectCssCustomProps(content);
  const findings = [];
  const seen = new Set();
  const ruleRe = new RegExp(CSS_RULE_BLOCK_SOURCE, 'g');
  let m;
  while ((m = ruleRe.exec(content)) !== null) {
    const selector = m[1].trim();
    if (!/::?(?:before|after)\b/i.test(selector)) continue;
    // Keep the border rule's prose exemptions (blockquote bars etc.).
    if (/\b(?:blockquote|pre|code|nav|hr)\b/i.test(selector)) continue;
    const decls = parseCssDeclBlock(m[2]);
    const position = decls.get('position');
    if (position !== 'absolute' && position !== 'fixed') continue;

    const widthPx = cssLengthToPx(resolveVarRefs(
      decls.get('width') || decls.get('inline-size') || '', customProps));
    const heightPx = cssLengthToPx(resolveVarRefs(
      decls.get('height') || decls.get('block-size') || '', customProps));
    const verticalCandidate = widthPx != null && widthPx >= 3 && widthPx <= 12;
    // Horizontal variant (top/bottom stripe) carries extra exemptions:
    // link/button underline affordances, selected-state indicators
    // (aria-selected="true", aria-current, active/current/selected class
    // hints), and state-conditional (:hover/:focus/...) affordances are
    // not stripes. Tab-strip membership alone ([role=tab], .tabs, bare
    // [aria-selected]) is NOT exempt — a stripe on every tab in the
    // group is decoration; only the selected item's underline stays.
    const horizontalCandidate = heightPx != null && heightPx >= 3 && heightPx <= 12
      && !/(?:^|[\s>+~,(])(?:a|button|summary|tr|td|th|table|li)(?![\w-])/i.test(selector)
      && !/\[aria-selected\s*[*^$|~]?=\s*["']?true/i.test(selector)
      && !/\[aria-current(?!\s*[*^$|~]?=\s*["']?false)/i.test(selector)
      && !/(?:^|[\s._[-])(?:active|current|selected|btn[\w-]*|button[\w-]*|link[\w-]*)(?![\w])/i.test(selector)
      && !/:(?:hover|focus|focus-visible|focus-within|active|checked)\b/i.test(selector);
    if (!verticalCandidate && !horizontalCandidate) continue;

    // Resolve edge offsets, letting an `inset` shorthand fill the gaps.
    const offsets = {
      top: decls.get('top'), right: decls.get('right'),
      bottom: decls.get('bottom'), left: decls.get('left'),
    };
    const inset = decls.get('inset');
    if (inset) {
      const p = inset.split(/\s+/);
      const [t, r, b, l] =
        p.length === 1 ? [p[0], p[0], p[0], p[0]]
        : p.length === 2 ? [p[0], p[1], p[0], p[1]]
        : p.length === 3 ? [p[0], p[1], p[2], p[1]]
        : p;
      if (offsets.top == null) offsets.top = t;
      if (offsets.right == null) offsets.right = r;
      if (offsets.bottom == null) offsets.bottom = b;
      if (offsets.left == null) offsets.left = l;
    }
    if (offsets.left == null) offsets.left = decls.get('inset-inline-start');
    if (offsets.right == null) offsets.right = decls.get('inset-inline-end');

    const heightValue = String(resolveVarRefs(
      decls.get('height') || decls.get('block-size') || '', customProps)).trim();
    const widthValue = String(resolveVarRefs(
      decls.get('width') || decls.get('inline-size') || '', customProps)).trim();

    let edge = null;
    let thicknessPx = null;
    if (verticalCandidate) {
      // Full-height stripes hug both corners; the "floating" variant backs
      // off each end by a small inset (top/bottom a few px) so the bar
      // clears the card's corners. Both read as the same side-tab accent —
      // corner treatment is styling, not a different pattern.
      const topPx = cssLengthToPx(resolveVarRefs(String(offsets.top ?? ''), customProps));
      const bottomPx = cssLengthToPx(resolveVarRefs(String(offsets.bottom ?? ''), customProps));
      const fullHeight = (isZeroOffset(offsets.top) && isZeroOffset(offsets.bottom))
        || /^100(?:\.0*)?%$/.test(heightValue)
        || (topPx != null && bottomPx != null
          && topPx >= 0 && topPx <= 20 && bottomPx >= 0 && bottomPx <= 20);
      if (fullHeight) {
        edge = isZeroOffset(offsets.left) ? 'left'
          : isZeroOffset(offsets.right) ? 'right' : null;
        thicknessPx = widthPx;
      }
    }
    if (!edge && horizontalCandidate) {
      const fullWidth = (isZeroOffset(offsets.left) && isZeroOffset(offsets.right))
        || /^100(?:\.0*)?%$/.test(widthValue);
      if (fullWidth) {
        edge = isZeroOffset(offsets.top) ? 'top'
          : isZeroOffset(offsets.bottom) ? 'bottom' : null;
        thicknessPx = heightPx;
      }
    }
    if (!edge) continue;

    // Chromatic fill only — a neutral hairline divider is not an accent
    // stripe. Unresolvable colors err toward detection, matching the
    // border rule's unknown-format default.
    const bg = String(resolveVarRefs(
      decls.get('background-color') || decls.get('background') || '', customProps)).trim();
    if (!bg || /^(?:none|transparent|inherit|initial|unset|currentcolor)$/i.test(bg)) continue;
    const colorToken = bg.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^)]*\)|#[0-9a-f]{3,8}\b/i);
    const parsed = parseAnyColor(colorToken ? colorToken[0] : bg);
    if (parsed) {
      if ((parsed.a ?? 1) < 0.1) continue;
      const spread = Math.max(parsed.r, parsed.g, parsed.b) - Math.min(parsed.r, parsed.g, parsed.b);
      if (spread < 30) continue;
    } else if (/^(?:white|black|gray|grey|silver)$/i.test(bg)) {
      continue;
    }

    if (seen.has(selector)) continue;
    seen.add(selector);
    findings.push({
      id: 'side-tab',
      snippet: `${selector} — absolute ${thicknessPx}px pseudo-element stripe (${edge}: 0)`,
    });
  }
  return findings;
}

// Side-tab stripe drawn as a single-edge inset box-shadow
// (x or y offset 3-12px, other axis 0, no blur/spread, chromatic color):
// paints a bar along one edge with no border property involved, so the
// element-level border checks never see it. Selection-state indicators
// are exempt — an inset stripe on [aria-current] / .active / [role=tab]
// marks the selected item; the same stripe unconditionally on every item
// is decoration and flags.
function scanCssTextForInsetStripe(content) {
  const customProps = collectCssCustomProps(content);
  const findings = [];
  const seen = new Set();
  const ruleRe = new RegExp(CSS_RULE_BLOCK_SOURCE, 'g');
  let m;
  while ((m = ruleRe.exec(content)) !== null) {
    const selector = m[1].trim();
    // Selection-state contexts: current-item markers and interaction
    // states. Tab-strip membership alone ([role=tab], .tabs, bare
    // [aria-selected]) is NOT exempt — a stripe on every tab in the
    // group is decoration; only the selected item's indicator stays.
    if (/:(?:hover|focus|focus-visible|focus-within|active|checked|target)\b/i.test(selector)) continue;
    if (/\[aria-selected\s*[*^$|~]?=\s*["']?true/i.test(selector)) continue;
    if (/\[aria-current(?!\s*[*^$|~]?=\s*["']?false)/i.test(selector)) continue;
    if (/(?:^|[\s._[-])(?:active|current|selected)(?![\w])/i.test(selector)) continue;
    // Structural tags where a single-edge inset shadow is depth/quoting,
    // not an accent stripe.
    if (/(?:^|[\s>+~,(])(?:button|hr|tr|td|th|table|blockquote|pre|code)(?![\w-])/i.test(selector)) continue;

    const decls = parseCssDeclBlock(m[2]);
    const shadow = decls.get('box-shadow');
    if (!shadow || !/\binset\b/i.test(shadow)) continue;
    // Narrow fixed-width elements (logo marks, icon glyphs) use inset
    // fills as artwork, not edge stripes. Stripe targets — cards, badges,
    // menu items — are wider or leave width to layout.
    const declaredWidth = cssLengthToPx(resolveVarRefs(decls.get('width') || decls.get('inline-size') || '', customProps));
    if (declaredWidth != null && declaredWidth <= 40) continue;
    const value = resolveVarRefs(shadow, customProps);
    for (const layer of value.split(/,(?![^(]*\))/)) {
      if (!/\binset\b/i.test(layer)) continue;
      const colorInfo = findShadowColor(layer);
      // Unresolvable colors (currentColor, external vars): don't guess.
      if (!colorInfo || !colorInfo.color) continue;
      const c = colorInfo.color;
      if ((c.a ?? 1) < 0.1) continue;
      const chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      if (chroma < 30) continue;
      const vals = extractShadowLengths(layer, colorInfo.start, colorInfo.end);
      const x = vals[0] || 0, y = vals[1] || 0, blur = vals[2] || 0, sp = vals[3] || 0;
      if (blur !== 0 || sp !== 0) continue;
      const ax = Math.abs(x), ay = Math.abs(y);
      const isStripe = (ax >= 3 && ax <= 12 && ay === 0) || (ay >= 3 && ay <= 12 && ax === 0);
      if (!isStripe) continue;
      if (seen.has(selector)) break;
      seen.add(selector);
      const edge = ay === 0 ? (x > 0 ? 'left' : 'right') : (y > 0 ? 'top' : 'bottom');
      findings.push({
        id: 'side-tab',
        snippet: `${selector} — inset box-shadow ${ay === 0 ? ax : ay}px stripe (${edge})`,
      });
      break;
    }
  }
  return findings;
}

// Collect @keyframes names whose body travels horizontally — the marquee
// loop. X travel is measured across every translateX/translate/translate3d
// X component in the body: a centered element animating something else
// keeps a constant -50% X (zero travel) and never qualifies, while a
// ticker moves from its resting position to a large offset. Keyframes
// with a single X sample that also vary scale/opacity read as pulses or
// breathes, not marquees.
function collectMarqueeKeyframes(content) {
  const names = new Set();
  const re = /@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < content.length && depth > 0) {
      const ch = content.charCodeAt(i);
      if (ch === 0x7b /* { */) depth++;
      else if (ch === 0x7d /* } */) depth--;
      i++;
    }
    const body = content.slice(re.lastIndex, Math.max(re.lastIndex, i - 1));
    re.lastIndex = i;

    // Only percentage travel qualifies: a content marquee translates by a
    // fraction of its own (unknown) track width, so generated tickers use
    // -50% / -100%. Pixel-travel loops are bespoke product animations —
    // sweeping playheads, progress indicators — not marquees.
    const pct = [];
    const xRe = /\btranslate(?:X|3d)?\(\s*(-?[\d.]+)%/gi;
    let xm;
    while ((xm = xRe.exec(body)) !== null) pct.push(parseFloat(xm[1]));
    if (pct.length === 0) continue;
    if (pct.length === 1 && /\bscale\(|\bopacity\s*:/i.test(body)) continue;
    // Implicit start: a lone declared X animates from the element's
    // resting position, so its magnitude is the travel.
    const travelPct = pct.length > 1 ? Math.max(...pct) - Math.min(...pct) : Math.abs(pct[0]);
    if (travelPct >= 20) names.add(m[1]);
  }
  return names;
}

// Auto-scrolling marquee: a <marquee> element, or an infinite animation
// bound to a keyframe loop that travels a large horizontal distance.
// Rotation/opacity animations never qualify (no X travel); JS-driven
// carousels with user controls have no infinite CSS X-loop to match.
function scanCssTextForMarquee(content) {
  const findings = [];
  if (/<marquee\b/i.test(content)) {
    findings.push({ id: 'marquee', snippet: '<marquee> element' });
  }
  const marqueeKeyframes = collectMarqueeKeyframes(content);
  if (marqueeKeyframes.size === 0) return findings;
  const seen = new Set();
  const ruleRe = new RegExp(CSS_RULE_BLOCK_SOURCE, 'g');
  let m;
  while ((m = ruleRe.exec(content)) !== null) {
    const selector = m[1].trim();
    const decls = parseCssDeclBlock(m[2]);
    for (const name of infiniteAnimationNames(decls)) {
      if (!marqueeKeyframes.has(name)) continue;
      const key = `${selector} ${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ id: 'marquee', snippet: `${selector} — infinite horizontal loop animation "${name}"` });
    }
  }
  return findings;
}

// Collect @keyframes names and whether each one reads as a "pulse" —
// i.e. it varies opacity, scale, or box-shadow. Rotation-only keyframes
// (spinners) are explicitly not pulses.
function collectPulseKeyframes(content) {
  const map = new Map();
  const re = /@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < content.length && depth > 0) {
      const ch = content.charCodeAt(i);
      if (ch === 0x7b /* { */) depth++;
      else if (ch === 0x7d /* } */) depth--;
      i++;
    }
    const body = content.slice(re.lastIndex, Math.max(re.lastIndex, i - 1));
    const pulses = /\bopacity\s*:/i.test(body)
      || /\bbox-shadow\s*:/i.test(body)
      || /\btransform\s*:[^;{}]*\bscale/i.test(body);
    if (!map.has(m[1]) || pulses) map.set(m[1], pulses);
    re.lastIndex = i;
  }
  return map;
}

const ANIMATION_VALUE_KEYWORDS = new Set([
  'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear',
  'infinite', 'alternate', 'alternate-reverse', 'normal', 'reverse',
  'none', 'forwards', 'backwards', 'both', 'running', 'paused',
  'step-start', 'step-end', 'inherit', 'initial', 'unset',
]);

// Extract animation names that run with iteration-count: infinite from a
// declaration block (shorthand layers or animation-name + iteration-count).
function infiniteAnimationNames(decls) {
  const out = [];
  const shorthand = decls.get('animation');
  if (shorthand) {
    for (const layer of shorthand.split(/,(?![^(]*\))/)) {
      if (!/\binfinite\b/i.test(layer)) continue;
      const name = layer.split(/\s+/).find(t =>
        /^[a-zA-Z_-][\w-]*$/.test(t) && !ANIMATION_VALUE_KEYWORDS.has(t.toLowerCase()));
      if (name) out.push(name);
    }
  }
  const nameDecl = decls.get('animation-name');
  if (nameDecl && /\binfinite\b/i.test(decls.get('animation-iteration-count') || '')) {
    for (const raw of nameDecl.split(',')) {
      const t = raw.trim();
      if (t && t.toLowerCase() !== 'none') out.push(t);
    }
  }
  return out;
}

function isRoundDotRadius(radiusValue, w, h) {
  if (!radiusValue) return false;
  const first = String(radiusValue).trim().split(/\s+/)[0];
  const pct = first.match(/^([\d.]+)%$/);
  if (pct) return parseFloat(pct[1]) >= 40;
  const px = cssLengthToPx(first);
  if (px == null) return false;
  return px >= 999 || px >= 0.4 * Math.min(w, h);
}

// Remove @media blocks whose condition is prefers-reduced-motion: reduce.
// Those blocks describe the accessibility fallback, not the default
// experience that ships — an `animation: none` reset inside one must not
// mask the resting-state animation the page plays for everyone else.
function stripReducedMotionBlocks(content) {
  const re = /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/gi;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < content.length && depth > 0) {
      const ch = content.charCodeAt(i);
      if (ch === 0x7b /* { */) depth++;
      else if (ch === 0x7d /* } */) depth--;
      i++;
    }
    out += content.slice(last, m.index);
    last = i;
    re.lastIndex = i;
  }
  return out + content.slice(last);
}

// Source-index ranges of <header> and <nav> landmark elements in an HTML
// string. Lets string-level scans decide whether a matched element sits in
// the page chrome (the hero/nav region) without needing a DOM.
function landmarkSourceRanges(content) {
  const ranges = [];
  for (const tag of ['header', 'nav']) {
    const re = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'gi');
    const stack = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[0].charAt(1) === '/') {
        const start = stack.pop();
        if (start != null) ranges.push([start, m.index]);
      } else {
        stack.push(m.index);
      }
    }
  }
  return ranges;
}

function indexInSourceRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

// Does any element targeted by the final compound of `selector` appear
// inside a header/nav landmark range of the HTML source? Resolves the last
// .class or #id token of the selector against class/id attributes; a
// tag-only compound is never resolvable this way and returns false
// (conservative: no promotion without placement evidence).
function selectorHitsLandmark(content, selector, ranges) {
  if (!ranges || ranges.length === 0) return false;
  const last = selector.split(/[\s>+~]+/).filter(Boolean).pop() || '';
  const idMatch = last.match(/#([A-Za-z_][\w-]*)/);
  const classMatch = last.match(/\.([A-Za-z_][\w-]*)/);
  let attrRe = null;
  if (idMatch) {
    const id = idMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    attrRe = new RegExp(`<[a-zA-Z][^>]*\\bid\\s*=\\s*["']${id}["']`, 'gi');
  } else if (classMatch) {
    const cls = classMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    attrRe = new RegExp(`<[a-zA-Z][^>]*\\bclass\\s*=\\s*["'][^"']*(?<![\\w-])${cls}(?![\\w-])[^"']*["']`, 'gi');
  }
  if (!attrRe) return false;
  let m;
  while ((m = attrRe.exec(content)) !== null) {
    if (indexInSourceRanges(m.index, ranges)) return true;
  }
  return false;
}

// Small circular indicator bound to an infinite pulse animation — the
// decorative "live" dot. Gates: tiny (<= 16px square-ish), round
// (border-radius >= 40% or pill values), and an infinite animation whose
// keyframes vary opacity/scale/box-shadow (or a pulse/blink/ping name when
// the keyframes aren't in the scanned text). Rotation-only animations
// (spinners) never flag.
//
// Declarations for one selector are merged across rule blocks before the
// predicate runs: size in the base rule plus the animation added in a
// second block (or inside a matching @media block) is the construction
// that ships. prefers-reduced-motion: reduce overrides are stripped first
// so their animation resets don't mask the default experience. A dot whose
// element sits inside a header/nav landmark is the hero liveness cliché
// and is promoted to error severity; occurrences elsewhere keep the
// registry default severity.
function scanCssTextForPulsingDot(content) {
  const customProps = collectCssCustomProps(content);
  const keyframes = collectPulseKeyframes(content);
  const heroRanges = landmarkSourceRanges(content);
  const findings = [];
  const seen = new Set();

  // Merge declarations per selector across rule blocks, approximating the
  // cascade: later declarations for the same property win. Comma lists are
  // split so `.a, .b { … }` contributes to both selectors. Comments are
  // stripped first so they neither pollute selector keys nor smuggle a
  // comma into the selector-list split.
  const scanText = stripReducedMotionBlocks(content).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const merged = new Map();
  const ruleRe = new RegExp(CSS_RULE_BLOCK_SOURCE, 'g');
  let m;
  while ((m = ruleRe.exec(scanText)) !== null) {
    const decls = parseCssDeclBlock(m[2]);
    if (decls.size === 0) continue;
    for (const rawSelector of m[1].split(',')) {
      const selector = rawSelector.trim();
      if (!selector || selector.startsWith('@')) continue;
      let acc = merged.get(selector);
      if (!acc) {
        acc = new Map();
        merged.set(selector, acc);
      }
      for (const [prop, value] of decls) acc.set(prop, value);
    }
  }

  for (const [selector, decls] of merged) {
    const names = infiniteAnimationNames(decls);
    if (names.length === 0) continue;
    const pulseName = names.find(n => {
      const known = keyframes.get(n);
      if (known != null) return known;
      return /pulse|blink|ping/i.test(n);
    });
    if (!pulseName) continue;

    const w = cssLengthToPx(resolveVarRefs(
      decls.get('width') || decls.get('inline-size') || '', customProps));
    const h = cssLengthToPx(resolveVarRefs(
      decls.get('height') || decls.get('block-size') || '', customProps));
    if (w == null || h == null || w < 2 || h < 2 || w > 16 || h > 16) continue;

    const radius = resolveVarRefs(decls.get('border-radius') || '', customProps);
    if (!isRoundDotRadius(radius, w, h)) continue;

    if (seen.has(selector)) continue;
    seen.add(selector);
    const inLandmark = selectorHitsLandmark(content, selector, heroRanges);
    findings.push({
      id: 'pulsing-dot',
      snippet: `${selector} — ${w}x${h}px dot with infinite "${pulseName}" animation${inLandmark ? ' in header/nav' : ''}`,
      selector,
      ...(inLandmark ? { severity: 'error' } : {}),
    });
  }

  // Tailwind utilities: animate-ping / animate-pulse on a tiny rounded-full
  // element declared entirely in the class attribute.
  const classRe = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let cm;
  while ((cm = classRe.exec(content)) !== null) {
    const cls = cm[1] || cm[2] || '';
    const anim = cls.match(/\banimate-(ping|pulse)\b/);
    if (!anim) continue;
    if (!/\brounded-full\b/.test(cls)) continue;
    if (!/\b(?:w|h|size)-(?:1|1\.5|2|2\.5|3|3\.5|4)\b/.test(cls)) continue;
    const key = `tw:${cls}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const inLandmark = indexInSourceRanges(cm.index, heroRanges);
    findings.push({
      id: 'pulsing-dot',
      snippet: `animate-${anim[1]} on tiny rounded-full element${inLandmark ? ' in header/nav' : ''}`,
      ...(inLandmark ? { severity: 'error' } : {}),
    });
  }

  return findings;
}

// Shape-assembled illustration: a large inline SVG composing a pictorial
// scene from many primitive shapes (rect / circle / ellipse / polygon) in
// several fill colors — the clip-art hero mascot. Gates keep the legitimate
// SVG population out:
//   • icons and logos: intrinsic size gate (>= 200px on both axes, from
//     width/height attributes or the viewBox when no explicit size is set)
//   • charts / labeled diagrams: more than two <text>/<tspan> nodes exempts
//     the graphic (axis labels, callouts)
//   • line drawings / technical diagrams: primitive count < 8 or fewer
//     than 3 distinct fills never qualifies (stroke-only art has no fills)
//   • tiling background textures: any <pattern> definition exempts
function scanHtmlForShapeAssembledIllustration(html) {
  const findings = [];
  const svgRe = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
  let m;
  while ((m = svgRe.exec(html)) !== null) {
    const block = m[0];
    const openTag = (block.match(/^<svg\b[^>]*>/i) || [''])[0];

    // Data-bearing or annotated graphics: axis labels and callout text
    // mark a chart or diagram, not a mascot.
    const textCount = (block.match(/<(?:text|tspan)\b/gi) || []).length;
    if (textCount > 2) continue;
    // Tiling texture definitions are decorative backgrounds, not scenes.
    if (/<pattern\b/i.test(block)) continue;

    const primitives = (block.match(/<(?:rect|circle|ellipse|polygon)\b/gi) || []).length;
    if (primitives < 8) continue;

    // Intrinsic size: explicit width/height attributes win; fall back to
    // the viewBox box. Percentage or missing sizes stay unresolvable on
    // that axis and the viewBox speaks for them.
    const attrDim = (name) => {
      // (?<![-\w]) keeps compound attributes like stroke-width from
      // masquerading as the svg's own width.
      const am = openTag.match(new RegExp(`(?<![-\\w])${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i'));
      return am ? parseFloat(am[1]) : null;
    };
    const vb = openTag.match(/\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
    const w = attrDim('width') ?? (vb ? parseFloat(vb[1]) : null);
    const h = attrDim('height') ?? (vb ? parseFloat(vb[2]) : null);
    if (w == null || h == null || w < 200 || h < 200) continue;

    // Distinct fill paints (attributes and inline styles), excluding
    // non-paints. Multiple fills are what turn a shape pile into a scene.
    const fills = new Set();
    for (const fm of block.matchAll(/\bfill\s*[:=]\s*["']?\s*([^"';>}\s]+)/gi)) {
      const paint = fm[1].trim().toLowerCase();
      if (!paint || ['none', 'transparent', 'currentcolor', 'inherit'].includes(paint)) continue;
      fills.add(paint);
    }
    if (fills.size < 3) continue;

    findings.push({
      id: 'shape-assembled-illustration',
      snippet: `inline <svg> scene: ${primitives} primitive shapes, ~${Math.round(w)}x${Math.round(h)}px, ${fills.size} fill colors`,
    });
  }
  return findings;
}

/**
 * Regex-on-HTML checks shared between browser and Node page-level detection.
 * These don't need DOM access, just the raw HTML string.
 */
function checkHtmlPatterns(html) {
  const findings = [];

  // --- Color ---

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

  // --- Borders ---

  // Side-tab accent stripe drawn as an absolutely-positioned pseudo-element
  // (no border property involved, so the element-level border checks and
  // the border-left regexes never see it).
  findings.push(...scanCssTextForPseudoStripe(html));

  // Side-tab accent stripe drawn as a single-edge inset box-shadow.
  findings.push(...scanCssTextForInsetStripe(html));

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
  const bounceRe = /animation(?:-name)?\s*:\s*([^;{}]*(?:bounce|elastic|wobble|jiggle|spring)[^;{}]*)/gi;
  const bounceMatch = bounceRe.exec(html);
  if (bounceMatch) {
    const animationToken = bounceMatch[1]
      .split(/[,\s]+/)
      .find((part) => /bounce|elastic|wobble|jiggle|spring/i.test(part));
    findings.push({ id: 'bounce-easing', snippet: `animation: ${animationToken || bounceMatch[1].trim()}` });
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

  // Pulsing status dots (tiny circular elements on infinite pulse animations)
  findings.push(...scanCssTextForPulsingDot(html));

  // Shape-assembled illustrations (large pictorial SVGs built from primitives)
  findings.push(...scanHtmlForShapeAssembledIllustration(html));

  // Auto-scrolling marquees (<marquee> or infinite horizontal loop animations)
  findings.push(...scanCssTextForMarquee(html));

  // --- Dark glow / chromatic halo shadows ---

  const glowHits = scanCssTextForGlow(html);
  if (glowHits.length > 0) {
    findings.push({ id: 'dark-glow', snippet: glowHits[0].snippet });
  }

  // Radial-gradient background halo (gradient-drawn sibling of dark-glow)
  const haloHits = scanCssTextForRadialHalo(html);
  if (haloHits.length > 0) {
    findings.push({ id: 'radial-halo', snippet: haloHits[0].snippet });
  }

  // --- Generated-UI tells: repeating-gradient stripes ---
  if (/repeating-(?:linear|radial|conic)-gradient\s*\(/i.test(html)) {
    findings.push({ id: 'repeating-stripes-gradient', snippet: 'repeating-gradient decorative stripes' });
  }

  // --- Generated-UI tells: two-axis grid-line background ---
  // The Codex grid tell is two hairline `linear-gradient(... <color> 1px,
  // transparent 1px)` layers (one per axis) tiled by a repeating
  // `background-size` cell. Both signals must co-occur in the SAME style block
  // (a CSS rule body or one inline `style="..."`): two hairline stops WITHOUT a
  // tiling background-size is a fixed crosshair, not a grid, and a single
  // hairline is a legitimate ruled line. Scoping to one block also stops
  // unrelated single-axis rules on separate elements from adding up across the
  // page. Count hairlines only inside `background`/`background-image` values so
  // a hairline in an unrelated property (mask-image, border-image) can't stand
  // in for the second axis. Colors like `oklch(96% 0.012 82 / 0.055)` carry
  // nested parens, so match the hairline stop directly rather than parsing
  // whole gradient layers.
  const gridHits = scanCssTextForGridBackground(html);
  if (gridHits.length > 0) {
    findings.push({ id: 'codex-grid-background', snippet: gridHits[0].snippet });
  }

  // --- Generated-copy tells: "X theater" framing copy ---
  // Lives here (regex-on-HTML) rather than in the text-content analyzers so it
  // runs in the bundled browser path too, not just the CLI/static path.
  {
    const bodyText = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const tm = /\b(\w+)\s+theater\b/i.exec(bodyText);
    if (tm) findings.push({ id: 'theater-slop-phrase', snippet: `"${tm[0].trim()}"` });
  }

  // --- Generated-UI tells: image hover transform ---
  // A CSS `img...:hover { transform: ... }` rule, or a Tailwind hover:scale /
  // hover:rotate / hover:translate utility on an <img>. Each distinct
  // mechanism is its own finding.
  const imgHoverCss = /\bimg\b[^,{}]*:hover\b[^{}]*\{[^}]*\btransform\s*:\s*(?:scale|rotate|translate|matrix|skew)/i;
  if (imgHoverCss.test(html)) {
    findings.push({ id: 'image-hover-transform', snippet: 'img:hover { transform } rule' });
  }
  const imgTagRe = /<img\b[^>]*\bclass\s*=\s*"([^"]*)"/gi;
  let im;
  while ((im = imgTagRe.exec(html)) !== null) {
    if (/\bhover:(?:scale|rotate|translate|skew)-/.test(im[1])) {
      findings.push({ id: 'image-hover-transform', snippet: 'Tailwind hover transform on <img>' });
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
  // Real browsers keep wide-gamut/computed color functions (oklch(), oklab(),
  // color-mix() results) in getComputedStyle output, which plain parseRgb
  // misses — a flat oklch button background would silently skip every
  // contrast check without the parseAnyColor fallback.
  const bg = parseRgb(computedStyle.backgroundColor) || parseAnyColor(computedStyle.backgroundColor);
  if (DETECTOR_IS_BROWSER || (bg && bg.a >= 0.1)) return bg;
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

function resolveBackground(el, win, customPropMap) {
  let current = el;
  // Translucent layers (0.1 < a < 1) found on the way down to an opaque
  // base. A browser composites these over the base; the old behavior
  // either returned them as-if-opaque (browser mode) or skipped them
  // entirely (static mode), both of which misstate the effective surface
  // for contrast checks (e.g. `background: color-mix(in oklab, var(--hot)
  // 16%, transparent)` chips on dark pages).
  const overlays = [];
  const flatten = (base) => {
    let acc = base;
    for (let i = overlays.length - 1; i >= 0; i--) acc = compositeColorOver(overlays[i], acc);
    return acc;
  };
  while (current && current.nodeType === 1) {
    const style = DETECTOR_IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);
    const bgImage = style.backgroundImage || '';
    const hasGradientOrUrl = bgImage && bgImage !== 'none' && (/gradient/i.test(bgImage) || /url\s*\(/i.test(bgImage));

    // Try the solid bg-color FIRST. If the element has both a solid color
    // and a gradient/url overlay (a common pattern: `background: var(--paper)
    // radial-gradient(...)` for paper-grain texture), the solid color is the
    // dominant visible surface for contrast purposes; the overlay is
    // decorative. The old behavior bailed on any gradient ancestor, which
    // caused massive false-positive contrast findings on grain-textured
    // body backgrounds.
    // Real browsers serialize wide-gamut computed values as oklab()/oklch()
    // (e.g. any color-mix() result), which plain parseRgb misses.
    let bg = parseRgb(style.backgroundColor) || parseAnyColor(style.backgroundColor);
    if (!DETECTOR_IS_BROWSER && (!bg || bg.a < 0.1)) {
      // jsdom returns literal "var(--X)" / "oklch(...)" strings. Resolve
      // through customPropMap so Tailwind v4 color tokens become RGB.
      if (customPropMap) {
        bg = parseColorResolved(style.backgroundColor, customPropMap);
      }
      if (!bg || bg.a < 0.1) {
        // Inline-style fallback. jsdom doesn't decompose background
        // shorthand, so colors set via inline style are otherwise invisible.
        const rawStyle = current.getAttribute?.('style') || '';
        const bgMatch = rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
        const inlineBg = bgMatch ? bgMatch[1].trim() : '';
        if (inlineBg && !/gradient/i.test(inlineBg) && !/url\s*\(/i.test(inlineBg)) {
          bg = parseColorResolved(inlineBg, customPropMap) || parseAnyColor(inlineBg);
        }
      }
    }

    if (bg && bg.a > 0.1) {
      if (bg.a >= 0.99) return flatten(bg);
      overlays.push(bg);
    }
    // No solid bg-color at this level. If THIS level has a gradient/url
    // with no underlying solid color we can read:
    //   • on body/html: assume white. Body-level gradients are almost
    //     always decorative texture (paper grain, noise) on top of a
    //     solid bg-color the page set via `background: var(--paper)`
    //     shorthand — which jsdom can't decompose into bg-color. The
    //     downstream gradient-stops fallback path produces catastrophic
    //     false positives in this case (gradient noise stops have
    //     accidental browns/blacks that look like card backgrounds).
    //   • on other elements: bail to null and let the caller fall back
    //     to gradient stops (gradient buttons / hero sections are real
    //     bgs worth checking against).
    if (hasGradientOrUrl) {
      if (current.tagName === 'BODY' || current.tagName === 'HTML') {
        return flatten({ r: 255, g: 255, b: 255, a: 1 });
      }
      return null;
    }
    current = current.parentElement;
  }
  return flatten({ r: 255, g: 255, b: 255, a: 1 });
}

// Walk parents looking for a gradient background and return its color stops.
// Used as a fallback when resolveBackground() returns null because the
// effective background is a gradient (no single solid color to compare against).
function resolveGradientStops(el, win) {
  let current = el;
  while (current && current.nodeType === 1) {
    const style = DETECTOR_IS_BROWSER ? getComputedStyle(current) : win.getComputedStyle(current);
    const bgImage = style.backgroundImage || '';
    if (bgImage && bgImage !== 'none' && /gradient/i.test(bgImage)) {
      const stops = parseGradientColors(bgImage);
      if (stops.length > 0) return stops;
    }
    if (!DETECTOR_IS_BROWSER) {
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

function resolveBorderRadiusPx(el, style, widthPx, win) {
  const fromComputed = parseRadiusToPx(style.borderRadius, widthPx);
  if (fromComputed !== null) return fromComputed;
  return 0;
}

// ─── Section 5: Element Adapters ────────────────────────────────────────────

// Browser adapters — call getComputedStyle/getBoundingClientRect on live DOM

// Selected-state context for accent stripes. Only an actual selection
// marker exempts the stripe as the standard active-item indicator:
// aria-selected="true", aria-current (any non-false value), or an
// active/current/selected class hint. Tab-strip MEMBERSHIP alone
// ([role=tablist]/[role=tab]/.tabs ancestry, aria-selected="false")
// deliberately does not — a chromatic stripe repeated on every tab in
// the group, or on every menu item, is decoration, not state; the
// selected item's own underline stays legal.
function isTabContextElement(el) {
  if (!el) return false;
  try {
    if (el.closest?.('[aria-selected="true"], [aria-current]:not([aria-current="false"])')) return true;
  } catch { /* selector engine differences — fall through to class scan */ }
  let cur = el, depth = 0;
  while (cur && cur.nodeType === 1 && depth < 6) {
    const cls = String(cur.getAttribute?.('class') || cur.className || '');
    if (/(?:^|[\s_-])(?:active|current|selected)(?:$|[\s_-])/i.test(cls)) return true;
    cur = cur.parentElement;
    depth++;
  }
  return false;
}

// Status-surface context for accent borders. On a live status/alert region
// (role=status|alert|alertdialog|log, or aria-live=polite|assertive) a colored
// single-edge border is the established severity-accent convention — a toast,
// snackbar, or callout bar — not the decorative side-tab tell. The element
// itself or a wrapping live region qualifies. This never fires from the
// CSS-only / regex scanners, which have no role information.
function isStatusContextElement(el) {
  if (!el) return false;
  try {
    if (el.closest?.('[role="status"], [role="alert"], [role="alertdialog"], [role="log"], [aria-live="polite"], [aria-live="assertive"]')) return true;
  } catch { /* selector engine differences — fall through */ }
  return false;
}

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
  const ownBg = parseRgb(style.backgroundColor) || parseAnyColor(style.backgroundColor);
  return checkBorders(tag, widths, colors, parseFloat(style.borderRadius) || 0, {
    tabContext: isTabContextElement(el),
    statusContext: isStatusContextElement(el),
    badgeLike: !!(ownBg && (ownBg.a ?? 1) > 0.1),
  });
}

// Browser-side twin of scanCssTextForPseudoStripe. The text scanner reads
// stylesheet source, so a stripe whose color only exists at runtime (an
// inline per-card custom property, a JS-assigned var) or whose geometry
// resolves in layout never matches it. In a real browser the pseudo-element's
// computed style carries the actual used color and px geometry — check those
// directly. Gates mirror the text scanner: 3-12px thick, chromatic fill,
// spanning (nearly) the full edge; corner rounding on the host card is
// irrelevant. Exemptions stay narrow: structural/prose tags, real selection
// markers (isTabContextElement), and button/link affordances for the
// horizontal variant.
function checkElementPseudoStripeDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (BORDER_SAFE_TAGS.has(tag) || tag === 'summary') return [];
  if (el.closest?.('nav, blockquote, pre')) return [];
  if (!isRenderedForBrowserRule(el)) return [];
  const rect = el.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 20) return [];
  if (isTabContextElement(el)) return [];

  const findings = [];
  for (const which of ['::before', '::after']) {
    let ps;
    try { ps = getComputedStyle(el, which); } catch { continue; }
    if (!ps || ps.content === 'none' || ps.content === '') continue;
    if (ps.position !== 'absolute' && ps.position !== 'fixed') continue;
    if ((parseFloat(ps.opacity) || 0) <= 0.01 || ps.display === 'none') continue;
    const w = parseFloat(ps.width) || 0;
    const h = parseFloat(ps.height) || 0;
    if (!(w > 0 && h > 0)) continue;

    // Used values: for absolutely-positioned boxes the browser resolves
    // both edge offsets after layout, so left/right (and top/bottom) are
    // real distances, never "auto".
    const left = parseFloat(ps.left);
    const right = parseFloat(ps.right);
    const top = parseFloat(ps.top);
    const bottom = parseFloat(ps.bottom);
    const hugs = (v) => Number.isFinite(v) && v >= -2 && v <= 2;

    let edge = null;
    let thickness = null;
    // Vertical stripe: narrow box spanning (nearly) the full height of the
    // host, hugging its left or right edge. "Nearly" tolerates the floating
    // variant that backs off each end by a small inset.
    if (w >= 3 && w <= 12 && h >= rect.height - 44 && h >= rect.height * 0.5) {
      edge = hugs(left) ? 'left' : hugs(right) ? 'right' : null;
      thickness = w;
    }
    // Horizontal stripe riding the top or bottom edge. Button/link-styled
    // hosts keep their underline affordances.
    if (!edge && h >= 3 && h <= 12 && w >= rect.width - 44 && w >= rect.width * 0.5) {
      const cls = String(el.getAttribute?.('class') || el.className || '');
      if (!/(?:^|[\s_-])(?:btn|button|link)(?:$|[\s\w_-])/i.test(cls)) {
        edge = hugs(top) ? 'top' : hugs(bottom) ? 'bottom' : null;
        thickness = h;
      }
    }
    if (!edge) continue;

    const bg = parseRgb(ps.backgroundColor) || parseAnyColor(ps.backgroundColor);
    if (!bg || (bg.a ?? 1) < 0.1) continue;
    if (Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b) < 30) continue;

    findings.push({
      id: 'side-tab',
      snippet: `${classSelector(el)}${which} — absolute ${thickness}px pseudo-element stripe (${edge})`,
    });
  }
  return findings;
}

// Full-cover surface pseudo (browser): a ::before/::after positioned
// absolute/fixed whose box covers (nearly) the whole host and carries an
// opaque background. That pseudo is the element's visible surface even
// though the element's own background-color reads transparent — the nav-CTA
// construction that otherwise escapes every own-background contrast gate.
function readPseudoSurfaceDOM(el, rect) {
  for (const which of ['::before', '::after']) {
    let ps;
    try { ps = getComputedStyle(el, which); } catch { continue; }
    if (!ps || ps.content === 'none' || ps.content === '') continue;
    if (ps.position !== 'absolute' && ps.position !== 'fixed') continue;
    if (ps.display === 'none' || (parseFloat(ps.opacity) || 1) < 0.9) continue;
    const w = parseFloat(ps.width) || 0;
    const h = parseFloat(ps.height) || 0;
    if (w < rect.width - 4 || h < rect.height - 4) continue;
    const bg = parseRgb(ps.backgroundColor) || parseAnyColor(ps.backgroundColor);
    if (!bg || (bg.a ?? 1) < 0.9) continue;
    return bg;
  }
  return null;
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
  let effectiveBg = resolveBackground(el);
  let ownBg = readOwnBackgroundColor(el, style);
  if (!ownBg || (ownBg.a ?? 1) <= 0.5) {
    const pseudoSurface = readPseudoSurfaceDOM(el, rect);
    if (pseudoSurface) {
      ownBg = pseudoSurface;
      effectiveBg = pseudoSurface;
    }
  }
  return checkColors({
    tag,
    // Chrome serializes computed colors specified in modern spaces as
    // oklch()/oklab() strings; without the parseAnyColor fallback the text
    // color comes back null and the low-contrast / gray-on-color checks
    // silently never run (the shipped miss: a nav CTA whose text color was
    // an oklch token near its own oklch background).
    textColor: parseRgb(style.color) || parseAnyColor(style.color),
    bgColor: ownBg,
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

function domAccentDashPseudo(el) {
  for (const which of ['::before', '::after']) {
    let ps;
    try { ps = getComputedStyle(el, which); } catch { continue; }
    if (!ps || ps.content === 'none' || ps.content === '') continue;
    const w = parseFloat(ps.width) || 0;
    const h = parseFloat(ps.height) || 0;
    if (!(w >= 8 && w <= 80 && h >= 1 && h <= 6)) continue;
    const bg = parseRgb(ps.backgroundColor) || parseAnyColor(ps.backgroundColor);
    if (!bg || (bg.a ?? 1) < 0.1) continue;
    if (Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b) >= 30) return true;
  }
  return false;
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
    headingInApplicationContext: !!el.closest('[role="tabpanel"], [role="dialog"], [role="application"], dialog'),
    siblingTag: sibling.tagName.toLowerCase(),
    siblingText: sibling.textContent || '',
    siblingTextTransform: sibStyle.textTransform || '',
    siblingFontSize: parseFloat(sibStyle.fontSize) || 0,
    siblingLetterSpacing: parseFloat(sibStyle.letterSpacing) || 0,
    siblingFontWeight: sibStyle.fontWeight || '',
    siblingColor: sibStyle.color || '',
    siblingHasAccentDashPseudo: domAccentDashPseudo(sibling),
  });
}

// Build a map of CSS custom properties declared on :root / :host / html.
// Used to resolve var(--X) refs that jsdom returns verbatim in
// getComputedStyle. Tailwind v4 routes every utility class through
// CSS vars (font-weight: var(--font-weight-bold), font-size:
// var(--text-xs), letter-spacing: var(--tracking-widest)), so without
// resolution every style-based check silently fails on Tailwind v4
// builds — the values come back as literal "var(--font-weight-bold)"
// strings and parseFloat returns NaN.
function buildCustomPropMap(document) {
  const map = new Map();
  let sheets;
  try { sheets = Array.from(document.styleSheets || []); }
  catch { return map; }
  for (const sheet of sheets) {
    let rules;
    try { rules = Array.from(sheet.cssRules || []); }
    catch { continue; }
    for (const rule of rules) {
      // Style rules only (type 1). Walk @media / @supports if present.
      if (rule.type === 4 /* MEDIA_RULE */ || rule.type === 12 /* SUPPORTS_RULE */) {
        try { rules.push(...Array.from(rule.cssRules || [])); } catch { /* ignore */ }
        continue;
      }
      if (rule.type !== 1 /* STYLE_RULE */) continue;
      const sel = rule.selectorText || '';
      if (!/(^|,\s*)(:root|html|:host)\b/i.test(sel)) continue;
      const style = rule.style;
      if (!style) continue;
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (!prop || !prop.startsWith('--')) continue;
        const val = style.getPropertyValue(prop).trim();
        if (val) map.set(prop, val);
      }
    }
  }
  return map;
}

// Resolve var(--X[, fallback]) refs in a computed-style value string.
// Recurses up to 8 levels for chained refs (--a: var(--b)). Returns
// the original string when no refs are present or the chain doesn't
// resolve. Safe to call on already-resolved values.
function resolveVarRefs(raw, customPropMap, depth = 0) {
  if (typeof raw !== 'string' || !raw.includes('var(')) return raw;
  if (depth > 8) return raw;
  return raw.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, name, fallback) => {
    const v = customPropMap.get(name);
    if (v != null) return resolveVarRefs(v, customPropMap, depth + 1);
    return fallback ? resolveVarRefs(fallback.trim(), customPropMap, depth + 1) : _m;
  });
}

// OKLCH → sRGB conversion (Björn Ottosson's matrices). L in 0..1 (or %),
// C in 0..~0.4 typical, H in degrees. Returns clamped {r,g,b,a:1} in 0..255.
// Needed because jsdom doesn't compute oklch() values — getComputedStyle
// returns the literal "oklch(...)" string. Without this, the entire
// Tailwind v4 color palette (which is OKLCH-based) is invisible to the
// detector's contrast / color checks.
function oklchToRgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(hRad), C * Math.sin(hRad));
}

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc = s_ * s_ * s_;
  const rLin =  4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
  const enc = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return {
    r: Math.round(enc(rLin) * 255),
    g: Math.round(enc(gLin) * 255),
    b: Math.round(enc(bLin) * 255),
    a: 1,
  };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return {
    r: Math.round((r + m0) * 255),
    g: Math.round((g + m0) * 255),
    b: Math.round((b + m0) * 255),
    a: 1,
  };
}

function hwbToRgb(h, w, bl) {
  if (w + bl >= 1) {
    const g = Math.round((w / (w + bl)) * 255);
    return { r: g, g, b: g, a: 1 };
  }
  const base = hslToRgb(h, 1, 0.5);
  const mix = (c) => Math.round(((c / 255) * (1 - w - bl) + w) * 255);
  return { r: mix(base.r), g: mix(base.g), b: mix(base.b), a: 1 };
}

// Common CSS named colors — the handful that actually show up in generated
// UIs, not the full 148-name spec list. Includes the achromatic names so a
// named gray parses (and correctly reads as no-chroma) instead of being
// treated as an unknown color.
const CSS_NAMED_COLORS = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  silver: { r: 192, g: 192, b: 192 },
  dimgray: { r: 105, g: 105, b: 105 },
  darkgray: { r: 169, g: 169, b: 169 },
  lightgray: { r: 211, g: 211, b: 211 },
  gainsboro: { r: 220, g: 220, b: 220 },
  whitesmoke: { r: 245, g: 245, b: 245 },
  red: { r: 255, g: 0, b: 0 },
  crimson: { r: 220, g: 20, b: 60 },
  tomato: { r: 255, g: 99, b: 71 },
  coral: { r: 255, g: 127, b: 80 },
  salmon: { r: 250, g: 128, b: 114 },
  orange: { r: 255, g: 165, b: 0 },
  gold: { r: 255, g: 215, b: 0 },
  yellow: { r: 255, g: 255, b: 0 },
  olive: { r: 128, g: 128, b: 0 },
  lime: { r: 0, g: 255, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  teal: { r: 0, g: 128, b: 128 },
  turquoise: { r: 64, g: 224, b: 208 },
  cyan: { r: 0, g: 255, b: 255 },
  aqua: { r: 0, g: 255, b: 255 },
  skyblue: { r: 135, g: 206, b: 235 },
  dodgerblue: { r: 30, g: 144, b: 255 },
  blue: { r: 0, g: 0, b: 255 },
  navy: { r: 0, g: 0, b: 128 },
  indigo: { r: 75, g: 0, b: 130 },
  rebeccapurple: { r: 102, g: 51, b: 153 },
  purple: { r: 128, g: 0, b: 128 },
  violet: { r: 238, g: 130, b: 238 },
  orchid: { r: 218, g: 112, b: 214 },
  magenta: { r: 255, g: 0, b: 255 },
  fuchsia: { r: 255, g: 0, b: 255 },
  hotpink: { r: 255, g: 105, b: 180 },
  pink: { r: 255, g: 192, b: 203 },
  maroon: { r: 128, g: 0, b: 0 },
};

// Split a string on top-level commas (ignoring commas nested in parens).
function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

// Evaluate a CSS color-mix() expression to {r,g,b,a}. Returns null when
// the expression can't be resolved (unresolved var(), unknown colors).
//
// Mixing is done with premultiplied alpha in sRGB regardless of the
// declared interpolation space. That is exact for the dominant generated-UI
// pattern — `color-mix(in oklab, <color> N%, transparent)` — where the
// result is simply <color> at alpha N% in ANY rectangular space, and a
// close-enough approximation for opaque-opaque mixes (the detector only
// consumes these values for contrast/chroma thresholds, not for display).
function parseColorMix(str) {
  const m = String(str).trim().match(/^color-mix\(/i);
  if (!m) return null;
  // Balanced-paren capture of the arguments.
  let depth = 0, end = -1;
  const open = str.indexOf('(');
  for (let i = open; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const args = splitTopLevelCommas(str.slice(open + 1, end));
  if (args.length !== 3 || !/^in\s/i.test(args[0])) return null;

  const parseComponent = (component) => {
    // Percentage may lead or trail the color per spec.
    let pct = null;
    let colorStr = component;
    const trail = component.match(/\s+([\d.]+)%$/);
    const lead = component.match(/^([\d.]+)%\s+/);
    if (trail) { pct = parseFloat(trail[1]); colorStr = component.slice(0, trail.index).trim(); }
    else if (lead) { pct = parseFloat(lead[1]); colorStr = component.slice(lead[0].length).trim(); }
    let color;
    if (/^transparent$/i.test(colorStr)) color = { r: 0, g: 0, b: 0, a: 0 };
    else color = parseAnyColor(colorStr);
    if (!color) return null;
    return { color, pct };
  };

  const c1 = parseComponent(args[1]);
  const c2 = parseComponent(args[2]);
  if (!c1 || !c2) return null;
  let p1 = c1.pct, p2 = c2.pct;
  if (p1 == null && p2 == null) { p1 = 50; p2 = 50; }
  else if (p1 == null) p1 = 100 - p2;
  else if (p2 == null) p2 = 100 - p1;
  const sum = p1 + p2;
  if (sum <= 0) return null;
  // Per spec: weights normalize to sum; when sum < 100 the result alpha is
  // additionally scaled by sum/100.
  const w1 = p1 / sum, w2 = p2 / sum;
  const alphaScale = sum < 100 ? sum / 100 : 1;
  const a1 = c1.color.a ?? 1, a2 = c2.color.a ?? 1;
  const a = (a1 * w1 + a2 * w2) * alphaScale;
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (ch) => Math.round((c1.color[ch] * a1 * w1 + c2.color[ch] * a2 * w2) / (a1 * w1 + a2 * w2));
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: Math.min(1, a) };
}

// Composite a translucent color over an opaque(ish) base (simple
// source-over in sRGB). Returns an opaque {r,g,b,a:1}.
function compositeColorOver(top, base) {
  const a = top.a ?? 1;
  return {
    r: Math.round(top.r * a + base.r * (1 - a)),
    g: Math.round(top.g * a + base.g * (1 - a)),
    b: Math.round(top.b * a + base.b * (1 - a)),
    a: 1,
  };
}

// Extended color parser: rgb/rgba/hex/oklch/oklab/hsl/hwb/color-mix/common
// named colors. Returns null on no match. Use this when the input might be
// any CSS color form; use plain parseRgb when you only expect computed rgb()
// values from real browsers.
function parseAnyColor(s) {
  if (!s || typeof s !== 'string') return null;
  const str = s.trim();
  if (str === 'transparent' || str === 'currentcolor' || str === 'inherit') return null;
  if (/^color-mix\(/i.test(str)) return parseColorMix(str);
  let m;
  m = str.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: m[4] !== undefined ? +m[4] : 1 };
  m = str.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  // OKLCH parser. Tailwind v4's CSS minifier squishes the space after
  // `%` ("21.5%.02 50"), so the separator between L and C may be absent.
  // Match L (with optional %), then C and H separated permissively.
  m = str.match(/oklch\(\s*([\d.]+)(%?)\s*[\s,]*\s*([\d.]+)\s*[\s,]+\s*([-\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/i);
  if (m) {
    const Lnum = parseFloat(m[1]);
    const L = m[2] === '%' ? Lnum / 100 : Lnum;
    const rgb = oklchToRgb(L, parseFloat(m[3]), parseFloat(m[4]));
    if (m[5] !== undefined) {
      const alpha = parseFloat(m[5]);
      rgb.a = m[6] === '%' ? alpha / 100 : alpha;
    }
    return rgb;
  }
  // OKLAB — a/b are signed axes; percentages map 100% → 0.4.
  m = str.match(/oklab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)(%?)\s+(-?[\d.]+)(%?)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/i);
  if (m) {
    const L = m[2] === '%' ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const a = m[4] === '%' ? parseFloat(m[3]) * 0.004 : parseFloat(m[3]);
    const b = m[6] === '%' ? parseFloat(m[5]) * 0.004 : parseFloat(m[5]);
    const rgb = oklabToRgb(L, a, b);
    if (m[7] !== undefined) {
      const alpha = parseFloat(m[7]);
      rgb.a = m[8] === '%' ? alpha / 100 : alpha;
    }
    return rgb;
  }
  // HSL/HSLA — comma or space syntax, optional deg on hue.
  m = str.match(/hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)/i);
  if (m) {
    const rgb = hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
    if (m[4] !== undefined) {
      const alpha = parseFloat(m[4]);
      rgb.a = m[5] === '%' ? alpha / 100 : alpha;
    }
    return rgb;
  }
  // HWB — hue whiteness% blackness%.
  m = str.match(/hwb\(\s*(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+)(%)?)?\s*\)/i);
  if (m) {
    const rgb = hwbToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
    if (m[4] !== undefined) {
      const alpha = parseFloat(m[4]);
      rgb.a = m[5] === '%' ? alpha / 100 : alpha;
    }
    return rgb;
  }
  const named = CSS_NAMED_COLORS[str.toLowerCase()];
  if (named) return { ...named, a: 1 };
  return null;
}

// Resolve var() refs in a color string (via customPropMap), then parse.
// Returns null on any failure. Used in jsdom-mode paths where
// getComputedStyle returns literal "var(--X)" or "oklch(...)" strings.
function parseColorResolved(str, customPropMap) {
  if (!str) return null;
  const resolved = customPropMap ? resolveVarRefs(str, customPropMap) : str;
  return parseAnyColor(resolved);
}

const REPEATED_KICKER_SKIP_SELECTOR = [
  'nav',
  'form',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'figure',
  'figcaption',
  'ol',
  'ul',
  'li',
  '[role="navigation"]',
  '[aria-label*="breadcrumb" i]',
  '[class*="breadcrumb" i]',
  '[aria-hidden="true"]',
  '[data-impeccable-allow-kickers]',
].join(',');

const REPEATED_KICKER_CARD_CONTEXT_SELECTOR = [
  'article',
  'button',
  'a',
  'li',
  '[role="listitem"]',
  '[role="option"]',
].join(',');

function cleanInlineText(el) {
  return [...el.childNodes]
    .filter(n => n.nodeType === 3)
    .map(n => n.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRepeatedKickerCardContext(heading, kicker) {
  const item = heading.closest?.(REPEATED_KICKER_CARD_CONTEXT_SELECTOR);
  return Boolean(item && (!item.contains || item.contains(kicker)));
}

function isRepeatedKickerCandidate(opts) {
  const {
    headingTag,
    headingText,
    headingFontSize,
    kickerTag,
    kickerText,
    kickerTextTransform,
    kickerFontSize,
    kickerLetterSpacing,
  } = opts;
  if (!['h2', 'h3', 'h4'].includes(headingTag)) return false;
  if (!headingText || headingText.length < 3) return false;
  if (/^\/[\w-]+/i.test(headingText.replace(/^"|"$/g, '').trim())) return false;
  if (!(headingFontSize >= 20)) return false;
  if (!kickerTag || HEADING_TAGS.has(kickerTag)) return false;
  if (!['p', 'span', 'div', 'small'].includes(kickerTag)) return false;
  if (!kickerText || kickerText.length < 2 || kickerText.length > 34) return false;
  if (/^step\s*\d+/i.test(kickerText) || /^\d{1,2}$/.test(kickerText)) return false;

  const isUppercased = kickerTextTransform === 'uppercase'
    || (/[A-Z]/.test(kickerText) && !/[a-z]/.test(kickerText));
  if (!isUppercased) return false;
  if (!(kickerFontSize > 0 && kickerFontSize <= 14)) return false;
  const minTrackedSpacing = Math.max(1, kickerFontSize * 0.08);
  if (!(kickerLetterSpacing >= minTrackedSpacing)) return false;
  return true;
}

function collectRepeatedSectionKickerCandidates(doc, getStyle, resolveLetterSpacing) {
  const candidates = [];
  for (const heading of doc.querySelectorAll('h2, h3, h4')) {
    if (heading.closest?.(REPEATED_KICKER_SKIP_SELECTOR)) continue;
    const kicker = heading.previousElementSibling;
    if (!kicker || kicker.closest?.(REPEATED_KICKER_SKIP_SELECTOR)) continue;
    if (isRepeatedKickerCardContext(heading, kicker)) continue;

    const headingStyle = getStyle(heading);
    const kickerStyle = getStyle(kicker);
    const headingText = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    const kickerText = cleanInlineText(kicker) || (kicker.textContent || '').replace(/\s+/g, ' ').trim();
    const headingFontSize = resolveLetterSpacing(headingStyle.fontSize || '', 16) || parseFloat(headingStyle.fontSize) || 0;
    const kickerFontSize = resolveLetterSpacing(kickerStyle.fontSize || '', 16) || parseFloat(kickerStyle.fontSize) || 0;
    const kickerLetterSpacing = resolveLetterSpacing(kickerStyle.letterSpacing || '', kickerFontSize);

    if (!isRepeatedKickerCandidate({
      headingTag: heading.tagName.toLowerCase(),
      headingText,
      headingFontSize,
      kickerTag: kicker.tagName.toLowerCase(),
      kickerText,
      kickerTextTransform: kickerStyle.textTransform || '',
      kickerFontSize,
      kickerLetterSpacing,
    })) {
      continue;
    }

    candidates.push({
      headingTag: heading.tagName.toLowerCase(),
      headingText: headingText.replace(/^"|"$/g, '').slice(0, 60),
      kickerText: kickerText.slice(0, 40),
    });
  }
  return candidates;
}

function checkRepeatedSectionKickersDOM() {
  const candidates = collectRepeatedSectionKickerCandidates(
    document,
    (el) => getComputedStyle(el),
    (value, fontSize) => resolveLengthPx(value, fontSize) || 0,
  );
  return checkRepeatedSectionKickers({ candidates });
}

// ── Numbered section labels ─────────────────────────────────────────────────
// Sibling of the repeated-kicker rule: instead of a tracked uppercase word,
// the section scaffold is a tiny numeric index riding beside each section
// heading — bare and zero-padded, or an index joined to a short micro-label
// by a separator glyph. The kicker rule deliberately excludes bare 1-2 digit
// labels; this rule owns that shape.

const NUMBERED_LABEL_TAGS = new Set(['span', 'p', 'div', 'small', 'em', 'strong', 'b']);

// Returns { index, text } when the trimmed text reads as a section index
// label, else null. Two accepted shapes: a zero-padded/two-digit bare index,
// or a 1-2 digit index followed by a non-word separator and a short label.
function parseNumberedLabelText(rawText) {
  const text = (rawText || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 40) return null;
  let m = /^(\d{2})$/.exec(text);
  if (!m) m = /^(\d{1,2})\s*[^\w\s]\s*\S/.exec(text);
  if (!m) return null;
  const index = parseInt(m[1], 10);
  if (!Number.isFinite(index) || index > 40) return null;
  return { index, text };
}

function isNumberedSectionLabelCandidate(opts) {
  const {
    headingTag, headingText, headingFontSize,
    labelTag, labelIndex, labelText,
    labelFontSize, labelLetterSpacing, labelFontWeight,
    labelFontFamily, labelTextTransform, labelColor,
  } = opts;
  if (!['h2', 'h3', 'h4'].includes(headingTag)) return false;
  if (!headingText || headingText.length < 3) return false;
  if (!labelTag || !NUMBERED_LABEL_TAGS.has(labelTag)) return false;
  if (labelIndex == null || !labelText) return false;
  // Tiny rendered size is the tell — a display-scale section number is a
  // different (deliberate) device and stays legal.
  if (!(labelFontSize > 0 && labelFontSize <= 13)) return false;
  // The heading must be visibly larger where we can resolve its size.
  // clamp()/var() sizes come back unparseable (0) in the static engine —
  // the remaining gates carry the check there.
  if (headingFontSize > 0 && headingFontSize < labelFontSize * 1.3) return false;
  // Deliberate micro-label styling separates the scaffold from incidental
  // small text: mono face, bold weight, tracking, uppercase, or accent color.
  const weight = Number(labelFontWeight) || 400;
  return /mono/i.test(labelFontFamily || '')
    || weight >= 600
    || (labelLetterSpacing || 0) >= 0.5
    || (labelTextTransform || '') === 'uppercase'
    || isAccentColor(labelColor || '');
}

function collectNumberedSectionLabelCandidates(doc, getStyle, resolveLetterSpacing) {
  const candidates = [];
  const seenLabels = new Set();
  for (const heading of doc.querySelectorAll('h2, h3, h4')) {
    if (heading.closest?.(REPEATED_KICKER_SKIP_SELECTOR)) continue;
    // The index sits either directly before the heading, or before the
    // wrapper the heading leads (label | <div><h2>…</h2>…</div>).
    let label = heading.previousElementSibling;
    if (!label) {
      const parent = heading.parentElement;
      const firstChild = parent?.children?.[0];
      if (firstChild === heading) label = parent.previousElementSibling;
    }
    if (!label || seenLabels.has(label)) continue;
    if (label.closest?.(REPEATED_KICKER_SKIP_SELECTOR)) continue;
    if (HEADING_TAGS.has(label.tagName.toLowerCase())) continue;
    if (isRepeatedKickerCardContext(heading, label)) continue;

    const labelText = cleanInlineText(label) || (label.textContent || '').replace(/\s+/g, ' ').trim();
    const parsed = parseNumberedLabelText(labelText);
    if (!parsed) continue;

    const headingStyle = getStyle(heading);
    const labelStyle = getStyle(label);
    const headingText = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    const headingFontSize = resolveLetterSpacing(headingStyle.fontSize || '', 16) || parseFloat(headingStyle.fontSize) || 0;
    const labelFontSize = resolveLetterSpacing(labelStyle.fontSize || '', 16) || parseFloat(labelStyle.fontSize) || 0;

    if (!isNumberedSectionLabelCandidate({
      headingTag: heading.tagName.toLowerCase(),
      headingText,
      headingFontSize,
      labelTag: label.tagName.toLowerCase(),
      labelIndex: parsed.index,
      labelText: parsed.text,
      labelFontSize,
      labelLetterSpacing: resolveLetterSpacing(labelStyle.letterSpacing || '', labelFontSize),
      labelFontWeight: labelStyle.fontWeight || '',
      labelFontFamily: labelStyle.fontFamily || '',
      labelTextTransform: labelStyle.textTransform || '',
      labelColor: labelStyle.color || '',
    })) {
      continue;
    }

    seenLabels.add(label);
    candidates.push({
      index: parsed.index,
      labelText: parsed.text.slice(0, 24),
      headingTag: heading.tagName.toLowerCase(),
      headingText: headingText.replace(/^"|"$/g, '').slice(0, 60),
    });
  }
  return candidates;
}

function checkNumberedSectionLabels(opts) {
  const { candidates, minCount = 2 } = opts;
  if (!Array.isArray(candidates) || candidates.length < minCount) return [];
  // A repeated identical number is some other device; the scaffold counts up.
  const distinctIndices = new Set(candidates.map(c => c.index));
  if (distinctIndices.size < 2) return [];
  return candidates.map(candidate => ({
    id: 'numbered-section-labels',
    snippet: `tiny numbered label "${candidate.labelText}" beside ${candidate.headingTag} "${candidate.headingText}" (${candidates.length} on page)`,
  }));
}

function checkNumberedSectionLabelsFromDoc(doc, win) {
  const candidates = collectNumberedSectionLabelCandidates(
    doc,
    (el) => win.getComputedStyle(el),
    (value, fontSize) => resolveLengthPx(value, fontSize) || 0,
  );
  return checkNumberedSectionLabels({ candidates });
}

function checkNumberedSectionLabelsDOM() {
  const candidates = collectNumberedSectionLabelCandidates(
    document,
    (el) => getComputedStyle(el),
    (value, fontSize) => resolveLengthPx(value, fontSize) || 0,
  );
  return checkNumberedSectionLabels({ candidates });
}

// Em-dash overuse (ADVISORY) — pure logic shared by the browser DOM check.
// Mirrors the regex/static-HTML analyzer in engines/regex/detect-text.mjs:
// two gates (absolute floor + density) so a long article using a few dashes is
// left alone while a short, dash-per-clause page is flagged. Operates on
// already-rendered text, so no HTML-entity decoding is needed (the browser has
// resolved `&mdash;` to the literal glyph). Exported for jsdom unit tests.
function checkEmDashOveruse(text) {
  const body = typeof text === 'string' ? text.replace(/\s+/g, ' ') : '';
  let count = 0;
  const re = /[—]|--(?=\S)/g;
  while (re.exec(body) !== null) count++;
  if (count < EM_DASH_FLOOR) return [];
  if (body.length > count * EM_DASH_CHARS_PER_DASH) return [];
  return [{ id: 'em-dash-overuse', snippet: `${count} em-dashes in body text` }];
}

function checkEmDashOveruseDOM() {
  const body = document.body;
  if (!body) return [];
  // innerText reflects rendered, visible text; fall back to textContent for
  // engines (jsdom) that don't compute innerText.
  const text = typeof body.innerText === 'string' && body.innerText
    ? body.innerText
    : (body.textContent || '');
  return checkEmDashOveruse(text);
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
  const boxShadow = style.boxShadow && style.boxShadow !== 'none' ? style.boxShadow : '';
  // text-shadow inherits: only check the element that introduces it, so one
  // declaration doesn't produce a finding on every descendant.
  let textShadow = style.textShadow && style.textShadow !== 'none' ? style.textShadow : '';
  if (textShadow && el.parentElement && getComputedStyle(el.parentElement).textShadow === textShadow) {
    textShadow = '';
  }
  if (!boxShadow && !textShadow) return [];
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
  return checkGlow({ tag, boxShadow, textShadow, effectiveBg: parentBg });
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

function cssColorIsTransparent(value) {
  if (!value) return true;
  const str = String(value).trim().toLowerCase();
  if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return true;
  const parsed = parseAnyColor(str);
  if (parsed) return (parsed.a ?? 1) <= 0.05;
  return /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(str);
}

function colorsNearlyMatch(a, b) {
  const ca = parseAnyColor(a);
  const cb = parseAnyColor(b);
  if (!ca || !cb) return false;
  const alphaDelta = Math.abs((ca.a ?? 1) - (cb.a ?? 1));
  const channelDelta = Math.max(
    Math.abs(ca.r - cb.r),
    Math.abs(ca.g - cb.g),
    Math.abs(ca.b - cb.b),
  );
  return alphaDelta <= 0.03 && channelDelta <= 3;
}

function getComputedStyleFor(win, el) {
  if (win && typeof win.getComputedStyle === 'function') {
    try { return win.getComputedStyle(el); } catch {}
  }
  if (typeof getComputedStyle === 'function') {
    try { return getComputedStyle(el); } catch {}
  }
  return null;
}

function hasVisibleBackgroundBoundary(style, el, win) {
  const bg = style?.backgroundColor || '';
  if (cssColorIsTransparent(bg)) return false;

  let parent = el?.parentElement || null;
  while (parent) {
    const parentStyle = getComputedStyleFor(win, parent);
    const parentBg = parentStyle?.backgroundColor || '';
    if (!cssColorIsTransparent(parentBg)) {
      return !colorsNearlyMatch(bg, parentBg);
    }
    parent = parent.parentElement;
  }

  return true;
}

const TEXT_EDGE_TAGS = new Set(['A', 'BUTTON', 'CODE', 'DD', 'DT', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE', 'SPAN', 'TD', 'TH']);

function hasMeaningfulDirectText(node) {
  if (!node?.childNodes) return false;
  for (const child of node.childNodes) {
    if (child.nodeType === 3 && child.textContent.trim().length > 4) return true;
  }
  return false;
}

function textDescendantsFlushSides(el, rect) {
  const flush = { top: false, right: false, bottom: false, left: false };
  if (!rect || !el?.querySelectorAll) return flush;
  const TEXT_EDGE_THRESHOLD = 4;
  const candidates = el.querySelectorAll('a, button, code, dd, dt, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, span, td, th');
  for (const node of candidates) {
    if (!TEXT_EDGE_TAGS.has(node.tagName) || !hasMeaningfulDirectText(node)) continue;
    let nodeRect = null;
    try { nodeRect = node.getBoundingClientRect(); } catch {}
    if (!nodeRect || nodeRect.width <= 0 || nodeRect.height <= 0) continue;
    if (nodeRect.bottom < rect.top || nodeRect.top > rect.bottom || nodeRect.right < rect.left || nodeRect.left > rect.right) continue;
    if (nodeRect.top - rect.top <= TEXT_EDGE_THRESHOLD) flush.top = true;
    if (rect.right - nodeRect.right <= TEXT_EDGE_THRESHOLD) flush.right = true;
    if (rect.bottom - nodeRect.bottom <= TEXT_EDGE_THRESHOLD) flush.bottom = true;
    if (nodeRect.left - rect.left <= TEXT_EDGE_THRESHOLD) flush.left = true;
  }
  return flush;
}

// Screen-reader-only ("visually hidden") text is exempt from the tiny-text
// floors: it is never rendered, so its size is irrelevant. Detect the two
// standard idioms — a known sr-only class on the element or an ancestor, and
// the clip / 1px-box pattern. Works in both jsdom (declared styles) and the
// browser (computed styles).
const SR_ONLY_SELECTOR = '.sr-only, .visually-hidden, .visuallyhidden, .screen-reader, .screen-reader-only, .screenreader, .a11y-hidden, .hidden-visually, [class*="sr-only" i], [class*="visually-hidden" i], [class*="visuallyhidden" i], [class*="screen-reader" i], [class*="screenreader" i]';
function isVisuallyHidden(el, style) {
  if ((el.matches && el.matches(SR_ONLY_SELECTOR)) || (el.closest && el.closest(SR_ONLY_SELECTOR))) return true;
  const pos = style.position || '';
  if (pos === 'absolute' || pos === 'fixed') {
    const clip = style.clip || '';
    const clipPath = style.clipPath || style.webkitClipPath || style['clip-path'] || '';
    if (/rect\(\s*0/.test(clip) || /inset\(\s*(?:50%|99|100%)/.test(clipPath)) return true;
    const w = parseFloat(style.width);
    const h = parseFloat(style.height);
    const overflow = style.overflow || '';
    if ((w === 1 || h === 1) && (overflow === 'hidden' || overflow === 'clip')) return true;
  }
  return false;
}

// Pure quality checks. Most run on computed CSS and DOM-only inputs (work in
// jsdom and the browser). Two checks (line-length, cramped-padding) gate on
// element rect dimensions, which jsdom can't compute — pass `rect: null` from
// the Node adapter to skip those.
//
// Both adapters resolve font-size, line-height and letter-spacing to pixels
// before calling this so the pure function only deals with numbers.
function checkQuality(opts) {
  const { el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect, lineMax = 80, viewportWidth = 0, win = null } = opts;
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
  const isInlineCode = tag === 'code' && !(el.closest && el.closest('pre'));
  if (!isInlineCode && rect && hasDirectText && textLen > 20 && rect.width > 100 && rect.height > 30) {
    const borders = {
      top: parseFloat(style.borderTopWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
      bottom: parseFloat(style.borderBottomWidth) || 0,
      left: parseFloat(style.borderLeftWidth) || 0,
    };
    const borderCount = Object.values(borders).filter(w => w > 0).length;
    const hasBg = hasVisibleBackgroundBoundary(style, el, win);
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

  // --- Flush against a visible boundary ---
  // Fires when a container has a visible boundary (border, outline, OR a
  // non-transparent background) AND near-zero padding on the bounded
  // side(s) AND text-bearing children land flush against the boundary.
  //
  // Distinct from cramped-padding: that rule needs the element itself to
  // have direct text (hasDirectText). This rule targets the OPPOSITE
  // shape — a container with NO direct text, only children — which is
  // exactly what cramped-padding misses (a section wrapping a label +
  // list lands a free pass).
  //
  // The classic shape: agent writes `padding: 28px 0 0` shorthand on a
  // section that also has a border, zeroing horizontal padding so the
  // text-bearing children touch the side borders. Background and
  // outline count too: a colored card with zero padding has the same
  // visual failure mode.
  {
    const FLUSH_SKIP_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ARTICLE', 'ASIDE', 'BUTTON', 'A', 'LABEL', 'SUMMARY', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'FIGURE', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH']);
    const upperTag = tag ? tag.toUpperCase() : '';
    const elPosition = style.position || '';
    if (
      !FLUSH_SKIP_TAGS.has(upperTag) &&
      !hasDirectText &&
      !['fixed', 'absolute'].includes(elPosition) &&
      el.children && el.children.length > 0
    ) {
      const borderW = {
        top:    parseFloat(style.borderTopWidth)    || 0,
        right:  parseFloat(style.borderRightWidth)  || 0,
        bottom: parseFloat(style.borderBottomWidth) || 0,
        left:   parseFloat(style.borderLeftWidth)   || 0,
      };
      const borderVisible = {
        top:    borderW.top    > 0 && !cssColorIsTransparent(style.borderTopColor),
        right:  borderW.right  > 0 && !cssColorIsTransparent(style.borderRightColor),
        bottom: borderW.bottom > 0 && !cssColorIsTransparent(style.borderBottomColor),
        left:   borderW.left   > 0 && !cssColorIsTransparent(style.borderLeftColor),
      };
      // Outline detection. jsdom decomposes `border` shorthand into
      // border{Top,…}Width/Color but does NOT decompose `outline` —
      // the longhands come back empty when the value was set via the
      // shorthand. Fall back to parsing `style.outline` ourselves.
      let outlineW = parseFloat(style.outlineWidth) || 0;
      let outlineStyleVal = style.outlineStyle || '';
      let outlineColorVal = style.outlineColor || '';
      if (!outlineW && style.outline) {
        const wMatch = style.outline.match(/(\d+(?:\.\d+)?)\s*px/);
        if (wMatch) outlineW = parseFloat(wMatch[1]) || 0;
        if (!outlineStyleVal) {
          outlineStyleVal = /\b(solid|dashed|dotted|double|groove|ridge|inset|outset)\b/.test(style.outline) ? 'solid' : '';
        }
        if (!outlineColorVal) {
          const cMatch = style.outline.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*$/);
          if (cMatch) outlineColorVal = cMatch[1];
        }
      }
      const outlineVisible = outlineW > 0 && !cssColorIsTransparent(outlineColorVal) && outlineStyleVal && outlineStyleVal !== 'none';
      const bgVisible = hasVisibleBackgroundBoundary(style, el, win);

      const anyVisible = borderVisible.top || borderVisible.right || borderVisible.bottom || borderVisible.left || outlineVisible || bgVisible;
      if (anyVisible) {
        // Resolve padding to px (jsdom returns raw "1.5rem" etc., not the
        // computed px value; parseFloat would strip the unit and treat
        // 1.5rem as 1.5px, false-flagging legitimate insets).
        const pad = {
          top:    resolveLengthPx(style.paddingTop,    fontSize) ?? 0,
          right:  resolveLengthPx(style.paddingRight,  fontSize) ?? 0,
          bottom: resolveLengthPx(style.paddingBottom, fontSize) ?? 0,
          left:   resolveLengthPx(style.paddingLeft,   fontSize) ?? 0,
        };
        const PAD_THRESHOLD = 2;
        // Children-insulate-this-side: a side is insulated if ANY direct
        // child has its own padding ≥ 4px on that side. Rationale: in
        // typical flow, only the first/last (or leftmost/rightmost)
        // children actually sit at the parent's edges. If even one of
        // them has its own padding, the visual flush is broken on that
        // side. Classic example: a column-flow card frame where the
        // top child (header) has padding-top:12 and the bottom child
        // (footer) has padding-bottom:8 — the parent's padding:0 doesn't
        // matter; nothing is actually flush. The `any-child-insulates`
        // heuristic accepts some false negatives (a card with one heavily
        // padded middle child won't flag) for far fewer false positives.
        const CHILD_INSULATE_THRESHOLD = 4;
        const childrenInsulate = { top: false, right: false, bottom: false, left: false };
        for (const child of el.children) {
          let childStyle = getComputedStyleFor(win, child);
          if (!childStyle) continue;
          const childPad = {
            top:    resolveLengthPx(childStyle.paddingTop,    fontSize) ?? 0,
            right:  resolveLengthPx(childStyle.paddingRight,  fontSize) ?? 0,
            bottom: resolveLengthPx(childStyle.paddingBottom, fontSize) ?? 0,
            left:   resolveLengthPx(childStyle.paddingLeft,   fontSize) ?? 0,
          };
          const childMargin = {
            top:    resolveLengthPx(childStyle.marginTop,    fontSize) ?? 0,
            right:  resolveLengthPx(childStyle.marginRight,  fontSize) ?? 0,
            bottom: resolveLengthPx(childStyle.marginBottom, fontSize) ?? 0,
            left:   resolveLengthPx(childStyle.marginLeft,   fontSize) ?? 0,
          };
          if (rect && typeof child.getBoundingClientRect === 'function') {
            try {
              const childRect = child.getBoundingClientRect();
              if (childRect && childRect.width > 0 && childRect.height > 0) {
                if (childRect.top - rect.top >= CHILD_INSULATE_THRESHOLD) childrenInsulate.top = true;
                if (rect.right - childRect.right >= CHILD_INSULATE_THRESHOLD) childrenInsulate.right = true;
                if (rect.bottom - childRect.bottom >= CHILD_INSULATE_THRESHOLD) childrenInsulate.bottom = true;
                if (childRect.left - rect.left >= CHILD_INSULATE_THRESHOLD) childrenInsulate.left = true;
              }
            } catch {}
          }
          for (const s of ['top', 'right', 'bottom', 'left']) {
            if (childPad[s] >= CHILD_INSULATE_THRESHOLD || childMargin[s] >= CHILD_INSULATE_THRESHOLD) {
              childrenInsulate[s] = true;
            }
          }
        }

        const textFlush = rect ? textDescendantsFlushSides(el, rect) : null;
        const fullBleedBgBand = rect && viewportWidth > 0 && rect.width >= viewportWidth * 0.94 && bgVisible && !outlineVisible;
        const flushSides = [];
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const bgBoundsSide = bgVisible && !(fullBleedBgBand && (side === 'left' || side === 'right'));
          const sideBounded = borderVisible[side] || outlineVisible || bgBoundsSide;
          if (sideBounded && pad[side] <= PAD_THRESHOLD && !childrenInsulate[side] && (!textFlush || textFlush[side])) {
            flushSides.push(side);
          }
        }

        if (flushSides.length > 0) {
          // Confirm at least one direct child has substantial text content
          // (> 4 chars). Without this, the flush is harmless: e.g. an
          // image-only card.
          let hasTextChild = false;
          for (const child of el.children) {
            const childText = (child.textContent || '').trim();
            if (childText.length > 4) { hasTextChild = true; break; }
          }
          if (hasTextChild) {
            const cls = (typeof el.className === 'string' && el.className.trim())
              ? el.className.trim().split(/\s+/)[0]
              : '';
            const boundaryParts = [];
            const borderSidesVisible = ['top', 'right', 'bottom', 'left'].filter(s => borderVisible[s]);
            if (borderSidesVisible.length === 4) boundaryParts.push('border');
            else if (borderSidesVisible.length > 0) boundaryParts.push(`border-${borderSidesVisible.join('/')}`);
            if (outlineVisible) boundaryParts.push('outline');
            if (bgVisible) boundaryParts.push('bg');
            const sidesLabel = flushSides.length === 4 ? 'all sides' : flushSides.join('/');
            const ident = cls
              ? `<${tag.toLowerCase()}> "${cls}"`
              : `<${tag.toLowerCase()}>`;
            findings.push({
              id: 'cramped-padding',
              snippet: `${ident}: children flush against ${boundaryParts.join('+')} on ${sidesLabel} (no inset)`,
            });
          }
        }
      }
    }
  }

  // --- Body text touching viewport edge --- (browser-only: needs rect)
  // Catches the failure mode where the agent ships body paragraphs
  // with NO container providing horizontal padding — text bleeds
  // directly to the viewport edge. Different from cramped-padding,
  // which requires a colored/bordered container. Here the failure
  // is the absence of the container entirely.
  //
  // Gate aggressively to avoid false positives:
  //   - <p> or <li> only (body content; not headings, not nav, not
  //     wrappers)
  //   - text > 40 chars (paragraph-like, not a label)
  //   - rect.width > 50% of viewport (real body, not a pull-quote)
  //   - rect.left < 16 OR rect.right > viewport - 16 (actually
  //     touching the edge)
  //   - not inside <nav> or <header> (those legitimately bleed)
  //   - element itself has no background-color (intentional full-bleed
  //     sections set a bg-color and provide their own internal padding)
  if (rect && hasDirectText && textLen > 40 && ['P', 'LI'].includes(tag.toUpperCase()) && viewportWidth > 0) {
    const inNavHeader = el.closest && (el.closest('nav') || el.closest('header'));
    const hasOwnBg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
    const isPositioned = ['fixed', 'absolute'].includes(style.position || '');
    const widthRatio = rect.width / viewportWidth;
    const leftClose = rect.left < 16;
    const rightClose = rect.right > viewportWidth - 16;
    if (!inNavHeader && !hasOwnBg && !isPositioned && widthRatio > 0.5 && (leftClose || rightClose)) {
      const which = leftClose && rightClose
        ? `left ${Math.round(rect.left)}px / right ${Math.round(viewportWidth - rect.right)}px`
        : leftClose
          ? `left ${Math.round(rect.left)}px`
          : `right ${Math.round(viewportWidth - rect.right)}px`;
      findings.push({ id: 'body-text-viewport-edge', snippet: `<${tag.toLowerCase()}> with ${textLen}-char body bleeds to viewport edge (${which})` });
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
    const inUIContext = el.closest && el.closest('button, a, label, summary, pre, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], nav, footer, [aria-hidden="true"], [class*="badge" i], [class*="caption" i], [class*="chip" i], [class*="code" i], [class*="console" i], [class*="diff" i], [class*="label" i], [class*="meta" i], [class*="mock" i], [class*="pill" i], [class*="preview" i], [class*="tag" i], [class*="terminal" i], [class*="writes" i]');
    const isUppercase = style.textTransform === 'uppercase';
    if (!skipTags.includes(tag) && !inUIContext && !isUppercase) {
      findings.push({ id: 'tiny-text', snippet: `${fontSize}px body text` });
    }
  }

  // --- Undersized functional / UI text ---
  // Complements `tiny-text` above, which owns long body copy and deliberately
  // EXEMPTS the UI furniture layer (nav, footer, links, buttons, labels,
  // uppercase micro-labels). This rule targets exactly that blind spot: the
  // interactive and short content-bearing text — nav items, buttons, labels,
  // table cells, meta rows, timecodes — shipped below an 11px floor.
  //
  // The live failure it closes: a build shipped its entire furniture layer at
  // 8px, and the design hook waved it through because 8px had been added to
  // the DESIGN.md size ramp. Being on the ramp is a token argument, not a
  // legibility one, so this rule ignores the design system entirely — a value
  // on the ramp is still flagged.
  //
  // Floors: 11px for anything functional. The floor holds inside a footer;
  // only NON-interactive legal smallprint gets the softer 10px floor. Exempts
  // sup/sub, visually-hidden (sr-only) text, and code/terminal contexts.
  // Uppercase letterspaced micro-labels are still functional — not exempt.
  {
    const directText = [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const dtLen = directText.length;
    const UI_SKIP_TAGS = new Set(['sub', 'sup', 'script', 'style', 'title', 'option']);
    const notRendered = style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    // jsdom resolves the parent chain in resolveFontSizePx, so em/rem/%-sized
    // text that computes at or above the floor never reaches here. The browser
    // adapter additionally catches values only resolvable with real layout
    // (e.g. viewport-relative units, cascade winners set in linked sheets).
    if (fontSize > 0 && fontSize < 11 && dtLen >= 2 && !UI_SKIP_TAGS.has(tag) && !notRendered) {
      const EXEMPT_CONTEXT = 'pre, code, kbd, samp, var, svg, [aria-hidden="true"], [class*="terminal" i], [class*="console" i], [class*="code" i], [class*="mock" i], [class*="editor" i], [class*="syntax" i], [class*="diff" i]';
      const isExemptContext = (el.matches && el.matches(EXEMPT_CONTEXT)) || (el.closest && el.closest(EXEMPT_CONTEXT));
      if (!isExemptContext && !isVisuallyHidden(el, style)) {
        const INTERACTIVE = 'a[href], button, summary, label, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="treeitem"], [tabindex]';
        const FURNITURE = 'nav, [role="navigation"], td, th, [role="gridcell"], [role="cell"], caption, figcaption, dt, dd, footer, [class*="meta" i], [class*="label" i], [class*="badge" i], [class*="chip" i], [class*="pill" i], [class*="tag" i], [class*="kicker" i], [class*="eyebrow" i], [class*="breadcrumb" i], [class*="timestamp" i], [class*="category" i], [class*="caption" i], [class*="nav" i]';
        const SMALLPRINT = 'small, footer, [class*="legal" i], [class*="copyright" i], [class*="fineprint" i], [class*="fine-print" i], [class*="smallprint" i], [class*="small-print" i], [class*="disclaimer" i], [class*="disclosure" i], [class*="footnote" i]';
        const isInteractive = (el.matches && el.matches(INTERACTIVE)) || (el.closest && el.closest(INTERACTIVE));
        const isFurniture = (el.matches && el.matches(FURNITURE)) || (el.closest && el.closest(FURNITURE));
        const isSmallprint = (el.matches && el.matches(SMALLPRINT)) || (el.closest && el.closest(SMALLPRINT));
        const floor = (!isInteractive && isSmallprint) ? 10 : 11;
        // Fire on functional text only: interactive, structural furniture, or
        // any short (<=20-char) run — the label / meta / timecode shape. Long
        // non-furniture body copy stays with `tiny-text`, so the two rules
        // never double-flag the same element.
        if (fontSize < floor && (isInteractive || isFurniture || dtLen <= 20)) {
          const excerpt = directText.slice(0, 40);
          findings.push({ id: 'undersized-ui-text', snippet: `${fontSize}px functional text "${excerpt}" (below ${floor}px floor)` });
        }
      }
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

  // --- Crushed letter spacing (mirror of wide-tracking) ---
  // Tracking pulled tighter than ~-0.05em crushes characters into each other.
  // Optical tightening that display type legitimately wants (around -0.02em)
  // stays well above this floor.
  if (hasDirectText && textLen > 20 && fontSize > 0) {
    if (letterSpacingPx != null && letterSpacingPx < 0) {
      const trackingEm = letterSpacingPx / fontSize;
      if (trackingEm <= -0.05) {
        const excerpt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        findings.push({ id: 'extreme-negative-tracking', snippet: `letter-spacing: ${trackingEm.toFixed(2)}em — "${excerpt}"` });
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
  const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  return checkQuality({ el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect, lineMax, viewportWidth, win: typeof window !== 'undefined' ? window : null });
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
  return checkQuality({ el, tag, style, hasDirectText, textLen, fontSize, lineHeightPx, letterSpacingPx, rect: null, win: window });
}

function checkElementBorders(tag, style, overrides, resolvedRadius, el = null) {
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
  const ownBg = parseAnyColor(style.backgroundColor);
  return checkBorders(tag, widths, colors, radius, {
    tabContext: isTabContextElement(el),
    statusContext: isStatusContextElement(el),
    badgeLike: !!(ownBg && (ownBg.a ?? 1) > 0.1),
  });
}

function checkElementColors(el, style, tag, window, customPropMap, hasAnchorInheritRule) {
  const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const hasDirectText = directText.trim().length > 0;

  const effectiveBg = resolveBackground(el, window, customPropMap);
  // jsdom returns literal "var(--X)" / "oklch(...)" for color, so plain
  // parseRgb misses Tailwind-tokenized text colors. Resolve through the
  // customPropMap first; fall back to parseRgb for vanilla rgb() pages.
  let textColor = customPropMap ? parseColorResolved(style.color, customPropMap) : null;
  if (!textColor) textColor = parseRgb(style.color);

  // Anchor-inherit FP workaround: jsdom's UA stylesheet has `:link { color:
  // blue }` at high specificity. The page's `a { color: inherit }` rule
  // (Tailwind v4 preflight) loses to jsdom even though it WINS in real
  // browsers (Chrome's UA wraps :link in :where() — zero specificity).
  // When the page declares the inherit rule AND we see jsdom's default
  // link blue on an anchor, walk to the nearest non-anchor ancestor and
  // use its color instead.
  if (
    hasAnchorInheritRule &&
    textColor &&
    textColor.r === 0 && textColor.g === 0 && textColor.b === 238 &&
    (tag === 'a' || el.closest?.('a'))
  ) {
    let cur = el.parentElement;
    while (cur && cur.tagName !== 'HTML') {
      if (cur.tagName !== 'A') {
        const ps = window.getComputedStyle(cur);
        const inh = (customPropMap ? parseColorResolved(ps.color, customPropMap) : null) || parseRgb(ps.color);
        if (inh && !(inh.r === 0 && inh.g === 0 && inh.b === 238)) {
          textColor = inh;
          break;
        }
      }
      cur = cur.parentElement;
    }
  }

  // Own background: resolve var()/oklch() tokens through the custom-property
  // map first (mirrors the textColor path above). Without this a chip whose
  // background is `var(--sev)` reads as no-own-bg in the static engine and
  // the styled-control contrast exception never engages.
  let ownBg = (customPropMap ? parseColorResolved(style.backgroundColor, customPropMap) : null)
    || readOwnBackgroundColor(el, style);

  // Full-cover surface pseudo (static): the cascade pass marks elements
  // whose ::before/::after paints an opaque covering surface. When the
  // element itself has no usable own background, that pseudo is the real
  // surface for contrast purposes.
  let finalEffectiveBg = effectiveBg;
  if ((!ownBg || (ownBg.a ?? 1) <= 0.5) && typeof window.getPseudoSurface === 'function') {
    const pseudoSurface = window.getPseudoSurface(el);
    if (pseudoSurface) {
      ownBg = pseudoSurface;
      finalEffectiveBg = pseudoSurface;
    }
  }

  return checkColors({
    tag,
    textColor,
    bgColor: ownBg,
    effectiveBg: finalEffectiveBg,
    effectiveBgStops: finalEffectiveBg ? null : resolveGradientStops(el, window),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText,
    isEmojiOnly: isEmojiOnlyText(directText),
    bgClip: style.webkitBackgroundClip || style.backgroundClip || '',
    bgImage: style.backgroundImage || '',
    classList: el.getAttribute?.('class') || el.className || '',
  });
}

// Static-engine adapter for hover-state contrast. Relies on the static
// cascade's hover pass (css-cascade.mjs) exposing a per-element hover style
// via window.getHoverStyle — present only when a :hover rule changed the
// element's color or background-color relative to its resting state.
function checkElementHoverContrast(el, style, tag, window) {
  if (typeof window.getHoverStyle !== 'function') return [];
  const hover = window.getHoverStyle(el);
  if (!hover) return [];

  const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  if (directText.trim().length === 0) return [];

  const textColor = parseAnyColor(hover.color);
  if (!textColor || (textColor.a != null && textColor.a < 1)) return [];

  const restingOwnBg = parseAnyColor(style.backgroundColor);
  const hoverOwnBg = parseAnyColor(hover.backgroundColor);
  const ownBg = hoverOwnBg || restingOwnBg;

  // Effective hover background: the element's own hover bg composited over
  // whatever sits underneath. Bail when the surface can't be resolved to a
  // solid color — gradient ancestors are handled (as at rest) by the
  // resting-state check, not duplicated here.
  let bg = null;
  if (ownBg && ownBg.a >= 0.99) {
    bg = ownBg;
  } else {
    const under = resolveBackground(el.parentElement || el, window, null);
    if (!under) return [];
    bg = ownBg && ownBg.a > 0.1 ? compositeColorOver(ownBg, under) : under;
  }

  return checkHoverContrast({
    tag,
    textColor,
    bg,
    ownBgAlpha: ownBg ? ownBg.a ?? 1 : null,
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight) || 400,
    hasDirectText: true,
    isEmojiOnly: isEmojiOnlyText(directText),
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

function checkElementHeroEyebrow(el, style, tag, window, customPropMap) {
  if (tag !== 'h1') return [];
  const sibling = el.previousElementSibling;
  if (!sibling) return [];
  const sibStyle = window.getComputedStyle(sibling);
  // Resolve Tailwind v4 CSS-variable wrappers (font-weight:var(--font-weight-bold)
  // etc.) before parsing. jsdom returns these verbatim from getComputedStyle;
  // without resolution every style-based gate fails silently on Tailwind v4 builds.
  const fontSizeRaw = customPropMap ? resolveVarRefs(sibStyle.fontSize, customPropMap) : sibStyle.fontSize;
  const fontWeightRaw = customPropMap ? resolveVarRefs(sibStyle.fontWeight, customPropMap) : sibStyle.fontWeight;
  const letterSpacingRaw = customPropMap ? resolveVarRefs(sibStyle.letterSpacing, customPropMap) : sibStyle.letterSpacing;
  const colorRaw = customPropMap ? resolveVarRefs(sibStyle.color, customPropMap) : sibStyle.color;
  const headingFontSizeRaw = customPropMap ? resolveVarRefs(style.fontSize, customPropMap) : style.fontSize;
  const siblingFontSize = parseFloat(fontSizeRaw) || 0;
  // resolveLengthPx returns null for 'normal' / 'auto'; coerce to 0 so the
  // gate falls through cleanly. jsdom returns letter-spacing verbatim
  // (e.g. '0.15em'), unlike real browsers, so this conversion is required.
  return checkHeroEyebrow({
    headingTag: tag,
    headingText: el.textContent || '',
    headingFontSize: resolveHeroHeadingSizePx(headingFontSizeRaw),
    headingInApplicationContext: !!el.closest?.('[role="tabpanel"], [role="dialog"], [role="application"], dialog'),
    siblingTag: sibling.tagName.toLowerCase(),
    siblingText: sibling.textContent || '',
    siblingTextTransform: sibStyle.textTransform || '',
    siblingFontSize,
    siblingLetterSpacing: resolveLengthPx(letterSpacingRaw, siblingFontSize) || 0,
    siblingFontWeight: fontWeightRaw || '',
    siblingColor: colorRaw || '',
    // Static cascade marks elements matched by a ::before/::after rule
    // whose geometry is a short chromatic dash (css-cascade.mjs).
    siblingHasAccentDashPseudo: typeof window.hasAccentDashPseudo === 'function'
      ? window.hasAccentDashPseudo(sibling)
      : false,
  });
}

function checkRepeatedSectionKickersFromDoc(doc, win) {
  const candidates = collectRepeatedSectionKickerCandidates(
    doc,
    (el) => win.getComputedStyle(el),
    (value, fontSize) => resolveLengthPx(value, fontSize) || 0,
  );
  return checkRepeatedSectionKickers({ candidates });
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
  const boxShadow = style.boxShadow && style.boxShadow !== 'none' ? style.boxShadow : '';
  const textShadow = style.textShadow && style.textShadow !== 'none' ? style.textShadow : '';
  if (!boxShadow && !textShadow) return [];
  return checkGlow({ tag, boxShadow, textShadow, effectiveBg });
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

// Heading rhythm (browser-only): a heading binds to the content it
// introduces, so its rendered space above must exceed its space below.
// Margins alone can't be trusted (collapsing, flex rows, section padding),
// so this measures actual getBoundingClientRect gaps between the heading
// and the nearest content genuinely above / below it. Fires only when two
// or more headings violate the principle — a single occurrence is noise.
function checkHeadingRhythmDOM() {
  const MIN_VIOLATIONS = 2;
  const CARD_EXEMPT_HEIGHT = 200;
  const MAX_BELOW_PX = 160; // beyond this the heading isn't binding to nearby content at all
  const MIN_DEFICIT_PX = 12;

  function isVisibleFlow(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity || '1') <= 0.05) return false;
    if (style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky') return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  // Edges only count when they share the heading's column — grid layouts
  // put content beside a heading, and a far-away element in another column
  // says nothing about the heading's vertical rhythm.
  function overlapsX(sr, rect) {
    return Math.min(sr.right, rect.right) - Math.max(sr.left, rect.left) >= 8;
  }

  // Does this container draw its own top boundary (background, top border,
  // shadow)? Crossing out of such a container means the container edge is
  // the separator above the heading, not raw whitespace — exempt.
  function hasOwnTopBoundary(el) {
    const style = getComputedStyle(el);
    const bg = parseAnyColor(style.backgroundColor || '');
    if (bg && (bg.a ?? 1) > 0.05) return true;
    if ((parseFloat(style.borderTopWidth) || 0) > 0) return true;
    if (style.boxShadow && style.boxShadow !== 'none') return true;
    return false;
  }

  // Eyebrows, kickers, and index labels sitting directly on top of a
  // heading belong to the heading's own cluster — space above is measured
  // from the top of the cluster, not from the label to the heading.
  function clusterTop(h, rect) {
    const headingFontSize = parseFloat(getComputedStyle(h).fontSize) || 16;
    let topEl = h;
    let top = rect.top;
    for (let i = 0; i < 3; i++) {
      const sib = topEl.previousElementSibling;
      if (!sib || !isVisibleFlow(sib)) break;
      const sr = sib.getBoundingClientRect();
      if (!overlapsX(sr, rect)) break;
      const gap = top - sr.bottom;
      if (gap < 0 || gap >= 28 || sr.height > 60) break;
      const text = (sib.textContent || '').trim();
      const sibFontSize = parseFloat(getComputedStyle(sib).fontSize) || 16;
      const labelLike = sibFontSize < headingFontSize * 0.75 || text.length <= 40;
      if (!labelLike || text.length > 80) break;
      topEl = sib;
      top = sr.top;
    }
    return { topEl, top };
  }

  // Nearest content edge strictly above the heading cluster. Walks
  // previous siblings, then out through ancestors. Skips elements that
  // vertically overlap (flex-row companions, sticky rails) or sit in
  // another column. Returns null when nothing qualifies — first content
  // on the page, or the top of a visually bounded container.
  function edgeAbove(startEl, top, rect) {
    let node = startEl;
    while (node && node !== document.body) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (isVisibleFlow(sib)) {
          const sr = sib.getBoundingClientRect();
          if (sr.bottom <= top + 2 && overlapsX(sr, rect)) return sr.bottom;
        }
        sib = sib.previousElementSibling;
      }
      const parent = node.parentElement;
      if (!parent || parent === document.body) return null;
      // Leaving a container upward: if it draws its own top edge, that
      // edge separates the heading from whatever sits above.
      if (hasOwnTopBoundary(parent)) return null;
      node = parent;
    }
    return null;
  }

  // Nearest content edge strictly below the heading — the block the
  // heading introduces. Crosses wrappers freely (headings often share a
  // row wrapper with an eyebrow or index label).
  function edgeBelow(h, rect) {
    let node = h;
    while (node && node !== document.body) {
      let sib = node.nextElementSibling;
      while (sib) {
        if (isVisibleFlow(sib)) {
          const sr = sib.getBoundingClientRect();
          if (sr.top >= rect.bottom - 2 && overlapsX(sr, rect)) return sr.top;
        }
        sib = sib.nextElementSibling;
      }
      node = node.parentElement;
    }
    return null;
  }

  function insideSmallCard(h) {
    let cur = h.parentElement;
    while (cur && cur !== document.body) {
      if (isCardLikeDOM(cur)) {
        const cr = cur.getBoundingClientRect();
        if (cr.height < CARD_EXEMPT_HEIGHT) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  const candidates = [];
  for (const h of document.querySelectorAll('h2, h3, h4')) {
    if (!isVisibleFlow(h)) continue;
    const text = (h.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length < 3) continue;
    const rect = h.getBoundingClientRect();
    const belowTop = edgeBelow(h, rect);
    if (belowTop == null) continue; // heading introduces nothing measurable
    const { topEl, top } = clusterTop(h, rect);
    const aboveBottom = edgeAbove(topEl, top, rect);
    if (aboveBottom == null) continue; // first content, or bounded container
    if (insideSmallCard(h)) continue;
    const above = Math.max(0, top - aboveBottom);
    const below = Math.max(0, belowTop - rect.bottom);
    if (below < 6 || below > MAX_BELOW_PX) continue;
    // Violation: the space above clearly fails to exceed the space below.
    // Near-equal gaps are ambiguous rather than inverted, so they pass.
    if (above < below * 0.75 && below - above >= MIN_DEFICIT_PX) {
      candidates.push({ el: h, tag: h.tagName.toLowerCase(), text: text.slice(0, 60), above, below });
    }
  }

  if (candidates.length < MIN_VIOLATIONS) return [];
  return candidates.map(c => ({
    type: 'heading-rhythm',
    detail: `${c.tag} "${c.text}" has ${Math.round(c.above)}px above vs ${Math.round(c.below)}px below — it reads as bound to the block above (${candidates.length} headings on page)`,
    el: c.el,
  }));
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
  for (const f of extractGoogleFontFamilies(html)) {
    fonts.add(f);
    if (OVERUSED_FONTS.has(f)) overusedFound.add(f);
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

  return findings;
}

// ── Repeated text inside one container ──────────────────────────────────────
// The same literal string rendered 3+ times in structurally different spots
// inside one bordered/elevated container — typically a status word wired
// into every slot of a card template. Legitimate repetition is structural:
// table columns, calendar grids, nav/menu lists, and templated sibling rows
// all repeat text in *parallel* positions, so occurrences whose element
// paths inside the container are identical (or live in dedicated repetition
// structures) never count. Only 3+ occurrences at 3+ distinct structural
// positions flag.

const REPEATED_TEXT_SKIP_SELECTOR = [
  'table',
  'select',
  'datalist',
  'nav',
  'menu',
  '[role="navigation"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="grid"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[aria-hidden="true"]',
].join(',');

const REPEATED_TEXT_CONTAINER_TAGS = new Set([
  'div', 'section', 'article', 'aside', 'main', 'figure', 'form', 'fieldset', 'details', 'li',
]);

// A container worth attributing text to: visibly bounded (border on most
// sides or an elevation shadow) and surface-like (radius or own background).
function isRepeatedTextContainer(style) {
  if (!style) return false;
  const hasShadow = !!(style.boxShadow && style.boxShadow !== 'none' && style.boxShadow !== '');
  const borderSides = ['Top', 'Right', 'Bottom', 'Left']
    .filter(side => (parseFloat(style[`border${side}Width`]) || 0) >= 1).length;
  const hasBorder = borderSides >= 3;
  const hasRadius = (parseFloat(style.borderRadius) || 0) > 0;
  const bg = parseRgb(style.backgroundColor) || parseAnyColor(style.backgroundColor);
  const hasBg = !!(bg && (bg.a ?? 1) > 0.1);
  return isCardLikeFromProps(hasShadow, hasBorder, hasRadius, hasBg);
}

function collectRepeatedContainerTextFindings(doc, getStyle, opts = {}) {
  const isVisible = opts.isVisible || (() => true);
  const findings = [];

  const containers = [];
  const containerSet = new Set();
  for (const el of doc.querySelectorAll('*')) {
    if (!REPEATED_TEXT_CONTAINER_TAGS.has(el.tagName.toLowerCase())) continue;
    if (el.closest?.(REPEATED_TEXT_SKIP_SELECTOR)) continue;
    if (!isRepeatedTextContainer(getStyle(el))) continue;
    containers.push(el);
    containerSet.add(el);
  }

  for (const container of containers) {
    if (!isVisible(container)) continue;
    const descendants = container.querySelectorAll('*');
    // Page-scale wrappers that merely happen to carry a background are not
    // the "one card" this rule reasons about.
    if (descendants.length > 250) continue;

    const groups = new Map();
    for (const d of descendants) {
      // Attribute text to the innermost container only.
      let anc = d.parentElement;
      let ownedByInner = false;
      while (anc && anc !== container) {
        if (containerSet.has(anc)) { ownedByInner = true; break; }
        anc = anc.parentElement;
      }
      if (ownedByInner) continue;
      if (d.closest?.(REPEATED_TEXT_SKIP_SELECTOR)) continue;
      // Icon-font glyph names read as text but render as symbols.
      if (/icon|material-symbols|(?:^|\s)fa[srlbd]?(?:\s|-|$)/i.test(String(d.getAttribute?.('class') || ''))) continue;
      if (!isVisible(d)) continue;

      const direct = [...d.childNodes]
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (direct.length < 4 || direct.length > 48) continue;
      if (!/[a-zA-Z]/.test(direct)) continue;

      // Structural signature: the element path from the occurrence up to
      // the container. Parallel/templated repetition shares one signature.
      const sig = [];
      for (let cur = d; cur && cur !== container; cur = cur.parentElement) {
        const cls = String(cur.getAttribute?.('class') || '')
          .trim().split(/\s+/).filter(Boolean).sort().join('.');
        sig.push(cur.tagName.toLowerCase() + (cls ? `.${cls}` : ''));
      }
      if (!groups.has(direct)) groups.set(direct, []);
      groups.get(direct).push(sig.join('>'));
    }

    for (const [text, sigs] of groups) {
      if (sigs.length < 3) continue;
      if (new Set(sigs).size < 3) continue;
      findings.push({
        id: 'repeated-container-text',
        snippet: `"${text.slice(0, 40)}" rendered ${sigs.length}× in distinct spots inside ${classSelector(container)}`,
      });
    }
  }
  return findings;
}

function checkRepeatedContainerTextFromDoc(doc, win) {
  return collectRepeatedContainerTextFindings(
    doc,
    (el) => win.getComputedStyle(el),
    { isVisible: (el) => String(win.getComputedStyle(el).display || '') !== 'none' },
  );
}

function checkRepeatedContainerTextDOM() {
  return collectRepeatedContainerTextFindings(
    document,
    (el) => getComputedStyle(el),
    { isVisible: isRenderedForBrowserRule },
  );
}

// ─── Cream / beige palette (the default "tasteful" AI surface) ────────────────
// A warm, lightly-tinted off-white page background — light, with R≥G≥B and a
// small warm tint (not white, not a strong color). The current reflex surface.
function isCreamColor(rgb) {
  if (!rgb) return false;
  const { r, g, b } = rgb;
  if (Math.min(r, g, b) < 209) return false;   // must be light
  if (!(r >= g && g >= b)) return false;        // warm ordering
  const warmth = r - b;
  return warmth >= 6 && warmth <= 48;           // tinted, not white, not strong
}

// Tailwind background utilities that render as a warm off-white surface. The
// static engine doesn't fetch Tailwind's CSS, so a `bg-amber-50` on <body>
// resolves to nothing in computed style — catch it from the class list
// instead. Candidate tokens map to their actual Tailwind hex and are still
// filtered through isCreamColor, so neutral grays (stone) and over-saturated
// shades drop out on their own.
const TAILWIND_BG_HEX = {
  'bg-amber-50': '#fffbeb', 'bg-amber-100': '#fef3c7',
  'bg-orange-50': '#fff7ed', 'bg-orange-100': '#ffedd5',
  'bg-yellow-50': '#fefce8',
  'bg-stone-50': '#fafaf9', 'bg-stone-100': '#f5f5f4', 'bg-stone-200': '#e7e5e4',
};

function creamFromClassList(cls) {
  if (!cls) return null;
  // Arbitrary value: bg-[#f5f0e6] / bg-[rgb(245_240_230)] (underscores = spaces).
  const arb = cls.match(/\bbg-\[([^\]]+)\]/);
  if (arb && isCreamColor(parseAnyColor(arb[1].replace(/_/g, ' ')))) return `bg-[${arb[1]}]`;
  // Named warm-light utilities.
  for (const [tok, hex] of Object.entries(TAILWIND_BG_HEX)) {
    if (new RegExp(`(^|\\s)${tok}($|\\s)`).test(cls) && isCreamColor(parseAnyColor(hex))) return tok;
  }
  return null;
}

function checkCreamPalette(doc, win) {
  const findings = [];
  const body = doc.body || (doc.querySelector ? doc.querySelector('body') : null);
  if (!body) return findings;
  const html = doc.documentElement;
  const getCS = (el) => (win ? win.getComputedStyle(el) : getComputedStyle(el));

  // 1. Computed background — covers inline / <style> / linked CSS, and Tailwind
  //    once it's actually rendered (browser path).
  let bg = readOwnBackgroundColor(body, getCS(body));
  if (!bg || bg.a === 0) {
    if (html) bg = readOwnBackgroundColor(html, getCS(html));
  }
  if (isCreamColor(bg)) {
    findings.push({ id: 'cream-palette', snippet: `cream/beige page background rgb(${bg.r}, ${bg.g}, ${bg.b})` });
    return findings;
  }

  // 2. Tailwind class fallback — for the static path, where utility classes
  //    never resolve to computed CSS.
  for (const el of [body, html]) {
    const tok = creamFromClassList(el && el.getAttribute ? el.getAttribute('class') : '');
    if (tok) {
      findings.push({ id: 'cream-palette', snippet: `cream/beige page background (Tailwind ${tok})` });
      break;
    }
  }
  return findings;
}

// ─── Oversized hero headline ────────────────────────────────────────────────
// Fires when a *long* headline is set at display size and actually dominates
// the viewport. A punchy one- or two-word headline at the same size is a
// legitimate stylistic choice, and a large-but-contained two-line hero should
// pass too — length and viewport share together are the tell.
const OVERSIZED_H1_FONT_PX = 72;
const OVERSIZED_H1_MIN_CHARS = 40;
const OVERSIZED_H1_MIN_VIEWPORT_HEIGHT_RATIO = 0.28;
const OVERSIZED_H1_MIN_VIEWPORT_AREA_RATIO = 0.25;
function checkOversizedH1({ tag, fontSize, headingText, rect = null, viewportWidth = 0, viewportHeight = 0 }) {
  if (tag !== 'h1') return [];
  const textLen = headingText.length;
  if (fontSize >= OVERSIZED_H1_FONT_PX && textLen >= OVERSIZED_H1_MIN_CHARS) {
    let viewportDetail = '';
    if (rect && viewportWidth > 0 && viewportHeight > 0) {
      const heightRatio = rect.height / viewportHeight;
      const areaRatio = (rect.width * rect.height) / (viewportWidth * viewportHeight);
      const dominatesViewport = heightRatio >= OVERSIZED_H1_MIN_VIEWPORT_HEIGHT_RATIO
        || areaRatio >= OVERSIZED_H1_MIN_VIEWPORT_AREA_RATIO;
      if (!dominatesViewport) return [];
      viewportDetail = `, ${Math.round(heightRatio * 100)}vh`;
    }
    return [{ id: 'oversized-h1', snippet: `${Math.round(fontSize)}px h1, ${textLen} chars${viewportDetail} "${headingText.slice(0, 60)}"` }];
  }
  return [];
}

function checkElementOversizedH1(el, style, tag, window) {
  if (tag !== 'h1') return [];
  const fontSize = resolveFontSizePx(el, window);
  const headingText = (el.textContent || '').trim().replace(/\s+/g, ' ');
  return checkOversizedH1({ tag, fontSize, headingText });
}

function checkElementOversizedH1DOM(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'h1') return [];
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 0;
  const headingText = (el.textContent || '').trim().replace(/\s+/g, ' ');
  const rect = el.getBoundingClientRect();
  const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
  return checkOversizedH1({ tag, fontSize, headingText, rect, viewportWidth, viewportHeight });
}

// ─── Generated-UI tell: hairline border + wide diffuse shadow ────────────────
const CSS_COLOR_TOKEN_RE = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\b(?:black|white|transparent|currentcolor)\b/gi;

function shadowLayerAlpha(layer) {
  CSS_COLOR_TOKEN_RE.lastIndex = 0;
  const match = CSS_COLOR_TOKEN_RE.exec(layer);
  if (!match) return 1;
  if (match[0].toLowerCase() === 'transparent') return 0;
  const parsed = parseAnyColor(match[0]);
  return parsed ? (parsed.a ?? 1) : 1;
}

function shadowMaxBlurPx(boxShadow, { minAlpha = 0 } = {}) {
  if (!boxShadow || boxShadow === 'none') return 0;
  let maxBlur = 0;
  // Split into layers on commas not inside parentheses (rgba(...) etc.).
  for (const layer of boxShadow.split(/,(?![^()]*\))/)) {
    if (shadowLayerAlpha(layer) < minAlpha) continue;
    // Strip colors and keywords (rgba()/hsl()/hex/named/inset/px), leaving the
    // ordered length tokens: offsetX offsetY blur [spread]. Static jsdom keeps
    // unitless zeros ("0 0 24px"); browsers normalize to px ("0px 0px 24px") —
    // both reduce to the same numbers here.
    const cleaned = layer.replace(CSS_COLOR_TOKEN_RE, ' ').replace(/\b[a-z]+\b/gi, ' ');
    const nums = [...cleaned.matchAll(/-?\d*\.?\d+/g)].map(m => parseFloat(m[0]));
    if (nums.length >= 3) maxBlur = Math.max(maxBlur, nums[2]);
  }
  return maxBlur;
}

function cssColorAlpha(value) {
  if (cssColorIsTransparent(value)) return 0;
  const parsed = parseAnyColor(value);
  return parsed ? (parsed.a ?? 1) : 1;
}

function checkGptThinBorderWideShadow({ borderWidths, borderColors, boxShadow }) {
  const visibleThinBorders = borderWidths
    .map((width, index) => ({ width, alpha: cssColorAlpha(borderColors?.[index] || '') }))
    .filter(({ width, alpha }) => width > 0 && width <= 1.5 && alpha >= 0.28);
  const maxBorder = Math.max(0, ...visibleThinBorders.map(({ width }) => width));
  const blur = shadowMaxBlurPx(boxShadow, { minAlpha: 0.12 });
  if (visibleThinBorders.length >= 2 && blur >= 16) {
    return [{ id: 'gpt-thin-border-wide-shadow', snippet: `${maxBorder}px border + ${Math.round(blur)}px shadow blur` }];
  }
  return [];
}

function borderWidthsFromStyle(style) {
  return [
    parseFloat(style.borderTopWidth) || 0,
    parseFloat(style.borderRightWidth) || 0,
    parseFloat(style.borderBottomWidth) || 0,
    parseFloat(style.borderLeftWidth) || 0,
  ];
}

function borderColorsFromStyle(style) {
  return [
    style.borderTopColor || '',
    style.borderRightColor || '',
    style.borderBottomColor || '',
    style.borderLeftColor || '',
  ];
}

function checkElementGptBorderShadow(el, style) {
  return checkGptThinBorderWideShadow({ borderWidths: borderWidthsFromStyle(style), borderColors: borderColorsFromStyle(style), boxShadow: style.boxShadow || '' });
}

function checkElementGptBorderShadowDOM(el) {
  const style = getComputedStyle(el);
  return checkGptThinBorderWideShadow({ borderWidths: borderWidthsFromStyle(style), borderColors: borderColorsFromStyle(style), boxShadow: style.boxShadow || '' });
}

// ─── Clipped overflow container ───────────────────────────────────────────────
// A clipping container (overflow hidden/clip, not a scroll region) wrapping an
// absolutely/fixed-positioned descendant clips popovers/menus that must escape.
function classSelector(el) {
  const cls = (el.getAttribute ? el.getAttribute('class') : el.className) || '';
  const tokens = String(cls).trim().split(/\s+/).filter(Boolean);
  const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
  return tokens.length ? `${tag}.${tokens.join('.')}` : tag;
}

function positionedChildIsDecorative(child) {
  if (!child || typeof child.getAttribute !== 'function') return false;
  if (child.closest?.('[aria-hidden="true"]')) return true;
  const role = (child.getAttribute('role') || '').toLowerCase();
  if (role === 'none' || role === 'presentation') return true;
  const tag = child.tagName ? child.tagName.toLowerCase() : '';
  if (['img', 'svg', 'canvas', 'video'].includes(tag)) return true;
  const ident = `${child.getAttribute('class') || ''} ${child.getAttribute('id') || ''}`;
  if (
    /\b(art|bg|background|badge|blob|crop|decor|dot|glow|grain|image|mask|ornament|overlay|photo|scrim|shadow|shine|texture)\b/i.test(ident) &&
    !positionedChildHasSubstantiveContent(child)
  ) {
    return true;
  }
  return false;
}

const POSITIONED_CHILD_INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'summary',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="dialog"]',
  '[role="link"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tooltip"]',
].join(',');

function positionedChildHasSubstantiveContent(child) {
  const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length > 0) return true;
  if (typeof child.matches === 'function') {
    try {
      if (child.matches(POSITIONED_CHILD_INTERACTIVE_SELECTOR)) return true;
    } catch {}
  }
  if (typeof child.querySelector === 'function') {
    try {
      if (child.querySelector(POSITIONED_CHILD_INTERACTIVE_SELECTOR)) return true;
    } catch {}
  }
  return false;
}

function clippingContainerIsIntentionalViewport(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  const roleDescription = (el.getAttribute('aria-roledescription') || '').toLowerCase();
  if (/\b(carousel|slider)\b/.test(roleDescription)) return true;
  const ident = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.toLowerCase();
  return /\b(carousel|comparison|compare|fisheye|marquee|preview|scroller|slider|slideshow|split|viewport)\b/.test(ident) ||
    /\b(demo-area|demo-stage|demo-viewport)\b/.test(ident);
}

function elementRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  try {
    const rect = el.getBoundingClientRect();
    if (!rect) return null;
    const values = [rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height];
    if (!values.every(Number.isFinite)) return null;
    if (rect.width <= 0 && rect.height <= 0) return null;
    return rect;
  } catch {
    return null;
  }
}

function positionedStyleImpliesEscape(style) {
  const values = [
    style.top,
    style.right,
    style.bottom,
    style.left,
    style.inset,
    style.insetBlock,
    style.insetInline,
    style.insetBlockStart,
    style.insetBlockEnd,
    style.insetInlineStart,
    style.insetInlineEnd,
  ].filter(Boolean).map(value => String(value).trim().toLowerCase());
  for (const value of values) {
    if (/(^|[\s(])-+(?:\d|\.)/.test(value)) return true;
    if (/(^|[\s(])100(?:\.0+)?%/.test(value)) return true;
  }
  return false;
}

function positionedChildEscapesClip(el, child, clipX, clipY) {
  const parentRect = elementRect(el);
  const childRect = elementRect(child);
  if (!parentRect || !childRect) return null;
  const threshold = 2;
  return Boolean(
    (clipX && (childRect.left < parentRect.left - threshold || childRect.right > parentRect.right + threshold)) ||
    (clipY && (childRect.top < parentRect.top - threshold || childRect.bottom > parentRect.bottom + threshold))
  );
}

function checkClippedOverflow(el, style, getStyle) {
  const clips = (v) => v === 'hidden' || v === 'clip';
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const ox = style.overflowX || '', oy = style.overflowY || '', ov = style.overflow || '';
  const clipX = clips(ox) || clips(ov);
  const clipY = clips(oy) || clips(ov);
  const anyClip = clipX || clipY;
  const anyScroll = scrolls(ox) || scrolls(oy) || scrolls(ov);
  if (!anyClip || anyScroll) return [];
  if (clippingContainerIsIntentionalViewport(el)) return [];
  if (!el.querySelectorAll) return [];
  for (const child of el.querySelectorAll('*')) {
    const childStyle = getStyle(child);
    const pos = childStyle.position || '';
    if (pos === 'absolute' || pos === 'fixed') {
      if (positionedChildIsDecorative(child)) continue;
      const escapes = positionedChildEscapesClip(el, child, clipX, clipY);
      if (escapes === false) continue;
      if (escapes === null && !positionedStyleImpliesEscape(childStyle)) continue;
      return [{ id: 'clipped-overflow-container', snippet: `${classSelector(el)} clips a positioned child` }];
    }
  }
  return [];
}

function checkElementClippedOverflow(el, style, tag, window) {
  return checkClippedOverflow(el, style, (n) => window.getComputedStyle(n));
}

function checkElementClippedOverflowDOM(el) {
  const style = getComputedStyle(el);
  return checkClippedOverflow(el, style, (n) => getComputedStyle(n));
}

// ─── Text overflow (browser-only: needs scrollWidth/clientWidth) ──────────────
const TEXT_OVERFLOW_SKIP_TAGS = new Set(['pre', 'code', 'textarea', 'svg', 'canvas', 'select', 'option', 'marquee']);

function metricLengthPx(value, fontSizePx = 16) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  return resolveLengthPx(value, fontSizePx);
}

function firstMetricLengthPx(fontSizePx, ...values) {
  for (const value of values) {
    const parsed = metricLengthPx(value, fontSizePx);
    if (parsed !== null) return parsed;
  }
  return null;
}

function expandBoxShorthand(parts) {
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

function clippedByInset(clipPath) {
  const match = String(clipPath || '').trim().toLowerCase().match(/^inset\s*\(([^)]*)\)$/);
  if (!match) return false;
  const beforeRound = match[1].split(/\s+round\s+/)[0].trim();
  if (!beforeRound) return false;
  const values = expandBoxShorthand(beforeRound.split(/\s+/).slice(0, 4));
  const percents = values.map(value => String(value).trim().match(/^(-?\d+(?:\.\d+)?)%$/));
  if (percents.some(match => !match)) return false;
  const [top, right, bottom, left] = percents.map(match => parseFloat(match[1]));
  return top + bottom >= 100 || left + right >= 100;
}

function clippedByRect(clip) {
  const match = String(clip || '').trim().toLowerCase().match(/^rect\s*\(([^)]*)\)$/);
  if (!match) return false;
  const values = match[1].split(/[,\s]+/).map(value => value.trim()).filter(Boolean);
  if (values.length !== 4) return false;
  const [top, right, bottom, left] = values.map(value => metricLengthPx(value, 16));
  if ([top, right, bottom, left].some(value => value === null)) return false;
  return bottom <= top || right <= left;
}

function isScreenReaderOnlyTextStyle(style, metrics = {}) {
  if (!style) return false;
  const overflowValues = [style.overflow, style.overflowX, style.overflowY]
    .map(value => String(value || '').toLowerCase());
  const clipsOverflow = overflowValues.some(value => value === 'hidden' || value === 'clip');

  const fontSize = metricLengthPx(style.fontSize, 16) || 16;
  const width = firstMetricLengthPx(fontSize, metrics.width, metrics.clientWidth, style.width, style.inlineSize);
  const height = firstMetricLengthPx(fontSize, metrics.height, metrics.clientHeight, style.height, style.blockSize);
  const isTiny = width !== null && height !== null && width <= 2 && height <= 2;
  const isAbsolutelyHidden = String(style.position || '').toLowerCase() === 'absolute' && isTiny && clipsOverflow;

  const clipPath = String(style.clipPath || style.webkitClipPath || '').trim();
  const clip = String(style.clip || '').trim();
  return isAbsolutelyHidden || clippedByInset(clipPath) || clippedByRect(clip);
}

function isRenderedForBrowserRule(el) {
  for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
    if (cur.getAttribute?.('aria-hidden') === 'true') return false;
    const style = getComputedStyle(cur);
    const visibility = String(style.visibility || '').toLowerCase();
    if (style.display === 'none' || visibility === 'hidden' || visibility === 'collapse') return false;
    if ((parseFloat(style.opacity) || 0) <= 0.01) return false;
    if (String(style.contentVisibility || '').toLowerCase() === 'hidden') return false;
  }
  return true;
}

function checkElementTextOverflowDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (TEXT_OVERFLOW_SKIP_TAGS.has(tag)) return [];
  if (!isRenderedForBrowserRule(el)) return [];
  // Only the element that actually owns overflowing text — not its ancestors,
  // which inherit a wider scrollWidth from the spilling descendant.
  const hasDirectText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
  if (!hasDirectText) return [];
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  if (isScreenReaderOnlyTextStyle(style, {
    width: rect?.width,
    height: rect?.height,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
  })) return [];
  const isScrollRegion = (s) => /(auto|scroll)/.test(s.overflowX || '') || /(auto|scroll)/.test(s.overflow || '');
  if (isScrollRegion(style)) return [];
  // A scrollable ancestor means this overflow is intentional and scrollable.
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (isScrollRegion(getComputedStyle(p))) return [];
  }
  const delta = el.scrollWidth - el.clientWidth;
  if (el.clientWidth > 0 && delta >= 16) {
    return [{ id: 'text-overflow', snippet: `${classSelector(el)} overflows its box by ${Math.round(delta)}px` }];
  }

  // Inline text owners have no client geometry (clientWidth/scrollWidth are
  // both 0), so the scrollWidth path above never sees them. Their overflow
  // registers only on a block ancestor, and that ancestor has no direct text
  // so the ownership gate skips it. (The shipped miss: a nowrap inline
  // <span> spilling 45px past its fixed-width grid cell.) Measure the inline
  // box against the padding box of its nearest block container instead.
  if (el.clientWidth === 0 && rect && rect.width > 0) {
    let container = el.parentElement;
    while (container && container.clientWidth === 0) container = container.parentElement;
    if (!container) return [];
    // Transforms make rect comparisons lie; skip anything on that path.
    for (let p = el; p && p !== container.parentElement; p = p.parentElement) {
      const t = getComputedStyle(p).transform;
      if (t && t !== 'none') return [];
    }
    const cRect = container.getBoundingClientRect();
    const contentRight = cRect.left + container.clientLeft + container.clientWidth;
    const spill = rect.right - contentRight;
    if (spill >= 16) {
      return [{ id: 'text-overflow', snippet: `${classSelector(el)} overflows its container by ${Math.round(spill)}px` }];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Blinking cursor (browser-only)
// ---------------------------------------------------------------------------

// Block / underscore glyphs commonly used as a fake text cursor.
const CURSOR_GLYPH_RE = /^[_|▀-▟■▮❙❚｜]$/;

// How far down the page still counts as the first-viewport / hero region.
// Hero compositions regularly run past a literal viewport height, so the
// gate is a landing-region budget, not an exact fold line.
const CURSOR_FIRST_VIEWPORT_PX = 1200;

// Do the named @keyframes only toggle visibility (opacity dropping to ~0 or
// visibility:hidden), i.e. a blink rather than a fade/move/spin? Walks the
// live CSSOM; cross-origin sheets are skipped.
function keyframesToggleVisibilityDOM(name) {
  if (!name) return false;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
    if (!rules) continue;
    const stack = [...rules];
    while (stack.length) {
      const rule = stack.shift();
      if (rule.cssRules && rule.type !== 7) { stack.push(...rule.cssRules); continue; }
      if (rule.type !== 7 || rule.name !== name) continue; // 7 = KEYFRAMES_RULE
      let togglesOut = false;
      for (const frame of rule.cssRules || []) {
        const fs = frame.style;
        if (!fs) continue;
        for (let i = 0; i < fs.length; i++) {
          const prop = fs[i];
          if (prop === 'opacity') {
            if ((parseFloat(fs.getPropertyValue('opacity')) || 0) <= 0.15) togglesOut = true;
          } else if (prop === 'visibility') {
            if (/hidden/i.test(fs.getPropertyValue('visibility'))) togglesOut = true;
          } else if (prop !== 'animation-timing-function') {
            return false; // keyframes animate something else — not a blink
          }
        }
      }
      return togglesOut;
    }
  }
  return false;
}

// Decorative blinking cursor: a small block / underscore element bound to an
// infinite blink animation, sitting in the first-viewport region of a page.
// Real editable surfaces (inputs, textareas, contenteditable, role=textbox)
// draw their own caret and are exempt. Round pulsing dots stay with the
// pulsing-dot rule.
function checkElementBlinkingCursorDOM(el) {
  const tag = el.tagName.toLowerCase();
  if (['input', 'textarea', 'select', 'img', 'svg', 'script', 'style'].includes(tag)) return [];
  const style = getComputedStyle(el);

  const iterations = (style.animationIterationCount || '').split(',').map(s => s.trim());
  if (!iterations.includes('infinite')) return [];
  const names = (style.animationName || '').split(',').map(s => s.trim()).filter(n => n && n !== 'none');
  if (names.length === 0) return [];
  const blinkName = names.find(n => /blink|caret|cursor/i.test(n))
    || names.find(n => keyframesToggleVisibilityDOM(n));
  if (!blinkName) return [];

  // Real caret contexts are exempt.
  if (el.isContentEditable || el.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]')) return [];

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];

  // First-viewport gate: the hero cliché, not a footer terminal.
  const pageTop = rect.top + (window.scrollY || 0);
  if (pageTop > CURSOR_FIRST_VIEWPORT_PX) return [];

  // Cursor shape: a lone block/underscore glyph, or an empty solid
  // rectangle sized like a text caret (block or underscore form).
  const text = (el.textContent || '').trim();
  const glyphCursor = text.length === 1 && CURSOR_GLYPH_RE.test(text);
  let blockCursor = false;
  if (!glyphCursor) {
    if (text.length > 0 || el.childElementCount > 0) return [];
    const bg = parseAnyColor(style.backgroundColor || '');
    const filled = bg && (bg.a ?? 1) > 0.2;
    const hasBorderFill = ['Left', 'Right', 'Bottom'].some(
      side => (parseFloat(style[`border${side}Width`]) || 0) >= 1,
    );
    if (!filled && !hasBorderFill) return [];
    const vertical = rect.width >= 1 && rect.width <= 24 && rect.height >= 6 && rect.height <= 48 && rect.height >= rect.width;
    const underscore = rect.height >= 1 && rect.height <= 6 && rect.width >= 4 && rect.width <= 24;
    if (!vertical && !underscore) return [];
    // Round dots are the pulsing-dot rule's territory.
    const radiusPx = parseFloat(style.borderRadius) || 0;
    if (radiusPx >= 0.4 * Math.min(rect.width, rect.height)) return [];
    blockCursor = true;
  }
  if (!glyphCursor && !blockCursor) return [];

  // Hero-region promotion: a fake caret blinking in the first ~900px or
  // inside the page chrome is the shipped hero cliché, not an incidental
  // flourish. Promote those from the registry's advisory to warning;
  // lower first-viewport occurrences keep the default severity.
  const inHeroRegion = pageTop <= 900
    || !!(el.closest && el.closest('header, nav, [role="banner"], [role="navigation"]'));
  return [{
    id: 'blinking-cursor',
    snippet: `${classSelector(el)} — ${Math.round(rect.width)}x${Math.round(rect.height)}px blinking cursor (animation "${blinkName}") in the first viewport`,
    ...(inHeroRegion ? { severity: 'warning' } : {}),
  }];
}

// ---------------------------------------------------------------------------
// Content invisible at rest (browser-only, driven by the URL engine)
// ---------------------------------------------------------------------------

// Tags whose text never renders, or whose hidden state is legitimate UI
// (templates, dialogs, native select options). Text inside them stays out of
// both the numerator and the denominator.
const HIDDEN_TEXT_EXCLUDE_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'title', 'head', 'meta', 'link',
  'option', 'optgroup', 'select', 'datalist', 'dialog',
]);

// Measure how many text characters currently render invisible (computed
// opacity ~0 or visibility hidden anywhere on the ancestor chain) versus
// visible. display:none / [hidden] / aria-hidden subtrees are legitimately
// hidden UI (menus, tab panels, templates): they are excluded from the
// denominator entirely rather than counted as invisible.
function measureHiddenTextDOM() {
  const cache = new Map();
  function stateOf(el) {
    if (!el || el.nodeType !== 1 || el === document.documentElement) return 'visible';
    const cached = cache.get(el);
    if (cached) return cached;
    let state;
    const tag = el.tagName.toLowerCase();
    if (HIDDEN_TEXT_EXCLUDE_TAGS.has(tag)) {
      state = 'excluded';
    } else {
      const parentState = stateOf(el.parentElement);
      if (parentState === 'excluded') {
        state = 'excluded';
      } else {
        const style = getComputedStyle(el);
        if (style.display === 'none' || el.hidden || el.getAttribute('aria-hidden') === 'true'
          || String(style.contentVisibility || '').toLowerCase() === 'hidden') {
          state = 'excluded';
        } else if (parentState === 'invisible'
          || (parseFloat(style.opacity) || 0) <= 0.02
          || /^(hidden|collapse)$/.test(style.visibility)) {
          state = 'invisible';
        } else {
          state = 'visible';
        }
      }
    }
    cache.set(el, state);
    return state;
  }

  let totalChars = 0;
  let hiddenChars = 0;
  const hiddenSamples = [];
  for (const el of document.querySelectorAll('body *')) {
    let len = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) len += node.textContent.replace(/\s+/g, ' ').trim().length;
    }
    if (!len) continue;
    const state = stateOf(el);
    if (state === 'excluded') continue;
    totalChars += len;
    if (state === 'invisible') {
      hiddenChars += len;
      if (hiddenSamples.length < 3) {
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (text) hiddenSamples.push(text);
      }
    }
  }
  return { totalChars, hiddenChars, hiddenSamples };
}

// Pure threshold check over a measureHiddenTextDOM() result. The URL engine
// calls it AFTER a reveal sweep (scroll through the document so every
// IntersectionObserver / scroll reveal had its chance to fire, then back to
// the top): a healthy reveal-on-scroll page drops to ~0 invisible text after
// the sweep, while a page whose reveal script died keeps most of its text at
// opacity 0 forever. Fires only when the invisible share stays above 30%
// with a real amount of text behind it.
function checkContentHiddenAtRest({ totalChars = 0, hiddenChars = 0, hiddenSamples = [] } = {}) {
  if (totalChars < 200 || hiddenChars < 150) return [];
  const share = hiddenChars / totalChars;
  if (share <= 0.3) return [];
  const sample = hiddenSamples.length ? ` (e.g. "${hiddenSamples[0]}")` : '';
  return [{
    id: 'content-hidden-at-rest',
    snippet: `${Math.round(share * 100)}% of page text (${hiddenChars} of ${totalChars} chars) stays at opacity 0 / visibility hidden after reveal handlers ran${sample}`,
  }];
}

// ---------------------------------------------------------------------------
// Edge-flush cards in horizontal scrollers (browser-only)
// ---------------------------------------------------------------------------

// A visually-defined card (own opaque background, or borders on 2+ sides)
// inside a horizontal scroller, sitting flush against one edge of the
// scroller's clip box at rest while keeping a clear gutter on the other
// side. The canonical bug: the first snap panel is sized wider than the
// scroller, so its cards end exactly at the clip edge with their rounded
// corners cut, while every sibling panel keeps its inset. Cards that extend
// far past the edge are deliberate peeks and stay exempt.
function checkEdgeFlushCardsDOM() {
  const findings = [];
  const vh = window.innerHeight || 800;
  const isScroller = (s) => /(auto|scroll)/.test(s.overflowX || '') || /(auto|scroll)/.test(s.overflow || '');

  for (const scroller of document.querySelectorAll('*')) {
    const style = getComputedStyle(scroller);
    if (!isScroller(style)) continue;
    if (scroller.scrollWidth <= scroller.clientWidth + 8) continue;
    // At rest only: a user-scrolled or snapped-forward scroller legitimately
    // shows cut cards at both edges.
    if (scroller.scrollLeft > 4) continue;
    const scRect = scroller.getBoundingClientRect();
    if (scRect.width < 120 || scRect.height < 60) continue;
    // Landing-region gate: the defect matters where the page opens.
    if (scRect.top + (window.scrollY || 0) > 2 * vh) continue;
    const contentLeft = scRect.left + scroller.clientLeft;
    const contentRight = contentLeft + scroller.clientWidth;

    const flush = [];
    for (const card of scroller.querySelectorAll('*')) {
      if (!isRenderedForBrowserRule(card)) continue;
      // Attribute cards to their nearest scroller only (nested scrollers).
      let owner = card.parentElement;
      while (owner && owner !== scroller && !isScroller(getComputedStyle(owner))) owner = owner.parentElement;
      if (owner !== scroller) continue;
      const cs = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 40) continue;
      const bg = parseAnyColor(cs.backgroundColor || '');
      const hasBg = !!(bg && (bg.a ?? 1) > 0.5);
      const borderSides = ['Top', 'Right', 'Bottom', 'Left']
        .filter(side => (parseFloat(cs[`border${side}Width`]) || 0) > 0).length;
      if (!hasBg && borderSides < 2) continue;
      const leftGutter = rect.left - contentLeft;
      const rightGap = contentRight - rect.right;
      // Flush right with a left gutter, or the mirror. The -24 floor keeps
      // deliberately peeking next-cards (cut mid-card) exempt.
      const flushRight = leftGutter >= 6 && rightGap < 8 && rightGap > -24;
      const flushLeft = rightGap >= 6 && leftGutter < 8 && leftGutter > -24;
      if (!flushRight && !flushLeft) continue;
      flush.push({ card, edge: flushRight ? 'right' : 'left', gap: Math.round(flushRight ? rightGap : leftGutter) });
    }
    if (flush.length === 0) continue;
    const worst = flush.reduce((a, b) => (b.gap < a.gap ? b : a));
    findings.push({
      el: scroller,
      type: 'edge-flush-cards',
      detail: `${flush.length} card${flush.length === 1 ? '' : 's'} flush against the ${worst.edge} edge of ${classSelector(scroller)} at rest (${worst.gap}px gap, e.g. ${classSelector(worst.card)})`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Text occlusion / element overlap (browser-only)
// ---------------------------------------------------------------------------

// An opaque decorated box: a near-solid background fill or two-plus visible
// borders make it hide whatever sits behind it. Gradient / image fills are
// deliberately excluded — a scrim gradient over hero imagery is a contrast
// layer, not an occluder, and belongs to the pixel low-contrast rule.
function isOpaqueDecoratedBox(cs) {
  if (!cs) return false;
  const bg = parseAnyColor(cs.backgroundColor || '');
  if (bg && (bg.a ?? 1) > 0.6) return true;
  const borderSides = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => {
    if ((parseFloat(cs[`border${side}Width`]) || 0) <= 0) return false;
    const bc = parseAnyColor(cs[`border${side}Color`] || '');
    return bc && (bc.a ?? 1) > 0.3;
  }).length;
  return borderSides >= 2;
}

// Is this element lifted out of normal flow into a layer that can cover
// siblings? Two normal-flow blocks stacked vertically cannot truly hide each
// other's ink — an overlap between their rects is line-box bleed from tight
// leading (a display headline reaching up over the line before it), not
// occlusion. Only out-of-flow positioning (absolute / fixed / sticky) moves an
// element off its own row onto the pixels of another; an in-place transform or
// relative nudge on a display headline does not.
function isLayeredElement(el) {
  for (let cur = el; cur && cur.nodeType === 1 && cur !== document.body; cur = cur.parentElement) {
    const pos = String(getComputedStyle(cur).position || 'static');
    if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

function elementDirectText(el) {
  let t = '';
  for (const node of el.childNodes || []) {
    if (node.nodeType === 3) t += node.textContent;
  }
  return t.trim();
}

// Rendered gate that, unlike isRenderedForBrowserRule, does NOT exempt
// aria-hidden subtrees: a decorative aria-hidden box still paints on screen
// and can still visually cover real text.
function isPaintedForOcclusion(el) {
  for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
    const style = getComputedStyle(cur);
    const visibility = String(style.visibility || '').toLowerCase();
    if (style.display === 'none' || visibility === 'hidden' || visibility === 'collapse') return false;
    if ((parseFloat(style.opacity) || 0) <= 0.05) return false;
    if (String(style.contentVisibility || '').toLowerCase() === 'hidden') return false;
  }
  return true;
}

// Detects text that is actually painted UNDER an opaque box or another text
// run (the reader can't read it), plus two structural overlap tells the
// elementFromPoint probe can't reach: a large headline whose edge tucks behind
// an opaque card, and an inline element whose leaked padding-box (a common
// class-name-collision bug) covers a sibling.
//
// The occlusion probe is viewport-bound: elementFromPoint only answers for the
// scan's current viewport (scroll 0), so the ground-truth paths cover the
// first-viewport composition where collisions matter most. The inline-leak
// path is pure geometry and runs anywhere on the page.
const OCCLUSION_TEXT_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'title']);

function checkTextOcclusionDOM() {
  const findings = [];
  const seenVictims = new Set();
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;

  const isFloated = (cs) => {
    const f = String(cs.cssFloat || cs.float || 'none').toLowerCase();
    return f === 'left' || f === 'right';
  };
  const isMarqueeish = (el, cs) => {
    if (el.tagName === 'MARQUEE') return true;
    const ident = `${el.getAttribute?.('class') || ''} ${el.getAttribute?.('id') || ''}`;
    if (/\b(marquee|ticker|scroller|carousel|conveyor)\b/i.test(ident)) return true;
    const anim = String(cs.animationName || '').toLowerCase();
    return /marquee|ticker|scroll/.test(anim);
  };
  // A fixed or sticky overlay (status bar, toolbar, sticky header) floats above
  // scrolling content by design — whatever sits under it at rest scrolls clear,
  // so it is not occluding the page.
  const isPinnedOverlay = (el) => {
    for (let cur = el; cur && cur.nodeType === 1 && cur !== document.body; cur = cur.parentElement) {
      const pos = String(getComputedStyle(cur).position || 'static');
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  };

  // Collect renderable text owners in / near the first viewport for the
  // elementFromPoint probe. SVG <text> counts too.
  const textEls = [];
  for (const el of document.querySelectorAll('body *')) {
    const tag = el.tagName.toLowerCase();
    if (OCCLUSION_TEXT_SKIP_TAGS.has(tag)) continue;
    const inSvg = !!el.closest('svg');
    if (inSvg && tag !== 'text') continue;
    const text = inSvg ? (el.textContent || '').trim() : elementDirectText(el);
    if (text.length < 2) continue;
    if (!isPaintedForOcclusion(el)) continue;
    let rect; try { rect = el.getBoundingClientRect(); } catch { continue; }
    if (rect.width < 6 || rect.height < 6) continue;
    // Viewport-bound probe: keep text whose box overlaps the live viewport.
    if (rect.bottom <= 0 || rect.top >= vh) continue;
    textEls.push({ el, rect, text, inSvg });
  }

  for (const victim of textEls) {
    const { el, rect, text } = victim;
    if (seenVictims.has(el)) continue;
    const style = getComputedStyle(el);
    if (isScreenReaderOnlyTextStyle(style, { width: rect.width, height: rect.height, clientWidth: el.clientWidth, clientHeight: el.clientHeight })) continue;

    const cols = Math.max(6, Math.min(30, Math.round(rect.width / 12)));
    const rows = Math.max(1, Math.min(4, Math.round(rect.height / 14)));
    let total = 0;
    let occluded = 0;
    let occluderEl = null;
    let occluderKind = '';
    for (let i = 0; i < cols; i++) {
      const x = rect.left + rect.width * ((i + 0.5) / cols);
      if (x < 1 || x > vw - 1) continue;
      for (let j = 0; j < rows; j++) {
        const y = rect.top + rect.height * ((j + 0.5) / rows);
        if (y < 1 || y > vh - 1) continue;
        total++;
        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        // Text visible here: the probe returns the text itself, a descendant,
        // or one of its ancestors (the text's own container / background).
        if (top === el || el.contains(top) || top.contains(el)) continue;
        const topCs = getComputedStyle(top);
        if (isFloated(topCs) || isMarqueeish(top, topCs) || isPinnedOverlay(top)) continue;
        const topTag = top.tagName.toLowerCase();
        // Text sitting under a raw image/video is contrast territory (deduped
        // against the pixel low-contrast rule); leave those alone here.
        if (['img', 'video', 'canvas', 'picture'].includes(topTag)) continue;
        const topHasText = elementDirectText(top).length > 0 || !!top.closest('svg');
        if (isOpaqueDecoratedBox(topCs)) {
          occluded++;
          if (!occluderEl) { occluderEl = top; occluderKind = 'box'; }
        } else if (topHasText) {
          occluded++;
          if (!occluderEl) { occluderEl = top; occluderKind = 'text'; }
        }
      }
    }
    if (total === 0 || !occluderEl) continue;
    const occFrac = occluded / total;
    // A solid box's paint fills its rect, so box coverage is real at a lower
    // bar. Text coverage rides on elementFromPoint returning the occluder's box
    // (line box / container), which can exceed its actual glyph ink, so the
    // text bar is higher — partial overlaps below it are crowding, not burial.
    if (occFrac < (occluderKind === 'text' ? 0.45 : 0.3)) continue;

    // (i) Substantial occlusion: a real slab of the text is behind something.
    if (occluderKind === 'text') {
      // Two SVG texts inside the same emblem (concentric arcs, monogram) are one
      // decorative unit, not a collision.
      const victimSvg = el.closest('svg');
      const occSvg = occluderEl.closest('svg');
      if (victimSvg && occSvg && victimSvg === occSvg) continue;
      // Both sides in plain flow: the overlap is line-box bleed from tight
      // leading (a big headline reaching up over its own eyebrow), not one text
      // run painted over another.
      if (!isLayeredElement(el) && !isLayeredElement(occluderEl)) continue;
    }
    seenVictims.add(el);
    findings.push({
      el,
      type: 'text-occlusion',
      detail: `${classSelector(el)} "${text.slice(0, 24)}" is ${Math.round(occFrac * 100)}% covered by ${occluderKind === 'text' ? 'overlapping text' : 'an opaque element'} (${classSelector(occluderEl)})`,
    });
  }

  // (ii) Headline overhanging an opaque card: a display-scale line whose bulk
  // sits outside a bounded content card but whose edge clips into it. The text
  // may still paint on top and stay readable, but the two layers were dropped
  // on the same pixels — a placement collision, not a composition.
  const cards = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg')) continue;
    if (!isPaintedForOcclusion(el)) continue;
    const cs = getComputedStyle(el);
    const bg = parseAnyColor(cs.backgroundColor || '');
    const bgImg = cs.backgroundImage || '';
    if (!bg || (bg.a ?? 1) <= 0.7) continue;
    if (bgImg && bgImg !== 'none' && /(gradient|url)\(/i.test(bgImg)) continue;
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((s) => (parseFloat(cs[`border${s}Width`]) || 0) > 0);
    const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    if (!hasBorder && !hasShadow) continue;
    if (isPinnedOverlay(el)) continue;
    let cr; try { cr = el.getBoundingClientRect(); } catch { continue; }
    if (cr.width < 100 || cr.width > 0.8 * vw || cr.height < 60) continue;
    cards.push({ el, rect: cr });
  }
  for (const victim of textEls) {
    const { el, rect, text } = victim;
    if (seenVictims.has(el)) continue;
    const style = getComputedStyle(el);
    if ((parseFloat(style.fontSize) || 16) < 40) continue;
    let lineHeight = parseFloat(style.lineHeight);
    if (!Number.isFinite(lineHeight)) lineHeight = (parseFloat(style.fontSize) || 16) * 1.2;
    const centerX = rect.left + rect.width / 2;
    for (const card of cards) {
      if (card.el === el || el.contains(card.el) || card.el.contains(el)) continue;
      const ix = Math.max(0, Math.min(rect.right, card.rect.right) - Math.max(rect.left, card.rect.left));
      const iy = Math.max(0, Math.min(rect.bottom, card.rect.bottom) - Math.max(rect.top, card.rect.top));
      if (ix < 8 || iy < 0.5 * lineHeight) continue;
      // The headline's bulk must sit outside the card — only its edge clips in.
      if (centerX >= card.rect.left && centerX <= card.rect.right) continue;
      if (ix > 0.5 * rect.width) continue;
      seenVictims.add(el);
      findings.push({
        el,
        type: 'text-occlusion',
        detail: `${classSelector(el)} "${text.slice(0, 24)}" overhangs ${classSelector(card.el)} by ${Math.round(ix)}px — the headline and the card collide`,
      });
      break;
    }
  }

  // (iii) Inline padding leak: an inline element with an opaque background and
  // large vertical padding paints a filled block whose padding-box overflows
  // its line (inline padding reserves no vertical space), so the fill lands on
  // the content above and below instead of enclosing its own text. The
  // canonical bug is a class-name collision that hands a decorative marker a
  // payoff card's padding. The tell is a rendered height several times the line
  // height, which distinguishes the leak from a padded inline highlight.
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg')) continue;
    if (!isPaintedForOcclusion(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display !== 'inline') continue;
    const bg = parseAnyColor(cs.backgroundColor || '');
    if (!bg || (bg.a ?? 1) <= 0.6) continue;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    if (padTop + padBottom < 24) continue;
    let rect; try { rect = el.getBoundingClientRect(); } catch { continue; }
    if (rect.width < 12 || rect.height < 24) continue;
    const fontSize = parseFloat(cs.fontSize) || 16;
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.4;
    // The padding box has to overflow the line by a clear margin — a padded
    // inline highlight sits at roughly one line height, the leak at several.
    if (rect.height < 2.2 * lineHeight) continue;
    if (seenVictims.has(el)) continue;
    // Name a neighbour the fill lands on, if one is nearby (paint state aside,
    // reveal-on-scroll siblings still occupy the space it covers).
    let overlaps = null;
    for (const other of el.parentElement ? el.parentElement.children : []) {
      if (other === el || el.contains(other) || other.contains(el)) continue;
      if (getComputedStyle(other).display === 'none') continue;
      const oRect = other.getBoundingClientRect();
      const ix = Math.max(0, Math.min(rect.right, oRect.right) - Math.max(rect.left, oRect.left));
      const iy = Math.max(0, Math.min(rect.bottom, oRect.bottom) - Math.max(rect.top, oRect.top));
      if (ix > 4 && iy > 4 && (other.textContent || '').trim().length > 0) { overlaps = other; break; }
    }
    seenVictims.add(el);
    findings.push({
      el,
      type: 'text-occlusion',
      detail: `${classSelector(el)} is an inline element whose opaque fill leaks ${Math.round(rect.height)}px past its line${overlaps ? ` onto ${classSelector(overlaps)}` : ''}`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// First-viewport column overflow — the stretched-hero signature (browser-only)
// ---------------------------------------------------------------------------

// A multi-column composition that opens the page (grid/flex with two or more
// side-by-side columns, each a real share of the width) where one column's
// content runs far past the fold while its sibling fits inside a single
// viewport. The row stretches to the tall column, so the short one floats in a
// screen-and-a-half of dead space and the fold falls deep inside a single
// section. Single-column pages and full-page heroes (no sibling column) are
// exempt because there is no fitting sibling to contrast against.
function checkFirstViewportColumnOverflowDOM() {
  const findings = [];
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const isMultiCol = (s) => /(^|inline-)(grid|flex)$/.test(String(s.display || ''));

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (!isMultiCol(style)) continue;
    let rect; try { rect = el.getBoundingClientRect(); } catch { continue; }
    if (rect.width < 0.5 * vw) continue;
    const pageTop = rect.top + (window.scrollY || 0);
    const pageBottom = pageTop + rect.height;
    // The fold must fall inside this container: it opens within the first
    // viewport and runs past it.
    if (pageTop >= vh * 0.9 || pageBottom <= vh) continue;

    // Direct children that read as side-by-side columns: a real width share,
    // not full-bleed (stacked single column), sharing the container's top row.
    const cols = [];
    for (const child of el.children) {
      const cs = getComputedStyle(child);
      if (cs.display === 'none') continue;
      if (String(cs.position || '') === 'absolute' || String(cs.position || '') === 'fixed') continue;
      let cr; try { cr = child.getBoundingClientRect(); } catch { continue; }
      const wShare = cr.width / rect.width;
      if (wShare < 0.25 || wShare > 0.9) continue;
      if (cr.height < 40) continue;
      // Content extent: how far the child's own content actually reaches,
      // independent of a stretched row height.
      let contentBottom = cr.top;
      for (const d of child.querySelectorAll('*')) {
        const ds = getComputedStyle(d);
        if (ds.position === 'absolute' || ds.position === 'fixed') continue;
        if (ds.display === 'none' || ds.visibility === 'hidden') continue;
        let dr; try { dr = d.getBoundingClientRect(); } catch { continue; }
        if (dr.width > 0 && dr.height > 0) contentBottom = Math.max(contentBottom, dr.bottom);
      }
      cols.push({ child, top: cr.top, contentH: contentBottom - cr.top });
    }
    if (cols.length < 2) continue;
    // Side-by-side: the two candidate columns must share the top row.
    cols.sort((a, b) => b.contentH - a.contentH);
    const tall = cols[0];
    const shortest = cols[cols.length - 1];
    if (Math.abs(tall.top - shortest.top) > 0.25 * vh) continue;
    if (tall.contentH <= vh * 1.4) continue;
    if (shortest.contentH > vh) continue;

    findings.push({
      el,
      type: 'first-viewport-column-overflow',
      detail: `${classSelector(el)} opens the page with one column running ${Math.round(tall.contentH / vh * 100)}% of the viewport tall while a sibling fits in ${Math.round(shortest.contentH / vh * 100)}% — the fold falls deep inside the section`,
    });
  }
  return findings;
}

export {
  checkBorders,
  isEmojiOnlyText,
  checkColors,
  checkHoverContrast,
  checkElementHoverContrast,
  parseColorMix,
  compositeColorOver,
  isCardLikeFromProps,
  checkIconTile,
  resolveSerif,
  checkItalicSerif,
  isAccentColor,
  checkHeroEyebrow,
  checkRepeatedSectionKickers,
  checkMotion,
  checkGlow,
  scanCssTextForGlow,
  scanCssTextForGridBackground,
  scanCssTextForRadialHalo,
  scanCssTextForPseudoStripe,
  scanCssTextForInsetStripe,
  scanCssTextForMarquee,
  collectMarqueeKeyframes,
  collectCssCustomProps,
  cssLengthToPx,
  scanCssTextForPulsingDot,
  scanHtmlForShapeAssembledIllustration,
  checkHtmlPatterns,
  readOwnBackgroundColor,
  resolveBackground,
  resolveGradientStops,
  parseRadiusToPx,
  resolveBorderRadiusPx,
  checkElementBordersDOM,
  checkElementColorsDOM,
  checkElementIconTileDOM,
  checkElementItalicSerifDOM,
  checkElementHeroEyebrowDOM,
  buildCustomPropMap,
  resolveVarRefs,
  oklchToRgb,
  parseAnyColor,
  parseColorResolved,
  cleanInlineText,
  isRepeatedKickerCandidate,
  collectRepeatedSectionKickerCandidates,
  checkRepeatedSectionKickersDOM,
  parseNumberedLabelText,
  isNumberedSectionLabelCandidate,
  collectNumberedSectionLabelCandidates,
  checkNumberedSectionLabels,
  checkNumberedSectionLabelsFromDoc,
  checkNumberedSectionLabelsDOM,
  checkEmDashOveruse,
  checkEmDashOveruseDOM,
  isRepeatedTextContainer,
  collectRepeatedContainerTextFindings,
  checkRepeatedContainerTextFromDoc,
  checkRepeatedContainerTextDOM,
  checkElementPseudoStripeDOM,
  checkElementMotionDOM,
  checkElementGlowDOM,
  checkElementAIPaletteDOM,
  resolveFontSizePx,
  resolveLengthPx,
  checkQuality,
  checkElementQualityDOM,
  checkPageQualityFromDoc,
  checkPageQualityDOM,
  checkElementQuality,
  checkElementBorders,
  checkElementColors,
  checkElementIconTile,
  checkElementItalicSerif,
  checkElementHeroEyebrow,
  checkRepeatedSectionKickersFromDoc,
  checkElementMotion,
  checkElementGlow,
  checkTypography,
  isCardLikeDOM,
  checkLayout,
  checkPageTypography,
  isCardLike,
  checkPageLayout,
  isCreamColor,
  checkCreamPalette,
  checkOversizedH1,
  checkElementOversizedH1,
  checkElementOversizedH1DOM,
  shadowMaxBlurPx,
  checkGptThinBorderWideShadow,
  checkElementGptBorderShadow,
  checkElementGptBorderShadowDOM,
  checkClippedOverflow,
  checkElementClippedOverflow,
  checkElementClippedOverflowDOM,
  isScreenReaderOnlyTextStyle,
  checkElementTextOverflowDOM,
  checkHeadingRhythmDOM,
  checkElementBlinkingCursorDOM,
  measureHiddenTextDOM,
  checkContentHiddenAtRest,
  checkEdgeFlushCardsDOM,
  isOpaqueDecoratedBox,
  isLayeredElement,
  checkTextOcclusionDOM,
  checkFirstViewportColumnOverflowDOM,
};
