import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LIVE_SERVER_SCRIPT = join(REPO_ROOT, 'skill', 'scripts', 'live-server.mjs');

describe('live-server import behavior', () => {
  it('does not chdir or start the server when imported as a module', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-live-server-import-'));
    try {
      mkdirSync(join(tmp, 'apps', 'dashboard'), { recursive: true });
      const code = `
        const before = process.cwd();
        await import(${JSON.stringify(pathToFileURL(LIVE_SERVER_SCRIPT).href)});
        if (process.cwd() !== before) {
          throw new Error('cwd changed from ' + before + ' to ' + process.cwd());
        }
        console.log('import-ok');
      `;
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: join(tmp, 'apps', 'dashboard'),
        encoding: 'utf-8',
        timeout: 2_000,
      });
      assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      assert.match(res.stdout, /import-ok/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
