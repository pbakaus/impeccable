import fs from 'node:fs';
import path from 'node:path';
import { getLegacyLiveSessionsDir, getLiveSessionsDir, safeSessionId } from '../lib/impeccable-paths.mjs';

const COMPLETED_PHASES = new Set(['completed', 'discarded']);
export const GENERATION_FENCED_PHASES = new Set([
  'accept_requested',
  'discard_requested',
  'carbonize_required',
  'completed',
  'discarded',
]);

export function createLiveSessionStore({ cwd = process.cwd(), sessionId } = {}) {
  const rootDir = getLiveSessionsDir(cwd);
  const legacyRootDir = getLegacyLiveSessionsDir(cwd);
  fs.mkdirSync(rootDir, { recursive: true });

  // No snapshot cache on purpose: appendEvent and getSnapshot both rebuild from
  // the journal so sequence numbers and phase fences never come from a stale
  // in-memory copy when the publisher/complete helpers append from another
  // process. A cache written but never read would grow per session for the
  // lifetime of the server without ever saving a rebuild.
  function getReadableJournalPath(id) {
    const primary = getJournalPath(rootDir, id);
    if (fs.existsSync(primary)) return primary;
    const legacy = getJournalPath(legacyRootDir, id);
    if (fs.existsSync(legacy)) return legacy;
    return primary;
  }

  return {
    rootDir,
    legacyRootDir,
    appendEvent(event) {
      const normalized = normalizeEvent(event, sessionId);
      const journalPath = getJournalPath(rootDir, normalized.id);
      const snapshotPath = getSnapshotPath(rootDir, normalized.id);
      const legacyJournalPath = getJournalPath(legacyRootDir, normalized.id);
      if (!fs.existsSync(journalPath) && fs.existsSync(legacyJournalPath)) {
        fs.copyFileSync(legacyJournalPath, journalPath);
      }
      // Publisher/complete helpers can append from a separate process while
      // the server is alive. Rebuild here so sequence numbers and phase
      // fences never come from a stale in-memory cache.
      const prior = rebuildSnapshotFromJournal(getReadableJournalPath(normalized.id), normalized.id);
      const seq = prior.nextSeq;
      const entry = {
        seq,
        id: normalized.id,
        type: normalized.type,
        ts: new Date().toISOString(),
        event: normalized,
      };
      fs.appendFileSync(journalPath, JSON.stringify(entry) + '\n');
      const next = applyEvent(prior.snapshot, entry, prior.diagnostics);
      writeSnapshot(snapshotPath, next);
      return next;
    },
    getSnapshot(id = sessionId, opts = {}) {
      if (!id) throw new Error('session id required');
      const journalPath = getReadableJournalPath(id);
      const snapshotPath = getSnapshotPath(rootDir, id);
      const rebuilt = rebuildSnapshotFromJournal(journalPath, id);
      writeSnapshot(snapshotPath, rebuilt.snapshot);
      if (!opts.includeCompleted && COMPLETED_PHASES.has(rebuilt.snapshot.phase)) return null;
      return rebuilt.snapshot;
    },
    listActiveSessions() {
      const ids = new Set();
      for (const dir of [legacyRootDir, rootDir]) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length));
        }
      }
      return [...ids]
        .sort()
        .map((id) => this.getSnapshot(id))
        .filter(Boolean);
    },
  };
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
    diagnostics: [],
    updatedAt: null,
  };
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

function applyEvent(snapshot, entry, inheritedDiagnostics = []) {
  const event = entry.event || entry;
  const next = {
    ...snapshot,
    paramValues: { ...(snapshot.paramValues || {}) },
    sourceMarkers: { ...(snapshot.sourceMarkers || {}) },
    generationTimings: { ...(snapshot.generationTimings || {}) },
    variantPlan: snapshot.variantPlan || null,
    annotationArtifacts: [...(snapshot.annotationArtifacts || [])],
    diagnostics: [...(snapshot.diagnostics || [])],
    updatedAt: entry.ts || new Date().toISOString(),
  };

  if (inheritedDiagnostics.length && next.diagnostics.length === 0) {
    next.diagnostics = [...inheritedDiagnostics];
  }

  switch (event.type) {
    case 'generate':
      next.phase = 'generate_requested';
      next.pageUrl = event.pageUrl ?? next.pageUrl;
      next.expectedVariants = event.count ?? next.expectedVariants;
      next.pendingEventSeq = entry.seq ?? next.pendingEventSeq;
      next.pendingEvent = toPendingEvent(event);
      next.variantPlan = null;
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
      break;
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

function writeSnapshot(snapshotPath, snapshot) {
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
}
