import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getLiveDir } from '../lib/impeccable-paths.mjs';
import { readBuffer as readManualEditsBuffer } from './manual-edits-buffer.mjs';

const APPLY_EVENT_HARD_TIMEOUT_MS = Number(process.env.IMPECCABLE_LIVE_APPLY_EVENT_HARD_TIMEOUT_MS || 150_000);
const APPLY_EVENT_SOFT_DEADLINE_MS = Number(process.env.IMPECCABLE_LIVE_APPLY_EVENT_SOFT_DEADLINE_MS || 120_000);
const DEFAULT_MANUAL_EDIT_APPLY_CHUNK_SIZE = 3;
const MIN_MANUAL_EDIT_APPLY_CHUNK_SIZE = 1;
const MAX_MANUAL_EDIT_APPLY_CHUNK_SIZE = 20;
const MANUAL_APPLY_COMPACT_TEXT_LIMIT = 240;
const MANUAL_APPLY_COMPACT_NEARBY_LIMIT = 4;

export function createManualApplyController({
  pendingEvents,
  pendingApplyDeferreds,
  timedOutApplyIds,
  enqueueEvent,
  acknowledgePendingEvent,
  flushPendingPolls,
  recordManualEditActivity,
  cwd = () => process.cwd(),
} = {}) {
  const projectCwd = () => typeof cwd === 'function' ? cwd() : cwd || process.cwd();

  function tombstoneTimedOutApplyId(eventId, details = {}) {
    if (!eventId) return;
    timedOutApplyIds.set(eventId, details);
    if (timedOutApplyIds.size <= 200) return;
    const oldest = timedOutApplyIds.keys().next().value;
    timedOutApplyIds.delete(oldest);
  }

  function pushApplyEventAndWait(batch, pageUrl, chunk = null, repair = null) {
    const cwdValue = projectCwd();
    const eventId = randomUUID().replace(/-/g, '').slice(0, 8);
    const evidencePath = writeManualApplyEvidence(eventId, batch, cwdValue);
    const event = {
      type: 'manual_edit_apply',
      id: eventId,
      pageUrl,
      batch: compactManualApplyBatch(batch, cwdValue),
      evidencePath,
      agentAction: buildManualApplyAgentAction(eventId),
      schemaVersion: 1,
      deadlineMs: APPLY_EVENT_SOFT_DEADLINE_MS,
    };
    if (chunk) event.chunk = chunk;
    if (repair) event.repair = repair;
    const rollbackSnapshot = snapshotApplyEventFiles(batch, cwdValue);
    recordManualEditActivity('manual_edit_apply_dispatched', {
      id: eventId,
      pageUrl,
      chunk,
      repair,
      entryCount: Array.isArray(batch.entries) ? batch.entries.length : 0,
      opCount: countManualApplyOps(batch),
      fileCount: collectManualApplyFiles(batch, [], cwdValue).length,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingApplyDeferreds.delete(eventId);
        tombstoneTimedOutApplyId(eventId, { batch, rollbackSnapshot, cwd: cwdValue });
        acknowledgePendingEvent(eventId);
        removeManualApplyEvidence(evidencePath, cwdValue);
        recordManualEditActivity('manual_edit_apply_timeout', {
          id: eventId,
          pageUrl,
          chunk,
          entryCount: Array.isArray(batch.entries) ? batch.entries.length : 0,
          opCount: countManualApplyOps(batch),
        });
        reject(new Error('chat_agent_timeout'));
      }, APPLY_EVENT_HARD_TIMEOUT_MS);
      pendingApplyDeferreds.set(eventId, { resolve, reject, timer, event, batch, pageUrl, rollbackSnapshot, cwd: cwdValue });
      enqueueEvent(event);
    });
  }

  async function pushBatchInChunksAndWait(batch, pageUrl, context = {}) {
    const repair = context?.repair || batch?.repair || null;
    if (repair) return pushApplyEventAndWait(batch, pageUrl, null, repair);
    const chunks = splitManualApplyBatch(batch, manualEditApplyChunkSize());
    if (chunks.length <= 1) return pushApplyEventAndWait(batch, pageUrl);

    const expectedOpsByEntry = new Map();
    for (const entry of batch?.entries || []) {
      expectedOpsByEntry.set(entry.id, Array.isArray(entry.ops) ? entry.ops.length : 0);
    }

    const appliedOpsByEntry = new Map();
    const failedByEntry = new Map();
    const files = new Set();
    const notes = [];
    let aborted = false;

    for (const chunk of chunks) {
      if (aborted) {
        markChunkEntriesFailed(failedByEntry, chunk, 'manual_edit_chunk_aborted');
        continue;
      }

      let result;
      try {
        result = normalizeApplyChunkResult(await pushApplyEventAndWait(chunk.batch, pageUrl, chunk.meta));
      } catch (err) {
        markChunkEntriesFailed(failedByEntry, chunk, err.message || 'chat_agent_error');
        aborted = true;
        continue;
      }

      for (const file of result.files) files.add(file);
      notes.push(...result.notes);

      const chunkFailedIds = new Set();
      for (const item of result.failed) {
        const entryId = item.entryId || item.id;
        if (!entryId) continue;
        chunkFailedIds.add(entryId);
        if (!failedByEntry.has(entryId)) {
          failedByEntry.set(entryId, {
            entryId,
            reason: item.reason || item.message || 'failed',
            candidates: Array.isArray(item.candidates) ? item.candidates : [],
          });
        }
      }

      if (result.status === 'error') {
        markChunkEntriesFailed(failedByEntry, chunk, result.message || firstFailureReason(result) || 'chat_agent_error');
        aborted = true;
        continue;
      }

      const reportedAppliedIds = new Set(result.appliedEntryIds);
      for (const entryId of reportedAppliedIds) {
        if (!chunk.entryIds.has(entryId) || chunkFailedIds.has(entryId)) continue;
        appliedOpsByEntry.set(entryId, (appliedOpsByEntry.get(entryId) || 0) + (chunk.opCountsByEntry.get(entryId) || 0));
      }

      for (const entryId of chunk.entryIds) {
        if (reportedAppliedIds.has(entryId) || chunkFailedIds.has(entryId)) continue;
        if (!failedByEntry.has(entryId)) {
          failedByEntry.set(entryId, { entryId, reason: 'not_reported_applied', candidates: [] });
        }
      }
    }

    const appliedEntryIds = [];
    for (const [entryId, expectedOps] of expectedOpsByEntry.entries()) {
      if (failedByEntry.has(entryId)) continue;
      if ((appliedOpsByEntry.get(entryId) || 0) === expectedOps && expectedOps > 0) {
        appliedEntryIds.push(entryId);
      } else if (!failedByEntry.has(entryId)) {
        failedByEntry.set(entryId, { entryId, reason: 'not_reported_applied', candidates: [] });
      }
    }

    const failed = [...failedByEntry.values()];
    return {
      status: failed.length === 0 ? 'done' : appliedEntryIds.length > 0 ? 'partial' : 'error',
      appliedEntryIds,
      failed,
      files: [...files],
      notes,
    };
  }

  function getDeferred(eventId) {
    return pendingApplyDeferreds.get(eventId) || null;
  }

  function hasTimedOutId(eventId) {
    return timedOutApplyIds.has(eventId);
  }

  function resolveDeferred(eventId, body) {
    const deferred = pendingApplyDeferreds.get(eventId);
    if (!deferred) return false;
    pendingApplyDeferreds.delete(eventId);
    clearTimeout(deferred.timer);
    removeManualApplyEvidence(deferred.event?.evidencePath, deferred.cwd || projectCwd());
    deferred.resolve(body);
    return true;
  }

  function rejectDeferred(eventId, reason) {
    const deferred = pendingApplyDeferreds.get(eventId);
    if (!deferred) return false;
    pendingApplyDeferreds.delete(eventId);
    clearTimeout(deferred.timer);
    removeManualApplyEvidence(deferred.event?.evidencePath, deferred.cwd || projectCwd());
    deferred.reject(new Error(reason || 'chat_agent_error'));
    return true;
  }

  function referencedManualApplyEvidencePaths(cwdValue = projectCwd()) {
    const referenced = new Set();
    const add = (event) => {
      const fullPath = normalizeManualApplyEvidencePath(event?.evidencePath, cwdValue);
      if (fullPath) referenced.add(fullPath);
    };
    for (const entry of pendingEvents) add(entry.event);
    for (const deferred of pendingApplyDeferreds.values()) add(deferred.event);
    return referenced;
  }

  function pruneStaleEvidence(cwdValue = projectCwd()) {
    const dir = manualApplyEvidenceDir(cwdValue);
    if (!fs.existsSync(dir)) return [];
    const referenced = referencedManualApplyEvidencePaths(cwdValue);
    const removed = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const fullPath = path.join(dir, name);
      if (referenced.has(fullPath)) continue;
      try {
        fs.unlinkSync(fullPath);
        removed.push(fullPath);
      } catch {
        // Stale evidence cleanup is best-effort; Apply verification never relies
        // on deleting these files.
      }
    }
    return removed;
  }

  function rollbackTimedOutReply(msg) {
    const details = timedOutApplyIds.get(msg.id);
    if (!details) return { rolledBackFiles: [], rollbackFailures: [] };
    timedOutApplyIds.delete(msg.id);
    return rollbackApplySnapshot(
      details.batch,
      details.rollbackSnapshot,
      msg.data?.files || [],
      'stale_manual_edit_apply_reply',
      details.cwd || projectCwd(),
    );
  }

  function cancelPendingEvents(pageUrl, reason = 'manual_edit_discarded') {
    const canceledById = new Map();
    const shouldCancel = (event) => event?.type === 'manual_edit_apply' && (!pageUrl || event.pageUrl === pageUrl);

    for (let i = pendingEvents.length - 1; i >= 0; i -= 1) {
      const event = pendingEvents[i]?.event;
      if (!shouldCancel(event)) continue;
      pendingEvents.splice(i, 1);
      removeManualApplyEvidence(event.evidencePath, projectCwd());
      canceledById.set(event.id, {
        id: event.id,
        pageUrl: event.pageUrl,
        entryCount: event.batch?.entries?.length || 0,
      });
    }

    for (const [eventId, deferred] of [...pendingApplyDeferreds.entries()]) {
      if (!shouldCancel(deferred.event)) continue;
      pendingApplyDeferreds.delete(eventId);
      clearTimeout(deferred.timer);
      const cwdValue = deferred.cwd || projectCwd();
      const rollback = rollbackApplySnapshot(deferred.batch, deferred.rollbackSnapshot, [], reason, cwdValue);
      tombstoneTimedOutApplyId(eventId, {
        batch: deferred.batch,
        rollbackSnapshot: deferred.rollbackSnapshot,
        reason,
        cwd: cwdValue,
      });
      removeManualApplyEvidence(deferred.event?.evidencePath, cwdValue);
      canceledById.set(eventId, {
        id: eventId,
        pageUrl: deferred.pageUrl,
        entryCount: deferred.batch?.entries?.length || 0,
        rolledBackFiles: rollback.rolledBackFiles,
        rollbackFailures: rollback.rollbackFailures,
      });
      deferred.reject(new Error(reason));
    }

    if (canceledById.size > 0) flushPendingPolls();
    return [...canceledById.values()];
  }

  return {
    buildAgentAction: buildManualApplyAgentAction,
    cancelPendingEvents,
    clearTransaction: (transactionId = null) => clearManualApplyTransaction(projectCwd(), transactionId),
    countOps: countManualApplyOps,
    getDeferred,
    hasTimedOutId,
    pruneStaleEvidence,
    pushBatchInChunksAndWait,
    readTransaction: () => readManualApplyTransaction(projectCwd()),
    rejectDeferred,
    resolveDeferred,
    rollbackTimedOutReply,
    rollbackTransaction: (opts = {}) => rollbackManualApplyTransaction({
      cwd: projectCwd(),
      recordManualEditActivity,
      ...opts,
    }),
    summarizeEvent: (event = {}, batch = event.batch) => summarizeManualApplyEvent(event, batch, projectCwd()),
    validateResultMessage: validateManualApplyResultMessage,
    writeTransaction: (opts = {}) => writeManualApplyTransaction({ cwd: projectCwd(), ...opts }),
  };
}

