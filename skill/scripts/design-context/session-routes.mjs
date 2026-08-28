/** The save flow behind the design context document.
 *
 * A person edits fields in the document; the edits stage in the browser and
 * arrive here as one batch when they press Apply. Applying is deterministic:
 * every change names a binding, the binding names a file and a path, and the
 * value is written through the store. Nothing is searched for and no model is
 * involved, which is what makes a save either complete or refused rather than
 * approximately done.
 *
 * What the agent gets afterwards is the reconciliation, not the write. The
 * values are already on disk by the time the batch reaches a poll; DESIGN.md
 * and PRODUCT.md are the agent's to bring in line with them.
 *
 *   browser  --POST /doc/save-------> applied here, journaled, batch queued
 *   agent    --GET  /doc/poll-------> save_batch (leased)
 *   agent    --POST /doc/reply------> acknowledged, version bumped
 *   browser  --GET  /doc/state------> version moved, so re-read and re-render
 *
 * The batch is journaled before it is offered and cleared only on an
 * acknowledgement, so a session that dies mid-flight re-offers it on the next
 * boot rather than losing the work.
 */

import { bindingFor, readPath, sanitizeValue, writePath } from './bindings.mjs';
import {
  appendJournal,
  readAnswers,
  readContext,
  replayJournal,
  writeAnswers,
  writeContext,
  SCHEMA_VERSION,
} from './store.mjs';

const MAX_CHANGES = 100;
/* Long enough that an agent doing real prose work is never raced, short enough
   that an agent that died does not hold the batch for the session's lifetime. */
