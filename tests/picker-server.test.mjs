/**
 * Focused integration tests for the browser questionnaire server.
 * Run with: node --test tests/picker-server.test.mjs
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(root, 'skill/scripts/picker-server.mjs');
const pickerIndex = path.join(root, 'skill/scripts/picker/index.html');
const portBase = 18_500 + (process.pid % 500);
const cueManifestFixture = {
  cues: ['hero-01'],
  palette: {
    'hero-01': {
      primary: { hex: '#1E4A42', snapped: '#1F4B42', at: [168, 252] },
      secondary: { hex: '#8C7251', snapped: '#8D7352', at: [424, 318] },
      tertiary: { hex: '#D8A82F', snapped: '#D7A930', at: [702, 190] },
      neutral: { hex: '#F2EFE8', snapped: '#F1EEE7', at: [86, 94] },
    },
  },
};

before(() => {
  if (existsSync(pickerIndex)) return;
  execFileSync(process.execPath, [path.join(root, 'scripts/build-picker.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
});

async function createFixture() {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'impeccable-picker-')));
  const cuesDir = path.join(cwd, '.impeccable/visual-cues');
  await mkdir(cuesDir, { recursive: true });
  await writeFile(path.join(cuesDir, 'hero-01.png'), Buffer.from('fake-png'));
  await writeFile(
    path.join(cuesDir, 'cues.json'),
    `${JSON.stringify(cueManifestFixture)}\n`,
  );
  return { cwd, cuesDir };
}

async function startPicker(cwd, args = []) {
  const processHandle = spawn(process.execPath, [serverScript, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle.stdout.setEncoding('utf8');
  processHandle.stderr.setEncoding('utf8');

  let stdout = '';
  let stderr = '';
  let settled = false;
  let resolveUrl;
  let rejectUrl;
  const urlPromise = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  const timer = setTimeout(() => {
    if (!settled) rejectUrl(new Error(`Server start timeout. stdout=${stdout} stderr=${stderr}`));
  }, 5000);

  processHandle.stdout.on('data', (chunk) => {
    stdout += chunk;
    const firstLine = stdout.split(/\r?\n/)[0];
    if (!settled && firstLine.startsWith('PICKER_URL ')) {
      settled = true;
      clearTimeout(timer);
      resolveUrl({ firstLine, url: firstLine.slice('PICKER_URL '.length) });
    }
  });
  processHandle.stderr.on('data', (chunk) => { stderr += chunk; });
  processHandle.once('error', (error) => {
    if (!settled) rejectUrl(error);
  });
  processHandle.once('exit', (code) => {
    if (!settled) rejectUrl(new Error(`Server exited ${code}. stdout=${stdout} stderr=${stderr}`));
  });

  const started = await urlPromise;
  return {
    ...started,
    processHandle,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function waitForExit(processHandle) {
  if (processHandle.exitCode !== null) return [processHandle.exitCode, processHandle.signalCode];
  return once(processHandle, 'exit');
}

async function cleanup(t, fixture, server) {
  t.after(async () => {
    if (server?.processHandle.exitCode === null) server.processHandle.kill('SIGTERM');
    await rm(fixture.cwd, { recursive: true, force: true });
  });
}

function rawGet(baseUrl, requestPath) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: url.hostname,
      port: url.port,
      path: requestPath,
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}

test('serves picker and cues, writes submission, prints answers, and exits 0', async (t) => {
  const fixture = await createFixture();
  const server = await startPicker(fixture.cwd, ['--port', String(portBase)]);
  await cleanup(t, fixture, server);

  assert.equal(server.firstLine, `PICKER_URL ${server.url}`);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const pageResponse = await fetch(`${server.url}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html/);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /data-copy-url/);
  assert.match(pageHtml, /Open this link in your browser at least 1200px wide/);
  assert.match(pageHtml, /data-copy-url-value aria-label="Picker URL"><\/code>/);
  assert.match(pageHtml, /aria-label="Copy link"/);
  assert.match(pageHtml, />Start<span class="ks-button-arrow"/);
  assert.match(pageHtml, /rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg"/);
  assert.match(pageHtml, /assets\/hero-light\.jpg/);
  const stylesheet = pageHtml.match(/href="(\.\/assets\/[^"]+\.css)"/)?.[1];
  assert.ok(stylesheet);
  assert.equal((await fetch(new URL(stylesheet, `${server.url}/`))).status, 200);

  const faviconResponse = await fetch(`${server.url}/favicon.svg`);
  assert.equal(faviconResponse.status, 200);
  assert.match(faviconResponse.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(await faviconResponse.text(), /<svg/);

  const heroResponse = await fetch(`${server.url}/assets/hero-light.jpg`);
  assert.equal(heroResponse.status, 200);
  assert.equal(heroResponse.headers.get('content-type'), 'image/jpeg');
  assert.ok((await heroResponse.arrayBuffer()).byteLength > 0);

  const cueResponse = await fetch(`${server.url}/cues/hero-01.png`);
  assert.equal(cueResponse.status, 200);
  assert.equal(await cueResponse.text(), 'fake-png');
  const cueManifest = await fetch(`${server.url}/cues.json`);
  assert.equal(cueManifest.status, 200);
  assert.deepEqual(await cueManifest.json(), cueManifestFixture);

  const exitPromise = waitForExit(server.processHandle);
  const answers = { register: 'brand', direction: 'kinpaku' };
  const submitResponse = await fetch(`${server.url}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers),
  });
  assert.equal(submitResponse.status, 200);
  assert.deepEqual(await submitResponse.json(), { ok: true });
  assert.equal((await exitPromise)[0], 0);

  const answersPath = path.join(
    fixture.cwd,
    '.impeccable/design-interview/answers.json',
  );
  assert.deepEqual(JSON.parse(await readFile(answersPath, 'utf8')), answers);
  assert.match(server.stdout(), new RegExp(`ANSWERS ${answersPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('rejects raw, encoded, and double-encoded path traversal', async (t) => {
  const fixture = await createFixture();
  const server = await startPicker(fixture.cwd, ['--port', String(portBase + 20)]);
  await cleanup(t, fixture, server);

  const attempts = [
    '/../../etc/hosts',
    '/%2e%2e/%2e%2e/etc/hosts',
    '/%252e%252e/%252e%252e/etc/hosts',
    '/assets/..%2F..%2Fetc/hosts',
  ];
  for (const attempt of attempts) {
    assert.ok([400, 404].includes(await rawGet(server.url, attempt)), attempt);
  }

  const exitPromise = waitForExit(server.processHandle);
  await fetch(`${server.url}/submit`, {
    method: 'POST',
    body: JSON.stringify({ done: true }),
  });
  assert.equal((await exitPromise)[0], 0);
});

test('timeout exits 2 with one stderr line', async (t) => {
  const fixture = await createFixture();
  const server = await startPicker(fixture.cwd, [
    '--port',
    String(portBase + 40),
    '--timeout',
    '0.002',
  ]);
  await cleanup(t, fixture, server);

  assert.equal((await waitForExit(server.processHandle))[0], 2);
  assert.equal(server.stderr().trim(), 'Picker timed out without a submission.');
});
