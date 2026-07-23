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
import { parseDesignMd } from './lib/design-parser.mjs';
import { loadContext } from './context.mjs';
import {
  assembleLiveBrowserScript,
  assertLiveBrowserScriptParts,
  readLiveBrowserScriptParts,
  resolveLiveBrowserScriptParts,
} from './live/browser-script-parts.mjs';
import { createLiveSessionStore, GENERATION_FENCED_PHASES } from './live/session-store.mjs';
import { runGenerationPreflight } from './live/generation-preflight.mjs';
import { validateEvent } from './live/event-validation.mjs';
import { selectAvailablePendingEvent } from './live/poll-lanes.mjs';
import { createManualEditRoutes } from './live/manual-edit-routes.mjs';
import { LIVE_COMMANDS } from './live/vocabulary.mjs';
import {
  getDesignSidecarPath,
  getLiveDir,
  getLiveAnnotationsDir,
  IMPECCABLE_COMMAND_PREFIX,
  readLiveServerInfo,
  removeLiveServerInfo,
  resolveDesignSidecarPath,
  writeLiveServerInfo,
} from './lib/impeccable-paths.mjs';
import { countByPage as countPendingByPage } from './live/manual-edits-buffer.mjs';
import {
  createManualApplyController,
  summarizeManualApplyFailures,
} from './live/manual-apply.mjs';
import {
  applyDeferredSvelteComponentAccepts,
  removeAllSvelteComponentSessions,
} from './live/svelte-component.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PRODUCT.md / DESIGN.md live wherever context.mjs resolves. The generated
// DESIGN sidecar is project-local at .impeccable/design.json, with legacy
// DESIGN.json fallback for existing projects.
const PROJECT_CONTEXT = loadContext(process.cwd());
const CONTEXT_DIR = PROJECT_CONTEXT.contextDir;
const DESIGN_MD_PATH = PROJECT_CONTEXT.designPath
  ? path.resolve(process.cwd(), PROJECT_CONTEXT.designPath)
  : null;
const DEFAULT_POLL_TIMEOUT = 600_000;   // 10 min — agent re-polls on timeout anyway
const SSE_HEARTBEAT_INTERVAL = 30_000;  // keepalive ping every 30s
// The browser checkpoints for several unrelated reasons (see checkpointPayload
// in live-browser.js). Only these two report that variant availability changed,
// and only they may drive variant_progress / the *_reviewable phases.
const VARIANT_PROGRESS_CHECKPOINT_REASONS = new Set(['variants_progress', 'variants_ready']);

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
  lastAgentPollingBroadcast: null,
  exitTimer: null,
  sessionDir: null,         // per-session tmp dir for annotation screenshots
  sessionStore: null,
  leaseTimer: null,
  manualEditActivity: null,
  nextManualEditSeq: 1,
  // Deferreds for in-flight chat-routed Apply events. Keyed by event id; each
  // entry is resolved when the chat agent POSTs an ack carrying the batch
  // result, or rejected when the hard timeout fires.
  pendingApplyDeferreds: new Map(),
  // Updated whenever a /poll long-poll request arrives or is resolved with an
  // event. Used to detect "a chat agent is likely attached" without requiring
  // a poll to be parked at the exact moment we dispatch.
  lastPollAt: 0,
  timedOutApplyIds: new Map(),
};

const CHAT_POLL_FRESHNESS_MS = 60_000;
const POLL_LEASE_EXPIRY_TIMER_GRACE_MS = 2;
const DEBUG_MANUAL_EDIT_EVENTS = /^(1|true|yes)$/i.test(process.env.IMPECCABLE_LIVE_DEBUG_EVENTS || '');

const manualApply = createManualApplyController({
  pendingEvents: state.pendingEvents,
  pendingApplyDeferreds: state.pendingApplyDeferreds,
  timedOutApplyIds: state.timedOutApplyIds,
  enqueueEvent,
  acknowledgePendingEvent,
  flushPendingPolls,
  recordManualEditActivity,
  cwd: () => process.cwd(),
});

const manualEditRoutes = createManualEditRoutes({
  getToken: () => state.token,
  manualApply,
  recordManualEditActivity,
  getManualEditStatus,
  chatAgentLikelyActive,
  cwd: () => process.cwd(),
  env: () => process.env,
});

function chatAgentLikelyActive() {
  if (state.pendingPolls.length > 0) return true;
  if (!state.lastPollAt) return false;
  return Date.now() - state.lastPollAt < CHAT_POLL_FRESHNESS_MS;
}

// Cap per-annotation upload size. A full 1920×1080 PNG is typically <1 MB;
// cap at 10 MB to guard against runaway writes from a misbehaving client.
const MAX_ANNOTATION_BYTES = 10 * 1024 * 1024;

