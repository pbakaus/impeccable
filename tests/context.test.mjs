/**
 * Tests for the shared context loader (PRODUCT.md / DESIGN.md resolver).
 * Run with: node --test tests/load-context.test.mjs
 *
 * Covers the resolution order:
 *   1. cwd, when canonical files are at the root
 *   2. Auto-fallback to .agents/context/ then docs/
 *   3. IMPECCABLE_CONTEXT_DIR env var as a power-user escape hatch (only
 *      consulted when the default paths come up empty)
 *   4. Default to cwd when nothing is found
 *
 * Each test runs in its own scratch dir under os.tmpdir() so the suite stays
 * independent of the project root and parallel-safe.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadContext, resolveContextDir, resolveProjectRoot } from '../skill/scripts/context.mjs';

import { fileURLToPath } from 'node:url';
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'scripts', 'context.mjs');

let scratch;
let savedEnv;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-loadctx-'));
  savedEnv = process.env.IMPECCABLE_CONTEXT_DIR;
  delete process.env.IMPECCABLE_CONTEXT_DIR;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.IMPECCABLE_CONTEXT_DIR;
  else process.env.IMPECCABLE_CONTEXT_DIR = savedEnv;
  fs.rmSync(scratch, { recursive: true, force: true });
});

function write(rel, body = '# placeholder\n') {
  const abs = path.join(scratch, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

function parseTargetSelection(stdout) {
  const tail = stdout.split('TARGET_SELECTION_REQUIRED:\n')[1];
  assert.ok(tail, `missing TARGET_SELECTION_REQUIRED block in:\n${stdout}`);
  return JSON.parse(tail.split('\n\n')[0].trim());
}

describe('resolveContextDir', () => {
  it('returns cwd when PRODUCT.md is at the root', () => {
    write('PRODUCT.md');
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('returns cwd when DESIGN.md is at the root', () => {
    write('DESIGN.md');
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('falls back to .agents/context/ when root is clean', () => {
    write('.agents/context/PRODUCT.md');
    assert.equal(resolveContextDir(scratch), path.join(scratch, '.agents', 'context'));
  });

  it('falls back to docs/ when root is clean and .agents/context/ is empty', () => {
    write('docs/PRODUCT.md');
    assert.equal(resolveContextDir(scratch), path.join(scratch, 'docs'));
  });

  it('prefers .agents/context/ over docs/ when both exist', () => {
    write('.agents/context/PRODUCT.md');
    write('docs/PRODUCT.md');
    assert.equal(resolveContextDir(scratch), path.join(scratch, '.agents', 'context'));
  });

  it('prefers cwd over fallback dirs when canonical files are at the root', () => {
    write('PRODUCT.md');
    write('.agents/context/PRODUCT.md');
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('uses IMPECCABLE_CONTEXT_DIR as a fallback when defaults are empty (relative path)', () => {
    write('design/PRODUCT.md');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    assert.equal(resolveContextDir(scratch), path.join(scratch, 'design'));
  });

  it('uses IMPECCABLE_CONTEXT_DIR as a fallback when defaults are empty (absolute path)', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-elsewhere-'));
    try {
      process.env.IMPECCABLE_CONTEXT_DIR = elsewhere;
      assert.equal(resolveContextDir(scratch), elsewhere);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('default paths win over IMPECCABLE_CONTEXT_DIR (lazy escape hatch)', () => {
    write('PRODUCT.md', 'root');
    write('design/PRODUCT.md', 'overridden');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('ignores empty IMPECCABLE_CONTEXT_DIR', () => {
    write('PRODUCT.md');
    process.env.IMPECCABLE_CONTEXT_DIR = '   ';
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('returns cwd when nothing is found anywhere', () => {
    assert.equal(resolveContextDir(scratch), scratch);
  });
});

describe('loadContext', () => {
  it('reads PRODUCT.md and DESIGN.md from the root', () => {
    write('PRODUCT.md', '# product content\n');
    write('DESIGN.md', '# design content\n');
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, true);
    assert.equal(ctx.hasDesign, true);
    assert.match(ctx.product, /product content/);
    assert.match(ctx.design, /design content/);
    assert.equal(ctx.productPath, 'PRODUCT.md');
    assert.equal(ctx.designPath, 'DESIGN.md');
    assert.equal(ctx.contextDir, scratch);
  });

  it('reads from .agents/context/ when the root is clean', () => {
    write('.agents/context/PRODUCT.md', '# product in agents\n');
    write('.agents/context/DESIGN.md', '# design in agents\n');
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, true);
    assert.equal(ctx.hasDesign, true);
    assert.match(ctx.product, /product in agents/);
    assert.equal(ctx.contextDir, path.join(scratch, '.agents', 'context'));
    // productPath/designPath are relative to cwd, not contextDir
    assert.equal(ctx.productPath, path.join('.agents', 'context', 'PRODUCT.md'));
    assert.equal(ctx.designPath, path.join('.agents', 'context', 'DESIGN.md'));
  });

  it('reads from docs/ when .agents/context/ is empty', () => {
    write('docs/PRODUCT.md', '# product in docs\n');
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, true);
    assert.equal(ctx.contextDir, path.join(scratch, 'docs'));
    assert.equal(ctx.productPath, path.join('docs', 'PRODUCT.md'));
  });
});

describe('loadContext (monorepo project context)', () => {
  function writeMonorepo() {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*', 'packages/*'],
    }, null, 2));
    write('turbo.json', JSON.stringify({ tasks: {} }));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    for (const app of ['marketing', 'dashboard', 'admin']) {
      write(`apps/${app}/src/App.jsx`, `export default function App() { return ${JSON.stringify(app)}; }\n`);
    }
  }

  it('inherits root PRODUCT.md and DESIGN.md for child apps without project context', () => {
    writeMonorepo();

    for (const app of ['marketing', 'dashboard', 'admin']) {
      const ctx = loadContext(scratch, { targetPath: `apps/${app}/src/App.jsx` });
      assert.equal(ctx.hasProduct, true);
      assert.equal(ctx.hasDesign, true);
      assert.match(ctx.product, /Root product/);
      assert.match(ctx.design, /Root design/);
      assert.equal(ctx.productPath, 'PRODUCT.md');
      assert.equal(ctx.designPath, 'DESIGN.md');
      assert.equal(ctx.projectRoot, path.join(scratch, 'apps', app));
      assert.equal(ctx.repoRoot, scratch);
      assert.equal(ctx.isMonorepo, true);
    }
  });

  it('lets child app context override root files independently', () => {
    writeMonorepo();
    write('apps/marketing/PRODUCT.md', '# Marketing product\n');
    write('apps/marketing/DESIGN.md', '# Marketing design\n');
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');

    const marketing = loadContext(scratch, { targetPath: 'apps/marketing/src/App.jsx' });
    assert.match(marketing.product, /Marketing product/);
    assert.match(marketing.design, /Marketing design/);
    assert.equal(marketing.productPath, path.join('apps', 'marketing', 'PRODUCT.md'));
    assert.equal(marketing.designPath, path.join('apps', 'marketing', 'DESIGN.md'));

    const dashboard = loadContext(scratch, { targetPath: 'apps/dashboard/src/App.jsx' });
    assert.match(dashboard.product, /Dashboard product/);
    assert.match(dashboard.design, /Root design/);
    assert.equal(dashboard.productPath, path.join('apps', 'dashboard', 'PRODUCT.md'));
    assert.equal(dashboard.designPath, 'DESIGN.md');

    const admin = loadContext(scratch, { targetPath: 'apps/admin/src/App.jsx' });
    assert.match(admin.product, /Root product/);
    assert.match(admin.design, /Root design/);
    assert.equal(admin.productPath, 'PRODUCT.md');
    assert.equal(admin.designPath, 'DESIGN.md');
  });

  it('resolves child project roots from cwd inside a workspace', () => {
    writeMonorepo();
    const appDir = path.join(scratch, 'apps', 'dashboard');
    const ctx = loadContext(appDir);
    assert.match(ctx.product, /Root product/);
    assert.match(ctx.design, /Root design/);
    assert.equal(ctx.productPath, path.join('..', '..', 'PRODUCT.md'));
    assert.equal(ctx.designPath, path.join('..', '..', 'DESIGN.md'));
    assert.equal(resolveProjectRoot(appDir), appDir);
  });

  it('supports pnpm workspace patterns when resolving the active project', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - "services/*"\n');
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('services/checkout/src/App.jsx');

    const ctx = loadContext(scratch, { targetPath: 'services/checkout/src/App.jsx' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'services', 'checkout'));
    assert.match(ctx.product, /Root product/);
    assert.match(ctx.design, /Root design/);
  });

  it('supports pnpm workspace patterns with inline comments and flow arrays', () => {
    write('pnpm-workspace.yaml', 'packages: ["services/*", "tools/*"] # workspace packages\n');
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('tools/inspector/PRODUCT.md', '# Inspector product\n');
    write('tools/inspector/src/App.jsx');

    const ctx = loadContext(scratch, { targetPath: 'tools/inspector/src/App.jsx' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'tools', 'inspector'));
    assert.match(ctx.product, /Inspector product/);
    assert.match(ctx.design, /Root design/);
  });

  it('honors negated pnpm workspace patterns', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - "packages/**"\n  - "!packages/private/**"\n');
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('packages/private/app/src/index.ts', 'export const hidden = true;\n');

    const ctx = loadContext(scratch, { targetPath: 'packages/private/app/src/index.ts' });
    assert.equal(ctx.projectRoot, scratch);
    assert.match(ctx.product, /Root product/);
    assert.match(ctx.design, /Root design/);
  });

  it('keeps unmatched child projects from being hijacked by an ancestor workspace', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));
    write('PRODUCT.md', '# Ancestor product\n');
    write('side-project/PRODUCT.md', '# Side project product\n');
    write('side-project/src/App.jsx', 'export default null;\n');

    const ctx = loadContext(path.join(scratch, 'side-project'), { targetPath: 'src/App.jsx' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'side-project'));
    assert.match(ctx.product, /Side project product/);
    assert.equal(ctx.productPath, 'PRODUCT.md');
  });

  it('does not reuse stale project resolution after workspace markers change', () => {
    write('PRODUCT.md', '# Root product\n');
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
    write('apps/dashboard/src/App.jsx', 'export default null;\n');

    const before = loadContext(scratch, { targetPath: 'apps/dashboard/src/App.jsx' });
    assert.equal(before.projectRoot, scratch);
    assert.match(before.product, /Root product/);

    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));

    const after = loadContext(scratch, { targetPath: 'apps/dashboard/src/App.jsx' });
    assert.equal(after.projectRoot, path.join(scratch, 'apps', 'dashboard'));
    assert.match(after.product, /Dashboard product/);
  });

  it('does not escape a nested git repo to an ancestor workspace', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['repos/*'],
    }, null, 2));
    write('PRODUCT.md', '# Outer product\n');
    write('DESIGN.md', '# Outer design\n');
    write('repos/standalone/.git/HEAD', 'ref: refs/heads/main\n');
    write('repos/standalone/PRODUCT.md', '# Standalone product\n');
    write('repos/standalone/src/App.jsx', 'export default null;\n');

    const project = path.join(scratch, 'repos', 'standalone');
    const ctx = loadContext(project, { targetPath: 'src/App.jsx' });
    assert.equal(ctx.isMonorepo, false);
    assert.equal(ctx.projectRoot, project);
    assert.equal(ctx.repoRoot, project);
    assert.match(ctx.product, /Standalone product/);
    assert.equal(ctx.productPath, 'PRODUCT.md');
    assert.equal(ctx.designPath, null);
  });

  it('resolves an explicit root target into a nested-git workspace child', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['repos/*'],
    }, null, 2));
    write('PRODUCT.md', '# Outer product\n');
    write('DESIGN.md', '# Outer design\n');
    write('repos/standalone/.git/HEAD', 'ref: refs/heads/main\n');
    write('repos/standalone/PRODUCT.md', '# Standalone product\n');
    write('repos/standalone/src/App.jsx', 'export default null;\n');

    const project = path.join(scratch, 'repos', 'standalone');
    const ctx = loadContext(scratch, { targetPath: 'repos/standalone/src/App.jsx' });
    assert.equal(ctx.isMonorepo, true);
    assert.equal(ctx.projectRoot, project);
    assert.equal(ctx.repoRoot, scratch);
    assert.match(ctx.product, /Standalone product/);
    assert.match(ctx.design, /Outer design/);
    assert.equal(ctx.productPath, path.join('repos', 'standalone', 'PRODUCT.md'));
    assert.equal(ctx.designPath, 'DESIGN.md');
  });

  it('supports double-star workspace patterns by resolving the shallow child project', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['libs/**'],
    }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('libs/ui/PRODUCT.md', '# UI product\n');
    write('libs/ui/src/index.ts', 'export const ui = true;\n');

    const ctx = loadContext(scratch, { targetPath: 'libs/ui/src/index.ts' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'libs', 'ui'));
    assert.match(ctx.product, /UI product/);
    assert.match(ctx.design, /Root design/);
    assert.equal(ctx.productPath, path.join('libs', 'ui', 'PRODUCT.md'));
    assert.equal(ctx.designPath, 'DESIGN.md');
  });

  it('supports packages/**/* workspace patterns without promoting src folders to projects', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['packages/**/*'],
    }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('packages/dashboard/PRODUCT.md', '# Dashboard package product\n');
    write('packages/dashboard/src/index.ts', 'export const dashboard = true;\n');

    const ctx = loadContext(scratch, { targetPath: 'packages/dashboard/src/index.ts' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'packages', 'dashboard'));
    assert.match(ctx.product, /Dashboard package product/);
    assert.match(ctx.design, /Root design/);
    assert.equal(ctx.productPath, path.join('packages', 'dashboard', 'PRODUCT.md'));
    assert.equal(ctx.designPath, 'DESIGN.md');
  });

  it('supports packages/** workspace patterns for nested package roots', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['packages/**'],
    }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('packages/group/app/package.json', JSON.stringify({ name: '@acme/app' }, null, 2));
    write('packages/group/app/PRODUCT.md', '# Group app product\n');
    write('packages/group/app/src/index.ts', 'export const app = true;\n');

    const ctx = loadContext(scratch, { targetPath: 'packages/group/app/src/index.ts' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'packages', 'group', 'app'));
    assert.match(ctx.product, /Group app product/);
    assert.match(ctx.design, /Root design/);
  });

  it('does not discover dependency or generated directories as workspace candidates', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['packages/**'],
    }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('packages/ui/package.json', JSON.stringify({ name: '@acme/ui' }, null, 2));
    write('packages/ui/src/index.ts', 'export const ui = true;\n');
    write('packages/ui/node_modules/dep/package.json', JSON.stringify({ name: 'dep' }, null, 2));
    write('packages/ui/node_modules/dep/src/index.ts', 'export const dep = true;\n');
    write('packages/ui/dist/package.json', JSON.stringify({ name: '@acme/ui-dist' }, null, 2));
    write('packages/ui/dist/src/index.ts', 'export const dist = true;\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    const selection = parseTargetSelection(res.stdout);

    assert.deepEqual(selection.targetCandidates.map((candidate) => candidate.path), ['packages/ui']);
  });

  it('uses apps and packages folders as a fallback when a monorepo marker exists', () => {
    write('nx.json', '{}\n');
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('packages/ui/src/index.ts');

    const ctx = loadContext(scratch, { targetPath: 'packages/ui/src/index.ts' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'packages', 'ui'));
    assert.match(ctx.product, /Root product/);
    assert.match(ctx.design, /Root design/);
  });

  it('does not treat turbo.json alone as a monorepo marker', () => {
    write('turbo.json', JSON.stringify({ tasks: {} }));
    write('PRODUCT.md', '# Root product\n');
    write('src/App.jsx', 'export default null;\n');

    const ctx = loadContext(scratch);
    assert.equal(ctx.isMonorepo, false);

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /MONOREPO_TARGET_REQUIRED/);
  });

  it('supports --target in the CLI', async () => {
    writeMonorepo();
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n\n## Register\n\nproduct\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'apps/dashboard/src/App.jsx'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# Dashboard product/);
    assert.match(res.stdout, /# DESIGN\.md\n\n# Root design/);
    assert.match(res.stdout, /RESOLVED_CONTEXT:/);
    assert.match(res.stdout, /"targetPath": "apps\/dashboard\/src\/App\.jsx"/);
    assert.match(res.stdout, /"productPath": "apps\/dashboard\/PRODUCT\.md"/);
    assert.match(res.stdout, /"designPath": "DESIGN\.md"/);
    assert.match(res.stdout, /NEXT STEP: This project's register is `product`\./);
  });

  it('asks for an app when the CLI runs from a monorepo root without selection', () => {
    writeMonorepo();
    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /TARGET_SELECTION_REQUIRED:/);
    assert.match(res.stdout, /"targetPath": null/);
    assert.match(res.stdout, /"path": "apps\/dashboard"/);
    assert.match(res.stdout, /"targetExample": "apps\/dashboard\/src\/App\.jsx"/);
    assert.match(res.stdout, /"productStatus": "inherited"/);
    assert.match(res.stdout, /"productPath": "PRODUCT\.md"/);
    assert.match(res.stdout, /"designStatus": "inherited"/);
    assert.match(res.stdout, /"designPath": "DESIGN\.md"/);
    assert.doesNotMatch(res.stdout, /# PRODUCT\.md/);
    assert.doesNotMatch(res.stdout, /# DESIGN\.md/);
    assert.doesNotMatch(res.stdout, /MONOREPO_TARGET_REQUIRED/);
  });

  it('describes child, inherited, and mixed context sources in app selection candidates', () => {
    writeMonorepo();
    write('apps/admin/PRODUCT.md', '# Admin product\n');
    write('apps/admin/DESIGN.md', '# Admin design\n');
    write('apps/marketing/PRODUCT.md', '# Marketing product\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    const selection = parseTargetSelection(res.stdout);
    const byPath = Object.fromEntries(selection.targetCandidates.map((candidate) => [candidate.path, candidate]));

    assert.deepEqual(
      {
        productStatus: byPath['apps/admin'].productStatus,
        productPath: byPath['apps/admin'].productPath,
        designStatus: byPath['apps/admin'].designStatus,
        designPath: byPath['apps/admin'].designPath,
      },
      {
        productStatus: 'child',
        productPath: 'apps/admin/PRODUCT.md',
        designStatus: 'child',
        designPath: 'apps/admin/DESIGN.md',
      },
    );
    assert.deepEqual(
      {
        productStatus: byPath['apps/dashboard'].productStatus,
        productPath: byPath['apps/dashboard'].productPath,
        designStatus: byPath['apps/dashboard'].designStatus,
        designPath: byPath['apps/dashboard'].designPath,
      },
      {
        productStatus: 'inherited',
        productPath: 'PRODUCT.md',
        designStatus: 'inherited',
        designPath: 'DESIGN.md',
      },
    );
    assert.deepEqual(
      {
        productStatus: byPath['apps/marketing'].productStatus,
        productPath: byPath['apps/marketing'].productPath,
        designStatus: byPath['apps/marketing'].designStatus,
        designPath: byPath['apps/marketing'].designPath,
      },
      {
        productStatus: 'child',
        productPath: 'apps/marketing/PRODUCT.md',
        designStatus: 'inherited',
        designPath: 'DESIGN.md',
      },
    );
  });

  it('marks missing context files in app selection candidates', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('apps/dashboard/src/App.jsx', 'export default null;\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    const selection = parseTargetSelection(res.stdout);
    const dashboard = selection.targetCandidates.find((candidate) => candidate.path === 'apps/dashboard');
    assert.equal(dashboard.productStatus, 'inherited');
    assert.equal(dashboard.productPath, 'PRODUCT.md');
    assert.equal(dashboard.designStatus, 'missing');
    assert.equal(dashboard.designPath, null);
  });

  it('asks for app selection before init when root context is missing but child context exists', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
    write('apps/dashboard/src/App.jsx', 'export default null;\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /TARGET_SELECTION_REQUIRED:/);
    assert.match(res.stdout, /"path": "apps\/dashboard"/);
    assert.doesNotMatch(res.stdout, /^NO_PRODUCT_MD:/);
  });

  it('excludes negated workspace packages from the selection candidates', () => {
    write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n  - "!packages/internal"\n');
    write('PRODUCT.md', '# Root product\n');
    write('packages/web/src/App.jsx', 'export default null;\n');
    write('packages/internal/src/App.jsx', 'export default null;\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    const selection = parseTargetSelection(res.stdout);
    const paths = selection.targetCandidates.map((candidate) => candidate.path);
    assert.ok(paths.includes('packages/web'), `expected packages/web in ${JSON.stringify(paths)}`);
    assert.ok(!paths.includes('packages/internal'), `packages/internal should be excluded: ${JSON.stringify(paths)}`);
  });

  it('does not block on target selection when the monorepo has no child apps', () => {
    write('package.json', JSON.stringify({ private: true, workspaces: ['.'] }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /TARGET_SELECTION_REQUIRED/);
    assert.match(res.stdout, /# Root product/);
  });

  it('lets --target . explicitly select the monorepo root', () => {
    writeMonorepo();
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', '.'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# PRODUCT\.md\n\n# Root product/);
    assert.match(res.stdout, /# DESIGN\.md\n\n# Root design/);
    assert.match(res.stdout, /"targetPath": "\."/);
    assert.doesNotMatch(res.stdout, /TARGET_SELECTION_REQUIRED/);
  });

  it('does not parse --help as a --target value', () => {
    writeMonorepo();
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', '--help'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--target requires a path value/);
    assert.equal(res.stdout, '');
  });

  it('uses the last --target value when duplicate target flags are provided', () => {
    writeMonorepo();
    write('apps/marketing/PRODUCT.md', '# Marketing product\n');
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');

    const res = spawnSync(process.execPath, [
      SCRIPT_PATH,
      '--target', 'apps/marketing/src/App.jsx',
      '--target', 'apps/dashboard/src/App.jsx',
    ], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /# Dashboard product/);
    assert.match(res.stdout, /"targetPath": "apps\/dashboard\/src\/App\.jsx"/);
    assert.doesNotMatch(res.stdout, /# Marketing product/);
  });

  it('warns when --target names a missing path in a monorepo', () => {
    writeMonorepo();
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'apps/dashboard/routes/pricing'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /RESOLVED_CONTEXT:/);
    assert.match(res.stdout, /"targetExists": false/);
    assert.match(res.stdout, /MONOREPO_TARGET_REQUIRED/);
  });

  it('asks for app selection even when root PRODUCT.md is absent', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
    write('apps/dashboard/src/App.jsx', 'export default null;\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /TARGET_SELECTION_REQUIRED:/);
    assert.match(res.stdout, /"path": "apps\/dashboard"/);
    assert.doesNotMatch(res.stdout, /^NO_PRODUCT_MD:/);
  });
});

describe('loadContext (IMPECCABLE_CONTEXT_DIR escape hatch)', () => {
  it('reads from the override path when defaults are empty', () => {
    write('design/PRODUCT.md', '# overridden product\n');
    write('design/DESIGN.md', '# overridden design\n');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, true);
    assert.equal(ctx.hasDesign, true);
    assert.match(ctx.product, /overridden product/);
    assert.equal(ctx.contextDir, path.join(scratch, 'design'));
  });

  it('does not override defaults when both exist (lazy escape hatch)', () => {
    write('PRODUCT.md', '# root product\n');
    write('design/PRODUCT.md', '# overridden product\n');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    const ctx = loadContext(scratch);
    assert.match(ctx.product, /root product/);
    assert.equal(ctx.contextDir, scratch);
  });

  it('reports a missing override directory as no-context, not as a crash', () => {
    process.env.IMPECCABLE_CONTEXT_DIR = 'no/such/dir';
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, false);
    assert.equal(ctx.hasDesign, false);
    assert.equal(ctx.product, null);
    assert.equal(ctx.design, null);
    assert.equal(ctx.contextDir, path.resolve(scratch, 'no/such/dir'));
  });
});

describe('context.mjs CLI', () => {
  it('emits NO_PRODUCT_MD directive when no PRODUCT.md is found', async () => {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^NO_PRODUCT_MD:/);
    assert.match(res.stdout, /reference\/init\.md/);
  });

  it('prints a PRODUCT.md markdown block when only PRODUCT.md exists', async () => {
    write('PRODUCT.md', '# Acme\n\nbody\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /# Acme/);
    assert.equal(res.stdout.includes('# DESIGN.md'), false);
    // The NEXT STEP directive is always appended after `---`.
    assert.match(res.stdout, /\n---\n\nNEXT STEP:/);
  });

  it('concatenates PRODUCT.md and DESIGN.md with a --- separator', async () => {
    write('PRODUCT.md', '# Acme product\n');
    write('DESIGN.md', '# Acme design\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /\n---\n/);
    assert.match(res.stdout, /# DESIGN\.md\n\n# Acme design/);
    assert.match(res.stdout, /NEXT STEP:/);
  });

  it('reads from a fallback dir when cwd is clean', async () => {
    write('.agents/context/PRODUCT.md', '# fallback product\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /# fallback product/);
  });

  it('names the register-specific reference when PRODUCT.md declares one', async () => {
    write('PRODUCT.md', '# Acme\n\n## Register\n\nbrand\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /NEXT STEP: This project's register is `brand`\./);
    assert.match(res.stdout, /read `reference\/brand\.md`/);
  });

  it('falls back to a generic register directive when no register field is present', async () => {
    write('PRODUCT.md', '# Acme\n\n(no register field)\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /NEXT STEP: You MUST now read the matching register reference/);
    assert.match(res.stdout, /reference\/brand\.md.*reference\/product\.md/);
  });
});

describe('context.mjs update check', () => {
  // The script reads its own version from a sibling SKILL.md (resolved via
  // import.meta.url, not cwd). The source tree has no SKILL.md, so we copy the
  // script into a scratch skill dir with a controlled version and run that.
  // Local version is pinned to 1.0.0; "newer" = 2.0.0, "older" = 0.0.1.
  const LOCAL_VERSION = '1.0.0';

  const cachePath = () => path.join(scratch, 'update-check.json');

  function setup(cacheObj, { disable = false, host } = {}) {
    const skillScript = path.join(scratch, 'skill', 'scripts', 'context.mjs');
    fs.mkdirSync(path.dirname(skillScript), { recursive: true });
    fs.copyFileSync(SCRIPT_PATH, skillScript);
    const targetArgsSrc = path.join(path.dirname(SCRIPT_PATH), 'lib', 'target-args.mjs');
    const targetArgsDest = path.join(path.dirname(skillScript), 'lib', 'target-args.mjs');
    fs.mkdirSync(path.dirname(targetArgsDest), { recursive: true });
    fs.copyFileSync(targetArgsSrc, targetArgsDest);
    fs.writeFileSync(
      path.join(scratch, 'skill', 'SKILL.md'),
      `---\nname: impeccable\nversion: ${LOCAL_VERSION}\n---\n\nbody\n`,
    );
    fs.writeFileSync(cachePath(), JSON.stringify(cacheObj));
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'PRODUCT.md'), '# Acme\n');
    const env = {
      ...process.env,
      IMPECCABLE_UPDATE_CACHE: cachePath(),
      IMPECCABLE_NO_UPDATE_CHECK: disable ? '1' : '',
      ...(host ? { IMPECCABLE_UPDATE_HOST: host } : {}),
    };
    return { skillScript, project, env };
  }

  // A fresh cache (lastCheck = now) skips the network poll, so cache-driven
  // tests stay synchronous and hermetic.
  function run(cacheObj, opts) {
    const { skillScript, project, env } = setup(cacheObj, opts);
    return spawnSync(process.execPath, [skillScript], { cwd: project, encoding: 'utf8', env });
  }

  // Async variant for the live-fetch tests: the stub server runs in THIS
  // process, so the runner must not block the event loop (spawnSync would
  // deadlock the loopback connection). spawn keeps the loop serving.
  function runAsync(cacheObj, opts) {
    const { skillScript, project, env } = setup(cacheObj, opts);
    return new Promise((resolve) => {
      const proc = spawn(process.execPath, [skillScript], { cwd: project, env });
      let stdout = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.on('exit', (status) => resolve({ status, stdout }));
    });
  }

  function readCache() {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  }

  it('appends UPDATE_AVAILABLE when the cached latest version is newer', () => {
    const res = run({ lastCheck: Date.now(), latestVersion: '2.0.0' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /UPDATE_AVAILABLE: A newer Impeccable skill is available/);
    assert.match(res.stdout, /installed v1\.0\.0, latest v2\.0\.0/);
    assert.match(res.stdout, /npx impeccable update/);
    // It must come after the real context, never replace it.
    assert.match(res.stdout, /^# PRODUCT\.md/);
  });

  it('stays silent when the cached latest version is not newer', () => {
    const res = run({ lastCheck: Date.now(), latestVersion: '0.0.1' });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.includes('UPDATE_AVAILABLE'), false);
  });

  it('does not re-surface a version notified within the last week', () => {
    const res = run({
      lastCheck: Date.now(),
      latestVersion: '2.0.0',
      notifiedVersion: '2.0.0',
      notifiedAt: Date.now(),
    });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.includes('UPDATE_AVAILABLE'), false);
  });

  it('respects IMPECCABLE_NO_UPDATE_CHECK', () => {
    const res = run({ lastCheck: Date.now(), latestVersion: '2.0.0' }, { disable: true });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.includes('UPDATE_AVAILABLE'), false);
  });

  // ─── live fetch path (against a localhost stub, never the real site) ──────
  function startStub(body, { status = 200 } = {}) {
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      });
      srv.listen(0, '127.0.0.1', () => resolve({ srv, host: `http://127.0.0.1:${srv.address().port}` }));
    });
  }

  it('polls /api/version over the network and caches a newer version', async () => {
    const { srv, host } = await startStub({ skills: '2.0.0' });
    try {
      const res = await runAsync({}, { host }); // empty cache forces the poll
      assert.equal(res.status, 0);
      assert.match(res.stdout, /UPDATE_AVAILABLE/);
      assert.match(res.stdout, /installed v1\.0\.0, latest v2\.0\.0/);
      const cache = readCache();
      assert.equal(cache.latestVersion, '2.0.0');
      assert.equal(typeof cache.lastCheck, 'number');
    } finally {
      srv.close();
    }
  });

  it('stays silent when the network reports a same-or-older version', async () => {
    const { srv, host } = await startStub({ skills: '1.0.0' });
    try {
      const res = await runAsync({}, { host });
      assert.equal(res.status, 0);
      assert.equal(res.stdout.includes('UPDATE_AVAILABLE'), false);
      // The poll still happened, so lastCheck is stamped to throttle the next.
      assert.equal(typeof readCache().lastCheck, 'number');
    } finally {
      srv.close();
    }
  });

  it('fails silent and stamps lastCheck when the endpoint is unreachable', async () => {
    // Bind then immediately close to obtain a port nothing is listening on.
    const { srv, host } = await startStub({ skills: '2.0.0' });
    await new Promise((r) => srv.close(r));
    const res = run({}, { host });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.includes('UPDATE_AVAILABLE'), false);
    assert.match(res.stdout, /^# PRODUCT\.md/); // core output is unaffected
    const cache = readCache();
    assert.equal(typeof cache.lastCheck, 'number'); // stamped so we don't re-poll every boot
    assert.equal(cache.latestVersion, undefined); // nothing learned
  });
});
