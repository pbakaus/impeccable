/**
 * Tests for ensure-gitignore.mjs — idempotent marked-block writer for the
 * shared, committed .gitignore.
 * Run with: node --test tests/ensure-gitignore.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  ensureImpeccableGitignore,
  checkImpeccableGitignore,
  analyzeTracked,
  GITIGNORE_MARKER_OPEN,
  GITIGNORE_MARKER_CLOSE,
  GITIGNORE_PATTERNS,
} from '../skill/scripts/ensure-gitignore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'skill/scripts/ensure-gitignore.mjs');

function runCli(cwd, args = []) {
  const out = execFileSync('node', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim());
}

function makeGitRepo(root) {
  mkdirSync(join(root, '.git'), { recursive: true });
}

// Initialise a REAL git repo so `git ls-files` works, then stage the listed
// (already-written) files. Keeps a deterministic environment independent of the
// host repo.
function realGitRepo(root, addPaths = []) {
  const git = (args) => spawnSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: root, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' },
  });
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@e']);
  for (const rel of addPaths) git(['add', '-f', rel]);
  git(['commit', '-q', '-m', 'init', '--allow-empty']);
}

describe('ensure-gitignore — block writing', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-gi-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('creates .gitignore with the marked block when none exists', () => {
    makeGitRepo(tmp);
    const result = ensureImpeccableGitignore(tmp);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.mode, 'gitignore');
    const body = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    assert.equal(body.includes(GITIGNORE_MARKER_OPEN), true);
    assert.equal(body.includes(GITIGNORE_MARKER_CLOSE), true);
    assert.equal(body.includes('.impeccable/*.png'), true);
    assert.equal(body.includes('.impeccable/config.local.json'), true);
  });

  it('is idempotent: a second run does not change the file', () => {
    makeGitRepo(tmp);
    ensureImpeccableGitignore(tmp);
    const second = ensureImpeccableGitignore(tmp);

    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
  });

  it('preserves existing user content and appends the block with a blank separator', () => {
    makeGitRepo(tmp);
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n.DS_Store\n');
    const result = ensureImpeccableGitignore(tmp);

    assert.equal(result.changed, true);
    const body = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    assert.equal(body.startsWith('node_modules\n.DS_Store\n'), true);
    assert.equal(body.includes(GITIGNORE_MARKER_OPEN), true);
    // separator blank line between user content and block
    assert.equal(body.includes('.DS_Store\n\n# impeccable-ignore-start'), true);
  });

  it('replaces a stale block in place without duplicating', () => {
    makeGitRepo(tmp);
    const stale = [
      'node_modules',
      GITIGNORE_MARKER_OPEN,
      '/.impeccable/old-removed-pattern',
      GITIGNORE_MARKER_CLOSE,
      'dist',
      '',
    ].join('\n');
    writeFileSync(join(tmp, '.gitignore'), stale);

    const result = ensureImpeccableGitignore(tmp);
    assert.equal(result.changed, true);

    const body = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    assert.equal(body.includes('/.impeccable/old-removed-pattern'), false);
    assert.equal(body.includes('.impeccable/*.png'), true);
    // surrounding user content survives
    assert.equal(body.startsWith('node_modules\n'), true);
    assert.equal(body.includes('\ndist\n'), true);
    // exactly one block
    assert.equal(body.split(GITIGNORE_MARKER_OPEN).length - 1, 1);
    assert.equal(body.split(GITIGNORE_MARKER_CLOSE).length - 1, 1);
  });

  it('does not ignore shared project artifacts (config.json, design.json, critique/*.md)', () => {
    makeGitRepo(tmp);
    ensureImpeccableGitignore(tmp);
    const body = readFileSync(join(tmp, '.gitignore'), 'utf-8');

    // Inspect actual ignore entries (non-comment, non-empty, non-marker lines)
    // — the block's prose comments legitimately mention these by name as
    // tracked, so they must be excluded from the substring search.
    const entries = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const tracked = [
      '.impeccable/config.json',
      '.impeccable/design.json',
      '.impeccable/live/config.json',
    ];
    for (const t of tracked) {
      assert.equal(entries.includes(t), false, `${t} must stay tracked`);
    }
    // no entry should target the critique review-report directory
    assert.equal(entries.some((e) => e.includes('critique')), false);
  });

  it('emits unanchored patterns so nested monorepo .impeccable dirs are covered', () => {
    makeGitRepo(tmp);
    ensureImpeccableGitignore(tmp);
    const entries = readFileSync(join(tmp, '.gitignore'), 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    // No ignore entry may start with '/' — that would anchor to the repo root
    // and miss an apps/web/.impeccable/... layout.
    for (const e of entries) {
      assert.equal(e.startsWith('/'), false, `entry "${e}" must not be root-anchored`);
    }
  });
});

describe('ensure-gitignore — repo-root resolution', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-gi-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('writes to the repo-root .gitignore even when run from a subdirectory', () => {
    makeGitRepo(tmp);
    const sub = join(tmp, 'apps', 'web');
    mkdirSync(sub, { recursive: true });

    const result = ensureImpeccableGitignore(sub);

    assert.equal(result.ok, true);
    assert.equal(existsSync(join(tmp, '.gitignore')), true);
    assert.equal(existsSync(join(sub, '.gitignore')), false);
    // reported path is relative to the cwd we passed in
    assert.equal(result.file.startsWith('..'), true);
  });

  it('falls back to cwd .gitignore when no .git is found anywhere up the tree', () => {
    // tmp has no .git; resolveRepoRoot falls back to cwd
    const result = ensureImpeccableGitignore(tmp);
    assert.equal(result.ok, true);
    assert.equal(existsSync(join(tmp, '.gitignore')), true);
  });
});

describe('ensure-gitignore --check', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-gi-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('reports present:false when .gitignore has no block', () => {
    makeGitRepo(tmp);
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n');
    const result = checkImpeccableGitignore(tmp);

    assert.equal(result.present, false);
    assert.equal(result.stale, false);
  });

  it('reports present:true, stale:false when the block is current', () => {
    makeGitRepo(tmp);
    ensureImpeccableGitignore(tmp);
    const result = checkImpeccableGitignore(tmp);

    assert.equal(result.present, true);
    assert.equal(result.stale, false);
  });

  it('reports stale:true when the block content differs from canonical', () => {
    makeGitRepo(tmp);
    const staleBlock = [
      GITIGNORE_MARKER_OPEN,
      '/.impeccable/something-else',
      GITIGNORE_MARKER_CLOSE,
    ].join('\n');
    writeFileSync(join(tmp, '.gitignore'), `${staleBlock}\n`);

    const result = checkImpeccableGitignore(tmp);
    assert.equal(result.present, true);
    assert.equal(result.stale, true);
  });
});

describe('ensure-gitignore — CLI', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-gi-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('default mode writes the block and reports tracked shared artifacts via git', () => {
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'config.json'), '{}');
    // a committed shared artifact shows up in `tracked`
    realGitRepo(tmp, ['.impeccable/config.json']);

    const result = runCli(tmp);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.mode, 'gitignore');
    assert.equal(result.gitAvailable, true);
    assert.deepEqual(result.tracked, ['.impeccable/config.json']);
    assert.deepEqual(result.needsUntrack, []);
  });

  it('default mode flags committed ephemeral files in needsUntrack', () => {
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'critique-desktop.png'), 'x');
    writeFileSync(join(tmp, '.impeccable', 'config.local.json'), '{}');
    writeFileSync(join(tmp, '.impeccable', 'live', 'config.json'), '{}'); // shared, stays tracked
    realGitRepo(tmp, [
      '.impeccable/critique-desktop.png',
      '.impeccable/config.local.json',
      '.impeccable/live/config.json',
    ]);

    const result = runCli(tmp);

    assert.equal(result.gitAvailable, true);
    assert.deepEqual(result.tracked, ['.impeccable/live/config.json']);
    assert.deepEqual(result.needsUntrack.sort(), ['.impeccable/config.local.json', '.impeccable/critique-desktop.png']);
  });

  it('--check reports present without writing, and surfaces no false tracking when not a repo', () => {
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n');

    const result = runCli(tmp, ['--check']);

    assert.equal(result.present, false);
    assert.equal(result.stale, false);
    assert.equal(result.gitAvailable, false);
    assert.deepEqual(result.tracked, []);
    assert.deepEqual(result.needsUntrack, []);
    // nothing written
    const body = readFileSync(join(tmp, '.gitignore'), 'utf-8');
    assert.equal(body, 'node_modules\n');
  });
});

describe('ensure-gitignore — pattern surface', () => {
  it('covers the screenshots and runtime paths observed in real projects', () => {
    const joined = GITIGNORE_PATTERNS.join('\n');
    // the big pollution sources from safivo/web (unanchored)
    assert.equal(joined.includes('.impeccable/*.png'), true);
    assert.equal(joined.includes('.impeccable/live/*.png'), true);
    assert.equal(joined.includes('.impeccable/live/sessions/'), true);
    assert.equal(joined.includes('.impeccable/live/annotations/'), true);
    assert.equal(joined.includes('.impeccable/config.local.json'), true);
    assert.equal(joined.includes('.impeccable/hook.cache.json'), true);
  });
});

describe('analyzeTracked — git-aware classification', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-gi-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns gitAvailable:false (empty lists) when not inside a git repo', () => {
    // no .git anywhere up the tree from tmp
    const result = analyzeTracked(tmp);
    assert.equal(result.gitAvailable, false);
    assert.deepEqual(result.tracked, []);
    assert.deepEqual(result.needsUntrack, []);
  });

  it('classifies shared artifacts as tracked and ephemeral files as needsUntrack', () => {
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    mkdirSync(join(tmp, '.impeccable', 'critique'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'design.json'), '{}'); // shared
    writeFileSync(join(tmp, '.impeccable', 'config.local.json'), '{}'); // ephemeral
    writeFileSync(join(tmp, '.impeccable', 'shot.png'), 'x'); // ephemeral
    writeFileSync(join(tmp, '.impeccable', 'critique', 'r.md'), 'x'); // shared (review report)
    realGitRepo(tmp, [
      '.impeccable/design.json',
      '.impeccable/config.local.json',
      '.impeccable/shot.png',
      '.impeccable/critique/r.md',
    ]);

    const result = analyzeTracked(tmp);

    assert.equal(result.gitAvailable, true);
    assert.deepEqual(result.tracked.sort(), ['.impeccable/critique/r.md', '.impeccable/design.json']);
    assert.deepEqual(result.needsUntrack.sort(), ['.impeccable/config.local.json', '.impeccable/shot.png']);
  });

  it('handles a nested (monorepo) .impeccable under apps/web/', () => {
    const imp = join(tmp, 'apps', 'web', '.impeccable');
    mkdirSync(join(imp, 'live'), { recursive: true });
    mkdirSync(join(imp, 'critique'), { recursive: true });
    writeFileSync(join(imp, 'live', 'config.json'), '{}'); // shared
    writeFileSync(join(imp, 'config.local.json'), '{}'); // ephemeral
    writeFileSync(join(imp, 'critique-desktop.png'), 'x'); // ephemeral
    realGitRepo(tmp, [
      'apps/web/.impeccable/live/config.json',
      'apps/web/.impeccable/config.local.json',
      'apps/web/.impeccable/critique-desktop.png',
    ]);

    const result = analyzeTracked(tmp);

    assert.equal(result.gitAvailable, true);
    assert.deepEqual(result.tracked, ['apps/web/.impeccable/live/config.json']);
    assert.deepEqual(result.needsUntrack.sort(), [
      'apps/web/.impeccable/config.local.json',
      'apps/web/.impeccable/critique-desktop.png',
    ]);
  });

  it('does not report untracked-but-on-disk files as tracked', () => {
    // The whole point of the Cursor finding: existence != tracking.
    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'design.json'), '{}'); // on disk, NOT committed
    realGitRepo(tmp, []); // real repo, but nothing staged under .impeccable

    const result = analyzeTracked(tmp);

    assert.equal(result.gitAvailable, true);
    assert.deepEqual(result.tracked, []);
    assert.deepEqual(result.needsUntrack, []);
  });
});
