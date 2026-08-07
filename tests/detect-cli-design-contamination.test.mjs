/**
 * Regression: `impeccable detect <file-or-dir>` must resolve DESIGN.md from
 * EACH scan target's own project root, not from process.cwd().
 *
 * The bug (found during eval work): running detect from repo A against a file
 * that lives in repo B applied A's DESIGN.md to B — cross-project contamination.
 * These tests spawn the real CLI so the fix is exercised end to end.
 *
 * Run with: node --test tests/detect-cli-design-contamination.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../cli/bin/cli.js');

// Verdana is a plain web-safe font: it is not in OVERUSED_FONTS and trips no
// standalone rule, so the only way it becomes a `design-system-font` finding is
// if a DESIGN.md that forbids it gets applied.
const PAGE_HTML =
  '<!doctype html><html><head><style>.card { font-family: Verdana, sans-serif; }</style></head>' +
  '<body><div class="card">Hi</div></body></html>';

// A DESIGN.md whose typography allows only Palatino — Verdana violates it.
const DESIGN_MD = `---
typography:
  body:
    fontFamily: "Palatino, Georgia, serif"
---
# Project A Design System
`;

const tempRoots = [];

function mkProject({ withDesign, withMarker = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-contam-'));
  tempRoots.push(dir);
  if (withMarker) fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fixture"}');
  if (withDesign) fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, PAGE_HTML);
  return { dir, page };
}

// Run the CLI from `cwd`; force the node binary so the HTML/jsdom path never
// runs under bun (which is unusably slow).
function runDetect(cwd, targets) {
  const result = spawnSync(process.execPath, [CLI, 'detect', '--json', ...targets], {
    cwd,
    encoding: 'utf-8',
  });
  let findings = [];
  try {
    findings = JSON.parse(result.stdout || '[]');
  } catch {
    throw new Error(`Non-JSON CLI output.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return findings;
}

function fontFindingsFor(findings, file) {
  return findings.filter(
    (f) => f.antipattern === 'design-system-font' && (!file || f.file === file),
  );
}

let projA;
let projB;

before(() => {
  projA = mkProject({ withDesign: true }); // DESIGN.md forbids Verdana
  projB = mkProject({ withDesign: false }); // its own project, no DESIGN.md
});

after(() => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('detect CLI DESIGN.md resolution', () => {
  it('does NOT apply cwd project A\'s DESIGN.md to project B\'s file (the contamination bug)', () => {
    const findings = runDetect(projA.dir, [projB.page]);
    assert.deepEqual(
      fontFindingsFor(findings, projB.page).map((f) => f.ignoreValue),
      [],
      'project B\'s Verdana must not be flagged by project A\'s DESIGN.md',
    );
  });

  it('still applies a project\'s own DESIGN.md to its own file (positive control)', () => {
    const findings = runDetect(projA.dir, [projA.page]);
    assert.ok(
      fontFindingsFor(findings, projA.page).some((f) => f.ignoreValue === 'verdana'),
      'project A\'s own DESIGN.md must flag Verdana in project A\'s file',
    );
  });

  it('resolves per target when one scan spans two projects', () => {
    const findings = runDetect(projA.dir, [projA.page, projB.page]);
    assert.ok(
      fontFindingsFor(findings, projA.page).length > 0,
      'A\'s file should be judged against A\'s DESIGN.md',
    );
    assert.equal(
      fontFindingsFor(findings, projB.page).length,
      0,
      'B\'s file should NOT be judged against A\'s DESIGN.md',
    );
  });

  it('applies a repo-root DESIGN.md to a file under a monorepo subpackage boundary', () => {
    // Monorepo shape: .git + DESIGN.md at the repo root, a web/ subpackage with
    // its own package.json and no DESIGN.md. The subpackage boundary must not
    // hide the repo root's design system from files under web/.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-'));
    tempRoots.push(repo);
    fs.mkdirSync(path.join(repo, '.git'));
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"monorepo-root"}');
    fs.writeFileSync(path.join(repo, 'DESIGN.md'), DESIGN_MD);
    fs.mkdirSync(path.join(repo, 'web'));
    fs.writeFileSync(path.join(repo, 'web', 'package.json'), '{"name":"web"}');
    const page = path.join(repo, 'web', 'page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(repo, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'the repo-root DESIGN.md must govern files under the web/ subpackage',
    );
  });

  it('falls back to no design system for a bare file with no project markers above it', () => {
    // A lone file whose directory has neither .git, package.json, nor .impeccable.
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-bare-'));
    tempRoots.push(bareDir);
    const barePage = path.join(bareDir, 'page.html');
    fs.writeFileSync(barePage, PAGE_HTML);

    const findings = runDetect(projA.dir, [barePage]);
    assert.equal(
      fontFindingsFor(findings, barePage).length,
      0,
      'a project-less file must fall back to no design system, not cwd\'s',
    );
  });
});
