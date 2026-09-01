import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = path.join(root, 'cli', 'engine');
const skillDetect = path.join(root, 'skill', 'scripts', 'detect.mjs');
const configDep = path.join(root, 'cli', 'lib', 'impeccable-config.mjs');

const CSS = ':root{--grad:linear-gradient(90deg,#7C3AED,#EC4899)}\n.hero h1{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}';
const HTML = '<html><head><link rel=stylesheet href=s.css></head><body><div class=hero><h1>Hi</h1></div></body></html>';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function copyDetectorExternalDeps(scriptsDir) {
  fs.mkdirSync(path.join(scriptsDir, 'lib'), { recursive: true });
  fs.copyFileSync(configDep, path.join(scriptsDir, 'lib', 'impeccable-config.mjs'));
}

function writeFixture(dir) {
  fs.writeFileSync(path.join(dir, 's.css'), CSS);
  fs.writeFileSync(path.join(dir, 'p.html'), HTML);
}

function runDetect(cwd, detectRel, htmlRel = 'p.html') {
  const detectPath = path.join(cwd, detectRel);
  return spawnSync(
    process.execPath,
    [detectPath, '--json', '--no-config', '--no-design-system', htmlRel],
    { cwd, encoding: 'utf8' },
  );
}

function assertFullEngine(result) {
  assert.doesNotMatch(result.stderr, /DEGRADED/);
  const findings = JSON.parse(result.stdout);
  assert.ok(findings.some((item) => item.antipattern === 'gradient-text'));
  assert.equal(result.status, 2);
}

function assertDegraded(result) {
  assert.match(result.stderr, /DEGRADED/);
  assert.equal(result.status, 1);
  JSON.parse(result.stdout);
}

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('static HTML parsers in skill/plugin installs', () => {
  it('resolves parsers from a skill-shaped scripts/ tree with no node_modules', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-skill-detect-'));
    tempDirs.push(tmp);
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.copyFileSync(skillDetect, path.join(tmp, 'scripts', 'detect.mjs'));
    copyDir(engineDir, path.join(tmp, 'scripts', 'detector'));
    copyDetectorExternalDeps(path.join(tmp, 'scripts'));
    writeFixture(tmp);

    assertFullEngine(runDetect(tmp, path.join('scripts', 'detect.mjs')));
  });

  it('resolves parsers from a plugin cache skills/impeccable/scripts/ tree', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-plugin-detect-'));
    tempDirs.push(tmp);
    const scriptsDir = path.join(tmp, 'skills', 'impeccable', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.copyFileSync(skillDetect, path.join(scriptsDir, 'detect.mjs'));
    copyDir(engineDir, path.join(scriptsDir, 'detector'));
    copyDetectorExternalDeps(scriptsDir);
    writeFixture(tmp);

    assertFullEngine(runDetect(tmp, path.join('skills', 'impeccable', 'scripts', 'detect.mjs')));
  });

  it('exits 1 when the vendor bundle is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-skill-degraded-'));
    tempDirs.push(tmp);
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.copyFileSync(skillDetect, path.join(tmp, 'scripts', 'detect.mjs'));
    copyDir(engineDir, path.join(tmp, 'scripts', 'detector'));
    copyDetectorExternalDeps(path.join(tmp, 'scripts'));
    fs.unlinkSync(path.join(tmp, 'scripts', 'detector', 'vendor', 'static-html-parsers.mjs'));
    writeFixture(tmp);

    assertDegraded(runDetect(tmp, path.join('scripts', 'detect.mjs')));
  });
});
