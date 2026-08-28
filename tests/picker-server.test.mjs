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
  preview: {
    brand: 'Ha',
    nav: ['Bouquets', 'Workshops', 'Seasonal', 'About'],
    navAction: 'Order',
    menuAction: 'Menu',
    ctaPrimary: 'Shop stems',
    ctaSecondary: 'See the studio',
    proof: ['Same-day pickup', 'Local growers', 'Hand tied', 'Studio open'],
    sectionTitle: 'Stems in season',
    sectionBody: [
      'Each arrangement starts with stems',
      'chosen the morning it ships.',
    ],
    sectionLink: 'Our growers',
    // Three, the count the artboard draws and the manifest validator requires:
    // a fourth card makes the whole file fall back to the default pairs.
    gallery: [
      { title: 'Market bunch', meta: 'From $38' },
      { title: 'Table vase', meta: 'From $52' },
      { title: 'Ceremony', meta: 'From $120' },
    ],
    footerLinks: ['Care guide', 'Delivery', 'Contact', 'Instagram'],
    footerMark: '© Hanazono',
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

async function createFixture({ fonts = true, context = null } = {}) {
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
  const storeDir = path.join(cwd, '.impeccable/design-context');
  if (context) {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'context.json'), `${JSON.stringify(context)}\n`);
  }
  return { cwd, cuesDir, storeDir };
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
    /* A submit spawns a detached doc session that outlives the picker; reap it
       by its own record or it squats a port a later test needs. */
    try {
      const record = JSON.parse(await readFile(path.join(fixture.cwd, '.impeccable/design-context/runtime/session.json'), 'utf8'));
      if (record?.pid) process.kill(record.pid, 'SIGTERM');
    } catch { /* no session was spawned, or it is already gone */ }
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
  assert.match(pageHtml, /data-type-headline/);
  assert.doesNotMatch(pageHtml, />Made to last</);
  assert.match(pageHtml, /assets\/hero-dark\.jpg/);
  const stylesheet = pageHtml.match(/href="(\.\/assets\/[^"]+\.css)"/)?.[1];
  assert.ok(stylesheet);
  assert.equal((await fetch(new URL(stylesheet, `${server.url}/`))).status, 200);

  const faviconResponse = await fetch(`${server.url}/favicon.svg`);
  assert.equal(faviconResponse.status, 200);
  assert.match(faviconResponse.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(await faviconResponse.text(), /<svg/);

  const heroResponse = await fetch(`${server.url}/assets/hero-dark.jpg`);
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
  const submitBody = await submitResponse.json();
  assert.equal(submitBody.ok, true);
  // Submit forks the detached doc-session sibling and hands the tab its
  // address; the picker itself still exits 0 as the completion signal.
  assert.match(submitBody.doc?.base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(typeof submitBody.doc?.token, 'string');
  assert.equal((await exitPromise)[0], 0);

  const answersPath = path.join(
    fixture.cwd,
    '.impeccable/design-context/answers.json',
  );
  assert.deepEqual(JSON.parse(await readFile(answersPath, 'utf8')), answers);
  assert.match(server.stdout(), new RegExp(`ANSWERS ${answersPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // Reap the doc session so the fixture directory can be removed.
  const sessionPath = path.join(fixture.cwd, '.impeccable/design-context/runtime/session.json');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const session = JSON.parse(await readFile(sessionPath, 'utf8'));
      assert.equal(session.token, submitBody.doc.token);
      process.kill(session.pid);
      break;
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
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

test('serves staged brand assets, 404s missing files, and rejects traversal', async (t) => {
  const fixture = await createFixture();
  const assetsDir = path.join(fixture.cwd, '.impeccable/design-context/assets');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(
    path.join(assetsDir, 'mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="26" fill="#175558"/></svg>',
  );
  // A sibling secret one directory up; traversal attempts aim at it.
  await writeFile(
    path.join(fixture.cwd, '.impeccable/design-context/answers.json'),
    '{"secret":true}\n',
  );
  const server = await startPicker(fixture.cwd, ['--port', String(portBase + 30)]);
  await cleanup(t, fixture, server);

  const ok = await fetch(`${server.url}/brand-assets/mark.svg`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(ok.headers.get('cache-control') || '', /max-age/);
  assert.match(await ok.text(), /<svg/);

  assert.equal((await fetch(`${server.url}/brand-assets/missing.png`)).status, 404);
  // Right directory, wrong extension: .json is not a brand-asset type.
  assert.equal((await fetch(`${server.url}/brand-assets/notes.json`)).status, 404);

  // fetch() collapses dot segments before sending, so raw sockets carry the
  // traversal attempts, the same technique the existing traversal test uses.
  for (const attempt of [
    '/brand-assets/../answers.json',
    '/brand-assets/%2e%2e/answers.json',
    '/brand-assets/..%2Fanswers.json',
  ]) {
    assert.ok([400, 404].includes(await rawGet(server.url, attempt)), attempt);
  }
});

test('serves the stored context and the chosen cue, both cacheable', async (t) => {
  const contextFixture = {
    schemaVersion: 1,
    modes: ['persuade', 'read'],
    context: { product: { name: 'Hanazono' } },
  };
  const fixture = await createFixture({ context: contextFixture });
  const server = await startPicker(fixture.cwd, ['--port', String(portBase + 50)]);
  await cleanup(t, fixture, server);

  const contextResponse = await fetch(`${server.url}/context.json`);
  assert.equal(contextResponse.status, 200);
  assert.match(contextResponse.headers.get('cache-control') || '', /max-age/);
  assert.deepEqual(await contextResponse.json(), contextFixture);

  // Nothing has been submitted, so the store carries no chosen cue yet.
  assert.equal((await fetch(`${server.url}/cue.png`)).status, 404);

  const exitPromise = waitForExit(server.processHandle);
  await fetch(`${server.url}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'palette-source': 'hero-01' }),
  });
  assert.equal((await exitPromise)[0], 0);

  // Submit copies the picked hero into the store, so the document can render
  // it after this server is gone and after the workspace is cleaned.
  const stored = await readFile(path.join(fixture.storeDir, 'cue.png'), 'utf8');
  assert.equal(stored, 'fake-png');
});

