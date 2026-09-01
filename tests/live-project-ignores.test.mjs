import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProjectDetectorIgnores } from '../skill/scripts/live/project-ignores.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'skill', 'scripts');

const tempDirs = [];
function makeTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-project-ignores-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function write(root, rel, content) {
  const filePath = path.join(root, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeDetectorConfig(root, detector) {
  write(root, '.impeccable/config.json', JSON.stringify({ detector }, null, 2));
}

function writeLiveConfig(root, files) {
  write(root, '.impeccable/live/config.json', JSON.stringify({
    files,
    insertBefore: '</body>',
    commentSyntax: 'html',
  }, null, 2));
}

describe('collectProjectDetectorIgnores', () => {
  it('collects waivers, roots, and pageFiles from a single-root project', () => {
    const app = makeTemp();
    write(app, 'package.json', '{"name":"single","private":true}\n');
    writeDetectorConfig(app, {
      ignoreRules: ['ai-color-palette'],
      ignoreFiles: ['prototype/legacy/**'],
      ignoreValues: [
        { rule: 'gradient-text', value: '*', files: ['prototype/library/**'], reason: 'stays local' },
      ],
    });
    writeLiveConfig(app, ['prototype/index.html', 'prototype/library/buttons.html']);
    write(app, 'prototype/index.html', '<html></html>');
    write(app, 'prototype/library/buttons.html', '<html></html>');

    const out = collectProjectDetectorIgnores({ appRoot: app, scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(out.ignoreRules, ['ai-color-palette']);
    assert.deepEqual(out.ignoreFiles, ['prototype/legacy/**']);
    // createdAt/reason stay local; only rule/value/files ride to the browser.
    assert.deepEqual(out.ignoreValues, [
      { rule: 'gradient-text', value: '*', files: ['prototype/library/**'] },
    ]);
    assert.deepEqual(out.roots.sort(), ['prototype/', 'prototype/library/']);
    assert.deepEqual(out.pageFiles.sort(), ['prototype/index.html', 'prototype/library/buttons.html']);
  });

  it('reads waivers keyed at the repo root, where the hook and the CLI put them', () => {
    // The monorepo shape from the PR #645 review: the live server chdirs
    // onto the child appRoot, while resolveCacheCwd keys the hook's config
    // at the session cwd, which is the repo root.
    const repo = makeTemp();
    const app = path.join(repo, 'site');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    write(app, 'package.json', '{"name":"site","private":true}\n');
    writeDetectorConfig(repo, {
      ignoreRules: ['ai-color-palette'],
      ignoreValues: [{ rule: 'overused-font', value: 'space grotesk' }],
    });
    writeLiveConfig(app, ['prototype/index.html']);
    write(app, 'prototype/index.html', '<html></html>');

    const out = collectProjectDetectorIgnores({ appRoot: app, repoRoot: repo, scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(out.ignoreRules, ['ai-color-palette']);
    assert.deepEqual(out.ignoreValues, [{ rule: 'overused-font', value: 'space grotesk' }]);
    // Identities serialize repo-relative so waivers spelled from either root
    // match through the resolver's suffix expansion.
    assert.deepEqual(out.roots, ['site/prototype/']);
    assert.deepEqual(out.pageFiles, ['site/prototype/index.html']);
  });

  it('unions configs across roots and dedupes identical value entries', () => {
    const repo = makeTemp();
    const app = path.join(repo, 'site');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    write(app, 'package.json', '{"name":"site","private":true}\n');
    writeDetectorConfig(repo, {
      ignoreRules: ['ai-color-palette'],
      ignoreValues: [{ rule: 'overused-font', value: 'space grotesk' }],
    });
    writeDetectorConfig(app, {
      ignoreRules: ['gradient-text', 'ai-color-palette'],
      ignoreValues: [{ rule: 'overused-font', value: 'space grotesk' }],
    });
    writeLiveConfig(app, ['prototype/index.html']);
    write(app, 'prototype/index.html', '<html></html>');

    const out = collectProjectDetectorIgnores({ appRoot: app, repoRoot: repo, scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(out.ignoreRules.sort(), ['ai-color-palette', 'gradient-text']);
    assert.deepEqual(out.ignoreValues, [{ rule: 'overused-font', value: 'space grotesk' }]);
  });

  it('expands glob file entries to existing files and drops missing literals', () => {
    const app = makeTemp();
    write(app, 'package.json', '{"name":"globs","private":true}\n');
    writeLiveConfig(app, ['prototype/**/*.html', 'prototype/not-created-yet.html']);
    write(app, 'prototype/index.html', '<html></html>');
    write(app, 'prototype/library/buttons.html', '<html></html>');

    const out = collectProjectDetectorIgnores({ appRoot: app, scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(out.pageFiles.sort(), ['prototype/index.html', 'prototype/library/buttons.html']);
    assert.deepEqual(out.roots.sort(), ['prototype/']);
  });

  it('degrades to empty arrays when nothing is configured', () => {
    const app = makeTemp();
    write(app, 'package.json', '{"name":"bare","private":true}\n');
    const out = collectProjectDetectorIgnores({ appRoot: app, scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(out, { ignoreRules: [], ignoreValues: [], ignoreFiles: [], roots: [], pageFiles: [] });
  });

  it('survives a malformed detector config without throwing', () => {
    const app = makeTemp();
    write(app, 'package.json', '{"name":"broken","private":true}\n');
    write(app, '.impeccable/config.json', '{"detector":{"ignoreRules":"foo","ignoreValues":[null,7],"ignoreFiles":{}}}');
    writeLiveConfig(app, ['prototype/index.html']);
    write(app, 'prototype/index.html', '<html></html>');

    const out = collectProjectDetectorIgnores({ appRoot: app, scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(out.ignoreRules, []);
    assert.deepEqual(out.ignoreValues, []);
    assert.deepEqual(out.ignoreFiles, []);
    assert.deepEqual(out.pageFiles, ['prototype/index.html']);
  });
});
