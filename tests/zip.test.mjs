/**
 * Unit tests for the release-bundle zip writer (scripts/lib/zip.js).
 * Run: node --test tests/zip.test.mjs
 *
 * Regression guard for the silent-broken-bundle outage: archiver v8's ESM
 * change made createProviderZip fail without throwing, so the build shipped a
 * 0-byte universal.zip and every `npx impeccable install` failed with
 * "End-of-central-directory signature not found". Nothing covered the zip
 * writer, so the suite stayed green. These tests exercise the real writer and
 * round-trip through the same unpacker the CLI uses (extractZip, backed by
 * fflate). The many-file extraction test additionally guards the Node v24.16.0
 * / v26.1.0+ silent partial-extraction regression (nodejs/node#63487) that
 * made `npx impeccable install` exit 0 after writing only a fraction of the
 * bundle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProviderZip, createAllZips } from '../scripts/lib/zip.js';
import { extractZip } from '../cli/bin/commands/skills.mjs';

function makeUniversalTree(distDir) {
  const skillDir = join(distDir, 'universal', 'skills', 'impeccable');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: impeccable\n---\nhello\n');
  mkdirSync(join(distDir, 'universal', '.claude'), { recursive: true });
  writeFileSync(join(distDir, 'universal', '.claude', 'settings.json'), '{}\n');
}

/**
 * Build a representative multi-provider universal tree carrying far more
 * entries than the Node v24.16.0 extract-zip stall point (~31 files). The
 * partial-extraction regression test relies on this so a regression in the
 * unpacker fails the count assertion instead of shipping silently. Returns the
 * number of files written.
 */
function makeLargeUniversalTree(distDir, { providers = ['.claude', '.cursor', '.agents', '.gemini', '.github', '.kiro'], scriptCount = 8, extraSkills = ['audit', 'polish'] } = {}) {
  let files = 0;
  for (const provider of providers) {
    // The impeccable skill ships a scripts/ dir with many files, like the real
    // bundle. This is where most entries live.
    const scriptsDir = join(distDir, 'universal', provider, 'skills', 'impeccable', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(distDir, 'universal', provider, 'skills', 'impeccable', 'SKILL.md'), `---\nname: impeccable\n---\nprovider ${provider}\n`);
    files += 1;
    for (let i = 0; i < scriptCount; i++) {
      writeFileSync(join(scriptsDir, `script-${i}.mjs`), `// ${provider} script ${i}\nexport default ${i};\n`);
      files += 1;
    }
    // Sibling skills with a SKILL.md + a reference file each.
    for (const name of extraSkills) {
      const refDir = join(distDir, 'universal', provider, 'skills', name, 'reference');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(distDir, 'universal', provider, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
      writeFileSync(join(refDir, `${name}.md`), `# ${name} reference\n`);
      files += 2;
    }
    // Provider root config (mirrors .claude/settings.json, .cursor/hooks.json).
    writeFileSync(join(distDir, 'universal', provider, 'config.json'), '{}\n');
    files += 1;
  }
  return files;
}

/** Count regular files under a directory tree (used to assert full extraction). */
function countFiles(dir) {
  let count = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(d, entry.name));
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

describe('release bundle zip writer', () => {
  it('createAllZips produces a non-empty universal.zip that unpacks to the skill tree', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-zip-'));
    makeUniversalTree(dist);

    await createAllZips(dist);

    const zipPath = join(dist, 'universal.zip');
    assert.ok(existsSync(zipPath), 'universal.zip was not created');
    assert.ok(statSync(zipPath).size > 0, 'universal.zip is empty (0 bytes)');

    // Round-trip through the same unpacker the CLI uses (extractZip). The CLI
    // downloads this exact artifact and extractZip()s it.
    const out = mkdtempSync(join(tmpdir(), 'imp-unzip-'));
    await extractZip(zipPath, out);
    const skillMd = join(out, 'skills', 'impeccable', 'SKILL.md');
    assert.ok(existsSync(skillMd), 'unpacked bundle is missing skills/impeccable/SKILL.md');
    assert.match(readFileSync(skillMd, 'utf8'), /name: impeccable/);

    rmSync(dist, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('REGRESSION: extracts every entry of a many-file bundle (no silent partial extraction on Node v24.16.0+)', async () => {
    // Guards nodejs/node#63487: extract-zip's yauzl/fd-slicer read stack stalls
    // on Node v24.16.0 / v26.1.0+ (pause/resume on a destroyed stream became a
    // no-op), so extraction stops early, its promise never settles, and --
    // because nothing else keeps the event loop alive -- `npx impeccable install`
    // exits 0 with no error, silently installing a fraction of the bundle. This
    // fixture carries 84 files (well past the ~31 entry stall point), so a
    // unpacker that stops early fails the count assertion here instead of
    // shipping silently. fflate decompresses in-memory and is immune.
    const dist = mkdtempSync(join(tmpdir(), 'imp-zip-large-'));
    const written = makeLargeUniversalTree(dist);

    await createAllZips(dist);

    const zipPath = join(dist, 'universal.zip');
    assert.ok(existsSync(zipPath), 'universal.zip was not created');
    assert.ok(statSync(zipPath).size > 0, 'universal.zip is empty (0 bytes)');

    // Round-trip through the exact code path downloadAndExtractBundle runs.
    const out = mkdtempSync(join(tmpdir(), 'imp-unzip-large-'));
    await extractZip(zipPath, out);

    const extracted = countFiles(out);
    assert.equal(extracted, written, `partial extraction: only ${extracted} of ${written} files unpacked`);

    rmSync(dist, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('rejects a zip entry whose path escapes the target dir (zip-slip)', async () => {
    // extractZip writes entries itself, so it must refuse `../` traversal that a
    // malicious or malformed archive could use to land files outside targetDir.
    const dist = mkdtempSync(join(tmpdir(), 'imp-zip-slip-'));
    const { zipSync, strToU8 } = await import('fflate');
    const zipped = zipSync({ '../escaped.txt': strToU8('pwned\n') });
    const zipPath = join(dist, 'evil.zip');
    writeFileSync(zipPath, zipped);

    const out = mkdtempSync(join(tmpdir(), 'imp-unzip-slip-'));
    await assert.rejects(() => extractZip(zipPath, out), /outside target dir/);
    assert.ok(!existsSync(join(dist, 'escaped.txt')), 'zip-slip entry escaped the target dir');

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
