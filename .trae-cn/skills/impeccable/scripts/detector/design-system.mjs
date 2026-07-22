import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { finding } from './findings.mjs';
import { GENERIC_FONTS } from './shared/constants.mjs';
import { parseAnyColor, resolveLengthPx } from './rules/checks.mjs';

const DESIGN_NAMES = ['DESIGN.md', 'Design.md', 'design.md'];
const FALLBACK_DIRS = ['.agents/context', 'docs'];
// Files/dirs whose presence marks a directory as a project root. Mirrors the
// walk-up semantics of skill/scripts/context.mjs (`resolveProject`), which the
// CLI can't import (separate tree). `.git` and `package.json` are the common
// boundaries; `.impeccable` is our own project marker.
const PROJECT_ROOT_MARKERS = ['.git', 'package.json', '.impeccable'];
const COLOR_CHANNEL_TOLERANCE = 6;
const RADIUS_TOLERANCE_PX = 0.5;
const FONT_SIZE_TOLERANCE_PX = 0.5;
const FONT_SIZE_LITERAL_RE = /^-?[\d.]+(?:px|rem)$/;

const CSS_COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|oklch\([^)]+\)|hsla?\([^)]+\)/gi;
const FONT_DECL_RE = /font-family\s*:\s*([^;}\n]+)/gi;
const FONT_JS_RE = /fontFamily\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
const GOOGLE_FONT_RE = /fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi;
const BORDER_RADIUS_RE = /border-radius\s*:\s*([^;}\n]+)/gi;
const BORDER_RADIUS_JS_RE = /borderRadius\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
const FONT_SIZE_DECL_RE = /font-size\s*:\s*([^;}\n]+)/gi;
const FONT_SIZE_JS_RE = /fontSize\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
const TAILWIND_FONT_SIZE_RE = /\btext-\[(-?[\d.]+(?:px|rem))\]/g;
const STATIC_DESIGN_SKIP_TAGS = new Set(['head', 'title', 'meta', 'link', 'style', 'script', 'noscript', 'template', 'source']);