const LEASE_MS = 10 * 60_000;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function createSaveRoutes({ cwd = process.cwd(), onChange = () => {} } = {}) {
  /* Recovered from the journal at boot: a batch the agent never acknowledged
     is still owed, whoever was running when it was made. */
  const replayed = replayJournal(cwd);
  let pending = replayed.pendingBatch
    ? { ...replayed.pendingBatch, leaseUntil: 0 }
    : null;
  let counter = Number(replayed.lastSeq) || 0;

  const summary = () => (pending
    ? { id: pending.id, status: pending.status, count: pending.changes.length }
    : null);

  function validate(body) {
    const changes = Array.isArray(body?.changes) ? body.changes : null;
    if (!changes?.length) throw httpError(400, 'changes must be a non-empty array');
    if (changes.length > MAX_CHANGES) throw httpError(400, `at most ${MAX_CHANGES} changes per save`);

    return changes.map((change) => {
      const binding = bindingFor(String(change?.bindingId ?? ''));
      if (!binding) throw httpError(400, `Unknown field: ${String(change?.bindingId ?? '')}`);
      let value;
      try {
        value = sanitizeValue(binding, change.to);
      } catch (error) {
        throw httpError(400, `${change.bindingId}: ${error.message}`);
      }
      return {
        bindingId: String(change.bindingId),
        binding,
        from: typeof change.from === 'string' ? change.from : '',
        to: value,
      };
    });
  }

  /** One read and one write per file, so a save lands whole or not at all. */
  async function applyToStore(changes) {
    const files = new Map();
    const load = async (file) => {
      if (!files.has(file)) {
        files.set(file, file === 'answers'
          ? (await readAnswers(cwd)) || {}
          : (await readContext(cwd)) || { schemaVersion: SCHEMA_VERSION });
      }
      return files.get(file);
    };

    for (const change of changes) {
      const document = await load(change.binding.file);
      /* context.json wraps its payload, so a binding path addresses the
         context object rather than the file's own root. */
      const root = change.binding.file === 'context'
        ? (document.context ??= {})
        : document;
      change.previous = String(readPath(root, change.binding.path) ?? '');
      writePath(root, change.binding.path, change.to);
    }

    if (files.has('answers')) await writeAnswers(files.get('answers'), cwd);
    if (files.has('context')) await writeContext(files.get('context'), cwd);
  }

  return {
    summary,
    hasPending: () => Boolean(pending),

    /** POST /doc/save */
    async save(body) {
      if (pending) throw httpError(409, 'A save is already applying');
      const changes = validate(body);
      await applyToStore(changes);

      for (const change of changes) {
        appendJournal({
          type: 'change',
          bindingId: change.bindingId,
          from: change.previous,
          to: change.to,
        }, cwd);
      }

      counter += 1;
      const id = `batch-${String(counter).padStart(3, '0')}`;
      const recorded = changes.map(({ bindingId, previous, to, binding }) => ({
        bindingId,
        from: previous,
        to,
        downstream: binding.downstream,
      }));
      appendJournal({ type: 'batch', id, status: 'pending', changes: recorded }, cwd);
      pending = { id, status: 'pending', changes: recorded, leaseUntil: 0 };
      onChange();
      return { id, count: recorded.length };
    },

    /** The event a polling agent is handed, or nothing when none is due. */
    takeBatchEvent(replyCommandFor) {
      if (!pending || pending.leaseUntil > Date.now()) return null;
      /* Stamped before anything awaits, so a second poll arriving in the same
         tick cannot be handed the same batch. */
      pending.leaseUntil = Date.now() + LEASE_MS;
      return {
        type: 'save_batch',
        id: pending.id,
        changes: pending.changes,
        downstream: pending.changes.filter((change) => change.downstream !== 'none'),
        replyCommand: replyCommandFor(pending.id),
      };
    },

    /**
     * POST /doc/reply for a batch.
     *
     * An unknown id keeps the lease and says which batch is actually owed, so
     * an agent that replied to the wrong thing can correct itself rather than
     * leaving the work stranded.
     */
    async reply(body) {
      if (!pending) throw httpError(404, 'No save is waiting for a reply');
      if (body.id !== pending.id) {
        throw httpError(404, `Unknown save ${String(body.id)}; the one waiting is ${pending.id}`);
      }
      if (!['done', 'error', 'retry'].includes(body.status)) {
        throw httpError(400, 'status must be done, error, or retry');
      }

      if (body.status === 'retry') {
        pending.leaseUntil = 0;
        onChange();
        return { ok: true, status: 'pending' };
      }

      /* The agent's own follow-on writes ride here rather than going to the
         store directly, so this process stays the only writer while it runs. */
      const applied = await applyAgentUpdates(body, cwd);
      appendJournal({ type: 'batch', id: pending.id, status: body.status, message: String(body.message || '') }, cwd);
      pending = null;
      onChange();
      return { ok: true, status: body.status, applied };
    },

    /** Values an agent attached to a request reply; batch replies apply
        theirs inside reply(). */
    applyAgentUpdates: (body) => applyAgentUpdates(body, cwd),

    /** Journaled so the tab re-reads on a font or freeform request too. */
    noteRequest(id, status) {
      appendJournal({ type: 'request', id, status }, cwd);
    },
  };
}

/**
 * Key-value updates an agent attaches to its reply.
 *
 * Answers keys are written as given, since the questionnaire's own vocabulary
 * is wider than the bound fields; context values go through their binding when
 * one exists, so the same rules apply to both writers.
 */
async function applyAgentUpdates(body, cwd) {
  const applied = { answers: 0, context: 0 };

  if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    const answers = (await readAnswers(cwd)) || {};
    for (const [key, value] of Object.entries(body.answers)) {
      if (typeof value !== 'string' && !Array.isArray(value)) continue;
      answers[key] = value;
      applied.answers += 1;
    }
    if (applied.answers) await writeAnswers(answers, cwd);
  }

  if (body.context && typeof body.context === 'object' && !Array.isArray(body.context)) {
    const stored = (await readContext(cwd)) || { schemaVersion: SCHEMA_VERSION };
    const root = (stored.context ??= {});
    for (const [dotted, value] of Object.entries(body.context)) {
      if (typeof value !== 'string') continue;
      const binding = bindingFor(dotted);
      let next = value;
      if (binding) {
        try {
          next = sanitizeValue(binding, value);
        } catch {
          continue;
        }
      }
      writePath(root, binding ? binding.path : dotted, next);
      applied.context += 1;
    }
    if (applied.context) await writeContext(stored, cwd);
  }

  return applied;
}