function enqueueEvent(event) {
  if (!event || (event.id && state.pendingEvents.some((entry) => entry.event?.id === event.id && entry.event?.type === event.type))) return;
  state.pendingEvents.push({ event, leaseUntil: 0, seq: state.nextEventSeq++ });
  flushPendingPolls();
}

function restorePendingEventsFromStore() {
  if (!state.sessionStore) return;
  for (const snapshot of state.sessionStore.listActiveSessions()) {
    if (snapshot.pendingEvent) enqueueEvent(snapshot.pendingEvent);
  }
}

function findAvailablePendingEvent(now = Date.now(), types = null) {
  return selectAvailablePendingEvent(state.pendingEvents, { now, types });
}

async function leaseEvent(entry, leaseMs) {
  // Claim the entry before awaiting anything. prepareGenerateEventForLease
  // yields to the event loop, and selectAvailablePendingEvent only skips
  // entries whose lease is in the future — an unclaimed entry would be handed
  // to a second poll in that window and generated twice.
  entry.leaseUntil = Date.now() + leaseMs;
  await prepareGenerateEventForLease(entry);
  if (!entry.event?.id) {
    const idx = state.pendingEvents.indexOf(entry);
    if (idx !== -1) state.pendingEvents.splice(idx, 1);
    return entry.event;
  }
  // Re-stamp so the lease window starts when the agent actually receives the
  // work, not when scaffolding began.
  entry.leaseUntil = Date.now() + leaseMs;
  recordGenerateDelivery(entry);
  scheduleLeaseFlush();
  broadcastAgentPollingIfChanged();
  return entry.event;
}

function recordGenerateDelivery(entry) {
  const event = entry?.event;
  if (!event || event.type !== 'generate' || event.generationReadyAt) return;
  const at = Date.now();
  entry.event = { ...event, generationReadyAt: at };
  state.sessionStore?.appendEvent(entry.event);
  recordAgentPhase(event.id, 'generation_ready', { at });
}

async function prepareGenerateEventForLease(entry) {
  const event = entry?.event;
  if (!event || event.type !== 'generate' || event.scaffoldAttempted) return;

  recordAgentPhase(event.id, 'picked_up');
  recordAgentPhase(event.id, 'scaffolding');
  const result = await runGenerationPreflight(event, {
    cwd: process.cwd(),
    scriptsDir: __dirname,
  });
  entry.event = {
    ...event,
    scaffoldAttempted: true,
    scaffoldDurationMs: result.durationMs ?? null,
    ...(result.ok ? { scaffold: result.scaffold } : { scaffoldError: result.error || result.reason }),
  };
  state.sessionStore?.appendEvent(entry.event);
  recordAgentPhase(event.id, result.ok ? 'source_ready' : 'scaffold_fallback', {
    durationMs: result.durationMs ?? null,
    previewMode: result.scaffold?.previewMode || 'source',
  });
}

function recordAgentPhase(id, phase, details = {}) {
  if (!id) return;
  const event = {
    type: 'agent_phase',
    id,
    phase,
    at: Date.now(),
    ...details,
  };
  state.sessionStore?.appendEvent(event);
  broadcast(event);
}

/**
 * Detect a browser that missed the generation `done` broadcast.
 *
 * The preflight scaffold write triggers a framework full-reload (Astro reloads
 * the page for any .astro edit). If the agent's variant write + `done` land
 * while the browser is mid-reload, the new page misses both the second HMR
 * reload and the SSE `done` — it resumes from the scaffold-only source and
 * sits in GENERATING at 0/N forever. That resumed page always checkpoints
 * (`browser_resumed`), so a checkpoint claiming "still generating, variants
 * missing" for a session whose generation already completed is direct
 * evidence of the miss. Rebuild the `done` payload from the snapshot so the
 * caller can re-broadcast it; the browser's done handler is idempotent and
 * falls back to injecting variants from source.
 *
 * Keys on the store's monotone `generationCompletedAt`, not `phase` — the
 * behind checkpoint itself regresses `phase` to `generating`, and a browser
 * that misses the redelivered `done` too (another reload) must still trigger
 * redelivery from its next checkpoint.
 */
function detectMissedGenerationCompletion(event) {
  if (!event?.id || event.type !== 'checkpoint') return null;
  if (event.phase !== 'generating') return null;
  if (!variantCountLooksBehind(event.arrivedVariants, event.expectedVariants)) return null;
  if (!state.sessionStore) return null;
  let snapshot = null;
  try {
    snapshot = state.sessionStore.getSnapshot(event.id);
  } catch {
    return null;
  }
  return missedCompletionFromSnapshot(snapshot);
}

function variantCountLooksBehind(arrivedValue, expectedValue) {
  const arrived = Number(arrivedValue) || 0;
  const expected = Number(expectedValue) || 0;
  return arrived <= 0 || (expected > 0 && arrived < expected);
}

