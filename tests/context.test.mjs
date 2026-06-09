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
    assert.match(res.stdout, /npx impeccable skills update/);
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
