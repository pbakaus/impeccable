/**
 * Tests for the shared context loader (PRODUCT.md / DESIGN.md resolver).
 * Run with: node --test tests/load-context.test.mjs
 *
 * Covers the resolution order added for issue #119:
 *   1. IMPECCABLE_CONTEXT_DIR env var (absolute or relative)
 *   2. cwd, when canonical or legacy files are at the root (back-compat)
 *   3. Auto-fallback to .agents/context/ then docs/
 *   4. Default to cwd when nothing is found
 *
 * Each test runs in its own scratch dir under os.tmpdir() so the suite stays
 * independent of the project root and parallel-safe.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadContext, resolveContextDir } from '../skill/scripts/load-context.mjs';

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

describe('resolveContextDir', () => {
  it('returns cwd when PRODUCT.md is at the root', () => {
    write('PRODUCT.md');
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('returns cwd when DESIGN.md is at the root', () => {
    write('DESIGN.md');
    assert.equal(resolveContextDir(scratch), scratch);
  });

  it('returns cwd when only legacy .impeccable.md is at the root', () => {
    write('.impeccable.md');
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

  it('honors IMPECCABLE_CONTEXT_DIR with a relative path', () => {
    write('design/PRODUCT.md');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    assert.equal(resolveContextDir(scratch), path.join(scratch, 'design'));
  });

  it('honors IMPECCABLE_CONTEXT_DIR with an absolute path', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-elsewhere-'));
    try {
      process.env.IMPECCABLE_CONTEXT_DIR = elsewhere;
      assert.equal(resolveContextDir(scratch), elsewhere);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('IMPECCABLE_CONTEXT_DIR wins even when files exist at the root', () => {
    write('PRODUCT.md', 'root');
    write('design/PRODUCT.md', 'overridden');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    assert.equal(resolveContextDir(scratch), path.join(scratch, 'design'));
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

describe('loadContext (backward compatibility)', () => {
  it('reads PRODUCT.md and DESIGN.md from the root the same way as before', () => {
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

  it('migrates legacy .impeccable.md -> PRODUCT.md at root', () => {
    write('.impeccable.md', '# legacy body\n');
    const ctx = loadContext(scratch);
    assert.equal(ctx.migrated, true);
    assert.equal(ctx.hasProduct, true);
    assert.match(ctx.product, /legacy body/);
    assert.ok(fs.existsSync(path.join(scratch, 'PRODUCT.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.impeccable.md')));
  });
});

describe('loadContext (fallback dirs)', () => {
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
    assert.equal(ctx.migrated, false);
  });

  it('reads from docs/ when .agents/context/ is empty', () => {
    write('docs/PRODUCT.md', '# product in docs\n');
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, true);
    assert.equal(ctx.contextDir, path.join(scratch, 'docs'));
    assert.equal(ctx.productPath, path.join('docs', 'PRODUCT.md'));
  });

  it('does not auto-migrate .impeccable.md inside fallback dirs', () => {
    write('docs/.impeccable.md', '# legacy in docs\n');
    const ctx = loadContext(scratch);
    // .impeccable.md inside a fallback dir doesn't pull the lookup there,
    // and we never auto-rename outside the cwd root.
    assert.equal(ctx.hasProduct, false);
    assert.equal(ctx.migrated, false);
    assert.ok(fs.existsSync(path.join(scratch, 'docs', '.impeccable.md')));
  });
});

describe('loadContext (IMPECCABLE_CONTEXT_DIR override)', () => {
  it('reads from the override path when set', () => {
    write('design/PRODUCT.md', '# overridden product\n');
    write('design/DESIGN.md', '# overridden design\n');
    process.env.IMPECCABLE_CONTEXT_DIR = 'design';
    const ctx = loadContext(scratch);
    assert.equal(ctx.hasProduct, true);
    assert.equal(ctx.hasDesign, true);
    assert.match(ctx.product, /overridden product/);
    assert.equal(ctx.contextDir, path.join(scratch, 'design'));
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