function missedCompletionFromSnapshot(snapshot) {
  if (!snapshot?.id || !snapshot.generationCompletedAt) return null;
  if (snapshot.generationCanceled) return null;
  // Accept/discard already underway: the browser is no longer waiting on
  // generation, and a late `done` there would collide with teardown.
  if (GENERATION_FENCED_PHASES.has(snapshot.phase)) return null;
  const file = snapshot.sourceFile || snapshot.previewFile;
  if (!file) return null;
  return {
    type: 'done',
    id: snapshot.id,
    file,
    sourceFile: snapshot.sourceFile || undefined,
    previewFile: snapshot.previewFile || undefined,
    previewMode: snapshot.previewMode || undefined,
    redelivered: true,
  };
}

function recordGenerationCheckpoint(event) {
  if (!event?.id || event.type !== 'checkpoint') return;
  if (generationIsFenced(event.id)) return;
  // Only checkpoints that report a change in variant availability are
  // generation progress. The browser also checkpoints for durability on Tune
  // slider drags, resumes, and anchor recovery; treating those as progress
  // echoed `variant_progress` straight back to the browser that sent it, which
  // remounts the component preview mid-drag (reverting the user's live param
  // edit and detaching the popover's element), and permanently latched the
  // *_reviewable phases from the wrong trigger, corrupting generation timings.
  if (!VARIANT_PROGRESS_CHECKPOINT_REASONS.has(event.reason)) return;
  const arrived = Number(event.arrivedVariants) || 0;
  const expected = Number(event.expectedVariants) || 0;
  if (arrived <= 0 || expected <= 0) return;
  const previewMode = event.previewMode || 'source';
  const previewFile = event.previewFile || event.file;
  if (previewFile) {
    broadcast({
      type: 'variant_progress',
      id: event.id,
      file: previewFile,
      sourceFile: event.sourceFile || (previewMode === 'source' ? previewFile : undefined),
      previewFile,
      previewMode,
      arrivedVariants: arrived,
      expectedVariants: expected,
      publicationKind: event.publicationKind || 'variants',
    });
  }
  const details = {
    arrivedVariants: arrived,
    expectedVariants: expected,
    checkpointReason: event.reason || null,
  };
  const at = Date.now();
  if (!generationPhaseAlreadyRecorded(event.id, 'first_reviewable')) {
    recordAgentPhase(event.id, 'first_reviewable', { ...details, at });
  }
  if (arrived >= 2 && expected >= 3 && !generationPhaseAlreadyRecorded(event.id, 'second_reviewable')) {
    recordAgentPhase(event.id, 'second_reviewable', { ...details, at });
  }
  if (arrived >= expected && !generationPhaseAlreadyRecorded(event.id, 'all_variants_ready')) {
    recordAgentPhase(event.id, 'all_variants_ready', { ...details, at });
  }
}

function generationIsFenced(id) {
  if (!state.sessionStore || !id) return false;
  try {
    const snapshot = state.sessionStore.getSnapshot(id, { includeCompleted: true });
    return snapshot?.generationCanceled === true;
  } catch {
    return false;
  }
}

function generationPhaseAlreadyRecorded(id, phase) {
  if (!state.sessionStore) return false;
  try {
    const snapshot = state.sessionStore.getSnapshot(id, { includeCompleted: true });
    return !!snapshot?.generationTimings?.[phase];
  } catch {
    return false;
  }
}

function acknowledgePendingEvent(id, sourceEventType) {
  if (!id) return false;
  const idx = state.pendingEvents.findIndex((entry) => (
    entry.event?.id === id
    && (!sourceEventType || entry.event?.type === sourceEventType)
  ));
  if (idx === -1) return false;
  const acknowledged = state.pendingEvents[idx].event;
  state.pendingEvents.splice(idx, 1);
  scheduleLeaseFlush();
  broadcastAgentPollingIfChanged();
  return acknowledged;
}

function releasePendingEvent(id, sourceEventType) {
  const entry = state.pendingEvents.find((item) => (
    item.event?.id === id
    && (!sourceEventType || item.event?.type === sourceEventType)
  ));
  if (!entry) return null;
  entry.leaseUntil = 0;
  scheduleLeaseFlush();
  return entry.event;
}

function retirePendingGeneration(id) {
  if (!id) return 0;
  let retired = 0;
  for (let index = state.pendingEvents.length - 1; index >= 0; index -= 1) {
    const event = state.pendingEvents[index]?.event;
    if (event?.id !== id || event.type !== 'generate') continue;
    state.pendingEvents.splice(index, 1);
    retired += 1;
  }
  if (retired > 0) {
    scheduleLeaseFlush();
    broadcastAgentPollingIfChanged();
  }
  return retired;
}

