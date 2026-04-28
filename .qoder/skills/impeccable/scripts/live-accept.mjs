/**
 * CLI helper: deterministic accept/discard of variant sessions.
 *
 * Usage:
 *   node live-accept.mjs --id SESSION_ID --discard
 *   node live-accept.mjs --id SESSION_ID --variant N
 *
 * For discard: removes the entire variant wrapper and restores the original.
 * For accept: replaces the wrapper with the chosen variant's content. If the
 * session had a colocated <style> block, it's preserved with carbonize markers
 * for a background agent to integrate into the project's CSS.
 *
 * Output: JSON to stdout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isGeneratedFile } from './is-generated.mjs';

const EXTENSIONS = ['.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro'];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function acceptCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node live-accept.mjs [options]

Deterministic accept/discard for live variant sessions.

Modes:
  --discard          Remove variants, restore original
  --variant N        Accept variant N, discard the rest

Required:
  --id SESSION_ID    Session ID of the variant wrapper

Output (JSON):
  { handled, file, carbonize }`);
    process.exit(0);
  }

  const id = argVal(args, '--id');
  const variantNum = argVal(args, '--variant');
  const paramValuesRaw = argVal(args, '--param-values');
  const isDiscard = args.includes('--discard');

  if (!id) { console.error('Missing --id'); process.exit(1); }
  if (!isDiscard && !variantNum) { console.error('Need --discard or --variant N'); process.exit(1); }

  let paramValues = null;
  if (paramValuesRaw) {
    try { paramValues = JSON.parse(paramValuesRaw); }
    catch { paramValues = null; } // malformed blob: skip the comment rather than failing the accept
  }

  // Find the file containing this session's markers
  const found = findSessionFile(id, process.cwd());
  if (!found) {
    console.log(JSON.stringify({ handled: false, error: 'Session markers not found for id: ' + id }));
    process.exit(0);
  }

  const { file: targetFile, content, lines } = found;
  const relFile = path.relative(process.cwd(), targetFile);

  // Bail if the session lives in a generated file. The agent manually wrote
  // the wrapper there for preview, and is responsible for writing the
  // accepted variant to true source (or cleaning up on discard). See
  // "Handle fallback" in live.md.
  if (isGeneratedFile(targetFile, { cwd: process.cwd() })) {
    console.log(JSON.stringify({
      handled: false,
      mode: 'fallback',
      file: relFile,
      hint: 'Session is in a generated file. Persist the accepted variant in source; do not rely on this script.',
    }));
    process.exit(0);
  }

  if (isDiscard) {
    const result = handleDiscard(id, lines, targetFile);
    console.log(JSON.stringify({ handled: true, file: relFile, carbonize: false, ...result }));
  } else {
    const result = handleAccept(id, variantNum, lines, targetFile, paramValues);
    // Single-line attention-grabber when cleanup is required. The full
    // five-step checklist lives in reference/live.md (loaded once per
    // session); repeating it per-event would waste tokens.
    if (result.carbonize) {
      result.todo = 'REQUIRED before next poll: carbonize cleanup in ' + relFile + '. See reference/live.md "Required after accept".';
    }
    console.log(JSON.stringify({ handled: true, file: relFile, ...result }));
  }
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

function handleDiscard(id, lines, targetFile) {
  const block = findMarkerBlock(id, lines);
  if (!block) return { handled: false, error: 'Markers not found' };

  const original = extractOriginal(lines, block);
  const indent = lines[block.start].match(/^(\s*)/)[1];

  // De-indent the original content back to the marker's indentation level
  const restored = deindentContent(original, indent);

  const newLines = [
    ...lines.slice(0, block.start),
    ...restored,
    ...lines.slice(block.end + 1),
  ];
  fs.writeFileSync(targetFile, newLines.join('\n'), 'utf-8');
  return {};
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

function handleAccept(id, variantNum, lines, targetFile, paramValues) {
  const block = findMarkerBlock(id, lines);
  if (!block) return { handled: false, error: 'Markers not found' };

  const indent = lines[block.start].match(/^(\s*)/)[1];
  const commentSyntax = detectCommentSyntax(targetFile);

  // Extract the chosen variant's inner content
  const variantContent = extractVariant(lines, block, variantNum);
  if (!variantContent) return { handled: false, error: 'Variant ' + variantNum + ' not found' };

  // Extract CSS block if present
  const cssContent = extractCss(lines, block, id);

  // Check if carbonizing is needed:
  // - CSS block exists, OR
  // - variant HTML contains helper classes/attributes that need cleanup
  const variantText = variantContent.join('\n');
  const hasHelperAttrs = variantText.includes('data-impeccable-variant');
  const needsCarbonize = !!(cssContent || hasHelperAttrs);

  // Build the replacement
  const restored = deindentContent(variantContent, indent);
  const replacement = [];

  if (cssContent) {
    const isJsx = commentSyntax.open === '{/*';
    replacement.push(indent + commentSyntax.open + ' impeccable-carbonize-start ' + id + ' ' + commentSyntax.close);
    // JSX targets need the CSS body wrapped in a template literal so that the
    // `{` and `}` in CSS rules don't get parsed as JSX expressions.
    replacement.push(indent + '<style data-impeccable-css="' + id + '">' + (isJsx ? '{`' : ''));
    // Re-indent CSS content to match
    for (const cssLine of cssContent) {
      replacement.push(indent + cssLine.trimStart());
    }
    replacement.push(indent + (isJsx ? '`}</style>' : '</style>'));
    if (paramValues && Object.keys(paramValues).length > 0) {
      // Preserve the user's knob positions for the carbonize-cleanup agent
      // to bake into the final CSS when it collapses scoped rules.
      replacement.push(indent + commentSyntax.open + ' impeccable-param-values ' + id + ': ' + JSON.stringify(paramValues) + ' ' + commentSyntax.close);
    }
    replacement.push(indent + commentSyntax.open + ' impeccable-carbonize-end ' + id + ' ' + commentSyntax.close);
  }

  // Keep the `@scope ([data-impeccable-variant="N"])` selectors in the
  // carbonize CSS block working visually by re-wrapping the accepted content
  // in a data-impeccable-variant="N" div with `display: contents` (so layout
  // isn't affected). The carbonize agent strips this attribute + wrapper when
  // it moves the CSS to a proper stylesheet.
  //
  // Style attribute syntax has to follow the host file's flavor — JSX files
  // need the object form, otherwise React 19 throws "Failed to set indexed
  // property [0] on CSSStyleDeclaration" while parsing the string char-by-char.
  if (cssContent) {
    const isJsx = commentSyntax.open === '{/*';
    const styleAttr = isJsx ? "style={{ display: 'contents' }}" : 'style="display: contents"';
    replacement.push(indent + '<div data-impeccable-variant="' + variantNum + '" ' + styleAttr + '>');
    replacement.push(...restored);
    replacement.push(indent + '</div>');
  } else {
    replacement.push(...restored);
  }

  const newLines = [
    ...lines.slice(0, block.start),
    ...replacement,
    ...lines.slice(block.end + 1),
  ];
  fs.writeFileSync(targetFile, newLines.join('\n'), 'utf-8');

  return { carbonize: needsCarbonize };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Find the start/end marker lines for a session.
 * Returns { start, end } (0-indexed line numbers) or null.
 */
