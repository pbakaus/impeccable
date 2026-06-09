import { describe, expect, test } from 'bun:test';
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
  });

  test('critique references the bundled detector command', () => {
    const critique = fs.readFileSync(path.join(ROOT, 'skill/reference/critique.md'), 'utf-8');

    expect(critique).toContain('node {{scripts_path}}/detect.mjs --json [target]');
    expect(critique).not.toContain('npx impeccable detect');
  });
});
