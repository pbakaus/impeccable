#!/usr/bin/env node
/** Design-document edit session (self-contained, zero dependencies).
 *
 * The picker server forks this detached sibling the moment the questionnaire
 * submits, so the review tab's design context document stays connected after
 * the picker itself exits 0 (the agent's completion signal). It runs on its
 * own pre-scanned port with CORS open to the picker origin, and it mediates
 * three parties the way the live server does, scaled down to polling:
 *
 *   browser  --POST /doc/edit-----------> applied here (simple edits)
 *   browser  --POST /doc/request-------> queue --GET /doc/poll--> agent
 *   agent    --POST /doc/reply---------> queue status + version bump
 *   browser  --GET  /doc/state (poll)--> { version, requests } -> re-render
 *
 * Simple edits (a palette color) are deterministic: this process rewrites
 * answers.json and swaps the value in DESIGN.md itself, no model involved.
 * Anything needing judgment queues for the agent, which long-polls through
 * picker-doc-poll.mjs exactly like live mode's live-poll.mjs.
 *
 * Session discovery for the agent CLI: .impeccable/design-interview/
 * doc-session.json { pid, port, token }. Removed on exit. Every applied
 * simple edit is journaled to doc-edits.jsonl in the same directory so the
 * agent can reconcile prose (a renamed color's description) at session end.
 *
 * Usage (spawned by picker-server.mjs, not by hand):
 *   node picker-doc-session.mjs --port 8501 --timeout 60
 *   with IMPECCABLE_DOC_TOKEN in the environment.
 */

import http from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const interviewDir = path.resolve(process.cwd(), '.impeccable/design-interview');
const answersPath = path.join(interviewDir, 'answers.json');
const sessionPath = path.join(interviewDir, 'doc-session.json');
const ledgerPath = path.join(interviewDir, 'doc-edits.jsonl');
const fontsDir = path.join(interviewDir, 'fonts');
const brandAssetsDir = path.join(interviewDir, 'assets');
const designPath = path.resolve(process.cwd(), 'DESIGN.md');

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
const ROLES = new Set(['primary', 'secondary', 'tertiary', 'neutral']);
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

async function appendLedger(entry) {
  await mkdir(interviewDir, { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { flag: 'a' });
}

/* ============================================================
   Simple edits — deterministic, applied here.
   ============================================================ */

async function applyColorEdit({ role, value }) {
  if (!ROLES.has(role)) throw httpError(400, 'Unknown palette role');
  if (!/^#[0-9a-fA-F]{6}$/.test(value || '')) throw httpError(400, 'Value must be a #rrggbb hex color');
  const hex = value.toUpperCase();

  const answers = JSON.parse(await readFile(answersPath, 'utf8'));
  const previous = String(answers[`palette-${role}`] || '').toUpperCase();
  answers[`palette-${role}`] = hex;
  await writeFile(answersPath, `${JSON.stringify(answers, null, 2)}\n`);

  /* DESIGN.md may not exist yet (the agent writes the seed while the user
     reads the document); the answers file is the source it will seed from,
     so an early edit is already carried. */
  let designTouched = false;
  if (previous && previous !== hex) {
    try {
      const source = await readFile(designPath, 'utf8');
      /* A hex value is regex-safe: a literal # and hex digits. */
      const swapped = source.replace(new RegExp(previous, 'gi'), hex);
      if (swapped !== source) {
        await writeFile(designPath, swapped);
        designTouched = true;
      }
    } catch {
      /* No DESIGN.md yet. */
    }
  }

  await appendLedger({ type: 'color', role, from: previous, to: hex, designTouched });
  return { role, from: previous, to: hex, designTouched };
}

const SIMPLE_EDITS = { color: applyColorEdit };

/* ============================================================
   Complex edits — queued for the agent.
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
    sendJson(response, 200, { ok: true, path: path.join('.impeccable/design-interview/fonts', name) });
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

  if (request.method === 'GET' && requestPath === '/doc/state') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    lastBrowserSeen = Date.now();
    adopted = true;
    sendJson(response, 200, {
      ok: true,
      version,
      requests: requests.map(summarize),
      agentWaiting: parkedPolls.length > 0,
    });
    return;
  }

  if (request.method === 'GET' && requestPath === '/doc/answers') {
    if (url.searchParams.get('token') !== token) throw httpError(403, 'Bad token');
    const answers = JSON.parse(await readFile(answersPath, 'utf8'));
    sendJson(response, 200, { ok: true, version, answers });
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

  if (requestPath === '/doc/edit') {
    const apply = SIMPLE_EDITS[body.kind];
    if (!apply) throw httpError(400, `No simple edit named ${String(body.kind)}; complex changes go through /doc/request`);
    const applied = await apply(body);
    bumpVersion();
    sendJson(response, 200, { ok: true, version, applied });
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
    const entry = requests.find((item) => item.id === body.id);
    if (!entry) throw httpError(404, 'Unknown request id');
    if (!['done', 'error', 'retry'].includes(body.status)) throw httpError(400, 'status must be done, error, or retry');
    entry.status = body.status === 'retry' ? 'pending' : body.status;
    entry.message = String(body.message || '');
    bumpVersion();
    if (entry.status === 'pending') wakeParkedPolls();
    sendJson(response, 200, { ok: true, version });
    return;
  }

  throw httpError(404, 'Not found');
}

server.listen(port, '127.0.0.1', async () => {
  await mkdir(interviewDir, { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify({ pid: process.pid, port, token }, null, 2)}\n`);
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
  await rm(sessionPath, { force: true }).catch(() => {});
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
