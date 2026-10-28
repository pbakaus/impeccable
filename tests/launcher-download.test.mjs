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
const BIN = WINDOWS ? 'impeccable.exe' : 'impeccable';
// The release asset this host's launcher asks for (the cmd tests pin AMD64).
const ASSET = `impeccable-${WINDOWS ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'}-${!WINDOWS && process.arch === 'arm64' ? 'arm64' : 'x64'}${WINDOWS ? '.exe' : ''}`;

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
  // The launchers verify against the manifest next to them, never the server.
  const digest = scenario === 'mismatch' ? '0'.repeat(64) : HASH;
  if (scenario !== 'no-manifest') {
    const entry = scenario === 'no-manifest-line' ? `9.9.9 ${ASSET} ${digest}` : `0.0.0-test ${ASSET} ${digest}`;
    // A CRLF checkout whose last line has no newline must still match.
    const manifest = scenario === 'crlf-manifest' ? `# test manifest\r\n\r\n${entry}` : `# test manifest\n\n${entry}\n`;
    fs.writeFileSync(path.join(scripts, 'engine-checksums.txt'), manifest);
  }
  const cacheDir = path.join(cache, 'bin', '0.0.0-test');
  if (scenario.startsWith('cached-')) {
    // A cache from an earlier run: no .verified stamp yet.
    fs.mkdirSync(cacheDir, { recursive: true });
    const tampered = Buffer.from('#!/bin/sh\necho tampered-engine\n');
    fs.writeFileSync(path.join(cacheDir, BIN), scenario === 'cached-tampered' ? tampered : PAYLOAD, { mode: 0o755 });
  }
  if (scenario === 'cache-directory-failure') {
    // A file where the cache parent belongs makes mkdir fail on every OS,
    // including privileged test runners where chmod cannot deny writes.
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'bin'), 'blocked');
  }
  if (scenario === 'cache-write-failure') fs.mkdirSync(cacheDir, { recursive: true });
  if (scenario === 'stale-staging') {
    // Leftovers from an older launcher (fixed staging names) or a killed run
    // must not block or be reused by a new download.
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const name of ['impeccable.exe.part', 'impeccable.exe.sha256', '.impeccable.part.1']) {
      const stale = path.join(cacheDir, name);
      fs.writeFileSync(stale, 'stale');
      fs.chmodSync(stale, 0o444);
    }
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
  if (WINDOWS && scenario === 'cache-write-failure') {
    // The cmd launcher claims a fresh staging directory per run, so no
    // pre-created path can collide with it; fail the claim itself instead.
    const claim = 'mkdir "%staging%" >nul 2>nul';
    const source = fs.readFileSync(launcher, 'utf8');
    assert.equal(source.split(claim).length, 2, 'instrument exactly one claim');
    fs.writeFileSync(launcher, source.replace(claim, 'cmd /c exit 1'));
  }
  if (WINDOWS && (placementScenarios.includes(scenario) || ['hash-failure', 'removed-during-hash'].includes(scenario))) {
    // move is a cmd builtin and certutil is an .exe: PATH shims cannot
    // intercept them. Instrument ONLY the external-operation boundary in the
    // staged test copy, preserving the launcher's real labels/checks/status
    // handling. The separate valid case always runs the unmodified launcher.
    const fault = path.join(tools, 'fault.cmd');
    const hashFault = ['hash-failure', 'removed-during-hash'].includes(scenario);
    const operation = hashFault
      ? 'certutil -hashfile "%~1" SHA256 >"%~2" 2>nul'
      : 'move /y "%part%" "%cached%" >nul 2>nul';
    let script;
    if (hashFault) {
      script = `@echo off\n${scenario === 'removed-during-hash' ? 'del "%part%" >nul 2>nul\n' : ''}echo hash header\necho ${HASH}\nexit /b 1\n`;
    } else if (scenario === 'move-failure') {
      script = '@echo off\nexit /b 1\n';
    } else {
      const before = scenario === 'removed-before-move' ? 'del "%part%" >nul 2>nul\n' : '';
      const after = scenario === 'removed-after-move' ? 'del "%cached%" >nul 2>nul\n' : scenario === 'emptied-after-move' ? 'type nul >"%cached%"\n' : '';
      script = `@echo off\n${before}${operation}\nif errorlevel 1 exit /b 1\n${after}exit /b 0\n`;
    }
    fs.writeFileSync(fault, script.replaceAll('\n', '\r\n'));
    const source = fs.readFileSync(launcher, 'utf8');
    assert.equal(source.split(operation).length, 2, 'instrument exactly one operation');
    const replacement = `call "${fault}"${hashFault ? ' >"%~2" 2>nul' : ''}`;
    fs.writeFileSync(launcher, source.replace(operation, replacement));
  }
  const requests = [];
  const interrupt = scenario.startsWith('interrupt-') ? scenario.slice('interrupt-'.length) : null;
  let stalled;
  const stall = new Promise(resolve => { stalled = resolve; });
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (scenario === 'transport-failure') {
      req.socket.destroy();
      return;
    }
    if (interrupt) {
      // Send part of the body and never finish, so the launcher is mid-download.
      res.writeHead(200);
      res.write(PAYLOAD.subarray(0, 8), stalled);
      return;
    }
    if (scenario === 'download-failure') res.writeHead(404);
    res.end(scenario === 'empty-download' ? '' : PAYLOAD);
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
    ...(WINDOWS ? { SystemRoot: process.env.SystemRoot, ComSpec: COMSPEC, PROCESSOR_ARCHITECTURE: scenario === 'arm64-fallback' ? 'ARM64' : 'AMD64' } : {}),
  };
  const run = () => new Promise((resolve, reject) => {
    const child = WINDOWS
      ? spawn(COMSPEC, ['/d', '/s', '/c', `""${launcher}" /d /c echo verified-engine"`], { env, cwd: root, windowsVerbatimArguments: true, timeout: 20000 })
      : spawn('/bin/sh', [launcher], { env, cwd: root, timeout: 20000, detached: Boolean(interrupt) });
    // Signal the whole process group, as Ctrl-C or GNU timeout would.
    if (interrupt) stall.then(() => process.kill(-child.pid, interrupt));
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  const result = await run();
  if (scenario === 'valid') {
    // The stamp is the whole check on later runs: a hash tool that always
    // fails proves nothing rehashes the cached engine.
    if (!WINDOWS) fs.writeFileSync(path.join(tools, 'shasum'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const requestCount = requests.length;
    const cachedResult = await run();
    assert.equal(cachedResult.status, 0, cachedResult.stderr);
    assert.match(cachedResult.stdout, /verified-engine/);
    assert.equal(cachedResult.stderr, '', 'cached execution stays quiet');
    assert.equal(requests.length, requestCount, 'subsequent runs use the cached engine without network');
  }
  assert.equal(result.signal, null, JSON.stringify(result));
  const noDownload = scenario.startsWith('cache-') || scenario.startsWith('no-manifest') || scenario === 'cached-unstamped';
  assert.equal(requests.length, noDownload ? 0 : 1,
    'cache failures, a missing digest and a verified cache make no request; other scenarios download once');
  return { ...result, files: fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).sort() : [], requests, cacheDir };
}

for (const scenario of ['cache-directory-failure', 'cache-write-failure', 'download-failure', 'transport-failure']) {
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
  assert.deepEqual(result.files, [BIN, `${BIN}.verified`], 'the binary lands with its verified stamp');
  assert.equal(result.requests.length, 1);
});

test('launcher reads a CRLF manifest whose last line has no newline', async t => {
  const result = await exercise(t, 'crlf-manifest');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified-engine/);
  assert.deepEqual(result.files, [BIN, `${BIN}.verified`]);
});