function findPendingEventById(id, sourceEventType) {
  if (!id) return null;
  const entry = state.pendingEvents.find((item) => (
    item.event?.id === id
    && (!sourceEventType || item.event?.type === sourceEventType)
  ));
  return entry?.event || null;
}

function summarizePendingEventForStatus(entry) {
  const event = entry.event || {};
  const summary = {
    id: event.id,
    type: event.type,
    leased: isLeased(entry),
    leaseUntil: entry.leaseUntil || null,
  };
  if (event.type === 'manual_edit_apply') {
    summary.pageUrl = event.pageUrl || null;
    summary.chunk = event.chunk || null;
    summary.repair = event.repair || null;
    summary.evidencePath = event.evidencePath || null;
    summary.agentAction = event.agentAction || manualApply.buildAgentAction(event);
    summary.manualApplySummary = manualApply.summarizeEvent(event, manualApply.getDeferred(event.id)?.batch || event.batch);
  }
  return summary;
}

function summarizeActiveSessionForClient(snapshot = {}) {
  return {
    id: snapshot.id,
    phase: snapshot.phase,
    pageUrl: snapshot.pageUrl ?? null,
    sourceFile: snapshot.sourceFile ?? null,
    previewFile: snapshot.previewFile ?? null,
    previewMode: snapshot.previewMode ?? null,
    expectedVariants: snapshot.expectedVariants ?? 0,
    arrivedVariants: snapshot.arrivedVariants ?? 0,
    visibleVariant: snapshot.visibleVariant ?? null,
    checkpointRevision: snapshot.checkpointRevision ?? 0,
    browserCheckpointRevision: snapshot.browserCheckpointRevision ?? snapshot.checkpointRevision ?? 0,
    publicationCheckpointRevision: snapshot.publicationCheckpointRevision ?? 0,
    paramValues: snapshot.paramValues || {},
    generationPhase: snapshot.generationPhase ?? null,
    generationCompletedAt: snapshot.generationCompletedAt ?? null,
    generationCanceled: snapshot.generationCanceled === true,
    cancelReason: snapshot.cancelReason ?? null,
  };
}

function activeSessionSummaries() {
  if (!state.sessionStore) return [];
  return state.sessionStore.listActiveSessions().map((snapshot) => summarizeActiveSessionForClient(snapshot));
}

function cancelQueuedAnonymousExitEvents() {
  let removed = 0;
  for (let i = state.pendingEvents.length - 1; i >= 0; i -= 1) {
    const event = state.pendingEvents[i]?.event;
    if (event?.type !== 'exit' || event.id) continue;
    state.pendingEvents.splice(i, 1);
    removed += 1;
  }
  if (removed > 0) {
    scheduleLeaseFlush();
    broadcastAgentPollingIfChanged();
  }
  return removed;
}

function scheduleLeaseFlush() {
  if (state.leaseTimer) {
    clearTimeout(state.leaseTimer);
    state.leaseTimer = null;
  }
  const now = Date.now();
  const nextLeaseUntil = state.pendingEvents
    .map((entry) => entry.leaseUntil || 0)
    .filter((leaseUntil) => leaseUntil > now)
    .sort((a, b) => a - b)[0];
  if (!nextLeaseUntil) return;
  state.leaseTimer = setTimeout(() => {
    state.leaseTimer = null;
    flushPendingPolls();
    broadcastAgentPollingIfChanged();
  }, Math.max(0, nextLeaseUntil - now + POLL_LEASE_EXPIRY_TIMER_GRACE_MS));
}

function flushPendingPolls() {
  let changed = false;
  while (state.pendingPolls.length > 0) {
    let pollIndex = -1;
    let entry = null;
    for (let index = 0; index < state.pendingPolls.length; index += 1) {
      const candidate = findAvailablePendingEvent(Date.now(), state.pendingPolls[index].types);
      if (!candidate) continue;
      pollIndex = index;
      entry = candidate;
      break;
    }
    if (!entry) {
      scheduleLeaseFlush();
      broadcastAgentPollingIfChanged();
      return;
    }
    const [poll] = state.pendingPolls.splice(pollIndex, 1);
    // leaseEvent is async (it may scaffold source), but it claims the entry
    // synchronously, so the next loop iteration will not re-select it. Resolve
    // the poll when the lease settles rather than awaiting here, so one slow
    // scaffold never delays the other parked polls. On the exceptional failure
    // path, answer `timeout` so the agent re-polls; the claim stays until the
    // lease expires, which keeps a deterministic failure from hot-looping.
    leaseEvent(entry, poll.leaseMs).then(poll.resolve, (error) => {
      console.error('[live] lease failed for ' + (entry.event?.id || 'unknown') + ': ' + (error?.message || error));
      poll.resolve({ type: 'timeout' });
    });
    changed = true;
  }
  scheduleLeaseFlush();
  if (changed) broadcastAgentPollingIfChanged();
}

