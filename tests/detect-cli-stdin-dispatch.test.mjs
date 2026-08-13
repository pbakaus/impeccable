import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'cli', 'bin', 'cli.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-stdin-dispatch-'));

function detectStdinFile(filePath) {
  const result = spawnSync(
    process.execPath,
    [cli, 'detect', '--json', '--no-config', '--no-design-system'],
    {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 2, result.stderr);
  return JSON.parse(result.stdout);
}

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('detect CLI stdin file dispatch', () => {
  it('uses the static HTML engine for an HTML tool-input path', () => {
    const filePath = path.join(tempDir, 'page.html');
    fs.writeFileSync(
      path.join(tempDir, 'page.css'),
      '.notice { border-left: 4px solid blue; border-radius: 12px; }',
    );
    fs.writeFileSync(filePath, `
      <!doctype html>
      <link rel="stylesheet" href="./page.css">
      <div class="notice">Notice</div>
    `);

    const findings = detectStdinFile(filePath);
    assert.ok(findings.some(
      (item) => item.file === filePath && item.antipattern === 'side-tab',
    ));
  });

  it('uses the text engine for a non-HTML tool-input path', () => {
    const filePath = path.join(tempDir, 'styles.css');
    fs.writeFileSync(filePath, `
      .grid {
        background-image:
          linear-gradient(#eee 1px, transparent 1px),
          linear-gradient(90deg, #eee 1px, transparent 1px);
        background-size: 24px 24px;
      }
    `);

    const findings = detectStdinFile(filePath);
    assert.ok(findings.some(
      (item) => item.file === filePath && item.antipattern === 'codex-grid-background',
    ));
  });
});
