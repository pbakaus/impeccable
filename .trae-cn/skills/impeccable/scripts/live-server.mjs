#!/usr/bin/env node
/**
 * Live variant mode server (self-contained, zero dependencies).
 *
 * Serves the browser script (/live.js), the detection overlay (/detect.js),
 * uses Server-Sent Events (SSE) for server→browser push, and HTTP POST for
 * browser→server events. Agent communicates via HTTP long-poll (/poll).
 *
 * Usage:
 *   node <scripts_path>/live-server.mjs              # start
 *   node <scripts_path>/live-server.mjs stop         # stop + remove injected live.js tag
 *   node <scripts_path>/live-server.mjs stop --keep-inject   # stop only
 *   node <scripts_path>/live-server.mjs --help
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseDesignMd } from './design-parser.mjs';
import { resolveContextDir } from './load-context.mjs';
import { createLiveSessionStore } from './live-session-store.mjs';
import {
  getDesignSidecarPath,
  getLiveAnnotationsDir,
  getLiveDir,
  readLiveServerInfo,
  removeLiveServerInfo,
  resolveDesignSidecarPath,
  writeLiveServerInfo,
} from './impeccable-paths.mjs';
import {
  countByPage as countPendingByPage,
  readBuffer as readManualEditsBuffer,
  removeEntries as removeManualEditEntries,
  stageEntry as stageManualEditEntry,
  truncateBuffer as truncateManualEditsBuffer,
} from './live-manual-edits-buffer.mjs';
import { validateNewTextChars } from './live-edit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PRODUCT.md / DESIGN.md live wherever load-context.mjs resolves. The generated
// DESIGN sidecar is project-local at .impeccable/design.json, with legacy
// DESIGN.json fallback for existing projects.
const CONTEXT_DIR = resolveContextDir(process.cwd());
const DEFAULT_POLL_TIMEOUT = 600_000;   // 10 min — agent re-polls on timeout anyway
const SSE_HEARTBEAT_INTERVAL = 30_000;  // keepalive ping every 30s

// ---------------------------------------------------------------------------
// Port detection
// ---------------------------------------------------------------------------

async function findOpenPort(start = 8400) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => resolve(findOpenPort(start + 1)));
  });
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const state = {
  token: null,
  port: null,
  sseClients: new Set(),   // SSE response objects (server→browser push)
  pendingEvents: [],        // browser events waiting for agent ack ({ event, leaseUntil })
  pendingPolls: [],         // agent poll callbacks waiting for browser events
  nextEventSeq: 1,
  exitTimer: null,
  sessionDir: null,         // per-session tmp dir for annotation screenshots
  sessionStore: null,
  leaseTimer: null,
  manualEditAgents: new Map(),
};

// Cap per-annotation upload size. A full 1920×1080 PNG is typically <1 MB;
// cap at 10 MB to guard against runaway writes from a misbehaving client.
const MAX_ANNOTATION_BYTES = 10 * 1024 * 1024;
const MANUAL_POLL_TEXT_LIMIT = 1200;
const MANUAL_POLL_HTML_LIMIT = 2400;
const MANUAL_POLL_NEARBY_LIMIT = 8;

function enqueueEvent(event) {
  if (!event || (event.id && state.pendingEvents.some((entry) => entry.event?.id === event.id && entry.event?.type === event.type))) return;
  if (event.type === 'manual_edit_apply') removeSupersededManualEditEvents(event);
  state.pendingEvents.push({ event, leaseUntil: 0, seq: state.nextEventSeq++ });
  flushPendingPolls();
}

function restorePendingEventsFromStore() {
  if (!state.sessionStore) return;
  for (const snapshot of state.sessionStore.listActiveSessions()) {
    if (snapshot.pendingEvent) enqueueEvent(snapshot.pendingEvent);
  }
}

function pendingEventPriority(event) {
  return event?.type === 'manual_edit_apply' ? 0 : 1;
}

function findAvailablePendingEvent(now = Date.now()) {
  let best = null;
  for (const entry of state.pendingEvents) {
    if (entry.leaseUntil && entry.leaseUntil > now) continue;
    if (!best) {
      best = entry;
      continue;
    }
    const priority = pendingEventPriority(entry.event);
    const bestPriority = pendingEventPriority(best.event);
    if (priority < bestPriority || (priority === bestPriority && (entry.seq || 0) < (best.seq || 0))) {
      best = entry;
    }
  }
  return best;
}

function leaseEvent(entry, leaseMs) {
  if (!entry.event?.id) {
    const idx = state.pendingEvents.indexOf(entry);
    if (idx !== -1) state.pendingEvents.splice(idx, 1);
    return prepareEventForPoll(entry.event);
  }
  entry.leaseUntil = Date.now() + leaseMs;
  return prepareEventForPoll(entry.event);
}

function acknowledgePendingEvent(id) {
  if (!id) return false;
  const idx = state.pendingEvents.findIndex((entry) => entry.event?.id === id);
  if (idx === -1) return false;
  const acknowledged = state.pendingEvents[idx].event;
  state.pendingEvents.splice(idx, 1);
  scheduleLeaseFlush();
  return acknowledged;
}

function scheduleLeaseFlush() {
  if (state.leaseTimer) {
    clearTimeout(state.leaseTimer);
    state.leaseTimer = null;
  }
  if (state.pendingPolls.length === 0) return;
  const now = Date.now();
  const nextLeaseUntil = state.pendingEvents
    .map((entry) => entry.leaseUntil || 0)
    .filter((leaseUntil) => leaseUntil > now)
    .sort((a, b) => a - b)[0];
  if (!nextLeaseUntil) return;
  state.leaseTimer = setTimeout(() => {
    state.leaseTimer = null;
    flushPendingPolls();
  }, Math.max(0, nextLeaseUntil - now));
}

function flushPendingPolls() {
  while (state.pendingPolls.length > 0) {
    const entry = findAvailablePendingEvent();
    if (!entry) {
      scheduleLeaseFlush();
      return;
    }
    const poll = state.pendingPolls.shift();
    poll.resolve(leaseEvent(entry, poll.leaseMs));
  }
  scheduleLeaseFlush();
}

function classSignature(classes) {
  return Array.isArray(classes) ? classes.filter(Boolean).sort().join('.') : '';
}

function manualEditTargetKeys(event) {
  const keys = new Set();
  const pageUrl = event?.pageUrl || '';
  for (const op of event?.ops || []) {
    if (!op || typeof op !== 'object') continue;
    if (op.ref) keys.add(pageUrl + '\0ref\0' + op.ref);
    if (op.contextRef) keys.add(pageUrl + '\0context\0' + op.contextRef + '\0' + (op.tag || '') + '\0' + classSignature(op.classes));
    if (op.sourceHint?.file && op.sourceHint?.line) {
      keys.add(pageUrl + '\0source\0' + op.sourceHint.file + ':' + op.sourceHint.line + ':' + (op.sourceHint.column || ''));
    }
  }
  return keys;
}

function shouldSupersedeManualEdit(existingEvent, nextEvent) {
  if (existingEvent?.type !== 'manual_edit_apply' || nextEvent?.type !== 'manual_edit_apply') return false;
  const existingKeys = manualEditTargetKeys(existingEvent);
  if (existingKeys.size === 0) return false;
  for (const key of manualEditTargetKeys(nextEvent)) {
    if (existingKeys.has(key)) return true;
  }
  return false;
}

function markManualEditSuperseded(event, supersededBy) {
  if (!state.sessionStore || !event?.id) return;
  try {
    state.sessionStore.appendEvent({
      type: 'manual_edit_superseded',
      id: event.id,
      supersededBy: supersededBy?.id,
      message: 'Superseded by a newer copy edit before delivery to the agent.',
    });
  } catch { /* session recovery is best-effort; queue priority should still hold */ }
}

