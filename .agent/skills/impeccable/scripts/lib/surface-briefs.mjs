import fs from 'node:fs';
import path from 'node:path';
import { slugFromTarget } from './target-slug.mjs';

export const SURFACE_BRIEF_VERSION = 1;

export function getSurfaceBriefDir(projectRoot) {
  return path.join(projectRoot, '.impeccable', 'surfaces');
}

export function normalizeSurfaceTarget(target, { projectRoot = process.cwd() } = {}) {
  if (!target || typeof target !== 'string' || !target.trim()) return null;
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.hash = '';
      url.search = '';
      return url.toString().replace(/\/$/, '') || url.origin;
    } catch {
      return null;
    }
  }
  if (/^route:/i.test(trimmed)) {
    const route = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    if (!route.startsWith('/') || route.includes('..')) return null;
    const normalizedRoute = route.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return `route:${normalizedRoute}`;
  }
  if (trimmed === '/') return 'route:/';
  if (trimmed.startsWith('/')) {
    const absolute = path.resolve(trimmed);
    const relativeToProject = path.relative(projectRoot, absolute);
    const isProjectFile = relativeToProject && !relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject);
    if (!isProjectFile && !fs.existsSync(absolute) && !trimmed.includes('..')) {
      const normalizedRoute = trimmed.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      return `route:${normalizedRoute}`;
    }
  }
  const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(projectRoot, trimmed);
  const rel = path.relative(projectRoot, abs);
  if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export function surfaceBriefPathForTarget(target, { projectRoot = process.cwd() } = {}) {
  const normalized = normalizeSurfaceTarget(target, { projectRoot });
  if (!normalized) return null;
  const slugInput = normalized.startsWith('route:') ? `route${normalized.slice('route:'.length)}` : normalized;
  const slug = slugFromTarget(slugInput, { cwd: projectRoot });
  return slug ? path.join(getSurfaceBriefDir(projectRoot), `${slug}.md`) : null;
}

export function parseSurfaceBrief(text, filePath = null) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const meta = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim();
      const raw = line.slice(colon + 1).trim();
      if (!key) continue;
      if (/^(?:\[|\{|\")/.test(raw) || /^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(raw)) {
        try { meta[key] = JSON.parse(raw); continue; } catch { /* keep string */ }
      }
      meta[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }
  const primaryTarget = typeof meta.primary_target === 'string' ? meta.primary_target : null;
  const relatedTargets = Array.isArray(meta.related_targets)
    ? meta.related_targets.filter((value) => typeof value === 'string')
    : [];
  return {
    path: filePath,
    text: String(text || ''),
    body: match ? String(text || '').slice(match[0].length).trim() : String(text || '').trim(),
    meta,
    slug: typeof meta.slug === 'string' ? meta.slug : filePath ? path.basename(filePath, '.md') : null,
    primaryTarget,
    relatedTargets,
    targets: [primaryTarget, ...relatedTargets].filter(Boolean),
  };
}

export function listSurfaceBriefs(projectRoot = process.cwd()) {
  const dir = getSurfaceBriefDir(projectRoot);
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const filePath = path.join(dir, name);
    try {
      return [parseSurfaceBrief(fs.readFileSync(filePath, 'utf-8'), filePath)];
    } catch {
      return [];
    }
  });
}

export function resolveSurfaceBrief(projectRoot = process.cwd(), target = null) {
  const briefs = listSurfaceBriefs(projectRoot);
  if (!target) {
    return {
      brief: briefs.length === 1 ? briefs[0] : null,
      candidates: briefs,
      reason: briefs.length === 1 ? 'only-brief' : briefs.length > 1 ? 'ambiguous' : 'none',
    };
  }

  const normalized = normalizeSurfaceTarget(target, { projectRoot });
  if (!normalized) return { brief: null, candidates: briefs, reason: 'invalid-target' };
  const exactPath = surfaceBriefPathForTarget(normalized, { projectRoot });
  const exact = briefs.find((brief) => brief.path === exactPath && (!brief.targets.length || brief.targets.includes(normalized)));
  if (exact) return { brief: exact, candidates: briefs, reason: 'slug' };
  const mapped = briefs.filter((brief) => brief.targets.includes(normalized));
  return {
    brief: mapped.length === 1 ? mapped[0] : null,
    candidates: mapped.length > 1 ? mapped : briefs,
    reason: mapped.length === 1 ? 'mapping' : mapped.length > 1 ? 'ambiguous-target' : 'not-found',
  };
}

export function writeSurfaceBrief({
  projectRoot = process.cwd(),
  primaryTarget,
  relatedTargets = [],
  body,
}) {
  const normalizedPrimary = normalizeSurfaceTarget(primaryTarget, { projectRoot });
  if (!normalizedPrimary) throw new Error('surface brief requires a concrete project-relative primary target or URL');
  const normalizedRelated = [...new Set(relatedTargets
    .map((target) => normalizeSurfaceTarget(target, { projectRoot }))
    .filter((target) => target && target !== normalizedPrimary))];
  const slug = slugFromTarget(normalizedPrimary, { cwd: projectRoot });
  const filePath = surfaceBriefPathForTarget(normalizedPrimary, { projectRoot });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const frontmatter = [
    '---',
    `version: ${SURFACE_BRIEF_VERSION}`,
    `slug: ${JSON.stringify(slug)}`,
    `primary_target: ${JSON.stringify(normalizedPrimary)}`,
    `related_targets: ${JSON.stringify(normalizedRelated)}`,
    '---',
  ].join('\n');
  fs.writeFileSync(filePath, `${frontmatter}\n\n${String(body || '').trim()}\n`, 'utf-8');
  return filePath;
}
