/**
 * The generic `tag` injection strategy.
 *
 * Frameworks without a dedicated adapter get a literal marker-wrapped
 * `<script src>` block written into the entry template named by
 * `.impeccable/live/config.json`. This module owns that block: building it,
 * inserting it at the configured anchor, removing it again, and the
 * Content-Security-Policy meta patch that keeps the cross-origin load allowed.
 *
 * It is deliberately framework-agnostic. Per-framework knowledge (Astro's
 * `is:inline`, for instance) arrives as the `scriptAttrs` argument, resolved
 * from the registry by the caller, so nothing here has to branch on a file
 * extension or a project shape.
 */

import { buildLiveScriptSrc } from './script-src.mjs';

export const MARKER_OPEN_TEXT = 'impeccable-live-start';
export const MARKER_CLOSE_TEXT = 'impeccable-live-end';

/** Markers that identify a file as still carrying our tag-strategy patch. */
export const TAG_PATCH_MARKERS = Object.freeze([MARKER_OPEN_TEXT, 'data-impeccable-csp-original']);

function commentOpen(syntax) { return syntax === 'jsx' ? '{/*' : '<!--'; }
function commentClose(syntax) { return syntax === 'jsx' ? '*/}' : '-->'; }

/**
 * `scriptAttrs` is a pre-rendered attribute string (trailing space included)
 * that the registry supplies for the target file. Astro is the only framework
 * that uses it today: Astro processes `<script>` tags by default and rewrites
 * src to its own bundled URL, so `is:inline ` opts out and the literal external
 * src survives.
 */
export function buildTagBlock(syntax, port, token, scriptAttrs = '') {
  const open = commentOpen(syntax);
  const close = commentClose(syntax);
  return (
    open + ' ' + MARKER_OPEN_TEXT + ' ' + close + '\n' +
    '<script ' + scriptAttrs + 'src="' + buildLiveScriptSrc(port, token) + '"></script>\n' +
    open + ' ' + MARKER_CLOSE_TEXT + ' ' + close + '\n'
  );
}

function detectLineEnding(content) {
  if (content.includes('\r\n')) return '\r\n';
  if (content.includes('\r')) return '\r';
  return '\n';
}

function normalizeLineEndings(content, lineEnding) {
  return lineEnding === '\n' ? content : content.replace(/\n/g, lineEnding);
}

function readLineEndingAt(content, index) {
  if (content[index] === '\r' && content[index + 1] === '\n') return '\r\n';
  if (content[index] === '\n') return '\n';
  if (content[index] === '\r') return '\r';
  return '';
}

export function insertTag(content, config, port, token, scriptAttrs = '') {
  const lineEnding = detectLineEnding(content);
  const block = normalizeLineEndings(buildTagBlock(config.commentSyntax, port, token, scriptAttrs), lineEnding);
  // insertBefore: match the LAST occurrence. Anchors like `</body>` naturally
  // belong at the end, and the same literal can appear earlier in code blocks
  // within rendered documentation pages.
  if (config.insertBefore) {
    const idx = content.lastIndexOf(config.insertBefore);
    if (idx === -1) return content;
    return content.slice(0, idx) + block + content.slice(idx);
  }
  // insertAfter: match the FIRST occurrence — typical anchors like `<head>` or
  // `<body>` open near the top of the document.
  const idx = content.indexOf(config.insertAfter);
  if (idx === -1) return content;
  const after = idx + config.insertAfter.length;
  // Preserve an existing trailing newline if the anchor already has one.
  // Slice the remainder from the original anchor offset, not prefix.length:
  // in the no-newline case prefix is one char longer than the anchor (the
  // appended '\n'), so slicing by prefix.length would drop the first real
  // character after the anchor (#227).
  const existingNewline = readLineEndingAt(content, after);
  const prefix = content.slice(0, after) + (existingNewline || lineEnding);
  const rest = content.slice(after + existingNewline.length);
  return prefix + block + rest;
}

/**
 * Remove the live script block. Matches either HTML or JSX comment markers
 * regardless of config (so stale tags from a wrong config can still be cleaned).
 *
 * Indent-preserving: captures any whitespace immediately preceding the opener
 * marker and re-emits it in place of the removed block. `insertTag` inserted
 * the block *after* the original line's indent and *before* the anchor (e.g.
 * `</body>`), which moved the indent onto the opener line and left the anchor
 * unindented. Replacing the whole block (plus its trailing newline) with just
 * the captured indent hands the indent back to the anchor that follows.
 */
