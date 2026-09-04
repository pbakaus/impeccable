/**
 * The npm shim's download path (`cli/bin/cli.js`).
 *
 * The shim is the last resort in the binary lookup, and it caches what it
 * fetches, so it has to fail closed the same way the skill launcher
 * (`skill/scripts/impeccable`) and `impeccable install`
 * (`crates/skills/src/engine_binary.rs`) do: a `.sha256` sidecar that cannot
 * be fetched, is empty, or disagrees with the payload refuses the download and
 * leaves nothing in the cache dir.
 *
 * Two things keep these cases honest about which lookup arm they exercise.
 * First, the shim runs from a staged copy (`<tmp>/cli/bin/cli.js` beside a
 * copy of the repo's package.json) with no node_modules anywhere under it, so
 * `require.resolve('@impeccable/cli-<os>-<arch>')` fails the way it does on a
 * machine without the optional dependency. Those platform packages are a
 * release prerequisite, so a test run from the repo would otherwise start
 * resolving them and pass without ever reaching the download. Second, the
 * fixture server records every request, and each download case asserts the
 * asset was actually fetched, so a future lookup shortcut fails loudly instead
 * of going green on an untested path. The last case installs a fake platform
 * package next to the staged shim and pins the precedence the other cases
 * depend on being absent.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = path.join(REPO, 'package.json');
const VERSION = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
  .optionalDependencies['@impeccable/cli-darwin-arm64'];
const TARGET = `${{ darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform] || process.platform}`
  + `-${{ arm64: 'arm64', x64: 'x64' }[process.arch] || process.arch}`;
const PLATFORM_PKG = `@impeccable/cli-${TARGET}`;
const ASSET = `impeccable-${TARGET}${process.platform === 'win32' ? '.exe' : ''}`;
const ASSET_PATH = `/engine-v${VERSION}/${ASSET}`;

// A stand-in engine binary: a script that prints its argv so a successful
// download is observable end to end.
const PAYLOAD = Buffer.from('#!/bin/sh\necho "fake-engine $*"\n');
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');

/** What the server answers for `<asset>.sha256` on the next request. */
let sidecar = { status: 200, body: `${DIGEST}  ${ASSET}\n` };
/** Every path the server was asked for since the last test started. */
let requests = [];
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === `${ASSET_PATH}.sha256`) {
      if (sidecar.status !== 200) {
        res.writeHead(sidecar.status);
        res.end('');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(sidecar.body);
      return;
    }
    if (req.url === ASSET_PATH) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(PAYLOAD);
      return;
    }
    res.writeHead(404);
    res.end('');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => { requests = []; });

/**
 * A throwaway copy of the shim at `<tmp>/cli/bin/cli.js`, with the repo's
 * package.json where the shim reads it from (`../../package.json`) and no
 * node_modules on the lookup path above it.
 */
function stageShim() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-shim-'));
  fs.mkdirSync(path.join(dir, 'cli', 'bin'), { recursive: true });
  fs.copyFileSync(PKG_PATH, path.join(dir, 'package.json'));
  fs.copyFileSync(path.join(REPO, 'cli', 'bin', 'cli.js'), path.join(dir, 'cli', 'bin', 'cli.js'));
  return { dir, shim: path.join(dir, 'cli', 'bin', 'cli.js') };
}

/**
 * Run a staged shim and collect its output. Async on purpose: the fixture
 * server lives in this process, so a synchronous spawn would block the event
 * loop and the child's fetch would never be answered.
 */
