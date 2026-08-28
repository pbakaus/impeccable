#!/usr/bin/env node
/** Design-document edit session (self-contained, zero dependencies).
 *
 * The picker server forks this detached sibling the moment the questionnaire
 * submits, so the review tab's design context document stays connected after
 * the picker itself exits 0 (the agent's completion signal). It runs on its
 * own pre-scanned port with CORS open to the picker origin, and it mediates
 * three parties the way the live server does, scaled down to polling:
 *
 *   browser  --POST /doc/save----------> applied to the store, batch queued
 *   browser  --POST /doc/request-------> queue --GET /doc/poll--> agent
 *   agent    --POST /doc/reply---------> queue status + version bump
 *   browser  --GET  /doc/state (poll)--> { version, requests, batch } -> re-read
 *
 * It also serves the document's own images: GET /brand-assets/* for what the
 * user supplied, GET /assets/* for the ones the picker ships. Both are
 * token-gated and read-only. They are here rather than on the picker server
 * because article images load when a view opens, which is always after the
 * picker has exited.
 *
 * Edits made in the document stage in the browser and arrive here as one batch.
 * Applying them is deterministic and belongs to this process: each change names
 * a field, the field names a place in the store, and the value is written
 * there. What reaches the agent afterwards is the reconciliation the store
 * cannot do for itself, the prose in DESIGN.md and PRODUCT.md that describes
 * those values. Anything needing judgment up front, a font change or a freeform
 * ask, queues for the agent the same way, and it long-polls through
 * picker-doc-poll.mjs exactly like live mode's live-poll.mjs.
 *
 * This process is the only writer of the store while it runs; the agent's own
 * follow-on values ride in on its reply. That is what keeps a save and an
 * agent working at the same time from overwriting each other.
 *
 * Session discovery for the agent CLI: .impeccable/design-context/runtime/
 * session.json { pid, port, token }. Removed on exit. Every applied change is
 * journaled to runtime/journal.jsonl beside it, so a session that dies with a
 * batch outstanding re-offers it and the agent can reconcile prose at the end.
 *
 * Usage (spawned by picker-server.mjs, not by hand):
 *   node picker-doc-session.mjs --port 8501 --timeout 60
 *   with IMPECCABLE_DOC_TOKEN in the environment.
 */

import http from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontRelativePath, migrate, paths, readJsonSoft, writeJsonAtomic } from './design-context/store.mjs';
import { createSaveRoutes } from './design-context/session-routes.mjs';

const store = paths(process.cwd());
const answersPath = store.answersJson;
const contextPath = store.contextJson;
const sessionPath = store.sessionJson;
const fontsDir = store.fontsDir;
const brandAssetsDir = store.assetsDir;
/* The built picker beside this script: the document's own images (section
   foils, rail textures, placeholder brand assets) are served from here after
   the submit-flow picker server has exited. Read-only, image types only. */
const pickerAssetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'picker', 'assets');

const MAX_BODY_BYTES = 1024 * 1024;
const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const BRAND_ASSET_MIME = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);
const PICKER_ASSET_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);
const REQUEST_KINDS = new Set(['font', 'freeform']);
/* Long polls are sliced under common proxy/undici header timeouts, the same
   270s ceiling live-poll uses. */
const MAX_POLL_MS = 270_000;
/* The tab polls /doc/state every couple of seconds while open; when it has
   been quiet this long the session is over and the agent's poll gets exit. */
const BROWSER_GONE_MS = 10 * 60_000;
/* A tab adopts the session within seconds of the submit that forked it. If
   no poll ever arrives (a test harness, a closed tab), die young instead of
   holding a port for the full ceiling. */
const ADOPT_GRACE_MS = 90_000;

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const at = args.indexOf(name);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};
const port = Number(readArg('--port', '0'));
const timeoutMinutes = Number(readArg('--timeout', '60'));
const token = process.env.IMPECCABLE_DOC_TOKEN || '';
if (!port || !token) {
  console.error('picker-doc-session is spawned by picker-server.mjs and needs --port plus IMPECCABLE_DOC_TOKEN.');
  process.exit(1);
}

let version = 1;
let requestSeq = 0;
const requests = [];
/* The save flow lives in its own module; this shell keeps the server, the
   timers, and the token. Every applied save bumps the same version the tab
   polls, so the document re-reads itself without a second signal. */
const saves = createSaveRoutes({ onChange: () => { bumpVersion(); wakeParkedPolls(); } });
let lastBrowserSeen = Date.now();
let adopted = false;
const parkedPolls = [];

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(JSON.stringify(body));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