test('cmd launcher on ARM64 fetches the x64 asset when only x64 has a line', { skip: WINDOWS ? false : 'Windows-only cmd launcher ARM64 fallback' }, async t => {
  const result = await exercise(t, 'arm64-fallback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified-engine/);
  assert.deepEqual(result.requests, ['/engine-v0.0.0-test/impeccable-windows-x64.exe'], 'no arm64 request without an arm64 line');
  assert.deepEqual(result.files, [BIN, `${BIN}.verified`]);
});

test('launcher hashes an unstamped cached engine once, then trusts the stamp', async t => {
  const result = await exercise(t, 'cached-unstamped');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified-engine/);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.files, [BIN, `${BIN}.verified`]);
  assert.equal(fs.readFileSync(path.join(result.cacheDir, `${BIN}.verified`), 'utf8').trim(), HASH);
});

test('launcher re-downloads a cached engine that does not match the manifest', async t => {
  const result = await exercise(t, 'cached-tampered');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /cannot verify the cached engine/);
  assert.match(result.stdout, /verified-engine/);
  assert.doesNotMatch(result.stdout, /tampered-engine/);
  assert.deepEqual(result.files, [BIN, `${BIN}.verified`]);
  assert.deepEqual(fs.readFileSync(path.join(result.cacheDir, BIN)), PAYLOAD, 'the download replaced the bad file');
});

test('launcher ignores stale staging files from older or killed runs', async t => {
  const result = await exercise(t, 'stale-staging');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified-engine/);
  assert.deepEqual(result.files.sort(),
    ['.impeccable.part.1', BIN, `${BIN}.verified`, 'impeccable.exe.part', 'impeccable.exe.sha256'].sort(),
    'the new download lands and leaves the leftovers untouched');
});

test('cmd launcher stages each run under its own name', () => {
  // Concurrent first runs used to share %cached%.part and %cached%.sha256 (#1002).
  const source = fs.readFileSync(path.join(ROOT, 'skill/scripts/impeccable.cmd'), 'utf8');
  assert.doesNotMatch(source, /%cached%\.(part|sha256)/);
  assert.match(source, /set "staging=[^"\n]*%RANDOM%/);
  assert.match(source, /mkdir "%staging%" >nul 2>nul\r?\nif errorlevel 1 goto claim_staging/);
});

