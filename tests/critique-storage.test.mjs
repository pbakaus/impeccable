/**
 * Tests for critique snapshot persistence.
 * Run with: node --test tests/critique-storage.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/critique-storage.mjs', import.meta.url));

import {
  fingerprintTarget,
  slugFromTarget,
  writeSnapshot,
  readLatestSnapshot,
  readLatestSnapshotAcrossTargets,
  readTrend,
  closeSnapshot,
  nowFilenameStamp,
} from '../skill/scripts/critique-storage.mjs';

let cwd;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'imp-critique-')); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe('slugFromTarget', () => {
  it('kebabs a relative file path', () => {
    assert.equal(slugFromTarget('site/pages/index.astro', { cwd }), 'site-pages-index-astro');
  });

  it('kebabs an absolute path inside cwd by relativizing', () => {
    const abs = join(cwd, 'site/pages/index.astro');
    assert.equal(slugFromTarget(abs, { cwd }), 'site-pages-index-astro');
  });

  it('uses basename for absolute paths outside cwd', () => {
    // Sibling path, not under cwd
    const abs = join(tmpdir(), 'somewhere', 'else', 'page.html');
    assert.equal(slugFromTarget(abs, { cwd }), 'page-html');
  });

  it('drops port from URL', () => {
    assert.equal(slugFromTarget('http://localhost:3000/pricing', { cwd }), 'localhost-pricing');
  });

  it('normalizes URL casing and trailing slash', () => {
    assert.equal(
      slugFromTarget('https://Impeccable.Style/docs/audit/', { cwd }),
      'impeccable-style-docs-audit',
    );
  });

  it('strips query strings', () => {
    assert.equal(
      slugFromTarget('https://example.com/x?utm=1&foo=bar', { cwd }),
      'example-com-x',
    );
  });

  it('returns null for empty / project-root inputs', () => {
    assert.equal(slugFromTarget('', { cwd }), null);
    assert.equal(slugFromTarget('.', { cwd }), null);
    assert.equal(slugFromTarget(null, { cwd }), null);
  });

  it('caps overly long slugs from the tail', () => {
    const longPath = 'a/'.repeat(60) + 'file.tsx';   // way over 50
    const slug = slugFromTarget(longPath, { cwd });
    assert.ok(slug.length <= 50);
    assert.ok(slug.endsWith('file-tsx'));
  });

  it('is stable: same input → same slug', () => {
    const a = slugFromTarget('site/pages/index.astro', { cwd });
    const b = slugFromTarget('site/pages/index.astro', { cwd });
    assert.equal(a, b);
  });
});

describe('nowFilenameStamp', () => {
  it('is windows-safe (no colons or dots in the time fragment)', () => {
    const stamp = nowFilenameStamp(new Date('2026-05-12T18:30:00.123Z'));
    assert.equal(stamp, '2026-05-12T18-30-00Z');
  });
});

describe('fingerprintTarget', () => {
  it('fingerprints exact local file bytes independent of Git state', () => {
    const target = join(cwd, 'index.html');
    writeFileSync(target, '<main>hello</main>');
    const first = fingerprintTarget(target, { cwd });
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
    assert.equal(fingerprintTarget('index.html', { cwd }), first);

    writeFileSync(target, '<main>changed</main>');
    assert.notEqual(fingerprintTarget(target, { cwd }), first);
  });

  it('returns null for URLs, directories, and missing files', () => {
    assert.equal(fingerprintTarget('https://example.com/page', { cwd }), null);
    assert.equal(fingerprintTarget('.', { cwd }), null);
    assert.equal(fingerprintTarget('missing.html', { cwd }), null);
  });
});

describe('writeSnapshot + readLatestSnapshot', () => {
  it('round-trips body and frontmatter', () => {
    const out = writeSnapshot({
      slug: 'index-astro',
      meta: { target: 'the homepage', total_score: 28, p0_count: 1, p1_count: 3 },
      body: '# Critique\n\nP0: nested cards',
      cwd,
    });
    assert.ok(out.endsWith('__index-astro.md'));
    const latest = readLatestSnapshot('index-astro', { cwd });
    assert.equal(latest.meta.slug, 'index-astro');
    assert.equal(latest.meta.target, 'the homepage');
    assert.equal(latest.meta.total_score, 28);
    assert.match(latest.body, /P0: nested cards/);
  });

  it('returns null when no snapshot for slug', () => {
    assert.equal(readLatestSnapshot('nope', { cwd }), null);
  });

  it('picks the newest by filename when multiple exist', () => {
    writeSnapshot({ slug: 'index-astro', meta: { total_score: 22 }, body: 'old', cwd, now: new Date('2026-05-01T00:00:00Z') });
    writeSnapshot({ slug: 'index-astro', meta: { total_score: 30 }, body: 'new', cwd, now: new Date('2026-05-12T00:00:00Z') });
    const latest = readLatestSnapshot('index-astro', { cwd });
    assert.equal(latest.meta.total_score, 30);
    assert.match(latest.body, /new/);
  });

  it('picks the newest snapshot across target slugs', () => {
    writeSnapshot({ slug: 'home', meta: {}, body: 'old', cwd, now: new Date('2026-05-01T00:00:00Z') });
    writeSnapshot({ slug: 'pricing', meta: {}, body: 'new', cwd, now: new Date('2026-05-12T00:00:00Z') });
    writeFileSync(join(cwd, '.impeccable', 'critique', 'ignore.md'), '# Critique ignores\n');
    writeFileSync(join(cwd, '.impeccable', 'critique', '9999-not-a-snapshot.md'), '# Draft\n');
    const latest = readLatestSnapshotAcrossTargets({ cwd });
    assert.equal(latest.meta.slug, 'pricing');
    assert.match(latest.body, /new/);
  });

  it('does not see snapshots for a different slug', () => {
    writeSnapshot({ slug: 'pricing-astro', meta: { total_score: 10 }, body: 'b', cwd });
    assert.equal(readLatestSnapshot('index-astro', { cwd }), null);
  });

  it('caller-supplied meta cannot override computed timestamp or slug', () => {
    // Defends against a corrupt IMPECCABLE_CRITIQUE_META blob (parsed from
    // an env var) silently rewriting fields that must agree with the
    // filename. Otherwise readTrend would attribute scores to the wrong
    // timestamps with no error.
    const out = writeSnapshot({
      slug: 'index-astro',
      meta: { timestamp: 'NOT_A_REAL_STAMP', slug: 'somewhere-else', total_score: 50 },
      body: 'b',
      cwd,
      now: new Date('2026-05-12T18:30:00Z'),
    });
    const latest = readLatestSnapshot('index-astro', { cwd });
    assert.equal(latest.meta.slug, 'index-astro');
    assert.equal(latest.meta.timestamp, '2026-05-12T18-30-00Z');
    // The legit meta field still lands.
    assert.equal(latest.meta.total_score, 50);
    // The filename matches the computed slug.
    assert.ok(out.endsWith('2026-05-12T18-30-00Z__index-astro.md'));
  });

  it('quotes values containing : or # to keep parsing simple', () => {
    writeSnapshot({
      slug: 'x',
      meta: { target: 'docs: critique # main' },
      body: '...',
      cwd,
    });
    const latest = readLatestSnapshot('x', { cwd });
    assert.equal(latest.meta.target, 'docs: critique # main');
  });

  it('closeSnapshot returns the path and leaves readLatestSnapshot null', () => {
    const out = writeSnapshot({ slug: 'index-astro', meta: { total_score: 20 }, body: 'open', cwd });
    const closed = closeSnapshot('index-astro', { cwd });
    assert.equal(closed, out);
    assert.ok(closed.endsWith('__index-astro.md'));
    assert.equal(readLatestSnapshot('index-astro', { cwd }), null);
  });

  it('closeSnapshot closes the backlog without deleting its trend history', () => {
    writeSnapshot({
      slug: 'index-astro',
      meta: { total_score: 21, p0_count: 7 },
      body: 'old leftover',
      cwd,
      now: new Date('2026-05-01T00:00:00Z'),
    });
    const newest = writeSnapshot({
      slug: 'index-astro',
      meta: { total_score: 30 },
      body: 'newer',
      cwd,
      now: new Date('2026-05-12T00:00:00Z'),
    });
    const closed = closeSnapshot('index-astro', { cwd });
    assert.equal(closed, newest);
    assert.equal(readLatestSnapshot('index-astro', { cwd }), null);
    const trend = readTrend('index-astro', { cwd });
    assert.equal(trend.length, 2);
    assert.equal(trend[0].total_score, 21);
    assert.equal(trend[1].total_score, 30);
    assert.equal(trend[1].closed, true);
  });

  it('a new snapshot reopens a previously closed slug', () => {
    writeSnapshot({
      slug: 'index-astro',
      meta: { total_score: 20 },
      body: 'resolved',
      cwd,
      now: new Date('2026-05-01T00:00:00Z'),
    });
    closeSnapshot('index-astro', { cwd });
    const reopened = writeSnapshot({
      slug: 'index-astro',
      meta: { total_score: 15 },
      body: 'new findings',
      cwd,
      now: new Date('2026-05-12T00:00:00Z'),
    });

    assert.equal(readLatestSnapshot('index-astro', { cwd }).path, reopened);
    assert.equal(readTrend('index-astro', { cwd }).length, 2);
  });

  it('latest across targets skips a closed slug without hiding other backlogs', () => {
    const pricing = writeSnapshot({
      slug: 'pricing',
      meta: { total_score: 25 },
      body: 'pricing backlog',
      cwd,
      now: new Date('2026-05-01T00:00:00Z'),
    });
    writeSnapshot({
      slug: 'home',
      meta: { total_score: 30 },
      body: 'home backlog',
      cwd,
      now: new Date('2026-05-12T00:00:00Z'),
    });
    closeSnapshot('home', { cwd });

    assert.equal(readLatestSnapshotAcrossTargets({ cwd }).path, pricing);
  });
});

describe('CLI entry point', () => {
  // Why a subprocess test: the CLI guard at the bottom of the script
  // previously compared import.meta.url to `file://${process.argv[1]}`,
  // which silently broke on Windows (forward vs back slashes) — exit 0,
  // no output, save skipped. The exported functions kept passing because
  // tests never spawned the script as a process. See issue #155.
  it('slug subcommand prints a slug and exits 0', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'slug', 'site/pages/index.astro'], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'site-pages-index-astro');
  });

  it('slug subcommand exits 1 with a message for empty input', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'slug', ''], { cwd, encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no stable slug/);
  });

  it('runs when invoked through a symlinked harness path', () => {
    const linkedScript = join(cwd, 'linked-critique-storage.mjs');
    symlinkSync(SCRIPT, linkedScript);

    const r = spawnSync(process.execPath, [linkedScript, 'slug', 'index.html'], {
      cwd,
      encoding: 'utf-8',
    });

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'index-html');
  });

  it('latest subcommand exits 2 when no snapshot exists', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'latest', 'never-written'], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 2);
  });

  it('inherits an unchanged untracked file snapshot and closes it after any byte change', () => {
    const target = join(cwd, 'index.html');
    const bodyFile = join(cwd, 'critique.md');
    writeFileSync(target, '<main>assessed worktree</main>');
    writeFileSync(bodyFile, '# Critique\n\nP1: improve hierarchy');

    const write = spawnSync(process.execPath, [SCRIPT, 'write', target, bodyFile], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(write.status, 0, `stderr: ${write.stderr}`);

    const unchanged = spawnSync(process.execPath, [SCRIPT, 'latest', target], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(unchanged.status, 0, `stderr: ${unchanged.stderr}`);
    assert.match(unchanged.stdout, /improve hierarchy/);

    // The edit can happen in the same clock second as the snapshot; exact
    // bytes, rather than timestamp precision, determine freshness.
    writeFileSync(target, '<main>newer worktree</main>');
    const changed = spawnSync(process.execPath, [SCRIPT, 'latest', target], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(changed.status, 2, `stderr: ${changed.stderr}`);
    assert.equal(readLatestSnapshot('index-html', { cwd }), null);
    assert.equal(readTrend('index-html', { cwd })[0].closed, true);
  });

  it('closes a local snapshot when its target is deleted or replaced by a directory', () => {
    const bodyFile = join(cwd, 'critique.md');
    writeFileSync(bodyFile, '# Critique\n\nP1: improve hierarchy');

    for (const replacement of ['missing', 'directory']) {
      const target = join(cwd, `${replacement}.html`);
      writeFileSync(target, '<main>assessed</main>');
      const write = spawnSync(process.execPath, [SCRIPT, 'write', target, bodyFile], {
        cwd,
        encoding: 'utf-8',
      });
      assert.equal(write.status, 0, `stderr: ${write.stderr}`);

      rmSync(target);
      if (replacement === 'directory') mkdirSync(target);

      const latest = spawnSync(process.execPath, [SCRIPT, 'latest', target], {
        cwd,
        encoding: 'utf-8',
      });
      assert.equal(latest.status, 2, `stderr: ${latest.stderr}`);
      const slug = `${replacement}-html`;
      assert.equal(readLatestSnapshot(slug, { cwd }), null);
      assert.equal(readTrend(slug, { cwd })[0].closed, true);
    }
  });

  it('treats a legacy local-file snapshot without a fingerprint as stale', () => {
    const target = join(cwd, 'index.html');
    writeFileSync(target, '<main>current</main>');
    writeSnapshot({ slug: 'index-html', meta: { total_score: 20 }, body: 'legacy', cwd });

    const latest = spawnSync(process.execPath, [SCRIPT, 'latest', target], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(latest.status, 2, `stderr: ${latest.stderr}`);
    assert.equal(readTrend('index-html', { cwd })[0].closed, true);
  });

  it('keeps URL snapshots current without a local fingerprint', () => {
    const bodyFile = join(cwd, 'critique.md');
    writeFileSync(bodyFile, '# Critique\n\nP1: improve hierarchy');
    const target = 'https://example.com/page';

    const write = spawnSync(process.execPath, [SCRIPT, 'write', target, bodyFile], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(write.status, 0, `stderr: ${write.stderr}`);

    const latest = spawnSync(process.execPath, [SCRIPT, 'latest', target], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(latest.status, 0, `stderr: ${latest.stderr}`);
    assert.match(latest.stdout, /improve hierarchy/);
  });

  it('close subcommand closes the latest snapshot and preserves its trend', () => {
    writeSnapshot({ slug: 'index-astro', meta: { total_score: 20 }, body: 'open', cwd });
    const r = spawnSync(process.execPath, [SCRIPT, 'close', 'index-astro'], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(readLatestSnapshot('index-astro', { cwd }), null);
    assert.equal(readTrend('index-astro', { cwd }).length, 1);
    assert.equal(readTrend('index-astro', { cwd })[0].closed, true);
  });

  it('close subcommand exits 2 when the latest snapshot is already closed', () => {
    writeSnapshot({ slug: 'index-astro', meta: { total_score: 20 }, body: 'open', cwd });
    closeSnapshot('index-astro', { cwd });
    const r = spawnSync(process.execPath, [SCRIPT, 'close', 'index-astro'], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 2);
  });

  it('close subcommand exits 2 when no snapshot exists', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'close', 'never-written'], {
      cwd,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 2);
  });
});

describe('readTrend', () => {
  it('returns last N entries oldest → newest, filtered by slug', () => {
    for (let i = 0; i < 6; i++) {
      writeSnapshot({
        slug: 'index-astro',
        meta: { total_score: 20 + i },
        body: `run ${i}`,
        cwd,
        now: new Date(2026, 4, i + 1),
      });
    }
    writeSnapshot({ slug: 'pricing-astro', meta: { total_score: 99 }, body: 'unrelated', cwd });
    const trend = readTrend('index-astro', { limit: 5, cwd });
    assert.equal(trend.length, 5);
    assert.equal(trend[0].total_score, 21);   // dropped the oldest
    assert.equal(trend[4].total_score, 25);
  });

  it('returns empty when no snapshots', () => {
    assert.deepEqual(readTrend('nope', { cwd }), []);
  });
});
