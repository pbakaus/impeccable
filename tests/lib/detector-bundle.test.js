import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { readSourceFiles } from '../../scripts/lib/utils.js';

const ROOT = process.cwd();

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
  });

  test('static HTML parser vendor bundle matches the source digest', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/build-static-html-parsers.js'), '--check'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `--check exited ${result.status}`);
    }
    expect(result.status).toBe(0);
  });

  test('static HTML parser --check fails when the vendor bundle is stale', () => {
    const vendor = path.join(ROOT, 'cli/engine/vendor/static-html-parsers.mjs');
    const original = fs.readFileSync(vendor, 'utf8');
    try {
      fs.writeFileSync(vendor, original.replace(/Source digest: [0-9a-f]+/, 'Source digest: deadbeefdeadbeef'));
      const result = spawnSync(
        process.execPath,
        [path.join(ROOT, 'scripts/build-static-html-parsers.js'), '--check'],
        { cwd: ROOT, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
    } finally {
      fs.writeFileSync(vendor, original);
    }
  });

  test('critique references the bundled detector command', () => {
    const critique = fs.readFileSync(path.join(ROOT, 'skill/reference/critique.md'), 'utf-8');

    expect(critique).toContain('node {{scripts_path}}/detect.mjs --json [target]');
    expect(critique).not.toContain('npx impeccable detect');
  });
});