function run(shim, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [shim, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Stage a shim and run it with its own cache dir. */
async function runShim(args = ['engine-probe']) {
  const { dir, shim } = stageShim();
  const env = { ...process.env, IMPECCABLE_HOME: dir, IMPECCABLE_DOWNLOAD_BASE: base };
  delete env.IMPECCABLE_BIN;
  return { ...(await run(shim, args, env)), home: dir };
}

/** Everything under the cache dir, so a refusal can be shown to leave no trace. */
function cacheEntries(home) {
  const root = path.join(home, 'bin');
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out;
}

describe('npm shim download verification', { skip: process.platform === 'win32' ? 'posix only' : false }, () => {
  it('caches and runs a download whose sidecar matches', async () => {
    sidecar = { status: 200, body: `${DIGEST}  ${ASSET}\n` };
    const res = await runShim(['hello']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /fake-engine hello/);
    assert.deepEqual(requests, [ASSET_PATH, `${ASSET_PATH}.sha256`]);
    assert.deepEqual(cacheEntries(res.home), [path.join(VERSION, 'impeccable')]);
  });

  it('refuses when the sidecar is missing', async () => {
    sidecar = { status: 404, body: '' };
    const res = await runShim();
    assert.equal(res.status, 127);
    assert.match(res.stderr, /sidecar unavailable or empty/);
    assert.match(res.stderr, /refusing the unverified download/);
    assert.deepEqual(requests, [ASSET_PATH, `${ASSET_PATH}.sha256`]);
    assert.deepEqual(cacheEntries(res.home), []);
  });

  it('refuses when the sidecar is empty', async () => {
    sidecar = { status: 200, body: '   \n' };
    const res = await runShim();
    assert.equal(res.status, 127);
    assert.match(res.stderr, /sidecar unavailable or empty/);
    assert.match(res.stderr, /refusing the unverified download/);
    assert.deepEqual(requests, [ASSET_PATH, `${ASSET_PATH}.sha256`]);
    assert.deepEqual(cacheEntries(res.home), []);
  });

  it('refuses when the sidecar hash does not match', async () => {
    sidecar = { status: 200, body: `${'0'.repeat(64)}  ${ASSET}\n` };
    const res = await runShim();
    assert.equal(res.status, 127);
    assert.match(res.stderr, /checksum mismatch downloading/);
    assert.deepEqual(requests, [ASSET_PATH, `${ASSET_PATH}.sha256`]);
    assert.deepEqual(cacheEntries(res.home), []);
  });

  it('answers --version and -v from its own package.json without touching a binary', async () => {
    const expected = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8')).version;
    for (const args of [['--version'], ['-v'], ['--version', 'extra']]) {
      const flag = args.join(' ');
      const res = await runShim(args);
      assert.equal(res.status, 0, `${flag} exits 0`);
      assert.equal(res.stdout, `${expected}\n`);
      assert.deepEqual(requests, [], 'no download was attempted');
    }
  });

  it('prefers IMPECCABLE_BIN and never downloads', async () => {
    sidecar = { status: 404, body: '' };
    const { dir, shim } = stageShim();
    const bin = path.join(dir, 'preinstalled');
    fs.writeFileSync(bin, '#!/bin/sh\necho "preinstalled $*"\n', { mode: 0o755 });
    const res = await run(shim, ['hi'], {
      ...process.env, IMPECCABLE_HOME: dir, IMPECCABLE_DOWNLOAD_BASE: base, IMPECCABLE_BIN: bin,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /preinstalled hi/);
    assert.deepEqual(requests, []);
    assert.deepEqual(cacheEntries(dir), []);
  });

  // The precedence the four cases above depend on being absent: with the
  // optional dependency installed, the shim never reaches the cache or the
  // download. Those packages ship with every engine release, so a shim run
  // from a tree that has them takes this arm instead.
  it('prefers an installed platform package and never downloads', async () => {
    sidecar = { status: 404, body: '' };
    const { dir, shim } = stageShim();
    const pkgDir = path.join(dir, 'node_modules', PLATFORM_PKG);
    fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      `${JSON.stringify({ name: PLATFORM_PKG, version: VERSION }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(pkgDir, 'bin', 'impeccable'),
      '#!/bin/sh\necho "from-platform-package $*"\n',
      { mode: 0o755 },
    );
    const env = { ...process.env, IMPECCABLE_HOME: dir, IMPECCABLE_DOWNLOAD_BASE: base };
    delete env.IMPECCABLE_BIN;
    const res = await run(shim, ['hi'], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /from-platform-package hi/);
    assert.deepEqual(requests, []);
    assert.deepEqual(cacheEntries(dir), []);
  });
});
