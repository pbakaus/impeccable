import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  clearImpeccableSourceCache,
  deploymentCommitFromEnv,
  readImpeccableSource,
  resolveImpeccableRepoRoot,
} from '../src/impeccable/source.js';

describe('Impeccable source reader', () => {
  it('resolves the parent Impeccable repo root', async () => {
    const root = await resolveImpeccableRepoRoot();
    expect(root.endsWith('impeccable')).toBe(true);
  });

  it('reads canonical source artifacts and commit', async () => {
    clearImpeccableSourceCache();
    const snapshot = await readImpeccableSource();
    expect(snapshot.packageName).toBe('impeccable');
    expect(snapshot.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(snapshot.commit).toMatch(/^[a-f0-9]{40}$|^unknown$/);
    expect(snapshot.skillMarkdown).toContain('impeccable');
    expect(snapshot.harnessesMarkdown).toContain('Agent Skills');
    expect(snapshot.commandMetadata.shape.description).toContain('Plan UX');
    for (const command of ['shape', 'critique', 'audit', 'polish']) {
      expect(snapshot.references[command]).toContain(command);
      expect(path.isAbsolute(path.join(snapshot.repoRoot, `skill/reference/${command}.md`))).toBe(true);
    }
  });

  it('memoizes source snapshots for repeated MCP requests', async () => {
    clearImpeccableSourceCache();
    const first = await readImpeccableSource();
    const second = await readImpeccableSource();
    expect(second).toBe(first);
  });

  it('uses a deployment-provided commit when git metadata is unavailable', () => {
    const original = process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.RAILWAY_GIT_COMMIT_SHA = 'a'.repeat(40);
    try {
      expect(deploymentCommitFromEnv()).toBe('a'.repeat(40));
    } finally {
      if (original === undefined) {
        delete process.env.RAILWAY_GIT_COMMIT_SHA;
      } else {
        process.env.RAILWAY_GIT_COMMIT_SHA = original;
      }
    }
  });
});
