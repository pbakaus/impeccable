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

import { loadContext, resolveContextDir, resolveProjectRoot, extractPlatform, hasVisualImplementation } from '../skill/scripts/context.mjs';

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

// Stage a runnable copy of context.mjs plus its whole lib/ directory.
// The bundle tests used to enumerate the helpers they needed, which turned
// every new import in context.mjs into a mysterious non-zero exit here.
// Copying the directory keeps them honest about what the real script loads.
function stageContextBundle(scriptsDir, { providerId } = {}) {
  const libSrc = path.join(path.dirname(SCRIPT_PATH), 'lib');
  const libDest = path.join(scriptsDir, 'lib');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(SCRIPT_PATH, path.join(scriptsDir, 'context.mjs'));
  fs.cpSync(libSrc, libDest, { recursive: true });
  if (providerId) {
    const providerPath = path.join(libDest, 'provider.mjs');
    fs.writeFileSync(
      providerPath,
      fs.readFileSync(providerPath, 'utf8')
        .replace("IMPECCABLE_PROVIDER_ID = 'source'", `IMPECCABLE_PROVIDER_ID = '${providerId}'`),
    );
  }
  return path.join(scriptsDir, 'context.mjs');
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
    write('apps/dashboard/package.json', JSON.stringify({ name: 'dashboard' }, null, 2));
    write('apps/dashboard/src/App.jsx', 'export default null;\n');

    const before = loadContext(scratch, { targetPath: 'apps/dashboard/src/App.jsx' });
    assert.equal(before.projectRoot, scratch);
    assert.equal(before.isMonorepo, false);
    assert.match(before.product, /Root product/);

    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));

    const after = loadContext(scratch, { targetPath: 'apps/dashboard/src/App.jsx' });
    assert.equal(after.projectRoot, path.join(scratch, 'apps', 'dashboard'));
    assert.equal(after.isMonorepo, true);
    assert.match(after.product, /Root product/);
  });

  it('resolves an explicit target onto a nested product context in a non-monorepo repo', () => {
    write('nested/product/PRODUCT.md', '# Nested product\n');
    write('nested/product/DESIGN.md', '# Nested design\n');
    write('nested/product/file.ts', 'export const x = 1;\n');

    const ctx = loadContext(scratch, { targetPath: 'nested/product/file.ts' });
    assert.equal(ctx.isMonorepo, false);
    assert.equal(ctx.projectRoot, path.join(scratch, 'nested', 'product'));
    assert.equal(ctx.repoRoot, scratch);
    assert.match(ctx.product, /Nested product/);
    assert.match(ctx.design, /Nested design/);
    assert.equal(ctx.productPath, path.join('nested', 'product', 'PRODUCT.md'));
    assert.equal(ctx.designPath, path.join('nested', 'product', 'DESIGN.md'));
  });

  it('resolves a nested target whose context lives in .agents/context/', () => {
    write('nested/product/.agents/context/PRODUCT.md', '# Nested product\n');
    write('nested/product/file.ts', 'export const x = 1;\n');

    const ctx = loadContext(scratch, { targetPath: 'nested/product/file.ts' });
    assert.equal(ctx.isMonorepo, false);
    assert.equal(ctx.projectRoot, path.join(scratch, 'nested', 'product'));
    assert.match(ctx.product, /Nested product/);
    assert.equal(ctx.productPath, path.join('nested', 'product', '.agents', 'context', 'PRODUCT.md'));
  });

  it('resolves a nested target whose context lives in docs/', () => {
    write('nested/product/docs/DESIGN.md', '# Nested design\n');
    write('nested/product/file.ts', 'export const x = 1;\n');

    const ctx = loadContext(scratch, { targetPath: 'nested/product/file.ts' });
    assert.equal(ctx.isMonorepo, false);
    assert.equal(ctx.projectRoot, path.join(scratch, 'nested', 'product'));
    assert.match(ctx.design, /Nested design/);
    assert.equal(ctx.designPath, path.join('nested', 'product', 'docs', 'DESIGN.md'));
  });

  it('does not treat the root fallback context dirs as a nested product', () => {
    write('.agents/context/PRODUCT.md', '# Root product\n');
    write('.agents/context/notes/file.md', '# Notes\n');

    const ctx = loadContext(scratch, { targetPath: '.agents/context/notes/file.md' });
    assert.equal(ctx.projectRoot, scratch);
    assert.match(ctx.product, /Root product/);
  });

  it('inherits missing root context per-file for a nested target in a non-monorepo repo', () => {
    write('DESIGN.md', '# Root design\n');
    write('nested/product/PRODUCT.md', '# Nested product\n');
    write('nested/product/file.ts', 'export const x = 1;\n');

    const ctx = loadContext(scratch, { targetPath: 'nested/product/file.ts' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'nested', 'product'));
    assert.match(ctx.product, /Nested product/);
    assert.match(ctx.design, /Root design/);
    assert.equal(ctx.designPath, 'DESIGN.md');
  });

  it('keeps the repo root project for targets without nearby context files', () => {
    write('PRODUCT.md', '# Root product\n');
    write('src/App.jsx', 'export default null;\n');

    const ctx = loadContext(scratch, { targetPath: 'src/App.jsx' });
    assert.equal(ctx.isMonorepo, false);
    assert.equal(ctx.projectRoot, scratch);
    assert.match(ctx.product, /Root product/);
    assert.equal(ctx.productPath, 'PRODUCT.md');
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /MONOREPO_TARGET_REQUIRED/);
  });

  it('supports --target in the CLI', async () => {
    writeMonorepo();
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n\n## Platform\n\nweb\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'apps/dashboard/src/App.jsx'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# Dashboard product/);
    assert.match(res.stdout, /# DESIGN\.md\n\n# Root design/);
    assert.match(res.stdout, /RESOLVED_CONTEXT:/);
    assert.match(res.stdout, /"targetPath": "apps\/dashboard\/src\/App\.jsx"/);
    assert.match(res.stdout, /"productPath": "apps\/dashboard\/PRODUCT\.md"/);
    assert.match(res.stdout, /"designPath": "DESIGN\.md"/);
    assert.doesNotMatch(res.stdout, /REGISTER:/);
  });

  it('asks for an app when the CLI runs from a monorepo root without selection', () => {
    writeMonorepo();
    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /RESOLVED_CONTEXT:/);
    assert.match(res.stdout, /"targetExists": false/);
    assert.match(res.stdout, /MONOREPO_TARGET_REQUIRED/);
  });

  it('resolves a unique workspace child by bare basename via --target', () => {
    writeMonorepo();
    write('apps/dashboard/PRODUCT.md', '# Dashboard product\n\n## Platform\n\nweb\n');
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'dashboard'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /# Dashboard product/);
    assert.match(res.stdout, /"targetExists": true/);
    assert.match(res.stdout, /"targetPath": "dashboard"/);
    assert.doesNotMatch(res.stdout, /MONOREPO_TARGET_REQUIRED/);

    const ctx = loadContext(scratch, { targetPath: 'dashboard' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'apps', 'dashboard'));
  });

  it('resolves a dotted workspace child name by bare basename via --target', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['src/*'],
    }, null, 2));
    write('src/Cantaro.Web/PRODUCT.md', '# Cantaro Web product\n\n## Platform\n\nweb\n');
    write('src/Cantaro.Api/package.json', JSON.stringify({ name: 'cantaro-api' }));
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'Cantaro.Web'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /# Cantaro Web product/);
    assert.match(res.stdout, /"targetExists": true/);
    assert.match(res.stdout, /"targetPath": "Cantaro\.Web"/);

    const ctx = loadContext(scratch, { targetPath: 'Cantaro.Web' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'src', 'Cantaro.Web'));
  });

  it('does not guess when a bare basename matches multiple workspace children', () => {
    write('package.json', JSON.stringify({
      private: true,
      workspaces: ['apps/*', 'packages/*'],
    }, null, 2));
    write('turbo.json', JSON.stringify({ tasks: {} }));
    write('apps/web/src/App.jsx', 'export default null;\n');
    write('packages/web/src/index.ts', 'export {};\n');
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'web'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /"targetExists": false/);
    assert.match(res.stdout, /MONOREPO_TARGET_REQUIRED/);

    const ctx = loadContext(scratch, { targetPath: 'web' });
    assert.equal(ctx.projectRoot, scratch);
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
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /TARGET_SELECTION_REQUIRED:/);
    assert.match(res.stdout, /"path": "apps\/dashboard"/);
    assert.doesNotMatch(res.stdout, /^NO_PRODUCT_MD:/);
  });
});

