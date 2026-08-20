#!/usr/bin/env node
/** Browser questionnaire server (self-contained, zero dependencies).
 * Serves picker files and cues, writes one JSON submission, then exits.
 * Usage: node <scripts_path>/picker-server.mjs [--port 8500]
 *   [--cues-dir .impeccable/visual-cues] [--timeout 60]
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './palette.mjs';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pickerDir = path.join(scriptDir, 'picker');
const answersPath = path.resolve(process.cwd(), '.impeccable/design-interview/answers.json');
const fontsDir = path.resolve(process.cwd(), '.impeccable/design-interview/fonts');
const brandAssetsDir = path.resolve(process.cwd(), '.impeccable/design-interview/assets');
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
  --help            Show this help

Output:
  PICKER_URL URL    Printed when the server is ready
  ANSWERS PATH      Printed after answers.json is written

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
  const options = { port: 8500, cuesDir: path.resolve(process.cwd(), '.impeccable/visual-cues'), timeoutMinutes: 60 };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
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

const port = await findOpenPort(options.port);
let completed = false;
let timeout;

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
    if (completed) {
      sendJson(response, 409, { error: 'Submission already received' });
      return;
    }
    const answers = await readJsonBody(request);
    await mkdir(path.dirname(answersPath), { recursive: true });
    await writeFile(answersPath, `${JSON.stringify(answers, null, 2)}\n`);
    completed = true;
    clearTimeout(timeout);

    /* The document the review tab is about to reveal stays editable through a
       detached sibling: it owns the edit endpoints on its own port, so this
       process can still exit as the agent's completion signal. The tab learns
       where to reach it from this response; the agent learns from
       doc-session.json, which the sibling writes at boot. */
    const doc = await spawnDocSession();
    response.once('finish', () => {
      console.log(`ANSWERS ${answersPath}`);
      server.close(() => process.exit(0));
      server.closeAllConnections?.();
    });
    sendJson(response, 200, { ok: true, doc });
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
    sendJson(response, 200, { path: path.join('.impeccable/design-interview/fonts', name) });
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }
  if (requestPath === '/cues.json') {
    await serveFile(response, options.cuesDir, 'cues.json', ['.json']);
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
    return { base: `http://127.0.0.1:${docPort}`, token: docToken };
  } catch {
    /* The document still renders read-only; only the edit loop is lost. */
    return null;
  }
}

function stopWithoutSubmission(message) {
  if (completed) return;
  clearTimeout(timeout);
  console.error(message);
  server.close(() => process.exit(2));
  server.closeAllConnections?.();
}

server.listen(port, '127.0.0.1', () => {
  console.log(`PICKER_URL http://127.0.0.1:${port}`);
  timeout = setTimeout(
    () => stopWithoutSubmission('Picker timed out without a submission.'),
    options.timeoutMinutes * 60_000,
  );
});

server.on('error', (error) => {
  console.error(`Picker server error: ${error.message}`);
  process.exit(1);
});
process.once('SIGINT', () => stopWithoutSubmission('Picker closed without a submission.'));
process.once('SIGTERM', () => stopWithoutSubmission('Picker closed without a submission.'));
