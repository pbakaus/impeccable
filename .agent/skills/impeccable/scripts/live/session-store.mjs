import fs from 'node:fs';
import path from 'node:path';
import { getLegacyLiveSessionsDir, getLiveSessionsDir, safeSessionId } from '../lib/impeccable-paths.mjs';
import { COMPLETED_SESSION_PHASES, GENERATION_FENCED_SESSION_PHASES } from './vocabulary.mjs';

const COMPLETED_PHASES = new Set(COMPLETED_SESSION_PHASES);
export const GENERATION_FENCED_PHASES = new Set(GENERATION_FENCED_SESSION_PHASES);

// The snapshot file carries two bookkeeping fields the snapshot itself does not
// own: how large the journal was when the snapshot was written, and the next
// sequence number. Both are stripped before a snapshot is handed to a caller.
// The byte count is what makes a cached snapshot verifiable — the journal is
// append-only, so a matching size means no event has landed since.
const META_JOURNAL_BYTES = '__journalBytes';
const META_NEXT_SEQ = '__nextSeq';

// TODO(revision-unification): `checkpointRevision`, `browserCheckpointRevision`,
// and `publicationCheckpointRevision` are three counters for two domains.
// `checkpointRevision` is a compatibility mirror of the browser counter kept for
// older readers. Collapsing them means changing what a resumed browser compares
// its local revision against, so it belongs in a pass that owns resume ordering,
// not in a caching change.

