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
 * Every case runs the real shim against a throwaway HTTP server, with
 * IMPECCABLE_HOME pointed at a temp dir so the user's cache is never touched.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIM = path.join(REPO, 'cli', 'bin', 'cli.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  .optionalDependencies['@impeccable/cli-darwin-arm64'];
const TARGET = `${{ darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform] || process.platform}`
  + `-${{ arm64: 'arm64', x64: 'x64' }[process.arch] || process.arch}`;
const ASSET = `impeccable-${TARGET}${process.platform === 'win32' ? '.exe' : ''}`;

// A stand-in engine binary: a script that prints its argv so a successful
// download is observable end to end.
const PAYLOAD = Buffer.from('#!/bin/sh\necho "fake-engine $*"\n');
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');

/** What the server answers for `<asset>.sha256` on the next request. */
let sidecar = { status: 200, body: `${DIGEST}  ${ASSET}\n` };
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.endsWith('.sha256')) {
      if (sidecar.status !== 200) {
        res.writeHead(sidecar.status);
        res.end('');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(sidecar.body);
      return;
    }
    if (req.url.endsWith(ASSET)) {
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

/**
 * Run the shim and collect its output. Async on purpose: the fixture server
 * lives in this process, so a synchronous spawn would block the event loop
 * and the child's fetch would never be answered.
 */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SHIM, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Run the shim with a fresh cache dir. Returns the result plus that dir. */
async function runShim(args = ['engine-probe']) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-shim-'));
  const env = { ...process.env, IMPECCABLE_HOME: home, IMPECCABLE_DOWNLOAD_BASE: base };
  delete env.IMPECCABLE_BIN;
  return { ...(await run(args, env)), home };
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
    assert.deepEqual(cacheEntries(res.home), [path.join(VERSION, 'impeccable')]);
  });

  it('refuses when the sidecar is missing', async () => {
    sidecar = { status: 404, body: '' };
    const res = await runShim();
    assert.equal(res.status, 127);
    assert.match(res.stderr, /sidecar unavailable or empty/);
    assert.match(res.stderr, /refusing the unverified download/);
    assert.deepEqual(cacheEntries(res.home), []);
  });

  it('refuses when the sidecar is empty', async () => {
    sidecar = { status: 200, body: '   \n' };
    const res = await runShim();
    assert.equal(res.status, 127);
    assert.match(res.stderr, /sidecar unavailable or empty/);
    assert.match(res.stderr, /refusing the unverified download/);
    assert.deepEqual(cacheEntries(res.home), []);
  });

  it('refuses when the sidecar hash does not match', async () => {
    sidecar = { status: 200, body: `${'0'.repeat(64)}  ${ASSET}\n` };
    const res = await runShim();
    assert.equal(res.status, 127);
    assert.match(res.stderr, /checksum mismatch downloading/);
    assert.deepEqual(cacheEntries(res.home), []);
  });

  it('prefers IMPECCABLE_BIN and never downloads', async () => {
    sidecar = { status: 404, body: '' };
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-shim-'));
    const bin = path.join(home, 'preinstalled');
    fs.writeFileSync(bin, '#!/bin/sh\necho "preinstalled $*"\n', { mode: 0o755 });
    const res = await run(['hi'], {
      ...process.env, IMPECCABLE_HOME: home, IMPECCABLE_DOWNLOAD_BASE: base, IMPECCABLE_BIN: bin,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /preinstalled hi/);
    assert.deepEqual(cacheEntries(home), []);
  });
});