describe('loadContext (impeccable projectRoots config)', () => {
  function writeSkinsConfig(extra = {}) {
    write('.impeccable/config.json', JSON.stringify({ projectRoots: ['docs/design/skins/*'], ...extra }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
  }

  it('treats a config-declared context root as a monorepo with no package-manager files', () => {
    writeSkinsConfig();
    write('docs/design/skins/neon-seoul/DESIGN.md', '# Neon Seoul design\n');

    const ctx = loadContext(scratch, { targetPath: 'docs/design/skins/neon-seoul' });
    assert.equal(ctx.isMonorepo, true);
    assert.equal(ctx.projectRoot, path.join(scratch, 'docs', 'design', 'skins', 'neon-seoul'));
    assert.equal(ctx.repoRoot, scratch);
    // The skin uses its own DESIGN.md and inherits the root PRODUCT.md per file.
    assert.match(ctx.design, /Neon Seoul design/);
    assert.match(ctx.product, /Root product/);
    assert.equal(ctx.designPath, path.join('docs', 'design', 'skins', 'neon-seoul', 'DESIGN.md'));
    assert.equal(ctx.productPath, 'PRODUCT.md');
  });

  it('resolves a config-declared child from cwd inside the folder', () => {
    writeSkinsConfig();
    write('docs/design/skins/marble/DESIGN.md', '# Marble design\n');

    const skinDir = path.join(scratch, 'docs', 'design', 'skins', 'marble');
    const ctx = loadContext(skinDir);
    assert.equal(ctx.isMonorepo, true);
    assert.equal(ctx.projectRoot, skinDir);
    assert.match(ctx.design, /Marble design/);
    assert.match(ctx.product, /Root product/);
  });

  it('extends shared projectRoots with config.local.json', () => {
    write('.impeccable/config.json', JSON.stringify({ projectRoots: ['docs/design/skins/*'] }, null, 2));
    write('.impeccable/config.local.json', JSON.stringify({ projectRoots: ['experiments/*'] }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('experiments/wip/DESIGN.md', '# WIP design\n');

    const ctx = loadContext(scratch, { targetPath: 'experiments/wip' });
    assert.equal(ctx.projectRoot, path.join(scratch, 'experiments', 'wip'));
    assert.match(ctx.design, /WIP design/);
    assert.match(ctx.product, /Root product/);
  });

  it('does not treat an .impeccable config without projectRoots as a monorepo', () => {
    write('.impeccable/config.json', JSON.stringify({ hook: { consent: 'accepted' } }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('docs/design/skins/marble/DESIGN.md', '# Marble design\n');

    const ctx = loadContext(scratch, { targetPath: 'docs/design/skins/marble' });
    assert.equal(ctx.isMonorepo, false);
  });

  it('asks for app selection from a config-declared monorepo root', () => {
    write('.impeccable/config.json', JSON.stringify({ projectRoots: ['docs/design/skins/*'] }, null, 2));
    write('PRODUCT.md', '# Root product\n');
    write('DESIGN.md', '# Root design\n');
    write('docs/design/skins/neon-seoul/DESIGN.md', '# Neon Seoul\n');
    write('docs/design/skins/marble/DESIGN.md', '# Marble\n');

    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    const selection = parseTargetSelection(res.stdout);
    const paths = selection.targetCandidates.map((candidate) => candidate.path).sort();
    assert.deepEqual(paths, ['docs/design/skins/marble', 'docs/design/skins/neon-seoul']);
  });

  // Composition with package-manager workspaces: a path matched by any
  // projectRoots pattern (positive or negated) is governed by the impeccable
  // config alone; package-manager patterns fill in the paths it does not match.
  describe('composition with package-manager workspaces', () => {
    function selectionPaths() {
      const res = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: scratch,
        encoding: 'utf8',
        env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
      });
      assert.equal(res.status, 0, res.stderr);
      const selection = parseTargetSelection(res.stdout);
      return selection.targetCandidates.map((candidate) => candidate.path).sort();
    }

    it('lets an impeccable negation exclude a package-manager workspace', () => {
      write('package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }, null, 2));
      write('.impeccable/config.json', JSON.stringify({ projectRoots: ['!apps/internal'] }, null, 2));
      write('PRODUCT.md', '# Root product\n');
      write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
      write('apps/internal/PRODUCT.md', '# Internal product\n');

      const ctx = loadContext(scratch, { targetPath: 'apps/internal' });
      assert.equal(ctx.isMonorepo, true);
      assert.equal(ctx.projectRoot, scratch);
      assert.match(ctx.product, /Root product/);
      assert.deepEqual(selectionPaths(), ['apps/dashboard']);
    });

    it('keeps a package-manager negation scoped to its own source', () => {
      write('package.json', JSON.stringify({
        private: true,
        workspaces: ['apps/*', '!docs/design/skins/marble'],
      }, null, 2));
      write('.impeccable/config.json', JSON.stringify({ projectRoots: ['docs/design/skins/*'] }, null, 2));
      write('PRODUCT.md', '# Root product\n');
      write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
      write('docs/design/skins/marble/DESIGN.md', '# Marble design\n');

      const ctx = loadContext(scratch, { targetPath: 'docs/design/skins/marble' });
      assert.equal(ctx.projectRoot, path.join(scratch, 'docs', 'design', 'skins', 'marble'));
      assert.match(ctx.design, /Marble design/);
      assert.deepEqual(selectionPaths(), ['apps/dashboard', 'docs/design/skins/marble']);
    });

    it('gives a broad impeccable pattern the boundary over a deeper package workspace', () => {
      write('package.json', JSON.stringify({ private: true, workspaces: ['apps/web/packages/ui'] }, null, 2));
      write('.impeccable/config.json', JSON.stringify({ projectRoots: ['apps/*'] }, null, 2));
      write('PRODUCT.md', '# Root product\n');
      write('apps/web/PRODUCT.md', '# Web product\n');
      write('apps/web/packages/ui/PRODUCT.md', '# UI product\n');
      write('apps/web/packages/ui/src/Button.jsx', 'export default null;\n');

      const ctx = loadContext(scratch, { targetPath: 'apps/web/packages/ui/src/Button.jsx' });
      assert.equal(ctx.projectRoot, path.join(scratch, 'apps', 'web'));
      assert.match(ctx.product, /Web product/);
      // The subsumed package workspace must not appear as its own pick:
      // choosing it would silently resolve to apps/web.
      assert.deepEqual(selectionPaths(), ['apps/web']);
    });

    it('falls through to package workspaces for paths impeccable does not match', () => {
      write('package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }, null, 2));
      write('.impeccable/config.json', JSON.stringify({ projectRoots: ['docs/design/skins/*'] }, null, 2));
      write('PRODUCT.md', '# Root product\n');
      write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
      write('docs/design/skins/marble/DESIGN.md', '# Marble design\n');

      const ctx = loadContext(scratch, { targetPath: 'apps/dashboard' });
      assert.equal(ctx.projectRoot, path.join(scratch, 'apps', 'dashboard'));
      assert.match(ctx.product, /Dashboard product/);
    });

    it('resolves other workspaces normally when impeccable config only negates', () => {
      write('package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }, null, 2));
      write('.impeccable/config.json', JSON.stringify({ projectRoots: ['!apps/internal'] }, null, 2));
      write('PRODUCT.md', '# Root product\n');
      write('apps/dashboard/PRODUCT.md', '# Dashboard product\n');
      write('apps/internal/PRODUCT.md', '# Internal product\n');

      const ctx = loadContext(scratch, { targetPath: 'apps/dashboard' });
      assert.equal(ctx.isMonorepo, true);
      assert.equal(ctx.projectRoot, path.join(scratch, 'apps', 'dashboard'));
      assert.match(ctx.product, /Dashboard product/);
    });
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

describe('extractPlatform', () => {
  it('returns null when the product is empty or platform-less', () => {
    assert.equal(extractPlatform(null), null);
    assert.equal(extractPlatform('# P\n\nno platform here\n'), null);
  });

  it('reads web / ios / android / adaptive case-insensitively', () => {
    assert.equal(extractPlatform('## Platform\n\nweb\n'), 'web');
    assert.equal(extractPlatform('## Platform\n\nios\n'), 'ios');
    assert.equal(extractPlatform('## platform\n\nANDROID\n'), 'android');
    assert.equal(extractPlatform('## Platform\n\nAdaptive\n'), 'adaptive');
  });

  it('reads a line naming both native targets as adaptive', () => {
    assert.equal(extractPlatform('## Platform\n\nios, android\n'), 'adaptive');
    assert.equal(extractPlatform('## Platform\n\nandroid and ios\n'), 'adaptive');
    assert.equal(extractPlatform('## Platform\n\nios/android\n'), 'adaptive');
  });

  it('does not read prose mentioning both targets as adaptive', () => {
    // Negations and explanations must fall through to the unrecognized-value
    // warning, never silently classify as cross-platform native.
    assert.equal(extractPlatform('## Platform\n\nweb only, not ios or android\n'), null);
    assert.equal(extractPlatform('## Platform\n\nios first, android later this year\n'), null);
  });

  it('returns null for an unrecognized value', () => {
    assert.equal(extractPlatform('## Platform\n\ndesktop\n'), null);
    assert.equal(extractPlatform('## Platform\n\nflutter\n'), null);
  });

  it('ignores a near-miss heading and reads the real one', () => {
    // `## Platform notes` must not be mistaken for the `## Platform` field.
    const product = '## Platform notes\n\nsome prose here\n\n## Platform\n\nios\n';
    assert.equal(extractPlatform(product), 'ios');
  });

  it('reads the first non-empty line after the heading', () => {
    assert.equal(extractPlatform('## Platform\n\n\nios\n'), 'ios');
  });

  it('treats an empty section followed by another heading as absent', () => {
    // An empty `## Platform` must not swallow the next heading as its value
    // (which would surface a nonsense "value `## Product Purpose` is not
    // recognized" warning from the CLI).
    assert.equal(extractPlatform('## Platform\n\n## Product Purpose\n\nAn app.\n'), null);
  });
});

describe('context.mjs CLI', () => {
  it('emits NO_PRODUCT_MD directive when no PRODUCT.md is found', async () => {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^NO_PRODUCT_MD:/);
    assert.match(res.stdout, /reference\/init\.md/);
    assert.match(res.stdout, /structured simulated-user interview/);
    assert.match(res.stdout, /PRODUCT_INIT_REQUIRED:/);
  });

  it('prints a PRODUCT.md markdown block when only PRODUCT.md exists', async () => {
    write('PRODUCT.md', '# Acme\n\nbody\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /# Acme/);
    assert.equal(res.stdout.includes('# DESIGN.md'), false);
    // Directives are appended after `---`; missing visual authority now
    // routes to new-work rather than back through product init.
    assert.match(res.stdout, /\n---\n\n/);
    assert.match(res.stdout, /WORLD_DISCOVERY_REQUIRED: PRODUCT\.md exists but no DESIGN\.md/);
    assert.match(res.stdout, /MANUAL_DETECTOR_REQUIRED:/);
    assert.match(res.stdout, /detect\.mjs --json <changed targets>/);
  });

  it('drains stdout before exit when the parent pipe is paused', async () => {
    const MARKER = 'END_MARKER_573';
    write('PRODUCT.md', `# Acme\n\n${'x'.repeat(256 * 1024)}\n\n${MARKER}\n`);
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stdout.pause();
    const resume = setTimeout(() => child.stdout.resume(), 100);
    const status = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    clearTimeout(resume);
    assert.equal(status, 0);
    assert.match(stdout, /END_MARKER_573/);
    assert.match(stdout, /RESOLVED_CONTEXT:/);
  });

  // The build-path preference rides the unified config beside hook and
  // detector settings. The local file wins because whether a machine can
  // generate images is a property of that machine, not of the committed
  // default the rest of the team shares.
  describe('BUILD_PATH_DEFAULT', () => {
    const run = () => spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });

    it('reports a recorded preference from the shared config', () => {
      write('PRODUCT.md', '# Acme\n');
      write('.impeccable/config.json', JSON.stringify({ buildPath: 'code' }));
      assert.match(run().stdout, /BUILD_PATH_DEFAULT: code \(from \.impeccable\/config\.json\)/);
    });

    it('lets the gitignored local config win over the committed one', () => {
      write('PRODUCT.md', '# Acme\n');
      write('.impeccable/config.json', JSON.stringify({ buildPath: 'comp' }));
      write('.impeccable/config.local.json', JSON.stringify({ buildPath: 'code' }));
      assert.match(run().stdout, /BUILD_PATH_DEFAULT: code \(from \.impeccable\/config\.local\.json\)/);
    });

    it('stays silent when nothing is recorded, leaving new-work its own default', () => {
      write('PRODUCT.md', '# Acme\n');
      assert.equal(run().stdout.includes('BUILD_PATH_DEFAULT'), false);
    });

    it('stays silent on a value nothing reads rather than guessing at it', () => {
      write('PRODUCT.md', '# Acme\n');
      write('.impeccable/config.json', JSON.stringify({ buildPath: 'code-first' }));
      assert.equal(run().stdout.includes('BUILD_PATH_DEFAULT'), false);
    });

    // A monorepo commits the preference once at the repo root for every app in
    // it. Reading only projectRoot left the staleness finding (which does read
    // both) silent while the directive never named the value.
    describe('in a monorepo', () => {
      const writeWorkspace = () => {
        write('package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }));
        write('turbo.json', JSON.stringify({ tasks: {} }));
        write('PRODUCT.md', '# Root product\n');
        write('apps/dashboard/src/App.jsx', 'export default function App() { return "d"; }\n');
      };
      const runFromWorkspace = () => spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'apps/dashboard/src/App.jsx'], {
        cwd: scratch,
        encoding: 'utf8',
        env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
      });

      it('falls back to the repo-root value for a workspace that sets none', () => {
        writeWorkspace();
        write('.impeccable/config.json', JSON.stringify({ buildPath: 'code' }));
        assert.match(runFromWorkspace().stdout, /BUILD_PATH_DEFAULT: code/);
      });

      it('lets the workspace override the repo root, nearest root first', () => {
        writeWorkspace();
        write('.impeccable/config.json', JSON.stringify({ buildPath: 'code' }));
        write('apps/dashboard/.impeccable/config.json', JSON.stringify({ buildPath: 'comp' }));
        assert.match(runFromWorkspace().stdout, /BUILD_PATH_DEFAULT: comp/);
      });

      // Running from one workspace while targeting another must not hand the
      // target the caller's preference. The invoking directory is not evidence
      // about the project being worked on.
      it('does not let the invoking workspace lend its value to the target', () => {
        writeWorkspace();
        write('apps/marketing/src/App.jsx', 'export default function App() { return "m"; }\n');
        write('.impeccable/config.json', JSON.stringify({ buildPath: 'code' }));
        write('apps/marketing/.impeccable/config.json', JSON.stringify({ buildPath: 'comp' }));
        // Absolute, so the target actually resolves onto dashboard. A relative
        // path would be read against the caller's cwd, which resolves the
        // project back to marketing and tests nothing.
        const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', path.join(scratch, 'apps', 'dashboard', 'src', 'App.jsx')], {
          cwd: path.join(scratch, 'apps', 'marketing'),
          encoding: 'utf8',
          env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
        });
        // The repo-root default, not marketing's comp.
        assert.match(res.stdout, /BUILD_PATH_DEFAULT: code/);
      });
    });
  });

  it('keeps the manual-detector directive out of early context when the current provider hook is active', () => {
    const scripts = path.join(scratch, 'bundle', 'skills', 'impeccable', 'scripts');
    stageContextBundle(scripts, { providerId: 'codex' });

    const project = path.join(scratch, 'project');
    fs.mkdirSync(path.join(project, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(project, 'PRODUCT.md'), '# Acme\n');
    fs.writeFileSync(path.join(project, '.codex', 'hooks.json'), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: 'node .agents/skills/impeccable/scripts/hook.mjs' }] }] },
    }));

    const res = spawnSync(process.execPath, [path.join(scripts, 'context.mjs')], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /MANUAL_DETECTOR_REQUIRED:/);

    fs.mkdirSync(path.join(project, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(project, '.impeccable', 'config.json'), JSON.stringify({ hook: { enabled: false } }));
    const disabled = spawnSync(process.execPath, [path.join(scripts, 'context.mjs')], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.match(disabled.stdout, /MANUAL_DETECTOR_REQUIRED:/);
    assert.match(disabled.stdout, /detect\.mjs --json <changed targets>/);
  });

  it('adds no detector directive when a per-edit-only hook is active', () => {
    const scripts = path.join(scratch, 'bundle', 'skills', 'impeccable', 'scripts');
    stageContextBundle(scripts, { providerId: 'cursor' });

    const project = path.join(scratch, 'project');
    fs.mkdirSync(path.join(project, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(project, 'PRODUCT.md'), '# Acme\n');
    fs.writeFileSync(path.join(project, '.cursor', 'hooks.json'), JSON.stringify({
      hooks: { preToolUse: [{ command: 'node .cursor/skills/impeccable/scripts/hook-before-edit.mjs' }] },
    }));

    const res = spawnSync(process.execPath, [path.join(scripts, 'context.mjs')], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /MANUAL_DETECTOR_REQUIRED:/);
    assert.doesNotMatch(res.stdout, /detect\.mjs --json <changed targets>/);
  });

  it('treats tokenized code as incumbent design authority when DESIGN.md is missing', () => {
    write('PRODUCT.md', '# Acme\n');
    write('src/app.css', ':root { --color-brand: red; --color-surface: white; --color-text: black; }\nbody { font-family: system-ui; background: var(--color-surface); color: var(--color-text); }\n');
    assert.equal(hasVisualImplementation(scratch), true);
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /INCUMBENT_WORLD_UNDOCUMENTED:/);
    assert.match(res.stdout, /For shape or a new-surface\/redesign request, load reference\/new-work\.md/);
    assert.doesNotMatch(res.stdout, /WORLD_DISCOVERY_REQUIRED:/);
    assert.match(res.stdout, /"hasVisualImplementation": true/);
  });

  it('does not mistake the empty Astro eval scaffold for an incumbent identity', () => {
    write('src/styles/global.css', '@import "tailwindcss";\n');
    write('src/pages/index.astro', `---\nimport "../styles/global.css";\n---\n<!doctype html><html><head><title>Eval Workspace</title></head><body></body></html>\n`);
    assert.equal(hasVisualImplementation(scratch), false);
  });

  it('recognizes one substantive authored Astro surface', () => {
    write('src/pages/index.astro', `<main class="shell"><h1>Field notes for the night shift</h1><p>Specific authored content.</p></main>\n<style>\n:root { --ink: #111; --paper: #fff; --accent: #c40; }\n.shell { color: var(--ink); background-color: var(--paper); border-color: var(--accent); font-family: serif; padding: 4rem; min-height: 100vh; }\n</style>\n`);
    assert.equal(hasVisualImplementation(scratch), true);
  });

  it('does not let irrelevant or vendored files exhaust or satisfy the visual scan', () => {
    for (let i = 0; i < 300; i++) write(`src/data/item-${String(i).padStart(3, '0')}.txt`, 'not visual\n');
    write('public/vendor/framework.min.css', ':root { --a: 1; --b: 2; --c: 3; } body { color: red; background: blue; border-color: green; font-family: sans-serif; }\n');
    write('styles/z-theme.css', ':root { --brand: #124; --surface: #fff; --text: #111; } main { color: var(--text); background-color: var(--surface); border-color: var(--brand); }\n');
    assert.equal(hasVisualImplementation(scratch), true);
  });

  it('routes new surfaces through init but keeps narrow refinements non-blocking when visual code exists without PRODUCT.md', () => {
    write('styles/theme.css', ':root { --brand: #124; --surface: #fff; --text: #111; }\nmain { color: var(--text); background-color: var(--surface); border-color: var(--brand); }\n');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^NO_PRODUCT_MD:/);
    assert.match(res.stdout, /EXISTING_VISUAL_SYSTEM:/);
    assert.match(res.stdout, /BUILD_INIT_REQUIRED:/);
    assert.match(res.stdout, /SCOPED_EXISTING_ALLOWED:/);
    assert.match(res.stdout, /proceed without blocking/);
    assert.match(res.stdout, /For `init`, `teach`, `shape`, or any request to create a new surface/);
    assert.match(res.stdout, /For a redesign\/rebrand.*old look only as evidence and anti-reference/s);
    assert.doesNotMatch(res.stdout, /WORLD_DISCOVERY_REQUIRED:/);
  });

  it('prints DESIGN.md even when PRODUCT.md is missing', () => {
    // The skill resumes after init writes PRODUCT.md without rerunning this
    // script, so a DESIGN.md withheld from the no-PRODUCT.md branch is never
    // seen at all. Emit incumbent visual authority on both branches.
    write('DESIGN.md', '# Acme design\n\nUNIQUE_DESIGN_MARKER\n');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^NO_PRODUCT_MD:/);
    assert.match(res.stdout, /# DESIGN\.md\n\n# Acme design/);
    assert.match(res.stdout, /UNIQUE_DESIGN_MARKER/);
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
    assert.equal(res.stdout.includes('WORLD_DISCOVERY_REQUIRED:'), false);
  });

  it('loads the only persisted surface brief as current task context', () => {
    write('PRODUCT.md', '# Acme product\n');
    write('DESIGN.md', '# Acme design\n');
    write('.impeccable/surfaces/src-pages-pricing-astro.md', `---
version: 1
slug: "src-pages-pricing-astro"
primary_target: "src/pages/pricing.astro"
related_targets: []
---

# Surface brief: Pricing

## Product strategy
Make plan tradeoffs legible before asking for a trial.
`);
    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# SURFACE BRIEF \(\.impeccable\/surfaces\/src-pages-pricing-astro\.md\)/);
    assert.match(res.stdout, /Make plan tradeoffs legible/);
    assert.match(res.stdout, /"surfaceBriefReason": "only-brief"/);
  });

  it('selects a surface brief by an exact primary or related target', () => {
    write('PRODUCT.md', '# Acme product\n');
    write('DESIGN.md', '# Acme design\n');
    write('src/pages/pricing.astro', '<main>Pricing</main>\n');
    write('.impeccable/surfaces/src-pages-pricing-astro.md', `---
version: 1
slug: "src-pages-pricing-astro"
primary_target: "src/pages/pricing.astro"
related_targets: ["src/components/PricingTable.astro"]
---

# Surface brief: Pricing

PRICING_STRATEGY_SENTINEL
`);
    write('.impeccable/surfaces/src-pages-home-astro.md', `---
version: 1
slug: "src-pages-home-astro"
primary_target: "src/pages/home.astro"
related_targets: []
---

# Surface brief: Home

HOME_STRATEGY_SENTINEL
`);
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', 'src/pages/pricing.astro'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /PRICING_STRATEGY_SENTINEL/);
    assert.doesNotMatch(res.stdout, /HOME_STRATEGY_SENTINEL/);
  });

  it('lists candidates instead of guessing when several surface briefs exist', () => {
    write('PRODUCT.md', '# Acme product\n');
    write('DESIGN.md', '# Acme design\n');
    for (const [slug, target] of [
      ['src-pages-pricing-astro', 'src/pages/pricing.astro'],
      ['src-pages-home-astro', 'src/pages/home.astro'],
    ]) {
      write(`.impeccable/surfaces/${slug}.md`, `---
version: 1
slug: "${slug}"
primary_target: "${target}"
related_targets: []
---

# Surface brief: ${slug}
`);
    }
    const res = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_STALENESS_CHECK: '1' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /SURFACE_CONTEXT_AVAILABLE:/);
    assert.match(res.stdout, /src\/pages\/pricing\.astro/);
    assert.match(res.stdout, /src\/pages\/home\.astro/);
    assert.doesNotMatch(res.stdout, /# SURFACE BRIEF \(/);
  });

  it('reads from a fallback dir when cwd is clean', async () => {
    write('.agents/context/PRODUCT.md', '# fallback product\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /# fallback product/);
  });

  it('ignores a legacy Register field because visitor mode is task-scoped', async () => {
    write('PRODUCT.md', '# Acme\n\n## Register\n\nbrand\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /REGISTER:/);
    assert.match(res.stdout, /WORLD_DISCOVERY_REQUIRED: PRODUCT\.md exists but no DESIGN\.md/);
  });

  it('loads the native platform reference for an ios project', async () => {
    write('PRODUCT.md', '# Acme\n\n## Platform\n\nios\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# NATIVE PLATFORM REFERENCE: IOS \(reference\/ios\.md\)/);
    assert.match(res.stdout, /Apple Human Interface Guidelines|iOS/i);
    assert.doesNotMatch(res.stdout, /NEXT STEP:.*reference\/ios\.md/);
  });

  it('loads both native platform references for an adaptive project', async () => {
    write('PRODUCT.md', '# Acme\n\n## Platform\n\nadaptive\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# NATIVE PLATFORM REFERENCE: IOS \(reference\/ios\.md\)/);
    assert.match(res.stdout, /# NATIVE PLATFORM REFERENCE: ANDROID \(reference\/android\.md\)/);
  });

  it('appends no native platform directive for a web project', async () => {
    write('PRODUCT.md', '# Acme\n\n## Platform\n\nweb\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.includes('This project targets'), false);
    assert.equal(res.stdout.includes('reference/ios.md'), false);
  });

  it('loads the native platform reference for an android project', async () => {
    write('PRODUCT.md', '# Acme\n\n## Platform\n\nandroid\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# NATIVE PLATFORM REFERENCE: ANDROID \(reference\/android\.md\)/);
    assert.match(res.stdout, /Material Design|Android/i);
  });

  it('warns on an unrecognized platform value instead of silently defaulting to web', async () => {
    // The likeliest misconfiguration is a toolchain name where the target
    // belongs. Silent fallback to web would give web guidance to the exact
    // projects that tried to declare themselves native.
    write('PRODUCT.md', '# Acme\n\n## Platform\n\nflutter\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /WARNING: PRODUCT\.md's `## Platform` value `flutter` is not recognized/);
    assert.match(res.stdout, /treating the project as `web`/);
    assert.equal(res.stdout.includes('This project targets'), false);
  });

  it('emits no warning for an empty Platform section', async () => {
    write('PRODUCT.md', '# Acme\n\n## Platform\n\n## Users\n\nAnglers.\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8', env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' } });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.includes('WARNING: PRODUCT.md'), false);
    assert.equal(res.stdout.includes('This project targets'), false);
  });
});

describe('context.mjs update check', () => {
  // The script reads its own version from a sibling SKILL.md (resolved via
  // import.meta.url, not cwd). The source tree has no SKILL.md, so we copy the
  // script into a scratch skill dir with a controlled version and run that.
  // Local version is pinned to 1.0.0; "newer" = 2.0.0, "older" = 0.0.1.
  const LOCAL_VERSION = '1.0.0';

  const cachePath = () => path.join(scratch, 'update-check.json');

  function setup(cacheObj, { disable = false, host, skillFrontmatter } = {}) {
    const skillScript = stageContextBundle(path.join(scratch, 'skill', 'scripts'));
    fs.writeFileSync(
      path.join(scratch, 'skill', 'SKILL.md'),
      `---\n${skillFrontmatter || `name: impeccable\nversion: ${LOCAL_VERSION}`}\n---\n\nbody\n`,
    );
    fs.writeFileSync(cachePath(), JSON.stringify(cacheObj));
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'PRODUCT.md'), '# Acme\n');
    const env = {
      ...process.env,
      IMPECCABLE_UPDATE_CACHE: cachePath(),
      IMPECCABLE_NO_UPDATE_CHECK: disable ? '1' : '',
      // This suite asserts on the update directive alone. Staleness findings
      // are a separate directive with their own tests, and leaving the check on
      // would also write notice state into the developer's home dir.
      IMPECCABLE_NO_STALENESS_CHECK: '1',
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

  it('reads metadata.version and prefers it over the legacy top-level key', () => {
    const metadataOnly = run(
      { lastCheck: Date.now(), latestVersion: '2.0.0' },
      { skillFrontmatter: `name: impeccable\nmetadata:\n  version: ${LOCAL_VERSION}` },
    );
    assert.equal(metadataOnly.status, 0);
    assert.match(metadataOnly.stdout, /installed v1\.0\.0, latest v2\.0\.0/);

    const both = run(
      { lastCheck: Date.now(), latestVersion: '2.0.0' },
      { skillFrontmatter: `name: impeccable\nversion: 9.0.0\nmetadata:\n  version: ${LOCAL_VERSION}` },
    );
    assert.equal(both.status, 0);
    assert.match(both.stdout, /installed v1\.0\.0, latest v2\.0\.0/);
  });

  // The directive used to say "ask once" and "if they agree, run it" while also
  // saying to continue without waiting. Nothing gated the run on an answer that
  // could not arrive, so the command read as the next step. It now forbids
  // running in this turn outright, whatever the answer.
  it('forbids running the update in the same turn, on any answer', () => {
    const { stdout } = run({ lastCheck: Date.now(), latestVersion: '2.0.0' });
    assert.match(stdout, /Do not run `npx impeccable update` in this turn, whatever the user answers/);
    assert.match(stdout, /only after the user has asked for it in their own words/);
    // The conditional that made the command look reachable must be gone.
    assert.equal(/If they agree, run/.test(stdout), false);
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

  // Targeted live-fetch boot: the Windows abort in issue #573 fired after
  // stdout was already complete, so the contract is exit 0 with the full
  // context still on stdout.
  it('exits 0 after a targeted live-fetch boot writes full context', async () => {
    const { srv, host } = await startStub({ skills: '2.0.0' });
    try {
      const { skillScript, project, env } = setup({}, { host });
      fs.writeFileSync(
        path.join(project, 'package.json'),
        JSON.stringify({ private: true, workspaces: ['packages/*'] }),
      );
      const jervPi = path.join(project, 'packages', 'jerv-pi');
      fs.mkdirSync(jervPi, { recursive: true });
      fs.writeFileSync(path.join(jervPi, 'PRODUCT.md'), '# Jerv Pi product\n');

      const result = await new Promise((resolveRun, rejectRun) => {
        const child = spawn(process.execPath, [skillScript, '--target', 'packages/jerv-pi'], {
          cwd: project,
          env,
        });
        let stdout = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.on('error', rejectRun);
        child.on('close', (status) => resolveRun({ status, stdout }));
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /RESOLVED_CONTEXT:/);
      assert.match(result.stdout, /# Jerv Pi product/);
      assert.match(result.stdout, /UPDATE_AVAILABLE/);
    } finally {
      srv.close();
    }
  });
});