export function createLiveSessionStore({ cwd = process.cwd(), sessionId } = {}) {
  const rootDir = getLiveSessionsDir(cwd);
  const legacyRootDir = getLegacyLiveSessionsDir(cwd);
  fs.mkdirSync(rootDir, { recursive: true });

  // Derived state per session, keyed by what the journal looked like when it was
  // derived. Publisher/complete helpers append from other processes, so the key
  // is the journal's own (path, size, mtime) rather than a trusted local write
  // count: an append this process did not make invalidates the entry and the
  // next read replays. Without the cache every append and every read replayed
  // the whole journal, which made a long session quadratic in its own length.
  /** @type {Map<string, { snapshot: object, nextSeq: number, journalPath: string, size: number, mtimeMs: number }>} */
  const derived = new Map();

  function getReadableJournalPath(id) {
    const primary = getJournalPath(rootDir, id);
    if (fs.existsSync(primary)) return primary;
    const legacy = getJournalPath(legacyRootDir, id);
    if (fs.existsSync(legacy)) return legacy;
    return primary;
  }

  /**
   * The current derived state for a session, from the in-memory cache when the
   * journal has not moved, from the snapshot file when that file is provably
   * current, and from a full replay otherwise.
   */
  function readState(id, { allowSnapshotFile = true } = {}) {
    const journalPath = getReadableJournalPath(id);
    const stat = statOrNull(journalPath);
    const size = stat ? stat.size : -1;
    const mtimeMs = stat ? stat.mtimeMs : -1;

    const cached = derived.get(id);
    if (cached && cached.journalPath === journalPath && cached.size === size && cached.mtimeMs === mtimeMs) {
      return cached;
    }

    if (allowSnapshotFile && stat) {
      const hydrated = readSnapshotFile(getSnapshotPath(rootDir, id), id, size);
      if (hydrated) {
        const entry = { ...hydrated, journalPath, size, mtimeMs };
        derived.set(id, entry);
        return entry;
      }
    }

    const rebuilt = rebuildSnapshotFromJournal(journalPath, id);
    const entry = { snapshot: rebuilt.snapshot, nextSeq: rebuilt.nextSeq, journalPath, size, mtimeMs };
    derived.set(id, entry);
    return entry;
  }

  function persist(id, snapshot, nextSeq) {
    const snapshotPath = getSnapshotPath(rootDir, id);
    const journalPath = getReadableJournalPath(id);
    const stat = statOrNull(journalPath);
    writeSnapshot(snapshotPath, snapshot, { journalBytes: stat ? stat.size : -1, nextSeq });
    derived.set(id, {
      snapshot,
      nextSeq,
      journalPath,
      size: stat ? stat.size : -1,
      mtimeMs: stat ? stat.mtimeMs : -1,
    });
  }

  return {
    rootDir,
    legacyRootDir,
    appendEvent(event) {
      const normalized = normalizeEvent(event, sessionId);
      const journalPath = getJournalPath(rootDir, normalized.id);
      const legacyJournalPath = getJournalPath(legacyRootDir, normalized.id);
      if (!fs.existsSync(journalPath) && fs.existsSync(legacyJournalPath)) {
        fs.copyFileSync(legacyJournalPath, journalPath);
        // The readable path just moved from legacy to primary; anything derived
        // against the old path describes a file this session no longer reads.
        derived.delete(normalized.id);
      }
      // Reuse the derived state when the journal has not changed under us, and
      // apply the new event on top of it. Correctness still comes from the
      // journal: any append from another process invalidates the entry above
      // and this replays before writing, so sequence numbers and phase fences
      // are never taken from a stale copy.
      const prior = readState(normalized.id);
      const entry = {
        seq: prior.nextSeq,
        id: normalized.id,
        type: normalized.type,
        ts: new Date().toISOString(),
        event: normalized,
      };
      fs.appendFileSync(journalPath, JSON.stringify(entry) + '\n');
      const next = applyEvent(prior.snapshot, entry);
      persist(normalized.id, next, prior.nextSeq + 1);
      return next;
    },
    /**
     * True when a journal exists for the id in either root. appendEvent
     * CREATES a journal for any id it is handed, so callers that should only
     * ever touch existing sessions (browser checkpoints, mount acks) check
     * here first — otherwise a stale id from another project's browser
     * storage materializes a ghost session in this store.
     */
    has(id) {
      if (!id || typeof id !== 'string') return false;
      return fs.existsSync(getJournalPath(rootDir, id))
        || fs.existsSync(getJournalPath(legacyRootDir, id));
    },
    /**
     * Read-only. `live-status` and `live-resume` call this against a session a
     * running server owns; writing the snapshot file here made every read a
     * write and let a reader's replay of a half-written journal land on disk.
     * Snapshot files are written by appendEvent and by flush().
     */
    getSnapshot(id = sessionId, opts = {}) {
      if (!id) throw new Error('session id required');
      const { snapshot } = readState(id);
      if (!opts.includeCompleted && COMPLETED_PHASES.has(snapshot.phase)) return null;
      return snapshot;
    },
    /**
     * Write the snapshot file for a session without appending an event. The
     * durable truth is the journal, so this only refreshes the read cache other
     * processes use; callers that need the state itself should use getSnapshot.
     */
    flush(id = sessionId) {
      if (!id) throw new Error('session id required');
      const state = readState(id, { allowSnapshotFile: false });
      persist(id, state.snapshot, state.nextSeq);
      return state.snapshot;
    },
    listActiveSessions() {
      const ids = new Set();
      for (const dir of [legacyRootDir, rootDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length));
        }
      }
      // Each id goes through readState, so a session whose journal has not moved
      // since it was last derived costs a stat and nothing more. The server calls
      // this on every /status and on every SSE connect.
      return [...ids]
        .sort()
        .map((id) => this.getSnapshot(id))
        .filter(Boolean);
    },
  };
}

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Hydrate derived state from a snapshot file, but only when it provably
 * describes the journal as it stands right now. Anything short of an exact byte
 * match on an append-only file means events landed after the snapshot was
 * written, and the caller replays instead.
 */
function readSnapshotFile(snapshotPath, id, journalBytes) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed[META_JOURNAL_BYTES] !== journalBytes) return null;
  if (!Number.isInteger(parsed[META_NEXT_SEQ])) return null;
  const nextSeq = parsed[META_NEXT_SEQ];
  delete parsed[META_JOURNAL_BYTES];
  delete parsed[META_NEXT_SEQ];
  // The journal owns identity; a snapshot file copied between session ids is
  // not a reason to answer with the wrong id.
  if (parsed.id !== id) return null;
  return { snapshot: { ...baseSnapshot(id), ...parsed }, nextSeq };
}

function normalizeEvent(event, fallbackId) {
  if (!event || typeof event !== 'object') throw new Error('event object required');
  const id = event.id || fallbackId;
  if (!id || typeof id !== 'string') throw new Error('event id required');
  if (!event.type || typeof event.type !== 'string') throw new Error('event type required');
  return { ...event, id };
}

