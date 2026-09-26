import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { stagePackage } from '../scripts/publish-platform-packages.mjs';
import { assetUrl, binaryName, readEngineVersion } from '../scripts/fetch-engine.mjs';
import { engineTarget, findEngineBinary, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENGINE = findEngineBinary();
const TARGET = engineTarget();
const VERSION = readEngineVersion();
const EXE = binaryName(TARGET);

function run(shim, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [shim, ...args], {
      cwd, env, timeout: 30000, windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('native engine package, download, cache, and skill installation', {
  skip: ENGINE ? false : ENGINE_MISSING_MESSAGE,
  timeout: 180000,
}, async t => {
  const binary = fs.readFileSync(ENGINE);
  if (process.platform === 'win32') {
    assert.equal(binary.toString('ascii', 0, 2), 'MZ');
    const pe = binary.readUInt32LE(0x3c);
    assert.equal(binary.toString('ascii', pe, pe + 4), 'PE\0\0');
    assert.equal(binary.readUInt16LE(pe + 4), { arm64: 0xaa64, x64: 0x8664 }[process.arch],
      'the engine must match native Node, not run under emulation');
  }
  const digest = createHash('sha256').update(binary).digest('hex');
  const asset = new URL(assetUrl(VERSION, TARGET, 'http://localhost')).pathname;
  let sidecar = `${digest}  impeccable-${TARGET}\n`;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === asset) res.end(binary);
    else if (req.url === `${asset}.sha256` && sidecar !== null) res.end(sidecar);
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  function stage(name) {
    requests.length = 0;
    const dir = path.join(root, name);
    const shim = path.join(dir, 'cli', 'bin', 'cli.js');
    const home = path.join(dir, 'home');
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.mkdirSync(home);
    fs.copyFileSync(path.join(ROOT, 'cli', 'bin', 'cli.js'), shim);
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
    const env = {
      ...process.env, HOME: home, USERPROFILE: home, IMPECCABLE_HOME: home,
      IMPECCABLE_DOWNLOAD_BASE: base,
    };
    delete env.IMPECCABLE_BIN;
    delete env.IMPECCABLE_SKILL_DIR;
    delete env.NODE_PATH;
    const cached = path.join(home, 'bin', VERSION, EXE);
    return { dir, home, env, cached, run: args => run(shim, args, dir, env) };
  }

  function assertProbe(result) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `impeccable-engine ${VERSION}`);
  }

  await t.test('resolves the staged platform package without downloading', async () => {
    const fixture = stage('installed package');
    const template = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli', 'platform-packages', TARGET, 'package.json'), 'utf8'));
    const staged = stagePackage({
      target: TARGET, version: VERSION, binary, template,
      license: fs.readFileSync(path.join(ROOT, 'LICENSE')), outDir: fixture.dir,
    });
    const scope = path.join(fixture.dir, 'node_modules', '@impeccable');
    fs.mkdirSync(scope, { recursive: true });
    fs.renameSync(staged, path.join(scope, `cli-${TARGET}`));
    assertProbe(await fixture.run(['engine-probe']));
    assert.deepEqual(requests, []);
    assert.equal(fs.existsSync(fixture.cached), false);

    // Omit the engine from the local bundle to exercise the installer download.
    const skill = path.join(fixture.dir, 'bundle', '.claude', 'skills', 'impeccable');
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: impeccable\ndescription: Native install test\n---\n');
    fs.writeFileSync(path.join(skill, 'scripts', 'VERSION'), `${VERSION}\n`);
    fixture.env.IMPECCABLE_BUNDLE_PATH = path.join(fixture.dir, 'bundle');
    const installed = await fixture.run(['install', '--providers=claude', '--project', '--no-hooks', '--yes']);
    assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    assert.match(installed.stdout, new RegExp(`Installed impeccable engine v${VERSION.replaceAll('.', '\\.')} \\(${TARGET}\\)`));
    const installedBin = path.join(fixture.dir, '.claude', 'skills', 'impeccable', 'scripts', 'bin', TARGET, EXE);
    assert.deepEqual(fs.readFileSync(installedBin), binary);
    assert.deepEqual(requests, [asset, `${asset}.sha256`]);
  });

  await t.test('downloads the native asset, verifies it, and reuses the cache', async () => {
    const fixture = stage('download');
    assertProbe(await fixture.run(['engine-probe']));
    assert.deepEqual(requests, [asset, `${asset}.sha256`]);
    assert.deepEqual(fs.readFileSync(fixture.cached), binary);
    requests.length = 0;
    assertProbe(await fixture.run(['engine-probe']));
    assert.deepEqual(requests, []);
  });

  for (const [name, value, error] of [
    ['missing checksum', null, /sidecar unavailable or empty/],
    ['empty checksum', ' \n', /sidecar unavailable or empty/],
    ['wrong checksum', '0'.repeat(64), /checksum mismatch/],
  ]) {
    await t.test(`refuses a native download with ${name}`, async () => {
      const fixture = stage(name);
      sidecar = value;
      const result = await fixture.run(['engine-probe']);
      assert.equal(result.status, 127, result.stderr);
      assert.match(result.stderr, error);
      assert.deepEqual(requests, [asset, `${asset}.sha256`]);
      assert.equal(fs.existsSync(path.join(fixture.home, 'bin')), false);
    });
  }
});
