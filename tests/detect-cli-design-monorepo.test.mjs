/**
 * Regression for issue #570: design-system rules must reach a monorepo workspace
 * by inheriting the repo root's DESIGN.md.
 *
 * Run with: node --test tests/detect-cli-design-monorepo.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findDesignRoot } from '../cli/engine/design-system.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../cli/bin/cli.js');

const PAGE_HTML =
  '<!doctype html><html><head><style>.card { font-family: Verdana, sans-serif; }</style></head>' +
  '<body><div class="card">Hi</div></body></html>';

const DESIGN_MD = `---
typography:
  body:
    fontFamily: "Palatino, Georgia, serif"
---
# Project A Design System
`;

const tempRoots = [];

function runDetect(cwd, targets, env = {}) {
  const result = spawnSync(process.execPath, [CLI, 'detect', '--json', ...targets], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
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

function mkPnpmMonorepo({ workspaceDesign = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-pnpm-'));
  tempRoots.push(dir);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps/web/package.json'), '{"name":"web"}');
  const page = path.join(dir, 'apps/web/page.html');
  fs.writeFileSync(page, PAGE_HTML);
  if (workspaceDesign) {
    fs.writeFileSync(path.join(dir, 'apps/web/DESIGN.md'), workspaceDesign);
  }
  return { dir, page, webDir: path.join(dir, 'apps/web') };
}

function mkTempRoot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('detect CLI monorepo DESIGN.md inheritance', () => {
  it('pnpm workspace root: workspace page inherits root DESIGN.md', () => {
    const { dir, page } = mkPnpmMonorepo();
    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'Verdana must be flagged via inherited root DESIGN.md',
    );
  });

  it('npm/yarn workspaces root: workspace page inherits root DESIGN.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-npm-'));
    tempRoots.push(dir);
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"mono","workspaces":["packages/*"]}');
    fs.mkdirSync(path.join(dir, 'packages/ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/ui/package.json'), '{"name":"ui"}');
    const page = path.join(dir, 'packages/ui/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'Verdana must be flagged via inherited root DESIGN.md',
    );
  });

  it('turbo marker root: workspace page inherits root DESIGN.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-turbo-'));
    tempRoots.push(dir);
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"mono"}');
    fs.writeFileSync(path.join(dir, 'turbo.json'), '{}');
    fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/web/package.json'), '{"name":"web"}');
    const page = path.join(dir, 'apps/web/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'Verdana must be flagged via inherited root DESIGN.md',
    );
  });

  it('lerna packages globs: workspace outside apps/packages inherits root DESIGN.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-lerna-'));
    tempRoots.push(dir);
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'lerna.json'), '{"packages":["modules/*"]}');
    fs.mkdirSync(path.join(dir, 'modules/web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'modules/web/package.json'), '{"name":"web"}');
    const page = path.join(dir, 'modules/web/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'lerna packages globs must be read as workspace declarations',
    );
  });

  it('impeccable projectRoots: workspace inherits root DESIGN.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-iroots-'));
    tempRoots.push(dir);
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.mkdirSync(path.join(dir, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.impeccable/config.json'), '{"projectRoots":["sites/*"]}');
    fs.mkdirSync(path.join(dir, 'sites/docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sites/docs/package.json'), '{"name":"docs"}');
    const page = path.join(dir, 'sites/docs/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'impeccable projectRoots must be read as workspace declarations',
    );
  });

  it('pnpm flow list with inline comment and non-standard dirs still detected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-flow-'));
    tempRoots.push(dir);
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages: ["services/*"] # deploy targets\n');
    fs.mkdirSync(path.join(dir, 'services/api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'services/api/package.json'), '{"name":"api"}');
    const page = path.join(dir, 'services/api/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'inline YAML comment must not defeat workspace-glob recognition',
    );
  });

  it('directory target: scan apps/web dir inherits root DESIGN.md', () => {
    const { dir, page, webDir } = mkPnpmMonorepo();
    const findings = runDetect(dir, [webDir]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'Verdana must be flagged when scanning the workspace directory',
    );
  });

  it('workspace-owned DESIGN.md wins over monorepo root', () => {
    const workspaceDesign = `---
typography:
  body:
    fontFamily: "Verdana, sans-serif"
---
# Workspace Design System
`;
    const { dir, page } = mkPnpmMonorepo({ workspaceDesign });
    const findings = runDetect(dir, [page]);
    assert.equal(
      fontFindingsFor(findings, page).length,
      0,
      'workspace DESIGN.md allowing Verdana must suppress inherited root rules',
    );
  });

  it('nested separate repo inherits nothing from monorepo root', () => {
    const { dir } = mkPnpmMonorepo();
    fs.mkdirSync(path.join(dir, 'vendor/other/.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vendor/other/package.json'), '{"name":"other"}');
    const page = path.join(dir, 'vendor/other/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.equal(
      fontFindingsFor(findings, page).length,
      0,
      'nested repo with no workspaces must not inherit monorepo root DESIGN.md',
    );
  });

  it('home directory is never an owning monorepo root', () => {
    // context.mjs's findMonorepoRoot stops at homeDir before its monorepo
    // check; the engine walk must match, or a workspace-declaring $HOME
    // leaks its DESIGN.md into every git-less project beneath it.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-home-'));
    tempRoots.push(home);
    fs.writeFileSync(path.join(home, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(home, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    fs.mkdirSync(path.join(home, 'project'), { recursive: true });
    fs.writeFileSync(path.join(home, 'project/package.json'), '{"name":"p"}');
    const page = path.join(home, 'project/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(home, [page], { HOME: home, USERPROFILE: home });
    assert.equal(
      fontFindingsFor(findings, page).length,
      0,
      'a project under a workspace-declaring $HOME must not inherit its DESIGN.md',
    );
  });

  it('symlinked $HOME still stops the walk', () => {
    // Some distros symlink home paths (/home -> /var/home), so $HOME never
    // string-matches the physical paths a cwd-resolved target produces. The
    // walk must compare against the realpath form too.
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-detect-mono-realhome-'));
    tempRoots.push(real);
    const link = path.join(os.tmpdir(), `impeccable-detect-mono-linkhome-${path.basename(real).slice(-6)}`);
    fs.symlinkSync(real, link);
    tempRoots.push(link);
    fs.writeFileSync(path.join(real, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(real, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    fs.mkdirSync(path.join(real, 'project'), { recursive: true });
    fs.writeFileSync(path.join(real, 'project/package.json'), '{"name":"p"}');
    const page = path.join(real, 'project/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    // HOME is the symlink; the target is passed via its physical path, so a
    // logical-only comparison would walk straight past home and inherit.
    const findings = runDetect(real, [fs.realpathSync(page)], { HOME: link, USERPROFILE: link });
    assert.equal(
      fontFindingsFor(findings, page).length + fontFindingsFor(findings, fs.realpathSync(page)).length,
      0,
      'a symlinked $HOME must still stop the walk before inheriting',
    );
  });

  it('CSS module at apps/web/app/page.module.css inherits root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-cssmod-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    fs.mkdirSync(path.join(dir, 'apps/web/app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/web/package.json'), '{"name":"web"}');
    const css = path.join(dir, 'apps/web/app/page.module.css');
    fs.writeFileSync(css, '.c{font-family:Verdana,sans-serif}');

    const findings = runDetect(dir, [css]);
    assert.ok(
      fontFindingsFor(findings, css).some((f) => f.ignoreValue?.toLowerCase() === 'verdana'),
      'Verdana in a CSS module must be flagged via inherited root DESIGN.md',
    );
  });

  it('yarn workspaces object form: workspace inherits root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-yarnobj-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: { packages: ['packages/*'] },
    }));
    fs.mkdirSync(path.join(dir, 'packages/ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/ui/package.json'), '{"name":"ui"}');
    const page = path.join(dir, 'packages/ui/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'yarn workspaces object form must inherit root DESIGN.md',
    );
  });

  it('nx.json marker root: workspace inherits root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-nx-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"mono"}');
    fs.writeFileSync(path.join(dir, 'nx.json'), '{}');
    fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/web/package.json'), '{"name":"web"}');
    const page = path.join(dir, 'apps/web/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'nx.json marker root must inherit root DESIGN.md',
    );
  });

  it('file at monorepo root still flags against root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-rootfile-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'root-level file must be judged against root DESIGN.md',
    );
  });

  it('scan from different cwd still inherits via target path', () => {
    const { page } = mkPnpmMonorepo();
    const otherCwd = mkTempRoot('impeccable-detect-mono-othercwd-');

    const findings = runDetect(otherCwd, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'resolution must follow the target path, not process.cwd()',
    );
  });

  it('findDesignRoot(apps/web) returns monorepo root with hasDesign true', () => {
    const { dir, webDir } = mkPnpmMonorepo();
    const found = findDesignRoot(webDir);
    assert.equal(found.dir, dir);
    assert.equal(found.hasDesign, true);
  });

  it('negated workspace package does not inherit root DESIGN.md (Greptile P1)', () => {
    const dir = mkTempRoot('impeccable-detect-mono-negated-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['packages/*', '!packages/excluded'],
    }));
    fs.mkdirSync(path.join(dir, 'packages/included'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/included/package.json'), '{"name":"included"}');
    const includedPage = path.join(dir, 'packages/included/page.html');
    fs.writeFileSync(includedPage, PAGE_HTML);
    fs.mkdirSync(path.join(dir, 'packages/excluded'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/excluded/package.json'), '{"name":"excluded"}');
    const excludedPage = path.join(dir, 'packages/excluded/page.html');
    fs.writeFileSync(excludedPage, PAGE_HTML);
    const excludedDir = path.join(dir, 'packages/excluded');

    const findings = runDetect(dir, [includedPage, excludedPage]);
    assert.ok(
      fontFindingsFor(findings, includedPage).some((f) => f.ignoreValue === 'verdana'),
      'included workspace package must inherit root DESIGN.md',
    );
    assert.equal(
      fontFindingsFor(findings, excludedPage).length,
      0,
      'negated workspace package must not inherit root DESIGN.md',
    );
    const excludedRoot = findDesignRoot(excludedDir);
    assert.equal(excludedRoot.dir, excludedDir);
    assert.equal(excludedRoot.hasDesign, false);
  });

  it('stray nested package outside globs does not inherit root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-stray-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/web/package.json'), '{"name":"web"}');
    const webPage = path.join(dir, 'apps/web/page.html');
    fs.writeFileSync(webPage, PAGE_HTML);
    fs.mkdirSync(path.join(dir, 'vendor/tool'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vendor/tool/package.json'), '{"name":"tool"}');
    const vendorPage = path.join(dir, 'vendor/tool/page.html');
    fs.writeFileSync(vendorPage, PAGE_HTML);

    const findings = runDetect(dir, [webPage, vendorPage]);
    assert.ok(
      fontFindingsFor(findings, webPage).some((f) => f.ignoreValue === 'verdana'),
      'apps/web must inherit root DESIGN.md',
    );
    assert.equal(
      fontFindingsFor(findings, vendorPage).length,
      0,
      'vendor/tool outside globs must not inherit root DESIGN.md',
    );
  });

  it('non-monorepo nested package.json does not inherit root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-nestedpkg-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"root"}');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'packages/nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/nested/package.json'), '{"name":"nested"}');
    const nestedPage = path.join(dir, 'packages/nested/page.html');
    fs.writeFileSync(nestedPage, PAGE_HTML);

    const findings = runDetect(dir, [nestedPage]);
    assert.equal(
      fontFindingsFor(findings, nestedPage).length,
      0,
      'nested package.json in a non-monorepo must not inherit root DESIGN.md',
    );
  });

  it('non-monorepo without DESIGN.md: no design-system-font findings', () => {
    const dir = mkTempRoot('impeccable-detect-mono-nodesign-');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"root"}');
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.equal(
      fontFindingsFor(findings, page).length,
      0,
      'no DESIGN.md means no design-system-font findings',
    );
  });

  it('single-package repo: src/page.html inherits root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-single-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app"}');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const page = path.join(dir, 'src/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'src/ without its own package.json must inherit project DESIGN.md',
    );
  });

  it('DESIGN.md in docs/ fallback still flags in single-package repo', () => {
    const dir = mkTempRoot('impeccable-detect-mono-docsfb-');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app"}');
    const page = path.join(dir, 'src/page.html');
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'docs/DESIGN.md fallback must apply to nested files',
    );
  });

  it('pnpm !**/test/** does not smash sibling workspaces', () => {
    const dir = mkTempRoot('impeccable-detect-mono-globstar-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), [
      'packages:',
      "  - 'packages/*'",
      "  - 'components/**'",
      "  - '!**/test/**'",
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(dir, 'packages/ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/ui/package.json'), '{"name":"ui"}');
    const uiPage = path.join(dir, 'packages/ui/page.html');
    fs.writeFileSync(uiPage, PAGE_HTML);
    fs.mkdirSync(path.join(dir, 'components/button'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'components/button/package.json'), '{"name":"button"}');
    const buttonPage = path.join(dir, 'components/button/page.html');
    fs.writeFileSync(buttonPage, PAGE_HTML);
    fs.mkdirSync(path.join(dir, 'packages/ui/test/fixture'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/ui/test/fixture/package.json'), '{"name":"fixture"}');
    const testPage = path.join(dir, 'packages/ui/test/fixture/page.html');
    fs.writeFileSync(testPage, PAGE_HTML);

    const findings = runDetect(dir, [uiPage, buttonPage, testPage]);
    assert.ok(
      fontFindingsFor(findings, uiPage).some((f) => f.ignoreValue === 'verdana'),
      'packages/ui must still inherit when a globstar test exclusion is present',
    );
    assert.ok(
      fontFindingsFor(findings, buttonPage).some((f) => f.ignoreValue === 'verdana'),
      'components/** must still inherit when a globstar test exclusion is present',
    );
    assert.equal(
      fontFindingsFor(findings, testPage).length,
      0,
      'packages/ui/test/fixture must not inherit under !**/test/**',
    );
  });

  it('workspaces ["*"] owns only direct children, not vendor/tool', () => {
    const dir = mkTempRoot('impeccable-detect-mono-star-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['*'],
    }));
    fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web/package.json'), '{"name":"web"}');
    const webPage = path.join(dir, 'web/page.html');
    fs.writeFileSync(webPage, PAGE_HTML);
    fs.mkdirSync(path.join(dir, 'web/examples'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web/examples/package.json'), '{"name":"examples"}');
    const nestedPage = path.join(dir, 'web/examples/page.html');
    fs.writeFileSync(nestedPage, PAGE_HTML);
    fs.mkdirSync(path.join(dir, 'vendor/tool'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vendor/tool/package.json'), '{"name":"tool"}');
    const vendorPage = path.join(dir, 'vendor/tool/page.html');
    fs.writeFileSync(vendorPage, PAGE_HTML);

    const findings = runDetect(dir, [webPage, nestedPage, vendorPage]);
    assert.ok(
      fontFindingsFor(findings, webPage).some((f) => f.ignoreValue === 'verdana'),
      'direct-child workspace under * must inherit root DESIGN.md',
    );
    assert.ok(
      fontFindingsFor(findings, nestedPage).some((f) => f.ignoreValue === 'verdana'),
      'nested package under a * workspace child must still inherit',
    );
    assert.equal(
      fontFindingsFor(findings, vendorPage).length,
      0,
      'vendor/tool is not a direct child of * and must not inherit',
    );
  });

  it('nested package under an included workspace inherits root DESIGN.md', () => {
    const dir = mkTempRoot('impeccable-detect-mono-nestedws-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['packages/*'],
    }));
    fs.mkdirSync(path.join(dir, 'packages/ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/ui/package.json'), '{"name":"ui"}');
    fs.mkdirSync(path.join(dir, 'packages/ui/examples'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/ui/examples/package.json'), '{"name":"examples"}');
    const page = path.join(dir, 'packages/ui/examples/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'packages/ui/examples must inherit as nested content of packages/*',
    );
    const found = findDesignRoot(path.join(dir, 'packages/ui/examples'));
    assert.equal(found.dir, dir);
    assert.equal(found.hasDesign, true);
  });

  it('impeccable projectRoots beat a package-manager negation of the same path', () => {
    const dir = mkTempRoot('impeccable-detect-mono-iroots-win-');
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), DESIGN_MD);
    fs.mkdirSync(path.join(dir, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.impeccable/config.json'), '{"projectRoots":["sites/*"]}');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['sites/*', '!sites/docs'],
    }));
    fs.mkdirSync(path.join(dir, 'sites/docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sites/docs/package.json'), '{"name":"docs"}');
    const page = path.join(dir, 'sites/docs/page.html');
    fs.writeFileSync(page, PAGE_HTML);

    const findings = runDetect(dir, [page]);
    assert.ok(
      fontFindingsFor(findings, page).some((f) => f.ignoreValue === 'verdana'),
      'projectRoots must govern a path they match even when workspaces exclude it',
    );
  });
});