function getJournalPath(rootDir, id) {
  return path.join(rootDir, safeSessionId(id) + '.jsonl');
}

function getSnapshotPath(rootDir, id) {
  return path.join(rootDir, safeSessionId(id) + '.snapshot.json');
}

function baseSnapshot(id) {
  return {
    id,
    phase: 'new',
    pageUrl: null,
    sourceFile: null,
    previewFile: null,
    previewMode: null,
    expectedVariants: 0,
    arrivedVariants: 0,
    visibleVariant: null,
    paramValues: {},
    pendingEventSeq: null,
    pendingEvent: null,
    deliveryLease: null,
    checkpointRevision: 0,
    browserCheckpointRevision: 0,
    publicationCheckpointRevision: 0,
    activeOwner: null,
    sourceMarkers: {},
    fallbackMode: null,
    generationPhase: null,
    generationCompletedAt: null,
    generationTimings: {},
    variantPlan: null,
    generationCanceled: false,
    generationCanceledAt: null,
    cancelReason: null,
    annotationArtifacts: [],
    // Render truth. `arrivedVariants` says what the agent published; these say
    // what the browser actually got on screen. They are kept alongside the
    // published counters rather than replacing them so older readers keep
    // working, but they are the only fields that answer "did the user ever see
    // a variant".
    mountedVariants: [],
    mountFailures: [],
    renderState: null,
    diagnostics: [],
    updatedAt: null,
  };
}

// How many mount failures a session keeps. The card in the browser shows the
// newest one; the agent needs enough history to spot a variant that fails
// every republish, not the whole retry storm.
const MOUNT_FAILURE_HISTORY = 5;

/**
 * `pending` = the agent published and nothing has acked yet, `mounted` = at
 * least one variant reached the DOM, `failed` = the browser reported failures
 * and nothing ever mounted. A single success outranks any number of failures:
 * the user is looking at something.
 */
function deriveRenderState(snapshot) {
  if (snapshot.mountedVariants.length > 0) return 'mounted';
  if (snapshot.mountFailures.length > 0) return 'failed';
  if (snapshot.generationCompletedAt) return 'pending';
  return null;
}

function rebuildSnapshotFromJournal(journalPath, id) {
  let snapshot = baseSnapshot(id);
  const diagnostics = [];
  let nextSeq = 1;
  if (!fs.existsSync(journalPath)) return { snapshot, diagnostics, nextSeq };

  const lines = fs.readFileSync(journalPath, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry !== 'object') throw new Error('entry is not object');
      if (Number.isInteger(entry.seq)) nextSeq = Math.max(nextSeq, entry.seq + 1);
      snapshot = applyEvent(snapshot, entry);
    } catch (err) {
      diagnostics.push({
        error: 'journal_parse_failed',
        line: i + 1,
        message: err.message,
      });
    }
  }
  snapshot.diagnostics = [...snapshot.diagnostics, ...diagnostics];
  return { snapshot, diagnostics, nextSeq };
}