function removeSupersededManualEditEvents(nextEvent) {
  for (let i = state.pendingEvents.length - 1; i >= 0; i--) {
    const entry = state.pendingEvents[i];
    if (!shouldSupersedeManualEdit(entry.event, nextEvent)) continue;
    const [removed] = state.pendingEvents.splice(i, 1);
    stopManualEditAgent(removed.event?.id);
    markManualEditSuperseded(removed.event, nextEvent);
  }
}

function manualEditAgentMode() {
  return (process.env.IMPECCABLE_LIVE_COPY_AGENT || 'auto').trim().toLowerCase();
}

function manualEditAgentEnabled() {
  const mode = manualEditAgentMode();
  return !(mode === '0' || mode === 'false' || mode === 'off' || mode === 'none');
}

function stopManualEditAgent(id) {
  if (!id) return;
  const child = state.manualEditAgents.get(id);
  if (!child) return;
  state.manualEditAgents.delete(id);
  try { child.kill('SIGTERM'); } catch {}
}

function launchManualEditAgent(event) {
  if (!event?.id || event.type !== 'manual_edit_apply' || !manualEditAgentEnabled()) return;
  if (state.manualEditAgents.has(event.id)) return;
  const eventDir = path.join(getLiveDir(process.cwd()), 'copy-edit-events');
  fs.mkdirSync(eventDir, { recursive: true });
  const eventPath = path.join(eventDir, `${event.id}.json`);
  fs.writeFileSync(eventPath, JSON.stringify(event, null, 2));
  const scriptPath = path.join(__dirname, 'live-copy-edit-agent.mjs');
  const child = spawn(process.execPath, [
    scriptPath,
    '--event-file', eventPath,
    '--port', String(state.port),
    '--token', state.token,
    '--provider', manualEditAgentMode() === 'auto' ? 'auto' : manualEditAgentMode(),
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
  });
  state.manualEditAgents.set(event.id, child);
  child.on('exit', () => {
    if (state.manualEditAgents.get(event.id) === child) {
      state.manualEditAgents.delete(event.id);
    }
  });
  child.on('error', () => {
    if (state.manualEditAgents.get(event.id) === child) {
      state.manualEditAgents.delete(event.id);
    }
  });
  child.unref();
}