test('a palette that names no cue leaves the store without one', async (t) => {
  const fixture = await createFixture();
  const server = await startPicker(fixture.cwd, ['--port', String(portBase + 60)]);
  await cleanup(t, fixture, server);

  const exitPromise = waitForExit(server.processHandle);
  await fetch(`${server.url}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'palette-source': 'seed-042' }),
  });
  assert.equal((await exitPromise)[0], 0);

  assert.equal(existsSync(path.join(fixture.storeDir, 'cue.png')), false);
  assert.ok(existsSync(path.join(fixture.storeDir, 'answers.json')));
});

test('migrate carries a pre-store project across and repeats harmlessly', async () => {
  const store = await import(pathToFileURL(path.join(root, 'skill/scripts/design-context/store.mjs')).href);
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'impeccable-migrate-')));
  const legacy = path.join(cwd, '.impeccable/design-interview');
  await mkdir(path.join(legacy, 'assets'), { recursive: true });
  await mkdir(path.join(legacy, 'fonts'), { recursive: true });
  await mkdir(path.join(cwd, '.impeccable/visual-cues'), { recursive: true });
  await writeFile(
    path.join(legacy, 'answers.json'),
    `${JSON.stringify({
      'palette-primary': '#1E4A42',
      'font-heading-source': '.impeccable/design-interview/fonts/Display.woff2',
    })}\n`,
  );
  await writeFile(path.join(legacy, 'doc-edits.jsonl'), '{"at":"2026-01-01T00:00:00.000Z","type":"color"}\n');
  await writeFile(path.join(legacy, 'assets/mark.svg'), '<svg/>');
  await writeFile(path.join(legacy, 'fonts/Display.woff2'), 'font-bytes');
  await writeFile(
    path.join(cwd, '.impeccable/visual-cues/cues.json'),
    `${JSON.stringify({ cues: ['hero-01'], palette: {}, modes: ['read'], context: { product: { name: 'Old' } } })}\n`,
  );

  assert.deepEqual(await store.migrate(cwd), { migrated: true, deferred: false });
  const target = store.paths(cwd);
  assert.ok(existsSync(target.answersJson));
  assert.ok(existsSync(target.journalJsonl));
  assert.equal(await readFile(path.join(target.assetsDir, 'mark.svg'), 'utf8'), '<svg/>');
  assert.equal(await readFile(path.join(target.fontsDir, 'Display.woff2'), 'utf8'), 'font-bytes');
  assert.equal(existsSync(legacy), false);

  // The uploaded-face path travelled inside the answers themselves.
  const answers = JSON.parse(await readFile(target.answersJson, 'utf8'));
  assert.equal(answers['font-heading-source'], '.impeccable/design-context/fonts/Display.woff2');

  // The chat half moves out of the cue manifest, which keeps its own data.
  assert.deepEqual(JSON.parse(await readFile(target.contextJson, 'utf8')), {
    schemaVersion: 1,
    modes: ['read'],
    context: { product: { name: 'Old' } },
  });
  const cues = JSON.parse(await readFile(target.cuesJson, 'utf8'));
  assert.deepEqual(cues.cues, ['hero-01']);

  // A legacy line carries no seq, so it can never move the counter.
  assert.equal(store.replayJournal(cwd).lastSeq, 0);

  // Second pass: nothing left to move, nothing damaged.
  assert.deepEqual(await store.migrate(cwd), { migrated: false, deferred: false });
  assert.ok(existsSync(target.answersJson));

  await rm(cwd, { recursive: true, force: true });
});

test('migrate defers while a pre-store session is still alive', async () => {
  const store = await import(pathToFileURL(path.join(root, 'skill/scripts/design-context/store.mjs')).href);
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'impeccable-migrate-live-')));
  const legacy = path.join(cwd, '.impeccable/design-interview');
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'answers.json'), '{"palette-primary":"#1E4A42"}\n');
  // This process is the liveness proof: a session of the old shape holds the
  // old paths in its own constants, so moving files under it would strand it.
  await writeFile(
    path.join(legacy, 'doc-session.json'),
    `${JSON.stringify({ pid: process.pid, port: 1, token: 'x' })}\n`,
  );

  assert.deepEqual(await store.migrate(cwd), { migrated: false, deferred: true });
  assert.ok(existsSync(path.join(legacy, 'answers.json')));
  assert.equal(existsSync(store.paths(cwd).answersJson), false);

  await rm(cwd, { recursive: true, force: true });
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
  // Swatch ink is theme-independent: it sits on a color the user picked, so
  // it must not follow the picker's own light/dark tokens.
  assert.equal(contrastInk('#FFFFFF'), 'var(--pk-ink-dark)');
  assert.equal(contrastInk('#000000'), 'var(--pk-ink-light)');
  // A mid-tone reads better against the dark ink, which a fixed lightness
  // threshold gets backwards.
  assert.equal(contrastInk('#8D7352'), 'var(--pk-ink-dark)');
});

test('neutral contrast issue flags mid-tones and low primary separation', async () => {
  const { neutralContrastIssue } = await import(colorModule);
  // The fixture cue palette: near-white neutral under a deep green primary.
  assert.deepEqual(neutralContrastIssue({ neutral: '#F2EFE8', primary: '#1E4A42' }), []);
  // Near-black neutral under a light primary is the other healthy shape.
  assert.deepEqual(neutralContrastIssue({ neutral: '#141414', primary: '#E8C36A' }), []);
  // A mid-tone neutral: neither fixed ink reaches 7:1 on it. The near-white
  // primary keeps the separation check passing, so this is one line only.
  assert.deepEqual(
    neutralContrastIssue({ neutral: '#777777', primary: '#F5F2EA' }),
    ['This background is too close to a middle gray, so text on it will be hard to read. Try a much lighter or much darker color.'],
  );
  // A primary that melts into a healthy near-white neutral: one line only.
  assert.deepEqual(
    neutralContrastIssue({ neutral: '#F2EFE8', primary: '#E8E4DC' }),
    ['Your main color and this background are too similar, so buttons and cards will blend in. Try more difference between them.'],
  );
  // A mid-tone the primary also melts into reports both, mid-tone first.
  const both = neutralContrastIssue({ neutral: '#777777', primary: '#8A8A8A' });
  assert.equal(both.length, 2);
  assert.match(both[0], /middle gray/);
  assert.match(both[1], /too similar/);
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

/* The doc session serves the design context document's own images after the
   picker server has exited on submit. The route is token-gated, read-only, and
   contained, but unlike /brand-assets/ it must reach into subdirectories,
   because the vendored files sit per category. */
test('doc session serves picker assets, token-gated and contained', async (t) => {
  const fixture = await createFixture();
  const sessionScript = path.join(root, 'skill/scripts/picker-doc-session.mjs');
  const builtAsset = path.join(root, 'skill/scripts/picker/assets/audience/needs-foil.png');
  /* skill/scripts/picker/ is gitignored build output, so a fresh clone has no
     assets to serve. The gate for this work always builds first; here the
     happy-path reads skip rather than fail on a tree that never built. */
  const built = existsSync(builtAsset);

  const child = spawn(process.execPath, [sessionScript, '--port', String(portBase + 60)], {
    cwd: fixture.cwd,
    env: { ...process.env, IMPECCABLE_DOC_TOKEN: 't-assets' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const sessionFile = path.join(fixture.cwd, '.impeccable/design-context/runtime/session.json');
    let session = null;
    for (let attempt = 0; attempt < 100 && !session; attempt += 1) {
      if (existsSync(sessionFile)) session = JSON.parse(await readFile(sessionFile, 'utf8'));
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(session?.port, 'the session never recorded its port');
    const base = `http://127.0.0.1:${session.port}`;

    if (built) {
      const ok = await fetch(`${base}/assets/audience/needs-foil.png?token=t-assets`);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('content-type'), 'image/png');
      assert.ok((await ok.arrayBuffer()).byteLength > 0, 'served an empty body');

      // Subdirectories deeper than one level resolve too.
      const nested = await fetch(`${base}/assets/brand/placeholders/hanazono-primary-mark.png?token=t-assets`);
      assert.equal(nested.status, 200);
    } else {
      t.diagnostic('skipping the served-file assertions: run `bun run build:picker` to cover them');
    }

    // The gate and the containment hold whether or not the tree has been built.
    assert.equal((await fetch(`${base}/assets/audience/needs-foil.png?token=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/assets/audience/needs-foil.png`)).status, 403);
    assert.equal((await fetch(`${base}/assets/..%2Fpicker-server.mjs?token=t-assets`)).status, 404);
    assert.equal((await fetch(`${base}/assets/../picker-server.mjs?token=t-assets`)).status, 404);
    /* An extension the route DOES allow, on a real file outside the assets
       directory: only the containment check can turn this one away, so it is
       the case that actually tests it. */
    assert.equal((await fetch(`${base}/assets/../favicon.svg?token=t-assets`)).status, 404);
    assert.equal((await fetch(`${base}/assets/..%2F..%2F..%2F..%2Fpicker/assets/favicon.svg?token=t-assets`)).status, 404);
    assert.equal((await fetch(`${base}/assets/audience/needs-foil.txt?token=t-assets`)).status, 404);
    assert.equal((await fetch(`${base}/assets/?token=t-assets`)).status, 404);
  } finally {
    child.kill('SIGTERM');
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

test('a request reply carries attached answers into the store', async () => {
  const fixture = await createFixture();
  const sessionScript = path.join(root, 'skill/scripts/picker-doc-session.mjs');
  const answersPath = path.join(fixture.storeDir, 'answers.json');
  await mkdir(fixture.storeDir, { recursive: true });
  await writeFile(answersPath, `${JSON.stringify({ 'palette-primary': '#111111' })}\n`);

  const child = spawn(process.execPath, [sessionScript, '--port', String(portBase + 61)], {
    cwd: fixture.cwd,
    env: { ...process.env, IMPECCABLE_DOC_TOKEN: 't-reply' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const sessionFile = path.join(fixture.cwd, '.impeccable/design-context/runtime/session.json');
    let session = null;
    for (let attempt = 0; attempt < 100 && !session; attempt += 1) {
      if (existsSync(sessionFile)) session = JSON.parse(await readFile(sessionFile, 'utf8'));
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(session?.port, 'the session never recorded its port');
    const post = (route, body) => fetch(`http://127.0.0.1:${session.port}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const request = await post('/doc/request', { token: 't-reply', kind: 'freeform', prompt: 'Swap the heading face' });
    const { id } = await request.json();
    const reply = await post('/doc/reply', {
      token: 't-reply', id, status: 'done', message: 'Swapped.', answers: { 'font-heading': 'Fraunces' },
    });
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).applied?.answers, 1);
    let answers = JSON.parse(await readFile(answersPath, 'utf8'));
    assert.equal(answers['font-heading'], 'Fraunces');
    assert.equal(answers['palette-primary'], '#111111');

    /* A retry releases the request untouched, so its values must not land. */
    const second = await post('/doc/request', { token: 't-reply', kind: 'freeform', prompt: 'Another ask' });
    const { id: id2 } = await second.json();
    const retry = await post('/doc/reply', { token: 't-reply', id: id2, status: 'retry', answers: { 'font-heading': 'Sora' } });
    assert.equal((await retry.json()).applied, null);
    answers = JSON.parse(await readFile(answersPath, 'utf8'));
    assert.equal(answers['font-heading'], 'Fraunces');
  } finally {
    child.kill('SIGTERM');
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

test('export bundles multi-megabyte files and still skips absurd ones', async () => {
  const fixture = await createFixture();
  await mkdir(path.join(fixture.storeDir, 'assets'), { recursive: true });
  await writeFile(path.join(fixture.storeDir, 'answers.json'), `${JSON.stringify({ 'palette-primary': '#111111' })}\n`);
  await writeFile(path.join(fixture.storeDir, 'cue.png'), Buffer.alloc(2 * 1024 * 1024, 7));
  await writeFile(path.join(fixture.storeDir, 'assets', 'oversize.png'), Buffer.alloc(9 * 1024 * 1024, 7));

  try {
    const portability = await import(pathToFileURL(path.join(root, 'skill/scripts/design-context/portability.mjs')).href);
    const { bundlePath, skipped } = await portability.exportDesignContext(fixture.cwd, {});
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    assert.deepEqual(bundle.files.map((file) => file.path), ['cue.png']);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].path, 'assets/oversize.png');
    assert.deepEqual(bundle.skipped.map((entry) => entry.path), ['assets/oversize.png']);
  } finally {
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

test('questionnaire refuses to start without cues.json', async () => {
  const fixture = await createFixture();
  await rm(path.join(fixture.cuesDir, 'cues.json'));

  const child = spawn(process.execPath, [serverScript, '--port', String(portBase + 63)], {
    cwd: fixture.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /No visual cues found\. Run \/impeccable document --seed/);
  } finally {
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

/* The chosen cue joins the doc session's image routes: one fixed store file,
   token-gated, PNG only. The 404 is the run whose palette named no cue, so
   nothing was ever copied in. */
test('doc session serves the stored cue, token-gated', async () => {
  const fixture = await createFixture();
  const sessionScript = path.join(root, 'skill/scripts/picker-doc-session.mjs');
  const child = spawn(process.execPath, [sessionScript, '--port', String(portBase + 70)], {
    cwd: fixture.cwd,
    env: { ...process.env, IMPECCABLE_DOC_TOKEN: 't-cue' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const sessionFile = path.join(fixture.cwd, '.impeccable/design-context/runtime/session.json');
    let session = null;
    for (let attempt = 0; attempt < 100 && !session; attempt += 1) {
      if (existsSync(sessionFile)) session = JSON.parse(await readFile(sessionFile, 'utf8'));
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(session?.port, 'the session never recorded its port');
    const base = `http://127.0.0.1:${session.port}`;

    // No submit has copied a cue in yet.
    assert.equal((await fetch(`${base}/cue.png?token=t-cue`)).status, 404);

    await mkdir(path.join(fixture.cwd, '.impeccable/design-context'), { recursive: true });
    await writeFile(path.join(fixture.cwd, '.impeccable/design-context/cue.png'), Buffer.from('fake-cue-png'));

    const ok = await fetch(`${base}/cue.png?token=t-cue`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.match(ok.headers.get('cache-control') || '', /max-age/);
    assert.equal(await ok.text(), 'fake-cue-png');

    assert.equal((await fetch(`${base}/cue.png?token=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/cue.png`)).status, 403);
  } finally {
    child.kill('SIGTERM');
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

/* The Hooks page's live channel: GET /doc/hooks reads the project's hook
   state and POST /doc/hooks applies a full desired state, both through
   hook-admin.mjs with no model in the loop. Exact-set semantics: an entry
   missing from a later payload is a removal, which the union-merging CLI
   verbs cannot express. */
test('doc session reads and applies hook state, token-gated', async () => {
  const fixture = await createFixture();
  const sessionScript = path.join(root, 'skill/scripts/picker-doc-session.mjs');
  const child = spawn(process.execPath, [sessionScript, '--port', String(portBase + 80)], {
    cwd: fixture.cwd,
    env: { ...process.env, IMPECCABLE_DOC_TOKEN: 't-hooks' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const sessionFile = path.join(fixture.cwd, '.impeccable/design-context/runtime/session.json');
    let session = null;
    for (let attempt = 0; attempt < 100 && !session; attempt += 1) {
      if (existsSync(sessionFile)) session = JSON.parse(await readFile(sessionFile, 'utf8'));
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(session?.port, 'the session never recorded its port');
    const base = `http://127.0.0.1:${session.port}`;

    // Fresh project: defaults, nothing ignored.
    const fresh = await fetch(`${base}/doc/hooks?token=t-hooks`);
    assert.equal(fresh.status, 200);
    assert.deepEqual((await fresh.json()).state, {
      enabled: true, ignoreRules: [], ignoreFiles: [], ignoreValues: [],
    });

    // Apply a full state and read it back from the response and the disk.
    const applied = await fetch(`${base}/doc/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 't-hooks',
        state: {
          enabled: false,
          ignoreRules: ['side-tab'],
          ignoreFiles: ['src/legacy/**'],
          ignoreValues: [{ rule: 'overused-font', value: 'Inter', reason: 'user confirmed' }],
        },
      }),
    });
    assert.equal(applied.status, 200);
    const appliedState = (await applied.json()).state;
    assert.equal(appliedState.enabled, false);
    assert.deepEqual(appliedState.ignoreRules, ['side-tab']);
    const config = JSON.parse(await readFile(path.join(fixture.cwd, '.impeccable/config.json'), 'utf8'));
    assert.equal(config.hook.enabled, false);
    assert.deepEqual(config.detector.ignoreRules, ['side-tab']);
    assert.deepEqual(config.detector.ignoreFiles, ['src/legacy/**']);
    assert.equal(config.detector.ignoreValues.length, 1);

    // Removals stick: a payload without the entries clears them on disk.
    const cleared = await fetch(`${base}/doc/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 't-hooks',
        state: { enabled: false, ignoreRules: [], ignoreFiles: [], ignoreValues: [] },
      }),
    });
    assert.equal(cleared.status, 200);
    const clearedConfig = JSON.parse(await readFile(path.join(fixture.cwd, '.impeccable/config.json'), 'utf8'));
    assert.deepEqual(clearedConfig.detector.ignoreRules, []);
    assert.deepEqual(clearedConfig.detector.ignoreValues, []);

    // The gate and the validation hold.
    assert.equal((await fetch(`${base}/doc/hooks`)).status, 403);
    assert.equal((await fetch(`${base}/doc/hooks?token=wrong`)).status, 403);
    const rejected = await fetch(`${base}/doc/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 't-hooks', state: { ignoreValues: [{ rule: 'x', value: '*' }] } }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    child.kill('SIGTERM');
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});
