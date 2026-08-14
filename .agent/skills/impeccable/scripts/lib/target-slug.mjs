import path from 'node:path';

const SLUG_MAX = 50;

/** Derive one clone-stable slug from a concrete file path or URL. */
export function slugFromTarget(resolved, { cwd = process.cwd() } = {}) {
  if (!resolved || typeof resolved !== 'string') return null;
  const trimmed = resolved.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let url;
    try { url = new URL(trimmed); } catch { return null; }
    return kebab(`${url.hostname}${url.pathname}`);
  }

  const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  let rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) rel = path.basename(abs);
  if (!rel || rel === '.') return null;
  return kebab(rel);
}

export function kebab(value) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[/\\.]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return null;
  return slug.length <= SLUG_MAX ? slug : slug.slice(slug.length - SLUG_MAX).replace(/^-/, '');
}
