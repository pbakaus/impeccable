/**
 * Tests for critique snapshot persistence.
 * Run with: node --test tests/critique-storage.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/critique-storage.mjs', import.meta.url));

import {
  slugFromTarget,
  writeSnapshot,
  readLatestSnapshot,
  readTrend,
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