export function manualEditApplyChunkSize(env = process.env) {
  const raw = Number(env.IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_MANUAL_EDIT_APPLY_CHUNK_SIZE;
  const size = Math.trunc(raw);
  return Math.max(MIN_MANUAL_EDIT_APPLY_CHUNK_SIZE, Math.min(MAX_MANUAL_EDIT_APPLY_CHUNK_SIZE, size));
}

export function countManualApplyOps(entriesOrBatch) {
  const entries = Array.isArray(entriesOrBatch)
    ? entriesOrBatch
    : Array.isArray(entriesOrBatch?.entries) ? entriesOrBatch.entries : [];
  let count = 0;
  for (const entry of entries) count += Array.isArray(entry.ops) ? entry.ops.length : 0;
  return count;
}

export function writeManualApplyEvidence(eventId, batch, cwd = process.cwd()) {
  const dir = manualApplyEvidenceDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const evidencePath = path.join(dir, `${eventId}.json`);
  fs.writeFileSync(evidencePath, JSON.stringify(batch, null, 2) + '\n', 'utf-8');
  return evidencePath;
}

export function manualApplyEvidenceDir(cwd = process.cwd()) {
  return path.join(getLiveDir(cwd), 'manual-edit-evidence');
}

export function normalizeManualApplyEvidencePath(evidencePath, cwd = process.cwd()) {
  if (!evidencePath || typeof evidencePath !== 'string') return null;
  const fullPath = path.isAbsolute(evidencePath) ? evidencePath : path.resolve(cwd, evidencePath);
  const evidenceDir = manualApplyEvidenceDir(cwd);
  const relative = path.relative(evidenceDir, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (path.extname(relative) !== '.json') return null;
  return fullPath;
}

export function removeManualApplyEvidence(evidencePath, cwd = process.cwd()) {
  const fullPath = normalizeManualApplyEvidencePath(evidencePath, cwd);
  if (!fullPath) return false;
  try {
    fs.unlinkSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

export function compactManualApplyBatch(batch = {}, cwd = process.cwd()) {
  const entries = (batch.entries || []).map(compactManualApplyEntry);
  const candidates = compactManualApplyCandidates(batch.candidates || [], cwd);
  return {
    version: batch.version,
    pageUrl: batch.pageUrl || null,
    count: batch.count,
    entries,
    ops: entries.flatMap((entry) => entry.ops.map((op) => ({ ...op, entryId: entry.id }))),
    candidates: candidates.length > 0 ? candidates : undefined,
    context: batch.context ? {
      bufferPath: batch.context.bufferPath,
      totalEntries: batch.context.totalEntries,
      totalOps: batch.context.totalOps,
      chunkIndex: batch.context.chunkIndex,
      chunkTotal: batch.context.chunkTotal,
      totalApplyOps: batch.context.totalApplyOps,
    } : undefined,
  };
}

export function compactManualApplyCandidates(candidates, cwd = process.cwd()) {
  return (Array.isArray(candidates) ? candidates : [])
    .slice(0, 24)
    .map((candidate) => ({
      entryId: candidate.entryId,
      ref: candidate.ref,
      sourceHint: compactManualApplySourceMatch(candidate.sourceHint, cwd),
      textMatches: compactManualApplySourceMatches(candidate.textMatches, 8, cwd),
      objectKeyMatches: compactManualApplySourceMatches(candidate.objectKeyMatches, 8, cwd),
      contextTextMatches: compactManualApplySourceMatches(candidate.contextTextMatches, 8, cwd),
      locatorMatches: compactManualApplySourceMatches(candidate.locatorMatches, 6, cwd),
    }));
}

function compactManualApplySourceMatches(matches, limit, cwd) {
  return (Array.isArray(matches) ? matches : [])
    .slice(0, limit)
    .map((match) => compactManualApplySourceMatch(match, cwd))
    .filter(Boolean);
}

function compactManualApplySourceMatch(match, cwd) {
  if (!match || typeof match !== 'object') return null;
  const file = match.relativeFile || match.file;
  if (!file && !match.line) return null;
  return {
    file: summarizeManualLogFile(file, cwd),
    line: match.line || null,
    column: match.column || null,
    reason: match.reason || match.kind || undefined,
    status: match.status || undefined,
  };
}

function compactManualApplyEntry(entry = {}) {
  return {
    id: entry.id,
    pageUrl: entry.pageUrl,
    stagedAt: entry.stagedAt || null,
    element: compactManualApplyContext(entry.element),
    ops: (entry.ops || []).map(compactManualApplyOp),
  };
}

function compactManualApplyOp(op = {}) {
  return {
    entryId: op.entryId,
    ref: op.ref,
    contextRef: op.contextRef,
    tag: op.tag,
    elementId: op.elementId,
    classes: Array.isArray(op.classes) ? op.classes : [],
    originalText: op.originalText,
    newText: op.newText,
    deleted: op.deleted === true || undefined,
    sourceHint: op.sourceHint || null,
    leaf: compactManualApplyContext(op.leaf),
    nearbyEditableTexts: compactNearbyManualEditTexts(op.nearbyEditableTexts),
    container: compactManualApplyContext(op.container),
    contextHints: Array.isArray(op.contextHints) ? op.contextHints.slice(0, 8) : undefined,
  };
}

function compactManualApplyContext(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ref: value.ref,
    tagName: value.tagName || value.tag || null,
    id: value.id || null,
    classes: Array.isArray(value.classes) ? value.classes : [],
    textContent: truncateManualApplyText(value.textContent, MANUAL_APPLY_COMPACT_TEXT_LIMIT),
  };
}

function compactNearbyManualEditTexts(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, MANUAL_APPLY_COMPACT_NEARBY_LIMIT)
    .map((item) => typeof item === 'string' ? { text: truncateManualApplyText(item, MANUAL_APPLY_COMPACT_TEXT_LIMIT) } : {
      ref: item?.ref,
      tag: item?.tag,
      classes: Array.isArray(item?.classes) ? item.classes : [],
      text: truncateManualApplyText(item?.text, MANUAL_APPLY_COMPACT_TEXT_LIMIT),
    });
}

function truncateManualApplyText(value, max) {
  if (typeof value !== 'string') return value || null;
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeApplyChunkResult(result) {
  const status = result?.status === 'partial' ? 'partial' : result?.status === 'error' ? 'error' : 'done';
  return {
    status,
    message: typeof result?.message === 'string' ? result.message : null,
    appliedEntryIds: Array.isArray(result?.appliedEntryIds) ? result.appliedEntryIds.filter((id) => typeof id === 'string') : [],
    failed: Array.isArray(result?.failed) ? result.failed.filter(Boolean) : [],
    files: Array.isArray(result?.files) ? result.files.filter((file) => typeof file === 'string') : [],
    notes: Array.isArray(result?.notes) ? result.notes.filter((note) => typeof note === 'string') : [],
  };
}

function manualApplyResultShapeHint(eventId = 'EVENT_ID') {
  return `Use live-poll.mjs --reply ${eventId} done --data '{"status":"done","appliedEntryIds":["ENTRY_ID"],"failed":[],"files":["src/page.html"],"notes":[]}'`;
}

function invalidManualApplyResult(reason, eventId, extra = {}) {
  return {
    ok: false,
    body: {
      error: 'invalid_manual_apply_result',
      reason,
      hint: manualApplyResultShapeHint(eventId),
      ...extra,
    },
  };
}

export function validateManualApplyResultMessage(msg, deferred) {
  let data = msg?.data;
  const eventId = msg?.id || deferred?.event?.id || 'EVENT_ID';
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return invalidManualApplyResult('missing_result_data', eventId);
  }
  if ('entries' in data || 'ops' in data) {
    return invalidManualApplyResult('summary_result_not_allowed', eventId);
  }
  if (!['done', 'partial', 'error'].includes(data.status)) {
    return invalidManualApplyResult('invalid_status', eventId, { status: data.status ?? null });
  }

  for (const key of ['appliedEntryIds', 'failed', 'files', 'notes']) {
    if (!Array.isArray(data[key])) {
      return invalidManualApplyResult(`${key}_must_be_array`, eventId);
    }
  }

  for (const [index, value] of data.appliedEntryIds.entries()) {
    if (typeof value !== 'string' || !value) {
      return invalidManualApplyResult('appliedEntryIds_must_contain_strings', eventId, { index });
    }
  }
  for (const [index, value] of data.files.entries()) {
    if (typeof value !== 'string' || !value) {
      return invalidManualApplyResult('files_must_contain_strings', eventId, { index });
    }
  }
  for (const [index, value] of data.notes.entries()) {
    if (typeof value !== 'string') {
      return invalidManualApplyResult('notes_must_contain_strings', eventId, { index });
    }
  }
  for (const [index, item] of data.failed.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return invalidManualApplyResult('failed_must_contain_objects', eventId, { index });
    }
    if (typeof item.entryId !== 'string' || !item.entryId) {
      return invalidManualApplyResult('failed_entryId_required', eventId, { index });
    }
    if (typeof item.reason !== 'string' || !item.reason) {
      return invalidManualApplyResult('failed_reason_required', eventId, { index });
    }
  }

  const eventEntryIds = new Set((deferred?.batch?.entries || []).map((entry) => entry.id).filter(Boolean));
  for (const entryId of data.appliedEntryIds) {
    if (eventEntryIds.size > 0 && !eventEntryIds.has(entryId)) {
      return invalidManualApplyResult('applied_entry_id_not_in_event', eventId, { entryId });
    }
  }
  for (const item of data.failed) {
    if (eventEntryIds.size > 0 && !eventEntryIds.has(item.entryId)) {
      return invalidManualApplyResult('failed_entry_id_not_in_event', eventId, { entryId: item.entryId });
    }
  }

  if (data.status === 'done') {
    if (data.failed.length > 0) {
      return invalidManualApplyResult('done_result_has_failed_entries', eventId);
    }
    if (countManualApplyOps(deferred?.batch) > 0 && data.appliedEntryIds.length === 0) {
      return invalidManualApplyResult('done_result_missing_applied_entry_ids', eventId);
    }
  }
  if (data.status === 'partial' && data.appliedEntryIds.length === 0 && data.failed.length === 0) {
    return invalidManualApplyResult('partial_result_has_no_entries', eventId);
  }
  if (data.status === 'error' && data.appliedEntryIds.length > 0) {
    return invalidManualApplyResult('error_result_has_applied_entries', eventId);
  }

  return {
    ok: true,
    result: {
      status: data.status,
      message: typeof data.message === 'string' ? data.message : undefined,
      appliedEntryIds: data.appliedEntryIds,
      failed: data.failed,
      files: data.files,
      notes: data.notes,
    },
  };
}

function firstFailureReason(result) {
  const first = Array.isArray(result?.failed) ? result.failed.find(Boolean) : null;
  return first?.reason || first?.message || null;
}

function markChunkEntriesFailed(failedByEntry, chunk, reason) {
  for (const entryId of chunk.entryIds) {
    if (failedByEntry.has(entryId)) continue;
    failedByEntry.set(entryId, { entryId, reason, candidates: [] });
  }
}

export function splitManualApplyBatch(batch, maxOps) {
  const totalOpCount = countManualApplyOps(batch);
  if (totalOpCount <= maxOps) {
    return [{
      batch,
      meta: null,
      entryIds: new Set((batch?.entries || []).map((entry) => entry.id).filter(Boolean)),
      opCountsByEntry: new Map((batch?.entries || []).map((entry) => [entry.id, Array.isArray(entry.ops) ? entry.ops.length : 0])),
    }];
  }

  const rawChunks = [];
  let current = createManualApplyChunkBuilder();
  for (const entry of batch?.entries || []) {
    const ops = entry.ops || [];
    if (ops.length <= maxOps) {
      if (current.opCount > 0 && current.opCount + ops.length > maxOps) {
        rawChunks.push(current);
        current = createManualApplyChunkBuilder();
      }
      for (const op of ops) addOpToManualApplyChunk(current, entry, op);
      continue;
    }
    if (current.opCount > 0) {
      rawChunks.push(current);
      current = createManualApplyChunkBuilder();
    }
    for (const op of ops) {
      if (current.opCount >= maxOps) {
        rawChunks.push(current);
        current = createManualApplyChunkBuilder();
      }
      addOpToManualApplyChunk(current, entry, op);
    }
  }
  if (current.opCount > 0) rawChunks.push(current);

  return rawChunks.map((chunk, index) => ({
    batch: {
      ...batch,
      count: chunk.opCount,
      entries: chunk.entries,
      ops: chunk.ops,
      candidates: filterManualApplyChunkCandidates(batch, chunk.refsByEntry),
      context: {
        ...(batch?.context || {}),
        totalEntries: chunk.entries.length,
        totalOps: chunk.opCount,
        chunkIndex: index + 1,
        chunkTotal: rawChunks.length,
        totalApplyOps: totalOpCount,
      },
    },
    meta: {
      index: index + 1,
      total: rawChunks.length,
      opCount: chunk.opCount,
      totalOpCount,
    },
    entryIds: new Set(chunk.entries.map((entry) => entry.id).filter(Boolean)),
    opCountsByEntry: chunk.opCountsByEntry,
  }));
}

function createManualApplyChunkBuilder() {
  return {
    entries: [],
    entryById: new Map(),
    entryIds: new Set(),
    ops: [],
    refsByEntry: new Map(),
    opCountsByEntry: new Map(),
    opCount: 0,
  };
}

function addOpToManualApplyChunk(chunk, entry, op) {
  let chunkEntry = chunk.entryById.get(entry.id);
  if (!chunkEntry) {
    chunkEntry = { ...entry, ops: [] };
    chunk.entryById.set(entry.id, chunkEntry);
    chunk.entryIds.add(entry.id);
    chunk.entries.push(chunkEntry);
  }
  chunkEntry.ops.push(op);
  chunk.ops.push({ ...op, entryId: op.entryId || entry.id });
  if (!chunk.refsByEntry.has(entry.id)) chunk.refsByEntry.set(entry.id, new Set());
  if (op.ref) chunk.refsByEntry.get(entry.id).add(op.ref);
  chunk.opCountsByEntry.set(entry.id, (chunk.opCountsByEntry.get(entry.id) || 0) + 1);
  chunk.opCount += 1;
}

function filterManualApplyChunkCandidates(batch, refsByEntry) {
  return (batch?.candidates || []).filter((candidate) => {
    const refs = refsByEntry.get(candidate.entryId);
    if (!refs) return false;
    if (!candidate.ref) return true;
    return refs.has(candidate.ref);
  });
}

export function snapshotApplyEventFiles(batch, cwd = process.cwd()) {
  const snapshot = new Map();
  for (const relativeFile of collectManualApplyFiles(batch, [], cwd)) {
    const absolute = path.resolve(cwd, relativeFile);
    try {
      snapshot.set(relativeFile, {
        exists: fs.existsSync(absolute),
        content: fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf-8') : '',
      });
    } catch {
      // If a file cannot be read before dispatch, do not attempt late rollback.
    }
  }
  return snapshot;
}

export function manualApplyTransactionPath(cwd = process.cwd()) {
  return path.join(getLiveDir(cwd), 'manual-edit-apply-transaction.json');
}

export function readManualApplyTransaction(cwd = process.cwd()) {
  const file = manualApplyTransactionPath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeManualApplyTransaction({ cwd = process.cwd(), pageUrl = null, batch }) {
  const file = manualApplyTransactionPath(cwd);
  const files = collectManualApplyFiles(batch, [], cwd);
  const transaction = {
    version: 1,
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    createdAt: new Date().toISOString(),
    pageUrl,
    entryIds: (batch?.entries || []).map((entry) => entry.id).filter(Boolean),
    files: files.map((relativeFile) => {
      const absolute = path.resolve(cwd, relativeFile);
      const exists = fs.existsSync(absolute);
      return {
        file: relativeFile,
        exists,
        content: exists ? fs.readFileSync(absolute, 'utf-8') : '',
      };
    }),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(transaction, null, 2) + '\n', 'utf-8');
  fs.renameSync(`${file}.tmp`, file);
  return transaction;
}

export function clearManualApplyTransaction(cwd = process.cwd(), transactionId = null) {
  const file = manualApplyTransactionPath(cwd);
  if (!fs.existsSync(file)) return false;
  if (transactionId) {
    const existing = readManualApplyTransaction(cwd);
    if (existing?.id && existing.id !== transactionId) return false;
  }
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function rollbackManualApplyTransaction({
  cwd = process.cwd(),
  pageUrl = null,
  reason = 'manual_edit_transaction_rollback',
  recordManualEditActivity = null,
} = {}) {
  const transaction = readManualApplyTransaction(cwd);
  if (!transaction) return null;
  if (pageUrl && transaction.pageUrl && transaction.pageUrl !== pageUrl) return null;

  let pendingIds = new Set();
  try {
    const buffer = readManualEditsBuffer(cwd);
    pendingIds = new Set((buffer.entries || []).map((entry) => entry.id).filter(Boolean));
  } catch {
    pendingIds = new Set(transaction.entryIds || []);
  }
  const shouldRollback = (transaction.entryIds || []).some((id) => pendingIds.has(id));
  if (!shouldRollback) {
    clearManualApplyTransaction(cwd, transaction.id);
    return { id: transaction.id, reason, rolledBackFiles: [], rollbackFailures: [], skipped: 'entries_not_pending' };
  }

  const rolledBackFiles = [];
  const rollbackFailures = [];
  for (const item of transaction.files || []) {
    const relativeFile = normalizeProjectFile(item.file, cwd);
    if (!relativeFile) continue;
    const absolute = path.resolve(cwd, relativeFile);
    try {
      if (item.exists) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, item.content || '', 'utf-8');
      } else if (fs.existsSync(absolute)) {
        fs.rmSync(absolute);
      }
      rolledBackFiles.push(relativeFile);
    } catch (err) {
      rollbackFailures.push({ file: relativeFile, reason: 'restore_failed', message: err.message || String(err) });
    }
  }
  clearManualApplyTransaction(cwd, transaction.id);
  recordManualEditActivity?.('manual_edit_transaction_rolled_back', {
    id: transaction.id,
    pageUrl: transaction.pageUrl || null,
    reason,
    entryIds: transaction.entryIds || [],
    rolledBackFiles: rolledBackFiles.map((file) => summarizeManualLogFile(file, cwd)).filter(Boolean),
    rollbackFailures: summarizeManualDiagnostics(rollbackFailures, cwd),
  });
  return { id: transaction.id, reason, rolledBackFiles, rollbackFailures };
}

export function collectManualApplyFiles(batch, extraFiles = [], cwd = process.cwd()) {
  const files = [];
  for (const entry of batch?.entries || []) {
    for (const op of entry.ops || []) files.push(op.sourceHint?.file);
  }
  for (const candidate of batch?.candidates || []) {
    files.push(candidate.sourceHint?.relativeFile, candidate.sourceHint?.file);
    for (const item of candidate.textMatches || []) files.push(item.file);
    for (const item of candidate.objectKeyMatches || []) files.push(item.file);
    for (const item of candidate.locatorMatches || []) files.push(item.file);
    for (const item of candidate.contextTextMatches || []) files.push(item.file);
  }
  files.push(...(extraFiles || []));
  return [...new Set(files)]
    .map((file) => normalizeProjectFile(file, cwd))
    .filter(Boolean);
}

function normalizeProjectFile(file, cwd = process.cwd()) {
  if (!file || typeof file !== 'string') return null;
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

export function rollbackApplySnapshot(
  batch,
  rollbackSnapshot,
  extraFiles = [],
  _reason = 'manual_edit_apply_snapshot_rollback',
  cwd = process.cwd(),
) {
  const scope = collectManualApplyFiles(batch, extraFiles, cwd);
  const rolledBackFiles = [];
  const rollbackFailures = [];
  for (const relativeFile of scope) {
    const before = rollbackSnapshot?.get(relativeFile);
    if (!before) continue;
    const absolute = path.resolve(cwd, relativeFile);
    try {
      if (before.exists) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, before.content, 'utf-8');
      } else if (fs.existsSync(absolute)) {
        fs.rmSync(absolute);
      }
      rolledBackFiles.push(relativeFile);
    } catch (err) {
      rollbackFailures.push({ file: relativeFile, reason: 'restore_failed', message: err.message || String(err) });
    }
  }
  return { rolledBackFiles, rollbackFailures };
}