function truncateForManualPoll(value, limit) {
  if (typeof value !== 'string' || value.length <= limit) return value;
  return value.slice(0, limit) + `... [truncated ${value.length - limit} chars]`;
}

function compactContextObject(value, { includeSource = false } = {}) {
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of ['ref', 'contextRef', 'tag', 'tagName', 'id', 'elementId', 'classes', 'originalText', 'newText']) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  if (typeof value.textContent === 'string') out.textContent = truncateForManualPoll(value.textContent, MANUAL_POLL_TEXT_LIMIT);
  if (typeof value.outerHTML === 'string') out.outerHTML = truncateForManualPoll(value.outerHTML, MANUAL_POLL_HTML_LIMIT);
  if (includeSource && value.sourceHint) out.sourceHint = value.sourceHint;
  return out;
}

function compactManualEditOp(op) {
  const out = {};
  for (const key of ['ref', 'contextRef', 'tag', 'elementId', 'classes', 'originalText', 'newText', 'deleted']) {
    if (op[key] !== undefined) out[key] = op[key];
  }
  if (op.sourceHint) out.sourceHint = op.sourceHint;
  if (op.leaf) out.leaf = compactContextObject(op.leaf, { includeSource: true });
  if (op.container) out.container = compactContextObject(op.container, { includeSource: true });
  if (Array.isArray(op.nearbyEditableTexts)) {
    out.nearbyEditableTexts = op.nearbyEditableTexts
      .slice(0, MANUAL_POLL_NEARBY_LIMIT)
      .map((item) => compactContextObject(item));
  }
  return out;
}

function prepareEventForPoll(event) {
  if (event?.type !== 'manual_edit_apply') return event;
  return {
    type: event.type,
    id: event.id,
    pageUrl: event.pageUrl,
    element: compactContextObject(event.element),
    ops: (event.ops || []).map(compactManualEditOp),
    agentInstructions: 'Apply these copy edits in source using the evidence provided. Prefer sourceHint when it is valid, verify related references, validate touched files, then reply done/error.',
  };
}

/** Push a message to all connected SSE clients. */
function broadcast(msg) {
  const data = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of state.sseClients) {
    try { res.write(data); } catch { /* client gone */ }
  }
}

// ---------------------------------------------------------------------------
// Load scripts
// ---------------------------------------------------------------------------

function loadBrowserScripts() {
  // Detection script: prefer the skill-bundled detector, then fall back to
  // source/npm package locations for local development and older installs.
  // This one IS cached — detect.js rarely changes during a session.
  const detectPaths = [
    path.join(__dirname, 'detector', 'detect-antipatterns-browser.js'),
    path.join(__dirname, '..', '..', 'cli', 'engine', 'detect-antipatterns-browser.js'),
    path.join(__dirname, '..', '..', '..', '..', 'cli', 'engine', 'detect-antipatterns-browser.js'),
    path.join(process.cwd(), 'node_modules', 'impeccable', 'cli', 'engine', 'detect-antipatterns-browser.js'),
  ];
  let detectScript = '';
  for (const p of detectPaths) {
    try { detectScript = fs.readFileSync(p, 'utf-8'); break; } catch { /* try next */ }
  }

  // live-browser.js: DO NOT cache. Return the path so the /live.js handler
  // can re-read on every request. Editing the browser script during iteration
  // should land on the next tab reload, not require a server restart.
  const sessionPath = path.join(__dirname, 'live-browser-session.js');
  const textRowsPath = path.join(__dirname, 'live-text-rows.js');
  const livePath = path.join(__dirname, 'live-browser.js');
  for (const p of [sessionPath, textRowsPath, livePath]) {
    if (!fs.existsSync(p)) {
      process.stderr.write('Error: live browser script not found at ' + p + '\n');
      process.exit(1);
    }
  }

  return { detectScript, sessionPath, textRowsPath, livePath };
}

function hasProjectContext() {
  // PRODUCT.md carries brand voice / anti-references — that's what determines
  // whether variants are brand-aware. DESIGN.md (visual tokens) is a separate
  // concern, surfaced by the design panel's own empty state. Legacy
  // .impeccable.md is auto-migrated to PRODUCT.md by load-context.mjs.
  try {
    fs.accessSync(path.join(CONTEXT_DIR, 'PRODUCT.md'), fs.constants.R_OK);
    return true;
  } catch { return false; }
}

