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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { before, test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(root, 'skill/scripts/picker-server.mjs');
const paletteScript = path.join(root, 'skill/scripts/palette.mjs');
const colorModule = pathToFileURL(path.join(root, 'picker/scripts/color.js')).href;
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
const fontManifestFixture = {
  version: 1,
  specimen: {
    headline: 'Flowers shaped by hand',
    body: 'Seasonal stems become arrangements made for one room and one moment.',
  },
  pairs: [
    {
      id: 'marcellus-karla',
      name: 'Atelier Classic',
      heading: { family: 'Marcellus', weight: 400 },
      body: { family: 'Karla', weight: 400 },
      why: 'Marcellus echoes the high-contrast lettering observed in the atelier mark.',
    },
    {
      id: 'bitter-cabin',
      name: 'Garden Ledger',
      heading: { family: 'Bitter', weight: 600 },
      body: { family: 'Cabin', weight: 400 },
      why: 'Bitter gives the seasonal catalog the practical character named in Positioning.',
    },
  ],
};

before(() => {
  if (existsSync(pickerIndex)) return;
  execFileSync(process.execPath, [path.join(root, 'scripts/build-picker.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
});

async function createFixture({ fonts = true } = {}) {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'impeccable-picker-')));
  const cuesDir = path.join(cwd, '.impeccable/visual-cues');
  await mkdir(cuesDir, { recursive: true });
  await writeFile(path.join(cuesDir, 'hero-01.png'), Buffer.from('fake-png'));
  await writeFile(
    path.join(cuesDir, 'cues.json'),
    `${JSON.stringify(cueManifestFixture)}\n`,
  );
  if (fonts) {
    await writeFile(
      path.join(cuesDir, 'fonts.json'),
      `${JSON.stringify(fontManifestFixture)}\n`,
    );
  }
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

  const fontsResponse = await fetch(`${server.url}/fonts.json`);
  assert.equal(fontsResponse.status, 200);
  assert.match(fontsResponse.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await fontsResponse.json(), fontManifestFixture);

  const palettesResponse = await fetch(`${server.url}/palettes.json`);
  assert.equal(palettesResponse.status, 200);
  assert.match(palettesResponse.headers.get('content-type'), /^application\/json/);
  const { seeds } = await palettesResponse.json();
  assert.ok(seeds.length > 100);
  for (const seed of seeds) {
    assert.deepEqual(Object.keys(seed), ['id', 'oklch', 'mood']);
    assert.equal(typeof seed.id, 'string');
    assert.equal(seed.oklch.length, 3);
    assert.equal(typeof seed.mood, 'string');
  }

  const exitPromise = waitForExit(server.processHandle);
  const answers = { cue: 'hero-01', direction: 'kinpaku' };
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

test('fonts endpoint returns 404 when fonts.json is absent', async (t) => {
  const fixture = await createFixture({ fonts: false });
  const server = await startPicker(fixture.cwd, ['--port', String(portBase + 10)]);
  await cleanup(t, fixture, server);

  const response = await fetch(`${server.url}/fonts.json`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('palette CLI still prints a seed', () => {
  const output = execFileSync(process.execPath, [paletteScript], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /^BRAND SEED · seed-\d+/);
  assert.match(output, /Seed color \(anchor for your primary brand color\):/);
});

test('picker color math round-trips sRGB and clips out-of-gamut OKLCH', async () => {
  const {
    contrastInk,
    formatOklch,
    hexToOklch,
    oklchToHex,
    seedToRoles,
  } = await import(colorModule);
  const channels = (hex) => hex.match(/[\dA-F]{2}/gi).map((pair) => Number.parseInt(pair, 16));

  for (const hex of ['#FFFFFF', '#1E4A42', '#D7A930']) {
    const expected = channels(hex);
    const actual = channels(oklchToHex(hexToOklch(hex)));
    actual.forEach((channel, index) => assert.ok(Math.abs(channel - expected[index]) <= 1));
  }

  const clipped = oklchToHex([0.7, 0.4, 40]);
  assert.match(clipped, /^#[\dA-F]{6}$/);
  assert.ok(hexToOklch(clipped)[1] < 0.4);
  assert.match(formatOklch('#1E4A42'), /^oklch\(\d+\.\d% \d+\.\d{3} \d+\.\d\)$/);
  assert.deepEqual(Object.keys(seedToRoles({ oklch: [0.62, 0.15, 210] })), [
    'primary', 'secondary', 'tertiary', 'neutral',
  ]);
  assert.equal(contrastInk('#FFFFFF'), 'var(--ks-champagne)');
  assert.equal(contrastInk('#000000'), 'var(--ks-lacquer-raised)');
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