function isLeased(entry) {
  return !!(entry?.leaseUntil && entry.leaseUntil > Date.now());
}

function agentPollingConnected() {
  // A leased event only proves that a poll returned once. The foreground task
  // may have ended immediately afterward, so only an actively waiting poll is
  // evidence that steering can wake the task right now.
  return state.pendingPolls.length > 0;
}

function broadcastAgentPollingIfChanged() {
  const connected = agentPollingConnected();
  if (state.lastAgentPollingBroadcast === connected) return;
  state.lastAgentPollingBroadcast = connected;
  broadcast({ type: 'agent_polling', connected });
}

/** Push a message to all connected SSE clients. */
function broadcast(msg) {
  const data = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of state.sseClients) {
    try { res.write(data); } catch { /* client gone */ }
  }
}

function recordManualEditActivity(type, details = {}) {
  const entry = {
    seq: state.nextManualEditSeq++,
    type,
    ts: new Date().toISOString(),
    ...details,
  };
  state.manualEditActivity = entry;
  if (DEBUG_MANUAL_EDIT_EVENTS) {
    try {
      const filePath = path.join(getLiveDir(process.cwd()), 'manual-edit-events.jsonl');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
    } catch {
      /* diagnostics are best-effort; never block live mode on observability */
    }
  }
  broadcast(entry);
  return entry;
}

