import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { ANTIPATTERNS } from '../cli/engine/registry/antipatterns.mjs';

const ROOT = process.cwd();

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, predicate, out);
    } else if (predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function normalizeRoute(route) {
  if (route === '/') return route;
  return route.replace(/\/$/, '');
}

function pageRoute(file) {
  const rel = path.relative(path.join(ROOT, 'site/pages'), file).replaceAll(path.sep, '/');
  if (rel.includes('[') || !rel.endsWith('.astro')) return null;
  const stem = rel.replace(/\.astro$/, '');
  if (stem === 'index') return '/';
  if (stem.endsWith('/index')) return normalizeRoute(`/${stem.slice(0, -'/index'.length)}`);
  return normalizeRoute(`/${stem}`);
}

function knownRoutes() {
  const routes = new Set();

  for (const file of walk(path.join(ROOT, 'site/pages'), file => file.endsWith('.astro'))) {
    const route = pageRoute(file);
    if (route) routes.add(route);
  }

  for (const file of fs.readdirSync(path.join(ROOT, 'site/content/skills')).filter(file => file.endsWith('.md'))) {
    routes.add(`/docs/${file.replace(/\.md$/, '')}`);
  }
  routes.add('/docs');

  for (const file of fs.readdirSync(path.join(ROOT, 'site/content/tutorials')).filter(file => file.endsWith('.md'))) {
    routes.add(`/tutorials/${file.replace(/\.md$/, '')}`);
  }
  routes.add('/tutorials');

  const referenceDir = path.join(ROOT, 'site/content/reference');
  if (fs.existsSync(referenceDir)) {
    for (const file of fs.readdirSync(referenceDir).filter(file => file.endsWith('.md'))) {
      routes.add(`/docs/${file.replace(/\.md$/, '')}`);
    }
  }

  if (fs.existsSync(path.join(ROOT, 'site/public/neo-mirai/index.html'))) {
    routes.add('/neo-mirai');
  }

  return routes;
}

function docsFiles() {
  const roots = ['site/pages', 'site/content', 'site/components', 'site/layouts'];
  return roots.flatMap(root => walk(path.join(ROOT, root), file => /\.(astro|md|ts|js)$/.test(file)));
}

function routeFromUrl(url) {
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  if (url.startsWith('/api/') || url.startsWith('/_data/')) return null;

  const clean = url.split('#')[0].split('?')[0];
  if (!clean) return '/';

  if (
    clean.startsWith('/assets/') ||
    clean.startsWith('/antipattern-') ||
    clean.startsWith('/js/') ||
    clean.startsWith('/neo-mirai/assets/')
  ) {
    return null;
  }

  if (path.extname(clean)) return null;
  return normalizeRoute(clean);
}

describe('docs integrity', () => {
  test('internal docs links point at canonical local routes', () => {
    const routes = knownRoutes();
    const broken = [];

    for (const file of docsFiles()) {
      const rel = path.relative(ROOT, file);
      const src = fs.readFileSync(file, 'utf8');
      const urls = [];

      for (const match of src.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
        urls.push(match[1]);
      }
      for (const match of src.matchAll(/\]\((\/[^)\s]+)\)/g)) {
        urls.push(match[1]);
      }

      for (const url of urls) {
        const route = routeFromUrl(url);
        if (route && !routes.has(route)) {
          broken.push(`${rel}: ${url}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  test('public docs use source-of-truth command and detector counts', () => {
    const commandMetadata = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'skill/scripts/command-metadata.json'), 'utf8')
    );
    const commandCount = Object.keys(commandMetadata).length;
    const detectorCount = new Set(ANTIPATTERNS.map(rule => rule.id)).size;

    const files = [
      'README.md',
      'README.npm.md',
      'site/pages/index.astro',
      'site/content/tutorials/getting-started.md',
      'site/content/skills/impeccable.md',
      'site/public/llms.txt',
    ];

    const stale = [];
    const commandPattern = /\b(\d+)\s+(?:sub-)?commands\b|\b(\d+)\s+steering commands\b/gi;
    const detectorPattern = /\b(\d+)\s+(?:deterministic\s+)?(?:detector\s+)?(?:rules|detections|checks|patterns)\b/gi;

    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

      for (const match of src.matchAll(commandPattern)) {
        const count = Number(match[1] || match[2]);
        if (count !== commandCount && count !== 1) {
          stale.push(`${rel}: "${match[0]}" should be ${commandCount}`);
        }
      }

      for (const match of src.matchAll(detectorPattern)) {
        const count = Number(match[1]);
        if (count > 10 && count !== detectorCount) {
          stale.push(`${rel}: "${match[0]}" should be ${detectorCount}`);
        }
      }
    }

    expect(stale).toEqual([]);
  });
});