const summarize = (entry) => ({
  id: entry.id,
  kind: entry.kind,
  prompt: entry.prompt,
  category: entry.category,
  status: entry.status,
  message: entry.message || '',
});

/* ============================================================
   Requests that need judgment, queued for the agent.
   ============================================================ */

function wakeParkedPolls() {
  while (parkedPolls.length) {
    const parked = parkedPolls.shift();
    clearTimeout(parked.timer);
    parked.resolve();
  }
}

function nextPending() {
  return requests.find((entry) => entry.status === 'pending');
}

async function handleDocPoll(response, query) {
  const budget = Math.min(Number(query.get('timeout')) || MAX_POLL_MS, MAX_POLL_MS);
  const deadline = Date.now() + budget;

  for (;;) {
    if (Date.now() - lastBrowserSeen > BROWSER_GONE_MS) {
      sendJson(response, 200, { type: 'exit', reason: 'browser-gone' });
      return;
    }
    const entry = nextPending();
    if (entry) {
      entry.status = 'working';
      bumpVersion();
      sendJson(response, 200, { type: 'edit_request', ...summarize(entry), payload: entry.payload });
      return;
    }
    /* The values are already in the store; what is handed over is the prose
       still owed to DESIGN.md and PRODUCT.md. The reply command travels with
       the event so the instruction cannot drift from the contract. */
    const batch = saves.takeBatchEvent((id) => `node picker-doc-poll.mjs --reply ${id} done "One line the user sees in the tab"`);
    if (batch) {
      sendJson(response, 200, batch);
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      sendJson(response, 200, { type: 'timeout' });
      return;
    }
    await new Promise((resolve) => {
      const parked = { resolve, timer: setTimeout(resolve, Math.min(remaining, 5_000)) };
      parkedPolls.push(parked);
    });
  }
}

function bumpVersion() {
  version += 1;
}