function getManualEditStatus() {
  try {
    const { totalCount, perPage } = countPendingByPage(process.cwd());
    return { totalCount, perPage, lastActivity: state.manualEditActivity };
  } catch (err) {
    return {
      totalCount: null,
      perPage: {},
      lastActivity: state.manualEditActivity,
      error: err.message,
    };
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

  // Browser script parts: DO NOT cache. Return paths so the /live.js handler
  // can re-read every part on each request. Editing browser code during
  // iteration should land on the next tab reload, not require a server restart.
  const liveScriptParts = resolveLiveBrowserScriptParts(__dirname);
  try {
    assertLiveBrowserScriptParts(liveScriptParts);
  } catch (err) {
    process.stderr.write('Error: ' + err.message + '\n');
    process.exit(1);
  }

  return { detectScript, liveScriptParts };
}

function hasProjectContext() {
  // PRODUCT.md carries brand voice / anti-references — that's what determines
  // whether variants are brand-aware. DESIGN.md (visual tokens) is a separate
  // concern, surfaced by the design panel's own empty state.
  return !!PROJECT_CONTEXT.hasProduct;
}

function statOrNull(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

// Strict loopback-origin test for CORS. Parses the Origin as a URL (never a
// substring match, so `http://localhost.evil.com` and `http://127.0.0.1.evil.com`
// fail) and accepts only http/https on localhost, 127.0.0.1, or the IPv6 loopback.
function isLoopbackOrigin(origin) {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

// HTTP request handler
// ---------------------------------------------------------------------------

function createRequestHandler({ detectScript, liveScriptParts }) {
  return (req, res) => {
    const url = new URL(req.url, `http://localhost:${state.port}`);
    // Loopback-restricted CORS. Reflect the caller's Origin only when it is a
    // loopback origin, always paired with `Vary: Origin` so an intermediary
    // cache never serves a response authorized for one origin to another. A
    // remote page (e.g. https://evil.example probing the port from a tab open
    // on the same machine) gets no Access-Control-Allow-Origin, so its
    // JS-initiated fetch cannot read any response. Requests with no Origin
    // header (script tags, curl, the agent's own fetches) are not subject to
    // CORS and keep working; no ACAO header is needed for them.
    const origin = req.headers.origin;
    if (origin && isLoopbackOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const p = url.pathname;

    // --- Scripts ---
    if (p === '/live.js') {
      // Token-gated: the script body embeds state.token, which unlocks every
      // token-guarded route. Serving it unauthenticated let any local page read
      // the token and drive the session. The injected <script src> carries
      // `?token=...` (see live-inject.mjs). A missing/wrong token → 401.
      if (url.searchParams.get('token') !== state.token) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }
      // Re-read from disk each request so edits to live-browser.js land on
      // the next tab reload. No-store headers prevent browser caching across
      // sessions — during iteration, a cached old script silently breaks
      // every subsequent session.
      let parts;
      try {
        parts = readLiveBrowserScriptParts(liveScriptParts);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading live browser scripts: ' + err.message);
        return;
      }
      const body = assembleLiveBrowserScript({
        token: state.token,
        port: state.port,
        vocabulary: LIVE_COMMANDS,
        commandPrefix: IMPECCABLE_COMMAND_PREFIX,
        parts,
      });
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
      const sessions = activeSessionSummaries();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        port: state.port,
        connectedClients: state.sseClients.size,
        pendingEvents: state.pendingEvents.map((entry) => summarizePendingEventForStatus(entry)),
        agentPolling: agentPollingConnected(),
        activeSessions: sessions,
        manualEdits: getManualEditStatus(),
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

      const mdPath = DESIGN_MD_PATH;
      const jsonPath = resolveDesignSidecarPath(process.cwd(), PROJECT_CONTEXT.designContextDir || CONTEXT_DIR) || getDesignSidecarPath(process.cwd());
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
      // Confine to the project root. A bare `startsWith(cwd)` string check lets a
      // sibling dir whose name extends the root name (projeto -> projeto-backup)
      // slip through; compare on the relative path instead (same pattern as
      // sessionFileMetadataFromPollReply below). An empty rel means the request
      // resolved to the root directory itself, which this file route never serves.
      const rel = path.relative(process.cwd(), absPath);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end('Forbidden'); return; }
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
      clearTimeout(state.exitTimer);
      state.exitTimer = null;
      cancelQueuedAnonymousExitEvents();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: ' + JSON.stringify({
        type: 'connected',
        hasProjectContext: hasProjectContext(),
        agentPolling: agentPollingConnected(),
        activeSessions: activeSessionSummaries(),
      }) + '\n\n');

      state.sseClients.add(res);

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

    if (manualEditRoutes(req, res, url)) return;

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
        if (msg.type === 'agent_phase') {
          recordAgentPhase(msg.id, msg.phase, {
            ...(Number.isFinite(msg.durationMs) ? { durationMs: msg.durationMs } : {}),
            owner: typeof msg.owner === 'string' ? msg.owner : undefined,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        const missedCompletion = detectMissedGenerationCompletion(msg);
        if (state.sessionStore && msg.id) {
          try {
            state.sessionStore.appendEvent(msg);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'session_store_append_failed', message: err.message }));
            return;
          }
        }
        if (msg.type === 'accept' || msg.type === 'discard') {
          retirePendingGeneration(msg.id);
        }
        recordGenerationCheckpoint(msg);
        if (missedCompletion) broadcast(missedCompletion);
        if (msg.type === 'exit') {
          cleanupSvelteComponentSessionsBeforeExit();
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

function parsePollTypes(value) {
  if (!value) return null;
  const types = String(value).split(',').map((type) => type.trim()).filter(Boolean);
  return types.length > 0 ? new Set(types) : null;
}

function handlePollGet(req, res, url) {
  const token = url.searchParams.get('token');
  if (token !== state.token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  state.lastPollAt = Date.now();
  const timeout = parseInt(url.searchParams.get('timeout') || DEFAULT_POLL_TIMEOUT, 10);
  const leaseMs = parseInt(url.searchParams.get('leaseMs') || '30000', 10);
  const types = parsePollTypes(url.searchParams.get('types'));
  const available = findAvailablePendingEvent(Date.now(), types);
  if (available) {
    // Do not await inline: leaseEvent may scaffold source, and this handler runs
    // on the server's only thread. The client can disconnect during that window,
    // so check the socket before replying.
    leaseEvent(available, leaseMs).then((event) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(event));
    }, (error) => {
      console.error('[live] lease failed for ' + (available.event?.id || 'unknown') + ': ' + (error?.message || error));
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'timeout' }));
    });
    return;
  }
  const poll = { resolve, leaseMs, types };
  const timer = setTimeout(() => {
    const idx = state.pendingPolls.indexOf(poll);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
    broadcastAgentPollingIfChanged();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'timeout' }));
  }, timeout);
  function resolve(event) {
    clearTimeout(timer);
    state.lastPollAt = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(event));
  }
  state.pendingPolls.push(poll);
  broadcastAgentPollingIfChanged();
  scheduleLeaseFlush();
  req.on('close', () => {
    clearTimeout(timer);
    const idx = state.pendingPolls.indexOf(poll);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
    broadcastAgentPollingIfChanged();
  });
}

function sessionFileMetadataFromPollReply(file) {
  if (!file || typeof file !== 'string') return { file };
  const normalized = file.split(path.sep).join('/');
  const base = { file: normalized };
  const metadataFile = normalized;
  if (!metadataFile.endsWith('/manifest.json') && metadataFile !== 'manifest.json') return base;
  if (!metadataFile.includes('node_modules/.impeccable-live/')
      && !metadataFile.includes('src/lib/impeccable/')
      && !metadataFile.includes('/.impeccable-live/')) return base;

  let full;
  try {
    full = path.resolve(process.cwd(), metadataFile);
    const rel = path.relative(process.cwd(), full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return base;
  } catch {
    return base;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(full, 'utf-8'));
    if (manifest?.previewMode !== 'svelte-component'
        || !manifest.sourceFile) return base;
    return {
      file: String(manifest.sourceFile).split(path.sep).join('/'),
      sourceFile: String(manifest.sourceFile).split(path.sep).join('/'),
      previewFile: normalized,
      previewMode: manifest.previewMode,
    };
  } catch {
    return base;
  }
}

