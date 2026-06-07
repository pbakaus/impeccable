import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(import.meta.dir, '..', 'cli', 'engine', 'detect-antipatterns.mjs');

describe('CLI --sarif', () => {
  test('emits valid SARIF 2.1.0 to stdout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-sarif-'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html><body><div style="border-left:4px solid red;border-radius:8px">x</div></body></html>',
    );
    const res = spawnSync('node', [SCRIPT, 'detect', '--sarif', dir], { encoding: 'utf-8' });
    const sarif = JSON.parse(res.stdout);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('impeccable');
    expect(Array.isArray(sarif.runs[0].results)).toBe(true);
    expect(res.status).toBe(0); // SARIF mode exits 0 so the upload step always runs
  });

  test('emits a valid empty SARIF document for a clean scan', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-sarif-clean-'));
    fs.writeFileSync(path.join(dir, 'ok.css'), '.a { color: #222; }');
    const res = spawnSync('node', [SCRIPT, 'detect', '--sarif', dir], { encoding: 'utf-8' });
    const sarif = JSON.parse(res.stdout);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results.length).toBe(0);
  });
});
