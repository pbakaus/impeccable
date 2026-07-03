import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectMarkup } from '../src/impeccable/detect.js';
import type { ImpeccableSourceSnapshot } from '../src/impeccable/source.js';
import { readImpeccableSource } from '../src/impeccable/source.js';

function fakeSnapshot(repoRoot: string): ImpeccableSourceSnapshot {
  return {
    repoRoot,
    commit: 'unknown',
    packageName: 'impeccable',
    packageVersion: '0.0.0',
    skillMarkdown: '',
    commandMetadata: {},
    references: {},
    harnessesMarkdown: '',
  };
}

describe('detector bridge', () => {
  it('uses upstream detectText for submitted markup', async () => {
    const result = await detectMarkup(await readImpeccableSource(), {
      text: '<div class="border-l-4 border-blue-500">Hello</div>',
      language: 'html',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok detection');
    expect(result.source.detectorPath).toContain('cli/engine/detect-antipatterns.mjs');
    expect(result.findings.some((finding) => finding.ruleId === 'side-tab')).toBe(true);
  });

  it('returns unsupported_input for empty text', async () => {
    const result = await detectMarkup(await readImpeccableSource(), { text: '' });
    expect(result.status).toBe('unsupported_input');
  });

  it('sanitizes submitted filenames before creating detector temp files', async () => {
    const result = await detectMarkup(await readImpeccableSource(), {
      text: '<div class="border-l-4 border-blue-500">Hello</div>',
      language: 'html',
      filename: '../outside.html',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok detection');
    expect(result.findings.some((finding) => finding.file.endsWith('/outside.html'))).toBe(true);
    expect(result.findings.every((finding) => !finding.file.includes('/../'))).toBe(true);
  });

  it('replaces reserved submitted filenames with a safe fallback', async () => {
    const result = await detectMarkup(await readImpeccableSource(), {
      text: '<div class="border-l-4 border-blue-500">Hello</div>',
      language: 'html',
      filename: '..',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok detection');
    expect(result.findings.some((finding) => finding.file.endsWith('/submitted.html'))).toBe(true);
  });

  it('returns a controlled fallback when detector execution times out', async () => {
    const originalTimeout = process.env.IMPECCABLE_DETECTOR_TIMEOUT_MS;
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-mcp-timeout-test-'));
    await fs.mkdir(path.join(repoRoot, 'cli/engine'), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'cli/engine/detect-antipatterns.mjs'),
      `export function detectText() {
        const end = Date.now() + 2000;
        while (Date.now() < end) {}
        return [];
      }`,
      'utf8',
    );

    try {
      process.env.IMPECCABLE_DETECTOR_TIMEOUT_MS = '50';
      const result = await detectMarkup(fakeSnapshot(repoRoot), {
        text: '<div class="border-l-4 border-blue-500">Hello</div>',
        language: 'html',
      });
      expect(result.status).toBe('unsupported_input');
      if (result.status !== 'unsupported_input') throw new Error('expected unsupported_input timeout');
      expect(result.reason).toContain('Detector did not complete within');
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.IMPECCABLE_DETECTOR_TIMEOUT_MS;
      } else {
        process.env.IMPECCABLE_DETECTOR_TIMEOUT_MS = originalTimeout;
      }
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('returns a controlled fallback when detector setup fails', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-mcp-missing-detector-test-'));
    try {
      const result = await detectMarkup(fakeSnapshot(repoRoot), {
        text: '<div class="border-l-4 border-blue-500">Hello</div>',
        language: 'html',
      });
      expect(result.status).toBe('unsupported_input');
      if (result.status !== 'unsupported_input') throw new Error('expected unsupported_input failure');
      expect(result.reason).toContain('Detector failed:');
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
