/**
 * Guard tests for scripts/release.mjs, the tagging/publishing script for the
 * three independently versioned components. Until now it had zero coverage
 * while owning every refusal that protects a public release: dirty tree,
 * unpushed HEAD, existing tag, disagreeing manifests, missing changelog
 * entry, missing artifacts.
 *
 * The script resolves repoRoot from its own file location and runs top-level
 * code on import, so these tests copy it into a disposable git repo (with a
 * local bare `origin`) and spawn it exactly as a maintainer would. Every run
 * uses --dry-run, which skips all mutating steps (tag, push, gh release,
 * builds) but exercises every guard on the way there.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'release.mjs');

const CHANGELOG = `---
---
<article>
  <div class="changelog-version-header"><span class="cf-version">v1.2.3</span></div>
  <ul class="cf-items">
    <li><strong>Loader contract pinned.</strong> Uses <code>plugin.json</code> checks &amp; a <a href="https://example.com/docs">guide</a>.</li>
    <li><strong>Faster runner.</strong> Batched invocations cut wall time.</li>
  </ul>
</article>
<article>
  <div class="changelog-version-header"><span class="cf-version">CLI v9.9.9</span></div>
  <ul class="cf-items">
    <li><strong>New detect flags.</strong> Adds <code>--fast</code>.</li>
  </ul>
</article>
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function runRelease(cwd, ...args) {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/release.mjs', ...args, '--dry-run'], {
      cwd,
      encoding: 'utf-8',
      timeout: 60000,
      // The D4 engine release-order guard would otherwise probe the network for
      // published engine assets; these guards predate it and only exercise the
      // version/changelog/artifact checks, so take its documented escape hatch.
      env: { ...process.env, IMPECCABLE_SKIP_ENGINE_CHECK: '1' },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('release.mjs guards', () => {
  let root;
  let workDir;
  let bareDir;
  let baselineSha;

  const write = (rel, contents) => {
    const abs = path.join(workDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-release-'));
    bareDir = path.join(root, 'origin.git');
    workDir = path.join(root, 'work');
    execFileSync('git', ['init', '--bare', bareDir]);
    fs.mkdirSync(workDir);
    git(workDir, 'init', '-b', 'main');
    git(workDir, 'config', 'user.email', 'test@example.com');
    git(workDir, 'config', 'user.name', 'Release Test');

    fs.mkdirSync(path.join(workDir, 'scripts'));
    fs.copyFileSync(RELEASE_SCRIPT, path.join(workDir, 'scripts', 'release.mjs'));
    // release.mjs imports ./check-engine-release.mjs and ./fetch-engine.mjs
    // (and check-engine-release.mjs imports fetch-engine.mjs), so stage them
    // too or the dry runs fail to resolve the modules instead of exercising
    // the guard.
    for (const dep of ['check-engine-release.mjs', 'fetch-engine.mjs', 'sign-bundle.mjs', 'bundle-signing-keys.json']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'scripts', dep), path.join(workDir, 'scripts', dep));
    }
    write('.claude-plugin/plugin.json', JSON.stringify({ name: 'impeccable', version: '1.2.3' }));
    write('.claude-plugin/marketplace.json', JSON.stringify({ plugins: [{ name: 'impeccable', version: '1.2.3' }] }));
    write('package.json', JSON.stringify({
      name: 'impeccable',
      version: '9.9.9',
      optionalDependencies: { '@impeccable/cli-darwin-arm64': '0.1.0', '@impeccable/cli-linux-x64': '0.1.0' },
    }));
    write('ENGINE_VERSION', '0.1.0\n');
    write('extension/manifest.json', JSON.stringify({ version: '2.0.0' }));
    write('site/pages/changelog.astro', CHANGELOG);
    write('dist/universal.zip', 'zip');
    write('dist/extension.zip', 'zip');
    write('dist/extension-firefox.zip', 'zip');

    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-m', 'fixture');
    git(workDir, 'remote', 'add', 'origin', bareDir);
    git(workDir, 'push', '-u', 'origin', 'main');
    baselineSha = git(workDir, 'rev-parse', 'HEAD');
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Undo whatever the previous scenario staged, on both ends: local tree
    // and tags back to the baseline commit, and origin force-reset too, since
    // several scenarios push commits or tags that would poison later ones.
    git(workDir, 'checkout', '--', '.');
    git(workDir, 'clean', '-fd');
    git(workDir, 'reset', '--hard', baselineSha);
    git(workDir, 'push', '--force', 'origin', 'main');
    for (const tag of git(workDir, 'tag').split('\n').filter(Boolean)) {
      git(workDir, 'tag', '-d', tag);
    }
    // --refs excludes the peeled `^{}` lines annotated tags produce, which
    // are not deletable refs and would abort the cleanup.
    for (const line of git(workDir, 'ls-remote', '--refs', '--tags', 'origin').split('\n').filter(Boolean)) {
      const ref = line.split('\t')[1];
      if (ref) git(workDir, 'push', 'origin', `:${ref}`);
    }
  });

  it('dry-runs a clean engine release: tags only, CI publishes', () => {
    const { code, stdout } = runRelease(workDir, 'engine');
    assert.equal(code, 0, stdout);
    assert.match(stdout, /Engine 0\.1\.0/);
    assert.match(stdout, /2 platform package pins agree/);
    assert.match(stdout, /\[dry-run\] git tag -a engine-v0\.1\.0/);
    assert.match(stdout, /\[dry-run\] git push origin engine-v0\.1\.0/);
    assert.doesNotMatch(stdout, /gh release create/);
    assert.match(stdout, /release-engine workflow/);
  });

  it('engine: refuses when package.json platform pins disagree with ENGINE_VERSION', () => {
    write('ENGINE_VERSION', '0.2.0\n');
    git(workDir, 'commit', '-am', 'bump engine');
    git(workDir, 'push', 'origin', 'main');
    const { code, stderr } = runRelease(workDir, 'engine');
    assert.notEqual(code, 0);
    assert.match(stderr, /pins @impeccable\/cli-darwin-arm64@0\.1\.0.*expected 0\.2\.0/);
  });

  it('engine: refuses when the tag already exists on origin', () => {
    git(workDir, 'tag', 'engine-v0.1.0');
    git(workDir, 'push', 'origin', 'engine-v0.1.0');
    git(workDir, 'tag', '-d', 'engine-v0.1.0');
    const { code, stderr } = runRelease(workDir, 'engine');
    assert.notEqual(code, 0);
    assert.match(stderr, /engine-v0\.1\.0 already exists on origin/);
  });

  it('dry-runs a clean skill release end to end', () => {
    const { code, stdout } = runRelease(workDir, 'skill');
    assert.equal(code, 0, stdout);
    assert.match(stdout, /Skill 1\.2\.3/);
    assert.match(stdout, /tag is free/);
    assert.match(stdout, /\[dry-run\] git tag -a skill-v1\.2\.3/);
    assert.match(stdout, /\[dry-run\] gh release create skill-v1\.2\.3/);
    assert.match(stdout, /1Password is not accessed/);
    assert.match(stdout, /gh release create[^\n]+universal\.zip\.sig\.json/);
    assert.equal(fs.existsSync(path.join(workDir, 'dist/universal.zip.sig.json')), false);
  });

  it('refuses a real release before tagging when signing is not configured', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(workDir, 'package.json'), 'utf8'));
    pkg.scripts = { 'build:release': 'node -e "process.exit(0)"' };
    write('package.json', JSON.stringify(pkg));
    git(workDir, 'add', 'package.json');
    git(workDir, 'commit', '-m', 'fixture build command');
    git(workDir, 'push', 'origin', 'main');
    assert.throws(() => execFileSync(process.execPath, ['scripts/release.mjs', 'skill'], {
      cwd: workDir, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, IMPECCABLE_SKIP_ENGINE_CHECK: '1', IMPECCABLE_SIGNING_KEY_REF: '' },
    }), error => {
      assert.match(error.stderr, /Set IMPECCABLE_SIGNING_KEY_REF/);
      assert.doesNotMatch(error.stdout, /Creating annotated tag|Creating GitHub release/);
      return true;
    });
    assert.equal(git(workDir, 'tag'), '');
    assert.equal(git(workDir, 'ls-remote', '--tags', 'origin'), '');
  });

  it('refuses before tagging when the signer returns without creating the sidecar', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(workDir, 'package.json'), 'utf8'));
    pkg.scripts = { 'build:release': 'node -e "process.exit(0)"' };
    write('package.json', JSON.stringify(pkg));
    // Stub only inside this disposable repository. No 1Password access, tags,
    // or real GitHub publication can occur even if the assertion regresses.
    write('scripts/sign-bundle.mjs', 'export function signReleaseBundle() {}\n');
    const releaseSource = fs.readFileSync(RELEASE_SCRIPT, 'utf8');
    const tagStep = 'step(`Creating annotated tag ${tag}`);';
    assert.ok(releaseSource.includes(tagStep), 'fixture must intercept the tag step');
    write('scripts/release.mjs', releaseSource.replace(
      tagStep,
      'throw new Error("UNEXPECTED_TAG_STEP");'
    ));
    git(workDir, 'add', 'package.json', 'scripts/sign-bundle.mjs', 'scripts/release.mjs');
    git(workDir, 'commit', '-m', 'fixture signer with missing output');
    git(workDir, 'push', 'origin', 'main');
    assert.throws(() => execFileSync(process.execPath, ['scripts/release.mjs', 'skill'], {
      cwd: workDir, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, IMPECCABLE_SKIP_ENGINE_CHECK: '1' },
    }), error => {
      assert.match(error.stderr, /Missing artifact: dist\/universal\.zip\.sig\.json/);
      assert.doesNotMatch(error.stderr, /UNEXPECTED_TAG_STEP/);
      return true;
    });
    assert.equal(git(workDir, 'tag'), '');
    assert.equal(git(workDir, 'ls-remote', '--tags', 'origin'), '');
  });

  it('converts the changelog entry to markdown release notes', () => {
    const { code, stdout } = runRelease(workDir, 'skill');
    assert.equal(code, 0, stdout);
    assert.match(stdout, /- \*\*Loader contract pinned\.\*\* Uses `plugin\.json` checks & a \[guide\]\(https:\/\/example\.com\/docs\)\./);
    assert.match(stdout, /- \*\*Faster runner\.\*\*/);
  });

  it('renders a tweet within the 280-char limit with the release URL', () => {
    const { code, stdout } = runRelease(workDir, 'skill');
    assert.equal(code, 0, stdout);
    const tweetMatch = stdout.match(/--- Tweet \((\d+)\/280 chars\)[^\n]*---\n([\s\S]*?)\n--- end tweet ---/);
    assert.ok(tweetMatch, `no tweet block in output:\n${stdout}`);
    assert.ok(Number(tweetMatch[1]) <= 280);
    assert.match(tweetMatch[2], /Impeccable v1\.2\.3 is out\./);
    assert.match(tweetMatch[2], /releases\/tag\/skill-v1\.2\.3/);
    assert.match(tweetMatch[2], /• Loader contract pinned/);
  });

  it('matches the prefixed changelog label for the CLI component', () => {
    const { code, stdout } = runRelease(workDir, 'cli');
    assert.equal(code, 0, stdout);
    assert.match(stdout, /CLI 9\.9\.9/);
    assert.match(stdout, /- \*\*New detect flags\.\*\*/);
  });

  it('refuses an unknown component', () => {
    const { code, stderr } = runRelease(workDir, 'website');
    assert.equal(code, 1);
    assert.match(stderr, /usage: release\.mjs/);
  });

  it('refuses a dirty working tree', () => {
    write('README.md', 'uncommitted');
    const { code, stderr } = runRelease(workDir, 'skill');
    assert.equal(code, 1);
    assert.match(stderr, /Working tree is dirty/);
  });

  it('refuses when HEAD is ahead of origin', () => {
    write('note.txt', 'ahead');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-m', 'unpushed');
    const { code, stderr } = runRelease(workDir, 'skill');
    assert.equal(code, 1);
    assert.match(stderr, /Push your commits first/);
  });

  it('refuses when the tag already exists locally', () => {
    git(workDir, 'tag', 'skill-v1.2.3');
    const { code, stderr } = runRelease(workDir, 'skill');
    assert.equal(code, 1);
    assert.match(stderr, /already exists locally/);
  });

  it('refuses when the tag already exists on origin', () => {
    git(workDir, 'tag', 'skill-v1.2.3');
    git(workDir, 'push', 'origin', 'skill-v1.2.3');
    git(workDir, 'tag', '-d', 'skill-v1.2.3');
    const { code, stderr } = runRelease(workDir, 'skill');
    assert.equal(code, 1);
    assert.match(stderr, /already exists on origin/);
  });

  it('refuses when plugin.json and marketplace.json disagree', () => {
    write('.claude-plugin/marketplace.json', JSON.stringify({ plugins: [{ name: 'impeccable', version: '1.0.0' }] }));
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-m', 'mismatch');
    git(workDir, 'push', 'origin', 'main');
    const { code, stderr } = runRelease(workDir, 'skill');
    assert.equal(code, 1);
    assert.match(stderr, /disagree\. Bump both\./);
  });

  it('refuses when the changelog entry is missing', () => {
    write('extension/manifest.json', JSON.stringify({ version: '3.0.0' }));
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-m', 'bump without changelog');
    git(workDir, 'push', 'origin', 'main');
    const { code, stderr } = runRelease(workDir, 'extension');
    assert.equal(code, 1);
    assert.match(stderr, /No changelog entry found for "Extension v3\.0\.0"/);
  });

  it('refuses when a release artifact is missing', () => {
    fs.rmSync(path.join(workDir, 'dist/universal.zip'));
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-m', 'drop artifact');
    git(workDir, 'push', 'origin', 'main');
    const { code, stderr } = runRelease(workDir, 'skill');
    assert.equal(code, 1);
    assert.match(stderr, /Missing artifact: dist\/universal\.zip/);
  });
});