test('cmd launcher is checked out with CRLF line endings', () => {
  const source = fs.readFileSync(path.join(ROOT, 'skill/scripts/impeccable.cmd'));
  const withoutCrlf = Buffer.from(source.toString('binary').replaceAll('\r\n', ''));
  assert.equal(withoutCrlf.includes(10), false, 'cmd.exe batch labels require CRLF line endings');
});

test('cmd launcher forwards engine exit code through cmd /c', { skip: WINDOWS ? false : 'Windows-only cmd /c exit-code forwarding' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-launcher-exit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const launcher = path.join(root, 'impeccable.cmd');
  fs.copyFileSync(path.join(ROOT, 'skill/scripts/impeccable.cmd'), launcher);
  const env = {
    PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    HOME: home, USERPROFILE: home, TEMP: root, TMP: root,
    IMPECCABLE_HOME: path.join(root, 'cache'),
    IMPECCABLE_BIN: COMSPEC,
    SystemRoot: process.env.SystemRoot,
    ComSpec: COMSPEC,
    PROCESSOR_ARCHITECTURE: 'AMD64',
  };
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(COMSPEC, ['/d', '/s', '/c', `""${launcher}" ${args}"`], { env, cwd: root, windowsVerbatimArguments: true, timeout: 20000 });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal }));
  });
  for (const [args, expected] of [['/c exit 2', 2], ['/c exit 1', 1], ['/c exit 0', 0]]) {
    const result = await run(args);
    assert.equal(result.signal, null, JSON.stringify(result));
    assert.equal(result.status, expected, args);
  }
});

for (const [probeStatus, trusted] of [[0, true], [1, false]]) {
  test(`sh launcher ${trusted ? 'runs' : 'skips'} a home binary whose engine-probe exits ${probeStatus}`, { skip: WINDOWS ? 'POSIX launcher probe' : false }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-launcher-probe-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scripts = path.join(root, 'scripts');
    const home = path.join(root, 'home');
    const homeBin = path.join(home, '.impeccable', 'bin');
    fs.mkdirSync(scripts);
    fs.mkdirSync(homeBin, { recursive: true });
    fs.writeFileSync(path.join(scripts, 'VERSION'), '0.0.0-test\n');
    fs.writeFileSync(path.join(scripts, 'engine-checksums.txt'), `0.0.0-test ${ASSET} ${HASH}\n`);
    const launcher = path.join(scripts, 'impeccable');
    fs.copyFileSync(path.join(ROOT, 'skill/scripts/impeccable'), launcher);
    // Prints the handshake marker either way; only the exit status differs.
    fs.writeFileSync(path.join(homeBin, 'impeccable'),
      `#!/bin/sh\nif [ "$1" = engine-probe ]; then echo impeccable-engine 0.0.0-test; exit ${probeStatus}; fi\necho home-engine-ran\n`,
      { mode: 0o755 });
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push(req.url);
      res.writeHead(404);
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: home,
      IMPECCABLE_HOME: path.join(root, 'cache'),
      IMPECCABLE_DOWNLOAD_BASE: `http://127.0.0.1:${server.address().port}`,
    };
    const result = await new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', [launcher, 'detect'], { env, cwd: root, timeout: 20000 });
      let stdout = '';
      child.stdout.on('data', data => { stdout += data; });
      child.on('error', reject);
      child.on('close', (status, signal) => resolve({ status, signal, stdout }));
    });
    assert.equal(result.signal, null, JSON.stringify(result));
    if (trusted) {
      assert.equal(result.status, 0, JSON.stringify(result));
      assert.match(result.stdout, /home-engine-ran/);
      assert.equal(requests.length, 0, 'a trusted home binary needs no download');
    } else {
      assert.equal(result.status, 127, JSON.stringify(result));
      assert.doesNotMatch(result.stdout, /home-engine-ran/);
      assert.equal(requests.length, 1, 'a failed probe falls through to the pinned download');
    }
  });
}

for (const scenario of ['empty-download', 'no-manifest-line', 'no-manifest', 'mismatch', 'hash-failure', 'removed-during-hash', 'removed-before-move', 'removed-after-move', 'emptied-after-move', 'move-failure']) {
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
    } else if (scenario.startsWith('no-manifest')) {
      assert.match(result.stderr, /no checksum for engine 0\.0\.0-test \(impeccable-/);
      assert.match(result.stderr, /refusing the unverified download/);
    } else {
      assert.match(result.stderr, /refusing the unverified download/);
    }
  });
}

for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`launcher removes its partial download when interrupted by ${signal}`, { skip: WINDOWS ? 'POSIX launcher only; the cmd launcher stages in its own directory' : false }, async t => {
    const result = await exercise(t, `interrupt-${signal}`);
    assert.equal(result.status, status, JSON.stringify(result));
    assert.deepEqual(result.files, [], 'no staging file left behind');
  });
}
