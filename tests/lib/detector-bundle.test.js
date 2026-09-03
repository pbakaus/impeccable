import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { readSourceFiles } from '../../scripts/lib/utils.js';

const ROOT = process.cwd();
const VENDOR_DIR = path.join(ROOT, 'cli/engine/vendor');
const VENDOR_FILES = [
  'static-html-parsers.mjs',
  'static-html-parsers.LICENSES.txt',
];

function runFreshnessCheck(checkDir) {
  const args = [path.join(ROOT, 'scripts/build-static-html-parsers.js'), '--check'];
  if (checkDir) args.push('--check-dir', checkDir);
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
}

function withCopiedVendor(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-parser-vendor-'));
  try {
    for (const name of VENDOR_FILES) {
      fs.copyFileSync(path.join(VENDOR_DIR, name), path.join(tempDir, name));
    }
    callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('skill detector bundle', () => {
  test('adds the detector wrapper and engine files to skill scripts', () => {
    const { skills } = readSourceFiles(ROOT);
    const skill = skills.find(s => s.name === 'impeccable');
    const scriptNames = new Set(skill.scripts.map(s => s.name));

    expect(scriptNames.has('detect.mjs')).toBe(true);
    expect(scriptNames.has('detector/detect-antipatterns.mjs')).toBe(true);
    expect(scriptNames.has('detector/detect-antipatterns-browser.js')).toBe(true);
    expect(scriptNames.has('detector/cli/main.mjs')).toBe(true);
    expect(scriptNames.has('detector/engines/static-html/detect-html.mjs')).toBe(true);
    expect(scriptNames.has('detector/vendor/static-html-parsers.mjs')).toBe(true);
    expect(scriptNames.has('detector/vendor/static-html-parsers.LICENSES.txt')).toBe(true);
  });

  test('static HTML parser vendor bundle matches a fresh rebuild', () => {
    const result = runFreshnessCheck();
    expect(result.status).toBe(0);
  });

  test('static HTML parser --check fails when the vendor bundle is stale', () => {
    withCopiedVendor((tempDir) => {
      const vendor = path.join(tempDir, 'static-html-parsers.mjs');
      fs.appendFileSync(vendor, '// stale\n');
      const result = runFreshnessCheck(tempDir);
      expect(result.status).toBe(1);
    });
  });

  test('static HTML parser --check fails when bundled licenses are stale', () => {
    withCopiedVendor((tempDir) => {
      const licenses = path.join(tempDir, 'static-html-parsers.LICENSES.txt');
      fs.appendFileSync(licenses, 'stale\n');
      const result = runFreshnessCheck(tempDir);
      expect(result.status).toBe(1);
    });
  });

  test('static HTML parser bundle stays compact and carries every dependency license', () => {
    const bundle = fs.readFileSync(path.join(VENDOR_DIR, 'static-html-parsers.mjs'));
    const licenses = fs.readFileSync(path.join(VENDOR_DIR, 'static-html-parsers.LICENSES.txt'), 'utf8');
    expect(bundle.byteLength).toBeLessThanOrEqual(256 * 1024);
    for (const packageName of [
      'boolbase',
      'css-select',
      'css-tree',
      'css-what',
      'dom-serializer',
      'domelementtype',
      'domhandler',
      'domutils',
      'entities',
      'htmlparser2',
      'nth-check',
      'source-map-js',
    ]) {
      expect(licenses).toContain(`Package: ${packageName}@`);
    }
  });

  test('critique references the bundled detector command', () => {
    const critique = fs.readFileSync(path.join(ROOT, 'skill/reference/critique.md'), 'utf-8');

    expect(critique).toContain('node {{scripts_path}}/detect.mjs --json [target]');
    expect(critique).not.toContain('npx impeccable detect');
  });
});
