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
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadContext, resolveContextDir } from '../skill/scripts/context.mjs';

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
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^NO_PRODUCT_MD:/);
    assert.match(res.stdout, /reference\/teach\.md/);
  });

  it('prints a PRODUCT.md markdown block when only PRODUCT.md exists', async () => {
    write('PRODUCT.md', '# Acme\n\nbody\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
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
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /\n---\n/);
    assert.match(res.stdout, /# DESIGN\.md\n\n# Acme design/);
    assert.match(res.stdout, /NEXT STEP:/);
  });

  it('reads from a fallback dir when cwd is clean', async () => {
    write('.agents/context/PRODUCT.md', '# fallback product\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^# PRODUCT\.md/);
    assert.match(res.stdout, /# fallback product/);
  });

  it('names the register-specific reference when PRODUCT.md declares one', async () => {
    write('PRODUCT.md', '# Acme\n\n## Register\n\nbrand\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /NEXT STEP: This project's register is `brand`\./);
    assert.match(res.stdout, /read `reference\/brand\.md`/);
  });

  it('falls back to a generic register directive when no register field is present', async () => {
    write('PRODUCT.md', '# Acme\n\n(no register field)\n');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /NEXT STEP: You MUST now read the matching register reference/);
    assert.match(res.stdout, /reference\/brand\.md.*reference\/product\.md/);
  });
});