function firstExisting(dir, names) {
  for (const name of names) {
    const abs = path.join(dir, name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function resolveDesignMdPath(cwd = process.cwd()) {
  const root = firstExisting(cwd, DESIGN_NAMES);
  if (root) return { path: root, contextDir: cwd };

  for (const rel of FALLBACK_DIRS) {
    const dir = path.resolve(cwd, rel);
    const found = firstExisting(dir, DESIGN_NAMES);
    if (found) return { path: found, contextDir: dir };
  }

  return null;
}

function resolveDesignSidecarPath(cwd = process.cwd(), contextDir = cwd) {
  const candidates = [
    path.join(cwd, '.impeccable', 'design.json'),
    path.join(cwd, 'DESIGN.json'),
    path.join(contextDir, 'DESIGN.json'),
  ];
  return candidates.find((candidate, index) =>
    candidates.indexOf(candidate) === index && fs.existsSync(candidate)
  ) || null;
}

function parseFrontmatter(md) {
  const lines = String(md || '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return null;
  try {
    return parseYamlSubset(lines.slice(1, end).join('\n'));
  } catch {
    return null;
  }
}

function parseYamlSubset(yaml) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const raw of String(yaml || '').split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const content = raw.slice(indent);
    const colonIdx = findTopLevelColon(content);
    if (colonIdx === -1) continue;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();

    const key = unquoteYamlKey(content.slice(0, colonIdx).trim());
    const rest = stripInlineYamlComment(content.slice(colonIdx + 1).trim());
    const parent = stack[stack.length - 1].obj;

    if (rest === '') {
      const obj = {};
      parent[key] = obj;
      stack.push({ indent, obj });
    } else {
      parent[key] = parseScalar(rest);
    }
  }

  return root;
}

function findTopLevelColon(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote && s[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ':') {
      return i;
    }
  }
  return -1;
}

function unquoteYamlKey(key) {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

function stripInlineYamlComment(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote && s[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#' && i > 0 && /\s/.test(s[i - 1])) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

function parseScalar(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

function safeReadJson(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeFontName(value) {
  return String(value || '')
    .trim()
    .replace(/\s*!important\s*$/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function splitFontStack(stack) {
  return String(stack || '')
    .replace(/\s*!important\s*$/i, '')
    .split(',')
    .map(normalizeFontName)
    .filter(Boolean);
}

function primaryFont(stack) {
  if (!stack || /var\(/i.test(stack) || !isLiteralFontStack(stack)) return '';
  return splitFontStack(stack).find(font => !GENERIC_FONTS.has(font)) || '';
}

function isLiteralFontStack(stack) {
  const text = String(stack || '');
  return !/[$`{}]|\s\+\s|\|\|/.test(text);
}

function cssColorLabel(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function colorKey(color) {
  if (!color) return '';
  return `${color.r},${color.g},${color.b}`;
}

function colorsClose(a, b) {
  if (!a || !b) return false;
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
  ) <= COLOR_CHANNEL_TOLERANCE;
}

function hslToRgb(H, S, L, alpha = 1) {
  const h = (((H % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, S));
  const l = Math.max(0, Math.min(1, L));
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    a: alpha,
  };
}

function parseDesignColor(value) {
  const text = String(value || '').trim();
  const parsed = parseAnyColor(text);
  if (parsed) return parsed;
  const hsl = text.match(/hsla?\(\s*([-\d.]+)(?:deg)?\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  if (hsl) {
    return hslToRgb(
      parseFloat(hsl[1]),
      parseFloat(hsl[2]) / 100,
      parseFloat(hsl[3]) / 100,
      hsl[4] !== undefined ? parseFloat(hsl[4]) : 1,
    );
  }
  return null;
}

function addDesignColor(out, value, label) {
  const parsed = parseDesignColor(value);
  if (!parsed) return;
  const key = colorKey(parsed);
  if (!out.allowedColorKeys.has(key)) {
    out.allowedColorKeys.set(key, { color: parsed, labels: [] });
  }
  out.allowedColorKeys.get(key).labels.push(label || cssColorLabel(value));
}

function addColorObject(out, colors, prefix = 'colors') {
  if (!colors || typeof colors !== 'object') return;
  for (const [name, value] of Object.entries(colors)) {
    if (typeof value === 'string') {
      addDesignColor(out, value, `${prefix}.${name}`);
    }
  }
}

function addSidecarColors(out, sidecar) {
  const colorMeta = sidecar?.extensions?.colorMeta;
  if (!colorMeta || typeof colorMeta !== 'object') return;

  for (const [name, meta] of Object.entries(colorMeta)) {
    if (!meta || typeof meta !== 'object') continue;
    if (typeof meta.canonical === 'string') addDesignColor(out, meta.canonical, `sidecar.${name}`);
    if (Array.isArray(meta.tonalRamp)) {
      for (const [index, value] of meta.tonalRamp.entries()) {
        if (typeof value === 'string') addDesignColor(out, value, `sidecar.${name}.tonalRamp[${index}]`);
      }
    }
  }
}

function addTypographyFonts(out, typography) {
  if (!typography || typeof typography !== 'object') return;
  for (const role of Object.values(typography)) {
    if (!role || typeof role !== 'object') continue;
    if (typeof role.fontFamily !== 'string') continue;
    for (const font of splitFontStack(role.fontFamily)) {
      if (!GENERIC_FONTS.has(font)) out.allowedFonts.add(font);
    }
  }
}

function addFontSizeStep(out, raw, { fluid = false } = {}) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!FONT_SIZE_LITERAL_RE.test(text)) return;
  const px = resolveLengthPx(text, 16);
  if (px == null || !Number.isFinite(px) || px <= 0) return;
  out.allowedFontSizes.push({ value: text, px, fluid });
}

// Split a fluid value into its three terms, or null when it is not a
// well-formed clamp(). Used both to read DESIGN.md's fluid roles and to
// validate fluid values in source, so the two stay symmetric.
function parseClampArgs(raw) {
  const match = /^clamp\(\s*([\s\S]+)\s*\)$/i.exec(String(raw ?? '').trim());
  if (!match) return null;
  const args = splitTopLevelArgs(match[1]);
  return args.length === 3 ? args : null;
}

// A fluid role declares its two fixed endpoints and interpolates between them
// with a viewport unit. Both endpoints are documented sizes, so they belong in
// the allowlist; the middle term is viewport-relative and never a fixed step.
// Endpoints are marked `fluid` because they do not *enumerate* a ramp: see
// `hasFontSizes` below for why that distinction has to survive.
function addClampEndpoints(out, raw) {
  const args = parseClampArgs(raw);
  if (!args) return false;
  addFontSizeStep(out, args[0], { fluid: true });
  addFontSizeStep(out, args[2], { fluid: true });
  return true;
}

function splitTopLevelArgs(s) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function addTypographySizes(out, typography) {
  if (!typography || typeof typography !== 'object') return;

  // `scale` is the enumerated ramp: a name -> size map, since the frontmatter
  // parser has no list support. It sits alongside the named roles.
  const scale = typography.scale;
  if (scale && typeof scale === 'object') {
    for (const value of Object.values(scale)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      addFontSizeStep(out, value);
    }
  }

  for (const [name, role] of Object.entries(typography)) {
    if (name === 'scale') continue;
    if (!role || typeof role !== 'object') continue;
    const raw = String(role.fontSize ?? '').trim().toLowerCase();
    if (addClampEndpoints(out, raw)) continue;
    addFontSizeStep(out, raw);
  }
}

function addRoundedScale(out, rounded) {
  if (!rounded || typeof rounded !== 'object') return;
  for (const [rawName, value] of Object.entries(rounded)) {
    const name = unquoteYamlKey(rawName).toLowerCase();
    addRoundedToken(out, name, value);
  }
}

function addRoundedToken(out, name, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const raw = String(value).trim();
  if (!raw || /var\(/i.test(raw) || raw.includes('%')) return;
  const px = resolveLengthPx(raw, 16);
  if (px == null || !Number.isFinite(px)) return;
  out.allowedRadii.push({ name, value: raw, px });
  if (/(^|\.)(full|pill|round|rounded-full)$/.test(name)) out.hasPillRadius = true;
}

function addSidecarRadii(out, sidecar) {
  const roundedMeta = sidecar?.extensions?.roundedMeta;
  if (!roundedMeta || typeof roundedMeta !== 'object') return;

  for (const [rawName, meta] of Object.entries(roundedMeta)) {
    const name = unquoteYamlKey(rawName).toLowerCase();
    if (typeof meta === 'string' || typeof meta === 'number') {
      addRoundedToken(out, `sidecar.${name}`, meta);
      continue;
    }
    if (!meta || typeof meta !== 'object') continue;
    for (const key of ['canonical', 'value']) {
      if (typeof meta[key] === 'string' || typeof meta[key] === 'number') {
        addRoundedToken(out, `sidecar.${name}.${key}`, meta[key]);
      }
    }
    for (const key of ['values', 'aliases']) {
      if (!Array.isArray(meta[key])) continue;
      for (const [index, value] of meta[key].entries()) {
        addRoundedToken(out, `sidecar.${name}.${key}[${index}]`, value);
      }
    }
    if (/^(full|pill|round|rounded-full)$/.test(name) || /^(full|pill|round)$/i.test(String(meta.role || ''))) {
      out.hasPillRadius = true;
    }
  }
}

function normalizeDesignSystem(input = {}) {
  const frontmatter = input.frontmatter || {};
  const sidecar = input.sidecar || null;
  const out = {
    present: true,
    sourcePath: input.sourcePath || null,
    sidecarPath: input.sidecarPath || null,
    mdNewerThanJson: input.mdNewerThanJson === true,
    allowedFonts: new Set(),
    allowedColorKeys: new Map(),
    allowedRadii: [],
    allowedFontSizes: [],
    hasPillRadius: false,
  };

  addTypographyFonts(out, frontmatter.typography);
  addTypographySizes(out, frontmatter.typography);
  addColorObject(out, frontmatter.colors);
  addSidecarColors(out, sidecar);
  addRoundedScale(out, frontmatter.rounded);
  addSidecarRadii(out, sidecar);

  out.hasFonts = out.allowedFonts.size > 0;
  out.hasColors = out.allowedColorKeys.size > 0;
  out.hasRadii = out.allowedRadii.length > 0;
  // Gate on *enumerated* steps only. A fully fluid system declares clamp
  // endpoints but no discrete ramp, so treating those endpoints as the whole
  // allowlist would flag every intermediate size. Abstain instead.
  out.hasFontSizes = out.allowedFontSizes.some(entry => !entry.fluid);
  return out;
}

function loadDesignSystemForCwd(cwd = process.cwd()) {
  const md = resolveDesignMdPath(cwd);
  if (!md) return null;

  let frontmatter = null;
  let mdStat = null;
  try {
    mdStat = fs.statSync(md.path);
    frontmatter = parseFrontmatter(fs.readFileSync(md.path, 'utf-8'));
  } catch {
    return null;
  }
  if (!frontmatter || typeof frontmatter !== 'object') return null;

  const sidecarPath = resolveDesignSidecarPath(cwd, md.contextDir);
  const sidecar = safeReadJson(sidecarPath);
  let sidecarStat = null;
  try {
    if (sidecarPath) sidecarStat = fs.statSync(sidecarPath);
  } catch {
    sidecarStat = null;
  }

  return normalizeDesignSystem({
    frontmatter,
    sidecar,
    sourcePath: md.path,
    sidecarPath,
    mdNewerThanJson: !!(mdStat && sidecarStat && mdStat.mtimeMs > sidecarStat.mtimeMs + 1000),
  });
}

// Directory to begin the project-root walk from, given a scan target that may
// be a file or a directory (and may not exist yet).
function designSystemStartDir(targetPath, cwd = process.cwd()) {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  try {
    return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch {
    // Nonexistent path: treat an extension-bearing leaf as a file.
    return path.extname(abs) ? path.dirname(abs) : abs;
  }
}

// Walk up from `startDir` to the directory that governs the target's design
// system, mirroring skill/scripts/context.mjs's project-boundary semantics:
//
//   - A directory carrying a DESIGN.md (directly or in a fallback dir) IS the
//     design root — that's where the rules live.
//   - A directory carrying a project marker (.git / package.json / .impeccable)
//     but no DESIGN.md is a project BOUNDARY: the walk stops with no design
//     system, so a sibling project never inherits a parent's or cwd's rules.
//   - Reaching the home directory / filesystem root with neither means no
//     design system at all — never process.cwd()'s.
//
// Returns { dir, hasDesign } for the stopping directory, or null when the walk
// runs out. This is the fix for cross-project contamination.
export function findDesignRoot(startDir) {
  let dir = path.resolve(startDir);
  const homeDir = path.resolve(os.homedir());
  while (true) {
    if (resolveDesignMdPath(dir)) return { dir, hasDesign: true };
    if (PROJECT_ROOT_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)))) {
      return { dir, hasDesign: false };
    }
    if (dir === homeDir) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Resolve the design system that governs a specific scan target, by walking up
// from the target's own location — never process.cwd(). Scanning project B's
// files from inside project A applies B's DESIGN.md (or none), not A's.
//
// Pass a `cache` Map to memoize by resolved design root across a multi-file
// scan; a target with no design root above it resolves to null.
export function loadDesignSystemForTarget(targetPath, { cache, cwd = process.cwd() } = {}) {
  const startDir = designSystemStartDir(targetPath, cwd);
  const found = findDesignRoot(startDir);
  const key = found ? `root:${found.dir}` : '\0none';
  if (cache && cache.has(key)) return cache.get(key);
  const loaded = found?.hasDesign ? loadDesignSystemForCwd(found.dir) : null;
  if (cache) cache.set(key, loaded);
  return loaded;
}

function isAllowedFont(font, designSystem) {
  if (!font || GENERIC_FONTS.has(font)) return true;
  if (!designSystem?.hasFonts) return true;
  return designSystem.allowedFonts.has(font);
}

function isAllowedColorRaw(raw, designSystem) {
  if (!designSystem?.hasColors) return true;
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'transparent' || text === 'currentcolor' || text === 'inherit' || text === 'initial') return true;
  if (text.includes('var(')) return true;
  const parsed = parseDesignColor(text);
  if (!parsed) return true;
  if ((parsed.a ?? 1) <= 0.05) return true;
  for (const entry of designSystem.allowedColorKeys.values()) {
    if (colorsClose(parsed, entry.color)) return true;
  }
  return false;
}

function isAllowedRadiusRaw(raw, designSystem) {
  if (!designSystem?.hasRadii) return true;
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === '0' || text === 'none' || text === 'initial' || text === 'inherit') return true;
  if (text.includes('var(') || text.includes('%')) return true;
  const px = resolveLengthPx(text, 16);
  if (px == null || !Number.isFinite(px) || px <= RADIUS_TOLERANCE_PX) return true;
  if (designSystem.hasPillRadius && px >= 99) return true;
  return designSystem.allowedRadii.some(entry => Math.abs(entry.px - px) <= RADIUS_TOLERANCE_PX);
}

// One term of a font-size value. `unjudgeable` covers var(), calc(), percentages
// and units the ramp cannot resolve (em is parent-relative, not root-relative);
// those abstain rather than guess.
function fontSizeStepStatus(raw, designSystem) {
  const text = String(raw || '').trim().toLowerCase();
  if (!FONT_SIZE_LITERAL_RE.test(text)) return 'unjudgeable';
  const px = resolveLengthPx(text, 16);
  if (px == null || !Number.isFinite(px) || px <= 0) return 'unjudgeable';
  return designSystem.allowedFontSizes.some(
    entry => Math.abs(entry.px - px) <= FONT_SIZE_TOLERANCE_PX,
  ) ? 'on-ramp' : 'off-ramp';
}

// The off-ramp endpoints of a fluid value, or null when `raw` is not a fluid
// value at all. Only the min and max are judged: the viewport term interpolates
// between them and is never a fixed step.
//
// Reading clamp endpoints as documented steps without also checking them in
// usage would let `clamp(99rem, 1vw, 200rem)` through, which is how a fluid
// declaration stayed invisible until someone measured computed styles.
export function offRampClampEndpoints(raw, designSystem) {
  if (!designSystem?.hasFontSizes) return null;
  const args = parseClampArgs(String(raw || '').trim().replace(/\s*!important\s*$/i, ''));
  if (!args) return null;
  return [args[0], args[2]].filter(
    endpoint => fontSizeStepStatus(endpoint, designSystem) === 'off-ramp',
  );
}

function isAllowedFontSizeRaw(raw, designSystem) {
  if (!designSystem?.hasFontSizes) return true;
  const text = String(raw || '').trim().toLowerCase().replace(/\s*!important\s*$/, '');
  const offRampEndpoints = offRampClampEndpoints(text, designSystem);
  if (offRampEndpoints) return offRampEndpoints.length === 0;
  return fontSizeStepStatus(text, designSystem) !== 'off-ramp';
}

function lineLooksCommented(line) {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('<!--');
}

function isProbablyColorLiteral(line, match) {
  const raw = match?.[0] || '';
  const index = match.index ?? -1;
  if (index < 0) return false;
  if (isInsideCssAttributeSelector(line, index)) return false;

  const before = line.slice(0, index);
  const after = line.slice(index + raw.length);

  if (raw.startsWith('#')) {
    if (before.endsWith('&')) return false; // HTML numeric entity, e.g. &#8596;

    const prevNonSpace = before.match(/\S(?=\s*$)/)?.[0] || '';
    const nextNonSpace = after.match(/^\s*(\S)/)?.[1] || '';
    if (prevNonSpace === '>' && nextNonSpace === '<') return false; // plain text, e.g. PR #155
  }

  const styleContext = /(?:^|[{\s;"'`(,])(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke)\s*:\s*[^;{}"'`]*/i.test(before);
  const cssFunctionContext = /(?:linear-gradient|radial-gradient|conic-gradient|color-mix)\([^)]*$/i.test(before);
  const jsColorKeyContext = /(?:^|[,{]\s*)(?:color|background|backgroundColor|borderColor|outlineColor|fill|stroke|boxShadow|textShadow)\s*[:=]\s*["'`]?[^"'`,}]*/i.test(before);

  return styleContext || cssFunctionContext || jsColorKeyContext;
}

function isInsideCssAttributeSelector(line, index) {
  if (index < 0) return false;
  const before = line.slice(0, index);
  const lastOpen = before.lastIndexOf('[');
  if (lastOpen === -1) return false;
  const lastClose = before.lastIndexOf(']');
  if (lastClose > lastOpen) return false;
  const after = line.slice(index);
  const close = after.indexOf(']');
  const block = after.indexOf('{');
  return close !== -1 && (block === -1 || close < block);
}

function makeDesignFinding(id, filePath, snippet, line = 0, extras = {}) {
  return { ...finding(id, filePath, snippet, line), ...extras };
}

function decodeGoogleFamily(value) {
  const family = String(value || '').split(':')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(family);
  } catch {
    return family;
  }
}

function checkFontStack(stack, filePath, line, designSystem, context) {
  const primary = primaryFont(stack);
  if (!primary || isAllowedFont(primary, designSystem)) return [];
  const display = primary.replace(/\b\w/g, ch => ch.toUpperCase());
  return [makeDesignFinding(
    'design-system-font',
    filePath,
    `${context}: ${display} is not declared in DESIGN.md typography`,
    line,
    { ignoreValue: display },
  )];
}

function extractRadiusTokens(value) {
  return String(value || '')
    .replace(/\s*\/\s*/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function checkRadiusValue(value, filePath, line, designSystem, context) {
  const findings = [];
  for (const token of extractRadiusTokens(value)) {
    if (isAllowedRadiusRaw(token, designSystem)) continue;
    findings.push(makeDesignFinding(
      'design-system-radius',
      filePath,
      `${context}: ${token} is outside the DESIGN.md rounded scale`,
      line,
      { ignoreValue: token },
    ));
  }
  return findings;
}

function checkFontSizeValue(value, filePath, line, designSystem, context) {
  const token = String(value || '').trim();
  if (isAllowedFontSizeRaw(token, designSystem)) return [];

  // Name the offending endpoint on a fluid value; the whole clamp() string is
  // not actionable on its own, and it makes a poor ignore-value.
  const offRampEndpoints = offRampClampEndpoints(token, designSystem) || [];
  if (offRampEndpoints.length > 0) {
    const plural = offRampEndpoints.length > 1 ? 's' : '';
    return [makeDesignFinding(
      'design-system-font-size',
      filePath,
      `${context}: ${token} has fluid endpoint${plural} ${offRampEndpoints.join(' and ')} off the DESIGN.md type ramp`,
      line,
      { ignoreValue: offRampEndpoints[0] },
    )];
  }

  // The snippet shows the declaration as authored, but the ignoreValue has to
  // be what a `hooks ignore-value` waiver can match, so the priority marker is
  // stripped. Otherwise the same size needs two different waivers depending on
  // whether it carries !important. font-family already behaves this way.
  return [makeDesignFinding(
    'design-system-font-size',
    filePath,
    `${context}: ${token} is off the DESIGN.md type ramp`,
    line,
    { ignoreValue: token.replace(/\s*!important\s*$/i, '').trim() },
  )];
}

function checkSourceDesignSystem(content, filePath, options = {}) {
  const designSystem = options.designSystem;
  if (!designSystem?.present) return [];

  const findings = [];
  const lines = String(content || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (lineLooksCommented(line)) continue;

    if (designSystem.hasFonts) {
      for (const match of line.matchAll(FONT_DECL_RE)) {
        findings.push(...checkFontStack(match[1], filePath, lineNum, designSystem, 'font-family'));
      }
      for (const match of line.matchAll(FONT_JS_RE)) {
        findings.push(...checkFontStack(match[1], filePath, lineNum, designSystem, 'fontFamily'));
      }
      for (const match of line.matchAll(GOOGLE_FONT_RE)) {
        const url = match[0];
        for (const familyMatch of url.matchAll(/[?&]family=([^&]+)/g)) {
          const font = normalizeFontName(decodeGoogleFamily(familyMatch[1]));
          if (!font || isAllowedFont(font, designSystem)) continue;
          const display = decodeGoogleFamily(familyMatch[1]);
          findings.push(makeDesignFinding(
            'design-system-font',
            filePath,
            `Google Fonts: ${display} is not declared in DESIGN.md typography`,
            lineNum,
            { ignoreValue: display },
          ));
        }
      }
    }

    if (designSystem.hasColors) {
      for (const match of line.matchAll(CSS_COLOR_RE)) {
        if (!isProbablyColorLiteral(line, match)) continue;
        const raw = cssColorLabel(match[0]);
        if (isAllowedColorRaw(raw, designSystem)) continue;
        findings.push(makeDesignFinding(
          'design-system-color',
          filePath,
          `Undocumented color ${raw} is outside DESIGN.md colors`,
          lineNum,
          { ignoreValue: raw },
        ));
      }
    }

    if (designSystem.hasRadii) {
      for (const match of line.matchAll(BORDER_RADIUS_RE)) {
        findings.push(...checkRadiusValue(match[1], filePath, lineNum, designSystem, 'border-radius'));
      }
      for (const match of line.matchAll(BORDER_RADIUS_JS_RE)) {
        findings.push(...checkRadiusValue(match[1], filePath, lineNum, designSystem, 'borderRadius'));
      }
    }

    if (designSystem.hasFontSizes) {
      for (const match of line.matchAll(FONT_SIZE_DECL_RE)) {
        findings.push(...checkFontSizeValue(match[1], filePath, lineNum, designSystem, 'font-size'));
      }
      for (const match of line.matchAll(FONT_SIZE_JS_RE)) {
        findings.push(...checkFontSizeValue(match[1], filePath, lineNum, designSystem, 'fontSize'));
      }
      for (const match of line.matchAll(TAILWIND_FONT_SIZE_RE)) {
        findings.push(...checkFontSizeValue(match[1], filePath, lineNum, designSystem, 'text-[…] class'));
      }
    }
  }

  return dedupeDesignFindings(findings);
}

function hasDirectText(el) {
  return Array.from(el.childNodes || []).some(node => node.nodeType === 3 && node.textContent.trim().length > 0);
}

function sampleText(el) {
  const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
  return text ? ` "${text.slice(0, 40)}"` : '';
}

// Font-size design-system checks are source-scan-only (see checkSourceDesignSystem).
// Computed font-size cascades and clamp() ramps resolve to off-ramp px in the browser.
function collectStaticDesignSystemFindings(document, window, filePath, designSystem) {
  if (!designSystem?.present) return [];
  const findings = [];
  const seenFonts = new Set();
  const seenColors = new Set();
  const seenRadii = new Set();

  for (const el of document.querySelectorAll('*')) {
    if (shouldSkipStaticDesignElement(el, window)) continue;
    const tag = el.tagName?.toLowerCase?.() || 'unknown';
    const style = window.getComputedStyle(el);

    if (designSystem.hasFonts && hasDirectText(el)) {
      const font = primaryFont(style.fontFamily || '');
      if (font && !seenFonts.has(font) && !isAllowedFont(font, designSystem)) {
        seenFonts.add(font);
        findings.push(makeDesignFinding(
          'design-system-font',
          filePath,
          `${tag}${sampleText(el)} uses ${font}; not declared in DESIGN.md typography`,
          0,
          { ignoreValue: font },
        ));
      }
    }

    if (designSystem.hasColors) {
      const colorChecks = [];
      if (hasDirectText(el)) colorChecks.push(['text color', style.color]);
      if (!isTransparentCss(style.backgroundColor)) colorChecks.push(['background', style.backgroundColor]);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if ((parseFloat(style[`border${side}Width`]) || 0) > 0) {
          colorChecks.push([`border-${side.toLowerCase()}`, style[`border${side}Color`]]);
        }
      }
      if ((parseFloat(style.outlineWidth) || 0) > 0) colorChecks.push(['outline', style.outlineColor]);

      for (const [kind, raw] of colorChecks) {
        const label = cssColorLabel(raw);
        if (isAllowedColorRaw(label, designSystem)) continue;
        const key = `${kind}:${label}`;
        if (seenColors.has(key)) continue;
        seenColors.add(key);
        findings.push(makeDesignFinding(
          'design-system-color',
          filePath,
          `${kind} ${label} on ${tag}${sampleText(el)} is outside DESIGN.md colors`,
          0,
          { ignoreValue: label },
        ));
      }
    }

    if (designSystem.hasRadii) {
      const rawRadius = String(style.borderRadius || '').trim();
      if (!rawRadius) continue;
      for (const token of extractRadiusTokens(rawRadius)) {
        if (isAllowedRadiusRaw(token, designSystem)) continue;
        if (seenRadii.has(token)) continue;
        seenRadii.add(token);
        findings.push(makeDesignFinding(
          'design-system-radius',
          filePath,
          `border-radius ${token} on ${tag}${sampleText(el)} is outside the DESIGN.md rounded scale`,
          0,
          { ignoreValue: token },
        ));
      }
    }
  }

  return findings;
}

function shouldSkipStaticDesignElement(el, window) {
  const tag = el.tagName?.toLowerCase?.() || '';
  if (STATIC_DESIGN_SKIP_TAGS.has(tag)) return true;

  let current = el;
  while (current) {
    if (current.getAttribute?.('hidden') !== null || current.getAttribute?.('aria-hidden') === 'true') return true;
    const style = window.getComputedStyle(current);
    const display = String(style.display || '').toLowerCase();
    const visibility = String(style.visibility || '').toLowerCase();
    if (display === 'none' || visibility === 'hidden' || visibility === 'collapse') return true;
    current = current.parentElement;
  }
  return false;
}

function isTransparentCss(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'transparent') return true;
  const parsed = parseDesignColor(text);
  return parsed ? (parsed.a ?? 1) <= 0.05 : false;
}

function canonicalDesignFindingKey(item) {
  if (!item?.antipattern?.startsWith?.('design-system-')) return null;
  const value = item.ignoreValue || item.value || '';
  if (item.antipattern === 'design-system-font') {
    const context = /google fonts/i.test(item.snippet || '') ? 'google-font' : 'font';
    const font = normalizeFontName(value);
    return font ? `${item.antipattern}:${context}:${font}` : null;
  }
  if (item.antipattern === 'design-system-color') {
    const parsed = parseDesignColor(value);
    if (parsed) return `${item.antipattern}:color:${colorKey(parsed)}`;
    const label = cssColorLabel(value).toLowerCase();
    return label ? `${item.antipattern}:color:${label}` : null;
  }
  if (item.antipattern === 'design-system-radius') {
    const px = resolveLengthPx(String(value || '').trim(), 16);
    if (px != null && Number.isFinite(px)) return `${item.antipattern}:radius:${Math.round(px * 100) / 100}`;
    const label = String(value || '').trim().toLowerCase();
    return label ? `${item.antipattern}:radius:${label}` : null;
  }
  if (item.antipattern === 'design-system-font-size') {
    const px = resolveLengthPx(String(value || '').trim(), 16);
    if (px != null && Number.isFinite(px)) return `${item.antipattern}:font-size:${Math.round(px * 100) / 100}`;
    const label = String(value || '').trim().toLowerCase();
    return label ? `${item.antipattern}:font-size:${label}` : null;
  }
  return null;
}

function mergeDesignSystemFindings(...groups) {
  const out = [];
  const seen = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const key = canonicalDesignFindingKey(item);
      if (key) {
        if (seen.has(key)) {
          const existing = out[seen.get(key)];
          if ((existing.line || 0) <= 0 && (item.line || 0) > 0) existing.line = item.line;
          continue;
        }
        seen.set(key, out.length);
      }
      out.push(item);
    }
  }
  return out;
}

function dedupeDesignFindings(findings) {
  const out = [];
  const seen = new Set();
  for (const item of findings) {
    const key = [
      item.antipattern,
      item.line || 0,
      normalizeFontName(item.ignoreValue || item.snippet || ''),
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export {
  parseFrontmatter,
  normalizeDesignSystem,
  loadDesignSystemForCwd,
  isAllowedFont,
  isAllowedColorRaw,
  isAllowedRadiusRaw,
  isAllowedFontSizeRaw,
  checkSourceDesignSystem,
  collectStaticDesignSystemFindings,
  mergeDesignSystemFindings,
};
