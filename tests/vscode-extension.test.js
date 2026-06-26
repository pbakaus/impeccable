// SPDX-License-Identifier: Apache-2.0
/**
 * Integration tests for the VS Code extension output in dist/vscode/.
 *
 * These tests assert on the generated extension package layout produced by
 * buildVSCodeExtension() in scripts/build.js. They require `bun run build`
 * (or `bun run build:extension:vscode`) to have been run first.
 */
import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const VSCODE_DIST = path.join(ROOT, 'dist', 'vscode');

describe('VS Code extension output (dist/vscode/)', () => {
  test('dist/vscode/ exists after build', () => {
    expect(fs.existsSync(VSCODE_DIST)).toBe(true);
  });

  test('package.json exists, parses, and has required fields', () => {
    const pkgPath = path.join(VSCODE_DIST, 'package.json');
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.publisher).toBe('pbakaus');
    expect(pkg.name).toBe('impeccable');
    expect(pkg.main).toBe('./extension.js');
    expect(pkg.engines?.vscode).toBeTruthy();
    expect(pkg.categories).toContain('Chat');
    expect(pkg.categories).toContain('AI');
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.repository?.url).toContain('pbakaus/impeccable');
  });

  test('extension.js exists and is non-empty', () => {
    const extPath = path.join(VSCODE_DIST, 'extension.js');
    expect(fs.existsSync(extPath)).toBe(true);
    const content = fs.readFileSync(extPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('activate');
    expect(content).toContain('deactivate');
  });

  test('skills/impeccable/SKILL.md exists and has frontmatter', () => {
    const skillPath = path.join(VSCODE_DIST, 'skills', 'impeccable', 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, 'utf-8');
    // Frontmatter present
    expect(content.startsWith('---')).toBe(true);
    expect(content).toContain('name: impeccable');
  });

  test('at least one reference file is bundled under skills/impeccable/reference/', () => {
    const refDir = path.join(VSCODE_DIST, 'skills', 'impeccable', 'reference');
    expect(fs.existsSync(refDir)).toBe(true);
    const files = fs.readdirSync(refDir);
    expect(files.length).toBeGreaterThan(0);
    // audit.md is a well-known reference file
    expect(fs.existsSync(path.join(refDir, 'audit.md'))).toBe(true);
  });

  test('LICENSE exists', () => {
    expect(fs.existsSync(path.join(VSCODE_DIST, 'LICENSE'))).toBe(true);
  });

  test('README.md exists', () => {
    expect(fs.existsSync(path.join(VSCODE_DIST, 'README.md'))).toBe(true);
  });

  test('.vscodeignore exists', () => {
    expect(fs.existsSync(path.join(VSCODE_DIST, '.vscodeignore'))).toBe(true);
  });

  test('package.json engines.vscode targets ^1.95.0 or later', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_DIST, 'package.json'), 'utf-8'));
    // Must be a caret-pinned VS Code version (^1.X.Y) with minor >= 95
    // Pattern: ^1. followed by two-digit minor 95-99 or three-digit minor 100+
    const VSCODE_ENGINES_MIN_1_95 = /^\^1\.(9[5-9]|\d{3,})\./;
    expect(pkg.engines?.vscode).toMatch(VSCODE_ENGINES_MIN_1_95);
  });
});
