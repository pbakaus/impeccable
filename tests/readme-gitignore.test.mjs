import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('README gitignore block', () => {
  let tmp;

  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('ignores ephemeral review and questions dirs while keeping shared artifacts tracked', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8').replace(/\r\n?/g, '\n');
    const match = readme.match(/```gitignore\n([\s\S]*?)```/);
    assert.ok(match, 'README.md should contain a fenced gitignore block');
    const block = match[1];
    assert.match(block, /# impeccable-ignore-start/);

    tmp = mkdtempSync(join(tmpdir(), 'impeccable-readme-gitignore-'));
    writeFileSync(join(tmp, '.gitignore'), block);
    execFileSync('git', ['init'], { cwd: tmp });

    const ignored = execFileSync('git', [
      'check-ignore',
      '.impeccable/review/desktop.png',
      '.impeccable/questions/fb63f8a6.log',
    ], { cwd: tmp, encoding: 'utf-8' });
    assert.match(ignored, /\.impeccable\/review\/desktop\.png/);
    assert.match(ignored, /\.impeccable\/questions\/fb63f8a6\.log/);

    for (const rel of ['.impeccable/config.json', '.impeccable/critique/report.md']) {
      const result = spawnSync('git', ['check-ignore', rel], { cwd: tmp });
      assert.notEqual(result.status, 0, `${rel} should not be ignored`);
    }
  });
});
