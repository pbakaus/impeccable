import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  listSurfaceBriefs,
  normalizeSurfaceTarget,
  resolveSurfaceBrief,
  writeSurfaceBrief,
} from '../skill/scripts/lib/surface-briefs.mjs';

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-surface-brief-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('surface briefs', () => {
  it('writes one clone-stable brief and resolves primary and related targets', () => {
    const filePath = writeSurfaceBrief({
      projectRoot: cwd,
      primaryTarget: 'src/pages/index.astro',
      relatedTargets: ['src/components/Hero.astro'],
      body: '# Surface brief: Home\n\n## Product strategy\nInstall the product.',
    });

    assert.equal(path.relative(cwd, filePath), path.join('.impeccable', 'surfaces', 'src-pages-index-astro.md'));
    const primary = resolveSurfaceBrief(cwd, 'src/pages/index.astro');
    const related = resolveSurfaceBrief(cwd, 'src/components/Hero.astro');
    assert.equal(primary.brief?.slug, 'src-pages-index-astro');
    assert.equal(related.brief?.slug, 'src-pages-index-astro');
    assert.match(primary.brief?.body || '', /Install the product/);
  });

  it('auto-loads only when one surface brief exists', () => {
    writeSurfaceBrief({ projectRoot: cwd, primaryTarget: 'src/pages/index.astro', body: '# Home' });
    assert.equal(resolveSurfaceBrief(cwd).reason, 'only-brief');

    writeSurfaceBrief({ projectRoot: cwd, primaryTarget: 'src/pages/pricing.astro', body: '# Pricing' });
    const result = resolveSurfaceBrief(cwd);
    assert.equal(result.brief, null);
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.candidates.length, 2);
  });

  it('keeps surface strategy as stable current context rather than snapshots', () => {
    writeSurfaceBrief({ projectRoot: cwd, primaryTarget: 'src/pages/index.astro', body: '# Home\n\nFirst.' });
    writeSurfaceBrief({ projectRoot: cwd, primaryTarget: 'src/pages/index.astro', body: '# Home\n\nRevised.' });
    const briefs = listSurfaceBriefs(cwd);
    assert.equal(briefs.length, 1);
    assert.match(briefs[0].body, /Revised/);
    assert.doesNotMatch(briefs[0].body, /First/);
  });

  it('supports route identifiers without confusing them with source paths', () => {
    const filePath = writeSurfaceBrief({
      projectRoot: cwd,
      primaryTarget: '/pricing?from=nav',
      body: '# Surface brief: Pricing route',
    });
    assert.equal(path.basename(filePath), 'route-pricing.md');
    const result = resolveSurfaceBrief(cwd, 'route:/pricing');
    assert.equal(result.reason, 'slug');
    assert.equal(result.brief?.primaryTarget, 'route:/pricing');
  });

  it('canonicalizes explicit and inferred route identifiers consistently', () => {
    assert.equal(normalizeSurfaceTarget('route:/docs//intro/?from=nav#top', { projectRoot: cwd }), 'route:/docs/intro');
    assert.equal(normalizeSurfaceTarget('/docs//intro/?from=nav#top', { projectRoot: cwd }), 'route:/docs/intro');
    assert.equal(normalizeSurfaceTarget('route:/docs/../admin', { projectRoot: cwd }), null);
    assert.equal(normalizeSurfaceTarget('/docs/../admin', { projectRoot: cwd }), null);
  });

  it('supports the root route even though the filesystem root exists', () => {
    const filePath = writeSurfaceBrief({
      projectRoot: cwd,
      primaryTarget: '/',
      body: '# Surface brief: Home route',
    });
    assert.equal(path.basename(filePath), 'route.md');
    const result = resolveSurfaceBrief(cwd, 'route:/');
    assert.equal(result.reason, 'slug');
    assert.equal(result.brief?.primaryTarget, 'route:/');
  });
});
