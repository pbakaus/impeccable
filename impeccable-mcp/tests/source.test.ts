import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { clearImpeccableSourceCache, readImpeccableSource, resolveImpeccableRepoRoot } from '../src/impeccable/source.js';

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
});
