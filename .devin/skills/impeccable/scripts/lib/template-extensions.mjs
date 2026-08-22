/**
 * One owner for "which file extensions hold UI markup".
 *
 * Before this module the answer was spelled out separately in hook-lib.mjs
 * (`detector.extensions` config, issue #316) and in live-wrap.mjs /
 * live-accept.mjs (a hardcoded `EXTENSIONS` array, duplicated verbatim in both).
 * The lists drifted: the hook learned configurable server-template extensions
 * while Live kept its six frontend defaults, so a Phoenix project got design
 * findings on `.heex` files but `Session markers not found` on Accept (#374).
 *
 * Extensions are matched against the END OF THE FILENAME, not `path.extname`,
 * so double extensions like `.blade.php`, `.html.erb`, and `.html.heex` work.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Built-in markup extensions for Live's wrap/accept source search.
 *
 * Elixir's `.ex` is here because Phoenix function components put `~H"""`
 * templates directly in `lib/**\/*.ex`; `.heex` and `.eex` cover standalone
 * templates. `.exs` is deliberately absent: those are Elixir *scripts*
 * (`mix.exs`, `config/*.exs`, tests) and never hold markup, so including them
 * only gives the wrap query a chance to match build config by accident.
 */
export const LIVE_TEMPLATE_EXTENSIONS = Object.freeze([
  '.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro',
  '.ex', '.heex', '.eex',
]);

/**
 * Normalize `detector.extensions` entries to `{ ext, engine }`.
 *
 * Accepts `{ ext, engine }` objects (engine 'html' | 'text', default 'html' —
 * the common case for server-side templates) or bare strings as shorthand.
 */
export function normalizeExtensionEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : entry?.ext;
    if (typeof raw !== 'string') continue;
    let ext = raw.trim().toLowerCase();
    if (!ext) continue;
    if (!ext.startsWith('.')) ext = `.${ext}`;
    const engine = (!(typeof entry === 'string') && entry?.engine === 'text') ? 'text' : 'html';
    out.push({ ext, engine });
  }
  return out;
}

export function mergeExtensions(existing, incoming) {
  const map = new Map();
  for (const entry of normalizeExtensionEntries(existing)) map.set(entry.ext, entry);
  for (const entry of normalizeExtensionEntries(incoming)) map.set(entry.ext, entry);
  return Array.from(map.values());
}

export function matchConfiguredExtension(filePath, extensions) {
  if (!Array.isArray(extensions) || extensions.length === 0) return null;
  const name = path.basename(String(filePath || '')).toLowerCase();
  if (!name) return null;
  // The longest matching suffix wins, so `.blade.php` beats a broader `.php`
  // entry regardless of config order.
  let best = null;
  for (const entry of normalizeExtensionEntries(extensions)) {
    if (name.length > entry.ext.length && name.endsWith(entry.ext)
      && (!best || entry.ext.length > best.ext.length)) {
      best = entry;
    }
  }
  return best;
}

/**
 * Does this filename end in one of `extensions`?
 *
 * Suffix matching rather than `path.extname` equality, so a configured
 * `.html.erb` matches `show.html.erb` (whose extname is only `.erb`). The
 * `name.length > ext.length` guard keeps a file literally named `.heex` from
 * counting as a template.
 */
export function matchesTemplateExtension(filePath, extensions) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  if (!name) return false;
  for (const ext of extensions) {
    if (name.length > ext.length && name.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Built-in Live extensions plus any the project configured for the detector.
 *
 * Reading `detector.extensions` here is the point: a user who taught the design
 * hook about `.blade.php` should not have to teach Live separately. Config
 * parsing is intentionally minimal (own the shape, not the whole hook config)
 * so this module stays importable from the Live CLI without pulling in
 * hook-lib.mjs.
 */
export function resolveLiveTemplateExtensions(cwd = process.cwd()) {
  const cached = extensionCache.get(cwd);
  if (cached) return cached;
  const resolved = readLiveTemplateExtensions(cwd);
  extensionCache.set(cwd, resolved);
  return resolved;
}

// live-wrap calls the resolver once per candidate query per pass (up to eight
// times in one CLI run), and every call would otherwise re-read and re-parse
// both config files. Keyed by cwd; a single CLI process never rewrites its own
// config mid-run.
const extensionCache = new Map();

/** Test seam: drop the memoized config so a fixture can rewrite config.json. */
export function clearTemplateExtensionCache() {
  extensionCache.clear();
}

function readLiveTemplateExtensions(cwd) {
  const configured = [];
  for (const name of ['config.json', 'config.local.json']) {
    const raw = safeReadJson(path.join(cwd, '.impeccable', name));
    const detector = raw?.detector;
    if (detector && typeof detector === 'object' && !Array.isArray(detector)) {
      configured.push(...normalizeExtensionEntries(detector.extensions));
    }
  }
  const seen = new Set(LIVE_TEMPLATE_EXTENSIONS);
  const out = [...LIVE_TEMPLATE_EXTENSIONS];
  for (const { ext } of configured) {
    if (seen.has(ext)) continue;
    seen.add(ext);
    out.push(ext);
  }
  return out;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
