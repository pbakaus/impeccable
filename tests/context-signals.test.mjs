/**
 * Tests for context-signals.mjs — the signal gatherer behind the
 * context-aware bare `/impeccable` (no-argument) path.
 *
 * The script collects deterministic project signals and emits JSON; it does
 * not score or rank (the agent reasons over the raw signals). These tests
 * cover signal collection and the never-throw / always-valid-JSON contract.
 *
 * Each test runs in its own scratch dir under os.tmpdir().
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { gatherSignals } from '../skill/scripts/context-signals.mjs';

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'skill', 'scripts', 'context-signals.mjs',
);

let scratch;
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-signals-'));
});
afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function write(rel, body) {
  const abs = path.join(scratch, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

describe('gatherSignals', () => {
  it('reports no setup context in an empty dir', async () => {
    const s = await gatherSignals(scratch);
    assert.equal(s.setup.hasProduct, false);
    assert.equal(s.setup.hasDesign, false);
    assert.equal(s.setup.register, null);
    assert.equal(s.setup.hasCode, false);
    assert.equal(s.critique.latest, null);
  });

  it('detects PRODUCT.md, register, and code presence', async () => {
    write('PRODUCT.md', '# Product\n\n## Register\n\nbrand\n');
    write('package.json', '{"name":"x"}');
    const s = await gatherSignals(scratch);
    assert.equal(s.setup.hasProduct, true);
    assert.equal(s.setup.register, 'brand');
    assert.equal(s.setup.hasCode, true);
  });

  it('flags missing DESIGN.md when code exists', async () => {
    write('PRODUCT.md', '# Product\n\n## Register\n\nproduct\n');
    write('src/App.tsx', 'export default 1;');
    const s = await gatherSignals(scratch);
    assert.equal(s.setup.hasProduct, true);
    assert.equal(s.setup.hasDesign, false);
    assert.equal(s.setup.hasCode, true);
    assert.equal(s.setup.register, 'product');
  });

  it('reads the newest critique snapshot score', async () => {
    write('.impeccable/critique/2026-05-01T10-00-00Z__home.md',
      '---\nslug: home\nscore: 6\np0: 1\np1: 3\ntimestamp: 2026-05-01T10-00-00Z\n---\nbody\n');
    write('.impeccable/critique/2026-05-02T10-00-00Z__home.md',
      '---\nslug: home\nscore: 8\np0: 0\np1: 1\ntimestamp: 2026-05-02T10-00-00Z\n---\nbody\n');
    const s = await gatherSignals(scratch);
    assert.equal(s.critique.latest.score, 8); // newest by timestamp prefix
    assert.equal(s.critique.latest.p0, 0);
    assert.equal(s.critique.latest.slug, 'home');
  });

  it('handles a non-git dir without throwing', async () => {
    const s = await gatherSignals(scratch);
    assert.equal(s.git.isRepo, false);
    assert.deepEqual(s.git.changedFiles, []);
    assert.equal(s.git.changedCount, 0);
  });

  it('reports working-tree changes with full, untruncated paths', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('site/styles/home.css', 'a{}\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    // Modify it so it shows as ` M ...` (leading-space porcelain line) — the
    // exact shape that a naive global trim would truncate to "ite/...".
    write('site/styles/home.css', 'a{color:red}\n');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.isRepo, true);
    assert.ok(
      s.git.changedFiles.includes('site/styles/home.css'),
      `expected full path, got: ${JSON.stringify(s.git.changedFiles)}`,
    );
  });

  it('always includes a well-formed devServer probe', async () => {
    const s = await gatherSignals(scratch);
    assert.equal(typeof s.devServer.running, 'boolean');
    assert.ok(Array.isArray(s.devServer.ports));
  });

  it('targets a local source dir (never a URL), even with a dev server up', async () => {
    write('src/App.tsx', 'export default 1;');
    const s = await gatherSignals(scratch);
    assert.equal(s.scan.via, 'source-dir');
    assert.deepEqual(s.scan.targets, ['src']);
    // No target is ever an http(s) URL.
    assert.ok(s.scan.targets.every((t) => !/^https?:/.test(t)));
  });

  it('prefers the dirty tree: scans changed markup/style files', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    write('README.md', 'x\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    write('src/Hero.tsx', 'export const Hero = () => 2;\n'); // dirty
    write('README.md', 'y\n'); // dirty but not scannable
    const s = await gatherSignals(scratch);
    assert.equal(s.scan.via, 'git-changes');
    assert.deepEqual(s.scan.targets, ['src/Hero.tsx']); // README.md filtered out
  });

  it('has empty scan.targets only when there is no code at all', async () => {
    const s = await gatherSignals(scratch);
    assert.deepEqual(s.scan.targets, []);
    assert.equal(s.scan.via, null);
  });
});

describe('context-signals CLI', () => {
  it('emits valid JSON with all top-level signal groups', async () => {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: scratch, encoding: 'utf8' });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    for (const k of ['setup', 'critique', 'git', 'devServer']) {
      assert.ok(k in parsed, `expected "${k}" in signals output`);
    }
  });
});
