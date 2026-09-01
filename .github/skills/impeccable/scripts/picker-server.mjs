#!/usr/bin/env node
/** Browser questionnaire server (self-contained, zero dependencies).
 * Serves picker files and cues, writes one JSON submission, then exits.
 * Usage: node <scripts_path>/picker-server.mjs [--port 8500]
 *   [--cues-dir .impeccable/visual-cues] [--timeout 60]
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './palette.mjs';
import {
  clearDraft,
  fontRelativePath,
  migrate,
  paths,
  pidAlive,
  readAnswers,
  readDraft,
  readJsonSoft,
  writeDraft,
  writeJsonAtomic,
} from './design-context/store.mjs';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pickerDir = path.join(scriptDir, 'picker');
const store = paths(process.cwd());
const answersPath = store.answersJson;
const fontsDir = store.fontsDir;
const brandAssetsDir = store.assetsDir;
const MAX_BODY_BYTES = 1024 * 1024;
const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const BRAND_ASSET_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
]);
function printHelp() {
  console.log(`Usage: node picker-server.mjs [options]

Serve the Impeccable design picker and wait for one form submission.

Options:
  --port PORT       Scan for an open port from PORT (default: 8500)
  --cues-dir PATH   Visual cues directory (default: .impeccable/visual-cues)
  --timeout MINUTES Exit 2 if nothing submits (default: 60)
  --fresh           Start blank, ignoring any previous answers or draft
  --doc             Reopen the design context document; no questionnaire
  --help            Show this help

Output:
  PICKER_URL URL    Printed when the server is ready
  ANSWERS PATH      Printed after answers.json is written

Also served, for the design context document the questionnaire reveals:
  /context.json     The chat half of the interview, from the design-context store
  /cue.png          The chosen cue image, copied into the store at submit

See reference/visual-cues.md for the canonical agent flow.`);
}

function readOption(args, index) {
  const arg = args[index];
  const equals = arg.indexOf('=');
  if (equals !== -1) return { value: arg.slice(equals + 1), next: index };
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${arg} requires a value`);
  }
  return { value: args[index + 1], next: index + 1 };
}
function parseArgs(args) {
  const options = {
    port: 8500,
    cuesDir: path.resolve(process.cwd(), '.impeccable/visual-cues'),
    timeoutMinutes: 60,
    fresh: false,
    doc: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    /* Value-less flags are read before the guard below, which would reject
       them, and before readOption, which demands a value for every flag. */
    if (arg === '--fresh') { options.fresh = true; continue; }
    if (arg === '--doc') { options.doc = true; continue; }
    if (!arg.startsWith('--port') && !arg.startsWith('--cues-dir') && !arg.startsWith('--timeout')) throw new Error(`Unknown option: ${arg}`);

    const { value, next } = readOption(args, index);
    index = next;
    if (arg.startsWith('--port')) options.port = Number(value);
    if (arg.startsWith('--cues-dir')) options.cuesDir = path.resolve(process.cwd(), value);
    if (arg.startsWith('--timeout')) options.timeoutMinutes = Number(value);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  if (!Number.isFinite(options.timeoutMinutes) || options.timeoutMinutes <= 0) throw new Error('--timeout must be a positive number of minutes');
  return options;
}
async function findOpenPort(start = 8500) {
  if (start > 65535) throw new Error('No open picker port found');
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(start, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.on('error', () => resolve(findOpenPort(start + 1)));
  });
}
function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
function decodeRequestPath(rawUrl = '/') {
  let decoded = rawUrl.split('?')[0];
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }

  decoded = decoded.replaceAll('\\', '/');
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function containedPath(baseDir, relativePath) {
  const candidate = path.resolve(baseDir, relativePath);
  const relative = path.relative(baseDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

async function serveFile(response, baseDir, relativePath, allowedExtensions = MIME.keys()) {
  const filePath = containedPath(baseDir, relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  if (!filePath || ![...allowedExtensions].includes(extension) || !MIME.has(extension)) {
    response.removeHeader('Cache-Control');
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME.get(extension),
      'Content-Length': body.length,
    });
    response.end(body);
  } catch {
    response.removeHeader('Cache-Control');
    sendJson(response, 404, { error: 'Not found' });
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, 'Request body exceeds 1 MB');
    chunks.push(chunk);
  }

  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Body must be a JSON object');
  return value;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

/* A project interviewed by an older release keeps its answers, assets, and
   uploaded faces under the pre-store layout. Bring them across before serving. */
await migrate(process.cwd());

const port = await findOpenPort(options.port);
let completed = false;
let timeout;
let docWatch;
/* In document mode the run already happened: this process serves the document
   built from it, and the edit session is what it waits on. */
let docSession = null;

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.message });
    else response.destroy();
  });
});