function applyEvent(snapshot, entry) {
  const event = entry.event || entry;
  const next = {
    ...snapshot,
    paramValues: { ...(snapshot.paramValues || {}) },
    sourceMarkers: { ...(snapshot.sourceMarkers || {}) },
    generationTimings: { ...(snapshot.generationTimings || {}) },
    variantPlan: snapshot.variantPlan || null,
    annotationArtifacts: [...(snapshot.annotationArtifacts || [])],
    mountedVariants: [...(snapshot.mountedVariants || [])],
    mountFailures: [...(snapshot.mountFailures || [])],
    renderState: snapshot.renderState ?? null,
    diagnostics: [...(snapshot.diagnostics || [])],
    updatedAt: entry.ts || new Date().toISOString(),
  };

  switch (event.type) {
    case 'generate':
      next.phase = 'generate_requested';
      next.pageUrl = event.pageUrl ?? next.pageUrl;
      next.expectedVariants = event.count ?? next.expectedVariants;
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      next.variantPlan = null;
      // A new cycle publishes new files: everything the browser told us about
      // the previous batch is now about modules that no longer exist.
      next.mountedVariants = [];
      next.mountFailures = [];
      next.renderState = null;
      if (event.screenshotPath) upsertArtifact(next.annotationArtifacts, { type: 'screenshot', path: event.screenshotPath });
      break;
    case 'variant_plan':
      if (!next.generationCanceled && !GENERATION_FENCED_PHASES.has(next.phase)) {
        next.variantPlan = event.plan ?? next.variantPlan;
      }
      break;
    case 'detector_waivers':
      if (!next.generationCanceled && !GENERATION_FENCED_PHASES.has(next.phase)) {
        next.detectorWaivers = [
          ...(next.detectorWaivers || []),
          ...(Array.isArray(event.waivers) ? event.waivers : []),
        ];
      }
      break;
    case 'agent_phase':
      next.generationPhase = event.phase ?? next.generationPhase;
      if (event.phase) {
        next.generationTimings[event.phase] = {
          at: event.at ?? (Date.parse(entry.ts || '') || null),
          durationMs: event.durationMs ?? null,
        };
      }
      break;
    case 'variants_ready':
    case 'agent_done':
      if ((next.generationCanceled || GENERATION_FENCED_PHASES.has(next.phase))
          && !(event.type === 'agent_done' && event.carbonize === true && next.phase === 'accept_requested')) {
        next.diagnostics.push({
          error: 'late_generation_event_ignored',
          type: event.type,
          phase: next.phase,
        });
        break;
      }
      next.phase = event.carbonize === true ? 'carbonize_required' : 'variants_ready';
      // Durable completion marker: later browser checkpoints (a resumed page
      // reporting phase "generating") regress `phase`, but generation staying
      // finished is monotone — the live server keys missed-`done` redelivery
      // on this field.
      next.generationCompletedAt = event.at ?? (Date.parse(entry.ts || '') || Date.now());
      next.sourceFile = event.sourceFile ?? event.file ?? next.sourceFile;
      next.previewFile = event.previewFile ?? next.previewFile;
      next.previewMode = event.previewMode ?? next.previewMode;
      next.arrivedVariants = event.arrivedVariants ?? (next.expectedVariants || next.arrivedVariants || 0);
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      if (event.carbonize === true) {
        next.diagnostics.push({
          error: 'carbonize_cleanup_required',
          file: event.file || null,
          message: 'Accepted variant still has carbonize markers that must be folded into source CSS.',
        });
      }
      next.renderState = deriveRenderState(next);
      break;
    case 'variant_mounted': {
      const variant = Number(event.variant);
      if (!Number.isInteger(variant) || variant < 1) {
        next.diagnostics.push({ error: 'malformed_mount_ack', type: event.type, variant: event.variant ?? null });
        break;
      }
      if (!next.mountedVariants.includes(variant)) {
        next.mountedVariants = [...next.mountedVariants, variant].sort((a, b) => a - b);
      }
      next.renderState = deriveRenderState(next);
      break;
    }
    case 'variant_mount_failed': {
      const variant = Number(event.variant);
      if (!Number.isInteger(variant) || variant < 1) {
        next.diagnostics.push({ error: 'malformed_mount_ack', type: event.type, variant: event.variant ?? null });
        break;
      }
      next.mountFailures = [
        ...next.mountFailures,
        {
          variant,
          url: typeof event.url === 'string' ? event.url : null,
          error: typeof event.error === 'string' ? event.error : null,
          at: event.at ?? (Date.parse(entry.ts || '') || Date.now()),
        },
      ].slice(-MOUNT_FAILURE_HISTORY);
      next.renderState = deriveRenderState(next);
      // The failure needs an agent reply, so it must survive a helper
      // restart the same way a generate does. Never clobber a still-pending
      // generate: a progressive publish can fail an early mount while the
      // generate event itself is still leased.
      if (!next.pendingEvent) {
        next.pendingEvent = toPendingEvent(event);
      }
      break;
    }
    case 'checkpoint':
      if (next.generationCanceled || GENERATION_FENCED_PHASES.has(next.phase)) {
        next.diagnostics.push({ error: 'checkpoint_after_terminal_ignored', phase: event.phase ?? null, revision: event.revision ?? null });
        break;
      }
      {
        const revisionDomain = event.revisionDomain === 'publication'
          || (event.reason === 'variants_progress' && !event.owner)
          ? 'publication'
          : 'browser';
        const revisionField = revisionDomain === 'publication'
          ? 'publicationCheckpointRevision'
          : 'browserCheckpointRevision';
        const currentRevision = next[revisionField]
          ?? (revisionDomain === 'browser' ? next.checkpointRevision : 0)
          ?? 0;
        if ((event.revision ?? 0) >= currentRevision) {
          next.phase = event.phase ?? next.phase;
          next[revisionField] = event.revision ?? currentRevision;
          if (revisionDomain === 'browser') {
            next.checkpointRevision = event.revision ?? next.checkpointRevision;
            next.activeOwner = event.owner ?? next.activeOwner;
          }
          next.arrivedVariants = event.arrivedVariants ?? next.arrivedVariants;
          if (revisionDomain === 'browser') next.visibleVariant = event.visibleVariant ?? next.visibleVariant;
          next.sourceFile = event.sourceFile ?? next.sourceFile;
          next.previewFile = event.previewFile ?? next.previewFile;
          next.previewMode = event.previewMode ?? next.previewMode;
          if (revisionDomain === 'browser' && event.paramValues) next.paramValues = { ...event.paramValues };
        } else {
          next.diagnostics.push({ error: 'stale_checkpoint_ignored', revision: event.revision, revisionDomain });
        }
      }
      break;
    case 'accept':
    case 'accept_intent':
      next.phase = 'accept_requested';
      next.generationCanceled = true;
      next.generationCanceledAt = event.at ?? (Date.parse(entry.ts || '') || Date.now());
      next.cancelReason = 'accept';
      next.visibleVariant = Number(event.variantId ?? next.visibleVariant);
      if (event.paramValues) next.paramValues = { ...event.paramValues };
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'manual_edit_apply':
      next.phase = 'manual_edit_apply_requested';
      next.pageUrl = event.pageUrl ?? next.pageUrl;
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'steer':
      next.phase = 'steer_requested';
      next.pageUrl = event.pageUrl ?? next.pageUrl;
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'carbonize_cleanup':
      next.phase = 'carbonize_cleanup_requested';
      next.sourceFile = event.file ?? next.sourceFile;
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'steer_done':
      next.phase = 'steer_done';
      next.sourceFile = event.sourceFile ?? event.file ?? next.sourceFile;
      next.previewFile = event.previewFile ?? next.previewFile;
      next.previewMode = event.previewMode ?? next.previewMode;
      next.message = event.message ?? next.message;
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      break;
    case 'discard':
      next.phase = 'discard_requested';
      next.generationCanceled = true;
      next.generationCanceledAt = event.at ?? (Date.parse(entry.ts || '') || Date.now());
      next.cancelReason = 'discard';
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      break;
    case 'discarded':
      next.phase = 'discarded';
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      break;
    case 'complete':
      next.phase = 'completed';
      next.sourceFile = event.sourceFile ?? event.file ?? next.sourceFile;
      next.previewFile = event.previewFile ?? next.previewFile;
      next.previewMode = event.previewMode ?? next.previewMode;
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      break;
    case 'agent_error':
      if (next.generationCanceled && event.sourceEventType === 'generate') {
        next.diagnostics.push({ error: 'late_generation_event_ignored', type: event.type, phase: next.phase });
        break;
      }
      next.phase = 'agent_error';
      next.pendingEventSeq = null;
      next.pendingEvent = null;
      next.diagnostics.push({ error: 'agent_error', message: event.message || 'unknown agent error' });
      break;
    default:
      next.diagnostics.push({ error: 'unknown_event_type', type: event.type });
      break;
  }
  return next;
}

function toPendingEvent(event) {
  const pending = { ...event };
  delete pending.token;
  return pending;
}

function upsertArtifact(artifacts, artifact) {
  if (!artifacts.some((existing) => existing.path === artifact.path && existing.type === artifact.type)) {
    artifacts.push(artifact);
  }
}

function writeSnapshot(snapshotPath, snapshot, meta) {
  const payload = {
    ...snapshot,
    [META_JOURNAL_BYTES]: meta?.journalBytes ?? -1,
    [META_NEXT_SEQ]: meta?.nextSeq ?? 1,
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2) + '\n');
}
