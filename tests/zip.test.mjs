/**
 * Unit tests for the release-bundle zip writer (scripts/lib/zip.js).
 * Run: node --test tests/zip.test.mjs
 *
 * Regression guard for the silent-broken-bundle outage: archiver v8's ESM
 * change made createProviderZip fail without throwing, so the build shipped a
 * 0-byte universal.zip and every `npx impeccable skills install` failed with
 * "End-of-central-directory signature not found". Nothing covered the zip
 * writer, so the suite stayed green. These tests exercise the real writer and
 * round-trip through extract-zip (the same unpacker the CLI uses).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extract from 'extract-zip';

import { createProviderZip, createAllZips } from '../scripts/lib/zip.js';

function makeUniversalTree(distDir) {
  const skillDir = join(distDir, 'universal', 'skills', 'impeccable');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\n---\nhello\n');
  mkdirSync(join(distDir, 'universal', '.claude'), { recursive: true });
  writeFileSync(join(distDir, 'universal', '.claude', 'settings.json'), '{}\n');
}

describe('release bundle zip writer', () => {
  it('createAllZips produces a non-empty universal.zip that unpacks to the skill tree', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-zip-'));
    makeUniversalTree(dist);

    await createAllZips(dist);

    const zipPath = join(dist, 'universal.zip');
    assert.ok(existsSync(zipPath), 'universal.zip was not created');
    assert.ok(statSync(zipPath).size > 0, 'universal.zip is empty (0 bytes)');

    // Round-trip: the CLI downloads this exact artifact and extract()s it.
    const out = mkdtempSync(join(tmpdir(), 'imp-unzip-'));
    await extract(zipPath, { dir: out });
    const skillMd = join(out, 'skills', 'impeccable', 'SKILL.md');
    assert.ok(existsSync(skillMd), 'unpacked bundle is missing skills/impeccable/SKILL.md');
    assert.match(readFileSync(skillMd, 'utf8'), /name: impeccable/);

    rmSync(dist, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('createProviderZip throws when the source has no files (no silent 0-byte artifact)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-zip-empty-'));
    mkdirSync(join(dist, 'universal'), { recursive: true });

    await assert.rejects(
      () => createProviderZip(join(dist, 'universal'), dist, 'universal'),
      /no entries|0 bytes/i,
    );

    rmSync(dist, { recursive: true, force: true });
  });

  it('createProviderZip throws when the source directory is missing', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-zip-missing-'));

    await assert.rejects(
      () => createProviderZip(join(dist, 'does-not-exist'), dist, 'universal'),
      /not found/i,
    );

    rmSync(dist, { recursive: true, force: true });
  });
});