function inferSourceEventType(msg = {}, pendingEvents = state.pendingEvents) {
  const entriesForId = pendingEvents.filter((entry) => entry.event?.id === msg.id);
  const pendingTypes = new Set(entriesForId.map((entry) => entry.event?.type));
  if (msg.type === 'discarded' || msg.type === 'discard') return 'discard';
  if (msg.type === 'complete') {
    if (pendingTypes.has('carbonize_cleanup')) return 'carbonize_cleanup';
    return pendingTypes.has('accept') ? 'accept' : (pendingTypes.has('generate') ? 'generate' : undefined);
  }
  if (msg.type === 'steer_done') return 'steer';
  // `agent_done` can be the automatic acknowledgement for a carbonize Accept.
  // New pollers send sourceEventType explicitly; default to generate only for
  // older callers so a late worker cannot acknowledge a queued Accept.
  if (msg.type === 'agent_done' || msg.type === 'done') return 'generate';
  // `error` is reference/live.md's documented failure reply, and parseReplyArgs
  // never sets sourceEventType on it (the poller is a fresh process that cannot
  // know what it leased). Returning undefined here makes acknowledgePendingEvent
  // match *any* event for this id: a stale generate worker's failure silently
  // consumed the user's queued Accept, which was then never delivered to any
  // agent and left the browser in SAVING forever. Attribute the failure to the
  // event this agent actually holds a lease on, and otherwise to `generate` —
  // never to a wildcard. If that generate was already retired by an Accept, the
  // ack simply finds no match, which is the correct outcome for a stale reply.
  if (msg.type === 'error') {
    return entriesForId.find(isLeased)?.event?.type || 'generate';
  }
  return undefined;
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
    const pendingApplyDeferred = manualApply.getDeferred(msg.id);
    if (pendingApplyDeferred) {
      const validation = manualApply.validateResultMessage(msg, pendingApplyDeferred);
      if (!validation.ok) {
        recordManualEditActivity('manual_edit_apply_reply_invalid', {
          id: msg.id,
          pageUrl: pendingApplyDeferred.pageUrl,
          chunk: pendingApplyDeferred.event?.chunk || null,
          repair: pendingApplyDeferred.event?.repair || null,
          reason: validation.body?.reason || validation.body?.error || 'invalid_manual_apply_result',
          status: msg.data?.status || null,
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(validation.body));
        return;
      }
      recordManualEditActivity('manual_edit_apply_reply_received', {
        id: msg.id,
        pageUrl: pendingApplyDeferred.pageUrl,
        chunk: pendingApplyDeferred.event?.chunk || null,
        repair: pendingApplyDeferred.event?.repair || null,
        status: validation.result.status,
        appliedCount: validation.result.appliedEntryIds.length,
        failed: summarizeManualApplyFailures(validation.result.failed),
        fileCount: validation.result.files.length,
        noteCount: validation.result.notes.length,
      });
      manualApply.resolveDeferred(msg.id, validation.result);
      acknowledgePendingEvent(msg.id);
      flushPendingPolls();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (manualApply.hasTimedOutId(msg.id)) {
      const rollback = manualApply.rollbackTimedOutReply(msg);
      recordManualEditActivity('manual_edit_apply_stale_reply_rejected', {
        id: msg.id,
        rolledBackFileCount: rollback.rolledBackFiles?.length || 0,
        rollbackFailureCount: rollback.rollbackFailures?.length || 0,
      });
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'stale_manual_edit_apply_reply', ...rollback }));
      return;
    }
    const sourceEventType = msg.sourceEventType || inferSourceEventType(msg);
    if (msg.type === 'retry') {
      const releasedEvent = releasePendingEvent(msg.id, sourceEventType);
      if (!releasedEvent) {
        res.writeHead(msg.id ? 404 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: msg.id ? 'unknown_poll_retry_id' : 'missing_poll_retry_id',
          id: msg.id,
        }));
        return;
      }
      flushPendingPolls();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, released: true }));
      return;
    }
    const pendingEventBeforeAck = findPendingEventById(msg.id, sourceEventType);
    if (pendingEventBeforeAck?.type === 'steer' && msg.type === 'steer_done'
        && !msg.file && !(typeof msg.message === 'string' && msg.message.trim())) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'steer_done_requires_file_or_message',
        hint: 'Reply with --file after writing source, or include a message explaining an intentional no-op.',
      }));
      return;
    }
    const acknowledgedEvent = acknowledgePendingEvent(msg.id, sourceEventType);
    let skipJournalReply = false;
    let existingSession = null;
    if (!acknowledgedEvent && state.sessionStore && msg.id) {
      try {
        existingSession = state.sessionStore.getSnapshot(msg.id, { includeCompleted: true });
        if (!existingSession?.updatedAt) existingSession = null;
        skipJournalReply = existingSession?.phase === 'completed' || existingSession?.phase === 'discarded';
      } catch { /* fall through and record the reply normally */ }
    }
    if (!acknowledgedEvent && !existingSession) {
      recordManualEditActivity('manual_edit_poll_reply_unknown', {
        id: msg.id || null,
        type: msg.type || null,
      });
      res.writeHead(msg.id ? 404 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: msg.id ? 'unknown_poll_reply_id' : 'missing_poll_reply_id',
        id: msg.id,
      }));
      return;
    }
    const replyFileMeta = sessionFileMetadataFromPollReply(msg.file);
    if (state.sessionStore && msg.id && !skipJournalReply) {
      try {
        const eventType = msg.type === 'steer_done'
          ? 'steer_done'
          : msg.type === 'discard' || msg.type === 'discarded'
            ? 'discarded'
            : msg.type === 'complete'
              ? 'complete'
              : msg.type === 'error'
                ? 'agent_error'
                : 'agent_done';
        state.sessionStore.appendEvent({
          type: eventType,
          id: msg.id,
          file: replyFileMeta.file,
          sourceFile: replyFileMeta.sourceFile,
          previewFile: replyFileMeta.previewFile,
          previewMode: replyFileMeta.previewMode,
          message: msg.message,
          sourceEventType: acknowledgedEvent?.type,
          carbonize: msg.data?.carbonize === true,
        });
      } catch { /* keep reply path best-effort; browser still needs SSE */ }
    }
    flushPendingPolls();
    // Forward the reply to the browser via SSE
    broadcast({
      type: msg.type || 'done',
      id: msg.id,
      message: msg.message,
      file: msg.file,
      sourceFile: replyFileMeta.sourceFile,
      previewFile: replyFileMeta.previewFile,
      previewMode: replyFileMeta.previewMode,
      data: msg.data,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let httpServer = null;

function shutdown() {
  cleanupSvelteComponentSessionsBeforeExit();
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
  if (httpServer) httpServer.close();
  process.exit(0);
}

function cleanupSvelteComponentSessionsBeforeExit() {
  try {
    removeAllSvelteComponentSessions(process.cwd());
  } catch (err) {
    console.warn('[impeccable] Svelte component session cleanup failed:', err.message);
  }
}

function applyLegacyDeferredAcceptsOnStartup() {
  try {
    const result = applyDeferredSvelteComponentAccepts(process.cwd());
    if (result.applied > 0 || result.failed > 0) {
      console.log('[impeccable] applied legacy deferred Svelte component accepts:', JSON.stringify(result));
    }
  } catch (err) {
    console.warn('[impeccable] legacy deferred Svelte component accept apply failed:', err.message);
  }
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
  /manual-edit-stash   Stage browser copy edits
  /manual-edit-commit  Apply staged browser copy edits
  /manual-edit-discard Discard staged browser copy edits
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
    // The detached child is typically listening in 35-45ms. A 200ms polling
    // floor dominated configured cold Live startup; poll cheaply and return
    // as soon as the child has written its ready record.
    await new Promise(r => setTimeout(r, 5));
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
manualApply.rollbackTransaction({
  reason: 'manual_edit_server_start_recovered_abandoned_transaction',
});
applyLegacyDeferredAcceptsOnStartup();
restorePendingEventsFromStore();
manualApply.pruneStaleEvidence();
const portArg = args.find(a => a.startsWith('--port='));
state.port = portArg ? parseInt(portArg.split('=')[1], 10) : await findOpenPort();
// Annotation screenshots live in the project root so the agent's Read tool
// doesn't trip a per-file permission prompt. Sessioned by token so concurrent
// projects (or quick restarts) don't collide.
const annotRoot = getLiveAnnotationsDir(process.cwd());
fs.mkdirSync(annotRoot, { recursive: true });
state.sessionDir = fs.mkdtempSync(path.join(annotRoot, 'session-'));

const { detectScript, liveScriptParts } = loadBrowserScripts();
httpServer = http.createServer(createRequestHandler({ detectScript, liveScriptParts }));

httpServer.listen(state.port, '127.0.0.1', () => {
  writeLiveServerInfo(process.cwd(), { pid: process.pid, port: state.port, token: state.token });
  const url = `http://localhost:${state.port}`;
  console.log(`\nImpeccable live server running on ${url}`);
  console.log(`Token: ${state.token}\n`);
  console.log(`Script: ${url}/live.js`);
  console.log('Inject: managed by live-inject.mjs; Astro source tags use is:inline automatically.');
  console.log(`Stop:   node ${path.basename(fileURLToPath(import.meta.url))} stop`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
