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
  if (scenario === 'cache-directory-failure') {
    // A file where the cache parent belongs makes mkdir fail on every OS,
    // including privileged test runners where chmod cannot deny writes.
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'bin'), 'blocked');
  }
  if (scenario === 'cache-write-failure') {
    fs.mkdirSync(cacheDir, { recursive: true });
    if (WINDOWS) fs.mkdirSync(path.join(cacheDir, 'impeccable.exe.part'));
  }
  if (scenario === 'cache-readonly-file') {
    fs.mkdirSync(cacheDir, { recursive: true });
    const staging = path.join(cacheDir, 'impeccable.exe.part');
    fs.writeFileSync(staging, 'read-only');
    fs.chmodSync(staging, 0o444);
  }
  const tools = path.join(root, 'tools');
  fs.mkdirSync(tools);
  if (!WINDOWS && scenario === 'cache-write-failure') {
    // The POSIX staging name contains the launcher's PID, so intercept the
    // preceding mkdir to place a directory at precisely that file path.
    fs.writeFileSync(path.join(tools, 'mkdir'), '#!/bin/sh\n/bin/mkdir "$@" || exit $?\n/bin/mkdir "$IMPECCABLE_HOME/bin/0.0.0-test/.impeccable.part.$PPID"\n', { mode: 0o755 });
  }
  if (!WINDOWS && ['hash-failure', 'removed-during-hash'].includes(scenario)) {
    fs.writeFileSync(path.join(tools, 'shasum'),
      `#!/bin/sh\n${scenario === 'removed-during-hash' ? 'rm -f "$3"\n' : ''}printf '%s  %s\\n' '${HASH}' "$3"\nexit ${scenario === 'hash-failure' ? 1 : 0}\n`,
      { mode: 0o755 });
  }
  const placementScenarios = ['removed-before-move', 'removed-after-move', 'emptied-after-move', 'move-failure'];
  if (!WINDOWS && placementScenarios.includes(scenario)) {
    const before = scenario === 'removed-before-move' ? 'rm -f "$2"\n' : '';
    const after = scenario === 'removed-after-move' ? 'rm -f "$3"\n' : scenario === 'emptied-after-move' ? ': > "$3"\n' : '';
    fs.writeFileSync(path.join(tools, 'mv'), scenario === 'move-failure' ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\n${before}/bin/mv "$@" || exit $?\n${after}`, { mode: 0o755 });
  }
  if (WINDOWS && (placementScenarios.includes(scenario) || ['hash-failure', 'removed-during-hash'].includes(scenario))) {
    // move is a cmd builtin and certutil is an .exe: PATH shims cannot
    // intercept them. Instrument ONLY the external-operation boundary in the
    // staged test copy, preserving the launcher's real labels/checks/status
    // handling. The separate valid case always runs the unmodified launcher.
    const fault = path.join(tools, 'fault.cmd');
    const hashFault = ['hash-failure', 'removed-during-hash'].includes(scenario);
    const operation = hashFault
      ? 'certutil -hashfile "%cached%.part" SHA256 >"%cached%.sha256" 2>nul'
      : 'move /y "%cached%.part" "%cached%" >nul 2>nul';
    let script;
    if (hashFault) {
      script = `@echo off\n${scenario === 'removed-during-hash' ? 'del "%cached%.part" >nul 2>nul\n' : ''}echo hash header\necho ${HASH}\nexit /b 1\n`;
    } else if (scenario === 'move-failure') {
      script = '@echo off\nexit /b 1\n';
    } else {
      const before = scenario === 'removed-before-move' ? 'del "%cached%.part" >nul 2>nul\n' : '';
      const after = scenario === 'removed-after-move' ? 'del "%cached%" >nul 2>nul\n' : scenario === 'emptied-after-move' ? 'type nul >"%cached%"\n' : '';
      script = `@echo off\n${before}${operation}\nif errorlevel 1 exit /b 1\n${after}exit /b 0\n`;
    }
    fs.writeFileSync(fault, script.replaceAll('\n', '\r\n'));
    const source = fs.readFileSync(launcher, 'utf8');
    assert.equal(source.split(operation).length, 2, 'instrument exactly one operation');
    const replacement = `call "${fault}"${hashFault ? ' >"%cached%.sha256" 2>nul' : ''}`;
    fs.writeFileSync(launcher, source.replace(operation, replacement));
  }
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (scenario === 'transport-failure') {
      req.socket.destroy();
      return;
    }
    if (req.url.endsWith('.sha256')) {
      const part = fs.readdirSync(cacheDir).find(file => file.includes('.part'));
      if (scenario === 'removed') fs.unlinkSync(path.join(cacheDir, part));
      if (scenario === 'emptied') fs.truncateSync(path.join(cacheDir, part));
      res.writeHead(scenario === 'no-sidecar' ? 404 : 200);
      res.end(scenario === 'empty-sidecar' ? '' : `${scenario === 'mismatch' ? '0'.repeat(64) : HASH}  engine\n`);
    } else {
      if (scenario === 'download-failure') res.writeHead(404);
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
  const run = () => new Promise((resolve, reject) => {
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
  const result = await run();
  if (scenario === 'valid') {
    const requestCount = requests.length;
    const cachedResult = await run();
    assert.equal(cachedResult.status, 0, cachedResult.stderr);
    assert.match(cachedResult.stdout, /verified-engine/);
    assert.equal(cachedResult.stderr, '', 'cached execution stays quiet');
    assert.equal(requests.length, requestCount, 'subsequent runs use the cached engine without network');
  }
  assert.equal(result.signal, null, JSON.stringify(result));
  const cacheFailure = scenario.startsWith('cache-');
  assert.equal(requests.filter(url => !url.endsWith('.sha256')).length, cacheFailure ? 0 : 1,
    'cache failures do not attempt a download; other scenarios download once');
  return { ...result, files: fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [], requests, cacheDir };
}

for (const scenario of ['cache-directory-failure', 'cache-write-failure', 'download-failure', 'transport-failure', ...(WINDOWS ? ['cache-readonly-file'] : [])]) {
  test(`launcher explains ${scenario} and how to retry setup`, async t => {
    const result = await exercise(t, scenario);
    assert.equal(result.status, 127, JSON.stringify(result));
    assert.doesNotMatch(result.stdout, /verified-engine/);
    assert.match(result.stderr, /engine 0\.0\.0-test/);
    assert.ok(result.stderr.includes(result.cacheDir), result.stderr);
    assert.match(result.stderr, /engine-probe/);
    assert.match(result.stderr, /IMPECCABLE_HOME/);
    assert.match(result.stderr, /IMPECCABLE_BIN/);
    if (['download-failure', 'transport-failure'].includes(scenario)) {
      assert.match(result.stderr, /could not download/);
      assert.match(result.stderr, /network/);
      assert.deepEqual(result.files, [], 'failed downloads leave no staging files');
      assert.equal(result.requests.length, 1, 'no verification without a download');
    } else {
      assert.match(result.stderr, scenario === 'cache-directory-failure' ? /cannot create/ : /cannot write/);
    }
  });
}

test('launcher downloads and runs a verified executable', async t => {
  const result = await exercise(t, 'valid');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified-engine/);
  assert.deepEqual(result.files, [WINDOWS ? 'impeccable.exe' : 'impeccable']);
  assert.equal(result.requests.length, 2);
});

for (const scenario of ['removed', 'emptied', 'empty-download', 'no-sidecar', 'empty-sidecar', 'mismatch', 'hash-failure', 'removed-during-hash', 'removed-before-move', 'removed-after-move', 'emptied-after-move', 'move-failure']) {
  test(`launcher refuses ${scenario} with an accurate diagnostic`, async t => {
    const result = await exercise(t, scenario);
    assert.equal(result.status, 127, JSON.stringify(result));
    assert.doesNotMatch(result.stdout, /verified-engine/);
    assert.deepEqual(result.files, [], 'no unverified file or sidecar left behind');
    if (scenario.startsWith('removed')) {
      assert.match(result.stderr, /download completed but the file was removed before (verification|execution)/);
      assert.match(result.stderr, /antivirus.*logs/i);
      assert.doesNotMatch(result.stderr, /checksum mismatch/);
    } else if (scenario.startsWith('emptied') || scenario === 'empty-download') {
      assert.match(result.stderr, /downloaded file is empty/);
      assert.doesNotMatch(result.stderr, /checksum mismatch/);
    } else if (scenario === 'mismatch') {
      assert.match(result.stderr, /checksum mismatch/);
    } else if (scenario === 'move-failure') {
      assert.match(result.stderr, /could not cache the verified download/);
    } else {
      assert.match(result.stderr, /refusing the unverified download/);
    }
  });
}
