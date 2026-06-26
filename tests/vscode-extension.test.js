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
import os from 'os';
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

  test('bundled SKILL.md and reference files use .github/skills/impeccable/scripts paths', () => {
    // Critical regression check (PR #312 bugbot finding): the install command
    // materializes the skill into the workspace at .github/skills/impeccable/,
    // so {{scripts_path}} must resolve to .github/skills/impeccable/scripts in
    // the bundled SKILL.md. The previous .vscode-ext/ configDir baked in paths
    // that did not exist in the target workspace, breaking every setup step.
    const skillContent = fs.readFileSync(
      path.join(VSCODE_DIST, 'skills', 'impeccable', 'SKILL.md'),
      'utf-8',
    );
    expect(skillContent).toContain('.github/skills/impeccable/scripts');
    expect(skillContent).not.toContain('.vscode-ext');

    const auditContent = fs.readFileSync(
      path.join(VSCODE_DIST, 'skills', 'impeccable', 'reference', 'audit.md'),
      'utf-8',
    );
    expect(auditContent).not.toContain('.vscode-ext');
  });
});

describe('VS Code extension install command (installSkill helper)', () => {
  // Load the built extension.js. require('vscode') is lazy inside activate(),
  // so loading the module without a vscode stub is safe; we only exercise the
  // pure-fs installSkill helper here.
  const extPath = path.join(VSCODE_DIST, 'extension.js');

  test('extension.js exports installSkill', () => {
    const ext = require(extPath);
    expect(typeof ext.installSkill).toBe('function');
  });

  test('installSkill materializes SKILL.md + reference/ + scripts/ in the workspace .github/ tree', () => {
    const ext = require(extPath);
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-vscode-install-'));
    try {
      ext.installSkill(VSCODE_DIST, tmpWorkspace);

      const skillRoot = path.join(tmpWorkspace, '.github', 'skills', 'impeccable');
      expect(fs.existsSync(path.join(skillRoot, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'reference', 'audit.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'scripts'))).toBe(true);
      const scriptFiles = fs.readdirSync(path.join(skillRoot, 'scripts'));
      expect(scriptFiles.length).toBeGreaterThan(0);

      // Every node script path referenced inside the installed SKILL.md must
      // resolve to a file that actually exists under the workspace .github/.
      const installedSkill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8');
      const scriptRefs = [...installedSkill.matchAll(/\.github\/skills\/impeccable\/scripts\/([\w.-]+)/g)];
      expect(scriptRefs.length).toBeGreaterThan(0);
      for (const [, scriptName] of scriptRefs) {
        const scriptPath = path.join(skillRoot, 'scripts', scriptName);
        expect(fs.existsSync(scriptPath)).toBe(true);
      }
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });

  test('installSkill writes .github/copilot-instructions.md mirroring SKILL.md content', () => {
    const ext = require(extPath);
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-vscode-install-'));
    try {
      ext.installSkill(VSCODE_DIST, tmpWorkspace);

      const instructionsPath = path.join(tmpWorkspace, '.github', 'copilot-instructions.md');
      expect(fs.existsSync(instructionsPath)).toBe(true);

      const skillContent = fs.readFileSync(
        path.join(tmpWorkspace, '.github', 'skills', 'impeccable', 'SKILL.md'),
        'utf-8',
      );
      const instructionsContent = fs.readFileSync(instructionsPath, 'utf-8');
      expect(instructionsContent).toBe(skillContent);
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });

  test('installSkill replaces any prior install rather than merging', () => {
    const ext = require(extPath);
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-vscode-install-'));
    try {
      // Seed a stale file the new install should not preserve.
      const staleFile = path.join(tmpWorkspace, '.github', 'skills', 'impeccable', 'STALE.md');
      fs.mkdirSync(path.dirname(staleFile), { recursive: true });
      fs.writeFileSync(staleFile, 'stale');

      ext.installSkill(VSCODE_DIST, tmpWorkspace);

      expect(fs.existsSync(staleFile)).toBe(false);
      expect(fs.existsSync(path.join(tmpWorkspace, '.github', 'skills', 'impeccable', 'SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
