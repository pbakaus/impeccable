import { describe, expect, test } from 'bun:test';
import path from 'path';
import {
  ALLOWED_BUNDLE_PROVIDERS,
  ALLOWED_FILE_PROVIDERS,
  isAllowedBundleProvider,
  isAllowedFileProvider,
  isAllowedProvider,
} from '../../server/lib/validation.js';
import { getFilePath, handleFileDownload } from '../../server/lib/api-handlers.js';

describe('download provider validation', () => {
  test('allows opencode, pi, and qoder as individual download providers', () => {
    expect(ALLOWED_FILE_PROVIDERS).toContain('opencode');
    expect(ALLOWED_FILE_PROVIDERS).toContain('pi');
    expect(ALLOWED_FILE_PROVIDERS).toContain('qoder');
    expect(isAllowedFileProvider('opencode')).toBe(true);
    expect(isAllowedFileProvider('pi')).toBe(true);
    expect(isAllowedFileProvider('qoder')).toBe(true);
  });

  test('separates file downloads from bundle downloads', () => {
    expect(ALLOWED_BUNDLE_PROVIDERS).toContain('universal');
    expect(ALLOWED_BUNDLE_PROVIDERS).toContain('universal-prefixed');
    expect(isAllowedBundleProvider('universal')).toBe(true);
    expect(isAllowedProvider('universal')).toBe(true);
    expect(isAllowedFileProvider('universal')).toBe(false);
  });
});

describe('download file paths', () => {
  test('maps opencode skills into the .opencode config directory', () => {
    expect(getFilePath('skill', 'opencode', 'frontend-design')).toBe(
      path.join(process.cwd(), 'dist', 'opencode', '.opencode', 'skills', 'frontend-design', 'SKILL.md')
    );
  });

  test('maps pi commands into the .pi config directory', () => {
    expect(getFilePath('command', 'pi', 'audit')).toBe(
      path.join(process.cwd(), 'dist', 'pi', '.pi', 'skills', 'audit', 'SKILL.md')
    );
  });

  test('maps qoder skills into the .qoder config directory', () => {
    expect(getFilePath('skill', 'qoder', 'colorize')).toBe(
      path.join(process.cwd(), 'dist', 'qoder', '.qoder', 'skills', 'colorize', 'SKILL.md')
    );
  });

  test('rejects bundle-only providers on the individual download route', async () => {
    const response = await handleFileDownload('skill', 'universal', 'frontend-design');
    expect(response.status).toBe(400);
  });
});
