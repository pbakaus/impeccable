import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveFixtureFile } from './fixture-path.mjs';

describe('resolveFixtureFile', () => {
  it('rejects traversal and symlinks that escape the fixture root', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-fixture-path-'));
    const root = path.join(workspace, 'fixtures');
    const outside = path.join(workspace, 'outside.html');

    try {
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, 'index.html'), '<main>fixture</main>');
      await fs.writeFile(outside, '<main>outside</main>');
      await fs.symlink(outside, path.join(root, 'linked.html'));

      assert.equal(
        resolveFixtureFile(root, '/index.html'),
        await fs.realpath(path.join(root, 'index.html')),
      );
      assert.throws(() => resolveFixtureFile(root, '/%2e%2e/outside.html'), /escapes root/);
      assert.throws(() => resolveFixtureFile(root, '/linked.html'), /escapes root/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
