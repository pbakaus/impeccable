import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skill',
  'scripts',
  'scan-copy.mjs',
);

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-scan-copy-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('scan-copy.mjs', () => {
  it('scans locale json files and reports evidence metadata', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({
        'app.title': 'Taskflow',
        'form.email.error': 'Enter a valid email address',
        'empty.projects': 'No projects yet',
        'button.save': 'Save',
      }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.localeFiles, 1);
    assert.equal(data.stats.totalKeys, 4);
    assert.match(data.disclaimer, /Do NOT treat frequentStrings as voice/);
    assert.ok(data.samples.errors || data.samples.forms || data.samples.empty);
  });

  it('returns empty stats when no locale files exist', () => {
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.localeFiles, 0);
    assert.equal(data.stats.totalKeys, 0);
  });
});
