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
    assert.equal(Object.hasOwn(s.setup, 'register'), false);
    assert.equal(s.setup.hasCode, false);
    assert.equal(s.critique.latest, null);
  });

  it('detects PRODUCT.md, platform, and code presence', async () => {
    write('PRODUCT.md', '# Product\n\n## Platform\n\nweb\n');
    write('package.json', '{"name":"x"}');
    const s = await gatherSignals(scratch);
    assert.equal(s.setup.hasProduct, true);
    assert.equal(s.setup.platform, 'web');
    assert.equal(s.setup.hasCode, true);
  });

  it('flags missing DESIGN.md when code exists', async () => {
    write('PRODUCT.md', '# Product\n\n## Platform\n\nweb\n');
    write('src/App.tsx', 'export default 1;');
    const s = await gatherSignals(scratch);
    assert.equal(s.setup.hasProduct, true);
    assert.equal(s.setup.hasDesign, false);
    assert.equal(s.setup.hasCode, true);
    assert.equal(s.setup.platform, 'web');
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

  it('reads the newest critique snapshot across target slugs', async () => {
    write('.impeccable/critique/2026-05-01T10-00-00Z__home.md',
      '---\nslug: home\nscore: 6\np0: 1\np1: 3\ntimestamp: 2026-05-01T10-00-00Z\n---\nbody\n');
    write('.impeccable/critique/2026-05-02T10-00-00Z__pricing.md',
      '---\nslug: pricing\nscore: 9\np0: 0\np1: 1\ntimestamp: 2026-05-02T10-00-00Z\n---\nbody\n');
    write('.impeccable/critique/ignore.md', '# Critique ignores\n');
    write('.impeccable/critique/9999-not-a-snapshot.md', '# Draft\n');
    const s = await gatherSignals(scratch);
    assert.equal(s.critique.latest.slug, 'pricing');
    assert.equal(s.critique.latest.score, 9);
    assert.equal(
      s.critique.latest.file,
      '.impeccable/critique/2026-05-02T10-00-00Z__pricing.md',
    );
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

  it('filters harness-dir files out of git-changes scan targets (#303)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    write('.claude/skills/impeccable/scripts/detector.js', 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    write('src/Hero.tsx', 'export const Hero = () => 2;\n'); // dirty app code
    write('.claude/skills/impeccable/scripts/detector.js', 'export const x = 2;\n'); // dirty vendored skill
    const s = await gatherSignals(scratch);
    assert.equal(s.scan.via, 'git-changes');
    assert.deepEqual(s.scan.targets, ['src/Hero.tsx']); // harness path filtered out
  });

  it('keeps hidden-source-dir files (VitePress/Storybook) in scan targets', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('.vitepress/theme/Layout.vue', '<template><div/></template>\n');
    write('.claude/skills/impeccable/scripts/detector.js', 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    write('.vitepress/theme/Layout.vue', '<template><span/></template>\n'); // real UI source
    write('.claude/skills/impeccable/scripts/detector.js', 'export const x = 2;\n'); // vendored
    const s = await gatherSignals(scratch);
    assert.equal(s.scan.via, 'git-changes');
    assert.deepEqual(s.scan.targets, ['.vitepress/theme/Layout.vue']);
  });

  it('falls through to source dirs when only harness files changed (#303)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    write('.cursor/skills/impeccable/example.css', 'a{}\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    write('.cursor/skills/impeccable/example.css', 'a{color:red}\n'); // only harness dirty
    const s = await gatherSignals(scratch);
    assert.equal(s.scan.via, 'source-dir');
    assert.deepEqual(s.scan.targets, ['src']);
  });

  it('diffs a feature branch against a develop integration branch (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('checkout', '-q', '-b', 'feature/x');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    // The hardcoded main/master candidate list found no base here, so the
    // committed feature work was invisible to the scan targets.
    assert.equal(s.git.base, 'develop');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
    assert.deepEqual(s.scan.targets, ['src/Hero.tsx']);
  });

  it('prefers the remote default branch (origin/HEAD) as the diff base (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'trunk');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    // Fabricate the remote's default-branch symref without a network remote.
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    git('checkout', '-q', '-b', 'feature/y');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'trunk');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a branch tracking the integration branch diffs against its upstream (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'release');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    // A self-pointing remote gives git the fetch refspec it needs to map
    // refs/heads/release -> refs/remotes/origin/release; no network involved.
    git('remote', 'add', 'origin', '.');
    git('update-ref', 'refs/remotes/origin/release', 'HEAD');
    git('checkout', '-q', '-b', 'feature/z');
    git('branch', '-q', '--set-upstream-to=origin/release');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'release');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('sitting on the integration branch itself falls back to the working tree', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    write('src/App.tsx', 'export default 2;\n'); // dirty, uncommitted
    const s = await gatherSignals(scratch);
    // No self-diff: base must be null and the dirty working tree is the scope.
    assert.equal(s.git.base, null);
    assert.deepEqual(s.git.changedFiles, ['src/App.tsx']);
  });

  it('uses the remote-tracking ref when the base has no local branch (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    git('checkout', '-q', '-b', 'feature/w');
    git('branch', '-q', '-D', 'develop'); // remote default exists, local doesn't
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'develop');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('honors an upstream on a non-origin remote (fork workflow) (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'release');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('remote', 'add', 'upstream', '.');
    git('update-ref', 'refs/remotes/upstream/release', 'HEAD');
    git('checkout', '-q', '-b', 'feature/v');
    git('branch', '-q', '--set-upstream-to=upstream/release');
    git('branch', '-q', '-D', 'release'); // the tracked base lives only on the fork parent
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'release');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('an existing develop outranks a main-pointing origin/HEAD (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('branch', '-q', 'develop');
    // Classic git-flow with the platform default never flipped off main.
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    git('checkout', '-q', 'develop');
    git('checkout', '-q', '-b', 'feature/g');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    // Features merge to develop here; picking origin/HEAD's main would drag
    // the develop-vs-main divergence into scan targets.
    assert.equal(s.git.base, 'develop');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('remote signals cannot bypass the integration-branch guard (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('branch', '-q', 'develop');
    git('checkout', '-q', 'develop');
    // The remote default is main; sitting on develop must still not produce
    // a develop-vs-main integration diff via the origin/HEAD signal.
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    write('src/App.tsx', 'export default 2;\n'); // dirty on develop
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, null);
    assert.deepEqual(s.git.changedFiles, ['src/App.tsx']);
  });

  it('honors a local (slashless) upstream branch (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'canary');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('checkout', '-q', '-b', 'feature/u');
    git('branch', '-q', '--set-upstream-to=canary'); // local upstream, no remote
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    // canary is neither conventional nor remote, but the configured
    // upstream names it as the merge target.
    assert.equal(s.git.base, 'canary');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('sitting on a non-standard default branch keeps the working-tree scope (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'trunk');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('branch', '-q', 'develop'); // a conventional name also exists
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    write('src/App.tsx', 'export default 2;\n'); // dirty on trunk
    const s = await gatherSignals(scratch);
    // trunk IS the integration branch (origin/HEAD says so); develop must
    // not win the candidate scan and produce a trunk-vs-develop diff.
    assert.equal(s.git.base, null);
    assert.deepEqual(s.git.changedFiles, ['src/App.tsx']);
  });

  it('a detached HEAD keeps the working-tree scope (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('branch', '-q', 'develop');
    git('checkout', '-q', '--detach');
    write('src/App.tsx', 'export default 2;\n'); // dirty on a detached tip
    const s = await gatherSignals(scratch);
    // A detached checkout has no branch identity to diff for; picking
    // develop here would refill changedFiles with integration divergence.
    assert.equal(s.git.base, null);
    assert.deepEqual(s.git.changedFiles, ['src/App.tsx']);
  });

  it('the integration guard sees non-origin remote defaults (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'trunk');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('branch', '-q', 'develop');
    // The only remote is upstream (fork-parent layout, no origin at all);
    // its default branch is trunk, which is exactly where we're sitting.
    git('remote', 'add', 'upstream', '.');
    git('update-ref', 'refs/remotes/upstream/trunk', 'HEAD');
    git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/trunk');
    write('src/App.tsx', 'export default 2;\n'); // dirty on trunk
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, null);
    assert.deepEqual(s.git.changedFiles, ['src/App.tsx']);
  });

  it('finds a develop that exists only on a non-origin remote (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'feature/f');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    // Fork-parent layout: develop lives only as upstream/develop, no local
    // copy, no origin remote, and the feature branch has no upstream.
    git('remote', 'add', 'upstream', '.');
    git('update-ref', 'refs/remotes/upstream/develop', 'HEAD');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'develop');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a same-name default on a second remote still resolves (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'feature/h');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('remote', 'add', 'origin', '.');
    git('remote', 'add', 'upstream', '.');
    // origin advertises main but its tracking ref is gone (pruned); the
    // real main lives only as upstream/main. Name-level dedup must not
    // discard the upstream rev.
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    git('update-ref', 'refs/remotes/upstream/main', 'HEAD');
    git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/main');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'main');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a local upstream with a slash in its name is not misparsed (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'release/2.0');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('checkout', '-q', '-b', 'hotfix/x');
    git('branch', '-q', '--set-upstream-to=release/2.0');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'hotfix work');
    const s = await gatherSignals(scratch);
    // "release" is not a remote here; the whole ref is the local base name.
    assert.equal(s.git.base, 'release/2.0');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a local upstream sharing the branch leaf name is not self-skipped (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'feature/foo');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('checkout', '-q', '-b', 'foo');
    git('branch', '-q', '--set-upstream-to=feature/foo');
    // Adversarial twist: a remote literally named "feature" exists, so any
    // prefix-based guess would still misread the LOCAL feature/foo upstream
    // as remote-tracking. Only the full symbolic ref disambiguates.
    git('remote', 'add', 'feature', '.');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'work');
    const s = await gatherSignals(scratch);
    // Truncating feature/foo to "foo" made it look like the current branch
    // and the valid upstream was discarded.
    assert.equal(s.git.base, 'feature/foo');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a pruned upstream tracking ref falls back to other remotes (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'feature/p');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('remote', 'add', 'origin', '.');
    git('remote', 'add', 'upstream', '.');
    // The branch tracks origin/main, but that tracking ref was pruned; the
    // live main exists only on the upstream remote.
    git('config', 'branch.feature/p.remote', 'origin');
    git('config', 'branch.feature/p.merge', 'refs/heads/main');
    git('update-ref', 'refs/remotes/upstream/main', 'HEAD');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'main');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a remote-advertised default outranks a stale local checkout (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/base.css', 'a{}\n');
    git('add', '.');
    git('commit', '-qm', 'A');
    write('src/extra.css', 'b{}\n');
    git('add', '.');
    git('commit', '-qm', 'A2');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    git('checkout', '-q', '-b', 'feature/s');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    // The local main checkout is stale (still at A); the remote default is
    // at A2. Diffing against the stale local would drag src/extra.css in.
    git('branch', '-f', 'main', 'HEAD~2');
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'main');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('a develop-pointing remote default outranks a stale local develop (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/base.css', 'a{}\n');
    git('add', '.');
    git('commit', '-qm', 'A');
    write('src/extra.css', 'b{}\n');
    git('add', '.');
    git('commit', '-qm', 'A2');
    git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    git('checkout', '-q', '-b', 'feature/t');
    write('src/Hero.tsx', 'export const Hero = () => null;\n');
    git('add', '.');
    git('commit', '-qm', 'feature work');
    git('branch', '-f', 'develop', 'HEAD~2'); // local develop is stale at A
    const s = await gatherSignals(scratch);
    assert.equal(s.git.base, 'develop');
    assert.deepEqual(s.git.changedFiles, ['src/Hero.tsx']);
  });

  it('never diffs one integration branch against another (#302)', async () => {
    const { execFileSync } = await import('node:child_process');
    const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('src/App.tsx', 'export default 1;\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('branch', '-q', 'develop'); // both integration branches exist
    write('src/App.tsx', 'export default 2;\n'); // dirty on main
    const s = await gatherSignals(scratch);
    // Sitting on main must not pick develop as a base; the dirty working
    // tree is the scope, exactly as before this change.
    assert.equal(s.git.base, null);
    assert.deepEqual(s.git.changedFiles, ['src/App.tsx']);
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