function findMarkerBlock(id, lines) {
  let start = -1;
  let end = -1;
  const startPattern = 'impeccable-variants-start ' + id;
  const endPattern = 'impeccable-variants-end ' + id;

  for (let i = 0; i < lines.length; i++) {
    if (start === -1 && lines[i].includes(startPattern)) start = i;
    if (lines[i].includes(endPattern)) { end = i; break; }
  }

  return (start !== -1 && end !== -1) ? { start, end } : null;
}

/**
 * Join wrapper lines into a single string with `<style>` elements removed so
 * marker matching and div-depth tracking aren't confused by:
 *   - CSS `@scope ([data-impeccable-variant="N"])` strings that look like the
 *     HTML marker we're searching for
 *   - JSX self-closing `<style ... />` (no separate `</style>` to close on)
 *   - Same-line `<style>…</style>` blocks
 *   - Multi-line `<style>\n…\n</style>` blocks
 */
function stripStyleAndJoin(lines, block) {
  const out = [];
  let inStyle = false;
  for (let i = block.start; i <= block.end; i++) {
    let line = lines[i];

    if (!inStyle) {
      // Strip any complete <style> elements on this line (self-closed or
      // same-line-closed), including their body content.
      line = line
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/g, '')
        .replace(/<style\b[^>]*\/\s*>/g, '');

      // If a <style> opener remains (multi-line body starts here), strip from
      // the opener to end-of-line and flip into skip mode.
      const openerIdx = line.search(/<style\b/);
      if (openerIdx !== -1) {
        line = line.slice(0, openerIdx);
        inStyle = true;
      }
      out.push(line);
    } else {
      // In multi-line style body; drop everything until we see </style>.
      const closeIdx = line.search(/<\/style\s*>/);
      if (closeIdx !== -1) {
        inStyle = false;
        out.push(line.slice(closeIdx).replace(/<\/style\s*>/, ''));
      }
      // else: skip line entirely
    }
  }
  return out.join('\n');
}