function manualApplyReplyCommand(eventOrId = 'EVENT_ID') {
  const id = typeof eventOrId === 'string' ? eventOrId : eventOrId?.id || 'EVENT_ID';
  return `live-poll.mjs --reply ${id} done --data '<json>'`;
}

export function buildManualApplyAgentAction(eventOrId = 'EVENT_ID') {
  return {
    kind: 'manual_edit_apply',
    required: 'apply_source_edits_then_reply',
    replyCommand: manualApplyReplyCommand(eventOrId),
    warning: 'Polling only leases this work item; it does not commit source edits.',
  };
}

export function summarizeManualApplyEvent(event = {}, batch = event.batch, cwd = process.cwd()) {
  const entries = Array.isArray(batch?.entries) ? batch.entries : [];
  const opCount = entries.reduce((sum, entry) => sum + (Array.isArray(entry.ops) ? entry.ops.length : 0), 0);
  return {
    pageUrl: event.pageUrl || null,
    chunk: event.chunk || null,
    entryCount: entries.length,
    opCount,
    files: collectManualApplyFiles(batch, [], cwd),
  };
}

export function summarizeManualApplyFailures(failed, cwd = process.cwd()) {
  if (!Array.isArray(failed)) return [];
  return failed.slice(0, 20).map((item) => ({
    id: item.id || item.entryId || null,
    reason: item.reason || item.message || 'failed',
    message: compactManualLogText(item.message, 300),
    files: Array.isArray(item.files) ? item.files.slice(0, 12).map((file) => summarizeManualLogFile(file, cwd)).filter(Boolean) : undefined,
    checks: summarizeManualDiagnostics(item.checks, cwd),
    failures: summarizeManualDiagnostics(item.failures, cwd),
    candidates: summarizeManualDiagnostics(item.candidates, cwd),
  }));
}

export function summarizeManualDiagnostics(items, cwd = process.cwd()) {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.slice(0, 12).map((item) => ({
    reason: item.reason || item.kind || undefined,
    detail: compactManualLogText(item.detail, 220),
    message: compactManualLogText(item.message, 300),
    file: summarizeManualLogFile(item.file || item.relativeFile, cwd),
    line: item.line || undefined,
    ref: compactManualLogText(item.ref, 180),
    marker: compactManualLogText(item.marker, 120),
    files: Array.isArray(item.files) ? item.files.slice(0, 8).map((file) => summarizeManualLogFile(file, cwd)).filter(Boolean) : undefined,
  }));
}

export function summarizeManualLogFile(file, cwd = process.cwd()) {
  if (!file || typeof file !== 'string') return undefined;
  if (!path.isAbsolute(file)) return file;
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

export function compactManualLogText(value, max = 200) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max) + `... [truncated ${normalized.length - max} chars]`;
}