/* ============================================================
   Server
   ============================================================ */

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.message });
    else response.destroy();
  });
});

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const requestPath = url.pathname;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Font-Filename',
      'Access-Control-Max-Age': '600',
    });
    response.end();
    return;
  }

  /* Font uploads carry bytes, not JSON; token rides the query string. */
  if (request.method === 'POST' && requestPath === '/font-upload') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    const name = path.basename(request.headers['x-font-filename'] || '');
    if (!name || !FONT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      throw httpError(400, 'Expected a .woff2, .woff, .ttf, or .otf filename');
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
    sendJson(response, 200, { ok: true, path: fontRelativePath(name) });
    return;
  }

  /* Brand-asset images for the document's Brand article. The picker server
     serves the same directory while it lives; it exits on submit, and the
     article's images load after that, so the tab fetches them from here
     with the session token on the query string, the same rule as the
     sibling GET routes. Filenames only, extension-gated, one directory. */
  if (request.method === 'GET' && requestPath.startsWith('/brand-assets/')) {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    let assetName;
    try {
      assetName = decodeURIComponent(requestPath.slice('/brand-assets/'.length));
    } catch {
      throw httpError(400, 'Invalid path');
    }
    const extension = path.extname(assetName).toLowerCase();
    const filePath = path.resolve(brandAssetsDir, assetName);
    if (!assetName || assetName !== path.basename(assetName)
      || !BRAND_ASSET_MIME.has(extension)
      || path.relative(brandAssetsDir, filePath).startsWith('..')) {
      throw httpError(404, 'Not found');
    }
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      throw httpError(404, 'Not found');
    }
    response.writeHead(200, {
      'Content-Type': BRAND_ASSET_MIME.get(extension),
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=86400',
    });
    response.end(body);
    return;
  }

  /* The document's own static images, for the tab that outlives the picker
     server: the submit flow exits on /submit, and article images only load when
     a view opens, which is always after that. Same trust model as the route
     above, token-gated and read-only, but contained rather than flat, because
     the vendored files sit in per-category subdirectories. */
  if (request.method === 'GET' && requestPath.startsWith('/assets/')) {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    let assetPath;
    try {
      assetPath = decodeURIComponent(requestPath.slice('/assets/'.length));
    } catch {
      throw httpError(400, 'Invalid path');
    }
    const extension = path.extname(assetPath).toLowerCase();
    const filePath = path.resolve(pickerAssetsDir, assetPath);
    const contained = path.relative(pickerAssetsDir, filePath);
    if (!assetPath
      || assetPath.includes('\0')
      || !PICKER_ASSET_MIME.has(extension)
      || contained.startsWith('..')
      || path.isAbsolute(contained)) {
      throw httpError(404, 'Not found');
    }
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      throw httpError(404, 'Not found');
    }
    response.writeHead(200, {
      'Content-Type': PICKER_ASSET_MIME.get(extension),
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=86400',
    });
    response.end(body);
    return;
  }

  if (request.method === 'GET' && requestPath === '/doc/state') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    lastBrowserSeen = Date.now();
    adopted = true;
    sendJson(response, 200, {
      ok: true,
      version,
      requests: requests.map(summarize),
      agentWaiting: parkedPolls.length > 0,
      batch: saves.summary(),
    });
    return;
  }

  if (request.method === 'GET' && requestPath === '/doc/answers') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    const answers = JSON.parse(await readFile(answersPath, 'utf8'));
    sendJson(response, 200, { ok: true, version, answers });
    return;
  }

  /* The chat half of the run, read fresh so an agent's rewrite reaches the tab. */
  if (request.method === 'GET' && requestPath === '/doc/context') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    let stored = null;
    try {
      stored = JSON.parse(await readFile(contextPath, 'utf8'));
    } catch {
      /* A run whose chat half was never recorded still has a document. */
    }
    sendJson(response, 200, {
      ok: true,
      version,
      modes: stored?.modes ?? null,
      context: stored?.context ?? null,
    });
    return;
  }

  if (request.method === 'GET' && requestPath === '/doc/poll') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    await handleDocPoll(response, url.searchParams);
    return;
  }

  if (request.method !== 'POST') throw httpError(404, 'Not found');
  const body = await readJsonBody(request);
  if (body.token !== token) throw httpError(403, 'Bad token');

  /* Everything staged in the document arrives at once. Applying is this
     process's job; reconciling the prose around it is the agent's. */
  if (requestPath === '/doc/save') {
    const applied = await saves.save(body);
    sendJson(response, 200, { ok: true, version, ...applied });
    return;
  }

  if (requestPath === '/doc/request') {
    if (!REQUEST_KINDS.has(body.kind)) throw httpError(400, 'kind must be font or freeform');
    const prompt = String(body.prompt || '').trim();
    if (!prompt || prompt.length > 4000) throw httpError(400, 'prompt is required, 4000 characters max');
    requestSeq += 1;
    const entry = {
      id: `req-${String(requestSeq).padStart(3, '0')}`,
      kind: body.kind,
      prompt,
      category: String(body.category || ''),
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      status: 'pending',
      message: '',
    };
    requests.push(entry);
    bumpVersion();
    wakeParkedPolls();
    sendJson(response, 200, { ok: true, id: entry.id, version });
    return;
  }

  if (requestPath === '/doc/reply') {
    // A save and a request are both replied to here, told apart by the id.
    if (saves.hasPending() && String(body.id || '').startsWith('batch-')) {
      const result = await saves.reply(body);
      sendJson(response, 200, { ok: true, version, ...result });
      return;
    }
    const entry = requests.find((item) => item.id === body.id);
    if (!entry) throw httpError(404, 'Unknown request id');
    if (!['done', 'error', 'retry'].includes(body.status)) throw httpError(400, 'status must be done, error, or retry');
    entry.status = body.status === 'retry' ? 'pending' : body.status;
    entry.message = String(body.message || '');
    /* Values attached to the reply land in the store here, same as a batch
       reply: the session stays the only writer while it runs. */
    const applied = entry.status === 'pending' ? null : await saves.applyAgentUpdates(body);
    saves.noteRequest(entry.id, entry.status);
    bumpVersion();
    if (entry.status === 'pending') wakeParkedPolls();
    sendJson(response, 200, { ok: true, version, applied });
    return;
  }

  throw httpError(404, 'Not found');
}

server.listen(port, '127.0.0.1', async () => {
  await migrate(process.cwd());
  await writeJsonAtomic(sessionPath, { pid: process.pid, port, token });
});

server.on('error', () => process.exit(1));

/* The session dies with its audience: no browser poll for BROWSER_GONE_MS,
   or the hard ceiling, whichever lands first. */
const reaper = setInterval(() => {
  const quiet = Date.now() - lastBrowserSeen;
  if (quiet > BROWSER_GONE_MS || (!adopted && quiet > ADOPT_GRACE_MS)) shutdown();
}, 15_000);
const ceiling = setTimeout(shutdown, timeoutMinutes * 60_000);

async function shutdown() {
  clearInterval(reaper);
  clearTimeout(ceiling);
  wakeParkedPolls();
  /* Only if it is still ours. A session that outlived its tab can be shutting
     down at the moment a newer one writes the same path, and taking the file
     with it would leave the live session undiscoverable. */
  const recorded = await readJsonSoft(sessionPath);
  if (!recorded || recorded.pid === process.pid) {
    await rm(sessionPath, { force: true }).catch(() => {});
  }
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