/**
 * Find the inner content of `<TAG ...attrMatch...>…</TAG>` inside `text`,
 * handling nested same-tag elements via depth counting. `attrMatch` is a
 * regex source fragment that must appear inside the opener tag.
 * Returns the inner string (may be empty), or null if not found.
 */
function extractInnerByAttr(text, attrMatch) {
  const openerRe = new RegExp('<([A-Za-z][A-Za-z0-9]*)\\b[^>]*' + attrMatch + '[^>]*>');
  const openMatch = text.match(openerRe);
  if (!openMatch) return null;

  const tagName = openMatch[1];
  const innerStart = openMatch.index + openMatch[0].length;

  // Match any opener or closer of this tag name after innerStart.
  // (Does not match self-closing <TAG … />, which doesn't contribute to depth.)
  const tagRe = new RegExp('<(?:/)?' + tagName + '\\b[^>]*>', 'g');
  tagRe.lastIndex = innerStart;

  let depth = 1;
  let m;
  while ((m = tagRe.exec(text))) {
    const isClose = m[0].startsWith('</');
    const isSelfClose = !isClose && /\/\s*>$/.test(m[0]);
    if (isClose) {
      depth--;
      if (depth === 0) return text.slice(innerStart, m.index);
    } else if (!isSelfClose) {
      depth++;
    }
  }
  return null;
}

/**
 * Extract the original element content from within the variant wrapper.
 * Returns an array of lines.
 */
function extractOriginal(lines, block) {
  const text = stripStyleAndJoin(lines, block);
  const inner = extractInnerByAttr(text, 'data-impeccable-variant="original"');
  if (inner === null) return [];
  return inner.split('\n');
}

/**
 * Extract a specific variant's inner content (stripping the wrapper div).
 * Returns an array of lines, or null if not found.
 */
function extractVariant(lines, block, variantNum) {
  const text = stripStyleAndJoin(lines, block);
  const inner = extractInnerByAttr(text, 'data-impeccable-variant="' + variantNum + '"');
  if (inner === null) return null;
  const result = inner.split('\n');
  // Collapse a lone empty leading/trailing line (common after string splice).
  while (result.length > 1 && result[0].trim() === '') result.shift();
  while (result.length > 1 && result[result.length - 1].trim() === '') result.pop();
  return result.length > 0 ? result : null;
}