function statOrNull(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Validation (inline — no external import needed for self-contained script)
// ---------------------------------------------------------------------------

const VISUAL_ACTIONS = [
  'impeccable', 'bolder', 'quieter', 'distill', 'polish', 'typeset',
  'colorize', 'layout', 'adapt', 'animate', 'delight', 'overdrive',
];

// Browser generates ids via crypto.randomUUID().slice(0, 8) (8 hex chars)
// and variantIds via String(small integer). Restrict to those shapes so
// any value that reaches a downstream child_process or DOM selector is
// inert by construction.
const ID_PATTERN = /^[0-9a-f]{8}$/;
const VARIANT_ID_PATTERN = /^[0-9]{1,3}$/;

function isValidId(v) { return typeof v === 'string' && ID_PATTERN.test(v); }
function isValidVariantId(v) { return typeof v === 'string' && VARIANT_ID_PATTERN.test(v); }

function validateManualEditEvent(msg, label) {
  if (!isValidId(msg.id)) return label + ': missing or malformed id';
  if (!msg.pageUrl || typeof msg.pageUrl !== 'string') return label + ': missing pageUrl';
  if (!msg.element || typeof msg.element !== 'object') return label + ': missing element';
  if (!Array.isArray(msg.ops) || msg.ops.length === 0) return label + ': ops must be non-empty array';
  if (msg.ops.length > 100) return label + ': too many ops (max 100)';
  for (const op of msg.ops) {
    if (typeof op.ref !== 'string') return label + ': op.ref required';
    if (typeof op.tag !== 'string') return label + ': op.tag required';
    if (typeof op.originalText !== 'string') return label + ': op.originalText required';
    if (op.deleted !== true && typeof op.newText !== 'string') {
      return label + ': text op requires newText';
    }
    if (typeof op.newText === 'string') {
      const forbidden = validateNewTextChars(op.newText);
      if (forbidden) {
        return label + ': newText cannot contain ' + forbidden.join(' ') + ' (plain text only; ask the AI to insert markup)';
      }
    }
  }
  return null;
}

function validateEvent(msg) {
  if (!msg || typeof msg !== 'object' || !msg.type) return 'Missing or invalid message';
  switch (msg.type) {
    case 'generate':
      if (!isValidId(msg.id)) return 'generate: missing or malformed id';
      if (!msg.action || !VISUAL_ACTIONS.includes(msg.action)) return 'generate: invalid action';
      if (!Number.isInteger(msg.count) || msg.count < 1 || msg.count > 8) return 'generate: count must be 1-8';
      if (!msg.element || !msg.element.outerHTML) return 'generate: missing element context';
      // Optional annotation fields (all-or-nothing: if any present, all must be well-formed).
      if (msg.screenshotPath !== undefined && typeof msg.screenshotPath !== 'string') return 'generate: screenshotPath must be string';
      if (msg.comments !== undefined && !Array.isArray(msg.comments)) return 'generate: comments must be array';
      if (msg.strokes !== undefined && !Array.isArray(msg.strokes)) return 'generate: strokes must be array';
      return null;
    case 'accept':
      if (!isValidId(msg.id)) return 'accept: missing or malformed id';
      if (!isValidVariantId(msg.variantId)) return 'accept: missing or malformed variantId';
      if (msg.paramValues !== undefined) {
        if (typeof msg.paramValues !== 'object' || msg.paramValues === null || Array.isArray(msg.paramValues)) {
          return 'accept: paramValues must be an object';
        }
      }
      return null;
    case 'discard':
      return isValidId(msg.id) ? null : 'discard: missing or malformed id';
    case 'checkpoint':
      if (!isValidId(msg.id)) return 'checkpoint: missing or malformed id';
      if (!Number.isInteger(msg.revision) || msg.revision < 0) return 'checkpoint: revision must be a non-negative integer';
      if (msg.paramValues !== undefined && (typeof msg.paramValues !== 'object' || msg.paramValues === null || Array.isArray(msg.paramValues))) {
        return 'checkpoint: paramValues must be an object';
      }
      return null;
    case 'exit':
      return null;
    case 'prefetch':
      if (!msg.pageUrl || typeof msg.pageUrl !== 'string') return 'prefetch: missing pageUrl';
      return null;
    case 'manual_edit_apply':
      return validateManualEditEvent(msg, 'manual_edit_apply');
    case 'manual_edits':
      return validateManualEditEvent(msg, 'manual_edits');
    default:
      return 'Unknown event type: ' + msg.type;
  }
}

// ---------------------------------------------------------------------------
// HTTP request handler
// ---------------------------------------------------------------------------

function createRequestHandler({ detectScript, sessionPath, textRowsPath, livePath }) {
  return (req, res) => {
    const url = new URL(req.url, `http://localhost:${state.port}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const p = url.pathname;

    // --- Scripts ---
    if (p === '/live.js') {
      // Re-read from disk each request so edits to live-browser.js land on
      // the next tab reload. No-store headers prevent browser caching across
      // sessions — during iteration, a cached old script silently breaks
      // every subsequent session.
      let sessionScript;
      let textRowsScript;
      let liveScript;
      try {
        sessionScript = fs.readFileSync(sessionPath, 'utf-8');
        textRowsScript = fs.readFileSync(textRowsPath, 'utf-8');
        liveScript = fs.readFileSync(livePath, 'utf-8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading live browser scripts: ' + err.message);
        return;
      }
      const body =
        `window.__IMPECCABLE_TOKEN__ = '${state.token}';\n` +
        `window.__IMPECCABLE_PORT__ = ${state.port};\n` +
        sessionScript + '\n' +
        textRowsScript + '\n' +
        liveScript;
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
      });
      res.end(body);
      return;
    }
    if (p === '/detect.js' || p === '/') {
      if (!detectScript) { res.writeHead(404); res.end('Not available'); return; }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(detectScript);
      return;
    }

    // --- Vendored modern-screenshot (UMD build) ---
    // Lazy-loaded by live.js when the user clicks Go; exposes
    // window.modernScreenshot.domToBlob(...) for capture.
    if (p === '/modern-screenshot.js') {
      const vendorPath = path.join(__dirname, 'modern-screenshot.umd.js');
      try {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(fs.readFileSync(vendorPath));
      } catch {
        res.writeHead(404); res.end('Vendor script not found');
      }
      return;
    }

    // --- Annotation upload (browser → server, raw PNG body) ---
    // Client generates the eventId, POSTs the PNG, then POSTs the generate
    // event with screenshotPath already set. Keeps bytes out of the SSE/poll
    // bridge and preserves the "one shot from the user's POV" UX.
    if (p === '/annotation' && req.method === 'POST') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const eventId = url.searchParams.get('eventId');
      if (!eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid eventId' }));
        return;
      }
      if ((req.headers['content-type'] || '').toLowerCase() !== 'image/png') {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Content-Type must be image/png' }));
        return;
      }
      if (!state.sessionDir) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session dir unavailable' }));
        return;
      }
      const chunks = [];
      let total = 0;
      let aborted = false;
      req.on('data', (c) => {
        if (aborted) return;
        total += c.length;
        if (total > MAX_ANNOTATION_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        const absPath = path.join(state.sessionDir, eventId + '.png');
        try {
          fs.writeFileSync(absPath, Buffer.concat(chunks));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Write failed: ' + err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: absPath }));
      });
      req.on('error', () => {
        if (!aborted) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upload failed' }));
        }
      });
      return;
    }

    // --- Health ---
    if (p === '/status') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      const sessions = state.sessionStore ? state.sessionStore.listActiveSessions() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        port: state.port,
        connectedClients: state.sseClients.size,
        copyEditAgent: {
          mode: manualEditAgentMode(),
          running: state.manualEditAgents.size,
        },
        pendingEvents: state.pendingEvents.map((entry) => ({
          id: entry.event?.id,
          type: entry.event?.type,
          leased: !!(entry.leaseUntil && entry.leaseUntil > Date.now()),
          leaseUntil: entry.leaseUntil || null,
        })),
        activeSessions: sessions,
      }));
      return;
    }

    if (p === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok', port: state.port, mode: 'variant',
        hasProjectContext: hasProjectContext(),
        connectedClients: state.sseClients.size,
      }));
      return;
    }

    // --- Design system (unified v2 response) + raw ---
    //   /design-system.json    returns both parsed DESIGN.md and .impeccable/design.json
    //                          sidecar when present. Panel merges them:
    //                            { present, parsed, sidecar, hasMd, hasSidecar,
    //                              mdNewerThanJson, parseError?, sidecarError? }
    //                          - parsed: output of parseDesignMd (frontmatter
    //                            + six canonical sections) when DESIGN.md exists.
    //                          - sidecar: .impeccable/design.json contents when present.
    //                            Expected shape: schemaVersion 2, carrying
    //                            extensions + components + narrative.
    //   /design-system/raw     returns DESIGN.md markdown verbatim
    if (p === '/design-system.json' || p === '/design-system/raw') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }

      const mdPath = path.join(CONTEXT_DIR, 'DESIGN.md');
      const jsonPath = resolveDesignSidecarPath(process.cwd(), CONTEXT_DIR) || getDesignSidecarPath(process.cwd());
      const mdStat = statOrNull(mdPath);
      const jsonStat = statOrNull(jsonPath);

      if (p === '/design-system/raw') {
        if (!mdStat) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(fs.readFileSync(mdPath, 'utf-8'));
        return;
      }

      if (!mdStat && !jsonStat) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ present: false }));
        return;
      }

      const response = {
        present: true,
        hasMd: !!mdStat,
        hasSidecar: !!jsonStat,
        mdNewerThanJson: !!(mdStat && jsonStat && mdStat.mtimeMs > jsonStat.mtimeMs + 1000),
      };

      if (mdStat) {
        try {
          response.parsed = parseDesignMd(fs.readFileSync(mdPath, 'utf-8'));
        } catch (err) {
          response.parseError = err.message;
        }
      }

      if (jsonStat) {
        try {
          response.sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        } catch (err) {
          response.sidecarError = 'Failed to parse .impeccable/design.json: ' + err.message;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    // --- Source file (no-HMR fallback) ---
    if (p === '/source') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const filePath = url.searchParams.get('path');
      if (!filePath || filePath.includes('..')) { res.writeHead(400); res.end('Bad path'); return; }
      const absPath = path.resolve(process.cwd(), filePath);
      if (!absPath.startsWith(process.cwd())) { res.writeHead(403); res.end('Forbidden'); return; }
      let content;
      try { content = fs.readFileSync(absPath, 'utf-8'); }
      catch { res.writeHead(404); res.end('File not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    // --- SSE: server→browser push (replaces WebSocket) ---
    if (p === '/events' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: ' + JSON.stringify({
        type: 'connected',
        hasProjectContext: hasProjectContext(),
      }) + '\n\n');

      state.sseClients.add(res);
      clearTimeout(state.exitTimer);

      // Keepalive: SSE comment every 30s prevents silent connection drops.
      const heartbeat = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch { clearInterval(heartbeat); }
      }, SSE_HEARTBEAT_INTERVAL);

      req.on('close', () => {
        clearInterval(heartbeat);
        state.sseClients.delete(res);
        if (state.sseClients.size === 0) {
          clearTimeout(state.exitTimer);
          state.exitTimer = setTimeout(() => {
            if (state.sseClients.size === 0) enqueueEvent({ type: 'exit' });
          }, 8000);
        }
      });
      return;
    }

    // --- Manual copy edits: Save stages entries, Apply commits the staged
    // page batch through the local AI copy-edit runner.
    if (p === '/manual-edit-stash' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let msg;
        try { msg = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        if (msg.token !== state.token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        const error = validateEvent({ ...msg, type: 'manual_edits' });
        if (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error }));
          return;
        }
        try {
          stageManualEditEntry(process.cwd(), {
            id: msg.id,
            pageUrl: msg.pageUrl,
            element: msg.element,
            ops: msg.ops,
          });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'stash_write_failed', message: err.message }));
          return;
        }
        const { totalCount, perPage } = countPendingByPage(process.cwd());
        const pendingCount = perPage[msg.pageUrl] || 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pendingCount, totalCount, perPage }));
      });
      return;
    }

    // GET /manual-edit-stash?pageUrl=<url>  →  { count, totalCount, perPage, entries }
    if (p === '/manual-edit-stash' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const pageUrl = url.searchParams.get('pageUrl') || '';
      const { totalCount, perPage } = countPendingByPage(process.cwd());
      const buffer = readManualEditsBuffer(process.cwd());
      const entriesForPage = pageUrl ? buffer.entries.filter((e) => e.pageUrl === pageUrl) : buffer.entries;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        count: pageUrl ? (perPage[pageUrl] || 0) : totalCount,
        totalCount,
        perPage,
        entries: entriesForPage,
      }));
      return;
    }

    // POST /manual-edit-commit?pageUrl=<url>  →  ask the AI to apply the staged page batch.
    if (p === '/manual-edit-commit' && req.method === 'POST') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const pageUrl = url.searchParams.get('pageUrl');
      let result;
      try {
        const scriptPath = path.join(__dirname, 'live-commit-manual-edits.mjs');
        const args = [scriptPath];
        if (pageUrl) args.push('--page-url=' + pageUrl);
        const stdout = execFileSync(process.execPath, args, {
          cwd: process.cwd(),
          env: process.env,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 * 8,
          timeout: Number(process.env.IMPECCABLE_LIVE_COPY_AGENT_TIMEOUT_MS || 120000),
        });
        result = JSON.parse(stdout || '{}');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'manual_edit_commit_failed',
          message: err.stderr?.toString?.() || err.message,
        }));
        return;
      }
      const { totalCount, perPage } = countPendingByPage(process.cwd());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, totalCount, perPage }));
      return;
    }

    // POST /manual-edit-discard?pageUrl=<url>  →  drops entries (all if no pageUrl)
    if (p === '/manual-edit-discard' && req.method === 'POST') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const pageUrl = url.searchParams.get('pageUrl');
      let discarded;
      try {
        if (pageUrl) {
          discarded = removeManualEditEntries(process.cwd(), (entry) => entry.pageUrl === pageUrl);
        } else {
          discarded = truncateManualEditsBuffer(process.cwd());
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'discard_failed', message: err.message }));
        return;
      }
      const { totalCount, perPage } = countPendingByPage(process.cwd());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ discarded, totalCount, perPage }));
      return;
    }

    // Defense in depth: redirect any stragglers from the old /manual-edit endpoint.
    if (p === '/manual-edit' && req.method === 'POST') {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '/manual-edit is removed; use /manual-edit-stash and /manual-edit-commit for staged copy edits.' }));
      return;
    }

    // --- Browser→server events (replaces WebSocket messages) ---
    if (p === '/events' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let msg;
        try { msg = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        if (msg.token !== state.token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        // Defense in depth: manual copy edits must use the staged stash/apply
        // endpoints. The direct Save event path is disabled in the browser.
        if (msg.type === 'manual_edits') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'manual_edits must POST to /manual-edit-stash, not /events' }));
          return;
        }
        if (msg.type === 'manual_edit_apply') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'manual_edit_apply is disabled; use /manual-edit-stash then /manual-edit-commit' }));
          return;
        }
        const error = validateEvent(msg);
        if (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error }));
          return;
        }
        if (state.sessionStore && msg.id) {
          try {
            state.sessionStore.appendEvent(msg);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'session_store_append_failed', message: err.message }));
            return;
          }
        }
        if (msg.type !== 'checkpoint') {
          enqueueEvent(msg);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // --- Stop ---
    if (p === '/stop') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('stopping');
      shutdown();
      return;
    }

    // --- Agent poll ---
    if (p === '/poll' && req.method === 'GET') {
      handlePollGet(req, res, url);
      return;
    }
    if (p === '/poll' && req.method === 'POST') {
      handlePollPost(req, res);
      return;
    }

    res.writeHead(404); res.end('Not found');
  };
}

// ---------------------------------------------------------------------------
// Agent poll endpoints (unchanged from WS version)
// ---------------------------------------------------------------------------

function handlePollGet(req, res, url) {
  const token = url.searchParams.get('token');
  if (token !== state.token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  const timeout = parseInt(url.searchParams.get('timeout') || DEFAULT_POLL_TIMEOUT, 10);
  const leaseMs = parseInt(url.searchParams.get('leaseMs') || '30000', 10);
  const available = findAvailablePendingEvent();
  if (available) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(leaseEvent(available, leaseMs)));
    return;
  }
  const poll = { resolve, leaseMs };
  const timer = setTimeout(() => {
    const idx = state.pendingPolls.indexOf(poll);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'timeout' }));
  }, timeout);
  function resolve(event) {
    clearTimeout(timer);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(event));
  }
  state.pendingPolls.push(poll);
  scheduleLeaseFlush();
  req.on('close', () => {
    clearTimeout(timer);
    const idx = state.pendingPolls.indexOf(poll);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
  });
}

function handlePollPost(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let msg;
    try { msg = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    if (msg.token !== state.token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const acknowledgedEvent = acknowledgePendingEvent(msg.id);
    stopManualEditAgent(msg.id);
    let skipJournalReply = false;
    if (!acknowledgedEvent && state.sessionStore && msg.id) {
      try {
        const existing = state.sessionStore.getSnapshot(msg.id, { includeCompleted: true });
        skipJournalReply = existing?.phase === 'completed' || existing?.phase === 'discarded';
      } catch { /* fall through and record the reply normally */ }
    }
    if (state.sessionStore && msg.id && !skipJournalReply) {
      try {
        const eventType = msg.type === 'discard' || msg.type === 'discarded'
          ? 'discarded'
          : msg.type === 'complete'
            ? 'complete'
            : msg.type === 'error'
              ? 'agent_error'
              : acknowledgedEvent?.type === 'manual_edit_apply'
                ? 'manual_edit_applied'
                : 'agent_done';
        state.sessionStore.appendEvent({
          type: eventType,
          id: msg.id,
          file: msg.file,
          message: msg.message,
          sourceEventType: acknowledgedEvent?.type,
          carbonize: msg.data?.carbonize === true,
        });
      } catch { /* keep reply path best-effort; browser still needs SSE */ }
    }
    flushPendingPolls();
    // Forward the reply to the browser via SSE
    broadcast({ type: msg.type || 'done', id: msg.id, message: msg.message, file: msg.file, data: msg.data });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let httpServer = null;

function shutdown() {
  removeLiveServerInfo(process.cwd());
  if (state.leaseTimer) clearTimeout(state.leaseTimer);
  state.leaseTimer = null;
  if (state.sessionDir) {
    try { fs.rmSync(state.sessionDir, { recursive: true, force: true }); } catch {}
  }
  for (const res of state.sseClients) { try { res.end(); } catch {} }
  state.sseClients.clear();
  for (const poll of state.pendingPolls) poll.resolve({ type: 'exit' });
  state.pendingPolls.length = 0;
  for (const id of [...state.manualEditAgents.keys()]) stopManualEditAgent(id);
  if (httpServer) httpServer.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node live-server.mjs [options]

Start the live variant mode server (zero dependencies).

Commands:
  (default)     Start the server (foreground)
  stop          Stop the server and remove the injected live.js script tag
  stop --keep-inject   Stop the server only (leave the script tag in the HTML entry)

Options:
  --background  Start detached, print connection JSON to stdout, then exit
  --port=PORT   Use a specific port (default: auto-detect starting at 8400)
  --keep-inject Only with stop: skip live-inject.mjs --remove
  --help        Show this help

Endpoints:
  /live.js             Browser script (element picker + variant cycling)
  /detect.js           Detection overlay (backwards compatible)
  /modern-screenshot.js Vendored modern-screenshot UMD build (lazy-loaded by live.js)
  /annotation          POST raw image/png to stage a variant screenshot
  /events              SSE stream (server→browser) + POST (browser→server)
  /poll                Long-poll for agent CLI
  /source              Raw source file reader (no-HMR fallback)
  /status              Durable recovery status (token-protected)
  /health              Health check`);
  process.exit(0);
}

if (args.includes('stop')) {
  const keepInject = args.includes('--keep-inject');
  try {
    const { info } = readLiveServerInfo(process.cwd()) || {};
    const res = await fetch(`http://localhost:${info.port}/stop?token=${info.token}`);
    if (res.ok) console.log(`Stopped live server on port ${info.port}.`);
  } catch {
    console.log('No running live server found.');
  }
  if (!keepInject) {
    const injectPath = path.join(__dirname, 'live-inject.mjs');
    try {
      const out = execFileSync(process.execPath, [injectPath, '--remove'], {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      const line = out.trim().split('\n').filter(Boolean).pop();
      if (line) {
        try {
          const j = JSON.parse(line);
          if (j.removed === true) {
            console.log(`Removed live script tag from ${j.file}.`);
          }
        } catch {
          /* ignore non-JSON lines */
        }
      }
    } catch (err) {
      const detail = err.stderr?.toString?.().trim?.()
        || err.stdout?.toString?.().trim?.()
        || err.message
        || String(err);
      console.warn(`Note: could not remove live script tag (${detail.split('\n')[0]})`);
    }
  }
  process.exit(0);
}

// --background: spawn a detached child server, wait for it to be ready,
// print the connection JSON, then exit.  This keeps the startup command
// simple (no shell backgrounding or chained commands).
if (args.includes('--background')) {
  const childArgs = args.filter(a => a !== '--background');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  child.unref();

  // Poll for the PID file (the child writes it once the HTTP server is listening).
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const { info } = readLiveServerInfo(process.cwd()) || {};
      if (info.pid !== process.pid) {
        // Output JSON so the agent can read port + token from stdout.
        console.log(JSON.stringify(info));
        process.exit(0);
      }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  console.error('Timed out waiting for live server to start.');
  process.exit(1);
}

// Check for existing session
const existingRecord = readLiveServerInfo(process.cwd());
if (existingRecord?.info) {
  const existing = existingRecord.info;
  try {
    process.kill(existing.pid, 0);
    console.error(`Live server already running on port ${existing.port} (pid ${existing.pid}).`);
    console.error('Stop it first with: node ' + path.basename(fileURLToPath(import.meta.url)) + ' stop');
    process.exit(1);
  } catch {
    try { fs.unlinkSync(existingRecord.path); } catch {}
  }
}

state.token = randomUUID();
state.sessionStore = createLiveSessionStore({ cwd: process.cwd() });
restorePendingEventsFromStore();
const portArg = args.find(a => a.startsWith('--port='));
state.port = portArg ? parseInt(portArg.split('=')[1], 10) : await findOpenPort();
// Annotation screenshots live in the project root so the agent's Read tool
// doesn't trip a per-file permission prompt. Sessioned by token so concurrent
// projects (or quick restarts) don't collide.
const annotRoot = getLiveAnnotationsDir(process.cwd());
fs.mkdirSync(annotRoot, { recursive: true });
state.sessionDir = fs.mkdtempSync(path.join(annotRoot, 'session-'));

const { detectScript, sessionPath, textRowsPath, livePath } = loadBrowserScripts();
httpServer = http.createServer(createRequestHandler({ detectScript, sessionPath, textRowsPath, livePath }));

httpServer.listen(state.port, '127.0.0.1', () => {
  writeLiveServerInfo(process.cwd(), { pid: process.pid, port: state.port, token: state.token });
  const url = `http://localhost:${state.port}`;
  console.log(`\nImpeccable live server running on ${url}`);
  console.log(`Token: ${state.token}\n`);
  console.log(`Inject: <script src="${url}/live.js"><\/script>`);
  console.log(`Stop:   node ${path.basename(fileURLToPath(import.meta.url))} stop`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