async function handleRequest(request, response) {
  const requestPath = decodeRequestPath(request.url);
  if (!requestPath) {
    sendJson(response, 400, { error: 'Invalid path' });
    return;
  }

  if (request.method === 'POST' && requestPath === '/submit') {
    /* Document mode is showing a run that already finished; there is nothing
       left to submit, and writing one would overwrite the answers it renders. */
    if (options.doc) {
      sendJson(response, 409, { error: 'The document is open; there is nothing to submit' });
      return;
    }
    if (completed) {
      sendJson(response, 409, { error: 'Submission already received' });
      return;
    }
    const answers = await readJsonBody(request);
    await writeJsonAtomic(answersPath, answers);
    await copyChosenCue(answers);
    /* The run is on the record now, so the half-finished copy of it goes. */
    await clearDraft();
    completed = true;
    clearTimeout(timeout);

    /* The document the review tab is about to reveal stays editable through a
       detached sibling: it owns the edit endpoints on its own port, so this
       process can still exit as the agent's completion signal. The tab learns
       where to reach it from this response; the agent learns from
       runtime/session.json, which the sibling writes at boot. */
    const doc = await spawnDocSession();
    /* The tab fires its first asset requests the moment this response lands,
       and an img that reaches a forked session still booting fails once and
       never retries. The session writes its record only after listen succeeds,
       so the record on disk is readiness itself; no HTTP probe, which would
       also mark the session adopted before any tab has seen it. */
    if (doc) await waitForSessionRecord(5000, doc.port);
    response.once('finish', () => {
      console.log(`ANSWERS ${answersPath}`);
      server.close(() => process.exit(0));
      server.closeAllConnections?.();
    });
    sendJson(response, 200, { ok: true, doc });
    return;
  }

  /* The questionnaire posts its whole form after every screen change, so a run
     the visitor walks away from resumes where they left it instead of starting
     over. The submission supersedes the draft and removes it. */
  if (request.method === 'POST' && requestPath === '/autosave') {
    if (completed) {
      sendJson(response, 409, { error: 'Submission already received' });
      return;
    }
    await writeDraft(await readJsonBody(request));
    sendJson(response, 200, { ok: true });
    return;
  }

  // Uploaded faces are stored, not parsed: the questionnaire defers validation
  // to the end, so the server only needs to put the bytes where the agent can
  // reach them and hand back the path the answers will carry.
  if (request.method === 'POST' && requestPath === '/font-upload') {
    const name = path.basename(request.headers['x-font-filename'] || '');
    if (!name || !FONT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      sendJson(response, 400, { error: 'Expected a .woff2, .woff, .ttf, or .otf filename' });
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw httpError(413, 'Font exceeds 1 MB');
      chunks.push(chunk);
    }
    await mkdir(fontsDir, { recursive: true });
    await writeFile(path.join(fontsDir, name), Buffer.concat(chunks));
    sendJson(response, 200, { path: fontRelativePath(name) });
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }
  /* One fetch tells the client how to start: which surface it is serving, and
     the answers to restore, if any. Never cached, because the draft moves
     while the questionnaire is open and a stale copy would restore a run the
     visitor has already moved past. */
  if (requestPath === '/boot.json') {
    const { prior, priorSource } = await resolvePrior();
    response.setHeader('Cache-Control', 'no-store');
    sendJson(response, 200, {
      mode: options.doc ? 'doc' : 'questionnaire',
      prior,
      priorSource,
      /* Present only where the document is live for edits. Absent leaves it
         rendering read-only, which is the honest state when no session took. */
      doc: docSession ? { base: `http://127.0.0.1:${docSession.port}`, token: docSession.token } : null,
    });
    return;
  }
  if (requestPath === '/cues.json') {
    await serveFile(response, options.cuesDir, 'cues.json', ['.json']);
    return;
  }
  /* The chat half of the interview, and the chosen cue, both live in the store
     rather than the generation workspace. The document reads them after this
     process exits, so they carry the same cache rule the cue images do. */
  if (requestPath === '/context.json') {
    response.setHeader('Cache-Control', 'max-age=86400');
    await serveFile(response, store.storeDir, 'context.json', ['.json']);
    return;
  }
  if (requestPath === '/cue.png') {
    response.setHeader('Cache-Control', 'max-age=86400');
    await serveFile(response, store.storeDir, 'cue.png', ['.png']);
    return;
  }
  if (requestPath === '/fonts.json') {
    await serveFile(response, options.cuesDir, 'fonts.json', ['.json']);
    return;
  }
  if (requestPath === '/palettes.json') {
    sendJson(response, 200, {
      seeds: SEEDS.map(({ id, oklch, mood }) => ({ id, oklch, mood })),
    });
    return;
  }
  if (requestPath.startsWith('/cues/')) {
    const cueName = requestPath.slice('/cues/'.length);
    if (!cueName || cueName.includes('/')) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    // Cue images are re-requested by the design context document after this
    // process has exited (article content only enters the live DOM after
    // submit), so they must be servable from the browser's cache.
    response.setHeader('Cache-Control', 'max-age=86400');
    await serveFile(response, options.cuesDir, cueName, ['.png']);
    return;
  }
  /* Brand-asset files the agent staged from the chat interview (logos, mood
     boards, reference images), displayed by the design context document.
     Read-only, one directory, filenames only. The /assets/ prefix is taken
     by the picker's own static files, hence the distinct name. */
  if (requestPath.startsWith('/brand-assets/')) {
    const assetName = requestPath.slice('/brand-assets/'.length);
    if (!assetName || assetName.includes('/')) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    response.setHeader('Cache-Control', 'max-age=86400');
    await serveFile(response, brandAssetsDir, assetName, BRAND_ASSET_EXTENSIONS);
    return;
  }

  // Uploaded faces are read back so the specimen can render in them.
  if (requestPath.startsWith('/fonts/')) {
    const fontName = requestPath.slice('/fonts/'.length);
    if (!fontName || fontName.includes('/')) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    await serveFile(response, fontsDir, fontName, [...FONT_EXTENSIONS]);
    return;
  }

  const assetPath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  await serveFile(response, pickerDir, assetPath);
}

