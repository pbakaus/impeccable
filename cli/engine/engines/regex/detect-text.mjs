import { GENERIC_FONTS, OVERUSED_FONTS, EM_DASH_FLOOR, EM_DASH_CHARS_PER_DASH } from '../../shared/constants.mjs';
import { isNeutralColor } from '../../shared/color.mjs';
import { extractGoogleFontFamilies } from '../../shared/fonts.mjs';
import { checkSourceDesignSystem } from '../../design-system.mjs';
import { scanCssTextForGlow, scanCssTextForGridBackground, scanCssTextForMarquee, scanCssTextForPseudoStripe, scanCssTextForRadialHalo } from '../../rules/checks.mjs';
import { isFullPage } from '../../shared/page.mjs';
import { applyInlineIgnores } from '../../shared/inline-ignores.mjs';
import { finding } from '../../findings.mjs';
import { profileFindings, profileStep } from '../../profile/profiler.mjs';

// ---------------------------------------------------------------------------
// Regex fallback (non-HTML files: CSS, JSX, TSX, etc.)
// ---------------------------------------------------------------------------

const hasRounded = (line) =>
  /\brounded(?:-\w+)?\b/.test(line.replace(/\brounded-none\b/g, ''));
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

const JS_SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const STYLESHEET_EXTS = new Set(['.css', '.scss', '.sass', '.less']);
const REGEX_PREFIX_KEYWORDS = new Set(['await', 'case', 'default', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw', 'typeof', 'void', 'yield']);
const BLOCK_BRACE_PREFIX_KEYWORDS = new Set(['do', 'else', 'finally', 'try']);

function isInsideOpeningJsxTag(source) {
  const tagStart = source.lastIndexOf('<');
  if (tagStart === -1 || !/^<[A-Za-z][\w.:-]*/.test(source.slice(tagStart))) return false;

  let quote = '';
  for (let cursor = tagStart + 1; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (quote) {
      if (char === '\\') cursor++;
      else if (char === quote) quote = '';
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '>') {
      return false;
    }
  }
  return true;
}

/**
 * Blank JavaScript comments without moving any following source. Regex
 * findings keep their original line numbers, while prose examples inside
 * comments cannot masquerade as rendered markup.
 */
function stripJsComments(content, options = {}) {
  let state = 'code';
  let output = '';
  let lastSignificant = '';
  let previousSignificant = '';
  let antePreviousSignificant = '';
  let currentWord = '';
  let currentWordPrefix = '';
  let wordSeparated = false;
  let regexCharClass = false;
  let jsxExpressionDepth = 0;
  let lastClosedBraceKind = '';
  const braceKinds = [];
  const templateExpressionDepths = [];

  const braceKind = (startsJsxExpression = false) => (
    !startsJsxExpression && (
      !lastSignificant ||
      lastSignificant === ')' ||
      lastSignificant === ';' ||
      lastSignificant === '}' ||
      (previousSignificant === '=' && lastSignificant === '>') ||
      BLOCK_BRACE_PREFIX_KEYWORDS.has(currentWord)
    ) ? 'block' : 'expression'
  );

  const recordSignificant = (char) => {
    if (/\s/.test(char)) {
      wordSeparated = true;
      return;
    }
    const isWordChar = /[\w$]/.test(char);
    if (isWordChar && (wordSeparated || !currentWord)) {
      currentWord = '';
      currentWordPrefix = lastSignificant;
    } else if (!isWordChar) {
      currentWordPrefix = '';
    }
    wordSeparated = false;
    antePreviousSignificant = previousSignificant;
    previousSignificant = lastSignificant;
    lastSignificant = char;
    currentWord = isWordChar ? currentWord + char : '';
  };

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        output += char;
        state = 'code';
      } else {
        output += ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output += '  ';
        i++;
        state = 'code';
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'regex') {
      output += char;
      if (char === '\\' && next) {
        output += next;
        i++;
      } else if (char === '[') {
        regexCharClass = true;
      } else if (char === ']') {
        regexCharClass = false;
      } else if (char === '/' && !regexCharClass) {
        state = 'code';
        recordSignificant('/');
      }
      continue;
    }

    if (state === 'template' && char === '$' && next === '{') {
      output += '${';
      i++;
      recordSignificant('$');
      recordSignificant('{');
      templateExpressionDepths.push(1);
      braceKinds.push('expression');
      if (jsxExpressionDepth) jsxExpressionDepth++;
      state = 'code';
      continue;
    }

    if (state !== 'code') {
      output += char;
      if (char === '\\' && next) {
        output += next;
        i++;
      } else if (
        (state === 'single-quote' && char === "'") ||
        (state === 'double-quote' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'code';
        recordSignificant(char);
      }
      continue;
    }

    const jsxUrlSeparator = options.jsx && char === '/' && next === '/' &&
      jsxExpressionDepth === 0 &&
      (output.endsWith('http:') ||
        output.endsWith('https:') ||
        (/<[A-Za-z](?:[^>]*[^/])?>[^<]*$/.test(output.slice(output.lastIndexOf('\n') + 1)) &&
          /^[\w.-]+\.[A-Za-z]{2,}(?=[:/?#\s<]|$)/.test(content.slice(i + 2))));
    const afterPostfixUpdate = (lastSignificant === '+' || lastSignificant === '-') &&
      previousSignificant === lastSignificant &&
      antePreviousSignificant !== lastSignificant;
    if (char === '/' && next === '/' && jsxUrlSeparator) {
      output += '//';
      i++;
      recordSignificant('/');
      recordSignificant('/');
    } else if (char === '/' && next === '/') {
      output += '  ';
      i++;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      output += '  ';
      i++;
      state = 'block-comment';
    } else if (templateExpressionDepths.length && char === '{') {
      output += char;
      templateExpressionDepths[templateExpressionDepths.length - 1]++;
      braceKinds.push(braceKind());
      if (jsxExpressionDepth) jsxExpressionDepth++;
      recordSignificant(char);
    } else if (templateExpressionDepths.length && char === '}') {
      output += char;
      const depthIndex = templateExpressionDepths.length - 1;
      templateExpressionDepths[depthIndex]--;
      lastClosedBraceKind = braceKinds.pop() || '';
      if (jsxExpressionDepth) jsxExpressionDepth--;
      recordSignificant(char);
      if (templateExpressionDepths[depthIndex] === 0) {
        templateExpressionDepths.pop();
        state = 'template';
      }
    } else if (
      char === '/' &&
      (!lastSignificant ||
        (/[=([{!?:;,&|+\-*%^~<>]/.test(lastSignificant) && !afterPostfixUpdate) ||
        (lastSignificant === '}' && lastClosedBraceKind === 'block') ||
        (previousSignificant === '=' && lastSignificant === '>') ||
        (currentWordPrefix !== '.' && REGEX_PREFIX_KEYWORDS.has(currentWord)))
    ) {
      output += char;
      state = 'regex';
      regexCharClass = false;
    } else {
      output += char;
      const startsJsxExpression = options.jsx && char === '{' && jsxExpressionDepth === 0 &&
        (/<[A-Za-z](?:[^>]*[^/])?>[^<]*$/.test(output.slice(output.lastIndexOf('\n') + 1, -1)) ||
          isInsideOpeningJsxTag(output.slice(0, -1)));
      if (char === '{') braceKinds.push(braceKind(startsJsxExpression));
      else if (char === '}') lastClosedBraceKind = braceKinds.pop() || '';
      if (char === '{' && (jsxExpressionDepth || startsJsxExpression)) jsxExpressionDepth++;
      else if (char === '}' && jsxExpressionDepth) jsxExpressionDepth--;
      recordSignificant(char);
      if (char === "'") state = 'single-quote';
      else if (char === '"') state = 'double-quote';
      else if (char === '`') state = 'template';
    }
  }

  return output;
}

function stripCssComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
}

function blankHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '));
}

function blankCssLineCommentsInStyleBlocks(text) {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let output = '';
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const inner = match[1];
    const openLength = match[0].length - inner.length - '</style>'.length;
    output += text.slice(lastIndex, match.index);
    output += match[0].slice(0, openLength);
    output += blankCssLineComments(inner);
    output += match[0].slice(openLength + inner.length);
    lastIndex = re.lastIndex;
  }
  return output + text.slice(lastIndex);
}

function blankHtmlAndCssCommentsOutsideScripts(text) {
  const re = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let output = '';
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    output += blankCssLineCommentsInStyleBlocks(stripCssComments(blankHtmlComments(text.slice(lastIndex, match.index))));
    output += match[0];
    lastIndex = re.lastIndex;
  }
  return output + blankCssLineCommentsInStyleBlocks(stripCssComments(blankHtmlComments(text.slice(lastIndex))));
}

function blankCssLineComments(text) {
  let output = '';
  let state = 'code';
  let urlDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (state === 'line') {
      if (char === '\n') {
        output += '\n';
        state = 'code';
      } else {
        output += ' ';
      }
      continue;
    }
    if (state === 'single' || state === 'double') {
      output += char;
      if (char === '\\' && next) {
        output += next;
        i++;
      } else if ((state === 'single' && char === "'") || (state === 'double' && char === '"')) {
        state = 'code';
      }
      continue;
    }
    const prev = output.length ? output[output.length - 1] : '';
    if (char === '/' && next === '/' && urlDepth === 0 && prev !== ':' && prev !== '(' && prev !== '\\') {
      output += '  ';
      i++;
      state = 'line';
      continue;
    }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    if (char === '(') {
      const behind = output.replace(/\s+$/, '');
      if (urlDepth > 0 || /url$/i.test(behind)) urlDepth++;
    } else if (char === ')' && urlDepth) {
      urlDepth--;
    }
    output += char;
  }
  return output;
}

function findAstroFrontmatterClose(text) {
  if (!text.startsWith('---')) return -1;
  let cursor = text.indexOf('\n');
  if (cursor === -1) return -1;
  cursor += 1;
  while (cursor < text.length) {
    if (text[cursor - 1] === '\n' && text.startsWith('---', cursor)) {
      let end = cursor + 3;
      while (text[end] === ' ' || text[end] === '\t') end++;
      if (end >= text.length || text[end] === '\n' || text[end] === '\r') return cursor - 1;
    }
    const char = text[cursor];
    const next = text[cursor + 1];
    if (char === "'" || char === '"') {
      const close = findQuotedStringEnd(text, cursor, char);
      if (close === -1) return -1;
      cursor = close + 1;
      continue;
    }
    if (char === '`') {
      const close = findTemplateLiteralEnd(text, cursor);
      if (close === -1) return -1;
      cursor = close + 1;
      continue;
    }
    if (char === '/' && next === '/') {
      const lineEnd = text.indexOf('\n', cursor);
      if (lineEnd === -1) return -1;
      cursor = lineEnd;
      continue;
    }
    if (char === '/' && next === '*') {
      const commentEnd = text.indexOf('*/', cursor + 2);
      if (commentEnd === -1) return -1;
      cursor = commentEnd + 2;
      continue;
    }
    if (char === '/' && next !== '/' && next !== '*') {
      const close = findRegexLiteralEnd(text, cursor);
      if (close !== -1) {
        cursor = close + 1;
        continue;
      }
    }
    cursor++;
  }
  return -1;
}

function blankAstroFrontmatterComments(text) {
  const close = findAstroFrontmatterClose(text);
  if (close === -1) return text;
  return stripJsComments(text.slice(0, close)) + text.slice(close);
}

function blankCommentsForMatchers(text, ext) {
  if (PAGE_ANALYZER_EXTS.has(ext)) {
    const withFrontmatter = ext === '.astro' ? blankAstroFrontmatterComments(text) : text;
    return blankHtmlAndCssCommentsOutsideScripts(withFrontmatter);
  }
  if (STYLESHEET_EXTS.has(ext)) {
    const withoutBlocks = stripCssComments(text);
    return ext === '.css' ? withoutBlocks : blankCssLineComments(withoutBlocks);
  }
  return text;
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

const TW_SOLID_CHROMATIC_BG_RE = /\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+(?!\/)\b/;

function scanJs(text, start, onChar) {
  let stringQuote = '';
  let inTemplate = false;
  let paren = 0;
  let brace = 0;
  const interpBrace = [];

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    const prev = text[i - 1];
    const next = text[i + 1];

    if (stringQuote) {
      if (char === '\\') { i++; continue; }
      if (char === stringQuote) stringQuote = '';
      continue;
    }
    if (inTemplate && interpBrace.length === 0) {
      if (char === '\\') { i++; continue; }
      if (char === '$' && next === '{') {
        brace++;
        interpBrace.push(brace);
        i++;
        continue;
      }
      if (char === '`') { inTemplate = false; continue; }
      continue;
    }

    if (char === "'" || char === '"') { stringQuote = char; continue; }
    if (char === '`') { inTemplate = true; continue; }
    if (char === '(') { paren++; continue; }
    if (char === ')') { paren--; continue; }
    if (char === '{') { brace++; continue; }
    if (char === '}') {
      brace--;
      if (interpBrace.length && brace < interpBrace[interpBrace.length - 1]) interpBrace.pop();
      continue;
    }
    if (onChar(char, i, prev, next, { paren, brace })) return;
  }
}

function containingMarkupTag(line, index) {
  let i = 0;
  while (i < line.length) {
    const tagStart = line.indexOf('<', i);
    if (tagStart === -1) break;
    if (!/^<[A-Za-z]/.test(line.slice(tagStart))) {
      i = tagStart + 1;
      continue;
    }
    let tagEnd = -1;
    scanJs(line, tagStart + 1, (char, j, _p, _n, depth) => {
      if (char === '>' && depth.brace === 0) {
        tagEnd = j;
        return true;
      }
      return false;
    });
    if (tagEnd === -1) break;
    if (index >= tagStart && index <= tagEnd) {
      return { text: line.slice(tagStart, tagEnd + 1), start: tagStart };
    }
    i = tagEnd + 1;
  }
  return { text: line, start: 0 };
}

function findTernarySplit(text) {
  let qPos = -1;
  let qParen = 0;
  let qBrace = 0;
  let split = null;

  scanJs(text, 0, (char, i, prev, next, depth) => {
    if (qPos === -1 && char === '?' && prev !== '.' && next !== '?' && next !== '.') {
      qPos = i;
      qParen = depth.paren;
      qBrace = depth.brace;
      return false;
    }
    if (qPos !== -1 && char === ':' && depth.paren === qParen && depth.brace === qBrace) {
      split = {
        common: text.slice(0, qPos),
        consequent: text.slice(qPos + 1, i),
        alternate: text.slice(i + 1),
      };
      return true;
    }
    return false;
  });
  return split;
}

function grayOnColorScopes(line, index) {
  const { text: scope, start } = containingMarkupTag(line, index);
  const split = findTernarySplit(scope);
  if (!split) return [scope];

  const rel = index - start;
  const qPos = split.common.length;
  const colonPos = qPos + 1 + split.consequent.length;
  const thenScope = split.common + split.consequent;
  const elseScope = split.common + split.alternate;
  if (rel < qPos) return [thenScope, elseScope];
  return [rel < colonPos ? thenScope : elseScope];
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
    test: (m, line) => grayOnColorScopes(line, m.index).some((scope) => TW_SOLID_CHROMATIC_BG_RE.test(scope)),
    fmt: (m, line) => {
      const bg = grayOnColorScopes(line, m.index)
        .map((scope) => scope.match(TW_SOLID_CHROMATIC_BG_RE))
        .find(Boolean);
      return `${m[0]} on ${bg?.[0] || '?'}`;
    } },
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
  // JSX inline style objects use comma-delimited quoted values, not semicolons (issue #548).
  { id: 'layout-transition', regex: /transition\s*:\s*(?:(['"])((?:(?!\1)[^\\]|\\.)*)\1|([^;{}]+))/gi,
    test: (m) => {
      const val = (m[2] ?? m[3] ?? '').toLowerCase();
      if (/\ball\b/.test(val)) return false;
      return /\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding\b|\bmargin\b/.test(val);
    },
    fmt: (m) => {
      const raw = m[2] ?? m[3] ?? '';
      const found = raw.match(/\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/gi);
      return `transition: ${found ? found.join(', ') : raw.trim()}`;
    } },
  { id: 'layout-transition', regex: /transition-property\s*:\s*(?:(['"])((?:(?!\1)[^\\]|\\.)*)\1|([^;{}]+))/gi,
    test: (m) => {
      const val = (m[2] ?? m[3] ?? '').toLowerCase();
      if (/\ball\b/.test(val)) return false;
      return /\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding\b|\bmargin\b/.test(val);
    },
    fmt: (m) => {
      const raw = m[2] ?? m[3] ?? '';
      const found = raw.match(/\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/gi);
      return `transition-property: ${found ? found.join(', ') : raw.trim()}`;
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

function findQuotedStringEnd(content, start, quote) {
  for (let cursor = start + 1; cursor < content.length; cursor++) {
    if (content[cursor] === '\\') cursor++;
    else if (content[cursor] === quote) return cursor;
  }
  return -1;
}

function findRegexLiteralEnd(content, start) {
  let inCharacterClass = false;
  for (let cursor = start + 1; cursor < content.length; cursor++) {
    const char = content[cursor];
    if (char === '\\') {
      cursor++;
    } else if (char === '[') {
      inCharacterClass = true;
    } else if (char === ']') {
      inCharacterClass = false;
    } else if (char === '/' && !inCharacterClass) {
      while (/[A-Za-z]/.test(content[cursor + 1] || '')) cursor++;
      return cursor;
    } else if (char === '\n' || char === '\r') {
      return -1;
    }
  }
  return -1;
}

function findTemplateExpressionEnd(content, start) {
  let depth = 1;
  let lastSignificant = '';
  let previousSignificant = '';
  let antePreviousSignificant = '';
  let currentWord = '';
  let currentWordPrefix = '';
  let wordSeparated = false;
  let lastClosedBraceKind = '';
  const braceKinds = [];

  const braceKind = () => (
    lastSignificant === ')' ||
    lastSignificant === ';' ||
    lastSignificant === '}' ||
    (previousSignificant === '=' && lastSignificant === '>') ||
    BLOCK_BRACE_PREFIX_KEYWORDS.has(currentWord)
      ? 'block'
      : 'expression'
  );

  const recordSignificant = (char) => {
    if (/\s/.test(char)) {
      wordSeparated = true;
      return;
    }
    const isWordChar = /[\w$]/.test(char);
    if (isWordChar && (wordSeparated || !currentWord)) {
      currentWord = '';
      currentWordPrefix = lastSignificant;
    } else if (!isWordChar) {
      currentWordPrefix = '';
    }
    wordSeparated = false;
    antePreviousSignificant = previousSignificant;
    previousSignificant = lastSignificant;
    lastSignificant = char;
    currentWord = isWordChar ? currentWord + char : '';
  };

  for (let cursor = start; cursor < content.length; cursor++) {
    const char = content[cursor];
    const next = content[cursor + 1];
    const afterPostfixUpdate = (lastSignificant === '+' || lastSignificant === '-') &&
      previousSignificant === lastSignificant &&
      antePreviousSignificant !== lastSignificant;
    if (char === "'" || char === '"') {
      cursor = findQuotedStringEnd(content, cursor, char);
      if (cursor === -1) return -1;
      recordSignificant(')');
    } else if (char === '/' && next === '/') {
      const lineEnd = content.indexOf('\n', cursor + 2);
      if (lineEnd === -1) return -1;
      cursor = lineEnd;
    } else if (char === '/' && next === '*') {
      const commentEnd = content.indexOf('*/', cursor + 2);
      if (commentEnd === -1) return -1;
      cursor = commentEnd + 1;
    } else if (
      char === '/' &&
      (!lastSignificant ||
        (/[=([{!?:;,&|+\-*%^~<>]/.test(lastSignificant) && !afterPostfixUpdate) ||
        (lastSignificant === '}' && lastClosedBraceKind === 'block') ||
        (previousSignificant === '=' && lastSignificant === '>') ||
        (currentWordPrefix !== '.' && REGEX_PREFIX_KEYWORDS.has(currentWord)))
    ) {
      cursor = findRegexLiteralEnd(content, cursor);
      if (cursor === -1) return -1;
      recordSignificant(')');
    } else if (char === '`') {
      cursor = findTemplateLiteralEnd(content, cursor);
      if (cursor === -1) return -1;
      recordSignificant(')');
    } else if (char === '{') {
      depth++;
      braceKinds.push(braceKind());
      recordSignificant(char);
    } else if (char === '}') {
      depth--;
      if (depth === 0) return cursor;
      lastClosedBraceKind = braceKinds.pop() || '';
      recordSignificant(char);
    } else {
      recordSignificant(char);
    }
  }
  return -1;
}

function findTemplateLiteralEnd(content, start) {
  for (let cursor = start + 1; cursor < content.length; cursor++) {
    const char = content[cursor];
    if (char === '\\') {
      cursor++;
    } else if (char === '`') {
      return cursor;
    } else if (char === '$' && content[cursor + 1] === '{') {
      cursor = findTemplateExpressionEnd(content, cursor + 2);
      if (cursor === -1) return -1;
    }
  }
  return -1;
}

function findCSSinJSTemplates(content) {
  const templates = [];
  const tagRe = /\b(?:styled(?:\.\w+|\([^)]+\))|css)/g;
  let match;
  while ((match = tagRe.exec(content)) !== null) {
    let cursor = match.index + match[0].length;
    while (/\s/.test(content[cursor] || '')) cursor++;

    if (content[cursor] === '<') {
      let depth = 0;
      while (cursor < content.length) {
        const char = content[cursor];
        if (char === '<') depth++;
        else if (char === '>' && content[cursor - 1] !== '=') depth--;
        cursor++;
        if (depth === 0) break;
      }
      if (depth !== 0) continue;
      while (/\s/.test(content[cursor] || '')) cursor++;
    }

    if (content[cursor] !== '`') continue;
    const contentStart = cursor + 1;
    cursor = findTemplateLiteralEnd(content, cursor);
    if (cursor === -1) continue;

    templates.push({
      tagStart: match.index,
      contentStart,
      contentEnd: cursor,
    });
    tagRe.lastIndex = cursor + 1;
  }
  return templates;
}

function extractCSSinJS(content, ext) {
  ext = ext.toLowerCase();
  if (!CSS_IN_JS_EXTENSIONS.has(ext)) return [];
  return findCSSinJSTemplates(content).map((template) => {
    const before = content.substring(0, template.tagStart);
    const startLine = before.split('\n').length;
    return {
      content: content.slice(template.contentStart, template.contentEnd),
      startLine,
    };
  });
}

function stripCssInJsComments(content, ext) {
  if (!CSS_IN_JS_EXTENSIONS.has(ext.toLowerCase())) return content;
  const templates = findCSSinJSTemplates(content);
  let output = '';
  let cursor = 0;
  for (const template of templates) {
    output += content.slice(cursor, template.contentStart);
    output += stripCssComments(content.slice(template.contentStart, template.contentEnd));
    cursor = template.contentEnd;
  }
  return output + content.slice(cursor);
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
  // The 3 text-content analyzers are at indices 1-3 in REGEX_ANALYZERS.
  // flat-type-hierarchy left this source-only path in issue #619 because it
  // needs rendered role and usage evidence.
  const findings = [];
  for (let i = 0; i < TEXT_CONTENT_ANALYZER_IDS.length; i++) {
    const analyzer = REGEX_ANALYZERS[1 + i];
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
  const ext = extFromFilePath(filePath);
  const commentStrippedSource = JS_SOURCE_EXTS.has(ext) ? stripJsComments(content, {
    jsx: ext === '.js' || ext === '.jsx' || ext === '.tsx',
  }) : blankCommentsForMatchers(content, ext);
  const source = stripCssInJsComments(commentStrippedSource, ext);
  const lines = source.split('\n');

  // Run regex matchers on the full file content (catches Tailwind classes, inline styles)
  // Enable block context for CSS files where related properties span multiple lines
  findings.push(...runRegexMatchers(lines, filePath, 0, STYLESHEET_EXTS.has(ext) || null, {
    profile,
    phase: 'source',
  }));
  // Pseudo-element stripes (::before/::after absolute bars) carry the same
  // side-tab silhouette without any border token, so the line matchers can't
  // see them (issue #394). The shared scanner already runs on full HTML pages
  // via checkHtmlPatterns; give standalone stylesheets, component style
  // blocks, and CSS-in-JS templates the same coverage. Each hit carries the
  // rule's source offset, so the finding gets a real line and line-scoped
  // inline ignores keep working.
  const pseudoStripeFindings = (text, lineOffset) =>
    scanCssTextForPseudoStripe(text).map(hit =>
      finding(hit.id, filePath, hit.snippet, lineOffset + text.slice(0, hit.index).split('\n').length));

  if (STYLESHEET_EXTS.has(ext)) {
    findings.push(...scanInsetStripeCss(content, filePath));
    findings.push(...pseudoStripeFindings(content, 0));
  }

  // Block-level CSS checks that need multiple declarations must run over the
  // complete source, not line-by-line. This covers standalone stylesheets,
  // component style blocks, inline styles, and CSS-in-JS templates.
  findings.push(...profileFindings(profile, {
    engine: 'regex',
    phase: 'source',
    ruleId: 'codex-grid-background',
    target: filePath,
  }, () => scanCssTextForGridBackground(source).map(hit => {
    const line = source.substring(0, hit.index).split('\n').length;
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
    const blockContent = blankCssLineComments(stripCssComments(block.content));
    const blockLines = blockContent.split('\n');
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
    findings.push(...scanInsetStripeCss(blockContent, filePath, block.startLine - 2));
    findings.push(...pseudoStripeFindings(blockContent, block.startLine - 2));
  }

  // Extract and scan CSS-in-JS template literals
  const cssJsBlocks = profile
    ? profileStep(profile, {
      engine: 'regex',
      phase: 'extract',
      ruleId: 'css-in-js',
      target: filePath,
    }, () => extractCSSinJS(source, ext))
    : extractCSSinJS(source, ext);
  for (const block of cssJsBlocks) {
    const blockContent = stripCssComments(block.content);
    const blockLines = blockContent.split('\n');
    findings.push(...runRegexMatchers(blockLines, filePath, block.startLine - 1, true, {
      profile,
      phase: 'css-in-js',
    }));
    findings.push(...scanInsetStripeCss(blockContent, filePath, block.startLine - 1));
    findings.push(...pseudoStripeFindings(blockContent, block.startLine - 1));
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
