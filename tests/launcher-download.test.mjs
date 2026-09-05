import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const COMSPEC = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
// Use the host's command interpreter as a harmless Windows executable. No
// downloaded release binary is executed, and all network traffic is loopback.
const PAYLOAD = WINDOWS ? fs.readFileSync(COMSPEC) : Buffer.from('#!/bin/sh\necho verified-engine\n');
const HASH = createHash('sha256').update(PAYLOAD).digest('hex');

async function exercise(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'skill scripts');
  const home = path.join(root, 'home');
  const cache = path.join(root, 'cache');
  fs.mkdirSync(scripts);
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(scripts, 'VERSION'), '0.0.0-test\n');
  const name = WINDOWS ? 'impeccable.cmd' : 'impeccable';
  const launcher = path.join(scripts, name);
  fs.copyFileSync(path.join(ROOT, 'skill/scripts', name), launcher);
  const cacheDir = path.join(cache, 'bin', '0.0.0-test');
  const tools = path.join(root, 'tools');
  fs.mkdirSync(tools);
  if (!WINDOWS && ['hash-failure', 'removed-during-hash'].includes(scenario)) {
    fs.writeFileSync(path.join(tools, 'shasum'),
      `#!/bin/sh\n${scenario === 'removed-during-hash' ? 'rm -f "$3"\n' : ''}printf '%s  %s\\n' '${HASH}' "$3"\nexit ${scenario === 'hash-failure' ? 1 : 0}\n`,
      { mode: 0o755 });
  }
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url.endsWith('.sha256')) {
      const part = fs.readdirSync(cacheDir).find(file => file.includes('.part'));
      if (scenario === 'removed') fs.unlinkSync(path.join(cacheDir, part));
      if (scenario === 'emptied') fs.truncateSync(path.join(cacheDir, part));
      res.writeHead(scenario === 'no-sidecar' ? 404 : 200);
      res.end(scenario === 'empty-sidecar' ? '' : `${scenario === 'mismatch' ? '0'.repeat(64) : HASH}  engine\n`);
    } else {
      res.end(scenario === 'empty-download' ? '' : PAYLOAD);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  // Keep system tools, but exclude user/npm PATH candidates and all launcher
  // overrides so the test cannot accidentally execute an installed engine.
  const env = {
    PATH: WINDOWS ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : `${tools}:/usr/bin:/bin`,
    HOME: home, USERPROFILE: home, TEMP: root, TMP: root,
    IMPECCABLE_HOME: cache,
    IMPECCABLE_DOWNLOAD_BASE: `http://127.0.0.1:${server.address().port}`,
    ...(WINDOWS ? { SystemRoot: process.env.SystemRoot, ComSpec: COMSPEC, PROCESSOR_ARCHITECTURE: 'AMD64' } : {}),
  };
  const result = await new Promise((resolve, reject) => {
    const child = WINDOWS
      ? spawn(COMSPEC, ['/d', '/s', '/c', `""${launcher}" /d /c echo verified-engine"`], { env, cwd: root, windowsVerbatimArguments: true, timeout: 20000 })
      : spawn('/bin/sh', [launcher], { env, cwd: root, timeout: 20000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  assert.equal(result.signal, null, JSON.stringify(result));
  assert.equal(requests.filter(url => !url.endsWith('.sha256')).length, 1, 'one binary download, no verification retry loop');
  return { ...result, files: fs.readdirSync(cacheDir), requests };
}

test('launcher downloads and runs a verified executable', async t => {
  const result = await exercise(t, 'valid');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified-engine/);
  assert.deepEqual(result.files, [WINDOWS ? 'impeccable.exe' : 'impeccable']);
  assert.equal(result.requests.length, 2);
});

for (const scenario of ['removed', 'emptied', 'empty-download', 'no-sidecar', 'empty-sidecar', 'mismatch', ...(!WINDOWS ? ['hash-failure', 'removed-during-hash'] : [])]) {
  test(`launcher refuses ${scenario} with an accurate diagnostic`, async t => {
    const result = await exercise(t, scenario);
    assert.equal(result.status, 127, JSON.stringify(result));
    assert.doesNotMatch(result.stdout, /verified-engine/);
    assert.deepEqual(result.files, [], 'no unverified file or sidecar left behind');
    if (scenario === 'removed' || scenario === 'removed-during-hash') {
      assert.match(result.stderr, /download completed but the file was removed before verification/);
      assert.match(result.stderr, /antivirus.*logs/i);
      assert.doesNotMatch(result.stderr, /checksum mismatch/);
    } else if (scenario === 'emptied' || scenario === 'empty-download') {
      assert.match(result.stderr, /downloaded file is empty/);
      assert.doesNotMatch(result.stderr, /checksum mismatch/);
    } else if (scenario === 'mismatch') {
      assert.match(result.stderr, /checksum mismatch/);
    } else {
      assert.match(result.stderr, /refusing the unverified download/);
    }
  });
}