/* An unfinished run outranks a finished one: the draft is where the visitor
   actually is, the submission is where they last were. --fresh declines both. */
async function resolvePrior() {
  if (options.fresh) return { prior: null, priorSource: null };
  const draft = await readDraft();
  if (draft) return { prior: draft, priorSource: 'draft' };
  const answers = await readAnswers();
  if (answers) return { prior: answers, priorSource: 'submitted' };
  return { prior: null, priorSource: null };
}

/* The document renders the chosen cue long after this process is gone, and a
   later reopen has no generation workspace to reach into, so the one picked
   hero joins the store. A seed or custom palette names no cue: nothing to copy. */
async function copyChosenCue(answers) {
  const slug = typeof answers['palette-source'] === 'string' ? answers['palette-source'] : '';
  if (!slug || slug !== path.basename(slug)) return;
  try {
    await mkdir(path.dirname(store.cuePng), { recursive: true });
    await copyFile(path.join(options.cuesDir, `${slug}.png`), store.cuePng);
  } catch {
    /* Not a cue palette, or the workspace is gone. */
  }
}

async function spawnDocSession() {
  try {
    const docPort = await findOpenPort(port + 1);
    const docToken = randomUUID();
    const child = spawn(process.execPath, [
      path.join(scriptDir, 'picker-doc-session.mjs'),
      '--port', String(docPort),
      '--timeout', String(options.timeoutMinutes),
    ], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, IMPECCABLE_DOC_TOKEN: docToken },
    });
    child.unref();
    return { base: `http://127.0.0.1:${docPort}`, token: docToken, port: docPort };
  } catch {
    /* The document still renders read-only; only the edit loop is lost. */
    return null;
  }
}