/**
 * Extract the colocated <style> block content (between the style tags).
 * Returns an array of CSS lines, or null if no style block found.
 *
 * Handles three shapes of `<style data-impeccable-css="ID" ...>`:
 *   1. Self-closing: `<style ... />` — no body; return null (nothing to carbonize).
 *   2. Same-line open+close: `<style>...</style>` — return the inner content.
 *   3. Multi-line: `<style>` on one line, `</style>` on a later line — return
 *      the lines between them.
 */
function extractCss(lines, block, id) {
  const styleAttr = 'data-impeccable-css="' + id + '"';
  let inStyle = false;
  const content = [];

  for (let i = block.start; i <= block.end; i++) {
    const line = lines[i];

    if (!inStyle && line.includes(styleAttr)) {
      // Self-closing: nothing to carbonize.
      if (/<style\b[^>]*\/\s*>/.test(line)) return null;
      // Same-line open + close: extract inner text.
      const sameLine = line.match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/);
      if (sameLine) {
        const inner = sameLine[1];
        return inner.length > 0 ? inner.split('\n') : null;
      }
      inStyle = true;
      continue; // skip the <style> opening tag
    }

    if (inStyle) {
      // Detect </style> anywhere on the line — JSX template-literal closes
      // (`}</style>`) put the close mid-line, and we don't want to absorb the
      // template-literal punctuation as CSS content.
      const closeIdx = line.indexOf('</style>');
      if (closeIdx !== -1) break;
      content.push(line);
    }
  }

  return content.length > 0 ? content : null;
}

/**
 * De-indent content that was indented by live-wrap.mjs.
 * The wrap script adds `indent + '    '` (4 extra spaces) to each line.
 * We restore to just `indent` level.
 */
function deindentContent(contentLines, baseIndent) {
  // Find the minimum indentation in the content to determine how much was added
  let minIndent = Infinity;
  for (const line of contentLines) {
    if (line.trim() === '') continue;
    const leadingSpaces = line.match(/^(\s*)/)[1].length;
    minIndent = Math.min(minIndent, leadingSpaces);
  }
  if (minIndent === Infinity) minIndent = 0;

  // Strip the extra indentation and re-add base indent
  return contentLines.map(line => {
    if (line.trim() === '') return '';
    return baseIndent + line.slice(minIndent);
  });
}

function detectCommentSyntax(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jsx' || ext === '.tsx') {
    return { open: '{/*', close: '*/}' };
  }
  return { open: '<!--', close: '-->' };
}

// ---------------------------------------------------------------------------
// File search (find the file containing session markers)
// ---------------------------------------------------------------------------

function findSessionFile(id, cwd) {
  const marker = 'impeccable-variants-start ' + id;
  const searchDirs = ['src', 'app', 'pages', 'components', 'public', 'views', 'templates', '.'];
  const seen = new Set();

  for (const dir of searchDirs) {
    const absDir = path.join(cwd, dir);
    if (!fs.existsSync(absDir)) continue;
    const result = searchDir(absDir, marker, seen, 0);
    if (result) {
      const content = fs.readFileSync(result, 'utf-8');
      return { file: result, content, lines: content.split('\n') };
    }
  }
  return null;
}

function searchDir(dir, query, seen, depth) {
  if (depth > 5) return null;
  let realDir;
  try { realDir = fs.realpathSync(dir); } catch { return null; }
  if (seen.has(realDir)) return null;
  seen.add(realDir);

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes(query)) return filePath;
    } catch { /* skip */ }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
    const result = searchDir(path.join(dir, entry.name), query, seen, depth + 1);
    if (result) return result;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function argVal(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

// Auto-execute when run directly
const _running = process.argv[1];
if (_running?.endsWith('live-accept.mjs') || _running?.endsWith('live-accept.mjs/')) {
  acceptCli();
}

export { findMarkerBlock, extractOriginal, extractVariant, extractCss, deindentContent, detectCommentSyntax };