export function removeTag(content, _syntax) {
  const patterns = [
    /([ \t]*)<!--\s*impeccable-live-start\s*-->[\s\S]*?<!--\s*impeccable-live-end\s*-->([ \t]*(?:\r\n|\n|\r|$)?)/,
    /([ \t]*)\{\/\*\s*impeccable-live-start\s*\*\/\}[\s\S]*?\{\/\*\s*impeccable-live-end\s*\*\/\}([ \t]*(?:\r\n|\n|\r|$)?)/,
  ];
  for (const pat of patterns) {
    let changed = false;
    let next = content;
    do {
      content = next;
      next = content.replace(pat, (_match, leadingIndent, trailing = '') => {
        if (/[\r\n]/.test(trailing)) return leadingIndent;
        return leadingIndent || trailing || '';
      });
      if (next !== content) changed = true;
    } while (next !== content);
    if (changed) return next;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Content-Security-Policy meta-tag patcher
//
// When the user's HTML carries `<meta http-equiv="Content-Security-Policy">`,
// the cross-origin load of /live.js (and the SSE/POST connection back to
// localhost:PORT) is blocked unless the CSP explicitly allows that origin.
//
// On insert: append `http://localhost:PORT` to `script-src` and `connect-src`,
// and stash the original `content` value in a `data-impeccable-csp-original`
// attribute (base64) so revert is exact.
//
// On remove: detect the marker attribute, decode it, restore the original
// content value verbatim, drop the marker.
//
// Header-based CSP (Next.js headers, Nuxt routeRules, SvelteKit kit.csp,
// shared helpers) is NOT patched here — those need framework-specific config
// edits and are handled via the existing detect-csp.mjs reference output.
// Only the in-source meta-tag form gets the auto-patch.
// ---------------------------------------------------------------------------

const CSP_MARKER_ATTR = 'data-impeccable-csp-original';

function findCspMetaTags(content) {
  const out = [];
  const tagRe = /<meta\s+([^>]*?)\/?>/gis;
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    const attrs = m[1];
    if (!/(http-equiv|httpEquiv)\s*=\s*(['"])Content-Security-Policy\2/i.test(attrs)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, full: m[0], attrs });
  }
  return out;
}

function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i');
  const m = attrs.match(re);
  return m ? { quote: m[1], value: m[2], full: m[0] } : null;
}

function appendOriginToDirective(csp, directive, origin) {
  const re = new RegExp(`(^|;)(\\s*)(${directive})\\s+([^;]*)`, 'i');
  const m = csp.match(re);
  if (m) {
    const tokens = m[4].trim().split(/\s+/);
    if (tokens.includes(origin)) return csp;
    return csp.replace(re, `${m[1]}${m[2]}${m[3]} ${[...tokens, origin].join(' ')}`);
  }
  // Directive missing — add it. Use 'self' + origin so we don't inadvertently
  // narrow the policy compared to the default-src fallback (most users with
  // an explicit CSP have 'self' there).
  return csp.trim().replace(/;?\s*$/, '') + `; ${directive} 'self' ${origin}`;
}

export function patchCspMeta(content, port) {
  const tags = findCspMetaTags(content);
  if (tags.length === 0) return content;
  const origin = `http://localhost:${port}`;

  // Walk last-to-first so prior splices don't invalidate later indices.
  let result = content;
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    const attrs = tag.attrs;
    if (getAttr(attrs, CSP_MARKER_ATTR)) continue; // already patched
    const contentAttr = getAttr(attrs, 'content');
    if (!contentAttr) continue;

    const original = contentAttr.value;
    let patched = original;
    patched = appendOriginToDirective(patched, 'script-src', origin);
    patched = appendOriginToDirective(patched, 'connect-src', origin);
    // The shader overlay during 'generating' creates a screenshot via
    // URL.createObjectURL, producing a `blob:` URL — img-src 'self' rejects
    // those. Add `blob:` so the overlay doesn't throw a CSP violation.
    patched = appendOriginToDirective(patched, 'img-src', 'blob:');
    if (patched === original) continue;

    const newContentAttr = `content=${contentAttr.quote}${patched}${contentAttr.quote}`;
    const marker = `${CSP_MARKER_ATTR}="${Buffer.from(original, 'utf-8').toString('base64')}"`;
    // The tagRe captures any whitespace between the last attribute and the
    // closing `/>` as part of `attrs`. Naively appending ` ${marker}` after
    // a replace would land it BEFORE that trailing space, leaving a double
    // space inside attrs and clobbering the space before `/>`. Split off
    // the trailing whitespace, splice the marker into the attribute body,
    // and re-append the original trailing whitespace so a self-closing
    // `<meta … />` round-trips byte-for-byte.
    const trailingWs = (attrs.match(/[ \t]*$/) || [''])[0];
    const attrsBody = attrs.slice(0, attrs.length - trailingWs.length);
    const newAttrs = attrsBody.replace(contentAttr.full, newContentAttr) + ' ' + marker + trailingWs;
    const newTag = tag.full.replace(attrs, newAttrs);

    result = result.slice(0, tag.start) + newTag + result.slice(tag.end);
  }
  return result;
}

export function revertCspMeta(content) {
  const tags = findCspMetaTags(content);
  if (tags.length === 0) return content;

  let result = content;
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    const origAttr = getAttr(tag.attrs, CSP_MARKER_ATTR);
    if (!origAttr) continue;
    const contentAttr = getAttr(tag.attrs, 'content');
    if (!contentAttr) continue;

    let originalValue;
    try { originalValue = Buffer.from(origAttr.value, 'base64').toString('utf-8'); }
    catch { continue; }

    const newContentAttr = `content=${contentAttr.quote}${originalValue}${contentAttr.quote}`;
    let newAttrs = tag.attrs.replace(contentAttr.full, newContentAttr);
    // Drop the marker attribute and any single space immediately preceding it.
    newAttrs = newAttrs.replace(new RegExp(`\\s*${origAttr.full}`), '');
    const newTag = tag.full.replace(tag.attrs, newAttrs);

    result = result.slice(0, tag.start) + newTag + result.slice(tag.end);
  }
  return result;
}

/** The journal's undo for a tag-strategy patch: drop the block, restore CSP. */
export function unpatchTagFile(content) {
  return revertCspMeta(removeTag(content));
}