/* ============================================================
   Document mode: serving the design context document on its own.
   ============================================================ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Does the recorded session answer for itself? Also marks it adopted. */
async function probeSession(record) {
  if (!record?.port || !record?.token) return false;
  try {
    const response = await fetch(
      `http://127.0.0.1:${record.port}/doc/state?token=${encodeURIComponent(record.token)}`,
      { signal: AbortSignal.timeout(2000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForSessionRecord(deadlineMs, expectPort = 0) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    const record = await readJsonSoft(store.sessionJson);
    if (record?.port && (!expectPort || record.port === expectPort)) return record;
    if (Date.now() > until) return null;
    await sleep(150);
  }
}

/**
 * One live session per project.
 *
 * A session that answers is rejoined, so reopening a tab closed a minute ago
 * lands back in the session the agent is already polling, and the probe itself
 * is what keeps it from being reaped. A dead record is cleared, and a recorded
 * process that will not answer is stopped and waited out before a replacement
 * is forked: two sessions would write one discovery file, and the loser's
 * shutdown would carry off the winner's record.
 */
async function adoptDocSession() {
  const recorded = await readJsonSoft(store.sessionJson);
  if (recorded && pidAlive(recorded.pid)) {
    if (await probeSession(recorded)) return recorded;
    try { process.kill(recorded.pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let waited = 0; waited < 5000 && pidAlive(recorded.pid); waited += 200) await sleep(200);
  }
  await rm(store.sessionJson, { force: true }).catch(() => {});

  if (!await spawnDocSession()) return null;
  /* A session forked before any tab exists has a short window to be adopted or
     it dies young, and in document mode the tab arrives only once a person
     opens the URL. This probe is the adoption. */
  const record = await waitForSessionRecord(5000);
  if (!record) return null;
  await probeSession(record);
  return record;
}

/* The session ending is this process's completion signal in document mode.
   Liveness is the recorded process plus an answer from it, never the presence
   of the discovery file on its own: a session that crashes leaves the file
   behind, and a sibling shutting down can carry the file off while the real
   session is still serving. */
function watchDocSession(record) {
  let misses = 0;
  const tick = async () => {
    if (completed) return;
    if (!pidAlive(record.pid)) return finishDocMode();
    misses = (await probeSession(record)) ? 0 : misses + 1;
    if (misses >= 2) return finishDocMode();
    docWatch = setTimeout(tick, 5000);
  };
  docWatch = setTimeout(tick, 5000);
}

function finishDocMode() {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);
  clearTimeout(docWatch);
  console.log('DOC_SESSION_ENDED');
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
}

function stopWithoutSubmission(message) {
  if (completed) return;
  clearTimeout(timeout);
  console.error(message);
  server.close(() => process.exit(2));
  server.closeAllConnections?.();
}

/* Document mode needs a run to show and a session to keep it editable, both
   settled before the URL is printed: an agent that reads PICKER_URL is told
   the document is ready. */
if (options.doc) {
  if (!await readAnswers()) {
    console.error('No design interview found. Run /impeccable document to create one.');
    process.exit(1);
  }
  docSession = await adoptDocSession();
} else if (!await stat(path.join(options.cuesDir, 'cues.json')).catch(() => null)) {
  /* The palette screen loads the dealt cues and the built-in seeds together,
     and neither arrives without this file: refuse rather than serve a broken
     run. */
  console.error('No visual cues found. Run /impeccable document --seed to generate them first.');
  process.exit(1);
}

server.listen(port, '127.0.0.1', () => {
  console.log(`PICKER_URL http://127.0.0.1:${port}`);
  timeout = setTimeout(
    () => stopWithoutSubmission(options.doc
      ? 'Design context document closed without an edit session.'
      : 'Picker timed out without a submission.'),
    options.timeoutMinutes * 60_000,
  );
  /* With no session there is nothing to outlive, so the ceiling is the only
     limit and the document stays up read-only until it runs out. */
  if (options.doc && docSession) watchDocSession(docSession);
});

server.on('error', (error) => {
  console.error(`Picker server error: ${error.message}`);
  process.exit(1);
});
process.once('SIGINT', () => stopWithoutSubmission('Picker closed without a submission.'));
process.once('SIGTERM', () => stopWithoutSubmission('Picker closed without a submission.'));
