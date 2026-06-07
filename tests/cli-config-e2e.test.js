import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(import.meta.dir, '..', 'cli', 'engine', 'detect-antipatterns.mjs');

function scan(dir, args = []) {
  return spawnSync('node', [SCRIPT, 'detect', '--json', ...args, dir], { encoding: 'utf-8' });
}

describe('CLI config + suppression', () => {
  test('disabledRules in config removes those findings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-e2e-'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html><body><div style="border-left:4px solid red;border-radius:8px">x</div></body></html>',
    );
    const before = JSON.parse(scan(dir).stdout);
    expect(before.some(f => f.antipattern === 'border-accent-on-rounded' || f.antipattern === 'side-tab')).toBe(true);
    fs.writeFileSync(
      path.join(dir, 'impeccable.config.json'),
      JSON.stringify({ disabledRules: ['side-tab', 'border-accent-on-rounded'] }),
    );
    const after = JSON.parse(scan(dir).stdout);
    expect(after.some(f => f.antipattern === 'side-tab' || f.antipattern === 'border-accent-on-rounded')).toBe(false);
  });

  test('ignore glob skips matching files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-e2e-'));
    fs.mkdirSync(path.join(dir, 'vendor'));
    fs.writeFileSync(
      path.join(dir, 'vendor', 'v.css'),
      '.h{background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;color:transparent}',
    );
    fs.writeFileSync(path.join(dir, 'impeccable.config.json'), JSON.stringify({ ignore: ['vendor/**'] }));
    const res = JSON.parse(scan(dir).stdout);
    expect(res.every(f => !f.file.includes(`${path.sep}vendor${path.sep}`))).toBe(true);
  });

  test('inline disable comment suppresses a finding', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-e2e-'));
    fs.writeFileSync(
      path.join(dir, 'a.css'),
      '/* impeccable-disable-next-line gradient-text */\n.h{background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;color:transparent}',
    );
    const res = JSON.parse(scan(dir).stdout);
    expect(res.some(f => f.antipattern === 'gradient-text')).toBe(false);
  });
});
